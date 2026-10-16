// Pintu jaringan di dalam container agen. Dua mode:
//
// - Mode agen di server rakit (RAKIT_UPSTREAMS): container tanpa jaringan (--network none); tiga layanan host
//   dibuka di 127.0.0.1 dan diteruskan apa adanya (TCP) ke unix socket — atau ke host:port di mode pengembangan:
//     127.0.0.1:80   → site  (website project dari salinan kerja agen, /api/db, /api/fn)
//     127.0.0.1:8001 → ai    (proxy AI: kunci provider tidak pernah masuk container)
//     127.0.0.1:8002 → tools (create_table)
//   RAKIT_UPSTREAMS="site=unix:/run/rakit/sock/site.sock,ai=unix:…,tools=unix:…" atau "site=tcp:host.docker.internal:41234,…".
//
// - Evaluasi (scripts/ai-eval/sandbox-engines.mjs, RAKIT_PORT & RAKIT_SLUG): server evaluasi di host lewat
//   host.docker.internal — 127.0.0.1:<port> diteruskan apa adanya (http://<slug>.localhost:<port>/), dan
//   127.0.0.1:80 ke website project yang sama dengan header Host diganti (http://localhost/).
const http = require('node:http');
const net = require('node:net');

function pipe(port, connect) {
  net.createServer((client) => {
    const upstream = connect();
    client.pipe(upstream).pipe(client);
    const close = () => { client.destroy(); upstream.destroy(); };
    client.on('error', close);
    upstream.on('error', close);
  }).listen(port, '127.0.0.1');
}

const PORTS = { site: 80, ai: 8001, tools: 8002 };

if (process.env.RAKIT_UPSTREAMS) {
  for (const entry of process.env.RAKIT_UPSTREAMS.split(',')) {
    const [name, target] = entry.split('=');
    const [kind, ...rest] = target.split(':');
    const address = rest.join(':');
    if (!PORTS[name]) continue;
    if (kind === 'unix') pipe(PORTS[name], () => net.connect(address));
    else {
      const i = address.lastIndexOf(':');
      pipe(PORTS[name], () => net.connect(Number(address.slice(i + 1)), address.slice(0, i)));
    }
  }
} else {
  const port = Number(process.env.RAKIT_PORT);
  const site = `${process.env.RAKIT_SLUG}.localhost:${port}`;
  pipe(port, () => net.connect(port, 'host.docker.internal'));
  http.createServer((req, res) => {
    const headers = { ...req.headers, host: site };
    if (headers.origin) headers.origin = `http://${site}`;
    const upstream = http.request({ host: 'host.docker.internal', port, method: req.method, path: req.url, headers }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (err) => { res.writeHead(502); res.end(err.message); });
    req.pipe(upstream);
  }).listen(80, '127.0.0.1');
}
