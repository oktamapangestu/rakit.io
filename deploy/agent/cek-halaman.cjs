#!/usr/bin/env node
// cek-halaman [/path.html ...] [--shot file.png]: buka halaman website project di Chromium headless dan laporkan
// error JavaScript, error Alpine, request yang gagal, dan file yang tidak ditemukan. Dipakai model lewat bash.
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const shotAt = args.indexOf('--shot');
const shot = shotAt >= 0 ? args.splice(shotAt, 2)[1] : null;
const paths = args.length ? args : ['/'];
const origin = 'http://localhost'; // website project (lihat proxy.cjs)

// Batas waktu keseluruhan: perintah ini dipakai model lewat shell, jadi tidak boleh pernah menggantung.
setTimeout(() => {
  console.log('cek-halaman: berhenti setelah 90 detik (halaman tidak selesai dimuat)');
  process.exit(2);
}, 90_000);

(async () => {
  const browser = await chromium.launch();
  let problems = 0;
  for (const p of paths) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const lines = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || (m.type() === 'warning' && /alpine/i.test(m.text()))) lines.push(`console.${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => lines.push(`error JavaScript: ${e.message}`));
    page.on('requestfailed', (r) => lines.push(`request gagal: ${r.method()} ${r.url()} (${r.failure()?.errorText})`));
    page.on('response', (r) => { if (r.status() >= 400) lines.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`); });
    const url = origin + (p.startsWith('/') ? p : `/${p}`);
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
      await page.waitForTimeout(500);
      if (!res || res.status() >= 400) lines.unshift(`halaman ${url} → HTTP ${res?.status()}`);
      if (shot) await page.screenshot({ path: paths.length > 1 ? shot.replace(/(\.png)?$/, `-${paths.indexOf(p)}.png`) : shot, fullPage: true });
    } catch (e) {
      lines.push(`gagal membuka ${url}: ${e.message.split('\n')[0]}`);
    }
    problems += lines.length;
    console.log(`${url}: ${lines.length ? `${lines.length} masalah` : 'tidak ada error'}`);
    for (const l of [...new Set(lines)]) console.log(`  - ${l}`);
    await page.close();
  }
  await browser.close();
  process.exit(problems ? 1 : 0);
})();
