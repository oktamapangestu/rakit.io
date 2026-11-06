---
name: rakit
description: Complete technical reference for building and changing websites on rakit.io — static hosting and page routing, Alpine.js conventions the editor depends on, the built-in database HTTP API (/api/db, uploads, relations, access rules), serverless functions (/api/fn with db, env, fetch, ai; limits, secrets, cron), the AI chat widget, security rules and limits. Use it for EVERY change to a rakit.io website project, before writing any code.
---

# rakit.io — technical reference for building websites

rakit.io is an online code editor where people build websites. Each project is one website at
`https://<project>.rakit.io` (in development/eval: `http://<project>.localhost:<port>` or `http://localhost/`).
This skill lists everything the platform supports and the conventions the editor relies on. Follow it exactly:
code that ignores these rules looks fine in a file but breaks on the site or in the editor.

## 1. Platform at a glance

| Topic | What rakit supports |
|---|---|
| Hosting | Static `.html`, `.css`, `.js` files + uploaded images. No build step, no npm, no bundler, no PHP, no Node.js server. |
| Libraries | Only from a CDN via `<script src>` / `<link href>` with a real, pinned version. |
| Interactivity | Alpine.js 3 (required for anything interactive — see §3). |
| Data | Built-in database per project, used from the browser with `fetch('/api/db/<table>')` — §4. |
| Server code | Serverless functions in `functions/<name>.js`, called with `fetch('/api/fn/<name>')` — §6. |
| AI for visitors | Built-in chat widget `<script src="/api/ai/widget.js" defer></script>` — §7. |
| Accounts | None. Visitors are anonymous; only the owner (in the editor) is authenticated. |
| Images | Uploaded by the owner in the editor. An agent cannot create, edit or delete images. |

## 2. Files, pages and routing

- File types: only `.html`, `.css`, `.js` can be written. Images (`.png .jpg .jpeg .gif .webp .svg .ico .avif`) are
  uploaded by the owner; never create image files (no placeholder PNG/SVG files, no generated images). If an image
  is needed but missing, reference the path the owner should upload to (e.g. `/images/galeri-1.jpg`) and tell
  the owner in your summary to upload it.
- Do not create other files: no `package.json`, `README.md`, `.md` notes, `server.py`, test files or config files.
  They are useless on rakit (nothing runs them) and clutter the project.
- Paths: relative to the site root, letters, digits, `.`, `-`, `_`, may contain folders, must not start with a dot.
  Paths are case-sensitive. Reference site files with absolute paths (`/style.css`, `/js/app.js`,
  `/images/logo.png`) so they work from every page and folder.
- Size limits: 512 KB per code file; 100 MB and 2,000 files/folders per project. Uploaded image: 5 MB per file.
- Routing:
  - `/` → `index.html`; `/folder/` → `folder/index.html`.
  - Clean URLs: `/tentang` → `tentang.html` (link to `/tentang` or `/tentang.html`; both work).
  - `/folder` (an existing folder without slash) redirects to `/folder/`.
  - Unknown paths → the project's `404.html` if it exists (status 404), otherwise a built-in 404 page.
  - `functions/` is never served (requests to it are 404) — source of server code stays secret.
  - `/api/*` on the website is reserved for the platform: `/api/db/…`, `/api/fn/…`, `/api/ai/…`. Do not create
    files or folders named `api`.
- Site files are served with `Cache-Control: no-cache` (always revalidated), so changes show up immediately.
- Publishing: in "live" mode every saved change is public immediately. In manual mode the owner edits the dev
  version at `<project>--dev.rakit.io` (separate dev database) and presses Publikasikan; agents never publish.

## 3. Frontend: plain HTML + Alpine.js

The owner edits text and images by clicking them in the preview ("Edit" mode), and selects page blocks ("Pilih
blok") to give the AI focused instructions. Both only work on content that is in the `.html` markup.

Rules:
- Write every page as plain HTML with all fixed text (headings, paragraphs, button labels, menu items, footer)
  directly in the markup. Never build markup or fixed text from JavaScript (`innerHTML`, `createElement`,
  template strings) — the owner could no longer edit it.
- For anything interactive (mobile menu, modal, tabs, accordion, form state and validation, lists loaded from the
  database, cart, filter, search, counters) use Alpine.js — not React, Vue, Svelte, jQuery, or hand-written DOM
  code. Load it once in the `<head>` of each page that needs it, with exactly this tag and version:

  ```html
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js"></script>
  ```

  Official plugins (`@alpinejs/collapse`, `@alpinejs/focus`, `@alpinejs/intersect`, `@alpinejs/mask`) use the same
  version (`https://cdn.jsdelivr.net/npm/@alpinejs/collapse@3.17.4/dist/cdn.min.js`) and go BEFORE the Alpine tag.
- Alpine 3 syntax only: `x-data`, `x-init`, `x-show`, `x-if` and `x-for` (both only on `<template>`, `x-for` with
  `:key`), `x-text`, `x-model`, `:attr` (x-bind), `@event` (x-on), `x-transition`, `x-ref`, `x-effect`, `$refs`,
  `$dispatch`, `$nextTick`, `$watch`, `Alpine.store()`. Never Alpine 2 (`x-spread`). Use `x-text` for data; avoid
  `x-html` (never for visitor-submitted content).
- Keep small state inline (`x-data="{ open: false }"`). Put longer logic (database calls, form submit) in a `.js`
  file as a named component, loaded BEFORE the Alpine tag:

  ```html
  <head>
    <link rel="stylesheet" href="/style.css">
    <script defer src="/app.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js"></script>
  </head>
  <body>
    <section x-data="bukuTamu" x-cloak> … </section>
  </body>
  ```

  ```js
  // app.js
  document.addEventListener('alpine:init', () => {
    Alpine.data('bukuTamu', () => ({
      rows: [], nama: '', pesan: '', error: '', sending: false,
      async init() { await this.load(); },
      async load() { … },
      async submit() { … },
    }));
  });
  ```
- Every `x-data="name"` needs a matching `Alpine.data('name', …)` in a file loaded before Alpine. Every id/class
  your JS looks up must exist in the HTML. If you rename an id, class, function, component, table or column,
  update every place that uses it.
- Add `[x-cloak] { display: none !important; }` to the CSS and put `x-cloak` on things hidden until Alpine starts
  (modals, dropdowns, components that render data).
- Use a real `<button type="button">` for actions (`@click`), not `<a href="#">`. Every link and button must do
  something real: an in-page anchor to a section that exists, a page that exists, an action, or a real external
  URL — no dead `href="#"`.
- Existing pages written in plain JavaScript keep working; do not rewrite them to Alpine unless asked or you are
  rebuilding that part anyway. Preserve the owner's existing code, structure, style and features.
- HTML must be well-formed: tags closed and nested, one `<head>` and `<body>`,
  `<meta name="viewport" content="width=device-width, initial-scale=1">`, each page loads the CSS/JS it uses.
- Browser JavaScript runs as written: no `require`, no bare npm imports (only full CDN URLs or relative paths, and
  only in `type="module"` scripts), no TypeScript/JSX, every `await` inside an `async` function, every `fetch`
  checks `res.ok` and shows the `{ error }` message to the visitor.
- Write visible text in the language the site already uses (new site: the language the owner writes in).
- No invented numbers, testimonials or claims; no filler sections the owner did not ask for.
- Never use `localStorage`/`sessionStorage` for data that visitors submit or that others should see — it only
  exists in one browser. (It is fine for pure UI preferences such as a dark-mode toggle.)

## 4. Database

Each project has a built-in database. Tables are created by the owner in the "Data" tab or by the AI with the
`create_table` tool (when that tool is available, use it — never assume a table exists).

### Tables and columns
- Every row has `id` (number) and `created_at` automatically; never declare them.
- Column types: `text` (≤ 10,000 chars), `number`, `boolean`, `date` (`"2026-12-31"` or `"2026-12-31T19:00"`),
  `reference` (id of a row in another table — set `refTable`), `image` (uploaded image address).
- Column types cannot be changed later; plan them. Names: lowercase letters, digits, `_`, start with a letter.
- `private: true` columns (email, phone, address) are never returned to visitors, even when `list` is public.
- Limits: 20 tables × 30 columns; database size 50 MB per project.

### Access rules (per table, per operation)
Each operation — `list`, `view`, `create`, `update`, `delete` — is either public (any visitor) or owner-only.
Default: owner-only. A visitor request for an owner-only operation gets **403**. Visitors are anonymous, so keep
`update` and `delete` owner-only unless the owner explicitly asks otherwise.

| Feature | Table | Public operations |
|---|---|---|
| Guestbook, comments, wishes (ucapan), testimonials shown on the page | `ucapan`, `komentar` | `list`, `create` |
| Contact form, registration / sign-up form (pendaftaran), RSVP, booking, survey whose answers only the owner reads | `pesan_kontak`, `pendaftar`, `rsvp` | `create` |
| RSVP / registration that also shows a public list or count | `rsvp` | `list`, `create` |
| Product catalog, menu, portfolio items, blog posts managed by the owner | `produk`, `menu` | `list`, `view` |
| Orders with prices/totals | `pesanan` | none — write through a serverless function (§6) |
| Votes, scores, polls | `vote`, `skor` | `list`, `create` |

**Every form that collects visitor input must save it to the database** (unless the owner explicitly asks for
something else, e.g. sending to WhatsApp): create the table with `create` public and POST to `/api/db/<table>`.
Validation alone is not a working form — after validating, the data must be stored and the visitor must see a
success or error message.

### HTTP API (same domain, no keys, no CORS)

| Request | Result |
|---|---|
| `GET /api/db/<table>?sort=-created_at&limit=20&offset=0` | `{ rows: [...], total, limit, offset }` — needs public `list` |
| `GET /api/db/<table>?<column>=<value>` | filter: exact match on that column (several filters = AND) |
| `GET /api/db/<table>?expand=<reference_column>` | each row also gets the referenced row |
| `GET /api/db/<table>/<id>` | one row — needs public `view` |
| `POST /api/db/<table>` (JSON body) | created row, status 201 — needs public `create` |
| `PATCH /api/db/<table>/<id>` (JSON body) | updated row — needs public `update` |
| `DELETE /api/db/<table>/<id>` | `{ ok: true }` — needs public `delete` |
| `POST /api/db/<table>/upload?column=<image_column>` (body = the file) | `{ url }`, status 201 — needs public `create` or `update` |

- `sort`: a column name, `-column` for descending (newest first: `-created_at`). `limit`: 1–100 (default 50),
  `offset` for paging. Filter values are matched exactly.
- Errors: `{ "error": "message" }` with 4xx — 403 (operation not public), 404 (table/row does not exist: check the
  exact table name), 400 (invalid column, value or filter). Show the message to the visitor.
- Field names in the JSON body and in `x-text` must be the table's exact column names.
- Visitor rate limits: 300 reads and 60 writes per minute per visitor; at most 20 uploads per 10 minutes.

### Examples

```js
// app.js — guestbook (table "ucapan": nama text, pesan text; public: list, create)
document.addEventListener('alpine:init', () => {
  Alpine.data('bukuTamu', () => ({
    rows: [], nama: '', pesan: '', error: '', sukses: false, sending: false,
    async init() { await this.load(); },
    async load() {
      const res = await fetch('/api/db/ucapan?sort=-created_at&limit=20');
      const data = await res.json();
      if (!res.ok) { this.error = data.error; return; }
      this.rows = data.rows;
    },
    async submit() {
      this.error = ''; this.sukses = false;
      if (!this.nama.trim() || !this.pesan.trim()) { this.error = 'Nama dan pesan wajib diisi.'; return; }
      this.sending = true;
      const res = await fetch('/api/db/ucapan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama: this.nama, pesan: this.pesan }),
      });
      const data = await res.json().catch(() => ({}));
      this.sending = false;
      if (!res.ok) { this.error = data.error || 'Gagal mengirim.'; return; }
      this.nama = ''; this.pesan = ''; this.sukses = true;
      await this.load();
    },
  }));
});
```

```html
<form x-data="bukuTamu" x-cloak @submit.prevent="submit">
  <label>Nama <input x-model="nama" required></label>
  <label>Pesan <textarea x-model="pesan" required></textarea></label>
  <button type="submit" :disabled="sending">Kirim</button>
  <p x-show="error" x-text="error" role="alert"></p>
  <p x-show="sukses">Terima kasih, pesanmu tersimpan.</p>
  <template x-for="row in rows" :key="row.id">
    <article><strong x-text="row.nama"></strong><p x-text="row.pesan"></p></article>
  </template>
</form>
```

Image upload (column `gambar` of type `image`): upload first, then save the returned address. Never store an
image as base64/data URL in a text column (it is rejected). Allowed: JPG, PNG, WEBP, GIF, AVIF. An image column
may also hold an `https://` URL or a project image path (`/images/logo.png`).

```js
const up = await fetch('/api/db/produk/upload?column=gambar', { method: 'POST', body: fileInput.files[0] });
const { url, error } = await up.json();          // e.g. "/uploads/produk/lx3k-9f2a.jpg"
if (!up.ok) throw new Error(error);
await fetch('/api/db/produk', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nama, gambar: url }) });
// show it: <img :src="row.gambar" :alt="row.nama">
```

Relations: a `pesanan` table with column `produk_id` of type `reference` (refTable `produk`) stores the product's
`id`; read joined data with `GET /api/db/pesanan?expand=produk_id`.

## 5. Forms

- Validate in the browser with Alpine (required fields, email/phone format, length) and show a clear message next
  to each invalid field — then still validate again on the server side when it matters (functions, §6).
- Submit with `fetch` to `/api/db/<table>` (or `/api/fn/<name>` when secrets, prices or notifications are
  involved), disable the button while sending, show success, reset the form, and show `{ error }` on failure.
- Use `type="email"`, `type="tel"`, `inputmode`, `autocomplete`, `<label>` for every input, `required` where needed.
- Personal data columns (email, phone, address) → `private: true`.

## 6. Serverless functions (server-side code)

Use a function for anything that must run on the server: secret API keys/tokens (Telegram, WhatsApp, payment,
email…), logic visitors must not see or tamper with (prices, totals, coupons, quotas), writing to owner-only
tables, or calling other services.

- File: `functions/<name>.js` (name: lowercase letters, digits, `-` or `_`, max 40 chars). Called from the site on
  the same domain: `fetch('/api/fn/<name>', …)`. The source is never served to visitors.
- It is an ES module running in a sandbox — not Node.js: no `require`, no npm packages, no filesystem.

```js
// functions/kontak.js — validate, save, notify Telegram
export default async function (req, { db, env, fetch, ai }) {
  if (req.method !== 'POST') return Response.json({ error: 'Pakai POST' }, { status: 405 });
  const { nama, email, pesan } = req.body || {};
  if (!nama || !pesan) return Response.json({ error: 'Nama dan pesan wajib diisi' }, { status: 400 });
  const row = await db.insert('pesan', { nama, email, pesan });   // db works as the owner
  const tg = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { chat_id: env.TELEGRAM_CHAT_ID, text: `Pesan baru dari ${nama}:\n${pesan}` },
  });
  if (!tg.ok) console.warn('Telegram gagal', tg.status, await tg.text());
  return { ok: true, id: row.id };
}
```

| API | Details |
|---|---|
| `req.method` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`… or `CRON` for scheduled runs |
| `req.path`, `req.query` | path called; URL parameters as strings (`/api/fn/cari?q=kue` → `req.query.q`) |
| `req.headers` | lowercase names; `req.headers['x-client-ip']` = visitor IP; cookies are not forwarded |
| `req.body` | parsed object when the request sent JSON, otherwise raw text; max 1 MB. Also `await req.text()`, `await req.json()` |
| `db.list(table, { sort, limit, offset, filter })` | `{ rows, total }`; `sort: '-created_at'`, `limit` ≤ 100, `filter: { status: 'baru' }` (exact match) |
| `db.get(table, id)` | one row (throws if missing) |
| `db.insert(table, data)` | new row with `id`, `created_at` |
| `db.update(table, id, data)` | updates only the given columns → updated row |
| `db.delete(table, id)` | `{ ok: true }` |
| `env.NAME` | project secret (max 30, UPPER_CASE names); `undefined` if not set |
| `await fetch(url, { method, headers, body })` | external call; an object `body` is sent as JSON; result: `ok`, `status`, `headers.get()`, `text()`, `json()`. Max 10 calls per run, 8 s and 2 MB per call; cannot reach rakit.io websites (use `db`) |
| `console.log/info/warn/error/time/count/table/assert` | shown in the editor's test panel, run log and Console (max 16 KB per run) |
| `return value` | 200 + JSON; `return` without value → 204 |
| `Response.json(data, { status, headers })` | JSON with a custom status (e.g. 400 for invalid input) |
| `new Response(text, { status, headers })` | text/HTML/CSV; allowed headers: `content-type`, `cache-control`, `content-disposition`, `location`, `etag`, `access-control-*`, `x-…` |
| `Response.redirect(url, 302)` | redirect |
| `throw new Error('…')` | status 500 `{ error }`; on the public site visitors see a generic message, details are in the log |

- `db` in a function works as the owner: public rules do not apply, so tables written only by functions can stay
  owner-only (e.g. orders). Never trust prices or totals from the browser — read them from the database.
- Secrets: read from `env.NAME`; NEVER write a key or token into any file. Agents cannot set secrets — tell the
  owner to open the "Fungsi" tab → "Rahasia (env)" and add `NAME`.
- Limits: 10 seconds and 64 MB per run (waiting for `ai.*` does not count), 120 requests/minute per website and
  60/minute per visitor; 20,000 executions per day per account.
- Scheduled runs (cron, e.g. a daily report): the owner sets them in "Fungsi" → "Jadwal" (WIB time, at most
  every 15 minutes); the function receives `req.method === 'CRON'`. Return early for other methods if it is cron-only.
- Calling a function from the page:

```js
const res = await fetch('/api/fn/kontak', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});
const hasil = await res.json().catch(() => ({}));
if (!res.ok) throw new Error(hasil.error || 'Gagal mengirim');
```

## 7. AI features

### Chatbot for visitors → the built-in widget (default)
When the owner asks for a chatbot, AI assistant, customer-service bot, "chat AI", or "asisten AI" on the website,
add exactly this line just before `</body>` on the pages that should show it — and nothing else:

```html
<script src="/api/ai/widget.js" defer></script>
```

It shows a chat bubble in the corner. Do NOT build your own chat UI, chat CSS/JS, server, or function for this, and
never put API keys in code. The assistant only answers once the owner turns it on: tell them to open the avatar
menu → "Asisten AI website", activate it, write its instructions (what it should know about the business) and make
sure the balance is filled. Agents cannot change those settings.

Only when the owner explicitly wants a custom chat UI: `POST /api/ai/chat` with
`{ "messages": [{ "role": "user", "content": "…" }] }` (earlier turns with role `assistant`) → `{ "reply": "…" }`
or `{ "error" }` with 4xx/5xx.

### AI inside serverless functions (owner's own provider and key)
For text generation, classification, data extraction, image checks or semantic search on the server, use the `ai`
library from the function's second argument — never call AI APIs with `fetch`, never ask for an API key in code.

```js
export default async function (req, { db, ai }) {
  const { text } = await ai.chat(req.body.pertanyaan, { system: 'Kamu CS toko kue. Jawab singkat.' });
  const data = await ai.json('Ambil nama & HP dari: ' + req.body.pesan, { nama: 'string', hp: 'string' });
  const cek = await ai.chat('Apakah ini bukti transfer? Berapa nominalnya?', { images: [row.bukti] });
  const [a, b] = await ai.embed(['kue coklat', 'brownies']);
  return { text, data, mirip: ai.similarity(a, b) };
}
```

- `ai.chat(prompt | { messages, system, images, provider, model, temperature, maxTokens })` →
  `{ text, model, provider, usage }`. `images`: https URLs, project paths (`/uploads/…`, `/images/…`) or data URLs
  (max 4, 5 MB). `ai.json(prompt, shape, options)` → parsed object. `ai.embed(text | texts)` → vector(s)
  (Anthropic has no embeddings). `ai.similarity(a, b)` → 0..1. `ai.providers()` → configured providers.
- Max 5 `ai.*` calls per run, 60 s each. The owner adds providers (OpenAI, Claude, Gemini, OpenAI-compatible such as
  DeepSeek/Groq/OpenRouter) with their own key in "Fungsi" → "Provider AI"; if none exists, tell them to add one.

## 8. Security

- No API keys, tokens or passwords in `.html`/`.js` files — anyone can read them. Use functions + `env`.
- Mark personal data columns private; keep `update`/`delete` owner-only; never expose owner-only data through a
  public function without a check (e.g. an `ADMIN_KEY` secret compared with a header).
- Never trust the browser for prices, totals, stock, coupons or quotas — compute them in a function.
- Escape/avoid `x-html` for visitor content; use `x-text`.

## 9. Verify your work

Before you finish, test what you built when tools allow it:
- Open each changed page and check for JavaScript errors, Alpine errors, failed requests and missing files
  (in this environment: `cek-halaman /index.html /other.html`).
- Call the database and functions you rely on: `curl -s http://localhost/api/db/<table>`,
  `curl -s -X POST http://localhost/api/fn/<name> -H 'Content-Type: application/json' -d '{…}'` — a 403 means the
  operation is not public, a 404 means the table/function does not exist.
- `node --check file.js` for syntax.

Final checklist for every file you wrote:
- Every referenced path (`<link href>`, `<script src>`, links, images, `/api/fn/<name>`) exists with the same case.
- Every `x-data` has its `Alpine.data`, loaded before Alpine; every id/class used by JS exists.
- Every table the code uses exists (created with `create_table`), column names match exactly, and the public
  operations allow what the page does (public form → `create`, public list → `list`).
- Every form that collects visitor input stores it (database or function) and shows success/error.
- Chatbot requests use the widget line only.
- No new non-site files, no image files created, no secrets in code.

## 10. When you are done

Reply with a short, friendly summary in the owner's language (usually Indonesian): what changed, assumptions, and
any step the owner must take themselves — upload an image, add a secret in "Fungsi" → "Rahasia (env)", add an AI
provider, turn on the website assistant, set a schedule, or make a table operation public in "Data" → "Atur".

## 11. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Form submit → 403 | `create` not public on that table → create/update the table with `create` public |
| List empty / 404 | table name in code differs from the database (case and `_` matter) or the table was never created |
| A column (email) never shows | it is private — by design |
| Image not shown | wrong path or case; uploads live under `/uploads/…`, project images under `/images/…` |
| Function 500 | check required secrets exist (`env.NAME`), input validation, and the 10 s limit |
| Button does nothing | Alpine not loaded, component script loaded after Alpine, or `x-data` name mismatch |
