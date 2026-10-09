<!--
  Panel preview (#preview): bar alamat, Pilih blok, Edit, ukuran layar, bar petunjuk, dan iframe website. Logika
  (muat ulang, pesan dari/ke iframe, edit teks & gambar) ada di editor.js; aksinya lewat prop actions.
-->
<script>
  import Icon from '../Icon.svelte';
  import { preview, MAX_BLOCKS } from './state.svelte.js';
  import { core } from '../files/state.svelte.js';

  // actions: go(value, input) · currentRoute() · reload() · info() · togglePick() · toggleEdit() · pickGo() ·
  // pickDone() · textDone() · setDevice(device) · isMobile()
  let { actions } = $props();

  const ICONS = {
    lock: 'M8 1a3 3 0 0 0-3 3v2H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3m2 5H6V4a2 2 0 1 1 4 0z',
    pick: 'M1 1h4v1H2v3H1zm10 0h4v4h-1V2h-3zM1 11h1v3h3v1H1zm6-4 7.5 3-3.1 1.2 2.3 2.4-1.1 1.1-2.3-2.4L9 15z',
    edit: 'M11.1 1.6a1.6 1.6 0 0 1 2.3 0l1 1a1.6 1.6 0 0 1 0 2.3L5.3 14H2v-3.3zm1.6.7a.6.6 0 0 0-.9 0l-1 1 1.9 1.9 1-1a.6.6 0 0 0 0-.9zM11.9 5.9 10 4 3 11v2h2z',
    info: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2m.5 5v5h-1V7zM8 4.25a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5',
    reload: 'M13.45 5.17A6 6 0 1 0 14 8h-1a5 5 0 1 1-.8-2.73l-1.7.23.14 1 3.4-.5-.5-3.4-1 .14z',
    open: 'M9 2v1h3.3L6.6 8.6l.8.8L13 3.7V7h1V2zM12 13H3V4h4V3H2v11h11V9h-1z',
  };
  const DEVICES = [
    ['desktop', 'Desktop', 'M1.5 2h13A1.5 1.5 0 0 1 16 3.5v8a1.5 1.5 0 0 1-1.5 1.5H10v1h2v1H4v-1h2v-1H1.5A1.5 1.5 0 0 1 0 11.5v-8A1.5 1.5 0 0 1 1.5 2m0 1a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-8a.5.5 0 0 0-.5-.5z'],
    ['tablet', 'Tablet (768px)', 'M4 1h8a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 12 15H4a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 4 1m0 1a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5v-11A.5.5 0 0 0 12 2zm3 10h2v1H7z'],
    ['mobile', 'HP (390px)', 'M5.5 1h5A1.5 1.5 0 0 1 12 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 13.5v-11A1.5 1.5 0 0 1 5.5 1m0 1a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5zM7 12h2v1H7z'],
  ];

  // Alamat yang tampil mengikuti halaman preview, kecuali saat sedang diketik.
  let input;
  $effect(() => {
    const route = preview.route;
    if (document.activeElement !== input) input.value = route;
  });

  const n = $derived(preview.pick.blocks.length);
  const hint = $derived.by(() => {
    const move = actions.isMobile() ? 'Pindah halaman lewat bar alamat.' : 'Alt+klik link untuk pindah halaman.';
    return n
      ? `${n} blok dipilih. Klik lagi untuk melepas. ${move}`
      : `Klik bagian halaman yang mau diubah (maks. ${MAX_BLOCKS}). ${move}`;
  });
</script>

<div class="preview-bar">
  <div class="url-pill">
    <svg class="lock" viewBox="0 0 16 16"><path d={ICONS.lock} /></svg>
    <span class="env-badge" id="envBadge" title="Versi dev: hanya berubah di sini sampai dipublikasikan" hidden={core.project?.mode !== 'manual'}>DEV</span>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <span class="preview-host" id="previewHost" onclick={() => input.focus()}>{preview.host}</span>
    <input class="preview-url" id="previewUrl" spellcheck="false" autocomplete="off" autocapitalize="off" bind:this={input}
      aria-label="Alamat halaman preview (bisa diubah, tekan Enter)" title="Ubah alamat halaman lalu tekan Enter (Esc untuk batal)"
      onkeydown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); actions.go(input.value, input); }
        if (e.key === 'Escape') { e.preventDefault(); input.value = actions.currentRoute(); input.blur(); }
      }}
      onfocus={() => input.select()}
      onblur={() => { input.value = actions.currentRoute(); }}>
  </div>
  <button class="pick-btn" id="pickBlocks" title="Pilih bagian halaman yang mau diubah AI" class:active={preview.pick.on} aria-pressed={String(preview.pick.on)} onclick={actions.togglePick}>
    <Icon d={ICONS.pick} />
    <span>Pilih blok</span>
  </button>
  <button class="pick-btn" id="editText" title="Klik teks di preview untuk mengubahnya, atau klik gambar untuk menggantinya" class:active={preview.textEdit.on} aria-pressed={String(preview.textEdit.on)} onclick={actions.toggleEdit}>
    <Icon d={ICONS.edit} />
    <span>Edit</span>
  </button>
  <button class="icon-btn feature-info-btn" id="previewInfo" title="Apa itu preview & website online?" aria-label="Penjelasan preview" onclick={actions.info}>
    <Icon d={ICONS.info} />
  </button>
  <button class="icon-btn" id="reloadPreview" title="Muat ulang preview" onclick={actions.reload}>
    <Icon d={ICONS.reload} />
  </button>
  <a class="icon-btn" id="openPreview" target="_blank" rel="noopener" title="Buka di tab baru" href={preview.url || null}>
    <Icon d={ICONS.open} />
  </a>
</div>
<div class="device-switch" role="group" aria-label="Ukuran layar">
  {#each DEVICES as [device, title, d] (device)}
    <button data-device={device} {title} class:active={preview.device === device} onclick={() => actions.setDevice(device)}>
      <Icon {d} />
    </button>
  {/each}
</div>
<div class="pick-bar" id="pickBar" hidden={!preview.pick.on}>
  <span class="pick-hint" id="pickHint">{hint}</span>
  <button type="button" class="pick-go" id="pickGo" hidden={!n} onclick={actions.pickGo}>Tulis perintah</button>
  <button type="button" class="pick-done" id="pickDone" onclick={actions.pickDone}>Selesai</button>
</div>
<div class="pick-bar text-bar" id="textBar" hidden={!preview.textEdit.on}>
  <span class="pick-hint">Klik teks lalu ketik (<kbd>Enter</kbd> simpan, <kbd>Esc</kbd> batal), atau klik gambar untuk menggantinya.</span>
  <button type="button" class="pick-done" id="textDone" onclick={actions.textDone}>Selesai</button>
</div>
<div class="stage" id="stage" data-device={preview.device}>
  <iframe id="previewFrame" title="Preview website"></iframe>
</div>
