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
    chevron: 'M5.7 13.7 5 13l5-5-5-5 .7-.7L11.4 8z',
    close: 'm8 8.7 3.6 3.6.7-.7L8.7 8l3.6-3.6-.7-.7L8 7.3 4.4 3.7l-.7.7L7.3 8l-3.6 3.6.7.7z',
    folder: 'M14.5 3H7.7l-1-1.4-.4-.1H1.5l-.5.5v11l.5.5h13l.5-.5v-9.5zM14 13H2V6h12zm0-8H7.3l-.4.1-.6.9H2V2.5h4.1l1 1.4.4.1H14z',
    table: 'M1.5 2h13l.5.5v11l-.5.5h-13l-.5-.5v-11zM2 3v3h5V3zm6 0v3h6V3zM2 7v3h5V7zm6 0v3h6V7zm-6 4v2h5v-2zm6 0v2h6v-2z',
    lock: 'M8 1a3 3 0 0 0-3 3v2H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3m2 5H6V4a2 2 0 1 1 4 0z',
    trash: 'M6 1h4l.5.5V3H14v1h-1v10.5l-.5.5h-9l-.5-.5V4H2V3h3.5V1.5zM6.5 3h3V2h-3zM4 4v10h8V4zm2 2h1v6H6zm3 0h1v6H9z',
    refresh: 'M13.45 5.17A6 6 0 1 0 14 8h-1a5 5 0 1 1-.8-2.73l-1.7.23.14 1 3.4-.5-.5-3.4-1 .14z',
    gear: 'M9.1 1l.4 1.9 1 .4 1.6-1.1 1.6 1.6-1.1 1.6.4 1 1.9.4v2.3l-1.9.4-.4 1 1.1 1.6-1.6 1.6-1.6-1.1-1 .4-.4 1.9H6.9l-.4-1.9-1-.4-1.6 1.1-1.6-1.6 1.1-1.6-.4-1L1 9.1V6.9l1.9-.4.4-1-1.1-1.6 1.6-1.6 1.6 1.1 1-.4L6.9 1zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
    folderOpen: 'M1.5 14h11l.5-.4 2.6-6.9-.5-.7H14V4.5l-.5-.5H7.7l-.9-.9-.3-.1H1.5l-.5.5v10zM2 3h4.3l.8.8.4.2H13v2H4l-.5.3L2 10.4zm10.1 10H2.2l2.2-6h9.9z',
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
    autosave: storage.get('rakit.autosave', true),
  };
  let monaco;
  let editor;

  // ---------- API ----------
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      location.href = '/';
      throw new Error('Sesi berakhir');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
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
        editor?.focus();
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
    const label = { html: '<>', css: '#', js: 'JS' }[ext] ?? '•';
    return h('span', { class: `ficon ${ext}` }, label);
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
        h('button', { type: 'button', class: 'row-more', title: 'Menu', 'aria-label': `Menu ${entry.name}` }, '⋯')));
        if (isDir && open) walk(entry.path, depth + 1);
      }
    };
    walk('', 0);
    if (!rows.length) rows.push(h('div', { class: 'empty' }, 'Belum ada file. Klik kanan di sini atau pakai tombol + di atas.'));
    tree.replaceChildren(...rows);
  }

  function renderUsage(usage) {
    const pct = Math.min(100, (usage.size / usage.limits.totalSize) * 100);
    $('#usage').replaceChildren(
      `${formatBytes(usage.size)} / ${formatBytes(usage.limits.totalSize)} · ${usage.entries} item`,
      h('div', { class: 'usage-bar' }, h('div', { style: `width:${pct}%` })),
    );
  }

  async function loadTree() {
    const { files, usage } = await api('GET', '/api/files');
    state.entries = files;
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
      editor.focus();
      expandTo(path);
      if (extOf(path) === 'html' && state.previewPath !== path) {
        state.previewPath = path;
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
    $('#title').textContent = state.active ?? '';
    document.title = `${state.active ? `${isDirty(state.active) ? '● ' : ''}${baseName(state.active)} · ` : ''}rakit.icu`;
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
      schedulePreviewReload();
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

  // ---------- Context menu ----------
  function showMenu(x, y, items) {
    const menu = $('#ctxmenu');
    menu.replaceChildren(...items.filter(Boolean).map((item) => (item === '-'
      ? h('div', { class: 'sep' })
      : h('button', { class: item.danger ? 'danger' : '', onclick: () => { hideMenu(); item.run(); } },
        h('span', {}, item.label), item.hint ? h('span', { class: 'hint' }, item.hint) : null))));
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, innerWidth - rect.width - 4)}px`;
    menu.style.top = `${Math.min(y, innerHeight - rect.height - 4)}px`;
  }

  function hideMenu() {
    $('#ctxmenu').hidden = true;
  }

  function treeMenu(entry) {
    const dir = entry ? targetDir(entry.path) : '';
    const items = [
      { label: 'File baru…', run: () => createEntry('file', dir) },
      { label: 'Folder baru…', run: () => createEntry('dir', dir) },
    ];
    if (!entry) return items;
    const fileItems = entry.type === 'file' ? [
      { label: 'Buka', run: () => openFile(entry.path) },
      extOf(entry.path) === 'html' && { label: 'Preview halaman ini', run: () => { state.previewPath = entry.path; reloadPreview(); } },
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
  function urlFor(path) {
    const clean = path === 'index.html' ? '' : path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path;
    return `${state.me.siteUrl}/${clean}`;
  }

  function reloadPreview() {
    const url = urlFor(state.previewPath);
    $('#previewUrl').value = url;
    $('#openPreview').href = url;
    // Server mengirim Cache-Control: no-cache, jadi cukup set ulang src untuk memuat versi terbaru.
    $('#previewFrame').src = url;
  }

  let previewTimer;
  function schedulePreviewReload() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(reloadPreview, 250);
  }

  function togglePreview() {
    const preview = $('#preview');
    preview.hidden = !preview.hidden;
    preview.previousElementSibling.hidden = preview.hidden;
    $('#togglePreview').classList.toggle('active', !preview.hidden);
    storage.set('rakit.previewHidden', preview.hidden);
  }

  function toggleSidebar() {
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
    showMenu(rect.right - 220, rect.bottom + 8, [
      { label: 'Salin URL website', run: () => copyText(state.me.siteUrl) },
      { label: 'Simpan semua', hint: '⌥⌘S', run: saveAll },
      ai.credits?.topupEnabled && { label: 'Isi ulang kredit AI', run: openTopup },
      state.me.isAdmin && { label: 'Dashboard pemilik', run: () => { location.href = '/admin'; } },
      '-',
      { label: 'Keluar', danger: true, run: logout },
    ]);
    const menu = $('#ctxmenu');
    menu.prepend(h('div', { class: 'menu-label' }, h('strong', {}, state.me.username), state.me.email));
  }

  async function logout() {
    await saveAll();
    await api('POST', '/api/logout').catch(() => {});
    location.href = '/';
  }

  // ---------- Tampilan HP ----------
  const mobileQuery = window.matchMedia('(max-width: 760px)');

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
        state.selected = path;
        renderTree();
        const rect = e.target.closest('.row-more').getBoundingClientRect();
        showMenu(rect.right - 200, rect.bottom + 4, treeMenu(state.entries.find((x) => x.path === path)));
        return;
      }
      state.selected = path;
      if (type === 'dir') {
        state.expanded.has(path) ? state.expanded.delete(path) : state.expanded.add(path);
        renderTree();
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
    $('#refreshBtn').onclick = () => loadTree().catch((err) => toast(err.message, 'error'));
    $('#collapseBtn').onclick = () => { state.expanded.clear(); renderTree(); };
    $('#reloadPreview').onclick = reloadPreview;
    $('#togglePreview').onclick = togglePreview;
    $('#toggleSidebar').onclick = toggleSidebar;

    const autosave = $('#autosave');
    autosave.checked = state.autosave;
    autosave.onchange = () => {
      state.autosave = autosave.checked;
      storage.set('rakit.autosave', state.autosave);
      if (state.autosave) saveAll();
    };

    $('#avatarBtn').onclick = (e) => { e.stopPropagation(); showAccountMenu(); };
    $('#copySite').onclick = () => copyText(state.me.siteUrl);
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
      if (state.tabs.some(isDirty) || ai.pending || ai.applying) e.preventDefault();
    });
  }

  // ---------- Asisten AI ----------
  const SPARK = 'M8 0l1.6 4.4L14 6l-4.4 1.6L8 12 6.4 7.6 2 6l4.4-1.6zM13 10l.8 2.2L16 13l-2.2.8L13 16l-.8-2.2L10 13l2.2-.8z';
  const ai = {
    credits: null,
    history: [], // {role, content} untuk konteks percakapan
    busy: false,
    controller: null,
    mode: storage.get('rakit.aiMode', 'build'), // 'build' (Builder) | 'plan' (Plan)
    pending: null, // perubahan Builder yang sudah diterapkan tapi belum dikonfirmasi
    applying: false,
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

  function renderCredits() {
    const badge = $('#aiCredits');
    const c = ai.credits;
    if (!c || !c.enabled) return badge.replaceChildren();
    const empty = c.remaining < c.costPerPrompt;
    const reset = new Date(c.resetsAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });
    badge.textContent = `${c.remaining} kredit`;
    badge.classList.toggle('empty', empty);
    badge.disabled = !c.topupEnabled;
    badge.title = [
      `Gratis bulan ini: ${c.freeRemaining}/${c.limit} (terisi ulang ${reset})`,
      c.purchased ? `Dibeli: ${c.purchased}` : null,
      c.topupEnabled ? 'Klik untuk isi ulang' : null,
    ].filter(Boolean).join(' · ');

    $('#aiTopupBanner').hidden = !empty;
    $('#aiTopupText').textContent = c.topupEnabled
      ? 'Kredit AI kamu habis.'
      : `Kredit AI habis. Terisi lagi ${reset}.`;
    $('#aiTopupBtn').hidden = !c.topupEnabled;
    updateAiComposer();
  }

  function updateAiComposer() {
    const c = ai.credits;
    const canSend = c?.enabled && c.remaining >= c.costPerPrompt && !ai.busy && !ai.applying;
    $('#aiSend').disabled = !canSend || !$('#aiInput').value.trim();
    $('#aiInput').disabled = !c?.enabled;
    $('#aiContext').textContent = state.active ? `konteks: ${state.active}` : 'konteks: semua file';
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

  // Area editor punya dua mode: 'code' (Monaco) dan 'ai' (chat asisten).
  function setMode(mode) {
    $('#editorArea').dataset.mode = mode;
    $('#codeView').hidden = mode !== 'code';
    $('#aiPanel').hidden = mode !== 'ai';
    $('#dataView').hidden = mode !== 'data';
    document.querySelectorAll('.mode-switch [data-mode]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.mode === mode));
    });
    if (mode === 'data') {
      dbLoad();
    } else if (mode === 'ai') {
      renderAiEmpty();
      updateAiComposer();
      $('#aiInput').focus();
    } else if (state.active) {
      editor?.focus();
    }
  }

  const toggleAi = () => setMode($('#editorArea').dataset.mode === 'ai' ? 'code' : 'ai');

  function resetAiChat() {
    if (ai.busy) ai.controller?.abort();
    ai.history = [];
    $('#aiMessages').replaceChildren();
    renderAiEmpty();
    $('#aiInput').focus();
  }

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

  async function sendPrompt() {
    const input = $('#aiInput');
    const prompt = input.value.trim();
    if (!prompt || ai.busy || ai.applying) return;
    // Prompt baru = perubahan sebelumnya yang belum dikonfirmasi dianggap disimpan.
    ai.pending?.keep();

    const box = $('#aiMessages');
    box.querySelector('.ai-empty')?.remove();
    const mode = ai.mode;
    box.append(h('div', { class: 'msg user' }, mode === 'plan' ? h('span', { class: 'msg-mode' }, 'Plan') : null, prompt));
    input.value = '';
    autoGrow();

    const status = h('span', {}, 'Membaca proyek…');
    // Model reasoning bisa "berpikir" puluhan detik sebelum menulis; tampilkan waktu berjalan.
    let thinkingTimer = null;
    const thinkingStart = Date.now();
    const startThinkingTimer = () => {
      if (thinkingTimer) return;
      const tick = () => { status.textContent = `AI sedang berpikir… ${Math.round((Date.now() - thinkingStart) / 1000)} dtk`; };
      tick();
      thinkingTimer = setInterval(tick, 1000);
    };
    const stopThinkingTimer = () => { clearInterval(thinkingTimer); thinkingTimer = true; };
    const loading = h('div', { class: 'msg loading' },
      h('span', { class: 'dots' }, h('i'), h('i'), h('i')), status,
      h('button', { class: 'stop', type: 'button', onclick: () => ai.controller?.abort() }, 'Stop'));
    box.append(loading);
    aiScroll();

    ai.busy = true;
    ai.controller = new AbortController();
    updateAiComposer();

    try {
      await saveAll(); // pastikan AI membaca versi terbaru
      const res = await fetch('/api/ai/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode, activePath: state.active, history: ai.history }),
        signal: ai.controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(data.error || `Gagal (${res.status})`);
        err.code = data.code;
        throw err;
      }

      let result = null;
      for await (const event of readEvents(res)) {
        if (event.credits) { ai.credits = event.credits; renderCredits(); }
        if (event.type === 'start' || event.type === 'thinking') startThinkingTimer();
        else if (event.type === 'progress') {
          stopThinkingTimer();
          status.textContent = `Menulis kode… ${(event.chars / 1000).toFixed(1)}k karakter`;
        }
        else if (event.type === 'error') throw new Error(event.error);
        else if (event.type === 'done') result = event;
      }
      if (!result) throw new Error('Koneksi terputus sebelum AI selesai');

      loading.remove();
      ai.history.push({ role: 'user', content: prompt });
      const changedList = result.changes.map((c) => (c.action === 'table' ? `tabel ${c.name}`
        : `${c.action === 'delete' ? 'hapus' : 'tulis'} ${c.path}`)).join(', ');
      ai.history.push({ role: 'assistant', content: result.message + (changedList ? `\n\n(Perubahan diusulkan: ${changedList})` : '') });
      box.append(renderAiReply(result));
    } catch (err) {
      loading.remove();
      const aborted = err.name === 'AbortError';
      box.append(h('div', { class: 'msg error' },
        aborted ? 'Dihentikan. Kredit dikembalikan.' : err.message,
        err.code === 'no_credits' && ai.credits?.topupEnabled
          ? h('button', { type: 'button', class: 'ai-topup-btn inline', onclick: openTopup }, 'Isi ulang kredit')
          : null));
      if (aborted || err.code === 'no_credits') setTimeout(loadCredits, 500);
    } finally {
      stopThinkingTimer();
      ai.busy = false;
      ai.controller = null;
      updateAiComposer();
      aiScroll();
    }
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

  function renderAiReply(result) {
    const wrap = h('div', { class: 'msg assistant' }, renderMarkdown(result.message || 'Selesai.'));
    if (result.mode === 'plan') {
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
    if (!result.changes.length) return wrap;

    const existing = new Set(state.entries.filter((e) => e.type === 'file').map((e) => e.path));
    const kind = (c) => (c.action === 'table' ? 'table' : c.action === 'delete' ? 'delete' : existing.has(c.path) ? 'edit' : 'new');
    const label = { new: 'baru', edit: 'ubah', delete: 'hapus', table: 'tabel' };
    let snapshot = null;
    const beforeOf = (path) => snapshot?.find((s) => s.path === path)?.before ?? '';

    const actions = h('div', { class: 'changes-actions' });
    const card = h('div', { class: 'changes' },
      h('div', { class: 'changes-head' }, h('span', {}, `${result.changes.length} perubahan`)),
      result.changes.map((c) => (c.action === 'table'
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
          onclick: () => (c.action === 'delete' ? null : showDiff(c, beforeOf(c.path))),
        },
        h('span', { class: `badge ${kind(c)}` }, label[kind(c)]),
        h('span', { class: 'path' }, c.path),
        c.action === 'delete' ? null : h('span', { class: 'view' }, 'lihat')))),
      actions);
    const setStatus = (text, cls = '') => actions.replaceChildren(h('span', { class: `changes-status ${cls}` }, text));

    // Perubahan langsung diterapkan (preview ikut berubah), lalu user memilih Simpan atau Batalkan.
    const pending = {
      settled: false,
      keep() {
        if (pending.settled) return;
        pending.settled = true;
        if (ai.pending === pending) ai.pending = null;
        setStatus('✓ Perubahan disimpan');
      },
    };

    const showConfirm = () => {
      const keepBtn = h('button', { type: 'button', class: 'apply' }, '✓ Simpan');
      const revertBtn = h('button', { type: 'button' }, 'Batalkan');
      keepBtn.onclick = pending.keep;
      revertBtn.onclick = async () => {
        keepBtn.disabled = revertBtn.disabled = true;
        revertBtn.textContent = 'Mengembalikan…';
        ai.applying = true;
        updateAiComposer();
        try {
          await restoreSnapshot(snapshot);
          pending.settled = true;
          if (ai.pending === pending) ai.pending = null;
          setStatus('↩ Dibatalkan — file dikembalikan ke versi sebelumnya', 'muted');
        } catch (err) {
          toast(`Gagal membatalkan: ${err.message}`, 'error');
          keepBtn.disabled = revertBtn.disabled = false;
          revertBtn.textContent = 'Batalkan';
        } finally {
          ai.applying = false;
          updateAiComposer();
        }
      };
      actions.replaceChildren(
        h('span', { class: 'changes-question' }, 'Perubahan sudah tampil di preview. Simpan perubahan ini?'),
        keepBtn,
        revertBtn,
      );
    };

    setStatus('Menerapkan perubahan…', 'muted');
    ai.applying = true;
    updateAiComposer();
    applyChanges(result.changes)
      .then((snap) => {
        snapshot = snap;
        ai.pending = pending;
        showConfirm();
      })
      .catch((err) => setStatus(`Gagal menerapkan: ${err.message}. File dikembalikan seperti semula.`, 'error'))
      .finally(() => {
        ai.applying = false;
        updateAiComposer();
        aiScroll();
      });

    wrap.append(card);
    return wrap;
  }

  async function currentContent(path) {
    if (state.models.has(path)) return state.models.get(path).getValue();
    const { content } = await api('GET', `/api/files/content?path=${encodeURIComponent(path)}`);
    return content;
  }

  // Tulis isi file lewat model Monaco bila sedang terbuka (supaya Ctrl+Z tetap bisa), lalu simpan.
  async function writeFileContent(path, content) {
    const model = state.models.get(path);
    if (model) {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content }], () => null);
      if (!(await save(path))) throw new Error(`Gagal menyimpan ${path}`);
    } else {
      await api('PUT', '/api/files/content', { path, content });
    }
  }

  const fileExists = (path) => state.entries.some((e) => e.path === path && e.type === 'file');

  async function applyChanges(changes) {
    // Simpan isi semua file sebelum mengubah apa pun, supaya bisa dibatalkan seluruhnya.
    const snapshot = [];
    const fileChanges = changes.filter((c) => c.action !== 'table');
    for (const change of fileChanges) {
      snapshot.push({ path: change.path, before: fileExists(change.path) ? await currentContent(change.path) : null });
    }
    snapshot.dirsBefore = new Set(state.entries.filter((e) => e.type === 'dir').map((e) => e.path));

    try {
      // Tabel dulu, supaya halaman yang memakai datanya langsung berfungsi di preview.
      for (const change of changes.filter((c) => c.action === 'table')) {
        snapshot.push(await applyTableChange(change));
      }
      for (const change of fileChanges) {
        const exists = fileExists(change.path);
        if (change.action === 'delete') {
          if (exists) {
            await api('DELETE', `/api/files?path=${encodeURIComponent(change.path)}`);
            removeTabs((p) => p === change.path);
            state.entries = state.entries.filter((e) => e.path !== change.path);
          }
        } else {
          if (!exists) {
            await api('POST', '/api/files', { path: change.path, type: 'file' });
            state.entries.push({ path: change.path, name: baseName(change.path), type: 'file', size: 0 });
          }
          await writeFileContent(change.path, change.content);
        }
      }
    } catch (err) {
      await restoreSnapshot(snapshot).catch(() => {});
      throw err;
    }

    await loadTree();
    if (!$('#dataView').hidden) dbLoad();
    const firstWritten = changes.find((c) => c.action === 'write');
    if (firstWritten) {
      expandTo(firstWritten.path);
      await openFile(firstWritten.path);
    }
    reloadPreview();
    return snapshot;
  }

  async function restoreSnapshot(snapshot) {
    for (const entry of [...snapshot].reverse()) {
      if (entry.table) {
        await revertTableChange(entry);
        continue;
      }
      const { path, before } = entry;
      const exists = fileExists(path);
      if (before === null) {
        if (exists) {
          await api('DELETE', `/api/files?path=${encodeURIComponent(path)}`);
          removeTabs((p) => p === path);
          state.entries = state.entries.filter((e) => e.path !== path);
        }
      } else {
        if (!exists) {
          await api('POST', '/api/files', { path, type: 'file' });
          state.entries.push({ path, name: baseName(path), type: 'file', size: 0 });
        }
        await writeFileContent(path, before);
      }
    }
    await loadTree();
    // Folder yang dibuat oleh perubahan AI dan kini kosong ikut dihapus (terdalam dulu).
    if (snapshot.dirsBefore) {
      const newDirs = state.entries
        .filter((e) => e.type === 'dir' && !snapshot.dirsBefore.has(e.path))
        .sort((a, b) => b.path.length - a.path.length);
      for (const dir of newDirs) {
        if (state.entries.some((e) => e.path.startsWith(`${dir.path}/`))) continue;
        await api('DELETE', `/api/files?path=${encodeURIComponent(dir.path)}`);
        state.entries = state.entries.filter((e) => e.path !== dir.path);
      }
      if (newDirs.length) await loadTree();
    }
    if (!$('#dataView').hidden) dbLoad();
    reloadPreview();
  }

  // Buat tabel baru, atau tambah kolom/buka akses di tabel yang sudah ada. Mengembalikan catatan untuk dibatalkan.
  async function applyTableChange(change) {
    const { tables } = await api('GET', '/api/database/tables');
    const existing = tables.find((t) => t.name === change.name);
    const rules = Object.fromEntries(change.public.map((op) => [op, 'public']));
    if (!existing) {
      await api('POST', '/api/database/tables', { name: change.name, columns: change.columns, rules });
      return { table: change.name, existed: false };
    }
    const addColumns = change.columns.filter((c) => !existing.columns.some((e) => e.name === c.name));
    const widened = change.public.some((op) => existing.rules[op] !== 'public');
    if (addColumns.length || widened) await api('PATCH', tableUrl(change.name), { addColumns, rules });
    return { table: change.name, existed: true, addedColumns: addColumns.map((c) => c.name), beforeRules: existing.rules };
  }

  async function revertTableChange(entry) {
    try {
      if (!entry.existed) await api('DELETE', tableUrl(entry.table));
      else await api('PATCH', tableUrl(entry.table), { dropColumns: entry.addedColumns, rules: entry.beforeRules });
    } catch (err) {
      if (!/tidak ditemukan/i.test(err.message)) throw err;
    }
  }

  // `before` = isi file sebelum perubahan AI ('' untuk file baru).
  function showDiff(change, before) {
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
        h('h3', {}, change.path),
        h('button', { class: 'icon-btn', title: 'Tutup', onclick: close }, svg(ICON.close))),
      body));
    root.hidden = false;
    root.onmousedown = (e) => { if (e.target === root) close(); };
    document.addEventListener('keydown', onKey, true);

    const language = { html: 'html', css: 'css', js: 'javascript' }[extOf(change.path)];
    diffEditor = monaco.editor.createDiffEditor(body, {
      theme: 'rakit',
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
      btn.onclick = () => { setAiMode(btn.dataset.aiMode); $('#aiInput').focus(); };
    });
    setAiMode(ai.mode);
    document.querySelectorAll('.mode-switch [data-mode]').forEach((btn) => {
      btn.onclick = () => setMode(btn.dataset.mode);
    });
    $('#aiReset').onclick = resetAiChat;
    document.querySelectorAll('.mobile-nav [data-view]').forEach((btn) => {
      btn.onclick = () => setMobileView(btn.dataset.view);
    });
    setMobileView(document.body.dataset.mobileView || 'editor');
    mobileQuery.addEventListener('change', applyResponsiveEditor);
    $('#dbNewTable').onclick = openCreateTable;
    $('#aiCredits').onclick = openTopup;
    $('#aiTopupBtn').onclick = openTopup;
    $('#aiForm').onsubmit = (e) => { e.preventDefault(); sendPrompt(); };
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
  const DB_TYPES = { text: 'Teks', number: 'Angka', boolean: 'Ya/Tidak', date: 'Tanggal' };
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
    return String(value);
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
        h('p', { class: 'db-hint' }, 'Atau minta AI di mode Builder, misalnya: "buat form RSVP yang datanya tersimpan".')));
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
        h('button', { type: 'button', class: 'db-btn', onclick: () => openTableSettings(t.name) }, svg(ICON.gear), 'Atur'),
        h('button', { type: 'button', class: 'db-btn primary', onclick: () => openRowForm(t) }, '+ Baris')));

    const grid = h('table', { class: 'db-grid' },
      h('thead', {}, h('tr', {},
        columns.map((c) => h('th', {},
          h('span', { class: 'col-name' }, c.name),
          c.required ? h('span', { class: 'col-flag', title: 'Wajib diisi' }, '*') : null,
          c.private ? h('span', { class: 'col-flag private', title: 'Privat — tidak tampil di API publik' }, svg(ICON.lock)) : null,
          h('span', { class: 'col-type' }, c.system ? 'otomatis' : DB_TYPES[c.type]))),
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
    const td = h('td', { title: 'Klik dua kali untuk mengubah' }, formatDbValue(column, row[column.name]));
    td.ondblclick = () => editDbCell(td, t, row, column);
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

  function miniCheck(label, checked, title, onChange) {
    const box = h('input', { type: 'checkbox' });
    box.checked = Boolean(checked);
    if (onChange) box.onchange = () => onChange(box.checked);
    return h('label', { class: 'mini-check', title }, box, label);
  }

  function openRowForm(t) {
    const { body, close } = openPanel('db-modal');
    const inputs = new Map();
    const fields = t.columns.map((c) => {
      const input = c.type === 'boolean' ? h('input', { type: 'checkbox' })
        : c.type === 'text' ? h('textarea', { rows: '2' })
          : c.type === 'number' ? h('input', { type: 'number', step: 'any' })
            : h('input', { type: 'text', placeholder: '2026-12-31 atau 2026-12-31T19:00' });
      inputs.set(c.name, input);
      return h('label', { class: `db-field ${c.type}` },
        h('span', { class: 'db-field-label' }, c.name, c.required ? h('span', { class: 'req' }, '*') : null,
          h('span', { class: 'col-type' }, DB_TYPES[c.type])),
        input);
    });
    const error = h('p', { class: 'db-form-error' });
    const form = h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const data = {};
        for (const c of t.columns) {
          const el = inputs.get(c.name);
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

  function openCreateTable() {
    const { body, close } = openPanel('db-modal wide');
    const nameInput = h('input', { placeholder: 'contoh: ucapan', spellcheck: 'false', autocomplete: 'off' });
    const columnList = h('div', { class: 'db-col-list' });
    const addColumnRow = (preset = {}) => {
      const name = h('input', { placeholder: 'nama_kolom', spellcheck: 'false', autocomplete: 'off', value: preset.name ?? '' });
      const type = typeSelect(preset.type);
      const required = h('input', { type: 'checkbox' });
      const secret = h('input', { type: 'checkbox' });
      const row = h('div', { class: 'db-col-row' },
        name, type,
        h('label', { class: 'mini-check', title: 'Wajib diisi' }, required, 'Wajib'),
        h('label', { class: 'mini-check', title: 'Tidak tampil di API publik' }, secret, 'Privat'),
        h('button', { type: 'button', class: 'icon-btn', title: 'Hapus kolom', onclick: () => row.remove() }, svg(ICON.close)));
      row.read = () => ({ name: name.value.trim(), type: type.value, required: required.checked, private: secret.checked });
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
    const example = { text: 'teks', number: 1, boolean: true, date: '2026-12-31' };
    const sample = Object.fromEntries(t.columns.map((c) => [c.name, example[c.type]]));
    const listCode = `// Ambil data, terbaru dulu\nconst res = await fetch('${url}?sort=-created_at');\nconst { rows } = await res.json();`;
    const createCode = `// Tambah data\nawait fetch('${url}', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify(${JSON.stringify(sample)}),\n});`;
    const block = (title, code, op) => h('div', { class: 'db-snippet' },
      h('div', { class: 'db-snippet-head' },
        h('span', {}, title),
        t.rules[op] !== 'public' ? h('span', { class: 'db-warn', title: 'Buka akses di atas supaya kode ini berfungsi' }, 'Akses belum publik') : null,
        h('button', { type: 'button', class: 'db-copy', onclick: () => copyText(code, 'Kode disalin') }, 'Salin')),
      h('pre', {}, h('code', {}, code)));
    return [
      block('Membaca data', listCode, 'list'),
      block('Menambah data', createCode, 'create'),
      h('p', { class: 'db-section-desc' }, `Filter: ${url}?nama=Budi · Urutkan: ?sort=-created_at · Halaman: ?limit=20&offset=20`),
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
        dbLoadRows();
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

  // ---------- Isi ulang kredit (QRIS) ----------
  const rupiah = (n) => `Rp${n.toLocaleString('id-ID')}`;

  function openTopup() {
    const root = $('#modal');
    const body = h('div', { class: 'modal topup-modal', role: 'dialog', 'aria-label': 'Isi ulang kredit AI' });
    let pollTimer;
    let countdownTimer;
    let closed = false;

    const stopTimers = () => {
      clearTimeout(pollTimer);
      clearInterval(countdownTimer);
    };
    const close = () => {
      closed = true;
      stopTimers();
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

    async function showPackages() {
      stopTimers();
      body.replaceChildren(head('Isi ulang kredit AI'), loadingView('Memuat paket…'));
      let data;
      try {
        data = await api('GET', '/api/billing/packages');
      } catch (err) {
        return body.replaceChildren(head('Isi ulang kredit AI'), ...errorView(err.message));
      }
      if (closed) return;
      if (!data.enabled || !data.packages.length) {
        return body.replaceChildren(head('Isi ulang kredit AI'),
          h('p', { class: 'topup-error' }, 'Isi ulang kredit belum tersedia saat ini.'));
      }

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
        head('Isi ulang kredit AI', 'Kredit yang dibeli tidak hangus, dan dipakai setelah kredit gratis bulananmu habis.'),
        h('div', { class: 'topup-balance' },
          h('span', {}, 'Sisa kredit sekarang'),
          h('strong', {}, `${c.remaining} kredit`)),
        h('div', { class: 'pkg-grid' }, cards),
        data.livemode ? null : h('p', { class: 'topup-test' }, 'Mode uji coba — tidak ada uang sungguhan yang ditarik.'),
        h('div', { class: 'modal-buttons' },
          h('button', { type: 'button', onclick: close }, 'Batal'),
          h('button', { type: 'button', class: 'primary', onclick: () => startPayment(selected) }, 'Bayar dengan QRIS')),
      ].filter(Boolean)); // replaceChildren() bawaan browser menulis null sebagai teks "null"
    }

    async function startPayment(pkg) {
      body.replaceChildren(head('Isi ulang kredit AI'), loadingView('Membuat kode QRIS…'));
      try {
        const { payment } = await api('POST', '/api/billing/topup', { packageId: pkg.id });
        if (!closed) showPayment(payment);
      } catch (err) {
        if (!closed) body.replaceChildren(head('Isi ulang kredit AI'), ...errorView(err.message));
      }
    }

    function showPayment(payment) {
      const timer = h('strong', {}, '');
      const status = h('div', { class: 'pay-status' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), 'Menunggu pembayaran…');
      const qr = payment.qr
        ? h('img', { class: 'qr', src: payment.qr, alt: 'Kode QRIS' })
        : h('div', { class: 'qr qr-missing' }, 'Kode QR tidak tersedia. Gunakan halaman pembayaran.');

      body.replaceChildren(
        head('Scan untuk membayar', `${payment.credits} kredit AI`),
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
          h('button', { type: 'button', onclick: showPackages }, 'Ganti paket'),
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
      body.replaceChildren(
        head('Pembayaran berhasil'),
        h('div', { class: 'topup-result ok' },
          h('div', { class: 'result-icon' }, '✓'),
          h('h4', {}, `+${payment.credits} kredit ditambahkan`),
          h('p', {}, `Sisa kreditmu sekarang ${credits?.remaining ?? ''} kredit. Terima kasih!`)),
        h('div', { class: 'modal-buttons' },
          h('button', { type: 'button', class: 'primary', onclick: () => { close(); setMode('ai'); } }, 'Lanjut pakai AI')),
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
        'editor.selectionBackground': '#8b5cf640',
        'editor.inactiveSelectionBackground': '#8b5cf622',
        'editorCursor.foreground': '#a78bfa',
        'editorLineNumber.foreground': '#343c4f',
        'editorLineNumber.activeForeground': '#a78bfa',
        'editorIndentGuide.background1': '#1c2231',
        'editorIndentGuide.activeBackground1': '#2f3850',
        'editorBracketMatch.background': '#8b5cf626',
        'editorBracketMatch.border': '#8b5cf680',
        'editorWidget.background': '#161b27',
        'editorWidget.border': '#2a3244',
        'editorSuggestWidget.background': '#161b27',
        'editorSuggestWidget.border': '#2a3244',
        'editorSuggestWidget.selectedBackground': '#8b5cf630',
        'editorHoverWidget.background': '#161b27',
        'editorHoverWidget.border': '#2a3244',
        'minimap.background': '#11151f',
        'scrollbarSlider.background': '#ffffff12',
        'scrollbarSlider.hoverBackground': '#ffffff20',
        'scrollbarSlider.activeBackground': '#8b5cf660',
        'editorGutter.background': '#11151f',
      },
    });
  }

  // ---------- Init ----------
  function loadMonaco() {
    return new Promise((resolve, reject) => {
      window.require.config({ paths: { vs: `${window.MONACO_BASE}/vs` } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    });
  }

  async function init() {
    const { user } = await api('GET', '/api/me');
    state.me = user;
    $('#projectName').textContent = user.siteHost;
    $('#siteLink').textContent = user.siteHost;
    $('#siteLink').href = user.siteUrl;
    $('#visitSite').href = user.siteUrl;
    $('#avatarBtn').textContent = user.username[0];
    $('#statusUser').textContent = 'HTML · CSS · JS';

    $('#toggleSidebar').classList.add('active');
    $('#togglePreview').classList.add('active');
    if (storage.get('rakit.previewHidden', false)) togglePreview();
    setDevice(storage.get('rakit.device', 'desktop'));
    initSplitters();
    bindEvents();
    bindAiEvents();
    loadCredits();

    monaco = await loadMonaco();
    defineTheme();
    editor = monaco.editor.create($('#editor'), {
      model: null,
      theme: 'rakit',
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
      padding: { top: 8 },
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => state.active && save(state.active));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyS, saveAll);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => toggleAi());
    editor.onDidChangeCursorPosition(updateStatus);
    applyResponsiveEditor();

    await loadTree();
    reloadPreview();
    const first = ['index.html', 'style.css', 'script.js'].filter((p) => state.entries.some((e) => e.path === p));
    for (const path of first) await openFile(path);
    if (first.length) activate(first[0]);
    else activate(null);
    setMode('ai'); // editor selalu dibuka di mode AI
  }

  init().catch((err) => {
    console.error(err);
    toast(`Gagal memuat editor: ${err.message}`, 'error');
  });
})();
