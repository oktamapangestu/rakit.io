package ai

// Mode Agen: prompt dikerjakan mesin agen Claude Agent SDK di container Docker, sebagai pilihan selain Builder. Hasilnya melewati jalur yang sama dengan Builder: perubahan file diterapkan dengan
// snapshot, pengguna memilih Simpan/Batalkan, kredit & statistik sama.
//
// Susunan satu job:
//   - salinan kerja project (data/agent-jobs/<id>/workspace) di-mount ke container sebagai /workspace, beserta
//     AGENTS.md (agentsmd.go) berisi aturan rakit & keadaan project; file asli tidak disentuh selama agen bekerja;
//   - container tanpa jaringan (--network none). Tiga layanan host dibuka lewat unix socket dan dipetakan
//     proxy.cjs di container ke 127.0.0.1: site (:80, website dari salinan kerja + /api/db & /api/fn asli project —
//     AgentSite di main.go), ai (:8001, agentproxy.go — kunci provider tidak masuk container, token dibatasi),
//     tools (:8002, create_table — tabel langsung dibuat supaya bisa diuji, snapshot-nya ikut Batalkan; ask_user —
//     pertanyaan ke pengguna, lihat askuser.go);
//   - mesin melapor lewat stdout (driver deploy/agent/claude_driver.mjs, baris "@@RAKIT");
//     langkahnya ditampilkan di editor seperti langkah Builder;
//   - setiap kali mesin selesai, pemeriksaan akhir Builder (finalProblems) dijalankan atas selisih file; masalahnya
//     dikirim balik ke mesin (maks. agentMaxFixes kali).
// Image dibangun dengan deploy/agent/build.sh; diaktifkan dengan AI_AGENT_ENGINES (lihat config.Agent).

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/aimodels"
	"rakit.io/server/internal/files"
)

const agentMaxFixes = 3

type agentEngine struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

var agentEngineList = []agentEngine{
	{"claude", "Claude Agent", "Claude Agent SDK — teliti, menguji hasilnya sendiri"},
}

// AgentEngines: mesin mode Agen yang siap dipakai (dikonfigurasi dan image-nya ada), untuk editor.
func (s *Service) AgentEngines() []agentEngine {
	s.mu.Lock()
	ready := s.agentReady
	s.mu.Unlock()
	out := []agentEngine{}
	for _, e := range agentEngineList {
		if slices.Contains(ready, e.ID) {
			out = append(out, e)
		}
	}
	return out
}

func (s *Service) agentAvailable(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Contains(s.agentReady, id)
}

// checkAgentEngines: mesin yang dikonfigurasi dan image Docker-nya ada (dipanggil sekali saat server menyala).
func (s *Service) checkAgentEngines() {
	cfg := s.cfg.AI.Agent
	var ready []string
	for _, id := range cfg.Engines {
		known := slices.ContainsFunc(agentEngineList, func(e agentEngine) bool { return e.ID == id })
		if !known {
			log.Printf("ai: mesin agen %q tidak dikenal (pilihan: claude)", id)
			continue
		}
		if cfg.Command == "" {
			// image ls, bukan image inspect: di Docker Desktop (containerd) inspect nama pendek bisa gagal walau
			// image-nya ada dan bisa dijalankan.
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			out, err := exec.CommandContext(ctx, cfg.Docker, "image", "ls", "-q", cfg.ImagePrefix+id).Output()
			cancel()
			if err != nil || strings.TrimSpace(string(out)) == "" {
				log.Printf("ai: mode Agen %s tidak aktif — image %s%s tidak ada atau Docker tidak bisa dihubungi (jalankan deploy/agent/build.sh): %v", id, cfg.ImagePrefix, id, err)
				continue
			}
		}
		ready = append(ready, id)
	}
	s.mu.Lock()
	s.agentReady = ready
	s.mu.Unlock()
	if len(ready) > 0 {
		log.Printf("ai: mode Agen aktif: %s", strings.Join(ready, ", "))
	}
}

// ---------- Layanan host untuk container ----------

// agentTools: create_table & ask_user dari container. Tabel langsung dibuat (supaya /api/db bisa diuji agen);
// snapshot-nya dicatat untuk Batalkan.
type agentTools struct {
	s    *Service
	ctx  context.Context
	slug string

	// ask_user (askuser.go): job yang ditanyakan, event ke editor, dan batas waktu yang dihentikan selama menunggu.
	jobCtx    context.Context
	messageID int64
	userID    int64
	send      func(event)
	deadline  *pausableDeadline
	askSeq    int

	mu      sync.Mutex
	tables  []tableSnapshot
	changes []change
}

func (t *agentTools) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	reply := func(status int, text string) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(status)
		io.WriteString(w, text)
	}
	if r.Method == http.MethodPost && r.URL.Path == "/ask_user" {
		t.askUser(w, r)
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/create_table" {
		reply(http.StatusNotFound, "tidak ada")
		return
	}
	var args map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&args); err != nil {
		reply(http.StatusBadRequest, "Argumen create_table bukan JSON")
		return
	}
	// Tipe "picture" = image (lihat renameImageColumns).
	if cols, ok := args["columns"].([]any); ok {
		for _, c := range cols {
			if col, ok := c.(map[string]any); ok && col["type"] == "picture" {
				col["type"] = "image"
			}
		}
	}
	c, err := validateTable(args)
	if err != nil {
		reply(http.StatusBadRequest, err.Error())
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	snap, err := t.s.applyTable(t.ctx, t.slug, c, c.Columns)
	if err != nil {
		reply(http.StatusBadRequest, err.Error())
		return
	}
	t.tables = append(t.tables, snap)
	t.changes = append(t.changes, c)
	names := make([]string, 0, len(c.Columns))
	for _, col := range c.Columns {
		names = append(names, col.Name)
	}
	public := strings.Join(c.Public, ", ")
	if public == "" {
		public = "-"
	}
	verb := "dibuat"
	if snap.Existed {
		verb = "diperbarui"
	}
	reply(http.StatusOK, fmt.Sprintf(`Tabel "%s" %s (kolom: %s; publik: %s). Sudah bisa dipakai di /api/db/%s.`, c.Name, verb, strings.Join(names, ", "), public, c.Name))
}

// revert: hapus lagi tabel/kolom yang dibuat agen (job gagal atau dihentikan).
func (t *agentTools) revert() {
	t.mu.Lock()
	defer t.mu.Unlock()
	for i := len(t.tables) - 1; i >= 0; i-- {
		if err := t.s.revertTable(context.Background(), t.slug, t.tables[i]); err != nil {
			log.Printf("ai: mengembalikan tabel agen %s: %v", t.tables[i].Table, err)
		}
	}
	t.tables = nil
}

// startAgentServers membuka layanan host untuk container. Mengembalikan nilai RAKIT_UPSTREAMS (alamat dari sisi
// container) dan fungsi penutup.
func startAgentServers(transport, sockDir string, handlers map[string]http.Handler) (upstreams, hostAddrs map[string]string, stop func(), err error) {
	upstreams, hostAddrs = map[string]string{}, map[string]string{}
	var servers []*http.Server
	stop = func() {
		for _, srv := range servers {
			srv.Close()
		}
	}
	for name, h := range handlers {
		var l net.Listener
		if transport == "tcp" {
			l, err = net.Listen("tcp", "127.0.0.1:0")
			if err == nil {
				_, port, _ := net.SplitHostPort(l.Addr().String())
				upstreams[name] = "tcp:host.docker.internal:" + port
				hostAddrs[name] = "tcp:127.0.0.1:" + port
			}
		} else {
			sock := filepath.Join(sockDir, name+".sock")
			l, err = net.Listen("unix", sock)
			if err == nil {
				os.Chmod(sock, 0o666)
				upstreams[name] = "unix:/run/rakit/sock/" + name + ".sock"
				hostAddrs[name] = "unix:" + sock
			}
		}
		if err != nil {
			stop()
			return nil, nil, nil, err
		}
		srv := &http.Server{Handler: h, ReadHeaderTimeout: 30 * time.Second}
		servers = append(servers, srv)
		go srv.Serve(l)
	}
	return upstreams, hostAddrs, stop, nil
}

// agentUser: uid:gid proses di container — user server, supaya file buatan agen di folder kerja milik server (bisa
// dihapus, tidak pernah milik root). Server yang berjalan sebagai root memakai 1000:1000 dan folder kerjanya di-chown.
func agentUser(dirs ...string) (string, error) {
	uid, gid := os.Getuid(), os.Getgid()
	if uid == 0 {
		uid, gid = 1000, 1000
		for _, d := range dirs {
			err := filepath.WalkDir(d, func(p string, _ os.DirEntry, err error) error {
				if err != nil {
					return err
				}
				return os.Lchown(p, uid, gid)
			})
			if err != nil {
				return "", err
			}
		}
	}
	return fmt.Sprintf("%d:%d", uid, gid), nil
}

func joinUpstreams(m map[string]string) string {
	var parts []string
	for _, name := range []string{"site", "ai", "tools"} {
		parts = append(parts, name+"="+m[name])
	}
	return strings.Join(parts, ",")
}

// copyTree menyalin file biasa (bukan symlink) dari src ke dst.
func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		switch {
		case d.IsDir():
			return os.MkdirAll(target, 0o755)
		case d.Type().IsRegular():
			in, err := os.Open(p)
			if err != nil {
				return err
			}
			defer in.Close()
			out, err := os.Create(target)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, in); err != nil {
				out.Close()
				return err
			}
			return out.Close()
		}
		return nil
	})
}

// ---------- Laporan mesin → langkah di editor ----------

// agentSession membaca keluaran mesin agen dan menerjemahkannya jadi langkah aktivitas editor.
type agentSession struct {
	engine string
	act    *activity
	send   func(message string) error

	mu       sync.Mutex
	settled  chan struct{}
	lastText string
	errs     []string
	turns    int
	fifo     []int // langkah yang belum selesai, urut
	shell    int
	tests    int
}

var agentSelfTestRE = regexp.MustCompile(`cek-halaman|curl|node --check`)

// agentStep: nama tool mesin → tool & target untuk tampilan editor (STEP_LABEL di activity.svelte.js).
func agentStep(name string, args map[string]any) (tool, target string) {
	str := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := args[k].(string); ok && v != "" {
				return v
			}
		}
		return ""
	}
	clean := func(p string) string { return strings.TrimPrefix(strings.TrimPrefix(p, "/workspace/"), "./") }
	switch strings.TrimPrefix(name, "mcp__rakit__") { // tool MCP rakit (create_table, ask_user)
	case "Write":
		return "write_file", clean(str("file_path", "path"))
	case "Edit", "MultiEdit":
		return "edit_file", clean(str("file_path", "path"))
	case "Read", "Glob", "Grep":
		return "read_file", clean(str("file_path", "path", "pattern"))
	case "Bash":
		cmd := strings.TrimSpace(strings.SplitN(str("command"), "\n", 2)[0])
		if len([]rune(cmd)) > 90 {
			cmd = string([]rune(cmd)[:90]) + "…"
		}
		return "bash", cmd
	case "create_table":
		return "create_table", str("name")
	case "ask_user":
		q := str("question")
		if len([]rune(q)) > 90 {
			q = string([]rune(q)[:90]) + "…"
		}
		return "ask_user", q
	case "TodoWrite":
		return "todo", ""
	case "Skill":
		return "", ""
	}
	return name, ""
}

func (a *agentSession) stepStart(name string, args map[string]any) {
	tool, target := agentStep(name, args)
	if tool == "" {
		return
	}
	if tool == "bash" {
		a.shell++
		if cmd, _ := args["command"].(string); agentSelfTestRE.MatchString(cmd) {
			a.tests++
		}
	}
	a.act.seq++
	id := a.act.seq
	a.fifo = append(a.fifo, id)
	a.act.emit(event{"type": "step", "id": id, "tool": tool, "target": target, "state": "run"})
}

func (a *agentSession) stepEnd(failed bool, text string) {
	if len(a.fifo) == 0 {
		return
	}
	id := a.fifo[0]
	a.fifo = a.fifo[1:]
	state, note := "ok", ""
	if failed {
		state = "error"
		note = strings.TrimSpace(text)
		if len([]rune(note)) > 200 {
			note = string([]rune(note)[:200]) + "…"
		}
	}
	a.act.emit(event{"type": "step", "id": id, "state": state, "note": note})
}

func (a *agentSession) settle() {
	select {
	case a.settled <- struct{}{}:
	default:
	}
}

// readDriver: protokol driver (claude_driver.mjs) — baris "@@RAKIT {json}".
func (a *agentSession) readDriver(r io.Reader) {
	responses := map[string]bool{}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 16<<20)
	for sc.Scan() {
		raw, ok := strings.CutPrefix(sc.Text(), "@@RAKIT ")
		if !ok {
			continue
		}
		var e struct {
			Type, Name, Response, Message, Text string
			Args                                map[string]any
			Error                               bool
		}
		if json.Unmarshal([]byte(raw), &e) != nil {
			continue
		}
		a.mu.Lock()
		switch e.Type {
		case "tool":
			if e.Response != "" && !responses[e.Response] {
				responses[e.Response] = true
				a.turns++
			}
			a.stepStart(e.Name, e.Args)
		case "result":
			a.stepEnd(e.Error, e.Text)
		case "error":
			a.errs = append(a.errs, e.Message)
		case "settled":
			a.turns++
			if strings.TrimSpace(e.Text) != "" {
				a.lastText = strings.TrimSpace(e.Text)
			}
			a.settle()
		}
		a.mu.Unlock()
	}
}

// ---------- Menjalankan satu job ----------

// agentPrompt: permintaan untuk mesin agen — riwayat percakapan sebagai teks (mesin agen tidak bisa diisi pesan
// lama) diikuti permintaan sekarang.
func agentPrompt(history []message, ask string) string {
	if len(history) == 0 {
		return ask
	}
	var b strings.Builder
	b.WriteString("[Percakapan sebelumnya di project ini — konteks, bukan permintaan baru]\n")
	for _, m := range history {
		who := "Pengguna"
		if m["role"] == "assistant" {
			who = "AI"
		}
		content, _ := m["content"].(string)
		fmt.Fprintf(&b, "\n%s: %s\n", who, content)
	}
	b.WriteString("\n[Permintaan sekarang]\n" + ask)
	return b.String()
}

// agentCommand: env & perintah container untuk mesin (Claude Agent SDK lewat driver).
func agentCommand(model string) (env map[string]string, cmd []string) {
	return map[string]string{"ANTHROPIC_BASE_URL": "http://127.0.0.1:8001", "ANTHROPIC_API_KEY": "agent", "RAKIT_MODEL": model},
		[]string{"node", "/opt/rakit/claude_driver.mjs"}
}

// agentDiff: perubahan file .html/.css/.js salinan kerja dibanding isi awal, plus file lain yang dibuat agen
// (tidak didukung, diabaikan).
func agentDiff(before, after string) (changes []change, ignored []string, err error) {
	old, err := textFilesIn(before)
	if err != nil {
		return nil, nil, err
	}
	cur, err := textFilesIn(after)
	if err != nil {
		return nil, nil, err
	}
	for _, rel := range sortedKeys(cur) {
		if prev, ok := old[rel]; ok && prev == cur[rel] {
			continue
		}
		c, err := validateFile("write", map[string]any{"path": rel, "content": cur[rel]})
		if err != nil {
			ignored = append(ignored, rel+" ("+err.Error()+")")
			continue
		}
		changes = append(changes, c)
	}
	for _, rel := range sortedKeys(old) {
		if _, ok := cur[rel]; !ok {
			changes = append(changes, change{Action: "delete", Path: rel})
		}
	}
	entries, err := files.ListTree(after)
	if err != nil {
		return nil, nil, err
	}
	known := map[string]bool{}
	if list, err := files.ListTree(before); err == nil {
		for _, e := range list {
			known[e.Path] = true
		}
	}
	for _, e := range entries {
		if !e.Dir && !known[e.Path] && !files.IsTextFile(e.Path) && e.Path != agentsMDFile {
			ignored = append(ignored, e.Path)
		}
	}
	return changes, ignored, nil
}

type agentResult struct {
	*buildResult
	tables []tableSnapshot // tabel yang sudah dibuat agen (masuk snapshot untuk Batalkan)
	tools  *agentTools
}

// runAgent mengerjakan satu prompt mode Agen. ask: permintaan (sudah termasuk deskripsi gambar & blok terpilih).
func (s *Service) runAgent(ctx context.Context, in jobInput, ask string, history []message, h hooks, act *activity) (res *agentResult, err error) {
	cfg := s.cfg.AI.Agent
	slug := in.project.Slug
	if !s.agentAvailable(in.engine) {
		return nil, &failure{"bad_request", "Mesin agen ini tidak tersedia di server. Kredit dikembalikan."}
	}

	// Giliran: container agen berat (Chromium), jumlahnya dibatasi.
	select {
	case s.agentSlots <- struct{}{}:
	default:
		if h.onQueued != nil {
			h.onQueued(1, 1)
		}
		select {
		case s.agentSlots <- struct{}{}:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	defer func() { <-s.agentSlots }()
	if h.onRunning != nil {
		h.onRunning()
	}
	// Batas waktu job; berhenti selama agen menunggu jawaban pengguna (ask_user).
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	deadline := newPausableDeadline(cfg.Timeout, cancel)
	defer deadline.stop()

	primary, _ := s.models.For(aimodels.TaskBuilder)
	endpoint, err := s.models.Resolve(primary)
	if err != nil {
		return nil, err
	}
	if h.onModel != nil {
		h.onModel(primary)
	}

	jobsDir := filepath.Join(s.cfg.DataDir, "agent-jobs")
	if err := os.MkdirAll(jobsDir, 0o755); err != nil {
		return nil, err
	}
	work, err := os.MkdirTemp(jobsDir, fmt.Sprintf("%d-", in.messageID))
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(work)
	root := s.cfg.SiteRoot(slug)
	before, wsDir, runDir := filepath.Join(work, "before"), filepath.Join(work, "workspace"), filepath.Join(work, "run")
	// Unix socket di folder pendek: path socket dibatasi ±104 karakter (macOS) / 108 (Linux).
	sockDir, err := os.MkdirTemp("/tmp", "rakit-agent-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(sockDir)
	for _, d := range []string{before, wsDir, runDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, err
		}
	}
	if err := copyTree(root, before); err != nil {
		return nil, err
	}
	if err := copyTree(before, wsDir); err != nil {
		return nil, err
	}
	state, err := s.projectContext(ctx, slug, in.activePath, nil, false)
	if err != nil {
		return nil, err
	}
	md, err := agentsMD(s.buildPrompt, state, s.ProjectNotes(in.project.ID))
	if err != nil {
		return nil, err
	}
	var createTable any
	var tools []map[string]any
	json.Unmarshal([]byte(toolsJSON), &tools)
	for _, t := range tools {
		if fn, _ := t["function"].(map[string]any); fn["name"] == "create_table" {
			createTable = fn
		}
	}
	rawTable, _ := json.Marshal(createTable)
	for path, content := range map[string][]byte{
		filepath.Join(wsDir, agentsMDFile):         []byte(md),
		filepath.Join(runDir, "create_table.json"): rawTable,
		filepath.Join(runDir, "prompt.md"):         nil,
	} {
		if err := os.WriteFile(path, content, 0o644); err != nil {
			return nil, err
		}
	}

	// Layanan host.
	proxy := &agentProxy{ctx: ctx, client: s.http, baseURL: endpoint.BaseURL, apiKey: endpoint.APIKey, model: endpoint.Model,
		maxOutput: s.cfg.AI.MaxTokens, budget: cfg.MaxTokens}
	toolsSrv := &agentTools{s: s, ctx: context.Background(), slug: slug,
		jobCtx: ctx, messageID: in.messageID, userID: in.user.ID, send: act.send, deadline: deadline}
	defer func() {
		if err != nil {
			toolsSrv.revert()
		}
	}()
	if s.AgentSite == nil {
		return nil, errors.New("AgentSite belum dipasang")
	}
	upstreams, hostAddrs, stopServers, err := startAgentServers(cfg.Transport, sockDir, map[string]http.Handler{
		"site": s.AgentSite(slug, wsDir), "ai": proxy, "tools": toolsSrv,
	})
	if err != nil {
		return nil, err
	}
	defer stopServers()

	// Proses mesin: container Docker, atau AI_AGENT_CMD (test) dengan path host.
	engineEnv, engineCmd := agentCommand(endpoint.Model)
	name := fmt.Sprintf("rakit-agent-%d", in.messageID)
	var cmd *exec.Cmd
	if cfg.Command != "" {
		cmd = exec.Command("sh", "-c", cfg.Command)
		cmd.Env = append(os.Environ(), "RAKIT_ENGINE="+in.engine, "RAKIT_WORKSPACE="+wsDir, "RAKIT_RUN="+runDir,
			"RAKIT_SOCK_DIR="+sockDir, "RAKIT_UPSTREAMS="+joinUpstreams(hostAddrs), "RAKIT_AGENTS_MD=1")
		for k, v := range engineEnv {
			cmd.Env = append(cmd.Env, k+"="+v)
		}
	} else {
		user, err := agentUser(wsDir, runDir, sockDir)
		if err != nil {
			return nil, err
		}
		// User non-root tanpa capability, filesystem image read-only (hanya /workspace, /run/rakit/cfg, dan /tmp
		// sementara yang bisa ditulis). Port <1024 dibuka lewat sysctl supaya proxy.cjs bisa memakai :80.
		args := []string{"run", "--rm", "-i", "--name", name, "--memory", cfg.Memory, "--cpus", cfg.CPUs, "--pids-limit", "512",
			"--user", user, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only",
			"--tmpfs", "/tmp:rw,nosuid,nodev,size=512m", "--sysctl", "net.ipv4.ip_unprivileged_port_start=0",
			"-v", wsDir + ":/workspace", "-v", runDir + ":/run/rakit/cfg"}
		if cfg.Transport == "tcp" {
			args = append(args, "--add-host", "host.docker.internal:host-gateway")
		} else {
			args = append(args, "--network", "none", "-v", sockDir+":/run/rakit/sock")
		}
		env := map[string]string{"RAKIT_UPSTREAMS": joinUpstreams(upstreams), "RAKIT_RUN": "/run/rakit/cfg",
			"RAKIT_BRIDGE": "http://127.0.0.1:8002", "RAKIT_AGENTS_MD": "1"}
		for k, v := range engineEnv {
			env[k] = v
		}
		for _, k := range sortedKeys(env) {
			args = append(args, "-e", k+"="+env[k])
		}
		args = append(args, cfg.ImagePrefix+in.engine)
		cmd = exec.Command(cfg.Docker, append(args, engineCmd...)...)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr tailBuffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("menjalankan mesin agen: %w", err)
	}
	exited := make(chan struct{})
	go func() {
		cmd.Wait()
		close(exited)
	}()
	kill := func() {
		if cfg.Command == "" {
			exec.Command(cfg.Docker, "rm", "-f", name).Run()
		}
		cmd.Process.Kill()
	}
	defer func() {
		stdin.Close()
		select {
		case <-exited:
		case <-time.After(5 * time.Second):
			kill()
			<-exited
		}
	}()
	go func() {
		select {
		case <-ctx.Done():
			kill()
		case <-exited:
		}
	}()

	session := &agentSession{engine: in.engine, act: act, settled: make(chan struct{}, 1)}
	go session.readDriver(stdout)
	session.send = func(message string) error {
		raw, _ := json.Marshal(map[string]string{"type": "prompt", "message": message})
		_, err := stdin.Write(append(raw, '\n'))
		return err
	}
	ask1 := func(message string) error {
		if err := session.send(message); err != nil {
			return err
		}
		select {
		case <-session.settled:
			return nil
		case <-exited:
			return fmt.Errorf("mesin agen berhenti: %s", stderr.tail())
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	stats := buildStats{}
	var changes []change
	var ignored []string
	var byFile map[string][]problem
	var images []string
	check := func() error {
		var err error
		if changes, ignored, err = agentDiff(before, wsDir); err != nil {
			return err
		}
		tables, columns, err := s.tablesOf(ctx, slug)
		if err != nil {
			return err
		}
		ws := newWorkspace(before, tables)
		ws.columns = columns
		ws.request = in.prompt
		for _, c := range changes {
			ws.st.set(c)
		}
		byFile, images = ws.finalProblems()
		return nil
	}

	if err := ask1(agentPrompt(history, ask)); err != nil {
		if deadline.hasExpired() {
			return nil, &failure{"timeout", fmt.Sprintf("Mode Agen melewati batas waktu %d menit. Kredit dikembalikan.", int(cfg.Timeout.Minutes()))}
		}
		return nil, err
	}
	lastNudge, fixes := "", 0
	for {
		if err := check(); err != nil {
			return nil, err
		}
		problems := problemList(byFile)
		nudge := strings.Join(problems, "\n")
		if len(problems) == 0 || nudge == lastNudge || fixes >= agentMaxFixes || proxy.exhausted() {
			break
		}
		lastNudge = nudge
		fixes++
		for _, list := range byFile {
			stats.count(&stats.Found, list)
		}
		act.note(fmt.Sprintf("Pemeriksaan otomatis menemukan %d masalah — AI memperbaikinya", len(problems)))
		if err := ask1("Sebelum selesai, perbaiki masalah ini, lalu tulis ringkasan lagi:\n" + nudge); err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			break // hasil sejauh ini tetap dipakai
		}
	}
	for _, list := range byFile {
		stats.count(&stats.Left, list)
	}

	session.mu.Lock()
	text, errs := session.lastText, session.errs
	stats.Rounds = session.turns
	session.mu.Unlock()
	toolsSrv.mu.Lock()
	tableChanges, tableSnaps := slices.Clone(toolsSrv.changes), slices.Clone(toolsSrv.tables)
	toolsSrv.mu.Unlock()
	if text == "" && len(changes) == 0 && len(tableChanges) == 0 && len(errs) > 0 {
		log.Printf("ai: mode Agen %s gagal: %s", in.engine, strings.Join(errs, " | "))
		return nil, &failure{"bad_output", "Mesin agen gagal menghubungi AI. Coba lagi. Kredit dikembalikan."}
	}
	if proxy.exhausted() {
		text = strings.TrimSpace(text + "\n\n⚠️ AI berhenti karena mencapai batas pemakaian untuk satu prompt. Cek hasilnya; lanjutkan dengan prompt baru bila perlu.")
	}
	if len(ignored) > 0 {
		text = strings.TrimSpace(text + "\n\nℹ️ File ini dibuat AI tapi tidak didukung rakit, jadi tidak disimpan: " + strings.Join(ignored, ", ") + ".")
	}
	inTok, outTok := proxy.usage()
	result := &buildResult{message: stripClaims(planMessage(text)), changes: append(tableChanges, changes...), stats: stats,
		inTokens: inTok, outTok: outTok, peakIn: proxy.peakInput(), images: images}
	return &agentResult{buildResult: result, tables: tableSnaps, tools: toolsSrv}, nil
}

// tablesOf: nama tabel & kolom database project (untuk pemeriksaan kode).
func (s *Service) tablesOf(ctx context.Context, slug string) ([]string, map[string][]string, error) {
	var names []string
	columns := map[string][]string{}
	if !s.userdb.HasDatabase(slug) {
		return names, columns, nil
	}
	tables, err := s.userdb.ListTables(ctx, slug)
	if err != nil {
		return nil, nil, err
	}
	for _, t := range tables {
		names = append(names, t.Name)
		cols := []string{}
		for _, c := range t.Columns {
			cols = append(cols, c.Name)
			if c.Type == "reference" {
				cols = append(cols, c.Name+"__ref")
			}
		}
		columns[t.Name] = cols
	}
	return names, columns, nil
}

// tailBuffer menyimpan 4 KB terakhir stderr mesin (untuk pesan error).
type tailBuffer struct {
	mu  sync.Mutex
	buf []byte
}

func (t *tailBuffer) Write(p []byte) (int, error) {
	t.mu.Lock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > 4096 {
		t.buf = t.buf[len(t.buf)-4096:]
	}
	t.mu.Unlock()
	return len(p), nil
}

func (t *tailBuffer) tail() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.buf))
}
