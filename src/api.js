import express from 'express';
import { config } from './config.js';
import { q } from './db.js';
import { HttpError } from './http-error.js';
import { usernameError } from './username.js';
import { ai } from './ai.js';
import {
  clearSessionCookie, createSession, destroySession, hashPassword, rateLimit,
  requireAuth, requireSameOrigin, setSessionCookie, verifyPassword,
} from './auth.js';
import {
  createDir, listTree, readText, removeEntry, renameEntry, seedTemplate, usageOf,
  userRoot, writeText,
} from './files.js';

export const api = express.Router();

api.use(express.json({ limit: '1mb' }));
api.use(requireSameOrigin);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Hash dummy supaya waktu respons login sama walau user tidak ada.
const DUMMY_HASH = await hashPassword('dummy-password');

const publicUser = (u) => ({
  username: u.username,
  email: u.email,
  siteUrl: config.siteUrl(u.username),
  siteHost: config.siteHost(u.username),
});

api.get('/config', (req, res) => {
  res.json({ baseDomain: config.baseDomain, siteUrlPattern: config.siteUrl('{username}') });
});

api.post('/register', authLimiter, async (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  const err = usernameError(username);
  if (err) throw new HttpError(400, err);
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Email tidak valid');
  if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Password minimal 8 karakter');
  if (q.userByUsername.get(username)) throw new HttpError(409, 'Username sudah dipakai');
  if (q.userByEmail.get(email)) throw new HttpError(409, 'Email sudah terdaftar');

  let info;
  try {
    info = q.insertUser.run(username, email, await hashPassword(password), Date.now());
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Username atau email sudah dipakai');
    throw e;
  }
  await seedTemplate(username);

  setSessionCookie(res, createSession(info.lastInsertRowid));
  res.status(201).json({ user: publicUser({ username, email }) });
});

api.post('/login', authLimiter, async (req, res) => {
  const login = String(req.body?.login ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const user = login ? q.userByLogin.get(login, login) : null;
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Username/email atau password salah');

  setSessionCookie(res, createSession(user.id));
  res.json({ user: publicUser(user) });
});

api.post('/logout', (req, res) => {
  destroySession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});

api.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---- File ----

api.use('/files', requireAuth);
const rootOf = (req) => userRoot(req.user.username);

api.get('/files', async (req, res) => {
  const files = await listTree(rootOf(req));
  res.json({ files, usage: usageOf(files) });
});

api.get('/files/content', async (req, res) => {
  res.json({ content: await readText(rootOf(req), req.query.path) });
});

api.put('/files/content', async (req, res) => {
  const path = await writeText(rootOf(req), req.body?.path, req.body?.content);
  res.json({ path });
});

api.post('/files', async (req, res) => {
  const { path, type } = req.body ?? {};
  const created = type === 'dir'
    ? await createDir(rootOf(req), path)
    : await writeText(rootOf(req), path, '', { create: true });
  res.status(201).json({ path: created });
});

api.post('/files/rename', async (req, res) => {
  res.json({ path: await renameEntry(rootOf(req), req.body?.from, req.body?.to) });
});

api.delete('/files', async (req, res) => {
  await removeEntry(rootOf(req), req.query.path);
  res.json({ ok: true });
});

api.use('/ai', ai);

api.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
