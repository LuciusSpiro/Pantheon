'use strict';
// BOT-04 B: Selbsttest der Cache-Hash-Logik des Clip-Generators, ohne Netz.      node tools/test-bot-clips.js
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
const dateien = Clips.clipDateien(texte, stimmen);
const erwartet = Object.keys(stimmen).length * Object.entries(texte).filter(([id]) => !Clips.OHNE_CLIP.test(id)).reduce((n, [, l]) => n + l.length, 0) + Object.keys(stimmen).length;   // + bot.unklar.wav je Stimme
assert.strictEqual(dateien.length, erwartet, 'Zahl der Clips = Stimmen x Varianten (+ bot.unklar ohne Variante)');
const fehlend = dateien.filter(c => !fs.existsSync(c.datei) || fs.statSync(c.datei).size < 1000);
assert.deepStrictEqual(fehlend.map(c => path.relative(Clips.VORRAT, c.datei)), [], 'Vorrat vollständig: jede textId x Stimme x Variante hat eine Datei');

// Clipwahl: die erste existierende Kandidaten-URL der Wahl aus bot-sprache.js ist genau die erzeugte Datei
const dateiZuUrl = u => path.join(Clips.VORRAT, ...u.replace('/assets/bots/stimmen/', '').split('/'));
for (const c of dateien) {
  const k = BotSprache.clipKandidaten(c.textId, c.botId, c.variante);
  const treffer = k.find(u => fs.existsSync(dateiZuUrl(u)));
  // ohne Variante (bot.unklar.wav, Kopie von .0) wählt der Client zuerst <textId>.0 (S4): derselbe Inhalt, die .0-Datei
  const soll = c.variante === null ? c.datei.replace(/\.wav$/, '.0.wav') : c.datei;
  assert.strictEqual(treffer && dateiZuUrl(treffer), soll, 'Clipwahl findet ' + c.botId + '/' + c.textId + ' Variante ' + c.variante);
}

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

fallback().then(() => console.log('test-bot-clips: ok'), e => { console.error(e); process.exit(1); });
