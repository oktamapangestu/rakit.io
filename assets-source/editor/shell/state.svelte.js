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
