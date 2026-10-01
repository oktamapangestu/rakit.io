// Package store membuka database utama (data/rakit.db) yang dipakai bersama dengan server Node.
// Selama migrasi, skema dibuat dan dimigrasikan oleh Node (src/db.js); Go hanya memakainya.
package store

import (
	"database/sql"
	"errors"
	"net/url"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func Open(dataDir string) (*Store, error) {
	// WAL: Node dan Go boleh membuka file yang sama bersamaan. busy_timeout: tunggu sebentar bila
	// proses lain sedang menulis, daripada langsung gagal.
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

// ProjectExists: apakah ada project dengan subdomain ini.
func (s *Store) ProjectExists(slug string) (bool, error) {
	var one int
	err := s.db.QueryRow("SELECT 1 FROM projects WHERE slug = ?", slug).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
