'use strict';
// SPL-02 F: Rueckfall der Anschluss-Garantie ueber denselben Inszenierer (server/sim/abenteuer-rueckfall.js, Anbindung in abenteuer-brett.js anschluss, Daten content/faeden/absichten.json werte rueckfall_*).
// Kein Netz, kein Modell. Die Erwartungen stehen hier selbst (Welt-Lagen aus eigenen Fixtures, Zahlen aus der Abnahme 7 des Auftrags), nie aus dem Produktivcode abgeleitet. Geprueft wird:
// Schalter aus: der Rueckfall bleibt anschluss.json (Plaene aus der Datei, kein Eintrag mit Absicht im Logbuch, dieselbe Folge wie ohne Schalter) · Schalter an: Absicht nach Lage (nie Sabotage ohne Posten, nie Wiedersehen
// ohne Kandidat, Bezug aus den Kandidaten, ein Nein der Inszenierung schliesst eine Absicht aus, die zuletzt gewaehlte Absicht wird uebersprungen, deterministisch, Gewichte aus den Daten) · letzte Stufe: ohne gueltiges
// Ergebnis gilt anschluss.json (die Garantie bleibt unbedingt) · Wiederholungsregeln greifen weiter · Abnahme 7 Vielfalt (10 Rueckfaelle nacheinander, jeder besteht den Pruefer, mindestens 8 verschiedene Beat-Folgen,
// mehrere Welt-Lagen, Messung gegen die Baseline mit anschluss.json) · Quelltext ohne Absichts- und Beat-Namen.
// Aufruf: node tools/test-abenteuer-rueckfall.js [begriff ...]        (npm run test:abenteuer-rueckfall)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const BP = require('../server/sim/faden-bauplan.js');
const AP = require('../server/sim/absicht-pruefer.js');
const RF = require('../server/sim/abenteuer-rueckfall.js');
const Kanon = require('../server/sim/abenteuer-kanon.js');

const { D, Faden, F } = X;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const abschnitte = [];
const section = (name, fn) => abschnitte.push([name, fn]);
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const klon = (x) => JSON.parse(JSON.stringify(x));
const ANS = lies('content/faeden/anschluss.json');
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const KAT = AP.katalogStandard();
const KAT_STAND = Object.entries(KAT.absichten).filter(([, e]) => e.standard).map(([k]) => k);

// ---------------------------------------------------------------- Welt
// Spiel mit Lage-Spielleiter (Mock, still), Rueckfall zunaechst aus; absichten: Schalter ABENTEUER_ABSICHTEN ('1' | '0' | undefined)
function neu(seed, absichten) {
  const t = F.neuesSpiel({ crew: 3, seed: seed || 11, names: NAMEN, env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  const llm = LLM.create({ mode: 'mock' });
  t.g.lageSpielleiter = LS.create(t.g, { llm, werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  t.g.mission.missions.sl_forschung = { state: 'done', ausgang: 'erfolg' };   // SON-01 C: Helix (siebter Plan in anschluss.json) ist in dieser Welt schon gelungen und wird nie angeboten: dieser Test zaehlt die sechs aelteren Plaene (Helix: tools/test-sondersektor-angebot.js)
  t.c = t.cs[0];
  t.an = (id) => { t.g.handleMessage(t.c, { t: 'cmd', c: 'abenteuer.annehmen', id }); const a = t.c.inbox.filter((m) => m.t === 'event' && m.kind === 'abenteuerAntwort'); return a[a.length - 1]; };
  t.g.env.ABENTEUER_ABSICHTEN = absichten;
  if (absichten === undefined) delete t.g.env.ABENTEUER_ABSICHTEN;
  return t;
}
const an = (t) => { delete t.g.env.ABENTEUER_ANSCHLUSS; return t; };   // der Rueckfall gilt ab jetzt
const zust = (g) => Faden.zustandVon(g);
const offen = (g) => zust(g).abenteuerAngebote;
const liste = (g) => g.weltsim.faeden.liste;
const wipe = (g) => { zust(g).abenteuerAngebote.length = 0; };
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const rangAb = (id) => lies('content/welt/ruf-werte.json').werte.raenge.wert.find((r) => r.id === id).ab;
function postenSetzen(g, hex, besitzer) {
  Object.assign(g.weltsim.zustand.hexe[hex], { besitzer, posten: true, garnison: 4, anspruch: {} });
  if (g.weltBesitz && g.weltBesitz.hexe[hex]) g.weltBesitz.hexe[hex] = { besitzer: { rom: 'rom', ger: 'ger', kon: 'saum' }[besitzer] || 'frei', posten: true };
}
function beende(g, f, ausgang) {   // ein Abenteuer ueber die echten Ausgaenge zu Ende bringen (der Anschluss danach laeuft ueber beiEnde)
  const v = D.vorlage(f.vorlage);
  for (let i = f.beat; i < v.beats.length && f.phase !== 'abgeschlossen'; i++) {
    f.beat = i; f.phase = 'laeuft'; f.laufend = { beat: v.beats[i].id, n: 0, seit: 0 };
    Faden.beatAusgang(g, f.id, ausgang);
  }
}
const folgeVon = (a) => Kanon.typenVon(a.vorlage).join('>');
// woher das Angebot kam: das Logbuch des Rueckfalls (der Plan einer Absicht kann derselbe sein wie der aus anschluss.json, gleiche Plan-Id)
const quelleVon = (g, a) => { const e = logbuch(g).filter((x) => x.art === 'abenteuer_anschluss' && x.plan && x.plan.angebot === a.nr).pop(); return e && e.modus === 'rueckfall' ? 'absicht' : 'datei'; };
// n Rueckfaelle nacheinander: das Angebot nehmen (ueber den Befehl), zu Ende spielen, das naechste Angebot kommt ueber beiEnde
function kette(t, k) {
  const g = t.g, out = [];
  wipe(g);
  let a = Brett.anschluss(g);
  for (let i = 0; i < k && a; i++) {
    out.push({ nr: a.nr, ref: a.ref, folge: folgeVon(a), hex: a.hex, bezug: a.bezug ? a.bezug.nsc : null, quelle: quelleVon(g, a) });
    const r = t.an('a' + a.nr), f = liste(g).filter((x) => x.plan && x.vorlage === a.ref).pop();   // BEA-03 C: der JUENGSTE Faden dieses Plans (derselbe Plan kehrt wieder: find() griff den alten, schon beendeten)
    if (!r || !r.ok || !f) { out.push({ fehler: r && r.code }); break; }
    beende(g, f, 'gelungen');
    a = offen(g)[0] || null;
  }
  return out;
}
const spielen = (t, typ, i) => {   // ein Abenteuer mit Person (Notruf) spielen: danach gibt es einen Kandidaten fuer ein Wiedersehen
  const p = { format: 'faden-bauplan/1', titel: 'Probe Auftrag ' + i, anlass: 'Probeanlass Nummer ' + i + ' ohne Namen fuer den Test', beats: [{ typ }, { typ: 'abschluss' }] };
  const a = Faden.abenteuerAnbieten(t.g, p, { hex: '0305' });
  const r = t.an('a' + a.angebot.nr), f = liste(t.g).find((x) => x.plan && x.vorlage === a.angebot.ref);
  if (!r || !r.ok || !f) throw new Error('Vorgeschichte nicht spielbar');
  beende(t.g, f, 'gelungen');
  wipe(t.g);
  return f;
};
// Welt-Lagen (jede ein eigener Aufbau, Zustand vor dem ersten Rueckfall)
const LAGEN = {
  'leer (kein Posten, keine Geschichte)': (t) => t,
  'Posten bei 0703 und Rang (Sabotage moeglich)': (t) => { postenSetzen(t.g, '0703', 'ger'); t.g.weltsim.ruf.rom = rangAb('miles'); return t; },
  'zwei fruehere Abenteuer (Wiedersehen moeglich)': (t) => { spielen(t, 'notruf', 1); spielen(t, 'notruf', 2); return t; },
  'Posten, Rang und Geschichte': (t) => { postenSetzen(t.g, '0703', 'ger'); t.g.weltsim.ruf.rom = rangAb('miles'); spielen(t, 'notruf', 1); spielen(t, 'notruf', 2); return t; },
};
const lage = (name, seed, absichten) => an(LAGEN[name](neu(seed, absichten)));
const verschieden = (l) => new Set(l.map((x) => x.folge)).size;

// ======================================================================
section('Daten: Gewichte und Grenzen aus absichten.json, Kandidaten aus dem Katalog', () => {
  ok(RF.werteFehler().length === 0, 'die Werte rueckfall_* sind stimmig' + RF.werteFehler().map((x) => ' ' + x).join(''));
  const w = (k) => KAT.werte[k].wert;
  ok(w('rueckfall_gewicht_ohne_wendung') === 1 && w('rueckfall_gewicht_mit_wendung') === 2 && w('rueckfall_versuche_max') >= KAT_STAND.length && typeof w('rueckfall_neue_folge_zuerst') === 'boolean', 'Datenwerte da (Gewichte 1 und 2, Versuche, neue Folge zuerst)');
  ok(Object.values(KAT.werte).every((x) => 'wert' in x && typeof x.einheit === 'string' && typeof x._hinweis === 'string'), 'werte-Konvention: je Eintrag wert, einheit, _hinweis');
  const k = RF.kandidaten();
  const erwartet = KAT_STAND.reduce((s, name) => s + KAT.absichten[name].wendungen.length, 0);
  ok(k.length === erwartet && k.length >= 12, 'jede Absicht mit standard ist mit jeder Wendung ein Kandidat (' + k.length + ' von ' + KAT_STAND.length + ' Absichten)');
  ok(k.every((x) => KAT_STAND.includes(x.absicht) && KAT.absichten[x.absicht].wendungen.includes(x.wendung) && x.gewicht === (x.wendung === 'keine' ? 1 : 2)), 'Gewicht ohne Wendung 1, mit Wendung 2, nur Absichten mit standard');
  const kat0 = klon(KAT); kat0.werte.rueckfall_gewicht_mit_wendung.wert = 0;
  ok(RF.kandidaten(kat0).every((x) => x.wendung === 'keine') && RF.kandidaten(kat0).length === KAT_STAND.length, 'Gewicht 0 schliesst die Kandidaten mit Wendung aus');
  const kat1 = klon(KAT); kat1.werte.rueckfall_gewicht_ohne_wendung.wert = 0; kat1.werte.rueckfall_gewicht_mit_wendung.wert = 0;
  ok(RF.werteFehler(kat1).length === 1 && RF.kandidaten(kat1).length === 0, 'ohne Kandidat meldet werteFehler');
  const kat2 = klon(KAT); delete kat2.werte.rueckfall_versuche_max; kat2.werte.rueckfall_gewicht_mit_wendung.wert = -1; kat2.werte.rueckfall_neue_folge_zuerst.wert = 'ja';
  ok(RF.werteFehler(kat2).length >= 3, 'fehlende oder falsche Werte werden gemeldet (' + RF.werteFehler(kat2).length + ')');
  const a = RF.absichtVon(KAT, 'geruecht', 'falle');
  ok(a.format === 'absicht/1' && a.absicht === 'geruecht' && a.bogen.wendung === 'falle' && a.titel === KAT.absichten.geruecht.standard.titel && a.ton === 'nuechtern' && Object.keys(a.bezug).length === 0, 'absichtVon: Standard-Parametrierung mit Wendung, ohne Bezug');
  ok(RF.absichtVon(KAT, 'wiedersehen', 'keine', 'Quintus Varro').bezug.nsc === 'Quintus Varro', 'absichtVon mit Bezug');
  ok(AP.katalogFehler().length === 0, 'der Katalog besteht seine Strukturpruefung weiter');
});

section('Reihenfolge: gewichtet gezogen, deterministisch, die letzte Absicht steht hinten', () => {
  const re = require('../server/sim/reise-ereignis.js');
  const strom = (n) => re.strom(7, n, 'probe');
  const a = RF.reihenfolge(KAT, strom(1)), b = RF.reihenfolge(KAT, strom(1)), c = RF.reihenfolge(KAT, strom(2));
  ok(JSON.stringify(a) === JSON.stringify(b), 'gleicher Strom, gleiche Reihenfolge');
  ok(JSON.stringify(a) !== JSON.stringify(c), 'anderer Strom, andere Reihenfolge');
  ok(a.length === RF.kandidaten().length && new Set(a.map((x) => x.absicht + '/' + x.wendung)).size === a.length, 'jeder Kandidat genau einmal');
  const h = RF.reihenfolge(KAT, strom(3), 'spur'), erst = h.findIndex((x) => x.absicht === 'spur');
  ok(erst === h.length - KAT.absichten.spur.wendungen.length && h.slice(erst).every((x) => x.absicht === 'spur'), 'die Kandidaten der letzten Absicht stehen hinten');
  // Gewicht: mit Wendung (2) kommt im Mittel vor ohne (1)
  let vorn = 0, gesamt = 0;
  for (let i = 1; i <= 300; i++) { const l = RF.reihenfolge(KAT, strom(i)); if (l[0].wendung !== 'keine') vorn++; gesamt++; }
  const anteil = RF.kandidaten().filter((x) => x.wendung !== 'keine').length * 2 / (RF.kandidaten().filter((x) => x.wendung !== 'keine').length * 2 + RF.kandidaten().filter((x) => x.wendung === 'keine').length);
  ok(Math.abs(vorn / gesamt - anteil) < 0.1, 'der erste Kandidat hat in ' + Math.round(100 * vorn / gesamt) + ' % eine Wendung (erwartet ' + Math.round(100 * anteil) + ' %)');
});

section('Schalter aus: der Rueckfall bleibt anschluss.json, Verhalten wie vorher', () => {
  for (const wert of [undefined, '0', 'off', '']) {
    const t = an(neu(31, wert)), g = t.g;
    const r = kette(t, 6);
    ok(r.length === 6 && r.every((x) => x.quelle === 'datei'), 'ABENTEUER_ABSICHTEN=' + JSON.stringify(wert) + ': sechs Rueckfaelle, alle aus anschluss.json');
    ok(!logbuch(g).some((e) => e.art === 'abenteuer_anschluss' && (e.modus !== undefined || e.absicht !== undefined)), '  Logbuch: kein modus und keine absicht am Eintrag abenteuer_anschluss');
    ok(logbuch(g).filter((e) => e.art === 'abenteuer_anschluss').every((e) => e.plan && Number.isInteger(e.plan.wahl)), '  Logbuch wie vorher (plan.wahl)');
  }
  const f = (w) => kette(an(neu(32, w)), 8).map((x) => x.ref).join();
  ok(f(undefined) === f('0') && f('0') === f('off'), 'dieselbe Folge von Plaenen ohne Schalter, mit 0 und mit off');
  ok(f(undefined) === f(undefined), 'deterministisch');
});

section('Schalter an: Absicht nach Lage statt Plan aus der Datei', () => {
  const t = lage('leer (kein Posten, keine Geschichte)', 41, '1'), g = t.g;
  const r = kette(t, 5);
  ok(r.length === 5 && r.every((x) => x.quelle === 'absicht'), 'fuenf Rueckfaelle, alle ueber den Inszenierer (nicht aus der Datei)');
  const lb = logbuch(g).filter((e) => e.art === 'abenteuer_anschluss' && e.ausgang === 'angeboten');
  ok(lb.length >= 5 && lb.every((e) => e.modus === 'rueckfall' && KAT_STAND.includes(e.absicht) && e.bezug_art === 'keiner'), 'Logbuch: modus rueckfall, absicht = eine Absicht mit standard, bezug_art keiner (' + lb.length + ' Eintraege)');
  const text = JSON.stringify(lb);
  ok(!NAMEN.some((x) => text.includes(x)) && !r.some((x) => text.includes(D.vorlage(x.ref).titel)), 'Logbuch ohne Spielernamen und ohne Titel');
  ok(g.errors === 0 && !logbuch(g).some((e) => e.art === 'faden_pruefung' && e.ausgang === 'abgelehnt'), 'keine Serverfehler, kein vom Brett abgelehnter Plan');
  // jeder Plan besteht den Pruefer: das Angebot kam ueber Expander und Pruefer (abenteuerAnbieten), seine Vorlage steht im Register
  ok(r.every((x) => !!D.vorlage(x.ref)), 'die Vorlagen der Angebote stehen im Register (Expander und Pruefer haben sie angenommen)');
});

section('Nach Lage: Sabotage nur mit Ziel, Wiedersehen nur mit Kandidat, der Bezug kommt aus den Kandidaten', () => {
  const bare = new Set(), mit = new Set(), geschichte = new Set();
  for (let seed = 200; seed < 240; seed++) {
    for (const x of kette(lage('leer (kein Posten, keine Geschichte)', seed, '1'), 1)) bare.add(x.folge.split('>')[0]);   // nur der erste Rueckfall: danach hat die Crew eine Geschichte
    for (const x of kette(lage('Posten bei 0703 und Rang (Sabotage moeglich)', seed, '1'), 1)) mit.add(x.folge.split('>')[0]);
  }
  ok(bare.size >= 3 && !bare.has('sabotage') && !bare.has('wiedersehen'), 'ohne Ziel und Kandidat: nie Sabotage, nie Wiedersehen (' + [...bare].join(', ') + ')');
  ok(mit.has('sabotage') && !mit.has('wiedersehen'), 'mit Posten und Rang: Sabotage kommt vor, Wiedersehen weiter nicht (' + [...mit].join(', ') + ')');
  let mitBezug = 0, ohneName = 0, gesamt = 0, falsch = 0;
  for (let seed = 300; seed < 316; seed++) {
    const t = lage('zwei fruehere Abenteuer (Wiedersehen moeglich)', seed, '1'), g = t.g;
    const ks = kette(t, 6), namen = zust(g).kanon.map((e) => e.name);
    for (const x of ks) {
      geschichte.add(x.folge.split('>')[0]);
      if (x.folge.split('>')[0] !== 'wiedersehen') continue;
      gesamt++;
      if (x.bezug) { mitBezug++; if (!namen.includes(x.bezug)) falsch++; } else ohneName++;
    }
  }
  ok(geschichte.has('wiedersehen'), 'mit Kandidaten: Wiedersehen kommt vor (' + [...geschichte].join(', ') + ')');
  ok(gesamt > 0 && mitBezug === gesamt && falsch === 0, 'jedes Wiedersehen traegt einen Bezug, und der ist ein NSC der Geschichte (' + mitBezug + ' von ' + gesamt + ', ' + falsch + ' unbekannte)');
  const t = lage('zwei fruehere Abenteuer (Wiedersehen moeglich)', 301, '1');
  const w = kette(t, 8).find((x) => x.bezug);
  if (w) {
    const lb = logbuch(t.g).filter((e) => e.art === 'abenteuer_anschluss' && e.bezug_art === 'nsc');
    ok(lb.length >= 1 && !lb.some((e) => JSON.stringify(e).includes(w.bezug)), 'Logbuch: bezug_art nsc, nie der Name des NSC');
  } else ok(false, 'ein Wiedersehen mit Bezug entsteht');
});

section('Weltbedingungen: eine Absicht, deren Inszenierung ein Nein ergibt, wird nicht gewaehlt', () => {
  const e = KAT.absichten.geruecht, alt = e.inszenierung.nicht_ausdrueckbar;
  try {
    e.inszenierung.nicht_ausdrueckbar = [{ wenn: { immer: true }, grund: 'Probe: im Test nicht ausdrueckbar' }];
    const typen = new Set();
    for (let seed = 500; seed < 512; seed++) for (const x of kette(lage('leer (kein Posten, keine Geschichte)', seed, '1'), 4)) typen.add(x.folge.split('>')[0]);
    ok(typen.size >= 2 && !typen.has('geruecht'), 'geruecht ergibt ein Nein (NICHT_AUSDRUECKBAR): nie gewaehlt, die anderen schon (' + [...typen].join(', ') + ')');
  } finally { if (alt === undefined) delete e.inszenierung.nicht_ausdrueckbar; else e.inszenierung.nicht_ausdrueckbar = alt; }
  // Rang: eine Weltbedingung (Rang mindestens) schliesst aus, solange der Rang fehlt
  const k = KAT.absichten.konvoi, alt2 = k.inszenierung.bedingungen;
  try {
    k.inszenierung.bedingungen = [{ art: 'rang_mindestens', rang: 'imperator', grund: 'Probe' }];
    const typen = new Set();
    for (let seed = 520; seed < 532; seed++) for (const x of kette(lage('leer (kein Posten, keine Geschichte)', seed, '1'), 4)) typen.add(x.folge.split('>')[0]);
    ok(!typen.has('konvoi') && typen.size >= 2, 'konvoi mit unerreichtem Rang (Weltbedingung): nie gewaehlt (' + [...typen].join(', ') + ')');
  } finally { if (alt2 === undefined) delete k.inszenierung.bedingungen; else k.inszenierung.bedingungen = alt2; }
  ok(AP.katalogFehler().length === 0 && require('../server/sim/inszenierer.js').katalogFehler().length === 0, 'der Katalog ist nach dem Test wieder wie vorher');
});

section('Sperren: die zuletzt gewaehlte Absicht wird uebersprungen, abgelehnte nicht sofort wieder, Wiederholungsregeln greifen', () => {
  const t = lage('Posten, Rang und Geschichte', 61, '1'), g = t.g;
  const r = kette(t, 10);
  const absichten = logbuch(g).filter((e) => e.art === 'abenteuer_anschluss' && e.modus === 'rueckfall').map((e) => e.absicht);
  let gleich = 0; for (let i = 1; i < absichten.length; i++) if (absichten[i] === absichten[i - 1]) gleich++;
  ok(absichten.length >= 10 && gleich === 0, 'nie dieselbe Absicht zweimal hintereinander (' + absichten.slice(0, 10).join(' > ') + ')');
  let folgeGleich = 0; for (let i = 0; i < r.length; i++) for (let j = Math.max(0, i - 3); j < i; j++) if (r[i].folge === r[j].folge) folgeGleich++;
  ok(r.length === 10 && folgeGleich === 0, 'keine Typenfolge wiederholt sich innerhalb der letzten drei (folge_zuletzt): ' + folgeGleich + ' Verstoesse');
  // ablehnen: nicht sofort wieder derselbe Plan
  const t2 = lage('leer (kein Posten, keine Geschichte)', 62, '1'), g2 = t2.g;
  wipe(g2); let a = Brett.anschluss(g2); const refs = [];
  for (let i = 0; i < 12 && a; i++) { refs.push(a.ref); t2.g.handleMessage(t2.c, { t: 'cmd', c: 'abenteuer.ablehnen', id: 'a' + a.nr }); Brett.beiTaetigkeit(g2); a = offen(g2)[0]; }
  let doppelt = 0; for (let i = 1; i < refs.length; i++) if (refs[i] === refs[i - 1]) doppelt++;
  ok(refs.length === 12 && doppelt === 0 && new Set(refs).size >= 5, 'zwoelfmal abgelehnt: immer ein Angebot, nie derselbe Plan hintereinander (' + new Set(refs).size + ' verschiedene)');
  // zuletzt gespielt: dieser Plan wird nicht gewaehlt, solange ein anderer passt
  let verstoss = 0, gezogen = 0;
  for (let seed = 70; seed < 82; seed++) {
    const tt = lage('leer (kein Posten, keine Geschichte)', seed, '1'); wipe(tt.g);
    const x = Brett.anschluss(tt.g); if (!x) continue;
    zust(tt.g).abenteuerZuletzt = x.ref; wipe(tt.g); zust(tt.g).angNr = x.nr;
    const y = Brett.anschluss(tt.g); gezogen++; if (!y || y.ref === x.ref) verstoss++;
  }
  ok(gezogen >= 10 && verstoss === 0, 'der zuletzt gespielte Plan wird nie wieder angeboten (' + gezogen + ' Ziehungen)');
});

section('Deterministisch: gleicher Seed und Zustand, gleiche Folge; anderer Zaehler, andere Wahl', () => {
  const f = (seed) => kette(lage('Posten, Rang und Geschichte', seed, '1'), 8).map((x) => x.ref).join();
  ok(f(91) === f(91) && f(91).split(',').length === 8, 'gleicher Seed, gleiche Folge');
  const gesehen = new Set();
  const t = lage('leer (kein Posten, keine Geschichte)', 92, '1');
  for (let k = 1; k <= 20; k++) { zust(t.g).angNr = k; wipe(t.g); const x = Brett.anschluss(t.g); if (x) gesehen.add(x.ref); }
  ok(gesehen.size >= 4, 'derselbe Zustand, anderer Zaehler der Angebote: verschiedene Plaene (' + gesehen.size + ' von 20)');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'abenteuer-rueckfall.js'), 'utf8').split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n');
  ok(!/Math\.random/.test(src), 'kein Math.random im Rueckfall');
});

section('Letzte Stufe: ohne gueltige Absicht gilt anschluss.json (die Garantie bleibt unbedingt)', () => {
  const alle = KAT_STAND.map((name) => KAT.absichten[name]), alt = alle.map((e) => e.inszenierung.nicht_ausdrueckbar);
  try {
    for (const e of alle) e.inszenierung.nicht_ausdrueckbar = [{ wenn: { immer: true }, grund: 'Probe: nichts ist ausdrueckbar' }];
    const t = lage('leer (kein Posten, keine Geschichte)', 101, '1'), g = t.g;
    const r = kette(t, 4);
    ok(r.length === 4 && r.every((x) => x.quelle === 'datei'), 'jede Absicht ergibt ein Nein: vier Rueckfaelle, alle aus anschluss.json');
    const lb = logbuch(g).filter((e) => e.art === 'abenteuer_anschluss');
    ok(lb.length >= 4 && lb.every((e) => e.modus === undefined && Number.isInteger(e.plan.wahl)), 'Logbuch wie beim alten Rueckfall');
    ok(g.errors === 0, 'keine Serverfehler');
  } finally { KAT_STAND.forEach((name, i) => { if (alt[i] === undefined) delete KAT.absichten[name].inszenierung.nicht_ausdrueckbar; else KAT.absichten[name].inszenierung.nicht_ausdrueckbar = alt[i]; }); }
  // versuche_max 1 und nur ein Kandidat probiert: findet er nichts, gilt die Datei
  const w = KAT.werte.rueckfall_versuche_max.wert;
  try {
    KAT.werte.rueckfall_versuche_max.wert = 1;
    let datei = 0, absicht = 0;
    for (let seed = 110; seed < 122; seed++) for (const x of kette(lage('leer (kein Posten, keine Geschichte)', seed, '1'), 3)) { if (x.quelle === 'datei') datei++; else absicht++; }
    ok(datei + absicht === 36 && absicht > 0, 'mit nur einem Versuch je Aufruf bleibt das Brett nie leer (' + absicht + ' Absicht, ' + datei + ' Datei)');
  } finally { KAT.werte.rueckfall_versuche_max.wert = w; }
});

section('Abnahme 7: Vielfalt, 10 Rueckfaelle nacheinander, mindestens 8 verschiedene Beat-Folgen', () => {
  const tab = [];
  for (const name of Object.keys(LAGEN)) {
    const sehr = [];
    for (const seed of [11, 12, 13]) {
      const neuRes = kette(lage(name, 700 + seed, '1'), 10), alt = kette(lage(name, 700 + seed, '0'), 10);
      ok(neuRes.length === 10 && neuRes.every((x) => x.quelle === 'absicht' && !x.fehler), name + ' (Seed ' + seed + '): zehn Rueckfaelle, jeder ueber Inszenierer, Expander und Pruefer');
      ok(verschieden(neuRes) >= 8, '  mindestens 8 verschiedene Beat-Folgen (' + verschieden(neuRes) + ' in 10)');
      ok(verschieden(neuRes) >= verschieden(alt), '  mindestens so gut wie die Baseline mit anschluss.json (' + verschieden(neuRes) + ' gegen ' + verschieden(alt) + ')');
      sehr.push([verschieden(neuRes), verschieden(alt)]);
    }
    tab.push(name + ': Absichten ' + sehr.map((x) => x[0]).join('/') + ', Baseline anschluss.json ' + sehr.map((x) => x[1]).join('/'));
  }
  for (const z of tab) info(z);
  const k0 = KAT.werte.rueckfall_neue_folge_zuerst.wert;
  try {
    KAT.werte.rueckfall_neue_folge_zuerst.wert = false;
    const gez = Object.keys(LAGEN).map((name) => [11, 12, 13].map((seed) => verschieden(kette(lage(name, 700 + seed, '1'), 10))).join('/'));
    info('nur gewichtet gezogen (rueckfall_neue_folge_zuerst false): ' + Object.keys(LAGEN).map((name, i) => name.split(' ')[0] + ' ' + gez[i]).join('; '));
  } finally { KAT.werte.rueckfall_neue_folge_zuerst.wert = k0; }
  ok(ANS.plaene.length === 8, 'die Baseline kann mit acht Plaenen hoechstens acht verschiedene Folgen liefern (SON-01 C: der siebte ist Helix, BEA-03 C: der achte der Hinterhalt)');
});

section('Quelltext: kein Absichts-, Beat- oder Wendungsname im Code, keine Zahl ab zwei Stellen', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'abenteuer-rueckfall.js'), 'utf8');
  const code = s.split('\n').filter((z) => !/^\s*\/\//.test(z)).join('\n').replace(/\/\/.*$/gm, '');
  const namen = Object.keys(KAT.absichten).concat(Object.keys(D.BEATS), [].concat(...Object.values(KAT.absichten).map((e) => e.wendungen || [])).filter((w) => w !== 'keine'));
  const treffer = namen.filter((w, i) => namen.indexOf(w) === i && new RegExp('[\'"`]' + w + '[\'"`]').test(code));
  ok(treffer.length === 0, 'kein Absichts-, Beat- oder Wendungsname als Zeichenkette in abenteuer-rueckfall.js' + (treffer.length ? ' (' + treffer.join(', ') + ')' : ''));
  const zahlen = code.match(/[^\w."'-](\d{2,})[^\w"']/g) || [];
  ok(zahlen.length === 0, 'keine Zahl ab zwei Stellen im Code' + (zahlen.length ? ' (' + zahlen.join(' ') + ')' : ''));
  const b = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'abenteuer-brett.js'), 'utf8');
  ok(b.includes('Rueckfall().aktiv(game)') && b.indexOf('Rueckfall().aktiv(game)') < b.indexOf('D.ANSCHLUSS.plaene.filter'), 'das Brett fragt den Schalter vor dem alten Rueckfall');
});

(async () => {
  for (const [name, fn] of abschnitte) {
    if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) continue;
    console.log('\n== ' + name);
    try { await fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e)); }
  }
  console.log(`\n${n - fails}/${n} gruen`);
  setTimeout(() => process.exit(fails ? 1 : 0), 20);
})();
