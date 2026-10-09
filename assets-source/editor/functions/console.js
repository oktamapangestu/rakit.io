// Keluaran console fungsi: baris berawalan "[warn] ", "[error] " dst. (lihat go/internal/fn/prelude.js) memulai
// entri berlevel; baris lanjutan (mis. JSON bertingkat) ikut level entri sebelumnya.
export const LOG_LEVEL_RE = /^\[(info|warn|error|debug)\] /;

// consoleLines: [{ level, tag (level yang ditulis di baris itu, bila ada), text }] per baris.
export function consoleLines(text) {
  let level = 'log';
  return text.replace(/\n$/, '').split('\n').map((line) => {
    const m = LOG_LEVEL_RE.exec(line);
    if (m) level = m[1];
    else if (!/^\s/.test(line) && !/^[}\]]/.test(line)) level = 'log';
    return { level, tag: m?.[1], text: m ? line.slice(m[0].length) : line || ' ' };
  });
}
