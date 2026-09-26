import { config } from './config.js';

// Antrean request ke provider AI: paling banyak `maxConcurrent` panggilan berjalan bersamaan,
// sisanya menunggu urut (FIFO). Disimpan di memori — cukup untuk satu proses server.

const queue = []; // { grant, onPosition, enqueuedAt, timer }
let active = 0;

// Batas adaptif: turun saat provider menolak karena sibuk, naik perlahan saat lancar.
// Dengan begini antrean menemukan sendiri batas concurrency provider yang sebenarnya.
let limit = config.ai.maxConcurrent;
let successStreak = 0;
const RAISE_AFTER = 20;

const counters = { served: 0, queuedTotal: 0, rejectedFull: 0, timedOut: 0, retries: 0 };
const recentWaits = []; // waktu tunggu (ms) 100 request terakhir yang sempat mengantre

export class QueueError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'full' | 'timeout'
  }
}

function notifyPositions() {
  queue.forEach((entry, i) => entry.onPosition?.(i + 1, queue.length));
}

function dispatch() {
  while (active < limit && queue.length) {
    const entry = queue.shift();
    clearTimeout(entry.timer);
    recentWaits.push(Date.now() - entry.enqueuedAt);
    if (recentWaits.length > 100) recentWaits.shift();
    active++;
    counters.served++;
    entry.grant();
  }
  notifyPositions();
}

function makeRelease() {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    dispatch();
  };
}

/**
 * Tunggu giliran memanggil provider. Mengembalikan fungsi `release` yang wajib dipanggil setelah selesai.
 * Melempar QueueError bila antrean penuh atau terlalu lama, atau AbortError bila `signal` dibatalkan.
 */
export function acquireSlot({ signal, onPosition } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  if (active < limit && !queue.length) {
    active++;
    counters.served++;
    return Promise.resolve(makeRelease());
  }
  if (queue.length >= config.ai.queueMax) {
    counters.rejectedFull++;
    return Promise.reject(new QueueError('full', 'AI sedang penuh. Coba lagi beberapa saat lagi.'));
  }

  counters.queuedTotal++;
  return new Promise((resolve, reject) => {
    const entry = { onPosition, enqueuedAt: Date.now() };
    const leave = () => {
      const i = queue.indexOf(entry);
      if (i >= 0) queue.splice(i, 1);
      signal?.removeEventListener('abort', onAbort);
      notifyPositions();
    };
    const onAbort = () => {
      clearTimeout(entry.timer);
      leave();
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    entry.grant = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve(makeRelease());
    };
    entry.timer = setTimeout(() => {
      counters.timedOut++;
      leave();
      reject(new QueueError('timeout', 'Antrean AI terlalu lama.'));
    }, config.ai.queueTimeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    queue.push(entry);
    notifyPositions();
  });
}

export const countRetry = () => { counters.retries++; };

/** Provider menolak karena sibuk (dipanggil selagi slot pemanggil masih terpakai). */
export function reportBusy() {
  limit = Math.max(1, Math.min(limit, active) - 1);
  successStreak = 0;
}

/** Panggilan ke provider berhasil. */
export function reportSuccess() {
  if (limit >= config.ai.maxConcurrent) return;
  if (++successStreak >= RAISE_AFTER) {
    limit++;
    successStreak = 0;
    dispatch();
  }
}

export function queueStats() {
  const waits = [...recentWaits].sort((a, b) => a - b);
  return {
    active,
    queued: queue.length,
    maxConcurrent: config.ai.maxConcurrent,
    currentLimit: limit,
    queueMax: config.ai.queueMax,
    queueTimeoutSeconds: config.ai.queueTimeoutMs / 1000,
    ...counters,
    medianWaitMs: waits.length ? waits[Math.floor(waits.length / 2)] : 0,
    maxWaitMs: waits.at(-1) ?? 0,
  };
}
