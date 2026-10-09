// Bundel satu skrip frontend (assets-source/js/<file>.js) beserta modul & komponen Svelte yang diimpornya
// (assets-source/editor/...) menjadi satu file IIFE ter-minify di public/js. Dipakai build-assets.sh (versi
// Indonesia) dan scripts/i18n.mjs (versi Inggris: teks diterjemahkan sebelum dikompilasi, lewat `translate`).
//
// Pemakaian: node scripts/bundle.mjs <entry.js> <outfile.js>
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'assets-source') + path.sep;

// translate: { js(src, file), svelte(src, file) } -> sumber yang sudah diterjemahkan (hanya untuk file di
// assets-source/, bukan node_modules). write = false: hanya memeriksa (i18n check/extract).
export async function bundle(entry, outfile, { translate = null, write = true } = {}) {
  const plugins = [{
    name: 'rakit',
    setup(b) {
      b.onLoad({ filter: /\.svelte$/ }, async (args) => {
        let source = await fs.readFile(args.path, 'utf8');
        if (translate && args.path.startsWith(SOURCE)) source = translate.svelte(source, args.path);
        const { js, warnings } = compile(source, { filename: path.relative(ROOT, args.path), generate: 'client', css: 'injected' });
        return {
          contents: js.code,
          loader: 'js',
          resolveDir: path.dirname(args.path),
          warnings: warnings.map((w) => ({
            text: `${w.code}: ${w.message}`,
            location: w.start && { file: args.path, line: w.start.line, column: w.start.column, lineText: source.split('\n')[w.start.line - 1] },
          })),
        };
      });
      if (translate) {
        b.onLoad({ filter: /\.js$/ }, async (args) => {
          if (!args.path.startsWith(SOURCE)) return undefined;
          return { contents: translate.js(await fs.readFile(args.path, 'utf8'), args.path), loader: 'js' };
        });
      }
    },
  }];
  return build({
    entryPoints: [entry],
    outfile,
    write,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    conditions: ['svelte', 'browser', 'production'], // production: kode khusus mode dev Svelte dibuang
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
    plugins,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [entry, outfile] = process.argv.slice(2);
  if (!entry || !outfile) {
    console.error('Pemakaian: node scripts/bundle.mjs <entry.js> <outfile.js>');
    process.exit(2);
  }
  await bundle(entry, outfile).catch(() => process.exit(1));
}
