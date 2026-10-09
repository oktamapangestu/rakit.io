<!-- Pilihan tipe kolom. -->
<script>
  import { DB_TYPES } from './types.js';

  let { value = $bindable('text') } = $props();
</script>

<select bind:value>
  {#each Object.entries(DB_TYPES) as [v, label] (v)}<option value={v}>{label}</option>{/each}
</select>
