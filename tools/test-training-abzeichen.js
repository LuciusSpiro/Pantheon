'use strict';
// TRA-01 C (Client): Abzeichen im Browser speichern, melden, im Trainingsmenü anzeigen (public/js/abzeichen.js, menue.js, menue-ui.js, client.js).
//   Speicher    setzen/lesen, Zeit, zweimal setzen, neue Instanz sieht den Stand; Version-Feld; Fliegen ohne Variante; unbekannte Id wird nicht gespeichert und beim Lesen verworfen
//   Defekt      kaputtes JSON, falscher Typ, falsche Version, Müll in der Liste → leerer/bereinigter Stand ohne Ausnahme
//   Ohne Speicher  getItem/setItem werfen, localStorage-Zugriff wirft, kein localStorage: keine Ausnahme, Meldung bleibt, Menü liefert Kacheln und öffnet die Unterseite
//   Captain     Tafel allein, Sprache allein, beide (Reihenfolge Tafel, Sprache): jedes zählt als „Captain“ erreicht; die Variante wird mitgespeichert
//   Handler     echter Server-Pfad (Trainingspartie wie tools/test-training-erkennung.js): jedes Ereignis abzeichen landet im Handler, den abzeichen.js an Net.onEvent hängt;
//               genau EINE Meldung im HUD je Ereignis; die ODA-Zeile des Servers wird vom Client unterdrückt (client.js case 'oda'), sonst stünde die Meldung doppelt
//   Anzeige     Kacheln erreicht/nicht erreicht (Captain mit Varianten); gesperrte Kacheln nie; die Unterseite liest beim Öffnen NEU
//   Keine Wirkung  Server-Snapshot gleich mit/ohne gespeichertes Abzeichen; im Spiel (server/, shared/, übrige public/js) liest nichts die Abzeichen
//   Mutationen  Regeln im Quelltext zerstören, der Test muss rot werden
//   node tools/test-training-abzeichen.js
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');
const Training = require('../server/sim/training.js');

const ROOT = path.join(__dirname, '..');
const lies = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const Q_ABZ = lies('public', 'js', 'abzeichen.js'), Q_MENUE = lies('public', 'js', 'menue.js'), Q_CLIENT = lies('public', 'js', 'client.js');
const DT = 1 / CONFIG.tickHz;
let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
function section(name, fn) { console.log('\n[' + name + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } }
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Module aus Quelltext: als Node-Modul bzw. im „Browser“ (self mit Net, Hud, localStorage …)
function alsModul(src) { const m = { exports: {} }; new Function('module', 'exports', 'self', src)(m, m.exports, undefined); return m.exports; }
function imBrowser(src, self) { new Function('self', src)(self); return self.Abzeichen; }
function speicher(start) { const m = new Map(start ? Object.entries(start) : []); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k) }; }
const wirft = () => { throw new Error('Speicher gesperrt'); };
const KEY = 'pantheon.abzeichen';

// Trainingspartie über den Lobby-Weg (wie test-training-erkennung.js); liefert die Client-Nachrichten und die ODA-Zeilen des Servers
function partie(modus, o) {
  o = o || {};
  const g = new Game({ noStore: true, worlds: false, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 5000) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'T0', name: 'Tr0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: modus });
  if (o.sprache) g.handleMessage(c, { t: 'lobbyOpt', trainingSprache: true });
  g.handleMessage(c, { t: 'ready', ready: true });
  const odas = []; const o0 = g.oda.bind(g); g.oda = (t, x) => { odas.push(String(t)); return o0(t, x); };
  const P = { g, c, odas };
  P.run = (sek) => { for (let k = 0; k < Math.round(sek / DT); k++) g.step(); };
  P.geschafft = () => { g.mission.flags.trainingFertig = true; P.run(1); };
  P.events = () => c.inbox.filter((m) => m.t === 'event');
  return P;
}

// Menü-Instanz mit gegebenem Abzeichen-Modul
function menue(api, abz) {
  const F = api.erzeuge({ protokoll: Protocol, senden: () => true, debug: false, szenenIds: () => [], weltstandMax: 5, verlasseRaum: () => true, oeffneKammer: () => true, abzeichen: () => abz });
  F.starte({}); F.weiter(); F.synchronisiere({ startMission: 'm1', worlds: [], laborAn: true });
  return F;
}
const oeffne = (F) => F.oeffneUnterseite(F.eintragMitId('training'), { startMission: 'm1', worlds: [] });
const standVon = (F) => Object.fromEntries(F.trainingKacheln().map((k) => [k.id, k.abzeichen]));

function pruefe(srcAbz, srcMenue, laut) {
  let schlecht = 0;
  const p = (c, msg) => { if (laut) ok(c, msg); else if (!c) schlecht++; };
  const sicher = (f) => { try { return f(); } catch (e) { return { __wurf: e && e.message }; } };
  const A = alsModul(srcAbz), M = alsModul(srcMenue);
  const neuA = (sp, extra) => A.erzeuge(Object.assign({ speicher: sp, jetzt: () => 1234 }, extra || {}));

  // ---- Speicher
  { const sp = speicher(), a = neuA(sp);
    p(gleich(a.lesen(), { v: 1, liste: [] }) && a.erreicht('fliegen') === false && a.erreicht('captain') === false, 'leerer Speicher: nichts erreicht, Stand { v: 1, liste: [] }');
    p(a.setzen('fliegen') === true && a.erreicht('fliegen') === true && a.erreicht('captain') === false, 'setzen(fliegen): erreicht, Captain nicht');
    const roh = JSON.parse(sp.m.get(KEY));
    p(roh.v === 1 && gleich(roh.liste, [{ id: 'fliegen', zeit: 1234 }]), 'gespeichert unter pantheon.abzeichen als { v: 1, liste: [{ id, zeit }] }: ' + sp.m.get(KEY));
    p(neuA(sp).erreicht('fliegen') === true, 'eine neue Instanz auf demselben Speicher (Neuladen) sieht das Abzeichen');
    const b = neuA(sp, { jetzt: () => 9999 }); b.setzen('fliegen');
    p(gleich(JSON.parse(sp.m.get(KEY)).liste, [{ id: 'fliegen', zeit: 1234 }]), 'zweites setzen ändert nichts (erste Zeit bleibt, kein Doppeleintrag)');
    p(b.setzen('fliegen', 'tafel') === true && gleich(JSON.parse(sp.m.get(KEY)).liste, [{ id: 'fliegen', zeit: 1234 }]), 'Fliegen kennt keine Variante: sie wird verworfen');
    p(a.setzen('gibtesnicht') === false && a.setzen('ops') === false && a.setzen(undefined) === false && !JSON.parse(sp.m.get(KEY)).liste.some((x) => x.id !== 'fliegen'), 'unbekannte Id (gibtesnicht, ops, undefined): false, nichts gespeichert');
    const c = neuA(speicher({ [KEY]: JSON.stringify({ v: 1, liste: [{ id: 'fliegen', zeit: 5 }, { id: 'zauber', zeit: 6 }, { id: 'ops', zeit: 7 }] }) }));
    p(gleich(c.lesen().liste.map((x) => x.id), ['fliegen']) && c.erreicht('zauber') === false && c.stand('ops') === false, 'unbekannte Ids im Speicher werden beim Lesen verworfen'); }

  // ---- Defekter Speicherinhalt
  for (const [name, roh] of [['kein JSON', '{{kaputt'], ['leerer Text', ''], ['null', 'null'], ['Zahl', '42'], ['Liste statt Objekt', '[]'], ['falsche Version', JSON.stringify({ v: 2, liste: [{ id: 'fliegen', zeit: 1 }] })], ['ohne Version', JSON.stringify({ liste: [{ id: 'fliegen', zeit: 1 }] })], ['liste kein Array', JSON.stringify({ v: 1, liste: 'x' })]]) {
    const a = neuA(speicher({ [KEY]: roh })), s = sicher(() => a.lesen());
    p(gleich(s, { v: 1, liste: [] }) && sicher(() => a.erreicht('fliegen')) === false && sicher(() => a.ueberblick()).fliegen === false, 'Defekt „' + name + '“: leerer Stand, keine Ausnahme');
  }
  { const sp = speicher({ [KEY]: '{{kaputt' }), a = neuA(sp);
    p(a.setzen('captain', 'sprache') === true && a.erreicht('captain') === true && gleich(a.varianten('captain'), ['sprache']), 'kaputtes JSON wird beim nächsten setzen überschrieben und danach gelesen'); }
  { const a = neuA(speicher({ [KEY]: JSON.stringify({ v: 1, liste: [null, 7, 'x', { id: 'fliegen' }, { id: 'captain', variante: 'zauber', zeit: 'jetzt' }, { id: 'captain', variante: 'tafel', zeit: 3 }, { id: 'captain', variante: 'tafel', zeit: 4 }] }) }));
    const l = a.lesen().liste;
    p(l.length === 3 && gleich(l[0], { id: 'fliegen', zeit: 0 }) && gleich(l[1], { id: 'captain', zeit: 0 }) && gleich(l[2], { id: 'captain', zeit: 3, variante: 'tafel' }), 'Müll in der Liste: bereinigt (kein Objekt raus, ungültige Variante und Zeit fallen weg, Doppelte raus): ' + JSON.stringify(l)); }

  // ---- Ohne Speicher
  { const meldungen = [];
    const quellen = [['getItem und setItem werfen', { getItem: wirft, setItem: wirft }], ['nur setItem wirft (voll/privat)', { getItem: () => null, setItem: wirft }], ['nur getItem wirft', { getItem: wirft, setItem() {} }], ['der Zugriff auf localStorage wirft (SecurityError)', () => wirft()], ['kein localStorage', null], ['localStorage undefined', undefined]];
    for (const [name, sp] of quellen) {
      const a = neuA(sp, { melde: (t) => meldungen.push(t) });
      const r = sicher(() => [a.lesen(), a.setzen('fliegen'), a.setzen('captain', 'tafel'), a.erreicht('fliegen'), a.varianten('captain'), a.stand('captain'), a.ueberblick(), a.beiEreignis({ id: 'captain', variante: 'sprache' })]);
      p(!r.__wurf && typeof r[1] === 'boolean' && typeof r[2] === 'boolean' && r[3] === false && gleich(r[7], true) && gleich(r[6], { fliegen: false, captain: false }), 'ohne Speicher (' + name + '): keine Ausnahme, setzen meldet einen Wahrheitswert, gelesen wird nichts' + (r.__wurf ? ' [' + r.__wurf + ']' : ''));
      const F = menue(M, a), ks = sicher(() => F.trainingKacheln()), o = sicher(() => oeffne(F));
      p(!ks.__wurf && ks.length === 5 && ks.every((k) => k.abzeichen === false) && !o.__wurf && o.ok === true && F.unterseiteOffen(), '  Menü: fünf Kacheln, alle ohne Abzeichen, Unterseite öffnet (' + name + ')');
    }
    p(meldungen.length === quellen.length && meldungen.every((t) => t === 'Abzeichen erreicht: Captain (mit Sprache)'), 'die Meldung kommt auch ohne Speicher (' + meldungen.length + 'x)'); }
  { const F = menue(M, null); p(F.trainingKacheln().every((k) => k.abzeichen === false) && oeffne(F).ok, 'ganz ohne Abzeichen-Modul (Node-Menü): alles false, Unterseite öffnet'); }

  // ---- Captain: beide Varianten
  { const sp = speicher(), a = neuA(sp);
    p(a.setzen('captain', 'tafel') && a.erreicht('captain') === true && gleich(a.varianten('captain'), ['tafel']) && gleich(a.stand('captain'), { varianten: ['tafel'] }), 'Captain mit Tafel allein: erreicht, Variante Tafel');
    p(JSON.parse(sp.m.get(KEY)).liste[0].variante === 'tafel', '  die Variante steht im Speicher');
    p(a.setzen('captain', 'sprache') && a.erreicht('captain') === true && gleich(a.varianten('captain'), ['tafel', 'sprache']), 'danach Sprache: erreicht, beide Varianten (Tafel, Sprache)');
    const b = neuA(speicher()); b.setzen('captain', 'sprache');
    p(b.erreicht('captain') === true && gleich(b.varianten('captain'), ['sprache']) && b.erreicht('fliegen') === false, 'Captain mit Sprache allein: erreicht, Variante Sprache');
    b.setzen('captain', 'tafel');
    p(gleich(b.varianten('captain'), ['tafel', 'sprache']), 'erst Sprache, dann Tafel: Anzeigereihenfolge bleibt Tafel, Sprache');
    const c = neuA(speicher()); c.setzen('captain');
    p(c.erreicht('captain') === true && gleich(c.varianten('captain'), []), 'Captain ohne Variante (alter/fremder Stand): erreicht, keine Variante'); }

  // ---- Handler über den echten Server-Pfad
  { const sp = speicher(), hud = [], haenger = [];
    const self = { localStorage: sp, Shared_Protocol: Protocol, Net: { onEvent: (kind, fn) => { haenger.push({ kind, fn }); return () => {}; } }, Hud: { pushNotice: (t, farbe, dauer) => hud.push({ t, farbe, dauer }) }, Render: { PAL: { amber: '#FFC66B' } } };
    const abz = sicher(() => imBrowser(srcAbz, self));
    p(!abz.__wurf && !!abz && haenger.length === 1 && haenger[0].kind === Protocol.EVT_ABZEICHEN, 'Browser-Start: abzeichen.js hängt GENAU einen Handler an Net.onEvent(' + Protocol.EVT_ABZEICHEN + ') (' + haenger.map((h) => h.kind).join() + ')');
    const zustellen = (P) => { for (const m of P.events()) for (const h of haenger) if (h.kind === '*' || h.kind === m.kind) h.fn(m); };
    const sollen = [['training_fliegen', false, 'fliegen', undefined, 'Abzeichen erreicht: Fliegen'], ['training_captain', false, 'captain', 'tafel', 'Abzeichen erreicht: Captain (Befehlstafel)'], ['training_captain', true, 'captain', 'sprache', 'Abzeichen erreicht: Captain (mit Sprache)']];
    for (const [modus, sprache, id, variante, text] of sollen) {
      const P = partie(modus, { sprache }); P.run(1); P.geschafft();
      const vor = hud.length;
      zustellen(P);
      const ev = P.events().filter((m) => m.kind === Protocol.EVT_ABZEICHEN);
      p(ev.length === 1 && ev[0].id === id && ev[0].variante === variante, modus + (sprache ? ' (Sprache)' : '') + ': der Server sendet ein Ereignis abzeichen { id ' + id + ', variante ' + variante + ' }');
      const letzte = hud[hud.length - 1] || {};
      p(hud.length - vor === 1 && letzte.t === text && letzte.dauer > 3 && letzte.farbe === '#FFC66B', '  genau eine HUD-Meldung (Hinweis, 6 s, Messing): „' + letzte.t + '“');
      const gespeichert = A.erzeuge({ speicher: sp }).varianten(id), erreicht = A.erzeuge({ speicher: sp }).erreicht(id);
      p(erreicht === true && (variante ? gespeichert.includes(variante) : true), '  im Browser-Speicher: ' + id + (variante ? ' mit ' + variante : '') + ' erreicht');
      const zeilen = P.odas.filter((t) => /^Abzeichen/.test(t));
      p(zeilen.length === 1 && A.istOdaZeile(zeilen[0]) === true && A.istOdaZeile('Etwas anderes.') === false && A.istOdaZeile(undefined) === false, '  die ODA-Zeile des Servers („' + zeilen[0] + '“) erkennt der Client als Abzeichen-Zeile (wird unterdrückt)');
    }
    const roh = JSON.parse(sp.m.get(KEY));
    p(roh.v === 1 && gleich(roh.liste.map((x) => x.id + (x.variante ? ':' + x.variante : '')), ['fliegen', 'captain:tafel', 'captain:sprache']), 'nach allen drei Durchläufen im Speicher: fliegen, captain:tafel, captain:sprache');
    p(abz.erreicht('captain') === true && gleich(abz.varianten('captain'), ['tafel', 'sprache']), 'Captain steht mit beiden Varianten da');
    const vor = hud.length; haenger[0].fn({ id: 'gibtesnicht' }); haenger[0].fn(null); haenger[0].fn({});
    p(hud.length === vor && roh.liste.length === JSON.parse(sp.m.get(KEY)).liste.length, 'Ereignis mit unbekannter Id / ohne Inhalt: keine Meldung, nichts gespeichert, kein Wurf');
    const P2 = partie('training_fliegen'); P2.run(1); P2.geschafft(); P2.run(Training.NEUSTART_NACH_ERFOLG + 2); P2.geschafft();
    const v2 = hud.length; zustellen(P2);
    p(hud.length - v2 === 2 && JSON.parse(sp.m.get(KEY)).liste.filter((x) => x.id === 'fliegen').length === 1, 'zweiter Durchlauf im selben Spiel: zwei Meldungen (zwei Ereignisse), im Speicher bleibt ein Eintrag Fliegen'); }
  p(/case 'oda': if \(window\.Abzeichen && Abzeichen\.istOdaZeile\(ev\.text\)\) break; H\.pushOda\(ev\.text\);/.test(Q_CLIENT), 'client.js: die ODA-Zeile „Abzeichen erreicht: …“ wird nicht zusätzlich als ODA gezeigt (eine Meldung)');

  // ---- Anzeige im Trainingsmenü
  { const sp = speicher(), a = neuA(sp), F = menue(M, a);
    oeffne(F);
    p(gleich(standVon(F), { fliegen: false, captain: false, ops: false, technik: false, aussen: false }), 'Unterseite ohne Abzeichen: bei keiner Kachel erreicht');
    F.schliesseUnterseite(); a.setzen('fliegen'); oeffne(F);
    p(gleich(standVon(F), { fliegen: { varianten: [] }, captain: false, ops: false, technik: false, aussen: false }) && F.abzeichenStand('fliegen').varianten.length === 0, 'Fliegen erreicht: nur diese Kachel (ohne Variante)');
    F.schliesseUnterseite(); a.setzen('captain', 'sprache'); oeffne(F);
    p(gleich(standVon(F).captain, { varianten: ['sprache'] }), 'Captain mit Sprache: Kachel erreicht, Variante Sprache');
    F.schliesseUnterseite(); a.setzen('captain', 'tafel'); oeffne(F);
    p(gleich(standVon(F).captain, { varianten: ['tafel', 'sprache'] }) && standVon(F).fliegen !== false, 'Captain mit beiden: Tafel und Sprache, Fliegen bleibt erreicht');
    // Neu lesen beim Öffnen: Stand ändert sich, während das Menü zu ist
    const sp2 = speicher(), a2 = neuA(sp2), F2 = menue(M, a2); oeffne(F2); F2.schliesseUnterseite();
    sp2.m.set(KEY, JSON.stringify({ v: 1, liste: [{ id: 'fliegen', zeit: 1 }] })); oeffne(F2);
    p(standVon(F2).fliegen !== false, 'Beim Öffnen wird neu gelesen: ein inzwischen (nach dem Spiel) gespeichertes Abzeichen erscheint');
    F2.schliesseUnterseite(); sp2.m.delete(KEY); oeffne(F2);
    p(standVon(F2).fliegen === false, '  und ein inzwischen gelöschter Stand verschwindet (Neuladen mit leerem Speicher)');
    const F3 = menue(M, a2); a2.setzen('captain', 'tafel');
    p(gleich(standVon(F3).captain, { varianten: ['tafel'] }), 'Erster Zugriff ohne vorheriges Öffnen liest ebenfalls (lazy)');
    // gesperrte Kacheln: selbst wenn ein Stand dafür käme, zeigt das Menü nichts
    const Falsch = { ueberblick: () => ({ fliegen: false, captain: false, ops: { varianten: [] }, technik: { varianten: [] }, aussen: { varianten: [] } }) };
    const F4 = menue(M, Falsch); oeffne(F4);
    p(gleich(standVon(F4), { fliegen: false, captain: false, ops: false, technik: false, aussen: false }), 'gesperrte Kacheln (Ops, Technik, Außeneinsatz) zeigen nie ein Abzeichen, auch bei fremdem Stand');
    p(typeof F4.TEXT.training.abzeichenVariante.tafel === 'string' && typeof F4.TEXT.training.abzeichenVariante.sprache === 'string', 'Kleintexte der Varianten sind da (Tafel, Sprache)'); }

  // ---- Keine Wirkung: Server-Snapshot gleich
  { const lauf = (vorbelegt) => {
      const sp = speicher(vorbelegt ? { [KEY]: JSON.stringify({ v: 1, liste: [{ id: 'fliegen', zeit: 1 }, { id: 'captain', variante: 'tafel', zeit: 2 }, { id: 'captain', variante: 'sprache', zeit: 3 }] }) } : undefined);
      const self = { localStorage: sp, Shared_Protocol: Protocol, Net: { onEvent: () => () => {} }, Hud: { pushNotice() {} } };
      imBrowser(srcAbz, self);
      const P = partie('training_fliegen'); P.run(20);
      return { snap: JSON.stringify(P.g.snapshot()), fehler: P.g.errors };
    };
    const a = lauf(false), b = lauf(true);
    p(a.snap.length > 1000 && a.snap === b.snap && a.fehler === 0 && b.fehler === 0, 'Training mit/ohne gespeichertes Abzeichen: Server-Snapshot byte-gleich (' + a.snap.length + ' B)'); }
  return schlecht;
}

// Quelltext: im Spiel liest nichts die Abzeichen (nur abzeichen.js, Menü, Menü-Oberfläche und die ODA-Unterdrückung in client.js kennen sie)
section('Keine Wirkung im Spiel (Quelltext)', () => {
  const dateien = [];
  const geh = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules') continue; const f = path.join(d, e.name); if (e.isDirectory()) geh(f); else if (/\.js$/.test(e.name)) dateien.push(f); } };
  geh(path.join(ROOT, 'server')); geh(path.join(ROOT, 'shared')); geh(path.join(ROOT, 'public', 'js'));
  const erlaubt = new Set(['public/js/abzeichen.js', 'public/js/menue.js', 'public/js/menue-ui.js', 'public/js/client.js', 'server/sim/training.js', 'shared/protocol.js']);
  const treffer = dateien.filter((f) => { const rel = path.relative(ROOT, f).replace(/\\/g, '/'); return !erlaubt.has(rel) && /pantheon\.abzeichen|\bAbzeichen\.|window\.Abzeichen|MenueFluss\.abzeichen/.test(fs.readFileSync(f, 'utf8')); });
  ok(treffer.length === 0, 'keine weitere Datei liest den Abzeichen-Speicher oder das Modul (' + dateien.length + ' Dateien geprüft' + (treffer.length ? '; Treffer ' + treffer.map((f) => path.relative(ROOT, f)).join() : '') + ')');
  const clientTreffer = Q_CLIENT.split('\n').filter((z) => /Abzeichen/.test(z));
  ok(clientTreffer.length === 1 && /istOdaZeile/.test(clientTreffer[0]), 'client.js erwähnt die Abzeichen genau einmal: die Unterdrückung der ODA-Zeile');
  ok(!/bzeichen/.test(lies('server', 'game.js')) && !/abzeichen\b/.test(lies('server', 'sim', 'training-erkennung.js')), 'server/game.js und die Erkennung kennen keinen Client-Stand der Abzeichen');
  const html = lies('public', 'index.html');
  ok(html.indexOf('abzeichen.js') > 0 && html.indexOf('abzeichen.js') < html.indexOf('js/menue.js'), 'index.html lädt abzeichen.js vor menue.js');
});

section('Abzeichen (Speicher, Defekte, ohne Speicher, Captain, Handler, Anzeige, keine Wirkung)', () => { pruefe(Q_ABZ, Q_MENUE, true); });

section('Mutationsproben (Regeln im Quelltext zerstören)', () => {
  const norm = (s) => s.replace(/\r\n/g, '\n');
  const muta = [
    ['abzeichen', 'Lesen ohne try/catch', 'try { const sp = speicher(); roh = sp ? sp.getItem(KEY) : null; } catch (e) { roh = null; }', 'const sp = speicher(); roh = sp ? sp.getItem(KEY) : null;'],
    ['abzeichen', 'Schreiben ohne try/catch', 'try { const sp = speicher(); if (!sp) return false; sp.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; /* privater Modus, Speicher voll */ }', 'const sp = speicher(); if (!sp) return false; sp.setItem(KEY, JSON.stringify(s)); return true;'],
    ['abzeichen', 'kaputtes JSON wirft', 'try { o = JSON.parse(roh); } catch (e) { return leer(); }', 'o = JSON.parse(roh);'],
    ['abzeichen', 'Variante wird nicht gespeichert', 'if (v) eintrag.variante = v;', ''],
    ['abzeichen', 'Captain mit Tafel zählt nicht', 'const mine = s.liste.filter((x) => x.id === id);', "const mine = s.liste.filter((x) => x.id === id && x.variante !== 'tafel');"],
    ['abzeichen', 'Captain mit Sprache zählt nicht', 'const mine = s.liste.filter((x) => x.id === id);', "const mine = s.liste.filter((x) => x.id === id && x.variante !== 'sprache');"],
    ['abzeichen', 'unbekannte Ids werden angenommen', "const bekannt = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(NAMEN, id);", "const bekannt = (id) => typeof id === 'string';"],
    ['abzeichen', 'Handler wird nicht angemeldet', 'root.Abzeichen.anmelden(root.Net,', '(function () {})(root.Net,'],
    ['abzeichen', 'Handler speichert nicht', '      setzen(ev.id, ev.variante);\n', ''],
    ['abzeichen', 'keine Meldung im HUD', "if (typeof opt.melde === 'function') opt.melde(meldung(ev.id, ev.variante));", ''],
    ['abzeichen', 'falsche Version wird gelesen', 'o.v !== VERSION ||', ''],
    ['abzeichen', 'ODA-Zeile wird nicht erkannt', 'text.startsWith(MELDUNG.praefix)', "text.startsWith('Etwas anderes: ')"],
    ['menue', 'Anzeige liest beim Öffnen nicht neu', 'store.unterseite = e.unterseite; abzeichenNeuLesen();', 'store.unterseite = e.unterseite;'],
    ['menue', 'gesperrte Kachel zeigt ein Abzeichen', 'abzeichen: startbar ? abzeichenStand(k.id) : false', 'abzeichen: abzeichenStand(k.id)'],
    ['menue', 'Menü fragt das Abzeichen-Modul nicht ab', '(A && A.ueberblick()) || {}; } catch (e) { store.abzeichen = {}; }', '{}; } catch (e) { store.abzeichen = {}; }'],
  ];
  for (const [datei, name, von, nach] of muta) {
    const q = norm(datei === 'abzeichen' ? Q_ABZ : Q_MENUE);
    ok(q.split(von).length === 2, 'Mutation anwendbar (Anker genau einmal): ' + name);
    const g = q.replace(von, nach);
    let schlecht;
    try { schlecht = datei === 'abzeichen' ? pruefe(g, norm(Q_MENUE), false) : pruefe(norm(Q_ABZ), g, false); } catch (e) { schlecht = 1; }
    ok(schlecht > 0, 'Mutation erkannt (' + schlecht + ' Prüfungen rot): ' + name);
  }
  // Mutation im Client: ODA-Zeile nicht unterdrückt → die Quelltextprüfung schlägt an
  const c = norm(Q_CLIENT).replace('if (window.Abzeichen && Abzeichen.istOdaZeile(ev.text)) break; ', '');
  ok(!/case 'oda': if \(window\.Abzeichen && Abzeichen\.istOdaZeile\(ev\.text\)\) break;/.test(c) && c !== norm(Q_CLIENT), 'Mutation erkannt: client.js ohne Unterdrückung der ODA-Zeile fällt der Quelltextprüfung auf (Doppelmeldung)');
  ok(pruefe(norm(Q_ABZ), norm(Q_MENUE), false) === 0, 'unveränderter Quelltext besteht still');
});

console.log(`\ntest-training-abzeichen: ${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);
