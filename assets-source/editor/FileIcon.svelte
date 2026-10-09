<!-- Ikon file menurut jenisnya, atau ikon folder (dir; open = terbuka). Sama dengan fileIcon() di editor.js. -->
<script>
  import Icon from './Icon.svelte';
  import { IMAGE, FOLDER, FOLDER_OPEN } from './icons.js';

  let { path, dir = false, open = false } = $props();
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'];
  const LABEL = { html: '<>', css: '#', js: 'JS' };
  const name = $derived(path.slice(path.lastIndexOf('/') + 1));
  const ext = $derived(name.includes('.') ? name.split('.').pop().toLowerCase() : '');
</script>

{#if dir}
  <span class="ficon dir"><Icon d={open ? FOLDER_OPEN : FOLDER} /></span>
{:else if IMAGE_EXT.includes(ext)}
  <span class="ficon img"><Icon d={IMAGE} /></span>
{:else}
  <span class="ficon {ext}">{LABEL[ext] ?? '•'}</span>
{/if}
