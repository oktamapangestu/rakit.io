<!-- Tab Console: saringan sumber, hanya error, cari, dan daftar log (lihat state.svelte.js). -->
<script>
  import { getContext, tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import AiButton from '../AiButton.svelte';
  import ConsoleView from '../functions/ConsoleView.svelte';
  import { clipText, fnFixPrompt } from '../handoff.js';
  import { con, CONSOLE_SOURCES, CONSOLE_LABEL, CONSOLE_TITLE, matches, count, clear } from './state.svelte.js';

  const { reloadPreview, icons } = getContext('editor');

  const shown = $derived(con.entries.filter(matches));
  const consoleTime = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Permintaan perbaikan untuk satu baris error, beserta konteksnya.
  function consoleFixPrompt(e) {
    if (e.source === 'be') return fnFixPrompt(e.fn, { status: e.status, error: e.error, logs: e.logs, trigger: e.trigger });
    if (e.source === 'net') return `Request dari halaman ${e.page || '/'} gagal:\n${clipText(e.text)}\n\nCari penyebabnya (kode yang memanggilnya, tabel database / akses publik, atau fungsi serverless yang dituju) dan perbaiki.`;
    return `Ada error di console halaman ${e.page || '/'}:\n${clipText(e.text)}\n\nCari penyebabnya dan perbaiki kodenya.`;
  }

  // Gulir: ke bawah saat dibuka/saringan berubah; log baru hanya ikut bila sebelumnya sudah di dekat bawah.
  let list = $state();
  let stick = true;
  $effect.pre(() => {
    void shown.length;
    if (list) stick = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  });
  $effect(() => {
    void shown.length;
    if (stick && list) list.scrollTop = list.scrollHeight;
  });
  $effect(() => {
    void con.jump;
    tick().then(() => { if (list) list.scrollTop = list.scrollHeight; });
  });
  const jump = () => { con.jump += 1; };
</script>

<div class="console-bar">
  <div class="seg console-sources">
    {#each CONSOLE_SOURCES as [value, label] (value)}
      <button type="button" class={con.source === value ? 'on owner' : ''} title={value === 'all' ? 'Semua sumber' : CONSOLE_TITLE[value]}
        onclick={() => { con.source = value; jump(); }}>{label}<span class="console-n">{count(value)}</span></button>
    {/each}
  </div>
  <label class="console-errors"><input type="checkbox" bind:checked={con.errorsOnly} onchange={jump}>Hanya error</label>
  <input type="search" class="console-search" placeholder="Cari log…" spellcheck="false" bind:value={con.query} oninput={jump}>
  <button type="button" class="icon-btn" title="Muat ulang preview" onclick={reloadPreview}><Icon d={icons.refresh} /></button>
  <button type="button" class="icon-btn" title="Bersihkan log" onclick={() => { clear(); jump(); }}><Icon d={icons.trash} /></button>
</div>
<div class="console-list" role="log" aria-live="polite" bind:this={list}>
  {#each shown as e (e)}
    <div class="console-row {e.source} {e.level}" title={e.page ? `Halaman ${e.page}` : null}>
      <span class="console-time">{consoleTime(e.time)}</span>
      <span class="console-src {e.source}" title={CONSOLE_TITLE[e.source]}>{CONSOLE_LABEL[e.source] ?? e.source}</span>
      <!-- white-space: pre-wrap: tanpa spasi/baris baru di antara isi supaya tidak ikut tampil. -->
      <div class="console-msg"><span class="console-count" hidden={e.count < 2}>{e.count}</span>{#if e.source === 'be'}<span>{e.text}</span>{#if e.error}<pre class="console-be-error">{e.error}</pre>{/if}{#if e.logs}<ConsoleView text={e.logs} />{/if}{:else}{e.text}{/if}</div>
      {#if e.level === 'error' && e.source !== 'sys'}<AiButton label="Perbaiki" text={() => consoleFixPrompt(e)} cls="console-fix" />{/if}
    </div>
  {:else}
    <div class="console-empty">{con.entries.length
      ? 'Tidak ada log yang cocok dengan saringan ini.'
      : 'Belum ada log. Pakai websitemu di preview — console.log, error, request, dan log fungsi serverless akan muncul di sini.'}</div>
  {/each}
</div>
