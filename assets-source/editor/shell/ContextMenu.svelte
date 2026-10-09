<!--
  Menu konteks (#ctxmenu): menu file di pohon, akun, project, riwayat percakapan. Isinya dari showMenu() di
  state.svelte.js; tertutup saat klik di luar menu, Esc, atau jendela kehilangan fokus.
-->
<script>
  import { menu, hideMenu } from './state.svelte.js';

  let el;
  const m = $derived(menu.current);

  // Ukuran diukur setelah isi terpasang, lalu menu dijaga di dalam layar. Diukur di pojok kiri atas (ruang penuh,
  // isi tidak terlipat karena posisi lama di dekat tepi layar). offsetWidth/Height: ukuran asli, tidak terpengaruh
  // animasi muncul (scale) seperti getBoundingClientRect.
  $effect(() => {
    if (!m) return;
    el.style.left = '0px';
    el.style.top = '0px';
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = m.align === 'right' ? m.x - width : m.x;
    el.style.left = `${Math.max(4, Math.min(left, innerWidth - width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(m.y, innerHeight - height - 4))}px`;
  });
</script>

<svelte:document onmousedown={(e) => { if (!el.contains(e.target)) hideMenu(); }} onkeydown={(e) => { if (e.key === 'Escape') hideMenu(); }} />
<svelte:window onblur={hideMenu} />

<div class="ctxmenu" class:history-menu={m?.wide} id="ctxmenu" hidden={!m} bind:this={el}>
  {#if m}
    {#if m.label}<div class="menu-label"><strong>{m.label.title}</strong>{m.label.sub}</div>{/if}
    {#each m.items as item, i (i)}
      {#if item === '-'}
        <div class="sep"></div>
      {:else}
        <button class={item.danger ? 'danger' : ''} onclick={() => { hideMenu(); item.run(); }}><span>{item.label}</span>{#if item.hint}<span class="hint">{item.hint}</span>{/if}</button>
      {/if}
    {/each}
  {/if}
</div>
