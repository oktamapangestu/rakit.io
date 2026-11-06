<!-- Pernyataan soal API key pengguna (tab Provider AI dan dialog tambah/ubah provider). editor: untuk AI pribadi editor. -->
<script>
  let { editor = false } = $props();
</script>

<div class="ai-disclaimer" role="note">
  {#if editor}
    <strong>🔒 API key-mu tetap milikmu.</strong> rakit.io hanya memakai key ini untuk meneruskan prompt AI editor milikmu sendiri ke provider yang kamu pilih. Key tidak pernah dikirim balik ke browser, dan dihapus dari database rakit.io saat AI pribadi dihapus. Sebagai pengaman tambahan, pasang batas pemakaian (spending limit) di dashboard provider.
  {:else}
    <strong>🔒 API key-mu tetap milikmu.</strong> rakit.io tidak akan mengambil, membagikan, atau memakai API key dan token AI-mu untuk keperluan apa pun selain meneruskan panggilan <code>ai.*</code> dari fungsimu sendiri ke provider yang kamu pilih. Key tidak pernah dikirim ke browser maupun ke kode fungsi, dan dihapus dari database rakit.io saat provider dihapus. Sebagai pengaman tambahan, pasang batas pemakaian (spending limit) di dashboard provider dan ganti key bila curiga bocor.
  {/if}
</div>
