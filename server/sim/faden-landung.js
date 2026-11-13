'use strict';
// FAB-01 B: Baustein des Beats landung (Action-Layer wie faden-forderung.js). Die Crew landet an einem Ort des Plans (Landeplatz, DYN-01), beamt runter und wieder hoch. Der Baustein ist die Daten-Seite plus der
// Handler am Boden-Verteiler (faden-boden.js): WER am Ort steht (Tabelle besetzung, content/faeden/boden-werte.json), WAS der Funk sagt (boden-texte.json) und wie lange der Beat laeuft (Katalog beats.json: frist,
// braucht.landeplatz) steht in den Daten; im Code steht kein Zahlenwert, keine Fraktion und kein Beat-Name ausser dem eigenen.
//
//   starten(game, faden, ctx)   Der Ort entsteht schon vorher (faden.js ruft abenteuer-orte.beatStarten fuer den Parameter landeplatz). Hier: die Karte wird registriert (landepunkte.bereit), je nach Parameter besetzung
//                               besetzt (combat.besetzen), der Funk nennt den Landeplatz. -> { laeuft: true }. Fehlt der Ort, scheitert der Beat.
//   Handler (faden-boden.js, Art landung), nur fuer den laufenden Beat dieses Fadens:
//     beamedDown   merkt "unten gewesen"; holt die Besetzung nach, falls fuer die Karte kein Merker steht (Spiel gespeichert und geladen: der Ort kommt aus dem Faden zurueck, aber leer)
//     beamedUp     gelungen, wenn unten gewesen UND danach niemand mehr unten ist; mit data.notrueckholung (Ausbluten, squadRecall): gescheitert, sobald niemand mehr unten ist (die Crew wurde geholt,
//                  sie ging nicht freiwillig); kommen dabei Mitspieler nicht mit, wartet der Beat auf sie
//     notsprung    gescheitert
//   nachTaetigkeit(game), update(game)   dieselbe Pruefung "niemand mehr unten" beim Takt der Taetigkeiten (faden.taetigkeit) und bei jedem Tick (reise-ereignis.update): viele Wege nach oben melden kein beamedUp
//                                         (Verbindung getrennt, resetMap, interior.updateDowned u. a., siehe faden-boden.js). Nur fuer Faeden, die "unten gewesen" gemerkt haben: sonst sofort zurueck.
//   vergessen(game)             Tests: der Laufzeit-Zustand dieses Spiels ist weg (so, wie nach Speichern und Laden)
// Gescheitert bei: Frist (faden.js, Taetigkeiten, am Boden zaehlt keine), Faden-Ende, Notrueckholung, Notsprung. Den Ort raeumt der vorhandene Faden-Abschluss ab (abenteuer-orte.abraeumen), ist die Crew noch unten, im naechsten Takt.
// Laufzeit-Zustand (WeakMap auf das Spiel) steht NICHT im Weltstand: { besetzt: Karten mit Merker (combat.besetzen ist je Karte idempotent), unten: Faeden, die "unten gewesen" gemerkt haben }.
const D = require('./faden-daten.js');
const Boden = require('./faden-boden.js');
const Sektoren = require('../../shared/sektoren.js');
const TEXTE = require('../../content/faeden/boden-texte.json').texte;
const WERTE = require('../../content/faeden/boden-werte.json').werte;

const ART = 'landung';   // Katalogtyp des Beats (beats.json); der Baustein traegt denselben Namen
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const fmt = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (has(v, k) ? v[k] : m));
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const fehlerZaehlen = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');
const Orte = () => require('./abenteuer-orte.js');
const Landepunkte = () => require('./landepunkte.js');
const Combat = () => require('./combat.js');
const logbuch = (game, e) => { try { require('./regie-befehle.js').schreibe(game, Object.assign({ art: 'faden_baustein', quelle: 'regie' }, e)); } catch (err) { fehlerZaehlen(game, 'faden-landung-logbuch', err); } };

const zustaende = new WeakMap();   // game -> { besetzt: Set(Karte), unten: Set(Fadenid) }
function zustandVon(game) {
  let z = zustaende.get(game);
  if (!z) { z = { besetzt: new Set(), unten: new Set() }; zustaende.set(game, z); }
  return z;
}
const vergessen = (game) => { zustaende.delete(game); };

// ---------- Daten
const besetzungsSchluessel = (beat) => {
  const k = beat && beat.parameter && beat.parameter.besetzung;
  return typeof k === 'string' && has(WERTE.besetzung.wert, k) ? k : WERTE.besetzung_standard.wert;
};
const besetzungVon = (beat) => WERTE.besetzung.wert[besetzungsSchluessel(beat)];   // {} = keine Besetzung
const verlangt = (e) => !!e && typeof e.fraktion === 'string';

// Der laufende Beat dieses Fadens, wenn er ein landung-Beat ist (sonst null)
function laufenderBeat(f) {
  if (!f || f.phase !== 'laeuft' || !f.laufend) return null;
  const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
  if (!beat || beat.id !== f.laufend.beat || beat.typ !== ART || f.laufend.variante) return null;
  return beat;
}
// Karten-Id des Landeplatzes dieses Beats (nur solange der Ort da ist), sonst null
function ortVon(game, f, beat) {
  const id = beat && beat.parameter ? beat.parameter.landeplatz : undefined;
  return typeof id === 'string' ? Orte().landeplatzVon(game, f.id, id) : null;
}
// Name des Landeplatzes fuer den Funk: der Name im Plan, sonst der Standardname der Kartenart (abenteuer-orte.json)
function platzName(f, beat) {
  const id = beat.parameter.landeplatz;
  const def = ((f.plan && f.plan.landeplaetze) || []).find((x) => x && x.id === id);
  return (def && def.name) || (def && Orte().DATEN.standardname[def.art]) || 'Landeplatz';
}
// game-weit: ein away, alle Spieler teilen die Karte (wie abenteuer-orte.unten)
const niemandUnten = (game, lp) => !(game.players || []).some((p) => p.zone === 'away' && game.away && game.away.map === lp);

// ---------- Besetzung (idempotent je Karte)
// Direkt nach dem Beat-Start ist die Karte meist noch nicht gebaut (landepunkte baut ausserhalb des Ticks): sobaldGeladen fuehrt die Besetzung sofort aus, wenn die Karte registriert werden kann, sonst bei der Registrierung
// (ein Schluessel je Karte, nie doppelt). Der Merker (besetzt) macht combat.besetzen je Karte idempotent. -> Zahl der Gegner, wenn sie jetzt entstanden sind (0: spaeter, nicht verlangt oder schon besetzt)
function besetzen(game, beat, lp) {
  const e = besetzungVon(beat), schluessel = besetzungsSchluessel(beat);
  if (!verlangt(e) || zustandVon(game).besetzt.has(lp)) return 0;
  let n = 0;
  const stand = Landepunkte().sobaldGeladen(game, lp, ART, () => {
    const z = zustandVon(game);
    if (z.besetzt.has(lp)) return;
    n = Combat().besetzen(game, { map: lp, fraktion: e.fraktion, staerke: e.staerke, haltung: e.haltung, tag: WERTE.besetzung_tag.wert });
    if (n > 0) z.besetzt.add(lp);
    else fehlerZaehlen(game, 'faden-landung', new Error(`Besetzung ${schluessel} an ${lp} ergab keinen Gegner`));
  });
  if (stand === 'unbekannt') fehlerZaehlen(game, 'faden-landung', new Error(`Landeplatz ${lp} ist dem Spiel unbekannt, keine Besetzung`));
  return n;
}

// ---------- Ausgang
function ausgang(game, f, art) {
  zustandVon(game).unten.delete(f.id);
  return Faden().beatAusgang(game, f.id, art);
}
function pruefen(game) {
  const z = zustaende.get(game);
  if (!z || !z.unten.size) return;
  const F = game.weltsim && game.weltsim.faeden;
  if (!F) return;
  for (const fid of Array.from(z.unten)) {
    const f = F.liste.find((x) => x.id === fid), beat = laufenderBeat(f), lp = beat && ortVon(game, f, beat);
    if (!lp) { z.unten.delete(fid); continue; }
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
      zustandVon(game).unten.add(f.id);
      besetzen(game, beat, lp);   // nachholen (Merker fehlt), sonst nichts
      return;
    }
    if (ev.name === 'beamedUp') {
      if (!zustandVon(game).unten.has(f.id) || !niemandUnten(game, lp)) return;
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
    zustandVon(game).unten.delete(faden.id);   // jeder Beat beginnt ohne "unten gewesen"
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

module.exports = { baustein, handler, nachTaetigkeit, update, vergessen, datenFehler, besetzungVon, TEXTE, WERTE };
