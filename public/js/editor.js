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
    for (const child of children.flat()) if (child != null && child !== false) el.append(child);
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
        h('span', { class: 'name' }, entry.name)));
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
    el.replaceChildren(...parts.flatMap((part, i) => [i ? h('span', { class: 'sep' }, '›') : null, h('span', {}, part)]));
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

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('URL disalin');
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
        e.preventDefault();
        const target = $(`#${splitter.dataset.target}`);
        splitter.setPointerCapture(e.pointerId);
        splitter.classList.add('dragging');
        document.body.classList.add('resizing');

        const onMove = (ev) => {
          const rect = target.getBoundingClientRect();
          const width = splitter.dataset.target === 'sidebar'
            ? Math.min(Math.max(ev.clientX - rect.left, 160), 600)
            : Math.min(Math.max(rect.right - ev.clientX, 240), innerWidth - 480);
          target.style.width = `${width}px`;
        };
        const onUp = () => {
          splitter.removeEventListener('pointermove', onMove);
          splitter.classList.remove('dragging');
          document.body.classList.remove('resizing');
          storage.set('rakit.widths', {
            sidebar: $('#sidebar').getBoundingClientRect().width || widths.sidebar,
            preview: $('#preview').getBoundingClientRect().width || widths.preview,
          });
        };
        splitter.addEventListener('pointermove', onMove);
        splitter.addEventListener('pointerup', onUp, { once: true });
        splitter.addEventListener('pointercancel', onUp, { once: true });
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
      state.selected = path;
      if (type === 'dir') {
        state.expanded.has(path) ? state.expanded.delete(path) : state.expanded.add(path);
        renderTree();
      } else {
        setMode('code');
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
      if (state.tabs.some(isDirty)) e.preventDefault();
    });
  }

  // ---------- Asisten AI ----------
  const SPARK = 'M8 0l1.6 4.4L14 6l-4.4 1.6L8 12 6.4 7.6 2 6l4.4-1.6zM13 10l.8 2.2L16 13l-2.2.8L13 16l-.8-2.2L10 13l2.2-.8z';
  const ai = {
    credits: null,
    history: [], // {role, content} untuk konteks percakapan
    busy: false,
    controller: null,
  };

  const AI_SUGGESTIONS = [
    'Buat landing page portofolio yang modern',
    'Tambahkan navbar responsif dengan menu hamburger',
    'Tambahkan tombol dark mode',
    'Jelaskan kode di file yang sedang dibuka',
  ];

  function renderCredits() {
    const badge = $('#aiCredits');
    const c = ai.credits;
    if (!c || !c.enabled) return badge.replaceChildren();
    badge.textContent = `${c.remaining}/${c.limit} kredit`;
    badge.classList.toggle('empty', c.remaining < c.costPerPrompt);
    const reset = new Date(c.resetsAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' });
    badge.title = `${c.costPerPrompt} kredit per prompt · terisi ulang ${reset}`;
    updateAiComposer();
  }

  function updateAiComposer() {
    const c = ai.credits;
    const canSend = c?.enabled && c.remaining >= c.costPerPrompt && !ai.busy;
    $('#aiSend').disabled = !canSend || !$('#aiInput').value.trim();
    $('#aiInput').disabled = !c?.enabled;
    $('#aiContext').textContent = state.active ? `konteks: ${state.active}` : 'konteks: semua file';
  }

  function renderAiEmpty() {
    const box = $('#aiMessages');
    if (box.children.length) return;
    if (ai.credits && !ai.credits.enabled) {
      box.append(h('div', { class: 'ai-notice' }, 'Fitur AI belum diaktifkan di server ini. Admin perlu mengisi ANTHROPIC_API_KEY.'));
      return;
    }
    box.append(h('div', { class: 'ai-empty' },
      h('div', { class: 'spark' }, svg(SPARK)),
      h('h3', {}, 'Mau bikin apa hari ini?'),
      h('p', {}, 'AI bisa membaca semua file proyekmu lalu menulis atau mengubah kodenya. Kamu bisa cek dulu sebelum menerapkan.'),
      h('div', { class: 'ai-suggestions' }, AI_SUGGESTIONS.map((text) => h('button', {
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
    document.querySelectorAll('.mode-switch [data-mode]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.mode === mode));
    });
    storage.set('rakit.mode', mode);
    if (mode === 'ai') {
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
    if (!prompt || ai.busy) return;

    const box = $('#aiMessages');
    box.querySelector('.ai-empty')?.remove();
    box.append(h('div', { class: 'msg user' }, prompt));
    input.value = '';
    autoGrow();

    const status = h('span', {}, 'Membaca proyek…');
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
        body: JSON.stringify({ prompt, activePath: state.active, history: ai.history }),
        signal: ai.controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Gagal (${res.status})`);
      }

      let result = null;
      for await (const event of readEvents(res)) {
        if (event.credits) { ai.credits = event.credits; renderCredits(); }
        if (event.type === 'start') status.textContent = 'AI sedang berpikir…';
        else if (event.type === 'progress') status.textContent = `Menulis kode… ${(event.chars / 1000).toFixed(1)}k karakter`;
        else if (event.type === 'error') throw new Error(event.error);
        else if (event.type === 'done') result = event;
      }
      if (!result) throw new Error('Koneksi terputus sebelum AI selesai');

      loading.remove();
      ai.history.push({ role: 'user', content: prompt });
      const changedList = result.changes.map((c) => `${c.action === 'delete' ? 'hapus' : 'tulis'} ${c.path}`).join(', ');
      ai.history.push({ role: 'assistant', content: result.message + (changedList ? `\n\n(Perubahan diusulkan: ${changedList})` : '') });
      box.append(renderAiReply(result));
    } catch (err) {
      loading.remove();
      const aborted = err.name === 'AbortError';
      box.append(h('div', { class: 'msg error' }, aborted ? 'Dihentikan. Kredit dikembalikan.' : err.message));
      if (aborted) setTimeout(loadCredits, 500);
    } finally {
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
    if (!result.changes.length) return wrap;

    const existing = new Set(state.entries.filter((e) => e.type === 'file').map((e) => e.path));
    const kind = (c) => (c.action === 'delete' ? 'delete' : existing.has(c.path) ? 'edit' : 'new');
    const label = { new: 'baru', edit: 'ubah', delete: 'hapus' };

    const actions = h('div', { class: 'changes-actions' });
    const card = h('div', { class: 'changes' },
      h('div', { class: 'changes-head' }, h('span', {}, `${result.changes.length} file diubah`)),
      result.changes.map((c) => h('button', {
        type: 'button',
        class: 'change-row',
        title: c.action === 'delete' ? c.path : 'Lihat perubahan',
        onclick: () => (c.action === 'delete' ? null : showDiff(c)),
      },
      h('span', { class: `badge ${kind(c)}` }, label[kind(c)]),
      h('span', { class: 'path' }, c.path),
      c.action === 'delete' ? null : h('span', { class: 'view' }, 'lihat'))),
      actions);

    const showPending = () => {
      const applyBtn = h('button', { type: 'button', class: 'apply' }, 'Terapkan');
      const skipBtn = h('button', { type: 'button' }, 'Abaikan');
      applyBtn.onclick = async () => {
        applyBtn.disabled = skipBtn.disabled = true;
        applyBtn.textContent = 'Menerapkan…';
        try {
          const snapshot = await applyChanges(result.changes);
          showApplied(snapshot);
        } catch (err) {
          toast(`Gagal menerapkan: ${err.message}`, 'error');
          applyBtn.disabled = skipBtn.disabled = false;
          applyBtn.textContent = 'Terapkan';
        }
      };
      skipBtn.onclick = () => actions.replaceChildren(h('span', { class: 'changes-status muted' }, 'Diabaikan'));
      actions.replaceChildren(applyBtn, skipBtn);
    };

    const showApplied = (snapshot) => {
      const undoBtn = h('button', { type: 'button' }, 'Batalkan');
      undoBtn.onclick = async () => {
        undoBtn.disabled = true;
        try {
          await restoreSnapshot(snapshot);
          toast('Perubahan AI dibatalkan');
          showPending();
        } catch (err) {
          toast(`Gagal membatalkan: ${err.message}`, 'error');
          undoBtn.disabled = false;
        }
      };
      actions.replaceChildren(h('span', { class: 'changes-status' }, '✓ Diterapkan'), undoBtn);
    };

    showPending();
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
    const snapshot = [];
    for (const change of changes) {
      const exists = fileExists(change.path);
      snapshot.push({ path: change.path, before: exists ? await currentContent(change.path) : null });
      if (change.action === 'delete') {
        if (exists) {
          await api('DELETE', `/api/files?path=${encodeURIComponent(change.path)}`);
          removeTabs((p) => p === change.path);
        }
      } else {
        if (!exists) {
          await api('POST', '/api/files', { path: change.path, type: 'file' });
          state.entries.push({ path: change.path, name: baseName(change.path), type: 'file', size: 0 });
        }
        await writeFileContent(change.path, change.content);
      }
    }
    await loadTree();
    const firstWritten = changes.find((c) => c.action === 'write');
    if (firstWritten) {
      expandTo(firstWritten.path);
      await openFile(firstWritten.path);
    }
    reloadPreview();
    toast(`${changes.length} perubahan diterapkan`);
    return snapshot;
  }

  async function restoreSnapshot(snapshot) {
    for (const { path, before } of [...snapshot].reverse()) {
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
    reloadPreview();
  }

  async function showDiff(change) {
    const before = fileExists(change.path) ? await currentContent(change.path).catch(() => '') : '';
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
    document.querySelectorAll('.mode-switch [data-mode]').forEach((btn) => {
      btn.onclick = () => setMode(btn.dataset.mode);
    });
    $('#aiReset').onclick = resetAiChat;
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

    await loadTree();
    reloadPreview();
    const first = ['index.html', 'style.css', 'script.js'].filter((p) => state.entries.some((e) => e.path === p));
    for (const path of first) await openFile(path);
    if (first.length) activate(first[0]);
    else activate(null);
    setMode(storage.get('rakit.mode', 'code'));
  }

  init().catch((err) => {
    console.error(err);
    toast(`Gagal memuat editor: ${err.message}`, 'error');
  });
})();
