'use strict';
// EIS-01 P3: Landepunkt methalle.siedlung ist seit der Umstellung die Festkarte grabenangriff (Bunker unter dem Wald, Kapitel 4 der Kampagne).
// Der Ort heisst weiter Methalle (Ort methalle, Hex 0705, ID methalle.siedlung). Headless:
//  - Festkarte (festkarte/2, 2 Decks), Pflichtsatz der Karte, genau ein Sprengpunkt-Anker, Pruefer ok
//  - Payload <= AWAY_MAP_MAX_BYTES (Weltstand traegt die Karte nicht: sie baut sich aus Datei + Seed neu, gleicher Bau = gleiche Karte)
//  - gen.bauweise (Bauweise folgt dem Besitzer): Kampagnen-Bunker germanen, Lobby-Bunker (ohne gen.bauweise) rom_feld, Raster/Anker gleich
//  - splitter.methalle (Labor) baut weiter als Siedlungsvariante methalle
//   node tools/test-methalle-bunker.js
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const L = require('../server/sim/landepunkte.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const mk = (seed) => new Game({ noStore: true, seed: seed || 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const LP = 'methalle.siedlung';

section('Eintrag und Karte', () => {
  const d = L.defs().byId[LP];
  ok(d && d.gen && d.gen.fest === 'grabenangriff', 'methalle.siedlung nennt gen.fest grabenangriff');
  ok(d.besitz === 'raubzug' && d.art === 'aussenposten' && d.ort === 'methalle', 'Besitz raubzug, Ort methalle, Kartenart aussenposten unveraendert');
  const g = mk();
  const k = L.karte(g, LP);
  ok(k && /^gen-fest\/2$/.test(k.erzeuger) && k.meta.fest === 'grabenangriff', `Festkarte, Erzeuger ${k.erzeuger}`);
  ok(k.decks && k.decks.stride > 0 && k.h > k.decks.stride, `zwei Decks (Stride ${k.decks && k.decks.stride}, Hoehe ${k.h})`);
  ok(k.besitz === 'raubzug', 'Besitz der Karte raubzug (Verteidiger der Kampagne: Germanen)');
  const zahl = (rolle) => k.anker.filter((a) => a.rolle === rolle).length;
  ok(zahl('sprengpunkt') === 1, `genau ein Sprengpunkt-Anker (${zahl('sprengpunkt')})`);
  const pf = k.meta.pflicht || {};
  ok(Object.keys(pf).length > 0 && Object.entries(pf).every(([r, v]) => zahl(r) >= v), `Pflichtsatz erfuellt (${JSON.stringify(pf)})`);
  const b = payloadB(k);
  ok(b <= Protocol.AWAY_MAP_MAX_BYTES, `Payload ${b} B <= ${Protocol.AWAY_MAP_MAX_BYTES} B`);
});

section('Neuaufbau: gleiche Karte', () => {
  const a = JSON.stringify(L.karte(mk(7), LP)), b = JSON.stringify(L.karte(mk(7), LP)), c = JSON.stringify(L.karte(mk(99), LP));
  ok(a === b, 'gleicher Aufbau zweimal = gleiche Karte (byteweise)');
  ok(a === c, 'unabhaengig vom Weltseed (Karte steht nicht im Weltstand, kommt aus Datei + Landepunkt-Seed)');
  const g = mk();
  const k0 = L.karte(g, LP);
  L.cacheLeeren();
  ok(JSON.stringify(L.karte(g, LP)) === JSON.stringify(k0), 'nach Cache-Leeren (Neubau aus der Datei) dieselbe Karte');
});

section('Bauweise folgt dem Besitzer', () => {
  const g = mk();
  const kamp = L.karte(g, LP);
  ok(kamp.bauweise === 'germanen', `Kampagnen-Bunker: Bauweise ${kamp.bauweise}`);
  const id = L.testgelaende(g, { ort: 'kesh', id: 'test.bunker.lobby', art: 'aussenposten', seed: 5, besitz: 'rom', gen: { fest: 'grabenangriff' } });
  const lob = L.karte(g, id);
  ok(lob.bauweise === 'rom_feld', `Lobby-Bunker ohne gen.bauweise bleibt rom_feld (${lob.bauweise})`);
  const id2 = L.testgelaende(g, { ort: 'kesh', id: 'test.bunker.ger', art: 'aussenposten', seed: 5, besitz: 'rom', gen: { fest: 'grabenangriff', bauweise: 'germanen' } });
  ok(L.karte(g, id2).bauweise === 'germanen', 'gen.bauweise hat Vorrang vor der Festkarte');
  // Layout, Anker, Raster: nur die Bauweise (und Kennung/Besitz) unterscheiden die Karten
  const gleich = (a, b) => ['w', 'h', 'rows', 'anker', 'bereiche', 'decks', 'eingaenge', 'abholpunkte', 'ankunft', 'legende', 'meta'].every((f) => JSON.stringify(a[f]) === JSON.stringify(b[f]));
  ok(gleich(kamp, lob), 'Raster, Legende, Anker und Meta von germanen und rom_feld identisch (Bauweise wirkt nur auf Modelle/Optik)');
  ok(payloadB(lob) <= Protocol.AWAY_MAP_MAX_BYTES, 'Lobby-Bunker Payload im Rahmen');
  // Bauweise im Cache-Schluessel: gen.bauweise darf nicht die Lobby-Karte treffen
  ok(L.karte(g, id).bauweise === 'rom_feld', 'nach den Kampagnen-Bau trifft die Lobby nicht die germanische Karte');
});

section('Labor: splitter.methalle bleibt die Variante', () => {
  const g = mk();
  const k = L.karte(g, 'splitter.methalle');
  ok(k.erzeuger === 'gen-siedlung/1' && k.meta.variante === 'methalle', `splitter.methalle: ${k.erzeuger}, Variante ${k.meta.variante}`);
  ok(k.anker.some((a) => a.rolle === 'sprengpunkt') && k.anker.some((a) => a.rolle === 'baracke'), 'Sprengpunkt und Baracken der Variante vorhanden');
});

console.log(`\n${fails ? 'VERFEHLT' : 'ok'}: ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
