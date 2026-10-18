<!--
  Tab Dokumentasi: dokumentasi project yang disusun otomatis dari file, database, dan fungsi (GET /api/docs, lihat
  go/internal/api/docs.go) — Catatan Project untuk AI (Notes.svelte), ringkasan & hal yang perlu dicek, peta halaman,
  API database per tabel, API fungsi serverless, struktur database, dan konfigurasi; bisa diekspor ke Markdown atau
  dicetak/PDF (export.js). Tanpa AI dan tanpa kredit. Dipasang di #docsView oleh docsLoad() di editor.js,
  yang memanggil load() setiap tab dibuka.
-->
<script>
  import { getContext } from 'svelte';
  import CodeBlock from './CodeBlock.svelte';
  import Notes from './Notes.svelte';
  import { DB_TYPES } from '../database/types.js';
  import { describeCron } from '../functions/cron.js';
  import { OP_LABEL, tableEndpoints, isPublic, tableExample, fnExample } from './snippets.js';
  import { issueText, issuePath, columnNotes, pageUses, formText } from './text.js';
  import { docsMarkdown, downloadMarkdown, printDocs } from './export.js';
  import { showMenu } from '../shell/state.svelte.js';

  const { api, copyText, openCode, openTable } = getContext('editor');

  const SECTIONS = [
    ['catatan', 'Catatan Project'],
    ['ringkasan', 'Ringkasan'],
    ['halaman', 'Peta Halaman'],
    ['api-db', 'API Database'],
    ['api-fn', 'API Fungsi'],
    ['struktur', 'Struktur Database'],
    ['konfigurasi', 'Konfigurasi'],
  ];
  const AI_LABEL = { chat: 'ai.chat', json: 'ai.json', embed: 'ai.embed' };

  let data = $state.raw(null);
  let error = $state('');
  let loading = $state(false);
  let scroller;
  let seq = 0;

  export async function load() {
    const mySeq = ++seq;
    loading = true;
    try {
      const out = await api('GET', '/api/docs');
      if (mySeq !== seq) return;
      data = out;
      error = '';
    } catch (err) {
      if (mySeq === seq) error = err.message;
    } finally {
      if (mySeq === seq) loading = false;
    }
  }

  const missingSecrets = $derived(new Set((data?.issues ?? []).filter((i) => i.kind === 'missing_secret').map((i) => i.name)));
  const scheduled = $derived((data?.functions ?? []).filter((f) => f.schedule));

  // Menu Ekspor (menu konteks editor) di bawah tombolnya.
  function exportMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    showMenu(r.right, r.bottom + 6, [
      { label: 'Salin sebagai Markdown', run: () => copyText(docsMarkdown(data), 'Dokumentasi disalin sebagai Markdown') },
      { label: 'Unduh README.md', run: () => downloadMarkdown(data) },
      { label: 'Cetak / simpan PDF', run: () => printDocs(data) },
    ], { align: 'right' });
  }

  function jump(id) {
    scroller?.querySelector(`#docs-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<div class="docs-layout">
  <nav class="docs-toc" aria-label="Isi dokumentasi">
    {#each SECTIONS as [id, label] (id)}
      <button type="button" onclick={() => jump(id)}>{label}</button>
    {/each}
  </nav>

  <div class="docs-scroll" bind:this={scroller}>
    <div class="docs-wrap">
      <div class="fn-head">
        <div>
          <h3>{`Dokumentasi ${data?.project.name ?? 'project'}`}</h3>
          <p>Disusun otomatis dari file, database, dan fungsi project-mu — selalu sesuai keadaan terbaru, tanpa AI dan tanpa kredit.</p>
        </div>
        <div class="fn-head-actions">
          <button type="button" class="fn-btn" disabled={loading} onclick={load}>{loading ? 'Memuat…' : 'Perbarui'}</button>
          <button type="button" class="fn-btn primary" disabled={!data} onclick={(e) => { e.stopPropagation(); exportMenu(e.currentTarget); }}>Ekspor ▾</button>
        </div>
      </div>

      {#if error}
        <p class="fn-error">{error}</p>
      {:else if !data}
        <p class="fn-placeholder">Memuat dokumentasi…</p>
      {:else}
        <Notes notes={data.notes} max={data.notesMax} onSaved={(notes) => { data = { ...data, notes }; }} />

        <!-- ---------- Ringkasan ---------- -->
        <section class="docs-section" id="docs-ringkasan">
          <h4>Ringkasan</h4>
          <div class="docs-stats">
            <div><strong>{data.pages.length}</strong><span>halaman</span></div>
            <div><strong>{data.tables.length}</strong><span data-i18n="jumlah">tabel</span></div>
            <div><strong>{data.functions.length}</strong><span>fungsi</span></div>
            <div><strong>{data.secrets.length}</strong><span>rahasia</span></div>
          </div>
          {#if data.issues.length}
            <div class="docs-issues">
              <p class="fn-label">{`Perlu dicek (${data.issues.length})`}</p>
              <ul>
                {#each data.issues as i, n (n)}
                  {@const path = issuePath(i)}
                  <li>
                    <span>{issueText(i)}</span>
                    {#if path}<button type="button" class="fn-btn" onclick={() => openCode(path)}>Buka</button>{/if}
                  </li>
                {/each}
              </ul>
            </div>
          {:else}
            <p class="docs-ok">✓ Tidak ada masalah yang terdeteksi: semua tabel, fungsi, dan rahasia yang dipakai kode sudah ada.</p>
          {/if}
        </section>

        <!-- ---------- Peta Halaman ---------- -->
        <section class="docs-section" id="docs-halaman">
          <h4>Peta Halaman <span class="fn-count">{data.pages.length}</span></h4>
          {#each data.pages as page (page.path)}
            {@const uses = pageUses(data, page)}
            <article class="docs-card">
              <header>
                <code class="docs-name">{page.path}</code>
                {#if page.title}<span class="docs-page-title">{page.title}</span>{/if}
                <span class="docs-spacer"></span>
                <a class="fn-btn docs-btn-link" href={`${data.project.previewUrl ?? data.project.siteUrl}/${page.path === 'index.html' ? '' : page.path}`} target="_blank" rel="noopener">Lihat</a>
                <button type="button" class="fn-btn" onclick={() => openCode(page.path)}>Buka kode</button>
              </header>
              {#if page.description}<p class="docs-summary">{page.description}</p>{:else}<p class="docs-summary muted">Belum ada deskripsi (<code>&lt;meta name="description"&gt;</code>) — teks ini yang tampil di hasil pencarian Google.</p>{/if}
              <dl class="docs-facts">
                <dt>Menautkan ke</dt>
                <dd>{#each page.links as l (l.to)}<button type="button" class="docs-link" class:missing={l.broken} title={l.broken ? 'Halaman tidak ada' : ''} disabled={l.broken} onclick={() => openCode(l.to)}>{l.to}</button>{:else}<span class="docs-desc">—</span>{/each}</dd>
                <dt>Ditautkan dari</dt>
                <dd>{#each page.linkedFrom as from (from)}<button type="button" class="docs-link" onclick={() => openCode(from)}>{from}</button>{:else}<span class="docs-desc" class:warn={page.orphan}>{page.orphan ? 'tidak ada — pengunjung sulit menemukan halaman ini' : '—'}</span>{/each}</dd>
                {#if page.assets.length}<dt>CSS & JS</dt><dd>{#each page.assets as a (a.to)}<button type="button" class="docs-link" class:missing={a.missing} title={a.missing ? 'File tidak ada' : ''} disabled={a.missing} onclick={() => openCode(a.to)}>{a.to}</button>{/each}</dd>{/if}
                {#if page.forms.length}<dt>Form</dt><dd>{#each page.forms as f, n (n)}<code class="docs-param">{formText(f)}</code>{/each}</dd>{/if}
                {#if uses.tables.length}<dt>Tabel</dt><dd>{#each uses.tables as t (t.name)}<span class="docs-param-wrap"><button type="button" class="docs-link" onclick={() => openTable(t.name)}>{t.name}</button><span class="docs-desc">{t.ops.map((o) => OP_LABEL[o] ?? o).join(', ')}</span></span>{/each}</dd>{/if}
                {#if uses.functions.length}<dt>Fungsi</dt><dd>{#each uses.functions as name (name)}<button type="button" class="docs-link" onclick={() => openCode(`functions/${name}.js`)}>{name}</button>{/each}</dd>{/if}
              </dl>
            </article>
          {:else}
            <p class="fn-placeholder">Belum ada halaman HTML.</p>
          {/each}
          {#if data.pages.length > 1}<p class="fn-note">Gambar alur antarhalaman ada di tab Diagram → Peta halaman.</p>{/if}
        </section>

        <!-- ---------- API Database ---------- -->
        <section class="docs-section" id="docs-api-db">
          <h4>API Database <span class="fn-count">{data.tables.length}</span></h4>
          <p class="fn-note">Dipanggil dari JavaScript halaman websitemu dengan <code>fetch()</code> di domain yang sama, tanpa kunci. <b>Publik</b> = boleh dipakai semua pengunjung; <b>Pemilik</b> = hanya kamu di editor (pengunjung ditolak 403). Setiap baris otomatis punya <code>id</code> dan <code>created_at</code>.</p>
          {#each data.tables as t (t.name)}
            <article class="docs-card">
              <header>
                <code class="docs-name">{t.name}</code>
                <span class="fn-chip">{`${t.rowCount.toLocaleString('id-ID')} baris`}</span>
                <span class="docs-spacer"></span>
                <button type="button" class="fn-btn" onclick={() => openTable(t.name)}>Buka tabel</button>
              </header>
              <table class="docs-table">
                <tbody>
                  {#each tableEndpoints(t) as e (e.method + e.path)}
                    {@const pub = isPublic(t, e.op)}
                    <tr>
                      <td><span class="docs-method {e.method.toLowerCase()}">{e.method}</span></td>
                      <td><code>{e.path}</code><div class="docs-desc">{e.desc}</div></td>
                      <td class="docs-access"><span class="docs-badge" class:public={pub}>{pub ? 'Publik' : 'Pemilik'}</span></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
              {#if t.columns.some((c) => c.private)}
                <p class="fn-note">{`Kolom privat (${t.columns.filter((c) => c.private).map((c) => c.name).join(', ')}) tidak pernah dikirim ke pengunjung.`}</p>
              {/if}
              {#if t.usedBy.length}
                <p class="docs-used">Dipakai di:
                  {#each t.usedBy as u (u.file + u.op)}
                    <button type="button" class="docs-link" class:warn={u.status !== 'ok'} title={u.status === 'ok' ? '' : 'Akses ini hanya untuk pemilik'} onclick={() => openCode(u.file)}>{`${u.file} · ${OP_LABEL[u.op] ?? u.op}`}</button>
                  {/each}
                </p>
              {/if}
              <CodeBlock code={tableExample(t)} label="Contoh kode" />
            </article>
          {:else}
            <p class="fn-placeholder">Belum ada tabel. Buat di tab Data, atau minta AI membuatkan form beserta tabelnya.</p>
          {/each}
        </section>

        <!-- ---------- API Fungsi ---------- -->
        <section class="docs-section" id="docs-api-fn">
          <h4>API Fungsi <span class="fn-count">{data.functions.length}</span></h4>
          <p class="fn-note">Kode backend di <code>functions/&lt;nama&gt;.js</code>, dipanggil lewat <code>/api/fn/&lt;nama&gt;</code>. Keterangan di bawah dibaca dari kodenya; tulis komentar di baris pertama file untuk deskripsi fungsi.</p>
          {#each data.functions as f (f.name)}
            <article class="docs-card">
              <header>
                <code class="docs-name">{f.name}</code>
                {#each f.methods.length ? f.methods : ['Semua method'] as m (m)}<span class="docs-method {m.toLowerCase()}">{m}</span>{/each}
                <span class="docs-spacer"></span>
                <button type="button" class="fn-btn" onclick={() => copyText(f.url, 'URL fungsi disalin')}>Salin URL</button>
                <button type="button" class="fn-btn" onclick={() => openCode(f.path)}>Buka kode</button>
              </header>
              {#if f.summary}<p class="docs-summary">{f.summary}</p>{:else}<p class="docs-summary muted">Belum ada deskripsi. Tambahkan komentar di baris pertama file, mis. <code>// Kirim notifikasi pesanan ke Telegram</code>.</p>{/if}
              <dl class="docs-facts">
                <dt>URL</dt><dd><code>{f.url}</code></dd>
                {#if f.query.length}<dt>Query</dt><dd>{#each f.query as q (q)}<code class="docs-param">{q}</code>{/each}</dd>{/if}
                {#if f.body.length}<dt>Body (JSON)</dt><dd>{#each f.body as b (b)}<code class="docs-param">{b}</code>{/each}</dd>{/if}
                {#if f.secrets.length}<dt>Rahasia</dt><dd>{#each f.secrets as s (s)}<code class="docs-param" class:missing={missingSecrets.has(s)} title={missingSecrets.has(s) ? 'Belum diisi' : ''}>{s}</code>{/each}</dd>{/if}
                {#if f.tables.length}<dt>Tabel</dt><dd>{#each f.tables as t (t.table)}<span class="docs-param-wrap"><code class="docs-param">{t.table}</code><span class="docs-desc">{t.ops.map((o) => OP_LABEL[o] ?? o).join(', ')}</span></span>{/each}</dd>{/if}
                {#if f.ai.length}<dt>AI</dt><dd>{#each f.ai as a (a)}<code class="docs-param">{AI_LABEL[a] ?? a}</code>{/each}</dd>{/if}
                {#if f.fetches.length}<dt>Layanan luar</dt><dd>{#each f.fetches as h (h)}<code class="docs-param">{h}</code>{/each}</dd>{/if}
                {#if f.schedule}<dt>Jadwal</dt><dd>{`${describeCron(f.schedule.cron)} WIB`}{#if !f.schedule.active}<span class="docs-desc">{` · tidak aktif${f.schedule.note ? `: ${f.schedule.note}` : ''}`}</span>{/if}</dd>{/if}
                <dt>Dipanggil dari</dt>
                <dd>{#each f.usedBy as u (u)}<button type="button" class="docs-link" onclick={() => openCode(u)}>{u}</button>{:else}<span class="docs-desc">belum dipanggil dari halaman mana pun</span>{/each}</dd>
              </dl>
              <CodeBlock code={fnExample(f, data.tables)} label="Contoh pemanggilan" />
            </article>
          {:else}
            <p class="fn-placeholder">Belum ada fungsi serverless. Buat di tab Fungsi untuk kode yang harus berjalan di server (kunci API rahasia, notifikasi, perhitungan harga).</p>
          {/each}
        </section>

        <!-- ---------- Struktur Database ---------- -->
        <section class="docs-section" id="docs-struktur">
          <h4>Struktur Database</h4>
          {#each data.tables as t (t.name)}
            <article class="docs-card">
              <header><code class="docs-name">{t.name}</code></header>
              <table class="docs-table cols">
                <thead><tr><th>Kolom</th><th>Tipe</th><th>Keterangan</th></tr></thead>
                <tbody>
                  <tr class="builtin"><td><code>id</code></td><td>Angka</td><td>otomatis</td></tr>
                  {#each t.columns as c (c.name)}
                    <tr><td><code>{c.name}</code></td><td>{DB_TYPES[c.type] ?? c.type}</td><td>{columnNotes(c)}</td></tr>
                  {/each}
                  <tr class="builtin"><td><code>created_at</code></td><td>Tanggal</td><td>otomatis</td></tr>
                </tbody>
              </table>
            </article>
          {:else}
            <p class="fn-placeholder">Belum ada tabel.</p>
          {/each}
          {#if data.relations.length}
            <p class="fn-label">Relasi</p>
            <ul class="docs-list">
              {#each data.relations as r (r.from + r.column)}
                <li><code>{`${r.from}.${r.column}`}</code> → <code>{r.to}</code></li>
              {/each}
            </ul>
            <p class="fn-note">Gambar hubungan antartabel ada di tab Diagram → ERD.</p>
          {/if}
        </section>

        <!-- ---------- Konfigurasi ---------- -->
        <section class="docs-section" id="docs-konfigurasi">
          <h4>Konfigurasi</h4>
          <dl class="docs-facts docs-card">
            <dt>Website</dt><dd><a href={data.project.siteUrl} target="_blank" rel="noopener">{data.project.siteUrl}</a></dd>
            {#if data.project.mode === 'manual'}
              <dt>Versi dev</dt><dd><a href={data.project.previewUrl} target="_blank" rel="noopener">{data.project.previewUrl}</a></dd>
              <dt>Publikasi</dt><dd>Manual: perubahan tayang setelah tombol Publikasikan ditekan</dd>
            {:else}
              <dt>Publikasi</dt><dd>Langsung: setiap perubahan langsung tayang</dd>
            {/if}
          </dl>

          <p class="fn-label">Rahasia (env)</p>
          {#if data.secrets.length || missingSecrets.size}
            <table class="docs-table cols">
              <thead><tr><th>Nama</th><th>Dipakai oleh</th><th>Status</th></tr></thead>
              <tbody>
                {#each data.secrets as s (s.name)}
                  <tr><td><code>{s.name}</code></td><td>{s.usedBy.join(', ') || '—'}</td><td>{s.usedBy.length ? 'terisi' : 'terisi, belum dipakai'}</td></tr>
                {/each}
                {#each [...missingSecrets] as name (name)}
                  <tr class="missing"><td><code>{name}</code></td><td>{data.functions.filter((f) => f.secrets.includes(name)).map((f) => f.name).join(', ')}</td><td>belum diisi</td></tr>
                {/each}
              </tbody>
            </table>
            <p class="fn-note">Nilai rahasia tidak pernah ditampilkan. Atur di tab Fungsi → Rahasia (env).</p>
          {:else}
            <p class="fn-placeholder">Belum ada rahasia.</p>
          {/if}

          <p class="fn-label">Provider AI (library ai.* di fungsi)</p>
          {#if data.aiProviders.length}
            <ul class="docs-list">
              {#each data.aiProviders as p (p.name)}
                <li><code>{p.name}</code> · {p.kind}{p.model ? ` · ${p.model}` : ''}{#if p.default}<span class="fn-chip">bawaan</span>{/if}</li>
              {/each}
            </ul>
          {:else}
            <p class="fn-placeholder">Belum ada provider AI.</p>
          {/if}

          <p class="fn-label">Jadwal</p>
          {#if scheduled.length}
            <ul class="docs-list">
              {#each scheduled as f (f.name)}
                <li><code>{f.name}</code> · {`${describeCron(f.schedule.cron)} WIB`}{#if !f.schedule.active}<span class="docs-desc"> · tidak aktif</span>{/if}</li>
              {/each}
            </ul>
          {:else}
            <p class="fn-placeholder">Tidak ada fungsi terjadwal.</p>
          {/if}
        </section>
      {/if}
    </div>
  </div>
</div>
