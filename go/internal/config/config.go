// Package config membaca pengaturan dari environment, dengan nama variabel dan nilai default yang
// sama dengan src/config.js supaya satu file .env dipakai bersama oleh server Node dan Go.
package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

	// Selama migrasi bertahap: semua request yang belum ditangani Go diteruskan ke server Node ini.
	NodeUpstream string
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
