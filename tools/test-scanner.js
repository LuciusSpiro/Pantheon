'use strict';
// SCA-01 P1: Scanner am Boden (server/sim/scanner.js). Echtes Spiel (Game, Außenkarte kesh), Item `scanner` im Loadout-Slot, Start über slot.nutzen.
// Geprüft: Start nur am Boden mit Scanner im wirksamen Slot, Ablehnungen, Treffer-Abbruch (Schild, Wunde, bewusstlos) ohne Ergebnis, übrige Abbrüche ohne Ergebnis, Qualität 0..3 beim Vollenden,
// Abklingzeit nur nach Erfolg, zwei Spieler unabhängig, Snapshot (action, sc nur beim Scannenden, Zuwachs), Ops-Entschlüsseln unverändert (Rechnung geteilt), Tick ohne Scan.
// NS: Ablehnungen kommen als Meldung beim Spieler an (Notice im Befehlsweg), kein Start bei Lanzenladung/Ausholen und im Gespräch (beginnendes Gespräch bricht ab), Töne mit Zone und Ort,
// Treffer über trefferGemeldet (Explosion/Strahl) brechen ab.
//   node tools/test-scanner.js   (npm run test:scanner)
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const Loadout = require('../server/sim/loadout.js');
const combat = require('../server/sim/combat.js');
const Scanner = require('../server/sim/scanner.js');
const Abst = require('../server/sim/abstimmung.js');
const Gespraech = require('../server/sim/gespraech.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const DT = 1 / CONFIG.tickHz;
const SC = CONFIG.scanner;

// Szene: Spieler am Boden auf kesh, alle mit denselben Slots (Slot 1 = Scanner), Gegner weg, unverwundbar
function szene(slots, opts) {
  const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const anzahl = (opts && opts.spieler) || 1;
  const cs = Array.from({ length: anzahl }, () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } }));
  for (const [i, cc] of cs.entries()) { g.addConnection(cc); g.handleMessage(cc, { t: 'hello', clientId: 'S' + i, name: 'Scan' + i, color: i }); }
  for (const cc of cs) g.handleMessage(cc, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  for (const p of g.players) for (let i = 0; i < slots.length; i++) Loadout.slotSetzen(g, p, i, slots[i]);
  g.setAwayMap('kesh');
  g.aways.kesh.active = true;
  for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
  g.god = true;
  const notes = [];
  const note0 = g.notice.bind(g);
  g.notice = (p, text) => { notes.push({ pid: p.id, text }); return note0(p, text); };
  const ergebnisse = [];
  const weg = Scanner.beiErgebnis((game, p, stufe, ort) => ergebnisse.push({ pid: p.id, stufe, ort }));
  const S = { g, cs, ps: g.players, p: g.players[0], c: cs[0], ergebnisse, weg, notes };
  S.lauf = (sek, vor) => { for (let k = 0; k < Math.round(sek / DT); k++) { g.away.drones.length = 0; if (vor) vor(); g.step(); } };
  S.nutze = (slot, i) => g.handleMessage(cs[i || 0], { t: 'cmd', c: Protocol.CMD_SLOT_NUTZEN, slot });
  S.cmd = (c, extra, i) => g.handleMessage(cs[i || 0], Object.assign({ t: 'cmd', c }, extra || {}));
  // Frequenz auf Signalstärke s legen (das Zielband driftet mit; Abstand zum Band so, dass s gilt)
  S.halteSignal = (p, s) => () => { if (!p.scan) return; const off = (1 - s) * SC.weitBand; p.scan.f = p.scan.ziel > 0.5 ? p.scan.ziel - off : p.scan.ziel + off; };
  S.scanLaeuft = (p) => { p = p || S.p; return !!p.scan && !!p.hold && p.hold.kind === 'scan'; };
  S.letzte = () => (notes.length ? notes[notes.length - 1] : null);
  S.sfx = (i) => cs[i || 0].inbox.filter((m) => m.t === 'event' && m.kind === 'sfx');
  S.noticesBeim = (i) => cs[i || 0].inbox.filter((m) => m.t === 'event' && m.kind === 'notice').map((m) => m.text);
  S.sauber = (p) => { p = p || S.p; return !p.scan && !(p.hold && p.hold.kind === 'scan'); };
  return S;
}
const MIT = ['blaster', 'scanner'];
const treffer = (S, p) => combat.hitPlayer(S.g, p, 1, { kind: 'raider' });

section('Konfiguration, Protokoll, Registry');
ok(SC && SC.dauer === 6 && SC.minLauf === 1.5 && SC.abklingzeit === 8 && SC.reichweite === 384 && SC.qSchwellen.join() === '0.3,0.55,0.85', 'Config scanner: dauer 6, minLauf 1,5, abklingzeit 8, reichweite 384, Schwellen 0,3/0,55/0,85');
ok(Protocol.CMD_SCAN_STIMME === 'scan.stimme' && Protocol.CMD_SCAN_ABBRUCH === 'scan.abbruch', 'Protokoll: scan.stimme, scan.abbruch');
ok(Loadout.istErlaubt('scanner') && Loadout.erlaubteIds().includes('scanner'), 'Registry: scanner ist in einen Slot erlaubt');
{
  const S = szene(['blaster', null]);
  ok(Loadout.slotSetzen(S.g, S.p, 1, 'scanner') === null && Loadout.wirksam(S.g, S.p)[1] === 'scanner', 'Slotwahl akzeptiert scanner');
}

section('(1) Start nur am Boden mit Scanner im wirksamen Slot');
{
  const S = szene(MIT);
  const { p } = S;
  S.nutze(1);
  ok(S.scanLaeuft(), 'mit Scanner im Slot: Scan läuft (p.scan und Hold kind scan)');
  ok(p.hold.dur === Infinity && p.scan.t === 0 && p.scan.halt === 0, 'Start bei Fortschritt 0');
  S.cmd('scan.stimme', { dir: 1 });
  ok(p.scan.dir === 1, 'scan.stimme setzt die Richtung');
  S.cmd('scan.stimme', { dir: 0 });
  ok(p.scan.dir === 0, 'scan.stimme 0 hält an');
}
{
  const S = szene(['blaster', 'sturmgewehr']);
  S.nutze(1); S.nutze(0);
  ok(S.sauber(), 'ohne Scanner im Slot: kein Scan');
  S.cmd('scan.stimme', { dir: 1 });
  ok(S.sauber(), 'scan.stimme ohne Scan ohne Wirkung');
}
{
  const S = szene(['blaster', null]);
  S.nutze(1);
  ok(S.sauber(), 'leerer Slot: kein Scan');
}
{
  // Scanner im dritten Slot, der ab 3 Spielern nicht wirksam ist: kein Scan
  const S = szene(['blaster', 'sturmgewehr'], { spieler: 3 });
  for (const e of Object.values(S.g.crewLoadout)) e[2] = 'scanner';   // gespeichert, aber ab 3 Spielern nicht wirksam (slotSetzen lehnt Slot 3 ab)
  ok(Loadout.loadoutFuer(S.g, S.p)[2] === 'scanner' && Loadout.wirksam(S.g, S.p).length === 2 && !Loadout.wirksam(S.g, S.p).includes('scanner'), 'Vorbedingung: Scanner liegt im nicht wirksamen Slot');
  S.nutze(2);
  ok(S.sauber(), 'Scanner im nicht wirksamen dritten Slot: kein Scan');
}
{
  const S = szene(MIT);
  const { g, p } = S;
  p.zone = 'ship';
  ok(typeof Loadout.slotNutzen(g, p, 1) === 'string' && S.sauber(), 'am Schiff: abgelehnt');
  p.zone = 'away';
  for (const [name, setze, loese] of [
    ['gefangen', () => { p.gefangen = true; }, () => { p.gefangen = false; }],
    ['bewusstlos', () => { p.bewusstlos = true; }, () => { p.bewusstlos = false; }],
    ['downed (Wunde)', () => { p.downed = true; }, () => { p.downed = false; }],
    ['an der Konsole', () => { p.console = 'ops'; }, () => { p.console = null; }],
    ['beamLock', () => { p.beamLock = true; }, () => { p.beamLock = false; }],
    ['betäubt', () => { p.betaeubtBis = g.time + 5; }, () => { p.betaeubtBis = 0; }],
  ]) {
    setze();
    ok(typeof Loadout.slotNutzen(g, p, 1) === 'string' && S.sauber(), name + ': abgelehnt');
    loese();
  }
  ok(Loadout.slotNutzen(g, p, 1) === null && S.scanLaeuft(), 'nach dem Lösen aller Sperren startet der Scan');
}
{
  const S = szene(MIT);
  Scanner.scanStarten(S.g, S.p);
  ok(S.scanLaeuft(), 'Handler direkt: Scan läuft');
  ok(Scanner.scanStarten(S.g, S.p) === null && S.sauber(), 'Handler direkt: zweiter Aufruf = Abbruch');
  S.p.hold = { kind: 'revive', t: 0, dur: 1 };
  ok(typeof Scanner.scanStarten(S.g, S.p) === 'string' && !S.p.scan, 'bei anderem Hold: abgelehnt');
}

section('(2) Treffer bricht ab: Fortschritt weg, kein Ergebnis, Zustand und Hold aufgeräumt');
for (const [name, aktion] of [
  ['Schild getroffen', (S, p) => { S.g.god = false; ok(treffer(S, p) === 'shield', 'Treffer wird vom Schild aufgenommen'); }],
  ['Wunde (verwundet)', (S, p) => { S.g.god = false; p.zustand = 'verwundet'; combat.folgenAbgleich(S.g); }],
  ['bewusstlos', (S, p) => { S.g.god = false; p.zustand = 'bewusstlos'; combat.folgenAbgleich(S.g); }],
  ['gefesselt', (S, p) => { S.g.god = false; p.zustand = 'gefesselt'; combat.folgenAbgleich(S.g); }],
]) {
  const S = szene(MIT);
  const { p } = S;
  S.nutze(1);
  S.lauf(2, S.halteSignal(p, 1));
  ok(p.scan && p.scan.halt > 0.2, name + ': Fortschritt aufgebaut (' + (p.scan ? p.scan.halt.toFixed(2) : '-') + ')');
  aktion(S, p);
  ok(S.sauber(), name + ': p.scan und Hold aufgeräumt');
  S.g.god = true;
  S.lauf(0.5);
  ok(S.sauber() && S.ergebnisse.length === 0, name + ': nach weiterem Lauf kein Ergebnis');
  ok(!(p.scanBis > 0), name + ': keine Abklingzeit (kein Erfolg)');
}
{
  const S = szene(MIT); const { p } = S;
  S.nutze(1); S.lauf(2, S.halteSignal(p, 1));
  S.g.god = false; treffer(S, p); S.g.god = true; S.g.away.drones.length = 0;
  S.nutze(1);
  ok(S.scanLaeuft() && p.scan.halt === 0 && p.scan.t === 0, 'zweiter Versuch nach Treffer beginnt bei Fortschritt 0');
}
{
  const S = szene(MIT, { spieler: 2 }); const [a, b] = S.ps;
  S.nutze(1, 0); S.lauf(1, S.halteSignal(a, 1));
  S.g.god = false; treffer(S, b); S.g.god = true;
  ok(S.scanLaeuft(a), 'Treffer auf einen anderen Spieler: Scan läuft weiter');
}

section('(3) Weitere Abbrüche ohne Ergebnis');
{
  const faelle = [
    ['Bewegung (Eingabe)', (S, p) => { p.input.mx = 1; S.lauf(DT * 3); p.input.mx = 0; }],
    ['Konsole', (S, p) => { p.console = 'ops'; S.lauf(DT * 2); p.console = null; }],
    ['scan.abbruch', (S) => { S.cmd('scan.abbruch'); }],
    ['zweite Betätigung der Slot-Taste', (S) => { S.nutze(1); }],
    ['Trennung', (S) => { S.g.removeConnection(S.c); }],
    ['Verlassen der Karte', (S, p) => { p.zone = 'ship'; S.lauf(DT * 2); }],
    ['Niederstrecken (downed)', (S, p) => { p.downed = true; S.lauf(DT * 2); }],
    ['Hold von außen genullt (Wunde setzt p.hold = null)', (S, p) => { p.hold = null; S.lauf(DT * 2); }],
  ];
  for (const [name, aktion] of faelle) {
    const S = szene(MIT); const { p } = S;
    S.nutze(1); S.lauf(2, S.halteSignal(p, 1));
    ok(p.scan && p.scan.halt > 0.2, name + ': Scan mit Fortschritt');
    aktion(S, p);
    S.lauf(0.3);
    ok(S.sauber(), name + ': Zustand und Hold aufgeräumt');
    ok(S.ergebnisse.length === 0 && !(p.scanBis > 0), name + ': kein Ergebnis, keine Abklingzeit');
  }
  const S = szene(MIT);
  S.nutze(1); S.lauf(1, S.halteSignal(S.p, 1));
  S.g.handleMessage(S.c, { t: 'act', down: false });
  ok(S.scanLaeuft(), 'ein verirrtes E loslassen bricht den Scan nicht ab (wie das Minispiel)');
}

section('(4) Vollendung liefert Qualität 0..3 gemäß Verlauf');
for (const [s, soll] of [[1, 3], [0.7, 2], [0.42, 1], [0.2, 0]]) {
  const S = szene(MIT); const { p } = S;
  S.nutze(1);
  S.lauf(SC.dauer / s + 1, S.halteSignal(p, s));
  ok(S.ergebnisse.length === 1 && S.ergebnisse[0].stufe === soll, 'Signalstärke ' + s + ' -> scanStufe ' + soll + (S.ergebnisse[0] ? ' (war ' + S.ergebnisse[0].stufe + ')' : ' (kein Ergebnis)'));
  ok(S.sauber(), 'Signalstärke ' + s + ': nach dem Vollenden Zustand und Hold aufgeräumt');
  if (s === 1) ok(S.ergebnisse[0] && S.ergebnisse[0].pid === p.id && Number.isFinite(S.ergebnisse[0].ort.x), 'Ergebnis nennt Spieler und Ort');
}
{
  const S = szene(MIT); const { p } = S;
  S.nutze(1); S.lauf(SC.dauer + 1);   // ohne Steuerung: Startfrequenz weit vom Band
  ok(S.ergebnisse.length === 0 && S.scanLaeuft(), 'ohne Abstimmung kein Ergebnis in dauer + 1 s');
  S.cmd('scan.stimme', { dir: p.scan.ziel > p.scan.f ? 1 : -1 });
  let k = 0; while (p.scan && Math.abs(p.scan.f - p.scan.ziel) > 0.05 && k++ < 600) S.lauf(DT);
  S.cmd('scan.stimme', { dir: 0 });
  ok(p.scan && Math.abs(p.scan.f - p.scan.ziel) <= 0.06, 'scan.stimme (gehalten) bewegt die Frequenz zum Zielband');
}
{
  const lauf = () => { const S = szene(MIT); S.nutze(1); S.lauf(SC.dauer / 0.7 + 1, S.halteSignal(S.p, 0.7)); return S.ergebnisse.map((e) => e.stufe).join(); };
  ok(lauf() === lauf() && lauf() === '2', 'deterministisch über Seed');
}

section('(5) Abklingzeit nach Erfolg, zwei Spieler unabhängig');
{
  const S = szene(MIT); const { p, g } = S;
  S.nutze(1); S.lauf(SC.dauer + 1, S.halteSignal(p, 1));
  ok(S.ergebnisse.length === 1 && p.scanBis > g.time, 'Erfolg: Abklingzeit läuft');
  const t0 = g.time;
  S.nutze(1);
  ok(S.sauber(), 'während der Abklingzeit: abgelehnt');
  const r = Loadout.slotNutzen(g, p, 1);
  ok(typeof r === 'string' && /lädt/.test(r), 'Ablehnung mit Text');
  S.lauf(SC.abklingzeit - 1.5);
  S.nutze(1);
  ok(S.sauber(), 'kurz vor Ablauf weiter abgelehnt');
  S.lauf(2);
  S.nutze(1);
  ok(S.scanLaeuft() && g.time - t0 >= SC.abklingzeit, 'nach der Abklingzeit startet ein neuer Scan');
}
{
  const S = szene(MIT, { spieler: 2 }); const [a, b] = S.ps;
  S.nutze(1, 0); S.nutze(1, 1);
  ok(S.scanLaeuft(a) && S.scanLaeuft(b) && a.scan !== b.scan, 'zwei Spieler: beide scannen, getrennter Zustand');
  const ha = S.halteSignal(a, 1), hb = S.halteSignal(b, 0.7);
  S.lauf(2, () => { ha(); hb(); });
  ok(a.scan.halt > b.scan.halt, 'Fortschritt je Spieler eigen');
  S.cmd('scan.stimme', { dir: 1 }, 1);
  ok(b.scan.dir === 1 && a.scan.dir === 0, 'scan.stimme wirkt nur auf den Absender');
  S.cmd('scan.abbruch', {}, 1);
  ok(S.sauber(b) && S.scanLaeuft(a), 'Abbruch des einen lässt den anderen weiterlaufen');
  S.lauf(SC.dauer, ha);
  ok(S.ergebnisse.length === 1 && S.ergebnisse[0].pid === a.id && S.ergebnisse[0].stufe === 3, 'nur der erste Scan liefert ein Ergebnis');
}

section('(6) Snapshot und Tick');
{
  const S = szene(MIT, { spieler: 2 }); const [a, b] = S.ps; const { g } = S;
  const snapP = () => g.snapshot().players;
  ok(snapP().every((q) => q.sc === undefined && q.action == null), 'ohne Scan: weder sc noch action');
  S.nutze(1, 0); S.lauf(1.5, S.halteSignal(a, 1));
  const q = snapP().find((x) => x.id === a.id), q2 = snapP().find((x) => x.id === b.id);
  ok(q.action && q.action.kind === 'scan' && q.action.progress > 0 && q.action.progress <= 1, 'action { kind scan, progress }');
  ok(q.sc && ['f', 's', 'h', 'q'].every((k) => typeof q.sc[k] === 'number') && Object.keys(q.sc).length === 4 && q.sc.q >= 0 && q.sc.q <= 3, 'sc { f, s, h, q } beim Scannenden');
  ok(q2.sc === undefined && q2.action == null, 'beim anderen Spieler weder sc noch action');
  const zuwachs = JSON.stringify({ action: q.action, sc: q.sc }).length;
  console.log('       Zuwachs je laufendem Scan: ' + zuwachs + ' B (action + sc, JSON)');
  ok(zuwachs < 120, 'Zuwachs klein (< 120 B)');
  S.cmd('scan.abbruch');
  ok(snapP().every((x) => x.sc === undefined && x.action == null), 'nach dem Ende wieder kein Feld');
}
{
  // Tick ohne Scan: früher Rücksprung (ein Zugriff auf die Spielerliste, keine Schleife, kein rng)
  const S = szene(MIT);
  const rng0 = S.g.rng; let rngAufrufe = 0;
  S.g.rng = () => { rngAufrufe++; return rng0.call(S.g); };
  Scanner.update(S.g, DT);
  ok(rngAufrufe === 0, 'update ohne Scan: kein rng-Aufruf');
  S.g.rng = rng0;
}

section('(6b) Ablehnungen melden sich beim Spieler (Befehlsweg slot.nutzen, Rückgabewert wird dort verworfen)');
{
  const S = szene(MIT); const { g, p } = S;
  S.nutze(1); S.lauf(SC.dauer + 1, S.halteSignal(p, 1));
  ok(S.ergebnisse.length === 1, 'Vorbedingung: ein Scan ist vollendet, Abklingzeit läuft');
  S.cs[0].inbox.length = 0;
  S.nutze(1);
  const n1 = S.noticesBeim();
  ok(n1.length === 1 && /^Der Scanner lädt noch \(\d+ s\)\.$/.test(n1[0]), 'Abklingzeit: Meldung "Der Scanner lädt noch (n s)." erreicht den Spieler (war: ' + n1.join('|') + ')');
  ok(S.letzte() && S.letzte().pid === p.id, 'Meldung geht an den Absender');
  S.lauf(SC.abklingzeit + 0.5); S.cs[0].inbox.length = 0;
  p.hold = { kind: 'revive', t: 0, dur: 1 };
  S.nutze(1);
  ok(S.noticesBeim().join('|') === 'Du bist gerade beschäftigt.' && !p.scan, 'anderer Hold: Meldung "Du bist gerade beschäftigt." beim Spieler');
  p.hold = null;
  S.nutze(1);
  ok(S.scanLaeuft() && S.noticesBeim().length === 1, 'kein Fehlertext beim erfolgreichen Start (nur die Meldung von vorhin)');
  S.cs[0].inbox.length = 0;
  S.nutze(1);
  ok(S.noticesBeim().join('|') === 'Scan abgebrochen.', 'zweite Betätigung: Meldung "Scan abgebrochen."');
}

section('(6c) Kein Start bei Lanzenladung oder Ausholen; Gespräch');
{
  // echter Weg: Lanze in Slot 1 laden, dann den Scanner in Slot 2 betätigen
  const S = szene(['lanze', 'scanner']); const { g, p } = S;
  S.lauf(0.7);
  ok(combat.shoot(g, p, 0) === null && !!p.ladung, 'Lanze lädt (echter Schusspfad)');
  S.cs[0].inbox.length = 0;
  S.nutze(1);
  ok(S.sauber() && !!p.ladung, 'Scanner startet nicht, solange die Lanze lädt (Auto-Schuss liefe sonst an combat.shoot vorbei)');
  ok(/Angriff/.test(S.noticesBeim().join('|')), 'Ablehnung mit Meldung: ' + S.noticesBeim().join('|'));
  S.lauf(3);
  ok(!p.ladung && S.sauber() && S.ergebnisse.length === 0, 'Lanze hat geendet, kein Scan nebenher');
  S.nutze(1);
  ok(S.scanLaeuft(), 'nach dem Ende der Ladung startet der Scan');
  ok(Loadout.slotNutzen(g, p, 1) === null && S.sauber(), 'Handler: zweite Betätigung bricht ab');
}
{
  const S = szene(MIT); const { p } = S;
  p.ausholen = { t: 0, dauer: 0.5, winkel: 0 };
  S.cs[0].inbox.length = 0;
  S.nutze(1);
  ok(S.sauber() && /Angriff/.test(S.noticesBeim().join('|')), 'Ausholen: kein Scan, Meldung');
  p.ausholen = null;
  p.ladung = { t: 0, bereit: false, x: p.x, y: p.y, tx: p.x, ty: p.y };
  S.nutze(1);
  ok(S.sauber(), 'Ladung (direkt gesetzt): kein Scan');
}
{
  const S = szene(MIT); const { g, p } = S;
  g.gespraech = { id: 'wirt_plausch', nid: 'x', map: g.away.map, pid: p.id, z: 0, phase: 'zeilen', antwort: null, wahl: null, t0: g.time, last: g.time };
  S.cs[0].inbox.length = 0;
  S.nutze(1);
  ok(S.sauber() && /Gespräch/.test(S.noticesBeim().join('|')), 'im eigenen Gespräch: kein Scan, Meldung ' + S.noticesBeim().join('|'));
  g.gespraech = { id: 'wirt_plausch', nid: 'x', map: g.away.map, pid: 9999, z: 0, phase: 'zeilen', antwort: null, wahl: null, t0: g.time, last: g.time };
  S.nutze(1);
  ok(S.scanLaeuft(), 'Gespräch eines anderen Spielers hindert den Scan nicht');
  g.gespraech = null;
}
{
  // beginnendes Gespräch bricht den Scan ab (echter Weg: gespraech.beginne wie bei E am NSC)
  const S = szene(MIT); const { g, p } = S;
  S.nutze(1); S.lauf(1.5, S.halteSignal(p, 1));
  ok(p.scan && p.scan.halt > 0.1, 'Scan mit Fortschritt');
  const r = Gespraech.beginne(g, p, { gespraech: 'wirt_plausch', person: 'wirt', x: p.x, y: p.y });
  ok(r === null && !!g.gespraech, 'Gespräch beginnt');
  ok(S.sauber(), 'Gespräch beginnt: Scan und Hold weg');
  S.lauf(SC.dauer + 1);
  ok(S.ergebnisse.length === 0 && !(p.scanBis > 0), 'kein Ergebnis, keine Abklingzeit');
  g.gespraech = null;
}

section('(6d) Töne mit Zone und Ort');
{
  const S = szene(MIT); const { p } = S;
  S.cs[0].inbox.length = 0;
  S.nutze(1);
  const a = S.sfx().find((e) => e.name === 'ui_click');
  ok(a && a.zone === 'away' && a.x === Math.round(p.x) && a.y === Math.round(p.y), 'Start: ui_click mit zone away und Ort des Scannenden');
  S.lauf(SC.dauer + 1, S.halteSignal(p, 1));
  const b = S.sfx().find((e) => e.name === 'scan_done');
  ok(S.ergebnisse.length === 1 && b && b.zone === 'away' && b.x === Math.round(p.x) && b.y === Math.round(p.y), 'Vollendung: scan_done mit zone away und Ort');
}

section('(2b) Treffer über trefferGemeldet (Explosion, Strahl, Schlag) brechen ab');
{
  // waffen.js verteilt diese Treffer selbst und meldet sie über game.waffenWelt.getroffen -> combat.trefferGemeldet -> ankerTreffer
  const S = szene(MIT); const { g, p } = S;
  S.nutze(1); S.lauf(2, S.halteSignal(p, 1));
  ok(p.scan && p.scan.halt > 0.2, 'Scan mit Fortschritt');
  const welt = g.waffenWelt;
  ok(welt && typeof welt.getroffen === 'function', 'Vorbedingung: Welt-Adapter vorhanden');
  welt.getroffen(p, 'treffer', { waffe: 'granatwerfer', flaeche: true }, { team: 'feind', x: p.x + 40, y: p.y });
  ok(S.sauber(), 'Explosion/Strahl-Treffer auf den Scannenden: Scan und Hold weg');
  S.lauf(0.5);
  ok(S.ergebnisse.length === 0 && !(p.scanBis > 0), 'kein Ergebnis, keine Abklingzeit');
}
{
  const S = szene(MIT); const { g, p } = S;
  S.nutze(1); S.lauf(1.5, S.halteSignal(p, 1));
  g.waffenWelt.getroffen(p, 'abgelenkt', {}, {});
  ok(S.scanLaeuft(), 'abgelenkter Treffer (kein Treffer): Scan läuft weiter');
}

section('(7) Ops-Entschlüsseln unverändert (geteilte Rechnung)');
{
  // Ops-Pfad gegen die ausgeschriebene alte Formel: gleiche rng-Folge, gleiche Zustände Tick für Tick
  const Entschl = require('../server/sim/entschluesseln.js');
  const Station = require('../server/sim/station.js');
  const neu = () => {
    const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send() {}, sendRaw() {} };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'E0', name: 'Ops', color: 0 });
    g.handleMessage(c, { t: 'ready', ready: true }); for (let k = 0; k < 6; k++) g.step();
    return g;
  };
  for (const ort of [null, 'nebel']) {
  const g = neu(), gr = neu();
  const E = g.C.entschl;
  if (ort) g.ship.scene = ort;
  const fk = ort ? E.driftNebel : 1;
  const lbl = ort ? ' (Nebel, Drift x' + fk + ')' : '';
  const p = g.players[0];
  p.station = 'weapons'; p.console = 'weapons';
  ok(Station.stationOf(p) === 'weapons', 'Ops an der Konsole' + lbl);
  Entschl.starten(g, Entschl.testSignal('t1'));
  ok(Entschl.anlauf(g, p) === null && g.entschl.z === 1, 'anlauf startet die Abstimmung' + lbl);
  const rn = () => gr.rng();
  const e = g.entschl;
  const ref = { ziel: E.zielMin + rn() * (E.zielMax - E.zielMin), zv: 0, zt: 0, halt: 0, t: 0, dir: 1, s: 0 };
  ref.f = ref.ziel < 0.5 ? E.startF + 0.2 : E.startF - 0.2;
  ok(e.ziel === ref.ziel && e.f === ref.f, 'Anlaufstellung bitgleich zur alten Formel' + lbl);
  e.dir = 1;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let gleich = true, ticks = 0;
  for (; ticks < 240 && g.entschl && g.entschl.z === 1; ticks++) {
    Entschl.update(g, DT);
    ref.t += DT; ref.f = clamp(ref.f + ref.dir * E.rate * DT, 0, 1);
    ref.zt -= DT; if (ref.zt <= 0) { ref.zt = 2 + rn() * 2; ref.zv = (rn() * 2 - 1) * E.driftV; }
    ref.ziel += ref.zv * fk * DT;
    if (ref.ziel < E.zielMin) { ref.ziel = E.zielMin; ref.zv = Math.abs(ref.zv); }
    if (ref.ziel > E.zielMax) { ref.ziel = E.zielMax; ref.zv = -Math.abs(ref.zv); }
    ref.s = clamp(1 - Math.abs(ref.f - ref.ziel) / E.weitBand, 0, 1);
    ref.halt = Math.min(1, ref.halt + (DT / E.dauer) * ref.s);
    if (e.f !== ref.f || e.ziel !== ref.ziel || e.s !== ref.s || e.halt !== ref.halt || e.zv !== ref.zv || e.t !== ref.t) { gleich = false; break; }
  }
  ok(gleich && ticks === 240, 'Entschlüsseln: 240 Ticks bitgleich zur alten Formel (Frequenz, Zielband, Signal, Fortschritt, Zeit)' + lbl);
  ok(Entschl.snapshot(g).q === Abst.schaetzung(e, E), 'Snapshot en: q aus der geteilten Schätzung' + lbl);
  ok(g.rng() === gr.rng(), 'rng-Strom gleich weit (gleiche Zahl und Reihenfolge der Aufrufe)' + lbl);
  }
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'Alle ' + n + ' Prüfungen grün.'));
process.exit(fails ? 1 : 0);
