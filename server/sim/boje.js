'use strict';
// SL10 (CONCEPT-SL10): die Vorläufer-Boje wecken. Alle vier Stationen arbeiten:
//   Ops        Frequenz und Adresse (Minispiel Glyphen/Sternkarte, server/sim/glyphen.js, id 'boje'): ohne gelöste Adresse bleibt die Boje stumm
//   Technik    speist Energie ein: die Boje braucht `boje.freiNoetig` freie Reaktorpunkte (Waffen herunterfahren und Bordmodule abschalten, PAN-01 A; die frühere O₂-Uhr der Lebenserhaltung ist mit der Station gestrichen, PAN-01 B)
//   Navigation hält die Lerche im Aktivierungsfeld (Zone boje_feld, drückt und driftet; shared/zonen.js boje())
//   Captain    sieht die Konstellation für die Ops und entscheidet (Wettlauf nach Weg A: Piraten kommen in Wellen)
// Fortschritt (Zähler 'boje' in den Zonen, 0..100) wächst mit der Energie, solange alles stimmt, und fällt langsam, wenn die Lerche das Feld verlässt.
// Bei 100 erwacht die Boje: die locked-Kante Fundort → Vorläufer-Sektor öffnet sich dauerhaft (sprung.oeffnen, Weltstand `sektoren.offen`), Fakt boje_geweckt.
//
//   update(game, dt)       Tick (aus game.js), nur in der Szene mit scene.bojeFeld
//   wettlauf(game, an)     Regiebuch boje_wettlauf: Piraten-Wellen (Weg A); wellen = Anzahl, ohne Angabe 3
//   zuruecksetzen(game)    Szene von vorn: Zähler 0, Boje schläft, Wettlauf aus
//   freieEnergie(game)     freie Reaktorpunkte (Reaktorleistung − zugeteilt)
//   geweckt(game)          die Boje ist erwacht (auch aus dem Weltstand)
//   snapshot(game)         Feld `bj` { z, f, e, n, w? } | null (nur in der Szene mit Boje)
const Zonen = require('./zonen.js');
const Glyphen = require('./glyphen.js');
const Locations = require('../../shared/locations.js');
const Sektoren = require('../../shared/sektoren.js');

let spaceMod = null, sprungMod = null;
const space = () => spaceMod || (spaceMod = require('./space.js'));
const sprung = () => sprungMod || (sprungMod = require('./sprung.js'));

const STANDARD = { freiNoetig: 4, dauer: 60, abnahme: 0.5, fundort: 'bojenfeld', ziel: 'vorlaeufer', wellen: 3, wellenAbstand: 30, wellenGroesse: 2 };
const cfg = (game) => Object.assign({}, STANDARD, (game.C && game.C.boje) || {});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function state(game) { return game.bojeSim || (game.bojeSim = { geweckt: false, wettlauf: 0, welle: 0, naechste: 0 }); }
function szene(game) { const loc = Locations.get(game.ship.scene); return loc && loc.scene && loc.scene.bojeFeld ? loc.scene : null; }

// PAN-01 A: Hauptsysteme + laufende Module (space.powerUsed); freie Energie entsteht auch durch abgeschaltete Module
function freieEnergie(game) {
  const out = space().reactorOutput(game);
  return Math.max(0, out - space().powerUsed(game));
}
function geweckt(game) {
  if (state(game).geweckt) return true;
  const f = game.weltstand && game.weltstand.data && game.weltstand.data.fakten ? game.weltstand.data.fakten.boje_geweckt : null;
  return !!f;
}

function wecken(game) {
  const S = state(game); const C = cfg(game);
  S.geweckt = true;
  const err = sprung().oeffnen(game, { von: C.fundort, nach: C.ziel, temp: false });
  if (err) game.countError('boje-kante', new Error(err));
  const ws = game.weltstand;
  if (ws && typeof ws.fact === 'function') ws.fact('boje_geweckt', 'ja', 'Vorläufer-Boje');
  game.emit('sfx', { name: 'discovery' });
  game.oda('Die Vorläufer-Boje erwacht! Ein Sprungpunkt öffnet sich in den Vorläufer-Sektor.', null);
  game.missionEvent('bojeGeweckt', { kante: Sektoren.kanteId(Sektoren.hexVonOrt(C.fundort), Sektoren.hexVonOrt(C.ziel)) });
}

function update(game, dt) {
  const sc = szene(game); if (!sc) return;
  const S = state(game); const C = cfg(game);
  if (S.geweckt) { wettlaufTick(game, S, sc, C); return; }
  const imFeld = game.zonenSim && game.zonenSim.in.includes('boje_feld');
  const adresse = Glyphen.ergebnis(game, 'boje') != null;
  const energie = clamp(freieEnergie(game) / C.freiNoetig, 0, 1);
  let z = Zonen.zaehler(game, 'boje');
  const rate = 100 / C.dauer;
  if (imFeld && adresse && energie > 0) z += rate * energie * dt;
  else if (!imFeld && z > 0) z -= rate * C.abnahme * dt;
  z = clamp(z, 0, 100);
  Zonen.zaehlerSetzen(game, 'boje', z);
  if (z >= 100) wecken(game);
  wettlaufTick(game, S, sc, C);
}

// Wettlauf (Weg A): die Piraten kommen in Wellen, sobald die Aktivierung läuft
function wettlaufTick(game, S, sc, C) {
  if (!S.wettlauf || S.welle >= S.wettlauf) return;
  const z = Zonen.zaehler(game, 'boje');
  if (!S.geweckt && z < 12 && S.welle === 0) return;   // die erste Welle kommt, wenn das Aufleuchten weithin sichtbar wird
  if (game.time < S.naechste) return;
  S.welle++; S.naechste = game.time + C.wellenAbstand;
  const sp = game.space;
  for (let i = 0; i < C.wellenGroesse; i++) {
    const rand = sc.w || sp.w || 3000;
    const x = i % 2 ? rand - 160 : 160, y = Math.round((sp.h || 2200) * (0.25 + 0.5 * game.rng()));
    space().spawnEnemy(game, 'raider', { x, y });
  }
  game.oda(`Piraten springen ein (Welle ${S.welle} von ${S.wettlauf}) – das Aufleuchten hat sie angelockt!`, null);
  game.missionEvent('bojeWelle', { n: S.welle });
}

function wettlauf(game, wellen) {
  const S = state(game);
  S.wettlauf = Math.max(0, Math.floor(Number(wellen) || 0)) || cfg(game).wellen;
  S.welle = 0; S.naechste = 0;
}
function zuruecksetzen(game) {
  const S = state(game);
  S.wettlauf = 0; S.welle = 0; S.naechste = 0;
  Zonen.zaehlerSetzen(game, 'boje', 0);
  if (game.glyphen && game.glyphen.id === 'boje') Glyphen.abbrechen(game);
}

function snapshot(game) {
  if (!szene(game)) return null;
  const C = cfg(game);
  const o = { z: Math.round(Zonen.zaehler(game, 'boje') * 10) / 10, f: Glyphen.ergebnis(game, 'boje') != null ? 1 : 0, e: freieEnergie(game), n: C.freiNoetig };
  if (state(game).geweckt) o.g = 1;
  if (state(game).wettlauf) o.w = state(game).welle;
  return o;
}

module.exports = { update, wettlauf, zuruecksetzen, freieEnergie, geweckt, snapshot, state, STANDARD };
