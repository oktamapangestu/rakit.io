import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './http-error.js';
import { requireAuth } from './auth.js';
import { queueStats } from './aiqueue.js';

// Dashboard pemilik platform: statistik pengguna, AI, pendapatan, dan penyimpanan.
// Akses dibatasi ke email di ADMIN_EMAILS.

export const isAdmin = (user) => Boolean(user && config.adminEmails.includes(String(user.email).toLowerCase()));

export function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) throw new HttpError(403, 'Halaman ini khusus pemilik platform');
  next();
}

export const admin = express.Router();
admin.use(requireAuth, requireAdmin);

const TZ_OFFSET = '+7 hours'; // statistik harian dihitung dalam WIB
const DAY_MS = 24 * 60 * 60 * 1000;

// Daftar tanggal 'YYYY-MM-DD' (WIB) untuk N hari terakhir, termasuk hari ini.
function lastDays(days) {
  const todayWib = Date.now() + 7 * 60 * 60 * 1000;
  return Array.from({ length: days }, (_, i) => new Date(todayWib - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

function fillDays(days, rows, fields) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return days.map((date) => {
    const row = byDate.get(date);
    return { date, ...Object.fromEntries(fields.map((f) => [f, row?.[f] ?? 0])) };
  });
}

const one = (sql, ...params) => db.prepare(sql).get(...params);
// Subdomain project pertama milik user (untuk link "lihat situs").
const PRIMARY_SLUG = '(SELECT p.slug FROM projects p WHERE p.user_id = u.id ORDER BY p.created_at, p.id LIMIT 1)';
const all = (sql, ...params) => db.prepare(sql).all(...params);

// ---------- Ukuran penyimpanan (dihitung ulang paling sering 5 menit sekali) ----------

let storageCache = { at: 0, value: null };

async function dirSize(dir) {
  let bytes = 0;
  let files = 0;
  let items;
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes, files };
  }
  for (const item of items) {
    const abs = path.join(dir, item.name);
    if (item.isDirectory()) {
      const sub = await dirSize(abs);
      bytes += sub.bytes;
      files += sub.files;
    } else if (item.isFile()) {
      bytes += (await fs.stat(abs)).size;
      files += 1;
    }
  }
  return { bytes, files };
}

async function storage() {
  if (storageCache.value && Date.now() - storageCache.at < 5 * 60 * 1000) return storageCache.value;
  const sites = await dirSize(path.join(config.dataDir, 'sites'));
  const databases = await dirSize(path.join(config.dataDir, 'db'));
  const dbFiles = await fs.readdir(path.join(config.dataDir, 'db')).catch(() => []);
  const value = {
    siteBytes: sites.bytes,
    siteFiles: sites.files,
    dbBytes: databases.bytes,
    projectsWithDatabase: dbFiles.filter((f) => f.endsWith('.db')).length,
    computedAt: new Date().toISOString(),
  };
  storageCache = { at: Date.now(), value };
  return value;
}

// ---------- Statistik ----------

admin.get('/stats', async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const dayList = lastDays(days);
  const since = Date.now() - days * DAY_MS;
  const sinceIso = new Date(since).toISOString();
  const today = dayList.at(-1);
  const period = new Date().toISOString().slice(0, 7);
  const localDay = (col) => `date(${col} / 1000, 'unixepoch', '${TZ_OFFSET}')`;

  // Pengguna
  const users = {
    total: one('SELECT COUNT(*) AS n FROM users').n,
    projects: one('SELECT COUNT(*) AS n FROM projects').n,
    inPeriod: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', since).n,
    today: one(`SELECT COUNT(*) AS n FROM users WHERE ${localDay('created_at')} = ?`, today).n,
    activeSessions: one('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE expires_at > ?', Date.now()).n,
  };
  const signupsByDay = fillDays(dayList, all(`
    SELECT ${localDay('created_at')} AS date, COUNT(*) AS count
    FROM users WHERE created_at >= ? GROUP BY date
  `, since - DAY_MS), ['count']);

  // AI
  const aiTotals = one(`
    SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS tokensIn, COALESCE(SUM(output_tokens), 0) AS tokensOut,
           COUNT(DISTINCT user_id) AS users
    FROM ai_requests WHERE created_at >= ?
  `, since);
  const aiByStatus = Object.fromEntries(all(`
    SELECT status, COUNT(*) AS n FROM ai_requests WHERE created_at >= ? GROUP BY status ORDER BY n DESC
  `, since).map((r) => [r.status, r.n]));
  const aiByDay = fillDays(dayList, all(`
    SELECT ${localDay('created_at')} AS date, COUNT(*) AS requests,
           SUM(CASE WHEN status = 'ok' THEN 0 ELSE 1 END) AS failed,
           COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
    FROM ai_requests WHERE created_at >= ? GROUP BY date
  `, since - DAY_MS), ['requests', 'failed', 'tokens']);
  const aiModels = all(`
    SELECT model, COUNT(*) AS requests FROM ai_requests WHERE created_at >= ? GROUP BY model ORDER BY requests DESC
  `, since);

  // Kredit
  const credits = {
    usedThisMonth: one('SELECT COALESCE(SUM(used), 0) AS n FROM ai_usage WHERE period = ?', period).n,
    purchasedOutstanding: one('SELECT COALESCE(SUM(balance), 0) AS n FROM credit_balance').n,
    freePerUser: config.ai.monthlyCredits,
  };

  // Pendapatan (hanya pembayaran berhasil)
  const paidDay = `date(paid_at, '${TZ_OFFSET}')`;
  const revenue = {
    allTime: one(`SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'succeeded'`).n,
    inPeriod: one(`SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'succeeded' AND paid_at >= ?`, sinceIso).n,
    paidCount: one(`SELECT COUNT(*) AS n FROM payments WHERE status = 'succeeded' AND paid_at >= ?`, sinceIso).n,
    creditsSold: one(`SELECT COALESCE(SUM(credits), 0) AS n FROM payments WHERE status = 'succeeded' AND paid_at >= ?`, sinceIso).n,
    payingUsers: one(`SELECT COUNT(DISTINCT user_id) AS n FROM payments WHERE status = 'succeeded'`).n,
    pending: one(`SELECT COUNT(*) AS n FROM payments WHERE status = 'pending' AND provider_id IS NOT NULL`).n,
    livemode: config.billing.livemode,
  };
  const revenueByDay = fillDays(dayList, all(`
    SELECT ${paidDay} AS date, SUM(amount) AS amount, COUNT(*) AS count
    FROM payments WHERE status = 'succeeded' AND paid_at >= ? GROUP BY date
  `, new Date(since - DAY_MS).toISOString()), ['amount', 'count']);
  const recentPayments = all(`
    SELECT p.created_at AS createdAt, p.paid_at AS paidAt, p.status, p.credits, p.amount, p.livemode, u.username
    FROM payments p JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC LIMIT 10
  `).map((p) => ({ ...p, livemode: Boolean(p.livemode) }));

  // Pengguna teraktif (AI) dan pendaftar terbaru
  const topUsers = all(`
    SELECT u.username, u.created_at AS createdAt, ${PRIMARY_SLUG} AS slug,
           COUNT(r.id) AS aiRequests,
           COALESCE(SUM(r.input_tokens + r.output_tokens), 0) AS tokens,
           (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'succeeded') AS spent
    FROM users u JOIN ai_requests r ON r.user_id = u.id AND r.created_at >= ?
    GROUP BY u.id ORDER BY aiRequests DESC, tokens DESC LIMIT 10
  `, since).map((u) => ({ ...u, siteUrl: config.siteUrl(u.slug ?? u.username) }));
  const recentUsers = all(`
    SELECT username, email, created_at AS createdAt, ${PRIMARY_SLUG} AS slug,
           (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects
    FROM users u ORDER BY created_at DESC LIMIT 10
  `).map((u) => ({ ...u, siteUrl: config.siteUrl(u.slug ?? u.username) }));

  // Kredit & token per pengguna: jatah gratis bulan ini, saldo beli, total tersedia, dan pemakaian token.
  const creditUsers = all(`
    SELECT u.id, u.username, u.email, ${PRIMARY_SLUG} AS slug,
           COALESCE(usage.used, 0) AS used,
           COALESCE(bal.balance, 0) AS purchased,
           COALESCE(agg.inTokens, 0) AS inTokens,
           COALESCE(agg.outTokens, 0) AS outTokens,
           COALESCE(agg.requests, 0) AS aiRequests,
           agg.lastAt AS lastAt
    FROM users u
    LEFT JOIN ai_usage usage ON usage.user_id = u.id AND usage.period = ?
    LEFT JOIN credit_balance bal ON bal.user_id = u.id
    LEFT JOIN (
      SELECT user_id,
             SUM(input_tokens) AS inTokens,
             SUM(output_tokens) AS outTokens,
             COUNT(*) AS requests,
             MAX(created_at) AS lastAt
      FROM ai_requests GROUP BY user_id
    ) agg ON agg.user_id = u.id
    ORDER BY (COALESCE(usage.used, 0) + COALESCE(bal.balance, 0)) DESC, (COALESCE(agg.inTokens, 0) + COALESCE(agg.outTokens, 0)) DESC, u.username
  `, period).map((u) => {
    const freeLimit = config.ai.monthlyCredits;
    const freeRemaining = Math.max(0, freeLimit - u.used);
    const totalTokens = u.inTokens + u.outTokens;
    return {
      username: u.username,
      email: u.email,
      used: u.used,
      freeLimit,
      freeRemaining,
      purchased: u.purchased,
      remaining: freeRemaining + u.purchased,
      aiRequests: u.aiRequests,
      inTokens: u.inTokens,
      outTokens: u.outTokens,
      tokens: totalTokens,
      lastAt: u.lastAt ? new Date(u.lastAt).toISOString() : null,
      siteUrl: config.siteUrl(u.slug ?? u.username),
    };
  });

  res.json({
    generatedAt: new Date().toISOString(),
    days,
    users,
    signupsByDay,
    ai: { ...aiTotals, byStatus: aiByStatus, byDay: aiByDay, models: aiModels, currentModel: config.ai.model },
    credits,
    creditUsers,
    revenue,
    revenueByDay,
    recentPayments,
    topUsers,
    recentUsers,
    storage: await storage(),
    queue: queueStats(),
  });
});
