<!-- Kepala section tab Fungsi: judul (+ jumlah) di kiri, kontrol (children) di kanan. -->
<script>
  let { title, count = null, children } = $props();
</script>

<div class="fn-section-head">
  <h4>{title}{#if count != null}<span class="fn-count">{count}</span>{/if}</h4>
  {@render children?.()}
</div>
