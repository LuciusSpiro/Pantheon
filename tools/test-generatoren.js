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

// TA (Kai 2026-10-14): Siedlungsausstattung (Taverne statt Zellen) und Bodenton, beides nur auf Wunsch (opts.ausstattung / opts.boden)
abschnitt('Siedlungsausstattung: Taverne, Möbel, Bodenton (opt-in)');
{
  const bau = (seed, extra) => Buehne.ausRaster(GenSiedlung.erzeuger(130, 90).karteRoh(seed, 11, Object.assign({ bauweise: 'germanen', typ: 'handel', besitz: 'konkordat', zustand: 'intakt', id: 'ta' }, extra || {})), { spiel: true });
  let gut = 0, ges = 0, schlecht = [], toene = new Set(), ohneZelle = 0, mitMoebel = 0, persOk = 0, schlechtOben = [];
  for (let seed = 1; seed <= 40; seed++) {
    ges++;
    const r = bau(seed, { ausstattung: true, boden: 'auto' });
    if (!r.pruefung.ok) { schlecht.push(`${seed}: ${r.fehler.slice(0, 2).map((x) => x.code + ' ' + x.msg).join(',')}`); continue; }
    gut++;
    const k = r.karte, kant = Object.keys(k.plaetze).filter((id) => /^kantine_/.test(id));
    toene.add(k.meta.boden);
    if (!k.anker.some((a) => a.rolle === 'zelle' && kant.includes(a.platz))) ohneZelle++;
    const m = k.meta.moebel || [];
    const kr = kant.length ? k.plaetze[kant[0]].rect : null, klein = kr && (kr[2] - 2 < 5 || kr[3] - 2 < 5);   // winzige Kantinen (Innenraum 4 breit/tief) bekommen nur Tresen, Fässer und Feuerstelle
    if (!kant.length || (klein ? ['tresen', 'fass', 'feuerschale'] : ['tresen', 'tisch', 'hocker', 'fass', 'feuerschale']).every((s) => m.some((q) => q[4].startsWith(s)))) mitMoebel++;
    if (!kant.length || ['wirt', 'evert', 'gast1', 'gast2'].every((nm) => k.anker.some((a) => a.id === kant[0] + '.' + nm))) persOk++;
    if (!(k.meta.pflicht && Object.keys(k.meta.pflicht).every((rl) => k.anker.filter((a) => a.rolle === rl).length >= k.meta.pflicht[rl]))) schlechtOben.push(seed);
    if (!m.every((q) => k.rows[q[1]][q[0]] === 'o' || k.rows[q[1]][q[0]] === 'O')) schlecht.push(`${seed}: Möbel nicht auf Deckungskachel`);
  }
  ok(schlecht.length === 0 && gut === ges, `Prüfer (inkl. Erreichbarkeit) ok mit Ausstattung: ${gut}/${ges}${schlecht.length ? ' ' + schlecht.slice(0, 3).join(' | ') : ''}`);
  ok(ohneZelle === gut, `Taverne ohne Zellen (${ohneZelle}/${gut})`);
  ok(mitMoebel === gut, `Taverne möbliert: Tresen, Tisch, Hocker, Fass, Feuerschale (${mitMoebel}/${gut})`);
  ok(persOk === gut, `Anker wirt/evert/gast1/gast2 in der Taverne (${persOk}/${gut})`);
  ok(schlechtOben.length === 0, 'Pflichtsatz der Kartenart bleibt erfüllt (Zellen, Beute, Terminal …)');
  ok(['sand', 'gras', 'wald'].every((t) => toene.has(t)), 'Bodenton auto: alle drei Töne kommen über die Seeds vor (' + [...toene].join(',') + ')');
  const f1 = bau(7311, { ausstattung: true, boden: 'gras' }).karte, f2 = bau(7311, { ausstattung: true, boden: 'gras' }).karte;
  ok(JSON.stringify(f1) === JSON.stringify(f2) && f1.meta.boden === 'gras', 'gleicher Seed, gleiche Karte; fester Bodenton gras');
  // ohne Wunsch: unverändert (Eisenwald/Limes-Karten und alle bisherigen Siedlungen)
  const plain = GenSiedlung.erzeuger(130, 90).karteRoh(9, 11, { bauweise: 'germanen', typ: 'handel', id: 'x' });
  const falsch = GenSiedlung.erzeuger(130, 90).karteRoh(9, 11, { bauweise: 'germanen', typ: 'handel', id: 'x', ausstattung: false, boden: null });
  ok(JSON.stringify(plain) === JSON.stringify(falsch) && plain.bauversion === 'gen5' && !plain.meta.moebel && !plain.meta.boden, 'ohne Ausstattung/Boden: Karte unverändert (bauversion gen5, kein meta.moebel/boden)');
  const ew = GenSiedlung.erzeuger(130, 90).karteRoh(3, 12, { bauweise: 'germanen', typ: 'handel', variante: 'eisenwald', id: 'x', ausstattung: true, boden: 'gras' });
  ok(ew.bauversion === 'gen5' && !ew.meta.moebel, 'Eisenwald/Methalle ignorieren die Ausstattung');
  // Landepunkt Kantenstein (Sund): fester Bodenton gras, Taverne ohne Käfig, awayMap trägt moebel und boden und bleibt im Budget
  const g = fakeGame(); const k = LP.karte(g, 'kantenstein.siedlung');
  const p = Game.prototype.awayMapPayload.call({}, k), bytes = Buffer.byteLength(JSON.stringify(p));
  ok(k && k.meta.boden === 'gras' && Array.isArray(p.moebel) && p.moebel.length >= 15 && p.boden === 'gras', `Kantenstein: gras, ${p.moebel && p.moebel.length} Möbel in der awayMap`);
  ok(bytes <= Protocol.AWAY_MAP_MAX_BYTES, `awayMap Kantenstein ${bytes} B ≤ ${Protocol.AWAY_MAP_MAX_BYTES} B`);
  ok(!k.anker.some((a) => a.rolle === 'zelle' && a.platz === 'kantine_1'), 'Kantenstein: keine Zelle in kantine_1');
}

console.log(`\ntest-generatoren: ${n - fehler}/${n} Prüfungen bestanden.`);
process.exit(fehler ? 1 : 0);
