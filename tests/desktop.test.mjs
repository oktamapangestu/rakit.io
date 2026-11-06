// Mode aplikasi desktop (DESKTOP=1): masuk otomatis ke akun lokal lewat token aplikasi, dan proxy webview (macOS).
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, test } from 'node:test';
import { startStack } from './helpers/harness.mjs';

let stack;
before(async () => { stack = await startStack({ DESKTOP: '1', DESKTOP_TOKEN: 'token-aplikasi', DESKTOP_PROXY: '1' }); });
after(() => stack?.stop());

const port = () => new URL(stack.origin).port;

test('token salah ditolak; token benar membuat akun lokal + project, lalu masuk ke editor', async () => {
  const anon = stack.client();
  assert.equal((await anon.raw('GET', '/desktop/start?token=salah')).status, 403);
  assert.equal((await anon.raw('GET', '/desktop/start')).status, 403);

  const app = stack.client();
  const res = await app.raw('GET', '/desktop/start?token=token-aplikasi');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/editor');
  const me = (await app.get('/api/me')).body;
  assert.equal(me.user.username, 'lokal');
  assert.deepEqual(me.projects.map((p) => [p.slug, p.name]), [['lokal', 'Project pertama']]);

  // Membuka lagi (aplikasi dijalankan ulang): akun yang sama, tidak membuat project baru.
  const again = stack.client();
  await again.raw('GET', '/desktop/start?token=token-aplikasi');
  assert.equal((await again.get('/api/me')).body.projects.length, 1);
});

// Request proxy: request-target berupa URL lengkap (absolute-form), seperti yang dikirim webview ke proxy.
const viaProxy = (url) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: port(), path: url, headers: { Host: new URL(url).host } }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});

test('proxy: website project dilayani langsung, host luar (port lain) diteruskan', async () => {
  const site = await viaProxy(`http://lokal.localhost:${port()}/`);
  assert.equal(site.status, 200);
  assert.match(site.body, /<html/i);
  // Mock AI berjalan di 127.0.0.1 port lain: diteruskan apa adanya.
  const models = await viaProxy(`${stack.ai.url}/v1/models`);
  assert.equal(models.status, 200);
  assert.deepEqual(JSON.parse(models.body).data.map((m) => m.id), ['mock-main', 'mock-pribadi']);
});

test('proxy: CONNECT membuka terowongan TCP ke host luar', async () => {
  const target = new URL(stack.ai.url);
  const sock = net.connect(Number(port()), '127.0.0.1');
  await new Promise((r) => sock.once('connect', r));
  sock.write(`CONNECT ${target.host} HTTP/1.1\r\nHost: ${target.host}\r\n\r\n`);
  let data = '';
  sock.on('data', (c) => { data += c; });
  await new Promise((r) => { const t = setInterval(() => { if (data.includes('\r\n\r\n')) { clearInterval(t); r(); } }, 10); });
  assert.match(data, /^HTTP\/1\.1 200/);
  data = '';
  sock.write(`GET /v1/models HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`);
  await new Promise((r) => sock.once('end', r));
  assert.match(data, /mock-pribadi/);
});
