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
    image: 'M2.5 2A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 2zM2 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v7.3l-3-3-2.5 2.5-3-3L2 11.8zM10.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3',
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
    if (isImage(entry.path)) return h('span', { class: 'ficon img' }, svg(ICON.image));
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
        : null,
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
    const projectName = state.project ? `${state.project.name} · ` : '';
    document.title = `${state.active ? `${isDirty(state.active) ? '● ' : ''}${baseName(state.active)} · ` : ''}${projectName}rakit.icu`;
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

  // ---------- Gambar ----------
  const imageUrl = (path) => `${state.project.siteUrl}/${path}?v=${state.entries.find((e) => e.path === path)?.size ?? 0}-${Date.now()}`;

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

  async function uploadImages(files, dir, replacePath = null) {
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
    if (!accepted.length) return;

    let done = 0;
    let last = null;
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
        done++;
        last = data.path;
        // Catat segera supaya cek "sudah ada" untuk file berikutnya tetap akurat.
        if (!state.entries.some((e) => e.path === data.path)) state.entries.push({ path: data.path, name: baseName(data.path), type: 'file', size: file.size });
      } catch (err) {
        toast(`"${file.name}": ${err.message}`, 'error');
        if (/Kuota|Maksimal/.test(err.message)) break; // kuota penuh: berhenti, sisanya pasti gagal juga
      }
    }
    setSaveStatus('');
    if (!done) return;
    if (dir) state.expanded.add(dir);
    if (last) { expandTo(last); state.selected = last; }
    await loadTree().catch(() => {});
    schedulePreviewReload();
    toast(done === 1 ? `Gambar diunggah: /${last}` : `${done} gambar diunggah`);
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
  function showMenu(x, y, items) {
    const menu = $('#ctxmenu');
    menu.classList.remove('history-menu');
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
    return `${state.project.siteUrl}/${clean}`;
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
      { label: `Project: ${state.project.name}`, hint: 'ganti ›', run: () => setTimeout(() => showProjectMenu($('#avatarBtn')), 0) },
      '-',
      { label: 'Salin URL website', run: () => copyText(state.project.siteUrl) },
      { label: 'Simpan semua', hint: '⌥⌘S', run: saveAll },
      ai.credits?.topupEnabled && { label: 'Langganan & kredit AI', hint: ai.credits.plan?.name, run: () => openTopup('plans') },
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
    const base = state.project.siteHost.slice(state.project.slug.length); // ".rakit.icu"
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
    document.title = `${p.name} · rakit.icu`;
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

  function renderCredits() {
    const badge = $('#aiCredits');
    const c = ai.credits;
    renderPlanBadge(c?.plan ?? null);
    if (!c || !c.enabled) return badge.replaceChildren();
    const empty = c.remaining < c.costPerPrompt;
    const plan = c.plan;
    const unlimited = plan?.id === 'unlimited' && plan.quotaRemaining > 0;
    badge.textContent = unlimited ? 'Unlimited' : `${c.remaining} kredit`;
    badge.classList.toggle('empty', empty);
    badge.classList.toggle('plan', Boolean(plan));
    badge.disabled = !c.topupEnabled;
    badge.title = [
      plan && `${plan.name} aktif sampai ${shortDate(plan.expiresAt)}`,
      plan && (plan.id === 'unlimited'
        ? `Hari ini: ${plan.quotaUsed}/${plan.quota} prompt`
        : `Kredit ${plan.name}: ${plan.quotaRemaining}/${plan.quota} (terisi ulang ${shortDate(plan.quotaResetsAt)})`),
      c.limit ? `Gratis hari ini: ${c.freeRemaining}/${c.limit} (terisi lagi besok 00.00 WIB, tidak menumpuk)` : null,
      c.purchased ? `Dibeli: ${c.purchased}` : null,
      c.topupEnabled ? 'Klik untuk langganan / isi ulang' : null,
    ].filter(Boolean).join(' · ');

    $('#aiTopupBanner').hidden = !empty;
    $('#aiTopupText').textContent = c.topupEnabled
      ? 'Kredit AI kamu habis.'
      : 'Kredit AI hari ini habis. Terisi lagi besok 00.00 WIB.';
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
    $('#diagramView').hidden = mode !== 'diagram';
    document.querySelectorAll('.mode-switch [data-mode]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.mode === mode));
    });
    if (mode === 'data') {
      dbLoad();
    } else if (mode === 'diagram') {
      diagramLoad();
    } else if (mode === 'ai') {
      renderAiEmpty();
      updateAiComposer();
      $('#aiInput').focus();
    } else if (state.active) {
      editor?.focus();
    }
  }

  const toggleAi = () => setMode($('#editorArea').dataset.mode === 'ai' ? 'code' : 'ai');

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
  const userBubble = (m) => h('div', { class: 'msg user' }, m.mode === 'plan' ? h('span', { class: 'msg-mode' }, 'Plan') : null, m.content);
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
    $('#aiInput').focus();
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

  async function sendPrompt() {
    const input = $('#aiInput');
    const prompt = input.value.trim();
    if (!prompt || ai.busy || ai.applying) return;
    // Prompt baru = perubahan sebelumnya yang belum dikonfirmasi dianggap disimpan (server juga begitu).
    ai.pendingCard?.markKept();

    const box = $('#aiMessages');
    box.querySelector('.ai-empty')?.remove();
    const mode = ai.mode;
    box.append(userBubble({ mode, content: prompt }));
    input.value = '';
    autoGrow();
    aiScroll();
    ai.busy = true;
    updateAiComposer();

    let started;
    try {
      await saveAll(); // pastikan AI membaca versi terbaru
      started = await api('POST', '/api/ai/prompt', { prompt, mode, activePath: state.active, threadId: ai.threadId });
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
    box.append(loading);
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
        for await (const event of readEvents(res)) {
          if (event.credits) { ai.credits = event.credits; renderCredits(); }
          if (event.type === 'queued') setPhase({ kind: 'queued', position: event.position, total: event.total });
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

  function openCreateTable(presetName = '') {
    const { body, close } = openPanel('db-modal wide');
    const nameInput = h('input', { placeholder: 'contoh: ucapan', spellcheck: 'false', autocomplete: 'off', value: typeof presetName === 'string' ? presetName : '' });
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

  // ---------- Diagram (ERD, peta halaman, alur data) ----------
  // Dibuat otomatis dari file & database project, digambar dengan Mermaid (dimuat hanya saat tab dibuka).
  const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs';
  const diagram = { kind: storage.get('rakit.diagram', 'erd'), data: null, code: '', zoom: 1, mermaid: null, seq: 0 };
  const OP_LABEL = { list: 'baca daftar', view: 'baca', create: 'tambah', update: 'ubah', delete: 'hapus' };
  const OP_RULE = { list: 'Lihat daftar', view: 'Lihat satu baris', create: 'Tambah', update: 'Ubah', delete: 'Hapus' };

  // Teks aman untuk label Mermaid (judul halaman bisa berisi karakter apa saja).
  const mmText = (text) => String(text).replace(/["`<>{}[\]|#;\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

  async function loadMermaid() {
    if (diagram.mermaid) return diagram.mermaid;
    const { default: mermaid } = await import(MERMAID_URL);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Inter, -apple-system, "Segoe UI", system-ui, sans-serif',
      themeVariables: {
        darkMode: true,
        background: '#11151f',
        primaryColor: '#1b2130',
        primaryTextColor: '#f5f7fb',
        primaryBorderColor: '#8b5cf6',
        secondaryColor: '#161b27',
        tertiaryColor: '#161b27',
        lineColor: '#7c869b',
        textColor: '#d8dde8',
        fontSize: '14px',
        attributeBackgroundColorOdd: '#161b27',
        attributeBackgroundColorEven: '#11151f',
        edgeLabelBackground: '#11151f',
      },
      er: { useMaxWidth: false },
      flowchart: { useMaxWidth: false, curve: 'basis', htmlLabels: false },
    });
    diagram.mermaid = mermaid;
    return mermaid;
  }

  const askAi = (text) => {
    setMode('ai');
    setAiMode('build');
    $('#aiInput').value = text;
    autoGrow();
    updateAiComposer();
    $('#aiInput').focus();
  };
  const openTableAccess = (name) => { dbState.active = name; setMode('data'); setTimeout(() => openTableSettings(name), 300); };

  function erdDiagram(d) {
    if (!d.tables.length) {
      return { empty: ['Belum ada tabel', 'Buat tabel di tab Data, atau minta AI membuat form yang menyimpan data.'], findings: [] };
    }
    const lines = ['erDiagram'];
    for (const t of d.tables) {
      lines.push(`  ${t.name} {`, '    number id PK', '    date created_at');
      for (const c of t.columns) {
        const fk = d.relations.some((r) => r.from === t.name && r.column === c.name) ? ' FK' : '';
        const notes = [c.required && 'wajib', c.private && 'privat'].filter(Boolean).join(', ');
        lines.push(`    ${c.type} ${c.name}${fk}${notes ? ` "${notes}"` : ''}`);
      }
      lines.push('  }');
    }
    for (const r of d.relations) lines.push(`  ${r.to} ||--o{ ${r.from} : "${r.column}"`);

    const findings = [];
    for (const t of d.tables) {
      const open = Object.entries(t.rules).filter(([, v]) => v === 'public').map(([op]) => OP_LABEL[op]);
      const risky = ['update', 'delete'].filter((op) => t.rules[op] === 'public').map((op) => OP_LABEL[op]);
      if (risky.length) {
        findings.push({ level: 'warn', text: `Siapa pun bisa ${risky.join(' & ')} data di tabel "${t.name}". Pastikan ini memang disengaja.`, actions: [['Atur akses', () => openTableAccess(t.name)]] });
      }
      findings.push({ level: 'info', text: `${t.name}: ${t.rowCount} baris · ${open.length ? `publik: ${open.join(', ')}` : 'privat (hanya kamu)'}` });
    }
    if (d.relations.length) findings.push({ level: 'info', text: 'Garis relasi ditebak dari nama kolom (mis. produk_id → produk).' });
    return { code: lines.join('\n'), findings };
  }

  function siteDiagram(d) {
    if (!d.pages.length) return { empty: ['Belum ada halaman', 'Buat file .html untuk melihat peta halamanmu.'], findings: [] };
    const ids = new Map();
    const id = (key) => { if (!ids.has(key)) ids.set(key, `n${ids.size}`); return ids.get(key); };
    const lines = ['flowchart LR'];
    for (const p of d.pages) {
      lines.push(`  ${id(p.path)}["${mmText(p.path)}${p.title ? `\\n${mmText(p.title)}` : ''}"]:::${p.path === 'index.html' ? 'home' : p.orphan ? 'orphan' : 'page'}`);
    }
    for (const l of d.links) {
      if (l.broken) lines.push(`  ${id(`x:${l.to}`)}["${mmText(l.to)}\\ntidak ada"]:::broken`, `  ${id(l.from)} -. rusak .-> ${id(`x:${l.to}`)}`);
      else lines.push(`  ${id(l.from)} --> ${id(l.to)}`);
    }
    for (const a of d.assets) {
      lines.push(`  ${id(`a:${a.to}`)}["${mmText(a.to)}${a.missing ? '\\ntidak ada' : ''}"]:::${a.missing ? 'broken' : 'asset'}`);
      lines.push(`  ${id(a.from)} -.- ${id(`a:${a.to}`)}`);
    }
    lines.push(
      '  classDef home fill:#2a1f4d,stroke:#a78bfa,stroke-width:2px,color:#f5f7fb',
      '  classDef page fill:#1b2130,stroke:#8b5cf6,color:#f5f7fb',
      '  classDef orphan fill:#1b2130,stroke:#7c869b,stroke-dasharray:4 3,color:#d8dde8',
      '  classDef asset fill:#11151f,stroke:#3a4560,color:#8b93a7',
      '  classDef broken fill:#3b1219,stroke:#f87171,color:#fecaca',
    );

    const findings = [];
    for (const l of d.links.filter((x) => x.broken)) {
      findings.push({ level: 'error', text: `Link rusak: ${l.from} → ${l.to} (halaman tidak ada)`, actions: [['Minta AI perbaiki', () => askAi(`Perbaiki link rusak di ${l.from} yang mengarah ke ${l.to}. Buat halamannya atau arahkan ke halaman yang benar.`)]] });
    }
    for (const a of d.assets.filter((x) => x.missing)) {
      findings.push({ level: 'error', text: `${a.from} memuat ${a.to}, tapi file itu tidak ada`, actions: [['Minta AI perbaiki', () => askAi(`${a.from} memuat ${a.to} yang tidak ada. Perbaiki atau buat file tersebut.`)]] });
    }
    for (const p of d.pages.filter((x) => x.orphan)) findings.push({ level: 'warn', text: `${p.path} tidak ditautkan dari halaman mana pun, jadi pengunjung sulit menemukannya.` });
    if (d.external) findings.push({ level: 'info', text: `${d.external} link ke website luar (tidak digambar).` });
    if (!findings.length) findings.push({ level: 'ok', text: 'Semua link dan file CSS/JS ditemukan.' });
    return { code: lines.join('\n'), findings };
  }

  function flowDiagram(d) {
    if (!d.calls.length) {
      return { empty: ['Belum ada kode yang memakai database', "Diagram ini muncul setelah halaman atau script memakai fetch('/api/db/...')."], findings: [] };
    }
    const ids = new Map();
    const id = (key) => { if (!ids.has(key)) ids.set(key, `n${ids.size}`); return ids.get(key); };
    const lines = ['flowchart LR'];
    const edgeStyles = [];
    let edge = 0;
    const tables = new Set(d.tables.map((t) => t.name));
    const files = [...new Set(d.calls.map((c) => c.file))];
    // Halaman yang memuat script pemakai database, supaya terlihat halaman mana yang terdampak.
    for (const a of d.assets.filter((x) => x.kind === 'js' && files.includes(x.to))) {
      lines.push(`  ${id(a.from)}["${mmText(a.from)}"]:::page`, `  ${id(a.from)} -. memuat .-> ${id(a.to)}`);
      edgeStyles.push(`  linkStyle ${edge++} stroke:#3a4560`);
    }
    for (const f of files) lines.push(`  ${id(f)}["${mmText(f)}"]:::${f.endsWith('.js') ? 'script' : 'page'}`);
    for (const t of new Set(d.calls.map((c) => c.table))) {
      lines.push(`  ${id(`t:${t}`)}[("${mmText(t)}${tables.has(t) ? '' : '\\nbelum ada'}")]:::${tables.has(t) ? 'table' : 'broken'}`);
    }
    for (const c of d.calls) {
      lines.push(`  ${id(c.file)} -->|${OP_LABEL[c.op]}| ${id(`t:${c.table}`)}`);
      if (c.status !== 'ok') edgeStyles.push(`  linkStyle ${edge} stroke:#f87171,stroke-width:2px`);
      edge++;
    }
    lines.push(
      ...edgeStyles,
      '  classDef page fill:#1b2130,stroke:#8b5cf6,color:#f5f7fb',
      '  classDef script fill:#2b2410,stroke:#facc15,color:#f5f7fb',
      '  classDef table fill:#0f2a22,stroke:#10b981,color:#f5f7fb',
      '  classDef broken fill:#3b1219,stroke:#f87171,color:#fecaca',
    );

    const findings = [];
    for (const c of d.calls.filter((x) => x.status === 'owner_only')) {
      findings.push({
        level: 'error',
        text: `${c.file} mencoba ${OP_LABEL[c.op]} data di tabel "${c.table}", tapi akses "${OP_RULE[c.op]}" masih Hanya kamu. Pengunjung akan mendapat error 403.`,
        actions: [['Atur akses', () => openTableAccess(c.table)]],
      });
    }
    for (const c of d.calls.filter((x) => x.status === 'missing')) {
      findings.push({
        level: 'error',
        text: `${c.file} memakai tabel "${c.table}" yang belum ada.`,
        actions: [['Buat tabel', () => { setMode('data'); setTimeout(() => openCreateTable(c.table), 300); }],
          ['Minta AI perbaiki', () => askAi(`${c.file} memakai tabel database "${c.table}" yang belum ada. Buat tabelnya dengan kolom yang sesuai kode.`)]],
      });
    }
    const ok = d.calls.filter((x) => x.status === 'ok').length;
    if (ok) findings.push({ level: 'ok', text: `${ok} pemakaian database sudah sesuai aturan akses.` });
    findings.push({ level: 'info', text: 'Garis merah = request yang akan ditolak server. Dideteksi dari kode, jadi URL yang dibuat dinamis bisa terlewat.' });
    return { code: lines.join('\n'), findings };
  }

  const DIAGRAMS = { erd: erdDiagram, site: siteDiagram, flow: flowDiagram };

  function renderFindings(findings) {
    const icon = { error: '✕', warn: '!', info: 'i', ok: '✓' };
    $('#diagramFindings').replaceChildren(
      h('h4', {}, 'Temuan'),
      findings.length ? h('ul', {}, findings.map((f) => h('li', { class: f.level },
        h('span', { class: 'f-icon' }, icon[f.level]),
        h('div', {}, h('p', {}, f.text),
          f.actions ? h('div', { class: 'f-actions' }, f.actions.map(([label, run]) => h('button', { type: 'button', onclick: run }, label))) : null))))
        : h('p', { class: 'f-empty' }, 'Tidak ada catatan.'));
  }

  function applyZoom() {
    const stage = $('#diagramCanvas .diagram-stage');
    if (stage) stage.style.transform = `scale(${diagram.zoom})`;
    $('#diagramZoomFit').textContent = `${Math.round(diagram.zoom * 100)}%`;
  }

  function fitDiagram() {
    const svg = $('#diagramCanvas svg');
    if (!svg) return;
    const box = $('#diagramCanvas');
    const width = svg.viewBox.baseVal?.width || svg.getBoundingClientRect().width / diagram.zoom;
    const height = svg.viewBox.baseVal?.height || svg.getBoundingClientRect().height / diagram.zoom;
    diagram.zoom = Math.max(0.2, Math.min(1.5, (box.clientWidth - 48) / width, (box.clientHeight - 48) / height));
    applyZoom();
  }

  async function renderDiagram() {
    document.querySelectorAll('[data-diagram]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.diagram === diagram.kind)));
    const canvas = $('#diagramCanvas');
    if (!diagram.data) return;
    const { code = '', empty, findings } = DIAGRAMS[diagram.kind](diagram.data);
    diagram.code = code;
    renderFindings(findings);
    if (empty) {
      canvas.replaceChildren(h('div', { class: 'db-empty' },
        h('div', { class: 'db-empty-icon diagram-empty-icon' }, svg(ICON.table)), h('h3', {}, empty[0]), h('p', {}, empty[1])));
      return;
    }
    canvas.replaceChildren(h('div', { class: 'diagram-loading' }, 'Menggambar diagram…'));
    try {
      const mermaid = await loadMermaid();
      const { svg: markup } = await mermaid.render(`diagram-${++diagram.seq}`, code);
      // Parse di dokumen terpisah lalu pindahkan elemen SVG-nya (tanpa innerHTML). Parser HTML dipakai karena
      // label Mermaid berisi HTML (mis. <br>) yang tidak valid sebagai XML murni.
      const svgEl = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg');
      if (!svgEl) throw new Error('Mermaid tidak menghasilkan SVG');
      const stage = h('div', { class: 'diagram-stage' });
      const imported = document.importNode(svgEl, true);
      // Mermaid memberi width="100%": ganti dengan ukuran aslinya supaya zoom & scroll bekerja.
      const vb = imported.viewBox?.baseVal;
      // Inline style, karena aturan global `svg { width: 16px }` (untuk ikon) mengalahkan atribut width/height.
      if (vb?.width) {
        Object.assign(imported.style, { width: `${vb.width}px`, height: `${vb.height}px`, maxWidth: 'none' });
      }
      stage.append(imported);
      canvas.replaceChildren(stage);
      fitDiagram();
    } catch (err) {
      console.error(err);
      canvas.replaceChildren(h('div', { class: 'db-empty' }, h('h3', {}, 'Diagram gagal digambar'), h('p', {}, err.message || String(err))));
    }
  }

  async function diagramLoad() {
    $('#diagramCanvas').replaceChildren(h('div', { class: 'diagram-loading' }, 'Membaca file & database…'));
    try {
      await saveAll(); // diagram dibaca dari server, jadi simpan perubahan dulu
      diagram.data = await api('GET', '/api/diagrams');
    } catch (err) {
      $('#diagramCanvas').replaceChildren(h('div', { class: 'db-empty' }, h('h3', {}, 'Gagal memuat diagram'), h('p', {}, err.message)));
      return;
    }
    renderDiagram();
  }

  function downloadDiagram() {
    const svgEl = $('#diagramCanvas svg');
    if (!svgEl) return toast('Belum ada diagram untuk diunduh', 'error');
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.style.background = '#11151f';
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
    $('#diagramZoomIn').onclick = () => { diagram.zoom = Math.min(3, diagram.zoom * 1.25); applyZoom(); };
    $('#diagramZoomOut').onclick = () => { diagram.zoom = Math.max(0.2, diagram.zoom / 1.25); applyZoom(); };
    $('#diagramZoomFit').onclick = fitDiagram;
    $('#diagramRefresh').onclick = diagramLoad;
    $('#diagramCopy').onclick = () => (diagram.code ? copyText(diagram.code, 'Kode Mermaid disalin') : toast('Belum ada diagram', 'error'));
    $('#diagramDownload').onclick = downloadDiagram;
  }

  // ---------- Langganan & isi ulang kredit (QRIS) ----------
  const rupiah = (n) => `Rp${n.toLocaleString('id-ID')}`;
  const shortDate = (iso) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
  const PLAN_RANK = { pro: 1, unlimited: 2 };

  // tab: 'plans' (langganan) | 'credits' (paket kredit). Default: langganan kalau belum berlangganan.
  // intro: tampilan sambutan saat editor pertama kali dibuka (ada tombol "Nanti saja").
  function openTopup(tab, { intro = false } = {}) {
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
      ];
      const cards = data.plans.map((plan, i) => h('div', { class: `promo-card ${plan.id}`, style: `--delay:${120 + i * 90}ms` },
        RIBBON[plan.id] ? h('span', { class: 'promo-ribbon' }, RIBBON[plan.id]) : null,
        h('div', { class: 'promo-name' }, plan.name),
        h('div', { class: 'promo-price' }, rupiah(plan.price), h('span', {}, '/30 hari')),
        h('ul', { class: 'promo-features' }, features(plan).map(([text, mult]) => h('li', {},
          svg(CHECK), h('span', {}, text), mult ? h('b', { class: 'promo-mult', title: 'dibanding paket Gratis' }, mult) : null))),
        h('button', { type: 'button', class: 'promo-cta', onclick: () => startPayment({ planId: plan.id }) }, `Mulai ${plan.name}`)));

      const left = free.freeRemaining;
      body.replaceChildren(...[
        h('button', { class: 'icon-btn promo-close', type: 'button', title: 'Tutup', onclick: close }, svg(ICON.close)),
        h('div', { class: 'promo-hero' },
          h('span', { class: 'promo-orb a' }), h('span', { class: 'promo-orb b' }),
          h('span', { class: 'promo-kicker' }, svg(SPARK), 'Upgrade rakit.icu'),
          h('h2', {}, 'Bangun lebih banyak, lebih cepat.'),
          h('p', {}, 'Kredit AI berlimpah, storage lega, dan upload gambar lebih besar.'),
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
        `Maks. ${plan.storage.entries.toLocaleString('id-ID')} file & folder`,
      ];
      const cards = data.plans.map((plan) => {
        const isCurrent = current?.id === plan.id;
        const lower = current && PLAN_RANK[plan.id] < PLAN_RANK[current.id];
        const label = isCurrent ? 'Perpanjang 30 hari' : lower ? `Kamu sudah ${current.name}` : current ? `Upgrade ke ${plan.name}` : `Pilih ${plan.name}`;
        return h('div', { class: `plan-card${isCurrent ? ' current' : ''}${plan.id === 'unlimited' ? ' featured' : ''}` },
          h('div', { class: 'plan-name' }, plan.name, isCurrent ? h('span', { class: 'plan-tag' }, 'Aktif') : null),
          h('div', { class: 'plan-price' }, rupiah(plan.price), h('span', {}, ' / 30 hari')),
          h('ul', { class: 'plan-features' }, features(plan).map((text) => h('li', {}, text))),
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
          h('span', {}, `${free.limit} kredit/hari · storage 20 MB`));

      body.replaceChildren(...[
        intro
          ? head('Bangun lebih banyak dengan rakit.icu', 'Kamu sedang memakai paket Gratis. Berlangganan untuk kredit AI lebih banyak dan storage lebih besar. Bayar sekali dengan QRIS untuk 30 hari, tanpa tagihan otomatis.')
          : head('Langganan rakit.icu', 'Bayar sekali dengan QRIS untuk 30 hari, tanpa tagihan otomatis. Bonus storage langsung aktif setelah pembayaran.'),
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

    async function startPayment(item) {
      setPromoLayout(false);
      body.replaceChildren(head('Pembayaran'), loadingView('Membuat kode QRIS…'));
      try {
        const { payment } = item.planId
          ? await api('POST', '/api/billing/subscribe', { planId: item.planId })
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
        head('Scan untuk membayar', payment.plan ? `Langganan ${payment.plan} 30 hari` : `${payment.credits} kredit AI`),
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
          h('button', { type: 'button', onclick: () => { tab = payment.plan ? 'plans' : 'credits'; showPackages(); } }, 'Ganti paket'),
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
          payment.plan
            ? [h('h4', {}, `${plan?.name ?? payment.plan} aktif`),
              h('p', {}, plan ? `Berlaku sampai ${shortDate(plan.expiresAt)}. Bonus storage sudah aktif di semua project-mu. Terima kasih!` : 'Terima kasih!')]
            : [h('h4', {}, `+${payment.credits} kredit ditambahkan`),
              h('p', {}, `Sisa kreditmu sekarang ${credits?.remaining ?? ''} kredit. Terima kasih!`)]),
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
    $('#avatarBtn').textContent = state.me.username[0];
    $('#statusUser').textContent = 'HTML · CSS · JS';

    $('#toggleSidebar').classList.add('active');
    $('#togglePreview').classList.add('active');
    if (storage.get('rakit.previewHidden', false)) togglePreview();
    setDevice(storage.get('rakit.device', 'desktop'));
    initSplitters();
    bindEvents();
    bindAiEvents();
    bindDiagramEvents();
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
    // Tampilkan lagi percakapan terakhir (dan sambung ke job yang masih berjalan, bila ada).
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
