#!/usr/bin/env node
'use strict';
// SCH-01 P1: Erzeuger shared/gen-schiff.js (Kartenart schiff, Schablone gen-schiff, Layouts schiff und rechteck, Zustände intakt/verfallen/umkaempft)
//   a) Prüfer-Sweep je layout × zustand (K-KANTE, K-DECK …), Würfe < 2 %, awayMap-Größe, Länge   b) Pflichtsatz, Bereichsrollen
//   c) Determinismus   d) Zustandsunterschied   e) Rechteck symmetrisch   f) Wachen (Abstand, Türnähe), Fallenplätze
//   node tools/test-gen-schiff.js      (Umgebung: SEEDS=<n> je layout × zustand, Standard 50; VERBOSE=1)
const Buehne = require('../shared/buehne.js');
const GenSchiff = require('../shared/gen-schiff.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const SEEDS = Math.max(1, +process.env.SEEDS || 50);
const G = GenSchiff.erzeuger();
const LAYOUTS = ['schiff', 'rechteck'], ZUSTAENDE = ['intakt', 'verfallen', 'umkaempft'];
const MAX = Protocol.AWAY_MAP_MAX_BYTES || 16384;
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const seedVon = (i) => 1 + i * 37;
const TUEREN = 'DSLG';

const karten = {};   // layout/zustand -> [{ seed, roh, r }]
abschnitt('a) Prüfer-Sweep (' + SEEDS + ' Seeds je layout × zustand)');
for (const layout of LAYOUTS) for (const zustand of ZUSTAENDE) {
  const liste = []; let wuerfe = 0, rot = 0, bmax = 0, lmax = 0;
  for (let i = 0; i < SEEDS; i++) {
    const seed = seedVon(i);
    let roh;
    try { roh = G.karteRoh(seed, { layout, zustand, id: 'test.prise', bauweise: 'germanen', besitz: 'rostmeute' }); } catch (e) { wuerfe++; if (!/^gen-schiff:/.test(e.message)) ok(false, `${layout}/${zustand} Seed ${seed}: unkontrollierter Fehler ${e.message}`); continue; }
    const r = Buehne.ausRaster(roh, { spiel: true, cfg: CONFIG.buehne });
    if (!r.pruefung.ok) { rot++; ok(false, `${layout}/${zustand} Seed ${seed}: Prüfer ${r.fehler.slice(0, 3).map((f) => f.code + ' ' + f.msg).join('; ')}`); }
    const b = payloadB(r.karte); bmax = Math.max(bmax, b); lmax = Math.max(lmax, roh.w);
    liste.push({ seed, roh, r });
  }
  karten[layout + '/' + zustand] = liste;
  ok(wuerfe <= Math.floor(SEEDS * 0.02), `${layout}/${zustand}: ${wuerfe} von ${SEEDS} Würfen (höchstens 2 %)`);
  ok(rot === 0, `${layout}/${zustand}: ${rot} Karten mit Prüferfehlern`);
  ok(bmax <= MAX, `${layout}/${zustand}: awayMap max ${bmax} B <= ${MAX}`);
  ok(lmax <= GenSchiff.erzeuger().MAXLAENGE && lmax <= 74, `${layout}/${zustand}: Länge max ${lmax} <= 74`);
  console.log(`  ${layout}/${zustand}: ${liste.length} Karten, Würfe ${wuerfe}, awayMap max ${bmax} B, Länge max ${lmax}`);
}
const alle = [].concat(...Object.keys(karten).map((k) => karten[k].map((e) => Object.assign({ k }, e))));

abschnitt('b) Pflichtsatz und Bereichsrollen');
{
  let fehlt = 0, bereich = 0, art = 0, meta = 0;
  for (const e of alle) {
    const k = e.roh, zahl = {};
    for (const a of k.anker) zahl[a.rolle] = (zahl[a.rolle] || 0) + 1;
    for (const rolle of Object.keys(k.meta.pflicht)) {
      const nn = rolle === 'lift' || rolle === 'leiter' ? k.decks.links.filter((l) => l.via === rolle).length : (zahl[rolle] || 0);
      if (nn < k.meta.pflicht[rolle]) { fehlt++; ok(false, `${e.k} Seed ${e.seed}: ${rolle} ${nn} < ${k.meta.pflicht[rolle]}`); }
    }
    for (const rolle of ['hinein', 'ziel', 'rueckzug']) {
      const b = Object.values(k.bereiche).filter((x) => x.rolle === rolle);
      if (!b.length || b.every((x) => !x.rects.length)) { bereich++; ok(false, `${e.k} Seed ${e.seed}: Bereichsrolle ${rolle} fehlt oder leer`); }
    }
    const gef = Object.values(k.bereiche).filter((x) => x.gefecht);
    if (!gef.length || gef.some((x) => !x.rects.length)) { bereich++; ok(false, `${e.k} Seed ${e.seed}: Gefechtsbereich fehlt oder leer`); }
    // areaDef (server/mission/objects.js): hinein/ziel/rueckzug über Schlüssel oder Rolle auflösbar
    for (const rolle of ['hinein', 'ziel', 'rueckzug']) if (!k.bereiche[rolle] && !Object.values(k.bereiche).some((x) => x.rolle === rolle)) bereich++;
    if (k.art !== 'schiff' || k.schablone !== 'gen-schiff' || k.bauversion !== 'gschiff1' || k.decks.stride !== 16 || !k.ankunft) art++;
    if (!Array.isArray(k.meta.fallenplaetze) || !k.meta.fallenplaetze.length) meta++;
    if (e.k.endsWith('/umkaempft') && k.meta.haltung !== 'wach') meta++;
  }
  ok(fehlt === 0, `Pflichtsatz bei allen ${alle.length} Karten erfüllt`);
  ok(bereich === 0, 'Bereichsrollen hinein, ziel, rueckzug und ein Gefechtsbereich vorhanden und nicht leer (alle Layouts und Zustände)');
  ok(art === 0, 'Kartenfelder art/schablone/bauversion/decks/ankunft wie P0');
  ok(meta === 0, 'meta.fallenplaetze nicht leer, umkaempft setzt meta.haltung wach');
}

abschnitt('c) Determinismus');
{
  let gleich = 0, tot = 0;
  for (const layout of LAYOUTS) for (const zustand of ZUSTAENDE) for (const seed of [3, 77, 1234]) {
    const o = { layout, zustand, id: 'x', bauweise: 'rom', besitz: 'a' };
    let a, b; try { a = JSON.stringify(G.karteRoh(seed, o)); b = JSON.stringify(GenSchiff.erzeuger().karteRoh(seed, o)); } catch (e) { continue; }
    tot++; if (a === b) gleich++;
  }
  ok(tot > 0 && gleich === tot, `gleicher Seed + opts liefert byte-gleiche Rohkarte (${gleich}/${tot})`);
  const a = G.karteRoh(5, { layout: 'schiff' }), b = G.karteRoh(6, { layout: 'schiff' });
  ok(JSON.stringify(a.rows) !== JSON.stringify(b.rows), 'verschiedene Seeds liefern verschiedene Karten');
  ok(JSON.stringify(G.karteRoh(5, {}).rows) === JSON.stringify(G.karteRoh(5, { layout: 'schiff' }).rows), 'Standardlayout ist schiff');
  ok(JSON.stringify(G.karteRoh(5, { layout: 'schiff' }).rows) !== JSON.stringify(G.karteRoh(5, { layout: 'rechteck' }).rows), 'layout rechteck unterscheidet sich von schiff');
}

abschnitt('d) Zustandsunterschied');
{
  let verf = 0, umk = 0, wach = 0, vk = 0, tot = 0;
  const zaehle = (rows, re) => rows.join('').split('').filter((c) => re.test(c)).length;
  for (const layout of LAYOUTS) for (let i = 0; i < Math.min(SEEDS, 30); i++) {
    const seed = seedVon(i);
    let a, b, c; try { a = G.karteRoh(seed, { layout, zustand: 'intakt' }); b = G.karteRoh(seed, { layout, zustand: 'verfallen' }); c = G.karteRoh(seed, { layout, zustand: 'umkaempft' }); } catch (e) { continue; }
    tot++;
    if (zaehle(b.rows, /[xX~]/) > zaehle(a.rows, /[xX~]/)) verf++;
    if (JSON.stringify(c.rows) !== JSON.stringify(a.rows) && zaehle(c.rows, /[xXo~]/) > zaehle(a.rows, /[xXo~]/)) umk++;
    if (c.anker.filter((q) => q.rolle === 'wache').length > a.anker.filter((q) => q.rolle === 'wache').length) wach++;
    if (b.zustand === 'verfallen' && c.zustand === 'umkaempft' && a.zustand === 'intakt') vk++;
  }
  ok(tot > 0 && verf === tot, `verfallen hat mehr Trümmer/Löcher als intakt (${verf}/${tot})`);
  ok(umk === tot, `umkaempft verändert die Karte (mehr Deckung/Trümmer) (${umk}/${tot})`);
  ok(wach === tot, `umkaempft hat mehr Wachen als intakt (${wach}/${tot})`);
  ok(vk === tot, 'Rohkarte trägt zustand');
  const ueb = alle.filter((e) => e.roh.zustand !== 'intakt');
  ok(ueb.filter((e) => e.roh.meta.ueberzug === 'voll').length >= ueb.length * 0.9, `Überzug voll bei mindestens 90 % der Karten (${ueb.filter((e) => e.roh.meta.ueberzug === 'voll').length}/${ueb.length})`);
}

abschnitt('e) Rechteck symmetrisch');
{
  const klasse = (c) => (c === '#' ? '#' : c === '_' ? '_' : TUEREN.includes(c) ? 'D' : '.');
  let sym = 0, folgeOk = 0, rundum = 0, gleichBreit = 0, tot = 0;
  for (const e of karten['rechteck/intakt']) {
    tot++;
    const k = e.roh; let s = true;
    for (const d of [0, 1]) for (let y = 1; y <= 11; y++) { const r = k.rows[d * 16 + y]; for (let x = 0; x < k.w; x++) if (klasse(r[x]) !== klasse(r[k.w - 1 - x])) s = false; }
    for (const d of [0, 1]) for (const y of [0, 12]) { const r = k.rows[d * 16 + y]; if (r.replace(/[SDL]/g, '#') !== r.replace(/[SDL]/g, '#').split('').reverse().join('')) s = false; }
    if (s) sym++;
    let f = true;
    for (const fo of k.meta.raumfolge) { const o = fo.filter((_, i) => i % 2 === 0), u = fo.filter((_, i) => i % 2 === 1); if (o.join() !== o.slice().reverse().join() || u.join() !== u.slice().reverse().join()) f = false; }
    if (f) folgeOk++;
    // keine Verjüngung: Deck 1 Zeile 1 und Zeile 11 sind über die ganze Länge (außer Hüllenspalten) Innenraum oder Wand, nie '_'
    if (!k.rows[1].slice(1, -1).includes('_') && !k.rows[11].slice(1, -1).includes('_')) rundum++;
    // gleiche Sektionsbreiten: Abstände der Schottspalten (S in Zeile 6) spiegeln sich
    const sp = []; for (let x = 0; x < k.w; x++) if (k.rows[6][x] === 'S') sp.push(x);
    if (sp.every((x, i) => x === k.w - 1 - sp[sp.length - 1 - i])) gleichBreit++;
  }
  ok(sym === tot, `Raster ohne Ausstattung spiegelsymmetrisch (Wände, Türen, Hülle) (${sym}/${tot})`);
  ok(folgeOk === tot, `Raumfolge je Seite palindromisch (${folgeOk}/${tot})`);
  ok(rundum === tot, `Hülle nicht verjüngt (${rundum}/${tot})`);
  ok(gleichBreit === tot, `Schottspalten spiegeln sich (${gleichBreit}/${tot})`);
  const sch = karten['schiff/intakt'].filter((e) => e.roh.rows[1].includes('_', 4) && /_/.test(e.roh.rows[1].slice(2, -2))).length;
  ok(sch === karten['schiff/intakt'].length, `layout schiff ist verjüngt (${sch}/${karten['schiff/intakt'].length})`);
}

abschnitt('f) Wachen und Fallenplätze');
{
  let nahe = 0, tuer = 0, pad = 0, deckA = 0, fz = 0, fl = 0;
  for (const e of alle) {
    const k = e.roh, ws = k.anker.filter((a) => a.rolle === 'wache');
    const padA = k.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
    const c = (x, y) => (k.rows[y] || '')[x];
    for (let i = 0; i < ws.length; i++) {
      const a = ws[i];
      for (let j = i + 1; j < ws.length; j++) if (ws[j].deck === a.deck && Math.hypot(ws[j].x - a.x, ws[j].y - a.y) < 4) nahe++;
      let t = false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (TUEREN.includes(c(a.x + dx, a.y + dy) || '.')) t = true;
      if (t) tuer++;
      if (a.deck === padA.deck && Math.hypot(a.x - padA.x, a.y - padA.y) < 6) pad++;
    }
    if (new Set(ws.map((a) => a.deck)).size < 2) deckA++;
    for (const f of k.meta.fallenplaetze) {
      fz++;
      if (c(f.x, f.y) !== ',' || k.anker.some((a) => Math.abs(a.x - f.x) <= 1 && Math.abs(a.y - f.y) <= 1)) fl++;
    }
  }
  ok(nahe === 0, `Wachen je Deck mindestens 4 Kacheln auseinander (${nahe} Verstöße)`);
  ok(tuer === 0, `keine Wache auf oder neben einer Tür/einem Schott (${tuer} Verstöße)`);
  ok(pad === 0, `keine Wache näher als 6 Kacheln an der Ankunft (${pad} Verstöße)`);
  ok(deckA === 0, 'Wachen auf beiden Decks');
  ok(fl === 0, `Fallenplätze liegen auf Gangkacheln ohne Anker in der Nähe (${fz} Plätze, ${fl} Verstöße)`);
}

console.log(`\n${n - bad}/${n} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
