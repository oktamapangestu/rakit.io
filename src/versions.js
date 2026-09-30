import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './http-error.js';
import { requireAuth } from './auth.js';
import { loadProject } from './projects.js';
import {
  cleanPath, IMAGE_TYPES, isImageFile, isServableFile, limitsFor, listTree, resolveIn, statOrNull, userRoot,
} from './files.js';
import { historyFor } from './plans.js';

// Riwayat versi project: setiap versi = daftar file (path -> hash isi). Isi file disimpan sekali per hash
// di data/versions/<slug>/<2 huruf>/<hash>, jadi file yang tidak berubah tidak memakan tempat lagi.
// Database project tidak ikut (isinya bisa berupa kiriman pengunjung yang tidak boleh hilang saat restore).
//
// Versi dibuat:
// - 'edit'    otomatis sebelum user mengedit, maks. sekali per AUTO_INTERVAL (atau setelah AI/restore)
// - 'ai'      otomatis sebelum perubahan AI diterapkan
// - 'manual'  lewat tombol "Simpan versi"
// - 'restore' otomatis sebelum mengembalikan versi, supaya restore bisa dibatalkan

const AUTO_INTERVAL_MS = 10 * 60 * 1000;
const LABEL_MAX = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

const versionsRoot = (slug) => path.join(config.dataDir, 'versions', slug);
const blobPath = (slug, hash) => path.join(versionsRoot(slug), hash.slice(0, 2), hash);

const sql = {
  insert: db.prepare(`
    INSERT INTO versions (project_id, user_id, kind, label, manifest, file_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  latest: db.prepare('SELECT * FROM versions WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'),
  list: db.prepare(`
    SELECT id, kind, label, file_count AS fileCount, created_at AS createdAt
    FROM versions WHERE project_id = ? ORDER BY created_at DESC, id DESC
  `),
  byId: db.prepare('SELECT * FROM versions WHERE id = ? AND project_id = ?'),
  manifests: db.prepare('SELECT manifest FROM versions WHERE project_id = ?'),
  pruneOld: db.prepare('DELETE FROM versions WHERE project_id = ? AND created_at < ?'),
  pruneExtra: db.prepare(`
    DELETE FROM versions WHERE project_id = ? AND id NOT IN (
      SELECT id FROM versions WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    )
  `),
};

// Satu operasi riwayat per project pada satu waktu (snapshot, restore), supaya tidak saling tumpang tindih.
const locks = new Map();
function withLock(slug, fn) {
  const prev = locks.get(slug) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(slug, next);
  next.finally(() => { if (locks.get(slug) === next) locks.delete(slug); }).catch(() => {});
  return next;
}

// ---------- Snapshot ----------

/** Potret kondisi project sekarang. Isi file baru disalin ke penyimpanan versi. */
async function snapshot(slug, previous) {
  const root = userRoot(slug);
  const entries = await listTree(root);
  const files = {};
  const dirs = [];
  for (const entry of entries) {
    if (entry.type === 'dir') {
      dirs.push(entry.path);
      continue;
    }
    if (!isServableFile(entry.path)) continue;
    const abs = resolveIn(root, entry.path);
    const st = await statOrNull(abs);
    if (!st?.isFile()) continue;
    // Ukuran & waktu ubah sama dengan versi sebelumnya: pakai hash lama tanpa membaca ulang file.
    const prev = previous?.files[entry.path];
    if (prev && prev.s === st.size && prev.m === st.mtimeMs) {
      files[entry.path] = prev;
      continue;
    }
    const buf = await fs.readFile(abs);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const target = blobPath(slug, hash);
    if (!(await statOrNull(target))) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buf);
    }
    files[entry.path] = { h: hash, s: st.size, m: st.mtimeMs };
  }
  return { files, dirs };
}

const sameContent = (a, b) => {
  const ka = Object.keys(a.files);
  if (ka.length !== Object.keys(b.files).length) return false;
  return ka.every((p) => b.files[p]?.h === a.files[p].h);
};

const parse = (row) => (row ? { ...row, manifest: JSON.parse(row.manifest) } : null);

async function createVersion(project, userId, kind, label, { force = false } = {}) {
  const latest = parse(sql.latest.get(project.id));
  const manifest = await snapshot(project.slug, latest?.manifest);
  // Tidak ada yang berubah sejak versi terakhir: tidak perlu versi baru (kecuali disimpan manual).
  if (!force && latest && sameContent(manifest, latest.manifest)) return null;
  const cleanLabel = String(label ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  const { lastInsertRowid } = sql.insert.run(
    project.id, userId, kind, cleanLabel, JSON.stringify(manifest), Object.keys(manifest.files).length, Date.now(),
  );
  await prune(project);
  return Number(lastInsertRowid);
}

// Hapus versi di luar batas paket (umur & jumlah), lalu isi file yang tidak dipakai versi mana pun.
async function prune(project) {
  const { days, max } = historyFor(project.user_id);
  const removed = sql.pruneOld.run(project.id, Date.now() - days * DAY_MS).changes
    + sql.pruneExtra.run(project.id, project.id, max).changes;
  if (removed) await collectGarbage(project);
}

async function collectGarbage(project) {
  const used = new Set();
  for (const { manifest } of sql.manifests.all(project.id)) {
    for (const f of Object.values(JSON.parse(manifest).files)) used.add(f.h);
  }
  const root = versionsRoot(project.slug);
  for (const prefix of await fs.readdir(root).catch(() => [])) {
    const dir = path.join(root, prefix);
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (!used.has(name)) await fs.rm(path.join(dir, name), { force: true });
    }
  }
}

/**
 * Simpan versi otomatis sebelum user mengedit. Paling sering sekali per 10 menit, kecuali versi terakhir
 * dibuat oleh AI/restore (kondisi hasil AI/restore perlu ikut tersimpan sebelum diedit lagi).
 */
export function autoVersionBeforeEdit(project, userId) {
  const latest = sql.latest.get(project.id);
  if (latest && ['edit', 'manual'].includes(latest.kind) && Date.now() - latest.created_at < AUTO_INTERVAL_MS) return Promise.resolve();
  return withLock(project.slug, () => createVersion(project, userId, 'edit', '')).catch((err) => {
    console.error(`Versi otomatis ${project.slug} gagal: ${err.message}`); // jangan pernah menggagalkan simpan
  });
}

/** Simpan versi sebelum perubahan AI diterapkan. */
export function versionBeforeAi(project, userId, prompt) {
  return withLock(project.slug, () => createVersion(project, userId, 'ai', prompt)).catch((err) => {
    console.error(`Versi sebelum AI ${project.slug} gagal: ${err.message}`);
  });
}

/** Hapus seluruh riwayat project (dipakai saat project dihapus; baris versi ikut terhapus lewat CASCADE). */
export async function removeVersions(slug) {
  await fs.rm(versionsRoot(slug), { recursive: true, force: true });
}

// ---------- Perbandingan & restore ----------

/** Status tiap file versi dibanding kondisi sekarang. */
async function compareWithNow(project, version) {
  const now = await snapshot(project.slug, version.manifest);
  const paths = new Set([...Object.keys(version.manifest.files), ...Object.keys(now.files)]);
  const files = [];
  for (const p of [...paths].sort()) {
    const then = version.manifest.files[p];
    const current = now.files[p];
    const status = !current ? 'missing' // ada di versi ini, sekarang sudah tidak ada
      : !then ? 'new' // dibuat setelah versi ini
        : then.h === current.h ? 'same' : 'changed';
    files.push({ path: p, status, size: then?.s ?? current.s, image: isImageFile(p) });
  }
  return files;
}

async function readBlob(slug, entry) {
  try {
    return await fs.readFile(blobPath(slug, entry.h));
  } catch {
    throw new HttpError(410, 'Isi file di versi ini sudah tidak tersedia');
  }
}

async function writeFile(root, rel, buf) {
  const abs = resolveIn(root, cleanPath(rel));
  const st = await statOrNull(abs);
  if (st && !st.isFile()) await fs.rm(abs, { recursive: true, force: true }); // ada folder dengan nama sama
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
}

function describeVersion(version) {
  const when = new Date(version.created_at).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
  });
  return `versi ${when}`;
}

/** Kembalikan seluruh project (atau satu file) ke isi versi. Mengembalikan path yang berubah. */
async function restore(project, userId, version, onlyPath) {
  const root = userRoot(project.slug);
  const limits = limitsFor(root);
  const target = version.manifest;

  if (onlyPath && !target.files[onlyPath] && !(await statOrNull(resolveIn(root, onlyPath)))) {
    throw new HttpError(404, 'File tidak ditemukan di versi ini');
  }
  // Pastikan hasil restore muat di kuota paket sekarang.
  if (!onlyPath) {
    const total = Object.values(target.files).reduce((sum, f) => sum + f.s, 0);
    const count = Object.keys(target.files).length + target.dirs.length;
    if (total > limits.totalSize || count > limits.entries) {
      throw new HttpError(413, `Versi ini terlalu besar untuk kuota paketmu sekarang (${limits.totalSize / 1024 / 1024} MB, ${limits.entries} file & folder).`);
    }
  }

  // Kondisi sekarang disimpan dulu, supaya restore bisa dibatalkan.
  await createVersion(project, userId, 'restore', `Sebelum dikembalikan ke ${describeVersion(version)}`);

  const now = await snapshot(project.slug, parse(sql.latest.get(project.id))?.manifest);
  const touched = [];
  const paths = onlyPath ? [onlyPath] : [...new Set([...Object.keys(target.files), ...Object.keys(now.files)])];
  for (const p of paths) {
    const then = target.files[p];
    const current = now.files[p];
    if (then && current?.h === then.h) continue;
    if (!then) {
      await fs.rm(resolveIn(root, p), { force: true });
    } else {
      if (onlyPath) {
        const used = Object.values(now.files).reduce((sum, f) => sum + f.s, 0);
        if (used - (current?.s ?? 0) + then.s > limits.totalSize) {
          throw new HttpError(413, `Kuota penyimpanan ${limits.totalSize / 1024 / 1024} MB penuh`);
        }
      }
      await writeFile(root, p, await readBlob(project.slug, then));
    }
    touched.push(p);
  }

  if (!onlyPath) {
    for (const dir of target.dirs) await fs.mkdir(resolveIn(root, dir), { recursive: true });
    // Folder yang tidak ada di versi dan kini kosong ikut dihapus (terdalam dulu).
    const keep = new Set(target.dirs);
    const extraDirs = (await listTree(root)).filter((e) => e.type === 'dir' && !keep.has(e.path))
      .sort((a, b) => b.path.length - a.path.length);
    for (const dir of extraDirs) {
      const abs = resolveIn(root, dir.path);
      if (!(await fs.readdir(abs).catch(() => ['?'])).length) await fs.rmdir(abs).catch(() => {});
    }
  }
  return touched;
}

// ---------- Route /api/versions ----------

export const versions = express.Router();
versions.use(requireAuth, loadProject);

function versionOf(req) {
  const version = parse(sql.byId.get(Number(req.params.id), req.project.id));
  if (!version) throw new HttpError(404, 'Versi tidak ditemukan. Mungkin sudah terhapus karena melewati batas riwayat.');
  return version;
}

versions.get('/', (req, res) => {
  const { days, max } = historyFor(req.project.user_id);
  res.json({ versions: sql.list.all(req.project.id), history: { days, max } });
});

versions.post('/', async (req, res) => {
  const label = String(req.body?.label ?? '').trim();
  const id = await withLock(req.project.slug, () => createVersion(req.project, req.user.id, 'manual', label, { force: true }));
  res.status(201).json({ id });
});

versions.get('/:id', async (req, res) => {
  const version = versionOf(req);
  const files = await withLock(req.project.slug, () => compareWithNow(req.project, version));
  res.json({
    version: { id: version.id, kind: version.kind, label: version.label, createdAt: version.created_at, fileCount: version.file_count },
    files,
  });
});

// Isi satu file di versi ini: teks sebagai JSON, gambar sebagai file.
versions.get('/:id/file', async (req, res) => {
  const version = versionOf(req);
  const rel = cleanPath(req.query.path);
  const entry = version.manifest.files[rel];
  if (!entry) throw new HttpError(404, 'File ini tidak ada di versi tersebut');
  const buf = await readBlob(req.project.slug, entry);
  if (isImageFile(rel)) {
    return res.set({
      'Content-Type': IMAGE_TYPES[path.extname(rel).toLowerCase()],
      'Cache-Control': 'private, max-age=86400', // isi versi tidak pernah berubah
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    }).send(buf);
  }
  res.json({ content: buf.toString('utf8') });
});

versions.post('/:id/restore', async (req, res) => {
  const version = versionOf(req);
  const onlyPath = req.body?.path ? cleanPath(req.body.path) : null;
  const touched = await withLock(req.project.slug, () => restore(req.project, req.user.id, version, onlyPath));
  res.json({ touched });
});
