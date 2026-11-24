'use strict';
// BOT-01 C1: Annahme der Bot-Befehle (server/bots/annahme.js, content/bots/gruende.json + texte.json, Nachricht bot.befehl -> bot.antwort). Echtes Game mit Server-Bots; die Registries der Rollen sind in C1 leer,
// die Wirkung (ok) wird ueber eingehaengte Testfunktionen geprueft und danach entfernt.
//  1. Daten: Katalog (22 Kanon-Befehle + nav.sprung), Gruende je Befehl, jede textId existiert (2 Varianten), Texte nennen keine Argumente, Protokollkonstanten
//  2. Absender: Mensch ohne Bots -> unmoeglich kein_bot; ein Bot als Absender wird abgewiesen (keine Antwort, kein Registry-Aufruf)
//  3. Lobby/Partieende: abgelehnt phase
//  4. Gruende: unbekannt, quelle (auch nav.sprung per Sprache), adressat, argument (Muell, Normalisierung, hex:/objekt: nur Menue/Taste), kein_bot, wartet, rate (je Spieler, keine Antwort-Flut),
//     kein_ziel/nicht_jetzt/system aus der Registry, nicht vorgesehene Codes und Ausnahmen -> fehler + countError('bot.grund')
//  5. Adressierung: Rolle, botId, alle (eine Antwort je Bot), bord (kein Bot), bot.*; fehlende optionale Argumente werden nicht abgelehnt
//  6. Antwort: Form (direkt, keine event-Huelle), Text und Variante passen zur textId, Registry-Ausnahme bricht nichts
//  7. Reine Menschenpartie: bot.befehl aendert Snapshots und Nachrichten (ausser der Antwort) nicht
//  8. Quellscan: game.js nur ein duenner Aufruf, annahme.js ohne Zaehlmuster
//   node tools/test-bot-annahme.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
process.chdir(path.join(__dirname, '..'));
const { Game } = require('../server/game.js');
const Station = require('../server/sim/station.js');
const interior = require('../server/sim/interior.js');
const Protocol = require('../shared/protocol.js');
const BotSpieler = require('../server/bots/spieler.js');
const Annahme = require('../server/bots/annahme.js');
const Lauf = require('../server/bots/lauf.js');
const Befehle = require('../server/bots/befehle/index.js');
const KANON = require('../content/bots/kanon.json');
const GRUENDE = require('../content/bots/gruende.json');
const TEXTE = require('../content/bots/texte.json');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botannahme-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let seq = 0;

const mkConn = () => ({ inbox: [], send(o) { this.inbox.push(o); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } });
function neuesGame(seed) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  g.botZufall = (() => { let a = 42; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  return g;
}
// o.bots: Rollen, o.start: false = in der Lobby bleiben
function partie(o) {
  o = o || {};
  const g = neuesGame(o.seed);
  const c = mkConn(); g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  for (const r of o.bots || []) BotSpieler.botHinzufuegen(g, null, r);
  if (o.start !== false) {
    g.lobbyOpts.startMission = 'arena_space';
    g.handleMessage(c, { t: 'ready', ready: true });
    if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
  }
  return { g, c, h: c.player };
}
const lauf = (P, sec, bis) => { const t1 = P.g.time + sec; while (P.g.time < t1) { P.g.step(); if (P.g.wantsSnapshot()) P.g.snapshot(); if (bis && bis()) return true; } return bis ? !!bis() : true; };
const botVon = (P, rolle) => P.g.players.find((p) => p.bot && p.rolle === rolle);
let jetzt = 1e12;
// Senden mit stehender Uhr, damit das Rate-Fenster nicht zufaellig zuschlaegt; liefert die bot.antwort-Nachrichten dieser Sendung
const senden = (P, msg, wer) => {
  const c = wer || P.c; const n0 = c.inbox.length; const echt = Date.now; Date.now = () => jetzt;
  try { P.g.handleMessage(c, msg); } finally { Date.now = echt; }
  return c.inbox.slice(n0).filter((m) => m.t === 'bot.antwort');
};
const cmd = (befehl, an, args, quelle) => { const m = { t: 'bot.befehl', an, befehl, quelle: quelle === undefined ? 'menu' : quelle }; if (args !== undefined) m.args = args; return m; };
const ein = (P, msg) => { jetzt += 5000; return senden(P, msg); };   // Rate-Fenster ist leer
const einz = (P, msg) => { const a = ein(P, msg); return a.length === 1 ? a[0] : null; };
const grund = (a) => (a ? a.textId.split('.').pop() : null);
// Registry-Haken: haengt eine Testfunktion ein und entfernt sie wieder
// C2a: die Registry navigation traegt echte Befehle; haken stellt den Eintrag danach wieder her (loescht nur, was vorher fehlte)
const hatEintrag = (reg, name) => Object.prototype.hasOwnProperty.call(Befehle.REGISTER[reg], name);
function haken(reg, name, fn, was) { const alt = hatEintrag(reg, name) ? Befehle.REGISTER[reg][name] : undefined; Befehle.REGISTER[reg][name] = fn; try { return was(); } finally { if (alt) Befehle.REGISTER[reg][name] = alt; else delete Befehle.REGISTER[reg][name]; } }

// ---------- 1 Daten ----------
section('1 Daten: Katalog, Gruende, Texte');
{
  const kanonNamen = Array.from(new Set(KANON.befehle.map((e) => e.befehl)));
  const katalog = Array.from(Annahme.KATALOG.keys());
  ok(kanonNamen.length === 22 && katalog.length === 23 && katalog.includes('nav.sprung') && kanonNamen.every((x) => katalog.includes(x)), 'Katalog = 22 Kanon-Befehle + nav.sprung (' + katalog.length + ')');
  ok(katalog.every((b) => Array.isArray(GRUENDE.befehle[b]) && GRUENDE.befehle[b].length > 0) && Object.keys(GRUENDE.befehle).every((b) => b === 'befehl' || katalog.includes(b)), 'gruende.json: jeder Befehl hat seine Gruende, kein fremder Eintrag');
  const alleGruende = Object.keys(GRUENDE.gruende);
  ok(Object.values(GRUENDE.befehle).every((l) => l.every((x) => alleGruende.includes(x)) && new Set(l).size === l.length), 'jeder Grund ist definiert und je Befehl nur einmal');
  ok(['unbekannt', 'adressat', 'quelle', 'argument', 'phase', 'wartet', 'kein_bot', 'kein_ziel', 'system', 'rate', 'fehler', 'nicht_jetzt'].every((x) => alleGruende.includes(x)) && alleGruende.length === 12 && GRUENDE.gruende.fehler === 'abgelehnt' && GRUENDE.gruende.nicht_jetzt === 'abgelehnt', 'alle zwoelf Gruende vorhanden (zehn des Briefings + fehler + nicht_jetzt, beide abgelehnt)');
  const Bn = Object.keys(GRUENDE.befehle).filter((b) => b !== 'befehl');
  ok(Bn.length === 23 && Bn.every((b) => GRUENDE.befehle[b].includes('fehler')), 'fehler: fuer alle 23 Befehle (Rollenbefehle, bord.*, bot.*)');
  ok(Bn.every((b) => GRUENDE.befehle[b].includes('nicht_jetzt') === !b.startsWith('bot.')) && GRUENDE.befehle['befehl'].every((x) => x !== 'fehler' && x !== 'nicht_jetzt'), 'nicht_jetzt: fuer alle Rollenbefehle und bord.*, nicht fuer bot.*');
  ok(GRUENDE.befehle['nav.sprung'].includes('kein_ziel') && GRUENDE.befehle['nav.andocken'].includes('kein_ziel'), 'kein_ziel auch bei nav.sprung und nav.andocken');
  const fehlt = [], schwach = [];
  for (const [b, l] of Object.entries(GRUENDE.befehle)) for (const gr of l) {
    const id = `${b}.${GRUENDE.gruende[gr]}.${gr}`;
    if (!Array.isArray(TEXTE[id])) fehlt.push(id); else if (TEXTE[id].length < 2 || TEXTE[id].some((t) => typeof t !== 'string' || t.length < 5)) schwach.push(id);
  }
  ok(fehlt.length === 0, 'jede textId aus den Gruenden steht in texte.json' + (fehlt.length ? ' - fehlt: ' + fehlt.slice(0, 5).join(' ') : ''));
  ok(schwach.length === 0, 'jede dieser textIds hat mindestens 2 Varianten (Text, nicht leer)');
  ok(katalog.every((b) => Array.isArray(TEXTE[b + '.ok']) && TEXTE[b + '.ok'].length >= 2) && Array.isArray(TEXTE['bot.unklar']), 'ok-Texte fuer alle 23 Befehle und bot.unklar bleiben');
  const woerter = [];
  for (const e of KANON.befehle) for (const w of Object.values(e.werte || {})) for (const v of Object.values(w)) woerter.push(String(v.wort).toLowerCase());
  const neu = Object.entries(TEXTE).filter(([id]) => /\.(abgelehnt|unmoeglich)\./.test(id));
  const nennt = neu.filter(([, l]) => l.some((t) => /\d/.test(t) || woerter.some((w) => t.toLowerCase().includes(w))));
  ok(neu.length > 0 && nennt.length === 0, `Ablehnungstexte nennen keine Argumente (${neu.length} textIds, keine Ziffer, kein Wort der Argumentwerte)`);
  ok(Protocol.C.BOT_BEFEHL === 'bot.befehl' && Protocol.C.BOT_ANTWORT === 'bot.antwort', 'Protokoll: C.BOT_BEFEHL / C.BOT_ANTWORT');
  ok(Object.entries(Befehle.REGISTER).every(([rolle, r]) => (rolle === 'navigation' ? Object.keys(r).length === 7 : Object.keys(r).length === 0)), 'C2a: navigation traegt sieben Befehle, die anderen vier Registries sind noch leer (C2b)');
}

// ---------- 2 Absender ----------
section('2 Absender: Mensch ohne Bots, Bot als Absender');
{
  const P = partie({});
  const a = einz(P, cmd('nav.stopp', 'navigation'));
  ok(a && a.t === 'bot.antwort' && a.status === 'unmoeglich' && a.textId === 'nav.stopp.unmoeglich.kein_bot' && a.befehl === 'nav.stopp', 'Mensch ohne Bots: unmoeglich, Grund kein_bot');
  ok([['ops.scan', 'ops'], ['tech.ueberladen', 'technik'], ['bord.sensor', 'bord'], ['bot.status', 'alle'], ['nav.sprung', 'navigation', { ziel: 'basis' }]].every(([b, an, args]) => { const x = einz(P, cmd(b, an, args)); return x && x.status === 'unmoeglich' && grund(x) === 'kein_bot'; }), 'auch ops, technik, bord, bot.* und nav.sprung ohne Bots: kein_bot');
  const Q = partie({ bots: ['ops'] });
  lauf(Q, 3);
  let gerufen = 0;
  haken('ops', 'ops.scan', () => { gerufen++; return { ok: true }; }, () => {
    const bot = botVon(Q, 'ops');
    const n0 = Q.c.inbox.length; const nb = bot.conn.inbox ? bot.conn.inbox.length : 0;
    Q.g.handleMessage(bot.conn, cmd('ops.scan', 'ops'));
    ok(gerufen === 0 && Q.c.inbox.length === n0 && (bot.conn.inbox ? bot.conn.inbox.length === nb : true), 'Bot als Absender: abgewiesen, kein Registry-Aufruf, keine Antwort an irgendwen');
    const m = einz(Q, cmd('ops.scan', 'ops'));
    ok(gerufen === 1 && m && m.status === 'ok', 'Gegenprobe: derselbe Befehl vom Menschen ruft die Registry');
  });
}

// ---------- 3 Lobby ----------
section('3 Lobby und Partieende: abgelehnt phase');
{
  const P = partie({ bots: ['ops'], start: false });
  const a = einz(P, cmd('ops.scan', 'ops'));
  ok(a && a.status === 'abgelehnt' && a.textId === 'ops.scan.abgelehnt.phase', 'Lobby: abgelehnt, Grund phase');
  const u = einz(P, cmd('quatsch.befehl', 'ops'));
  ok(u && u.status === 'abgelehnt' && u.textId === 'befehl.abgelehnt.phase' && u.befehl === null, 'Lobby, unbekannter Befehl: textId befehl.abgelehnt.phase, befehl null');
  P.g.handleMessage(P.c, { t: 'ready', ready: true }); lauf(P, 2);
  const l = einz(P, cmd('ops.scan', 'ops'));
  ok(P.g.phase === 'play' && l && grund(l) === 'unbekannt', 'Partie laeuft: die Phase lehnt nicht mehr ab (leere Registry: unbekannt)');
  P.g.phase = 'end';
  const e = einz(P, cmd('ops.scan', 'ops'));
  ok(e && grund(e) === 'phase', 'Partieende (phase end): abgelehnt, Grund phase');
}

// ---------- 4 Gruende ----------
section('4 Gruende');
{
  const P = partie({ bots: ['navigation', 'ops'] });
  lauf(P, 40, () => ['navigation', 'ops'].every((r) => Station.stationOf(botVon(P, r)) !== null));
  const ops = botVon(P, 'ops');
  // unbekannt
  for (const [titel, m] of [['falscher Name', cmd('nav.quatsch', 'navigation')], ['kein Name', { t: 'bot.befehl', an: 'ops', quelle: 'menu' }], ['Zahl als Name', cmd(5, 'ops')], ['__proto__', cmd('__proto__', 'ops')], ['constructor', cmd('constructor', 'ops')], ['leerer Name', cmd('', 'ops')]]) {
    const a = einz(P, m);
    ok(a && a.status === 'abgelehnt' && a.textId === 'befehl.abgelehnt.unbekannt' && a.befehl === null && typeof a.text === 'string', 'unbekannt: ' + titel);
  }
  const l = einz(P, cmd('ops.scan', 'ops'));
  ok(l && l.status === 'abgelehnt' && l.textId === 'ops.scan.abgelehnt.unbekannt' && l.botId === ops.botId, 'leere Registry: abgelehnt, Grund unbekannt, mit botId des Bots');
  // quelle
  for (const [titel, q] of [['fehlt', undefined], ['unbekannt', 'telepathie'], ['Zahl', 7], ['__proto__', '__proto__']]) {
    const m = cmd('ops.scan', 'ops', undefined, q); if (q === undefined) delete m.quelle;
    const a = einz(P, m); ok(a && a.textId === 'ops.scan.abgelehnt.quelle', 'quelle ' + titel + ': abgelehnt quelle');
  }
  ok(['menu', 'taste', 'sprache', 'text'].every((q) => { const a = einz(P, cmd('ops.scan', 'ops', undefined, q)); return a && grund(a) !== 'quelle'; }), 'alle vier gueltigen Quellen werden angenommen (menu, taste, sprache, text)');
  const sp = (q) => grund(einz(P, cmd('nav.sprung', 'navigation', { ziel: 'basis' }, q)));
  ok(sp('sprache') === 'quelle' && sp('text') === 'quelle' && sp('menu') !== 'quelle' && sp('taste') !== 'quelle', 'nav.sprung: per Sprache und Text abgelehnt (quelle), per Menue und Taste angenommen');
  // adressat
  for (const [titel, m] of [['tech.schild an ops', cmd('tech.schild', 'ops', { sektor: 'bug' })], ['nav.stopp an alle', cmd('nav.stopp', 'alle')], ['bot.status an bord', cmd('bot.status', 'bord')], ['an unbekannte Rolle', cmd('ops.scan', 'koch')], ['an fehlt', { t: 'bot.befehl', befehl: 'ops.scan', quelle: 'menu' }], ['an Zahl', cmd('ops.scan', 3)], ['an b9', cmd('ops.scan', 'b9')], ['an __proto__', cmd('ops.scan', '__proto__')], ['nav.stopp an botId des ops-Bots', cmd('nav.stopp', ops.botId)], ['bord.sensor an navigation', cmd('bord.sensor', 'navigation')]]) {
    const a = einz(P, m); ok(a && a.status === 'abgelehnt' && grund(a) === 'adressat', 'adressat: ' + titel);
  }
  // argument (Muell)
  const ARG = [
    ['nav.schub', 'navigation', { stufe: 7 }], ['nav.schub', 'navigation', { stufe: -1 }], ['nav.schub', 'navigation', { stufe: 2.5 }], ['nav.schub', 'navigation', { stufe: 'viel' }], ['nav.schub', 'navigation', {}], ['nav.schub', 'navigation', { stufe: 3, extra: 1 }],
    ['nav.schub', 'navigation', { stufe: { a: 1 } }], ['nav.schub', 'navigation', { stufe: [1] }], ['nav.schub', 'navigation', { stufe: null }], ['nav.schub', 'navigation', { stufe: true }], ['nav.schub', 'navigation', { stufe: NaN }], ['nav.schub', 'navigation', { stufe: Infinity }],
    ['nav.abstand', 'navigation', { meter: 0 }], ['nav.abstand', 'navigation', { meter: 100001 }], ['nav.abstand', 'navigation', { meter: '500' }], ['nav.abstand', 'navigation', { meter: NaN }], ['nav.abstand', 'navigation', { ziel: 'mond' }],
    ['nav.kurs', 'navigation', { ziel: 'hex:' }], ['nav.kurs', 'navigation', { ziel: 'objekt:a b' }], ['nav.kurs', 'navigation', {}],
    ['nav.stopp', 'navigation', { stufe: 1 }], ['nav.stopp', 'navigation', [1, 2]], ['nav.stopp', 'navigation', 'text'], ['nav.stopp', 'navigation', 5],
    ['ops.beamen', 'ops', {}], ['ops.beamen', 'ops', { was: 'kaffee' }], ['ops.ziel', 'ops', { ziel: 'alles' }], ['ops.feuer_frei', 'ops', { waffen: 'kanone' }], ['ops.feuer_frei', 'ops', { waffen: 'alle', meter: 5 }],
    ['tech.energie', 'technik', { system: 'engines' }], ['tech.energie', 'technik', { system: 'engines', delta: 2 }], ['tech.energie', 'technik', { system: 'reactor', delta: 1 }], ['tech.energie', 'technik', { system: 'engines', delta: '++1' }], ['tech.energie', 'technik', { system: 'engines', delta: '1.0' }], ['tech.energie', 'technik', { system: 'engines', delta: 0 }],
    ['ops.ziel', 'ops', { ziel: 'hex:e4' }],
    ['tech.schild', 'technik', { sektor: 'oben' }], ['tech.reparieren', 'technik', {}], ['tech.reparieren', 'technik', { system: 'kombuese' }], ['tech.prio', 'technik', { ziel: 5 }],
    ['nav.sprung', 'navigation', {}], ['nav.sprung', 'navigation', { ziel: '' }], ['bot.status', 'alle', { x: 1 }],
  ];
  const bad = ARG.filter(([b, an, args]) => { const a = einz(P, cmd(b, an, args)); return !(a && a.status === 'abgelehnt' && grund(a) === 'argument'); });
  ok(bad.length === 0, `argument: ${ARG.length} Muellfaelle (Typ, Wertebereich, Pflicht, Fremdschluessel, Array, Text) -> abgelehnt, nie eine Ausnahme` + (bad.length ? ' - nicht abgelehnt: ' + JSON.stringify(bad.slice(0, 3)) : ''));
  ok(grund(einz(P, cmd('nav.schub', 'navigation', JSON.parse('{"stufe":"halb","__proto__":{"x":1}}')))) === 'argument', 'argument: __proto__ als eigener Schluessel wird abgelehnt');
  // gueltige Argumente erreichen die Registry (Gegenprobe: nicht zu streng)
  const GUT = [
    ['nav.schub', 'navigation', { stufe: 0 }], ['nav.schub', 'navigation', { stufe: 6 }], ['nav.schub', 'navigation', { stufe: '3' }], ['nav.schub', 'navigation', { stufe: 'halb' }], ['nav.schub', 'navigation', { stufe: 'voll' }],
    ['nav.kurs', 'navigation', { ziel: 'marke' }], ['nav.kurs', 'navigation', { ziel: 'hex:7_3' }], ['nav.kurs', 'navigation', { ziel: 'objekt:abc-1' }], ['nav.abstand', 'navigation', {}], ['nav.abstand', 'navigation', { meter: 1 }], ['nav.abstand', 'navigation', { meter: 100000 }], ['nav.abstand', 'navigation', { ziel: 'ziel', meter: 500 }],
    ['nav.stopp', 'navigation', undefined], ['nav.stopp', 'navigation', null], ['nav.stopp', 'navigation', {}], ['nav.sprung', 'navigation', { ziel: 'hex:12' }],
    ['ops.ziel', 'ops', { ziel: 'markiert' }], ['ops.ziel', 'ops', { ziel: 'naechstes' }], ['ops.ziel', 'ops', { ziel: 'objekt:e4' }], ['ops.feuer_frei', 'ops', undefined], ['ops.feuer_frei', 'ops', {}], ['ops.feuer_frei', 'ops', { waffen: 'torpedo' }], ['ops.beamen', 'ops', { was: 'fracht' }],
    ['tech.prio', 'technik', { ziel: 'feuer' }], ['tech.prio', 'technik', { ziel: 'weapon_bow' }], ['tech.reparieren', 'technik', { system: 'lafette_9' }], ['tech.schild', 'technik', { sektor: 'heck' }], ['tech.energie', 'technik', { system: 'weapons', delta: -1 }], ['tech.energie', 'technik', { system: 'shields', delta: 1 }],
    ['tech.energie', 'technik', { system: 'engines', delta: '+1' }], ['tech.energie', 'technik', { system: 'engines', delta: '-1' }], ['tech.energie', 'technik', { system: 'engines', delta: '1' }],
  ];
  const G3 = partie({ bots: ['navigation', 'ops', 'technik'] }); lauf(G3, 3);
  const zu = []; const gesehen = [];
  for (const [b, an, args] of GUT) {
    const a = haken(an, b, (g, bot, ar) => { gesehen.push([b, ar]); return { ok: true }; }, () => einz(G3, cmd(b, an, args)));
    if (!(a && a.status === 'ok' && a.textId === b + '.ok')) zu.push(b + JSON.stringify(args));
  }
  ok(zu.length === 0 && gesehen.length === GUT.length, `gueltige Argumente (${GUT.length} Faelle, auch fehlende optionale und hex/objekt, Grenzwerte): angenommen, ok` + (zu.length ? ' - zu streng: ' + zu.join(' ') : ''));
  const ohneFeuer = gesehen.find(([b, a]) => b === 'ops.feuer_frei' && Object.keys(a).length === 0);
  ok(!!ohneFeuer, 'fehlende optionale Argumente gehen unveraendert (nicht aufgefuellt) an die Registry - das Auffuellen ist C2');
  // K3: die Registry bekommt normalisierte Kopien (Zahlen statt Text), nie das Original
  const NORM = [
    ['nav.schub', 'navigation', { stufe: '3' }, { stufe: 3 }], ['nav.schub', 'navigation', { stufe: 4 }, { stufe: 4 }], ['nav.schub', 'navigation', { stufe: 'halb' }, { stufe: 'halb' }],
    ['tech.energie', 'technik', { system: 'engines', delta: '+1' }, { system: 'engines', delta: 1 }], ['tech.energie', 'technik', { system: 'engines', delta: '-1' }, { system: 'engines', delta: -1 }],
    ['tech.energie', 'technik', { system: 'weapons', delta: '1' }, { system: 'weapons', delta: 1 }], ['tech.energie', 'technik', { system: 'weapons', delta: 1 }, { system: 'weapons', delta: 1 }], ['tech.energie', 'technik', { system: 'weapons', delta: -1 }, { system: 'weapons', delta: -1 }],
    ['nav.abstand', 'navigation', { ziel: 'ziel', meter: 500 }, { ziel: 'ziel', meter: 500 }],
  ];
  const nBad = [];
  for (const [b, an, args, soll] of NORM) {
    let ist = null;
    const orig = JSON.parse(JSON.stringify(args));
    haken(an, b, (g, bot, ar) => { ist = ar; return { ok: true }; }, () => einz(G3, cmd(b, an, args)));
    if (!ist || JSON.stringify(ist) !== JSON.stringify(soll) || Object.keys(soll).some((k) => typeof ist[k] !== typeof soll[k]) || ist === args || JSON.stringify(args) !== JSON.stringify(orig)) nBad.push(b + JSON.stringify(args) + ' -> ' + JSON.stringify(ist));
  }
  ok(nBad.length === 0, `Normalisierung (${NORM.length} Faelle): stufe als Zahl, delta als Zahl 1/-1, halb bleibt Text, meter Zahl; Registry sieht eine Kopie, das Original bleibt` + (nBad.length ? ' - ' + nBad.join(' ') : ''));
  // K2: hex:<id> und objekt:<id> sind nicht sprechbar; ops.ziel kennt nur objekt:<id>
  const FREI = [['nav.kurs', 'navigation', { ziel: 'hex:7_3' }], ['nav.kurs', 'navigation', { ziel: 'objekt:abc' }], ['nav.abstand', 'navigation', { ziel: 'hex:1' }], ['nav.abstand', 'navigation', { ziel: 'objekt:x' }], ['ops.ziel', 'ops', { ziel: 'objekt:e4' }]];
  const frei = [];
  for (const q of ['sprache', 'text']) for (const [b, an, args] of FREI) { const a = einz(G3, cmd(b, an, args, q)); if (!(a && a.status === 'abgelehnt' && grund(a) === 'argument')) frei.push(q + ':' + b + JSON.stringify(args)); }
  ok(frei.length === 0, `hex:/objekt: per Sprache und Text: abgelehnt argument (${FREI.length * 2} Faelle)` + (frei.length ? ' - angenommen: ' + frei.join(' ') : ''));
  const treffer = [];
  for (const q of ['menu', 'taste']) for (const [b, an, args] of FREI) haken(an, b, () => ({ ok: true }), () => { const a = einz(G3, cmd(b, an, args, q)); if (!(a && a.status === 'ok')) treffer.push(q + ':' + b); });
  ok(treffer.length === 0, 'dieselben Ziele per Menue und Taste: angenommen');
  ok(['marke', 'ziel', 'basis'].every((z) => haken('navigation', 'nav.kurs', () => ({ ok: true }), () => { const a = einz(G3, cmd('nav.kurs', 'navigation', { ziel: z }, 'sprache')); return a && a.status === 'ok'; })), 'feste Ziele (marke, ziel, basis) bleiben per Sprache sprechbar');
  ok(grund(einz(G3, cmd('ops.ziel', 'ops', { ziel: 'hex:e4' }, 'menu'))) === 'argument' && grund(einz(G3, cmd('ops.ziel', 'ops', { ziel: 'hex:e4' }, 'taste'))) === 'argument', 'ops.ziel nimmt auch per Menue/Taste kein hex:<id> (Vertrag: nur objekt:<id>)');
  // kein_bot
  const kbRolle = einz(P, cmd('tech.schild', 'technik', { sektor: 'bug' }));
  ok(kbRolle && kbRolle.status === 'unmoeglich' && grund(kbRolle) === 'kein_bot', 'Rolle ohne Bot (nur navigation und ops da): unmoeglich kein_bot');
  const kb = einz(P, cmd('nav.stopp', 'b3'));
  ok(kb && kb.status === 'unmoeglich' && kb.textId === 'nav.stopp.unmoeglich.kein_bot' && kb.botId === 'b3', 'botId ohne Bot: unmoeglich kein_bot');
  // wartet: Mensch haelt die Station des Ops-Bots
  interior.enterConsole(P.g, P.h, 'captain');
  haken('ops', 'ops.scan', () => ({ ok: true }), () => {
    const vorher = einz(P, cmd('ops.scan', 'ops'));
    ok(vorher && vorher.status === 'ok', 'Ausgangslage: Ops-Bot nimmt den Befehl an (Registry ok)');
    let f = null, tab = 0;
    while (Station.stationOf(P.h) !== 'weapons' && tab++ < 6) f = Station.tab(P.g, P.h, 1);   // Tab bis zur Station des Ops-Bots (Ops = Konsole weapons); der Navigations-Bot weicht unterwegs kurz
    lauf(P, 25, () => Lauf.agent(P.g, botVon(P, 'navigation')).absicht.zustand !== 'wartet');
    const agent = Lauf.agent(P.g, ops);
    const w = einz(P, cmd('ops.scan', 'ops'));
    ok(Station.stationOf(P.h) === 'weapons' && agent.absicht.zustand === 'wartet' && w && w.status === 'abgelehnt' && w.textId === 'ops.scan.abgelehnt.wartet', 'Mensch haelt die Station: abgelehnt, Grund wartet' + (Station.stationOf(P.h) === 'weapons' ? '' : ' (Tab: ' + f + ')'));
    const andere = einz(P, cmd('nav.stopp', 'navigation'));
    ok(andere && andere.textId.startsWith('nav.stopp.') && grund(andere) !== 'wartet', 'der Navigations-Bot (wartet nicht) ist davon unberuehrt (C2a: echte Registry, nie wartet)');
    const bs = einz(P, cmd('bot.status', ops.botId));
    ok(bs && grund(bs) === 'unbekannt', 'bot.* kennt keinen Wartezustand (laeuft bis zur Registry)');
  });
  // rate
  const R = partie({ bots: ['ops'] }); lauf(R, 3);
  const erg = haken('ops', 'ops.scan', () => ({ ok: true }), () => { jetzt += 5000; const l1 = []; for (let i = 0; i < 12; i++) l1.push(...senden(R, cmd('ops.scan', 'ops'))); return l1; });
  ok(erg.length === 11 && erg.slice(0, 10).every((a) => a.status === 'ok') && erg[10].status === 'abgelehnt' && erg[10].textId === 'ops.scan.abgelehnt.rate', 'Rate: 10 Befehle je Sekunde angenommen, der 11. abgelehnt (rate), der 12. wird still verworfen (K4)');
  jetzt += 5000;
  const wieder = haken('ops', 'ops.scan', () => ({ ok: true }), () => { for (let i = 0; i < 10; i++) senden(R, cmd('ops.scan', 'ops')); const x = senden(R, cmd('ops.scan', 'ops'))[0]; jetzt += 1100; const y = senden(R, cmd('ops.scan', 'ops'))[0]; return [x, y]; });
  ok(grund(wieder[0]) === 'rate' && wieder[1].status === 'ok', 'Rate ist kein Dauerzustand: eine Sekunde spaeter wird wieder angenommen');
  let wirkung = 0;
  haken('ops', 'ops.scan', () => { wirkung++; return { ok: true }; }, () => { jetzt += 5000; for (let i = 0; i < 25; i++) senden(R, cmd('ops.scan', 'ops')); });
  ok(wirkung === 10, 'abgelehnt wegen rate: nur Antwort, nie Wirkung (25 gesendet, 10 ausgefuehrt)');
  jetzt += 5000;
  const unb = []; for (let i = 0; i < 12; i++) unb.push(...senden(R, cmd('quatsch', 'ops')));
  ok(unb.length === 11 && unb.slice(0, 10).every((a) => a.textId === 'befehl.abgelehnt.unbekannt') && unb[10].textId === 'befehl.abgelehnt.rate', 'Rate gilt auch fuer unbekannte Befehle (textId befehl.abgelehnt.rate)');
  // K4: keine Antwort-Flut, pro Spieler und Fenster nur die erste Rate-Ablehnung wird beantwortet
  jetzt += 5000;
  const flut = haken('ops', 'ops.scan', () => ({ ok: true }), () => { const l = []; for (let i = 0; i < 100; i++) l.push(...senden(R, cmd('ops.scan', 'ops'))); return l; });
  ok(flut.length === 11 && flut.filter((a) => grund(a) === 'rate').length === 1, 'Flut: 100 Nachrichten im Fenster -> 10 ok und genau eine Rate-Antwort (nicht 90)');
  jetzt += 1100;   // naechstes Fenster: wieder angenommen, die naechste Ueberschreitung wird wieder einmal gemeldet
  const flut2 = haken('ops', 'ops.scan', () => ({ ok: true }), () => { const l = []; for (let i = 0; i < 30; i++) l.push(...senden(R, cmd('ops.scan', 'ops'))); return l; });
  ok(flut2.length === 11 && flut2.slice(0, 10).every((a) => a.status === 'ok') && grund(flut2[10]) === 'rate', 'naechstes Fenster: 10 ok, wieder genau eine Rate-Antwort (kein Dauerzustand)');
  // W2: Rate gilt je Spieler, nicht global (zwei Menschen)
  {
    const g = neuesGame(); const cA = mkConn(), cB = mkConn();
    for (const [c, id] of [[cA, 'KA'], [cB, 'KB']]) { g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: id, name: id, color: 0 }); }
    BotSpieler.botHinzufuegen(g, null, 'ops');
    g.lobbyOpts.startMission = 'arena_space';
    g.handleMessage(cA, { t: 'ready', ready: true }); g.handleMessage(cB, { t: 'ready', ready: true });
    if (g.arena) { g.arena.nextAt = 1e9; g.space.enemies = []; }
    const Q = { g, c: cA, h: cA.player };
    lauf(Q, 3);
    ok(g.phase === 'play' && cA.player && cB.player && cA.player.id !== cB.player.id, 'Zwei Menschen in einer laufenden Partie');
    const r = haken('ops', 'ops.scan', () => ({ ok: true }), () => {
      jetzt += 5000;
      const a = []; for (let i = 0; i < 14; i++) a.push(...senden(Q, cmd('ops.scan', 'ops'), cA));
      const b1 = senden(Q, cmd('ops.scan', 'ops'), cB);
      const a2 = senden(Q, cmd('ops.scan', 'ops'), cA);
      const b2 = []; for (let i = 0; i < 9; i++) b2.push(...senden(Q, cmd('ops.scan', 'ops'), cB));
      return { a, b1, a2, b2 };
    });
    ok(r.a.length === 11 && r.a.slice(0, 10).every((x) => x.status === 'ok') && grund(r.a[10]) === 'rate', 'Mensch A flutet ueber das Limit: 10 ok, dann Rate');
    ok(r.b1.length === 1 && r.b1[0].status === 'ok' && r.b2.length === 9 && r.b2.every((x) => x.status === 'ok'), 'Mensch B wird weiter angenommen (eigene Zaehlung: 10 Befehle, alle ok)');
    ok(r.a2.length === 0, 'A bleibt gedrosselt (weitere Nachricht im Fenster: verworfen)');
    const b3 = haken('ops', 'ops.scan', () => ({ ok: true }), () => senden(Q, cmd('ops.scan', 'ops'), cB));
    ok(b3.length === 1 && grund(b3[0]) === 'rate', 'B hat jetzt ebenfalls sein Limit erreicht (eigene Rate-Antwort)');
  }
  // kein_ziel und system aus der Registry
  const Z = partie({ bots: ['navigation', 'ops'] }); lauf(Z, 3);
  const kz = haken('ops', 'ops.feuer_frei', () => ({ ok: false, code: 'kein_ziel' }), () => einz(Z, cmd('ops.feuer_frei', 'ops')));
  ok(kz && kz.status === 'abgelehnt' && kz.textId === 'ops.feuer_frei.abgelehnt.kein_ziel' && typeof kz.text === 'string', 'Registry meldet kein_ziel: abgelehnt, Grund kein_ziel');
  const ky = haken('navigation', 'nav.abstand', () => ({ ok: false, code: 'kein_ziel' }), () => einz(Z, cmd('nav.abstand', 'navigation')));
  ok(ky && ky.textId === 'nav.abstand.abgelehnt.kein_ziel', 'nav.abstand ohne markiertes Ziel: abgelehnt kein_ziel');
  const sy = haken('ops', 'ops.scan', () => ({ ok: false, code: 'system' }), () => einz(Z, cmd('ops.scan', 'ops')));
  ok(sy && sy.status === 'unmoeglich' && sy.textId === 'ops.scan.unmoeglich.system', 'Registry meldet system (zerstoert): unmoeglich, Grund system');
  // kein_ziel auch bei nav.sprung und nav.andocken; nicht_jetzt fuer Rollenbefehle und bord.*
  const ks = haken('navigation', 'nav.sprung', () => ({ ok: false, code: 'kein_ziel' }), () => einz(Z, cmd('nav.sprung', 'navigation', { ziel: 'marke' })));
  const ka = haken('navigation', 'nav.andocken', () => ({ ok: false, code: 'kein_ziel' }), () => einz(Z, cmd('nav.andocken', 'navigation')));
  ok(ks && ks.textId === 'nav.sprung.abgelehnt.kein_ziel' && typeof ks.text === 'string' && ka && ka.textId === 'nav.andocken.abgelehnt.kein_ziel' && typeof ka.text === 'string', 'nav.sprung und nav.andocken melden kein_ziel: eigener Text statt Fehler');
  const NJ = [['ops', 'ops.beamen', 'ops', { was: 'fracht' }], ['ops', 'ops.landescan', 'ops'], ['navigation', 'nav.ausweichen', 'navigation'], ['navigation', 'nav.andocken', 'navigation']];
  const njBad = [];
  for (const [reg, b, an, args] of NJ) {
    const a = haken(reg, b, () => ({ ok: false, code: 'nicht_jetzt' }), () => einz(Z, cmd(b, an, args)));
    if (!(a && a.status === 'abgelehnt' && a.textId === b + '.abgelehnt.nicht_jetzt' && typeof a.text === 'string' && a.text === TEXTE[a.textId][a.variante])) njBad.push(b);
  }
  ok(njBad.length === 0, 'Registry meldet nicht_jetzt (Beamen ohne Fracht, Landescan, Ausweichen, Andocken): abgelehnt, Text je Befehl' + (njBad.length ? ' - ' + njBad.join(' ') : ''));
  ok(Object.keys(GRUENDE.befehle).filter((b) => b.startsWith('bord.')).every((b) => GRUENDE.befehle[b].includes('nicht_jetzt') && Array.isArray(TEXTE[b + '.abgelehnt.nicht_jetzt'])), 'bord.*: nicht_jetzt vorgesehen, Text vorhanden');
  // W1: nicht vorgesehene Codes und Ausnahmen -> abgelehnt fehler + countError('bot.grund'), nie stilles unbekannt
  const FEHL = [];
  const ce0 = Z.g.countError; Z.g.countError = (wo, e) => { FEHL.push([wo, e && e.message]); };
  const f1 = (code, b, an, reg, args) => haken(reg, b, () => ({ ok: false, code }), () => einz(Z, cmd(b, an, args)));
  const fremd = f1('erfunden', 'ops.scan', 'ops', 'ops');
  const fremd2 = f1('kein_ziel', 'ops.scan', 'ops', 'ops');
  const fremd3 = f1('nicht_jetzt', 'bot.status', 'ops', 'bot');
  ok(fremd && fremd.status === 'abgelehnt' && fremd.textId === 'ops.scan.abgelehnt.fehler' && typeof fremd.text === 'string' && fremd2 && fremd2.textId === 'ops.scan.abgelehnt.fehler' && fremd3 && fremd3.textId === 'bot.status.abgelehnt.fehler', 'ein Code, der fuer den Befehl nicht vorgesehen ist (erfunden, kein_ziel bei ops.scan, nicht_jetzt bei bot.status): abgelehnt fehler');
  ok(FEHL.length === 3 && FEHL.every(([wo]) => wo === 'bot.grund') && /ops\.scan/.test(FEHL[0][1]) && /erfunden/.test(FEHL[0][1]) && /kein_ziel/.test(FEHL[1][1]) && /bot\.status/.test(FEHL[2][1]), 'jeder dieser Faelle wird per countError("bot.grund") mit Befehl und Code gezaehlt');
  FEHL.length = 0;
  const nichts = haken('ops', 'ops.scan', () => undefined, () => einz(Z, cmd('ops.scan', 'ops')));
  const falsch = haken('ops', 'ops.scan', () => ({ ok: 'ja' }), () => einz(Z, cmd('ops.scan', 'ops')));
  ok(nichts && nichts.status === 'abgelehnt' && nichts.textId === 'ops.scan.abgelehnt.fehler' && falsch && falsch.textId === 'ops.scan.abgelehnt.fehler' && FEHL.length === 2, 'nur ok === true gilt als angenommen (undefined oder "ja": abgelehnt fehler, gezaehlt)');
  FEHL.length = 0;
  const gut = haken('ops', 'ops.scan', () => ({ ok: false, code: 'unbekannt' }), () => einz(Z, cmd('ops.scan', 'ops')));
  const gut2 = haken('ops', 'ops.scan', () => ({ ok: false, code: 'system' }), () => einz(Z, cmd('ops.scan', 'ops')));
  ok(grund(gut) === 'unbekannt' && grund(gut2) === 'system' && FEHL.length === 0, 'vorgesehene Codes (unbekannt, system) gelten unveraendert und zaehlen keinen Fehler');
  const ausn = haken('ops', 'ops.scan', () => { throw new Error('kaputt'); }, () => einz(Z, cmd('ops.scan', 'ops')));
  ok(ausn && ausn.status === 'abgelehnt' && ausn.textId === 'ops.scan.abgelehnt.fehler' && FEHL.length === 1 && FEHL[0][0] === 'bot.grund' && /ops\.scan/.test(FEHL[0][1]) && /kaputt/.test(FEHL[0][1]), 'Ausnahme in der Registry-Funktion: abgelehnt fehler (nicht unbekannt), ein countError("bot.grund") mit Befehl und Ursache');
  Z.g.countError = ce0;
  // an alle: eine Ausnahme bei einem Bot, die anderen Bots antworten normal
  const Y = partie({ bots: ['navigation', 'ops'] }); lauf(Y, 3);
  Y.g.countError = () => {};
  const teilw = haken('bot', 'bot.status', (g, bot) => { if (bot.rolle === 'ops') throw new Error('x'); return { ok: true }; }, () => ein(Y, cmd('bot.status', 'alle')));
  ok(teilw.length === 2 && teilw.filter((x) => x.status === 'ok').length === 1 && teilw.filter((x) => grund(x) === 'fehler').length === 1, 'an alle: Ausnahme bei einem Bot trifft nur dessen Antwort (fehler), der andere antwortet ok');
}

// ---------- 5 Adressierung ----------
section('5 Adressierung: Rolle, botId, alle, bord');
{
  const P = partie({ bots: ['navigation', 'ops', 'technik'] }); lauf(P, 3);
  const [bn, bo, bt] = ['navigation', 'ops', 'technik'].map((r) => botVon(P, r));
  const ruf = [];
  const EINTR = [['navigation', 'nav.stopp'], ['ops', 'ops.scan'], ['technik', 'tech.ueberladen'], ['bot', 'bot.status'], ['bot', 'bot.automatik'], ['bord', 'bord.sensor']];
  const ALT = EINTR.map(([r, b]) => (hatEintrag(r, b) ? Befehle.REGISTER[r][b] : undefined));
  for (const [r, b] of EINTR) Befehle.REGISTER[r][b] = (g, bot) => { ruf.push(bot.botId + ':' + b); return { ok: true }; };
  try {
    let a = ein(P, cmd('nav.stopp', 'navigation'));
    ok(a.length === 1 && a[0].botId === bn.botId && ruf.join() === bn.botId + ':nav.stopp', 'an Rolle navigation: genau der Navigations-Bot, eine Antwort mit seiner botId');
    ruf.length = 0; a = ein(P, cmd('ops.scan', bo.botId));
    ok(a.length === 1 && a[0].botId === bo.botId && a[0].status === 'ok' && ruf.join() === bo.botId + ':ops.scan', 'an botId: dieser Bot');
    ruf.length = 0; a = ein(P, cmd('ops.scan', bn.botId));
    ok(a.length === 1 && grund(a[0]) === 'adressat' && ruf.length === 0, 'ops.scan an die botId des Navigations-Bots: adressat, keine Wirkung');
    ruf.length = 0; a = ein(P, cmd('bot.status', 'alle'));
    ok(a.length === 3 && new Set(a.map((x) => x.botId)).size === 3 && [bn, bo, bt].every((b) => a.some((x) => x.botId === b.botId && x.status === 'ok' && x.befehl === 'bot.status')) && ruf.length === 3, 'bot.status an alle: eine Antwort je Bot, jede mit eigener botId, jeder Bot gerufen');
    ruf.length = 0; a = ein(P, cmd('bot.automatik', bt.botId));
    ok(a.length === 1 && a[0].botId === bt.botId && ruf.join() === bt.botId + ':bot.automatik', 'bot.automatik an eine botId: nur dieser Bot');
    ruf.length = 0; a = ein(P, cmd('bot.status', 'ops'));
    ok(a.length === 1 && a[0].botId === bo.botId, 'bot.status an eine Rolle: der eine Bot dieser Rolle');
    ruf.length = 0; a = ein(P, cmd('bord.sensor', 'bord'));
    ok(a.length === 1 && a[0].status === 'unmoeglich' && a[0].textId === 'bord.sensor.unmoeglich.kein_bot' && ruf.length === 0, 'an bord: unmoeglich kein_bot (kein Bord-Bot bis BOT-02), keine Wirkung');
    ruf.length = 0; a = ein(P, cmd('nav.stopp', 'alle'));
    ok(a.length === 1 && grund(a[0]) === 'adressat' && ruf.length === 0, 'Rollenbefehl an alle: adressat (nur bot.* geht an mehrere)');
  } finally { EINTR.forEach(([r, b], i) => { if (ALT[i]) Befehle.REGISTER[r][b] = ALT[i]; else delete Befehle.REGISTER[r][b]; }); }
  // an alle mit drei Bots: die Textvariante wechselt je Bot ab (Schluessel botId|textId), nicht gemeinsam
  const V = partie({ bots: ['navigation', 'ops', 'technik'] }); lauf(V, 3);
  const va = haken('bot', 'bot.status', () => ({ ok: true }), () => [ein(V, cmd('bot.status', 'alle')), ein(V, cmd('bot.status', 'alle'))]);
  ok(va[0].length === 3 && va[1].length === 3 && va[0].every((x) => x.variante === 0) && va[1].every((x) => x.variante === 1), 'an alle mit drei Bots: jeder Bot beginnt bei Variante 0 und wechselt je Aufruf auf 1 (Zaehler je Bot)');
  // nur verbundene Bots werden angesprochen
  const W = partie({ bots: ['ops'] }); lauf(W, 3);
  const wb = botVon(W, 'ops'); wb.connected = false;
  const wk = einz(W, cmd('ops.scan', 'ops')); const wa = einz(W, cmd('bot.status', 'alle'));
  wb.connected = true;
  ok(wk && wk.status === 'unmoeglich' && grund(wk) === 'kein_bot' && wa && grund(wa) === 'kein_bot', 'getrennter Bot (connected false) wird nicht angesprochen: kein_bot');
  const S = partie({ bots: ['navigation', 'ops'] }); lauf(S, 3);
  const teil = haken('bot', 'bot.status', (g, bot) => (bot.rolle === 'ops' ? { ok: false, code: 'unbekannt' } : { ok: true }), () => ein(S, cmd('bot.status', 'alle')));
  ok(teil.length === 2 && teil.filter((x) => x.status === 'ok').length === 1 && teil.filter((x) => x.status === 'abgelehnt').length === 1, 'an alle: Ergebnis je Bot einzeln (einer ok, einer abgelehnt)');
}

// ---------- 6 Antwort ----------
section('6 Antwort: Form, Text, Variante, Ausnahme');
{
  const P = partie({ bots: ['ops'] }); lauf(P, 3);
  const ant = haken('ops', 'ops.scan', () => ({ ok: true }), () => { const l = []; for (let i = 0; i < 4; i++) l.push(ein(P, cmd('ops.scan', 'ops'))[0]); return l; });
  const a = ant[0];
  ok(a.t === 'bot.antwort' && Object.keys(a).sort().join() === 'befehl,botId,status,t,text,textId,variante' && a.textId === 'ops.scan.ok', 'Form: t, botId, befehl, status, textId, text, variante - direkt, keine event-Huelle');
  ok(P.c.inbox.every((m) => m.t !== 'event' || m.kind !== 'bot.antwort'), 'keine Antwort als event verpackt');
  ok(ant.every((x) => x.text === TEXTE[x.textId][x.variante]) && ant[0].variante === 0 && ant[1].variante === 1 && ant[2].variante === 0, 'text = TEXTE[textId][variante]; die zwei Varianten wechseln sich ab');
  const abg = einz(P, cmd('nav.stopp', 'navigation'));
  ok(abg && abg.text === TEXTE[abg.textId][abg.variante], 'auch bei Ablehnung: Text und Variante aus der Tabelle');
  const ce = P.g.countError; const gez = []; P.g.countError = (wo) => { gez.push(wo); };   // die erwartete Ausnahme nicht auf die Konsole schreiben
  const eg = haken('ops', 'ops.scan', () => { throw new Error('kaputt'); }, () => { let e = null, a2 = null; try { a2 = einz(P, cmd('ops.scan', 'ops')); } catch (x) { e = x; } return { e, a2 }; });
  ok(eg.e === null && eg.a2 && eg.a2.status === 'abgelehnt' && grund(eg.a2) === 'fehler' && gez.length === 1 && gez[0] === 'bot.grund', 'Registry wirft: keine Ausnahme nach aussen, Antwort abgelehnt fehler, ein Fehlerpfad (bot.grund)');
  P.g.countError = ce;
  let geworfen = 0;
  const err0 = P.g.errors;
  const muell = [{ t: 'bot.befehl' }, { t: 'bot.befehl', an: {}, befehl: {}, quelle: [] }, { t: 'bot.befehl', an: 'ops', befehl: 'ops.scan', quelle: 'menu', args: 'x'.repeat(10000) }, { t: 'bot.befehl', befehl: ['a'], an: null }, { t: 'bot.befehl', an: 'ops', befehl: 'ops.ziel', quelle: 'menu', args: JSON.parse('{"ziel":{"toString":1}}') }];
  for (const m of muell) { try { jetzt += 5000; senden(P, m); } catch (e) { geworfen++; } }
  ok(geworfen === 0 && P.g.errors === err0, 'Muellnachrichten (leer, falsche Typen, riesige args): keine Ausnahme, keine Fehlerzaehlung');
}

// ---------- 7 Reine Menschenpartie ----------
section('7 Reine Menschenpartie: bot.befehl veraendert nichts');
{
  const lauf1 = (mitBefehlen) => {
    const h = crypto.createHash('sha1'); let nSnap = 0, antworten = 0;
    const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
    const g = new Game({ noStore: true, seed: 5, worldDir: dir, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
    const c = { send: (o) => { if (o.t === 'bot.antwort') antworten++; else h.update(JSON.stringify(o)); }, sendRaw: (s) => h.update(s) };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'M0', name: 'M0', color: 0 });
    g.lobbyOpts.startMission = 'arena_space'; g.handleMessage(c, { t: 'ready', ready: true });
    for (let i = 0; i < 600; i++) {
      if (mitBefehlen && i % 7 === 0) { jetzt += 1000; const echt = Date.now; Date.now = () => jetzt; try { g.handleMessage(c, cmd(['nav.stopp', 'ops.scan', 'bot.status', 'quatsch'][(i / 7) % 4], ['navigation', 'ops', 'alle', 'ops'][(i / 7) % 4])); } finally { Date.now = echt; } }
      g.step();
      if (g.wantsSnapshot()) { h.update(JSON.stringify(g.snapshot())); nSnap++; }
    }
    h.update(JSON.stringify([g.errors, g.time, g.rng(), g.players.map((p) => [p.x, p.y, p.console, p.station])]));
    return { hash: h.digest('hex'), nSnap, antworten, felder: Object.keys(g).sort().join() };
  };
  const a = lauf1(false), b = lauf1(true);
  ok(a.nSnap > 100 && a.hash === b.hash, `Snapshots, Nachrichten (ohne die Antwort), Zufallsstand und Spieler identisch mit und ohne bot.befehl (${a.nSnap} Snapshots)`);
  ok(a.antworten === 0 && b.antworten > 50 && a.felder === b.felder, `ohne Befehl keine Antwort, mit Befehl je Befehl eine (${b.antworten}); kein neues Feld an game`);
}

// ---------- 8 Quellscan ----------
section('8 Quellscan');
{
  const game = fs.readFileSync('server/game.js', 'utf8');
  ok((game.match(/BotAnnahme\./g) || []).length === 1 && game.split(/\r?\n/).some((z) => /case C\.BOT_BEFEHL: BotAnnahme\.annehmen\(this, p, msg\); break;/.test(z)), 'game.js: ein duenner Aufruf (case C.BOT_BEFEHL), keine Logik');
  ok(!/befehle\/index|Befehle\.befehl|bot\.antwort/.test(game.replace(/\/\/.*$/gm, '')), 'game.js kennt weder die Registries noch den Antwort-Text');
  const src = fs.readFileSync('server/bots/annahme.js', 'utf8').replace(/\/\/.*$/gm, '');
  ok(!/filter\([^;\n]*connected[^;\n]*\)\s*\.length/.test(src) && /Crew\.istBot/.test(src), 'annahme.js: keine Zaehlung per filter(connected).length, Absenderpruefung ueber Crew.istBot');
  ok(!/bot\.befehl|bot\.antwort/.test(fs.readFileSync('server/bots/spieler.js', 'utf8')), 'spieler.js bleibt frei von bot.befehl/bot.antwort');
}

console.log(`\ntest-bot-annahme: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
