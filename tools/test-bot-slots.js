'use strict';
// BOT-01 B2: Bots als Spieler auf Slots (server/bots/spieler.js, shared/charakter.js zufallskarte, Nachricht lobbyBot). Echtes Game, Bots ohne Spielverhalten (das ist B3).
//  1. Zufallskarte: 200 Würfe gültig und unverändert durch pruefeKarte, deterministisch, Namen eindeutig, Namenspool komplett gültig
//  2. Lobby: hinzufügen, würfeln, entfernen, Rollenwechsel; Ablehnungen (doppelte Rolle, vierter Bot, ungültige Rolle/pid, pid eines Menschen)
//  3. nur in der Lobby: außerhalb der Lobby lehnt jede op mit notice ab
//  4. Farbe 0 gehört nie einem Bot (auch Bots zuerst)
//  5. Lobby-Start: Bots sind immer bereit, nur Menschen entscheiden; letzter Mensch weg: Bots weg
//  6. Verdrängen: Mensch bei vollem Server (Lobby und Partie), freier Platz geht vor, Station frei, Kontingent-Frage an den Menschen
//  7. Menschen ohne Bot-Felder, Snapshot reiner Menschenpartie byte-gleich; Snapshot-Felder der Bots; Telemetrie-Kopf; Weltstand
//  8. Quellscan: Zählung nur in crew.js, Protokoll
//   node tools/test-bot-slots.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Crew = require('../server/sim/crew.js');
const Kontingent = require('../server/sim/kontingent.js');
const Station = require('../server/sim/station.js');
const Charakter = require('../shared/charakter.js');
const Protocol = require('../shared/protocol.js');
const katalog = require('../content/katalog/charakter.json');
const namen = require('../content/bots/namen.json').namen;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botslots-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;

// fester Zufallsstrom (mulberry32)
const strom = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// ---------- 1 Zufallskarte ----------
section('1 Zufallskarte (rein, deterministisch)');
{
  let gueltig = 0, gleich = 0, nameOk = 0, eindeutig = 0, nurFrei = 0;
  const frei = new Set(katalog.teile.filter((t) => t.herkunft === undefined || t.herkunft === 'frei').map((t) => t.id));
  for (let i = 0; i < 200; i++) {
    const andere = ['Marcus', 'Lucia', 'Crew'];
    const k = Charakter.zufallskarte(katalog, strom(i), andere, namen);
    if (JSON.stringify(Charakter.pruefeKarte(k, katalog)) === JSON.stringify(k)) gueltig++;
    if (JSON.stringify(Charakter.zufallskarte(katalog, strom(i), andere, namen)) === JSON.stringify(k)) gleich++;
    if (Charakter.pruefeName(k.name) === k.name && k.name.length >= 2 && k.name.length <= 12) nameOk++;
    if (!andere.map((x) => x.toLowerCase()).includes(k.name.toLowerCase())) eindeutig++;
    const teile = katalog.plaetze.map((p) => p.id + '/' + (p.gruppe === 'outfit' ? k.outfit[p.id] : k[p.id]));
    if (teile.every((t) => frei.has(t))) nurFrei++;
  }
  ok(gueltig === 200, '200 Würfe: jede Karte geht unverändert durch pruefeKarte');
  ok(gleich === 200, 'gleicher Seed, gleiche Karte');
  ok(nameOk === 200 && eindeutig === 200, 'Namen gültig (2 bis 12 Zeichen) und eindeutig zur Crew');
  ok(nurFrei === 200, 'nur freie Teile (der Editor würfelt nichts Gesperrtes)');
  const viele = new Set(Array.from({ length: 200 }, (_, i) => JSON.stringify(Charakter.zufallskarte(katalog, strom(i), [], namen))));
  ok(viele.size > 150, 'die Würfe streuen (' + viele.size + ' verschiedene Karten in 200)');
  ok(namen.length >= 40 && new Set(namen.map((x) => x.toLowerCase())).size === namen.length && namen.every((x) => Charakter.pruefeName(x) === x), `Namenspool: ${namen.length} Namen, alle gültig und verschieden`);
  const rand0 = Charakter.zufallskarte(katalog, () => 0, [], namen), rand1 = Charakter.zufallskarte(katalog, () => 0.9999999, [], namen);
  ok(JSON.stringify(Charakter.pruefeKarte(rand0, katalog)) === JSON.stringify(rand0) && JSON.stringify(Charakter.pruefeKarte(rand1, katalog)) === JSON.stringify(rand1), 'Grenzwerte des Zufalls (0 und fast 1) bleiben gültig');
  const ohneKatalog = Charakter.zufallskarte(null, strom(1), [], namen);
  ok(ohneKatalog && ohneKatalog.v === 1 && Charakter.pruefeName(ohneKatalog.name), 'ohne Katalog: Standardkarte mit Namen, kein Wurf');
  const voll = Charakter.zufallskarte(katalog, strom(3), namen, namen);
  ok(namen.indexOf(voll.name) < 0 && Charakter.pruefeName(voll.name) === voll.name, 'alle Poolnamen vergeben: Zählsuffix, weiterhin gültig (' + voll.name + ')');
}

// ---------- Aufbau ----------
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
function neu(extraEnv, seed) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 7, debug: true, env: Object.assign({ MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, extraEnv || {}), log: () => {} });
  g.botZufall = strom(42);
  return g;
}
function mensch(g, i, color) {
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: color === undefined ? i : color });
  return c;
}
const bot = (g, c, op, extra) => g.handleMessage(c, Object.assign({ t: Protocol.C.LOBBY_BOT, op }, extra || {}));
const botsVon = (g) => g.players.filter((p) => p.bot);
const notices = (c) => c.inbox.filter((m) => m.kind === 'notice');
const karten = (c) => c.inbox.filter((m) => m.kind === 'karte');
const run = (g, sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };

// ---------- 2 Lobby ----------
section('2 Lobby: hinzufügen, würfeln, entfernen, Rollenwechsel');
{
  const g = neu(), c = mensch(g, 0, 0), h = c.player;
  ok(Protocol.C.LOBBY_BOT === 'lobbyBot', 'Protokoll: C.LOBBY_BOT = lobbyBot');
  bot(g, c, 'add', { rolle: 'navigation' });
  let b = botsVon(g)[0];
  ok(botsVon(g).length === 1 && b.rolle === 'navigation' && b.botId === 'b0' && b.id === 'p2' && b.clientId === 'bot-b0' && b.bot === true && b.stimme === null, 'add: Bot p2 mit Rolle navigation, botId b0, clientId bot-b0');
  ok(b.connected === true && b.color === 1 && b.ready === true && typeof b.conn.send === 'function' && b.conn.bot === true, 'Bot verbunden, Farbe 1 (nicht 0), Fake-Verbindung');
  ok(b.karte && JSON.stringify(Charakter.pruefeKarte(b.karte, katalog)) === JSON.stringify(b.karte) && b.name === b.karte.name, 'Karte gültig (unverändert durch pruefeKarte), Name aus der Karte');
  ok(karten(c).some((m) => m.pid === 'p2' && m.k && m.k.name === b.name), 'Ereignis karte an den Menschen (Figur und Name wie bei Menschen)');
  ok(Crew.menschen(g) === 1 && Crew.koepfe(g) === 2, 'Crew: 1 Mensch, 2 Köpfe');
  const name1 = b.name, karte1 = JSON.stringify(b.karte);
  bot(g, c, 'wuerfeln', { pid: 'p2' });
  b = botsVon(g)[0];
  ok(JSON.stringify(b.karte) !== karte1 && b.id === 'p2' && b.botId === 'b0' && b.rolle === 'navigation' && b.color === 1 && b.name === b.karte.name, 'wuerfeln: neue Karte, Id, botId, Rolle und Farbe bleiben (Name vorher ' + name1 + ', jetzt ' + b.name + ')');
  ok(karten(c).filter((m) => m.pid === 'p2').length === 2, 'wuerfeln: Ereignis karte erneut');
  ok(g.players.filter((p) => p !== b).every((p) => p.name !== b.name), 'Name eindeutig in der Crew');
  const n0 = notices(c).length;
  bot(g, c, 'add', { rolle: 'navigation' });
  ok(botsVon(g).length === 1 && notices(c).length === n0 + 1, 'doppelte Rolle: abgelehnt, notice, kein neuer Bot');
  bot(g, c, 'add', { rolle: 'bord' }); bot(g, c, 'add', { rolle: 'frei' }); bot(g, c, 'add', { rolle: 5 }); bot(g, c, 'add', {}); bot(g, c, 'add', { rolle: '__proto__' });
  ok(botsVon(g).length === 1 && notices(c).length === n0 + 6, 'ungültige Rolle (auch bord/frei, Zahl, fehlend, __proto__): abgelehnt');
  bot(g, c, 'add', { rolle: 'ops' }); bot(g, c, 'add', { rolle: 'technik' });
  ok(botsVon(g).length === 3 && g.players.length === 4 && botsVon(g).map((x) => x.botId).join() === 'b0,b1,b2' && botsVon(g).map((x) => x.color).join() === '1,2,3', '3 Bots: botId b0..b2, Farben 1..3');
  const n1 = notices(c).length;
  bot(g, c, 'rolle', { pid: 'p4', rolle: 'ops' });
  ok(botsVon(g)[2].rolle === 'technik' && notices(c).length === n1 + 1, 'Rollenwechsel auf eine besetzte Rolle: abgelehnt');
  bot(g, c, 'rolle', { pid: 'p4', rolle: 'quatsch' });
  ok(botsVon(g)[2].rolle === 'technik' && notices(c).length === n1 + 2, 'Rollenwechsel auf eine ungültige Rolle: abgelehnt');
  bot(g, c, 'weg', { pid: 'p3' });
  ok(botsVon(g).length === 2 && g.players.map((p) => p.id).join() === 'p1,p2,p4' && karten(c).some((m) => m.pid === 'p3' && m.k === null), 'weg: Bot p3 entfernt, Karte geräumt (k = null)');
  bot(g, c, 'rolle', { pid: 'p4', rolle: 'ops' });
  ok(botsVon(g).find((x) => x.id === 'p4').rolle === 'ops' && botsVon(g).map((x) => x.rolle).sort().join() === 'navigation,ops', 'Rollenwechsel auf die frei gewordene Rolle ok');
  bot(g, c, 'add', { rolle: 'technik' });
  const neuer = botsVon(g).find((x) => x.rolle === 'technik');
  ok(neuer.id === 'p3' && neuer.botId === 'b1' && botsVon(g).length === 3, 'neuer Bot nimmt die kleinste freie Id (p3) und botId (b1, b0 und b2 sind belegt)');
  // Menschen sind kein Ziel
  const n2 = notices(c).length;
  bot(g, c, 'weg', { pid: 'p1' }); bot(g, c, 'wuerfeln', { pid: 'p1' }); bot(g, c, 'rolle', { pid: 'p1', rolle: 'ops' });
  ok(g.players.includes(h) && h.connected && h.name === 'K0' && g.players.length === 4, 'pid eines Menschen: nichts entfernt, Name unverändert (nichts gewürfelt)');
  ok(g.players.includes(h) && !('rolle' in h) && notices(c).length === n2 + 3, 'pid eines Menschen: drei Ablehnungen, Mensch ohne Bot-Felder');
  bot(g, c, 'weg', { pid: 'p9' }); bot(g, c, 'weg', {}); bot(g, c, 'wuerfeln', { pid: 5 }); bot(g, c, 'unbekannt'); bot(g, c, undefined);
  ok(g.players.length === 4 && notices(c).length === n2 + 8, 'unbekannte pid, fehlende pid, unbekannte op: abgelehnt, nichts geändert');
  bot(g, c, 'add', { rolle: 'ops' });
  ok(botsVon(g).length === 3, 'vierter Bot (mehr als drei): kein Platz');
  ok(g.players.every((p) => (p.bot ? p.conn && typeof p.conn.send === 'function' : p.conn === c)), 'jeder Spieler hat eine Verbindung, die send kann');
  // ein Fremder darf (jeder Mensch darf)
  const c2 = mensch(g, 5, 0);   // Server voll: der letzte Bot räumt (Abschnitt 6 prüft das genauer)
  ok(c2.player && !c2.player.bot && g.players.length === 4, 'zweiter Mensch bekommt einen Platz');
}

// ---------- 3 nur Lobby ----------
section('3 Außerhalb der Lobby: jede op wird mit notice abgelehnt');
{
  const g = neu(), c = mensch(g, 0, 0);
  bot(g, c, 'add', { rolle: 'ops' });
  g.handleMessage(c, { t: 'ready', ready: true });
  ok(g.phase === 'play', 'Partie läuft (Mensch bereit, der Bot zählt nicht mit)');
  const vorher = JSON.stringify(g.players.map((p) => [p.id, p.name, p.rolle, p.color, p.bot === true]));
  const n0 = notices(c).length, k0 = karten(c).length;
  bot(g, c, 'add', { rolle: 'navigation' }); bot(g, c, 'wuerfeln', { pid: 'p2' }); bot(g, c, 'weg', { pid: 'p2' }); bot(g, c, 'rolle', { pid: 'p2', rolle: 'technik' });
  ok(notices(c).length === n0 + 4 && JSON.stringify(g.players.map((p) => [p.id, p.name, p.rolle, p.color, p.bot === true])) === vorher && karten(c).length === k0, 'vier ops: vier notice, Spielerliste unverändert, keine neue Karte');
}

// ---------- 4 Farbe 0 ----------
section('4 Bots bekommen nie Farbe 0');
{
  const g = neu(), c = mensch(g, 0, 0);
  bot(g, c, 'add', { rolle: 'navigation' }); bot(g, c, 'add', { rolle: 'ops' }); bot(g, c, 'add', { rolle: 'technik' });
  ok(c.player.color === 0 && botsVon(g).every((b) => b.color !== 0) && new Set(g.players.map((p) => p.color)).size === 4, 'Mensch zuerst: Mensch Farbe 0, Bots 1 bis 3');
  const g2 = neu();   // Bots zuerst (Sonderfall: noch kein Mensch in der Lobby)
  botHinzu(g2, 'navigation'); botHinzu(g2, 'ops');
  ok(botsVon(g2).length === 2 && botsVon(g2).every((b) => b.color >= 1), 'Bots vor dem Menschen: Farben ab 1');
  const c2 = mensch(g2, 0, 0);
  ok(c2.player.color === 0 && botsVon(g2).map((b) => b.color).join() === '1,2', 'Mensch danach bekommt Farbe 0 (Wunsch), Bots behalten 1 und 2');
  const c3 = mensch(g2, 1, 1);
  ok(c3.player.color === 3 && new Set(g2.players.map((p) => p.color)).size === 4, 'zweiter Mensch mit Wunsch auf die Bot-Farbe 1 bekommt die freie Farbe 3');
  const g3 = neu(), cc = mensch(g3, 0, 2);   // Mensch ohne Farbe 0 (Sonderfall): Bots nehmen 1 bis 3, Mensch-Logik unberührt
  bot(g3, cc, 'add', { rolle: 'navigation' });
  ok(cc.player.color === 2 && botsVon(g3)[0].color === 1, 'Mensch mit Farbe 2: Bot nimmt 1 (nie 0, auch wenn 0 frei ist)');
  bot(g3, cc, 'add', { rolle: 'ops' }); bot(g3, cc, 'add', { rolle: 'technik' });
  ok(g3.players.length === 3 && botsVon(g3).length === 2 && botsVon(g3).every((b) => b.color !== 0), 'Farbe 0 frei: dritter Bot findet keine Farbe ≥ 1 mehr, bleibt draußen statt Farbe 0 zu nehmen');
}
function botHinzu(g, rolle) { require('../server/bots/spieler.js').botHinzufuegen(g, null, rolle); }

// ---------- 5 Lobby-Start, letzter Mensch ----------
section('5 Lobby-Start ignoriert Bots, letzter Mensch weg: Bots weg');
{
  const g = neu(), c = mensch(g, 0, 0), c2 = mensch(g, 1, 1);
  bot(g, c, 'add', { rolle: 'navigation' });
  g.handleMessage(c, { t: 'ready', ready: true });
  ok(g.phase === 'lobby', 'ein Mensch bereit, der andere nicht: kein Start (der Bot ist bereit)');
  g.handleMessage(c2, { t: 'ready', ready: true });
  ok(g.phase === 'play', 'alle Menschen bereit: Start, Bot ohne eigenes Bereit');
  const g2 = neu(), d = mensch(g2, 0, 0);
  bot(g2, d, 'add', { rolle: 'ops' }); bot(g2, d, 'add', { rolle: 'technik' });
  botsVon(g2).forEach((b) => { b.ready = false; });   // selbst ein zurückgesetztes Bereit der Bots stört nicht
  g2.handleMessage(d, { t: 'ready', ready: true });
  ok(g2.phase === 'play', 'Bots mit ready = false blockieren den Start nicht');
  const g3 = neu();
  botHinzu(g3, 'ops'); g3.checkLobbyStart();
  ok(g3.phase === 'lobby' && botsVon(g3).length === 1, 'nur Bots: nichts startet');
  const g4 = neu(), e1 = mensch(g4, 0, 0), e2 = mensch(g4, 1, 1);
  bot(g4, e1, 'add', { rolle: 'ops' }); bot(g4, e1, 'add', { rolle: 'technik' });
  const geraeumt = []; const emit0 = g4.emit.bind(g4); g4.emit = (kind, d) => { if (kind === 'karte' && d.k === null) geraeumt.push(d.pid); return emit0(kind, d); };
  g4.removeConnection(e1);
  ok(g4.players.length === 3 && botsVon(g4).length === 2, 'ein Mensch geht, ein Mensch bleibt: Bots bleiben');
  g4.removeConnection(e2);
  ok(g4.players.length === 0 && geraeumt.includes('p3') && geraeumt.includes('p4'), 'letzter Mensch geht: Lobby leer, Karten der Bots geräumt');
  const e3 = mensch(g4, 2, 0);
  ok(g4.players.length === 1 && e3.player.id === 'p1' && botsVon(g4).length === 0, 'die nächste Gruppe beginnt in einer leeren Lobby');
  ok(g4.lobbyOpts.liveSpielleiter === false, 'liveSpielleiter bleibt false (FRE-01)');
}

// ---------- 6 Verdrängen ----------
section('6 Mensch bei vollem Server: ein Bot räumt');
{
  const g = neu(), c = mensch(g, 0, 0);
  bot(g, c, 'add', { rolle: 'navigation' }); bot(g, c, 'add', { rolle: 'ops' }); bot(g, c, 'add', { rolle: 'technik' });
  ok(g.players.length === 4, 'Lobby voll: Mensch und 3 Bots');
  const c2 = mensch(g, 1, 0);
  ok(g.players.length === 4 && !c2.player.bot && c2.player.connected && botsVon(g).length === 2 && !botsVon(g).some((b) => b.rolle === 'technik'), 'Lobby: der zuletzt hinzugefügte Bot (technik) ist weg, der Mensch sitzt');
  ok(c2.inbox.some((m) => m.t === 'welcome') && !c2.inbox.some((m) => m.t === 'full'), 'der Mensch bekommt welcome, nicht „Server voll“');
  const c3 = mensch(g, 2, 3);
  ok(g.players.length === 4 && botsVon(g).length === 1 && botsVon(g)[0].rolle === 'navigation', 'dritter Mensch: der nächste Bot räumt');
  const c4 = mensch(g, 3, 1);
  ok(g.players.length === 4 && botsVon(g).length === 0 && c4.player.connected, 'vierter Mensch: alle Bots weg, 4 Menschen');
  const c5 = mensch(g, 4, 0);
  ok(!c5.player && c5.inbox.some((m) => m.t === 'full') && g.players.length === 4, 'fünfter Mensch ohne Bot: wie bisher „Server voll“');
  ok(Crew.menschen(g) === 4, '4 Menschen verbunden');
}
{
  // Partie: Bot an einer Konsole; Mensch tritt bei, Station frei, Kontingent an den Menschen
  const g = neu({ SPIELLEITER_LLM: 'live', LLM_LIVE: '1' }), c = mensch(g, 0, 0);
  bot(g, c, 'add', { rolle: 'navigation' }); bot(g, c, 'add', { rolle: 'ops' }); bot(g, c, 'add', { rolle: 'technik' });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  run(1);
  ok(g.phase === 'play' && g.players.length === 4, 'Partie läuft voll');
  const letzter = g.players[3];
  letzter.console = 'weapons'; letzter.station = 'weapons';
  ok(Station.stationBesetzt(g, 'weapons') === true, 'der letzte Bot sitzt an der Konsole weapons (Station besetzt)');
  const bots0 = botsVon(g).map((b) => b.id);
  g.kontingent = Object.assign(g.kontingent || {}, { frage: { offen: true } });
  const c2 = mensch(g, 1, 1);
  const m2 = c2.player;
  ok(m2 && m2 === letzter && !m2.bot && m2.connected && m2.conn === c2 && m2.clientId === 'K1', 'Partie: der Mensch übernimmt den Platz des letzten Bots (gleiches Spielerobjekt, Index bleibt)');
  ok(g.players.length === 4 && g.players[3] === m2 && !('bot' in m2) && !('rolle' in m2) && !('botId' in m2) && !('stimme' in m2), 'Bot-Felder sind weg (bot, rolle, botId, stimme)');
  ok(m2.console === null && Station.stationBesetzt(g, 'weapons') === false, 'Konsole verlassen: Station weapons ist frei');
  ok(botsVon(g).length === 2 && botsVon(g).every((b) => b.connected && b.conn && b.conn.bot) && bots0.slice(0, 2).join() === botsVon(g).map((b) => b.id).join(), 'die beiden anderen Bots bleiben unberührt');
  ok(m2.name === 'K1' && karten(c).some((m) => m.pid === m2.id && m.k === null), 'Name des Menschen, die Bot-Karte ist geräumt');
  ok(Crew.menschen(g) === 2 && Crew.koepfe(g) === 4, 'Crew: 2 Menschen, 4 Köpfe');
  for (const x of [c, c2]) x.inbox.length = 0;
  ok(Kontingent.frageZustellen(g) === true && c.inbox.filter((m) => m.kind === 'kontingentFrage').length === 1 && c2.inbox.filter((m) => m.kind === 'kontingentFrage').length === 0, 'Kontingent-Frage geht an den Menschen mit Farbe 0 (nicht an den neuen, nicht an einen Bot)');
  let wirft = false; try { run(2); g.snapshot(); } catch (e) { wirft = true; }
  ok(!wirft && g.errors === 0, 'Partie läuft weiter, Snapshot ohne Fehler (errors = ' + g.errors + ')');
  // der erste Mensch geht: Farbe 0 frei, der Platz bleibt; ein dritter Mensch nimmt den freien Platz, Bots bleiben
  g.removeConnection(c);
  const botsDavor = botsVon(g).length;
  const c3 = mensch(g, 2, 0);
  ok(botsVon(g).length === botsDavor && c3.player && c3.player.id === 'p1' && c3.player.color === 0, 'freier Platz vorhanden: der Mensch nimmt ihn (p1, Farbe 0), kein Bot weicht');
  // Kontingent geht jetzt an den Neuen mit Farbe 0
  c3.inbox.length = 0; Kontingent.frageZustellen(g);
  ok(c3.inbox.filter((m) => m.kind === 'kontingentFrage').length === 1, 'Kontingent-Frage erreicht den Menschen, der Farbe 0 übernommen hat');
  // alle Plätze besetzt, noch ein Bot da: der nächste Mensch verdrängt
  const c4 = mensch(g, 3, 2);
  ok(c4.player && c4.player.connected && botsVon(g).length === botsDavor - 1 && g.players.length === 4, 'Partie voll: ein weiterer Mensch verdrängt den nächsten Bot');
}

// ---------- 7 Felder, Snapshot, Telemetrie, Weltstand ----------
section('7 Menschen ohne Bot-Felder, Snapshot byte-gleich, Telemetrie, Weltstand');
{
  const a = neu(), ca = mensch(a, 0, 0), ca2 = mensch(a, 1, 1);
  const b = neu(), cb = mensch(b, 0, 0), cb2 = mensch(b, 1, 1);
  bot(b, cb, 'add', { rolle: 'ops' }); bot(b, cb, 'weg', { pid: 'p3' });   // Bot-Code gelaufen, Bot wieder weg
  ok(JSON.stringify(a.snapshot()) === JSON.stringify(b.snapshot()), 'Lobby-Snapshot: mit Bot hinzu und weg byte-gleich zu einem ohne Bot-Code');
  ok([ca, ca2, cb, cb2].every((c) => ['bot', 'rolle', 'botId', 'stimme'].every((f) => !(f in c.player))), 'Menschen tragen keines der Felder bot, rolle, botId, stimme');
  const s = JSON.stringify(a.snapshot());
  ok(!s.includes('"bot"') && !s.includes('"rolle"'), 'reiner Menschen-Snapshot: kein Feld bot, kein Feld rolle');
  const m = neu(), cm = mensch(m, 0, 0);
  bot(m, cm, 'add', { rolle: 'technik' }); bot(m, cm, 'add', { rolle: 'navigation' });
  const sp = m.snapshot().players;
  ok(sp.length === 3 && !('bot' in sp[0]) && !('rolle' in sp[0]) && sp[1].bot === 1 && sp[1].rolle === 'technik' && sp[2].bot === 1 && sp[2].rolle === 'navigation', 'Snapshot: bot: 1 und rolle nur bei Bots');
  ok(sp[1].ready === true && sp[2].ready === true && sp[0].ready === false, 'Snapshot: Bots zeigen ready true, der Mensch sein eigenes Bereit');
  const Kopf = require('../server/telemetrie/kopf.js');
  const k = Kopf.baueKopf(m, { tuning: Kopf.tuningStand(m), quelle: 'mensch' });
  ok(k.slots.filter((x) => x.bot === true).length === 2 && !('bot' in k.slots[0]), 'Telemetrie-Kopf: slots[].bot = true nur bei den Bots');
  // Weltstand: meta.spieler ohne Bots
  const w = neu({}, 11), cw = mensch(w, 0, 0);
  bot(w, cw, 'add', { rolle: 'ops' });
  w.handleMessage(cw, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  w.handleMessage(cw, { t: 'ready', ready: true }); run(1);
  let meta = null;
  try { w.saveWorld('test'); const dir = w.worldDir; const f = fs.readdirSync(dir).find((x) => /\.json$/.test(x) && !/lock/.test(x)); if (f) meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).meta; } catch (e) { meta = null; }
  ok(meta && Array.isArray(meta.spieler) && meta.spieler.length === 1 && meta.spieler[0] === 'K0', 'Weltstand: meta.spieler nennt nur Menschen' + (meta ? '' : ' (kein Weltstand geschrieben)'));
  ok(!JSON.stringify(meta || {}).includes('bot'), 'Weltstand: kein Hinweis auf Bots');
}

// ---------- 8 Quellscan, Protokoll ----------
section('8 Quellscan');
{
  const ZAEHLUNG = /\.filter\([^;\n]*connected[^;\n]*\)\s*\.(length|size)\b|connectedCount|Station\.verbunden\b/;
  const dateien = [];
  (function lauf(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) lauf(p); else if (e.name.endsWith('.js')) dateien.push(p.split(path.sep).join('/')); } })('server');
  const verstoesse = dateien.filter((f) => f !== 'server/sim/crew.js' && fs.readFileSync(f, 'utf8').split(/\r?\n/).some((z) => ZAEHLUNG.test(z)));
  ok(dateien.includes('server/bots/spieler.js') && verstoesse.length === 0, 'server/: keine Zählung per filter(connected).length außerhalb crew.js' + (verstoesse.length ? ' – ' + verstoesse.join(' ') : ''));
  const sp = fs.readFileSync('server/bots/spieler.js', 'utf8');
  ok(!/bot\.befehl|bot\.antwort/.test(sp) && !/Boolean|, (true|false)\)/.test(sp.split('\n').filter((z) => /^function /.test(z)).join('\n')), 'spieler.js: bot.befehl/bot.antwort unberührt, keine Verhaltens-Flags in den Signaturen');
  const game = fs.readFileSync('server/game.js', 'utf8');
  ok((game.match(/BotSpieler\./g) || []).length === 3, 'game.js: genau drei dünne Aufrufe (Dispatch, Räumen, Verdrängen) – ' + (game.match(/BotSpieler\./g) || []).length);
}

console.log(`\ntest-bot-slots: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
