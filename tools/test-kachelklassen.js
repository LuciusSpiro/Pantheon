'use strict';
// GEL-01 Paket C: zwei neue Kachelklassen mit Varianten, nur aus content/buehnen/kacheln.json gesteuert (kein Sonderfall im Servercode).
//   schleier (Variante strauch, Zeichen s): keine Kollision, sperrt die Sicht, Deckungswert 0
//   fluessig (Varianten wasser a, lava v): für Spieler und Gegner unpassierbar, kein Schaden, Sicht und Schüsse frei, keine Deckung, Kante fest
// Nachweise auf kleinen handgebauten Karten (Buehne.ausRaster mit { spiel: true }): Prüfer (K-ERREICHBAR, K-ANKER-WAND), Server-Sicht und
// -Schussstopp (combat.env), Bewegung im Spiel, Gegner-Weg (bfs), echter Gegnerschuss. Dazu Konsistenz von kacheln.json und die Client-Tabellen
// (kit.js und render.js laufen nicht in Node: Quelltext- und Datenprüfung; Sichtprüfung im Browser ist nicht Teil dieses Tests).
//   node tools/test-kachelklassen.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const Physics = require('../shared/physics.js');
const Los = require('../shared/los.js');
const Buehne = require('../shared/buehne.js');
const K = require('../shared/buehne-kennzahlen.js');
const W = require('../server/world.js');
const { bfs } = require('../server/util.js');
const interior = require('../server/sim/interior.js');
const away = require('../server/sim/away.js');
const squad = require('../server/sim/squad.js');
const combat = require('../server/sim/combat.js');
const { Game } = require('../server/game.js');
const AC = require('../shared/config.js').awayCombat;
const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const rd = (p) => JSON.parse(lies(p));

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };

const KACHELN = rd('content/buehnen/kacheln.json');
const Z = KACHELN.zeichen;
const [STRAUCH, WASSER, LAVA] = ['s', 'a', 'v'];   // frei gewählt: weder in kacheln.json, ANKER_GLYPHE, Festkarten-Platzhaltern (def.zeichen: T, P, b) noch in Rastern

// ---------------------------------------------------------------------------------------------- kacheln.json
console.log('\n[kacheln.json: Werte und Konsistenz]');
{
  const rohtext = lies('content/buehnen/kacheln.json');
  const schluessel = [...rohtext.matchAll(/^ {4}"(.)": \{/gm)].map((m) => m[1]);
  ok(schluessel.length === Object.keys(Z).length && new Set(schluessel).size === schluessel.length, `kein Zeichen doppelt (${schluessel.length} Einträge im Quelltext, ${Object.keys(Z).length} geparst)`);
  const klassen = Object.entries(Z).filter(([, z]) => z.kind === 'schleier' || z.kind === 'fluessig');
  ok(klassen.length === 3 && klassen.every(([, z]) => typeof z.variante === 'string' && z.variante), `jedes Zeichen der Klassen schleier/fluessig hat eine variante (${klassen.map(([c, z]) => c + '=' + z.kind + ':' + z.variante).join(', ')})`);
  ok(Object.entries(Z).filter(([, z]) => z.variante != null).every(([, z]) => z.kind === 'schleier' || z.kind === 'fluessig'), 'variante steht nur an Zeichen dieser beiden Klassen');
  const paare = klassen.map(([, z]) => z.kind + ':' + z.variante);
  ok(new Set(paare).size === paare.length, 'Paare (kind, variante) sind eindeutig');
  const s = Z[STRAUCH], w = Z[WASSER], l = Z[LAVA];
  ok(s.kind === 'schleier' && s.variante === 'strauch' && s.solid === false && s.cover === 0 && s.low === false && s.sperrtSicht === true && s.kante === 'begehbar', `${STRAUCH}: schleier/strauch, solid false, cover 0, low false, sperrtSicht true, kante begehbar`);
  for (const [ch, z, v] of [[WASSER, w, 'wasser'], [LAVA, l, 'lava']]) {
    ok(z.kind === 'fluessig' && z.variante === v && z.solid === true && z.cover === 0 && z.low === false && z.sperrtSicht === false && z.kante === 'fest', `${ch}: fluessig/${v}, solid true, cover 0, low false, sperrtSicht false, kante fest`);
  }
  ok([s, w, l].every((z) => typeof z.hinweis === 'string' && z.hinweis.length > 20), 'hinweis (deutsch) an allen drei Zeichen');
  ok(![STRAUCH, WASSER, LAVA].some((c) => Object.values(Buehne.ANKER_GLYPHE).includes(c)), 'die drei Zeichen kollidieren nicht mit den Anker-Glyphen der Textansicht (ANKER_GLYPHE)');
  // keine bestehende Karte/Vorlage nutzt die Zeichen als Kachel (die Hashbasis der Karten bleibt bis auf die Legende gleich)
  let treffer = 0;
  const gehe = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, f.name); if (f.isDirectory()) gehe(q); else if (q.endsWith('.json')) {
    const j = JSON.parse(fs.readFileSync(q, 'utf8'));
    (function r(o, key) { if (Array.isArray(o)) { if (key === 'rows') for (const z of o) if (typeof z === 'string' && /[sav]/.test(z)) treffer++; for (const e of o) r(e, key); } else if (o && typeof o === 'object') for (const k of Object.keys(o)) r(o[k], k); })(j, '');
  } } };
  gehe(path.join(ROOT, 'content/buehnen'));
  ok(treffer === 0, `keine Rasterzeile (rows) unter content/buehnen enthält s, a oder v (${treffer})`);
}

// ---------------------------------------------------------------------------------------------- Testkarten
const W_ = 30, H_ = 13, SPALTE = 14;
// Wiese mit Fels-Rand, Abholpunkt links, Beute (Pflichtziel) rechts; über die Spalte x=14 läuft eine Mauer aus `ch` (Lücke bei y=luecke)
function roh(ch, luecke, extra) {
  const g = []; for (let y = 0; y < H_; y++) g.push(new Array(W_).fill(':'));
  for (let x = 0; x < W_; x++) { g[0][x] = 'F'; g[H_ - 1][x] = 'F'; } for (let y = 0; y < H_; y++) { g[y][0] = 'F'; g[y][W_ - 1] = 'F'; }
  if (ch) for (let y = 1; y < H_ - 1; y++) if (y !== luecke) g[y][SPALTE] = ch;
  if (extra) extra((x, y, c) => { g[y][x] = c; });
  const A = (id, rolle, x, y, e) => Object.assign({ id, rolle, x, y }, e || {});
  return { id: 'test.kachelklassen', erzeuger: 'hand-raster/1', art: 'aussenposten', bauweise: 'germanen', besitz: 'raubzug', zustand: 'intakt', seed: 1, bauversion: 'probe1', schablone: 'probe',
    spiegel: null, w: W_, h: H_, rows: g.map((r) => r.join('')),
    legende: null, anker: [A('w.abholpunkt', 'abholpunkt', 3, 6, { ankunft: true }), A('w.eingang.1', 'eingang', 2, 3, { art: 'laut' }), A('w.eingang.2', 'eingang', 2, 9, { art: 'laut' }),
      A('o.beute', 'beute', 26, 6), A('o.wache', 'wache', 24, 4)],
    bereiche: { gefecht: { name: 'Gefecht', rects: [[1, 1, 28, 11]], rolle: null, gefecht: true } },
    plaetze: {}, eingaenge: ['w.eingang.1', 'w.eingang.2'], abholpunkte: ['w.abholpunkt'], ankunft: 'w.abholpunkt', patrouillen: [], coverSpots: [], decks: null, kanten: {}, zustaende: {}, gelaende: null,
    meta: { versuche: 1, kennzahlen: null, linear: false, pflicht: { beute: 1 }, zellen: null, schiffDecks: null, torStart: 'offen', huelle: true, typ: 'militaer', titel: {} } };
}
const bauen = (r) => Buehne.ausRaster(JSON.parse(JSON.stringify(r)), { spiel: true });
const codes = (r) => r.fehler.map((f) => f.code);

// ---------------------------------------------------------------------------------------------- Prüfer
console.log('\n[Prüfer: Karte aus kacheln.json, K-ERREICHBAR, K-ANKER-WAND]');
const KAR = {
  frei: bauen(roh(null)), strauch: bauen(roh(STRAUCH)), wasser: bauen(roh(WASSER)), lava: bauen(roh(LAVA)),
  wasserLuecke: bauen(roh(WASSER, 6)), lavaLuecke: bauen(roh(LAVA, 6)),
};
{
  ok(codes(KAR.frei).length === 0, 'Kontrolle (offene Wiese): Prüfer ohne Fehler ' + JSON.stringify(codes(KAR.frei)));
  ok(Object.keys(KAR.strauch.karte.legende).includes(STRAUCH) && KAR.strauch.karte.legende[STRAUCH].kind === 'schleier' && KAR.strauch.karte.legende[WASSER].variante === 'wasser', 'Legende der gebauten Karte trägt kind und variante');
  ok(codes(KAR.strauch).length === 0, 'Strauchwand über die ganze Karte: Beute dahinter gilt als erreichbar (b ist begehbar), Prüfer ohne Fehler ' + JSON.stringify(codes(KAR.strauch)));
  for (const [name, c] of [['wasser', 'Wasserwand'], ['lava', 'Lavawand']]) {
    const f = KAR[name].fehler;
    ok(!KAR[name].pruefung.ok && f.some((e) => e.code === 'K-ERREICHBAR' && /o\.beute/.test(e.msg)), `${c} ohne Lücke: K-ERREICHBAR meldet die abgeschnittene Beute (${[...new Set(codes(KAR[name]))].join(' ')})`);
  }
  ok(codes(KAR.wasserLuecke).length === 0 && codes(KAR.lavaLuecke).length === 0, 'Wasser-/Lavawand mit Lücke: Prüfer ohne Fehler (Wege um die Flüssigkeit zählen)');
  // Anker nicht in/auf den Klassen: nichts gemeldet; Anker auf Wasser: fest -> K-ANKER-WAND; Anker auf Strauch: begehbar -> kein Fehler
  const mitWache = (ch) => { const r = roh(null, null, (set) => set(10, 3, ch)); r.anker.push({ id: 'x.wache.9', rolle: 'wache', x: 10, y: 3 }); return bauen(r); };
  ok(codes(mitWache(STRAUCH)).length === 0, 'Wache auf Strauch: kein Fehler (begehbar)');
  for (const c of [WASSER, LAVA]) ok(codes(mitWache(c)).join() === 'K-ANKER-WAND', `Wache auf "${c}" (fluessig): K-ANKER-WAND`);
  // ohne spiel (Kennzahlen, Warnungen) darf die Karte mit allen drei Zeichen nichts verschlucken
  const ohne = Buehne.ausRaster(JSON.parse(JSON.stringify(roh(STRAUCH, 6, (set) => { set(8, 2, WASSER); set(9, 2, LAVA); }))), {});
  ok(ohne.fehler.length === 0 && !!ohne.karte.meta.kennzahlen, 'ohne spiel: Kennzahlen und Prüfer laufen durch (' + JSON.stringify(ohne.fehler.map((f) => f.code)) + ')');
  // Raster-Helfer der Prüfer: Durchgang, Sicht, Deckung je Klasse
  const rs = (rows) => K.raster(Object.assign({}, KAR.frei.karte, { rows }));
  const rows = KAR.frei.karte.rows.slice(); rows[6] = rows[6].slice(0, 8) + STRAUCH + WASSER + LAVA + rows[6].slice(11);
  const q = rs(rows);
  ok(q.durchgang(8, 6) && q.begehbar(8, 6) && q.sperrtSicht(8, 6) && q.cover(8, 6) === 0, 'raster: Strauch durchgängig, begehbar, sperrt die Sicht, cover 0');
  for (const x of [9, 10]) ok(!q.durchgang(x, 6) && !q.begehbar(x, 6) && !q.sperrtSicht(x, 6) && q.cover(x, 6) === 0, `raster: ${x === 9 ? 'Wasser' : 'Lava'} nicht durchgängig, Sicht frei, cover 0`);
  ok(K.sicht(q, 8, 6, 11, 6) === true && K.sicht(q, 7, 6, 9, 6) === false, 'raster: Sichtlinie über Wasser und Lava frei, durch den Strauch gesperrt (K.sicht)');
}

// ---------------------------------------------------------------------------------------------- Spiel
const LP = 'test.kachelklassen';
function spiel(roh_) {
  const g = new Game({ noStore: true, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  g.addConnection(c);
  g.handleMessage(c, { t: 'hello', clientId: 'K0', name: 'K0', color: 0 });
  g.handleMessage(c, { t: 'ready', ready: true });
  W.AWAY_MAPS[LP] = { id: LP, karte: bauen(roh_).karte };
  g.aways[LP] = away.makeLandepunkt(g, LP);
  g.setAwayMap(LP);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  g.god = true;
  const P = g.players[0];
  const place = (tx, ty) => { const q = Physics.tileCenter(tx, ty); P.x = q.x; P.y = q.y; P.dir = 'right'; P.input.mx = 0; P.input.my = 0; };
  const run = (sec, each) => { for (let k = 0; k < Math.round(sec * 30); k++) { g.step(); if (each) each(); } };
  return { g, P, place, run, aw: () => g.aways[LP] };
}
const T = Physics.tileCenter;

console.log('\n[Server-Regeln: solid, Sicht, Schussstopp, Deckung (combat.env, wie im Spiel)]');
{
  // Karte mit je einer Kachel jeder Klasse zwischen zwei freien Kacheln auf Zeile 6 (x=10 Strauch, 15 Wasser, 20 Lava)
  const probe = roh(null, null, (set) => { set(10, 6, STRAUCH); set(15, 6, WASSER); set(20, 6, LAVA); });
  const { g } = spiel(probe);
  const E = combat.env(g);
  const sicht = (a, b) => Los.lineOfSight(E.blocked, T(a[0], a[1]).x, T(a[0], a[1]).y, T(b[0], b[1]).x, T(b[0], b[1]).y);
  const schussFrei = (a, b) => !Los.walk(T(a[0], a[1]).x, T(a[0], a[1]).y, T(b[0], b[1]).x, T(b[0], b[1]).y, (tx, ty) => E.shotBlocked(tx, ty) && !(tx === b[0] && ty === b[1]));
  const deck = (a, b, ger) => Los.coverAgainst(E.map, E.solid, T(a[0], a[1]).x, T(a[0], a[1]).y, T(b[0], b[1]).x, T(b[0], b[1]).y, ger);
  // b: nicht solid, sperrt Sicht und (Ist-Verhalten) auch Schüsse: shotBlocked = sight || fenster, awaySight liefert sperrtSicht
  ok(!E.solid(10, 6) && E.blocked(10, 6) === true && E.shotBlocked(10, 6) === true, 'Strauch: solid false, blocked true, shotBlocked true (IST: awayShotBlock = Sicht oder Fenster, der Strauch stoppt auch Schüsse)');
  ok(sicht([8, 6], [9, 6]) && !sicht([8, 6], [12, 6]) && !sicht([12, 6], [8, 6]) && sicht([8, 5], [12, 5]), 'Strauch: Sicht durch die Kachel gesperrt (beidseitig), daneben frei');
  ok(!schussFrei([8, 6], [12, 6]) && schussFrei([8, 5], [12, 5]), 'Strauch: ein Schuss durch die Kachel wird gestoppt (Ist-Verhalten, wird nicht geändert)');
  ok(deck([8, 6], [12, 6], false) === 0 && deck([8, 6], [12, 6], true) === 0, 'Strauch: Deckungswert 0, Schuss wird aber gestoppt (Ist-Verhalten wie Rohr `r`; Entscheidung bei Kai offen)');
  for (const [ch, x] of [[WASSER, 15], [LAVA, 20]]) {
    ok(E.solid(x, 6) === true && E.blocked(x, 6) === false && E.shotBlocked(x, 6) === false, `${ch === WASSER ? 'Wasser' : 'Lava'}: solid true, blocked false, shotBlocked false`);
    ok(sicht([x - 2, 6], [x + 2, 6]) && schussFrei([x - 2, 6], [x + 2, 6]), `${ch === WASSER ? 'Wasser' : 'Lava'}: Sicht und Schuss gehen hindurch`);
    ok(deck([x - 2, 6], [x + 2, 6], false) === 0 && deck([x - 2, 6], [x + 2, 6], true) === 0, `${ch === WASSER ? 'Wasser' : 'Lava'}: keine Deckung (auch nicht geduckt)`);
  }
}

console.log('\n[Bewegung im Spiel: Strauch durchlaufbar, Wasser und Lava nicht]');
function lauf(roh_, startX, sek) {
  const { P, place, run } = spiel(roh_);
  place(startX, 6); P.input.mx = 1; P.input.my = 0;
  const kacheln = new Set();
  run(sek, () => { const t = Physics.toTile(P.x, P.y); kacheln.add(t.x); });
  P.input.mx = 0;
  const t = Physics.toTile(P.x, P.y);
  return { x: t.x, y: t.y, kacheln };
}
{
  const frei = lauf(roh(null), 10, 2.5), strauch = lauf(roh(null, null, (set) => set(12, 6, STRAUCH)), 10, 2.5);
  ok(strauch.kacheln.has(12) && strauch.x >= 14 && strauch.x === frei.x, `Strauch: Spieler läuft hindurch (Kachel 12 betreten, Ziel x=${strauch.x}, ohne Strauch x=${frei.x})`);
  for (const [ch, name] of [[WASSER, 'Wasser'], [LAVA, 'Lava']]) {
    const r = lauf(roh(null, null, (set) => set(12, 6, ch)), 10, 2.5);
    ok(!r.kacheln.has(12) && r.x <= 11, `${name}: Spieler kommt nicht in die Kachel (bleibt bei x=${r.x}, Kachel 12 nie betreten)`);
  }
}

console.log('\n[Gegner meiden Wasser und Lava (bfs mit awaySolid), Strauch ist Weg]');
{
  const mit = (ch, luecke) => { const { g } = spiel(roh(ch, luecke)); const E = combat.env(g); return { E, weg: bfs((x, y) => !E.solid(x, y), { x: 8, y: 6 }, (x, y) => x === 20 && y === 6, W_, H_) }; };
  const frei = mit(null), strauch = mit(STRAUCH);
  ok(frei.weg && frei.weg.length === 12 && strauch.weg && strauch.weg.length === 12 && strauch.weg.some((s) => s.x === SPALTE && s.y === 6), `Strauchwand: der Weg geht gerade hindurch (${strauch.weg && strauch.weg.length} Schritte wie ohne Wand)`);
  for (const [ch, name] of [[WASSER, 'Wasser'], [LAVA, 'Lava']]) {
    const zu = mit(ch, null), offen = mit(ch, 2);
    ok(zu.weg === null, `${name}wand ohne Lücke: kein Gegnerweg`);
    ok(offen.weg && offen.weg.length > 12 && offen.weg.every((s) => !(s.x === SPALTE && s.y !== 2)) && offen.weg.some((s) => s.x === SPALTE && s.y === 2), `${name}wand mit Lücke bei y=2: Gegnerweg geht durch die Lücke (${offen.weg && offen.weg.length} Schritte), nie über ${name}`);
  }
}

console.log('\n[Schuss: echter Gegnerschuss über die Kachel]');
function schuss(roh_, schuesse) {
  const { g, P, place, run, aw } = spiel(roh_);
  AC.enemy.scavenger.spreadDeg = 0;
  place(14, 6);
  const q = T(8, 6);
  const shooter = squad.makeEnemy(g, aw(), 'scavenger', 'T' + g.nextId(''), q, 'test');
  shooter.asleep = false; shooter.frozen = true; aw().drones.push(shooter);
  const s0 = aw().stats.playerHits, b0 = aw().stats.coverBlocks;
  for (let i = 0; i < schuesse; i++) { combat.fireEnemy(g, shooter, P); run(1.0); }
  return { treffer: aw().stats.playerHits - s0, deckung: aw().stats.coverBlocks - b0, schuesse, errors: g.errors };
}
{
  // Schütze x=8, Ziel x=14, Hindernis auf x=11 (Zeile 6)
  const N = 20;
  const frei = schuss(roh(null), N);
  ok(frei.treffer === N && frei.errors === 0, `Kontrolle ohne Hindernis: ${frei.treffer}/${N} Treffer`);
  for (const [ch, name] of [[WASSER, 'Wasser'], [LAVA, 'Lava']]) {
    const r = schuss(roh(null, null, (set) => set(11, 6, ch)), N);
    ok(r.treffer === N && r.deckung === 0 && r.errors === 0, `${name} auf der Schusslinie: ${r.treffer}/${N} Treffer, keine Deckungsblockade`);
  }
  const s = schuss(roh(null, null, (set) => set(11, 6, STRAUCH)), N);
  ok(s.treffer === 0 && s.errors === 0, `Strauch auf der Schusslinie: ${s.treffer}/${N} Treffer (IST: der Schuss endet am Strauch, wie bei jeder sichtsperrenden Kachel)`);
}
delete W.AWAY_MAPS[LP];

// ---------------------------------------------------------------------------------------------- Client (ohne Browser)
async function client() {
  console.log('\n[Client: Kit-Tabellen, Rückfälle (Quelltext- und Datenprüfung, ohne Browser)]');
  const R = await import(pathToFileURL(path.join(ROOT, 'public/js/voxel/kit-regeln.js')).href);
  const bauweisen = fs.readdirSync(path.join(ROOT, 'content/buehnen/bauweisen')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  ok(bauweisen.length >= 5, `Bauweisen gefunden: ${bauweisen.join(', ')}`);
  for (const kind of ['schleier', 'fluessig']) {
    const fehlt = bauweisen.filter((bw) => { const t = rd('content/buehnen/bauweisen/' + bw + '.json'); return !t.kits || !t.kits[kind]; });
    ok(!fehlt.length, `kits.${kind} in allen Bauweisen (${bauweisen.length})` + (fehlt.length ? ', fehlt in ' + fehlt.join(', ') : ''));
    const e = R.eintragVon(rd('content/buehnen/bauweisen/rom.json').kits[kind], 'aussenposten');
    ok(e && e.terrain === true && e.id === null, `kits.${kind}: ohne Kit-Teil gekennzeichnet (terrain), der Renderer nimmt den Platzhalter`);
  }
  // jede Kachelart aus kacheln.json hat in der Voxelansicht eine Darstellung: Platzhalter FB.<kind> oder die Bauweise-Tabelle benennt sie (Kit-Teil/leer/terrain)
  const kit = lies('public/js/voxel/kit.js');
  const fbKinds = new Set([...kit.slice(kit.indexOf('\nconst FB = {')).matchAll(/^ {2}([a-z_0-9]+)\(pen, p, F/gm)].map((m) => m[1]));
  const kinds = [...new Set(Object.values(Z).map((z) => z.kind))];
  const ohne = kinds.filter((kd) => !fbKinds.has(kd) && !bauweisen.every((bw) => rd('content/buehnen/bauweisen/' + bw + '.json').kits[kd]) && !['rohr', 'abgrund', 'leere', 'boden2', 'pad', 'plateau', 'rampe', 'grabensohle', 'schutt', 'brustwehr'].includes(kd));
  ok(!ohne.length, 'jede Kachelart hat Platzhalter oder Bauweisen-Eintrag' + (ohne.length ? ': ohne ' + ohne.join(', ') : ` (${kinds.length} Arten)`));
  ok(fbKinds.has('schleier') && fbKinds.has('fluessig'), 'kit.js: Platzhalter FB.schleier und FB.fluessig vorhanden');
  ok(/s: \['schleier'\], a: \['fluessig'\], v: \['fluessig'\]/.test(kit), 'kit.js KACHELN_FB kennt s, a, v');
  ok(/kind === 'fluessig'\) \{ placeKit\(/.test(kit) && /kind === 'schleier'\) \{ placeKit\(/.test(kit), 'kit.js: Hauptschleife setzt schleier und fluessig (ohne Boden unter Wasser/Lava, Strauch auf dem Boden)');
  ok(/variante: z\.variante \|\| null/.test(kit), 'kit.js: info() reicht die variante weiter');
  // Platzhalter unterscheidbar: Lava leuchtet (emit), Wasser nicht
  const fl = kit.slice(kit.indexOf('  fluessig(pen, p, F) {'), kit.indexOf('  rampe(pen, p, F) {'));
  ok(/variante === 'lava'/.test(fl) && /emit: true/.test(fl) && fl.split('return;')[1] && !/emit/.test(fl.split('return;')[1]), 'FB.fluessig: Lava mit Leuchtflächen, Wasser ohne; beide mit fester Farbe');
  // render.js: Rückfall-Tabelle gleich kacheln.json, Farben
  const rd2 = lies('public/js/render.js');
  const tab = rd2.slice(rd2.indexOf('const KACHELN_FB'), rd2.indexOf('for (const [ch, a] of Object.entries(KACHELN_FB))'));
  for (const ch of [STRAUCH, WASSER, LAVA]) {
    const m = new RegExp("'" + ch + "': \\['(\\w+)', (true|false), (\\d), (true|false), (true|false), undefined, undefined, '(\\w+)', '(\\w+)'\\]").exec(tab);
    const z = Z[ch];
    ok(!!m && m[1] === z.kind && (m[2] === 'true') === z.solid && +m[3] === z.cover && (m[4] === 'true') === z.low && (m[5] === 'true') === z.sperrtSicht && m[6] === z.kante && m[7] === z.variante, `render.js KACHELN_FB "${ch}" gleich kacheln.json (${m ? m.slice(1).join(' ') : 'fehlt'})`);
  }
  const farbe = (k) => { const m = new RegExp("(?:\\b|')" + k.replace(':', ':') + "'?: '(#[0-9A-Fa-f]{6})'").exec(rd2.slice(rd2.indexOf('const BUEHNE_FARBE'), rd2.indexOf('function buehneKachelFarbe'))); return m && m[1]; };
  const fS = farbe('schleier'), fW = farbe('fluessig'), fL = farbe('fluessig:lava'), fF = farbe('fels');
  ok(fS && fW && fL && fF && new Set([fS, fW, fL, fF]).size === 4, `render.js BUEHNE_FARBE: Schleier ${fS}, Wasser ${fW}, Lava ${fL} verschieden von Fels ${fF} und untereinander`);
  ok(/info\.kind === 'abgrund'\) return null/.test(rd2) && /BUEHNE_FARBE\[info\.kind \+ ':' \+ info\.variante\]/.test(rd2), 'render.js: Abgrund bleibt unsichtbar (null), Flüssigkeit hat Farbe nach kind und variante');
  ok(/variante: z\.variante/.test(rd2), 'render.js: geladene kacheln.json behält die variante');
}

client().then(() => {
  console.log(`\n${n - fails}/${n} ok`);
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.log('  FEHLER Ausnahme: ' + (e && e.stack || e)); process.exit(1); });
