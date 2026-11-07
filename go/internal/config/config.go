// Package config membaca pengaturan dari environment, dengan nama variabel dan nilai default yang
// sama dengan src/config.js, supaya file .env yang sudah ada tetap dipakai apa adanya.
package config

import (
	"bufio"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port       string
	Protocol   string
	BaseDomain string
	DataDir    string
	AppOrigin  string // alamat aplikasi utama, mis. https://rakit.io
	PublicDir  string // folder halaman & aset aplikasi (public/)

	SecureCookies bool
	// Email pemilik platform yang boleh membuka dashboard /admin.
	AdminEmails []string
	portSuffix  string

	TemplateDir string // file awal project baru (templates/default)
	SiteMinify  bool   // website publik dikirim dengan .html/.css/.js versi minify (SITE_MINIFY=0 mematikan)
	MaxProjects int    // jumlah project (subdomain) maksimal per akun
	MaxCustom   int    // dari project itu, berapa yang boleh memakai alamat (subdomain) pilihan sendiri

	// Aplikasi desktop (internal/desktop): DESKTOP=1, token masuk dari aplikasi, dan mode proxy untuk webview
	// yang tidak mengenal *.localhost (macOS).
	Desktop      bool
	DesktopToken string
	DesktopProxy bool
	// CloudURL: server rakit tempat aplikasi desktop login, mengunduh, dan memublikasikan project
	// (RAKIT_CLOUD_URL, bawaan https://rakit.io). Lihat internal/api/cloud.go.
	CloudURL string
	// AppVersion: versi aplikasi desktop yang terpasang (APP_VERSION dari Tauri); ReleasesRepo: repo GitHub tempat
	// rilisnya (DESKTOP_RELEASES_REPO), untuk notifikasi update (internal/api/update.go).
	AppVersion   string
	ReleasesRepo string

	// Login dengan Google (OAuth client tipe "Web application").
	GoogleEnabled      bool
	GoogleClientID     string
	GoogleClientSecret string
	GoogleTokenURL     string

	// Endpoint API pengirim email (lupa password). Pengirim & API key diatur owner di dashboard.
	MailAPIURL string

	AI        AI
	Billing   Billing
	Assistant struct {
		// Paket isi ulang Saldo Asisten (Rupiah).
		Packages []AssistantPackage
	}
}

// AI: provider apa pun yang kompatibel dengan API chat completions OpenAI.
type AI struct {
	Enabled bool
	BaseURL string
	APIKey  string
	// Model editor & cadangannya (dipisah koma bila lebih dari satu): default sebelum owner menyimpan di
	// dashboard (lihat paket aimodels).
	Model, FallbackModel string
	MaxTokens            int
	// ContextWindow: ukuran jendela konteks model (token), pembagi indikator konteks di kotak prompt editor.
	ContextWindow int
	// Antrean: jumlah panggilan ke provider yang boleh berjalan bersamaan, panjang antrean, dan batas tunggu.
	MaxConcurrent int
	QueueMax      int
	QueueTimeout  time.Duration
	// Default jatah prompt gratis per akun per hari; diatur owner di dashboard.
	DailyPrompts int
	// Kredit yang dibeli terpakai per prompt setelah jatah harian habis.
	CreditsPerPrompt int
	// Prompt dengan gambar: model vision mendeskripsikan gambar, lalu model utama membangun.
	VisionModel, VisionFallbackModel string
	ImagePromptCredits               int
	MaxImages                        int
	// Prediksi kode di editor (internal/ai/complete.go): model cepat (kosong = model gambar, lalu model
	// utama) dan batas permintaan gratis per akun per hari (0 = fitur mati).
	CompleteModel      string
	CompleteDailyLimit int
	// Baca Alur Kode (internal/ai/explain.go): gratis, dibatasi permintaan per akun per hari (0 = fitur mati).
	ExplainDailyLimit int
	Agent             Agent
	// Tool uji Builder (internal/ai/lab.go): test_api & search_files, dan check_page bila ada browser.
	Tests   bool // AI_BUILDER_TESTS (default nyala)
	Browser Browser
}

// Browser: Chromium bersama untuk tool check_page Builder (internal/pagecheck).
type Browser struct {
	Path          string // AI_BROWSER: file browser; kosong = cari otomatis (headless shell Playwright, Chrome); "off" = mati
	MaxConcurrent int    // AI_BROWSER_MAX_CONCURRENT: tab yang boleh terbuka bersamaan
	NoSandbox     bool   // AI_BROWSER_NO_SANDBOX=1: wajib bila server menjalankan rakit sebagai root
}

// Agent: mode Agen di editor (internal/ai/agent.go) — Claude Agent SDK mengerjakan prompt di
// container Docker (image deploy/agent, dibangun deploy/agent/build.sh).
type Agent struct {
	Engines       []string      // mesin yang aktif (AI_AGENT_ENGINES, mis. "claude"); kosong = mode Agen mati
	Docker        string        // perintah docker
	ImagePrefix   string        // image = prefix + mesin, mis. rakit-agent-claude
	MaxTokens     int           // batas token (input+output) per prompt; lewat batas, AI dihentikan
	Timeout       time.Duration // batas waktu satu prompt
	MaxConcurrent int           // container agen yang boleh berjalan bersamaan (sisanya menunggu giliran)
	Memory, CPUs  string        // batas sumber daya per container
	// Transport layanan host ke container: "unix" (unix socket, container tanpa jaringan — untuk server Linux)
	// atau "tcp" (127.0.0.1 + host.docker.internal; untuk pengembangan di Docker Desktop, tanpa isolasi jaringan).
	Transport string
	// Local: folder runtime agen tanpa Docker (aplikasi desktop): claude_driver.mjs, cek-halaman.cjs, node_modules,
	// ms-playwright, bin/. Diisi = mesin dijalankan langsung dengan Node (Node: binary node, bawaan "node").
	Local string
	Node  string
	// Command: pengganti docker untuk test (dijalankan lewat sh -c dengan env yang sama, path host).
	Command string
}

type CreditPackage struct {
	ID      string `json:"id"`
	Credits int    `json:"credits"`
	Price   int    `json:"price"`
}

type AssistantPackage struct {
	ID     string `json:"id"`
	Amount int    `json:"amount"`
}

// Billing: pembayaran QRIS lewat Kasera Pay.
type Billing struct {
	Enabled       bool
	APIKey        string
	BaseURL       string
	WebhookSecret string
	Livemode      bool
	Packages      []CreditPackage
}

func envInt(key string, fallback int) int {
	if n, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv(key)), 64); err == nil && n != 0 {
		return int(n)
	}
	return fallback
}

// envIntOr: seperti envInt, tetapi 0 yang ditulis eksplisit tetap dipakai (Number(env ?? fallback) || 0).
func envIntOr(key string, fallback int) int {
	raw, set := os.LookupEnv(key)
	if !set {
		return fallback
	}
	n, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || strings.TrimSpace(raw) == "" {
		return 0
	}
	return int(n)
}

func envDefault(key, fallback string) string {
	if v, set := os.LookupEnv(key); set {
		return v
	}
	return fallback
}

func numbers(entry string) (a, b float64) {
	left, right, _ := strings.Cut(entry, ":")
	a, _ = strconv.ParseFloat(strings.TrimSpace(left), 64)
	b, _ = strconv.ParseFloat(strings.TrimSpace(right), 64)
	return a, b
}

func (c *Config) loadServices() {
	c.AI = AI{
		BaseURL:             strings.TrimRight(os.Getenv("AI_BASE_URL"), "/"),
		APIKey:              os.Getenv("AI_API_KEY"),
		Model:               envOr("AI_MODEL", "deepseek-v4-pro"),
		FallbackModel:       os.Getenv("AI_FALLBACK_MODEL"),
		MaxTokens:           envInt("AI_MAX_TOKENS", 64000),
		ContextWindow:       max(1000, envIntOr("AI_CONTEXT_WINDOW", 128000)),
		MaxConcurrent:       max(1, envInt("AI_MAX_CONCURRENT", 4)),
		QueueMax:            max(0, envIntOr("AI_QUEUE_MAX", 30)),
		QueueTimeout:        time.Duration(max(5, envInt("AI_QUEUE_TIMEOUT_S", 120))) * time.Second,
		DailyPrompts:        max(0, envIntOr("AI_DAILY_PROMPTS", 20)),
		CreditsPerPrompt:    envInt("AI_CREDITS_PER_PROMPT", 1),
		VisionModel:         envDefault("AI_VISION_MODEL", "deepseek-v4.1-flash"),
		VisionFallbackModel: os.Getenv("AI_VISION_FALLBACK_MODEL"),
		ImagePromptCredits:  max(1, envInt("AI_IMAGE_PROMPT_CREDITS", 2)),
		CompleteModel:       os.Getenv("AI_COMPLETE_MODEL"),
		CompleteDailyLimit:  max(0, envIntOr("AI_COMPLETE_DAILY_LIMIT", 500)),
		ExplainDailyLimit:   max(0, envIntOr("AI_EXPLAIN_DAILY_LIMIT", 30)),
		MaxImages:           3,
	}
	c.AI.Agent = Agent{
		Docker:        envOr("AI_AGENT_DOCKER", "docker"),
		ImagePrefix:   envOr("AI_AGENT_IMAGE_PREFIX", "rakit-agent-"),
		MaxTokens:     max(10000, envIntOr("AI_AGENT_MAX_TOKENS", 1500000)),
		Timeout:       time.Duration(max(60, envInt("AI_AGENT_TIMEOUT_S", 900))) * time.Second,
		MaxConcurrent: max(1, envInt("AI_AGENT_MAX_CONCURRENT", 2)),
		Memory:        envOr("AI_AGENT_MEMORY", "1536m"),
		CPUs:          envOr("AI_AGENT_CPUS", "1"),
		Transport:     envOr("AI_AGENT_TRANSPORT", "unix"),
		Command:       os.Getenv("AI_AGENT_CMD"),
		Local:         os.Getenv("AI_AGENT_LOCAL"),
		Node:          envOr("AI_AGENT_NODE", "node"),
	}
	if c.AI.Agent.Local != "" {
		c.AI.Agent.Transport = "tcp" // layanan host di 127.0.0.1, proses agen di mesin yang sama
	}
	c.AI.Tests = os.Getenv("AI_BUILDER_TESTS") != "0" && os.Getenv("AI_BUILDER_TESTS") != "off"
	c.AI.Browser = Browser{
		Path:          os.Getenv("AI_BROWSER"),
		MaxConcurrent: max(1, envInt("AI_BROWSER_MAX_CONCURRENT", 2)),
		NoSandbox:     os.Getenv("AI_BROWSER_NO_SANDBOX") == "1",
	}
	for _, e := range strings.Split(os.Getenv("AI_AGENT_ENGINES"), ",") {
		if e = strings.TrimSpace(strings.ToLower(e)); e != "" && !slices.Contains(c.AI.Agent.Engines, e) {
			c.AI.Agent.Engines = append(c.AI.Agent.Engines, e)
		}
	}
	c.AI.Enabled = c.AI.APIKey != "" && c.AI.BaseURL != ""

	key := os.Getenv("KASERA_API_KEY")
	c.Billing = Billing{
		Enabled:       key != "",
		APIKey:        key,
		BaseURL:       strings.TrimRight(envOr("KASERA_BASE_URL", "https://pay.kasera.id/v1"), "/"),
		WebhookSecret: os.Getenv("KASERA_WEBHOOK_SECRET"),
		Livemode:      strings.HasPrefix(key, "kp_live_"),
		Packages:      []CreditPackage{},
	}
	// Format: "kredit:harga,kredit:harga" (harga dalam rupiah).
	for _, entry := range strings.Split(envOr("CREDIT_PACKAGES", "20:10000,50:20000,150:50000"), ",") {
		if credits, price := numbers(entry); credits > 0 && price > 0 {
			c.Billing.Packages = append(c.Billing.Packages, CreditPackage{ID: "p" + strconv.Itoa(int(credits)), Credits: int(credits), Price: int(price)})
		}
	}
	c.Assistant.Packages = []AssistantPackage{}
	for _, entry := range strings.Split(envOr("ASSISTANT_PACKAGES", "10000,25000,50000"), ",") {
		if n, err := strconv.Atoi(strings.TrimSpace(entry)); err == nil && n >= 1000 {
			c.Assistant.Packages = append(c.Assistant.Packages, AssistantPackage{ID: "asst:" + strconv.Itoa(n), Amount: n})
		}
	}
}

// LoadEnvFile membaca file .env (KEY=VALUE per baris, # untuk komentar). Variabel yang sudah ada di
// environment tidak ditimpa. File yang tidak ada diabaikan, seperti --env-file-if-exists di Node.
func LoadEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		} else if i := strings.Index(value, " #"); i >= 0 {
			value = strings.TrimSpace(value[:i])
		}
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, value)
		}
	}
	return sc.Err()
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func Load() (*Config, error) {
	c := &Config{
		Port:       envOr("PORT", "3000"),
		Protocol:   envOr("PROTOCOL", "http"),
		BaseDomain: strings.ToLower(envOr("BASE_DOMAIN", "localhost")),
	}
	dataDir, err := filepath.Abs(envOr("DATA_DIR", "data"))
	if err != nil {
		return nil, err
	}
	c.DataDir = dataDir
	if c.PublicDir, err = filepath.Abs(envOr("PUBLIC_DIR", "public")); err != nil {
		return nil, err
	}
	if c.TemplateDir, err = filepath.Abs(envOr("TEMPLATE_DIR", "templates/default")); err != nil {
		return nil, err
	}
	c.SiteMinify = os.Getenv("SITE_MINIFY") != "0"
	c.MaxProjects = 20
	if n, convErr := strconv.Atoi(os.Getenv("MAX_PROJECTS")); convErr == nil && n != 0 {
		c.MaxProjects = max(1, n)
	}
	c.Desktop = os.Getenv("DESKTOP") == "1"
	c.DesktopToken = os.Getenv("DESKTOP_TOKEN")
	c.DesktopProxy = c.Desktop && os.Getenv("DESKTOP_PROXY") == "1"
	c.CloudURL = strings.TrimRight(envOr("RAKIT_CLOUD_URL", "https://rakit.io"), "/")
	c.AppVersion = strings.TrimSpace(os.Getenv("APP_VERSION"))
	c.ReleasesRepo = envOr("DESKTOP_RELEASES_REPO", "oktamapangestu/rakit.io")
	c.MaxCustom = 5
	if n, convErr := strconv.Atoi(os.Getenv("MAX_CUSTOM_DOMAINS")); convErr == nil {
		c.MaxCustom = max(0, n)
	}
	c.GoogleClientID = os.Getenv("GOOGLE_CLIENT_ID")
	c.GoogleClientSecret = os.Getenv("GOOGLE_CLIENT_SECRET")
	c.GoogleEnabled = c.GoogleClientID != "" && c.GoogleClientSecret != ""
	c.GoogleTokenURL = envOr("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")
	c.MailAPIURL = envOr("MAIL_API_URL", "https://mail-api.flaz.id/v1/messages")
	c.loadServices()
	c.SecureCookies = c.Protocol == "https"
	for _, e := range strings.Split(os.Getenv("ADMIN_EMAILS"), ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			c.AdminEmails = append(c.AdminEmails, e)
		}
	}

	// Port yang terlihat di URL publik. Di belakang reverse proxy (443) kosongkan saja.
	publicPort, set := os.LookupEnv("PUBLIC_PORT")
	if !set && c.BaseDomain == "localhost" {
		publicPort = c.Port
	}
	if publicPort != "" && publicPort != "80" && publicPort != "443" {
		c.portSuffix = ":" + publicPort
	}
	c.AppOrigin = c.Protocol + "://" + c.BaseDomain + c.portSuffix
	return c, nil
}

// IsAdmin: apakah email ini pemilik platform.
func (c *Config) IsAdmin(email string) bool {
	email = strings.ToLower(email)
	for _, e := range c.AdminEmails {
		if e == email {
			return true
		}
	}
	return false
}

// SiteHost: host website project, mis. budi.rakit.io.
func (c *Config) SiteHost(slug string) string { return slug + "." + c.BaseDomain }

// SiteURL: alamat website project, mis. https://budi.rakit.io.
func (c *Config) SiteURL(slug string) string {
	return c.Protocol + "://" + slug + "." + c.BaseDomain + c.portSuffix
}

// SiteRoot: folder file website project (data/sites/<slug>). Pada project dengan publikasi manual, ini
// versi dev yang diedit di editor.
func (c *Config) SiteRoot(slug string) string { return filepath.Join(c.DataDir, "sites", slug) }

// PublishedRoot: versi prod project dengan publikasi manual (data/published/<slug>), yang tayang di
// <slug>.rakit.io.
func (c *Config) PublishedRoot(slug string) string {
	return filepath.Join(c.DataDir, "published", slug)
}

// DevSuffix: alamat versi dev, mis. toko--dev.rakit.io. Aman: subdomain project tidak boleh memuat "--".
const DevSuffix = "--dev"

// DevURL: alamat versi dev project dengan publikasi manual.
func (c *Config) DevURL(slug string) string { return c.SiteURL(slug + DevSuffix) }
