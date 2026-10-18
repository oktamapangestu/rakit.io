// Tab Dokumentasi: teks & olahan data yang dipakai tampilan (Docs.svelte) dan ekspor Markdown (export.js).
import { OP_LABEL } from './snippets.js';

// Kalimat untuk satu masalah dari GET /api/docs (lihat docIssue di go/internal/api/docs.go).
export function issueText(i) {
  const where = i.fn ? `fungsi ${i.fn}` : i.file;
  if (i.kind === 'missing_secret') return `Rahasia ${i.name} dipakai ${where}, tapi belum diisi di tab Fungsi → Rahasia (env).`;
  if (i.kind === 'missing_table') return `Tabel ${i.name} dipakai ${where}, tapi tabelnya belum ada.`;
  if (i.kind === 'missing_function') return `${i.file} memanggil fungsi ${i.name}, tapi fungsinya belum ada.`;
  if (i.kind === 'owner_only') return `${i.file} memakai "${OP_LABEL[i.op] ?? i.op}" di tabel ${i.name}, tapi akses itu hanya untuk pemilik — pengunjung akan ditolak (403).`;
  if (i.kind === 'broken_link') return `${i.file} menautkan ke ${i.name}, tapi halaman itu tidak ada.`;
  if (i.kind === 'missing_asset') return `${i.file} memuat ${i.name}, tapi file itu tidak ada.`;
  if (i.kind === 'orphan_page') return `Halaman ${i.name} tidak ditautkan dari halaman lain, jadi pengunjung sulit menemukannya.`;
  return i.kind;
}

// Tujuan saat masalah diklik: file atau kode fungsinya.
export const issuePath = (i) => i.file ?? (i.fn ? `functions/${i.fn}.js` : null);

export const columnNotes = (c) => [
  c.required && 'wajib',
  c.private && 'privat (tidak dikirim ke pengunjung)',
  c.type === 'reference' && c.refTable && `→ ${c.refTable}`,
].filter(Boolean).join(' · ');

// Tabel & fungsi yang dipakai sebuah halaman: dari kode halamannya sendiri dan file JS yang dimuatnya.
export function pageUses(data, page) {
  const files = new Set([page.path, ...page.assets.filter((a) => a.kind === 'js' && !a.missing).map((a) => a.to)]);
  const tables = data.tables
    .map((t) => ({ name: t.name, ops: [...new Set(t.usedBy.filter((u) => files.has(u.file)).map((u) => u.op))] }))
    .filter((t) => t.ops.length);
  const functions = data.functions.filter((f) => f.usedBy.some((u) => files.has(u))).map((f) => f.name);
  return { tables, functions };
}

// Form tanpa action biasanya dikirim lewat JavaScript (fetch), jadi method-nya tidak berarti.
const NO_ACTION = 'diproses JavaScript';
export const formText = (f) => (f.action ? `${f.method.toUpperCase()} ${f.action}` : NO_ACTION);
