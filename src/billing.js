import crypto from 'node:crypto';
import express from 'express';
import QRCode from 'qrcode';
import { config } from './config.js';
import { q } from './db.js';
import { HttpError } from './http-error.js';
import { requireAuth } from './auth.js';
import { creditInfo, creditPayment } from './credits.js';
import { assertCanBuy, planForSale, planFromPackageId, planPackageId, publicPlans } from './plans.js';

const KASERA_BASE = 'https://pay.kasera.id/v1';
const PAYMENT_TTL_MINUTES = 30;
const SIGNATURE_TOLERANCE_S = 5 * 60;

export const billing = express.Router();

// ---------- Kasera Pay API ----------

async function kasera(method, path, { body, idempotencyKey } = {}) {
  const res = await fetch(`${KASERA_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.billing.apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Kasera ${method} ${path} ${res.status}: ${data.error?.code ?? ''} ${data.error?.message ?? ''}`);
    err.status = res.status;
    err.code = data.error?.code;
    throw err;
  }
  return data;
}

// Simpan status terbaru dari objek transaksi Kasera ke pembayaran lokal.
function syncFromProvider(payment, trx) {
  if (trx.status === 'succeeded') {
    if (trx.amount !== payment.amount) {
      console.error(`Kasera: nominal ${trx.id} (${trx.amount}) tidak cocok dengan ${payment.id} (${payment.amount})`);
      return;
    }
    creditPayment(payment, trx.paid_at);
  } else if (['failed', 'expired', 'canceled'].includes(trx.status)) {
    q.markPaymentStatus.run(trx.status, payment.id);
  }
}

// ---------- Tampilan untuk klien ----------

async function paymentView(payment) {
  const view = {
    id: payment.id,
    status: payment.status,
    credits: payment.credits,
    plan: payment.package_id.startsWith('plan:') ? planFromPackageId(payment.package_id)?.name ?? null : null,
    amount: payment.amount,
    expiresAt: payment.expires_at,
    checkoutUrl: payment.checkout_url,
    instructions: payment.instructions ? JSON.parse(payment.instructions) : null,
    livemode: Boolean(payment.livemode),
    qr: null,
  };
  if (payment.status === 'pending' && payment.qr_string) {
    const svg = await QRCode.toString(payment.qr_string, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    view.qr = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
  return view;
}

// ---------- Route untuk user ----------

billing.use(requireAuth);

billing.get('/packages', (req, res) => {
  res.json({
    enabled: config.billing.enabled,
    livemode: config.billing.livemode,
    packages: config.billing.packages,
    plans: publicPlans(),
    credits: creditInfo(req.user.id),
  });
});

// Buat tagihan QRIS untuk satu item (paket kredit atau langganan).
async function createPayment(req, res, { packageId, credits, price, label }) {
  if (!config.billing.enabled) throw new HttpError(503, 'Pembayaran belum dikonfigurasi di server');

  // Pakai ulang QRIS yang masih berlaku untuk paket yang sama, supaya user tidak dapat banyak tagihan.
  const existing = q.pendingPaymentFor.get(req.user.id, packageId);
  if (existing && existing.amount === price && existing.qr_string && Date.parse(existing.expires_at) - Date.now() > 2 * 60_000) {
    return res.json({ payment: await paymentView(existing) });
  }

  const id = crypto.randomUUID();
  q.insertPayment.run(id, req.user.id, packageId, credits, price, config.billing.livemode ? 1 : 0, Date.now());

  let trx;
  try {
    trx = await kasera('POST', '/transactions', {
      idempotencyKey: id,
      body: {
        amount: price,
        description: `${label} rakit.icu`,
        external_id: id,
        merchant_ref: `user-${req.user.id}`,
        payment_methods: ['qris'],
        expires_in_minutes: PAYMENT_TTL_MINUTES,
        customer: { name: req.user.username, email: req.user.email },
        order_items: [{ name: label, price, quantity: 1 }],
      },
    });
  } catch (err) {
    q.deletePayment.run(id);
    console.error(err.message);
    throw new HttpError(502, 'Gagal membuat pembayaran QRIS. Coba lagi sebentar lagi.');
  }

  q.attachProviderPayment.run(
    trx.id,
    trx.status,
    trx.payment?.type === 'qr' ? trx.payment.qr_string : null,
    trx.checkout_url,
    JSON.stringify(trx.instructions ?? null),
    trx.expires_at,
    id,
  );
  res.status(201).json({ payment: await paymentView(q.paymentById.get(id)) });
}

billing.post('/topup', async (req, res) => {
  const pkg = config.billing.packages.find((p) => p.id === req.body?.packageId);
  if (!pkg) throw new HttpError(400, 'Paket tidak ditemukan');
  await createPayment(req, res, { packageId: pkg.id, credits: pkg.credits, price: pkg.price, label: `${pkg.credits} kredit AI` });
});

billing.post('/subscribe', async (req, res) => {
  const plan = planForSale(String(req.body?.planId ?? ''));
  if (!plan) throw new HttpError(400, 'Paket langganan tidak ditemukan');
  assertCanBuy(req.user.id, plan);
  await createPayment(req, res, { packageId: planPackageId(plan.id), credits: 0, price: plan.price, label: `Langganan ${plan.name} 30 hari` });
});

const lastChecked = new Map(); // payment id -> waktu cek terakhir ke Kasera

billing.get('/payments/:id', async (req, res) => {
  let payment = q.paymentById.get(req.params.id);
  if (!payment || payment.user_id !== req.user.id) throw new HttpError(404, 'Pembayaran tidak ditemukan');

  // Webhook adalah jalur utama; cek langsung ke Kasera sebagai cadangan (mis. di localhost tanpa webhook).
  if (payment.status === 'pending' && payment.provider_id && Date.now() - (lastChecked.get(payment.id) ?? 0) > 5000) {
    lastChecked.set(payment.id, Date.now());
    try {
      syncFromProvider(payment, await kasera('GET', `/transactions/${payment.provider_id}`));
      payment = q.paymentById.get(payment.id);
    } catch (err) {
      console.error(err.message);
    }
  }
  if (payment.status !== 'pending') lastChecked.delete(payment.id);

  res.json({ payment: await paymentView(payment), credits: creditInfo(req.user.id) });
});

// ---------- Webhook ----------

function verifySignature(header, rawBody) {
  if (!config.billing.webhookSecret || !header) return false;
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=');
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1' && value) signatures.push(value);
  }
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_S) return false;

  const expected = crypto.createHmac('sha256', config.billing.webhookSecret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  // Saat rotasi secret, Kasera mengirim dua v1: terima kalau salah satunya cocok.
  return signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

// Dipasang di server.js dengan express.raw(), karena tanda tangan dihitung dari body mentah.
export function kaseraWebhook(req, res) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!verifySignature(req.get('kasera-signature-v1'), rawBody)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid json' });
  }
  if (event.livemode !== config.billing.livemode) return res.json({ ignored: 'mode mismatch' });

  if (event.type === 'payment.paid') {
    const payment = q.paymentByProviderId.get(event.data?.payment_request_id);
    if (!payment) return res.json({ ignored: 'unknown payment' });
    syncFromProvider(payment, {
      id: event.data.payment_request_id,
      status: 'succeeded',
      amount: event.data.amount,
      paid_at: event.data.paid_at,
    });
  }
  // test.ping dan event lain cukup dibalas 200.
  res.json({ received: true });
}
