<!-- Bandingkan gambar di versi lama (kiri) dengan sekarang (kanan). -->
<script>
  import { getContext, onDestroy } from 'svelte';
  import Icon from '../Icon.svelte';
  import { fullTime } from './text.js';

  let { version, file: f, close } = $props();
  const { projectHeaders, imageUrl, icons } = getContext('editor');

  const urls = []; // object URL yang harus dilepas saat dialog ditutup
  onDestroy(() => urls.forEach((u) => URL.revokeObjectURL(u)));

  async function versionImage() {
    const res = await fetch(`/api/versions/${version.id}/file?path=${encodeURIComponent(f.path)}`, {
      headers: projectHeaders(),
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('Gambar versi ini tidak bisa dimuat');
    const url = URL.createObjectURL(await res.blob());
    urls.push(url);
    return url;
  }

  // svelte-ignore state_referenced_locally
  const sides = [
    { label: `Versi ${fullTime(version.createdAt)}`, src: f.status === 'new' ? null : versionImage() },
    { label: 'Sekarang', src: f.status === 'missing' ? null : Promise.resolve(`${imageUrl(f.path)}`) },
  ];
</script>

<div class="modal image-modal history-image-modal" role="dialog" aria-label={`Perbandingan ${f.path}`}>
  <div class="topup-head">
    <div><h3>{f.path.slice(f.path.lastIndexOf('/') + 1)}</h3><p>Kiri: versi lama · Kanan: sekarang</p></div>
    <button class="icon-btn" type="button" title="Tutup" onclick={close}><Icon d={icons.close} /></button>
  </div>
  <div class="history-image-compare">
    {#each sides as side (side.label)}
      <figure>
        <div class="image-stage">
          {#if !side.src}
            <span class="history-none">Tidak ada</span>
          {:else}
            {#await side.src then src}<img {src} alt={side.label}>{:catch err}<span class="history-none">{err.message}</span>{/await}
          {/if}
        </div>
        <figcaption>{side.label}</figcaption>
      </figure>
    {/each}
  </div>
  <div class="modal-buttons"><button type="button" class="primary" onclick={close}>Tutup</button></div>
</div>
