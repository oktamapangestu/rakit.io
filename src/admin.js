import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './http-error.js';
import { requireAuth } from './auth.js';
import { adminAssistantView, saveAssistantSettings, setSiteBlocked } from './assistant.js';
import { queueStats } from './aiqueue.js';
import { aiModels, aiModelsView, saveAiModels } from './aimodels.js';
import {
  FREE_DAILY_MAX, FREE_BONUS_MAX, freeBonusCredits, freeDailyCredits, getPlan, modelCost, PLAN_IDS, PLAN_LIMITS, planSettings,
  saveFreeBonusCredits, saveFreeDailyCredits, saveModelCost, savePlanSettings,
} from './plans.js';
import { freePeriod } from './credits.js';

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

// ---------- Harga langganan ----------

function plansView() {
  const settings = planSettings();
  const since = Date.now() - 30 * DAY_MS;
  // Rata-rata token per prompt yang berhasil (30 hari), untuk memperkirakan biaya per paket.
  const usage = db.prepare(`
    SELECT COUNT(*) AS prompts, COALESCE(AVG(input_tokens + output_tokens), 0) AS avg,
           COALESCE(MAX(input_tokens + output_tokens), 0) AS max
    FROM ai_requests WHERE status = 'ok' AND created_at >= ?
  `).get(since);
  return {
    plans: PLAN_IDS.map((id) => {
      const plan = getPlan(id, settings);
      return { id, name: plan.name, price: plan.price, quota: settings[id].quota, enabled: plan.enabled, quotaUnit: plan.credits ? 'credits' : 'daily', storage: plan.storage };
    }),
    limits: { ...PLAN_LIMITS, freeDailyMax: FREE_DAILY_MAX, freeBonusMax: FREE_BONUS_MAX },
    modelCost: modelCost(),
    freeDaily: freeDailyCredits(),
    freeBonus: freeBonusCredits(),
    usage: { prompts: usage.prompts, avgTokens: Math.round(usage.avg), maxTokens: usage.max },
    creditsPerPrompt: config.ai.creditsPerPrompt,
  };
}

admin.get('/plans', (req, res) => res.json(plansView()));

// Model AI editor: model utama & cadangan (dipakai saat model utama gangguan), juga untuk pembaca gambar.
admin.get('/ai-models', (req, res) => res.json(aiModelsView()));
admin.put('/ai-models', express.json(), (req, res) => {
  saveAiModels(req.body);
  res.json(aiModelsView());
});

// Asisten AI website: model (aktif/nonaktif, harga), saldo percobaan, website pemakai & blokir.
admin.get('/assistant', (req, res) => res.json(adminAssistantView()));
admin.put('/assistant', express.json(), (req, res) => {
  saveAssistantSettings({ models: req.body?.models, trial: req.body?.trial });
  res.json(adminAssistantView());
});
admin.post('/assistant/block', express.json(), (req, res) => {
  setSiteBlocked(req.body?.slug, req.body?.blocked);
  res.json(adminAssistantView());
});

admin.put('/plans', express.json(), (req, res) => {
  const body = req.body ?? {};
  const input = Object.fromEntries((Array.isArray(body.plans) ? body.plans : [])
    .filter((p) => PLAN_IDS.includes(p?.id))
    .map((p) => [p.id, { price: p.price, quota: p.quota, enabled: p.enabled }]));
  db.exec('BEGIN IMMEDIATE');
  try {
    savePlanSettings(input);
    if (body.modelCost !== undefined) saveModelCost(body.modelCost);
    if (body.freeDaily !== undefined) saveFreeDailyCredits(body.freeDaily);
    if (body.freeBonus !== undefined) saveFreeBonusCredits(body.freeBonus);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json(plansView());
});

// ---------- Statistik ----------

admin.get('/stats', async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const dayList = lastDays(days);
  const since = Date.now() - days * DAY_MS;
  const sinceIso = new Date(since).toISOString();
  const today = dayList.at(-1);
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
  const requestsByModel = all(`
    SELECT model, COUNT(*) AS requests FROM ai_requests WHERE created_at >= ? GROUP BY model ORDER BY requests DESC
  `, since);

  // Kredit
  const credits = {
    usedToday: one('SELECT COALESCE(SUM(used), 0) AS n FROM ai_usage WHERE period = ?', freePeriod()).n,
    purchasedOutstanding: one('SELECT COALESCE(SUM(balance), 0) AS n FROM credit_balance').n,
    freePerUser: freeDailyCredits(),
  };

  // Langganan yang masih aktif, per paket
  const subscribers = Object.fromEntries(all('SELECT plan, COUNT(*) AS n FROM subscriptions WHERE expires_at > ? GROUP BY plan', Date.now())
    .map((r) => [r.plan, r.n]));

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
    SELECT p.created_at AS createdAt, p.paid_at AS paidAt, p.status, p.package_id AS packageId, p.credits, p.amount, p.livemode, u.username
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

  const freeLimit = freeDailyCredits();
  const bonusLimit = freeBonusCredits();
  // Kredit & token per pengguna: bonus awal, jatah gratis hari ini, saldo beli, total tersedia, dan token.
  const creditUsers = all(`
    SELECT u.id, u.username, u.email, ${PRIMARY_SLUG} AS slug,
           COALESCE(usage.used, 0) AS used,
           COALESCE(bonus.used, 0) AS bonusUsed,
           COALESCE(bal.balance, 0) AS purchased,
           COALESCE(agg.inTokens, 0) AS inTokens,
           COALESCE(agg.outTokens, 0) AS outTokens,
           COALESCE(agg.requests, 0) AS aiRequests,
           agg.lastAt AS lastAt
    FROM users u
    LEFT JOIN ai_usage usage ON usage.user_id = u.id AND usage.period = ?
    LEFT JOIN ai_usage bonus ON bonus.user_id = u.id AND bonus.period = 'free:bonus'
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
  `, freePeriod()).map((u) => {
    const freeRemaining = Math.max(0, freeLimit - u.used);
    const bonusRemaining = Math.max(0, bonusLimit - u.bonusUsed);
    const totalTokens = u.inTokens + u.outTokens;
    return {
      username: u.username,
      email: u.email,
      used: u.used,
      freeLimit,
      freeRemaining,
      bonusLimit,
      bonusUsed: u.bonusUsed,
      bonusRemaining,
      purchased: u.purchased,
      remaining: freeRemaining + bonusRemaining + u.purchased,
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
    ai: { ...aiTotals, byStatus: aiByStatus, byDay: aiByDay, models: requestsByModel, currentModel: aiModels().model },
    credits,
    subscribers,
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
