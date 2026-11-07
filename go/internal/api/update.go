package api

// /api/desktop: hanya di aplikasi desktop. Memeriksa apakah ada versi aplikasi yang lebih baru di GitHub Releases
// (dibuat .github/workflows/desktop.yml) dan membuka halaman unduhannya di browser bawaan komputer.
//
// Versi yang terpasang dikirim aplikasi Tauri lewat env APP_VERSION; repo rilis: DESKTOP_RELEASES_REPO.

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"rakit.io/server/internal/httpx"
)

const updateCacheTTL = 6 * time.Hour

type updateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest,omitempty"`
	URL       string `json:"url,omitempty"`
	Available bool   `json:"available"`
}

type updateCache struct {
	mu      sync.Mutex
	at      time.Time
	latest  string
	url     string
	checked bool
}

var updates updateCache

// newerVersion: a lebih baru dari b (angka per bagian, mis. 0.1.12 > 0.1.9). Bagian yang bukan angka dianggap 0.
func newerVersion(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < max(len(pa), len(pb)); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x > y
		}
	}
	return false
}

// latestRelease: release terbaru (bukan draft/prerelease) di GitHub, di-cache beberapa jam. force = abaikan cache.
func (h *Handler) latestRelease(ctx context.Context, force bool) (version, url string, err error) {
	updates.mu.Lock()
	defer updates.mu.Unlock()
	if updates.checked && !force && time.Since(updates.at) < updateCacheTTL {
		return updates.latest, updates.url, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/"+h.cfg.ReleasesRepo+"/releases/latest", nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "rakit-desktop")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", httpx.Errorf(502, "Tidak bisa memeriksa update. Periksa koneksi internet.")
	}
	defer res.Body.Close()
	if res.StatusCode == 404 { // belum ada rilis
		updates.checked, updates.at, updates.latest, updates.url = true, time.Now(), "", ""
		return "", "", nil
	}
	if res.StatusCode != 200 {
		return "", "", httpx.Errorf(502, "Tidak bisa memeriksa update. Periksa koneksi internet.")
	}
	var out struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", "", httpx.Errorf(502, "Tidak bisa memeriksa update. Periksa koneksi internet.")
	}
	// Tag rilis desktop: desktop-v0.1.12 (atau v0.1.12).
	v := strings.TrimPrefix(strings.TrimPrefix(out.TagName, "desktop-"), "v")
	updates.checked, updates.at, updates.latest, updates.url = true, time.Now(), v, out.HTMLURL
	return v, out.HTMLURL, nil
}

func (h *Handler) releasesPage() string { return "https://github.com/" + h.cfg.ReleasesRepo + "/releases" }

func (h *Handler) desktopRoutes(q *request) error {
	if !h.cfg.Desktop {
		return errNotFound
	}
	if err := h.requireAuth(q); err != nil {
		return err
	}
	switch {
	case q.is("GET", "update"):
		info := updateInfo{Current: h.cfg.AppVersion}
		if h.cfg.AppVersion == "" { // dijalankan tanpa aplikasi Tauri (pengembangan)
			return q.json(200, info)
		}
		_, force := q.param("force")
		latest, url, err := h.latestRelease(q.r.Context(), force)
		if err != nil {
			return err
		}
		info.Latest, info.URL = latest, url
		info.Available = latest != "" && newerVersion(latest, h.cfg.AppVersion)
		return q.json(200, info)
	case q.is("POST", "open"):
		// Hanya halaman rilis aplikasi ini yang boleh dibuka dari editor.
		if err := q.load(); err != nil {
			return err
		}
		u := q.text("url")
		if u != h.releasesPage() && !strings.HasPrefix(u, h.releasesPage()+"/") {
			return httpx.Errorf(400, "Alamat tidak valid")
		}
		openBrowser(u)
		return q.json(200, map[string]bool{"ok": true})
	}
	return errNotFound
}
