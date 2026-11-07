<!--
  Aplikasi desktop: akun rakit.io (opsional). Masuk lewat browser (kode dicocokkan di halaman rakit.io), lalu
  - Publikasikan: kirim project yang sedang dibuka (file + struktur tabel) ke rakit.io. Project yang belum punya
    pasangan di server dibuatkan dulu (alamat acak atau pilihan sendiri). Data database di server tidak ditimpa.
  - Project di rakit.io: daftar project akun di server; unduh ke komputer sebagai project lokal baru.
  Server lokal yang berbicara dengan rakit.io (go/internal/api/cloud.go); token tidak pernah sampai ke sini.
-->
<script>
  import { getContext, onDestroy, onMount } from 'svelte';
  import { core } from '../files/state.svelte.js';

  // tab awal: 'publish' | 'projects'. onSwitch(slug): simpan file lalu buka project lokal lain.
  let { tab: startTab = 'publish', onSwitch, close } = $props();
  const { api, toast } = getContext('editor');

  // svelte-ignore state_referenced_locally
  let tab = $state(startTab);
  let status = $state(null); // GET /api/cloud
  let error = $state('');
  let busy = $state(false);
  let poll = 0;

  // Publikasikan
  let link = $state(undefined); // undefined = memuat, null = belum ada pasangan
  let custom = $state(false);
  let slug = $state('');
  let result = $state(null);

  // Project di server
  let remote = $state(null);
  let downloading = $state('');

  const host = (url) => url.replace(/^https?:\/\//, '');
  const serverHost = $derived(status ? host(status.server) : 'rakit.io');

  onMount(refresh);
  onDestroy(() => clearTimeout(poll));

  async function refresh() {
    clearTimeout(poll);
    try {
      status = await api('GET', '/api/cloud');
    } catch (err) {
      error = err.message;
      return;
    }
    if (status.pending) {
      poll = setTimeout(refresh, 2000);
    } else if (status.connected) {
      load();
    }
  }

  function load() {
    if (tab === 'publish' && link === undefined) loadLink();
    if (tab === 'projects' && !remote) loadRemote();
  }

  function show(name) {
    tab = name;
    error = '';
    if (status?.connected) load();
  }

  // Kesalahan dari server: sesi rakit.io berakhir = kembali ke tampilan masuk.
  function fail(err) {
    if (err.code === 'cloud_auth') {
      status = { ...status, connected: false, user: null };
      link = undefined;
      remote = null;
    }
    error = err.message;
  }

  async function login() {
    busy = true;
    error = '';
    try {
      status = await api('POST', '/api/cloud/login');
      poll = setTimeout(refresh, 2000);
    } catch (err) {
      error = err.message;
    }
    busy = false;
  }

  async function cancelLogin() {
    clearTimeout(poll);
    status = await api('POST', '/api/cloud/login/cancel').catch(() => status);
  }

  async function logout() {
    busy = true;
    try {
      status = await api('POST', '/api/cloud/logout');
      link = undefined;
      remote = null;
      result = null;
    } catch (err) {
      error = err.message;
    }
    busy = false;
  }

  async function loadLink() {
    try {
      link = (await api('GET', '/api/cloud/link')).link;
    } catch (err) {
      fail(err);
    }
  }

  async function unlink() {
    try {
      link = (await api('POST', '/api/cloud/unlink')).link;
      result = null;
    } catch (err) {
      fail(err);
    }
  }

  async function publish() {
    busy = true;
    error = '';
    result = null;
    try {
      result = await api('POST', '/api/cloud/publish', { slug: !link && custom ? slug : '' });
      link = result.link;
      remote = null; // daftar project server berubah bila project baru dibuat
      toast(`Dipublikasikan ke ${host(result.project.siteUrl)}`);
    } catch (err) {
      if (err.code === 'unlinked') link = null;
      fail(err);
    }
    busy = false;
  }

  async function loadRemote() {
    try {
      remote = await api('GET', '/api/cloud/projects');
    } catch (err) {
      fail(err);
    }
  }

  async function download(p) {
    downloading = p.slug;
    error = '';
    try {
      const res = await api('POST', `/api/cloud/projects/${encodeURIComponent(p.slug)}/download`);
      p.local = res.project.slug;
      core.projects = [...core.projects, res.project];
      toast(`${p.name} sudah ada di komputer`);
    } catch (err) {
      fail(err);
    }
    downloading = '';
  }
</script>

<div class="modal cloud-modal" role="dialog" aria-label="Akun rakit.io">
  <h3>{`Akun ${serverHost}`}</h3>

  {#if !status}
    <p>{error || 'Memuat…'}</p>
  {:else if status.pending}
    <p>Browser dibuka ke halaman masuk rakit.io. Masuk di sana, lalu tekan <strong>Izinkan</strong>. Pastikan kodenya sama:</p>
    <p class="cloud-code">{status.pending.userCode}</p>
    <p class="cloud-small">Browser tidak terbuka? Buka alamat ini: <code class="cloud-url">{status.pending.verifyUrl}</code></p>
    <p class="cloud-wait"><span class="cloud-spin" aria-hidden="true"></span>Menunggu persetujuan…</p>
    <div class="modal-buttons">
      <button type="button" onclick={cancelLogin}>Batal</button>
    </div>
  {:else if !status.connected}
    <p>Aplikasi desktop bisa dipakai tanpa akun. Masuk dengan akun {serverHost} untuk memublikasikan project dari komputer ini ke internet dan mengunduh project yang sudah ada di {serverHost}.</p>
    {#if status.error}<p class="db-form-error">{status.error}</p>{/if}
    {#if error}<p class="db-form-error">{error}</p>{/if}
    <div class="modal-buttons">
      <button type="button" onclick={close}>Tutup</button>
      <button type="button" class="primary" disabled={busy} onclick={login}>{`Masuk dengan akun ${serverHost}`}</button>
    </div>
  {:else}
    <div class="cloud-account">
      <span>Masuk sebagai <strong>{status.user?.username}</strong></span>
      <button type="button" class="link-btn" disabled={busy} onclick={logout}>Keluar</button>
    </div>

    <div class="cloud-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={String(tab === 'publish')} onclick={() => show('publish')}>Publikasikan</button>
      <button type="button" role="tab" aria-selected={String(tab === 'projects')} onclick={() => show('projects')}>{`Project di ${serverHost}`}</button>
    </div>

    {#if tab === 'publish'}
      {#if link === undefined}
        <p>{error ? '' : 'Memuat…'}</p>
      {:else if link}
        <p>Project <strong>{core.project.name}</strong> terhubung ke <a href={link.siteUrl} target="_blank" rel="noopener">{host(link.siteUrl)}</a>. Publikasikan mengirim file dan struktur tabel terbaru dari komputer ini.</p>
      {:else}
        <p>Project <strong>{core.project.name}</strong> belum ada di {serverHost}. Publikasikan membuat project baru di akunmu lalu mengirim file dan struktur tabelnya.</p>
        <div class="mode-options" role="radiogroup" aria-label="Alamat website">
          <button type="button" role="radio" class="mode-option" aria-checked={String(!custom)} onclick={() => (custom = false)}>
            <strong>Alamat acak</strong><span>{`Dibuat otomatis, mis. web-k7m2qx.${serverHost}. Bisa diganti di ${serverHost} kapan saja.`}</span>
          </button>
          <button type="button" role="radio" class="mode-option" aria-checked={String(custom)} onclick={() => (custom = true)}>
            <strong>Alamat sendiri</strong><span>Pilih nama subdomain sendiri (dibatasi jumlahnya per akun).</span>
          </button>
        </div>
        {#if custom}
          <label class="db-field cloud-slug"><span class="db-field-label">Alamat sendiri</span>
            <input value={slug} placeholder="tokokue" spellcheck="false" autocomplete="off" maxlength="30"
              oninput={(e) => { e.target.value = slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); }}>
          </label>
          <p class="project-preview">Websitemu: <strong>{`${slug || 'namamu'}.${serverHost}`}</strong></p>
        {/if}
      {/if}
      {#if link !== undefined}
        <p class="pub-note">Data di database server tidak ditimpa: tabel dan kolom baru ditambahkan, yang sudah ada dibiarkan. Gambar kiriman pengunjung di server tetap aman. Versi sebelumnya tersimpan di Riwayat project di {serverHost}.</p>
      {/if}

      {#if result}
        <div class="cloud-result">
          <p>Terkirim ke <a href={result.project.siteUrl} target="_blank" rel="noopener">{host(result.project.siteUrl)}</a>{#if result.created} (project baru){/if}.</p>
          {#if result.project.mode === 'manual'}
            <p class="cloud-small">Project ini memakai publikasi manual di {serverHost}: perubahan masuk ke versi dev. Buka editor {serverHost} lalu tekan Publikasikan untuk menayangkannya.</p>
          {/if}
          {#if result.schema?.changes?.length}
            <ul class="pub-list">{#each result.schema.changes as c, i (i)}<li class="pub-schema">{c}</li>{/each}</ul>
          {/if}
          {#if result.schema?.warnings?.length}
            <div class="pub-warn">{#each result.schema.warnings as w, i (i)}<p>⚠️ {w}</p>{/each}</div>
          {/if}
        </div>
      {/if}
      {#if error}<p class="db-form-error">{error}</p>{/if}
      <div class="modal-buttons">
        {#if link}<button type="button" class="link-btn cloud-unlink" onclick={unlink} title="Publikasi berikutnya membuat project baru di server">Lepaskan</button>{/if}
        <button type="button" onclick={close}>Tutup</button>
        <button type="button" class="primary" disabled={busy || link === undefined || (!link && custom && !slug)} onclick={publish}>
          {busy ? 'Mengirim…' : `Publikasikan ke ${serverHost}`}
        </button>
      </div>
    {:else}
      {#if !remote}
        <p>{error ? '' : 'Memuat…'}</p>
      {:else if !remote.projects.length}
        <p>{`Belum ada project di ${serverHost}.`}</p>
      {:else}
        <ul class="cloud-list">
          {#each remote.projects as p (p.slug)}
            <li>
              <div class="cloud-item">
                <strong>{p.name}</strong>
                <a href={p.siteUrl} target="_blank" rel="noopener">{p.siteHost}</a>
              </div>
              {#if p.local}
                <button type="button" onclick={() => onSwitch(p.local)} disabled={p.local === core.project.slug}>{p.local === core.project.slug ? 'Sedang dibuka' : 'Buka'}</button>
              {:else}
                <button type="button" disabled={Boolean(downloading)} onclick={() => download(p)}>{downloading === p.slug ? 'Mengunduh…' : 'Unduh'}</button>
              {/if}
            </li>
          {/each}
        </ul>
        <p class="pub-note">Unduh membuat project baru di komputer ini berisi file, gambar, dan database (beserta datanya) dari {serverHost}. Setelah diedit, publikasikan lagi dari project itu.</p>
      {/if}
      {#if error}<p class="db-form-error">{error}</p>{/if}
      <div class="modal-buttons">
        <button type="button" onclick={close}>Tutup</button>
      </div>
    {/if}
  {/if}
</div>
