import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { HttpError } from './http-error.js';
import { cleanupSessions, loadUser } from './auth.js';
import { api } from './api.js';
import { kaseraWebhook } from './billing.js';
import { serveSite } from './sites.js';
import { siteApi } from './siteapi.js';
import { isAdmin } from './admin.js';
import { google } from './google.js';
import { USERNAME_RE } from './username.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

// Cache-busting aset: sisipkan ?v=<hash> pada referensi aset (src/href) yang menunjuk
// ke berkas di /js, /css, atau /logo.svg. Hash dihitung dari isi berkas, di-cache di memori, dan
// dihitung ulang otomatis saat berkas berubah (mtime). Tujuannya agar aset bisa dipasang
// Cache-Control immutable (1 tahun) tanpa risiko pengunjung memakai versi lama.
const assetVersionCache = new Map();
function assetVersion(relPath) {
  const abs = path.join(PUBLIC_DIR, relPath);
  try {
    const { mtimeMs } = fs.statSync(abs);
    const cached = assetVersionCache.get(relPath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.hash;
    const hash = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 10);
    assetVersionCache.set(relPath, { mtimeMs, hash });
    return hash;
  } catch {
    return null;
  }
}

// Ubah referensi aset lokal menjadi ber-versi. Contoh:
//   /js/editor.js  ->  /js/editor.js?v=ab12cd34ef
// Hanya menyentuh /js/..., /css/..., dan /logo.svg (tanpa protokol/host).
function withAssetVersions(html) {
  return html.replace(/(["'])\/((?:js|css)\/[^"'?#]+|logo\.svg)(?:[?#][^"']*)?\1/g, (m, q, rel) => {
    const v = assetVersion(rel);
    return v ? `${q}/${rel}?v=${v}${q}` : m;
  });
}

function sendHtml(req, res, file, headers = {}) {
  const abs = path.join(PUBLIC_DIR, file);
  let html;
  try {
    html = withAssetVersions(fs.readFileSync(abs, 'utf8'));
  } catch {
    return res.status(404).send('Not found');
  }
  res.set({ 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.send(html);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // di belakang Caddy/Nginx di mesin yang sama

// Routing berdasarkan host: rakit.io -> aplikasi, <user>.rakit.io -> website user.
app.use((req, res, next) => {
  const host = (req.hostname || '').toLowerCase();
  if (host === config.baseDomain) return next();

  const suffix = `.${config.baseDomain}`;
  if (host.endsWith(suffix)) {
    const sub = host.slice(0, -suffix.length);
    if (sub === 'www') return res.redirect(301, config.appOrigin + req.originalUrl);
    if (!USERNAME_RE.test(sub)) return res.status(404).send('Not found');
    req.siteUser = sub;
    if (req.path === '/api' || req.path.startsWith('/api/')) return siteApi(req, res, next);
    return serveSite(req, res, sub).catch(next);
  }
  // Akses lewat IP / host lain -> arahkan ke domain utama.
  return res.redirect(302, config.appOrigin + req.originalUrl);
});

app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});

// Webhook Kasera: body mentah (untuk verifikasi tanda tangan), tanpa sesi & tanpa cek Origin.
app.post('/api/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }), kaseraWebhook);

app.use(loadUser);
app.use('/auth/google', google);
app.use('/api', api);

app.get('/', (req, res) => {
  if (req.user) return res.redirect('/editor');
  sendHtml(req, res, 'index.html', { 'Cache-Control': 'no-cache' });
});

app.get('/editor', (req, res) => {
  if (!req.user) return res.redirect('/');
  sendHtml(req, res, 'editor.html', { 'Cache-Control': 'no-store' });
});

app.get('/admin', (req, res) => {
  if (!req.user) return res.redirect('/');
  if (!isAdmin(req.user)) return res.redirect('/editor');
  sendHtml(req, res, 'admin.html', { 'Cache-Control': 'no-store' });
});

// Panduan publik: cheat sheet prompt untuk AI Builder (tanpa perlu login).
app.get('/panduan', (req, res) => {
  sendHtml(req, res, 'panduan.html', { 'Cache-Control': 'public, max-age=3600' });
});

// Aset statis (/js, /css, /logo.svg ...). Karena nama berkas BER-VERSI (?v=hash) dari
// sendHtml, aman dipasang cache panjang + immutable: pengunjung tak perlu revalidasi,
// dan saat berkas berubah hash ikut berubah sehingga otomatis termuat ulang.
app.use(express.static(PUBLIC_DIR, {
  index: false,
  etag: true,
  lastModified: true,
  maxAge: '1y',
  immutable: true,
  setHeaders(res, filePath) {
    // HTML tetap no-cache agar selalu segar; hanya aset yang boleh panjang.
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON tidak valid' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request terlalu besar' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server' });
});

setInterval(cleanupSessions, 60 * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`rakit.io berjalan di ${config.appOrigin}`);
  console.log(`Website user: ${config.siteUrl('<username>')}`);
});
