'use strict';
// SL10 (CONCEPT-SL10): Glyphen/Sternkarte-Minispiel, Vorläufer-Boje wecken (Adresse + freie Energie + Aktivierungsfeld), neue Kante (locked, Weltstand-fest),
// Prüfung „locked-Kante in/durch Leerraum“, Wettlauf der Piraten (Weg A), Bausteine.
//   node tools/test-boje.js
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const { Game } = require('../server/game.js');
const space = require('../server/sim/space.js');
const Welt = require('../server/sim/welt.js');
const Glyphen = require('../server/sim/glyphen.js');
const Boje = require('../server/sim/boje.js');
const ZonenSim = require('../server/sim/zonen.js');
const Sprung = require('../server/sim/sprung.js');
const Registry = require('../server/mission/registry.js');

const DT = 1 / CONFIG.tickHz;
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, body) {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
}

function spiel(np) {
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (np || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 3000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'Bo' + i, color: i });
    if (i === 0) g.handleMessage(c, { t: 'lobbyOpt', startMission: 'free' });
    cs.push(c);
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  Welt.waehle(g, 'sund');
  g.god = true;
  const mev = []; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { mev.push(Object.assign({ kind: k }, d)); return me0(k, d); };
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec / DT); k++) { if (each && each(k * DT) === true) return true; g.step(); } return false; };
  const T = { g, cs, run, mev, me: (k) => mev.filter((e) => e.kind === k) };
  T.cmd = (cmd, f, i) => { const c = cs[i || 0]; c.inbox.length = 0; g.handleMessage(c, Object.assign({ t: 'cmd', c: cmd }, f || {})); return c.inbox.filter((m) => m.kind === 'notice').map((m) => m.text); };
  return T;
}

section('Glyphen/Sternkarte: Captain sieht, Ops setzt', () => {
  const T = spiel(2); const g = T.g;
  try {
    g.players[0].console = 'weapons'; g.players[1].console = 'captain';
    ok(T.cmd('weapons.glyphen.waehle', { i: 0 }).length === 1, 'ohne Aufgabe: Fehlermeldung');
    ok(Glyphen.starten(g, { id: 'boje' }) === null && g.glyphen.z === 1 && g.glyphen.muster.length === 5, 'starten: Muster aus 5 von 9 Sternen');
    const sn = g.snapshot().gl;
    ok(sn && sn.z === 1 && sn.m.length === 9 && [...sn.m].filter((c) => c === '1').length === 5 && sn.w === '000000000', 'Snapshot gl: Muster m (Captain), Auswahl w leer');
    ok(T.cmd('weapons.glyphen.waehle', { i: 0 }, 1).length === 1 && g.glyphen.wahl[0] === false, 'nur die Ops bedient das Feld (Captain: abgelehnt)');
    const muster = g.glyphen.muster.slice();
    const falsch = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !muster.includes(i));
    // falsch: 4 richtige + 1 falscher Stern
    for (const i of muster.slice(0, 4).concat([falsch[0]])) T.cmd('weapons.glyphen.waehle', { i });
    T.cmd('weapons.glyphen.senden');
    const s1 = g.snapshot().gl;
    ok(s1.z === 1 && s1.t === 4 && s1.f === 1 && s1.v === 1, 'Rückmeldung nach dem Senden: 4 richtig, 1 falsch, Versuch 1');
    T.cmd('weapons.glyphen.waehle', { i: falsch[0] }); T.cmd('weapons.glyphen.waehle', { i: muster[4] });
    T.cmd('weapons.glyphen.senden');
    const s2 = g.snapshot().gl;
    ok(s2.z === 2 && s2.q === 2 && T.me('glyphenGeloest').length === 1, 'zweiter Versuch richtig: gelöst, Qualität 2, Ereignis glyphenGeloest');
    ok(Glyphen.ergebnis(g, 'boje') === 2 && Registry.get('glyphen_geloest').test({ game: g }, { id: 'boje', min: 2 }) && !Registry.get('glyphen_geloest').test({ game: g }, { id: 'boje', min: 3 }), 'Ergebnis und Prüfung glyphen_geloest (Qualität)');
    // sauber im ersten Versuch -> Qualität 3
    Glyphen.starten(g, { id: 'zwei' });
    for (const i of g.glyphen.muster) T.cmd('weapons.glyphen.waehle', { i });
    T.cmd('weapons.glyphen.senden');
    ok(Glyphen.ergebnis(g, 'zwei') === 3, 'erster Versuch richtig: Qualität 3');
  } finally { Welt.waehle(g, 'limes'); }
});

section('Prüfung: locked-Kante in/durch Leerraum', () => {
  const T = spiel(1); const g = T.g;
  const orig = JSON.parse(JSON.stringify(Sektoren.KARTE));
  try {
    // Variante A: Kante Fundort (Datenhex 0706) -> Vorläufer-Sektor (Datenhex 0806), wie in sund.json
    const id = Sektoren.kanteId('0706', '0806');
    ok(!!Sektoren.kante(id) && Sektoren.kante(id).art === 'locked', 'Sund: locked-Kante 0706-0806 vorhanden');
    ok(!g.explore.kanteOffen(id), 'vor dem Wecken gesperrt');
    ok(Sprung.oeffnen(g, { von: 'bojenfeld', nach: 'vorlaeufer', temp: false }) === null && g.explore.kanteOffen(id), 'sprung.oeffnen (dauerhaft): Kante offen');
    const save = g.explore.sektorenToSave();
    ok(save.offen.includes(id), 'Weltstand sektoren.offen enthält die Kante');
    const g2 = spiel(1).g;
    g2.explore.sektorenRestore(JSON.parse(JSON.stringify(save)), {});
    ok(g2.explore.kanteOffen(id), 'nach dem Laden: Kante weiter offen (Weltstand-fest)');
    // Variante B: locked-Kante zu einem LEERRAUM-Hex (0707 ist Leerraum): Karte mit Zusatzkante
    const karte = JSON.parse(JSON.stringify(orig));
    karte.kanten.push({ a: '0706', b: '0707', art: 'locked', key: 'test-leerraum' });
    Sektoren.setzeKarte(karte);
    ok(Sektoren.istLeerraum('0707') && Sektoren.spielbar('0707'), '0707 ist Leerraum und spielbar');
    const idL = Sektoren.kanteId('0706', '0707');
    ok(!g.explore.kanteOffen(idL), 'locked-Kante in den Leerraum: zunächst gesperrt');
    ok(Sprung.oeffnen(g, { von: '0706', nach: '0707', temp: false }) === null && g.explore.kanteOffen(idL), 'dauerhaft öffnen funktioniert auch zum Leerraum-Hex');
    // Sprungziel: von Fundort aus ist das Leerraum-Hex jetzt wählbar
    space.enterScene(g, 'bojenfeld', {});
    const err = Sprung.selectDest(g, 'leer-0707');
    ok(!err || /Sprung|Ziel|Kante/.test(String(err)) === false, 'Sprungziel leer-0707 wählbar (' + (err || 'ok') + ')');
    ok(!g.explore.tempKante(idL), 'es ist eine feste (kein temp) Kante');
  } finally { Sektoren.setzeKarte(orig); Welt.waehle(g, 'limes'); }
});

section('Boje wecken: Adresse, Energie, Feld, Kante', () => {
  const T = spiel(2); const g = T.g;
  try {
    space.enterScene(g, 'bojenfeld', {});
    const sc = Locations.get('bojenfeld').scene;
    ok(!!sc.bojeFeld && sc.zonen.length === 1 && sc.zonen[0].id === 'boje_feld', 'Szene Bojenfeld: Aktivierungsfeld (Zone) und Boje');
    const halten = () => { g.ship.x = sc.bojeFeld.x + 40; g.ship.y = sc.bojeFeld.y; g.ship.vx = 0; g.ship.vy = 0; };
    T.run(0.3);
    const z = () => ZonenSim.zaehler(g, 'boje');
    // volle Zuteilung: keine freie Energie
    ok(Boje.freieEnergie(g) === 0, 'Standardzuteilung: keine Reaktorpunkte frei');
    halten(); T.run(2, () => { halten(); return false; });
    ok(z() === 0, 'ohne Adresse und Energie: kein Fortschritt');
    // Adresse lösen
    g.players[0].console = 'weapons'; g.players[1].console = 'captain';
    Glyphen.starten(g, { id: 'boje' }); for (const i of g.glyphen.muster) T.cmd('weapons.glyphen.waehle', { i }); T.cmd('weapons.glyphen.senden');
    ok(Glyphen.ergebnis(g, 'boje') != null, 'Ops hat die Adresse gelöst');
    halten(); T.run(3, () => { halten(); return false; });
    ok(z() === 0, 'mit Adresse, aber ohne freie Energie: kein Fortschritt');
    // Technik: Module herunterfahren (Waffen 0, Lebenserhaltung 0 = Uhr O2) -> 4 Punkte frei
    g.ship.powerIntent = Object.assign(g.ship.powerIntent || {}, { weapons: 0, life: 0 }); Object.assign(g.ship.power, { weapons: 0, life: 0 });
    T.run(0.3);
    ok(Boje.freieEnergie(g) >= 4, 'Technik hat Waffen und Lebenserhaltung abgeschaltet: ' + Boje.freieEnergie(g) + ' Punkte frei');
    halten(); T.run(10, () => { halten(); return false; });
    const z10 = z();
    ok(z10 > 14 && z10 < 20, 'Fortschritt läuft (100 in 60 s): ' + z10.toFixed(1) + ' nach 10 s');
    const o2 = g.ship.o2;
    ok(o2 < CONFIG.o2.max, 'Lebenserhaltung aus: der O2-Vorrat sinkt (die Uhr), ' + Math.round(o2) + '/' + CONFIG.o2.max);
    // Feld verlassen: Fortschritt fällt langsam
    g.ship.x = 100; g.ship.y = 100; g.ship.vx = 0; g.ship.vy = 0; T.run(4, () => { g.ship.x = 100; g.ship.y = 100; return false; });
    ok(z() < z10 - 1 && z() > 0, 'Schiff außerhalb des Felds: Fortschritt fällt (' + z().toFixed(1) + ')');
    const sn = g.snapshot().bj;
    ok(sn && sn.f === 1 && sn.n === 4 && sn.z === Math.round(z() * 10) / 10, 'Snapshot bj: Adresse (f), nötige Energie (n), Zähler (z)');
    // fertig
    halten(); T.run(80, (t) => { halten(); return Boje.geweckt(g); });
    ok(Boje.geweckt(g) && T.me('bojeGeweckt').length === 1, 'Boje erwacht (Ereignis bojeGeweckt)');
    const id = Sektoren.kanteId('0706', '0806');
    ok(g.explore.kanteOffen(id) && !g.explore.tempKante(id), 'neue Kante: Fundort -> Vorläufer-Sektor ist offen (fest)');
    ok(g.explore.sektorenToSave().offen.includes(id), 'Weltstand: sektoren.offen enthält die neue Kante');
    ok(Registry.get('boje_geweckt').test({ game: g }, {}), 'Prüfung boje_geweckt');
    // Zähler und Zonen-Weltstand
    ok(ZonenSim.toSave(g) && ZonenSim.toSave(g).zaehler.boje >= 99, 'Zähler boje steht im Weltstand');
  } finally { Welt.waehle(g, 'limes'); }
});

section('Wettlauf (Weg A) und Bausteine', () => {
  const T = spiel(1); const g = T.g;
  try {
    space.enterScene(g, 'bojenfeld', {}); T.run(0.3);
    const sc = Locations.get('bojenfeld').scene;
    // ohne Wettlauf kommt nichts
    g.ship.x = sc.bojeFeld.x; g.ship.y = sc.bojeFeld.y;
    ZonenSim.zaehlerSetzen(g, 'boje', 20); T.run(3);
    ok(g.space.enemies.length === 0, 'Weg B: keine Piraten');
    Registry.get('boje_wettlauf').run({ game: g }, { wellen: 2 });
    T.run(2);
    ok(g.space.enemies.filter((e) => e.kind === 'raider').length === 2 && T.me('bojeWelle').length === 1, 'Weg A: erste Welle (2 Jäger) kommt, sobald das Aufleuchten läuft');
    T.run(32);
    ok(T.me('bojeWelle').length === 2, 'zweite Welle nach 30 s (höchstens wellen)');
    T.run(35);
    ok(T.me('bojeWelle').length === 2, 'keine dritte Welle bei wellen = 2');
    Registry.get('boje_zuruecksetzen').run({ game: g }, {});
    ok(ZonenSim.zaehler(g, 'boje') === 0 && !Boje.state(g).wettlauf, 'boje_zuruecksetzen: Zähler 0, Wettlauf aus');
    g.weltstand.data.fakten.lerche_weg = 'loesegeld';
    ok(Registry.get('welt_fakt_ist').test({ game: g }, { key: 'lerche_weg', value: 'loesegeld' }) && !Registry.get('welt_fakt_ist').test({ game: g }, { key: 'lerche_weg', value: 'soeldner' }), 'Prüfung welt_fakt_ist');
  } finally { Welt.waehle(g, 'limes'); }
});

function buchLauf(weg) {
  const fs = require('fs'), path = require('path');
  const T = spiel(2); const g = T.g;
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'regiebuecher-sund', 'k10_boje.regiebuch.json'), 'utf8'));
    const pr = require('../server/mission/checker.js').check(doc);
    ok(pr.ok, 'Weg ' + weg + ': Buch k10_boje besteht den Prüfer auf Sund ' + JSON.stringify(pr.errors.slice(0, 2)));
    g.weltstand.data.fakten.lerche_weg = weg === 'A' ? 'loesegeld' : 'soeldner';
    g.debugGoto('pulverhorn', false); T.run(0.5);
    doc.kopf.art = 'generiert';
    const m = g.mission; m.startCampaign({ tutorial: false });
    m.registerBook(doc, { origin: 'sl' }); m.startMission(doc.id); T.run(5);
    ok(m.step && m.step.id === 'anflug_boje' && g.explore.kanteOffen(Sektoren.kanteId('0605', '0706')), 'Weg ' + weg + ': Fundort-Kante enthüllt, Schritt anflug_boje');
    g.debugGoto('bojenfeld', false); T.run(2);
    ok(m.step && m.step.id === 'boje' && g.glyphen && g.glyphen.z === 1, 'Weg ' + weg + ': am Bojenfeld, Glyphen-Aufgabe läuft');
    const sc = Locations.get('bojenfeld').scene;
    const halten = () => { g.ship.x = sc.bojeFeld.x + 30; g.ship.y = sc.bojeFeld.y; g.ship.vx = 0; g.ship.vy = 0; };
    g.players[0].console = 'weapons'; g.players[1].console = 'captain';
    for (const i of g.glyphen.muster) T.cmd('weapons.glyphen.waehle', { i }); T.cmd('weapons.glyphen.senden');
    g.ship.powerIntent = Object.assign(g.ship.powerIntent || {}, { weapons: 0, life: 0 }); Object.assign(g.ship.power, { weapons: 0, life: 0 });
    halten(); T.run(100, () => { halten(); return Boje.geweckt(g); });
    ok(Boje.geweckt(g), 'Weg ' + weg + ': Boje erwacht');
    const raider = g.space.enemies.filter((e) => e.kind === 'raider').length;
    T.run(2);
    ok(weg === 'A' ? raider >= 2 && T.me('bojeWelle').length >= 1 : raider === 0 && T.me('bojeWelle').length === 0, 'Weg ' + weg + (weg === 'A' ? ': Wettlauf, Piraten-Wellen kamen' : ': in Ruhe, keine Piraten') + ' (' + raider + ' Jäger)');
    ok(m.step && m.step.id === 'sprung', 'Weg ' + weg + ': Schritt sprung (' + (m.step && m.step.id) + ')');
    g.debugGoto('vorlaeufer', false); T.run(2);
    const ms = m.missions[doc.id];
    ok(ms && ms.state === 'done' && ms.ausgang === 'erfolg' && g.weltstand.data.fakten.vorlaeufer_erreicht === 'ja', 'Weg ' + weg + ': Vorläufer-Sektor erreicht, Ausgang erfolg, Fakt vorlaeufer_erreicht');
    ok(m.state.flags && m.state.flags.vorlaeufer_erreicht === true, 'Weg ' + weg + ': Flag vorlaeufer_erreicht');
  } finally { Welt.waehle(g, 'limes'); }
}
section('Buch k10_boje: Weg A (Lösegeld, Wettlauf)', () => buchLauf('A'));
section('Buch k10_boje: Weg B (Söldner, in Ruhe)', () => buchLauf('B'));
section('Abspann: Entwurf der ende-Blöcke', () => {
  const d = require('../concept/sl/abspann.ende.json');
  let bad = 0; for (const b of d.abspann) { if (b.kopf.length > 60 || b.zeilen.length > 12) bad++; for (const z of b.zeilen) if ((z.text || z).length > 90) bad++; }
  ok(d.titel.length <= 60 && d.text.length <= 300 && d.abspann.length >= 1 && d.abspann.length <= 12 && bad === 0, 'ende-Block passt in das Kettenschema (Längen)');
  ok(d.abspann.filter((b) => b.wenn).length >= 3 && JSON.stringify(d).includes('lerche_weg') && JSON.stringify(d).includes('piraten_kennen_boje'), 'Abspann reagiert auf Weg A/B und die Piraten');
});

console.log('\n' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
