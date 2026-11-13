'use strict';
// PAR-01 B: Treiber der Probe-Beat-Methode. Faehrt die Testkette (Tests, die Katalog, Mock, Faden, Brett oder Abenteuer beruehren) ohne
// Probe-Beat (Referenz), mit PROBE_BEATS=1 und mit PROBE_BEATS=2 (Preload tools/probe-beat.js ueber NODE_OPTIONS, wirkt auch in Kindprozessen)
// und meldet je Test Exit-Code und rote Stelle. Rote Tests werden einzeln (seriell) wiederholt, bevor sie als "kippt durch Probe-Beat" gelten.
// Aufruf: node tools/probe-kette.js [--stufen 0,1,2] [--worker 4] [--max-budget 100] [--alle] [--nur id,id] [--ausgabe datei.json]
//   Auswahl (ohne --alle): Schritte der Kette test aus tools/testliste.json, Stufe nicht slow, budget_s <= --max-budget (Standard 100), deren Datei
//   Katalog/Mock/Faden/Brett/Abenteuer/Inszenierer beruehrt (Muster unten) oder deren Id danach heisst. Ausgelassene Schritte stehen in der Ausgabe.
//   --alle: alle Schritte der Kette test (ausser slow und zu schwer). --nur: genau diese Ids (Dateinamen ohne Argumente).
// Exit 0: keine Probe-Stufe hat einen Test, der in der Referenz gruen ist und mit Probe-Beat rot bleibt (auch nach der Wiederholung); sonst 1.
// Hoechstens 4 Worker (der Rechner ist mit anderen Sessions geteilt). Aendert keine Datei (Ergebnis-JSON nur ueber --ausgabe).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WURZEL = path.join(__dirname, '..');
const PRELOAD = path.join(__dirname, 'probe-beat.js');
const MUSTER = /abenteuer-mock|gueltigerPlan|faden-daten|abenteuer-prompt|abenteuer-absicht|abenteuer-daten|faden-bauplan|faden-brett|abenteuer-brett|katalogText|\.BEATS\b|planbar|inszenierer|abenteuer|Faden\./i;
const ID_MUSTER = /abenteuer|faden|forderung|reise|brett|inszenierer|absicht|katalog|spielleiter|regie|vorrat|lage/i;

function argumente(argv) {
  const o = { stufen: [0, 1, 2], worker: 4, maxBudget: 100, alle: false, nur: null, ausgabe: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stufen') o.stufen = argv[++i].split(',').map(Number);
    else if (a === '--worker') o.worker = Math.min(4, Math.max(1, parseInt(argv[++i], 10)));
    else if (a === '--max-budget') o.maxBudget = parseFloat(argv[++i]);
    else if (a === '--alle') o.alle = true;
    else if (a === '--nur') o.nur = argv[++i].split(',');
    else if (a === '--ausgabe') o.ausgabe = argv[++i];
    else { console.error('Unbekannte Option ' + a); process.exit(2); }
  }
  return o;
}

function waehle(o) {
  const liste = JSON.parse(fs.readFileSync(path.join(__dirname, 'testliste.json'), 'utf8')).schritte;
  const dateiname = (s) => path.basename(s.cmd[0]).replace(/\.js$/, '');
  const gewaehlt = [], ausgelassen = [];
  for (const s of liste) {
    if (o.nur) { if (o.nur.includes(s.id) || o.nur.includes(dateiname(s))) gewaehlt.push(s); continue; }
    if (s.kette !== 'test') continue;
    if (/probe-beats/.test(s.id)) { ausgelassen.push([s.id, 'ruft diesen Treiber selbst']); continue; }   // sonst rekursiv
    if (s.stufe === 'slow') { ausgelassen.push([s.id, 'Stufe slow']); continue; }
    if (s.budget_s > o.maxBudget) { ausgelassen.push([s.id, 'zu schwer (budget_s ' + s.budget_s + ')']); continue; }
    let text = '';
    try { text = fs.readFileSync(path.join(WURZEL, s.cmd[0]), 'utf8'); } catch (e) { /* kein Skript */ }
    if (o.alle || MUSTER.test(text) || ID_MUSTER.test(s.id)) gewaehlt.push(s); else ausgelassen.push([s.id, 'beruehrt Katalog/Mock/Faden nicht']);
  }
  return { gewaehlt, ausgelassen };
}

function fahre(ids, probe, worker, timeoutS) {
  const tmp = path.join(os.tmpdir(), 'probe-kette-' + process.pid + '-' + probe + '-' + Date.now() + '.json');
  const env = Object.assign({}, process.env, { PROBE_BEATS: String(probe) });
  if (probe > 0) env.NODE_OPTIONS = ((process.env.NODE_OPTIONS || '') + ' --require "' + PRELOAD.replace(/\\/g, '/') + '"').trim();
  const args = ['tools/run-tests.js', worker > 1 ? '--parallel' : '--seriell', ...(worker > 1 ? ['--worker', String(worker)] : []), '--nur', ids.join(','), '--stufe', 'alles', '--grenze-aus', '--ausgabe', tmp];
  const r = spawnSync(process.execPath, args, { cwd: WURZEL, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: timeoutS * 1000 });
  let j = null;
  try { j = JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.unlinkSync(tmp); } catch (e) { /* unten gemeldet */ }
  if (!j) throw new Error('Runner ohne Ergebnis (Exit ' + r.status + '): ' + String(r.stderr || r.stdout).slice(-400));
  const m = new Map();
  for (const s of j.schritte) m.set(s.id, s);
  return m;
}

const rote = (s) => s.exit !== 0 || s.timeout;
const stelle = (s) => {
  const z = (s.fehlerzeilen && s.fehlerzeilen.length ? s.fehlerzeilen : String(s.ausgabe_ende || '').split('\n').filter(Boolean).slice(-3)).slice(0, 3).map((x) => String(x).trim().slice(0, 200));
  return z.join(' | ') + (s.timeout ? ' [TIMEOUT]' : '');
};

function main() {
  const o = argumente(process.argv.slice(2));
  const { gewaehlt, ausgelassen } = waehle(o);
  const ids = gewaehlt.map((s) => s.id);
  console.log('Probe-Kette: ' + ids.length + ' Schritte gewaehlt, ' + ausgelassen.length + ' ausgelassen, Stufen PROBE_BEATS=' + o.stufen.join(','));
  const nach = {};
  for (const [id, grund] of ausgelassen) (nach[grund.replace(/ \(.*/, '')] = nach[grund.replace(/ \(.*/, '')] || []).push(id);
  for (const [g, l] of Object.entries(nach)) console.log('  ausgelassen (' + g + '): ' + l.length + (g.startsWith('zu schwer') || g.startsWith('Stufe') || g.startsWith('ruft') ? ' = ' + l.join(', ') : ''));
  if (!ids.length) { console.error('Leere Auswahl'); process.exit(2); }
  const ergebnis = {};
  for (const probe of o.stufen) {
    const t0 = Date.now();
    ergebnis[probe] = fahre(ids, probe, o.worker, 3000);
    const rot = ids.filter((id) => ergebnis[probe].get(id) && rote(ergebnis[probe].get(id)));
    // rote einzeln wiederholen (Last-Flakes ausschliessen)
    const wiederholt = [], stabil = [];
    for (const id of rot) {
      const w = fahre([id], probe, 1, 900).get(id);
      if (w && !rote(w)) wiederholt.push(id); else { stabil.push(id); ergebnis[probe].set(id, w || ergebnis[probe].get(id)); }
    }
    for (const id of wiederholt) ergebnis[probe].set(id, Object.assign({}, ergebnis[probe].get(id), { exit: 0, timeout: false, flake: true }));
    console.log('PROBE_BEATS=' + probe + ': ' + ids.length + ' Tests, rot nach Wiederholung ' + stabil.length + (wiederholt.length ? ', Flakes (beim Einzellauf gruen): ' + wiederholt.join(', ') : '') + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
    ergebnis[probe].stabilRot = stabil;
  }
  const ref = ergebnis[0] || null;
  let kippt = 0;
  const bericht = { auswahl: ids, ausgelassen, stufen: {} };
  for (const probe of o.stufen) {
    const e = ergebnis[probe];
    const liste = e.stabilRot.map((id) => ({ id, exit: e.get(id).exit, referenz_gruen: ref ? !rote(ref.get(id) || { exit: 1 }) : null, stelle: stelle(e.get(id)) }));
    bericht.stufen[probe] = liste;
    if (probe === 0) { if (liste.length) console.log('Referenz rot (ohne Probe-Beat, nicht durch den Probe-Beat verursacht): ' + liste.map((x) => x.id).join(', ')); continue; }
    for (const x of liste) {
      if (x.referenz_gruen === false) { console.log('  PROBE_BEATS=' + probe + ' ' + x.id + ': schon in der Referenz rot'); continue; }
      kippt++;
      console.log('  KIPPT PROBE_BEATS=' + probe + ' ' + x.id + ' (Exit ' + x.exit + '): ' + x.stelle);
    }
  }
  if (o.ausgabe) fs.writeFileSync(o.ausgabe, JSON.stringify(bericht, null, 1));
  console.log(kippt ? kippt + ' Test(s) kippen durch den Probe-Beat.' : 'Kein Test kippt durch den Probe-Beat.');
  process.exit(kippt ? 1 : 0);
}

if (require.main === module) main();
module.exports = { waehle };
