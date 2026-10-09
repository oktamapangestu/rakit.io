<!-- Tombol berbahaya dengan konfirmasi dua kali klik (klik kedua dalam 3 detik). -->
<script>
  import { onDestroy } from 'svelte';

  let { label, onConfirm } = $props();
  let armed = $state(false);
  let timer;

  function click() {
    if (armed) {
      clearTimeout(timer);
      onConfirm();
      return;
    }
    armed = true;
    timer = setTimeout(() => { armed = false; }, 3000);
  }
  onDestroy(() => clearTimeout(timer));
</script>

<button type="button" class="db-danger" onclick={click}>{armed ? 'Klik lagi untuk yakin' : label}</button>
