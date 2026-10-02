// Pemilih blok untuk preview di editor rakit.io. Disisipkan server hanya ke halaman yang dimuat di dalam
// iframe (Sec-Fetch-Dest: iframe), dan diam sampai editor (origin aplikasi) mengaktifkannya lewat
// postMessage. Selector yang dikirim: rantai dari <body> dengan :nth-of-type di setiap langkah
// (dicek ulang di server oleh internal/blocks).
(() => {
  const script = document.currentScript;
  const APP = script && script.dataset.app;
  if (!APP || window.parent === window) return;
  script.remove(); // jangan ikut terhitung sebagai elemen halaman

  let max = 5; // sisa jatah di halaman ini (editor mengurangi blok yang sudah dipilih di halaman lain)
  const BLOCK_TAGS = new Set(['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'form', 'figure', 'table', 'ul', 'ol', 'blockquote']);
  const NAMES = { header: 'Header', nav: 'Navigasi', main: 'Konten utama', section: 'Bagian', article: 'Artikel', aside: 'Samping', footer: 'Footer', form: 'Form', figure: 'Gambar', table: 'Tabel', ul: 'Daftar', ol: 'Daftar', blockquote: 'Kutipan' };

  let active = false;
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

  function report() {
    send({
      type: 'blocks',
      page: location.pathname,
      blocks: selected.map((el) => ({ selector: selectorOf(el), label: labelOf(el), html: el.outerHTML.slice(0, 6000) })),
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
    if (!active) return;
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
    hovered = blockOf(e.target);
  }
  function onClick(e) {
    if (e.target === host) return;
    e.preventDefault();
    e.stopPropagation();
    // Alt+klik link = pindah halaman tanpa keluar dari mode pilih. Dikerjakan sendiri: bawaan Chrome untuk
    // Alt+klik adalah mengunduh link. Hanya halaman di website ini.
    if (e.altKey) {
      const link = e.target.closest('a[href]');
      const to = link && new URL(link.href, location.href);
      if (to && to.origin === location.origin) location.href = to.href;
      return; // Alt = niat pindah halaman: tidak memilih/melepas blok
    }
    const el = blockOf(e.target);
    if (!el) return;
    const at = selected.indexOf(el);
    if (at >= 0) selected.splice(at, 1);
    else if (selected.length >= max) return send({ type: 'limit' });
    else selected.push(el);
    report();
  }
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  function setActive(on) {
    if (on === active) return;
    active = on;
    const opts = { capture: true };
    if (on) {
      mount();
      addEventListener('pointermove', onMove, opts);
      addEventListener('click', onClick, opts);
      addEventListener('submit', stop, opts);
      frame = requestAnimationFrame(draw);
    } else {
      removeEventListener('pointermove', onMove, opts);
      removeEventListener('click', onClick, opts);
      removeEventListener('submit', stop, opts);
      cancelAnimationFrame(frame);
      host.remove();
      host = null;
      hovered = null;
      selected = [];
    }
  }

  addEventListener('message', (e) => {
    const m = e.data;
    if (e.origin !== APP || e.source !== window.parent || !m || m.rakit !== true) return;
    if (m.type === 'pick') {
      if (Number.isInteger(m.limit)) max = Math.max(0, m.limit);
      setActive(Boolean(m.on));
      if (m.on && Array.isArray(m.restore)) {
        // Setelah preview dimuat ulang: pilih lagi blok yang masih ada.
        selected = m.restore.map((sel) => { try { return document.querySelector(sel); } catch { return null; } }).filter((el) => el && isBlock(el)).slice(0, max);
        report();
      }
    } else if (!active) {
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
