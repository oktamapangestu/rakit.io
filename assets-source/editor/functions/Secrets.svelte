<!-- Rahasia project (env): disimpan di server, isinya tidak pernah ditampilkan lagi. -->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import SectionHead from './SectionHead.svelte';

  let { secrets, onData } = $props();
  const { api, toast, confirm, icons } = getContext('editor');

  let name = $state('');
  let value = $state('');

  async function save() {
    try {
      onData(await api('PUT', '/api/functions/secrets', { name, value }));
      toast(`Rahasia ${name} disimpan`);
      name = value = '';
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove(s) {
    const ok = await confirm({ title: `Hapus rahasia ${s.name}?`, message: 'Fungsi yang memakai env.' + s.name + ' akan mendapat undefined.', buttons: [{ label: 'Hapus', value: true, danger: true }, { label: 'Batal', value: null }] });
    if (!ok) return;
    try {
      onData(await api('DELETE', `/api/functions/secrets/${encodeURIComponent(s.name)}`));
    } catch (err) {
      toast(err.message, 'error');
    }
  }
</script>

<section class="fn-section">
  <SectionHead title="Rahasia (env)" count={secrets.length || null} />
  <p class="fn-note">Untuk API key &amp; token. Dibaca fungsi lewat <code>env.NAMA</code> — tidak pernah terkirim ke browser pengunjung, dan isinya tidak ditampilkan lagi setelah disimpan.</p>
  {#if secrets.length}
    <ul class="fn-secrets">
      {#each secrets as s (s.name)}
        <li>
          <code>{s.name}</code><span class="fn-dots">••••••••</span><button type="button" class="icon-btn" title={`Hapus ${s.name}`} onclick={() => remove(s)}><Icon d={icons.trash} /></button>
        </li>
      {/each}
    </ul>
  {/if}
  <form class="fn-secret-form" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <input value={name} placeholder="NAMA_RAHASIA" spellcheck="false" autocomplete="off"
      oninput={(e) => { e.target.value = name = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'); }}>
    <input type="password" bind:value placeholder="isi (mis. API key)" autocomplete="new-password">
    <button type="submit" class="fn-btn primary">Simpan</button>
  </form>
</section>
