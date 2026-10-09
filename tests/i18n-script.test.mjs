// Uji penerjemah aset (scripts/i18n.mjs) tanpa server: teks Indonesia di kode → teks Inggris dari kamus.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { translateJS } from '../scripts/i18n.mjs';

const report = () => ({ used: new Set(), missing: new Set(), errors: [] });
const run = (code, scope) => new Function(...Object.keys(scope), `return ${code}`)(...Object.values(scope));

test('template literal diterjemahkan, isi ${...} tetap', () => {
  const r = report();
  const out = translateJS('const s = `Sisa ${n} kredit`;', { 'Sisa ${n} kredit': '${n} credits left' }, r);
  assert.equal(out, 'const s = `${n} credits left`;');
  assert.deepEqual(r.errors, []);
});

test('bentuk jamak: {tunggal|jamak} mengikuti angka placeholder sebelumnya', () => {
  const r = report();
  const dict = {
    '${n} kredit': '${n} {credit|credits}',
    '${a} dari ${b} baris': '${a} of ${b} {row|rows}',
    '${n} hal perlu diperhatikan': '${n} {thing needs|things need} attention',
  };
  const credit = translateJS('`${n} kredit`', dict, r);
  assert.equal(run(credit, { n: 1 }), '1 credit');
  assert.equal(run(credit, { n: 2 }), '2 credits');
  assert.equal(run(credit, { n: '1' }), '1 credit', 'angka berupa teks juga');
  assert.equal(run(credit, { n: 0 }), '0 credits');
  const rows = translateJS('`${a} dari ${b} baris`', dict, r);
  assert.equal(run(rows, { a: 3, b: 1 }), '3 of 1 row', 'memakai placeholder tepat sebelumnya');
  assert.equal(run(translateJS('`${n} hal perlu diperhatikan`', dict, r), { n: 1 }), '1 thing needs attention');
  assert.deepEqual(r.errors, []);
});

test('placeholder terjemahan harus sama dengan aslinya', () => {
  const r = report();
  translateJS('`Sisa ${n} kredit`', { 'Sisa ${n} kredit': '${m} credits left' }, r);
  assert.equal(r.errors.length, 1);
});
