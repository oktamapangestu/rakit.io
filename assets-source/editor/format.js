// Format uang & tanggal untuk antarmuka editor. Versi Inggris: scripts/i18n.mjs mengganti 'id-ID' dengan 'en-US'.
export const rupiah = (n) => `Rp${n.toLocaleString('id-ID')}`;
export const shortDate = (iso) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
