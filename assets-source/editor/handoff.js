// Jembatan dari fitur lain (fungsi, database, diagram, Baca Alur Kode, editor) ke panel AI: teks permintaan
// beserta konteksnya. Log/kode panjang dipotong.
export const clipText = (text, max = 1500) => {
  const t = String(text ?? '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

// Permintaan perbaikan untuk eksekusi fungsi yang gagal (dari log atau uji coba).
export function fnFixPrompt(name, { status, error, logs, trigger, request }) {
  const info = [status ? `status ${status}` : '', trigger ? `dipicu ${trigger}` : ''].filter(Boolean).join(', ');
  const parts = [`Fungsi functions/${name}.js gagal${info ? ` (${info})` : ''}. Cari penyebabnya dan perbaiki kodenya.`];
  if (request) parts.push(`Request:\n${request}`);
  if (error) parts.push(`Error:\n${clipText(error)}`);
  if (logs) parts.push(`console:\n${clipText(logs)}`);
  return parts.join('\n\n');
}
