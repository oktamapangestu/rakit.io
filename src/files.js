import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { HttpError } from './http-error.js';
import { freeStorage, storageFor } from './plans.js';

// File teks (bisa diedit di editor & ditulis AI) dan gambar (diunggah).
export const ALLOWED_EXT = new Set(['.html', '.css', '.js']);
export const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
};
// Batas upload satu gambar (bawaan server; per project mengikuti paket, lihat limitsFor()).
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Batas tetap. Kuota total (ukuran & jumlah file) per project mengikuti langganan pemiliknya: limitsFor().
export const LIMITS = {
  fileSize: 512 * 1024, // per file
  totalSize: freeStorage.totalSize, // per project, paket gratis
  entries: freeStorage.entries, // file + folder per project, paket gratis
  imageSize: freeStorage.imageSize, // per gambar, paket gratis
  depth: 8,
};

/** Batas untuk project di folder `root` (data/sites/<slug>). */
export function limitsFor(root) {
  const { totalSize, entries, imageSize } = storageFor(path.basename(root));
  return { ...LIMITS, totalSize, entries, imageSize };
}

// Tidak boleh diawali titik: menolak ".", "..", dan dotfile.
const SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
const TEMPLATE_DIR = fileURLToPath(new URL('../templates/default', import.meta.url));

export const userRoot = (username) => path.join(config.dataDir, 'sites', username);
export const isAllowedFile = (rel) => ALLOWED_EXT.has(path.extname(rel).toLowerCase());
export const isImageFile = (rel) => Object.hasOwn(IMAGE_TYPES, path.extname(rel).toLowerCase());
export const isServableFile = (rel) => isAllowedFile(rel) || isImageFile(rel);

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

export function usageOf(entries, limits = LIMITS) {
  const size = entries.reduce((sum, e) => sum + (e.size ?? 0), 0);
  return { size, entries: entries.length, limits };
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
  const limits = limitsFor(root);
  const entries = await listTree(root);
  const usage = usageOf(entries, limits);
  const added = missingCount(entries, rel);
  if (added && usage.entries + added > limits.entries) {
    throw new HttpError(413, `Maksimal ${limits.entries} file & folder`);
  }
  // Mengecilkan file tetap boleh walau kuota terlampaui (mis. setelah langganan berakhir).
  if (addBytes > removeBytes && usage.size - removeBytes + addBytes > limits.totalSize) {
    throw new HttpError(413, `Kuota penyimpanan ${limits.totalSize / 1024 / 1024} MB penuh`);
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

// Cocokkan isi file dengan ekstensinya, supaya yang diunggah benar-benar gambar.
function looksLikeImage(ext, buf) {
  const ascii = (start, end) => buf.subarray(start, end).toString('latin1');
  switch (ext) {
    case '.png': return buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
    case '.jpg':
    case '.jpeg': return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case '.gif': return ascii(0, 4) === 'GIF8';
    case '.webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case '.ico': return buf.length > 4 && buf.readUInt32BE(0) === 0x00000100;
    case '.avif': return ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12));
    case '.svg': {
      const head = buf.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '');
      return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head);
    }
    default: return false;
  }
}

/** Simpan gambar yang diunggah. Tanpa `overwrite`, file yang sudah ada ditolak (409). */
export async function writeImage(root, input, buf, { overwrite = false } = {}) {
  const rel = cleanPath(input);
  const ext = path.extname(rel).toLowerCase();
  if (!isImageFile(rel)) {
    throw new HttpError(400, `Format gambar tidak didukung. Pakai ${Object.keys(IMAGE_TYPES).join(', ')}`);
  }
  if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, 'File gambar kosong');
  const limits = limitsFor(root);
  if (buf.length > limits.imageSize) {
    throw new HttpError(413, `Ukuran gambar maksimal ${limits.imageSize / 1024 / 1024} MB per file di paketmu`);
  }
  if (!looksLikeImage(ext, buf)) throw new HttpError(400, `Isi file bukan gambar ${ext.slice(1).toUpperCase()} yang valid`);

  const abs = resolveIn(root, rel);
  const st = await statOrNull(abs);
  if (st && !st.isFile()) throw new HttpError(409, 'Sudah ada folder dengan nama itu');
  if (st && !overwrite) throw new HttpError(409, 'File sudah ada');

  await checkQuota(root, rel, { addBytes: buf.length, removeBytes: st?.size ?? 0 });
  await ensureParents(root, rel);
  await fs.writeFile(abs, buf);
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
  // Jenis file tidak boleh berubah lewat rename (gambar tetap gambar, teks tetap teks).
  if (st.isFile() && isImageFile(from)) {
    if (!isImageFile(to)) throw new HttpError(400, `Gambar harus berakhiran ${Object.keys(IMAGE_TYPES).join(', ')}`);
  } else if (st.isFile()) {
    assertAllowedFile(to);
  }
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
    // 'wx' = jangan pernah menimpa file yang sudah ada.
    await fs.writeFile(path.join(root, name), filled, { encoding: 'utf8', flag: 'wx' }).catch((err) => {
      if (err.code !== 'EEXIST') throw err;
    });
  }
}
