import express from 'express';
import { HttpError } from './http-error.js';
import { rateLimit } from './auth.js';
import * as userdb from './userdb.js';

// API publik di domain user: https://<user>.rakit.icu/api/db/<tabel>
// Hanya operasi yang dibuka "Publik" oleh pemilik di editor database yang boleh dipakai.
export const siteApi = express.Router();

const perSite = (req) => `${req.siteUser}:${req.ip}`;
const readLimiter = rateLimit({ windowMs: 60_000, max: 300, key: perSite });
const writeLimiter = rateLimit({ windowMs: 60_000, max: 60, key: perSite });

siteApi.use('/api/db', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return (['GET', 'HEAD'].includes(req.method) ? readLimiter : writeLimiter)(req, res, next);
});
siteApi.use(express.json({ limit: '64kb' }));

const OP_LABEL = { list: 'melihat daftar', view: 'melihat', create: 'menambah', update: 'mengubah', delete: 'menghapus' };

function publicTable(req, op) {
  const table = userdb.getTable(req.siteUser, req.params.table);
  if (table.rules[op] !== 'public') {
    throw new HttpError(403, `Pengunjung tidak diizinkan ${OP_LABEL[op]} data tabel "${table.name}". Pemilik bisa membukanya di editor database → Atur → Akses.`);
  }
  return table;
}

siteApi.get('/api/db/:table', (req, res) => {
  const table = publicTable(req, 'list');
  const { limit, offset, sort, ...filters } = req.query;
  res.json(userdb.listRows(req.siteUser, table.name, { limit, offset, sort, filters, publicView: true }));
});

siteApi.get('/api/db/:table/:id', (req, res) => {
  const table = publicTable(req, 'view');
  res.json(userdb.getRow(req.siteUser, table.name, req.params.id, { publicView: true }));
});

siteApi.post('/api/db/:table', (req, res) => {
  const table = publicTable(req, 'create');
  res.status(201).json(userdb.insertRow(req.siteUser, table.name, req.body, { publicView: true }));
});

// id biasanya di URL (/api/db/<tabel>/<id>), tapi ?id= atau "id" di body JSON juga diterima,
// karena itu gaya REST yang umum dipakai orang (dan AI).
function rowIdFrom(req) {
  const id = req.params.id ?? req.query.id ?? req.body?.id;
  if (id === undefined || id === '') throw new HttpError(400, 'Sertakan id baris, contoh /api/db/<tabel>/<id>');
  return id;
}
const withoutId = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { id, created_at: createdAt, ...rest } = body;
  return rest;
};

function updateHandler(req, res) {
  const table = publicTable(req, 'update');
  res.json(userdb.updateRow(req.siteUser, table.name, rowIdFrom(req), withoutId(req.body), { publicView: true }));
}
// PUT diperlakukan sama seperti PATCH (hanya kolom yang dikirim yang diubah).
siteApi.patch('/api/db/:table/:id', updateHandler);
siteApi.put('/api/db/:table/:id', updateHandler);
siteApi.patch('/api/db/:table', updateHandler);
siteApi.put('/api/db/:table', updateHandler);

function deleteHandler(req, res) {
  const table = publicTable(req, 'delete');
  userdb.deleteRow(req.siteUser, table.name, rowIdFrom(req));
  res.json({ ok: true });
}
siteApi.delete('/api/db/:table/:id', deleteHandler);
siteApi.delete('/api/db/:table', deleteHandler);

// Seluruh /api/ di domain user dicadangkan untuk sistem (tahap berikutnya: serverless function).
siteApi.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
