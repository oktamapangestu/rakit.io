// Alamat tanpa protokol, untuk ditampilkan: https://budi.rakit.io -> budi.rakit.io.
export const hostOf = (url) => url.replace(/^https?:\/\//, '');
