// Halaman /panduan (dokumentasi): sidebar dengan penanda bagian aktif & sub-judul, pencarian, menu geser di HP,
// tautan # di judul, pewarnaan sintaks blok kode, dan tombol Salin. Halaman tetap terbaca tanpa skrip ini.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const main = $('#konten-utama');
  const sidebar = $('#sidebar');
  const search = $('#docSearch');

  const slugify = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ---------- Bagian (h2) & sub-judul (h3 langsung di bawah main) ----------
  const used = new Set($$('[id]').map((el) => el.id));
  const sections = $$('h2[id]', main).map((h2) => {
    const subs = [];
    let text = h2.textContent;
    for (let el = h2.nextElementSibling; el && !el.matches('h2, .part'); el = el.nextElementSibling) {
      text += ` ${el.textContent}`;
      if (el.matches('h3')) {
        if (!el.id) {
          let id = `${h2.id}-${slugify(el.textContent)}`;
          for (let i = 2; used.has(id); i++) id = `${h2.id}-${slugify(el.textContent)}-${i}`;
          used.add(id);
          el.id = id;
        }
        subs.push(el);
      }
    }
    const link = $(`.nav-link[href="#${h2.id}"]`, sidebar);
    return { h2, subs, text: text.toLowerCase(), link, item: link?.parentElement };
  });

  // Tautan # di setiap judul, supaya bagian mana pun bisa dibagikan.
  $$('h2[id], h3[id]', main).forEach((h) => {
    const a = document.createElement('a');
    a.className = 'anchor';
    a.href = `#${h.id}`;
    a.setAttribute('aria-label', `Tautan ke bagian ini`);
    a.textContent = '#';
    h.append(a);
  });
  // Id sub-judul baru ada setelah skrip ini berjalan, jadi browser belum bisa melompat ke #… saat halaman dimuat.
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ behavior: 'instant' });

  // ---------- Penanda bagian aktif ----------
  let active = null;
  function setActive(sec) {
    if (sec === active) return;
    active?.link?.classList.remove('active');
    active?.link?.removeAttribute('aria-current');
    $('.nav-sub', sidebar)?.remove();
    active = sec;
    if (!sec?.link) return;
    sec.link.classList.add('active');
    sec.link.setAttribute('aria-current', 'location');
    if (sec.subs.length && !search.value.trim()) {
      const ul = document.createElement('ul');
      ul.className = 'nav-sub';
      ul.innerHTML = sec.subs.map((h3) => `<li><a href="#${h3.id}">${esc(h3.textContent.replace(/#$/, ''))}</a></li>`).join('');
      sec.item.append(ul);
    }
    // Jaga link aktif tetap terlihat di sidebar (tanpa menggulir halaman).
    const box = sidebar.getBoundingClientRect();
    const r = sec.link.getBoundingClientRect();
    if (r.top < box.top + 40 || r.bottom > box.bottom - 40) sidebar.scrollTop += r.top - box.top - box.height / 3;
  }
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      let current = null;
      for (const sec of sections) {
        if (sec.h2.getBoundingClientRect().top - 120 > 0) break;
        current = sec;
      }
      setActive(current);
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Menu geser (HP & tablet) ----------
  const menuBtn = $('#menuBtn');
  const scrim = $('#scrim');
  function setMenu(open) {
    sidebar.classList.toggle('open', open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Tutup daftar isi' : 'Buka daftar isi');
  }
  menuBtn.addEventListener('click', () => setMenu(!sidebar.classList.contains('open')));
  scrim.addEventListener('click', () => setMenu(false));
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });

  // ---------- Pencarian: menyaring daftar isi ----------
  function filter() {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const sec of sections) {
      const hit = terms.every((t) => sec.text.includes(t));
      if (sec.item) sec.item.hidden = !hit;
      if (hit) shown++;
    }
    $$('.nav-group', sidebar).forEach((g) => {
      const list = g.nextElementSibling;
      g.hidden = !$$(':scope > li', list).some((li) => !li.hidden);
    });
    $('#navEmpty').hidden = shown > 0;
    sidebar.classList.toggle('searching', terms.length > 0);
    const keep = active;
    active = null;
    setActive(keep); // sub-judul hanya saat tidak mencari
    return terms.length ? sections.find((s) => s.item && !s.item.hidden) : null;
  }
  search.addEventListener('input', () => {
    filter();
    if (search.value.trim()) setMenu(true);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = filter();
      if (first) {
        location.hash = first.h2.id;
        setMenu(false);
        search.blur();
      }
    } else if (e.key === 'Escape') {
      search.value = '';
      filter();
      search.blur();
    }
  });
  addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/input|textarea/i.test(document.activeElement?.tagName ?? '')) {
      e.preventDefault();
      search.focus();
    } else if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      setMenu(false);
    }
  });

  // ---------- Pewarnaan sintaks ----------
  const RULES = {
    js: [/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\b(const|let|var|async|await|function|return|if|else|for|of|in|new|throw|try|catch|switch|case|default|break|export|import|from|typeof|null|undefined|true|false)\b|\b(\d[\d_.]*(?:e\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g,
      ['c', 's', 'k', 'n', 'f']],
    css: [/(\/\*[\s\S]*?\*\/)|('[^'\n]*'|"[^"\n]*")|(^[^{}\n]+(?=\{))|([\w-]+)(?=\s*:)|([\w-]+)(?=\()/gm, ['c', 's', 't', 'a', 'f']],
    html: [/(<!--[\s\S]*?-->)|(<\/?[\w-]+|\/?>)|("[^"]*")|([\w-]+)(?==)/g, ['c', 't', 's', 'a']],
  };
  function paint(text, [re, kinds]) {
    let out = '';
    let last = 0;
    for (const m of text.matchAll(re)) {
      out += esc(text.slice(last, m.index));
      const i = m.slice(1).findIndex((g) => g !== undefined);
      out += i < 0 ? esc(m[0]) : `<span class="tk-${kinds[i]}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  // ---------- Tombol Salin ----------
  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    btn.textContent = 'Tersalin ✓';
    btn.classList.add('done');
    setTimeout(() => { btn.textContent = 'Salin'; btn.classList.remove('done'); }, 1600);
  }
  function copyButton(getText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.textContent = 'Salin';
    btn.addEventListener('click', () => copy(getText(), btn));
    return btn;
  }

  $$('figure.code').forEach((fig) => {
    const code = $('code', fig);
    const lang = fig.dataset.lang;
    const raw = code.textContent;
    if (RULES[lang]) code.innerHTML = paint(raw, RULES[lang]);
    const tag = document.createElement('span');
    tag.className = 'lang';
    tag.textContent = lang.toUpperCase();
    $('figcaption', fig).append(tag, copyButton(() => raw));
  });
  $$('.prompt').forEach((box) => {
    const text = [...box.childNodes].filter((n) => !n.classList?.contains('lbl')).map((n) => n.textContent).join('').trim();
    box.append(copyButton(() => text));
  });
})();
