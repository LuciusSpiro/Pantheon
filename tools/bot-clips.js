'use strict';
// BOT-04 B: Grundgerüst des Clip-Generators. Text + Profil -> Audiodatei über Voicebox (/v1/audio/speech), nur Engine Qwen.
// Cache nach Hash aus (Profil-ID, Text). Zugang: VOICEBOX_URL (Standard http://sleipnir.local:17493), VOICEBOX_AUTH ("nutzer:passwort");
// ohne VOICEBOX_AUTH wird das Passwort zur Laufzeit per `ssh sleipnir` aus ~/.config/lan-password geholt (nie im Code oder Commit).
// Aufruf:  node tools/bot-clips.js profiles | say <profil> <text> | hoerprobe <zielordner>      Cache: BOT_CLIPS_DIR (Standard: Temp)
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

module.exports = { ENGINE, PHRASEN, clipHash, clipPath, cacheDir, qwenProfile, listProfiles, synth, warm };

async function hoerprobe(ziel) {
  const profile = qwenProfile(await listProfiles()).filter(p => /^Kara-Test [A-D][12] /.test(p.name)).sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(ziel, { recursive: true });
  const w = await warm(profile[0], { dir: ziel });
  console.log('warm: ' + w.ms + ' ms');
  const rows = [];
  for (const p of profile) {
    const kurz = p.name.match(/^Kara-Test ([A-D][12])/)[1];
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
    } else if (cmd === 'hoerprobe' && a) {
      await hoerprobe(a);
    } else {
      console.log('Aufruf: node tools/bot-clips.js profiles | say <profil> <text> | hoerprobe <zielordner>');
    }
  })().catch(e => { console.error(e.message); process.exit(1); });
}
