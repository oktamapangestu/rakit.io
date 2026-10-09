// Tab Diagram (UML, ERD, peta halaman, alur data): keadaan & aksi, dipakai komponen di folder ini dan editor.js.
// Diagram dibuat AI (kode Mermaid) dari file & database project dan disimpan di server per jenis; dibuat ulang hanya
// saat user menekan "Update diagram". connect() dipanggil editor.js sebelum komponen dipasang.
import { DIAGRAM_NAMES } from './info.js';
import { createActivity } from '../ai/activity.svelte.js';

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5;

// saved: { jenis: { code, notes, updatedAt, canFix } } dari server; busy: jenis yang sedang dibuat AI.
// status/activity: selama AI membuat diagram — teks status & proses AI (createActivity, ditampilkan Activity.svelte).
// edit: mode Edit — { code, base, error, preview } (preview = kode yang digambar, menyusul ketikan sebentar kemudian).
// view: posisi & skala kanvas (x, y dalam px layar; z = zoom); w/h = ukuran asli SVG; touched = user sudah zoom/geser.
// tick: naik untuk menggambar ulang (mis. tema berganti).
export const diagram = $state({
  kind: 'erd',
  saved: null,
  loadError: null,
  busy: null,
  status: '',
  activity: null,
  edit: null,
  view: { x: 0, y: 0, z: 1, w: 0, h: 0, touched: false },
  findingsOpen: true,
  tick: 0,
});

let host; // context 'editor' + aksi diagram dari editor.js (lihat diagramHost di editor.js)
let canvasEl = null; // #diagramCanvas, didaftarkan Canvas.svelte
let editInput = null; // textarea kode di mode Edit, didaftarkan EditPane.svelte
let previewTimer = 0;

export function connect(editor) {
  host = editor;
  diagram.kind = host.storageGet('rakit.diagram', 'erd');
  diagram.findingsOpen = host.storageGet('rakit.diagramFindings', true);
}
export const setCanvas = (el) => { canvasEl = el; };
export const setEditInput = (el) => { editInput = el; };
export const costPerPrompt = () => host.costPerPrompt();

export const savedKind = () => diagram.saved?.[diagram.kind];
// Kode yang sedang tampil (untuk Salin): isi panel Edit, atau kode tersimpan.
export const currentCode = () => (diagram.edit ? diagram.edit.code : savedKind()?.code ?? '');
export const rerender = () => { diagram.tick += 1; };

export async function load() {
  if (!DIAGRAM_NAMES[diagram.kind]) diagram.kind = 'erd'; // nilai lama di localStorage yang sudah tidak ada
  if (diagram.saved) return rerender(); // sudah dimuat; diagram hanya berubah lewat Update
  diagram.loadError = null;
  try {
    diagram.saved = (await host.api('GET', '/api/diagrams/saved')).diagrams;
  } catch (err) {
    diagram.loadError = err.message;
  }
}

export function setFindingsOpen(open) {
  diagram.findingsOpen = open;
  host.storageSet('rakit.diagramFindings', open);
}

export async function selectKind(kind) {
  if (kind === diagram.kind || !(await leaveEdit())) return;
  diagram.kind = kind;
  host.storageSet('rakit.diagram', kind);
}

// ---------- Zoom & geser ----------

const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// Zoom dengan titik (cx, cy) di kanvas tetap di tempat — terasa seperti "zoom ke arah kursor".
export function zoomAt(factor, cx, cy) {
  const v = diagram.view;
  const z = clampZoom(v.z * factor);
  if (z === v.z) return;
  v.x = cx - ((cx - v.x) * z) / v.z;
  v.y = cy - ((cy - v.y) * z) / v.z;
  v.z = z;
  v.touched = true;
}

export function zoomAtCenter(factor) {
  zoomAt(factor, canvasEl.clientWidth / 2, canvasEl.clientHeight / 2);
}

export function panBy(dx, dy) {
  const v = diagram.view;
  v.x += dx;
  v.y += dy;
  v.touched = true;
}

// Pas di layar (maks. 150% supaya diagram kecil tidak terlalu besar), di tengah kanvas.
export function fitDiagram() {
  const v = diagram.view;
  const box = canvasEl;
  if (!v.w || !box?.clientWidth) return;
  const pad = 32;
  v.z = clampZoom(Math.min(1.5, (box.clientWidth - pad * 2) / v.w, (box.clientHeight - pad * 2) / v.h));
  v.x = (box.clientWidth - v.w * v.z) / 2;
  v.y = Math.max(pad, (box.clientHeight - v.h * v.z) / 2);
  v.touched = false;
}

export function actualSize() {
  zoomAt(1 / diagram.view.z, canvasEl.clientWidth / 2, canvasEl.clientHeight / 2);
}

// ---------- Buat dengan AI ----------

// Buat ulang diagram jenis yang sedang dibuka dengan AI. renderError: perbaiki kode tersimpan yang gagal digambar
// (gratis) · instruction: ubah diagram (dari mode Edit).
export async function generate(renderError, { instruction } = {}) {
  if (diagram.busy) return;
  const kind = diagram.kind;
  diagram.busy = kind;
  diagram.status = `AI sedang membaca project dan menggambar diagram ${DIAGRAM_NAMES[kind]}… (bisa sampai 1–2 menit)`;
  diagram.activity = createActivity(() => canvasEl?.querySelector('.diagram-progress'));
  try {
    await host.saveAll(); // AI membaca file dari server, jadi simpan perubahan dulu
    const res = await stream({
      kind,
      ...(renderError ? { renderError } : {}),
      ...(instruction ? { instruction, code: diagram.edit?.code } : {}),
    });
    diagram.saved[kind] = res.diagram;
    host.setCredits(res.credits);
    if (diagram.edit && diagram.kind === kind) {
      // Hasil AI sudah disimpan server: jadi dasar baru di panel kode.
      diagram.edit.base = res.diagram.code;
      setEditCode(res.diagram.code, { render: false });
      diagram.edit.ask = '';
    }
    host.toast(instruction ? `Diagram ${DIAGRAM_NAMES[kind]} diubah AI` : renderError ? `Diagram ${DIAGRAM_NAMES[kind]} diperbaiki` : `Diagram ${DIAGRAM_NAMES[kind]} diperbarui`);
  } catch (err) {
    host.toast(err.message, 'error');
    if (err.code === 'no_credits') host.loadCredits();
  } finally {
    diagram.busy = null;
    diagram.activity = null;
  }
}

// Buat diagram sambil mengikuti proses AI-nya (NDJSON, lihat StreamDiagram di server). Hasil: { diagram, credits }.
async function stream(body) {
  const res = await fetch('/api/diagrams/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...host.projectHeaders() },
    body: JSON.stringify({ ...body, stream: true }),
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    host.sessionExpired();
    throw new Error('Sesi berakhir');
  }
  const fail = (data, status) => Object.assign(new Error(data.error || `Gagal (${status})`), { code: data.code });
  // Ditolak sebelum AI mulai (kredit habis, AI sibuk): jawaban JSON biasa.
  if (!(res.headers.get('Content-Type') || '').includes('ndjson')) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw fail(data, res.status);
    return data;
  }
  for await (const ev of host.readEvents(res)) {
    if (ev.type === 'done') return ev;
    if (ev.type === 'error') throw fail(ev, ev.status);
    if (ev.type === 'queued') diagram.status = `Menunggu antrean AI… posisi ${ev.position} dari ${ev.total}`;
    else if (ev.type === 'retry') diagram.status = `AI sedang sibuk, mencoba lagi (${ev.attempt}/${ev.max})…`;
    else if (ev.type === 'reasoning' || ev.type === 'step') diagram.status = `AI sedang menggambar diagram ${DIAGRAM_NAMES[body.kind]}…`;
    diagram.activity?.handle(ev);
  }
  throw new Error('Koneksi ke server terputus. Coba lagi.');
}

// ---------- Edit diagram ----------
// Mode Edit: panel kode Mermaid di samping kanvas (pratinjau langsung saat mengetik), klik teks di diagram untuk
// menggantinya, dan "Ubah dengan AI". Simpan = PUT /api/diagrams/saved/<jenis> (tanpa kredit).

export function startEdit() {
  const saved = savedKind();
  if (!saved || diagram.busy) return;
  diagram.edit = { code: saved.code, base: saved.code, preview: saved.code, error: null, ask: '', saving: false };
}

function stopEdit() {
  clearTimeout(previewTimer);
  diagram.edit = null;
}

// Keluar dari mode Edit; perubahan yang belum disimpan dikonfirmasi dulu. Hasil: true bila jadi keluar.
export async function leaveEdit() {
  const edit = diagram.edit;
  if (!edit) return true;
  if (edit.code !== edit.base) {
    const ok = await host.confirm({
      title: 'Buang perubahan diagram?',
      message: 'Perubahan kode diagram belum disimpan.',
      buttons: [{ label: 'Buang perubahan', value: true, primary: true, danger: true }, { label: 'Lanjut mengedit', value: null }],
    });
    if (!ok || diagram.edit !== edit) return false;
  }
  stopEdit();
  return true;
}

// Kode di panel berubah (diketik, teks diganti dari diagram, atau hasil AI): gambar ulang sebentar kemudian.
export function setEditCode(code, { render = true } = {}) {
  const edit = diagram.edit;
  if (!edit) return;
  edit.code = code;
  clearTimeout(previewTimer);
  if (render) previewTimer = setTimeout(() => { if (diagram.edit === edit) edit.preview = code; }, 350);
  else edit.preview = code;
}

export function setEditError(message) {
  if (diagram.edit) diagram.edit.error = message;
}

export async function saveEdit() {
  const edit = diagram.edit;
  if (!edit || edit.error || diagram.busy || edit.code === edit.base || edit.saving) return;
  const kind = diagram.kind;
  edit.saving = true;
  try {
    const res = await host.api('PUT', `/api/diagrams/saved/${kind}`, { code: edit.code });
    diagram.saved[kind] = res.diagram;
    if (diagram.edit === edit) stopEdit();
    host.toast(`Diagram ${DIAGRAM_NAMES[kind]} disimpan`);
  } catch (err) {
    host.toast(err.message, 'error');
    edit.saving = false;
  }
}

export function askChange() {
  const instruction = diagram.edit?.ask.trim();
  if (!instruction || diagram.busy) return;
  generate(null, { instruction });
}

// Klik teks di diagram (mode Edit): ganti teks itu di kode. Kalau muncul lebih dari sekali, dipilihkan di panel
// kode supaya diubah di sana.
export async function renameLabel(label) {
  const edit = diagram.edit;
  const count = edit.code.split(label).length - 1;
  if (!count) return host.toast(`"${label}" tidak ditemukan apa adanya di kode. Ubah lewat panel kode.`, 'error');
  if (count > 1) {
    const at = edit.code.indexOf(label);
    editInput.focus();
    editInput.setSelectionRange(at, at + label.length);
    return host.toast(`"${label}" ada ${count} kali di kode — yang pertama sudah dipilih di panel kode.`);
  }
  const next = await host.confirm({
    title: 'Ganti teks di diagram',
    input: { value: label },
    buttons: [{ label: 'Ganti', value: true, primary: true }, { label: 'Batal', value: null }],
  });
  if (!next || next === label || diagram.edit !== edit) return;
  const at = edit.code.indexOf(label);
  setEditCode(edit.code.slice(0, at) + next + edit.code.slice(at + label.length), { render: false });
}

// ---------- Salin & unduh ----------

export function copyCode() {
  const code = currentCode();
  if (code) host.copyText(code, 'Kode Mermaid disalin');
  else host.toast('Belum ada diagram', 'error');
}

export function download() {
  const svgEl = canvasEl?.querySelector('svg');
  if (!svgEl) return host.toast('Belum ada diagram untuk diunduh', 'error');
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(diagram.view.w));
  clone.setAttribute('height', String(diagram.view.h));
  clone.style.background = host.isDark() ? '#11151f' : '#fffdf7';
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${host.projectSlug()}-${diagram.kind}.svg`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
