// Pemilih blok & edit teks/gambar untuk preview di editor rakit.io. Disisipkan server hanya ke halaman yang dimuat
// di dalam iframe (Sec-Fetch-Dest: iframe), dan diam sampai editor (origin aplikasi) mengaktifkannya lewat
// postMessage. Selector yang dikirim: rantai dari <body> dengan :nth-of-type di setiap langkah
// (dicek ulang di server oleh internal/blocks, dan di editor oleh assets-source/js/textedit.js).
(() => {
  const script = document.currentScript;
  const APP = script && script.dataset.app;
  if (!APP || window.parent === window) return;
  script.remove(); // jangan ikut terhitung sebagai elemen halaman

  let max = 5; // sisa jatah di halaman ini (editor mengurangi blok yang sudah dipilih di halaman lain)
  const BLOCK_TAGS = new Set(['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'form', 'figure', 'table', 'ul', 'ol', 'blockquote']);
  const NAMES = { header: 'Header', nav: 'Navigasi', main: 'Konten utama', section: 'Bagian', article: 'Artikel', aside: 'Samping', footer: 'Footer', form: 'Form', figure: 'Gambar', table: 'Tabel', ul: 'Daftar', ol: 'Daftar', blockquote: 'Kutipan' };

  let mode = null; // null (tidak aktif), 'pick' (pilih blok), atau 'text' (edit teks)
  let host = null;
  let hoverBox = null;
  let hovered = null;
  let selected = []; // elemen terpilih, sesuai urutan dipilih
  let frame = 0;

  const send = (data) => window.parent.postMessage({ rakit: true, ...data }, APP);

  // Bagian bermakna: tag struktural, atau elemen ber-id/ber-class yang cukup besar dan berisi elemen lain
  // (kartu, kolom, grup). Tombol, tautan, dan teks kecil tidak dipilih sendiri.
  function isBlock(el) {
    if (!el || el === document.body || el === document.documentElement || el === host) return false;
    const tag = el.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tag)) return true;
    if (!(el.id || el.classList.length) || !el.firstElementChild) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 80 && r.height >= 40 && r.width * r.height >= 8000;
  }
  function blockOf(el) {
    for (; el && el !== document.body; el = el.parentElement) if (isBlock(el)) return el;
    return null;
  }

  function selectorOf(el) {
    const steps = [];
    for (; el && el !== document.body; el = el.parentElement) {
      const tag = el.tagName.toLowerCase();
      let n = 1;
      for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) n += 1;
      steps.unshift(`${tag}:nth-of-type(${n})`);
    }
    return ['body', ...steps].join(' > ');
  }
  function labelOf(el) {
    const heading = el.matches('h1,h2,h3') ? el : el.querySelector('h1,h2,h3');
    const text = heading && heading.textContent.replace(/\s+/g, ' ').trim();
    if (text) return text.length > 32 ? `${text.slice(0, 31)}…` : text;
    const tag = el.tagName.toLowerCase();
    const name = el.id || el.classList[0];
    return name ? `${NAMES[tag] || 'Blok'} .${name}` : NAMES[tag] || `Blok <${tag}>`;
  }

  // ---------- Aturan CSS yang mengenai blok ----------
  // Pseudo-element & state (:hover, ::before, …) dibuang dulu supaya bisa dicocokkan dengan elemen.
  const PSEUDO = /::?(?:before|after|placeholder|marker|selection|first-line|first-letter|backdrop|hover|focus-visible|focus-within|focus|active|visited|link|target|checked|disabled)\b(?:\([^)]*\))?/g;
  const GENERIC = new Set(['*', 'html', 'body', ':root', 'html, body', 'body, html']);
  function applies(el, selectorText) {
    const sel = selectorText.replace(PSEUDO, '').trim();
    if (!sel || GENERIC.has(sel)) return false;
    try {
      return el.matches(sel) || Boolean(el.querySelector(sel));
    } catch {
      return false;
    }
  }
  function cssOf(el) {
    const bySource = new Map(); // file ("" = <style> di halaman) -> aturan
    let total = 0;
    const visit = (rules, file, wrap) => {
      for (const rule of rules) {
        if (total > 5000) return;
        if (rule instanceof CSSStyleRule) {
          if (!applies(el, rule.selectorText)) continue;
          const text = wrap ? `${wrap} { ${rule.cssText} }` : rule.cssText;
          total += text.length;
          bySource.set(file, [...(bySource.get(file) || []), text]);
        } else if (rule.cssRules) {
          // @media / @supports / @container: aturan di dalamnya ikut, dengan kondisinya.
          const at = rule instanceof CSSMediaRule ? `@media ${rule.media.mediaText}`
            : rule.conditionText ? `@${rule.constructor.name.replace(/^CSS|Rule$/g, '').toLowerCase()} ${rule.conditionText}` : wrap;
          visit(rule.cssRules, file, at);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules; // stylesheet dari situs lain (mis. font) tidak bisa dibaca: dilewati
      } catch {
        continue;
      }
      const url = sheet.href && new URL(sheet.href);
      if (url && url.origin !== location.origin) continue;
      visit(rules, url ? url.pathname : '', '');
    }
    return [...bySource].map(([file, rules]) => ({ file, rules: rules.join('\n') }));
  }

  function report() {
    send({
      type: 'blocks',
      page: location.pathname,
      blocks: selected.map((el) => ({ selector: selectorOf(el), label: labelOf(el), html: el.outerHTML.slice(0, 6000), css: cssOf(el) })),
    });
  }

  // ---------- Sorotan (di shadow DOM supaya tidak terpengaruh/memengaruhi CSS halaman) ----------
  function mount() {
    host = document.createElement('rakit-picker');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .box{position:fixed;box-sizing:border-box;border:2px dashed #22c55e;border-radius:6px;background:rgb(34 197 94/.08);transition:all .08s}
      .box.sel{border-style:solid;background:rgb(34 197 94/.14);box-shadow:0 0 0 3px rgb(34 197 94/.25)}
      .tag{position:absolute;left:-2px;top:-24px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        padding:3px 8px;border-radius:6px;background:#16a34a;color:#fff;font:600 12px/1.3 system-ui,sans-serif}
      .box.inside .tag{top:4px;left:4px}
      .box.txt{border-color:#3b82f6;background:rgb(59 130 246/.06)}
      .box.txt .tag{background:#2563eb}
      .box.txt.sel{border-style:solid;background:none;box-shadow:0 0 0 3px rgb(59 130 246/.25)}
    </style><div class="layer"></div>`;
    document.documentElement.append(host);
    hoverBox = document.createElement('div');
    hoverBox.className = 'box';
    hoverBox.innerHTML = '<span class="tag"></span>';
    root.append(hoverBox);
  }
  function place(box, el, text) {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, display: 'block' });
    box.classList.toggle('inside', r.top < 26); // tidak ada ruang di atas: label di dalam kotak
    box.firstChild.textContent = text;
  }
  function draw() {
    if (!host) return;
    if (mode === 'text') return drawText();
    const layer = host.shadowRoot.querySelector('.layer');
    while (layer.children.length < selected.length) {
      const box = document.createElement('div');
      box.className = 'box sel';
      box.innerHTML = '<span class="tag"></span>';
      layer.append(box);
    }
    while (layer.children.length > selected.length) layer.lastChild.remove();
    selected.forEach((el, i) => place(layer.children[i], el, `${i + 1}. ${labelOf(el)}`));
    if (hovered && !selected.includes(hovered)) place(hoverBox, hovered, labelOf(hovered));
    else hoverBox.style.display = 'none';
    frame = requestAnimationFrame(draw);
  }

  // ---------- Interaksi ----------
  function onMove(e) {
    if (mode === 'text') hovered = editing && editing.el.contains(e.target) ? null : imageTarget(e.target) || textTarget(e.target);
    else hovered = blockOf(e.target);
  }
  // Alt+klik link = pindah halaman tanpa keluar dari mode pilih/edit. Dikerjakan sendiri: bawaan Chrome
  // untuk Alt+klik adalah mengunduh link. Hanya halaman di website ini.
  function follow(e) {
    const link = e.target.closest('a[href]');
    const to = link && new URL(link.href, location.href);
    if (to && to.origin === location.origin) location.href = to.href;
  }
  function onClick(e) {
    if (e.target === host) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.altKey) return follow(e); // Alt = niat pindah halaman: tidak memilih/melepas/mengedit
    if (mode === 'text') return onTextClick(e);
    const el = blockOf(e.target);
    if (!el) return;
    const at = selected.indexOf(el);
    if (at >= 0) selected.splice(at, 1);
    else if (selected.length >= max) return send({ type: 'limit' });
    else selected.push(el);
    report();
  }
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  // ---------- Edit teks ----------
  // Klik teks di halaman untuk mengubahnya langsung (contenteditable). Saat selesai, isi tiap text node
  // elemen sebelum & sesudah dikirim ke editor, yang menerapkannya ke HTML sumber (textedit.js).
  let editing = null; // { el, nodes, before, html }
  // Teks di dalam elemen ini bukan teks halaman (sama dengan NO_TEXT di textedit.js).
  const NO_TEXT = new Set(['script', 'style', 'template', 'noscript', 'textarea', 'title', 'svg', 'math']);
  const NOT_EDITABLE = 'input,textarea,select,option,script,style,svg,math,iframe,video,audio,canvas,[contenteditable]';

  function textNodes(el, out = []) {
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) out.push(n);
      else if (n.nodeType === Node.ELEMENT_NODE && !NO_TEXT.has(n.localName)) textNodes(n, out);
    }
    return out;
  }
  const display = (el) => getComputedStyle(el).display;
  // Elemen teks yang diedit: dari elemen yang diklik naik melewati elemen inline (strong, a, span) sampai
  // blok teksnya (p, h1, li, tombol). Blok yang memuat blok lain (section, kartu) tidak diedit utuh.
  function textTarget(node) {
    let el = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    if (!el || el === host || el.closest(NOT_EDITABLE)) return null;
    while (el.parentElement && el.parentElement !== document.body && display(el) === 'inline') el = el.parentElement;
    if (el === document.body || el === document.documentElement || el.closest(NOT_EDITABLE)) return null;
    if (!textNodes(el).some((n) => /\S/.test(n.data))) return null;
    for (const child of el.querySelectorAll('*')) {
      if (child.closest('svg') && child.localName !== 'svg') continue;
      const d = display(child);
      if (!(d.startsWith('inline') || d === 'none' || d === 'contents')) return null;
    }
    return el;
  }

  // Range kursor di titik (x, y), dihitung sebelum elemen jadi contenteditable. Kotak sorotan disembunyikan
  // dulu: walau pointer-events:none, Chrome tetap mengenainya dan mengembalikan awal elemen.
  function caretAt(el, x, y) {
    host.style.display = 'none';
    let range = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    if (!range && document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    }
    host.style.display = '';
    return range && el.contains(range.startContainer) ? range : null;
  }
  function select(range) {
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function startEdit(el, x, y) {
    const nodes = textNodes(el);
    editing = { el, nodes, before: nodes.map((n) => n.data), html: el.innerHTML };
    try {
      el.contentEditable = 'plaintext-only';
    } catch {
      el.contentEditable = 'true'; // browser lama tanpa plaintext-only
    }
    el.addEventListener('keydown', onEditKey);
    el.addEventListener('paste', onPaste);
    el.addEventListener('drop', stop);
    el.addEventListener('blur', onEditBlur);
    const range = caretAt(el, x, y);
    el.focus({ preventScroll: true });
    if (range) {
      select(range);
    }
    hovered = null;
  }

  // keep: simpan perubahan (false = kembalikan teks semula).
  function finishEdit(keep) {
    if (!editing) return;
    const { el, nodes, before, html } = editing;
    editing = null;
    el.removeEventListener('keydown', onEditKey);
    el.removeEventListener('paste', onPaste);
    el.removeEventListener('drop', stop);
    el.removeEventListener('blur', onEditBlur);
    el.removeAttribute('contenteditable');
    const now = textNodes(el);
    const same = now.length === nodes.length && now.every((n, i) => n === nodes[i]);
    if (!keep) {
      if (same) nodes.forEach((n, i) => { n.data = before[i]; });
      else el.innerHTML = html;
      return;
    }
    // Spasi yang diketik di contenteditable sering menjadi &nbsp;: kembalikan ke spasi biasa.
    const plain = (text, old) => (old.includes(' ') ? text : text.replace(/ /g, ' '));
    let after;
    if (same) {
      after = nodes.map((n, i) => plain(n.data, before[i]));
      if (after.every((t, i) => t === before[i])) return;
    } else if ([...el.querySelectorAll('*')].every((c) => c.localName === 'br' && !html.includes('<br'))) {
      // Semua isi dipilih lalu diketik ulang: format di dalamnya (span, tebal) ikut terhapus; kini teks polos.
      after = plain(el.textContent, before.join(''));
      el.textContent = after;
    } else {
      el.innerHTML = html;
      return send({ type: 'textError', reason: 'structure' });
    }
    send({ type: 'textEdit', page: location.pathname, selector: selectorOf(el), before, after });
  }

  function onEditKey(e) {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === 'Enter') { // teks satu baris: Enter = simpan
      e.preventDefault();
      finishEdit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(false);
    }
  }
  function onPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    document.execCommand('insertText', false, text.replace(/\s+/g, ' '));
  }
  function onEditBlur() {
    finishEdit(true);
  }

  function onTextClick(e) {
    if (editing && editing.el.contains(e.target)) return; // memindah kursor di teks yang sedang diedit
    finishEdit(true);
    const img = imageTarget(e.target);
    if (img) return editImage(img);
    const el = textTarget(e.target);
    if (el) startEdit(el, e.clientX, e.clientY);
  }

  // ---------- Ganti gambar ----------
  // Klik <img> mengirim src/alt-nya ke editor, yang membuka pilihan gambar lalu mengubah HTML sumber
  // (textedit.js) dan membalas dengan setImage supaya gambar baru langsung tampil tanpa memuat ulang.
  function imageTarget(node) {
    return node && node.localName === 'img' && !node.closest(NOT_EDITABLE) ? node : null;
  }
  function editImage(img) {
    const picture = img.parentElement && img.parentElement.localName === 'picture' && img.parentElement.querySelector('source');
    send({
      type: 'imageEdit',
      page: location.pathname,
      selector: selectorOf(img),
      src: img.getAttribute('src'),
      alt: img.getAttribute('alt'),
      shown: img.currentSrc || img.src,
      picture: Boolean(picture),
    });
  }
  function setImage(m) {
    if (m.page !== location.pathname || typeof m.selector !== 'string') return;
    let img = null;
    try {
      img = document.querySelector(m.selector);
    } catch {
      return;
    }
    if (!img || img.localName !== 'img') return;
    if (typeof m.src === 'string' && m.src !== img.getAttribute('src')) {
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.setAttribute('src', m.src);
    }
    if (typeof m.alt === 'string') img.setAttribute('alt', m.alt);
  }

  function drawText() {
    const layer = host.shadowRoot.querySelector('.layer');
    while (layer.children.length < (editing ? 1 : 0)) {
      const box = document.createElement('div');
      box.className = 'box txt sel';
      box.innerHTML = '<span class="tag"></span>';
      layer.append(box);
    }
    while (layer.children.length > (editing ? 1 : 0)) layer.lastChild.remove();
    if (editing) place(layer.firstChild, editing.el, 'Enter simpan · Esc batal');
    hoverBox.classList.add('txt');
    if (hovered) place(hoverBox, hovered, hovered.localName === 'img' ? 'Klik untuk ganti gambar' : 'Klik untuk ubah teks');
    else hoverBox.style.display = 'none';
    frame = requestAnimationFrame(draw);
  }

  function setMode(next) {
    const opts = { capture: true };
    if (host) {
      finishEdit(true);
      removeEventListener('pointermove', onMove, opts);
      removeEventListener('click', onClick, opts);
      removeEventListener('submit', stop, opts);
      cancelAnimationFrame(frame);
      host.remove();
      host = null;
      hovered = null;
      selected = [];
    }
    mode = next;
    if (!mode) return;
    mount();
    addEventListener('pointermove', onMove, opts);
    addEventListener('click', onClick, opts);
    addEventListener('submit', stop, opts);
    frame = requestAnimationFrame(draw);
  }
  addEventListener('message', (e) => {
    const m = e.data;
    if (e.origin !== APP || e.source !== window.parent || !m || m.rakit !== true) return;
    if (m.type === 'pick' || m.type === 'textMode') {
      const kind = m.type === 'pick' ? 'pick' : 'text';
      // Mematikan satu mode tidak mematikan mode lain yang sedang aktif.
      const next = m.on ? kind : mode === kind ? null : mode;
      if (kind === 'pick' && Number.isInteger(m.limit)) max = Math.max(0, m.limit);
      if (next !== mode) setMode(next);
      if (mode === 'pick' && m.type === 'pick' && Array.isArray(m.restore)) {
        // Setelah preview dimuat ulang: pilih lagi blok yang masih ada.
        selected = m.restore.map((sel) => { try { return document.querySelector(sel); } catch { return null; } }).filter((el) => el && isBlock(el)).slice(0, max);
        report();
      }
    } else if (m.type === 'setImage') {
      if (mode === 'text') setImage(m);
    } else if (mode !== 'pick') {
      return;
    } else if (m.type === 'limit') {
      max = Math.max(0, m.limit);
    } else if (m.type === 'remove' || m.type === 'parent') {
      const el = selected.find((x) => selectorOf(x) === m.selector);
      if (!el) return;
      const parent = m.type === 'parent' ? blockOf(el.parentElement) : null;
      if (m.type === 'parent' && !parent) return send({ type: 'top' });
      // Blok induk menggantikan blok ini; blok terpilih lain yang ada di dalamnya ikut tercakup.
      selected = selected.filter((x) => x !== el && !(parent && parent.contains(x)));
      if (parent && !selected.includes(parent)) selected.push(parent);
      report();
    } else if (m.type === 'clear') {
      selected = [];
      report();
    }
  });
  send({ type: 'ready', page: location.pathname });
})();
