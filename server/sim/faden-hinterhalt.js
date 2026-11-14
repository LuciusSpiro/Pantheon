'use strict';
// BEA-03 A: der Beat hinterhalt (Action-Layer). Gegner lauern an EINEM Sektor; fliegt die Crew hinein (Schnellsprung, Einzelsprung, Notsprung), wird sie abgefangen: die Meldung kommt bei der
// Ankunft, die Gegner stehen im selben Takt (kein Vorlauf, Daten szenen-werte.json hinterhalt.vorlauf_s). Der Faden steuert Gegner und Ausgang. Keine neue Kampflogik: der Kampf laeuft ueber
// faden-szene.starten (Art hinterhalt: Warteschlange, frei(), Andocken, Ausgang, Spontanhilfe), alle Zahlen, Volk, Klasse und Texte stehen in content/faeden/szenen-werte.json.
//
//   baustein                 Baustein des Beats (faden-szene.js registriert ihn): waehlt den Sektor, merkt ihn im laufenden Beat (f.laufend.hex, Laufzeit, nicht gespeichert, nie faden.parameter.ort:
//                            der Ort der Geschichte bleibt, wo er ist), startet die Szene sofort, wenn die Crew schon dort ist. Ohne waehlbaren Sektor: gescheitert (Logbuch).
//   hexWaehlen(game, faden, salz) -> Hex | null   fuer Plaene und Brett: ziel.min bis ziel.max Spruenge entfernt ueber offene Sprungpunkte, nie der eigene Sektor, nie ein Hafen oder eine Station,
//                            nur spielbare Sektoren mit Szene; aus dem eigenen Strom der Faeden (nie game.rng). Eine Vorlage darf parameter.hex nennen (erreichbar bis ziel.erreichbar_max).
//   update(game)             Takt (Aufrufer: reise-ereignis.update): Ankunft am Sektor eines laufenden Hinterhalt-Beats plant die Szene ein
//   halt(game, hex) -> Text | null   Schnellsprung (reise.js hop, VOR dem Zufalls-Abfangen): am Sektor eines wartenden Hinterhalts haelt er an; ohne Faden und ohne wartenden Beat immer null
// Der Hinterhalt zaehlt fuer den Abstand der Reise-Ereignisse (reise-ereignis.abfangenVermerken, bei der Ankunft).
const Sektoren = require('../../shared/sektoren.js');
const Locations = require('../../shared/locations.js');
const D = require('./faden-daten.js');
const DATEN = require('../../content/faeden/szenen-werte.json');

const ART = 'hinterhalt';
const H = DATEN.werte[ART].wert;
const T = DATEN.texte;
const HEX = /^\d{4}$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// lazy (Zirkelbezug: faden-szene.js laedt dieses Modul beim Laden)
const Faden = () => require('./faden.js');
const FadenSzene = () => require('./faden-szene.js');
const B1 = () => require('./faden-b1.js');
const Reise = () => require('./reise-ereignis.js');
const fmt = (t, v) => String(t == null ? '' : t).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const hierHex = (game) => (game && game.ship ? Sektoren.hexVonOrt(game.ship.scene) : null);
const echt = () => require('./faden-bausteine.js').vonId(ART) === baustein;   // nur der echte Baustein wartet (ein Platzhalter der Tests tut nichts, wie der Beat selbst)
const logbuch = (game, faden, beat, begruendung) => {
  try { require('./regie-befehle.js').schreibe(game, { art: 'faden_baustein', quelle: 'regie', ausgang: 'abgelehnt', key: ART, begruendung, plan: { faden: faden.id, beat: beat.id } }); } catch (e) { if (game && game.countError) game.countError('faden-hinterhalt-logbuch', e); }
};

// Hafen oder Station (Karte oder Szene): dort liegt nie ein Hinterhalt
function hatHafen(hex) {
  const d = Sektoren.hexDaten(hex);
  if (d && d.hafen) return true;
  const ort = Sektoren.ortVonHex(hex), l = ort && Locations.get(ort), sc = l && l.scene;
  return !!(sc && (sc.dock || sc.station));
}
const spielbar = (hex) => require('./faden-pruefer.js').sundSpielbar(hex) && Sektoren.hatSzene(hex);

function hexWaehlen(game, faden, salz) {
  const von = hierHex(game);
  if (!von) return null;
  const k = Array.from(B1().erreichbar(game, von, H.ziel.max))
    .filter(([h, s]) => s >= H.ziel.min && s <= H.ziel.max && h !== von && !Sektoren.sperrtext(h) && spielbar(h) && !hatHafen(h))
    .map(([h]) => h).sort();
  if (!k.length) return null;
  const z = Faden().strom(game, Faden().idNr(faden.id), H.salz + ':' + salz)();
  return k[Math.floor(z * k.length) % k.length];
}
// Sektor des Beats: parameter.hex der Vorlage (spielbar und erreichbar; der eigene Sektor ist erlaubt, dann beginnt der Hinterhalt sofort), sonst vom Code gewaehlt
function hexFuer(game, faden, beat) {
  const p = beat.parameter || {};
  if (!has(p, 'hex')) return hexWaehlen(game, faden, beat.id);
  const von = hierHex(game);
  return typeof p.hex === 'string' && HEX.test(p.hex) && von && spielbar(p.hex) && B1().erreichbar(game, von, H.ziel.erreichbar_max).has(p.hex) ? p.hex : null;
}

// Der laufende Hinterhalt-Beat eines Fadens (sonst null)
function beatVon(f) {
  if (f.phase !== 'laeuft' || !f.laufend) return null;
  const beat = D.vorlage(f.vorlage).beats[f.beat];
  return beat && beat.id === f.laufend.beat && D.BEATS[beat.typ].baustein === ART ? beat : null;
}
// Die Crew ist am Sektor: die Szene wird eingeplant (Warteschlange: nie zwei Szenen uebereinander); ein Faden wird nur einmal eingeplant
function ankunft(game, f, beat) {
  if ((game.fadenSzene && game.fadenSzene.fadenId === f.id) || (game.fadenWarte || []).some((it) => it.fadenId === f.id)) return;
  const r = FadenSzene().starten(game, { art: ART, fadenId: f.id, beatId: beat.id, nsc: f.nsc, parameter: Object.assign({}, f.parameter, { beat: Object.assign({}, beat.parameter) }) });
  if (r.ok) Reise().abfangenVermerken(game);
}

const baustein = {
  starten(game, faden, ctx) {
    const hex = hexFuer(game, faden, ctx.beat);
    if (!hex) { logbuch(game, faden, ctx.beat, 'Hinterhalt ohne waehlbaren oder erreichbaren Sektor: der Beat gilt als gescheitert'); return { ausgang: 'gescheitert' }; }
    faden.laufend.hex = hex;
    if (hierHex(game) === hex) ankunft(game, faden, ctx.beat);
    return { laeuft: true };
  },
};

function update(game) {
  if (!game || !game.ship || !Faden().aktiv(game) || !echt()) return;
  const hier = hierHex(game);
  if (!hier) return;
  for (const f of Faden().zustandVon(game).liste.slice()) {
    const beat = beatVon(f);
    if (beat && f.laufend.hex === hier) ankunft(game, f, beat);
  }
}

function halt(game, hex) {
  if (!game || !game.ship || !Faden().aktiv(game) || !echt()) return null;
  const f = Faden().zustandVon(game).liste.find((x) => beatVon(x) && x.laufend.hex === hex);
  return f ? fmt(T.schnellsprung_hinterhalt, { ort: hexName(hex) }) : null;
}

module.exports = { baustein, hexWaehlen, update, halt };
