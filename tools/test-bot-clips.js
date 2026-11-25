'use strict';
// BOT-04 B: Selbsttest der Cache-Hash-Logik des Clip-Generators, ohne Netz. BOT-05 A3: dazu Texte je Figur, Manifest je Stimme, Dedupe, Rueckfall.      node tools/test-bot-clips.js
const assert = require('assert');
const path = require('path');
const Clips = require('./bot-clips.js');

const a = Clips.clipHash('profil-1', 'Aye, Schilde Steuerbord');
assert.strictEqual(a, Clips.clipHash('profil-1', 'Aye, Schilde Steuerbord'), 'gleiche Eingabe, gleicher Hash');
assert.notStrictEqual(a, Clips.clipHash('profil-2', 'Aye, Schilde Steuerbord'), 'anderes Profil, anderer Hash');
assert.notStrictEqual(a, Clips.clipHash('profil-1', 'Aye, Schilde Backbord'), 'anderer Text, anderer Hash');
assert.notStrictEqual(Clips.clipHash('ab', 'c'), Clips.clipHash('a', 'bc'), 'Trenner verhindert Verschmelzen von Profil und Text');
assert.ok(/^[0-9a-f]{16}$/.test(a), 'Hash: 16 Hex-Zeichen');
assert.strictEqual(path.basename(Clips.clipPath('p', 't', '/x')), Clips.clipHash('p', 't') + '.wav');
assert.deepStrictEqual(Clips.qwenProfile([{ default_engine: 'qwen', name: 'a' }, { default_engine: 'chatterbox', name: 'k' }, { default_engine: null, name: 'o' }]).map(p => p.name), ['a']);

// ---- Vorrat (BOT-04 B2): Vollständigkeit, Stimmen-Zuordnung, Clipwahl und Fallback über die echte Funktion aus public/js/bot-sprache.js
const fs = require('fs');
const BotSprache = require('../public/js/bot-sprache.js');
const texte = JSON.parse(fs.readFileSync(Clips.TEXTE, 'utf8'));
const stimmen = JSON.parse(fs.readFileSync(Clips.STIMMEN, 'utf8'));
assert.deepStrictEqual(Object.keys(stimmen), ['b0', 'b1', 'b2'], 'drei Stimmen b0 bis b2');
const ids = new Set();
for (const [botId, s] of Object.entries(stimmen)) {
  assert.ok(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s.profilId) && s.profilName, botId + ': Profil-ID und -Name');
  assert.ok(!ids.has(s.profilId), botId + ': Profil nur einmal vergeben'); ids.add(s.profilId);
  assert.ok(!/passwor|auth/i.test(JSON.stringify(s)), 'kein Zugangsdatum in der Zuordnung');
}
assert.ok(Object.keys(texte).length >= 24 && texte['bot.unklar'], 'texte.json: Katalogbefehle und bot.unklar');
// S3: Befehle mit Argumenten bekommen argumentneutrale Bestaetigungen (eine falsche Bestaetigung im Gefecht ist schlimmer als keine)
const MIT_ARGS = ['nav.kurs', 'nav.schub', 'nav.abstand', 'ops.ziel', 'ops.feuer_frei', 'ops.beamen', 'tech.prio', 'tech.reparieren', 'tech.schild', 'tech.energie'];
const ARG_WORT = /steuerbord|backbord|\bbug\b|heck|halbe|volle|markier|basis|antrieb|waffen|torpedo|rohr|löschtrupp|loeschtrupp|feuer zuerst|person|fracht|leck|reaktor|mehr energie|stopp/i;
for (const id of MIT_ARGS) {
  const l = texte[id + '.ok'];
  assert.ok(Array.isArray(l) && l.length === 2 && l.every(t => /^[^\s].{5,60}[.]$/.test(t)), id + ': zwei knappe Varianten');
  assert.ok(l.every(t => !ARG_WORT.test(t)), id + ': Bestaetigung nennt kein Argument (' + l.join(' | ') + ')');
  assert.ok(l.some(t => /^Aye/.test(t)), id + ': Aye bleibt');
}
// ---- BOT-05 A3: Texte je Figur, Manifest je Stimme, Dedupe, Rueckfall
const TexteFiguren = require('../server/bots/texte-figuren.js');
const FIGUREN = JSON.parse(fs.readFileSync(Clips.FIGUREN, 'utf8')).figuren;
const KANON = require('../content/bots/kanon.json');
const ohneClip = (id) => id.startsWith('bord.ansage.');   // unabhaengige Erwartung: nur die Ansagen des Bord-Bots (Vorlagen mit Werten) haben keinen Clip
const ansageIds = Object.keys(texte).filter(id => id.startsWith('bord.ansage.'));
assert.ok(ansageIds.length >= 3 && ansageIds.every(id => Clips.OHNE_CLIP.test(id)) && !Clips.OHNE_CLIP.test('nav.kurs.ok') && !Clips.OHNE_CLIP.test('bot.unklar') && !Clips.OHNE_CLIP.test('nav.kurs.abgelehnt.phase'), 'OHNE_CLIP trifft nur bord.ansage.* (Ablehnungen haben Clips)');
assert.deepStrictEqual(Object.keys(texte).filter(id => ohneClip(id) !== Clips.OHNE_CLIP.test(id)), [], 'OHNE_CLIP stimmt fuer jede textId mit der festen Regel des Tests ueberein');
assert.deepStrictEqual(TexteFiguren.pruefe(TexteFiguren.DATEN), [], 'texte-figuren.json: Formatpruefung');
assert.deepStrictEqual(FIGUREN.map(f => f.botId), ['b0', 'b1', 'b2']);
const clipIds = Object.keys(texte).filter(id => !ohneClip(id));
const okIds = Object.keys(texte).filter(id => /[.]ok$/.test(id));
assert.strictEqual(okIds.length, 23, '23 ok-Bestaetigungen');
const FIG = TexteFiguren.DATEN.figuren;
const woerter = (t) => t.trim().split(/\s+/).length;
const argWoerter = [];
for (const e of KANON.befehle) for (const w of Object.values(e.werte || {})) for (const v of Object.values(w)) argWoerter.push(String(v.wort).toLowerCase());
const textLos = [], zuLang = [], argument = [], tts = [], doppelt = [];
for (const f of FIGUREN) {
  const fl = FIG[f.botId];
  assert.ok(fl, f.botId + ': Figur in texte-figuren.json');
  // jede Figur hat Varianten fuer alle ok-IDs und bot.unklar
  for (const id of okIds.concat(['bot.unklar'])) { const l = TexteFiguren.figurListe(f.botId, id); if (!l || l.length < 2 || l.length !== texte[id].length) textLos.push(f.botId + ' ' + id); }
  // jede textId mit Clip (auch Ablehnungen) wird von einem Schluessel der Figur gedeckt
  for (const id of clipIds) if (!TexteFiguren.figurListe(f.botId, id)) textLos.push(f.botId + ' ' + id);
  for (const [schl, l] of Object.entries(fl)) {
    const ids = clipIds.filter(id => TexteFiguren.schluesselFuer(id, TexteFiguren.DATEN, f.botId) === schl);
    assert.ok(ids.length, f.botId + ' ' + schl + ': Schluessel trifft mindestens eine textId');
    // ein Schluessel ersetzt nur Listen, die in texte.json gleich sind (sonst ginge eine eigene Grundliste verloren)
    assert.ok(ids.every(id => JSON.stringify(texte[id]) === JSON.stringify(texte[ids[0]])), f.botId + ' ' + schl + ': alle getroffenen textIds teilen in texte.json dieselbe Liste');
    const ok = /[.]ok$/.test(schl);
    for (const t of l) {
      if (woerter(t) > (ok ? 6 : 10)) zuLang.push(f.botId + ' ' + schl + ': ' + t);
      if (/\d/.test(t) || (!ok && argWoerter.some(w => t.toLowerCase().includes(w)))) argument.push(f.botId + ' ' + schl + ': ' + t);   // keine Argumente in Texten (Regel aus test-bot-annahme)
      if (/aye|sensor|scann/i.test(t)) tts.push(f.botId + ' ' + schl + ': ' + t);   // Woerter, die die TTS verhunzt (BOT-04: Aye -> Ej, Sensor -> Zenso, scanne -> Scanner)
    }
    if (new Set(l).size !== l.length) doppelt.push(f.botId + ' ' + schl);
  }
  for (const id of MIT_ARGS) assert.ok(FIG[f.botId][id + '.ok'].every(t => !ARG_WORT.test(t)), f.botId + ' ' + id + ': Figurbestaetigung nennt kein Argument');
}
assert.deepStrictEqual(textLos, [], 'jede Figur hat Varianten fuer alle ok-IDs, bot.unklar und jede Ablehnung');
assert.deepStrictEqual(Object.keys(FIG.b1).sort(), Object.keys(FIG.b0).sort(), 'b0 und b1 haben dieselben Schluessel');
assert.deepStrictEqual(Object.keys(FIG.b2).sort(), Object.keys(FIG.b0).sort(), 'b0 und b2 haben dieselben Schluessel');
assert.deepStrictEqual(zuLang, [], 'Bestaetigung hoechstens 6 Woerter, Ablehnung hoechstens 10');
assert.deepStrictEqual(argument, [], 'keine Argumente in den Figurtexten');
assert.deepStrictEqual(tts, [], 'keine TTS-Stolperwoerter in den Figurtexten');
assert.deepStrictEqual(doppelt, [], 'die zwei Varianten einer Liste unterscheiden sich');
for (const id of okIds) assert.ok(new Set(FIGUREN.map(f => TexteFiguren.figurListe(f.botId, id)[0])).size === 3, id + ': die drei Figuren klingen verschieden (Variante 0)');
// Muster: das spezifischste gewinnt (bord.* vor *, exakt vor Muster)
assert.strictEqual(TexteFiguren.schluesselFuer('bord.sensor.abgelehnt.kein_ziel', TexteFiguren.DATEN, 'b0'), 'bord.*.abgelehnt.kein_ziel');
assert.strictEqual(TexteFiguren.schluesselFuer('nav.kurs.abgelehnt.kein_ziel', TexteFiguren.DATEN, 'b0'), '*.abgelehnt.kein_ziel');
assert.strictEqual(TexteFiguren.schluesselFuer('befehl.abgelehnt.unbekannt', TexteFiguren.DATEN, 'b1'), '*.abgelehnt.unbekannt');
assert.strictEqual(TexteFiguren.schluesselFuer('nav.kurs.ok', TexteFiguren.DATEN, 'b2'), 'nav.kurs.ok');
assert.strictEqual(TexteFiguren.schluesselFuer('bord.ansage.code', TexteFiguren.DATEN, 'b0'), null, 'Ansagen des Bord-Bots haben keinen Figurtext');

// Rueckfall auf texte.json: fehlende Figurvariante, unbekannte Figur, kein Bot, leere Liste
const klein = { format: 'bot-texte-figuren/1', figuren: { b0: { 'nav.kurs.ok': ['Eigen eins.', 'Eigen zwei.'], 'nav.*.abgelehnt.nicht_jetzt': ['Nein eins.', 'Nein zwei.'] } } };
assert.deepStrictEqual(TexteFiguren.listeFuer('b0', 'nav.kurs.ok', texte, klein), ['Eigen eins.', 'Eigen zwei.'], 'Figurliste ersetzt die Grundliste');
assert.deepStrictEqual(TexteFiguren.listeFuer('b0', 'nav.stopp.ok', texte, klein), texte['nav.stopp.ok'], 'fehlt der Schluessel: Grundliste');
assert.deepStrictEqual(TexteFiguren.listeFuer('b1', 'nav.kurs.ok', texte, klein), texte['nav.kurs.ok'], 'andere Figur ohne Eintrag: Grundliste (die Figurliste gilt nur fuer ihre Figur)');
assert.deepStrictEqual(TexteFiguren.listeFuer('b7', 'nav.kurs.ok', texte, klein), texte['nav.kurs.ok'], 'unbekannte botId: Grundliste');
assert.deepStrictEqual(TexteFiguren.listeFuer(null, 'nav.kurs.ok', texte, klein), texte['nav.kurs.ok'], 'ohne botId (Antwort ohne Bot): Grundliste');
assert.deepStrictEqual(TexteFiguren.listeFuer('b0', 'nav.sprung.abgelehnt.nicht_jetzt', texte, klein), ['Nein eins.', 'Nein zwei.'], 'Muster nav.*');
assert.deepStrictEqual(TexteFiguren.listeFuer('b0', 'ops.scan.abgelehnt.nicht_jetzt', texte, klein), texte['ops.scan.abgelehnt.nicht_jetzt'], 'Muster nav.* trifft ops.* nicht');
assert.strictEqual(TexteFiguren.listeFuer('b0', 'gibt.es.nicht', texte, klein), null, 'weder Figur noch Grundliste: null');
assert.ok(TexteFiguren.pruefe({ format: 'x', figuren: {} }).length && TexteFiguren.pruefe({ format: 'bot-texte-figuren/1', figuren: { b0: { a: ['nur eins'] } } }).length, 'Formatpruefung erkennt Fehler');

// Plan und Dedupe (ohne Netz)
const stimmenPlan = Clips.clipPlan(texte, stimmen);
assert.deepStrictEqual(Object.keys(stimmenPlan), ['b0', 'b1', 'b2']);
const plan1 = Clips.clipPlan(texte, stimmen, { daten: klein, figuren: FIGUREN });
assert.strictEqual(plan1.b1.texte[plan1.b1.clips['nav.kurs.ok.0']], texte['nav.kurs.ok'][0], 'ohne Figurliste (b1 in klein) plant der Generator die Grundliste');
assert.strictEqual(plan1.b0.texte[plan1.b0.clips['nav.kurs.ok.0']], 'Eigen eins.', 'mit Figurliste plant er die Figurliste');
assert.deepStrictEqual(Object.keys(stimmenPlan.b0.clips).filter(k => k.startsWith('bord.ansage.')), [], 'keine Clips fuer bord.ansage.*');

// Vorrat: je Stimme Manifest, jede Datei da, nichts Ueberzaehliges, Text <-> Datei <-> Server-Liste passen je Index
let summe = 0, dateienGesamt = 0;
const manifeste = {};
for (const [stimme, s] of Object.entries(stimmen)) {
  const dir = path.join(Clips.VORRAT, stimme), mf = path.join(dir, Clips.MANIFEST);
  assert.ok(fs.existsSync(mf), stimme + ': clips.json fehlt');
  const m = manifeste[stimme] = JSON.parse(fs.readFileSync(mf, 'utf8'));
  assert.ok(m.format === 'bot-clips/1' && m.stimme === stimme && m.clips && m.texte, stimme + ': Manifestformat');
  // jeder Eintrag im Manifest zeigt auf eine vorhandene Datei
  const falsch = Object.entries(m.clips).filter(([, d]) => !/^[0-9a-f]{16}[.]wav$/.test(d) || !fs.existsSync(path.join(dir, d)) || fs.statSync(path.join(dir, d)).size < 1000 || typeof m.texte[d] !== 'string');
  assert.deepStrictEqual(falsch, [], stimme + ': jeder Manifesteintrag zeigt auf eine vorhandene Datei mit Text');
  // nichts Ueberzaehliges: genau die Dateien der eindeutigen Texte, keine alten Namensregel-Clips
  const wav = fs.readdirSync(dir).filter(f => /[.](wav|ogg)$/.test(f)).sort();
  assert.deepStrictEqual(wav, Object.keys(m.texte).sort(), stimme + ': Verzeichnis = Dateien des Manifests (Dedupe, keine Altlast)');
  assert.ok(wav.length < Object.keys(m.clips).length / 5, stimme + ': Dedupe wirkt (' + wav.length + ' Dateien fuer ' + Object.keys(m.clips).length + ' Schluessel)');
  wav.forEach(f => { summe += fs.statSync(path.join(dir, f)).size; }); dateienGesamt += wav.length;
  // das Manifest ist genau der Plan des Generators (jede textId mit Clip x alle Varianten)
  assert.deepStrictEqual(m.clips, stimmenPlan[stimme].clips, stimme + ': Manifest = Plan');
  const fig = FIGUREN.find(f => f.stimme === stimme);
  for (const id of clipIds) {
    const liste = TexteFiguren.listeFuer(fig.botId, id, texte);   // dieselbe Funktion wie annahme.js
    liste.forEach((text, i) => {
      const d = m.clips[id + '.' + i];
      assert.ok(d, stimme + ' ' + id + '.' + i + ': Clip fehlt im Manifest');   // jede textId mit Figurvariante hat Clips fuer alle Varianten
      assert.strictEqual(m.texte[d], text, stimme + ' ' + id + '.' + i + ': Text des Clips = Server-Text');
      assert.strictEqual(d, Clips.clipHash(s.profilId, text) + '.wav', stimme + ' ' + id + '.' + i + ': Dateiname gehoert zu Profil und Text');
    });
    assert.ok(!m.clips[id + '.' + liste.length], stimme + ' ' + id + ': keine Clips ueber die Liste hinaus');
  }
  assert.ok(m.clips['bot.unklar.0'] && m.clips['bot.unklar.1'], stimme + ': bot.unklar.0 und .1');
  assert.ok(Object.keys(m.clips).every(k => !k.startsWith('bord.ansage.')), stimme + ': kein Clip fuer Ansagen');
}
assert.ok(summe < 40 * 1024 * 1024, 'Vorrat deutlich unter 40 MB (' + (summe / 1048576).toFixed(1) + ' MB, ' + dateienGesamt + ' Dateien)');
assert.deepStrictEqual(fs.readdirSync(Clips.VORRAT).sort(), ['b0', 'b1', 'b2'], 'nur die drei Stimmordner im Vorrat');

// Clipwahl des Clients: Manifest zuerst, dann die alte Namensregel; ohne oder mit kaputtem Manifest bricht nichts
const dateiZuUrl = u => path.join(Clips.VORRAT, ...u.replace('/assets/bots/stimmen/', '').split('/'));
for (const [stimme, m] of Object.entries(manifeste)) for (const [k, datei] of Object.entries(m.clips)) {
  const i = k.lastIndexOf('.'), textId = k.slice(0, i), v = +k.slice(i + 1);
  const kand = BotSprache.clipKandidaten(textId, stimme, v, undefined, m);
  assert.strictEqual(kand[0], '/assets/bots/stimmen/' + stimme + '/' + datei, 'Clipwahl: erste Kandidatin ist die Manifestdatei (' + stimme + ' ' + k + ')');
  assert.ok(fs.existsSync(dateiZuUrl(kand[0])), 'Clipwahl: Manifestdatei existiert');
  assert.deepStrictEqual(kand.slice(1), BotSprache.clipKandidaten(textId, stimme, v), 'danach die alte Namensregel als Rueckfall');
}
assert.deepStrictEqual(BotSprache.clipKandidaten('nav.kurs.ok', 'b0', 1, undefined, null), BotSprache.clipKandidaten('nav.kurs.ok', 'b0', 1), 'ohne Manifest: alte Namensregel');
assert.deepStrictEqual(BotSprache.clipKandidaten('nav.kurs.ok', 'b0', 1, undefined, { clips: 5 }), BotSprache.clipKandidaten('nav.kurs.ok', 'b0', 1), 'kaputtes Manifest: alte Namensregel');
assert.deepStrictEqual(BotSprache.clipKandidaten('nav.kurs.ok', 'b0', 1, undefined, { clips: { 'nav.kurs.ok.1': '../../geheim.wav' } }), BotSprache.clipKandidaten('nav.kurs.ok', 'b0', 1), 'Manifestdatei mit Pfadanteil wird ignoriert');
assert.ok(BotSprache.clipKandidaten('nav.kurs.ok', 'b0', undefined, undefined, manifeste.b0)[0].endsWith('/' + manifeste.b0.clips['nav.kurs.ok.0']), 'ohne Variante: Variante 0 des Manifests');

// Fallback: fehlt der Clip, liefert die Wiedergabe keinen Pfad, der Untertitel steht trotzdem
async function fallback() {
  const untertitel = [], gespielt = [];
  let abmeld = null;
  const env = {
    transport: { send: () => true, onMessage: fn => { abmeld = fn; return () => {}; } },
    matcher: () => null, stt: async () => '', mikrofon: { start: async () => { throw new Error('x'); } },
    audio: { spiele: async urls => { gespielt.push(urls); return urls.find(u => fs.existsSync(dateiZuUrl(u))) || null; }, stumm() {}, stopp() {} },
    anzeige: { aufnahme() {}, untertitel: t => untertitel.push(t), meldung() {} },
    stimmen: { b0: 'b0', b1: 'b1', b2: 'b2' },   // Vorrat liegt je botId (b0..b2); der Standard in bot-sprache.js nennt noch Rollenordner (siehe Bericht)
    clipBasis: '/assets/bots/stimmen-fehlt',   // Basis ohne Dateien: jeder Clip fehlt
  };
  const k = BotSprache.erzeuge(env); k.schalte(true);
  k.empfange({ t: 'bot.antwort', botId: 'b0', textId: 'nav.kurs.ok', text: 'Aye, Kurs liegt an.', variante: 0 });
  await new Promise(r => setImmediate(r));
  assert.deepStrictEqual(untertitel, ['Aye, Kurs liegt an.'], 'Untertitel bleibt, wenn der Clip fehlt');
  assert.ok(gespielt.length === 1 && gespielt[0].every(u => u.startsWith('/assets/bots/stimmen-fehlt/b0/nav.kurs.ok')), 'Clipwahl fragt Kandidaten an');
  assert.strictEqual(await env.audio.spiele(gespielt[0]), null, 'Wiedergabe liefert keinen Pfad');
}

// BOT-05 A3: Wiedergabe ueber das Manifest (Kern aus bot-sprache.js, ohne Browser): Manifest je Stimme genau einmal geladen, Manifestdatei zuerst, kein Manifest / Ladefehler = alte Namensregel, bot.unklar-Untertitel aus dem Manifest
async function manifestTest() {
  const m = manifeste.b1;
  const bauen = (ladeManifest) => {
    const untertitel = [], gespielt = [];
    const env = {
      transport: { send: () => true, onMessage: () => () => {} },
      matcher: () => ({ match: () => null }), stt: async () => '', mikrofon: { start: async () => { throw new Error('x'); } },
      audio: { spiele: async urls => { gespielt.push(urls); return null; }, stumm() {}, stopp() {} },
      anzeige: { aufnahme() {}, untertitel: t => untertitel.push(t), meldung() {} },
      ladeManifest,
    };
    const k = BotSprache.erzeuge(env); k.schalte(true);
    return { k, untertitel, gespielt };
  };
  const tick = () => new Promise(r => setImmediate(r));
  let aufrufe = [];
  const A = bauen(async url => { aufrufe.push(url); return m; });
  A.k.empfange({ t: 'bot.antwort', botId: 'b1', textId: 'nav.kurs.ok', text: m.texte[m.clips['nav.kurs.ok.1']], variante: 1 });
  A.k.empfange({ t: 'bot.antwort', botId: 'b1', textId: 'nav.stopp.ok', text: m.texte[m.clips['nav.stopp.ok.0']], variante: 0 });
  await tick(); await tick();
  assert.deepStrictEqual(aufrufe, ['/assets/bots/stimmen/b1/clips.json'], 'Manifest der Stimme einmal geladen, auch bei zwei Antworten');
  assert.strictEqual(A.gespielt.length, 2, 'beide Clips angefragt');
  assert.strictEqual(A.gespielt[0][0], '/assets/bots/stimmen/b1/' + m.clips['nav.kurs.ok.1'], 'Wiedergabe: Manifestdatei zuerst');
  assert.ok(A.gespielt[0].some(u => u.includes('nav.kurs.ok.1.wav')), 'danach die alte Namensregel');
  await A.k.sendeText('xyz');
  assert.strictEqual(A.gespielt[2][0], '/assets/bots/stimmen/b1/' + m.clips['bot.unklar.0'], 'bot.unklar: Manifestdatei zuerst');
  assert.strictEqual(A.untertitel[A.untertitel.length - 1], m.texte[m.clips['bot.unklar.0']], 'bot.unklar: Untertitel = Text des Clips (Figurtext)');
  assert.strictEqual(aufrufe.length, 1, 'auch fuer bot.unklar kein zweiter Manifestabruf');
  // Manifest fehlt (null) oder Laden schlaegt fehl: alte Namensregel, Untertitel bleibt, nichts bricht ab
  for (const lade of [async () => null, async () => { throw new Error('404'); }, () => { throw new Error('sofort'); }, undefined]) {
    const B = bauen(lade);
    B.k.empfange({ t: 'bot.antwort', botId: 'b0', textId: 'nav.kurs.ok', text: 'Kurs liegt an.', variante: 0 });
    await tick(); await tick();
    assert.deepStrictEqual(B.untertitel, ['Kurs liegt an.'], 'Untertitel ohne Manifest');
    assert.deepStrictEqual(B.gespielt, [BotSprache.clipKandidaten('nav.kurs.ok', 'b0', 0)], 'ohne Manifest: alte Namensregel');
    await B.k.sendeText('xyz');
    assert.strictEqual(B.untertitel[B.untertitel.length - 1], BotSprache.TEXT.unklar, 'bot.unklar ohne Manifest: fester Untertitel');
  }
}

// Stille wegschneiden: Rand weg, Mitte bleibt, Kopf stimmig
function wav(samples) {
  const pcm = Buffer.alloc(samples.length * 2); samples.forEach((v, i) => pcm.writeInt16LE(v, 2 * i));
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const roh = wav([...new Array(24000).fill(0), ...new Array(2400).fill(8000), ...new Array(24000).fill(0)]);
const kurz = Clips.trimWav(roh);
assert.ok(kurz.length < roh.length / 4 && kurz.length > 2400 * 2, 'Stille vorn und hinten gekürzt');
assert.strictEqual(kurz.readUInt32LE(40), kurz.length - 44, 'data-Länge im Kopf stimmt');
assert.strictEqual(Clips.trimWav(wav(new Array(1000).fill(0))).length, 44 + 2000, 'reine Stille bleibt unverändert');

fallback().then(manifestTest).then(() => console.log('test-bot-clips: ok'), e => { console.error(e); process.exit(1); });
