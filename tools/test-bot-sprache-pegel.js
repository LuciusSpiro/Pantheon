'use strict';
// BOT-04 D2: Stille-Schranke der Bot-Sprache (public/js/bot-sprache.js). Das Mikrofon liefert mit stop() den Pegel (Spitze 0..1);
// liegt er unter PEGEL_MIN, geht KEIN Audio an STT, es erscheint die Meldung TEXT.stille und es wird nichts gesendet.
//  a) reine Rechnung spitzeAusSamples (Stille, Sinus 0,02 / 0,05, Vorzeichen, kaputte Werte)
//  b) Schranke im Kern: Stille, Grenze exakt, knapp darunter, leises Sprechen, pegel null/fehlt, "…" endet
//  c) Messmodus: Eintrag traegt pegel, Stille ist ein eigener Eintrag (stille: true, richtig null) und zaehlt nicht als Messung
//  d) reine Abdeckungslogik pegelAbdeckungReicht (Spaetstart-Schutz, groesste Luecke zwischen zwei Lesungen)
//  e) pegelMesser im echten mikrofonBrowser gegen ein Fake-Fenster (AudioContext, AnalyserNode, MediaRecorder): Fail-open, Spaetstart, Blockade des Hauptthreads mitten in der Aufnahme, Ausnahmen, Aufraeumen, keine unbehandelten Ablehnungen
//   node tools/test-bot-sprache-pegel.js
const BS = require('../public/js/bot-sprache.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');
const tick = () => new Promise((r) => setImmediate(r));

function fake(pegelWert, o) {
  o = o || {};
  const L = { stt: 0, send: [], meldung: [], verarb: [], post: [] };
  const aufn = { blob: { size: 5000 }, mime: 'audio/webm', dauerMs: 800 };
  if (pegelWert !== 'fehlt') aufn.pegel = pegelWert;
  const env = {
    uhr: (() => { let z = 0; return () => (z += 10); })(),
    transport: { send: (m) => { L.send.push(m); return true; }, onMessage: () => () => {} },
    matcher: () => ({ match: (t) => (/schild/i.test(t) ? { an: 'technik', befehl: 'tech.schild', args: { sektor: 'stb' }, konfidenz: 0.97 } : null) }),
    stt: () => { L.stt++; return Promise.resolve('Schilde Steuerbord'); },
    mikrofon: { start: () => Promise.resolve({ stop: async () => aufn, abbruch() {} }) },
    audio: { spiele: () => Promise.resolve(null), stumm() {}, stopp() {} },
    anzeige: { aufnahme() {}, untertitel() {}, meldung: (t) => { L.meldung.push(t); }, verarbeitet: (b) => { L.verarb.push(b); } },
    postMessung: async (s, e) => { L.post.push(e); },
  };
  return { env, L };
}
const sprechen = async (k) => { k.tasteRunter(); await tick(); return k.tasteHoch(); };
const sinus = (a, nn) => Float32Array.from({ length: nn || 4800 }, (_, i) => a * Math.sin(2 * Math.PI * 440 * i / 48000));

(async () => {
  section('a) spitzeAusSamples');
  {
    const sp = BS.spitzeAusSamples;
    ok(sp(new Float32Array(0)) === 0 && sp(null) === 0 && sp(undefined) === 0, 'leer / null: 0');
    ok(sp(new Float32Array(2048)) === 0, 'Digital-Stille: 0');
    ok(sp([0.1, -0.4, 0.2]) === 0.4, 'groesster Betrag, auch negativ');
    ok(sp([NaN, Infinity, -Infinity, 0.3]) === 0.3, 'nicht endliche Werte zaehlen nicht');
    ok(Math.abs(sp(sinus(0.02)) - 0.02) < 1e-6 && Math.abs(sp(sinus(0.05)) - 0.05) < 1e-6, 'Sinus 0,02 und 0,05: Spitze = Amplitude');
    ok(Math.abs(sp(sinus(0.004)) - 0.004) < 1e-6, 'Sinus 0,004 (totes Rauschen): 0,004');
    console.log('  Messwerte: Stille ' + sp(new Float32Array(2048)) + ', Sinus 0,02 ' + sp(sinus(0.02)).toFixed(4) + ', Sinus 0,05 ' + sp(sinus(0.05)).toFixed(4) + ', PEGEL_MIN ' + BS.PEGEL_MIN);
    ok(BS.PEGEL_MIN > 0 && BS.PEGEL_MIN <= 0.01, 'Grenze ist niedrig (hoechstens 0,01): nur Stille, kein leises Sprechen');
    ok(sp(sinus(0.02)) > BS.PEGEL_MIN * 2 && sp(sinus(0.05)) > BS.PEGEL_MIN * 2, 'leises Sprechen (Spitze 0,02) liegt mindestens doppelt ueber der Grenze');
    ok(typeof BS.TEXT.stille === 'string' && /Ton/.test(BS.TEXT.stille), 'TEXT.stille vorhanden');
  }

  section('b) Schranke im Kern');
  {
    const { env, L } = fake(0);
    const k = BS.erzeuge(env); k.schalte(true);
    const r = await sprechen(k);
    ok(r === false, 'Stille: Rueckgabe false');
    ok(L.stt === 0, 'Stille: env.stt NICHT aufgerufen');
    ok(L.send.length === 0, 'Stille: kein bot.befehl');
    ok(L.meldung.includes(BS.TEXT.stille) && L.meldung.at(-1) === BS.TEXT.stille, 'Stille: Meldung "' + BS.TEXT.stille + '" steht');
    ok(L.verarb[0] === true && L.verarb.at(-1) === false, 'Stille: Zustand "…" beginnt und endet');
  }
  {
    const { env, L } = fake(BS.PEGEL_MIN);
    const k = BS.erzeuge(env); k.schalte(true);
    await sprechen(k);
    ok(L.stt === 1 && L.send.length === 1 && L.send[0].befehl === 'tech.schild', 'Pegel genau an der Grenze: STT und Befehl wie bisher');
    ok(!L.meldung.includes(BS.TEXT.stille), 'Pegel genau an der Grenze: keine Stille-Meldung');
  }
  {
    const { env, L } = fake(BS.PEGEL_MIN - 1e-9);
    const k = BS.erzeuge(env); k.schalte(true);
    await sprechen(k);
    ok(L.stt === 0 && L.send.length === 0 && L.meldung.includes(BS.TEXT.stille), 'Pegel knapp unter der Grenze: Stille');
  }
  for (const p of [0.02, 0.05, 0.5, 1]) {
    const { env, L } = fake(p);
    const k = BS.erzeuge(env); k.schalte(true);
    await sprechen(k);
    ok(L.stt === 1 && L.send.length === 1 && !L.meldung.includes(BS.TEXT.stille), 'Pegel ' + p + ': STT wie bisher, Befehl gesendet');
  }
  for (const p of [null, 'fehlt', NaN]) {
    const { env, L } = fake(p);
    const k = BS.erzeuge(env); k.schalte(true);
    await sprechen(k);
    ok(L.stt === 1 && L.send.length === 1 && !L.meldung.includes(BS.TEXT.stille), 'Pegel ' + (p === 'fehlt' ? 'fehlt' : String(p)) + ' (kein Web Audio): STT wie bisher');
  }

  section('c) Messmodus');
  {
    const { env, L } = fake(0.05);
    const k = BS.erzeuge(env); k.schalte(true);
    k.setzeMessmodus({ phrasen: [{ id: 'p1', text: 'Schilde Steuerbord', erwartet: { befehl: 'tech.schild', args: { sektor: 'stb' } } }], sitzung: 's1' });
    await sprechen(k);
    ok(L.post.length === 1 && L.post[0].pegel === 0.05 && L.post[0].richtig === true && !L.post[0].stille, 'Messeintrag traegt pegel (0,05), ist keine Stille');
    ok(L.send.length === 0, 'Messmodus sendet weiter KEIN bot.befehl');
  }
  {
    const { env, L } = fake('fehlt');
    const k = BS.erzeuge(env); k.schalte(true);
    k.setzeMessmodus({ phrasen: [{ id: 'p1', text: 'x', erwartet: { befehl: 'tech.schild' } }], sitzung: 's1' });
    await sprechen(k);
    ok(L.post.length === 1 && L.post[0].pegel === null, 'ohne Pegel: Feld pegel ist null');
  }
  {
    const { env, L } = fake(0);
    const k = BS.erzeuge(env); k.schalte(true);
    k.setzeMessmodus({ phrasen: [{ id: 'p1', text: 'Schilde Steuerbord', erwartet: { befehl: 'tech.schild', args: { sektor: 'stb' } } }], sitzung: 's1' });
    const r = await sprechen(k);
    ok(r === false && L.stt === 0 && L.send.length === 0, 'Stille im Messmodus: kein STT, nichts gesendet');
    const e = L.post[0];
    ok(L.post.length === 1 && e.stille === true && e.pegel === 0 && e.phraseId === 'p1', 'Stille im Messmodus: eigener Eintrag mit stille: true, pegel 0, Phrase p1');
    ok(e.richtig === null && e.ergebnis === null && e.rohtext === null, 'Stille-Eintrag: kein Ergebnis, richtig null (weder falscher Befehl noch gueltige Messung)');
    ok(L.meldung.at(-1) === BS.TEXT.stille, 'Stille im Messmodus: Meldung steht');
    ok(L.verarb.at(-1) === false, 'Stille im Messmodus: "…" endet');
  }
  section('d) pegelAbdeckungReicht (rein)');
  {
    const R = BS.pegelAbdeckungReicht, T = BS.PEGEL_TAKT_MS, S = BS.PEGEL_START_MAX_MS, A = BS.PEGEL_ABDECKUNG_MIN;
    console.log('  Konstanten: Takt ' + T + ' ms, Start hoechstens ' + S + ' ms, Abdeckung mindestens ' + A);
    ok(R(0, 27, 800) === true && R(30, 26, 800) === true, 'normaler Lauf (erstes Fenster nach 0 bis 30 ms, Fenster je Takt): reicht');
    ok(R(S, 100, 800) === true && R(S + 1, 100, 800) === false, 'erstes Fenster genau an der Grenze reicht, 1 ms spaeter nicht');
    ok(R(20, Math.ceil(800 * A / T), 800) === true && R(20, Math.ceil(800 * A / T) - 1, 800) === false, 'Abdeckung genau an der Grenze reicht, ein Fenster weniger nicht');
    ok(R(null, 5, 800) === false && R(undefined, 5, 800) === false && R(NaN, 5, 800) === false, 'nie ein Fenster gelesen (Verzug null/undefined/NaN): reicht nicht');
    ok(R(10, 0, 800) === false && R(10, NaN, 800) === false, 'Fensterzahl 0 oder kaputt: reicht nicht');
    ok(R(10, 1, 40) === true && R(10, 1, 400) === false, 'kurze Aufnahme: ein Fenster deckt genug, bei langer Aufnahme nicht');
    ok(R(800, 1, 820) === false, 'Spaetstart: erstes Fenster erst kurz vor dem Loslassen: reicht nicht');
    ok(R(10, 3, 60000) === false, 'gedrosselter Timer (3 Fenster in 60 s): reicht nicht');
    ok(R(10, 5, NaN) === false && R(10, 5, -1) === false, 'kaputte Dauer: reicht nicht');
    ok(R(10, 0, 0) === false && R(10, 0, 100) === false, 'keine Fenster gelesen (fenster 0) zaehlt nie als abgedeckt, auch nicht bei Dauer 0');
    ok(R(null, 30, 800) === false && R(undefined, 30, 800) === false && R(NaN, 30, 800) === false, 'kein Verzug (nie gelesen) reicht nicht, auch wenn die Fensterzahl rechnerisch genuegt');
    const L = BS.PEGEL_LUECKE_MAX_MS;
    console.log('  Lueckengrenze: ' + L + ' ms (Takt ' + T + ' ms)');
    ok(L >= 100 && L <= 300, 'Lueckengrenze liegt zwischen 100 und 300 ms (Timer-Jitter bis ca. 85 ms erlaubt, Blockade von 900 ms nicht)');
    ok(R(0, 27, 800, 0) === true && R(0, 27, 800, T) === true && R(30, 26, 800, 2 * T) === true, 'normaler Lauf mit Luecken bis 2 Takte: reicht');
    ok(R(0, 27, 800, L) === true && R(0, 27, 800, L + 1) === false, 'groesste Luecke genau an der Grenze reicht, 1 ms mehr nicht');
    ok(R(10, 30, 1800, 900) === false && R(10, 30, 1800) === true, 'Fehlerfall: 1,8 s Aufnahme, 900 ms am Stueck blockiert (30 Fenster = 900 ms Abdeckung): reicht nicht; ohne Lueckenangabe (alt) hiess es reicht');
    ok(R(10, 30, 800, null) === false && R(10, 30, 800, NaN) === false && R(10, 30, 800, -1) === false && R(10, 30, 800, '5') === false, 'kaputte Lueckenangabe (null, NaN, negativ, Text): reicht nicht');
    ok(R(0, 27, 800) === true && R(S, 100, 800) === true && R(20, Math.ceil(800 * A / T), 800) === true, 'ohne Lueckenangabe (drei Argumente) gelten die bisherigen Regeln unveraendert');
  }

  section('e) pegelMesser im Browser-Adapter (mikrofonBrowser mit Fake-Fenster)');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const aktiv = new Set(), siOrig = global.setInterval, ciOrig = global.clearInterval;   // zaehlt offene Intervalle: pegelMesser darf nach stop/abbruch keines hinterlassen
  global.setInterval = (...a) => { const id = siOrig(...a); aktiv.add(id); return id; };
  global.clearInterval = (id) => { aktiv.delete(id); return ciOrig(id); };
  let unbehandelt = 0; process.on('unhandledRejection', () => { unbehandelt++; });
  // o: { zustand: 'running'|'suspended', laufAbMs, signal, wirft: 'ctor'|'quelle'|'lesen'|undefined, resumeLehntAb, closeLehntAb, keinAC, lesenNachStop }
  function browser(o) {
    o = o || {};
    const S = { ctx: null, geschlossen: 0, resume: 0, lesen: 0, gestoppt: 0 };
    class AC {
      constructor() { if (o.wirft === 'ctor') throw new Error('ctor'); this.state = o.zustand || 'running'; S.ctx = this; }
      createMediaStreamSource() { if (o.wirft === 'quelle') throw new Error('quelle'); return { connect() {} }; }
      createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(b) { S.lesen++; if (o.wirft === 'lesen') throw new Error('lesen'); b.fill(0); if (o.signal) b[7] = o.signal; } }; }
      resume() { S.resume++; return o.resumeLehntAb ? Promise.reject(new Error('resume')) : Promise.resolve(); }
      close() { S.geschlossen++; this.state = 'closed'; return o.closeLehntAb ? Promise.reject(new Error('close')) : Promise.resolve(); }
    }
    class MR {
      constructor() { this.mimeType = 'audio/webm'; }
      static isTypeSupported() { return true; }
      start() {}
      stop() { setTimeout(() => { if (this.ondataavailable) this.ondataavailable({ data: { size: 1000 } }); if (this.onstop) this.onstop(); }, 5); }
    }
    const stream = { getTracks: () => [{ stop() { S.gestoppt++; } }] };
    const win = { MediaRecorder: MR, Blob: class { constructor() { this.size = 1000; } }, navigator: { mediaDevices: { getUserMedia: async () => stream } } };
    if (!o.keinAC) win.AudioContext = AC;
    return { win, S };
  }
  // Unter Last (parallele Testlaeufe) verzoegern sich Timer weit ueber den Takt; die Luecken-Pruefung macht dann aus einer Messung ein null (fail-open, gewollt). Tests, die eine MESSUNG erwarten,
  // versuchen es deshalb bis zu 4 mal (eine echte Regression liefert jedes Mal null und faellt trotzdem durch); die Tests auf null brauchen das nicht.
  const stabil = async (f) => { let r; for (let i = 0; i < 4; i++) { r = await f(); if (r.a.pegel !== null) break; } return r; };
  const aufnehmen = async (o, ms, vorStop) => {
    const { win, S } = browser(o);
    const h = await BS.mikrofonBrowser(win).start();
    if (o && o.laufAbMs !== undefined && S.ctx) setTimeout(() => { if (S.ctx.state !== 'closed') S.ctx.state = 'running'; }, o.laufAbMs);
    await sleep(ms);
    if (vorStop) vorStop(S);
    const a = await h.stop();
    return { a, S, h };
  };
  {
    const { a, S } = await stabil(() => aufnehmen({ signal: 0.05 }, 400));
    ok(typeof a.pegel === 'number' && Math.abs(a.pegel - 0.05) < 1e-6 && a.pegel > BS.PEGEL_MIN, 'normaler Lauf mit Signal: Spitze 0,05');
    ok(S.geschlossen === 1 && S.gestoppt === 1, 'normaler Lauf: AudioContext einmal geschlossen, Mikrofonspur gestoppt');
    const n0 = S.lesen; await sleep(120);
    ok(S.lesen === n0 && aktiv.size === 0, 'nach stop() ist das Intervall gestoppt (kein offenes Intervall, kein Lesen mehr)');
  }
  {
    const { a } = await stabil(() => aufnehmen({}, 400));
    ok(a.pegel === 0, 'Stille ueber die ganze Dauer bei laufendem Kontext: Spitze 0 (Schranke greift)');
  }
  {
    const { a, S } = await aufnehmen({ zustand: 'suspended' }, 300);
    ok(a.pegel === null && S.resume === 1 && S.lesen === 0, 'suspendierter, nie laufender Kontext: pegel null, resume versucht, nie gelesen');
    ok(S.geschlossen === 1, 'suspendiert: Kontext trotzdem geschlossen');
  }
  {
    const { a } = await aufnehmen({ zustand: 'suspended', resumeLehntAb: true }, 200);
    await sleep(30);
    ok(a.pegel === null && unbehandelt === 0, 'resume() abgelehnt: pegel null, keine unbehandelte Ablehnung');
  }
  {
    const { a, S } = await stabil(() => aufnehmen({ signal: 0.05, closeLehntAb: true }, 200));
    await sleep(30);
    ok(typeof a.pegel === 'number' && S.geschlossen === 1 && unbehandelt === 0, 'close() abgelehnt: Pegel kommt trotzdem, keine unbehandelte Ablehnung');
  }
  {
    // Spaetstart (Befund 1): Kontext laeuft erst kurz vor dem Loslassen, davor wurde gesprochen (hier nicht mehr hoerbar: Raumrauschen 0,002)
    const { a } = await aufnehmen({ zustand: 'suspended', signal: 0.002, laufAbMs: 380 }, 400);
    ok(a.pegel === null, 'Spaetstart (Kontext laeuft erst kurz vor dem Loslassen, nur Raumrauschen gelesen): pegel null, Befehl wird NICHT verworfen (' + a.pegel + ')');
  }
  {
    // lange Aufnahme, Kontext laeuft erst nach 250 ms: die Fenster danach decken genug, aber der Anfang des Befehls fehlt (erstes Fenster nach mehr als PEGEL_START_MAX_MS)
    const { a } = await aufnehmen({ zustand: 'suspended', signal: 0.002, laufAbMs: 250 }, 600);
    ok(a.pegel === null, 'Spaetstart nach 250 ms bei 600 ms Aufnahme (Abdeckung allein genuegt, Anfang fehlt): pegel null (' + a.pegel + ')');
  }
  {
    const { a } = await aufnehmen({ zustand: 'suspended', signal: 0, laufAbMs: 380 }, 400);
    ok(a.pegel === null, 'Spaetstart mit Digital-Stille: ebenfalls null (Messung deckt die Aufnahme nicht ab)');
  }
  {
    const { a } = await stabil(() => aufnehmen({ zustand: 'suspended', signal: 0.002, laufAbMs: 60 }, 400));
    ok(typeof a.pegel === 'number' && a.pegel > 0, 'kurzer Start (Kontext laeuft nach 60 ms): Messung zaehlt (' + a.pegel + ')');
  }
  {
    const { a } = await aufnehmen({ signal: 0.05 }, 300, (S) => { S.ctx.state = 'suspended'; });
    ok(a.pegel === null, 'Kontext laeuft beim Loslassen nicht mehr (Unterbrechung): pegel null trotz gelesener Fenster');
  }
  for (const w of ['ctor', 'quelle', 'lesen']) {
    const { a, S } = await aufnehmen({ wirft: w }, 200);
    await sleep(30);
    ok(a.pegel === null && unbehandelt === 0, 'Ausnahme in ' + ({ ctor: 'Konstruktor', quelle: 'createMediaStreamSource', lesen: 'getFloatTimeDomainData' }[w]) + ': pegel null, Aufnahme laeuft weiter (Blob ' + (a.blob ? 'da' : 'fehlt') + ')');
    if (w === 'quelle') ok(S.geschlossen === 1, 'Ausnahme in createMediaStreamSource: Kontext wird geschlossen');
  }
  {
    const { a } = await aufnehmen({ keinAC: true }, 100);
    ok(a.pegel === null, 'kein AudioContext im Browser: pegel null');
  }
  const dnOrig = Date.now; let versatz = 0; Date.now = () => dnOrig() + versatz;   // Uhr mit Versatz: eine Blockade des Hauptthreads (Szenenwechsel, GC; kein Timer laeuft) ist ein Sprung der Uhr, ohne dass der Test wartet
  const blockiere = (ms) => { versatz += ms; };
  const mitLuecke = async (o, vorMs, blockMs, nachMs) => {   // vorMs aufnehmen, blockMs blockiert, nachMs aufnehmen
    const { win, S } = browser(o);
    const h = await BS.mikrofonBrowser(win).start();
    await sleep(vorMs); blockiere(blockMs); await sleep(nachMs);
    return { a: await h.stop(), S };
  };
  {
    // Befund 3: 2,1 s Aufnahme, 900 ms am Stueck blockiert, der Befehl wurde in der Luecke gesprochen; davor/danach nur Raumrauschen (0,002). Fenster davor/danach decken ihre Haelfte der Dauer ab.
    const { a } = await mitLuecke({ signal: 0.002 }, 600, 900, 600);
    ok(a.pegel === null, 'Blockade von 900 ms mitten in der Aufnahme: pegel null (Befehl wird NICHT verworfen), obwohl die Fenster rechnerisch genug decken (' + a.pegel + ')');
  }
  {
    const { a } = await mitLuecke({ signal: 0 }, 600, 900, 600);
    ok(a.pegel === null, 'Blockade mitten in der Aufnahme mit Digital-Stille davor/danach: ebenfalls null (' + a.pegel + ')');
  }
  {
    const { a } = await mitLuecke({ signal: 0.002 }, 800, 500, 0);
    ok(a.pegel === null, 'Blockade unmittelbar vor dem Loslassen (letzte Lesung bis Loslassen 500 ms): pegel null (' + a.pegel + ')');
  }
  {
    const { a } = await stabil(() => mitLuecke({ signal: 0.002 }, 400, 40, 400));
    ok(typeof a.pegel === 'number' && a.pegel > 0, 'kleine Luecke (40 ms Blockade) zaehlt weiter als Messung (' + a.pegel + ')');
  }
  {
    const { a } = await stabil(() => mitLuecke({ signal: 0 }, 400, 40, 400));
    ok(a.pegel === 0, 'kleine Luecke bei echter Stille: Spitze 0, die Schranke greift weiter (' + a.pegel + ')');
  }
  {
    // stop und abbruch: Kontext nur einmal geschlossen, Spur frei
    const { win, S } = browser({ signal: 0.05 });
    const h = await BS.mikrofonBrowser(win).start();
    await sleep(100);
    h.abbruch();
    ok(S.geschlossen === 1 && S.gestoppt === 1, 'abbruch(): Kontext geschlossen, Spur gestoppt');
    const n0 = S.lesen; await sleep(100);
    ok(S.lesen === n0 && aktiv.size === 0, 'abbruch(): Intervall gestoppt (kein offenes Intervall)');
    h.abbruch();
    ok(S.geschlossen === 1, 'zweites abbruch(): Kontext nicht noch einmal geschlossen');
  }
  {
    const { a, S, h } = await stabil(() => aufnehmen({ signal: 0.05 }, 200));
    h.abbruch();
    ok(typeof a.pegel === 'number' && S.geschlossen === 1, 'stop() und danach abbruch(): Kontext nur einmal geschlossen');
  }
  global.setInterval = siOrig; global.clearInterval = ciOrig; Date.now = dnOrig;
  ok(unbehandelt === 0, 'insgesamt keine unbehandelte Promise-Ablehnung (' + unbehandelt + ')');

  console.log('\n' + (fails ? fails + ' FEHLER von ' + n : n + '/' + n + ' ok'));
  process.exit(fails ? 1 : 0);
})();
