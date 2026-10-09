<!--
  Tab Fungsi: fungsi serverless project (functions/<nama>.js, dipanggil lewat <situs>/api/fn/<nama>; lihat
  go/internal/fn), uji coba, jadwal, provider AI, rahasia, dan log eksekusi. Dipasang di #fnView oleh fnLoad()
  di editor.js, yang memanggil load() setiap tab dibuka. Sambungan ke editor lewat context 'editor'.
-->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import AiButton from '../AiButton.svelte';
  import SectionHead from './SectionHead.svelte';
  import TryPanel from './TryPanel.svelte';
  import AiProviders from './AiProviders.svelte';
  import Secrets from './Secrets.svelte';
  import Logs from './Logs.svelte';
  import ScheduleDialog from './ScheduleDialog.svelte';
  import { describeCron } from './cron.js';

  const { api, toast, ask, copyText, saveAll, loadTree, fileExists, openCode, openDialog } = getContext('editor');

  const FN_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
  const BOLT = 'M9.3 1 3 9.2h4.2L6.3 15l6.6-8.4H8.7z';

  let data = $state.raw(null);
  let error = $state('');
  let logs = $state.raw([]);
  let logFilter = $state('');
  let open = $state(null); // fungsi yang panel uji cobanya terbuka
  let form = $state({ method: 'POST', query: '', body: '{\n  "nama": "Ani"\n}' });
  let result = $state.raw(null);
  let running = $state(false);

  const fnTemplate = (name) => [
    `// Fungsi serverless — dipanggil lewat /api/fn/${name}`,
    '// req: { method, query, headers, body } · ctx: { db, env, fetch, ai }',
    '//   db   : list / get / insert / update / delete tabel project (sebagai pemilik)',
    '//   env  : rahasia project (atur di tab Fungsi), mis. env.TELEGRAM_TOKEN',
    '//   fetch: memanggil API luar',
    "//   ai   : ai.chat('…') / ai.json / ai.embed — provider & API key di tab Fungsi → Provider AI",
    'export default async function (req, { db, env, fetch, ai }) {',
    "  const nama = req.body?.nama ?? req.query.nama ?? 'dunia';",
    '  return { pesan: `Halo, ${nama}!`, waktu: new Date().toISOString() };',
    '}',
    '',
  ].join('\n');

  const CALL_EXAMPLE = [
    "const res = await fetch('/api/fn/kirim-pesan', {",
    "  method: 'POST',",
    "  headers: { 'Content-Type': 'application/json' },",
    "  body: JSON.stringify({ nama: 'Ani', pesan: 'Halo!' }),",
    '});',
    'const data = await res.json();',
  ].join('\n');

  async function loadLogs() {
    try {
      const q = logFilter ? `&name=${encodeURIComponent(logFilter)}` : '';
      logs = (await api('GET', `/api/functions/logs?limit=50${q}`)).logs;
    } catch { /* tetap tampilkan yang lama */ }
  }

  export async function load() {
    try {
      [data] = await Promise.all([api('GET', '/api/functions'), loadLogs()]);
      error = '';
    } catch (err) {
      error = err.message;
    }
  }

  async function create() {
    const name = (await ask('Fungsi baru', 'nama-fungsi (huruf kecil, angka, - atau _)'))?.toLowerCase();
    if (!name) return;
    if (!FN_NAME_RE.test(name)) return toast('Nama fungsi: huruf kecil, angka, - atau _ (maks. 40)', 'error');
    const path = `functions/${name}.js`;
    if (fileExists(path)) return toast(`Fungsi "${name}" sudah ada`, 'error');
    try {
      await api('POST', '/api/files', { path });
      await api('PUT', '/api/files/content', { path, content: fnTemplate(name) });
      await loadTree();
      open = name;
      await load();
      toast(`Fungsi ${name} dibuat`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function run(name) {
    running = true;
    result = null;
    try {
      await saveAll(); // jalankan kode yang terakhir diketik
      result = await api('POST', `/api/functions/${encodeURIComponent(name)}/run`, form);
    } catch (err) {
      result = { error: err.message };
    }
    running = false;
    load(); // perbarui kuota & log
  }

  const schedule = (f) => openDialog(ScheduleDialog, { f, minMinutes: data.cron.minMinutes, onSaved: (d) => { data = d; } });
  const setData = (d) => { data = d; };
</script>

{#if error}
  <div class="fn-wrap"><p class="history-empty error">{error}</p></div>
{:else if data}
  {@const usage = data.usage}
  {@const used = usage.limit ? Math.min(1, usage.today / usage.limit) : 0}
  <div class="fn-wrap">
    <div class="fn-head">
      <div>
        <h3>Fungsi serverless</h3>
        <p>Kode backend yang berjalan di server: simpan API key dengan aman, olah data, kirim notifikasi, atau panggil layanan lain.</p>
      </div>
      <div class="fn-head-actions">
        <AiButton label="Buat dengan AI" text="Buatkan fungsi serverless yang " />
        <button type="button" class="fn-new" onclick={create}>+ Fungsi baru</button>
      </div>
    </div>

    <div class="fn-usage">
      <div class="fn-usage-top">
        <span class="fn-usage-count"><strong>{usage.today.toLocaleString('id-ID')}</strong>{` / ${usage.limit.toLocaleString('id-ID')} eksekusi hari ini`}</span>
        <span class="fn-usage-meta">
          <span class="fn-chip">{`Paket ${usage.plan}`}</span>
          <span class="fn-chip" title="Batas per eksekusi">{`maks. ${data.limits.timeoutSeconds} dtk`}</span>
          <span class="fn-chip" title="Batas memori per eksekusi">{`${data.limits.memoryMb} MB`}</span>
        </span>
      </div>
      <div class="fn-meter" class:full={used >= 0.9} role="progressbar" aria-label="Eksekusi hari ini" aria-valuemin="0" aria-valuemax={String(usage.limit)} aria-valuenow={String(usage.today)}>
        <span style="width: {(used * 100).toFixed(1)}%"></span>
      </div>
    </div>

    <section class="fn-section">
      <SectionHead title="Fungsi" count={data.functions.length} />
      {#each data.functions as f (f.name)}
        <div class="fn-item" class:open={open === f.name}>
          <div class="fn-item-head">
            <span class="fn-icon"><Icon d={BOLT} /></span>
            <div class="fn-item-text">
              <strong>{f.name}{#if f.schedule}<span class="fn-sched" class:off={!f.schedule.active}
                title={f.schedule.note || `Berikutnya: ${f.schedule.nextRunAt ? new Date(f.schedule.nextRunAt).toLocaleString('id-ID') : '-'}`}>{`⏱ ${describeCron(f.schedule.cron)}`}</span>{/if}</strong>
              <code title={f.url}>{f.url.replace(/^https?:\/\//, '')}</code>
            </div>
            <button type="button" class="fn-btn" onclick={() => schedule(f)}>Jadwal</button>
            <button type="button" class="fn-btn" onclick={() => copyText(f.url, 'URL fungsi disalin')}>Salin URL</button>
            <button type="button" class="fn-btn" onclick={() => openCode(f.path)}>Buka kode</button>
            <AiButton label="Ubah" text={`Ubah fungsi ${f.path} supaya `} />
            <button type="button" class="fn-btn primary" onclick={() => { open = open === f.name ? null : f.name; result = null; }}>{open === f.name ? 'Tutup' : 'Coba'}</button>
          </div>
          {#if open === f.name}<TryPanel {f} bind:form {result} {running} onRun={run} />{/if}
        </div>
      {:else}
        <div class="fn-empty">
          <span class="fn-icon"><Icon d={BOLT} /></span>
          <p>Belum ada fungsi. Fungsi disimpan di folder <code>functions/</code> dan langsung bisa dipanggil dari halaman website-mu.</p>
          <button type="button" class="fn-btn primary" onclick={create}>Buat fungsi pertama</button>
        </div>
      {/each}
    </section>

    <AiProviders {data} onData={setData} />
    <Secrets secrets={data.secrets} onData={setData} />
    <Logs functions={data.functions} {logs} filter={logFilter} onFilter={(name) => { logFilter = name; loadLogs(); }} onReload={loadLogs} />

    <details class="fn-help">
      <summary>Cara memanggil dari halaman website</summary>
      <pre class="fn-pre">{CALL_EXAMPLE}</pre>
    </details>
  </div>
{/if}
