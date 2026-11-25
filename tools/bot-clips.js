'use strict';
// BOT-04 B: Grundgerüst des Clip-Generators. Text + Profil -> Audiodatei über Voicebox (/v1/audio/speech), nur Engine Qwen.
// Cache nach Hash aus (Profil-ID, Text). Zugang: VOICEBOX_URL (Standard http://sleipnir.local:17493), VOICEBOX_AUTH ("nutzer:passwort");
// ohne VOICEBOX_AUTH wird das Passwort zur Laufzeit per `ssh sleipnir` aus ~/.config/lan-password geholt (nie im Code oder Commit).
// Aufruf:  node tools/bot-clips.js profiles | say <profil> <text> | vorrat | pruefe [ergebnis.json] | hoerprobe <zielordner> [namensfilter]      Cache: BOT_CLIPS_DIR (Standard: Temp)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const TexteFiguren = require('../server/bots/texte-figuren.js');   // BOT-05 A3: dieselbe Listenwahl wie der Server (annahme.js)

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

// ---- Clip-Vorrat (BOT-04 B2, BOT-05 A3): Texte je Figur (server/bots/texte-figuren.js, Rueckfall content/bots/texte.json) x content/bots/stimmen.json -> assets/bots/stimmen/<stimme>/<hash>.wav + clips.json
// Je Stimme werden nur die EINDEUTIGEN Texte erzeugt (viele textIds teilen eine Liste: 286 textIds, rund 80 Saetze je Figur). Datei = Hash aus (Profil-ID, Text); das Manifest clips.json der Stimme
// bildet "<textId>.<variante>" auf die Datei ab (Variante = Index der Liste, die der Server fuer diese Figur waehlt: annahme.js und dieser Generator fragen dieselbe Funktion TexteFiguren.listeFuer)
// und "texte" ordnet jeder Datei ihren Text zu (Untertitel von bot.unklar, Gegenpruefung). Der Client (public/js/bot-sprache.js) sucht zuerst ueber das Manifest, dann ueber die alte Namensregel.
// Die Stimme gehoert der Figur mit stimme == Schluessel in stimmen.json. Ohne Figur (nur Tests) gilt die Grundliste.
const ROOT = path.join(__dirname, '..');
const TEXTE = path.join(ROOT, 'content', 'bots', 'texte.json');
const STIMMEN = path.join(ROOT, 'content', 'bots', 'stimmen.json');
const FIGUREN = path.join(ROOT, 'content', 'bots', 'figuren.json');
const VORRAT = path.join(ROOT, 'assets', 'bots', 'stimmen');
const MANIFEST = 'clips.json';
const MANIFEST_FORMAT = 'bot-clips/1';
// BOT-02 B4: die Ansagen des Bord-Bots (bord.ansage.*) sind Vorlagen mit Werten (Untertitel, kein Clip). Alle anderen textIds, auch Ablehnungen (BOT-05 A3), haben Clips.
const OHNE_CLIP = /^bord[.]ansage[.]/;

/** Plan je Stimme: { stimme: { stimme, botId, profilId, dir, clips: { "<textId>.<i>": datei }, texte: { datei: text } } }. Reine Funktion, kein Netz, keine Dateien. */
function clipPlan(texte, stimmen, opts = {}) {
  const figuren = opts.figuren || JSON.parse(fs.readFileSync(FIGUREN, 'utf8')).figuren;
  const ziel = opts.vorrat || VORRAT;
  const plan = {};
  for (const [stimme, s] of Object.entries(stimmen)) {
    const fig = figuren.find(f => f.stimme === stimme);
    const botId = fig ? fig.botId : null;
    const p = { stimme, botId, profilId: s.profilId, dir: path.join(ziel, stimme), clips: {}, texte: {} };
    for (const textId of Object.keys(texte).sort()) {
      if (OHNE_CLIP.test(textId)) continue;
      const liste = TexteFiguren.listeFuer(botId, textId, texte, opts.daten);
      if (!liste) continue;
      liste.forEach((text, i) => { const datei = clipHash(s.profilId, text) + '.wav'; p.clips[textId + '.' + i] = datei; p.texte[datei] = text; });
    }
    plan[stimme] = p;
  }
  return plan;
}
const manifestVon = (p) => ({ format: MANIFEST_FORMAT, stimme: p.stimme, clips: p.clips, texte: p.texte });

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

/** Fehlende Clips des Vorrats erzeugen (Cache nach Hash, nur Fehlendes), je Stimme clips.json schreiben, nicht mehr gebrauchte Dateien entfernen. Rückgabe { stimmen, gesamt, eindeutig, neu, ausCache, vorhanden, entfernt, ms }. */
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
  const plan = clipPlan(texte, stimmen, { vorrat: ziel, figuren: opts.figuren, daten: opts.daten });
  const stat = { stimmen: Object.keys(plan).length, gesamt: 0, eindeutig: 0, neu: 0, ausCache: 0, vorhanden: 0, entfernt: 0, ms: 0 };
  const jobs = [];
  for (const p of Object.values(plan)) {
    stat.gesamt += Object.keys(p.clips).length; stat.eindeutig += Object.keys(p.texte).length;
    for (const [datei, text] of Object.entries(p.texte)) {
      if (fs.existsSync(path.join(p.dir, datei))) stat.vorhanden++; else jobs.push({ p, datei, text });
    }
  }
  if (jobs.length) { const w = await warm(profil[jobs[0].p.stimme], { dir: opts.cache }); console.log('warm: ' + w.ms + ' ms'); }
  for (const j of jobs) {
    fs.mkdirSync(j.p.dir, { recursive: true });
    const r = await synth(profil[j.p.stimme], j.text, { dir: opts.cache });
    if (r.cached) stat.ausCache++; else { stat.neu++; stat.ms += r.ms; }
    fs.writeFileSync(path.join(j.p.dir, j.datei), trimWav(fs.readFileSync(r.file)));
    console.log(j.p.stimme + ' ' + j.datei + ' ' + (r.cached ? 'cache' : r.ms + ' ms') + '  ' + j.text);
  }
  for (const p of Object.values(plan)) {
    fs.mkdirSync(p.dir, { recursive: true });
    const gebraucht = new Set(Object.keys(p.texte));
    for (const f of fs.readdirSync(p.dir)) if (/\.(wav|ogg)$/.test(f) && !gebraucht.has(f)) { fs.unlinkSync(path.join(p.dir, f)); stat.entfernt++; }   // alte Namensregel-Clips und verwaiste Texte
    fs.writeFileSync(path.join(p.dir, MANIFEST), JSON.stringify(manifestVon(p), null, 1) + '\n');
  }
  return stat;
}

/** Normalform für den Vergleich Text <-> Whisper: klein, ohne Satzzeichen, Umlaute und ß aufgelöst. */
function normal(s) {
  return String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Wortabstand (Levenshtein über Wörter) / Wortzahl des Soll-Texts. */
function wortAbstand(soll, ist) {
  const a = normal(soll).split(' ').filter(Boolean), b = normal(ist).split(' ').filter(Boolean);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] / Math.max(1, a.length);
}

/** Gegenprüfung (BOT-05 A3): jede Clip-Datei des Vorrats durch Whisper (STT_URL, OpenAI-kompatibel; Sleipnir: ssh -N -L 18300:127.0.0.1:8300 sleipnir) und mit dem Soll-Text aus clips.json vergleichen.
 *  Ausgabe je Datei { stimme, datei, soll, ist, gleich (nach Normalform), abstand }; nicht gleiche stehen zur Sichtung (Schreibweise oder echter Hörfehler). */
async function pruefeVorrat(opts = {}) {
  const ziel = opts.vorrat || VORRAT;
  const url = String(opts.sttUrl || process.env.STT_URL || 'http://127.0.0.1:18300').replace(/\/+$/, '');
  const ziel2 = /\/audio\/transcriptions$/.test(url) ? url : url + '/v1/audio/transcriptions';
  const out = [];
  for (const stimme of fs.readdirSync(ziel).sort()) {
    const mf = path.join(ziel, stimme, MANIFEST);
    if (!fs.existsSync(mf)) continue;
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    for (const [datei, soll] of Object.entries(m.texte)) {
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(path.join(ziel, stimme, datei))], { type: 'audio/wav' }), datei);
      form.append('model', 'whisper-1'); form.append('language', 'de'); form.append('response_format', 'json');
      const r = await fetch(ziel2, { method: 'POST', body: form });
      if (!r.ok) throw new Error('STT HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const ist = String((await r.json()).text || '').trim();
      out.push({ stimme, datei, soll, ist, gleich: normal(soll) === normal(ist), abstand: +wortAbstand(soll, ist).toFixed(2) });
    }
  }
  return out;
}

module.exports = { OHNE_CLIP, ENGINE, PHRASEN, clipHash, clipPath, cacheDir, qwenProfile, listProfiles, synth, warm, clipPlan, manifestVon, trimWav, vorrat, pruefeVorrat, normal, wortAbstand, VORRAT, TEXTE, STIMMEN, FIGUREN, MANIFEST };

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
    } else if (cmd === 'pruefe') {
      const r = await pruefeVorrat();
      for (const x of r) if (!x.gleich) console.log(x.stimme + ' ' + x.datei + '  soll: ' + x.soll + '  ist: ' + x.ist + '  (Abstand ' + x.abstand + ')');
      console.log('geprüft: ' + r.length + ', nach Normalform gleich: ' + r.filter(x => x.gleich).length);
      if (a) fs.writeFileSync(a, JSON.stringify(r, null, 1));
    } else if (cmd === 'hoerprobe' && a) {
      await hoerprobe(a, b);
    } else {
      console.log('Aufruf: node tools/bot-clips.js profiles | say <profil> <text> | vorrat | pruefe [ergebnis.json] | hoerprobe <zielordner> [namensfilter-regex]');
    }
  })().catch(e => { console.error(e.message); process.exit(1); });
}
