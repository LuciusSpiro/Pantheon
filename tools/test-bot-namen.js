'use strict';
// BOT-05 A2: Name sichtbar und ansprechbar. Die Figur (botId, content/bots/figuren.json) ist unabhaengig von der Rolle:
//   1 Snapshot: players[].botId nur bei Bots (Menschen tragen es nie, reine Menschenpartie unveraendert), Budget
//   2 Sprecher: der Untertitel zeigt den Namen der Figur (aus dem Snapshot), nie den Rollennamen; Ansagen des Bord-Bots (botId null) tragen von
//   3 Matcher: die Figurnamen sind Adressen fuer ihre botId, einzige Quelle figuren.json (Quellscan: keine Namen in muster.json, kanon.json oder im Code)
//   4 Server: Name + Rolle (Abnahme 3): richtige Rolle fuehrt aus, fremde Rolle lehnt ab (adressat), Figur nicht in der Partie: kein_bot
//   5 Eval-Satz tools/fixtures/bot-eval/eval-namen.json (Namen vorn/hinten, Fehlhoerungen, Negativfaelle)
//   node tools/test-bot-namen.js
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const BotSpieler = require('../server/bots/spieler.js');
const Befehle = require('../server/bots/befehle/index.js');
const Protocol = require('../shared/protocol.js');
const BS = require('../public/js/bot-sprache.js');
const M = require('../shared/bot-matcher.js');
const CONFIG = require('../shared/config.js');
const FIG = require('../content/bots/figuren.json');
const MUSTER = require('../content/bots/muster.json');
const KANON = require('../content/bots/kanon.json');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botnamen-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
const NAME = Object.fromEntries(FIG.figuren.map((f) => [f.botId, f.name]));   // b0 -> Livia ... (aus der Datei, kein Literal)
const BYTES = (v) => Buffer.byteLength(JSON.stringify(v));
let seq = 0;

function partie(rollen, menschen) {   // rollen: Rollen der Bots in Hinzufuege-Reihenfolge (erste = b0, zweite = b1 ...)
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (menschen || 1); i++) { const c = mkConn(); g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'K' + i, name: 'K' + i, color: i }); cs.push(c); }
  for (const r of rollen) BotSpieler.botHinzufuegen(g, null, r);
  g.lobbyOpts.startMission = 'arena_space';
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  for (let k = 0; k < 60; k++) g.step();
  return { g, c: cs[0], cs };
}
const botMit = (P, botId) => P.g.players.find((p) => p.bot && p.botId === botId);
// ein Befehl wie der Client ihn aus dem Matcher baut (an, befehl, args, quelle text); stehende Uhr gegen das Rate-Fenster
let jetzt = 1e12;
function sprich(P, text) {
  const res = M.match(text);
  if (!res) return { res, antw: [] };
  const msg = { t: 'bot.befehl', an: res.an, befehl: res.befehl, quelle: 'text' };
  if (res.args && Object.keys(res.args).length) msg.args = res.args;
  const n0 = P.c.inbox.length, echt = Date.now; jetzt += 5000; Date.now = () => jetzt;
  try { P.g.handleMessage(P.c, JSON.parse(JSON.stringify(msg))); } finally { Date.now = echt; }
  return { res, msg, antw: P.c.inbox.slice(n0).filter((x) => x.t === 'bot.antwort') };
}
// zaehlt, an welche Bots ein Befehl wirklich ausgefuehrt wird (Spion auf dem Befehlsverteiler)
function mitSpion(fn) {
  const echt = Befehle.befehl, aufrufe = [];
  Befehle.befehl = function (game, bot, name, args) { aufrufe.push({ botId: bot.botId, rolle: bot.rolle, name }); return echt.apply(this, arguments); };
  try { return { ergebnis: fn(), aufrufe }; } finally { Befehle.befehl = echt; }
}

// ---------- 1 Snapshot ----------
section('1 Snapshot: players[].botId nur bei Bots');
{
  const P = partie(['technik', 'ops', 'navigation'], 1);
  const snap = P.g.snapshot();
  const bots = snap.players.filter((p) => p.bot), menschen = snap.players.filter((p) => !p.bot);
  ok(bots.length === 3 && bots.every((p) => botMit(P, p.botId) && botMit(P, p.botId).id === p.id && p.name === NAME[p.botId]), 'drei Bots: botId im Snapshot, Name = Figurname aus figuren.json (' + bots.map((p) => p.botId + ':' + p.name + ':' + p.rolle).join(', ') + ')');
  ok(menschen.length === 1 && !('botId' in menschen[0]) && !('bot' in menschen[0]) && !('rolle' in menschen[0]), 'Mensch: weder bot noch rolle noch botId');
  const ohne = JSON.stringify(snap).replace(/,"botId":"b\d"/g, '');
  ok(JSON.stringify(snap).length - ohne.length === 3 * ',"botId":"b0"'.length && !/botId/.test(ohne), 'botId ist das einzige neue Feld: 13 B je Bot (3 Bots +' + (JSON.stringify(snap).length - ohne.length) + ' B)');
  const H = partie([], 2);
  const hs = JSON.stringify(H.g.snapshot());
  ok(!/botId/.test(hs) && !/"bot":/.test(hs) && H.g.snapshot().players.length === 2 && H.g.snapshot().players.every((p) => !('bot' in p) && !('rolle' in p) && !('botId' in p)), 'reine Menschenpartie: weder bot noch rolle noch botId (Snapshot wie vorher)');
  const worst = Math.max(BYTES(snap), BYTES(P.g.snapshot()));
  ok(worst <= CONFIG.net.snapMax - CONFIG.net.snapLuft, 'Budget: Partie mit 3 Bots ' + worst + ' B <= Ziel ' + (CONFIG.net.snapMax - CONFIG.net.snapLuft) + ' B');
}

// ---------- 2 Sprecher ----------
section('2 Sprecher: Name der Figur, nicht der Rolle');
{
  const spieler = [
    { id: 'p1', name: 'Kai', color: 0 },
    { id: 'p2', name: NAME.b0, bot: 1, rolle: 'technik', botId: 'b0' },
    { id: 'p3', name: NAME.b1, bot: 1, rolle: 'ops', botId: 'b1' },
    { id: 'p4', name: 'Echo', color: 1, botId: 'b2' },   // ein Mensch traegt nie botId; wuerde er es doch, zaehlt er nicht (kein bot-Flag)
  ];
  const sn = (b) => BS.sprecherName(b, spieler);
  ok(sn('b0') === NAME.b0.toUpperCase() && sn('b1') === NAME.b1.toUpperCase(), 'b0 und b1: Figurname in Grossbuchstaben (b0 steht auf Technik: nicht TECHNIK)');
  ok(sn('b2') === 'BORD' && sn('b3') === 'BORD' && sn(null) === 'BORD' && sn(undefined) === 'BORD' && sn('x') === 'BORD', 'ohne Eintrag im Snapshot (Figur nicht gespielt, Mensch, null, unbekannt): BORD');
  ok(BS.sprecherName('b0') === 'BORD' && BS.sprecherName('b0', null) === 'BORD' && BS.sprecherName('b0', []) === 'BORD', 'ohne Snapshot: BORD');
  const tauschen = spieler.map((p) => (p.botId === 'b0' ? Object.assign({}, p, { rolle: 'navigation' }) : p));
  ok(BS.sprecherName('b0', tauschen) === NAME.b0.toUpperCase(), 'Rollenwechsel aendert den Sprecher nicht');
  // Ansage des Bord-Bots: botId null, von = Figur des Bord-Bots (Server), Untertitel zeigt deren Namen, Stimme/Clip unveraendert (kein Clip)
  const P = partie(['navigation', 'technik'], 1);
  const bord = require('../server/bots/lauf.js').bordBot(P.g);
  ok(!!bord && bord.rolle === 'technik', 'Testaufbau: der Technik-Bot ist Bord-Bot (' + (bord && bord.botId) + ')');
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'server', 'bots', 'ansagen.js'), 'utf8');
  ok(/von: bot\.botId/.test(quelle) && /botId: null, befehl: BEFEHL/.test(quelle), 'ansagen.js: botId bleibt null, von = botId des Bord-Bots');
  const titel = [];
  const kern = BS.erzeuge({ transport: { onMessage: (f) => { kern.f = f; return () => {}; }, send: () => true }, matcher: () => M, audio: { spiele: async () => null, stumm() {}, stopp() {} }, stt: {}, mikrofon: {}, anzeige: { aufnahme() {}, untertitel: (t, info) => { titel.push({ t, info, wer: BS.sprecherName(info.botId || info.von, P.g.snapshot().players) }); return 1; }, meldung() {} } });
  kern.schalte(true);
  kern.f({ t: 'bot.antwort', botId: null, von: bord.botId, befehl: 'bord.ansage', status: 'ok', textId: 'bord.ansage.code', text: 'Codefolge: Kreis.' });
  kern.f({ t: 'bot.antwort', botId: null, befehl: 'bord.ansage', status: 'ok', textId: 'bord.ansage.code', text: 'Codefolge: Quadrat.' });
  kern.f({ t: 'bot.antwort', botId: bord.botId, befehl: 'bot.status', status: 'ok', textId: 'bot.status.ok', text: 'Alles ruhig.' });
  ok(titel.length === 3 && titel[0].wer === NAME[bord.botId].toUpperCase() && titel[1].wer === 'BORD' && titel[2].wer === NAME[bord.botId].toUpperCase(), 'Untertitel: Ansage mit von = Name des Bord-Bots, ohne von = BORD, Antwort = Name der Figur (' + titel.map((x) => x.wer).join(', ') + ')');
  ok(!titel[0].info.botId && titel[0].info.von === bord.botId, 'bot-sprache: info.botId bleibt leer bei Ansagen (Stimme/Clip unveraendert), von kommt mit');
}

// ---------- 3 Matcher ----------
section('3 Matcher: Figurnamen aus figuren.json sind Adressen');
{
  M.setzeMuster(Object.assign({}, MUSTER, { kanon: KANON }));   // ohne figuren: der Matcher laedt content/bots/figuren.json selbst (Node)
  for (const f of FIG.figuren) {
    const a = M.match(f.name + ', Schilde Steuerbord'), b = M.match(f.name.toLowerCase() + ' Statusbericht'), c = M.match('Schilde Steuerbord, ' + f.name);
    ok(a && a.an === f.botId && a.befehl === 'tech.schild' && b && b.an === f.botId && b.befehl === 'bot.status' && c && c.an === f.botId, f.name + ': vorn mit Komma, vorn ohne Komma, hinten nach Komma -> an ' + f.botId);
  }
  const x = M.match('Technik, Schilde Steuerbord');
  ok(x && x.an === 'technik', 'Rollenwort bleibt Rollenwort (an technik)');
  const m1 = M.match('Livia, bitte, Schilde Steuerbord'.replace('Livia', NAME.b0));
  ok(m1 && m1.an === 'b0' && m1.befehl === 'tech.schild', 'Name als eigener Teil ("' + NAME.b0 + ', bitte, Schilde Steuerbord") adressiert die Figur, nicht still die Rolle');
  // einzige Quelle: andere Namen in figuren.json -> andere Adressen, die alten gelten nicht mehr
  const anders = JSON.parse(JSON.stringify(FIG)); anders.figuren[0].name = 'Zosimos';
  M.setzeFiguren(anders);
  const z = M.match('Zosimos, Statusbericht'), alt = M.match(NAME.b0 + ', Statusbericht');
  ok(z && z.an === 'b0' && alt && alt.an === 'alle', 'setzeFiguren: der neue Name adressiert b0, der alte nicht mehr (Quelle ist figuren.json)');
  M.setzeMuster(Object.assign({}, MUSTER, { kanon: KANON, figuren: FIG }));   // wie der Browser: ein Aufruf mit allen Dateien
  const w = M.match(NAME.b2 + ', Statusbericht');
  ok(w && w.an === 'b2', 'setzeMuster mit figuren (Browser-Weg) setzt die Namen');
  let fehler = null; try { M.setzeFiguren({ figuren: [{ botId: 'b0' }] }); } catch (e) { fehler = e; }
  ok(!!fehler, 'setzeFiguren lehnt eine Figur ohne Namen ab');
  M.setzeFiguren(FIG);
  // Quellscan: keine Figurnamen in muster.json, kanon.json oder als Literal im Code (Kommentare ausgenommen)
  const namen = FIG.figuren.map((f) => f.name);
  const wort = (t, nm) => new RegExp('(^|[^A-Za-zÄÖÜäöüß])' + nm + '([^A-Za-zÄÖÜäöüß]|$)', 'i').test(t);
  ok(namen.every((nm) => !wort(fs.readFileSync('content/bots/muster.json', 'utf8'), nm) && !wort(fs.readFileSync('content/bots/kanon.json', 'utf8'), nm)) && Object.keys(MUSTER.namen || {}).length === 0, 'muster.json (namen leer) und kanon.json enthalten keinen Figurnamen');
  const dateien = [];
  const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') geh(p); } else if (/\.js$/.test(e.name)) dateien.push(p); } };
  for (const d of ['shared', 'server', 'public/js']) geh(d);
  const ohneKommentar = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const treffer = [];
  for (const f of dateien) { const t = ohneKommentar(fs.readFileSync(f, 'utf8')); for (const nm of namen) if (wort(t, nm)) treffer.push(path.relative('.', f) + ':' + nm); }
  ok(dateien.length > 50 && treffer.length === 0, 'Quellscan ' + dateien.length + ' Code-Dateien (shared, server, public/js): kein Figurname als Literal ' + treffer.join(', '));
  const matcherSrc = fs.readFileSync('shared/bot-matcher.js', 'utf8');
  ok(/figuren\.json/.test(matcherSrc) && /setzeFiguren/.test(matcherSrc), 'Matcher bezieht die Namen aus figuren.json (Node: nodeLaden, Browser: setzeMuster/setzeFiguren)');
  const clientSrc = fs.readFileSync('public/js/bot-sprache.js', 'utf8');
  ok(/\/content\/bots\/figuren\.json/.test(clientSrc) && /figuren: fi/.test(clientSrc), 'Client laedt /content/bots/figuren.json und reicht sie dem Matcher');
  const index = fs.readFileSync('server/index.js', 'utf8');
  ok(/'kanon\.json', 'muster\.json', 'figuren\.json'/.test(index), 'Server liefert figuren.json an den Browser');
}

// ---------- 4 Server ----------
section('4 Server: Name + Rolle (Abnahme 3)');
{
  // Livia (b0) als Technik-Bot: Cassius b1 Ops, Titus b2 Navigation
  const A = partie(['technik', 'ops', 'navigation'], 1);
  ok(botMit(A, 'b0').rolle === 'technik' && botMit(A, 'b2').rolle === 'navigation', 'Aufbau A: ' + NAME.b0 + ' Technik, ' + NAME.b1 + ' Ops, ' + NAME.b2 + ' Navigation');
  let r = mitSpion(() => sprich(A, NAME.b0 + ', Schilde Steuerbord'));
  ok(r.ergebnis.msg && r.ergebnis.msg.an === 'b0' && r.ergebnis.msg.befehl === 'tech.schild' && r.ergebnis.antw.length === 1 && r.ergebnis.antw[0].botId === 'b0' && r.ergebnis.antw[0].status === 'ok'
    && r.aufrufe.length === 1 && r.aufrufe[0].botId === 'b0', NAME.b0 + ' (Technik): tech.schild an b0, ausgefuehrt (' + JSON.stringify(r.ergebnis.antw.map((a) => a.textId)) + ')');
  r = mitSpion(() => sprich(A, 'Schilde Steuerbord, ' + NAME.b2));
  ok(r.ergebnis.msg.an === 'b2' && r.ergebnis.antw.length === 1 && r.ergebnis.antw[0].botId === 'b2' && r.ergebnis.antw[0].status === 'abgelehnt' && r.ergebnis.antw[0].textId === 'tech.schild.abgelehnt.adressat' && r.aufrufe.length === 0,
    NAME.b2 + ' (Navigation) bekommt tech.schild: abgelehnt/adressat, kein Befehl an irgendeinen Bot (Aufrufe ' + r.aufrufe.length + ')');
  r = mitSpion(() => sprich(A, NAME.b1 + ', Statusbericht'));
  ok(r.ergebnis.msg.an === 'b1' && r.ergebnis.msg.befehl === 'bot.status' && r.ergebnis.antw.length === 1 && r.ergebnis.antw[0].botId === 'b1' && r.ergebnis.antw[0].status === 'ok' && r.aufrufe.length === 1 && r.aufrufe[0].botId === 'b1', NAME.b1 + ', Statusbericht: bot.status an b1, nur b1 antwortet');
  r = mitSpion(() => sprich(A, NAME.b1 + ', Schilde Steuerbord'));
  ok(r.ergebnis.antw.length === 1 && r.ergebnis.antw[0].botId === 'b1' && r.ergebnis.antw[0].textId === 'tech.schild.abgelehnt.adressat' && r.aufrufe.length === 0, NAME.b1 + ' (Ops) und tech.schild: abgelehnt/adressat');
  r = mitSpion(() => sprich(A, 'Technik, Schilde Steuerbord'));
  ok(r.ergebnis.msg.an === 'technik' && r.ergebnis.antw.length === 1 && r.ergebnis.antw[0].botId === 'b0' && r.aufrufe.length === 1 && r.aufrufe[0].rolle === 'technik', 'Rolle statt Name: "Technik, ..." trifft weiter den Technik-Bot (' + NAME.b0 + ')');

  // Livia (b0) als Navigations-Bot
  const B = partie(['navigation', 'ops', 'technik'], 1);
  r = mitSpion(() => sprich(B, NAME.b0 + ', Schilde Steuerbord'));
  ok(r.ergebnis.msg.an === 'b0' && r.ergebnis.antw.length === 1 && r.ergebnis.antw[0].botId === 'b0' && r.ergebnis.antw[0].status === 'abgelehnt' && r.ergebnis.antw[0].textId === 'tech.schild.abgelehnt.adressat' && r.aufrufe.length === 0,
    NAME.b0 + ' (Navigation) und tech.schild: abgelehnt/adressat, der Technik-Bot (' + NAME.b2 + ') bekommt nichts (Aufrufe ' + r.aufrufe.length + ')');
  r = mitSpion(() => sprich(B, 'Schilde Steuerbord, ' + NAME.b2));
  ok(r.ergebnis.antw.length === 1 && r.ergebnis.antw[0].botId === 'b2' && r.ergebnis.antw[0].status === 'ok' && r.aufrufe.length === 1 && r.aufrufe[0].botId === 'b2', NAME.b2 + ' (Technik) hinten genannt: ausgefuehrt');
  r = mitSpion(() => sprich(B, NAME.b0 + ', Stopp'));
  ok(r.ergebnis.msg.befehl === 'nav.stopp' && r.ergebnis.antw[0].botId === 'b0' && r.aufrufe.length === 1 && r.aufrufe[0].botId === 'b0', NAME.b0 + ' (Navigation): nav.stopp ausgefuehrt');

  // Figur nicht in der Partie: kein_bot (so lehnte der Server schon vorher jede botId ohne Bot ab)
  const C = partie(['navigation', 'ops'], 1);
  r = mitSpion(() => sprich(C, NAME.b2 + ', Statusbericht'));
  ok(r.ergebnis.msg.an === 'b2' && r.ergebnis.antw.length === 1 && r.ergebnis.antw[0].botId === null && r.ergebnis.antw[0].status === 'unmoeglich' && r.ergebnis.antw[0].textId === 'bot.status.unmoeglich.kein_bot' && r.aufrufe.length === 0,
    NAME.b2 + ' nicht in der Partie: unmoeglich/kein_bot, kein Bot fuehrt etwas aus (' + r.ergebnis.antw.map((a) => a.textId) + ')');
}

// ---------- 5 Eval-Satz ----------
section('5 Eval-Satz eval-namen.json');
{
  M.setzeFiguren(FIG);
  const satz = JSON.parse(fs.readFileSync('tools/fixtures/bot-eval/eval-namen.json', 'utf8'));
  const je = { positiv: [0, 0], 'stt-fehler': [0, 0], negativ: [0, 0] }, daneben = [];
  const gleich = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());
  for (const f of satz) {
    const r = M.match(f.text);
    const gut = f.erwartet == null ? r === null : !!r && r.befehl === f.erwartet.befehl && gleich(r.args, f.erwartet.args) && r.an === f.erwartet.an;
    je[f.art][0]++; if (gut) je[f.art][1]++; else daneben.push(f.art + ' "' + f.text + '" -> ' + (r ? r.an + ' ' + r.befehl : 'null'));
  }
  ok(je.positiv[1] === je.positiv[0], 'positiv (Namen vorn/hinten, Gross/klein, "bitte"): ' + je.positiv[1] + '/' + je.positiv[0]);
  ok(je.negativ[1] === je.negativ[0], 'negativ (Name allein, Verneinung, Fremdsprache, Frage, Danke): ' + je.negativ[1] + '/' + je.negativ[0]);
  const falschBefehl = satz.filter((f) => f.art === 'stt-fehler').filter((f) => { const r = M.match(f.text); return r && r.befehl !== f.erwartet.befehl; });
  ok(falschBefehl.length === 0 && je['stt-fehler'][1] / je['stt-fehler'][0] >= 0.9, 'Fehlhoerungen: ' + je['stt-fehler'][1] + '/' + je['stt-fehler'][0] + ' mit richtigem Adressaten (Untergrenze 90 %), nie ein falscher Befehl; daneben: ' + (daneben.filter((d) => /^stt/.test(d)).join(' | ') || '-'));
}

console.log('\ntest-bot-namen: ' + (n - fails) + '/' + n + ' ok');
if (fails) { console.log(fails + ' FEHLER'); process.exit(1); }
process.exit(0);
