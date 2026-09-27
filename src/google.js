import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { q } from './db.js';
import { createSession, rateLimit, setSessionCookie } from './auth.js';
import { createProject, slugTaken } from './projects.js';
import { usernameError } from './username.js';

// Masuk/daftar dengan Google (OAuth 2.0 authorization code + PKCE).
// Di Google Cloud Console, daftarkan redirect URI: <APP_ORIGIN>/auth/google/callback

export const google = express.Router();

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FLOW_COOKIE = config.secureCookies ? '__Host-rakit_oauth' : 'rakit_oauth';
const FLOW_TTL_MS = 10 * 60 * 1000;

const redirectUri = () => `${config.appOrigin}/auth/google/callback`;
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const fail = (res, message) => res.redirect(`/?error=${encodeURIComponent(message)}`);

google.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 60 }));

google.get('/', (req, res) => {
  if (!config.google.enabled) return fail(res, 'Login dengan Google belum diaktifkan');
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  // Cookie Lax ikut terkirim saat Google mengarahkan kembali (navigasi GET tingkat atas).
  res.cookie(FLOW_COOKIE, `${state}.${verifier}`, {
    httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: FLOW_TTL_MS,
  });
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  res.redirect(`${AUTH_URL}?${params}`);
});

// Username otomatis dari email (juga jadi subdomain project pertama), dibuat unik bila perlu.
function usernameFromEmail(email) {
  let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (base.length < 3) base = `${base}web`.slice(0, 3).padEnd(3, '0');
  base = base.slice(0, 24).replace(/-$/, '');
  if (!usernameError(base) && !slugTaken(base)) return base;
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}-${crypto.randomInt(100, 10000)}`;
    if (!usernameError(candidate) && !slugTaken(candidate)) return candidate;
  }
  return `web-${crypto.randomInt(100000, 1000000)}`;
}

google.get('/callback', async (req, res) => {
  const flow = readCookie(req, FLOW_COOKIE);
  res.clearCookie(FLOW_COOKIE, { path: '/', secure: config.secureCookies, httpOnly: true, sameSite: 'lax' });
  if (!config.google.enabled) return fail(res, 'Login dengan Google belum diaktifkan');
  if (req.query.error) return fail(res, 'Login dengan Google dibatalkan');

  const [state, verifier] = (flow ?? '').split('.');
  const given = String(req.query.state ?? '');
  if (!state || !verifier || given.length !== state.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(state))) {
    return fail(res, 'Sesi login Google kedaluwarsa. Coba lagi.');
  }

  // Tukar kode dengan token langsung ke Google (lewat HTTPS), jadi id_token bisa dipercaya
  // tanpa verifikasi tanda tangan terpisah; klaim tetap dicek.
  let claims;
  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code ?? ''),
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.id_token) throw new Error(token.error_description || token.error || `HTTP ${tokenRes.status}`);
    claims = JSON.parse(Buffer.from(token.id_token.split('.')[1], 'base64url').toString('utf8'));
  } catch (err) {
    console.error('Google OAuth:', err.message);
    return fail(res, 'Gagal masuk dengan Google. Coba lagi.');
  }

  const validIssuer = ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss);
  if (!validIssuer || claims.aud !== config.google.clientId || claims.exp * 1000 < Date.now() || !claims.sub) {
    return fail(res, 'Token Google tidak valid');
  }
  if (!claims.email || claims.email_verified !== true) {
    return fail(res, 'Email Google kamu belum terverifikasi');
  }
  const email = String(claims.email).toLowerCase();

  let user = q.userByGoogle.get(claims.sub);
  if (!user) {
    if (q.userByEmail.get(email)) {
      // Jangan tautkan otomatis: pendaftaran dengan password tidak memverifikasi email, jadi akun itu
      // bisa saja dibuat orang lain memakai email ini (lalu ikut menguasai akun setelah ditautkan).
      return fail(res, 'Email ini sudah terdaftar dengan password. Silakan masuk memakai username/email dan password.');
    }
    {
      const username = usernameFromEmail(email);
      // password_hash kosong = akun hanya bisa masuk lewat Google.
      const { lastInsertRowid } = q.insertUser.run(username, email, '', Date.now());
      q.linkGoogle.run(claims.sub, Number(lastInsertRowid));
      user = q.userByUsername.get(username);
      await createProject(user, { slug: username, name: claims.name || username });
    }
  }

  setSessionCookie(res, createSession(user.id));
  res.redirect('/editor');
});
