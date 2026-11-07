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
	"sync"
	"time"

	"golang.org/x/crypto/scrypt"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/store"
)

const (
	sessionTTL = 30 * 24 * time.Hour
	// touchEvery: users.last_seen_at ditulis paling sering sekali per jangka ini per akun.
	touchEvery = 5 * time.Minute
)

type Sessions interface {
	SessionUser(tokenHash string, nowMs int64) (*store.User, error)
	InsertSession(tokenHash string, userID, expiresAt int64) error
	DeleteSession(tokenHash string) error
	TouchUser(userID, nowMs int64) error
}

type Auth struct {
	cookieName string
	secure     bool
	sessions   Sessions

	mu      sync.Mutex
	touched map[int64]time.Time // kapan last_seen_at akun terakhir ditulis
}

func New(cfg *config.Config, sessions Sessions) *Auth {
	// __Host- mencegah subdomain user (mis. budi.rakit.io) menimpa cookie sesi rakit.io.
	name := "rakit_sid"
	if cfg.SecureCookies {
		name = "__Host-rakit_sid"
	}
	return &Auth{cookieName: name, secure: cfg.SecureCookies, sessions: sessions, touched: map[int64]time.Time{}}
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

// NewToken: token acak untuk dikirim ke pengguna (cookie sesi, link lupa password) beserta hash yang
// disimpan di database.
func NewToken() (token, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, sha256Hex(token), nil
}

// HashToken: hash token seperti yang disimpan di database.
func HashToken(token string) string { return sha256Hex(token) }

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
	if user != nil {
		a.touch(user.ID, false)
	}
	return user
}

// touch mencatat akun sedang aktif (users.last_seen_at); force = tulis sekarang juga (saat login).
func (a *Auth) touch(userID int64, force bool) {
	now := time.Now()
	a.mu.Lock()
	if !force && now.Sub(a.touched[userID]) < touchEvery {
		a.mu.Unlock()
		return
	}
	a.touched[userID] = now
	if len(a.touched) > 10000 { // buang catatan lama supaya map tidak terus membesar
		for id, at := range a.touched {
			if now.Sub(at) >= touchEvery {
				delete(a.touched, id)
			}
		}
	}
	a.mu.Unlock()
	if err := a.sessions.TouchUser(userID, now.UnixMilli()); err != nil {
		log.Printf("auth: mencatat waktu aktif: %v", err)
	}
}

// cookie: tanpa Domain, jadi tidak dikirim ke *.rakit.io.
func (a *Auth) cookie(value string) *http.Cookie {
	return &http.Cookie{Name: a.cookieName, Value: value, Path: "/", HttpOnly: true, Secure: a.secure, SameSite: http.SameSiteLaxMode}
}

// Login membuat sesi baru untuk akun dan memasang cookie-nya.
func (a *Auth) Login(w http.ResponseWriter, userID int64) error {
	token, hash, err := NewToken()
	if err != nil {
		return err
	}
	expires := time.Now().Add(sessionTTL)
	if err := a.sessions.InsertSession(hash, userID, expires.UnixMilli()); err != nil {
		return err
	}
	a.touch(userID, true)
	c := a.cookie(token)
	c.MaxAge = int(sessionTTL.Seconds())
	c.Expires = expires
	http.SetCookie(w, c)
	return nil
}

// DeviceTTL: umur token aplikasi desktop (login lewat browser, lihat internal/api/sync.go).
const DeviceTTL = 365 * 24 * time.Hour

// IssueToken membuat sesi tanpa cookie untuk aplikasi desktop; tokennya dikirim lewat header
// Authorization: Bearer <token>.
func (a *Auth) IssueToken(userID int64) (string, error) {
	token, hash, err := NewToken()
	if err != nil {
		return "", err
	}
	if err := a.sessions.InsertSession(hash, userID, time.Now().Add(DeviceTTL).UnixMilli()); err != nil {
		return "", err
	}
	a.touch(userID, true)
	return token, nil
}

// BearerToken: token dari header Authorization: Bearer, atau "".
func BearerToken(r *http.Request) string {
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

// BearerUser: pemilik token aplikasi desktop di header Authorization, atau nil.
func (a *Auth) BearerUser(r *http.Request) *store.User {
	token := BearerToken(r)
	if token == "" {
		return nil
	}
	user, err := a.sessions.SessionUser(sha256Hex(token), time.Now().UnixMilli())
	if err != nil {
		log.Printf("auth: membaca token: %v", err)
		return nil
	}
	if user != nil {
		a.touch(user.ID, false)
	}
	return user
}

// Revoke menghapus sesi/token milik user (yang didapat dari User atau BearerUser).
func (a *Auth) Revoke(user *store.User) {
	if user != nil && user.TokenHash != "" {
		if err := a.sessions.DeleteSession(user.TokenHash); err != nil {
			log.Printf("auth: menghapus sesi: %v", err)
		}
	}
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
