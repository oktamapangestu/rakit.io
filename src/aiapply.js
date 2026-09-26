import fs from 'node:fs/promises';
import { listTree, readText, removeEntry, resolveIn, statOrNull, userRoot, writeText } from './files.js';
import * as userdb from './userdb.js';

// Menerapkan perubahan dari mode Builder langsung di server, dengan snapshot untuk Batalkan.
// Snapshot disimpan di database bersama pesan AI, jadi Batalkan tetap bisa walau browser di-refresh.

async function fileExists(root, path) {
  return (await statOrNull(resolveIn(root, path)))?.isFile() ?? false;
}

async function applyTable(username, change) {
  const existing = userdb.hasDatabase(username) ? userdb.listTables(username).find((t) => t.name === change.name) : null;
  const rules = Object.fromEntries(change.public.map((op) => [op, 'public']));
  if (!existing) {
    userdb.createTable(username, { name: change.name, columns: change.columns, rules });
    return { table: change.name, existed: false };
  }
  const addColumns = change.columns.filter((c) => !existing.columns.some((e) => e.name === c.name));
  const widened = change.public.some((op) => existing.rules[op] !== 'public');
  if (addColumns.length || widened) userdb.updateTable(username, change.name, { addColumns, rules });
  return { table: change.name, existed: true, addedColumns: addColumns.map((c) => c.name), beforeRules: existing.rules };
}

async function revertTable(username, entry) {
  try {
    if (!entry.existed) userdb.deleteTable(username, entry.table);
    else userdb.updateTable(username, entry.table, { dropColumns: entry.addedColumns, rules: entry.beforeRules });
  } catch (err) {
    if (err.status !== 404) throw err; // tabel/kolom sudah dihapus pemiliknya: tidak ada yang perlu dikembalikan
  }
}

/** Terapkan perubahan. Bila gagal di tengah jalan, semuanya dikembalikan lalu error dilempar ulang. */
export async function applyChanges(username, changes) {
  const root = userRoot(username);
  const fileChanges = changes.filter((c) => c.action !== 'table');
  const snapshot = { files: [], tables: [], dirsBefore: [] };

  for (const change of fileChanges) {
    snapshot.files.push({ path: change.path, before: (await fileExists(root, change.path)) ? await readText(root, change.path) : null });
  }
  snapshot.dirsBefore = (await listTree(root)).filter((e) => e.type === 'dir').map((e) => e.path);

  try {
    // Tabel dulu, supaya halaman yang memakai datanya langsung berfungsi di preview.
    for (const change of changes.filter((c) => c.action === 'table')) {
      snapshot.tables.push(await applyTable(username, change));
    }
    for (const change of fileChanges) {
      const exists = await fileExists(root, change.path);
      if (change.action === 'delete') {
        if (exists) await removeEntry(root, change.path);
      } else {
        await writeText(root, change.path, change.content, { create: !exists });
      }
    }
  } catch (err) {
    await revertChanges(username, snapshot).catch(() => {});
    throw err;
  }
  return snapshot;
}

/** Kembalikan semua file dan tabel ke isi sebelum perubahan. */
export async function revertChanges(username, snapshot) {
  const root = userRoot(username);
  for (const entry of [...snapshot.tables].reverse()) await revertTable(username, entry);

  for (const { path, before } of [...snapshot.files].reverse()) {
    const exists = await fileExists(root, path);
    if (before === null) {
      if (exists) await removeEntry(root, path);
    } else {
      await writeText(root, path, before, { create: !exists });
    }
  }

  // Folder yang dibuat oleh perubahan AI dan kini kosong ikut dihapus (terdalam dulu).
  const dirsBefore = new Set(snapshot.dirsBefore);
  const entries = await listTree(root);
  const newDirs = entries.filter((e) => e.type === 'dir' && !dirsBefore.has(e.path)).sort((a, b) => b.path.length - a.path.length);
  for (const dir of newDirs) {
    const abs = resolveIn(root, dir.path);
    const children = await fs.readdir(abs).catch(() => ['?']);
    if (!children.length) await fs.rmdir(abs).catch(() => {});
  }
}

/** Path file yang disentuh perubahan (untuk memberi tahu editor agar memuat ulang). */
export const touchedPaths = (changes) => changes.filter((c) => c.action !== 'table').map((c) => c.path);
