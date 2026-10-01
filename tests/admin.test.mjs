// Dashboard pemilik platform (/api/admin): statistik, harga langganan & kredit gratis, model asisten,
// dan blokir website. Akses dibatasi ke email di ADMIN_EMAILS.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

let stack;
let admin;
before(async () => {
  stack = await startStack();
  admin = await stack.admin();
});
after(() => stack?.stop());

const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

test('semua rute admin: belum login 401, bukan owner 403', async () => {
  const user = await stack.register();
  const routes = [['GET', '/stats'], ['GET', '/plans'], ['PUT', '/plans'], ['GET', '/assistant'], ['PUT', '/assistant'], ['POST', '/assistant/block'], ['GET', '/ai-models']];
  for (const [method, url] of routes) {
    assert.equal((await stack.client().req(method, `/api/admin${url}`, method === 'GET' ? undefined : {})).status, 401, url);
    const res = await user.req(method, `/api/admin${url}`, method === 'GET' ? undefined : {});
    assert.deepEqual([res.status, res.body], [403, { error: 'Halaman ini khusus pemilik platform' }], url);
  }
  assert.deepEqual((await admin.get('/api/admin/tidak-ada')).body, { error: 'Endpoint tidak ditemukan' });
});

test('harga langganan: tampilan, simpan, dan validasi', async () => {
  const view = (await admin.get('/api/admin/plans')).body;
  assert.deepEqual(view.plans, [
    { id: 'pro', name: 'Pro', price: 49000, quota: 3, enabled: true, quotaUnit: 'credits', storage: { totalSize: 104857600, entries: 2000, dbBytes: 52428800, imageSize: 5242880 } },
    { id: 'unlimited', name: 'Unlimited', price: 98000, quota: 2, enabled: true, quotaUnit: 'daily', storage: { totalSize: 262144000, entries: 5000, dbBytes: 104857600, imageSize: 10485760 } },
  ]);
  assert.deepEqual(view.limits, { minPrice: 1000, maxPrice: 10000000, maxQuota: 100000, freeDailyMax: 1000, freeBonusMax: 10000 });
  assert.deepEqual([view.modelCost, view.freeDaily, view.freeBonus, view.creditsPerPrompt], [0, 2, 2, 1]);
  assert.deepEqual(view.usage, { prompts: 0, avgTokens: 0, maxTokens: 0 });

  for (const [body, message] of [
    [{ plans: [{ id: 'pro', price: 999 }] }, 'Harga Pro harus bilangan bulat Rp1.000–Rp10.000.000'],
    [{ plans: [{ id: 'pro', price: 49000.5 }] }, 'Harga Pro harus bilangan bulat Rp1.000–Rp10.000.000'],
    [{ plans: [{ id: 'unlimited', price: 'mahal' }] }, 'Harga Unlimited harus bilangan bulat Rp1.000–Rp10.000.000'],
    [{ plans: [{ id: 'pro', quota: 100001 }] }, 'Kuota Pro harus bilangan bulat 1–100.000'],
    [{ modelCost: -1 }, 'Biaya model tidak valid'],
    [{ modelCost: 'x' }, 'Biaya model tidak valid'],
    [{ freeDaily: 1001 }, 'Kredit gratis harian harus bilangan bulat 0–1000'],
    [{ freeDaily: 1.5 }, 'Kredit gratis harian harus bilangan bulat 0–1000'],
    [{ freeBonus: 10001 }, 'Bonus kredit awal harus bilangan bulat 0–10000'],
    // Satu bagian gagal: tidak ada yang tersimpan.
    [{ plans: [{ id: 'pro', price: 59000 }], freeDaily: 5, freeBonus: -1 }, 'Bonus kredit awal harus bilangan bulat 0–10000'],
  ]) {
    const res = await admin.put('/api/admin/plans', body);
    assert.deepEqual([res.status, res.body.error], [400, message], JSON.stringify(body));
  }
  assert.deepEqual((await admin.get('/api/admin/plans')).body.plans.map((p) => p.price), [49000, 98000]);

  const saved = await admin.put('/api/admin/plans', {
    plans: [{ id: 'pro', price: '59000', quota: 10, enabled: 0 }, { id: 'tidak-ada', price: 1 }, 'ngawur'],
    modelCost: 431.456, freeDaily: '7', freeBonus: 0,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.plans.map((p) => [p.id, p.price, p.quota, p.enabled]), [['pro', 59000, 10, false], ['unlimited', 98000, 2, true]]);
  assert.deepEqual([saved.body.modelCost, saved.body.freeDaily, saved.body.freeBonus], [431.46, 7, 0]);
  // Langsung berlaku untuk pengguna.
  const user = await stack.register();
  const credits = await user.credits();
  assert.deepEqual([credits.limit, credits.bonusLimit, credits.remaining], [7, 0, 7]);
  assert.deepEqual((await user.get('/api/billing/packages')).body.plans.map((p) => p.id), ['unlimited']);

  // Sebagian saja: yang lain tetap.
  const partial = await admin.put('/api/admin/plans', { plans: [{ id: 'pro', enabled: true }] });
  assert.deepEqual(partial.body.plans.map((p) => [p.price, p.quota, p.enabled]), [[59000, 10, true], [98000, 2, true]]);
  assert.equal((await admin.put('/api/admin/plans', {})).status, 200);
  await admin.put('/api/admin/plans', { plans: [{ id: 'pro', price: 49000, quota: 3 }], freeDaily: 2, freeBonus: 2, modelCost: 0 });
});

test('model asisten: tampilan, simpan, validasi, saldo percobaan', async () => {
  const view = (await admin.get('/api/admin/assistant')).body;
  assert.deepEqual(view.models, [
    { key: 'flash', name: 'DeepSeek V4.1 Flash', tier: 'Hemat', model: 'deepseek-v4.1-flash', cost: 150, markup: 3, enabled: true },
    { key: 'pro', name: 'DeepSeek V4 Pro', tier: 'Pintar', model: 'deepseek-v4-pro', cost: 431, markup: 3, enabled: true },
  ]);
  assert.deepEqual([view.trial, view.typicalTokens, view.sites], [500, 1500, []]);

  const model = (extra) => ({ key: 'baru', name: 'Model Baru', tier: 'Uji', model: 'org/model:1', cost: 200, markup: 2, enabled: true, ...extra });
  for (const [body, message] of [
    [{ models: [] }, 'Daftar model harus berisi 1–20 model'],
    [{ models: 'x' }, 'Daftar model harus berisi 1–20 model'],
    [{ models: Array.from({ length: 21 }, (_, i) => model({ key: `m${i}` })) }, 'Daftar model harus berisi 1–20 model'],
    [{ models: [model({ key: 'Kode Salah' })] }, 'Kode model "kode salah" tidak valid atau ganda (huruf kecil, angka, -)'],
    [{ models: [model(), model()] }, 'Kode model "baru" tidak valid atau ganda (huruf kecil, angka, -)'],
    [{ models: [model({ name: '  ' })] }, 'Nama model "baru" wajib diisi'],
    [{ models: [model({ model: 'ada spasi' })] }, 'ID model di gateway untuk "Model Baru" tidak valid'],
    [{ models: [model({ cost: 0 })] }, 'Biaya Model Baru harus lebih dari 0 (Rp per 1 juta token)'],
    [{ models: [model({ cost: 'x' })] }, 'Biaya Model Baru harus lebih dari 0 (Rp per 1 juta token)'],
    [{ models: [model({ markup: 0.5 })] }, 'Margin Model Baru harus 1–20×'],
    [{ models: [model({ markup: 21 })] }, 'Margin Model Baru harus 1–20×'],
    [{ trial: -1 }, 'Saldo percobaan harus bilangan bulat Rupiah'],
    [{ trial: 1.5 }, 'Saldo percobaan harus bilangan bulat Rupiah'],
  ]) {
    const res = await admin.put('/api/admin/assistant', body);
    assert.deepEqual([res.status, res.body.error], [400, message], JSON.stringify(body).slice(0, 80));
  }

  const saved = await admin.put('/api/admin/assistant', {
    models: [model({ key: ' BARU ', name: `  ${'n'.repeat(70)} `, tier: 't'.repeat(30), cost: '123.456', markup: 2.555, enabled: 0 }), ...view.models],
    trial: 750,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.models[0], { key: 'baru', name: 'n'.repeat(60), tier: 't'.repeat(20), model: 'org/model:1', cost: 123.46, markup: 2.56, enabled: false });
  assert.equal(saved.body.trial, 750);
  // Akun baru mendapat saldo percobaan yang baru; model nonaktif tidak ditawarkan.
  const owner = await stack.register();
  const mine = (await owner.get('/api/assistant')).body;
  assert.equal(mine.wallet.balance, 750);
  assert.deepEqual(mine.models.map((m) => m.key), ['flash', 'pro']);
  await admin.put('/api/admin/assistant', { models: view.models, trial: 500 });
});

test('website pemakai asisten dan blokir', async () => {
  const owner = await stack.register('toko-asisten');
  await owner.put('/api/assistant', { enabled: true, modelKey: 'pro' });
  const siteOrigin = `http://toko-asisten.${stack.origin.slice(7)}`;
  stack.ai.script.push({ text: 'Halo.', usage: { prompt_tokens: 900, completion_tokens: 100 } });
  const chat = await stack.site('toko-asisten', '/api/ai/chat', { method: 'POST', json: { messages: [{ role: 'user', content: 'Halo' }] }, headers: { Origin: siteOrigin } });
  assert.equal(chat.status, 200);

  let site = (await admin.get('/api/admin/assistant')).body.sites.find((s) => s.slug === 'toko-asisten');
  assert.deepEqual(site, {
    slug: 'toko-asisten', username: 'toko-asisten', enabled: true, blocked: false, modelKey: 'pro',
    spentToday: 1.29, messagesToday: 1, spent30: 1.29, messages30: 1, siteUrl: siteOrigin,
  });

  const blocked = await admin.post('/api/admin/assistant/block', { slug: 'toko-asisten', blocked: 1 });
  assert.equal(blocked.status, 200);
  site = blocked.body.sites.find((s) => s.slug === 'toko-asisten');
  assert.deepEqual([site.blocked, site.enabled], [true, true]);
  const missing = await admin.post('/api/admin/assistant/block', { slug: 'tidak-ada', blocked: true });
  assert.deepEqual([missing.status, missing.body.error], [404, 'Project tidak ditemukan']);
  // Website yang belum pernah mengatur asisten juga bisa diblokir.
  await stack.register('belum-atur');
  const fresh = (await admin.post('/api/admin/assistant/block', { slug: 'belum-atur', blocked: true })).body.sites.find((s) => s.slug === 'belum-atur');
  assert.deepEqual([fresh.blocked, fresh.enabled, fresh.modelKey], [true, false, '']);
  await admin.post('/api/admin/assistant/block', { slug: 'toko-asisten', blocked: false });
});

test('statistik: pengguna, AI, kredit, pendapatan, langganan, penyimpanan, antrean', async () => {
  const a = await stack.register('statistik-a');
  const b = await stack.register('statistik-b');
  stack.ai.script.push({ text: 'ok', usage: { prompt_tokens: 1000, completion_tokens: 200 } }, { status: 500 });
  await a.prompt('satu');
  await a.prompt('dua');
  await b.post('/api/projects', { slug: 'statistik-b2' });
  await b.post('/api/database/tables', { name: 'catatan', columns: [] });
  const topup = (await b.post('/api/billing/topup', { packageId: 'p20' })).body.payment;
  await stack.paid(topup.id);
  const sub = (await b.post('/api/billing/subscribe', { planId: 'pro' })).body.payment;
  await stack.paid(sub.id);
  await a.post('/api/billing/topup', { packageId: 'p50' }); // belum dibayar

  const before = stack.db();
  const count = (sql) => before.prepare(sql).get().n;
  const { status, body: s } = await admin.get('/api/admin/stats?days=7');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(s).sort(), ['ai', 'creditUsers', 'credits', 'days', 'generatedAt', 'queue', 'recentPayments', 'recentUsers', 'revenue', 'revenueByDay', 'signupsByDay', 'storage', 'subscribers', 'topUsers', 'users']);
  assert.equal(s.days, 7);
  assert.ok(Math.abs(Date.parse(s.generatedAt) - Date.now()) < 10_000);
  assert.equal((await admin.get('/api/admin/stats?days=15')).body.days, 30);
  assert.equal((await admin.get('/api/admin/stats')).body.days, 30);
  assert.equal((await admin.get('/api/admin/stats?days=90')).body.signupsByDay.length, 90);

  // Pengguna
  const users = count('SELECT COUNT(*) AS n FROM users');
  assert.deepEqual(s.users, { total: users, projects: count('SELECT COUNT(*) AS n FROM projects'), inPeriod: users, today: users, activeSessions: count('SELECT COUNT(DISTINCT user_id) AS n FROM sessions') });
  assert.equal(s.signupsByDay.length, 7);
  assert.deepEqual(s.signupsByDay.at(-1), { date: today(), count: users });
  assert.deepEqual(s.signupsByDay[0].count, 0);
  assert.ok(s.signupsByDay.every((d, i) => i === 0 || d.date > s.signupsByDay[i - 1].date));

  // AI
  const requests = count('SELECT COUNT(*) AS n FROM ai_requests');
  assert.equal(s.ai.requests, requests);
  assert.equal(s.ai.currentModel, 'mock-main');
  assert.equal(s.ai.byStatus.error, 1);
  assert.equal(s.ai.byStatus.ok, requests - 1);
  assert.deepEqual(s.ai.models, [{ model: 'mock-main', requests }]);
  assert.deepEqual(Object.keys(s.ai).sort(), ['byDay', 'byStatus', 'currentModel', 'models', 'requests', 'tokensIn', 'tokensOut', 'users']);
  const day = s.ai.byDay.at(-1);
  assert.deepEqual([day.date, day.requests, day.failed, day.tokens], [today(), requests, 1, s.ai.tokensIn + s.ai.tokensOut]);
  assert.ok(s.ai.tokensIn >= 1000 && s.ai.tokensOut >= 200);

  // Kredit, langganan, pendapatan
  assert.equal(s.credits.freePerUser, 2);
  assert.equal(s.credits.purchasedOutstanding, 20);
  assert.equal(typeof s.credits.usedToday, 'number');
  assert.deepEqual(s.subscribers, { pro: 1 });
  assert.deepEqual(s.revenue, { allTime: 59000, inPeriod: 59000, paidCount: 2, creditsSold: 20, payingUsers: 1, pending: 1, livemode: false });
  assert.deepEqual(s.revenueByDay.at(-1), { date: today(), amount: 59000, count: 2 });
  assert.deepEqual(s.revenueByDay[0], { date: s.signupsByDay[0].date, amount: 0, count: 0 });
  assert.equal(s.recentPayments.length, 3);
  const paid = s.recentPayments.find((p) => p.packageId === 'plan:pro');
  assert.deepEqual({ ...paid, createdAt: 0, paidAt: '' }, { createdAt: 0, paidAt: '', status: 'succeeded', packageId: 'plan:pro', credits: 0, amount: 49000, livemode: false, username: 'statistik-b' });
  assert.equal(typeof paid.createdAt, 'number');
  assert.match(paid.paidAt, /^\d{4}-\d{2}-\d{2}T/);
  const pending = s.recentPayments.find((p) => p.packageId === 'p50');
  assert.deepEqual([pending.status, pending.paidAt, pending.username], ['pending', null, 'statistik-a']);

  // Pengguna teraktif & terbaru
  const top = s.topUsers.find((u) => u.username === 'statistik-a');
  assert.deepEqual({ ...top, createdAt: 0 }, { username: 'statistik-a', createdAt: 0, slug: 'statistik-a', aiRequests: 2, tokens: 1200, spent: 0, siteUrl: `http://statistik-a.${stack.origin.slice(7)}` });
  const recent = s.recentUsers.find((u) => u.username === 'statistik-b');
  assert.deepEqual({ ...recent, createdAt: 0 }, { username: 'statistik-b', email: 'statistik-b@test.local', createdAt: 0, slug: 'statistik-b', projects: 2, siteUrl: `http://statistik-b.${stack.origin.slice(7)}` });
  assert.ok(s.recentUsers.length <= 10);

  // Kredit per pengguna
  const ca = s.creditUsers.find((u) => u.username === 'statistik-a');
  assert.deepEqual({ ...ca, lastAt: '' }, {
    username: 'statistik-a', email: 'statistik-a@test.local', used: 0, freeLimit: 2, freeRemaining: 2, bonusLimit: 2, bonusUsed: 1, bonusRemaining: 1,
    purchased: 0, remaining: 3, aiRequests: 2, inTokens: 1000, outTokens: 200, tokens: 1200, lastAt: '', siteUrl: `http://statistik-a.${stack.origin.slice(7)}`,
  });
  assert.match(ca.lastAt, /^\d{4}-\d{2}-\d{2}T/);
  const cb = s.creditUsers.find((u) => u.username === 'statistik-b');
  assert.deepEqual([cb.purchased, cb.remaining, cb.aiRequests, cb.tokens, cb.lastAt], [20, 24, 0, 0, null]);
  assert.equal(s.creditUsers.length, users);

  // Penyimpanan (dihitung dari disk) dan antrean
  const sitesDir = path.join(stack.dataDir, 'sites');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [fs.statSync(path.join(dir, e.name)).size]));
  const sizes = walk(sitesDir);
  assert.deepEqual([s.storage.siteFiles, s.storage.siteBytes], [sizes.length, sizes.reduce((x, y) => x + y, 0)]);
  assert.ok(s.storage.dbBytes > 0);
  assert.equal(s.storage.projectsWithDatabase, fs.readdirSync(path.join(stack.dataDir, 'db')).filter((f) => f.endsWith('.db')).length);
  assert.match(s.storage.computedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(Object.keys(s.queue).sort(), ['active', 'currentLimit', 'maxConcurrent', 'maxWaitMs', 'medianWaitMs', 'queueMax', 'queueTimeoutSeconds', 'queued', 'queuedTotal', 'rejectedFull', 'retries', 'served', 'timedOut']);
  assert.deepEqual([s.queue.active, s.queue.queued, s.queue.maxConcurrent, s.queue.currentLimit, s.queue.queueMax, s.queue.queueTimeoutSeconds], [0, 0, 4, 4, 30, 120]);
});
