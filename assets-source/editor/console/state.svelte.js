// Tab Console: semua log di satu tempat, berlabel sumbernya — FE (console & error halaman di preview, diteruskan
// skrip yang disisipkan server — go/internal/sites/console.js), BE (eksekusi fungsi serverless dari log server),
// Jaringan (fetch/XHR dan file yang gagal dimuat), dan Sistem (halaman dimuat, catatan lain).
// Log diterima terus walau tab tidak dibuka (error baru menambah lencana di tombol tab).

export const CONSOLE_MAX = 1000;
export const CONSOLE_SOURCES = [['all', 'Semua'], ['fe', 'FE'], ['be', 'BE'], ['net', 'Jaringan'], ['sys', 'Sistem']];
export const CONSOLE_LABEL = { fe: 'FE', be: 'BE', net: 'NET', sys: 'SYS' };
export const CONSOLE_TITLE = { fe: 'Frontend: halaman di preview', be: 'Backend: fungsi serverless', net: 'Jaringan: request & file', sys: 'Sistem' };

// jump: naik setiap daftar perlu digulir ke bawah (dibuka, saringan berubah, riwayat BE disisipkan).
export const con = $state({ entries: [], source: 'all', errorsOnly: false, query: '', unread: 0, jump: 0 });

let host; // context 'editor': api, consoleActive(), renderConsoleBadge(unread)
let beLastId = 0;
let beLoaded = false;
let poll = null;
let beTimer = null;
export const connect = (editor) => { host = editor; };

export function matches(e) {
  if (con.source !== 'all' && e.source !== con.source) return false;
  if (con.errorsOnly && e.level !== 'error') return false;
  const q = con.query.trim().toLowerCase();
  return !q || `${e.text}\n${e.page ?? ''}\n${e.logs ?? ''}`.toLowerCase().includes(q);
}

export const count = (src) => con.entries.filter((e) => src === 'all' || e.source === src).length;

function badge() {
  host?.renderConsoleBadge(con.unread);
}

export function add(raw) {
  const source = CONSOLE_LABEL[raw.source] ? raw.source : 'sys';
  const level = ['error', 'warn', 'info', 'debug', 'log'].includes(raw.level) ? raw.level : 'log';
  const entry = { ...raw, source, level, text: String(raw.text ?? ''), time: Number(raw.time) || Date.now(), count: 1 };
  // Pesan sama berturut-turut digabung dengan penghitung, seperti console browser.
  const last = con.entries.at(-1);
  if (last && source !== 'be' && last.source === source && last.level === level && last.text === entry.text && last.page === entry.page) {
    last.count += 1;
    last.time = entry.time;
  } else {
    con.entries.push(entry);
    if (con.entries.length > CONSOLE_MAX) con.entries.splice(0, con.entries.length - CONSOLE_MAX);
  }
  if (!host?.consoleActive() && level === 'error') {
    con.unread += 1;
    badge();
  }
  // Website memanggil fungsi serverless: ambil log eksekusinya (BE) sebentar lagi.
  if (source === 'net' && /^\/api\/fn\//.test(raw.url ?? '')) {
    clearTimeout(beTimer);
    beTimer = setTimeout(loadBE, 600);
  }
}

// Eksekusi fungsi serverless (BE) sejak yang terakhir diambil; pembukaan pertama mengambil 30 terakhir.
async function loadBE() {
  let logs;
  try {
    logs = (await host.api('GET', `/api/functions/logs?limit=${beLoaded ? 50 : 30}`)).logs;
  } catch {
    return; // mis. project tanpa fungsi atau sesi habis: Console tetap jalan untuk FE
  }
  const first = !beLoaded;
  beLoaded = true;
  const TRIGGER = { http: 'pengunjung', cron: 'jadwal', test: 'uji coba' };
  const fresh = logs.filter((l) => l.id > beLastId).reverse();
  if (!fresh.length) return;
  beLastId = Math.max(beLastId, ...fresh.map((l) => l.id));
  for (const l of fresh) {
    const level = l.error || l.status >= 500 ? 'error' : l.status >= 400 ? 'warn' : 'info';
    const trigger = TRIGGER[l.trigger] ?? l.trigger;
    const entry = {
      source: 'be', level, time: l.createdAt, fn: l.name, status: l.status, trigger, error: l.error, logs: l.logs,
      text: `functions/${l.name}.js → ${l.status} (${l.ms} ms) · ${trigger}${l.dev ? ' · dev' : ''}`,
    };
    if (first) con.entries.push({ ...entry, count: 1 });
    else add(entry);
  }
  if (first) {
    // Riwayat eksekusi lama diselipkan sesuai waktunya di antara log yang sudah ada.
    con.entries.sort((a, b) => a.time - b.time);
    con.jump += 1;
  }
}

// Tab Console dibuka.
export function open() {
  con.unread = 0;
  badge();
  con.jump += 1;
  loadBE();
  // Selama tab Console terbuka, eksekusi baru (mis. dari jadwal) diambil berkala.
  clearInterval(poll);
  poll = setInterval(() => {
    if (!host.consoleActive()) return clearInterval(poll);
    if (document.visibilityState === 'visible') loadBE();
  }, 5000);
}

export function clear() {
  con.entries = [];
  con.unread = 0;
  badge();
}
