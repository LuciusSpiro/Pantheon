'use strict';
// SUND-04b B2: Katalog-Erweiterung, Teil 2: die Beats konvoi (Szene, Konvoi.an), geleit (Szene, Escort.spawn: Geleit, Havarist, Panne) und sabotage (ohne eigene Szene; wartet auf die Sprengung der Crew in der
// Sim-Szene Posten angreifen). Bausteine server/sim/faden-szene-b2.js und faden-b2.js, Daten content/faeden/szenen-werte.json und b2-texte.json, Katalog beats.json. Die Erwartungen stehen hier selbst (aus den Daten und
// den Regeln der Module), nie aus dem Produktivcode abgeleitet. Der Test laeuft durch die ECHTEN Hooks: Abenteuer anbieten und oeffnen, faden_weiter, Taetigkeitsgrenzen (game.lageGrenze), Game.step, die Crew sprengt
// einen Posten ueber Posten.angreifenStart und die Sim-Szene. Nie Faden.beatAusgang.
// Geprueft wird: Katalog und Daten · Expander, Pruefer und Lage (Ziel, Rang, Ruf-Sperre je Hex, Pause) · Konvoi (aufhalten, pluendern, entkommen, Szenenwechsel, Andocken, Sim-Szene, Speichern/Laden, Mehrspieler) ·
// Geleit (drei Modi, Scheitern, Aufraeumen) · Sabotage (Ziel, Ereignis, Ziel weg, Frist, Fallback, Speichern/Laden, Weltstand) · Prompt und Mock · ohne Schalter nichts.
// Aufruf: node tools/test-faden-katalog-b2.js        (npm run test:faden-katalog-b2)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const Space = require('../server/sim/space.js');
const Besitz = require('../server/sim/besitz.js');
const Posten = require('../server/sim/posten.js');
const Konvoi = require('../server/sim/konvoi.js');
const Escort = require('../server/sim/escort.js');
const Fracht = require('../server/sim/fracht.js');
const Testhilfe = require('./gegner-testhilfe.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const BP = require('../server/sim/faden-bauplan.js');
const Bausteine = require('../server/sim/faden-bausteine.js');
const FS = require('../server/sim/faden-szene.js');
const B2 = require('../server/sim/faden-b2.js');
const AP = require('../server/sim/abenteuer-prompt.js');
const AM = require('../server/sim/abenteuer-mock.js');
const { D, Faden, F, klon } = X;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const SZ = lies('content/faeden/szenen-werte.json'), TX = lies('content/faeden/b2-texte.json'), WERTE = lies('content/faeden/werte.json').werte, KARTE = lies('content/welt/sund_frei.json');
const PW = require('../content/welt/posten-werte.json').werte, RUF = lies('content/welt/ruf-werte.json').werte;
const SW = Object.fromEntries(Object.entries(SZ.werte).map(([k, v]) => [k, v.wert]));
const FRIST = WERTE.beat_frist.wert, FUNK_MAX = WERTE.funk_text_max.wert;
const NEU = ['konvoi', 'geleit', 'sabotage'];
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const HZ = 30;
const rangAb = (id) => RUF.raenge.wert.find((r) => r.id === id).ab;
const hat = (r, code) => !r.ok && r.fehler.some((t) => t.startsWith(code + ':'));

// ---------------------------------------------------------------- Hilfen
function neu(seed, crew) {
  const t = F.neuesSpiel({ crew: crew || 3, seed: seed || 11, names: NAMEN.slice(0, crew || 3), env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' } });
  const llm = LLM.create({ mode: 'mock' });
  t.g.lageSpielleiter = LS.create(t.g, { llm, werte: { min_abstand_ticks: 1, deckel_je_sitzung: 9999 } }); t.g.lageSchalter = true;
  t.c = t.cs[0];
  t.funk = []; const orig = t.g.emit.bind(t.g);
  t.g.emit = (...a) => { if (a[0] === 'radio' && a[1]) t.funk.push(a[1].text); return orig(...a); };
  t.run = (sek) => { for (let k = 0; k < Math.round(sek * HZ); k++) t.g.step(); };
  return t;
}
const ort = (hex) => Sektoren.ortVonHex(hex) || ('leer-' + hex);
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const flieg = (t, hex) => { Space.enterScene(t.g, ort(hex), {}); t.g.explore.location = ort(hex); ab(t.g); t.run(0.1); };
const hier = (g) => Sektoren.hexVonOrt(g.ship.scene);
const grenzen = (g, k, art) => { for (let i = 0; i < k; i++) g.lageGrenze(art || 'andocken'); };
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'ZEBRAKAI Probe', anlass: 'Anlass ZEBRAKAI fuer den Test', beats }, o || {});
const b = (typ, o) => Object.assign({ typ }, o || {});
function oeffne(g, p, parameter, hex) {
  const a = Faden.abenteuerAnbieten(g, p, { hex: hex || '0305' });
  if (!a.ok) return { a, r: null, f: null };
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, parameter);
  return { a, r, f: r.ok ? r.faden : null };
}
function startBeat(g, f) {   // wie der Spielleiter: nach dem Abstand der Befehl faden_weiter
  for (let i = 0; i < 10; i++) {
    const bt = { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id };
    if (Faden.befehlPruefen(g, bt) === null) return Faden.befehlAnwenden(g, bt);
    grenzen(g, 1);
  }
  return { ok: false };
}
const liste = (g) => g.weltsim.faeden.liste;
const logbuch = (g) => (g.lageRegie && g.lageRegie.log && g.lageRegie.log.entries) || [];
const kontextVon = (prompt) => JSON.parse(/<kontext>\n([\s\S]*?)\n<\/kontext>/.exec(prompt)[1]);
const eigene = (g) => (g.fadenSzene ? g.space.enemies.filter((e) => e.tag === g.fadenSzene.tag) : []);
const szene = (g) => g.fadenSzene || null;
// Szene starten: Abenteuer mit genau einem Szenen-Beat und dem Abschluss, den Beat starten, den Vorlauf abwarten
function szeneStart(t, beat, o) {
  const g = t.g;
  flieg(t, (o && o.hex) || '0305');
  if (o && o.fern) { g.ship.x = 300; g.ship.y = 300; }   // weit weg von der Route des Konvois (die Eskorte soll ruhig bleiben)
  const { f } = oeffne(g, plan([beat, b('abschluss')]), undefined, (o && o.hex) || '0305');
  if (!f) throw new Error('kein Abenteuer');
  const r = startBeat(g, f);
  if (!r.ok) throw new Error('Beat startet nicht');
  return f;
}
const vorlauf = (t) => t.run(SW.vorlauf_s + 1);
// ein germanischer Posten auf einem Quell-Hex (Fixture am Zustand der Sim, wie tools/test-sprengen.js), die Crew hat den Rang
function postenSetzen(g, hex, besitzer, garnison) {
  Object.assign(g.weltsim.zustand.hexe[hex], { besitzer, posten: true, garnison: garnison == null ? 4 : garnison, anspruch: {} });
  if (g.weltBesitz && g.weltBesitz.hexe[hex]) g.weltBesitz.hexe[hex] = { besitzer: { rom: 'rom', ger: 'ger', kon: 'saum', pirat: 'pirat' }[besitzer] || 'frei', posten: true };
}
const ohneFlotten = (g, hex) => { const st = g.weltsim.zustand; st.flotten = st.flotten.filter((f) => f.ort !== hex); };
const rang = (g, id) => { g.weltsim.ruf.rom = rangAb(id || 'miles'); };
// Die Crew sprengt den Posten wirklich: hinfliegen, Ops, Posten angreifen, Wellen abraeumen bis die Sim-Szene endet
function sprengen(t, hex) {
  const g = t.g;
  ohneFlotten(g, hex);
  flieg(t, hex);
  g.players[0].console = 'weapons'; g.players[0].station = null; t.run(0.2);
  const p = Besitz.postenLage(Locations.get(Sektoren.ortVonHex(hex)).scene);
  Object.assign(g.ship, { x: p.x, y: p.y, vx: 0, vy: 0, speed: 0 });
  const e = Posten.angreifenStart(g, g.players[0]);
  if (e) return 'Start: ' + e;
  t.run(PW.angreifen.wert.dauer + 1.5);
  for (let i = 0; i < 400 * HZ; i++) { for (const x of g.space.enemies.slice()) Testhilfe.toeten(g, x); g.step(); if (!g.simSzene && i > 60) break; }
  t.run(0.5);
  return g.simSzene ? 'Szene laeuft noch' : null;
}

// ---------------------------------------------------------------- (a) Katalog und Daten
section('(a) Katalog: 15 Beat-Typen, drei neue; konvoi und geleit sind Szenen mit Gefahr ohne Optionen, sabotage hat keine Szene und haengt von der Lage ab; die Daten sind in sich stimmig', () => {
  const t = neu(3);
  ok(Object.keys(D.BEATS).length === 15 && NEU.every((k) => D.BEATS[k]), '15 Beat-Typen (12 bis B1, dazu ' + NEU.join(', ') + ')');
  for (const k of ['konvoi', 'geleit']) {
    const c = D.BEATS[k];
    ok(c.gefahr === true && c.optionen === 'keine' && c.szene === true && !c.abschluss && c.zweck.length > 60 && c.baustein === k && c.braucht.nsc_status.join() === 'aktiv,verbuendet', `${k}: Zweck, Gefahr, Szene (nicht speicherbar), keine Optionen, NSC aktiv oder verbuendet`);
  }
  const s = D.BEATS.sabotage;
  ok(s.gefahr === false && s.optionen === 'keine' && !s.szene && !s.abschluss && s.baustein === 'sabotage' && s.braucht.lage === 'sabotage_ziel' && s.frist === 12 && s.frist > FRIST, 'sabotage: keine eigene Szene (speicherbar), keine Optionen, braucht die Lage sabotage_ziel, eigene Frist 12 (> beat_frist ' + FRIST + ')');
  for (const k of NEU) {
    const c = D.BEATS[k];
    ok(c.bauplan && c.bauplan.start_status === 'aktiv' && c.bauplan.aus.gelungen.status.length && c.bauplan.aus.gescheitert.status.length && Bausteine.vonId(k) && !Bausteine.istPlatzhalter(k), `${k}: Standards fuer den Expander (bauplan), der Baustein ist registriert (kein Platzhalter)`);
  }
  ok(D.BEATS.konvoi.bauplan.parameter.sieg.erlaubt.join() === 'aufhalten,pluendern' && D.BEATS.geleit.bauplan.parameter.modus.erlaubt.join() === 'geleit,havarist,panne', 'Parameter sieg (aufhalten, pluendern) und modus (geleit, havarist, panne) mit Standard');
  ok(['konvoi', 'geleit'].every((k) => SW.arten.includes(k)) && SW.arten.length === 6, 'die Szenenarten der Daten kennen konvoi und geleit (sechs Arten)');
  const folgen = []; for (const k of NEU) for (const ag of ['gelungen', 'gescheitert']) for (const f of D.BEATS[k].bauplan.aus[ag].folge) folgen.push(f.typ);
  ok(folgen.every((x) => WERTE.folge_typen.wert.includes(x)) && WERTE.folge_typen.wert.join() === 'ruf_aenderung,haltung_aenderung', 'Folgen nur aus dem Katalog; werte.json folge_typen bleibt unveraendert (ruf_aenderung, haltung_aenderung)');
  ok(BP.katalogFehler().length === 0 && B2.katalogFehler().length === 0 && Pruefer.katalogFehler().length === 0, 'katalogFehler (Expander, Bausteine, Pruefer) ist leer');
  // ein kaputter Eintrag der Daten wird gemeldet (Daten werden kurz veraendert und zurueckgesetzt)
  const live = require('../content/faeden/szenen-werte.json').werte; const sicher = { konvoi: klon(live.konvoi.wert), geleit: klon(live.geleit.wert) };
  const stellen = [
    ['braucht.lage unbekannt', () => { D.BEATS.sabotage.braucht.lage = 'xyz'; }, () => { D.BEATS.sabotage.braucht.lage = 'sabotage_ziel'; }, /Lagen-Bedingung/],
    ['frist keine Zahl', () => { D.BEATS.sabotage.frist = 0; }, () => { D.BEATS.sabotage.frist = 12; }, /frist/],
    ['Text mit fremdem Platzhalter', () => { D.B2.texte.zusatz = 'Hallo {spieler}, schoen dich zu sehen.'; }, () => { delete D.B2.texte.zusatz; }, /zusatz/],
    ['Pflichttext fehlt', () => { delete D.B2.texte.sabotage_pause; }, () => { D.B2.texte.sabotage_pause = TX.texte.sabotage_pause; }, /sabotage_pause/],
    ['pause_ticks keine Zahl', () => { D.B2.werte.sabotage.pause_ticks = 0; }, () => { D.B2.werte.sabotage.pause_ticks = TX.werte.sabotage.wert.pause_ticks; }, /pause_ticks/],
    ['konvoi: unbekannte Siegart', () => { live.konvoi.wert.siegen.push('rammen'); }, () => { live.konvoi.wert.siegen.pop(); }, /konvoi/],
    ['konvoi: unbekannte Eskorte', () => { live.konvoi.wert.eskorte['2'] = 'armada'; }, () => { live.konvoi.wert.eskorte['2'] = 'voll'; }, /Eskorte/],
    ['konvoi: Ladung keine Ladungsart', () => { live.konvoi.wert.ladung = 'gold'; }, () => { live.konvoi.wert.ladung = 'fracht'; }, /Ladungsart/],
    ['geleit: Modus ohne Angreifer fuer eine Crewgroesse', () => { delete live.geleit.wert.modi.panne.angreifer['3']; }, () => { live.geleit.wert.modi.panne.angreifer['3'] = 2; }, /angreifer je Crew/],
    ['geleit: Erfolgsart unbekannt', () => { live.geleit.wert.modi.geleit.erfolg = 'flug'; }, () => {}, /erfolg unbekannt/],
    ['geleit: Zielseiten fehlen', () => { live.geleit.wert.ziele = []; }, () => {}, /szenen-werte geleit: modi/],
    ['geleit: Erfolg passt nicht zum Verhalten', () => { live.geleit.wert.modi.havarist.erfolg = 'angekommen'; }, () => { live.geleit.wert.modi.havarist.erfolg = 'angreifer_weg'; }, /nur ein fahrender/],
    ['geleit: reparatur_s ohne Erfolg repariert', () => { live.geleit.wert.modi.geleit.reparatur_s = 5; }, () => { live.geleit.wert.modi.geleit.reparatur_s = 0; }, /reparatur_s/],
    ['geleit: Schuetzling-Klasse unbekannt', () => { live.geleit.wert.modi.panne.kind = 'schlachtschiff'; }, () => { live.geleit.wert.modi.panne.kind = 'bergungsboot'; }, /kind oder verhalten/],
    ['Text der Szene fehlt', () => { delete SZ_TEXTE().gelungen.panne; }, () => { SZ_TEXTE().gelungen.panne = SZ.texte.gelungen.panne; }, /texte\.gelungen\.panne/],
    ['erlaubter Parameterwert ohne Daten', () => { D.BEATS.geleit.bauplan.parameter.modus.erlaubt.push('flug'); }, () => { D.BEATS.geleit.bauplan.parameter.modus.erlaubt.pop(); }, /flug/],
  ];
  function SZ_TEXTE() { return require('../content/faeden/szenen-werte.json').texte; }
  for (const [was, an, aus, re] of stellen) {
    an(); const fb = B2.katalogFehler(); const bpf = BP.katalogFehler(); aus();
    for (const k of ['konvoi', 'geleit']) { const o = live[k].wert; for (const x of Object.keys(o)) delete o[x]; Object.assign(o, klon(sicher[k])); }   // zurueck auf den Stand der Daten (nie auf eine Zahl im Test: sonst bliebe eine veraenderte Datei unbemerkt)
    ok(fb.length >= 1 && fb.some((x) => re.test(x)) && bpf.some((x) => /^BAUPLAN_KATALOG: B2:/.test(x) && re.test(x)), `katalogFehler (auch im Expander) meldet: ${was}`);
  }
  ok(B2.katalogFehler().length === 0 && BP.katalogFehler().length === 0, 'nach dem Zuruecksetzen wieder leer');
  ok(t.g.errors === 0, 'keine Serverfehler');
});

section('(a2) Funktexte: hoechstens funk_text_max Zeichen mit dem laengsten Sektornamen, keine Spielernamen, nur die erlaubten Platzhalter; jede Szene und jeder Modus hat alle drei Texte', () => {
  neu(3);
  const lang = Object.values(KARTE.hexe).map((h) => h.name).sort((x, y) => y.length - x.length)[0];
  const fenster = (v) => v.replace(/\{ort\}/g, lang).replace(/\{name\}/g, 'Gaius Valerius').replace(/\{sek\}/g, '10').replace(/\{n\}/g, '3');
  const alle = Object.entries(TX.texte).map(([k, v]) => ['b2.' + k, v]);
  for (const bl of ['vorwarnung', 'gelungen', 'gescheitert']) for (const k of ['konvoi', 'konvoi_pluendern', 'geleit', 'havarist', 'panne']) alle.push([bl + '.' + k, SZ.texte[bl][k]]);
  ok(alle.every(([k, v]) => typeof v === 'string'), alle.length + ' Texte, alle vorhanden');
  for (const [k, v] of alle) {
    ok(fenster(v).length <= FUNK_MAX && fenster(v).length >= 20 && !(v.match(/\{[^}]*\}/g) || []).some((p) => !['{ort}', '{name}', '{sek}', '{n}'].includes(p)) && !NAMEN.some((x) => v.includes(x)), `${k}: ${fenster(v).length} Zeichen`);
  }
  ok(SZ.texte.vorwarnung.geleit.includes('{n}') && SZ.texte.vorwarnung.havarist.includes('{n}'), 'die Vorwarnung nennt die Zahl der Angreifer (die angekuendigte Zahl ist die, die kommt)');
  ok(Object.values(lies('content/faeden/b1-texte.json').werte.wiedersehen_erinnert.wert).every((k) => lies('content/faeden/b1-texte.json').texte[k]) && ['konvoi_gelungen', 'geleit_gelungen', 'sabotage_gelungen'].every((e) => lies('content/faeden/b1-texte.json').werte.wiedersehen_erinnert.wert[e]), 'ein NSC erinnert sich an einen gelungenen Konvoi, ein Geleit und eine Sabotage (Wiedersehen)');
});

// ---------------------------------------------------------------- (b) Expander, Pruefer, Prompt, Mock
section('(b) Expander: Plaene mit den neuen Typen, Standards aus den Daten, Zustaende von Hand abgeleitet, eigene Regeln', () => {
  neu(3);
  const r = BP.expandiere(plan([b('konvoi'), b('geleit'), b('sabotage'), b('abschluss')]));
  ok(r.ok, 'Plan konvoi > geleit > sabotage > abschluss wird angenommen');
  const v = r.vorlage, ps = v.beats.map((x) => x.parameter || null);
  ok(JSON.stringify(ps[0]) === '{"sieg":"aufhalten"}' && JSON.stringify(ps[1]) === '{"modus":"geleit"}' && ps[2] === null, 'Standards: sieg aufhalten, modus geleit, sabotage ohne Parameter');
  ok(v.nsc.status === 'aktiv' && v.beats.slice(0, 3).every((x) => !x.optionen) && v.beats[0].aus.gelungen.status === 'verbuendet' && v.beats[0].aus.gescheitert.status === 'aktiv', 'NSC aktiv am Anfang; konvoi: gelungen verbuendet, gescheitert aktiv (Scheitern aendert den Faden); keine Optionen');
  ok(v.beats[0].aus.gelungen.folge && v.beats[0].aus.gelungen.folge[0].typ === 'haltung_aenderung' && !v.beats[0].aus.gescheitert.folge, 'Folge aus dem Katalog (Haltung geholfen), Scheitern ohne Folge');
  ok(Pruefer.pruefeVorlage(klon(v)).ok, 'der Pruefer nimmt die expandierte Vorlage an');
  const r2 = BP.expandiere(plan([b('konvoi', { parameter: { sieg: 'pluendern' } }), b('geleit', { parameter: { modus: 'panne' } }), b('abschluss')]));
  ok(r2.ok && r2.vorlage.beats[0].parameter.sieg === 'pluendern' && r2.vorlage.beats[1].parameter.modus === 'panne', 'sieg pluendern und modus panne werden uebernommen');
  for (const [p, code, was] of [
    [plan([b('konvoi', { parameter: { sieg: 'rammen' } }), b('abschluss')]), 'PARAMETER', 'unbekannte Siegart'],
    [plan([b('geleit', { parameter: { modus: 'constructor' } }), b('abschluss')]), 'PARAMETER', 'modus "constructor" (Prototyp-Name)'],
    [plan([b('geleit', { parameter: { modus: '__proto__' } }), b('abschluss')]), 'PARAMETER', 'modus "__proto__"'],
    [plan([b('konvoi', { parameter: { hex: '0305' } }), b('abschluss')]), 'PARAMETER', 'ein Parameter, den der Typ nicht kennt'],
    [plan([b('sabotage', { parameter: { hex: '0703' } }), b('abschluss')]), 'PARAMETER', 'der Plan nennt das Ziel selbst (es kommt vom Code, nie vom Modell)'],
    [plan([b('konvoi', { optionen: true }), b('abschluss')]), 'OPTION_BEI_GEFAHR', 'Optionen bei Gefahr (Konvoi)'],
    [plan([b('geleit', { optionen: true }), b('abschluss')]), 'OPTION_BEI_GEFAHR', 'Optionen bei Gefahr (Geleit)'],
    [plan([b('sabotage', { optionen: true }), b('abschluss')]), 'OPTIONEN_NICHT_ERLAUBT', 'Optionen beim Sabotage-Auftrag'],
    [plan([b('sabotage', { id: 'a', verzweigung: { gelungen: 'a' } }), b('abschluss')]), 'WEITER_UNGUELTIG', 'Verzweigung auf sich selbst'],
  ]) ok(hat(BP.expandiere(p), code), `Ablehnung ${code}: ${was}`);
  ok(BP.expandiere(plan([b('sabotage', { verzweigung: { gescheitert: 'z' } }), b('konvoi'), b('geleit', { id: 'z' }), b('abschluss')])).ok, 'Verzweigung: das Scheitern der Sabotage springt zu einem spaeteren Beat');
  const nl = BP.expandiere(plan([b('konvoi'), b('abschluss')], { namenlos: true }));
  ok(nl.ok && nl.vorlage.nsc.rolle === 'namenlos', 'namenlos geht mit konvoi (NSC bleibt aktiv)');
  // eine Datei-Vorlage mit sabotage ohne Lage-Parameter laeuft durch den Pruefer der Vorlage (die Lage wird beim Anbieten und Oeffnen gefragt, nie in der Vorlage)
  ok(Pruefer.pruefeVorlage(klon(BP.expandiere(plan([b('sabotage'), b('abschluss')])).vorlage)).ok, 'der Pruefer der Vorlage verlangt keine Lage (sie ist keine Eigenschaft der Vorlage)');
  // beliebiges Parameterfeld mit Prototyp-Schluessel
  const proto = BP.expandiere(JSON.parse('{"format":"faden-bauplan/1","titel":"Probe ZEBRA","beats":[{"typ":"konvoi","parameter":{"__proto__":{"sieg":"pluendern"}}},{"typ":"abschluss"}]}'));
  ok(!proto.ok || !proto.vorlage.beats[0].parameter || proto.vorlage.beats[0].parameter.sieg === 'aufhalten', 'ein Prototyp-Schluessel im Parameter aendert nichts (abgelehnt oder Standard)');
});

section('(b2) Prompt-Katalog der Komposition (A2) leitet die neuen Typen aus den Daten ab; Kontext faeden.lage nennt nur Zahlen; Systemprompt erklaert die Lage', () => {
  const t = neu(3); AP.katalogNeuLesen();
  const k = AP.katalogText();
  for (const typ of NEU) ok(new RegExp('- ' + typ + '[ :\\[]').test(k) && k.includes(D.BEATS[typ].zweck), `${typ} steht im Katalog mit seinem Zweck`);
  ok(/sieg \(Standard aufhalten; erlaubt aufhalten \| pluendern\)/.test(k) && /modus \(Standard geleit; erlaubt geleit \| havarist \| panne\)/.test(k), 'Parameter sieg und modus mit Standard und erlaubten Werten');
  ok(/konvoi \[Gefahr, Szene\]/.test(k) && /geleit \[Gefahr, Szene\]/.test(k) && /braucht die Lage sabotage_ziel \(Kontext faeden\.lage\.sabotage_ziel groesser 0\)/.test(k), 'Gefahr und Szene sind gekennzeichnet, die Lage des Sabotage-Auftrags steht im Katalog');
  ok(/Kontext faeden\.lage: Zahl je Lage \(sabotage_ziel\), nur Zahlen, keine Namen/.test(k), 'der Katalog erklaert faeden.lage (nur Zahlen, keine Namen)');
  ok(k.length < 12000, 'Prompt-Katalog unter 12 000 Zeichen (' + k.length + ')');
  const r = AP.baue(t.g, { nr: 1, grenze: 'szene_ende', hex: '0305', letzte: [] });
  ok(!r.fehler && r.prompt.length < 16000 && !NAMEN.some((x) => r.prompt.includes(x)), 'der Prompt ist im Budget und ohne Spielernamen (' + r.zeichen + ' Zeichen)');
  const ktx = kontextVon(r.prompt).faeden;
  ok(ktx.lage && ktx.lage.sabotage_ziel === 0 && Object.keys(ktx.lage).join() === 'sabotage_ziel', 'Kontext faeden.lage.sabotage_ziel ist 0 ohne Ziel');
  const sys = fs.readFileSync(path.join(__dirname, '..', 'content', 'spielleiter', 'prompts', 'abenteuer.system.md'), 'utf8');
  ok(/faeden\.lage/.test(sys) && /Lage:/.test(sys) && /größer 0/.test(sys), 'der Systemprompt erklaert die Lage');
  postenSetzen(t.g, '0703', 'ger'); rang(t.g, 'miles'); flieg(t, '0305');
  ok(kontextVon(AP.baue(t.g, { nr: 2, grenze: 'szene_ende', hex: '0305', letzte: [] }).prompt).faeden.lage.sabotage_ziel === 1, 'mit einem Ziel (Posten bei 0703, Rang erreicht) steht dort die Zahl 1 (keine Namen, nur die Zahl)');
});

section('(b3) Mock: Plaene mit den neuen Typen; Sabotage nur, wenn der Kontext ein Ziel nennt; der Pruefer nimmt sie an', () => {
  const t = neu(5); const g = t.g;
  const typenMock = (lage) => { const s = new Set(); for (let i = 0; i < 400; i++) { const p = AM.gueltigerPlan(AM.rngVon('b2:' + i), { lage }); for (const x of p.beats) s.add(x.typ); if (!BP.expandiere(p).ok) return null; } return s; };
  const ohne = typenMock({ sabotage_ziel: 0 }), mit = typenMock({ sabotage_ziel: 1 });
  ok(ohne && mit, 'jeder Mock-Plan wird vom Expander angenommen');
  ok(ohne.has('konvoi') && ohne.has('geleit') && !ohne.has('sabotage'), 'ohne Ziel (Kontext 0): Konvoi und Geleit kommen vor, nie eine Sabotage');
  ok(mit.has('sabotage') && mit.has('konvoi') && mit.has('geleit'), 'mit einem Ziel (Kontext 1): auch Sabotage');
  { let mitSabotage = 0; for (let i = 1; i <= 60; i++) { const text = AM.planText({ prompt: AP.baue(g, { nr: 500 + i, grenze: 'szene_ende', hex: '0305', letzte: [] }).prompt }); if (/"typ": ?"sabotage"/.test(text)) mitSabotage++; }
    ok(mitSabotage === 0, 'Mock ueber den echten Prompt ohne Ziel (Kontext 0): in 60 Plaenen kein Sabotage-Beat'); }
  postenSetzen(g, '0703', 'ger'); rang(g, 'miles'); flieg(t, '0305');
  let sab = 0, gesamt = 0;
  for (let i = 1; i <= 80; i++) {
    const prompt = AP.baue(g, { nr: i, grenze: 'szene_ende', hex: '0305', letzte: [] }).prompt;
    const text = AM.planText({ prompt });
    const gelesen = AP.bauplanAusText(text);
    if (!gelesen.plan) continue;
    const a = Faden.abenteuerAnbieten(g, gelesen.plan, { hex: '0305' });
    gesamt++;
    if (a.ok) { if (a.angebot.vorlage.beats.some((x) => x.typ === 'sabotage')) sab++; g.weltsim.faeden.abenteuerAngebote = []; }
    else if (/LAGE_ZIEL_FEHLT|SABOTAGE_PAUSE/.test(a.grund)) ok(false, 'der Mock plante eine Sabotage trotz Kontext mit Ziel: ' + a.grund);
  }
  ok(gesamt >= 40 && sab >= 1, `Mock ueber den echten Prompt (Kontext Ziel 1): ${sab} von ${gesamt} Angeboten haben einen Sabotage-Auftrag, keiner wurde wegen der Lage abgelehnt`);
  ok(g.errors === 0, 'keine Serverfehler');
});

// ---------------------------------------------------------------- (c) Konvoi
section('(c) Konvoi abfangen (aufhalten): Vorwarnung, Konvoi nach Crewgroesse (drei Spieler), Zerstoeren gelingt, Aufraeumen; der Faden geht weiter, der NSC wird Verbuendeter', () => {
  const t = neu(21, 3), g = t.g;
  const f = szeneStart(t, b('konvoi'), { fern: true });
  const s0 = szene(g);
  ok(s0 && s0.art === 'konvoi' && s0.phase === 'vorlauf' && s0.textKey === 'konvoi' && s0.n === SW.konvoi.anzahl['3'], 'Szene konvoi im Vorlauf, angekuendigt: ' + SW.konvoi.anzahl['3'] + ' Transporter (drei Spieler)');
  ok(!g.space.konvoi && g.space.enemies.length === 0, 'vor dem Eintreffen: kein Konvoi, kein Gegner');
  ok(t.funk.some((x) => x === SZ.texte.vorwarnung.konvoi.replace('{sek}', String(Math.round(s0.sek))) && /in 10 Sekunden/.test(x)), 'Vorwarnung per Funk (Text aus den Daten, nennt die Sekunden)');
  ok(s0.ab - g.time >= SW.vorlauf_min_s - 0.2, 'Vorlauf mindestens ' + SW.vorlauf_min_s + ' s');
  vorlauf(t);
  const k = g.space.konvoi;
  ok(szene(g).phase === 'kampf' && k && k.sieg === 'aufhalten' && k.wiederholung === false && Konvoi.transporter(g).length === SW.konvoi.anzahl['3'] && Konvoi.transporter(g).length === 2, 'Kampf: Konvoi mit ' + SW.konvoi.anzahl['3'] + ' Transportern, Sieg aufhalten, ohne Wiederholung');
  ok(Konvoi.mitglieder(g, 'e').length === 2 && g.space.enemies.every((e) => e.kv) && g.space.enemies.every((e) => e.volk === 'ger'), 'Eskorte voll (Jaeger und Korvette), alle germanisch');
  ok(f.phase === 'laeuft' && !g.simSzene, 'der Beat laeuft, keine Sim-Szene');
  for (const e of Konvoi.transporter(g)) Testhilfe.toeten(g, e);
  t.run(1.5);
  ok(!szene(g) && f.phase === 'wartet' && f.beat === 1 && f.nsc.status === 'verbuendet', 'alle Transporter zerstoert: gelungen, der NSC ist verbuendet, der Faden geht zum Abschluss');
  ok(t.funk.includes(SZ.texte.gelungen.konvoi), 'Ergebnis per Funk (Text aus den Daten)');
  ok(g.space.enemies.length === 0 && !g.space.konvoi && (g.space.escorts || []).length === 0, 'aufgeraeumt: keine Eskorte, kein Konvoi mehr');
  ok(f.nsc.gedaechtnis.some((x) => x.ereignis === 'konvoi_gelungen') && f.nsc.haltung > 0, 'Gedaechtnis konvoi_gelungen, Haltung gestiegen (Folge aus dem Katalog)');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('(c2) Konvoi: eine Crew = ein Transporter und nur ein Jaeger als Eskorte; die Beute einer Plünderung liegt nicht herum', () => {
  const t = neu(22, 1), g = t.g;
  szeneStart(t, b('konvoi'), { fern: true }); vorlauf(t);
  ok(Konvoi.transporter(g).length === 1 && Konvoi.mitglieder(g, 'e').length === 1 && Konvoi.mitglieder(g, 'e')[0].kind === 'raider', 'eine Crew: ein Transporter, nur ein Jaeger als Eskorte');
  // das Volk kommt aus den Daten, nicht aus dem Sektor: in einem Piratensektor (0602) wuerde der Standard 'pirat' gelten
  const t2 = neu(122, 1), g2 = t2.g; szeneStart(t2, b('konvoi'), { hex: '0602', fern: true }); vorlauf(t2);
  ok(g2.space.enemies.length >= 2 && g2.space.enemies.every((e) => e.volk === 'ger'), 'im Piratensektor 0602: der Konvoi ist trotzdem germanisch (Volk aus den Daten): ' + Array.from(new Set(g2.space.enemies.map((e) => e.volk))).join());
  ok(g.errors === 0, 'keine Serverfehler');
});

section('(c3) Konvoi entkommt (er springt am Ende der Route): gescheitert, der Faden aendert sich, nie Game Over; er kommt NICHT wieder', () => {
  const t = neu(23, 3), g = t.g;
  const f = szeneStart(t, b('konvoi'), { fern: true }); vorlauf(t);
  ok(!!g.space.konvoi, 'der Konvoi faehrt');
  let aus = null, sprung = 0, zerstoert = 0, sek = 0; const mo = g.missionEvent.bind(g);   // die Ereignisse des Konvois (die Szene endet im selben Schritt und raeumt auf)
  g.missionEvent = (name, d) => { if (name === 'konvoiAusgang') aus = d.was; if (name === 'konvoiSprung') sprung++; if (name === 'konvoiTransporterZerstoert') zerstoert++; return mo(name, d); };
  for (let i = 0; i < 260 * HZ && szene(g); i++) { g.step(); sek = i / HZ; }
  ok(aus === 'entkommen' && sprung >= 1 && zerstoert === 0 && sek < SW.konvoi.max_s, 'der Konvoi ist durch: Ausgang ' + aus + ', ' + sprung + ' Transporter gesprungen, keiner zerstoert, nach ' + Math.round(sek) + ' s (vor max_s)');
  t.run(1);
  ok(!szene(g) && f.phase === 'wartet' && f.beat === 1 && (f.nsc.status === 'aktiv' || f.nsc.status === 'geflohen') && f.nsc.status !== 'verbuendet', 'gescheitert: der NSC ist ' + f.nsc.status + ' (nicht verbuendet), der Faden lebt und geht zum Abschluss');
  ok(t.funk.includes(SZ.texte.gescheitert.konvoi), 'Ergebnis per Funk');
  t.run(WERTE_NEU_KONVOI() + 5);
  ok(!g.space.konvoi && g.space.enemies.length === 0, 'kein neuer Konvoi (wiederholung aus), keine Gegner');
  ok(f.nsc.gedaechtnis.some((x) => x.ereignis === 'konvoi_gescheitert') && !g.gameOver && g.errors === 0, 'Gedaechtnis konvoi_gescheitert, kein Game Over, keine Serverfehler');
  function WERTE_NEU_KONVOI() { return require('../shared/config.js').konvoi.neuNach; }
});

section('(c4) Konvoi pluendern: Transporter zerstoeren, die Fracht beamen; gelungen laut Konvoi-Ausgang gepluendert; liegen gebliebene Beute wird abgeraeumt', () => {
  const t = neu(24, 3), g = t.g;
  const { f } = (() => { flieg(t, '0305'); g.ship.x = 300; g.ship.y = 300; return oeffne(g, plan([b('konvoi', { parameter: { sieg: 'pluendern' } }), b('abschluss')])); })();
  startBeat(g, f);
  ok(szene(g).textKey === 'konvoi_pluendern' && t.funk.some((x) => x === SZ.texte.vorwarnung.konvoi_pluendern.replace('{sek}', String(Math.round(szene(g).sek)))), 'die Vorwarnung zeigt die Pluenderung (Text konvoi_pluendern)');
  vorlauf(t);
  const k = g.space.konvoi;
  ok(k && k.sieg === 'pluendern' && k.art === 'fracht', 'Konvoi mit Sieg pluendern, Beute fracht (nicht der Sprengstoff der Kampagne)');
  for (const e of Konvoi.transporter(g)) Testhilfe.toeten(g, e);
  t.run(0.5);
  ok(Fracht.draussen(g).length >= 1 && !!szene(g), 'Fracht liegt draussen, die Szene laeuft weiter (noch nicht geplündert)');
  g.weltsim.faeden.liste[0].zaehler = 0;
  const pod = Fracht.draussen(g)[0]; g.ship.x = pod.x - 80; g.ship.y = pod.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0;
  g.players[0].console = 'weapons'; g.players[0].station = null;
  for (let i = 0; i < 12 && szene(g); i++) { const d = Fracht.draussen(g)[0]; if (d) { g.ship.x = d.x - 80; g.ship.y = d.y; } Fracht.beamStart(g, g.players[0], null); t.run(4); }
  t.run(1);
  ok(!szene(g) && f.phase === 'wartet' && f.nsc.status === 'verbuendet' && Fracht.anBord(g, 'fracht') >= 1, 'Beute an Bord: gelungen (Konvoi-Ausgang gepluendert), der NSC ist verbuendet');
  ok(t.funk.includes(SZ.texte.gelungen.konvoi_pluendern) && g.errors === 0, 'Ergebnis per Funk, keine Serverfehler');
  // Beute liegt am Boden, niemand holt sie, der Beat endet (Szenenwechsel): sie ist weg
  const t2 = neu(25, 1), g2 = t2.g;
  flieg(t2, '0305'); g2.ship.x = 300; g2.ship.y = 300;
  const f2 = oeffne(g2, plan([b('konvoi', { parameter: { sieg: 'pluendern' } }), b('abschluss')])).f; startBeat(g2, f2); vorlauf(t2);
  for (const e of Konvoi.transporter(g2)) Testhilfe.toeten(g2, e);
  t2.run(0.5);
  ok(Fracht.draussen(g2).length >= 1, 'Beute liegt');
  g2.simSzene = { id: 3, phase: 'kampf' }; FS.update(g2, 1 / HZ); g2.simSzene = null;
  ok(!szene(g2) && Fracht.draussen(g2).length === 0 && Fracht.state(g2).draussen.filter((d) => d.szene === g2.ship.scene).length === 0 && !g2.space.konvoi && f2.phase === 'wartet' && f2.beat === 0, 'Unterbrechung: die Szene ist weg, keine Beute am Boden (der Beat steht wieder aus)');
});

section('(c5) Konvoi: Szenenwechsel, Andocken und Sim-Szene loesen die Szene auf; der Beat steht dann (wieder) aus, nichts bleibt haengen', () => {
  // Szenenwechsel (Sprung)
  { const t = neu(26, 3), g = t.g; const f = szeneStart(t, b('konvoi'), { fern: true }); vorlauf(t);
    const alt = g.space.enemies.length; ok(alt >= 3, 'der Konvoi ist da');
    flieg(t, '0205'); t.run(0.5);
    ok(!szene(g) && g.space.enemies.length === 0 && !g.space.konvoi && f.phase === 'wartet' && f.beat === 1 && f.nsc.status !== 'verbuendet', 'Sprung: gescheitert, Szene und Konvoi weg, der Faden geht weiter');
    t.run(4); ok(g.space.enemies.length === 0 && !szene(g), 'und es kommt nichts nach'); }
  // Andocken
  { const t = neu(27, 1), g = t.g; const f = szeneStart(t, b('konvoi'), { fern: true }); vorlauf(t);
    g.ship.docked = true; g.ship.dockedAt = g.ship.scene; g.missionEvent('docked', {});
    ok(!szene(g) && !g.space.konvoi && g.space.enemies.length === 0 && f.phase === 'wartet' && f.nsc.status !== 'verbuendet', 'Andocken (Hook am Ereignis): sofort gescheitert, aufgeraeumt'); }
  // Sim-Szene unterbricht: der Beat steht wieder aus, der Konvoi ist weg, kein Doppel-Spawn
  { const t = neu(28, 3), g = t.g; const f = szeneStart(t, b('konvoi'), { fern: true }); vorlauf(t);
    g.simSzene = { id: 5, phase: 'kampf' }; FS.update(g, 1 / HZ); g.simSzene = null;
    ok(!szene(g) && !g.space.konvoi && g.space.enemies.length === 0 && f.phase === 'wartet' && f.beat === 0 && f.zaehler === f.abstand, 'Sim-Szene: die Faden-Szene endet ohne Ausgang, der Beat steht wieder aus und ist sofort faellig');
    ok(startBeat(g, f).ok && szene(g) && szene(g).art === 'konvoi', 'er wird neu angeboten und beginnt neu');
    vorlauf(t); ok(Konvoi.transporter(g).length === SW.konvoi.anzahl['3'] && g.space.enemies.filter((e) => e.kv === 'f').length === SW.konvoi.anzahl['3'], 'genau EIN Konvoi (kein Doppel-Spawn)'); }
  // der Konvoi verschwindet (Szene verlassen durch ein anderes Modul): gescheitert, aufgeraeumt
  { const t = neu(33, 1), g = t.g; const f = szeneStart(t, b('konvoi'), { fern: true }); vorlauf(t);
    g.space.konvoi = null; t.run(0.2);
    ok(!szene(g) && g.space.enemies.length === 0 && f.phase === 'wartet' && f.nsc.status !== 'verbuendet', 'der Konvoi ist weg (Zustand): gescheitert, die uebrigen Schiffe werden abgeraeumt'); }
  // im Vorlauf gibt es noch keinen Konvoi dieser Szene: ein fremder (kein Beat) bleibt bei der Unterbrechung unberuehrt
  { const t = neu(34, 1), g = t.g; const f = szeneStart(t, b('konvoi'), { fern: true });
    ok(szene(g).phase === 'vorlauf', 'Vorlauf'); Konvoi.an(g, { n: 1, eskorte: 'keine', sieg: 'aufhalten', wiederholung: false });
    g.simSzene = { id: 9, phase: 'kampf' }; FS.update(g, 1 / HZ); g.simSzene = null;
    ok(!szene(g) && f.phase === 'wartet' && f.beat === 0 && !!g.space.konvoi && g.space.enemies.some((e) => e.kv === 'f'), 'Unterbrechung im Vorlauf: ein fremder Konvoi bleibt unberuehrt'); }
  // das Ziel der Lerche liegt auf einem Schiff der Szene: nach dem Ende ist es geloescht
  { const t = neu(35, 1), g = t.g; szeneStart(t, b('konvoi'), { fern: true }); vorlauf(t);
    g.ship.target = Konvoi.transporter(g)[0].id; g.simSzene = { id: 10, phase: 'kampf' }; FS.update(g, 1 / HZ); g.simSzene = null;
    ok(!szene(g) && g.ship.target === null, 'das Ziel der Lerche auf einem Schiff der Szene ist nach dem Ende geloescht'); }
  // Frist: die Szene ist laenger als die Frist des Beats (Taetigkeiten), sie laeuft weiter; max_s beendet sie
  { const t = neu(29, 1), g = t.g; const f = szeneStart(t, b('konvoi'), { fern: true }); vorlauf(t);
    g.fadenSzene.start -= SW.konvoi.max_s + 5; t.run(0.2);
    ok(!szene(g) && !g.space.konvoi && g.space.enemies.length === 0 && f.phase === 'wartet' && f.nsc.status !== 'verbuendet', 'Hoechstdauer max_s: gescheitert, aufgeraeumt'); }
});

section('(c6) Konvoi: Speichern mitten in der Szene (nicht speicherbar): nach dem Laden steht der Beat wieder aus, keine Szene, kein Konvoi, kein Doppel-Spawn; Stand schemagueltig', () => {
  const t = neu(30, 3), g = t.g;
  const f = szeneStart(t, b('konvoi'), { fern: true }); vorlauf(t);
  ok(szene(g) && szene(g).phase === 'kampf' && f.phase === 'laeuft', 'mitten im Kampf');
  const data = Weltstand.capture(g);
  ok(Weltstand.validate(data, g).filter((x) => /faeden|sabotage/.test(String(x))).length === 0, 'der Stand ist schemagueltig');
  ok(data.welt.sim.faeden.liste[0].phase === 'laeuft' && !JSON.stringify(data).includes('"konvoi":{') && !('fadenSzene' in data), 'gespeichert: der laufende Beat; von der Szene steht nichts im Stand');
  const t2 = neu(31, 3), g2 = t2.g;
  Kriegslage.restore(g2, JSON.parse(JSON.stringify(data.welt.sim)));
  const f2 = liste(g2)[0];
  ok(f2.phase === 'wartet' && f2.laufend === null && f2.beat === 0 && f2.zaehler === f2.abstand && !g2.fadenSzene && !g2.space.konvoi, 'nach dem Laden: der Beat steht wieder aus (wartet, faellig), keine Szene, kein Konvoi');
  flieg(t2, '0305'); g2.ship.x = 300; g2.ship.y = 300;
  ok(startBeat(g2, f2).ok && g2.fadenSzene && g2.fadenSzene.art === 'konvoi', 'er beginnt neu');
  vorlauf(t2); ok(g2.space.enemies.filter((e) => e.kv === 'f').length === SW.konvoi.anzahl['3'], 'genau ein Konvoi nach dem Laden');
  ok(g.errors === 0 && g2.errors === 0, 'keine Serverfehler');
});

// ---------------------------------------------------------------- (d) Geleit
const schuetzling = (g) => (g.space.escorts || []).find((q) => !q.ally) || null;
section('(d) Geleit (Modus geleit): Schuetzling fahrt, Angreifer greifen ihn an (angekuendigt), er kommt am Ziel an: gelungen; Schiff und Name aus dem NSC; aufgeraeumt', () => {
  const t = neu(40, 3), g = t.g;
  const f = szeneStart(t, b('geleit'), { fern: true });
  const s0 = szene(g), M = SW.geleit.modi.geleit;
  ok(s0.art === 'geleit' && s0.textKey === 'geleit' && s0.n === 3 && s0.n === M.angreifer['3'] && !schuetzling(g), 'Szene geleit im Vorlauf, angekuendigt: ' + M.angreifer['3'] + ' Angreifer, noch kein Schuetzling');
  ok(t.funk.some((x) => x.includes(f.nsc.name) && /Geleit/.test(x) && x.includes(' ' + M.angreifer['3'] + ' ')), 'Vorwarnung nennt den NSC (nicht einen Spieler) und die Zahl der Angreifer');
  vorlauf(t);
  const es = schuetzling(g);
  ok(es && es.tag === s0.tag && es.kind === M.kind && es.name === f.nsc.schiff && es.verhalten === 'folgt_kurs' && es.ziel && eigene(g).length === M.angreifer['3'], 'Schuetzling (' + M.kind + ', Name des Schiffs des NSC) mit Ziel, ' + M.angreifer['3'] + ' Angreifer mit dem Tag der Szene');
  ok(eigene(g).every((e) => e.kind === SW.geleit.angreifer.klasse && e.volk === SW.geleit.angreifer.volk && e.targetId === es.id), 'die Angreifer sind germanische Jaeger und greifen den Schuetzling an');
  const L = g.ship, p = Escort.point(g, 'ost'), q = Escort.point(g, 'west');
  const fern = Math.hypot(p.x - L.x, p.y - L.y) > Math.hypot(q.x - L.x, q.y - L.y) ? p : q;
  ok(Math.hypot(es.ziel.x - fern.x, es.ziel.y - fern.y) < 1, 'das Ziel liegt auf der weiter entfernten Seite');
  { const t3 = neu(55, 1), g3 = t3.g; flieg(t3, '0305'); g3.ship.x = g3.space.w - 300; g3.ship.y = 300;
    const f3 = oeffne(g3, plan([b('geleit'), b('abschluss')])).f; startBeat(g3, f3); vorlauf(t3);
    const e3 = schuetzling(g3); ok(e3 && e3.ziel && e3.ziel.x < g3.space.w / 2, 'steht die Lerche im Osten, liegt das Ziel im Westen (die weiter entfernte Seite)'); }
  for (const e of eigene(g)) Testhilfe.toeten(g, e);
  t.run(0.5);
  ok(!!szene(g), 'ohne Ankunft laeuft die Szene weiter');
  es.x = es.ziel.x; es.y = es.ziel.y; es.vx = 0; es.vy = 0; t.run(1);
  ok(!szene(g) && f.phase === 'wartet' && f.nsc.status === 'verbuendet' && es.arrived, 'am Ziel angekommen: gelungen, der NSC ist verbuendet');
  ok(t.funk.includes(SZ.texte.gelungen.geleit.replace('{name}', f.nsc.name)), 'Ergebnis per Funk');
  ok(!schuetzling(g) && !(g.space.escortsGone || []).some((x) => x.tag === s0.tag) && eigene(g).length === 0, 'aufgeraeumt: kein Schuetzling, keine Erinnerung, keine Angreifer');
  ok(f.nsc.gedaechtnis.some((x) => x.ereignis === 'geleit_gelungen') && g.errors === 0, 'Gedaechtnis geleit_gelungen, keine Serverfehler');
});

section('(d2) Geleit: der Schuetzling wird kampfunfaehig (oder die Zeit laeuft ab): gescheitert, der Faden aendert sich, nie Game Over', () => {
  const t = neu(41, 1), g = t.g;
  const f = szeneStart(t, b('geleit'), { fern: true }); vorlauf(t);
  const es = schuetzling(g);
  ok(eigene(g).length === 2 && eigene(g).length === SW.geleit.modi.geleit.angreifer['1'], 'eine Crew: ' + SW.geleit.modi.geleit.angreifer['1'] + ' Angreifer');
  Escort.hit(g, es, 9999, { src: 'test' }); t.run(1);
  ok(!szene(g) && f.phase === 'wartet' && f.beat === 1 && f.nsc.status !== 'verbuendet' && f.nsc.status !== 'tot', 'kampfunfaehig: gescheitert, der NSC ist ' + f.nsc.status + ' (nicht verbuendet, nicht tot)');
  ok(t.funk.includes(SZ.texte.gescheitert.geleit.replace('{name}', f.nsc.name)) && !schuetzling(g) && eigene(g).length === 0 && !g.gameOver, 'Ergebnis per Funk, aufgeraeumt, kein Game Over');
  const t2 = neu(42, 1), g2 = t2.g;
  const f2 = szeneStart(t2, b('geleit'), { fern: true }); vorlauf(t2);
  g2.fadenSzene.start -= SW.geleit.max_s + 5; t2.run(0.2);
  ok(!szene(g2) && !schuetzling(g2) && eigene(g2).length === 0 && f2.phase === 'wartet' && f2.nsc.status !== 'verbuendet', 'Hoechstdauer max_s: gescheitert, aufgeraeumt');
  ok(g.errors === 0 && g2.errors === 0, 'keine Serverfehler');
});

section('(d3) Geleit, Modus havarist (Notruf): der Schuetzling treibt, die Angreifer erledigen: gelungen; er wird kampfunfaehig: gescheitert', () => {
  const t = neu(43, 3), g = t.g, M = SW.geleit.modi.havarist;
  const { f } = (() => { flieg(t, '0305'); g.ship.x = 300; g.ship.y = 300; return oeffne(g, plan([b('geleit', { parameter: { modus: 'havarist' } }), b('abschluss')])); })();
  startBeat(g, f);
  ok(szene(g).textKey === 'havarist' && szene(g).n === 2 && szene(g).n === M.angreifer['3'] && t.funk.some((x) => /^Notruf von /.test(x) && x.includes(f.nsc.name)), 'Vorwarnung: Notruf des NSC, ' + M.angreifer['3'] + ' Angreifer');
  vorlauf(t);
  const es = schuetzling(g);
  ok(es.kind === M.kind && es.verhalten === 'treibt' && !es.ziel && es.hp === Math.round(es.hpMax * M.huelle / 100) && eigene(g).length === M.angreifer['3'], 'Havarist: ' + M.kind + ' treibt (Huelle ' + M.huelle + ' %), ohne Ziel, ' + M.angreifer['3'] + ' Angreifer');
  for (const e of eigene(g)) Testhilfe.toeten(g, e);
  t.run(1);
  ok(!szene(g) && f.phase === 'wartet' && f.nsc.status === 'verbuendet' && t.funk.includes(SZ.texte.gelungen.havarist.replace('{name}', f.nsc.name)), 'alle Angreifer weg, er treibt noch: gelungen');
  const t2 = neu(44, 1), g2 = t2.g;
  const f2 = (() => { flieg(t2, '0305'); g2.ship.x = 300; g2.ship.y = 300; return oeffne(g2, plan([b('geleit', { parameter: { modus: 'havarist' } }), b('abschluss')])).f; })();
  startBeat(g2, f2); vorlauf(t2);
  Escort.hit(g2, schuetzling(g2), 9999, { src: 'test' }); t2.run(1);
  ok(!szene(g2) && f2.phase === 'wartet' && f2.nsc.status !== 'verbuendet' && eigene(g2).length === 0 && t2.funk.includes(SZ.texte.gescheitert.havarist.replace('{name}', f2.nsc.name)), 'kampfunfaehig: gescheitert (Text havarist), die Angreifer sind weg');
  ok(g.errors === 0 && g2.errors === 0, 'keine Serverfehler');
});

section('(d4) Geleit, Modus panne (laengsseits flicken): die Reparatur gelingt, wenn die Lerche nah und langsam ist und niemand schiesst', () => {
  const t = neu(45, 1), g = t.g, M = SW.geleit.modi.panne;
  const f = (() => { flieg(t, '0305'); g.ship.x = 300; g.ship.y = 300; return oeffne(g, plan([b('geleit', { parameter: { modus: 'panne' } }), b('abschluss')])).f; })();
  startBeat(g, f); vorlauf(t);
  const es = schuetzling(g);
  ok(es.verhalten === 'treibt' && es.reparatur_s === 20 && es.reparatur_s === M.reparatur_s && !es.repaired && eigene(g).length === 1, 'Panne: treibt, Reparatur ' + M.reparatur_s + ' s, ' + M.angreifer['1'] + ' Angreifer');
  for (const e of eigene(g)) Testhilfe.toeten(g, e);
  t.run(0.5);
  ok(!!szene(g) && f.phase === 'laeuft', 'solange nicht repariert ist, laeuft die Szene');
  g.ship.x = es.x + 90; g.ship.y = es.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0;
  for (let i = 0; i < (M.reparatur_s + 8) * HZ && szene(g); i++) { g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0; g.step(); }
  t.run(0.5);
  ok(!szene(g) && f.phase === 'wartet' && f.nsc.status === 'verbuendet' && es.repaired, 'repariert: gelungen');
  ok(t.funk.includes(SZ.texte.gelungen.panne.replace('{name}', f.nsc.name)) && !schuetzling(g) && g.errors === 0, 'Ergebnis per Funk, aufgeraeumt, keine Serverfehler');
});

section('(d5a) Geleit: ein Schuetzling fehlt oder die Engine hat keinen Platz mehr; Havarist beim Sprung; fehlerhafte Wahl in einer Datei-Vorlage', () => {
  // die Engine kennt hoechstens zwei Schuetzlinge: ist kein Platz, scheitert die Szene beim Beginn, es kommen keine Angreifer
  { const t = neu(51, 1), g = t.g; flieg(t, '0305'); g.ship.x = 300; g.ship.y = 300;
    Escort.spawn(g, { tag: 'fremd1', kind: 'frachter', verhalten: 'treibt', von: 'lerche' }); Escort.spawn(g, { tag: 'fremd2', kind: 'frachter', verhalten: 'treibt', von: 'lerche' });
    let gespawnt = 0; const mo = g.missionEvent.bind(g); g.missionEvent = (name, d) => { if (name === 'enemySpawn') gespawnt++; return mo(name, d); };
    const f = oeffne(g, plan([b('geleit'), b('abschluss')])).f; startBeat(g, f); vorlauf(t); t.run(0.5);
    ok(!szene(g) && f.phase === 'wartet' && f.beat === 1 && f.nsc.status !== 'verbuendet' && g.space.enemies.length === 0 && (g.space.escorts || []).length === 2 && gespawnt === 0, 'kein Platz fuer einen Schuetzling: gescheitert, es wurde kein Angreifer gespawnt, die fremden Schuetzlinge bleiben'); }
  // der Schuetzling verschwindet (Zustand): gescheitert
  { const t = neu(52, 1), g = t.g; const f = szeneStart(t, b('geleit'), { fern: true }); vorlauf(t);
    g.space.escorts = []; t.run(0.2);
    ok(!szene(g) && f.phase === 'wartet' && f.nsc.status !== 'verbuendet' && eigene(g).length === 0, 'der Schuetzling ist weg (Zustand): gescheitert, die Angreifer werden abgeraeumt'); }
  // Havarist treibt und springt nicht mit: nach dem Sprung gibt es auch keine Erinnerung an ihn
  { const t = neu(53, 1), g = t.g; flieg(t, '0305'); g.ship.x = 300; g.ship.y = 300;
    const f = oeffne(g, plan([b('geleit', { parameter: { modus: 'havarist' } }), b('abschluss')])).f; startBeat(g, f); vorlauf(t);
    const tag = szene(g).tag; flieg(t, '0205'); t.run(0.5);
    ok(!szene(g) && !(g.space.escortsGone || []).some((x) => x.tag === tag) && !schuetzling(g), 'Havarist beim Sprung: keine Szene, kein Schuetzling, keine Erinnerung an ihn'); }
  // eine Datei-Vorlage nennt eine Wahl, die es nicht gibt: es gilt der Standard der Daten
  { const t = neu(54, 1), g = t.g; flieg(t, '0305'); g.ship.x = 300; g.ship.y = 300;
    const v1 = klon(BP.expandiere(plan([b('konvoi'), b('abschluss')])).vorlage); v1.id = 'b2_datei_konvoi'; v1.beats[0].parameter = { sieg: 'rammen' };
    const v2 = klon(BP.expandiere(plan([b('geleit'), b('abschluss')], { titel: 'ZEBRAKAI Geleit' })).vorlage); v2.id = 'b2_datei_geleit'; v2.beats[0].parameter = { modus: 'constructor' };
    ok(D.registriere(v1).ok && D.registriere(v2).ok, 'der Pruefer der Vorlage nimmt die Wahl an (kurzer Text), der Baustein haelt sich an die Daten');
    const oeff = (id) => { const a = X.angebot(g); const r = Faden.befehlAnwenden(g, { typ: 'faden_oeffnen', vorlage: id, parameter: { angebot: a.nr } }); return r.ok ? r.faden : null; };
    const f1 = oeff(v1.id); startBeat(g, f1);
    ok(szene(g).textKey === 'konvoi' && szene(g).plan.sieg === 'aufhalten', 'unbekannte Siegart: es gilt der Standard aufhalten');
    t.run(SW.vorlauf_s + 1); ok(g.space.konvoi && g.space.konvoi.sieg === 'aufhalten', 'der Konvoi laeuft mit dem Standard');
    flieg(t, '0205'); t.run(0.5); g.ship.x = 300; g.ship.y = 300; flieg(t, '0305'); g.ship.x = 300; g.ship.y = 300;
    const f2 = oeff(v2.id); startBeat(g, f2);
    ok(szene(g) && szene(g).art === 'geleit' && szene(g).plan.modus === 'geleit' && szene(g).textKey === 'geleit', 'ein Prototyp-Name als Modus: es gilt der Standard geleit');
    D.entferne(v1.id); D.entferne(v2.id);
    ok(g.errors === 0, 'keine Serverfehler'); }
});

section('(d5) Geleit: Szenenwechsel, Andocken, Sim-Szene und Speichern/Laden mitten in der Szene', () => {
  { const t = neu(46, 3), g = t.g; const f = szeneStart(t, b('geleit'), { fern: true }); vorlauf(t); const tag = szene(g).tag;
    flieg(t, '0205'); t.run(0.5);
    ok(!szene(g) && !schuetzling(g) && !g.space.enemies.some((e) => e.tag === tag) && f.phase === 'wartet' && f.nsc.status !== 'verbuendet', 'Sprung: gescheitert, Schuetzling und Angreifer weg (der Schuetzling springt nicht mit)'); }
  { const t = neu(47, 1), g = t.g; const f = szeneStart(t, b('geleit'), { fern: true }); vorlauf(t);
    g.ship.docked = true; g.ship.dockedAt = g.ship.scene; g.missionEvent('docked', {});
    ok(!szene(g) && !schuetzling(g) && eigene(g).length === 0 && f.phase === 'wartet', 'Andocken: sofort gescheitert, aufgeraeumt'); }
  { const t = neu(48, 3), g = t.g; const f = szeneStart(t, b('geleit'), { fern: true }); vorlauf(t);
    g.simSzene = { id: 7, phase: 'kampf' }; FS.update(g, 1 / HZ); g.simSzene = null;
    ok(!szene(g) && !schuetzling(g) && eigene(g).length === 0 && f.phase === 'wartet' && f.beat === 0 && f.zaehler === f.abstand, 'Sim-Szene: die Szene endet ohne Ausgang, der Beat steht wieder aus');
    startBeat(g, f); vorlauf(t); ok((g.space.escorts || []).filter((q) => !q.ally).length === 1 && g.space.enemies.filter((e) => e.tag === szene(g).tag).length === SW.geleit.modi.geleit.angreifer['3'], 'neu begonnen: genau ein Schuetzling, keine doppelten Angreifer'); }
  { const t = neu(49, 3), g = t.g; const f = szeneStart(t, b('geleit'), { fern: true }); vorlauf(t);
    const data = Weltstand.capture(g);
    ok(Weltstand.validate(data, g).filter((x) => /faeden/.test(String(x))).length === 0 && !JSON.stringify(data.welt.sim).includes(f.nsc.schiff + '","hp'), 'gespeichert mitten in der Szene: schemagueltig, kein Schuetzling im Stand');
    const t2 = neu(50, 3), g2 = t2.g; Kriegslage.restore(g2, JSON.parse(JSON.stringify(data.welt.sim)));
    const f2 = liste(g2)[0];
    ok(f2.phase === 'wartet' && f2.beat === 0 && f2.zaehler === f2.abstand && !g2.fadenSzene && !schuetzling(g2), 'nach dem Laden: der Beat steht wieder aus, keine Szene, kein Schuetzling');
    ok(g.errors === 0 && g2.errors === 0, 'keine Serverfehler'); }
});

// ---------------------------------------------------------------- (e) Sabotage
section('(e) Sabotage: Lage (Ziel, Rang, Ruf-Sperre je Hex, Pause); ohne Ziel wird der Auftrag weder angeboten noch geoeffnet, mit eigenen Codes', () => {
  const t = neu(60, 3), g = t.g; flieg(t, '0305');
  const p = plan([b('sabotage'), b('abschluss')]);
  const abg = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  ok(!abg.ok && /^LAGE_ZIEL_FEHLT:/.test(abg.grund) && B2.lage('sabotage_ziel').zahl(g) === 0, 'ohne germanischen Posten: LAGE_ZIEL_FEHLT, die Zahl ist 0');
  ok(logbuch(g).some((e) => e.art === 'faden_pruefung' && /LAGE_ZIEL_FEHLT/.test(JSON.stringify(e.fehler))), 'die Ablehnung steht im Logbuch');
  postenSetzen(g, '0703', 'ger');
  const altRang = PW.mindestrang.wert.angreifen; PW.mindestrang.wert.angreifen = 'centurio'; g.weltsim.ruf.rom = rangAb('centurio') - 1;   // der Mechanismus: der Rang steht in den Daten (Standard miles, den hat jede Crew), wie tools/test-sprengen.js
  const a2 = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  ok(!a2.ok && /^LAGE_ZIEL_FEHLT:.*Rang/.test(a2.grund) && B2.lage('sabotage_ziel').zahl(g) === 0, 'mit Posten, aber ohne den Rang zum Angreifen: LAGE_ZIEL_FEHLT (Rang), die Zahl ist 0');
  g.weltsim.ruf.rom = rangAb('centurio'); ok(B2.lage('sabotage_ziel').zahl(g) === 1, 'Rang genau erreicht: ein Ziel');
  PW.mindestrang.wert.angreifen = altRang; g.weltsim.ruf.rom = 0;
  rang(g, 'miles');
  ok(B2.ziele(g).length === 1 && B2.ziele(g)[0].hex === '0703' && B2.lage('sabotage_ziel').zahl(g) === 1, 'mit Posten und Rang: ein Ziel (0703, Eisfeld)');
  const a3 = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  ok(a3.ok, 'der Auftrag wird angeboten');
  // Piraten-, Konkordat- und Rom-Posten und ein Posten ohne Quelle sind kein Ziel
  postenSetzen(g, '0703', 'pirat'); ok(B2.ziele(g).length === 0, 'ein Piratenposten ist kein Ziel (nur germanische Versorgungsposten)');
  postenSetzen(g, '0703', 'kon'); ok(B2.ziele(g).length === 0, 'ein Konkordat-Posten ist kein Ziel');
  postenSetzen(g, '0703', 'rom'); ok(B2.ziele(g).length === 0, 'ein roemischer Posten ist kein Ziel');
  postenSetzen(g, '0703', 'ger'); postenSetzen(g, '0602', 'ger'); ok(B2.ziele(g).length === 1 && B2.ziele(g)[0].hex === '0703', 'Altrost (0602) hat keine Quelle: ein germanischer Posten dort ist kein Versorgungsposten');
  Object.assign(g.weltsim.zustand.hexe['0703'], { crew: true }); ok(B2.ziele(g).length === 0, 'ein Posten der Crew ist kein Ziel'); delete g.weltsim.zustand.hexe['0703'].crew;
  // Ruf-Sperre je Hex der Sim: ein Hex in der Sperre ist kein Ziel
  g.weltsim.sprengungen['0703'] = g.weltsim.zustand.tick;
  ok(Posten.sprengungGesperrt(g, '0703') && B2.ziele(g).length === 0, 'Ruf-Sperre der Sim (' + PW.sprengen.wert.ruf_sperre_ticks + ' Ticks) am Hex: kein Ziel');
  postenSetzen(g, '0505', 'ger'); ok(B2.ziele(g).length === 1 && B2.ziele(g)[0].hex === '0505', 'ein zweiter Quell-Hex (0505) ist ein Ziel, der gesperrte nicht (Sperre je Hex)');
  const a4 = Faden.abenteuerOeffnen(g, a3.angebot.nr);
  ok(a4.ok, 'das Angebot laesst sich oeffnen, solange irgendein Ziel steht');
  delete g.weltsim.sprengungen['0703']; g.weltsim.zustand.hexe['0505'].posten = false; g.weltsim.zustand.hexe['0505'].besitzer = null; g.weltsim.zustand.hexe['0703'].posten = false; g.weltsim.zustand.hexe['0703'].besitzer = null;
  const p2 = plan([b('sabotage'), b('abschluss')], { titel: 'ZEBRAKAI Zwei' });
  const hx = Faden.abenteuerAnbieten(g, p2, { hex: '0305' });
  ok(!hx.ok && /^LAGE_ZIEL_FEHLT:/.test(hx.grund), 'Posten weg: nicht angeboten');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('(e2) Sabotage: das Angebot veraltet (Ziel weg beim Oeffnen): Ablehnung LAGE_ZIEL_FEHLT; die Pause: SABOTAGE_PAUSE (Angebot und Oeffnen)', () => {
  const t = neu(61, 3), g = t.g; flieg(t, '0305');
  postenSetzen(g, '0703', 'ger'); rang(g, 'miles');
  const a = Faden.abenteuerAnbieten(g, plan([b('sabotage'), b('abschluss')]), { hex: '0305' });
  ok(a.ok, 'angeboten');
  g.weltsim.zustand.hexe['0703'].posten = false; g.weltsim.zustand.hexe['0703'].besitzer = null;
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr);
  ok(!r.ok && /^LAGE_ZIEL_FEHLT:/.test(r.grund) && liste(g).length === 0, 'Oeffnen mit weggefallenem Ziel: abgelehnt, kein Faden');
  postenSetzen(g, '0703', 'ger');
  const r2 = Faden.abenteuerOeffnen(g, a.angebot.nr);
  ok(r2.ok, 'steht das Ziel wieder, oeffnet das Angebot');
  const f = r2.f || r2.faden; startBeat(g, f);
  ok(f.phase === 'laeuft' && g.weltsim.faeden.sabotage && g.weltsim.faeden.sabotage.n === 1 && g.weltsim.faeden.sabotage.t === g.weltsim.tickZahl, 'der Beat laeuft; der Stand haelt Tick und Zahl (n 1)');
  const pa = Faden.abenteuerAnbieten(g, plan([b('sabotage'), b('geleit'), b('abschluss')], { titel: 'ZEBRAKAI Pause' }), { hex: '0305' });
  ok(!pa.ok && /^SABOTAGE_PAUSE:/.test(pa.grund) && B2.pauseNoch(g) && B2.lage('sabotage_ziel').zahl(g) === 0, 'in der Pause: SABOTAGE_PAUSE beim Anbieten, die Zahl im Kontext ist 0');
  g.weltsim.tickZahl += 79; ok(B2.pauseNoch(g), 'noch einen Tick vor dem Ende der Pause (80 Ticks): gesperrt');
  g.weltsim.tickZahl += 1; ok(!B2.pauseNoch(g), 'nach pause_ticks Ticks: frei');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('(e3) Sabotage spielen: der Beat nennt das Ziel; die Crew SPRENGT den Posten wirklich (Posten angreifen); gelungen, Ereignis posten_verloren, die Sim wird nicht angefasst', () => {
  const t = neu(62, 1), g = t.g; flieg(t, '0305');
  postenSetzen(g, '0703', 'ger'); rang(g, 'miles');
  const { f } = oeffne(g, plan([b('sabotage'), b('abschluss')]));
  const vorSim = JSON.stringify(g.weltsim.zustand.hexe['0505']);
  const r = startBeat(g, f);
  ok(r.ok && f.phase === 'laeuft' && f.parameter.ort === '0703' && !szene(g), 'der Beat laeuft, das Ziel ist der Hex 0703 (steht in f.parameter.ort), keine Faden-Szene');
  ok(t.funk.includes(TX.texte.sabotage_start.replace('{ort}', Sektoren.hexName('0703'))), 'Funk: der Posten bei Eisfeld versorgt ihre Flotte (Text aus den Daten)');
  ok(g.weltsim.faeden.sabotage && g.weltsim.faeden.sabotage.n === 1 && g.weltsim.zustand.hexe['0703'].posten === true, 'der Posten steht noch; die Pause laeuft');
  ok(WERTE.folge_typen.wert.every((x) => x !== 'posten_gesprengt') && JSON.stringify(f.plan.beats[0]).indexOf('posten_gesprengt') < 0, 'der Beat hat keine Sim-Folge (kein posten_gesprengt in der Vorlage)');
  const tz = g.weltsim.tickZahl;
  const fehler = sprengen(t, '0703');
  ok(!fehler, 'die Crew hat den Posten gesprengt (Sim-Szene Posten angreifen bis zum Sieg)' + (fehler ? ': ' + fehler : ''));
  ok(g.weltsim.zustand.hexe['0703'].posten === false && g.weltsim.tickZahl === tz + 1 && g.weltsim.zustand.tick === g.weltsim.tickZahl, 'der Posten ist weg, genau ein Tick (tickZahl und Sim-Tick sind gleich)');
  ok(f.phase === 'wartet' && f.beat === 1 && f.nsc.status === 'verbuendet' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'sabotage_gelungen'), 'der Beat ist gelungen (Ereignis posten_verloren durch rom am Ziel), der NSC ist verbuendet');
  ok(t.funk.includes(TX.texte.sabotage_gelungen.replace('{ort}', Sektoren.hexName('0703'))), 'Funk: der Posten ist gefallen');
  ok(g.weltsim.faeden.sabotage.n === 1 && JSON.stringify(g.weltsim.zustand.hexe['0505']) === vorSim, 'der Beat hat keinen zusaetzlichen Angriff der Sim gebaut (ein anderer Hex bleibt unveraendert)');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('(e4) Sabotage: Ziel weg ohne die Crew: gescheitert; Frist (12 Taetigkeiten, nicht 6); Fallback beim Beginn (Ziel weg, Pause)', () => {
  // Ziel verschwindet ohne die Crew
  { const t = neu(63, 1), g = t.g; flieg(t, '0305'); postenSetzen(g, '0703', 'ger'); rang(g, 'miles');
    const { f } = oeffne(g, plan([b('sabotage'), b('abschluss')])); startBeat(g, f);
    g.weltsim.zustand.hexe['0703'].posten = false; g.weltsim.zustand.hexe['0703'].besitzer = null; t.run(0.2);
    ok(f.phase === 'wartet' && f.beat === 1 && f.nsc.status !== 'verbuendet' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'sabotage_gescheitert') && t.funk.includes(TX.texte.sabotage_ziel_weg.replace('{ort}', Sektoren.hexName('0703'))), 'der Posten ist ohne die Crew verschwunden: gescheitert (Text sabotage_ziel_weg), der Faden aendert sich');
    ok(f.nsc.status === 'aktiv' || f.nsc.status === 'geflohen', 'der NSC ist ' + f.nsc.status); }
  // Frist: 12 Taetigkeiten
  { const t = neu(64, 1), g = t.g; flieg(t, '0305'); postenSetzen(g, '0703', 'ger'); rang(g, 'miles');
    const { f } = oeffne(g, plan([b('sabotage'), b('abschluss')])); startBeat(g, f);
    grenzen(g, FRIST + 2, 'szene_ende'); ok(f.phase === 'laeuft', 'nach beat_frist (' + FRIST + ') + 2 Taetigkeiten laeuft der Beat noch (eigene Frist 12)');
    grenzen(g, 12 - FRIST - 2 + 1, 'szene_ende'); t.run(0.1);
    ok(f.phase === 'wartet' && f.beat === 1 && f.nsc.gedaechtnis.some((x) => x.ereignis === 'sabotage_gescheitert'), 'nach 12 Taetigkeiten: die Frist scheitert den Beat, der Faden lebt'); }
  // Fallback beim Beginn: das Ziel ist zwischen Oeffnen und Beginn weg: sofort gescheitert, Faden aendert sich
  { const t = neu(65, 1), g = t.g; flieg(t, '0305'); postenSetzen(g, '0703', 'ger'); rang(g, 'miles');
    const { f } = oeffne(g, plan([b('sabotage'), b('abschluss')]));
    g.weltsim.zustand.hexe['0703'].posten = false; g.weltsim.zustand.hexe['0703'].besitzer = null;
    const r = startBeat(g, f);
    ok(r.ok && f.phase === 'wartet' && f.beat === 1 && f.nsc.status !== 'verbuendet' && !g.weltsim.faeden.sabotage && f.nsc.gedaechtnis.some((x) => x.ereignis === 'sabotage_gescheitert'), 'Ziel fehlt beim Beginn: der Beat scheitert SOFORT (der Faden aendert sich, die Pause beginnt nicht)');
    ok(t.funk.includes(TX.texte.sabotage_kein_ziel) && logbuch(g).some((e) => e.art === 'faden_baustein' && /Sabotage: kein Ziel/.test(e.begruendung || '')), 'Funk und Logbuch nennen den Grund'); }
  // Pause beim Beginn: zwei Sabotage-Beats in einem Plan; der zweite beginnt in der Pause des ersten und scheitert sofort (die Pause haelt nach dem Stand der Sim, nicht nach dem Plan)
  { const t = neu(66, 1), g = t.g; flieg(t, '0305'); postenSetzen(g, '0703', 'ger'); postenSetzen(g, '0505', 'ger'); rang(g, 'miles');
    const f = oeffne(g, plan([b('sabotage'), b('sabotage'), b('abschluss')])).f; startBeat(g, f);
    ok(f.phase === 'laeuft' && g.weltsim.faeden.sabotage.n === 1, 'der erste Auftrag laeuft, die Pause beginnt (n 1)');
    g.weltsim.zustand.hexe[f.parameter.ort].posten = false; g.weltsim.zustand.hexe[f.parameter.ort].besitzer = null; t.run(0.2);
    ok(f.phase === 'wartet' && f.beat === 1, 'der erste Auftrag endet (Ziel weg), der zweite steht an');
    const r2 = startBeat(g, f);
    ok(r2.ok && f.phase === 'wartet' && f.beat === 2 && g.weltsim.faeden.sabotage.n === 1 && t.funk.includes(TX.texte.sabotage_pause), 'der zweite Beat beginnt in der Pause und scheitert sofort (Text sabotage_pause), n bleibt 1: nie zwei Sprengungen je Pause');
    ok(f.nsc.gedaechtnis.filter((x) => x.ereignis === 'sabotage_gescheitert').length === 2 && f.nsc.status !== 'tot' && !g.gameOver && g.errors === 0, 'beide gescheitert, der Faden lebt weiter, kein Game Over'); }
});

section('(e5) Sabotage: Speichern und Laden mitten im Beat (der Beat ist speicherbar, kein Szenen-Beat); der Block sabotage im Weltstand; Altstand und Muell', () => {
  const t = neu(67, 1), g = t.g; flieg(t, '0305'); postenSetzen(g, '0703', 'ger'); rang(g, 'miles');
  const { f } = oeffne(g, plan([b('sabotage'), b('abschluss')])); startBeat(g, f);
  const data = Weltstand.capture(g);
  ok(Weltstand.validate(data, g).filter((x) => /faeden|sabotage/.test(String(x))).length === 0, 'der Stand ist schemagueltig');
  { const m = JSON.parse(JSON.stringify(data)); m.welt.sim.faeden.sabotage.extra = 1; ok(Weltstand.validate(m, g).some((x) => /sabotage|extra/.test(String(x))), 'ein fremdes Feld im Block sabotage lehnt das Schema ab'); }
  const bl = data.welt.sim.faeden;
  ok(bl.sabotage && bl.sabotage.n === 1 && bl.sabotage.t === g.weltsim.tickZahl && bl.liste[0].phase === 'laeuft' && bl.liste[0].parameter.ort === '0703', 'gespeichert: der laufende Beat, das Ziel (parameter.ort) und der Block sabotage { t, n }');
  ok(data.welt.sim.faeden.liste[0].laufend.beat === 'b1_sabotage' || /sabotage/.test(data.welt.sim.faeden.liste[0].laufend.beat), 'der Beat steht im Faden');
  const t2 = neu(68, 1), g2 = t2.g;
  Kriegslage.restore(g2, JSON.parse(JSON.stringify(data.welt.sim)));
  const f2 = liste(g2)[0];
  ok(f2.phase === 'laeuft' && f2.parameter.ort === '0703' && g2.weltsim.faeden.sabotage && g2.weltsim.faeden.sabotage.n === 1 && B2.pauseNoch(g2), 'nach dem Laden: derselbe Beat laeuft weiter, dasselbe Ziel, die Pause gilt');
  const z2 = g2.weltsim.zustand; Object.assign(z2.hexe['0703'], { besitzer: 'ger', posten: true, garnison: 4, anspruch: {} }); g2.weltsim.ruf.rom = rangAb('miles'); t2.run(0.1);
  ok(f2.phase === 'laeuft', 'der Posten steht: der Beat wartet');
  // die Sprengung nach dem Laden: der Ring der Ereignisse ist nicht gespeichert, die Sprengung steht im Stand (welt.sim.sprengungen)
  const fehler = sprengen(t2, '0703');
  ok(!fehler && f2.phase === 'wartet' && f2.beat === 1 && f2.nsc.status === 'verbuendet', 'im geladenen Spiel gesprengt: der Beat ist gelungen' + (fehler ? ' (' + fehler + ')' : ''));
  // Sprengung ZWISCHEN Speichern und Laden (der Ring ist leer): der Stand der Sim (sprengungen) genuegt
  const t3 = neu(69, 1), g3 = t3.g; flieg(t3, '0305'); postenSetzen(g3, '0703', 'ger'); rang(g3, 'miles');
  const f3 = oeffne(g3, plan([b('sabotage'), b('abschluss')])).f; startBeat(g3, f3);
  const d3 = JSON.parse(JSON.stringify(Weltstand.capture(g3).welt.sim));
  d3.sprengungen = { '0703': d3.zustand.tick + 1 }; d3.zustand.tick += 1; d3.tick += 1; d3.zustand.hexe['0703'] = Object.assign({}, d3.zustand.hexe['0703'], { posten: false, besitzer: null, garnison: 0 });
  const t4 = neu(70, 1), g4 = t4.g; Kriegslage.restore(g4, d3); t4.run(0.1);
  const f4 = liste(g4)[0];
  ok(f4.phase === 'wartet' && f4.beat === 1 && f4.nsc.status === 'verbuendet', 'die Sprengung steht im Stand, der Ring ist leer: der Beat ist gelungen (Sprengung der Crew nach dem Beginn)');
  // Altstand: ohne Block sabotage; Muell im Block faellt weg
  const alt = JSON.parse(JSON.stringify(data.welt.sim)); delete alt.faeden.sabotage;
  const t5 = neu(71, 1); Kriegslage.restore(t5.g, alt);
  ok(!t5.g.weltsim.faeden.sabotage && !B2.pauseNoch(t5.g) && liste(t5.g).length === 1, 'Altstand ohne Block: keine Pause, der Faden bleibt');
  for (const muell of [{ t: -1, n: 1 }, { t: 1.5, n: 1 }, { t: 1, n: 0 }, { t: 1 }, 'x', [1], { t: 1, n: 1e9 }, null]) {
    const m = JSON.parse(JSON.stringify(data.welt.sim)); m.faeden.sabotage = muell;
    const t6 = neu(72, 1); Kriegslage.restore(t6.g, m);
    ok(!t6.g.weltsim.faeden.sabotage && liste(t6.g).length === 1 && t6.g.errors === 0, 'Muell im Block (' + JSON.stringify(muell) + '): faellt weg, der Faden bleibt, kein Absturz');
  }
  ok(B2.lesen({ t: 5, n: 2 }) && B2.lesen({ t: 5, n: 2 }).t === 5 && B2.lesen(JSON.parse('{"__proto__":{"t":1},"t":3,"n":1}')).t === 3, 'der Leser nimmt gueltige Werte (auch mit Prototyp-Schluessel im Objekt)');
  ok(JSON.stringify(Weltstand.capture(g).welt.sim.faeden.sabotage) === JSON.stringify({ t: g.weltsim.tickZahl, n: 1 }) && JSON.stringify(Object.keys(JSON.parse(JSON.stringify(Weltstand.capture(g).welt.sim.faeden)))).includes('sabotage'), 'der Block ist additiv; die Version des Weltstands bleibt ' + Weltstand.capture(g).version);
  ok(Weltstand.capture(g).version === 3, 'Weltstand-Version 3');
});

section('(e6) Sabotage: die Grenzen des Ereignisses (Tick, Hex, Besitzer, Art); ein uebernommener Posten ist weg; faden_oeffnen einer Datei-Vorlage fragt die Lage', () => {
  const start = () => { const t = neu(90, 1), g = t.g; flieg(t, '0305'); postenSetzen(g, '0703', 'ger'); rang(g, 'miles'); const f = oeffne(g, plan([b('sabotage'), b('abschluss')])).f; startBeat(g, f); return { t, g, f }; };
  const ev = (g, o) => g.weltsim.ereignisse.push(Object.assign({ n: 0, typ: 'posten_verloren', tick: 0, fraktion: 'ger', ort: '0703', ortName: 'Eisfeld', besitzer: 'ger', durch: 'rom' }, o));
  { const { t, g, f } = start(); const seit = f.laufend.seit;
    ev(g, { n: seit }); t.run(0.1); ok(f.phase === 'laeuft', 'ein Ereignis aus dem Tick des Beginns zaehlt nicht (es war vorher)');
    ev(g, { n: seit + 1, ort: '0505' }); t.run(0.1); ok(f.phase === 'laeuft', 'ein Verlust an einem anderen Hex zaehlt nicht');
    ev(g, { n: seit + 1, durch: 'pirat' }); t.run(0.1); ok(f.phase === 'laeuft', 'ein Verlust an Piraten zaehlt nicht (nur durch rom)');
    ev(g, { n: seit + 1, typ: 'hafen_gefallen' }); t.run(0.1); ok(f.phase === 'laeuft', 'ein anderes Ereignis zaehlt nicht');
    g.weltsim.sprengungen['0703'] = seit; t.run(0.1); ok(f.phase === 'laeuft', 'eine Sprengung aus dem Tick des Beginns zaehlt nicht (Stand der Sim)');
    ev(g, { n: seit + 1 }); t.run(0.1); ok(f.phase === 'wartet' && f.beat === 1 && f.nsc.status === 'verbuendet', 'der Verlust an Rom am Ziel nach dem Beginn: gelungen'); }
  { const { t, g, f } = start(); g.weltsim.sprengungen['0703'] = f.laufend.seit + 1; t.run(0.1); ok(f.phase === 'wartet' && f.beat === 1 && f.nsc.status === 'verbuendet', 'ohne Ereignis (nach dem Laden) genuegt die Sprengung der Crew im Stand'); }
  for (const neuer of ['pirat', 'kon', 'rom']) { const { t, g, f } = start(); g.weltsim.zustand.hexe['0703'].besitzer = neuer; t.run(0.1); ok(f.phase === 'wartet' && f.nsc.status !== 'verbuendet' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'sabotage_gescheitert'), 'der Posten gehoert nun ' + neuer + ' (nicht mehr germanisch): das Ziel ist weg, gescheitert'); }
  { const { t, g, f } = start(); ok(f.parameter.ort === '0703' && D.vorlage(f.vorlage).beats[0].parameter === undefined, 'der Plan nennt das Ziel nicht, es steht im Faden'); g.weltsim.zustand.hexe['0703'].garnison = 0; t.run(0.1); ok(f.phase === 'laeuft', 'eine schwache Garnison aendert nichts: der Beat wartet auf die Sprengung'); }
  // ein Faden aus einer Datei-Vorlage mit sabotage: faden_oeffnen fragt die Lage wie das Abenteuer
  { const t = neu(91, 1), g = t.g; flieg(t, '0305');
    const v = klon(BP.expandiere(plan([b('sabotage'), b('abschluss')])).vorlage); v.id = 'b2_datei_sabotage';
    const r = D.registriere(v); ok(r.ok, 'die Vorlage mit sabotage besteht den Pruefer der Vorlage');
    const a = X.angebot(g);
    const bt = { typ: 'faden_oeffnen', vorlage: v.id, parameter: { angebot: a.nr } };
    ok(/^LAGE_ZIEL_FEHLT:/.test(Faden.befehlPruefen(g, bt) || '') && /^LAGE_ZIEL_FEHLT:/.test(Faden.befehlAnwenden(g, bt).grund || '') && liste(g).length === 0, 'faden_oeffnen ohne Ziel: abgelehnt (Pruefen und Anwenden), kein Faden');
    postenSetzen(g, '0703', 'ger'); rang(g, 'miles');
    ok(Faden.befehlPruefen(g, bt) === null && Faden.befehlAnwenden(g, bt).ok && liste(g).length === 1, 'mit Ziel: geoeffnet');
    D.entferne(v.id); }
});

section('(e7) Sabotage: Ziele im Einzelnen (Hex ohne Posten, Hafen, Hex ohne Quelle, Reichweite, Reihenfolge, Zahl); die Wahl kommt aus dem eigenen Strom; Beginn ohne Rang und ohne Funk; die Zahl der Auftraege im Stand', () => {
  const t = neu(95, 1), g = t.g; flieg(t, '0305'); rang(g, 'miles');
  const z = g.weltsim.zustand.hexe, hexe = (g2) => B2.ziele(g2).map((x) => x.hex).join();
  Object.assign(z['0703'], { besitzer: 'ger', posten: false, garnison: 0 }); ok(B2.ziele(g).length === 0, 'ein Hex in germanischer Hand ohne Posten ist kein Ziel');
  Object.assign(z['0703'], { besitzer: null, posten: false });
  postenSetzen(g, '0603', 'ger'); ok(B2.ziele(g).length === 0, 'Kantenstein (0603, 5 Spruenge) hat keine Quelle: ein germanischer Posten dort ist kein Versorgungsposten');
  const alt = JSON.stringify(z['0604']); Object.assign(z['0604'], { besitzer: 'ger', posten: true, garnison: 0 }); ok(B2.ziele(g).length === 0, 'ein Hafen (0604, mit Quelle) ist kein Ziel, auch mit Besitzer ger und Posten-Merkmal'); Object.assign(z['0604'], JSON.parse(alt));
  postenSetzen(g, '0705', 'ger'); postenSetzen(g, '0503', 'ger'); postenSetzen(g, '0505', 'ger');
  ok(hexe(g) === '0505,0503,0705', 'die Ziele stehen nach Spruengen, bei gleicher Entfernung nach Hex: ' + hexe(g));
  ok(B2.lage('sabotage_ziel').zahl(g) === 3, 'die Zahl im Kontext ist die Zahl der Ziele (3)');
  const emax = D.B2.werte.sabotage.erreichbar_max; D.B2.werte.sabotage.erreichbar_max = 2; const nah = hexe(g); D.B2.werte.sabotage.erreichbar_max = emax;
  ok(nah === '0505', 'nur Ziele in Reichweite (erreichbar_max 2 Spruenge): ' + nah);
  // die Wahl des Ziels kommt aus dem eigenen Strom der Faeden: ueber mehrere Spiele kommen beide Ziele vor
  const gewaehlt = new Set();
  for (let seed = 1; seed <= 14; seed++) {
    const t2 = neu(200 + seed, 1), g2 = t2.g; flieg(t2, '0305'); rang(g2, 'miles'); postenSetzen(g2, '0505', 'ger'); postenSetzen(g2, '0703', 'ger');
    const f = oeffne(g2, plan([b('sabotage'), b('abschluss')])).f; startBeat(g2, f); gewaehlt.add(f.parameter.ort);
  }
  ok(gewaehlt.has('0505') && gewaehlt.has('0703') && gewaehlt.size === 2, 'bei zwei Zielen werden ueber 14 Spiele beide gewaehlt (eigener Strom, nie nur das naechste): ' + Array.from(gewaehlt).join(', '));
  // Beginn ohne Rang: das Angebot stand, der Rang ist inzwischen weg (Ruf gesunken): sofort gescheitert, keine Pause
  { const t3 = neu(96, 1), g3 = t3.g; flieg(t3, '0305'); rang(g3, 'miles'); postenSetzen(g3, '0703', 'ger');
    const f = oeffne(g3, plan([b('sabotage'), b('abschluss')])).f;
    const altRang = PW.mindestrang.wert.angreifen; PW.mindestrang.wert.angreifen = 'centurio'; g3.weltsim.ruf.rom = rangAb('centurio') - 1;
    startBeat(g3, f); PW.mindestrang.wert.angreifen = altRang;
    ok(f.phase === 'wartet' && f.beat === 1 && !g3.weltsim.faeden.sabotage && t3.funk.includes(TX.texte.sabotage_kein_ziel), 'Beginn ohne den Rang: sofort gescheitert, keine Pause'); }
  // Beginn ohne Funk (kein Text): der Beat laeuft nicht, keine Pause
  { const t3 = neu(97, 1), g3 = t3.g; flieg(t3, '0305'); rang(g3, 'miles'); postenSetzen(g3, '0703', 'ger');
    const f = oeffne(g3, plan([b('sabotage'), b('abschluss')])).f;
    const text = D.B2.texte.sabotage_start; D.B2.texte.sabotage_start = ' '; startBeat(g3, f); D.B2.texte.sabotage_start = text;
    ok(f.phase === 'wartet' && f.beat === 1 && !g3.weltsim.faeden.sabotage && f.parameter.ort !== '0703', 'ohne Funk kein Beat: gescheitert, keine Pause, das Ziel steht nicht im Faden'); }
  // die Zahl der Sabotage-Beats und der Tick des Beginns im Stand
  { const t3 = neu(98, 1), g3 = t3.g; flieg(t3, '0305'); rang(g3, 'miles'); postenSetzen(g3, '0703', 'ger'); postenSetzen(g3, '0505', 'ger'); g3.weltsim.tickZahl = 7;
    const f = oeffne(g3, plan([b('sabotage'), b('sabotage'), b('abschluss')])).f; startBeat(g3, f);
    ok(JSON.stringify(g3.weltsim.faeden.sabotage) === '{"t":7,"n":1}', 'der Stand haelt den Tick des Beginns und n 1: ' + JSON.stringify(g3.weltsim.faeden.sabotage));
    const ort1 = f.parameter.ort; g3.weltsim.zustand.hexe[ort1].posten = false; g3.weltsim.zustand.hexe[ort1].besitzer = null; t3.run(0.2);
    g3.weltsim.tickZahl = 7 + 80; postenSetzen(g3, ort1 === '0703' ? '0505' : '0703', 'ger'); startBeat(g3, f);
    ok(f.phase === 'laeuft' && JSON.stringify(g3.weltsim.faeden.sabotage) === '{"t":87,"n":2}', 'nach der Pause beginnt der naechste Auftrag: n 2, neuer Tick: ' + JSON.stringify(g3.weltsim.faeden.sabotage)); }
  ok(g.errors === 0, 'keine Serverfehler');
});

// ---------------------------------------------------------------- (g) Katalog: Umsetzungen, die in der Freien Fahrt spielbar sind
section('(g) Katalog (Moleküle): fuenf Weltraum-Umsetzungen sind auf sund_frei spielbar (Feld sund_frei); jede wird ueber den Beat WIRKLICH gespielt, die Zuordnung steht im Katalog', () => {
  const Kat = require('./katalog.js'), MK = require('../server/mission/katalog.js');
  const k = Kat.load({ mods: [] });
  ok(k.fehler.length === 0, 'der Katalog laedt ohne Fehler (Schema und Querverweise): ' + k.fehler.slice(0, 2).map((x) => x.msg).join('; '));
  const us = Object.values(k.molekuele).flatMap((m) => m.umsetzungen.map((u) => Object.assign({ mol: m.id }, u))).filter((u) => u.sund_frei);
  const ids = us.map((u) => u.mol + '/' + u.id + ' = ' + u.sund_frei.beat + ' ' + JSON.stringify(u.sund_frei.parameter)).sort().join('; ');
  ok(ids === 'konvoi_abfangen/aufhalten = konvoi {"sieg":"aufhalten"}; konvoi_abfangen/pluendern = konvoi {"sieg":"pluendern"}; pannenhilfe/andocken_und_flicken = geleit {"modus":"panne"}; schuetzen/geleit_durch_angriff = geleit {"modus":"geleit"}; schuetzen/notruf_verteidigen = geleit {"modus":"havarist"}', 'genau diese fuenf Umsetzungen mit ihrem Beat und ihrer Wahl: ' + ids);
  ok(us.every((u) => u.status === 'verfuegbar' && u.schauplatz === 'weltraum' && D.BEATS[u.sund_frei.beat] && D.BEATS[u.sund_frei.beat].szene === true && /test-faden-katalog-b2/.test(u.sund_frei.belegt)), 'jede ist verfuegbar, spielt im Weltraum, ihr Beat ist eine Szene der Faeden, der Beleg nennt diesen Test');
  ok(us.every((u) => Object.entries(u.sund_frei.parameter || {}).every(([p, w]) => D.BEATS[u.sund_frei.beat].bauplan.parameter[p].erlaubt.includes(w))), 'jede Wahl steht in den erlaubten Werten des Beats (Katalog Faeden)');
  // der Querverweis lehnt ab, was nicht spielbar ist
  const bad = (o) => MK.sundFreiFehler(Object.assign({ schauplatz: 'weltraum', sund_frei: { beat: 'konvoi', parameter: { sieg: 'aufhalten' }, belegt: 'x' } }, o));
  ok(bad({}).length === 0 && bad({ schauplatz: 'aussen' }).some((x) => /Weltraum/.test(x)), 'Boden-Umsetzungen sind nicht spielbar (Weltraum verlangt)');
  ok(bad({ sund_frei: { beat: 'teleport', belegt: 'x' } }).some((x) => /teleport/.test(x)) && bad({ sund_frei: { beat: 'abschluss', belegt: 'x' } }).length === 0, 'ein unbekannter Beat wird abgelehnt (ein planbarer Beat nicht)');
  ok(bad({ sund_frei: { beat: 'konvoi', parameter: { sieg: 'rammen' }, belegt: 'x' } }).some((x) => /nicht erlaubt/.test(x)) && bad({ sund_frei: { beat: 'konvoi', parameter: { gibt: 'es nicht' }, belegt: 'x' } }).some((x) => /gehoert nicht/.test(x)) && bad({ sund_frei: { beat: 'konvoi', parameter: { constructor: 'x' }, belegt: 'x' } }).some((x) => /gehoert nicht/.test(x)), 'ein Wert ausserhalb der Liste, ein fremder Parameter und ein Prototyp-Name werden abgelehnt');
  ok(MK.sundFreiFehler({ schauplatz: 'weltraum', sund_frei: { beat: '__proto__', belegt: 'x' } }).some((x) => /__proto__/.test(x)) && MK.sundFreiFehler({ schauplatz: 'weltraum', sund_frei: { beat: 'constructor', belegt: 'x' } }).length > 0, 'ein Beat mit Prototyp-Namen gibt es nicht');
  // jede Umsetzung wird gespielt: der Beat aus dem Katalog, die Wahl aus dem Katalog, der Ausgang gelungen ueber die Mittel der Szene
  let seed = 100;
  for (const u of us) {
    const s = u.sund_frei, t = neu(seed++, 1), g = t.g;
    flieg(t, '0305'); g.ship.x = 300; g.ship.y = 300;
    const f = oeffne(g, plan([b(s.beat, { parameter: s.parameter }), b('abschluss')])).f;
    startBeat(g, f); vorlauf(t);
    const modus = (s.parameter || {}).modus, sieg = (s.parameter || {}).sieg;
    if (s.beat === 'konvoi') {
      for (const e of Konvoi.transporter(g)) Testhilfe.toeten(g, e);
      t.run(0.5);
      if (sieg === 'pluendern') {
        g.players[0].console = 'weapons'; g.players[0].station = null;
        for (let i = 0; i < 12 && szene(g); i++) { const d = Fracht.draussen(g)[0]; if (d) { g.ship.x = d.x - 80; g.ship.y = d.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0; } Fracht.beamStart(g, g.players[0], null); t.run(4); }
      }
    } else if (modus === 'geleit') { for (const e of eigene(g)) Testhilfe.toeten(g, e); const es = schuetzling(g); es.x = es.ziel.x; es.y = es.ziel.y; es.vx = 0; es.vy = 0; }
    else if (modus === 'havarist') { for (const e of eigene(g)) Testhilfe.toeten(g, e); }
    else { const es = schuetzling(g); for (const e of eigene(g)) Testhilfe.toeten(g, e); t.run(0.5); for (let i = 0; i < 28 * HZ && szene(g); i++) { g.ship.x = es.x + 90; g.ship.y = es.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0; g.step(); } }
    t.run(1);
    ok(!szene(g) && f.phase === 'wartet' && f.nsc.gedaechtnis.some((x) => x.ereignis === s.beat + '_gelungen') && f.nsc.status === 'verbuendet' && g.errors === 0, `${u.mol}/${u.id} (Beat ${s.beat} ${JSON.stringify(s.parameter)}) laeuft auf sund_frei bis zum Erfolg, ohne Labor-Pfad und ohne Mission`);
    const wm = Weltstand.capture(g).missionen; ok(!wm || !wm.missionen || Object.keys(wm.missionen).length === 0, `${u.mol}/${u.id}: der Weltstand haelt keine Kampagnen-Missionen (m1 bis m3, bot_lab: kein Labor-Start)`);
  }
});

section('(g2) Katalog: eine Umsetzung (Mod) mit falschem sund_frei wird beim Laden gemeldet (Schema und Querverweis)', () => {
  const Kat = require('./katalog.js'), os = require('os');
  const basis = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'katalog', 'molekuele', 'konvoi_abfangen.json'), 'utf8'));
  const u0 = klon(basis.umsetzungen.find((u) => u.id === 'aufhalten'));
  const lade = (sundFrei, id) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-katmod-'));
    fs.mkdirSync(path.join(dir, 'katalog', 'molekuele'), { recursive: true });
    const u = klon(u0); u.id = id; if (sundFrei) u.sund_frei = sundFrei; else delete u.sund_frei;
    fs.writeFileSync(path.join(dir, 'katalog', 'molekuele', 'konvoi_abfangen.json'), JSON.stringify({ format: 'molekuel/1', id: 'konvoi_abfangen', erweitert: true, name: basis.name, familie: basis.familie, kern: basis.kern, ansaetze: basis.ansaetze, szenentypen: basis.szenentypen, umsetzungen: [u] }));
    try { return Kat.load({ mods: [dir] }).fehler.map((x) => x.msg); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  ok(lade(null, 'ohne_feld').length === 0, 'eine Mod-Umsetzung ohne sund_frei laedt ohne Fehler');
  ok(lade({ beat: 'konvoi', parameter: { sieg: 'aufhalten' }, belegt: 'ein Beleg im Test' }, 'gut').length === 0, 'mit gueltigem sund_frei laedt sie ohne Fehler');
  ok(lade({ beat: 'teleport', belegt: 'ein Beleg im Test' }, 'beat').some((m) => /sund_frei: der Beat 'teleport'/.test(m)), 'unbekannter Beat: Fehler beim Laden');
  ok(lade({ beat: 'konvoi', parameter: { sieg: 'rammen' }, belegt: 'ein Beleg im Test' }, 'wert').some((m) => /sund_frei: der Wert 'rammen'/.test(m)), 'Wert ausserhalb der Liste: Fehler beim Laden');
  ok(lade({ beat: 'konvoi', belegt: 'ein Beleg im Test', extra: 1 }, 'extra').length > 0, 'ein unbekanntes Feld in sund_frei: Schemafehler');
  ok(lade({ beat: 'konvoi' }, 'beleg').length > 0, 'ohne Beleg: Schemafehler');
  ok(lade({ beat: 'konvoi', belegt: 'kurz' }, 'kurz').length > 0, 'ein Beleg unter 8 Zeichen: Schemafehler');
  ok(lade({ beat: 'Konvoi', belegt: 'ein Beleg im Test' }, 'gross').length > 0, 'ein Beat-Name ausserhalb des Musters: Schemafehler');
});

// ---------------------------------------------------------------- (f) ohne Schalter, Logbuch und Prompt
section('(f) Ohne FAEDEN=1 tut nichts etwas; kein Spielername im Logbuch, in den Funktexten und im Prompt; die Lage hat keinen Zugriff ohne Welt', () => {
  const t = F.neuesSpiel({ crew: 1, seed: 7, env: {} }), g = t.g;
  ok(FS.starten(g, { art: 'konvoi', fadenId: 'f1', beatId: 'b' }).ok === false && FS.starten(g, { art: 'geleit', fadenId: 'f1', beatId: 'b' }).ok === false, 'starten ohne Schalter: abgelehnt (INAKTIV)');
  ok(!g.fadenSzene && !g.fadenWarte && !g.space.konvoi && !(g.space.escorts || []).length, 'kein Laufzeitzustand angelegt');
  B2.update(g); ok(!g.weltsim || !g.weltsim.faeden || !g.weltsim.faeden.sabotage, 'der Takt der Sabotage tut ohne Schalter nichts');
  ok(B2.ziele({}).length === 0 && B2.lage('sabotage_ziel').zahl({}) === 0 && B2.lage('gibt_es_nicht') === null && B2.lage('constructor') === null && B2.lage('__proto__') === null, 'ohne Welt: keine Ziele; unbekannte Lagen (auch Prototyp-Namen) gibt es nicht');
  const gl = Pruefer.pruefeLage(g, { beats: [{ id: 'x', typ: 'sabotage' }] });
  ok(/^LAGE_ZIEL_FEHLT:/.test(gl || ''), 'die Lage fragt ohne Welt nach dem Ziel (kein Absturz): ' + gl);
  D.BEATS.geleit.braucht.lage = 'bogus'; const gu = Pruefer.pruefeLage(g, { beats: [{ id: 'x', typ: 'geleit' }] }); delete D.BEATS.geleit.braucht.lage;
  ok(/^LAGE_UNBEKANNT:/.test(gu || ''), 'eine unbekannte Lagen-Bedingung lehnt der Pruefer ab (LAGE_UNBEKANNT)');
  const t2 = neu(80, 3), g2 = t2.g; flieg(t2, '0305'); postenSetzen(g2, '0703', 'ger'); rang(g2, 'miles');
  const f = oeffne(g2, plan([b('sabotage'), b('konvoi'), b('geleit'), b('abschluss')]), undefined, '0305').f; startBeat(g2, f);
  const alles = JSON.stringify(logbuch(g2)) + t2.funk.join('\n') + JSON.stringify(AP.baue(g2, { nr: 3, grenze: 'szene_ende', hex: '0305', letzte: [] }));
  ok(!NAMEN.some((x) => alles.includes(x)) && !NAMEN.some((x) => alles.includes(x.replace('_', ' '))), 'kein Spielername im Logbuch, im Funk und im Prompt');
  ok(g.errors === 0 && g2.errors === 0, 'keine Serverfehler');
});

console.log(`\n${n - fails}/${n} Pruefungen ok` + (fails ? ` – ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
