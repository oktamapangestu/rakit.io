<script setup>
defineProps({
  judul: { type: String, required: true },
  isi: { type: String, default: '' },
});
</script>

<template>
  <article class="kartu">
    <h3>{{ judul }}</h3>
    <p>{{ isi }}</p>
  </article>
</template>

<style scoped>
.kartu {
  padding: 16px;
  border: 1px solid #d1fae5;
  border-radius: 12px;
  background: #fff;
}

h3 {
  margin: 0 0 6px;
  font-size: 16px;
}

p {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}
</style>
