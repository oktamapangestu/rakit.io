// Langganan 30 hari (Pro: kuota per siklus · Unlimited: batas harian): aktivasi, perpanjangan, upgrade,
// masa berakhir, dan pengaturan harga dari dashboard owner.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DAY_MS, startStack, TINY_PNG } from './helpers/harness.mjs';

let stack;
let admin;
// Pro 49.000 = 3 kredit/siklus · Unlimited 98.000 = 2 prompt/hari · tanpa bonus, gratis 1/hari.
before(async () => {
  stack = await startStack({ AI_BONUS_CREDITS: '0', AI_DAILY_CREDITS: '1' });
  admin = await stack.admin();
});
after(() => stack?.stop());

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 10_000, `${label}: ${actual} vs ${expected}`);
const subscription = (userId) => stack.db().prepare('SELECT plan, started_at, expires_at FROM subscriptions WHERE user_id = ?').get(userId);

async function buy(user, planId) {
  const res = await user.post('/api/billing/subscribe', { planId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await stack.paid(res.body.payment.id)).status, 200);
  return res.body.payment;
}

test('berlangganan Pro: aktif 30 hari setelah lunas, kuota per siklus', async () => {
  const user = await stack.register();
  const res = await user.post('/api/billing/subscribe', { planId: 'pro' });
  assert.equal(res.status, 201);
  assert.equal(res.body.payment.plan, 'Pro');
  assert.equal(res.body.payment.amount, 49000);
  assert.equal(res.body.payment.credits, 0);
  assert.equal((await user.credits()).plan, null, 'belum aktif sebelum dibayar');

  await stack.paid(res.body.payment.id);
  await stack.paid(res.body.payment.id); // kiriman ulang tidak memperpanjang dua kali
  const c = await user.credits();
  assert.equal(c.plan.id, 'pro');
  assert.equal(c.plan.quota, 3);
  assert.equal(c.plan.quotaRemaining, 3);
  near(Date.parse(c.plan.expiresAt), Date.now() + 30 * DAY_MS, 'berakhir 30 hari lagi');
  assert.equal(c.remaining, 4, 'kuota langganan 3 + gratis harian 1');
  assert.equal((await user.get('/api/assistant')).body.wallet.allowance.limit, 10000, 'jatah saldo asisten paket Pro');
});

test('kuota langganan dipakai lebih dulu, lalu kredit gratis, lalu 402; gagal → kembali ke kuota', async () => {
  const user = await stack.register();
  await buy(user, 'pro');

  stack.ai.script.push({ status: 500 });
  const failed = await user.prompt('gagal');
  assert.equal(failed.started.body.credits.plan.quotaRemaining, 2);
  assert.equal(failed.final.credits.plan.quotaRemaining, 3);

  const seen = [];
  for (let i = 0; i < 4; i++) {
    const { final } = await user.prompt(`prompt ${i}`);
    seen.push([final.credits.plan.quotaRemaining, final.credits.freeRemaining]);
  }
  assert.deepEqual(seen, [[2, 1], [1, 1], [0, 1], [0, 0]]);
  assert.equal((await user.startPrompt('habis')).status, 402);
});

test('perpanjang paket yang sama: masa aktif +30 hari, awal siklus tetap', async () => {
  const user = await stack.register();
  await buy(user, 'pro');
  const first = subscription(user.userId);
  await buy(user, 'pro');
  const second = subscription(user.userId);
  assert.equal(second.started_at, first.started_at);
  assert.equal(second.expires_at, first.expires_at + 30 * DAY_MS);
});

test('upgrade Pro → Unlimited: langsung aktif, sisa hari Pro dikonversi sesuai harga', async () => {
  const user = await stack.register();
  await buy(user, 'pro');
  await buy(user, 'unlimited');
  const sub = subscription(user.userId);
  assert.equal(sub.plan, 'unlimited');
  near(sub.started_at, Date.now(), 'mulai sekarang');
  // 30 hari Pro (49.000) = 15 hari Unlimited (98.000).
  near(sub.expires_at, Date.now() + 45 * DAY_MS, 'berakhir 30 + 15 hari lagi');

  const c = await user.credits();
  assert.equal(c.plan.id, 'unlimited');
  assert.equal(c.plan.quota, 2);
  assert.equal(c.plan.quotaRemaining, 2);
});

test('downgrade ditolak selama paket lebih tinggi masih aktif', async () => {
  const user = await stack.register();
  await buy(user, 'unlimited');
  const res = await user.post('/api/billing/subscribe', { planId: 'pro' });
  assert.equal(res.status, 409);
  assert.equal(subscription(user.userId).plan, 'unlimited');
});

test('Unlimited: batas prompt per hari, lalu kredit gratis', async () => {
  const user = await stack.register();
  await buy(user, 'unlimited');
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const { final } = await user.prompt(`prompt ${i}`);
    seen.push([final.credits.plan.quotaRemaining, final.credits.freeRemaining]);
  }
  assert.deepEqual(seen, [[1, 1], [0, 1], [0, 0]]);
  assert.equal((await user.startPrompt('habis')).status, 402);
});

test('Unlimited: prompt bergambar tetap dihitung 1 prompt', async () => {
  const user = await stack.register();
  await buy(user, 'unlimited');
  const { started, final } = await user.prompt('ikuti desain', { images: [TINY_PNG], thumbs: [TINY_PNG] });
  assert.equal(started.status, 201);
  assert.equal(final.type, 'done');
  assert.equal(final.credits.plan.quotaUsed, 1);
  assert.equal(final.credits.freeRemaining, 1, 'kredit gratis tidak ikut terpakai');
  // Jatah tinggal 1 prompt, kredit gratis hanya 1 (< 2): prompt bergambar tetap boleh memakai jatah itu.
  const second = await user.prompt('gambar lagi', { images: [TINY_PNG], thumbs: [TINY_PNG] });
  assert.equal(second.started.status, 201);
  assert.equal(second.final.credits.plan.quotaRemaining, 0);
});

test('langganan berakhir: kembali ke kredit gratis', async () => {
  const user = await stack.register();
  await buy(user, 'pro');
  stack.db().prepare('UPDATE subscriptions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, user.userId);

  const c = await user.credits();
  assert.equal(c.plan, null);
  assert.equal(c.remaining, 1);
  // Paket lebih rendah boleh dibeli lagi setelah masa aktif habis, dan mulai dari sekarang.
  await buy(user, 'pro');
  near(subscription(user.userId).started_at, Date.now(), 'siklus baru');
});

test('Pro: kuota terisi lagi di siklus 30 hari berikutnya', async () => {
  const user = await stack.register();
  await buy(user, 'pro');
  await buy(user, 'pro'); // 60 hari
  await user.prompt('pakai kuota');
  assert.equal((await user.credits()).plan.quotaRemaining, 2);

  // Geser awal langganan 31 hari ke belakang: sekarang berada di siklus kedua.
  stack.db().prepare('UPDATE subscriptions SET started_at = started_at - ?, expires_at = expires_at - ? WHERE user_id = ?')
    .run(31 * DAY_MS, 31 * DAY_MS, user.userId);
  const c = await user.credits();
  assert.equal(c.plan.quotaRemaining, 3);
  assert.equal(c.plan.quotaUsed, 0);
});

test('pengaturan harga hanya untuk owner dan divalidasi', async () => {
  const user = await stack.register();
  assert.equal((await user.get('/api/admin/plans')).status, 403);
  assert.equal((await user.put('/api/admin/plans', { plans: [{ id: 'pro', price: 1000, quota: 1, enabled: true }] })).status, 403);
  assert.equal((await stack.client().get('/api/admin/plans')).status, 401);

  assert.equal((await admin.put('/api/admin/plans', { plans: [{ id: 'pro', price: 500, quota: 3, enabled: true }] })).status, 400);
  assert.equal((await admin.put('/api/admin/plans', { plans: [{ id: 'pro', price: 49000, quota: 0, enabled: true }] })).status, 400);
  assert.equal((await admin.put('/api/admin/plans', { freeDaily: -1 })).status, 400);
  // Simpan yang gagal tidak mengubah apa pun.
  const view = (await admin.get('/api/admin/plans')).body;
  assert.deepEqual(view.plans.map((p) => [p.id, p.price, p.quota, p.enabled]), [['pro', 49000, 3, true], ['unlimited', 98000, 2, true]]);
  assert.equal(view.freeDaily, 1);
});

// Test ini mengubah pengaturan platform, jadi dijalankan paling akhir.
test('owner mengubah harga/kuota: berlaku untuk pembelian baru; paket nonaktif tidak dijual tapi tetap berlaku', async () => {
  const lama = await stack.register();
  await buy(lama, 'pro');
  const pembeli = await stack.register();
  const tagihanLama = (await pembeli.post('/api/billing/subscribe', { planId: 'pro' })).body.payment;
  assert.equal(tagihanLama.amount, 49000);

  const saved = await admin.put('/api/admin/plans', {
    plans: [{ id: 'pro', price: 59000, quota: 5, enabled: true }, { id: 'unlimited', price: 98000, quota: 2, enabled: false }],
    freeDaily: 4,
    freeBonus: 0,
  });
  assert.equal(saved.status, 200);

  const packages = (await pembeli.get('/api/billing/packages')).body;
  assert.deepEqual(packages.plans.map((p) => [p.id, p.price, p.credits]), [['pro', 59000, 5]]);
  assert.equal(packages.credits.limit, 4);

  // Harga berubah: QRIS lama (nominal lama) tidak dipakai ulang.
  const tagihanBaru = (await pembeli.post('/api/billing/subscribe', { planId: 'pro' })).body.payment;
  assert.equal(tagihanBaru.amount, 59000);
  assert.notEqual(tagihanBaru.id, tagihanLama.id);
  // Tagihan lama yang sudah terbit tetap sah dengan nominal lamanya.
  await stack.paid(tagihanLama.id);
  assert.equal((await pembeli.credits()).plan.id, 'pro');

  assert.equal((await pembeli.post('/api/billing/subscribe', { planId: 'unlimited' })).status, 400);
  assert.equal((await lama.credits()).plan.quota, 5, 'kuota baru berlaku juga untuk pelanggan aktif');
});
