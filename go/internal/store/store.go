// Package store membuka database utama (data/rakit.db) yang dipakai bersama dengan server Node.
// Selama migrasi, skema dibuat dan dimigrasikan oleh Node (src/db.js); Go hanya memakainya.
package store

import (
	"database/sql"
	"errors"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(dataDir string) (*Store, error) {
	// WAL: Node dan Go boleh membuka file yang sama bersamaan. busy_timeout: tunggu sebentar bila
	// proses lain sedang menulis, daripada langsung gagal. foreign_keys: ON DELETE CASCADE berlaku.
	q := url.Values{}
	q.Add("_pragma", "busy_timeout(5000)")
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "foreign_keys(1)")
	dsn := "file:" + filepath.ToSlash(filepath.Join(dataDir, "rakit.db")) + "?" + q.Encode()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func now() int64 { return time.Now().UnixMilli() }

// IsUnique: kesalahan karena melanggar batasan UNIQUE.
func IsUnique(err error) bool { return err != nil && strings.Contains(err.Error(), "UNIQUE") }

func oneOrNil[T any](v *T, err error) (*T, error) {
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return v, nil
}

// ---------- Akun & sesi ----------

// User: akun. TokenHash hanya terisi bila diambil lewat sesi.
type User struct {
	ID           int64
	Username     string
	Email        string
	PasswordHash string
	TokenHash    string
}

// SessionUser mengembalikan pemilik sesi yang masih berlaku, atau nil.
func (s *Store) SessionUser(tokenHash string, nowMs int64) (*User, error) {
	var u User
	err := s.db.QueryRow(`
		SELECT u.id, u.username, u.email, s.token_hash
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, tokenHash, nowMs).Scan(&u.ID, &u.Username, &u.Email, &u.TokenHash)
	return oneOrNil(&u, err)
}

func (s *Store) InsertSession(tokenHash string, userID, expiresAt int64) error {
	_, err := s.db.Exec("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", tokenHash, userID, expiresAt)
	return err
}

func (s *Store) DeleteSession(tokenHash string) error {
	_, err := s.db.Exec("DELETE FROM sessions WHERE token_hash = ?", tokenHash)
	return err
}

func (s *Store) userWhere(where string, args ...any) (*User, error) {
	var u User
	err := s.db.QueryRow("SELECT id, username, email, password_hash FROM users WHERE "+where, args...).
		Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash)
	return oneOrNil(&u, err)
}

func (s *Store) UserByUsername(username string) (*User, error) {
	return s.userWhere("username = ?", username)
}

func (s *Store) UserByEmail(email string) (*User, error) { return s.userWhere("email = ?", email) }

func (s *Store) UserByLogin(login string) (*User, error) {
	return s.userWhere("username = ? OR email = ?", login, login)
}

func (s *Store) UserByGoogle(googleID string) (*User, error) {
	return s.userWhere("google_id = ?", googleID)
}

// InsertUser menambah akun dan mengembalikan id-nya. passwordHash kosong = hanya bisa masuk lewat Google.
func (s *Store) InsertUser(username, email, passwordHash string) (int64, error) {
	res, err := s.db.Exec("INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)", username, email, passwordHash, now())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) LinkGoogle(googleID string, userID int64) error {
	_, err := s.db.Exec("UPDATE users SET google_id = ? WHERE id = ?", googleID, userID)
	return err
}

// ---------- Project ----------

// Project = workspace dengan subdomain sendiri: <slug>.rakit.icu.
type Project struct {
	ID        int64
	UserID    int64
	Slug      string
	Name      string
	CreatedAt int64
}

func scanProject(row interface{ Scan(...any) error }) (*Project, error) {
	var p Project
	return oneOrNil(&p, row.Scan(&p.ID, &p.UserID, &p.Slug, &p.Name, &p.CreatedAt))
}

const projectColumns = "id, user_id, slug, name, created_at"

func (s *Store) ProjectBySlug(slug string) (*Project, error) {
	return scanProject(s.db.QueryRow("SELECT "+projectColumns+" FROM projects WHERE slug = ?", slug))
}

// ProjectExists: apakah ada project dengan subdomain ini.
func (s *Store) ProjectExists(slug string) (bool, error) {
	p, err := s.ProjectBySlug(slug)
	return p != nil, err
}

// ProjectsOf: semua project milik akun, yang pertama dibuat lebih dulu.
func (s *Store) ProjectsOf(userID int64) ([]*Project, error) {
	rows, err := s.db.Query("SELECT "+projectColumns+" FROM projects WHERE user_id = ? ORDER BY created_at, id", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Project{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) InsertProject(userID int64, slug, name string) error {
	_, err := s.db.Exec("INSERT INTO projects (user_id, slug, name, created_at) VALUES (?, ?, ?, ?)", userID, slug, name, now())
	return err
}

func (s *Store) RenameProject(id int64, name string) error {
	_, err := s.db.Exec("UPDATE projects SET name = ? WHERE id = ?", name, id)
	return err
}

// DeleteProject menghapus project; riwayat AI dan versinya ikut terhapus (ON DELETE CASCADE).
func (s *Store) DeleteProject(id int64) error {
	_, err := s.db.Exec("DELETE FROM projects WHERE id = ?", id)
	return err
}

// ActiveJobIn: apakah AI sedang bekerja di project ini.
func (s *Store) ActiveJobIn(projectID int64) (bool, error) {
	var one int
	err := s.db.QueryRow(`
		SELECT 1 FROM ai_messages m JOIN ai_threads t ON t.id = m.thread_id
		WHERE t.project_id = ? AND m.role = 'assistant' AND m.status IN ('queued', 'running') LIMIT 1`, projectID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// ---------- Langganan ----------

// ActivePlanOfProject: id paket langganan pemilik project yang masih berlaku, atau "".
func (s *Store) ActivePlanOfProject(slug string) (string, error) {
	var plan string
	err := s.db.QueryRow(`
		SELECT sub.plan FROM projects p JOIN subscriptions sub ON sub.user_id = p.user_id
		WHERE p.slug = ? AND sub.expires_at > ?`, slug, now()).Scan(&plan)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return plan, err
}

// ActivePlanOfUser: id paket langganan akun yang masih berlaku, atau "".
func (s *Store) ActivePlanOfUser(userID int64) (string, error) {
	var plan string
	err := s.db.QueryRow("SELECT plan FROM subscriptions WHERE user_id = ? AND expires_at > ?", userID, now()).Scan(&plan)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return plan, err
}

// ---------- Riwayat versi ----------

// Version: satu versi project. Manifest = JSON { files: {path: {h, s, m}}, dirs: [...] }.
type Version struct {
	ID        int64
	Kind      string
	Label     string
	Manifest  string
	FileCount int64
	CreatedAt int64
}

const versionColumns = "id, kind, label, manifest, file_count, created_at"

func scanVersion(row interface{ Scan(...any) error }) (*Version, error) {
	var v Version
	return oneOrNil(&v, row.Scan(&v.ID, &v.Kind, &v.Label, &v.Manifest, &v.FileCount, &v.CreatedAt))
}

func (s *Store) LatestVersion(projectID int64) (*Version, error) {
	return scanVersion(s.db.QueryRow("SELECT "+versionColumns+" FROM versions WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", projectID))
}

func (s *Store) VersionByID(id, projectID int64) (*Version, error) {
	return scanVersion(s.db.QueryRow("SELECT "+versionColumns+" FROM versions WHERE id = ? AND project_id = ?", id, projectID))
}

// Versions: semua versi project, terbaru dulu.
func (s *Store) Versions(projectID int64) ([]*Version, error) {
	rows, err := s.db.Query("SELECT "+versionColumns+" FROM versions WHERE project_id = ? ORDER BY created_at DESC, id DESC", projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Version{}
	for rows.Next() {
		v, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) InsertVersion(projectID, userID int64, kind, label, manifest string, fileCount int) (int64, error) {
	res, err := s.db.Exec(`
		INSERT INTO versions (project_id, user_id, kind, label, manifest, file_count, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, projectID, userID, kind, label, manifest, fileCount, now())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// PruneVersions menghapus versi yang lebih tua dari `before` dan yang melebihi `max` terbaru.
// Mengembalikan jumlah versi yang terhapus.
func (s *Store) PruneVersions(projectID, before int64, max int) (int64, error) {
	old, err := s.db.Exec("DELETE FROM versions WHERE project_id = ? AND created_at < ?", projectID, before)
	if err != nil {
		return 0, err
	}
	extra, err := s.db.Exec(`
		DELETE FROM versions WHERE project_id = ? AND id NOT IN (
			SELECT id FROM versions WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
		)`, projectID, projectID, max)
	if err != nil {
		return 0, err
	}
	a, _ := old.RowsAffected()
	b, _ := extra.RowsAffected()
	return a + b, nil
}
