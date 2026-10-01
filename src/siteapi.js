import express from 'express';
import { HttpError } from './http-error.js';
import { rateLimit } from './auth.js';
import * as userdb from './userdb.js';
import { siteAssistant } from './assistant.js';

// API publik di domain user: https://<user>.rakit.io/api/db/<tabel>
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
  const { limit, offset, sort, expand, ...filters } = req.query;
  res.json(userdb.listRows(req.siteUser, table.name, { limit, offset, sort, expand, filters, publicView: true }));
});

siteApi.get('/api/db/:table/:id', (req, res) => {
  const table = publicTable(req, 'view');
  res.json(userdb.getRow(req.siteUser, table.name, req.params.id, { publicView: true, expand: req.query.expand }));
});

siteApi.post('/api/db/:table', (req, res) => {
  const table = publicTable(req, 'create');
  res.status(201).json(userdb.insertRow(req.siteUser, table.name, req.body, { publicView: true }));
});

siteApi.patch('/api/db/:table/:id', (req, res) => {
  const table = publicTable(req, 'update');
  res.json(userdb.updateRow(req.siteUser, table.name, req.params.id, req.body, { publicView: true }));
});

// Upload gambar untuk kolom bertipe image: body = isi file. Mengembalikan { url } untuk disimpan di baris.
const uploadLimiter = rateLimit({
  windowMs: 10 * 60_000, max: 20, key: (req) => `up:${req.siteUser}:${req.ip}`,
  message: 'Terlalu banyak upload gambar. Coba lagi beberapa menit lagi.',
});
siteApi.post('/api/db/:table/upload', uploadLimiter, express.raw({ type: () => true, limit: '11mb' }), async (req, res) => {
  res.status(201).json(await userdb.uploadImage(req.siteUser, req.params.table, req.query.column, req.body, { publicView: true }));
});

siteApi.delete('/api/db/:table/:id', (req, res) => {
  const table = publicTable(req, 'delete');
  userdb.deleteRow(req.siteUser, table.name, req.params.id);
  res.json({ ok: true });
});

// Asisten AI website: /api/ai/chat, /api/ai/config, /api/ai/widget.js
siteApi.use('/api/ai', siteAssistant);

// Seluruh /api/ di domain user dicadangkan untuk sistem (tahap berikutnya: serverless function).
siteApi.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
