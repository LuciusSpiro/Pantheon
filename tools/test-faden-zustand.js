'use strict';
// SUND-04a-1 B: Zustand und Ablauf der Geschichtsfaeden (server/sim/faden.js) im laufenden Spiel (Freie Fahrt Sund, FAEDEN=1). Prueft: Schalter und Hooks (echte Hooks game.lageGrenze und Reise-Notruf) ·
// Zaehler (nie ueber die Chronik) · Abstand 2 bis 4 ueber viele Taetigkeiten · Obergrenze 3 · Beats und Ausgaenge (Scheitern veraendert, beendet nicht; Frist; Option; Baustein wirft) · jede Befehlsregel
// einzeln · NSC aus Datenlisten, Gedaechtnis 12 · Haltung (Wirkung, Tick) · Weltstand (Runde, Altstand, Muell, Obergrenzen) · Ausfall des Spielleiters.
// Erwartete Werte werden im Test selbst gezaehlt, nicht aus dem Produktivcode abgeleitet.        node tools/test-faden-zustand.js
const X = require('./faden-fixture.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Chronik = require('../server/sim/chronik.js');
const Bausteine = require('../server/sim/faden-bausteine.js');
const Sektoren = require('../shared/sektoren.js');
const Sprung = require('../server/sim/sprung.js');
const RE = require('../server/sim/reise-ereignis.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const Daten = require('../server/weltsim/daten.js');
const Kern = require('../server/weltsim/kern.js');

const { D, Faden, F, klon, spiel, angebot, oeffne, grenzen, alsVorlage, registriere } = X;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const ws = (g) => g.weltsim;
const liste = (g) => ws(g).faeden.liste;
const aktive = (g) => liste(g).filter((f) => f.phase !== 'abgeschlossen');   // eigene Zaehlung des Tests
const logbuch = (g) => (g.lageRegie ? g.lageRegie.log.entries : []);
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: X.D.vorlage(f.vorlage).beats[f.beat].id });
const BEATS = ['b_bitte', 'b_spontan', 'b_notruf', 'b_enthuell', 'b_jagd', 'b_ende'];
// bringt den Faden mit Taetigkeiten bis zum naechsten Beat und startet ihn; -> Anzahl der Taetigkeiten dazwischen (selbst gezaehlt) | null
function starte(g, f, max) {
  let seit = 0;
  for (let i = 0; i <= (max || 8); i++) {
    const beat = X.D.vorlage(f.vorlage).beats[f.beat].id;
    if (Faden.befehlPruefen(g, { typ: 'faden_weiter', faden: f.id, beat }, Pruefer.neuerKontext()) === null) return weiter(g, f).ok ? seit : null;
    grenzen(g, 1); seit++;
  }
  return null;
}
// spielt einen Pfad (Ausgaenge der Reihe nach) durch; -> Liste der Beat-Ids, die tatsaechlich liefen
function pfad(g, f, ausgaenge) {
  const lief = [];
  for (const a of ausgaenge) {
    if (f.phase === 'abgeschlossen') break;
    const id = X.D.vorlage(f.vorlage).beats[f.beat].id;
    if (starte(g, f) === null) throw new Error('Beat startet nicht: ' + id);
    lief.push(id);
    Faden.beatAusgang(g, f.id, a);
  }
  return lief;
}

section('Schalter: ohne FAEDEN tut kein Hook etwas', () => {
  const g = spiel({ aus: true }).g;
  grenzen(g, 25, 'andocken'); grenzen(g, 5, 'szene_ende');
  ok(!Faden.aktiv(g) && ws(g).faeden.t === 0 && Faden.toSave(ws(g)) === null, 'Zaehler bleibt 0, kein Weltstand-Block (30 Grenzen)');
  ok(Faden.ausgangMitPerson(g, { art: 'notruf', id: 'x', hex: '0305', ausgang: 'gelungen' }) === null && ws(g).faeden.angebote.length === 0, 'ein bewaeltigter Notruf macht kein Angebot');
  ok(Faden.taetigkeit(g, 'andocken') === null, 'taetigkeit() ohne Schalter: null');
  ok(Faden.ausschnittBlock(g) === null && Faden.promptText() !== null, 'kein Faden-Block im Ausschnitt');
  const k = F.neuesSpiel({ crew: 1, seed: 7, env: { FAEDEN: '1' } }).g; k.weltsim = null;
  ok(Faden.aktiv(k) === false && Faden.taetigkeit(k, 'andocken') === null, 'ohne Modus (Kampagne, kein weltsim) nichts');
  const e = spiel({ env: { FAEDEN: 'off' } }).g;
  ok(!Faden.aktiv(e), 'FAEDEN=off ist aus');
});

section('Taetigkeiten: gezaehlt werden die Grenzen, nie die Chronik', () => {
  const g = spiel().g;
  const arten = ['szene_ende', 'andocken', 'absicht', 'andocken', 'debug', 'irgendwas', 'andocken'];
  for (const a of arten) g.lageGrenze(a);
  ok(ws(g).faeden.t === 5, `5 von 7 Grenzen zaehlen (szene_ende, andocken, absicht), debug und Unbekanntes nicht: t = ${ws(g).faeden.t}`);
  const f = oeffne(g);
  ok(f && f.zaehler === 0, 'ein neuer Faden beginnt bei Zaehler 0');
  for (let i = 0; i < 250; i++) { Chronik.eintragen(g, { art: 'plan', ref: 'p' + i, kurz: 'Eintrag ' + i }); Chronik.eintragen(g, { art: 'plan', ref: 'q' + i, kurz: 'Zweiter ' + i }); g.lageGrenze('szene_ende'); }
  const RING = require('../content/welt/chronik-werte.json').werte.max.wert;
  ok(ws(g).chronik.length === RING && RING < 250, `die Chronik ist ein Ring von ${RING} (500 Eintraege geschrieben), kleiner als die gezaehlten Taetigkeiten`);
  ok(ws(g).faeden.t === 5 + 1 + 250, `der Zaehler zaehlt 250 Grenzen weiter (5 + 1 Notruf-Ausgang + 250), unabhaengig vom Ring: t = ${ws(g).faeden.t}`);
  ok(f.zaehler === 250, `der Zaehler des Fadens: ${f.zaehler}`);
  const c = ws(g).faeden.t;
  for (let i = 0; i < 40; i++) Chronik.eintragen(g, { art: 'plan', ref: 'z' + i, kurz: 'Nur Chronik ' + i });
  ok(ws(g).faeden.t === c, 'Chronik-Eintraege allein (auch die der Funk-Antworten) aendern den Zaehler nie');
});

section('Hooks der Wirklichkeit: Notruf bewaeltigt macht ein Angebot, Szenenende und Andocken zaehlen', () => {
  const t = spiel({ crew: 3, env: { REISE_EREIGNISSE: '1' } }), g = t.g;
  ws(g).zustand.flotten = [];
  const kat = RE.KATALOG; const kopie = kat.slice(); kat.length = 0; kat.push(...kopie.filter((e) => e.id === 'notruf_havarie_reaktor'));
  const alt = RE.WERTE.wahrscheinlichkeit; RE.WERTE.wahrscheinlichkeit = 1;
  try {
    Sprung.springeNach(g, Sektoren.ortVonHex('0305'));
    const R = ws(g).reise; const ort = R.offen[0].hex;
    const t0 = ws(g).faeden.t;
    RE.WERTE.wahrscheinlichkeit = 0;
    ok(ws(g).faeden.angebote.length === 0, 'der angekuendigte Notruf macht noch kein Angebot');
    Sprung.springeNach(g, Sektoren.ortVonHex(ort));
    ok(R.offen.length === 0, 'der Notruf ist beantwortet');
    const a = ws(g).faeden.angebote;
    ok(a.length === 1 && a[0].art === 'notruf' && a[0].hex === ort && a[0].vorlagen.includes('test_geschichte') && a[0].ref === 'notruf_havarie_reaktor', 'ein Angebot: Art, Ort, passende Vorlage, Referenz auf den Katalogeintrag');
    ok(ws(g).faeden.t === t0 + 1, 'der Notruf-Ausgang zaehlt als genau eine Taetigkeit');
    ok(a[0].volk === 'rom', 'das Volk folgt dem Besitzer des Ortes (Roms Raum)');
  } finally { RE.WERTE.wahrscheinlichkeit = alt; kat.length = 0; kat.push(...kopie); }
  const t1 = ws(g).faeden.t;
  g.lageGrenze('szene_ende'); g.lageGrenze('andocken'); g.lageGrenze('absicht');
  ok(ws(g).faeden.t === t1 + 3, 'Szenenende, Andocken und Wahl zaehlen ueber game.lageGrenze');
  // Das Szenenende der Sim ruft denselben Hook
  const t2 = ws(g).faeden.t;
  Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'szene' });
  ok(ws(g).faeden.t === t2 + 1, 'Kriegslage.szeneAbschliessen (Ende einer Sim-Szene) zaehlt eine Taetigkeit');
  ok(g.errors === 0, 'keine Serverfehler');
  // Angebot: Verfall nach gilt_taetigkeiten, hoechstens max
  const h = spiel().g;
  angebot(h); angebot(h); angebot(h);
  ok(h.weltsim.faeden.angebote.length === D.WERTE.angebot.max && h.weltsim.faeden.angebote[0].nr === 2, `hoechstens ${D.WERTE.angebot.max} offene Angebote, das aelteste faellt (Nr ${h.weltsim.faeden.angebote.map((x) => x.nr)})`);
  // Alter selbst gerechnet: Nr 2 ist 1 Taetigkeit alt (das dritte Angebot zaehlte eine), Nr 3 ist frisch; gilt_taetigkeiten = 6
  grenzen(h, D.WERTE.angebot.gilt_taetigkeiten, 'andocken');
  ok(h.weltsim.faeden.angebote.map((x) => x.nr).join() === '3', 'nach 6 Taetigkeiten ist Nr 2 (Alter 7) verfallen, Nr 3 (Alter 6, Grenze inklusive) noch da: ' + h.weltsim.faeden.angebote.map((x) => x.nr));
  grenzen(h, 1, 'andocken');
  ok(h.weltsim.faeden.angebote.length === 0, 'danach verfaellt auch Nr 3');
  const ger = spiel().g;
  ok(Faden.ausgangMitPerson(ger, { art: 'notruf', id: 'g1', hex: '1003', ausgang: 'gelungen' }) === null, 'in germanischem Raum passt die Testvorlage (rom, kon) nicht: kein Angebot');
  ok(Faden.ausgangMitPerson(ger, { art: 'notruf', id: 'g1', hex: '0305', ausgang: 'gescheitert' }) === null, 'ein gescheiterter Ausgang loest die Testvorlage (nur gelungen) nicht aus');
  ok(Faden.ausgangMitPerson(ger, { art: 'handel', id: 'g1', hex: '0305', ausgang: 'gelungen' }) === null, 'eine unbekannte Art loest nichts aus');
  ok(Faden.ausgangMitPerson(ger, null) === null && Faden.ausgangMitPerson(ger, 'x') === null, 'Muell: nichts, kein Wurf');
});

section('Abstand 2 bis 4 ueber viele Taetigkeiten (der Bot versucht es bei JEDER Taetigkeit)', () => {
  const luecken = [];
  let versuche = 0, abgelehnt = 0;
  for (const seed of [7, 21, 33]) {
    const g = spiel({ seed }).g;
    let f = oeffne(g), seit = 0, beats = 0, ende = 0;
    for (let i = 0; i < 400 && beats < 80; i++) {
      grenzen(g, 1); seit++;
      if (f.phase !== 'wartet') continue;
      versuche++;
      const r = weiter(g, f);
      if (!r.ok) { abgelehnt++; if (!/^ABSTAND/.test(r.grund)) throw new Error('unerwarteter Grund ' + r.grund); continue; }
      luecken.push(seit); seit = 0; beats++;
      Faden.beatAusgang(g, f.id, beats % 3 === 0 ? 'gescheitert' : 'gelungen');
      if (f.phase === 'abgeschlossen') { ende++; f = oeffne(g); seit = 0; if (!f) throw new Error('kein neuer Faden'); }
    }
    ok(beats >= 40 && ende >= 5, `Seed ${seed}: ${beats} Beats, ${ende} Faeden zu Ende gespielt`);
  }
  ok(luecken.length >= 120 && luecken.every((l) => l >= 2 && l <= 4), `alle ${luecken.length} Abstaende liegen zwischen 2 und 4 (kleinster ${Math.min(...luecken)}, groesster ${Math.max(...luecken)})`);
  ok([2, 3, 4].every((k) => luecken.includes(k)), 'alle drei Werte 2, 3 und 4 kommen vor (der Abstand wird gezogen, nicht festgelegt): ' + [2, 3, 4].map((k) => k + 'x' + luecken.filter((l) => l === k).length).join(' '));
  ok(abgelehnt > 0 && abgelehnt < versuche, `zu frueh gestellte Beats wurden abgelehnt (${abgelehnt} von ${versuche} Versuchen), die uebrigen angenommen`);
  // eine Vorlage darf verengen
  registriere(alsVorlage('eng', (v) => { v.abstand = { min: 3, max: 3 }; }));
  const g = spiel().g;
  const e = oeffne(g, 'eng'); const l2 = [];
  for (let i = 0; i < 6; i++) { const s = starte(g, e); l2.push(s); if (e.phase === 'abgeschlossen') break; Faden.beatAusgang(g, e.id, 'gelungen'); if (e.phase === 'abgeschlossen') break; }
  ok(l2.length >= 5 && l2.every((x) => x === 3), 'Vorlage mit Abstand 3 bis 3: immer genau 3 Taetigkeiten (' + l2.join(',') + ')');
  D.entferne('eng');
});

section('Obergrenze: hoechstens 3 aktive Faeden', () => {
  for (const id of ['test_b', 'test_c', 'test_d']) registriere(alsVorlage(id));
  const g = spiel().g;
  const f1 = oeffne(g, 'test_geschichte'), f2 = oeffne(g, 'test_b'), f3 = oeffne(g, 'test_c');
  ok(f1 && f2 && f3 && aktive(g).length === 3, 'drei Faeden sind aktiv');
  ok(angebot(g) === null && ws(g).faeden.angebote.length === 0, 'bei voller Obergrenze gibt ein Notruf-Ausgang gar kein Angebot mehr');
  ws(g).faeden.angebote.push({ nr: 99, art: 'notruf', ref: 'alt', hex: '0305', volk: 'rom', vorlagen: ['test_d'], alter: 0 });   // ein Angebot, das schon vor dem dritten Faden da war
  const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'test_d', parameter: { angebot: 99 } });
  ok(!r.ok && /^OBERGRENZE/.test(r.grund) && aktive(g).length === 3 && liste(g).length === 3, 'faden_oeffnen als vierter: abgelehnt (OBERGRENZE), nichts veraendert');
  ok(logbuch(g).some((e) => e.art === 'faden_pruefung' && /OBERGRENZE/.test((e.fehler || []).join(' '))), 'der Fehler steht im Regie-Logbuch');
  pfad(g, f1, ['gelungen', 'gelungen', 'gelungen', 'gelungen', 'gelungen', 'gelungen']);
  ok(f1.phase === 'abgeschlossen' && aktive(g).length === 2, 'ein abgeschlossener Faden zaehlt nicht mehr');
  ws(g).faeden.angebote.push({ nr: 99, art: 'notruf', ref: 'alt', hex: '0305', volk: 'rom', vorlagen: ['test_d'], alter: 0 });   // das alte Angebot ist waehrenddessen verfallen
  const r2 = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'test_d', parameter: { angebot: 99 } });
  ok(r2.ok && aktive(g).length === 3, 'danach geht der Platz wieder: Obergrenze bleibt bei 3');
  ok(liste(g).length === 4, 'der abgeschlossene bleibt im Weltstand (Gedaechtnis), er zaehlt nicht gegen die 3');
  // viele Faeden: nie mehr als faeden_gesamt_max Eintraege, nie mehr als 3 aktive zugleich
  let maxAktiv = 0;
  const h = spiel().g;
  for (let k = 0; k < 40; k++) {
    const a = angebot(h); if (a) Faden.befehlAnwenden(h, { typ: 'faden_oeffnen', vorlage: ['test_geschichte', 'test_b', 'test_c', 'test_d'][k % 4], parameter: { angebot: a.nr } });
    for (const f of aktive(h)) { if (f.phase === 'wartet') weiter(h, f); else if (f.phase === 'laeuft') Faden.beatAusgang(h, f.id, k % 2 ? 'gescheitert' : 'gelungen'); }
    grenzen(h, 1);
    maxAktiv = Math.max(maxAktiv, aktive(h).length);
  }
  ok(maxAktiv === 3, `nie mehr als 3 aktive zugleich, und 3 wurden erreicht (hoechster Stand ${maxAktiv})`);
  ok(liste(h).length <= D.WERTE.faeden_gesamt_max, `hoechstens ${D.WERTE.faeden_gesamt_max} Faeden im Stand (${liste(h).length}), die aeltesten abgeschlossenen fallen zuerst`);
  ok(h.errors === 0, 'keine Serverfehler');
});

section('Beats und Ausgaenge: Scheitern veraendert den Faden, es beendet ihn nicht', () => {
  const g = spiel().g;
  const f = oeffne(g);
  ok(f.phase === 'wartet' && f.beat === 0 && f.nsc.status === 'aktiv' && f.nsc.gedaechtnis.length === 0, 'Start: wartet auf den ersten Beat, NSC aktiv, Gedaechtnis leer');
  ok(starte(g, f) >= 2 && f.phase === 'laeuft' && f.laufend.beat === 'b_bitte' && f.zaehler === 0, 'der erste Beat laeuft, der Zaehler seit dem letzten Beat ist 0');
  ok(f.hinweise.join() === 'h_papiere', 'der Hinweis des Beats ist gestreut (vor der Enthuellung)');
  ok(!weiter(g, f).ok && /^FADEN_BELEGT/.test(weiter(g, f).grund), 'solange ein Beat laeuft, startet kein zweiter (FADEN_BELEGT)');
  Faden.beatAusgang(g, f.id, 'gescheitert');
  ok(f.phase === 'wartet' && f.nsc.status === 'gefangen' && BEATS[f.beat] === 'b_notruf' && f.ausgang === null, 'Scheitern der Bitte: der NSC ist gefangen, der Faden lebt weiter und wartet auf den Notruf (nicht beendet)');
  ok(f.nsc.gedaechtnis.length === 1 && f.nsc.gedaechtnis[0].ereignis === 'bitte_gescheitert' && f.nsc.gedaechtnis[0].text_key === 'b_bitte' && f.nsc.gedaechtnis[0].tick === ws(g).tickZahl, 'das Gedaechtnis hat den Eintrag { tick, ereignis, text_key }');
  ok(aktive(g).includes(f), 'der Faden zaehlt weiter als aktiv');
  pfad(g, f, ['gescheitert']);
  ok(f.nsc.status === 'tot' && BEATS[f.beat] === 'b_ende' && f.phase === 'wartet', 'Scheitern des Notrufs: der NSC ist tot, weiter geht es zum Abschluss');
  const lief = pfad(g, f, ['gelungen']);
  ok(lief.join() === 'b_ende' && f.phase === 'abgeschlossen' && f.ausgang && f.ausgang.art === 'gelungen' && f.ausgang.status === 'tot', 'der Abschluss beendet den Faden mit einem Ausgang; ein toter NSC bleibt tot');
  ok(f.nsc.gedaechtnis.map((x) => x.ereignis).join() === 'bitte_gescheitert,notruf_gescheitert,abschluss_gelungen', 'Gedaechtnis in Reihenfolge: ' + f.nsc.gedaechtnis.map((x) => x.ereignis).join());
  ok(!weiter(g, f).ok && /^FADEN_ABGESCHLOSSEN/.test(Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_ende' }).grund), 'ein abgeschlossener Faden geht nicht weiter');
  // der Weg im Gelingen, mit jedem Beat
  const h = spiel().g, e = oeffne(h);
  const lief2 = pfad(h, e, ['gelungen', 'gelungen', 'gelungen', 'gelungen', 'gelungen']);
  ok(lief2.join() === 'b_bitte,b_spontan,b_enthuell,b_jagd,b_ende' && e.phase === 'abgeschlossen' && e.ausgang.art === 'gelungen' && e.nsc.status === 'gefangen', 'Weg im Gelingen: Bitte, Spontanhilfe, Enthuellung, Verfolgung, Abschluss (Notruf entfaellt)');
  ok(e.nsc.wahrheit.offenbart === true && e.hinweise.length === 1, 'die Wahrheit wurde enthuellt, vorher gab es einen Hinweis');
  // jeder Beat hat zwei Ausgaenge, und nach JEDEM Scheitern lebt der Faden (ausser im Abschluss)
  for (const id of BEATS.slice(0, 5)) {
    const j = spiel().g, q = oeffne(j);
    // zum Beat: gelungen bis dorthin, wo der Weg den Beat enthaelt
    let guard = 0;
    while (BEATS[q.beat] !== id && q.phase !== 'abgeschlossen' && guard++ < 6) pfad(j, q, ['gelungen']);
    if (BEATS[q.beat] !== id) { ok(true, `(${id} liegt nicht auf dem Weg im Gelingen, uebersprungen)`); continue; }
    pfad(j, q, ['gescheitert']);
    ok(q.phase === 'wartet' && q.ausgang === null && q.nsc.gedaechtnis.some((x) => x.ereignis === D.vorlage('test_geschichte').beats[BEATS.indexOf(id)].typ + '_gescheitert'), `Scheitern von ${id}: der Faden lebt weiter (wartet, kein Ausgang) und merkt es sich`);
  }
});

section('Frist, Optionen, Bausteine', () => {
  const g = spiel().g, f = oeffne(g);
  g.lageSpielleiter = { mode: 'mock', disposed: false };   // B-S3: die Frist laeuft nur mit aktivem Lage-Spielleiter
  starte(g, f);
  grenzen(g, D.WERTE.beat_frist - 1, 'andocken');
  ok(f.phase === 'laeuft', `nach ${D.WERTE.beat_frist - 1} Taetigkeiten ohne Ausgang laeuft der Beat noch`);
  grenzen(g, 1, 'andocken');
  ok(f.phase === 'wartet' && f.nsc.status === 'gefangen' && BEATS[f.beat] === 'b_notruf', `nach ${D.WERTE.beat_frist} Taetigkeiten gilt der Beat als gescheitert (nichts blockiert), der Faden lebt weiter`);
  ok(logbuch(g).some((e) => e.art === 'faden_ereignis' && e.ausgang === 'frist'), 'die Frist steht im Regie-Logbuch');
  // B-S3: ohne aktiven Spielleiter laeuft die Frist NICHT ab: der Zaehler zaehlt, der Beat bleibt stehen
  const ohne = spiel().g, o = oeffne(ohne); starte(ohne, o);
  const vorher = JSON.stringify({ phase: o.phase, beat: o.beat, nsc: o.nsc, hinweise: o.hinweise, ausgang: o.ausgang });
  grenzen(ohne, 20, 'andocken');
  ok(o.phase === 'laeuft' && o.laufend && o.laufend.n >= 20 && JSON.stringify({ phase: o.phase, beat: o.beat, nsc: o.nsc, hinweise: o.hinweise, ausgang: o.ausgang }) === vorher, 'ohne Spielleiter: 20 Taetigkeiten, der Beat laeuft weiter, nichts wird gescheitert (der Zaehler zaehlt weiter)');
  ok(!logbuch(ohne).some((e) => e.art === 'faden_ereignis' && e.ausgang === 'frist'), 'ohne Spielleiter steht keine Frist im Regie-Logbuch');
  ohne.lageSpielleiter = { mode: 'mock', disposed: false };
  grenzen(ohne, 1, 'andocken');
  ok(o.phase === 'wartet' && logbuch(ohne).some((e) => e.art === 'faden_ereignis' && e.ausgang === 'frist'), 'Spielleiter wieder da: die Frist greift (der laufende Beat gilt als gescheitert)');
  // Optionen
  const h = spiel().g, q = oeffne(h);
  ok(Faden.optionWaehlen(h, q.id, 'zusagen').ok === false, 'ohne laufenden Beat keine Optionswahl');
  starte(h, q);
  ok(!Faden.optionWaehlen(h, q.id, 'gibt_es_nicht').ok, 'unbekannte Option abgelehnt');
  const rufVor = require('../server/sim/ruf.js').ruf(h, 'rom');
  const r = Faden.optionWaehlen(h, q.id, 'spaeter');
  ok(r.ok && r.ausgang === null && q.phase === 'laeuft' && q.nsc.haltung === 0 && require('../server/sim/ruf.js').ruf(h, 'rom') === rufVor, 'die folgenlose Option aendert nichts (der Beat laeuft weiter)');
  ok(!Faden.optionWaehlen(h, q.id, 'zusagen').ok, 'nur eine Wahl je Beat (schon gewaehlt)');
  const j = spiel().g, p = oeffne(j); starte(j, p);
  const rr = require('../server/sim/ruf.js');
  const r0 = rr.ruf(j, 'rom');
  const z = Faden.optionWaehlen(j, p.id, 'zusagen');
  ok(z.ok && p.nsc.haltung === 1 && rr.ruf(j, 'rom') === r0 + 0.25, 'zusagen: Haltung +1 und Ruf bei Rom +0,25 (beides aus den Daten, ueber den Wirkungen-Katalog)');
  const k = spiel().g, a = oeffne(k); starte(k, a);
  const ab = Faden.optionWaehlen(k, a.id, 'ablehnen');
  ok(ab.ok && ab.ausgang === 'gescheitert' && a.phase === 'wartet' && a.nsc.status === 'gefangen' && a.nsc.haltung === -1, 'ablehnen: Haltung -1, der Beat endet gescheitert, der NSC ist gefangen, der Faden lebt');
  // ein werfender Baustein blockiert nichts
  Bausteine.registriere('bitte', { starten() { throw new Error('Baustein kaputt'); } });
  try {
    const w = spiel().g, x = oeffne(w);
    const fe = w.errors;
    starte(w, x);
    ok(x.phase === 'wartet' && x.nsc.status === 'gefangen' && w.errors === fe + 1, 'ein werfender Baustein: der Beat gilt als gescheitert, der Faden lebt, der Fehler ist gezaehlt');
    ok(logbuch(w).some((e) => e.art === 'faden_ereignis' && e.ausgang === 'baustein_fehler'), 'und im Logbuch');
  } finally { Bausteine.registriere('bitte', Bausteine.platzhalter('bitte')); }
  Bausteine.registriere('bitte', { starten() { return { ausgang: 'gelungen' }; } });
  try {
    const w = spiel().g, x = oeffne(w); starte(w, x);
    ok(x.phase === 'wartet' && x.nsc.status === 'verbuendet' && BEATS[x.beat] === 'b_spontan', 'ein Baustein, der sofort einen Ausgang liefert, beendet den Beat gleich');
  } finally { Bausteine.registriere('bitte', Bausteine.platzhalter('bitte')); }
  ok(Bausteine.istPlatzhalter('bitte'), 'der Platzhalter ist wieder eingesetzt');
});

section('Befehlsregeln einzeln (faden_weiter und faden_oeffnen)', () => {
  const g = spiel().g, f = oeffne(g);
  const W = (o) => Faden.befehlPruefen(g, Object.assign({ typ: 'faden_weiter', faden: f.id, beat: 'b_bitte' }, o || {}), Pruefer.neuerKontext());
  grenzen(g, 4, 'andocken');
  ok(W() === null, 'Grundfall: gueltig (Abstand erreicht, richtiger Beat)');
  ok(/^REIHENFOLGE/.test(W({ beat: 'b_notruf' })) && /^REIHENFOLGE/.test(W({ beat: 'b_ende' })) && /^REIHENFOLGE/.test(W({ beat: 'gibt_es_nicht' })), 'falscher Beat: REIHENFOLGE (nur der naechste Beat der Vorlage)');
  ok(/^FADEN_UNBEKANNT/.test(W({ faden: 'f77' })) && /^FADEN_UNBEKANNT/.test(W({ faden: 5 })), 'unbekannter Faden');
  ok(/^BEFEHL_FELD/.test(W({ extra: 1 })), 'unbekanntes Feld im Befehl');
  const ctx = Pruefer.neuerKontext(); Faden.befehlPruefen(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_bitte' }, ctx);
  ok(/^DOPPELT/.test(Faden.befehlPruefen(g, { typ: 'faden_weiter', faden: f.id, beat: 'b_bitte' }, ctx)), 'derselbe Faden zweimal in einem Plan: DOPPELT');
  f.zaehler = 1;
  ok(/^ABSTAND/.test(W()), 'Zaehler unter dem Abstand: ABSTAND');
  f.zaehler = f.abstand - 1;
  ok(/^ABSTAND/.test(W()) && (f.zaehler = f.abstand, W() === null), 'genau einer zu wenig: abgelehnt; genau der Abstand: erlaubt');
  // Enthuellung ohne Hinweis (Zustand von Hand gesetzt): HINWEIS_FEHLT
  const h = spiel().g, q = oeffne(h);
  q.beat = 3; q.zaehler = 9; q.nsc.status = 'aktiv';
  const E = () => Faden.befehlPruefen(h, { typ: 'faden_weiter', faden: q.id, beat: 'b_enthuell' }, Pruefer.neuerKontext());
  ok(/^HINWEIS_FEHLT/.test(E()), 'Enthuellung ohne gestreuten Hinweis: HINWEIS_FEHLT (auch zur Laufzeit)');
  q.hinweise = ['h_papiere'];
  ok(E() === null, 'mit Hinweis: erlaubt');
  q.nsc.status = 'tot';
  ok(/^STATUS_PASST_NICHT/.test(E()), 'ein toter NSC enthuellt nichts: STATUS_PASST_NICHT');
  q.nsc.status = 'aktiv'; q.nsc.wahrheit = null;
  ok(/^ENTHUELLUNG_OHNE_WAHRHEIT/.test(E()), 'ohne verborgene Wahrheit keine Enthuellung');
  // faden_oeffnen
  const o = spiel().g;
  const O = (b) => Faden.befehlPruefen(o, Object.assign({ typ: 'faden_oeffnen', vorlage: 'test_geschichte' }, b), Pruefer.neuerKontext());
  ok(/^KEIN_ANGEBOT/.test(O()), 'ohne Angebot kein Faden (eine Taetigkeit mit Person muss am Anfang stehen)');
  const a = angebot(o);
  ok(O() === null && O({ parameter: { angebot: a.nr } }) === null, 'mit Angebot gueltig (das erste passende oder per Nummer)');
  ok(/^VORLAGE_UNBEKANNT/.test(O({ vorlage: 'gibt_es_nicht' })) && /^VORLAGE_UNBEKANNT/.test(O({ vorlage: 7 })), 'unbekannte Vorlage');
  ok(/^KEIN_ANGEBOT/.test(O({ parameter: { angebot: 99 } })) && /^KEIN_ANGEBOT/.test(O({ parameter: { angebot: 'x' } })), 'unbekanntes Angebot');
  ok(/^PARAMETER/.test(O({ parameter: { zauber: 1 } })) && /^PARAMETER/.test(O({ parameter: 'x' })) && /^PARAMETER/.test(O({ parameter: { volk: 'ger' } })) && /^PARAMETER/.test(O({ parameter: { ort: 'abcd' } })), 'unbekannter Parameter, Volk ausserhalb der Vorlage, Ort kein Sektor');
  ok(/^NAME/.test(O({ parameter: { name: 'Ein Phantasiename' } })) && /^NAME/.test(O({ parameter: { name: 'Lucius' } })) && /^NAME/.test(O({ parameter: { name: 'Bjarne Eisenwald' } })), 'ein Name muss aus den Datenlisten des Volkes bestehen (nie frei, nie ein anderes Volk)');
  ok(O({ parameter: { name: 'Lucius Varro', volk: 'rom', ort: '0305' } }) === null, 'ein Name aus der Liste ist erlaubt');
  ok(/^BEFEHL_FELD/.test(O({ zusatz: 1 })), 'unbekanntes Feld im Befehl');
  ok(/^BEFEHLE_JE_PLAN/.test((() => { const c = Pruefer.neuerKontext(); for (let i = 0; i < D.WERTE.befehle_je_plan_max; i++) Faden.befehlPruefen(o, { typ: 'faden_oeffnen', vorlage: 'test_geschichte' }, Object.assign(c, { benutzt: new Set(), oeffnen: 0 })); return Faden.befehlPruefen(o, { typ: 'faden_oeffnen', vorlage: 'test_geschichte' }, c); })()), 'hoechstens befehle_je_plan_max Faden-Befehle je Plan');
  const c2 = Pruefer.neuerKontext();
  ok(Faden.befehlPruefen(o, { typ: 'faden_oeffnen', vorlage: 'test_geschichte' }, c2) === null && /^KEIN_ANGEBOT/.test(Faden.befehlPruefen(o, { typ: 'faden_oeffnen', vorlage: 'test_geschichte' }, c2)), 'ein Angebot traegt nur EINEN Faden (im selben Plan verbraucht)');
  ok(o.weltsim.faeden.liste.length === 0, 'die Pruefung allein veraendert nichts (kein Faden entstanden)');
});

section('NSC aus Datenlisten, nie vom Modell', () => {
  const g = spiel().g;
  const namen = new Set(); const nsc = [];
  for (let i = 0; i < 6; i++) {
    if (aktive(g).length >= 3) liste(g).forEach((f) => { f.phase = 'abgeschlossen'; f.beat = 5; f.laufend = null; f.ausgang = { art: 'gelungen', status: 'aktiv', tick: 0 }; });   // Platz schaffen (die NSC bleiben im Stand)
    const a = angebot(g, { id: 'n' + i });
    const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: a.nr } });
    nsc.push(r.faden.nsc); namen.add(r.faden.nsc.name);
  }
  ok(nsc.length === 6 && namen.size === 6, 'sechs NSC, alle Namen verschieden');
  for (const x of nsc) {
    const L = D.NAMEN[x.fraktion]; const [vor, nach] = x.name.split(' ');
    ok(['rom', 'kon'].includes(x.fraktion) && L.vornamen.includes(vor) && L.nachnamen.includes(nach) && L.schiffe.includes(x.schiff) && ['frachter', 'kurier'].includes(x.schiffsklasse) && L.klassen.includes(x.schiffsklasse), `${x.name}: Vor- und Nachname, Schiff „${x.schiff}“ und Klasse ${x.schiffsklasse} stehen in den Listen des Volkes ${x.fraktion} und der Vorlage`);
  }
  ok(nsc.every((x) => Number.isInteger(x.portrait) && x.portrait >= 0 && x.status === 'aktiv' && x.haltung === 0 && x.wahrheit && x.wahrheit.id === 'ist_germane' && x.wahrheit.offenbart === false && x.wahrheit.fraktion === 'ger'), 'Portraet-Seed (Ganzzahl), Status, Haltung 0, verborgene Wahrheit aus der Vorlage');
  ok(new Set(nsc.map((x) => x.id)).size === 6 && nsc.map((x) => x.id).join() === 'n1,n2,n3,n4,n5,n6', 'laufende Nummern n1 bis n6');
  // deterministisch: dieselbe Partie, dieselben NSC
  const h = spiel().g; const a = angebot(h, { id: 'n0' });
  const f2 = Faden.befehlAnwenden(h, { typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: a.nr } }).faden;
  const g2 = spiel().g; const a2 = angebot(g2, { id: 'n0' });
  const f3 = Faden.befehlAnwenden(g2, { typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: a2.nr } }).faden;
  ok(JSON.stringify(f2.nsc) === JSON.stringify(f3.nsc) && f2.abstand === f3.abstand, 'gleicher Weltstand, gleiche Folge: derselbe NSC (eigener, zaehlerbasierter Zufallsstrom)');
  const g3 = spiel({ seed: 33 }).g; const a3 = angebot(g3, { id: 'n0' });
  const f4 = Faden.befehlAnwenden(g3, { typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: a3.nr } }).faden;
  ok(JSON.stringify(f4.nsc) !== JSON.stringify(f2.nsc), 'ein anderer Seed gibt einen anderen NSC');
  // Parameter wirken: Volk, Ort, Name
  const p = spiel().g; const ap = angebot(p);
  const rp = Faden.befehlAnwenden(p, { typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: ap.nr, volk: 'kon', ort: '0504', name: 'Selma Voss' } });
  ok(rp.ok && rp.faden.parameter.volk === 'kon' && rp.faden.parameter.ort === '0504' && rp.faden.nsc.name === 'Selma Voss' && rp.faden.nsc.fraktion === 'kon', 'Parameter Volk, Ort, Name aus dem Befehl (geprueft) gelten');
  // Gedaechtnis hoechstens 12 (die neuesten bleiben)
  const m = spiel().g, f = oeffne(m);
  for (let i = 0; i < 15; i++) { f.phase = 'laeuft'; f.beat = 0; f.laufend = { beat: 'b_bitte', n: 0, seit: i }; ws(m).tickZahl = 100 + i; Faden.beatAusgang(m, f.id, i % 2 ? 'gelungen' : 'gescheitert'); }
  ok(f.nsc.gedaechtnis.length === 12 && f.nsc.gedaechtnis[0].tick === 103 && f.nsc.gedaechtnis[11].tick === 114, `Gedaechtnis hoechstens 12, die aeltesten fallen zuerst (${f.nsc.gedaechtnis[0].tick} bis ${f.nsc.gedaechtnis[11].tick})`);
  ok(Faden.nscVon(m, f.nsc.id) === f.nsc && Faden.nscVon(m, 'n999') === null, 'nscVon findet den NSC ueber die Kennung');
  // ein toter NSC bleibt tot, auch wenn ein Stand etwas anderes will (die Vorlagen lassen das nie zu, der Ablauf schuetzt trotzdem)
  const tot = spiel().g, tf = oeffne(tot);
  tf.nsc.status = 'tot'; tf.phase = 'laeuft'; tf.beat = 0; tf.laufend = { beat: 'b_bitte', n: 0, seit: 0 };
  Faden.beatAusgang(tot, tf.id, 'gelungen');
  ok(tf.nsc.status === 'tot' && tf.phase === 'wartet', 'ein Ausgang, der den Zustand aendern will, macht einen toten NSC nicht wieder lebendig');
});

section('Haltung: Wirkung im Katalog, im Tick, Rollback', () => {
  const g = spiel().g, f = oeffne(g);
  const w = (d, grund, npc) => ({ typ: 'haltung_aenderung', npc: npc || f.nsc.id, delta: d, grund });
  let r = Faden.haltungBuchen(g, [w(2, 'gerettet')]);
  ok(r.ok && r.angewandt === 1 && f.nsc.haltung === 2, 'haltungBuchen: +2');
  r = Faden.haltungBuchen(g, [w(-3, 'verraten'), w(1, 'geholfen', 'n77'), w(9, 'gerettet'), { typ: 'ruf_aenderung' }, null]);
  ok(r.angewandt === 1 && r.verworfen.length === 4 && f.nsc.haltung === -1, 'gueltige gelten, unbekannter NSC, zu grosses delta, falscher Typ und Muell werden verworfen und gemeldet');
  ok(r.verworfen.some((v) => /unbekannter NSC/.test(v.grund)), 'Grund: der NSC steht in keinem Faden');
  ok(logbuch(g).some((e) => e.art === 'faden_pruefung' && e.key === 'haltung_aenderung' && /unbekannter NSC/.test((e.fehler || []).join(' '))), 'verworfene Wirkungen stehen im Regie-Logbuch');
  for (let i = 0; i < 8; i++) Faden.haltungBuchen(g, [w(2, 'gerettet')]);
  ok(f.nsc.haltung === 10, 'Haltung ist auf die Grenze 10 geklemmt');
  for (let i = 0; i < 12; i++) Faden.haltungBuchen(g, [w(-3, 'verraten')]);
  ok(f.nsc.haltung === -10, 'und nach unten auf -10');
  ok(Faden.haltungBuchen({ weltsim: null }, [w(1, 'gerettet')]).ok === false, 'ohne Modus: nichts');
  // im Tick (Szenenende): die Wirkung geht durch den Kern-Filter und wird vom Aufsatz angewandt, die Sim bleibt unberuehrt
  const h = spiel().g, q = oeffne(h);
  const ohne = spiel().g;
  Kriegslage.szeneAbschliessen(ohne, { wirkungen: [], wo: 'szene' });
  const res = Kriegslage.szeneAbschliessen(h, { wirkungen: [{ typ: 'haltung_aenderung', npc: q.nsc.id, delta: 2, grund: 'gerettet' }, { typ: 'haltung_aenderung', npc: 'n42', delta: 1, grund: 'geholfen' }], wo: 'szene' });
  ok(res.ok && q.nsc.haltung === 2, 'im Tick angewandt: Haltung +2 (der unbekannte NSC wird uebergangen, kein Absturz)');
  ok(JSON.stringify(Kriegslage.abbild(ws(h).zustand)) === JSON.stringify(Kriegslage.abbild(ws(ohne).zustand)), 'der Sim-Zustand nach dem Tick ist bitgleich zu einem Tick ohne die Wirkungen');
  ok(h.errors === 0, 'keine Serverfehler');
  // Atom: wirft der Tick, geht die Haltung auf die Sicherung zurueck
  const k = spiel().g, z = oeffne(k);
  const Absicht = require('../server/sim/absicht.js');   // laeuft im Tick NACH dem Anwenden der Haltung: wirft es, muss die schon gebuchte Haltung zurueck
  const alt = Absicht.nachTick; Absicht.nachTick = () => { throw new Error('Tick kaputt'); };
  try { Kriegslage.szeneAbschliessen(k, { wirkungen: [{ typ: 'haltung_aenderung', npc: z.nsc.id, delta: 2, grund: 'gerettet' }], wo: 'szene' }); } finally { Absicht.nachTick = alt; }
  ok(liste(k)[0].nsc.haltung === 0 && k.errors >= 1 && ws(k).tickZahl === 0, 'wirft der Tick nach dem Anwenden, ist die Haltung wieder 0 und der Tick nicht gezaehlt (im selben Atom wie der Ruf)');
  Kriegslage.szeneAbschliessen(k, { wirkungen: [{ typ: 'haltung_aenderung', npc: z.nsc.id, delta: 2, grund: 'gerettet' }], wo: 'szene' });
  ok(liste(k)[0].nsc.haltung === 2, 'danach geht derselbe Tick ohne Wurf durch (Haltung 2)');
});

section('Weltstand: Runde, Altstand, Muell, Obergrenzen', () => {
  for (const id of ['test_b', 'test_c']) registriere(alsVorlage(id));
  const g = spiel().g;
  const f1 = oeffne(g, 'test_geschichte'), f2 = oeffne(g, 'test_b'), f3 = oeffne(g, 'test_c');
  starte(g, f1); Faden.optionWaehlen(g, f1.id, 'zusagen'); Faden.beatAusgang(g, f1.id, 'gelungen');
  starte(g, f2); Faden.optionWaehlen(g, f2.id, 'spaeter');
  grenzen(g, 3, 'szene_ende');
  const data = Weltstand.capture(g);
  const b = data.welt.sim.faeden;
  ok(b && b.liste.length === 3 && b.t === ws(g).faeden.t && b.nr === 3 && b.nsc === 3, `Weltstand-Block: ${b.liste.length} Faeden, t ${b.t}, nr ${b.nr}`);
  ok(Weltstand.validate(data, g).length === 0, 'der Stand ist schemagueltig: ' + Weltstand.validate(data, g).slice(0, 2).join('; '));
  ok(!('angebote' in b) && !('angNr' in b) && !('ladeFehler' in b) && !('gemeldet' in b), 'Laufzeitfelder (Angebote) stehen nicht im Weltstand');
  const sim = JSON.parse(JSON.stringify(data.welt.sim));
  const g2 = spiel().g;
  Kriegslage.restore(g2, sim);
  ok(JSON.stringify(Faden.toSave(ws(g2))) === JSON.stringify(sim.faeden), 'Speichern und Laden ergibt denselben Block (Runde)');
  ok(liste(g2)[0].phase === 'wartet' && liste(g2)[1].phase === 'laeuft' && liste(g2)[1].laufend.gewaehlt === 'spaeter' && liste(g2)[0].nsc.haltung === 2 && ws(g2).faeden.t === b.t, 'Phase, laufender Beat, gewaehlte Option, Haltung (zusagen +1, gedankt +1) und Zaehler ueberleben');
  // das Spiel geht danach genauso weiter
  ok(starte(g2, liste(g2)[0]) !== null, 'nach dem Laden laeuft der Faden weiter');
  // Altstand und Muell
  const alt = JSON.parse(JSON.stringify(sim)); delete alt.faeden;
  Kriegslage.restore(g2, alt);
  ok(liste(g2).length === 0 && ws(g2).faeden.t === 0 && Faden.toSave(ws(g2)) === null, 'Altstand ohne den Block: leer, kein Block beim Speichern');
  const muell = [undefined, null, 'x', 7, [], [1, 2], { liste: 5 }, { liste: [null, 5, 'x', [], {}] }, { t: 'viel', nr: -4, nsc: NaN, liste: {} }, { t: 1e30, nr: 1e30, nsc: 1e30 }];
  for (const m of muell) {
    const s = JSON.parse(JSON.stringify(sim)); s.faeden = m;
    let fehler = null; try { Kriegslage.restore(g2, s); } catch (e) { fehler = e; }
    ok(!fehler && Array.isArray(liste(g2)) && liste(g2).length === 0, 'Muell ' + JSON.stringify(m) + ': leer, kein Wurf');
  }
  ok(ws(g2).faeden.t <= 1e9 && ws(g2).faeden.nr <= 1e9, 'riesige Zaehler werden geklemmt');
  const kaputt = (aendern) => { const s = JSON.parse(JSON.stringify(sim)); aendern(s.faeden.liste); Kriegslage.restore(g2, s); return liste(g2); };
  ok(kaputt((l) => { l[0].vorlage = 'gibt_es_nicht'; }).length === 2 && g2.weltsim.faeden.ladeFehler.some((t) => /Vorlage/.test(t)), 'ein Faden mit unbekannter Vorlage faellt weg (mit Meldung), die anderen bleiben');
  ok(kaputt((l) => { l[0].nsc.name = ''; }).length === 2, 'NSC ohne Namen: der Faden faellt weg');
  ok(kaputt((l) => { l[1].laufend.beat = 'b_ende'; }).length === 2, 'laufender Beat passt nicht zur Vorlage: der Faden faellt weg');
  ok(kaputt((l) => { l[2].id = l[0].id; }).length === 2, 'doppelte Faden-Kennung: der zweite faellt weg');
  ok(kaputt((l) => { l[2].nsc.id = l[0].nsc.id; }).length === 2, 'doppelte NSC-Kennung: der zweite faellt weg');
  ok(kaputt((l) => { l[0].nsc.haltung = 999; l[0].abstand = 99; l[0].zaehler = 1e12; })[0].nsc.haltung === 10 && g2.weltsim.faeden.liste[0].abstand === 4 && g2.weltsim.faeden.liste[0].zaehler === 9999, 'Haltung, Abstand und Zaehler werden geklemmt (10, 4, 9999)');
  ok(kaputt((l) => { l[0].nsc.gedaechtnis = Array.from({ length: 30 }, (_, i) => ({ tick: i, ereignis: 'e_' + 'abcdefghijklmnopqrstuvwxyz'[i % 26], text_key: 'k' })); })[0].nsc.gedaechtnis.length === 12 && kaputt((l) => { l[0].nsc.gedaechtnis = [{ tick: 'x', ereignis: 'E!', text_key: 3 }, 5, null]; })[0].nsc.gedaechtnis.length === 0, 'Gedaechtnis: hoechstens 12, Unbrauchbares faellt weg');
  ok(kaputt((l) => { l[0].nsc.wahrheit = { id: 'ganz_was_anderes', offenbart: true }; l[0].hinweise = []; })[0] === undefined || kaputt((l) => { l[0].nsc.wahrheit = { id: 'ganz_was_anderes', offenbart: true }; l[0].hinweise = []; }).length === 2, 'eine enthuellte Wahrheit ohne jeden Hinweis ist ein unmoeglicher Stand: der Faden faellt weg');
  ok(kaputt((l) => { l[0].nsc.wahrheit = { id: 'ganz_was_anderes', offenbart: false }; })[0].nsc.wahrheit.id === 'ist_germane', 'die Wahrheit gehoert der Vorlage, nicht der Datei');
  ok(kaputt((l) => { l[0].phase = 'abgeschlossen'; l[0].beat = 5; delete l[0].ausgang; })[0].ausgang.art === 'gescheitert', 'ein abgeschlossener Faden ohne Ausgang bekommt einen (kein Faden ohne Ausgang)');
  // Obergrenzen beim Lesen
  for (const id of ['test_d', 'test_e']) registriere(alsVorlage(id));
  const voll = JSON.parse(JSON.stringify(sim));
  for (let i = 0; i < 4; i++) { const c = JSON.parse(JSON.stringify(voll.faeden.liste[0])); c.id = 'f' + (10 + i); c.nsc.id = 'n' + (10 + i); c.nsc.name = 'Julia Fabrin'.replace('Julia', ['Julia', 'Flavia', 'Sabina', 'Octavia'][i]); voll.faeden.liste.push(c); }
  Kriegslage.restore(g2, voll);
  ok(aktive(g2).length === 3 && g2.weltsim.faeden.ladeFehler.some((t) => /mehr als 3 aktive/.test(t)), `eine Datei mit 7 aktiven Faeden wird auf 3 geklemmt (${aktive(g2).length})`);
  const viele = JSON.parse(JSON.stringify(sim));
  for (let i = 0; i < 12; i++) { const c = JSON.parse(JSON.stringify(viele.faeden.liste[0])); c.id = 'f' + (20 + i); c.nsc.id = 'n' + (20 + i); c.phase = 'abgeschlossen'; c.beat = 5; c.laufend = null; c.ausgang = { art: 'gelungen', status: 'aktiv', tick: 1 }; viele.faeden.liste.push(c); }
  Kriegslage.restore(g2, viele);
  ok(liste(g2).length <= D.WERTE.faeden_gesamt_max && aktive(g2).length === 3, `hoechstens ${D.WERTE.faeden_gesamt_max} Faeden, die aktiven bleiben (${liste(g2).length})`);
  ok(ws(g2).faeden.nr >= 31 && ws(g2).faeden.nsc >= 31, 'laufende Nummern liegen ueber der groessten Kennung (keine Doppelvergabe)');
  // Mit abweichender Datei lauft das Spiel weiter, ohne Serverfehler; die Meldungen kommen ins Logbuch
  Kriegslage.restore(g2, voll);
  Faden.zustandVon(g2);
  ok(logbuch(g2).some((e) => e.art === 'faden_pruefung' && e.key === 'weltstand'), 'verworfene Faeden aus dem Stand stehen im Regie-Logbuch');
  ok(g.errors === 0 && g2.errors === 0, 'keine Serverfehler');
});

section('Ausfall des Spielleiters: begonnene Faeden bleiben stehen', () => {
  const g = spiel().g;
  ok(g.lageSpielleiter === null || g.lageSpielleiter === undefined, 'ohne LAGE_SPIELLEITER gibt es keinen Lage-Spielleiter');
  const f = oeffne(g);
  starte(g, f); Faden.beatAusgang(g, f.id, 'gelungen');
  const vorher = JSON.stringify(f);
  const vorTick = ws(g).tickZahl;
  for (let i = 0; i < 40; i++) { g.lageGrenze(['szene_ende', 'andocken', 'absicht'][i % 3]); g.step(); }
  Kriegslage.tick(g, 'test'); Kriegslage.tick(g, 'test');
  const n = JSON.parse(JSON.stringify(f));
  ok(n.phase === 'wartet' && n.beat === f.beat && n.nsc.status === 'verbuendet' && n.zaehler >= 40 && n.zaehler <= 9999, `der Faden steht (wartet), der Zaehler laeuft weiter (${n.zaehler}), kein Beat startet`);
  ok(JSON.stringify(Object.assign({}, n, { zaehler: 0 })) === JSON.stringify(Object.assign({}, JSON.parse(vorher), { zaehler: 0 })), 'sonst ist am Faden nichts anders');
  ok(g.errors === 0 && !logbuch(g).some((e) => e.art === 'faden_pruefung'), 'kein Fehler, kein Eintrag im Logbuch');
  ok(ws(g).tickZahl === vorTick + 2, 'die Welt laeuft weiter (Ticks laufen)');
  ok(ws(g).faeden.angebote.length === 0 && aktive(g).length === 1, 'es kommen weder Angebote noch neue Faeden ohne den Spielleiter');
});

console.log(`\n${n - fails}/${n} Pruefungen ok`);
section('Hinweise zaehlen erst, wenn der Baustein sie bestaetigt (Review B-S1)', () => {
  const H = 'h_papiere';
  // Wurf: der Hinweis zaehlt nicht
  Bausteine.registriere('bitte', { starten() { throw new Error('Baustein wirft'); } });
  try {
    const w = spiel().g, x = oeffne(w); starte(w, x);
    ok(!x.hinweise.includes(H), 'Wurf: der Hinweis des Beats zaehlt nicht (der Baustein hat ihn nie gezeigt)');
  } finally { Bausteine.registriere('bitte', Bausteine.platzhalter('bitte')); }
  // Frist ohne Bestaetigung: der Hinweis zaehlt nicht
  Bausteine.registriere('bitte', { starten() { return { laeuft: true }; } });
  try {
    const w = spiel().g, x = oeffne(w); w.lageSpielleiter = { mode: 'mock', disposed: false }; starte(w, x);
    grenzen(w, D.WERTE.beat_frist, 'andocken');
    ok(x.phase === 'wartet' && !x.hinweise.includes(H), 'Frist ohne Bestaetigung: der Beat ist gescheitert, der Hinweis zaehlt nicht');
  } finally { Bausteine.registriere('bitte', Bausteine.platzhalter('bitte')); }
  // Bestaetigung: der Hinweis zaehlt
  Bausteine.registriere('bitte', { starten(game, faden) { Faden.hinweisGezeigt(game, faden.id, H); return { laeuft: true }; } });
  try {
    const w = spiel().g, x = oeffne(w); starte(w, x);
    ok(x.hinweise.includes(H), 'Bestaetigung durch den Baustein: der Hinweis zaehlt');
    const r = Faden.hinweisGezeigt(w, x.id, 'h_gibt_es_nicht');
    ok(!r.ok && !x.hinweise.includes('h_gibt_es_nicht'), 'ein Hinweis, den der Beat nicht hat, wird nicht bestaetigt');
  } finally { Bausteine.registriere('bitte', Bausteine.platzhalter('bitte')); }
  const z = spiel().g, zz = oeffne(z);
  ok(Faden.hinweisGezeigt(z, zz.id, H).ok === false, 'vor dem Beat: nichts zu bestaetigen');
  ok(Bausteine.istPlatzhalter('bitte'), 'der Platzhalter ist wieder eingesetzt');
});

section('Haltung fuer einen unbekannten NSC im Tick: verworfen, nicht angewandt (Review B-S2)', () => {
  const g = spiel().g, f = oeffne(g); starte(g, f);
  const r = Kriegslage.szeneAbschliessen(g, { wirkungen: [{ typ: 'haltung_aenderung', npc: 'n42', delta: 1, grund: 'geholfen' }, { typ: 'haltung_aenderung', npc: f.nsc.id, delta: 1, grund: 'geholfen' }], wo: 'szene' });
  ok(r.ok && ws(g).letzteWirkungen.angewandt === 1 && f.nsc.haltung === 1, 'im Tick: nur die gueltige Haltung zaehlt als angewandt (1), der unbekannte NSC nicht');
  ok(ws(g).letzteWirkungen.verworfen.some((v) => v.wirkung && v.wirkung.npc === 'n42'), 'der unbekannte NSC steht unter den verworfenen Wirkungen');
  ok(logbuch(g).some((e) => e.art === 'faden_pruefung' && e.key === 'haltung_aenderung' && /unbekannter NSC/.test((e.fehler || []).join(' '))), 'und im Regie-Logbuch');
});

section('Der Leser klemmt die laufenden Nummern (Review B-K2)', () => {
  const F = Faden.lesen({ t: 1, nr: 1e9, nsc: 1e9, liste: [] });
  ok(F.nr === 999999 && F.nsc === 999999, `Zaehler nr und nsc werden auf 999999 geklemmt (nr ${F.nr}, nsc ${F.nsc})`);
});

section('Jeder Zustand einer gueltigen Vorlage ist schemagueltig (Review B-M1)', () => {
  const g = spiel().g, f = oeffne(g);
  for (const a of ['gelungen', 'gescheitert']) {
    if (!f) break;
    starte(g, f); Faden.beatAusgang(g, f.id, a);
    const data = Weltstand.capture(g);
    ok(Weltstand.validate(data, g).length === 0, `nach dem Ausgang ${a}: der Stand besteht das Weltstand-Schema (${Weltstand.validate(data, g).slice(0, 1).join('')})`);
  }
});

console.log(`\n${n - fails}/${n} Pruefungen ok`);
if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
console.log('FADEN-ZUSTAND OK');