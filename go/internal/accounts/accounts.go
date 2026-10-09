// Package accounts: aturan username/subdomain dan pembuatan project. Dipakai pendaftaran biasa,
// login Google, dan API project. Padanan src/username.js dan createProject di src/projects.js.
package accounts

import (
	"os"
	"regexp"
	"strings"

	"rakit.io/server/internal/config"
	"rakit.io/server/internal/files"
	"rakit.io/server/internal/httpx"
	"rakit.io/server/internal/i18n"
	"rakit.io/server/internal/jsconv"
	"rakit.io/server/internal/store"
)

// Username = subdomain, jadi harus valid sebagai label DNS.
var UsernameRE = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`)

var reserved = func() map[string]bool {
	out := map[string]bool{}
	for _, name := range strings.Fields(`
		www app api admin administrator root rakit editor dashboard
		login register signup signin logout account settings billing
		mail email smtp imap pop pop3 ftp ssh ns ns1 ns2 dns
		static assets cdn media img files upload uploads
		blog docs help support status about contact security
		dev test staging preview demo internal localhost`) {
		out[name] = true
	}
	return out
}()

// UsernameError mengembalikan alasan username tidak valid, atau "".
func UsernameError(username string) string {
	if n := jsconv.Len(username); n < 3 || n > 30 {
		return "Username harus 3–30 karakter"
	}
	if !UsernameRE.MatchString(username) {
		return "Username hanya boleh huruf kecil, angka, dan tanda -, tidak diawali/diakhiri -"
	}
	if strings.Contains(username, "--") {
		return `Username tidak boleh mengandung "--"`
	}
	if reserved[username] {
		return "Username ini tidak tersedia"
	}
	return ""
}

// SlugError: sama, dengan kata "Subdomain".
func SlugError(slug string) string {
	msg := UsernameError(slug)
	msg = strings.Replace(msg, "Username ini", "Subdomain ini", 1)
	return strings.Replace(msg, "Username", "Subdomain", 1)
}

type Service struct {
	cfg *config.Config
	db  *store.Store
}

func New(cfg *config.Config, db *store.Store) *Service { return &Service{cfg: cfg, db: db} }

// SlugTaken: subdomain sudah dipakai project atau username seseorang.
func (s *Service) SlugTaken(slug string) (bool, error) {
	if p, err := s.db.ProjectBySlug(slug); err != nil || p != nil {
		return p != nil, err
	}
	u, err := s.db.UserByUsername(slug)
	return u != nil, err
}

// CreateProject membuat project baru beserta file awalnya (berbahasa lang).
func (s *Service) CreateProject(user *store.User, rawSlug, name, lang string) (*store.Project, error) {
	slug := strings.ToLower(strings.TrimSpace(rawSlug))
	if msg := SlugError(slug); msg != "" {
		return nil, httpx.Errorf(400, "%s", msg)
	}
	owned, err := s.db.ProjectsOf(user.ID)
	if err != nil {
		return nil, err
	}
	if len(owned) >= s.cfg.MaxProjects {
		return nil, httpx.Errorf(403, "Maksimal %d project per akun. Hapus project lama untuk membuat yang baru.", s.cfg.MaxProjects)
	}
	taken := httpx.Errorf(409, "%s sudah dipakai", s.cfg.SiteHost(slug))
	// Username orang lain juga dicadangkan, karena project pertama tiap akun memakai username-nya.
	if p, err := s.db.ProjectBySlug(slug); err != nil {
		return nil, err
	} else if p != nil {
		return nil, taken
	}
	if u, err := s.db.UserByUsername(slug); err != nil {
		return nil, err
	} else if u != nil && u.ID != user.ID {
		return nil, taken
	}
	title := jsconv.Slice(strings.TrimSpace(name), 60)
	if title == "" {
		title = slug
	}
	if err := s.db.InsertProject(user.ID, slug, title); err != nil {
		if store.IsUnique(err) {
			return nil, taken
		}
		return nil, err
	}
	if err := files.SeedTemplate(s.cfg.SiteRoot(slug), s.templateDir(lang), slug, s.cfg.SiteHost(slug)); err != nil {
		return nil, err
	}
	return s.db.ProjectBySlug(slug)
}

// templateDir: file awal project. Pengguna versi Inggris mendapat <TEMPLATE_DIR>-en (mis. templates/default-en)
// bila foldernya ada.
func (s *Service) templateDir(lang string) string {
	if lang == i18n.EN {
		if info, err := os.Stat(s.cfg.TemplateDir + "-en"); err == nil && info.IsDir() {
			return s.cfg.TemplateDir + "-en"
		}
	}
	return s.cfg.TemplateDir
}
