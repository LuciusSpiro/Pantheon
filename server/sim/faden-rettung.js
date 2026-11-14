'use strict';
// BEA-02 B: Baustein des Beats rettung (Action-Layer wie faden-landung.js). Die Crew findet am Ort des Plans (Landeplatz, DYN-01) bis zu drei Ueberlebende, beamt sie ueber die Ops in den Frachtraum (Ladungsart person) und
// gibt sie auf Wunsch an einer Station ab. Der Beat ist unabhaengig von landung einsetzbar (auch an einem Wrack, Art schiff) und baut seinen Ort selbst (faden.js ruft abenteuer-orte.beatStarten fuer den Parameter
// landeplatz). WER am Ort steht (Parameter besetzung, Tabelle boden-werte.json), baut dieselbe Funktion wie bei landung (faden-boden-rahmen.besetzenFuer, keine Kopie); Zahlen und Namen des Beats stehen in
// content/faeden/rettung-werte.json, Funktexte in rettung-texte.json, Frist und Pflicht im Katalog beats.json. Im Servercode steht keine Zahl und kein Name davon.
//
//   starten(game, faden, ctx)   Besetzung (geteilt mit landung), Ueberlebende setzen, Frachtraum pruefen, Funk. -> { laeuft: true }. Fehlt der Ort, scheitert der Beat.
//     Ueberlebende: Person 1 ist der NSC des Fadens (Kennung <Fadenid>.<Beat-Id>.u1, Name faden.nsc.name), 2 und 3 sind Lager-Eintraege {person, name} ohne Fadenzustand (Namen: faden.ueberlebendeNamen, namen.json, immer aus
//       demselben Strom in fester Reihenfolge, vom Lagerstand unabhaengig: nach dem Laden dieselben Namen). Die Beat-Id in der Kennung trennt zwei rettung-Beats eines Fadens. Die Kennungen
//       sind deterministisch: der Beat laeuft nach Speichern und Laden ohne eigenen Weltstand-Block weiter (die Personen im Lager stehen im Weltstand crew.fracht). Sie stehen auf Ankern der Karte (Rolle deckung, sonst
//       nsc, zelle; away.spawnPersonDazu, injured false), die Karte wird ueber landepunkte.sobaldGeladen registriert (direkt nach dem Beat-Start ist sie nie im Cache). Fehler beim Setzen zaehlen (countError), werfen nie.
//     Frachtraum: nimmt Fracht.platzFuer('person') keine Person auf (Modul mit anderer Ladung, voll, kein Frachtraum), meldet der Funk es beim Start und die Bordanzeige nennt den Klartext. Der Beat laeuft weiter und
//       WARTET bis zur Frist; es wird nichts geraeumt oder geworfen, die Ueberlebenden stehen trotzdem am Ort.
//   Handler (faden-boden.js, Art rettung), nur fuer den laufenden Beat dieses Fadens:
//     beamedDown      holt Besetzung und fehlende Ueberlebende nach (Karte neu gebaut, geladen, verdraengt: der Ort kommt aus dem Faden zurueck, aber leer)
//     beamedUp        mit data.notrueckholung (Ausbluten, squadRecall, recall): niemand mehr unten, aber noch Ueberlebende am Boden = gescheitert (die Crew wurde geholt, sie ging nicht freiwillig)
//     npcRescued      merkt die Person als aufgenommen (kein Nachsetzen); bewertet NICHT (die Person liegt erst nach dem zweiten Ereignis personAnBord im Lager)
//     personAnBord    bewertet. Eine Aufnahme erzeugt zwei Ereignisse (npcRescued, personAnBord): der Zustand wird aus personen-bord.personAnBord abgeleitet, nie gezaehlt; es zaehlen nur Personen dieses Beats (nach person gefiltert)
//     personAbgegeben nur data.abgabe station (personen-bord.js) merkt die Person als abgegeben und bewertet, nach person gefiltert (das Ereignis traegt keinen Abgabeort im Sinne von faden-boden.js); abgabe boden
//                     (am Landepunkt abgesetzt) zaehlt NICHT: die Person steht wieder am Ort (Zeiger aufgenommen zurueck, Datensatz der Karte wieder da), der Beat laeuft weiter
//     notsprung       gescheitert
//   nachTaetigkeit(game), update(game)   bewertet bei jedem Takt der Taetigkeiten und bei jedem Tick (nur Faeden mit laufendem rettung-Beat: sonst sofort zurueck) und setzt fehlende Ueberlebende auf der lebenden
//                                        Karte nach (Verdraengung, Neubau). Viele Wege nach oben melden kein beamedUp (siehe faden-boden.js).
// Ausgang: ende an_bord = gelungen, wenn jede Person des Beats an Bord ist (eine schon abgegebene oder ohne Bett gerettete zaehlt als erledigt, sie hat den Ort verlassen); ende abgegeben = gelungen, wenn jede Person
// abgegeben ist (ohne Bett gerettete zaehlen als erledigt, sie lassen sich nicht mehr abgeben). Gescheitert bei: Frist (faden.js; am Boden zaehlt keine Taetigkeit, bei abgegeben zaehlen die Taetigkeiten des Fluges zur Station),
// Notsprung, Notrueckholung ohne dass noch jemand unten ist (und Ueberlebende am Boden), Faden-Ende, und wenn kein Weg mehr zum Ziel fuehrt (niemand mehr am Boden, bei abgegeben auch niemand mehr an Bord).
// Den Ort raeumt der vorhandene Faden-Abschluss ab (abenteuer-orte.abraeumen). Bei Scheitern bleiben schon aufgenommene Personen im Lager (der Beat fasst sie nicht an, die Crew gibt sie ab oder behaelt sie).
// Weltstand: aufgenommen und uebergeben stehen als Listen von Personenkennungen in f.laufend (nur wenn nicht leer, Schema weltstand.schema.json, faden.js lesen), damit Speichern und Laden zwischen zwei Abgaben nichts verliert.
// Laufzeit-Zustand sonst nie im Weltstand und nie im WeakMap(game): nur WeakSet/WeakMap auf das Faden-Objekt (aktiv, Namen, Merker fuer schon gemeldete Fehler). Er faellt mit reset/Laden weg; danach gilt, was Lager, Karte und f.laufend hergeben.
// Grenzen: (1) Nach dem Laden ist die Karte neu gebaut (nicht im Weltstand): eine ohne Bett gerettete Person (Grenze 2) steht dann wieder am Ort, eine aufgenommene oder abgegebene nicht.
// (2) Eine Person, die einem Spieler folgt und beim Hochbeamen ohne Ops-Beam "gerettet" wird (away.executeBeam), erzeugt nur npcRescued und kein Bett: sie zaehlt als erledigt.
const D = require('./faden-daten.js');
const Boden = require('./faden-boden.js');
const Landung = require('./faden-boden-rahmen.js');   // gemeinsamer Rahmen der Boden-Beats (WRK-01 B): ortVon, platzName, niemandUnten, Besetzung, fmt
const CONFIG = require('../../shared/config.js');
const W = require('../world.js');
const TEXTE = require('../../content/faeden/rettung-texte.json').texte;
const WERTE = require('../../content/faeden/rettung-werte.json').werte;

const ART = 'rettung';   // Katalogtyp des Beats (beats.json); der Baustein traegt denselben Namen
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const fehlerZaehlen = (game, wo, e) => { if (game && game.countError) game.countError(wo, e); };
const Faden = () => require('./faden.js');
const Bitte = () => require('./faden-bitte.js');
const Landepunkte = () => require('./landepunkte.js');
const Away = () => require('./away.js');
const Fracht = () => require('./fracht.js');
const Bord = () => require('./personen-bord.js');
const Objekte = () => require('../mission/objects.js');
const logbuch = (game, e) => { try { require('./regie-befehle.js').schreibe(game, Object.assign({ art: 'faden_baustein', quelle: 'regie' }, e)); } catch (err) { fehlerZaehlen(game, 'faden-rettung-logbuch', err); } };

const aktiv = new WeakSet();       // Faden-Objekte mit laufendem rettung-Beat (Tick-Pruefung)
const namenVon = new WeakMap();    // Faden-Objekt -> { beat, n, namen }: die Namen der Personen (Person 1 zuerst), je Beat gezogen
const gemeldet = new WeakMap();    // Faden-Objekt -> Set(Karte|Person): das Scheitern des Setzens ist schon gemeldet (einmal je Person und Karte, nicht je Tick)
// Aufgenommen (schon von der Karte genommen, Beam oder Gerettet, nie wieder setzen) und uebergeben (an einer Station abgegeben) stehen in f.laufend (Listen von Personenkennungen, nur wenn nicht leer):
// dieses Feld steht ohnehin im Weltstand und ueberlebt Speichern und Laden (faden.js lesen)
const hat = (f, k, person) => !!f.laufend && Array.isArray(f.laufend[k]) && f.laufend[k].includes(person);
const merke = (f, k, person) => { if (f.laufend && !hat(f, k, person)) (f.laufend[k] = f.laufend[k] || []).push(person); };
const vergiss = (f, k, person) => { if (hat(f, k, person)) { f.laufend[k] = f.laufend[k].filter((p) => p !== person); if (!f.laufend[k].length) delete f.laufend[k]; } };
const meldeEinmal = (f, schluessel) => { let s = gemeldet.get(f); if (!s) { s = new Set(); gemeldet.set(f, s); } if (s.has(schluessel)) return false; s.add(schluessel); return true; };

// ---------- Daten
const anzahlVon = (beat) => {
  const k = beat && beat.parameter ? beat.parameter.anzahl : undefined;
  const n = Number.isInteger(k) ? k : WERTE.anzahl_standard.wert;
  return Math.max(WERTE.anzahl_min.wert, Math.min(WERTE.anzahl_max.wert, n));
};
const abgeben = (beat) => WERTE.enden.wert[endeVon(beat)].abgeben === true;   // der Ende-Wert verlangt die Abgabe an einer Station (Daten rettung-werte.json enden)
const endeVon = (beat) => {
  const k = beat && beat.parameter ? beat.parameter.ende : undefined;
  return typeof k === 'string' && has(WERTE.enden.wert, k) ? k : WERTE.ende_standard.wert;
};

// Der laufende Beat dieses Fadens, wenn er ein rettung-Beat ist (sonst null)
function laufenderBeat(f) {
  if (!f || f.phase !== 'laeuft' || !f.laufend) return null;
  const v = D.vorlage(f.vorlage), beat = v && v.beats[f.beat];
  if (!beat || beat.id !== f.laufend.beat || beat.typ !== ART || f.laufend.variante) return null;
  return beat;
}
// Die Personen des Beats: [{ person, name }], Person 1 ist der NSC des Fadens. Ein Name im Lager (schon an Bord) gilt vor dem gezogenen.
function personen(game, f, beat) {
  const n = anzahlVon(beat);
  let c = namenVon.get(f);
  if (!c || c.beat !== f.beat || c.n !== n) {
    c = { beat: f.beat, n, namen: [f.nsc.name].concat(Faden().ueberlebendeNamen(game, f, n - 1)) };
    namenVon.set(f, c);
  }
  const lager = Fracht().state(game).lager;
  return c.namen.map((name, i) => {
    const person = `${f.id}.${beat.id}.${WERTE.person_praefix.wert}${i + 1}`;
    const l = lager.find((x) => x.art === Bord().ART && x.person === person);
    return { person, name: l && l.name ? l.name : name };
  });
}
// Die lebende, registrierte Karte des Ortes (nach landepunkte.zuruecksetzen steht das alte Objekt noch in game.aways, ist aber nicht mehr registriert), sonst null
const lebendeKarte = (game, lp) => { const aw = game.aways && game.aways[lp]; return aw && W.AWAY_MAPS[lp] ? aw : null; };

// ---------- Ueberlebende setzen (idempotent: nur Personen, die weder aufgenommen noch abgegeben sind, nicht an Bord liegen und keinen Datensatz auf der Karte haben)
function ankerVon(game, lp) {
  for (const rolle of WERTE.anker_rollen.wert) { const l = Objekte().resolveAnker(game, lp, rolle); if (l.length) return l; }
  return [];
}
function platzieren(game, f, beat, lp, aw) {
  if (!aw) return;
  const A = Away();
  let anker = null;
  personen(game, f, beat).forEach((p, i) => {
    if (hat(f, 'aufgenommen', p.person) || hat(f, 'uebergeben', p.person) || Bord().personAnBord(game, p.person) || A.personMit(aw, p.person)) return;
    anker = anker || ankerVon(game, lp);
    const a = anker.length ? anker[i % anker.length] : null;
    if (!a || !A.spawnPersonDazu(game, lp, { x: a.x, y: a.y }, { person: p.person, name: p.name, injured: false })) { if (meldeEinmal(f, lp + '|' + p.person)) fehlerZaehlen(game, 'faden-rettung', new Error(`Ueberlebende ${p.person} konnte an ${lp} nicht gesetzt werden`)); }   // das Nachsetzen versucht es weiter, gemeldet wird einmal
  });
}
function ueberlebendeSetzen(game, f, beat, lp) {
  const stand = Landepunkte().sobaldGeladen(game, lp, ART + '-personen', (aw) => platzieren(game, f, beat, lp, aw));
  if (stand === 'unbekannt') fehlerZaehlen(game, 'faden-rettung', new Error(`Landeplatz ${lp} ist dem Spiel unbekannt, keine Ueberlebenden`));
}

// ---------- Zustand und Bewertung (aus Lager und Karte abgeleitet, nie gezaehlt)
// im_lager | uebergeben | ohne_bett (gerettet ohne Bett, Gerettet-Weg der Karte) | weg (von der Karte genommen, nirgends) | unten (steht dort oder die Karte ist (noch) nicht da)
function zustand(game, f, aw, p) {
  if (Bord().personAnBord(game, p.person)) return 'im_lager';
  if (hat(f, 'uebergeben', p.person)) return 'uebergeben';
  const n = aw ? Away().personMit(aw, p.person) : null;
  if (n && n.rescued) return 'ohne_bett';
  if (n && !n.present) return 'weg';
  return 'unten';
}
const zustaende = (game, f, beat, lp) => { const aw = lebendeKarte(game, lp); return personen(game, f, beat).map((p) => zustand(game, f, aw, p)); };
// -> 'gelungen' | 'gescheitert' | null (noch offen)
function bewerten(game, f, beat, lp) {
  const zs = zustaende(game, f, beat, lp), uebergabe = abgeben(beat);
  const erledigt = uebergabe ? ['uebergeben', 'ohne_bett'] : ['im_lager', 'uebergeben', 'ohne_bett'];
  if (zs.every((z) => erledigt.includes(z))) return 'gelungen';
  const weiter = zs.some((z) => z === 'unten' || (uebergabe && z === 'im_lager'));
  return weiter ? null : 'gescheitert';
}
function ausgang(game, f, art) {
  aktiv.delete(f);
  if (art === 'gelungen') {
    const nsc = Faden().nscVon(game, f.nsc.id) || f.nsc, text = TEXTE[ART + '_gelungen'];
    if (text && nsc) Bitte().funkVon(game, nsc, Landung.fmt(text, { ort: Landung.hexName(f.parameter && f.parameter.ort), name: f.nsc.name }));
  }
  return Faden().beatAusgang(game, f.id, art);
}
function pruefenBeat(game, f, beat, lp) {
  const r = bewerten(game, f, beat, lp);
  if (r) ausgang(game, f, r);
}
function pruefen(game) {
  const F = game.weltsim && game.weltsim.faeden;
  if (!F) return;
  for (const f of F.liste) if (f.phase === 'laeuft' && f.laufend && !aktiv.has(f) && laufenderBeat(f)) aktiv.add(f);   // nach Laden und reset: der Beat laeuft, sein Merker fehlt (neues Faden-Objekt)
  if (!F.liste.some((x) => aktiv.has(x))) return;   // sonst sofort zurueck ohne Allokation, solange kein rettung-Beat laeuft
  for (const f of F.liste.slice()) {
    if (!aktiv.has(f)) continue;
    const beat = laufenderBeat(f), lp = beat && Landung.ortVon(game, f, beat);
    if (!lp) { aktiv.delete(f); continue; }
    platzieren(game, f, beat, lp, lebendeKarte(game, lp));   // Karte verdraengt und neu gebaut: die Ueberlebenden kommen zurueck
    if (aktiv.has(f)) pruefenBeat(game, f, beat, lp);
  }
}
const nachTaetigkeit = (game) => pruefen(game);
const update = (game) => pruefen(game);

// ---------- Handler am Boden-Verteiler
const handler = {
  ereignis(game, f, ev) {
    const beat = laufenderBeat(f);
    if (!beat) return;
    aktiv.add(f);
    if (ev.name === 'notsprung') { ausgang(game, f, 'gescheitert'); return; }
    const lp = Landung.ortVon(game, f, beat), d = ev.data || {};
    if (!lp) return;
    const meine = personen(game, f, beat).some((p) => p.person === String(d.person));
    if (ev.name === 'beamedDown') {
      if (d.map !== lp) return;
      Landung.besetzenFuer(game, beat, lp, ART);   // nachholen (die Karte traegt keine Besetzung: neu gebaut, geladen, verdraengt), sonst nichts
      platzieren(game, f, beat, lp, lebendeKarte(game, lp));
      return;
    }
    if (ev.name === 'beamedUp') {
      if (d.map !== lp || d.notrueckholung !== true || !Landung.niemandUnten(game, lp)) return;
      if (zustaende(game, f, beat, lp).some((z) => z === 'unten')) ausgang(game, f, 'gescheitert');
      return;
    }
    if (!meine) return;
    if (ev.name === 'npcRescued') { merke(f, 'aufgenommen', String(d.person)); return; }
    if (ev.name === 'personAnBord') { merke(f, 'aufgenommen', String(d.person)); pruefenBeat(game, f, beat, lp); return; }
    if (ev.name === 'personAbgegeben') {
      if (d.abgabe === 'station') { merke(f, 'uebergeben', String(d.person)); pruefenBeat(game, f, beat, lp); return; }   // nur eine Abgabe an einer Station zaehlt
      if (d.abgabe === 'boden') {   // am Boden abgesetzt (kein Abgabeort): die Person steht wieder am Ort und ist wieder zu holen
        vergiss(f, 'aufgenommen', String(d.person));
        const n = Away().personMit(lebendeKarte(game, lp), String(d.person));
        if (n) { Away().setzePersonZustand(n, 'ok'); n.present = true; }
      }
    }
  },
};
Boden.anmelden(ART, handler);

// ---------- Baustein
const baustein = {
  id: ART,
  starten(game, faden, ctx) {
    const beat = ctx && ctx.beat;
    const lp = beat ? Landung.ortVon(game, faden, beat) : null;
    if (!lp) { logbuch(game, { ausgang: 'abgelehnt', key: ART, begruendung: 'Rettung ohne Ort: der Beat gilt als gescheitert', plan: { faden: faden.id } }); return { ausgang: 'gescheitert' }; }
    aktiv.add(faden); namenVon.delete(faden); gemeldet.delete(faden);   // ein neuer Beat beginnt ohne Vorgeschichte (f.laufend ist neu: aufgenommen und abgegeben leer)
    if (faden.laufend) { delete faden.laufend.aufgenommen; delete faden.laufend.uebergeben; }
    Landung.besetzenFuer(game, beat, lp, ART);
    ueberlebendeSetzen(game, faden, beat, lp);
    const modus = endeVon(beat), nsc = Faden().nscVon(game, faden.nsc.id) || faden.nsc, v = { platz: Landung.platzName(faden, beat), ort: Landung.hexName(faden.parameter && faden.parameter.ort), name: faden.nsc.name };
    const text = TEXTE[ART + '_start_' + modus];
    if (text && nsc) Bitte().funkVon(game, nsc, Landung.fmt(text, v));
    const platz = Fracht().platzFuer(game, Bord().ART);
    if (!platz.ok) {   // nichts raeumen, nichts werfen: der Hinweis nennt, warum niemand hochgeholt werden kann; der Beat wartet bis zur Frist
      if (TEXTE[ART + '_frachtraum_belegt'] && nsc) Bitte().funkVon(game, nsc, Landung.fmt(TEXTE[ART + '_frachtraum_belegt'], v));
      if (platz.text && game.oda) game.oda(platz.text, null);
    }
    logbuch(game, { ausgang: 'rettung', key: ART, begruendung: `Rettung an ${lp}, ${personen(game, faden, beat).length} Ueberlebende, Ende ${modus}, Besetzung ${Landung.besetzungsSchluessel(beat)}${platz.ok ? '' : ', Frachtraum ohne Platz (' + platz.grund + ')'}`, plan: { faden: faden.id, beat: beat.id, ort: lp, ende: modus } });
    return { laeuft: true };
  },
};

// Konsistenz der Daten (Katalogpruefung, Tests): Katalog-Eintrag, Zahlen, Enden, Besetzung, Texte
function datenFehler() {
  const out = [];
  const k = has(D.BEATS, ART) ? D.BEATS[ART] : null;
  if (!k) return ['Beat ' + ART + ' fehlt im Katalog (beats.json)'];
  if (k.baustein !== ART) out.push(`Beat ${ART}: baustein ist ${k.baustein}`);
  if (!(k.braucht && k.braucht.landeplatz === true)) out.push(`Beat ${ART}: braucht.landeplatz ist true`);
  if (!(Number.isInteger(k.frist) && k.frist >= 1)) out.push(`Beat ${ART}: frist (Taetigkeiten) fehlt`);
  if (k.gefahr !== false) out.push(`Beat ${ART}: der Bodenbeat ist keine Raum-Gefahr (gefahr false)`);
  const bp = (k.bauplan && k.bauplan.parameter) || {};
  const gleich = (a, b) => Array.isArray(a) && a.slice().sort().join() === b.slice().sort().join();
  const besetzungen = Object.keys(Landung.WERTE.besetzung.wert);
  if (!(bp.besetzung && gleich(bp.besetzung.erlaubt, besetzungen) && bp.besetzung.standard === Landung.WERTE.besetzung_standard.wert)) out.push('bauplan.parameter.besetzung stimmt nicht mit den Schluesseln und dem Standard von boden-werte.json ueberein');
  const enden = Object.keys(WERTE.enden.wert);
  if (!(bp.ende && gleich(bp.ende.erlaubt, enden) && bp.ende.standard === WERTE.ende_standard.wert)) out.push('bauplan.parameter.ende stimmt nicht mit enden und ende_standard von rettung-werte.json ueberein');
  if (!enden.includes(WERTE.ende_standard.wert)) out.push('ende_standard ist kein Schluessel von enden');
  for (const e of enden) if (typeof WERTE.enden.wert[e].abgeben !== 'boolean') out.push(`enden ${e}: abgeben ist ein Wahrheitswert`);
  const lo = WERTE.anzahl_min.wert, hi = WERTE.anzahl_max.wert, std = WERTE.anzahl_standard.wert;
  if (!(Number.isInteger(lo) && Number.isInteger(hi) && Number.isInteger(std) && lo >= 1 && lo <= std && std <= hi)) out.push('anzahl_min, anzahl_standard, anzahl_max brauchen 1 <= min <= standard <= max');
  if (hi > CONFIG.personen.maxGleichzeitig) out.push(`anzahl_max ${hi} ist groesser als CONFIG.personen.maxGleichzeitig (${CONFIG.personen.maxGleichzeitig})`);
  const reihe = []; for (let i = lo; i <= hi; i++) reihe.push(i);
  if (!(bp.anzahl && Array.isArray(bp.anzahl.erlaubt) && bp.anzahl.erlaubt.join() === reihe.join() && bp.anzahl.standard === std)) out.push('bauplan.parameter.anzahl stimmt nicht mit anzahl_min bis anzahl_max und anzahl_standard ueberein');
  if (!(bp.landeplatz && bp.landeplatz.erlaubt === 'landeplatz')) out.push('bauplan.parameter.landeplatz: erlaubt landeplatz fehlt');
  for (const e of enden) if (!/^[a-z_]+$/.test(e) || e.length > WERTE.schluessel_max.wert) out.push(`enden ${e}: Schluessel ungueltig`);
  if (typeof WERTE.person_praefix.wert !== 'string' || !/^[a-z]+$/.test(WERTE.person_praefix.wert) || WERTE.person_praefix.wert.length > WERTE.schluessel_max.wert) out.push('person_praefix ist ein kurzer Text (a-z)');
  const rollen = WERTE.anker_rollen.wert;
  if (!Array.isArray(rollen) || !rollen.length || !rollen.every((r) => typeof r === 'string' && /^[a-z_]+$/.test(r))) out.push('anker_rollen ist eine Liste von Ankerrollen (a-z, _)');
  const schluessel = enden.map((e) => ART + '_start_' + e).concat([ART + '_frachtraum_belegt', ART + '_gelungen']);
  for (const s of schluessel) {
    const text = TEXTE[s];
    if (typeof text !== 'string' || !text.trim()) { out.push(`rettung-texte.json: ${s} fehlt`); continue; }
    if (text.length > WERTE.text_max.wert) out.push(`rettung-texte.json: ${s} hat ${text.length} Zeichen (hoechstens ${WERTE.text_max.wert})`);
    for (const p of text.match(/\{[^}]*\}/g) || []) if (p !== '{platz}' && p !== '{ort}' && p !== '{name}') out.push(`rettung-texte.json: ${s} nennt den Platzhalter ${p} (erlaubt: {platz}, {ort}, {name})`);
  }
  for (const s of Object.keys(TEXTE)) if (!schluessel.includes(s)) out.push(`rettung-texte.json: ${s} wird nicht gebraucht`);
  return out;
}

module.exports = { baustein, handler, nachTaetigkeit, update, datenFehler, personen, anzahlVon, endeVon, TEXTE, WERTE };
