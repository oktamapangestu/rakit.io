import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { q } from './db.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 hari

// __Host- mencegah subdomain user (mis. budi.rakit.icu) menimpa cookie sesi rakit.icu.
export const COOKIE_NAME = config.secureCookies ? '__Host-rakit_sid' : 'rakit_sid';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [, saltHex, keyHex] = stored.split('$');
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.insertSession.run(sha256(token), userId, Date.now() + SESSION_TTL);
  return token;
}

export function destroySession(req) {
  if (req.user) q.deleteSession.run(req.user.token_hash);
}

export function cleanupSessions() {
  q.deleteExpiredSessions.run(Date.now());
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: config.secureCookies,
  path: '/', // tanpa Domain => cookie tidak dikirim ke *.rakit.icu
});

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_TTL });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

function readCookie(header = '', name) {
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function loadUser(req, res, next) {
  const token = readCookie(req.headers.cookie, COOKIE_NAME);
  if (token) req.user = q.sessionUser.get(sha256(token), Date.now()) ?? null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu' });
  next();
}

// Semua *.rakit.icu dianggap "same-site" oleh browser, jadi SameSite=Lax saja tidak cukup
// untuk mencegah website user mengirim request ke API. Wajibkan Origin = origin aplikasi.
export function requireSameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const ok = origin ? origin === config.appOrigin : req.get('sec-fetch-site') === 'same-origin';
  if (!ok) return res.status(403).json({ error: 'Origin tidak diizinkan' });
  next();
}

export function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Terlalu banyak percobaan. Coba lagi nanti.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, hit] of hits) if (hit.reset <= now) hits.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const id = key(req);
    let hit = hits.get(id);
    if (!hit || hit.reset <= now) hits.set(id, (hit = { count: 0, reset: now + windowMs }));
    if (++hit.count > max) {
      res.set('Retry-After', String(Math.ceil((hit.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
