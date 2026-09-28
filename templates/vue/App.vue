<script setup>
import { ref } from 'vue';
import KartuFitur from './components/KartuFitur.vue';

const klik = ref(0);
const fitur = [
  { judul: 'Komponen .vue', isi: 'Tulis <script setup>, <template>, dan <style scoped> seperti biasa.' },
  { judul: 'Tanpa build', isi: 'rakit.icu mengompilasi file .vue otomatis saat halaman dibuka.' },
  { judul: 'Database siap pakai', isi: 'Buat tabel di tab Data, lalu simpan dan baca datanya dari komponen.' },
];
</script>

<template>
  <main class="halaman">
    <p class="host">{{host}}</p>
    <h1>Halo dari Vue 👋</h1>
    <p class="intro">Ubah <code>App.vue</code> atau <code>components/KartuFitur.vue</code>, lalu lihat hasilnya di preview.</p>

    <div class="grid">
      <KartuFitur v-for="f in fitur" :key="f.judul" :judul="f.judul" :isi="f.isi" />
    </div>

    <button @click="klik++">Kamu sudah klik {{ klik }} kali</button>
  </main>
</template>

<style scoped>
.halaman {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 20px;
}

.host {
  margin: 0;
  color: #42b883;
  font-family: ui-monospace, Menlo, monospace;
}

h1 {
  margin: 8px 0 12px;
}

.intro {
  color: #4b5563;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin: 24px 0;
}

button {
  padding: 10px 18px;
  border: 0;
  border-radius: 8px;
  background: #42b883;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

button:hover {
  background: #33a06f;
}
</style>
