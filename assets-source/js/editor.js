import { mount, unmount, flushSync } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { core as state } from '../editor/files/state.svelte.js';
import ImageViewer from '../editor/files/ImageViewer.svelte';
import NewProjectDialog from '../editor/files/NewProjectDialog.svelte';
import App from '../editor/shell/App.svelte';
import { ui, views, toast, showMenu } from '../editor/shell/state.svelte.js';
import ConfirmDialog from '../editor/shell/ConfirmDialog.svelte';
import DiffDialog from '../editor/shell/DiffDialog.svelte';
import ImageEditDialog from '../editor/preview/ImageEditDialog.svelte';
import { preview, MAX_BLOCKS, pageName } from '../editor/preview/state.svelte.js';
import Topup from '../editor/Topup.svelte';
import Assistant from '../editor/assistant/Assistant.svelte';
import SettingsDialog from '../editor/settings/SettingsDialog.svelte';
import PublishDialog from '../editor/publish/PublishDialog.svelte';
import PublishModeDialog from '../editor/publish/PublishModeDialog.svelte';
import { SPARK, CLOSE } from '../editor/icons.js';
import CreateTableDialog from '../editor/database/CreateTableDialog.svelte';
import { db, connect as connectDb, load as loadDb, loadRows as loadDbRows } from '../editor/database/state.svelte.js';
import { tableUrl } from '../editor/database/types.js';
import { rupiah, shortDate } from '../editor/format.js';
import { clipText, fnFixPrompt } from '../editor/handoff.js';
import FeatureInfo from '../editor/FeatureInfo.svelte';
import {
  ai, connect as connectAi, setMode as setAiModeState, setInput as setAiInput, initHistory as initAiHistory,
  newConversation, openThread, clearHistory, guardBusy, unlimitedLeft, canAfford,
} from '../editor/ai/state.svelte.js';
import { FEATURE_INFO } from '../editor/features.js';
import { renderMarkdown } from '../editor/markdown.js';
import { diagram, connect as connectDiagram, load as loadDiagram, rerender as rerenderDiagram } from '../editor/diagram/state.svelte.js';
import { DIAGRAM_NAMES } from '../editor/diagram/info.js';
import { loadMermaid as loadMermaidFor } from '../editor/mermaid.js';
import { flow, flowSteps, flowStale } from '../editor/flow/state.svelte.js';
import { connect as connectConsole, add as addConsoleLog, open as openConsole } from '../editor/console/state.svelte.js';

(() => {
  'use strict';

  // ---------- Util ----------
  const $ = (s, el = document) => el.querySelector(s);

  const ICON = {
    block: 'M1 1h4v1H2v3H1zm10 0h4v4h-1V2h-3zM1 11h1v3h3v1H1zm14 0v4h-4v-1h3v-3zM5 5h6v6H5z',
    close: CLOSE,
    table: 'M1.5 2h13l.5.5v11l-.5.5h-13l-.5-.5v-11zM2 3v3h5V3zm6 0v3h6V3zM2 7v3h5V7zm6 0v3h6V7zm-6 4v2h5v-2zm6 0v2h6v-2z',
    lock: 'M8 1a3 3 0 0 0-3 3v2H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3m2 5H6V4a2 2 0 1 1 4 0z',
    trash: 'M6 1h4l.5.5V3H14v1h-1v10.5l-.5.5h-9l-.5-.5V4H2V3h3.5V1.5zM6.5 3h3V2h-3zM4 4v10h8V4zm2 2h1v6H6zm3 0h1v6H9z',
    refresh: 'M13.45 5.17A6 6 0 1 0 14 8h-1a5 5 0 1 1-.8-2.73l-1.7.23.14 1 3.4-.5-.5-3.4-1 .14z',
    gear: 'M9.1 1l.4 1.9 1 .4 1.6-1.1 1.6 1.6-1.1 1.6.4 1 1.9.4v2.3l-1.9.4-.4 1 1.1 1.6-1.6 1.6-1.6-1.1-1 .4-.4 1.9H6.9l-.4-1.9-1-.4-1.6 1.1-1.6-1.6 1.1-1.6-.4-1L1 9.1V6.9l1.9-.4.4-1-1.1-1.6 1.6-1.6 1.6 1.1 1-.4L6.9 1zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
    flow: 'M2 1.5h5l.5.5v3l-.5.5H5v2h3.5V7l.5-.5h5l.5.5v3l-.5.5H9l-.5-.5v-.5H5v2.5h2l.5.5v2l-.5.5H2l-.5-.5v-2l.5-.5h2v-6H2l-.5-.5V2zm.5 1v2h4v-2zm7 5v2h4v-2zm-7 5v1h4v-1z',
  };

  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* abaikan */ }
    },
  };

  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
  const extOf = (p) => (baseName(p).includes('.') ? baseName(p).split('.').pop().toLowerCase() : '');
  const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name).replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  const within = (p, base) => p === base || p.startsWith(`${base}/`);
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'];
  const isImage = (p) => IMAGE_EXT.includes(extOf(p));
  // Bahasa antarmuka: /en/editor memuat versi Inggris skrip ini (dibuat scripts/i18n.mjs dari teks di sini).
  const LANG = document.documentElement.lang === 'en' ? 'en' : 'id';
  const HOME = LANG === 'en' ? '/en' : '/';
  const EDITOR_PATH = LANG === 'en' ? '/en/editor' : '/editor';
  const formatBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

  // ---------- State ----------
  // Keadaan inti (project, file, tab) ada di assets-source/editor/files/state.svelte.js, reaktif supaya pohon file,
  // tab, dan breadcrumb (komponen) mengikuti perubahan di sini.
  state.autosave = storage.get('rakit.autosave', true);
  let monaco;
  let editor;

  // ---------- API ----------
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(state.projectSlug ? { 'X-Project': state.projectSlug } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      location.href = HOME;
      throw new Error('Sesi berakhir');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Gagal (${res.status})`);
      err.code = data.code;
      throw err;
    }
    return data;
  }

  // ---------- Toast & status ----------
  // toast(): assets-source/editor/shell/state.svelte.js (ditampilkan App.svelte).
  function setSaveStatus(text, kind = '') {
    ui.save = { text, kind };
  }

  // ---------- Modal ----------
  // Dialog tanya/konfirmasi (ConfirmDialog.svelte). Hasil: nilai tombol, isi input (bila ada), atau null (Esc / klik
  // di luar dialog). Sesudahnya fokus kembali ke editor kode.
  function modal({ title, message, input, buttons }) {
    return new Promise((resolve) => {
      let result = null;
      const close = openDialog(ConfirmDialog, {
        title, message, input, buttons,
        answer: (value) => { result = value; close(); },
      }, { onClose: () => { resolve(result); autoFocus(editor); } });
    });
  }

  const ask = (title, placeholder, value = '') =>
    modal({ title, input: { placeholder, value }, buttons: [{ label: 'OK', primary: true }, { label: 'Batal', value: null }] });

  // ---------- Explorer ----------
  // Pohon file & pemakaian storage digambar FileTree.svelte & Usage.svelte dari state.

  async function loadTree() {
    const { files, usage } = await api('GET', '/api/files');
    state.entries = files;
    state.limits = usage.limits;
    state.usage = usage;
  }

  function expandTo(path) {
    let dir = parentOf(path);
    while (dir) {
      state.expanded.add(dir);
      dir = parentOf(dir);
    }
  }

  // Folder target untuk "file baru": folder terpilih, atau folder induk file terpilih.
  function targetDir(path = state.selected) {
    if (!path) return '';
    const entry = state.entries.find((e) => e.path === path);
    return entry?.type === 'dir' ? path : parentOf(path);
  }

  // ---------- Editor & tab ----------
  const isDirty = (path) => state.models.has(path) && state.models.get(path).getValue() !== state.saved.get(path);
  // state.dirty (reaktif) mengikuti isDirty: tanda ● di tab, pohon file, dan judul halaman.
  const markDirty = (path) => { if (isDirty(path)) state.dirty.add(path); else state.dirty.delete(path); };

  function createModel(path, content, savedContent = content) {
    const model = monaco.editor.createModel(content, undefined, monaco.Uri.parse(`file:///${path}`));
    model.onDidChangeContent(() => onContentChange(path));
    state.models.set(path, model);
    state.saved.set(path, savedContent);
    markDirty(path);
    return model;
  }

  async function openFile(path) {
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

  function activate(path) {
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

  function disposeFile(path) {
    clearTimeout(state.saveTimers.get(path));
    state.saveTimers.delete(path);
    state.models.get(path)?.dispose();
    state.models.delete(path);
    state.saved.delete(path);
    state.viewStates.delete(path);
    state.dirty.delete(path);
  }

  function removeTabs(predicate) {
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

  async function closeTab(path) {
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
  function onContentChange(path) {
    markDirty(path);
    flowContentChanged(path);
    if (isDirty(path)) setSaveStatus('Belum disimpan', 'dirty');
    if (state.autosave) {
      clearTimeout(state.saveTimers.get(path));
      state.saveTimers.set(path, setTimeout(() => save(path), 800));
    }
  }

  // Simpan berurutan per file supaya autosave & Ctrl+S tidak saling balapan.
  function save(path) {
    const chain = (state.saveChains.get(path) ?? Promise.resolve()).then(() => doSave(path));
    state.saveChains.set(path, chain);
    return chain;
  }

  async function doSave(path) {
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

  async function saveAll() {
    await Promise.all(state.tabs.filter(isDirty).map(save));
  }

  let usageTimer;
  function refreshUsageSoon() {
    clearTimeout(usageTimer);
    usageTimer = setTimeout(() => loadTree().catch(() => {}), 1500);
  }

  // ---------- Operasi file ----------
  async function createEntry(type, dir = targetDir()) {
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

  async function renameEntry(path) {
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
  function remapPaths(from, to) {
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

  async function deleteEntry(path) {
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
  // Alamat versi yang sedang diedit: dev pada publikasi manual, selain itu website itu sendiri.
  const previewBase = () => state.project.previewUrl || state.project.siteUrl;
  const imageUrl = (path) => `${previewBase()}/${path}?v=${state.entries.find((e) => e.path === path)?.size ?? 0}-${Date.now()}`;

  // Nama file dari perangkat user dirapikan supaya lolos validasi path (huruf, angka, . - _).
  function cleanFileName(name) {
    const dot = name.lastIndexOf('.');
    const ext = (dot > 0 ? name.slice(dot + 1) : '').toLowerCase().replace('jpeg', 'jpg');
    const base = (dot > 0 ? name.slice(0, dot) : name)
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-.]+$/g, '').slice(0, 58) || 'gambar';
    return `${base}.${ext}`;
  }

  function uniquePath(path) {
    const taken = new Set(state.entries.map((e) => e.path));
    if (!taken.has(path)) return path;
    const dot = path.lastIndexOf('.');
    for (let i = 1; ; i++) {
      const candidate = `${path.slice(0, dot)}-${i}${path.slice(dot)}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  // replacePath: ganti gambar tertentu (dari menu "Ganti gambar…").
  function pickImages(dir = targetDir(), replacePath = null) {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: IMAGE_EXT.map((e) => `.${e}`).join(','), multiple: !replacePath });
    input.onchange = () => uploadImages([...input.files], dir, replacePath);
    input.click();
  }

  function bindImageDrop(tree) {
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
  async function uploadImages(files, dir, replacePath = null, { reload = true } = {}) {
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

  function openImage(path) {
    openDialog(ImageViewer, {
      path,
      src: imageUrl(path),
      onReplace: () => pickImages(parentOf(path), path),
      onDelete: () => deleteEntry(path),
    });
  }

  // ---------- Context menu ----------
  // showMenu()/hideMenu(): assets-source/editor/shell/state.svelte.js (digambar ContextMenu.svelte).

  function treeMenu(entry) {
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

  async function copyText(text, message = 'URL disalin') {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      toast(text);
    }
  }

  // ---------- Preview ----------
  // Alamat halaman (tanpa host) untuk sebuah file: index.html → "/", blog/index.html → "/blog/".
  function routeFor(path) {
    return `/${path === 'index.html' ? '' : path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path}`;
  }

  function urlFor(path) {
    return `${state.project.siteUrl}${routeFor(path)}`;
  }

  function reloadPreview() {
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
  const pick = preview.pick;
  const siteOrigin = () => new URL(previewBase()).origin;
  const toPicker = (message) => $('#previewFrame').contentWindow?.postMessage({ rakit: true, lang: LANG, ...message }, siteOrigin());
  const blocksOn = (page) => pick.blocks.filter((b) => b.page === page);
  // Jatah di halaman yang sedang tampil = 5 dikurangi blok di halaman lain.
  const pageLimit = () => MAX_BLOCKS - pick.blocks.filter((b) => b.page !== pick.page).length;

  function setPick(on) {
    pick.on = on;
    if (!on) pick.blocks = [];
    if (on && textEdit.on) setTextEdit(false, { quiet: true });
    toPicker({ type: 'pick', on, limit: pageLimit(), restore: on ? blocksOn(pick.page).map((b) => b.selector) : undefined });
  }

  function removeBlock(b) {
    if (b.page === pick.page) return toPicker({ type: 'remove', selector: b.selector });
    // Blok di halaman lain: halaman itu tidak sedang dimuat, cukup dilepas di sini.
    pick.blocks = pick.blocks.filter((x) => x !== b);
    toPicker({ type: 'limit', limit: pageLimit() });
  }

  function bindBlockPicker() {
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
  const textEdit = preview.textEdit;
  // Disimpan tanpa memuat ulang preview: teks barunya sudah tampil di sana.
  const quietSaves = new Set();
  const htmlDecoder = document.createElement('textarea');
  const decodeHtml = (raw) => { htmlDecoder.innerHTML = raw; return htmlDecoder.value; };

  function setTextEdit(on, { quiet = false } = {}) {
    textEdit.on = on;
    if (on && pick.on) setPick(false);
    if (!quiet) toPicker({ type: 'textMode', on });
  }

  // File HTML untuk pathname halaman di preview, seperti server menyajikannya ("/" -> index.html,
  // "/tentang" -> tentang.html).
  function pageFile(pathname) {
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

  function textEditFailed(message) {
    toast(message, 'error');
    reloadPreview(); // kembalikan teks di preview sesuai file
  }

  // Model Monaco file `path` (dimuat bila belum dibuka). Hasil: { path, model } atau { error }.
  async function fileModel(path) {
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
  function pageModel(page) {
    const path = pageFile(String(page));
    return path ? fileModel(path) : Promise.resolve({ error: 'Halaman ini tidak ditemukan di file project, jadi tidak bisa diubah dari preview.' });
  }

  // Tempat teks elemen di sumber: HTML halaman; untuk teks yang diisi skrip/Alpine (x-text, innerHTML), baris
  // database asalnya (dikenali preview dari data /api/db yang dibaca halaman) atau string di HTML halaman /
  // file JS project. after = before untuk sekadar memeriksa (saat teks diklik, sebelum diketik).
  // Hasil: { path, model, edits, reload } | { db, value } | { error, ai } — ai: asal teksnya tidak bisa diubah
  // langsung (mis. hitungan), jadi perubahannya diteruskan ke AI.
  async function findText(m, after) {
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
  async function dbTableList() {
    if (!db.tables.length) {
      try {
        db.tables = (await api('GET', '/api/database/tables')).tables;
      } catch { /* tanpa tabel: asal dari database tidak dipakai */ }
    }
    return db.tables;
  }

  // Kolom database asal teks/gambar menurut preview: { table, column, numeric } atau null.
  async function dbTarget(source, types) {
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
  async function dynamicText(page, source, old, next) {
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
  function editViaAi(page, what) {
    askAi(`Di halaman ${pageFile(String(page)) || page}, ${what} Bagian itu ditampilkan oleh JavaScript, jadi ubah di sumbernya (kode atau data).`);
    toast('Bagian ini dibuat JavaScript — permintaannya sudah disiapkan di AI, tinggal kirim');
    reloadPreview();
  }

  // Terapkan perubahan ke model sebagai satu langkah undo, lalu simpan tanpa memuat ulang preview.
  // reload: muat ulang preview sesudah disimpan (mis. isi <template> yang tampil di banyak salinan).
  function commitEdits(path, model, edits, what, { reload = false } = {}) {
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

  async function applyTextEdit(m) {
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
  async function saveDbValue(target, values, what) {
    try {
      await api('PATCH', `${tableUrl(target.table)}/rows/${encodeURIComponent(target.id)}`, values);
      toast(`${what} diubah di database: tabel ${target.table}, baris #${target.id}`);
      if (ui.mode === 'data' && db.active === target.table) loadDbRows();
    } catch (err) {
      textEditFailed(err.message);
    }
  }

  // Teks diklik di preview: periksa dulu apakah ada di sumber, supaya pengguna tidak mengetik sia-sia.
  async function checkTextEdit(m) {
    if (typeof m.selector !== 'string' || !Array.isArray(m.before) || !m.before.every((t) => typeof t === 'string')) return;
    const res = await findText(m, m.before);
    toPicker({ type: 'textChecked', id: m.id, ok: !res.error, ai: Boolean(res.ai), file: res.path });
    if (res.error && res.ai) toast(`${res.error} Ketik perubahannya — nanti diteruskan ke AI.`);
    else if (res.error) toast(res.error, 'error');
  }

  // ---------- Ganti gambar di preview ----------
  // Klik <img> di mode Edit: pilih gambar dari project, upload baru, atau pakai alamat URL, dan ubah alt-nya.
  // src ditulis sebagai "/path" (sama dengan "Salin path" di daftar file).
  const isStr = (v) => v === null || typeof v === 'string';

  // Path file project untuk alamat gambar di preview (hanya gambar di website ini), atau null.
  function projectImage(url) {
    try {
      const u = new URL(url);
      if (u.origin !== siteOrigin()) return null;
      const path = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      return state.entries.some((e) => e.type === 'file' && e.path === path) ? path : null;
    } catch {
      return null;
    }
  }

  function openImageEdit(m) {
    if (typeof m.selector !== 'string' || !isStr(m.src) || !isStr(m.alt) || typeof m.shown !== 'string') return;
    if ((m.db != null && typeof m.db !== 'object') || (m.altDb != null && typeof m.altDb !== 'object')) return;
    if (m.picture) {
      return toast('Gambar ini memakai <picture> dengan beberapa versi gambar, jadi tidak bisa diganti dari preview. Ubah lewat kode atau minta AI.', 'error');
    }
    const current = projectImage(m.shown);
    openDialog(ImageEditDialog, { m, current, onSubmit: (changes) => applyImageEdit(m, current, changes) });
  }

  // Simpan perubahan gambar dari dialog: ke HTML sumber, ke baris database asalnya, atau lewat AI.
  async function applyImageEdit(m, current, changes) {
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
  const currentRoute = () => state.previewRoute ?? routeFor(state.previewPath);
  function previewGo(typed, input) {
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

  let previewTimer;
  function schedulePreviewReload() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(reloadPreview, 250);
  }

  function togglePreview() {
    if (isSimple()) return;
    ui.previewHidden = !ui.previewHidden;
    storage.set('rakit.previewHidden', ui.previewHidden);
  }

  function toggleSidebar() {
    if (isSimple()) return;
    ui.sidebarHidden = !ui.sidebarHidden;
  }

  function setDevice(device) {
    preview.device = device;
    storage.set('rakit.device', device);
  }

  function showAccountMenu() {
    const rect = $('#avatarBtn').getBoundingClientRect();
    showMenu(rect.right, rect.bottom + 8, [
      { label: `Project: ${state.project.name}`, hint: 'ganti ›', run: () => setTimeout(() => showProjectMenu($('#avatarBtn')), 0) },
      '-',
      { label: 'Buka website publik', run: () => window.open(state.project.siteUrl, '_blank', 'noopener') },
      { label: 'Salin URL website', run: () => copyText(state.project.siteUrl) },
      { label: 'Mode publikasi', hint: isManual() ? 'manual' : 'langsung', run: openPublishMode },
      { label: 'Simpan semua', hint: '⌥⌘S', run: saveAll },
      { label: 'Pengaturan', run: openSettings },
      { label: LANG === 'en' ? 'Bahasa Indonesia' : 'English', hint: LANG === 'en' ? 'ID' : 'EN', run: () => setLanguage(LANG === 'en' ? 'id' : 'en') },
      SHOW_ASSISTANT && { label: 'Asisten AI website', hint: 'baru', run: openAssistant },
      ai.credits?.topupEnabled && { label: 'Langganan & kredit AI', hint: ai.credits.plan?.name, run: () => openTopup('plans') },
      state.me.isAdmin && { label: 'Dashboard pemilik', run: () => { location.href = '/admin'; } },
      '-',
      { label: 'Keluar', danger: true, run: logout },
    ], { align: 'right', label: { title: state.me.username, sub: state.me.email } });
  }

  // ---------- Pengaturan (per browser) ----------
  const settings = { complete: storage.get('rakit.autocomplete', true) };
  const isDark = () => document.documentElement.dataset.theme === 'dark';

  // Tema editor: 'light' (default, kertas krem) atau 'dark'. Atribut awalnya dipasang skrip di editor.html.
  function setTheme(theme) {
    if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    storage.set('rakit.theme', theme);
    if (monaco) monaco.editor.setTheme(monacoTheme());
    if (diagram.saved && ui.mode === 'diagram') rerenderDiagram(); // warna Mermaid ikut tema
  }

  // Ganti bahasa: server memasang cookie lang dari ?lang= lalu membuka halaman editor bahasa itu.
  async function setLanguage(lang) {
    if (lang === LANG) return;
    await saveAll();
    const params = new URLSearchParams(location.search);
    params.set('lang', lang);
    location.href = `${lang === 'en' ? '/en/editor' : '/editor'}?${params}`;
  }

  // Dialog Pengaturan: komponen Svelte assets-source/editor/settings/SettingsDialog.svelte.
  function openSettings() {
    openDialog(SettingsDialog, {
      lang: LANG,
      dark: isDark(),
      complete: settings.complete,
      onTheme: setTheme,
      onLanguage: setLanguage,
      onComplete: (on) => { setAutocomplete(on); toast(on ? 'Prediksi kode aktif' : 'Prediksi kode dimatikan'); },
    });
  }

  function setAutocomplete(on) {
    settings.complete = on;
    storage.set('rakit.autocomplete', on);
    editor?.updateOptions({ inlineSuggest: { enabled: on } });
  }

  // ---------- Prediksi kode (inline completion) ----------
  // Setelah user berhenti mengetik sebentar, minta lanjutan kode ke server (/api/ai/complete) dan tampilkan
  // sebagai teks abu-abu. Permintaan lama dibatalkan saat user lanjut mengetik.
  const COMPLETE_DELAY = 450;
  const completeState = { off: false }; // off: server menolak (fitur mati / kuota habis) — berhenti sampai reload

  function registerCompletion() {
    const wait = (ms, token) => new Promise((resolve) => {
      const t = setTimeout(() => resolve(true), ms);
      token.onCancellationRequested(() => { clearTimeout(t); resolve(false); });
    });
    monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, {
      async provideInlineCompletions(model, position, context, token) {
        if (!settings.complete || completeState.off || model !== editor.getModel() || !state.active) return { items: [] };
        // Hanya saat mengetik (bukan saat dipicu manual) dan bukan di tengah kata.
        const line = model.getLineContent(position.lineNumber);
        const after = line.slice(position.column - 1);
        if (/^\w/.test(after)) return { items: [] };
        if (!(await wait(COMPLETE_DELAY, token))) return { items: [] };
        const full = model.getFullModelRange();
        const prefix = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
        const suffix = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: full.endLineNumber, endColumn: full.endColumn });
        if (!prefix.trim()) return { items: [] };
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        try {
          const res = await fetch('/api/ai/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Project': state.projectSlug },
            body: JSON.stringify({ path: state.active, prefix: prefix.slice(-6000), suffix: suffix.slice(0, 2000) }),
            credentials: 'same-origin',
            signal: controller.signal,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (res.status === 503 || data.code === 'complete_limit') {
              completeState.off = true;
              if (data.code === 'complete_limit') toast(data.error, 'error');
            }
            return { items: [] };
          }
          if (token.isCancellationRequested || !data.completion) return { items: [] };
          return { items: [{ insertText: data.completion, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
        } catch {
          return { items: [] }; // dibatalkan atau jaringan putus
        }
      },
      freeInlineCompletions() {},
    });
  }

  async function logout() {
    await saveAll();
    await api('POST', '/api/logout').catch(() => {});
    location.href = HOME;
  }

  // ---------- Tampilan HP ----------
  const mobileQuery = window.matchMedia('(max-width: 760px)');
  // Layar sentuh: jangan fokuskan kotak teks/editor secara otomatis, karena keyboard langsung muncul
  // dan menutupi separuh layar. Fokus hanya saat pengguna sendiri mengetuk kotaknya.
  const touchQuery = window.matchMedia('(pointer: coarse)');
  const autoFocus = (target) => { if (!touchQuery.matches) target?.focus(); };

  // ---------- Tampilan editor: Simple / Coding ----------
  // Simple: hanya chat AI dan preview, untuk yang cukup memberi perintah lalu melihat hasilnya.
  // Coding: editor lengkap (file, kode, database, diagram, riwayat). Pilihan diingat per browser;
  // atribut awalnya sudah dipasang skrip kecil di editor.html supaya halaman tidak berkedip.
  const isSimple = () => document.body.dataset.layout === 'simple';

  function setLayout(layout) {
    document.body.dataset.layout = layout;
    ui.layout = layout;
    storage.set('rakit.layout', layout);
    // Di Simple preview selalu tampil; kembali ke Coding = ikuti pilihan tampil/sembunyi sebelumnya.
    ui.previewHidden = !(layout === 'simple' || !storage.get('rakit.previewHidden', false));
    if (layout === 'simple') {
      if (document.body.dataset.mobileView === 'files') setMobileView('editor');
      if (ui.mode !== 'ai') setMode('ai');
    }
  }

  function setMobileView(view) {
    document.body.dataset.mobileView = view;
    ui.mobileView = view;
  }

  // Editor kode di layar kecil: tanpa minimap, font sedikit lebih kecil, baris panjang dibungkus.
  function applyResponsiveEditor() {
    editor?.updateOptions(mobileQuery.matches
      ? { minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', lineNumbersMinChars: 3, folding: false, glyphMargin: false }
      : { minimap: { enabled: true }, fontSize: 14, wordWrap: 'off', lineNumbersMinChars: 5, folding: true });
  }

  // ---------- Project (workspace) ----------
  // Setiap project punya subdomain, file, database, dan riwayat AI sendiri. Ganti project = muat ulang editor.

  function projectUrl(slug) {
    return `${EDITOR_PATH}?project=${encodeURIComponent(slug)}`;
  }

  async function switchProject(slug) {
    if (slug === state.project.slug) return;
    await saveAll();
    location.href = projectUrl(slug);
  }

  function showProjectMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    const canAdd = state.projects.length < state.maxProjects;
    showMenu(rect.left, rect.bottom + 6, [
      ...state.projects.map((p) => ({
        label: `${p.slug === state.project.slug ? '● ' : ''}${p.name}`,
        hint: p.siteHost,
        run: () => switchProject(p.slug),
      })),
      '-',
      canAdd
        ? { label: '+ Project baru', run: openNewProject }
        : { label: `Maksimal ${state.maxProjects} project`, run: () => toast(`Maksimal ${state.maxProjects} project per akun. Hapus project lama untuk membuat yang baru.`, 'error') },
      { label: 'Ganti nama project…', run: renameProject },
      state.projects.length > 1 ? { label: 'Hapus project ini…', danger: true, run: deleteProject } : null,
    ], { wide: true });
  }

  function openNewProject() {
    openDialog(NewProjectDialog, {
      onCreated: async (project) => {
        await saveAll();
        location.href = projectUrl(project.slug);
      },
    });
  }

  async function renameProject() {
    const name = await ask('Ganti nama project', 'Nama project', state.project.name);
    if (!name || name === state.project.name) return;
    try {
      const { project } = await api('PATCH', `/api/projects/${state.project.slug}`, { name });
      state.project = project;
      state.projects = state.projects.map((p) => (p.slug === project.slug ? project : p));
        toast('Nama project diganti');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteProject() {
    const typed = await ask(`Hapus project ${state.project.siteHost}?`,
      `Ketik "${state.project.slug}" untuk konfirmasi`, '');
    if (typed === null) return;
    if (typed !== state.project.slug) return toast('Nama yang diketik tidak cocok. Project tidak dihapus.', 'error');
    try {
      await api('DELETE', `/api/projects/${state.project.slug}`);
    } catch (err) {
      return toast(err.message, 'error');
    }
    const next = state.projects.find((p) => p.slug !== state.project.slug);
    storage.set('rakit.project', next.slug);
    location.href = projectUrl(next.slug);
  }

  // Info project di header & panel file: App.svelte (dari state.project).

  // ---------- Publikasi manual (dev/prod) ----------
  // Mode "manual": editor & AI mengubah versi dev (<slug>--dev); website publik baru berubah saat
  // dipublikasikan. Database dev terpisah; struktur tabelnya ikut dipublikasikan, datanya tidak.
  const isManual = () => state.project?.mode === 'manual';
  // Status publikasi (tombol Publikasikan di header) ada di ui.pubStatus.
  const pub = { timer: 0 };

  async function refreshPublish() {
    ui.pubStatus = null;
    if (isManual()) {
      try { ui.pubStatus = (await api('GET', '/api/publish')).publish; } catch { /* coba lagi nanti */ }
    }
  }
  // Dipanggil setelah file/tabel berubah; dikumpulkan supaya tidak memeriksa tiap ketikan.
  function schedulePublishCheck() {
    clearTimeout(pub.timer);
    if (isManual()) pub.timer = setTimeout(refreshPublish, 1500);
  }

  // Ganti data project (mode/alamat preview berubah): perbarui tampilan & muat ulang preview.
  function applyProject(project) {
    state.project = { ...state.project, ...project, mode: project.mode, previewUrl: project.previewUrl };
    state.projects = state.projects.map((p) => (p.slug === project.slug ? state.project : p));
    if (pick.on) setPick(false);
    reloadPreview();
  }

  // ---------- Komponen Svelte (assets-source/editor) ----------
  // Sambungan komponen ke editor, dipasang sebagai context 'editor' (getContext('editor') di komponen).
  let svelteContext;
  function editorContext() {
    svelteContext ??= new Map([['editor', {
      api,
      toast,
      ask,
      confirm: modal,
      copyText,
      askAi,
      saveAll,
      loadTree,
      fileExists: (path) => state.entries.some((e) => e.path === path),
      openCode: async (path) => { setMode('code'); expandTo(path); await openFile(path); },
      topupEnabled: () => Boolean(ai.credits?.topupEnabled),
      openTopup,
      openDialog,
      previewBase,
      formatBytes,
      schedulePublishCheck,
      projectHeaders: () => (state.projectSlug ? { 'X-Project': state.projectSlug } : {}),
      syncFromServer,
      showDiff,
      imageUrl,
      hasPlan: () => Boolean(ai.credits?.plan),
      schedulePreviewReload,
      reloadPreview,
      consoleActive,
      renderMarkdown,
      loadMermaid,
      autoFocus,
      isDark,
      readEvents,
      loadCredits,
      setCredits: (credits) => { ai.credits = credits; },
      costPerPrompt: () => ai.credits?.costPerPrompt ?? 1,
      storageGet: (key, fallback) => storage.get(key, fallback),
      storageSet: (key, value) => storage.set(key, value),
      projectSlug: () => state.project.slug,
      sessionExpired: () => { location.href = HOME; },
      openTable: (name) => { db.active = name; setMode('data'); },
      focusInput: () => autoFocus($('#aiInput')),
      pickedBlocks: () => pick.blocks.map((b) => ({ page: b.page, selector: b.selector, label: b.label, html: b.html, css: b.css })),
      endPick: () => { if (pick.on) setPick(false); },
      activePath: () => state.active,
      projectUrl,
      pageName,
      pickParent: (b) => toPicker({ type: 'parent', selector: b.selector }),
      pickRemove: removeBlock,
      uploadImages,
      icons: { refresh: ICON.refresh, trash: ICON.trash, table: ICON.table, gear: ICON.gear, lock: ICON.lock, close: ICON.close, flow: ICON.flow, block: ICON.block },
    }]]);
    return svelteContext;
  }

  // Dialog dari komponen Svelte di #modal: Esc atau klik di luar dialog menutupnya. Komponen menerima prop close.
  // Hanya satu dialog sekaligus: membuka dialog baru menutup yang lama.
  // keepEscapeIn: elemen (nama tag) tempat Esc tidak menutup dialog, mis. ['TEXTAREA'] untuk isian panjang.
  // onClose: dipanggil setelah dialog ditutup (dengan cara apa pun).
  let closeDialog = null;
  function openDialog(Component, props = {}, { keepEscapeIn = [], onClose = null } = {}) {
    closeDialog?.();
    const root = $('#modal');
    let app;
    const onKey = (e) => {
      if (e.key === 'Escape' && !keepEscapeIn.includes(e.target.tagName)) { e.preventDefault(); close(); }
    };
    function close() {
      if (!app) return;
      unmount(app);
      app = null;
      if (closeDialog === close) closeDialog = null;
      root.hidden = true;
      root.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
      onClose?.();
    }
    root.replaceChildren();
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);
    app = mount(Component, { target: root, props: { ...props, close }, context: editorContext() });
    closeDialog = close;
    return close;
  }

  // Dialog Publikasikan & Mode publikasi: komponen Svelte di assets-source/editor/publish.
  async function openPublish() {
    let st;
    try {
      await saveAll(); // yang belum tersimpan ikut terhitung
      st = (await api('GET', '/api/publish')).publish;
    } catch (err) {
      return toast(err.message, 'error');
    }
    ui.pubStatus = st;
    openDialog(PublishDialog, {
      status: st,
      onPublished: (status) => { ui.pubStatus = status; },
      onModeDialog: openPublishMode,
    });
  }

  function openPublishMode() {
    openDialog(PublishModeDialog, {
      current: isManual() ? 'manual' : 'live',
      siteUrl: state.project.siteUrl,
      slug: state.project.slug,
      onApplied: (res) => { applyProject(res.project); ui.pubStatus = res.publish; },
    });
  }

  // ---------- Status bar ----------
  function updateStatus() {
    const model = state.active && state.models.get(state.active);
    if (!model) {
      ui.cursor = ui.lang = '';
      return;
    }
    const pos = editor.getPosition();
    ui.cursor = pos ? `Ln ${pos.lineNumber}, Col ${pos.column}` : '';
    ui.lang = { html: 'HTML', css: 'CSS', javascript: 'JavaScript' }[model.getLanguageId()] ?? model.getLanguageId();
  }

  // Splitter: assets-source/editor/shell/resize.js (attachment di App.svelte).

  // ---------- Event ----------
  // Aksi tombol & panel di kerangka editor (App.svelte, prop actions).
  function appActions() {
    return {
      toggleSidebar,
      togglePreview,
      setMode,
      setMobileView,
      setLayout: (layout) => {
        setLayout(layout);
        ui.layoutAttention = false;
        storage.set('rakit.layoutSeen', true);
      },
      projectMenu: showProjectMenu,
      accountMenu: showAccountMenu,
      copySite: () => copyText(state.project.siteUrl),
      publish: openPublish,
      topup: (tab) => openTopup(tab),
      info: showFeatureInfo,
      createEntry: (type, dir) => createEntry(type, dir),
      upload: () => pickImages(),
      refresh: () => loadTree().catch((err) => toast(err.message, 'error')),
      collapse: () => state.expanded.clear(),
      openIndex: () => {
        if (state.entries.some((x) => x.path === 'index.html')) openFile('index.html');
        else toast('index.html belum ada — buat dulu lewat "File baru"', 'error');
      },
      tree: treeEvents,
      selectTab: (path) => { setMode('code'); activate(path); },
      closeTab,
      toggleFlow: () => toggleFlow(),
      // ← / → di panel Baca Alur Kode (bukan saat mengetik pertanyaan) untuk pindah langkah; Esc menutup panel.
      flowKey: (e) => {
        if (e.target.closest('textarea, input')) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stopFlowPlay(); selectFlowStep(flow.step + 1); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stopFlowPlay(); selectFlowStep(flow.step - 1); }
        if (e.key === 'Escape') toggleFlow(false);
      },
      flow: {
        explain: explainFlow,
        select: selectFlowStep,
        stopPlay: stopFlowPlay,
        togglePlay: toggleFlowPlay,
        close: () => toggleFlow(false),
        goBack: flowGoBack,
        openRef: openFlowRef,
        flashLines: flashFlowLines,
        ask: askFlow,
        toggleWide: () => { flow.wide = !flow.wide; },
        saveShowChart: (open) => { flow.showChart = open; storage.set('rakit.flowChart', open); },
      },
      setAutosave: (on) => {
        state.autosave = on;
        storage.set('rakit.autosave', on);
        if (on) saveAll();
      },
      historyMenu: showHistoryMenu,
      clearHistory,
      newConversation,
      newTable: () => openDialog(CreateTableDialog),
      preview: {
        go: previewGo,
        currentRoute,
        reload: reloadPreview,
        info: () => showFeatureInfo('preview'),
        togglePick: () => setPick(!pick.on),
        toggleEdit: () => setTextEdit(!textEdit.on),
        pickGo: () => { setMobileView('editor'); setMode('ai'); },
        pickDone: () => setPick(false),
        textDone: () => setTextEdit(false),
        setDevice,
        isMobile: () => mobileQuery.matches,
      },
    };
  }

  // Pohon file (attachment #tree): klik baris / tombol ⋯, klik kanan, F2 & Delete, seret gambar ke folder.
  function treeEvents(tree) {
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

  function bindEvents() {
    bindBlockPicker();
    // Tombol Simple/Coding disorot (bercahaya) sampai pengguna pertama kali memakainya.
    ui.layoutAttention = !storage.get('rakit.layoutSeen', false);

    // Shortcut global (saat fokus di luar Monaco).
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        if (e.altKey) saveAll(); else if (state.active) save(state.active);
      } else if (key === 'b') {
        e.preventDefault();
        toggleSidebar();
      } else if (key === '\\') {
        e.preventDefault();
        togglePreview();
      } else if (key === 'i') {
        e.preventDefault();
        toggleAi();
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.tabs.some(isDirty)) e.preventDefault();
    });
  }

  // ---------- Asisten AI ----------
  // Panel AI: komponen Svelte di assets-source/editor/ai (keadaan & aksi di state.svelte.js: ai). Di sini tinggal
  // lencana kredit & paket di header, tombol "Tanya AI" dari fitur lain, dan menu riwayat percakapan.
  const setAiMode = (mode) => setAiModeState(mode);

  // Lencana kredit & langganan di header: App.svelte (dari ai.credits).

  // ---------- Penjelasan fitur (tombol ⓘ) ----------
  // Data penjelasan: assets-source/editor/features.js; dialognya FeatureInfo.svelte.

  function askAi(text, mode = 'build') {
    setMode('ai');
    setAiMode(mode);
    setAiInput(text);
    autoFocus($('#aiInput'));
  }

  function showFeatureInfo(key) {
    if (FEATURE_INFO[key]) openDialog(FeatureInfo, { key });
  }

  // Area editor punya dua mode: 'code' (Monaco) dan 'ai' (chat asisten).
  function setMode(mode) {
    // Mis. "buka tabel" dari hasil AI: tampilannya hanya ada di Coding, jadi pindah ke sana.
    if (mode !== 'ai' && isSimple()) {
      setLayout('coding');
      toast('Pindah ke mode Coding');
    }
    ui.mode = mode; // panel yang tampil & tab yang terpilih mengikuti (App.svelte)
    if (mode === 'data') {
      dbLoad();
    } else if (mode === 'diagram') {
      diagramLoad();
    } else if (mode === 'fn') {
      fnLoad();
    } else if (mode === 'history') {
      historyView().showList();
      historyView().load();
    } else if (mode === 'console') {
      devConsoleOpen();
    } else if (mode === 'ai') {
      autoFocus($('#aiInput'));
    } else if (state.active) {
      autoFocus(editor);
    }
  }

  const toggleAi = () => { if (!isSimple()) setMode(ui.mode === 'ai' ? 'code' : 'ai'); };

  async function loadCredits() {
    try {
      ai.credits = await api('GET', '/api/ai/credits');
    } catch {
      ai.credits = null;
    }
  }

  // Baca respons NDJSON baris demi baris.
  async function* readEvents(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line);
      }
    }
  }

  // ---------- Riwayat percakapan ----------
  async function showHistoryMenu(anchor) {
    let data;
    try {
      data = await api('GET', '/api/ai/threads');
    } catch (err) {
      return toast(err.message, 'error');
    }
    const when = (ms) => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const rect = anchor.getBoundingClientRect();
    showMenu(rect.left, rect.bottom + 6, [
      { label: 'Percakapan baru', run: newConversation },
      data.threads.length ? '-' : null,
      ...data.threads.slice(0, 20).map((t) => ({
        label: `${t.id === ai.threadId ? '● ' : ''}${t.title}`,
        hint: when(t.updatedAt),
        run: () => { if (!guardBusy()) openThread(t.id); },
      })),
      data.threads.length ? '-' : null,
      data.threads.length ? { label: 'Hapus semua riwayat', danger: true, run: clearHistory } : null,
    ], { wide: true });
  }

  // Muat ulang file yang diubah server (oleh AI atau Batalkan) ke editor, pohon file, dan preview.
  async function syncFromServer(paths, { openFirst = false } = {}) {
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
  async function showDiff(change, before, caption) {
    try {
      await editorReady;
    } catch {
      return toast('Editor kode gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
    }
    openDialog(DiffDialog, { path: change.path, caption, before, after: change.content, monaco, theme: monacoTheme() });
  }

  function bindAiEvents() {
    connectAi(editorContext().get('editor'));
    setMobileView(document.body.dataset.mobileView || 'editor');
    mobileQuery.addEventListener('change', applyResponsiveEditor);
  }

  // ---------- Database (mode Data) ----------
  // Tab Data: komponen Svelte di assets-source/editor/database, dipasang ke kerangka #dataView di editor.html saat
  // tab pertama kali dibuka. Keadaannya (db) dipakai bersama lewat database/state.svelte.js.
  let dbMounted = false;
  function dbLoad() {
    if (!dbMounted) {
      dbMounted = true;
      connectDb(editorContext().get('editor'));
      ui.loaded.data = true;
      flushSync();
    }
    return loadDb();
  }

  // ---------- Diagram (UML, ERD, peta halaman, alur data) ----------
  // Tab Diagram: komponen Svelte di assets-source/editor/diagram (keadaan & aksi di state.svelte.js), dipasang saat
  // tab pertama kali dibuka. Mermaid dimuat dari CDN saat pertama dipakai, dengan tema mengikuti tema editor.
  const loadMermaid = () => loadMermaidFor(isDark());
  let diagramMounted = false;
  function diagramLoad() {
    if (!diagramMounted) {
      diagramMounted = true;
      connectDiagram(editorContext().get('editor'));
      ui.loaded.diagram = true;
      flushSync();
    }
    return loadDiagram();
  }

  // ---------- Baca Alur Kode ----------
  // Panel di samping editor kode: AI menjelaskan alur file yang sedang dibuka langkah demi langkah. Klik langkah →
  // barisnya disorot di editor; klik baris di editor → langkahnya dibuka. Rujukan ke file lain membuka file itu
  // (dengan tombol kembali). Gratis dengan batas harian; hasil disimpan server per file + hash isi.
  // Keadaan panel ada di assets-source/editor/flow/state.svelte.js (dipakai juga FlowPanel.svelte). Id dekorasi
  // Monaco per file disimpan di sini.
  flow.showChart = storage.get('rakit.flowChart', true);
  const flowDeco = new Map(); // path -> id dekorasi Monaco di model file itu
  const FLOW_EXT = ['html', 'css', 'js'];
  const canFlow = (path) => Boolean(path) && FLOW_EXT.includes(extOf(path));

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }


  function toggleFlow(force = !flow.open) {
    flow.open = force;
    storage.set('rakit.flowOpen', flow.open);
    stopFlowPlay();
    if (flow.open) {
      mountFlowPanel();
      flowFollow(true);
    } else {
      applyFlowHighlight();
    }
  }

  // Panel mengikuti file aktif: muat penjelasan tersimpan (tanpa AI) bila ganti file.
  async function flowFollow(force = false) {
    if (!flow.open) return;
    const path = state.active;
    if (!canFlow(path)) {
      flow.path = null;
      flow.saved = null;
      renderFlow();
      return;
    }
    if (path === flow.path && !force) {
      applyFlowHighlight();
      return;
    }
    const seq = ++flow.seq;
    let want = null;
    if (path !== flow.path) {
      flow.path = path;
      flow.saved = null;
      flow.step = 0;
      if (flow.pending?.path === path) want = flow.pending.step;
      flow.pending = null;
    }
    flow.hash = await sha256(state.models.get(path)?.getValue() ?? '');
    renderFlow();
    try {
      const out = await api('GET', `/api/ai/explain?path=${encodeURIComponent(path)}`);
      if (seq !== flow.seq) return;
      flow.saved = out.saved;
      flow.remaining = out.remaining;
      flow.limit = out.limit;
      if (want != null) flow.step = want;
      flow.step = Math.min(flow.step, Math.max(0, flowSteps().length - 1));
    } catch (err) {
      if (seq !== flow.seq) return;
      toast(err.message, 'error');
    }
    renderFlow();
  }

  let flowStaleTimer;
  function flowContentChanged(path) {
    if (!flow.open || path !== flow.path) return;
    clearTimeout(flowStaleTimer);
    flowStaleTimer = setTimeout(async () => {
      const was = flowStale();
      flow.hash = await sha256(state.models.get(path)?.getValue() ?? '');
      if (was !== flowStale()) renderFlow();
    }, 400);
  }

  async function explainFlow(force = false) {
    const path = flow.path;
    const model = state.models.get(path);
    if (!model || flow.loading) return;
    const content = model.getValue();
    flow.loading = path;
    stopFlowPlay();
    renderFlow();
    try {
      const out = await api('POST', '/api/ai/explain', { path, content, force });
      flow.remaining = out.remaining;
      flow.limit = out.limit;
      if (flow.path === path) {
        flow.saved = out.saved;
        flow.hash = out.saved.hash;
        flow.step = 0;
        delete flow.chats[path];
      }
      if (out.cached) toast('Penjelasan untuk isi file ini sudah ada — ditampilkan tanpa memakai jatah.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      flow.loading = null;
      if (flow.path === path) renderFlow();
    }
  }

  // ---------- Sorotan di editor ----------
  // Dekorasi dipasang langsung di model file (bukan di editor), supaya tidak tertinggal saat ganti tab.
  function setFlowDecorations(marks) {
    for (const [p, ids] of flowDeco) {
      const m = state.models.get(p);
      if (m && !m.isDisposed()) m.deltaDecorations(ids, []);
    }
    flowDeco.clear();
    const model = editor?.getModel();
    if (model && marks.length) flowDeco.set(state.active, model.deltaDecorations([], marks));
  }

  function flashLines(a, b) {
    const model = editor.getModel();
    if (!model) return;
    const ids = model.deltaDecorations([], [{ range: new monaco.Range(a, 1, b, 1), options: { isWholeLine: true, className: 'flow-flash' } }]);
    editor.revealLinesInCenterIfOutsideViewport(a, b, monaco.editor.ScrollType.Smooth);
    setTimeout(() => { if (!model.isDisposed()) model.deltaDecorations(ids, []); }, 2400);
  }

  function applyFlowHighlight({ reveal = false } = {}) {
    if (!editor || !monaco) return;
    const steps = flowSteps();
    if (!flow.open || !steps.length || state.active !== flow.path) return setFlowDecorations([]);
    const active = steps[flow.step];
    const marks = [];
    steps.forEach((s, i) => {
      for (const [a, b] of s.lines) {
        const on = i === flow.step;
        marks.push({
          range: new monaco.Range(a, 1, b, 1),
          options: {
            isWholeLine: true,
            className: on ? 'flow-line' : undefined,
            linesDecorationsClassName: on ? 'flow-gutter active' : 'flow-gutter',
            overviewRuler: on ? { color: '#d6a01e', position: monaco.editor.OverviewRulerLane.Center } : undefined,
          },
        });
      }
      const first = s.lines[0];
      if (first) {
        marks.push({
          range: new monaco.Range(first[0], 1, first[0], 1),
          options: { before: { content: ` ${s.id} `, inlineClassName: i === flow.step ? 'flow-badge active' : 'flow-badge' } },
        });
      }
    });
    setFlowDecorations(marks);
    if (reveal && active?.lines.length) {
      const [a] = active.lines[0];
      const b = active.lines.at(-1)[1];
      editor.revealLinesInCenterIfOutsideViewport(a, b, monaco.editor.ScrollType.Smooth);
    }
  }

  // Klik baris di editor → langkah yang mencakup baris itu (rentang terkecil) dibuka di panel.
  function flowSyncFromCursor(e) {
    if (!flow.open || e.source !== 'mouse' || state.active !== flow.path || flowStale()) return;
    const line = e.position.lineNumber;
    let best = -1;
    let size = Infinity;
    flowSteps().forEach((s, i) => {
      for (const [a, b] of s.lines) {
        if (line >= a && line <= b && b - a < size) {
          best = i;
          size = b - a;
        }
      }
    });
    if (best >= 0 && best !== flow.step) selectFlowStep(best, { reveal: false });
  }

  function selectFlowStep(i, { reveal = true } = {}) {
    const steps = flowSteps();
    if (!steps.length) return;
    flow.step = Math.max(0, Math.min(steps.length - 1, i));
    if (state.active !== flow.path) {
      // Kembali ke file yang dijelaskan (activate → flowFollow memasang sorotan lagi).
      flow.back = flow.back.filter((b) => b.path !== flow.path);
      openFile(flow.path).then(() => applyFlowHighlight({ reveal }));
    } else {
      applyFlowHighlight({ reveal });
    }
  }

  function stopFlowPlay() {
    clearInterval(flow.playTimer);
    flow.playTimer = null;
  }

  function toggleFlowPlay() {
    if (flow.playTimer) return stopFlowPlay();
    if (flow.step >= flowSteps().length - 1) selectFlowStep(0);
    flow.playTimer = setInterval(() => {
      if (flow.step >= flowSteps().length - 1) return stopFlowPlay();
      selectFlowStep(flow.step + 1);
    }, 6000);
  }

  // Buka file rujukan; baris yang dirujuk disorot sebentar. Tombol "Kembali" mengembalikan ke langkah ini.
  async function openFlowRef(ref) {
    if (!state.entries.some((e) => e.path === ref.path)) return toast(`${ref.path} tidak ada lagi di project`, 'error');
    stopFlowPlay();
    if (isImage(ref.path)) return openImage(ref.path);
    if (ref.path !== flow.path && flow.path) flow.back = [...flow.back, { path: flow.path, step: flow.step }].slice(-20);
    await openFile(ref.path);
    if (ref.line && editor && state.active === ref.path) {
      const total = editor.getModel().getLineCount();
      const line = Math.min(ref.line, total);
      editor.setPosition({ lineNumber: line, column: 1 });
      flashLines(line, line);
    }
  }

  async function flowGoBack() {
    const prev = flow.back.pop();
    if (!prev) return;
    if (!state.entries.some((e) => e.path === prev.path)) return renderFlow();
    if (flow.path === prev.path) return selectFlowStep(prev.step);
    flow.pending = prev; // flowFollow membuka langkah ini setelah penjelasannya dimuat
    await openFile(prev.path);
  }

  // ---------- Tampilan panel ----------
  // Panel digambar FlowPanel.svelte dari state flow; aksi di bawah ini (dan di atas) yang menyentuh Monaco/file.
  function mountFlowPanel() {
    ui.loaded.flow = true;
    flushSync();
  }

  // Dulu menggambar ulang panel; kini tinggal efek sampingnya: putaran otomatis berhenti dan sorotan di editor
  // diperbarui (digulir ke langkah aktif bila penjelasannya tampil).
  function renderFlow() {
    if (!flow.open) return;
    stopFlowPlay();
    applyFlowHighlight({ reveal: Boolean(flow.path && flow.loading !== flow.path && flowSteps().length) });
  }

  async function flashFlowLines(a, b) {
    if (state.active !== flow.path) await openFile(flow.path);
    const total = editor.getModel()?.getLineCount() ?? 0;
    if (!total) return;
    a = Math.min(Math.max(1, a), total);
    b = Math.min(Math.max(a, b), total);
    flashLines(a, b);
  }

  async function askFlow(input) {
    const question = input.value.trim();
    const path = flow.path;
    const model = state.models.get(path);
    if (!question || !model || flow.asking) return;
    flow.chats[path] ??= [];
    const chat = flow.chats[path];
    const history = chat.filter((c) => c.a).slice(-6);
    chat.push({ q: question, a: '' });
    const entry = chat.at(-1); // lewat state supaya jawabannya langsung tampil
    input.value = '';
    flow.asking = true;
    try {
      const out = await api('POST', '/api/ai/explain/ask', {
        path, content: model.getValue(), step: flowStale() ? 0 : flow.step + 1, question, history,
      });
      entry.a = out.answer;
      flow.remaining = out.remaining;
    } catch (err) {
      chat.splice(chat.indexOf(entry), 1);
      input.value = question;
      toast(err.message, 'error');
    } finally {
      flow.asking = false;
    }
  }

  function bindFlowEvents() {
    editorReady.then(() => {
      editor.onDidChangeCursorPosition(flowSyncFromCursor);
      if (storage.get('rakit.flowOpen', false)) toggleFlow(true);
    }).catch(() => { /* pesan sudah ditampilkan */ });
  }

  // ---------- Console ----------
  // Tab Console: assets-source/editor/console (log & saringan di state.svelte.js, tampilan Console.svelte). Log dari
  // preview diterima sejak awal, jadi sambungannya disiapkan saat log pertama tiba.
  let consoleConnected = false;
  const consoleActive = () => ui.mode === 'console';
  function connectConsoleOnce() {
    if (consoleConnected) return;
    consoleConnected = true;
    connectConsole(editorContext().get('editor'));
  }
  function devConsoleAdd(raw) {
    connectConsoleOnce();
    addConsoleLog(raw);
  }
  function devConsoleOpen() {
    connectConsoleOnce();
    ui.loaded.console = true;
    flushSync();
    openConsole();
  }
  // ---------- Fungsi serverless ----------
  // Tab Fungsi: komponen Svelte assets-source/editor/functions/Functions.svelte, dipasang sekali lalu dimuat
  // ulang setiap tab dibuka.
  function fnLoad() {
    ui.loaded.fn = true;
    flushSync();
    views.fn.load();
  }

  // ---------- Riwayat versi ----------
  // Tab Riwayat: komponen Svelte assets-source/editor/history/History.svelte, dipasang saat pertama dibuka.
  function historyView() {
    ui.loaded.history = true;
    flushSync();
    return views.history;
  }

  // ---------- Asisten AI untuk website pengguna ----------
  // Disembunyikan sementara dari editor (menu & daftar keuntungan paket). Server, widget di website yang sudah
  // mengaktifkannya, dan dashboard owner tetap berjalan; ubah ke true untuk menampilkannya lagi.
  const SHOW_ASSISTANT = false;
  // Pengaturan asisten: komponen Svelte assets-source/editor/assistant/Assistant.svelte (Esc di kotak instruksi
  // tidak menutupnya). Setelah isi saldo berhasil, dialog ini dibuka lagi.
  function openAssistant() {
    const close = openDialog(Assistant, { onTopup: () => { close(); openTopup('assistant', { after: openAssistant }); } }, { keepEscapeIn: ['TEXTAREA'] });
  }

  // ---------- Langganan & isi ulang kredit (QRIS) ----------
  // Tampilan & alur pembayarannya: komponen Svelte assets-source/editor/Topup.svelte.
  // tab: 'plans' (langganan) | 'credits' (paket kredit) | 'assistant' (Saldo Asisten AI website).
  // intro: sambutan saat editor pertama kali dibuka. after: dipanggil setelah isi saldo asisten berhasil.
  function openTopup(tab, { intro = false, after = null } = {}) {
    const root = $('#modal');
    const close = openDialog(Topup, {
      tab,
      intro,
      api,
      showAssistant: SHOW_ASSISTANT,
      icons: { close: ICON.close, spark: SPARK },
      onCredits: (credits) => { ai.credits = credits; },
      onPlanPaid: () => loadTree().catch(() => {}), // perbarui kuota storage di sidebar
      onUseAI: () => { close(); setMode('ai'); },
      onAfter: () => { close(); after?.(); },
      // Promosi memakai modal lebar di tengah layar.
      onPromo: (on) => root.classList.toggle('promo-backdrop', on),
      onClose: () => close(),
    }, { onClose: () => root.classList.remove('promo-backdrop') });
  }

  // Tema warna editor, disamakan dengan palet UI.
  // Tema Monaco mengikuti tema editor: 'rakit' (gelap) dan 'rakit-light' (kertas krem).
  const monacoTheme = () => (isDark() ? 'rakit' : 'rakit-light');

  function defineTheme() {
    monaco.editor.defineTheme('rakit', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'd8dde8' },
        { token: 'comment', foreground: '5b6478', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'c4a7ff' },
        { token: 'string', foreground: '86efac' },
        { token: 'number', foreground: 'fdba74' },
        { token: 'regexp', foreground: 'f9a8d4' },
        { token: 'type', foreground: '67e8f9' },
        { token: 'identifier', foreground: 'd8dde8' },
        { token: 'delimiter', foreground: '8b93a7' },
        { token: 'tag', foreground: '7dd3fc' },
        { token: 'metatag', foreground: 'c4a7ff' },
        { token: 'attribute.name', foreground: 'f9a8d4' },
        { token: 'attribute.value', foreground: '86efac' },
        { token: 'attribute.value.number.css', foreground: 'fdba74' },
        { token: 'attribute.value.unit.css', foreground: 'fdba74' },
      ],
      colors: {
        'editor.background': '#11151f',
        'editor.foreground': '#d8dde8',
        'editor.lineHighlightBackground': '#161b27',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': '#16a34a40',
        'editor.inactiveSelectionBackground': '#16a34a22',
        'editorCursor.foreground': '#4ade80',
        'editorLineNumber.foreground': '#5d6780',
        'editorLineNumber.activeForeground': '#4ade80',
        'editorIndentGuide.background1': '#1c2231',
        'editorIndentGuide.activeBackground1': '#2f3850',
        'editorBracketMatch.background': '#16a34a26',
        'editorBracketMatch.border': '#16a34a80',
        'editorWidget.background': '#161b27',
        'editorWidget.border': '#2a3244',
        'editorSuggestWidget.background': '#161b27',
        'editorSuggestWidget.border': '#2a3244',
        'editorSuggestWidget.selectedBackground': '#16a34a30',
        'editorHoverWidget.background': '#161b27',
        'editorHoverWidget.border': '#2a3244',
        'minimap.background': '#11151f',
        'scrollbarSlider.background': '#ffffff12',
        'scrollbarSlider.hoverBackground': '#ffffff20',
        'scrollbarSlider.activeBackground': '#16a34a60',
        'editorGutter.background': '#11151f',
      },
    });
    monaco.editor.defineTheme('rakit-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: '', foreground: '2b2330' },
        { token: 'comment', foreground: '9a917f', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7b4fb0' },
        { token: 'string', foreground: '2e7d4f' },
        { token: 'number', foreground: 'b45309' },
        { token: 'regexp', foreground: 'b8326e' },
        { token: 'type', foreground: '2f7f90' },
        { token: 'identifier', foreground: '2b2330' },
        { token: 'delimiter', foreground: '6f6657' },
        { token: 'tag', foreground: '2f6f80' },
        { token: 'metatag', foreground: '7b4fb0' },
        { token: 'attribute.name', foreground: 'b8326e' },
        { token: 'attribute.value', foreground: '2e7d4f' },
        { token: 'attribute.value.number.css', foreground: 'b45309' },
        { token: 'attribute.value.unit.css', foreground: 'b45309' },
      ],
      colors: {
        'editor.background': '#fffdf7',
        'editor.foreground': '#2b2330',
        'editor.lineHighlightBackground': '#fbf2dc',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': '#ffca5470',
        'editor.inactiveSelectionBackground': '#ffca5440',
        'editorCursor.foreground': '#1a1320',
        'editorLineNumber.foreground': '#948770',
        'editorLineNumber.activeForeground': '#8a5a00',
        'editorIndentGuide.background1': '#efe3c6',
        'editorIndentGuide.activeBackground1': '#d6c59e',
        'editorBracketMatch.background': '#ffca5440',
        'editorBracketMatch.border': '#d6a01e',
        'editorWidget.background': '#fffdf7',
        'editorWidget.border': '#d6c59e',
        'editorSuggestWidget.background': '#fffdf7',
        'editorSuggestWidget.border': '#d6c59e',
        'editorSuggestWidget.selectedBackground': '#ffca5455',
        'editorHoverWidget.background': '#fffdf7',
        'editorHoverWidget.border': '#d6c59e',
        'editorGhostText.foreground': '#a59a84',
        'minimap.background': '#fffdf7',
        'scrollbarSlider.background': '#1a132018',
        'scrollbarSlider.hoverBackground': '#1a132028',
        'scrollbarSlider.activeBackground': '#d6a01e80',
        'editorGutter.background': '#fffdf7',
      },
    });
  }


  // ---------- Init ----------
  // Monaco (±900 KB dari CDN) dimuat paralel dan tidak menahan bagian lain editor: daftar file, preview, dan
  // percakapan AI langsung tampil. Yang butuh Monaco (openFile, showDiff) menunggu editorReady.
  let editorReady;

  // loader.js (AMD) disisipkan dari sini, bukan lewat <script> di HTML, supaya editor.js tidak menunggunya.
  // Filenya sudah mulai diunduh sejak awal lewat <link rel="preload"> di editor.html.
  function loadMonaco() {
    return new Promise((resolve, reject) => {
      const start = () => {
        window.require.config({ paths: { vs: `${window.MONACO_BASE}/vs` } });
        window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
      };
      if (window.require?.config) return start();
      const script = document.createElement('script');
      script.src = `${window.MONACO_BASE}/vs/loader.js`;
      script.onload = start;
      script.onerror = () => reject(new Error('Gagal memuat Monaco'));
      document.head.append(script);
    });
  }

  async function setupEditor() {
    monaco = await loadMonaco();
    defineTheme();
    editor = monaco.editor.create($('#editor'), {
      model: null,
      theme: monacoTheme(),
      automaticLayout: true,
      fontFamily: getComputedStyle(document.body).getPropertyValue('--mono'),
      fontSize: 14,
      lineHeight: 22,
      fontLigatures: true,
      renderLineHighlight: 'all',
      cursorBlinking: 'smooth',
      roundedSelection: true,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      tabSize: 2,
      insertSpaces: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true },
      renderWhitespace: 'selection',
      wordWrap: 'off',
      linkedEditing: true, // rename tag pembuka/penutup HTML bersamaan
      inlineSuggest: { enabled: settings.complete },
      padding: { top: 8 },
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => state.active && save(state.active));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyS, saveAll);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => toggleAi());
    // Klik kanan di kode: kirim bagian yang dipilih (atau baris kursor) ke panel AI.
    const codeForAi = (ed) => {
      const model = ed.getModel();
      let sel = ed.getSelection();
      if (!model || !state.active || !sel) return null;
      if (sel.isEmpty()) sel = new monaco.Range(sel.startLineNumber, 1, sel.startLineNumber, model.getLineMaxColumn(sel.startLineNumber));
      const lines = sel.startLineNumber === sel.endLineNumber ? `baris ${sel.startLineNumber}` : `baris ${sel.startLineNumber}–${sel.endLineNumber}`;
      return `Di file ${state.active} ${lines}:\n\`\`\`\n${clipText(model.getValueInRange(sel), 4000)}\n\`\`\`\n\n`;
    };
    editor.addAction({
      id: 'rakit.aiChange', label: '✦ Minta AI mengubah kode ini', contextMenuGroupId: 'navigation', contextMenuOrder: 0,
      run: (ed) => { const code = codeForAi(ed); if (code) askAi(`${code}Ubah bagian ini supaya `, 'build'); },
    });
    editor.addAction({
      id: 'rakit.aiExplain', label: '✦ Tanya AI tentang kode ini', contextMenuGroupId: 'navigation', contextMenuOrder: 0.1,
      run: (ed) => { const code = codeForAi(ed); if (code) askAi(`${code}Jelaskan apa yang dilakukan kode ini dengan bahasa sederhana.`, 'plan'); },
    });
    // Di Mac, Monaco hanya memakai ⌘F (cari) & ⌥⌘F (ganti). Banyak pengguna terbiasa Ctrl+F / Ctrl+H dari
    // Windows, jadi tombol Ctrl yang asli (WinCtrl di Monaco) juga dipasang. Di Windows/Linux Ctrl+F sudah bawaan.
    if (/Mac|iPhone|iPad/.test(navigator.platform)) {
      editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyF, () => editor.getAction('actions.find')?.run());
      editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyH, () => editor.getAction('editor.action.startFindReplaceAction')?.run());
    }
    editor.onDidChangeCursorPosition(updateStatus);
    registerCompletion();
    applyResponsiveEditor();
    // Font editor (JetBrains Mono) dimuat tanpa menahan halaman, jadi bisa selesai SETELAH Monaco mengukur lebar
    // huruf dengan font cadangan (mis. Consolas di Windows, jauh lebih sempit). Tanpa ukur ulang, kursor, klik,
    // dan seleksi meleset dari teksnya.
    const remeasure = () => monaco.editor.remeasureFonts();
    document.fonts?.ready.then(remeasure);
    document.fonts?.addEventListener('loadingdone', remeasure);
  }

  // File awal (index.html, style.css, script.js) dibuka begitu Monaco siap; index.html jadi tab aktif.
  async function openStartFiles() {
    const first = ['index.html', 'style.css', 'script.js'].filter((p) => state.entries.some((e) => e.path === p));
    for (const path of first) await openFile(path);
    if (first.length) activate(first[0]);
    else activate(null);
  }

  async function init() {
    // Kerangka editor (App.svelte) dipasang paling awal: Monaco & preview memakai elemen di dalamnya. Pohon file,
    // tab, dan panel AI baru tampil setelah data akun dimuat (ui.ready).
    mount(App, { target: $('.app'), context: editorContext(), props: { actions: appActions() } });
    editorReady = setupEditor();
    editorReady.catch((err) => {
      console.error(err);
      toast('Editor kode gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
    });
    // Project aktif: dari URL (?project=), atau yang terakhir dibuka, atau project pertama.
    state.projectSlug = new URLSearchParams(location.search).get('project') || storage.get('rakit.project', null);
    let me;
    try {
      me = await api('GET', '/api/me');
    } catch {
      state.projectSlug = null; // project tidak ada / bukan milik akun ini
      me = await api('GET', '/api/me');
    }
    state.me = me.user;
    state.project = me.project;
    state.projects = me.projects;
    state.maxProjects = me.maxProjects;
    state.projectSlug = me.project.slug;
    storage.set('rakit.project', state.projectSlug);
    history.replaceState(null, '', projectUrl(state.projectSlug));
    refreshPublish();

    if (storage.get('rakit.previewHidden', false) && !isSimple()) togglePreview();
    setLayout(isSimple() ? 'simple' : 'coding');
    setDevice(storage.get('rakit.device', 'desktop'));
    bindEvents();
    bindAiEvents();
    ui.ready = true;
    flushSync();
    bindFlowEvents();
    const credits = loadCredits();

    await loadTree();
    reloadPreview();
    // Editor dibuka di mode AI, kecuali user sudah pindah tab selama editor masih dimuat (mis. ke Diagram).
    if (ui.mode === 'ai') setMode('ai');
    openStartFiles().catch(() => { /* pesannya sudah ditampilkan openFile */ });
    // Tampilkan lagi percakapan terakhir (dan sambung ke job yang masih berjalan, bila ada).
    await credits;
    if (!ai.credits) await loadCredits();
    await initAiHistory();
    maybeShowPlansIntro();
  }

  // Promosi langganan untuk pengguna gratis: maks. sekali sehari (tanggal WIB) per akun, per browser.
  function maybeShowPlansIntro() {
    const key = `rakit.promoDay.${state.me.username}`;
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const c = ai.credits;
    if (storage.get(key, null) === today || !c?.topupEnabled || c.plan) return;
    setTimeout(() => {
      if (!$('#modal').hidden) return; // ada dialog lain: coba lagi di kunjungan berikutnya
      storage.set(key, today);
      openTopup('plans', { intro: true });
    }, 900);
  }

  init().catch((err) => {
    console.error(err);
    toast(`Gagal memuat editor: ${err.message}`, 'error');
  });
})();
