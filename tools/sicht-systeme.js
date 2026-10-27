// SYS-01 Designer: Sichtprüfung der Systemanzeige-Tokens (public/systeme-preview.html) in beiden Skins, ohne Server (file://).
// Bilder nach shots/systeme (bzw. --shots <Ordner>): <skin>-<n>.png je Canvas in Originalgröße 640×360 und doppelt.
// Aufruf: node tools/sicht-systeme.js [--shots <Ordner>]   Exit 1 bei Seitenfehlern, 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SHOTS = path.resolve(ROOT, arg('shots', 'shots/systeme'));
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.log('Playwright fehlt'); process.exit(2); }
const { chromium } = playwright();

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch();
  const fehler = [];
  try {
    const page = await (await b.newContext({ viewport: { width: 1320, height: 900 } })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    // art.js lädt Bühnendaten per fetch; unter file:// geht das nicht und ist für die Pult-Zeichnung egal
    page.on('console', (m) => { if (m.type() === 'error' && !/Fetch API cannot load file|ERR_FILE_NOT_FOUND/.test(m.text())) fehler.push('console: ' + m.text().slice(0, 200)); });
    for (const skin of ['rom', 'germanen']) {
      await page.goto(pathToFileURL(path.join(ROOT, 'public', 'systeme-preview.html')).href + '?pult=' + skin);
      await page.waitForFunction(() => window.__fertig === true, null, { timeout: 15000 });
      for (const id of ['c1', 'c2', 'c3']) {
        await page.locator('#' + id).screenshot({ path: path.join(SHOTS, `${skin}-${id}.png`) });
        console.log('Bild', `${skin}-${id}`);
      }
    }
  } finally {
    await b.close();
  }
  if (fehler.length) { console.log('Fehler:\n' + [...new Set(fehler)].join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
