// Alpine.js component (https://alpinejs.dev): used in the HTML with x-data="counter".
document.addEventListener('alpine:init', () => {
  Alpine.data('counter', () => ({
    clicks: 0,
  }));
});
