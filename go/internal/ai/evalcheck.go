package ai

// Pemeriksaan akhir Builder untuk hasil kerja mesin AI lain (evaluasi Pi di scripts/ai-eval): isi folder before
// dianggap isi disk, selisih folder after terhadapnya dianggap perubahan yang disiapkan — lalu finalProblems
// dijalankan seperti di akhir runBuilder. Dipanggil lewat `rakit ai-check` (JSON di stdin, hasil di stdout).

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"sort"

	"rakit.io/server/internal/files"
)

type checkInput struct {
	Before  string              `json:"before"`
	After   string              `json:"after"`
	Tables  []string            `json:"tables"`
	Columns map[string][]string `json:"columns"` // nama kolom per tabel, kolom reference juga dengan akhiran __ref
	Request string              `json:"request"` // permintaan pengguna (pemeriksaan maksud, lihat intentcheck.go)
}

type checkOutput struct {
	Changes  []string            `json:"changes"`  // "write <path>" / "delete <path>"
	Problems map[string][]string `json:"problems"` // per file: "<jenis>: <teks>"
	Left     map[string]int      `json:"left"`     // jumlah per jenis, sama dengan ai_requests.checks.left
	Images   []string            `json:"images"`   // gambar dirujuk tapi belum ada (tidak dihitung masalah)
}

func textFilesIn(root string) (map[string]string, error) {
	out := map[string]string{}
	entries, err := files.ListTree(root)
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		if e.Dir || !files.IsTextFile(e.Path) {
			continue
		}
		// ReadRegular: salinan kerja mode Agen bisa berisi symlink buatan agen — tidak diikuti ke luar root.
		raw, err := files.ReadRegular(root, e.Path, 0)
		if errors.Is(err, fs.ErrNotExist) {
			continue // terhapus atau diganti symlink sesudah didaftar
		}
		if err != nil {
			return nil, err
		}
		out[e.Path] = string(raw)
	}
	return out, nil
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func checkDirs(in checkInput) (*checkOutput, error) {
	before, err := textFilesIn(in.Before)
	if err != nil {
		return nil, err
	}
	after, err := textFilesIn(in.After)
	if err != nil {
		return nil, err
	}
	ws := newWorkspace(in.Before, in.Tables)
	ws.columns = in.Columns
	ws.request = in.Request
	out := &checkOutput{Changes: []string{}, Problems: map[string][]string{}, Left: map[string]int{}, Images: []string{}}
	for _, rel := range sortedKeys(after) {
		if old, ok := before[rel]; !ok || old != after[rel] {
			ws.st.set(change{Action: "write", Path: rel, Content: after[rel]})
		}
	}
	for _, rel := range sortedKeys(before) {
		if _, ok := after[rel]; !ok {
			ws.st.set(change{Action: "delete", Path: rel})
		}
	}
	for _, c := range ws.st.list() {
		out.Changes = append(out.Changes, c.Action+" "+c.Path)
	}
	sort.Strings(out.Changes)
	byFile, images := ws.finalProblems()
	for file, list := range byFile {
		for _, p := range list {
			out.Problems[file] = append(out.Problems[file], p.kind+": "+p.text)
			out.Left[p.kind]++
		}
	}
	if images != nil {
		out.Images = images
	}
	return out, nil
}

// RunCheckCommand: `rakit ai-check` — baca checkInput dari r, tulis checkOutput ke w.
func RunCheckCommand(r io.Reader, w io.Writer) error {
	var in checkInput
	if err := json.NewDecoder(r).Decode(&in); err != nil {
		return err
	}
	out, err := checkDirs(in)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return enc.Encode(out)
}
