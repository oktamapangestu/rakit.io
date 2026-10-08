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
      location.href = '/';
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
  const toPicker = (message) => $('#previewFrame').contentWindow?.postMessage({ rakit: true, ...message }, siteOrigin());
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
    if (!dbState.tables.length) {
      try {
        dbState.tables = (await api('GET', '/api/database/tables')).tables;
      } catch { /* tanpa tabel: asal dari database tidak dipakai */ }
    }
    return dbState.tables;
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
      if ($('#editorArea').dataset.mode === 'data' && dbState.active === target.table) dbLoadRows();
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
    if (diagram.saved && $('#editorArea').dataset.mode === 'diagram') renderDiagram(); // warna Mermaid ikut tema
  }

  function openSettings() {
    const { body, close } = openPanel('db-modal settings-modal');
    const complete = h('input', { type: 'checkbox', checked: settings.complete,
      onchange: () => { setAutocomplete(complete.checked); toast(complete.checked ? 'Prediksi kode aktif' : 'Prediksi kode dimatikan'); } });
    const themeBtn = (value, label) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String((value === 'dark') === isDark()),
      onclick: (e) => {
        setTheme(value);
        e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget)));
      },
    }, h('span', { class: `theme-swatch ${value}` }), label);
    body.append(
      h('h3', {}, 'Pengaturan'),
      h('div', { class: 'settings-group' },
        h('h4', {}, 'Tampilan'),
        h('div', { class: 'theme-choice', role: 'radiogroup', 'aria-label': 'Tema' }, themeBtn('light', 'Terang'), themeBtn('dark', 'Gelap'))),
      h('div', { class: 'settings-group' },
        h('h4', {}, 'Editor kode'),
        h('label', { class: 'switch asst-switch settings-row' }, complete, h('span', { class: 'track' }, h('span', { class: 'thumb' })),
          h('span', {}, h('strong', {}, 'Prediksi kode otomatis (AI)'),
            h('small', {}, 'Saat berhenti mengetik, AI menebak lanjutan kode dalam teks abu-abu. Tekan Tab untuk menerima, Esc atau lanjut mengetik untuk mengabaikan. Gratis, tidak memakai kredit.')))),
      h('p', { class: 'settings-note' }, 'Pengaturan disimpan di browser ini.'),
      h('div', { class: 'modal-buttons' }, h('button', { type: 'button', class: 'primary', onclick: close }, 'Selesai')));
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
    location.href = '/';
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
    return `/editor?project=${encodeURIComponent(slug)}`;
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
  const hostOf = (url) => url.replace(/^https?:\/\//, '');

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
    const agree = h('input', { type: 'checkbox' });
    const go = h('button', { type: 'button', class: 'primary' }, 'Publikasikan');
    go.disabled = !st.pending || st.destructive;
    agree.onchange = () => { go.disabled = !agree.checked; };
    const MARK = { added: ['+', 'baru'], changed: ['~', 'diubah'], removed: ['−', 'dihapus'] };
    const close = openSheet('publish-modal', 'Publikasikan website', (done) => [
      h('h3', {}, 'Publikasikan ke website publik'),
      h('p', { class: 'pub-lead' }, st.pending
        ? ['Perubahan di versi dev akan tayang di ', h('strong', {}, hostOf(st.siteUrl)), '.']
        : ['Website publik ', h('strong', {}, hostOf(st.siteUrl)), ' sudah sama dengan versi dev.']),
      st.files.length ? h('h4', {}, `File (${st.files.length})`) : null,
      st.files.length ? h('ul', { class: 'pub-list' }, st.files.map((f) => h('li', { class: `pub-file ${f.change}` },
        h('span', { class: 'pub-mark' }, MARK[f.change][0]), h('code', {}, f.path), h('span', { class: 'pub-what' }, MARK[f.change][1])))) : null,
      st.schema.length ? h('h4', {}, 'Struktur database') : null,
      st.schema.length ? h('ul', { class: 'pub-list' }, st.schema.map((c) => h('li', { class: `pub-schema${c.destructive ? ' destructive' : ''}` }, c.destructive ? '⚠️ ' : '', c.text))) : null,
      st.pending ? h('p', { class: 'pub-note' }, 'Data hasil uji coba di versi dev tidak ikut; data dan gambar kiriman pengunjung di website publik tetap aman.') : null,
      st.destructive ? h('label', { class: 'pub-confirm' }, agree, 'Saya mengerti: data di tabel/kolom yang dihapus akan hilang dari website publik.') : null,
      h('div', { class: 'modal-buttons' },
        h('button', { type: 'button', class: 'link-btn pub-mode', onclick: () => { done(); openPublishMode(); } }, 'Ubah mode publikasi'),
        go,
        h('button', { type: 'button', onclick: done }, 'Tutup')),
    ]);
    go.onclick = async () => {
      go.disabled = true;
      go.textContent = 'Mempublikasikan…';
      try {
        pub.status = (await api('POST', '/api/publish', { confirm: agree.checked })).publish;
        renderPublish();
        close();
        toast(`Dipublikasikan ke ${hostOf(st.siteUrl)}`);
      } catch (err) {
        toast(err.message, 'error');
        go.disabled = false;
        go.textContent = 'Publikasikan';
      }
    };
  }

  function openPublishMode() {
    const current = isManual() ? 'manual' : 'live';
    let chosen = current;
    const slug = state.project.slug;
    const devHost = hostOf(state.project.siteUrl).replace(`${slug}.`, `${slug}--dev.`);
    const agree = h('input', { type: 'checkbox' });
    const warn = h('div', { class: 'pub-warn', hidden: true },
      h('p', {}, 'Perubahan yang belum dipublikasikan akan langsung tayang, dan data uji coba di versi dev diganti data asli dari website publik.'),
      h('label', { class: 'pub-confirm' }, agree, 'Saya mengerti'));
    const apply = h('button', { type: 'button', class: 'primary' }, 'Terapkan');
    const sync = () => {
      document.querySelectorAll('.mode-option').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === chosen)));
      warn.hidden = !(current === 'manual' && chosen === 'live');
      apply.disabled = chosen === current || (!warn.hidden && !agree.checked);
    };
    agree.onchange = sync;
    const option = (mode, title, text) => h('button', { type: 'button', role: 'radio', class: 'mode-option', dataset: { mode }, onclick: () => { chosen = mode; sync(); } },
      h('strong', {}, title), h('span', {}, text));
    const close = openSheet('publish-modal', 'Mode publikasi', (done) => [
      h('h3', {}, 'Mode publikasi'),
      h('div', { class: 'mode-options', role: 'radiogroup' },
        option('live', 'Langsung tayang', `Setiap perubahan langsung terlihat di ${hostOf(state.project.siteUrl)}. Cocok untuk belajar dan mencoba-coba.`),
        option('manual', 'Publikasi manual (dev/prod)', `Kamu mengedit versi dev di ${devHost} (bisa dibagikan untuk minta pendapat). Website publik baru berubah saat kamu menekan Publikasikan. Database dev terpisah untuk uji coba.`)),
      warn,
      h('div', { class: 'modal-buttons' }, apply, h('button', { type: 'button', onclick: done }, 'Batal')),
    ]);
    sync();
    apply.onclick = async () => {
      apply.disabled = true;
      try {
        await saveAll();
        const res = await api('PUT', '/api/publish/mode', { mode: chosen, confirm: agree.checked });
        close();
        applyProject(res.project);
        pub.status = res.publish;
        renderPublish();
        toast(chosen === 'manual' ? 'Publikasi manual aktif: edit di versi dev, lalu tekan Publikasikan' : 'Website kembali langsung tayang');
      } catch (err) {
        toast(err.message, 'error');
        sync();
      }
    };
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
  const SPARK = 'M8 0l1.6 4.4L14 6l-4.4 1.6L8 12 6.4 7.6 2 6l4.4-1.6zM13 10l.8 2.2L16 13l-2.2.8L13 16l-.8-2.2L10 13l2.2-.8z';
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
  // mengisi kotak AI dengan permintaan beserta konteksnya. Log/kode panjang dipotong.
  const clipText = (text, max = 1500) => {
    const t = String(text ?? '').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  };
  function aiButton(label, text, { cls = 'fn-btn', mode = 'build' } = {}) {
    return h('button', {
      type: 'button', class: `${cls} ai-handoff`,
      title: `Isi kotak AI (${mode === 'plan' ? 'Plan' : 'Builder'}) dengan permintaan ini — bisa diubah dulu sebelum dikirim`,
      onclick: (e) => { e.stopPropagation(); askAi(typeof text === 'function' ? text() : text, mode); },
    }, h('span', { class: 'ai-spark', 'aria-hidden': 'true' }, '✦'), label);
  }
  // Permintaan perbaikan untuk eksekusi fungsi yang gagal (dari log atau uji coba).
  function fnFixPrompt(name, { status, error, logs, trigger, request }) {
    const info = [status ? `status ${status}` : '', trigger ? `dipicu ${trigger}` : ''].filter(Boolean).join(', ');
    const parts = [`Fungsi functions/${name}.js gagal${info ? ` (${info})` : ''}. Cari penyebabnya dan perbaiki kodenya.`];
    if (request) parts.push(`Request:\n${request}`);
    if (error) parts.push(`Error:\n${clipText(error)}`);
    if (logs) parts.push(`console:\n${clipText(logs)}`);
    return parts.join('\n\n');
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
    $('#historyBack').onclick = () => setHistoryDetail(false);
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
      setHistoryDetail(false);
      historyLoad();
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
  const STEP_LABEL = { write_file: 'Menulis', delete_file: 'Menghapus', create_table: 'Tabel' };
  function activityView() {
    const box = $('#aiMessages');
    const summary = h('summary', {}, 'Proses AI');
    const el = h('details', { class: 'ai-activity', open: true }, summary);
    let thinking = null;
    let say = null;
    let list = null;
    let steps = new Map(); // id -> { li, code, label }
    let count = 0;
    const started = Date.now();

    // Ikuti ke bawah hanya bila pengguna tidak sedang menggulir ke atas membaca.
    const follow = (scroller, run) => {
      const stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
      run();
      if (stick) scroller.scrollTop = scroller.scrollHeight;
    };
    const append = (run) => follow(box, run);
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
          const label = h('span', { class: 'ai-step-label' }, `${STEP_LABEL[ev.tool] || ev.tool} `, h('code', {}, ev.target || '…'));
          const li = h('li', { class: 'ai-step run' });
          if (ev.tool === 'write_file') {
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
          location.href = '/';
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
          onclick: () => { dbState.active = c.name; setMode('data'); },
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
    $('#dbNewTable').onclick = openCreateTable;
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
  const DB_TYPES = { text: 'Teks', number: 'Angka', boolean: 'Ya/Tidak', date: 'Tanggal', reference: 'Relasi', image: 'Gambar' };
  const DB_OPS = [
    ['list', 'Lihat daftar'],
    ['view', 'Lihat satu baris'],
    ['create', 'Tambah'],
    ['update', 'Ubah'],
    ['delete', 'Hapus'],
  ];
  const DB_PAGE = 50;
  const dbState = { tables: [], usage: null, active: null, rows: [], total: 0, offset: 0 };
  const activeTable = () => dbState.tables.find((t) => t.name === dbState.active);
  const tableUrl = (name) => `/api/database/tables/${encodeURIComponent(name)}`;

  async function dbLoad() {
    schedulePublishCheck(); // struktur tabel bisa berubah
    try {
      const data = await api('GET', '/api/database/tables');
      dbState.tables = data.tables;
      dbState.usage = data.usage;
    } catch (err) {
      return toast(err.message, 'error');
    }
    if (!activeTable()) {
      dbState.active = dbState.tables[0]?.name ?? null;
      dbState.offset = 0;
    }
    renderDbSidebar();
    await dbLoadRows();
  }

  async function dbLoadRows() {
    const t = activeTable();
    if (t) {
      try {
        const data = await api('GET', `${tableUrl(t.name)}/rows?limit=${DB_PAGE}&offset=${dbState.offset}`);
        dbState.rows = data.rows;
        dbState.total = data.total;
      } catch (err) {
        toast(err.message, 'error');
        dbState.rows = [];
        dbState.total = 0;
      }
    }
    renderDbMain();
  }

  function selectDbTable(name) {
    dbState.active = name;
    dbState.offset = 0;
    renderDbSidebar();
    dbLoadRows();
  }

  function renderDbSidebar() {
    $('#dbTableList').replaceChildren(...(dbState.tables.length
      ? dbState.tables.map((t) => h('button', {
        type: 'button',
        class: `db-table-item${t.name === dbState.active ? ' active' : ''}`,
        onclick: () => selectDbTable(t.name),
      }, svg(ICON.table), h('span', { class: 'name' }, t.name), h('span', { class: 'count' }, String(t.rowCount))))
      : [h('div', { class: 'db-empty-list' }, 'Belum ada tabel')]));
    const u = dbState.usage;
    if (u) {
      $('#dbUsage').replaceChildren(
        `${formatBytes(u.bytes)} / ${formatBytes(u.limits.bytes)} · ${u.tables}/${u.limits.tables} tabel`,
        h('div', { class: 'usage-bar' }, h('div', { style: `width:${Math.min(100, (u.bytes / u.limits.bytes) * 100)}%` })),
      );
    }
  }

  function formatDbValue(column, value) {
    if (value === null || value === undefined || value === '') return h('span', { class: 'null' }, '—');
    if (column.name === 'created_at') {
      return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    }
    if (column.type === 'boolean') return value ? 'Ya' : 'Tidak';
    // decoding async: gambar asli (bisa beberapa MB) di-decode di luar thread utama, tidak menahan UI.
    if (column.type === 'image') return h('img', { class: 'db-thumb', src: dbImageSrc(value), alt: column.name, loading: 'lazy', decoding: 'async', width: 40, height: 40 });
    return String(value);
  }

  // ---------- Kolom gambar ----------
  // Nilai kolom image = alamat file ("/uploads/..." di website ini) atau URL https.
  const dbImageSrc = (value) => (String(value).startsWith('/') ? `${previewBase()}${value}` : String(value));

  async function uploadDbImage(t, column, file) {
    const res = await fetch(`${tableUrl(t.name)}/upload?column=${encodeURIComponent(column.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', ...(state.projectSlug ? { 'X-Project': state.projectSlug } : {}) },
      body: file,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
    return data.url;
  }

  // Isian gambar: pratinjau + upload file + (opsional) alamat URL. getValue() → alamat atau ''.
  function imageField(t, column, value = '') {
    let current = value || '';
    const preview = h('div', { class: 'db-img-preview' });
    const urlInput = h('input', { type: 'text', placeholder: 'atau tempel alamat https://…', value: current.startsWith('/') ? '' : current });
    const status = h('span', { class: 'db-img-status' });
    const render = () => preview.replaceChildren(current
      ? h('img', { src: dbImageSrc(current), alt: column.name })
      : h('span', { class: 'null' }, 'Belum ada gambar'));
    const pick = () => {
      const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml' });
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        status.textContent = 'Mengupload…';
        try {
          current = await uploadDbImage(t, column, file);
          urlInput.value = '';
          status.textContent = 'Terupload ✓';
          render();
        } catch (err) {
          status.textContent = '';
          toast(err.message, 'error');
        }
      };
      input.click();
    };
    urlInput.oninput = () => { current = urlInput.value.trim(); render(); };
    render();
    const el = h('div', { class: 'db-img-field' },
      preview,
      h('div', { class: 'db-img-actions' },
        h('button', { type: 'button', class: 'db-btn', onclick: pick }, current ? 'Ganti gambar…' : 'Upload gambar…'),
        h('button', { type: 'button', class: 'db-btn', onclick: () => { current = ''; urlInput.value = ''; status.textContent = ''; render(); } }, 'Kosongkan'),
        status),
      urlInput);
    return { el, getValue: () => current };
  }

  function editDbImage(t, row, column) {
    const { body, close } = openPanel('db-modal');
    const field = imageField(t, column, row[column.name] ?? '');
    body.append(h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await saveDbCell(t, row, column, field.getValue() || null);
          close();
        } catch { /* pesan error sudah ditampilkan */ }
      },
    },
    h('h3', {}, `Gambar "${column.name}" · baris #${row.id}`),
    field.el,
    h('div', { class: 'modal-buttons' },
      h('button', { type: 'button', onclick: close }, 'Batal'),
      h('button', { type: 'submit', class: 'primary' }, 'Simpan'))));
  }

  function renderDbMain() {
    const main = $('#dbMain');
    const t = activeTable();
    if (!t) {
      main.replaceChildren(h('div', { class: 'db-empty' },
        h('div', { class: 'db-empty-icon' }, svg(ICON.table)),
        h('h3', {}, 'Belum ada tabel'),
        h('p', {}, 'Tabel menyimpan data dari websitemu — misalnya ucapan tamu, RSVP, atau pesan dari form kontak.'),
        h('button', { type: 'button', class: 'db-btn primary', onclick: openCreateTable }, '+ Buat tabel'),
        h('p', { class: 'db-hint' }, 'Atau minta AI membuatkan tabel sekaligus halamannya:'),
        aiButton('Buat form RSVP dengan AI', 'Buatkan form RSVP (nama, jumlah tamu, pesan) yang datanya tersimpan di database, beserta daftar tamu yang sudah konfirmasi.', { cls: 'db-btn' })));
      return;
    }

    const publicOps = DB_OPS.filter(([op]) => t.rules[op] === 'public').map(([, label]) => label.toLowerCase());
    const columns = [{ name: 'id', type: 'number', system: true }, ...t.columns, { name: 'created_at', type: 'date', system: true }];

    const head = h('div', { class: 'db-main-head' },
      h('div', { class: 'db-title' },
        h('h3', {}, t.name),
        h('span', { class: `db-access${publicOps.length ? ' open' : ''}` },
          publicOps.length ? `Publik: ${publicOps.join(', ')}` : 'Privat — hanya kamu')),
      h('div', { class: 'db-actions' },
        h('button', { type: 'button', class: 'icon-btn', title: 'Muat ulang', onclick: dbLoad }, svg(ICON.refresh)),
        aiButton('Pakai di website', () => `Tampilkan data dari tabel "${t.name}" di website dengan tampilan yang rapi dan responsif${t.rules.create === 'public' ? ', beserta form untuk menambah data' : ''}. Pakai tabel yang sudah ada; tambah kolom atau akses publik hanya bila perlu.`, { cls: 'db-btn' }),
        h('button', { type: 'button', class: 'db-btn', onclick: () => openTableSettings(t.name) }, svg(ICON.gear), 'Atur'),
        h('button', { type: 'button', class: 'db-btn primary', onclick: () => openRowForm(t) }, '+ Baris')));

    const grid = h('table', { class: 'db-grid' },
      h('thead', {}, h('tr', {},
        columns.map((c) => h('th', {},
          h('span', { class: 'col-name' }, c.name),
          c.required ? h('span', { class: 'col-flag', title: 'Wajib diisi' }, '*') : null,
          c.private ? h('span', { class: 'col-flag private', title: 'Privat — tidak tampil di API publik' }, svg(ICON.lock)) : null,
          h('span', { class: 'col-type' }, c.system ? 'otomatis' : (c.type === 'reference' ? `→ ${c.refTable}` : DB_TYPES[c.type])))),
        h('th', { class: 'row-actions' }))),
      h('tbody', {}, dbState.rows.length
        ? dbState.rows.map((row) => h('tr', {},
          columns.map((c) => dbCell(t, row, c)),
          h('td', { class: 'row-actions' },
            h('button', { type: 'button', class: 'icon-btn', title: 'Hapus baris', onclick: () => deleteDbRow(t, row) }, svg(ICON.trash)))))
        : h('tr', {}, h('td', { colspan: String(columns.length + 1), class: 'db-no-rows' },
          'Belum ada data. Klik "+ Baris", atau kirim data dari websitemu.'))));

    const from = dbState.total ? dbState.offset + 1 : 0;
    const to = dbState.offset + dbState.rows.length;
    const pager = h('div', { class: 'db-pager' },
      h('span', {}, `${from}–${to} dari ${dbState.total} baris`),
      h('button', {
        type: 'button', class: 'icon-btn', title: 'Sebelumnya', disabled: dbState.offset === 0,
        onclick: () => { dbState.offset = Math.max(0, dbState.offset - DB_PAGE); dbLoadRows(); },
      }, '‹'),
      h('button', {
        type: 'button', class: 'icon-btn', title: 'Berikutnya', disabled: to >= dbState.total,
        onclick: () => { dbState.offset += DB_PAGE; dbLoadRows(); },
      }, '›'));

    main.replaceChildren(head, h('div', { class: 'db-grid-wrap' }, grid), pager);
  }

  function dbCell(t, row, column) {
    if (column.system) return h('td', { class: `sys ${column.name}` }, formatDbValue(column, row[column.name]));
    if (column.type === 'boolean') {
      const box = h('input', { type: 'checkbox', 'aria-label': column.name });
      box.checked = Boolean(row[column.name]);
      box.onchange = () => saveDbCell(t, row, column, box.checked).catch(() => { box.checked = !box.checked; });
      return h('td', { class: 'bool' }, box);
    }
    const td = h('td', { title: 'Klik dua kali untuk mengubah', class: column.type === 'image' ? 'img' : null }, formatDbValue(column, row[column.name]));
    td.ondblclick = () => (column.type === 'image' ? editDbImage(t, row, column) : editDbCell(td, t, row, column));
    return td;
  }

  function editDbCell(td, t, row, column) {
    if (td.classList.contains('editing')) return;
    const original = row[column.name] ?? '';
    const input = column.type === 'text'
      ? h('textarea', { rows: '1' })
      : h('input', {
        type: column.type === 'number' ? 'number' : 'text',
        step: column.type === 'number' ? 'any' : null,
        placeholder: column.type === 'date' ? '2026-12-31' : null,
      });
    input.value = String(original);
    td.classList.add('editing');
    td.replaceChildren(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = async (commit) => {
      if (finished) return;
      finished = true;
      if (commit && input.value !== String(original)) {
        try {
          await saveDbCell(t, row, column, input.value);
          return;
        } catch { /* pesan error sudah ditampilkan */ }
      }
      td.classList.remove('editing');
      td.replaceChildren(formatDbValue(column, row[column.name]));
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    input.onblur = () => finish(true);
  }

  async function saveDbCell(t, row, column, value) {
    try {
      const { row: updated } = await api('PATCH', `${tableUrl(t.name)}/rows/${row.id}`, { [column.name]: value });
      Object.assign(row, updated);
      renderDbMain();
    } catch (err) {
      toast(err.message, 'error');
      throw err;
    }
  }

  async function deleteDbRow(t, row) {
    const ok = await modal({
      title: 'Hapus baris?',
      message: `Baris #${row.id} di tabel "${t.name}" akan dihapus permanen.`,
      buttons: [{ label: 'Hapus', value: true, primary: true, danger: true }, { label: 'Batal', value: null }],
    });
    if (!ok) return;
    try {
      await api('DELETE', `${tableUrl(t.name)}/rows/${row.id}`);
      if (dbState.rows.length === 1 && dbState.offset > 0) dbState.offset -= DB_PAGE;
      await dbLoad();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Modal kosong untuk form database. Mengembalikan elemen isi dan fungsi tutup.
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

  function typeSelect(value = 'text') {
    const select = h('select', {}, Object.entries(DB_TYPES).map(([v, label]) => h('option', { value: v }, label)));
    select.value = value;
    return select;
  }

  // Dropdown tabel tujuan untuk kolom bertipe Relasi. `exclude` = tabel yang tak boleh dipilih (diri sendiri).
  function refSelect(value = '', exclude = null) {
    const options = dbState.tables.map((t) => t.name).filter((n) => n !== exclude);
    const select = h('select', { class: 'ref-select', title: 'Tabel yang ditunjuk' },
      h('option', { value: '' }, '— pilih tabel —'),
      options.map((n) => h('option', { value: n }, n)));
    if (value && options.includes(value)) select.value = value;
    return select;
  }

  function miniCheck(label, checked, title, onChange) {
    const box = h('input', { type: 'checkbox' });
    box.checked = Boolean(checked);
    if (onChange) box.onchange = () => onChange(box.checked);
    return h('label', { class: 'mini-check', title }, box, label);
  }

  // Dropdown pilihan baris tabel tujuan untuk kolom relasi (label dari kolom teks pertama).
  async function refRowSelect(c, selectedId = null) {
    const select = h('select', { class: 'ref-select' });
    select.append(h('option', { value: '' }, '— kosongkan —'));
    try {
      const data = await api('GET', `${tableUrl(c.refTable)}/rows?limit=200`);
      const target = dbState.tables.find((t) => t.name === c.refTable);
      const labelCol = target?.columns.find((col) => col.type === 'text')?.name;
      for (const row of data.rows ?? []) {
        const label = labelCol ? String(row[labelCol] ?? '') : '';
        select.append(h('option', { value: String(row.id) }, `#${row.id}${label ? ` — ${label.slice(0, 40)}` : ''}`));
      }
    } catch {
      select.append(h('option', { value: '', disabled: true }, '(gagal memuat baris)'));
    }
    if (selectedId != null) select.value = String(selectedId);
    return select;
  }

  function openRowForm(t) {
    const { body, close } = openPanel('db-modal');
    const inputs = new Map();
    const fields = t.columns.map((c) => {
      if (c.type === 'image') {
        const field = imageField(t, c);
        inputs.set(c.name, field);
        return h('div', { class: 'db-field image' },
          h('span', { class: 'db-field-label' }, c.name, c.required ? h('span', { class: 'req' }, '*') : null, h('span', { class: 'col-type' }, DB_TYPES.image)),
          field.el);
      }
      const input = c.type === 'boolean' ? h('input', { type: 'checkbox' })
        : c.type === 'text' ? h('textarea', { rows: '2' })
          : c.type === 'number' ? h('input', { type: 'number', step: 'any' })
            : c.type === 'reference' ? h('input', { type: 'number', step: '1', min: '1', placeholder: `id ${c.refTable}` })
              : h('input', { type: 'text', placeholder: '2026-12-31 atau 2026-12-31T19:00' });
      inputs.set(c.name, input);
      return h('label', { class: `db-field ${c.type}` },
        h('span', { class: 'db-field-label' }, c.name, c.required ? h('span', { class: 'req' }, '*') : null,
          h('span', { class: 'col-type' }, c.type === 'reference' ? `→ ${c.refTable}` : DB_TYPES[c.type])),
        input);
    });
    const error = h('p', { class: 'db-form-error' });
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const data = {};
        for (const c of t.columns) {
          const el = inputs.get(c.name);
          if (c.type === 'image') { if (el.getValue()) data[c.name] = el.getValue(); continue; }
          if (c.type === 'boolean') data[c.name] = el.checked;
          else if (el.value !== '') data[c.name] = el.value;
        }
        try {
          await api('POST', `${tableUrl(t.name)}/rows`, data);
          close();
          toast('Baris ditambahkan');
          dbLoad();
        } catch (err) {
          error.textContent = err.message;
        }
      },
    },
    h('h3', {}, `Tambah baris ke ${t.name}`),
    t.columns.length ? fields : h('p', { class: 'db-note' }, 'Tabel ini belum punya kolom. Tambahkan kolom lewat ⚙ Atur.'),
    error,
    h('div', { class: 'modal-buttons' },
      h('button', { type: 'button', onclick: close }, 'Batal'),
      h('button', { type: 'submit', class: 'primary' }, 'Simpan')));
    body.append(form);
    form.querySelector('input, textarea')?.focus();
  }

  function openCreateTable(presetName = '') {
    const { body, close } = openPanel('db-modal wide');
    const nameInput = h('input', { placeholder: 'contoh: ucapan', spellcheck: 'false', autocomplete: 'off', value: typeof presetName === 'string' ? presetName : '' });
    const columnList = h('div', { class: 'db-col-list' });
    const addColumnRow = (preset = {}) => {
      const name = h('input', { placeholder: 'nama_kolom', spellcheck: 'false', autocomplete: 'off', value: preset.name ?? '' });
      const type = typeSelect(preset.type);
      const ref = refSelect(preset.refTable);
      ref.hidden = type.value !== 'reference';
      type.onchange = () => { ref.hidden = type.value !== 'reference'; };
      const required = h('input', { type: 'checkbox' });
      const secret = h('input', { type: 'checkbox' });
      const row = h('div', { class: 'db-col-row' },
        name, type, ref,
        h('label', { class: 'mini-check', title: 'Wajib diisi' }, required, 'Wajib'),
        h('label', { class: 'mini-check', title: 'Tidak tampil di API publik' }, secret, 'Privat'),
        h('button', { type: 'button', class: 'icon-btn', title: 'Hapus kolom', onclick: () => row.remove() }, svg(ICON.close)));
      row.read = () => {
        const c = { name: name.value.trim(), type: type.value, required: required.checked, private: secret.checked };
        if (type.value === 'reference') c.refTable = ref.value;
        return c;
      };
      columnList.append(row);
      return name;
    };
    addColumnRow({ name: 'nama', type: 'text' });

    const error = h('p', { class: 'db-form-error' });
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const columns = [...columnList.children].map((row) => row.read()).filter((c) => c.name);
        try {
          const { table } = await api('POST', '/api/database/tables', { name: nameInput.value, columns });
          close();
          toast(`Tabel ${table.name} dibuat`);
          dbState.active = table.name;
          dbState.offset = 0;
          dbLoad();
        } catch (err) {
          error.textContent = err.message;
        }
      },
    },
    h('h3', {}, 'Tabel baru'),
    h('label', { class: 'db-field' }, h('span', { class: 'db-field-label' }, 'Nama tabel'), nameInput),
    h('div', { class: 'db-field-label' }, 'Kolom', h('span', { class: 'col-type' }, 'id dan created_at dibuat otomatis')),
    columnList,
    h('button', { type: 'button', class: 'db-add-col', onclick: () => addColumnRow().focus() }, '+ Tambah kolom'),
    h('p', { class: 'db-note' }, 'Tabel baru bersifat privat. Buka akses di ⚙ Atur supaya websitemu bisa membaca atau mengirim data.'),
    error,
    h('div', { class: 'modal-buttons' },
      h('button', { type: 'button', onclick: close }, 'Batal'),
      h('button', { type: 'submit', class: 'primary' }, 'Buat tabel')));
    body.append(form);
    nameInput.focus();
  }

  // Tombol berbahaya dengan konfirmasi dua kali klik (modal konfirmasi akan menutup panel ini).
  function confirmButton(label, onConfirm) {
    const btn = h('button', { type: 'button', class: 'db-danger' }, label);
    let armed = false;
    let timer;
    btn.onclick = () => {
      if (armed) {
        clearTimeout(timer);
        onConfirm();
        return;
      }
      armed = true;
      btn.textContent = 'Klik lagi untuk yakin';
      timer = setTimeout(() => { armed = false; btn.textContent = label; }, 3000);
    };
    return btn;
  }

  function dbSnippets(t) {
    const url = `/api/db/${t.name}`;
    const columns = t.columns.filter((c) => !c.system);
    const example = { text: 'teks', number: 1, boolean: true, date: '2026-12-31', reference: 1, image: '/uploads/contoh.jpg' };
    const sample = Object.fromEntries(columns.map((c) => [c.name, example[c.type]]));
    // body: objek data, atau teks kode JS untuk isi JSON.stringify(...)
    const send = (method, path, body) => `fetch('${path}', {\n  method: '${method}',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify(${typeof body === 'string' ? body : JSON.stringify(body)}),\n});`;
    const first = columns[0];
    const textCol = columns.find((c) => c.type === 'text');
    const imageCol = columns.find((c) => c.type === 'image');
    const refCol = columns.find((c) => c.type === 'reference');

    // ops: akses yang dibutuhkan kode ini; peringatan muncul bila tidak ada satu pun yang publik.
    const block = (title, code, ops = []) => h('div', { class: 'db-snippet' },
      h('div', { class: 'db-snippet-head' },
        h('span', {}, title),
        ops.length && !ops.some((op) => t.rules[op] === 'public') ? h('span', { class: 'db-warn', title: 'Buka akses di atas supaya kode ini berfungsi' }, 'Akses belum publik') : null,
        h('button', { type: 'button', class: 'db-copy', onclick: () => copyText(code, 'Kode disalin') }, 'Salin')),
      h('pre', {}, h('code', {}, code)));

    return [
      block('Membaca data', `// Ambil data, terbaru dulu (20 per halaman)\nconst res = await fetch('${url}?sort=-created_at&limit=20');\nconst { rows, total } = await res.json();`, ['list']),
      block('Membaca satu data', `// Ambil satu data berdasarkan id\nconst res = await fetch('${url}/1');\nconst row = await res.json();`, ['view']),
      block('Menambah data', `// Tambah data; balasannya data baru lengkap dengan id\nconst res = await ${send('POST', url, sample)}\nconst row = await res.json();`, ['create']),
      block('Mengubah data', `// Ubah data dengan id 1 (cukup kirim kolom yang diubah)\nawait ${send('PATCH', `${url}/1`, first ? { [first.name]: example[first.type] } : {})}`, ['update']),
      block('Menghapus data', `// Hapus data dengan id 1\nawait fetch('${url}/1', { method: 'DELETE' });`, ['delete']),
      imageCol ? block('Upload gambar', `// 1. Upload file dari <input type="file" id="file-${imageCol.name}">\nconst file = document.querySelector('#file-${imageCol.name}').files[0];\nconst up = await fetch('${url}/upload?column=${imageCol.name}', { method: 'POST', body: file });\nconst { url } = await up.json(); // mis. "/uploads/${t.name}/xxxx.jpg"\n// 2. Simpan alamatnya di kolom ${imageCol.name} (bersama kolom lain)\nawait ${send('POST', url, `{ ...data, ${imageCol.name}: url }`)}`, ['create', 'update']) : null,
      refCol ? block('Data relasi', `// Sertakan data dari tabel ${refCol.refTable} (kolom ${refCol.name})\nconst res = await fetch('${url}?expand=${refCol.name}');\nconst { rows } = await res.json();\n// rows[0].${refCol.name}__ref berisi data ${refCol.refTable} yang ditunjuk`, ['list', 'view']) : null,
      block('Menangani error', `const res = await fetch('${url}');\nif (!res.ok) {\n  // Pesan dari server, mis. akses ditolak atau kolom wajib belum diisi\n  const { error } = await res.json();\n  alert(error);\n}`),
      h('p', { class: 'db-section-desc' }, `Filter: ${url}?${textCol ? `${textCol.name}=Budi` : 'kolom=nilai'} · Urutkan: ?sort=-created_at (tanda - = menurun) · Halaman: ?limit=20&offset=20 · Ganti 1 dengan id datanya.`),
    ];
  }

  function openTableSettings(name) {
    const { body, close } = openPanel('db-modal wide');
    let tableName = name;

    const patch = async (payload, message) => {
      try {
        const { table } = await api('PATCH', tableUrl(tableName), payload);
        const i = dbState.tables.findIndex((t) => t.name === tableName);
        if (i >= 0) dbState.tables[i] = table;
        if (dbState.active === tableName) dbState.active = table.name;
        tableName = table.name;
        if (message) toast(message);
        renderDbSidebar();
        // Isi baris hanya berubah bila kolom/nama tabel berubah. Akses & tanda kolom cukup menggambar ulang
        // kepala tabel, tanpa memuat ulang baris (dan semua gambarnya) di belakang popup.
        if (payload.addColumns || payload.dropColumns || payload.renameColumns || payload.rename) dbLoadRows();
        else renderDbMain();
      } catch (err) {
        toast(err.message, 'error');
      }
      render();
    };

    const section = (title, desc, ...children) => h('section', { class: 'db-section' },
      h('h4', {}, title), desc ? h('p', { class: 'db-section-desc' }, desc) : null, children);

    function render() {
      const t = dbState.tables.find((x) => x.name === tableName);
      if (!t) return close();
      const scroll = body.scrollTop;

      const access = h('div', { class: 'db-access-list' }, DB_OPS.map(([op, label]) => h('div', { class: 'db-access-row' },
        h('span', {}, label),
        h('div', { class: 'seg' }, [['public', 'Publik'], ['owner', 'Hanya kamu']].map(([value, text]) => h('button', {
          type: 'button',
          class: t.rules[op] === value ? `on ${value}` : '',
          onclick: () => t.rules[op] !== value && patch({ rules: { [op]: value } }),
        }, text))))));

      const columnRows = t.columns.map((c) => {
        const nameInput = h('input', { value: c.name, spellcheck: 'false', title: 'Ganti nama kolom lalu tekan Enter' });
        nameInput.onchange = () => {
          const to = nameInput.value.trim();
          if (to && to !== c.name) patch({ renameColumns: [{ from: c.name, to }] }, 'Nama kolom diganti');
        };
        return h('div', { class: 'db-col-row' },
          nameInput,
          h('span', { class: 'db-type-fixed' }, DB_TYPES[c.type]),
          miniCheck('Wajib', c.required, 'Wajib diisi', (v) => patch({ columnFlags: { [c.name]: { required: v } } })),
          miniCheck('Privat', c.private, 'Tidak tampil di API publik', (v) => patch({ columnFlags: { [c.name]: { private: v } } })),
          confirmButton('Hapus', () => patch({ dropColumns: [c.name] }, `Kolom ${c.name} dihapus`)));
      });
      const newName = h('input', { placeholder: 'kolom_baru', spellcheck: 'false', autocomplete: 'off' });
      const newType = typeSelect();
      const addColumn = () => newName.value.trim() && patch({ addColumns: [{ name: newName.value.trim(), type: newType.value }] }, 'Kolom ditambahkan');
      newName.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addColumn(); } };

      const renameInput = h('input', { value: t.name, spellcheck: 'false' });

      body.replaceChildren(
        h('div', { class: 'topup-head' },
          h('div', {}, h('h3', {}, `Atur tabel ${t.name}`), h('p', {}, `${t.rowCount} baris`)),
          h('button', { type: 'button', class: 'icon-btn', title: 'Tutup', onclick: close }, svg(ICON.close))),
        section('Akses dari website', 'Siapa yang boleh memakai tabel ini lewat API websitemu. Kamu sendiri selalu bisa mengelola datanya di editor ini.', access),
        section('Kolom', 'Kolom privat tidak ditampilkan ke pengunjung. Tipe kolom tidak bisa diubah setelah dibuat.',
          columnRows,
          h('div', { class: 'db-col-row add' }, newName, newType, h('button', { type: 'button', class: 'db-btn', onclick: addColumn }, '+ Tambah'))),
        section('Pakai di websitemu', null, dbSnippets(t)),
        section('Tabel', null, h('div', { class: 'db-col-row' },
          renameInput,
          h('button', {
            type: 'button',
            class: 'db-btn',
            onclick: () => renameInput.value.trim() !== t.name && patch({ rename: renameInput.value.trim() }, 'Nama tabel diganti'),
          }, 'Ganti nama'),
          confirmButton('Hapus tabel', async () => {
            try {
              await api('DELETE', tableUrl(t.name));
              close();
              toast(`Tabel ${t.name} dihapus`);
              dbState.active = null;
              dbLoad();
            } catch (err) {
              toast(err.message, 'error');
            }
          }))),
      );
      body.scrollTop = scroll;
    }
    render();
  }

  // ---------- Diagram (UML, ERD, peta halaman, alur data) ----------
  // Dibuat AI (kode Mermaid) dari file & database project dan disimpan di server per jenis; dibuat ulang hanya
  // saat user menekan "Update diagram". Digambar dengan Mermaid (dimuat hanya saat tab dibuka).
  const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs';
  // saved: { jenis: { code, notes, updatedAt, canFix } } dari server; busy: jenis yang sedang dibuat AI.
  // view: posisi & skala kanvas (x, y dalam px layar; z = zoom); w/h = ukuran asli SVG; touched = user sudah zoom/geser.
  const diagram = {
    kind: storage.get('rakit.diagram', 'erd'), saved: null, busy: null, code: '', mermaid: null, seq: 0,
    view: { x: 0, y: 0, z: 1, w: 0, h: 0, touched: false },
  };
  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 5;
  const DIAGRAM_NAMES = {
    usecase: 'Use Case', activity: 'Activity', sequence: 'Sequence', class: 'Class', state: 'State',
    erd: 'ERD', site: 'Peta halaman', flow: 'Alur data',
  };
  // Penjelasan tiap jenis diagram (tombol ⓘ di toolbar), untuk pemula.
  const DIAGRAM_INFO = {
    usecase: {
      what: 'Gambaran siapa saja yang memakai website (aktor) dan apa saja yang bisa mereka lakukan (use case). Diagram ini tidak membahas cara kerjanya, hanya "siapa bisa apa".',
      use: 'Mengecek apakah semua kebutuhan pengguna sudah tersedia, dan menjelaskan fitur website ke orang lain tanpa bahasa teknis.',
      read: [['Aktor (👤)', 'orang atau sistem di luar website, mis. Pengunjung, Pemilik, layanan pembayaran.'], ['Oval', 'satu hal yang bisa dilakukan, mis. "Mengirim ucapan".'], ['Kotak besar', 'batas sistem: semua yang ada di dalamnya adalah fitur websitemu.'], ['Garis', 'aktor tersebut bisa melakukan use case itu.']],
    },
    activity: {
      what: 'Alur langkah demi langkah sebuah proses, dari mulai sampai selesai — mirip diagram alir (flowchart).',
      use: 'Memahami urutan proses (mis. mengisi form sampai data tersimpan), menemukan langkah yang terlewat, dan memikirkan apa yang terjadi kalau ada yang gagal.',
      read: [['Lingkaran', 'titik mulai; lingkaran ganda = selesai.'], ['Kotak', 'satu langkah/aktivitas.'], ['Belah ketupat', 'keputusan atau kondisi (ya/tidak), tiap cabang diberi label.'], ['Panah', 'urutan langkah.']],
    },
    sequence: {
      what: 'Urutan pesan yang dikirim antarbagian sistem dari waktu ke waktu, mis. Pengunjung → Halaman → API → Database.',
      use: 'Memahami apa yang terjadi "di balik layar" saat tombol ditekan, dan mencari di bagian mana sebuah request bisa gagal.',
      read: [['Kolom (peserta)', 'pihak yang terlibat; garis putus-putus ke bawah menunjukkan waktu berjalan.'], ['Panah penuh', 'permintaan/pesan yang dikirim.'], ['Panah putus-putus', 'jawaban yang kembali.'], ['Nomor', 'urutan kejadian dari atas ke bawah.'], ['Kotak alt/opt', 'langkah yang hanya terjadi pada kondisi tertentu (mis. kalau gagal).']],
    },
    class: {
      what: 'Struktur "benda" di dalam sistem: data (atribut) dan kemampuan (method) masing-masing, serta hubungan antarbenda. Di sini biasanya berupa tabel database dan modul JavaScript.',
      use: 'Melihat rancangan program secara keseluruhan sebelum menambah fitur atau merapikan kode.',
      read: [['Kotak', 'satu class: nama di atas, atribut di tengah, method di bawah.'], ['+ / -', 'publik / privat.'], ['Garis', 'hubungan antarclass; angka/label menunjukkan jumlah atau arti hubungannya.']],
    },
    state: {
      what: 'Kondisi (status) yang bisa dialami satu objek dan apa yang membuatnya berpindah kondisi, mis. pesanan: Baru → Dibayar → Dikirim.',
      use: 'Memastikan setiap status punya jalan masuk dan keluar yang jelas, dan tidak ada status yang "macet".',
      read: [['Titik hitam', 'kondisi awal; titik dalam lingkaran = kondisi akhir.'], ['Kotak membulat', 'satu kondisi/status.'], ['Panah berlabel', 'kejadian yang memindahkan ke kondisi lain.']],
    },
    erd: {
      what: 'Entity Relationship Diagram: struktur database — tabel, kolom beserta tipenya, dan hubungan antartabel.',
      use: 'Merancang dan mengecek database: kolom apa yang dibutuhkan, dan tabel mana saling terhubung (mis. pesanan milik satu pelanggan).',
      read: [['Kotak', 'satu tabel dengan daftar kolom dan tipenya.'], ['PK', 'primary key, pengenal unik tiap baris (kolom id).'], ['FK', 'foreign key, kolom yang menunjuk ke baris di tabel lain.'], ['Ujung garis', '|| = tepat satu, o{ = nol atau banyak; mis. satu pelanggan punya banyak pesanan.']],
    },
    site: {
      what: 'Peta semua halaman website, link antarhalaman, dan file CSS/JS yang dimuat tiap halaman.',
      use: 'Melihat struktur navigasi, menemukan halaman yang tidak bisa dicapai dari mana pun, link rusak, atau file yang hilang.',
      read: [['Kotak', 'satu halaman HTML.'], ['Bentuk miring', 'file CSS/JS yang dimuat halaman.'], ['Panah', 'link dari satu halaman ke halaman lain.'], ['Garis putus-putus', 'link rusak atau file yang tidak ditemukan.']],
    },
    flow: {
      what: 'Alur data: halaman, script, atau fungsi mana yang membaca/menulis tabel mana, dan dengan operasi apa.',
      use: 'Memastikan aturan akses tabel cocok dengan pemakaiannya — request yang akan ditolak server langsung terlihat.',
      read: [['Kotak kiri', 'halaman, script, atau fungsi yang memakai data.'], ['Kotak kanan', 'tabel database atau layanan luar.'], ['Label panah', 'operasinya: baca, tambah, ubah, hapus.'], ['Garis putus-putus "ditolak"', 'request yang akan ditolak (tabel belum ada atau aksesnya belum publik).']],
    },
  };

  function showDiagramInfo() {
    const kind = diagram.kind;
    const info = DIAGRAM_INFO[kind];
    const { body, close } = openPanel('db-modal diagram-info');
    body.append(
      h('h3', {}, `Diagram ${DIAGRAM_NAMES[kind]}`),
      h('h4', {}, 'Apa itu?'), h('p', {}, info.what),
      h('h4', {}, 'Gunanya'), h('p', {}, info.use),
      h('h4', {}, 'Cara membaca'),
      h('dl', {}, info.read.map(([term, desc]) => [h('dt', {}, term), h('dd', {}, desc)])),
      h('p', { class: 'diagram-info-note' }, 'Diagram ini digambar AI dari file & database project. Tekan Update diagram setelah project berubah.'),
      h('div', { class: 'modal-buttons' }, h('button', { type: 'button', class: 'primary', onclick: close }, 'Mengerti')));
    body.querySelector('button').focus({ preventScroll: true });
    body.scrollTop = 0;
  }

  const diagramTime = (ms) => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function loadMermaid() {
    const dark = isDark();
    if (diagram.mermaid && diagram.mermaidDark === dark) return diagram.mermaid;
    const mermaid = diagram.mermaid ?? (await import(MERMAID_URL)).default;
    diagram.mermaidDark = dark;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Inter, -apple-system, "Segoe UI", system-ui, sans-serif',
      themeVariables: dark ? {
        darkMode: true,
        background: '#11151f',
        primaryColor: '#1b2130',
        primaryTextColor: '#f5f7fb',
        primaryBorderColor: '#16a34a',
        secondaryColor: '#161b27',
        tertiaryColor: '#161b27',
        lineColor: '#7c869b',
        textColor: '#d8dde8',
        fontSize: '14px',
        attributeBackgroundColorOdd: '#161b27',
        attributeBackgroundColorEven: '#11151f',
        edgeLabelBackground: '#11151f',
      } : {
        darkMode: false,
        background: '#fffdf7',
        primaryColor: '#fff8e7',
        primaryTextColor: '#1a1320',
        primaryBorderColor: '#d6a01e',
        secondaryColor: '#fbf2dc',
        tertiaryColor: '#fbf2dc',
        lineColor: '#8a8274',
        textColor: '#2b2330',
        fontSize: '14px',
        attributeBackgroundColorOdd: '#fbf2dc',
        attributeBackgroundColorEven: '#fffdf7',
        edgeLabelBackground: '#fffdf7',
        actorBkg: '#fff8e7',
        actorBorder: '#d6a01e',
        noteBkgColor: '#ffe9b0',
        noteBorderColor: '#d6a01e',
      },
      er: { useMaxWidth: false },
      flowchart: { useMaxWidth: false, curve: 'basis', htmlLabels: false },
    });
    diagram.mermaid = mermaid;
    return mermaid;
  }

  function renderFindings(findings) {
    const icon = { error: '✕', warn: '!', info: 'i', ok: '✓' };
    const problems = findings.filter((f) => f.level === 'error' || f.level === 'warn').length;
    const toggle = $('#diagramFindingsToggle');
    toggle.querySelector('.count').textContent = String(findings.length);
    toggle.classList.toggle('alert', problems > 0);
    toggle.title = problems ? `${problems} hal perlu diperhatikan` : 'Catatan tentang diagram ini';
    $('#diagramFindings').replaceChildren(
      h('h4', {}, 'Temuan'),
      findings.length ? h('ul', {}, findings.map((f) => h('li', { class: f.level },
        h('span', { class: 'f-icon' }, icon[f.level]),
        h('div', {}, h('p', {}, f.text),
          f.level === 'error' || f.level === 'warn'
            ? aiButton('Perbaiki', `Diagram ${DIAGRAM_NAMES[diagram.kind] ?? ''} project ini menemukan masalah: "${f.text}". Periksa file dan database yang terkait, lalu perbaiki.`, { cls: 'finding-fix' })
            : null))))
        : h('p', { class: 'f-empty' }, 'Tidak ada catatan.'));
  }

  function setFindingsOpen(open) {
    $('#diagramFindings').hidden = !open;
    $('#diagramFindingsToggle').setAttribute('aria-pressed', String(open));
    storage.set('rakit.diagramFindings', open);
  }

  // ---------- Zoom & geser kanvas diagram ----------
  // Mouse: scroll = zoom di posisi kursor, seret = geser. Touchpad: cubit = zoom, dua jari = geser.
  // Layar sentuh: cubit & seret. Keyboard (kanvas difokus): + − 0 1 dan panah.
  const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

  function applyView() {
    const v = diagram.view;
    const stage = $('#diagramCanvas .diagram-stage');
    if (stage) stage.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    $('#diagramCanvas .diagram-hint')?.classList.toggle('gone', v.touched); // petunjuk hilang setelah dipakai
    $('#diagramZoomFit').textContent = `${Math.round(v.z * 100)}%`;
  }

  // Zoom dengan titik (cx, cy) di kanvas tetap di tempat — terasa seperti "zoom ke arah kursor".
  function zoomAt(factor, cx, cy) {
    const v = diagram.view;
    const z = clampZoom(v.z * factor);
    if (z === v.z) return;
    v.x = cx - ((cx - v.x) * z) / v.z;
    v.y = cy - ((cy - v.y) * z) / v.z;
    v.z = z;
    v.touched = true;
    applyView();
  }

  function zoomAtCenter(factor) {
    const box = $('#diagramCanvas');
    zoomAt(factor, box.clientWidth / 2, box.clientHeight / 2);
  }

  function panBy(dx, dy) {
    const v = diagram.view;
    v.x += dx;
    v.y += dy;
    v.touched = true;
    applyView();
  }

  // Pas di layar (maks. 150% supaya diagram kecil tidak terlalu besar), di tengah kanvas.
  function fitDiagram() {
    const v = diagram.view;
    const box = $('#diagramCanvas');
    if (!v.w || !box.clientWidth) return;
    const pad = 32;
    v.z = clampZoom(Math.min(1.5, (box.clientWidth - pad * 2) / v.w, (box.clientHeight - pad * 2) / v.h));
    v.x = (box.clientWidth - v.w * v.z) / 2;
    v.y = Math.max(pad, (box.clientHeight - v.h * v.z) / 2);
    v.touched = false;
    applyView();
  }

  function actualSize() {
    const v = diagram.view;
    const box = $('#diagramCanvas');
    zoomAt(1 / v.z, box.clientWidth / 2, box.clientHeight / 2);
  }

  // Scroll dari touchpad (dua jari) datang sebagai banyak event kecil, sering dengan deltaX; roda mouse sebagai
  // lompatan besar per "klik". Setelah terdeteksi touchpad, anggap tetap touchpad selama gerakan berlangsung.
  let lastTrackpadAt = 0;
  function isTrackpadScroll(e) {
    const now = performance.now();
    const looks = e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 40 || !Number.isInteger(e.deltaY));
    if (looks) lastTrackpadAt = now;
    return now - lastTrackpadAt < 300;
  }

  function bindCanvasGestures() {
    const canvas = $('#diagramCanvas');
    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const hasStage = () => Boolean(canvas.querySelector('.diagram-stage'));

    canvas.addEventListener('wheel', (e) => {
      if (!hasStage()) return;
      e.preventDefault();
      const [cx, cy] = point(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        // Cubit di touchpad (browser mengirimnya sebagai wheel + ctrlKey) atau Ctrl/⌘ + scroll.
        zoomAt(Math.exp(-dy * 0.01), cx, cy);
      } else if (isTrackpadScroll(e)) {
        panBy(-dx, -dy);
      } else if (e.shiftKey) {
        panBy(-(dx || dy), 0);
      } else {
        zoomAt(Math.exp(-dy * 0.002), cx, cy);
      }
    }, { passive: false });

    // Safari (macOS) mengirim cubit touchpad sebagai gesture event.
    let gestureZoom = 1;
    canvas.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureZoom = diagram.view.z; });
    canvas.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const [cx, cy] = point(e);
      zoomAt((gestureZoom * e.scale) / diagram.view.z, cx, cy);
    });

    // Seret dengan mouse / satu jari = geser; dua jari di layar sentuh = cubit (zoom) sambil geser.
    const pointers = new Map();
    let pinch = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!hasStage() || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('a, button')) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, point(e));
      canvas.classList.add('panning');
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      const now = point(e);
      pointers.set(e.pointerId, now);
      if (pointers.size === 1) {
        panBy(now[0] - prev[0], now[1] - prev[1]);
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        panBy(mid[0] - pinch.mid[0], mid[1] - pinch.mid[1]);
        if (pinch.dist > 0) zoomAt(dist / pinch.dist, mid[0], mid[1]);
        pinch = { dist, mid };
      }
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) canvas.classList.remove('panning');
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('dblclick', (e) => {
      if (!hasStage()) return;
      const [cx, cy] = point(e);
      zoomAt(e.shiftKey ? 1 / 1.6 : 1.6, cx, cy);
    });

    canvas.addEventListener('keydown', (e) => {
      if (!hasStage() || e.ctrlKey || e.metaKey || e.altKey) return;
      const step = e.shiftKey ? 180 : 60;
      const keys = {
        '+': () => zoomAtCenter(1.25), '=': () => zoomAtCenter(1.25), '-': () => zoomAtCenter(1 / 1.25),
        0: fitDiagram, 1: actualSize,
        ArrowLeft: () => panBy(step, 0), ArrowRight: () => panBy(-step, 0), ArrowUp: () => panBy(0, step), ArrowDown: () => panBy(0, -step),
      };
      if (!keys[e.key]) return;
      e.preventDefault();
      keys[e.key]();
    });

    // Ukuran panel berubah (geser splitter, buka/tutup Temuan): pas-kan ulang selama user belum zoom/geser.
    new ResizeObserver(() => { if (!diagram.view.touched && hasStage()) fitDiagram(); }).observe(canvas);
  }

  // Mermaid kadang meninggalkan elemen sementara di <body> (terutama saat gagal): bersihkan. SVG yang sedang
  // tampil memakai id yang sama (gayanya bergantung pada id itu), jadi isi kanvas tidak boleh ikut terhapus.
  const cleanupMermaid = (id) => ['', 'd', 'i'].forEach((p) => {
    const el = document.getElementById(`${p}${id}`);
    if (el && !$('#diagramCanvas').contains(el)) el.remove();
  });

  // Tombol Update & keterangan waktu diagram yang sedang dibuka.
  function renderDiagramMeta() {
    const saved = diagram.saved?.[diagram.kind];
    const label = $('#diagramUpdated');
    label.textContent = diagram.busy === diagram.kind ? 'AI sedang membuat…' : saved ? `Diperbarui ${diagramTime(saved.updatedAt)}` : 'Belum dibuat';
    label.title = saved ? new Date(saved.updatedAt).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'medium' }) : '';
    const btn = $('#diagramUpdate');
    btn.disabled = Boolean(diagram.busy) || !diagram.saved;
    $('#diagramInfo').title = `Tentang diagram ${DIAGRAM_NAMES[diagram.kind]}`;
    btn.title = `Buat ulang diagram ${DIAGRAM_NAMES[diagram.kind]} dengan AI dari file & database terbaru (${ai.credits?.costPerPrompt ?? 1} kredit)`;
  }

  const diagramMessage = (title, text, ...actions) => h('div', { class: 'db-empty' },
    h('div', { class: 'db-empty-icon diagram-empty-icon' }, svg(ICON.table)), h('h3', {}, title), h('p', {}, text),
    actions.length ? h('div', { class: 'diagram-actions' }, actions) : null);
  const diagramButton = (label, onclick, primary) => h('button', { type: 'button', class: `fn-btn${primary ? ' primary' : ''}`, onclick }, label);

  async function renderDiagram() {
    if (!DIAGRAM_NAMES[diagram.kind]) diagram.kind = 'erd'; // nilai lama di localStorage yang sudah tidak ada
    document.querySelectorAll('[data-diagram]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.diagram === diagram.kind)));
    const canvas = $('#diagramCanvas');
    if (!diagram.saved) return;
    renderDiagramMeta();
    const seq = ++diagram.seq; // hanya render terakhir yang boleh tampil (tab bisa diganti cepat)
    const name = DIAGRAM_NAMES[diagram.kind];
    const saved = diagram.saved[diagram.kind];
    diagram.code = saved?.code ?? '';
    renderFindings(saved?.notes ?? []);
    diagram.view.w = 0;
    if (diagram.busy === diagram.kind) {
      canvas.replaceChildren(h('div', { class: 'diagram-loading' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')),
        `AI sedang membaca project dan menggambar diagram ${name}… (bisa sampai 1–2 menit)`));
      return;
    }
    if (!saved) {
      canvas.replaceChildren(diagramMessage(`Belum ada diagram ${name}`,
        `AI akan membaca file & database project lalu menggambarnya. Memakai ${ai.credits?.costPerPrompt ?? 1} kredit AI.`,
        diagramButton('Buat diagram dengan AI', () => generateDiagram(), true)));
      return;
    }
    canvas.replaceChildren(h('div', { class: 'diagram-loading' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), 'Menggambar diagram…'));
    const id = `diagram-${seq}`;
    try {
      const mermaid = await loadMermaid();
      const { svg: markup } = await mermaid.render(id, saved.code);
      if (seq !== diagram.seq) return;
      // Parse di dokumen terpisah lalu pindahkan elemen SVG-nya (tanpa innerHTML). Parser HTML dipakai karena
      // label Mermaid berisi HTML (mis. <br>) yang tidak valid sebagai XML murni.
      const svgEl = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg');
      if (!svgEl) throw new Error('Mermaid tidak menghasilkan SVG');
      const imported = document.importNode(svgEl, true);
      const vb = imported.viewBox?.baseVal;
      const width = vb?.width || 800;
      const height = vb?.height || 600;
      // Mermaid memberi width="100%": ganti dengan ukuran aslinya. Inline style, karena aturan global
      // `svg { width: 16px }` (untuk ikon) mengalahkan atribut width/height.
      Object.assign(imported.style, { width: `${width}px`, height: `${height}px`, maxWidth: 'none' });
      Object.assign(diagram.view, { w: width, h: height });
      canvas.replaceChildren(
        h('div', { class: 'diagram-stage' }, imported),
        h('div', { class: 'diagram-hint' }, 'Scroll atau cubit untuk zoom · seret untuk geser · klik dua kali untuk memperbesar'),
      );
      fitDiagram();
    } catch (err) {
      if (seq !== diagram.seq) return;
      console.error(err);
      const message = String(err.message || err).slice(0, 1000);
      // Kode buatan AI kadang salah tulis: minta AI memperbaikinya (gratis, beberapa kali per diagram).
      canvas.replaceChildren(diagramMessage('Diagram gagal digambar',
        saved.canFix ? 'Kode diagram dari AI ada yang salah. Minta AI memperbaikinya (gratis), atau buat ulang.' : 'Kode diagram dari AI ada yang salah. Coba buat ulang dengan Update diagram.',
        saved.canFix ? diagramButton('Perbaiki dengan AI', () => generateDiagram(message), true) : null,
        diagramButton('Update diagram', () => generateDiagram(), !saved.canFix)));
      canvas.querySelector('.db-empty').append(h('p', { class: 'diagram-error' }, message.slice(0, 300)));
    } finally {
      cleanupMermaid(id);
    }
  }

  async function diagramLoad() {
    if (diagram.saved) return renderDiagram(); // sudah dimuat; diagram hanya berubah lewat Update
    $('#diagramCanvas').replaceChildren(h('div', { class: 'diagram-loading' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), 'Memuat diagram…'));
    try {
      diagram.saved = (await api('GET', '/api/diagrams/saved')).diagrams;
    } catch (err) {
      $('#diagramCanvas').replaceChildren(h('div', { class: 'db-empty' }, h('h3', {}, 'Gagal memuat diagram'), h('p', {}, err.message),
        h('div', { class: 'diagram-actions' }, diagramButton('Coba lagi', diagramLoad, true))));
      return;
    }
    renderDiagram();
  }

  // Buat ulang diagram jenis yang sedang dibuka dengan AI. renderError: perbaiki kode yang gagal digambar (gratis).
  async function generateDiagram(renderError) {
    if (diagram.busy) return;
    const kind = diagram.kind;
    diagram.busy = kind;
    renderDiagram();
    try {
      await saveAll(); // AI membaca file dari server, jadi simpan perubahan dulu
      const res = await api('POST', '/api/diagrams/generate', { kind, ...(renderError ? { renderError } : {}) });
      diagram.saved[kind] = res.diagram;
      ai.credits = res.credits;
      renderCredits();
      toast(renderError ? `Diagram ${DIAGRAM_NAMES[kind]} diperbaiki` : `Diagram ${DIAGRAM_NAMES[kind]} diperbarui`);
    } catch (err) {
      toast(err.message, 'error');
      if (err.code === 'no_credits') loadCredits();
    } finally {
      diagram.busy = null;
      if ($('#editorArea').dataset.mode === 'diagram' && diagram.kind === kind) renderDiagram();
      else renderDiagramMeta();
    }
  }

  function downloadDiagram() {
    const svgEl = $('#diagramCanvas svg');
    if (!svgEl) return toast('Belum ada diagram untuk diunduh', 'error');
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(diagram.view.w));
    clone.setAttribute('height', String(diagram.view.h));
    clone.style.background = isDark() ? '#11151f' : '#fffdf7';
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${state.project.slug}-${diagram.kind}.svg` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function bindDiagramEvents() {
    document.querySelectorAll('[data-diagram]').forEach((btn) => {
      btn.onclick = () => { diagram.kind = btn.dataset.diagram; storage.set('rakit.diagram', diagram.kind); renderDiagram(); };
    });
    $('#diagramZoomIn').onclick = () => zoomAtCenter(1.25);
    $('#diagramZoomOut').onclick = () => zoomAtCenter(1 / 1.25);
    $('#diagramZoomFit').onclick = fitDiagram;
    $('#diagramUpdate').onclick = () => generateDiagram();
    $('#diagramInfo').onclick = showDiagramInfo;
    $('#diagramCopy').onclick = () => (diagram.code ? copyText(diagram.code, 'Kode Mermaid disalin') : toast('Belum ada diagram', 'error'));
    $('#diagramDownload').onclick = downloadDiagram;
    $('#diagramFindingsToggle').onclick = () => setFindingsOpen($('#diagramFindings').hidden);
    setFindingsOpen(storage.get('rakit.diagramFindings', true));
    bindCanvasGestures();
  }

  // ---------- Baca Alur Kode ----------
  // Panel di samping editor kode: AI menjelaskan alur file yang sedang dibuka langkah demi langkah. Klik langkah →
  // barisnya disorot di editor; klik baris di editor → langkahnya dibuka. Rujukan ke file lain membuka file itu
  // (dengan tombol kembali). Gratis dengan batas harian; hasil disimpan server per file + hash isi.
  const flow = {
    open: false,
    path: null, // file yang sedang ditampilkan panel
    saved: null, // { explanation, hash, createdAt } dari server
    hash: null, // hash isi editor sekarang
    step: 0, // indeks langkah aktif
    loading: null, // path yang sedang dijelaskan AI
    remaining: null,
    limit: null,
    back: [], // [{ path, step }] untuk tombol "Kembali"
    chats: new Map(), // path -> [{ q, a }]
    asking: false,
    playTimer: null,
    seq: 0,
    pending: null, // { path, step }: langkah yang dibuka setelah penjelasan file itu dimuat (tombol Kembali)
    decoIds: new Map(), // path -> id dekorasi Monaco di model file itu
    showChart: storage.get('rakit.flowChart', true),
  };
  const FLOW_EXT = ['html', 'css', 'js'];
  const FLOW_KINDS = {
    start: 'Mulai', input: 'Masukan', process: 'Proses', decision: 'Keputusan', loop: 'Perulangan',
    function: 'Fungsi', event: 'Menunggu aksi', request: 'Permintaan', output: 'Hasil', end: 'Selesai',
  };
  const FLOW_NOTE = { bug: ['✕', 'Bug'], warn: ['!', 'Perlu dicek'], tip: ['✦', 'Saran'], info: ['i', 'Info'] };
  const canFlow = (path) => Boolean(path) && FLOW_EXT.includes(extOf(path));

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const flowStale = () => Boolean(flow.saved && flow.hash && flow.saved.hash !== flow.hash);
  const flowSteps = () => flow.saved?.explanation?.steps ?? [];
  const lineLabel = (lines) => lines.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');

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
    if (flow.open) flowFollow(true);
    else applyFlowHighlight();
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
        flow.chats.delete(path);
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
    for (const [p, ids] of flow.decoIds) {
      const m = state.models.get(p);
      if (m && !m.isDisposed()) m.deltaDecorations(ids, []);
    }
    flow.decoIds.clear();
    const model = editor?.getModel();
    if (model && marks.length) flow.decoIds.set(state.active, model.deltaDecorations([], marks));
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
    renderFlowSteps();
    renderFlowPlayer();
    highlightFlowChart();
    $(`#flowPanel .flow-step[data-i="${flow.step}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function stopFlowPlay() {
    clearInterval(flow.playTimer);
    flow.playTimer = null;
    $('#flowPanel .flow-play')?.classList.remove('on');
  }

  function toggleFlowPlay() {
    if (flow.playTimer) return stopFlowPlay();
    if (flow.step >= flowSteps().length - 1) selectFlowStep(0);
    flow.playTimer = setInterval(() => {
      if (flow.step >= flowSteps().length - 1) return stopFlowPlay();
      selectFlowStep(flow.step + 1);
    }, 6000);
    renderFlowPlayer();
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

  // ---------- Diagram alur (Mermaid dari langkah, bukan dari AI — jadi selalu valid) ----------
  function flowChartCode(steps) {
    const label = (s) => `${s.id}. ${s.title}`.replace(/["`]/g, "'").replace(/[<>#;{}[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
    const shape = (s) => {
      const t = label(s);
      switch (s.kind) {
        case 'start': case 'end': return `(["${t}"])`;
        case 'decision': return `{"${t}"}`;
        case 'loop': return `{{"${t}"}}`;
        case 'function': return `[["${t}"]]`;
        case 'input': case 'output': case 'request': return `[/"${t}"/]`;
        case 'event': return `>"${t}"]`;
        default: return `["${t}"]`;
      }
    };
    const lines = ['flowchart TD'];
    steps.forEach((s) => lines.push(`  S${s.id}${shape(s)}`));
    steps.forEach((s, i) => {
      if (s.next.length) {
        for (const e of s.next) {
          const text = e.label.replace(/["`|<>#;]/g, ' ').trim();
          lines.push(text ? `  S${s.id} -->|"${text}"| S${e.to}` : `  S${s.id} --> S${e.to}`);
        }
      } else if (i < steps.length - 1 && s.kind !== 'end') {
        lines.push(`  S${s.id} --> S${steps[i + 1].id}`);
      }
    });
    return lines.join('\n');
  }

  async function renderFlowChart() {
    const box = $('#flowPanel .flow-chart-box');
    const steps = flowSteps();
    if (!box || !steps.length || !flow.showChart) return;
    const seq = flow.seq;
    const id = `flowchart-render-${Date.now()}`;
    box.replaceChildren(h('div', { class: 'flow-muted' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), ' Menggambar diagram…'));
    try {
      const mermaid = await loadMermaid();
      const { svg: markup } = await mermaid.render(id, flowChartCode(steps));
      if (seq !== flow.seq || !box.isConnected) return;
      const svgEl = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg');
      if (!svgEl) throw new Error('Mermaid tidak menghasilkan SVG');
      const imported = document.importNode(svgEl, true);
      const vb = imported.viewBox?.baseVal;
      Object.assign(imported.style, { width: `${vb?.width || 300}px`, maxWidth: '100%', height: 'auto' });
      imported.querySelectorAll('g.node').forEach((node) => {
        const m = node.id.match(/flowchart-S(\d+)-/);
        if (!m) return;
        node.dataset.step = m[1];
        node.style.cursor = 'pointer';
        node.addEventListener('click', () => selectFlowStep(Number(m[1]) - 1));
      });
      box.replaceChildren(imported);
      highlightFlowChart();
    } catch (err) {
      console.error(err);
      box.replaceChildren(h('div', { class: 'flow-muted' }, 'Diagram alur tidak bisa digambar untuk file ini.'));
    } finally {
      ['', 'd', 'i'].forEach((p) => {
        const el = document.getElementById(`${p}${id}`);
        if (el && !box.contains(el)) el.remove();
      });
    }
  }

  function highlightFlowChart() {
    $('#flowPanel .flow-chart-box')?.querySelectorAll('g.node').forEach((node) => {
      node.classList.toggle('flow-node-active', Number(node.dataset.step) === flow.step + 1);
    });
  }

  // ---------- Tampilan panel ----------
  function flowRefChip(ref, { compact = false } = {}) {
    return h('button', {
      type: 'button', class: 'flow-ref', title: ref.note ? `${ref.note} — buka ${ref.path}` : `Buka ${ref.path}`,
      onclick: () => openFlowRef(ref),
    },
    fileIcon({ type: 'file', path: ref.path }),
    h('span', { class: 'flow-ref-path' }, `${ref.path}${ref.line ? `:${ref.line}` : ''}`),
    !compact && ref.note ? h('span', { class: 'flow-ref-note' }, ref.note) : null);
  }

  // "baris 12" / "baris 12–20" di jawaban AI → bisa diklik untuk menyorot baris itu.
  function linkifyLines(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = node.textContent.split(/(baris\s+\d+(?:\s*[-–]\s*\d+)?)/gi);
      if (parts.length < 2) continue;
      node.replaceWith(...parts.map((part) => {
        const m = part.match(/^baris\s+(\d+)(?:\s*[-–]\s*(\d+))?$/i);
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

  function renderFlowPlayer() {
    const bar = $('#flowPanel .flow-player');
    const steps = flowSteps();
    if (!bar || !steps.length) return;
    const s = steps[flow.step];
    bar.replaceChildren(
      h('button', { type: 'button', class: 'icon-btn', title: 'Langkah sebelumnya (←)', disabled: flow.step === 0, onclick: () => { stopFlowPlay(); selectFlowStep(flow.step - 1); } }, '‹'),
      h('div', { class: 'flow-player-label' },
        h('strong', {}, `Langkah ${flow.step + 1} dari ${steps.length}`),
        h('span', {}, s.title)),
      h('button', { type: 'button', class: `flow-play${flow.playTimer ? ' on' : ''}`, title: flow.playTimer ? 'Berhenti' : 'Putar otomatis (pindah tiap 6 detik)', onclick: toggleFlowPlay },
        flow.playTimer ? '❚❚' : '▶'),
      h('button', { type: 'button', class: 'icon-btn', title: 'Langkah berikutnya (→)', disabled: flow.step === steps.length - 1, onclick: () => { stopFlowPlay(); selectFlowStep(flow.step + 1); } }, '›'),
      h('div', { class: 'flow-progress' }, h('i', { style: `width:${((flow.step + 1) / steps.length) * 100}%` })),
    );
  }

  function renderFlowSteps() {
    const list = $('#flowPanel .flow-steps');
    if (!list) return;
    const steps = flowSteps();
    const byId = new Map(steps.map((s) => [s.id, s]));
    list.replaceChildren(...steps.map((s, i) => {
      const on = i === flow.step;
      const branches = s.next.filter((e) => e.label || e.to !== s.id + 1);
      return h('li', { class: `flow-step kind-${s.kind}${on ? ' active' : ''}`, dataset: { i: String(i) } },
        h('button', { type: 'button', class: 'flow-step-head', 'aria-expanded': String(on), onclick: () => { stopFlowPlay(); selectFlowStep(i); } },
          h('span', { class: 'flow-num' }, String(s.id)),
          h('span', { class: 'flow-step-title' }, s.title),
          s.lines.length ? h('span', { class: 'flow-lines', title: 'Baris di file ini' }, `baris ${lineLabel(s.lines)}`) : null),
        on ? h('div', { class: 'flow-step-body' },
          h('span', { class: 'flow-kind' }, FLOW_KINDS[s.kind] ?? s.kind),
          linkifyLines(renderMarkdown(s.explain || '')),
          s.example ? h('div', { class: 'flow-example' }, h('b', {}, 'Contoh'), linkifyLines(renderMarkdown(s.example))) : null,
          s.terms.length ? h('div', { class: 'flow-terms' }, s.terms.map((t) => h('details', { class: 'flow-term' },
            h('summary', {}, t.term), h('p', {}, t.meaning)))) : null,
          s.refs.length ? h('div', { class: 'flow-refs' }, h('span', { class: 'flow-sub' }, 'Terhubung ke'), s.refs.map((r) => flowRefChip(r))) : null,
          branches.length ? h('div', { class: 'flow-next' }, h('span', { class: 'flow-sub' }, 'Lalu'),
            branches.map((e) => {
              const target = byId.get(e.to);
              return target ? h('button', { type: 'button', class: 'flow-branch', onclick: () => { stopFlowPlay(); selectFlowStep(steps.indexOf(target)); } },
                e.label ? h('em', {}, e.label) : null, `→ ${target.id}. ${target.title}`) : null;
            })) : null) : null);
    }));
  }

  function renderFlowAsk() {
    const box = $('#flowPanel .flow-chat');
    if (!box) return;
    const chat = flow.chats.get(flow.path) ?? [];
    box.replaceChildren(...chat.map((c) => h('div', { class: 'flow-qa' },
      h('p', { class: 'flow-q' }, c.q),
      c.a ? linkifyLines(renderMarkdown(c.a)) : h('div', { class: 'flow-muted' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), ' AI sedang menjawab…'))));
    box.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }

  async function askFlow(input) {
    const question = input.value.trim();
    const path = flow.path;
    const model = state.models.get(path);
    if (!question || !model || flow.asking) return;
    const chat = flow.chats.get(path) ?? [];
    flow.chats.set(path, chat);
    const history = chat.filter((c) => c.a).slice(-6);
    const entry = { q: question, a: '' };
    chat.push(entry);
    input.value = '';
    flow.asking = true;
    renderFlowAsk();
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
      if (flow.path === path) {
        renderFlowAsk();
        renderFlowQuota();
      }
    }
  }

  function renderFlowQuota() {
    const el = $('#flowPanel .flow-quota');
    if (el && flow.limit) el.textContent = `Gratis · sisa ${flow.remaining} dari ${flow.limit} hari ini`;
  }

  function flowLoadingView(name) {
    return h('div', { class: 'flow-empty' },
      h('div', { class: 'flow-skeleton' }, [1, 2, 3, 4].map(() => h('i'))),
      h('p', {}, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), ` AI sedang membaca alur ${name}…`),
      h('p', { class: 'flow-muted' }, 'Biasanya 20–60 detik. Kamu boleh lanjut membaca kode sambil menunggu.'));
  }

  function renderFlow() {
    const panel = $('#flowPanel');
    if (!flow.open) return;
    stopFlowPlay();
    const path = flow.path;
    const ex = flow.saved?.explanation;
    const back = flow.back.at(-1);
    const head = h('div', { class: 'flow-head' },
      h('span', { class: 'flow-title' }, svg(ICON.flow), 'Baca Alur Kode'),
      h('span', { class: 'flow-file' }, path ? baseName(path) : ''),
      ex ? h('button', { type: 'button', class: 'icon-btn', title: 'Jelaskan ulang dengan AI', disabled: Boolean(flow.loading), onclick: () => explainFlow(true) }, svg(ICON.refresh)) : null,
      h('button', { type: 'button', class: 'icon-btn', title: 'Perlebar panel', onclick: () => panel.classList.toggle('wide') }, '⤢'),
      h('button', { type: 'button', class: 'icon-btn', title: 'Tutup', onclick: () => toggleFlow(false) }, svg(ICON.close)));
    const backBar = back ? h('button', { type: 'button', class: 'flow-back', onclick: flowGoBack }, `← Kembali ke ${baseName(back.path)} · langkah ${back.step + 1}`) : null;
    // replaceChildren() bawaan browser menulis null sebagai teks "null" (backBar kosong), jadi disaring dulu.
    const show = (...nodes) => panel.replaceChildren(...nodes.filter(Boolean));

    if (!path) {
      show(head, backBar, h('div', { class: 'flow-empty' },
        h('p', {}, 'Buka file .html, .css, atau .js untuk membaca alurnya.')));
      return applyFlowHighlight();
    }
    if (flow.loading === path) {
      show(head, backBar, flowLoadingView(baseName(path)));
      return applyFlowHighlight();
    }
    if (!ex) {
      show(head, backBar, h('div', { class: 'flow-empty' },
        h('div', { class: 'flow-hero' }, svg(ICON.flow)),
        h('h3', {}, `Pahami alur ${baseName(path)}`),
        h('p', {}, 'AI membaca file ini dan menjelaskannya langkah demi langkah, berurutan seperti kode berjalan: baris mana yang terlibat, contoh nilainya, istilah penting, dan hubungannya dengan file lain di project.'),
        h('button', { type: 'button', class: 'flow-go', disabled: flow.remaining === 0, onclick: () => explainFlow() }, svg(ICON.flow), 'Baca alur file ini'),
        h('p', { class: 'flow-quota flow-muted' })));
      renderFlowQuota();
      return applyFlowHighlight();
    }

    const steps = ex.steps;
    const notes = ex.notes ?? [];
    show(
      head,
      backBar,
      h('div', { class: 'flow-scroll' },
        flowStale() ? h('div', { class: 'flow-stale' },
          h('span', {}, 'File sudah berubah sejak penjelasan ini dibuat — baris yang disorot bisa bergeser.'),
          h('button', { type: 'button', onclick: () => explainFlow() }, 'Perbarui')) : null,
        h('section', { class: 'flow-summary' }, linkifyLines(renderMarkdown(ex.summary || ''))),
        h('div', { class: 'flow-player' }),
        h('ol', { class: 'flow-steps' }),
        h('details', {
          class: 'flow-section', open: flow.showChart,
          ontoggle: (e) => { flow.showChart = e.target.open; storage.set('rakit.flowChart', flow.showChart); if (flow.showChart) renderFlowChart(); },
        }, h('summary', {}, 'Diagram alur'), h('div', { class: 'flow-chart-box' }), h('p', { class: 'flow-muted' }, 'Klik kotak di diagram untuk membuka langkahnya.')),
        ex.related?.length ? h('details', { class: 'flow-section', open: true },
          h('summary', {}, `Terhubung dengan file lain (${ex.related.length})`),
          h('div', { class: 'flow-related' }, ex.related.map((r) => flowRefChip(r)))) : null,
        ex.complexity ? h('details', { class: 'flow-section' },
          h('summary', {}, 'Seberapa cepat kodenya?'), linkifyLines(renderMarkdown(ex.complexity))) : null,
        notes.length ? h('details', { class: 'flow-section', open: notes.some((n) => n.level === 'bug' || n.level === 'warn') },
          h('summary', {}, `Catatan (${notes.length})`),
          h('ul', { class: 'flow-notes' }, notes.map((n) => {
            const [icon, label] = FLOW_NOTE[n.level] ?? FLOW_NOTE.info;
            return h('li', { class: `flow-note ${n.level}` },
              h('span', { class: 'flow-note-icon', title: label }, icon),
              h('div', {}, linkifyLines(renderMarkdown(n.text)),
                n.line ? h('button', { type: 'button', class: 'flow-line-link', onclick: () => flashFlowLines(n.line, n.line) }, `baris ${n.line}`) : null,
                n.level === 'bug' || n.level === 'warn' || n.level === 'tip'
                  ? aiButton(n.level === 'tip' ? 'Terapkan dengan AI' : 'Perbaiki dengan AI',
                    `Di file ${path}${n.line ? ` baris ${n.line}` : ''}: ${n.text}\n\n${n.level === 'tip' ? 'Terapkan saran ini' : 'Perbaiki masalah ini'} tanpa mengubah perilaku lain.`, { cls: 'flow-ai-fix' })
                  : null));
          }))) : null,
        h('section', { class: 'flow-ask-wrap' },
          h('span', { class: 'flow-sub' }, 'Masih bingung? Tanya AI'),
          h('div', { class: 'flow-chat' })),
        h('p', { class: 'flow-meta flow-muted' },
          `Dibuat ${new Date(flow.saved.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} · `,
          h('span', { class: 'flow-quota' }))),
      h('form', {
        class: 'flow-ask',
        onsubmit: (e) => { e.preventDefault(); askFlow(e.target.elements.q); },
      },
      h('textarea', {
        name: 'q', rows: 1, maxlength: 1000, placeholder: `Tanya tentang langkah ${flow.step + 1}… (Enter kirim)`,
        onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); askFlow(e.target); } },
      }),
      h('button', { type: 'submit', class: 'ai-send', title: 'Kirim' }, svg('M1 1.5 15 8 1 14.5l2-6.5 6-.5v-1l-6-.5z'))),
    );
    if (!steps.length) return;
    renderFlowPlayer();
    renderFlowSteps();
    renderFlowAsk();
    renderFlowQuota();
    renderFlowChart();
    applyFlowHighlight({ reveal: true });
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
  // Semua log di satu tempat, berlabel sumbernya: FE (console & error halaman di preview, diteruskan skrip
  // yang disisipkan server — go/internal/sites/console.js), BE (eksekusi fungsi serverless dari log server),
  // Jaringan (fetch/XHR dan file yang gagal dimuat), dan Sistem (halaman dimuat, catatan lain).
  const CONSOLE_MAX = 1000;
  const CONSOLE_SOURCES = [['all', 'Semua'], ['fe', 'FE'], ['be', 'BE'], ['net', 'Jaringan'], ['sys', 'Sistem']];
  const CONSOLE_LABEL = { fe: 'FE', be: 'BE', net: 'NET', sys: 'SYS' };
  const CONSOLE_TITLE = { fe: 'Frontend: halaman di preview', be: 'Backend: fungsi serverless', net: 'Jaringan: request & file', sys: 'Sistem' };
  const devConsole = {
    entries: [], source: 'all', errorsOnly: false, query: '',
    unread: 0, beLastId: 0, beLoaded: false, poll: null, beTimer: null, list: null, counts: {},
  };
  const consoleCount = (src) => devConsole.entries.filter((e) => src === 'all' || e.source === src).length;
  function updateConsoleCounts() {
    for (const [src, el] of Object.entries(devConsole.counts)) el.textContent = String(consoleCount(src));
  }
  const consoleActive = () => $('#editorArea').dataset.mode === 'console';
  const consoleTime = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function consoleMatches(e) {
    if (devConsole.source !== 'all' && e.source !== devConsole.source) return false;
    if (devConsole.errorsOnly && e.level !== 'error') return false;
    const q = devConsole.query.trim().toLowerCase();
    return !q || `${e.text}\n${e.page ?? ''}\n${e.logs ?? ''}`.toLowerCase().includes(q);
  }

  // Permintaan perbaikan untuk satu baris error, beserta konteksnya.
  function consoleFixPrompt(e) {
    if (e.source === 'be') return fnFixPrompt(e.fn, { status: e.status, error: e.error, logs: e.logs, trigger: e.trigger });
    if (e.source === 'net') return `Request dari halaman ${e.page || '/'} gagal:\n${clipText(e.text)}\n\nCari penyebabnya (kode yang memanggilnya, tabel database / akses publik, atau fungsi serverless yang dituju) dan perbaiki.`;
    return `Ada error di console halaman ${e.page || '/'}:\n${clipText(e.text)}\n\nCari penyebabnya dan perbaiki kodenya.`;
  }

  function consoleRow(e) {
    const fixable = e.level === 'error' && e.source !== 'sys';
    e.countEl = h('span', { class: 'console-count', hidden: e.count < 2 }, String(e.count));
    return h('div', { class: `console-row ${e.source} ${e.level}`, title: e.page ? `Halaman ${e.page}` : null },
      h('span', { class: 'console-time' }, consoleTime(e.time)),
      h('span', { class: `console-src ${e.source}`, title: CONSOLE_TITLE[e.source] }, CONSOLE_LABEL[e.source] ?? e.source),
      h('div', { class: 'console-msg' },
        e.countEl,
        e.source === 'be' ? [h('span', {}, e.text), e.error ? h('pre', { class: 'console-be-error' }, e.error) : null, e.logs ? consoleView(e.logs) : null] : e.text),
      fixable ? aiButton('Perbaiki', () => consoleFixPrompt(e), { cls: 'console-fix' }) : null);
  }

  function consoleNearBottom() {
    const list = devConsole.list;
    return !list || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  }

  function devConsoleAdd(raw) {
    const source = CONSOLE_LABEL[raw.source] ? raw.source : 'sys';
    const level = ['error', 'warn', 'info', 'debug', 'log'].includes(raw.level) ? raw.level : 'log';
    const entry = { ...raw, source, level, text: String(raw.text ?? ''), time: Number(raw.time) || Date.now(), count: 1 };
    // Pesan sama berturut-turut digabung dengan penghitung, seperti console browser.
    const last = devConsole.entries.at(-1);
    if (last && source !== 'be' && last.source === source && last.level === level && last.text === entry.text && last.page === entry.page) {
      last.count += 1;
      last.time = entry.time;
      if (last.countEl) { last.countEl.hidden = false; last.countEl.textContent = String(last.count); }
    } else {
      devConsole.entries.push(entry);
      if (devConsole.entries.length > CONSOLE_MAX) devConsole.entries.splice(0, devConsole.entries.length - CONSOLE_MAX);
      if (consoleActive() && devConsole.list && consoleMatches(entry)) {
        const stick = consoleNearBottom();
        devConsole.list.querySelector('.console-empty')?.remove();
        devConsole.list.append(consoleRow(entry));
        while (devConsole.list.childElementCount > CONSOLE_MAX) devConsole.list.firstElementChild.remove();
        if (stick) devConsole.list.scrollTop = devConsole.list.scrollHeight;
      }
      if (consoleActive()) updateConsoleCounts();
    }
    if (!consoleActive() && level === 'error') {
      devConsole.unread += 1;
      renderConsoleBadge();
    }
    // Website memanggil fungsi serverless: ambil log eksekusinya (BE) sebentar lagi.
    if (source === 'net' && /^\/api\/fn\//.test(raw.url ?? '')) {
      clearTimeout(devConsole.beTimer);
      devConsole.beTimer = setTimeout(devConsoleLoadBE, 600);
    }
  }

  function renderConsoleBadge() {
    const badge = $('#consoleBadge');
    badge.hidden = !devConsole.unread;
    badge.textContent = devConsole.unread > 99 ? '99+' : String(devConsole.unread);
    badge.title = `${devConsole.unread} error baru`;
  }

  // Eksekusi fungsi serverless (BE) sejak yang terakhir diambil; pembukaan pertama mengambil 30 terakhir.
  async function devConsoleLoadBE() {
    let logs;
    try {
      logs = (await api('GET', `/api/functions/logs?limit=${devConsole.beLoaded ? 50 : 30}`)).logs;
    } catch {
      return; // mis. project tanpa fungsi atau sesi habis: Console tetap jalan untuk FE
    }
    const first = !devConsole.beLoaded;
    devConsole.beLoaded = true;
    const TRIGGER = { http: 'pengunjung', cron: 'jadwal', test: 'uji coba' };
    const fresh = logs.filter((l) => l.id > devConsole.beLastId).reverse();
    if (!fresh.length) return;
    devConsole.beLastId = Math.max(devConsole.beLastId, ...fresh.map((l) => l.id));
    for (const l of fresh) {
      const level = l.error || l.status >= 500 ? 'error' : l.status >= 400 ? 'warn' : 'info';
      const trigger = TRIGGER[l.trigger] ?? l.trigger;
      const entry = {
        source: 'be', level, time: l.createdAt, fn: l.name, status: l.status, trigger, error: l.error, logs: l.logs,
        text: `functions/${l.name}.js → ${l.status} (${l.ms} ms) · ${trigger}${l.dev ? ' · dev' : ''}`,
      };
      if (first) {
        devConsole.entries.push({ ...entry, count: 1 });
      } else {
        devConsoleAdd(entry);
      }
    }
    if (first) {
      // Riwayat eksekusi lama diselipkan sesuai waktunya di antara log yang sudah ada.
      devConsole.entries.sort((a, b) => a.time - b.time);
      if (consoleActive()) { renderConsoleList(); updateConsoleCounts(); }
    }
  }

  function devConsoleOpen() {
    devConsole.unread = 0;
    renderConsoleBadge();
    renderConsole();
    devConsoleLoadBE();
    // Selama tab Console terbuka, eksekusi baru (mis. dari jadwal) diambil berkala.
    clearInterval(devConsole.poll);
    devConsole.poll = setInterval(() => {
      if (!consoleActive()) return clearInterval(devConsole.poll);
      if (document.visibilityState === 'visible') devConsoleLoadBE();
    }, 5000);
  }

  function renderConsoleList() {
    const list = devConsole.list;
    if (!list) return;
    const shown = devConsole.entries.filter(consoleMatches);
    list.replaceChildren(...(shown.length
      ? shown.map(consoleRow)
      : [h('div', { class: 'console-empty' },
        devConsole.entries.length
          ? 'Tidak ada log yang cocok dengan saringan ini.'
          : 'Belum ada log. Pakai websitemu di preview — console.log, error, request, dan log fungsi serverless akan muncul di sini.')]));
    list.scrollTop = list.scrollHeight;
  }

  function renderConsole() {
    devConsole.counts = {};
    const search = h('input', {
      type: 'search', class: 'console-search', placeholder: 'Cari log…', value: devConsole.query, spellcheck: 'false',
      oninput: (e) => { devConsole.query = e.target.value; renderConsoleList(); },
    });
    devConsole.list = h('div', { class: 'console-list', role: 'log', 'aria-live': 'polite' });
    $('#consoleView').replaceChildren(
      h('div', { class: 'console-bar' },
        h('div', { class: 'seg console-sources' }, CONSOLE_SOURCES.map(([value, label]) => h('button', {
          type: 'button',
          class: devConsole.source === value ? 'on owner' : '',
          title: value === 'all' ? 'Semua sumber' : CONSOLE_TITLE[value],
          onclick: () => { devConsole.source = value; renderConsole(); },
        }, label, (devConsole.counts[value] = h('span', { class: 'console-n' }, String(consoleCount(value))))))),
        h('label', { class: 'console-errors' },
          h('input', { type: 'checkbox', checked: devConsole.errorsOnly, onchange: (e) => { devConsole.errorsOnly = e.target.checked; renderConsoleList(); } }),
          'Hanya error'),
        search,
        h('button', { type: 'button', class: 'icon-btn', title: 'Muat ulang preview', onclick: reloadPreview }, svg(ICON.refresh)),
        h('button', {
          type: 'button', class: 'icon-btn', title: 'Bersihkan log',
          onclick: () => { devConsole.entries = []; devConsole.unread = 0; renderConsoleBadge(); renderConsole(); },
        }, svg(ICON.trash))),
      devConsole.list);
    renderConsoleList();
  }

  // ---------- Riwayat versi ----------
  // Bahasa dibuat sederhana untuk pemula: "versi" = potret semua file project pada satu waktu.
  // ---------- Fungsi serverless ----------
  // Kode backend di functions/<nama>.js, dipanggil lewat <situs>/api/fn/<nama> (lihat go/internal/fn):
  // berjalan di server dengan akses db (sebagai pemilik), env (rahasia project), dan fetch.
  const FN_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  const fnState = { data: null, logs: [], logFilter: '', openLog: null, open: null, form: { method: 'POST', query: '', body: '{\n  "nama": "Ani"\n}' }, result: null, running: false };
  const FN_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const pad2 = (n) => String(n).padStart(2, '0');

  // Jadwal cron (WIB) dalam kalimat, untuk bentuk yang dibuat dialog Jadwal; selain itu ekspresinya.
  function describeCron(c) {
    let m;
    if ((m = /^\*\/(\d+) \* \* \* \*$/.exec(c))) return `setiap ${m[1]} menit`;
    if (c === '0 * * * *') return 'setiap jam';
    if ((m = /^(\d+) (\d+) \* \* \*$/.exec(c))) return `setiap hari ${pad2(m[2])}.${pad2(m[1])}`;
    if ((m = /^(\d+) (\d+) \* \* ([0-7])$/.exec(c))) return `setiap ${FN_DAYS[m[3]]} ${pad2(m[2])}.${pad2(m[1])}`;
    return c;
  }

  const fnTemplate = (name) => [
    `// Fungsi serverless — dipanggil lewat /api/fn/${name}`,
    '// req: { method, query, headers, body } · ctx: { db, env, fetch, ai }',
    '//   db   : list / get / insert / update / delete tabel project (sebagai pemilik)',
    '//   env  : rahasia project (atur di tab Fungsi), mis. env.TELEGRAM_TOKEN',
    '//   fetch: memanggil API luar',
    "//   ai   : ai.chat('…') / ai.json / ai.embed — provider & API key di tab Fungsi → Provider AI",
    'export default async function (req, { db, env, fetch, ai }) {',
    "  const nama = req.body?.nama ?? req.query.nama ?? 'dunia';",
    '  return { pesan: `Halo, ${nama}!`, waktu: new Date().toISOString() };',
    '}',
    '',
  ].join('\n');

  async function fnLoadLogs() {
    try {
      const q = fnState.logFilter ? `&name=${encodeURIComponent(fnState.logFilter)}` : '';
      fnState.logs = (await api('GET', `/api/functions/logs?limit=50${q}`)).logs;
    } catch { /* tetap tampilkan yang lama */ }
  }

  async function fnLoad() {
    try {
      [fnState.data] = await Promise.all([api('GET', '/api/functions'), fnLoadLogs()]);
    } catch (err) {
      $('#fnView').replaceChildren(h('div', { class: 'fn-wrap' }, h('p', { class: 'history-empty error' }, err.message)));
      return;
    }
    renderFn();
  }

  async function fnCreate() {
    const name = (await ask('Fungsi baru', 'nama-fungsi (huruf kecil, angka, - atau _)'))?.toLowerCase();
    if (!name) return;
    if (!FN_NAME_RE.test(name)) return toast('Nama fungsi: huruf kecil, angka, - atau _ (maks. 40)', 'error');
    const path = `functions/${name}.js`;
    if (state.entries.some((e) => e.path === path)) return toast(`Fungsi "${name}" sudah ada`, 'error');
    try {
      await api('POST', '/api/files', { path });
      await api('PUT', '/api/files/content', { path, content: fnTemplate(name) });
      await loadTree();
      fnState.open = name;
      await fnLoad();
      toast(`Fungsi ${name} dibuat`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function fnRun(name) {
    fnState.running = true;
    fnState.result = null;
    renderFn();
    try {
      await saveAll(); // jalankan kode yang terakhir diketik
      fnState.result = await api('POST', `/api/functions/${encodeURIComponent(name)}/run`, fnState.form);
    } catch (err) {
      fnState.result = { error: err.message };
    }
    fnState.running = false;
    renderFn();
    fnLoad(); // perbarui kuota & log
  }

  function openSchedule(f) {
    const min = fnState.data.cron.minMinutes; // 0 = paket tanpa jadwal
    const current = f.schedule?.cron ?? '';
    // Satu elemen hanya bisa tampil di satu tempat: kolom jam terpisah untuk harian & mingguan.
    const dayTime = h('input', { type: 'time', value: '07:00', 'aria-label': 'Jam (harian)' });
    const weekTime = h('input', { type: 'time', value: '07:00', 'aria-label': 'Jam (mingguan)' });
    const day = h('select', {}, [1, 2, 3, 4, 5, 6, 0].map((d) => h('option', { value: d }, FN_DAYS[d])));
    const custom = h('input', { value: current, placeholder: 'menit jam tanggal bulan hari, mis. 0 7 * * 1-5', spellcheck: 'false' });
    let m;
    if ((m = /^(\d+) (\d+) \* \* (?:[0-7]|\*)$/.exec(current))) dayTime.value = weekTime.value = `${pad2(m[2])}:${pad2(m[1])}`;
    if ((m = /^\d+ \d+ \* \* ([0-7])$/.exec(current))) day.value = m[1] === '7' ? '0' : m[1];
    const timeCron = (input, dow) => { const [hh, mm] = (input.value || '07:00').split(':'); return `${Number(mm)} ${Number(hh)} * * ${dow}`; };
    const options = [
      { id: 'off', label: 'Tanpa jadwal', cron: () => '' },
      { id: '5', label: 'Setiap 5 menit', cron: () => '*/5 * * * *', every: 5 },
      { id: '15', label: 'Setiap 15 menit', cron: () => '*/15 * * * *', every: 15 },
      { id: '30', label: 'Setiap 30 menit', cron: () => '*/30 * * * *', every: 30 },
      { id: 'hour', label: 'Setiap jam', cron: () => '0 * * * *', every: 60 },
      { id: 'day', label: 'Setiap hari jam', cron: () => timeCron(dayTime, '*'), every: 1440, extra: [dayTime] },
      { id: 'week', label: 'Setiap minggu', cron: () => timeCron(weekTime, day.value), every: 10080, extra: [day, weekTime] },
      { id: 'custom', label: 'Kustom (cron, WIB)', cron: () => custom.value, extra: [custom] },
    ];
    const guess = () => {
      if (!current) return 'off';
      const known = { '*/5 * * * *': '5', '*/15 * * * *': '15', '*/30 * * * *': '30', '0 * * * *': 'hour' }[current];
      if (known) return known;
      if (/^\d+ \d+ \* \* \*$/.test(current)) return 'day';
      if (/^\d+ \d+ \* \* [0-7]$/.test(current)) return 'week';
      return 'custom';
    };
    let chosen = guess();
    const save = h('button', { type: 'button', class: 'primary' }, 'Simpan');
    const sync = () => document.querySelectorAll('.cron-option').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.id === chosen)));
    const close = openSheet('publish-modal', 'Jadwal fungsi', (done) => [
      h('h3', {}, `Jadwal ${f.name}`),
      min === 0
        ? h('div', { class: 'cron-locked' },
          h('p', {}, 'Jadwal (cron) tersedia untuk paket Pro dan Unlimited: fungsi berjalan otomatis, mis. kirim rekap harian atau bersihkan data lama.'),
          ai.credits?.topupEnabled ? h('button', { type: 'button', class: 'fn-btn primary', onclick: () => { done(); openTopup('plans'); } }, 'Lihat paket') : null)
        : h('p', { class: 'fn-note' }, `Berjalan otomatis (WIB) memakai versi publik fungsi; req.method = "CRON". Paketmu: paling sering tiap ${min} menit.`),
      h('div', { class: 'cron-options', role: 'radiogroup' }, options.map((o) => {
        const blocked = o.id !== 'off' && (min === 0 || (o.every && o.every < min));
        return h('div', { class: `cron-option${blocked ? ' blocked' : ''}`, role: 'radio', dataset: { id: o.id }, tabindex: 0,
          onclick: (e) => { if (blocked || ['INPUT', 'SELECT'].includes(e.target.tagName)) return; chosen = o.id; sync(); } },
        h('span', { class: 'cron-dot' }), h('span', { class: 'cron-label' }, o.label),
        o.extra ? h('span', { class: 'cron-extra', onclick: () => { if (!blocked) { chosen = o.id; sync(); } } }, ...o.extra) : null,
        blocked && o.every ? h('span', { class: 'cron-plan' }, min ? `min. ${min} mnt` : 'Pro') : null);
      })),
      f.schedule?.lastRunAt ? h('p', { class: 'fn-note' }, `Terakhir berjalan ${new Date(f.schedule.lastRunAt).toLocaleString('id-ID')} — status ${f.schedule.lastStatus ?? '-'}`) : null,
      h('div', { class: 'modal-buttons' }, save, h('button', { type: 'button', onclick: done }, 'Batal')),
    ]);
    sync();
    save.onclick = async () => {
      save.disabled = true;
      try {
        const cron = options.find((o) => o.id === chosen).cron();
        fnState.data = await api('PUT', `/api/functions/${encodeURIComponent(f.name)}/schedule`, { cron });
        close();
        renderFn();
        toast(cron ? `Jadwal ${f.name}: ${describeCron(cron)}` : `Jadwal ${f.name} dimatikan`);
      } catch (err) {
        toast(err.message, 'error');
        save.disabled = false;
      }
    };
  }

  // Kepala section tab Fungsi: judul (+ jumlah) di kiri, kontrol di kanan.
  const fnSectionHead = (title, count, ...tools) => h('div', { class: 'fn-section-head' },
    h('h4', {}, title, count != null ? h('span', { class: 'fn-count' }, String(count)) : null), ...tools);

  // Keluaran console fungsi: baris berawalan "[warn] ", "[error] " dst. (lihat go/internal/fn/prelude.js) memulai
  // entri berlevel; baris lanjutan (mis. JSON bertingkat) ikut level entri sebelumnya.
  const LOG_LEVEL_RE = /^\[(info|warn|error|debug)\] /;
  function consoleView(text) {
    let level = 'log';
    return h('pre', { class: 'fn-pre logs' }, text.replace(/\n$/, '').split('\n').map((line) => {
      const m = LOG_LEVEL_RE.exec(line);
      if (m) level = m[1];
      else if (!/^\s/.test(line) && !/^[}\]]/.test(line)) level = 'log';
      return h('span', { class: `log-line ${level}` }, m ? [h('b', { class: 'log-level' }, m[1]), line.slice(m[0].length)] : line || ' ');
    }));
  }
  const logPeek = (text) => text.split('\n').find((l) => l.trim())?.replace(LOG_LEVEL_RE, '').slice(0, 120) ?? '';
  const logLines = (text) => text.replace(/\n$/, '').split('\n').length;

  function fnLogsSection(d) {
    const TRIGGER = { http: 'Pengunjung', cron: 'Jadwal', test: 'Uji coba' };
    const when = (ms) => {
      const t = new Date(ms);
      const time = t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return t.toDateString() === new Date().toDateString() ? time : `${t.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} ${time}`;
    };
    const filter = h('select', { onchange: async (e) => { fnState.logFilter = e.target.value; await fnLoadLogs(); renderFn(); } },
      h('option', { value: '' }, 'Semua fungsi'), d.functions.map((f) => h('option', { value: f.name, selected: f.name === fnState.logFilter }, f.name)));
    return h('section', { class: 'fn-section' },
      fnSectionHead('Log eksekusi', null, filter,
        h('button', { type: 'button', class: 'icon-btn', title: 'Muat ulang log', onclick: async () => { await fnLoadLogs(); renderFn(); } }, svg(ICON.refresh))),
      fnState.logs.length
        ? h('ul', { class: 'fn-logs' }, fnState.logs.map((l) => {
          const open = fnState.openLog === l.id;
          return h('li', { class: open ? 'open' : '' },
            h('button', { type: 'button', class: 'fn-log-row', onclick: () => { fnState.openLog = open ? null : l.id; renderFn(); } },
              h('span', { class: 'fn-log-time' }, when(l.createdAt)),
              h('code', {}, l.name),
              h('span', { class: 'fn-log-peek', title: l.logs ? 'Keluaran console' : '' },
                l.error ? h('span', { class: 'peek-error' }, l.error) : l.logs ? logPeek(l.logs) : ''),
              l.logs ? h('span', { class: 'fn-log-count', title: 'Jumlah baris console' }, `${logLines(l.logs)} baris`) : null,
              h('span', { class: `fn-chip ${l.trigger}` }, TRIGGER[l.trigger] ?? l.trigger),
              l.dev ? h('span', { class: 'env-badge' }, 'DEV') : null,
              h('span', { class: `fn-status s${String(l.status)[0]}` }, l.status),
              h('span', { class: 'fn-log-ms' }, `${l.ms} ms`),
              h('span', { class: 'fn-log-more' }, open ? '▴' : '▾')),
            open && l.error ? h('p', { class: 'fn-error' }, l.error) : null,
            open && l.logs ? [h('div', { class: 'fn-label' }, 'console'), consoleView(l.logs)] : null,
            open && !l.logs && !l.error ? h('p', { class: 'fn-note fn-log-empty' }, 'Tidak ada keluaran console. Tambahkan console.log(...) di kode fungsi untuk melihat isinya di sini.') : null,
            open && (l.error || l.status >= 500) ? h('div', { class: 'fn-ai-fix' },
              aiButton('Perbaiki dengan AI', () => fnFixPrompt(l.name, { status: l.status, error: l.error, logs: l.logs, trigger: (TRIGGER[l.trigger] ?? l.trigger).toLowerCase() }))) : null);
        }))
        : h('p', { class: 'fn-placeholder' }, 'Belum ada eksekusi. Panggilan dari pengunjung, jadwal, dan uji coba tercatat di sini (100 terakhir).'));
  }

  function fnTryPanel(f) {
    const method = h('select', { onchange: (e) => { fnState.form.method = e.target.value; } },
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => h('option', { value: m, selected: m === fnState.form.method }, m)));
    const query = h('input', { value: fnState.form.query, placeholder: 'query, mis. nama=Ani&halaman=2', spellcheck: 'false', oninput: (e) => { fnState.form.query = e.target.value; } });
    const body = h('textarea', { rows: 5, spellcheck: 'false', placeholder: 'body JSON (opsional)', oninput: (e) => { fnState.form.body = e.target.value; } });
    body.value = fnState.form.body;
    const r = fnState.result;
    let shown = r?.body ?? '';
    try { shown = JSON.stringify(JSON.parse(shown), null, 2); } catch { /* bukan JSON */ }
    return h('div', { class: 'fn-try' },
      h('div', { class: 'fn-try-row' }, method, query,
        h('button', { type: 'button', class: 'fn-run', disabled: fnState.running, onclick: () => fnRun(f.name) }, fnState.running ? 'Menjalankan…' : '▶ Jalankan')),
      body,
      r ? h('div', { class: 'fn-result' },
        r.status ? h('div', { class: 'fn-result-head' },
          h('span', { class: `fn-status s${String(r.status)[0]}` }, r.status), h('span', {}, `${r.ms} ms`), r.headers?.['content-type'] ? h('code', {}, r.headers['content-type']) : null) : null,
        r.error ? h('p', { class: 'fn-error' }, r.error) : null,
        shown ? h('pre', { class: 'fn-pre' }, shown) : null,
        r.logs ? [h('div', { class: 'fn-label' }, 'console'), consoleView(r.logs)] : null,
        // Hanya bila fungsinya benar-benar berjalan (ada status) — bukan kuota habis/gagal menyimpan.
        r.status && (r.error || r.status >= 500) ? h('div', { class: 'fn-ai-fix' },
          aiButton('Perbaiki dengan AI', () => fnFixPrompt(f.name, {
            status: r.status, error: r.error || (r.status >= 500 ? shown : ''), logs: r.logs, trigger: 'uji coba',
            request: [`${fnState.form.method} /api/fn/${f.name}${fnState.form.query ? `?${fnState.form.query}` : ''}`, clipText(fnState.form.body, 1000)].filter(Boolean).join('\n'),
          }))) : null) : null);
  }

  // ---------- Provider AI (library ai.* di fungsi; API key milik pemilik project) ----------
  // Contoh model hanya saran di kotak isian; nama model mana pun yang dikenal provider bisa diketik.
  const AI_KIND_INFO = {
    openai: { name: 'openai', keyUrl: 'https://platform.openai.com/api-keys', models: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1'], embed: 'text-embedding-3-small' },
    anthropic: { name: 'claude', keyUrl: 'https://console.anthropic.com/settings/keys', models: ['claude-sonnet-4-5', 'claude-haiku-4-5'], embed: '' },
    gemini: { name: 'gemini', keyUrl: 'https://aistudio.google.com/apikey', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'], embed: 'gemini-embedding-001' },
    compatible: { name: '', keyUrl: '', models: [], embed: '' },
  };
  // Endpoint kompatibel OpenAI yang populer: isi base URL & nama sekali klik.
  const AI_PRESETS = [
    { label: 'DeepSeek', name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { label: 'Groq', name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
    { label: 'OpenRouter', name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
    { label: 'Mistral', name: 'mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
    { label: 'Together', name: 'together', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  ];
  const fnAiTests = new Map(); // nama provider -> hasil tes terakhir

  // Pernyataan soal API key pengguna (tampil di bagian Provider AI dan di dialog tambah/ubah provider).
  const aiKeyDisclaimer = () => h('div', { class: 'ai-disclaimer', role: 'note' },
    h('strong', {}, '🔒 API key-mu tetap milikmu.'),
    ' rakit.io tidak akan mengambil, membagikan, atau memakai API key dan token AI-mu untuk keperluan apa pun selain meneruskan panggilan ',
    h('code', {}, 'ai.*'), ' dari fungsimu sendiri ke provider yang kamu pilih. Key tidak pernah dikirim ke browser maupun ke kode fungsi, dan dihapus dari database rakit.io saat provider dihapus. ',
    'Sebagai pengaman tambahan, pasang batas pemakaian (spending limit) di dashboard provider dan ganti key bila curiga bocor.');

  async function testAiProvider(name) {
    fnAiTests.set(name, { running: true });
    renderFn();
    try {
      fnAiTests.set(name, await api('POST', `/api/functions/ai-providers/${encodeURIComponent(name)}/test`));
    } catch (err) {
      fnAiTests.set(name, { ok: false, error: err.message });
    }
    fnState.data = await api('GET', '/api/functions').catch(() => fnState.data); // pemakaian hari ini
    renderFn();
  }

  function openAiProvider(existing = null) {
    const kinds = fnState.data.aiKinds;
    const kind = h('select', { disabled: Boolean(existing) }, Object.keys(AI_KIND_INFO).map((k) => h('option', { value: k, selected: k === (existing?.kind ?? 'openai') }, kinds[k] ?? k)));
    const name = h('input', { value: existing?.name ?? 'openai', disabled: Boolean(existing), spellcheck: 'false', autocomplete: 'off',
      oninput: (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'); nameTouched = true; } });
    const baseUrl = h('input', { value: existing?.baseUrl ?? '', placeholder: 'https://api.deepseek.com/v1', spellcheck: 'false', autocomplete: 'off' });
    const apiKey = h('input', { type: 'password', autocomplete: 'new-password', placeholder: existing ? `kosongkan untuk tetap memakai key ${existing.keyHint}` : 'sk-…' });
    const modelList = h('datalist', { id: 'aiModelList' });
    const model = h('input', { value: existing?.model ?? '', list: 'aiModelList', spellcheck: 'false', autocomplete: 'off' });
    const embedModel = h('input', { value: existing?.embedModel ?? '', spellcheck: 'false', autocomplete: 'off' });
    const isDefault = h('input', { type: 'checkbox', checked: existing ? existing.default : !fnState.data.aiProviders.length });
    const keyLink = h('a', { target: '_blank', rel: 'noopener' }, 'Dapatkan API key ↗');
    const presets = h('div', { class: 'ai-presets' }, AI_PRESETS.map((p) => h('button', {
      type: 'button', class: 'fn-chip',
      onclick: () => { baseUrl.value = p.baseUrl; if (!existing) name.value = p.name; if (!model.value) model.value = p.model; },
    }, p.label)));
    let nameTouched = Boolean(existing);
    const urlRow = h('label', {}, 'Base URL', baseUrl);
    const embedRow = h('label', {}, 'Model embedding ', h('span', { class: 'ai-optional' }, '(opsional, untuk ai.embed)'), embedModel);
    const sync = () => {
      const info = AI_KIND_INFO[kind.value];
      const compatible = kind.value === 'compatible';
      if (!nameTouched) name.value = info.name;
      presets.hidden = !compatible;
      urlRow.firstChild.textContent = compatible ? 'Base URL' : 'Base URL (opsional, kosongkan untuk alamat resmi)';
      baseUrl.required = compatible;
      keyLink.hidden = !info.keyUrl;
      keyLink.href = info.keyUrl || '#';
      modelList.replaceChildren(...info.models.map((m) => h('option', { value: m })));
      model.placeholder = info.models[0] ?? 'nama model, mis. deepseek-chat';
      embedRow.hidden = kind.value === 'anthropic';
      embedModel.placeholder = info.embed || 'nama model embedding (bila didukung)';
    };
    kind.addEventListener('change', sync);
    const save = h('button', { type: 'submit', class: 'primary' }, 'Simpan & tes');
    const close = openSheet('publish-modal ai-provider-modal', 'Provider AI', (done) => [
      h('h3', {}, existing ? `Ubah provider ${existing.name}` : 'Tambah provider AI'),
      h('p', {}, 'Fungsi memakai AI lewat ', h('code', {}, 'ai.chat()'), ', ', h('code', {}, 'ai.json()'), ', dan ', h('code', {}, 'ai.embed()'),
        ' dengan API key milikmu sendiri — biayanya ditagih provider langsung ke akunmu, bukan oleh rakit.io.'),
      aiKeyDisclaimer(),
      h('form', { class: 'ai-provider-form', onsubmit: async (e) => {
        e.preventDefault();
        save.disabled = true;
        try {
          fnState.data = await api('PUT', '/api/functions/ai-providers', {
            name: name.value, kind: kind.value, baseUrl: baseUrl.value, apiKey: apiKey.value,
            model: model.value, embedModel: embedModel.value, default: isDefault.checked,
          });
          done();
          toast(`Provider ${name.value} disimpan. Mengetes koneksi…`);
          testAiProvider(name.value);
        } catch (err) {
          toast(err.message, 'error');
          save.disabled = false;
        }
      } },
      h('div', { class: 'ai-row' }, h('label', {}, 'Jenis', kind), h('label', {}, 'Nama di kode', name)),
      presets,
      urlRow,
      h('label', {}, h('span', { class: 'ai-label-row' }, 'API key', keyLink), apiKey),
      h('label', {}, 'Model chat', model, modelList),
      embedRow,
      h('label', { class: 'ai-check' }, isDefault, 'Jadikan default (dipakai bila kode tidak menyebut provider)'),
      h('div', { class: 'modal-buttons' }, save, h('button', { type: 'button', onclick: done }, 'Batal'))),
    ]);
    sync();
    (existing ? apiKey : kind).focus();
    return close;
  }

  async function deleteAiProvider(p) {
    const ok = await modal({ title: `Hapus provider ${p.name}?`, message: `Fungsi yang memakai provider '${p.name}' akan gagal sampai provider ditambahkan lagi. API key-nya ikut dihapus dari server.`, buttons: [{ label: 'Hapus', value: true, danger: true }, { label: 'Batal', value: null }] });
    if (!ok) return;
    try {
      fnState.data = await api('DELETE', `/api/functions/ai-providers/${encodeURIComponent(p.name)}`);
      fnAiTests.delete(p.name);
      renderFn();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function makeDefaultAiProvider(p) {
    try {
      fnState.data = await api('PUT', '/api/functions/ai-providers', { ...p, apiKey: '', default: true });
      renderFn();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const AI_EXAMPLE = [
    "export default async function (req, { db, ai }) {",
    "  // Teks: provider default, atau pilih { provider: 'gemini', model: '…' }",
    "  const { text } = await ai.chat(`Buat deskripsi singkat untuk produk: ${req.body.nama}`, {",
    "    system: 'Kamu penulis toko online yang ramah. Jawab dalam bahasa Indonesia.',",
    "  });",
    "",
    "  // JSON terstruktur: hasilnya langsung objek",
    "  const data = await ai.json(`Ambil nama & nomor HP dari: ${req.body.pesan}`, { nama: 'string', hp: 'string' });",
    "",
    "  // Gambar (vision): URL https, path gambar di project, atau data URL",
    "  const cek = await ai.chat('Apakah ini bukti transfer? Sebutkan nominalnya.', { images: [req.body.bukti] });",
    "",
    "  // Embedding: cari data yang maknanya mirip",
    "  const [a, b] = await ai.embed(['kue coklat', 'brownies']);",
    "  return { text, data, cek: cek.text, mirip: ai.similarity(a, b) };",
    "}",
  ].join('\n');

  function fnAiProviders(d) {
    const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}rb` : String(n));
    const rows = d.aiProviders.map((p) => {
      const t = fnAiTests.get(p.name);
      return h('li', {},
        h('div', { class: 'ai-prov-main' },
          h('div', { class: 'ai-prov-title' },
            h('code', {}, p.name),
            h('span', { class: 'fn-chip' }, d.aiKinds[p.kind] ?? p.kind),
            p.default ? h('span', { class: 'fn-chip ai-default' }, 'default') : null),
          h('div', { class: 'ai-prov-meta' },
            h('span', { title: 'Model chat' }, p.model),
            p.embedModel ? h('span', { title: 'Model embedding' }, `embed: ${p.embedModel}`) : null,
            h('span', { title: 'API key' }, `key ${p.keyHint}`),
            h('span', { title: 'Pemakaian hari ini (WIB)' }, p.today.calls
              ? `${p.today.calls} panggilan · ${fmt(p.today.inputTokens + p.today.outputTokens)} token${p.today.errors ? ` · ${p.today.errors} gagal` : ''} hari ini`
              : 'belum dipakai hari ini')),
          t ? h('div', { class: `ai-test ${t.running ? '' : t.ok ? 'ok' : 'fail'}` },
            t.running ? 'Mengetes koneksi…' : t.ok ? `✓ Tersambung (${t.ms} ms) — jawaban: "${String(t.text).trim().slice(0, 60)}"` : `✕ ${t.error}`) : null),
        h('div', { class: 'ai-prov-actions' },
          h('button', { type: 'button', class: 'fn-btn', disabled: t?.running, onclick: () => testAiProvider(p.name) }, 'Tes'),
          !p.default ? h('button', { type: 'button', class: 'fn-btn', onclick: () => makeDefaultAiProvider(p) }, 'Jadikan default') : null,
          h('button', { type: 'button', class: 'fn-btn', onclick: () => openAiProvider(p) }, 'Ubah'),
          h('button', { type: 'button', class: 'icon-btn', title: `Hapus ${p.name}`, onclick: () => deleteAiProvider(p) }, svg(ICON.trash))));
    });
    return h('section', { class: 'fn-section' },
      fnSectionHead('Provider AI', d.aiProviders.length || null,
        d.aiProviders.length ? aiButton('Buat fitur AI', 'Buatkan fungsi serverless yang memakai ai.chat dari provider AI-ku untuk ') : null,
        h('button', { type: 'button', class: 'fn-btn primary', onclick: () => openAiProvider() }, '+ Tambah provider')),
      h('p', { class: 'fn-note' }, 'Pakai AI di fungsi lewat ', h('code', {}, 'ai.chat()'), ', ', h('code', {}, 'ai.json()'), ', dan ', h('code', {}, 'ai.embed()'),
        ' — satu cara untuk OpenAI, Claude, Gemini, dan endpoint kompatibel OpenAI (DeepSeek, Groq, OpenRouter, …). Memakai API key milikmu; waktu menunggu AI tidak dihitung ke batas waktu fungsi.'),
      aiKeyDisclaimer(),
      rows.length ? h('ul', { class: 'fn-secrets ai-providers' }, rows)
        : h('p', { class: 'fn-placeholder' }, 'Belum ada provider. Tambahkan API key OpenAI, Claude, Gemini, atau provider lain, lalu panggil ai.chat(…) dari fungsi.'),
      h('details', { class: 'fn-help ai-example' },
        h('summary', {}, 'Contoh kode'),
        h('div', { class: 'ai-example-tools' }, h('button', { type: 'button', class: 'fn-btn', onclick: () => copyText(AI_EXAMPLE, 'Contoh kode disalin') }, 'Salin')),
        h('pre', { class: 'fn-pre' }, AI_EXAMPLE)));
  }

  function fnSecrets(d) {
    const name = h('input', { placeholder: 'NAMA_RAHASIA', spellcheck: 'false', autocomplete: 'off', oninput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'); } });
    const value = h('input', { type: 'password', placeholder: 'isi (mis. API key)', autocomplete: 'new-password' });
    const save = async () => {
      try {
        fnState.data = await api('PUT', '/api/functions/secrets', { name: name.value, value: value.value });
        toast(`Rahasia ${name.value} disimpan`);
        renderFn();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const remove = async (s) => {
      const ok = await modal({ title: `Hapus rahasia ${s.name}?`, message: 'Fungsi yang memakai env.' + s.name + ' akan mendapat undefined.', buttons: [{ label: 'Hapus', value: true, danger: true }, { label: 'Batal', value: null }] });
      if (!ok) return;
      try {
        fnState.data = await api('DELETE', `/api/functions/secrets/${encodeURIComponent(s.name)}`);
        renderFn();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    return h('section', { class: 'fn-section' },
      fnSectionHead('Rahasia (env)', d.secrets.length || null),
      h('p', { class: 'fn-note' }, 'Untuk API key & token. Dibaca fungsi lewat ', h('code', {}, 'env.NAMA'), ' — tidak pernah terkirim ke browser pengunjung, dan isinya tidak ditampilkan lagi setelah disimpan.'),
      d.secrets.length ? h('ul', { class: 'fn-secrets' }, d.secrets.map((s) => h('li', {},
        h('code', {}, s.name), h('span', { class: 'fn-dots' }, '••••••••'),
        h('button', { type: 'button', class: 'icon-btn', title: `Hapus ${s.name}`, onclick: () => remove(s) }, svg(ICON.trash))))) : null,
      h('form', { class: 'fn-secret-form', onsubmit: (e) => { e.preventDefault(); save(); } }, name, value, h('button', { type: 'submit', class: 'fn-btn primary' }, 'Simpan')));
  }

  function renderFn() {
    const d = fnState.data;
    if (!d) return;
    const usage = d.usage;
    const list = d.functions.map((f) => h('div', { class: `fn-item${fnState.open === f.name ? ' open' : ''}` },
      h('div', { class: 'fn-item-head' },
        h('span', { class: 'fn-icon' }, svg('M9.3 1 3 9.2h4.2L6.3 15l6.6-8.4H8.7z')),
        h('div', { class: 'fn-item-text' },
          h('strong', {}, f.name,
            f.schedule ? h('span', { class: `fn-sched${f.schedule.active ? '' : ' off'}`, title: f.schedule.note || `Berikutnya: ${f.schedule.nextRunAt ? new Date(f.schedule.nextRunAt).toLocaleString('id-ID') : '-'}` },
              `⏱ ${describeCron(f.schedule.cron)}`) : null),
          h('code', { title: f.url }, f.url.replace(/^https?:\/\//, ''))),
        h('button', { type: 'button', class: 'fn-btn', onclick: () => openSchedule(f) }, 'Jadwal'),
        h('button', { type: 'button', class: 'fn-btn', onclick: () => copyText(f.url, 'URL fungsi disalin') }, 'Salin URL'),
        h('button', { type: 'button', class: 'fn-btn', onclick: async () => { setMode('code'); expandTo(f.path); await openFile(f.path); } }, 'Buka kode'),
        aiButton('Ubah', `Ubah fungsi ${f.path} supaya `),
        h('button', { type: 'button', class: 'fn-btn primary', onclick: () => { fnState.open = fnState.open === f.name ? null : f.name; fnState.result = null; renderFn(); } }, fnState.open === f.name ? 'Tutup' : 'Coba')),
      fnState.open === f.name ? fnTryPanel(f) : null));
    const used = usage.limit ? Math.min(1, usage.today / usage.limit) : 0;
    $('#fnView').replaceChildren(h('div', { class: 'fn-wrap' },
      h('div', { class: 'fn-head' },
        h('div', {}, h('h3', {}, 'Fungsi serverless'),
          h('p', {}, 'Kode backend yang berjalan di server: simpan API key dengan aman, olah data, kirim notifikasi, atau panggil layanan lain.')),
        h('div', { class: 'fn-head-actions' },
          aiButton('Buat dengan AI', 'Buatkan fungsi serverless yang '),
          h('button', { type: 'button', class: 'fn-new', onclick: fnCreate }, '+ Fungsi baru'))),
      h('div', { class: 'fn-usage' },
        h('div', { class: 'fn-usage-top' },
          h('span', { class: 'fn-usage-count' }, h('strong', {}, usage.today.toLocaleString('id-ID')), ` / ${usage.limit.toLocaleString('id-ID')} eksekusi hari ini`),
          h('span', { class: 'fn-usage-meta' },
            h('span', { class: 'fn-chip' }, `Paket ${usage.plan}`),
            h('span', { class: 'fn-chip', title: 'Batas per eksekusi' }, `maks. ${d.limits.timeoutSeconds} dtk`),
            h('span', { class: 'fn-chip', title: 'Batas memori per eksekusi' }, `${d.limits.memoryMb} MB`))),
        h('div', { class: `fn-meter${used >= 0.9 ? ' full' : ''}`, role: 'progressbar', 'aria-label': 'Eksekusi hari ini', 'aria-valuemin': '0', 'aria-valuemax': String(usage.limit), 'aria-valuenow': String(usage.today) },
          h('span', { style: `width: ${(used * 100).toFixed(1)}%` }))),
      h('section', { class: 'fn-section' },
        fnSectionHead('Fungsi', d.functions.length),
        list.length ? list : h('div', { class: 'fn-empty' },
          h('span', { class: 'fn-icon' }, svg('M9.3 1 3 9.2h4.2L6.3 15l6.6-8.4H8.7z')),
          h('p', {}, 'Belum ada fungsi. Fungsi disimpan di folder ', h('code', {}, 'functions/'), ' dan langsung bisa dipanggil dari halaman website-mu.'),
          h('button', { type: 'button', class: 'fn-btn primary', onclick: fnCreate }, 'Buat fungsi pertama'))),
      fnAiProviders(d),
      fnSecrets(d),
      fnLogsSection(d),
      h('details', { class: 'fn-help' },
        h('summary', {}, 'Cara memanggil dari halaman website'),
        h('pre', { class: 'fn-pre' }, [
          "const res = await fetch('/api/fn/kirim-pesan', {",
          "  method: 'POST',",
          "  headers: { 'Content-Type': 'application/json' },",
          "  body: JSON.stringify({ nama: 'Ani', pesan: 'Halo!' }),",
          '});',
          'const data = await res.json();',
        ].join('\n')))));
  }

  const hist = { list: [], history: null, selected: null, detail: null, seq: 0 };

  // Panel sempit (HP): daftar versi dan detailnya ditampilkan bergantian, masing-masing layar penuh.
  // Di panel lebar keduanya selalu tampil berdampingan, jadi kelas ini tidak berpengaruh.
  function setHistoryDetail(show) {
    const layout = $('#historyLayout');
    layout.classList.toggle('showing-detail', show);
    layout.scrollTop = 0;
    if (!show) layout.querySelector('.history-item.selected')?.scrollIntoView({ block: 'nearest' });
  }

  const HIST_ICON = {
    manual: 'M4 1.5h8l.5.5v12.3l-.8.4L8 12.1l-3.7 2.6-.8-.4V2zM5 2.5v10.8l2.7-1.9h.6l2.7 1.9V2.5z',
    ai: SPARK,
    edit: 'M11.1 1.6a1.6 1.6 0 0 1 2.3 0l1 1a1.6 1.6 0 0 1 0 2.3L5.3 14H2v-3.3zm1.6.7a.6.6 0 0 0-.9 0l-1 1 1.9 1.9 1-1a.6.6 0 0 0 0-.9zM11.9 5.9 10 4 3 11v2h2z',
    restore: 'M8 1a7 7 0 1 1-7 7h1a6 6 0 1 0 1.76-4.24L5.5 5.5H1V1l1.76 1.76A6.98 6.98 0 0 1 8 1',
  };

  // Judul & keterangan tiap versi dalam bahasa sehari-hari.
  // Label versi dipotong server di 80 karakter (lihat versions.go: labelMax).
  const VERSION_LABEL_MAX = 80;

  // Isi permintaan ke AI dari label versi "Sebelum AI: …" (tanda kutip di ujungnya dibuang).
  function aiPrompt(v) {
    const prompt = v.label.replace(/^Sebelum AI:\s*/, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
    if (!prompt) return '';
    return `${prompt[0].toUpperCase()}${prompt.slice(1)}${v.label.length >= VERSION_LABEL_MAX ? '…' : ''}`;
  }

  function versionText(v) {
    if (v.kind === 'manual') return { title: v.label || 'Versi yang kamu simpan', sub: 'Disimpan olehmu' };
    if (v.kind === 'ai') {
      // Judul = isi permintaan ke AI, supaya versi yang satu bisa dibedakan dari yang lain.
      const prompt = aiPrompt(v);
      return prompt ? { title: prompt, sub: 'Sebelum AI mengubah file' } : { title: 'Sebelum AI mengubah', sub: '' };
    }
    if (v.kind === 'restore') return { title: 'Sebelum dikembalikan', sub: v.label.replace(/^Sebelum dikembalikan ke\s*/, 'Lalu dikembalikan ke ') };
    return { title: 'Simpanan otomatis', sub: 'Disimpan sendiri sebelum kamu lanjut mengedit' };
  }

  const timeOf = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  function dayLabel(ms) {
    const d = new Date(ms);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    if (d.toDateString() === today.toDateString()) return 'Hari ini';
    if (d.toDateString() === yesterday.toDateString()) return 'Kemarin';
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  const fullTime = (ms) => new Date(ms).toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  async function historyLoad(selectId) {
    const seq = ++hist.seq;
    if (!hist.list.length) $('#historyList').replaceChildren(h('div', { class: 'history-empty' }, 'Memuat riwayat…'));
    let data;
    try {
      data = await api('GET', '/api/versions');
    } catch (err) {
      return $('#historyList').replaceChildren(h('div', { class: 'history-empty error' }, err.message));
    }
    if (seq !== hist.seq) return;
    hist.list = data.versions;
    hist.history = data.history;
    const keep = selectId ?? hist.selected;
    hist.selected = hist.list.some((v) => v.id === keep) ? keep : hist.list[0]?.id ?? null;
    renderHistoryList();
    if (hist.selected) showVersion(hist.selected);
    else renderHistoryWelcome();
  }

  function renderHistoryList() {
    const { days, max } = hist.history;
    const note = h('p', { class: 'history-note' },
      `Versi disimpan selama ${days} hari (maks. ${max.toLocaleString('id-ID')} versi).`,
      !ai.credits?.plan && ai.credits?.topupEnabled
        ? [' ', h('button', { type: 'button', class: 'link-btn', onclick: () => openTopup('plans') }, 'Ingin riwayat lebih lama?')]
        : null);
    const saveBtn = h('button', { type: 'button', class: 'history-save', onclick: saveVersion }, svg(HIST_ICON.manual), 'Simpan versi sekarang');
    $('#historyLayout').classList.toggle('has-versions', hist.list.length > 0);
    if (!hist.list.length) return $('#historyList').replaceChildren(saveBtn, note);

    const items = [];
    let lastDay = null;
    for (const v of hist.list) {
      const day = dayLabel(v.createdAt);
      if (day !== lastDay) {
        items.push(h('div', { class: 'history-day' }, day));
        lastDay = day;
      }
      const text = versionText(v);
      items.push(h('button', {
        type: 'button',
        class: `history-item ${v.kind}${v.id === hist.selected ? ' selected' : ''}`,
        onclick: () => { hist.selected = v.id; renderHistoryList(); setHistoryDetail(true); showVersion(v.id); },
      },
      h('span', { class: 'history-icon' }, svg(HIST_ICON[v.kind] ?? HIST_ICON.edit)),
      h('span', { class: 'history-text' },
        h('span', { class: 'history-title' }, text.title),
        text.sub ? h('span', { class: 'history-sub' }, text.sub) : null),
      h('span', { class: 'history-time' }, timeOf(v.createdAt))));
    }
    // Penanda kondisi project saat ini: semua versi di bawahnya adalah foto dari waktu sebelumnya.
    const now = h('div', { class: 'history-now' },
      h('span', { class: 'history-now-dot' }),
      h('span', { class: 'history-text' },
        h('span', { class: 'history-title' }, 'Kondisi sekarang'),
        h('span', { class: 'history-sub' }, 'Yang tampil di editor dan website')));
    $('#historyList').replaceChildren(saveBtn, now, ...items, note);
  }

  function renderHistoryWelcome() {
    $('#historyDetail').replaceChildren(h('div', { class: 'history-welcome' },
      h('div', { class: 'history-welcome-icon' }, svg(HIST_ICON.restore)),
      h('h3', {}, 'Belum ada versi tersimpan'),
      h('p', {}, 'Versi adalah “foto” semua file project-mu pada satu waktu. Kalau nanti ada yang rusak atau kamu berubah pikiran, kamu bisa kembali ke versi sebelumnya.'),
      h('ul', {},
        h('li', {}, 'Tersimpan otomatis saat kamu mulai mengedit, dan sebelum AI mengubah file.'),
        h('li', {}, 'Kamu juga bisa menyimpan versi sendiri kapan saja, misalnya sebelum mencoba desain baru.')),
      h('button', { type: 'button', class: 'history-primary', onclick: saveVersion }, 'Simpan versi sekarang')));
  }

  const STATUS_TEXT = {
    changed: { label: 'Berbeda', hint: 'Isinya berubah sejak versi ini' },
    missing: { label: 'Sudah dihapus', hint: 'Ada di versi ini, tapi sekarang sudah tidak ada' },
    new: { label: 'File baru', hint: 'Dibuat setelah versi ini' },
    same: { label: 'Sama', hint: 'Tidak berubah' },
  };

  function restoreText(version) {
    const when = fullTime(version.createdAt);
    const keep = 'Kondisi sekarang disimpan dulu sebagai versi baru, jadi kamu bisa kembali lagi kapan saja.';
    if (version.kind !== 'ai') {
      return {
        title: 'Kembalikan semua file ke versi ini?',
        text: 'Tenang, kondisi sekarang disimpan dulu sebagai versi baru. Jadi kalau berubah pikiran, kamu bisa kembali lagi.',
        button: 'Kembalikan ke versi ini', confirm: `Semua file akan dibuat sama seperti pada ${when}. ${keep}`, done: 'Project dikembalikan ke versi ini',
      };
    }
    const prompt = aiPrompt(version);
    const what = prompt ? `“${prompt}”` : 'ini';
    if (hist.list[0]?.id === version.id) {
      return {
        title: 'Batalkan perubahan AI ini?',
        text: `File dikembalikan ke kondisi sebelum AI mengerjakan permintaan ${what}. ${keep}`,
        button: 'Batalkan perubahan AI', confirm: `File dikembalikan ke kondisi sebelum AI mengerjakan permintaan ${what}. ${keep}`, done: 'Perubahan AI dibatalkan',
      };
    }
    return {
      title: 'Kembali ke sebelum permintaan ini?',
      text: `Perubahan dari permintaan ${what} dan semua perubahan sesudahnya ikut dibatalkan. ${keep}`,
      button: 'Kembalikan ke sebelum ini', confirm: `Semua file dibuat sama seperti pada ${when}, sebelum AI mengerjakan permintaan ${what}. Perubahan sesudahnya ikut dibatalkan. ${keep}`, done: 'Project dikembalikan ke sebelum permintaan ini',
    };
  }

  async function showVersion(id) {
    const seq = ++hist.seq;
    $('#historyDetail').replaceChildren(h('div', { class: 'history-empty' }, 'Membandingkan dengan kondisi sekarang…'));
    await saveAll(); // bandingkan dengan isi yang sudah tersimpan
    let data;
    try {
      data = await api('GET', `/api/versions/${id}`);
    } catch (err) {
      return $('#historyDetail').replaceChildren(h('div', { class: 'history-empty error' }, err.message));
    }
    if (seq !== hist.seq) return;
    hist.detail = data;
    const { version, files } = data;
    const text = versionText(version);
    const count = (s) => files.filter((f) => f.status === s).length;
    const differs = files.filter((f) => f.status !== 'same');

    const summary = differs.length
      ? [
        count('changed') && `${count('changed')} file berbeda`,
        count('missing') && `${count('missing')} file sudah dihapus`,
        count('new') && `${count('new')} file baru`,
      ].filter(Boolean).join(' · ')
      : 'Sama persis dengan kondisi sekarang';

    const fileRow = (f) => {
      const st = STATUS_TEXT[f.status];
      const canRestore = f.status === 'changed' || f.status === 'missing';
      return h('div', { class: `history-file ${f.status}` },
        h('span', { class: 'history-file-name', title: f.path }, fileIcon({ type: 'file', path: f.path }), h('span', {}, f.path)),
        h('span', { class: `history-badge ${f.status}`, title: st.hint }, st.label),
        h('span', { class: 'history-file-actions' },
          f.status !== 'same' ? h('button', { type: 'button', onclick: () => compareFile(version, f) }, 'Lihat perbedaan') : null,
          canRestore ? h('button', { type: 'button', onclick: () => restoreVersion(version, f.path) }, 'Kembalikan file ini') : null));
    };
    const same = files.filter((f) => f.status === 'same');

    $('#historyDetail').replaceChildren(...[
      h('div', { class: 'history-detail-head' },
        h('span', { class: `history-icon big ${version.kind}` }, svg(HIST_ICON[version.kind] ?? HIST_ICON.edit)),
        h('div', {},
          h('h2', {}, text.title),
          h('p', {}, `Kondisi project pada ${fullTime(version.createdAt)}`),
          text.sub ? h('p', { class: 'history-detail-sub' }, text.sub) : null)),
      h('div', { class: `history-summary${differs.length ? '' : ' same'}` }, summary),
      differs.length
        ? h('div', { class: 'history-restore-box' },
          h('div', {},
            h('strong', {}, restoreText(version).title),
            h('p', {}, restoreText(version).text)),
          h('button', { type: 'button', class: 'history-primary', onclick: () => restoreVersion(version) }, restoreText(version).button))
        : null,
      differs.length ? h('h4', { class: 'history-files-title' }, 'Yang berbeda dari sekarang') : null,
      differs.length ? h('div', { class: 'history-files' }, differs.map(fileRow)) : null,
      same.length ? h('details', { class: 'history-same' },
        h('summary', {}, `${same.length} file tidak berubah`),
        h('div', { class: 'history-files' }, same.map(fileRow))) : null,
      h('p', { class: 'history-db-note' }, 'Catatan: data di tab Data (database) tidak ikut dikembalikan, supaya data dari pengunjung tidak hilang.'),
    ].filter(Boolean));
  }

  async function versionFileText(version, path) {
    const { content } = await api('GET', `/api/versions/${version.id}/file?path=${encodeURIComponent(path)}`);
    return content;
  }

  async function versionImageUrl(version, path) {
    const res = await fetch(`/api/versions/${version.id}/file?path=${encodeURIComponent(path)}`, {
      headers: state.projectSlug ? { 'X-Project': state.projectSlug } : {},
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('Gambar versi ini tidak bisa dimuat');
    return URL.createObjectURL(await res.blob());
  }

  // Bandingkan isi file di versi (kiri) dengan sekarang (kanan).
  async function compareFile(version, f) {
    try {
      if (f.image) return compareImage(version, f);
      const before = f.status === 'new' ? '' : await versionFileText(version, f.path);
      const now = f.status === 'missing' ? '' : (await api('GET', `/api/files/content?path=${encodeURIComponent(f.path)}`)).content;
      showDiff({ path: f.path, content: now }, before, `Kiri: versi ${fullTime(version.createdAt)} · Kanan: sekarang`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function compareImage(version, f) {
    const root = $('#modal');
    const urls = [];
    const close = () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      root.hidden = true;
      root.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const side = async (label, loader) => {
      let content;
      try {
        const url = await loader();
        if (url) urls.push(url);
        content = url ? h('img', { src: url, alt: label }) : h('span', { class: 'history-none' }, 'Tidak ada');
      } catch (err) {
        content = h('span', { class: 'history-none' }, err.message);
      }
      return h('figure', {}, h('div', { class: 'image-stage' }, content), h('figcaption', {}, label));
    };
    const [left, right] = await Promise.all([
      side(`Versi ${fullTime(version.createdAt)}`, () => (f.status === 'new' ? null : versionImageUrl(version, f.path))),
      side('Sekarang', () => (f.status === 'missing' ? null : `${imageUrl(f.path)}`)),
    ]);
    root.replaceChildren(h('div', { class: 'modal image-modal history-image-modal', role: 'dialog', 'aria-label': `Perbandingan ${f.path}` },
      h('div', { class: 'topup-head' },
        h('div', {}, h('h3', {}, baseName(f.path)), h('p', {}, 'Kiri: versi lama · Kanan: sekarang')),
        h('button', { class: 'icon-btn', type: 'button', title: 'Tutup', onclick: close }, svg(ICON.close))),
      h('div', { class: 'history-image-compare' }, left, right),
      h('div', { class: 'modal-buttons' }, h('button', { type: 'button', class: 'primary', onclick: close }, 'Tutup'))));
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);
  }

  async function saveVersion() {
    const label = await modal({
      title: 'Simpan versi',
      message: 'Beri nama supaya mudah ditemukan nanti (boleh dikosongkan).',
      input: { placeholder: 'mis. Sebelum ganti warna', value: '' },
      buttons: [{ label: 'Simpan', primary: true }, { label: 'Batal', value: null }],
    });
    if (label === null) return;
    try {
      await saveAll();
      const { id } = await api('POST', '/api/versions', { label });
      toast('Versi disimpan');
      if ($('#editorArea').dataset.mode === 'history') historyLoad(id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Kembalikan seluruh project (atau satu file) ke versi.
  async function restoreVersion(version, path = null) {
    const files = hist.detail?.files ?? [];
    const removed = path ? [] : files.filter((f) => f.status === 'new').map((f) => f.path);
    const text = restoreText(version);
    const ok = await modal({
      title: path ? 'Kembalikan file ini?' : text.title,
      message: [
        path
          ? `"${path}" akan dibuat sama seperti pada ${fullTime(version.createdAt)}. Kondisi sekarang disimpan dulu sebagai versi baru, jadi kamu bisa kembali lagi kapan saja.`
          : text.confirm,
        removed.length ? ` File yang dibuat setelahnya akan dihapus: ${removed.join(', ')}.` : '',
      ].join(''),
      buttons: [{ label: path ? 'Ya, kembalikan' : `Ya, ${text.button[0].toLowerCase()}${text.button.slice(1)}`, value: true, primary: true }, { label: 'Batal', value: null }],
    });
    if (!ok) return;
    try {
      await saveAll();
      const { touched } = await api('POST', `/api/versions/${version.id}/restore`, path ? { path } : {});
      await syncFromServer(touched);
      toast(touched.length ? (path ? 'File dikembalikan' : text.done) : 'Tidak ada yang perlu dikembalikan');
      historyLoad(version.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------- Asisten AI untuk website pengguna ----------
  // Disembunyikan sementara dari editor (menu & daftar keuntungan paket). Server, widget di website yang sudah
  // mengaktifkannya, dan dashboard owner tetap berjalan; ubah ke true untuk menampilkannya lagi.
  const SHOW_ASSISTANT = false;
  const WIDGET_TAG = '<script src="/api/ai/widget.js" defer></script>';
  const INSTRUCTION_EXAMPLE = [
    'Kamu adalah customer service Toko Kue Bu Sri.',
    '- Produk: bolu pandan Rp45.000, brownies Rp50.000, kue lapis Rp60.000.',
    '- Pesan lewat WhatsApp 0812-3456-7890, minimal H-1.',
    '- Buka Senin–Sabtu, 08.00–17.00. Kirim area Bandung saja.',
    'Jawab ramah dan singkat. Kalau ditanya hal di luar toko, arahkan kembali ke produk kami.',
  ].join('\n');

  async function openAssistant() {
    const root = $('#modal');
    const body = h('div', { class: 'modal assistant-modal', role: 'dialog', 'aria-label': 'Asisten AI website' });
    const close = () => {
      root.hidden = true;
      root.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); close(); } };
    root.replaceChildren(body);
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);

    const head = h('div', { class: 'topup-head' },
      h('div', {}, h('h3', {}, 'Asisten AI untuk websitemu'),
        h('p', {}, 'Pengunjung websitemu bisa bertanya kapan saja, dan dijawab AI sesuai instruksimu.')),
      h('button', { class: 'icon-btn', type: 'button', title: 'Tutup', onclick: close }, svg(ICON.close)));
    body.replaceChildren(head, h('div', { class: 'topup-loading' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), 'Memuat…'));

    let data;
    try {
      data = await api('GET', '/api/assistant');
    } catch (err) {
      return body.replaceChildren(head, h('p', { class: 'topup-error' }, err.message));
    }
    if (!data.available || !data.models.length) {
      return body.replaceChildren(head, h('p', { class: 'topup-error' }, 'Asisten AI belum tersedia di server ini.'));
    }
    const s = data.settings;

    // --- Status & saldo
    const enabled = h('input', { type: 'checkbox', checked: s.enabled });
    const wallet = data.wallet;
    const statusRow = h('div', { class: 'asst-status' },
      h('label', { class: 'switch asst-switch' }, enabled, h('span', { class: 'track' }, h('span', { class: 'thumb' })),
        h('span', {}, h('strong', {}, 'Aktifkan asisten'), h('small', {}, 'Kalau mati, gelembung chat tidak muncul di websitemu.'))),
      s.blocked ? h('span', { class: 'asst-pill bad' }, 'Diblokir admin') : null);
    const balance = h('div', { class: 'asst-balance' },
      h('div', {},
        h('span', { class: 'asst-label' }, 'Saldo asisten'),
        h('strong', {}, rupiah(Math.floor(wallet.available))),
        h('small', {}, wallet.allowance
          ? `Termasuk jatah ${wallet.allowance.plan} ${rupiah(Math.floor(wallet.allowance.remaining))} (terisi lagi ${shortDate(wallet.allowance.resetsAt)}) + saldo ${rupiah(Math.floor(wallet.balance))}`
          : 'Dipakai setiap kali asisten menjawab. Saldo tidak hangus.')),
      data.packages.length
        ? h('button', { type: 'button', class: 'asst-topup', onclick: () => { close(); openTopup('assistant', { after: openAssistant }); } }, 'Isi saldo')
        : null);

    // --- Pilihan model
    let modelKey = s.modelKey;
    const modelCards = data.models.map((m) => h('button', {
      type: 'button',
      class: 'asst-model',
      onclick: () => { modelKey = m.key; markModels(); },
    },
    h('span', { class: 'asst-tier' }, m.tier || m.name),
    h('strong', {}, m.name),
    h('span', { class: 'asst-price' }, `≈ ${rupiah(m.perMessage)} per jawaban`),
    h('small', {}, `≈ ${rupiah(m.per1k)} per 1.000 jawaban`)));
    const markModels = () => modelCards.forEach((c, i) => c.classList.toggle('selected', data.models[i].key === modelKey));
    markModels();

    // --- Isian
    const nameInput = h('input', { value: s.name, maxlength: '40', placeholder: 'mis. Sri, CS Toko Kue' });
    const greetInput = h('input', { value: s.greeting, maxlength: '200' });
    const instr = h('textarea', { rows: '7', maxlength: '4000', placeholder: INSTRUCTION_EXAMPLE });
    instr.value = s.instructions;
    const capInput = h('input', { type: 'number', min: '100', step: '500', value: String(s.dailyCap) });
    const field = (label, input, hint, extra) => h('label', { class: 'asst-field' },
      h('span', {}, label, extra ?? null), input, hint ? h('small', {}, hint) : null);

    // --- Pemakaian 7 hari
    const maxMsg = Math.max(1, ...data.usage.map((u) => u.messages));
    const usage = h('div', { class: 'asst-usage' },
      h('div', { class: 'asst-bars' }, data.usage.map((u) => h('span', {
        class: 'bar',
        title: `${new Date(`${u.day}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}: ${u.messages} jawaban · ${rupiah(u.spent)}`,
      }, h('i', { style: `height:${Math.max(4, (u.messages / maxMsg) * 100)}%` })))),
      h('small', {}, `7 hari terakhir: ${data.usage.reduce((n, u) => n + u.messages, 0)} jawaban · ${rupiah(Math.round(data.usage.reduce((n, u) => n + u.spent, 0)))}`));

    // --- Cara pasang
    const install = h('div', { class: 'asst-install' },
      h('p', {}, 'Tempel baris ini sebelum ', h('code', {}, '</body>'), ' di halaman yang ingin punya asisten, atau minta AI: “tambahkan asisten chat di websiteku”.'),
      h('div', { class: 'snippet' },
        h('code', {}, WIDGET_TAG),
        h('button', { type: 'button', onclick: () => copyText(WIDGET_TAG, 'Kode disalin') }, 'Salin')),
      h('button', { type: 'button', class: 'link-btn', onclick: installWidget }, 'Pasang otomatis di index.html'));

    const status = h('span', { class: 'asst-save-status' });
    const saveBtn = h('button', { type: 'submit', class: 'primary' }, 'Simpan');
    const form = h('form', { class: 'asst-form', onsubmit: async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      status.textContent = 'Menyimpan…';
      try {
        await api('PUT', '/api/assistant', {
          enabled: enabled.checked, modelKey, name: nameInput.value, greeting: greetInput.value,
          instructions: instr.value, dailyCap: Number(capInput.value),
        });
        status.textContent = 'Tersimpan ✓';
        toast(enabled.checked ? 'Asisten aktif di websitemu' : 'Pengaturan asisten disimpan');
        schedulePreviewReload();
      } catch (err) {
        status.textContent = '';
        toast(err.message, 'error');
      } finally {
        saveBtn.disabled = false;
      }
    } },
    statusRow,
    balance,
    h('h4', {}, 'Pilih otak asistennya'),
    s.modelFallback ? h('p', { class: 'asst-note' }, 'Model yang kamu pilih sebelumnya sedang tidak tersedia, jadi sementara asisten memakai model di bawah yang ditandai. Simpan untuk memakainya seterusnya.') : null,
    h('div', { class: 'asst-models' }, modelCards),
    h('h4', {}, 'Kenalkan asistenmu'),
    h('div', { class: 'asst-grid' },
      field('Nama asisten', nameInput),
      field('Sapaan pembuka', greetInput)),
    field('Apa yang perlu diketahui asisten?', instr,
      'Tulis info usaha/websitemu: produk, harga, jam buka, cara pesan, dan gaya bicara. Asisten hanya menjawab berdasarkan ini.',
      h('button', { type: 'button', class: 'link-btn', onclick: () => { instr.value = INSTRUCTION_EXAMPLE; instr.focus(); } }, 'Pakai contoh')),
    field('Batas pemakaian per hari (Rp)', capInput, 'Supaya saldo aman walau websitemu tiba-tiba ramai. Asisten berhenti sampai besok kalau batas tercapai.'),
    h('h4', {}, 'Pemakaian'),
    usage,
    h('h4', {}, 'Pasang di websitemu'),
    install,
    h('div', { class: 'modal-buttons' }, status, h('button', { type: 'button', onclick: close }, 'Tutup'), saveBtn));
    body.replaceChildren(head, form);

    // Sisipkan tag widget sebelum </body> di index.html (kalau belum ada).
    async function installWidget() {
      try {
        await saveAll();
        const { content } = await api('GET', '/api/files/content?path=index.html');
        if (content.includes('/api/ai/widget.js')) return toast('Asisten sudah terpasang di index.html');
        const next = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, `  ${WIDGET_TAG}\n</body>`) : `${content}\n${WIDGET_TAG}\n`;
        await api('PUT', '/api/files/content', { path: 'index.html', content: next });
        await syncFromServer(['index.html']);
        toast(enabled.checked ? 'Asisten dipasang di index.html' : 'Dipasang. Jangan lupa aktifkan & simpan.');
      } catch (err) {
        toast(err.message.includes('tidak ditemukan') ? 'index.html tidak ada. Tempel kodenya manual di halamanmu.' : err.message, 'error');
      }
    }
  }

  // ---------- Langganan & isi ulang kredit (QRIS) ----------
  const rupiah = (n) => `Rp${n.toLocaleString('id-ID')}`;
  const shortDate = (iso) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
  const PLAN_RANK = { pro: 1, unlimited: 2 };

  // tab: 'plans' (langganan) | 'credits' (paket kredit). Default: langganan kalau belum berlangganan.
  // intro: tampilan sambutan saat editor pertama kali dibuka (ada tombol "Nanti saja").
  // tab 'assistant': isi ulang Saldo Asisten AI website; `after` dipanggil setelah modal ditutup dari layar sukses.
  function openTopup(tab, { intro = false, after = null } = {}) {
    const root = $('#modal');
    const body = h('div', { class: 'modal topup-modal', role: 'dialog', 'aria-label': 'Langganan & kredit AI' });
    let pollTimer;
    let countdownTimer;
    let closed = false;

    const stopTimers = () => {
      clearTimeout(pollTimer);
      clearInterval(countdownTimer);
    };
    // Tampilan promosi memakai modal lebar di tengah layar; kembali normal saat lanjut ke pembayaran/ditutup.
    const setPromoLayout = (on) => {
      root.classList.toggle('promo-backdrop', on);
      body.classList.toggle('promo-modal', on);
    };
    const close = () => {
      closed = true;
      stopTimers();
      setPromoLayout(false);
      root.hidden = true;
      root.replaceChildren();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

    root.replaceChildren(body);
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);

    const head = (title, subtitle) => h('div', { class: 'topup-head' },
      h('div', {}, h('h3', {}, title), subtitle ? h('p', {}, subtitle) : null),
      h('button', { class: 'icon-btn', type: 'button', title: 'Tutup', onclick: close }, svg(ICON.close)));
    const loadingView = (text) => h('div', { class: 'topup-loading' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), text);
    const errorView = (message) => [
      h('p', { class: 'topup-error' }, message),
      h('div', { class: 'modal-buttons' }, h('button', { type: 'button', class: 'primary', onclick: showPackages }, 'Coba lagi')),
    ];

    let data;
    async function showPackages() {
      stopTimers();
      body.replaceChildren(head('Langganan & kredit AI'), loadingView('Memuat paket…'));
      try {
        data = await api('GET', '/api/billing/packages');
      } catch (err) {
        return body.replaceChildren(head('Langganan & kredit AI'), ...errorView(err.message));
      }
      if (closed) return;
      ai.credits = data.credits;
      renderCredits();
      if (tab === 'assistant') {
        if (!data.enabled || !data.assistantPackages?.length) {
          return body.replaceChildren(head('Isi saldo asisten'), h('p', { class: 'topup-error' }, 'Pembayaran belum tersedia saat ini.'));
        }
        return showAssistantPackages();
      }
      if (!data.enabled || (!data.packages.length && !data.plans.length)) {
        return body.replaceChildren(head('Langganan & kredit AI'),
          h('p', { class: 'topup-error' }, 'Pembayaran belum tersedia saat ini.'));
      }
      if (intro) {
        if (!data.plans.length || data.credits.plan) return close(); // tidak ada yang bisa ditawarkan
        return showPromo();
      }
      if (!data.plans.length) tab = 'credits';
      if (!data.packages.length) tab = 'plans';
      tab ??= data.credits.plan ? 'credits' : 'plans';
      if (tab === 'plans') showPlans();
      else showCredits();
    }

    const tabs = () => (data.plans.length && data.packages.length
      ? h('div', { class: 'topup-tabs', role: 'tablist' }, [['plans', 'Langganan'], ['credits', 'Isi kredit']].map(([id, label]) => h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(tab === id),
        onclick: () => { tab = id; if (id === 'plans') showPlans(); else showCredits(); },
      }, label)))
      : null);

    // Promosi langganan untuk pengguna gratis (muncul maks. sekali sehari, lihat maybeShowPlansIntro).
    function showPromo() {
      setPromoLayout(true);
      const free = data.credits;
      const freeStore = data.free?.storage;
      const times = (a, b) => (a && b && a / b >= 1.5 ? `${Math.round(a / b)}×` : null);
      const CHECK = 'M6.2 11.6 2.9 8.3l-.9.9 4.2 4.2 8-8-.9-.9z';
      const RIBBON = { pro: 'Paling populer', unlimited: 'Paling lega' };

      const features = (plan) => [
        plan.credits
          ? [`${plan.credits.toLocaleString('id-ID')} kredit AI / 30 hari`, times(plan.credits, free.limit * 30)]
          : [`AI hingga ${plan.dailyLimit} prompt / hari`, times(plan.dailyLimit, free.limit)],
        [`Storage ${mb(plan.storage.totalSize)} per project`, times(plan.storage.totalSize, freeStore?.totalSize)],
        [`Database ${mb(plan.storage.dbBytes)} per project`, times(plan.storage.dbBytes, freeStore?.dbBytes)],
        [`Gambar hingga ${mb(plan.storage.imageSize)} per file`, times(plan.storage.imageSize, freeStore?.imageSize)],
        [`${plan.storage.entries.toLocaleString('id-ID')} file & folder`, times(plan.storage.entries, freeStore?.entries)],
        [`Riwayat versi ${plan.history.days} hari`, times(plan.history.days, data.free?.history?.days)],
        ...(SHOW_ASSISTANT && plan.assistant ? [[`Saldo asisten AI website ${rupiah(plan.assistant)}/30 hari`, null]] : []),
      ];
      const cards = data.plans.map((plan, i) => h('div', { class: `promo-card ${plan.id}`, style: `--delay:${120 + i * 90}ms` },
        RIBBON[plan.id] ? h('span', { class: 'promo-ribbon' }, RIBBON[plan.id]) : null,
        h('div', { class: 'promo-name' }, plan.name),
        h('div', { class: 'promo-price' }, rupiah(plan.price), h('span', {}, '/30 hari')),
        h('ul', { class: 'promo-features' }, features(plan).map(([text, mult]) => h('li', {},
          svg(CHECK), h('span', {}, text), mult ? h('b', { class: 'promo-mult', title: 'dibanding paket Gratis' }, mult) : null))),
        h('button', { type: 'button', class: 'promo-cta', onclick: () => startPayment({ planId: plan.id }) }, `Mulai ${plan.name}`)));

      const left = free.freeRemaining;
      const bonus = free.bonusRemaining ?? 0;
      body.replaceChildren(...[
        h('button', { class: 'icon-btn promo-close', type: 'button', title: 'Tutup', onclick: close }, svg(ICON.close)),
        h('div', { class: 'promo-hero' },
          h('span', { class: 'promo-orb a' }), h('span', { class: 'promo-orb b' }),
          h('span', { class: 'promo-kicker' }, svg(SPARK), 'Upgrade rakit.io'),
          h('h2', {}, 'Bangun lebih banyak, lebih cepat.'),
          h('p', {}, 'Kredit AI berlimpah, storage lega, dan upload gambar lebih besar.'),
          bonus
            ? h('div', { class: 'promo-today' },
              h('span', {}, `Bonus awal ${bonus} kredit masih tersedia (sekali, tidak berkurang tiap hari)`))
            : null,
          free.limit
            ? h('div', { class: `promo-today${left ? '' : ' empty'}` },
              h('span', {}, left ? `Kredit gratis hari ini tinggal ${left} dari ${free.limit}` : `Kredit gratis hari ini (${free.limit}) sudah habis`),
              h('span', { class: 'promo-meter' }, h('i', { style: `width:${free.limit ? (left / free.limit) * 100 : 0}%` })))
            : null),
        h('div', { class: 'promo-grid' }, cards),
        h('ul', { class: 'promo-trust' },
          h('li', {}, svg(CHECK), 'Bayar QRIS — semua e-wallet & m-banking'),
          h('li', {}, svg(CHECK), 'Aktif instan setelah bayar'),
          h('li', {}, svg(CHECK), 'Tanpa tagihan otomatis')),
        data.livemode ? null : h('p', { class: 'topup-test promo-test' }, 'Mode uji coba — tidak ada uang sungguhan yang ditarik.'),
        h('button', { type: 'button', class: 'promo-later', onclick: close }, 'Nanti saja, lanjut dengan paket Gratis'),
      ].filter(Boolean));
    }

    function showPlans() {
      const current = data.credits.plan;
      const features = (plan) => [
        plan.credits ? `${plan.credits.toLocaleString('id-ID')} kredit AI tiap 30 hari` : `AI tanpa kuota bulanan (maks. ${plan.dailyLimit} prompt/hari)`,
        `Storage ${mb(plan.storage.totalSize)} per project`,
        `Database ${mb(plan.storage.dbBytes)} per project`,
        `Upload gambar hingga ${mb(plan.storage.imageSize)} per file`,
        `Riwayat versi ${plan.history.days} hari`,
        SHOW_ASSISTANT && plan.assistant ? `Saldo asisten AI website ${rupiah(plan.assistant)} / 30 hari` : null,
        `Maks. ${plan.storage.entries.toLocaleString('id-ID')} file & folder`,
      ];
      const cards = data.plans.map((plan) => {
        const isCurrent = current?.id === plan.id;
        const lower = current && PLAN_RANK[plan.id] < PLAN_RANK[current.id];
        const label = isCurrent ? 'Perpanjang 30 hari' : lower ? `Kamu sudah ${current.name}` : current ? `Upgrade ke ${plan.name}` : `Pilih ${plan.name}`;
        return h('div', { class: `plan-card${isCurrent ? ' current' : ''}${plan.id === 'unlimited' ? ' featured' : ''}` },
          h('div', { class: 'plan-name' }, plan.name, isCurrent ? h('span', { class: 'plan-tag' }, 'Aktif') : null),
          h('div', { class: 'plan-price' }, rupiah(plan.price), h('span', {}, ' / 30 hari')),
          h('ul', { class: 'plan-features' }, features(plan).filter(Boolean).map((text) => h('li', {}, text))),
          h('button', {
            type: 'button',
            class: lower ? '' : 'primary',
            disabled: lower,
            onclick: () => startPayment({ planId: plan.id }),
          }, label));
      });

      const free = data.credits;
      const status = current
        ? h('div', { class: 'topup-balance' },
          h('span', {}, `Paket ${current.name} aktif sampai `, h('strong', {}, shortDate(current.expiresAt))),
          h('strong', {}, current.id === 'unlimited' ? `${current.quotaRemaining}/${current.quota} prompt hari ini` : `${current.quotaRemaining} kredit`))
        : h('div', { class: 'topup-balance' },
          h('span', {}, 'Paket sekarang: ', h('strong', {}, 'Gratis')),
          h('span', {}, `Bonus awal ${free.bonusLimit} kredit + ${free.limit} kredit/hari · storage 20 MB`));

      body.replaceChildren(...[
        intro
          ? head('Bangun lebih banyak dengan rakit.io', 'Kamu sedang memakai paket Gratis. Berlangganan untuk kredit AI lebih banyak dan storage lebih besar. Bayar sekali dengan QRIS untuk 30 hari, tanpa tagihan otomatis.')
          : head('Langganan rakit.io', 'Bayar sekali dengan QRIS untuk 30 hari, tanpa tagihan otomatis. Bonus storage langsung aktif setelah pembayaran.'),
        intro ? null : tabs(),
        status,
        h('div', { class: 'plan-grid' }, cards),
        current && current.id !== 'unlimited' && data.plans.some((p) => p.id === 'unlimited')
          ? h('p', { class: 'topup-note' }, `Upgrade ke Unlimited: sisa masa aktif ${current.name} dikonversi jadi hari Unlimited sesuai harga.`)
          : null,
        data.livemode ? null : h('p', { class: 'topup-test' }, 'Mode uji coba — tidak ada uang sungguhan yang ditarik.'),
        intro ? h('div', { class: 'modal-buttons' }, h('button', { type: 'button', onclick: close }, 'Nanti saja, pakai paket Gratis')) : null,
      ].filter(Boolean));
    }

    function showCredits() {

      let selected = data.packages[Math.min(1, data.packages.length - 1)];
      const cards = data.packages.map((pkg) => h('button', {
        type: 'button',
        class: 'pkg',
        onclick: () => { selected = pkg; mark(); },
      },
      h('span', { class: 'pkg-credits' }, String(pkg.credits)),
      h('span', { class: 'pkg-label' }, 'kredit'),
      h('span', { class: 'pkg-price' }, rupiah(pkg.price))));
      const mark = () => cards.forEach((card, i) => card.classList.toggle('selected', data.packages[i] === selected));
      mark();

      const c = data.credits;
      body.replaceChildren(...[
        head('Isi ulang kredit AI', 'Kredit yang dibeli tidak hangus, dan dipakai setelah kuota langganan & kredit gratis harianmu habis.'),
        tabs(),
        h('div', { class: 'topup-balance' },
          h('span', {}, 'Sisa kredit sekarang'),
          h('strong', {}, `${c.remaining} kredit`)),
        h('div', { class: 'pkg-grid' }, cards),
        data.livemode ? null : h('p', { class: 'topup-test' }, 'Mode uji coba — tidak ada uang sungguhan yang ditarik.'),
        h('div', { class: 'modal-buttons' },
          h('button', { type: 'button', onclick: close }, 'Batal'),
          h('button', { type: 'button', class: 'primary', onclick: () => startPayment({ packageId: selected.id }) }, 'Bayar dengan QRIS')),
      ].filter(Boolean)); // replaceChildren() bawaan browser menulis null sebagai teks "null"
    }

    // Paket isi ulang Saldo Asisten AI (Rupiah dibayar = saldo yang didapat).
    function showAssistantPackages() {
      let selected = data.assistantPackages[Math.min(1, data.assistantPackages.length - 1)];
      const cards = data.assistantPackages.map((pkg) => h('button', {
        type: 'button',
        class: 'pkg',
        onclick: () => { selected = pkg; mark(); },
      },
      h('span', { class: 'pkg-credits' }, rupiah(pkg.amount)),
      h('span', { class: 'pkg-label' }, 'saldo asisten')));
      const mark = () => cards.forEach((card, i) => card.classList.toggle('selected', data.assistantPackages[i] === selected));
      mark();
      body.replaceChildren(...[
        head('Isi saldo asisten AI', 'Saldo dipakai setiap kali asisten menjawab pengunjung websitemu. Saldo tidak hangus.'),
        h('div', { class: 'pkg-grid' }, cards),
        data.livemode ? null : h('p', { class: 'topup-test' }, 'Mode uji coba — tidak ada uang sungguhan yang ditarik.'),
        h('div', { class: 'modal-buttons' },
          h('button', { type: 'button', onclick: close }, 'Batal'),
          h('button', { type: 'button', class: 'primary', onclick: () => startPayment({ assistantPackageId: selected.id }) }, 'Bayar dengan QRIS')),
      ].filter(Boolean));
    }

    async function startPayment(item) {
      setPromoLayout(false);
      body.replaceChildren(head('Pembayaran'), loadingView('Membuat kode QRIS…'));
      try {
        const { payment } = item.planId
          ? await api('POST', '/api/billing/subscribe', { planId: item.planId })
          : item.assistantPackageId
            ? await api('POST', '/api/billing/assistant-topup', { packageId: item.assistantPackageId })
            : await api('POST', '/api/billing/topup', { packageId: item.packageId });
        if (!closed) showPayment(payment);
      } catch (err) {
        if (!closed) body.replaceChildren(head('Pembayaran'), ...errorView(err.message));
      }
    }

    function showPayment(payment) {
      const timer = h('strong', {}, '');
      const status = h('div', { class: 'pay-status' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), 'Menunggu pembayaran…');
      const qr = payment.qr
        ? h('img', { class: 'qr', src: payment.qr, alt: 'Kode QRIS' })
        : h('div', { class: 'qr qr-missing' }, 'Kode QR tidak tersedia. Gunakan halaman pembayaran.');

      body.replaceChildren(
        head('Scan untuk membayar', payment.plan ? `Langganan ${payment.plan} 30 hari` : payment.assistant ? `Saldo Asisten AI ${rupiah(payment.amount)}` : `${payment.credits} kredit AI`),
        h('div', { class: 'pay-body' },
          h('div', { class: 'qr-card' },
            h('div', { class: 'qris-label' }, 'QRIS'),
            qr,
            h('div', { class: 'pay-amount' }, rupiah(payment.amount)),
            h('div', { class: 'pay-timer' }, 'Bayar dalam ', timer)),
          h('div', { class: 'pay-side' },
            h('p', { class: 'pay-title' }, payment.instructions?.title || 'Cara membayar'),
            h('ol', { class: 'pay-steps' }, (payment.instructions?.steps?.length
              ? payment.instructions.steps
              : ['Buka aplikasi e-wallet atau mobile banking yang mendukung QRIS.', 'Scan kode QR di samping.', 'Periksa nominal, lalu konfirmasi pembayaran.']
            ).map((step) => h('li', {}, step))),
            status,
            payment.checkoutUrl ? h('a', { class: 'pay-link', href: payment.checkoutUrl, target: '_blank', rel: 'noopener' }, 'Buka halaman pembayaran ↗') : null)),
        h('div', { class: 'modal-buttons' },
          h('button', { type: 'button', onclick: () => { tab = payment.plan ? 'plans' : payment.assistant ? 'assistant' : 'credits'; showPackages(); } }, 'Ganti paket'),
          h('button', { type: 'button', onclick: close }, 'Tutup')),
      );

      const tick = () => {
        const ms = Date.parse(payment.expiresAt) - Date.now();
        if (Number.isNaN(ms)) return (timer.textContent = '—');
        if (ms <= 0) return showEnded('expired');
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
      };
      tick();
      countdownTimer = setInterval(tick, 1000);

      const poll = async () => {
        if (closed) return;
        try {
          const res = await api('GET', `/api/billing/payments/${encodeURIComponent(payment.id)}`);
          if (closed) return;
          if (res.credits) { ai.credits = res.credits; renderCredits(); }
          if (res.payment.status === 'succeeded') return showSuccess(res.payment, res.credits);
          if (res.payment.status !== 'pending') return showEnded(res.payment.status);
        } catch { /* coba lagi di putaran berikutnya */ }
        pollTimer = setTimeout(poll, 3000);
      };
      pollTimer = setTimeout(poll, 3000);
    }

    function showSuccess(payment, credits) {
      stopTimers();
      const plan = credits?.plan;
      if (payment.plan) loadTree().catch(() => {}); // perbarui kuota storage di sidebar
      body.replaceChildren(
        head('Pembayaran berhasil'),
        h('div', { class: 'topup-result ok' },
          h('div', { class: 'result-icon' }, '✓'),
          payment.assistant
            ? [h('h4', {}, `+${rupiah(payment.amount)} saldo asisten`),
              h('p', {}, 'Asisten di websitemu siap menjawab pengunjung. Terima kasih!')]
            : payment.plan
            ? [h('h4', {}, `${plan?.name ?? payment.plan} aktif`),
              h('p', {}, plan ? `Berlaku sampai ${shortDate(plan.expiresAt)}. Bonus storage sudah aktif di semua project-mu. Terima kasih!` : 'Terima kasih!')]
            : [h('h4', {}, `+${payment.credits} kredit ditambahkan`),
              h('p', {}, `Sisa kreditmu sekarang ${credits?.remaining ?? ''} kredit. Terima kasih!`)]),
        h('div', { class: 'modal-buttons' },
          payment.assistant
            ? h('button', { type: 'button', class: 'primary', onclick: () => { close(); after?.(); } }, 'Kembali ke pengaturan asisten')
            : h('button', { type: 'button', class: 'primary', onclick: () => { close(); setMode('ai'); } }, 'Lanjut pakai AI')),
      );
    }

    function showEnded(status) {
      stopTimers();
      const text = {
        expired: 'Waktu pembayaran habis. Buat kode QRIS baru untuk mencoba lagi.',
        failed: 'Pembayaran gagal. Silakan coba lagi.',
        canceled: 'Pembayaran dibatalkan.',
      }[status] ?? 'Pembayaran tidak dapat diproses.';
      body.replaceChildren(
        head('Pembayaran tidak selesai'),
        h('div', { class: 'topup-result' }, h('div', { class: 'result-icon' }, '!'), h('p', {}, text)),
        h('div', { class: 'modal-buttons' },
          h('button', { type: 'button', onclick: close }, 'Tutup'),
          h('button', { type: 'button', class: 'primary', onclick: showPackages }, 'Coba lagi')),
      );
    }

    showPackages();
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
    bindDiagramEvents();
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
