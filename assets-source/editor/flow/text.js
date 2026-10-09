// Label & diagram Baca Alur Kode.
export const FLOW_KINDS = {
  start: 'Mulai', input: 'Masukan', process: 'Proses', decision: 'Keputusan', loop: 'Perulangan',
  function: 'Fungsi', event: 'Menunggu aksi', request: 'Permintaan', output: 'Hasil', end: 'Selesai',
};
export const FLOW_NOTE = { bug: ['✕', 'Bug'], warn: ['!', 'Perlu dicek'], tip: ['✦', 'Saran'], info: ['i', 'Info'] };
export const lineLabel = (lines) => lines.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');

// Diagram alur (Mermaid dari langkah, bukan dari AI — jadi selalu valid).
export function flowChartCode(steps) {
  const label = (s) => `${s.id}. ${s.title}`.replace(/["`]/g, "'").replace(/[<>#;{}[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
  const shape = (s) => {
    const t = label(s);
    switch (s.kind) {
      case 'start': case 'end': return `(["${t}"])`;
      case 'decision': return `{"${t}"}`;
      case 'loop': return `{{"${t}"}}`;
      case 'function': return `[["${t}"]]`;
      case 'input': case 'output': case 'request': return `[/"${t}"/]`;
      case 'event': return `>"${t}"]`;
      default: return `["${t}"]`;
    }
  };
  const lines = ['flowchart TD'];
  steps.forEach((s) => lines.push(`  S${s.id}${shape(s)}`));
  steps.forEach((s, i) => {
    if (s.next.length) {
      for (const e of s.next) {
        const text = e.label.replace(/["`|<>#;]/g, ' ').trim();
        lines.push(text ? `  S${s.id} -->|"${text}"| S${e.to}` : `  S${s.id} --> S${e.to}`);
      }
    } else if (i < steps.length - 1 && s.kind !== 'end') {
      lines.push(`  S${s.id} --> S${steps[i + 1].id}`);
    }
  });
  return lines.join('\n');
}
