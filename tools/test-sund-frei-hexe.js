'use strict';
// SUND-01 Paket D: Welt spielbar. Karte sund_frei: alle 30 Hexe spielbar, Sprungpunkte, Flug mit dem Bot, alle 21 Hafenhexe andockbar machbar
// (Besitzer entscheidet: server/sim/besitz.js), Banner (Marker.fr), Posten (kleine Station ohne Liegeplatz), fraktionArt, Sonderorte.
//   node tools/test-sund-frei-hexe.js   (npm run test:sund-frei-hexe)
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Sim = require('./sim-headless.js');
const { Game } = require('../server/game.js');
const Welt = require('../server/sim/welt.js');
const Space = require('../server/sim/space.js');
const Sprung = require('../server/sim/sprung.js');
const Reise = require('../server/sim/reise.js');
const Besitz = require('../server/sim/besitz.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const GenSektor = require('../shared/gen-sektor.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n' + t);
const kid = (a, b) => Sektoren.kanteId(a, b);

function neuesSpiel(karte, mitBot) {
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off' }, log: () => {} });
  let a = null;
  if (mitBot) {
    g.simStats = { reactorRestarts: 0, widescans: 0, orders: 0, accepts: 0, choices: [], unknownUms: {}, escortOrders: 0, coverShots: 0, keyTries: 0, wreckDone: false };
    a = new Sim.GenericAgent(g, 0, 'solo', {});
    g.addConnection(a.conn); g.lobbyOpts.startMission = 'arena_space'; a.hello();
  } else {
    const conn = { inbox: [], send(m) { this.inbox.push(m); } };
    g.addConnection(conn); g.handleMessage(conn, { t: 'hello', clientId: 'D1', name: 'Pruefer', color: 0 });
    g.handleMessage(conn, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(conn, { t: 'ready', ready: true });
  }
  if (g.arena) g.arena.nextAt = null;
  Welt.waehle(g, karte);
  g.weltstand = { persistent: true, data: { tutorial: 'uebersprungen', fakten: {}, chronik: [] } };   // keine Tutorial-Regeln, Sprungpunkt-Automatik wie in der Kampagne
  Sprung.debugErkundeAlle(g);
  return { g, a };
}
const lauf = (g, sek, keep) => { for (let k = 0; k < Math.round(sek * 30); k++) { if (!keep) g.space.enemies = []; g.step(); } };
function betritt(g, hex) {
  const ort = Sektoren.ortVonHex(hex);
  Space.enterScene(g, ort, {}); g.explore.location = ort; g.explore.knowSilently && g.explore.knowSilently(ort);
  g.ship.docked = false; g.ship.dockedAt = null; g._jumpSperre = null;
  return Locations.get(ort);
}

// =========================================================================================================================================
section('Karte sund_frei: alle Hexe spielbar');
Welt.waehle(null, 'sund_frei');
const F = Welt.karte('sund_frei');
const hexe = Object.keys(F.hexe).sort();
{
  ok(hexe.length === 30, '30 Hexe (' + hexe.length + ')');
  ok(hexe.every((h) => F.hexe[h].spielbar === true && F.hexe[h].gen === true && F.hexe[h].ort), 'jedes Hex: spielbar, gen, ort');
  const orte = hexe.map((h) => F.hexe[h].ort);
  ok(new Set(orte).size === orte.length, 'Ort-Ids eindeutig');
  const namen = hexe.map((h) => F.hexe[h].name);
  ok(new Set(namen).size === namen.length, 'Ortsnamen eindeutig');
  ok(hexe.every((h) => { const l = Locations.get(F.hexe[h].ort); return l && l.hex === h && l.scene && l.scene.arrive; }), 'jedes Hex: Locations.get liefert die Raumszene des Hexes');
  ok(hexe.every((h) => Sektoren.hexVonOrt(F.hexe[h].ort) === h && Sektoren.ortVonHex(h) === F.hexe[h].ort), 'Ort <-> Hex in beide Richtungen');
  const hafen = hexe.filter((h) => F.hexe[h].hafen);
  const nach = (f) => hafen.filter((h) => F.hexe[h].fraktion === f).length;
  ok(hafen.length === 21 && nach('rom') === 8 && nach('ger') === 8 && nach('saum') === 3 && F.hexe['0603'].hafen === 'D' && F.hexe['0605'].hafen === 'C', '21 Hafenhexe: Rom 8, Germanen 8, Konkordat 3, Kantenstein D, Pulverhorn C');
  ok(hafen.every((h) => F.hexe[h].andocken === true) && hexe.filter((h) => !F.hexe[h].hafen).every((h) => !F.hexe[h].andocken), 'andocken:true genau an den Hafenhexen');
  // Erreichbarkeit nur über offene Kanten: Schlüsselkanten-Hexe bleiben es
  const offenErreichbar = new Set(['0305']);
  for (let ch = true; ch;) { ch = false; for (const e of F.kanten) { if (e.art !== 'open') continue; for (const [u, v] of [[e.a, e.b], [e.b, e.a]]) if (offenErreichbar.has(u) && !offenErreichbar.has(v)) { offenErreichbar.add(v); ch = true; } } }
  ok(['0602', '0606', '0706', '0806', '0506'].every((h) => !offenErreichbar.has(h)), 'Altrost, Schrottkante, Bojenfeld, Vorläufer-Sektor, Helix nur über Schlüsselkanten/temporären Sprungpunkt');
  ok(hexe.filter((h) => !offenErreichbar.has(h)).join() === '0506,0602,0606,0706,0806', 'alle anderen 25 Hexe über offene Kanten erreichbar');
}

// =========================================================================================================================================
section('(a) Generator: Szene und Sprungpunkte für alle 30 Hexe');
{
  const { g } = neuesSpiel('sund_frei', false);
  let alleOk = true; const probleme = [];
  for (const hex of hexe) {
    const loc = betritt(g, hex); const sc = loc.scene;
    lauf(g, 0.2);
    const jp = g.snapshot().space.jp || [];
    const offen = F.kanten.filter((e) => (e.a === hex || e.b === hex) && e.art === 'open');
    for (const e of offen) {
      const p = jp.find((j) => j.k === kid(e.a, e.b));
      if (!p || p.z !== 'aktiv') { alleOk = false; probleme.push(`${hex}: Sprungpunkt ${e.a}-${e.b} fehlt oder nicht aktiv`); continue; }
      if (p.x < 0 || p.y < 0 || p.x > sc.w || p.y > sc.h) { alleOk = false; probleme.push(`${hex}: Sprungpunkt ${e.a}-${e.b} außerhalb`); }
      const st = sc.station;
      if (st && Math.hypot(p.x - st.x, p.y - st.y) < (st.r || 60) + 80) { alleOk = false; probleme.push(`${hex}: Sprungpunkt ${e.a}-${e.b} in der Station`); }
    }
    if (sc.station && (sc.station.x < 0 || sc.station.x > sc.w || sc.station.y < 0 || sc.station.y > sc.h)) { alleOk = false; probleme.push(`${hex}: Station außerhalb`); }
    if (sc.dock && (sc.dock.x < 0 || sc.dock.x > sc.w || sc.dock.y < 0 || sc.dock.y > sc.h)) { alleOk = false; probleme.push(`${hex}: Dock außerhalb`); }
    if (sc.dock && sc.station && Math.hypot(sc.dock.x - sc.station.x, sc.dock.y - sc.station.y) < (sc.station.r || 60) + 20) { alleOk = false; probleme.push(`${hex}: Dock liegt in der Station`); }
    if (g.ship.scene !== loc.id) { alleOk = false; probleme.push(`${hex}: Szene nicht betreten`); }
  }
  if (probleme.length) console.log('    ' + probleme.slice(0, 12).join('\n    '));
  ok(alleOk, 'alle 30 Szenen laden; zu jeder offenen Kante gibt es einen aktiven Sprungpunkt im Snapshot, nicht in Station/Dock, innerhalb der Szene');
  ok(Object.keys(g.errorLog || {}).length === 0, 'keine Serverfehler beim Betreten aller Hexe (' + JSON.stringify(Object.keys(g.errorLog || {})) + ')');
}

// =========================================================================================================================================
section('(b) Flug mit dem Bot (GenericAgent) über die offenen Kanten');
{
  const { g, a } = neuesSpiel('sund_frei', true);
  Space.enterScene(g, 'ostia_nova', { docked: true }); g.explore.arrive('ostia_nova');
  let S = g.snapshot(); let stoss = 0; const fehlt = [];
  const hr = F.kanten.filter((e) => e.art === 'open' && (e.a === '1004' || e.b === '1004')).map((e) => (e.a === '1004' ? e.b : e.a));
  const ziele = ['palatina', 'gasfeld', 'brachland', 'saatfeld', 'hrafnheim'].concat(hr.map((h) => F.hexe[h].ort)).concat(['ostia_nova']);
  for (const ziel of ziele) {
    const t0 = g.time; let lastMove = g.time; let lp = null;
    while (g.ship.scene !== ziel && g.time - t0 < 1500) {
      g.space.enemies = []; g.step();
      if (g.wantsSnapshot()) S = g.snapshot();
      a.updateLocs(S); const p = a.me(S); if (!p) continue;
      if (a.reactorDuty(S, p)) continue;
      a.travel(S, p, ziel);
      // Bot-Schwäche, kein Kartenfehler: fliegt er unter einem fremden Sprungpunkt durch, wählt die Sprungpunkt-Automatik dessen Ziel und der Bot
      // wechselt endlos zwischen Captain und Steuer. Dann 40 s ohne Fortschritt: Lerche 350 px vor den Sprungpunkt des nächsten Hops setzen.
      const pos = g.ship.scene + Math.round(g.ship.x / 40) + ',' + Math.round(g.ship.y / 40);
      if (pos !== lp) { lp = pos; lastMove = g.time; }
      if (g.time - lastMove > 40) {
        const hop = a.nextHop(S, ziel); const von = Sektoren.hexVonOrt(g.ship.scene), nachH = hop && Sektoren.hexVonOrt(hop);
        const j = (S.space.jp || []).find((q) => q.k === kid(von, nachH));
        if (j) { const w = Math.atan2(g.space.h / 2 - j.y, g.space.w / 2 - j.x); g.ship.x = j.x + Math.cos(w) * 350; g.ship.y = j.y + Math.sin(w) * 350; g.ship.vx = g.ship.vy = g.ship.speed = 0; stoss++; }
        lastMove = g.time;
      }
    }
    if (g.ship.scene !== ziel) fehlt.push(ziel + ' (stehe in ' + g.ship.scene + ')');
  }
  ok(!fehlt.length, 'Ostia Nova -> Palatina, Gasfeld, Brachland, Saatfeld, Hrafnheim, ' + hr.length + ' Nachbarn von Hrafnheim, zurück nach Ostia Nova: alle erreicht' + (fehlt.length ? ' (fehlt: ' + fehlt.join(', ') + ')' : ''));
  console.log('    Bot-Flug: ' + ziele.length + ' Ziele, ' + stoss + ' Positionsstöße (Bot-Schwäche an fremden Sprungpunkten), Spielzeit ' + Math.round(g.time) + ' s');
  ok(Object.keys(g.errorLog || {}).length === 0, 'keine Serverfehler im Flug (' + JSON.stringify(Object.keys(g.errorLog || {})) + ')');
}

// =========================================================================================================================================
section('(c) alle 21 Hafenhexe: Station mit Dock; Andocken nach Besitz');
{
  const { g } = neuesSpiel('sund_frei', false);
  const hafen = hexe.filter((h) => F.hexe[h].hafen);
  const texte = []; const oda0 = g.oda.bind(g); g.oda = (t, ...r) => { texte.push(String(t)); return oda0(t, ...r); };
  // Andocken wie ein Spieler: Liegeplatz anfliegen und stehen (Dock-Ring langsam)
  const versuch = (hex, besitzer) => {
    g.weltBesitz = besitzer ? { hexe: { [hex]: { besitzer } } } : null;
    const loc = betritt(g, hex); const d = loc.scene.dock;
    g.ship.x = d.x + 30; g.ship.y = d.y; g.ship.vx = g.ship.vy = g.ship.speed = 0;
    lauf(g, 0.5);
    return { docked: !!g.ship.docked && g.ship.dockedAt === loc.id, marker: g.space.markers.some((m) => m.kind === 'dock'), loc };
  };
  ok(hafen.every((h) => { const l = Locations.get(F.hexe[h].ort); return l.scene.station && l.scene.dock && l.shop === 'hafen' && l.scene.hafen && l.scene.hafen.andocken === true; }), 'an allen 21 Hafenhexen: Station, Dock, Hafenterminal (loc.shop hafen)');
  for (const bes of ['rom', 'saum', 'frei']) {
    const r = hafen.map((h) => versuch(h, bes));
    ok(r.every((x) => x.docked && x.marker), `Besitzer ${bes}: Andocken an allen 21 Häfen möglich, Dock-Marker da (${r.filter((x) => x.docked).length}/21)`);
  }
  for (const bes of ['ger', 'pirat']) {
    const r = hafen.map((h) => versuch(h, bes));
    ok(r.every((x) => !x.docked && !x.marker), `Besitzer ${bes}: Andocken an allen 21 Häfen verweigert, kein Dock-Marker (${r.filter((x) => !x.docked).length}/21 verweigert)`);
    ok(r.every((x) => x.loc.scene.station), `Besitzer ${bes}: die Station bleibt sichtbar`);
  }
  // ohne Overlay gilt das statische fraktion der Karte (sund_frei)
  const rom0 = hafen.filter((h) => F.hexe[h].fraktion === 'rom').map((h) => versuch(h, null));
  const ger0 = hafen.filter((h) => F.hexe[h].fraktion === 'ger').map((h) => versuch(h, null));
  const saum0 = hafen.filter((h) => F.hexe[h].fraktion === 'saum' || F.hexe[h].fraktion === 'frei').map((h) => versuch(h, null));
  ok(rom0.length === 8 && rom0.every((x) => x.docked), 'ohne Overlay: römische Häfen (8) andockbar');
  ok(ger0.length === 8 && ger0.every((x) => !x.docked), 'ohne Overlay: germanische Häfen (8) nicht andockbar (statische Karten-Fraktion)');
  ok(saum0.length === 5 && saum0.every((x) => x.docked), 'ohne Overlay: Konkordat (3) und herrenlose Häfen (Kantenstein, Pulverhorn) andockbar');
  // Hinweis „verweigert“: einmal je Anflug
  g.weltBesitz = { hexe: { '1004': { besitzer: 'ger' } } };
  const loc = betritt(g, '1004'); const st = loc.scene.station;
  texte.length = 0;
  g.ship.x = st.x - 500; g.ship.y = st.y; g.ship.vx = g.ship.vy = g.ship.speed = 0;
  lauf(g, 3);
  ok(texte.filter((t) => /Andocken verweigert/.test(t)).length === 1 && texte.some((t) => /^Germanischer Hafen/.test(t)), 'Annäherung an germanischen Hafen: genau ein Hinweis „Germanischer Hafen – Andocken verweigert“ (' + JSON.stringify(texte.filter((t) => /verweigert/.test(t))) + ')');
  g.ship.x = st.x - 1300; g.ship.vx = g.ship.vy = g.ship.speed = 0; lauf(g, 1);
  g.ship.x = st.x - 500; g.ship.vx = g.ship.vy = g.ship.speed = 0; lauf(g, 1);
  ok(texte.filter((t) => /Andocken verweigert/.test(t)).length === 2, 'nach Abflug und neuem Anflug: der Hinweis kommt wieder (je Anflug einmal)');
  g.weltBesitz = null;
}

// =========================================================================================================================================
section('(d) ohne Overlay in Limes und Kampagne Sund bleibt alles wie heute');
{
  const g0 = {};
  for (const karte of ['limes', 'sund']) {
    Welt.waehle(null, karte);
    const K = Welt.karte(karte);
    const alle = Object.keys(K.hexe);
    ok(alle.every((h) => Besitz.darfAndocken(g0, h) === true), `${karte}: darfAndocken ohne Overlay für alle ${alle.length} Hexe wahr`);
    ok(alle.every((h) => Besitz.besitzer(g0, h) === (K.hexe[h].fraktion || null) && !Besitz.istPosten(g0, h)), `${karte}: besitzer = statische Fraktion, kein Posten`);
    ok(Besitz.modus(g0) === false, `${karte}: Modus Freie Fahrt nicht aktiv`);
  }
  // Szenen: Kampagne Sund und Limes ohne fr am Marker, Dock da wie bisher
  const { g } = neuesSpiel('sund', false);
  betritt(g, '0604');
  ok(g.space.markers.some((m) => m.kind === 'dock') && g.space.markers.every((m) => m.fr === undefined && !m.posten), 'Kampagne Sund, Concordia: Dock-Marker, keine fr/Posten-Felder (Snapshot unverändert)');
  ok(g.space.dockOk === true, 'Kampagne Sund, Concordia: Andocken erlaubt');
  ok(Welt.karte('sund').hexe['0204'].spielbar === false && Welt.karte('sund').hexe['0305'].andocken === undefined, 'sund.json unverändert (Rom nicht spielbar, Ostia Nova ohne andocken)');
  const gl = neuesSpiel('limes', false).g;
  Space.enterScene(gl, 'hafen', { docked: true });
  ok(gl.ship.docked === true && gl.space.markers.some((m) => m.kind === 'dock') && gl.space.markers.every((m) => m.fr === undefined), 'Limes, Hafen Lichtkordon: Start angedockt, Dock-Marker, kein fr');
  Welt.waehle(null, 'sund_frei');
}

// =========================================================================================================================================
section('(e) fraktionArt mit und ohne Overlay');
{
  const { g } = neuesSpiel('sund_frei', false);
  const R = CONFIG.reise.fraktionArt;
  const soll = (fr) => R[fr] || 'neutral';
  ok(hexe.every((h) => Reise.fraktionArt(g, h) === soll(F.hexe[h].fraktion)), 'ohne Overlay: fraktionArt aller 30 Hexe wie nach der statischen Fraktion');
  ok(Reise.fraktionArt(g, '1004') === 'feind' && Reise.fraktionArt(g, '0204') === 'sicher' && Reise.fraktionArt(g, '0604') === 'neutral', 'ohne Overlay: Hrafnheim feind, Palatina sicher, Concordia neutral');
  g.weltBesitz = { hexe: { '0905': { besitzer: 'rom' }, '0304': { besitzer: 'ger' }, '0604': { besitzer: 'rom' }, '0503': { besitzer: 'pirat' } } };
  ok(Reise.fraktionArt(g, '0905') === 'sicher', 'Overlay: römisch gewordenes Kaupangr ist sicher');
  ok(Reise.fraktionArt(g, '0304') === 'feind', 'Overlay: germanisch erobertes Castra Gradivi ist feind');
  ok(Reise.fraktionArt(g, '0604') === 'sicher' && Reise.fraktionArt(g, '0503') === 'feind', 'Overlay: Concordia römisch sicher, Gasfeld Piraten feind');
  ok(Reise.fraktionArt(g, '1004') === 'feind' && Reise.fraktionArt(g, '0204') === 'sicher', 'Overlay: Hexe ohne Eintrag behalten die Karten-Fraktion');
  g.weltBesitz = null;
  // Limes und Kampagne unverändert
  for (const karte of ['limes', 'sund']) {
    Welt.waehle(g, karte); const K = Welt.karte(karte);
    ok(Object.keys(K.hexe).every((h) => Reise.fraktionArt(g, h) === soll(K.hexe[h].fraktion)), `${karte}: fraktionArt wie bisher (${Object.keys(K.hexe).length} Hexe)`);
  }
  Welt.waehle(g, 'sund_frei');
  // Gegner-Volk im Hex (volkFuer) folgt dem Besitzer
  g.weltBesitz = { hexe: { '0305': { besitzer: 'ger' } } };
  betritt(g, '0305');
  const e = Space.spawnEnemy(g, 'raider', { x: 600, y: 600 });
  ok(e && e.volk === 'ger', 'Gegner im von Germanen gehaltenen Hex tragen die germanische Kennung (' + (e && e.volk) + ')');
  g.weltBesitz = null;
}

// =========================================================================================================================================
section('(f) Banner und Posten');
{
  const { g } = neuesSpiel('sund_frei', false);
  const marker = (f) => g.space.markers.find(f);
  betritt(g, '0305');
  ok(marker((m) => m.kind === 'station') && marker((m) => m.kind === 'station').fr === 'rom', 'ohne Overlay: Station in Ostia Nova trägt fr rom (Karten-Fraktion)');
  ok(g.snapshot().space.markers.some((m) => m.kind === 'station' && m.fr === 'rom'), 'fr steht im Snapshot (space.markers)');
  g.weltBesitz = { hexe: { '0305': { besitzer: 'ger', posten: false } } };
  ok(marker((m) => m.kind === 'station').fr === 'rom', 'Besitzerwechsel nach dem Betreten: die laufende Szene zeigt noch rom (kein Live-Wechsel nötig)');
  betritt(g, '0305');
  ok(marker((m) => m.kind === 'station').fr === 'ger' && !marker((m) => m.kind === 'dock'), 'erneutes Betreten: fr ger, kein Dock-Marker mehr');
  g.weltBesitz = { hexe: { '0305': { besitzer: 'saum' } } };
  betritt(g, '0305');
  ok(marker((m) => m.kind === 'station').fr === 'saum' && marker((m) => m.kind === 'dock'), 'erneutes Betreten: fr saum (Konkordat), Dock-Marker da');
  const farben = F.fraktionen;
  ok(['rom', 'ger', 'saum', 'pirat', 'frei', 'vorl'].every((f) => /^#[0-9a-f]{6}$/i.test((farben[f] || {}).farbe)), 'Farben aller Besitzer stehen unter fraktionen der Karte (der Renderer liest sie von dort)');
  // Posten
  for (const hex of ['0503', '0505', '0705', '0703']) {
    g.weltBesitz = { hexe: { [hex]: { besitzer: 'rom', posten: true } } };
    const loc = betritt(g, hex); const sc = loc.scene;
    const p = marker((m) => m.posten);
    const nm = F.hexe[hex].name;
    ok(!!p && p.kind === 'station' && p.fr === 'rom' && p.r < 60 && !sc.dock && !marker((m) => m.kind === 'dock'), `Posten in ${nm}: kleine Station mit fr rom, ohne Dock/Dock-Marker`);
    ok(!Besitz.darfAndocken(g, hex), `Posten in ${nm}: nicht andockbar (darfAndocken falsch, kein Liegeplatz)`);
    lauf(g, 0.2);
    const jp = g.snapshot().space.jp || [];
    ok(p && (sc.planeten || []).every((q) => Math.hypot(p.x - q.x, p.y - q.y) > q.r + 200) && jp.every((j) => Math.hypot(p.x - j.x, p.y - j.y) > 400) && g.space.asteroids.every((as) => Math.hypot(p.x - as.x, p.y - as.y) > as.r + 250), `Posten in ${nm}: Abstand zu Planeten, Sprungpunkten und Brocken`);
    g.ship.x = p.x - 40; g.ship.y = p.y; g.ship.vx = g.ship.vy = g.ship.speed = 0; lauf(g, 0.5);
    ok(!g.ship.docked, `Posten in ${nm}: Anflug dockt nicht an`);
    const sn = g.snapshot().space.markers.find((m) => m.posten);
    ok(sn && sn.fr === 'rom', `Posten in ${nm}: Marker im Snapshot`);
  }
  g.weltBesitz = { hexe: { '0503': { besitzer: 'rom', posten: false } } };
  betritt(g, '0503');
  ok(!g.space.markers.some((m) => m.kind === 'station' || m.posten), 'posten:false: keine Station im freien Hex');
  g.weltBesitz = null;
  betritt(g, '0503');
  ok(!g.space.markers.some((m) => m.kind === 'station' || m.posten), 'ohne Overlay: keine Station im freien Hex');
  g.weltBesitz = { hexe: { '0503': { besitzer: 'ger', posten: true } } };
  ok(Besitz.besitzer(g, '0503') === 'ger' && Besitz.istPosten(g, '0503') && Besitz.besitzer(g, '0505') === 'frei' && !Besitz.istPosten(g, '0505'), 'besitz.js: Overlay-Eintrag, sonst Karten-Fraktion');
  ok(/Andocken verweigert/.test(Besitz.verbotText(g, '0503')) && Besitz.verbotText(g, '0505') === null, 'besitz.js: Verbotstext nur bei Verbot');
  g.weltBesitz = null;
}

// =========================================================================================================================================
section('(g) Sonderorte funktionieren wie in der Kampagne');
{
  const sund = Welt.karte('sund');
  for (const hex of ['0706', '0806', '0506', '0606']) {
    const a = GenSektor.erzeuge(hex, sund.hexe[hex]); const b = GenSektor.erzeuge(hex, F.hexe[hex]);
    ok(JSON.stringify(a) === JSON.stringify(b), `${F.hexe[hex].name} ${hex}: Szene aus dem Generator identisch zur Kampagnenkarte`);
  }
  ok(sund.hexe['0602'].verborgen && F.hexe['0602'].verborgen === true && F.hexe['0602'].ort === 'altrost', 'Altrost 0602: weiter verborgen, jetzt mit Ort');
  const { g } = neuesSpiel('sund_frei', false);
  const gesperrt = (a, b) => !!Sprung.hexGrund(g, a, b);
  ok(gesperrt('0603', '0602') && gesperrt('0605', '0606'), 'Altrost-Weg und Lager-Schrottkante: gesperrt, bis enthüllt');
  ok(gesperrt('0706', '0806'), 'Bojenfeld -> Vorläufer-Sektor: gesperrt, bis die Boje geweckt ist');
  Sprung.kanteEnthuellen(g, kid('0602', '0603')); Sprung.kanteEnthuellen(g, kid('0605', '0606'));
  ok(!gesperrt('0603', '0602') && !gesperrt('0605', '0606'), 'nach Enthüllen der Schlüsselkanten befahrbar');
  const boje = betritt(g, '0706').scene; lauf(g, 0.2);
  ok(boje.bojeFeld && boje.zonen && boje.zonen.length && boje.station.kind === 'buoy', 'Bojenfeld: Vorläufer-Boje mit Aktivierungsfeld (SL10)');
  const helix = betritt(g, '0506').scene;
  ok(helix.gravimetrie && helix.zonen.length && helix.station && F.hexe['0506'].notsprung === false, 'Helix: Gravimetriefeld, Station, kein Notsprungziel');
  const vor = betritt(g, '0806').scene;
  ok(vor.bojen.length === 3 && vor.planeten.length === 2, 'Vorläufer-Sektor: 2 Planeten, 3 Bojen');
  const schrott = betritt(g, '0606').scene;
  ok(schrott.station.name === 'Lager Schrottkante' && !schrott.dock, 'Schrottkante: Lager ohne Liegeplatz');
  ok(Sektoren.istVerborgen('0606') && Sektoren.istVerborgen('0602'), 'verborgene Hexe bleiben verborgen (kein Notfallsprung dorthin)');
}

Welt.waehle(null, 'limes');
console.log(`\n${n - fails}/${n} bestanden`);
process.exit(fails ? 1 : 0);
