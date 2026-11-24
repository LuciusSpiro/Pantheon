'use strict';
// BOT-04 D3: Messwerkzeug fuer die Latenz Sprechtaste loslassen -> Bot-Wirkung / Ton im ECHTEN Spiel (Abnahme 9). Misst, behauptet nichts: Median und p90, kein Zielwert.
// NICHT in der npm-test-Kette (braucht Sleipnir: Voicebox fuer die Sprache, STT-Dienst fuer die Erkennung); in tools/testliste.json unter "ausgenommen". Aufruf: npm run mess:bot-latenz -- --hilfe
//
// Aufbau: je Befehl ein eigener Spielserver (echter server/index.js, ROOM_CODE=off, Weltordner im Temp-Verzeichnis, STT_URL=http://127.0.0.1:8300) und ein eigener Chrome (installiert, headless).
// Mensch = Captain (Debug-Sitz), drei Server-Bots (Navigation, Ops, Technik) ueber die Lobby. Die Sprache ist an wie durch den Schalter in den Optionen (localStorage pantheon.botsprache = 1).
// Die gesprochene Phrase kommt aus dem Mikrofon-Ersatz von Chrome (--use-file-for-fake-audio-capture): eine WAV, die die Qwen-Stimme auf Sleipnir (Voicebox, tools/bot-clips.js) erzeugt hat,
// nach 48 kHz mono 16 Bit umgerechnet, mit Stille vorn (LEAD_MS) und hinten (TAIL_MS). Echte Sprechtaste: Backquote halten fuer die Laenge der WAV, loslassen = t0.
// Marken ab t0 (performance.now im Browser, alles nur ueber Aussenhaken, KEIN Produktcode geaendert):
//   t_aufnahme_ende  Beginn des POST /api/stt (Aufnahme beendet, Blob fertig)      t_stt  Antwort des POST /api/stt (Text da)
//   t_matcher        bot.befehl geht ueber die Spielverbindung hinaus (Matcher fertig; WebSocket.send wird beobachtet)
//   t_antwort        bot.antwort mit status ok im Client angekommen (rohes WebSocket-Ereignis, vor der Verarbeitung durch das Spiel)
//   t_zustand        erste Spielzustands-Aenderung im Snapshot, die der Befehl bewirkt (je Befehl eine Pruefregel unten, sonst "nicht trennbar")
//   t_ton            Clip-Wiedergabe beginnt (Ereignis playing des Audio-Elements, HTMLMediaElement.play wird beobachtet)
// Verzerrungen (siehe auch Kopf der Zusammenfassung): Snapshots kommen alle net.snapEvery Ticks (Granularitaet des Zustands, bis zu +1 Snapshot-Takt), headless + Software-GL (swiftshader) belastet den Client,
// STT ueber SSH-Tunnel, die WAV hat TAIL_MS Stille nach dem Sprachende (ein Mensch laesst oft frueher los), pro Start ein Aufwaermlauf (Matcher, Whisper, Clip-Dekodierung kalt), der nicht zaehlt.
// Fake-Audio-Schleife: --use-file-for-fake-audio-capture=<wav>%noloop (die Datei laeuft einmal; das Mikrofon wird je Tastendruck neu geoeffnet). Ob Chrome je Oeffnen neu beginnt, prueft das Werkzeug je Messung
// am Ergebnis (erkannter Text); Fehlschlaege stehen als "nicht erkannt" in der Zusammenfassung, nicht als Messwert.
//
// Aufruf: node tools/bot-latenz.js [--n 2] [--befehle nav.stopp,nav.schub] [--port 3470] [--keine-stt] [--aufwaerm 1] [--sichtbar] [--hilfe]
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const hat = (n) => process.argv.includes('--' + n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LEAD_MS = 400;     // Stille vor der Phrase (das Mikrofon geht erst nach getUserMedia auf)
const TAIL_MS = 250;     // Stille nach der Phrase (bis zum Loslassen)
const RATE = 48000;
const STT_URL = 'http://127.0.0.1:8300';
const WARTE_ANTWORT_MS = 15000, WARTE_ZUSTAND_MS = 5000, WARTE_TON_MS = 3000;

// ---------------------------------------------------------------- die 22 sprechbaren Befehle (content/bots/kanon.json), je eine Sprechform
// text: Sprechform aus dem Kanon (Menue/Taste/Sprache zeigen dieselbe), erwartet: was der Matcher liefern muss; vor: Vorbereitung je Wiederholung (Befehle ueber die Spielverbindung wie das Menue, dann warten);
// zustand: Quelltext einer Funktion (s, b) -> bool; s = Schiff im Snapshot (verkleinert, siehe PICK), b = dasselbe zum Zeitpunkt des Loslassens. null = im Spiel nicht beobachtbar -> "nicht trennbar".
const SEND = (an, befehl, args) => ({ send: { t: 'bot.befehl', an, befehl, args, quelle: 'menu' } });
const BEFEHLE = [
  { id: 'nav.kurs', an: 'navigation', text: 'Kurs auf die Basis', args: { ziel: 'basis' }, vor: [SEND('navigation', 'nav.stopp', {}), { warte: 's.stage === s.stop && s.speed < 3' }],   // die Markierung ist das Anzeigeziel eines OBJEKTS (Gegner, Mine, Station): ohne Objekte in der Szene kein_ziel; die Basis geht
    zustand: 's.stage !== b.stage || s.turn !== b.turn' },
  { id: 'nav.stopp', an: 'navigation', text: 'Alle Maschinen stopp', args: {}, vor: [SEND('navigation', 'nav.schub', { stufe: 'halb' }), { warte: 's.stage === 3' }], zustand: 's.stage === s.stop && b.stage !== b.stop' },
  { id: 'nav.schub', an: 'navigation', text: 'Halbe Kraft voraus', args: { stufe: 'halb' }, vor: [SEND('navigation', 'nav.stopp', {}), { warte: 's.stage === s.stop' }], zustand: 's.stage === 3 && b.stage !== 3' },
  { id: 'nav.ausweichen', an: 'navigation', text: 'Ausweichen', args: {}, vor: [{ warte: 's.dodgeCd === 0' }], zustand: 's.dodgeCd > 0 && b.dodgeCd === 0' },
  { id: 'nav.abstand', an: 'navigation', text: 'Abstand zur Basis halten', args: { ziel: 'basis' }, vor: [SEND('navigation', 'nav.stopp', {}), { warte: 's.stage === s.stop && s.speed < 3' }], zustand: 's.stage !== b.stage || s.turn !== b.turn' },
  { id: 'nav.andocken', an: 'navigation', text: 'Andocken', args: {}, vor: [SEND('navigation', 'nav.stopp', {}), { warte: 's.stage === s.stop && s.speed < 3' }], zustand: 's.stage !== b.stage || s.turn !== b.turn' },
  { id: 'ops.ziel', an: 'ops', text: 'Nächstes Ziel', args: { ziel: 'naechstes' }, vor: [], zustand: null },   // ohne Gegner kein Ziel im Snapshot
  { id: 'ops.feuer_frei', an: 'ops', text: 'Feuer frei Bugwaffen', args: { waffen: 'bug' }, vor: [], zustand: null },   // Feuerzustand ist Absicht des Server-Bots, im Snapshot nicht sichtbar (nur Ladung/Schuss bei Gegner)
  { id: 'ops.feuer_halt', an: 'ops', text: 'Feuer einstellen', args: {}, vor: [], zustand: null },
  { id: 'ops.scan', an: 'ops', text: 'Scannen', args: {}, vor: [], zustand: null },
  { id: 'ops.landescan', an: 'ops', text: 'Landepunkt scannen', args: {}, vor: [], zustand: null },
  { id: 'ops.beamen', an: 'ops', text: 'Person an Bord', args: { was: 'person' }, vor: [], zustand: null },
  { id: 'tech.prio', an: 'technik', text: 'Feuer zuerst', args: { ziel: 'feuer' }, vor: [], zustand: null },   // gehaltene Prioritaet, im Snapshot erst sichtbar, wenn es brennt
  { id: 'tech.reparieren', an: 'technik', text: 'Reaktor reparieren', args: { system: 'reactor' }, vor: [], zustand: null },   // heiles System: nicht_jetzt
  { id: 'tech.schild', an: 'technik', text: 'Schilde Heck', args: { sektor: 'heck' }, vor: [SEND('technik', 'tech.schild', { sektor: 'bug' }), { warte: 's.alloc[2] === 0 && s.alloc[0] === 4' }], zustand: 's.alloc[2] > b.alloc[2]' },   // Steuerbord stuende schon auf der Bot-Obergrenze 4 (kern.js BOT_SCHILD_SEKTOR_MAX): keine sichtbare Folge; Heck startet bei 0
  { id: 'tech.energie', an: 'technik', text: 'Mehr Energie auf Waffen', args: { system: 'weapons', delta: 1 }, vor: [SEND('technik', 'tech.energie', { system: 'weapons', delta: -1 }), { warte: 's.power.weapons < 2' }], zustand: 's.power.weapons > b.power.weapons' },
  { id: 'tech.ueberladen', an: 'technik', text: 'Reaktor überladen', args: {}, vor: [{ warte: 's.ro === 0' }], zustand: 's.ro > 0 && !(b.ro > 0)' },
  { id: 'bord.rueckholen', an: 'bord', text: 'Außenteam zurückholen', args: {}, vor: [], zustand: null },
  { id: 'bord.sensor', an: 'bord', text: 'Sensor', args: {}, vor: [], zustand: null },
  { id: 'bord.kuppel', an: 'bord', text: 'Kuppel', args: {}, vor: [], zustand: null },
  { id: 'bot.status', an: 'alle', text: 'Statusbericht', args: {}, vor: [], zustand: null },     // die Antwort IST die Wirkung: nicht trennbar
  { id: 'bot.automatik', an: 'alle', text: 'Automatik', args: {}, vor: [], zustand: null },
];

// ---------------------------------------------------------------- Hilfe
if (hat('hilfe') || hat('help') || hat('h')) {
  console.log([
    'bot-latenz: Latenz Sprechtaste loslassen -> Bot-Antwort / Spielzustand / Ton im echten Spiel (BOT-04 Abnahme 9).',
    '',
    'Aufruf: node tools/bot-latenz.js [Optionen]      oder   npm run mess:bot-latenz -- [Optionen]',
    '  --n <k>           Wiederholungen je Befehl (Standard 2). Gesamt-n je Marke = k x Zahl der Befehle (22 Befehle: --n 2 gibt 44, --n 3 gibt 66; fuer n >= 30 reichen 22 x 2).',
    '  --befehle <liste> kommagetrennt, z. B. nav.stopp,nav.schub,tech.schild (Standard: alle 22). --liste zeigt die Befehle.',
    '  --port <p>        erster Port (Standard 3470, belegt werden hoechstens 3470 bis 3479); nie 3100/3300.',
    '  --keine-stt       Trockenlauf ohne Sleipnir: Text per Textzeile (Backslash) statt Sprache, nur Marken Antwort und Zustand (und Ton).',
    '  --aufwaerm <k>    Aufwaermlaeufe je Start, zaehlen nicht (Standard 1).',
    '  --sichtbar        Chrome mit Fenster statt headless.',
    '  --ausgabe <dir>   Ausgabeordner (Standard messungen/, git-ignoriert).',
    '  --liste           Befehle und Pruefregeln auflisten.',
    'Voraussetzung Sprache: SSH-Zugang `ssh sleipnir` (Tunnel zur STT auf Port 8300 startet das Werkzeug selbst und beendet ihn danach nur, wenn er von ihm kam; Voicebox fuer die Sprach-WAVs,',
    'WAVs liegen im Cache messungen/wav-cache/ und werden nur bei Bedarf erzeugt). Ausgabe: messungen/bot-latenz-<zeit>.jsonl (eine Zeile je Messung) und -zusammenfassung.json.',
  ].join('\n'));
  process.exit(0);
}
if (hat('liste')) { for (const b of BEFEHLE) console.log(b.id.padEnd(18) + ' "' + b.text + '"  ' + (b.zustand ? 'Zustand: ' + b.zustand : 'Zustand: nicht trennbar')); process.exit(0); }

const N = Math.max(1, parseInt(arg('n', '2'), 10) || 2);
const AUFWAERM = Math.max(0, parseInt(arg('aufwaerm', '1'), 10));
const PORT0 = parseInt(arg('port', '3470'), 10);
const KEINE_STT = hat('keine-stt');
const OUT = path.resolve(arg('ausgabe', path.join(ROOT, 'messungen')));
const WAV_CACHE = path.join(OUT, 'wav-cache');
const WAEHLE = (arg('befehle', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const LISTE = WAEHLE.length ? BEFEHLE.filter((b) => WAEHLE.includes(b.id)) : BEFEHLE;
const unbekannt = WAEHLE.filter((id) => !BEFEHLE.some((b) => b.id === id));
if (unbekannt.length) { console.error('Unbekannte Befehle: ' + unbekannt.join(', ')); process.exit(2); }
if (PORT0 === 3100 || PORT0 === 3300) { console.error('Port 3100/3300 ist tabu.'); process.exit(2); }

function playwright() {
  for (const k of [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'C:/tmp/pw-test/node_modules/playwright-core', 'C:/tmp/pwtest/node_modules/playwright-core'].filter(Boolean)) { try { return require(k); } catch (e) { /* weiter */ } }
  console.error('playwright-core nicht gefunden'); process.exit(2);
}
const { chromium } = playwright();
const httpOk = (port, p, ms) => new Promise((res) => { const r = http.get({ host: '127.0.0.1', port, path: p || '/', timeout: ms || 800 }, (x) => { x.resume(); res(x.statusCode >= 200 && x.statusCode < 400); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });

// ---------------------------------------------------------------- Aufraeumen
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-botlatenz-'));
const kinder = new Set();
let tunnel = null;
function aufraeumen() {
  for (const k of kinder) { try { k.kill(); } catch (e) { /* egal */ } }
  kinder.clear();
  if (tunnel) { try { tunnel.kill(); } catch (e) { /* egal */ } tunnel = null; }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
}
process.on('exit', aufraeumen);
process.on('SIGINT', () => { aufraeumen(); process.exit(130); });
process.on('SIGTERM', () => { aufraeumen(); process.exit(143); });

// ---------------------------------------------------------------- Sprache -> WAV (Voicebox, Qwen) -> 48 kHz mono 16 Bit mit Stille vorn und hinten
function wavLesen(buf) {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF') throw new Error('keine WAV-Datei');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.length) {
    const id = buf.toString('latin1', o, o + 4), n = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(o + 8), kan: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
    if (id === 'data') { data = { start: o + 8, len: Math.min(n, buf.length - o - 8) }; break; }
    o += 8 + n + (n & 1);
  }
  if (!fmt || !data) throw new Error('WAV ohne fmt/data');
  const bytes = fmt.bits / 8, frames = Math.floor(data.len / (bytes * fmt.kan)), out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let k = 0; k < fmt.kan; k++) {
      const p = data.start + (i * fmt.kan + k) * bytes;
      s += fmt.tag === 3 && fmt.bits === 32 ? buf.readFloatLE(p) : fmt.bits === 16 ? buf.readInt16LE(p) / 32768 : (() => { throw new Error('WAV-Format ' + fmt.tag + '/' + fmt.bits + ' nicht unterstuetzt'); })();
    }
    out[i] = s / fmt.kan;
  }
  return { rate: fmt.rate, samples: out };
}
function wavSchreiben(samples, rate) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8, 'latin1'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36, 'latin1'); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}
function umrechnen(wavBuf) {   // Stille vorn/hinten der Voicebox weg (trimWav), auf 48 kHz, LEAD_MS/TAIL_MS Stille drum
  const { trimWav } = require('./bot-clips.js');
  const w = wavLesen(trimWav(wavBuf));
  const ziel = Math.max(1, Math.round(w.samples.length * RATE / w.rate)), r = new Float32Array(ziel);
  for (let i = 0; i < ziel; i++) { const x = i * w.rate / RATE, a = Math.floor(x), b = Math.min(w.samples.length - 1, a + 1), f = x - a; r[i] = w.samples[a] * (1 - f) + w.samples[b] * f; }
  const lead = Math.round(RATE * LEAD_MS / 1000), tail = Math.round(RATE * TAIL_MS / 1000), out = new Float32Array(lead + ziel + tail);
  out.set(r, lead);
  return { wav: wavSchreiben(out, RATE), dauerMs: Math.round(out.length * 1000 / RATE), sprechMs: Math.round(ziel * 1000 / RATE) };
}
let profilCache = null;
async function befehlsWav(b) {
  fs.mkdirSync(WAV_CACHE, { recursive: true });
  const clips = require('./bot-clips.js');
  const stimmen = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'bots', 'stimmen.json'), 'utf8'));
  const sp = stimmen.b1;   // eine feste Stimme fuer den "Captain" (Nuechtern); die Bots sprechen im Spiel mit ihren eigenen
  if (!profilCache) { const alle = await clips.listProfiles(); profilCache = alle.find((p) => p.id === sp.profilId); if (!profilCache) throw new Error('Profil ' + sp.profilName + ' nicht in Voicebox'); }
  const roh = await clips.synth(profilCache, b.text, { dir: path.join(WAV_CACHE, 'roh') });
  const ziel = path.join(WAV_CACHE, b.id + '.' + clips.clipHash(profilCache.id, b.text) + '.' + RATE + '.wav');
  let dauer;
  if (fs.existsSync(ziel)) { const w = wavLesen(fs.readFileSync(ziel)); dauer = Math.round(w.samples.length * 1000 / w.rate); }
  else { const u = umrechnen(fs.readFileSync(roh.file)); fs.writeFileSync(ziel, u.wav); dauer = u.dauerMs; }
  return { datei: ziel, dauerMs: dauer, aus: roh.cached ? 'cache' : roh.ms + ' ms' };
}

// ---------------------------------------------------------------- STT-Tunnel
async function sttBereit() {
  if (await httpOk(8300, '/health', 1500)) return false;   // steht schon (nicht unser)
  console.log('STT-Tunnel: ssh -N -L 8300:127.0.0.1:8300 sleipnir');
  tunnel = spawn('ssh', ['-N', '-L', '8300:127.0.0.1:8300', '-o', 'ExitOnForwardFailure=yes', '-o', 'BatchMode=yes', 'sleipnir'], { stdio: 'ignore' });
  tunnel.on('exit', () => { tunnel = null; });
  for (let i = 0; i < 60; i++) { if (await httpOk(8300, '/health', 1500)) return true; await sleep(250); }
  throw new Error('STT auf Port 8300 antwortet nicht (Tunnel/Sleipnir pruefen)');
}

// ---------------------------------------------------------------- Browser-Haken (nur beobachten, nichts aendern)
const PICK = (s) => ({ stage: s.helm && s.helm.stage, stop: s.helm && s.helm.stop, turn: s.helm && s.helm.turn, alloc: s.shields && s.shields.alloc ? s.shields.alloc.slice() : [0, 0, 0, 0], power: Object.assign({}, s.power), dodgeCd: s.dodgeCd, docked: s.docked, speed: s.speed, ro: s.reactor ? s.reactor.overloadLeft : 0, x: s.x, y: s.y });
function haken(pickSrc) {
  const M = window.__m = { ev: [], armed: false, hit: false, base: null, last: null, watch: null, textmodus: false };
  const rec = (n, x) => M.ev.push(Object.assign({ n, t: performance.now() }, x || {}));
  M.rec = rec;
  const los = () => { rec('release'); M.base = M.last; M.hit = false; M.armed = true; };
  window.addEventListener('keydown', (e) => { if (e.code === 'Backquote' && !e.repeat) rec('press'); if (e.code === 'Enter' && M.textmodus && !e.repeat) los(); }, true);
  window.addEventListener('keyup', (e) => { if (e.code === 'Backquote') los(); }, true);
  const F = window.fetch;
  window.fetch = function (u) {
    const url = String((u && u.url) || u);
    if (url.indexOf('/api/stt') < 0) return F.apply(this, arguments);
    rec('stt_start');
    return F.apply(this, arguments).then((r) => { rec('stt_antwort'); r.clone().json().then((j) => rec('stt_text', { text: j && j.text }), () => {}); return r; });
  };
  const S = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) { try { if (typeof d === 'string' && d.indexOf('bot.befehl') >= 0) { const m = JSON.parse(d); if (m && m.t === 'bot.befehl') rec('befehl', { befehl: m.befehl, an: m.an, args: m.args || null, quelle: m.quelle }); } } catch (e) { /* egal */ } return S.apply(this, arguments); };
  const W = window.WebSocket;
  window.WebSocket = new Proxy(W, { construct(t, a) { const ws = new t(...a); ws.addEventListener('message', (ev) => { const d = ev.data; if (typeof d === 'string' && d.indexOf('bot.antwort') >= 0) { try { const m = JSON.parse(d); if (m && m.t === 'bot.antwort') rec('antwort', { befehl: m.befehl, status: m.status, textId: m.textId, botId: m.botId }); } catch (e) { /* egal */ } } }); return ws; } });
  const P = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { const src = this.currentSrc || this.src; rec('play_call', { src }); this.addEventListener('playing', () => rec('playing', { src }), { once: true }); return P.apply(this, arguments); };
  M.pick = new Function('s', 'return (' + pickSrc + ')(s)');
}
function snapHaken() {   // nach dem Laden: ueber Net.on (parst die Nachricht ohnehin), je Snapshot Zustand verkleinern und die Pruefregel auswerten
  const M = window.__m;
  Net.on((m) => {
    if (!m || m.t !== 'snap' || !m.ship) return;
    const s = M.pick(m.ship); M.last = s;
    if (M.armed && !M.hit && M.watch && M.base) { let ok = false; try { ok = !!M.watch(s, M.base); } catch (e) { ok = false; } if (ok) { M.hit = true; M.rec('zustand'); } }
  });
}

// ---------------------------------------------------------------- Spiel
async function startServer(port, stt) {
  if (await httpOk(port, '/')) throw new Error('Port ' + port + ' belegt');
  const dir = path.join(TMP, 'srv' + port + '-' + Date.now());
  const env = Object.assign({}, process.env, { PORT: String(port), ROOM_CODE: 'off', WORLD_DIR: path.join(dir, 'worlds'), REGIE_DIR: path.join(dir, 'regie'), ERZEUGT_DIR: path.join(dir, 'erzeugt') });
  delete env.LLM_LIVE; delete env.SPIELLEITER_LLM;
  if (stt) env.STT_URL = STT_URL; else delete env.STT_URL;
  const srv = spawn(process.execPath, ['server/index.js', '--debug'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  kinder.add(srv);
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 200 && !(await httpOk(port, '/')); i++) await sleep(100);
  if (!(await httpOk(port, '/'))) { srv.kill(); throw new Error('Server startet nicht: ' + log.slice(-300)); }
  return { srv, log: () => log, ende() { try { srv.kill(); } catch (e) { /* egal */ } kinder.delete(srv); } };
}
async function oeffneSpiel(port, wavDatei) {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (wavDatei) args.push('--use-file-for-fake-audio-capture=' + wavDatei + '%noloop');
  const opt = { args, headless: !hat('sichtbar') };
  let browser;
  try { browser = await chromium.launch(Object.assign({ channel: 'chrome' }, opt)); } catch (e) { browser = await chromium.launch(opt); }   // installierter Chrome, sonst das Chromium von Playwright
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const fehler = []; page.on('pageerror', (e) => fehler.push(e.message));
  await page.addInitScript(() => { try { window.localStorage.setItem('pantheon.botsprache', '1'); } catch (e) { /* egal */ } });   // Opt-in wie der Schalter in den Optionen
  await page.addInitScript(haken, PICK.toString());
  await page.goto('http://127.0.0.1:' + port + '/?debug=1&render=2d');
  await page.waitForFunction(() => window.__game && __game.send && __game.state && window.Net, null, { timeout: 30000 });
  for (const r of ['navigation', 'ops', 'technik']) { await page.evaluate((x) => __game.send({ t: 'lobbyBot', op: 'add', rolle: x }), r); await sleep(150); }
  await page.waitForFunction(() => __game.state.players.filter((p) => p.bot).length >= 3, null, { timeout: 8000 });
  await page.evaluate(() => __game.send({ t: 'lobbyOpt', startMission: 'free', skipDrill: true }));
  await page.evaluate(() => __game.send({ t: 'ready', ready: true }));
  await page.waitForFunction(() => __game.state && __game.state.phase !== 'lobby', null, { timeout: 30000 });
  await page.evaluate(() => __game.send({ t: 'debug', cmd: 'sitz', console: 'captain', hin: true }));
  await page.waitForFunction(() => __game.state.players.find((p) => p.id === __game.pid && p.console === 'captain'), null, { timeout: 8000 });
  await page.waitForFunction(() => { const b = __game.state.players.filter((p) => p.bot); return b.length === 3 && b.every((p) => p.console); }, null, { timeout: 25000 });   // Bots sitzen an ihren Stationen
  await page.waitForFunction(() => window.BotSprache && BotSprache.laeuft(), null, { timeout: 15000 });
  await page.evaluate(snapHaken);
  await page.mouse.move(5, 5);
  await sleep(500);
  return { browser, page, fehler };
}
const zustandWarte = (page, ausdruck, ms) => page.waitForFunction((src) => { const st = __game.state; if (!st || !st.ship) return false; const s = (window.__m.pick)(st.ship); return !!(new Function('s', 'return (' + src + ')'))(s); }, ausdruck, { timeout: ms || 15000 }).then(() => true, () => false);
const sendeBefehl = (page, m) => page.evaluate((x) => Net.send(x), m);

async function vorbereiten(page, b) {   // je Wiederholung den Ausgangszustand herstellen (ueber die Spielverbindung wie das Menue, nicht ueber die Sprache)
  const ok = [];
  for (const v of b.vor) {
    if (v.send) { await sendeBefehl(page, v.send); await sleep(150); }
    else if (v.warte) ok.push(await zustandWarte(page, v.warte, 15000));
  }
  await sleep(2200);   // Quittung/Clip der Vorbereitung ausklingen lassen (zaehlt nicht), danach ist Ruhe
  return ok.every(Boolean);
}
async function unterwegs(page) {   // einmal je Start: das Schiff liegt im Hafen und dockt nahe dem Liegeplatz von selbst wieder an; Volle Kraft traegt es weit genug weg (450 px), dann Stopp
  const start = await page.evaluate(() => ({ x: __game.state.ship.x, y: __game.state.ship.y }));
  await sendeBefehl(page, { t: 'bot.befehl', an: 'navigation', befehl: 'nav.schub', args: { stufe: 'voll' }, quelle: 'menu' });
  const los = await page.waitForFunction((p) => { const s = __game.state.ship; return s.docked === false && Math.hypot(s.x - p.x, s.y - p.y) > 450; }, start, { timeout: 30000 }).then(() => true, () => false);
  await sendeBefehl(page, { t: 'bot.befehl', an: 'navigation', befehl: 'nav.stopp', args: {}, quelle: 'menu' });
  await zustandWarte(page, 's.stage === s.stop && s.speed < 3', 15000);
  await sleep(2500);
  return los;
}

const erwartungOk = (b, e) => !!e && e.befehl === b.id && (!b.an || b.an === 'alle' || e.an === b.an) && Object.keys(b.args || {}).every((k) => String(e.args && e.args[k]) === String(b.args[k]));
async function messen(page, b, wav) {
  await page.evaluate((src) => { const M = window.__m; M.ev.length = 0; M.armed = false; M.hit = false; M.base = null; M.watch = src ? new Function('s', 'b', 'return (' + src + ')') : null; M.textmodus = false; }, b.zustand);
  if (KEINE_STT) {
    await page.evaluate(() => { window.__m.textmodus = true; });
    await page.keyboard.press('Backslash'); await sleep(250);
    await page.keyboard.type(b.text, { delay: 5 }); await sleep(150);
    await page.keyboard.press('Enter');
  } else {
    await page.keyboard.down('Backquote');
    await sleep(wav.dauerMs);
    await page.keyboard.up('Backquote');
  }
  // warten: Antwort (oder Ende ohne Befehl), dann Zustand und Ton
  const t_start = Date.now(), t_ende = t_start + WARTE_ANTWORT_MS;
  let ev = [];
  while (Date.now() < t_ende) {
    ev = await page.evaluate(() => window.__m.ev.slice());
    const rel = ev.find((e) => e.n === 'release');
    if (rel && ev.some((e) => e.n === 'antwort' && e.t > rel.t)) break;
    const stt = ev.find((e) => e.n === 'stt_text');
    if (rel && stt && !ev.some((e) => e.n === 'befehl' && e.t > rel.t) && Date.now() - t_start > 3000) { await sleep(1500); if (!(await page.evaluate(() => window.__m.ev.some((e) => e.n === 'befehl')))) break; }
    await sleep(80);
  }
  const t_zustand_ende = Date.now() + (b.zustand ? WARTE_ZUSTAND_MS : 0);
  for (;;) {
    ev = await page.evaluate(() => window.__m.ev.slice());
    const rel = ev.find((e) => e.n === 'release');
    const hatZ = ev.some((e) => e.n === 'zustand' && rel && e.t > rel.t), hatT = ev.some((e) => e.n === 'playing' && rel && e.t > rel.t);
    if ((!b.zustand || hatZ) && hatT) break;
    if (Date.now() > t_zustand_ende + WARTE_TON_MS) break;
    await sleep(80);
  }
  const rel = ev.find((e) => e.n === 'release');
  const m = { befehl: b.id, text: b.text, stt: !KEINE_STT, zeit: new Date().toISOString() };
  if (!rel) { m.fehler = 'kein Loslassen beobachtet'; return m; }
  const t0 = rel.t, nach = (n, f) => ev.find((e) => e.n === n && e.t > t0 && (!f || f(e)));
  const d = (e) => (e ? Math.round(e.t - t0) : null);
  const press = ev.find((e) => e.n === 'press');
  m.halten_ms = press ? Math.round(t0 - press.t) : null;
  const stt = nach('stt_text');
  m.rohtext = stt ? (stt.text == null ? null : String(stt.text)) : null;
  m.t_aufnahme_ende_ms = d(nach('stt_start'));
  m.t_stt_ms = d(nach('stt_antwort'));
  const bef = nach('befehl');
  m.t_matcher_ms = d(bef);
  m.erkannt = !!bef && erwartungOk(b, bef);
  m.gesendet = bef ? { befehl: bef.befehl, an: bef.an, args: bef.args } : null;
  const ant = nach('antwort');
  m.antwort_status = ant ? ant.status : null; m.antwort_textId = ant ? ant.textId : null;
  m.t_antwort_ms = d(ant);   // Eingang bot.antwort (Annahme durch den Server); ok/abgelehnt steht in antwort_status
  m.t_antwort_ok = !!ant && ant.status === 'ok';
  const z = nach('zustand');
  m.t_zustand_ms = d(z);
  m.zustand_status = !b.zustand ? 'nicht-trennbar' : z ? 'beobachtet' : (await page.evaluate(() => { const M = window.__m; return !!(M.base && M.watch && M.watch(M.last, M.base)); })) ? 'vorab-erfuellt' : 'keine-aenderung';
  m.lage = await page.evaluate(() => { const b = window.__m.base; return b ? { docked: b.docked, stage: b.stage, speed: b.speed, dodgeCd: b.dodgeCd, alloc: b.alloc, weapons: b.power && b.power.weapons } : null; });   // Ausgangslage beim Loslassen (zur Deutung von abgelehnt/keine-aenderung)
  const ton = nach('playing');
  m.t_ton_ms = d(ton); m.t_play_call_ms = d(nach('play_call'));
  m.ton_clip = ton ? ton.src.replace(/^.*\/stimmen\//, '') : null;
  if (!ton) m.ton_status = ant ? (ant.status === 'ok' ? 'kein-clip' : 'ablehnung-ohne-clip') : 'keine-antwort';
  return m;
}

// ---------------------------------------------------------------- Statistik
const perz = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.max(0, Math.ceil(p * s.length) - 1)]; };
const stat = (a) => { const v = a.filter((x) => x != null); return { n: v.length, median: perz(v, 0.5), p90: perz(v, 0.9), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null }; };
const MARKEN = ['t_aufnahme_ende_ms', 't_stt_ms', 't_matcher_ms', 't_antwort_ms', 't_zustand_ms', 't_ton_ms'];
function zusammenfassung(zeilen) {
  const z = zeilen.filter((m) => !m.aufwaermen && !m.fehler);
  const werte = (liste, marke) => liste.map((m) => m[marke]).filter((x) => x != null);
  const fuer = (liste) => {
    const o = { messungen: liste.length, erkannt: liste.filter((m) => m.erkannt).length, nicht_erkannt: liste.filter((m) => !m.erkannt).length, antwort_ok: liste.filter((m) => m.t_antwort_ok).length, abgelehnt: liste.filter((m) => m.antwort_status && m.antwort_status !== 'ok').length };
    for (const k of MARKEN) o[k.replace(/_ms$/, '')] = stat(werte(liste, k));
    o.zustand_nicht_trennbar = liste.length && liste.every((m) => m.zustand_status === 'nicht-trennbar');
    o.zustand_status = {}; for (const m of liste) o.zustand_status[m.zustand_status] = (o.zustand_status[m.zustand_status] || 0) + 1;
    return o;
  };
  const je = {}; for (const b of LISTE) { const l = z.filter((m) => m.befehl === b.id); if (l.length) je[b.id] = fuer(l); }
  return { insgesamt: fuer(z), je_befehl: je, aufwaermlaeufe: zeilen.filter((m) => m.aufwaermen).length, fehler: zeilen.filter((m) => m.fehler).map((m) => m.befehl + ': ' + m.fehler) };
}
const f = (s) => (s && s.n ? s.median + '/' + s.p90 + ' (' + s.n + ')' : '-');
function tabelle(sum) {
  const kopf = ['Befehl'.padEnd(17), 'n', 'erk', 'ok', 'stt', 'matcher', 'antwort', 'zustand', 'ton'];
  const zeilen = [kopf.join(' | ')];
  const zeile = (name, o) => zeilen.push([name.padEnd(17), String(o.messungen).padStart(2), String(o.erkannt).padStart(3), String(o.antwort_ok).padStart(2), f(o.t_stt).padStart(14), f(o.t_matcher).padStart(14), f(o.t_antwort).padStart(14), (o.zustand_nicht_trennbar ? 'nicht trennbar' : f(o.t_zustand) + (o.zustand_status['vorab-erfuellt'] || o.zustand_status['keine-aenderung'] ? ' [' + Object.entries(o.zustand_status).filter(([k]) => k !== 'beobachtet').map(([k, v]) => k + ' ' + v).join(',') + ']' : '')).padStart(14), f(o.t_ton).padStart(14)].join(' | '));
  for (const [k, o] of Object.entries(sum.je_befehl)) zeile(k, o);
  zeile('ALLE', sum.insgesamt);
  return 'Median/p90 in ms ab Loslassen (n):\n' + zeilen.join('\n');
}

// ---------------------------------------------------------------- Lauf
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const jsonl = path.join(OUT, 'bot-latenz-' + stamp + '.jsonl');
  const alle = [];
  if (!KEINE_STT) { try { const eigen = await sttBereit(); console.log('STT erreichbar auf 8300' + (eigen ? ' (Tunnel von diesem Werkzeug)' : ' (stand schon)')); } catch (e) { console.error(e.message); process.exit(1); } }
  let i = 0;
  for (const b of LISTE) {
    const port = PORT0 + (i++ % 10);
    console.log('\n== ' + b.id + ' "' + b.text + '" (Port ' + port + ')');
    let wav = null, srv = null, spiel = null;
    try {
      if (!KEINE_STT) { wav = await befehlsWav(b); console.log('   WAV ' + wav.dauerMs + ' ms (' + wav.aus + ')'); }
      srv = await startServer(port, !KEINE_STT);
      spiel = await oeffneSpiel(port, wav && wav.datei);
      const los = await unterwegs(spiel.page);
      if (!los) console.log('   Hinweis: das Schiff hat nicht abgelegt (Flugbefehle evtl. ohne Wirkung)');
      for (let k = 0; k < AUFWAERM + N; k++) {
        const warm = k < AUFWAERM;
        const vorOk = await vorbereiten(spiel.page, b);
        const m = await messen(spiel.page, b, wav);
        m.aufwaermen = warm; m.wiederholung = warm ? null : k - AUFWAERM + 1; m.vorbereitung_ok = vorOk;
        alle.push(m); fs.appendFileSync(jsonl, JSON.stringify(m) + '\n');
        console.log('   ' + (warm ? 'warm ' : 'rep' + m.wiederholung + '  ') + (m.fehler ? 'FEHLER ' + m.fehler : 'erk=' + (m.erkannt ? 'ja' : 'NEIN') + ' roh="' + (m.rohtext == null ? '' : m.rohtext) + '" stt=' + m.t_stt_ms + ' matcher=' + m.t_matcher_ms + ' antwort=' + m.t_antwort_ms + '(' + m.antwort_status + ') zustand=' + (m.t_zustand_ms == null ? m.zustand_status : m.t_zustand_ms) + ' ton=' + (m.t_ton_ms == null ? m.ton_status : m.t_ton_ms)));
      }
      if (spiel.fehler.length) console.log('   Seitenfehler: ' + spiel.fehler.slice(0, 3).join(' | '));
    } catch (e) {
      console.log('   FEHLER ' + (e && e.message));
      const m = { befehl: b.id, fehler: String(e && e.message).slice(0, 300), zeit: new Date().toISOString() }; alle.push(m); fs.appendFileSync(jsonl, JSON.stringify(m) + '\n');
    } finally {
      if (spiel) { try { await spiel.browser.close(); } catch (e) { /* egal */ } }
      if (srv) srv.ende();
    }
  }
  const sum = zusammenfassung(alle);
  const kopf = { werkzeug: 'tools/bot-latenz.js', zeit: new Date().toISOString(), n_je_befehl: N, aufwaerm_je_start: AUFWAERM, modus: KEINE_STT ? 'Text (ohne STT, ohne Aufnahme)' : 'Sprache (Chrome-Fake-Mikrofon, Qwen-Stimme, STT ueber Tunnel)', lead_ms: LEAD_MS, tail_ms: TAIL_MS,
    hinweise: ['t0 = Loslassen der Sprechtaste (keyup, capture) bzw. Enter in der Textzeile im Browser (performance.now)', 'Snapshot-Takt begrenzt die Aufloesung von t_zustand', 'headless + Software-GL', 'TAIL_MS Stille nach dem Sprachende in der WAV', 'Aufwaermlauf nicht gezaehlt'] };
  fs.writeFileSync(path.join(OUT, 'bot-latenz-' + stamp + '-zusammenfassung.json'), JSON.stringify(Object.assign({}, kopf, sum), null, 1));
  console.log('\n' + tabelle(sum));
  console.log('\nnicht erkannt: ' + sum.insgesamt.nicht_erkannt + ' von ' + sum.insgesamt.messungen + ' · abgelehnt (status != ok): ' + sum.insgesamt.abgelehnt + ' · Fehler: ' + sum.fehler.length);
  console.log('Ausgabe: ' + jsonl + ' (+ -zusammenfassung.json)');
}
main().then(() => { aufraeumen(); process.exit(0); }, (e) => { console.error(e); aufraeumen(); process.exit(1); });
