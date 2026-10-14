'use strict';
// SL8 (CONCEPT-SL8): Notrufe, Server headless auf Sund.   node tools/test-notrufe.js
// Freischalten (Hexkarten-Marke, Tor), klarer Ruf, Entschlüsseln -> Behauptung, Befragen, Sonde misst, hinfliegen -> Bergung/Lohn (geld.js), Falle ->
// Hinterhalt, ablehnen kostet nichts, Ablauf in Spielzeit, Weltstand, Baustein, Snapshot-Größe, Bot.
const Game = require('../server/game.js').Game;
const Physics = require('../shared/physics.js');
const W = require('../server/world.js');
const Welt = require('../server/sim/welt.js');
const Sektoren = require('../shared/sektoren.js');
const Notrufe = require('../server/sim/notrufe.js');
const Entschl = require('../server/sim/entschluesseln.js');
const Sonden = require('../server/sim/sonden.js');
const Marken = require('../server/sim/marken.js');
const Space = require('../server/sim/space.js');
const Registry = require('../server/mission/registry.js');
const Weltstand = require('../server/weltstand.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const STAND = [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']];
function conSpot(con) {
  for (const t of [].concat(W.CONSOLE_TILES[con])) for (const [dx, dy, dir] of STAND) { const s = { x: t.x + dx, y: t.y + dy, dir }; if (!W.ship.solid(s.x, s.y)) return s; }
  return null;
}
function setup(scene) {
  const g = new Game({ noStore: true, seed: 21, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'N0', name: 'Ops', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  Welt.waehle(g, 'sund');
  Space.enterScene(g, scene, {}); g.explore.location = scene; g.explore._tutKarte = new Set();
  g.explore.erkunde('0605'); g.explore.erkunde('0503');
  const p = g.players[0]; const s = conSpot('weapons'); const ctr = Physics.tileCenter(s.x, s.y); p.x = ctr.x; p.y = ctr.y; p.dir = s.dir;
  g.handleMessage(c, { t: 'act', down: true }); g.handleMessage(c, { t: 'act', down: false });
  const cmd = (k, extra) => g.handleMessage(c, Object.assign({ t: 'cmd', c: k }, extra || {}));
  const run = (sec, keep) => { for (let k = 0; k < Math.round(sec * 30); k++) { if (!keep) g.space.enemies = []; g.step(); } };
  const odas = () => c.inbox.filter((m) => m.t === 'event' && m.kind === 'oda').map((m) => m.text);
  const radios = () => c.inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
  const flieg = (hex, keep) => { const o = Sektoren.ortVonHex(hex); Space.enterScene(g, o, {}); g.explore.location = o; run(0.1, keep); };
  const abstimmen = () => {   // Ops stimmt sauber ab (Qualität 3)
    cmd('weapons.entschl.start');
    for (let k = 0; k < 30 * 120 && g.entschl && g.entschl.z === 1; k++) {
      const e = g.entschl; const d = Math.abs(e.f - e.ziel) < 0.02 ? 0 : (e.ziel > e.f ? 1 : -1);
      if (d !== e.dir) cmd('weapons.entschl.stimme', { dir: d });
      g.space.enemies = []; g.step();
    }
    run(0.2);
  };
  return { g, c, p, cmd, run, odas, radios, flieg, abstimmen };
}
const snap = (g, id) => (g.snapshot().nr || []).find((r) => r.i === id);

Welt.waehle(null, 'sund');
try {
  console.log('Freischalten, Hexkarte, Tor');
  {
    const t = setup('pulverhorn'); const g = t.g;
    ok(Notrufe.datei('sl_klar') && Notrufe.datei('sl_echt') && Notrufe.datei('sl_falle'), 'drei feste Rufe in content/notrufe');
    ok(g.snapshot().nr === undefined, 'ohne Rufe: kein Snapshot-Feld nr');
    ok(/gibt es nicht/.test(Notrufe.freischalten(g, 'gibt_es_nicht') || ''), 'unbekannter Ruf abgelehnt');
    ok(Notrufe.freischalten(g, 'sl_klar,sl_echt,sl_falle') === null && g.notrufe.liste.length === 3, 'drei Rufe freigeschaltet');
    ok(['sl_klar', 'sl_echt', 'sl_falle'].every((i) => Marken.da(g, 'notruf:' + i)), 'Marken auf der Hexkarte (marken.js, ein Mechanismus)');
    const m = Marken.snapshot(g).filter((x) => x.t === 'notruf');
    ok(m.length === 3 && m.every((x) => x.b > 0), 'Marken tragen die Restzeit (Ablaufring)');
    ok(g.explore.kanteOffen(Sektoren.kanteId('0605', '0706')) && g.explore.kanteOffen(Sektoren.kanteId('0503', '0502')), 'temporäre Sprungpunkte für die Leerraum-Rufe offen');
    const nr = g.snapshot().nr;
    ok(nr.length === 3 && nr.find((r) => r.i === 'sl_klar').k === 'k' && nr.find((r) => r.i === 'sl_echt').k === 'v', 'Snapshot nr: Art klar/verschlüsselt');
    ok(nr.every((r) => r.f === undefined), 'ohne Fokus keine Details im Snapshot');
    const o = t.odas().join(' ');
    ok(/Notrufe empfangen/.test(o), 'Ansage');
  }

  console.log('Klarer Ruf: befragen, hinfliegen, bergen, Lohn');
  {
    const t = setup('pulverhorn'); const g = t.g; Notrufe.freischalten(g, 'sl_klar');
    ok(Notrufe.entschluesseln(g, t.p, 'sl_klar') === 'Der Ruf ist klar, nichts zu entschlüsseln.', 'klar: nichts zu entschlüsseln');
    t.cmd('captain.notruf.fokus', { id: 'sl_klar' });
    ok(Notrufe.fokus(g, 'sl_klar') === null, 'Fokus (als Captain)');
    const f = snap(g, 'sl_klar').f;
    ok(f && f.b && f.q.length === 2, 'Fokus: Behauptung und Fragen sichtbar (klarer Ruf)');
    ok(Notrufe.befragen(g, 'sl_klar', 0) === null && /Vier/.test(t.radios().join(' ')), 'Befragen: Antwort im Funk');
    ok(/Ops-Hinweis/.test(t.odas().join(' ')), 'Ops bekommt den Hinweis');
    ok(snap(g, 'sl_klar').f.a.length === 1, 'Snapshot Fokus: gestellte Frage mit Antwort');
    const marks0 = g.inventory.marks;
    ok(Notrufe.hinfliegen(g, 'sl_klar') === null && Notrufe.finde(g, 'sl_klar').z === Notrufe.Z.ANGENOMMEN, 'hinfliegen: angenommen');
    t.flieg('0503');
    ok(Notrufe.finde(g, 'sl_klar').z === Notrufe.Z.VOR_ORT, 'Ankunft im Hex: vor Ort');
    ok(g.snapshot().space.nro && g.snapshot().space.nro.x === 2300, 'space.nro: Ort des Rufs in der Szene');
    g.ship.x = 2300 + 30; g.ship.y = 700; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0; g.ship.docked = false; g.ship.dockedAt = null;
    t.run(2);
    ok(Notrufe.finde(g, 'sl_klar').z === Notrufe.Z.VOR_ORT && g.snapshot().space.nro.p > 0.3, 'Bergung läuft (Fortschritt)');
    t.run(3);
    ok(Notrufe.erledigt(g, 'sl_klar') && g.inventory.marks === marks0 + 80, 'geborgen: Lohn 80 Marken über geld.js (' + (g.inventory.marks - marks0) + ')');
    ok(!Marken.da(g, 'notruf:sl_klar') && g.snapshot().nr === undefined, 'Marke weg, Ruf aus dem Snapshot');
  }

  console.log('Verschlüsselter echter Ruf: entschlüsseln, befragen, Sonde, bergen');
  {
    const t = setup('pulverhorn'); const g = t.g; Notrufe.freischalten(g, 'sl_echt'); Notrufe.fokus(g, 'sl_echt');
    ok(snap(g, 'sl_echt').f.b === null, 'verschlüsselt: Behauptung unsichtbar');
    ok(/noch nicht zu verstehen/.test(Notrufe.befragen(g, 'sl_echt', 0) || ''), 'Befragen vor dem Entschlüsseln abgelehnt');
    ok(Notrufe.entschluesseln(g, t.p, 'sl_echt') === null && g.entschl && g.entschl.id === 'notruf_sl_echt', 'Ops öffnet das Signal (Entschlüsseln SL5)');
    t.abstimmen();
    ok(Entschl.ergebnis(g, 'notruf_sl_echt') === 3, 'Qualität 3');
    ok(t.radios().some((x) => /Hüllenbruch/.test(x)) && t.radios().filter((x) => /Lebenszeichen|Peilung|Reaktor kalt/.test(x)).length === 3, 'Behauptung und alle drei Indizien bei Qualität 3');
    ok(snap(g, 'sl_echt').f.b && /Hüllenbruch/.test(snap(g, 'sl_echt').f.b), 'Fokus zeigt jetzt die Behauptung');
    ok(Notrufe.befragen(g, 'sl_echt', 1) === null, 'Befragen jetzt möglich');
    // Sonde misst
    g.inventory.sonde = 3; g.explore.markBoje(Sektoren.kanteId('0605', '0706'));
    ok(Sonden.starteDurchSprungpunkt(g, t.p, '0706') === null, 'Sonde durch den temporären Sprungpunkt (Leerraum)');
    t.run(10 + g.C.sonden.sprungZeit);
    ok(Notrufe.finde(g, 'sl_echt').sonde && /misst den Notruf/.test(t.odas().join(' ')), 'Sonde liefert die echten Messwerte');
    ok(snap(g, 'sl_echt').f.s && /Meldung stimmt/.test(snap(g, 'sl_echt').f.s), 'Messwerte im Fokus');
    ok(Notrufe.hinfliegen(g, 'sl_echt') === null, 'hinfliegen');
    t.flieg('0706');
    g.ship.x = 1500; g.ship.y = 1100; g.ship.vx = 0; g.ship.vy = 0; g.ship.speed = 0;
    const marks0 = g.inventory.marks; t.run(5);
    ok(Notrufe.erledigt(g, 'sl_echt') && g.inventory.marks === marks0 + 120, 'geborgen: 120 Marken');
    ok(!g.explore.kanteOffen(Sektoren.kanteId('0605', '0706')), 'temporärer Sprungpunkt wieder zu');
  }

  console.log('Falle: Hinterhalt');
  {
    const t = setup('gasfeld'); const g = t.g; Notrufe.freischalten(g, 'sl_falle'); Notrufe.fokus(g, 'sl_falle');
    Notrufe.entschluesseln(g, t.p, 'sl_falle'); t.abstimmen();
    ok(t.radios().some((x) => /Zwölf Lebenszeichen/.test(x)), 'Indiz verrät die Falle');
    Notrufe.hinfliegen(g, 'sl_falle');
    t.flieg('0502', true);
    ok(Notrufe.finde(g, 'sl_falle').z === Notrufe.Z.VOR_ORT, 'Ankunft: vor Ort');
    const h = g.space.enemies.filter((e) => e.tag === 'hinterhalt');
    ok(h.length === 3, 'Hinterhalt: 3 Jäger mit Tag hinterhalt (' + h.length + ')');
    ok(t.odas().some((x) => /Falle/.test(x)), 'Ansage: Falle');
    const marks0 = g.inventory.marks;
    t.run(2, true);
    ok(!Notrufe.erledigt(g, 'sl_falle'), 'solange die Jäger leben: nicht erledigt');
    g.space.enemies = []; t.run(0.2, true);
    ok(Notrufe.erledigt(g, 'sl_falle') && g.inventory.marks === marks0 + 40, 'Hinterhalt abgewehrt: Beute 40 Marken');
  }

  console.log('Ignorieren kostet nichts, Ablauf in Spielzeit, Szene verlassen');
  {
    const t = setup('pulverhorn'); const g = t.g; Notrufe.freischalten(g, 'sl_klar,sl_echt');
    const marks0 = g.inventory.marks, hull0 = g.ship.hull;
    ok(Notrufe.ablehnen(g, 'sl_echt') === null && Notrufe.finde(g, 'sl_echt').z === Notrufe.Z.ABGELEHNT, 'ablehnen');
    ok(g.inventory.marks === marks0 && g.ship.hull === hull0 && !Marken.da(g, 'notruf:sl_echt'), 'Ignorieren kostet nichts (Marken, Hülle), Marke weg');
    ok(!g.explore.kanteOffen(Sektoren.kanteId('0605', '0706')), 'Tor des abgelehnten Rufs zu');
    t.run(g.C.notrufe.dauer - 5);
    ok(Notrufe.finde(g, 'sl_klar').z === Notrufe.Z.OFFEN, 'nach dem Großteil der Zeit noch offen');
    t.run(8);
    ok(Notrufe.finde(g, 'sl_klar').z === Notrufe.Z.ABGELAUFEN && !Marken.da(g, 'notruf:sl_klar'), 'Ablauf nach 600 Spielsekunden: verstummt, Marke weg');
    ok(t.odas().some((x) => /verstummt/.test(x)), 'Ansage: verstummt');
    // Ablauf auch im Schnellsprung: Spielzeit läuft ohne Szenenwechsel
    const t2 = setup('pulverhorn'); const g2 = t2.g; Notrufe.freischalten(g2, 'sl_klar', 60);
    g2.reise = { hops: ['0605'], i: 0, t: 0, ziel: '0605', abbruch: false };   // Reise läuft
    t2.run(61);
    ok(Notrufe.finde(g2, 'sl_klar').z === Notrufe.Z.ABGELAUFEN, 'Ablauf läuft auch während des Schnellsprungs (Spielzeit)');
    // Szene verlassen vor Bergung
    const t3 = setup('pulverhorn'); const g3 = t3.g; Notrufe.freischalten(g3, 'sl_klar'); Notrufe.hinfliegen(g3, 'sl_klar');
    t3.flieg('0503'); ok(Notrufe.finde(g3, 'sl_klar').z === Notrufe.Z.VOR_ORT, 'vor Ort');
    t3.flieg('0605'); ok(Notrufe.finde(g3, 'sl_klar').z === Notrufe.Z.ANGENOMMEN, 'Szene verlassen: Ruf bleibt angenommen, nichts geht verloren');
  }

  console.log('Weltstand, Baustein, Snapshot-Größe');
  {
    const t = setup('pulverhorn'); const g = t.g;
    const b = Registry.get('notrufe_freischalten'); const p1 = Registry.get('notruf_erledigt'), p2 = Registry.get('notrufe_erledigt');
    ok(b && p1 && p2, 'Bausteine registriert');
    b.run({ game: g, tpl: (s) => s }, { ids: 'sl_klar, sl_echt, sl_falle', dauer: 600 });
    ok(g.notrufe.liste.length === 3 && p2.test({ game: g }, { min: 1 }) === false, 'Baustein schaltet die drei Rufe frei');
    Notrufe.fokus(g, 'sl_falle'); Notrufe.entschluesseln(g, t.p, 'sl_falle'); t.abstimmen();
    Notrufe.fokus(g, 'sl_echt'); t.cmd('weapons.entschl.stopp');
    Notrufe.befragen(g, 'sl_klar', 0); Notrufe.fokus(g, 'sl_klar'); Notrufe.befragen(g, 'sl_klar', 1);
    t.run(30);
    const gross = JSON.stringify(g.snapshot().nr).length;
    ok(gross < 900, `Snapshot nr mit 3 Rufen und Fokus-Details: ${gross} B`);
    const save = Notrufe.toSave(g);
    ok(save.sl_klar && save.sl_klar.rest > 500 && save.sl_klar.rest < 600 && save.sl_klar.befragt.length === 2, 'toSave: Restzeit und gestellte Fragen');
    const t2 = setup('pulverhorn'); const g2 = t2.g; Notrufe.restore(g2, JSON.parse(JSON.stringify(save)));
    ok(g2.notrufe.liste.length === 3 && Marken.da(g2, 'notruf:sl_klar') && g2.explore.kanteOffen(Sektoren.kanteId('0605', '0706')), 'restore: Rufe, Marken und Tore wieder da');
    const rest = Marken.snapshot(g2).find((x) => x.id === 'notruf:sl_klar').b;
    ok(rest > 500 && rest <= 600, 'Marke trägt die gespeicherte Restzeit (' + rest + ' s)');
    const data = Weltstand.capture(g);
    ok(data.welt.notrufe && data.welt.notrufe.sl_falle, 'Weltstand: welt.notrufe gespeichert');
    const fehler = (Weltstand.validate(data, g) || []).filter((f) => /welt/.test(String(f)));
    ok(fehler.length === 0, 'Weltstand-Schema akzeptiert welt.notrufe' + (fehler.length ? ': ' + JSON.stringify(fehler).slice(0, 200) : ''));
    Notrufe.restore(g2, undefined); ok(g2.notrufe.liste.length === 0, 'Altstand ohne welt.notrufe: keine Rufe');
  }
} finally { Welt.waehle(null, 'limes'); }

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
