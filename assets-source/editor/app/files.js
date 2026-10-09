// File project: pohon file, tab & model Monaco, simpan (otomatis), buat/ganti nama/hapus, upload gambar, sinkron
// dari server setelah AI/riwayat mengubah file, dan perbandingan isi file.
import { SvelteSet } from 'svelte/reactivity';
import { core as state } from '../files/state.svelte.js';
import ImageViewer from '../files/ImageViewer.svelte';
import { toast, ui, showMenu } from '../shell/state.svelte.js';
import DiffDialog from '../shell/DiffDialog.svelte';
import { ai } from '../ai/state.svelte.js';
import { IMAGE_EXT, autoFocus, baseName, extOf, formatBytes, isImage, joinPath, parentOf, storage, within } from './util.js';
import { api } from './api.js';
import { editor, editorReady, monaco, monacoTheme, updateStatus } from './monaco.js';
import { previewBase, quietSaves, reloadPreview, schedulePreviewReload, urlFor } from './preview.js';
import { ask, dbLoad, modal, setMobileView, setMode, setSaveStatus } from './shell.js';
import { openDialog } from './context.js';
import { flowContentChanged, flowFollow } from './flow.js';

// ---------- State ----------
// Keadaan inti (project, file, tab) ada di assets-source/editor/files/state.svelte.js, reaktif supaya pohon file,
// tab, dan breadcrumb (komponen) mengikuti perubahan di sini.
state.autosave = storage.get('rakit.autosave', true);

// ---------- Explorer ----------
// Pohon file & pemakaian storage digambar FileTree.svelte & Usage.svelte dari state.

export async function loadTree() {
  const { files, usage } = await api('GET', '/api/files');
  state.entries = files;
  state.limits = usage.limits;
  state.usage = usage;
}

export function expandTo(path) {
  let dir = parentOf(path);
  while (dir) {
    state.expanded.add(dir);
    dir = parentOf(dir);
  }
}

// Folder target untuk "file baru": folder terpilih, atau folder induk file terpilih.
export function targetDir(path = state.selected) {
  if (!path) return '';
  const entry = state.entries.find((e) => e.path === path);
  return entry?.type === 'dir' ? path : parentOf(path);
}

// ---------- Editor & tab ----------
export const isDirty = (path) => state.models.has(path) && state.models.get(path).getValue() !== state.saved.get(path);
// state.dirty (reaktif) mengikuti isDirty: tanda ● di tab, pohon file, dan judul halaman.
export const markDirty = (path) => { if (isDirty(path)) state.dirty.add(path); else state.dirty.delete(path); };

export function createModel(path, content, savedContent = content) {
  const model = monaco.editor.createModel(content, undefined, monaco.Uri.parse(`file:///${path}`));
  model.onDidChangeContent(() => onContentChange(path));
  state.models.set(path, model);
  state.saved.set(path, savedContent);
  markDirty(path);
  return model;
}

export async function openFile(path) {
  try {
    await editorReady; // Monaco dimuat paralel saat editor dibuka; file baru bisa dibuka setelah siap
  } catch {
    return toast('Editor kode gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
  }
  if (!state.models.has(path)) {
    try {
      const { content } = await api('GET', `/api/files/content?path=${encodeURIComponent(path)}`);
      if (!state.models.has(path)) createModel(path, content);
    } catch (err) {
      return toast(err.message, 'error');
    }
  }
  if (!state.tabs.includes(path)) state.tabs.push(path);
  activate(path);
}

export function activate(path) {
  if (state.active && state.active !== path && state.models.has(state.active)) {
    state.viewStates.set(state.active, editor.saveViewState());
  }
  state.active = path;
  state.selected = path;
  if (path) {
    editor.setModel(state.models.get(path));
    const vs = state.viewStates.get(path);
    if (vs) editor.restoreViewState(vs);
    if (ui.mode === 'code') autoFocus(editor); // jangan rebut fokus dari kotak AI dsb.
    expandTo(path);
    if (extOf(path) === 'html' && state.previewPath !== path) {
      state.previewPath = path;
      state.previewRoute = null;
      reloadPreview();
    }
  } else {
    editor.setModel(null);
  }
  updateStatus();
  flowFollow();
}

// Tab & breadcrumb digambar Tabs.svelte & Breadcrumbs.svelte dari state.

export function disposeFile(path) {
  clearTimeout(state.saveTimers.get(path));
  state.saveTimers.delete(path);
  state.models.get(path)?.dispose();
  state.models.delete(path);
  state.saved.delete(path);
  state.viewStates.delete(path);
  state.dirty.delete(path);
}

export function removeTabs(predicate) {
  const index = state.tabs.findIndex((p) => p === state.active);
  const removed = state.tabs.filter(predicate);
  if (!removed.length) return;
  state.tabs = state.tabs.filter((p) => !predicate(p));
  const next = removed.includes(state.active)
    ? state.tabs[Math.min(index, state.tabs.length - 1)] ?? null
    : state.active;
  if (removed.includes(state.active)) state.active = null;
  activate(next);
  removed.forEach(disposeFile);
}

export async function closeTab(path) {
  if (isDirty(path)) {
    const choice = await modal({
      title: 'Simpan perubahan?',
      message: `"${baseName(path)}" punya perubahan yang belum disimpan.`,
      buttons: [
        { label: 'Simpan', value: 'save', primary: true },
        { label: 'Jangan simpan', value: 'discard' },
        { label: 'Batal', value: null },
      ],
    });
    if (!choice) return;
    if (choice === 'save' && !(await save(path))) return;
  }
  removeTabs((p) => p === path);
}

// ---------- Simpan ----------
export function onContentChange(path) {
  markDirty(path);
  flowContentChanged(path);
  if (isDirty(path)) setSaveStatus('Belum disimpan', 'dirty');
  if (state.autosave) {
    clearTimeout(state.saveTimers.get(path));
    state.saveTimers.set(path, setTimeout(() => save(path), 800));
  }
}

// Simpan berurutan per file supaya autosave & Ctrl+S tidak saling balapan.
export function save(path) {
  const chain = (state.saveChains.get(path) ?? Promise.resolve()).then(() => doSave(path));
  state.saveChains.set(path, chain);
  return chain;
}

export async function doSave(path) {
  clearTimeout(state.saveTimers.get(path));
  const quiet = quietSaves.delete(path); // perubahan dari mode Edit di preview: sudah tampil di sana
  const model = state.models.get(path);
  if (!model) return true;
  const content = model.getValue();
  if (content === state.saved.get(path)) return true;
  setSaveStatus('Menyimpan…');
  try {
    await api('PUT', '/api/files/content', { path, content });
    if (!state.models.has(path)) return true;
    state.saved.set(path, content);
    setSaveStatus(`Tersimpan ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`, 'saved');
    markDirty(path);
    if (!quiet) schedulePreviewReload();
    refreshUsageSoon();
    return true;
  } catch (err) {
    setSaveStatus('Gagal menyimpan', 'error');
    toast(`Gagal menyimpan ${baseName(path)}: ${err.message}`, 'error');
    return false;
  }
}

export async function saveAll() {
  await Promise.all(state.tabs.filter(isDirty).map(save));
}

export let usageTimer;
export function refreshUsageSoon() {
  clearTimeout(usageTimer);
  usageTimer = setTimeout(() => loadTree().catch(() => {}), 1500);
}

// ---------- Operasi file ----------
export async function createEntry(type, dir = targetDir()) {
  const name = await ask(
    type === 'file' ? 'File baru' : 'Folder baru',
    type === 'file' ? 'nama-file.html / .css / .js' : 'nama-folder',
  );
  if (!name) return;
  const path = joinPath(dir, name);
  try {
    await api('POST', '/api/files', { path, type });
    if (dir) state.expanded.add(dir);
    expandTo(path);
    if (type === 'dir') state.expanded.add(path);
    state.selected = path;
    await loadTree();
    if (type === 'file') await openFile(path);
  } catch (err) {
    toast(err.message, 'error');
  }
}

export async function renameEntry(path) {
  const name = await ask('Ganti nama', 'Nama baru', baseName(path));
  if (!name || name === baseName(path)) return;
  const to = joinPath(parentOf(path), name);
  try {
    await api('POST', '/api/files/rename', { from: path, to });
  } catch (err) {
    return toast(err.message, 'error');
  }
  remapPaths(path, to);
  await loadTree();
}

// Setelah rename, pindahkan model/tab yang terbuka ke path baru tanpa kehilangan perubahan.
export function remapPaths(from, to) {
  const map = (p) => (within(p, from) ? to + p.slice(from.length) : p);
  if (state.active && within(state.active, from)) state.viewStates.set(state.active, editor.saveViewState());

  const moved = [...state.models.keys()].filter((p) => within(p, from));
  const wasActive = state.active;
  for (const oldPath of moved) {
    const newPath = map(oldPath);
    const oldModel = state.models.get(oldPath);
    createModel(newPath, oldModel.getValue(), state.saved.get(oldPath));
    state.viewStates.set(newPath, state.viewStates.get(oldPath));
    if (oldPath === wasActive) editor.setModel(state.models.get(newPath));
    disposeFile(oldPath);
    if (isDirty(newPath) && state.autosave) save(newPath);
  }
  state.tabs = state.tabs.map(map);
  state.expanded = new SvelteSet([...state.expanded].map(map));
  if (state.active) state.active = map(state.active);
  if (state.selected) state.selected = map(state.selected);
  if (within(state.previewPath, from)) {
    state.previewPath = map(state.previewPath);
    state.previewRoute = null;
    reloadPreview();
  }
  activate(state.active);
}

export async function deleteEntry(path) {
  const isDir = state.entries.find((e) => e.path === path)?.type === 'dir';
  const ok = await modal({
    title: `Hapus ${isDir ? 'folder' : 'file'}?`,
    message: `"${path}" akan dihapus permanen.${isDir ? ' Semua isinya ikut terhapus.' : ''}`,
    buttons: [{ label: 'Hapus', value: true, primary: true, danger: true }, { label: 'Batal', value: null }],
  });
  if (!ok) return;
  try {
    await api('DELETE', `/api/files?path=${encodeURIComponent(path)}`);
  } catch (err) {
    return toast(err.message, 'error');
  }
  removeTabs((p) => within(p, path));
  if (state.selected && within(state.selected, path)) state.selected = null;
  await loadTree();
  schedulePreviewReload();
}

// ---------- Gambar ----------
export const imageUrl = (path) => `${previewBase()}/${path}?v=${state.entries.find((e) => e.path === path)?.size ?? 0}-${Date.now()}`;

// Nama file dari perangkat user dirapikan supaya lolos validasi path (huruf, angka, . - _).
export function cleanFileName(name) {
  const dot = name.lastIndexOf('.');
  const ext = (dot > 0 ? name.slice(dot + 1) : '').toLowerCase().replace('jpeg', 'jpg');
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-.]+$/g, '').slice(0, 58) || 'gambar';
  return `${base}.${ext}`;
}

export function uniquePath(path) {
  const taken = new Set(state.entries.map((e) => e.path));
  if (!taken.has(path)) return path;
  const dot = path.lastIndexOf('.');
  for (let i = 1; ; i++) {
    const candidate = `${path.slice(0, dot)}-${i}${path.slice(dot)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// replacePath: ganti gambar tertentu (dari menu "Ganti gambar…").
export function pickImages(dir = targetDir(), replacePath = null) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: IMAGE_EXT.map((e) => `.${e}`).join(','), multiple: !replacePath });
  input.onchange = () => uploadImages([...input.files], dir, replacePath);
  input.click();
}

export function bindImageDrop(tree) {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const dropDir = (e) => {
    const row = e.target.closest('.row');
    return row ? targetDir(row.dataset.path) : '';
  };
  tree.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; tree.classList.add('drop-target'); } });
  tree.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; tree.classList.remove('drop-target'); } });
  tree.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    state.dropDir = dropDir(e) || null;
  });
  tree.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    tree.classList.remove('drop-target');
    state.dropDir = null;
    uploadImages([...e.dataTransfer.files], dropDir(e));
  });
}

// Hasil: path gambar yang berhasil diunggah. reload: false = preview tidak dimuat ulang (mis. Ganti gambar
// di preview, yang memperbarui gambarnya sendiri).
export async function uploadImages(files, dir, replacePath = null, { reload = true } = {}) {
  const limit = state.limits?.imageSize ?? 1048576;
  const accepted = [];
  for (const file of files) {
    if (!isImage(file.name)) {
      toast(`"${file.name}" dilewati: hanya gambar ${IMAGE_EXT.join(', ')}`, 'error');
    } else if (file.size > limit) {
      toast(`"${file.name}" terlalu besar (${formatBytes(file.size)}). Maksimal ${formatBytes(limit)} per gambar${ai.credits?.plan ? '' : ' di paket Gratis'}.`, 'error');
    } else {
      accepted.push(file);
    }
  }
  if (!accepted.length) return [];

  const uploaded = [];
  setSaveStatus(`Mengunggah ${accepted.length} gambar…`, 'saving');
  for (const file of accepted) {
    let path = replacePath ?? joinPath(dir, cleanFileName(file.name));
    let overwrite = Boolean(replacePath);
    if (!replacePath && state.entries.some((e) => e.path === path)) {
      const choice = await modal({
        title: 'Gambar sudah ada',
        message: `"${path}" sudah ada di project. Ganti dengan yang baru, atau simpan dengan nama lain?`,
        buttons: [{ label: 'Ganti', value: 'replace', primary: true }, { label: 'Simpan sebagai baru', value: 'rename' }, { label: 'Lewati', value: null }],
      });
      if (!choice) continue;
      if (choice === 'replace') overwrite = true;
      else path = uniquePath(path);
    }
    try {
      const res = await fetch(`/api/files/upload?path=${encodeURIComponent(path)}${overwrite ? '&overwrite=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream', ...(state.projectSlug ? { 'X-Project': state.projectSlug } : {}) },
        body: file,
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
      uploaded.push(data.path);
      // Catat segera supaya cek "sudah ada" untuk file berikutnya tetap akurat.
      if (!state.entries.some((e) => e.path === data.path)) state.entries.push({ path: data.path, name: baseName(data.path), type: 'file', size: file.size });
    } catch (err) {
      toast(`"${file.name}": ${err.message}`, 'error');
      if (/Kuota|Maksimal/.test(err.message)) break; // kuota penuh: berhenti, sisanya pasti gagal juga
    }
  }
  setSaveStatus('');
  if (!uploaded.length) return uploaded;
  const last = uploaded[uploaded.length - 1];
  if (dir) state.expanded.add(dir);
  expandTo(last);
  state.selected = last;
  await loadTree().catch(() => {});
  if (reload) schedulePreviewReload();
  toast(uploaded.length === 1 ? `Gambar diunggah: /${last}` : `${uploaded.length} gambar diunggah`);
  return uploaded;
}

export function openImage(path) {
  openDialog(ImageViewer, {
    path,
    src: imageUrl(path),
    onReplace: () => pickImages(parentOf(path), path),
    onDelete: () => deleteEntry(path),
  });
}

// ---------- Context menu ----------
// showMenu()/hideMenu(): assets-source/editor/shell/state.svelte.js (digambar ContextMenu.svelte).

export function treeMenu(entry) {
  const dir = entry ? targetDir(entry.path) : '';
  const items = [
    { label: 'File baru…', run: () => createEntry('file', dir) },
    { label: 'Folder baru…', run: () => createEntry('dir', dir) },
    { label: 'Upload gambar…', run: () => pickImages(dir) },
  ];
  if (!entry) return items;
  const fileItems = entry.type === 'file' && isImage(entry.path) ? [
    { label: 'Lihat gambar', run: () => openImage(entry.path) },
    { label: 'Salin path', run: () => copyText(`/${entry.path}`, 'Path disalin') },
    { label: 'Salin URL publik', run: () => copyText(urlFor(entry.path)) },
    { label: 'Ganti gambar…', run: () => pickImages(parentOf(entry.path), entry.path) },
    '-',
  ] : entry.type === 'file' ? [
    { label: 'Buka', run: () => openFile(entry.path) },
    extOf(entry.path) === 'html' && { label: 'Preview halaman ini', run: () => { state.previewPath = entry.path; state.previewRoute = null; reloadPreview(); } },
    { label: 'Salin URL publik', run: () => copyText(urlFor(entry.path)) },
    '-',
  ] : [];
  return [
    ...fileItems,
    ...items,
    '-',
    { label: 'Ganti nama…', hint: 'F2', run: () => renameEntry(entry.path) },
    { label: 'Hapus', hint: 'Del', danger: true, run: () => deleteEntry(entry.path) },
  ];
}

export async function copyText(text, message = 'URL disalin') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast(text);
  }
}

// Pohon file (attachment #tree): klik baris / tombol ⋯, klik kanan, F2 & Delete, seret gambar ke folder.
export function treeEvents(tree) {
  tree.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const { path, type } = row.dataset;
    if (e.target.closest('.row-more')) {
      const rect = e.target.closest('.row-more').getBoundingClientRect();
      state.selected = path;
      showMenu(rect.right, rect.bottom + 4, treeMenu(state.entries.find((x) => x.path === path)), { align: 'right' });
      return;
    }
    state.selected = path;
    if (type === 'dir') {
      state.expanded.has(path) ? state.expanded.delete(path) : state.expanded.add(path);
    } else if (isImage(path)) {
      openImage(path);
    } else {
      setMode('code');
      setMobileView('editor');
      openFile(path);
    }
  });
  tree.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const row = e.target.closest('.row');
    const entry = row ? state.entries.find((x) => x.path === row.dataset.path) : null;
    if (entry) state.selected = entry.path;
    showMenu(e.clientX, e.clientY, treeMenu(entry));
  });
  tree.addEventListener('keydown', (e) => {
    if (!state.selected) return;
    if (e.key === 'F2') { e.preventDefault(); renameEntry(state.selected); }
    if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) { e.preventDefault(); deleteEntry(state.selected); }
  });
  bindImageDrop(tree);
}

// Muat ulang file yang diubah server (oleh AI atau Batalkan) ke editor, pohon file, dan preview.
export async function syncFromServer(paths, { openFirst = false } = {}) {
  await loadTree();
  for (const path of paths) {
    const model = state.models.get(path);
    if (!model) continue;
    if (!state.entries.some((e) => e.path === path && e.type === 'file')) {
      removeTabs((p) => p === path);
      continue;
    }
    try {
      const { content } = await api('GET', `/api/files/content?path=${encodeURIComponent(path)}`);
      clearTimeout(state.saveTimers.get(path));
      state.saved.set(path, content);
      // Lewat model supaya Ctrl+Z tetap bisa; isinya sama dengan versi tersimpan, jadi tidak disimpan ulang.
      if (model.getValue() !== content) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
    } catch { /* abaikan: file akan dimuat saat dibuka */ }
    markDirty(path);
  }
  const first = paths.find((p) => state.entries.some((e) => e.path === p && e.type === 'file'));
  if (openFirst && first) {
    expandTo(first);
    await openFile(first);
  }
  if (ui.mode === 'data') dbLoad();
  reloadPreview();
}

// `before` = isi file sebelum perubahan AI ('' untuk file baru).
// caption: keterangan opsional di bawah judul (mis. kiri = versi lama, kanan = sekarang).
export async function showDiff(change, before, caption) {
  try {
    await editorReady;
  } catch {
    return toast('Editor kode gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
  }
  openDialog(DiffDialog, { path: change.path, caption, before, after: change.content, monaco, theme: monacoTheme() });
}

// File awal (index.html, style.css, script.js) dibuka begitu Monaco siap; index.html jadi tab aktif.
export async function openStartFiles() {
  const first = ['index.html', 'style.css', 'script.js'].filter((p) => state.entries.some((e) => e.path === p));
  for (const path of first) await openFile(path);
  if (first.length) activate(first[0]);
  else activate(null);
}
