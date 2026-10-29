// SUND-04b D (Designer): Sichtprüfung der Auftragsbrett-Tokens (public/auftrag-preview.html), ohne Server (file://).
// Bilder nach shots/auftrag (bzw. --shots <Ordner>): <zustand>-desktop.png (Canvas 1280×720, doppelt) und <zustand>-schmal.png (Fenster 760 breit, Canvas ~1,1-fach).
// Aufruf: node tools/sicht-auftrag.js [--shots <Ordner>] [--seite <html>]   Exit 1 bei Seitenfehlern, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SHOTS = path.resolve(ROOT, arg('shots', 'shots/auftrag'));
const SEITE = path.resolve(ROOT, arg('seite', 'public/auftrag-preview.html'));
const ZUSTAENDE = ['drei', 'ger', 'rom', 'eins', 'leer', 'laeuft', 'gesperrt', 'hud'];
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.log('Playwright fehlt'); process.exit(2); }
const { chromium } = playwright();

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch();
  const fehler = [];
  try {
    for (const [name, breite] of [['desktop', 1320], ['schmal', 760]]) {
      const page = await (await b.newContext({ viewport: { width: breite, height: 900 } })).newPage();
      page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/Fetch API cannot load file|ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) fehler.push('console: ' + m.text().slice(0, 200)); });
      await page.goto(pathToFileURL(SEITE).href);
      await page.waitForFunction(() => window.__fertig === true, null, { timeout: 15000 }).catch(() => fehler.push('Seite nicht fertig'));
      for (const z of ZUSTAENDE) {
        const loc = page.locator('#c-' + z);
        if (!(await loc.count())) continue;
        await loc.screenshot({ path: path.join(SHOTS, `${z}-${name}.png`) });
        console.log('Bild', `${z}-${name}`);
      }
      await page.close();
    }
  } finally {
    await b.close();
  }
  if (fehler.length) { console.log('Fehler:\n' + [...new Set(fehler)].join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
