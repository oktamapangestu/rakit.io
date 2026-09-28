import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { compileScript, compileStyle, compileTemplate, parse } from '@vue/compiler-sfc';

// Kompilasi Single File Component (.vue) menjadi modul JavaScript saat file diminta browser.
// "vue" diimpor sebagai bare specifier; index.html project memetakannya ke Vue dari CDN lewat importmap
// dengan versi yang sama persis seperti compiler ini.

const require = createRequire(import.meta.url);
export const VUE_VERSION = require('@vue/compiler-sfc/package.json').version;
export const vueRuntimeUrl = `https://cdn.jsdelivr.net/npm/vue@${VUE_VERSION}/dist/vue.esm-browser.prod.js`;

const cache = new Map(); // `${slug}:${path}:${mtime}:${size}` -> kode hasil kompilasi
const CACHE_MAX = 300;

class SfcError extends Error {}

// Pesan error compiler beserta nomor barisnya (bila ada).
const describe = (errors) => errors
  .map((e) => (typeof e === 'string' ? e : `${e.loc?.start?.line ? `baris ${e.loc.start.line}: ` : ''}${e.message}`))
  .join('\n');

function compile(source, filename) {
  const id = crypto.createHash('sha256').update(filename).digest('hex').slice(0, 8);
  const scopeId = `data-v-${id}`;
  const { descriptor, errors } = parse(source, { filename });
  if (errors.length) throw new SfcError(describe(errors));

  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
    if (block.lang && block.lang !== 'js') throw new SfcError(`<script lang="${block.lang}"> belum didukung. Pakai JavaScript biasa.`);
  }
  for (const style of descriptor.styles) {
    if (style.lang && style.lang !== 'css') throw new SfcError(`<style lang="${style.lang}"> belum didukung. Pakai CSS biasa.`);
  }
  if (descriptor.template?.lang && descriptor.template.lang !== 'html') throw new SfcError(`<template lang="${descriptor.template.lang}"> belum didukung.`);

  const scoped = descriptor.styles.some((s) => s.scoped);
  const templateOptions = { scoped, compilerOptions: { scopeId: scoped ? scopeId : undefined } };
  let code = '';

  if (descriptor.script || descriptor.scriptSetup) {
    // <script setup> menyertakan template langsung di fungsi setup (inlineTemplate).
    const script = compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: '__sfc__', templateOptions });
    code += `${script.content}\n`;
  } else {
    code += 'const __sfc__ = {};\n';
  }
  if (descriptor.template && !descriptor.scriptSetup) {
    const template = compileTemplate({ source: descriptor.template.content, filename, id, ...templateOptions });
    if (template.errors.length) throw new SfcError(describe(template.errors));
    code += `\n${template.code.replace(/export function render/, 'function render')}\n__sfc__.render = render;\n`;
  }
  if (scoped) code += `__sfc__.__scopeId = ${JSON.stringify(scopeId)};\n`;
  code += `__sfc__.__file = ${JSON.stringify(filename)};\n`;

  const css = descriptor.styles.map((style) => {
    const result = compileStyle({ source: style.content, filename, id: scopeId, scoped: style.scoped });
    if (result.errors.length) throw new SfcError(describe(result.errors));
    return result.code;
  }).join('\n');
  if (css) {
    code += `
{
  const id = ${JSON.stringify(`vue-${id}`)};
  const el = document.getElementById(id) ?? document.head.appendChild(Object.assign(document.createElement('style'), { id }));
  el.textContent = ${JSON.stringify(css)};
}
`;
  }
  return `${code}\nexport default __sfc__;\n`;
}

// Modul pengganti bila kompilasi gagal: tampilkan error di halaman supaya jelas file & barisnya.
// Tetap mengekspor komponen kosong, karena import tanpa `export default` membuat seluruh aplikasi gagal dimuat.
function errorModule(filename, message) {
  const text = `Gagal memuat ${filename}:\n${message}`;
  return `
const text = ${JSON.stringify(text)};
console.error(text);
const box = document.createElement('pre');
box.textContent = text;
box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;margin:0;padding:14px 16px;'
  + 'max-height:45vh;overflow:auto;background:#2b0d12;color:#fecaca;border:1px solid #f87171;border-radius:10px;'
  + 'font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;box-shadow:0 10px 30px rgba(0,0,0,.4)';
document.body.appendChild(box);
export default { name: 'KomponenGagal', render: () => null };
`;
}

/** Pesan error kompilasi file .vue, atau null bila valid (dipakai untuk memeriksa hasil AI). */
export function sfcError(source, filename) {
  try {
    compile(source, filename);
    return null;
  } catch (err) {
    return err.message;
  }
}

/** Kembalikan kode JS untuk file .vue (dengan cache berdasarkan waktu ubah & ukuran file). */
export function compileVueFile({ slug, path, source, mtimeMs, size }) {
  const key = `${slug}:${path}:${mtimeMs}:${size}`;
  if (cache.has(key)) return cache.get(key);
  let code;
  try {
    code = compile(source, path);
  } catch (err) {
    code = errorModule(path, err.message);
  }
  cache.set(key, code);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return code;
}
