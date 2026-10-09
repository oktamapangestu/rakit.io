// Keadaan editor Database (tab Data), dipakai bersama komponen di folder ini dan editor.js (edit teks di
// preview, hasil AI "buka tabel"). connect() dipanggil editor.js sebelum komponen dipasang.
import { DB_PAGE, tableUrl } from './types.js';

// active: tabel yang dipilih; shown: tabel yang barisnya sedang ditampilkan (berganti setelah barisnya termuat,
// supaya kepala tabel baru tidak tampil bersama baris tabel lama).
export const db = $state({ tables: [], usage: null, active: null, shown: null, rows: [], total: 0, offset: 0 });

let host; // context 'editor' dari editor.js: api, toast, confirm, previewBase, projectHeaders, schedulePublishCheck
export const connect = (editor) => { host = editor; };

export const activeTable = () => db.tables.find((t) => t.name === db.active);
export const shownTable = () => db.tables.find((t) => t.name === db.shown);

// Nilai kolom image = alamat file ("/uploads/..." di website ini) atau URL https.
export const imageSrc = (value) => (String(value).startsWith('/') ? `${host.previewBase()}${value}` : String(value));

export async function load() {
  host.schedulePublishCheck(); // struktur tabel bisa berubah
  try {
    const data = await host.api('GET', '/api/database/tables');
    db.tables = data.tables;
    db.usage = data.usage;
  } catch (err) {
    return host.toast(err.message, 'error');
  }
  if (!activeTable()) {
    db.active = db.tables[0]?.name ?? null;
    db.offset = 0;
  }
  await loadRows();
}

export async function loadRows() {
  const t = activeTable();
  if (!t) {
    db.shown = null;
    return;
  }
  try {
    const data = await host.api('GET', `${tableUrl(t.name)}/rows?limit=${DB_PAGE}&offset=${db.offset}`);
    db.rows = data.rows;
    db.total = data.total;
  } catch (err) {
    host.toast(err.message, 'error');
    db.rows = [];
    db.total = 0;
  }
  db.shown = t.name;
}

export function select(name) {
  db.active = name;
  db.offset = 0;
  loadRows();
}

export function page(delta) {
  db.offset = Math.max(0, db.offset + delta * DB_PAGE);
  loadRows();
}

// Simpan satu sel. Gagal: pesan ditampilkan, lalu error dilempar lagi supaya pemanggil bisa membatalkan isiannya.
export async function saveCell(t, row, column, value) {
  try {
    const { row: updated } = await host.api('PATCH', `${tableUrl(t.name)}/rows/${row.id}`, { [column.name]: value });
    Object.assign(row, updated);
  } catch (err) {
    host.toast(err.message, 'error');
    throw err;
  }
}

export async function deleteRow(t, row) {
  const ok = await host.confirm({
    title: 'Hapus baris?',
    message: `Baris #${row.id} di tabel "${t.name}" akan dihapus permanen.`,
    buttons: [{ label: 'Hapus', value: true, primary: true, danger: true }, { label: 'Batal', value: null }],
  });
  if (!ok) return;
  try {
    await host.api('DELETE', `${tableUrl(t.name)}/rows/${row.id}`);
    if (db.rows.length === 1 && db.offset > 0) db.offset -= DB_PAGE;
    await load();
  } catch (err) {
    host.toast(err.message, 'error');
  }
}

export async function uploadImage(t, column, file) {
  const res = await fetch(`${tableUrl(t.name)}/upload?column=${encodeURIComponent(column.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', ...host.projectHeaders() },
    body: file,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
  return data.url;
}

// Ubah struktur/akses tabel (dialog Atur). Mengembalikan nama tabel sesudahnya (bisa berganti).
export async function patchTable(name, payload, message) {
  try {
    const { table } = await host.api('PATCH', tableUrl(name), payload);
    const i = db.tables.findIndex((t) => t.name === name);
    if (i >= 0) db.tables[i] = table;
    if (db.active === name) db.active = table.name;
    if (db.shown === name) db.shown = table.name;
    if (message) host.toast(message);
    // Isi baris hanya berubah bila kolom/nama tabel berubah; akses & tanda kolom tidak perlu memuat ulang baris
    // (dan semua gambarnya) di belakang dialog.
    if (payload.addColumns || payload.dropColumns || payload.renameColumns || payload.rename) loadRows();
    return table.name;
  } catch (err) {
    host.toast(err.message, 'error');
    return name;
  }
}
