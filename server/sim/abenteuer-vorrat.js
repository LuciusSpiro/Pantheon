'use strict';
// SPL-02 F: der Vorrat der Absichten, die schmale Schnittstelle fuer FRE-02 (Missionsangebote beim Andocken) und FRE-03 (Notrufe als Einstieg). Action-Layer: ein erzeugtes, aber nicht gespieltes Angebot geht als Absicht
// MIT Bezug in den Vorrat und wird spaeter wieder angeboten, wenn es noch zur Welt passt (kein neuer Komponisten-Aufruf). Der Eintrag traegt die Absicht (Format absicht/1), nie nur den Plan: die Gueltigkeit prueft die Welt
// erneut ueber denselben Pruefer und Inszenierer (inszenierer.js), nicht eine Kopie ihrer Regeln. Dieses Modul kennt keinen Absichts-, keinen Beat- und keinen Art-Namen: `art` ist ein Name nach name_muster (die Aufrufer
// FRE-02/03 vergeben ihn), alle Grenzen stehen in content/faeden/absichten.json unter werte (vorrat_max, vorrat_alter_max; FRE-03 E: vorrat_max_je_art, vorrat_alter_max_s_je_art). FRE-02/03 selbst sind hier NICHT gebaut.
//
//   Eintrag: { absicht: absicht/1 (Bezug als Vollname, nie eine Kennung), plan?: faden-bauplan/1, hex: Ort bei der Aufnahme, bezug?: { nsc: Vollname } (wie am Angebot), art: Name, erstellt: Tick (weltsim.tickZahl), ablauf?: Tick }
//   eintrag(game, { absicht, art, ablauf? }) -> { ok, eintrag } | { ok: false, grund, text, fehler }   baut den Eintrag aus einer Absicht ueber den Inszenierer (hex, plan, bezug, erstellt); Kennungen (K1) werden zu Vollnamen
//   gueltig(game, eintrag) -> { ok: true, hex } | { ok: false, grund, text, fehler?, wartet?: true }   prueft den Eintrag erneut gegen die Welt: Form, Alter (ABGELAUFEN), Absicht und Parameter, Ort, Weltbedingungen, Wiederholungsregeln und
//        den Bezug (kein Kandidat mehr, tot, verdraengt, ersetzt: BEZUG_VERALTET). hex ist der Ort JETZT (der Inszenierer waehlt ihn aus der Lage, nicht der gespeicherte). grund ist ein Code, text ein Klartext ohne Namen
//   anbieten(game, eintrag) -> { ok: true, angebot, inszenierung } | { ok: false, grund, text, fehler? }   nur wenn gueltig; ueber anbietenAusAbsicht (Brett.neuAnbieten mit hex, bezug, locker); ein Eintrag des Vorrats wird dabei entnommen
//   hinzufuegen(game, eintrag) -> { ok: true, vorrat: Zahl } | { ok: false, grund, text }   nur gueltige Eintraege; ueber vorrat_max verdraengt der aelteste; derselbe Eintrag (art, Absicht) nicht doppelt
//   verwirfUngueltige(game) -> [{ art, grund }]   prueft jeden Eintrag erneut und entfernt die ungueltigen (nur Art und Code, nie Namen)
//   ausVorrat(game, art) -> { ok: true, angebot, inszenierung } | { ok: false, grund }   der aelteste GUELTIGE Eintrag dieser Art wird angeboten; ungueltige davor werden verworfen; VORRAT_LEER, wenn nichts passt
//   FRE-02 C: einlegenAus(game, angebot, art) -> wie hinzufuegen   legt ein Angebot MIT Absicht (verfallen, abgelehnt) wieder ein und BEHAELT sein erstes Alter (angebot.erstellt, additiv am Angebot): kein neues erstellt,
//        sonst kreiste ein verfallenes Angebot ewig; nur im Modus Absichten (ABENTEUER_ABSICHTEN), sonst INAKTIV. art nennt der Aufrufer (Daten).
//   FRE-02 C: ausVorratOhneSperre(game, art) -> wie ausVorrat   wie ausVorrat, ueberspringt aber Eintraege, deren Plan gegen die Sperren des Bretts laeuft (abgelehnt, zuletzt gespielt, Wiederholung: Brett.passtZuLage);
//        sie bleiben im Vorrat. Kein Eintrag dieser Art frei: das Brett bietet nie dasselbe sofort wieder an. Bei einem Nein des Bretts wird der naechste Eintrag probiert.
//   liste(game) -> [Eintrag] (Kopie)       toSave(F) -> [Eintrag] | null       lesen(block, F)   Weltstand welt.sim.faeden.abenteuer.vorrat (additiv, Altstand ohne Block: leer, muellfest: ohne Welt wird nur die Form geprueft,
//        Unbrauchbares faellt weg, Meldung in F.ladeFehler; die Gueltigkeit gegen die Welt prueft verwirfUngueltige)       werteFehler(katalog?) -> [Text]       CODES
// FRE-03 E: Quote je Art (vorrat_max_je_art: ein Eintrag verdraengt den aeltesten SEINER Art, vorrat_max bleibt die Summe) und eine zweite Zeitbasis: Arten in vorrat_alter_max_s_je_art altern in Spielzeit (game.time, Sekunden; erstellt und ablauf
// des Eintrags sind dann Sekunden), alle anderen in Ticks der Weltsim. ausVorratFuerNotruf nimmt einen Plan fuer ein Notruf-Angebot heraus (der Ort ist der des Notrufs, nicht der gespeicherte).
// Der Weltstand-Block steht in welt.sim.faeden.abenteuer (abenteuer-brett.js toSave/lesen), weil die Fadenmaschine (faden.js) unveraendert bleibt; faden.js ruft nur toSave/lesen des Bretts.
const AP = () => require('./absicht-pruefer.js');
const INS = () => require('./inszenierer.js');
const Brett = () => require('./abenteuer-brett.js');
const Faden = () => require('./faden.js');
const Absicht = () => require('./abenteuer-absicht.js');
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
// FRE-03 E: die Uhr einer Art: Spielzeit-Arten (vorrat_alter_max_s_je_art) zaehlen game.time in ganzen Sekunden, alle anderen die Ticks der Weltsim
const tabelle = (katalog, k) => (has(katalog.werte, k) && istObjekt(katalog.werte[k]) && istObjekt(katalog.werte[k].wert) ? katalog.werte[k].wert : {});   // fehlt der Wert (Altdaten), gilt er als leer
const zeitArt = (katalog, art) => has(tabelle(katalog, 'vorrat_alter_max_s_je_art'), art);
const jetztFuer = (game, katalog, art) => (zeitArt(katalog, art) ? (game && Number.isFinite(game.time) && game.time >= 0 ? Math.floor(game.time) : 0) : jetzt(game));
const alterMaxFuer = (katalog, art) => (zeitArt(katalog, art) ? tabelle(katalog, 'vorrat_alter_max_s_je_art')[art] : wert(katalog, 'vorrat_alter_max'));
const quoteFuer = (katalog, art) => { const q = tabelle(katalog, 'vorrat_max_je_art'); return has(q, art) ? q[art] : wert(katalog, 'vorrat_max'); };
// die Eintraege, die Quote je Art und Summe zusammen zulassen: je Art bleiben die neuesten, danach insgesamt die neuesten vorrat_max (Reihenfolge bleibt)
function begrenzt(liste, katalog) {
  const zaehl = new Map(), behalten = new Set();
  for (let i = liste.length - 1; i >= 0; i--) { const a = liste[i].art, k = (zaehl.get(a) || 0) + 1; zaehl.set(a, k); if (k <= quoteFuer(katalog, a)) behalten.add(i); }
  return liste.filter((x, i) => behalten.has(i)).slice(-wert(katalog, 'vorrat_max'));
}
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
  const e = { absicht, hex: r.hex, art: o.art, erstellt: jetztFuer(game, katalog, o.art) };
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
// FRE-02 A2: das Nein ist nur, dass gerade jedes Ziel im Umkreis vergeben ist (ORT_KEIN_ZIEL mit FELD_ZIELE_VERGEBEN): der Eintrag bleibt im Vorrat und kommt wieder dran, sobald ein Ziel frei ist
const zeitweilig = (fehler) => fehler.length > 0 && fehler.every((x) => x.code === INS().CODES.ORT_KEIN_ZIEL && x.feld === INS().FELD_ZIELE_VERGEBEN);
function gueltig(game, e) {
  const katalog = AP().katalogStandard();
  const fo = formFehler(e, katalog);
  if (fo) return nein(CODES.VORRAT_FORM, fo);
  if (!zustand(game)) return nein(CODES.INAKTIV, 'die Faeden sind nicht eingeschaltet');
  const t = jetztFuer(game, katalog, e.art);
  if ((e.ablauf !== undefined && t > e.ablauf) || t - e.erstellt > alterMaxFuer(katalog, e.art)) return nein(CODES.ABGELAUFEN, 'der Eintrag ist zu alt');
  const r = INS().inszeniere(game, e.absicht, katalog);
  if (!r.ok) { const n = abgelehnt(r.fehler); return zeitweilig(r.fehler) ? Object.assign(n, { wartet: true }) : n; }   // FRE-02 A2: alle Ziele vergeben ist kein Mangel des Eintrags (wartet: true)
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
  an.angebot.erstellt = e.erstellt;   // FRE-02 C: das Angebot traegt das Alter des Eintrags weiter (einlegenAus)
  return { ok: true, angebot: an.angebot, inszenierung: an.inszenierung };
}

// ---------- Vorrat im Zustand (F.vorrat)
function hinzufuegen(game, e) {
  const F = zustand(game);
  if (!F) return nein(CODES.INAKTIV, 'die Faeden sind nicht eingeschaltet');
  const g = gueltig(game, e);
  if (!g.ok && !g.wartet) return g;   // wartet: alle Ziele vergeben, der Eintrag selbst ist in Ordnung
  if (!Array.isArray(F.vorrat)) F.vorrat = [];
  const schluessel = (x) => x.art + '|' + JSON.stringify(x.absicht);
  if (!F.vorrat.some((x) => schluessel(x) === schluessel(e))) F.vorrat.push(klon(e));
  const katalog = AP().katalogStandard();
  const dieseArt = () => F.vorrat.filter((x) => x.art === e.art);
  while (dieseArt().length > quoteFuer(katalog, e.art)) F.vorrat.splice(F.vorrat.indexOf(dieseArt()[0]), 1);   // FRE-03 E: ueber der Quote der EIGENEN Art weicht der aelteste dieser Art
  while (F.vorrat.length > wert(katalog, 'vorrat_max')) F.vorrat.shift();   // und insgesamt der aelteste
  return { ok: true, vorrat: F.vorrat.length };
}
const liste = (game) => { const F = zustand(game); return F && Array.isArray(F.vorrat) ? klon(F.vorrat) : []; };
function verwirfUngueltige(game) {
  const F = zustand(game), out = [];
  if (!F || !Array.isArray(F.vorrat)) return out;
  for (const e of F.vorrat.slice()) { const g = gueltig(game, e); if (!g.ok && !g.wartet) { entnehmen(game, e); out.push({ art: typeof e.art === 'string' ? e.art : '?', grund: g.grund }); } }
  return out;
}
function ausVorrat(game, art) {
  const F = zustand(game);
  if (!F || !Array.isArray(F.vorrat)) return nein(CODES.VORRAT_LEER, 'der Vorrat ist leer');
  let wartet = null;
  for (const e of F.vorrat.slice()) {
    if (e.art !== art) continue;
    const g = gueltig(game, e);
    if (g.wartet) { wartet = wartet || g; continue; }   // FRE-02 A2: kein freies Ziel: der Eintrag bleibt, der naechste wird probiert
    if (!g.ok) { entnehmen(game, e); continue; }   // ein veralteter Eintrag wird verworfen, der naechste probiert
    return anbieten(game, e);   // nimmt das Brett es gerade nicht (voll, Wiederholung), bleibt der Eintrag im Vorrat
  }
  if (wartet) return wartet;   // ehrliches Nein (ORT_KEIN_ZIEL): es gibt Eintraege, nur gerade kein freies Ziel
  return nein(CODES.VORRAT_LEER, 'kein gueltiger Eintrag dieser Art');
}
// FRE-02 C: ein Angebot, das nicht gespielt wurde (Verfall, Ablehnen), geht mit seinem ersten Alter zurueck in den Vorrat. Der Eintrag wird wie sonst aus der Absicht gebaut (Ort und Plan JETZT, gueltig oder nichts),
// nur erstellt bleibt das des Angebots (nie spaeter als jetzt): so verfaellt es nach vorrat_alter_max Ticks seit dem ersten Erzeugen, egal wie oft es kreiste. Die Schnittstelle von eintrag/hinzufuegen bleibt.
function einlegenAus(game, angebot, art) {
  if (!Absicht().aktiv(game)) return nein(CODES.INAKTIV, 'der Modus Absichten ist aus');
  if (!istObjekt(angebot) || !istObjekt(angebot.absicht)) return nein(CODES.VORRAT_FORM, 'das Angebot traegt keine Absicht');
  const r = eintrag(game, { absicht: angebot.absicht, art });
  if (!r.ok) return r;
  const e = r.eintrag;
  if (Number.isInteger(angebot.erstellt) && angebot.erstellt >= 0) e.erstellt = Math.min(angebot.erstellt, e.erstellt);
  return hinzufuegen(game, e);
}
// FRE-02 C: Entnahme fuer das Brett: wie ausVorrat, aber ein Eintrag, dessen Plan JETZT gegen eine Sperre des Bretts laeuft (zum Beispiel gerade abgelehnt), bleibt liegen. Der Inszenierer ist deterministisch
// und kennt die Sperre nicht: ohne diese Pruefung bekaeme die Crew das abgelehnte Angebot sofort wieder.
function ausVorratOhneSperre(game, art) {
  const F = zustand(game);
  if (!F || !Array.isArray(F.vorrat)) return nein(CODES.VORRAT_LEER, 'der Vorrat ist leer');
  const katalog = AP().katalogStandard();
  let wartet = null;
  for (const e of F.vorrat.slice()) {
    if (e.art !== art) continue;
    const g = gueltig(game, e);
    if (g.wartet) { wartet = wartet || g; continue; }
    if (!g.ok) { entnehmen(game, e); continue; }
    const r = INS().inszeniere(game, e.absicht, katalog);
    if (!r.ok || !Brett().passtZuLage(game, r.plan, r.hex)) continue;   // gesperrt: bleibt im Vorrat (Alter und Gueltigkeit verwerfen ihn spaeter)
    const an = anbieten(game, e);
    if (an.ok) return an;   // sonst nimmt das Brett ihn gerade nicht (zum Beispiel doppelt am Ort): der naechste
  }
  if (wartet) return wartet;
  return nein(CODES.VORRAT_LEER, 'kein freigegebener Eintrag dieser Art');
}

// FRE-03 E: ein Plan fuer ein Notruf-Angebot. Ein Takt-Notruf entsteht an SEINEM Ort (hex): der Eintrag muss gueltig sein (Alter in der Uhr der Art, Welt, Absicht; gueltig inszeniert neu) und sein frisch gebauter Plan zur Lage
// an hex passen (Brett().passtZuLage: Volk, Besitzer, Fraktion). anbieter(plan, absicht, erstellt) legt das Angebot an und liefert { ok }; erst dann verlaesst der Eintrag den Vorrat (sonst bleibt er liegen). Ein Aufruf des
// Komponisten ist das nicht. -> { ok: true, ergebnis } | { ok: false, grund, text }
function ausVorratFuerNotruf(game, art, hex, anbieter) {
  if (!Absicht().aktiv(game)) return nein(CODES.INAKTIV, 'der Modus Absichten ist aus');
  const F = zustand(game);
  if (!F || !Array.isArray(F.vorrat)) return nein(CODES.VORRAT_LEER, 'der Vorrat ist leer');
  if (typeof anbieter !== 'function') return nein(CODES.VORRAT_FORM, 'ausVorratFuerNotruf braucht einen Anbieter');
  const katalog = AP().katalogStandard();
  for (const e of F.vorrat.slice()) {
    if (e.art !== art) continue;
    const g = gueltig(game, e);
    if (g.wartet) continue;
    if (!g.ok) { if (g.grund !== INS().CODES.WELT_BEDINGUNG) entnehmen(game, e); continue; }   // Wiederholungsregel oder Lage ist kein Mangel des Eintrags (die Typenfolge notruf sperrt sich nach jedem Notruf): er bleibt, das Alter verwirft ihn spaeter
    const r = INS().inszeniere(game, e.absicht, katalog);
    if (!r.ok || !istObjekt(r.plan) || !Brett().passtZuLage(game, r.plan, hex)) continue;   // passt nicht zu diesem Ort: bleibt fuer einen anderen Notruf
    const res = anbieter(klon(r.plan), klon(e.absicht), e.erstellt);
    if (res && res.ok) { entnehmen(game, e); return { ok: true, ergebnis: res }; }
  }
  return nein(CODES.VORRAT_LEER, 'kein passender Eintrag dieser Art');
}

// ---------- Weltstand
function toSave(F) {
  if (!F || !Array.isArray(F.vorrat) || !F.vorrat.length) return null;
  return begrenzt(F.vorrat, AP().katalogStandard()).map((e) => klon(e));
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
  if (out.length) F.vorrat = begrenzt(out, katalog);   // FRE-03 E: Quote je Art auch beim Laden (Altstand ohne Quoten: unveraendert, die Quoten greifen nur fuer Arten mit Eintrag)
}

function werteFehler(katalog) {
  katalog = katalog || AP().katalogStandard();
  const o = [], f = (t) => o.push(`VORRAT_WERTE: ${t}`);
  for (const [k, min] of [['vorrat_max', 1], ['vorrat_alter_max', 1], ['vorrat_name_max', 3], ['vorrat_text_max', 1]]) if (!(has(katalog.werte, k) && istObjekt(katalog.werte[k]) && Number.isInteger(katalog.werte[k].wert) && katalog.werte[k].wert >= min)) f(`${k}: ganze Zahl >= ${min}`);
  const jeArt = (k, was, pruef) => {   // FRE-03 E: Tabellen je Art
    if (!has(katalog.werte, k)) return null;   // optional: Altdaten ohne den Wert gelten wie vorher
    const t = istObjekt(katalog.werte[k]) ? katalog.werte[k].wert : null;
    if (!istObjekt(t)) { f(`${k}: Tabelle Art -> ${was}`); return null; }
    let muster = null; try { muster = new RegExp(wert(katalog, 'name_muster')); } catch (x) { muster = null; }
    for (const [a, v] of Object.entries(t)) { if (!muster || !muster.test(a)) f(`${k}.${a}: Name nach name_muster`); if (!pruef(v)) f(`${k}.${a}: ${was}`); }
    return t;
  };
  const ganzMin1 = (v) => Number.isInteger(v) && v >= 1;
  const quoten = jeArt('vorrat_max_je_art', 'ganze Zahl >= 1', ganzMin1);
  if (quoten && istObjekt(katalog.werte.vorrat_max) && Number.isInteger(katalog.werte.vorrat_max.wert) && katalog.werte.vorrat_max.wert >= 1 && Object.values(quoten).filter(ganzMin1).reduce((a, b) => a + b, 0) > katalog.werte.vorrat_max.wert) f('vorrat_max_je_art: die Summe der Quoten liegt ueber vorrat_max');
  jeArt('vorrat_alter_max_s_je_art', 'ganze Zahl >= 1 (Sekunden)', ganzMin1);
  return o;
}

module.exports = { CODES, eintrag, gueltig, anbieten, hinzufuegen, verwirfUngueltige, ausVorrat, einlegenAus, ausVorratOhneSperre, ausVorratFuerNotruf, liste, toSave, lesen, werteFehler };
