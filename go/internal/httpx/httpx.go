// Package httpx: perkakas HTTP bersama — error berstatus, jawaban JSON, IP pengunjung, dan pembatas laju.
package httpx

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/i18n"
)

// Error adalah kesalahan yang pesannya boleh ditampilkan ke pengguna (padanan HttpError di Node).
type Error struct {
	Status  int
	Message string
	Code    string // kode singkat untuk klien (opsional), mis. "no_credits"
}

func (e *Error) Error() string { return e.Message }

func Errorf(status int, format string, args ...any) *Error {
	return &Error{Status: status, Message: fmt.Sprintf(format, args...)}
}

// JSON menulis jawaban JSON tanpa meng-escape <, >, & (sama seperti JSON.stringify).
func JSON(w http.ResponseWriter, status int, v any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		log.Printf("httpx: encode JSON: %v", err)
		status, buf = http.StatusInternalServerError, *bytes.NewBufferString(`{"error":"Terjadi kesalahan di server"}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	w.Write(bytes.TrimRight(buf.Bytes(), "\n"))
}

// Fail menjawab dengan { "error": pesan }, diterjemahkan ke bahasa pengguna (lihat i18n.Mark). Kesalahan yang
// bukan *Error dicatat dan dijawab 500.
func Fail(w http.ResponseWriter, err error) {
	var he *Error
	if errors.As(err, &he) {
		body := map[string]string{"error": i18n.T(i18n.Of(w), he.Message)}
		if he.Code != "" {
			body["code"] = he.Code
		}
		JSON(w, he.Status, body)
		return
	}
	log.Printf("error: %v", err)
	JSON(w, http.StatusInternalServerError, map[string]string{"error": i18n.T(i18n.Of(w), "Terjadi kesalahan di server")})
}

// ClientIP: IP pengunjung. Proxy di loopback (Nginx di mesin yang sama) dipercaya, jadi alamat
// diambil dari X-Forwarded-For — sama dengan `trust proxy: loopback` di Express.
func ClientIP(r *http.Request) string {
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remote = r.RemoteAddr
	}
	chain := []string{}
	for _, part := range strings.Split(r.Header.Get("X-Forwarded-For"), ",") {
		if part = strings.TrimSpace(part); part != "" {
			chain = append(chain, part)
		}
	}
	chain = append(chain, remote)
	for i := len(chain) - 1; i > 0; i-- {
		if ip := net.ParseIP(chain[i]); ip == nil || !ip.IsLoopback() {
			return chain[i]
		}
	}
	return chain[0]
}

// RateLimiter: jendela tetap per kunci, di memori (cukup untuk satu proses server).
type RateLimiter struct {
	window  time.Duration
	max     int
	message string

	mu   sync.Mutex
	hits map[string]*hit
}

type hit struct {
	count int
	reset time.Time
}

func NewRateLimiter(window time.Duration, max int, message string) *RateLimiter {
	if message == "" {
		message = "Terlalu banyak percobaan. Coba lagi nanti."
	}
	l := &RateLimiter{window: window, max: max, message: message, hits: map[string]*hit{}}
	go func() {
		for range time.Tick(window) {
			now := time.Now()
			l.mu.Lock()
			for key, h := range l.hits {
				if !h.reset.After(now) {
					delete(l.hits, key)
				}
			}
			l.mu.Unlock()
		}
	}()
	return l
}

// Allow mencatat satu request. Bila jatah habis, menjawab 429 dan mengembalikan false.
func (l *RateLimiter) Allow(w http.ResponseWriter, key string) bool {
	now := time.Now()
	l.mu.Lock()
	h := l.hits[key]
	if h == nil || !h.reset.After(now) {
		h = &hit{reset: now.Add(l.window)}
		l.hits[key] = h
	}
	h.count++
	over, wait := h.count > l.max, h.reset.Sub(now)
	l.mu.Unlock()
	if !over {
		return true
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
	JSON(w, http.StatusTooManyRequests, map[string]string{"error": i18n.T(i18n.Of(w), l.message)})
	return false
}
