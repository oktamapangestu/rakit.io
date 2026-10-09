// Panggilan API server (JSON, project aktif di header X-Project) dan pembaca respons NDJSON (stream AI).
import { core as state } from '../files/state.svelte.js';
import { HOME } from './util.js';

// ---------- API ----------
export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.projectSlug ? { 'X-Project': state.projectSlug } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    location.href = HOME;
    throw new Error('Sesi berakhir');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Gagal (${res.status})`);
    err.code = data.code;
    throw err;
  }
  return data;
}

// Baca respons NDJSON baris demi baris.
export async function* readEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
}
