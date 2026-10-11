#!/usr/bin/env node
'use strict';
// Tests der Generatorkarten (Kai 2026-10-11): Außenposten = Siedlung (shared/gen-siedlung.js), Station = Stationsgrammatik
// (shared/gen-station.js) sind Standard der Landepunkte. Geprüft: Pflichtsatz der Kartenart (den die Missionsplanung annimmt),
// Prüfer, Determinismus, Landepunkt-Anbindung (Standard, Aus-Schalter), awayMap-Größe und huelle, Hüllen-Gebäude.
const Buehne = require('../shared/buehne.js');
const GenSiedlung = require('../shared/gen-siedlung.js');
const GenStation = require('../shared/gen-station.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const W = require('../server/world.js');
delete process.env.PANTHEON_GEN;
const LP = require('../server/sim/landepunkte.js');
const { Game } = require('../server/game.js');

let n = 0, fehler = 0;
const ok = (c, t) => { n++; if (!c) { fehler++; console.log('  FEHLER ' + t); } };
const abschnitt = (t) => console.log('[' + t + ']');
const fakeGame = () => ({ C: CONFIG, time: 0, seed: 1234, players: [], inventory: {}, aways: { platform: { map: 'platform' }, wreck: { map: 'wreck' }, kesh: { map: 'kesh' } },
  ship: { scene: 'kesh', x: 1350, y: 760 }, weltstand: null, mission: {}, emit() {}, missionEvent() {}, notice() {}, oda() {}, log() {}, countError(w, e) { throw e; }, setAwayMap(id) { this.away = this.aways[id]; } });
const zaehl = (k) => { const z = {}; for (const a of k.anker) z[a.rolle] = (z[a.rolle] || 0) + 1; return z; };
const pflichtDerArt = (art) => { const l = Buehne.schablonen(art); let p = null; for (const s of l) { if (!p) p = Object.assign({}, s.pflicht); else for (const r of Object.keys(p)) p[r] = Math.min(p[r], s.pflicht[r] || 0); } return p; };
const fehlt = (k, soll) => { const z = zaehl(k); return Object.keys(soll).filter((r) => (z[r] || 0) < soll[r]).map((r) => r + ' ' + (z[r] || 0) + '/' + soll[r]); };

abschnitt('Pflichtsatz der Kartenart (Siedlung, Station) über viele Seeds');
{
  const sollA = pflichtDerArt('aussenposten'), sollS = pflichtDerArt('station');
  let bad = [], gesamt = 0;
  for (let seed = 1; seed <= 12; seed++) {
    for (const bw of ['rom', 'germanen']) for (const typ of ['handel', 'militaer']) {
      gesamt++;
      const r = Buehne.ausRaster(GenSiedlung.erzeuger(130, 90).karteRoh(seed, 10, { bauweise: bw, typ, besitz: 'raubzug', zustand: 'umkaempft', id: 't' }), { spiel: true });
      const f = fehlt(r.karte, sollA);
      if (!r.pruefung.ok || f.length) bad.push(`siedlung ${seed}/${bw}/${typ}: ${r.pruefung.ok ? f.join(', ') : r.fehler.slice(0, 2).map((x) => x.code).join(',')}`);
    }
    for (const nR of [6, 8, 12]) {
      gesamt++;
      const r = Buehne.ausRaster(GenStation.erzeuger(96, 56).karteRoh(seed, nR, { bauweise: 'germanen', besitz: 'kontor', zustand: 'umkaempft', id: 't' }), { spiel: true });
      const f = fehlt(r.karte, sollS);
      if (!r.pruefung.ok || f.length) bad.push(`station ${seed}/${nR}: ${r.pruefung.ok ? f.join(', ') : r.fehler.slice(0, 2).map((x) => x.code).join(',')}`);
    }
  }
  ok(bad.length === 0, `Prüfer ok und Pflichtsatz erfüllt (${gesamt - bad.length}/${gesamt})${bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''}`);
  const a = GenSiedlung.erzeuger(130, 90).karteRoh(7, 10, { bauweise: 'rom', typ: 'handel', id: 'd' }), b = GenSiedlung.erzeuger(130, 90).karteRoh(7, 10, { bauweise: 'rom', typ: 'handel', id: 'd' });
  ok(JSON.stringify(a) === JSON.stringify(b), 'Siedlung: gleicher Seed, gleiche Karte');
  const c = GenStation.erzeuger(96, 56).karteRoh(7, 8, { bauweise: 'germanen', id: 'd' }), d = GenStation.erzeuger(96, 56).karteRoh(7, 8, { bauweise: 'germanen', id: 'd' });
  ok(JSON.stringify(c) === JSON.stringify(d), 'Station: gleicher Seed, gleiche Karte');
  const k = Buehne.ausRaster(a).karte;
  ok(k.meta.huelle === true && Object.values(k.plaetze).some((p) => p.typ === 'kulisse') && Object.values(k.plaetze).some((p) => p.typ === 'lagerhalle'), 'Siedlung: huelle und Gebäude-Plätze (Dachträger) vorhanden');
}

abschnitt('Landepunkte: Generator ist Standard');
{
  const g = fakeGame();
  for (const [id, art, erz] of [['kesh.grabung', 'aussenposten', 'gen-siedlung/1'], ['splitter.schuerflager', 'aussenposten', 'gen-siedlung/1'], ['hafen.kontor', 'station', 'gen-station/1'], ['b7.aussenstelle', 'station', 'gen-station/1'], ['wrack.langschiff', 'schiff', 'modul/1']]) {
    const k = LP.karte(g, id);
    ok(k && k.art === art && k.erzeuger === erz, `${id}: ${art} von ${erz} (ist ${k && k.erzeuger})`);
  }
  const k = LP.karte(g, 'kesh.grabung');
  const p = Game.prototype.awayMapPayload.call({}, k), bytes = Buffer.byteLength(JSON.stringify(p));
  ok(bytes <= Protocol.AWAY_MAP_MAX_BYTES, `awayMap ${bytes} B ≤ ${Protocol.AWAY_MAP_MAX_BYTES} B`);
  ok(p.huelle === true, 'awayMap meldet huelle');
  const id = LP.neu(g, 'kesh', { art: 'station', seed: 5, zustand: 'umkaempft' }), aw = LP.get(g, id);
  ok(aw && W.AWAY_MAPS[id].karte.erzeuger === 'gen-station/1', 'neu(station) baut mit dem Generator (Bodenkampf-Auswahl, Szenenbau)');
  const g2 = fakeGame(); const e1 = LP.karte(g2, 'kesh.grabung'), e2 = LP.karte(g, 'kesh.grabung');
  ok(JSON.stringify(e1.rows) === JSON.stringify(e2.rows), 'Landepunkt gleicher Seed, gleiche Karte');
  const id2 = LP.neu(g, 'kesh', { art: 'aussenposten', seed: 3, schablone: 'aussenposten.talsperre' });
  LP.get(g, id2);
  ok(W.AWAY_MAPS[id2].karte.erzeuger === 'modul/1', 'ausdrücklich verlangte Schablone bleibt Modulkarte');
  process.env.PANTHEON_GEN = '0';
  const g3 = fakeGame(); const k3 = LP.karte(g3, 'kesh.grabung');
  ok(k3.erzeuger === 'modul/1', 'PANTHEON_GEN=0 schaltet auf Module zurück');
  delete process.env.PANTHEON_GEN;
}

console.log(`\ntest-generatoren: ${n - fehler}/${n} Prüfungen bestanden.`);
process.exit(fehler ? 1 : 0);
