<!-- Log eksekusi fungsi (100 terakhir): pengunjung, jadwal, dan uji coba. -->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import AiButton from '../AiButton.svelte';
  import ConsoleView from './ConsoleView.svelte';
  import { LOG_LEVEL_RE } from './console.js';
  import SectionHead from './SectionHead.svelte';
  import { fnFixPrompt } from '../handoff.js';

  // filter: nama fungsi yang lognya ditampilkan ('' = semua); onFilter(nama) memuat ulang dengan filter baru.
  let { functions, logs, filter, onFilter, onReload } = $props();
  const { icons } = getContext('editor');

  const TRIGGER = { http: 'Pengunjung', cron: 'Jadwal', test: 'Uji coba' };
  let openLog = $state(null);

  const when = (ms) => {
    const t = new Date(ms);
    const time = t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return t.toDateString() === new Date().toDateString() ? time : `${t.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} ${time}`;
  };
  const logPeek = (text) => text.split('\n').find((l) => l.trim())?.replace(LOG_LEVEL_RE, '').slice(0, 120) ?? '';
  const logLines = (text) => text.replace(/\n$/, '').split('\n').length;
</script>

<section class="fn-section">
  <SectionHead title="Log eksekusi">
    <select onchange={(e) => onFilter(e.target.value)}>
      <option value="">Semua fungsi</option>
      {#each functions as f (f.name)}<option value={f.name} selected={f.name === filter}>{f.name}</option>{/each}
    </select>
    <button type="button" class="icon-btn" title="Muat ulang log" onclick={onReload}><Icon d={icons.refresh} /></button>
  </SectionHead>
  {#if logs.length}
    <ul class="fn-logs">
      {#each logs as l (l.id)}
        {@const open = openLog === l.id}
        <li class:open>
          <button type="button" class="fn-log-row" onclick={() => (openLog = open ? null : l.id)}>
            <span class="fn-log-time">{when(l.createdAt)}</span>
            <code>{l.name}</code>
            <span class="fn-log-peek" title={l.logs ? 'Keluaran console' : ''}>
              {#if l.error}<span class="peek-error">{l.error}</span>{:else if l.logs}{logPeek(l.logs)}{/if}
            </span>
            {#if l.logs}<span class="fn-log-count" title="Jumlah baris console">{`${logLines(l.logs)} baris`}</span>{/if}
            <span class="fn-chip {l.trigger}">{TRIGGER[l.trigger] ?? l.trigger}</span>
            {#if l.dev}<span class="env-badge">DEV</span>{/if}
            <span class="fn-status s{String(l.status)[0]}">{l.status}</span>
            <span class="fn-log-ms">{`${l.ms} ms`}</span>
            <span class="fn-log-more">{open ? '▴' : '▾'}</span>
          </button>
          {#if open}
            {#if l.error}<p class="fn-error">{l.error}</p>{/if}
            {#if l.logs}
              <div class="fn-label">console</div>
              <ConsoleView text={l.logs} />
            {:else if !l.error}
              <p class="fn-note fn-log-empty">Tidak ada keluaran console. Tambahkan console.log(...) di kode fungsi untuk melihat isinya di sini.</p>
            {/if}
            {#if l.error || l.status >= 500}
              <div class="fn-ai-fix">
                <AiButton label="Perbaiki dengan AI" text={() => fnFixPrompt(l.name, { status: l.status, error: l.error, logs: l.logs, trigger: (TRIGGER[l.trigger] ?? l.trigger).toLowerCase() })} />
              </div>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="fn-placeholder">Belum ada eksekusi. Panggilan dari pengunjung, jadwal, dan uji coba tercatat di sini (100 terakhir).</p>
  {/if}
</section>
