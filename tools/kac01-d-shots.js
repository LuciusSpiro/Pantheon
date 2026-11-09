// KAC-01 D: Bild der Sternkarte der Testkarte (tools/fixtures/kacheln/testkarte.json) im Headless-Browser (Playwright/Chromium).
// Ohne Paket C (Katalog im Client) läuft kein echtes Spiel auf der Testkarte; deshalb setzt dieses Werkzeug die echten Zeichenfunktionen zusammen:
// IconsB.hexFlaeche/kante und Kartenzeichen.symbol/hauptIcon/typName (dieselben Aufrufe wie public/js/starmap.js), darunter die sieben Planetenarten
// aus KulisseKugel. Aufruf: node tools/kac01-d-shots.js [--shots <Ordner>]   (Standard shots/kac01-d, von Git ignoriert)   Exit 2 ohne Playwright.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SHOTS = path.resolve(arg('shots', path.join(ROOT, 'shots', 'kac01-d')));
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden (PLAYWRIGHT_CORE setzen)'); process.exit(2); }
const { chromium } = playwright();

const karte = require('./fixtures/kacheln/testkarte.json');
const js = (f) => 'file:///' + path.join(ROOT, f).replace(/\\/g, '/');
const SKRIPTE = ['shared/config.js', 'shared/sektoren.js', 'public/js/icons-b.js', 'public/js/kartenzeichen.js', 'public/js/hauptschirm-tokens.js', 'public/js/kulisse-kugel.js'];
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0B0E1A">
<canvas id="c" width="760" height="720"></canvas>
${SKRIPTE.map((f) => `<script src="${js(f)}"></script>`).join('\n')}
<script>
const KARTE = ${JSON.stringify(karte)};
const SS = Shared_Sektoren, KZ = Kartenzeichen, IB = IconsB, K = KulisseKugel;
SS.setzeKarte(KARTE);
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
ctx.fillStyle = '#0B0E1A'; ctx.fillRect(0, 0, cv.width, cv.height);
const s = 56, ox = 40, oy = 46;
const mitte = (h) => { const p = SS.hexZuPixel(h, s); return { x: p.x + ox, y: p.y + oy }; };
const txt = (t, x, y, c, a, f) => { ctx.fillStyle = c; ctx.font = f || '10px sans-serif'; ctx.textAlign = a || 'center'; ctx.fillText(t, x, y); };
ctx.imageSmoothingEnabled = false;
txt('KAC-01 D  Testkarte (alle Sektortypen)  –  Sternkarte, Zeichen wie starmap.js', 12, 20, '#F4EEDC', 'left', '13px sans-serif');
const alle = []; for (let c = 1; c <= KARTE.spalten; c++) for (let r = 1; r <= KARTE.zeilen; r++) alle.push(String(c).padStart(2, '0') + String(r).padStart(2, '0'));
for (const h of alle) {
  const p = mitte(h), d = KARTE.hexe[h]; const pfad = [];
  for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; pfad.push([p.x + (s - 0.5) * Math.cos(a), p.y + (s - 0.5) * Math.sin(a)]); }
  IB.hexFlaeche(ctx, pfad, d ? d.fraktion : null, d ? 'erkundet' : 'leerraum', { s: s / 60 });
}
ctx.save(); ctx.globalAlpha = 0.9;
for (const e of KARTE.kanten) { const a = mitte(e.a), b = mitte(e.b); IB.kante(ctx, a.x, a.y, b.x, b.y, 'open', {}); }
ctx.restore();
for (const h of alle) {
  const d = KARTE.hexe[h], p = mitte(h);
  txt(h, p.x, p.y - s * 0.62, '#aab3c8', 'center', '9px sans-serif');
  if (!d) continue;
  ctx.save(); ctx.translate(p.x, p.y - 1); ctx.scale(2, 2);   // Zeichen 2-fach, damit sie im Bild lesbar sind (die Karte zeichnet 1-fach)
  KZ.symbol(ctx, KZ.hauptIcon(d), 0, 0, { farbe: '#F4EEDC' }); ctx.restore();
  txt(KZ.typName(d) || '(ohne typ: ' + d.art + ')', p.x, p.y + s * 0.62, '#F4EEDC', 'center', '9px sans-serif');
}
// Planetenarten
txt('Planetenarten (KulisseKugel)', 12, 600, '#F4EEDC', 'left', '12px sans-serif');
K.ARTEN.forEach((a, i) => { const x = 54 + i * 100, y = 650; K.zeichnePlanet(ctx, a, x, y, 32, 5, -0.6, 0, 0); txt(a, x, y + 50, '#F4EEDC', 'center', '10px sans-serif'); });
document.title = 'fertig';
</script>`;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kac01-d-')), 'karte.html');
  fs.writeFileSync(tmp, html, 'utf8');
  const browser = await chromium.launch();
  const fehler = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 760, height: 720 }, deviceScaleFactor: 2 })).newPage();
    page.on('pageerror', (e) => fehler.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') fehler.push('console: ' + m.text().slice(0, 200)); });
    await page.goto('file:///' + tmp.replace(/\\/g, '/'));
    await page.waitForFunction(() => document.title === 'fertig', null, { timeout: 30000 });
    const f = path.join(SHOTS, 'sternkarte-testkarte.png');
    await page.screenshot({ path: f });
    console.log('Bild ' + f);
  } finally { await browser.close(); }
  if (fehler.length) { console.log(fehler.join('\n')); process.exit(1); }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
