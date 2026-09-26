import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { HttpError } from './http-error.js';
import { cleanupSessions, loadUser } from './auth.js';
import { api } from './api.js';
import { kaseraWebhook } from './billing.js';
import { serveSite } from './sites.js';
import { siteApi } from './siteapi.js';
import { USERNAME_RE } from './username.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback'); // di belakang Caddy/Nginx di mesin yang sama

// Routing berdasarkan host: rakit.icu -> aplikasi, <user>.rakit.icu -> website user.
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
app.use('/api', api);

app.get('/', (req, res) => {
  if (req.user) return res.redirect('/editor');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/editor', (req, res) => {
  if (!req.user) return res.redirect('/');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'editor.html'));
});

app.use(express.static(PUBLIC_DIR, { index: false }));

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
  console.log(`rakit.icu berjalan di ${config.appOrigin}`);
  console.log(`Website user: ${config.siteUrl('<username>')}`);
});
