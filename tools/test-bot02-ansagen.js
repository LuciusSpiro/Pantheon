'use strict';
// BOT-02 B4: Ansagen des Bord-Bots an den Menschen unten (server/bots/ansagen.js; Einhaengepunkt mannschaft.js bordDienst; ODA-Schweigen away.js ueber weichen.js bordBotHaelt; Client hud.js Sprechspalte, bot-menue.js, bot-sprache.js).
// Echtes Game, Server-Bots, Testgelaende Ruine (arena_away, v2-Karte mit Raetselpaar) und Plattform (Kustodenpult, Handkarte).
//   1. Texte und Vertrag: textIds ohne Argumente, Texte in texte.json, hoechstens 90 Zeichen (Hoechstfaelle), Form der Nachricht, kein Clip-Vorrat, keine Spielernamen (Quellscan)
//   2. Codefolge: der Bord-Bot sagt sie an (einmal je Karte), die ODA schweigt; ohne Bord-Bot funkt die ODA wie bisher; mit Mensch an Bord unveraendert; nur wenn die Hilfe im Dienst ausgeloest wurde
//   3. Gegner: nur was das Team kennt und der Mensch unten nicht selbst sieht; Richtung und Entfernung; nur bei Neuzugang oder geaenderter Zahl; nie dasselbe zweimal in 30 s; verborgene Gegner bleiben verborgen
//   4. Raetselhinweis: bei einem ungeloesten Schloss, einmal je Paar; solo nacheinander mit Fenster, in der Gruppe gleichzeitig
//   5. Haeufigkeit: hoechstens eine Ansage je 8 s je Empfaenger, ueber alle Arten
//   6. Nur im laufenden Bord-Dienst; keine Wirkung auf die Befehlsannahme (Rate, Antworten)
//   7. Client: Sprechspalte 3 Eintraege nur mit Bots (sonst unveraendert 2); Ansage ohne Quittung/gilt, Sprecher BORD, kein Clip
//   8. Reine Menschenpartie byte-gleich (auch Plattform mit Mensch unten: ODA funkt wie bisher) gegen den Basisstand 0b548f01
//   node tools/test-bot02-ansagen.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Arena = require('../server/sim/arena.js');
const interior = require('../server/sim/interior.js');
const away = require('../server/sim/away.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const W = require('../server/world.js');
const BotSpieler = require('../server/bots/spieler.js');
const Lauf = require('../server/bots/lauf.js');
const Ansagen = require('../server/bots/ansagen.js');
const Protocol = require('../shared/protocol.js');
const Buehne = require('../shared/buehne.js');
const TEXTE = require('../content/bots/texte.json');
const Clips = require('./bot-clips.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-bot02ans-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;
const T = 32;

// ---------- Aufbau ----------
// o.menschen (1), o.unten: wie viele der Menschen unten sind (1), o.bots: Rollen, o.karte: 'ruine' (v2, Raetselpaar) | 'platform' (Kustodenpult, Handkarte)
function partie(o) {
  o = o || {};
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, seed: o.seed || 9, debug: true, worldDir: dir, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const conns = [];
  for (let i = 0; i < (o.menschen || 1); i++) {
    const c = { box: [], send(m) { this.box.push({ t: g.time, m }); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A' + i, name: 'A' + i, color: i }); conns.push(c);
  }
  for (const r of o.bots === undefined ? ['navigation', 'ops', 'technik'] : o.bots) BotSpieler.botHinzufuegen(g, null, r);
  for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  Arena.start(g, 'arena_away', { art: 'ruine', seed: 1 });
  const unten = o.unten == null ? 1 : o.unten;
  conns.forEach((c, i) => { if (i >= unten) interior.placeOnShipPad(g, c.player); });
  for (const p of g.players) if (p.bot) interior.placeOnShipPad(g, p);
  const oda = []; const echt = g.oda.bind(g); g.oda = (t, ...r) => { oda.push({ t: g.time, text: String(t) }); return echt(t, ...r); };
  const P = { g, conns, c: conns[0], h: conns[0].player, oda };
  if (o.karte === 'platform') {
    g.away = g.aways.platform; g.away.active = true; g.away.odaCodeHelp = false; g.away.noHumanT = 0;
    const pad = W.AWAY_MAPS.platform.pads[0]; const c = W.tileCenter(pad.x, pad.y);
    for (const c2 of conns.slice(0, unten)) { c2.player.x = c.x; c2.player.y = c.y; }
  }
  return P;
}
const tick = (P) => { P.g.step(); if (P.g.wantsSnapshot()) P.g.snapshot(); };
const lauf = (P, sek, bis) => { const t1 = P.g.time + sek; while (P.g.time < t1) { tick(P); if (bis && bis()) return true; } return bis ? !!bis() : true; };
const ans = (c, ab) => c.box.filter((e) => e.m.t === Protocol.C.BOT_ANTWORT && e.m.befehl === 'bord.ansage' && e.t >= (ab || 0));
const botVon = (P, rolle) => P.g.players.find((p) => p.bot && p.rolle === rolle);
const odaCode = (P) => P.oda.filter((o) => /Codetabelle/.test(o.text));   // die ODA spricht auch sonst (Tutorial): nur die Codehilfe zaehlt
const dienst = (P) => { const b = Lauf.bordBot(P.g); return !!b && Lauf.dienstLaeuft(P.g, b); };
// Gegner wie das Team ihn kennt: schlafend und eingefroren (keine KI), ueber den Sensor (aw.sensorUntil) fuer das Team sichtbar
let gId = 0;
function gegner(P, dx, dy, o) {
  o = o || {};
  const aw = P.g.away, h = P.h;
  const e = squad.makeEnemy(P.g, aw, 'scavenger', 'T' + (++gId), { x: h.x + dx * T, y: h.y + dy * T }, 'test');
  e.asleep = true; e.frozen = true;
  aw.drones.push(e);
  return e;
}
const sensor = (P, an) => { P.g.away.sensorUntil = an ? P.g.time + 1e6 : 0; };
const warteBisAnsage = (P, c, sek) => lauf(P, sek, () => ans(c).length > 0);

// ---------- 1 Texte und Vertrag ----------
section('1 Texte und Vertrag');
{
  const ARTEN = ['code', 'gegner', 'raetsel'];
  const ids = ARTEN.map((a) => 'bord.ansage.' + a);
  ok(ids.every((id) => Array.isArray(TEXTE[id]) && TEXTE[id].length >= 2 && TEXTE[id].every((t) => typeof t === 'string' && t.length > 5)), 'texte.json: bord.ansage.code|gegner|raetsel je mindestens 2 Varianten');
  ok(Object.keys(TEXTE).filter((k) => /^bord[.]ansage[.]/.test(k)).every((k) => ids.includes(k)), 'keine weiteren bord.ansage-textIds; die textId nennt nie ein Argument (nur die Art)');
  ok(TEXTE['bord.ansage.code'].every((t) => t.includes('{FOLGE}')) && TEXTE['bord.ansage.gegner'].every((t) => t.includes('{LAGE}')) && TEXTE['bord.ansage.raetsel'].every((t) => t.includes('{HINWEIS}')), 'Vorlagen tragen ihren Platzhalter (FOLGE, LAGE, HINWEIS)');
  ok(Clips.OHNE_CLIP.test('bord.ansage.code') && !Clips.OHNE_CLIP.test('nav.kurs.ok'), 'Clip-Vorrat: bord.ansage.* ist ohne Clip (Untertitel), die ok-Texte der Befehle bleiben im Vorrat');
  // Hoechstfaelle: Codefolge ueber alle Tabellen und Symbolwahlen; Lage mit vielen Gruppen; Raetselhinweis
  const roh = (v, w) => v.split('{' + Object.keys(w)[0] + '}').join(Object.values(w)[0]);   // Vorlage gefuellt, OHNE die Kappung auf 90 Zeichen: die Vorlagen selbst muessen passen
  const SYM = Protocol.CODE_SYMBOLS, COL = Protocol.CODE_COLORS;
  let maxCode = 0, text = '';
  const perm = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perm(a.slice(0, i).concat(a.slice(i + 1))).map((r) => [x].concat(r))));
  const farben = perm(COL);
  for (const f of farben.filter((_, i) => i % 7 === 0)) {
    const tab = {}; SYM.forEach((s, i) => { tab[s] = f[i]; });
    for (const a of SYM) for (const b of SYM) for (const c of SYM) {
      if (a === b || b === c || a === c) continue;
      const folge = Ansagen.codeFolge({ codeTable: tab, kustodenpult: { symbols: [a, b, c] } });
      for (const v of TEXTE['bord.ansage.code']) { const t = roh(v, { FOLGE: folge }); if (t.length > maxCode) { maxCode = t.length; text = t; } }
    }
  }
  ok(maxCode > 0 && maxCode <= 90, `Codefolge: laengster Text ${maxCode} Zeichen (<= 90): ${text}`);
  const viele = []; for (let i = 0; i < 8; i++) viele.push({ id: 'x' + i, x: Math.cos(i * Math.PI / 4) * 900, y: Math.sin(i * Math.PI / 4) * 900 + i * 7 });
  const l = Ansagen.lage({ x: 0, y: 0 }, viele);
  ok(l.length + 14 <= 90 && TEXTE['bord.ansage.gegner'].every((v) => roh(v, { LAGE: l }).length <= 90), `Lage mit acht Richtungen: ${l.length} Zeichen, mit Vorsilbe <= 90`);
  ok(Ansagen.fuelle('{LAGE}', { LAGE: 'x'.repeat(200) }).length === 90, 'ein zu langer Text wird auf 90 Zeichen begrenzt');
  const hmax = [Buehne.raetselHinweis(true, 9999) + '.', Buehne.raetselHinweis(false)];
  ok(TEXTE['bord.ansage.raetsel'].every((v) => hmax.every((h) => roh(v, { HINWEIS: h }).length <= 90)), 'Raetselhinweis solo und Gruppe: <= 90');
  ok(TEXTE['bord.ansage.code'].concat(TEXTE['bord.ansage.gegner'], TEXTE['bord.ansage.raetsel']).every((t) => !/[0-9]/.test(t) && !/name/i.test(t)), 'Vorlagen: keine Ziffer, kein Name');
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'ansagen.js'), 'utf8').split(/\r?\n/).map((z) => z.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, '')).join('\n');   // ohne Kommentare (CRLF der Arbeitskopie oder LF)
  ok(!/\.name\b/.test(quelle) && !/Math\.random|game\.rng|llm/i.test(quelle), 'Quellscan ansagen.js: kein Spielername, kein Zufall, kein LLM');
  ok(!/annahme\.js|rateStand|require\('\.\/lauf\.js'\)/.test(quelle), 'Quellscan ansagen.js: geht nicht durch annahme.js (Rate, Varianten) und kennt den Lauf nicht');
  ok(/^\s*Ansagen\.tick\(this\.game, this\.spieler\);/m.test(fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'mannschaft.js'), 'utf8')), 'mannschaft.js: genau der eine Einhaengepunkt in bordDienst');
}

// ---------- 2 Codefolge und ODA ----------
section('2 Codefolge: der Bord-Bot sagt sie an, die ODA schweigt; ohne Bord-Bot funkt die ODA wie bisher');
{
  const folgeSoll = (g) => { const a = g.away; return a.kustodenpult.symbols.map((s) => ({ kreis: 'Kreis', dreieck: 'Dreieck', raute: 'Raute', stern: 'Stern', welle: 'Welle', kreuz: 'Kreuz' }[s] + ' ' + { mint: 'Mint', bernstein: 'Bernstein', rot: 'Rot', blau: 'Blau', pink: 'Pink', weiss: 'Weiß' }[a.codeTable[s]])).join(', '); };
  const VERZ = 20;
  {
    const P = partie({ karte: 'platform' });
    ok(lauf(P, 8, () => dienst(P)) && dienst(P), 'Ausgangslage: Mensch unten, der Bord-Bot haelt den Dienst');
    lauf(P, VERZ - 6);
    ok(!P.g.away.odaCodeHelp && ans(P.c).length === 0 && odaCode(P).length === 0, 'vor odaCodeHelpDelay: weder Hilfe noch Ansage noch ODA');
    lauf(P, 12);
    const a = ans(P.c);
    ok(P.g.away.odaCodeHelp === true, 'die Codehilfe ist ausgeloest (das Kustodenpult zeigt die Tabelle wie bisher)');
    ok(odaCode(P).length === 0, 'die ODA schweigt, solange ein Bord-Bot den Dienst haelt');
    ok(a.length === 1, 'genau eine Ansage (' + a.length + ')');
    const m = a[0] && a[0].m;
    ok(m && m.t === 'bot.antwort' && m.befehl === 'bord.ansage' && m.status === 'ok' && m.botId === null && m.textId === 'bord.ansage.code' && typeof m.text === 'string' && m.text === TEXTE['bord.ansage.code'][m.variante].replace('{FOLGE}', folgeSoll(P.g)), 'Form: bot.antwort, befehl bord.ansage, status ok, botId null, textId bord.ansage.code, text = Vorlage mit der Folge: ' + (m && m.text));
    ok(m && m.text.length <= 90 && /^[\x20-\x7EÀ-ſ„“]+$/.test(m.text), 'hoechstens 90 Zeichen, echte Umlaute, keine Steuerzeichen');
    ok(a[0] && a[0].t >= P.g.away.noHumanT - 1 && a[0].t - 8 < VERZ + 2, 'zeitlich beim Ereignis der ODA (nach odaCodeHelpDelay)');
    lauf(P, 60);
    ok(ans(P.c).filter((e) => e.m.textId === 'bord.ansage.code').length === 1, 'einmal je Karte: auch 60 s spaeter nicht noch einmal');
    // neue Karte (neue Tabelle): wieder genau einmal
    const neue = away.makeAway(P.g, { salt: 3 }); neue.active = true; P.g.aways.platform = neue; P.g.away = neue;
    const pad = W.AWAY_MAPS.platform.pads[0]; const c = W.tileCenter(pad.x, pad.y); P.h.x = c.x; P.h.y = c.y;
    lauf(P, VERZ + 8);
    const codes = ans(P.c).filter((e) => e.m.textId === 'bord.ansage.code');
    ok(codes.length === 2 && codes[1].m.text.includes(folgeSoll(P.g)), 'neue Karte (neue Tabelle): wieder genau eine Ansage, mit der neuen Folge');
    ok(P.g.errors === 0, 'game.errors 0');
  }
  {
    const P = partie({ karte: 'platform', bots: [] });
    lauf(P, VERZ + 6);
    ok(P.g.away.odaCodeHelp && odaCode(P).length === 1 && ans(P.c).length === 0, 'ohne Bots: die ODA funkt wie bisher, keine Ansage');
  }
  {
    const P = partie({ karte: 'platform', menschen: 2, unten: 1 });
    lauf(P, VERZ + 6);
    ok(!P.g.away.odaCodeHelp && odaCode(P).length === 0 && ans(P.c).length === 0, 'ein Mensch an Bord (mit Bots): unveraendert, keine Codehilfe, keine ODA, keine Ansage');
  }
  {
    // Nur ein Bot unten, kein Mensch verbunden: kein Dienst (der Bord-Bot dient einem Menschen unten), die ODA funkt wie bisher
    const P = partie({ karte: 'platform', unten: 0 });
    P.h.connected = false;
    const ops = botVon(P, 'ops'); const pad = W.AWAY_MAPS.platform.pads[0]; const c = W.tileCenter(pad.x, pad.y);
    ops.zone = 'away'; ops.x = c.x; ops.y = c.y;
    lauf(P, VERZ + 6);
    ok(Lauf.bordBot(P.g) && !dienst(P) && P.g.away.odaCodeHelp && odaCode(P).length === 1 && P.conns.every((cc) => ans(cc).length === 0), 'nur ein Bot unten, kein Mensch: ein Bord-Bot waere da, aber kein Dienst - die ODA funkt wie bisher');
  }
  {
    // Hilfe schon vor dem ersten Blick des Dienstes da (z. B. von der ODA frueher): nicht noch einmal vorlesen
    const P = partie({ karte: 'platform' });
    P.g.away.odaCodeHelp = true;
    lauf(P, 12);
    ok(ans(P.c).length === 0 && odaCode(P).length === 0, 'Hilfe war vor dem Dienst schon da: keine Ansage, keine ODA');
  }
  {
    // Ein Mensch an der Transfer-Konsole: der Dienst ruht, nichts wird angesagt
    const P = partie({ karte: 'platform', menschen: 2, unten: 1 });
    interior.enterConsole(P.g, P.conns[1].player, 'transfer');
    lauf(P, VERZ + 6);
    ok(!dienst(P) && ans(P.c).length === 0, 'Mensch am Transfer: Dienst ruht, keine Ansage');
  }
}

// ---------- 3 Gegner ----------
section('3 Gegner: nur was das Team kennt und der Mensch nicht selbst sieht');
{
  const P = partie({});
  const { g, h, c } = P;
  ok(lauf(P, 8, () => dienst(P)) && dienst(P) && combat.isV2(g), 'Ausgangslage: Ruine (v2), Mensch unten, Bord-Dienst laeuft');
  // verborgener Gegner: weit weg, nicht sichtbar (kein Sensor): nichts, kein Leck
  const fern = gegner(P, 14, 0);
  lauf(P, 10);
  ok(ans(c).length === 0, 'ein Gegner, den das Team nicht kennt (nicht sichtbar, kein Sensor): keine Ansage (Nebel bleibt)');
  // Sensor: jetzt kennt das Team ihn, der Mensch sieht ihn nicht (14 Kacheln)
  sensor(P, true);
  const t0 = g.time;
  ok(warteBisAnsage(P, c, 6), 'Sensor an, Gegner 14 Kacheln im Osten: Ansage');
  const a = ans(c);
  ok(a.length === 1 && a[0].m.textId === 'bord.ansage.gegner' && /Ein Gegner im Osten, etwa 14 Meter\./.test(a[0].m.text) && a[0].m.text.length <= 90, 'Text: ' + (a[0] && a[0].m.text));
  ok(a[0] && a[0].m.botId === null && a[0].m.befehl === 'bord.ansage' && a[0].m.status === 'ok', 'Form wie bei der Codefolge');
  const tErst = a[0] ? a[0].t : 0;
  lauf(P, 40);
  ok(ans(c).length === 1, 'derselbe Gegner, nichts Neues: auch nach 40 s keine Wiederholung (ueber die 30 s hinaus)');
  // Gegner, den der Mensch selbst sieht: nicht ansagen
  let nah = null;
  for (let r = 2; r <= 6 && !nah; r++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) { if (combat.gesehenVonSpieler(g, h, { x: h.x + dx * r * T, y: h.y + dy * r * T })) { nah = [dx * r, dy * r]; break; } }
  ok(!!nah, 'Aufbau: eine Kachel in Sicht des Menschen gefunden ' + JSON.stringify(nah));
  const n0 = ans(c).length;
  if (nah) { gegner(P, nah[0], nah[1]); lauf(P, 12); }
  ok(ans(c).length === n0, 'ein Gegner in Sicht des Menschen (auch vom Sensor erfasst): keine Ansage');
  ok(g.away.drones.filter((d) => d.alive !== false && d.vis).length >= 2, 'Kontrolle: beide Gegner sind fuers Team sichtbar (vis), nur der ferne wird angesagt');
  // Neuzugang: zweiter ferner Gegner, 8-s-Grenze beachten
  const tNeu = g.time;
  const zweiter = gegner(P, 15, 1);
  lauf(P, 3);
  ok(ans(c, tNeu).length === 0 || tNeu - tErst >= 8, 'Neuzugang: bei weniger als 8 s Abstand zur letzten Ansage noch keine zweite');
  lauf(P, 12);
  const neu = ans(c, tNeu);
  ok(neu.length === 1 && /Zwei Gegner im Osten, etwa 14 Meter\./.test(neu[0].m.text), 'Neuzugang: Zahl aendert sich -> eine Ansage mit der neuen Zahl: ' + (neu[0] && neu[0].m.text));
  // Richtungen
  for (const [dx, dy, name] of [[0, -13, 'Norden'], [0, 13, 'Süden'], [-13, 0, 'Westen'], [13, -13, 'Nordosten'], [-13, 13, 'Südwesten']]) {
    ok(Ansagen.kompass({ x: 0, y: 0 }, { x: dx * T, y: dy * T }) === name, `Richtung ${name} (Norden ist oben, y wird kleiner)`);
  }
  ok(Ansagen.meter(12 * T) === 12 && Ansagen.meter(14.4 * T) === 14 && Ansagen.meter(3.4 * T) === 3 && Ansagen.meter(5) === 1, 'Meter = Kacheln (1 Kachel = 1 m), ab 10 auf 2 gerundet, mindestens 1');
  ok(g.errors === 0, 'game.errors 0');
  // 30-s-Regel: Gegner weg und dieselbe Lage wieder -> dieselbe Meldung nie zweimal binnen 30 s
  {
    const Q = partie({});
    lauf(Q, 8, () => dienst(Q)); sensor(Q, true);
    const tot = () => { for (const d of Q.g.away.drones) if (d.id.startsWith('T')) d.alive = false; };
    gegner(Q, 14, 0);
    lauf(Q, 6, () => ans(Q.c).length > 0);
    const t1 = ans(Q.c)[0] ? ans(Q.c)[0].t : -1;
    tot(); lauf(Q, 9);
    gegner(Q, 14, 0);   // neue Lage-Kennung, derselbe Text (ein Gegner im Osten, 14 m), 9 s nach der Meldung
    lauf(Q, 15);
    ok(t1 >= 0 && ans(Q.c).length === 1, 'dieselbe Lage nach 9 s wieder (24 s nach der Meldung): nicht noch einmal (30-s-Regel)');
    tot(); lauf(Q, 8);
    gegner(Q, 14, 0);   // 32 s nach der Meldung
    lauf(Q, 4);
    ok(ans(Q.c).length === 2 && ans(Q.c)[1].t - t1 >= 30 && ans(Q.c)[1].m.text.includes('Ein Gegner im Osten, etwa 14 Meter.'), 'nach Ablauf der 30 s darf dieselbe Lage wieder gemeldet werden');
  }
}
{
  // Plattform (Handkarte): alle Gegner fuer alle sichtbar, nichts anzusagen
  const P = partie({ karte: 'platform' });
  P.g.away.sensorUntil = 1e9;
  lauf(P, 12);
  ok(ans(P.c).filter((e) => e.m.textId === 'bord.ansage.gegner').length === 0, 'Handkarte (Plattform): keine Gegner-Ansage');
}

{
  // Aussenmission nicht aktiv: keine Ansage; danach wieder
  const P = partie({});
  lauf(P, 8, () => dienst(P)); gegner(P, 14, 0).vis = true;   // vis von Hand: bei ruhender Aussenmission rechnet die Sicht nicht
  P.g.away.active = false;
  lauf(P, 12);
  ok(ans(P.c).length === 0, 'Aussenmission nicht aktiv: keine Ansage');
  P.g.away.active = true; sensor(P, true);
  ok(lauf(P, 10, () => ans(P.c).length > 0), 'wieder aktiv: die Ansage kommt');
}

// ---------- 4 Raetselhinweis ----------
section('4 Raetselhinweis');
{
  const P = partie({});
  const { g, h, c } = P;
  const karte = W.AWAY_MAPS[g.away.map].karte;
  const rs = karte.anker.filter((a) => a.rolle === 'raetsel');
  const nebenAnker = (a, d) => { h.x = a.x * T + 16 + (d || T); h.y = a.y * T + 16; h.moving = false; };
  lauf(P, 8, () => dienst(P));
  lauf(P, 10);
  ok(ans(c).length === 0, 'weit vom Rätsel: keine Ansage');
  nebenAnker(rs[0]);
  ok(warteBisAnsage(P, c, 6), 'am Schloss: Ansage');
  const a = ans(c);
  const fenster = Math.floor(require('../server/sim/anker.js').paarFenster(g, karte, rs[0].paar));
  ok(a.length === 1 && a[0].m.textId === 'bord.ansage.raetsel' && a[0].m.text.length <= 90 && a[0].m.text.includes('nacheinander, ' + fenster + ' s Zeit'), 'solo (genau 1 im Aussenteam): Hinweis nacheinander mit dem Fenster des Servers (' + fenster + ' s): ' + (a[0] && a[0].m.text));
  lauf(P, 30);
  ok(ans(c).length === 1, 'einmal je Paar: bleibt der Mensch am Schloss, kommt nichts nach');
  nebenAnker(rs[1]);
  lauf(P, 12);
  ok(ans(c).length === 1, 'zweites Schloss desselben Paares: keine zweite Ansage');
  // geloest: nichts
  const P2 = partie({});
  const k2 = W.AWAY_MAPS[P2.g.away.map].karte; const r2 = k2.anker.filter((x) => x.rolle === 'raetsel');
  lauf(P2, 8, () => dienst(P2));
  P2.g.away.zustaende = Object.assign(P2.g.away.zustaende || {}, { [r2[0].id]: 'geloest', [r2[1].id]: 'geloest' });
  P2.h.x = r2[0].x * T + 16 + T; P2.h.y = r2[0].y * T + 16;
  lauf(P2, 12);
  ok(ans(P2.c).length === 0, 'geloestes Paar: keine Ansage');
  // Gruppe: zwei Menschen unten -> gleichzeitig
  const P3 = partie({ menschen: 2, unten: 2 });
  const k3 = W.AWAY_MAPS[P3.g.away.map].karte; const r3 = k3.anker.filter((x) => x.rolle === 'raetsel');
  lauf(P3, 8, () => dienst(P3));
  for (const cc of P3.conns) { cc.player.x = r3[0].x * T + 16 + T; cc.player.y = r3[0].y * T + 16; }
  lauf(P3, 12);
  const g3 = ans(P3.conns[0]);
  ok(g3.length === 1 && /beide gleichzeitig!/.test(g3[0].m.text) && ans(P3.conns[1]).length === 1, 'Gruppe (zwei unten): „beide gleichzeitig!“, jeder Mensch unten bekommt seine Ansage: ' + (g3[0] && g3[0].m.text));
}

// ---------- 5 Haeufigkeit ----------
section('5 Haeufigkeit: hoechstens eine Ansage je 8 s je Empfaenger');
{
  const P = partie({});
  const { g, h, c } = P;
  const karte = W.AWAY_MAPS[g.away.map].karte; const rs = karte.anker.filter((a) => a.rolle === 'raetsel');
  lauf(P, 8, () => dienst(P));
  sensor(P, true);
  h.x = rs[0].x * T + 16 + T; h.y = rs[0].y * T + 16;
  // jede Sekunde ein neuer ferner Gegner (immer eine neue Lage), dazu das Raetsel: viel Anlass, wenig Ansagen
  const t0 = g.time;
  for (let i = 0; i < 60; i++) { gegner(P, 12 + (i % 5), (i % 3) - 1); lauf(P, 1); }
  const a = ans(c, t0);
  let min = Infinity; for (let i = 1; i < a.length; i++) min = Math.min(min, a[i].t - a[i - 1].t);
  ok(a.length >= 3 && a.length <= Math.floor(60 / 8) + 1, `Flut: ${a.length} Ansagen in 60 s (hoechstens ${Math.floor(60 / 8) + 1})`);
  ok(min >= 8 - 1 / 30, `Abstand zwischen Ansagen mindestens 8 s (kleinster ${min.toFixed(2)} s)`);
  ok(a.some((e) => e.m.textId === 'bord.ansage.raetsel') && a.some((e) => e.m.textId === 'bord.ansage.gegner'), 'beide Arten kamen dran (die Rangfolge laesst keine Art verhungern)');
}

// ---------- 6 Nur im Dienst, Befehlsannahme unberuehrt ----------
section('6 Nur im laufenden Bord-Dienst; die Befehlsannahme bleibt unberuehrt');
{
  // kein Dienst: Mensch an Bord (niemand unten) mit Gegnern
  const P0 = partie({ unten: 0 });
  P0.h.zone = 'ship';
  lauf(P0, 5);
  ok(!dienst(P0) && ans(P0.c).length === 0, 'niemand unten: kein Dienst, keine Ansage');
  // Dienst ruht: ein zweiter Mensch an der Transfer-Konsole
  const P = partie({ menschen: 2, unten: 1 });
  sensor(P, true); gegner(P, 14, 0);
  interior.enterConsole(P.g, P.conns[1].player, 'transfer');
  lauf(P, 20);
  ok(!dienst(P) && ans(P.c).length === 0, 'Mensch am Transfer: Dienst ruht, auch ein bekannter ferner Gegner wird nicht angesagt');
  P.g.handleMessage(P.conns[1], { t: 'leave' });
  ok(lauf(P, 20, () => ans(P.c).length > 0), 'Mensch geht, Dienst laeuft wieder: jetzt kommt die Ansage');
  // ohne Bots (reine Menschenpartie): keine Ansage
  const Q = partie({ bots: [] });
  sensor(Q, true); gegner(Q, 14, 0);
  lauf(Q, 20);
  ok(Lauf.agenten(Q.g).length === 0 && ans(Q.c).length === 0, 'ohne Bots: kein Lauf, keine Ansage');
  // Befehlsannahme: nach Ansagen gelten Rate und Antworten wie vorher
  const R = partie({});
  sensor(R, true); gegner(R, 14, 0);
  lauf(R, 20);
  ok(ans(R.c).length >= 1, 'Aufbau: Ansagen sind angekommen');
  const echtJetzt = Date.now; let versatz = 0;
  Date.now = () => echtJetzt() + (versatz += 200);
  try {
    const n0 = R.c.box.length;
    R.g.handleMessage(R.c, { t: 'bot.befehl', an: 'technik', befehl: 'bot.status', quelle: 'menu' });
    const antw = R.c.box.slice(n0).filter((e) => e.m.t === Protocol.C.BOT_ANTWORT && e.m.befehl !== 'bord.ansage');
    ok(antw.length === 1 && antw[0].m.befehl === 'bot.status' && antw[0].m.status === 'ok' && antw[0].m.botId === botVon(R, 'technik').botId, 'bot.status wird nach den Ansagen normal beantwortet (eine Antwort, status ok)');
    const n1 = R.c.box.length;
    for (let i = 0; i < 14; i++) { versatz -= 190; R.g.handleMessage(R.c, { t: 'bot.befehl', an: 'technik', befehl: 'bot.status', quelle: 'menu' }); }
    const s = R.c.box.slice(n1).filter((e) => e.m.befehl !== 'bord.ansage').map((e) => e.m.textId + ':' + e.m.status);
    ok(s.filter((x) => /rate/.test(x)).length === 1, 'die Rate der Befehle (10 je Sekunde, eine Ablehnung) laeuft unabhaengig: genau eine rate-Antwort in der Flut');
  } finally { Date.now = echtJetzt; }
  ok(R.g.errors === 0, 'game.errors 0');
}

// ---------- 7 Client ----------
section('7 Client: Sprechspalte, Quittung, Clip');
{
  // Sprechspalte: hud.js gegen Render-Stub (wie test-bot-sprache h)
  let tMs = 1000; const calls = [];
  const R = {
    PAL: new Proxy({}, { get: (t, k) => '#' + String(k) }),
    measure: (t) => String(t == null ? '' : t).length * 6,
    wrap(str, maxW) { const out = []; let line = ''; for (const w of String(str).split(' ')) { const test = line ? line + ' ' + w : w; if (test.length * 6 > maxW && line) { out.push(line); line = w; } else line = test; } if (line) out.push(line); return out; },
    backdrop: (c, x, y, w, h) => calls.push({ n: 'backdrop', x, y, w, h }), art: () => true, text: (c, s, x, y) => calls.push({ n: 'text', s, x, y }),
  };
  const ctx = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, strokeRect() {} };
  const hud = () => {
    const w = { Render: R, Shared_Maps: {}, Shared_Config: {}, Shared_Protocol: {}, Net: { guard: (nm, f) => f(), on() {} }, performance: { now: () => tMs }, Menue: { TOKENS: { FN: { drive: '#FFC66B', sensor: '#A9D6E5', cmd: '#F4EEDC', warn: '#F2C94C', neutral: '#8EA3B5' } } } };
    w.window = w; vm.createContext(w);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hud.js'), 'utf8'), w, { filename: 'hud.js' });
    return w.Hud;
  };
  const fuss = { time: 1, self: { zone: 'ship' }, me: {}, state: { phase: 'play' } };
  const zeichne = (H) => { calls.length = 0; H.zeichneSprechspalte(ctx, fuss); return calls.filter((x) => x.n === 'backdrop').length; };
  {
    const H = hud();
    ok(H.sprechMax() === 2 && H.sprechMax({ bots: false }) === 2 && H.sprechMax({ bots: true }) === 3, 'sprechMax: ohne Bots 2, mit Bots 3 (reine Funktion des Zustands)');
    H.sprechAn(true);
    for (const t of ['Eins', 'Zwei', 'Drei', 'Vier']) H.pushCrewFunk(t, 'BORD', '#fff');
    ok(H.sprech.eintraege.map((e) => e.text).join() === 'Drei,Vier' && zeichne(H) === 2, 'ohne Bots: wie bisher hoechstens 2 Eintraege (gespeichert und gezeichnet)');
    const H2 = hud(); H2.sprechAn(true); H2.sprech.bots = true;
    for (const t of ['Eins', 'Zwei', 'Drei', 'Vier']) H2.pushCrewFunk(t, 'BORD', '#fff');
    ok(H2.sprech.eintraege.map((e) => e.text).join() === 'Zwei,Drei,Vier' && zeichne(H2) === 3, 'mit Bots: 3 Eintraege (der aelteste faellt raus)');
    H2.sprech.aufnahme = true;
    ok(zeichne(H2) === 3 + 0 || zeichne(H2) === 2 + 1, 'mit Bots und offener Aufnahme: Aufnahme-Anzeige plus zwei Untertitel (Platz fuer drei Zeilen insgesamt)');
    H2.sprech.bots = false; H2.sprech.aufnahme = false;
    ok(zeichne(H2) === 2, 'Bots weg: wieder nur 2 gezeichnet (pixelgleich wie bisher)');
  }
  // bot-menue: Ansage ohne Quittung, ohne gilt, Sprecher BORD
  {
    const BM = require('../public/js/bot-menue.js');
    const TK = require('../public/js/pult-befehl-tokens.js');
    const KANON = require('../content/bots/kanon.json');
    const L = { senden: [], untertitel: [] };
    const m = BM.erzeuge({ kanon: KANON, tokens: TK, uhr: () => 100000, senden: (x) => { L.senden.push(x); return true; }, anzeige: { untertitel: (text, info) => L.untertitel.push({ text, info }), denied() {}, ton() {} }, kappe: () => '', befehlTyp: Protocol.C.BOT_BEFEHL });
    m.synchron([{ id: 'b0', bot: 1, rolle: 'navigation', connected: true }, { id: 'b1', bot: 1, rolle: 'technik', connected: true }], 'play');
    const stand = () => JSON.stringify([((m.ansicht() || { zellen: [] }).zellen).map((z) => z.text), m.crew().map((z) => [z.text, z.textKurz || null, z.active || false])]);
    const vorher = stand();
    const r = m.antwort({ t: Protocol.C.BOT_ANTWORT, botId: null, befehl: 'bord.ansage', status: 'ok', textId: 'bord.ansage.gegner', text: 'Ein Gegner im Osten, etwa 14 Meter.' });
    ok(r.verarbeitet && L.untertitel.length === 1 && L.untertitel[0].text === 'Ein Gegner im Osten, etwa 14 Meter.' && L.untertitel[0].info.sprecher === 'BORD', 'bot-menue: Ansage wird als Untertitel von BORD gezeigt');
    ok(stand() === vorher && L.senden.length === 0, 'bot-menue: keine Quittung, kein „gilt“, nichts gesendet (die Ansage ist keine Antwort auf einen Befehl)');
    m.taste('captain.befehl.d', 'menu');
    const offen = stand();
    const r2 = m.antwort({ t: Protocol.C.BOT_ANTWORT, botId: null, befehl: 'bord.ansage', status: 'ok', textId: 'bord.ansage.code', text: 'Codefolge am Kustodenpult: Kreis Mint.' });
    ok(r2.verarbeitet && stand() === offen, 'bot-menue: auch bei offenem Menue keine Quittung durch die Ansage');
  }
  // bot-sprache: kein Clip fuer die Ansage, normale Antworten behalten ihn
  {
    const BS = require('../public/js/bot-sprache.js');
    const untertitel = [], gespielt = [];
    const env = {
      transport: { send: () => true, onMessage: () => () => {} }, matcher: () => null, stt: async () => '', mikrofon: { start: async () => { throw new Error('x'); } },
      audio: { spiele: async (urls) => { gespielt.push(urls); return null; }, stumm() {}, stopp() {} },
      anzeige: { aufnahme() {}, untertitel: (t, info) => { untertitel.push({ t, info }); return 1; }, meldung() {} },
      stimmen: { b0: 'b0', b1: 'b1', b2: 'b2' }, clipBasis: '/assets/bots/stimmen',
    };
    const k = BS.erzeuge(env); k.schalte(true);
    k.empfange({ t: 'bot.antwort', botId: null, befehl: 'bord.ansage', status: 'ok', textId: 'bord.ansage.code', text: 'Codefolge am Kustodenpult: Kreis Mint.', variante: 0 });
    ok(untertitel.length === 1 && untertitel[0].t === 'Codefolge am Kustodenpult: Kreis Mint.' && !untertitel[0].info.botId && gespielt.length === 0, 'bot-sprache: die Ansage ist Untertitel ohne Clip-Anfrage (kein 404 je Ansage)');
    k.empfange({ t: 'bot.antwort', botId: 'b0', befehl: 'nav.kurs', status: 'ok', textId: 'nav.kurs.ok', text: 'Aye, Kurs liegt an.', variante: 0 });
    ok(gespielt.length === 1, 'bot-sprache: eine normale Antwort sucht weiter ihren Clip');
  }
}

// ---------- 8 Reine Menschenpartie ----------
section('8 Reine Menschenpartie byte-gleich (auch Plattform mit Mensch unten: die ODA funkt wie bisher)');
{
  const BASIS = '0b548f01';
  if (process.env.ANSAGEN_OHNE_BASIS) { console.log('  info  ANSAGEN_OHNE_BASIS: Vergleich mit dem Basisstand uebersprungen (Mutationsprobe, kein Repo)'); console.log(String.fromCharCode(10) + 'test-bot02-ansagen: ' + (n - fails) + '/' + n + ' ok' + (fails ? ', ' + fails + ' FEHLER' : '')); process.exit(fails ? 1 : 0); }
  const baum = path.join(TMP, 'basis');
  let entpackt = false;
  try { fs.mkdirSync(baum, { recursive: true }); const tarball = cp.execFileSync('git', ['archive', BASIS], { cwd: path.join(__dirname, '..'), maxBuffer: 1 << 29 }); cp.execFileSync('tar', ['-x'], { cwd: baum, input: tarball }); entpackt = fs.existsSync(path.join(baum, 'server', 'game.js')); } catch (e) { console.log('  info  git archive: ' + String(e.message).slice(0, 120)); }
  if (entpackt) {
    const messen = (wurzel) => JSON.parse(cp.execFileSync(process.execPath, [path.join(__dirname, 'mess-bot02-menschenpartie.js'), wurzel], { encoding: 'utf8', env: Object.assign({}, process.env, { NODE_PATH: path.join(__dirname, '..', 'node_modules') }) }).trim().split('\n').pop());
    const alt = messen(baum), neu = messen(path.join(__dirname, '..'));
    ok(alt.snapshots > 300 && alt.errors === 0 && neu.errors === 0 && alt.hilfe === 1 && neu.hilfe === 1 && alt.hash === neu.hash && alt.snapshots === neu.snapshots, `Basisstand ${BASIS} gegen Stand (Menschenpartien inkl. Plattform mit Mensch unten): Hash gleich (${neu.hash.slice(0, 8)}, ${neu.snapshots} Snapshots, Fehler 0)`);
  } else ok(false, 'Basisbaum ' + BASIS + ' liess sich nicht entpacken (git archive): Vergleich nicht moeglich');
}

console.log(`\ntest-bot02-ansagen: ${n - fails}/${n} ok${fails ? ', ' + fails + ' FEHLER' : ''}`);
process.exit(fails ? 1 : 0);
