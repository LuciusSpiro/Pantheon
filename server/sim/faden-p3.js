'use strict';
// SUND-04a-2 P3: die Bausteine notruf, enthuellung und abschluss der Geschichtsfaeden (Freie Fahrt Sund, Schalter FAEDEN=1). Action-Layer wie faden-bitte.js.
// Die Bausteine tragen sich mit faden-bausteine.js ein; die Beats (Katalog beats.json, Vorlagen content/faeden/vorlagen/) bestimmen Ort, Text und Folgen, nie der Code.
//
//   notruf      (Beat „notruf“) Der NSC ruft um Hilfe: Funkzeile mit Porträt (faden-bitte funkVon), Ort aus dem Beat oder dem Faden, Gefahr angekündigt (Text).
//               Ausgang gelungen, wenn das Schiff den Ort erreicht (update, Takt aus reise-ereignis), gescheitert, wenn die Frist des Beats abläuft (Faden-Takt).
//               Der Text erinnert sich: hat der NSC im Gedaechtnis ein Ereignis aus p3-texte.json (erinnert), spricht er es an.
//   enthuellung (Beat „enthuellung“) Die verborgene Wahrheit kommt heraus (Funk, nsc.wahrheit.offenbart setzt faden.js). Die Folge ist eine germanische Sprengung eines
//               römischen Postens in der Nähe des Ortes (Sim-Befehl sabotage, regie-befehle fadenSabotage). ALTWEG: diese feste Sprengung ohne Folge sim_befehl gilt nur noch für Abenteuer (Bauplan, faden-bauplan.js),
//               deren Enthüllungs-Beat keine Folge sim_befehl trägt (keine der mitgelieferten Vorlagen); die Vorlagen kennen sie nicht mehr. Was für die Sprengung gilt (Nacharbeit L12, so im Code):
//                 Ziel     der nächste römische Posten (nie ein Hafen, NIE ein Posten der Crew) innerhalb von sprengung_reichweite Sprüngen (Daten p3-texte.json, Hex-Abstand
//                          über shared/sektoren.js hexAbstand), bei Gleichstand der kleinere Code. Der Vorwarntext `sabotage_stuetzpunkt` entfällt: ein Posten der Crew ist kein Ziel.
//                 Prüfung  der Kern-Prüfer (server/weltsim/befehle.js sabotage) und Vorwarnung mit Vorlauf (regie-werte.json vorwarnung.sabotage, Text in lage-befehle.json), wie bei den
//                          Befehlen des Spielleiters; Entwarnung (lage-befehle.json entwarnung.sabotage), wenn die Sprengung verfällt (Ausfall, im Tick abgelehnt, Tick gescheitert).
//                 Rate     KEINE: ein Faden-Befehl zählt nie gegen die Rate der Plan-Befehle und hat keine Abkühlzeit (regie-werte.json abkuehlung.sabotage = 0).
//                 Obergrenze wartender Befehle: vorgemerkt_max gilt nicht beim Vormerken der Sprengung; der Leser (regie-befehle lesen) schneidet sie nie über vorgemerkt_max ab.
//               Gelungen, wenn die Sprengung angekündigt ist; gescheitert, wenn es kein gültiges Ziel gibt oder der Kern die Sprengung ablehnt (Fallback: der Faden ändert sich, Funk und Chronik).
//               FAD-01 A: hat der Beat in der Vorlage die Folge sim_befehl (aus.gelungen.folge, Prüfer faden-pruefer.js simBefehlFolge), bestimmt die Art (faden_weiter.art des Spielleiters, sonst die Standardart,
//                 Daten werte.json sim_befehl) die Wirkung: sprengung = wie oben, invasion = invasionsZiel + regie-befehle fadenInvasion (eine germanische Flotte wird hochgestuft und greift das römische Ziel an),
//                 beides = beide in der Reihenfolge der Daten. Die Invasion ist EIN atomarer Kern-Befehl (Hochstufen und Angriff, beides oder nichts), mit Abkühlzeit je Fraktion (regie-werte.json abkuehlung.invasion). Gelungen, wenn mindestens eine Wirkung angekündigt ist (die Ankündigung per Funk kommt aus dem Kern vor jeder Wirkung). Ohne diese Folge
//                 bleibt der Baustein unverändert (andere Vorlagen). Eine solche Folge steht nur hinter einer Tat der Crew (Prüfer SIM_BEFEHL_OHNE_TAT), nie bei bloßem Zeitablauf.
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
const P = Pruefer;
const Hinweis = () => require('./faden-hinweis.js');
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');
const Regie = () => require('./regie-befehle.js');
const SB = D.WERTE.sim_befehl;   // FAD-01 A: Arten, Standardart (Daten werte.json)
const fmt = (t, v) => String(t == null ? '' : t).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));
const hexName = (hex) => { try { return Sektoren.hexName(hex) || hex; } catch (e) { return hex; } };
const fehlerZaehlen = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };
const poolText = (game, faden, beatId, slots) => { try { return require('./abenteuer-texte.js').haken(game, faden, beatId, slots); } catch (e) { fehlerZaehlen(game, 'faden-p3-pool', e); return null; } };   // SPL-02 E3: Zeile der Absicht, sonst null
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
    const f = W.gefahr_texte.wert.includes(key) ? sagenGefahr(game, nsc, text) : sagen(game, nsc, text);   // FRE-03 Nacharbeit S1: roter Akzent nur, wo der Text Gefahr ankuendigt (Daten gefahr_texte), eine Havarie ohne Gefahr bleibt Messing
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
    if (!P.notrufBrettFaden(f)) sagen(game, nsc, fmt(T.notruf_dank, { name: nsc.name }));   // FRE-03 Nacharbeit S1: bei einem Brett-Notruf dankt der Katalog-Eintrag (reise-ereignis.js, bei Gefahr erst nach dem Kampf), nie zweimal
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
// FAD-01 A: das nächste römische Sim-Ziel einer Invasion: Posten oder Hafen Roms (nie ein Posten der Crew, nie eine Hauptwelt) innerhalb von invasion_reichweite Sprüngen vom Ort (Hex-Abstand);
// bei Gleichstand der kleinere Code. Keines: null. Eigene Funktion neben ziel() (die Sprengung trifft nur Posten, nie einen Hafen).
function invasionsZiel(game, ort) {
  const ws = game.weltsim && game.weltsim.zustand;
  if (!ws || !HEX.test(ort || '')) return null;
  const d = require('../weltsim/daten.js').datenVon(ws);
  const haupt = Object.values(d.hauptwelten || {});
  const reichweite = W.invasion_reichweite.wert;
  let best = null, bd = Infinity;
  for (const code of Object.keys(ws.hexe).sort()) {
    const nd = ws.hexe[code];
    if (nd.besitzer !== 'rom' || nd.crew === true || haupt.includes(code)) continue;
    if (!(nd.posten || (d.hex[code] && d.hex[code].hafen))) continue;   // ein Stützknoten: Posten oder Hafen
    const dist = Sektoren.hexAbstand(ort, code);
    if (dist === null || dist > reichweite) continue;
    if (dist < bd) { best = code; bd = dist; }
  }
  return best;
}
// FAD-01 A: die Wirkungen einer Enthüllung mit der Folge sim_befehl. Die Namen der Befehle je Art stehen in den Daten (SB.arten), hier steht nur, wie ein Name ausgeführt wird.
const SIM_BEFEHLE = {
  sabotage(game, faden) {
    const z = ziel(game, faden.parameter && faden.parameter.ort);
    return { ziel: z, r: z ? Regie().fadenSabotage(game, z) : { ok: false, grund: 'kein römischer Posten in der Nähe' } };
  },
  invasion(game, faden) {
    const z = invasionsZiel(game, faden.parameter && faden.parameter.ort);   // der Ort des Fadens (das Lieferziel wird nicht aufbewahrt: nach der Ablieferung ist faden.fracht weg: faden.js beatAusgang löscht es, sobald kein Lade-Beat die Ware mehr hält, BEA-01 C1)
    return { ziel: z, r: z ? Regie().fadenInvasion(game, { ziel: z }) : { ok: false, grund: 'kein römisches Ziel in Reichweite' } };
  },
};
function simBefehl(game, faden, ctx, folge) {
  const nsc = nscVon(game, faden.nsc.id) || faden.nsc;
  const art = Pruefer.simBefehlArten(folge).includes(ctx.art) ? ctx.art : SB.standard_art;   // der Spielleiter wählt, ohne Angabe die Standardart
  const namen = SB.arten[art] || [];
  const erg = {};   // Befehl -> { ziel, r }
  for (const n of namen) if (SIM_BEFEHLE[n]) erg[n] = SIM_BEFEHLE[n](game, faden);
  const ok = namen.filter((n) => erg[n] && erg[n].r.ok);
  const mitFracht = (nsc.gedaechtnis || []).some((g) => g.ereignis === 'fracht_gelungen' || g.ereignis === 'fracht_gescheitert');
  const keys = W.sim_texte.wert[ok.join('+')];
  const key = ok.length && keys ? keys[mitFracht ? 0 : 1] : W.sim_texte_keines.wert[art];
  const ort = hexName((faden.parameter && faden.parameter.ort) || '');
  sagen(game, nsc, fmt(T[key], { name: nsc.name, ort, ziel: erg.sabotage && erg.sabotage.ziel ? hexName(erg.sabotage.ziel) : '', invasion: erg.invasion && erg.invasion.ziel ? hexName(erg.invasion.ziel) : '' }));
  const ziele = {}; for (const n of namen) if (erg[n]) ziele[n] = erg[n].ziel || null;
  const grund = namen.filter((n) => erg[n] && !erg[n].r.ok).map((n) => `${n}: ${erg[n].r.grund}`).join('; ');
  logbuch(game, 'faden_baustein', { ausgang: ok.length ? 'sim_befehl' : 'sim_befehl_abgelehnt', key: 'enthuellung', begruendung: ok.length ? `Wirkung ${art} angekündigt: ${ok.join(', ')}${grund ? ' (abgelehnt: ' + grund + ')' : ''}` : `Keine Wirkung (${art}): ${grund}`, plan: { faden: faden.id, beat: ctx.beat.id, art, ziele } });
  return { ausgang: ok.length ? 'gelungen' : 'gescheitert' };
}
const enthuellung = {
  id: 'enthuellung',
  starten(game, faden, ctx) {
    const folge = Pruefer.simBefehlFolge(ctx.beat);   // FAD-01 A: die Folge sim_befehl der Vorlage; ohne sie das bisherige Verhalten (feste Sprengung)
    if (folge) return simBefehl(game, faden, ctx, folge);
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
    const key = nsc.status === 'tot' ? 'abschluss_tot' : !gelungen ? 'abschluss_gescheitert' : P.notrufBrettFaden(faden) ? W.notruf_abschluss_text.wert : (ctx.beat.parameter && ctx.beat.parameter.text_key && T[ctx.beat.parameter.text_key] ? ctx.beat.parameter.text_key : 'abschluss_gelungen');
    const text = (nsc.status !== 'tot' && poolText(game, faden, ctx.beat.id, [key])) || fmt(T[key], { name: nsc.name });   // SPL-02 E3: Haken (Slot = Textschluessel), ohne angemeldeten Plan und bei einem Toten null
    if (nsc.status === 'tot') Bitte().funkSprecher(game, W.tot_sprecher.wert, text);   // Nacharbeit F3d: ein Toter spricht nie selbst (kein eigener Name, kein Porträt)
    else sagen(game, nsc, text);
    return { ausgang: gelungen ? 'gelungen' : 'gescheitert' };
  },
};

// FRE-03 Nacharbeit R2 B2/B3: die Crew hat einen angenommenen Brett-Notruf im Stich gelassen (die Frist des Eintrags ist nach dem Annehmen abgelaufen, oder sie sprang vor oder waehrend des Kampfs einer Gefahr weg):
// der Faden endet als gescheitert, nie als gelungen. Laeuft der Beat notruf noch (Frist), scheitert er (Folgen aus den Daten: im Stich gelassen, kein "geholfen", kein Dank); dann steht der Abschluss aus und der Rueckfall (oder der
// Spielleiter) fuehrt ihn weiter, ohne Erfolg-Ereignis im Gedaechtnis ist er gescheitert (Text abschluss_gescheitert). Hat die Ankunft den Beat schon gelungen beendet (Gefahr: die Crew kam an und sprang weg), wird das Gedaechtnis
// berichtigt (notruf_gelungen -> notruf_gescheitert), damit der Abschluss gescheitert ausfaellt; die Haltung aus der Ankunft bleibt (die Ankunft hat es gegeben). Ohne Faden zu dieser Marke tut sie nichts. -> true, wenn ein Faden betroffen war
function notrufImStich(game, marke) {
  const F = Faden().aktiv(game) ? Faden().zustandVon(game) : null;
  const f = F && F.liste.find((x) => x.phase !== 'abgeschlossen' && x.notruf && x.notruf.marke === marke);
  if (!f) return false;
  const v = D.vorlage(f.vorlage);
  if (f.phase === 'laeuft' && v.beats[f.beat].typ === 'notruf') { Faden().beatAusgang(game, f.id, 'gescheitert'); return true; }
  const g = f.nsc.gedaechtnis || [];
  for (let i = g.length - 1; i >= 0; i--) if (g[i].ereignis === 'notruf_gelungen') { g[i].ereignis = 'notruf_gescheitert'; break; }
  return true;
}

module.exports = { notruf, enthuellung, abschluss, update, ziel, invasionsZiel, notrufText, notrufImStich };
