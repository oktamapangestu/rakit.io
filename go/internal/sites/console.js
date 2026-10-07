// Penangkap log untuk tab Console di editor rakit.io. Disisipkan server paling awal di halaman yang dimuat
// di dalam iframe (Sec-Fetch-Dest: iframe), sebelum skrip website, lalu meneruskan ke editor (origin
// aplikasi) lewat postMessage: console.*, error yang tidak tertangkap, file yang gagal dimuat, dan request
// fetch/XHR. Pesan hanya sampai bila induknya memang editor (targetOrigin = origin aplikasi).
(() => {
  const script = document.currentScript;
  const APP = script && script.dataset.app;
  if (!APP || window.parent === window) return;
  script.remove(); // jangan ikut terhitung sebagai elemen halaman

  const MAX_TEXT = 4000;
  const MAX_PER_SECOND = 100; // log di dalam loop tidak boleh membanjiri editor
  let second = 0;
  let sent = 0;
  let dropped = 0;

  function post(entry) {
    const now = Math.floor(Date.now() / 1000);
    if (now !== second) {
      if (dropped) {
        const note = { source: 'sys', level: 'warn', text: `${dropped} log dilewati (lebih dari ${MAX_PER_SECOND} log per detik)` };
        try { window.parent.postMessage({ rakit: true, type: 'log', page: location.pathname, time: Date.now(), ...note }, APP); } catch {}
      }
      second = now;
      sent = 0;
      dropped = 0;
    }
    if (++sent > MAX_PER_SECOND) {
      dropped += 1;
      return;
    }
    try {
      window.parent.postMessage({ rakit: true, type: 'log', page: location.pathname, time: Date.now(), ...entry }, APP);
    } catch {}
  }

  // Ubah nilai apa pun menjadi teks pendek yang mirip tampilan console browser.
  function describe(value, depth = 0, seen = new WeakSet()) {
    if (typeof value === 'string') return depth ? JSON.stringify(value) : value;
    if (value === undefined) return 'undefined';
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') return `\u0192 ${value.name || '(anonim)'}()`;
    if (value instanceof Error) return value.stack && depth === 0 ? value.stack : `${value.name}: ${value.message}`;
    if (typeof Element !== 'undefined' && value instanceof Element) {
      const id = value.id ? `#${value.id}` : '';
      const cls = typeof value.className === 'string' && value.className.trim() ? `.${value.className.trim().split(/\s+/).join('.')}` : '';
      return `<${value.tagName.toLowerCase()}${id}${cls}>`;
    }
    if (seen.has(value)) return '[Circular]';
    if (depth >= 3) return Array.isArray(value) ? `Array(${value.length})` : '{\u2026}';
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const items = value.slice(0, 50).map((v) => describe(v, depth + 1, seen));
        if (value.length > 50) items.push(`\u2026 ${value.length - 50} lagi`);
        return `[${items.join(', ')}]`;
      }
      if (value instanceof Map) return `Map(${value.size}) {${[...value].slice(0, 20).map(([k, v]) => `${describe(k, depth + 1, seen)} => ${describe(v, depth + 1, seen)}`).join(', ')}}`;
      if (value instanceof Set) return `Set(${value.size}) {${[...value].slice(0, 20).map((v) => describe(v, depth + 1, seen)).join(', ')}}`;
      if (value instanceof Date) return value.toISOString();
      const keys = Object.keys(value);
      const name = value.constructor && value.constructor !== Object ? `${value.constructor.name} ` : '';
      const props = keys.slice(0, 30).map((k) => `${k}: ${describe(value[k], depth + 1, seen)}`);
      if (keys.length > 30) props.push(`\u2026 ${keys.length - 30} lagi`);
      return `${name}{${props.join(', ')}}`;
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  function format(args) {
    let text = args.map((a) => describe(a)).join(' ');
    if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}\u2026`;
    return text;
  }

  // Penanda halaman baru di Console (log sesudahnya milik halaman ini).
  post({ source: 'sys', level: 'info', text: `Halaman dimuat: ${location.pathname}${location.search}` });

  // ---------- console.* ----------
  const LEVELS = { log: 'log', info: 'info', debug: 'debug', warn: 'warn', error: 'error', trace: 'log', table: 'log', dir: 'log' };
  for (const [method, level] of Object.entries(LEVELS)) {
    const original = console[method];
    if (typeof original !== 'function') continue;
    console[method] = function (...args) {
      try {
        post({ source: 'fe', level, text: format(args) });
      } catch {}
      return original.apply(this, args);
    };
  }
  const assert = console.assert;
  console.assert = function (condition, ...args) {
    if (!condition) post({ source: 'fe', level: 'error', text: `Assertion failed${args.length ? `: ${format(args)}` : ''}` });
    return assert.call(this, condition, ...args);
  };

  // ---------- Error yang tidak tertangkap & file yang gagal dimuat ----------
  addEventListener('error', (e) => {
    const el = e.target;
    if (el && el !== window && el.tagName) {
      // Error resource (tidak bubble, tertangkap di fase capture): <img>, <script>, <link> yang gagal dimuat.
      const url = el.currentSrc || el.src || el.href || '';
      post({ source: 'net', level: 'error', text: `Gagal memuat <${el.tagName.toLowerCase()}> ${url}` });
      return;
    }
    const where = e.filename ? ` (${e.filename.replace(location.origin, '')}:${e.lineno}:${e.colno})` : '';
    // Baris "at …" dari stack saja (baris pertamanya sama dengan pesan), alamat website disingkat.
    const frames = e.error && e.error.stack ? String(e.error.stack).split('\n').filter((l) => /^\s+at /.test(l)) : [];
    const detail = frames.length ? `\n${frames.join('\n').split(location.origin).join('')}` : '';
    const message = /^Uncaught\b/.test(e.message) ? e.message : `Uncaught ${e.message}`;
    post({ source: 'fe', level: 'error', text: `${message}${where}${detail}`.slice(0, MAX_TEXT) });
  }, true);
  addEventListener('unhandledrejection', (e) => {
    post({ source: 'fe', level: 'error', text: `Uncaught (in promise) ${describe(e.reason)}`.slice(0, MAX_TEXT) });
  });

  // ---------- Request jaringan ----------
  const short = (url) => {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin ? u.pathname + u.search : u.href;
    } catch {
      return String(url);
    }
  };
  function request(method, url, status, ms, failure) {
    const text = failure
      ? `${method} ${short(url)} gagal: ${failure}`
      : `${method} ${short(url)} \u2192 ${status} (${ms} ms)`;
    post({ source: 'net', level: failure || status >= 400 ? 'error' : 'info', text, url: short(url), status: status || 0 });
  }

  if (typeof window.fetch === 'function') {
    const fetchOriginal = window.fetch;
    window.fetch = function (input, init) {
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;
      const started = performance.now();
      return fetchOriginal.apply(this, arguments).then(
        (res) => {
          request(method, url, res.status, Math.round(performance.now() - started));
          return res;
        },
        (err) => {
          request(method, url, 0, 0, err && err.name === 'AbortError' ? 'dibatalkan' : (err && err.message) || 'jaringan error');
          throw err;
        },
      );
    };
  }

  if (typeof XMLHttpRequest === 'function') {
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__rakit = { method: String(method || 'GET').toUpperCase(), url: String(url) };
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      const info = this.__rakit;
      if (info) {
        const started = performance.now();
        this.addEventListener('loadend', () => {
          if (this.status) request(info.method, info.url, this.status, Math.round(performance.now() - started));
          else request(info.method, info.url, 0, 0, 'jaringan error');
        });
      }
      return send.apply(this, arguments);
    };
  }
})();
