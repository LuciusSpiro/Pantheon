'use strict';
// BOT-05 A1: die Stammcrew (content/bots/figuren.json, server/bots/figuren.js, shared/bot-figuren.js). Jeder Bot ist eine feste Figur: botId = Figur, nicht Platz.
//  1. Datei gültig (drei eindeutige botId, Namen, pruefeName, pruefeKarte, nur freie Teile, Stimme in stimmen.json); die Prüfung lehnt jeden Fehlerfall ab (Selbsttest)
//  2. Figuren wie im Auftrag (Livia b0, Cassius b1, Titus b2, Persönlichkeit wörtlich, Stimme = botId)
//  3. Persistenz: mehrere Partien nacheinander, Bots in anderer Rollenreihenfolge, je botId derselbe Name, dieselbe Karte (tief gleich), dieselbe Stimme
//  4. erste freie Figur: nach Räumen von b0 bekommt der nächste neue Bot wieder b0, unabhängig von Rolle und Platz; nie b3
//  5. Würfeln ändert nichts (Karte, Name, Ereignisse)
//  6. Kollision mit einem Menschen: der Mensch behält seinen Namen, der Bot bekommt den Zählsuffix
//  7. reine Menschenpartie unverändert: keine Bot-Felder an Spielern, im Snapshot
//   node tools/test-bot-figuren.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Figuren = require('../server/bots/figuren.js');
const BotFiguren = require('../shared/bot-figuren.js');
const Charakter = require('../shared/charakter.js');
const Protocol = require('../shared/protocol.js');
const katalog = require('../content/katalog/charakter.json');
const stimmen = require('../content/bots/stimmen.json');
const daten = require('../content/bots/figuren.json');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const klon = (x) => JSON.parse(JSON.stringify(x));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botfiguren-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;

const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
function neu() {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  return new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
}
function mensch(g, i, color, name) {
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: name || 'K' + i, color: color === undefined ? i : color });
  return c;
}
const bot = (g, c, op, extra) => g.handleMessage(c, Object.assign({ t: Protocol.C.LOBBY_BOT, op }, extra || {}));
const botsVon = (g) => g.players.filter((p) => p.bot);
const botIds = (g) => botsVon(g).map((b) => b.botId).sort().join();
const notices = (c) => c.inbox.filter((m) => m.kind === 'notice');
const karten = (c) => c.inbox.filter((m) => m.kind === 'karte');
const pruefe = (d) => BotFiguren.pruefeFiguren(d, katalog, stimmen);

// ---------- 1 Datei ----------
section('1 figuren.json: gültig, Prüfung lehnt Fehler ab');
{
  ok(daten.format === 'bot-figuren/1' && BotFiguren.FORMAT === daten.format, 'Format bot-figuren/1');
  ok(pruefe(daten).length === 0, 'die Datei ist gültig (Fehler: ' + pruefe(daten).join('; ') + ')');
  ok(Figuren.FIGUREN.length === 3 && new Set(daten.figuren.map((f) => f.botId)).size === 3, 'genau drei Figuren, drei eindeutige botId');
  ok(new Set(daten.figuren.map((f) => f.name.toLowerCase())).size === 3 && daten.figuren.every((f) => Charakter.pruefeName(f.name) === f.name), 'Namen eindeutig und pruefeName-gültig');
  const frei = new Set(katalog.teile.filter((t) => t.herkunft === undefined || t.herkunft === 'frei').map((t) => t.id));
  ok(daten.figuren.every((f) => JSON.stringify(Charakter.pruefeKarte(f.karte, katalog)) === JSON.stringify(f.karte) && f.karte.name === f.name
    && katalog.plaetze.every((p) => frei.has(p.id + '/' + (p.gruppe === 'outfit' ? f.karte.outfit[p.id] : f.karte[p.id])))), 'jede Karte geht unverändert durch pruefeKarte, Kartenname = Figurname, nur freie Teile');
  ok(daten.figuren.every((f) => Object.prototype.hasOwnProperty.call(stimmen, f.stimme)), 'jede Stimme steht in stimmen.json');
  ok(new Set(daten.figuren.map((f) => JSON.stringify(f.karte))).size === 3, 'die drei Karten sind verschieden');
  // Selbsttest der Prüfung: jede Verfälschung wird erkannt
  const mut = (f) => { const d = klon(daten); f(d); return pruefe(d).length > 0; };
  ok(mut((d) => { d.format = 'x'; }), 'falsches Format abgelehnt');
  ok(mut((d) => { d.figuren.pop(); }), 'nur zwei Figuren abgelehnt');
  ok(mut((d) => { d.figuren.push(klon(d.figuren[0])); }), 'vier Figuren abgelehnt');
  ok(mut((d) => { d.figuren[1].botId = 'b0'; }), 'doppelte botId abgelehnt');
  ok(mut((d) => { d.figuren[1].botId = 'x'; }), 'botId falscher Form abgelehnt');
  ok(mut((d) => { d.figuren[1].name = 'livia'; d.figuren[1].karte.name = 'livia'; }), 'doppelter Name (Groß/klein egal) abgelehnt');
  ok(mut((d) => { d.figuren[1].name = 'X'; d.figuren[1].karte.name = 'X'; }), 'zu kurzer Name abgelehnt');
  ok(mut((d) => { d.figuren[1].name = 'Cassius<b>'; }), 'Name mit Sonderzeichen abgelehnt');
  ok(mut((d) => { d.figuren[2].karte.name = 'Anders'; }), 'Kartenname ungleich Figurname abgelehnt');
  ok(mut((d) => { d.figuren[2].karte.frisur = 'gibtsnicht'; }), 'unbekanntes Teil (Karte besteht pruefeKarte nicht) abgelehnt');
  ok(mut((d) => { d.figuren[2].karte.haar = 99; }), 'Farbindex außerhalb abgelehnt');
  ok(mut((d) => { delete d.figuren[2].karte.outfit.umhang; }), 'Karte mit fehlendem Feld abgelehnt');
  ok(mut((d) => { d.figuren[2].stimme = 'b9'; }), 'Stimme ohne Eintrag in stimmen.json abgelehnt');
  ok(mut((d) => { d.figuren[2].stimme = 'b1'; }) && pruefe((() => { const d = klon(daten); d.figuren[2].stimme = 'b1'; return d; })()).some((x) => /nicht die botId/.test(x)), 'Stimme einer anderen Figur (b2 mit Stimme b1, in stimmen.json vorhanden) abgelehnt: Stimme muss = botId sein');
  ok(mut((d) => { d.figuren[0].persoenlichkeit = ' '; }), 'leere Persönlichkeit abgelehnt');
  ok(mut((d) => { delete d.figuren[0].karte; }), 'fehlende Karte abgelehnt');
  const kat2 = klon(katalog); kat2.teile.find((t) => t.id === 'oberteil/robe').herkunft = 'gesperrt';
  ok(BotFiguren.pruefeFiguren(daten, kat2, stimmen).some((x) => /nicht frei/.test(x)), 'nicht freies Teil (herkunft gesperrt) abgelehnt');
  ok(pruefe(null).length > 0 && pruefe({}).length > 0 && BotFiguren.pruefeFiguren(daten, katalog, null).length > 0, 'null, leeres Objekt, fehlende stimmen: Fehler statt Absturz');
}

// ---------- 2 Figuren ----------
section('2 Die Stammcrew: Livia, Cassius, Titus');
{
  const F = Object.fromEntries(daten.figuren.map((f) => [f.botId, f]));
  ok(daten.figuren.map((f) => f.botId).join() === 'b0,b1,b2' && daten.figuren.map((f) => f.name).join() === 'Livia,Cassius,Titus', 'Reihenfolge b0 Livia, b1 Cassius, b2 Titus');
  ok(F.b0.stimme === 'b0' && F.b1.stimme === 'b1' && F.b2.stimme === 'b2', 'Stimme je Figur = ihr Schlüssel in stimmen.json (b0 C2, b1 M2, b2 M3)');
  ok(F.b0.persoenlichkeit === 'Die Älteste an Bord, fuhr lange Fracht im Sund. Spricht ruhig und knapp und wird bei Gefahr eher leiser als lauter. Greift gern zu Seemannsbildern („Wind von Backbord“). Dem Captain gegenüber loyal: Hält sie eine Entscheidung für falsch, sagt sie das einmal offen und folgt dann.', 'Livia: Persönlichkeit wörtlich');
  ok(F.b1.persoenlichkeit === 'Früher Schreiber in einer Flottenkanzlei, präzise und trocken. Nennt lieber Zahlen als Eindrücke, sein Humor ist so trocken, dass man ihn leicht überhört. Korrigiert Ungenauigkeiten, auch beim Captain. Respektiert den Rang, das Vertrauen in die Person muss der Captain sich verdienen.', 'Cassius: Persönlichkeit wörtlich');
  ok(F.b2.persoenlichkeit === 'Der Jüngste, auf seiner ersten großen Fahrt. Neugierig, schnell begeistert, redet zu viel, wenn er nervös ist. Will über jedes fremde Schiff alles wissen. Bewundert den Captain offen und will sich beweisen.', 'Titus: Persönlichkeit wörtlich');
  ok(Object.isFrozen(Figuren.FIGUREN) && Figuren.figurMitId('b1').name === 'Cassius' && Figuren.figurMitId('b3') === null, 'Loader: eingefroren, figurMitId, b3 ist keine Figur');
  ok(Figuren.erstFreieFigur([]).botId === 'b0' && Figuren.erstFreieFigur(['b0']).botId === 'b1' && Figuren.erstFreieFigur(new Set(['b0', 'b2'])).botId === 'b1' && Figuren.erstFreieFigur(['b0', 'b1', 'b2']) === null, 'erstFreieFigur: Dateireihenfolge, null wenn alle belegt');
}

// Partie in der Lobby mit Bots in gegebener Rollenreihenfolge; liefert botId -> Zustand des Bots
function partie(rollen) {
  const g = neu(), c = mensch(g, 0, 0);
  for (const r of rollen) bot(g, c, 'add', { rolle: r });
  const m = {};
  for (const b of botsVon(g)) m[b.botId] = { name: b.name, karte: klon(b.karte), stimme: b.stimme, rolle: b.rolle, id: b.id };
  return { g, c, m };
}

// ---------- 3 Persistenz ----------
section('3 Persistenz: gleiche Figuren in jeder Partie');
{
  const a = partie(['navigation', 'ops', 'technik']);
  const b = partie(['technik', 'navigation', 'ops']);
  const c2 = partie(['ops', 'technik', 'navigation']);
  ok(Object.keys(a.m).join() === 'b0,b1,b2' && Object.keys(b.m).join() === 'b0,b1,b2' && Object.keys(c2.m).join() === 'b0,b1,b2', 'je Partie drei Bots mit botId b0, b1, b2');
  ok(a.m.b0.rolle === 'navigation' && b.m.b0.rolle === 'technik' && c2.m.b0.rolle === 'ops', 'die Rollenreihenfolge war tatsächlich verschieden (b0: navigation, technik, ops)');
  for (const id of ['b0', 'b1', 'b2']) {
    const f = Figuren.figurMitId(id);
    ok(a.m[id].name === b.m[id].name && b.m[id].name === c2.m[id].name && a.m[id].name === f.name, id + ': derselbe Name in drei Partien (' + a.m[id].name + ')');
    ok(JSON.stringify(a.m[id].karte) === JSON.stringify(b.m[id].karte) && JSON.stringify(b.m[id].karte) === JSON.stringify(c2.m[id].karte) && JSON.stringify(a.m[id].karte) === JSON.stringify(f.karte), id + ': dieselbe Karte (tief gleich, auch zur Datei)');
    ok(a.m[id].stimme === b.m[id].stimme && b.m[id].stimme === c2.m[id].stimme && a.m[id].stimme === f.stimme, id + ': dieselbe Stimme (' + a.m[id].stimme + ')');
  }
  ok(a.m.b0.id === 'p2' && b.m.b0.id === 'p2', 'die Figur hängt nicht an der Rolle: b0 sitzt in beiden Partien auf p2, in der zweiten mit anderer Rolle');
  // Ereignis karte geht mit der festen Karte raus
  const ev = karten(a.c).filter((m) => m.pid === 'p2');
  ok(ev.length === 1 && JSON.stringify(ev[0].k) === JSON.stringify(Figuren.figurMitId('b0').karte), 'Ereignis karte: einmal, mit der Karte der Figur');
  // die Karte der Figur ist eine Kopie: Änderung an der Spielkarte ändert die Datei nicht
  const bb = botsVon(a.g)[0]; bb.karte.outfit.kopf = 'galea'; bb.karte.name = 'Zerstört';
  const d = partie(['navigation']);
  ok(d.m.b0.name === 'Livia' && JSON.stringify(d.m.b0.karte) === JSON.stringify(daten.figuren[0].karte) && daten.figuren[0].karte.outfit.kopf === 'keine', 'Änderung an der Karte eines Bots wirkt nicht auf die Figur (Kopie)');
  // Spielstart: die Figuren bleiben
  const e = partie(['ops', 'navigation']);
  e.g.handleMessage(e.c, { t: 'lobbyOpt', startMission: 'freie_fahrt' }); e.g.handleMessage(e.c, { t: 'ready', ready: true });
  ok(e.g.phase === 'play' && botsVon(e.g).map((x) => x.botId + ':' + x.name + ':' + x.stimme).join() === 'b0:Livia:b0,b1:Cassius:b1', 'nach dem Start in der Partie: Figuren, Namen, Stimmen unverändert');
}

// ---------- 4 erste freie Figur ----------
section('4 Erste freie Figur, Freigabe beim Räumen');
{
  const g = neu(), c = mensch(g, 0, 0);
  bot(g, c, 'add', { rolle: 'technik' }); bot(g, c, 'add', { rolle: 'ops' }); bot(g, c, 'add', { rolle: 'navigation' });
  ok(botsVon(g).map((b) => b.botId + ':' + b.rolle).join() === 'b0:technik,b1:ops,b2:navigation', 'drei Bots: b0, b1, b2 in Hinzufüge-Reihenfolge, unabhängig von der Rolle');
  bot(g, c, 'weg', { pid: 'p2' });   // b0 (technik) geht
  bot(g, c, 'add', { rolle: 'technik' });
  const neuer = botsVon(g).find((b) => b.rolle === 'technik');
  ok(neuer.botId === 'b0' && neuer.name === 'Livia' && neuer.id === 'p2' && JSON.stringify(neuer.karte) === JSON.stringify(Figuren.figurMitId('b0').karte), 'nach Räumen von b0 bekommt der nächste neue Bot wieder b0 (Livia, gleiche Karte)');
  bot(g, c, 'weg', { pid: 'p3' });   // b1 (ops) geht
  bot(g, c, 'weg', { pid: 'p4' });   // b2 (navigation) geht
  bot(g, c, 'add', { rolle: 'navigation' });
  ok(botIds(g) === 'b0,b1', 'zwei Bots weg: der nächste nimmt b1 (b0 ist belegt), nicht b2 (' + botIds(g) + ')');
  bot(g, c, 'add', { rolle: 'ops' });
  ok(botIds(g) === 'b0,b1,b2', 'wieder voll: b0, b1, b2');
  const n0 = notices(c).length;
  bot(g, c, 'add', { rolle: 'ops' });
  ok(botsVon(g).length === 3 && notices(c).length === n0 + 1 && !botsVon(g).some((b) => b.botId === 'b3'), 'weiterer Bot: abgelehnt (keine Figur mehr frei, notice), b3 wird nie vergeben');
}
{
  // Verdrängen räumt den zuletzt hinzugefügten Bot; seine Figur wird frei
  const g = neu(), c = mensch(g, 0, 0);
  bot(g, c, 'add', { rolle: 'navigation' }); bot(g, c, 'add', { rolle: 'ops' }); bot(g, c, 'add', { rolle: 'technik' });
  const c2 = mensch(g, 1, 3);   // Lobby voll: der zuletzt hinzugefügte Bot (b2) räumt
  ok(botIds(g) === 'b0,b1' && c2.player && !c2.player.bot, 'Verdrängen in der Lobby: der letzte Bot (b2) räumt, b0 und b1 bleiben');
  g.removeConnection(c2);
  bot(g, c, 'add', { rolle: 'technik' });
  ok(botIds(g) === 'b0,b1,b2' && botsVon(g).find((b) => b.rolle === 'technik').botId === 'b2', 'der neue Bot bekommt die frei gewordene Figur b2 (' + botIds(g) + ')');
}

// ---------- 5 Würfeln ----------
section('5 Würfeln ändert nichts');
{
  const g = neu(), c = mensch(g, 0, 0);
  bot(g, c, 'add', { rolle: 'ops' }); bot(g, c, 'add', { rolle: 'navigation' });
  const zustand = () => JSON.stringify(botsVon(g).map((b) => [b.id, b.botId, b.name, b.karte, b.stimme, b.rolle, b.color]));
  const vorher = zustand();
  const k0 = karten(c).length, n0 = notices(c).length;
  for (let i = 0; i < 5; i++) bot(g, c, 'wuerfeln', { pid: 'p2' });
  bot(g, c, 'wuerfeln', { pid: 'p3' }); bot(g, c, 'wuerfeln', { pid: 'p1' }); bot(g, c, 'wuerfeln', {}); bot(g, c, 'wuerfeln');
  ok(zustand() === vorher, 'nach 9 wuerfeln-Nachrichten: Bots (Name, Karte, Stimme, Rolle, Farbe) unverändert');
  ok(karten(c).length === k0 && notices(c).length === n0 + 9, 'keine neue Ereignis karte, jede wuerfeln-Nachricht wie eine ungültige op mit notice beantwortet');
  ok(c.player.name === 'K0' && !('bot' in c.player), 'der Mensch bleibt unberührt');
  const src = ['server/bots/spieler.js', 'public/js/client.js', 'public/js/menue-ui.js', 'public/js/menue.js'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  ok(!/botWuerfeln|op: 'wuerfeln'|T\.bot\.wuerfeln|wuerfeln: 'Würfeln'/.test(src), 'Quellscan: weder Server noch Client kennen botWuerfeln oder den Würfeln-Knopf');
  ok(!fs.existsSync('content/bots/namen.json'), 'content/bots/namen.json ist entfernt (die Namen gehören den Figuren)');
}

// ---------- 6 Namenskollision ----------
section('6 Kollision mit einem Menschen: der Mensch behält seinen Namen');
{
  const g = neu(), c = mensch(g, 0, 0, 'Livia');
  ok(c.player.name === 'Livia', 'der Mensch heißt Livia');
  bot(g, c, 'add', { rolle: 'navigation' });
  const b = botsVon(g)[0];
  ok(c.player.name === 'Livia' && b.botId === 'b0' && b.name === 'Livia 2' && b.karte.name === 'Livia 2', 'der Mensch behält Livia, der Bot (b0) wird Livia 2 (Name und Kartenname)');
  ok(JSON.stringify(Object.assign({}, b.karte, { name: 'Livia' })) === JSON.stringify(Figuren.figurMitId('b0').karte), 'außer dem Namen ist die Karte die der Figur');
  ok(daten.figuren[0].name === 'Livia' && daten.figuren[0].karte.name === 'Livia', 'die Figurendatei bleibt unverändert');
}

// ---------- 7 reine Menschenpartie ----------
section('7 Reine Menschenpartie unverändert');
{
  const FELDER = ['bot', 'rolle', 'botId', 'stimme', 'persoenlichkeit', 'figur'];
  const tief = (x, pfad, out, seen) => {
    if (x === null || typeof x !== 'object' || seen.has(x)) return out; seen.add(x);
    for (const k of Object.keys(x)) {
      if (k === 'conn' || k === 'game') continue;
      if (FELDER.includes(k)) out.push(pfad + '.' + k);
      tief(x[k], pfad + '.' + k, out, seen);
    }
    return out;
  };
  const g = neu(), c1 = mensch(g, 0, 0), c2 = mensch(g, 1, 1);
  g.handleMessage(c1, { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  const lobbySnap = g.snapshot();
  g.handleMessage(c1, { t: 'ready', ready: true }); g.handleMessage(c2, { t: 'ready', ready: true });
  for (let k = 0; k < 60; k++) g.step();
  const snap = g.snapshot();
  const funde = [].concat(tief(g.players, 'players', [], new Set()), tief(lobbySnap, 'lobbySnap', [], new Set()), tief(snap, 'snap', [], new Set()));
  ok(g.phase === 'play' && funde.length === 0, 'ohne Bots: weder Spieler noch Snapshot (Lobby und Partie) tragen bot, rolle, botId, stimme, persoenlichkeit oder figur ' + funde.join(','));
  ok([c1, c2].every((c) => FELDER.every((f) => !(f in c.player))), 'die Spielerobjekte der Menschen tragen keines der Felder');
  ok(!/botId|stimme|persoenlichkeit/.test(JSON.stringify(snap)) && !/botId|stimme|persoenlichkeit/.test(JSON.stringify(lobbySnap)), 'Snapshot (JSON) enthält keines der Wörter botId, stimme, persoenlichkeit');
  // mit Bot: seit A2 trägt der Snapshot botId (nur bei Bots), aber weiter keine Stimme und keine Persönlichkeit (test-bot-namen)
  const h = neu(), d = mensch(h, 0, 0); bot(h, d, 'add', { rolle: 'ops' });
  const sj = JSON.stringify(h.snapshot());
  ok(/"botId":"b0"/.test(sj) && !/stimme|persoenlichkeit/.test(sj), 'mit Bot: Snapshot trägt botId (A2), Stimme und Persönlichkeit nicht');
}

console.log('\ntest-bot-figuren: ' + (n - fails) + '/' + n + ' ok');
if (fails) { console.log(fails + ' FEHLER'); process.exit(1); }
