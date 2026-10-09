// Pembatas (splitter) yang bisa diseret untuk mengubah lebar panel file (#sidebar) atau preview (#preview).
// Attachment Svelte: {@attach splitter} pada .splitter[data-target]. Lebar diingat per browser (rakit.widths).
const KEY = 'rakit.widths';
const readWidths = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
};

export function splitter(node) {
  const target = document.getElementById(node.dataset.target);
  const widths = readWidths();
  if (widths[node.dataset.target]) target.style.width = `${widths[node.dataset.target]}px`;

  const onDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Lapisan transparan di atas semua elemen (termasuk iframe preview & Monaco) selama drag:
    // kursor tetap col-resize dan semua gerakan mouse tertangkap di dokumen ini.
    const overlay = Object.assign(document.createElement('div'), { className: 'resize-overlay' });
    document.body.append(overlay);
    node.classList.add('dragging');

    const onMove = (ev) => {
      if (ev.buttons === 0) return end(); // tombol sudah dilepas di luar jangkauan (mis. di luar jendela)
      const rect = target.getBoundingClientRect();
      const width = node.dataset.target === 'sidebar'
        ? Math.min(Math.max(ev.clientX - rect.left, 160), 600)
        : Math.min(Math.max(rect.right - ev.clientX, 240), innerWidth - 480);
      target.style.width = `${width}px`;
    };
    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      overlay.remove();
      node.classList.remove('dragging');
      try {
        localStorage.setItem(KEY, JSON.stringify({
          sidebar: document.getElementById('sidebar').getBoundingClientRect().width || widths.sidebar,
          preview: document.getElementById('preview').getBoundingClientRect().width || widths.preview,
        }));
      } catch { /* abaikan */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
  };
  node.addEventListener('pointerdown', onDown);
  return () => node.removeEventListener('pointerdown', onDown);
}
