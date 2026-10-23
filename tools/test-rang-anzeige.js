'use strict';
// SUND-02b UI: Rang-Anzeige (public/js/rang.js) ohne Browser: Storage (world.ruf, Löschsignal, Lobby, welcome), Anzeigemodell, Kürzen der Zeile,
// Anbindung an das Terminal-Modell (Statuszeile, Block „Stufe n öffnet“), Stützpunkte im Anzeigeblock world.lage (st) und in KarteLage.lesen,
// und die zwei ausgelieferten Textdateien (nur diese). Gegen eine ECHTE Game-Klasse (Freie Fahrt Sund und Kampagne).   node tools/test-rang-anzeige.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-rang-anzeige-'));
process.env.MISSION_SOURCE = 'fallback'; process.env.REGIE_DIR = path.join(TMP, 'regie'); process.env.ERZEUGT_DIR = path.join(TMP, 'erzeugt');
delete process.env.LLM_LIVE; delete process.env.SPIELLEITER_LLM;
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const KarteTokens = require('../public/js/karte-tokens.js');
const KarteLage = require('../public/js/karte-lage.js');
const Rang = require('../public/js/rang.js');
const RW = require('../content/welt/ruf-werte.json').werte;
const TEXTE = require('../content/flotte/ruf.json').anzeige;
const RAENGE = RW.raenge.wert;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n[' + t + ']'); return f(); };
const HZ = CONFIG.tickRate || 30;

function partie(start) {
  const g = new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { if (this.inbox.length < 400) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'A0', name: 'A0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: start || 'freie_fahrt' });
  g.handleMessage(c, { t: 'ready', ready: true });
  for (let i = 0; i < HZ; i++) g.step();
  g.space.enemies = [];
  return { g, c };
}
const alsNachricht = (sn) => Object.assign({ t: 'snap' }, sn);
// n Snapshots an den Client-Speicher geben (wie Net.on)
const mitlesen = (g, k) => { for (let i = 0; i < (k || 40); i++) Rang.lesen(alsNachricht(g.snapshot())); };

section('Texte und Daten', () => {
  ok(TEXTE && ['titel', 'fortschritt', 'naechster', 'hoechster', 'jetzt', 'jetzt_hoechster'].every((k) => typeof TEXTE[k] === 'string' && TEXTE[k]), 'content/flotte/ruf.json: Abschnitt anzeige mit allen Texten');
  ok(/\{ruf\}/.test(TEXTE.fortschritt) && /\{bis\}/.test(TEXTE.fortschritt) && /\{naechster\}/.test(TEXTE.naechster) && /\{rang\}/.test(TEXTE.jetzt), 'Platzhalter {ruf} {bis} {naechster} {rang} stehen in den Texten');
});

section('Anzeigemodell', () => {
  ok(Rang.modellAus(null, RAENGE, TEXTE) === null && Rang.modellAus(undefined, RAENGE, TEXTE) === null && Rang.modellAus({}, RAENGE, TEXTE) === null, 'ohne Block (Kampagne, Limes): kein Modell, kein Platzhalter');
  const m0 = Rang.modellAus({ rom: 0, ger: 0, kon: 0, rang: 'miles', name: 'Miles', ab: 0, bis: 8 }, RAENGE, TEXTE);
  ok(m0 && m0.name === 'Miles' && m0.zahl === '0/8' && m0.weiter === '→ Optio' && m0.voll === 0 && m0.anteil === 0 && m0.titel === TEXTE.titel, 'Miles 0: „0/8 → Optio“, keine Segmente gefüllt');
  const m1 = Rang.modellAus({ rom: 20, ger: 0, kon: 0, rang: 'optio', name: 'Optio', ab: 8, bis: 30 }, RAENGE, TEXTE);
  ok(m1 && m1.zahl === '20/30' && m1.weiter === '→ Centurio' && m1.voll === Math.floor((12 / 22) * Rang.SEGMENTE) && m1.jetzt === 'jetzt Optio · 20/30', 'Optio 20: 20/30, Segmente nach (ruf − ab)/(bis − ab), „jetzt Optio · 20/30“');
  const m2 = Rang.modellAus({ rom: 30, ger: 0, kon: 0, rang: 'centurio', name: 'Centurio', ab: 30, bis: 80 }, RAENGE, TEXTE);
  ok(m2 && m2.voll === 0 && m2.weiter === '→ Tribun', 'genau an der Schwelle: neuer Rang, Fortschritt 0');
  const m3 = Rang.modellAus({ rom: 200, ger: 0, kon: 0, rang: 'legat', name: 'Legat', ab: 180, bis: null }, RAENGE, TEXTE);
  ok(m3 && m3.anteil === null && m3.zahl === '' && m3.weiter === '' && m3.hoechster === TEXTE.hoechster && m3.jetzt === 'jetzt Legat', 'Legat: höchster Rang, keine Segmente, keine Zahl');
  const m4 = Rang.modellAus({ rom: 20, rang: 'optio', name: 'Optio', ab: 8, bis: 30 }, null, null);
  ok(m4 && m4.zahl === '20/30' && m4.weiter === '' && m4.titel === '', 'ohne Texte und Dienstgrade (Datei nicht geladen): Name und Zahl, nichts erfunden');
});

section('Zeile kürzt von rechts', () => {
  Rang.env.Render = { measure: (s) => String(s).length * 6, text() {} };
  Rang.env.Tokens = KarteTokens;
  const m = Rang.modellAus({ rom: 20, rang: 'optio', name: 'Optio', ab: 8, bis: 30 }, RAENGE, TEXTE);
  const arten = (w) => Rang.passend(m, w).map((q) => q.art).join(',');
  ok(arten(999) === 'titel,name,seg,zahl,weiter', 'genug Platz: Titel, Name, Segmente, Zahl, nächster Rang');
  ok(arten(Rang.breite(Rang.passend(m, 999)) - 1) === 'titel,name,seg,zahl', 'knapp: erst der nächste Rang weg');
  ok(arten(70) === 'titel,name,zahl' || arten(70) === 'titel,name', 'enger: die Segmente gehen vor der Zahl');
  ok(arten(40) === 'name', 'ganz eng: nur der Name');
  const gez = []; Rang.env.Render.text = (c, s) => gez.push(s);
  const ctx = { fillRect() {}, set fillStyle(v) { gez.push('F' + v); } };
  const w = Rang.zeichne(ctx, 400, 10, 999, m);
  ok(w > 0 && gez.includes('OPTIO') && gez.includes('20/30') && gez.includes('→ CENTURIO') && gez.includes('F' + KarteTokens.PULT.messing), 'zeichnet Name, Zahl, nächsten Rang und Segmente in Messing (Farben aus KarteTokens.PULT)');
  ok(Rang.zeichne(ctx, 400, 10, 999, null) === 0, 'ohne Modell: nichts gezeichnet');
});

section('Storage: world.ruf, Löschsignal, Lobby, welcome', () => {
  const { g, c } = partie('freie_fahrt');
  Rang.store.raenge = RAENGE; Rang.store.texte = TEXTE; Rang.store.ruf = null;
  mitlesen(g);
  const m = Rang.modell();
  ok(m && m.name === 'Miles' && m.zahl === '0/8', 'Freie Fahrt: der Block kommt an, Miles 0/8');
  g.handleMessage(c, { t: 'debug', cmd: 'ruf', args: 'rom 20' });
  mitlesen(g);
  ok(Rang.modell() && Rang.modell().name === 'Optio' && Rang.modell().zahl === '20/30', 'Debug ruf rom 20: Optio 20/30 für alle (nur bei Änderung gesendet, der Speicher hält ihn)');
  Rang.lesen(alsNachricht({ phase: 'play', world: { locations: [] } }));
  ok(Rang.modell() && Rang.modell().name === 'Optio', 'Snapshot ohne Feld ruf: der Rang bleibt');
  const ws = g.weltsim; g.weltsim = null;   // der Modus endet (Kampagne, Lobby): der Server sendet genau einmal world.ruf = null
  let nullen = 0; for (let i = 0; i < 40; i++) { const sn = g.snapshot(); if (sn.world && sn.world.ruf === null) nullen++; Rang.lesen(alsNachricht(sn)); }
  ok(nullen === 1 && Rang.modell() === null, 'Löschsignal world.ruf = null: Anzeige leer (kein Phantom-Rang)');
  g.weltsim = ws;
  Rang.store.ruf = { rom: 5, rang: 'miles', name: 'Miles', ab: 0, bis: 8 };
  Rang.lesen({ t: 'snap', phase: 'lobby' }); ok(Rang.modell() === null, 'Lobby-Snapshot leert');
  Rang.store.ruf = { rom: 5, rang: 'miles', name: 'Miles', ab: 0, bis: 8 };
  Rang.lesen({ t: 'welcome' }); ok(Rang.modell() === null, 'welcome (neue Verbindung) leert, der Server sendet neu');
  const k = partie('free');
  Rang.store.ruf = null; mitlesen(k.g);
  ok(Rang.modell() === null, 'Kampagne (Limes): nie ein Block, keine Anzeige');
});

section('Terminal-Modell: Statuszeile und Block „Stufe n öffnet“', () => {
  const Katalog = require('../shared/schiffskatalog.js'), Maps = require('../shared/maps.js'), Protocol = require('../shared/protocol.js'), Locations = require('../shared/locations.js');
  const win = { Shared_Schiffskatalog: Katalog, Shared_Maps: Maps, Shared_Config: CONFIG, Shared_Protocol: Protocol, Shared_Locations: Locations, performance, Net: { reportError(w, e) { throw e; } }, Rang };
  win.window = win; win.Render = { PAL: {}, text() {}, drawTooltip() {} }; win.Pult = {};
  win.PultTerminal = { TOKENS: { RASTER: { deckName: ['Mitteldeck', 'Oberdeck', 'Unterdeck'] } }, kappe: (a, e) => e, tw: (s) => String(s).length * 6, zeichneTerminal() {} };
  win.Consoles = { shopRows() { return []; }, denied() {} };
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'terminal-ui.js'), 'utf8'), win, { filename: 'terminal-ui.js' });
  const TU = win.TerminalUI;
  const { g, c } = partie('freie_fahrt');
  g.ship.docked = true; g.ship.dockedAt = 'castra_gradivi'; g.players[0].console = 'shop'; g.inventory.marks = 5000;
  g.handleMessage(c, { t: 'cmd', c: 'werft.freischalten', art: 'stufe', id: 1 });
  g.handleMessage(c, { t: 'debug', cmd: 'ruf', args: 'rom 20' });
  Rang.store.ruf = null; mitlesen(g);
  const sicht = () => ({ state: JSON.parse(JSON.stringify(g.snapshot())), me: g.players[0], send(m) { g.handleMessage(c, m); }, actions: { sfx() {}, leave() {} } });
  TU.zuruecksetzen(); TU.draw({}, sicht());
  let m = TU.modell(sicht());
  ok(m.status && m.status.rang && m.status.rang.name === 'Optio', 'Statuszeile trägt den Rang (Werft)');
  TU.keyDown({ code: 'KeyA', preventDefault() {} }, sicht()); m = TU.modell(sicht());
  ok(m.ansicht === 'stufe' && m.stufen.sperre && m.stufen.rangJetzt === 'jetzt Optio · 20/30', 'Stufe 2 gesperrt: Block nennt den jetzigen Rang („jetzt Optio · 20/30“)');
  ok(m.aktionen.haupt.disabled && m.aktionen.hinweis.fn === 'warn' && /Centurio/.test(m.aktionen.hinweis.text), 'Hauptknopf gesperrt, Grund (Rang) unter dem Knopf in Warnfarbe');
  TU.keyDown({ code: 'KeyH', preventDefault() {} }, sicht()); m = TU.modell(sicht());
  ok(m.bereich === 'handel' && m.status.rang && m.status.rang.name === 'Optio', 'Handel: derselbe Rang in der Statuszeile');
  Rang.store.ruf = null; m = TU.modell(sicht());
  ok(m.status.rang === null, 'ohne Block: kein Rang im Modell (keine Anzeige)');
});

section('Stützpunkte im Anzeigeblock world.lage (st) und auf der Karte', () => {
  const { g } = partie('freie_fahrt');
  const b0 = Kriegslage.lage(g), k0 = Kriegslage.lageSchluessel(g);
  ok(b0 && b0.st === undefined && !/\|/.test(String(k0)), 'ohne Stützpunkt: kein Feld st, Schlüssel wie vorher');
  const nd = g.weltsim.zustand.hexe['0505']; Object.assign(nd, { posten: true, besitzer: 'rom', garnison: 4, crew: true });
  Kriegslage.szeneAbschliessen(g, { wirkungen: [], wo: 'test' });
  const b1 = Kriegslage.lage(g);
  ok(b1 && Array.isArray(b1.st) && b1.st.join() === '0505' && Kriegslage.lageSchluessel(g) !== k0, 'Stützpunkt der Crew: st [0505], der Schlüssel ändert sich');
  ok(Kriegslage.lage(g).st && !('st' in (g.weltsim._lage ? g.weltsim._lage.block : {})), 'der gecachte Block des Wissens bleibt unverändert (Kopie)');
  const A = KarteLage.lesen(b1, KarteTokens.hexReihenfolge(require('../content/welt/sund_frei.json')));
  ok(A.st.has('0505') || !(A.hex['0505'] && A.hex['0505'].posten), 'KarteLage.lesen: Stützpunkt bekannt (nur, wenn das Wissen dort einen römischen Posten zeigt)');
  const A2 = KarteLage.lesen(Object.assign({}, b1, { st: ['0505', 'xx', 9, '0703'] }), KarteTokens.hexReihenfolge(require('../content/welt/sund_frei.json')));
  ok(!A2.st.has('xx') && !A2.st.has('0703'), 'Müll und Hexe ohne römischen Posten im Feld st werden ignoriert');
});

async function statisch() {
  console.log('\n[Ausgelieferte Textdateien]');
  const { startServer } = require('../server/index.js');
  const srv = await startServer({ port: 3479, roomCode: 'off', quiet: true });
  const holen = (u) => new Promise((res) => http.get('http://127.0.0.1:3479' + u, (r) => { let d = ''; r.on('data', (x) => { d += x; }); r.on('end', () => res({ s: r.statusCode, d })); }).on('error', () => res({ s: 0, d: '' })));
  try {
    const a = await holen('/content/flotte/ruf.json'), b = await holen('/content/welt/ruf-werte.json');
    ok(a.s === 200 && JSON.parse(a.d).anzeige && b.s === 200 && JSON.parse(b.d).werte.raenge, 'ruf.json und ruf-werte.json kommen an (200)');
    const z = await Promise.all(['/content/flotte/posten.json', '/content/welt/sund-sim.json', '/content/welt/', '/content/welt/kommandanten.json'].map(holen));
    ok(z.every((q) => q.s === 403 || q.s === 404) && !z.some((q) => q.s === 200), 'andere Dateien der Ordner bleiben zu (403/404): ' + z.map((q) => q.s).join(' '));
  } finally { await srv.close(); }
}

statisch().then(() => {
  console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen ok'));
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.error(e); console.log('FEHLER: Ausnahme'); process.exit(1); });
