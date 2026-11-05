'use strict';
// SCA-01 P2: scanbare Objekte und Scan-Wirkung (server/sim/scanbar.js). Echtes Spiel (Game, Außenkarte kesh), Scan über slot.nutzen wie im Spiel, Testziele über Debug `scantest` (Art `test`).
// Geprüft: alle Ziele in Reichweite, keines außerhalb; Staffelung je Stufe (Standard-Tiefen und Art mit position 1); sk steigt nur; Snapshot away.sc (Format, nur nicht leer, Position nie vor der Positionsstufe);
// Reset mit der Karte, verschwundene Ziele, nichts im Weltstand; zwei Spieler vereinigen; Notice-Texte; Schießen und Waffenwechsel brechen den Scan ab; ohne Debug keine Testziele.
// NS: bewegtes Ziel (Position wird nachgeführt), Obergrenze maxEintraege (nächste zuerst, Meldung), gedrosselte Aufräumprüfung (0,5 s), keine tiefen.hinweis, strukturelle Snapshot-Prüfung.
//   node tools/test-scanbar.js   (npm run test:scanbar)
const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const Loadout = require('../server/sim/loadout.js');
const combat = require('../server/sim/combat.js');
const away = require('../server/sim/away.js');
const Scanbar = require('../server/sim/scanbar.js');
const Weltstand = require('../server/weltstand.js');
const Protocol = require('../shared/protocol.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const DT = 1 / CONFIG.tickHz;
const SC = CONFIG.scanner;
const R = SC.reichweite;
const AUFR = 0.5;   // s: Drossel der Aufräumprüfung in scanbar.update

function szene(opts) {
  const o = opts || {};
  const g = new Game({ noStore: true, seed: 11, debug: o.debug !== false, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const anzahl = o.spieler || 1;
  const cs = Array.from({ length: anzahl }, () => ({ inbox: [], send(x) { this.inbox.push(x); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } }));
  for (const [i, cc] of cs.entries()) { g.addConnection(cc); g.handleMessage(cc, { t: 'hello', clientId: 'B' + i, name: 'Bar' + i, color: i }); }
  for (const cc of cs) g.handleMessage(cc, { t: 'ready', ready: true });
  for (let k = 0; k < 6; k++) g.step();
  for (const p of g.players) { Loadout.slotSetzen(g, p, 0, 'blaster'); Loadout.slotSetzen(g, p, 1, 'scanner'); }
  g.setAwayMap('kesh');
  g.aways.kesh.active = true;
  for (const [j, p] of g.players.entries()) { interior.placeOnAwayPad(g, p, j); combat.onArrive(g, p); }
  g.god = true;
  const notes = [];
  const note0 = g.notice.bind(g);
  g.notice = (p, text) => { notes.push({ pid: p.id, text }); return note0(p, text); };
  const S = { g, cs, ps: g.players, p: g.players[0], notes };
  S.lauf = (sek, vor) => { for (let k = 0; k < Math.round(sek / DT); k++) { g.away.drones.length = 0; if (vor) vor(); g.step(); } };
  S.halteSignal = (p, s) => () => { if (!p.scan) return; const off = (1 - s) * SC.weitBand; p.scan.f = p.scan.ziel > 0.5 ? p.scan.ziel - off : p.scan.ziel + off; };
  S.debug = (cmd, i) => g.handleMessage(cs[i || 0], { t: 'debug', cmd });
  S.nutze = (slot, i) => g.handleMessage(cs[i || 0], { t: 'cmd', c: Protocol.CMD_SLOT_NUTZEN, slot });
  const SIG = { 0: 0.2, 1: 0.42, 2: 0.7, 3: 1 };   // Signalstärke -> scanStufe (Schwellen 0,3 / 0,55 / 0,85 des sauberen Zeitanteils)
  // ein vollständiger Scan der Stufe `stufe`; danach ist die Abklingzeit abgewartet, damit ein weiterer Scan sofort starten kann
  S.scanne = (stufe, i) => {
    const p = g.players[i || 0];
    S.nutze(1, i);
    S.lauf(SC.dauer / SIG[stufe] + 1, S.halteSignal(p, SIG[stufe]));
    const text = S.letzte();
    S.lauf(SC.abklingzeit + 0.5);
    S.text = text;
    return p;
  };
  S.sc = () => g.away.sc;
  S.snapSc = () => g.snapshot().away.sc;
  S.letzte = () => (notes.length ? notes[notes.length - 1].text : null);
  return S;
}
const tz = (S, id) => S.sc() && S.sc()['test:' + id];

section('Schnittstelle');
{
  const aus = Scanbar.scanbarAnmelden('probe', { ziele: () => [] });
  let wirft = false; try { Scanbar.scanbarAnmelden('probe', { ziele: () => [] }); } catch (e) { wirft = true; }
  ok(wirft, 'doppelte Art ist eine Ausnahme');
  aus();
  let frei = true; try { Scanbar.scanbarAnmelden('probe', { ziele: () => [] })(); } catch (e) { frei = false; }
  ok(frei, 'Abmelder gibt die Art wieder frei');
  let w2 = false; try { Scanbar.scanbarAnmelden('x', { ziele: () => [], tiefen: { position: 4 } }); } catch (e) { w2 = true; }
  ok(w2, 'Tiefen außerhalb 1..3 sind eine Ausnahme');
  let w3 = '', w4 = false;
  try { Scanbar.scanbarAnmelden('h', { ziele: () => [], tiefen: { hinweis: 1, position: 3 } }); } catch (e) { w3 = e.message; }
  ok(/hinweisAb/.test(w3), 'tiefen.hinweis gibt es am Server nicht (Hinweisstufe steht im Client-Content): Ausnahme mit Verweis auf hinweisAb');
  try { Scanbar.scanbarAnmelden('h2', { ziele: () => [], tiefen: { position: 2 } })(); } catch (e) { w4 = true; }
  ok(!w4, 'tiefen mit nur position ist gültig');
  ok(Protocol.DEBUG_CMDS.includes('scantest'), 'scantest ist ein Debug-Kommando');
}

section('(1) Alle Ziele in Reichweite, keines außerhalb');
{
  const S = szene(); const { p } = S;
  S.debug('scantest');
  ok(S.sc() === undefined, 'vor dem Scan: aw.sc leer');
  S.scanne(3);
  ok(tz(S, 'tz1') && tz(S, 'tz2') && tz(S, 'tz3'), 'zwei Erz-Testziele und das Monster-Testziel erfasst');
  ok(!tz(S, 'tz4'), 'Ziel außerhalb der Reichweite nicht erfasst');
  ok(tz(S, 'tz1').typ === 'testerz' && tz(S, 'tz2').typ === 'testerz' && tz(S, 'tz3').typ === 'testmonster' && tz(S, 'tz3').art === 'test', 'Art und Typ stehen am Eintrag');
  ok(Object.keys(S.sc()).length === 3, 'genau drei Einträge');
  ok(p.scanBis > 0, 'der Scan war vollendet');
}

{
  // gleiche Id in zwei Arten: beide Einträge bleiben getrennt
  const S = szene(); const { p } = S;
  const w1 = Scanbar.scanbarAnmelden('ga', { ziele: () => [{ id: 'g1', typ: 'a', x: p.x + 10, y: p.y }] });
  const w2 = Scanbar.scanbarAnmelden('gb', { ziele: () => [{ id: 'g1', typ: 'b', x: p.x - 10, y: p.y }] });
  S.scanne(1);
  ok(S.sc() && S.sc()['ga:g1'] && S.sc()['gb:g1'] && S.snapSc().length === 2, 'gleiche Id in zwei Arten: zwei getrennte Einträge');
  w1(); w2();
}

section('(2) Staffelung je Stufe 0..3');
{
  const S0 = szene(); S0.debug('scantest'); S0.scanne(0);
  ok(S0.sc() === undefined, 'Stufe 0 (Rauschen): nichts gesetzt');
  for (const st of [1, 2]) {
    const S = szene(); S.debug('scantest'); S.scanne(st);
    const e = tz(S, 'tz1');
    ok(e && e.sk === st && e.x === undefined && e.y === undefined, 'Stufe ' + st + ': sk ' + st + ', keine Position (Standard-Tiefen)');
  }
  const S3 = szene(); S3.debug('scantest'); const p3 = S3.p; const px = p3.x, py = p3.y; S3.scanne(3);
  const e3 = tz(S3, 'tz1');
  ok(e3.sk === 3 && e3.x === Math.round(px + R * 0.3) && e3.y === Math.round(py), 'Stufe 3: sk 3 mit Position');
  const S = szene(); const { p } = S;
  const weg = Scanbar.scanbarAnmelden('nah', { tiefen: { position: 1 }, ziele: () => [{ id: 'n1', typ: 'nahtyp', x: p.x + 50, y: p.y }] });
  const x0 = p.x, y0 = p.y;
  S.scanne(1);
  const en = S.sc() && S.sc()['nah:n1'];
  ok(en && en.sk === 1 && en.x === Math.round(x0 + 50) && en.y === Math.round(y0), 'Art mit position 1: Position schon bei Stufe 1');
  weg();
}

section('(3) sk steigt nur');
{
  const S = szene();
  S.debug('scantest');
  S.scanne(3);
  const x0 = tz(S, 'tz1').x;
  S.scanne(1);
  ok(tz(S, 'tz1').sk === 3 && tz(S, 'tz1').x === x0 && x0 !== undefined, 'Scan Stufe 3, danach Stufe 1: sk bleibt 3, Position bleibt');
  ok(S.text === 'Scan: nichts Neues.', 'schlechterer Scan meldet nichts Neues');
  const S2 = szene(); S2.debug('scantest');
  S2.scanne(1); S2.scanne(2);
  ok(tz(S2, 'tz1').sk === 2 && tz(S2, 'tz1').x === undefined, 'Stufe 1, dann 2: sk steigt auf 2, noch keine Position');
  S2.scanne(3);
  ok(tz(S2, 'tz1').sk === 3 && tz(S2, 'tz1').x !== undefined, 'dann 3: Position kommt dazu');
}

section('(4) Snapshot away.sc');
{
  const S = szene(); const { g } = S;
  ok(!('sc' in g.snapshot().away), 'ohne aw.sc: kein Feld');
  S.debug('scantest');
  ok(!('sc' in g.snapshot().away), 'Testziele ohne Scan: kein Feld');
  const px = S.p.x, py = S.p.y;
  S.scanne(1);
  const sc = S.snapSc();
  ok(Array.isArray(sc) && sc.length === 3 && sc.every((e) => Array.isArray(e) && e.length === 4), 'Stufe 1: drei Einträge [id, art, typ, sk] ohne Position');
  const e1 = sc.find((e) => e[0] === 'tz1');
  ok(e1 && e1[1] === 'test' && e1[2] === 'testerz' && e1[3] === 1, 'Reihenfolge id, art, typ, sk');
  // strukturell statt Zahlenmuster: genau vier Elemente [id, art, typ, sk], nur sk ist eine Zahl (kein x, y), Menge der ids stimmt in beide Richtungen
  ok(sc.every((e) => e.length === 4 && e.slice(0, 3).every((v) => typeof v === 'string') && Number.isInteger(e[3]) && e[3] === 1), 'vor der Positionsstufe: je Eintrag genau [id, art, typ, sk], sonst keine Zahl');
  const ids = new Set(sc.map((e) => e[0]));
  ok(['tz1', 'tz2', 'tz3'].every((id) => ids.has(id)) && ids.size === 3 && !ids.has('tz4'), 'ids: erfasste enthalten (tz1..tz3), nicht erfasste fehlen (tz4), nichts sonst');
  ok(!JSON.stringify(g.snapshot()).includes('tz4'), 'das Ziel außerhalb taucht nirgends im Snapshot auf');
  S.scanne(3);
  const f1 = S.snapSc().find((e) => e[0] === 'tz1');
  ok(f1.length === 6 && f1[3] === 3 && f1[4] === Math.round(px + R * 0.3) && f1[5] === Math.round(py), 'Stufe 3: [id, art, typ, sk, x, y] (ganze px)');
  ok(g.snapshot().players.every((q) => q.sc === undefined), 'players[].sc (laufender Scan) unberührt');
}

section('(5) Reset, verschwundene Ziele, Weltstand');
{
  const S = szene(); const { g, p } = S;
  S.debug('scantest'); S.scanne(3);
  const ws = JSON.stringify(Weltstand.capture(g));
  ok(!/testerz|testmonster|tz1|"sk"/.test(ws), 'Weltstand enthält keine Scan-Ergebnisse');
  ok(Weltstand.validate(JSON.parse(ws), g).length === 0, 'Weltstand bleibt gültig');
  const alt = g.away;
  ok(Object.keys(alt.sc).length === 3, 'Vorbedingung: drei Einträge');
  let da = true;
  const weg = Scanbar.scanbarAnmelden('kurz', { ziele: () => (da ? [{ id: 'k1', typ: 'kurz', x: p.x + 20, y: p.y }] : []) });
  S.scanne(2);
  ok(alt.sc['kurz:k1'] && alt.sc['kurz:k1'].sk === 2, 'Fremd-Art erfasst');
  da = false; S.lauf(AUFR + DT * 3);
  ok(!alt.sc['kurz:k1'] && alt.sc['test:tz1'], 'verschwundenes Ziel fällt aus aw.sc, die übrigen bleiben');
  weg();
  const r = away.resetMap(g, 'kesh', {});
  ok(r.ok && g.aways.kesh !== alt && g.aways.kesh.sc === undefined, 'Kartenreset: aw.sc der neuen Karte leer');
  ok(!('sc' in g.snapshot().away), 'nach dem Reset kein Feld im Snapshot');
  let aufrufe = 0;
  const w = Scanbar.scanbarAnmelden('zaehler', { ziele: () => { aufrufe++; return []; } });
  S.lauf(DT * 5);
  ok(aufrufe === 0, 'update ohne aw.sc: keine Ziele abgefragt');
  w();
}
{
  // alle Ziele weg: aw.sc entfällt ganz, kein leeres Feld im Snapshot
  const S = szene(); const { g } = S;
  S.debug('scantest'); S.scanne(1);
  ok(S.sc() !== undefined, 'Vorbedingung: Ergebnisse da');
  g.debug = false; S.lauf(AUFR + DT * 3);
  ok(S.sc() === undefined && !('sc' in g.snapshot().away), 'ohne gelieferte Ziele entfällt aw.sc ganz');
}

section('(6) Zwei Spieler vereinigen');
{
  const S = szene({ spieler: 2 }); const [a, b] = S.ps;
  S.debug('scantest', 0);
  b.x = a.x + R * 1.5; b.y = a.y;   // b steht in Reichweite von tz4 (a.x + 1,6 R), aber nicht der anderen
  S.scanne(2, 0);
  ok(tz(S, 'tz1') && tz(S, 'tz1').sk === 2 && !tz(S, 'tz4'), 'Spieler a erfasst tz1..tz3 mit Stufe 2');
  S.scanne(3, 1);
  ok(tz(S, 'tz4') && tz(S, 'tz4').sk === 3 && tz(S, 'tz4').x !== undefined, 'Spieler b erfasst tz4 (Stufe 3, Position)');
  ok(tz(S, 'tz1').sk === 2 && tz(S, 'tz1').x === undefined, 'Eintrag von a bleibt unverändert erhalten');
  ok(['tz1', 'tz2', 'tz3', 'tz4'].every((id) => !!tz(S, id)), 'Ergebnisse beider Spieler stehen gemeinsam in aw.sc');
  ok(S.snapSc().length === 4, 'Snapshot zeigt alle vier (für alle sichtbar)');
}
{
  // gleichzeitig scannen
  const S = szene({ spieler: 2 }); const [a, b] = S.ps;
  S.debug('scantest', 0);
  b.x = a.x + R * 1.5; b.y = a.y;
  S.nutze(1, 0); S.nutze(1, 1);
  const ha = S.halteSignal(a, 1), hb = S.halteSignal(b, 1);
  S.lauf(SC.dauer + 2, () => { ha(); hb(); });
  ok(['tz1', 'tz2', 'tz3', 'tz4'].every((id) => !!tz(S, id)), 'parallele Scans: ebenfalls vereinigt');
}

section('(7) Notice-Texte');
{
  const S = szene(); S.debug('scantest');
  S.scanne(0);
  ok(S.text === 'Nur Rauschen. Der Scan war zu unsauber.', 'Stufe 0: Rauschen (war: ' + S.text + ')');
  S.scanne(1);
  ok(S.text === 'Scan: 3 Ziele erfasst', 'Erfolg: "Scan: 3 Ziele erfasst" (war: ' + S.text + ')');
  S.scanne(2);
  ok(S.text === 'Scan: 3 Ziele erfasst', 'verbesserte Ziele zählen als erfasst');
  const S2 = szene();
  S2.scanne(2);
  ok(S2.text === 'Nichts in Reichweite.', 'ohne Ziele: "Nichts in Reichweite." (war: ' + S2.text + ')');
}

section('(8) Schießen und Waffenwechsel brechen den Scan ab');
{
  const S = szene(); const { g, p } = S; S.debug('scantest');
  const start = () => { S.nutze(1); S.lauf(1, S.halteSignal(p, 1)); return !!p.scan && p.scan.halt > 0.05; };
  ok(start(), 'Scan läuft mit Fortschritt');
  combat.shoot(g, p, 0);
  ok(!p.scan && !(p.hold && p.hold.kind === 'scan'), 'Schuss: Scan und Hold weg');
  S.lauf(SC.dauer + 1);
  ok(S.sc() === undefined && !(p.scanBis > 0), 'Schuss: kein Ergebnis, keine Abklingzeit');
  Loadout.slotSetzen(g, p, 2, 'sturmgewehr');
  ok(start(), 'neuer Scan läuft');
  S.nutze(2);
  ok(!p.scan && !(p.hold && p.hold.kind === 'scan') && p.waffe === 'sturmgewehr', 'Waffenwechsel: Scan weg, Waffe gewechselt');
  S.lauf(SC.dauer + 1);
  ok(S.sc() === undefined && !(p.scanBis > 0), 'Waffenwechsel: kein Ergebnis');
  ok(start(), 'Scan läuft erneut');
  S.nutze(2);   // dieselbe Waffe: No-op, der Scan läuft weiter
  ok(!!p.scan, 'gleiche Waffe (No-op): Scan läuft weiter');
}

section('(9) Ohne Debug keine Testziele');
{
  const S = szene({ debug: false }); const { g, p } = S;
  S.debug('scantest');
  S.scanne(3);
  ok(S.sc() === undefined && S.text === 'Nichts in Reichweite.', 'Server ohne --debug: scantest ohne Wirkung, der Scan findet nichts');
  ok(Scanbar.debugScantest(g, p) === 'scantest: nur mit Server --debug.', 'debugScantest verweigert ohne Debug');
  const S2 = szene(); S2.scanne(3);
  ok(S2.sc() === undefined, 'mit Debug, aber ohne scantest: keine Testziele');
  const S3 = szene(); S3.debug('scantest'); S3.g.debug = false; S3.scanne(3);
  ok(S3.sc() === undefined, 'Debug nachträglich aus: Testziele werden nicht mehr geliefert');
}

section('(10) Bewegtes Ziel: Position wird bei jedem Scan nachgeführt');
{
  const S = szene(); const { p } = S;
  const ziel = { id: 'm1', typ: 'testmonster', x: p.x + 100, y: p.y };
  const weg = Scanbar.scanbarAnmelden('beweg', { ziele: () => [ziel] });
  S.scanne(3);
  const e = S.sc()['beweg:m1'];
  ok(e && e.sk === 3 && e.x === Math.round(p.x + 100) && e.y === Math.round(p.y), 'erster Scan: Position vorher');
  ziel.x = p.x + 150; ziel.y = p.y + 40;
  S.scanne(3);
  const e2 = S.sc()['beweg:m1'];
  ok(e2.sk === 3 && e2.x === Math.round(p.x + 150) && e2.y === Math.round(p.y + 40), 'zweiter Scan (gleiche Stufe): Position nachher');
  ok(S.text === 'Scan: 1 Ziel aktualisiert', 'Meldung "aktualisiert" (war: ' + S.text + ')');
  const f = S.snapSc().find((x) => x[0] === 'm1');
  ok(f && f[4] === Math.round(p.x + 150) && f[5] === Math.round(p.y + 40), 'Snapshot zeigt die neue Position');
  S.scanne(3);
  ok(S.text === 'Scan: nichts Neues.', 'Ziel steht still, Stufe gleich: nichts Neues (war: ' + S.text + ')');
  ziel.x = p.x + 200;
  S.scanne(2);
  ok(S.sc()['beweg:m1'].x === Math.round(p.x + 150) && S.sc()['beweg:m1'].sk === 3 && S.text === 'Scan: nichts Neues.', 'schlechter Scan (unter der Positionsstufe) führt die Position nicht nach, sk bleibt');
  ziel.x = p.x + 10;
  S.scanne(3);
  ok(S.sc()['beweg:m1'].x === Math.round(p.x + 10), 'wieder Stufe 3: Position nachgeführt');
  weg();
}
{
  // Art mit position 1: schon Stufe 1 führt nach
  const S = szene(); const { p } = S;
  const ziel = { id: 'n1', typ: 'nahtyp', x: p.x + 50, y: p.y };
  const weg = Scanbar.scanbarAnmelden('nahb', { tiefen: { position: 1 }, ziele: () => [ziel] });
  S.scanne(1); ziel.x = p.x + 80; S.scanne(1);
  ok(S.sc()['nahb:n1'].x === Math.round(p.x + 80) && S.text === 'Scan: 1 Ziel aktualisiert', 'position 1: Stufe 1 führt die Position nach');
  weg();
}

section('(11) Obergrenze maxEintraege (Snapshot-Budget)');
{
  ok(SC.maxEintraege === 16, 'Config scanner.maxEintraege = 16');
  const S = szene(); const { p } = S;
  const liste = []; for (let i = 0; i < 20; i++) liste.push({ id: 'v' + String(i).padStart(2, '0'), typ: 'erz', x: p.x + 10 * (i + 1), y: p.y });
  const weg = Scanbar.scanbarAnmelden('viele', { ziele: () => liste });
  S.scanne(3);
  ok(Object.keys(S.sc()).length === 16 && S.snapSc().length === 16, 'höchstens 16 Einträge in aw.sc und im Snapshot');
  ok(liste.slice(0, 16).every((z) => S.sc()['viele:' + z.id]) && liste.slice(16).every((z) => !S.sc()['viele:' + z.id]), 'die 16 nächsten zum Scanpunkt sind drin, die vier entferntesten fehlen');
  ok(S.text === 'Scan: 16 Ziele erfasst – Speicher voll (4 Ziele nicht erfasst)', 'Meldung nennt Überlauf (war: ' + S.text + ')');
  S.scanne(3);
  ok(S.text === 'Scan: Speicher voll' && Object.keys(S.sc()).length === 16, 'erneuter Scan ohne Änderung: "Speicher voll", weiter 16');
  liste.push({ id: 'nah', typ: 'erz', x: p.x + 2, y: p.y });
  S.scanne(3);
  ok(!S.sc()['viele:nah'] && Object.keys(S.sc()).length === 16 && S.sc()['viele:v15'], 'bereits erfasste bleiben: ein näheres neues Ziel verdrängt nichts');
  liste[0].x += 20;
  S.scanne(3);
  ok(S.sc()['viele:v00'].x === Math.round(p.x + 30) && /aktualisiert/.test(S.text) && /Speicher voll/.test(S.text), 'erfasste Einträge werden bei voller aw.sc weiter nachgeführt');
  weg();
}
{
  // Nächste zuerst bei kleiner Grenze (tune scanner.maxEintraege); g.C ist die gemeinsame CONFIG: zurücksetzen
  const S = szene(); const { p, g } = S;
  const alt = g.C.scanner.maxEintraege;
  const weg = Scanbar.scanbarAnmelden('fern', { ziele: () => [
    { id: 'f3', typ: 'erz', x: p.x + 300, y: p.y }, { id: 'f1', typ: 'erz', x: p.x + 50, y: p.y }, { id: 'f2', typ: 'erz', x: p.x, y: p.y - 120 }, { id: 'f4', typ: 'erz', x: p.x - 360, y: p.y } ] });
  try {
    g.C.scanner.maxEintraege = 2;
    S.scanne(1);
    ok(Object.keys(S.sc()).sort().join() === 'fern:f1,fern:f2', 'maxEintraege 2: die zwei nächsten (f1, f2), unabhängig von der Lieferreihenfolge');
    g.C.scanner.maxEintraege = 3;
    S.scanne(1);
    ok(Object.keys(S.sc()).sort().join() === 'fern:f1,fern:f2,fern:f3', 'Grenze auf 3: das nächste freie Ziel (f3) rückt nach');
  } finally { g.C.scanner.maxEintraege = alt; }
  weg();
}

section('(12) Aufräumprüfung höchstens alle 0,5 s');
{
  const S = szene(); S.debug('scantest'); S.scanne(1);
  ok(S.sc() !== undefined, 'Vorbedingung: aw.sc nicht leer');
  let aufrufe = 0;
  const w = Scanbar.scanbarAnmelden('zaehler2', { ziele: () => { aufrufe++; return []; } });
  S.lauf(3);
  ok(aufrufe >= 4 && aufrufe <= 7, 'in 3 s bei nicht leerem aw.sc höchstens alle 0,5 s gerufen (' + aufrufe + ' Aufrufe statt ~90)');
  const a0 = aufrufe; S.lauf(DT * 3);
  ok(aufrufe - a0 <= 1, 'nicht in jedem Tick');
  w();
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'Alle ' + n + ' Prüfungen grün.'));
process.exit(fails ? 1 : 0);
