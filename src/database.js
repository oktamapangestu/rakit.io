import express from 'express';
import { requireAuth } from './auth.js';
import * as userdb from './userdb.js';

// API editor database — hanya untuk pemilik proyek (sesi login di rakit.icu).
export const database = express.Router();

database.use(requireAuth);
const owner = (req) => req.user.username;

database.get('/tables', (req, res) => {
  res.json({ tables: userdb.listTables(owner(req)), usage: userdb.usage(owner(req)) });
});

database.post('/tables', (req, res) => {
  res.status(201).json({ table: userdb.createTable(owner(req), req.body) });
});

database.patch('/tables/:name', (req, res) => {
  res.json({ table: userdb.updateTable(owner(req), req.params.name, req.body ?? {}) });
});

database.delete('/tables/:name', (req, res) => {
  userdb.deleteTable(owner(req), req.params.name);
  res.json({ ok: true });
});

database.get('/tables/:name/rows', (req, res) => {
  const { limit, offset, sort, ...filters } = req.query;
  res.json(userdb.listRows(owner(req), req.params.name, { limit, offset, sort, filters }));
});

database.post('/tables/:name/rows', (req, res) => {
  res.status(201).json({ row: userdb.insertRow(owner(req), req.params.name, req.body) });
});

database.patch('/tables/:name/rows/:id', (req, res) => {
  res.json({ row: userdb.updateRow(owner(req), req.params.name, req.params.id, req.body) });
});

database.delete('/tables/:name/rows/:id', (req, res) => {
  userdb.deleteRow(owner(req), req.params.name, req.params.id);
  res.json({ ok: true });
});
