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

// Potong kredit sebelum memanggil AI. Mengembalikan catatan reservasi { source, period, cost }
// yang bisa disimpan, supaya kredit tetap bisa dikembalikan walau server sempat restart.
export function reserveCredits(userId, cost = config.ai.creditsPerPrompt) {
  const period = freePeriod();

  const quota = planQuota(activePlan(userId));
  if (quota) {
    q.ensureUsage.run(userId, quota.period);
    if (q.reserveCredit.run(cost, userId, quota.period, cost, quota.limit).changes === 1) {
      return { source: 'plan', period: quota.period, cost };
    }
  }
  q.ensureUsage.run(userId, period);
  // Bonus awal dipakai lebih dulu: masa perkenalan 20 kredit sebelum jatah harian 3/hari.
  const bonusLimit = freeBonusCredits();
  if (bonusLimit > 0) {
    q.ensureUsage.run(userId, BONUS_PERIOD);
    if (q.reserveCredit.run(cost, userId, BONUS_PERIOD, cost, bonusLimit).changes === 1) {
      return { source: 'bonus', period: BONUS_PERIOD, cost };
    }
  }
  if (q.reserveCredit.run(cost, userId, period, cost, freeDailyCredits()).changes === 1) {
    return { source: 'free', period, cost };
  }
  if (q.spendBalance.run(cost, userId, cost).changes === 1) {
    return { source: 'purchased', period, cost };
  }
  const err = new HttpError(402, cost > config.ai.creditsPerPrompt
    ? `Prompt dengan gambar butuh ${cost} kredit dan kreditmu belum cukup. Kirim tanpa gambar, atau ${config.billing.enabled ? 'isi ulang kredit' : 'tunggu kredit terisi lagi besok'}.`
    : config.billing.enabled
    ? 'Kredit AI kamu habis. Kredit gratis terisi lagi besok pukul 00.00 WIB, atau berlangganan / isi ulang untuk lanjut sekarang.'
    : 'Kredit AI gratis hari ini sudah habis. Terisi lagi besok pukul 00.00 WIB.');
  err.code = 'no_credits';
  throw err;
}

export function refundCredits(userId, reservation) {
  if (!reservation) return;
  if (['free', 'plan', 'bonus'].includes(reservation.source)) q.refundCredit.run(reservation.cost, userId, reservation.period);
  else q.addBalance.run(userId, reservation.cost);
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
