import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { HttpError } from './http-error.js';
import { storageFor } from './plans.js';

// Database milik proyek user: satu file SQLite per user, dikelola hanya lewat fungsi di sini
// (tidak ada SQL mentah dari user). Metadata tabel (tipe kolom, flag, aturan akses) disimpan
// di tabel internal _rakit_tables.

// `bytes` = batas paket gratis; batas sebenarnya per project mengikuti langganan pemiliknya (maxBytes()).
export const DB_LIMITS = {
  bytes: 10 * 1024 * 1024,
  tables: 20,
  columns: 30,
  textLength: 10_000,
  pageSize: 100,
};
export const COLUMN_TYPES = ['text', 'number', 'boolean', 'date'];
export const OPERATIONS = ['list', 'view', 'create', 'update', 'delete'];
const DEFAULT_RULES = Object.fromEntries(OPERATIONS.map((op) => [op, 'owner']));

const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
const SYSTEM_COLUMNS = new Set(['id', 'created_at']);
const SQL_TYPE = { text: 'TEXT', number: 'REAL', boolean: 'INTEGER', date: 'TEXT' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SQLITE_FULL = 13;

const DB_DIR = path.join(config.dataDir, 'db');
fs.mkdirSync(DB_DIR, { recursive: true });

const dbPath = (username) => path.join(DB_DIR, `${username}.db`);
export const hasDatabase = (username) => fs.existsSync(dbPath(username));

// ---------- Koneksi (LRU kecil, supaya tidak membuka ribuan file sekaligus) ----------

const pool = new Map();
const POOL_MAX = 50;

const maxBytes = (slug) => storageFor(slug).dbBytes;

// Batas ukuran ditegakkan oleh SQLite sendiri: penulisan melebihi batas gagal dengan SQLITE_FULL.
// Diset ulang tiap kali dipakai, supaya ikut berubah saat langganan dimulai/berakhir.
function applySizeLimit(db, slug) {
  const { page_size: pageSize } = db.prepare('PRAGMA page_size').get();
  db.exec(`PRAGMA max_page_count = ${Math.floor(maxBytes(slug) / pageSize)}`);
}

function open(username) {
  let db = pool.get(username);
  if (db) {
    pool.delete(username);
    pool.set(username, db);
    applySizeLimit(db, username);
    return db;
  }
  db = new DatabaseSync(dbPath(username));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS _rakit_tables (
      name       TEXT PRIMARY KEY,
      columns    TEXT NOT NULL,
      rules      TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  applySizeLimit(db, username);

  pool.set(username, db);
  if (pool.size > POOL_MAX) {
    const [oldest, oldDb] = pool.entries().next().value;
    pool.delete(oldest);
    oldDb.close();
  }
  return db;
}

/** Tutup koneksi & hapus file database project (dipakai saat project dihapus). */
export function removeDatabase(slug) {
  const db = pool.get(slug);
  if (db) {
    pool.delete(slug);
    db.close();
  }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath(slug)}${suffix}`, { force: true });
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw translateError(err);
  }
}

function translateError(err) {
  if (err?.errcode === SQLITE_FULL) {
    return new HttpError(413, 'Database penuh. Hapus data yang tidak dipakai, atau berlangganan untuk kuota database lebih besar.');
  }
  return err;
}

const ident = (name) => `"${name}"`; // hanya dipakai untuk nama yang sudah lolos NAME_RE

// ---------- Validasi ----------

function normalizeName(value, what) {
  const name = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!NAME_RE.test(name) || name.startsWith('sqlite_') || name.startsWith('_rakit')) {
    throw new HttpError(400, `Nama ${what} "${value}" tidak valid. Pakai huruf kecil, angka, dan _, diawali huruf (maks. 40 karakter).`);
  }
  return name;
}

function normalizeColumn(input) {
  const name = normalizeName(input?.name, 'kolom');
  if (SYSTEM_COLUMNS.has(name)) throw new HttpError(400, `Kolom "${name}" sudah dibuat otomatis`);
  if (!COLUMN_TYPES.includes(input?.type)) {
    throw new HttpError(400, `Tipe kolom "${input?.type}" tidak dikenal. Pilih: ${COLUMN_TYPES.join(', ')}`);
  }
  return { name, type: input.type, required: Boolean(input.required), private: Boolean(input.private) };
}

function normalizeRules(input, base = DEFAULT_RULES) {
  const rules = { ...base };
  for (const op of OPERATIONS) {
    if (input?.[op] === 'public' || input?.[op] === 'owner') rules[op] = input[op];
  }
  return rules;
}

function assertUniqueColumns(columns) {
  const seen = new Set();
  for (const c of columns) {
    if (seen.has(c.name)) throw new HttpError(400, `Kolom "${c.name}" ditulis lebih dari sekali`);
    seen.add(c.name);
  }
  if (columns.length > DB_LIMITS.columns) throw new HttpError(400, `Maksimal ${DB_LIMITS.columns} kolom per tabel`);
}

// Ubah nilai dari JSON/query string ke bentuk yang disimpan di SQLite.
function coerce(column, value) {
  if (value === undefined || value === null) return null;
  if (value === '' && column.type !== 'text') return null;
  const fail = (hint) => {
    throw new HttpError(400, `Nilai kolom "${column.name}" harus ${hint}`);
  };
  switch (column.type) {
    case 'text': {
      if (typeof value === 'object') fail('berupa teks');
      const text = String(value);
      if (text.length > DB_LIMITS.textLength) fail(`maksimal ${DB_LIMITS.textLength} karakter`);
      return text;
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (typeof value === 'boolean' || !Number.isFinite(n)) fail('berupa angka');
      return n;
    }
    case 'boolean':
      if ([true, 1, '1', 'true', 'ya'].includes(value)) return 1;
      if ([false, 0, '0', 'false', 'tidak'].includes(value)) return 0;
      return fail('true atau false');
    case 'date': {
      const text = String(value).trim();
      if (!DATE_RE.test(text) || Number.isNaN(Date.parse(text))) fail('tanggal, contoh 2026-12-31 atau 2026-12-31T19:00');
      return text;
    }
    default:
      return fail('valid');
  }
}

const isEmpty = (v) => v === null || v === undefined || v === '';

function buildValues(table, body, { partial }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Body harus berupa objek JSON, contoh {"nama": "Budi"}');
  }
  const columns = new Map(table.columns.map((c) => [c.name, c]));
  const unknown = Object.keys(body).filter((k) => !columns.has(k) && !SYSTEM_COLUMNS.has(k));
  if (unknown.length) throw new HttpError(400, `Kolom tidak dikenal: ${unknown.join(', ')}`);

  const values = {};
  for (const [key, value] of Object.entries(body)) {
    if (columns.has(key)) values[key] = coerce(columns.get(key), value);
  }
  for (const c of table.columns) {
    const provided = Object.hasOwn(values, c.name);
    if (c.required && (partial ? provided && isEmpty(values[c.name]) : isEmpty(values[c.name]))) {
      throw new HttpError(400, `Kolom "${c.name}" wajib diisi`);
    }
  }
  return values;
}

function outputRow(table, row, publicView) {
  const out = { id: row.id, created_at: row.created_at };
  for (const c of table.columns) {
    if (publicView && c.private) continue;
    const value = row[c.name];
    out[c.name] = c.type === 'boolean' && value !== null ? Boolean(value) : value;
  }
  return out;
}

// ---------- Metadata ----------

function readMeta(db, name) {
  const row = db.prepare('SELECT * FROM _rakit_tables WHERE name = ?').get(name);
  return row && {
    name: row.name,
    columns: JSON.parse(row.columns),
    rules: normalizeRules(JSON.parse(row.rules)),
    createdAt: row.created_at,
  };
}

function writeMeta(db, table) {
  db.prepare(`
    INSERT INTO _rakit_tables (name, columns, rules, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (name) DO UPDATE SET columns = excluded.columns, rules = excluded.rules
  `).run(table.name, JSON.stringify(table.columns), JSON.stringify(table.rules), table.createdAt);
}

function tableOrThrow(db, name) {
  const table = typeof name === 'string' && NAME_RE.test(name) ? readMeta(db, name) : null;
  if (!table) throw new HttpError(404, `Tabel "${name}" tidak ditemukan`);
  return table;
}

function describe(db, table) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${ident(table.name)}`).get();
  return { ...table, rowCount: n };
}

// ---------- Tabel ----------

export function usage(username) {
  const db = open(username);
  const { page_count: pages } = db.prepare('PRAGMA page_count').get();
  const { page_size: pageSize } = db.prepare('PRAGMA page_size').get();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM _rakit_tables').get();
  return { bytes: pages * pageSize, tables: n, limits: { bytes: maxBytes(username), tables: DB_LIMITS.tables } };
}

export function listTables(username) {
  const db = open(username);
  return db.prepare('SELECT name FROM _rakit_tables ORDER BY name')
    .all()
    .map(({ name }) => describe(db, readMeta(db, name)));
}

export function getTable(username, name) {
  // Untuk API publik: jangan membuat file database baru hanya karena ada request.
  if (!hasDatabase(username)) throw new HttpError(404, `Tabel "${name}" tidak ditemukan`);
  return tableOrThrow(open(username), name);
}

export function createTable(username, input) {
  const db = open(username);
  const name = normalizeName(input?.name, 'tabel');
  const columns = (Array.isArray(input?.columns) ? input.columns : []).map(normalizeColumn);
  assertUniqueColumns(columns);
  const rules = normalizeRules(input?.rules);

  return transaction(db, () => {
    if (readMeta(db, name)) throw new HttpError(409, `Tabel "${name}" sudah ada`);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM _rakit_tables').get();
    if (n >= DB_LIMITS.tables) throw new HttpError(413, `Maksimal ${DB_LIMITS.tables} tabel per proyek`);

    const columnSql = columns.map((c) => `, ${ident(c.name)} ${SQL_TYPE[c.type]}`).join('');
    db.exec(`CREATE TABLE ${ident(name)} (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL${columnSql})`);
    const table = { name, columns, rules, createdAt: new Date().toISOString() };
    writeMeta(db, table);
    return describe(db, table);
  });
}

/**
 * Ubah tabel. Semua bagian opsional, dijalankan berurutan dalam satu transaksi:
 * { addColumns: [{name,type,required,private}], dropColumns: ['kolom'],
 *   renameColumns: [{from,to}], columnFlags: {kolom: {required, private}},
 *   rules: {list:'public',...}, rename: 'nama_baru' }
 */
export function updateTable(username, name, patch = {}) {
  const db = open(username);
  return transaction(db, () => {
    const table = tableOrThrow(db, name);
    const t = ident(table.name);

    for (const input of patch.addColumns ?? []) {
      const column = normalizeColumn(input);
      if (table.columns.some((c) => c.name === column.name)) throw new HttpError(409, `Kolom "${column.name}" sudah ada`);
      table.columns.push(column);
      assertUniqueColumns(table.columns);
      db.exec(`ALTER TABLE ${t} ADD COLUMN ${ident(column.name)} ${SQL_TYPE[column.type]}`);
    }

    for (const drop of patch.dropColumns ?? []) {
      if (!table.columns.some((c) => c.name === drop)) throw new HttpError(404, `Kolom "${drop}" tidak ditemukan`);
      table.columns = table.columns.filter((c) => c.name !== drop);
      db.exec(`ALTER TABLE ${t} DROP COLUMN ${ident(drop)}`);
    }

    for (const { from, to } of patch.renameColumns ?? []) {
      const column = table.columns.find((c) => c.name === from);
      if (!column) throw new HttpError(404, `Kolom "${from}" tidak ditemukan`);
      const newName = normalizeName(to, 'kolom');
      if (newName === from) continue;
      if (SYSTEM_COLUMNS.has(newName) || table.columns.some((c) => c.name === newName)) {
        throw new HttpError(409, `Kolom "${newName}" sudah ada`);
      }
      db.exec(`ALTER TABLE ${t} RENAME COLUMN ${ident(from)} TO ${ident(newName)}`);
      column.name = newName;
    }

    for (const [columnName, flags] of Object.entries(patch.columnFlags ?? {})) {
      const column = table.columns.find((c) => c.name === columnName);
      if (!column) throw new HttpError(404, `Kolom "${columnName}" tidak ditemukan`);
      if (flags?.required !== undefined) column.required = Boolean(flags.required);
      if (flags?.private !== undefined) column.private = Boolean(flags.private);
    }

    if (patch.rules) table.rules = normalizeRules(patch.rules, table.rules);

    if (patch.rename !== undefined) {
      const newName = normalizeName(patch.rename, 'tabel');
      if (newName !== table.name) {
        if (readMeta(db, newName)) throw new HttpError(409, `Tabel "${newName}" sudah ada`);
        db.exec(`ALTER TABLE ${t} RENAME TO ${ident(newName)}`);
        db.prepare('DELETE FROM _rakit_tables WHERE name = ?').run(table.name);
        table.name = newName;
      }
    }

    writeMeta(db, table);
    return describe(db, table);
  });
}

export function deleteTable(username, name) {
  const db = open(username);
  transaction(db, () => {
    const table = tableOrThrow(db, name);
    db.exec(`DROP TABLE ${ident(table.name)}`);
    db.prepare('DELETE FROM _rakit_tables WHERE name = ?').run(table.name);
  });
}

// ---------- Baris ----------

function parseSort(table, sort, visible) {
  const raw = String(sort ?? 'id');
  const desc = raw.startsWith('-');
  const column = desc ? raw.slice(1) : raw;
  if (!SYSTEM_COLUMNS.has(column) && !visible.some((c) => c.name === column)) {
    throw new HttpError(400, `Tidak bisa mengurutkan berdasarkan "${column}"`);
  }
  return `${ident(column)} ${desc ? 'DESC' : 'ASC'}, id ${desc ? 'DESC' : 'ASC'}`;
}

export function listRows(username, name, { limit, offset, sort, filters = {}, publicView = false } = {}) {
  const db = open(username);
  const table = tableOrThrow(db, name);
  const visible = publicView ? table.columns.filter((c) => !c.private) : table.columns;
  const filterable = new Map([
    ['id', { name: 'id', type: 'number' }],
    ...visible.map((c) => [c.name, c]),
  ]);

  const where = [];
  const params = [];
  for (const [key, raw] of Object.entries(filters)) {
    const column = filterable.get(key);
    if (!column) throw new HttpError(400, `Tidak bisa memfilter kolom "${key}"`);
    const value = Array.isArray(raw) ? raw[0] : raw;
    const coerced = coerce(column, value);
    if (coerced === null) {
      where.push(`${ident(key)} IS NULL`);
    } else {
      where.push(`${ident(key)} = ?`);
      params.push(coerced);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), DB_LIMITS.pageSize);
  const off = Math.max(Number.parseInt(offset, 10) || 0, 0);

  const t = ident(table.name);
  const { n: total } = db.prepare(`SELECT COUNT(*) AS n FROM ${t} ${whereSql}`).get(...params);
  const rows = db.prepare(`SELECT * FROM ${t} ${whereSql} ORDER BY ${parseSort(table, sort, visible)} LIMIT ? OFFSET ?`)
    .all(...params, lim, off);
  return { rows: rows.map((r) => outputRow(table, r, publicView)), total, limit: lim, offset: off };
}

function rowId(id) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(400, 'id tidak valid');
  return n;
}

export function getRow(username, name, id, { publicView = false } = {}) {
  const db = open(username);
  const table = tableOrThrow(db, name);
  const row = db.prepare(`SELECT * FROM ${ident(table.name)} WHERE id = ?`).get(rowId(id));
  if (!row) throw new HttpError(404, 'Baris tidak ditemukan');
  return outputRow(table, row, publicView);
}

export function insertRow(username, name, body, { publicView = false } = {}) {
  const db = open(username);
  const table = tableOrThrow(db, name);
  const values = buildValues(table, body, { partial: false });
  const keys = Object.keys(values);
  const sql = `INSERT INTO ${ident(table.name)} (created_at${keys.map((k) => `, ${ident(k)}`).join('')})
    VALUES (?${', ?'.repeat(keys.length)})`;
  try {
    const { lastInsertRowid } = db.prepare(sql).run(new Date().toISOString(), ...Object.values(values));
    return getRow(username, table.name, Number(lastInsertRowid), { publicView });
  } catch (err) {
    throw translateError(err);
  }
}

export function updateRow(username, name, id, body, { publicView = false } = {}) {
  const db = open(username);
  const table = tableOrThrow(db, name);
  const values = buildValues(table, body, { partial: true });
  const keys = Object.keys(values);
  if (!keys.length) throw new HttpError(400, 'Tidak ada kolom yang diubah');
  try {
    const { changes } = db.prepare(`UPDATE ${ident(table.name)} SET ${keys.map((k) => `${ident(k)} = ?`).join(', ')} WHERE id = ?`)
      .run(...Object.values(values), rowId(id));
    if (!changes) throw new HttpError(404, 'Baris tidak ditemukan');
  } catch (err) {
    throw translateError(err);
  }
  return getRow(username, table.name, id, { publicView });
}

export function deleteRow(username, name, id) {
  const db = open(username);
  const table = tableOrThrow(db, name);
  const { changes } = db.prepare(`DELETE FROM ${ident(table.name)} WHERE id = ?`).run(rowId(id));
  if (!changes) throw new HttpError(404, 'Baris tidak ditemukan');
}

// ---------- Ringkasan untuk AI ----------

export function schemaSummary(username) {
  if (!hasDatabase(username)) return '';
  return listTables(username).map((t) => {
    const open = OPERATIONS.filter((op) => t.rules[op] === 'public');
    const columns = t.columns.map((c) => `${c.name}: ${c.type}${c.required ? ' required' : ''}${c.private ? ' private' : ''}`);
    return `- ${t.name} (${t.rowCount} rows; public: ${open.length ? open.join(', ') : 'none'})\n    ${['id: number (auto)', 'created_at: date (auto)', ...columns].join('\n    ')}`;
  }).join('\n');
}
