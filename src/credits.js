import { config } from './config.js';
import { db, q } from './db.js';
import { HttpError } from './http-error.js';
import { activatePlan, activePlan, cycleOf, dayOf, planFromPackageId } from './plans.js';

// Sumber kredit AI, dipakai berurutan:
// - langganan: kuota Pro per siklus 30 hari, atau batas harian Unlimited (lihat plans.js)
// - gratis: jatah bulanan, reset tiap tanggal 1 (UTC)
// - dibeli: saldo dari isi ulang, tidak hangus, dipakai setelah jatah gratis habis

const currentPeriod = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM' (UTC)

function nextResetAt() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

// Kuota langganan yang berlaku sekarang: { period, limit, resetsAt } atau null.
function planQuota(plan) {
  if (!plan) return null;
  if (plan.id === 'unlimited') return { ...dayOf(), limit: plan.dailyLimit };
  return { ...cycleOf(plan), limit: plan.credits };
}

export function creditInfo(userId) {
  const used = q.usage.get(userId, currentPeriod())?.used ?? 0;
  const freeRemaining = Math.max(0, config.ai.monthlyCredits - used);
  const purchased = q.balance.get(userId)?.balance ?? 0;

  const plan = activePlan(userId);
  const quota = planQuota(plan);
  const planUsed = quota ? q.usage.get(userId, quota.period)?.used ?? 0 : 0;
  const planRemaining = quota ? Math.max(0, quota.limit - planUsed) : 0;
  return {
    enabled: config.ai.enabled,
    topupEnabled: config.billing.enabled,
    limit: config.ai.monthlyCredits,
    used,
    freeRemaining,
    purchased,
    remaining: planRemaining + freeRemaining + purchased,
    costPerPrompt: config.ai.creditsPerPrompt,
    resetsAt: nextResetAt(),
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
export function reserveCredits(userId) {
  const period = currentPeriod();
  const cost = config.ai.creditsPerPrompt;

  const quota = planQuota(activePlan(userId));
  if (quota) {
    q.ensureUsage.run(userId, quota.period);
    if (q.reserveCredit.run(cost, userId, quota.period, cost, quota.limit).changes === 1) {
      return { source: 'plan', period: quota.period, cost };
    }
  }
  q.ensureUsage.run(userId, period);
  if (q.reserveCredit.run(cost, userId, period, cost, config.ai.monthlyCredits).changes === 1) {
    return { source: 'free', period, cost };
  }
  if (q.spendBalance.run(cost, userId, cost).changes === 1) {
    return { source: 'purchased', period, cost };
  }
  const err = new HttpError(402, config.billing.enabled
    ? 'Kredit AI kamu habis. Isi ulang kredit untuk lanjut memakai AI.'
    : 'Kredit AI bulan ini sudah habis. Kredit akan terisi lagi awal bulan depan.');
  err.code = 'no_credits';
  throw err;
}

export function refundCredits(userId, reservation) {
  if (!reservation) return;
  if (reservation.source === 'free' || reservation.source === 'plan') q.refundCredit.run(reservation.cost, userId, reservation.period);
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
      else q.addBalance.run(payment.user_id, payment.credits);
    }
    db.exec('COMMIT');
    return changes === 1;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
