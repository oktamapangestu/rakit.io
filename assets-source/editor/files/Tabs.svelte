<!-- Tab file yang terbuka (#tabs), juga judul halaman browser (● = belum disimpan). -->
<script>
  import { getContext, tick } from 'svelte';
  import FileIcon from '../FileIcon.svelte';
  import Icon from '../Icon.svelte';
  import { core } from './state.svelte.js';

  // onSelect(path): pindah ke tab · onClose(path): tutup (dengan konfirmasi bila belum disimpan).
  let { onSelect, onClose } = $props();
  const { icons } = getContext('editor');

  const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const names = $derived(core.tabs.map(baseName));

  // Tab aktif tetap terlihat (komponen dipasang langsung di #tabs, tanpa pembungkus).
  $effect(() => {
    void core.active;
    void core.tabs.length;
    tick().then(() => document.querySelector('#tabs .tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  });

  $effect(() => {
    const projectName = core.project ? `${core.project.name} · ` : '';
    document.title = `${core.active ? `${core.dirty.has(core.active) ? '● ' : ''}${baseName(core.active)} · ` : ''}${projectName}rakit.io`;
  });
</script>

{#each core.tabs as path (path)}
  {@const duplicate = names.filter((n) => n === baseName(path)).length > 1}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="tab" class:active={path === core.active} class:dirty={core.dirty.has(path)} title={path}
    onclick={() => onSelect(path)} onauxclick={(e) => { if (e.button === 1) onClose(path); }}>
    <FileIcon {path} /><span>{baseName(path)}</span>{#if duplicate && parentOf(path)}<span class="tab-dir">{parentOf(path)}</span>{/if}<button
      class="close" title="Tutup" onclick={(e) => { e.stopPropagation(); onClose(path); }}><Icon d={icons.close} /></button>
  </div>
{/each}
