// Panel preview: muat ulang iframe, bar alamat, ukuran layar, Pilih blok (untuk prompt AI), mode Edit (teks & gambar
// langsung di halaman). Halaman di iframe ada di origin lain; skrip pemilihnya bicara lewat postMessage.
import { core as state } from '../files/state.svelte.js';
import { ui, toast } from '../shell/state.svelte.js';
import ImageEditDialog from '../preview/ImageEditDialog.svelte';
import { preview, MAX_BLOCKS } from '../preview/state.svelte.js';
import { db, loadRows as loadDbRows } from '../database/state.svelte.js';
import { tableUrl } from '../database/types.js';
import { $, LANG, extOf, storage } from './util.js';
import { api } from './api.js';
import { editorReady, monaco } from './monaco.js';
import { createModel, save } from './files.js';
import { askAi, devConsoleAdd, setMode } from './shell.js';
import { openDialog } from './context.js';
import { schedulePublishCheck } from './project.js';

// ---------- Preview ----------
// Alamat versi yang sedang diedit: dev pada publikasi manual, selain itu website itu sendiri.
export const previewBase = () => state.project.previewUrl || state.project.siteUrl;

// Alamat halaman (tanpa host) untuk sebuah file: index.html → "/", blog/index.html → "/blog/".
export function routeFor(path) {
  return `/${path === 'index.html' ? '' : path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path}`;
}

export function urlFor(path) {
  return `${state.project.siteUrl}${routeFor(path)}`;
}

export function reloadPreview() {
  const route = state.previewRoute ?? routeFor(state.previewPath);
  const url = `${previewBase()}${route}`;
  preview.host = previewBase();
  schedulePublishCheck();
  preview.route = route; // bar alamat (tidak menimpa yang sedang diketik)
  preview.url = url;
  // Server mengirim Cache-Control: no-cache, jadi cukup set ulang src untuk memuat versi terbaru.
  $('#previewFrame').src = url;
}

// ---------- Pilih blok di preview ----------
// Pengguna memilih bagian halaman (maks. 5) lalu menulis prompt; AI diarahkan hanya mengubah bagian itu.
// Halaman preview ada di origin lain (<slug>.rakit.io), jadi pemilihannya dilakukan skrip kecil yang
// disisipkan server ke halaman di dalam iframe (go/internal/sites/picker.js), lewat postMessage.
// Blok bisa dari beberapa halaman: tiap blok membawa halamannya (pathname di preview). Pindah halaman
// tidak melepas pilihan; saat kembali, sorotannya dipulihkan. Batas 5 blok dihitung dari semua halaman.
// Keadaan (pick, textEdit) di assets-source/editor/preview/state.svelte.js; bar & chip blok digambar komponen.
export const pick = preview.pick;
export const siteOrigin = () => new URL(previewBase()).origin;
export const toPicker = (message) => $('#previewFrame').contentWindow?.postMessage({ rakit: true, lang: LANG, ...message }, siteOrigin());
export const blocksOn = (page) => pick.blocks.filter((b) => b.page === page);
// Jatah di halaman yang sedang tampil = 5 dikurangi blok di halaman lain.
export const pageLimit = () => MAX_BLOCKS - pick.blocks.filter((b) => b.page !== pick.page).length;

export function setPick(on) {
  pick.on = on;
  if (!on) pick.blocks = [];
  if (on && textEdit.on) setTextEdit(false, { quiet: true });
  toPicker({ type: 'pick', on, limit: pageLimit(), restore: on ? blocksOn(pick.page).map((b) => b.selector) : undefined });
}

export function removeBlock(b) {
  if (b.page === pick.page) return toPicker({ type: 'remove', selector: b.selector });
  // Blok di halaman lain: halaman itu tidak sedang dimuat, cukup dilepas di sini.
  pick.blocks = pick.blocks.filter((x) => x !== b);
  toPicker({ type: 'limit', limit: pageLimit() });
}

export function bindBlockPicker() {
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (e.source !== $('#previewFrame').contentWindow || e.origin !== siteOrigin() || m?.rakit !== true) return;
    if (m.type === 'log') {
      devConsoleAdd({ source: m.source, level: m.level, text: m.text, page: m.page, time: m.time, url: m.url });
    } else if (m.type === 'ready') {
      // Halaman preview dimuat (ulang/pindah halaman): aktifkan lagi dengan blok milik halaman ini.
      pick.page = m.page;
      if (textEdit.on) toPicker({ type: 'textMode', on: true });
      if (!pick.on) return;
      toPicker({ type: 'pick', on: true, limit: pageLimit(), restore: blocksOn(m.page).map((b) => b.selector) });
    } else if (m.type === 'blocks' && pick.on) {
      const first = !pick.blocks.length && m.blocks.length;
      pick.page = m.page;
      // Urutan chip tetap sesuai urutan dipilih: blok halaman ini diperbarui di tempatnya, yang baru di akhir.
      const fresh = new Map(m.blocks.map((b) => [b.selector, { ...b, page: m.page }]));
      const kept = pick.blocks.filter((b) => b.page !== m.page || fresh.has(b.selector)).map((b) => (b.page === m.page ? fresh.get(b.selector) : b));
      const added = [...fresh.values()].filter((b) => !kept.includes(b));
      pick.blocks = [...kept, ...added].slice(0, MAX_BLOCKS);
      // Blok pertama dipilih: tampilkan kotak prompt (di Coding bisa saja sedang di tab lain).
      if (first && ui.mode !== 'ai') setMode('ai');
    } else if (m.type === 'textCheck' && textEdit.on) {
      checkTextEdit(m);
    } else if (m.type === 'textEdit' && textEdit.on) {
      applyTextEdit(m);
    } else if (m.type === 'imageEdit' && textEdit.on) {
      openImageEdit(m);
    } else if (m.type === 'textError') {
      textEditFailed('Sebagian format teks (tebal, tautan) ikut terhapus, jadi perubahannya tidak disimpan. Ubah teksnya saja, atau pilih semua teks lalu ketik ulang.');
    } else if (m.type === 'limit') {
      toast(`Maksimal ${MAX_BLOCKS} blok sekaligus (termasuk di halaman lain)`, 'error');
    } else if (m.type === 'top') {
      toast('Ini sudah bagian terbesar');
    }
  });
}

// ---------- Edit teks di preview ----------
// Mode Edit: klik teks di preview lalu ketik langsung (klik gambar: lihat "Ganti gambar" di bawah). Skrip preview (picker.js) mengirim isi text node elemen sebelum
// & sesudah diubah; di sini perubahan itu dicari di HTML sumber (textedit.js) dan diterapkan ke model
// Monaco, jadi bisa di-undo dan tersimpan seperti ketikan biasa.
export const textEdit = preview.textEdit;
// Disimpan tanpa memuat ulang preview: teks barunya sudah tampil di sana.
export const quietSaves = new Set();
export const htmlDecoder = document.createElement('textarea');
export const decodeHtml = (raw) => { htmlDecoder.innerHTML = raw; return htmlDecoder.value; };

export function setTextEdit(on, { quiet = false } = {}) {
  textEdit.on = on;
  if (on && pick.on) setPick(false);
  if (!quiet) toPicker({ type: 'textMode', on });
}

// File HTML untuk pathname halaman di preview, seperti server menyajikannya ("/" -> index.html,
// "/tentang" -> tentang.html).
export function pageFile(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const exists = (p) => state.entries.some((e) => e.type === 'file' && e.path === p);
  if (exists(rel)) return extOf(rel) === 'html' ? rel : null;
  return !/\.[^/]*$/.test(rel) && exists(`${rel}.html`) ? `${rel}.html` : null;
}

export function textEditFailed(message) {
  toast(message, 'error');
  reloadPreview(); // kembalikan teks di preview sesuai file
}

// Model Monaco file `path` (dimuat bila belum dibuka). Hasil: { path, model } atau { error }.
export async function fileModel(path) {
  try {
    await editorReady;
  } catch {
    return { error: 'Editor kode gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.' };
  }
  if (!state.models.has(path)) {
    try {
      const { content } = await api('GET', `/api/files/content?path=${encodeURIComponent(path)}`);
      if (!state.models.has(path)) createModel(path, content);
    } catch (err) {
      return { error: err.message };
    }
  }
  return { path, model: state.models.get(path) };
}

// Model file HTML halaman `page` di preview. Hasil: { path, model } atau { error }.
export function pageModel(page) {
  const path = pageFile(String(page));
  return path ? fileModel(path) : Promise.resolve({ error: 'Halaman ini tidak ditemukan di file project, jadi tidak bisa diubah dari preview.' });
}

// Tempat teks elemen di sumber: HTML halaman; untuk teks yang diisi skrip/Alpine (x-text, innerHTML), baris
// database asalnya (dikenali preview dari data /api/db yang dibaca halaman) atau string di HTML halaman /
// file JS project. after = before untuk sekadar memeriksa (saat teks diklik, sebelum diketik).
// Hasil: { path, model, edits, reload } | { db, value } | { error, ai } — ai: asal teksnya tidak bisa diubah
// langsung (mis. hitungan), jadi perubahannya diteruskan ke AI.
export async function findText(m, after) {
  const page = await pageModel(m.page);
  if (page.error) return page;
  const src = page.model.getValue();
  const db = Array.isArray(m.db) ? m.db : [];
  const res = window.rakitTextEdit.apply(src, m.selector, m.before, after, decodeHtml);
  if (!res.error) {
    // Diklik: teks yang seluruhnya diisi dari data harus punya asal yang bisa diubah.
    const filled = m.before.map((t, i) => [t, i]).filter(([t]) => /\S/.test(t)).map(([, i]) => i);
    if (after === m.before && filled.length && filled.every((i) => res.bound.includes(i))) {
      const found = [];
      for (const i of filled) found.push(await dynamicText(page, db[i], m.before[i], m.before[i]));
      return found.find((f) => !f.error) || found[0];
    }
    // Isi <template> (x-for / x-if) dipakai semua salinannya: muat ulang preview supaya semuanya ikut berubah.
    return { ...page, edits: res.edits, reload: m.selector.includes('template:') };
  }
  if (res.error === 'mixed') return { error: 'Teks ini memuat bagian dari data. Ubah satu bagian saja dalam sekali edit.', ai: true };

  let index = res.error === 'bound' ? res.index : -1;
  if (index < 0) {
    // Elemen tidak ada di HTML (dibuat skrip): hanya teks polos satu bagian yang dicari asalnya.
    const filled = m.before.map((t, i) => [t, i]).filter(([t]) => /\S/.test(t));
    if (filled.length !== 1) return { error: `Teks ini tidak tertulis di ${page.path} — kemungkinan dirakit JavaScript.`, ai: true };
    index = filled[0][1];
  }
  const next = typeof after === 'string' ? after : after[index];
  return dynamicText(page, db[index], m.before[index].trim(), next.trim());
}

// Tabel database project (untuk mencocokkan asal teks dari preview); dimuat bila tab Data belum dibuka.
export async function dbTableList() {
  if (!db.tables.length) {
    try {
      db.tables = (await api('GET', '/api/database/tables')).tables;
    } catch { /* tanpa tabel: asal dari database tidak dipakai */ }
  }
  return db.tables;
}

// Kolom database asal teks/gambar menurut preview: { table, column, numeric } atau null.
export async function dbTarget(source, types) {
  if (!source || typeof source !== 'object' || source.ambiguous || source.id == null || typeof source.column !== 'string') return null;
  const tables = await dbTableList();
  let name = source.table;
  if (typeof name !== 'string') {
    const via = source.via && tables.find((t) => t.name === source.via.table)?.columns.find((c) => c.name === source.via.column);
    name = via?.type === 'reference' ? via.refTable : null;
  }
  const column = tables.find((t) => t.name === name)?.columns.find((c) => c.name === source.column);
  return column && types.includes(column.type) ? { table: name, id: source.id, column: column.name, numeric: Boolean(source.numeric) } : null;
}

// Asal teks yang diisi skrip: baris database, lalu string di HTML halaman atau file JS.
export async function dynamicText(page, source, old, next) {
  const target = await dbTarget(source, ['text', 'number', 'date']);
  if (target) {
    // Angka berformat (Rp 15.000) disimpan sebagai angkanya saja.
    const value = target.numeric ? next.replace(/\D/g, '') : next;
    if (target.numeric && !value) return { error: 'Kolom ini berisi angka: tulis angkanya, mis. 15.000.' };
    return { db: target, value };
  }
  const found = [];
  if (old) {
    for (const lit of window.rakitTextEdit.findHtmlLiterals(page.model.getValue(), old)) found.push({ ...page, lit, html: true });
    for (const e of state.entries) {
      if (e.type !== 'file' || extOf(e.path) !== 'js' || (e.size ?? 0) > 1048576) continue;
      const file = await fileModel(e.path);
      if (file.error) continue;
      for (const lit of window.rakitTextEdit.findLiterals(file.model.getValue(), old)) found.push({ ...file, lit });
    }
  }
  if (found.length === 1) {
    const [{ path, model, lit, html }] = found;
    const text = html ? window.rakitTextEdit.encodeHtmlLiteral(next, lit) : window.rakitTextEdit.encodeLiteral(next, lit.quote);
    return { path, model, edits: next === old ? [] : [{ start: lit.start, end: lit.end, text }] };
  }
  if (found.length > 1) return { error: `Teks ini ditulis JavaScript dan muncul ${found.length} kali di kode.`, ai: true };
  if (source?.ambiguous) return { error: `Teks ini ada di ${source.ambiguous} baris data sekaligus.`, ai: true };
  return { error: 'Teks ini dihitung JavaScript (mis. hitungan atau gabungan data).', ai: true };
}

// Teks/gambar yang tidak bisa diubah langsung: minta AI mengubahnya (kotak AI diisi, belum dikirim).
export function editViaAi(page, what) {
  askAi(`Di halaman ${pageFile(String(page)) || page}, ${what} Bagian itu ditampilkan oleh JavaScript, jadi ubah di sumbernya (kode atau data).`);
  toast('Bagian ini dibuat JavaScript — permintaannya sudah disiapkan di AI, tinggal kirim');
  reloadPreview();
}

// Terapkan perubahan ke model sebagai satu langkah undo, lalu simpan tanpa memuat ulang preview.
// reload: muat ulang preview sesudah disimpan (mis. isi <template> yang tampil di banyak salinan).
export function commitEdits(path, model, edits, what, { reload = false } = {}) {
  // File dibuka sebagai tab (tanpa pindah tab), supaya perubahannya terlihat & bisa di-undo.
  if (!state.tabs.includes(path)) state.tabs.push(path);
  if (state.autosave && !reload) quietSaves.add(path);
  model.pushEditOperations([], edits.map((e) => ({
    range: monaco.Range.fromPositions(model.getPositionAt(e.start), model.getPositionAt(e.end)),
    text: e.text,
  })), () => null);
  model.pushStackElement();
  if (state.autosave) save(path);
  toast(state.autosave ? `${what} diubah di ${path}` : `${what} diubah di ${path} (belum disimpan)`);
}

export async function applyTextEdit(m) {
  const valid = typeof m.selector === 'string' && Array.isArray(m.before) && m.before.every((t) => typeof t === 'string')
    && (typeof m.after === 'string' || (Array.isArray(m.after) && m.after.length === m.before.length && m.after.every((t) => typeof t === 'string')));
  if (!valid) return;
  if (m.db !== undefined && !Array.isArray(m.db)) return;
  const res = await findText(m, m.after);
  if (res.error && res.ai) {
    const flat = (v) => (Array.isArray(v) ? v.join('') : v).replace(/\s+/g, ' ').trim();
    return editViaAi(m.page, `ubah teks "${flat(m.before)}" menjadi "${flat(m.after)}".`);
  }
  if (res.error) return textEditFailed(res.error);
  if (res.db) return saveDbValue(res.db, { [res.db.column]: res.value }, 'Teks');
  if (res.edits.length) commitEdits(res.path, res.model, res.edits, 'Teks', { reload: res.reload });
}

// Simpan perubahan dari preview ke baris database asalnya (preview sudah menampilkan nilai barunya).
export async function saveDbValue(target, values, what) {
  try {
    await api('PATCH', `${tableUrl(target.table)}/rows/${encodeURIComponent(target.id)}`, values);
    toast(`${what} diubah di database: tabel ${target.table}, baris #${target.id}`);
    if (ui.mode === 'data' && db.active === target.table) loadDbRows();
  } catch (err) {
    textEditFailed(err.message);
  }
}

// Teks diklik di preview: periksa dulu apakah ada di sumber, supaya pengguna tidak mengetik sia-sia.
export async function checkTextEdit(m) {
  if (typeof m.selector !== 'string' || !Array.isArray(m.before) || !m.before.every((t) => typeof t === 'string')) return;
  const res = await findText(m, m.before);
  toPicker({ type: 'textChecked', id: m.id, ok: !res.error, ai: Boolean(res.ai), file: res.path });
  if (res.error && res.ai) toast(`${res.error} Ketik perubahannya — nanti diteruskan ke AI.`);
  else if (res.error) toast(res.error, 'error');
}

// ---------- Ganti gambar di preview ----------
// Klik <img> di mode Edit: pilih gambar dari project, upload baru, atau pakai alamat URL, dan ubah alt-nya.
// src ditulis sebagai "/path" (sama dengan "Salin path" di daftar file).
export const isStr = (v) => v === null || typeof v === 'string';

// Path file project untuk alamat gambar di preview (hanya gambar di website ini), atau null.
export function projectImage(url) {
  try {
    const u = new URL(url);
    if (u.origin !== siteOrigin()) return null;
    const path = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    return state.entries.some((e) => e.type === 'file' && e.path === path) ? path : null;
  } catch {
    return null;
  }
}

export function openImageEdit(m) {
  if (typeof m.selector !== 'string' || !isStr(m.src) || !isStr(m.alt) || typeof m.shown !== 'string') return;
  if ((m.db != null && typeof m.db !== 'object') || (m.altDb != null && typeof m.altDb !== 'object')) return;
  if (m.picture) {
    return toast('Gambar ini memakai <picture> dengan beberapa versi gambar, jadi tidak bisa diganti dari preview. Ubah lewat kode atau minta AI.', 'error');
  }
  const current = projectImage(m.shown);
  openDialog(ImageEditDialog, { m, current, onSubmit: (changes) => applyImageEdit(m, current, changes) });
}

// Simpan perubahan gambar dari dialog: ke HTML sumber, ke baris database asalnya, atau lewat AI.
export async function applyImageEdit(m, current, changes) {
  const page = await pageModel(m.page);
  if (page.error) return textEditFailed(page.error);
  const res = window.rakitTextEdit.applyImage(page.model.getValue(), m.selector, { src: m.src, alt: m.alt }, changes, decodeHtml);
  if (!res.error) {
    if (!res.edits.length) return;
    // Gambar di <template> (x-for / x-if) tampil di banyak salinan: muat ulang preview.
    const reload = m.selector.includes('template:');
    commitEdits(page.path, page.model, res.edits, 'Gambar', { reload });
    if (!reload) toPicker({ type: 'setImage', page: m.page, selector: m.selector, ...changes });
    return;
  }
  // Gambar dari database (mis. kolom foto produk): ubah barisnya.
  const srcTarget = await dbTarget(m.db, ['image', 'text']);
  const altTarget = await dbTarget(m.altDb, ['text']);
  const same = (a, b) => a && b && a.table === b.table && String(a.id) === String(b.id);
  if ((!changes.src || srcTarget) && (changes.alt === undefined || altTarget || same(srcTarget, altTarget))) {
    const target = srcTarget || altTarget;
    if (target) {
      const values = {};
      if (changes.src) values[srcTarget.column] = changes.src;
      if (changes.alt !== undefined && altTarget) {
        if (same(altTarget, target)) values[altTarget.column] = changes.alt;
        else await saveDbValue(altTarget, { [altTarget.column]: changes.alt }, 'Teks alt');
      }
      if (Object.keys(values).length) await saveDbValue(target, values, 'Gambar');
      toPicker({ type: 'setImage', page: m.page, selector: m.selector, ...changes });
      return;
    }
  }
  const newAlt = changes.alt !== undefined ? `"${changes.alt}"` : '';
  editViaAi(m.page, changes.src
    ? `ganti gambar "${m.src ?? ''}" menjadi "${changes.src}"${newAlt ? `, dan ubah teks alt-nya menjadi ${newAlt}` : ''}.`
    : `ubah teks alt gambar "${m.src ?? ''}" menjadi ${newAlt}.`);
}

// Bar alamat preview: host tetap (website project ini), path/query/hash bisa diubah.
export const currentRoute = () => state.previewRoute ?? routeFor(state.previewPath);
export function previewGo(typed, input) {
  let value = typed.trim();
  const host = previewBase();
  // Tempel alamat lengkap website ini tetap boleh; host lain ditolak.
  if (value.toLowerCase().startsWith(host.toLowerCase())) value = value.slice(host.length);
  else if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) {
    toast(`Preview hanya bisa membuka halaman di ${host.replace(/^https?:\/\//, '')}`, 'error');
    input.value = currentRoute();
    input.select(); // siap diketik ulang
    return;
  }
  if (!value.startsWith('/')) value = `/${value}`;
  state.previewRoute = value.replace(/\s/g, '%20');
  input.blur();
  reloadPreview();
}

export let previewTimer;
export function schedulePreviewReload() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(reloadPreview, 250);
}

export function setDevice(device) {
  preview.device = device;
  storage.set('rakit.device', device);
}
