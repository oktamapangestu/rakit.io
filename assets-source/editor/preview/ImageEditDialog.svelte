<!--
  Ganti gambar yang diklik di mode Edit preview: pilih gambar dari project, upload baru, atau pakai alamat URL, dan
  ubah alt-nya. src ditulis sebagai "/path" (sama dengan "Salin path" di daftar file). Menyimpan perubahan ke file
  atau database dikerjakan editor.js (onSubmit).
-->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import { core } from '../files/state.svelte.js';

  // m: pesan imageEdit dari iframe ({ src, alt, shown, ... }). current: path gambar project yang tampil (atau null).
  // onSubmit(changes): { src?, alt? } — hanya yang berubah.
  let { m, current, onSubmit, close } = $props();
  const { toast, imageUrl, previewBase, uploadImages } = getContext('editor');

  const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'];
  const extOf = (p) => (baseName(p).includes('.') ? baseName(p).split('.').pop().toLowerCase() : '');

  // svelte-ignore state_referenced_locally
  let stageSrc = $state(m.shown);
  // svelte-ignore state_referenced_locally
  let info = $state(current ? `/${current}` : m.src || '(tanpa src)');
  let chosen = $state(null); // alamat baru untuk src (null = tidak diganti)
  let url = $state('');
  // svelte-ignore state_referenced_locally
  let alt = $state(m.alt ?? '');
  let urlInput;
  let grid = $state();

  const images = $derived(core.entries.filter((e) => e.type === 'file' && IMAGE_EXT.includes(extOf(e.path)) && extOf(e.path) !== 'ico'));
  const isActive = (path) => (chosen ? chosen === `/${path}` : path === current);

  $effect(() => { grid?.querySelector('.active')?.scrollIntoView({ block: 'nearest' }); });

  function choose(src, label) {
    chosen = src;
    stageSrc = src.startsWith('/') ? `${previewBase()}${src}` : src;
    info = label;
  }

  function upload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_EXT.map((e) => `.${e}`).join(',');
    input.onchange = async () => {
      // Simpan di folder gambar lama bila gambar itu ada di project, atau di folder images/ bila ada.
      const dir = current ? parentOf(current) : core.entries.some((e) => e.type === 'dir' && e.path === 'images') ? 'images' : '';
      const [path] = await uploadImages([...input.files], dir, null, { reload: false });
      if (!path) return;
      url = '';
      choose(`/${path}`, `/${path}`);
    };
    input.click();
  }

  function submit(e) {
    e.preventDefault();
    const typed = url.trim();
    if (typed && !/^(https?:\/\/|\/)\S+$/i.test(typed)) {
      urlInput.focus();
      return toast('Alamat gambar harus diawali https:// atau / (file di project)', 'error');
    }
    const cleanAlt = alt.replace(/\s+/g, ' ').trim();
    const changes = {};
    if (chosen && chosen !== m.src && !(current && chosen === `/${current}`)) changes.src = chosen;
    if (cleanAlt !== (m.alt ?? '')) changes.alt = cleanAlt;
    close();
    if (Object.keys(changes).length) onSubmit(changes);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<form class="modal image-modal imgpick-modal" role="dialog" aria-label="Ganti gambar" onsubmit={submit}>
  <div class="topup-head">
    <div><h3>Ganti gambar</h3><p>{info}</p></div>
    <button class="icon-btn" type="button" title="Tutup" onclick={close}><Icon d="m8 8.7 3.6 3.6.7-.7L8.7 8l3.6-3.6-.7-.7L8 7.3 4.4 3.7l-.7.7L7.3 8l-3.6 3.6.7.7z" /></button>
  </div>
  <div class="image-stage imgpick-stage"><img src={stageSrc} alt=""></div>
  <div class="imgpick-label"><span>Gambar di project</span><button type="button" class="imgpick-upload" onclick={upload}>Upload gambar baru…</button></div>
  <div class="imgpick-grid" bind:this={grid}>
    {#each images as e (e.path)}
      <button type="button" class="imgpick-item" class:active={isActive(e.path)} title={`/${e.path}`} data-path={e.path}
        onclick={() => { url = ''; choose(`/${e.path}`, `/${e.path}`); }}><img src={imageUrl(e.path)} alt="" loading="lazy"><span>{baseName(e.path)}</span></button>
    {:else}
      <p class="imgpick-empty">Belum ada gambar di project. Upload gambar baru di bawah.</p>
    {/each}
  </div>
  <div class="imgpick-label"><span>Atau pakai alamat gambar</span></div>
  <input bind:this={urlInput} bind:value={url} placeholder="https://… atau /gambar.jpg" spellcheck="false" autocomplete="off" aria-label="Alamat gambar"
    oninput={(e) => { const v = e.target.value.trim(); if (/^(https?:\/\/|\/)\S+$/i.test(v)) choose(v, v); }}>
  <div class="imgpick-label"><span>Teks alternatif (alt)</span><small>Deskripsi gambar untuk pembaca layar & mesin pencari</small></div>
  <input bind:value={alt} placeholder="mis. Tim kami di kantor" aria-label="Teks alternatif">
  <div class="modal-buttons">
    <button type="button" onclick={close}>Batal</button>
    <button type="submit" class="primary">Simpan</button>
  </div>
</form>
