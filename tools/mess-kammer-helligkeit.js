'use strict';
// CHA-01 C Nacharbeit: Messung der Helligkeit der Figur in der Kleiderkammer (Porträt aus voxel/kammer.js) gegen Hautmuster und Vorschaukachel des Voxelwerks.
// Echter Server im selben Prozess, Chromium (Playwright), ?render=voxel. Gleiche Figur (Standardkarte, Haut 0), gleicher Ausschnitt (Kopf, Porträt).
// Gemessen werden drei Werte: das Hautmuster aus dem Katalog (Soll-Farbe der unbeschatteten Fläche), die Vorschaukachel gesicht/lerche.png (Voxelwerk-Referenz)
// und das Porträt der Kammer; Auswertung = Mittelwert der Hautpixel (Farbton nahe der Haut) in der Gesichtsmitte (Quadrat um den Schwerpunkt der Hautpixel, Kantenlänge 1/4 der Kopfbreite).
// Aufruf: node tools/mess-kammer-helligkeit.js [--port 3547] [--shots <ordner>]   Exit 0 = gemessen (kein Urteil), 1 bei Fehlern.
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PORT = +arg('port', '3547');
const SHOTS = path.resolve(arg('shots', path.join('shots', 'helligkeit')));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mess-hell-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const { startServer } = require('../server/index.js');
function playwright() { for (const k of [process.env.PLAYWRIGHT_CORE, 'C:/tmp/pw-test/node_modules/playwright-core', 'playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } } console.error('playwright-core nicht gefunden'); process.exit(2); }
const { chromium } = playwright();

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await startServer({ port: PORT, debug: true, ruestphase: false, roomCode: 'off', quiet: true, worlds: false, noStore: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  let code = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
    await page.goto(`http://127.0.0.1:${PORT}/?render=voxel`);
    await page.waitForFunction(() => window.__game && __game.state && window.Charaktere && Charaktere.lies().bereit && window.KammerBild, null, { timeout: 60000 });
    const r = await page.evaluate(async () => {
      const kat = Charaktere.katalog();
      const karte = Shared_Charakter.standardKarte('Messung', kat);
      let c = null;
      for (let i = 0; i < 200 && !c; i++) { c = KammerBild.bild(karte, 'portraet', 0); if (!c) await new Promise((res) => setTimeout(res, 100)); }
      if (!c) return { fehler: 'kein Bild: ' + JSON.stringify(KammerBild.info()) };
      const kachel = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = '/voxel/sprites/cha/vorschau/gesicht/lerche.png'; });
      const tc = document.createElement('canvas'); tc.width = kachel.naturalWidth; tc.height = kachel.naturalHeight; tc.getContext('2d').drawImage(kachel, 0, 0);
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const f = kat.farben.haut[karte.haut];
      const muster = hex(typeof f === 'string' ? f : f.skin), schatten = f.skin_shadow ? hex(f.skin_shadow) : null;
      const daten = (cv) => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      return { muster, schatten, portraet: Array.from(daten(c).data), pw: c.width, ph: c.height, kachel: Array.from(daten(tc).data), kw: tc.width, kh: tc.height, url: c.toDataURL('image/png'), kurl: tc.toDataURL('image/png') };
    });
    if (r.fehler) { console.log(r.fehler); process.exit(1); }
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // Hautpixel = opak und im Farbton der Haut (Verhältnis R:G:B ähnlich dem Muster; Haar, Auge, Mund fallen heraus)
    const norm = (p) => { const s = p[0] + p[1] + p[2] || 1; return [p[0] / s, p[1] / s, p[2] / s]; };
    const mn = norm(r.muster);
    function messe(data, w, h, name) {
      const haut = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (data[i + 3] < 250) continue; const p = [data[i], data[i + 1], data[i + 2]]; if (dist(norm(p).map((v) => v * 255), mn.map((v) => v * 255)) < 18 && p[0] > 40) haut.push({ x, y, p }); }
      if (!haut.length) return { name, fehler: 'keine Hautpixel' };
      const cx = haut.reduce((s, q) => s + q.x, 0) / haut.length, cy = haut.reduce((s, q) => s + q.y, 0) / haut.length;
      const xs = haut.map((q) => q.x), breite = Math.max(...xs) - Math.min(...xs) + 1, k = Math.max(4, Math.round(breite / 4));
      const mitte = haut.filter((q) => Math.abs(q.x - cx) <= k / 2 && Math.abs(q.y - cy) <= k / 2);
      const mw = [0, 1, 2].map((c) => Math.round(mitte.reduce((s, q) => s + q.p[c], 0) / mitte.length));
      const hell = haut.map((q) => q.p[0] + q.p[1] + q.p[2]).sort((a, b) => a - b);
      const sample = [0.1, 0.5, 0.9].map((f) => { const v = hell[Math.floor(f * (hell.length - 1))]; return Math.round(v / 3); });
      return { name, hautpixel: haut.length, schwerpunkt: [Math.round(cx), Math.round(cy)], quadrat: k, mitte: mw, helligkeitP10P50P90: sample };
    }
    const roi = (data, w, x0, x1, y0, y1) => { const m = [0, 0, 0]; let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * w + x) * 4; for (let c = 0; c < 3; c++) m[c] += data[i + c]; n++; } return m.map((v) => Math.round(v / n)); };
    console.log('ROI Portrait Gesichtsfront x60-99 y146-155: ' + JSON.stringify(roi(r.portraet, r.pw, 60, 99, 146, 155)));
    const mp = messe(r.portraet, r.pw, r.ph, 'portraet Kammer'), mk = messe(r.kachel, r.kw, r.kh, 'Vorschaukachel Voxelwerk');
    const rel = (a, b) => (a / b).toFixed(2);
    console.log(JSON.stringify({ hautmuster: r.muster, hautschatten: r.schatten }));
    console.log(JSON.stringify(mk)); console.log(JSON.stringify(mp));
    if (mp.mitte && mk.mitte) console.log('Verhältnis Kammer/Kachel (R,G,B): ' + [0, 1, 2].map((c) => rel(mp.mitte[c], mk.mitte[c])).join(' / ') + '   Kammer/Muster: ' + [0, 1, 2].map((c) => rel(mp.mitte[c], r.muster[c])).join(' / ') + '   Kachel/Muster: ' + [0, 1, 2].map((c) => rel(mk.mitte[c], r.muster[c])).join(' / '));
    const tag = arg('tag', 'messung');
    if (process.argv.includes('--roh')) fs.writeFileSync(path.join(SHOTS, tag + '-roh.json'), JSON.stringify({ portraet: r.portraet, pw: r.pw, kachel: r.kachel, kw: r.kw }));
    fs.writeFileSync(path.join(SHOTS, tag + '-portraet.png'), Buffer.from(r.url.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(SHOTS, tag + '-kachel.png'), Buffer.from(r.kurl.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(SHOTS, tag + '.json'), JSON.stringify({ muster: r.muster, schatten: r.schatten, kachel: mk, portraet: mp }, null, 1));
  } catch (e) { console.error(e); code = 1; } finally { await browser.close(); await srv.close(); }
  process.exit(code);
})();
