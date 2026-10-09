import { mount, unmount } from 'svelte';
import Topup from '../editor/Topup.svelte';
import Functions from '../editor/functions/Functions.svelte';
import History from '../editor/history/History.svelte';
import Assistant from '../editor/assistant/Assistant.svelte';
import SettingsDialog from '../editor/settings/SettingsDialog.svelte';
import PublishDialog from '../editor/publish/PublishDialog.svelte';
import PublishModeDialog from '../editor/publish/PublishModeDialog.svelte';
import { SPARK } from '../editor/icons.js';
import TableList from '../editor/database/TableList.svelte';
import DbUsage from '../editor/database/Usage.svelte';
import DbMain from '../editor/database/DbMain.svelte';
import CreateTableDialog from '../editor/database/CreateTableDialog.svelte';
import { db, connect as connectDb, load as loadDb, loadRows as loadDbRows } from '../editor/database/state.svelte.js';
import { tableUrl } from '../editor/database/types.js';
import { rupiah, shortDate } from '../editor/format.js';
import { clipText, fnFixPrompt } from '../editor/handoff.js';
import ConsoleTab from '../editor/console/Console.svelte';
import FlowPanel from '../editor/flow/FlowPanel.svelte';
import DiagramView from '../editor/diagram/DiagramView.svelte';
import { diagram, connect as connectDiagram, load as loadDiagram, rerender as rerenderDiagram } from '../editor/diagram/state.svelte.js';
import { DIAGRAM_NAMES } from '../editor/diagram/info.js';
import { loadMermaid as loadMermaidFor } from '../editor/mermaid.js';
import { flow, flowSteps, flowStale } from '../editor/flow/state.svelte.js';
import { connect as connectConsole, add as addConsoleLog, open as openConsole } from '../editor/console/state.svelte.js';

(() => {
  'use strict';

  // ---------- Util ----------
  const $ = (s, el = document) => el.querySelector(s);

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) if (child != null && child !== false) el.append(child);
    return el;
  }

  function svg(pathD, viewBox = '0 0 16 16') {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', viewBox);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', pathD);
    el.append(p);
    return el;
  }

  const ICON = {
    block: 'M1 1h4v1H2v3H1zm10 0h4v4h-1V2h-3zM1 11h1v3h3v1H1zm14 0v4h-4v-1h3v-3zM5 5h6v6H5z',
    chevron: 'M5.7 13.7 5 13l5-5-5-5 .7-.7L11.4 8z',
    close: 'm8 8.7 3.6 3.6.7-.7L8.7 8l3.6-3.6-.7-.7L8 7.3 4.4 3.7l-.7.7L7.3 8l-3.6 3.6.7.7z',
    folder: 'M14.5 3H7.7l-1-1.4-.4-.1H1.5l-.5.5v11l.5.5h13l.5-.5v-9.5zM14 13H2V6h12zm0-8H7.3l-.4.1-.6.9H2V2.5h4.1l1 1.4.4.1H14z',
    table: 'M1.5 2h13l.5.5v11l-.5.5h-13l-.5-.5v-11zM2 3v3h5V3zm6 0v3h6V3zM2 7v3h5V7zm6 0v3h6V7zm-6 4v2h5v-2zm6 0v2h6v-2z',
    lock: 'M8 1a3 3 0 0 0-3 3v2H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3m2 5H6V4a2 2 0 1 1 4 0z',
    trash: 'M6 1h4l.5.5V3H14v1h-1v10.5l-.5.5h-9l-.5-.5V4H2V3h3.5V1.5zM6.5 3h3V2h-3zM4 4v10h8V4zm2 2h1v6H6zm3 0h1v6H9z',
    refresh: 'M13.45 5.17A6 6 0 1 0 14 8h-1a5 5 0 1 1-.8-2.73l-1.7.23.14 1 3.4-.5-.5-3.4-1 .14z',
    gear: 'M9.1 1l.4 1.9 1 .4 1.6-1.1 1.6 1.6-1.1 1.6.4 1 1.9.4v2.3l-1.9.4-.4 1 1.1 1.6-1.6 1.6-1.6-1.1-1 .4-.4 1.9H6.9l-.4-1.9-1-.4-1.6 1.1-1.6-1.6 1.1-1.6-.4-1L1 9.1V6.9l1.9-.4.4-1-1.1-1.6 1.6-1.6 1.6 1.1 1-.4L6.9 1zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
    image: 'M2.5 2A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 2zM2 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v7.3l-3-3-2.5 2.5-3-3L2 11.8zM10.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3',
    folderOpen: 'M1.5 14h11l.5-.4 2.6-6.9-.5-.7H14V4.5l-.5-.5H7.7l-.9-.9-.3-.1H1.5l-.5.5v10zM2 3h4.3l.8.8.4.2H13v2H4l-.5.3L2 10.4zm10.1 10H2.2l2.2-6h9.9z',
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
  const state = {
    me: null,
    entries: [],
    expanded: new Set(),
    selected: null,
    tabs: [],
    active: null,
    models: new Map(), // path -> monaco model
    saved: new Map(), // path -> isi terakhir yang tersimpan di server
    viewStates: new Map(),
    saveTimers: new Map(),
    saveChains: new Map(),
    previewPath: 'index.html',
    previewRoute: null, // alamat yang diketik user di bar preview (path + ?query + #hash); null = ikuti previewPath
    autosave: storage.get('rakit.autosave', true),
  };
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
  function toast(message, type = 'info') {
    const el = h('div', { class: `toast ${type}`, role: 'status' }, message);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3000);
  }

  function setSaveStatus(text, kind = '') {
    const el = $('#statusSave');
    el.textContent = text;
    el.className = `save-pill ${kind}`;
  }

  // ---------- Modal ----------
  function modal({ title, message, input, buttons }) {
    return new Promise((resolve) => {
      const root = $('#modal');
      const inputEl = input ? h('input', { value: input.value ?? '', placeholder: input.placeholder, spellcheck: 'false', autocomplete: 'off' }) : null;
      const primary = buttons.find((b) => b.primary) ?? buttons[0];

      const close = (value) => {
        root.hidden = true;
        root.replaceChildren();
        document.removeEventListener('keydown', onKey, true);
        resolve(value);
        autoFocus(editor);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
      };

      const form = h('form', { class: 'modal', onsubmit: (e) => { e.preventDefault(); close(inputEl ? inputEl.value.trim() : primary.value); } },
        h('h3', {}, title),
        message ? h('p', {}, message) : null,
        inputEl,
        h('div', { class: 'modal-buttons' },
          buttons.map((b) => h('button', {
            type: b === primary ? 'submit' : 'button',
            class: b.danger ? 'danger' : b.primary ? 'primary' : '',
            onclick: b === primary ? null : () => close(b.value),
          }, b.label))));

      root.replaceChildren(form);
      root.hidden = false;
      root.onmousedown = (e) => { if (e.target === root) close(null); };
      document.addEventListener('keydown', onKey, true);

      if (inputEl) {
        inputEl.focus();
        // Pilih nama tanpa ekstensi, seperti VS Code.
        const dot = inputEl.value.lastIndexOf('.');
        inputEl.setSelectionRange(0, dot > 0 ? dot : inputEl.value.length);
      } else {
        form.querySelector('button[type=submit]').focus();
      }
    });
  }

  const ask = (title, placeholder, value = '') =>
    modal({ title, input: { placeholder, value }, buttons: [{ label: 'OK', primary: true }, { label: 'Batal', value: null }] });

  // ---------- Explorer ----------
  function fileIcon(entry, open) {
    if (entry.type === 'dir') return h('span', { class: 'ficon dir' }, svg(open ? ICON.folderOpen : ICON.folder));
    const ext = extOf(entry.path);
    if (isImage(entry.path)) return h('span', { class: 'ficon img' }, svg(ICON.image));
    const label = { html: '<>', css: '#', js: 'JS' }[ext] ?? '•';
    return h('span', { class: `ficon ${ext}` }, label);
  }

  // Frontend/backend: folder functions/ dijalankan di server dan tidak pernah dikirim ke browser (sama dengan
  // hidden() di go/internal/sites/sites.go); file lain disajikan apa adanya ke pengunjung.
  const isBackend = (p) => /^functions(\/|$)/i.test(p);
  function sideLabel(entry) {
    if (isBackend(entry.path)) return h('span', { class: 'side be', title: 'Backend: berjalan di server (fungsi /api/fn), kodenya tidak bisa dilihat pengunjung' }, 'BE');
    if (entry.type === 'dir') return null;
    return h('span', { class: 'side fe', title: 'Frontend: dikirim ke browser, kodenya bisa dilihat pengunjung' }, 'FE');
  }

  function childrenOf(dir) {
    return state.entries
      .filter((e) => parentOf(e.path) === dir)
      .sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
  }

  function renderTree() {
    const tree = $('#tree');
    const rows = [];
    const walk = (dir, depth) => {
      for (const entry of childrenOf(dir)) {
        const isDir = entry.type === 'dir';
        const open = state.expanded.has(entry.path);
        const cls = ['row', state.selected === entry.path && 'selected', isDirty(entry.path) && 'dirty'].filter(Boolean).join(' ');
        rows.push(h('div', {
          class: cls,
          style: `padding-left:${8 + depth * 12}px`,
          title: entry.path,
          dataset: { path: entry.path, type: entry.type },
        },
        h('span', { class: `chev${open ? ' open' : ''}` }, isDir ? svg(ICON.chevron) : null),
        fileIcon(entry, open),
        h('span', { class: 'name' }, entry.name),
        sideLabel(entry),
        h('button', { type: 'button', class: 'row-more', title: 'Menu', 'aria-label': `Menu ${entry.name}` }, '⋯')));
        if (isDir && open) walk(entry.path, depth + 1);
      }
    };
    walk('', 0);
    if (!rows.length) rows.push(h('div', { class: 'empty' }, 'Belum ada file. Klik kanan di sini, pakai tombol di atas, atau seret gambar ke sini.'));
    tree.replaceChildren(...rows);
  }

  function renderUsage(usage) {
    const pct = Math.min(100, (usage.size / usage.limits.totalSize) * 100);
    const nearlyFull = pct >= 80 || usage.entries >= usage.limits.entries * 0.9;
    $('#usage').replaceChildren(
      `${formatBytes(usage.size)} / ${formatBytes(usage.limits.totalSize)} · ${usage.entries} item`,
      h('div', { class: 'usage-bar' }, h('div', { style: `width:${pct}%` })),
      nearlyFull && ai.credits?.topupEnabled && !ai.credits.plan
        ? h('button', { type: 'button', class: 'usage-upgrade', onclick: () => openTopup('plans') }, 'Storage hampir penuh · tambah dengan langganan')
        : '', // replaceChildren() bawaan browser menulis null sebagai teks "null"
    );
  }

  async function loadTree() {
    const { files, usage } = await api('GET', '/api/files');
    state.entries = files;
    state.limits = usage.limits;
    renderTree();
    renderUsage(usage);
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

  function createModel(path, content, savedContent = content) {
    const model = monaco.editor.createModel(content, undefined, monaco.Uri.parse(`file:///${path}`));
    model.onDidChangeContent(() => onContentChange(path));
    state.models.set(path, model);
    state.saved.set(path, savedContent);
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
      if ($('#editorArea').dataset.mode === 'code') autoFocus(editor); // jangan rebut fokus dari kotak AI dsb.
      expandTo(path);
      if (extOf(path) === 'html' && state.previewPath !== path) {
        state.previewPath = path;
        state.previewRoute = null;
        reloadPreview();
      }
    } else {
      editor.setModel(null);
    }
    $('#welcome').hidden = Boolean(path);
    renderTabs();
    renderTree();
    renderBreadcrumbs();
    updateStatus();
    updateAiComposer();
    flowFollow();
  }

  function renderTabs() {
    const names = state.tabs.map(baseName);
    $('#tabs').replaceChildren(...state.tabs.map((path) => {
      const duplicate = names.filter((n) => n === baseName(path)).length > 1;
      const cls = ['tab', path === state.active && 'active', isDirty(path) && 'dirty'].filter(Boolean).join(' ');
      return h('div', {
        class: cls,
        title: path,
        onclick: () => { setMode('code'); activate(path); },
        onauxclick: (e) => { if (e.button === 1) closeTab(path); },
      },
      fileIcon({ type: 'file', path }),
      h('span', {}, baseName(path)),
      duplicate && parentOf(path) ? h('span', { class: 'tab-dir' }, parentOf(path)) : null,
      h('button', {
        class: 'close',
        title: 'Tutup',
        onclick: (e) => { e.stopPropagation(); closeTab(path); },
      }, svg(ICON.close)));
    }));
    $('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const projectName = state.project ? `${state.project.name} · ` : '';
    document.title = `${state.active ? `${isDirty(state.active) ? '● ' : ''}${baseName(state.active)} · ` : ''}${projectName}rakit.io`;
  }

  function renderBreadcrumbs() {
    const el = $('#breadcrumbs');
    if (!state.active) return el.replaceChildren();
    const parts = state.active.split('/');
    el.replaceChildren(...parts.flatMap((part, i) => (i ? [h('span', { class: 'sep' }, '›'), h('span', {}, part)] : [h('span', {}, part)])));
  }

  function disposeFile(path) {
    clearTimeout(state.saveTimers.get(path));
    state.saveTimers.delete(path);
    state.models.get(path)?.dispose();
    state.models.delete(path);
    state.saved.delete(path);
    state.viewStates.delete(path);
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
    renderTabs();
    flowContentChanged(path);
    const row = $(`#tree .row[data-path="${CSS.escape(path)}"]`);
    row?.classList.toggle('dirty', isDirty(path));
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
      renderTabs();
      $(`#tree .row[data-path="${CSS.escape(path)}"]`)?.classList.toggle('dirty', isDirty(path));
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
    state.expanded = new Set([...state.expanded].map(map));
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
    const input = h('input', { type: 'file', accept: IMAGE_EXT.map((e) => `.${e}`).join(','), multiple: !replacePath });
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
      const dir = dropDir(e);
      tree.querySelectorAll('.row.drop-dir').forEach((r) => r.classList.toggle('drop-dir', r.dataset.path === dir));
      const row = dir && tree.querySelector(`.row[data-path="${CSS.escape(dir)}"]`);
      if (row) row.classList.add('drop-dir');
    });
    tree.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      tree.classList.remove('drop-target');
      tree.querySelectorAll('.row.drop-dir').forEach((r) => r.classList.remove('drop-dir'));
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
    const entry = state.entries.find((e) => e.path === path);
    const root = $('#modal');
    const url = imageUrl(path);
    const info = h('span', {}, entry ? formatBytes(entry.size) : '');
    const img = h('img', { src: url, alt: path });
    img.onload = () => { info.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${entry ? formatBytes(entry.size) : ''}`; };
    img.onerror = () => { info.textContent = 'Gambar tidak bisa ditampilkan.'; };

    const close = () => {
      root.hidden = true;
      root.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const snippets = [
      ['Path', `/${path}`],
      ['HTML', `<img src="/${path}" alt="${baseName(path).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')}">`],
      ['CSS', `background-image: url('/${path}');`],
    ];

    root.replaceChildren(h('div', { class: 'modal image-modal', role: 'dialog', 'aria-label': `Gambar ${path}` },
      h('div', { class: 'topup-head' },
        h('div', {}, h('h3', {}, baseName(path)), h('p', {}, info)),
        h('button', { class: 'icon-btn', type: 'button', title: 'Tutup', onclick: close }, svg(ICON.close))),
      h('div', { class: 'image-stage' }, img),
      h('div', { class: 'image-snippets' }, snippets.map(([label, code]) => h('div', { class: 'snippet' },
        h('span', { class: 'snippet-label' }, label),
        h('code', {}, code),
        h('button', { type: 'button', onclick: () => copyText(code, `${label} disalin`) }, 'Salin')))),
      h('div', { class: 'modal-buttons' },
        h('button', { type: 'button', onclick: () => { close(); pickImages(parentOf(path), path); } }, 'Ganti gambar…'),
        h('button', { type: 'button', class: 'danger', onclick: () => { close(); deleteEntry(path); } }, 'Hapus'),
        h('button', { type: 'button', class: 'primary', onclick: close }, 'Tutup'))));
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);
  }

  // ---------- Context menu ----------
  // align 'right': x adalah tepi kanan menu (mis. tepi kanan tombol "⋯"). label: elemen judul di atas menu.
  // Ukuran diukur setelah semua isi terpasang, lalu menu dijaga di dalam layar.
  function showMenu(x, y, items, { align = 'left', label = null } = {}) {
    const menu = $('#ctxmenu');
    menu.classList.remove('history-menu');
    menu.replaceChildren(...[label, ...items.filter(Boolean).map((item) => (item === '-'
      ? h('div', { class: 'sep' })
      : h('button', { class: item.danger ? 'danger' : '', onclick: () => { hideMenu(); item.run(); } },
        h('span', {}, item.label), item.hint ? h('span', { class: 'hint' }, item.hint) : null)))].filter(Boolean));
    menu.hidden = false;
    // Ukur di pojok kiri atas (ruang penuh, isi tidak terlipat karena posisi lama di dekat tepi layar).
    // offsetWidth/Height: ukuran asli, tidak terpengaruh animasi muncul (scale) seperti getBoundingClientRect.
    menu.style.left = '0px';
    menu.style.top = '0px';
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = align === 'right' ? x - width : x;
    menu.style.left = `${Math.max(4, Math.min(left, innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - height - 4))}px`;
  }

  function hideMenu() {
    $('#ctxmenu').hidden = true;
  }

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
    $('#previewHost').textContent = previewBase();
    schedulePublishCheck();
    if (document.activeElement !== $('#previewUrl')) $('#previewUrl').value = route;
    $('#openPreview').href = url;
    // Server mengirim Cache-Control: no-cache, jadi cukup set ulang src untuk memuat versi terbaru.
    $('#previewFrame').src = url;
  }

  // ---------- Pilih blok di preview ----------
  // Pengguna memilih bagian halaman (maks. 5) lalu menulis prompt; AI diarahkan hanya mengubah bagian itu.
  // Halaman preview ada di origin lain (<slug>.rakit.io), jadi pemilihannya dilakukan skrip kecil yang
  // disisipkan server ke halaman di dalam iframe (go/internal/sites/picker.js), lewat postMessage.
  // Blok bisa dari beberapa halaman: tiap blok membawa halamannya (pathname di preview). Pindah halaman
  // tidak melepas pilihan; saat kembali, sorotannya dipulihkan. Batas 5 blok dihitung dari semua halaman.
  const MAX_BLOCKS = 5;
  const pick = { on: false, page: null, blocks: [] };
  const AI_PLACEHOLDER = 'Minta AI membuat atau mengubah kode… (Enter kirim, Shift+Enter baris baru)';
  const siteOrigin = () => new URL(previewBase()).origin;
  const toPicker = (message) => $('#previewFrame').contentWindow?.postMessage({ rakit: true, lang: LANG, ...message }, siteOrigin());
  const blocksOn = (page) => pick.blocks.filter((b) => b.page === page);
  // Jatah di halaman yang sedang tampil = 5 dikurangi blok di halaman lain.
  const pageLimit = () => MAX_BLOCKS - pick.blocks.filter((b) => b.page !== pick.page).length;
  // "/" -> "index", "/produk/sepatu.html" -> "sepatu"
  const pageName = (page) => decodeURIComponent(page.replace(/\/+$/, '').split('/').pop() || 'index').replace(/\.html$/i, '') || 'index';

  function setPick(on) {
    pick.on = on;
    if (!on) pick.blocks = [];
    if (on && textEdit.on) setTextEdit(false, { quiet: true });
    $('#pickBlocks').classList.toggle('active', on);
    $('#pickBlocks').setAttribute('aria-pressed', String(on));
    toPicker({ type: 'pick', on, limit: pageLimit(), restore: on ? blocksOn(pick.page).map((b) => b.selector) : undefined });
    renderBlocks();
  }

  function removeBlock(b) {
    if (b.page === pick.page) return toPicker({ type: 'remove', selector: b.selector });
    // Blok di halaman lain: halaman itu tidak sedang dimuat, cukup dilepas di sini.
    pick.blocks = pick.blocks.filter((x) => x !== b);
    toPicker({ type: 'limit', limit: pageLimit() });
    renderBlocks();
  }

  function renderBlocks() {
    const n = pick.blocks.length;
    const manyPages = new Set(pick.blocks.map((b) => b.page)).size > 1;
    $('#pickBar').hidden = !pick.on;
    const move = mobileQuery.matches ? 'Pindah halaman lewat bar alamat.' : 'Alt+klik link untuk pindah halaman.';
    $('#pickHint').textContent = n
      ? `${n} blok dipilih. Klik lagi untuk melepas. ${move}`
      : `Klik bagian halaman yang mau diubah (maks. ${MAX_BLOCKS}). ${move}`;
    $('#pickGo').hidden = !n;
    const box = $('#aiBlocks');
    box.hidden = !n;
    box.replaceChildren(...pick.blocks.map((b) => {
      const here = b.page === pick.page;
      return h('span', { class: `ai-block${here ? '' : ' other-page'}`, title: `${b.page} · ${b.selector}` },
        svg(ICON.block), h('span', { class: 'ai-block-label' }, b.label),
        manyPages ? h('span', { class: 'ai-block-page' }, pageName(b.page)) : null,
        here ? h('button', { type: 'button', title: 'Perbesar ke bagian induknya', 'aria-label': `Perbesar ${b.label}`, onclick: () => toPicker({ type: 'parent', selector: b.selector }) }, '⬆') : null,
        h('button', { type: 'button', title: 'Lepas blok ini', 'aria-label': `Lepas ${b.label}`, onclick: () => removeBlock(b) }, '×'));
    }));
    $('#aiInput').placeholder = n
      ? 'Mau blok ini diubah jadi seperti apa? Mis. buat lebih modern dengan warna gelap'
      : AI_PLACEHOLDER;
  }

  function bindBlockPicker() {
    $('#pickBlocks').onclick = () => setPick(!pick.on);
    $('#pickDone').onclick = () => setPick(false);
    $('#pickGo').onclick = () => { setMobileView('editor'); setMode('ai'); };
    $('#editText').onclick = () => setTextEdit(!textEdit.on);
    $('#textDone').onclick = () => setTextEdit(false);
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
        renderBlocks();
      } else if (m.type === 'blocks' && pick.on) {
        const first = !pick.blocks.length && m.blocks.length;
        pick.page = m.page;
        // Urutan chip tetap sesuai urutan dipilih: blok halaman ini diperbarui di tempatnya, yang baru di akhir.
        const fresh = new Map(m.blocks.map((b) => [b.selector, { ...b, page: m.page }]));
        const kept = pick.blocks.filter((b) => b.page !== m.page || fresh.has(b.selector)).map((b) => (b.page === m.page ? fresh.get(b.selector) : b));
        const added = [...fresh.values()].filter((b) => !kept.includes(b));
        pick.blocks = [...kept, ...added].slice(0, MAX_BLOCKS);
        renderBlocks();
        // Blok pertama dipilih: tampilkan kotak prompt (di Coding bisa saja sedang di tab lain).
        if (first && $('#editorArea').dataset.mode !== 'ai') setMode('ai');
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
  const textEdit = { on: false };
  // Disimpan tanpa memuat ulang preview: teks barunya sudah tampil di sana.
  const quietSaves = new Set();
  const htmlDecoder = document.createElement('textarea');
  const decodeHtml = (raw) => { htmlDecoder.innerHTML = raw; return htmlDecoder.value; };

  function setTextEdit(on, { quiet = false } = {}) {
    textEdit.on = on;
    if (on && pick.on) setPick(false);
    $('#editText').classList.toggle('active', on);
    $('#editText').setAttribute('aria-pressed', String(on));
    $('#textBar').hidden = !on;
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
    renderTabs();
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
      if ($('#editorArea').dataset.mode === 'data' && db.active === target.table) loadDbRows();
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
    let chosen = null; // alamat baru untuk src (null = tidak diganti)
    const root = $('#modal');
    const stage = h('img', { src: m.shown, alt: '' });
    const info = h('p', {}, current ? `/${current}` : m.src || '(tanpa src)');
    const grid = h('div', { class: 'imgpick-grid' });
    const urlInput = h('input', { placeholder: 'https://… atau /gambar.jpg', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Alamat gambar' });
    const altInput = h('input', { value: m.alt ?? '', placeholder: 'mis. Tim kami di kantor', 'aria-label': 'Teks alternatif' });

    const choose = (src, label) => {
      chosen = src;
      stage.src = src.startsWith('/') ? `${previewBase()}${src}` : src;
      info.textContent = label;
      grid.querySelectorAll('.imgpick-item').forEach((b) => b.classList.toggle('active', `/${b.dataset.path}` === src));
    };
    const renderGrid = () => {
      const images = state.entries.filter((e) => e.type === 'file' && isImage(e.path) && extOf(e.path) !== 'ico');
      grid.replaceChildren(...(images.length ? images.map((e) => h('button', {
        type: 'button',
        class: `imgpick-item${(chosen ? chosen === `/${e.path}` : e.path === current) ? ' active' : ''}`,
        title: `/${e.path}`,
        dataset: { path: e.path },
        onclick: () => { urlInput.value = ''; choose(`/${e.path}`, `/${e.path}`); },
      }, h('img', { src: imageUrl(e.path), alt: '', loading: 'lazy' }), h('span', {}, baseName(e.path))))
        : [h('p', { class: 'imgpick-empty' }, 'Belum ada gambar di project. Upload gambar baru di bawah.')]));
    };
    renderGrid();

    const upload = () => {
      const input = h('input', { type: 'file', accept: IMAGE_EXT.map((e) => `.${e}`).join(',') });
      input.onchange = async () => {
        // Simpan di folder gambar lama bila gambar itu ada di project, atau di folder images/ bila ada.
        const dir = current ? parentOf(current) : state.entries.some((e) => e.type === 'dir' && e.path === 'images') ? 'images' : '';
        const [path] = await uploadImages([...input.files], dir, null, { reload: false });
        if (!path) return;
        renderGrid();
        urlInput.value = '';
        choose(`/${path}`, `/${path}`);
      };
      input.click();
    };
    urlInput.oninput = () => {
      const v = urlInput.value.trim();
      if (/^(https?:\/\/|\/)\S+$/i.test(v)) choose(v, v);
    };

    const close = () => {
      root.hidden = true;
      root.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const submit = async (e) => {
      e.preventDefault();
      const typed = urlInput.value.trim();
      if (typed && !/^(https?:\/\/|\/)\S+$/i.test(typed)) {
        urlInput.focus();
        return toast('Alamat gambar harus diawali https:// atau / (file di project)', 'error');
      }
      const alt = altInput.value.replace(/\s+/g, ' ').trim();
      const changes = {};
      if (chosen && chosen !== m.src && !(current && chosen === `/${current}`)) changes.src = chosen;
      if (alt !== (m.alt ?? '')) changes.alt = alt;
      close();
      if (!Object.keys(changes).length) return;
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
    };

    root.replaceChildren(h('form', { class: 'modal image-modal imgpick-modal', role: 'dialog', 'aria-label': 'Ganti gambar', onsubmit: submit },
      h('div', { class: 'topup-head' },
        h('div', {}, h('h3', {}, 'Ganti gambar'), info),
        h('button', { class: 'icon-btn', type: 'button', title: 'Tutup', onclick: close }, svg(ICON.close))),
      h('div', { class: 'image-stage imgpick-stage' }, stage),
      h('div', { class: 'imgpick-label' }, h('span', {}, 'Gambar di project'),
        h('button', { type: 'button', class: 'imgpick-upload', onclick: upload }, 'Upload gambar baru…')),
      grid,
      h('div', { class: 'imgpick-label' }, h('span', {}, 'Atau pakai alamat gambar')),
      urlInput,
      h('div', { class: 'imgpick-label' }, h('span', {}, 'Teks alternatif (alt)'), h('small', {}, 'Deskripsi gambar untuk pembaca layar & mesin pencari')),
      altInput,
      h('div', { class: 'modal-buttons' },
        h('button', { type: 'button', onclick: close }, 'Batal'),
        h('button', { type: 'submit', class: 'primary' }, 'Simpan'))));
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);
    grid.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  // Bar alamat preview: host tetap (website project ini), path/query/hash bisa diubah.
  function bindPreviewUrl() {
    const input = $('#previewUrl');
    const current = () => state.previewRoute ?? routeFor(state.previewPath);
    const go = () => {
      let value = input.value.trim();
      const host = previewBase();
      // Tempel alamat lengkap website ini tetap boleh; host lain ditolak.
      if (value.toLowerCase().startsWith(host.toLowerCase())) value = value.slice(host.length);
      else if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value)) {
        toast(`Preview hanya bisa membuka halaman di ${host.replace(/^https?:\/\//, '')}`, 'error');
        input.value = current();
        input.select(); // siap diketik ulang
        return;
      }
      if (!value.startsWith('/')) value = `/${value}`;
      state.previewRoute = value.replace(/\s/g, '%20');
      input.blur();
      reloadPreview();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); go(); }
      if (e.key === 'Escape') { e.preventDefault(); input.value = current(); input.blur(); }
    });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', () => { input.value = current(); }); // batal kalau tidak ditekan Enter
    $('#previewHost').addEventListener('click', () => input.focus());
  }

  let previewTimer;
  function schedulePreviewReload() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(reloadPreview, 250);
  }

  function togglePreview() {
    if (isSimple()) return;
    const preview = $('#preview');
    preview.hidden = !preview.hidden;
    preview.previousElementSibling.hidden = preview.hidden;
    $('#togglePreview').classList.toggle('active', !preview.hidden);
    storage.set('rakit.previewHidden', preview.hidden);
  }

  function toggleSidebar() {
    if (isSimple()) return;
    const sidebar = $('#sidebar');
    sidebar.hidden = !sidebar.hidden;
    sidebar.nextElementSibling.hidden = sidebar.hidden;
    $('#toggleSidebar').classList.toggle('active', !sidebar.hidden);
  }

  function setDevice(device) {
    $('#stage').dataset.device = device;
    document.querySelectorAll('.device-switch button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.device === device);
    });
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
    ], { align: 'right', label: h('div', { class: 'menu-label' }, h('strong', {}, state.me.username), state.me.email) });
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
    if (diagram.saved && $('#editorArea').dataset.mode === 'diagram') rerenderDiagram(); // warna Mermaid ikut tema
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
    storage.set('rakit.layout', layout);
    document.querySelectorAll('.layout-switch [data-layout]').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.layout === layout));
    });
    // Di Simple preview selalu tampil; kembali ke Coding = ikuti pilihan tampil/sembunyi sebelumnya.
    const preview = $('#preview');
    const showPreview = layout === 'simple' || !storage.get('rakit.previewHidden', false);
    if (preview.hidden === showPreview) {
      preview.hidden = !showPreview;
      preview.previousElementSibling.hidden = !showPreview;
      $('#togglePreview').classList.toggle('active', showPreview);
    }
    if (layout === 'simple') {
      if (document.body.dataset.mobileView === 'files') setMobileView('editor');
      if ($('#editorArea').dataset.mode !== 'ai') setMode('ai');
    }
  }

  function setMobileView(view) {
    document.body.dataset.mobileView = view;
    document.querySelectorAll('.mobile-nav [data-view]').forEach((btn) => {
      btn.setAttribute('aria-current', String(btn.dataset.view === view));
    });
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
    ]);
    $('#ctxmenu').classList.add('history-menu');
  }

  function openNewProject() {
    const { body, close } = openPanel('db-modal');
    const base = state.project.siteHost.slice(state.project.slug.length); // ".rakit.io"
    const slugInput = h('input', { placeholder: 'tokokue', spellcheck: 'false', autocomplete: 'off', maxlength: '30' });
    const nameInput = h('input', { placeholder: 'Toko Kue Bu Sari', maxlength: '60' });
    const preview = h('strong', {}, `namamu${base}`);
    slugInput.addEventListener('input', () => {
      const cleaned = slugInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (cleaned !== slugInput.value) slugInput.value = cleaned;
      preview.textContent = `${cleaned || 'namamu'}${base}`;
    });
    const error = h('p', { class: 'db-form-error' });
    const submit = h('button', { type: 'submit', class: 'primary' }, 'Buat project');
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          const { project } = await api('POST', '/api/projects', { slug: slugInput.value, name: nameInput.value });
          close();
          await saveAll();
          location.href = projectUrl(project.slug);
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
        }
      },
    },
    h('h3', {}, 'Project baru'),
    h('p', { class: 'db-note' }, 'Setiap project adalah website terpisah dengan alamat, file, database, dan riwayat AI sendiri. Kredit AI dipakai bersama untuk semua project.'),
    h('label', { class: 'db-field' }, h('span', { class: 'db-field-label' }, 'Alamat website'), slugInput),
    h('p', { class: 'project-preview' }, 'Websitemu: ', preview),
    h('label', { class: 'db-field' }, h('span', { class: 'db-field-label' }, 'Nama project', h('span', { class: 'col-type' }, 'opsional')), nameInput),
    error,
    h('div', { class: 'modal-buttons' }, h('button', { type: 'button', onclick: close }, 'Batal'), submit));
    body.append(form);
    slugInput.focus();
  }

  async function renameProject() {
    const name = await ask('Ganti nama project', 'Nama project', state.project.name);
    if (!name || name === state.project.name) return;
    try {
      const { project } = await api('PATCH', `/api/projects/${state.project.slug}`, { name });
      state.project = project;
      state.projects = state.projects.map((p) => (p.slug === project.slug ? project : p));
      renderProjectInfo();
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

  function renderProjectInfo() {
    const p = state.project;
    $('#projectName').textContent = p.siteHost;
    $('#siteLink').textContent = p.siteHost;
    $('#siteLink').href = p.siteUrl;
    $('#visitSite').href = p.siteUrl;
    $('#projectSwitch').title = `Project: ${p.name} — ganti atau buat project`;
    document.title = `${p.name} · rakit.io`;
    renderPublish();
  }

  // ---------- Publikasi manual (dev/prod) ----------
  // Mode "manual": editor & AI mengubah versi dev (<slug>--dev); website publik baru berubah saat
  // dipublikasikan. Database dev terpisah; struktur tabelnya ikut dipublikasikan, datanya tidak.
  const isManual = () => state.project?.mode === 'manual';
  const pub = { status: null, timer: 0 };

  function renderPublish() {
    const manual = isManual();
    document.body.dataset.publish = manual ? 'manual' : 'live';
    $('#publishBtn').hidden = !manual;
    $('#envBadge').hidden = !manual;
    const pending = manual && Boolean(pub.status?.pending);
    $('#publishBtn').classList.toggle('pending', pending);
    $('#publishBtn').title = pending ? 'Ada perubahan yang belum dipublikasikan' : 'Website publik sudah sama dengan versi dev';
  }

  async function refreshPublish() {
    pub.status = null;
    if (isManual()) {
      try { pub.status = (await api('GET', '/api/publish')).publish; } catch { /* coba lagi nanti */ }
    }
    renderPublish();
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
    renderProjectInfo();
    reloadPreview();
  }

  function openSheet(className, label, build) {
    const root = $('#modal');
    const close = () => { root.hidden = true; root.replaceChildren(); };
    root.replaceChildren(h('div', { class: `modal ${className}`, role: 'dialog', 'aria-label': label }, ...build(close)));
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    return close;
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
      renderConsoleBadge,
      renderMarkdown,
      linkifyLines,
      loadMermaid,
      autoFocus,
      isDark,
      activityView,
      readEvents,
      loadCredits,
      setCredits: (credits) => { ai.credits = credits; renderCredits(); },
      costPerPrompt: () => ai.credits?.costPerPrompt ?? 1,
      storageGet: (key, fallback) => storage.get(key, fallback),
      storageSet: (key, value) => storage.set(key, value),
      projectSlug: () => state.project.slug,
      sessionExpired: () => { location.href = HOME; },
      icons: { refresh: ICON.refresh, trash: ICON.trash, table: ICON.table, gear: ICON.gear, lock: ICON.lock, close: ICON.close, flow: ICON.flow },
    }]]);
    return svelteContext;
  }

  // Dialog dari komponen Svelte di #modal: Esc atau klik di luar dialog menutupnya. Komponen menerima prop close.
  // keepEscapeIn: elemen (nama tag) tempat Esc tidak menutup dialog, mis. ['TEXTAREA'] untuk isian panjang.
  function openDialog(Component, props = {}, { keepEscapeIn = [] } = {}) {
    const root = $('#modal');
    let app;
    const onKey = (e) => {
      if (e.key === 'Escape' && !keepEscapeIn.includes(e.target.tagName)) { e.preventDefault(); close(); }
    };
    function close() {
      if (!app) return;
      unmount(app);
      app = null;
      root.hidden = true;
      root.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
    }
    root.replaceChildren();
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);
    app = mount(Component, { target: root, props: { ...props, close }, context: editorContext() });
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
    pub.status = st;
    renderPublish();
    openDialog(PublishDialog, {
      status: st,
      onPublished: (status) => { pub.status = status; renderPublish(); },
      onModeDialog: openPublishMode,
    });
  }

  function openPublishMode() {
    openDialog(PublishModeDialog, {
      current: isManual() ? 'manual' : 'live',
      siteUrl: state.project.siteUrl,
      slug: state.project.slug,
      onApplied: (res) => { applyProject(res.project); pub.status = res.publish; renderPublish(); },
    });
  }

  // ---------- Status bar ----------
  function updateStatus() {
    const model = state.active && state.models.get(state.active);
    if (!model) {
      $('#statusCursor').textContent = '';
      $('#statusLang').textContent = '';
      return;
    }
    const pos = editor.getPosition();
    $('#statusCursor').textContent = pos ? `Ln ${pos.lineNumber}, Col ${pos.column}` : '';
    $('#statusLang').textContent = { html: 'HTML', css: 'CSS', javascript: 'JavaScript' }[model.getLanguageId()] ?? model.getLanguageId();
  }

  // ---------- Splitter ----------
  function initSplitters() {
    const widths = storage.get('rakit.widths', {});
    if (widths.sidebar) $('#sidebar').style.width = `${widths.sidebar}px`;
    if (widths.preview) $('#preview').style.width = `${widths.preview}px`;

    document.querySelectorAll('.splitter').forEach((splitter) => {
      splitter.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const target = $(`#${splitter.dataset.target}`);

        // Lapisan transparan di atas semua elemen (termasuk iframe preview & Monaco) selama drag:
        // kursor tetap col-resize dan semua gerakan mouse tertangkap di dokumen ini.
        const overlay = h('div', { class: 'resize-overlay' });
        document.body.append(overlay);
        splitter.classList.add('dragging');

        const onMove = (ev) => {
          if (ev.buttons === 0) return end(); // tombol sudah dilepas di luar jangkauan (mis. di luar jendela)
          const rect = target.getBoundingClientRect();
          const width = splitter.dataset.target === 'sidebar'
            ? Math.min(Math.max(ev.clientX - rect.left, 160), 600)
            : Math.min(Math.max(rect.right - ev.clientX, 240), innerWidth - 480);
          target.style.width = `${width}px`;
        };
        const end = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
          window.removeEventListener('blur', end);
          overlay.remove();
          splitter.classList.remove('dragging');
          storage.set('rakit.widths', {
            sidebar: $('#sidebar').getBoundingClientRect().width || widths.sidebar,
            preview: $('#preview').getBoundingClientRect().width || widths.preview,
          });
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
        window.addEventListener('blur', end);
      });
    });
  }

  // ---------- Event ----------
  function bindEvents() {
    const tree = $('#tree');
    tree.addEventListener('click', (e) => {
      const row = e.target.closest('.row');
      if (!row) return;
      const { path, type } = row.dataset;
      if (e.target.closest('.row-more')) {
        // Posisi tombol dibaca sebelum renderTree(): setelahnya tombol ini sudah diganti elemen baru.
        const rect = e.target.closest('.row-more').getBoundingClientRect();
        state.selected = path;
        renderTree();
        showMenu(rect.right, rect.bottom + 4, treeMenu(state.entries.find((x) => x.path === path)), { align: 'right' });
        return;
      }
      state.selected = path;
      if (type === 'dir') {
        state.expanded.has(path) ? state.expanded.delete(path) : state.expanded.add(path);
        renderTree();
      } else if (isImage(path)) {
        renderTree();
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
      if (entry) {
        state.selected = entry.path;
        renderTree();
      }
      showMenu(e.clientX, e.clientY, treeMenu(entry));
    });
    tree.addEventListener('keydown', (e) => {
      if (!state.selected) return;
      if (e.key === 'F2') { e.preventDefault(); renameEntry(state.selected); }
      if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) { e.preventDefault(); deleteEntry(state.selected); }
    });

    document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctxmenu')) hideMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
    window.addEventListener('blur', hideMenu);

    $('#newFileBtn').onclick = () => createEntry('file');
    $('#newFolderBtn').onclick = () => createEntry('dir');
    $('#uploadBtn').onclick = () => pickImages();
    bindImageDrop(tree);
    $('#refreshBtn').onclick = () => loadTree().catch((err) => toast(err.message, 'error'));
    $('#collapseBtn').onclick = () => { state.expanded.clear(); renderTree(); };
    $('#reloadPreview').onclick = reloadPreview;
    bindPreviewUrl();
    bindBlockPicker();
    $('#togglePreview').onclick = togglePreview;
    $('#publishBtn').onclick = openPublish;
    $('#toggleSidebar').onclick = toggleSidebar;
    // Tombol Simple/Coding disorot (bercahaya) sampai pengguna pertama kali memakainya.
    if (!storage.get('rakit.layoutSeen', false)) $('.layout-switch').classList.add('attention');
    document.querySelectorAll('.layout-switch [data-layout]').forEach((btn) => {
      btn.onclick = () => {
        setLayout(btn.dataset.layout);
        $('.layout-switch').classList.remove('attention');
        storage.set('rakit.layoutSeen', true);
      };
    });

    const autosave = $('#autosave');
    autosave.checked = state.autosave;
    autosave.onchange = () => {
      state.autosave = autosave.checked;
      storage.set('rakit.autosave', state.autosave);
      if (state.autosave) saveAll();
    };

    $('#avatarBtn').onclick = (e) => { e.stopPropagation(); showAccountMenu(); };
    $('#copySite').onclick = () => copyText(state.project.siteUrl);
    $('#projectSwitch').onclick = (e) => { e.stopPropagation(); showProjectMenu($('#projectSwitch')); };
    document.querySelectorAll('.device-switch button').forEach((btn) => {
      btn.onclick = () => setDevice(btn.dataset.device);
    });
    $('#welcome').addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'new-file') createEntry('file', '');
      else if (action === 'new-folder') createEntry('dir', '');
      else if (action === 'open-index') {
        if (state.entries.some((x) => x.path === 'index.html')) openFile('index.html');
        else toast('index.html belum ada — buat dulu lewat "File baru"', 'error');
      }
    });

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
  const ai = {
    credits: null,
    busy: false, // ada job AI yang sedang diikuti editor ini
    jobId: null, // id pesan AI yang sedang berjalan
    stream: null, // AbortController koneksi event (menutupnya TIDAK membatalkan job)
    threadId: null, // percakapan yang sedang dibuka
    mode: storage.get('rakit.aiMode', 'build'), // 'build' (Builder) | 'plan' (Plan)
    images: [], // lampiran prompt berikutnya: [{ full, thumb }] (data URL JPEG)
    pendingCard: null, // kartu perubahan yang menunggu Simpan/Batalkan
    applying: false, // sedang Simpan/Batalkan
  };

  const AI_MODES = {
    build: {
      title: 'Mau bikin apa hari ini?',
      intro: 'AI membaca semua file proyekmu lalu menulis atau mengubah kodenya. Kamu bisa cek dulu sebelum menerapkan.',
      placeholder: 'Minta AI membuat atau mengubah kode… (Enter kirim, Shift+Enter baris baru)',
      suggestions: [
        'Buat landing page portofolio yang modern',
        'Tambahkan navbar responsif dengan menu hamburger',
        'Tambahkan tombol dark mode',
        'Jelaskan kode di file yang sedang dibuka',
      ],
    },
    plan: {
      title: 'Rencanakan dulu, bangun kemudian',
      intro: 'Diskusikan idemu dengan AI tanpa mengubah file apa pun. Kalau rencananya sudah pas, jalankan dengan satu klik.',
      placeholder: 'Ceritakan website yang ingin kamu buat… AI tidak akan mengubah file.',
      suggestions: [
        'Rencanakan website toko online sederhana',
        'Halaman apa saja yang dibutuhkan untuk portofolio?',
        'Beri saran tampilan yang lebih menarik untuk websiteku',
        'Rencanakan website undangan pernikahan',
      ],
    },
  };

  function setAiMode(mode) {
    ai.mode = mode === 'plan' ? 'plan' : 'build';
    storage.set('rakit.aiMode', ai.mode);
    document.querySelectorAll('[data-ai-mode]').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.aiMode === ai.mode));
    });
    $('#aiInput').placeholder = AI_MODES[ai.mode].placeholder;
    // Perbarui halaman sambutan kalau belum ada percakapan.
    const box = $('#aiMessages');
    if (box.querySelector('.ai-empty')) {
      box.replaceChildren();
      renderAiEmpty();
    }
  }

  // Unlimited menghitung prompt, bukan kredit: selama jatah hari ini masih ada, prompt apa pun (dengan gambar
  // pun) cukup memakai 1 dari jatah itu. Setelah habis, kredit biasa yang dipakai.
  const unlimitedLeft = (c) => c?.plan?.id === 'unlimited' && c.plan.quotaRemaining > 0;
  const canAfford = (c, cost) => unlimitedLeft(c) || c.remaining >= cost;

  function renderCredits() {
    const badge = $('#aiCredits');
    const c = ai.credits;
    renderPlanBadge(c?.plan ?? null);
    if (!c || !c.enabled) return badge.replaceChildren();
    const empty = !canAfford(c, c.costPerPrompt);
    const plan = c.plan;
    const unlimited = unlimitedLeft(c);
    badge.textContent = unlimited ? 'Unlimited' : `${c.remaining} kredit`;
    badge.classList.toggle('empty', empty);
    badge.classList.toggle('plan', Boolean(plan));
    badge.disabled = !c.topupEnabled;
    badge.title = [
      plan && `${plan.name} aktif sampai ${shortDate(plan.expiresAt)}`,
      plan && (plan.id === 'unlimited'
        ? `Hari ini: ${plan.quotaUsed}/${plan.quota} prompt`
        : `Kredit ${plan.name}: ${plan.quotaRemaining}/${plan.quota} (terisi ulang ${shortDate(plan.quotaResetsAt)})`),
      c.bonusRemaining > 0 ? `Bonus awal: ${c.bonusRemaining}/${c.bonusLimit} (sekali, tidak berkurang tiap hari sampai habis)` : null,
      c.limit ? `Gratis hari ini: ${c.freeRemaining}/${c.limit} (terisi lagi besok 00.00 WIB, tidak menumpuk)` : null,
      c.purchased ? `Dibeli: ${c.purchased}` : null,
      c.topupEnabled ? 'Klik untuk langganan / isi ulang' : null,
    ].filter(Boolean).join(' · ');

    $('#aiTopupBanner').hidden = !empty;
    const usingBonus = c.bonusRemaining > 0;
    $('#aiTopupText').textContent = c.topupEnabled
      ? 'Kredit AI kamu habis.'
      : usingBonus
        ? `Masih ada bonus awal ${c.bonusRemaining} kredit.`
        : `Kredit AI hari ini habis (gratis ${c.limit}/hari). Terisi lagi besok 00.00 WIB.`;
    $('#aiTopupBtn').hidden = !c.topupEnabled;
    updateAiComposer();
  }

  // Badge langganan di header (+ cincin di avatar). Memberi peringatan saat masa aktif hampir habis.
  function renderPlanBadge(plan) {
    const badge = $('#planBadge');
    badge.hidden = !plan;
    $('#avatarBtn').classList.toggle('subscribed', Boolean(plan));
    $('#avatarBtn').dataset.plan = plan?.id ?? '';
    if (!plan) return;
    const daysLeft = Math.max(0, Math.ceil((Date.parse(plan.expiresAt) - Date.now()) / 86_400_000));
    const expiring = daysLeft <= 3;
    badge.dataset.plan = plan.id;
    badge.classList.toggle('expiring', expiring);
    $('.plan-badge-name', badge).textContent = plan.name;
    $('.plan-badge-days', badge).textContent = expiring ? (daysLeft ? `${daysLeft} hari lagi` : 'berakhir hari ini') : '';
    badge.title = `${plan.name} aktif sampai ${shortDate(plan.expiresAt)}${expiring ? ' · klik untuk perpanjang' : ''}`;
  }

  // Biaya prompt yang sedang disusun: prompt dengan gambar memakai lebih banyak kredit.
  const promptCost = () => (ai.images.length && ai.credits?.images ? ai.credits.images.cost : ai.credits?.costPerPrompt ?? 1);

  function updateAiComposer() {
    const c = ai.credits;
    $('#aiAttach').hidden = !c?.enabled || !c.images;
    const canSend = c?.enabled && canAfford(c, promptCost()) && !ai.busy && !ai.applying;
    $('#aiSend').disabled = !canSend || !$('#aiInput').value.trim();
    $('#aiInput').disabled = !c?.enabled;
  }

  function renderAiEmpty() {
    const box = $('#aiMessages');
    if (box.children.length) return;
    if (ai.credits && !ai.credits.enabled) {
      box.append(h('div', { class: 'ai-notice' }, 'Fitur AI belum diaktifkan di server ini.'));
      return;
    }
    const copy = AI_MODES[ai.mode];
    box.append(h('div', { class: 'ai-empty' },
      h('div', { class: 'spark' }, svg(SPARK)),
      h('h3', {}, copy.title),
      h('p', {}, copy.intro),
      h('div', { class: 'ai-suggestions' }, copy.suggestions.map((text) => h('button', {
        type: 'button',
        onclick: () => { $('#aiInput').value = text; sendPrompt(); },
      }, text)))));
  }

  function aiScroll() {
    const box = $('#aiMessages');
    box.scrollTop = box.scrollHeight;
  }

  // ---------- Penjelasan fitur (tombol ⓘ) ----------
  // Untuk belajar: tiap fitur dijelaskan dengan bahasa sederhana + analogi, cara pakainya di rakit.io,
  // istilah yang perlu diketahui, dan contoh permintaan ke AI untuk langsung dicoba.
  const FEATURE_INFO = {
    code: {
      icon: '</>', title: 'Editor Kode',
      what: 'Tempat kamu menulis isi website. Website dibangun dari tiga bahasa: HTML untuk struktur dan isi, CSS untuk tampilan, dan JavaScript untuk perilaku (apa yang terjadi saat tombol diklik, dan sebagainya).',
      analogy: 'Bayangkan membangun rumah: HTML adalah tembok dan ruangannya, CSS adalah cat dan dekorasinya, JavaScript adalah listrik dan saklarnya.',
      why: 'Semua website yang kamu buka setiap hari — dari toko online sampai media sosial — dibangun dari tiga bahasa ini. Memahaminya membuatmu bisa mengubah apa pun di websitemu sendiri.',
      how: ['Klik file di panel kiri untuk membukanya.', 'Ketik perubahan; tersimpan otomatis (Auto-save) dan preview di kanan langsung berubah.', 'Saat berhenti mengetik, AI menebak lanjutan kode dalam teks abu-abu — tekan Tab untuk menerima.', 'Ctrl/⌘ + S untuk menyimpan manual.'],
      terms: [['Tag', 'penanda HTML, mis. <h1>Judul</h1>'], ['Atribut', 'keterangan tambahan pada tag, mis. href pada <a>'], ['Selector', 'cara CSS memilih elemen, mis. .tombol atau h1'], ['Fungsi', 'kumpulan perintah JavaScript yang bisa dipanggil berulang']],
      tip: 'Ubah satu hal kecil, lalu lihat hasilnya di preview. Cara ini paling cepat untuk memahami arti setiap baris kode.',
      tryText: 'Jelaskan isi file index.html baris per baris dengan bahasa yang mudah dipahami pemula.', tryMode: 'plan',
    },
    ai: {
      icon: '✦', title: 'Asisten AI',
      what: 'Teman belajar yang bisa membuatkan dan mengubah kode untukmu (mode Builder), atau diajak berdiskusi dan merencanakan tanpa mengubah apa pun (mode Plan).',
      analogy: 'Seperti punya mentor programmer di sebelahmu: kamu ceritakan maumu, dia mengerjakan, lalu kamu bisa bertanya "kenapa begitu?".',
      why: 'Programmer zaman sekarang juga bekerja bersama AI. Kuncinya adalah tahu cara meminta dengan jelas dan memeriksa hasilnya — keterampilan yang kamu latih di sini.',
      how: ['Builder: tulis permintaan, AI mengubah file, lalu kamu pilih Simpan atau Batalkan.', 'Plan: diskusi dan susun rencana; tekan "Jalankan rencana ini" kalau sudah cocok.', 'Pilih blok di preview untuk mengubah bagian halaman tertentu saja.', 'Lampirkan gambar (mis. sketsa atau contoh desain) sebagai acuan.'],
      terms: [['Prompt', 'perintah atau pertanyaan yang kamu kirim ke AI'], ['Builder / Plan', 'mode mengerjakan / mode berdiskusi'], ['Kredit', 'jatah pemakaian AI; tiap prompt memakai kredit']],
      tip: 'Setelah AI mengubah sesuatu, tanyakan "jelaskan perubahan barusan", lalu buka tab Code untuk melihat kodenya. Dari situ kamu belajar.',
      tryText: 'Buatkan halaman profil sederhana tentang saya: foto, nama, sedikit cerita, dan daftar hobi.', tryMode: 'build',
    },
    data: {
      icon: '▦', title: 'Database',
      what: 'Tempat menyimpan data websitemu secara permanen di server, sehingga bisa dibaca dan ditambah dari halaman website — misalnya isi buku tamu, pesanan, atau daftar produk.',
      analogy: 'Mirip spreadsheet: satu tabel seperti satu sheet, kolom adalah judul kolom (nama, pesan, tanggal), dan setiap baris adalah satu data.',
      why: 'Tanpa database, data yang diisi pengunjung hilang begitu halaman ditutup, atau hanya tersimpan di browser satu orang. Hampir semua aplikasi — media sosial, toko online, aplikasi bank — bergantung pada database.',
      how: ['Buat tabel dan kolomnya, pilih tipe data: teks, angka, ya/tidak, tanggal, relasi, atau gambar.', 'Atur akses: siapa yang boleh melihat, menambah, mengubah, dan menghapus data.', 'Dari kode website, baca dan simpan data dengan fetch(\'/api/db/nama_tabel\').', 'Atau minta AI membuatkan form beserta tabelnya sekaligus.'],
      terms: [['Tabel / kolom / baris', 'wadah data / jenis isian / satu data'], ['API', 'alamat yang dipakai kode untuk meminta atau mengirim data'], ['Relasi', 'kolom yang menunjuk ke baris di tabel lain, mis. pesanan → produk'], ['Akses publik / privat', 'boleh dipakai semua pengunjung / hanya kamu']],
      tip: 'Biarkan akses "ubah" dan "hapus" tetap privat (hanya kamu), supaya pengunjung tidak bisa merusak data orang lain.',
      tryText: 'Buatkan buku tamu: form nama dan pesan yang tersimpan di database, lalu daftar ucapan yang sudah masuk tampil di bawahnya.', tryMode: 'build',
    },
    diagram: {
      icon: '◫', title: 'Diagram',
      what: 'Gambar struktur websitemu yang dibuat AI dari file dan database: siapa memakai fitur apa, bagaimana alurnya, dan bagaimana data saling terhubung.',
      analogy: 'Seperti denah dan peta sebuah gedung: kamu tidak perlu membuka setiap ruangan untuk memahami bentuk keseluruhannya.',
      why: 'Perancang sistem memakai diagram (UML, ERD) untuk merencanakan dan menjelaskan aplikasi — di dunia kerja maupun tugas kuliah. Diagram membantumu melihat gambaran besar sebelum menambah fitur.',
      how: ['Pilih jenis diagram di deretan tab.', 'Tekan Update diagram supaya AI menggambar dari file & database terbaru (memakai kredit).', 'Tekan ⓘ di toolbar diagram untuk cara membaca jenis yang sedang dibuka.', 'Zoom, geser, salin kode Mermaid, atau unduh sebagai SVG.'],
      terms: [['UML', 'kumpulan jenis diagram standar untuk merancang perangkat lunak'], ['ERD', 'diagram struktur database: tabel dan hubungannya'], ['Mermaid', 'bahasa teks untuk menggambar diagram']],
      tip: 'Bandingkan diagram dengan websitemu: kalau ada yang terasa aneh di diagram, biasanya ada yang perlu dirapikan di kodenya.',
    },
    fn: {
      icon: 'ϟ', title: 'Fungsi serverless',
      what: 'Kode JavaScript yang berjalan di server, bukan di browser pengunjung. Halaman websitemu memanggilnya lewat alamat /api/fn/nama-fungsi lalu menerima hasilnya.',
      analogy: 'Kode di halaman website itu seperti etalase toko — semua orang bisa melihat isinya. Fungsi adalah dapur di belakang: pengunjung hanya menerima hidangannya, tidak bisa melihat resep dan bahannya.',
      why: 'Ada hal yang tidak boleh terlihat atau diubah pengunjung: kunci API rahasia, perhitungan harga, atau pengiriman notifikasi. Di dunia kerja, ini disebut kode backend.',
      how: ['Tekan + Fungsi baru, tulis kodenya, lalu Coba langsung dari editor.', 'Simpan kunci rahasia di Rahasia (env) dan baca di kode lewat env.NAMA.', 'Panggil dari halaman: fetch(\'/api/fn/nama-fungsi\').', 'Atur Jadwal supaya fungsi berjalan otomatis (mis. laporan harian).'],
      terms: [['Server / backend', 'komputer dan kode di sisi penyedia, bukan di perangkat pengunjung'], ['Endpoint', 'alamat yang bisa dipanggil, mis. /api/fn/kirim-pesan'], ['Env (rahasia)', 'nilai rahasia yang hanya bisa dibaca fungsi'], ['Cron', 'jadwal untuk menjalankan sesuatu secara otomatis']],
      tip: 'Jangan pernah menulis kunci API di file .html atau .js halaman — siapa pun bisa membacanya. Simpan di Rahasia (env) dan pakai lewat fungsi.',
      tryText: 'Buatkan fungsi serverless yang mengirim notifikasi ke Telegram setiap ada pesan baru dari form kontak.', tryMode: 'build',
    },
    history: {
      icon: '↺', title: 'Riwayat versi',
      what: '"Foto" seluruh file project-mu pada satu waktu. Kamu bisa melihat perbedaannya dan kembali ke versi mana pun.',
      analogy: 'Seperti save point di game: kalau langkah berikutnya gagal, kamu tinggal kembali ke titik simpan terakhir.',
      why: 'Dengan riwayat, kamu bebas bereksperimen tanpa takut merusak. Programmer profesional memakai alat bernama Git untuk hal yang sama.',
      how: ['Versi tersimpan otomatis saat kamu mulai mengedit dan sebelum AI mengubah file.', 'Tekan Simpan versi sekarang sebelum mencoba perubahan besar.', 'Pilih sebuah versi untuk melihat file apa yang berubah, lalu Kembalikan bila perlu.'],
      terms: [['Versi', 'salinan semua file pada satu waktu'], ['Diff', 'perbedaan antara dua versi'], ['Restore', 'mengembalikan file ke versi tertentu'], ['Git', 'alat riwayat versi yang dipakai programmer di seluruh dunia']],
      tip: 'Biasakan menyimpan versi dengan nama yang jelas sebelum eksperimen, mis. "sebelum ganti desain".',
    },
    console: {
      icon: '›_', title: 'Console',
      what: 'Tempat semua pesan dari websitemu muncul: console.log dan error dari halaman (FE), log fungsi serverless (BE), request jaringan, dan catatan sistem seperti halaman yang dimuat.',
      analogy: 'Seperti kotak hitam pesawat: mencatat apa yang terjadi di balik layar, sehingga saat ada yang tidak beres kamu tahu persis di mana masalahnya.',
      why: 'Banyak kesalahan tidak terlihat di tampilan — tombol diam saja, data tidak tersimpan. Console memberi tahu alasannya. Programmer membuka console setiap hari untuk mencari bug.',
      how: ['Buka preview dan pakai websitemu; log-nya muncul di sini secara langsung.', 'Tulis console.log(nilai) di kode untuk melihat isi sebuah variabel.', 'Saring berdasarkan sumber (FE, BE, Jaringan, Sistem) atau tampilkan error saja.', 'Pada baris error, tekan Perbaiki dengan AI supaya AI mencari penyebabnya.'],
      terms: [['FE (frontend)', 'kode yang berjalan di browser pengunjung: .html, .css, .js halaman'], ['BE (backend)', 'kode yang berjalan di server: fungsi di folder functions/'], ['Request', 'permintaan halaman ke server, mis. fetch(\'/api/db/produk\')'], ['Status', 'kode hasil request: 2xx berhasil, 4xx salah permintaan, 5xx error server']],
      tip: 'Kalau sesuatu tidak berjalan, buka Console dulu — biasanya pesan error berwarna merah sudah menunjuk baris yang salah.',
    },
    files: {
      icon: '▤', title: 'File & folder',
      what: 'Semua bagian websitemu tersimpan sebagai file. index.html adalah halaman utama yang dibuka pertama kali; halaman lain, file CSS, JavaScript, dan gambar bisa dirapikan ke dalam folder.',
      analogy: 'Seperti map dan dokumen di lemari arsip: nama yang rapi membuat semuanya mudah ditemukan, oleh kamu maupun oleh browser.',
      why: 'Browser menemukan halaman dan gambar dari nama file dan foldernya (disebut path). Salah satu huruf saja, gambar atau halaman tidak akan muncul.',
      how: ['Buat file atau folder dengan tombol di atas daftar file.', 'Upload gambar, atau seret gambar langsung ke daftar file.', 'Klik ⋯ atau klik kanan pada file untuk ganti nama, hapus, atau salin kode <img>.', 'Halaman baru: buat mis. tentang.html, lalu tautkan dengan <a href="/tentang.html">.'],
      terms: [['Path', 'alamat file, mis. /images/foto.jpg'], ['Ekstensi', 'akhiran nama file yang menunjukkan jenisnya: .html, .css, .js, .png'], ['index.html', 'halaman yang dibuka saat alamat website diakses']],
      tip: 'Pakai huruf kecil dan tanda hubung tanpa spasi untuk nama file, mis. tentang-kami.html dan foto-profil.jpg.',
    },
    preview: {
      icon: '◉', title: 'Preview & website online',
      what: 'Tampilan langsung websitemu seperti yang dilihat pengunjung. Websitemu juga sudah online di alamatmu sendiri dan bisa dibuka siapa saja.',
      analogy: 'Seperti cermin: setiap perubahan kode langsung terlihat di sini, jadi kamu tahu efek dari setiap baris yang kamu tulis.',
      why: 'Pengunjung membuka website dari HP, tablet, dan laptop. Website yang baik tampil rapi di semua ukuran layar — ini disebut desain responsif.',
      how: ['Ganti ukuran Desktop / Tablet / HP di bawah preview untuk mengecek tampilan.', 'Pilih blok: klik bagian halaman lalu minta AI mengubah bagian itu saja.', 'Lihat situs membuka websitemu yang sudah online di tab baru.', 'Mode publikasi (menu avatar): langsung tayang setiap simpan, atau manual lewat versi dev.'],
      terms: [['Responsif', 'tampilan menyesuaikan ukuran layar'], ['Domain', 'alamat website, mis. namamu.rakit.io'], ['Dev / prod', 'versi untuk mencoba / versi yang dilihat pengunjung']],
      tip: 'Selalu cek tampilan HP — sebagian besar pengunjung membuka website dari ponsel.',
      tryText: 'Periksa apakah halaman ini sudah rapi di layar HP, lalu perbaiki bagian yang belum responsif.', tryMode: 'build',
    },
  };

  // Isi kotak AI dengan contoh permintaan (tidak langsung dikirim, supaya bisa diubah dulu).
  function askAi(text, mode = 'build') {
    setMode('ai');
    setAiMode(mode);
    $('#aiInput').value = text;
    autoGrow();
    updateAiComposer();
    autoFocus($('#aiInput'));
  }

  // Jembatan dari fitur lain (fungsi, database, diagram, Baca Alur Kode, editor) ke panel AI: tombol yang
  // mengisi kotak AI dengan permintaan beserta konteksnya (lihat juga assets-source/editor/handoff.js).
  function aiButton(label, text, { cls = 'fn-btn', mode = 'build' } = {}) {
    return h('button', {
      type: 'button', class: `${cls} ai-handoff`,
      title: `Isi kotak AI (${mode === 'plan' ? 'Plan' : 'Builder'}) dengan permintaan ini — bisa diubah dulu sebelum dikirim`,
      onclick: (e) => { e.stopPropagation(); askAi(typeof text === 'function' ? text() : text, mode); },
    }, h('span', { class: 'ai-spark', 'aria-hidden': 'true' }, '✦'), label);
  }
  function showFeatureInfo(key) {
    const info = FEATURE_INFO[key];
    if (!info) return;
    const { body, close } = openPanel('db-modal wide feature-info');
    body.append(
      h('div', { class: 'fi-head' }, h('span', { class: 'fi-icon', 'aria-hidden': 'true' }, info.icon),
        h('div', {}, h('span', { class: 'fi-kicker' }, 'Kenali fitur'), h('h3', {}, info.title))),
      h('p', { class: 'fi-what' }, info.what),
      h('div', { class: 'fi-analogy' }, h('strong', {}, 'Analogi '), info.analogy),
      h('h4', {}, 'Kenapa penting?'), h('p', {}, info.why),
      h('h4', {}, 'Cara pakai di rakit.io'), h('ol', { class: 'fi-steps' }, info.how.map((step) => h('li', {}, step))),
      h('h4', {}, 'Istilah yang perlu kamu tahu'),
      h('dl', { class: 'fi-terms' }, info.terms.map(([term, desc]) => [h('dt', {}, term), h('dd', {}, desc)])),
      h('div', { class: 'fi-tip' }, h('strong', {}, 'Tips belajar: '), info.tip),
      info.tryText ? h('div', { class: 'fi-try' }, h('span', {}, 'Coba minta ke AI:'), h('code', {}, info.tryText)) : null,
      h('div', { class: 'modal-buttons' },
        info.tryText ? h('button', { type: 'button', onclick: () => { close(); askAi(info.tryText, info.tryMode); } }, 'Coba sekarang') : null,
        h('button', { type: 'button', class: 'primary', onclick: close }, 'Mengerti')));
    body.querySelector('.modal-buttons .primary').focus({ preventScroll: true });
    body.scrollTop = 0;
  }

  function bindFeatureInfo() {
    $('#modeInfo').onclick = () => showFeatureInfo($('#editorArea').dataset.mode);
    $('#filesInfo').onclick = () => showFeatureInfo('files');
    $('#previewInfo').onclick = () => showFeatureInfo('preview');
  }

  // Area editor punya dua mode: 'code' (Monaco) dan 'ai' (chat asisten).
  function setMode(mode) {
    // Mis. "buka tabel" dari hasil AI: tampilannya hanya ada di Coding, jadi pindah ke sana.
    if (mode !== 'ai' && isSimple()) {
      setLayout('coding');
      toast('Pindah ke mode Coding');
    }
    $('#editorArea').dataset.mode = mode;
    $('#modeInfo').title = `Apa itu ${FEATURE_INFO[mode]?.title ?? 'fitur ini'}?`;
    $('#codeView').hidden = mode !== 'code';
    $('#aiPanel').hidden = mode !== 'ai';
    $('#dataView').hidden = mode !== 'data';
    $('#diagramView').hidden = mode !== 'diagram';
    $('#historyView').hidden = mode !== 'history';
    $('#fnView').hidden = mode !== 'fn';
    $('#consoleView').hidden = mode !== 'console';
    document.querySelectorAll('.mode-switch [data-mode]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.mode === mode));
    });
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
      renderAiEmpty();
      updateAiComposer();
      autoFocus($('#aiInput'));
    } else if (state.active) {
      autoFocus(editor);
    }
  }

  const toggleAi = () => { if (!isSimple()) setMode($('#editorArea').dataset.mode === 'ai' ? 'code' : 'ai'); };

  async function loadCredits() {
    try {
      ai.credits = await api('GET', '/api/ai/credits');
    } catch {
      ai.credits = null;
    }
    renderCredits();
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
  const userBubble = (m) => h('div', { class: 'msg user' },
    m.mode === 'plan' ? h('span', { class: 'msg-mode' }, 'Plan') : null,
    m.images?.length ? h('div', { class: 'msg-images' }, m.images.map((src) => h('img', { src, alt: 'Gambar terlampir' }))) : null,
    m.blocks?.length ? h('div', { class: 'msg-blocks' }, m.blocks.map((b) => h('span', { class: 'ai-block' }, svg(ICON.block), b.label,
      new Set(m.blocks.map((x) => pageName(x.page))).size > 1 ? h('span', { class: 'ai-block-page' }, pageName(b.page)) : null))) : null,
    m.content);
  const errorBubble = (text, code) => h('div', { class: 'msg error' },
    text,
    code === 'no_credits' && ai.credits?.topupEnabled
      ? h('button', { type: 'button', class: 'ai-topup-btn inline', onclick: () => openTopup() }, 'Isi ulang kredit')
      : null);

  function guardBusy() {
    if (!ai.busy) return false;
    toast('Tunggu AI selesai, atau tekan Stop dulu.', 'error');
    return true;
  }

  function newConversation() {
    if (guardBusy()) return;
    ai.threadId = null;
    ai.pendingCard = null;
    storage.set(`rakit.aiThread.${state.projectSlug}`, 'new');
    $('#aiMessages').replaceChildren();
    renderAiEmpty();
    autoFocus($('#aiInput'));
  }

  function renderMessage(m) {
    const box = $('#aiMessages');
    if (m.role === 'user') box.append(userBubble(m));
    else if (m.status === 'queued' || m.status === 'running') attachJob(m);
    else if (m.status === 'done') box.append(renderAiReply(m));
    else box.append(errorBubble(m.error || 'Gagal.'));
  }

  async function openThread(id) {
    let data;
    try {
      data = await api('GET', `/api/ai/threads/${id}`);
    } catch (err) {
      return toast(err.message, 'error');
    }
    ai.threadId = data.thread.id;
    ai.pendingCard = null;
    storage.set(`rakit.aiThread.${state.projectSlug}`, ai.threadId);
    $('#aiMessages').replaceChildren();
    data.messages.forEach(renderMessage);
    renderAiEmpty();
    aiScroll();
  }

  // Saat editor dibuka: lanjutkan job yang masih berjalan, atau buka percakapan terakhir.
  async function initAiHistory() {
    if (!ai.credits?.enabled) return;
    let data;
    try {
      data = await api('GET', '/api/ai/threads');
    } catch {
      return;
    }
    const saved = storage.get(`rakit.aiThread.${state.projectSlug}`, null);
    const job = data.activeJob;
    if (job && job.projectSlug !== state.projectSlug) {
      // Satu prompt berjalan per akun; beri tahu kalau sedang dipakai di project lain.
      $('#aiMessages').replaceChildren(h('div', { class: 'ai-notice' },
        `AI sedang mengerjakan prompt di project ${job.projectSlug}. `,
        h('a', { href: projectUrl(job.projectSlug) }, 'Buka project itu'),
        ' — atau tunggu selesai untuk mengirim prompt di sini.'));
    }
    const target = (job?.projectSlug === state.projectSlug ? job.threadId : null)
      ?? (saved === 'new' ? null : data.threads.find((t) => t.id === saved)?.id ?? data.threads[0]?.id);
    if (target) await openThread(target);
  }

  async function showHistoryMenu() {
    let data;
    try {
      data = await api('GET', '/api/ai/threads');
    } catch (err) {
      return toast(err.message, 'error');
    }
    const when = (ms) => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const rect = $('#aiHistory').getBoundingClientRect();
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
    ]);
    $('#ctxmenu').classList.add('history-menu');
  }

  async function clearHistory() {
    if (guardBusy()) return;
    const ok = await modal({
      title: 'Hapus semua riwayat percakapan?',
      message: 'Semua percakapan dengan AI akan dihapus permanen. File dan database proyekmu tidak ikut terhapus.',
      buttons: [{ label: 'Hapus riwayat', value: true, primary: true, danger: true }, { label: 'Batal', value: null }],
    });
    if (!ok) return;
    try {
      await api('DELETE', '/api/ai/threads');
    } catch (err) {
      return toast(err.message, 'error');
    }
    ai.threadId = null;
    ai.pendingCard = null;
    storage.set(`rakit.aiThread.${state.projectSlug}`, 'new');
    $('#aiMessages').replaceChildren();
    renderAiEmpty();
    toast('Riwayat percakapan dihapus');
  }

  // ---------- Prompt & job ----------

  // ---------- Lampiran gambar di prompt ----------
  // Gambar diperkecil di browser (sisi terpanjang 1280 px, JPEG) supaya cepat dikirim; thumbnail untuk riwayat chat.
  async function shrinkImage(file, maxSide, quality) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // latar putih untuk gambar transparan
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function addPromptImages(files) {
    const limit = ai.credits?.images;
    if (!limit) return;
    const list = [...files].filter((f) => /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(f.type));
    if (!list.length) return toast('Lampirkan file gambar (PNG, JPG, atau WEBP)', 'error');
    for (const file of list) {
      if (ai.images.length >= limit.max) {
        toast(`Maksimal ${limit.max} gambar per prompt`, 'error');
        break;
      }
      try {
        let full = await shrinkImage(file, 1280, 0.85);
        if (full.length > 2.6e6) full = await shrinkImage(file, 1024, 0.7);
        ai.images.push({ full, thumb: await shrinkImage(file, 200, 0.7) });
      } catch {
        toast(`"${file.name}" tidak bisa dibaca sebagai gambar`, 'error');
      }
    }
    renderAttachments();
    autoFocus($('#aiInput'));
  }

  function renderAttachments() {
    const box = $('#aiAttachments');
    box.hidden = !ai.images.length;
    const cost = ai.credits?.images?.cost;
    box.replaceChildren(
      ...ai.images.map((img, i) => h('span', { class: 'ai-thumb' },
        h('img', { src: img.thumb, alt: `Gambar ${i + 1}` }),
        h('button', { type: 'button', title: 'Hapus gambar', 'aria-label': 'Hapus gambar', onclick: () => { ai.images.splice(i, 1); renderAttachments(); } }, '×'))),
      ai.images.length ? h('span', { class: 'ai-attach-note' }, `Prompt dengan gambar memakai ${cost} kredit`) : '',
    );
    updateAiComposer();
  }

  function bindAiAttachments() {
    $('#aiAttach').onclick = () => {
      const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true });
      input.onchange = () => addPromptImages(input.files);
      input.click();
    };
    // Tempel screenshot langsung ke kotak prompt.
    $('#aiInput').addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length && ai.credits?.images) {
        e.preventDefault();
        addPromptImages(files);
      }
    });
    const form = $('#aiForm');
    form.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.types ?? [])].includes('Files') || !ai.credits?.images) return;
      e.preventDefault();
      form.classList.add('drop');
    });
    form.addEventListener('dragleave', () => form.classList.remove('drop'));
    form.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length || !ai.credits?.images) return;
      e.preventDefault();
      form.classList.remove('drop');
      addPromptImages(e.dataTransfer.files);
    });
  }

  async function sendPrompt() {
    const input = $('#aiInput');
    const prompt = input.value.trim();
    if (!prompt || ai.busy || ai.applying) return;
    // Prompt baru = perubahan sebelumnya yang belum dikonfirmasi dianggap disimpan (server juga begitu).
    ai.pendingCard?.markKept();

    const box = $('#aiMessages');
    box.querySelector('.ai-empty')?.remove();
    const mode = ai.mode;
    const attached = ai.images;
    const picked = pick.blocks.map((b) => ({ page: b.page, selector: b.selector, label: b.label, html: b.html, css: b.css }));
    box.append(userBubble({ mode, content: prompt, images: attached.map((i) => i.thumb), blocks: picked }));
    if (pick.on) setPick(false); // halaman akan berubah; pilih ulang untuk permintaan berikutnya
    ai.images = [];
    renderAttachments();
    input.value = '';
    autoGrow();
    aiScroll();
    ai.busy = true;
    updateAiComposer();

    let started;
    try {
      await saveAll(); // pastikan AI membaca versi terbaru
      started = await api('POST', '/api/ai/prompt', {
        prompt, mode, activePath: state.active, threadId: ai.threadId,
        ...(attached.length ? { images: attached.map((i) => i.full), thumbs: attached.map((i) => i.thumb) } : {}),
        ...(picked.length ? { blocks: picked } : {}),
      });
    } catch (err) {
      ai.busy = false;
      updateAiComposer();
      box.append(errorBubble(err.message, err.code));
      if (err.code === 'no_credits') loadCredits();
      aiScroll();
      return;
    }
    ai.threadId = started.threadId;
    storage.set(`rakit.aiThread.${state.projectSlug}`, ai.threadId);
    ai.credits = started.credits;
    renderCredits();
    attachJob(started.assistantMessage);
  }

  // ---------- Proses AI ----------
  // Yang dikerjakan AI selama job berjalan (event dari server, lihat go/internal/ai/activity.go): proses
  // berpikir, teks jawaban, dan langkah-langkahnya (menulis file — dengan isi yang sedang ditulis —, membuat
  // tabel, menghapus file). Setelah selesai diringkas jadi "Lihat proses AI" di atas jawaban.
  const STEP_LABEL = { write_file: 'Menulis', delete_file: 'Menghapus', create_table: 'Tabel', diagram: 'Menggambar diagram' };
  // scroller: elemen (atau fungsi yang mengembalikannya) yang digulir mengikuti isi baru — daftar pesan AI,
  // atau panel proses di kanvas diagram.
  function activityView(scroller = () => $('#aiMessages')) {
    const summary = h('summary', {}, 'Proses AI');
    const el = h('details', { class: 'ai-activity', open: true }, summary);
    let thinking = null;
    let say = null;
    let list = null;
    let steps = new Map(); // id -> { li, code, label }
    let count = 0;
    const started = Date.now();

    // Ikuti ke bawah hanya bila pengguna tidak sedang menggulir ke atas membaca.
    const follow = (target, run) => {
      const stick = target.scrollHeight - target.scrollTop - target.clientHeight < 40;
      run();
      if (stick) target.scrollTop = target.scrollHeight;
    };
    const append = (run) => {
      const box = typeof scroller === 'function' ? scroller() : scroller;
      return box ? follow(box, run) : run();
    };
    const ensureList = () => {
      if (!list) {
        list = h('ol', { class: 'ai-steps' });
        el.append(list);
      }
      return list;
    };

    function reset() {
      el.replaceChildren(summary);
      el.open = true;
      thinking = say = list = null;
      steps = new Map();
      count = 0;
    }

    function handle(ev) {
      if (ev.type === 'reasoning') {
        if (!thinking) {
          thinking = h('div', { class: 'ai-thinking-text' });
          el.append(h('details', { class: 'ai-thinking', open: true }, h('summary', {}, 'Proses berpikir'), thinking));
        }
        append(() => follow(thinking, () => thinking.append(ev.text)));
      } else if (ev.type === 'say') {
        if (!say) {
          say = h('div', { class: 'ai-say' });
          say.raw = '';
          el.append(say);
        }
        // Mode Plan menjawab di dalam <message>…</message>; tag-nya tidak perlu terlihat.
        say.raw += ev.text;
        append(() => { say.textContent = say.raw.replace(/<\/?message>/g, '').trim(); });
      } else if (ev.type === 'round') {
        // Model dipanggil lagi: proses berpikir & teks berikutnya mulai di paragraf baru.
        if (thinking) thinking.append('\n\n');
        say = null;
        for (const step of steps.values()) step.code?.closest('details')?.removeAttribute('open');
      } else if (ev.type === 'step') {
        let step = steps.get(ev.id);
        if (!step) {
          // Mulai menulis: proses berpikir dilipat, tempat untuk isi file yang sedang ditulis disiapkan.
          el.querySelector('.ai-thinking')?.removeAttribute('open');
          count += 1;
          const target = ev.tool === 'diagram' ? DIAGRAM_NAMES[ev.target] || ev.target : ev.target;
          const label = h('span', { class: 'ai-step-label' }, `${STEP_LABEL[ev.tool] || ev.tool} `, h('code', {}, target || '…'));
          const li = h('li', { class: 'ai-step run' });
          if (ev.tool === 'write_file' || ev.tool === 'diagram') {
            const code = h('pre', { class: 'ai-draft' });
            li.append(h('details', { open: true }, h('summary', {}, label), code));
            step = { li, code };
          } else {
            li.append(label);
            step = { li };
          }
          steps.set(ev.id, step);
          append(() => ensureList().append(li));
        }
        if (ev.state && ev.state !== 'run') {
          step.li.className = `ai-step ${ev.state}`;
          step.li.querySelector('details')?.removeAttribute('open');
          const note = ev.state === 'cancel' ? 'terputus, diulang' : ev.note;
          if (note) step.li.append(h('small', {}, ev.state === 'warn' ? `${note} — AI memperbaikinya` : note));
        }
      } else if (ev.type === 'draft') {
        const step = steps.get(ev.id);
        if (step?.code) append(() => follow(step.code, () => step.code.append(ev.text)));
      } else if (ev.type === 'note') {
        append(() => ensureList().append(h('li', { class: 'ai-step note' }, ev.text)));
      }
    }

    // Selesai: dilipat jadi ringkasan; dibuang bila tidak ada yang bisa dilihat (model tanpa proses berpikir).
    function finish() {
      if (el.children.length <= 1) return el.remove();
      const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      summary.textContent = `Lihat proses AI · ${count ? `${count} langkah · ` : ''}${secs} dtk`;
      el.open = false;
      el.querySelectorAll('details').forEach((d) => d.removeAttribute('open'));
    }

    return { el, reset, handle, finish };
  }

  // Ikuti progres job di server. Koneksi yang putus disambung lagi; job tetap jalan di server.
  async function attachJob(message) {
    const box = $('#aiMessages');
    ai.busy = true;
    ai.jobId = message.id;
    updateAiComposer();

    const status = h('span', {}, 'Menyiapkan…');
    // Status diperbarui tiap detik sesuai fase: antre → berpikir → menulis (atau menunggu coba ulang).
    const started = message.createdAt || Date.now();
    let phase = { kind: 'prepare' };
    const renderStatus = () => {
      const secs = Math.max(0, Math.round((Date.now() - started) / 1000));
      status.textContent = {
        prepare: () => 'Menyiapkan…',
        vision: () => `AI sedang melihat gambar… ${secs} dtk`,
        queued: () => `Menunggu antrean AI… posisi ${phase.position} dari ${phase.total}`,
        thinking: () => `AI sedang berpikir… ${secs} dtk`,
        writing: () => `Menulis kode… ${(phase.chars / 1000).toFixed(1)}k karakter`,
        retry: () => `AI sedang sibuk, mencoba lagi (${phase.attempt}/${phase.max})…`,
      }[phase.kind]();
    };
    const statusTimer = setInterval(renderStatus, 1000);
    const setPhase = (next) => { phase = next; renderStatus(); };
    const stopBtn = h('button', { class: 'stop', type: 'button' }, 'Stop');
    stopBtn.onclick = async () => {
      stopBtn.disabled = true;
      stopBtn.textContent = 'Menghentikan…';
      await api('POST', `/api/ai/jobs/${message.id}/cancel`).catch((err) => toast(err.message, 'error'));
    };
    const loading = h('div', { class: 'msg loading' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), status, stopBtn);
    const activity = activityView();
    box.append(activity.el, loading);
    aiScroll();

    let final = null;
    for (let attempt = 0; attempt < 30 && !final; attempt++) {
      ai.stream = new AbortController();
      try {
        const res = await fetch(`/api/ai/jobs/${message.id}/events`, { credentials: 'same-origin', signal: ai.stream.signal });
        if (res.status === 401) {
          location.href = HOME;
          return;
        }
        if (!res.ok) throw new Error(`Gagal (${res.status})`);
        activity.reset(); // server mengirim ulang semua event sejak awal job
        for await (const event of readEvents(res)) {
          activity.handle(event);
          if (event.credits) { ai.credits = event.credits; renderCredits(); }
          if (event.type === 'vision') setPhase({ kind: 'vision' });
          else if (event.type === 'queued') setPhase({ kind: 'queued', position: event.position, total: event.total });
          else if (event.type === 'running' || (event.type === 'thinking' && phase.kind !== 'writing')) setPhase({ kind: 'thinking' });
          else if (event.type === 'retry') setPhase({ kind: 'retry', attempt: event.attempt, max: event.max });
          else if (event.type === 'progress') setPhase({ kind: 'writing', chars: event.chars });
          else if (event.type === 'done' || event.type === 'error') final = event;
        }
      } catch { /* koneksi putus: sambung lagi di bawah */ }
      if (!final) await new Promise((r) => setTimeout(r, Math.min(1000 * (attempt + 1), 5000)));
    }

    clearInterval(statusTimer);
    loading.remove();
    activity.finish();
    ai.busy = false;
    ai.jobId = null;
    ai.stream = null;
    if (!final) {
      box.append(errorBubble('Koneksi ke server terputus. Muat ulang halaman untuk melihat hasilnya.'));
    } else if (final.type === 'done') {
      box.append(renderAiReply(final.message));
      if (final.touched?.length) await syncFromServer(final.touched, { openFirst: true });
    } else {
      box.append(errorBubble(final.error));
    }
    updateAiComposer();
    aiScroll();
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
    }
    renderTabs();
    renderTree();
    const first = paths.find((p) => state.entries.some((e) => e.path === p && e.type === 'file'));
    if (openFirst && first) {
      expandTo(first);
      await openFile(first);
    }
    if (!$('#dataView').hidden) dbLoad();
    reloadPreview();
  }

  // Markdown sederhana (judul, list, **tebal**, `kode`, blok kode) dirender lewat DOM, tanpa innerHTML.
  function inlineMd(text) {
    return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => {
      if (part.startsWith('`') && part.endsWith('`')) return h('code', {}, part.slice(1, -1));
      if (part.startsWith('**') && part.endsWith('**')) return h('strong', {}, part.slice(2, -2));
      return part;
    });
  }

  function renderMarkdown(text) {
    const out = h('div', { class: 'md' });
    const lines = text.split('\n');
    let list = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('```')) {
        const code = [];
        while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
        out.append(h('pre', {}, h('code', {}, code.join('\n'))));
        list = null;
        continue;
      }
      if (line.trim().startsWith('|')) {
        const rows = [];
        for (; i < lines.length && lines[i].trim().startsWith('|'); i++) {
          const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
          if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells); // lewati baris pemisah |---|
        }
        i--;
        if (!rows.length) continue;
        const [headRow, ...bodyRows] = rows;
        out.append(h('div', { class: 'md-table' }, h('table', {},
          h('thead', {}, h('tr', {}, headRow.map((c) => h('th', {}, inlineMd(c))))),
          h('tbody', {}, bodyRows.map((r) => h('tr', {}, r.map((c) => h('td', {}, inlineMd(c)))))))));
        list = null;
        continue;
      }
      const heading = line.match(/^#{1,6}\s+(.*)/);
      const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
      if (heading) {
        out.append(h('p', { class: 'md-h' }, inlineMd(heading[1])));
        list = null;
      } else if (item) {
        if (!list) out.append((list = h('ul')));
        list.append(h('li', {}, inlineMd(item[1])));
      } else if (line.trim()) {
        out.append(h('p', {}, inlineMd(line)));
        list = null;
      } else {
        list = null;
      }
    }
    return out;
  }

  function renderAiReply(m) {
    const wrap = h('div', { class: 'msg assistant' }, renderMarkdown(m.content || 'Selesai.'));
    if (m.mode === 'plan') {
      wrap.classList.add('plan');
      wrap.prepend(h('div', { class: 'plan-label' }, 'Rencana'));
      const runBtn = h('button', { type: 'button', class: 'plan-run' }, '▶ Jalankan rencana ini');
      runBtn.onclick = () => {
        if (ai.busy) return;
        runBtn.disabled = true;
        runBtn.textContent = 'Dijalankan di mode Builder';
        setAiMode('build');
        $('#aiInput').value = 'Jalankan rencana di atas.';
        sendPrompt();
      };
      wrap.append(runBtn);
      return wrap;
    }
    if (!m.changes.length) return wrap;

    const kind = (c) => (c.action === 'table' ? 'table' : c.action === 'delete' ? 'delete' : m.before[c.path] == null ? 'new' : 'edit');
    const label = { new: 'baru', edit: 'ubah', delete: 'hapus', table: 'tabel' };
    const actions = h('div', { class: 'changes-actions' });
    const card = h('div', { class: 'changes' },
      h('div', { class: 'changes-head' }, h('span', {}, `${m.changes.length} perubahan`)),
      m.changes.map((c) => (c.action === 'table'
        ? h('button', {
          type: 'button',
          class: 'change-row',
          title: 'Buka di editor database',
          onclick: () => { db.active = c.name; setMode('data'); },
        },
        h('span', { class: 'badge table' }, label.table),
        h('span', { class: 'path' }, `${c.name} (${c.columns.map((col) => col.name).join(', ')})`),
        h('span', { class: 'view' }, 'buka'))
        : h('button', {
          type: 'button',
          class: 'change-row',
          title: c.action === 'delete' ? c.path : 'Lihat perubahan',
          onclick: () => (c.action === 'delete' ? null : showDiff(c, m.before[c.path] ?? '')),
        },
        h('span', { class: `badge ${kind(c)}` }, label[kind(c)]),
        h('span', { class: 'path' }, c.path),
        c.action === 'delete' ? null : h('span', { class: 'view' }, 'lihat')))),
      actions);
    const setStatus = (text, cls = '') => actions.replaceChildren(h('span', { class: `changes-status ${cls}` }, text));
    const STATES = {
      kept: () => setStatus('✓ Perubahan disimpan'),
      reverted: () => setStatus('↩ Dibatalkan — file dikembalikan ke versi sebelumnya', 'muted'),
      failed: () => setStatus(m.error || 'Gagal menerapkan perubahan. File dikembalikan seperti semula.', 'error'),
    };

    if (m.applyState !== 'pending') {
      STATES[m.applyState]?.();
      wrap.append(card);
      return wrap;
    }

    // Perubahan sudah diterapkan server (preview sudah berubah); tunggu Simpan atau Batalkan.
    const keepBtn = h('button', { type: 'button', class: 'apply' }, '✓ Simpan');
    const revertBtn = h('button', { type: 'button' }, 'Batalkan');
    const pendingCard = {
      markKept() {
        STATES.kept();
        if (ai.pendingCard === pendingCard) ai.pendingCard = null;
      },
    };
    ai.pendingCard = pendingCard;
    const settle = async (action) => {
      keepBtn.disabled = revertBtn.disabled = true;
      if (action === 'revert') revertBtn.textContent = 'Mengembalikan…';
      ai.applying = true;
      updateAiComposer();
      try {
        const res = await api('POST', `/api/ai/messages/${m.id}/${action}`);
        if (ai.pendingCard === pendingCard) ai.pendingCard = null;
        STATES[res.message.applyState]?.();
        if (action === 'revert') await syncFromServer(res.touched);
      } catch (err) {
        toast(err.message, 'error');
        keepBtn.disabled = revertBtn.disabled = false;
        revertBtn.textContent = 'Batalkan';
      } finally {
        ai.applying = false;
        updateAiComposer();
      }
    };
    keepBtn.onclick = () => settle('keep');
    revertBtn.onclick = () => settle('revert');
    actions.replaceChildren(
      h('span', { class: 'changes-question' }, 'Perubahan sudah tampil di preview. Simpan perubahan ini?'),
      keepBtn,
      revertBtn,
    );
    wrap.append(card);
    return wrap;
  }

  // `before` = isi file sebelum perubahan AI ('' untuk file baru).
  // caption: keterangan opsional di bawah judul (mis. kiri = versi lama, kanan = sekarang).
  async function showDiff(change, before, caption) {
    try {
      await editorReady;
    } catch {
      return toast('Editor kode gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
    }
    const root = $('#modal');
    const body = h('div', { class: 'diff-body' });
    let diffEditor;
    const close = () => {
      diffEditor?.getModel()?.original.dispose();
      diffEditor?.getModel()?.modified.dispose();
      diffEditor?.dispose();
      root.hidden = true;
      root.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

    root.replaceChildren(h('div', { class: 'modal diff-modal' },
      h('div', { class: 'diff-head' },
        h('div', {}, h('h3', {}, change.path), caption ? h('p', { class: 'diff-caption' }, caption) : null),
        h('button', { class: 'icon-btn', title: 'Tutup', onclick: close }, svg(ICON.close))),
      body));
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);

    const language = { html: 'html', css: 'css', js: 'javascript' }[extOf(change.path)];
    diffEditor = monaco.editor.createDiffEditor(body, {
      theme: monacoTheme(),
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: body.clientWidth > 700,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
    });
    diffEditor.setModel({
      original: monaco.editor.createModel(before, language),
      modified: monaco.editor.createModel(change.content, language),
    });
  }

  function autoGrow() {
    const input = $('#aiInput');
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }

  function bindAiEvents() {
    document.querySelectorAll('[data-ai-mode]').forEach((btn) => {
      btn.onclick = () => { setAiMode(btn.dataset.aiMode); autoFocus($('#aiInput')); };
    });
    setAiMode(ai.mode);
    document.querySelectorAll('.mode-switch [data-mode]').forEach((btn) => {
      btn.onclick = () => setMode(btn.dataset.mode);
    });
    $('#aiReset').onclick = newConversation;
    $('#aiHistory').onclick = showHistoryMenu;
    $('#aiClear').onclick = clearHistory;
    document.querySelectorAll('.mobile-nav [data-view]').forEach((btn) => {
      btn.onclick = () => setMobileView(btn.dataset.view);
    });
    setMobileView(document.body.dataset.mobileView || 'editor');
    mobileQuery.addEventListener('change', applyResponsiveEditor);
    $('#dbNewTable').onclick = () => openDialog(CreateTableDialog);
    $('#aiCredits').onclick = () => openTopup();
    $('#planBadge').onclick = () => openTopup('plans');
    $('#aiTopupBtn').onclick = () => openTopup();
    $('#aiForm').onsubmit = (e) => { e.preventDefault(); sendPrompt(); };
    bindAiAttachments();
    const input = $('#aiInput');
    input.addEventListener('input', () => { autoGrow(); updateAiComposer(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendPrompt();
      }
    });
  }

  // ---------- Database (mode Data) ----------
  // Tab Data: komponen Svelte di assets-source/editor/database, dipasang ke kerangka #dataView di editor.html saat
  // tab pertama kali dibuka. Keadaannya (db) dipakai bersama lewat database/state.svelte.js.
  let dbMounted = false;
  function dbLoad() {
    if (!dbMounted) {
      dbMounted = true;
      const context = editorContext();
      connectDb(context.get('editor'));
      mount(TableList, { target: $('#dbTableList'), context });
      mount(DbUsage, { target: $('#dbUsage'), context });
      mount(DbMain, { target: $('#dbMain'), context });
    }
    return loadDb();
  }

  // Modal kosong (dialog vanilla: pengaturan, info fitur, diagram). Mengembalikan elemen isi dan fungsi tutup.
  function openPanel(className) {
    const root = $('#modal');
    const body = h('div', { class: `modal ${className}` });
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    function close() {
      root.hidden = true;
      root.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
    }
    root.replaceChildren(body);
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);
    return { body, close };
  }

  // ---------- Diagram (UML, ERD, peta halaman, alur data) ----------
  // Tab Diagram: komponen Svelte di assets-source/editor/diagram (keadaan & aksi di state.svelte.js), dipasang saat
  // tab pertama kali dibuka. Mermaid dimuat dari CDN saat pertama dipakai, dengan tema mengikuti tema editor.
  const loadMermaid = () => loadMermaidFor(isDark());
  let diagramMounted = false;
  function diagramLoad() {
    if (!diagramMounted) {
      diagramMounted = true;
      const context = editorContext();
      connectDiagram(context.get('editor'));
      mount(DiagramView, { target: $('#diagramView'), context });
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


  function updateFlowButton() {
    const btn = $('#flowBtn');
    btn.hidden = !canFlow(state.active);
    btn.classList.toggle('active', flow.open);
    btn.setAttribute('aria-pressed', String(flow.open));
  }

  function toggleFlow(force = !flow.open) {
    flow.open = force;
    $('#flowPanel').hidden = !flow.open;
    $('#codeView').classList.toggle('with-flow', flow.open);
    storage.set('rakit.flowOpen', flow.open);
    stopFlowPlay();
    if (flow.open) {
      mountFlowPanel();
      flowFollow(true);
    } else {
      applyFlowHighlight();
    }
    updateFlowButton();
  }

  // Panel mengikuti file aktif: muat penjelasan tersimpan (tanpa AI) bila ganti file.
  async function flowFollow(force = false) {
    updateFlowButton();
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
  let flowApp;
  function mountFlowPanel() {
    flowApp ??= mount(FlowPanel, {
      target: $('#flowPanel'),
      context: editorContext(),
      props: {
        actions: {
          explain: explainFlow,
          select: selectFlowStep,
          stopPlay: stopFlowPlay,
          togglePlay: toggleFlowPlay,
          close: () => toggleFlow(false),
          goBack: flowGoBack,
          openRef: openFlowRef,
          flashLines: flashFlowLines,
          ask: askFlow,
          toggleWide: () => $('#flowPanel').classList.toggle('wide'),
          saveShowChart: (open) => { flow.showChart = open; storage.set('rakit.flowChart', open); },
        },
      },
    });
  }

  // Dulu menggambar ulang panel; kini tinggal efek sampingnya: putaran otomatis berhenti dan sorotan di editor
  // diperbarui (digulir ke langkah aktif bila penjelasannya tampil).
  function renderFlow() {
    if (!flow.open) return;
    stopFlowPlay();
    applyFlowHighlight({ reveal: Boolean(flow.path && flow.loading !== flow.path && flowSteps().length) });
  }

  // "baris 12" / "baris 12–20" (versi Inggris: "line 12" / "lines 12–20") di jawaban AI → bisa diklik untuk menyorot baris itu.
  function linkifyLines(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = node.textContent.split(/((?:baris|lines?)\s+\d+(?:\s*[-–]\s*\d+)?)/gi);
      if (parts.length < 2) continue;
      node.replaceWith(...parts.map((part) => {
        const m = part.match(/^(?:baris|lines?)\s+(\d+)(?:\s*[-–]\s*(\d+))?$/i);
        if (!m) return part;
        return h('button', { type: 'button', class: 'flow-line-link', onclick: () => flashFlowLines(Number(m[1]), Number(m[2] || m[1])) }, part);
      }));
    }
    return root;
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
    $('#flowBtn').addEventListener('click', () => toggleFlow());
    // ← / → di panel (bukan saat mengetik pertanyaan) untuk pindah langkah; Esc menutup panel.
    $('#flowPanel').addEventListener('keydown', (e) => {
      if (e.target.closest('textarea, input')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stopFlowPlay(); selectFlowStep(flow.step + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stopFlowPlay(); selectFlowStep(flow.step - 1); }
      if (e.key === 'Escape') toggleFlow(false);
    });
    editorReady.then(() => {
      editor.onDidChangeCursorPosition(flowSyncFromCursor);
      if (storage.get('rakit.flowOpen', false)) toggleFlow(true);
    }).catch(() => { /* pesan sudah ditampilkan */ });
  }

  // ---------- Console ----------
  // Tab Console: assets-source/editor/console (log & saringan di state.svelte.js, tampilan Console.svelte). Log dari
  // preview diterima sejak awal, jadi sambungannya disiapkan saat log pertama tiba.
  let consoleConnected = false;
  let consoleApp;
  const consoleActive = () => $('#editorArea').dataset.mode === 'console';
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
    consoleApp ??= mount(ConsoleTab, { target: $('#consoleView'), context: editorContext() });
    openConsole();
  }
  // Lencana jumlah error baru di tombol tab Console.
  function renderConsoleBadge(unread) {
    const badge = $('#consoleBadge');
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.title = `${unread} error baru`;
  }

  // ---------- Fungsi serverless ----------
  // Tab Fungsi: komponen Svelte assets-source/editor/functions/Functions.svelte, dipasang sekali lalu dimuat
  // ulang setiap tab dibuka.
  let fnApp;
  function fnLoad() {
    fnApp ??= mount(Functions, { target: $('#fnView'), context: editorContext() });
    fnApp.load();
  }

  // ---------- Riwayat versi ----------
  // Tab Riwayat: komponen Svelte assets-source/editor/history/History.svelte, dipasang saat pertama dibuka.
  let historyApp;
  const historyView = () => (historyApp ??= mount(History, { target: $('#historyView'), context: editorContext() }));

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
    let app;
    const close = () => {
      if (!app) return;
      unmount(app);
      app = null;
      root.classList.remove('promo-backdrop');
      root.hidden = true;
      root.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

    root.replaceChildren();
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);
    app = mount(Topup, {
      target: root,
      props: {
        tab,
        intro,
        api,
        showAssistant: SHOW_ASSISTANT,
        icons: { close: ICON.close, spark: SPARK },
        onCredits: (credits) => { ai.credits = credits; renderCredits(); },
        onPlanPaid: () => loadTree().catch(() => {}), // perbarui kuota storage di sidebar
        onUseAI: () => { close(); setMode('ai'); },
        onAfter: () => { close(); after?.(); },
        // Promosi memakai modal lebar di tengah layar.
        onPromo: (on) => root.classList.toggle('promo-backdrop', on),
        onClose: close,
      },
    });
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
    renderProjectInfo();
    refreshPublish();
    $('#avatarBtn').textContent = state.me.username[0];
    $('#statusUser').textContent = 'HTML · CSS · JS';

    $('#toggleSidebar').classList.add('active');
    $('#togglePreview').classList.add('active');
    if (storage.get('rakit.previewHidden', false) && !isSimple()) togglePreview();
    setLayout(isSimple() ? 'simple' : 'coding');
    setDevice(storage.get('rakit.device', 'desktop'));
    initSplitters();
    bindEvents();
    bindAiEvents();
    bindFlowEvents();
    bindFeatureInfo();
    const credits = loadCredits();

    await loadTree();
    reloadPreview();
    // Editor dibuka di mode AI, kecuali user sudah pindah tab selama editor masih dimuat (mis. ke Diagram).
    if ($('#editorArea').dataset.mode === 'ai') setMode('ai');
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
