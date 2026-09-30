import express from 'express';
import { config } from './config.js';
import { q } from './db.js';
import { HttpError } from './http-error.js';
import { usernameError } from './username.js';
import { ai } from './ai.js';
import { billing } from './billing.js';
import { database } from './database.js';
import { diagrams } from './diagrams.js';
import { admin, isAdmin } from './admin.js';
import { createProject, loadProject, projects, publicProject, slugTaken } from './projects.js';
import { autoVersionBeforeEdit, versions } from './versions.js';
import { assistant } from './assistant.js';
import {
  clearSessionCookie, createSession, destroySession, hashPassword, rateLimit,
  requireAuth, requireSameOrigin, setSessionCookie, verifyPassword,
} from './auth.js';
import {
  createDir, limitsFor, listTree, MAX_IMAGE_BYTES, readText, removeEntry, renameEntry, usageOf, userRoot, writeImage, writeText,
} from './files.js';

export const api = express.Router();

api.use(express.json({ limit: '1mb' }));
api.use(requireSameOrigin);

// Batas per akun (atau per IP bila belum login) supaya satu pengguna tidak bisa membanjiri server.
// Auto-save normal hanya ±60 penulisan/menit.
const perAccount = (prefix) => (req) => `${prefix}:${req.user ? `u${req.user.id}` : req.ip}`;
const busy = 'Terlalu banyak permintaan dalam waktu singkat. Tunggu sebentar lalu coba lagi.';
const accountWriteLimiter = rateLimit({ windowMs: 60_000, max: 300, key: perAccount('w'), message: busy });
const accountReadLimiter = rateLimit({ windowMs: 60_000, max: 1200, key: perAccount('r'), message: busy });
api.use((req, res, next) => (['GET', 'HEAD'].includes(req.method) ? accountReadLimiter : accountWriteLimiter)(req, res, next));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Hash dummy supaya waktu respons login sama walau user tidak ada.
const DUMMY_HASH = await hashPassword('dummy-password');

const publicUser = (u) => ({ username: u.username, email: u.email });

api.get('/config', (req, res) => {
  res.json({ baseDomain: config.baseDomain, siteUrlPattern: config.siteUrl('{username}'), googleEnabled: config.google.enabled });
});

api.post('/register', authLimiter, async (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  const err = usernameError(username);
  if (err) throw new HttpError(400, err);
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Email tidak valid');
  if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Password minimal 8 karakter');
  // Project pertama memakai username sebagai subdomain, jadi keduanya harus belum dipakai.
  if (slugTaken(username)) throw new HttpError(409, 'Username sudah dipakai');
  if (q.userByEmail.get(email)) throw new HttpError(409, 'Email sudah terdaftar');

  let info;
  try {
    info = q.insertUser.run(username, email, await hashPassword(password), Date.now());
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Username atau email sudah dipakai');
    throw e;
  }
  const user = q.userByUsername.get(username);
  await createProject(user, { slug: username, name: username });

  setSessionCookie(res, createSession(user.id));
  res.status(201).json({ user: publicUser(user) });
});

api.post('/login', authLimiter, async (req, res) => {
  const login = String(req.body?.login ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const user = login ? q.userByLogin.get(login, login) : null;
  if (user && !user.password_hash) {
    throw new HttpError(400, 'Akun ini dibuat dengan Google. Silakan masuk dengan tombol "Lanjutkan dengan Google".');
  }
  const ok = await verifyPassword(password, user?.password_hash || DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Username/email atau password salah');

  setSessionCookie(res, createSession(user.id));
  res.json({ user: publicUser(user) });
});

api.post('/logout', (req, res) => {
  destroySession(req);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Akun + project aktif (dari header X-Project) + daftar semua project milik akun.
api.get('/me', requireAuth, loadProject, (req, res) => {
  res.json({
    user: { ...publicUser(req.user), isAdmin: isAdmin(req.user) },
    project: publicProject(req.project),
    projects: q.projectsOf.all(req.user.id).map(publicProject),
    maxProjects: config.maxProjects,
  });
});

api.use('/projects', projects);

// ---- File (milik project aktif) ----

api.use('/files', requireAuth, loadProject);
const rootOf = (req) => userRoot(req.project.slug);
// Sebelum file diubah, simpan versi otomatis (paling sering sekali per 10 menit).
api.use('/files', async (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) await autoVersionBeforeEdit(req.project, req.user.id);
  next();
});

api.get('/files', async (req, res) => {
  const files = await listTree(rootOf(req));
  res.json({ files, usage: usageOf(files, limitsFor(rootOf(req))) });
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

// Unggah gambar: body = isi file mentah, path & overwrite lewat query string.
api.post('/files/upload', express.raw({ type: () => true, limit: MAX_IMAGE_BYTES + 1024 }), async (req, res) => {
  const path = await writeImage(rootOf(req), req.query.path, req.body, { overwrite: req.query.overwrite === '1' });
  res.status(201).json({ path });
});

api.post('/files/rename', async (req, res) => {
  res.json({ path: await renameEntry(rootOf(req), req.body?.from, req.body?.to) });
});

api.delete('/files', async (req, res) => {
  await removeEntry(rootOf(req), req.query.path);
  res.json({ ok: true });
});

api.use('/ai', ai);
api.use('/billing', billing);
api.use('/database', database);
api.use('/versions', versions);
api.use('/assistant', assistant);
api.use('/diagrams', diagrams);
api.use('/admin', admin);

api.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
