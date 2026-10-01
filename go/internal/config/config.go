// Package config membaca pengaturan dari environment, dengan nama variabel dan nilai default yang
// sama dengan src/config.js supaya satu file .env dipakai bersama oleh server Node dan Go.
package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port       string
	Protocol   string
	BaseDomain string
	DataDir    string
	AppOrigin  string // alamat aplikasi utama, mis. https://rakit.icu
	PublicDir  string // folder halaman & aset aplikasi (public/)

	SecureCookies bool
	// Email pemilik platform yang boleh membuka dashboard /admin.
	AdminEmails []string
	portSuffix  string

	TemplateDir string // file awal project baru (templates/default)
	MaxProjects int    // jumlah project (subdomain) maksimal per akun

	// Login dengan Google (OAuth client tipe "Web application").
	GoogleEnabled      bool
	GoogleClientID     string
	GoogleClientSecret string
	GoogleTokenURL     string

	AI        AI
	Billing   Billing
	Assistant struct {
		// Paket isi ulang Saldo Asisten (Rupiah).
		Packages []AssistantPackage
	}
	// Default langganan dari .env sebelum owner menyimpan di dashboard.
	PlanPro, PlanUnlimited PlanEnv

	// Selama migrasi bertahap: semua request yang belum ditangani Go diteruskan ke server Node ini.
	NodeUpstream string
}

// AI: provider apa pun yang kompatibel dengan API chat completions OpenAI.
type AI struct {
	Enabled bool
	BaseURL string
	APIKey  string
	// Model editor & cadangannya: default sebelum owner menyimpan di dashboard (lihat paket aimodels).
	Model, FallbackModel string
	MaxTokens            int
	// Antrean: jumlah panggilan ke provider yang boleh berjalan bersamaan, panjang antrean, dan batas tunggu.
	MaxConcurrent int
	QueueMax      int
	QueueTimeout  time.Duration
	// Default kredit gratis per hari & bonus sekali untuk akun baru; diatur owner di dashboard.
	DailyCredits, BonusCredits int
	CreditsPerPrompt           int
	// Prompt dengan gambar: model vision mendeskripsikan gambar, lalu model utama membangun.
	VisionModel, VisionFallbackModel string
	ImagePromptCredits               int
	MaxImages                        int
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

// PlanEnv: "harga:kuota" dari .env.
type PlanEnv struct{ Price, Quota int }

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

func planEnv(value string) PlanEnv {
	price, quota := numbers(value)
	return PlanEnv{Price: int(max(price, 0)), Quota: int(max(quota, 0))}
}

func (c *Config) loadServices() {
	c.AI = AI{
		BaseURL:             strings.TrimRight(os.Getenv("AI_BASE_URL"), "/"),
		APIKey:              os.Getenv("AI_API_KEY"),
		Model:               envOr("AI_MODEL", "deepseek-v4-pro"),
		FallbackModel:       os.Getenv("AI_FALLBACK_MODEL"),
		MaxTokens:           envInt("AI_MAX_TOKENS", 64000),
		MaxConcurrent:       max(1, envInt("AI_MAX_CONCURRENT", 4)),
		QueueMax:            max(0, envIntOr("AI_QUEUE_MAX", 30)),
		QueueTimeout:        time.Duration(max(5, envInt("AI_QUEUE_TIMEOUT_S", 120))) * time.Second,
		DailyCredits:        max(0, envIntOr("AI_DAILY_CREDITS", 3)),
		BonusCredits:        max(0, envIntOr("AI_BONUS_CREDITS", 20)),
		CreditsPerPrompt:    envInt("AI_CREDITS_PER_PROMPT", 1),
		VisionModel:         envDefault("AI_VISION_MODEL", "deepseek-v4.1-flash"),
		VisionFallbackModel: os.Getenv("AI_VISION_FALLBACK_MODEL"),
		ImagePromptCredits:  max(1, envInt("AI_IMAGE_PROMPT_CREDITS", 2)),
		MaxImages:           3,
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
	// Langganan 30 hari. Kosongkan harga (PLAN_PRO=) untuk menyembunyikan paket.
	c.PlanPro = planEnv(envDefault("PLAN_PRO", "49000:300"))             // harga:kredit per 30 hari
	c.PlanUnlimited = planEnv(envDefault("PLAN_UNLIMITED", "149000:60")) // harga:prompt per hari
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
		Port:         envOr("PORT", "3000"),
		Protocol:     envOr("PROTOCOL", "http"),
		BaseDomain:   strings.ToLower(envOr("BASE_DOMAIN", "localhost")),
		NodeUpstream: strings.TrimRight(envOr("NODE_UPSTREAM", "http://127.0.0.1:3010"), "/"),
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
	c.MaxProjects = 5
	if n, convErr := strconv.Atoi(os.Getenv("MAX_PROJECTS")); convErr == nil && n != 0 {
		c.MaxProjects = max(1, n)
	}
	c.GoogleClientID = os.Getenv("GOOGLE_CLIENT_ID")
	c.GoogleClientSecret = os.Getenv("GOOGLE_CLIENT_SECRET")
	c.GoogleEnabled = c.GoogleClientID != "" && c.GoogleClientSecret != ""
	c.GoogleTokenURL = envOr("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token")
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

// SiteHost: host website project, mis. budi.rakit.icu.
func (c *Config) SiteHost(slug string) string { return slug + "." + c.BaseDomain }

// SiteURL: alamat website project, mis. https://budi.rakit.icu.
func (c *Config) SiteURL(slug string) string {
	return c.Protocol + "://" + slug + "." + c.BaseDomain + c.portSuffix
}

// SiteRoot: folder file website project (data/sites/<slug>).
func (c *Config) SiteRoot(slug string) string { return filepath.Join(c.DataDir, "sites", slug) }
