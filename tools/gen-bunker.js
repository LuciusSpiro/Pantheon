'use strict';
// BOD-03 B1: Deck 1 (römischer Bunker) der festen Karte Grabenangriff. Der Bunker ist EINE feste römische Station (shared/gen-station.js, ORT-01),
// einmal deterministisch erzeugt und als Daten in content/buehnen/festkarten/grabenangriff.json gebacken (decks[1]). Der Erzeuger läuft NICHT zur
// Laufzeit: die Karte kommt aus der JSON, dieses Werkzeug ist nur der reproduzierbare Weg dorthin (Test: tools/test-bunker.js prüft, dass die Datei
// genau diese Ausgabe enthält).
//
//   Seed        3        (kleinste Station: 48 x 44, 6 Räume mit Reaktorraum und Sprengpunkt; GEN_GROESSE.station.n = 8 Räume als Ziel,
//                         Aufruf wie server/sim/landepunkte.js genBauen: GenStation.erzeuger(96, 56).karteRoh(3, 8, ...))
//   gespiegelt  ja       (links <-> rechts): der Transporterraum (-> Lift-Eingang) liegt dann rechts, unter dem Bunkertor der Oberfläche, und die
//                         gegenüberliegende Seite mit dem Kriechgang unter der Waldmitte (Rohr). Sonst unverändert: Raster, Räume, Türen, Schotts.
//   Breite      100      Alle Decks einer Karte sind gleich breit (der Client verträgt keine kürzeren Zeilen): links 50 Spalten '_' vor der Station,
//                         der Erzeuger setzt den Rand '_' (rand) dazu. Das Deck steht damit unter Wald und Bunkertor (x 51..98).
//   Anker       Station-Anker, die für diese Karte nicht passen, entfallen: abholpunkt (Pad und Transporter; der Bunker hat keins, die Crew
//               beamt oben am Bunkereingang), eingang (Transporter-Tür und Luke: die Crew kommt über Lift und Rohr), ziel (die Sprengung wird das
//               Ziel, Paket C). Alle übrigen bleiben (Wachen, Patrouillen, Terminals, Beute, Zellen, Versteck, Tor, Sprengpunkt im Reaktorraum),
//               ohne Gruppe: der Bunker ist zunächst leer von Gegnern. Neu: Lift (im Transporterraum) und das untere Rohr-Ende (im Kriechgang).
//   Plätze      gen-fest kennt keine Plätze (plaetze: {}): die Anker verlieren platz, behalten bereich. Türen, Schotts, Luken stehen im Raster
//               (D, S, L, w), die Kanten leitet Buehne.ausRaster daraus ab.
//
//   node tools/gen-bunker.js              zeigt das Deck als ASCII mit Ankern und prüft, ob die JSON es enthält
//   node tools/gen-bunker.js --schreiben  schreibt decks[1] (Bunker) in content/buehnen/festkarten/grabenangriff.json (Rest der Datei bleibt)
const fs = require('fs');
const path = require('path');
const GenStation = require('../shared/gen-station.js');

const SEED = 3, RAEUME = 8, ERZ_W = 96, ERZ_H = 56;
const BREITE = 100, VOR = 50;                 // Kartenbreite; Spalten '_' links der Station (Stationsbreite 48 -> 50 + 48 = 98 = BREITE - 2 Ränder)
const ENTFALLEN = new Set(['abholpunkt', 'eingang', 'ziel']);
// Neue Anker in Stationskoordinaten (nach dem Spiegeln): Lift in der Mitte des Transporterraums, Rohr-Ende im Kriechgang (Zeile y 20, 1 breit,
// nur über Luken von den Räumen aus zu erreichen), x so, dass es unter der Rohr-Mündung in der Waldmitte liegt (Oberfläche x 61, Deck x 59).
const LIFT = { id: 'bunker.lift.unten', rolle: 'lift', x: 40, y: 16 };
const ROHR = { id: 'rohr.unten', rolle: 'leiter', x: 8, y: 20 };
const DECK_DATEI = path.join(__dirname, '..', 'content', 'buehnen', 'festkarten', 'grabenangriff.json');

function station() {
  const roh = GenStation.erzeuger(ERZ_W, ERZ_H).karteRoh(SEED, RAEUME, { bauweise: 'rom_feld', id: 'bunker' });
  if (roh.w !== 48 || roh.h !== 44) throw new Error(`Station Seed ${SEED}: ${roh.w}x${roh.h} statt 48x44 (Erzeuger geändert?)`);
  return roh;
}
// Deck 1 als Objekt für decks[1] der festkarte/2-Definition
function bunkerDeck() {
  const roh = station();
  const w = roh.w, h = roh.h;
  const spiegeln = (x) => w - 1 - x;
  const rows = roh.rows.map((r) => '_'.repeat(VOR) + r.split('').reverse().join(''));
  if (rows.some((r) => /[PTb]/.test(r))) throw new Error('Stationsraster nutzt Zeichen, die in der Karte Platzhalter sind (P, T, b)');
  const anker = [];
  for (const a of roh.anker) {
    if (ENTFALLEN.has(a.rolle)) continue;
    const o = { id: 'bk.' + a.id, rolle: a.rolle, x: VOR + spiegeln(a.x), y: a.y };
    for (const f of Object.keys(a)) if (!['id', 'rolle', 'x', 'y', 'platz', 'bereich', 'ankunft', 'gruppe'].includes(f)) o[f] = a[f];
    if (a.bereich) o.bereich = 'bk_' + a.bereich;
    anker.push(o);
  }
  for (const n of [LIFT, ROHR]) {
    const c = rows[n.y][VOR + n.x];
    if (c !== '.') throw new Error(`${n.id}: Zeichen '${c}' statt Boden an (${n.x},${n.y})`);
    if (anker.some((a) => a.x === VOR + n.x && a.y === n.y)) throw new Error(`${n.id}: Kachel schon durch einen Anker belegt`);
    anker.push({ id: n.id, rolle: n.rolle, x: VOR + n.x, y: n.y, bereich: 'bk_' + (n === LIFT ? 'andock' : 'gang') });
  }
  anker.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  // Bereiche: wie die Station (andock = Transporterraum, gang = Gänge, kern = Räume), Rechtecke gespiegelt
  const bereiche = {};
  for (const id of Object.keys(roh.bereiche)) {
    const b = roh.bereiche[id];
    bereiche['bk_' + id] = Object.assign({}, b, { name: id === 'andock' ? 'Liftraum' : b.name, rects: b.rects.map((q) => [VOR + spiegeln(q[0] + q[2] - 1), q[1], q[2], q[3]]) });
  }
  return {
    id: 'bunker', hoehe: h, rand: '_', fuellung: '_',
    hinweis: `BOD-03 B1: römischer Bunker = Station Seed ${SEED} (shared/gen-station.js), gespiegelt, links mit '_' auf Kartenbreite aufgefüllt. GEBACKEN von tools/gen-bunker.js (nicht von Hand ändern, neu schreiben mit --schreiben). Lift im Transporterraum (Gegenstück oben im Bunkertor), Rohr-Ende im Kriechgang.`,
    reihenfolge: ['bunker'],
    abschnitte: { bunker: { name: 'Bunker', waehlbar: false, standard: 'station', varianten: { station: { name: `Römische Station (Seed ${SEED})`, breite: BREITE - 2, rows, anker, bereiche } } } },
  };
}
// ASCII-Ansicht mit Ankern (Anfangsbuchstabe der Rolle)
function ascii(deck) {
  const v = deck.abschnitte.bunker.varianten.station;
  const an = {}; for (const a of v.anker) an[a.x + ',' + a.y] = a.rolle[0].toUpperCase();
  return v.rows.map((r, y) => String(y).padStart(2) + ' ' + r.split('').map((c, x) => an[x + ',' + y] || c).join('')).join('\n');
}

if (require.main === module) {
  const def = JSON.parse(fs.readFileSync(DECK_DATEI, 'utf8'));
  const d = bunkerDeck();
  console.log(ascii(d));
  console.log(`Seed ${SEED}, ${d.abschnitte.bunker.varianten.station.anker.length} Anker, Deck ${BREITE}x${d.hoehe} (Station 48x44 gespiegelt, Versatz ${VOR})`);
  if (process.argv.includes('--schreiben')) {
    def.format = 'festkarte/2';
    def.decks[1] = d;
    fs.writeFileSync(DECK_DATEI, JSON.stringify(def, null, 1) + '\n');
    console.log('geschrieben: decks[1] in ' + path.relative(process.cwd(), DECK_DATEI));
  } else {
    const gleich = JSON.stringify(def.decks[1]) === JSON.stringify(d);
    console.log(gleich ? 'Datei enthält genau dieses Deck.' : 'Datei weicht ab (oder hat noch kein Deck 1): mit --schreiben neu backen.');
    process.exitCode = gleich ? 0 : 1;
  }
}
module.exports = { bunkerDeck, ascii, SEED, VOR, LIFT, ROHR };
