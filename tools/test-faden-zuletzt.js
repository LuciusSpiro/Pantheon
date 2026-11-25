'use strict';
// SPT-02 2 (B2): der eben beendete Faden bleibt sichtbar. Server: abenteuer-brett.js (zuletztMerken/zuletztVon, Snapshot world.abenteuer.zuletzt { titel, ausgang, text, w? }), Client: public/js/notrufe.js (Pseudo-Eintrag).
// Regel (getestet): zuletzt steht, solange kein neuer Faden entstanden ist und weniger als zuletzt_gilt_taetigkeiten Taetigkeiten vergangen sind; ein spaeter endender Faden ersetzt ihn.
//   A: gescheiterter Faden in b2_abschluss schliesst ab, zuletzt gefuellt (Text des Abschluss-Beats), Snapshot und Schluessel   B: gelungen mit Wirkung w   C: Wegfall (neuer Faden, Zeit) und Ersatz   D: Client-Pseudo-Eintrag nicht annehmbar/verfolgbar
//   node tools/test-faden-zuletzt.js
const path = require('path');
const vm = require('vm');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Faden = require('./../server/sim/faden.js');
const D = require('../server/sim/faden-daten.js');
const Brett = require('../server/sim/abenteuer-brett.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };
const Fz = (g) => Faden.zustandVon(g);
const plan = (beats, titel) => ({ format: 'faden-bauplan/1', titel, anlass: 'Ein Test ohne Namen fuer das Brett.', beats, volk_erlaubt: ['rom'] });
function live(seed) {
  const g = F.neuesSpiel({ crew: 1, seed, env: ENV }).g;
  const fehler = []; g.countError = (wo, e) => { fehler.push(wo + ': ' + (e && e.message)); };
  g.weltsim.zustand.flotten = [];
  Fz(g).abenteuerAngebote.length = 0;
  g.lageSpielleiter.rueckfallBetrieb = false; g.lageSpielleiter.mode = 'mock';
  return { g, fehler };
}
function annehmen(g, p) {
  const r = Faden.abenteuerAnbieten(g, p, { hex: Sektoren.hexVonOrt(g.ship.scene) });
  if (!r.ok) return null;
  if (Brett.annehmen(g, 'a' + r.angebot.nr) !== null) return null;
  return Fz(g).liste.find((x) => x.plan && x.vorlage === r.angebot.ref) || null;
}
const weiter = (g, f) => (f.beat < 1 && (f.zaehler = Math.max(f.zaehler, f.abstand)), 0) || Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
const taetig = (g, k) => { for (let i = 0; i < k; i++) Faden.taetigkeit(g, 'andocken'); };
const bisFaellig = (g, f) => { for (let i = 0; i < 40 && f.zaehler < f.abstand; i++) taetig(g, 1); };
// Plan geleit + abschluss: Beat 0 scheitert an der Frist (gescheitert) oder gelingt (Ausgang gesetzt), danach schliesst der Takt ab
function beenden(g, titel, gelingt) {
  const f = annehmen(g, plan([{ typ: 'geleit' }, { typ: 'abschluss' }], titel));
  if (!f) return null;
  g.step();
  if (!weiter(g, f).ok) return null;
  if (gelingt) Faden.beatAusgang(g, f.id, 'gelungen'); else taetig(g, D.WERTE.beat_frist + 1);
  g.step(); bisFaellig(g, f); g.step();
  return f;
}

console.log('\nA: gescheiterter Faden: zuletzt gefuellt');
for (const seed of [7, 11]) {
  const { g, fehler } = live(seed);
  ok(Brett.snapshot(g) === null && Brett.schluessel(g) === null, `Seed ${seed}: ohne Faden kein Block, kein zuletzt`);
  const f = beenden(g, 'Geleit nach Rom', false);
  ok(!!f && f.phase === 'abgeschlossen' && f.ausgang.art === 'gescheitert', `Seed ${seed}: der Faden ist abgeschlossen (gescheitert)`);
  const s = Brett.snapshot(g);
  const z = s && s.zuletzt;
  ok(!!z && z.titel === 'Geleit nach Rom' && z.ausgang === 'gescheitert', `Seed ${seed}: Snapshot zuletzt mit Titel und Ausgang (${JSON.stringify(z && { t: z.titel, a: z.ausgang })})`);
  ok(!!z && /hört ihr nichts mehr/.test(z.text) && !z.w, `Seed ${seed}: Text ist der des Abschluss-Beats (abschluss_gescheitert), keine Wirkung beim Scheitern (${z && z.text})`);
  ok(Brett.schluessel(g) !== null && !('abschlussText' in f) && Object.keys(z || {}).sort().join() === 'ausgang,text,titel', `Seed ${seed}: Schluessel gesetzt, f.abschlussText geloescht, genau die Felder titel/ausgang/text`);
  const sv = JSON.stringify(Faden.toSave(g.weltsim));
  ok(!sv.includes('abschlussText') && !sv.includes('hört ihr nichts'), `Seed ${seed}: nichts davon im Weltstand`);
  ok(g.errors === 0 && fehler.length === 0, `Seed ${seed}: keine Fehler`);
  // zuletzt allein (kein Angebot, kein laufender Faden) wird trotzdem gesendet; zuletzt zaehlt im Schluessel mit
  const FZ = Fz(g), ang = FZ.abenteuerAngebote.slice(); FZ.abenteuerAngebote.length = 0;
  const alleine = Brett.snapshot(g);
  ok(!!alleine && alleine.angebote.length === 0 && !!alleine.zuletzt && Brett.schluessel(g) !== null, `Seed ${seed}: ohne Angebot und laufenden Faden steht zuletzt allein im Block`);
  FZ.abenteuerAngebote.push(...ang);
  const mit = Brett.schluessel(g), zz = FZ.brett.zuletzt; delete FZ.brett.zuletzt;
  const ohne = Brett.schluessel(g); FZ.brett.zuletzt = zz;
  ok(ang.length === 0 || mit !== ohne, `Seed ${seed}: der Schluessel aendert sich mit zuletzt (${ang.length} Angebote am Brett)`);
}
{   // ueber den echten Snapshot
  const { g } = live(7);
  beenden(g, 'Geleit nach Rom', false);
  let w; for (let i = 0; i < 40 && !w; i++) { const s = g.snapshot(); if (s.world && s.world.abenteuer) w = s.world.abenteuer; }
  ok(!!w && !!w.zuletzt && w.zuletzt.titel === 'Geleit nach Rom', 'g.snapshot(): world.abenteuer.zuletzt kommt an');
}

console.log('\nB: gelungener Faden: Ausgang und Wirkung des Abschluss-Beats');
{
  const { g, fehler } = live(23);
  const f = beenden(g, 'Geleit nach Ostia', true);
  const z = (Brett.snapshot(g) || {}).zuletzt;
  const b = f && D.vorlage(f.vorlage).beats[f.beat];
  const folge = b && b.aus && b.aus.gelungen && b.aus.gelungen.folge;
  ok(!!f && f.phase === 'abgeschlossen' && f.ausgang.art === 'gelungen' && !!z && z.ausgang === 'gelungen', 'Ausgang gelungen im Snapshot');
  ok(!!z && !/hört ihr nichts mehr/.test(z.text) && z.text.length > 10, `Text des gelungenen Abschlusses (${z && z.text})`);
  const erwartet = Brett.marken(folge, f.parameter.volk);
  ok(JSON.stringify((z && z.w) || []) === JSON.stringify(erwartet.slice(0, 4)), `w sind genau die Marken des Abschluss-Beats (${JSON.stringify(erwartet)})`);
  ok(g.errors === 0 && fehler.length === 0, 'keine Fehler');
}

console.log('\nC: Wegfall und Ersatz');
{
  const { g, fehler } = live(11);
  const f1 = beenden(g, 'Erstes Geleit', false);
  ok(!!Brett.zuletztVon(Fz(g)), 'nach dem Ende steht zuletzt');
  const k0 = Brett.schluessel(g);
  taetig(g, D.BRETT.werte.zuletzt_gilt_taetigkeiten - 2);
  ok(!!Brett.zuletztVon(Fz(g)), 'kurz vor der Frist steht es noch');
  taetig(g, 2);
  ok(Brett.zuletztVon(Fz(g)) === null && Brett.schluessel(g) !== k0, 'nach zuletzt_gilt_taetigkeiten Taetigkeiten faellt es weg (der Schluessel aendert sich, der Client bekommt den Block neu)');
  ok(!(Brett.snapshot(g) || {}).zuletzt, 'Snapshot ohne zuletzt');
  Fz(g).abenteuerAngebote.length = 0;
  const f2 = beenden(g, 'Zweites Geleit', false);
  ok(!!(Brett.snapshot(g) || {}).zuletzt && Brett.snapshot(g).zuletzt.titel === 'Zweites Geleit', 'ein spaeter endender Faden: zuletzt ist der juengste');
  const f3 = annehmen(g, plan([{ typ: 'geleit' }, { typ: 'abschluss' }], 'Drittes Geleit'));
  ok(!!f3 && Brett.zuletztVon(Fz(g)) === null && !(Brett.snapshot(g) || {}).zuletzt, 'ein neuer Faden (angenommen) nimmt den alten Eintrag weg');
  ok(!!f1 && !!f2 && g.errors === 0 && fehler.length === 0, 'keine Fehler');
}
{   // zwei Faeden enden, genau einer steht
  const { g } = live(7);
  beenden(g, 'Alt', false); Fz(g).abenteuerAngebote.length = 0;
  beenden(g, 'Neu', false);
  ok(Brett.snapshot(g).zuletzt.titel === 'Neu' && !Array.isArray(Brett.snapshot(g).zuletzt), 'genau ein Eintrag, der juengste');
}

console.log('\nD: Client: Pseudo-Eintrag im Reiter Aufträge (Tab Aktive Missionen)');
{
  const gezeichnet = [], knoepfe = [], befehle = [];
  const win = {
    Render: { PAL: { brass: '#a', panelLight: '#b', mint: '#c', amber: '#d', red: '#e', star: '#f' }, text: (c, t) => gezeichnet.push(String(t)), button: (c, x, y, w, h, t) => knoepfe.push(t), wrap: (t) => [String(t)], measure: (t) => String(t).length * 5 },
    Brett: { store: { abenteuer: { zuletzt: { titel: 'Geleit nach Rom', ausgang: 'gescheitert', text: 'Von Flavia hört ihr nichts mehr.', w: [{ f: 'rom', art: 'ruf', d: -2 }, { f: 'rom', art: 'haltung', d: -1 }] } } } },
    Shared_Sektoren: { hexName: (h) => h }, performance: { now: () => 1000 },
  };
  win.window = win;
  vm.runInNewContext(fs.readFileSync('public/js/notrufe.js', 'utf8'), win);
  const V = win.NotrufView, cmd = (c) => befehle.push(c);
  const view = { state: { nr: [] } };
  const p = V.pseudoEintraege();
  ok(p.length === 1 && p[0].pseudo === true && p[0].ausgang === 'gescheitert' && V.aktiveListe(view).length === 1 && V.notrufListe(view).length === 0 && V.liste(view.state).length === 0, 'ohne Notrufe: genau ein Pseudo-Eintrag (pseudo: true) im Tab Aktive Missionen, keiner bei den Notrufen');
  V.drawCaptain({ fillRect() {} }, view, { x: 0, y: 0, w: 400, h: 200 }, cmd);
  const bild = gezeichnet.join('|');
  ok(/GESCHEITERT/.test(bild) && /Geleit nach Rom/.test(bild) && /hört ihr nichts mehr/.test(bild) && /Wirkung: Ruf Rom -2 · Haltung -1/.test(bild), `Eintrag, Abschlusstext und Wirkung werden gezeichnet (${bild.slice(0, 160)})`);
  ok(!knoepfe.some((t) => /Hinfliegen|Ignorieren/.test(t)) && befehle.length === 0, 'keine Knoepfe Hinfliegen/Ignorieren, kein Befehl an den Server beim Zeichnen');
  for (const code of ['Enter', 'NumpadEnter', 'KeyX', 'KeyQ', 'KeyE', 'KeyR', 'KeyF']) ok(V.key(code, view, cmd) === false, `Taste ${code}: nicht verbraucht (Pseudo-Eintrag nicht annehmbar/verfolgbar)`);
  ok(V.key('KeyW', view, cmd) === true && V.key('ArrowDown', view, cmd) === true && befehle.length === 0, 'W/S wechselt die Wahl, ohne Fokus-Befehl an den Server');
  // mit einem echten Notruf davor: Enter gilt dem Notruf, auf dem Pseudo-Eintrag nicht
  const view2 = { state: { nr: [{ i: 7, h: '0305', k: 'k', z: 0, r: 100, f: { b: 'Hilfe', n: 'X', q: [], a: [] } }] } };
  befehle.length = 0;
  V.setzeTab('aktiv');   // Wahl auf den Pseudo-Eintrag (Tab Aktive Missionen)
  const n1 = befehle.length;
  ok(V.key('Enter', view2, cmd) === false && befehle.length === n1, 'auf dem Pseudo-Eintrag schickt Enter nichts');
  V.setzeTab('notruf');   // der echte Notruf steht im Tab Notrufe
  ok(V.notrufListe(view2).length === 1 && V.aktiveListe(view2).length === 1, 'mit Notruf davor: er steht im Tab Notrufe, der Pseudo-Eintrag im Tab Aktive Missionen');
  ok(V.key('Enter', view2, cmd) === true && befehle[befehle.length - 1] === 'captain.notruf.hinfliegen', 'auf dem echten Notruf gilt Enter weiter (hinfliegen)');
  win.Brett.store.abenteuer = null;
  ok(V.pseudoEintraege().length === 0 && V.aktiveListe({ state: { nr: [] } }).length === 0, 'ohne Block kein Pseudo-Eintrag');
}

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
