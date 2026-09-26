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

  -- Pembelian kredit lewat payment gateway (Kasera Pay).
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

export const q = {
  insertUser: db.prepare(
    'INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
  ),
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userByLogin: db.prepare('SELECT * FROM users WHERE username = ? OR email = ?'),

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
