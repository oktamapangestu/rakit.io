// Markdown sederhana untuk jawaban AI & Baca Alur Kode.
// h(): elemen DOM kecil (sama dengan h() di editor.js).
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) el.append(child);
  return el;
}

// Markdown sederhana (judul, list, **tebal**, `kode`, blok kode) dirender lewat DOM, tanpa innerHTML.
function inlineMd(text) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => {
    if (part.startsWith('`') && part.endsWith('`')) return h('code', {}, part.slice(1, -1));
    if (part.startsWith('**') && part.endsWith('**')) return h('strong', {}, part.slice(2, -2));
    return part;
  });
}

export function renderMarkdown(text) {
  const out = h('div', { class: 'md' });
  const lines = text.split('\n');
  let list = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      out.append(h('pre', {}, h('code', {}, code.join('\n'))));
      list = null;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells); // lewati baris pemisah |---|
      }
      i--;
      if (!rows.length) continue;
      const [headRow, ...bodyRows] = rows;
      out.append(h('div', { class: 'md-table' }, h('table', {},
        h('thead', {}, h('tr', {}, headRow.map((c) => h('th', {}, inlineMd(c))))),
        h('tbody', {}, bodyRows.map((r) => h('tr', {}, r.map((c) => h('td', {}, inlineMd(c)))))))));
      list = null;
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)/);
    const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (heading) {
      out.append(h('p', { class: 'md-h' }, inlineMd(heading[1])));
      list = null;
    } else if (item) {
      if (!list) out.append((list = h('ul')));
      list.append(h('li', {}, inlineMd(item[1])));
    } else if (line.trim()) {
      out.append(h('p', {}, inlineMd(line)));
      list = null;
    } else {
      list = null;
    }
  }
  return out;
}
