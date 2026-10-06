import { config } from './config.js';
import { db, q } from './db.js';
import { aiModels } from './aimodels.js';
import { addAssistantBalance, isAssistantPackage } from './assistant.js';
import { HttpError } from './http-error.js';
import { activatePlan, activePlan, cycleOf, dayOf, freeBonusCredits, freeDailyCredits, planFromPackageId, wibDay } from './plans.js';

// Sumber kredit AI, dipakai berurutan:
// - langganan: kuota Pro per siklus 30 hari, atau batas harian Unlimited (lihat plans.js)
// - bonus: sekali untuk akun baru (mis. 20), habis pakai & tidak kembali; user lama ikut dapat
// - gratis: jatah harian, reset 00.00 WIB, tidak menumpuk (sisa hari ini hangus)
// - dibeli: saldo dari isi ulang, tidak hangus, dipakai setelah jatah gratis habis

// Baris ai_usage untuk jatah gratis hari ini (WIB).
export const freePeriod = (now = Date.now()) => `free:${wibDay(now).date}`;

// Bonus awal: satu baris per user, period tetap (bukan per-hari) sehingga tak menumpuk & tak kembali.
export const BONUS_PERIOD = 'free:bonus';
const bonusRemaining = (userId) => {
  const limit = freeBonusCredits();
  if (limit <= 0) return 0;
  const used = q.usage.get(userId, BONUS_PERIOD)?.used ?? 0;
  return Math.max(0, limit - used);
};

// Kuota langganan yang berlaku sekarang: { period, limit, resetsAt } atau null.
function planQuota(plan) {
  if (!plan) return null;
  if (plan.id === 'unlimited') return { ...dayOf(), limit: plan.dailyLimit };
  return { ...cycleOf(plan), limit: plan.credits };
}

export function creditInfo(userId) {
  const freeLimit = freeDailyCredits();
  const used = q.usage.get(userId, freePeriod())?.used ?? 0;
  const freeRemaining = Math.max(0, freeLimit - used);
  const purchased = q.balance.get(userId)?.balance ?? 0;

  const bonusLimit = freeBonusCredits();
  const bonusLeft = bonusRemaining(userId);
  const bonusUsed = Math.max(0, bonusLimit - bonusLeft);

  const plan = activePlan(userId);
  const quota = planQuota(plan);
  const planUsed = quota ? q.usage.get(userId, quota.period)?.used ?? 0 : 0;
  const planRemaining = quota ? Math.max(0, quota.limit - planUsed) : 0;
  return {
    enabled: config.ai.enabled,
    topupEnabled: config.billing.enabled,
    limit: freeLimit, // kredit gratis per hari
    used,
    freeRemaining,
    // Bonus awal: masa perkenalan sebelum jatah harian. Sekali habis, tidak kembali.
    bonusLimit,
    bonusRemaining: bonusLeft,
    bonusUsed,
    purchased,
    remaining: planRemaining + bonusLeft + freeRemaining + purchased,
    costPerPrompt: config.ai.creditsPerPrompt,
    // Lampiran gambar di prompt (null = tidak tersedia)
    images: aiModels().vision ? { cost: config.ai.imagePromptCredits, max: config.ai.maxImages } : null,
    resetsAt: new Date(wibDay().resetsAt).toISOString(), // jatah gratis terisi lagi 00.00 WIB
    plan: plan && {
      id: plan.id,
      name: plan.name,
      expiresAt: new Date(plan.expiresAt).toISOString(),
      // Pro: kredit per siklus 30 hari · Unlimited: prompt per hari
      quota: quota.limit,
      quotaUsed: planUsed,
      quotaRemaining: planRemaining,
      quotaResetsAt: new Date(Math.min(quota.resetsAt, plan.expiresAt)).toISOString(),
    },
  };
}

// Potong kredit sebelum memanggil AI, dari sumber berurutan: langganan → bonus → gratis → dibeli. Bila satu
// sumber tidak cukup, sisanya diambil dari sumber berikutnya, dalam satu transaksi (kredit hanya terpotong bila
// totalnya cukup). Unlimited menghitung prompt: satu prompt (dengan gambar pun) = 1 dari batas harian.
// Mengembalikan catatan reservasi { source, period, cost, more?: [{ source, period, cost }] } yang bisa
// disimpan, supaya kredit tetap bisa dikembalikan walau server sempat restart.
export function reserveCredits(userId, cost = config.ai.creditsPerPrompt) {
  if (cost <= 0) return { source: 'free', period: freePeriod(), cost: 0 }; // AI gratis: tidak ada yang dipotong
  const plan = activePlan(userId);
  const period = freePeriod();
  const parts = [];
  let need = cost;
  // whole: jumlah tetap untuk satu prompt Unlimited (tidak dipecah).
  const fromUsage = (source, usagePeriod, limit, whole = 0) => {
    if (need <= 0 || limit <= 0) return;
    const used = q.usage.get(userId, usagePeriod)?.used ?? 0;
    let n = Math.min(need, limit - used);
    if (whole) {
      if (limit - used < whole) return;
      n = whole;
    }
    if (n <= 0) return;
    q.addUsage.run(userId, usagePeriod, n);
    parts.push({ source, period: usagePeriod, cost: n });
    need = whole ? 0 : need - n;
  };

  db.exec('BEGIN IMMEDIATE');
  let open = true;
  try {
    const quota = planQuota(plan);
    if (quota) fromUsage('plan', quota.period, quota.limit, plan.id === 'unlimited' ? 1 : 0);
    // Bonus awal dipakai lebih dulu: masa perkenalan sebelum jatah harian.
    fromUsage('bonus', BONUS_PERIOD, freeBonusCredits());
    fromUsage('free', period, freeDailyCredits());
    if (need > 0) {
      const n = Math.min(need, q.balance.get(userId)?.balance ?? 0);
      if (n > 0) {
        q.spendBalance.run(n, userId, n);
        parts.push({ source: 'purchased', period, cost: n });
        need -= n;
      }
    }
    if (need > 0 || !parts.length) {
      db.exec('ROLLBACK');
      open = false;
      const err = new HttpError(402, cost > config.ai.creditsPerPrompt
        ? `Prompt dengan gambar butuh ${cost} kredit dan kreditmu belum cukup. Kirim tanpa gambar, atau ${config.billing.enabled ? 'isi ulang kredit' : 'tunggu kredit terisi lagi besok'}.`
        : config.billing.enabled
        ? 'Kredit AI kamu habis. Kredit gratis terisi lagi besok pukul 00.00 WIB, atau berlangganan / isi ulang untuk lanjut sekarang.'
        : 'Kredit AI gratis hari ini sudah habis. Terisi lagi besok pukul 00.00 WIB.');
      err.code = 'no_credits';
      throw err;
    }
    db.exec('COMMIT');
    open = false;
  } catch (err) {
    if (open) db.exec('ROLLBACK');
    throw err;
  }
  const [first, ...more] = parts;
  return more.length ? { ...first, more } : first;
}

export function refundCredits(userId, reservation) {
  if (!reservation?.cost) return;
  const { more = [], ...first } = reservation;
  for (const part of [first, ...more]) {
    if (['free', 'plan', 'bonus'].includes(part.source)) q.refundCredit.run(part.cost, userId, part.period);
    else q.addBalance.run(userId, part.cost);
  }
}

// Tambah saldo / aktifkan langganan sekali per pembayaran; aman dipanggil berulang (webhook at-least-once + polling).
export function creditPayment(payment, paidAt) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { changes } = q.markPaymentPaid.run(paidAt ?? new Date().toISOString(), payment.id);
    if (changes === 1) {
      const plan = planFromPackageId(payment.package_id);
      if (payment.package_id.startsWith('plan:') && plan) activatePlan(payment.user_id, plan);
      else if (isAssistantPackage(payment.package_id)) addAssistantBalance(payment.user_id, payment.amount);
      else q.addBalance.run(payment.user_id, payment.credits);
    }
    db.exec('COMMIT');
    return changes === 1;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
