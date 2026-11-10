'use strict';
// SPL-02 F: der Vorrat der Absichten, die schmale Schnittstelle fuer FRE-02 (Missionsangebote beim Andocken) und FRE-03 (Notrufe als Einstieg). Action-Layer: ein erzeugtes, aber nicht gespieltes Angebot geht als Absicht
// MIT Bezug in den Vorrat und wird spaeter wieder angeboten, wenn es noch zur Welt passt (kein neuer Komponisten-Aufruf). Der Eintrag traegt die Absicht (Format absicht/1), nie nur den Plan: die Gueltigkeit prueft die Welt
// erneut ueber denselben Pruefer und Inszenierer (inszenierer.js), nicht eine Kopie ihrer Regeln. Dieses Modul kennt keinen Absichts-, keinen Beat- und keinen Art-Namen: `art` ist ein Name nach name_muster (die Aufrufer
// FRE-02/03 vergeben ihn), alle Grenzen stehen in content/faeden/absichten.json unter werte (vorrat_max, vorrat_alter_max). FRE-02/03 selbst sind hier NICHT gebaut.
//
//   Eintrag: { absicht: absicht/1 (Bezug als Vollname, nie eine Kennung), plan?: faden-bauplan/1, hex: Ort bei der Aufnahme, bezug?: { nsc: Vollname } (wie am Angebot), art: Name, erstellt: Tick (weltsim.tickZahl), ablauf?: Tick }
//   eintrag(game, { absicht, art, ablauf? }) -> { ok, eintrag } | { ok: false, grund, text, fehler }   baut den Eintrag aus einer Absicht ueber den Inszenierer (hex, plan, bezug, erstellt); Kennungen (K1) werden zu Vollnamen
//   gueltig(game, eintrag) -> { ok: true, hex } | { ok: false, grund, text, fehler? }   prueft den Eintrag erneut gegen die Welt: Form, Alter (ABGELAUFEN), Absicht und Parameter, Ort, Weltbedingungen, Wiederholungsregeln und
//        den Bezug (kein Kandidat mehr, tot, verdraengt, ersetzt: BEZUG_VERALTET). hex ist der Ort JETZT (der Inszenierer waehlt ihn aus der Lage, nicht der gespeicherte). grund ist ein Code, text ein Klartext ohne Namen
//   anbieten(game, eintrag) -> { ok: true, angebot, inszenierung } | { ok: false, grund, text, fehler? }   nur wenn gueltig; ueber anbietenAusAbsicht (Brett.neuAnbieten mit hex, bezug, locker); ein Eintrag des Vorrats wird dabei entnommen
//   hinzufuegen(game, eintrag) -> { ok: true, vorrat: Zahl } | { ok: false, grund, text }   nur gueltige Eintraege; ueber vorrat_max verdraengt der aelteste; derselbe Eintrag (art, Absicht) nicht doppelt
//   verwirfUngueltige(game) -> [{ art, grund }]   prueft jeden Eintrag erneut und entfernt die ungueltigen (nur Art und Code, nie Namen)
//   ausVorrat(game, art) -> { ok: true, angebot, inszenierung } | { ok: false, grund }   der aelteste GUELTIGE Eintrag dieser Art wird angeboten; ungueltige davor werden verworfen; VORRAT_LEER, wenn nichts passt
//   liste(game) -> [Eintrag] (Kopie)       toSave(F) -> [Eintrag] | null       lesen(block, F)   Weltstand welt.sim.faeden.abenteuer.vorrat (additiv, Altstand ohne Block: leer, muellfest: ohne Welt wird nur die Form geprueft,
//        Unbrauchbares faellt weg, Meldung in F.ladeFehler; die Gueltigkeit gegen die Welt prueft verwirfUngueltige)       werteFehler(katalog?) -> [Text]       CODES
// Der Weltstand-Block steht in welt.sim.faeden.abenteuer (abenteuer-brett.js toSave/lesen), weil die Fadenmaschine (faden.js) unveraendert bleibt; faden.js ruft nur toSave/lesen des Bretts.
const AP = () => require('./absicht-pruefer.js');
const INS = () => require('./inszenierer.js');
const Brett = () => require('./abenteuer-brett.js');
const Faden = () => require('./faden.js');
const Bauplan = () => require('./faden-bauplan.js');
const Geschichte = () => require('./abenteuer-geschichte.js');
const Texte = () => require('./abenteuer-texte.js');
const Sektoren = require('../../shared/sektoren.js');

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const klon = (x) => JSON.parse(JSON.stringify(x));
const HEX = /^\d{4}$/;
const FELDER = ['absicht', 'plan', 'hex', 'bezug', 'art', 'erstellt', 'ablauf'];
const PROTO = ['__proto__', 'constructor', 'prototype'];
const CODES = Object.freeze({ VORRAT_FORM: 'VORRAT_FORM', ABGELAUFEN: 'ABGELAUFEN', VORRAT_LEER: 'VORRAT_LEER', INAKTIV: 'INAKTIV' });
const wert = (katalog, k) => katalog.werte[k].wert;
const nein = (grund, text, fehler) => (fehler ? { ok: false, grund, text, fehler } : { ok: false, grund, text });

const zustand = (game) => { try { return Faden().aktiv(game) ? Faden().zustandVon(game) : null; } catch (e) { return null; } };
const jetzt = (game) => (game && game.weltsim && Number.isFinite(game.weltsim.tickZahl) ? game.weltsim.tickZahl : 0);
const protoSchluessel = (x, tiefe) => {
  if (!x || typeof x !== 'object') return false;
  if (tiefe > 6) return true;
  return Object.keys(x).some((k) => PROTO.includes(k) || protoSchluessel(x[k], tiefe + 1));
};
const bezugOk = (b, katalog) => istObjekt(b) && Object.keys(b).length === 1 && typeof b.nsc === 'string' && b.nsc.trim().length >= 3 && b.nsc.length <= wert(katalog, 'vorrat_name_max');   // Namen wie am Angebot (abenteuer-brett.js bezugVon)
const kurz = (t, katalog) => String(t).slice(0, wert(katalog, 'vorrat_text_max'));

// ---------- Form (ohne Welt): auch der Leser nutzt sie
function formFehler(e, katalog) {
  katalog = katalog || AP().katalogStandard();
  if (!istObjekt(e)) return 'der Eintrag ist kein Objekt';
  if (protoSchluessel(e, 0)) return 'unzulaessiger Schluessel';
  for (const k of Object.keys(e)) if (!FELDER.includes(k)) return `unbekanntes Feld ${kurz(k, katalog)}`;
  const a = e.absicht;
  if (!istObjekt(a) || a.format !== 'absicht/1' || typeof a.absicht !== 'string' || !has(katalog.absichten, a.absicht)) return 'absicht ist keine Absicht des Katalogs (absicht/1)';
  if (istObjekt(a.bezug) && typeof a.bezug.nsc === 'string' && Geschichte().istKennung(a.bezug.nsc)) return 'der Bezug nsc ist der Vollname, nie eine Kennung der Sitzung';
  let n = 0; try { n = JSON.stringify(a).length; } catch (x) { n = Infinity; }
  if (n > wert(katalog, 'absicht_max_zeichen')) return 'absicht ist zu gross';
  if (typeof e.hex !== 'string' || !HEX.test(e.hex) || !Sektoren.spielbar(e.hex)) return 'hex ist kein spielbarer Sektor';
  if (typeof e.art !== 'string' || !new RegExp(wert(katalog, 'name_muster')).test(e.art)) return 'art ist ein Name nach name_muster';
  if (!Number.isInteger(e.erstellt) || e.erstellt < 0) return 'erstellt ist ein Tick (ganze Zahl >= 0)';
  if (e.ablauf !== undefined && !(Number.isInteger(e.ablauf) && e.ablauf >= e.erstellt)) return 'ablauf ist ein Tick ab erstellt';
  if (e.plan !== undefined && !istObjekt(e.plan)) return 'plan ist ein Bauplan (Objekt)';
  if (e.bezug !== undefined) {
    if (!bezugOk(e.bezug, katalog)) return 'bezug ist { nsc: Vollname }';
    if (!istObjekt(a.bezug) || a.bezug.nsc !== e.bezug.nsc) return 'bezug stimmt nicht mit dem Bezug der Absicht ueberein';
  } else if (istObjekt(a.bezug) && typeof a.bezug.nsc === 'string') return 'die Absicht traegt einen Bezug nsc, der Eintrag nicht';
  return null;
}

// ---------- Aufnehmen
function eintrag(game, o) {
  const katalog = AP().katalogStandard();
  if (!istObjekt(o) || !istObjekt(o.absicht)) return nein(CODES.VORRAT_FORM, 'eintrag braucht eine Absicht');
  let absicht = klon(o.absicht);
  if (istObjekt(absicht.bezug) && typeof absicht.bezug.nsc === 'string' && Geschichte().istKennung(absicht.bezug.nsc)) {   // die Kennung (K1) gilt nur in der Sitzung: im Vorrat steht der Vollname
    const k = Geschichte().bezugImSpiel(game, absicht.bezug);
    if (!k.ok) return nein(k.fehler[0].code, 'die Kennung des Bezugs steht nicht in der Crew-Geschichte', k.fehler);
    absicht.bezug = k.bezug;
  }
  const r = INS().inszeniere(game, absicht, katalog);
  if (!r.ok) return abgelehnt(r.fehler);
  const e = { absicht, hex: r.hex, art: o.art, erstellt: jetzt(game) };
  if (r.bezug) e.bezug = { nsc: r.bezug.nsc };
  else if (istObjekt(absicht.bezug) && typeof absicht.bezug.nsc === 'string') e.bezug = { nsc: absicht.bezug.nsc };   // ein Bezug, den der Plan nicht nutzt, bleibt bei der Absicht und beim Eintrag
  if (istObjekt(r.plan)) e.plan = klon(r.plan);
  if (o.ablauf !== undefined) e.ablauf = o.ablauf;
  const f = formFehler(e, katalog);
  if (f) return nein(CODES.VORRAT_FORM, f);
  return { ok: true, eintrag: e };
}

// ---------- Gueltigkeit gegen die Welt
// Ein Nein des Inszenierers: betrifft es den NSC des Bezugs (kein Kandidat mehr, tot, verdraengt, ersetzt, nicht mehr grollend), ist der Bezug veraltet; BEZUG_ZU_FRISCH ist die Wiederholungsregel (bleibt, was sie ist)
function abgelehnt(fehler) {
  const codes = AP().CODES, ins = INS().CODES;
  const f = fehler.find((x) => x.feld === 'bezug.nsc' && x.code !== ins.BEZUG_ZU_FRISCH) || fehler[0];
  const veraltet = fehler.some((x) => x.feld === 'bezug.nsc' && x.code !== ins.BEZUG_ZU_FRISCH);
  const grund = veraltet ? codes.BEZUG_VERALTET : f.code;
  return nein(grund, veraltet ? 'der NSC des Bezugs steht nicht mehr zur Verfuegung (die Welt hat sich veraendert)' : `die Welt nimmt den Eintrag nicht mehr (${f.code}, Feld ${f.feld})`, fehler.map((x) => ({ code: x.code, feld: x.feld })));
}
function gueltig(game, e) {
  const katalog = AP().katalogStandard();
  const fo = formFehler(e, katalog);
  if (fo) return nein(CODES.VORRAT_FORM, fo);
  if (!zustand(game)) return nein(CODES.INAKTIV, 'die Faeden sind nicht eingeschaltet');
  const t = jetzt(game);
  if ((e.ablauf !== undefined && t > e.ablauf) || t - e.erstellt > wert(katalog, 'vorrat_alter_max')) return nein(CODES.ABGELAUFEN, 'der Eintrag ist zu alt');
  const r = INS().inszeniere(game, e.absicht, katalog);
  if (!r.ok) return abgelehnt(r.fehler);
  return { ok: true, hex: r.hex };
}

// ---------- Anbieten
function entnehmen(game, e) {
  const F = zustand(game);
  if (!F || !Array.isArray(F.vorrat)) return;
  const i = F.vorrat.indexOf(e);
  if (i >= 0) F.vorrat.splice(i, 1);
}
function anbieten(game, e) {
  const g = gueltig(game, e);
  if (!g.ok) return g;
  const katalog = AP().katalogStandard();
  const an = INS().anbietenAusAbsicht(game, e.absicht, katalog);
  if (!an.ok) { const f = an.fehler[0]; return nein(f.code, `das Brett nimmt den Eintrag nicht (${f.code})`, an.fehler.map((x) => ({ code: x.code, feld: x.feld }))); }
  try { Texte().anmelden(game, e.absicht, an.inszenierung, an.angebot, katalog); } catch (x) { if (game && game.countError) game.countError('abenteuer-texte', x); }
  entnehmen(game, e);
  return { ok: true, angebot: an.angebot, inszenierung: an.inszenierung };
}

// ---------- Vorrat im Zustand (F.vorrat)
function hinzufuegen(game, e) {
  const F = zustand(game);
  if (!F) return nein(CODES.INAKTIV, 'die Faeden sind nicht eingeschaltet');
  const g = gueltig(game, e);
  if (!g.ok) return g;
  if (!Array.isArray(F.vorrat)) F.vorrat = [];
  const schluessel = (x) => x.art + '|' + JSON.stringify(x.absicht);
  if (!F.vorrat.some((x) => schluessel(x) === schluessel(e))) F.vorrat.push(klon(e));
  const max = wert(AP().katalogStandard(), 'vorrat_max');
  while (F.vorrat.length > max) F.vorrat.shift();   // der aelteste weicht
  return { ok: true, vorrat: F.vorrat.length };
}
const liste = (game) => { const F = zustand(game); return F && Array.isArray(F.vorrat) ? klon(F.vorrat) : []; };
function verwirfUngueltige(game) {
  const F = zustand(game), out = [];
  if (!F || !Array.isArray(F.vorrat)) return out;
  for (const e of F.vorrat.slice()) { const g = gueltig(game, e); if (!g.ok) { entnehmen(game, e); out.push({ art: typeof e.art === 'string' ? e.art : '?', grund: g.grund }); } }
  return out;
}
function ausVorrat(game, art) {
  const F = zustand(game);
  if (!F || !Array.isArray(F.vorrat)) return nein(CODES.VORRAT_LEER, 'der Vorrat ist leer');
  for (const e of F.vorrat.slice()) {
    if (e.art !== art) continue;
    const g = gueltig(game, e);
    if (!g.ok) { entnehmen(game, e); continue; }   // ein veralteter Eintrag wird verworfen, der naechste probiert
    return anbieten(game, e);   // nimmt das Brett es gerade nicht (voll, Wiederholung), bleibt der Eintrag im Vorrat
  }
  return nein(CODES.VORRAT_LEER, 'kein gueltiger Eintrag dieser Art');
}

// ---------- Weltstand
function toSave(F) {
  if (!F || !Array.isArray(F.vorrat) || !F.vorrat.length) return null;
  return F.vorrat.slice(-wert(AP().katalogStandard(), 'vorrat_max')).map((e) => klon(e));
}
function lesen(b, F) {
  if (!F) return;
  if (!Array.isArray(b)) { F.ladeFehler.push('abenteuer.vorrat: verworfen'); return; }
  const katalog = AP().katalogStandard(), max = wert(katalog, 'vorrat_max'), out = [];
  for (const x of b.slice(-max)) {
    const f = formFehler(x, katalog);
    if (f) { F.ladeFehler.push('abenteuer.vorrat: Eintrag verworfen (' + f + ')'); continue; }
    const e = klon(x);
    if (e.plan !== undefined) { let r = { ok: false }; try { r = Bauplan().pruefe(e.plan); } catch (err) { r = { ok: false }; } if (!r.ok) delete e.plan; }   // ein kaputter Plan faellt weg, die Absicht bleibt (sie wird beim Anbieten neu inszeniert)
    out.push(e);
  }
  if (out.length) F.vorrat = out;
}

function werteFehler(katalog) {
  katalog = katalog || AP().katalogStandard();
  const o = [], f = (t) => o.push(`VORRAT_WERTE: ${t}`);
  for (const [k, min] of [['vorrat_max', 1], ['vorrat_alter_max', 1], ['vorrat_name_max', 3], ['vorrat_text_max', 1]]) if (!(has(katalog.werte, k) && istObjekt(katalog.werte[k]) && Number.isInteger(katalog.werte[k].wert) && katalog.werte[k].wert >= min)) f(`${k}: ganze Zahl >= ${min}`);
  return o;
}

module.exports = { CODES, eintrag, gueltig, anbieten, hinzufuegen, verwirfUngueltige, ausVorrat, liste, toSave, lesen, werteFehler };
