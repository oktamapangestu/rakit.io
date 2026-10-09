<!-- Pemakaian database project di bawah daftar tabel (#dbUsage). -->
<script>
  import { getContext } from 'svelte';
  import { db } from './state.svelte.js';

  const { formatBytes } = getContext('editor');
</script>

{#if db.usage}
  {@const u = db.usage}
  {`${formatBytes(u.bytes)} / ${formatBytes(u.limits.bytes)} · ${u.tables}/${u.limits.tables} tabel`}
  <div class="usage-bar"><div style="width:{Math.min(100, (u.bytes / u.limits.bytes) * 100)}%"></div></div>
{/if}
