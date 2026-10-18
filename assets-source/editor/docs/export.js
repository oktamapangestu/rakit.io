// Ekspor tab Dokumentasi: Markdown (salin / unduh README.md) dan cetak / simpan PDF. Disusun di browser dari data
// GET /api/docs, tanpa AI.
import { renderMarkdown } from '../markdown.js';
import { DB_TYPES } from '../database/types.js';
import { describeCron } from '../functions/cron.js';
import { OP_LABEL, tableEndpoints, isPublic, tableExample, fnExample } from './snippets.js';
import { issueText, columnNotes, pageUses, formText } from './text.js';

// Teks kecil yang dipakai di dalam ${…} (dipisah supaya ikut diterjemahkan, lihat scripts/i18n.mjs).
const MISSING = ' (tidak ada)';
const INACTIVE = ' (tidak aktif)';
const ANY_METHOD = 'semua';

const code = (s) => `\`${s}\``;
const cell = (s) => String(s ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const row = (cells) => `| ${cells.map(cell).join(' | ')} |`;
const table = (head, rows) => (rows.length ? [row(head), row(head.map(() => '---')), ...rows.map(row)] : []);
const list = (items) => items.map((i) => `- ${i}`);
const fence = (text, lang = 'js') => ['```' + lang, text, '```'];
// Judul di Catatan Project diturunkan satu tingkat (## -> ###) supaya tetap di bawah bagiannya.
const demote = (md) => md.split('\n').map((l) => (/^#{1,5}\s/.test(l) ? `#${l}` : l)).join('\n');

export function docsMarkdown(data) {
  const p = data.project;
  const locale = document.documentElement.lang === 'en' ? 'en-US' : 'id-ID';
  const date = new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const out = [`# ${p.name}`, '', `Dokumentasi website ${p.siteUrl} — dibuat otomatis oleh rakit.io pada ${date}.`, ''];

  if (data.notes) out.push('## Catatan Project', '', demote(data.notes), '');

  out.push('## Ringkasan', '',
    ...list([`${data.pages.length} halaman`, `${data.tables.length} tabel database`, `${data.functions.length} fungsi serverless`, `${data.secrets.length} rahasia`]), '');
  if (data.issues.length) out.push('### Perlu dicek', '', ...list(data.issues.map(issueText)), '');

  if (data.pages.length) {
    out.push('## Peta Halaman', '');
    for (const page of data.pages) {
      const uses = pageUses(data, page);
      out.push(`### ${page.path}${page.title ? ` — ${page.title}` : ''}`, '');
      if (page.description) out.push(page.description, '');
      out.push(...list([
        page.links.length && `Menautkan ke: ${page.links.map((l) => code(l.to) + (l.broken ? MISSING : '')).join(', ')}`,
        page.linkedFrom.length ? `Ditautkan dari: ${page.linkedFrom.map(code).join(', ')}` : page.orphan && 'Tidak ditautkan dari halaman lain',
        page.assets.length && `CSS & JS: ${page.assets.map((a) => code(a.to) + (a.missing ? MISSING : '')).join(', ')}`,
        page.forms.length && `Form: ${page.forms.map((f) => (f.action ? code(formText(f)) : formText(f))).join(', ')}`,
        uses.tables.length && `Tabel: ${uses.tables.map((t) => `${code(t.name)} (${t.ops.map((o) => OP_LABEL[o] ?? o).join(', ')})`).join(', ')}`,
        uses.functions.length && `Fungsi: ${uses.functions.map(code).join(', ')}`,
      ].filter(Boolean)), '');
    }
  }

  if (data.tables.length) {
    out.push('## API Database', '', 'Dipanggil dari JavaScript halaman website dengan `fetch()` di domain yang sama. Publik = boleh dipakai semua pengunjung; Pemilik = hanya pemilik di editor.', '');
    for (const t of data.tables) {
      out.push(`### ${t.name}`, '',
        ...table(['Method', 'Endpoint', 'Akses', 'Keterangan'], tableEndpoints(t).map((e) => [e.method, code(e.path), isPublic(t, e.op) ? 'Publik' : 'Pemilik', e.desc])), '',
        ...fence(tableExample(t)), '');
    }
  }

  if (data.functions.length) {
    out.push('## API Fungsi', '');
    for (const f of data.functions) {
      out.push(`### ${f.name}`, '');
      if (f.summary) out.push(f.summary, '');
      out.push(...list([
        `URL: ${code(f.url)}`,
        `Method: ${f.methods.length ? f.methods.join(', ') : ANY_METHOD}`,
        f.query.length && `Query: ${f.query.map(code).join(', ')}`,
        f.body.length && `Body (JSON): ${f.body.map(code).join(', ')}`,
        f.secrets.length && `Rahasia: ${f.secrets.map(code).join(', ')}`,
        f.tables.length && `Tabel: ${f.tables.map((t) => `${code(t.table)} (${t.ops.map((o) => OP_LABEL[o] ?? o).join(', ')})`).join(', ')}`,
        f.ai.length && `AI: ${f.ai.map((a) => code(`ai.${a}`)).join(', ')}`,
        f.fetches.length && `Layanan luar: ${f.fetches.join(', ')}`,
        f.schedule && `Jadwal: ${describeCron(f.schedule.cron)} WIB${f.schedule.active ? '' : INACTIVE}`,
        f.usedBy.length && `Dipanggil dari: ${f.usedBy.map(code).join(', ')}`,
      ].filter(Boolean)), '', ...fence(fnExample(f, data.tables)), '');
    }
  }

  if (data.tables.length) {
    out.push('## Struktur Database', '');
    for (const t of data.tables) {
      out.push(`### ${t.name}`, '', ...table(['Kolom', 'Tipe', 'Keterangan'], [
        [code('id'), 'Angka', 'otomatis'],
        ...t.columns.map((c) => [code(c.name), DB_TYPES[c.type] ?? c.type, columnNotes(c)]),
        [code('created_at'), 'Tanggal', 'otomatis'],
      ]), '');
    }
    if (data.relations.length) out.push('### Relasi', '', ...list(data.relations.map((r) => `${code(`${r.from}.${r.column}`)} → ${code(r.to)}`)), '');
  }

  out.push('## Konfigurasi', '', ...list([
    `Website: ${p.siteUrl}`,
    p.mode === 'manual' ? `Versi dev: ${p.previewUrl} (publikasi manual)` : 'Publikasi: langsung, setiap perubahan langsung tayang',
    data.secrets.length && `Rahasia (env): ${data.secrets.map((s) => code(s.name)).join(', ')} — nilainya tidak ikut diekspor`,
    data.aiProviders.length && `Provider AI: ${data.aiProviders.map((a) => `${a.name} (${a.kind}${a.model ? `, ${a.model}` : ''})`).join(', ')}`,
    ...data.functions.filter((f) => f.schedule).map((f) => `Jadwal ${code(f.name)}: ${describeCron(f.schedule.cron)} WIB`),
  ].filter(Boolean)), '');

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// Nama file unduhan: README-<slug>.md.
export function downloadMarkdown(data) {
  const blob = new Blob([docsMarkdown(data)], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `README-${data.project.slug}.md`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const PRINT_CSS = `
  body { margin: 0; padding: 32px 40px; color: #1a1320; font: 13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .md-h { margin: 18px 0 6px; font-weight: 700; break-after: avoid; }
  .md-h[data-level="1"] { margin-top: 0; font-size: 24px; }
  .md-h[data-level="2"] { margin-top: 28px; padding-bottom: 4px; border-bottom: 1px solid #ddd; font-size: 18px; }
  .md-h[data-level="3"] { font-size: 15px; }
  p { margin: 0 0 8px; } ul { margin: 0 0 10px; padding-left: 20px; } li { margin-bottom: 2px; }
  code { padding: 1px 4px; border-radius: 4px; background: #f3f0ea; font: 11.5px "SF Mono", Menlo, Consolas, monospace; }
  pre { margin: 6px 0 12px; padding: 10px 12px; border: 1px solid #e5e0d6; border-radius: 6px; background: #faf8f4; white-space: pre-wrap; break-inside: avoid; }
  pre code { padding: 0; background: none; }
  table { width: 100%; margin: 4px 0 12px; border-collapse: collapse; font-size: inherit; break-inside: avoid; }
  th, td { padding: 4px 8px; border: 1px solid #e5e0d6; text-align: left; vertical-align: top; }
  th { background: #f6f3ee; }
  @page { margin: 16mm; }`;

// Cetak lewat iframe tersembunyi: dari dialog cetak browser bisa juga "Simpan sebagai PDF".
export function printDocs(data) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  doc.close();
  doc.title = `${data.project.name} — Dokumentasi`;
  const style = doc.createElement('style');
  style.textContent = PRINT_CSS;
  doc.head.append(style);
  doc.body.append(doc.importNode(renderMarkdown(docsMarkdown(data)), true));
  const done = () => setTimeout(() => frame.remove(), 500);
  frame.contentWindow.addEventListener('afterprint', done, { once: true });
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(done, 60_000); // jaga-jaga bila afterprint tidak terpanggil
}
