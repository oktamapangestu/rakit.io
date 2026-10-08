// Edit teks & gambar langsung di preview: menerjemahkan perubahan teks sebuah elemen (atau src/alt sebuah
// <img>) di halaman preview menjadi perubahan di HTML sumbernya, tanpa menyentuh bagian lain file
// (indentasi, atribut, komentar tetap).
//
// Elemen ditunjuk dengan selector dari skrip preview (go/internal/sites/picker.js): rantai dari <body>
// dengan :nth-of-type di setiap langkah. HTML sumber diurai dengan parser kecil yang mencatat posisi tiap
// elemen & teks, dan meniru aturan browser yang mengubah susunan elemen (tag penutup tersirat, <tbody>
// otomatis, <body> tersirat). Hasilnya selalu dicek: teks elemen di sumber harus sama dengan teks yang
// dilihat di preview. Kalau berbeda (teks dibuat JavaScript, dimuat dari file lain, atau susunan halaman
// tidak bisa ditebak), perubahan ditolak — lebih baik gagal daripada mengubah tempat yang salah.
((root) => {
  const VOID = new Set('area base br col embed hr img input keygen link meta param source track wbr'.split(' '));
  // Isinya teks mentah (bukan elemen): dibaca sampai tag penutupnya.
  const RAW = new Set('script style textarea title xmp iframe noembed noframes noscript'.split(' '));
  // Membuka elemen ini menutup <p> yang masih terbuka.
  const CLOSES_P = new Set(('address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer form ' +
    'h1 h2 h3 h4 h5 h6 header hgroup hr li dd dt main menu nav ol p pre section summary table ul').split(' '));
  const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  const SCOPE = new Set('applet caption html table td th marquee object template button'.split(' '));
  // Elemen di <head> (bila <body> tidak ditulis, elemen pertama selain ini memulai body).
  const HEAD_ONLY = new Set('head title meta link base style script noscript template'.split(' '));
  // Teks di dalam elemen ini bukan teks halaman (sama dengan yang dilewati skrip preview).
  const NO_TEXT = new Set('script style template noscript textarea title svg math'.split(' '));

  // parse: pohon {tag, children, start, end, innerStart, innerEnd} dan {text: true, start, end}.
  function parse(src) {
    const top = { tag: '#root', children: [], innerStart: 0, innerEnd: src.length };
    const stack = [top];
    const cur = () => stack[stack.length - 1];
    const has = (tag, stops) => {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) return i;
        if (stops.has(stack[i].tag)) return -1;
      }
      return -1;
    };
    const closeAt = (i, at) => {
      while (stack.length > i) {
        const el = stack.pop();
        el.innerEnd = at;
        el.end = at;
      }
    };
    const push = (el) => {
      cur().children.push(el);
      stack.push(el);
    };
    const inForeign = () => stack.some((el) => el.tag === 'svg' || el.tag === 'math');
    let text = 0; // awal teks sejak tag terakhir
    const flush = (at) => {
      if (at > text) cur().children.push({ text: true, start: text, end: at });
    };

    let i = 0;
    while (i < src.length) {
      const lt = src.indexOf('<', i);
      if (lt < 0) break;
      const next = src[lt + 1] || '';
      if (src.startsWith('<!--', lt)) {
        flush(lt);
        const close = src.indexOf('-->', lt + 4);
        i = close < 0 ? src.length : close + 3;
        text = i;
        continue;
      }
      if (next === '!' || next === '?' || (next === '/' && !/[a-z]/i.test(src[lt + 2] || ''))) {
        if (next === '/' && src[lt + 2] === '>') { // "</>" diabaikan browser
          flush(lt);
          i = lt + 3;
          text = i;
          continue;
        }
        flush(lt);
        const close = src.indexOf('>', lt);
        i = close < 0 ? src.length : close + 1;
        text = i;
        continue;
      }
      const m = /^<(\/?)([a-z][^\s/>]*)/i.exec(src.slice(lt, lt + 64));
      if (!m) { // "<" biasa di dalam teks
        i = lt + 1;
        continue;
      }
      // Ujung tag: ">" pertama di luar tanda kutip nilai atribut.
      let j = lt + m[0].length;
      let quote = '';
      for (; j < src.length; j += 1) {
        const c = src[j];
        if (quote) { if (c === quote) quote = ''; } else if ((c === '"' || c === "'") && /=\s*$/.test(src.slice(Math.max(lt, j - 8), j))) quote = c;
        else if (c === '>') break;
      }
      const end = Math.min(j + 1, src.length);
      flush(lt);
      const tag = m[2].toLowerCase();
      i = end;
      text = i;

      if (m[1]) { // tag penutup
        // </body> dan </html> tidak menutup apa-apa: isi sesudahnya tetap masuk ke body di browser.
        const at = tag === 'body' || tag === 'html' ? -1 : has(tag, new Set());
        if (at > 0) closeAt(at, lt);
        continue;
      }

      // Tag penutup tersirat (aturan browser yang paling sering mengubah susunan).
      if (CLOSES_P.has(tag)) { const p = has('p', SCOPE); if (p > 0) closeAt(p, lt); }
      if (tag === 'li') { const at = has('li', new Set(['ul', 'ol', 'menu', ...SCOPE])); if (at > 0) closeAt(at, lt); }
      if (tag === 'dd' || tag === 'dt') {
        const stops = new Set(['dl', ...SCOPE]);
        const at = Math.max(has('dd', stops), has('dt', stops));
        if (at > 0) closeAt(at, lt);
      }
      if (HEADINGS.has(tag) && HEADINGS.has(cur().tag)) closeAt(stack.length - 1, lt);
      if (tag === 'option' && cur().tag === 'option') closeAt(stack.length - 1, lt);
      if (tag === 'optgroup') { const at = has('option', new Set(['select'])); if (at > 0) closeAt(at, lt); const g = has('optgroup', new Set(['select'])); if (g > 0) closeAt(g, lt); }
      if (tag === 'tr' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
        const stops = new Set(['table']);
        if (tag === 'tr') { const at = has('tr', stops); if (at > 0) closeAt(at, lt); }
        const td = Math.max(has('td', stops), has('th', stops));
        if (td > 0) closeAt(td, lt);
        if (tag !== 'tr') { const sec = Math.max(has('thead', stops), has('tbody', stops), has('tfoot', stops)); if (sec > 0) closeAt(sec, lt); }
      }
      if (tag === 'td' || tag === 'th') { const at = Math.max(has('td', new Set(['tr', 'table'])), has('th', new Set(['tr', 'table']))); if (at > 0) closeAt(at, lt); }
      // <tr> langsung di <table>: browser menambahkan <tbody>.
      if (tag === 'tr' && cur().tag === 'table') push({ tag: 'tbody', children: [], start: lt, innerStart: lt });

      const el = { tag, children: [], start: lt, innerStart: end };
      const selfClosing = src[end - 2] === '/' && inForeign();
      cur().children.push(el);
      if (VOID.has(tag) || selfClosing) {
        el.innerEnd = end;
        el.end = end;
      } else if (RAW.has(tag)) {
        const close = new RegExp(`</${tag}[\\s/>]`, 'i').exec(src.slice(end));
        const at = close ? end + close.index : src.length;
        if (at > end) el.children.push({ text: true, start: end, end: at });
        el.innerEnd = at;
        const gt = close ? src.indexOf('>', at) : -1;
        el.end = gt < 0 ? src.length : gt + 1;
        i = el.end;
        text = i;
      } else {
        stack.push(el);
      }
    }
    flush(src.length);
    closeAt(1, src.length);
    return top;
  }

  const elements = (nodes) => nodes.filter((n) => !n.text);

  // body: elemen <body>, atau body tersirat bila tidak ditulis (isi setelah bagian head).
  function bodyOf(top, src) {
    const html = elements(top.children).find((n) => n.tag === 'html');
    const container = html ? html.children : top.children;
    const body = elements(container).find((n) => n.tag === 'body');
    if (body) return body;
    const children = [];
    let started = false;
    for (const n of container) {
      if (!started) {
        if (n.text ? !/\S/.test(src.slice(n.start, n.end)) : HEAD_ONLY.has(n.tag)) continue;
        started = true;
      }
      children.push(n);
    }
    return { tag: 'body', children };
  }

  function find(top, src, selector) {
    const parts = String(selector).split(' > ');
    if (parts[0] !== 'body') return null;
    let el = bodyOf(top, src);
    for (const part of parts.slice(1)) {
      const m = /^([a-z][a-z0-9-]*):nth-of-type\((\d+)\)$/.exec(part);
      if (!m) return null;
      el = elements(el.children).filter((c) => c.tag === m[1])[Number(m[2]) - 1];
      if (!el) return null;
    }
    return el;
  }

  // Isi elemen ini diisi Alpine.js dari data (x-text / x-html): satu text node "terikat" yang di preview boleh
  // berisi apa saja, dan tidak bisa diubah di HTML (asalnya dicari di string JS atau database).
  const BOUND = new Set(['x-text', 'x-html']);

  const isBound = (src, el) => el.start !== undefined && el.innerEnd !== undefined && attrs(src, el).some((a) => BOUND.has(a.name));
  const boundNode = (el) => ({ text: true, bound: true, start: el.innerStart, end: el.innerEnd });

  function textNodes(el, src, out = []) {
    if (isBound(src, el)) return [boundNode(el)];
    for (const n of el.children) {
      if (n.text) out.push(n);
      else if (NO_TEXT.has(n.tag)) continue;
      else if (isBound(src, n)) out.push(boundNode(n));
      else textNodes(n, src, out);
    }
    return out;
  }

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
  // Ganti isi teks tanpa mengubah spasi/baris baru di awal & akhirnya (indentasi kode tetap).
  function replaceCore(raw, value) {
    const lead = /^\s*/.exec(raw)[0];
    const trail = lead.length === raw.length ? '' : /\s*$/.exec(raw)[0];
    return lead + escape(value.trim()) + trail;
  }

  // apply: perubahan teks elemen `selector` di HTML `src`.
  //   before: isi tiap text node elemen di preview sebelum diubah (urut dokumen)
  //   after:  isi sesudahnya (array sepanjang before), atau string bila seluruh isi elemen kini teks polos
  //   decode: mengubah teks HTML mentah (dengan &amp; dsb.) menjadi teks biasa
  // Hasil: { edits: [{start, end, text}], bound: [indeks before yang terikat data] }, atau { error } (kode
  // untuk pemanggil). error 'bound' + index: hanya satu teks terikat data yang diubah — asalnya dicari di
  // tempat lain (string JS, database) oleh pemanggil.
  function apply(src, selector, before, after, decode) {
    const el = find(parse(src), src, selector);
    if (!el || el.innerEnd === undefined) return { error: 'missing' };
    const nodes = textNodes(el, src);
    const texts = nodes.map((n) => (n.bound ? null : decode(src.slice(n.start, n.end))));
    const same = (k, t) => texts[k] === null || norm(texts[k]) === norm(t);

    // Pasangkan text node preview dengan text node sumber. Biasanya sama persis; kalau jumlahnya beda
    // (spasi kosong di antara tag yang diperlakukan berbeda), cukup yang berisi teks.
    let pairs = null;
    if (nodes.length === before.length && before.every((t, i) => same(i, t))) {
      pairs = before.map((_, i) => [i, i]);
    } else {
      const a = before.map((t, i) => [t, i]).filter(([t]) => norm(t));
      const b = texts.map((t, k) => [t, k]).filter(([t]) => t === null || norm(t));
      if (a.length !== b.length || a.some(([t], j) => !same(b[j][1], t))) return { error: 'mismatch' };
      pairs = a.map(([, i], j) => [i, b[j][1]]);
      if (typeof after !== 'string') {
        // Teks diketik di spasi kosong yang tidak punya pasangan di sumber.
        const paired = new Set(pairs.map(([i]) => i));
        if (before.some((t, i) => !paired.has(i) && norm(t) !== norm(after[i]))) return { error: 'mismatch' };
      }
    }
    const bound = pairs.filter(([, k]) => nodes[k].bound).map(([i]) => i);

    if (typeof after === 'string') {
      // Isi elemen diganti teks polos (format di dalamnya ikut dihapus di preview).
      if (norm(after) === norm(before.join(''))) return { edits: [], bound };
      if (bound.length) return bound.length === 1 && pairs.length === 1 ? { error: 'bound', index: bound[0] } : { error: 'mixed' };
      return { edits: [{ start: el.innerStart, end: el.innerEnd, text: replaceCore(src.slice(el.innerStart, el.innerEnd), after) }], bound };
    }

    const changed = pairs.filter(([i]) => norm(after[i]) !== norm(before[i]));
    const changedBound = changed.filter(([, k]) => nodes[k].bound);
    if (changedBound.length) return changed.length === 1 ? { error: 'bound', index: changed[0][0] } : { error: 'mixed' };
    const edits = changed.map(([i, k]) => ({ start: nodes[k].start, end: nodes[k].end, text: replaceCore(src.slice(nodes[k].start, nodes[k].end), after[i]) }));
    return { edits, bound };
  }

  // attrs: atribut tag pembuka elemen: [{name, start, end, value: {start, end} | null}] (posisi di src).
  function attrs(src, el) {
    const out = [];
    const re = /([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
    re.lastIndex = el.start + 1 + el.tag.length;
    const stop = el.innerStart - 1; // posisi ">"
    for (let m = re.exec(src); m && m.index < stop; m = re.exec(src)) {
      let value = null;
      if (m[2] !== undefined) {
        const end = m.index + m[0].length;
        value = /^["']/.test(m[2]) ? { start: end - m[2].length + 1, end: end - 1 } : { start: end - m[2].length, end };
      }
      out.push({ name: m[1].toLowerCase(), start: m.index, end: Math.min(m.index + m[0].length, stop), value });
    }
    return out;
  }

  const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  // applyImage: ganti src/alt gambar `selector` di HTML `src`.
  //   before:  { src, alt } seperti di preview (getAttribute; null bila tidak ada)
  //   changes: { src?, alt? } nilai baru
  // srcset & sizes dihapus saat src diganti (keduanya didahulukan browser, jadi gambar baru tidak akan tampil).
  // Hasil: { edits } atau { error } seperti apply.
  function applyImage(src, selector, before, changes, decode) {
    const el = find(parse(src), src, selector);
    if (!el || el.tag !== 'img') return { error: 'missing' };
    const list = attrs(src, el);
    const valueOf = (name) => {
      const a = list.find((x) => x.name === name);
      if (!a) return null;
      return a.value ? decode(src.slice(a.value.start, a.value.end)) : '';
    };
    if ((valueOf('src') ?? '').trim() !== (before.src ?? '').trim()) return { error: 'mismatch' };

    const edits = [];
    const set = (name, value) => {
      const a = list.find((x) => x.name === name);
      if (!a) {
        // Atribut baru: setelah atribut terakhir (atau nama tag), sebelum "/>" atau ">".
        const at = list.length ? list[list.length - 1].end : el.start + 1 + el.tag.length;
        edits.push({ start: at, end: at, text: ` ${name}="${escapeAttr(value)}"` });
      } else if (a.value && /["']/.test(src[a.value.start - 1])) {
        edits.push({ start: a.value.start, end: a.value.end, text: src[a.value.start - 1] === "'" ? escapeAttr(value).replace(/'/g, '&#39;') : escapeAttr(value) });
      } else {
        edits.push({ start: a.start, end: a.end, text: `${name}="${escapeAttr(value)}"` });
      }
    };
    if (typeof changes.src === 'string' && changes.src !== valueOf('src')) {
      set('src', changes.src);
      for (const a of list) {
        if (a.name !== 'srcset' && a.name !== 'sizes') continue;
        let start = a.start; // ikut hapus spasi di depannya
        while (/\s/.test(src[start - 1])) start -= 1;
        edits.push({ start, end: a.end, text: '' });
      }
    }
    if (typeof changes.alt === 'string' && changes.alt !== valueOf('alt')) set('alt', changes.alt);
    return { edits };
  }

  // ---------- Teks dari JavaScript ----------
  // Teks yang ditulis skrip (mis. el.textContent = 'Password minimal 6 karakter.') dicari sebagai string
  // utuh di file JS: '…', "…" atau `…` (tanpa ${}). Hanya ditulis persis seperti ini; teks yang dirakit
  // dari data (`Kamu sudah klik ${n} kali`) tidak akan cocok, dan memang tidak bisa diubah dari preview.
  function encodeLiteral(text, quote) {
    let s = text.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').split(quote).join(`\\${quote}`);
    if (quote === '`') s = s.replace(/\$\{/g, '\\${');
    return s;
  }

  // findLiterals: posisi isi string JS yang nilainya persis `text`: [{start, end, quote}].
  function findLiterals(src, text) {
    const out = [];
    if (!text) return out;
    for (const quote of ["'", '"', '`']) {
      const needle = quote + encodeLiteral(text, quote) + quote;
      for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) {
        if (src[i - 1] === '\\') continue; // bagian dari string lain (\'…\')
        out.push({ start: i + 1, end: i + needle.length - 1, quote });
      }
    }
    return out;
  }

  // findHtmlLiterals: string JS bernilai `text` di dalam HTML halaman — di <script> tanpa src dan di nilai
  // atribut (x-data="{ judul: 'Halo' }", @click="…"). Di atribut, string memakai tanda kutip selain pembatas
  // atributnya, dan "&" serta tanda kutip pembatas di dalamnya ditulis sebagai entitas.
  // Hasil: [{start, end, quote, attr}] — attr = tanda kutip pembatas atribut, atau null di <script>.
  const attrEncode = (s, delim) => s.replace(/&/g, '&amp;').split(delim).join(delim === '"' ? '&quot;' : '&#39;');
  function findHtmlLiterals(src, text) {
    const out = [];
    if (!text) return out;
    const within = (start, end, delim) => {
      const part = src.slice(start, end);
      for (const quote of ["'", '"', '`']) {
        if (quote === delim) continue;
        const literal = quote + encodeLiteral(text, quote) + quote;
        for (const needle of new Set(delim ? [attrEncode(literal, delim), literal] : [literal])) {
          if (delim && needle.includes(delim)) continue;
          for (let i = part.indexOf(needle); i >= 0; i = part.indexOf(needle, i + 1)) {
            if (part[i - 1] === '\\') continue;
            out.push({ start: start + i + 1, end: start + i + needle.length - 1, quote, attr: delim || null });
          }
        }
      }
    };
    const walk = (el) => {
      for (const n of el.children) {
        if (n.text) continue;
        if (n.start !== undefined && n.innerEnd !== undefined) {
          const list = attrs(src, n);
          if (n.tag === 'script' && !list.some((a) => a.name === 'src')) within(n.innerStart, n.innerEnd, '');
          for (const a of list) if (a.value && /["']/.test(src[a.value.start - 1])) within(a.value.start, a.value.end, src[a.value.start - 1]);
        }
        walk(n);
      }
    };
    walk(parse(src));
    return [...new Map(out.map((o) => [o.start, o])).values()];
  }
  // encodeHtmlLiteral: isi string baru untuk tempat yang ditemukan findHtmlLiterals.
  const encodeHtmlLiteral = (text, lit) => (lit.attr ? attrEncode(encodeLiteral(text, lit.quote), lit.attr) : encodeLiteral(text, lit.quote));

  root.rakitTextEdit = { apply, applyImage, parse, find, encodeLiteral, findLiterals, findHtmlLiterals, encodeHtmlLiteral };
})(typeof window !== 'undefined' ? window : globalThis);
