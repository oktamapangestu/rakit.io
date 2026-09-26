import { config } from './config.js';
import { db, q } from './db.js';
import { HttpError } from './http-error.js';

// Dua sumber kredit AI:
// - gratis: jatah bulanan, reset tiap tanggal 1 (UTC)
// - dibeli: saldo dari isi ulang, tidak hangus, dipakai setelah jatah gratis habis

const currentPeriod = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM' (UTC)

function nextResetAt() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export function creditInfo(userId) {
  const used = q.usage.get(userId, currentPeriod())?.used ?? 0;
  const freeRemaining = Math.max(0, config.ai.monthlyCredits - used);
  const purchased = q.balance.get(userId)?.balance ?? 0;
  return {
    enabled: config.ai.enabled,
    topupEnabled: config.billing.enabled,
    limit: config.ai.monthlyCredits,
    used,
    freeRemaining,
    purchased,
    remaining: freeRemaining + purchased,
    costPerPrompt: config.ai.creditsPerPrompt,
    resetsAt: nextResetAt(),
  };
}

// Potong kredit sebelum memanggil AI. Mengembalikan catatan reservasi { source, period, cost }
// yang bisa disimpan, supaya kredit tetap bisa dikembalikan walau server sempat restart.
export function reserveCredits(userId) {
  const period = currentPeriod();
  const cost = config.ai.creditsPerPrompt;

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
  if (reservation.source === 'free') q.refundCredit.run(reservation.cost, userId, reservation.period);
  else q.addBalance.run(userId, reservation.cost);
}

// Tambah saldo sekali per pembayaran; aman dipanggil berulang (webhook at-least-once + polling).
export function creditPayment(payment, paidAt) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { changes } = q.markPaymentPaid.run(paidAt ?? new Date().toISOString(), payment.id);
    if (changes === 1) q.addBalance.run(payment.user_id, payment.credits);
    db.exec('COMMIT');
    return changes === 1;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
