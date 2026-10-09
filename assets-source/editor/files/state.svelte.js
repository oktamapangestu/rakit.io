// Keadaan inti editor (project, file, tab), reaktif supaya pohon file, tab, dan breadcrumb (komponen di folder ini)
// mengikuti perubahan dari editor.js. Model Monaco & antrean simpan disimpan di sini juga, tapi sebagai Map biasa
// (tidak reaktif).
import { SvelteSet } from 'svelte/reactivity';

export const core = $state({
  me: null,
  project: null,
  projects: [],
  projectSlug: null,
  maxProjects: 0,
  entries: [],
  usage: null, // { size, entries, limits } dari GET /api/files
  limits: null,
  expanded: new SvelteSet(),
  selected: null,
  tabs: [],
  active: null,
  dirty: new SvelteSet(), // file yang isinya berbeda dari versi tersimpan
  dropDir: null, // folder tujuan saat gambar diseret ke pohon file ('' = akar)
  models: new Map(), // path -> monaco model
  saved: new Map(), // path -> isi terakhir yang tersimpan di server
  viewStates: new Map(),
  saveTimers: new Map(),
  saveChains: new Map(),
  previewPath: 'index.html',
  previewRoute: null, // alamat yang diketik user di bar preview (path + ?query + #hash); null = ikuti previewPath
  autosave: true,
});
