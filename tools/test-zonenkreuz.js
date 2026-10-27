'use strict';
// SYS-01 A1c „Zonenkreuz“: Snapshot ship.zonen (Integrität je Seite in %), Statusleiste = schwächste eigene Seite,
// Modulsysteme modul_1..4 mit Namen nach dem Modul im Raum, Reparatur-Gate für modul_N.
// Client-Hilfen (PultSysteme) laufen hier in Node; hud.js/consoles.js/pult.js brauchen den Browser (Sichtprüfung über tools/sicht-systeme.js).
//   node tools/test-zonenkreuz.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const I = require('../server/sim/interior.js');
const W = require('../server/world.js');
const PS = require('../public/js/pult-systeme-tokens.js');
const fs = require('fs');
const path = require('path');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

function newGame(seed) {
  const g = new Game({ noStore: true, seed: seed || 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  g.space.enemies = []; g.space.projectiles = [];
  g.ship.fireList = []; g.ship.breachList = [];
  for (const k of I.SYSTEM_ORDER) g.ship.systems[k] = 'ok';
  g.ship.fragile = {}; g.ship.offline = {};
  g.ship.shields.current = [0, 0, 0, 0];
  g.ship.shields.regenHold = 0;
  g.god = false;
  I.integritaetVoll(g);
  return g;
}

console.log('Server: Snapshot ship.zonen');
{
  const g = newGame(21);
  const sn = g.snapshot().ship;
  ok(Array.isArray(sn.zonen) && sn.zonen.length === 4, `zonen hat vier Seiten (Bug, Stb, Heck, Bb): ${JSON.stringify(sn.zonen)}`);
  ok(sn.zonen.every((v) => Number.isInteger(v) && v >= 0 && v <= 100), 'zonen: ganze Prozent 0–100 bei heilem Schiff');
  ok(sn.zonen.every((v) => v === 100), 'zonen: heiles Schiff steht überall auf 100');
  // Seiten-Reihenfolge = Sektoren der Server-Zuordnung (SECTOR_LABEL 0 Bug, 1 Steuerbord, 2 Heck, 3 Backbord)
  const lab = I.SECTOR_LABEL.map((s) => s.replace(/sektor$/, ''));
  ok(lab[0] === 'Bug' && lab[1] === 'Steuerbord' && lab[2] === 'Heck' && lab[3] === 'Backbord', `Seitenreihenfolge der Server-Labels: ${lab.join(' ')}`);
  ok(PS.TOKENS.TEXT.zone.bug === 'BUG' && PS.TOKENS.TEXT.zone.stb === 'STB' && PS.TOKENS.TEXT.zone.heck === 'HECK' && PS.TOKENS.TEXT.zone.bb === 'BB', 'Client: Seitenkürzel in derselben Reihenfolge (bug, stb, heck, bb)');
  ok(I.systemSector('emitter_bow') === 0 && I.systemSector('emitter_stbd') === 1 && I.systemSector('emitter_aft') === 2 && I.systemSector('emitter_port') === 3, 'Emitter je Seite: 0 Bug, 1 Stb, 2 Heck, 3 Bb (Index = EMITTERS)');
  ok(I.systemSector('reactor') === -1 && I.systemSector('shields') === -1, 'Reaktor und Schildgenerator liegen in der Mitte (-1)');
  ok(I.systemSector('modul_1') === -1 && I.systemSector('modul_4') === -1, 'Module liegen in der Mitte (-1)');

  // Seite zerstören: alle aktiven Systeme der Backbord-Seite (Sektor 3) zerstört -> 0 %, schwächste Seite
  for (const k of I.SYSTEM_ORDER) if (I.systemSector(k) === 3 && I.systemAktiv(g, k)) I.setzeZustand(g, k, 'broken');
  const sn2 = g.snapshot().ship;
  ok(sn2.zonen[3] === 0, `Backbord leer: zonen[3] = 0 (${sn2.zonen[3]})`);
  ok(sn2.zonen[0] === 100 && sn2.zonen[1] === 100 && sn2.zonen[2] === 100, 'andere Seiten bleiben voll');
  const sw = PS.schwaechsteSeite(sn2);
  ok(sw && sw.zone === 3 && sw.pct === 0 && sw.zust === 'zer' && sw.name === 'BB', `schwächste Seite ist Backbord, 0 %, zerstört (${JSON.stringify(sw)})`);

  // Teilschaden: Bug auf 40 % -> schwächste Seite Bug, beschädigt
  I.integritaetVoll(g);
  for (const k of I.SYSTEM_ORDER) if (I.systemSector(k) === 0 && I.systemAktiv(g, k)) I.setInteg(g, k, Math.round(I.integMax(g, k) * 0.4));
  const sn3 = g.snapshot().ship;
  const sw3 = PS.schwaechsteSeite(sn3);
  ok(sw3 && sw3.zone === 0 && sw3.zust === 'besch' && sn3.zonen[0] >= 35 && sn3.zonen[0] <= 45, `Bug auf ~40 %: schwächste Seite Bug, beschädigt (${sn3.zonen[0]} %)`);

  // Zonen-Wert = Server-Funktion (kein zweiter Rechenweg)
  const direkt = I.zonenSnapshot(g);
  ok(JSON.stringify(direkt) === JSON.stringify(sn3.zonen), 'Snapshot zonen = I.zonenSnapshot (eine Quelle)');
  const schwach = I.schwaechsteZone(g);
  ok(schwach && schwach.zone === sw3.zone, 'Server-schwaechsteZone und Client-Statusleiste zeigen dieselbe Seite');

  // Module: modul_1 zerstört -> Name nach dem Modul im Raum 1 (Frachtraum laut Start-Bestückung)
  g.ship.systems.modul_1 = 'ok';
  I.setzeZustand(g, 'modul_1', 'broken');
  const sn4 = g.snapshot().ship;
  ok(sn4.systems && sn4.systems.modul_1 === 'broken', 'Modulsystem modul_1 im Snapshot (zerstört)');
  ok(PS.modulName(sn4, 'modul_1') === 'Frachtraum', `modul_1 heißt nach dem Modul im Raum 1: ${PS.modulName(sn4, 'modul_1')}`);
  ok(sn4.zonen.every((v) => Number.isInteger(v)), 'zonen bleibt ganzzahlig nach Modulschaden (Mitte zählt nicht)');
  const sizeWithZonen = Buffer.byteLength(JSON.stringify(sn4));
  ok(sizeWithZonen > 0, `Snapshot-Ship-Größe ${sizeWithZonen} B (Gesamtbudget: tools/snap-mess.js)`);
}

console.log('\nServer: Module und Reparatur-Gate');
{
  ok(I.SYSTEM_ORDER.includes('modul_1') && I.SYSTEM_ORDER.includes('modul_4'), 'SYSTEM_ORDER enthält modul_1..modul_4 (Reparatur-Gate in repairCmd)');
  const rooms = W.Maps.MODUL_RAEUME.map((r) => r.raum);
  for (const r of rooms) ok(W.STATIONS.some((s) => s.system === 'modul_' + r), `Modulraum ${r}: Station modul_${r} in der Welt (Reparatur an der Station)`);
  ok(Protocol.SYSTEMS_INTEG.length === I.SYSTEM_ORDER.length, 'SYSTEMS_INTEG und SYSTEM_ORDER gleich lang (Snapshot-Positionen)');
}

console.log('\nClient-Hilfen (PultSysteme)');
{
  ok(PS.zonenZustand(0) === 'zer' && PS.zonenZustand(1) === 'besch' && PS.zonenZustand(50) === 'besch' && PS.zonenZustand(51) === 'ok' && PS.zonenZustand(100) === 'ok', 'zonenZustand: 0 zerstört, bis 50 beschädigt, darüber heil');
  ok(PS.zonenZustand(-1) === 'keine', 'zonenZustand: -1 = keine aktive Seite');
  ok(PS.schwaechsteSeite(null) === null && PS.schwaechsteSeite({}) === null && PS.schwaechsteSeite({ zonen: [-1, -1, -1, -1] }) === null, 'schwaechsteSeite: ohne Daten oder ohne aktive Seite null');
  const b = PS.schwaechsteSeite({ zonen: [100, 50, 20, 90] });
  ok(b && b.zone === 2 && b.name === 'HECK' && b.pct === 20 && b.zust === 'besch', 'schwaechsteSeite: niedrigster Wert gewinnt (Heck 20 %)');
  const c = PS.schwaechsteSeite({ zonen: [70, -1, 70, 70] });
  ok(c && c.zone === 0 && c.pct === 70, 'schwaechsteSeite: Seiten ohne aktive Systeme (-1) zählen nicht');
  ok(PS.modulName({ mod: [['f', 1, 1, 1], ['w', 3, 1, 1]] }, 'modul_1') === 'Frachtraum' && PS.modulName({ mod: [['f', 1, 1, 1], ['w', 3, 1, 1]] }, 'modul_3') === 'Werkstatt', 'modulName: Raum 1 Frachtraum, Raum 3 Werkstatt');
  ok(PS.modulName({ mod: [] }, 'modul_2') === 'Modulraum 2', 'modulName: ohne Modul im Raum Modulraum N');
  ok(PS.modulName({}, 'reactor') === null, 'modulName: kein Modulsystem -> null');
  // Modul-Codes: gleiche Namen wie config.module.codes (Quelle der Codes im Snapshot)
  const codes = CONFIG.module.codes;
  for (const id of Object.keys(codes)) {
    const want = id.charAt(0).toUpperCase() + id.slice(1);
    ok(PS.MODUL_NAMEN[codes[id]] === want, `Modul-Code ${codes[id]} (${id}) -> ${want}`);
  }
}

console.log('\nClient-Quelltext (Übergang entfernt)');
{
  const root = path.join(__dirname, '..', 'public', 'js');
  const lesen = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const cons = lesen('consoles.js');
  ok(!/leakText|Durchlass-Ampel|Systemschaden je Treffer/.test(cons), 'consoles.js: keine Durchlass-Legende und kein leakText mehr');
  const alle = ['consoles.js', 'hud.js', 'pult.js', 'sitz.js', 'client.js'].map(lesen).join('\n');
  ok(!/'SYS ' \+|label: 'SYS'|l: 'SYS'|'SYS', /.test(alle), 'Statusleiste/Technik: kein SYS-Feld mehr');
  ok(!/SYS 100/.test(alle), "keine Platzhalter 'SYS 100'");
  ok(!/H\.SYS_NAMES\[(sys|s|ev\.system)\] \|\| /.test(alle), 'Namen laufen über H.sysName (Modulnamen)');
}

console.log('\nStatusfeld (Rangfolge) und Modell');
{
  const Zs = require('../server/sim/zielsysteme.js');
  const ZK = require('../public/js/zonenkreuz.js');
  const g = newGame(21);
  const F = PS.TOKENS.FARBE;
  let sf = PS.statusFeld(g.snapshot().ship);
  ok(sf.rang === 'voll' && sf.v === 'VOLL' && sf.farbe === 'statusVoll', `heiles Schiff: ZONEN VOLL (${sf.l} ${sf.v})`);
  for (const k of I.SYSTEM_ORDER) if (I.systemSector(k) === 0 && I.systemAktiv(g, k)) I.setInteg(g, k, Math.round(I.integMax(g, k) * 0.4));
  sf = PS.statusFeld(g.snapshot().ship);
  ok(sf.rang === 'seite' && sf.zust === 'besch' && sf.farbe === 'statusBesch' && /^BUG \d+%$/.test(sf.v), `schwächste Seite Bug beschädigt (${sf.l} ${sf.v})`);
  for (const k of I.SYSTEM_ORDER) if (I.systemSector(k) === 3 && I.systemAktiv(g, k)) I.setzeZustand(g, k, 'broken');
  sf = PS.statusFeld(g.snapshot().ship);
  ok(sf.rang === 'offen' && sf.v === 'BB OFFEN' && sf.text === 'MITTE OFFEN' && sf.farbe === 'statusOffen' && sf.zust === 'zer', `Backbord leer: MITTE BB OFFEN geht vor der schwächsten Seite (${sf.l} ${sf.v})`);
  for (const k of I.SYSTEM_ORDER) if (I.systemSector(k) === 1 && I.systemAktiv(g, k)) I.setzeZustand(g, k, 'broken');
  sf = PS.statusFeld(g.snapshot().ship);
  ok(sf.rang === 'offen' && sf.v === '2 SEITEN OFFEN', `zwei leere Seiten: ${sf.v}`);
  I.setzeZustand(g, 'reactor', 'broken');
  sf = PS.statusFeld(g.snapshot().ship);
  ok(sf.rang === 'reaktor' && sf.l === 'REAKTOR' && sf.text === 'REAKTOR' && sf.farbe === 'statusReaktor', `Reaktor zerstört geht vor Mitte offen (${sf.l} ${sf.v})`);
  ok(PS.farben('rom')[sf.farbe] && PS.farben('germanen')[sf.farbe] === F.zerText, 'Farbe über Tokens (germanen: Text in zerText)');
  ok(PS.statusFeld(null).rang === 'keine' && PS.statusFeld({}).rang === 'keine', 'ohne Daten: Feld leer, kein Fehler');

  // Modell: Zone je System aus der Legende, Zustand, leere Zone, Gegnerziel
  const g2 = newGame(22);
  I.setzeZustand(g2, 'battery_port', 'broken'); I.setInteg(g2, 'emitter_stbd', 5); g2.ship.systems.emitter_stbd = 'damaged';
  const m = ZK.modell({ ship: g2.snapshot().ship }, { name: (id) => id });
  ok(m.zonen.bb.sys.some((e) => e.id === 'battery_port' && e.zust === 'zer' && e.platz === 4), 'Modell: Bb-Batterie zerstört, Ops-Platz 4');
  ok(m.zonen.stb.sys.some((e) => e.id === 'emitter_stbd' && e.zust === 'besch') && m.zonen.bug.sys.some((e) => e.id === 'emitter_bow' && e.zust === 'ok'), 'Modell: Stb-Emitter beschädigt, Bug-Emitter heil');
  ok(m.mitte.sys.some((e) => e.id === 'reactor') && m.mitte.sys.some((e) => e.id === 'modul_1') && !m.mitte.sys.some((e) => e.id === 'modul_3'), 'Modell: Mitte = Reaktor, Schildgenerator, aktive Module (leere Modulräume fehlen)');
  ok(m.offen.length === 0 && !m.zonen.bb.leer, 'Modell: eine Zone mit einem zerstörten System ist nicht leer');
  for (const k of I.SYSTEM_ORDER) if (I.systemSector(k) === 3 && I.systemAktiv(g2, k)) I.setzeZustand(g2, k, 'broken');
  const m2 = ZK.modell({ ship: g2.snapshot().ship });
  ok(m2.zonen.bb.leer && m2.offen.join() === 'bb' && m2.zonen.bb.sys.every((e) => e.zust === 'zer'), 'Modell: Zone leer = Server-Zahl zonen[3] = 0, alle Systeme zerstört');
  ok(ZK.sektorVon('emitter_port') === 3 && ZK.sektorVon('reactor') === -1 && ZK.sektorVon('modul_2') === -1, 'Zone je System wie interior.systemSector');
  for (const k of I.SYSTEM_ORDER) ok(ZK.sektorVon(k) === I.systemSector(k), `Zone von ${k}: Client = Server`);

  // Zeichnung gegen eine aufzeichnende Fläche: leere Zone gestrichelt, offene Wand, ZU, Gegnerziel
  const rec = []; const ctx = new Proxy({}, { get: (t, p) => (p === 'fillRect' ? (x, y, w, h) => rec.push({ f: ctx.fillStyle, x, y, w, h }) : p === 'fillStyle' ? t.fillStyle : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
  const texte = [];
  const env = { R: { text: (c, s) => texte.push(s), measure: (s) => String(s).length * 6, ui: { buttons: [] } }, P: { mix: (a) => a, skin: { id: 'rom' } } };
  const rect = { x: 10, y: 10, w: 372, h: 188 };
  const erg = ZK.zeichne(ctx, m2, rect, { env, skin: 'rom', gezieltId: 'thruster_port', klick: () => {} });
  const wand = PS.farben('rom').wandEigen;
  ok(rec.some((r) => r.f === wand && r.x === erg.mitte.x - 3), 'Zeichnung: offene Wand zur Mitte auf der Bb-Seite in wandEigen (Rot)');
  ok(texte.includes('LEER') && texte.includes('→'), 'Zeichnung: LEER in der leeren Zone, → am Gegnerziel');
  ok(!texte.includes('ZU') && !erg.zu, 'Zeichnung eigenes Schiff: keine Mitte „ZU“ ohne zugewandte Zone');
  ok(env.R.ui.buttons.length === m2.zonen.bug.sys.length + m2.zonen.stb.sys.length + m2.zonen.heck.sys.length + m2.zonen.bb.sys.length + m2.mitte.sys.length, 'jede Zeile ist anwählbar (Klickfläche je System)');
  texte.length = 0;
  const erg2 = ZK.zeichne(ctx, m, rect, { env, skin: 'rom', gegner: true, zugewandt: 'stb' });
  ok(erg2.zu && texte.includes('ZU'), 'Mitte „ZU“, solange die zugewandte Zone nicht leer ist');
  texte.length = 0;
  const erg3 = ZK.zeichne(ctx, m2, rect, { env, skin: 'rom', gegner: true, zugewandt: 'bb' });
  ok(!erg3.zu && !texte.includes('ZU'), 'Mitte offen, sobald die zugewandte Zone leer ist');

  // Gegnerziel im Snapshot: ship.zielAuf = Index in SYSTEMS_INTEG, Abbildung aus den Zielsysteme-Werten (Feld `lerche`)
  const g3 = newGame(23);
  const space = require('../server/sim/space.js');
  const mk = () => space.spawnEnemy(g3, 'korvette', { x: g3.ship.x + 400, y: g3.ship.y, facing: 0 });
  const e1 = mk(); g3.space.enemies = [e1];
  ok(g3.snapshot().ship.zielAuf === -1, 'zielAuf: -1, solange niemand zielt');
  e1.zielsystem = 'antrieb';
  ok(g3.snapshot().ship.zielAuf === -1, 'zielAuf: -1 ohne Szenenschalter (die Zielregel wirkt dann nicht)');
  Zs.szeneAn(g3, true);
  const idxEng = Protocol.SYSTEMS_INTEG.indexOf(Zs.SYSTEME.antrieb.lerche);
  ok(idxEng >= 0 && g3.snapshot().ship.zielAuf === idxEng && Protocol.SYSTEMS_INTEG[idxEng] === 'engines', `zielAuf: antrieb -> Index ${idxEng} (${Zs.SYSTEME.antrieb.lerche})`);
  const mm = ZK.modell({ ship: g3.snapshot().ship });
  ok(mm.gezieltId === 'engines', 'Client: gezieltId = engines (Snapshot-Index über SYSTEMS_INTEG)');
  Zs.SYSTEME.testziel = { name: 'Test', lerche: 'shields', seite: 'bug', klassen: ['korvette'], stufen: [] };
  const e2 = mk(); e2.zielsystem = 'testziel'; g3.space.enemies = [e1, e2];
  ok(g3.snapshot().ship.zielAuf === Protocol.SYSTEMS_INTEG.indexOf('shields'), 'zielAuf: mehrere Gegner -> der zuletzt erschienene gewinnt');
  e2.zielsystem = null;
  ok(g3.snapshot().ship.zielAuf === idxEng, 'zielAuf: zielt der neuere nicht mehr, gilt der vorige');
  delete Zs.SYSTEME.testziel;
  g3.space.enemies = [];
  ok(g3.snapshot().ship.zielAuf === -1, 'zielAuf: ohne Gegner -1');
  const zielSn = JSON.stringify(g3.snapshot().ship).length;
  ok(zielSn > 0, `Snapshot-Ship ${zielSn} B`);
}

console.log('\nModule: Reparatur durch den Spieler (E halten, R Minispiel)');
{
  const Physics = require('../shared/physics.js');
  const g = new Game({ noStore: true, seed: 24, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(mm) { this.inbox.push(mm); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M0', name: 'M0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  g.space.enemies = []; g.space.projectiles = [];
  const p = g.players[0];
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) { g.space.enemies = []; g.space.projectiles = []; g.step(); } };
  const send = (mm) => g.handleMessage(c, mm);
  const st = W.STATIONS.find((s) => s.system === 'modul_1');
  const STAND = [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']];
  const spot = STAND.map(([dx, dy, dir]) => ({ x: st.x + dx, y: st.y + dy, dir })).find((s) => !W.ship.solid(s.x, s.y));
  ok(!!st && !!spot, `Modulstation modul_1 liegt auf Boden (${st && st.x},${st && st.y}), Standplatz daneben`);
  const place = () => { const q = Physics.tileCenter(spot.x, spot.y); p.x = q.x; p.y = q.y; p.dir = spot.dir; p.input.mx = 0; p.input.my = 0; if (p.console) send({ t: 'leave' }); };
  const hold = (sec) => { send({ t: 'act', down: true }); run(sec); send({ t: 'act', down: false }); run(0.05); };
  g.ship.fireList = []; g.ship.breachList = [];
  I.setzeZustand(g, 'modul_1', 'broken');
  place();
  const ia = I.interactionsAt(g, p, st.x, st.y, false);
  ok(ia.some((q) => q.kind === 'repair' && q.system === 'modul_1'), 'Server: E am Modulraum-Mitte bietet die Reparatur modul_1 an');
  hold(1.8);
  ok(g.ship.systems.modul_1 === 'damaged', `E halten flickt das zerstörte Modul (zerstört -> beschädigt): ${g.ship.systems.modul_1}`);
  g.ship.systems.modul_1 = 'damaged';
  place();
  send({ t: 'cmd', c: 'repair.start', system: 'modul_1' });
  ok(p.hold && p.hold.kind === 'minigame' && p.hold.system === 'modul_1', 'R: repair.start akzeptiert modul_1 (Station in Reichweite)');
  run(2.7);
  send({ t: 'cmd', c: 'repair.done', system: 'modul_1', errors: 0 });
  ok(g.ship.systems.modul_1 === 'ok', `Minispiel repariert das Modul dauerhaft: ${g.ship.systems.modul_1}`);
  send({ t: 'cmd', c: 'repair.start', system: 'modul_3' });
  ok(!(p.hold && p.hold.kind === 'minigame'), 'repair.start auf einen leeren Modulraum (modul_3) wird abgelehnt');
  // Bot-Reparaturliste kennt Modulsysteme
  g.ship.systems.modul_2 = 'broken';
  const bots = require('../server/sim/bots.js');
  ok(bots.queueRepair(g, 'modul_2', 'flick') === null, 'technik.repair akzeptiert modul_2 (Reparaturliste der Schrauber)');
  ok(g.errors === 0, 'keine Server-Fehler (' + g.errors + ')');
}

console.log('\n' + (fails ? `${fails} FEHLER von ${n}` : `${n}/${n} ok`) + ' (SYS-01 A1c Zonenkreuz)');
process.exit(fails ? 1 : 0);
