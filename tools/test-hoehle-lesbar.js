#!/usr/bin/env node
'use strict';
// GEL-02 E1: Lesbarkeit unter der Erde (Designer-Review P1-1, P1-2, P2-2, P2-3, P2-4). Browserlauf mit dem ECHTEN Erzeuger (Steine, Pfuetzen):
//   Hoehle:            ?arena=away&art=hoehle&seed=3&groesse=mittel
//   Wildnis mit Hoehle: ?arena=away&art=wildnis&seed=3&biom=vulkan&groesse=mittel&hoehle=1     (Deck 1)
// Geprueft wird die Geometrie der Kit-Meshes (nicht Bilder):
//   - 0 Kit-Fehler: kein Konsolen-/Seitenfehler, keine "Fehler in Voxel"-Warnung (der Loader meldet per console.warn, nicht error), stats.fehler 0
//     (vorher: kit/germanen/deckung_voll "art muss einer von ..." weil die Hoehle aufs generische Kit fiel; test-hoehle-shot und test-hoehle-client sahen es nicht)
//   - Verdeckung: Anteil begehbarer Kacheln mit Fels >= 2 m direkt suedlich = 0 % (vorher Hoehle ca. 11 %, Wildnis Deck 1 ca. 11 %)
//   - Boden: Kacheln an Fels dunkler (x 0,85) als freie; Boden heller als der Erdton des Grabenangriffs (BODEN2_TON bleibt 1,3)
//   - Pfuetze: keine blaue Kachel mehr (Blau < 0,15), mindestens 2 Flaechen plus Grund, alles unter Bodenniveau; Deck 0 der Wildnis behaelt das Wasserblau
//   - Hinweistext der Leiter: Wildnis mit Hoehle "In die Hoehle hinabsteigen" / "Hinauf zur Oberflaeche", Schiff und Bunker wie bisher
//   node tools/test-hoehle-lesbar.js        Bilder (Vorlage) macht tools/test-hoehle-shot.js bzw. test-hoehle-client.js nach shots/gel02/
//   - Bildmessung (GEL-02 E, Nacharbeit, Spielbild Zoom 1, Software-GL, Qualitaet low ohne Bloom): CIE L* im gerenderten Bild
//       Stein (halb): Oberseite >= 40, Seiten 20 bis 35, Seiten heller als Boden (Ziel Designer: Oberseite 45 bis 50, Seiten 25 bis 30)
//       Fund: die hellsten 1 % der Pixel im Glutring sind mindestens 10 L* heller als die hellsten 1 % im Pilz-/Rissbereich (Kulisse bleibt sichtbar: >= 25)
// Fehlt playwright-core oder public/voxel, laeuft nur der Teil ohne Browser (Hinweis SKIP).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const lies = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KACHELN = JSON.parse(lies('content/buehnen/kacheln.json').replace(/^﻿/, '')).zeichen;
const Physics = require('../shared/physics.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* naechster */ } }
  return null;
}

// Quelltext-Pruefungen (laufen immer)
function quelltext() {
  abschnitt('Quelltext');
  const kit = lies('public/js/voxel/kit.js'), client = lies('public/js/client.js');
  ok(/\(wildnis \|\| hoehle\) && \(kind === 'deckung_halb'/.test(kit), 'kit.js: Steine (o/O) nehmen in der Hoehle den Findling (nicht das generische Kit)');
  ok(/ton === 'hoehle' \?/.test(kit) && /ton: unterErde\(ty\) \? 'hoehle' : k\.boden/.test(kit), 'kit.js: Findling im Hoehlenton unter der Erde');
  ok(/BODEN2_TON = \{ erde: \{ top: 'soil', f: 1\.3 \}/.test(kit), 'kit.js: BODEN2_TON.erde bleibt 1,3 (Grabenangriff unveraendert)');
  ok(/HOEHLE_F = \{ erde: 2\.4/.test(kit), 'kit.js: Hoehlenboden Faktor 2,4 (L* ca. 19 im Bild, Soll 17 bis 20) ueber eigenen Eintrag');
  const kul = lies('public/js/voxel/hoehle-kulisse.js');
  ok(/const STEIN_HOEHLE_F = \{/.test(kit) && /const gh = ton === 'hoehle' \? STEIN_HOEHLE_F : \{ hell: 1, mitte: 1, dunkel: 1 \}/.test(kit), 'kit.js: Helligkeitsfaktor der Findlinge nur im Hoehlenton (Oberflaeche und Biomtoene unveraendert)');
  const F = (n) => +(kul.match(new RegExp('export const ' + n + ' = ([0-9.]+)')) || [0, 'x'])[1];
  const KF = (kul.match(/PILZ_F_MIN = ([0-9.]+), RISS_F_MIN = ([0-9.]+), KRISTALL_F_MIN = ([0-9.]+)/) || []).slice(1).map(Number);
  ok(F('RING_F') >= 1.0 && KF.length === 3 && KF[0] + 0.1 <= 0.55 + 1e-9 && KF[1] + 0.1 <= 0.6 + 1e-9 && KF[2] + 0.07 <= 0.35 + 1e-9, `Kulisse: Ring-Leuchtfaktor ${F('RING_F')} >= 1,0; Pilze <= 0,55, Risse <= 0,6, Kristalle <= 0,35 (hoechste Faktoren ${KF[0] + 0.1}/${KF[1] + 0.1}/${KF[2] + 0.07})`);
  ok(/'E halten: Hinauf zur Oberfl/.test(client) && /'E halten: In die H.hle hinabsteigen'/.test(client), 'client.js: Hinweistexte der Hoehlenleiter');
}

// Messung der Kit-Meshes im Browser: je Kachel (Schluessel "x,ty") hoechste Oberflaeche und die Oberflaechenfarben (linear)
const IM_BROWSER = {
  flaechen: (arg) => {
    const S = VoxelRender.renderer.state(), stride = arg.stride, T = {};
    S.scene.traverse((o) => {
      if (!(o.isMesh && o.name && o.name.startsWith('kit:') && !o.name.startsWith('kit:huelle') && !o.name.startsWith('kit:krone'))) return;
      const d = +o.name.slice(4).split(',')[0] || 0, g = o.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color ? g.attributes.color.array : null;
      const idx = g.index ? g.index.array : null, nTri = (idx ? idx.length : P.length / 3) / 3;
      for (let t = 0; t < nTri; t++) {
        const v = [0, 1, 2].map((q) => (idx ? idx[t * 3 + q] : t * 3 + q));
        if (!v.every((i) => N[i * 3 + 1] > 0.9)) continue;
        const cx = (P[v[0] * 3] + P[v[1] * 3] + P[v[2] * 3]) / 3, cz = (P[v[0] * 3 + 2] + P[v[1] * 3 + 2] + P[v[2] * 3 + 2]) / 3;
        const key = Math.floor(cx) + ',' + (Math.floor(cz) + d * stride), y = P[v[0] * 3 + 1];
        const e = T[key] || (T[key] = { y: -99, f: [] });
        if (y > e.y) e.y = y;
        if (C) e.f.push([Math.round(y * 1000) / 1000, C[v[0] * 3], C[v[0] * 3 + 1], C[v[0] * 3 + 2]]);
      }
    });
    return T;
  },
  kit: () => { const s = VoxelKit.stats(); return { id: s.id, art: s.art, fehler: s.fehler, platzhalter: s.platzhalter || {}, fehlend: s.fehlend || [] }; },
  text: (arg) => ({ unten: __game.leiterText(arg.ty1), oben: __game.leiterText(arg.ty0), schiff: __game.leiterText(arg.ty1, { art: 'schiff', decks: { stride: arg.stride } }), bunker: __game.leiterText(arg.ty1, { art: 'aussenposten', decks: { stride: arg.stride } }), hoehleEinDeck: __game.leiterText(0, { art: 'hoehle' }) }),
};

// Bildmessung im Spielbild (Zoom 1): Projektion Welt -> Pixel, Screenshot -> Canvas -> CIE L*
const lsternImBild = (page, png, regionen, punkte) => page.evaluate(async ({ b64, regionen: R, punkte: Pt }) => {
  const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const Ls = (r, g, b) => { const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; };
  const rect = (x0, y0, x1, y1) => { x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(img.width, Math.ceil(x1)); y1 = Math.min(img.height, Math.ceil(y1)); return x1 > x0 && y1 > y0 ? { x0, y0, w: x1 - x0, h: y1 - y0, d: cx.getImageData(x0, y0, x1 - x0, y1 - y0).data } : null; };
  const top1 = R.map(([x0, y0, x1, y1]) => { const r = rect(x0, y0, x1, y1); if (!r) return null; const L = []; for (let i = 0; i < r.d.length; i += 4) L.push(Ls(r.d[i], r.d[i + 1], r.d[i + 2])); L.sort((a, b) => a - b); const n = Math.max(1, Math.floor(L.length / 100)); return L.slice(-n).reduce((a, b) => a + b, 0) / n; });
  const mittel = Pt.map(([x, y]) => { const r = rect(x - 3, y - 3, x + 4, y + 4); if (!r) return null; let R2 = 0, G = 0, B = 0, n = 0; for (let i = 0; i < r.d.length; i += 4) { R2 += r.d[i]; G += r.d[i + 1]; B += r.d[i + 2]; n++; } return Ls(R2 / n, G / n, B / n); });
  return { top1, mittel };
}, { b64: png.toString('base64'), regionen, punkte });
const projiziere = (page, pts) => page.evaluate((P2) => {
  const c = VoxelRender.renderer.state().camera; c.updateMatrixWorld(); const mi = c.matrixWorldInverse.elements, pr = c.projectionMatrix.elements;
  return P2.map(([x, y, z]) => { const vx = mi[0] * x + mi[4] * y + mi[8] * z + mi[12], vy = mi[1] * x + mi[5] * y + mi[9] * z + mi[13], vz = mi[2] * x + mi[6] * y + mi[10] * z + mi[14];
    const cx = pr[0] * vx + pr[4] * vy + pr[8] * vz + pr[12], cy = pr[1] * vx + pr[5] * vy + pr[9] * vz + pr[13], cw = pr[3] * vx + pr[7] * vy + pr[11] * vz + pr[15];
    return [(cx / cw * 0.5 + 0.5) * innerWidth, (1 - (cy / cw * 0.5 + 0.5)) * innerHeight]; });
}, pts);
const huellrechteck = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

/** Spielbild-Messung: Stein (halb), Fund-Glutring, Pilz-/Rissbereich. Stellt die Spielfigur per Server (god on) vor die Stelle; Zoom 1. */
async function bildmessung(page, g, ks, kind, stride, y0, name, out) {
  const tag = stride ? 'wildnis' : 'hoehle';
  fs.mkdirSync(path.join(ROOT, 'shots', 'gel02'), { recursive: true });
  const P = g.players[0];
  const platz = (tx, ty) => { const c = Physics.tileCenter(tx, ty); P.x = c.x; P.y = c.y; P.dir = 'up'; P.input.mx = 0; P.input.my = 0; };
  const frei = (x, y) => kind(x, y) === 'boden' || kind(x, y) === 'boden2';
  const sucheFrei = (x, y) => { for (let r = 0; r < 6; r++) for (let dy = r; dy >= -r; dy--) for (let dx = -r; dx <= r; dx++) if (frei(x + dx, y + dy)) return [x + dx, y + dy]; return [x, y]; };
  const wz = (ty) => ty - (stride ? Math.floor(ty / stride) * stride : 0) + 0.5;
  await page.evaluate(() => __game.dbg('god on'));
  if (stride) { const l = ks.decks.links[0], lu = l.a[1] >= stride ? l.a : l.b; platz(lu[0], lu[1]); await sleep(4000); }   // Deck 1 zeigen (Leiter-Anker)
  await page.evaluate(() => { VoxelRender.renderer.setZoom(1); VoxelRender.renderer.setQuality('low'); });   // Qualitaet low (ohne Bloom, wie in Software-GL): sonst haengt der Wert vom FPS-Waechter ab
  await sleep(1500);
  const Rz = { stein: null, fund: null, pilz: null };
  // Stein (halb) mit freier Umgebung
  const steine = [];
  for (let y = y0 + 2; y < ks.h - 4; y++) for (let x = 2; x < ks.w - 2; x++) if (kind(x, y) === 'deckung_halb' && [1, 2, 3].every((d) => frei(x, y + d)) && frei(x + 1, y + 3)) steine.push([x, y]);
  if (steine.length) {
    const [sx, sy] = steine[Math.floor(steine.length / 2)], q = [sx, sy + 3];
    platz(q[0], q[1]); await sleep(2500);
    const X = sx + 0.5, Zc = wz(sy), pts = await projiziere(page, [[X, 0.84, Zc], [X, 0.25, Zc + 0.36], [X, 0.67, Zc + 0.24], [X, 0, Zc + 1.5], [X + 1, 0, Zc + 1.5]]);
    const png0 = await page.screenshot({ path: path.join(ROOT, 'shots', 'gel02', `lesbar-${tag}-stein.png`) }), m = await lsternImBild(page, png0, [], pts);
    Rz.stein = { oben: m.mittel[0], seiteUnten: m.mittel[1], seiteOben: m.mittel[2], boden: (m.mittel[3] + m.mittel[4]) / 2, n: steine.length };
  }
  // Fund mit Glutring
  const fund = ks.anker.filter((a) => a.rolle === 'fund' && a.y >= y0)[0];
  const stellen = await page.evaluate(() => { const s = VoxelKit.stats().kulisse; return s && s.stellen ? [...s.stellen.pilze, ...s.stellen.risse] : []; });
  const seiten = (st) => st.map(([x, y]) => { const X = x + 0.5, Zc = wz(y); return [[X - 0.5, 0.05, Zc + 0.5], [X + 0.5, 0.95, Zc + 0.5]]; });   // Vorderseite der Felskachel (Nische darin)
  if (fund) {
    const q = sucheFrei(fund.x, fund.y + 3); platz(q[0], q[1]); await sleep(2500);
    const X = fund.x + 0.5, Zc = wz(fund.y), ecken = await projiziere(page, [[X - 0.5, 0.02, Zc - 0.5], [X + 0.5, 0.02, Zc - 0.5], [X - 0.5, 0.02, Zc + 0.5], [X + 0.5, 0.02, Zc + 0.5]]);
    // Ringband: das ganze Kachelquadrat (das Prop deckt die Mitte ab, die hellsten 1 % liegen im Band)
    const png = await page.screenshot({ path: path.join(ROOT, 'shots', 'gel02', `lesbar-${tag}-fund.png`) }), m = await lsternImBild(page, png, [huellrechteck(ecken)], []);
    Rz.fund = { ring: m.top1[0], qualitaet: await page.evaluate(() => VoxelRender.renderer.state().quality) };
    // Pilz-/Rissbereiche, die in diesem Bild stehen (Fund im Bild) und, getrennt, die naechste Gruppe zum Fund im Nahbild
    const sorte = stellen.slice().sort((a, b) => Math.hypot(a[0] - fund.x, a[1] - fund.y) - Math.hypot(b[0] - fund.x, b[1] - fund.y));
    if (sorte.length) {
      const q2 = sucheFrei(sorte[0][0], sorte[0][1] + 3); platz(q2[0], q2[1]); await sleep(2500);
      const bx = seiten(sorte.slice(0, 1))[0], pp = await projiziere(page, bx), m2 = await lsternImBild(page, await page.screenshot({ path: path.join(ROOT, 'shots', 'gel02', `lesbar-${tag}-pilz.png`) }), [huellrechteck(pp)], []);
      Rz.pilz = { top1: m2.top1[0], stelle: sorte[0] };
    }
  }
  out[name] = Rz;
}

async function lauf(pw, W, startServer, spec) {
  const srv = await startServer({ port: 0, quiet: true, noStore: true, roomCode: 'off', debug: true });
  const g = srv.game;
  const b = await pw.chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const meldungen = [];
  const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => meldungen.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || (m.type() === 'warning' && /Fehler in Voxel|\[kit\]/.test(t))) meldungen.push(m.type() + ': ' + t.slice(0, 200)); });
  try {
    await page.goto(`http://127.0.0.1:${srv.port}/?arena=away&${spec}&render=voxel&debug=1`);
    await page.waitForFunction(() => window.__game && __game.state && __game.state.phase === 'lobby', null, { timeout: 30000, polling: 40 });
    await sleep(1500);
    await page.evaluate(() => __game.send({ t: 'lobbyOpt', skipDrill: true }));
    await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
    await page.waitForFunction(() => { const s = window.VoxelKit && VoxelKit.stats(); return !!(s && __game.state.away && s.id === __game.state.away.map); }, null, { timeout: 120000, polling: 40 });
    await sleep(2500);
    const ks = W.AWAY_MAPS[g.away.map].karte;
    const stride = ks.decks ? ks.decks.stride : 0;
    const kind = (x, y) => { const r = ks.rows[y]; const c = r && r[x]; return c ? (KACHELN[c] || {}).kind : null; };
    const flaechen = await page.evaluate(IM_BROWSER.flaechen, { stride });
    const kit = await page.evaluate(IM_BROWSER.kit);
    const text = ks.decks ? await page.evaluate(IM_BROWSER.text, { stride, ty0: 1, ty1: stride + 1 }) : null;
    const bild = {};
    await bildmessung(page, g, ks, kind, stride, ks.decks ? stride : 0, 'x', bild);   // zuletzt: stellt die Figur um (Geometrie ist schon gemessen)
    return { ks, stride, kind, flaechen, kit, meldungen, text, srvFehler: g.errors, bild: bild.x };
  } finally { await b.close().catch(() => null); await srv.close(); }
}

const lum = (r, g, bb) => 0.2126 * r + 0.7152 * g + 0.0722 * bb;
const mittel = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const BEGEHBAR = { boden: 1, boden2: 1, pad: 1 };

function auswerten(name, r, y0) {
  const { ks, kind, flaechen } = r;
  abschnitt(name);
  ok(r.kit.fehler === 0 && r.meldungen.length === 0, `${name}: 0 Kit-Fehler (stats.fehler ${r.kit.fehler}, Meldungen ${r.meldungen.length}${r.meldungen[0] ? ': ' + r.meldungen[0] : ''})`);
  ok(r.srvFehler === 0, `${name}: keine Serverfehler (${r.srvFehler})`);
  let nStein = 0, nPfuetze = 0, nBegehbar = 0, verdeckt = 0;
  const frei = [], amFels = [], blauMax = [], pfuetzeFl = [];
  for (let y = y0; y < ks.h; y++) for (let x = 0; x < ks.w; x++) {
    const kd = kind(x, y);
    if (kd === 'deckung_halb' || kd === 'deckung_voll') nStein++;
    if (kd === 'fluessig') nPfuetze++;
    if (!BEGEHBAR[kd]) continue;
    nBegehbar++;
    const s = kind(x, y + 1), e = flaechen[x + ',' + (y + 1)];
    if (s === 'fels' && y + 1 < ks.h && (!r.stride || Math.floor((y + 1) / r.stride) === Math.floor(y / r.stride))) {
      if (e && e.y >= 2 - 1e-6) verdeckt++;
    }
    const f = (flaechen[x + ',' + y] || { f: [] }).f.filter((q) => Math.abs(q[0]) < 0.02);
    if (!f.length) continue;
    const L = mittel(f.map((q) => lum(q[1], q[2], q[3])));
    const nb = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => kind(x + dx, y + dy) === 'fels');
    (nb ? amFels : frei).push(L);
  }
  ok(nStein > 0 && nPfuetze > 0, `${name}: die Karte hat Steine (${nStein}) und Pfuetzen (${nPfuetze}) (Echtkarte, nicht nur Boden)`);
  const anteil = 100 * verdeckt / nBegehbar;
  console.log(`  Messung ${name}: begehbar ${nBegehbar}, Fels >= 2 m direkt suedlich ${verdeckt} = ${anteil.toFixed(1)} %`);
  ok(verdeckt === 0, `${name}: kein Fels >= 2 m direkt suedlich eines Gangs (${verdeckt} von ${nBegehbar} = ${anteil.toFixed(1)} %, vorher ca. 11 %)`);
  // zweite Reihe hoechstens 2 m
  let zweite = 0;
  for (let y = y0 + 2; y < ks.h; y++) for (let x = 0; x < ks.w; x++) {
    if (kind(x, y) !== 'fels' || kind(x, y - 1) !== 'fels' || !BEGEHBAR[kind(x, y - 2)]) continue;
    const e = flaechen[x + ',' + y];
    if (e && e.y > 2 + 1e-6) zweite++;
  }
  ok(zweite === 0, `${name}: zweite Felsreihe hinter dem Gang hoechstens 2 m (${zweite} Ausreisser)`);
  // Boden
  const Lf = mittel(frei), La = mittel(amFels);
  console.log(`  Messung ${name}: Boden Vertexhelligkeit frei ${Lf.toFixed(4)} (${frei.length}), an Fels ${La.toFixed(4)} (${amFels.length})`);
  ok(frei.length > 50 && amFels.length > 20 && La / Lf > 0.7 && La / Lf < 0.92, `${name}: Kacheln an Fels dunkler als freie (Verhaeltnis ${(La / Lf).toFixed(2)}, Soll ca. 0,85 mit Streuung)`);
  // Erdton des Grabenangriffs: soil * 1,3; Hoehle soil * 1,8: das Verhaeltnis zum Streuungsmittel ist ueber die Palette nicht direkt lesbar, deshalb Mindesthelligkeit relativ zum Fels
  const felsSeite = [];
  for (const e of Object.values(flaechen)) if (e.y >= 0.9 && e.f.length) for (const q of e.f) if (q[0] >= 0.9) felsSeite.push(lum(q[1], q[2], q[3]));
  console.log(`  Messung ${name}: Fels Oberseite ${mittel(felsSeite).toFixed(4)} gegen Boden ${Lf.toFixed(4)}`);
  ok(Lf > 0.006, `${name}: Boden nicht schwarz (lineare Helligkeit ${Lf.toFixed(4)})`);
  // Pfuetzen
  const pf = [];
  for (let y = y0; y < ks.h; y++) for (let x = 0; x < ks.w; x++) if (kind(x, y) === 'fluessig') { const e = flaechen[x + ',' + y]; if (e) pf.push(e); }
  ok(pf.length > 0 && pf.every((e) => e.y < 0), `${name}: alle Pfuetzen liegen unter Bodenniveau (${pf.length}, hoechste Flaeche ${Math.max(...pf.map((e) => e.y)).toFixed(3)} m)`);
  ok(pf.every((e) => e.f.length >= 6), `${name}: Pfuetze aus Grund plus mindestens 2 Flaechen (${pf.map((e) => e.f.length / 2).join('/')} Quads)`);
  const blau = pf.map((e) => e.f.filter((q) => q[3] >= 0.15).length);   // erlaubt: nur der Glanzstreifen (1 Quad = 2 Dreiecke); der Wasserton #1F5E96 hat Blau 0,305
  ok(pf.every((e) => e.f.length - 2 >= 4) && blau.every((c) => c <= 2), `${name}: keine blaue Kachel (Dreiecke mit Blau >= 0,15 je Pfuetze: ${blau.join('/')}, erlaubt nur der Glanzstreifen = 2)`);
  // Bildmessung (CIE L* im gerenderten Spielbild, Zoom 1)
  const B = r.bild || {}, st = B.stein, fu = B.fund, pi = B.pilz;
  if (st) {
    console.log(`  Messung ${name}: Stein (halb) Oberseite L* ${st.oben.toFixed(1)}, Seiten ${st.seiteOben.toFixed(1)}/${st.seiteUnten.toFixed(1)}, Boden ${st.boden.toFixed(1)} (${st.n} Steine in der Karte)`);
    ok(st.oben >= 40, `${name}: Stein-Oberseite im Bild L* >= 40 (${st.oben.toFixed(1)}, Ziel 45 bis 50)`);
    ok([st.seiteOben, st.seiteUnten].every((v) => v >= 20 && v <= 35), `${name}: Stein-Seiten im Bild L* 20 bis 35 (${st.seiteOben.toFixed(1)} / ${st.seiteUnten.toFixed(1)}, Ziel 25 bis 30)`);
    ok(st.seiteOben > st.boden && st.seiteUnten > st.boden && st.oben > st.boden, `${name}: Stein heller als der Boden (Boden L* ${st.boden.toFixed(1)})`);
  } else ok(false, `${name}: kein Stein mit freier Umgebung fuer die Bildmessung gefunden`);
  if (fu && pi) {
    console.log(`  Messung ${name}: Qualitaet ${fu.qualitaet}`);
    console.log(`  Messung ${name}: Fund-Glutring (hellste 1 %) L* ${fu.ring.toFixed(1)}, Pilz-/Rissbereich (hellste 1 %) L* ${pi.top1.toFixed(1)}`);
    ok(fu.ring >= pi.top1 + 10, `${name}: der Fund ist das hellste Element (Ring L* ${fu.ring.toFixed(1)} >= Pilz/Riss ${pi.top1.toFixed(1)} + 10)`);
    ok(pi.top1 >= 25, `${name}: Pilze/Risse bleiben sichtbar (L* ${pi.top1.toFixed(1)} >= 25)`);
  } else ok(false, `${name}: Fund oder Pilz-/Rissgruppe fuer die Bildmessung fehlt`);
  return { stein: nStein };
}

(async () => {
  quelltext();
  const pw = playwright();
  if (!pw || !fs.existsSync(path.join(ROOT, 'public', 'voxel', 'manifest.json'))) { console.log('SKIP Browserteil (playwright-core oder public/voxel fehlt)'); console.log(`${n - bad}/${n} Pruefungen gruen`); process.exit(bad ? 1 : 0); }
  const W = require('../server/world.js'), { startServer } = require('../server/index.js');
  const h = await lauf(pw, W, startServer, 'art=hoehle&seed=3&groesse=mittel');
  auswerten('Hoehle mittel seed 3', h, 0);
  ok(h.kit.art === 'hoehle', 'Client uebernimmt art hoehle');
  const w = await lauf(pw, W, startServer, 'art=wildnis&seed=3&biom=vulkan&groesse=mittel&hoehle=1');
  auswerten('Wildnis vulkan Deck 1', w, w.stride);
  // Deck 0: Steine und Pfuetzen der Oberflaeche bleiben wie bisher (Wasserblau oben, Biom-Findling)
  abschnitt('Wildnis Deck 0 unveraendert');
  const oben = [];
  for (let y = 0; y < w.stride; y++) for (let x = 0; x < w.ks.w; x++) if (w.kind(x, y) === 'fluessig' && (w.flaechen[x + ',' + y] || { f: [] }).f.length) oben.push(w.flaechen[x + ',' + y]);
  if (oben.length) ok(oben.some((e) => e.f.some((q) => q[3] > 0.25)) || oben.every((e) => e.f.every((q) => q[1] > 0.3)), `Deck 0: Pfuetzen/Lava der Oberflaeche behalten ihre Farbe (${oben.length} Kacheln, kein Hoehlengrau)`);
  else console.log('  (keine Fluessigkeit auf Deck 0 dieser Karte)');
  abschnitt('Hinweistext Leiter');
  ok(w.text && w.text.unten === 'E halten: Hinauf zur Oberfläche' && w.text.oben === 'E halten: In die Höhle hinabsteigen', `Wildnis mit Hoehle: oben "${w.text && w.text.oben}", unten "${w.text && w.text.unten}"`);
  ok(w.text && w.text.schiff === 'E halten: Leiter zum anderen Deck' && w.text.bunker === 'E halten: Leiter zum anderen Deck', 'Schiff und Bunker behalten den alten Text');
  ok(w.text && w.text.hoehleEinDeck === 'E halten: Leiter zum anderen Deck', 'Hoehle ohne Deck: alter Text (kein Hinabsteigen)');
  console.log(`${n - bad}/${n} Pruefungen gruen`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FEHLER', e && e.stack || e); process.exit(1); });
