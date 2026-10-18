// Tab Dokumentasi: daftar endpoint & contoh kode siap salin, disusun dari data GET /api/docs (go/internal/api/docs.go).
import { DB_OPS } from '../database/types.js';

export const OP_LABEL = Object.fromEntries(DB_OPS);

// Contoh nilai per tipe kolom untuk contoh body.
const SAMPLE = { text: 'teks', number: 0, boolean: true, date: '2026-12-31', reference: 1, image: '/uploads/contoh.jpg' };

const sampleBody = (columns) => Object.fromEntries(columns.map((c) => [c.name, SAMPLE[c.type] ?? 'teks']));
// Objek contoh dalam satu baris JS, mis. { nama: 'teks', harga: 0 }.
const literal = (obj) => {
  const parts = Object.entries(obj).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${typeof v === 'string' ? `'${v}'` : v}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
};

// Endpoint API database satu tabel: [{ method, path, op, desc }].
export function tableEndpoints(t) {
  const base = `/api/db/${t.name}`;
  const list = [
    { method: 'GET', path: base, op: 'list', desc: 'Daftar baris: ?sort=-created_at&limit=20&offset=0&<kolom>=<nilai>' },
    { method: 'GET', path: `${base}/:id`, op: 'view', desc: 'Satu baris menurut id' },
    { method: 'POST', path: base, op: 'create', desc: 'Tambah baris (body JSON)' },
    { method: 'PATCH', path: `${base}/:id`, op: 'update', desc: 'Ubah sebagian kolom (body JSON)' },
    { method: 'DELETE', path: `${base}/:id`, op: 'delete', desc: 'Hapus baris' },
  ];
  const image = t.columns.find((c) => c.type === 'image');
  if (image) list.push({ method: 'POST', path: `${base}/upload?column=${image.name}`, op: 'upload', desc: 'Upload gambar, hasilnya { url } untuk disimpan di kolom gambar' });
  return list;
}

// Akses endpoint: upload boleh untuk pengunjung bila tambah atau ubah publik.
export function isPublic(t, op) {
  if (op === 'upload') return t.rules.create === 'public' || t.rules.update === 'public';
  return t.rules[op] === 'public';
}

// Contoh kode tabel: ambil daftar, lalu tambah baris.
export function tableExample(t) {
  return [
    '// Ambil daftar (terbaru dulu)',
    `const res = await fetch('/api/db/${t.name}?sort=-created_at&limit=20');`,
    'const { rows, total } = await res.json();',
    '',
    '// Tambah baris',
    `const baru = await fetch('/api/db/${t.name}', {`,
    "  method: 'POST',",
    "  headers: { 'Content-Type': 'application/json' },",
    `  body: JSON.stringify(${literal(sampleBody(t.columns))}),`,
    '});',
    'if (!baru.ok) alert((await baru.json()).error);',
  ].join('\n');
}

// Contoh memanggil fungsi: method pertama yang diperiksa kode (selain CRON), isian body/query dari kodenya. Contoh nilai
// body mengikuti tipe kolom bernama sama di tabel yang dipakai fungsi itu (tables: daftar tabel project).
export function fnExample(f, tables = []) {
  const method = f.methods.find((m) => m !== 'CRON') ?? (f.body.length ? 'POST' : 'GET');
  const query = f.query.length ? `?${f.query.map((q) => `${q}=…`).join('&')}` : '';
  const url = `/api/fn/${f.name}${query}`;
  if (method === 'GET' || method === 'DELETE') {
    return [
      `const res = await fetch('${url}'${method === 'DELETE' ? ", { method: 'DELETE' }" : ''});`,
      'const data = await res.json();',
    ].join('\n');
  }
  const used = tables.filter((t) => f.tables.some((u) => u.table === t.name));
  const typeOf = (name) => used.flatMap((t) => t.columns).find((c) => c.name === name)?.type;
  const body = Object.fromEntries(f.body.map((b) => [b, SAMPLE[typeOf(b)] ?? 'teks']));
  return [
    `const res = await fetch('${url}', {`,
    `  method: '${method}',`,
    "  headers: { 'Content-Type': 'application/json' },",
    `  body: JSON.stringify(${literal(body)}),`,
    '});',
    'const data = await res.json();',
  ].join('\n');
}
