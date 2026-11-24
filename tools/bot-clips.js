'use strict';
// BOT-04 B: Grundgerüst des Clip-Generators. Text + Profil -> Audiodatei über Voicebox (/v1/audio/speech), nur Engine Qwen.
// Cache nach Hash aus (Profil-ID, Text). Zugang: VOICEBOX_URL (Standard http://sleipnir.local:17493), VOICEBOX_AUTH ("nutzer:passwort");
// ohne VOICEBOX_AUTH wird das Passwort zur Laufzeit per `ssh sleipnir` aus ~/.config/lan-password geholt (nie im Code oder Commit).
// Aufruf:  node tools/bot-clips.js profiles | say <profil> <text> | vorrat | hoerprobe <zielordner> [namensfilter]      Cache: BOT_CLIPS_DIR (Standard: Temp)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ENGINE = 'qwen';   // Chatterbox erzeugt bei Kurzbefehlen Fremdlaut (Erkundung Einspielermodus, Frage 6)
const WARM_TEXT = 'Bereit';
const PHRASEN = ['Aye, Schilde Steuerbord', 'Feuer frei auf das markierte Ziel', 'Bitte wiederholen, ich habe das nicht verstanden'];

function baseUrl() { return (process.env.VOICEBOX_URL || 'http://sleipnir.local:17493').replace(/\/+$/, ''); }

let authCache = null;
function authHeader() {
  if (authCache) return authCache;
  let cred = process.env.VOICEBOX_AUTH;
  if (!cred) {
    const pw = execFileSync('ssh', ['sleipnir', 'cat ~/.config/lan-password'], { encoding: 'utf8' }).trim();
    cred = 'kai:' + pw;
  }
  authCache = 'Basic ' + Buffer.from(cred).toString('base64');
  return authCache;
}

/** Cache-Schlüssel: nur Profil-ID und Text (Format steht in der Dateiendung). */
function clipHash(profilId, text) {
  return crypto.createHash('sha256').update(String(profilId) + '\n' + String(text), 'utf8').digest('hex').slice(0, 16);
}

function cacheDir() { return process.env.BOT_CLIPS_DIR || path.join(os.tmpdir(), 'pantheon-bot-clips'); }
function clipPath(profilId, text, dir, ext) { return path.join(dir || cacheDir(), clipHash(profilId, text) + '.' + (ext || 'wav')); }

/** Nur Qwen-Profile (Kara/Chatterbox und Profile ohne Engine fallen heraus). */
function qwenProfile(profile) { return profile.filter(p => p.default_engine === ENGINE); }

async function listProfiles() {
  const r = await fetch(baseUrl() + '/profiles', { headers: { Authorization: authHeader() } });
  if (!r.ok) throw new Error('GET /profiles: HTTP ' + r.status);
  return r.json();
}

/** Ein Clip aus Voicebox; ohne Cache-Treffer wird erzeugt. Rückgabe { file, cached, ms }. */
async function synth(profil, text, opts = {}) {
  const dir = opts.dir || cacheDir();
  const file = clipPath(profil.id, text, dir, 'wav');
  if (!opts.force && fs.existsSync(file)) return { file, cached: true, ms: 0 };
  if (profil.default_engine !== ENGINE) throw new Error('Profil ' + profil.name + ' nutzt Engine ' + profil.default_engine + ', erlaubt ist nur ' + ENGINE);
  const t0 = Date.now();
  const r = await fetch(baseUrl() + '/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'tts-1', voice: profil.name, input: text, response_format: 'wav', engine: ENGINE }),
  });
  if (!r.ok) throw new Error('POST /v1/audio/speech: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file + '.tmp', buf);
  fs.renameSync(file + '.tmp', file);
  return { file, cached: false, ms: Date.now() - t0 };
}

/** Modell vorab laden (erster Aufruf kalt rund 26 s). Der Warm-Clip landet im Cache und stört nicht. */
async function warm(profil, opts = {}) { return synth(profil, WARM_TEXT, opts); }

// ---- Clip-Vorrat (BOT-04 B2): content/bots/texte.json x content/bots/stimmen.json -> assets/bots/stimmen/<botId>/<textId>.<variante>.wav
// Schema wie public/js/bot-sprache.js (clipKandidaten): Variante = Index in der Textliste. bot.unklar wird dort ohne Variante gesucht, darum zusätzlich bot.unklar.wav (= Variante 0).
const ROOT = path.join(__dirname, '..');
const TEXTE = path.join(ROOT, 'content', 'bots', 'texte.json');
const STIMMEN = path.join(ROOT, 'content', 'bots', 'stimmen.json');
const VORRAT = path.join(ROOT, 'assets', 'bots', 'stimmen');
const OHNE_VARIANTE = ['bot.unklar'];
// BOT-01 C1: Ablehnungen (abgelehnt/unmoeglich) laufen als Untertitel, der Clip-Vorrat deckt nur ok und bot.unklar (BOT-04 Abnahme 6); der Client faellt ohne Clip auf den Untertitel zurueck.
const OHNE_CLIP = /[.](abgelehnt|unmoeglich)[.]/;


function clipDateien(texte, stimmen, vorrat) {
  const out = [];
  for (const botId of Object.keys(stimmen)) for (const textId of Object.keys(texte)) {
    if (OHNE_CLIP.test(textId)) continue;
    texte[textId].forEach((text, i) => out.push({ botId, textId, variante: i, text, datei: path.join(vorrat || VORRAT, botId, textId + '.' + i + '.wav') }));
    if (OHNE_VARIANTE.includes(textId) && texte[textId].length) out.push({ botId, textId, variante: null, text: texte[textId][0], datei: path.join(vorrat || VORRAT, botId, textId + '.wav'), kopieVon: 0 });
  }
  return out;
}

/** Stille vorn und hinten wegschneiden (16-bit PCM mono, ohne Zusatzabhängigkeit); bleibt ein WAV mit gleichem Format. Nicht lesbar -> unverändert. */
function trimWav(buf, schwelle = 400, vornMs = 60, hintenMs = 120) {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF') return buf;
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('latin1', o, o + 4), n = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(o + 8), kan: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    if (id === 'data') { data = { start: o + 8, len: Math.min(n, buf.length - o - 8) }; break; }
    o += 8 + n + (n & 1);
  }
  if (!fmt || !data || fmt.tag !== 1 || fmt.kan !== 1 || fmt.bits !== 16) return buf;
  const n = data.len >> 1, at = i => Math.abs(buf.readInt16LE(data.start + 2 * i));
  let a = 0, b = n - 1;
  while (a < n && at(a) < schwelle) a++;
  while (b > a && at(b) < schwelle) b--;
  if (a >= n) return buf;   // nur Stille: nicht anfassen
  a = Math.max(0, a - Math.round(fmt.rate * vornMs / 1000)); b = Math.min(n - 1, b + Math.round(fmt.rate * hintenMs / 1000));
  const pcm = buf.subarray(data.start + 2 * a, data.start + 2 * (b + 1));
  const head = Buffer.from(buf.subarray(0, 44));
  head.writeUInt32LE(36 + pcm.length, 4); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/** Alle fehlenden Clips des Vorrats erzeugen (Cache nach Hash, nur Fehlendes). Rückgabe { gesamt, neu, ausCache, vorhanden, ms }. */
async function vorrat(opts = {}) {
  const texte = opts.texte || JSON.parse(fs.readFileSync(TEXTE, 'utf8'));
  const stimmen = opts.stimmen || JSON.parse(fs.readFileSync(STIMMEN, 'utf8'));
  const ziel = opts.vorrat || VORRAT;
  const alle = await listProfiles();
  const profil = {};
  for (const [botId, s] of Object.entries(stimmen)) {
    const p = alle.find(x => x.id === s.profilId);
    if (!p) throw new Error('Profil ' + s.profilId + ' (' + botId + ') nicht in Voicebox');
    if (p.name !== s.profilName) throw new Error('Profilname für ' + botId + ' passt nicht: ' + p.name);
    profil[botId] = p;
  }
  const liste = clipDateien(texte, stimmen, ziel);
  const stat = { gesamt: liste.length, neu: 0, ausCache: 0, vorhanden: 0, ms: 0 };
  const fehlt = liste.filter(c => !fs.existsSync(c.datei));
  stat.vorhanden = liste.length - fehlt.length;
  if (fehlt.length) { const w = await warm(profil[fehlt[0].botId]); console.log('warm: ' + w.ms + ' ms'); }
  for (const c of fehlt) {
    fs.mkdirSync(path.dirname(c.datei), { recursive: true });
    if (c.kopieVon != null) {   // Kopie der Variante, ohne neue Erzeugung
      fs.copyFileSync(path.join(path.dirname(c.datei), c.textId + '.' + c.kopieVon + '.wav'), c.datei); continue;
    }
    const r = await synth(profil[c.botId], c.text, { dir: opts.cache });
    if (r.cached) stat.ausCache++; else { stat.neu++; stat.ms += r.ms; }
    fs.writeFileSync(c.datei, trimWav(fs.readFileSync(r.file)));
    console.log(c.botId + ' ' + c.textId + '.' + c.variante + ' ' + (r.cached ? 'cache' : r.ms + ' ms'));
  }
  return stat;
}

module.exports = { ENGINE, PHRASEN, clipHash, clipPath, cacheDir, qwenProfile, listProfiles, synth, warm, clipDateien, trimWav, vorrat, VORRAT, TEXTE, STIMMEN };

async function hoerprobe(ziel, filter) {
  const re = new RegExp(filter || '^Kara-Test [A-D][12] ');
  const profile = qwenProfile(await listProfiles()).filter(p => re.test(p.name)).sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(ziel, { recursive: true });
  const w = await warm(profile[0], { dir: ziel });
  console.log('warm: ' + w.ms + ' ms');
  const rows = [];
  for (const p of profile) {
    const kurz = p.name.match(/^\S+ ([A-Z]\d)/)[1];
    const clips = [];
    for (let i = 0; i < PHRASEN.length; i++) {
      const r = await synth(p, PHRASEN[i], { dir: ziel, force: true });
      const name = kurz + '_' + (i + 1) + '.wav';
      fs.renameSync(r.file, path.join(ziel, name));
      clips.push({ name, ms: r.ms, text: PHRASEN[i] });
      console.log(kurz + ' ' + (i + 1) + ': ' + r.ms + ' ms');
    }
    rows.push({ kurz, name: p.name, beschreibung: p.description, clips });
  }
  fs.writeFileSync(path.join(ziel, 'zeiten.json'), JSON.stringify(rows, null, 1));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hörprobe Qwen-Stimmen</title>'
    + '<style>:root{color-scheme:dark}body{background:#14161a;color:#e3e6ea;font:16px system-ui;margin:0 auto;max-width:760px;padding:16px}h1{font-size:20px}'
    + '.p{background:#1e2127;border-radius:8px;padding:12px 16px;margin:12px 0}.p h2{margin:0;font-size:17px}.p small{color:#9aa3ad}.c{margin-top:8px}.c div{font-size:14px;color:#b9c0c8}audio{width:100%}</style>'
    + '<h1>Hörprobe Qwen-Stimmen (BOT-04 B)</h1>'
    + rows.map(r => '<div class="p"><h2>' + esc(r.kurz) + ' <small>' + esc(r.name) + '</small></h2><small>' + esc(r.beschreibung) + '</small>'
      + r.clips.map(c => '<div class="c"><div>' + esc(c.text) + ' <small>(' + c.ms + ' ms)</small></div><audio controls preload="none" src="' + c.name + '"></audio></div>').join('') + '</div>').join('')
    + '</html>';
  fs.writeFileSync(path.join(ziel, 'index.html'), html);
  console.log('index.html: ' + path.join(ziel, 'index.html'));
}

if (require.main === module) {
  (async () => {
    const [cmd, a, b] = process.argv.slice(2);
    if (cmd === 'profiles') {
      for (const p of await listProfiles()) console.log(p.id + ' | ' + p.name + ' | ' + p.default_engine + ' | ' + p.description);
    } else if (cmd === 'say') {
      const p = (await listProfiles()).find(x => x.name === a || x.id === a);
      if (!p) throw new Error('Profil nicht gefunden: ' + a);
      console.log(await synth(p, b));
    } else if (cmd === 'vorrat') {
      console.log(await vorrat());
    } else if (cmd === 'hoerprobe' && a) {
      await hoerprobe(a, b);
    } else {
      console.log('Aufruf: node tools/bot-clips.js profiles | say <profil> <text> | vorrat | hoerprobe <zielordner> [namensfilter-regex]');
    }
  })().catch(e => { console.error(e.message); process.exit(1); });
}
