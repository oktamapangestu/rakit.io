package store

// Skema database utama. Semua CREATE ... IF NOT EXISTS, jadi aman dijalankan tiap kali server menyala.
// Padanan src/db.js (tabel utama) dan src/assistant.js (tabel asisten).
const schema = `
	CREATE TABLE IF NOT EXISTS users (
	  id            INTEGER PRIMARY KEY AUTOINCREMENT,
	  username      TEXT NOT NULL UNIQUE,
	  email         TEXT NOT NULL UNIQUE,
	  password_hash TEXT NOT NULL,
	  created_at    INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS sessions (
	  token_hash TEXT PRIMARY KEY,
	  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	  expires_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);

	-- Project = workspace dengan subdomain sendiri: <slug>.rakit.icu. File di sites/<slug>, database di db/<slug>.db.
	CREATE TABLE IF NOT EXISTS projects (
	  id         INTEGER PRIMARY KEY AUTOINCREMENT,
	  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	  slug       TEXT NOT NULL UNIQUE,
	  name       TEXT NOT NULL,
	  created_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, created_at);

	-- Kredit AI terpakai per user per bulan (period = 'YYYY-MM', UTC).
	CREATE TABLE IF NOT EXISTS ai_usage (
	  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	  period  TEXT NOT NULL,
	  used    INTEGER NOT NULL DEFAULT 0,
	  PRIMARY KEY (user_id, period)
	);

	-- Saldo kredit AI yang dibeli (tidak hangus, dipakai setelah kredit gratis harian habis).
	CREATE TABLE IF NOT EXISTS credit_balance (
	  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	  balance INTEGER NOT NULL DEFAULT 0
	);

	-- Pengaturan platform yang diubah owner lewat dashboard (JSON per kunci), mis. 'plans'.
	CREATE TABLE IF NOT EXISTS settings (
	  key        TEXT PRIMARY KEY,
	  value      TEXT NOT NULL,
	  updated_at INTEGER NOT NULL
	);

	-- Langganan aktif per user (Pro/Unlimited). Satu baris per user; diperbarui saat membeli/memperpanjang.
	CREATE TABLE IF NOT EXISTS subscriptions (
	  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	  plan       TEXT NOT NULL,              -- pro | unlimited
	  started_at INTEGER NOT NULL,           -- awal siklus kuota (ms)
	  expires_at INTEGER NOT NULL,           -- ms
	  updated_at INTEGER NOT NULL
	);

	-- Pembelian kredit & langganan lewat payment gateway (Kasera Pay). Langganan: package_id = 'plan:<id>', credits = 0.
	CREATE TABLE IF NOT EXISTS payments (
	  id           TEXT PRIMARY KEY,           -- id lokal (uuid), juga dipakai sebagai external_id
	  provider_id  TEXT UNIQUE,                -- payreq_<uuid> dari Kasera
	  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	  package_id   TEXT NOT NULL,
	  credits      INTEGER NOT NULL,
	  amount       INTEGER NOT NULL,
	  status       TEXT NOT NULL,              -- pending | succeeded | failed | expired | canceled
	  qr_string    TEXT,
	  checkout_url TEXT,
	  instructions TEXT,                       -- JSON {title, steps}
	  expires_at   TEXT,
	  livemode     INTEGER NOT NULL DEFAULT 0,
	  created_at   INTEGER NOT NULL,
	  paid_at      TEXT
	);
	CREATE INDEX IF NOT EXISTS payments_user ON payments(user_id, created_at);

	-- Riwayat percakapan AI per user.
	CREATE TABLE IF NOT EXISTS ai_threads (
	  id         INTEGER PRIMARY KEY AUTOINCREMENT,
	  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	  title      TEXT NOT NULL,
	  created_at INTEGER NOT NULL,
	  updated_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS ai_threads_user ON ai_threads(user_id, updated_at);

	-- Pesan dalam percakapan. Pesan AI sekaligus menjadi "job": statusnya berjalan dari
	-- queued → running → done/error/aborted, dan hasil Builder disimpan beserta snapshot untuk Batalkan.
	CREATE TABLE IF NOT EXISTS ai_messages (
	  id          INTEGER PRIMARY KEY AUTOINCREMENT,
	  thread_id   INTEGER NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
	  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	  role        TEXT NOT NULL,              -- user | assistant
	  mode        TEXT NOT NULL,              -- build | plan
	  content     TEXT NOT NULL DEFAULT '',
	  status      TEXT NOT NULL,              -- user: sent · assistant: queued | running | done | error | aborted
	  error       TEXT,
	  changes     TEXT,                       -- JSON daftar perubahan Builder
	  apply_state TEXT,                       -- pending | kept | reverted | failed
	  snapshot    TEXT,                       -- JSON isi sebelum perubahan (untuk Batalkan)
	  credit      TEXT,                       -- JSON reservasi kredit (untuk refund)
	  created_at  INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS ai_messages_thread ON ai_messages(thread_id, id);
	CREATE INDEX IF NOT EXISTS ai_messages_status ON ai_messages(status);

	-- Riwayat versi file project (lihat versions.js). manifest = JSON { files: {path: {h, s, m}}, dirs: [...] }.
	CREATE TABLE IF NOT EXISTS versions (
	  id         INTEGER PRIMARY KEY AUTOINCREMENT,
	  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	  kind       TEXT NOT NULL,              -- edit | ai | manual | restore
	  label      TEXT NOT NULL DEFAULT '',
	  manifest   TEXT NOT NULL,
	  file_count INTEGER NOT NULL,
	  created_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS versions_project ON versions(project_id, created_at);

	-- Log setiap request AI, untuk memantau biaya.
	CREATE TABLE IF NOT EXISTS ai_requests (
	  id            INTEGER PRIMARY KEY AUTOINCREMENT,
	  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	  created_at    INTEGER NOT NULL,
	  model         TEXT NOT NULL,
	  status        TEXT NOT NULL,
	  input_tokens  INTEGER NOT NULL DEFAULT 0,
	  output_tokens INTEGER NOT NULL DEFAULT 0
	);

	-- Saldo asisten per akun (mRp). trial_granted: saldo percobaan sudah diberikan.
	CREATE TABLE IF NOT EXISTS assistant_wallet (
	  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	  balance       INTEGER NOT NULL DEFAULT 0,
	  trial_granted INTEGER NOT NULL DEFAULT 0
	);
	-- Jatah asisten dari langganan yang terpakai per siklus (period = siklus paket).
	CREATE TABLE IF NOT EXISTS assistant_allowance (
	  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	  period  TEXT NOT NULL,
	  spent   INTEGER NOT NULL DEFAULT 0,
	  PRIMARY KEY (user_id, period)
	);
	-- Pengaturan asisten per project (website).
	CREATE TABLE IF NOT EXISTS assistant_sites (
	  project_id   INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
	  enabled      INTEGER NOT NULL DEFAULT 0,
	  model_key    TEXT NOT NULL DEFAULT '',
	  name         TEXT NOT NULL DEFAULT '',
	  greeting     TEXT NOT NULL DEFAULT '',
	  instructions TEXT NOT NULL DEFAULT '',
	  daily_cap    INTEGER NOT NULL DEFAULT 5000,   -- Rupiah per hari
	  blocked      INTEGER NOT NULL DEFAULT 0,      -- diblokir owner platform
	  updated_at   INTEGER NOT NULL
	);
	-- Pemakaian per website per hari (WIB), untuk batas harian & statistik.
	CREATE TABLE IF NOT EXISTS assistant_usage (
	  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	  day        TEXT NOT NULL,
	  spent      INTEGER NOT NULL DEFAULT 0,
	  messages   INTEGER NOT NULL DEFAULT 0,
	  tokens     INTEGER NOT NULL DEFAULT 0,
	  PRIMARY KEY (project_id, day)
	);
`

// Migrate membuat tabel yang belum ada dan memperbarui database buatan versi sebelumnya. Dipanggil
// sekali saat server menyala, sebelum menerima request.
func (s *Store) Migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	addColumn := func(table, column, definition string) error {
		var n int
		if err := tx.QueryRow("SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?", table, column).Scan(&n); err != nil || n > 0 {
			return err
		}
		_, err := tx.Exec("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition)
		return err
	}
	for _, c := range [][3]string{
		{"users", "google_id", "TEXT"},
		// Lampiran gambar pesan AI: JSON { thumbs: [dataURL kecil], description: teks dari model vision }.
		{"ai_messages", "attachments", "TEXT"},
		{"ai_threads", "project_id", "INTEGER REFERENCES projects(id) ON DELETE CASCADE"},
	} {
		if err := addColumn(c[0], c[1], c[2]); err != nil {
			return err
		}
	}
	// Dulu 1 akun = 1 website di <username>.rakit.icu: jadikan itu project pertamanya (URL tetap sama).
	if _, err := tx.Exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_id) WHERE google_id IS NOT NULL;
		INSERT INTO projects (user_id, slug, name, created_at)
		SELECT u.id, u.username, u.username, u.created_at FROM users u
		WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.user_id = u.id)
			AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.slug = u.username);
		UPDATE ai_threads SET project_id = (
			SELECT p.id FROM projects p WHERE p.user_id = ai_threads.user_id ORDER BY p.created_at, p.id LIMIT 1
		) WHERE project_id IS NULL;`); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteExpiredSessions membersihkan sesi yang sudah kedaluwarsa (dijalankan tiap jam).
func (s *Store) DeleteExpiredSessions() error {
	_, err := s.db.Exec("DELETE FROM sessions WHERE expires_at <= ?", now())
	return err
}
