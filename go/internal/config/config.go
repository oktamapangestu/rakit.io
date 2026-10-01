// Package config membaca pengaturan dari environment, dengan nama variabel dan nilai default yang
// sama dengan src/config.js supaya satu file .env dipakai bersama oleh server Node dan Go.
package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Port       string
	Protocol   string
	BaseDomain string
	DataDir    string
	AppOrigin  string // alamat aplikasi utama, mis. https://rakit.icu
	portSuffix string

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

// SiteHost: host website project, mis. budi.rakit.icu.
func (c *Config) SiteHost(slug string) string { return slug + "." + c.BaseDomain }

// SiteRoot: folder file website project (data/sites/<slug>).
func (c *Config) SiteRoot(slug string) string { return filepath.Join(c.DataDir, "sites", slug) }
