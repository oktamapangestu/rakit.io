import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { q } from './db.js';
import { cleanPath, isAllowedFile, resolveIn, statOrNull, userRoot } from './files.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

async function findFile(root, rel) {
  try {
    const clean = cleanPath(rel);
    if (!isAllowedFile(clean)) return null;
    const abs = resolveIn(root, clean);
    const st = await statOrNull(abs);
    return st?.isFile() ? { abs, st, ext: path.extname(clean).toLowerCase() } : null;
  } catch {
    return null;
  }
}

async function isDir(root, rel) {
  try {
    return (await statOrNull(resolveIn(root, cleanPath(rel))))?.isDirectory() ?? false;
  } catch {
    return false;
  }
}

function sendFile(req, res, file, status = 200) {
  const etag = `W/"${file.st.size.toString(16)}-${file.st.mtimeMs.toString(16)}"`;
  res.set({
    'Content-Type': MIME[file.ext],
    'Cache-Control': 'no-cache', // selalu revalidasi, supaya preview langsung ter-update
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  });
  if (status === 200 && req.get('if-none-match') === etag) return res.status(304).end();
  res.status(status).set('Content-Length', String(file.st.size));
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file.abs).pipe(res);
}

function notFoundPage(res, title, message) {
  res.status(404).type('html').send(`<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1117;color:#c9d1d9;
       font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px;box-sizing:border-box}
  main{text-align:center;max-width:420px}
  h1{font-size:64px;margin:0;color:#58a6ff;font-family:ui-monospace,Menlo,monospace}
  a{color:#58a6ff}
</style></head>
<body><main><h1>404</h1><p><strong>${title}</strong><br>${message}</p>
<p><a href="${config.appOrigin}">Buat website gratis di ${config.baseDomain}</a></p></main></body></html>`);
}

export async function serveSite(req, res, slug) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return res.status(405).set('Allow', 'GET, HEAD').end();
  }
  if (!q.projectBySlug.get(slug)) {
    return notFoundPage(res, 'Situs tidak ditemukan', `${config.siteHost(slug)} belum dipakai siapa pun.`);
  }

  const root = userRoot(slug);
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return res.status(400).end();
  }

  let rel = pathname.replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';

  let file = await findFile(root, rel);
  // URL bersih: /about -> about.html
  if (!file && !path.extname(rel)) file = await findFile(root, `${rel}.html`);
  if (file) return sendFile(req, res, file);

  if (!pathname.endsWith('/') && (await isDir(root, rel))) {
    return res.redirect(301, `${pathname}/`);
  }
  const custom404 = await findFile(root, '404.html');
  if (custom404) return sendFile(req, res, custom404, 404);
  return notFoundPage(res, 'Halaman tidak ditemukan', `File <code>${pathname.replace(/[<>&"]/g, '')}</code> tidak ada.`);
}
