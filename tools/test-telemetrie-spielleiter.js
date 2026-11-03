'use strict';
// TEL-01 B2 Nacharbeit (K4): die Spielleiter-Haken (Wartezeit auf den Spielleiter, Ereignis spielleiter_warten) an ihren ECHTEN Stellen ausloesen, nicht nur Haken.spielleiterWarten direkt:
//   Lage-Spielleiter (server/sim/lage-spielleiter.js: abholen -> ok | fehler | timeout, fristPruefen -> timeout),
//   Abenteuer-Spielleiter (server/sim/abenteuer-spielleiter.js), Kampagnen-Spielleiter (server/mission/spielleiter.js: resolveWait 'anflug', finishJob).
// Ein Transportfehler mit Code ETIMEDOUT (Script `error: 'timeout'`) ist ausgang timeout, jeder andere Fehler fehler.
//   node tools/test-telemetrie-spielleiter.js   (npm run test:telemetrie-spielleiter)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');
const KS = require('../server/mission/spielleiter.js');
const F = require('./regie-fixture.js');
const Haken = require('../server/telemetrie/haken.js');

let fails = 0;
const ok = (c, t) => { console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const frei = () => new Promise((r) => setImmediate(r));
async function pumpen(g, k) { for (let i = 0; i < k; i++) { g.step(); await frei(); } }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-sl-'));
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* egal */ } });
let nr = 0;
function spiel() {
  const dir = path.join(root, 'p' + (++nr));
  const t = F.neuesSpiel({ crew: 1, names: ['Zebrakai'], env: { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0', FAEDEN: '1', TELEMETRIE: 'an', TELEMETRIE_DIR: dir, TELEMETRIE_QUELLE: 'bot' } });
  t.dir = dir;
  t.zeilen = () => {
    t.g.telemetrie.schreibeJetzt();
    const f = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')) : [];
    return f.length ? fs.readFileSync(path.join(dir, f[0]), 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((x) => x.typ === 'spielleiter_warten') : [];
  };
  return t;
}
function mitLage(t, llmOpts, werte, abWerte) {
  const llm = LLM.create(Object.assign({ mode: 'mock' }, llmOpts || {}));
  const sl = LS.create(t.g, { llm, werte: Object.assign({ deckel_je_sitzung: 0 }, werte || {}), abenteuerWerte: abWerte || {} });
  t.g.lageSpielleiter = sl; t.g.lageSchalter = true;
  return { sl, llm };
}

(async () => {
  console.log('Lage-Spielleiter (abholen, fristPruefen)');
  for (const [name, llmOpts, werte, erwartet] of [
    ['Antwort (ok)', { mode: 'script', script: { lage: [{ json: { befehle: [], begruendung: 'x' } }] } }, { deckel_je_sitzung: 5 }, 'ok'],
    ['Transport-Timeout (ETIMEDOUT)', { mode: 'script', script: { lage: [{ error: 'timeout' }] } }, { deckel_je_sitzung: 5 }, 'timeout'],
    ['Exit 1', { mode: 'script', script: { lage: [{ error: 'exit' }] } }, { deckel_je_sitzung: 5 }, 'fehler'],
    ['Frist in Spielzeit (Antwort bleibt aus)', { mode: 'script', script: { lage: [{ hold: true }] } }, { deckel_je_sitzung: 5, timeout_s: 1 }, 'timeout'],
  ]) {
    LLM.resetBudget();
    const haelt = !!llmOpts.script.lage[0].hold;   // vorher merken: der Script-Transport verbraucht die Eintraege
    const t = spiel(); const { sl, llm } = mitLage(t, llmOpts, werte);
    sl.beiGrenze('andocken'); await pumpen(t.g, 3);
    if (haelt) await pumpen(t.g, 80);
    const z = t.zeilen().filter((x) => x.art === 'lage');
    ok(z.length === 1 && z[0].ausgang === erwartet && z[0].dauer >= 0, `${name}: spielleiter_warten art lage, ausgang ${erwartet} (${z.map((x) => x.ausgang).join(',') || 'keine Zeile'})`);
    if (llm.pending()) llm.release();
    t.g.telemetrie.sessionBeenden('test');
  }

  console.log('Abenteuer-Spielleiter (Antwort abholen, Zeitlimit)');
  for (const [name, llmOpts, abWerte, erwartet] of [
    ['Antwort (ok)', { mode: 'mock' }, {}, 'ok'],
    ['Transport-Timeout (ETIMEDOUT)', { mode: 'script', script: { abenteuer: [{ error: 'timeout' }] } }, {}, 'timeout'],
    ['Exit 1', { mode: 'script', script: { abenteuer: [{ error: 'exit' }] } }, {}, 'fehler'],
    ['Frist in Spielzeit (Antwort bleibt aus)', { mode: 'script', script: { abenteuer: [{ hold: true }] } }, { timeout_s: 1 }, 'timeout'],
  ]) {
    LLM.resetBudget();
    const haelt = !!(llmOpts.script && llmOpts.script.abenteuer[0].hold);
    const t = spiel(); const { sl, llm } = mitLage(t, llmOpts, {}, abWerte);
    t.g.lageGrenze('andocken'); await pumpen(t.g, 3);
    if (haelt) await pumpen(t.g, 80);
    const z = t.zeilen().filter((x) => x.art === 'abenteuer');
    ok(z.length === 1 && z[0].ausgang === erwartet, `${name}: spielleiter_warten art abenteuer, ausgang ${erwartet} (${z.map((x) => x.ausgang).join(',') || 'keine Zeile'})`);
    if (llm.pending()) llm.release();
    t.g.telemetrie.sessionBeenden('test');
  }

  console.log('Kampagnen-Spielleiter (resolveWait, finishJob)');
  {
    const t = spiel(); const g = t.g;
    const sl = KS.create(g, { mode: 'off', regieDir: path.join(root, 'regie') });
    g.time += 3.4;
    sl.waits['m1:s2'] = { t0: g.time - 3.4, sent: false };
    sl.resolveWait({ id: 'm1' }, 's2', 'ready');
    sl.waits['m1:s3'] = { t0: g.time - 1, sent: false };
    sl.resolveWait({ id: 'm1' }, 's3', 'failed');
    const z = t.zeilen().filter((x) => x.art === 'anflug');
    ok(z.length === 2 && z[0].ausgang === 'ready' && z[0].dauer === 3.4 && z[1].ausgang === 'failed' && z[1].dauer === 1, 'resolveWait: anflug ready 3.4 s, anflug failed 1 s (' + z.map((x) => x.ausgang + ' ' + x.dauer).join(', ') + ')');
    let n = 0;
    for (const [e, erwartet] of [[null, 'ok'], [LLM.llmError('ETIMEDOUT', 'x'), 'timeout'], [LLM.llmError('EXIT', 'y'), 'fehler']]) {
      const job = { type: 'szene', sid: 's9', startedAt: g.time - 2, plan: { id: 'm1', key: 'm1', tokens: 0, szenen: {} } };
      try { sl.finishJob(job, e ? null : { tokens: 0 }, e); } catch (err) { /* der Rest von finishJob braucht ein echtes Buch: der Haken steht davor */ }
      n++;
    }
    const w = t.zeilen().filter((x) => x.art === 'szene');
    ok(w.length === 3 && w.map((x) => x.ausgang).join() === 'ok,timeout,fehler', 'finishJob: szene ok, timeout (ETIMEDOUT), fehler (' + w.map((x) => x.ausgang).join(',') + ')');
    ok(Haken.warteAusgang(null) === 'ok' && Haken.warteAusgang({ code: 'ETIMEDOUT' }) === 'timeout' && Haken.warteAusgang({ code: 'EXIT' }) === 'fehler' && Haken.warteAusgang(new Error('Geheim')) === 'fehler', 'warteAusgang: ok | timeout | fehler, nie die Meldung');
    ok(!JSON.stringify(t.zeilen()).includes('Geheim') && !JSON.stringify(t.zeilen()).includes('Zebrakai'), 'keine Fehlermeldung, kein Name im Protokoll');
    t.g.telemetrie.sessionBeenden('test');
  }
  console.log(fails ? `\n${fails} FEHLER` : '\nTELEMETRIE SPIELLEITER OK');
  process.exit(fails ? 1 : 0);
})();
