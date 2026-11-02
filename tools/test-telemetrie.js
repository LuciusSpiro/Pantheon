'use strict';
// TEL-01 A: Test des Telemetrie-Dienstes (server/telemetrie/) – ohne Netz, direkt gegen die Game-Klasse.
//   node tools/test-telemetrie.js  (npm run test:telemetrie)
// Prüft: genau eine Datei je Session (Kopf, Ereignisse, session_ende), Kopfinhalt, Pseudonym (kein Name, kein Charaktername,
// keine clientId im ganzen Verzeichnis), Schreibfehler (Tick läuft weiter, Fehlerzähler), Nachzügler/Abgang mit Slot,
// Abschalten, flache Felder, Regielog-Verknüpfung, unveränderter Spielverlauf mit/ohne Protokoll.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Game } = require('../server/game.js');
const Regielog = require('../server/mission/regielog.js');
const { SCHEMA_VERSION } = require('../server/telemetrie/protokoll.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-tel-'));
let zaehler = 0;
const neuesVerz = () => path.join(root, 'v' + (++zaehler));
const lesen = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const dateien = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((x) => x.endsWith('.jsonl')).map((x) => path.join(d, x)) : []);
function alleDateien(d, out) {
  out = out || [];
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) alleDateien(f, out); else out.push(f); }
  return out;
}

function setup(players, dir, extraEnv, opts) {
  const o = opts || {};
  const env = Object.assign({ MISSION_SOURCE: 'fallback', TELEMETRIE_DIR: dir, TELEMETRIE_QUELLE: 'bot' }, extraEnv || {});
  const g = new Game({ noStore: true, seed: 7, env, log: () => {} });
  const conns = [];
  const join = (i) => {
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(c);
    g.handleMessage(c, { t: 'hello', clientId: 'Clientqzx-' + i, name: i === 0 ? 'Zyxwename' : 'Spieler' + i, color: i, karte: i === 0 ? { name: 'Qorvathchar' } : undefined });
    conns.push(c);
    return c;
  };
  for (let i = 0; i < players; i++) join(i);
  if (o.start !== false) for (const c of conns) g.handleMessage(c, { t: 'ready', ready: true });
  const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
  return { g, conns, join, run };
}
const flush = () => new Promise((r) => setImmediate(r));

(async () => {
  // ---------- 1. eine Session: Kopf, Ereignisse, Ende; Nachzügler; Abgang; Namenstest ----------
  console.log('Eine Session zu dritt');
  const d1 = neuesVerz();
  const s1 = setup(3, d1);
  const g = s1.g;
  ok(g.phase === 'play' && g.runId, 'Partie läuft, runId gesetzt');
  s1.run(3);
  await flush();
  const nach = s1.join(3);   // Nachzügler (vierter Spieler im Spiel)
  s1.run(1);
  g.removeConnection(s1.conns[1]);   // Abgang
  s1.run(1);
  g.handleMessage(s1.conns[0], { t: 'menu', op: 'end' });   // Partie beenden (sessionEnded mit byName im Bus)
  ok(g.phase === 'lobby', 'Partie beendet, Lobby');
  const fl = dateien(d1);
  ok(fl.length === 1, 'genau eine Protokolldatei (' + fl.length + ')');
  const z = fl.length ? lesen(fl[0]) : [];
  const kopf = z[0] || {}; const ende = z[z.length - 1] || {};
  ok(kopf.typ === 'kopf' && ende.typ === 'session_ende', 'erste Zeile kopf, letzte session_ende');
  ok(z.every((x) => x.v === SCHEMA_VERSION && x.sitzung === kopf.sitzung && Number.isFinite(x.tick) && Number.isFinite(x.t)), 'jede Zeile: v, sitzung, tick, t');
  ok(z.filter((x) => x.typ === 'kopf' || x.typ === 'session_ende').length === 2, 'Kopf und Ende je genau einmal');
  ok(/^[0-9a-f]{40}$/.test(kopf.commit || ''), 'Kopf: commit (' + String(kopf.commit).slice(0, 8) + ')');
  ok(kopf.plattform === process.platform + '-' + process.arch, 'Kopf: plattform ' + kopf.plattform);
  ok(kopf.spielerzahl === 3, 'Kopf: spielerzahl 3');
  ok(Array.isArray(kopf.slots) && kopf.slots.map((x) => x.slot).join() === 'p1,p2,p3', 'Kopf: slots p1,p2,p3');
  ok(kopf.quelle === 'bot', 'Kopf: quelle bot');
  ok(/^[0-9a-f]{16}$/.test(kopf.tuning_hash || '') && kopf.tuning_teile && kopf.tuning_teile.config, 'Kopf: tuning_hash und Teile');
  ok(kopf.seed === 7 && kopf.server_version && kopf.node, 'Kopf: seed, server_version, node');
  ok(kopf.schalter && kopf.schalter.MISSION_SOURCE === 'fallback' && !('TELEMETRIE_DIR' in kopf.schalter), 'Kopf: Schalter nur Positivliste');
  const tf = path.join(d1, 'tuning', kopf.tuning_hash + '.json');
  ok(fs.existsSync(tf), 'tuning/<hash>.json liegt da');
  const tj = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf, 'utf8')) : {};
  ok(tj.config && tj.config.tickHz === 30 && Object.keys(tj.werte || {}).length >= 15, 'Tuning-Datei: config und werte-Dateien (' + Object.keys(tj.werte || {}).length + ')');
  ok(Buffer.byteLength(JSON.stringify(kopf)) < 8000, 'Kopf klein (' + Buffer.byteLength(JSON.stringify(kopf)) + ' B)');
  const bei = z.filter((x) => x.typ === 'spieler_bei');
  ok(bei.length === 1 && bei[0].slot === 'p4' && bei[0].art === 'neu' && bei[0].nachzuegler === true && bei[0].spielerzahl === 4, 'Nachzügler: spieler_bei p4 neu, nachzuegler, spielerzahl 4');
  const weg = z.filter((x) => x.typ === 'spieler_weg');
  ok(weg.length === 1 && weg[0].slot === 'p2' && weg[0].spielerzahl === 3, 'Abgang: spieler_weg p2, spielerzahl 3');
  ok(z.some((x) => x.typ === 'mission_start'), 'Übersetzer: mission_start');
  ok(ende.grund === 'spieler' && ende.zeilen === z.length && ende.fehler === 0 && ende.verworfen === 0 && ende.dauer > 4, 'session_ende: grund spieler, zeilen = ' + ende.zeilen + ', fehler 0, dauer ' + ende.dauer);
  const pb = z.find((x) => x.typ === 'partie_beendet');
  ok(pb && pb.von === 'p1' && !('byName' in pb), 'partie_beendet nennt nur den Slot');
  ok(g.telemetrie.stand().fehler === 0, 'Fehlerzähler 0');
  // Namenstest über das ganze Verzeichnis (inkl. tuning)
  const verboten = ['Zyxwename', 'Qorvathchar', 'Clientqzx', 'Spieler1', 'Spieler2', 'Spieler3'];
  let treffer = 0; const dateienAlle = alleDateien(d1);
  for (const f of dateienAlle) { const t = fs.readFileSync(f, 'utf8'); for (const v of verboten) if (t.includes(v)) { treffer++; console.log('    Treffer', v, 'in', path.basename(f)); } }
  ok(dateienAlle.length >= 2 && treffer === 0, 'Namenstest: 0 Treffer in ' + dateienAlle.length + ' Dateien (Verzeichnis inkl. tuning)');

  // ---------- 2. Regielog-Verknüpfung ----------
  console.log('Regielog');
  const rl = Regielog.create({ dir: neuesVerz(), weltId: 'w', memoryOnly: true, sitzung: () => 'run-xyz' });
  ok(rl.write({ art: 'x' }).sitzung === 'run-xyz', 'Regielog-Eintrag trägt sitzung');
  ok(!('sitzung' in Regielog.create({ dir: neuesVerz(), weltId: 'w', memoryOnly: true }).write({ art: 'x' })), 'ohne sitzung-Funktion kein neues Feld');
  ok(kopf.regielog === Regielog.safeId('ohne-welt') + '.jsonl' || /\.jsonl$/.test(kopf.regielog), 'Kopf nennt die Regielog-Datei (' + kopf.regielog + ')');

  // ---------- 3. flache Felder ----------
  console.log('Positivliste der Felder');
  const d3 = neuesVerz();
  const s3 = setup(1, d3);
  s3.g.telemetrie.ereignis('probe', { ok: 1, text: 'a', obj: { name: 'Zyxwename' }, p: s3.g.players[0], f: () => 1, liste: [1, 'x'], schlecht: [{ a: 1 }], t: 99, typ: 'x' });
  s3.g.telemetrie.schreibeJetzt();
  const pz = lesen(dateien(d3)[0]).find((x) => x.typ === 'probe') || {};
  ok(pz.ok === 1 && pz.text === 'a' && pz.liste && pz.liste.length === 2, 'flache Felder bleiben');
  ok(!('obj' in pz) && !('p' in pz) && !('f' in pz) && !('schlecht' in pz), 'Objekte, Spielerobjekt, Funktionen, Listen von Objekten fallen weg');
  ok(pz.typ === 'probe' && pz.t !== 99, 'reservierte Felder (typ, t) nicht überschreibbar');
  ok(s3.g.telemetrie.stand().verworfeneFelder === 4, 'verworfene Felder gezählt (' + s3.g.telemetrie.stand().verworfeneFelder + ')');
  ok(!fs.readFileSync(dateien(d3)[0], 'utf8').includes('Zyxwename'), 'Name im Objektfeld nicht im Protokoll');
  s3.g.telemetrie.sessionBeenden('test');

  // ---------- 4. Schreibfehler ----------
  console.log('Schreibfehler');
  const sperr = path.join(root, 'ist-eine-datei');
  fs.writeFileSync(sperr, 'x');
  for (const [name, ziel] of [['Zielverzeichnis ist eine Datei', sperr], ['Zielverzeichnis liegt unter einer Datei', path.join(sperr, 'unter')]]) {
    let wurf = null; let s4;
    try {
      s4 = setup(2, ziel);
      s4.run(5);
      await flush();
      s4.g.handleMessage(s4.conns[0], { t: 'menu', op: 'end' });
    } catch (e) { wurf = e; }
    ok(!wurf, name + ': kein Wurf' + (wurf ? ' (' + wurf.message + ')' : ''));
    ok(s4 && s4.g.telemetrie.stand().fehler > 0, name + ': Fehlerzähler > 0 (' + (s4 && s4.g.telemetrie.stand().fehler) + ')');
    ok(s4 && s4.g.phase === 'lobby', name + ': Spiel lief weiter');
  }
  // Fehler beim Schreiben (Kanal weg): kein Wurf, Zähler, Tick läuft, nach Behebung wird nachgeschrieben
  const d4 = neuesVerz();
  const s4b = setup(2, d4);
  s4b.run(2); s4b.g.telemetrie.schreibeJetzt();
  const echt = fs.writeSync;
  fs.writeSync = () => { throw new Error('Platte voll (Test)'); };
  let wurf2 = null;
  try { s4b.g.telemetrie.ereignis('x', { a: 1 }); s4b.g.telemetrie.schreibeJetzt(); s4b.run(2); await flush(); } catch (e) { wurf2 = e; } finally { fs.writeSync = echt; }
  ok(!wurf2, 'Schreibfehler (Platte voll): kein Wurf');
  ok(s4b.g.telemetrie.stand().fehler >= 1 && s4b.g.errors >= 1, 'Schreibfehler gezählt (Dienst und game.errors)');
  const tickVorher = s4b.g.tick; s4b.run(1);
  ok(s4b.g.tick === tickVorher + 30, 'Tick läuft nach dem Fehler weiter');
  s4b.g.telemetrie.schreibeJetzt();
  ok(s4b.g.telemetrie.stand().puffer === 0, 'nach Behebung wird der Puffer nachgeschrieben');
  s4b.g.telemetrie.sessionBeenden('test');
  const ende4 = lesen(dateien(d4)[0]).pop();
  ok(ende4.typ === 'session_ende' && ende4.fehler >= 1, 'session_ende nennt die Fehler (' + ende4.fehler + ')');

  // ---------- 5. Abschalten ----------
  console.log('Abschalten');
  const d5 = neuesVerz();
  const s5 = setup(2, d5, { TELEMETRIE: 'aus' });
  s5.run(3); s5.g.handleMessage(s5.conns[0], { t: 'menu', op: 'end' });
  ok(!fs.existsSync(d5), 'TELEMETRIE=aus: kein Verzeichnis, keine Datei');
  ok(s5.g.telemetrie.stand().zeilen === 0, 'TELEMETRIE=aus: keine Zeilen');

  // noStore-Spiele (Tests, Messwerkzeuge) ohne ausdrückliche Ablage/Quelle schreiben nichts; mit TELEMETRIE_QUELLE oder TELEMETRIE=an schon
  const stumm = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', TELEMETRIE_DIR: '' }, log: () => {} });
  ok(stumm.telemetrie.aktiv === false, 'noStore ohne ausdrückliche Telemetrie-Einstellung: Dienst inaktiv');
  const lautQ = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', TELEMETRIE_QUELLE: 'bot' }, log: () => {} });
  const lautA = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', TELEMETRIE: 'an' }, log: () => {} });
  const norm = new Game({ seed: 7, env: { MISSION_SOURCE: 'fallback' }, worlds: false, log: () => {} });
  ok(lautQ.telemetrie.aktiv && lautA.telemetrie.aktiv && norm.telemetrie.aktiv, 'mit QUELLE, mit TELEMETRIE=an und ohne noStore: aktiv');

  // ---------- 6. Spielverlauf unverändert mit/ohne Protokoll ----------
  console.log('Spielverlauf unverändert');
  const lauf = (extra) => {
    const s = setup(2, neuesVerz(), extra);
    s.run(20);
    const h = crypto.createHash('sha1');
    h.update(JSON.stringify(s.g.snapshot())); h.update(String(s.g.rng()));
    return h.digest('hex');
  };
  ok(lauf({}) === lauf({ TELEMETRIE: 'aus' }), 'Snapshot und Zufallsstrom nach 20 s mit und ohne Protokoll gleich');

  // ---------- 7. Prozessende, Wiederverbinden, Leer-Reset ----------
  console.log('Lebenszyklus');
  const d7 = neuesVerz();
  const s7 = setup(2, d7);
  s7.run(1);
  s7.g.removeConnection(s7.conns[1]);
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  s7.g.addConnection(c); s7.g.handleMessage(c, { t: 'hello', clientId: 'Clientqzx-1', name: 'x' });
  s7.run(1);
  s7.g.removeConnection(s7.conns[0]); s7.g.removeConnection(c);
  s7.run(Math.ceil(s7.g.C.net.emptyResetAfter) + 2);   // alle weg -> Leer-Reset beendet die Session
  const z7 = lesen(dateien(d7)[0]);
  ok(z7.some((x) => x.typ === 'spieler_bei' && x.art === 'wieder' && x.slot === 'p2'), 'Wiederverbinden: spieler_bei art wieder');
  ok(z7[z7.length - 1].typ === 'session_ende' && z7[z7.length - 1].grund === 'leer', 'Leer-Reset beendet die Session (grund leer)');
  const s7b = setup(1, neuesVerz());
  s7b.run(1);
  s7b.g.telemetrie.prozessEnde();
  ok(lesen(dateien(path.dirname(s7b.g.telemetrie.stand().datei))[0]).pop().grund === 'prozessende', 'prozessEnde schreibt session_ende');

  const d8 = neuesVerz();
  const s8 = setup(4, d8);
  s8.run(1);
  s8.g.removeConnection(s8.conns[2]);
  s8.join(9);   // Platz p3 wird übernommen (Spiel voll, p3 frei)
  s8.g.telemetrie.schreibeJetzt();
  const ue = lesen(dateien(d8)[0]).find((x) => x.typ === 'spieler_bei');
  ok(ue && ue.art === 'uebernahme' && ue.slot === 'p3' && ue.nachzuegler === true, 'Übernahme: spieler_bei art uebernahme, slot p3');
  s8.g.telemetrie.sessionBeenden('test');

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${n - fails}/${n} ok`);
  if (fails) { console.log('TEST-TELEMETRIE FEHLER'); process.exit(1); }
  console.log('TEST-TELEMETRIE OK');
})().catch((e) => { console.error(e); process.exit(1); });
