<!-- Pemakaian storage project di bawah pohon file (#usage). -->
<script>
  import { getContext } from 'svelte';
  import { core } from './state.svelte.js';

  const { formatBytes, topupEnabled, hasPlan, openTopup } = getContext('editor');
  const u = $derived(core.usage);
  const pct = $derived(u ? Math.min(100, (u.size / u.limits.totalSize) * 100) : 0);
  const nearlyFull = $derived(u ? pct >= 80 || u.entries >= u.limits.entries * 0.9 : false);
</script>

{#if u}
  {`${formatBytes(u.size)} / ${formatBytes(u.limits.totalSize)} · ${u.entries} item`}
  <div class="usage-bar"><div style="width:{pct}%"></div></div>
  {#if nearlyFull && topupEnabled() && !hasPlan()}
    <button type="button" class="usage-upgrade" onclick={() => openTopup('plans')}>Storage hampir penuh · tambah dengan langganan</button>
  {/if}
{/if}
