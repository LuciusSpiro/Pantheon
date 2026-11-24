'use strict';
// BOT-04 D2: Stille-Schranke der Bot-Sprache (public/js/bot-sprache.js). Das Mikrofon liefert mit stop() den Pegel (Spitze 0..1);
// liegt er unter PEGEL_MIN, geht KEIN Audio an STT, es erscheint die Meldung TEXT.stille und es wird nichts gesendet.
//  a) reine Rechnung spitzeAusSamples (Stille, Sinus 0,02 / 0,05, Vorzeichen, kaputte Werte)
//  b) Schranke im Kern: Stille, Grenze exakt, knapp darunter, leises Sprechen, pegel null/fehlt, "…" endet
//  c) Messmodus: Eintrag traegt pegel, Stille ist ein eigener Eintrag (stille: true, richtig null) und zaehlt nicht als Messung
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
  console.log('\n' + (fails ? fails + ' FEHLER von ' + n : n + '/' + n + ' ok'));
  process.exit(fails ? 1 : 0);
})();
