import { config } from './config.js';
import { db, q } from './db.js';
import { HttpError } from './http-error.js';

// Paket langganan 30 hari (dibayar sekali lewat QRIS, bisa diperpanjang):
// - pro:       kuota kredit AI per 30 hari + bonus storage
// - unlimited: tanpa kuota bulanan, dibatasi jumlah prompt per hari (fair use) + bonus storage lebih besar
// Storage berlaku per project milik pelanggan, dan kembali ke batas gratis saat langganan berakhir.
// Harga, kuota AI, dan status dijual diatur owner di dashboard (tabel settings, kunci 'plans');
// nilai PLAN_PRO / PLAN_UNLIMITED di .env hanya menjadi default sebelum pernah disimpan.

export const PLAN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

const FREE_STORAGE = { totalSize: 20 * MB, entries: 500, dbBytes: 10 * MB, imageSize: 1 * MB };

// Bagian tetap tiap paket. `quotaKey` = field kuota AI yang bisa diatur owner.
const BASE = {
  pro: {
    id: 'pro',
    name: 'Pro',
    quotaKey: 'credits', // kredit AI per 30 hari
    storage: { totalSize: 100 * MB, entries: 2000, dbBytes: 50 * MB, imageSize: 5 * MB },
  },
  unlimited: {
    id: 'unlimited',
    name: 'Unlimited',
    quotaKey: 'dailyLimit', // prompt per hari (WIB)
    storage: { totalSize: 250 * MB, entries: 5000, dbBytes: 100 * MB, imageSize: 10 * MB },
  },
};
export const PLAN_IDS = Object.keys(BASE);

// ---------- Pengaturan dari dashboard owner ----------

export const PLAN_LIMITS = { minPrice: 1000, maxPrice: 10_000_000, maxQuota: 100_000 };

const readSetting = db.prepare("SELECT value FROM settings WHERE key = 'plans'");
const writeSetting = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES ('plans', ?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

function envDefaults(id) {
  const env = config.plans[id];
  const quota = env[BASE[id].quotaKey];
  return { price: env.price, quota, enabled: env.price > 0 && quota > 0 };
}

/** Harga, kuota, dan status dijual tiap paket: { pro: { price, quota, enabled }, ... } */
export function planSettings() {
  let saved = {};
  try {
    saved = JSON.parse(readSetting.get()?.value ?? '{}');
  } catch { /* nilai rusak: pakai default */ }
  return Object.fromEntries(PLAN_IDS.map((id) => [id, { ...envDefaults(id), ...saved[id] }]));
}

/** Simpan pengaturan dari dashboard owner (divalidasi di sini). */
export function savePlanSettings(input) {
  const current = planSettings();
  const next = {};
  for (const id of PLAN_IDS) {
    const given = input?.[id] ?? {};
    const price = Number(given.price ?? current[id].price);
    const quota = Number(given.quota ?? current[id].quota);
    const enabled = given.enabled === undefined ? current[id].enabled : Boolean(given.enabled);
    const name = BASE[id].name;
    if (!Number.isInteger(price) || price < PLAN_LIMITS.minPrice || price > PLAN_LIMITS.maxPrice) {
      throw new HttpError(400, `Harga ${name} harus bilangan bulat Rp${PLAN_LIMITS.minPrice.toLocaleString('id-ID')}–Rp${PLAN_LIMITS.maxPrice.toLocaleString('id-ID')}`);
    }
    if (!Number.isInteger(quota) || quota < 1 || quota > PLAN_LIMITS.maxQuota) {
      throw new HttpError(400, `Kuota ${name} harus bilangan bulat 1–${PLAN_LIMITS.maxQuota.toLocaleString('id-ID')}`);
    }
    next[id] = { price, quota, enabled };
  }
  writeSetting.run(JSON.stringify(next), Date.now());
  return next;
}

// Biaya model AI (Rupiah per 1 juta token), hanya untuk menghitung perkiraan margin di dashboard.
const readCost = db.prepare("SELECT value FROM settings WHERE key = 'model_cost'");
const writeCost = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES ('model_cost', ?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
export const modelCost = () => Number(readCost.get()?.value ?? 0) || 0;
export function saveModelCost(value) {
  const cost = Number(value);
  if (!Number.isFinite(cost) || cost < 0 || cost > 10_000_000) throw new HttpError(400, 'Biaya model tidak valid');
  writeCost.run(String(Math.round(cost * 100) / 100), Date.now());
  return modelCost();
}

// Kredit gratis per hari untuk semua pengguna (0 = tanpa AI gratis). Tidak menumpuk: sisa hari ini hangus.
const readFreeDaily = db.prepare("SELECT value FROM settings WHERE key = 'free_daily_credits'");
const writeFreeDaily = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES ('free_daily_credits', ?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
export const FREE_DAILY_MAX = 1000;
export function freeDailyCredits() {
  const saved = readFreeDaily.get();
  return saved ? Number(saved.value) : config.ai.dailyCredits;
}
export function saveFreeDailyCredits(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > FREE_DAILY_MAX) {
    throw new HttpError(400, `Kredit gratis harian harus bilangan bulat 0–${FREE_DAILY_MAX}`);
  }
  writeFreeDaily.run(String(n), Date.now());
  return n;
}

/** Paket lengkap (bagian tetap + pengaturan owner), atau null. */
export function getPlan(id, settings = planSettings()) {
  if (!Object.hasOwn(BASE, id)) return null;
  const base = BASE[id];
  const { price, quota, enabled } = settings[id];
  return { id, name: base.name, price, enabled, [base.quotaKey]: quota, storage: base.storage };
}

// Paket nonaktif tetap berlaku untuk pelanggan yang sudah membayar, hanya tidak bisa dibeli.
const forSale = (plan) => Boolean(plan && plan.enabled && plan.price > 0 && (plan.credits || plan.dailyLimit));

// Urutan untuk upgrade: paket yang lebih tinggi boleh menggantikan yang lebih rendah kapan saja.
const RANK = { pro: 1, unlimited: 2 };

export const planPackageId = (planId) => `plan:${planId}`;
export const planFromPackageId = (packageId) => getPlan(String(packageId).replace(/^plan:/, ''));
export const planForSale = (planId) => {
  const plan = getPlan(planId);
  return forSale(plan) ? plan : null;
};

/** Langganan aktif user, atau null. */
export function activePlan(userId, now = Date.now()) {
  const sub = q.subscription.get(userId);
  const plan = sub && sub.expires_at > now ? getPlan(sub.plan) : null;
  return plan ? { ...plan, startedAt: sub.started_at, expiresAt: sub.expires_at } : null;
}

// Kuota Pro dihitung per siklus 30 hari sejak langganan dimulai, supaya perpanjangan beberapa bulan
// tetap mendapat kuota baru tiap siklus.
export function cycleOf(plan, now = Date.now()) {
  const n = Math.floor((now - plan.startedAt) / (PLAN_DAYS * DAY_MS));
  return { period: `sub:${plan.startedAt}:${n}`, resetsAt: plan.startedAt + (n + 1) * PLAN_DAYS * DAY_MS };
}

// Hari dihitung dalam WIB (UTC+7): { date: 'YYYY-MM-DD', resetsAt: 00.00 WIB berikutnya (ms) }.
export function wibDay(now = Date.now()) {
  const wib = new Date(now + 7 * 60 * 60 * 1000);
  const next = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() + 1) - 7 * 60 * 60 * 1000;
  return { date: wib.toISOString().slice(0, 10), resetsAt: next };
}

// Batas harian Unlimited.
export function dayOf(now = Date.now()) {
  const { date, resetsAt } = wibDay(now);
  return { period: `day:${date}`, resetsAt };
}

/** Pastikan paket boleh dibeli sekarang (dipanggil sebelum membuat tagihan). */
export function assertCanBuy(userId, plan) {
  const current = activePlan(userId);
  if (current && RANK[plan.id] < RANK[current.id]) {
    throw new HttpError(409, `Kamu masih berlangganan ${current.name}. Paket ${plan.name} bisa dibeli setelah masa aktifnya berakhir.`);
  }
}

/**
 * Aktifkan/perpanjang langganan setelah pembayaran lunas. Dipanggil di dalam transaksi pembayaran.
 * - paket sama & masih aktif  → diperpanjang 30 hari dari tanggal berakhir
 * - upgrade (Pro → Unlimited) → mulai sekarang; sisa hari Pro dikonversi ke hari Unlimited sesuai harga
 * - tidak aktif               → mulai sekarang
 */
export function activatePlan(userId, plan, now = Date.now()) {
  const sub = q.subscription.get(userId);
  const current = sub && sub.expires_at > now && getPlan(sub.plan) ? sub : null;
  const period = PLAN_DAYS * DAY_MS;

  if (current && current.plan === plan.id) {
    q.upsertSubscription.run(userId, plan.id, current.started_at, current.expires_at + period, now);
    return;
  }
  let bonus = 0;
  if (current && plan.price > 0) {
    const old = getPlan(current.plan);
    bonus = Math.floor(((current.expires_at - now) * old.price) / plan.price);
  }
  q.upsertSubscription.run(userId, plan.id, now, now + period + bonus, now);
}

/** Batas storage untuk project (dilihat dari langganan pemiliknya). */
const ownerOf = db.prepare('SELECT user_id FROM projects WHERE slug = ?');
export function storageFor(slug) {
  const owner = ownerOf.get(slug);
  const plan = owner ? activePlan(owner.user_id) : null;
  return plan ? plan.storage : FREE_STORAGE;
}

export const freeStorage = FREE_STORAGE;

export function publicPlans() {
  const settings = planSettings();
  return PLAN_IDS.map((id) => getPlan(id, settings)).filter(forSale).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    days: PLAN_DAYS,
    credits: p.credits ?? null,
    dailyLimit: p.dailyLimit ?? null,
    storage: p.storage,
  }));
}
