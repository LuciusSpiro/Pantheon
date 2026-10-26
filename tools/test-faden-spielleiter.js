'use strict';
require('../server/sim/faden-bausteine.js').registriere('bitte', require('../server/sim/faden-bausteine.js').platzhalter('bitte'));   // SUND-04a-2 P2: diese 04a-1-Pruefung laeuft mit dem Platzhalter fuer bitte (der echte Baustein hat eigene Tests: test-faden-bitte.js)
// SUND-04a-1 B: Faeden und Lage-Spielleiter. Prompt und Ausschnitt (kleiner Faden-Block, keine Spielernamen, die Wahrheit nur als Kennung) · Plan-Befehle faden_oeffnen und faden_weiter (Pruefung, Anwendung,
// Logbuch, nicht gegen die Rate) · ohne Schalter ein unbekannter Typ wie auf main · Mock-Spielleiter · Bot-Lauf: der echte Lage-Spielleiter (Mock) fuehrt zwei NUR in Daten beschriebene Vorlagen ueber alle
// Pfade, auch durchs Scheitern, ohne Codeaenderung · Ausfall des Spielleiters.
// Erwartete Abfolgen leitet der Test mit einem eigenen kleinen Interpreter aus der JSON-Datei der Vorlage ab (nicht aus dem Produktivcode).        node tools/test-faden-spielleiter.js
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Prompt = require('../server/sim/lage-prompt.js');
const Mock = require('../server/sim/lage-mock.js');
const Regie = require('../server/sim/regie-befehle.js');
const Ausschnitt = require('../server/sim/lage-ausschnitt.js');
const Kriegslage = require('../server/sim/kriegslage.js');

const { D, Faden, F, klon, spiel, angebot, oeffne, grenzen, registriere, vorlageTest } = X;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const frei = () => new Promise((r) => setImmediate(r));
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const W = Object.fromEntries(Object.entries(require('../content/welt/lage-spielleiter-werte.json').werte).map(([k, v]) => [k, v.wert]));
const RATE = require('../content/welt/regie-werte.json').werte.rate.wert;
const ws = (g) => g.weltsim;
const liste = (g) => ws(g).faeden.liste;
const aktive = (g) => liste(g).filter((f) => f.phase !== 'abgeschlossen');
const logbuch = (g) => (g.lageRegie ? g.lageRegie.log.entries : []);
const eintraege = (g, art, ausgang) => logbuch(g).filter((e) => e.art === art && (ausgang === undefined || e.ausgang === ausgang));
const tick = (g, k) => { for (let i = 0; i < (k || 1); i++) Kriegslage.tick(g, 'test'); };
async function pumpen(g, k) { for (let i = 0; i < k; i++) { g.step(); await frei(); } }
function mitLage(g, werte, llmOpts) {
  const llm = LLM.create(Object.assign({ mode: 'mock' }, llmOpts || {}));
  const sl = LS.create(g, { llm, werte: Object.assign({ min_abstand_ticks: 1, deckel_je_sitzung: 9999 }, werte || {}) });
  g.lageSpielleiter = sl; g.lageSchalter = true;
  return sl;
}
const wirkung = (g) => JSON.stringify(Kriegslage.abbild(ws(g).zustand));
// eigener Interpreter: Abfolge der Beats einer Vorlage (Daten) fuer eine Liste von Ausgaengen
function erwartet(v, ausgaenge) {
  const ids = v.beats.map((b) => b.id); const seq = []; let i = 0, k = 0;
  for (let guard = 0; guard < 20; guard++) {   // wie der Bot: ist der Pfad zu Ende, gelingt der Rest
    seq.push(ids[i]);
    const b = v.beats[i];
    if (b.typ === 'abschluss') break;
    const o = b.aus[ausgaenge[k++] || 'gelungen']; i = o.weiter ? ids.indexOf(o.weiter) : i + 1;
  }
  return seq;
}

// Die zweite, nur in Daten beschriebene Vorlage (vierte im Sinne von Abnahme 14a): drei Beats, germanisches Volk, anderer Ausloeser
const KURZ = {
  format: 'faden-vorlage/1', id: 'test_kurz', titel: 'Testvorlage kurz', ausloeser: [{ art: 'notruf', ausgang: 'gescheitert' }], volk_erlaubt: ['ger'],
  nsc: { klassen: ['kurier'] }, wahrheit: { id: 'ist_spion', fraktion: 'rom' }, hinweise: { h_logbuch: { kanal: 'scan' } },
  beats: [
    { id: 'k_bitte', typ: 'bitte', hinweise: ['h_logbuch'], aus: { gelungen: { status: 'verbuendet', weiter: 'k_enthuell' }, gescheitert: { status: 'schuldet_nichts', weiter: 'k_ende' } } },
    { id: 'k_enthuell', typ: 'enthuellung', aus: { gelungen: { status: 'feindlich' }, gescheitert: { status: 'geflohen' } } },
    { id: 'k_ende', typ: 'abschluss', aus: { gelungen: { folge: [{ typ: 'haltung_aenderung', grund: 'gedankt' }] }, gescheitert: {} } },
  ],
};

async function main() {
  LLM.resetBudget();
  const TEST = vorlageTest();

  console.log('\nPrompt und Ausschnitt');
  {
    const g = spiel({ crew: 3, names: NAMEN }).g;
    registriere(KURZ);
    ok(Prompt.statischerTeil('').text === Prompt.katalogText(), 'ohne Faden-Text ist der statische Teil wie vorher (nur der Katalog)');
    const ft = Faden.promptText();
    ok(ft.includes('faden_oeffnen') && ft.includes('faden_weiter') && ft.includes('test_geschichte') && ft.includes('test_kurz'), 'der Faden-Abschnitt nennt beide Befehle und alle geprueften Vorlagen (aus den Daten abgeleitet)');
    ok(!/\{[wr]\./.test(ft) && !/undefined|NaN/.test(ft), 'keine offenen Platzhalter im Text');
    const s0 = Prompt.statischerTeil(ft);
    ok(s0.text.startsWith(Prompt.katalogText()) && s0.text.endsWith(ft) && s0.hash !== Prompt.statischerTeil('').hash, 'der Faden-Abschnitt haengt hinten am statischen Teil (der Hash aendert sich nur mit ihm)');
    ok(Faden.ausschnittBlock(g) === null, 'ohne Faeden und Angebote: kein Block im Ausschnitt');
    const f1 = oeffne(g), f2 = oeffne(g);
    angebot(g, { id: 'x1', hex: '1003', ausgang: 'gescheitert' });   // das Angebot entsteht, solange noch Platz ist
    const f3 = oeffne(g);
    f1.nsc.name = 'Mireille Kasper';   // ein NSC, der wie ein Spieler heisst (Namenfilter)
    for (const f of [f1, f2, f3]) { f.zaehler = 5; }
    const bl = Faden.ausschnittBlock(g);
    ok(bl && bl.aktiv.length === 3 && bl.platz === 0 && bl.angebote.length === 1, 'Block: drei Faeden, kein Platz, ein Angebot');
    const text = JSON.stringify(bl);
    ok(text.length <= D.WERTE.ausschnitt.zeichen, `der Block bleibt klein: ${text.length} von ${D.WERTE.ausschnitt.zeichen} Zeichen`);
    ok(!text.includes('Kasper') && !text.includes(f2.nsc.name) && !text.includes(f1.nsc.schiff), 'keine NSC-Namen und keine Schiffsnamen im Block (nur Kennungen)');
    ok(bl.aktiv.every((x) => x.faellig === 1 && x.nsc.w === 'ist_germane' && x.hw === 0) && !text.includes('Dokument') && !/germane\b[^"]/.test(text.replace(/"ist_germane"/g, '')), 'die verborgene Wahrheit steht nur als Kennung (ist_germane), nie als Text');
    const a = Prompt.baue(g, { art: 'szene_ende', nr: 1, letzte: [], werte: W });
    ok(!a.fehler && a.prompt.includes('"faeden":{') && a.prompt.includes('faden_weiter') && a.zeichen <= W.prompt_max_zeichen, `Prompt mit Faden-Block: ${a.zeichen} Zeichen (Obergrenze ${W.prompt_max_zeichen})`);
    const klein = a.prompt.toLowerCase();
    ok(!NAMEN.some((x) => klein.includes(x.toLowerCase())) && !klein.includes('mireille'), 'keine Spielernamen im Prompt (auch nicht ueber einen NSC)');
    ok(a.prompt.indexOf('faden_weiter') < a.prompt.indexOf('<ausschnitt>') && a.prompt.indexOf('"faeden"') > a.prompt.indexOf('<ausschnitt>'), 'Befehlstext statisch vorn (im Katalog), Zustand im Ausschnitt');
    const stufe3 = JSON.parse(Ausschnitt.ausschnitt(g, { stufe: 3 }).text);
    ok(stufe3.faeden && stufe3.faeden.aktiv.length === 3, 'auch die staerkste Kuerzung des Ausschnitts laesst den Faden-Block stehen');
    // Zeichenbudget: der Block wird gekuerzt, nie ueberschritten
    const alt = D.WERTE.ausschnitt.zeichen; D.WERTE.ausschnitt.zeichen = 300;
    try { const kb = Faden.ausschnittBlock(g); ok(JSON.stringify(kb).length <= 300 || kb.aktiv.length === 1, `bei Budget 300 Zeichen: gekuerzt (${JSON.stringify(kb).length}), Faeden fallen von hinten weg (${kb.aktiv.length})`); } finally { D.WERTE.ausschnitt.zeichen = alt; }
    const hoechstens3 = Faden.ausschnittBlock(g).aktiv.length <= 3;
    ok(hoechstens3, 'hoechstens 3 Faeden im Block');
    // Ohne den Schalter ist alles wie vorher
    const aus = spiel({ aus: true, crew: 3, names: NAMEN }).g;
    ok(!JSON.stringify(JSON.parse(Ausschnitt.ausschnitt(aus, { stufe: 0 }).text)).includes('faeden') && Faden.ausschnittBlock(aus) === null, 'ohne FAEDEN=1 kein Faden-Block im Ausschnitt');
    const pa = Prompt.baue(aus, { art: 'szene_ende', nr: 1, letzte: [], werte: W });
    ok(!pa.fehler && !pa.prompt.includes('faden') && Prompt.statischerTeil().text === Prompt.katalogText(), 'ohne FAEDEN=1 steht kein Wort ueber Faeden im Prompt');
    D.entferne('test_kurz');
  }

  console.log('\nPlan-Befehle (Regie.planAnwenden)');
  {
    registriere(KURZ);
    const g = spiel({ crew: 3, names: NAMEN, env: { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' } }).g;
    const a1 = angebot(g, { id: 'p1' }), a2 = angebot(g, { id: 'p2', hex: '0304' });
    const rate0 = Regie.befehleFrei(g).rate, wart0 = ws(g).regie.vorgemerkt.length;
    const plan = { befehle: [{ typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: a1.nr } }, { typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: a2.nr } }], begruendung: 'Zwei Geschichten.' };
    const probe = Regie.planPruefen(g, plan);
    ok(probe.ok && probe.angenommen.length === 2 && probe.abgelehnt.length === 0 && liste(g).length === 0, 'planPruefen (Probelauf): zwei angenommen, aber noch nichts veraendert');
    const r = Regie.planAnwenden(g, plan);
    ok(r.ok && r.angenommen.length === 2 && r.abgelehnt.length === 0 && liste(g).length === 2 && aktive(g).length === 2, 'planAnwenden: zwei Faeden geoeffnet');
    ok(Regie.befehleFrei(g).rate === rate0 && ws(g).regie.vorgemerkt.length === wart0 && ws(g).regie.rate.length === 0, 'die Faden-Befehle zaehlen nicht gegen die Rate und stehen nicht in der Warteschlange der Sim');
    ok(eintraege(g, 'faden_ereignis', 'geoeffnet').length === 2, 'jeder Faden steht im Regie-Logbuch (faden_ereignis/geoeffnet)');
    ok(r.angenommen.every((x) => x.platz === true && x.vorwarnung === false), 'das Ergebnis meldet sie als angenommen, ohne Vorwarnung');
    // gemischter Plan: ein Sim-Befehl kostet Rate, der Faden nicht
    const [f1, f2] = liste(g);
    for (const f of [f1, f2]) f.zaehler = 9;
    const gemischt = Regie.planAnwenden(g, { befehle: [{ typ: 'regler', fraktion: 'kon', p_act: 0.3, dauer: 6 }, { typ: 'faden_weiter', faden: f1.id, beat: 'b_bitte' }], begruendung: 'Mix' });
    ok(gemischt.ok && gemischt.angenommen.length === 2 && Regie.befehleFrei(g).rate === rate0 - 1 && f1.phase === 'laeuft', 'gemischter Plan: der Regler kostet einen Rate-Platz, faden_weiter keinen; der Beat laeuft');
    // abgelehnt: zu frueh, falscher Beat, unbekannter Faden, Obergrenze je Plan; Grund im Logbuch, Zustand unveraendert
    const z0 = JSON.stringify(f2);
    const bad = Regie.planAnwenden(g, { befehle: [{ typ: 'faden_weiter', faden: f2.id, beat: 'b_ende' }, { typ: 'faden_weiter', faden: 'f99', beat: 'b_bitte' }, { typ: 'faden_oeffnen', vorlage: 'test_kurz' }, { typ: 'faden_weiter', faden: f2.id, beat: 'b_bitte', extra: 1 }], begruendung: 'Fehler' });
    ok(bad.ok && bad.angenommen.length === 0 && bad.abgelehnt.length === 4, 'vier ungueltige Faden-Befehle: alle abgelehnt, der Plan selbst bleibt gueltig');
    const gr = bad.abgelehnt.map((x) => x.grund.split(':')[0]);
    ok(gr[0] === 'REIHENFOLGE' && gr[1] === 'FADEN_UNBEKANNT' && gr[2] === 'KEIN_ANGEBOT' && gr[3] === 'BEFEHL_FELD', 'mit Grund: ' + gr.join(', '));
    ok(JSON.stringify(f2) === z0, 'der Faden ist unveraendert');
    ok(eintraege(g, 'lage_befehl', 'abgelehnt').filter((e) => /REIHENFOLGE|FADEN_UNBEKANNT|KEIN_ANGEBOT|BEFEHL_FELD/.test((e.fehler || []).join(' '))).length === 4, 'alle vier Ablehnungen stehen im Regie-Logbuch (lage_befehl/abgelehnt)');
    const v = spiel().g;
    const fs3 = [oeffne(v), oeffne(v), oeffne(v)]; for (const f of fs3) f.zaehler = 9;
    const vier = Regie.planAnwenden(v, { befehle: fs3.map((f) => ({ typ: 'faden_weiter', faden: f.id, beat: 'b_bitte' })).concat([{ typ: 'faden_weiter', faden: fs3[0].id, beat: 'b_bitte' }]), begruendung: 'viele' });
    ok(vier.angenommen.length === D.WERTE.befehle_je_plan_max && vier.abgelehnt.length === 1 && /^BEFEHLE_JE_PLAN/.test(vier.abgelehnt[0].grund), `drei gueltige Faden-Befehle gehen durch, der vierte im selben Plan wird abgelehnt (BEFEHLE_JE_PLAN, Grenze ${D.WERTE.befehle_je_plan_max})`);
    // zwei Plaene hintereinander mit gleicher Form werden nicht als Wiederholung abgelehnt (die Angebotsnummer ist Teil des Befehls)
    const Wh = require('../server/sim/lage-wiederholung.js');
    const b1 = { typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: 1 } }, b2 = { typ: 'faden_oeffnen', vorlage: 'test_geschichte', parameter: { angebot: 2 } };
    ok(Wh.satzVon(b1) !== Wh.satzVon(b2) && Wh.pruefen({ befehle: [b2] }, [[Wh.satzVon(b1)]], { wiederholung: { fenster_plaene: 3, ausnahmen: [] } }).abgelehnt.length === 0, 'faden_oeffnen mit anderem Angebot ist keine Wiederholung');
    ok(g.errors === 0, 'keine Serverfehler');
    D.entferne('test_kurz');
  }

  console.log('\nOhne Schalter: ein unbekannter Typ wie auf main');
  {
    const g = spiel({ aus: true, env: { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' } }).g;
    const r = Regie.planAnwenden(g, { befehle: [{ typ: 'faden_oeffnen', vorlage: 'test_geschichte' }, { typ: 'faden_weiter', faden: 'f1', beat: 'b_bitte' }], begruendung: 'x' });
    ok(r.ok && r.angenommen.length === 0 && r.abgelehnt.length === 2 && r.abgelehnt.every((x) => /^unbekannter Typ "faden_/.test(x.grund)), 'ohne FAEDEN=1: unbekannter Typ, beide abgelehnt (' + r.abgelehnt.map((x) => x.grund).join(' | ') + ')');
    ok(liste(g).length === 0 && ws(g).faeden.t === 0, 'kein Zustand entsteht');
  }

  console.log('\nMock-Spielleiter');
  {
    registriere(KURZ);
    const g = spiel({ crew: 3, names: NAMEN }).g;
    const leer = Mock.planVon({ prompt: Prompt.baue(g, { art: 'szene_ende', nr: 1, letzte: [], werte: W }).prompt });
    ok(!leer.befehle.some((b) => /^faden_/.test(b.typ)), 'ohne Faeden und Angebote macht der Mock keine Faden-Befehle');
    const a = angebot(g, { id: 'm1' }); const b2 = angebot(g, { id: 'm2', hex: '1003', ausgang: 'gescheitert' });
    const mit = Mock.planVon({ prompt: Prompt.baue(g, { art: 'szene_ende', nr: 1, letzte: [], werte: W }).prompt });
    const fo = mit.befehle.filter((b) => b.typ === 'faden_oeffnen');
    ok(fo.length === 2 && fo[0].vorlage === 'test_geschichte' && fo[0].parameter.angebot === a.nr && fo[1].vorlage === 'test_kurz' && fo[1].parameter.angebot === b2.nr, 'mit zwei Angeboten: je ein faden_oeffnen mit der passenden Vorlage und Angebotsnummer');
    const e = oeffne(g); e.zaehler = 9;
    const mit2 = Mock.planVon({ prompt: Prompt.baue(g, { art: 'szene_ende', nr: 1, letzte: [], werte: W }).prompt });
    ok(mit2.befehle.some((b) => b.typ === 'faden_weiter' && b.faden === e.id && b.beat === 'b_bitte'), 'ein faelliger Faden: faden_weiter mit dem naechsten Beat');
    e.zaehler = 0;
    const mit3 = Mock.planVon({ prompt: Prompt.baue(g, { art: 'szene_ende', nr: 1, letzte: [], werte: W }).prompt });
    ok(!mit3.befehle.some((b) => b.typ === 'faden_weiter'), 'ein Faden, der noch nicht faellig ist, bekommt keinen Befehl');
    // der Plan des Mock ist byte-gleich, wenn der Ausschnitt keinen Faden-Block hat
    const aus = spiel({ aus: true, crew: 3, names: NAMEN }).g;
    const p1 = Mock.planVon({ prompt: Prompt.baue(aus, { art: 'szene_ende', nr: 2, letzte: [], werte: W }).prompt });
    ok(!JSON.stringify(p1).includes('faden'), 'ohne Schalter kein Faden-Verhalten im Mock');
    D.entferne('test_kurz');
  }

  console.log('\nBot-Lauf: der echte Lage-Spielleiter (Mock) fuehrt zwei nur in Daten beschriebene Vorlagen ueber alle Pfade');
  {
    registriere(KURZ);
    const g = spiel({ crew: 3, names: NAMEN, env: { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' } }).g;
    mitLage(g);
    const PFADE = {
      test_geschichte: [
        ['gelungen', 'gelungen', 'gelungen', 'gelungen', 'gelungen'],
        ['gescheitert', 'gescheitert', 'gelungen'],
        ['gelungen', 'gescheitert', 'gelungen'],
        ['gescheitert', 'gelungen', 'gescheitert', 'gescheitert', 'gelungen'],
        ['gelungen', 'gelungen', 'gescheitert', 'gescheitert', 'gelungen'],
        ['gescheitert', 'gelungen', 'gelungen', 'gelungen', 'gelungen'],
      ],
      test_kurz: [['gelungen', 'gelungen'], ['gescheitert', 'gelungen'], ['gelungen', 'gescheitert', 'gescheitert'], ['gescheitert']],
    };
    const wunsch = [].concat(PFADE.test_geschichte.map((p) => ({ v: 'test_geschichte', p })), PFADE.test_kurz.map((p) => ({ v: 'test_kurz', p })));
    const vorhaben = new Map();   // Faden-Id -> { p, k }
    const gespielt = new Map();   // Faden-Id -> Beats in der Reihenfolge, in der sie liefen (vom Bot beobachtet)
    const fertig = new Map();
    let naechster = 0, offen = null, maxAktiv = 0, maxListe = 0, runden = 0;
    for (; runden < 1200 && !(naechster >= wunsch.length && !offen && aktive(g).length === 0 && liste(g).length > 0); runden++) {
      tick(g);
      for (const f of aktive(g)) if (f.phase === 'laeuft') {   // die Crew spielt: ein laufender Beat endet mit dem naechsten Ausgang des Pfades
        const h = vorhaben.get(f.id);
        if (h) Faden.beatAusgang(g, f.id, h.p[h.k++] || 'gelungen');
      }
      if (!offen && naechster < wunsch.length && aktive(g).length < D.WERTE.aktiv_max && ws(g).faeden.angebote.length === 0) {   // ein Notruf mit Person am Ausgang
        const w = wunsch[naechster];
        if (Faden.ausgangMitPerson(g, w.v === 'test_geschichte' ? { art: 'notruf', id: 'bot' + runden, hex: '0305', ausgang: 'gelungen' } : { art: 'notruf', id: 'bot' + runden, hex: '1003', ausgang: 'gescheitert' })) offen = w;
      } else g.lageGrenze('szene_ende');
      await pumpen(g, 3);
      for (const f of liste(g)) if (!vorhaben.has(f.id) && offen && f.vorlage === offen.v) { vorhaben.set(f.id, { p: offen.p, k: 0 }); offen.f = f.id; offen = null; naechster++; }
      if (offen && ws(g).faeden.angebote.length === 0) offen = null;   // das Angebot ist verfallen, ohne dass ein Faden entstand: der Bot bietet es neu an
      for (const f of aktive(g)) if (f.phase === 'laeuft') { const l = gespielt.get(f.id) || []; if (l[l.length - 1] !== f.laufend.beat) gespielt.set(f.id, l.concat(f.laufend.beat)); }
      for (const f of liste(g)) if (f.phase === 'abgeschlossen' && !fertig.has(f.id)) fertig.set(f.id, klon(f));   // der Stand haelt hoechstens 9 Faeden: abgeschlossene werden hier gesichert, bevor die aeltesten herausfallen
      maxAktiv = Math.max(maxAktiv, aktive(g).length);
      maxListe = Math.max(maxListe, liste(g).length);
    }
    ok(runden < 1200, `der Bot ist nach ${runden} Runden fertig`);
    ok(fertig.size === wunsch.length && [...fertig.values()].every((f) => f.ausgang && ['gelungen', 'gescheitert'].includes(f.ausgang.art)), `alle ${wunsch.length} Faeden wurden abgeschlossen, jeder mit Ausgang (${fertig.size})`);
    ok(maxListe <= D.WERTE.faeden_gesamt_max && liste(g).length <= D.WERTE.faeden_gesamt_max && liste(g).every((f) => f.phase === 'abgeschlossen'), `im Stand stehen hoechstens ${D.WERTE.faeden_gesamt_max} Faeden (hoechster Stand ${maxListe}), am Ende nur abgeschlossene`);
    ok(maxAktiv <= 3 && maxAktiv >= 2, `nie mehr als 3 aktive zugleich (Hoechstwert ${maxAktiv})`);
    for (const w of wunsch) {
      const soll = erwartet(w.v === 'test_geschichte' ? TEST : KURZ, w.p);
      const ist = gespielt.get(w.f) || [];
      ok(w.f && JSON.stringify(ist) === JSON.stringify(soll), `${w.v} ${w.p.map((x) => x[0]).join('')}: Beats ${soll.join(' > ')}  (gespielt: ${ist.join(' > ')})`);
    }
    const alle = [...fertig.values()];
    const geschichte = alle.filter((f) => f.vorlage === 'test_geschichte'), kurz = alle.filter((f) => f.vorlage === 'test_kurz');
    ok(geschichte.length === 6 && kurz.length === 4 && kurz.every((f) => f.nsc.fraktion === 'ger' && f.nsc.schiffsklasse === 'kurier' && f.nsc.wahrheit.id === 'ist_spion') && geschichte.every((f) => ['rom', 'kon'].includes(f.nsc.fraktion)), 'die Vorlagen bringen ihre eigenen Parameter mit (Volk, Klasse, Wahrheit)');
    const enth = alle.filter((f) => f.nsc.wahrheit && f.nsc.wahrheit.offenbart);
    const sollEnth = wunsch.filter((w) => erwartet(w.v === 'test_geschichte' ? TEST : KURZ, w.p).some((id) => /enthuell/.test(id))).length;
    ok(enth.length === sollEnth && enth.length >= 5 && enth.every((f) => f.hinweise.length >= 1), `${enth.length} von ${sollEnth} erwarteten Faeden haben ihre Wahrheit enthuellt, jeder vorher mit mindestens einem Hinweis`);
    ok(alle.every((f) => f.nsc.gedaechtnis.length === (gespielt.get(f.id) || []).length && f.nsc.gedaechtnis.length <= 12), 'jeder NSC hat je gespieltem Beat einen Gedaechtnis-Eintrag (hoechstens 12)');
    ok(g.errors === 0, 'keine Serverfehler');
    const ls = eintraege(g, 'lage_grobplan');
    ok(ls.length > 0 && ls.every((e) => e.ausgang !== 'fehler'), `der Lage-Spielleiter plante (${ls.length} Eintraege in den letzten 200 des Logbuchs), kein Plan scheiterte`);
    D.entferne('test_kurz');
  }

  console.log('\nAusfall des Spielleiters: begonnene Faeden bleiben stehen');
  for (const fall of ['Fehler im Plan', 'dispose', 'Modus off']) {
    const g = spiel({ crew: 3, names: NAMEN, env: { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' } }).g;
    const sl = mitLage(g, {}, fall === 'Modus off' ? { mode: 'off' } : {});
    const f = oeffne(g);
    f.zaehler = 9;
    const vorher = JSON.stringify(Object.assign({}, f, { zaehler: 0 }));
    const w0 = wirkung(g);
    if (fall === 'Fehler im Plan') sl.failNext = true;
    if (fall === 'dispose') sl.dispose();
    const runden = fall === 'Fehler im Plan' ? 1 : 6;   // der erste Plan scheitert, danach koennte derselbe Spielleiter wieder planen
    for (let i = 0; i < runden; i++) { tick(g); g.lageGrenze('szene_ende'); await pumpen(g, 3); }
    ok(JSON.stringify(Object.assign({}, f, { zaehler: 0 })) === vorher && f.phase === 'wartet', `${fall}: der Faden steht (wartet, unveraendert), kein Beat startet`);
    ok(f.zaehler >= 9 + runden && ws(g).faeden.t >= 1 + runden, `${fall}: der Zaehler laeuft weiter (${f.zaehler}, t ${ws(g).faeden.t})`);
    ok(g.errors === 0 && !eintraege(g, 'faden_pruefung').length, `${fall}: kein Fehler, nichts im Pruefer-Logbuch`);
    ok(ws(g).tickZahl >= runden && aktive(g).length === 1, `${fall}: die Welt laeuft weiter (Tick ${ws(g).tickZahl})`);
    if (fall === 'Fehler im Plan') ok(eintraege(g, 'lage_grobplan', 'fehler').length === 1, 'der gescheiterte Plan steht im Logbuch (Rueckfall auf die Standard-KI)');
    // und danach kommt er zurueck: ein neuer Spielleiter nimmt den Faden wieder auf
    if (fall !== 'Modus off') {
      const sl2 = mitLage(g);
      for (let i = 0; i < 4; i++) { tick(g); g.lageGrenze('szene_ende'); await pumpen(g, 3); }
      ok(f.phase === 'laeuft' && f.laufend.beat === 'b_bitte', `${fall}: mit einem neuen Spielleiter geht der Faden weiter`);
    }
  }

  console.log(`\n${n - fails}/${n} Pruefungen ok`);
  if (fails) { console.log(`${fails} FEHLER`); process.exit(1); }
  console.log('FADEN-SPIELLEITER OK');
}
main().catch((e) => { console.log('FEHLER Ausnahme: ' + (e && e.stack)); process.exit(1); });
