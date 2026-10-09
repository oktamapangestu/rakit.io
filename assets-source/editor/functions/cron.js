// Jadwal fungsi (cron, WIB).
export const FN_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
export const pad2 = (n) => String(n).padStart(2, '0');

// Jadwal cron (WIB) dalam kalimat, untuk bentuk yang dibuat dialog Jadwal; selain itu ekspresinya.
export function describeCron(c) {
  let m;
  if ((m = /^\*\/(\d+) \* \* \* \*$/.exec(c))) return `setiap ${m[1]} menit`;
  if (c === '0 * * * *') return 'setiap jam';
  if ((m = /^(\d+) (\d+) \* \* \*$/.exec(c))) return `setiap hari ${pad2(m[2])}.${pad2(m[1])}`;
  if ((m = /^(\d+) (\d+) \* \* ([0-7])$/.exec(c))) return `setiap ${FN_DAYS[m[3]]} ${pad2(m[2])}.${pad2(m[1])}`;
  return c;
}
