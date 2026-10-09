<!-- Daftar tabel di sidebar tab Data (#dbTableList). -->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import { db, select } from './state.svelte.js';

  const { icons } = getContext('editor');
</script>

{#each db.tables as t (t.name)}
  <button type="button" class="db-table-item" class:active={t.name === db.active} onclick={() => select(t.name)}>
    <Icon d={icons.table} /><span class="name">{t.name}</span><span class="count">{t.rowCount}</span>
  </button>
{:else}
  <div class="db-empty-list">Belum ada tabel</div>
{/each}
