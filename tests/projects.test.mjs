// Project: daftar, buat (alamat acak atau custom), ganti nama & alamat, hapus, dan pemilihan project aktif lewat header X-Project.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack({ MAX_PROJECTS: '3', MAX_CUSTOM_DOMAINS: '2' }); });
after(() => stack?.stop());

test('buat project: subdomain sendiri dengan file awal; daftar berurutan', async () => {
  const user = await stack.register('ani');
  const res = await user.post('/api/projects', { slug: ' Toko-Ani ', name: '  Toko   Ani  ' });
  assert.equal(res.status, 201);
  assert.deepEqual({ ...res.body.project, createdAt: 0 }, {
    slug: 'toko-ani', name: 'Toko   Ani', siteUrl: `http://toko-ani.${stack.origin.slice(7)}`, siteHost: 'toko-ani.localhost', createdAt: 0, custom: true,
  });
  assert.ok(fs.existsSync(path.join(stack.dataDir, 'sites', 'toko-ani', 'index.html')));
  assert.equal((await stack.site('toko-ani', '/')).status, 200);

  const list = await user.get('/api/projects');
  assert.deepEqual([list.body.projects.map((p) => p.slug), list.body.limit, list.body.customLimit], [['ani', 'toko-ani'], 3, 2]);
  assert.equal(list.body.projects[0].custom, undefined, 'project username bukan alamat custom');
  assert.equal((await user.post('/api/projects', { slug: 'tanpa-nama' })).body.project.name, 'tanpa-nama');
  assert.equal((await user.post('/api/projects', { slug: 'x'.repeat(10), name: 'n'.repeat(80) })).status, 403, 'sudah 3 project');
  assert.equal((await stack.client().get('/api/projects')).status, 401);
});

test('buat project: validasi subdomain, bentrok, dan batas jumlah', async () => {
  const user = await stack.register('bayu');
  const other = await stack.register('citra');
  const cases = [
    [{ slug: 'ab' }, 400, 'Subdomain harus 3–30 karakter'],
    [{ slug: 'Nama Aneh' }, 400, /^Subdomain hanya boleh huruf kecil/],
    [{ slug: 'a--b' }, 400, 'Subdomain tidak boleh mengandung "--"'],
    [{ slug: 'admin' }, 400, 'Subdomain ini tidak tersedia'],
    [{ slug: 'bayu' }, 409, 'bayu.localhost sudah dipakai'],
    [{ slug: 'citra' }, 409, 'citra.localhost sudah dipakai'],
  ];
  for (const [body, status, message] of cases) {
    const res = await user.post('/api/projects', body);
    assert.equal(res.status, status, JSON.stringify(body));
    if (typeof message === 'string') assert.equal(res.body.error, message);
    else assert.match(res.body.error, message);
  }
  assert.equal((await other.post('/api/projects', { slug: 'milik-citra' })).status, 201);
  assert.equal((await user.post('/api/projects', { slug: 'milik-citra' })).status, 409);

  assert.equal((await user.post('/api/projects', { slug: 'bayu-2', name: 'x'.repeat(70) })).body.project.name.length, 60);
  assert.equal((await user.post('/api/projects', { slug: 'bayu-3' })).status, 201);
  const full = await user.post('/api/projects', { slug: 'bayu-4' });
  assert.deepEqual([full.status, full.body.error], [403, 'Maksimal 3 project per akun. Hapus project lama untuk membuat yang baru.']);
});

test('project aktif dipilih lewat X-Project; project orang lain selalu 404', async () => {
  const user = await stack.register('dewi');
  const other = await stack.register('eko');
  await user.post('/api/projects', { slug: 'dewi-toko', name: 'Toko' });

  assert.equal((await user.get('/api/me')).body.project.slug, 'dewi', 'tanpa header: project pertama');
  assert.equal((await user.req('GET', '/api/me', undefined, { 'X-Project': ' Dewi-Toko ' })).body.project.slug, 'dewi-toko');
  for (const slug of ['eko', 'tidak-ada']) {
    const res = await user.req('GET', '/api/me', undefined, { 'X-Project': slug });
    assert.deepEqual([res.status, res.body], [404, { error: 'Project tidak ditemukan' }], slug);
  }
  assert.equal((await other.get('/api/me')).body.projects.length, 1);
});

test('ganti nama project', async () => {
  const user = await stack.register('fajar');
  const other = await stack.register('gita');
  const res = await user.patch('/api/projects/FAJAR', { name: '  Portofolio Fajar ' });
  assert.deepEqual([res.status, res.body.project.name, res.body.project.slug], [200, 'Portofolio Fajar', 'fajar']);
  assert.equal((await user.patch('/api/projects/fajar', { name: '   ' })).body.error, 'Nama project tidak boleh kosong');
  assert.equal((await user.patch('/api/projects/fajar', {})).status, 400);
  assert.equal((await user.patch('/api/projects/fajar', { name: 'y'.repeat(99) })).body.project.name.length, 60);
  assert.equal((await other.patch('/api/projects/fajar', { name: 'Dibajak' })).status, 404);
  assert.equal((await user.patch('/api/projects/tidak-ada', { name: 'X' })).status, 404);
});

test('hapus project: file, database, dan riwayatnya ikut terhapus; project terakhir tidak bisa dihapus', async () => {
  const user = await stack.register('hadi');
  const other = await stack.register('indah');
  const last = await user.del('/api/projects/hadi');
  assert.deepEqual([last.status, last.body.error], [409, 'Project terakhir tidak bisa dihapus']);

  await user.post('/api/projects', { slug: 'hadi-lama', name: 'Lama' });
  const headers = { 'X-Project': 'hadi-lama' };
  await user.req('POST', '/api/database/tables', { name: 'catatan', columns: [{ name: 'isi', type: 'text' }] }, headers);
  await user.req('POST', '/api/versions', { label: 'awal' }, headers);
  const paths = ['sites/hadi-lama', 'db/hadi-lama.db', 'versions/hadi-lama'].map((p) => path.join(stack.dataDir, p));
  for (const p of paths) assert.ok(fs.existsSync(p), p);

  assert.equal((await other.del('/api/projects/hadi-lama')).status, 404);
  const res = await user.del('/api/projects/Hadi-Lama');
  assert.deepEqual([res.status, res.body], [200, { ok: true }]);
  for (const p of paths) assert.ok(!fs.existsSync(p), p);
  assert.equal(stack.db().prepare("SELECT COUNT(*) AS n FROM versions v JOIN projects p ON p.id = v.project_id WHERE p.slug = 'hadi-lama'").get().n, 0);
  assert.match((await stack.site('hadi-lama', '/')).body, /Situs tidak ditemukan/);
  assert.deepEqual((await user.get('/api/projects')).body.projects.map((p) => p.slug), ['hadi']);
  assert.equal((await user.del('/api/projects/hadi-lama')).status, 404);
  // Subdomain yang sudah dilepas bisa dipakai orang lain.
  assert.equal((await other.post('/api/projects', { slug: 'hadi-lama' })).status, 201);
});

test('project tidak bisa dihapus selagi AI bekerja di dalamnya', async () => {
  const user = await stack.register('joko');
  await user.post('/api/projects', { slug: 'joko-ai' });
  const headers = { 'X-Project': 'joko-ai' };
  stack.ai.script.push({ hang: true });
  const called = stack.ai.nextRequest();
  const started = await user.req('POST', '/api/ai/prompt', { prompt: 'lama', mode: 'plan' }, headers);
  await called;
  const res = await user.del('/api/projects/joko-ai');
  assert.deepEqual([res.status, res.body.error], [409, 'AI sedang bekerja di project ini. Tunggu selesai atau tekan Stop.']);
  await user.post(`/api/ai/jobs/${started.body.assistantMessage.id}/cancel`);
  await user.finishJob(started.body.assistantMessage.id);
  assert.equal((await user.del('/api/projects/joko-ai')).status, 200);
});

test('project tanpa subdomain mendapat alamat acak; alamat custom dibatasi per akun', async () => {
  const user = await stack.register('kirana');
  const random = await user.post('/api/projects', { slug: '  ', name: 'Coba' });
  assert.equal(random.status, 201);
  const { slug } = random.body.project;
  assert.match(slug, /^web-[a-z2-9]{6}$/);
  assert.deepEqual([random.body.project.name, random.body.project.custom], ['Coba', undefined]);
  assert.ok(fs.existsSync(path.join(stack.dataDir, 'sites', slug, 'index.html')));
  assert.equal((await stack.site(slug, '/')).status, 200);
  assert.equal((await user.post('/api/projects', {})).body.project.name.slice(0, 4), 'web-', 'tanpa nama: nama = alamat');

  // Batas custom (2 di test ini) dihitung per akun, terpisah dari batas jumlah project.
  const other = await stack.register('mira');
  assert.equal((await other.post('/api/projects', { slug: 'mira-1' })).status, 201);
  assert.equal((await other.post('/api/projects/mira/address', { slug: 'mira-2' })).status, 200);
  const full = await other.post('/api/projects', { slug: 'mira-3' });
  assert.deepEqual([full.status, full.body.error],
    [403, 'Maksimal 2 alamat custom per akun. Pakai alamat acak, atau ganti project lain ke alamat acak dulu.']);
  assert.equal((await other.post('/api/projects', {})).status, 201, 'alamat acak tetap boleh');
});

test('ganti alamat: file, database, dan versi ikut pindah; alamat lama dilepas; kuota custom berlaku', async () => {
  const user = await stack.register('nadia');
  const other = await stack.register('oki');
  const { slug: first } = (await user.post('/api/projects', { name: 'Toko' })).body.project;
  const headers = { 'X-Project': first };
  await user.req('PUT', '/api/files/content', { path: 'index.html', content: '<h1>Toko Nadia</h1>' }, headers);
  await user.req('POST', '/api/database/tables', { name: 'catatan', columns: [{ name: 'isi', type: 'text' }] }, headers);
  await user.req('POST', '/api/versions', { label: 'awal' }, headers);

  const res = await user.post(`/api/projects/${first}/address`, { slug: ' Toko-Nadia ' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.project.slug, res.body.project.custom, res.body.project.name], ['toko-nadia', true, 'Toko']);
  for (const p of ['sites/toko-nadia', 'db/toko-nadia.db', 'versions/toko-nadia']) assert.ok(fs.existsSync(path.join(stack.dataDir, p)), p);
  for (const p of [`sites/${first}`, `db/${first}.db`, `versions/${first}`]) assert.ok(!fs.existsSync(path.join(stack.dataDir, p)), p);
  assert.match((await stack.site('toko-nadia', '/')).body, /Toko Nadia/);
  assert.match((await stack.site(first, '/')).body, /Situs tidak ditemukan/);
  const moved = { 'X-Project': 'toko-nadia' };
  assert.equal((await user.req('GET', '/api/database/tables', undefined, moved)).body.tables[0].name, 'catatan');
  assert.equal((await user.req('GET', '/api/versions', undefined, moved)).body.versions.length >= 1, true);

  // Bentrok, milik orang lain, dan kuota custom (2): project username tidak dihitung.
  assert.equal((await user.post('/api/projects/toko-nadia/address', { slug: 'oki' })).status, 409);
  assert.equal((await user.post('/api/projects/toko-nadia/address', { slug: 'a--b' })).status, 400);
  assert.equal((await other.post('/api/projects/toko-nadia/address', { slug: 'dibajak' })).status, 404);
  await user.post('/api/projects', { slug: 'nadia-dua' });
  const limit = await user.post('/api/projects/nadia/address', { slug: 'nadia-tiga' });
  assert.equal(limit.status, 403);
  // Mengganti alamat custom ke alamat custom lain tidak menambah pemakaian.
  assert.equal((await user.post('/api/projects/nadia-dua/address', { slug: 'nadia-baru' })).status, 200);

  // Kembali ke alamat acak membebaskan kuota; alamat yang dilepas bisa dipakai orang lain.
  const back = await user.post('/api/projects/toko-nadia/address', {});
  assert.match(back.body.project.slug, /^web-/);
  assert.equal(back.body.project.custom, undefined);
  assert.equal((await user.post('/api/projects/nadia/address', { slug: 'nadia-tiga' })).status, 200);
  assert.equal((await user.post('/api/projects/nadia-tiga/address', { slug: 'nadia' })).body.project.custom, undefined, 'kembali ke username');
  assert.equal((await other.post('/api/projects', { slug: 'toko-nadia' })).status, 201);
});
