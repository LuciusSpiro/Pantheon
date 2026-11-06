'use strict';
// ITM-01 E: Fallen-Client. Echtes Game (Server) liefert Payload, Ereignisse und Snapshots; render.js läuft im Sandkasten (vm) und verarbeitet sie wie der Browser.
// Geprüft: Start je sicht, ao-Dekodierung, ankerEnthuellt (Reihenfolge, Index i, Wiederholung, andere Kartenversion, Lücke, neues awayMap, ao vor dem Enthüllen),
// Kollisions-Vorhersage gleich dem Server (Anlage blockiert, Druckfeld/Schott nicht; Schritt für Schritt gegen die echte Serverposition), Sicht ohne Box,
// Feld-Overlay an/aus (Rechteck und Kreis, andere Karte), Marken je Zustand, Schuss-Strahl, Restzeit-Zeilen, Scan-Positionstext (Falle Stufe 2, andere Arten Stufe 3, Content = Config),
// Rückfall-Kits (Bauweisen: Zeile je Typ, vorhandene Props, K-SILHOUETTE-Ausnahme für die blockende Anlage), Einhängestellen in client.js, hud.js, consoles.js, kit.js.
// client.js und das Zusammenspiel im Browser: tools/itm01-e-shots.js und tools/itm01-e-gruppe.js.   node tools/test-fallen-client.js   (npm run test:fallen-client)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);

const { Game } = require('../server/game.js');
const interior = require('../server/sim/interior.js');
const Anker = require('../server/sim/anker.js');
const Fallen = require('../server/sim/fallen.js');
const Scanbar = require('../server/sim/scanbar.js');
const L = require('../server/sim/landepunkte.js');
const W = require('../server/world.js');
const Buehne = require('../shared/buehne.js');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const SA = require('../public/js/scan-anzeige.js');
const TILE = Physics.TILE;
const DT = 1 / CONFIG.tickHz;
const DATEN = JSON.parse(read('content/scanner/datenblaetter.json'));

// ---------- Client-Sandkasten (render.js) ----------
const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true });
const fehlerClient = [];
const win = { Shared_Maps: require('../shared/maps.js'), Shared_Physics: Physics, Shared_Config: CONFIG, Shared_Protocol: require('../shared/protocol.js'), Shared_Buehne: Buehne,
  document: { createElement: () => ({ getContext: () => stub, style: {}, width: 0, height: 0 }), querySelector: () => null, head: { appendChild() {} }, getElementById: () => null },
  console, Image: function () {}, performance, location: { search: '' }, Net: { reportError: (l, e) => fehlerClient.push(l + ': ' + (e && e.message)) } };
win.window = win; win.self = win;
vm.createContext(win);
vm.runInContext(read('public/js/render.js'), win, { filename: 'render.js' });
const R = win.Render;

// ---------- Server-Szene: Arena (16 x 9) mit Fallen in bekannter Geometrie ----------
const AW = 16, AH = 9;
const TRAGEND = { abholpunkt: 1, eingang: 1, tor: 1, lift: 1, leiter: 1, versteck: 1 };
function arenaBauen(k) {
  const drin = (a, x, y) => a.x >= x - 1 && a.x <= x + AW && a.y >= y - 1 && a.y <= y + AH;
  const kante = (x, y) => Object.values(k.kanten || {}).some((kk) => (kk.tiles || []).some((t) => t[0] >= x - 1 && t[0] <= x + AW && t[1] >= y - 1 && t[1] <= y + AH));
  let best = null;
  for (let y = 2; y + AH + 2 < k.h; y++) for (let x = 2; x + AW + 2 < k.w; x++) {
    if (kante(x, y) || k.anker.some((a) => TRAGEND[a.rolle] && drin(a, x, y))) continue;
    const m = k.anker.filter((a) => drin(a, x, y)).length;
    if (!best || m < best.m) best = { x, y, m };
  }
  if (!best) throw new Error('keine Fläche für die Arena');
  k.anker = k.anker.filter((a) => !drin(a, best.x, best.y));
  for (const pid of Object.keys(k.plaetze || {})) { const r = k.plaetze[pid].rect; if (r && r[0] < best.x + AW && r[0] + r[2] > best.x && r[1] < best.y + AH && r[1] + r[3] > best.y) delete k.plaetze[pid]; }
  const rows = k.rows.map((r) => r.split(''));
  for (let y = best.y - 1; y <= best.y + AH; y++) for (let x = best.x - 1; x <= best.x + AW; x++) rows[y][x] = (x < best.x || y < best.y || x >= best.x + AW || y >= best.y + AH) ? '#' : '.';
  k.rows = rows.map((r) => r.join(''));
  const f = (id, typ, sicht, dx, dy) => k.anker.push({ id, rolle: 'falle', typ, sicht, x: best.x + dx, y: best.y + dy });
  (k.plaetze || (k.plaetze = {})).raum = { typ: 'arena', rect: [best.x, best.y, AW, AH], bereich: null };
  f('falle.eP', 'druck', 'passiv', 3, 4);       // Druckfeld, sichtbar
  f('falle.eS', 'schuss', 'passiv', 8, 4);      // Selbstschussanlage (Kollisionsbox), sichtbar
  f('falle.eC', 'schott', 'passiv', 13, 2);     // Schottfalle, sichtbar
  f('falle.eV', 'schuss', 'verborgen', 12, 7);  // verborgene Anlage
  f('falle.eU', 'druck', 'verborgen', 3, 7);    // verborgenes Druckfeld
  f('falle.eW', 'schuss', 'verborgen', 1, 1);   // ITM-01 G (S1): zweite verborgene Anlage, bleibt bis zum Paritätstest verborgen
  return best;
}
function szene() {
  const bauen0 = Buehne.bauen;
  L.cacheLeeren();
  let arena = null;
  Buehne.bauen = function () { const k = bauen0.apply(this, arguments); arena = arenaBauen(k); return k; };
  try {
    const g = new Game({ noStore: true, seed: 11, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send(o) { this.inbox.push(o); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'FC0', name: 'Client', color: 0 });
    g.handleMessage(c, { t: 'ready', ready: true });
    for (let i = 0; i < 6; i++) g.step();
    const id = L.neu(g, g.ship.scene, { art: 'ruine', seed: 3 });
    const aw = L.get(g, id);
    g.setAwayMap(id); aw.active = true;
    const p = g.players[0];
    interior.placeOnAwayPad(g, p, 0);
    require('../server/sim/combat.js').onArrive(g, p);
    g.god = true;
    const S = { g, c, id, aw, p, k: W.AWAY_MAPS[id].karte, A: arena, mark: 0 };
    S.lauf = (sek) => { for (let i = 0; i < Math.round(sek / DT); i++) { g.away.drones.length = 0; g.step(); } };
    S.neu = () => { const l = c.inbox.slice(S.mark); S.mark = c.inbox.length; return l; };
    S.an = (fid) => S.k.anker.find((a) => a.id === fid);
    S.hin = (dx, dy, ox, oy) => { const t = Physics.tileCenter(arena.x + dx, arena.y + dy); p.x = t.x + (ox || 0); p.y = t.y + (oy || 0); p.input.mx = 0; p.input.my = 0; };
    S.snap = () => g.snapshot();
    return S;
  } finally { Buehne.bauen = bauen0; }
}

const S = szene();
const { g, id, aw } = S;
S.lauf(0.4);
const ev0 = S.neu();
const mapEv = ev0.filter((e) => e.t === 'event' && e.kind === 'awayMap').pop();
const ID = (a) => a[0];
const reg = (ev) => R.registerAwayMap(JSON.parse(JSON.stringify(ev)));   // frische Kopie: render.js hängt Enthüllte an die Liste des Ereignisses

// ======================================================================
section('Payload und Start: verborgene Fallen stehen nicht in der Liste, passive starten erkannt');
let M;
{
  ok(!!mapEv, 'der Server schickt das awayMap an den Client');
  M = reg(mapEv);
  const ids = M.anker.map(ID);
  ok(['falle.eP', 'falle.eS', 'falle.eC'].every((x) => ids.includes(x)), 'passive Fallen (eP, eS, eC) stehen im Payload');
  ok(!ids.includes('falle.eV') && !ids.includes('falle.eU'), 'verborgene Fallen (eV, eU) stehen NICHT in der Client-Liste');
  const idx = (fid) => M.anker.findIndex((a) => a[0] === fid);
  const st0 = { away: { map: id, ao: [] } };
  ok(R.ankerZustand(M, st0, idx('falle.eP')) === 'erkannt' && R.ankerZustand(M, st0, idx('falle.eS')) === 'erkannt', 'Start passiv = erkannt, nicht zustaende[0] (verborgen), auch ohne ao');
  const anders = JSON.parse(JSON.stringify(M.anker[idx('falle.eP')]));
  anders[4].sicht = 'verborgen';
  const Mx = { anker: [anders], id };
  ok(R.ankerZustand(Mx, st0, 0) === 'verborgen', 'Start sicht verborgen = verborgen (Zustand 0 der Rolle)');
  ok(R.ankerZustand(M, { away: { map: id, ao: [[idx('falle.eP'), 2]] } }, idx('falle.eP')) === 'entschaerft', 'ao [i, 2] = entschärft');
  ok(R.ankerZustand(M, { away: { map: id, ao: [[idx('falle.eP'), 3]] } }, idx('falle.eP')) === 'ausgeloest', 'ao [i, 3] = ausgelöst');
  ok(R.ankerZustand(M, { away: { map: 'andere', ao: [[idx('falle.eP'), 3]] } }, idx('falle.eP')) === 'erkannt', 'ao einer anderen Karte zählt nicht (Start bleibt)');
  // unbekannter Zustandsindex in ao (außerhalb der Liste): Start, nicht Zustand 0
  ok(R.ankerZustand(M, { away: { map: id, ao: [[idx('falle.eP'), 9]] } }, idx('falle.eP')) === 'erkannt', 'ao mit unbekanntem Zustandsindex: Start der Falle (erkannt), nicht Zustand 0');
  {   // Rückfall ohne Shared_Buehne (Seite ohne Skript-Tag): dieselbe Regel in render.js
    const w2 = Object.assign({}, win, { Shared_Maps: {}, Shared_Buehne: undefined }); w2.window = w2; w2.self = w2;
    vm.createContext(w2); vm.runInContext(read('public/js/render.js'), w2, { filename: 'render.js' });
    const mm = { anker: [['a', 'falle', 1, 1, { typ: 'druck', sicht: 'passiv' }], ['b', 'falle', 2, 2, { typ: 'druck', sicht: 'verborgen' }]], id: 'x' };
    ok(w2.Render.ankerZustand(mm, { away: { map: 'x', ao: [] } }, 0) === 'erkannt' && w2.Render.ankerZustand(mm, { away: { map: 'x', ao: [] } }, 1) === 'verborgen', 'ohne Shared_Buehne: passiv erkannt, verborgen verborgen (Rückfall mit derselben Regel)');
  }
  const SB = win.Shared_Buehne, rollen = Buehne.daten().anker.rollen;
  const faelle = [{ rolle: 'falle', sicht: 'passiv' }, { rolle: 'falle', sicht: 'verborgen' }, { rolle: 'falle' }, { rolle: 'terminal' }, { rolle: 'flagge' }, { rolle: 'tor' }];
  ok(faelle.every((a) => SB.ankerStart(a, rollen[a.rolle].zustaende) === Anker.startFuer(a)), 'Shared_Buehne.ankerStart = server anker.startFuer für Fallen und andere Rollen (eine Regel)');
}

// ======================================================================
section('ankerEnthuellt: Index i, Reihenfolge, Wiederholung, Version, Lücke, ao vor dem Enthüllen');
let evEnth = [];
{
  const laenge0 = M.anker.length;
  // ao vor dem Enthüllen: Indizes ab der Listenlänge kennt der Client nicht
  const stVor = { away: { map: id, ao: [[laenge0, 1], [laenge0 + 5, 3]] } };
  ok(R.ankerZustand(M, stVor, laenge0) === null && R.ankerZustand(M, stVor, laenge0 + 5) === null, 'ao-Index ≥ Listenlänge (Falle noch nicht enthüllt): null, kein Wurf');
  // Server: verborgene Anlage eV wird erkannt (Scanner/Debug), eU löst aus
  const sP = S.p;
  const eVa = S.an('falle.eV'), kVor = R.buehneBewegungSolid(M, stVor);   // Cache der Kollisionskacheln vor dem Enthüllen füllen
  ok(!kVor(eVa.x, eVa.y), 'vor dem Enthüllen kennt die Vorhersage die verborgene Anlage nicht');
  Anker.setzen(g, id, 'falle.eV', 'erkannt', sP.id);
  S.lauf(0.2);
  const f1 = S.neu().filter((e) => e.t === 'event' && e.kind === 'ankerEnthuellt');
  ok(f1.length === 1 && f1[0].anker[0] === 'falle.eV' && f1[0].i === laenge0, 'Server: Ereignis ankerEnthuellt für eV, i = bisherige Listenlänge (' + laenge0 + ')');
  // ein Ereignis mit Lücke (i zu groß) wird nicht angehängt
  const luecke = Object.assign({}, f1[0], { i: laenge0 + 2 });
  ok(R.ankerEnthuellt(luecke) === 'luecke' && M.anker.length === laenge0, 'Lücke (i > Länge): nicht angehängt, Liste unverändert (die Indizes stimmten sonst nicht mehr)');
  const andere = Object.assign({}, f1[0], { kv: String(M.kv) + 'x' });
  ok(R.ankerEnthuellt(andere) === 'andere_version' && M.anker.length === laenge0, 'andere Kartenversion (kv): ignoriert');
  ok(R.ankerEnthuellt(Object.assign({}, f1[0], { map: 'gibtsnicht' })) === 'keine_karte', 'unbekannte Karte: ignoriert');
  ok(R.ankerEnthuellt(f1[0]) === 'neu' && M.anker.length === laenge0 + 1 && M.anker[laenge0][0] === 'falle.eV' && M.ankerIdx['falle.eV'] === laenge0, 'passendes Ereignis: angehängt an Position i, ankerIdx gesetzt');
  ok(R.ankerEnthuellt(f1[0]) === 'doppelt' && M.anker.length === laenge0 + 1, 'Wiederholung (gleiches Ereignis nochmal): ändert nichts');
  evEnth.push(f1[0]);
  ok(R.buehneBewegungSolid(M, S.snap())(eVa.x, eVa.y) === true, 'nach dem Enthüllen blockiert die Vorhersage die Kachel der Anlage (Cache merkt die neue Falle)');
  // Zustand der enthüllten Falle über ao
  const sn = S.snap();
  ok(R.ankerZustand(M, sn, laenge0) === 'erkannt', 'ao dekodiert die enthüllte Falle: erkannt (Zustand kommt wie immer über ao)');
  // eU löst aus (verborgen -> ausgelöst, wird beim Auslösen enthüllt)
  const fE = { id: 'falle.eU', x: S.an('falle.eU').x, y: S.an('falle.eU').y, px: 0, py: 0, typ: 'druck', sicht: 'verborgen', start: 'verborgen' };
  Fallen.ausloesen(g, aw, fE, sP);
  S.lauf(0.2);
  const f2 = S.neu().filter((e) => e.t === 'event' && e.kind === 'ankerEnthuellt');
  ok(f2.length === 1 && f2[0].anker[0] === 'falle.eU' && f2[0].i === laenge0 + 1, 'verborgen ausgelöst: wird beim Auslösen enthüllt, i = Länge + 1 (Reihenfolge des Eintreffens)');
  // Reihenfolge innerhalb des Ticks nicht garantiert: ao kann vor dem Ereignis ankommen
  const snFrueh = S.snap();
  ok(R.ankerZustand(M, snFrueh, laenge0 + 1) === null, 'ao mit Index der noch nicht angehängten zweiten Falle: ignoriert (null)');
  ok(R.ankerEnthuellt(f2[0]) === 'neu' && M.anker[laenge0 + 1][0] === 'falle.eU', 'danach angehängt');
  evEnth.push(f2[0]);
  ok(R.ankerZustand(M, S.snap(), laenge0 + 1) === 'ausgeloest', 'ao: ausgelöst');
  // neues awayMap setzt die Liste zurück, der Server schickt die Enthüllten in derselben Reihenfolge erneut
  const vorher = M.anker.map(ID).join();
  for (const q of g.players) { q.awayKv = null; if (q.awayEnth) delete q.awayEnth[id]; }
  S.lauf(0.2);
  const neu = S.neu().filter((e) => e.t === 'event' && (e.kind === 'awayMap' || e.kind === 'ankerEnthuellt'));
  ok(neu[0] && neu[0].kind === 'awayMap' && neu.slice(1).every((e) => e.kind === 'ankerEnthuellt') && neu.length === 3, 'Nachsendung: erst awayMap, dann die zwei Enthüllten');
  M = reg(neu[0]);
  ok(M.anker.length === laenge0 && !M.anker.map(ID).includes('falle.eV'), 'neues awayMap: die Client-Liste ist wieder der Payload (ohne die Enthüllten)');
  ok(neu.slice(1).map((e) => R.ankerEnthuellt(e)).join() === 'neu,neu' && M.anker.map(ID).join() === vorher, 'die Wiederholung baut dieselbe Liste in derselben Reihenfolge auf');
  ok(fehlerClient.filter((x) => !/Lücke/.test(x)).length === 0, 'keine Clientfehler außer der absichtlichen Lücke (' + fehlerClient.length + ')');
}

// ======================================================================
section('Kollisions-Vorhersage: gleiche Regel wie der Server, Sicht ohne Box');
{
  const solidS = interior.awaySolid(g);
  const st = S.snap();
  const kl = R.buehneBewegungSolid(M, st);
  const sicht = R.solidFn(M, st);
  const eS = S.an('falle.eS'), eV = S.an('falle.eV'), eP = S.an('falle.eP'), eC = S.an('falle.eC');
  ok(kl(eS.x, eS.y) && solidS(eS.x, eS.y), 'Selbstschussanlage (passiv): Server und Client-Vorhersage blockieren die Kachel');
  ok(kl(eV.x, eV.y) && solidS(eV.x, eV.y), 'enthüllte Anlage (eV): beide blockieren');
  ok(!kl(eP.x, eP.y) && !solidS(eP.x, eP.y), 'Druckfeld-Falle: beide lassen die Kachel frei');
  ok(!kl(eC.x, eC.y) && !solidS(eC.x, eC.y), 'Schottfalle: beide lassen die Kachel frei');
  ok(!sicht(eS.x, eS.y), 'Sicht, Nebel und Deckung (solidFn) kennen die Box nicht: Sicht und Schuss gehen durch die Anlage');
  let diff = 0;
  for (let ty = 0; ty < M.h; ty++) for (let tx = 0; tx < M.w; tx++) if (!!kl(tx, ty) !== !!solidS(tx, ty)) diff++;
  ok(diff === 0, 'alle ' + (M.w * M.h) + ' Kacheln der Karte: Client-Vorhersage = Server (Abweichungen: ' + diff + ')');
  // ITM-01 G (S1): eine noch verborgene Anlage (eW) blockiert weder auf dem Server noch in der Vorhersage; sie blockiert erst ab dem Enthüllen (beide)
  const M2 = reg(mapEv);
  const kl2 = R.buehneBewegungSolid(M2, st);
  const eW = S.an('falle.eW');
  ok(Anker.zustand(g, id, 'falle.eW') === 'verborgen' && !kl2(eW.x, eW.y) && !solidS(eW.x, eW.y), 'verborgene Anlage (eW): Server und Client-Vorhersage lassen die Kachel frei (die Box verriete die Falle)');
  let diff2 = 0;
  for (let ty = 0; ty < M2.h; ty++) for (let tx = 0; tx < M2.w; tx++) if (!!kl2(tx, ty) !== !!solidS(tx, ty)) diff2++;
  ok(diff2 === 1 && !!kl2(eV.x, eV.y) !== !!solidS(eV.x, eV.y), 'Kachelvergleich mit frischer Client-Liste (ohne die schon enthüllte eV): nur eV unterscheidet sich, die verborgene eW nicht (' + diff2 + ')');
  {   // schräges Zulaufen auf die verborgene Anlage (wie die Reviewer-Probe corner.js): bis zur Auslösung 0 Abweichungen, die Figur wird nie von der Box gestreift
    const hb = CONFIG.player.hitbox, R0 = CONFIG.anker.falle.radius.schuss * TILE, cx = eW.x * TILE + TILE / 2, cy = eW.y * TILE + TILE / 2;
    let laeufe = 0, abw = 0, ticks = 0;
    for (let off = -40; off <= 40; off++) {
      laeufe++;
      let s = { x: cx + 80 + off, y: cy + 80 - off };
      for (let i = 0; i < 200; i++) {
        if (Math.hypot(s.x - cx, s.y - cy) <= R0) break;
        const a = Physics.moveWithCollision(solidS, s.x, s.y, -1.5, -1.5, hb), b = Physics.moveWithCollision(kl2, s.x, s.y, -1.5, -1.5, hb);
        ticks++;
        if (a.x !== b.x || a.y !== b.y) abw++;
        s = a;
      }
    }
    ok(laeufe === 81 && ticks > 2000 && abw === 0, 'schräges Zulaufen (81 Läufe, ' + ticks + ' Schritte) auf die verborgene Anlage: 0 Abweichungen Server gegen Client (' + abw + ')');
  }
  ok(FALLE_RADIUS_VOR_BOX(), 'die Auslösezone der Anlage (' + CONFIG.anker.falle.radius.schuss + ' Kachel) liegt vor der Box: die Falle wird enthüllt, bevor die Figur sie berührt');
  {   // Auslösen enthüllt: ab da blockieren beide (der Client nach dem Ereignis), und die Figur bleibt nicht in der Box stecken
    const fW = { id: 'falle.eW', x: eW.x, y: eW.y, px: eW.x * TILE + TILE / 2, py: eW.y * TILE + TILE / 2, typ: 'schuss', sicht: 'verborgen', start: 'verborgen' };
    // Figur steht beim Auslösen am Rand der Zone auf der Diagonalen (0,9 Kachel Abstand = schon ~5 px in der Box-Ecke): beim Enthüllen wird sie auf die freie Seite geschoben
    const hb = CONFIG.player.hitbox, R0 = CONFIG.anker.falle.radius.schuss * TILE;
    S.p.x = fW.px + R0 * 0.7071; S.p.y = fW.py + R0 * 0.7071; S.p.input.mx = 0; S.p.input.my = 0;
    const vorX = S.p.x, vorY = S.p.y;
    ok(Physics.boxHits((tx, ty) => tx === eW.x && ty === eW.y, S.p.x, S.p.y, hb.w, hb.h), 'Vorbereitung: die Figur überlappt die Box-Kachel (Randfall)');
    Anker.setzen(g, id, 'falle.eW', 'erkannt', S.p.id);   // enthüllt (Scanner); kein Auslösen, damit keine Salve die späteren Läufe stört
    const solidNach = interior.awaySolid(g);
    const geschoben = Math.hypot(S.p.x - vorX, S.p.y - vorY), draussen = !Physics.boxHits(solidNach, S.p.x, S.p.y, hb.w, hb.h);
    const px = S.p.x, py = S.p.y;
    S.hin(5, 2);   // aus der Zone, dann das Ereignis zustellen
    S.lauf(0.2);
    const evW = S.neu().filter((e) => e.t === 'event' && e.kind === 'ankerEnthuellt' && e.anker[0] === 'falle.eW');
    ok(evW.length === 1 && solidNach(eW.x, eW.y), 'ausgelöst: Ereignis ankerEnthuellt und Box auf dem Server');
    const M3 = reg(mapEv); for (const e of evEnth) R.ankerEnthuellt(e);
    ok(R.ankerEnthuellt(evW[0]) === 'neu' && R.buehneBewegungSolid(M3, S.snap())(eW.x, eW.y) === true, 'ausgelöst: nach dem Ereignis blockiert auch die Vorhersage (gleicher Zeitpunkt wie der Server)');
    evEnth.push(evW[0]);
    ok(draussen && geschoben > 0 && geschoben < 8, 'beim Enthüllen aus der Box geschoben (' + Math.round(geschoben * 10) / 10 + ' px), nicht eingeklemmt');
    let s = { x: px, y: py };
    for (let i = 0; i < 60; i++) s = Physics.moveWithCollision(solidNach, s.x, s.y, 1.5, 1.5, hb);
    ok(Math.hypot(s.x - fW.px, s.y - fW.py) > R0, 'danach kommt die Figur frei weg (bewegt sich von der Anlage fort)');
  }
  M = reg(mapEv); for (const e of evEnth) R.ankerEnthuellt(e);
}
function FALLE_RADIUS_VOR_BOX() { const hb = CONFIG.player.hitbox; return CONFIG.anker.falle.radius.schuss * TILE > (TILE / 2 + Math.min(hb.w, hb.h) / 2) && CONFIG.anker.falle.radius.schuss * TILE > (TILE / 2 + hb.w / 2); }

section('Bewegung: Client-Vorhersage Schritt für Schritt gegen die echte Serverposition (kein Ruckeln)');
{
  const kl = R.buehneBewegungSolid(M, S.snap());
  const ohne = R.solidFn(M, S.snap());
  const eS = S.an('falle.eS');
  const hb = CONFIG.player.hitbox, V = speedAbgeleitet();   // V = Gehgeschwindigkeit des Servers (px/s), aus einem freien Tick gemessen
  // Start 3 Kacheln von der Anlage entfernt (8/4 -> Arena-Koordinaten dx 8, dy 4), je Richtung
  const starts = [[5, 4, 1, 0], [11, 4, -1, 0], [8, 1, 0, 1], [8, 7, 0, -1], [5, 1, 0.7071, 0.7071], [11, 7, -0.7071, -0.7071], [11, 1, -0.7071, 0.7071], [5, 7, 0.7071, -0.7071]];
  let schritte = 0, abw = 0, ziel = 0, ohneBoxDurch = 0;
  for (const [dx, dy, mx, my] of starts) {
    // jedes Mal frische Anlage (nicht ausgelöst): zurücksetzen
    delete aw.zustaende['falle.eS'];
    S.hin(dx, dy);
    S.p.input.mx = mx; S.p.input.my = my;
    for (let i = 0; i < 70; i++) {
      const vor = { x: S.p.x, y: S.p.y };
      g.away.drones.length = 0; g.step();
      S.p.input.mx = mx; S.p.input.my = my;
      // Client: dieselbe Bewegung mit der Vorhersage-Solid, aus der Serverposition davor (ein Schritt = ein Tick)
      schritte++;
      const r = Physics.moveWithCollision(kl, vor.x, vor.y, mx * V * DT, my * V * DT, hb);
      if (Math.abs(r.x - S.p.x) > 0.001 || Math.abs(r.y - S.p.y) > 0.001) abw++;
      const r2 = Physics.moveWithCollision(ohne, vor.x, vor.y, mx * V * DT, my * V * DT, hb);
      if (Math.abs(r2.x - S.p.x) > 0.001 || Math.abs(r2.y - S.p.y) > 0.001) ohneBoxDurch++;
    }
    const d = Math.hypot(S.p.x - (eS.x * TILE + TILE / 2), S.p.y - (eS.y * TILE + TILE / 2));
    if (d >= 21.9) ziel++;
  }
  ok(schritte === starts.length * 70 && abw === 0, schritte + ' Schritte aus 8 Richtungen in die Anlage: Client-Vorhersage = Serverposition in jedem Tick (Abweichungen: ' + abw + ')');
  ok(ohneBoxDurch > 0, 'Gegenprobe: ohne die Box (nur solidFn) liefe der Client in die Anlage und würde zurückgesetzt (' + ohneBoxDurch + ' abweichende Schritte)');
  ok(ziel === starts.length, 'die Figur kommt der Anlagenmitte nie näher als die Box erlaubt (' + ziel + ' von ' + starts.length + ')');
}
// effektive Gehgeschwindigkeit aus der Serverbewegung auf freier Fläche ableiten (Geschwindigkeit = Strecke je Tick auf freiem Boden)
function speedAbgeleitet() {
  if (speedAbgeleitet.v) return speedAbgeleitet.v;
  S.hin(2, 2); S.p.input.mx = 1; S.p.input.my = 0;   // (1,1) trägt die verborgene Anlage eW
  g.away.drones.length = 0; g.step();
  const x0 = S.p.x; g.away.drones.length = 0; g.step();
  S.p.input.mx = 0;
  speedAbgeleitet.v = (S.p.x - x0) / DT;
  return speedAbgeleitet.v;
}

// ======================================================================
section('Zeichnen: Feld-Overlay an/aus, 2D-Platten je Zustand, Schuss-Strahl, Restzeit');
const flaeche = () => {
  const ops = [], stl = { fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1 }, dash = [];
  const f = { ops, stl, dash };
  const rec = (op) => (...a) => { ops.push({ op, a, fs: stl.fillStyle, ss: stl.strokeStyle, alpha: stl.globalAlpha, lw: stl.lineWidth, dash: dash.slice() }); };
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'measureText') return (s) => ({ width: String(s).length * 5 });
      if (k === 'setLineDash') return (d) => { dash.length = 0; dash.push(...d); };
      if (k in stl) return stl[k];
      if (['createLinearGradient', 'createRadialGradient'].includes(k)) return () => ({ addColorStop() {} });
      return rec(String(k));
    },
    set: (t, k, v) => { stl[k] = v; return true; },
  });
  f.ctx = ctx; return f;
};
const P1 = (x, y, h) => ({ x: x / 2, y: y / 2 - (h || 0) });
const rot = (s) => /rgba\(224,71,60/.test(String(s)) || s === '#E0473C';
{
  const stA = { away: { map: id, ao: [] } };
  R.fallenEreignis({ kind: 'falleFeld', map: id, anker: 'falle.eP', typ: 'druck', an: 1, dauer: 20, x: 100, y: 100, rect: [2, 3, 6, 4] });
  let f = flaeche(); R.drawFallenFelder(f.ctx, stA, P1, 1.0);
  const pfad = f.ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');
  ok(pfad.length >= 4 && pfad[0].a[0] === 2 * TILE / 2 && pfad[0].a[1] === 3 * TILE / 2 && pfad[2].a[0] === 8 * TILE / 2 && pfad[2].a[1] === 7 * TILE / 2, 'Feld an (rect [2,3,6,4]): das Polygon liegt auf den vier Ecken des Rechtecks (Kachelrand, über P projiziert)');
  ok(f.ops.some((o) => o.op === 'fill' && rot(o.fs)) && f.ops.some((o) => o.op === 'stroke' && rot(o.ss) && o.dash.length === 2), 'Feld an: rote Füllung und gestrichelter roter Rand (Form + Farbe)');
  const fuellung = f.ops.find((o) => o.op === 'fill' && rot(o.fs));
  const a = +/,([\d.]+)\)$/.exec(fuellung.fs)[1];
  ok(a > 0 && a <= 0.16, 'Füllung dünn (Alpha ' + a + ' ≤ 0,16): die Sicht bleibt frei');
  ok(f.ops.some((o) => o.op === 'fillText' || o.op === 'fillRect'), 'Feld an: Beschriftung mit Restzeit am Rand');
  ok(R.fallenLaufend(stA).length === 1 && R.fallenLaufend(stA)[0].art === 'feld' && R.fallenLaufend(stA)[0].rest === 20 && R.fallenLaufend(stA)[0].name === 'DRUCKVERLUST', 'Lagezeile: DRUCKVERLUST, Restzeit 20 s');
  f = flaeche(); R.drawFallenFelder(f.ctx, { away: { map: 'andere' } }, P1, 1.0);
  ok(f.ops.length === 0 && R.fallenLaufend({ away: { map: 'andere' } }).length === 0, 'Feld einer anderen Karte: nichts gezeichnet, keine Lagezeile');
  R.fallenEreignis({ kind: 'falleFeld', map: id, anker: 'falle.eP', typ: 'druck', an: 0, dauer: 20 });
  f = flaeche(); R.drawFallenFelder(f.ctx, stA, P1, 1.0);
  ok(f.ops.length === 0 && R.fallenLaufend(stA).length === 0, 'Feld aus (an 0): Overlay und Lagezeile weg');
  R.fallenEreignis({ kind: 'falleFeld', map: id, anker: 'falle.eR', typ: 'dorn', an: 1, dauer: 8, x: 200, y: 200, r: 2.5 });
  f = flaeche(); R.drawFallenFelder(f.ctx, stA, P1, 1.0);
  ok(f.ops.filter((o) => o.op === 'lineTo').length >= 27 && R.fallenLaufend(stA)[0].name === 'GEFAHRENFELD', 'Kreisfeld (r Kacheln, neue Variante dorn): Vieleck, Name GEFAHRENFELD (bis ein Eintrag steht)');
  R.fallenEreignis({ kind: 'falleFeld', map: id, anker: 'falle.eR', typ: 'dorn', an: 0 });
  // Schott: Zeile mit Restzeit
  R.fallenEreignis({ kind: 'falleSchott', map: id, anker: 'falle.eC', kanten: ['k1', 'k2'], dauer: 20, an: 1 });
  const ls = R.fallenLaufend(stA);
  ok(ls.length === 1 && ls[0].art === 'schott' && ls[0].name === 'SCHOTTS GESPERRT' && ls[0].rest === 20, 'falleSchott an: Lagezeile „SCHOTTS GESPERRT“ mit Restzeit');
  R.fallenEreignis({ kind: 'falleSchott', map: id, anker: 'falle.eC', kanten: ['k1', 'k2'], dauer: 20, an: 0 });
  ok(R.fallenLaufend(stA).length === 0, 'falleSchott aus: Zeile weg');
  // Marken entfallen (ITM-02 D): der Zustand steht im Modell. Der 2D-Rückfall (drawFalle2d) zeichnet je Zustand und Typ eine eigene symbolfreie Platte.
  const d2 = (z, typ) => { const q = flaeche(); R.drawFalle2d(q.ctx, ['falle.x', 'falle', 3, 3, { typ }], z, 100, 100); return q.ops; };
  const sig = (ops) => ops.map((o) => [o.op, o.a.join(','), o.fs, o.ss].join('~')).join('|');
  const TYPEN = ['schott', 'druck', 'schuss'], ZUST = ['erkannt', 'entschaerft', 'ausgeloest'];
  ok(TYPEN.every((t) => d2('verborgen', t).length === 0), 'drawFalle2d verborgen: keine Zeichnung (verrät die Falle nicht)');
  ok(TYPEN.every((t) => new Set(ZUST.map((z) => sig(d2(z, t)))).size === 3), 'drawFalle2d: je Typ drei verschiedene Zeichnungen (erkannt / entschärft / ausgelöst)');
  ok(ZUST.every((z) => new Set(TYPEN.map((t) => sig(d2(z, t)))).size === 3), 'drawFalle2d: je Zustand drei verschiedene Formen (schott / druck / schuss), die Form trägt den Typ');
  ok(TYPEN.every((t) => ZUST.every((z) => !d2(z, t).some((o) => o.op === 'lineTo' || o.op === 'moveTo' || o.op === 'closePath'))), 'drawFalle2d: kein Pfad mit Ecken, also kein Dreieck und kein Kreuz');
  ok(TYPEN.every((t) => ZUST.every((z) => !d2(z, t).some((o) => o.op === 'fillText' || (o.op === 'fillRect' && o.fs === '#F6E7E4')))), 'drawFalle2d: weder Text noch Glyphe');
  const farben = (ops) => new Set(ops.filter((o) => o.op === 'fillRect' || o.op === 'fill').map((o) => String(o.fs).toUpperCase()));
  ok(TYPEN.every((t) => farben(d2('erkannt', t)).has('#E84030') && farben(d2('erkannt', t)).has('#FFC4A8')), 'drawFalle2d erkannt: Fallenrot mit hellem Kern (#FFC4A8)');
  ok(TYPEN.every((t) => ['entschaerft', 'ausgeloest'].every((z) => { const c = farben(d2(z, t)); return !c.has('#E84030') && !c.has('#FFC4A8'); })), 'drawFalle2d entschärft/ausgelöst: kein Fallenrot und kein heller Kern (nichts leuchtet, kein roter Punkt an der Mündung)');
  ok(TYPEN.every((t) => ZUST.every((z) => d2(z, t).every((o) => !['fillRect', 'strokeRect'].includes(o.op) || (o.a[2] >= 2 && o.a[3] >= 2)))), 'drawFalle2d: keine Fläche unter 2 px');
  // Helligkeit je Zustand (Graustufen, über die 32-px-Kachel gemittelt): erkannt > entschärft > ausgelöst, deutlich. Die Messfläche entsteht aus den echten Zeichenoperationen
  // (fillRect, strokeRect, arc + fill, später überdeckt früher), nicht aus Konstanten im Quelltext; das rote Auge der Anlage ist ein Kreis.
  const lum = (ops) => {
    const g = new Float64Array(32 * 32), L = (h) => { const m = /^#([0-9a-f]{6})$/i.exec(String(h)); if (!m) return null; const n = parseInt(m[1], 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
    const punkt = (x, y, l) => { x -= 100; y -= 100; if (x >= 0 && x < 32 && y >= 0 && y < 32) g[y * 32 + x] = l; };
    let kreis = null;
    for (const o of ops) {
      if (o.op === 'beginPath') kreis = null;
      else if (o.op === 'arc') kreis = o.a;
      else if (o.op === 'fill' && kreis) { const l = L(o.fs); if (l != null) for (let y = Math.floor(kreis[1] - kreis[2]); y <= Math.ceil(kreis[1] + kreis[2]); y++) for (let x = Math.floor(kreis[0] - kreis[2]); x <= Math.ceil(kreis[0] + kreis[2]); x++) if ((x + 0.5 - kreis[0]) ** 2 + (y + 0.5 - kreis[1]) ** 2 <= kreis[2] ** 2) punkt(x, y, l); }
      else if (o.op === 'fillRect') { const l = L(o.fs); if (l != null) for (let y = o.a[1]; y < o.a[1] + o.a[3]; y++) for (let x = o.a[0]; x < o.a[0] + o.a[2]; x++) punkt(x, y, l); }
      else if (o.op === 'strokeRect') { const l = L(o.ss); if (l == null) continue; const [x, y, w, h] = o.a, d = o.lw / 2; for (let yy = Math.floor(y - d); yy < Math.ceil(y + h + d); yy++) for (let xx = Math.floor(x - d); xx < Math.ceil(x + w + d); xx++) if (xx < x + d || xx >= x + w - d || yy < y + d || yy >= y + h - d) punkt(xx, yy, l); }
    }
    return g.reduce((s, v) => s + v, 0) / g.length;
  };
  ok(d2('erkannt', 'schuss').some((o) => o.op === 'arc') && d2('erkannt', 'schuss').some((o) => o.op === 'strokeRect'), 'Messfläche: schuss zeichnet Kreis (Auge) und Rahmen, beides geht in die Helligkeit ein');
  for (const t of ['schott', 'druck', 'schuss']) { const l = ZUST.map((z) => lum(d2(z, t))); ok(l[0] - l[1] >= 5 && l[1] - l[2] >= 5, 'drawFalle2d ' + t + ': Helligkeit erkannt > entschärft > ausgelöst (' + l.map((v) => v.toFixed(0)).join(' > ') + ')'); }
  // Quelltext: keine Marke mehr, weder im Voxel-Overlay noch im 2D-Rückfall
  {
    const rq = read('public/js/render.js');
    ok(!/drawFalleMarke/.test(rq) && !R.drawFalleMarke, 'drawFalleMarke ist entfernt (Quelltext und Export)');
    const ovStart = rq.indexOf('ITM-01 E: Fallen im Voxel-Modus'), ov = rq.slice(rq.lastIndexOf(String.fromCharCode(10), ovStart) + 1, rq.indexOf("report('Render.fallen3d'"));
    // positive Liste: im Overlay-Block darf für Fallen nur dies gerufen werden (ein Dreieck über shape(), ctx.arc, Pfad oder Text fiele sofort auf)
    const aufrufe = [...ov.replace(/\/\/[^\n]*/g, '').matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)].map((m) => m[1]).filter((n) => !['if', 'for', 'catch', 'while', 'switch'].includes(n));
    const erlaubt = ['drawFallenFelder', 'drawFallenSchotts', 'drawFallenBlitze', 'isBuehne', 'report'];
    ok(ov.length > 100 && ['drawFallenFelder', 'drawFallenSchotts', 'drawFallenBlitze'].every((n) => aufrufe.includes(n)) && aufrufe.every((n) => erlaubt.includes(n)), 'Voxel-Overlay: Feld, Schott und Strahl bleiben, sonst kein Aufruf (keine Marke, kein Dreieck über shape/arc/Pfad, kein Kreuz); gefunden: ' + [...new Set(aufrufe)].join(', '));
    ok(!/falleSchwebe|falleGlyphe|drawFalle(2d|Marke)/.test(ov), 'Voxel-Overlay: ruft weder Glyphe noch Schwebehöhe noch 2D-Platte');
    const f2 = rq.slice(rq.indexOf('function drawFalle2d'), rq.indexOf('ITM-01 F: gesperrte Schotts'));
    ok(f2.length > 500 && !/moveTo|lineTo|closePath|falleGlyphe|fillText/.test(f2), 'drawFalle2d (Quelltext): keine Pfade mit Ecken, keine Glyphe');
    ok(/drawFalle2d\(ctx, a, z, px, py\); return; \}/.test(rq), 'Einhängestelle: der 2D-Rückfall der Anker ruft drawFalle2d');
  }
  // Schuss
  R.fallenEreignis({ kind: 'selbstschuss', map: id, anker: 'falle.eS', i: 0, x: 400, y: 200, tx: 600, ty: 300, pid: 'p' });
  f = flaeche(); R.drawFallenBlitze(f.ctx, stA, P1, 32);
  const ln = f.ops.filter((o) => o.op === 'lineTo');
  ok(ln.length >= 2 && ln[0].a[0] === 300 && ln[0].a[1] === 150 - 14 && f.ops.some((o) => o.op === 'moveTo' && o.a[0] === 200 && o.a[1] === 100 - 18), 'Selbstschuss: Strahl von der Anlage (x,y, Höhe 18) zum Getroffenen (tx,ty, Höhe 14)');
  const strahl = f.ops.find((o) => o.op === 'stroke' && rot(o.ss));
  ok(strahl && strahl.lw >= 5, 'Selbstschuss: Strahl dick genug (' + (strahl && strahl.lw.toFixed(1)) + ' px beim Abfeuern, Review: im Voxel-Bild zu dünn)');
  ok(f.ops.some((o) => o.op === 'arc' && o.a[2] >= 7.5), 'Selbstschuss: Mündungsblitz größer (Radius ≥ 7,5 px beim Abfeuern)');
  f = flaeche(); R.drawFallenBlitze(f.ctx, { away: { map: 'andere' } }, P1, 32);
  ok(f.ops.length === 0, 'Schuss einer anderen Karte: nicht gezeichnet');
  R.fallenEreignis({ kind: 'falleAusgeloest', map: id, x: 500, y: 500 });
  f = flaeche(); R.drawFallenBlitze(f.ctx, stA, P1, 32);
  ok(f.ops.some((o) => o.op === 'ellipse'), 'Auslösen: Ring an der Falle');
}

// ======================================================================
section('ITM-01 F: gesperrtes Schott ist sichtbar (2D und Voxel), blendet in 0,3 s aus, Minikarte zeigt rote Striche');
{
  // Karte mit einer Schott-Kante (zwei Kacheln in einer Zeile); Zustände wie kacheln.json (zu, offen, gehackt, verschlossen)
  const info = (x, y) => (y === 5 && (x === 3 || x === 4) ? { kind: 'schott', solid: 'zustand', zustaende: ['zu', 'offen', 'gehackt', 'verschlossen'], begehbarIn: ['offen', 'gehackt'] } : (y === 5 ? { kind: 'wand', solid: true } : { kind: 'boden', solid: false }));
  win.Shared_Maps['t.schott'] = { id: 't.schott', buehne: true, w: 10, h: 10, anker: [], kanten: [['k.s', [[3, 5], [4, 5]], 0]], kanteAt: new Map(), ankerAt: new Map(), info };
  const stZu = { away: { map: 't.schott', ao: [], ko: [] } }, stOffen = { away: { map: 't.schott', ao: [], ko: [[0, 1]] } };
  let T = 1000;
  win.performance = { now: () => T };
  const Pw = (x, y, h) => ({ x: x / 2, y: y / 2 - (h || 0) });
  const zeichne = (st, hoch) => { const q = flaeche(); R.drawFallenSchotts(q.ctx, st, Pw, 1.0, 1, hoch); return q.ops; };
  ok(R.fallenSchottStand(stZu).length === 0 && zeichne(stZu, false).length === 0, 'ohne Ereignis falleSchott: nichts gesperrt, nichts gezeichnet');
  R.fallenEreignis({ kind: 'falleSchott', map: 't.schott', anker: 'falle.eT', kanten: ['k.s'], dauer: 20, an: 1 });
  T += 200; R.fallenSchottStand(stZu); T += 200;
  const s1 = R.fallenSchottStand(stZu);
  ok(s1.length === 1 && s1[0].kid === 'k.s' && s1[0].a === 1 && s1[0].ori === 'h' && s1[0].kacheln.length === 2, 'falleSchott an + Kante zu: eine gesperrte Kante, voll sichtbar, liegt in einer Zeile');
  const o2 = zeichne(stZu, false);
  ok(o2.some((o) => o.op === 'stroke' && rot(o.ss) && o.lw === 2), '2D: Schott-Kachel mit 2-px-Kontur in PAL.red');
  ok(o2.some((o) => o.op === 'stroke' && /^rgba\(224,71,60,0\.300\)$/.test(String(o.ss))), '2D: Schraffur in PAL.red mit Alpha 0,3');
  ok(!o2.some((o) => o.op === 'fillRect' && o.fs === '#F6E7E4') && !o2.some((o) => o.op === 'fill' && o.fs === 'rgba(11,14,26,0.85)'), '2D: kein Warndreieck und keine II-Glyphe mehr auf der Kante');
  ok(o2.some((o) => o.op === 'clip'), '2D: Schraffur auf die Fläche beschnitten');
  const xs = o2.filter((o) => o.op === 'moveTo' || o.op === 'lineTo').map((o) => o.a[0]);
  ok(Math.min(...xs) <= 3 * TILE / 2 && Math.max(...xs) >= 5 * TILE / 2, '2D: die Fläche deckt beide Kacheln der Kante (x ' + Math.min(...xs) + '..' + Math.max(...xs) + ')');
  const o3 = zeichne(stZu, true);
  ok(o3.length > o2.length && o3.some((o) => o.op === 'fill' && o.fs === 'rgba(224,71,60,1.000)'), 'Voxel: zusätzlich rotes Leuchtband an der Oberkante (volles PAL.red)');
  ok(o3.some((o) => o.op === 'fill' && /^rgba\(16,10,12/.test(String(o.fs))) && o3.some((o) => o.op === 'stroke' && /^rgba\(224,71,60,0\.9/.test(String(o.ss))), 'Voxel: Blattfläche dunkel mit roten Schrägstreifen');
  ok(!o3.some((o) => o.op === 'fillRect' && o.fs === '#F6E7E4') && !o3.some((o) => o.op === 'fill' && o.fs === 'rgba(11,14,26,0.85)'), 'Voxel: kein schwebendes Warndreieck mit II');
  T += 100;
  ok(zeichne(stOffen, false).every((o) => !(o.op === 'stroke' && o.alpha === 1 && rot(o.ss) && o.lw === 2 && /^rgba\(224,71,60,1\.000\)$/.test(String(o.ss)))) && R.fallenSchottStand(stOffen).length === 1, 'Kante geöffnet (Hacken): die Anzeige fällt in die Ausblendung (0,3 s), nicht mehr voll');
  T += 400;
  ok(R.fallenSchottStand(stOffen).length === 0, 'nach 0,3 s ausgeblendet und aufgeräumt');
  T += 300; R.fallenSchottStand(stZu); T += 300;
  ok(R.fallenSchottStand(stZu)[0].a === 1, 'Kante wieder gesperrt (Ereignis noch aktiv): voll sichtbar');
  R.fallenEreignis({ kind: 'falleSchott', map: 't.schott', anker: 'falle.eT', kanten: ['k.s'], dauer: 20, an: 0 });
  T += 150; const mitte = R.fallenSchottStand(stZu);
  ok(mitte.length === 1 && mitte[0].a > 0.3 && mitte[0].a < 0.7, 'Öffnen (Ereignis an 0): nach 0,15 s halb ausgeblendet (a ' + (mitte[0] && mitte[0].a.toFixed(2)) + ')');
  ok(zeichne(stZu, false).some((o) => o.op === 'stroke' && /^rgba\(224,71,60,0\.[3-6]/.test(String(o.ss)) && o.lw === 2), 'halbe Kontur beim Ausblenden');
  T += 200;
  ok(R.fallenSchottStand(stZu).length === 0, 'nach 0,3 s weg');
  R.fallenEreignis({ kind: 'falleSchott', map: 't.schott', anker: 'falle.eT', kanten: ['k.s'], dauer: 20, an: 1 });
  ok(R.fallenSchottStand({ away: { map: 'andere', ao: [] } }).length === 0, 'andere Karte: nichts gesperrt');
  // Minikarte: rote Striche
  T += 500; R.fallenSchottStand(stZu); T += 300;
  const mq = flaeche(); R.miniSchotts(mq.ctx, stZu, (tx, ty) => ({ x: tx * 3, y: ty * 3 }));
  const mm = mq.ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo'), ms = mq.ops.find((o) => o.op === 'stroke');
  ok(mm.length === 2 && mm[0].a[0] === 9 && mm[1].a[0] === 15 && mm[0].a[1] === mm[1].a[1] && rot(ms.ss) && ms.lw === 2, 'Minikarte: ein roter 2-px-Strich über beide Kacheln der Kante (PAL.red)');
  const mq2 = flaeche(); R.miniSchotts(mq2.ctx, { away: { map: 'andere', ao: [] } }, (tx, ty) => ({ x: tx, y: ty }));
  ok(mq2.ops.length === 0, 'Minikarte: andere Karte ohne Strich');
  R.fallenEreignis({ kind: 'falleSchott', map: 't.schott', anker: 'falle.eT', kanten: ['k.s'], dauer: 20, an: 0 });
  T += 1000; R.fallenSchottStand(stZu);
  // Die echten Kartenzeichner (nicht nur der Quelltext): Kommandokarte und Minikarte der gebauten Karte mit einer Schott-Kante, gesperrt über das Ereignis
  {
    const Mr = reg(mapEv), o0 = Mr.info.bind(Mr), KX = 5, KY = 5;
    Mr.kanten = (Mr.kanten || []).concat([['k.t', [[KX, KY], [KX + 1, KY]], 0]]);
    Mr.info = (x, y) => (y === KY && (x === KX || x === KX + 1) ? { kind: 'schott', solid: 'zustand', zustaende: ['zu', 'offen', 'gehackt', 'verschlossen'], begehbarIn: ['offen', 'gehackt'] } : o0(x, y));
    const sn = S.snap(); sn.away.ko = []; sn.away.ao = [];
    const view = { state: sn, time: 1, drones: [], players: [], npcs: [], me: null };
    R.fallenEreignis({ kind: 'falleSchott', map: id, anker: 'falle.eC', kanten: ['k.t'], dauer: 20, an: 1 });
    T += 300; R.fallenSchottStand(sn); T += 300;
    const kq = flaeche();
    let fehler = null;
    try { R.drawAwayCommandMap(kq.ctx, view, { x: 0, y: 0, w: 400, h: 300 }, {}); } catch (e) { fehler = e; }
    ok(!fehler && kq.ops.some((o) => o.op === 'stroke' && rot(o.ss) && o.lw === 2), 'Kommandokarte (echter Zeichner): gesperrtes Schott als roter 2-px-Strich' + (fehler ? ' – ' + fehler.message : ''));
    const mp = flaeche(); fehler = null;
    try { R.drawMiniPlan(mp.ctx, view, 0, 0, { zone: 'away', cell: 3 }); } catch (e) { fehler = e; }
    ok(!fehler && mp.ops.some((o) => o.op === 'stroke' && rot(o.ss) && o.lw === 2), 'Minikarte (echter Zeichner): gesperrtes Schott als roter 2-px-Strich' + (fehler ? ' – ' + fehler.message : ''));
    // Scan-Marker: eine Falle bekommt auf den Karten KEINE Eisblau-Raute (nur ihr rotes Dreieck), ein Erz schon
    win.ScanAnzeige = SA; SA.store.daten = DATEN;
    const eis = (q) => q.ops.filter((o) => o.op === 'fill' && o.fs === '#A9D6E5').length;
    const mitSc = (sc) => Object.assign({}, sn, { away: Object.assign({}, sn.away, { sc }) });
    const vF = Object.assign({}, view, { state: mitSc([['falle.eC', 'falle', 'schott', 2, 200, 200]]) }), vE = Object.assign({}, view, { state: mitSc([['erz.t', 'erz', 'testerz', 2, 200, 200]]) });
    const kF = flaeche(), kE = flaeche(); R.drawAwayCommandMap(kF.ctx, vF, { x: 0, y: 0, w: 400, h: 300 }, {}); R.drawAwayCommandMap(kE.ctx, vE, { x: 0, y: 0, w: 400, h: 300 }, {});
    ok(eis(kE) > 0 && eis(kF) === 0, 'Kommandokarte: Erz-Marker mit Eisblau-Raute, Falle ohne (auf der Karte nur miniFalle, kein Label)');
    const nF = flaeche(), nE = flaeche(); R.drawMiniPlan(nF.ctx, vF, 0, 0, { zone: 'away', cell: 3 }); R.drawMiniPlan(nE.ctx, vE, 0, 0, { zone: 'away', cell: 3 });
    ok(eis(nE) > 0 && eis(nF) === 0, 'Minikarte: Erz-Marker eisblau, Falle nicht (Fallen sind auf der Minikarte immer rot)');
    // Falle auf den Karten immer PAL.red: erkannt gefülltes rotes Dreieck, entschärft grau, ausgelöst rotes Kreuz
    const mf = (z) => { const q = flaeche(); R.miniFalle(q.ctx, 50, 50, 3, z); return q.ops; };
    ok(mf('erkannt').some((o) => o.op === 'fill' && o.fs === '#E0473C') && mf('ausgeloest').some((o) => o.op === 'stroke' && o.ss === '#E0473C') && !mf('entschaerft').some((o) => rot(o.ss) || rot(o.fs)) && mf('verborgen').length <= 2, 'Minikarte: Falle erkannt rot (gefüllt), ausgelöst rotes Kreuz, entschärft grau (kein Rot), verborgen nichts');
    R.fallenEreignis({ kind: 'falleSchott', map: id, anker: 'falle.eC', kanten: ['k.t'], dauer: 20, an: 0 });
    T += 1000; R.fallenSchottStand(sn); T += 1000; R.fallenSchottStand(sn);
    const kq2 = flaeche(); R.drawAwayCommandMap(kq2.ctx, view, { x: 0, y: 0, w: 400, h: 300 }, {});
    const striche = (q) => q.ops.filter((o) => o.op === 'stroke' && rot(o.ss) && o.lw === 2).length;
    ok(striche(kq) > striche(kq2), 'nach dem Öffnen und Ausblenden ein Strich weniger in der Kommandokarte (' + striche(kq) + ' -> ' + striche(kq2) + ')');
  }
  win.performance = performance;
  const rtxt = read('public/js/render.js');
  ok(/drawFallenSchotts\(ctx, st, \(x, y, h\) => \(\{ x: Math\.round\(x - camX\)[^\n]*, t, 1, false\);/.test(rtxt) && /drawFallenSchotts\(ctx, st, P, t, ppm \/ 32, true\);/.test(rtxt), 'Einhängestellen: 2D-Bodenansicht und Voxel-Overlay rufen drawFallenSchotts');
  ok(/miniSchotts\(ctx, st, \(tx, ty\) => \(\{ x: x \+ tx \* c/.test(rtxt) && /miniSchotts\(ctx, st, \(tx, ty\) => \(\{ x: Math\.round\(ox \+ tx \* c\)/.test(rtxt), 'Einhängestellen: Minikarte und Kommandokarte zeichnen gesperrte Schotts');
  { const fs0 = rtxt.indexOf('function drawFallenSchotts'), fs1 = rtxt.indexOf('function miniSchotts'); ok(fs0 > 0 && fs1 > fs0 && !/falleGlyphe|Warndreieck|F6E7E4/.test(rtxt.slice(fs0, fs1)), 'drawFallenSchotts (Quelltext): keine Glyphe, kein Dreieck'); }
  ok(/name: 'SCHOTTS GESPERRT'/.test(rtxt), 'Bernstein-Zeile „SCHOTTS GESPERRT“ bleibt');
}

// ======================================================================
section('Scan-Anzeige: Positionstext der Falle (Stufe 2), andere Arten unverändert (Stufe 3), Marker');
{
  const posFalle = DATEN.arten.falle.positionAb;
  ok(posFalle === CONFIG.anker.falle.position, 'Content positionAb der Art Falle (' + posFalle + ') = CONFIG.anker.falle.position (' + CONFIG.anker.falle.position + ')');
  const blatt = (e) => SA.blatt(SA.zeile(e, DATEN), 32);
  const b1 = blatt({ id: 'f1', art: 'falle', typ: 'druck', sk: 1 });
  ok(b1.position === 'Position: erst ab Stufe 2' && !b1.hatPosition, 'Falle, Stufe 1: „Position: erst ab Stufe 2“ (nicht mehr „Stufe 3“)');
  const b2 = blatt({ id: 'f1', art: 'falle', typ: 'druck', sk: 2, x: 5 * 32 + 16, y: 7 * 32 + 16 });
  ok(b2.position === 'Position: Feld 5 / 7' && b2.hatPosition, 'Falle, Stufe 2: die Position steht im Datenblatt (Feld 5 / 7)');
  ok(DATEN.arten.erz.positionAb === 1, 'Art erz: positionAb 1 (GEL-03 G: Erz meldet sich mit tiefen.position 1 an, tools/test-abbau-scan.js)');
  for (const art of ['test', 'monster']) ok(blatt({ id: 'x', art, typ: 'testerz', sk: 1 }).position === 'Position: Stufe 3 oder Sicht', 'Art ' + art + ' ohne Position: weiter der Standardtext „Stufe 3 oder Sicht“ (MON-01)');
  ok(blatt({ id: 'x', art: 'unbekannt', typ: 'gibtsnicht', sk: 1 }).position === SA.TXT_KEINE_POS && SA.TXT_KEINE_POS === 'Position: Stufe 3 oder Sicht', 'unbekannte Art: Standardtext Stufe 3 oder Sicht');
  ok(DATEN.typen.test && !DATEN.typen.test.positionAb, 'positionAb steht je Art im Content, nicht je Typ und nicht im Code');
  // Echter Server: Scan Stufe 1 und 2 an der Arena
  S.hin(8, 6);
  const sP = S.p;
  Scanbar.debugScanfertig(g, sP, 1);
  const s1 = S.snap().away.sc.filter((r) => r[1] === 'falle');
  ok(s1.length >= 1 && s1.every((r) => r.length === 4), 'Server Stufe 1: Einträge der Art falle ohne Position (' + s1.length + ')');
  const t1 = SA.blatt(SA.zeile(SA.lesen(s1)[0], DATEN), 32);
  ok(t1.position === 'Position: erst ab Stufe 2', 'Datenblatt zu Stufe 1 eines echten Eintrags: „erst ab Stufe 2“');
  const vorEnth = M.anker.length;
  Scanbar.debugScanfertig(g, sP, 2);
  S.lauf(0.2);
  const evs = S.neu();
  const s2 = S.snap().away.sc.filter((r) => r[1] === 'falle');
  ok(s2.length >= 3 && s2.every((r) => r.length >= 6), 'Server Stufe 2: Einträge der Art falle MIT Position (' + s2.length + ')');
  const m2 = SA.marker(S.snap().away.sc, DATEN).filter((m) => /^falle:/.test(m.key));
  ok(m2.length === s2.length && m2.every((m) => m.symbol === '' && m.art === 'falle' && ['schott', 'druck', 'schuss', 'test'].includes(m.typ)), 'Marker für jede erfasste Falle mit Art und Typ, OHNE Textkürzel (Glyphe statt SC/DR/SS)');
  ok(['schott', 'druck', 'schuss', 'test'].every((t) => DATEN.typen[t] && !('symbol' in DATEN.typen[t])) && !('symbol' in DATEN.arten.falle) && !/"(SC|DR|SS|TF|FA)"/.test(read('content/scanner/datenblaetter.json')), 'datenblaetter.json: Fallentypen und Art ohne symbol (kein SC/DR/SS/TF/FA)');
  const zl = SA.zeile({ art: 'falle', typ: 'schuss', sk: 1 }, DATEN);
  ok(zl.glyphe === 'schuss' && zl.symbol === '' && zl.name === 'Selbstschussanlage', 'Scan-Liste: Zeile der Falle trägt die Glyphe des Typs und den vollen Namen (Selbstschussanlage), kein Kürzel');
  const ze = SA.zeile({ art: 'erz', typ: 'testerz', sk: 1 }, DATEN);
  ok(ze.glyphe === null && ze.symbol === 'ER', 'andere Arten unverändert: Kürzel, keine Glyphe');
  const mfa = { art: 'falle', typ: 'schott', symbol: '', x: 200, y: 200, key: 'falle:a', fokus: true };
  const sl = flaeche(); R.drawScanMarkerBoden(sl.ctx, { x: 100, y: 100 }, 10, mfa, 1.0, false);
  const sl2 = flaeche(); R.drawScanMarkerBoden(sl2.ctx, { x: 100, y: 100 }, 10, { art: 'erz', typ: 'testerz', symbol: 'ER', key: 'erz:a' }, 1.0, false);
  const nText = (q) => q.ops.filter((o) => o.op === 'fillText' || (o.op === 'fillRect' && o.fs !== 'rgba(11,14,26,0.7)')).length;
  ok(nText(sl2) > nText(sl) && sl.ops.filter((o) => o.op === 'fillRect').length === 0, 'Weltlabel der Falle: kein Text und kein Etikett-Kasten (der Typ steht im Modell und in der Scan-Liste); der Erz-Marker zeichnet weiter sein Kürzel');
  // Scan-Raute der Falle: flache Fallen wie jeder andere Marker (14 px über dem Ring), Selbstschussanlage knapp über dem Kopf (22 hpx = 1 m, Modell 1,0 bis 1,1 m), Lotlinie ohne Lücke bis zum Bodenpunkt
  const marke = (m, voxel, rad) => { const q = flaeche(); R.drawScanMarkerBoden(q.ctx, { x: 100, y: 100 }, rad || 10, m, 1.0, voxel); const dm = q.ops.find((o) => o.op === 'moveTo' && o.a[0] === 100); return { lot: q.ops.filter((o) => (o.op === 'lineTo' || o.op === 'moveTo') && o.a[0] === 100.5), mitte: dm ? dm.a[1] + 3.5 : null }; };
  const erzM = marke({ art: 'erz', typ: 'testerz', symbol: 'ER', key: 'erz:a' }, true);
  for (const voxel of [true, false]) for (const typ of ['schott', 'druck', 'schuss']) {
    const mk = marke({ ...mfa, typ }, voxel);
    ok(mk.lot.length === 2 && mk.lot[0].op === 'moveTo' && mk.lot[1].op === 'lineTo' && mk.lot[1].a[1] === 100 && mk.lot[0].a[1] === mk.mitte + 4, (voxel ? 'Voxel' : '2D') + ' ' + typ + ': Lotlinie ein einziger Abschnitt von der Raute bis zum Bodenpunkt, keine Lücke');
  }
  ok(['schott', 'druck'].every((typ) => marke({ ...mfa, typ }, true).mitte === erzM.mitte && erzM.mitte === 100 - 14), 'Voxel: Raute über flachen Fallen (schott, druck) wie bei allen Scan-Markern 14 px über dem Ring, nicht höher');
  { const h = 100 - marke({ ...mfa, typ: 'schuss' }, true).mitte; ok(h >= 36 && h <= 44 && h > 14, 'Voxel: Raute über der Selbstschussanlage frei über dem Kopf der Anlage (Mitte ' + h + ' px über dem Boden, Modell 22 bis 24 px, Kopf bis ca. 30 px auf dem Schirm)'); }
  ok(100 - marke({ ...mfa, typ: 'schuss' }, true, 20).mitte === 2 * (100 - marke({ ...mfa, typ: 'schuss' }, true).mitte) && 100 - marke({ ...mfa, typ: 'schott' }, true, 20).mitte === 14, 'Voxel: Schwebehöhe der Anlage wächst mit dem Maßstab (Zoom), die der flachen Fallen bleibt bei 14 px');
  const conT = read('public/js/consoles.js');
  ok(/if \(z\.glyphe != null\) R\.falleGlyphe\(ctx, z\.glyphe, x \+ 7, ry \+ 4, 1, PAL\.red\);/.test(conT), 'consoles.js: Scan-Liste zeichnet die Glyphe vor dem vollen Namen');
  const rn = read('public/js/render.js');
  ok(/const istFalle = m\.art === 'falle';/.test(rn) && /if \(m\.art === 'falle'\) continue; const mx = /.test(rn), 'Kommandokarte ohne Raute und Label für Fallen (auf der Karte nur miniFalle), Minikarte ohne Eisblau-Marker für Fallen');
  const gl = (typ) => { const q = flaeche(); R.falleGlyphe(q.ctx, typ, 100, 100, 1, '#fff'); return q.ops.filter((o) => o.op === 'fillRect'); };
  ok(gl('druck').length >= 8 && gl('druck').some((o) => o.a[0] > 100) && gl('druck').some((o) => o.a[0] < 98), 'Druck-Glyphe: Kasten mit Pfeil nach außen (Teile links und rechts der Mitte, kein T)');
  const hoch = (typ) => { const r = gl(typ); return Math.max(...r.map((o) => o.a[1] + o.a[3])) - Math.min(...r.map((o) => o.a[1])); };
  ok(['schott', 'druck', 'schuss'].every((t) => hoch(t) <= 8), 'Glyphen höchstens 8 px hoch (passen ins Dreieck)');
  ok(new Set(['schott', 'druck', 'schuss', 'dorn'].map((t) => gl(t).map((o) => o.a.join()).join('|'))).size === 4, 'Glyphe je Typ verschieden (Scan-Liste: die Form trägt die Art, nicht die Farbe)');
  const neuEnth = evs.filter((e) => e.t === 'event' && e.kind === 'ankerEnthuellt');
  ok(neuEnth.length === 0 && M.anker.length === vorEnth, 'bereits enthüllte Fallen: der Scan meldet nichts doppelt');
  // Marker-Position = Anker-Position
  const eP = S.an('falle.eP'), mP = m2.find((m) => Math.abs(m.x - (eP.x * TILE + TILE / 2)) < 1);
  ok(!!mP, 'Marker sitzt auf der Kachelmitte der Falle');
}

// ======================================================================
section('Rückfall-Kits: Bauweisen-Zeile je Typ auf vorhandene Props, Austauschbarkeit, K-SILHOUETTE');
(async () => {
  const KR = await import(pathToFileURL(path.join(ROOT, 'public', 'js', 'voxel', 'kit-regeln.js')).href);
  const bw = { anker: { falle: { schott: 'a/s', station: 'a/st', '*': 'a/x', schuss: { id: 'a/sch', dreh: 90 } } } };
  ok(KR.ankerEintragVon(bw, 'falle', 'ruine', null, 'schott').id === 'a/s' && KR.ankerEintragVon(bw, 'falle', 'station', null, 'schott').id === 'a/s', 'ankerEintragVon: die Zeile des Typs gewinnt (auch gegen die Zeile der Kartenart)');
  ok(KR.ankerEintragVon(bw, 'falle', 'station', null, 'druck').id === 'a/st', 'ohne Typzeile gilt die Kartenart');
  ok(KR.ankerEintragVon(bw, 'falle', 'ruine', null, 'druck').id === 'a/x', 'sonst „*“');
  ok(KR.ankerEintragVon(bw, 'falle', 'ruine', null, 'schuss').dreh === 90, 'Objektform { id, dreh, … } auch je Typ');
  ok(KR.ankerEintragVon(bw, 'falle', 'ruine', null).id === 'a/x' && KR.ankerEintragVon(bw, 'terminal', 'ruine', null, 'x') === null, 'ohne Typ wie bisher; andere Rollen unberührt');
  const manifest = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, 'assets', 'manifest'))) if (f.endsWith('.json') && !f.startsWith('_')) for (const a of JSON.parse(read('assets/manifest/' + f)).assets || []) manifest.set(a.id, a);
  const bauweisen = fs.readdirSync(path.join(ROOT, 'content', 'buehnen', 'bauweisen')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(read('content/buehnen/bauweisen/' + f)));
  ok(bauweisen.length >= 5, 'Bauweisen gelesen (' + bauweisen.length + ')');
  const rollenFalle = Buehne.daten().anker.rollen.falle;
  for (const b of bauweisen) {
    const f = b.anker && b.anker.falle;
    ok(!!f && ['schott', 'druck', 'schuss', '*'].every((t) => typeof (typeof f[t] === 'string' ? f[t] : f[t] && f[t].id) === 'string'), b.id + ': anker.falle hat Zeilen schott, druck, schuss und „*“');
    const ids = Object.values(f || {}).map((v) => (typeof v === 'string' ? v : v.id));
    ok(ids.every((i) => manifest.has(i)), b.id + ': alle Zeilen zeigen auf vorhandene Props im Manifest');
    for (const t of ['schott', 'druck', 'schuss', 'test', 'dorn']) {
      const e = KR.ankerEintragVon(b, 'falle', 'aussenposten', null, t), m = e && manifest.get(e.id);
      const blockt = Buehne.ankerBlockiert({ rolle: 'falle', typ: t });
      if (!(e && m && m.footprint[0] <= 1 && m.footprint[1] <= 1 && (blockt || m.height <= Buehne.FIGUR_HOEHE_M + 0.005))) ok(false, b.id + '/' + t + ': Footprint ≤ 1×1' + (blockt ? '' : ' und nicht höher als die Figur (begehbar)'));
    }
    ok(true, b.id + ': jeder Typ löst auf ein Prop mit Fuß ≤ 1×1 auf, begehbare Typen nicht höher als die Figur (' + Buehne.FIGUR_HOEHE_M.toFixed(2) + ' m)');
  }
  // ITM-02 C: die sechs Fallenmodelle sind verdrahtet (kein Rückfall-Prop mehr), je Bauweise und Typ
  const FALLEN = { germanen: 'germanen', germanen_halle_holz: 'germanen', germanen_halle_stein: 'germanen', rom: 'rom', rom_feld: 'rom' };
  const SOLL_HOEHE = { schott: 0.15, druck: 0.4, schuss: 1.0 };
  for (const b of bauweisen) {
    const fam = FALLEN[b.id];
    ok(!!fam, b.id + ': bekannte Bauweise für die Fallenmodelle');
    for (const t of ['schott', 'druck', 'schuss', '*']) {
      const soll = 'ort/' + fam + '/gemein/falle_' + (t === '*' ? 'schott' : t);
      const e = KR.ankerEintragVon(b, 'falle', 'aussenposten', null, t === '*' ? 'unbekannt' : t);
      const m = manifest.get(soll);
      ok(!!e && e.id === soll, b.id + '/' + t + ': löst auf ' + soll + ' auf (ist ' + (e && e.id) + ')');
      ok(!!m && m.kind === 'model' && m.footprint.join() === '1,1' && m.params && m.params.state && m.params.state.join() === '0,3', soll + ': im Manifest, 1×1, Parameter state 0..3');
      ok(!!m && m.states && m.states.erkannt.state === 1 && m.states.entschaerft.state === 2 && m.states.ausgeloest.state === 3, soll + ': Zustände erkannt/entschärft/ausgelöst = state 1/2/3');
      ok(!!m && m.height === SOLL_HOEHE[t === '*' ? 'schott' : t], soll + ': height im Manifest ' + (m && m.height) + ' m (Soll ' + SOLL_HOEHE[t === '*' ? 'schott' : t] + ')');
    }
  }

  const sd = Buehne.silhouetteDaten();
  ok(Buehne.silhouetteFehler(sd).filter((x) => /anker\.falle/.test(x.msg)).length === 0, 'K-SILHOUETTE: die echten Bauweisen sind sauber');
  const hoch = JSON.parse(JSON.stringify(sd));
  hoch.bauweisen[0].anker.falle = { schuss: 'modell/hoch', druck: 'modell/hoch' };
  hoch.modelle['modell/hoch'] = { height: 3.2, footprint: [1, 1] };
  const msgs = Buehne.silhouetteFehler(hoch).filter((x) => x.id === 'modell/hoch').map((x) => x.msg);
  ok(msgs.length === 1 && /anker\.falle\.druck/.test(msgs[0]), 'K-SILHOUETTE: ein hohes Modell ist für die begehbare Falle (druck) ein Fehler, für die blockende Anlage (schuss) nicht (Ausnahme über CONFIG.anker.falle.blockiert)');
  // Zustandsreihenfolge = Modell-State
  ok(rollenFalle.zustaende.join() === 'verborgen,erkannt,entschaerft,ausgeloest', 'Zustandsreihenfolge der Rolle falle = Modell-State 0..3 (verborgen, erkannt, entschärft, ausgelöst)');

  // ======================================================================
  section('Einhängestellen im Quelltext');
  const cl = read('public/js/client.js'), rn = read('public/js/render.js'), hu = read('public/js/hud.js'), co = read('public/js/consoles.js'), kt = read('public/js/voxel/kit.js');
  ok(/if \(zone === 'away' && R\.isBuehne\(map\)\) return R\.buehneBewegungSolid\(map, st\);/.test(cl), 'client.js isSolidFor: gebaute Karten mit der Kollisionsbox (Vorhersage)');
  ok(!/function buehneSolid[\s\S]{0,600}blockierendeAnker/.test(rn), 'buehneSolid (Sicht) kennt die Box nicht, nur buehneBewegungSolid');
  ok(/case 'ankerEnthuellt': R\.ankerEnthuellt\(ev\); return true;/.test(cl) && /case 'falleFeld': case 'falleSchott': R\.fallenEreignis\(ev\)/.test(cl) && /case 'selbstschuss':/.test(cl) && /case 'falleWirkungslos':/.test(cl), 'client.js: ankerEnthuellt, falleFeld, falleSchott, selbstschuss, falleWirkungslos verarbeitet');
  ok(/if \(DEBUG\) H\.pushNotice\('Falle '/.test(cl), 'falleWirkungslos: nur im Debug (?debug=1) eine Meldung, sonst nichts');
  ok(/case 'falle':[^\n]*\n\s+if \(z === 'erkannt'\) return \{ label: 'E halten: Entschärfen \(' \+ sec\('falle'\) \+ '\)', ok: true \};\n\s+break;/.test(cl), 'E-Hinweis „E halten: Entschärfen (n s)“ nur bei erkannt, sonst kein Hinweis');
  ok(/'falle:erkannt': 'Falle erkannt', 'falle:entschaerft': 'Falle entschärft'/.test(cl) && !/'falle:ausgeloest'/.test(cl), 'Meldungen erkannt/entschärft; „ausgelöst“ sagt der Server selbst (Wirkungstext je Typ, keine Doppelung)');
  ok(/'anker:falle': 'ENTSCHÄRFEN'/.test(rn), 'Hold-Beschriftung anker:falle');
  ok(/R\.fallenLaufend\(st\)/.test(hu) && /R\.fallenLaufend\(st\)/.test(co), 'Lagezeilen (HUD, Captain-Lage) zeigen laufende Felder und gesperrte Schotts');
  ok(/ankerNeu\(raw\)/.test(kt) && /if \(cm && Array\.isArray\(cm\.anker\) && LZ\.h\.ankerNeu\) for \(let i = LZ\.h\.karte\.anker\.length; i < cm\.anker\.length; i\+\+\) \{ try \{ LZ\.h\.ankerNeu\(cm\.anker\[i\]\)/.test(kt) && /return k\.zustaende\[a\.id\] \|\| ankerStart\(a, rs\.zustaende\);/.test(kt) && /rolle === 'falle' \? typ : null/.test(kt), 'kit.js: ankerNeu (Layer hängt Enthüllte an), Start über Shared_Buehne.ankerStart, Typ-Zeile nur für die Falle');
  ok(/R\.ankerEnthuellt|ankerEnthuellt/.test(rn) && /m\.anker\.push\(ev\.anker\);/.test(rn), 'render.js: ankerEnthuellt hängt an die Ankerliste');
  const tasten = fs.readFileSync(path.join(ROOT, 'public', 'js', 'tasten.js'), 'utf8');
  ok(!/falle|entschaerf/i.test(tasten), 'keine neue Taste (tasten.js unverändert)');
  // Arbeitsstand: keine Clientfehler
  ok(fehlerClient.filter((x) => !/Lücke/.test(x)).length === 0, 'render.js meldete keine Fehler (außer der absichtlichen Lücke): ' + fehlerClient.filter((x) => !/Lücke/.test(x)).join('; '));

  console.log('\n' + (fails ? fails + ' FEHLER' : 'alle ' + n + ' Prüfungen ok'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
