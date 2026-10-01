// Masuk/daftar dengan Google (OAuth 2.0 + PKCE). Endpoint token Google diganti server tiruan.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack(); });
after(() => stack?.stop());

const claims = (extra = {}) => ({
  iss: 'https://accounts.google.com', aud: 'google-client-test', sub: `g-${crypto.randomUUID()}`,
  exp: Math.floor(Date.now() / 1000) + 600, email: 'Orang@Gmail.com', email_verified: true, name: 'Orang Baik', ...extra,
});

/** Langkah 1: buka /auth/google, kembalikan { client, state, location }. */
async function begin() {
  const client = stack.client();
  const res = await client.raw('GET', '/auth/google');
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  return { client, location, state: location.searchParams.get('state'), setCookie: res.headers.getSetCookie().join('\n') };
}

/** Langkah 2: Google mengarahkan kembali ke /auth/google/callback. */
async function finish(flow, idClaims, query) {
  stack.google.claims = idClaims;
  const res = await flow.client.raw('GET', `/auth/google/callback?${query ?? `code=kode-123&state=${flow.state}`}`);
  const location = res.headers.get('location');
  return { status: res.status, location, error: location?.startsWith('/?error=') ? decodeURIComponent(location.slice(8)) : null };
}

test('mengarahkan ke Google dengan PKCE dan menyimpan state di cookie', async () => {
  const { location, state, setCookie, client } = await begin();
  assert.equal(location.origin + location.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const p = location.searchParams;
  assert.equal(p.get('client_id'), 'google-client-test');
  assert.equal(p.get('redirect_uri'), `${stack.origin}/auth/google/callback`);
  assert.equal(p.get('response_type'), 'code');
  assert.equal(p.get('scope'), 'openid email profile');
  assert.equal(p.get('code_challenge_method'), 'S256');
  assert.equal(p.get('prompt'), 'select_account');
  assert.match(setCookie, /^rakit_oauth=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Max-Age=600/);

  const [cookieState, verifier] = client.cookies.get('rakit_oauth').split('.');
  assert.equal(cookieState, state);
  assert.equal(p.get('code_challenge'), crypto.createHash('sha256').update(verifier).digest('base64url'));
});

test('akun baru dari Google: username dari email, project pertama, langsung masuk', async () => {
  const flow = await begin();
  const id = claims({ email: 'Rina.Wati@Gmail.com', name: 'Rina Wati' });
  const res = await finish(flow, id);
  assert.deepEqual([res.status, res.location], [302, '/editor']);

  const sent = stack.google.requests.at(-1);
  assert.equal(sent.code, 'kode-123');
  assert.equal(sent.grant_type, 'authorization_code');
  assert.equal(sent.client_secret, 'google-secret-test');
  assert.equal(sent.redirect_uri, `${stack.origin}/auth/google/callback`);
  assert.equal(sent.code_verifier, (await 0, sent.code_verifier));
  assert.ok(!flow.client.cookies.has('rakit_oauth'), 'cookie alur login dihapus');

  const me = (await flow.client.get('/api/me')).body;
  assert.deepEqual(me.user, { username: 'rina-wati', email: 'rina.wati@gmail.com', isAdmin: false });
  assert.deepEqual([me.project.slug, me.project.name], ['rina-wati', 'Rina Wati']);
  const row = stack.db().prepare('SELECT password_hash, google_id FROM users WHERE username = ?').get('rina-wati');
  assert.deepEqual({ ...row }, { password_hash: '', google_id: id.sub });

  // Masuk lagi dengan akun Google yang sama: akun yang sama, bukan akun baru.
  const again = await begin();
  assert.equal((await finish(again, id)).location, '/editor');
  assert.equal((await again.client.get('/api/me')).body.user.username, 'rina-wati');
  assert.equal(stack.db().prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('rina.wati@gmail.com').n, 1);

  // Akun Google tidak punya password.
  const login = await stack.client().post('/api/login', { login: 'rina-wati', password: 'apa-saja-123' });
  assert.equal(login.status, 400);
  assert.match(login.body.error, /Akun ini dibuat dengan Google/);
});

test('username dari email dibuat valid dan unik', async () => {
  await stack.register('sama');
  const names = [];
  for (const email of ['sama@gmail.com', 'a@gmail.com', 'Nama_Panjang.Sekali+tag.yang-melebihi-batas@gmail.com', 'admin@gmail.com']) {
    const flow = await begin();
    assert.equal((await finish(flow, claims({ email }))).location, '/editor', email);
    names.push((await flow.client.get('/api/me')).body.user.username);
  }
  assert.match(names[0], /^sama-\d{3,4}$/);
  assert.equal(names[1], 'awe');
  assert.equal(names[2], 'nama-panjang-sekali-tag');
  assert.match(names[3], /^admin-\d{3,4}$/);
});

test('email yang sudah terdaftar dengan password tidak ditautkan otomatis', async () => {
  await stack.register('punya-sandi', 'sandi@gmail.com');
  const flow = await begin();
  const res = await finish(flow, claims({ email: 'sandi@gmail.com' }));
  assert.match(res.error, /Email ini sudah terdaftar dengan password/);
  assert.equal((await flow.client.get('/api/me')).status, 401);
  assert.equal(stack.db().prepare('SELECT google_id FROM users WHERE username = ?').get('punya-sandi').google_id, null);
});

test('callback yang tidak sah ditolak', async () => {
  const cases = [
    [claims({ email_verified: false }), undefined, 'Email Google kamu belum terverifikasi'],
    [claims({ email: undefined }), undefined, 'Email Google kamu belum terverifikasi'],
    [claims({ aud: 'aplikasi-lain' }), undefined, 'Token Google tidak valid'],
    [claims({ iss: 'https://palsu.example' }), undefined, 'Token Google tidak valid'],
    [claims({ exp: Math.floor(Date.now() / 1000) - 10 }), undefined, 'Token Google tidak valid'],
    [claims({ sub: '' }), undefined, 'Token Google tidak valid'],
    [claims(), 'code=x&state=state-salah', 'Sesi login Google kedaluwarsa. Coba lagi.'],
    [claims(), 'code=x', 'Sesi login Google kedaluwarsa. Coba lagi.'],
    [claims(), 'error=access_denied', 'Login dengan Google dibatalkan'],
  ];
  for (const [id, query, message] of cases) {
    const flow = await begin();
    const res = await finish(flow, id, query);
    assert.deepEqual([res.status, res.error], [302, message]);
    assert.equal((await flow.client.get('/api/me')).status, 401);
  }
  // Tanpa cookie alur login (mis. link callback dibuka langsung).
  const direct = await finish({ client: stack.client(), state: 'apa-saja' }, claims());
  assert.equal(direct.error, 'Sesi login Google kedaluwarsa. Coba lagi.');

  stack.google.fail = true;
  try {
    assert.equal((await finish(await begin(), claims())).error, 'Gagal masuk dengan Google. Coba lagi.');
  } finally {
    stack.google.fail = false;
  }
});
