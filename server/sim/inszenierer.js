'use strict';
// SPL-02 B: der Inszenierer. Eine Absicht sagt, WAS geschehen soll (absicht-pruefer.js, Format absicht/1); der Inszenierer macht daraus, WIE: Ort, Beat-Folge mit der Wendung des Bogens, Titel und Anlass. Er ist ein
// Action-Layer wie faden-bauplan.js: reine Regeln auf Absicht, Katalog und Weltstand, jede Regel ein benannter Code, alle Zahlen als Daten (content/faeden/inszenierer-werte.json), jedes Rezept als Daten
// (content/faeden/absichten.json, Feld `inszenierung` je Eintrag). Dieses Modul kennt KEINEN Absichtsnamen und KEINEN Beat-Typ: eine neue Absicht ist ein Eintrag im Katalog, kein Code. Was der Beat-Katalog nicht
// ausdruecken kann, steht im Rezept als `nicht_ausdrueckbar` und ist ein ehrliches Nein mit Grund, nie ein Sonderfall im Code. Kein Modellaufruf, kein Zufall (gleiche Eingabe, gleicher Plan), kein Zustand.
// Die Fadenmaschine (faden.js, faden-pruefer.js, faden-bauplan.js) bleibt unveraendert: der Plan geht durch ihren Expander und Pruefer, die Vorab-Pruefungen sind ihre eigenen Funktionen.
//
//   inszeniere(game, absicht, katalog?) -> { ok: true, plan, hex, bezug?: { nsc }, locker?: true, titel, anlass, notizen: [Text] }
//                                        | { ok: false, fehler: [{ code, feld, grund, gegenvorschlag?: { patch, text } }] }      (Format wie absicht-pruefer.js: fehlerText, wendePatchAn, gegenvorschlagPatch gelten auch hier)
//        plan = faden-bauplan/1, vom Expander (faden-bauplan.pruefe) und Pruefer geprueft; hex = Ort des Angebots; bezug/locker = Argumente fuer Brett.neuAnbieten (locker aus `fortsetzung` der Absicht)
//        Ablauf: pruefeAbsicht (Paket A) -> Rezept -> nicht_ausdrueckbar -> Weltbedingungen -> Staerke und Stufe -> Ort -> Skelett mit Wendung -> Expander und Pruefer -> Vorab-Pruefung der Welt
//        (Lage, Landeplaetze, Bezug, Wiederholung: dieselben Regeln wie das Brett, damit das Nein hier fallt und mit Gegenvorschlag, nicht erst beim Anbieten)
//   anbietenAusAbsicht(game, absicht, katalog?) -> { ok: true, angebot, inszenierung } | { ok: false, fehler }      inszeniere + Brett.neuAnbieten (hex, bezug, locker); ein Nein des Bretts kommt als ANGEBOT_ABGELEHNT
//   weltStufe(game) -> Zahl                      die Stufe der Welt (Rang und Schiff der Crew, Tabellen in den Daten), 0 bis stufe_max
//   katalogFehler(katalog?) -> [Text]            die Rezepte sind in sich stimmig: Struktur, Bezuege, und jede Kombination aus Stufe und Wendung ergibt einen Plan, den der Expander annimmt
//   werteFehler() -> [Text]                      die Daten inszenierer-werte.json sind stimmig
//   CODES                                         die Codes aus absicht-pruefer.js plus: ORT_KEIN_ZIEL · ORT_LANDEPLATZ · WELT_BEDINGUNG · STAERKE_UNMOEGLICH · NICHT_AUSDRUECKBAR · WENDUNG_UNMOEGLICH ·
//                                                BEZUG_ZU_FRISCH · PLAN_ABGELEHNT · REZEPT_FEHLT · ANGEBOT_ABGELEHNT
//
// Rezept (`inszenierung` im Katalogeintrag; Schema in absichten.json `_absicht.inszenierung`):
//   ort           Ortsregel: crew_hex (der Sektor der Crew) · naechster_mit_kartenart (der naechste Sektor mit landbarer Kartenart, ab reichweite_parameter der Absicht, sonst reichweite_standard) ·
//                 bezug_ort (der Sektor des Bezugs ort). Die Kartenart der Regel ersetzt `$ort_kartenart` in den Landeplaetzen des Skeletts.
//   bedingungen   Weltbedingungen: nsc_haltung (der Bezug nsc hat Haltung hoechstens/mindestens x) · rang_mindestens (Rang der Crew bei Rom) · ladung_mindestens (BEA-01 C2: mindestens `plaetze` Plaetze Ladung im Frachtraum der Lerche, gelesen aus dem Frachtraum). Lage, Landeplaetze und Wiederholung prueft der Plan selbst (Vorab-Pruefung).
//   nicht_ausdrueckbar   was der Beat-Katalog (noch) nicht kann: wenn (parameter | bogen | ton == Wert, oder immer) -> Nein NICHT_AUSDRUECKBAR mit dem Grund; optional ein Gegenvorschlag { feld, wert, text }
//   staerke_parameter, stufe_max   Staerke: Name des Absichts-Parameters (Zahl, mit Standard), mit dem die Absicht eine Stufe wuenscht; der Standard heisst: kein Wunsch, es gilt die Stufe der Welt.
//                 Ein Wunsch darf hoechstens Stufe der Welt plus staerke_spielraum sein, hoechstens stufe_max, sonst STAERKE_UNMOEGLICH mit der hoechsten erlaubten Stufe als Gegenvorschlag
//   skelett       Plan-Kopf (landeplaetze, volk_erlaubt, namenlos, wahrheit) und beats; ein Beat nennt typ, id, parameter, optionen, verzweigung, erfolg und ab_stufe/bis_stufe (nur in diesen Stufen);
//                 ein Parameterwert ist ein Wert, { aus: 'parameter.<name>' } (aus der Absicht) oder { nach_stufe: [Wert je Stufe] } (die letzte Zahl gilt fuer hoehere Stufen)
//   wendungen     je Symbol des Bogens: { nach: Id oder Typ eines Skelett-Beats, beats: [...] }: die Beats kommen hinter diesen Beat; das Symbol `keine` gibt es immer und baut nichts ein
const fs = require('fs');
const path = require('path');
const D = require('./faden-daten.js');
const P = require('./faden-pruefer.js');
const AP = require('./absicht-pruefer.js');

const Faden = () => require('./faden.js');
const Brett = () => require('./abenteuer-brett.js');
const Bauplan = () => require('./faden-bauplan.js');
const Orte = () => require('./abenteuer-orte.js');
const Ruf = () => require('./ruf.js');
const B1 = () => require('./faden-b1.js');
const Wdh = () => require('./abenteuer-wiederholung.js');
const Sektoren = () => require('../../shared/sektoren.js');
const Lager = () => require('./fracht.js');   // BEA-01 C2: Frachtraum der Lerche (Bedingung ladung_mindestens), nur lesend

const DATEI_WERTE = path.join(D.DIR, 'inszenierer-werte.json');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const klon = (x) => JSON.parse(JSON.stringify(x));

const CODES = Object.freeze(Object.assign({}, AP.CODES, {
  ORT_KEIN_ZIEL: 'ORT_KEIN_ZIEL', ORT_LANDEPLATZ: 'ORT_LANDEPLATZ', WELT_BEDINGUNG: 'WELT_BEDINGUNG', STAERKE_UNMOEGLICH: 'STAERKE_UNMOEGLICH', NICHT_AUSDRUECKBAR: 'NICHT_AUSDRUECKBAR',
  WENDUNG_UNMOEGLICH: 'WENDUNG_UNMOEGLICH', BEZUG_ZU_FRISCH: 'BEZUG_ZU_FRISCH', PLAN_ABGELEHNT: 'PLAN_ABGELEHNT', REZEPT_FEHLT: 'REZEPT_FEHLT', ANGEBOT_ABGELEHNT: 'ANGEBOT_ABGELEHNT',
}));
// Das Vokabular des Inszenierers (Arten von Regeln, nicht Namen von Absichten oder Beats)
const ORT = Object.freeze({ CREW_HEX: 'crew_hex', NAECHSTER_MIT_KARTENART: 'naechster_mit_kartenart', BEZUG_ORT: 'bezug_ort' });
const BEDINGUNG = Object.freeze({ NSC_HALTUNG: 'nsc_haltung', RANG_MINDESTENS: 'rang_mindestens', LADUNG_MINDESTENS: 'ladung_mindestens' });   // BEA-01 C2: ladung_mindestens
const WENN = Object.freeze({ PARAMETER: 'parameter', BOGEN: 'bogen', TON: 'ton', IMMER: 'immer' });
const KEINE_WENDUNG = 'keine';
const ORT_KARTENART = '$ort_kartenart';
const AUS_PARAMETER = /^parameter\.([a-z][a-z0-9_]*)$/;
const KOPF = ['landeplaetze', 'volk_erlaubt', 'namenlos', 'wahrheit'];
const BEAT_FELDER = ['typ', 'id', 'parameter', 'optionen', 'verzweigung', 'erfolg'];
const BEAT_EXTRA = ['ab_stufe', 'bis_stufe'];
const REZEPT_FELDER = ['ort', 'bedingungen', 'nicht_ausdrueckbar', 'staerke_parameter', 'stufe_max', 'skelett', 'wendungen', 'anlass_vorlage'];

// ---------- Daten
let werteCache = null;
function werte() {
  if (!werteCache) {
    const roh = JSON.parse(fs.readFileSync(DATEI_WERTE, 'utf8'));
    werteCache = Object.fromEntries(Object.entries(roh.werte).map(([k, v]) => [k, v.wert]));
  }
  return werteCache;
}
const werteNeuLesen = () => { werteCache = null; return werte(); };

// ---------- Hilfen
const fehl = (code, feld, grund, gegenvorschlag) => (gegenvorschlag ? { code, feld, grund, gegenvorschlag } : { code, feld, grund });
const vorschlag = (text, ...patch) => ({ patch, text });
const setze = (feld, wert) => ({ feld, wert });
const nein = (...fehler) => ({ ok: false, fehler });
const kurz = (t) => { const s = String(t), n = werte().text_ausschnitt_max; return s.length > n ? s.slice(0, n) : s; };   // Fremdtext (Name, Wert) in einer Meldung

// ---------- Weltlage (nur lesend)
function crewHex(game) {
  const szene = game && game.ship && game.ship.scene;
  const hex = szene ? Sektoren().hexVonOrt(szene) : null;
  return hex && P.sundSpielbar(hex) ? hex : null;
}
function weltStufe(game) {
  const W = werte();
  const rang = (() => { try { return Ruf().rang(game); } catch (e) { return null; } })();
  const grund = typeof rang === 'string' && has(W.stufe_nach_rang, rang) ? W.stufe_nach_rang[rang] : 0;
  const schiff = String(game && game.ship ? game.ship.stufe | 0 : 0);
  const zuschlag = has(W.stufe_zuschlag_schiff, schiff) ? W.stufe_zuschlag_schiff[schiff] : 0;
  return Math.max(0, Math.min(W.stufe_max, grund + zuschlag));
}
const nscMitName = (game, name) => {   // der juengste Faden dieses NSC (wie faden-pruefer.wiedersehenNsc: der juengste gilt)
  const F = Faden().aktiv(game) ? Faden().zustandVon(game) : null;
  let best = null;
  for (const f of F ? F.liste : []) if (f.nsc && f.nsc.name === name && (!best || Faden().idNr(f.id) >= Faden().idNr(best.id))) best = f;
  return best ? best.nsc : null;
};

// ---------- Rezept lesen
const rezeptVon = (katalog, name) => (has(katalog.absichten, name) && istObjekt(katalog.absichten[name].inszenierung) ? katalog.absichten[name].inszenierung : null);

// ---------- nicht ausdrueckbar: der Beat-Katalog kann es nicht, also ein ehrliches Nein
function trifft(w, a) {
  if (!istObjekt(w)) return false;
  if (w.immer === true) return true;
  if (has(w, WENN.PARAMETER)) return has(a.parameter, w.parameter) && a.parameter[w.parameter] === w.ist;
  if (has(w, WENN.BOGEN)) return istObjekt(a.bogen) && a.bogen[w.bogen] === w.ist;
  if (has(w, WENN.TON)) return a.ton === w.ton;
  return false;
}
function nichtAusdrueckbar(rez, a) {
  const out = [];
  for (const n of Array.isArray(rez.nicht_ausdrueckbar) ? rez.nicht_ausdrueckbar : []) {
    if (!trifft(n.wenn, a)) continue;
    const feld = n.wenn.immer === true ? 'absicht' : has(n.wenn, WENN.PARAMETER) ? `parameter.${n.wenn.parameter}` : has(n.wenn, WENN.BOGEN) ? `bogen.${n.wenn.bogen}` : 'ton';
    const g = n.gegenvorschlag;
    out.push(fehl(CODES.NICHT_AUSDRUECKBAR, feld, `der Beat-Katalog kann das nicht ausdruecken: ${n.grund}`, g ? vorschlag(g.text, setze(g.feld, g.wert)) : undefined));
  }
  return out;
}

// ---------- Weltbedingungen
const haltungOk = (b, n) => !(has(b, 'hoechstens') && !(n.haltung <= b.hoechstens)) && !(has(b, 'mindestens') && !(n.haltung >= b.mindestens));
// SPL-02 G: Kandidaten fuer den NSC-Bezug dieser Absicht (frische zuerst), die die Haltungsbedingungen des Rezepts auf den Bezug nsc erfuellen (Namen); der Gegenvorschlag eines Neins und der Folgeprompt der Verhandlung nehmen sie
function bezugPassend(game, absicht, katalog) {
  katalog = katalog || AP.katalogStandard();
  const rez = istObjekt(absicht) && typeof absicht.absicht === 'string' ? rezeptVon(katalog, absicht.absicht) : null;
  const bed = rez && Array.isArray(rez.bedingungen) ? rez.bedingungen.filter((b) => b.art === BEDINGUNG.NSC_HALTUNG && b.bezug === 'nsc') : [];
  return AP.bezugKandidaten(game, absicht, katalog).filter((name) => { const n = nscMitName(game, name); return !!n && bed.every((b) => haltungOk(b, n)); });
}
function bedingungsFehler(game, rez, a, katalog) {
  const out = [];
  for (const b of Array.isArray(rez.bedingungen) ? rez.bedingungen : []) {
    if (b.art === BEDINGUNG.NSC_HALTUNG) {
      const name = a.bezug[b.bezug];
      const n = typeof name === 'string' ? nscMitName(game, name) : null;
      let gv;   // Gegenvorschlag: der passende Kandidat (nur beim Bezug nsc), sonst keiner (kein kaputter Plan)
      const vorschlagBezug = () => {
        if (gv !== undefined) return gv;
        const alt = b.bezug === 'nsc' ? bezugPassend(game, a, katalog).filter((x) => x !== name) : [];
        gv = alt.length ? vorschlag(`Bezug ${alt[0]}`, setze('bezug.nsc', alt[0])) : null;
        return gv || undefined;
      };
      if (!n) { out.push(fehl(CODES.WELT_BEDINGUNG, `bezug.${b.bezug}`, `${kurz(name)}: die Welt kennt den NSC nicht (Haltung nicht pruefbar)`, vorschlagBezug())); continue; }
      if (has(b, 'hoechstens') && !(n.haltung <= b.hoechstens)) out.push(fehl(CODES.WELT_BEDINGUNG, `bezug.${b.bezug}`, `${n.name} hat Haltung ${n.haltung}, gebraucht ist hoechstens ${b.hoechstens}${b.grund ? ': ' + b.grund : ''}`, vorschlagBezug()));
      if (has(b, 'mindestens') && !(n.haltung >= b.mindestens)) out.push(fehl(CODES.WELT_BEDINGUNG, `bezug.${b.bezug}`, `${n.name} hat Haltung ${n.haltung}, gebraucht ist mindestens ${b.mindestens}${b.grund ? ': ' + b.grund : ''}`, vorschlagBezug()));
    } else if (b.art === BEDINGUNG.RANG_MINDESTENS) {
      let da = false;
      try { da = Ruf().rufErreicht(game, b.rang) === true; } catch (e) { da = false; }
      if (!da) out.push(fehl(CODES.WELT_BEDINGUNG, 'absicht', `der Rang der Crew reicht nicht (gebraucht: ${b.rang})${b.grund ? ': ' + b.grund : ''}`));
    } else if (b.art === BEDINGUNG.LADUNG_MINDESTENS) {   // BEA-01 C2: der Frachtraum traegt mindestens `plaetze` Plaetze Ladung (Zahl aus den Daten des Rezepts); ohne Gegenvorschlag: kein Feld der Absicht kann eine Ladung herbeiholen
      let n = 0;
      try { n = Lager().anBord(game); } catch (e) { n = 0; }
      if (!(n >= b.plaetze)) out.push(fehl(CODES.WELT_BEDINGUNG, 'absicht', `der Frachtraum der Lerche ${n ? 'ist zu schwach beladen' : 'ist leer'} (Ladung an Bord: ${n}, gebraucht: mindestens ${b.plaetze})${b.grund ? ': ' + b.grund : ''}`));
    }
  }
  return out;
}

// ---------- Staerke und Stufe
// Die Welt hat eine Stufe (Rang, Schiff). Wuenscht die Absicht ueber den Staerke-Parameter eine andere, gilt sie, soweit die Welt und das Rezept sie tragen; sonst ein Nein mit der hoechsten moeglichen Stufe.
function stufeBestimmen(game, rez, a, eintrag) {
  const W = werte(), welt = weltStufe(game);
  const rezMax = Number.isInteger(rez.stufe_max) ? Math.min(rez.stufe_max, W.stufe_max) : W.stufe_max;
  const name = rez.staerke_parameter;
  const d = typeof name === 'string' ? (eintrag.parameter || {})[name] : null;
  if (d && has(a.parameter, name) && a.parameter[name] !== d.standard) {   // der Standard des Parameters heisst: kein Wunsch, es gilt die Stufe der Welt
    const wunsch = a.parameter[name], erlaubt = Math.min(rezMax, welt + W.staerke_spielraum);
    if (wunsch > erlaubt) {
      const grund = welt + W.staerke_spielraum < rezMax ? `die Welt traegt hoechstens Stufe ${erlaubt} (Rang und Schiff der Crew: Stufe ${welt}, Spielraum ${W.staerke_spielraum})` : `das Rezept dieser Absicht kennt nur Stufen bis ${rezMax}`;   // die engere Grenze nennt der Grund
      return { fehler: fehl(CODES.STAERKE_UNMOEGLICH, `parameter.${name}`, `Staerke ${wunsch} geht nicht: ${grund}`, vorschlag(`${name} = ${erlaubt}`, setze(`parameter.${name}`, erlaubt))) };
    }
    return { stufe: Math.max(0, wunsch), welt, wunsch: true };
  }
  return { stufe: Math.min(welt, rezMax), welt, wunsch: false };
}

// ---------- Ort
function ortBestimmen(game, rez, a, eintrag) {
  const W = werte(), def = rez.ort, feldReichweite = def.reichweite_parameter;
  const hier = crewHex(game);
  if (def.regel === ORT.CREW_HEX) {
    if (!hier) return { fehler: fehl(CODES.ORT_KEIN_ZIEL, 'absicht', 'die Crew steht in keinem Sektor der Karte') };
    return { hex: hier, sprung: 0, kartenart: def.kartenart };
  }
  const er = hier ? B1().erreichbar(game, hier, W.reichweite_max) : new Map();
  if (def.regel === ORT.BEZUG_ORT) {
    const hex = a.bezug.ort;
    if (!er.has(hex)) return { fehler: fehl(CODES.ORT_KEIN_ZIEL, 'bezug.ort', `${kurz(hex)} ist von der Crew aus nicht erreichbar (hoechstens ${W.reichweite_max} Spruenge ueber offene Sprungpunkte)`) };
    return { hex, sprung: er.get(hex), kartenart: def.kartenart };
  }
  // naechster_mit_kartenart
  const max = typeof feldReichweite === 'string' && has(a.parameter, feldReichweite) ? a.parameter[feldReichweite] : W.reichweite_standard;
  const kand = Array.from(er.entries()).filter(([hex]) => Orte().moeglicheArten(hex).includes(def.kartenart)).sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1));
  const im = kand.find(([, s]) => s <= max);
  if (im) return { hex: im[0], sprung: im[1], kartenart: def.kartenart };
  const wo = hier ? Sektoren().hexName(hier) : 'unbekannt';
  const naechster = kand[0];
  if (!naechster) return { fehler: fehl(CODES.ORT_KEIN_ZIEL, typeof feldReichweite === 'string' ? `parameter.${feldReichweite}` : 'absicht', `im Umkreis von ${W.reichweite_max} Spruengen gibt es keinen Sektor mit landbarer Kartenart "${def.kartenart}" (Crew bei ${wo})`) };
  const [hex, s] = naechster, name = Sektoren().hexName(hex);
  const d = typeof feldReichweite === 'string' ? (eintrag.parameter || {})[feldReichweite] : null;
  const gv = d && d.art === 'zahl' && s >= d.min && s <= d.max ? vorschlag(`naechster Sektor mit ${def.kartenart}: ${name} (${hex}), ${s} Spruenge: ${feldReichweite} = ${s}`, setze(`parameter.${feldReichweite}`, s)) : undefined;
  return { fehler: fehl(CODES.ORT_KEIN_ZIEL, typeof feldReichweite === 'string' ? `parameter.${feldReichweite}` : 'absicht', `im Umkreis von ${max} Spruengen gibt es keinen Sektor mit landbarer Kartenart "${def.kartenart}" (Crew bei ${wo}); der naechste ist ${name} (${hex}), ${s} Spruenge entfernt`, gv) };
}

// ---------- Skelett und Wendung -> Plan
function wertAufloesen(w, a, stufe) {
  if (istObjekt(w) && has(w, 'aus')) { const m = AUS_PARAMETER.exec(w.aus); return m ? a.parameter[m[1]] : undefined; }
  if (istObjekt(w) && Array.isArray(w.nach_stufe)) return w.nach_stufe[Math.min(stufe, w.nach_stufe.length - 1)];
  return w;
}
const stufeGilt = (b, stufe) => (!has(b, 'ab_stufe') || stufe >= b.ab_stufe) && (!has(b, 'bis_stufe') || stufe <= b.bis_stufe);
function beatBauen(b, a, stufe) {
  const out = {};
  for (const k of BEAT_FELDER) if (has(b, k) && k !== 'parameter') out[k] = klon(b[k]);
  if (istObjekt(b.parameter)) {
    const p = {};
    for (const [k, w] of Object.entries(b.parameter)) { const v = wertAufloesen(w, a, stufe); if (v !== undefined) p[k] = v; }
    if (Object.keys(p).length) out.parameter = p;
  }
  return out;
}
const beatsBauen = (liste, a, stufe) => (Array.isArray(liste) ? liste : []).filter((b) => stufeGilt(b, stufe)).map((b) => beatBauen(b, a, stufe));
// Das Skelett mit der Wendung zu einem Plan (faden-bauplan/1). -> { plan } | { fehler }
function planBauen(rez, a, stufe, kartenart, anlassStandard) {
  const sk = rez.skelett;
  const beats = beatsBauen(sk.beats, a, stufe);
  const w = a.bogen && typeof a.bogen.wendung === 'string' ? a.bogen.wendung : KEINE_WENDUNG;
  if (w !== KEINE_WENDUNG) {
    const def = istObjekt(rez.wendungen) && has(rez.wendungen, w) ? rez.wendungen[w] : null;
    if (!def) {
      const liste = istObjekt(rez.wendungen) ? Object.keys(rez.wendungen) : [];
      return { fehler: fehl(CODES.WENDUNG_UNMOEGLICH, 'bogen.wendung', `die Wendung "${kurz(w)}" kann der Inszenierer bei dieser Absicht nicht bauen${liste.length ? ' (moeglich: ' + liste.join(', ') + ')' : ''}`, liste.length ? vorschlag(`Wendung ${liste[0]}`, setze('bogen.wendung', liste[0])) : undefined) };
    }
    const i = beats.findIndex((b) => b.id === def.nach || b.typ === def.nach);   // Id oder Typ des Skelett-Beats (der erste Treffer)
    if (i < 0) return { fehler: fehl(CODES.WENDUNG_UNMOEGLICH, 'bogen.wendung', `die Wendung "${w}" haengt an einem Beat ("${kurz(def.nach)}"), der in dieser Stufe nicht im Plan steht`) };
    beats.splice(i + 1, 0, ...beatsBauen(def.beats, a, stufe));
  }
  const plan = { format: 'faden-bauplan/1', titel: a.titel.trim(), beats };
  const anlass = a.bogen && typeof a.bogen.einsatz === 'string' && a.bogen.einsatz.trim().length ? a.bogen.einsatz.trim() : anlassStandard;
  if (typeof anlass === 'string') plan.anlass = anlass;
  for (const k of KOPF) if (has(sk, k)) plan[k] = klon(sk[k]);
  if (Array.isArray(plan.landeplaetze)) plan.landeplaetze = plan.landeplaetze.map((l) => (l.art === ORT_KARTENART ? Object.assign({}, l, { art: kartenart }) : l));
  return { plan, wendung: w };
}

// ---------- Vorab-Pruefung der Welt (dieselben Regeln wie das Brett, damit das Nein hier faellt)
function weltFehler(game, v, hex, a, locker) {
  const out = [];
  const lage = P.pruefeLage(game, v);
  if (lage) out.push(fehl(CODES.WELT_BEDINGUNG, 'absicht', lage));
  const lp = P.pruefeLandeplaetze(game, v, hex);
  if (lp) out.push(fehl(CODES.ORT_LANDEPLATZ, 'absicht', `${lp} (Sektor ${hex})`));
  const wd = Wdh().pruefe(game, v, hex);
  if (wd && !(locker && /^WIEDERHOLUNG_NSC/.test(wd))) out.push(fehl(CODES.WELT_BEDINGUNG, 'absicht', wd));
  if (P.nscAlt(v) && typeof a.bezug.nsc === 'string') {
    const name = a.bezug.nsc;
    const id = Faden().wiedersehenKandidaten(game, v).find((x) => { const n = Faden().nscVon(game, x); return n && n.name === name; });
    if (!id) {
      const andere = Wdh().kandidatenGelockert(game, v, locker ? Wdh().STUFEN_MAX : 0).map((x) => Faden().nscVon(game, x)).filter(Boolean).map((n) => n.name);
      out.push(fehl(CODES.BEZUG_UNBEKANNT, 'bezug.nsc', `${kurz(name)} ist fuer diesen Plan kein Kandidat (tot, gefangen, geflohen, verdraengt, oder der Zustand passt nicht zum ersten Beat)`, andere.length ? vorschlag(`Bezug ${andere[0]}`, setze('bezug.nsc', andere[0])) : undefined));
    } else if (!locker && !Wdh().kandidatenFrisch(game, v).includes(id)) {
      const frisch = Wdh().kandidatenFrisch(game, v).map((x) => Faden().nscVon(game, x)).filter(Boolean).map((n) => n.name);
      out.push(fehl(CODES.BEZUG_ZU_FRISCH, 'bezug.nsc', `${kurz(name)} war die Hauptfigur eines der letzten Abenteuer (Wiederholungsregel): erst nach einem anderen Abenteuer, oder die Absicht ist eine Fortsetzung`, frisch.length ? vorschlag(`Bezug ${frisch[0]}`, setze('bezug.nsc', frisch[0])) : undefined));
    }
  }
  return out;
}

// ---------- Inszenieren
function inszeniere(game, absicht, katalog) {
  katalog = katalog || AP.katalogStandard();
  const g = AP.pruefeAbsicht(game, absicht, katalog);
  if (!g.ok) return { ok: false, fehler: g.fehler };
  const a = g.absicht;
  a.bogen = a.bogen || {};
  const rez = rezeptVon(katalog, a.absicht);
  if (!rez) return nein(fehl(CODES.REZEPT_FEHLT, 'absicht', `die Absicht "${kurz(a.absicht)}" hat kein Rezept (inszenierung) im Katalog: der Inszenierer kann sie nicht bauen`));
  const notizen = [];
  const na = nichtAusdrueckbar(rez, a);
  if (na.length) return { ok: false, fehler: na };
  const bd = bedingungsFehler(game, rez, a, katalog);
  if (bd.length) return { ok: false, fehler: bd };
  const st = stufeBestimmen(game, rez, a, katalog.absichten[a.absicht]);
  if (st.fehler) return nein(st.fehler);
  notizen.push(`Stufe ${st.stufe} (Welt ${st.welt}${st.wunsch ? ', gewuenscht ' + st.stufe : ''})`);
  const ort = ortBestimmen(game, rez, a, katalog.absichten[a.absicht]);
  if (ort.fehler) return nein(ort.fehler);
  notizen.push(`Ort ${ort.hex} (${Sektoren().hexName(ort.hex)}), ${ort.sprung} Spruenge${ort.kartenart ? ', Kartenart ' + ort.kartenart : ''}`);
  const bau = planBauen(rez, a, st.stufe, ort.kartenart, rez.anlass_vorlage);
  if (bau.fehler) return nein(bau.fehler);
  if (bau.wendung !== KEINE_WENDUNG) notizen.push(`Wendung ${bau.wendung}`);
  const locker = AP.istFortsetzung(a, katalog);
  if (locker) notizen.push('Fortsetzung: locker (die Hauptfigur des letzten Abenteuers darf wiederkehren)');
  const r = Bauplan().pruefe(bau.plan);
  if (!r.ok) return nein(fehl(CODES.PLAN_ABGELEHNT, 'absicht', `der Expander lehnt den gebauten Plan ab (Rezept oder Katalog der Beats): ${r.fehler.slice(0, werte().plan_fehler_max).join(' | ')}`));
  const wf = weltFehler(game, r.vorlage, ort.hex, a, locker);
  if (wf.length) return { ok: false, fehler: wf };
  const out = { ok: true, plan: bau.plan, hex: ort.hex, titel: bau.plan.titel };
  if (bau.plan.anlass !== undefined) out.anlass = bau.plan.anlass;
  if (typeof a.bezug.nsc === 'string' && P.nscAlt(r.vorlage)) { out.bezug = { nsc: a.bezug.nsc }; notizen.push(`Bezug ${a.bezug.nsc}`); }
  if (locker) out.locker = true;
  out.notizen = notizen.slice(0, werte().notizen_max);
  return out;
}

// ---------- Anbieten: der Inszenierer und das Brett (Angebot mit hex, bezug, locker)
function anbietenAusAbsicht(game, absicht, katalog) {
  const r = inszeniere(game, absicht, katalog);
  if (!r.ok) return r;
  const o = { hex: r.hex };
  if (r.bezug) o.bezug = r.bezug;
  if (r.locker) o.locker = true;
  const res = Brett().neuAnbieten(game, r.plan, o);
  if (!res.ok) return nein(fehl(CODES.ANGEBOT_ABGELEHNT, 'absicht', String(res.grund || (res.fehler && res.fehler[0]) || 'das Brett nimmt das Angebot nicht')));
  return { ok: true, angebot: res.angebot, inszenierung: r };
}

// ---------- Daten stimmig
function werteFehler() {
  const out = [];
  const f = (t) => out.push(`INSZENIERER_WERTE: ${t}`);
  let roh;
  try { roh = JSON.parse(fs.readFileSync(DATEI_WERTE, 'utf8')); } catch (e) { f('Datei nicht lesbar'); return out; }
  if (roh.format !== 'inszenierer-werte/1' || !istObjekt(roh.werte)) { f('format muss "inszenierer-werte/1" sein, werte fehlt'); return out; }
  const W = Object.fromEntries(Object.entries(roh.werte).map(([k, v]) => [k, istObjekt(v) ? v.wert : undefined]));
  for (const [k, v] of Object.entries(roh.werte)) if (!istObjekt(v) || !('wert' in v) || typeof v.einheit !== 'string' || typeof v._hinweis !== 'string') f(`${k}: wert, einheit, _hinweis`);
  const ganz = (n, min) => Number.isInteger(n) && n >= min;
  for (const k of ['reichweite_max', 'reichweite_standard', 'stufe_max', 'staerke_spielraum', 'notizen_max', 'text_ausschnitt_max', 'plan_fehler_max']) if (!ganz(W[k], ['reichweite_standard', 'stufe_max', 'staerke_spielraum'].includes(k) ? 0 : 1)) f(`${k}: ganze Zahl`);
  if (ganz(W.reichweite_max, 1) && ganz(W.reichweite_standard, 0) && W.reichweite_standard > W.reichweite_max) f('reichweite_standard liegt ueber reichweite_max');
  const tabelle = (k, schluessel) => {
    if (!istObjekt(W[k])) { f(`${k}: Tabelle`); return; }
    for (const [s, v] of Object.entries(W[k])) {
      if (!ganz(v, 0) || (ganz(W.stufe_max, 0) && v > W.stufe_max)) f(`${k}.${s}: ganze Zahl von 0 bis stufe_max`);
      if (schluessel && !schluessel(s)) f(`${k}.${s}: unbekannter Schluessel`);
    }
  };
  let raenge = null;
  try { raenge = require('../../content/welt/ruf-werte.json').werte.raenge.wert.map((r) => r.id); } catch (e) { raenge = null; }
  tabelle('stufe_nach_rang', raenge ? (s) => raenge.includes(s) : null);
  tabelle('stufe_zuschlag_schiff', (s) => /^[0-9]$/.test(s));
  return out;
}

// ---------- Katalog stimmig (Rezepte)
const kandidatWert = (d) => (has(d, 'standard') ? d.standard : d.art === 'zahl' ? d.min : d.erlaubt[0]);   // ein gueltiger Wert des Parameters (Standard, sonst der kleinste bzw. erste)
function rezeptFehler(katalog, name, e) {
  const out = [];
  const g = (t) => out.push(`INSZENIERER_REZEPT: ${name}: ${t}`);
  const rez = e.inszenierung;
  for (const k of Object.keys(rez)) if (!REZEPT_FELDER.includes(k)) g(`unbekanntes Feld ${k}`);
  const params = istObjekt(e.parameter) ? e.parameter : {};
  const bezug = Array.isArray(e.bezug) ? e.bezug : [];
  const hatBezug = (n) => bezug.some((b) => b.name === n);
  // Ort
  const o = rez.ort;
  if (!istObjekt(o) || !Object.values(ORT).includes(o.regel)) g(`ort.regel ist eine von ${Object.values(ORT).join(', ')}`);
  else {
    if (o.regel === ORT.NAECHSTER_MIT_KARTENART) {
      if (typeof o.kartenart !== 'string' || !Orte().DATEN.arten.includes(o.kartenart)) g('ort.kartenart ist eine Kartenart der Landeplaetze (abenteuer-orte.json arten)');
      if (o.reichweite_parameter !== undefined && !(has(params, o.reichweite_parameter) && params[o.reichweite_parameter].art === 'zahl')) g('ort.reichweite_parameter nennt keinen Zahl-Parameter der Absicht');
    }
    if (o.regel === ORT.BEZUG_ORT && !bezug.some((b) => b.name === 'ort' && b.pflicht === true)) g('ort.regel bezug_ort braucht den Pflicht-Bezug ort');
    if (o.regel === ORT.CREW_HEX && o.kartenart !== undefined && !Orte().DATEN.arten.includes(o.kartenart)) g('ort.kartenart ist keine Kartenart der Landeplaetze');
  }
  // Bedingungen
  for (const b of Array.isArray(rez.bedingungen) ? rez.bedingungen : rez.bedingungen === undefined ? [] : [null]) {
    if (!istObjekt(b)) { g('bedingungen ist eine Liste von Objekten'); break; }
    if (b.art === BEDINGUNG.NSC_HALTUNG) {
      if (b.bezug !== 'nsc' || !hatBezug('nsc')) g('nsc_haltung braucht den Bezug nsc');
      if (!(Number.isFinite(b.hoechstens) || Number.isFinite(b.mindestens))) g('nsc_haltung braucht hoechstens oder mindestens (Zahl)');
    } else if (b.art === BEDINGUNG.RANG_MINDESTENS) {
      let raenge = [];
      try { raenge = require('../../content/welt/ruf-werte.json').werte.raenge.wert.map((r) => r.id); } catch (err) { raenge = []; }
      if (!raenge.includes(b.rang)) g('rang_mindestens nennt einen unbekannten Rang');
    } else if (b.art === BEDINGUNG.LADUNG_MINDESTENS) {   // BEA-01 C2
      if (!(Number.isInteger(b.plaetze) && b.plaetze >= 1)) g('ladung_mindestens braucht plaetze (ganze Zahl >= 1)');
    } else g(`bedingung ${kurz(b.art)}: unbekannte Art (${Object.values(BEDINGUNG).join(', ')})`);
  }
  // nicht ausdrueckbar
  for (const n of Array.isArray(rez.nicht_ausdrueckbar) ? rez.nicht_ausdrueckbar : rez.nicht_ausdrueckbar === undefined ? [] : [null]) {
    if (!istObjekt(n) || typeof n.grund !== 'string' || !n.grund.trim() || !istObjekt(n.wenn)) { g('nicht_ausdrueckbar: { wenn, grund, gegenvorschlag? }'); continue; }
    const w = n.wenn;
    if (w.immer === true) { /* immer */ }
    else if (typeof w[WENN.PARAMETER] === 'string') { if (!has(params, w.parameter)) g(`nicht_ausdrueckbar: der Parameter ${w.parameter} gibt es bei der Absicht nicht`); else if (!has(w, 'ist')) g('nicht_ausdrueckbar: wenn.ist fehlt'); }
    else if (typeof w[WENN.BOGEN] === 'string') { if (!has(w, 'ist')) g('nicht_ausdrueckbar: wenn.ist fehlt'); }
    else if (typeof w[WENN.TON] === 'string') { /* ton == wert */ }
    else g('nicht_ausdrueckbar: wenn ist { parameter | bogen: Name, ist: Wert }, { ton: Wert } oder { immer: true }');
    if (n.gegenvorschlag !== undefined && !(istObjekt(n.gegenvorschlag) && typeof n.gegenvorschlag.feld === 'string' && typeof n.gegenvorschlag.text === 'string' && ['string', 'number'].includes(typeof n.gegenvorschlag.wert))) g('nicht_ausdrueckbar: gegenvorschlag { feld, wert, text }');
  }
  // Staerke
  if (rez.staerke_parameter !== undefined && !(has(params, rez.staerke_parameter) && params[rez.staerke_parameter].art === 'zahl' && has(params[rez.staerke_parameter], 'standard'))) g('staerke_parameter nennt keinen Zahl-Parameter mit Standard der Absicht (der Standard heisst: kein Wunsch)');
  if (rez.stufe_max !== undefined && !(Number.isInteger(rez.stufe_max) && rez.stufe_max >= 0)) g('stufe_max ist eine ganze Zahl >= 0');
  if (rez.anlass_vorlage !== undefined && typeof rez.anlass_vorlage !== 'string') g('anlass_vorlage ist ein Text');
  // Skelett
  const sk = rez.skelett;
  if (!istObjekt(sk) || !Array.isArray(sk.beats) || !sk.beats.length) { g('skelett.beats fehlt'); return out; }
  for (const k of Object.keys(sk)) if (k !== 'beats' && !KOPF.includes(k)) g(`skelett: unbekanntes Feld ${k}`);
  const pruefeBeat = (b, wo) => {
    if (!istObjekt(b) || typeof b.typ !== 'string') { g(`${wo}: ein Beat braucht typ`); return; }
    for (const k of Object.keys(b)) if (!BEAT_FELDER.includes(k) && !BEAT_EXTRA.includes(k)) g(`${wo}: unbekanntes Feld ${k}`);
    for (const k of BEAT_EXTRA) if (b[k] !== undefined && !(Number.isInteger(b[k]) && b[k] >= 0)) g(`${wo}: ${k} ist eine ganze Zahl >= 0`);
    for (const [k, w] of Object.entries(istObjekt(b.parameter) ? b.parameter : {})) {
      if (istObjekt(w) && has(w, 'aus')) { const m = AUS_PARAMETER.exec(w.aus); if (!m || !has(params, m[1])) g(`${wo}: ${k}.aus nennt keinen Parameter der Absicht`); }
      else if (istObjekt(w) && has(w, 'nach_stufe')) { if (!Array.isArray(w.nach_stufe) || !w.nach_stufe.length) g(`${wo}: ${k}.nach_stufe ist eine nicht leere Liste`); }
      else if (istObjekt(w)) g(`${wo}: ${k}: ein Objekt ist aus oder nach_stufe`);
    }
  };
  sk.beats.forEach((b, i) => pruefeBeat(b, `skelett.beats[${i}]`));
  if (hatBezug('nsc') && bezug.find((b) => b.name === 'nsc').kandidat) {   // true oder ein Beat-Typ (absicht-pruefer.js)
    const erster = istObjekt(sk.beats[0]) ? sk.beats[0].typ : null;
    const kt = bezug.find((b) => b.name === 'nsc').kandidat;
    if (typeof kt === 'string' && erster !== kt) g(`der Bezug nsc (kandidat ${kt}) braucht diesen Typ als ersten Beat im Skelett`);
    else if (!(erster && has(D.BEATS, erster) && D.BEATS[erster].braucht && D.BEATS[erster].braucht.nsc_alt === true)) g('der Bezug nsc (kandidat) braucht einen ersten Beat mit braucht.nsc_alt im Skelett');
  }
  // Wendungen: die Symbole des Katalogs und die Rezepte stimmen ueberein
  const syms = Array.isArray(e.wendungen) ? e.wendungen.filter((s) => s !== KEINE_WENDUNG) : [];
  const defs = istObjekt(rez.wendungen) ? rez.wendungen : {};
  for (const s of syms) if (!has(defs, s)) g(`die Wendung ${s} steht im Katalog (wendungen), aber nicht im Rezept`);
  for (const [s, w] of Object.entries(defs)) {
    if (!new RegExp(katalog.werte.name_muster.wert).test(s) || s === KEINE_WENDUNG) g(`Wendung ${s}: Name ungueltig oder reserviert`);
    if (Array.isArray(e.wendungen) && !e.wendungen.includes(s)) g(`die Wendung ${s} steht im Rezept, aber nicht im Katalog (wendungen)`);
    if (!istObjekt(w) || typeof w.nach !== 'string' || !Array.isArray(w.beats) || !w.beats.length) { g(`Wendung ${s}: { nach, beats }`); continue; }
    if (!sk.beats.some((b) => istObjekt(b) && (b.id === w.nach || b.typ === w.nach))) g(`Wendung ${s}: nach "${w.nach}" ist weder Id noch Typ eines Skelett-Beats`);
    w.beats.forEach((b, i) => pruefeBeat(b, `wendungen.${s}.beats[${i}]`));
  }
  if (out.length) return out;
  // jede Kombination aus Stufe und Wendung ergibt einen Plan, den der Expander annimmt (mit Standardwerten der Parameter)
  const a = { parameter: Object.fromEntries(Object.entries(params).map(([k, d]) => [k, kandidatWert(d)])), bezug: {}, bogen: {}, titel: 'Probe Auftrag' };
  const kartenart = istObjekt(o) && typeof o.kartenart === 'string' ? o.kartenart : Orte().DATEN.arten[0];
  const stufen = Math.min(Number.isInteger(rez.stufe_max) ? rez.stufe_max : werte().stufe_max, werte().stufe_max);
  const wendungen = [KEINE_WENDUNG].concat(Object.keys(defs));
  for (let s = 0; s <= stufen; s++) for (const w of wendungen) {
    a.bogen.wendung = w;
    const bau = planBauen(rez, a, s, kartenart, 'Ein Probeanlass ohne Namen fuer den Test');
    if (bau.fehler) { g(`Stufe ${s}, Wendung ${w}: ${bau.fehler.grund}`); continue; }
    const r = Bauplan().expandiere(bau.plan);
    if (!r.ok) g(`Stufe ${s}, Wendung ${w}: der Expander lehnt den Plan ab: ${r.fehler.slice(0, 2).join(' | ')}`);
  }
  return out;
}
function katalogFehler(katalog) {
  katalog = katalog || AP.katalogStandard();
  const out = [];
  for (const [name, e] of Object.entries(katalog.absichten || {})) {
    if (!istObjekt(e) || e.inszenierung === undefined) { out.push(`INSZENIERER_REZEPT: ${name}: kein Rezept (inszenierung)`); continue; }
    if (!istObjekt(e.inszenierung)) continue;   // das meldet der Katalog-Pruefer
    out.push(...rezeptFehler(katalog, name, e));
  }
  return out;
}

module.exports = { CODES, inszeniere, anbietenAusAbsicht, bezugPassend, weltStufe, katalogFehler, werteFehler, werteNeuLesen };
