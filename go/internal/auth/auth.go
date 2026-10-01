// Package auth: sesi login (cookie) dan password. Padanan src/auth.js.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"log"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/store"
)

const sessionTTL = 30 * 24 * time.Hour

type Sessions interface {
	SessionUser(tokenHash string, nowMs int64) (*store.User, error)
	InsertSession(tokenHash string, userID, expiresAt int64) error
	DeleteSession(tokenHash string) error
}

type Auth struct {
	cookieName string
	secure     bool
	sessions   Sessions
}

func New(cfg *config.Config, sessions Sessions) *Auth {
	// __Host- mencegah subdomain user (mis. budi.rakit.io) menimpa cookie sesi rakit.io.
	name := "rakit_sid"
	if cfg.SecureCookies {
		name = "__Host-rakit_sid"
	}
	return &Auth{cookieName: name, secure: cfg.SecureCookies, sessions: sessions}
}

// ReadCookie membaca nilai cookie apa adanya (tanpa decode), sama seperti di Node.
func ReadCookie(r *http.Request, name string) string {
	for _, part := range strings.Split(r.Header.Get("Cookie"), ";") {
		if key, value, ok := strings.Cut(part, "="); ok && strings.TrimSpace(key) == name {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// User mengembalikan akun yang sedang login, atau nil.
func (a *Auth) User(r *http.Request) *store.User {
	token := ReadCookie(r, a.cookieName)
	if token == "" {
		return nil
	}
	user, err := a.sessions.SessionUser(sha256Hex(token), time.Now().UnixMilli())
	if err != nil {
		log.Printf("auth: membaca sesi: %v", err)
		return nil
	}
	return user
}

// cookie: tanpa Domain, jadi tidak dikirim ke *.rakit.io.
func (a *Auth) cookie(value string) *http.Cookie {
	return &http.Cookie{Name: a.cookieName, Value: value, Path: "/", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode}
}

// Login membuat sesi baru untuk akun dan memasang cookie-nya.
func (a *Auth) Login(w http.ResponseWriter, userID int64) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	expires := time.Now().Add(sessionTTL)
	if err := a.sessions.InsertSession(sha256Hex(token), userID, expires.UnixMilli()); err != nil {
		return err
	}
	c := a.cookie(token)
	c.MaxAge = int(sessionTTL.Seconds())
	c.Expires = expires
	http.SetCookie(w, c)
	return nil
}

// Logout menghapus sesi (bila ada) dan cookie-nya.
func (a *Auth) Logout(w http.ResponseWriter, user *store.User) {
	if user != nil && user.TokenHash != "" {
		if err := a.sessions.DeleteSession(user.TokenHash); err != nil {
			log.Printf("auth: menghapus sesi: %v", err)
		}
	}
	c := a.cookie("")
	c.MaxAge = -1
	c.Expires = time.Unix(0, 0)
	http.SetCookie(w, c)
}

// ---------- Password ----------
// Format tersimpan: scrypt$<salt hex>$<kunci hex>, parameter bawaan Node (N=16384, r=8, p=1).

func scryptKey(password string, salt []byte, size int) ([]byte, error) {
	return scrypt.Key([]byte(password), salt, 16384, 8, 1, size)
}

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := scryptKey(password, salt, 64)
	if err != nil {
		return "", err
	}
	return "scrypt$" + hex.EncodeToString(salt) + "$" + hex.EncodeToString(key), nil
}

func VerifyPassword(password, stored string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 3 {
		return false
	}
	salt, err1 := hex.DecodeString(parts[1])
	expected, err2 := hex.DecodeString(parts[2])
	if err1 != nil || err2 != nil || len(expected) == 0 {
		return false
	}
	key, err := scryptKey(password, salt, len(expected))
	return err == nil && subtle.ConstantTimeCompare(key, expected) == 1
}
