'use strict';
// MIT-01 C: Test der Laeufer-Hilfe tools/lib/mitschnitt-lauf.js – schnell, offline, ohne LLM.
//   node tools/test-mitschnitt-lauf.js
// Prueft: Flag-Parsing und Umgebung (rein), Umgebung gesetzt/nicht gesetzt, ohne Flag Nulleffekt (kein Recorder: keine Ausgabe, keine Datei), lauf()-Daten und kuenstlich() kommen im Verlauf an
// (In-Process-Spiel ueber die Fixture) und der Ausgabeordner wird genannt (einmal); dazu ein echter kurzer Lauf `sim-headless labor evakuieren/quartiere` mit und ohne --mitschnitt.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const MitLauf = require('./lib/mitschnitt-lauf.js');
const F = require('./regie-fixture.js');

let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-mitlauf-'));
const repo = path.join(__dirname, '..');
const alleDateien = (d, out) => { out = out || []; if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) alleDateien(f, out); else out.push(f); } return out; };

// 1. Flag-Parsing (rein)
console.log('Flag-Parsing');
{
  const a = MitLauf.lesen(['kette', '--mitschnitt'], {});
  ok(a.an === true && a.dir === null, 'nur --mitschnitt: an, Standardordner');
  const b = MitLauf.lesen(['--mitschnitt', '--mitschnitt-dir', 'rel/ordner'], {});
  ok(b.an && b.dir === path.resolve('rel/ordner'), '--mitschnitt-dir wird gegen das aktuelle Verzeichnis aufgeloest');
  const c = MitLauf.lesen([], { MITSCHNITT: '1', MITSCHNITT_DIR: path.join(root, 'x') });
  ok(c.an && c.dir === path.join(root, 'x'), 'MITSCHNITT=1 und MITSCHNITT_DIR aus der Umgebung ohne Flag');
  ok(['an', 'on', 'true', 'TRUE'].every((v) => MitLauf.lesen([], { MITSCHNITT: v }).an), 'MITSCHNITT=an|on|true gilt wie 1 (Muster des Recorders)');
  ok(!MitLauf.lesen([], {}).an && !MitLauf.lesen(['labor', 'x'], { MITSCHNITT: '0' }).an && !MitLauf.lesen([], { MITSCHNITT: '' }).an, 'ohne Flag und ohne Umgebung: aus (auch MITSCHNITT=0 und leer)');
  ok(MitLauf.lesen(['--mitschnitt', '--mitschnitt-dir'], {}).dir === null && MitLauf.lesen(['--mitschnitt', '--mitschnitt-dir', '--verbose'], {}).dir === null, '--mitschnitt-dir ohne Wert (oder gefolgt von einem Flag): kein Ordner');
}

// 2. Umgebung gesetzt / nicht gesetzt
console.log('Umgebung');
{
  const e = {};
  const r = MitLauf.einschalten(['--mitschnitt', '--mitschnitt-dir', path.join(root, 'u')], e);
  ok(e.MITSCHNITT === '1' && e.MITSCHNITT_DIR === path.join(root, 'u') && r.an, 'mit Flag: MITSCHNITT=1 und MITSCHNITT_DIR gesetzt');
  const aus = {};
  const r2 = MitLauf.einschalten(['kette', '--crew', '1', '--mitschnitt-dir', path.join(root, 'u')], aus);
  ok(!r2.an && Object.keys(aus).length === 0, 'ohne --mitschnitt: Umgebung bleibt unberuehrt (auch ein einsames --mitschnitt-dir schaltet nicht ein)');
  const nur = {};
  MitLauf.einschalten(['--mitschnitt'], nur);
  ok(nur.MITSCHNITT === '1' && !('MITSCHNITT_DIR' in nur), '--mitschnitt ohne Ordner: kein MITSCHNITT_DIR gesetzt');
}

// 3. Ohne Recorder: Nulleffekt
console.log('Ohne Schalter: Nulleffekt');
{
  const ausg = [];
  const t = F.neuesSpiel({ crew: 1, seed: 3, names: ['Ada'], env: { MITSCHNITT: '0', MITSCHNITT_DIR: path.join(root, 'aus-dir') } });
  ok(!t.g.mitschnitt, 'ohne MITSCHNITT=1 hat das Spiel keinen Recorder');
  let wirft = false;
  try { MitLauf.anmelden(t.g, { werkzeug: 'x' }); MitLauf.kuenstlich(t.g, 'skip'); } catch (e) { wirft = true; }
  const r = (() => { try { return MitLauf.beenden(t.g, (s) => ausg.push(s)); } catch (e) { wirft = true; return 'wirft'; } })();
  ok(!wirft && r === null && ausg.length === 0, 'anmelden/kuenstlich/beenden ohne Recorder: kein Wurf, Rueckgabe null, keine Ausgabe');
  ok(alleDateien(path.join(root, 'aus-dir')).length === 0 && !fs.existsSync(path.join(root, 'aus-dir')), 'ohne Recorder: kein Ordner, keine Datei');
  let nullSpiel = true; try { MitLauf.anmelden(null, {}); MitLauf.kuenstlich(undefined, 'x'); nullSpiel = MitLauf.beenden(null) === null; } catch (e) { nullSpiel = false; }
  ok(nullSpiel, 'auch ohne Spiel (null) kein Wurf');
}

// 4. In-Process: lauf()-Daten kommen im Verlauf an, Ordner wird genannt
console.log('Lauf-Daten im Verlauf');
{
  const dir = path.join(root, 'mit');
  const t = F.neuesSpiel({ crew: 1, seed: 5, names: ['Ada'], env: { MITSCHNITT: '1', MITSCHNITT_DIR: dir } });
  const g = t.g;
  ok(!!g.mitschnitt, 'mit MITSCHNITT=1 hat das Spiel einen Recorder');
  MitLauf.anmelden(g, { werkzeug: 'test-lauf', regel: 'Wahl: erste Option', seed: 5, crew: 1, modus: 'probe', kuenstlich: ['teleport'] });
  MitLauf.kuenstlich(g, 'testhelfer-kill', 'teleport');
  g.emit('radio', { from: 'Hafenfunk', text: 'Probe im Lauf.' });
  const ausg = [];
  const o = MitLauf.beenden(g, (s) => ausg.push(s));
  const v = g.mitschnitt.verlauf();
  ok(v.lauf.werkzeug === 'test-lauf' && v.lauf.regel === 'Wahl: erste Option' && v.lauf.seed === 5 && v.lauf.crew === 1 && v.lauf.modus === 'probe', 'werkzeug, regel, seed, crew, modus stehen im Kopf des Verlaufs');
  ok(JSON.stringify(v.lauf.kuenstlich) === JSON.stringify(['teleport', 'testhelfer-kill']), 'kuenstlich: Liste aus lauf() plus kuenstlich(), ohne Doppelte');
  ok(typeof o === 'string' && o.startsWith(dir) && fs.existsSync(path.join(o, 'index.md')) && fs.existsSync(path.join(o, 'verlauf.json')), 'beenden schreibt den Lauf-Ordner mit index.md und verlauf.json unter MITSCHNITT_DIR');
  ok(path.basename(o).endsWith('_test-lauf-s5-c1-probe'), 'Ordnername <Datum>_<werkzeug>-s<seed>-c<crew>-<modus>: ' + path.basename(o));
  ok(ausg.length === 1 && ausg[0] === 'Mitschnitt: ' + o, 'der Ausgabeordner wird genannt: "Mitschnitt: <ordner>"');
  const nochmal = [];
  ok(MitLauf.beenden(g, (s) => nochmal.push(s)) === o && nochmal.length === 0, 'ein zweiter Aufruf liefert denselben Ordner und nennt ihn nicht erneut');
}

// 5. Echter kurzer Lauf des Werkzeugs: mit und ohne --mitschnitt
console.log('sim-headless labor evakuieren/quartiere');
{
  const tel = path.join(root, 'tel'); const regie = path.join(root, 'regie'); const tmp = path.join(root, 'tmp'); fs.mkdirSync(tmp);
  const env = Object.assign({}, process.env, { TELEMETRIE_DIR: tel, REGIE_DIR: regie, TEMP: tmp, TMP: tmp });
  delete env.MITSCHNITT; delete env.MITSCHNITT_DIR;
  const lauf = (extra) => spawnSync(process.execPath, [path.join(__dirname, 'sim-headless.js'), 'labor', 'evakuieren/quartiere', '--seeds', '1', '--crew', '1', '--ohne-telemetrie'].concat(extra), { env, encoding: 'utf8', timeout: 120000, cwd: repo });
  const dataVorher = fs.existsSync(path.join(repo, 'data', 'mitschnitt'));
  const ohne = lauf([]);
  ok(ohne.status === 0 && !/Mitschnitt/.test(ohne.stdout), 'ohne --mitschnitt: Exit 0, die Konsole nennt keinen Mitschnitt');
  ok(fs.existsSync(path.join(repo, 'data', 'mitschnitt')) === dataVorher, 'ohne --mitschnitt: data/mitschnitt nicht angelegt');
  const mdir = path.join(root, 'echt');
  const mit = lauf(['--mitschnitt', '--mitschnitt-dir', mdir]);
  const zeile = (mit.stdout.match(/^Mitschnitt: (.+)$/m) || [])[1];
  ok(mit.status === 0 && !!zeile, 'mit --mitschnitt: Exit 0 und eine Zeile "Mitschnitt: <ordner>"');
  ok(!!zeile && path.dirname(zeile) === mdir && fs.existsSync(path.join(zeile, 'index.md')), 'der genannte Ordner liegt unter --mitschnitt-dir und hat index.md');
  let v = null; try { v = JSON.parse(fs.readFileSync(path.join(zeile, 'verlauf.json'), 'utf8')); } catch (e) { /* unten geprueft */ }
  ok(!!v && v.lauf.werkzeug === 'sim-headless' && v.lauf.seed === 1 && v.lauf.crew === 1 && v.lauf.modus === 'labor-evakuieren/quartiere' && /Entscheidungen/.test(v.lauf.regel), 'Kopf aus dem Werkzeug: werkzeug, seed, crew, modus, Wahlregel');
  const md = zeile ? alleDateien(zeile).filter((f) => /mission\.md$/.test(f)) : [];
  ok(md.length >= 1 && /bot_regel: ".*Entscheidungen/.test(fs.readFileSync(md[0], 'utf8')), 'mission.md traegt bot_regel');
  ok(fs.existsSync(path.join(repo, 'data', 'mitschnitt')) === dataVorher, 'nichts im Repo (data/mitschnitt unveraendert)');
  const ke = ohne.stdout.split('\n').filter((l) => !/Mitschnitt/.test(l)).join('\n').replace(/[0-9.]+/g, '#');
  const km = mit.stdout.split('\n').filter((l) => !/^Mitschnitt/.test(l)).join('\n').replace(/[0-9.]+/g, '#');
  ok(ke === km && ke.length > 100, 'Konsolenausgabe mit und ohne Flag gleich (ohne die Mitschnitt-Zeile, Zahlen maskiert)');
}

try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* Temp bleibt */ }
console.log(fails ? `\nTEST MITSCHNITT-LAUF FEHLGESCHLAGEN (${fails})` : '\nTEST MITSCHNITT-LAUF OK');
process.exit(fails ? 1 : 0);
