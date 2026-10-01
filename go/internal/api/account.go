package api

import (
	"regexp"
	"strings"

	"rakit.icu/server/internal/accounts"
	"rakit.icu/server/internal/auth"
	"rakit.icu/server/internal/httpx"
	"rakit.icu/server/internal/jsconv"
	"rakit.icu/server/internal/store"
)

var emailRE = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

type publicUser struct {
	Username string `json:"username"`
	Email    string `json:"email"`
}

func (h *Handler) config(q *request) error {
	if !q.is("GET") {
		return errNotFound
	}
	return q.json(200, map[string]any{
		"baseDomain":     h.cfg.BaseDomain,
		"siteUrlPattern": h.cfg.SiteURL("{username}"),
		"googleEnabled":  h.cfg.GoogleEnabled,
	})
}

func (h *Handler) register(q *request) error {
	if !q.is("POST") {
		return errNotFound
	}
	if !h.authLimiter.Allow(q.w, httpx.ClientIP(q.r)) {
		return nil
	}
	if err := q.load(); err != nil {
		return err
	}
	username := strings.ToLower(strings.TrimSpace(q.text("username")))
	email := strings.ToLower(strings.TrimSpace(q.text("email")))
	password := q.text("password")

	if msg := accounts.UsernameError(username); msg != "" {
		return httpx.Errorf(400, "%s", msg)
	}
	if !emailRE.MatchString(email) || jsconv.Len(email) > 254 {
		return httpx.Errorf(400, "Email tidak valid")
	}
	if n := jsconv.Len(password); n < 8 || n > 200 {
		return httpx.Errorf(400, "Password minimal 8 karakter")
	}
	// Project pertama memakai username sebagai subdomain, jadi keduanya harus belum dipakai.
	if taken, err := h.accounts().SlugTaken(username); err != nil {
		return err
	} else if taken {
		return httpx.Errorf(409, "Username sudah dipakai")
	}
	if existing, err := h.db.UserByEmail(email); err != nil {
		return err
	} else if existing != nil {
		return httpx.Errorf(409, "Email sudah terdaftar")
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	id, err := h.db.InsertUser(username, email, hash)
	if err != nil {
		if store.IsUnique(err) {
			return httpx.Errorf(409, "Username atau email sudah dipakai")
		}
		return err
	}
	user := &store.User{ID: id, Username: username, Email: email}
	if _, err := h.accounts().CreateProject(user, username, username); err != nil {
		return err
	}
	if err := h.auth.Login(q.w, id); err != nil {
		return err
	}
	return q.json(201, map[string]any{"user": publicUser{username, email}})
}

func (h *Handler) login(q *request) error {
	if !q.is("POST") {
		return errNotFound
	}
	if !h.authLimiter.Allow(q.w, httpx.ClientIP(q.r)) {
		return nil
	}
	if err := q.load(); err != nil {
		return err
	}
	login := strings.ToLower(strings.TrimSpace(q.text("login")))
	password := q.text("password")
	var user *store.User
	if login != "" {
		var err error
		if user, err = h.db.UserByLogin(login); err != nil {
			return err
		}
	}
	if user != nil && user.PasswordHash == "" {
		return httpx.Errorf(400, `Akun ini dibuat dengan Google. Silakan masuk dengan tombol "Lanjutkan dengan Google".`)
	}
	stored := h.dummyHash
	if user != nil {
		stored = user.PasswordHash
	}
	if ok := auth.VerifyPassword(password, stored); user == nil || !ok {
		return httpx.Errorf(401, "Username/email atau password salah")
	}
	if err := h.auth.Login(q.w, user.ID); err != nil {
		return err
	}
	return q.json(200, map[string]any{"user": publicUser{user.Username, user.Email}})
}

func (h *Handler) logout(q *request) error {
	if !q.is("POST") {
		return errNotFound
	}
	h.auth.Logout(q.w, q.user)
	return q.json(200, map[string]bool{"ok": true})
}

// me: akun + project aktif (dari header X-Project) + daftar semua project milik akun.
func (h *Handler) me(q *request) error {
	if !q.is("GET") {
		return errNotFound
	}
	if err := h.requireAuth(q); err != nil {
		return err
	}
	project, err := h.loadProject(q)
	if err != nil {
		return err
	}
	all, err := h.db.ProjectsOf(q.user.ID)
	if err != nil {
		return err
	}
	return q.json(200, map[string]any{
		"user": struct {
			publicUser
			IsAdmin bool `json:"isAdmin"`
		}{publicUser{q.user.Username, q.user.Email}, h.cfg.IsAdmin(q.user.Email)},
		"project":     h.public(project),
		"projects":    h.publicAll(all),
		"maxProjects": h.cfg.MaxProjects,
	})
}

func (h *Handler) accounts() *accounts.Service { return accounts.New(h.cfg, h.db) }

// ---------- /api/projects ----------

func (h *Handler) ownedProject(q *request) (*store.Project, error) {
	p, err := h.db.ProjectBySlug(strings.ToLower(q.rest[0]))
	if err != nil {
		return nil, err
	}
	if p == nil || p.UserID != q.user.ID {
		return nil, httpx.Errorf(404, "Project tidak ditemukan")
	}
	return p, nil
}

func (h *Handler) projects(q *request) error {
	if err := h.requireAuth(q); err != nil {
		return err
	}
	switch {
	case q.is("GET"):
		all, err := h.db.ProjectsOf(q.user.ID)
		if err != nil {
			return err
		}
		return q.json(200, map[string]any{"projects": h.publicAll(all), "limit": h.cfg.MaxProjects})

	case q.is("POST"):
		if err := q.load(); err != nil {
			return err
		}
		project, err := h.accounts().CreateProject(q.user, q.text("slug"), q.text("name"))
		if err != nil {
			return err
		}
		return q.json(201, map[string]any{"project": h.public(project)})

	case q.is("PATCH", ":"):
		project, err := h.ownedProject(q)
		if err != nil {
			return err
		}
		if err := q.load(); err != nil {
			return err
		}
		name := jsconv.Slice(strings.TrimSpace(q.text("name")), 60)
		if name == "" {
			return httpx.Errorf(400, "Nama project tidak boleh kosong")
		}
		if err := h.db.RenameProject(project.ID, name); err != nil {
			return err
		}
		project.Name = name
		return q.json(200, map[string]any{"project": h.public(project)})

	case q.is("DELETE", ":"):
		project, err := h.ownedProject(q)
		if err != nil {
			return err
		}
		all, err := h.db.ProjectsOf(q.user.ID)
		if err != nil {
			return err
		}
		if len(all) <= 1 {
			return httpx.Errorf(409, "Project terakhir tidak bisa dihapus")
		}
		if busy, err := h.db.ActiveJobIn(project.ID); err != nil {
			return err
		} else if busy {
			return httpx.Errorf(409, "AI sedang bekerja di project ini. Tunggu selesai atau tekan Stop.")
		}
		// Riwayat AI & versi project ikut terhapus (ON DELETE CASCADE).
		if err := h.db.DeleteProject(project.ID); err != nil {
			return err
		}
		h.userdb.Remove(project.Slug)
		if err := removeAll(h.cfg.SiteRoot(project.Slug)); err != nil {
			return err
		}
		if err := h.versions.Remove(project.Slug); err != nil {
			return err
		}
		return q.json(200, map[string]bool{"ok": true})
	}
	return errNotFound
}
