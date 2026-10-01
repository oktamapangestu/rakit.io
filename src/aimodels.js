import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './http-error.js';

// Model AI editor (Builder/Plan & pembaca gambar), diatur owner di dashboard. Tiap peran punya model utama
// dan model cadangan: bila model utama gangguan, permintaan dialihkan ke cadangan (lihat callAI di ai.js).
// Nilai di .env hanya default sebelum owner pernah menyimpan.

const readSetting = db.prepare("SELECT value FROM settings WHERE key = 'ai_models'");
const writeSetting = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES ('ai_models', ?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

const FIELDS = ['model', 'fallback', 'vision', 'visionFallback'];
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

const defaults = () => ({
  model: config.ai.model,
  fallback: config.ai.fallbackModel,
  vision: config.ai.visionModel,
  visionFallback: config.ai.visionFallbackModel,
});

/** { model, fallback, vision, visionFallback } — string kosong = tidak dipakai. */
export function aiModels() {
  let saved = null;
  try {
    const row = readSetting.get();
    saved = row ? JSON.parse(row.value) : null;
  } catch { /* pengaturan rusak: pakai default */ }
  const base = defaults();
  return Object.fromEntries(FIELDS.map((f) => [f, typeof saved?.[f] === 'string' ? saved[f] : base[f]]));
}

/** Simpan pengaturan model dari dashboard owner (divalidasi). */
export function saveAiModels(input) {
  const clean = Object.fromEntries(FIELDS.map((f) => [f, String(input?.[f] ?? '').trim()]));
  const labels = { model: 'Model utama', fallback: 'Model cadangan', vision: 'Model gambar', visionFallback: 'Model gambar cadangan' };
  if (!clean.model) throw new HttpError(400, 'Model utama wajib diisi');
  for (const f of FIELDS) {
    if (clean[f] && !MODEL_RE.test(clean[f])) throw new HttpError(400, `${labels[f]}: ID model tidak valid`);
  }
  if (clean.fallback === clean.model) throw new HttpError(400, 'Model cadangan harus berbeda dari model utama');
  if (clean.visionFallback && !clean.vision) throw new HttpError(400, 'Isi model gambar dulu sebelum model gambar cadangan');
  if (clean.visionFallback && clean.visionFallback === clean.vision) throw new HttpError(400, 'Model gambar cadangan harus berbeda dari model gambar');
  writeSetting.run(JSON.stringify(clean), Date.now());
  return aiModels();
}

// ---------- Kesehatan model ----------
// Model yang baru saja gangguan dilewati dulu selama COOLDOWN_MS, supaya permintaan berikutnya langsung
// memakai cadangan tanpa menunggu model utama gagal lagi. Setelah itu model utama dicoba kembali.
// Disimpan di memori — cukup untuk satu proses server.

const COOLDOWN_MS = 5 * 60 * 1000;
const health = new Map(); // id model -> { downUntil, failures, lastError, lastFailureAt }
const counters = { fallbackUsed: 0 };

const isDown = (model) => (health.get(model)?.downUntil ?? 0) > Date.now();

/** Urutan model yang dicoba: yang sehat dulu; bila semuanya sedang gangguan, tetap urutan utama → cadangan. */
export function modelOrder(primary, fallback) {
  const list = [...new Set([primary, fallback].filter(Boolean))];
  return [...list.filter((m) => !isDown(m)), ...list.filter(isDown)];
}

export function reportModelDown(model, detail) {
  const entry = health.get(model) ?? { downUntil: 0, failures: 0, lastError: '', lastFailureAt: 0 };
  entry.downUntil = Date.now() + COOLDOWN_MS;
  entry.failures++;
  entry.lastError = String(detail ?? '').slice(0, 200);
  entry.lastFailureAt = Date.now();
  health.set(model, entry);
}

export function reportModelUp(model) {
  const entry = health.get(model);
  if (entry) entry.downUntil = 0;
}

export const countFallback = () => { counters.fallbackUsed++; };

/** Untuk dashboard owner: pengaturan + keadaan tiap model sejak server dinyalakan. */
export function aiModelsView() {
  const models = aiModels();
  const now = Date.now();
  return {
    models,
    cooldownMinutes: COOLDOWN_MS / 60000,
    fallbackUsed: counters.fallbackUsed,
    health: [...new Set(FIELDS.map((f) => models[f]).filter(Boolean))].map((model) => {
      const entry = health.get(model);
      return {
        model,
        down: Boolean(entry && entry.downUntil > now),
        retryInSeconds: entry && entry.downUntil > now ? Math.ceil((entry.downUntil - now) / 1000) : 0,
        failures: entry?.failures ?? 0,
        lastError: entry?.lastError ?? '',
        lastFailureAt: entry?.lastFailureAt ? new Date(entry.lastFailureAt).toISOString() : null,
      };
    }),
  };
}
