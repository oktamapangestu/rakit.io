<!-- Lihat gambar project: ukuran, cuplikan kode untuk memakainya, ganti, atau hapus. -->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import { core } from './state.svelte.js';

  // onReplace / onDelete: aksi di editor.js (pilih file pengganti / hapus dengan konfirmasi).
  let { path, src, onReplace, onDelete, close } = $props();
  const { formatBytes, copyText, icons } = getContext('editor');

  const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
  // svelte-ignore state_referenced_locally
  const entry = core.entries.find((e) => e.path === path);
  let info = $state(entry ? formatBytes(entry.size) : '');
  // svelte-ignore state_referenced_locally
  const snippets = [
    ['Path', `/${path}`],
    ['HTML', `<img src="/${path}" alt="${baseName(path).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')}">`],
    ['CSS', `background-image: url('/${path}');`],
  ];
</script>

<div class="modal image-modal" role="dialog" aria-label={`Gambar ${path}`}>
  <div class="topup-head">
    <div><h3>{baseName(path)}</h3><p><span>{info}</span></p></div>
    <button class="icon-btn" type="button" title="Tutup" onclick={close}><Icon d={icons.close} /></button>
  </div>
  <div class="image-stage">
    <img {src} alt={path}
      onload={(e) => { info = `${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px · ${entry ? formatBytes(entry.size) : ''}`; }}
      onerror={() => { info = 'Gambar tidak bisa ditampilkan.'; }}>
  </div>
  <div class="image-snippets">
    {#each snippets as [label, code] (label)}
      <div class="snippet"><span class="snippet-label">{label}</span><code>{code}</code><button type="button" onclick={() => copyText(code, `${label} disalin`)}>Salin</button></div>
    {/each}
  </div>
  <div class="modal-buttons">
    <button type="button" onclick={() => { close(); onReplace(); }}>Ganti gambar…</button>
    <button type="button" class="danger" onclick={() => { close(); onDelete(); }}>Hapus</button>
    <button type="button" class="primary" onclick={close}>Tutup</button>
  </div>
</div>
