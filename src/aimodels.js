import { config } from './config.js';
import { db } from './db.js';
import { HttpError } from './http-error.js';

// Model AI editor (Builder/Plan & pembaca gambar), diatur owner di dashboard. Tiap peran punya model utama
// dan daftar model cadangan: bila model utama gangguan, permintaan dialihkan ke cadangan berikutnya sesuai
// urutan (lihat callAI di ai.js). Nilai di .env hanya default sebelum owner pernah menyimpan.

const readSetting = db.prepare("SELECT value FROM settings WHERE key = 'ai_models'");
const writeSetting = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES ('ai_models', ?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
export const MAX_FALLBACKS = 5; // batas model cadangan per peran

/** "a, b,,c" → ['a', 'b', 'c']; untuk .env (AI_FALLBACK_MODEL=a,b). */
export const splitList = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

// Daftar teks, atau satu teks (pengaturan lama sebelum cadangan bisa lebih dari satu). null bila bukan keduanya.
function list(v) {
  if (typeof v === 'string') return splitList(v);
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  return null;
}

/** { model, fallbacks, vision, visionFallbacks } — string kosong = tidak dipakai; cadangan dicoba sesuai urutan. */
export function aiModels() {
  let saved = null;
  try {
    const row = readSetting.get();
    saved = row ? JSON.parse(row.value) : null;
  } catch { /* pengaturan rusak: pakai default */ }
  const text = (key, fallback) => (typeof saved?.[key] === 'string' ? saved[key] : fallback);
  // Pengaturan lama menyimpan satu cadangan di "fallback"/"visionFallback".
  const names = (keys, fallback) => keys.map((k) => list(saved?.[k])).find(Boolean) ?? fallback;
  return {
    model: text('model', config.ai.model),
    fallbacks: names(['fallbacks', 'fallback'], splitList(config.ai.fallbackModel)),
    vision: text('vision', config.ai.visionModel),
    visionFallbacks: names(['visionFallbacks', 'visionFallback'], splitList(config.ai.visionFallbackModel)),
  };
}

/** Simpan pengaturan model dari dashboard owner (divalidasi). */
export function saveAiModels(input) {
  const text = (key) => String(input?.[key] ?? '').trim();
  // Cadangan: daftar "fallbacks"; satu teks "fallback" (bentuk lama) juga diterima.
  const names = (...keys) => keys.map((k) => list(input?.[k])).find(Boolean) ?? [];
  const clean = { model: text('model'), fallbacks: names('fallbacks', 'fallback'), vision: text('vision'), visionFallbacks: names('visionFallbacks', 'visionFallback') };
  if (!clean.model) throw new HttpError(400, 'Model utama wajib diisi');
  for (const [label, value] of [['Model utama', clean.model], ['Model gambar', clean.vision]]) {
    if (value && !MODEL_RE.test(value)) throw new HttpError(400, `${label}: ID model tidak valid`);
  }
  if (clean.visionFallbacks.length && !clean.vision) throw new HttpError(400, 'Isi model gambar dulu sebelum model gambar cadangan');
  for (const [label, primaryLabel, primary, models] of [
    ['Model cadangan', 'model utama', clean.model, clean.fallbacks],
    ['Model gambar cadangan', 'model gambar', clean.vision, clean.visionFallbacks],
  ]) {
    if (models.length > MAX_FALLBACKS) throw new HttpError(400, `${label} maksimal ${MAX_FALLBACKS}`);
    models.forEach((model, i) => {
      if (!MODEL_RE.test(model)) throw new HttpError(400, `${label} ${i + 1}: ID model tidak valid`);
      if (model === primary) throw new HttpError(400, `${label} harus berbeda dari ${primaryLabel}`);
      if (models.indexOf(model) < i) throw new HttpError(400, `${label} "${model}" tercantum dua kali`);
    });
  }
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

/** Urutan model yang dicoba: yang sehat dulu (utama, lalu cadangan sesuai urutan); yang sedang gangguan di belakang. */
export function modelOrder(primary, fallbacks) {
  const list = [...new Set([primary, ...fallbacks].filter(Boolean))];
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
    maxFallbacks: MAX_FALLBACKS,
    fallbackUsed: counters.fallbackUsed,
    health: [...new Set([models.model, ...models.fallbacks, models.vision, ...models.visionFallbacks].filter(Boolean))].map((model) => {
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
