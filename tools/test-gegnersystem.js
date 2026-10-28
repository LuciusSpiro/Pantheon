'use strict';
// SYS-01 C1a-1 „Das Schiff in Zonen“ (Paket C, Gegner): Systemmodell der Gegner.
// Daten (content/kampf/gegner-systeme.json, Schema content/schema/gegner-systeme.schema.json), Zonen je Klasse, jede Waffe genau ein System,
// Integrität = Klassenbudget (alte Hülle), Trefferweg über die Seite des Segments (Schild über 0 fängt ab, ohne Schild trifft ein System der Zone,
// leere Zone -> Mitte, Durchschlag 'zone' -> Mitte), Tod über den Reaktor-Countdown (C1a-2, test-gegner-tod.js), Waffen, Emitter, Schildgenerator,
// Schwellen und Grundwert gemeinsam mit der Lerche (integritaet.js), Snapshot des Ziels, Determinismus über game.rng.
//   node tools/test-gegnersystem.js
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Integ = require('../server/sim/integritaet.js');
const Testhilfe = require('./gegner-testhilfe.js');
const Gegnertod = require('../server/sim/gegnertod.js');
const info = (t) => console.log('  info ' + t);

const ROOT = path.join(__dirname, '..');
const DATEN = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'kampf', 'gegner-systeme.json'), 'utf8'));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'schema', 'gegner-systeme.schema.json'), 'utf8'));

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); } };

const KLASSEN = ['raider', 'korvette', 'fregatte', 'kreuzer', 'sentinel', 'pylon', 'frachter'];   // relay hat kein Modell
const ZONEN = ['bug', 'stb', 'heck', 'bb', 'mitte'];
const SEITE_ZONE = ['bug', 'stb', 'heck', 'bb'];

function newGame(seed) {
  const g = new Game({ noStore: true, seed: seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  g.space.enemies = []; g.space.projectiles = [];
  g.god = false;
  return g;
}
// Gegner an fester Stelle, Blickrichtung 0 (Bug zeigt nach +x), Schilde leer, falls nicht gesetzt
function gegner(g, kind, o) {
  const e = space.spawnEnemy(g, kind, Object.assign({ x: 1500, y: 1500, facing: 0 }, o || {}));
  if (e.sys) { /* Modell angelegt */ }
  return e;
}
// Quelle je Seite (Zone): Bug +x, Steuerbord +y (Winkel positiv), Heck −x, Backbord −y
const QUELLE = { bug: [300, 0], stb: [0, 300], heck: [-300, 0], bb: [0, -300] };
const RICHTUNG = { bug: 'bug', stb: 'stb', heck: 'heck', bb: 'bb' };

// --- Trefferweg aufzeichnen: die Zone jedes Treffers (Gsys.treffen) mitschreiben, ohne das Verhalten zu ändern
function aufzeichnen(fn) {
  const orig = Gsys.treffen; const rec = [];
  Gsys.treffen = (g, e, zone, schaden) => {
    const vorher = Object.fromEntries(Object.keys(e.sys).map((k) => [k, e.sys[k].z]));   // Zustand vor dem Treffer (zerstört darf nie gewählt werden)
    const r = orig(g, e, zone, schaden);
    rec.push({ zone, r, vorher });
    return r;
  };
  try { fn(rec); } finally { Gsys.treffen = orig; }
  return rec;
}

section('Daten: Form (Schema) und Zonen', () => {
  ok(DATEN.format === SCHEMA.properties.format.const, 'format passt zum Schema');
  ok(JSON.stringify(DATEN.zonen) === JSON.stringify(ZONEN), 'Zonen: bug, stb, heck, bb, mitte');
  for (const k of Object.keys(DATEN)) ok(SCHEMA.properties[k] !== undefined || k === '_hinweis', 'Feld ' + k + ' im Schema bekannt');
  const ARTEN = SCHEMA.properties.arten.items.enum;
  const MODULE = SCHEMA.properties.klassen.additionalProperties.properties.systeme.items.properties.modul.enum;
  let formOk = true; const fehler = [];
  for (const [kind, k] of Object.entries(DATEN.klassen)) {
    if (!k.systeme || !k.systeme.length) { formOk = false; fehler.push(kind + ' ohne Systeme'); continue; }
    const ids = new Set();
    for (const s of k.systeme) {
      for (const pf of ['id', 'zone', 'art', 'gewicht']) if (s[pf] === undefined) { formOk = false; fehler.push(kind + '.' + (s.id || '?') + ' ohne ' + pf); }
      for (const key of Object.keys(s)) if (!['id', 'zone', 'art', 'platz', 'modul', 'gewicht', 'name', 'kurz', 'funktion'].includes(key)) { formOk = false; fehler.push(kind + ' Zusatzfeld ' + key); }
      if (!ZONEN.includes(s.zone) || !ARTEN.includes(s.art)) { formOk = false; fehler.push(kind + '.' + s.id + ' Zone/Art'); }
      if (s.art === 'modul' && !MODULE.includes(s.modul)) { formOk = false; fehler.push(kind + '.' + s.id + ' Modul'); }
      if (!(s.gewicht > 0)) { formOk = false; fehler.push(kind + '.' + s.id + ' Gewicht'); }
      if (ids.has(s.id)) { formOk = false; fehler.push(kind + ' Id doppelt ' + s.id); }
      ids.add(s.id);
    }
  }
  ok(formOk, 'Form je System gegen das Schema' + (fehler.length ? ' (' + fehler.slice(0, 3).join('; ') + ')' : ''));
  ok(!DATEN.klassen.relay, 'Relais hat kein Modell (wird nicht zerlegt)');
});

section('Alle Klassen haben die fünf Zonen; Heck mit Antrieb; Mitte mit Reaktor', () => {
  for (const kind of KLASSEN) {
    const S = Gsys.systemeVon(kind) || [];
    const zonen = new Set(S.map((s) => s.zone));
    ok(ZONEN.every((z) => zonen.has(z)), kind + ': alle fünf Zonen besetzt');
    ok(S.some((s) => s.zone === 'heck' && s.art === 'antrieb'), kind + ': Heck hat den Antrieb');
    ok(S.some((s) => s.zone === 'mitte' && s.art === 'reaktor'), kind + ': Mitte hat den Reaktor');
  }
});

section('Jede Waffe in enemyWeapons hat genau ein System (Zone nach Platz)', () => {
  const W = CONFIG.enemyWeapons;
  const zoneVonPlatz = (p) => (p == null || /^bug/.test(p) ? 'bug' : /^stbd/.test(p) ? 'stb' : /^bb/.test(p) ? 'bb' : null);
  for (const kind of KLASSEN) {
    const eintraege = W[kind] || [];
    const S = (Gsys.systemeVon(kind) || []).filter((s) => s.art === 'waffe');
    ok(S.length === eintraege.length, kind + ': ' + eintraege.length + ' Waffen, ' + S.length + ' Waffensysteme');
    for (const w of eintraege) {
      const treffer = S.filter((s) => s.platz === w.platz);
      ok(treffer.length === 1, kind + ' Platz ' + (w.platz || '(ohne)') + ': genau ein System');
      if (treffer.length === 1) ok(treffer[0].zone === zoneVonPlatz(w.platz), kind + ' Platz ' + (w.platz || '(ohne)') + ' liegt in Zone ' + zoneVonPlatz(w.platz));
    }
    for (const s of S) ok(!s.platz || eintraege.some((w) => w.platz === s.platz), kind + ': Waffensystem ' + s.id + ' hat einen Platz in enemyWeapons');
  }
});

section('Schildseiten: ein Emitter je Seite mit Schild (vier Klassen mit vollem Modell)', () => {
  for (const kind of ['raider', 'korvette', 'fregatte', 'kreuzer']) {
    const lay = Schilde.layout(CONFIG, kind);
    const S = Gsys.systemeVon(kind);
    for (let seite = 0; seite < 4; seite++) {
      const hatSchild = lay.seiten[seite].some((i) => lay.max[i] > 0);
      const em = S.some((s) => s.art === 'emitter' && s.zone === SEITE_ZONE[seite]);
      ok(hatSchild === em, kind + ' Seite ' + SEITE_ZONE[seite] + ': Emitter ' + (hatSchild ? 'vorhanden (Schild > 0)' : 'fehlt (kein Schild)'));
    }
  }
});

section('Klassenbudget = alte Hülle (Σ Integrität = hp × Skalierung)', () => {
  const g = newGame(3);
  for (const kind of KLASSEN) {
    const e = gegner(g, kind);
    const erwartet = Math.max(1, Math.round(CONFIG.enemies[kind].hp * space.crewScale(g).enemyHp * (CONFIG.spaceM3.enemyHpFactor || 1)));
    const summe = Object.values(e.sys).reduce((a, s) => a + s.i, 0);
    ok(e.hpMax === erwartet, kind + ': hpMax = hp × crewScale × enemyHpFactor (' + e.hpMax + ' = ' + erwartet + ')');
    ok(Math.abs(summe - e.hpMax) < 1e-6, kind + ': Σ Integrität = Klassenbudget (' + summe.toFixed(4) + ')');
    ok(Math.abs(e.hp - summe) < 1e-6, kind + ': e.hp ist die Summe der Integrität');
    for (const id of Object.keys(e.sys)) if (e.sys[id].z !== 'ok') { ok(false, kind + ' ' + id + ' startet nicht ok'); break; }
  }
  const relay = gegner(g, 'relay');
  ok(relay.sys === undefined && relay.hp === relay.hpMax, 'relay: kein Modell, Hülle wie bisher');
});

section('Trefferweg je Klasse und Richtung: Zone = Seite des Segments', () => {
  for (const kind of KLASSEN) {
    for (const zone of ['bug', 'stb', 'heck', 'bb']) {
      const g = newGame(7);
      const e = gegner(g, kind);
      e.shields.fill(0);   // ohne Schild: der Treffer geht ins System der Zone
      const [dx, dy] = QUELLE[zone];
      const rec = aufzeichnen(() => { for (let i = 0; i < 6; i++) space.damageEnemy(g, e, 0.05, e.x + dx, e.y + dy, {}); });
      const zonen = rec.map((r) => r.zone);
      // Zone ist nicht leer (nichts zerstört), also trifft jeder Treffer genau diese Seite
      const passt = zonen.length === 6 && zonen.every((z) => z === zone);
      ok(passt, kind + ' Richtung ' + zone + ': 6 Treffer in Zone ' + zone + (zonen.length ? ' (' + [...new Set(zonen)].join(',') + ')' : ' (kein Treffer)'));
    }
  }
});

section('Schild über 0 fängt ab: kein Systemschaden, der Rest verfällt', () => {
  const g = newGame(11);
  const e = gegner(g, 'kreuzer');
  const vorher = JSON.stringify(e.sys);
  e.shields[0] = 10;   // Bug-Segment voll
  const rec = aufzeichnen(() => space.damageEnemy(g, e, 3, e.x + 300, e.y, {}));
  ok(rec.length === 0, 'Schild 10 vs. Treffer 3: kein Trefferweg');
  ok(JSON.stringify(e.sys) === vorher, 'kein System verändert');
  ok(Math.abs(e.shields[0] - 7) < 1e-9, 'Schild 10 → 7 (der Treffer wird abgefangen)');
  e.shields[0] = 2;
  const rec2 = aufzeichnen(() => space.damageEnemy(g, e, 5, e.x + 300, e.y, {}));
  ok(rec2.length === 0 && e.shields[0] === 0, 'Schild 2 vs. Treffer 5: Schild 0, Rest verfällt (kein Überlauf ins System)');
  ok(JSON.stringify(e.sys) === vorher, 'auch der Überlauf-Rest trifft kein System');
});

section('Zufall wählt nur nicht zerstörte Systeme; leere Zone -> Mitte', () => {
  const g = newGame(13);
  const e = gegner(g, 'fregatte');
  e.shields.fill(0);
  // Bug-Zone (waffe_bug, emitter_bug) zerstören, Mitte bleibt
  e.sys.waffe_bug.z = 'broken'; e.sys.waffe_bug.i = 0;
  e.sys.emitter_bug.z = 'broken'; e.sys.emitter_bug.i = 0;
  const mitteSumme = () => ['reaktor', 'schildgenerator'].reduce((a, k) => a + e.sys[k].i, 0);
  const mitteVor = mitteSumme();
  const rec = aufzeichnen(() => { for (let i = 0; i < 40; i++) space.damageEnemy(g, e, 0.01, e.x + 300, e.y, {}); });
  // rec.zone = angeforderte Zone (Seite), r.r.zone = tatsächlich getroffene Zone
  const trefferBug = rec.filter((r) => r.r && r.r.zone === 'bug');
  ok(trefferBug.length === 0, 'Bug-Zone leer: kein Treffer landet dort (' + trefferBug.length + ')');
  ok(rec.length === 40 && rec.every((r) => r.zone === 'bug' && r.r && r.r.zone === 'mitte'), 'Zone leer: alle 40 Treffer gehen in die Mitte');
  ok(rec.every((r) => r.r && r.vorher[r.r.id] !== 'broken'), 'nie ein zerstörtes System gewählt');
  ok(mitteSumme() < mitteVor, 'die Mitte nimmt die Integrität (' + mitteVor.toFixed(3) + ' -> ' + mitteSumme().toFixed(3) + ')');
  // Bei nicht leerer Zone wird nie ein zerstörtes System gewählt
  const g2 = newGame(14); const e2 = gegner(g2, 'fregatte'); e2.shields.fill(0);
  e2.sys.waffe_stbd1.z = 'broken'; e2.sys.waffe_stbd1.i = 0;
  const rec2 = aufzeichnen(() => { for (let i = 0; i < 60; i++) space.damageEnemy(g2, e2, 0.01, e2.x, e2.y + 300, {}); });
  ok(rec2.every((r) => r.r && r.vorher[r.r.id] !== 'broken'), 'nicht leere Zone: 60 Treffer, nie das zerstörte Waffensystem');
  ok(rec2.every((r) => r.zone === 'stb'), 'Steuerbord-Treffer bleiben in Steuerbord, solange die Zone Systeme hat');
});

section('Durchschlag zone (Lanze bei Vollladung) trifft direkt die Mitte', () => {
  const g = newGame(17);
  const e = gegner(g, 'kreuzer');
  e.shields.fill(5);   // Schild voll: der Durchschlag geht trotzdem durch
  const rec = aufzeichnen(() => space.damageEnemy(g, e, 4, e.x + 300, e.y, { durchschlag: 'zone' }));
  ok(rec.length === 1 && rec[0].zone === 'mitte', 'Durchschlag zone: Zone mitte');
  ok(e.shields[0] === 5, 'Durchschlag zone umgeht den Schild');
});

section('Tod: zerstörter Reaktor startet den Countdown statt sofort (SYS-01 C1a-2, Details in test-gegner-tod.js)', () => {
  const g = newGame(19);
  const e = gegner(g, 'korvette');
  e.shields.fill(0);
  const kills = () => g.stats.kills;
  const k0 = kills();
  space.damageEnemy(g, e, 0.5, e.x + 300, e.y, {});
  ok(g.space.enemies.includes(e), 'Treffer ohne Reaktorschaden: der Gegner lebt');
  ok(kills() === k0, 'kein Abschuss ohne zerstörten Reaktor');
  Testhilfe.mitteNurReaktor(e); e.sys.reaktor.z = 'damaged'; e.sys.reaktor.i = 0.01; e.hp = Gsys.summe(e);
  space.damageEnemy(g, e, 0.01, e.x + 300, e.y, { durchschlag: 'zone' });   // Durchschlag in die Mitte: der Reaktor fällt über den echten Pfad
  ok(g.space.enemies.includes(e) && kills() === k0, 'zerstörter Reaktor: der Gegner lebt weiter, bis der Countdown abläuft (kein Sofort-Tod mehr)');
  ok(e.rt && e.rt.n === 1 && e.rt.rest != null, 'Countdown gestartet, Ausfallzähler 1');
  ok(Gsys.tot({ kind: 'korvette', hpMax: 1, hp: 0, sys: undefined }) === true, 'tot ohne Modell: Hülle 0');
  ok(Gsys.tot(e) === false, 'tot mit Modell: der zerstörte Reaktor allein ist kein Tod, erst alle Systeme zerstört');
});

section('Waffe: zerstört schießt nicht, beschädigt Takt ×1,5 (Intervall-Faktor aus der Config)', () => {
  const g = newGame(23);
  const r = gegner(g, 'raider');
  ok(space.waffenPlaetze(g, r).length === 1, 'Jäger: eine Waffe vor dem Schaden');
  r.sys.waffe_bug.z = 'broken';
  ok(space.waffenPlaetze(g, r).length === 0, 'Jäger: zerstörte Waffe, keine Plätze mehr');
  r.sys.waffe_bug.z = 'damaged';
  ok(Gsys.taktFaktor(g, r, space.waffenPlaetze(g, r)) === CONFIG.systemModell.gegner.taktBeschaedigt && CONFIG.systemModell.gegner.taktBeschaedigt === 1.5, 'Jäger: beschädigte Waffe, Takt ×1,5 (Wert aus systemModell.gegner)');
  const k = gegner(g, 'korvette');
  k.sys.waffe_stbd.z = 'broken';
  const plaetze = space.waffenPlaetze(g, k).map((w) => w.platz);
  ok(!plaetze.includes('stbd') && plaetze.includes('bug') && plaetze.includes('bb'), 'Korvette: nur die Steuerbord-Waffe fällt aus');
  k.sys.waffe_bb.z = 'damaged';
  const bb = space.waffenPlaetze(g, k).filter((w) => w.platz === 'bb'); const bug = space.waffenPlaetze(g, k).filter((w) => w.platz === 'bug');
  ok(Gsys.taktFaktor(g, k, bb) === 1.5 && Gsys.taktFaktor(g, k, bug) === 1, 'beschädigter Platz: Intervall × 1,5, unbeschädigter Platz: × 1 (kein Schusszähler)');
  ok(!('takt' in k), 'kein Zähler-Zustand am Gegner (e.takt entfällt)');
});

// Takt gemessen im echten Feuerpfad: der Feuerintervall wird mit dem Faktor aus der Config multipliziert (Jäger: Hauptpfad, Korvette: Lanze/Ladung); live per tune
section('Takt: beschädigte Waffe = Feuerintervall × Faktor (Hauptpfad Jäger, Lanze der Korvette), live per tune', () => {
  const g = newGame(41); g.god = true; g.ship.docked = false;   // angedockt feuern Gegner nicht
  const iv = (kind) => CONFIG.enemies[kind].fireInterval * space.crewScale(g).enemyFireInterval;
  // Jäger: Schuss entsteht, wenn e.fireT den Intervall erreicht. Sofort vor dem Tick den Zähler setzen, einen kleinen Tick laufen lassen, Projektil zählen.
  const schiesst = (e, anteil) => {
    g.space.projectiles = []; e.x = g.ship.x + 200; e.y = g.ship.y; e.angle = Math.PI; e.fireT = iv(e.kind) * anteil; e.tele = null; e.retreatUntil = 0;
    space.updateEnemies(g, 1e-4);
    return g.space.projectiles.length > 0 || !!e.tele;
  };
  const r = gegner(g, 'raider'); Testhilfe.schildNull(r);
  const PILOT = require('../server/sim/pilot.js').flies(g, r);
  info(`Jäger fliegt im Pilot-Modell: ${PILOT} (eigener Intervall pilotFire gilt dann als Basis)`);
  const basis = PILOT ? ((CONFIG.spaceM3b.pilotFire || {}).raider || {}).fireInterval / CONFIG.enemies.raider.fireInterval : 1;
  const anteil = (f) => f * (basis || 1);
  ok(schiesst(r, anteil(1.05)), 'Jäger heil: schießt bei Intervall × 1,05');
  r.sys.waffe_bug.z = 'damaged';
  ok(!schiesst(r, anteil(1.05)) && !schiesst(r, anteil(1.45)), 'Jäger beschädigt: schießt nicht bei Intervall × 1,05 und × 1,45');
  ok(schiesst(r, anteil(1.55)), 'Jäger beschädigt: schießt bei Intervall × 1,55 (Faktor 1,5)');
  CONFIG.systemModell.gegner.taktBeschaedigt = 3;
  try {
    ok(!schiesst(r, anteil(2.9)) && schiesst(r, anteil(3.1)), 'tune systemModell.gegner.taktBeschaedigt 3: Jäger schießt erst bei Intervall × 3 (live, keine Zahl im Code)');
  } finally { CONFIG.systemModell.gegner.taktBeschaedigt = 1.5; }
  // Lanze der Korvette (Ladung, startTele): gleicher Faktor auf cfg.fireInterval
  const k = gegner(g, 'korvette', { waffen: { bug: 'lanze', stbd: 'lanze', bb: 'lanze' } }); Testhilfe.schildNull(k);
  ok(CONFIG.spaceM3.tele.korvette, 'Korvette hat eine Ladung (spaceM3.tele)');
  ok(schiesst(k, 1.05), 'Korvette Lanze heil: startet die Ladung bei Intervall × 1,05');
  k.sys.waffe_bug.z = 'damaged'; k.sys.waffe_stbd.z = 'damaged'; k.sys.waffe_bb.z = 'damaged';
  ok(!schiesst(k, 1.05) && !schiesst(k, 1.45), 'Korvette Lanze beschädigt: keine Ladung bei Intervall × 1,05 und × 1,45');
  ok(schiesst(k, 1.55), 'Korvette Lanze beschädigt: Ladung bei Intervall × 1,55 (Faktor 1,5)');
});

section('Emitter und Schildgenerator wirken auf die Schilde', () => {
  const g = newGame(29);
  const k = gegner(g, 'korvette');
  const max = k.shieldsMax.slice();
  k.shields = max.slice();
  k.sys.emitter_bug.z = 'damaged';
  let caps = Gsys.schildGrenzen(g, k);
  ok(Math.abs(caps[0] - max[0] / 2) < 1e-9, 'Emitter Bug beschädigt: Obergrenze halbiert');
  ok(caps[1] === max[1], 'Emitter Steuerbord unberührt');
  Gsys.schildPflege(g, k);
  ok(Math.abs(k.shields[0] - max[0] / 2) < 1e-9, 'Schild über der Grenze wird gekappt');
  k.sys.emitter_bug.z = 'broken';
  caps = Gsys.schildGrenzen(g, k);
  ok(caps[0] === 0, 'Emitter Bug zerstört: Schild dieser Seite 0');
  k.sys.schildgenerator.z = 'damaged';
  ok(Gsys.regenFaktor(g, k) === CONFIG.systemModell.gegner.regenGeneratorBeschaedigt && CONFIG.systemModell.gegner.regenGeneratorBeschaedigt === 2, 'Schildgenerator beschädigt: Regeneration doppelt so langsam');
  k.sys.schildgenerator.z = 'broken';
  caps = Gsys.schildGrenzen(g, k);
  ok(caps.every((c) => c === 0), 'Schildgenerator zerstört: alle Schilde 0');
  const sv = k.shields.slice(); k.regenT = 99;
  space.updateEnemies(g, 0.01);
  ok(k.shields.every((v) => v === 0), 'zerstörter Generator: keine Regeneration (' + sv.join(',') + ' -> ' + k.shields.join(',') + ')');
});

section('Antrieb und Module tragen nur den Zustand (C1a-1)', () => {
  const g = newGame(31);
  const e = gegner(g, 'kreuzer');
  const vor = e.sys.antrieb.i;
  e.sys.antrieb.z = 'broken'; e.sys.antrieb.i = 0;
  ok(vor > 0, 'Antrieb hatte Integrität');
  ok(Math.abs(Gsys.summe(e) - (e.hpMax - vor)) < 1e-6, 'Summe der Integrität ohne den Antrieb (' + Gsys.summe(e).toFixed(3) + ')');
  ok(e.sys.antrieb.z === 'broken' && Gsys.zerstoertPlatz(e, { platz: undefined }) === false, 'Antrieb zerstört: nur der Zustand, keine Waffe betroffen');
});

section('Zustand und Schwelle gemeinsam mit der Lerche (integritaet.js)', () => {
  const max = 10;
  ok(Integ.zustandVon(0, max, 0.6) === 'broken' && Integ.zustandVon(-1, max, 0.6) === 'broken', 'Integrität ≤ 0 -> zerstört');
  ok(Integ.zustandVon(5.9, max, 0.6) === 'damaged', 'unter 60 % -> beschädigt');
  ok(Integ.zustandVon(6, max, 0.6) === 'ok', 'ab 60 % -> ok');
  ok(Integ.grundwertVon('damaged', 12, 0.5) === 6 && Integ.grundwertVon('ok', 12, 0.5) === 12 && Integ.grundwertVon('broken', 12, 0.5) === 0, 'Grundwert: beschädigt 50 %, ok voll, zerstört 0');
  // Systemtreffer: unter 60 % -> beschädigt (nur die Waffe ist in der Bug-Zone frei)
  const g = newGame(37);
  const e = gegner(g, 'raider');
  e.sys.emitter_bug.z = 'broken'; e.sys.emitter_bug.i = 0;
  const maxW = Gsys.maxOf(e, 'waffe_bug');
  e.sys.waffe_bug.i = 0.6 * maxW + 0.01;
  Gsys.treffen(g, e, 'bug', 0.02);
  ok(e.sys.waffe_bug.z === 'damaged', 'unter 60 % des Maximums: beschädigt');
  Gsys.treffen(g, e, 'bug', e.sys.waffe_bug.i + 1);
  ok(e.sys.waffe_bug.z === 'broken' && e.sys.waffe_bug.i === 0, 'Integrität 0: zerstört');
});

section('Snapshot: zielSys nur für das anvisierte Ziel, flach, Zustand 0/1/2', () => {
  const g = newGame(41);
  const e = gegner(g, 'fregatte');
  const z = Gsys.snapshotZiel(e);
  ok(z.length === 2 * Gsys.systemeVon('fregatte').length, 'Länge 2 × Systeme (' + z.length + ')');
  ok(z.every((v, i) => (i % 2 === 0 ? v === 0 || v === 1 || v === 2 : v >= 0 && v <= 100)), 'Zustand 0..2 und Integrität 0..100 %');
  ok(Gsys.snapshotZiel({ kind: 'relay' }) === null, 'Klasse ohne Modell: kein zielSys');
  g.ship.target = e.id;
  ok(Object.keys(g.zielSysSnap()).length === 0, 'ungescannt: kein zielSys im Snapshot (C1b-2: die Systeme sind verborgen, wie weapons und Schilde)');
  e.scanned = true;
  const snap = g.zielSysSnap();
  ok(snap.zielSys && snap.zielSys.length === z.length + 1 && snap.zielSys[z.length] === -1, 'Ziel gesetzt: zielSys im Snapshot, letztes Element -1 (kein Reaktor-Countdown, SYS-01 C1a-2)');
  Gegnertod.brechen(g, e, 'reaktor');
  ok(g.zielSysSnap().zielSys[z.length] === Math.round(CONFIG.reaktorTod.start * 10), 'Countdown läuft: Restzeit in Zehntelsekunden (Start ' + CONFIG.reaktorTod.start + ' s)');
  g.ship.target = null;
  ok(Object.keys(g.zielSysSnap()).length === 0, 'kein Ziel: kein Feld');
  g.ship.target = 'e-unbekannt';
  ok(Object.keys(g.zielSysSnap()).length === 0, 'Ziel ohne Gegner: kein Feld');
});

section('integPct: Gesamtintegrität in Prozent, Verbraucher-Lesart', () => {
  const g = newGame(43);
  const e = gegner(g, 'korvette');
  ok(Math.abs(Gsys.integPct(e) - 100) < 1e-9, 'voll = 100 %');
  e.sys.waffe_bug.i = 0; e.sys.waffe_bug.z = 'broken';
  e.hp = Object.values(e.sys).reduce((a, s) => a + s.i, 0);
  ok(Gsys.integPct(e) < 100, 'nach Schaden unter 100 %');
  ok(Math.abs(Gsys.integPct(e) - e.hp / e.hpMax * 100) < 1e-9, 'integPct = hp / hpMax × 100');
});

section('Determinismus: gleicher Seed, gleiche Trefferfolge', () => {
  const lauf = (seed) => {
    const g = newGame(seed); const e = gegner(g, 'kreuzer'); e.shields.fill(0);
    return aufzeichnen(() => { for (let i = 0; i < 40; i++) space.damageEnemy(g, e, 0.7, e.x, e.y + 300, {}); }).map((r) => r.zone + ':' + (r.r ? r.r.id : '-')).join('|');
  };
  ok(lauf(5) === lauf(5), 'gleicher Seed: gleiche Folge');
  ok(lauf(5) !== lauf(6), 'anderer Seed: andere Folge');
});

section('Wirkungswerte stehen in der Config, nicht im Code; Verrat-Quote und Testhilfe', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'sim', 'gegnersystem.js'), 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/\b(1\.5|0\.5)\b/.test(src) && !/TAKT_BESCHAEDIGT|EMITTER_BESCHAEDIGT|REGEN_GENERATOR/.test(src), 'gegnersystem.js: keine Wirkungszahl und keine Konstante im Code');
  const G = CONFIG.systemModell.gegner;
  ok(G && G.taktBeschaedigt === 1.5 && G.regenGeneratorBeschaedigt === 2 && G.emitterBeschaedigt === 0.5, 'systemModell.gegner: Startwerte 1,5 / 2 / 0,5');
  const g = newGame(53);
  const e = gegner(g, 'korvette');
  Gsys.setzeAnteil(g, e, 0.5);
  ok(Math.abs(Gsys.summe(e) - e.hpMax * 0.5) < 1e-9 && e.hp === Gsys.summe(e) && Object.values(e.sys).every((s) => s.z === 'damaged'), 'setzeAnteil 0,5: Σ = halbes Budget, alle Systeme beschädigt (unter der Schwelle)');
  Gsys.setzeAnteil(g, e, 0.8);
  ok(Math.abs(e.hp / e.hpMax - 0.8) < 1e-9 && Object.values(e.sys).every((s) => s.z === 'ok'), 'setzeAnteil 0,8: alle Systeme ok');
  const k = gegner(g, 'kreuzer');
  Testhilfe.toeten(g, k);
  ok(!g.space.enemies.includes(k) && k.sys.reaktor.z === 'broken', 'Testhilfe.toeten: Schild 0, Durchschlag in die Mitte, der Reaktor fällt, der Gegner stirbt (echter Modellpfad)');
});

console.log('\n' + (fails === 0 ? 'GEGNERSYSTEM OK' : 'GEGNERSYSTEM FEHLER: ' + fails) + ' (' + n + ' Prüfungen)');
process.exit(fails ? 1 : 0);
