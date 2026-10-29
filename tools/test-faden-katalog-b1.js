'use strict';
// SUND-04b B1: Katalog-Erweiterung, Teil 1: die drei Beats OHNE Kampfszene (geruecht, spur, wiedersehen), Baustein server/sim/faden-b1.js, Daten content/faeden/b1-texte.json und content/spuren/{altrost,fundort}.json.
// Die Erwartungen stehen hier selbst (aus den Daten und der Karte content/welt/sund_frei.json, eigener Wegsucher), nie aus dem Produktivcode. Der Test laeuft durch die ECHTEN Hooks: Abenteuer anbieten und oeffnen,
// faden_weiter (Befehl des Spielleiters), Taetigkeitsgrenzen (game.lageGrenze), die Crew fliegt (Space.enterScene) und liest die Spur an der Ops-Konsole (cmd weapons.spur.lesen, Game.step). Nie Faden.beatAusgang.
// Geprueft wird: Katalog und Daten · Expander und Pruefer (NSC_ALT_NICHT_ERSTER, hex, nsc_von) · Geruecht (Ort, Ankunft, Frist, Rueckfall) · Rätsel-Spur (Lesen bis zum Ende, falscher Ast, Frist, Abraeumen, Speichern und Laden)
// · Wiedersehen (der NSC erinnert sich an eine konkrete Tat; Pruefer lehnt ab, wenn er fehlt) · Weltstand · Logbuch und Prompt ohne Spielernamen · ohne Schalter nichts.
// Aufruf: node tools/test-faden-katalog-b1.js        (npm run test:faden-katalog-b1)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const Sektoren = require('../shared/sektoren.js');
const Space = require('../server/sim/space.js');
const Spur = require('../server/sim/spur.js');
const Marken = require('../server/sim/marken.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Pruefer = require('../server/sim/faden-pruefer.js');
const BP = require('../server/sim/faden-bauplan.js');
const Bausteine = require('../server/sim/faden-bausteine.js');
const B1 = require('../server/sim/faden-b1.js');
const AP = require('../server/sim/abenteuer-prompt.js');
const AM = require('../server/sim/abenteuer-mock.js');
const Physics = require('../shared/physics.js');
const W = require('../server/world.js');
const { D, Faden, F, klon } = X;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); } };
const lies = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
const TX = lies('content/faeden/b1-texte.json'), KARTE = lies('content/welt/sund_frei.json'), WERTE = lies('content/faeden/werte.json').werte, HW = lies('content/faeden/haltung-werte.json').werte;
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const FRIST = WERTE.beat_frist.wert, FUNK_MAX = WERTE.funk_text_max.wert;
const NEU = ['geruecht', 'spur', 'wiedersehen'];
const TX_LIVE = D.B1;   // die geladenen Daten des Produktivcodes (nur fuer kurze, zurueckgesetzte Veraenderungen in (a))
const hat = (r, code) => !r.ok && r.fehler.some((t) => t.startsWith(code + ':'));

// ---------------------------------------------------------------- Hilfen
function neu(seed) {
  const t = F.neuesSpiel({ crew: 3, seed: seed || 11, names: NAMEN, env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' } });
  const llm = LLM.create({ mode: 'mock' });
  t.g.lageSpielleiter = LS.create(t.g, { llm, werte: { min_abstand_ticks: 1, deckel_je_sitzung: 9999 } }); t.g.lageSchalter = true;
  t.c = t.cs[0];
  t.funk = []; const orig = t.g.emit.bind(t.g);   // Funk mitschreiben (Game.emit wird nur umhuellt)
  t.g.emit = (...a) => { if (a[0] === 'radio' && a[1]) t.funk.push(a[1]); return orig(...a); };
  t.cmd = (k, extra) => t.g.handleMessage(t.c, Object.assign({ t: 'cmd', c: k }, extra || {}));
  t.run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) { t.g.space.enemies = []; t.g.step(); } };
  return t;
}
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'ZEBRAKAI Probe', anlass: 'Anlass ZEBRAKAI fuer den Test', beats }, o || {});
const b = (typ, o) => Object.assign({ typ }, o || {});
const ort = (hex) => Sektoren.ortVonHex(hex) || ('leer-' + hex);
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const flieg = (t, hex) => { Space.enterScene(t.g, ort(hex), {}); t.g.explore.location = ort(hex); ab(t.g); t.run(0.1); };
const hier = (g) => Sektoren.hexVonOrt(g.ship.scene);
const grenzen = (g, k, art) => { for (let i = 0; i < k; i++) g.lageGrenze(art || 'andocken'); };
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
// Wegsuche der Erwartung: kuerzeste Spruenge ueber OFFENE Kanten der Karte (eigener Code, nie faden-b1.js)
function abstaende(von, offen) {
  const adj = {};
  for (const e of KARTE.kanten) if (e.art === 'open' || (offen && offen.includes(e.key))) { (adj[e.a] = adj[e.a] || []).push(e.b); (adj[e.b] = adj[e.b] || []).push(e.a); }
  const d = { [von]: 0 }; const q = [von];
  while (q.length) { const h = q.shift(); for (const x of adj[h] || []) if (!(x in d)) { d[x] = d[h] + 1; q.push(x); } }
  return d;
}
const gesperrt = (h) => { const hx = KARTE.hexe[h]; const r = hx && KARTE.regionen[hx.region]; return !!(r && r.sperrtext); };
// Ops sitzt an der Konsole, die Spur wird am Spurkern gelesen (Vorbild tools/test-spur.js)
const STAND = [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']];
function conSpot(con) { for (const t of [].concat(W.CONSOLE_TILES[con])) for (const [dx, dy, dir] of STAND) { const s = { x: t.x + dx, y: t.y + dy, dir }; if (!W.ship.solid(s.x, s.y)) return s; } return null; }
function opsSetzen(t) {
  const p = t.g.players[0], s = conSpot('weapons'), ctr = Physics.tileCenter(s.x, s.y);
  p.x = ctr.x; p.y = ctr.y; p.dir = s.dir;
  t.g.handleMessage(t.c, { t: 'act', down: true }); t.g.handleMessage(t.c, { t: 'act', down: false });
}
function lese(t) {   // an den Spurkern fliegen, K, warten; eine Teilung wird mit Qualitaet 3 entschluesselt
  const g = t.g, k = Spur.kern(g.spur.id, hier(g));
  g.ship.x = k.x + 40; g.ship.y = k.y; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0; g.ship.docked = false; g.ship.dockedAt = null;
  t.cmd('weapons.spur.lesen', { on: true }); t.run(g.C.spur.leseZeit + 0.5);
  if (g.spur.wartet) {
    t.cmd('weapons.entschl.start');
    for (let i = 0; i < 30 * 120 && g.entschl && g.entschl.z === 1; i++) {
      const e = g.entschl, d = Math.abs(e.f - e.ziel) < 0.02 ? 0 : (e.ziel > e.f ? 1 : -1);
      if (d !== e.dir) t.cmd('weapons.entschl.stimme', { dir: d });
      g.space.enemies = []; g.step();
    }
    t.run(0.2);
  }
}
const kontextVon = (prompt) => JSON.parse(/<kontext>\n([\s\S]*?)\n<\/kontext>/.exec(prompt)[1]);
const kanteOffen = (g, a, c) => g.explore.kanteOffen(Sektoren.kanteId(a, c));
const beatTypen = (v) => v.beats.map((x) => x.typ);

// ---------------------------------------------------------------- (a) Katalog und Daten
section('(a) Katalog: 15 Beat-Typen (SUND-04b B2: konvoi, geleit, sabotage kamen dazu), drei neue ohne Gefahr, ohne Szene, ohne Optionen, mit Standards; die Daten sind in sich stimmig', () => {
  const t = neu(3);
  ok(Object.keys(D.BEATS).length === 15 && NEU.every((k) => D.BEATS[k]), '15 Beat-Typen (12 bis B1, dazu B2: konvoi, geleit, sabotage), darunter ' + NEU.join(', '));
  for (const k of NEU) {
    const c = D.BEATS[k];
    ok(c.gefahr === false && c.optionen === 'keine' && !c.szene && !c.abschluss && typeof c.zweck === 'string' && c.zweck.length > 30 && c.baustein === k && Array.isArray(c.braucht.nsc_status), `${k}: Zweck, keine Gefahr, keine Szene, keine Optionen, Zustaende des NSC`);
    ok(c.bauplan && c.bauplan.aus.gelungen.status.length && c.bauplan.aus.gescheitert.status.length && c.bauplan.start_status === 'aktiv', `${k}: Standards fuer den Expander (bauplan)`);
    ok(Bausteine.vonId(k) && !Bausteine.istPlatzhalter(k), `${k}: der Baustein ist registriert (kein Platzhalter)`);
  }
  ok(D.BEATS.wiedersehen.braucht.nsc_alt === true && D.BEATS.geruecht.braucht.nsc_alt === undefined && D.BEATS.spur.braucht.nsc_alt === undefined, 'nur das Wiedersehen braucht einen NSC aus einem frueheren Faden (braucht.nsc_alt)');
  ok(D.BEATS.geruecht.bauplan.hinweis_traeger === true && D.BEATS.spur.bauplan.hinweis_traeger === true && D.BEATS.wiedersehen.bauplan.hinweis_traeger === false, 'Hinweis-Traeger: Geruecht und Spur ja, Wiedersehen nein');
  ok(BP.katalogFehler().length === 0 && B1.katalogFehler().length === 0 && Pruefer.katalogFehler().length === 0, 'katalogFehler (Expander, Bausteine, Pruefer) ist leer');
  const folgen = []; for (const k of NEU) for (const ag of ['gelungen', 'gescheitert']) for (const f of D.BEATS[k].bauplan.aus[ag].folge) folgen.push(f.typ);
  ok(folgen.every((x) => WERTE.folge_typen.wert.includes(x)), 'Folgen nur aus dem Katalog (' + WERTE.folge_typen.wert.join(', ') + ')');
  // Daten, die der Pruefer des Katalogs sehen muss: ein kaputter Eintrag wird gemeldet
  const spurErl = D.BEATS.spur.bauplan.parameter.spur.erlaubt;
  spurErl.push('bote'); const f1 = B1.katalogFehler(); spurErl.pop();   // bote hat eine Datei (Kampagne), aber keine Texte der Faeden
  ok(f1.length === 1 && /Spur bote steht nicht in b1-texte/.test(f1[0]), 'katalogFehler meldet eine Spur ohne Texte: ' + f1[0]);
  const tk = D.BEATS.geruecht.bauplan.parameter.text_key.erlaubt; tk.push('geruecht_fehlt'); const f2 = B1.katalogFehler(); tk.pop();
  ok(f2.length === 1 && /geruecht_fehlt/.test(f2[0]), 'katalogFehler meldet einen Text, der fehlt: ' + f2[0]);
  // weitere Daten, die katalogFehler sehen muss (Daten werden kurz veraendert und zurueckgesetzt)
  const zielOrig = klon(TX_LIVE.werte.ziel);
  const stellen = [
    ['Spur mit Texten, aber ohne Datei', () => { TX_LIVE.spuren.nur_text = klon(TX.spuren.kantenpfad); spurErl.push('nur_text'); }, () => { delete TX_LIVE.spuren.nur_text; spurErl.pop(); }, /nur_text.*fehlt oder ist ung/],
    ['ziel.max groesser als erreichbar_max', () => { TX_LIVE.werte.ziel.max = 99; }, () => { TX_LIVE.werte.ziel.max = zielOrig.max; }, /werte.ziel/],
    ['ziel.min unter 1', () => { TX_LIVE.werte.ziel.min = 0; }, () => { TX_LIVE.werte.ziel.min = zielOrig.min; }, /werte.ziel/],
    ['erinnerte Tat ohne Text', () => { TX_LIVE.werte.wiedersehen_erinnert.zzz_gelungen = 'kein_text'; }, () => { delete TX_LIVE.werte.wiedersehen_erinnert.zzz_gelungen; }, /kein_text/],
    ['Ereignis passt nicht zum Gedaechtnis', () => { TX_LIVE.werte.wiedersehen_erinnert.Gross1 = 'wiedersehen_dank'; }, () => { delete TX_LIVE.werte.wiedersehen_erinnert.Gross1; }, /Gross1/],
    ['Text mit fremdem Platzhalter', () => { TX_LIVE.texte.zusatz = 'Hallo {spieler}, schoen dich zu sehen.'; }, () => { delete TX_LIVE.texte.zusatz; }, /zusatz/],
    ['Spur-Text fehlt', () => { delete TX_LIVE.spuren.fundort.verloren; }, () => { TX_LIVE.spuren.fundort.verloren = TX.spuren.fundort.verloren; }, /fundort.verloren/],
    ['Pflichttext fehlt', () => { delete TX_LIVE.texte.geruecht_gefunden; }, () => { TX_LIVE.texte.geruecht_gefunden = TX.texte.geruecht_gefunden; }, /geruecht_gefunden/],
  ];
  for (const [was, an, aus, re] of stellen) {
    an(); const fb = B1.katalogFehler(); const bpf = BP.katalogFehler(); aus();
    ok(fb.length >= 1 && fb.some((x) => re.test(x)) && bpf.some((x) => /^BAUPLAN_KATALOG: B1:/.test(x) && re.test(x)), `katalogFehler (auch im Expander) meldet: ${was}`);
  }
  D.BEATS.spur.braucht.nsc_alt = 'ja'; const fn = BP.katalogFehler(); delete D.BEATS.spur.braucht.nsc_alt;
  ok(fn.some((x) => /nsc_alt/.test(x)), 'katalogFehler des Expanders meldet braucht.nsc_alt, das kein Wahrheitswert ist');
  ok(B1.katalogFehler().length === 0 && BP.katalogFehler().length === 0, 'nach dem Zuruecksetzen wieder leer');
  ok(t.g.errors === 0, 'keine Serverfehler');
});

section('(a2) Funktexte: hoechstens funk_text_max Zeichen mit dem laengsten Sektornamen, keine Spielernamen, nur {name} und {ort}', () => {
  neu(3);
  const lang = Object.values(KARTE.hexe).map((h) => h.name).sort((x, y) => y.length - x.length)[0];
  const alle = Object.entries(TX.texte).map(([k, v]) => [k, v]).concat(Object.entries(TX.spuren).flatMap(([id, s]) => Object.entries(s).map(([k, v]) => [id + '.' + k, v])));
  ok(alle.length >= 20, alle.length + ' Texte');
  for (const [k, v] of alle) {
    const t = v.replace(/\{ort\}/g, lang).replace(/\{name\}/g, 'Gaius Valerius');
    ok(t.length <= FUNK_MAX && t.length >= 20 && !(v.match(/\{[^}]*\}/g) || []).some((p) => p !== '{ort}' && p !== '{name}') && !NAMEN.some((x) => v.includes(x)), `${k}: ${t.length} Zeichen`);
  }
  ok(Object.values(TX.werte.wiedersehen_erinnert.wert).every((k) => TX.texte[k]), 'jede erinnerte Tat hat einen Text');
});

section('(a3) Spuren: mindestens zwei neue auf der Sund-Karte, Hexe echt, Kanten offen, das Ende enthuellt eine verborgene Kante', () => {
  neu(3);
  const erlaubt = D.BEATS.spur.bauplan.parameter.spur.erlaubt;
  ok(erlaubt.length >= 2 && erlaubt.every((id) => id !== 'bote') && erlaubt.every((id) => TX.spuren[id] && fs.existsSync(path.join('content', 'spuren', id + '.json'))), 'mindestens zwei neue Spuren (' + erlaubt.join(', ') + '), je eine Datei und Texte');
  for (const id of erlaubt) {
    const d = lies('content/spuren/' + id + '.json');
    ok(d.id === id && Spur.datei(id) && d.weg.length >= 2 && d.alter.length === d.weg.length, `${id}: Datei gueltig fuer spur.js, ${d.weg.length} Hexe, ein Alter je Hex`);
    ok(d.weg.every((h) => KARTE.hexe[h] && KARTE.hexe[h].spielbar && !gesperrt(h)), `${id}: jeder Hex der Spur ist ein spielbarer Sektor der Sund-Karte ohne Sperrtext (${d.weg.join(' > ')})`);
    let offen = true; for (let i = 0; i + 1 < d.weg.length; i++) { const e = KARTE.kanten.find((x) => (x.a === d.weg[i] && x.b === d.weg[i + 1]) || (x.b === d.weg[i] && x.a === d.weg[i + 1])); if (!e || e.art !== 'open') offen = false; }
    ok(offen, `${id}: jede Kante zwischen zwei Hexen der Spur ist offen`);
    const verborgen = KARTE.kanten.filter((e) => e.art === 'hidden' && e.key === d.ende.kante);
    ok(verborgen.length === 1 && (verborgen[0].a === d.weg[d.weg.length - 1] || verborgen[0].b === d.weg[d.weg.length - 1]), `${id}: das Ende enthuellt die verborgene Kante ${d.ende.kante} am letzten Hex`);
    ok((d.teilungen || []).every((tl) => d.weg.includes(tl.ab) && tl.aeste.length === 2 && tl.aeste.filter((a) => a.echt).length === 1 && tl.aeste.every((a) => KARTE.kanten.some((e) => (e.a === tl.ab && e.b === a.nach) || (e.b === tl.ab && e.a === a.nach)))), `${id}: Teilungen: zwei Aeste, einer echt, beide Nachbarn des Hexes`);
    ok(new Set(d.weg).size === d.weg.length, `${id}: kein Hex doppelt`);
  }
});

section('(a4) Prompt-Katalog der Komposition (A2) leitet die neuen Typen aus den Daten ab, ohne Codeaenderung', () => {
  const t = neu(3); AP.katalogNeuLesen();
  const k = AP.katalogText();
  for (const typ of NEU) ok(new RegExp('- ' + typ + ': ').test(k) && k.includes(D.BEATS[typ].zweck), `${typ} steht im Katalog mit seinem Zweck`);
  ok(/spur \(Standard kantenpfad; erlaubt kantenpfad \| fundort\)/.test(k), 'Parameter spur mit Standard und erlaubten Spuren');
  ok(/geruecht_standard \| geruecht_handel/.test(k), 'Parameter text_key des Geruechts');
  ok(!/\bhex \(Standard/.test(k), 'der Sektor des Geruechts ist kein Parameter des Plans (kommt vom Code)');
  const r = AP.baue(t.g, { nr: 1, grenze: 'szene_ende', hex: '0305', letzte: [] });
  ok(!r.fehler && r.zeichen <= lies('content/welt/abenteuer-werte.json').werte.prompt_max_zeichen.wert, 'der Prompt passt unter die Obergrenze (' + r.zeichen + ' Zeichen)');
  const ktx0 = kontextVon(r.prompt).faeden.wiedersehen_nsc;
  ok(Object.keys(ktx0).sort().join() === 'ger,kon,rom' && Object.values(ktx0).every((v) => v === 0), 'Kontext: wiedersehen_nsc je Volk 0 ohne abgeschlossenen Faden');
  ok(!NAMEN.some((x) => r.prompt.includes(x)), 'keine Spielernamen im Prompt');
  AP.katalogNeuLesen();
});

// ---------------------------------------------------------------- (b) Expander und Pruefer
section('(b) Expander: Plaene mit den neuen Typen, Zustaende von Hand abgeleitet, eigene Regeln', () => {
  neu(3);
  const r1 = BP.expandiere(plan([b('geruecht'), b('abschluss')]));
  ok(r1.ok && r1.vorlage.beats[0].parameter.text_key === 'geruecht_standard' && r1.vorlage.beats[0].aus.gelungen.status === 'verbuendet' && r1.vorlage.beats[0].aus.gescheitert.status === 'aktiv', 'Geruecht, Abschluss: Standard-Text, gelungen verbuendet, gescheitert aktiv');
  ok(JSON.stringify(r1.vorlage.beats[0].aus.gelungen.folge) === JSON.stringify([{ typ: 'haltung_aenderung', grund: 'gedankt' }]) && !r1.vorlage.beats[0].aus.gescheitert.folge, 'Folgen aus den Daten: gelungen gedankt, gescheitert keine (der Zustand aendert sich)');
  const r2 = BP.expandiere(plan([b('spur', { parameter: { spur: 'fundort' } }), b('abschluss')]));
  ok(r2.ok && r2.vorlage.beats[0].parameter.spur === 'fundort' && r2.vorlage.beats[1].erfolg.ereignis[0] === 'spur_gelungen', 'Spur: Parameter aus dem Plan, Erfolg des Abschlusses spur_gelungen');
  ok(BP.expandiere(plan([b('spur'), b('abschluss')])).vorlage.beats[0].parameter.spur === 'kantenpfad', 'Spur ohne Parameter: Standard kantenpfad');
  const r3 = BP.expandiere(plan([b('wiedersehen'), b('abschluss')]));
  ok(r3.ok && r3.vorlage.nsc.status === 'aktiv' && r3.vorlage.beats[0].aus.gelungen.status === 'verbuendet' && r3.vorlage.beats[0].aus.gescheitert.status === 'aktiv' && !r3.vorlage.beats[0].parameter, 'Wiedersehen am Anfang');
  ok(JSON.stringify(r3.vorlage.beats[0].aus.gescheitert.folge) === JSON.stringify([{ typ: 'haltung_aenderung', grund: 'bitte_abgelehnt' }]), 'Wiedersehen: Scheitern kostet Haltung (bitte_abgelehnt), der NSC bleibt');
  const r4 = BP.expandiere(plan([b('geruecht'), b('enthuellung'), b('abschluss')]));
  ok(r4.ok && r4.vorlage.beats[0].hinweise && r4.vorlage.beats[0].hinweise.length === 1 && Object.keys(r4.vorlage.hinweise).length === 1, 'Geruecht ist Hinweis-Traeger: die Enthuellung danach ist fair');
  ok(BP.expandiere(plan([b('spur'), b('wiedersehen'), b('abschluss')])).codes.includes('NSC_ALT_NICHT_ERSTER'), 'Wiedersehen nicht am Anfang: NSC_ALT_NICHT_ERSTER');
  ok(BP.expandiere(plan([b('wiedersehen'), b('abschluss')], { namenlos: true })).codes.includes('BAUPLAN_NAMENLOS_TYP'), 'Wiedersehen namenlos: BAUPLAN_NAMENLOS_TYP');
  ok(BP.expandiere(plan([b('spur'), b('abschluss')], { namenlos: true })).ok, 'Spur namenlos ist erlaubt (der NSC bleibt aktiv)');
  ok(BP.expandiere(plan([b('spur', { parameter: { spur: 'bote' } }), b('abschluss')])).codes.includes('PARAMETER'), 'Spur bote (Kampagne) ist kein Parameter des Plans');
  ok(BP.expandiere(plan([b('spur', { parameter: { spur: '__proto__' } }), b('abschluss')])).codes.includes('PARAMETER'), 'Spur __proto__: abgelehnt');
  ok(BP.expandiere(plan([b('spur', { parameter: { spur: 'constructor' } }), b('abschluss')])).codes.includes('PARAMETER'), 'Spur constructor: abgelehnt');
  ok(BP.expandiere(plan([b('geruecht', { parameter: { hex: '0505' } }), b('abschluss')])).codes.includes('PARAMETER'), 'ein Plan nennt keinen Sektor fuer das Geruecht (der Code waehlt)');
  ok(BP.expandiere(plan([b('geruecht', { parameter: { text_key: 'notruf_standard' } }), b('abschluss')])).codes.includes('PARAMETER'), 'Geruecht: nur die Texte des Geruechts');
  ok(BP.expandiere(plan([b('wiedersehen', { parameter: { hex: '0505' } }), b('abschluss')])).codes.includes('PARAMETER'), 'Wiedersehen: kein Parameter im Plan');
  const p0 = JSON.parse('{"format":"faden-bauplan/1","titel":"Probe Abenteuer","beats":[{"typ":"geruecht","parameter":{"__proto__":{"x":1}}},{"typ":"abschluss"}]}');
  const rp = BP.expandiere(p0);
  ok(!rp.ok && rp.fehler.every((t) => /^[A-Z][A-Z_]+: /.test(t)), 'Prototyp-Schluessel in den Parametern: abgelehnt mit Code (' + rp.codes.join(',') + ')');
});

section('(b2) Pruefer: Vorlagen von Hand (hex, nsc_alt)', () => {
  neu(3);
  const basis = () => klon(BP.expandiere(plan([b('geruecht'), b('abschluss')])).vorlage);
  const mit = (aendern) => { const v = basis(); aendern(v); return Pruefer.pruefeVorlage(v); };
  ok(mit((v) => { v.beats[0].parameter.hex = '0505'; }).ok, 'geruecht mit hex 0505 (spielbar): gueltig');
  ok(hat(mit((v) => { v.beats[0].parameter.hex = '9999'; }), 'PARAMETER'), 'hex 9999 (kein Sektor): PARAMETER');
  ok(hat(mit((v) => { v.beats[0].parameter.hex = 'abcd'; }), 'PARAMETER'), 'hex abcd: PARAMETER');
  ok(hat(mit((v) => { v.beats[0].parameter.hex = 505; }), 'PARAMETER'), 'hex als Zahl: PARAMETER');
  ok(hat(mit((v) => { v.beats[0].parameter.hex = '0806'; v.beats[0].parameter.hex = '1111'; }), 'PARAMETER'), 'hex 1111 (nicht spielbar auf der Karte): PARAMETER');
  const w = () => klon(BP.expandiere(plan([b('wiedersehen'), b('abschluss')])).vorlage);
  ok(Pruefer.pruefeVorlage(w()).ok, 'wiedersehen am Anfang: gueltig');
  const v2 = w(); v2.beats.unshift({ id: 'vorn', typ: 'spontanhilfe', aus: { gelungen: { status: 'verbuendet' }, gescheitert: { status: 'aktiv' } } });
  ok(hat(Pruefer.pruefeVorlage(v2), 'NSC_ALT_NICHT_ERSTER'), 'wiedersehen nicht am Anfang: NSC_ALT_NICHT_ERSTER');
  const v3 = w(); v3.nsc.rolle = 'namenlos'; for (const bt of v3.beats) for (const ag of ['gelungen', 'gescheitert']) if (bt.aus[ag]) delete bt.aus[ag].status;
  ok(hat(Pruefer.pruefeVorlage(v3), 'NAMENLOS'), 'wiedersehen namenlos: NAMENLOS');
});

// ---------------------------------------------------------------- (c) Geruecht
section('(c) Geruecht: der Sektor kommt vom Code (1 bis 3 Spruenge, offene Wege, kein Sperrtext), die Ankunft beendet den Beat', () => {
  const t = neu(21), g = t.g;
  const o = oeffne(g, plan([b('geruecht'), b('abschluss')]), undefined, '0305');
  ok(o.r && o.r.ok && o.f, 'Abenteuer angeboten und geoeffnet');
  const f = o.f;
  const nsc0 = klon(f.nsc);
  const s = startBeat(g, f);
  ok(s.ok && f.phase === 'laeuft' && f.laufend.beat === 'b1_geruecht', 'faden_weiter startet den Beat');
  const d = abstaende('0305'); const z = f.parameter.ort;
  ok(/^\d{4}$/.test(z) && z !== '0305' && d[z] >= 1 && d[z] <= 3 && !gesperrt(z), `der genannte Sektor ${z} (${Sektoren.hexName(z)}) liegt ${d[z]} Spruenge entfernt, offene Wege, ohne Sperrtext`);
  const zeile = t.funk.find((x) => x.text.includes(Sektoren.hexName(z)));
  ok(zeile && zeile.from === WERTE.hinweis_sprecher.wert.geruecht && zeile.text.includes(nsc0.name) && zeile.text.length <= FUNK_MAX, `Hafenfunk nennt Sektor und NSC: „${zeile && zeile.text}“`);
  ok(f.hinweise.length === 0, 'ohne Enthuellung im Plan keine Hinweise');
  g.step(); g.step();
  ok(f.phase === 'laeuft', 'solange die Crew nicht dort ist, laeuft der Beat');
  flieg(t, '0305'); t.run(0.1);
  ok(f.phase === 'laeuft', 'andere Sektoren zaehlen nicht');
  flieg(t, z);
  ok(f.phase === 'wartet' && f.beat === 1 && f.nsc.status === 'verbuendet' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'geruecht_gelungen'), 'Ankunft: Beat gelungen (NSC verbuendet, Gedaechtnis geruecht_gelungen)');
  ok(f.nsc.haltung === nsc0.haltung + HW.quellen.wert.gedankt.delta, 'Haltung steigt um den Wert von gedankt (' + HW.quellen.wert.gedankt.delta + ')');
  ok(t.funk.some((x) => x.from === f.nsc.name && x.text === TX.texte.geruecht_gefunden), 'der NSC dankt per Funk');
  startBeat(g, f);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', 'der Abschluss folgt: Faden gelungen');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('(c2) Geruecht: Frist scheitert den Beat, der Faden aendert sich (aktiv statt verbuendet) und endet nicht', () => {
  const t = neu(22), g = t.g;
  const { f } = oeffne(g, plan([b('geruecht'), b('abschluss')]));
  startBeat(g, f);
  const tick = g.weltsim.faeden.t;
  grenzen(g, FRIST, 'andocken');
  ok(f.phase === 'wartet' && f.beat === 1 && g.weltsim.faeden.t === tick + FRIST, `nach ${FRIST} Taetigkeiten ohne Ankunft ist der Beat gescheitert`);
  ok(f.nsc.status === 'aktiv' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'geruecht_gescheitert') && f.nsc.haltung === 0, 'Scheitern aendert den NSC (aktiv, Gedaechtnis geruecht_gescheitert), keine Haltungsstrafe');
  startBeat(g, f);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', 'der Abschluss kommt trotzdem (ohne Belohnung), nie Game Over');
  ok(g.phase !== 'over' && g.errors === 0, 'Spiel laeuft weiter, keine Serverfehler');
});

section('(c3) Geruecht: kein erreichbarer Sektor / Sektor der Vorlage unerreichbar oder ungueltig: der Beat endet sauber (gescheitert, Logbuch)', () => {
  // (1) die Crew ist in keinem Sektor der Karte (Leerraum ohne Kanten)
  const t = neu(23), g = t.g;
  const { f } = oeffne(g, plan([b('geruecht'), b('abschluss')]));
  Space.enterScene(g, 'leer-0101', {}); ab(g);
  const ort0 = f.parameter.ort;
  startBeat(g, f);
  ok(f.phase === 'wartet' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'geruecht_gescheitert') && f.parameter.ort === ort0 && !t.funk.some((x) => x.from === WERTE.hinweis_sprecher.wert.geruecht), 'ohne Weg: Beat gescheitert, kein Funk, Ort des Fadens unveraendert');
  ok(logbuch(g).some((e) => e.art === 'faden_baustein' && e.ausgang === 'abgelehnt' && /erreichbaren Sektor/.test(e.begruendung)), 'Logbuch: kein erreichbarer Sektor');
  const tw = neu(27), gw = tw.g;
  const alt = altNsc(tw);
  const { f: fw } = oeffne(gw, plan([b('wiedersehen'), b('abschluss')]), { nsc_von: alt.nsc.id });
  Space.enterScene(gw, 'leer-0101', {}); ab(gw);
  startBeat(gw, fw);
  ok(fw.phase === 'wartet' && fw.nsc.gedaechtnis.some((x) => x.ereignis === 'wiedersehen_gescheitert') && !tw.funk.some((x) => x.from === fw.nsc.name && /Not geholt/.test(x.text)), 'Wiedersehen ohne erreichbaren Treffpunkt: Beat gescheitert, der NSC meldet sich nicht');
  // (2) Vorlage mit hex, der nur ueber eine verschlossene Kante erreichbar ist (0806 hinter 0706)
  const v = klon(BP.expandiere(plan([b('geruecht'), b('abschluss')])).vorlage); v.beats[0].parameter.hex = '0806';
  v.id = D.abenteuerId(v);
  ok(D.registriereAbenteuer(v).ok, 'die handgeschriebene Vorlage mit hex 0806 besteht den Pruefer (spielbar)');
  const g3 = neu(25).g;   // der Faden bekommt die Vorlage als Plan (wie ein gespeicherter Faden nach dem Laden)
  const { f: f3 } = oeffne(g3, plan([b('geruecht'), b('abschluss')]));
  f3.plan = klon(v); f3.vorlage = v.id;
  startBeat(g3, f3);
  ok(f3.phase === 'wartet' && f3.nsc.gedaechtnis.some((x) => x.ereignis === 'geruecht_gescheitert'), 'hex hinter einer verschlossenen Kante: nicht erreichbar, Beat gescheitert');
  const v4 = klon(v); v4.beats[0].parameter.hex = '0505'; v4.id = D.abenteuerId(v4);
  const g4 = neu(26).g; const { f: f4 } = oeffne(g4, plan([b('geruecht'), b('abschluss')]));
  D.registriereAbenteuer(v4); f4.plan = klon(v4); f4.vorlage = v4.id;
  startBeat(g4, f4);
  ok(f4.phase === 'laeuft' && f4.parameter.ort === '0305', 'hex 0505 der Vorlage (erreichbar): der Beat laeuft, der Ort des Fadens bleibt');
  flieg({ g: g4, run: (s) => { for (let i = 0; i < Math.round(s * 30); i++) { g4.space.enemies = []; g4.step(); } } }, '0505');
  ok(f4.phase === 'wartet' && f4.nsc.gedaechtnis.some((x) => x.ereignis === 'geruecht_gelungen'), 'Ankunft in 0505: gelungen (Beat-Parameter hex gilt vor dem Ort des Fadens)');
});

section('(c4) Geruecht: mehrere Seeds, der Sektor liegt immer im erlaubten Bereich und variiert; ein Platzhalter-Baustein tut nichts', () => {
  const gesehen = new Set();
  for (let seed = 60; seed < 72; seed++) {
    const t = neu(seed), g = t.g;
    const { f } = oeffne(g, plan([b('geruecht'), b('abschluss')]));
    startBeat(g, f);
    const z = f.parameter.ort, d = abstaende('0305');
    if (!(d[z] >= 1 && d[z] <= 3 && !gesperrt(z) && f.phase === 'laeuft')) { ok(false, `Seed ${seed}: Sektor ${z} ausserhalb des Bereichs`); continue; }
    gesehen.add(z);
  }
  ok(gesehen.size >= 2 && Array.from(gesehen).every((h) => ['0505', '0605'].includes(h)), 'zwoelf Seeds: nur Brachland (0505) und Pulverhorn (0605) kommen vor, beide (' + Array.from(gesehen).sort().join(', ') + ')');
  // der andere Text des Plans (text_key) wird gesprochen
  const th = neu(74), gh = th.g;
  const { f: fh } = oeffne(gh, plan([b('geruecht', { parameter: { text_key: 'geruecht_handel' } }), b('abschluss')]));
  startBeat(gh, fh);
  ok(th.funk.some((x) => x.text === TX.texte.geruecht_handel.replace('{name}', fh.nsc.name).replace('{ort}', Sektoren.hexName(fh.parameter.ort))), 'text_key geruecht_handel: der Text aus den Daten wird gesprochen');
  // Platzhalter statt echtem Baustein: der Beat laeuft, die Ankunft beendet ihn NICHT (wie bei notruf)
  const t = neu(73), g = t.g;
  const echt = Bausteine.vonId('geruecht');
  try {
    Bausteine.registriere('geruecht', Bausteine.platzhalter('geruecht'));
    const { f } = oeffne(g, plan([b('geruecht'), b('abschluss')]), undefined, '0305');
    startBeat(g, f);
    ok(f.phase === 'laeuft', 'Platzhalter: der Beat laeuft');
    f.parameter.ort = '0505'; flieg(t, '0505'); t.run(0.1);
    ok(f.phase === 'laeuft', 'Platzhalter: die Ankunft beendet den Beat nicht');
  } finally { Bausteine.registriere('geruecht', echt); }
});

section('(c5) Hinweise: Geruecht und Spur sind Hinweis-Traeger, die Enthuellung danach ist fair', () => {
  for (const typ of ['geruecht', 'spur']) {
    const t = neu(80), g = t.g;
    const { f } = oeffne(g, plan([b(typ), b('enthuellung'), b('abschluss')]));
    ok(f && f.plan.beats[0].hinweise && f.plan.beats[0].hinweise.length === 1, typ + ': der Plan hat einen Hinweis am ersten Beat');
    const hid = f.plan.beats[0].hinweise[0];
    startBeat(g, f);
    const text = f.plan.hinweise[hid].text.replace('{name}', f.nsc.name).replace('{ort}', Sektoren.hexName(f.parameter.ort));
    ok(f.phase === 'laeuft' && f.hinweise.length === 1 && f.hinweise[0] === hid, typ + ': der Hinweis ist gesendet und gestreut (' + hid + ')');
    ok(t.funk.some((x) => x.text === text), typ + ': die Crew hoert den Hinweistext: „' + text + '“');
    ok(!/ZEBRAKAI/.test(JSON.stringify(logbuch(g))), 'kein Titel im Logbuch');
  }
});

// ---------------------------------------------------------------- (d) Raetsel-Spur
section('(d) Spur fundort: Start, Lesen bis zum Ende (Teilung, Qualitaet 3), die verborgene Kante wird enthuellt, der Beat gelingt', () => {
  const t = neu(31), g = t.g;
  opsSetzen(t);
  const { f } = oeffne(g, plan([b('spur', { parameter: { spur: 'fundort' } }), b('abschluss')]));
  const kanteVorher = kanteOffen(g, '0605', '0706');
  startBeat(g, f);
  ok(f.phase === 'laeuft' && g.spur && g.spur.id === 'fundort' && Marken.da(g, 'spur:fundort') && Marken.liste(g).some((m) => m.t === 'spur' && m.h === '0705'), 'Spur laeuft, Marke in Saatfeld (0705)');
  ok(t.funk.some((x) => x.from === f.nsc.name && x.text.includes('Saatfeld') && x.text === TX.spuren.fundort.start.replace('{ort}', 'Saatfeld')), 'der NSC nennt den Anfang der Spur');
  ok(!kanteVorher, 'die verborgene Kante 0605-0706 ist vorher zu');
  const offenVorher = new Set(g.explore.kantenOffen());
  flieg(t, '0705'); lese(t);
  ok(g.spur.idx === 0 && g.spur.gelesen && !g.spur.wartet && f.phase === 'laeuft', 'Saatfeld gelesen (ohne Teilung), der Beat laeuft weiter');
  flieg(t, '0605');
  ok(g.spur.idx === 1 && f.phase === 'laeuft', 'Pulverhorn: letzter Hex');
  lese(t); t.run(0.2);
  ok(g.spur.fertig && kanteOffen(g, '0605', '0706'), 'Spur zu Ende gelesen: die verborgene Kante zum Bojenfeld ist offen');
  const neuOffen = g.explore.kantenOffen().filter((id) => !offenVorher.has(id));
  ok(neuOffen.length === 1 && neuOffen[0] === '0605-0706' && neuOffen.every((id) => id.split('-').every((h) => !gesperrt(h))), 'die Enthuellung oeffnet genau eine Kante (' + neuOffen.join(', ') + '), kein Ende in einem Sektor mit Sperrtext');
  ok(f.phase === 'wartet' && f.beat === 1 && f.nsc.status === 'verbuendet' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gelungen'), 'Beat gelungen (NSC verbuendet, Gedaechtnis spur_gelungen)');
  ok(f.nsc.haltung === HW.quellen.wert.geholfen.delta, 'Haltung steigt um geholfen');
  ok(t.funk.some((x) => x.from === f.nsc.name && x.text === TX.spuren.fundort.gelungen), 'der NSC meldet den Erfolg');
  startBeat(g, f);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', 'Abschluss: Faden gelungen');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('(d2) Spur kantenpfad: ein falscher Ast ist kein Ausgang; die Frist scheitert den Beat verandernd, die Spur wird abgeraeumt, nie Game Over', () => {
  const t = neu(32), g = t.g;
  opsSetzen(t);
  const { f } = oeffne(g, plan([b('spur'), b('abschluss')]));
  startBeat(g, f);
  ok(g.spur && g.spur.id === 'kantenpfad' && Marken.liste(g).some((m) => m.t === 'spur' && m.h === '0603'), 'Spur kantenpfad beginnt in Kantenstein (0603)');
  flieg(t, '0603'); lese(t);
  ok(g.spur.idx === 0 && g.spur.gelesen && f.phase === 'laeuft', 'Kantenstein gelesen (Teilung geloest)');
  flieg(t, '0503');
  ok(g.spur.falsch === true && f.phase === 'laeuft', 'falscher Ast (Gasfeld): die Spur-Logik sagt zurueck, der Beat laeuft weiter (kein Ausgang)');
  t.run(0.2);
  ok(f.phase === 'laeuft', 'der falsche Ast beendet den Faden nicht');
  grenzen(g, FRIST, 'andocken');
  ok(f.phase === 'wartet' && f.beat === 1 && f.nsc.status === 'aktiv' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gescheitert'), 'Frist: Beat gescheitert, der NSC bleibt aktiv (anders als verbuendet), der Faden geht weiter');
  t.run(0.1);
  ok(g.spur === null && !Marken.da(g, 'spur:kantenpfad'), 'die liegen gebliebene Spur samt Marke ist abgeraeumt');
  ok(t.funk.some((x) => x.from === f.nsc.name && x.text === TX.spuren.kantenpfad.verloren_falsch), 'der NSC sagt, dass der falsche Ast die Spur gekostet hat');
  ok(!kanteOffen(g, '0605', '0706'), 'die verborgene Kante bleibt zu');
  startBeat(g, f);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert' && g.phase !== 'over', 'Abschluss ohne Belohnung, kein Game Over');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('(d3) Spur: eine andere Spur laeuft schon / Anfang nicht erreichbar / Spur ersetzt: der Beat endet sauber', () => {
  const t = neu(33), g = t.g;
  ok(Spur.starten(g, 'bote') === null, 'eine fremde Spur (bote) laeuft');
  const { f } = oeffne(g, plan([b('spur'), b('abschluss')]));
  startBeat(g, f);
  ok(f.phase === 'wartet' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gescheitert') && g.spur && g.spur.id === 'bote', 'die fremde Spur bleibt, der Beat ist gescheitert');
  ok(logbuch(g).some((e) => e.art === 'faden_baustein' && e.ausgang === 'abgelehnt' && /andere Spur/.test(e.begruendung)), 'Logbuch: es laeuft schon eine andere Spur');
  const t2 = neu(34), g2 = t2.g;
  const { f: f2 } = oeffne(g2, plan([b('spur'), b('abschluss')]));
  Space.enterScene(g2, 'leer-0101', {}); ab(g2);
  startBeat(g2, f2);
  ok(f2.phase === 'wartet' && g2.spur === null && f2.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gescheitert'), 'Anfang der Spur nicht erreichbar: gescheitert, keine Spur gestartet');
  const t3 = neu(35), g3 = t3.g;
  const { f: f3 } = oeffne(g3, plan([b('spur'), b('abschluss')]));
  startBeat(g3, f3);
  Spur.starten(g3, 'bote');   // eine andere Quelle (Kampagne) ersetzt die Spur des Fadens
  t3.run(0.2);
  ok(f3.phase === 'wartet' && f3.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gescheitert') && g3.spur.id === 'bote', 'ersetzte Spur: Beat gescheitert, die fremde Spur bleibt unberuehrt (auch nach dem Takt)');
  ok(g.errors === 0 && g2.errors === 0 && g3.errors === 0, 'keine Serverfehler');
});

section('(d4) Spur: Speichern und Laden mitten im Beat (Faden und welt.spur), danach zu Ende lesen', () => {
  const t = neu(36), g = t.g;
  opsSetzen(t);
  const { f } = oeffne(g, plan([b('spur'), b('abschluss')]));
  startBeat(g, f);
  flieg(t, '0603'); lese(t); flieg(t, '0604'); lese(t);
  ok(g.spur.gelesen && g.spur.idx === 1 && f.phase === 'laeuft', 'Concordia gelesen (zweiter Hex, ohne Teilung), die Spur zeigt nach Pulverhorn');
  const data = Weltstand.capture(g);
  ok(Weltstand.validate(data, g).filter((x) => /faeden|spur/.test(String(x))).length === 0, 'der Stand ist schemagueltig (Faden und welt.spur)');
  const bl = data.welt.sim.faeden.liste[0];
  ok(bl.phase === 'laeuft' && bl.laufend.beat === 'b1_spur' && data.welt.spur.id === 'kantenpfad' && data.welt.spur.idx === 1 && data.welt.spur.gelesen === true, 'gespeichert: laufender Beat, Spur kantenpfad, Index 1, gelesen');
  const t2 = neu(37), g2 = t2.g;
  Kriegslage.restore(g2, JSON.parse(JSON.stringify(data.welt.sim)));
  Spur.restore(g2, JSON.parse(JSON.stringify(data.welt.spur)));
  const f2 = liste(g2)[0];
  ok(f2.phase === 'laeuft' && f2.laufend.beat === 'b1_spur' && g2.spur && g2.spur.id === 'kantenpfad' && g2.spur.idx === 1 && g2.spur.gelesen, 'nach dem Laden: derselbe Beat, dieselbe Spur');
  opsSetzen(t2);
  flieg(t2, '0605'); lese(t2); t2.run(0.2);
  ok(g2.spur.fertig && kanteOffen(g2, '0605', '0706'), 'im geladenen Spiel zu Ende gelesen: Kante zum Bojenfeld offen');
  ok(f2.phase === 'wartet' && f2.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gelungen'), 'der geladene Beat ist gelungen');
  ok(g2.errors === 0, 'keine Serverfehler');
});

// ---------------------------------------------------------------- (e) Wiedersehen
const ERINNERT = (ereignis, hex) => TX.texte[TX.werte.wiedersehen_erinnert.wert[ereignis]].replace('{ort}', Sektoren.hexName(hex));
function altNsc(t, hex) {   // ein abgeschlossener Faden: der NSC wurde aus der Not geholt (Notruf: die Crew ist dort, Ankunft)
  const g = t.g;
  const { f } = oeffne(g, plan([b('notruf'), b('abschluss')]), undefined, hex || '0305');
  startBeat(g, f); g.step(); g.step();
  startBeat(g, f);
  return f;
}
section('(e) Wiedersehen: ein NEUER Faden mit dem alten NSC; der NSC erinnert sich an eine konkrete Tat der Crew (Abnahme)', () => {
  const t = neu(41), g = t.g;
  const alt = altNsc(t);
  ok(alt.phase === 'abgeschlossen' && alt.ausgang.art === 'gelungen' && alt.nsc.gedaechtnis.some((x) => x.ereignis === 'notruf_gelungen'), 'der alte Faden ist abgeschlossen, der NSC hat die Crew in Erinnerung (notruf_gelungen)');
  const p = plan([b('wiedersehen'), b('abschluss')]);
  ok(JSON.stringify(Faden.wiedersehenKandidaten(g, BP.expandiere(p).vorlage)) === JSON.stringify([alt.nsc.id]), 'Kandidat fuer ein Wiedersehen: genau dieser NSC');
  const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  ok(a.ok, 'das Angebot entsteht, weil es einen NSC gibt');
  const nr = a.angebot.nr;
  const r0 = Faden.abenteuerOeffnen(g, nr);
  ok(!r0.ok && /^NSC_VON_FEHLT/.test(r0.grund), 'ohne nsc_von: NSC_VON_FEHLT (' + r0.grund + ')');
  ok(/^NSC_VON/.test(Faden.abenteuerOeffnen(g, nr, { nsc_von: 'n999' }).grund), 'unbekannter NSC: abgelehnt');
  ok(/^NSC_VON/.test(Faden.abenteuerOeffnen(g, nr, { nsc_von: 'x1' }).grund) && /^NSC_VON/.test(Faden.abenteuerOeffnen(g, nr, { nsc_von: 7 }).grund), 'keine NSC-Kennung: abgelehnt');
  for (const k of ['__proto__', 'constructor', 'prototype', 'toString']) ok(/^NSC_VON/.test(Faden.abenteuerOeffnen(g, nr, { nsc_von: k }).grund), `nsc_von "${k}": abgelehnt`);
  const pp = JSON.parse('{"__proto__":{"nsc_von":"' + alt.nsc.id + '"}}');
  ok(/^NSC_VON_FEHLT|^PARAMETER/.test(Faden.abenteuerOeffnen(g, nr, pp).grund), 'parameter mit eigenem Schluessel __proto__: abgelehnt (' + Faden.abenteuerOeffnen(g, nr, pp).grund.slice(0, 40) + ')');
  ok(/^NSC_VON/.test(Faden.abenteuerOeffnen(g, nr, { nsc_von: alt.nsc.id, name: 'Gaius Valerius' }).grund), 'name und nsc_von zugleich: abgelehnt');
  const anderes = alt.nsc.fraktion === 'rom' ? 'kon' : 'rom';
  ok(/^PARAMETER.*passt nicht zum NSC/.test(Faden.abenteuerOeffnen(g, nr, { nsc_von: alt.nsc.id, volk: anderes }).grund) && /^PARAMETER/.test(Faden.abenteuerOeffnen(g, nr, { nsc_von: alt.nsc.id, volk: 'ger' }).grund), 'volk passt nicht zum NSC (oder nicht zum Plan): abgelehnt');
  ok(liste(g).length === 1, 'bis hier ist kein neuer Faden entstanden');
  const r = Faden.abenteuerOeffnen(g, nr, { nsc_von: alt.nsc.id });
  ok(r.ok, 'mit nsc_von: der Faden ist offen');
  const f = r.faden;
  ok(liste(g).length === 2 && liste(g)[0] === alt && alt.phase === 'abgeschlossen', 'der alte Faden bleibt unveraendert als Geschichte stehen');
  ok(f.nsc.name === alt.nsc.name && f.nsc.portrait === alt.nsc.portrait && f.nsc.schiff === alt.nsc.schiff && f.nsc.fraktion === alt.nsc.fraktion && f.nsc.id !== alt.nsc.id && f.nsc.haltung === alt.nsc.haltung && JSON.stringify(f.nsc.gedaechtnis) === JSON.stringify(alt.nsc.gedaechtnis) && f.nsc.status === 'aktiv', 'derselbe NSC (Name, Schiff, Portraet, Haltung, Gedaechtnis), neue Kennung, Zustand der neuen Vorlage');
  ok(f.parameter.name === alt.nsc.name && f.parameter.volk === alt.nsc.fraktion, 'Parameter des Fadens: Name und Volk des NSC');
  const haltung0 = f.nsc.haltung;
  startBeat(g, f);
  ok(f.phase === 'laeuft' && f.laufend.beat === 'b1_wiedersehen', 'der Beat laeuft');
  const z = f.parameter.ort, d = abstaende('0305');
  ok(/^\d{4}$/.test(z) && z !== '0305' && d[z] >= 1 && d[z] <= 3 && !gesperrt(z), `Treffpunkt ${z} (${Sektoren.hexName(z)}): ${d[z]} Spruenge, offene Wege`);
  const soll = ERINNERT('notruf_gelungen', z);
  const zeile = t.funk.find((x) => x.from === f.nsc.name && x.text === soll);
  ok(!!zeile && /Not geholt/.test(zeile.text) && zeile.text.length <= FUNK_MAX, `der NSC erinnert sich an die konkrete Tat: „${zeile && zeile.text}“`);
  ok(!NAMEN.some((x) => zeile.text.includes(x)), 'ohne Spielernamen');
  flieg(t, z);
  ok(f.phase === 'wartet' && f.nsc.status === 'verbuendet' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'wiedersehen_gelungen') && f.nsc.haltung === haltung0 + HW.quellen.wert.gedankt.delta, 'Ankunft: gelungen (NSC verbuendet, Haltung +gedankt, Gedaechtnis wiedersehen_gelungen)');
  ok(t.funk.some((x) => x.from === f.nsc.name && x.text === TX.texte.wiedersehen_dank), 'der NSC freut sich');
  startBeat(g, f);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen', 'Abschluss gelungen');
  const f3 = Faden.wiedersehenKandidaten(g, BP.expandiere(p).vorlage);
  ok(f3.length === 1 && f3[0] === f.nsc.id, 'danach ist der juengste Faden der Kandidat (ein Wiedersehen mit dem Wiedersehen ist moeglich)');
  ok(Weltstand.validate(Weltstand.capture(g), g).filter((x) => /faeden/.test(String(x))).length === 0, 'der Stand ist schemagueltig');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('(e2) Wiedersehen: der Pruefer lehnt ab, wenn der NSC fehlt oder nicht taugt', () => {
  const t = neu(42), g = t.g;
  const p = plan([b('wiedersehen'), b('abschluss')]);
  const a0 = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
  ok(!a0.ok && /^WIEDERSEHEN_KEIN_NSC/.test(a0.grund) && Faden.zustandVon(g).abenteuerAngebote.length === 0, 'ohne jeden NSC: kein Angebot (WIEDERSEHEN_KEIN_NSC)');
  // ein NSC ohne konkrete Tat im Gedaechtnis (nur Geruecht): taugt nicht
  const { f: gf } = oeffne(g, plan([b('geruecht'), b('abschluss')]));
  startBeat(g, gf); flieg(t, gf.parameter.ort); startBeat(g, gf);
  ok(gf.phase === 'abgeschlossen' && gf.nsc.gedaechtnis.every((x) => !(x.ereignis in TX.werte.wiedersehen_erinnert.wert)), 'ein abgeschlossener Faden ohne Tat der Crew im Gedaechtnis (' + gf.nsc.gedaechtnis.map((x) => x.ereignis).join(', ') + ')');
  ok(!Faden.abenteuerAnbieten(g, p, { hex: '0305' }).ok, 'dieser NSC taugt nicht: kein Angebot');
  flieg(t, '0305');
  // ein NSC mit Tat, aber tot
  const alt = altNsc(t);
  alt.nsc.status = 'tot';
  ok(!Faden.abenteuerAnbieten(g, p, { hex: '0305' }).ok, 'ein toter NSC taugt nicht');
  alt.nsc.status = 'verbuendet';
  // Volk des NSC nicht im Plan
  const p2 = plan([b('wiedersehen'), b('abschluss')], { volk_erlaubt: [alt.nsc.fraktion === 'rom' ? 'kon' : 'rom'] });
  ok(!Faden.abenteuerAnbieten(g, p2, { hex: '0305' }).ok, 'das Volk des NSC gehoert nicht zu den Voelkern des Plans: kein Angebot');
  ok(Faden.abenteuerAnbieten(g, p, { hex: '0305' }).ok, 'mit tauglichem NSC: Angebot');
  // laeuft der NSC gerade in einem aktiven Faden, taugt er nicht
  const nr = Faden.zustandVon(g).abenteuerAngebote[0].nr;
  ok(Faden.abenteuerOeffnen(g, nr, { nsc_von: alt.nsc.id }).ok, 'geoeffnet');
  const a3 = Faden.abenteuerAnbieten(g, plan([b('wiedersehen'), b('abschluss')], { titel: 'Noch ein Wiedersehen' }), { hex: '0305' });
  ok(!a3.ok && /^WIEDERSEHEN_KEIN_NSC/.test(a3.grund), 'solange der NSC in einem aktiven Faden steht, kein zweites Wiedersehen');
  // Der Weg ueber faden_oeffnen (Notruf-Angebot, PARAM_FELDER): nsc_von ist erlaubt, wo die Vorlage ein Wiedersehen eroeffnet
  const g2 = neu(43).g; const t2 = { g: g2, funk: [], run: (s) => { for (let i = 0; i < Math.round(s * 30); i++) { g2.space.enemies = []; g2.step(); } } };
  const alt2 = altNsc({ g: g2, run: t2.run, funk: [] });
  const vl = klon(BP.expandiere(p).vorlage); vl.id = 'wiedersehen_probe';
  ok(D.registriere(vl).ok, 'Vorlage (Datei-Weg) mit Wiedersehen am Anfang registriert');
  try {
    const an = Faden.ausgangMitPerson(g2, { art: 'notruf', id: 'notruf_t1', hex: '0305', sprecher: 'S', ausgang: 'gelungen' });
    ok(an && an.vorlagen.includes('wiedersehen_probe'), 'ein Notruf-Angebot kennt die Vorlage');
    const bef = (par) => Faden.befehlPruefen(g2, { typ: 'faden_oeffnen', vorlage: 'wiedersehen_probe', parameter: Object.assign({ angebot: an.nr }, par) });
    ok(/^NSC_VON_FEHLT/.test(bef({})), 'faden_oeffnen ohne nsc_von: NSC_VON_FEHLT');
    ok(/^NSC_VON/.test(bef({ nsc_von: '__proto__' })) && /^NSC_VON/.test(bef({ nsc_von: 'n9999' })), 'faden_oeffnen mit falschem nsc_von: abgelehnt');
    ok(bef({ nsc_von: alt2.nsc.id }) === null, 'faden_oeffnen mit nsc_von: gueltig');
    const an2 = Faden.ausgangMitPerson(g2, { art: 'notruf', id: 'notruf_pirat_frachter', hex: '0305', sprecher: 'S', ausgang: 'gelungen' });
    const nvf = Faden.befehlPruefen(g2, { typ: 'faden_oeffnen', vorlage: 'dankbarer_captain', parameter: { angebot: an2 && an2.nr, nsc_von: alt2.nsc.id } });
    ok(/^NSC_VON: nsc_von gibt es nur/.test(nvf || ''), 'nsc_von bei einer Vorlage ohne Wiedersehen: abgelehnt (' + String(nvf).slice(0, 50) + ')');
    const rr = Faden.befehlAnwenden(g2, { typ: 'faden_oeffnen', vorlage: 'wiedersehen_probe', parameter: { angebot: an.nr, nsc_von: alt2.nsc.id } });
    ok(rr.ok && rr.faden.nsc.name === alt2.nsc.name && rr.faden.nsc.id !== alt2.nsc.id, 'der Faden ist offen, derselbe NSC mit neuer Kennung');
    const pj = JSON.parse('{"__proto__":{"x":1},"angebot":1}');
    ok(/^PARAMETER/.test(Faden.befehlPruefen(g2, { typ: 'faden_oeffnen', vorlage: 'wiedersehen_probe', parameter: pj }) || ''), 'faden_oeffnen mit Schluessel __proto__: PARAMETER');
  } finally { D.entferne('wiedersehen_probe'); }
  ok(g.errors === 0 && g2.errors === 0, 'keine Serverfehler');
});

section('(e3) Wiedersehen: Fristablauf (der NSC wartet vergeblich) kostet Haltung, der Faden geht weiter', () => {
  const t = neu(44), g = t.g;
  const alt = altNsc(t);
  const { f } = oeffne(g, plan([b('wiedersehen'), b('abschluss')]), { nsc_von: alt.nsc.id });
  const h0 = f.nsc.haltung;
  startBeat(g, f);
  grenzen(g, FRIST, 'andocken');
  ok(f.phase === 'wartet' && f.nsc.status === 'aktiv' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'wiedersehen_gescheitert') && f.nsc.haltung === h0 + HW.quellen.wert.bitte_abgelehnt.delta, 'gescheitert: Gedaechtnis wiedersehen_gescheitert, Haltung sinkt um bitte_abgelehnt');
  startBeat(g, f);
  ok(f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', 'Abschluss ohne Belohnung');
});

section('(e4) Wiedersehen: der letzte passende Eintrag des Gedaechtnisses gewinnt; die Wahrheit des alten Fadens kommt nicht mit', () => {
  const t = neu(45), g = t.g;
  const alt = altNsc(t);
  alt.nsc.gedaechtnis = [{ tick: 1, ereignis: 'notruf_gelungen', text_key: 'x' }, { tick: 2, ereignis: 'fracht_gescheitert', text_key: 'x' }, { tick: 3, ereignis: 'spur_gelungen', text_key: 'x' }, { tick: 4, ereignis: 'abschluss_gelungen', text_key: 'x' }];
  alt.nsc.wahrheit = { id: 'ist_germane', fraktion: 'ger', offenbart: true };
  const { f } = oeffne(g, plan([b('wiedersehen'), b('abschluss')]), { nsc_von: alt.nsc.id });
  ok(f && f.nsc.wahrheit === null && alt.nsc.wahrheit.offenbart === true && alt.nsc.id !== f.nsc.id, 'die verborgene Wahrheit des alten Fadens gehoert dem alten Faden (neu: keine), der alte NSC bleibt unveraendert');
  ok(f.nsc.gedaechtnis !== alt.nsc.gedaechtnis && f.nsc.gedaechtnis.length === 4, 'das Gedaechtnis ist eine Kopie');
  startBeat(g, f);
  const soll = ERINNERT('fracht_gescheitert', f.parameter.ort);
  ok(t.funk.some((x) => x.from === f.nsc.name && x.text === soll), 'Taten ohne Text (spur_gelungen, abschluss_gelungen) zaehlen nicht, die letzte passende Tat gewinnt: „' + soll + '“');
  ok(Weltstand.validate(Weltstand.capture(g), g).filter((x) => /faeden/.test(String(x))).length === 0, 'der Stand ist schemagueltig');
});

// ---------------------------------------------------------------- (f) Komposition, Mock, Logbuch
section('(f) Mock-Komponist (A2) kennt die neuen Typen: Plaene mit jedem neuen Typ entstehen, der Pruefer nimmt sie an; ohne NSC fuer ein Wiedersehen kommt keiner vor', () => {
  const t = neu(51);
  const rng = () => { let s = 12345; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
  for (const typ of NEU) {
    let gut = 0, mit = 0; const r = rng();
    for (let i = 0; i < 40; i++) { const p = AM.gueltigerPlan(r, { mit: typ, min: 2 }); if (BP.pruefe(p).ok) gut++; if (p.beats[0].typ === typ) mit++; }
    ok(gut === 40 && mit === 40, `${typ}: 40 Plaene mit ${typ} am Anfang, der Expander und der Pruefer nehmen alle an`);
  }
  const r = rng(); let typen = new Set(); for (let i = 0; i < 300; i++) for (const bt of AM.gueltigerPlan(r, { wiedersehen: false }).beats) typen.add(bt.typ);
  ok(typen.has('geruecht') && typen.has('spur') && !typen.has('wiedersehen'), 'ohne wiedersehen: der Zufall mischt Geruecht und Spur unter, nie ein Wiedersehen');
  const r2 = rng(); typen = new Set(); for (let i = 0; i < 300; i++) for (const bt of AM.gueltigerPlan(r2, { wiedersehen: true }).beats) typen.add(bt.typ);
  ok(typen.has('wiedersehen'), 'mit wiedersehen: auch dieser Typ kommt im Zufall vor');
  // durch den echten Anbieten-Weg
  const o = oeffne(t.g, AM.gueltigerPlan(rng(), { mit: 'geruecht' }), undefined, '0305');
  ok(o.f && o.f.plan && beatTypen(o.f.plan)[0] === 'geruecht', 'ein Mock-Plan mit Geruecht wird angeboten und geoeffnet');
  const prompt = AP.baue(t.g, { nr: 2, grenze: 'szene_ende', hex: '0305', letzte: [{ typen: ['geruecht'] }] });
  ok(!prompt.fehler && !NAMEN.some((x) => prompt.prompt.includes(x)) && !prompt.prompt.includes('ZEBRAKAI'), 'Prompt ohne Spielernamen und ohne Titel oder Anlass');
  const typenMock = (g) => { const s = new Set(); for (let i = 1; i <= 120; i++) { const pr = AP.baue(g, { nr: i, grenze: 'szene_ende', hex: '0305', letzte: [] }); const e = AM.erzeuge({ prompt: pr.prompt }); if (e.korruption) continue; const pl = JSON.parse(e.text.slice(e.text.indexOf('{'), e.text.lastIndexOf('}') + 1)); for (const bt of pl.beats) s.add(bt.typ); } return s; };
  const ohneNsc = typenMock(t.g);
  ok(!ohneNsc.has('wiedersehen') && ohneNsc.has('geruecht') && ohneNsc.has('spur'), 'Mock ueber den echten Prompt (Kontext wiedersehen_nsc 0): nie ein Wiedersehen, aber Geruecht und Spur');
  const t2 = neu(52); altNsc(t2);
  ok(typenMock(t2.g).has('wiedersehen'), 'Mock ueber den echten Prompt (Kontext wiedersehen_nsc 1): auch ein Wiedersehen kommt vor');
  const p2 = AP.baue(t2.g, { nr: 1, grenze: 'szene_ende', hex: '0305', letzte: [] });
  const kt = JSON.parse(/<kontext>\n([\s\S]*?)\n<\/kontext>/.exec(p2.prompt)[1]);
  ok(Object.values(kt.faeden.wiedersehen_nsc).reduce((x, y) => x + y, 0) === 1 && kt.faeden.wiedersehen_nsc[liste(t2.g)[0].nsc.fraktion] === 1, 'Kontext: ein NSC taugt fuer ein Wiedersehen (nur Zahlen je Volk, das Volk des NSC: 1)');
  ok(!p2.prompt.includes(liste(t2.g)[0].nsc.name), 'der Name des NSC steht nie im Prompt');
});

section('(f2) Logbuch: nie Spielernamen, nie Titel oder Anlass', () => {
  const t = neu(53), g = t.g;
  opsSetzen(t);
  const alt = altNsc(t);
  const { f } = oeffne(g, plan([b('geruecht'), b('abschluss')]));
  startBeat(g, f); flieg(t, f.parameter.ort); startBeat(g, f);
  flieg(t, '0305');
  const { f: fs2 } = oeffne(g, plan([b('spur'), b('abschluss')]));
  startBeat(g, fs2); grenzen(g, FRIST, 'andocken'); startBeat(g, fs2);
  const { f: f2 } = oeffne(g, plan([b('wiedersehen'), b('abschluss')]), { nsc_von: alt.nsc.id });
  startBeat(g, f2);
  const text = JSON.stringify(logbuch(g));
  ok(logbuch(g).length > 10, logbuch(g).length + ' Logbuch-Eintraege');
  ok(!NAMEN.some((x) => text.includes(x)) && !/ZEBRAKAI/.test(text), 'kein Spielername, kein Titel, kein Anlass im Logbuch');
  ok(['geruecht', 'spur', 'wiedersehen'].every((k) => logbuch(g).some((e) => e.art === 'faden_baustein' && e.ausgang === k)), 'alle drei Bausteine schreiben ins Logbuch');
});

// ---------------------------------------------------------------- (h) Nacharbeit B1: Zustand des alten NSC, Reihenfolge, Spuren, Ort, Karte, Prompt
const NICHT_KANDIDAT = ['gefangen', 'geflohen', 'feindlich', 'schuldet_nichts', 'tot'], KANDIDAT = ['aktiv', 'verbuendet'];
section('(h1) Wiedersehen: der Zustand des alten NSC muss zum ersten Beat passen (braucht.nsc_status der Daten): gefangen, geflohen, feindlich, schuldet_nichts, tot sind kein Kandidat', () => {
  ok(D.WERTE.status.every((s) => NICHT_KANDIDAT.includes(s) || KANDIDAT.includes(s)) && NICHT_KANDIDAT.concat(KANDIDAT).every((s) => D.WERTE.status.includes(s)), 'jeder Zustand der Daten ist hier eingeordnet: ' + D.WERTE.status.join(', '));
  const p = plan([b('wiedersehen'), b('abschluss')]);
  const vorlage = () => BP.expandiere(p).vorlage;
  let n = 0;
  for (const st of NICHT_KANDIDAT) {
    const t = neu(100 + n++), g = t.g;
    const alt = altNsc(t);
    alt.nsc.status = st;
    ok(Faden.wiedersehenKandidaten(g, vorlage()).length === 0, `${st}: wiedersehenKandidaten liefert den NSC nicht`);
    const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
    ok(!a.ok && /^WIEDERSEHEN_KEIN_NSC/.test(a.grund) && Faden.zustandVon(g).abenteuerAngebote.length === 0, `${st}: abenteuerAnbieten lehnt ab (WIEDERSEHEN_KEIN_NSC), kein Angebot`);
    const r = Pruefer.pruefeNscVon(Faden.zustandVon(g), vorlage(), { nsc_von: alt.nsc.id });
    ok(r && /^NSC_VON:/.test(r), `${st}: der Pruefer lehnt nsc_von ab (NSC_VON)`);
    ok(AP.baue(g, { nr: 1, grenze: 'szene_ende', hex: '0305', letzte: [] }).prompt.includes('"wiedersehen_nsc"') && Object.values(kontextVon(AP.baue(g, { nr: 1, grenze: 'szene_ende', hex: '0305', letzte: [] }).prompt).faeden.wiedersehen_nsc).every((x) => x === 0), `${st}: der Kontext zaehlt ihn nicht`);
  }
  for (const st of KANDIDAT) {
    const t = neu(110 + n++), g = t.g;
    const alt = altNsc(t);
    alt.nsc.status = st;
    ok(JSON.stringify(Faden.wiedersehenKandidaten(g, vorlage())) === JSON.stringify([alt.nsc.id]), `${st}: Kandidat`);
    const a = Faden.abenteuerAnbieten(g, p, { hex: '0305' });
    ok(a.ok && Faden.abenteuerOeffnen(g, a.angebot.nr, { nsc_von: alt.nsc.id }).ok, `${st}: Angebot und Oeffnen gelingen`);
  }
  // die Liste kommt aus den Daten (braucht.nsc_status des ersten Beats), nicht aus dem Code: erlaubt der Katalog gefangen, ist ein gefangener NSC ein Kandidat
  const t = neu(120), g = t.g;
  const alt = altNsc(t); alt.nsc.status = 'gefangen';
  const st = D.BEATS.wiedersehen.braucht.nsc_status;
  st.push('gefangen');
  try { ok(Faden.wiedersehenKandidaten(g, vorlage()).length === 1, 'der Katalog (nsc_status um gefangen erweitert) macht den gefangenen NSC zum Kandidaten: die Regel steht in den Daten'); } finally { st.pop(); }
  ok(Faden.wiedersehenKandidaten(g, vorlage()).length === 0, 'nach dem Zuruecksetzen wieder kein Kandidat');
});

section('(h2) Wiedersehen: der Kandidat kann zwischen Anbieten und Oeffnen verschwinden: das Oeffnen scheitert sauber mit NSC_VON, das Angebot bleibt liegen, nichts aendert sich', () => {
  const t = neu(121), g = t.g;
  const alt = altNsc(t);
  const F0 = Faden.zustandVon(g);
  const a = Faden.abenteuerAnbieten(g, plan([b('wiedersehen'), b('abschluss')]), { hex: '0305' });
  ok(a.ok, 'Angebot da');
  const zaehler = () => JSON.stringify([F0.nsc, F0.nr, F0.liste.length, F0.abenteuerAngebote.map((x) => x.nr)]);
  const vorher = zaehler();
  alt.nsc.status = 'gefangen';   // der NSC taugt nicht mehr (andere Gruende: Verdraengung aus der Liste, schon aktiv in einem anderen Wiedersehen)
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, { nsc_von: alt.nsc.id });
  ok(!r.ok && /^NSC_VON/.test(r.grund), 'Oeffnen scheitert mit NSC_VON: ' + r.grund.slice(0, 40));
  ok(zaehler() === vorher && F0.abenteuerAngebote.length === 1 && F0.abenteuerAngebote[0].nr === a.angebot.nr, 'kein Faden, keine NSC-Nummer verbraucht, das Angebot liegt unveraendert da');
  ok(logbuch(g).some((e) => e.art === 'faden_pruefung' && e.key === 'abenteuer_oeffnen' && e.ausgang === 'abgelehnt'), 'Logbuch: abenteuer_oeffnen abgelehnt');
  alt.nsc.status = 'verbuendet';
  ok(Faden.abenteuerOeffnen(g, a.angebot.nr, { nsc_von: alt.nsc.id }).ok, 'ist der NSC wieder tauglich, gilt dasselbe Angebot (bis zum Verfall)');
  // Verdraengung: ist der alte Faden aus der Liste gefallen, scheitert das Oeffnen genauso
  const t2 = neu(122), g2 = t2.g;
  const alt2 = altNsc(t2);
  const a2 = Faden.abenteuerAnbieten(g2, plan([b('wiedersehen'), b('abschluss')]), { hex: '0305' });
  Faden.zustandVon(g2).liste.splice(0, 1);
  const r2 = Faden.abenteuerOeffnen(g2, a2.angebot.nr, { nsc_von: alt2.nsc.id });
  ok(!r2.ok && /^NSC_VON/.test(r2.grund) && Faden.zustandVon(g2).abenteuerAngebote.length === 1, 'alter Faden verdraengt: NSC_VON, das Angebot bleibt');
  ok(g.errors === 0 && g2.errors === 0, 'keine Serverfehler');
});

section('(h3) Wiedersehen: wiedersehenKandidaten liefert den juengsten Faden zuerst (hoechster Faden-Zaehler), deterministisch', () => {
  const t = neu(123), g = t.g;
  const A = altNsc(t);
  const B = altNsc(t);
  const vorlage = () => BP.expandiere(plan([b('wiedersehen'), b('abschluss')])).vorlage;
  const ids = () => Faden.wiedersehenKandidaten(g, vorlage());
  ok(Number(B.id.slice(1)) > Number(A.id.slice(1)) && A.nsc.name !== B.nsc.name, 'zwei abgeschlossene Faeden, B ist juenger');
  ok(JSON.stringify(ids()) === JSON.stringify([B.nsc.id, A.nsc.id]), 'juengster zuerst: ' + ids().join(', '));
  ok(JSON.stringify(ids()) === JSON.stringify(ids()), 'deterministisch');
  // Wiedersehen mit A: der neue Faden von A ist der juengste, der alte Faden von A zaehlt nicht mehr
  const { f } = oeffne(g, plan([b('wiedersehen'), b('abschluss')]), { nsc_von: A.nsc.id });
  startBeat(g, f); flieg(t, f.parameter.ort); startBeat(g, f);
  ok(f.phase === 'abgeschlossen', 'Wiedersehen mit A abgeschlossen');
  ok(JSON.stringify(ids()) === JSON.stringify([f.nsc.id, B.nsc.id]), 'A im juengsten Faden vorn, der alte Faden von A fehlt: ' + ids().join(', '));
  ok(Faden.zustandVon(g).liste.map((x) => x.id).join() === ['f1', 'f2', 'f3'].join(), 'die Liste selbst bleibt in der Reihenfolge der Faeden (Sortierung nur im Ergebnis)');
});

section('(h4) Spuren: kein Hex und kein Ast einer Spur liegt in einem Sektor mit Sperrtext, die Enthuellung oeffnet nie eine Kante dorthin; nur die vorgesehene Kante ist verborgen', () => {
  neu(130);
  const erlaubt = D.BEATS.spur.bauplan.parameter.spur.erlaubt;
  ok(erlaubt.length >= 2, 'mindestens zwei Spuren: ' + erlaubt.join(', '));
  const hexe = (h) => KARTE.hexe[h];
  const kante = (a, c) => KARTE.kanten.find((e) => (e.a === a && e.b === c) || (e.a === c && e.b === a));
  for (const id of erlaubt) {
    const d = lies('content/spuren/' + id + '.json');
    const alle = d.weg.slice(); const aeste = [];
    for (const tl of d.teilungen || []) for (const a of tl.aeste) { alle.push(a.nach); aeste.push([tl.ab, a.nach]); }
    ok(alle.every((h) => hexe(h) && hexe(h).spielbar === true && !gesperrt(h) && Sektoren.spielbar(h) && !Sektoren.sperrtext(h)), `${id}: alle Hexe und Aeste existieren, sind spielbar und ohne Sperrtext (${Array.from(new Set(alle)).join(', ')})`);
    ok(aeste.every(([von, nach]) => { const e = kante(von, nach); return e && e.art === 'open'; }), `${id}: die Kante zu jedem Ast ist offen`);
    const pfad = []; for (let i = 0; i + 1 < d.weg.length; i++) pfad.push(kante(d.weg[i], d.weg[i + 1]));
    ok(pfad.every((e) => e && e.art === 'open'), `${id}: jede Kante des Weges ist offen`);
    const verborgen = KARTE.kanten.filter((e) => e.key === d.ende.kante);
    const letzter = d.weg[d.weg.length - 1];
    ok(verborgen.length === 1 && verborgen[0].art === 'hidden' && [verborgen[0].a, verborgen[0].b].includes(letzter), `${id}: genau eine verborgene Kante (${d.ende.kante}) am letzten Hex: die vorgesehene`);
    const ziel = verborgen[0].a === letzter ? verborgen[0].b : verborgen[0].a;
    ok(hexe(ziel) && hexe(ziel).spielbar === true && !gesperrt(ziel) && !Sektoren.sperrtext(ziel), `${id}: die enthuellte Kante fuehrt nach ${ziel} (${hexe(ziel).name}), ohne Sperrtext`);
    ok(!(d.weg.concat(aeste.map((x) => x[1]))).some((h) => hexe(h).verborgen), `${id}: kein verborgener Sektor auf dem Weg`);
  }
  ok(gesperrt('0602') && gesperrt('0704'), 'Gegenprobe der Hilfsfunktion: Altrost (0602) und Raffinerie Lumen (0704) tragen einen Sperrtext');
});

section('(h5) Spur: eine bereits abgeschlossene Spur (Kante schon offen) bringt keine zweite Belohnung, der Beat endet sauber ohne Spur', () => {
  const t = neu(131), g = t.g;
  opsSetzen(t);
  const { f } = oeffne(g, plan([b('spur', { parameter: { spur: 'fundort' } }), b('abschluss')]));
  startBeat(g, f); flieg(t, '0705'); lese(t); flieg(t, '0605'); lese(t); t.run(0.2);
  ok(g.spur.fertig && kanteOffen(g, '0605', '0706') && f.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gelungen'), 'die erste Spur ist abgeschlossen, die Kante offen');
  startBeat(g, f);
  flieg(t, '0305');
  const haltung0 = f.nsc.haltung;
  for (const spurId of ['kantenpfad', 'fundort']) {
    const { f: f2 } = oeffne(g, plan([b('spur', { parameter: { spur: spurId } }), b('abschluss')]));
    const funk0 = t.funk.length, h0 = f2.nsc.haltung;
    startBeat(g, f2);
    ok(f2.phase === 'wartet' && f2.beat === 1 && f2.nsc.status === 'aktiv' && f2.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gescheitert') && !f2.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gelungen'), `${spurId}: Beat gescheitert, nicht gelungen`);
    ok(f2.nsc.haltung === h0 && !Marken.da(g, 'spur:' + spurId) && g.spur.id === 'fundort' && g.spur.fertig, `${spurId}: keine Belohnung (Haltung unveraendert), keine neue Spur, keine Marke`);
    ok(logbuch(g).some((e) => e.art === 'faden_baustein' && e.ausgang === 'abgelehnt' && /schon abgeschlossen/.test(e.begruendung) && e.plan && e.plan.spur === spurId), `${spurId}: Logbuch: die Spur ist schon abgeschlossen`);
    ok(!t.funk.slice(funk0).some((x) => x.text === TX.spuren[spurId].start.replace('{ort}', Sektoren.hexName(spurId === 'fundort' ? '0705' : '0603'))), `${spurId}: der NSC kuendigt keine Spur an`);
    startBeat(g, f2);
    ok(f2.phase === 'abgeschlossen' && f2.ausgang.art === 'gescheitert' && g.phase !== 'over', `${spurId}: der Faden endet ohne Belohnung, nie Game Over`);
  }
  ok(haltung0 === f.nsc.haltung && g.errors === 0, 'keine Serverfehler');
});

section('(h6) Spur: eine verwaiste Spur (Faden beim Laden verworfen) blockiert keinen neuen Beat und wird mit der Marke abgeraeumt; eine fremde Spur nie', () => {
  const t = neu(132), g = t.g;
  opsSetzen(t);
  const { f } = oeffne(g, plan([b('spur'), b('abschluss')]));
  startBeat(g, f);
  ok(g.spur && g.spur.id === 'kantenpfad' && Marken.da(g, 'spur:kantenpfad'), 'Spur laeuft');
  const data = Weltstand.capture(g);
  const sim = JSON.parse(JSON.stringify(data.welt.sim)); sim.faeden.liste[0].nsc.fraktion = 'zzz';   // der Faden besteht den Pruefer beim Laden nicht
  const laden = (seed) => {
    const t2 = neu(seed), g2 = t2.g;
    Kriegslage.restore(g2, JSON.parse(JSON.stringify(sim)));
    Spur.restore(g2, JSON.parse(JSON.stringify(data.welt.spur)));
    return { t2, g2 };
  };
  const { t2, g2 } = laden(133);
  ok(liste(g2).length === 0 && Faden.zustandVon(g2).ladeFehler.length === 1, 'der Faden ist beim Laden verworfen (ladeFehler)');
  ok(g2.spur && g2.spur.id === 'kantenpfad' && Marken.da(g2, 'spur:kantenpfad'), 'die Spur und ihre Marke sind wiederhergestellt');
  t2.run(0.2);
  ok(g2.spur === null && !Marken.da(g2, 'spur:kantenpfad'), 'der naechste Takt raeumt die verwaiste Spur samt Marke ab');
  const { f: fn } = oeffne(g2, plan([b('spur'), b('abschluss')]));
  startBeat(g2, fn);
  ok(fn.phase === 'laeuft' && g2.spur && g2.spur.id === 'kantenpfad', 'ein neuer Spur-Beat laeuft (nicht „es laeuft schon eine andere Spur“)');
  // ohne Takt dazwischen: der Beginn eines Spur-Beats raeumt die verwaiste Spur selbst ab
  const { g2: g3 } = laden(134);
  ok(g3.spur && g3.spur.id === 'kantenpfad', 'wieder geladen, noch kein Takt');
  const { f: f3 } = oeffne(g3, plan([b('spur', { parameter: { spur: 'fundort' } }), b('abschluss')]));
  startBeat(g3, f3);
  ok(f3.phase === 'laeuft' && g3.spur && g3.spur.id === 'fundort' && !Marken.da(g3, 'spur:kantenpfad') && Marken.da(g3, 'spur:fundort'), 'der Beginn eines Spur-Beats raeumt die verwaiste Spur selbst ab (neue Spur, alte Marke weg)');
  // eine fremde Spur (Kampagne) bleibt in jedem Fall
  const t4 = neu(135), g4 = t4.g;
  Spur.starten(g4, 'bote');
  t4.run(0.5);
  ok(g4.spur && g4.spur.id === 'bote' && Marken.da(g4, 'spur:bote'), 'die Spur der Kampagne (bote) bleibt nach dem Takt');
  ok(g.errors === 0 && g2.errors === 0 && g3.errors === 0 && g4.errors === 0, 'keine Serverfehler');
});

section('(h7) Spur: liefert der Funk des Beginns nichts (sagen null), bleibt die gestartete Spur nicht ohne Beat liegen', () => {
  const t = neu(136), g = t.g;
  const { f } = oeffne(g, plan([b('spur'), b('abschluss')]));
  const alt = TX_LIVE.spuren.kantenpfad.start;
  TX_LIVE.spuren.kantenpfad.start = '';
  try { startBeat(g, f); } finally { TX_LIVE.spuren.kantenpfad.start = alt; }
  ok(f.phase === 'wartet' && f.nsc.gedaechtnis.some((x) => x.ereignis === 'spur_gescheitert'), 'der Beat ist gescheitert');
  ok(g.spur === null && !Marken.da(g, 'spur:kantenpfad'), 'keine Spur, keine Marke liegen geblieben');
  ok(g.errors === 0, 'keine Serverfehler');
});

section('(h8) Ort: der Sektor der Crew selbst ist kein Ziel (hex der Vorlage in 0 Spruengen scheitert den Beat, ohne Flug kein Gelingen)', () => {
  for (const typ of ['geruecht', 'wiedersehen']) {
    const t = neu(typ === 'geruecht' ? 140 : 141), g = t.g;
    let nr = null;
    if (typ === 'wiedersehen') nr = altNsc(t).nsc.id;
    const v = klon(BP.expandiere(plan([b(typ), b('abschluss')])).vorlage);
    v.beats[0].parameter = { hex: '0305' }; v.id = D.abenteuerId(v);
    ok(D.registriereAbenteuer(v).ok, `${typ}: die Vorlage mit hex 0305 (Sektor der Crew) besteht den Pruefer`);
    const { f } = oeffne(g, plan([b(typ), b('abschluss')]), nr ? { nsc_von: nr } : undefined);
    f.plan = klon(v); f.vorlage = v.id;
    ok(hier(g) === '0305', 'die Crew steht in 0305');
    const funk0 = t.funk.length;
    startBeat(g, f);
    ok(f.phase === 'wartet' && f.nsc.gedaechtnis.some((x) => x.ereignis === typ + '_gescheitert') && !f.nsc.gedaechtnis.some((x) => x.ereignis === typ + '_gelungen'), `${typ}: der Beat ist gescheitert, nicht gelungen`);
    ok(t.funk.length === funk0, `${typ}: kein Funk (kein Treffpunkt genannt)`);
    ok(logbuch(g).some((e) => e.art === 'faden_baustein' && e.ausgang === 'abgelehnt'), `${typ}: Logbuch: abgelehnt`);
  }
  // der Zufallsort ist nie der Sektor der Crew (auch nicht, wenn die Crew woanders steht)
  for (const start of ['0305', '0505', '0605']) {
    const t = neu(142), g = t.g; flieg(t, start);
    const { f } = oeffne(g, plan([b('geruecht'), b('abschluss')]), undefined, start);
    startBeat(g, f);
    ok(f.phase === 'laeuft' && f.parameter.ort !== start, `Crew in ${start}: Ziel ${f.parameter.ort} ist ein anderer Sektor`);
  }
});

section('(h9) Pruefer: hex, ort und Angebots-Hex gelten fuer die Karte der Freien Fahrt (sund_frei), nicht fuer den gerade global geladenen Kartenstand', () => {
  const Welt = require('../server/sim/welt.js');
  const vorlage = (hex) => { const v = klon(BP.expandiere(plan([b('geruecht'), b('abschluss')])).vorlage); v.beats[0].parameter.hex = hex; return v; };
  const vorher = Sektoren.kartenId();
  try {
    Welt.waehle(null, 'limes');
    ok(Sektoren.kartenId() === 'limes' && !Sektoren.spielbar('1105') && Sektoren.spielbar('0108'), 'Vorbereitung: Limes ist geladen (1105 gibt es dort nicht, 0108 ist dort Leerraum)');
    ok(Pruefer.pruefeVorlage(vorlage('1105')).ok, 'hex 1105 (Ymirs Zahn, nur auf der Sund-Karte): gueltig, auch wenn Limes geladen ist');
    ok(hat(Pruefer.pruefeVorlage(vorlage('0108')), 'PARAMETER'), 'hex 0108 (nur auf Limes im Raster): PARAMETER');
    const F0 = { abenteuerAngebote: [] };
    ok(Pruefer.pruefeAbenteuerAnbieten(F0, { hex: '1105' }) === null && /^PARAMETER/.test(Pruefer.pruefeAbenteuerAnbieten(F0, { hex: '0108' })), 'Abenteuer anbieten: Ort 1105 gueltig, 0108 PARAMETER');
  } finally { Welt.waehle(null, vorher); }
  ok(Sektoren.kartenId() === vorher, 'Karte zurueckgesetzt (' + vorher + ')');
  ok(Pruefer.sundSpielbar('1105') && !Pruefer.sundSpielbar('0108') && !Pruefer.sundSpielbar('9999') && !Pruefer.sundSpielbar('abcd') && !Pruefer.sundSpielbar(1105), 'sundSpielbar: Sund-Hexe ja, ausserhalb des Rasters und Unsinn nein');
});

section('(h10) Zielwahl und Sprungregeln: Geruecht und Wiedersehen nennen nie einen Sektor ueber eine geschlossene Kante; eine unbekannte Boje (Weitscan) ist erlaubt', () => {
  const Sprung = require('../server/sim/sprung.js');
  const ziele = new Set();
  for (let seed = 150; seed < 162; seed++) {
    const t = neu(seed), g = t.g;
    const { f } = oeffne(g, plan([b('geruecht'), b('abschluss')]));
    startBeat(g, f);
    const z = f.parameter.ort, d0 = abstaende('0305'); ziele.add(z);
    const ersteSprunge = Sektoren.nachbarn('0305').filter((n) => kanteOffen(g, '0305', n) && abstaende(n)[z] === d0[z] - 1);
    ok(ersteSprunge.length >= 1 && ersteSprunge.every((n) => { const gr = Sprung.hexGrund(g, '0305', n); return gr === null || /Boje suchen/.test(gr); }), `Seed ${seed}: Ziel ${z}, der erste Sprung (${ersteSprunge.join(', ')}) ist nach den Sprungregeln nutzbar oder nur die Boje fehlt`);
  }
  ok(!ziele.has('0706') && !ziele.has('0602') && !ziele.has('0606'), 'nie ein Sektor hinter einer verborgenen Kante (' + Array.from(ziele).sort().join(', ') + ')');
  // die Boje der ersten Kante ist der Crew unbekannt: das Geruecht nennt den Sektor trotzdem (Weitscan findet sie), geschlossene Kanten nie
  const t = neu(163), g = t.g; flieg(t, '0505');
  const id = Sektoren.kanteId('0505', '0605');
  g.explore.erkundet.delete('0605'); g.explore.bojenGefunden.delete(id);
  ok(!g.explore.bojeBekannt(id) && /Boje suchen/.test(Sprung.hexGrund(g, '0505', '0605')), 'Vorbereitung: die Boje 0505-0605 ist unbekannt (hexGrund: Boje suchen)');
  const gz = B1.erreichbar(g, '0505', 3);
  ok(gz.get('0605') === 1 && gz.get('0706') === undefined, 'erreichbar() nennt 0605 trotz unbekannter Boje, 0706 (verborgene Kante) nie');
  g.explore.markBoje(id);
  ok(Sprung.hexGrund(g, '0505', '0605') === null, 'nach dem Weitscan (markBoje) ist der Sprung frei');
});

section('(h11) Prompt: wiedersehen_nsc ist eine Zahl je Volk (der Plan darf volk_erlaubt setzen); Katalog und Systemprompt erklaeren sie; keine Namen; Katalog unter 12 000 Zeichen', () => {
  const t = neu(170), g = t.g;
  AP.katalogNeuLesen();
  const k = AP.katalogText();
  ok(k.length < 12000, 'Katalog ' + k.length + ' Zeichen (unter 12 000)');
  ok(/faeden\.wiedersehen_nsc: Zahl je Volk \(rom \| ger \| kon\)/.test(k) && /Standard rom \| kon/.test(k) && /nur Zahlen, keine Namen/.test(k), 'der Katalog erklaert die Zahl: je Volk, mit dem Standard-Volk-Set, ohne Namen');
  const sys = fs.readFileSync('content/spielleiter/prompts/abenteuer.system.md', 'utf8');
  ok(/faeden\.wiedersehen_nsc/.test(sys) && /je Volk/.test(sys) && /volk_erlaubt/.test(sys), 'der Systemprompt erklaert, was die Zahl bedeutet');
  const alt = altNsc(t);
  const volk = alt.nsc.fraktion;
  const zahlen = () => kontextVon(AP.baue(g, { nr: 1, grenze: 'szene_ende', hex: '0305', letzte: [] }).prompt).faeden.wiedersehen_nsc;
  const z1 = zahlen();
  ok(z1[volk] === 1 && Object.entries(z1).every(([v, n]) => v === volk || n === 0), 'Kontext: genau ein NSC, nur bei seinem Volk (' + volk + '): ' + JSON.stringify(z1));
  ok(!NAMEN.some((x) => JSON.stringify(z1).includes(x)) && !AP.baue(g, { nr: 1, grenze: 'szene_ende', hex: '0305', letzte: [] }).prompt.includes(alt.nsc.name), 'kein Name im Prompt');
  // ein NSC eines Volkes ausserhalb des Standard-Sets (ger): ein Plan mit volk_erlaubt [ger] bekommt ein Angebot, ein Plan mit dem Standard-Set nicht
  alt.nsc.fraktion = 'ger';
  ok(zahlen().ger === 1 && zahlen().rom === 0 && zahlen().kon === 0, 'Kontext: der NSC zaehlt beim Volk ger');
  const typen = () => { const s = new Set(); for (let i = 1; i <= 120; i++) { const e = AM.erzeuge({ prompt: AP.baue(g, { nr: i, grenze: 'szene_ende', hex: '0305', letzte: [] }).prompt }); if (e.korruption) continue; for (const bt of JSON.parse(e.text.slice(e.text.indexOf('{'), e.text.lastIndexOf('}') + 1)).beats) s.add(bt.typ); } return s; };
  ok(!typen().has('wiedersehen'), 'der Mock-Komponist plant kein Wiedersehen, wenn nur ein Volk ausserhalb seines Standard-Sets einen NSC hat');
  const std = Faden.abenteuerAnbieten(g, plan([b('wiedersehen'), b('abschluss')]), { hex: '0305' });
  ok(!std.ok && /^WIEDERSEHEN_KEIN_NSC/.test(std.grund), 'ein Plan mit dem Standard-Volk-Set: kein Angebot (WIEDERSEHEN_KEIN_NSC)');
  const ger = Faden.abenteuerAnbieten(g, plan([b('wiedersehen'), b('abschluss')], { volk_erlaubt: ['ger'] }), { hex: '0305' });
  ok(ger.ok && Faden.abenteuerOeffnen(g, ger.angebot.nr, { nsc_von: alt.nsc.id }).ok, 'ein Plan mit volk_erlaubt [ger]: Angebot und Oeffnen gelingen');
  alt.nsc.fraktion = 'kon';
  ok(zahlen().kon === 0, 'Gegenprobe: der NSC steckt jetzt in einem aktiven Faden, die Zahl ist 0');
});

section('(h12) Pruefer: ort von faden_oeffnen gilt fuer die Karte der Freien Fahrt (sund_frei), auch wenn global Limes geladen ist', () => {
  const Welt = require('../server/sim/welt.js');
  const t = neu(171), g = t.g;
  const an = Faden.ausgangMitPerson(g, { art: 'notruf', id: 'notruf_pirat_frachter', hex: '0305', sprecher: 'S', ausgang: 'gelungen' });
  const bef = (ortHex) => Faden.befehlPruefen(g, { typ: 'faden_oeffnen', vorlage: 'dankbarer_captain', parameter: { angebot: an.nr, ort: ortHex } });
  const vorher = Sektoren.kartenId();
  try {
    Welt.waehle(null, 'limes');
    ok(bef('1105') === null, 'ort 1105 (nur auf der Sund-Karte): gueltig, auch wenn Limes geladen ist');
    ok(/^PARAMETER/.test(bef('0108') || ''), 'ort 0108 (auf Limes im Raster, auf der Sund-Karte nicht): PARAMETER');
  } finally { Welt.waehle(null, vorher); }
  ok(Sektoren.kartenId() === vorher, 'Karte zurueckgesetzt');
});

// ---------------------------------------------------------------- (g) ohne Schalter nichts
section('(g) Ohne FAEDEN=1 tut nichts etwas: Hook, Abenteuer, Weltstand', () => {
  const t = F.neuesSpiel({ crew: 1, seed: 7, env: {} }); const g = t.g;
  const vor = JSON.stringify(Weltstand.capture(g).welt.sim);
  B1.update(g); B1.update(g);
  for (let i = 0; i < 30; i++) g.step();
  ok(!Faden.abenteuerAnbieten(g, plan([b('geruecht'), b('abschluss')]), { hex: '0305' }).ok, 'Abenteuer ohne Schalter: abgelehnt (INAKTIV)');
  ok(JSON.stringify(Weltstand.capture(g).welt.sim) === vor && !('faeden' in Weltstand.capture(g).welt.sim), 'der Weltstand ist byte-gleich, ohne Block faeden');
  ok(g.spur === null || g.spur === undefined, 'keine Spur');
  ok(g.errors === 0, 'keine Serverfehler');
});

console.log(`\n${n - fails} von ${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
