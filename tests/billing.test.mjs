// Isi ulang kredit lewat QRIS (Kasera Pay): pembuatan tagihan, webhook, polling cadangan, dan anti dobel-kredit.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

let stack;
// Tanpa kredit gratis, supaya saldo yang dibeli terlihat jelas.
before(async () => { stack = await startStack({ AI_BONUS_CREDITS: '0', AI_DAILY_CREDITS: '0' }); });
after(() => stack?.stop());

const payments = (userId) => stack.db().prepare('SELECT id, status, amount, credits, package_id FROM payments WHERE user_id = ? ORDER BY created_at').all(userId);

async function topup(user, packageId = 'p20') {
  const res = await user.post('/api/billing/topup', { packageId });
  assert.equal(res.status, 201);
  return res.body.payment;
}

test('daftar paket', async () => {
  const user = await stack.register();
  const { status, body } = await user.get('/api/billing/packages');
  assert.equal(status, 200);
  assert.equal(body.enabled, true);
  assert.equal(body.livemode, false);
  assert.deepEqual(body.packages, [{ id: 'p20', credits: 20, price: 10000 }, { id: 'p50', credits: 50, price: 20000 }]);
  assert.deepEqual(body.plans.map((p) => [p.id, p.price, p.credits, p.dailyLimit]), [['pro', 49000, 3, null], ['unlimited', 98000, null, 2]]);
  assert.deepEqual(body.assistantPackages, [{ id: 'asst:10000', amount: 10000 }, { id: 'asst:25000', amount: 25000 }]);
  assert.equal(body.credits.remaining, 0);
  assert.equal((await stack.client().get('/api/billing/packages')).status, 401);
});

test('isi ulang membuat tagihan QRIS; tagihan yang masih berlaku dipakai ulang', async () => {
  const user = await stack.register();
  const payment = await topup(user);
  assert.equal(payment.status, 'pending');
  assert.equal(payment.credits, 20);
  assert.equal(payment.amount, 10000);
  assert.equal(payment.plan, null);
  assert.equal(payment.assistant, false);
  assert.match(payment.qr, /^data:image\/svg\+xml;base64,/);

  const sent = stack.kasera.created.at(-1);
  assert.equal(sent.request.external_id, payment.id);
  assert.equal(sent.idempotencyKey, payment.id);
  assert.equal(sent.request.amount, 10000);
  assert.deepEqual(sent.request.payment_methods, ['qris']);

  const again = await user.post('/api/billing/topup', { packageId: 'p20' });
  assert.equal(again.status, 200);
  assert.equal(again.body.payment.id, payment.id);
  assert.equal(payments(user.userId).length, 1);

  // Paket lain = tagihan baru.
  assert.notEqual((await topup(user, 'p50')).id, payment.id);
  assert.equal((await user.credits()).purchased, 0, 'belum dibayar, belum ada kredit');
});

test('paket tidak dikenal ditolak 400', async () => {
  const user = await stack.register();
  assert.equal((await user.post('/api/billing/topup', { packageId: 'p999' })).status, 400);
  assert.equal((await user.post('/api/billing/topup', {})).status, 400);
  assert.equal(payments(user.userId).length, 0);
});

test('Kasera gangguan: 502 dan tidak ada tagihan yang tersisa', async () => {
  const user = await stack.register();
  stack.kasera.fail = true;
  try {
    assert.equal((await user.post('/api/billing/topup', { packageId: 'p20' })).status, 502);
  } finally {
    stack.kasera.fail = false;
  }
  assert.equal(payments(user.userId).length, 0);
});

test('webhook lunas menambah kredit tepat sekali', async () => {
  const user = await stack.register();
  const payment = await topup(user);

  const first = await stack.paid(payment.id);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { received: true });
  assert.equal((await user.credits()).purchased, 20);

  // Kasera mengirim at-least-once: kiriman ulang tidak boleh menambah kredit lagi.
  assert.equal((await stack.paid(payment.id)).status, 200);
  assert.equal((await user.credits()).purchased, 20);

  const view = await user.get(`/api/billing/payments/${payment.id}`);
  assert.equal(view.body.payment.status, 'succeeded');
  assert.equal(view.body.payment.qr, null);
  assert.equal(view.body.credits.purchased, 20);
  assert.ok(stack.db().prepare('SELECT paid_at FROM payments WHERE id = ?').get(payment.id).paid_at);

  // Setelah lunas, isi ulang berikutnya membuat tagihan baru (bukan memakai ulang yang lama).
  assert.notEqual((await topup(user)).id, payment.id);
});

test('webhook dengan tanda tangan tidak sah ditolak 401', async () => {
  const user = await stack.register();
  const payment = await topup(user);
  const row = stack.db().prepare('SELECT provider_id FROM payments WHERE id = ?').get(payment.id);
  const event = { type: 'payment.paid', livemode: false, data: { payment_request_id: row.provider_id, amount: 10000, paid_at: new Date().toISOString() } };

  assert.equal((await stack.webhook(event, { secret: 'salah' })).status, 401);
  assert.equal((await stack.webhook(event, { signature: 'bukan-hex' })).status, 401);
  assert.equal((await stack.webhook(event, { timestamp: Math.floor(Date.now() / 1000) - 600 })).status, 401, 'kiriman lama (replay) ditolak');
  const noHeader = await fetch(`${stack.origin}/api/billing/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  assert.equal(noHeader.status, 401);

  assert.equal((await user.credits()).purchased, 0);
  assert.equal(payments(user.userId)[0].status, 'pending');
});

test('webhook: nominal tidak cocok, pembayaran tak dikenal, dan beda mode tidak menambah kredit', async () => {
  const user = await stack.register();
  const payment = await topup(user);

  assert.equal((await stack.paid(payment.id, { amount: 1 })).status, 200);
  assert.equal((await user.credits()).purchased, 0);
  assert.equal(payments(user.userId)[0].status, 'pending');

  const unknown = await stack.webhook({ type: 'payment.paid', livemode: false, data: { payment_request_id: 'payreq_tidak_ada', amount: 10000 } });
  assert.deepEqual(unknown, { status: 200, body: { ignored: 'unknown payment' } });

  const row = stack.db().prepare('SELECT provider_id FROM payments WHERE id = ?').get(payment.id);
  const live = await stack.webhook({ type: 'payment.paid', livemode: true, data: { payment_request_id: row.provider_id, amount: 10000 } });
  assert.deepEqual(live, { status: 200, body: { ignored: 'mode mismatch' } });
  assert.equal((await user.credits()).purchased, 0);

  assert.deepEqual(await stack.webhook({ type: 'test.ping', livemode: false }), { status: 200, body: { received: true } });
});

test('polling cadangan: status lunas diambil langsung dari Kasera, lalu webhook tidak menggandakan', async () => {
  const user = await stack.register();
  const payment = await topup(user);
  const row = stack.db().prepare('SELECT provider_id FROM payments WHERE id = ?').get(payment.id);
  Object.assign(stack.kasera.transactions.get(row.provider_id), { status: 'succeeded', paid_at: new Date().toISOString() });

  const view = await user.get(`/api/billing/payments/${payment.id}`);
  assert.equal(view.body.payment.status, 'succeeded');
  assert.equal(view.body.credits.purchased, 20);

  await stack.paid(payment.id);
  assert.equal((await user.credits()).purchased, 20);
});

test('tagihan kedaluwarsa tidak menambah kredit', async () => {
  const user = await stack.register();
  const payment = await topup(user);
  const row = stack.db().prepare('SELECT provider_id FROM payments WHERE id = ?').get(payment.id);
  stack.kasera.transactions.get(row.provider_id).status = 'expired';

  const view = await user.get(`/api/billing/payments/${payment.id}`);
  assert.equal(view.body.payment.status, 'expired');
  assert.equal(view.body.credits.purchased, 0);
});

test('pembayaran milik orang lain tidak bisa dilihat', async () => {
  const owner = await stack.register();
  const other = await stack.register();
  const payment = await topup(owner);
  assert.equal((await other.get(`/api/billing/payments/${payment.id}`)).status, 404);
  assert.equal((await owner.get('/api/billing/payments/tidak-ada')).status, 404);
});

test('kredit yang dibeli dipakai untuk prompt dan dikembalikan ke saldo bila AI gagal', async () => {
  const user = await stack.register();
  assert.equal((await user.startPrompt('belum punya kredit')).status, 402);

  await stack.paid((await topup(user)).id);
  const ok = await user.prompt('pakai saldo');
  assert.equal(ok.final.type, 'done');
  assert.equal(ok.final.credits.purchased, 19);

  stack.ai.script.push({ status: 500 });
  const failed = await user.prompt('gagal');
  assert.equal(failed.started.body.credits.purchased, 18);
  assert.equal(failed.final.type, 'error');
  assert.equal(failed.final.credits.purchased, 19);
});

test('isi ulang Saldo Asisten menambah saldo asisten, bukan kredit AI', async () => {
  const user = await stack.register();
  const before = (await user.get('/api/assistant')).body.wallet.balance; // saldo percobaan
  const res = await user.post('/api/billing/assistant-topup', { packageId: 'asst:10000' });
  assert.equal(res.status, 201);
  assert.equal(res.body.payment.assistant, true);
  assert.equal(res.body.payment.amount, 10000);
  assert.equal(res.body.payment.credits, 0);

  await stack.paid(res.body.payment.id);
  await stack.paid(res.body.payment.id);
  assert.equal((await user.get('/api/assistant')).body.wallet.balance, before + 10000);
  assert.equal((await user.credits()).purchased, 0);
  assert.equal((await user.post('/api/billing/assistant-topup', { packageId: 'asst:1' })).status, 400);
});
