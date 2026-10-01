// Package auth membaca sesi login dari cookie. Padanan loadUser di src/auth.js; sesi masih dibuat
// dan dihapus oleh Node.
package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"net/http"
	"strings"
	"time"

	"rakit.icu/server/internal/config"
	"rakit.icu/server/internal/store"
)

type Sessions interface {
	SessionUser(tokenHash string, nowMs int64) (*store.User, error)
}

type Auth struct {
	cookieName string
	sessions   Sessions
}

func New(cfg *config.Config, sessions Sessions) *Auth {
	// __Host- mencegah subdomain user (mis. budi.rakit.icu) menimpa cookie sesi rakit.icu.
	name := "rakit_sid"
	if cfg.SecureCookies {
		name = "__Host-rakit_sid"
	}
	return &Auth{cookieName: name, sessions: sessions}
}

// Nilai cookie dibaca apa adanya (tanpa decode), sama seperti di Node.
func readCookie(header, name string) string {
	for _, part := range strings.Split(header, ";") {
		if key, value, ok := strings.Cut(part, "="); ok && strings.TrimSpace(key) == name {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// User mengembalikan akun yang sedang login, atau nil.
func (a *Auth) User(r *http.Request) *store.User {
	token := readCookie(r.Header.Get("Cookie"), a.cookieName)
	if token == "" {
		return nil
	}
	sum := sha256.Sum256([]byte(token))
	user, err := a.sessions.SessionUser(hex.EncodeToString(sum[:]), time.Now().UnixMilli())
	if err != nil {
		log.Printf("auth: membaca sesi: %v", err)
		return nil
	}
	return user
}
