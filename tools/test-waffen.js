'use strict';
// B2 Waffen-Modul (CONTRACT-B2 §2/§3): reine Tests ohne Game-Klasse und ohne Netz.
//   node tools/test-waffen.js
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const Waffen = require('../server/sim/waffen.js');
const combat = require('../server/sim/combat.js');

const TILE = Physics.TILE;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);

// Spielwelt-Attrappe: eigene Kopie der Konfiguration (tune-fest), Zeit von Hand, deterministischer Zufall
function welt() {
  const C = JSON.parse(JSON.stringify(CONFIG));
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const g = { C, time: 0, events: [], kaempfer: [], away: { projectiles: [], rng }, ids: 0 };
  g.emit = (name, data) => g.events.push(Object.assign({ name }, data));
  g.nextId = (p) => p + (++g.ids);
  g.waffenWelt = { kaempfer: () => g.kaempfer, wand: (x0, y0, x1, y1) => !!(g.wand && g.wand(x0, y0, x1, y1)) };
  return g;
}
function spieler(g, id, tx, ty, waffe) {
  const c = Physics.tileCenter(tx, ty);
  const k = Waffen.ausstatten(g, { id, x: c.x, y: c.y, waffe }, 'spieler');
  g.kaempfer.push(k); return k;
}
function gegner(g, id, rolle, tx, ty) {
  const c = Physics.tileCenter(tx, ty);
  const k = Waffen.ausstatten(g, { id, x: c.x, y: c.y }, rolle);
  g.kaempfer.push(k); return k;
}
const DT = 1 / 30;
function lauf(g, ks, sek, each) {
  const steps = Math.round(sek / DT);
  for (let i = 0; i < steps; i++) { g.time = Math.round((g.time + DT) * 1e6) / 1e6; for (const k of ks) Waffen.update(g, k, DT); if (each) each(); }
}
const ev = (g, name) => g.events.filter((e) => e.name === name);
// Feuert im festen Rhythmus `takt` s (bzw. so schnell wie möglich), bis überhitzt oder `max` Schüsse
function rhythmus(g, k, takt, max) {
  let schuesse = 0, maxHitze = 0, naechster = 0;
  for (let i = 0; i < Math.round(max * Math.max(takt, 1.5) / DT) + 300 && schuesse < max; i++) {
    g.time = Math.round((g.time + DT) * 1e6) / 1e6;
    Waffen.update(g, k, DT);
    if (Waffen.ueberhitzt(g, k)) return { ueberhitzt: schuesse, maxHitze: 1 };
    if (g.time + 1e-9 >= naechster && !Waffen.kannFeuern(g, k)) {
      Waffen.feuern(g, k, { angle: 0 });
      if (k.ladung) { lauf(g, [k], 2.05); Waffen.loslassen(g, k); }
      if (k.ausholen) lauf(g, [k], k.ausholen.dauer + 0.01);
      schuesse++; naechster = g.time + takt;
      maxHitze = Math.max(maxHitze, k.hitze);
      if (Waffen.ueberhitzt(g, k)) return { ueberhitzt: schuesse, maxHitze: 1 };
    }
  }
  return { ueberhitzt: 0, schuesse, maxHitze };
}

console.log('\n[Hitzekurven je Waffe (Startwerte)]');
{
  const erwartet = { blaster: [5, 7], sturmgewehr: [12, 12], granatwerfer: [2, 4], lanze: [1, 1], nahkampf: [3, 3], betaeuber: [4, 4], faust: [4, 4] };
  for (const w of Object.keys(erwartet)) {
    const g = welt(); const k = spieler(g, 'p', 5, 5, w);
    const r = rhythmus(g, k, 0, 40);
    const [lo, hi] = erwartet[w];
    ok(r.ueberhitzt >= lo && r.ueberhitzt <= hi, `${w}: Dauerfeuer überhitzt nach ${r.ueberhitzt} Schuss (erwartet ${lo}–${hi})`);
  }
  // Sperre und Abkühlung
  const g = welt(); const k = spieler(g, 'p', 5, 5, 'blaster');
  rhythmus(g, k, 0, 40);
  ok(ev(g, 'ueberhitzt').length === 1 && Waffen.kannFeuern(g, k) === 'ueberhitzt', 'überhitzt: Ereignis ueberhitzt, Waffe gesperrt');
  ok(Waffen.snapFelder(g, k).ov === 1 && Waffen.snapFelder(g, k).ht === 100, 'Snapshot ov=1, ht=100 während der Sperre');
  lauf(g, [k], g.C.awayCombat.waffen.blaster.sperre + 0.05);
  ok(k.hitze === 0 && Waffen.kannFeuern(g, k) === null, 'nach `sperre` s: Hitze 0, Waffe frei');
  Waffen.feuern(g, k, { angle: 0 });
  const h1 = k.hitze;
  lauf(g, [k], g.C.awayCombat.waffen.blaster.pause - 0.05);
  ok(k.hitze === h1, 'innerhalb von `pause` keine Abkühlung');
  lauf(g, [k], g.C.awayCombat.waffen.blaster.kalt + 0.2);
  ok(k.hitze === 0, 'danach kühlt sie in `kalt` s von 1 auf 0 (hier von 0,2 auf 0)');
}

console.log('\n[Normaler Rhythmus (Pflicht B2 §0)]');
{
  const g = welt(); const k = spieler(g, 'p', 5, 5, 'blaster');
  const r = rhythmus(g, k, 0.6, 60);
  ok(r.ueberhitzt === 0 && r.schuesse === 60, `Blaster 1 Schuss / 0,6 s: 60 Schuss ohne Überhitzung (max. Hitze ${Math.round(r.maxHitze * 100)} %)`);
  const g2 = welt(); const e = gegner(g2, 'e', 'grundtyp', 5, 5);
  const r2 = rhythmus(g2, e, g2.C.awayCombat.gegner.grundtyp.rhythmus, 40);
  ok(r2.ueberhitzt === 0, `Grundtyp (Blaster, ${g2.C.awayCombat.gegner.grundtyp.rhythmus} s): überhitzt nie`);
  // Befunde für die KI-Profile (BODENKAMPF), nur ausgegeben
  const g3 = welt(); const h = gegner(g3, 'h', 'haescher', 5, 5);
  const r3 = rhythmus(g3, h, g3.C.awayCombat.gegner.haescher.rhythmus, 60);
  console.log(`  info Häscher (Betäuber, 1 Schuss/${g3.C.awayCombat.gegner.haescher.rhythmus} s): ` + (r3.ueberhitzt ? `überhitzt nach ${r3.ueberhitzt} Schuss` : 'überhitzt nie'));
  const g4 = welt(); const gr = gegner(g4, 'g', 'grenadier', 5, 5);
  const r4 = rhythmus(g4, gr, g4.C.awayCombat.gegner.grenadier.rhythmus, 30);
  ok(r4.ueberhitzt === 0, 'Grenadier (1 Wurf / 3 s): überhitzt nie');
}

console.log('\n[Gleiche Regel für Spieler und Gegner]');
{
  const g = welt(); const p = spieler(g, 'p', 5, 5, 'blaster'); const e = gegner(g, 'e', 'grundtyp', 9, 5);
  for (let i = 0; i < 3; i++) { Waffen.feuern(g, p, { angle: 0 }); Waffen.feuern(g, e, { angle: Math.PI }); lauf(g, [p, e], 0.35); }
  ok(p.hitze === e.hitze && p.hitze > 0, `Hitze nach 3 Schuss gleich (Spieler ${p.hitze}, Gegner ${e.hitze})`);
  const qs = g.away.projectiles;
  ok(qs.length === 6 && qs.filter((q) => q.team === 'player').length === 3 && qs.every((q) => q.waffe === 'blaster' && q.wirkung && q.seite), 'Projektile mit waffe, team (alt) und seite');
  ok(near(qs[0].ttl * qs[0].speed, 13 * TILE, 0.01), 'Blaster-Reichweite 13 Kacheln (ttl × tempo)');
  // Spieler fällt nach 4 Blaster-Treffern (3 Seg + 1 Wunde)
  const W = { waffe: 'blaster', schaden: 1 };
  const res = []; for (let i = 0; i < 4; i++) res.push(Waffen.treffer(g, p, W, { team: 'feind', x: e.x, y: e.y }));
  ok(res.join(',') === 'schild,schild,schild,gefallen' && p.zustand === 'verwundet', 'Spieler: 3 Seg + 1 Wunde → fällt nach 4 Treffern (' + res.join(',') + ')');
  const res2 = []; for (let i = 0; i < 4; i++) res2.push(Waffen.treffer(g, e, W, { team: 'crew', x: p.x, y: p.y }));
  ok(res2.join(',') === res.join(',') && e.zustand === 'verwundet', 'Grundtyp: gleiche Folge (' + res2.join(',') + ')');
  ok(Waffen.treffer(g, p, W, { team: 'feind', x: 0, y: 0 }) === 'ignoriert', 'Liegende werden von Direkttreffern ignoriert');
  // Gegner liegt, Kamerad richtet auf; ohne Hilfe nach gegnerBleedout `aus`
  const e2 = gegner(g, 'e2', 'grundtyp', 10, 5);
  ok(Waffen.aufrichten(g, e, p) === 'gegenseite', 'Gegenseite kann nicht aufrichten');
  ok(Waffen.aufrichten(g, e, e2) === null && e.zustand === 'ok' && e.wunden.n === 1 && e.schild.seg === 1 && ev(g, 'aufgerichtet').length === 1, 'Kamerad richtet Gegner auf (1 Wunde, 1 Seg)');
  for (let i = 0; i < 2; i++) Waffen.treffer(g, e, W, { team: 'crew', x: p.x, y: p.y });
  ok(e.zustand === 'verwundet', 'erneut gefallen');
  lauf(g, [e], g.C.awayCombat.koerper.gegnerBleedout + 0.1);
  ok(e.zustand === 'aus', `Gegner nach ${g.C.awayCombat.koerper.gegnerBleedout} s ohne Hilfe: aus`);
  ok(Waffen.aufrichten(g, e, e2) === 'nicht_verwundet', 'wer aus ist, kann nicht mehr aufgerichtet werden');
  ok(p.zustand === 'verwundet', 'Spieler bleibt verwundet (Ausbluten/Notrückholung macht combat.js wie heute)');
}

console.log('\n[Wächter 4 + 2, Frontschild, Nahkampf, Lanze]');
{
  const g = welt(); const w = gegner(g, 'w', 'waechter', 10, 5); w.facing = Math.PI;   // schaut nach links
  const vorn = { team: 'crew', x: w.x - 5 * TILE, y: w.y }, hinten = { team: 'crew', x: w.x + 5 * TILE, y: w.y };
  const B = { waffe: 'blaster', schaden: 1 };
  ok(Waffen.treffer(g, w, B, vorn) === 'abgelenkt' && ev(g, 'abgelenkt').length === 1 && w.schild.seg === 4, 'Blaster von vorn: abgelenkt');
  ok(Waffen.treffer(g, w, { waffe: 'nahkampf', wunde: true }, vorn) === 'abgelenkt', 'Nahkampf von vorn: abgelenkt (E14)');
  const res = []; for (let i = 0; i < 6; i++) res.push(Waffen.treffer(g, w, B, hinten));
  ok(res.join(',') === 'schild,schild,schild,schild,wunde,gefallen', 'von hinten: 4 Seg + 2 Wunden = 6 Treffer (' + res.join(',') + ')');
  const w2 = gegner(g, 'w2', 'waechter', 10, 8); w2.facing = Math.PI;
  ok(Waffen.treffer(g, w2, { waffe: 'nahkampf', wunde: true }, hinten) === 'wunde' && w2.schild.seg === 4 && w2.wunden.n === 1, 'Nahkampf von hinten: Wunde, Schild ignoriert');
  ok(Waffen.treffer(g, w2, { waffe: 'lanze', schaden: 2, durchschlagFront: true }, vorn) === 'schild' && w2.schild.seg === 2, 'Lanze durchschlägt den Frontschild (2 Seg)');
  ok(Waffen.treffer(g, w2, { strike: true, schaden: 1 }, vorn) === 'schild', 'Orbitalschlag geht durch die Front');
  // Wächterschuss: 2 Segmente
  const d = Waffen.def(g, 'waechter');
  ok(d && d.schaden === 2 && d.streuung === 0, 'Wächterwaffe: Blaster-Regeln mit 2 Seg je Schuss');
  // Nahkampf echt: Ausholen → Schlag im Bogen, eine Wunde
  const g2 = welt(); const ber = gegner(g2, 'b', 'enterer', 5, 5); const p = spieler(g2, 'p', 6, 5, 'blaster');
  const freund = gegner(g2, 'f', 'grundtyp', 6, 5); freund.y += 4;
  ok(Waffen.feuern(g2, ber, p) === null && ber.ausholen && ev(g2, 'ausholen').length === 1 && ev(g2, 'ausholen')[0].winkel === 0, 'Enterer holt aus (Ereignis ausholen mit winkel)');
  lauf(g2, [ber, p, freund], 0.3);
  ok(Waffen.snapFelder(g2, ber).wu > 0 && p.wunden.n === 1, 'während des Ausholens kein Treffer, Snapshot wu > 0');
  lauf(g2, [ber, p, freund], 0.25);
  ok(ev(g2, 'schlag').length === 1 && p.zustand === 'verwundet' && p.wunden.n === 0, 'Schlag nach 0,5 s: Spieler fällt trotz vollem Schild (1 Wunde)');
  ok(freund.wunden.n === 1 && freund.zustand === 'ok', 'Schlag trifft keinen Verbündeten (kein Friendly Fire direkt)');
  // Ankündigungsregel: Nahkampf nie unter 0,5 s, auch per tune
  combat.tune(g2, 'waffen.nahkampf.ausholen', 0.1);
  const ber2 = gegner(g2, 'b2', 'enterer', 20, 20);
  Waffen.feuern(g2, ber2, { angle: 0 });
  ok(near(ber2.ausholen.dauer, g2.C.awayCombat.koerper.ankuendigung), 'Ankündigung: Ausholen ≥ 0,5 s trotz tune 0,1');
  combat.tune(g2, 'waffen.faust.ausholen', 0.1);
  const pf = spieler(g2, 'pf', 22, 22, 'faust'); Waffen.feuern(g2, pf, { angle: 0 });
  ok(near(pf.ausholen.dauer, 0.1), 'Faust (1 Seg, kein Schildbruch) darf kürzer sein');
  // Lanze: Laden, Stufen, Strahl, Durchschlag
  const g3 = welt(); const s = spieler(g3, 's', 2, 5, 'lanze'); const w3 = gegner(g3, 'w3', 'waechter', 20, 5); w3.facing = Math.PI;
  const vor = gegner(g3, 'v', 'grundtyp', 12, 9);
  ok(Waffen.feuern(g3, s, w3) === null && s.ladung && ev(g3, 'ladungLanze').length === 1, 'Lanze: Laden beginnt, Leuchten + Zielstrahl (ladungLanze)');
  lauf(g3, [s], 1.05); ok(s.ladung.stufe === 1, 'nach 1,0 s Stufe 1');
  lauf(g3, [s], 1.0); ok(s.ladung.stufe === 2 && Waffen.snapFelder(g3, s).ch === 100, 'nach 2,0 s Stufe 2 (ch 100)');
  ok(Waffen.loslassen(g3, s) === null && w3.schild.seg === 2 && ev(g3, 'lanzeSchuss')[0].stufe === 2, 'Strahl: 2 Seg durch die Front des Wächters');
  ok(vor.schild.seg === 3, 'Strahl trifft nur auf der Linie');
  ok(Waffen.ueberhitzt(g3, s), 'volle Ladung = 100 % Hitze → Sperre');
  // Wand sperrt den Strahl
  const g4 = welt(); const s4 = spieler(g4, 's', 2, 5, 'lanze'); const z4 = gegner(g4, 'z', 'grundtyp', 12, 5);
  g4.wand = () => true;
  Waffen.feuern(g4, s4, z4); lauf(g4, [s4], 1.05); Waffen.loslassen(g4, s4);
  ok(z4.schild.seg === 3, 'Wand stoppt den Lanzenstrahl');
  ok(Waffen.loslassen(g4, s4) === 'keine_ladung', 'loslassen ohne Ladung: Grund');
}

console.log('\n[Schrottblaster (Plünderer/Rostmeute)]');
{
  const g = welt(); const sb = spieler(g, 's', 5, 5, 'schrottblaster'); const b = spieler(g, 'b', 5, 9, 'blaster');
  const ds = Waffen.def(g, 'schrottblaster'), db = Waffen.def(g, 'blaster');
  ok(ds && ['schuss', 'kadenz', 'pause', 'kalt', 'sperre'].every((f) => ds[f] === db[f]), 'gleiche Hitzewerte wie der Blaster');
  const r1 = rhythmus(g, sb, 0, 40), r2 = rhythmus(g, b, 0, 40);
  ok(r1.ueberhitzt === r2.ueberhitzt && r1.ueberhitzt > 0, `gleiche Hitzekurve: Dauerfeuer überhitzt nach ${r1.ueberhitzt} Schuss wie der Blaster`);
  const g2 = welt(); const k = spieler(g2, 's', 5, 5, 'schrottblaster');
  ok(rhythmus(g2, k, 0.6, 30).ueberhitzt === 0, 'Rhythmus 0,6 s überhitzt nie');
  const q = g2.away.projectiles[0];
  ok(q.speed === 230 && q.speed < db.tempo && near(q.ttl * q.speed, ds.reichweite * TILE, 0.01), 'langsameres Geschoss (230 px/s), gleiche Reichweite');
  ok(ds.streuung === 3 && q.wirkung.schaden === 1, 'Streuung 3°, 1 Segment');
}

console.log('\n[Sturmgewehr ½ Segment, Schildladen-Reset]');
{
  const g = welt(); const e = gegner(g, 'e', 'niederhalter', 5, 5);
  const S = { waffe: 'sturmgewehr', schaden: 0.5, schildReset: true };
  g.time = 10;
  ok(Waffen.treffer(g, e, S, { team: 'crew', x: 0, y: 0 }) === 'schild' && e.schild.seg === 2.5 && e.schild.lastHitAt === 10, 'ein Treffer = ½ Seg, lastHitAt gesetzt');
  e.schild.regenT = 1.2; g.time = 13.5;
  Waffen.treffer(g, e, S, { team: 'crew', x: 0, y: 0 });
  ok(e.schild.lastHitAt === 13.5 && e.schild.regenT === 0, 'jeder Treffer setzt das Schildladen zurück');
  let n2 = 2; while (e.schild.seg > 0) { Waffen.treffer(g, e, S, { team: 'crew', x: 0, y: 0 }); n2++; }
  ok(n2 === 6, '3 Segmente = 6 Treffer');
  ok(Waffen.treffer(g, e, S, { team: 'crew', x: 0, y: 0 }) === 'gefallen', 'ohne Schild: ½-Treffer kostet eine ganze Wunde');
  // Streuung wächst mit der Hitze
  const g2 = welt(); const p = spieler(g2, 'p', 5, 5, 'sturmgewehr');
  const winkel = []; for (let i = 0; i < 11; i++) { Waffen.feuern(g2, p, { angle: 0 }); lauf(g2, [p], 0.15); winkel.push(Math.abs(g2.away.projectiles[i].angle)); }
  ok(Math.max(...winkel) * 180 / Math.PI <= 14 + 1e-6 && Math.max(...winkel.slice(0, 2)) * 180 / Math.PI <= 6 + 1e-6, 'Streuung 6° kalt → bis 14° heiß');
  // Schild laden mit halben Segmenten bleibt ≤ max
  const k = { zustand: 'ok', schild: { seg: 2.5, max: 3, lastHitAt: 0, regenT: 0 } }; g2.time = 100;
  Waffen.schildUpdate(g2, k, 2, { regenDelay: 4, regenStep: 1.5 });
  ok(k.schild.seg === 3, 'Schild lädt von 2,5 auf höchstens 3');
}

console.log('\n[Betäuber → bewusstlos, Fesseln, Befreien]');
{
  const g = welt(); const p = spieler(g, 'p', 5, 5, 'betaeuber'); const e = gegner(g, 'e', 'grundtyp', 9, 5); const e2 = gegner(g, 'e2', 'grundtyp', 9, 7);
  const B = { waffe: 'betaeuber', schaden: 1, nichttoedlich: true };
  const res = []; for (let i = 0; i < 4; i++) res.push(Waffen.treffer(g, e, B, { team: 'crew', x: p.x, y: p.y }));
  ok(res.join(',') === 'schild,schild,schild,bewusstlos' && e.zustand === 'bewusstlos' && e.wunden.n === 1, 'Schild wie Blaster, ohne Schild bewusstlos statt Wunde');
  ok(Waffen.aufrichten(g, e, e2) === 'nicht_verwundet', 'Bewusstlose kann niemand aufrichten');
  ok(Waffen.fesseln(g, e, e2) === 'eigene_seite', 'Fesseln nur durch die Gegenseite');
  lauf(g, [e], 29.9); ok(e.zustand === 'bewusstlos', 'nach 29,9 s noch bewusstlos');
  lauf(g, [e], 0.2); ok(e.zustand === 'ok' && e.schild.seg === 1, 'nach 30 s wach mit 1 Segment');
  for (let i = 0; i < 2; i++) Waffen.treffer(g, e, B, { team: 'crew', x: p.x, y: p.y });
  ok(Waffen.fesseln(g, e, p) === null && e.zustand === 'gefesselt' && ev(g, 'gefesselt')[0].durch === 'p', 'Spieler fesselt den bewusstlosen Gegner');
  lauf(g, [e], 40); ok(e.zustand === 'gefesselt', 'Gefesselte wachen nicht auf');
  ok(Waffen.treffer(g, e, { schaden: 1, flaeche: true }, { team: 'crew', x: e.x, y: e.y }) === 'ignoriert', 'Gefesselte sind aus dem Gefecht');
  ok(Waffen.befreien(g, e, p) === 'gegenseite' && Waffen.befreien(g, e, e2) === null && e.zustand === 'ok' && ev(g, 'befreit').length === 1, 'Kamerad befreit, Gegenseite nicht');
  // dieselbe Regel für Spieler: Häscher betäubt und fesselt
  const h = gegner(g, 'h', 'haescher', 12, 5);
  for (let i = 0; i < 4; i++) Waffen.treffer(g, p, B, { team: 'feind', x: h.x, y: h.y });
  ok(p.zustand === 'bewusstlos' && Waffen.fesseln(g, p, h) === null && p.zustand === 'gefesselt', 'Häscher betäubt und fesselt einen Spieler');
  ok(Waffen.kannFeuern(g, p) === 'zustand' && Waffen.snapFelder(g, p).zs === 'gefesselt', 'gefesselter Spieler kann nicht feuern, zs = gefesselt');
  ok(Waffen.haltedauer(g, 'fesseln') === 3 && Waffen.haltedauer(g, 'aufrichten') === 4, 'Haltedauern aus koerper');
}

console.log('\n[Granate: Fläche, über Deckung, Betäubung, Friendly Fire]');
{
  const g = welt(); const gr = gegner(g, 'g', 'grenadier', 2, 5); const freund = gegner(g, 'f', 'grundtyp', 10, 6);
  const p = spieler(g, 'p', 10, 5, 'blaster'); const weit = spieler(g, 'p2', 14, 5, 'blaster');
  ok(Waffen.feuern(g, gr, p) === null, 'Wurf auf 8 Kacheln');
  const q = g.away.projectiles[0];
  ok(q.kind === 'granate' && q.flug === 0.8 && Math.hypot(q.tx - p.x, q.ty - p.y) <= 0.5 * TILE * Math.SQRT2 + 1e-6 && ev(g, 'granate').length === 1, 'Projektil granate mit tx, ty, flug; Streuung ±0,5 Kachel; Ereignis granate');
  // Zielkachel zwischen p und freund festlegen, damit beide im Radius liegen
  q.tx = p.x; q.ty = p.y + TILE / 2;
  g.wand = () => false;
  ok(Waffen.granateFlug(g, q, 0.5) === false && p.schild.seg === 3, 'kein Treffer im Flug');
  ok(Waffen.granateFlug(g, q, 0.31) === true && ev(g, 'granateEinschlag').length === 1 && ev(g, 'granateEinschlag')[0].radius === 1.5, 'nach 0,8 s Einschlag (granateEinschlag mit radius 1,5 Kacheln)');
  ok(p.schild.seg === 2 && freund.schild.seg === 2, 'Fläche trifft Spieler UND Verbündeten des Werfers (Friendly Fire)');
  ok(weit.schild.seg === 3, 'außerhalb von 1,5 Kacheln kein Schaden');
  ok(Waffen.betaeubt(g, p) && Waffen.betaeubt(g, freund) && Waffen.kannFeuern(g, p) === 'betaeubt' && !Waffen.handlungsfaehig(g, p), 'Betäubung 1,5 s: kein Schuss, keine Bewegung');
  lauf(g, [p, freund], 1.55);
  ok(!Waffen.betaeubt(g, p) && Waffen.kannFeuern(g, p) === null, 'nach 1,5 s wieder handlungsfähig');
  // Direkter Schuss auf Verbündeten: ignoriert (beide Seiten)
  ok(Waffen.treffer(g, freund, { waffe: 'blaster', schaden: 1 }, { team: 'feind', x: gr.x, y: gr.y }) === 'ignoriert', 'Gegner-Blaster trifft keinen Verbündeten');
  ok(Waffen.treffer(g, weit, { waffe: 'blaster', schaden: 1 }, { team: 'crew', x: p.x, y: p.y }) === 'ignoriert', 'Spieler-Blaster trifft keinen Mitspieler');
  // Werfer selbst im Radius
  const ex = Waffen.explosion(g, gr.x, gr.y, { waffe: 'granatwerfer', schaden: 1, flaeche: true, radius: 1.5, betaeubt: 1.5 }, { team: 'feind' });
  ok(ex.some((o) => o.id === 'g' && o.ergebnis === 'schild'), 'eigene Granate trifft auch den Werfer');
  // Wand sperrt die Fläche
  g.wand = () => true;
  ok(Waffen.explosion(g, p.x, p.y, { schaden: 1, flaeche: true, radius: 1.5 }, { team: 'feind' }).length === 0, 'Wand zwischen Einschlag und Figur sperrt die Fläche');
}

console.log('\n[Unterbrechen (E13), für Spieler und Gegner]');
{
  const g = welt(); const s = spieler(g, 's', 2, 5, 'lanze'); const j = gegner(g, 'j', 'schuetze', 20, 5);
  Waffen.feuern(g, s, j); Waffen.feuern(g, j, s); lauf(g, [s, j], 0.8);
  Waffen.treffer(g, s, { waffe: 'blaster', schaden: 1 }, { team: 'feind', x: j.x, y: j.y });
  Waffen.treffer(g, j, { waffe: 'blaster', schaden: 1 }, { team: 'crew', x: s.x, y: s.y });
  ok(!s.ladung && !j.ladung && s.unterbrochen.grund === 'treffer' && j.unterbrochen.grund === 'treffer', 'Treffer bricht Laden ab (Spieler und Schütze)');
  ok(s.hitze === 0 && Waffen.loslassen(g, s) === 'keine_ladung', 'abgebrochene Ladung: kein Schuss, keine Hitze');
  Waffen.feuern(g, s, j); lauf(g, [s], 0.3); s.x += 10; lauf(g, [s], DT);
  ok(!s.ladung && s.unterbrochen.grund === 'bewegt', 'Bewegen bricht das Laden ab');
  Waffen.feuern(g, s, j); lauf(g, [s], 0.5); Waffen.loslassen(g, s);
  ok(ev(g, 'lanzeSchuss').length === 0, 'Loslassen unter Stufe 1: kein Schuss');
  const b = gegner(g, 'b', 'enterer', 30, 5); const p = spieler(g, 'p', 31, 5, 'nahkampf'); g.kaempfer = [b, p];
  Waffen.feuern(g, b, p); Waffen.feuern(g, p, b); lauf(g, [b, p], 0.3);
  Waffen.treffer(g, b, { waffe: 'blaster', schaden: 1 }, { team: 'crew', x: p.x, y: p.y });
  lauf(g, [b, p], 0.3);
  ok(!b.ausholen && ev(g, 'schlag').length === 1 && b.wunden.n === 1 && p.zustand === 'ok', 'Treffer bricht Ausholen des Enterers ab, der Spieler schlägt durch');
  ok(b.wunden.n === 1 && b.wunden.max === 2, 'Enterer: Spieler-Schlag ignoriert den Schild und kostet 1 von 2 Wunden');
  ok(Waffen.unterbrechen(g, p, 'test') === false, 'unterbrechen ohne Aktion: false');
  const a = gegner(g, 'a', 'enterer', 40, 5); g.kaempfer.push(a);
  Waffen.feuern(g, a, { angle: 0 });
  ok(Waffen.treffer(g, a, { waffe: 'blaster', schaden: 1 }, { team: 'feind', x: 0, y: 0 }) === 'ignoriert' && a.ausholen, 'Friendly-Fire-Schuss (ignoriert) unterbricht nicht');
}

console.log('\n[Lärm (B2 §0.14)]');
{
  const g = welt();
  const radien = { blaster: 10, sturmgewehr: 18, granatwerfer: 18, lanze: 4, nahkampf: 3, betaeuber: 4, faust: 3 };
  for (const [w, kach] of Object.entries(radien)) {
    const k = spieler(g, 'p' + w, 5, 5, w);
    g.away.laerm = [];
    Waffen.feuern(g, k, { x: k.x + 8 * TILE, y: k.y });
    if (k.ladung) { lauf(g, [k], 1.05); Waffen.loslassen(g, k); }
    if (k.ausholen) lauf(g, [k], 0.7);
    const l = g.away.laerm[0];
    ok(l && l.kacheln === kach && l.radius === kach * TILE, `${w}: Lärm ${kach} Kacheln`);
  }
  const l = Waffen.laerm(g, 100, 100, 'laut');
  ok(Waffen.hoert(l, 100 + 18 * TILE, 100) && !Waffen.hoert(l, 100 + 18 * TILE + 1, 100), 'hoert: genau bis zum Radius');
  for (let i = 0; i < 40; i++) Waffen.laerm(g, 0, 0, 'nah');
  ok(g.away.laerm.length === 32, 'Lärmpuffer begrenzt (32)');
}

console.log('\n[Sicht und Reichweite (E16)]');
{
  const g = welt(); const p = spieler(g, 'p', 0, 0, 'lanze');
  const at = (kach) => ({ x: p.x + kach * TILE, y: p.y });
  ok(Waffen.sichtPruefen(g, p, at(8), { sichtlinie: true }) === null, '8 Kacheln mit Sichtlinie: ja');
  ok(Waffen.sichtPruefen(g, p, at(8), { sichtlinie: false }) === 'keine_sicht', '8 Kacheln ohne Sichtlinie: keine_sicht');
  ok(Waffen.sichtPruefen(g, p, at(15), { sichtlinie: true }) === 'zu_weit', '15 Kacheln ohne Aussicht: zu_weit');
  ok(Waffen.sichtPruefen(g, p, at(15), { sichtlinie: true, aussicht: true }) === null, '15 Kacheln vom aussicht-Anker: ja');
  ok(Waffen.sichtPruefen(g, p, at(15), { geteilt: true }) === null, '15 Kacheln mit geteilter Sicht (Markierung/Funk): ja');
  ok(Waffen.sichtPruefen(g, p, at(23), { aussicht: true, sichtlinie: true }) === 'reichweite', 'über Lanzen-Reichweite 22: reichweite');
  const b = spieler(g, 'b', 0, 0, 'blaster');
  ok(Waffen.sichtPruefen(g, b, { x: b.x + 14 * TILE, y: b.y }, { geteilt: true }) === 'reichweite', 'Blaster 14 Kacheln: über Reichweite 13');
  const gr = spieler(g, 'g', 0, 0, 'granatwerfer');
  ok(Waffen.sichtPruefen(g, gr, { x: gr.x + 3 * TILE, y: gr.y }, { sichtlinie: true }) === 'zu_nah', 'Granatwerfer 3 Kacheln: zu_nah');
  g.time = 5; ok(Waffen.geteiltBis(g) === 5 + g.C.awayCombat.sicht.geteiltTtl, 'geteilte Sicht hält geteiltTtl s');
}

console.log('\n[tune wirkt sofort]');
{
  const g = welt(); const k = spieler(g, 'p', 5, 5, 'blaster');
  ok(combat.tune(g, 'waffen.blaster.schuss', 3).ok && combat.tune(g, 'waffen.blaster.pause', 1).ok, 'tune waffen.blaster.schuss 3, pause 1');
  ok(rhythmus(g, k, 0, 20).ueberhitzt === 3, 'Blaster überhitzt jetzt nach 3 Schuss');
  combat.tune(g, 'laerm.mittel', 6);
  ok(Waffen.laerm(g, 0, 0, 'mittel').kacheln === 6, 'tune laerm.mittel 6');
  combat.tune(g, 'koerper.bewusstlos', 5);
  const e = gegner(g, 'e', 'grundtyp', 9, 5); e.schild.seg = 0;
  Waffen.treffer(g, e, { schaden: 1, nichttoedlich: true }, { team: 'crew', x: 0, y: 0 });
  lauf(g, [e], 5.1); ok(e.zustand === 'ok', 'tune koerper.bewusstlos 5: wacht nach 5 s auf');
  combat.tune(g, 'gegner.waechter.wunden', 3);
  ok(gegner(g, 'w', 'waechter', 1, 1).wunden.max === 3, 'tune gegner.waechter.wunden 3');
  combat.tune(g, 'waffen.sturmgewehr.schaden', 1);
  const ns = spieler(g, 'ns', 1, 9, 'sturmgewehr'); Waffen.feuern(g, ns, { angle: 0 });
  ok(g.away.projectiles[g.away.projectiles.length - 1].wirkung.schaden === 1, 'tune waffen.sturmgewehr.schaden 1');
}

console.log('\n[Waffenwahl, Hash, Weltstand crew.waffen (E26)]');
{
  const g = welt();
  const h = Waffen.hashKennung('browser-abc');
  ok(/^[0-9a-f]{12}$/.test(h) && h === Waffen.hashKennung('browser-abc') && h !== Waffen.hashKennung('browser-abd'), 'hashKennung: 12 Hex-Zeichen, stabil');
  const p = { id: 'P1', name: 'Kai', clientId: 'browser-abc' };
  ok(Waffen.waffeFuer(g, p) === 'blaster', 'neuer Spieler startet mit Blaster');
  ok(Waffen.waffeSetzen(g, p, 'lanze') === null && p.waffe === 'lanze' && ev(g, 'loadout')[0].waffe === 'lanze', 'waffeSetzen + Ereignis loadout');
  ok(Waffen.waffeSetzen(g, p, 'kanone') === 'unbekannt' && Waffen.waffeSetzen(g, p, 'waechter') === 'unbekannt', 'unbekannte Waffe abgelehnt');
  Waffen.waffeSetzen(g, p, 'faust');
  const save = Waffen.toSave(g);
  ok(save[h] === 'lanze' && Object.keys(save).length === 1 && !JSON.stringify(save).includes('Kai'), 'crew.waffen: Hash → Waffe, faust (Zelle) nicht gespeichert, kein Name');
  const g2 = welt();
  Waffen.restore(Object.assign({ kaputt: 'blaster', '0123456789ab': 'kanone' }, save), g2);
  ok(Waffen.waffeFuer(g2, p) === 'lanze' && Object.keys(Waffen.toSave(g2)).length === 1, 'restore: gültige Einträge übernommen, ungültige verworfen');
  ok(Waffen.aktiv === (process.env.WAFFEN !== 'aus') && !Waffen.stub, 'aktiv standardmäßig, WAFFEN=aus schaltet ab; kein Stub');
}

console.log('\n[B2-NACH: Wurfweite = Zielabstand, Treffer-Rückmeldung getroffen]');
{
  const wurf = (ziel) => {
    const g = welt(); const s = spieler(g, 's', 2, 5, 'granatwerfer'); g.C.awayCombat.waffen.granatwerfer.streuung = 0;
    const r = Waffen.feuern(g, s, ziel); const q = g.away.projectiles[0];
    return { r, kach: q ? Math.hypot(q.tx - s.x, q.ty - s.y) / TILE : null, q, s };
  };
  const a = wurf({ angle: 0 });
  ok(a.r === null && near(a.kach, 12), 'nur Winkel: volle Weite 12 Kacheln (wie bisher)');
  const b = wurf({ angle: 0, dist: 6.5 });
  ok(b.r === null && near(b.kach, 6.5) && near(b.q.ty, b.s.y), 'Winkel + dist 6,5: Landepunkt 6,5 Kacheln in Blickrichtung');
  ok(near(wurf({ angle: 0, dist: 30 }).kach, 12), 'dist über max: auf 12 Kacheln begrenzt');
  ok(near(wurf({ angle: Math.PI / 2, dist: 1 }).kach, 4) && near(wurf({ angle: 0, dist: 0 }).kach, 4), 'dist unter min: auf 4 Kacheln (min) angehoben, Richtung bleibt');
  const s0 = wurf({ angle: Math.PI / 2, dist: 0 });
  ok(near(s0.q.tx, s0.s.x) && s0.q.ty > s0.s.y, 'dist 0: Wurf trotzdem in Zielrichtung');
  // Gegner: gleiche Regel über den Zielabstand
  const g = welt(); g.C.awayCombat.waffen.granatwerfer.streuung = 0; const gr = gegner(g, 'g', 'grenadier', 2, 5);
  ok(Waffen.feuern(g, gr, { x: gr.x + 2 * TILE, y: gr.y }) === null && near(Math.hypot(g.away.projectiles[0].tx - gr.x, g.away.projectiles[0].ty - gr.y) / TILE, 4), 'Gegner: Ziel 2 Kacheln -> Landepunkt min 4 (die KI zielt erst ab min, sichtPruefen)');
  // Direktwaffen nutzen nur den Winkel
  const g2 = welt(); const bl = spieler(g2, 'b', 2, 5, 'blaster');
  ok(Waffen.feuern(g2, bl, { angle: 0, dist: 0 }) === null && near(g2.away.projectiles[0].ttl, 13 * TILE / 380, 1e-9), 'Blaster: dist ändert die Reichweite nicht');
  // getroffen-Rückmeldung für Fläche, Strahl, Schlag
  const g3 = welt(); const meld = []; g3.waffenWelt.getroffen = (k, r, w, q) => meld.push([k.id, r, w.waffe, q.team]);
  const sp = spieler(g3, 's', 2, 5, 'lanze'); const z = gegner(g3, 'z', 'grundtyp', 12, 5);
  Waffen.feuern(g3, sp, z); lauf(g3, [sp], 1.1); Waffen.loslassen(g3, sp);
  ok(meld.length === 1 && meld[0][0] === 'z' && meld[0][1] === 'schild' && meld[0][2] === 'lanze' && meld[0][3] === 'crew', 'Lanzentreffer meldet getroffen(ziel, schild, waffe lanze)');
  Waffen.explosion(g3, z.x, z.y, { waffe: 'granatwerfer', schaden: 1, flaeche: true, radius: 1.5 }, { id: 's', team: 'crew' });
  ok(meld.length === 2 && meld[1][0] === 'z' && meld[1][2] === 'granatwerfer', 'Granaten-Fläche meldet getroffen (waffe granatwerfer)');
  const nk = gegner(g3, 'n', 'enterer', 3, 5); Waffen.feuern(g3, nk, sp); lauf(g3, [nk], 0.6);
  ok(meld.length === 3 && meld[2][0] === 's' && meld[2][2] === 'nahkampf', 'Schlag meldet getroffen (waffe nahkampf)');
}


console.log(`\ntest-waffen: ${n - fails}/${n} Prüfungen bestanden` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
