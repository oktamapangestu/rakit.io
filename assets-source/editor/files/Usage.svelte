<!-- Pemakaian storage project di bawah pohon file (#usage). -->
<script>
  import { getContext } from 'svelte';
  import { core } from './state.svelte.js';

  const { formatBytes } = getContext('editor');
  const u = $derived(core.usage);
  const pct = $derived(u ? Math.min(100, (u.size / u.limits.totalSize) * 100) : 0);
</script>

{#if u}
  {`${formatBytes(u.size)} / ${formatBytes(u.limits.totalSize)} · ${u.entries} item`}
  <div class="usage-bar"><div style="width:{pct}%"></div></div>
{/if}
