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
const { SCHEMA_VERSION, PUFFER_MAX, MAX_TUNING, offeneSessions } = require('../server/telemetrie/protokoll.js');

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
  const env = Object.assign({ MISSION_SOURCE: 'fallback', TELEMETRIE: 'an', TELEMETRIE_DIR: dir, TELEMETRIE_QUELLE: 'bot' }, extraEnv || {});
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
  ok(z.some((x) => x.typ === 'szene_start'), 'Szenenhaken: szene_start (vorher Übersetzer mission_start)');
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

  // Aktivierung nur über TELEMETRIE=an|aus; Standard: an für einen echten Server, aus bei noStore (Tests, Messwerkzeuge). QUELLE und DIR sind nur Etikett bzw. Ablage.
  const mk = (opts, env) => new Game(Object.assign({ seed: 7, worlds: false, env: Object.assign({ MISSION_SOURCE: 'fallback' }, env), log: () => {} }, opts)).telemetrie.aktiv;
  const vorher = process.env.TELEMETRIE; delete process.env.TELEMETRIE;
  ok(mk({ noStore: true }, {}) === false, 'noStore ohne Einstellung: Dienst inaktiv');
  ok(mk({ noStore: true }, { TELEMETRIE_QUELLE: 'bot', TELEMETRIE_DIR: root }) === false, 'noStore + QUELLE/DIR schaltet nichts ein (kein verdeckter Schalter)');
  ok(mk({ noStore: true }, { TELEMETRIE: 'an' }) === true, 'noStore + TELEMETRIE=an: aktiv');
  ok(mk({}, {}) === true, 'echter Server ohne Einstellung: aktiv');
  ok(mk({}, { TELEMETRIE: 'aus' }) === false, 'echter Server + TELEMETRIE=aus: inaktiv');
  if (vorher !== undefined) process.env.TELEMETRIE = vorher;

  // ---------- 6. Spielverlauf unverändert mit/ohne Protokoll ----------
  console.log('Spielverlauf unverändert');
  const lauf = (extra) => {
    const s = setup(2, neuesVerz(), extra);
    s.run(20);
    const h = crypto.createHash('sha1');
    h.update(JSON.stringify(s.g.snapshot())); h.update(String(s.g.rng()));
    s.g.telemetrie.sessionBeenden('test');   // keine offene Session zurücklassen (der Exit-Haken würde sonst nach dem Aufräumen den Ordner neu anlegen)
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

  // ---------- 8. Nacharbeit: Fehlerfall ohne Drosselung (B1), kaputte Zeile (S3), Teilschreiben (S4) ----------
  console.log('Dauerhafter Schreibfehler');
  {
    const d = neuesVerz();
    const s = setup(1, d);
    s.g.telemetrie.schreibeJetzt();   // Kanal offen
    ok(s.g.telemetrie.s.fd != null, 'Datei offen');
    const echt2 = fs.writeSync; let versuche = 0;
    fs.writeSync = () => { versuche++; throw Object.assign(new Error('ENOSPC (Test)'), { code: 'ENOSPC' }); };
    const warn = console.warn; console.warn = () => {};
    let wurf = null; const t0 = process.hrtime.bigint();
    try { for (let i = 0; i < 3000; i++) s.g.telemetrie.ereignis('schuss', { a: i, b: 'x', c: 1.5 }); for (let i = 0; i < 2000; i++) s.g.telemetrie.ereignis('schuss', { a: i }); s.run(2); } catch (e) { wurf = e; } finally { fs.writeSync = echt2; console.warn = warn; }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const st = s.g.telemetrie.stand();
    ok(!wurf, 'Dauerfehler: kein Wurf');
    ok(ms < 50, '5000 Ereignisse + 2 s Tick bei vollem Puffer in unter 50 ms (' + ms.toFixed(1) + ' ms)');
    ok(versuche <= 2, 'Schreibversuche gedrosselt (' + versuche + ')');
    ok(st.fehler >= 1 && st.fehler <= 3, 'Fehlerzähler gedrosselt (' + st.fehler + ')');
    ok(st.puffer <= PUFFER_MAX, 'Puffer begrenzt (' + st.puffer + ' <= ' + PUFFER_MAX + ')');
    for (let i = 0; i < PUFFER_MAX; i++) s.g.telemetrie.ereignis('fuell', { a: i });
    ok(s.g.telemetrie.stand().puffer <= PUFFER_MAX && s.g.telemetrie.stand().verworfen > 0, 'Puffergrenze greift im Fehlerfall: weitere Zeilen werden verworfen und gezählt (' + s.g.telemetrie.stand().verworfen + ')');
    s.g.telemetrie.s.naechsterVersuch = 0;   // Wartezeit abgelaufen: ein Versuch, jetzt gelingt er
    s.g.telemetrie.ereignis('nach', { a: 1 }); s.g.telemetrie.schreibeJetzt();
    ok(s.g.telemetrie.stand().puffer === 0, 'nach Behebung wird der Puffer geschrieben');
    s.g.telemetrie.sessionBeenden('test');
    const ze = lesen(dateien(d)[0]);
    ok(ze[0].typ === 'kopf' && ze[ze.length - 1].typ === 'session_ende' && ze[ze.length - 1].verworfen > 0, 'Datei: Kopf, Ende, verworfen im Ende (' + ze[ze.length - 1].verworfen + ')');
  }

  console.log('Kaputte Zeile und Teilschreiben');
  {
    const d = neuesVerz();
    const s = setup(1, d);
    const T = s.g.telemetrie;
    T.ereignis('gut1', { a: 1 });
    const zyklus = {}; zyklus.selbst = zyklus;
    T.s.puffer.push({ v: 1, typ: 'zyklus', sitzung: T.sitzung, tick: 0, t: 0, x: zyklus });
    T.s.puffer.push({ v: 1, typ: 'bigint', sitzung: T.sitzung, tick: 0, t: 0, x: 10n });
    T.ereignis('gut2', { a: 2 });
    const warn = console.warn; console.warn = () => {};
    let wurf = null; try { T.schreibeJetzt(); } catch (e) { wurf = e; } finally { console.warn = warn; }
    const zz = lesen(T.stand().datei);
    ok(!wurf && zz.some((x) => x.typ === 'gut1') && zz.some((x) => x.typ === 'gut2'), 'nicht serialisierbare Zeilen blockieren den Puffer nicht (gut1, gut2 geschrieben)');
    ok(!zz.some((x) => x.typ === 'zyklus' || x.typ === 'bigint') && T.stand().verworfen === 2 && T.stand().fehler >= 1, 'defekte Zeilen verworfen und gezählt (verworfen ' + T.stand().verworfen + ', fehler ' + T.stand().fehler + ')');
    // Teilschreiben + Fehler: nur der Rest wird wiederholt
    let n = 0; const echt2 = fs.writeSync;
    fs.writeSync = (fd, buf, off, len) => { n++; if (n === 1) return echt2(fd, buf, off, Math.floor(len / 2)); throw new Error('EIO (Test)'); };
    for (let i = 0; i < 5; i++) T.ereignis('teil', { i });
    console.warn = () => {};
    try { T.schreibeJetzt(); } finally { fs.writeSync = echt2; console.warn = warn; }
    T.schreibeJetzt();   // Rest nachschreiben
    T.ereignis('spaet', { a: 1 });   // noch im Puffer, wenn die Session endet
    T.sessionBeenden('test');
    const roh = fs.readFileSync(T.stand().datei, 'utf8').split('\n').filter(Boolean);
    let kaputt = 0; const teil = [];
    for (const l of roh) { try { const o = JSON.parse(l); if (o.typ === 'teil') teil.push(o.i); } catch (e) { kaputt++; } }
    ok(kaputt === 0, 'Teilschreiben: keine unparsebare Zeile');
    ok(teil.join() === '0,1,2,3,4', 'Teilschreiben: jede Zeile genau einmal, in Reihenfolge (' + teil.join() + ')');
    const ende = JSON.parse(roh[roh.length - 1]);
    ok(ende.typ === 'session_ende' && ende.bytes === Buffer.byteLength(roh.slice(0, -1).join('\n') + '\n'), 'session_ende.bytes = Dateigröße vor der letzten Zeile (' + ende.bytes + ')');
  }

  // ---------- 9. Abgang in der Lobby, Belegung, tune, Kopf (Nacharbeit) ----------
  console.log('Abgang in der Lobby');
  {
    const d = neuesVerz();
    const s = setup(2, d, null, { start: false });
    s.g.handleMessage(s.conns[1], { t: 'ready', ready: true });
    s.g.removeConnection(s.conns[0]);   // p1 geht in der Lobby, p2 ist bereit -> Start
    ok(s.g.phase === 'play', 'Abgang in der Lobby startet die Partie der Übrigen');
    s.run(1);
    s.g.telemetrie.sessionBeenden('test');
    const zz = lesen(dateien(d)[0]);
    ok(!zz.some((x) => x.typ === 'spieler_weg'), 'kein Phantom-Abgang aus der Lobby in der neuen Session');
    ok(zz[0].slots.length === 1 && zz[0].slots[0].slot === 'p2', 'Kopf: nur p2');
  }
  console.log('Belegung');
  {
    const d = neuesVerz();
    const s = setup(4, d);   // Spiel voll: ein Neuer übernimmt den freien Slot
    s.run(1);
    s.g.removeConnection(s.conns[1]);
    const c9 = s.join(9);   // freier Slot p2 wird übernommen
    s.g.removeConnection(c9);
    const c9b = { inbox: [], send(m) { this.inbox.push(m); } };
    s.g.addConnection(c9b); s.g.handleMessage(c9b, { t: 'hello', clientId: 'Clientqzx-9', name: 'x' });   // dieselbe Person wieder
    s.g.removeConnection(c9b);
    s.g.telemetrie.sessionBeenden('test');
    const zz = lesen(dateien(d)[0]);
    ok(zz[0].slots.every((x) => x.belegung === 1), 'Kopf: slots mit belegung 1');
    const ev = zz.filter((x) => x.slot === 'p2' && (x.typ === 'spieler_bei' || x.typ === 'spieler_weg')).map((x) => x.typ.slice(8) + ':' + (x.art || '') + ':' + x.belegung);
    ok(ev.join() === 'weg::1,bei:uebernahme:2,weg::2,bei:wieder:2,weg::2', 'wiederverwendeter Slot: belegung zählt (' + ev.join() + ')');
  }
  console.log('tune, Kopf, Tuning');
  {
    const d = neuesVerz();
    const s = setup(1, d, null, { start: false });
    s.g.lobbyOpts.startMission = 'arena_graben';
    s.g.handleMessage(s.conns[0], { t: 'ready', ready: true });
    s.g.onDebugM2(s.g.players[0], 'tune', { path: 'net.emptyResetAfter', value: 99 });
    s.g.onDebugM2(s.g.players[0], 'tune', { path: 'net.gibtEsNicht', value: 1 });   // schlägt fehl: kein Ereignis
    s.g.telemetrie.sessionBeenden('test');
    const zz = lesen(dateien(d)[0]);
    const tu = zz.filter((x) => x.typ === 'tune');
    ok(tu.length === 1 && tu[0].pfad === 'net.emptyResetAfter' && tu[0].alt === 90 && tu[0].neu === 99, 'tune: Ereignis mit Pfad, altem und neuem Wert');
    ok(zz[0].modus === 'arena_graben' && zz[0].graben && zz[0].graben.wiese, 'Kopf nennt die Grabenvarianten (' + JSON.stringify(zz[0].graben) + ')');
    ok(s.g.telemetrie.stand().fehler === 0, 'kein Fehler');
  }
  {
    // Tuning-Datei scheitert zuerst (tuning ist eine Datei), die Session schreibt trotzdem; später klappt es in derselben Session
    const d = neuesVerz(); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'tuning'), 'x');
    const s = setup(1, d);
    const warn = console.warn; console.warn = () => {};
    s.g.telemetrie.schreibeJetzt();
    console.warn = warn;
    const T = s.g.telemetrie;
    ok(T.stand().fehler >= 1 && T.s.tuning && !T.s.tuningGeschrieben, 'Tuning-Fehler gezählt, Tuning bleibt vorgemerkt');
    ok(T.s.puffer.length === 0, 'Protokollzeilen wurden trotzdem geschrieben');
    fs.rmSync(path.join(d, 'tuning')); T.s.tuningNaechster = 0;
    T.ereignis('x', { a: 1 }); T.schreibeJetzt();
    ok(T.s.tuningGeschrieben && T.s.tuning === null && fs.existsSync(path.join(d, 'tuning')) && fs.readdirSync(path.join(d, 'tuning')).length === 1, 'Tuning in derselben Session nachgeschrieben, danach freigegeben');
    T.sessionBeenden('test');
  }
  console.log('Grenzen und Rotation');
  {
    const g1 = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', TELEMETRIE: 'an', TELEMETRIE_DIR: neuesVerz() }, log: () => {} });
    g1.runId = 'run-ohnekopf-1';
    g1.telemetrie.sessionBeginnen();   // Kopf wird nie fertig (startGame wirft)
    for (let i = 0; i < PUFFER_MAX + 5000; i++) g1.telemetrie.ereignis('x', { i });
    ok(g1.telemetrie.stand().puffer <= PUFFER_MAX && g1.telemetrie.stand().verworfen >= 5000, 'Puffergrenze greift auch ohne fertigen Kopf (' + g1.telemetrie.stand().puffer + ', verworfen ' + g1.telemetrie.stand().verworfen + ')');
    g1.telemetrie.sessionBeenden('test');
    const g2 = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', TELEMETRIE: 'an', TELEMETRIE_DIR: neuesVerz() }, log: () => {} });
    g2.runId = 'run-schluessel-1'; g2.telemetrie.sessionBeginnen();
    const st0 = g2.telemetrie.stand().verworfeneFelder;
    g2.telemetrie.ereignis('p', { ok: 1, Zyxwename: 1, 'mit leer': 2, a_b2: 3 });
    ok(g2.telemetrie.stand().verworfeneFelder - st0 === 2, 'Feldnamen nur [a-z0-9_]: zwei Schlüssel verworfen');
    g2.telemetrie.sessionBeenden('test');
    // Rotation je Ordner: 305 alte Protokolle im Ordner, 3 im Unterordner bot/ (bleiben unberührt); tuning/ auf MAX_TUNING begrenzt
    const dr = neuesVerz(); fs.mkdirSync(path.join(dr, 'bot'), { recursive: true }); fs.mkdirSync(path.join(dr, 'tuning'), { recursive: true });
    const alt = Date.now() / 1000 - 100000;
    for (let i = 0; i < 305; i++) { const f = path.join(dr, 'alt' + i + '.jsonl'); fs.writeFileSync(f, '{}\n'); fs.utimesSync(f, alt + i, alt + i); }
    for (let i = 0; i < 3; i++) { const f = path.join(dr, 'bot', 'b' + i + '.jsonl'); fs.writeFileSync(f, '{}\n'); fs.utimesSync(f, alt, alt); }
    for (let i = 0; i < MAX_TUNING + 5; i++) { const f = path.join(dr, 'tuning', 'a' + i + '.json'); fs.writeFileSync(f, '{}'); fs.utimesSync(f, alt + i, alt + i); }
    const sr = setup(1, dr);
    sr.g.telemetrie.schreibeJetzt();
    const khash = sr.g.telemetrie.s.kopf.tuning_hash;
    sr.g.telemetrie.sessionBeenden('test');
    const nJ = fs.readdirSync(dr).filter((x) => x.endsWith('.jsonl')).length;
    ok(nJ === 300, 'Rotation: 300 Protokolle im Ordner (' + nJ + ')');
    ok(fs.readdirSync(path.join(dr, 'bot')).length === 3, 'Rotation je Ordner: bot/ unberührt');
    const nT = fs.readdirSync(path.join(dr, 'tuning')).length;
    ok(nT === MAX_TUNING && fs.existsSync(path.join(dr, 'tuning', khash + '.json')), 'tuning/ auf ' + MAX_TUNING + ' begrenzt, aktuelle Datei bleibt (' + nT + ')');
    // eine benutzte, alte Tuning-Datei wird bei neuer Session berührt und nicht gelöscht
    const alt2 = Date.now() / 1000 - 50000; fs.utimesSync(path.join(dr, 'tuning', khash + '.json'), alt2, alt2);
    const sr2 = setup(1, dr); sr2.g.telemetrie.schreibeJetzt();
    ok(fs.statSync(path.join(dr, 'tuning', khash + '.json')).mtimeMs > Date.now() - 60000, 'benutzte Tuning-Datei wird berührt');
    sr2.g.telemetrie.sessionBeenden('test');
  }

  ok(offeneSessions() === 0, 'am Ende ist keine Session offen (nichts bleibt für den Exit-Haken liegen)');
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${n - fails}/${n} ok`);
  if (fails) { console.log('TEST-TELEMETRIE FEHLER'); process.exit(1); }
  console.log('TEST-TELEMETRIE OK');
})().catch((e) => { console.error(e); process.exit(1); });
