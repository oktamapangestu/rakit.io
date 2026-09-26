import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { HttpError } from './http-error.js';

export const ALLOWED_EXT = new Set(['.html', '.css', '.js']);
export const LIMITS = {
  fileSize: 512 * 1024, // per file
  totalSize: 20 * 1024 * 1024, // per user
  entries: 500, // file + folder per user
  depth: 8,
};

// Tidak boleh diawali titik: menolak ".", "..", dan dotfile.
const SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
const TEMPLATE_DIR = fileURLToPath(new URL('../templates/default', import.meta.url));

export const userRoot = (username) => path.join(config.dataDir, 'sites', username);
export const isAllowedFile = (rel) => ALLOWED_EXT.has(path.extname(rel).toLowerCase());

export function cleanPath(input) {
  if (typeof input !== 'string') throw new HttpError(400, 'Path wajib diisi');
  const parts = input.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length) throw new HttpError(400, 'Path wajib diisi');
  if (parts.length > LIMITS.depth) {
    throw new HttpError(400, `Kedalaman folder maksimal ${LIMITS.depth} level`);
  }
  for (const part of parts) {
    if (!SEGMENT_RE.test(part)) {
      throw new HttpError(400, `Nama "${part}" tidak valid. Gunakan huruf, angka, titik, - atau _`);
    }
  }
  return parts.join('/');
}

function assertAllowedFile(rel) {
  if (!isAllowedFile(rel)) throw new HttpError(400, 'Hanya file .html, .css, dan .js yang diizinkan');
}

export function resolveIn(root, rel) {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) throw new HttpError(400, 'Path tidak valid');
  return abs;
}

export async function statOrNull(abs) {
  try {
    return await fs.lstat(abs);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
}

export async function listTree(root) {
  const out = [];
  async function walk(dir, prefix) {
    let items;
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const item of items) {
      if (!SEGMENT_RE.test(item.name)) continue;
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        out.push({ path: rel, name: item.name, type: 'dir' });
        await walk(abs, rel);
      } else if (item.isFile()) {
        const { size } = await fs.stat(abs);
        out.push({ path: rel, name: item.name, type: 'file', size });
      }
    }
  }
  await walk(root, '');
  return out;
}

export function usageOf(entries) {
  const size = entries.reduce((sum, e) => sum + (e.size ?? 0), 0);
  return { size, entries: entries.length, limits: LIMITS };
}

// Pastikan semua folder induk ada & bukan file. Mengembalikan jumlah folder baru.
async function ensureParents(root, rel) {
  const parts = rel.split('/').slice(0, -1);
  for (let i = 1; i <= parts.length; i++) {
    const st = await statOrNull(resolveIn(root, parts.slice(0, i).join('/')));
    if (st && !st.isDirectory()) throw new HttpError(409, `"${parts.slice(0, i).join('/')}" adalah file`);
  }
  if (parts.length) await fs.mkdir(resolveIn(root, parts.join('/')), { recursive: true });
}

function missingCount(entries, rel) {
  const existing = new Set(entries.map((e) => e.path));
  const parts = rel.split('/');
  let n = 0;
  for (let i = 1; i <= parts.length; i++) if (!existing.has(parts.slice(0, i).join('/'))) n++;
  return n;
}

async function checkQuota(root, rel, { addBytes = 0, removeBytes = 0 } = {}) {
  const entries = await listTree(root);
  const usage = usageOf(entries);
  if (usage.entries + missingCount(entries, rel) > LIMITS.entries) {
    throw new HttpError(413, `Maksimal ${LIMITS.entries} file & folder`);
  }
  if (usage.size - removeBytes + addBytes > LIMITS.totalSize) {
    throw new HttpError(413, `Kuota penyimpanan ${LIMITS.totalSize / 1024 / 1024} MB penuh`);
  }
}

export async function readText(root, input) {
  const rel = cleanPath(input);
  assertAllowedFile(rel);
  const st = await statOrNull(resolveIn(root, rel));
  if (!st?.isFile()) throw new HttpError(404, 'File tidak ditemukan');
  return fs.readFile(resolveIn(root, rel), 'utf8');
}

export async function writeText(root, input, content, { create = false } = {}) {
  const rel = cleanPath(input);
  assertAllowedFile(rel);
  if (typeof content !== 'string') throw new HttpError(400, 'Konten harus berupa teks');
  const bytes = Buffer.byteLength(content);
  if (bytes > LIMITS.fileSize) {
    throw new HttpError(413, `Ukuran file maksimal ${LIMITS.fileSize / 1024} KB`);
  }
  const abs = resolveIn(root, rel);
  const st = await statOrNull(abs);
  if (st && !st.isFile()) throw new HttpError(409, 'Sudah ada folder dengan nama itu');
  if (st && create) throw new HttpError(409, 'File sudah ada');
  if (!st && !create) throw new HttpError(404, 'File tidak ditemukan');

  await checkQuota(root, rel, { addBytes: bytes, removeBytes: st?.size ?? 0 });
  await ensureParents(root, rel);
  await fs.writeFile(abs, content, 'utf8');
  return rel;
}

export async function createDir(root, input) {
  const rel = cleanPath(input);
  const abs = resolveIn(root, rel);
  if (await statOrNull(abs)) throw new HttpError(409, 'Sudah ada file/folder dengan nama itu');
  await checkQuota(root, rel);
  await ensureParents(root, rel);
  await fs.mkdir(abs);
  return rel;
}

export async function renameEntry(root, fromInput, toInput) {
  const from = cleanPath(fromInput);
  const to = cleanPath(toInput);
  if (from === to) return to;
  const st = await statOrNull(resolveIn(root, from));
  if (!st) throw new HttpError(404, 'File/folder tidak ditemukan');
  if (st.isFile()) assertAllowedFile(to);
  if (to.startsWith(from + '/')) throw new HttpError(400, 'Tidak bisa memindahkan folder ke dalam dirinya sendiri');
  if (await statOrNull(resolveIn(root, to))) throw new HttpError(409, 'Sudah ada file/folder dengan nama itu');
  await ensureParents(root, to);
  await fs.rename(resolveIn(root, from), resolveIn(root, to));
  return to;
}

export async function removeEntry(root, input) {
  const rel = cleanPath(input);
  const abs = resolveIn(root, rel);
  if (!(await statOrNull(abs))) throw new HttpError(404, 'File/folder tidak ditemukan');
  await fs.rm(abs, { recursive: true, force: true });
}

export async function seedTemplate(username) {
  const root = userRoot(username);
  await fs.mkdir(root, { recursive: true });
  for (const name of await fs.readdir(TEMPLATE_DIR)) {
    const text = await fs.readFile(path.join(TEMPLATE_DIR, name), 'utf8');
    const filled = text
      .replaceAll('{{username}}', username)
      .replaceAll('{{host}}', config.siteHost(username));
    await fs.writeFile(path.join(root, name), filled, 'utf8');
  }
}
