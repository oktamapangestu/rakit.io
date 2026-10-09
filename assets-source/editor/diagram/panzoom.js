// Zoom & geser kanvas diagram (action Svelte: use:panZoom). Mouse: scroll = zoom di posisi kursor, seret = geser.
// Touchpad: cubit = zoom, dua jari = geser. Layar sentuh: cubit & seret. Keyboard (kanvas difokus): + − 0 1 dan panah.
// Logikanya sama persis dengan versi vanilla sebelumnya (bindCanvasGestures di editor.js).
import { diagram, zoomAt, zoomAtCenter, panBy, fitDiagram, actualSize } from './state.svelte.js';

// Scroll dari touchpad (dua jari) datang sebagai banyak event kecil, sering dengan deltaX; roda mouse sebagai
// lompatan besar per "klik". Setelah terdeteksi touchpad, anggap tetap touchpad selama gerakan berlangsung.
let lastTrackpadAt = 0;
function isTrackpadScroll(e) {
  const now = performance.now();
  const looks = e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 40 || !Number.isInteger(e.deltaY));
  if (looks) lastTrackpadAt = now;
  return now - lastTrackpadAt < 300;
}

export function panZoom(canvas) {
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const hasStage = () => Boolean(canvas.querySelector('.diagram-stage'));
  const off = [];
  const on = (type, fn, opts) => {
    canvas.addEventListener(type, fn, opts);
    off.push(() => canvas.removeEventListener(type, fn, opts));
  };

  on('wheel', (e) => {
    if (!hasStage()) return;
    e.preventDefault();
    const [cx, cy] = point(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // Cubit di touchpad (browser mengirimnya sebagai wheel + ctrlKey) atau Ctrl/⌘ + scroll.
      zoomAt(Math.exp(-dy * 0.01), cx, cy);
    } else if (isTrackpadScroll(e)) {
      panBy(-dx, -dy);
    } else if (e.shiftKey) {
      panBy(-(dx || dy), 0);
    } else {
      zoomAt(Math.exp(-dy * 0.002), cx, cy);
    }
  }, { passive: false });

  // Safari (macOS) mengirim cubit touchpad sebagai gesture event.
  let gestureZoom = 1;
  on('gesturestart', (e) => { e.preventDefault(); gestureZoom = diagram.view.z; });
  on('gesturechange', (e) => {
    e.preventDefault();
    const [cx, cy] = point(e);
    zoomAt((gestureZoom * e.scale) / diagram.view.z, cx, cy);
  });

  // Seret dengan mouse / satu jari = geser; dua jari di layar sentuh = cubit (zoom) sambil geser.
  const pointers = new Map();
  let pinch = null;
  on('pointerdown', (e) => {
    if (!hasStage() || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('a, button')) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, point(e));
    canvas.classList.add('panning');
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    }
  });
  on('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const now = point(e);
    pointers.set(e.pointerId, now);
    if (pointers.size === 1) {
      panBy(now[0] - prev[0], now[1] - prev[1]);
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      panBy(mid[0] - pinch.mid[0], mid[1] - pinch.mid[1]);
      if (pinch.dist > 0) zoomAt(dist / pinch.dist, mid[0], mid[1]);
      pinch = { dist, mid };
    }
  });
  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) canvas.classList.remove('panning');
  };
  on('pointerup', release);
  on('pointercancel', release);

  on('dblclick', (e) => {
    if (!hasStage()) return;
    const [cx, cy] = point(e);
    zoomAt(e.shiftKey ? 1 / 1.6 : 1.6, cx, cy);
  });

  on('keydown', (e) => {
    if (!hasStage() || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? 180 : 60;
    const keys = {
      '+': () => zoomAtCenter(1.25), '=': () => zoomAtCenter(1.25), '-': () => zoomAtCenter(1 / 1.25),
      0: fitDiagram, 1: actualSize,
      ArrowLeft: () => panBy(step, 0), ArrowRight: () => panBy(-step, 0), ArrowUp: () => panBy(0, step), ArrowDown: () => panBy(0, -step),
    };
    if (!keys[e.key]) return;
    e.preventDefault();
    keys[e.key]();
  });

  // Ukuran panel berubah (geser splitter, buka/tutup Temuan): pas-kan ulang selama user belum zoom/geser.
  const resize = new ResizeObserver(() => { if (!diagram.view.touched && hasStage()) fitDiagram(); });
  resize.observe(canvas);

  return {
    destroy() {
      off.forEach((f) => f());
      resize.disconnect();
    },
  };
}
