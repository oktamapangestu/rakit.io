import { config } from './config.js';
import { db, q } from './db.js';
import { HttpError } from './http-error.js';

// Paket langganan 30 hari (dibayar sekali lewat QRIS, bisa diperpanjang):
// - pro:       kuota kredit AI per 30 hari + bonus storage
// - unlimited: tanpa kuota bulanan, dibatasi jumlah prompt per hari (fair use) + bonus storage lebih besar
// Storage berlaku per project milik pelanggan, dan kembali ke batas gratis saat langganan berakhir.

export const PLAN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

const FREE_STORAGE = { totalSize: 20 * MB, entries: 500, dbBytes: 10 * MB, imageSize: 1 * MB };

export const PLANS = {
  pro: {
    id: 'pro',
    name: 'Pro',
    price: config.plans.pro.price,
    credits: config.plans.pro.credits, // kredit AI per 30 hari
    storage: { totalSize: 100 * MB, entries: 2000, dbBytes: 50 * MB, imageSize: 5 * MB },
  },
  unlimited: {
    id: 'unlimited',
    name: 'Unlimited',
    price: config.plans.unlimited.price,
    dailyLimit: config.plans.unlimited.dailyLimit, // prompt per hari (WIB)
    storage: { totalSize: 250 * MB, entries: 5000, dbBytes: 100 * MB, imageSize: 10 * MB },
  },
};
// Paket dengan harga/kuota 0 di .env dianggap tidak dijual.
const forSale = (plan) => Boolean(plan && plan.price > 0 && (plan.credits || plan.dailyLimit));

// Urutan untuk upgrade: paket yang lebih tinggi boleh menggantikan yang lebih rendah kapan saja.
const RANK = { pro: 1, unlimited: 2 };

export const planPackageId = (planId) => `plan:${planId}`;
export const planFromPackageId = (packageId) => PLANS[String(packageId).replace(/^plan:/, '')] ?? null;
export const planForSale = (planId) => (Object.hasOwn(PLANS, planId) && forSale(PLANS[planId]) ? PLANS[planId] : null);

/** Langganan aktif user, atau null. */
export function activePlan(userId, now = Date.now()) {
  const sub = q.subscription.get(userId);
  if (!sub || sub.expires_at <= now || !PLANS[sub.plan]) return null;
  return { ...PLANS[sub.plan], startedAt: sub.started_at, expiresAt: sub.expires_at };
}

// Kuota Pro dihitung per siklus 30 hari sejak langganan dimulai, supaya perpanjangan beberapa bulan
// tetap mendapat kuota baru tiap siklus.
export function cycleOf(plan, now = Date.now()) {
  const n = Math.floor((now - plan.startedAt) / (PLAN_DAYS * DAY_MS));
  return { period: `sub:${plan.startedAt}:${n}`, resetsAt: plan.startedAt + (n + 1) * PLAN_DAYS * DAY_MS };
}

// Batas harian Unlimited mengikuti tanggal WIB (UTC+7).
export function dayOf(now = Date.now()) {
  const wib = new Date(now + 7 * 60 * 60 * 1000);
  const next = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() + 1) - 7 * 60 * 60 * 1000;
  return { period: `day:${wib.toISOString().slice(0, 10)}`, resetsAt: next };
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
  const current = sub && sub.expires_at > now && PLANS[sub.plan] ? sub : null;
  const period = PLAN_DAYS * DAY_MS;

  if (current && current.plan === plan.id) {
    q.upsertSubscription.run(userId, plan.id, current.started_at, current.expires_at + period, now);
    return;
  }
  let bonus = 0;
  if (current) {
    const old = PLANS[current.plan];
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
  return Object.values(PLANS).filter(forSale).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    days: PLAN_DAYS,
    credits: p.credits ?? null,
    dailyLimit: p.dailyLimit ?? null,
    storage: p.storage,
  }));
}
