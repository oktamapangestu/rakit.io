<!-- Path file aktif di atas editor kode (#breadcrumbs). -->
<script>
  import { core } from './state.svelte.js';
</script>

{#if core.active}{#each core.active.split('/') as part, i (i)}{#if i}<span class="sep">›</span>{/if}<span>{part}</span>{/each}{/if}
