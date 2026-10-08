// Komponen Alpine.js (https://alpinejs.dev): dipakai di HTML dengan x-data="penghitung".
document.addEventListener('alpine:init', () => {
  Alpine.data('penghitung', () => ({
    klik: 0,
  }));
});
