// Versi bahasa Inggris aplikasi (rakit.io/en/...), dibuat saat build dari sumber berbahasa Indonesia.
//
// Kode di assets-source/js, komponen Svelte di assets-source/editor, dan public/editor.html tetap ditulis dalam
// bahasa Indonesia. Kamus di assets-source/i18n/en/<file>.json memetakan teks Indonesia -> Inggris, lalu skrip
// ini menulis:
//   public/js/en/<file>.js     (dibundel & diminify, lihat scripts/bundle.mjs) dari assets-source/js/<file>.js
//                              beserta modul & komponen .svelte yang diimpornya (memakai kamus <file>.js yang sama)
//   public/en/editor.html                   dari public/editor.html
// Halaman landing & panduan berbahasa Inggris ditulis tangan (public/en/index.html, public/en/panduan.html).
//
// Kunci kamus:
//   - string '...' / "..."  -> nilainya (setelah escape diurai), mis. "Sesi berakhir"
//   - template `...`        -> isi mentahnya apa adanya, termasuk ${ekspresi}, mis. "Gagal (${res.status})".
//     Terjemahannya wajib memuat ${ekspresi} yang sama persis (urutannya boleh berbeda).
//   - HTML: potongan teks di antara tag (tanpa spasi tepi) dan nilai atribut title/placeholder/aria-label/alt.
//   - Svelte: teks & atribut di markup seperti HTML (teks persis lebih dulu, lalu tanpa spasi tepi), kode di
//     <script> dan di dalam {...} seperti JS. Teks yang sama tapi beda terjemahan menurut tempatnya: beri elemennya
//     data-i18n="konteks", lalu tulis kuncinya "teks|konteks" (mis. "Tabel|daftar": "Tables"); tanpa kunci itu,
//     kunci biasa yang dipakai. Kalimat yang memuat nilai ditulis sebagai satu template literal,
//     mis. {`Sisa ${n} kredit`}, supaya satu kalimat = satu kunci kamus.
// Teks yang tidak ada di kamus (atau terjemahannya kosong) dibiarkan berbahasa Indonesia. Teks yang sengaja
// tidak diubah ditulis dengan terjemahan yang sama, mis. "folder": "folder".
//
// Pemakaian:
//   node scripts/i18n.mjs build      tulis hasil + laporkan teks yang belum diterjemahkan
//   node scripts/i18n.mjs extract    tambahkan teks Indonesia yang belum ada ke kamus (nilai "") untuk diisi
//   node scripts/i18n.mjs check      keluar dengan kode 1 bila ada teks yang belum diterjemahkan
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseSvelte } from 'svelte/compiler';
import { bundle } from './bundle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DICT_DIR = path.join(ROOT, 'assets-source/i18n/en');

const JS_FILES = ['auth.js', 'editor.js', 'textedit.js', 'panduan.js'];
const HTML_FILES = ['editor.html'];

// ---------- Lexer JavaScript (cukup untuk kode kita: string, template, komentar, regex) ----------

const KEYWORDS_BEFORE_EXPR = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new',
  'else', 'do', 'instanceof', 'yield', 'await']);

// tokenize mengembalikan literal tingkat atas: {kind:'str'|'tpl', start, end, children?}. children = literal
// di dalam ${...} sebuah template (dipakai bila template itu sendiri tidak ada di kamus).
export function tokenize(src, from = 0, until = src.length, stopAtBrace = false) {
  const out = [];
  let i = from;
  let prev = ''; // token bermakna terakhir: untuk membedakan regex dari pembagian
  let depth = 0;
  const isIdent = (c) => /[\w$]/.test(c);
  while (i < until) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) i = until; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) i = until; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '\'' || c === '"') {
      const start = i;
      i++;
      while (i < until && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++;
      out.push({ kind: 'str', start, end: i });
      prev = 'lit';
      continue;
    }
    if (c === '`') {
      const tpl = scanTemplate(src, i);
      out.push(tpl);
      i = tpl.end;
      prev = 'lit';
      continue;
    }
    if (c === '/') {
      const regexAllowed = prev === '' || prev === 'op' || KEYWORDS_BEFORE_EXPR.has(prev);
      if (regexAllowed) {
        i++;
        let inClass = false;
        while (i < until) {
          const d = src[i];
          if (d === '\\') { i += 2; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) break;
          else if (d === '\n') break;
          i++;
        }
        i++;
        while (i < until && /[a-z]/i.test(src[i])) i++;
        prev = 'lit';
        continue;
      }
      i++;
      prev = 'op';
      continue;
    }
    if (isIdent(c)) {
      const start = i;
      while (i < until && isIdent(src[i])) i++;
      const word = src.slice(start, i);
      prev = KEYWORDS_BEFORE_EXPR.has(word) ? word : 'lit';
      continue;
    }
    if (stopAtBrace) {
      if (c === '{') depth++;
      if (c === '}') { if (depth === 0) return { tokens: out, end: i }; depth--; }
    }
    i++;
    prev = c === ')' || c === ']' || c === '}' ? 'lit' : 'op';
  }
  return stopAtBrace ? { tokens: out, end: i } : out;
}

function scanTemplate(src, start) {
  const children = [];
  let i = start + 1;
  while (i < src.length && src[i] !== '`') {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '$' && src[i + 1] === '{') {
      const inner = tokenize(src, i + 2, src.length, true);
      children.push(...inner.tokens);
      i = inner.end + 1;
      continue;
    }
    i++;
  }
  return { kind: 'tpl', start, end: i + 1, children };
}

// mapPlaceholders memanggil fn(kode) untuk setiap ${kode} di isi mentah sebuah template (mengikuti kurung
// kurawal & literal di dalamnya) dan menyusun ulang isinya dengan hasil fn.
function mapPlaceholders(raw, fn) {
  const src = `\`${raw}\``;
  let out = '';
  let i = 1;
  let last = 1;
  while (i < src.length - 1) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '$' && src[i + 1] === '{') {
      const inner = tokenize(src, i + 2, src.length, true);
      out += src.slice(last, i + 2) + fn(src.slice(i + 2, inner.end)) + '}';
      i = last = inner.end + 1;
      continue;
    }
    i++;
  }
  return out + src.slice(last, src.length - 1);
}

// Bentuk jamak versi Inggris: "{credit|credits}" di terjemahan memilih kata menurut angka placeholder tepat sebelumnya,
// mis. "${n} {credit|credits}" → "1 credit" / "2 credits" (bahasa Indonesia tidak membedakannya).
const PLURAL = /\{([^{}|$\n]+)\|([^{}|\n]+)\}/g;
function expandPlurals(raw) {
  const src = `\`${raw}\``;
  let out = '';
  let i = 1;
  let last = 1;
  let prev = null;
  const lit = (text) => text.replace(PLURAL, (_, one, many) => {
    if (prev == null) throw new Error(`bentuk jamak tanpa angka sebelumnya: ${JSON.stringify(raw)}`);
    return `\${Number(${prev}) === 1 ? ${quote(one, "'")} : ${quote(many, "'")}}`;
  });
  while (i < src.length - 1) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '$' && src[i + 1] === '{') {
      const inner = tokenize(src, i + 2, src.length, true);
      out += lit(src.slice(last, i)) + src.slice(i, inner.end + 1);
      prev = src.slice(i + 2, inner.end);
      i = last = inner.end + 1;
      continue;
    }
    i++;
  }
  return out + lit(src.slice(last, src.length - 1));
}

function placeholders(raw) {
  const found = [];
  mapPlaceholders(raw, (code) => { found.push(code); return code; });
  return found.sort();
}

const cook = (raw) => new Function(`return ${raw}`)();

function quote(value, q) {
  const body = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replaceAll(q, `\\${q}`);
  return q + body + q;
}

// Kunci kamus untuk sebuah literal.
function keyOf(src, tok) {
  return tok.kind === 'str' ? cook(src.slice(tok.start, tok.end)) : src.slice(tok.start + 1, tok.end - 1);
}

// Teks yang patut diterjemahkan: memuat huruf, bukan selector/kelas/path/kode.
const ID_WORDS = /\b(yang|dan|atau|untuk|tidak|tak|dengan|ini|itu|dari|ke|di|sudah|belum|bisa|akan|kamu|anda|baru|hapus|simpan|batal|gagal|berhasil|buka|tutup|ubah|tambah|pilih|salin|unduh|muat|ulang|masuk|keluar|daftar|kosong|semua|lihat|kembali|ganti|nama|isi|tabel|kolom|baris|halaman|gambar|riwayat|versi|kredit|saldo|paket|langganan|fungsi|jalankan|sedang|selesai|mohon|coba|lagi|terlalu|harus|minimal|maksimal|perubahan|tersimpan|disimpan|dihapus|diubah|dibuat|pengunjung|pemilik|bagian|panduan|bayar|beli|isi ulang|aktif|nonaktif|hari|jam|menit|detik|lalu|kemarin|sekarang|hanya|juga|saja|pakai|memakai|dipakai|perlu|tanpa|setelah|sebelum|saat|kalau|jika|bila|agar|supaya|sini|mana|apa|siapa|kenapa|bagaimana|teks|tombol|tulis|minta|tanya|jawab|pesan|ada|tidak ada|belum ada|mulai|berhenti|tunggu|memuat|menyimpan|membuat|mengubah|menghapus|menulis|membaca|mencari|cari|ukuran|warna|tampilan|layar|rahasia|kunci|aturan|akses|publik|pribadi|gratis|habis|tersisa|sisa|kali|pertama|terakhir|lain|lainnya|contoh|misalnya|penjelasan|alur|temuan|perbaiki|periksa|kode|berkas|folder|terhubung|putus|unggah|upload)\b/i;

function looksIndonesian(text) {
  if (!/[a-z]{2}/i.test(text)) return false;
  // Satu "kata" berisi -, /, ? atau = : nama kelas, path, atau URL, bukan teks untuk dibaca.
  if (!/\s/.test(text.trim()) && /[-/?=]/.test(text)) return false;
  return ID_WORDS.test(text.replace(/\$\{[^}]*\}/g, ' '));
}

// ---------- JS ----------

export function translateJS(src, dict, report) {
  const edits = [];
  const visit = (tokens) => {
    for (const tok of tokens) {
      const key = keyOf(src, tok);
      const en = dict[key];
      if (en) {
        if (tok.kind === 'str') {
          edits.push({ start: tok.start, end: tok.end, text: quote(en, src[tok.start]) });
        } else {
          const want = placeholders(key).join('\n');
          if (placeholders(en).join('\n') !== want) {
            report.errors.push(`placeholder tidak cocok: ${JSON.stringify(key)} -> ${JSON.stringify(en)}`);
          } else {
            // Teks di dalam ${...} ikut diterjemahkan.
            const out = mapPlaceholders(expandPlurals(en), (code) => translateJS(code, dict, report));
            edits.push({ start: tok.start, end: tok.end, text: `\`${out}\`` });
          }
        }
        report.used.add(key);
        continue;
      }
      if (looksIndonesian(key) && !(tok.kind === 'tpl' && tok.children.length && !looksIndonesian(key.replace(/\$\{[\s\S]*?\}/g, '')))) {
        report.missing.add(key);
      }
      if (tok.kind === 'tpl') visit(tok.children);
    }
  };
  visit(tokenize(src));
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// ---------- Svelte ----------

// Jenis simpul template Svelte (selain itu: simpul estree = kode JS).
const SVELTE_NODE = /^(Root|Fragment|Text|Comment|ExpressionTag|HtmlTag|ConstTag|DebugTag|RenderTag|AttachTag|RegularElement|Component|SlotElement|TitleElement|Svelte[A-Za-z]+|IfBlock|EachBlock|AwaitBlock|KeyBlock|SnippetBlock|Attribute|SpreadAttribute|[A-Za-z]+Directive|Script)$/;
const escapeText = (s, attr) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
  .replace(/"/g, attr ? '&quot;' : '"');

export function translateSvelte(src, dict, report, file = 'komponen.svelte') {
  const ast = parseSvelte(src, { modern: true, filename: file });
  const edits = [];
  // Kunci: teks persis, lalu dengan spasi dirapatkan (seperti hasil Svelte, mis. " dan " di antara dua <code>
  // yang dipisah baris baru), lalu tanpa spasi tepi.
  const text = (node, attr, ctx) => {
    const collapsed = node.data.replace(/\s+/g, ' ');
    const trimmed = collapsed.trim();
    if (!trimmed) return;
    const inCtx = ctx && dict[`${trimmed}|${ctx}`] ? `${trimmed}|${ctx}` : null;
    const whole = inCtx ? null : [node.data, collapsed].find((k) => dict[k]);
    const key = inCtx ?? whole ?? trimmed;
    const en = dict[key];
    if (en) {
      report.used.add(key);
      const raw = src.slice(node.start, node.end);
      const out = whole ? escapeText(en, attr) : raw.replace(raw.trim(), escapeText(en, attr));
      edits.push({ start: node.start, end: node.end, text: out });
    } else if (looksIndonesian(key)) {
      report.missing.add(key);
    }
  };
  const code = (node) => {
    const out = translateJS(src.slice(node.start, node.end), dict, report);
    if (out !== src.slice(node.start, node.end)) edits.push({ start: node.start, end: node.end, text: out });
  };
  // ctx: nilai data-i18n elemen terdekat (konteks terjemahan).
  const walk = (node, attr, ctx) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, attr, ctx));
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Text') {
      if (attr !== false) text(node, attr === true || attr === 'component', ctx);
      return;
    }
    if (node.type === 'Comment') return;
    if (node.type && !SVELTE_NODE.test(node.type)) return code(node);
    if (node.type === 'Attribute') return walk(node.value, attr === 'component' || HTML_ATTRS.includes(node.name), ctx);
    if (node.type === 'RegularElement') {
      const own = node.attributes.find((a) => a.type === 'Attribute' && a.name === 'data-i18n');
      if (own && Array.isArray(own.value) && own.value[0]?.type === 'Text') ctx = own.value[0].data;
    }
    // Prop teks komponen (mis. <AiButton label="Perbaiki dengan AI" />) diterjemahkan seperti title/placeholder.
    const component = node.type === 'Component' || node.type === 'SvelteComponent' || node.type === 'SvelteSelf';
    for (const [key, child] of Object.entries(node)) {
      if (key === 'metadata' || key === 'css' || key === 'loc') continue;
      walk(child, component && key === 'attributes' ? 'component' : node.type === 'Script' ? undefined : attr, ctx);
    }
  };
  walk(ast.instance);
  walk(ast.module);
  walk(ast.fragment);
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// ---------- HTML ----------

const HTML_ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];

export function translateHTML(src, dict, report) {
  const take = (text) => {
    const key = text.trim().replace(/\s+/g, ' ');
    if (!key) return text;
    const en = dict[key];
    if (en) {
      report.used.add(key);
      return text.replace(text.trim(), en);
    }
    if (looksIndonesian(key)) report.missing.add(key);
    return text;
  };
  let out = '';
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { out += take(src.slice(i)); break; }
    out += take(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt) + 3;
      out += src.slice(lt, end);
      i = end;
      continue;
    }
    const gt = tagEnd(src, lt);
    let tag = src.slice(lt, gt + 1);
    tag = tag.replace(/(\s)([\w-]+)="([^"]*)"/g, (m, sp, name, value) =>
      (HTML_ATTRS.includes(name) ? `${sp}${name}="${take(value)}"` : m));
    out += tag;
    i = gt + 1;
    const name = /^<([a-z]+)/i.exec(tag)?.[1]?.toLowerCase();
    if (name === 'script' || name === 'style') {
      const close = src.indexOf(`</${name}`, i);
      out += src.slice(i, close);
      i = close;
    }
  }
  return out;
}

function tagEnd(src, lt) {
  let q = null;
  for (let i = lt + 1; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === '\'') q = c;
    else if (c === '>') return i;
  }
  return src.length - 1;
}

// Penyesuaian halaman editor versi Inggris: bahasa, skrip ber-versi Inggris, dan tautan halaman.
function localizeEditorPage(html) {
  return html
    .replace('<html lang="id">', '<html lang="en">')
    .replace(/src="\/js\/(textedit|editor)\.js"/g, 'src="/js/en/$1.js"')
    .replace(/href="\/(editor|panduan)"/g, 'href="/en/$1"');
}

// ---------- Kamus ----------

function loadDict(name) {
  const file = path.join(DICT_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveDict(name, dict) {
  fs.mkdirSync(DICT_DIR, { recursive: true });
  fs.writeFileSync(path.join(DICT_DIR, `${name}.json`), `${JSON.stringify(dict, null, 2)}\n`);
}

async function run(mode) {
  let missingTotal = 0;
  let errors = 0;
  const jobs = [
    ...JS_FILES.map((name) => ({ name, kind: 'js', src: path.join(ROOT, 'assets-source/js', name) })),
    ...HTML_FILES.map((name) => ({ name, kind: 'html', src: path.join(ROOT, 'public', name) })),
  ];
  for (const job of jobs) {
    const dict = loadDict(job.name);
    const report = { used: new Set(), missing: new Set(), errors: [] };
    let out;
    if (job.kind === 'js') {
      // Modul & komponen yang diimpor ikut diterjemahkan dengan kamus yang sama; build = tulis hasil bundelnya.
      await bundle(job.src, path.join(ROOT, 'public/js/en', job.name), {
        write: mode === 'build',
        translate: {
          js: (src) => translateJS(src, dict, report),
          svelte: (src, file) => translateSvelte(src, dict, report, file),
        },
      });
    } else {
      out = translateHTML(fs.readFileSync(job.src, 'utf8'), dict, report);
    }
    for (const e of report.errors) console.error(`  ${job.name}: ${e}`);
    errors += report.errors.length;

    if (mode === 'extract') {
      let added = 0;
      for (const key of report.missing) if (!(key in dict)) { dict[key] = ''; added++; }
      if (added) saveDict(job.name, dict);
      console.log(`  ${job.name}: ${added} teks baru ditambahkan ke kamus`);
      continue;
    }

    const missing = [...report.missing];
    missingTotal += missing.length;
    const unused = Object.keys(dict).filter((k) => dict[k] && !report.used.has(k));
    if (missing.length) {
      console.log(`  ${job.name}: ${missing.length} teks belum diterjemahkan`);
      for (const k of missing.slice(0, mode === 'check' ? Infinity : 10)) console.log(`    - ${JSON.stringify(k).slice(0, 140)}`);
    }
    if (unused.length) {
      console.log(`  ${job.name}: ${unused.length} terjemahan tidak dipakai lagi (teks sumbernya berubah?)`);
      for (const k of unused.slice(0, mode === 'check' ? Infinity : 10)) console.log(`    - ${JSON.stringify(k).slice(0, 140)}`);
    }

    if (mode === 'build' && job.kind === 'html') {
      fs.mkdirSync(path.join(ROOT, 'public/en'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'public/en', job.name), localizeEditorPage(out));
    }
  }
  if (mode === 'check' && (missingTotal || errors)) process.exit(1);
  if (errors) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || 'build';
  if (!['build', 'extract', 'check'].includes(mode)) {
    console.error('Pemakaian: node scripts/i18n.mjs [build|extract|check]');
    process.exit(2);
  }
  console.log(`== Bahasa Inggris (${mode}) ==`);
  await run(mode);
}
