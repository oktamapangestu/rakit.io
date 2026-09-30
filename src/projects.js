import fs from 'node:fs/promises';
import express from 'express';
import { config } from './config.js';
import { db, q } from './db.js';
import { HttpError } from './http-error.js';
import { requireAuth } from './auth.js';
import { seedTemplate, userRoot } from './files.js';
import { removeDatabase } from './userdb.js';
import { removeVersions } from './versions.js';
import { slugError } from './username.js';

// Project = workspace dengan subdomain sendiri (<slug>.rakit.icu): file, database, preview, dan
// riwayat AI-nya terpisah. Kredit AI tetap milik akun, dipakai bersama semua project.

export const publicProject = (p) => ({
  slug: p.slug,
  name: p.name,
  siteUrl: config.siteUrl(p.slug),
  siteHost: config.siteHost(p.slug),
  createdAt: p.created_at,
});

export function normalizeSlug(value) {
  const slug = String(value ?? '').trim().toLowerCase();
  const err = slugError(slug);
  if (err) throw new HttpError(400, err);
  return slug;
}

export const slugTaken = (slug) => Boolean(q.projectBySlug.get(slug) || q.userByUsername.get(slug));

/** Buat project baru beserta file awalnya. */
export async function createProject(user, { slug: rawSlug, name }) {
  const slug = normalizeSlug(rawSlug);
  if (q.projectCount.get(user.id).n >= config.maxProjects) {
    throw new HttpError(403, `Maksimal ${config.maxProjects} project per akun. Hapus project lama untuk membuat yang baru.`);
  }
  // Username orang lain juga dicadangkan, karena project pertama tiap akun memakai username-nya.
  if (q.projectBySlug.get(slug) || (q.userByUsername.get(slug) && q.userByUsername.get(slug).id !== user.id)) {
    throw new HttpError(409, `${config.siteHost(slug)} sudah dipakai`);
  }
  const title = String(name ?? '').trim().slice(0, 60) || slug;
  try {
    q.insertProject.run(user.id, slug, title, Date.now());
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, `${config.siteHost(slug)} sudah dipakai`);
    throw err;
  }
  await seedTemplate(slug);
  return q.projectBySlug.get(slug);
}

/**
 * Tentukan project aktif dari header X-Project (atau project pertama milik user).
 * Project milik orang lain selalu ditolak 404.
 */
export function loadProject(req, res, next) {
  const wanted = String(req.get('x-project') ?? '').trim().toLowerCase();
  let project = null;
  if (wanted) {
    project = q.projectBySlug.get(wanted);
    if (!project || project.user_id !== req.user.id) throw new HttpError(404, 'Project tidak ditemukan');
  } else {
    project = q.projectsOf.get(req.user.id);
  }
  if (!project) throw new HttpError(409, 'Kamu belum punya project. Buat project baru dulu.');
  req.project = project;
  next();
}

// ---------- Route /api/projects ----------

export const projects = express.Router();
projects.use(requireAuth);

const activeJobIn = db.prepare(`
  SELECT 1 FROM ai_messages m JOIN ai_threads t ON t.id = m.thread_id
  WHERE t.project_id = ? AND m.role = 'assistant' AND m.status IN ('queued', 'running') LIMIT 1
`);

projects.get('/', (req, res) => {
  res.json({ projects: q.projectsOf.all(req.user.id).map(publicProject), limit: config.maxProjects });
});

projects.post('/', async (req, res) => {
  const project = await createProject(req.user, req.body ?? {});
  res.status(201).json({ project: publicProject(project) });
});

function ownedProject(req) {
  const project = q.projectBySlug.get(String(req.params.slug).toLowerCase());
  if (!project || project.user_id !== req.user.id) throw new HttpError(404, 'Project tidak ditemukan');
  return project;
}

projects.patch('/:slug', (req, res) => {
  const project = ownedProject(req);
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'Nama project tidak boleh kosong');
  q.renameProject.run(name, project.id);
  res.json({ project: publicProject(q.projectBySlug.get(project.slug)) });
});

projects.delete('/:slug', async (req, res) => {
  const project = ownedProject(req);
  if (q.projectCount.get(req.user.id).n <= 1) throw new HttpError(409, 'Project terakhir tidak bisa dihapus');
  if (activeJobIn.get(project.id)) throw new HttpError(409, 'AI sedang bekerja di project ini. Tunggu selesai atau tekan Stop.');
  q.deleteProject.run(project.id); // riwayat AI project ikut terhapus (ON DELETE CASCADE)
  removeDatabase(project.slug);
  await fs.rm(userRoot(project.slug), { recursive: true, force: true });
  await removeVersions(project.slug);
  res.json({ ok: true });
});
