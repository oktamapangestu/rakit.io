import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'rakit.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

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

  -- Saldo kredit AI yang dibeli (tidak hangus, dipakai setelah kredit gratis bulanan habis).
  CREATE TABLE IF NOT EXISTS credit_balance (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0
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
`);

// ---------- Migrasi untuk database yang dibuat versi sebelumnya ----------

const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
if (!hasColumn('users', 'google_id')) db.exec('ALTER TABLE users ADD COLUMN google_id TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users(google_id) WHERE google_id IS NOT NULL');
if (!hasColumn('ai_threads', 'project_id')) db.exec('ALTER TABLE ai_threads ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE');
// Dulu 1 akun = 1 website di <username>.rakit.icu: jadikan itu project pertamanya (URL tetap sama).
db.exec(`
  INSERT INTO projects (user_id, slug, name, created_at)
  SELECT u.id, u.username, u.username, u.created_at FROM users u
  WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.slug = u.username);
  UPDATE ai_threads SET project_id = (
    SELECT p.id FROM projects p WHERE p.user_id = ai_threads.user_id ORDER BY p.created_at, p.id LIMIT 1
  ) WHERE project_id IS NULL;
`);

export const q = {
  insertUser: db.prepare(
    'INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
  ),
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userByLogin: db.prepare('SELECT * FROM users WHERE username = ? OR email = ?'),
  userByGoogle: db.prepare('SELECT * FROM users WHERE google_id = ?'),
  linkGoogle: db.prepare('UPDATE users SET google_id = ? WHERE id = ?'),

  insertProject: db.prepare('INSERT INTO projects (user_id, slug, name, created_at) VALUES (?, ?, ?, ?)'),
  projectBySlug: db.prepare('SELECT * FROM projects WHERE slug = ?'),
  projectsOf: db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY created_at, id'),
  projectCount: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?'),
  renameProject: db.prepare('UPDATE projects SET name = ? WHERE id = ?'),
  deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),

  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(`
    SELECT u.id, u.username, u.email, s.token_hash
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

  ensureUsage: db.prepare('INSERT INTO ai_usage (user_id, period, used) VALUES (?, ?, 0) ON CONFLICT DO NOTHING'),
  usage: db.prepare('SELECT used FROM ai_usage WHERE user_id = ? AND period = ?'),
  // Hanya berhasil (changes = 1) kalau kredit masih tersisa -> aman dari race condition.
  reserveCredit: db.prepare('UPDATE ai_usage SET used = used + ? WHERE user_id = ? AND period = ? AND used + ? <= ?'),
  refundCredit: db.prepare('UPDATE ai_usage SET used = MAX(0, used - ?) WHERE user_id = ? AND period = ?'),
  balance: db.prepare('SELECT balance FROM credit_balance WHERE user_id = ?'),
  spendBalance: db.prepare('UPDATE credit_balance SET balance = balance - ? WHERE user_id = ? AND balance >= ?'),
  addBalance: db.prepare(`
    INSERT INTO credit_balance (user_id, balance) VALUES (?, ?)
    ON CONFLICT (user_id) DO UPDATE SET balance = balance + excluded.balance
  `),

  subscription: db.prepare('SELECT * FROM subscriptions WHERE user_id = ?'),
  upsertSubscription: db.prepare(`
    INSERT INTO subscriptions (user_id, plan, started_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET plan = excluded.plan, started_at = excluded.started_at,
      expires_at = excluded.expires_at, updated_at = excluded.updated_at
  `),

  insertPayment: db.prepare(`
    INSERT INTO payments (id, user_id, package_id, credits, amount, status, livemode, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `),
  attachProviderPayment: db.prepare(`
    UPDATE payments SET provider_id = ?, status = ?, qr_string = ?, checkout_url = ?, instructions = ?, expires_at = ?
    WHERE id = ?
  `),
  paymentById: db.prepare('SELECT * FROM payments WHERE id = ?'),
  paymentByProviderId: db.prepare('SELECT * FROM payments WHERE provider_id = ?'),
  pendingPaymentFor: db.prepare(`
    SELECT * FROM payments WHERE user_id = ? AND package_id = ? AND status = 'pending' AND provider_id IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `),
  // Hanya berhasil sekali per pembayaran -> kredit tidak pernah ditambahkan dua kali.
  markPaymentPaid: db.prepare(`UPDATE payments SET status = 'succeeded', paid_at = ? WHERE id = ? AND status != 'succeeded'`),
  markPaymentStatus: db.prepare(`UPDATE payments SET status = ? WHERE id = ? AND status = 'pending'`),
  deletePayment: db.prepare('DELETE FROM payments WHERE id = ?'),

  logAiRequest: db.prepare(
    'INSERT INTO ai_requests (user_id, created_at, model, status, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?)',
  ),
};
