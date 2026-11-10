'use strict';
// SPL-02 A: Pruefer der Absichten (Format absicht/1). Eine Absicht sagt, WAS geschehen soll (Name, Parameter, Bezuege, Bogen, Ton); wie, baut der Inszenierer (Paket B). Action-Layer wie faden-bauplan.js:
// reine Regeln auf Absicht, Katalog und Weltstand, jede Regel ein benannter Code, alle Zahlen und Listen als Daten (content/faeden/absichten.json, `werte`). Dieses Modul kennt KEINEN Absichtsnamen:
// was es gibt, steht im Katalog; eine neue Absicht ist ein Eintrag dort, kein Code. Kein Modellaufruf, kein Zustand ausser der Verhandlung, die der Aufrufer haelt (siehe unten).
// Die Fadenmaschine (faden.js, faden-pruefer.js, faden-bauplan.js) bleibt unveraendert; hier werden nur ihre Funktionen benutzt (wiedersehenKandidaten, nscVon, sundSpielbar) und der Kanon gelesen.
//
//   pruefeAbsicht(game, absicht, katalog?) -> { ok, absicht, fehler: [{ code, feld, grund, gegenvorschlag?: { patch: [{ feld, wert } | { feld, entfernen: true }], text } }] }
//        absicht = Tiefenkopie mit ergaenzten Standard-Parametern (null bei FORM); katalog = Standard: content/faeden/absichten.json
//   Codes (CODES): FORM · ABSICHT_UNBEKANNT · PARAMETER (unbekannt, fehlt, ausserhalb; Vorschlag = naechster gueltiger Wert) · BEZUG_FEHLT · BEZUG_UNBEKANNT (gibt es in der Welt nicht, oder kein Kandidat) ·
//        BEZUG_UNEINDEUTIG (Vorname allein, mehrere Treffer) · BEZUG_VERALTET (nur das Brett: der NSC steht beim Annehmen nicht mehr zur Verfuegung, abenteuer-brett.js) · BOGEN_UNVOLLSTAENDIG · TON_UNBEKANNT ·
//        TEXT_UNZULAESSIG (Laenge wie faden-bauplan.js, keine {}, keine Eigennamen ausser dem Bezug, kein Spielername; Eigenname = Wort aus namen.json, gross geschrieben, nicht in `gewoehnliche_woerter`, auch am Satzanfang)
//   Bezug nsc: Vollname eines NSC im Kanon (abenteuer-kanon.js), nie die wechselnde Kennung n<nr>, nie der Vorname allein; mit `kandidat` im Katalog zusaetzlich einer der Kandidaten von faden.wiedersehenKandidaten
//        (kandidat: true = nach dem ersten Beat-Typ mit nsc_alt, kandidat: "<Beat-Typ>" = nach den Zustaenden genau dieses Typs, beats.json braucht.nsc_status).
//   Bezug ort: Hex-Code eines spielbaren Sektors.
//   istFortsetzung(absicht, katalog?) -> bool            die Absicht darf die Hauptfigur des letzten Abenteuers aufnehmen (Katalogfeld fortsetzung): der Aufrufer setzt dann `locker` am Angebot
//   wendePatchAn(absicht, patch) -> { ok, absicht, grund }   ein Patch (Liste { feld: 'parameter.reichweite', wert } | { feld, entfernen: true }) auf eine Kopie der Absicht
//   gegenvorschlagPatch(ergebnis) -> patch | null        alle Gegenvorschlaege eines Ergebnisses zusammen (null, wenn ein Fehler keinen hat)
//   fehlerText(ergebnis, katalog?) -> Text               Klartext fuer das Modell: Grund und Gegenvorschlag je Fehler, hoechstens fehler_text_max Zeichen
//   Verhandlung (eine Runde, runden_max aus den Daten): verhandlungStart(game, absicht, katalog?) -> v; verhandlungAntwort(game, v, antwort, katalog?) -> v'   (nur dieser Pruefer; mit Inszenierer: absicht-verhandlung.js;
//        verhandlungStartMit/-AntwortMit nehmen einen beliebigen Pruefer im Format von pruefeAbsicht)
//        v = { stand: 'offen' | 'angenommen' | 'abgelehnt', runde, runden_max, absicht (letzte geprueft), ergebnis, text }; antwort = Patch (Liste oder { patch }) oder eine korrigierte Absicht.
//        Offen heisst: das Nein ist raus, das Modell darf antworten. Nach runden_max Antworten ohne Erfolg: abgelehnt mit Grund (text), endgueltig. Der Aufrufer ruft das Modell; hier gibt es keinen Aufruf.
//   katalogFehler(katalog?) -> [Text]                    der Katalog ist in sich stimmig (Strukturregeln, Test)
const fs = require('fs');
const path = require('path');
const D = require('./faden-daten.js');
const P = require('./faden-pruefer.js');

const Faden = () => require('./faden.js');
const Kanon = () => require('./abenteuer-kanon.js');
const Ausschnitt = () => require('./lage-ausschnitt.js');
const Sektoren = () => require('../../shared/sektoren.js');

const DATEI = path.join(D.DIR, 'absichten.json');
const KOMMANDANTEN = () => require('../../content/welt/kommandanten.json').kommandanten;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const klon = (x) => JSON.parse(JSON.stringify(x));
const HEX = /^\d{4}$/;
const PROTO = ['__proto__', 'constructor', 'prototype'];
const FELDER = ['format', 'absicht', 'titel', 'parameter', 'bezug', 'bogen', 'ton'];
const FORMAT = 'absicht/1';

const CODES = Object.freeze({
  FORM: 'FORM', ABSICHT_UNBEKANNT: 'ABSICHT_UNBEKANNT', PARAMETER: 'PARAMETER', BEZUG_FEHLT: 'BEZUG_FEHLT', BEZUG_UNBEKANNT: 'BEZUG_UNBEKANNT', BEZUG_UNEINDEUTIG: 'BEZUG_UNEINDEUTIG',
  BEZUG_VERALTET: 'BEZUG_VERALTET', BOGEN_UNVOLLSTAENDIG: 'BOGEN_UNVOLLSTAENDIG', TON_UNBEKANNT: 'TON_UNBEKANNT', TEXT_UNZULAESSIG: 'TEXT_UNZULAESSIG',
});

// ---------- Katalog (Daten)
let katalogCache = null;
function katalogStandard() {
  if (!katalogCache) katalogCache = JSON.parse(fs.readFileSync(DATEI, 'utf8'));
  return katalogCache;
}
const katalogNeuLesen = () => { katalogCache = null; return katalogStandard(); };
const wert = (katalog, k) => katalog.werte[k].wert;
const kurz = (t, n) => { const s = String(t); return s.length > n ? s.slice(0, n) : s; };

// ---------- Hilfen
const fehl = (code, feld, grund, gegenvorschlag) => (gegenvorschlag ? { code, feld, grund, gegenvorschlag } : { code, feld, grund });
const vorschlag = (text, ...patch) => ({ patch, text });
const setze = (feld, w) => ({ feld, wert: w });
const entferne = (feld) => ({ feld, entfernen: true });
function abstand(a, b) {   // Levenshtein, fuer "naechster Name" (kurze Woerter)
  const m = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) for (let j = 1; j <= a.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[j - 1] === b[i - 1] ? 0 : 1));
  return m[b.length][a.length];
}
const naechster = (x, liste) => {
  const s = String(x).toLowerCase();
  let best = null, bd = Infinity;
  for (const k of liste) { const d = abstand(s, String(k).toLowerCase()); if (d < bd) { bd = d; best = k; } }
  return bd <= 3 ? best : null;
};
function protoSchluessel(x, tiefe) {
  if (!x || typeof x !== 'object') return false;
  if (tiefe > 6) return true;
  for (const k of Object.keys(x)) if (PROTO.includes(k) || protoSchluessel(x[k], tiefe + 1)) return true;
  return false;
}
const woerter = (t) => String(t).match(/[\p{L}][\p{L}'-]*/gu) || [];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alsPhrase = (t, p) => new RegExp('(^|[^\\p{L}])' + esc(p) + '(?![\\p{L}])', 'iu').test(t);

// ---------- Form
function formFehler(absicht, katalog) {
  const out = [];
  const f = (feld, grund) => out.push(fehl(CODES.FORM, feld, grund));
  if (!istObjekt(absicht)) { f('absicht', 'die Absicht ist kein Objekt'); return out; }
  let zeichen = Infinity;
  try { zeichen = JSON.stringify(absicht).length; } catch (e) { /* unbrauchbar: gilt als zu gross */ }
  if (!(zeichen <= wert(katalog, 'absicht_max_zeichen'))) { f('absicht', `die Absicht ist groesser als ${wert(katalog, 'absicht_max_zeichen')} Zeichen`); return out; }
  if (protoSchluessel(absicht, 0)) { f('absicht', 'verbotener Schluessel (__proto__, constructor, prototype)'); return out; }
  for (const k of Object.keys(absicht)) if (!FELDER.includes(k)) f(kurz(k, 24), `unbekanntes Feld (erlaubt: ${FELDER.join(', ')})`);
  if (absicht.format !== FORMAT) f('format', `format muss "${FORMAT}" sein`);
  const muster = new RegExp(wert(katalog, 'name_muster'));
  if (typeof absicht.absicht !== 'string' || !muster.test(absicht.absicht)) f('absicht', 'absicht ist der Name der Absicht (Kleinbuchstaben, Ziffern, _)');
  if (typeof absicht.titel !== 'string') f('titel', 'titel ist ein Text');
  if (typeof absicht.ton !== 'string') f('ton', 'ton ist ein Text');
  const mapOk = (feld, art) => {
    if (absicht[feld] === undefined) return;
    if (!istObjekt(absicht[feld])) { f(feld, `${feld} ist ein Objekt`); return; }
    for (const [k, v] of Object.entries(absicht[feld])) if (!art(v)) f(`${feld}.${kurz(k, 24)}`, 'falscher Werttyp');
  };
  mapOk('parameter', (v) => typeof v === 'number' || typeof v === 'string');
  mapOk('bezug', (v) => typeof v === 'string');
  if (absicht.bogen !== undefined) {
    if (!istObjekt(absicht.bogen)) f('bogen', 'bogen ist ein Objekt');
    else for (const [k, v] of Object.entries(absicht.bogen)) {
      if (!wert(katalog, 'bogen_felder').includes(k)) f(`bogen.${kurz(k, 24)}`, `unbekanntes Bogenfeld (erlaubt: ${wert(katalog, 'bogen_felder').join(', ')})`);
      else if (typeof v !== 'string') f(`bogen.${k}`, 'ein Text');
    }
  }
  return out;
}

// ---------- Parameter
function parameterFehler(entry, param) {
  const out = [];
  const defs = istObjekt(entry.parameter) ? entry.parameter : {};
  for (const k of Object.keys(param)) {
    if (!has(defs, k)) out.push(fehl(CODES.PARAMETER, `parameter.${kurz(k, 24)}`, `Parameter "${kurz(k, 24)}" gibt es bei dieser Absicht nicht${Object.keys(defs).length ? ' (bekannt: ' + Object.keys(defs).join(', ') + ')' : ' (sie hat keine Parameter)'}`, vorschlag('Parameter weglassen', entferne(`parameter.${k}`))));
  }
  for (const [k, d] of Object.entries(defs)) {
    const feld = `parameter.${k}`;
    const v = has(param, k) ? param[k] : undefined;
    const ersatz = has(d, 'standard') ? d.standard : (d.art === 'zahl' ? d.min : d.erlaubt[0]);
    if (v === undefined) {
      if (!has(d, 'standard')) out.push(fehl(CODES.PARAMETER, feld, `Parameter "${k}" fehlt`, vorschlag(`${k} = ${ersatz}`, setze(feld, ersatz))));
      continue;
    }
    if (d.art === 'zahl') {
      if (typeof v === 'number' && Number.isInteger(v) && v >= d.min && v <= d.max) continue;
      const nah = typeof v === 'number' && Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, Math.round(v))) : ersatz;
      out.push(fehl(CODES.PARAMETER, feld, `Parameter "${k}" muss eine ganze Zahl von ${d.min} bis ${d.max} sein`, vorschlag(`${k} = ${nah}`, setze(feld, nah))));
    } else if (!d.erlaubt.includes(v)) {
      const nah = (typeof v === 'string' && naechster(v, d.erlaubt)) || ersatz;
      out.push(fehl(CODES.PARAMETER, feld, `Parameter "${k}" muss einer von ${d.erlaubt.join(', ')} sein`, vorschlag(`${k} = ${nah}`, setze(feld, nah))));
    }
  }
  return out;
}

// ---------- Bezuege
const faedenZustand = (game) => { try { return Faden().aktiv(game) ? Faden().zustandVon(game) : null; } catch (e) { return null; } };
const kanonNamen = (game) => {   // Namen im Kanon, ohne Doppelte
  const F = faedenZustand(game);
  const s = [];
  if (F) for (const e of Kanon().liste(F)) { const i = s.indexOf(e.name); if (i >= 0) s.splice(i, 1); s.push(e.name); }
  return s.reverse();   // neueste zuerst
};
// Kandidaten der Fadenmaschine (wie das Brett sie kennt): Namen, juengster zuerst. Eine Probe-Vorlage mit einem Beat-Typ, der nsc_alt braucht, alle Voelker. Welcher Typ, sagt der Katalogeintrag (SPL-02 C0):
// `kandidat: true` = der erste nsc_alt-Typ der Beat-Daten, `kandidat: "<Beat-Typ>"` = genau dieser Typ; die Zustaende des NSC (braucht.nsc_status) und die Erinnerung an eine Tat prueft die Fadenmaschine nach DEM Typ.
// frisch: ohne die Hauptfiguren der letzten Abenteuer (Wiederholungsregel, abenteuer-wiederholung.js); so waehlen die Vorschlaege einen NSC, den das Brett auch nimmt.
const nscAltTyp = (t) => typeof t === 'string' && Object.prototype.hasOwnProperty.call(D.BEATS, t) && !!D.BEATS[t].braucht && D.BEATS[t].braucht.nsc_alt === true;
const kandidatTyp = (kandidat) => (typeof kandidat === 'string' ? (nscAltTyp(kandidat) ? kandidat : null) : Object.keys(D.BEATS).find(nscAltTyp) || null);   // kandidat: true oder Beat-Typ
function kandidatenNamen(game, frisch, kandidat) {
  const typ = kandidatTyp(kandidat === undefined ? true : kandidat);
  if (!typ || !faedenZustand(game)) return [];
  const v = { beats: [{ typ }], volk_erlaubt: D.WERTE.voelker.slice() };
  const out = [];
  const frische = frisch ? require('./abenteuer-wiederholung.js').kandidatenFrisch(game, v) : null;
  for (const id of Faden().wiedersehenKandidaten(game, v)) {
    if (frische && !frische.includes(id)) continue; const n = Faden().nscVon(game, id); if (n) out.push(n.name); }
  return out;
}
const kommandantenNamen = () => [].concat(...Object.values(KOMMANDANTEN())).map((k) => k.name);
const teile = (n) => String(n).trim().split(/\s+/);
function nscFehler(game, name, b, auswahlMax) {
  const feld = 'bezug.nsc';
  const kanon = kanonNamen(game), kand = b.kandidat ? kandidatenNamen(game, false, b.kandidat) : null;
  const mitVorschlag = (liste) => (liste.length ? vorschlag(`Bezug ${liste[0]}`, setze(feld, liste[0])) : undefined);
  const bester = () => { const fr = b.kandidat ? kandidatenNamen(game, true, b.kandidat) : []; return fr.length ? fr : (kand || kanon); };
  if (/^n\d{1,6}$/.test(name)) return fehl(CODES.BEZUG_UNBEKANNT, feld, 'Kennungen (n<Zahl>) wechseln und gelten nicht: nenne den Vollname des NSC', mitVorschlag(bester()));
  if (teile(name).length === 1) {   // Vorname oder Nachname allein: nie eindeutig
    const t = name.toLowerCase();
    const treffer = kanon.filter((n) => teile(n).some((x) => x.toLowerCase() === t));
    const andere = kommandantenNamen().filter((n) => teile(n).some((x) => x.toLowerCase() === t));
    if (!treffer.length && !andere.length) return fehl(CODES.BEZUG_UNBEKANNT, feld, `"${kurz(name, 30)}" kennt die Welt nicht (kein NSC der Crew-Geschichte)`, mitVorschlag(bester()));
    if (!treffer.length) return fehl(CODES.BEZUG_UNBEKANNT, feld, `"${kurz(name, 30)}" ist kein NSC der Crew-Geschichte`, mitVorschlag(bester()));
    const liste = treffer.slice(0, auswahlMax);
    return fehl(CODES.BEZUG_UNEINDEUTIG, feld, `"${kurz(name, 30)}" allein ist ${treffer.length + andere.length > 1 ? 'mehrdeutig' : 'kein Vollname'}: nenne den Vollname (${liste.join(', ')})`, vorschlag(`Bezug ${liste[0]}`, setze(feld, liste[0])));
  }
  if (!kanon.includes(name)) return fehl(CODES.BEZUG_UNBEKANNT, feld, `${kurz(name, 40)} kommt in der Geschichte der Crew nicht vor`, mitVorschlag(bester()));
  if (kand && !kand.includes(name)) return fehl(CODES.BEZUG_UNBEKANNT, feld, `${kurz(name, 40)} steht gerade nicht zur Verfuegung (tot, gefangen, geflohen, verdraengt oder erinnert sich an keine Tat)`, mitVorschlag(bester()));
  return null;
}
function bezugFehler(game, entry, bezug, katalog) {
  const out = [];
  const decl = Array.isArray(entry.bezug) ? entry.bezug : [];
  const auswahlMax = wert(katalog, 'vorschlag_namen_max');
  for (const k of Object.keys(bezug)) if (!decl.some((b) => b.name === k)) out.push(fehl(CODES.BEZUG_UNBEKANNT, `bezug.${kurz(k, 24)}`, `diese Absicht kennt den Bezug "${kurz(k, 24)}" nicht${decl.length ? ' (bekannt: ' + decl.map((b) => b.name).join(', ') + ')' : ''}`, vorschlag('Bezug weglassen', entferne(`bezug.${k}`))));
  for (const b of decl) {
    const feld = `bezug.${b.name}`, v = bezug[b.name];
    if (v === undefined || v === '') {
      if (!b.pflicht) continue;
      let w = [];
      if (b.name === 'nsc') { w = b.kandidat ? kandidatenNamen(game, true, b.kandidat) : []; if (!w.length) w = b.kandidat ? kandidatenNamen(game, false, b.kandidat) : kanonNamen(game); }
      out.push(fehl(CODES.BEZUG_FEHLT, feld, `diese Absicht braucht den Bezug "${b.name}"`, w.length ? vorschlag(`Bezug ${w[0]}`, setze(feld, w[0])) : undefined));
    } else if (b.name === 'nsc') {
      const e = nscFehler(game, v, b, auswahlMax);
      if (e) out.push(e);
    } else if (b.name === 'ort') {
      if (!(HEX.test(v) && P.sundSpielbar(v))) out.push(fehl(CODES.BEZUG_UNBEKANNT, feld, `${kurz(v, 12)} ist kein spielbarer Sektor (Hex-Code aus vier Ziffern)`));
    }
  }
  return out;
}

// ---------- Texte
let namenCache = null;
function namenMengen() {
  if (namenCache) return namenCache;
  const tokens = new Set(), phrasen = new Set();
  for (const L of Object.values(D.NAMEN)) {
    for (const n of L.vornamen.concat(L.nachnamen)) tokens.add(n);
    for (const s of L.schiffe) phrasen.add(s);
  }
  for (const n of kommandantenNamen()) {
    const t = teile(n);
    if (t.length === 1) { if (n.length >= 4) tokens.add(n); } else { phrasen.add(n); const l = t[t.length - 1]; if (l.length >= 4) tokens.add(l); }
  }
  try { for (const h of Object.values(Sektoren().KARTE.hexe)) if (h && typeof h.name === 'string' && h.name.length >= 4 && h.name !== '?') phrasen.add(h.name); } catch (e) { /* ohne Karte: keine Ortsnamen */ }
  namenCache = { tokens, phrasen: Array.from(phrasen) };
  return namenCache;
}
// Gilt dieses Wort als Eigenname (SPL-02 C0)? Ja, wenn es gross geschrieben in den Namenslisten steht (Vorname, Nachname, Kommandant) und weder der Bezug (frei) noch in der Datenliste gewoehnliche_woerter steht (Dorn, Rabe:
// auch ein deutsches Wort). Auch am Satzanfang: dort sagt die Grossschreibung nichts, aber ein Wort ausserhalb der Listen ist ohnehin kein Name; ein Listenwort bleibt einer.
const istEigenname = (N, gewoehnlich, frei, w) => N.tokens.has(w) && !frei.has(w) && !gewoehnlich.has(w.toLowerCase());

function textFehler(game, feld, t, min, max, erlaubt, katalog) {
  const gv = (neu) => (typeof neu === 'string' && neu.trim().length >= min && neu.length <= max ? vorschlag('Text korrigieren', setze(feld, neu)) : undefined);
  if (t.trim().length < min || t.length > max) return fehl(CODES.TEXT_UNZULAESSIG, feld, `${feld} braucht ${min} bis ${max} Zeichen (hat ${t.trim().length})`, t.length > max ? gv(t.slice(0, max).replace(/\s+\S*$/, '')) : undefined);
  if (/[{}]/.test(t)) return fehl(CODES.TEXT_UNZULAESSIG, feld, `${feld} darf keine Platzhalter ({}) enthalten`, gv(t.replace(/[{}]/g, '')));
  if (/[\u0000-\u001f\u007f]/.test(t)) return fehl(CODES.TEXT_UNZULAESSIG, feld, `${feld} darf keine Steuerzeichen enthalten`, gv(t.replace(/[\u0000-\u001f\u007f]+/g, ' ')));
  const N = namenMengen();
  const frei = erlaubt.tokens, freiePhrasen = erlaubt.phrasen.map((p) => p.toLowerCase());
  const gewoehnlich = new Set(wert(katalog, 'gewoehnliche_woerter').map((x) => String(x).toLowerCase()));
  for (const w of woerter(t)) if (istEigenname(N, gewoehnlich, frei, w)) return fehl(CODES.TEXT_UNZULAESSIG, feld, `${feld} nennt den Eigennamen "${kurz(w, 24)}", der nicht der Bezug ist: Namen kommen nur ueber den Bezug`);
  for (const p of N.phrasen) if (!freiePhrasen.includes(p.toLowerCase()) && !(teile(p).length === 1 && gewoehnlich.has(p.toLowerCase())) && alsPhrase(t, p)) return fehl(CODES.TEXT_UNZULAESSIG, feld, `${feld} nennt den Eigennamen "${kurz(p, 30)}", der nicht der Bezug ist: Namen kommen nur ueber den Bezug`);
  const spieler = Ausschnitt().spielerNamen(game || {});
  for (const s of spieler) if (!frei.has(s) && alsPhrase(t, s)) return fehl(CODES.TEXT_UNZULAESSIG, feld, `${feld} nennt einen Spielernamen: die Texte sind Crew-neutral`);
  return null;
}
function erlaubteNamen(bezug) {   // Namen, die ein Text nennen darf: genau der Bezug (Vollname des NSC, Name des Ortes)
  const tokens = new Set(), phrasen = [];
  if (typeof bezug.nsc === 'string') for (const w of woerter(bezug.nsc)) tokens.add(w);
  if (typeof bezug.ort === 'string' && HEX.test(bezug.ort)) { let n = ''; try { n = Sektoren().hexName(bezug.ort) || ''; } catch (e) { n = ''; } if (n) { phrasen.push(n); for (const w of woerter(n)) tokens.add(w); } }
  return { tokens, phrasen };
}

// ---------- Bogen und Ton
function bogenFehler(entry, bogen, katalog) {
  const out = [];
  const felder = Array.isArray(entry.bogen_pflicht) ? entry.bogen_pflicht : wert(katalog, 'bogen_felder');
  for (const k of felder) {
    const v = bogen[k];
    if (typeof v !== 'string' || !v.trim().length) {
      const gv = k === 'wendung' && Array.isArray(entry.wendungen) && entry.wendungen.length ? vorschlag(`Wendung ${entry.wendungen[0]}`, setze('bogen.wendung', entry.wendungen[0])) : undefined;
      out.push(fehl(CODES.BOGEN_UNVOLLSTAENDIG, `bogen.${k}`, `der Bogen braucht ${k} (${wert(katalog, 'bogen_felder').join(', ')})${k === 'wendung' && gv ? '; erlaubt: ' + entry.wendungen.join(', ') : ''}`, gv));
    }
  }
  if (typeof bogen.wendung === 'string' && bogen.wendung.trim().length) {
    const ok = Array.isArray(entry.wendungen) ? entry.wendungen.includes(bogen.wendung) : new RegExp(wert(katalog, 'name_muster')).test(bogen.wendung);
    if (!ok) {
      const liste = Array.isArray(entry.wendungen) ? entry.wendungen : [];
      const nah = naechster(bogen.wendung, liste) || liste[0];
      out.push(fehl(CODES.BOGEN_UNVOLLSTAENDIG, 'bogen.wendung', `die Wendung "${kurz(bogen.wendung, 24)}" gibt es bei dieser Absicht nicht${liste.length ? ' (erlaubt: ' + liste.join(', ') + ')' : ''}`, nah ? vorschlag(`Wendung ${nah}`, setze('bogen.wendung', nah)) : undefined));
    }
  }
  return out;
}
function tonFehler(entry, ton, katalog) {
  const liste = Array.isArray(entry.toene) ? entry.toene : wert(katalog, 'toene');
  if (liste.includes(ton)) return null;
  const nah = naechster(ton, liste) || (liste.includes(entry.ton_standard) ? entry.ton_standard : liste[0]);
  return fehl(CODES.TON_UNBEKANNT, 'ton', `der Ton "${kurz(ton, 24)}" gilt hier nicht (erlaubt: ${liste.join(', ')})`, vorschlag(`Ton ${nah}`, setze('ton', nah)));
}

// ---------- Pruefung
function pruefeAbsicht(game, absicht, katalog) {
  katalog = katalog || katalogStandard();
  const form = formFehler(absicht, katalog);
  if (form.length) return { ok: false, absicht: null, fehler: form };
  const a = klon(absicht);
  a.parameter = a.parameter || {}; a.bezug = a.bezug || {};
  if (!has(katalog.absichten, a.absicht)) {
    const namen = Object.keys(katalog.absichten);
    const nah = naechster(a.absicht, namen);
    const auswahl = namen.slice(0, wert(katalog, 'vorschlag_namen_max'));
    return { ok: false, absicht: a, fehler: [fehl(CODES.ABSICHT_UNBEKANNT, 'absicht', `die Absicht "${kurz(a.absicht, 24)}" gibt es nicht${auswahl.length ? ' (bekannt: ' + auswahl.join(', ') + (namen.length > auswahl.length ? ', ...' : '') + ')' : ''}`, nah ? vorschlag(`Absicht ${nah}`, setze('absicht', nah)) : undefined)] };
  }
  const entry = katalog.absichten[a.absicht];
  const fehler = [];
  fehler.push(...parameterFehler(entry, a.parameter));
  for (const [k, d] of Object.entries(entry.parameter || {})) if (a.parameter[k] === undefined && has(d, 'standard')) a.parameter[k] = d.standard;
  fehler.push(...bezugFehler(game, entry, a.bezug, katalog));
  const bogen = a.bogen || {};
  if (!istObjekt(a.bogen)) fehler.push(fehl(CODES.BOGEN_UNVOLLSTAENDIG, 'bogen', 'der Bogen fehlt (einsatz, wendung, preis)'));
  else fehler.push(...bogenFehler(entry, bogen, katalog));
  const t = tonFehler(entry, a.ton, katalog);
  if (t) fehler.push(t);
  const er = erlaubteNamen(a.bezug), T = D.BAUPLAN.werte.titel, A = D.BAUPLAN.werte.anlass;
  const texte = [['titel', a.titel, T], ['bogen.einsatz', bogen.einsatz, A], ['bogen.preis', bogen.preis, A]];
  for (const [feld, v, g] of texte) {
    if (typeof v !== 'string' || (feld !== 'titel' && !v.trim().length)) continue;   // fehlende Bogentexte meldet der Bogen
    const e = textFehler(game, feld, v, g.min, g.max, er, katalog);
    if (e) fehler.push(e);
  }
  return { ok: fehler.length === 0, absicht: a, fehler };
}
function istFortsetzung(absicht, katalog) {
  katalog = katalog || katalogStandard();
  return !!(istObjekt(absicht) && typeof absicht.absicht === 'string' && has(katalog.absichten, absicht.absicht) && katalog.absichten[absicht.absicht].fortsetzung === true);
}

// ---------- Patch
const SEGMENT = /^[a-z][a-z0-9_]{0,31}$/;
function wendePatchAn(absicht, patch) {
  if (!istObjekt(absicht)) return { ok: false, absicht: null, grund: 'die Absicht ist kein Objekt' };
  if (!Array.isArray(patch) || patch.length < 1 || patch.length > 8) return { ok: false, absicht: null, grund: 'ein Patch ist eine Liste von 1 bis 8 Aenderungen' };
  let a;
  try { a = klon(absicht); } catch (e) { return { ok: false, absicht: null, grund: 'die Absicht ist nicht kopierbar' }; }
  for (const p of patch) {
    if (!istObjekt(p) || typeof p.feld !== 'string') return { ok: false, absicht: null, grund: 'eine Aenderung braucht feld' };
    const seg = p.feld.split('.');
    if (seg.length > 2 || !seg.every((s) => SEGMENT.test(s) && !PROTO.includes(s))) return { ok: false, absicht: null, grund: `feld "${kurz(p.feld, 30)}" ist kein Pfad der Absicht` };
    if (!FELDER.includes(seg[0])) return { ok: false, absicht: null, grund: `feld "${kurz(p.feld, 30)}" ist kein Feld der Absicht` };
    if (p.entfernen === true) {
      if (seg.length === 1) delete a[seg[0]]; else if (istObjekt(a[seg[0]])) delete a[seg[0]][seg[1]];
      continue;
    }
    if (!(typeof p.wert === 'string' || typeof p.wert === 'number')) return { ok: false, absicht: null, grund: `wert bei "${kurz(p.feld, 30)}" ist ein Text oder eine Zahl` };
    if (seg.length === 1) a[seg[0]] = p.wert;
    else { if (!istObjekt(a[seg[0]])) a[seg[0]] = {}; a[seg[0]][seg[1]] = p.wert; }
  }
  return { ok: true, absicht: a, grund: '' };
}
function gegenvorschlagPatch(ergebnis) {
  if (!ergebnis || ergebnis.ok || !ergebnis.fehler.length || !ergebnis.fehler.every((f) => f.gegenvorschlag)) return null;
  const p = [];
  for (const f of ergebnis.fehler) for (const x of f.gegenvorschlag.patch) if (!p.some((y) => y.feld === x.feld)) p.push(x);
  return p;
}

// ---------- Klartext fuer das Modell
function fehlerText(ergebnis, katalog) {
  katalog = katalog || katalogStandard();
  if (!ergebnis || ergebnis.ok) return '';
  const zeilen = ['Nein, die Welt kann diese Absicht so nicht umsetzen:'];
  for (const f of ergebnis.fehler.slice(0, wert(katalog, 'fehler_max'))) {
    let z = `- ${f.code} (${f.feld}): ${f.grund}.`;
    if (f.gegenvorschlag) z += ` Vorschlag: ${f.gegenvorschlag.text}.`;
    zeilen.push(z);
  }
  const p = gegenvorschlagPatch(ergebnis);
  if (p) zeilen.push(`Patch: ${JSON.stringify(p)}`);
  zeilen.push('Antworte einmal mit einem Patch oder einer korrigierten Absicht.');
  const t = zeilen.join('\n'), max = wert(katalog, 'fehler_text_max');
  return t.length > max ? t.slice(0, max - 3) + '...' : t;
}

// ---------- Verhandlung (der Aufrufer ruft das Modell und haelt v)
// Der Ablauf ist fuer jeden Pruefer derselbe: `pruefer(game, absicht, katalog) -> { ok, absicht, fehler }` (Format von pruefeAbsicht). verhandlungStart/-Antwort pruefen nur mit pruefeAbsicht (Stufe 1, ohne Welt-Inszenierung);
// mit dem Inszenierer als Pruefer (Ort, Welt, Staerke, nicht ausdrueckbar) verhandelt server/sim/absicht-verhandlung.js ueber dieselbe Runde (SPL-02 C0): dieses Modul darf inszenierer.js nicht laden (Zyklus).
function verhandlungStartMit(pruefer, game, absicht, katalog) {
  katalog = katalog || katalogStandard();
  const e = pruefer(game, absicht, katalog), max = wert(katalog, 'runden_max');
  if (e.ok) return { stand: 'angenommen', runde: 0, runden_max: max, absicht: e.absicht, ergebnis: e, text: '' };
  const text = fehlerText(e, katalog);
  if (max < 1) return { stand: 'abgelehnt', runde: 0, runden_max: max, absicht: e.absicht, ergebnis: e, text: abgelehntText(e, katalog) };
  return { stand: 'offen', runde: 0, runden_max: max, absicht: e.absicht || absicht, ergebnis: e, text };
}
function abgelehntText(e, katalog) {
  const t = 'Endgueltig abgelehnt: ' + e.fehler.slice(0, wert(katalog, 'fehler_max')).map((f) => `${f.code} (${f.feld}): ${f.grund}`).join('; ');
  const max = wert(katalog, 'fehler_text_max');
  return t.length > max ? t.slice(0, max - 3) + '...' : t;
}
function verhandlungAntwortMit(pruefer, game, v, antwort, katalog) {
  katalog = katalog || katalogStandard();
  if (!istObjekt(v) || v.stand !== 'offen') return v;   // angenommen oder abgelehnt ist endgueltig
  const max = v.runden_max, runde = v.runde + 1;
  const ab = (e, grundText) => ({ stand: 'abgelehnt', runde, runden_max: max, absicht: e ? e.absicht : v.absicht, ergebnis: e || v.ergebnis, text: grundText });
  let neu = null;
  const patch = Array.isArray(antwort) ? antwort : (istObjekt(antwort) && Array.isArray(antwort.patch) ? antwort.patch : null);
  if (patch) {
    const r = wendePatchAn(v.absicht, patch);
    if (!r.ok) return ab(null, 'Endgueltig abgelehnt: ' + r.grund + '. Davor: ' + abgelehntText(v.ergebnis, katalog).replace('Endgueltig abgelehnt: ', ''));
    neu = r.absicht;
  } else if (istObjekt(antwort) && antwort.format === FORMAT) neu = antwort;
  else return ab(null, 'Endgueltig abgelehnt: keine Antwort mit Patch oder korrigierter Absicht. Davor: ' + abgelehntText(v.ergebnis, katalog).replace('Endgueltig abgelehnt: ', ''));
  const e = pruefer(game, neu, katalog);
  if (e.ok) return { stand: 'angenommen', runde, runden_max: max, absicht: e.absicht, ergebnis: e, text: '' };
  if (runde >= max) return ab(e, abgelehntText(e, katalog));
  return { stand: 'offen', runde, runden_max: max, absicht: e.absicht || neu, ergebnis: e, text: fehlerText(e, katalog) };
}

const verhandlungStart = (game, absicht, katalog) => verhandlungStartMit(pruefeAbsicht, game, absicht, katalog);   // nur Stufe 1 (Absichts-Pruefer); mit Inszenierer: absicht-verhandlung.js
const verhandlungAntwort = (game, v, antwort, katalog) => verhandlungAntwortMit(pruefeAbsicht, game, v, antwort, katalog);

// ---------- Katalog in sich stimmig (Strukturregeln)
function katalogFehler(katalog) {
  katalog = katalog || katalogStandard();
  const out = [];
  const f = (t) => out.push(`ABSICHT_KATALOG: ${t}`);
  if (!istObjekt(katalog) || katalog.format !== 'absichten-katalog/1') { f('format muss "absichten-katalog/1" sein'); return out; }
  if (!istObjekt(katalog.werte)) { f('werte fehlt'); return out; }
  const w = (k, pruef, was) => { if (!istObjekt(katalog.werte[k]) || !pruef(katalog.werte[k].wert)) f(`werte.${k}: ${was}`); };
  const ganz = (n) => Number.isInteger(n) && n >= 0;
  const texte = (l) => Array.isArray(l) && l.length > 0 && l.every((x) => typeof x === 'string' && x.length > 0);
  w('runden_max', ganz, 'ganze Zahl >= 0'); w('fehler_text_max', (n) => Number.isInteger(n) && n >= 100, 'ganze Zahl >= 100'); w('fehler_max', (n) => Number.isInteger(n) && n >= 1, 'ganze Zahl >= 1');
  w('absicht_max_zeichen', (n) => Number.isInteger(n) && n >= 200, 'ganze Zahl >= 200'); w('vorschlag_namen_max', (n) => Number.isInteger(n) && n >= 1, 'ganze Zahl >= 1');
  w('name_muster', (m) => { try { return typeof m === 'string' && !!new RegExp(m); } catch (e) { return false; } }, 'gueltiges Muster');
  w('gewoehnliche_woerter', (l) => Array.isArray(l) && l.every((x) => typeof x === 'string' && x.length > 0), 'Liste von Texten'); w('toene', texte, 'Liste von Texten'); w('bogen_felder', texte, 'Liste von Texten'); w('bezug_arten', (l) => texte(l) && l.every((x) => ['nsc', 'ort'].includes(x)), 'Liste aus nsc, ort'); w('parameter_arten', (l) => texte(l) && l.every((x) => ['zahl', 'liste'].includes(x)), 'Liste aus zahl, liste');
  if (out.length) return out;
  if (!istObjekt(katalog.absichten)) { f('absichten fehlt'); return out; }
  const muster = new RegExp(wert(katalog, 'name_muster'));
  const EINTRAG = ['zweck', 'parameter', 'bezug', 'fortsetzung', 'wendungen', 'toene', 'bogen_pflicht', 'ton_standard', 'inszenierung', 'prompt_zeile', 'standard', '_hinweis'];   // _hinweis: Anmerkung der Entwicklung (Text, ohne Wirkung); inszenierung: Rezept des Inszenierers (inszenierer.js prueft den Inhalt); hier nur: ein Objekt. prompt_zeile und standard: SPL-02 C (siehe unten)
  for (const [name, e] of Object.entries(katalog.absichten)) {
    const g = (t) => f(`${name}: ${t}`);
    if (!muster.test(name)) { g('Name passt nicht zu name_muster'); continue; }
    if (!istObjekt(e)) { g('kein Objekt'); continue; }
    for (const k of Object.keys(e)) if (!EINTRAG.includes(k)) g(`unbekanntes Feld ${k}`);
    if (typeof e.zweck !== 'string' || e.zweck.length < 8) g('zweck fehlt');
    if (e.fortsetzung !== undefined && typeof e.fortsetzung !== 'boolean') g('fortsetzung ist wahr oder falsch');
    if (e.inszenierung !== undefined && !istObjekt(e.inszenierung)) g('inszenierung ist kein Objekt');
    if (e._hinweis !== undefined && typeof e._hinweis !== 'string') g('_hinweis ist ein Text');
    if (e.parameter !== undefined) {
      if (!istObjekt(e.parameter)) g('parameter ist kein Objekt');
      else for (const [k, d] of Object.entries(e.parameter)) {
        if (!muster.test(k) || !istObjekt(d) || !wert(katalog, 'parameter_arten').includes(d.art)) { g(`parameter ${k}: Name oder art`); continue; }
        if (d.art === 'zahl') {
          if (!(Number.isInteger(d.min) && Number.isInteger(d.max) && d.min <= d.max)) g(`parameter ${k}: min und max sind ganze Zahlen, min <= max`);
          else if (d.standard !== undefined && !(Number.isInteger(d.standard) && d.standard >= d.min && d.standard <= d.max)) g(`parameter ${k}: standard liegt ausserhalb`);
        } else if (!Array.isArray(d.erlaubt) || !d.erlaubt.length || !d.erlaubt.every((x) => typeof x === 'string' || typeof x === 'number') || (d.standard !== undefined && !d.erlaubt.includes(d.standard))) g(`parameter ${k}: erlaubt (nicht leer) und standard`);
      }
    }
    if (e.bezug !== undefined) {
      if (!Array.isArray(e.bezug)) g('bezug ist keine Liste');
      else {
        const namen = new Set();
        for (const b of e.bezug) {
          if (!istObjekt(b) || !wert(katalog, 'bezug_arten').includes(b.name) || typeof b.pflicht !== 'boolean' || (b.kandidat !== undefined && (!(typeof b.kandidat === 'boolean' || nscAltTyp(b.kandidat)) || b.name !== 'nsc'))) { g('bezug: Eintrag { name, pflicht, kandidat? (nur nsc; true oder ein Beat-Typ mit braucht.nsc_alt) }'); continue; }
          if (namen.has(b.name)) g(`bezug ${b.name} doppelt`);
          namen.add(b.name);
        }
      }
    }
    const liste = (k, erlaubt) => { if (e[k] !== undefined && !(texte(e[k]) && e[k].every((x) => erlaubt(x)))) g(`${k}: Liste gueltiger Werte`); };
    liste('wendungen', (x) => muster.test(x)); liste('toene', (x) => wert(katalog, 'toene').includes(x)); liste('bogen_pflicht', (x) => wert(katalog, 'bogen_felder').includes(x));
    if (e.ton_standard !== undefined && !(Array.isArray(e.toene) ? e.toene : wert(katalog, 'toene')).includes(e.ton_standard)) g('ton_standard ist kein erlaubter Ton');
    // SPL-02 C: prompt_zeile = die Zeile des Katalogs im Prompt des Spielleiters (Paket E baut ihn daraus), hoechstens werte.prompt_zeile_max Zeichen, beginnt mit dem Namen der Absicht;
    // standard = die Standard-Parametrierung (titel, bogen, ton): daraus entsteht ohne Modell eine gueltige Absicht (Rueckfall des Bretts, Paket F)
    if (e.prompt_zeile !== undefined) {
      const max = katalog.werte.prompt_zeile_max ? wert(katalog, 'prompt_zeile_max') : null;
      if (typeof e.prompt_zeile !== 'string' || !e.prompt_zeile.startsWith(name + ':')) g(`prompt_zeile ist ein Text, der mit "${name}:" beginnt`);
      else if (!Number.isInteger(max) || max < 40) g('prompt_zeile braucht werte.prompt_zeile_max (ganze Zahl >= 40)');
      else if (e.prompt_zeile.length > max) g(`prompt_zeile hat ${e.prompt_zeile.length} Zeichen, hoechstens ${max} (werte.prompt_zeile_max)`);
    }
    if (e.standard !== undefined) {
      const s = e.standard, tl = Array.isArray(e.toene) ? e.toene : wert(katalog, 'toene');
      if (!istObjekt(s) || typeof s.titel !== 'string' || !istObjekt(s.bogen) || !Object.values(s.bogen).every((x) => typeof x === 'string') || (s.ton !== undefined && !tl.includes(s.ton)) || Object.keys(s).some((k) => !['titel', 'bogen', 'ton'].includes(k))) g('standard ist { titel: Text, bogen: { Feld: Text }, ton? }');
    }
  }
  return out;
}

module.exports = { CODES, pruefeAbsicht, istFortsetzung, wendePatchAn, gegenvorschlagPatch, fehlerText, verhandlungStart, verhandlungAntwort, verhandlungStartMit, verhandlungAntwortMit, katalogFehler, katalogStandard, katalogNeuLesen };
