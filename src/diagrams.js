import path from 'node:path';
import express from 'express';
import { requireAuth } from './auth.js';
import { loadProject } from './projects.js';
import { listTree, readText, userRoot } from './files.js';
import * as userdb from './userdb.js';

// Bahan untuk diagram otomatis project aktif: ERD, peta halaman, dan alur data.
// Semua dihitung dari file & database project (tanpa AI), lalu digambar di editor.

export const diagrams = express.Router();
diagrams.use(requireAuth, loadProject);

const MAX_FILES = 300;
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i; // http:, mailto:, tel:, javascript:, //cdn…

// Ubah href/src relatif dari sebuah file menjadi path file di project (atau null bila eksternal/anchor).
function resolveRef(ref, fromPath, fileSet) {
  const raw = ref.trim();
  if (!raw || raw.startsWith('#') || EXTERNAL_RE.test(raw) || raw.startsWith('data:')) return null;
  const clean = raw.split('#')[0].split('?')[0];
  if (!clean) return null;
  const base = clean.startsWith('/') ? clean : path.posix.join(path.posix.dirname(fromPath), clean);
  let target = path.posix.normalize(base).replace(/^\/+/, '');
  if (target === '.' || target === './') target = '';
  target = target.replace(/^\.\//, '');
  if (target.startsWith('..')) return { target: clean, exists: false };
  const dir = target.replace(/\/+$/, '');
  const candidates = !target || clean.endsWith('/')
    ? [dir ? `${dir}/index.html` : 'index.html']
    : [target, `${target}.html`, `${target}/index.html`];
  const found = candidates.find((c) => fileSet.has(c));
  return { target: found ?? candidates[0], exists: Boolean(found) };
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;

function pageTitle(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '';
  return title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Cari pemakaian API database di kode: /api/db/<tabel>[/<id>] dan metode fetch di dekatnya.
function dbCalls(text) {
  const calls = [];
  for (const m of text.matchAll(/\/api\/db\/([a-z][a-z0-9_]*)(\/[^'"`?\s)]*)?/g)) {
    // Cari opsi method hanya di pemanggilan ini: berhenti di fetch( atau /api/db/ berikutnya.
    let around = text.slice(m.index + m[0].length, m.index + 400);
    const next = around.search(/fetch\s*\(|\/api\/db\//);
    if (next >= 0) around = around.slice(0, next);
    const method = around.match(/method\s*:\s*['"`](GET|POST|PATCH|PUT|DELETE)['"`]/i)?.[1].toUpperCase() ?? 'GET';
    const hasId = Boolean(m[2] && m[2] !== '/');
    const op = { POST: 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete' }[method] ?? (hasId ? 'view' : 'list');
    calls.push({ table: m[1], op });
  }
  return calls;
}

// Relasi resmi dari kolom bertipe `reference` didahulukan; sisanya ditebak dari nama kolom
// (<tabel>_id atau <tabel>) sebagai pelengkap untuk database lama tanpa kolom relasi.
function inferRelations(tables) {
  const names = new Set(tables.map((t) => t.name));
  const relations = [];
  const seen = new Set();
  const add = (from, column, to) => {
    const key = `${from}.${column}->${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    relations.push({ from, column, to });
  };
  for (const t of tables) {
    for (const c of t.columns) {
      if (c.type === 'reference' && c.refTable && names.has(c.refTable)) {
        add(t.name, c.name, c.refTable);
      }
    }
  }
  for (const t of tables) {
    for (const c of t.columns) {
      if (c.type === 'reference') continue;
      const target = c.name.endsWith('_id') ? c.name.slice(0, -3) : c.name;
      if (target !== t.name && names.has(target) && ['number', 'text'].includes(c.type)) {
        add(t.name, c.name, target);
      }
    }
  }
  return relations;
}

diagrams.get('/', async (req, res) => {
  const slug = req.project.slug;
  const root = userRoot(slug);
  const files = (await listTree(root)).filter((e) => e.type === 'file').slice(0, MAX_FILES);
  const fileSet = new Set(files.map((f) => f.path));
  const contents = new Map();
  for (const f of files) contents.set(f.path, await readText(root, f.path).catch(() => ''));

  const tables = userdb.hasDatabase(slug) ? userdb.listTables(slug) : [];
  const tableMap = new Map(tables.map((t) => [t.name, t]));

  // ---- Peta halaman ----
  const pages = files.filter((f) => f.path.endsWith('.html')).map((f) => ({ path: f.path, title: pageTitle(contents.get(f.path)) }));
  const links = [];
  const assets = [];
  const forms = [];
  const headings = [];
  const buttons = [];
  let external = 0;
  for (const page of pages) {
    const html = contents.get(page.path);
    const seen = new Set();
    for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
      const href = attr(tag, 'href');
      if (href === null) continue;
      const ref = resolveRef(href, page.path, fileSet);
      if (!ref) { if (EXTERNAL_RE.test(href.trim()) && /^(https?:)?\/\//i.test(href.trim())) external++; continue; }
      if (ref.target === page.path || seen.has(ref.target)) continue;
      seen.add(ref.target);
      links.push({ from: page.path, to: ref.target, broken: !ref.exists });
    }
    for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
      if (!/stylesheet/i.test(attr(tag, 'rel') ?? '')) continue;
      const ref = resolveRef(attr(tag, 'href') ?? '', page.path, fileSet);
      if (ref) assets.push({ from: page.path, to: ref.target, kind: 'css', missing: !ref.exists });
    }
    for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
      const src = attr(tag, 'src');
      const ref = src ? resolveRef(src, page.path, fileSet) : null;
      if (ref) assets.push({ from: page.path, to: ref.target, kind: 'js', missing: !ref.exists });
    }
    // Form: aksi utama (kirim data) untuk diagram aktivitas & use case.
    for (const [tag] of html.matchAll(/<form\b[^>]*>/gi)) {
      forms.push({ page: page.path, action: attr(tag, 'action'), method: (attr(tag, 'method') ?? 'get').toLowerCase() });
    }
    // Judul & tombol: sumber "fitur" untuk use case & aktivitas.
    for (const [tag, inner] of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) {
      void tag;
      const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
      if (text) headings.push({ page: page.path, text });
    }
    for (const [tag, inner] of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
      void tag;
      const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (text) buttons.push({ page: page.path, text });
    }
  }
  const linkedTo = new Set(links.filter((l) => !l.broken).map((l) => l.to));
  const special = new Set(['index.html', '404.html']);
  pages.forEach((p) => { p.orphan = !special.has(p.path) && !linkedTo.has(p.path); });

  // ---- Alur data: file mana memakai tabel apa, dan apakah aksesnya mengizinkan ----
  const callMap = new Map();
  for (const f of files) {
    if (!/\.(js|html)$/.test(f.path)) continue;
    for (const call of dbCalls(contents.get(f.path))) {
      const key = `${f.path}|${call.table}|${call.op}`;
      if (callMap.has(key)) continue;
      const table = tableMap.get(call.table);
      const status = !table ? 'missing' : table.rules[call.op] === 'public' ? 'ok' : 'owner_only';
      callMap.set(key, { file: f.path, ...call, status });
    }
  }

  res.json({
    project: { slug, name: req.project.name },
    pages,
    links,
    assets,
    forms,
    headings,
    buttons,
    external,
    tables: tables.map((t) => ({ name: t.name, columns: t.columns, rules: t.rules, rowCount: t.rowCount })),
    relations: inferRelations(tables),
    calls: [...callMap.values()],
  });
});
