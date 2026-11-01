// CHA-01 Designer: Sichtprüfung der Tokens von Kleiderkammer, Startmenü und Namensmarke (public/kammer-preview.html), ohne Server (file://).
// Bilder nach shots/kammer (bzw. --shots <Ordner>): <skin>-<id>.png je Bild in 1280×720 (Spielraster 640×360 doppelt).
// Skin rom: alle sieben Bilder; Skin germanen: nur die drei Pult-Bilder (Startmenü und Namensmarke haben keinen Skin).
// Aufruf: node tools/sicht-kammer.js [--shots <Ordner>]   Exit 1 bei Seitenfehlern, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SHOTS = path.resolve(ROOT, arg('shots', 'shots/kammer'));
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.log('Playwright fehlt'); process.exit(2); }
const { chromium } = playwright();

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch();
  const fehler = [];
  try {
    const page = await (await b.newContext({ viewport: { width: 1340, height: 900 } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    // art.js lädt Bühnendaten per fetch; unter file:// geht das nicht und ist für die Zeichnung egal
    page.on('console', (m) => { if (m.type() === 'error' && !/Fetch API cannot load file|ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) fehler.push('console: ' + m.text().slice(0, 200)); });
    page.on('requestfailed', (r) => { if (/\.(png|jpg)$/.test(r.url())) fehler.push('Bild fehlt: ' + r.url()); });
    for (const skin of ['rom', 'germanen']) {
      await page.goto(pathToFileURL(path.join(ROOT, 'public', 'kammer-preview.html')).href + '?pult=' + skin);
      await page.waitForFunction(() => window.__fertig === true, null, { timeout: 15000 });
      const ids = skin === 'rom' ? ['k1', 'k2', 'k3', 'm1', 'm2', 'm3', 'n1'] : ['k1', 'k2', 'k3'];
      for (const id of ids) {
        await page.locator('#' + id).screenshot({ path: path.join(SHOTS, `${skin}-${id}.png`) });
        console.log('Bild', `${skin}-${id}`);
      }
    }
  } finally {
    await b.close();
  }
  if (fehler.length) { console.log('Fehler:\n' + [...new Set(fehler)].join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
