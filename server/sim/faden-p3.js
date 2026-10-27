'use strict';
// SUND-04a-2 P3: die Bausteine notruf, enthuellung und abschluss der Geschichtsfaeden (Freie Fahrt Sund, Schalter FAEDEN=1). Action-Layer wie faden-bitte.js.
// Die Bausteine tragen sich mit faden-bausteine.js ein; die Beats (Katalog beats.json, Vorlagen content/faeden/vorlagen/) bestimmen Ort, Text und Folgen, nie der Code.
//
//   notruf      (Beat „notruf“) Der NSC ruft um Hilfe: Funkzeile mit Porträt (faden-bitte funkVon), Ort aus dem Beat oder dem Faden, Gefahr angekündigt (Text).
//               Ausgang gelungen, wenn das Schiff den Ort erreicht (update, Takt aus reise-ereignis), gescheitert, wenn die Frist des Beats abläuft (Faden-Takt).
//               Der Text erinnert sich: hat der NSC im Gedaechtnis ein Ereignis aus p3-texte.json (erinnert), spricht er es an.
//   enthuellung (Beat „enthuellung“) Die verborgene Wahrheit kommt heraus (Funk, nsc.wahrheit.offenbart setzt faden.js). Die Folge ist eine germanische Sprengung eines
//               römischen Postens in der Nähe des Ortes (Sim-Befehl sabotage, regie-befehle fadenSabotage). Was für die Sprengung gilt (Nacharbeit L12, so im Code):
//                 Ziel     der nächste römische Posten (nie ein Hafen, NIE ein Posten der Crew) innerhalb von sprengung_reichweite Sprüngen (Daten p3-texte.json, Hex-Abstand
//                          über shared/sektoren.js hexAbstand), bei Gleichstand der kleinere Code. Der Vorwarntext `sabotage_stuetzpunkt` entfällt: ein Posten der Crew ist kein Ziel.
//                 Prüfung  der Kern-Prüfer (server/weltsim/befehle.js sabotage) und Vorwarnung mit Vorlauf (regie-werte.json vorwarnung.sabotage, Text in lage-befehle.json), wie bei den
//                          Befehlen des Spielleiters; Entwarnung (lage-befehle.json entwarnung.sabotage), wenn die Sprengung verfällt (Ausfall, im Tick abgelehnt, Tick gescheitert).
//                 Rate     KEINE: ein Faden-Befehl zählt nie gegen die Rate der Plan-Befehle und hat keine Abkühlzeit (regie-werte.json abkuehlung.sabotage = 0).
//                 Obergrenze wartender Befehle: vorgemerkt_max gilt nicht beim Vormerken der Sprengung; der Leser (regie-befehle lesen) schneidet sie nie über vorgemerkt_max ab.
//               Gelungen, wenn die Sprengung angekündigt ist; gescheitert, wenn es kein gültiges Ziel gibt oder der Kern die Sprengung ablehnt (Fallback: der Faden ändert sich, Funk und Chronik).
//   abschluss   (letzter Beat) Der Faden endet. Welle 3: gelungen nur, wenn die Crew etwas geleistet hat (Daten: beat.erfolg.ereignis, Gedächtnis des NSC), sonst gescheitert. Nur der gelungene Abschluss
//               zahlt Haltung und Ruf seines Ausgangs (Wirkungen aus den Daten, faden.js beatAusgang); ein gescheiterter Faden endet ohne Belohnung (Text abschluss_gescheitert, ein Toter: abschluss_tot).
//
//   update(game)  Takt (Aufrufer: reise-ereignis.update). Wartet auf die Ankunft am Ort JEDES laufenden Notruf-Beats. Nacharbeit L8: es gibt keinen eigenen Laufzeitzustand mehr (früher game.fadenNotruf,
//                 ein Platz, nicht gespeichert): der Faden SELBST (phase laeuft, laufender Beat vom Baustein notruf, gespeichert) ist der Zustand, der Ort kommt aus dem Beat (parameter.hex) oder dem
//                 Faden (parameter.ort). Mehrere Notrufe laufen gleichzeitig (je Faden), und ein Notruf-Beat überlebt Speichern und Laden (die Frist zählt weiter).
//   Texte: content/faeden/p3-texte.json.
const Sektoren = require('../../shared/sektoren.js');
const TX = require('../../content/faeden/p3-texte.json');
const T = TX.texte, W = TX.werte;
const HEX = /^\d{4}$/;
const D = require('./faden-daten.js');
const Pruefer = require('./faden-pruefer.js');
const Hinweis = () => require('./faden-hinweis.js');
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');
const Regie = () => require('./regie-befehle.js');
const fmt = (t, v) => String(t == null ? '' : t).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const fehlerZaehlen = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };
const logbuch = (game, art, e) => { try { Regie().schreibe(game, Object.assign({ art }, e)); } catch (err) { fehlerZaehlen(game, 'faden-p3-logbuch', err); } };
const nscVon = (game, id) => Faden().nscVon(game, id);

// Funk eines NSC (Porträt) ueber den gemeinsamen Weg der Bitten (faden-bitte.funkVon)
function sagen(game, nsc, text) {
  if (!text || !nsc) return null;
  return Bitte().funkVon(game, nsc, text);
}
function sagenGefahr(game, nsc, text) {   // der Notruf kuendigt Gefahr an (Wachschiffe): roter Akzent wie jede Gefahrmeldung, nie Messing
  if (!text || !nsc) return null;
  return Bitte().funkGefahrVon(game, nsc, text);
}

// ---------- notruf
// Erinnerung: der letzte Gedaechtnis-Eintrag mit einem Text aus `erinnert` gewinnt; sonst der Text des Beats
function notrufText(nsc, beat) {
  let key = (beat.parameter && beat.parameter.text_key) || null;
  for (const g of (nsc && nsc.gedaechtnis) || []) { const k = W.erinnert.wert[g.ereignis]; if (k && T[k]) key = k; }
  if (!key || !T[key]) key = 'notruf_standard';
  return key;
}
const notruf = {
  id: 'notruf',
  starten(game, faden, ctx) {
    const p = (ctx.beat && ctx.beat.parameter) || {};
    const hex = typeof p.hex === 'string' && HEX.test(p.hex) ? p.hex : (faden.parameter && faden.parameter.ort);
    if (!hex || !HEX.test(hex)) { logbuch(game, 'faden_baustein', { ausgang: 'abgelehnt', key: 'notruf', begruendung: 'Notruf ohne Ort: der Beat gilt als gescheitert', plan: { faden: faden.id } }); return { ausgang: 'gescheitert' }; }
    const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
    const key = notrufText(nsc, ctx.beat);
    const text = fmt(T[key], { name: nsc.name, ort: hexName(hex) });
    const f = sagenGefahr(game, nsc, text);
    if (!f) return { ausgang: 'gescheitert' };
    for (const h of ctx.beat.hinweise || []) Hinweis().senden(game, faden.id, h);   // der Notruf ist gesendet: die Hinweise des Beats werden gesendet und gelten erst danach
    logbuch(game, 'faden_baustein', { ausgang: 'notruf', key: 'notruf', begruendung: `Notruf von ${nsc.name} bei ${hexName(hex)}`, plan: { faden: faden.id, beat: ctx.beat.id, hex, text: key } });
    return { laeuft: true };
  },
};

// Ort eines laufenden Notruf-Beats (Beat-Parameter hex, sonst der Ort des Fadens); null, wenn der Beat des Fadens kein laufender Notruf ist
function notrufOrt(f) {
  if (!f || f.phase !== 'laeuft' || !f.laufend) return null;
  const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
  if (!beat || beat.id !== f.laufend.beat || !D.BEATS[beat.typ] || D.BEATS[beat.typ].baustein !== 'notruf') return null;
  if (require('./faden-bausteine.js').vonId('notruf') !== notruf) return null;   // nur der echte Baustein wartet auf die Ankunft (ein Platzhalter der Tests tut nichts, wie der Beat selbst)
  const p = beat.parameter || {};
  const hex = typeof p.hex === 'string' && HEX.test(p.hex) ? p.hex : (f.parameter && f.parameter.ort);
  return hex && HEX.test(hex) ? hex : null;
}
// Takt: die Ankunft am Ort beendet einen laufenden Notruf gelungen (jeden, auch mehrere zugleich); die Frist des Beats beendet ihn gescheitert (faden.js)
function update(game) {
  if (!game || !game.ship || !Faden().aktiv(game)) return;
  const F = Faden().zustandVon(game);
  const hier = Sektoren.hexVonOrt(game.ship.scene);
  if (!hier) return;
  try { require('./faden-szene.js').befreiungAnkunft(game, hier); } catch (e) { fehlerZaehlen(game, 'faden-befreiung', e); }   // Welle 3: eine wartende Befreiung beginnt, sobald das Schiff am Ort des NSC ist
  for (const f of F.liste.slice()) {
    if (notrufOrt(f) !== hier) continue;
    const nsc = nscVon(game, f.nsc.id) || f.nsc;
    sagen(game, nsc, fmt(T.notruf_dank, { name: nsc.name }));
    Faden().beatAusgang(game, f.id, 'gelungen');
  }
}

// ---------- enthuellung
// Der Posten Roms, der dem Ort am nächsten liegt (Hex-Abstand in Sprüngen, höchstens sprengung_reichweite; bei Gleichstand der kleinere Code). Nie ein Posten der Crew. Keiner: null.
function ziel(game, ort) {
  const ws = game.weltsim && game.weltsim.zustand;
  if (!ws || !HEX.test(ort || '')) return null;
  const reichweite = W.sprengung_reichweite.wert;
  let best = null, bd = Infinity;
  for (const code of Object.keys(ws.hexe).sort()) {
    const nd = ws.hexe[code];
    if (!nd.posten || nd.besitzer !== 'rom' || nd.crew === true) continue;   // ein Posten liegt nie auf einem Hafen; ein Posten der Crew ist kein Ziel
    const d = Sektoren.hexAbstand(ort, code);
    if (d === null || d > reichweite) continue;
    if (d < bd) { best = code; bd = d; }
  }
  return best;
}
const enthuellung = {
  id: 'enthuellung',
  starten(game, faden, ctx) {
    const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
    const z = ziel(game, faden.parameter && faden.parameter.ort);
    const r = z ? Regie().fadenSabotage(game, z) : { ok: false, grund: 'kein römischer Posten in der Nähe' };
    // Nacharbeit F7: hat die Crew nie eine Ware von ihm geladen (Ablehnen, kein Hafen), steht nirgends „die Fracht“
    // Welle 3: nur eine Ware, die WIRKLICH an Bord war (Ereignis fracht_gelungen oder fracht_gescheitert), nicht fracht_ohne_ware (kein Hafen, nie geladen)
    const mitFracht = (nsc.gedaechtnis || []).some((g) => g.ereignis === 'fracht_gelungen' || g.ereignis === 'fracht_gescheitert');
    const key = r.ok ? (mitFracht ? 'enthuellung_sabotage' : 'enthuellung_sabotage_ohne_fracht') : 'enthuellung_ohne';
    sagen(game, nsc, fmt(T[key], { name: nsc.name, ziel: z ? hexName(z) : '', ort: hexName((faden.parameter && faden.parameter.ort) || '') }));
    logbuch(game, 'faden_baustein', { ausgang: r.ok ? 'sabotage' : 'sabotage_abgelehnt', key: 'enthuellung', begruendung: r.ok ? `Sprengung bei ${hexName(z)} angekündigt (ab Tick ${r.ab})` : `Keine Sprengung: ${r.grund}`, plan: { faden: faden.id, beat: ctx.beat.id, ziel: z || null } });
    return { ausgang: r.ok ? 'gelungen' : 'gescheitert' };
  },
};

// ---------- abschluss
// Welle 3: der Ausgang haengt davon ab, was die Crew geleistet hat (beat.erfolg.ereignis, Daten, Pruefer ERFOLG_FEHLT): nur ein gelungener Abschluss zahlt seine Folgen (Haltung, Ruf).
// Ein Toter spricht nie selbst (tot geht vor); ohne Erfolg bekommt der NSC den Text abschluss_gescheitert.
const abschluss = {
  id: 'abschluss',
  starten(game, faden, ctx) {
    const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
    const gelungen = Pruefer.abschlussGelungen(ctx.beat, nsc);
    const key = nsc.status === 'tot' ? 'abschluss_tot' : !gelungen ? 'abschluss_gescheitert' : (ctx.beat.parameter && ctx.beat.parameter.text_key && T[ctx.beat.parameter.text_key] ? ctx.beat.parameter.text_key : 'abschluss_gelungen');
    const text = fmt(T[key], { name: nsc.name });
    if (nsc.status === 'tot') Bitte().funkSprecher(game, W.tot_sprecher.wert, text);   // Nacharbeit F3d: ein Toter spricht nie selbst (kein eigener Name, kein Porträt)
    else sagen(game, nsc, text);
    return { ausgang: gelungen ? 'gelungen' : 'gescheitert' };
  },
};

module.exports = { notruf, enthuellung, abschluss, update, ziel, notrufText };
