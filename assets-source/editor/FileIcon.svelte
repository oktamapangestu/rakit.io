<!-- Ikon file menurut jenisnya (sama dengan fileIcon() di editor.js untuk file). -->
<script>
  import Icon from './Icon.svelte';
  import { IMAGE } from './icons.js';

  let { path } = $props();
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'];
  const LABEL = { html: '<>', css: '#', js: 'JS' };
  const name = $derived(path.slice(path.lastIndexOf('/') + 1));
  const ext = $derived(name.includes('.') ? name.split('.').pop().toLowerCase() : '');
</script>

{#if IMAGE_EXT.includes(ext)}
  <span class="ficon img"><Icon d={IMAGE} /></span>
{:else}
  <span class="ficon {ext}">{LABEL[ext] ?? '•'}</span>
{/if}
