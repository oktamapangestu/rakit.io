// Keadaan kerangka editor (App.svelte): tab mode yang aktif, panel yang tampil, status simpan & kursor, status
// publikasi. Diubah editor.js; tampilan mengikuti.
export const ui = $state({
  mode: 'ai', // code | ai | data | diagram | fn | history | console
  sidebarHidden: false,
  previewHidden: false,
  layout: 'coding', // simple | coding (juga di body[data-layout])
  mobileView: 'editor', // files | editor | preview (juga di body[data-mobile-view])
  layoutAttention: false, // tombol Simple/Coding disorot sampai pertama kali dipakai
  save: { text: '', kind: '' },
  cursor: '',
  lang: '',
  pubStatus: null, // hasil GET /api/publish (publikasi manual)
});

// Menu konteks (ContextMenu.svelte): null = tertutup.
// { x, y, items: [{ label, hint?, danger?, run } | '-'], align: 'left' | 'right', label?: { title, sub }, wide? }
// align 'right': x adalah tepi kanan menu (mis. tepi kanan tombol "⋯").
export const menu = $state({ current: null });

export function showMenu(x, y, items, { align = 'left', label = null, wide = false } = {}) {
  menu.current = { x, y, items: items.filter(Boolean), align, label, wide };
}

export function hideMenu() {
  menu.current = null;
}

// Notifikasi singkat di bawah layar (error tampil lebih lama).
export const toasts = $state([]);
let toastId = 0;

export function toast(message, type = 'info') {
  const id = ++toastId;
  toasts.push({ id, message, type });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, type === 'error' ? 6000 : 3000);
}
