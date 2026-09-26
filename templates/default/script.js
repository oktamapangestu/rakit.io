const button = document.getElementById('btn');
const count = document.getElementById('count');
let clicks = 0;

button.addEventListener('click', () => {
  clicks++;
  count.textContent = `Kamu sudah klik ${clicks} kali 🎉`;
});
