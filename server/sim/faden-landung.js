'use strict';
// FAB-01 B: Baustein des Beats landung (Action-Layer wie faden-forderung.js). Die Crew landet an einem Ort des Plans (Landeplatz, DYN-01), beamt runter und wieder hoch. Der Baustein ist die Daten-Seite plus der
// Handler am Boden-Verteiler (faden-boden.js): WER am Ort steht (Tabelle besetzung, content/faeden/boden-werte.json), WAS der Funk sagt (boden-texte.json) und wie lange der Beat laeuft (Katalog beats.json: frist,
// braucht.landeplatz) steht in den Daten; im Code steht kein Zahlenwert, keine Fraktion und kein Beat-Name ausser dem eigenen.
//
//   starten(game, faden, ctx)   Der Ort entsteht schon vorher (faden.js ruft abenteuer-orte.beatStarten fuer den Parameter landeplatz). Hier: die Karte wird registriert (landepunkte.bereit), je nach Parameter besetzung
//                               besetzt (combat.besetzen), der Funk nennt den Landeplatz. -> { laeuft: true }. Fehlt der Ort, scheitert der Beat.
//   Handler (faden-boden.js, Art landung), nur fuer den laufenden Beat dieses Fadens:
//     beamedDown   merkt "unten gewesen"; holt die Besetzung nach, falls die Karte keine traegt (aw.besetzt fehlt: Spiel gespeichert und geladen, reset, Karte verdraengt und neu gebaut: der Ort kommt aus dem Faden zurueck, aber leer)
//     beamedUp     gelungen, wenn unten gewesen UND danach niemand mehr unten ist; mit data.notrueckholung (Ausbluten, squadRecall): gescheitert, sobald niemand mehr unten ist (die Crew wurde geholt,
//                  sie ging nicht freiwillig); kommen dabei Mitspieler nicht mit, wartet der Beat auf sie
//     notsprung    gescheitert
//   nachTaetigkeit(game), update(game)   dieselbe Pruefung "niemand mehr unten" beim Takt der Taetigkeiten (faden.taetigkeit) und bei jedem Tick (reise-ereignis.update): viele Wege nach oben melden kein beamedUp
//                                         (Verbindung getrennt, resetMap, interior.updateDowned u. a., siehe faden-boden.js). Nur fuer Faeden, die "unten gewesen" gemerkt haben: sonst sofort zurueck.
// Gescheitert bei: Frist (faden.js, Taetigkeiten, am Boden zaehlt keine), Faden-Ende, Notrueckholung, Notsprung. Den Ort raeumt der vorhandene Faden-Abschluss ab (abenteuer-orte.abraeumen), ist die Crew noch unten, im naechsten Takt.
// Laufzeit-Zustand steht NICHT im Weltstand: nur "unten gewesen" (WeakSet auf das Faden-Objekt, faellt mit reset/Laden weg). Die Besetzung traegt die Karte selbst (aw.besetzt, combat.besetzen ist damit je Karte idempotent).
// Grenzen: (1) Kachel-Landeplaetze (Art kachel) sind fuer diesen Beat derzeit nicht erreichbar (Pruefer und Orte lassen nur die Raumpunkt-Arten zu); kaemen sie dazu, braucht die Besetzung und niemandUnten eine Pruefung. (2) interior.updateDowned holt
// Bewusstlose OHNE beamedUp hoch, aber nur auf Karten ohne Kampfsystem v2 (damagePlayer leitet dort in combat.hitPlayer -> woundPlayer, Notrueckholung mit Marker); Landepunkt-Karten sind immer v2 (landepunkte.js ensureV2): nicht erreichbar,
// darum kein Marker dort. Fiele eine Karte doch auf v1 zurueck, wertet der Tick das Hochholen als gelungen (niemand mehr unten).
const D = require('./faden-daten.js');
const Boden = require('./faden-boden.js');
const TEXTE = require('../../content/faeden/boden-texte.json').texte;
const WERTE = require('../../content/faeden/boden-werte.json').werte;
const R = require('./faden-boden-rahmen.js');

const ART = 'landung';   // Katalogtyp des Beats (beats.json); der Baustein traegt denselben Namen
const { has, fmt, hexName, ortVon, platzName, niemandUnten, besetzungsSchluessel, besetzungVon, besetzenFuer } = R;
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');
const logbuch = (game, e) => R.logbuch(game, e, 'faden-landung');   // Fehlerzaehler des Logbuchs unter dem Namen dieses Beats

// "unten gewesen": ein Merker je Faden-OBJEKT (nicht je Spiel und nicht je Fadenid). reset() und continueWorld bauen die Faeden neu (faden.lesen), das alte Objekt faellt mit seinem Merker weg: ein Beat nach dem
// Laden gilt nie als "unten gewesen". Die Besetzung hat keinen eigenen Merker: sie steht an der lebenden Karte (aw.besetzt[tag], von combat.besetzen gesetzt) und geht mit ihr (Neubau, Laden, Verdraengen).
const untenGewesen = new WeakSet();   // Faden-Objekt (game.weltsim.faeden.liste[i])

// ---------- Daten (Rahmen: faden-boden-rahmen.js)
const laufenderBeat = (f) => R.laufenderBeatArt(f, ART);
const besetzen = (game, beat, lp) => besetzenFuer(game, beat, lp, ART);

// ---------- Ausgang
function ausgang(game, f, art) {
  untenGewesen.delete(f);
  return Faden().beatAusgang(game, f.id, art);
}
function pruefen(game) {
  const F = game.weltsim && game.weltsim.faeden;
  if (!F || !F.liste.some((x) => untenGewesen.has(x))) return;   // sofort zurueck ohne Allokation, solange kein Faden "unten gewesen" gemerkt hat
  for (const f of F.liste.slice()) {
    if (!untenGewesen.has(f)) continue;
    const beat = laufenderBeat(f), lp = beat && ortVon(game, f, beat);
    if (!lp) { untenGewesen.delete(f); continue; }
    if (niemandUnten(game, lp)) ausgang(game, f, 'gelungen');
  }
}
const nachTaetigkeit = (game) => pruefen(game);
const update = (game) => pruefen(game);

const handler = {
  ereignis(game, f, ev) {
    const beat = laufenderBeat(f);
    if (!beat) return;
    if (ev.name === 'notsprung') { ausgang(game, f, 'gescheitert'); return; }
    const lp = ortVon(game, f, beat), map = ev.data && ev.data.map;
    if (!lp || map !== lp) return;
    if (ev.name === 'beamedDown') {
      untenGewesen.add(f);
      besetzen(game, beat, lp);   // nachholen (die Karte traegt keine Besetzung: neu gebaut, geladen, verdraengt), sonst nichts
      return;
    }
    if (ev.name === 'beamedUp') {
      if (!untenGewesen.has(f) || !niemandUnten(game, lp)) return;
      ausgang(game, f, ev.data.notrueckholung === true ? 'gescheitert' : 'gelungen');
    }
  },
};
Boden.anmelden(ART, handler);

// ---------- Baustein
const baustein = {
  id: ART,
  starten(game, faden, ctx) {
    const beat = ctx && ctx.beat;
    const lp = beat ? ortVon(game, faden, beat) : null;
    if (!lp) { logbuch(game, { ausgang: 'abgelehnt', key: ART, begruendung: 'Landung ohne Ort: der Beat gilt als gescheitert', plan: { faden: faden.id } }); return { ausgang: 'gescheitert' }; }
    if (niemandUnten(game, lp)) untenGewesen.delete(faden); else untenGewesen.add(faden);   // aus dem echten Zustand: steht die Crew schon auf dieser Karte (frueherer Beat am selben Platz), war sie unten; sonst beginnt der Beat ohne
    besetzen(game, beat, lp);
    const schluessel = besetzungsSchluessel(beat);
    const text = has(TEXTE, ART + '_' + schluessel) ? TEXTE[ART + '_' + schluessel] : TEXTE[ART + '_' + WERTE.besetzung_standard.wert];
    const nsc = Faden().nscVon(game, faden.nsc.id) || faden.nsc;
    if (text && nsc) Bitte().funkVon(game, nsc, fmt(text, { platz: platzName(faden, beat), ort: hexName(faden.parameter && faden.parameter.ort) }));
    logbuch(game, { ausgang: 'landung', key: ART, begruendung: `Landung an ${lp}, Besetzung ${schluessel}`, plan: { faden: faden.id, beat: beat.id, ort: lp, besetzung: schluessel } });
    return { laeuft: true };
  },
};

// Konsistenz der Daten (Katalogpruefung, Tests): Tabelle, Schluessel des Katalogs, Fraktionen, Texte, Pflicht und Frist des Beats
function datenFehler() {
  const out = [];
  const t = WERTE.besetzung.wert, k = has(D.BEATS, ART) ? D.BEATS[ART] : null;
  if (!k) return ['Beat ' + ART + ' fehlt im Katalog (beats.json)'];
  if (k.baustein !== ART) out.push(`Beat ${ART}: baustein ist ${k.baustein}`);
  if (!(k.braucht && k.braucht.landeplatz === true)) out.push(`Beat ${ART}: braucht.landeplatz ist true`);
  if (!(Number.isInteger(k.frist) && k.frist >= 1)) out.push(`Beat ${ART}: frist (Taetigkeiten) fehlt`);
  if (k.gefahr !== false) out.push(`Beat ${ART}: der Bodenkampf ist keine Raum-Gefahr (gefahr false)`);
  const erlaubt = k.bauplan && k.bauplan.parameter && k.bauplan.parameter.besetzung && k.bauplan.parameter.besetzung.erlaubt;
  if (!Array.isArray(erlaubt) || erlaubt.slice().sort().join() !== Object.keys(t).sort().join()) out.push('bauplan.parameter.besetzung.erlaubt stimmt nicht mit den Schluesseln von boden-werte.json besetzung ueberein');
  if (!has(t, WERTE.besetzung_standard.wert)) out.push('besetzung_standard ist kein Schluessel von besetzung');
  let fraktionen = {};
  try { fraktionen = require('../mission/katalog.js').load().fraktionen || {}; } catch (e) { out.push('Katalog der Fraktionen nicht lesbar: ' + e.message); }
  for (const [key, e] of Object.entries(t)) {
    if (!/^[a-z_]+$/.test(key) || key.length > WERTE.schluessel_max.wert) out.push(`besetzung ${key}: Schluessel ungueltig`);
    if (Object.keys(e).length) {
      if (!has(fraktionen, e.fraktion)) out.push(`besetzung ${key}: Fraktion ${e.fraktion} steht nicht im Katalog`);
      if (has(fraktionen, e.fraktion) && !has(fraktionen[e.fraktion].staerke, e.staerke)) out.push(`besetzung ${key}: staerke ${e.staerke} kennt die Fraktion ${e.fraktion} nicht (Katalog staerke)`);
      if (typeof e.haltung !== 'string' || !e.haltung) out.push(`besetzung ${key}: haltung fehlt`);
    }
    const text = TEXTE[ART + '_' + key];
    if (typeof text !== 'string' || !text.trim()) out.push(`boden-texte.json: ${ART}_${key} fehlt`);
    else {
      if (text.length > WERTE.text_max.wert) out.push(`boden-texte.json: ${ART}_${key} hat ${text.length} Zeichen (hoechstens ${WERTE.text_max.wert})`);
      for (const p of text.match(/\{[^}]*\}/g) || []) if (p !== '{platz}' && p !== '{ort}') out.push(`boden-texte.json: ${ART}_${key} nennt den Platzhalter ${p} (erlaubt: {platz}, {ort})`);
    }
  }
  if (typeof WERTE.besetzung_tag.wert !== 'string' || !/^[a-z_]+$/.test(WERTE.besetzung_tag.wert) || WERTE.besetzung_tag.wert.length > WERTE.schluessel_max.wert) out.push('besetzung_tag ist ein kurzer Text (a-z, _)');
  return out;
}

module.exports = { baustein, handler, nachTaetigkeit, update, datenFehler, besetzungVon, TEXTE, WERTE };
