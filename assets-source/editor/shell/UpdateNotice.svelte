<!--
  Aplikasi desktop: pemberitahuan versi baru (GET /api/desktop/update, server mengecek GitHub Releases). Diperiksa
  saat editor dibuka lalu tiap 6 jam. "Nanti" menyembunyikannya sampai ada versi yang lebih baru lagi.
  Unduh membuka halaman rilis di browser bawaan (POST /api/desktop/open).
-->
<script>
  import { getContext, onDestroy, onMount } from 'svelte';

  const { api, toast } = getContext('editor');
  const KEY = 'rakit.updateDismissed';
  let info = $state(null);
  let timer = 0;

  function dismissed() {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
  }

  async function check() {
    try {
      const res = await api('GET', '/api/desktop/update');
      info = res.available && res.latest !== dismissed() ? res : null;
    } catch { /* offline: coba lagi nanti */ }
  }

  onMount(() => {
    check();
    timer = setInterval(check, 6 * 60 * 60 * 1000);
  });
  onDestroy(() => clearInterval(timer));

  async function download() {
    try {
      await api('POST', '/api/desktop/open', { url: info.url });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function later() {
    try { localStorage.setItem(KEY, info.latest); } catch { /* tetap disembunyikan sampai editor dibuka lagi */ }
    info = null;
  }
</script>

{#if info}
  <div class="update-notice" role="status">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2m.5 2.5v5.3l2.15-2.15.7.7L8 10.71 4.65 7.35l.7-.7L7.5 9.8V4.5zM5 11.5h6v1H5z"/></svg>
    <div class="update-text">
      <strong>{`Versi baru rakit desktop ${info.latest}`}</strong>
      <span>{`Kamu memakai ${info.current}. Unduh lalu pasang versi baru; project & data di komputer ini tetap aman.`}</span>
    </div>
    <div class="update-actions">
      <button type="button" class="primary" onclick={download}>Unduh</button>
      <button type="button" onclick={later}>Nanti</button>
    </div>
  </div>
{/if}
