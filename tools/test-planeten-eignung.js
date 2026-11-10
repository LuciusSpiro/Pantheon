#!/usr/bin/env node
'use strict';
// DYN-01 C: Planeten-Eignung (content/welt/planeten-eignung.json, server/sim/planeten-eignung.js, Anbindung in server/sim/abenteuer-orte.js bestellenAmKoerper).
// Faelle: a) Schema-Pruefer lehnt Mutationen der Datei ab (unbekannte Art/Planetenart, fehlende Planetenart, ...); b) jede Planetenart x jede Kartenart (Datei UND festgeschriebene Entscheidung Kais 2026-11-10);
// c) artenAmHex erkennt alle 27 Planeten von sund_frei (10 fels, 6 ozean, 5 eis, 5 wueste, 1 gasriese), Leerraum nur Punkt-Arten, typ-Hex ueber die Kachel; d) bestellenAmKoerper lehnt Unzulaessiges ab
// (Klartext ueber grundAmKoerper), laesst Zulaessiges durch; e) Beam: die Crew erreicht den Ort am Planeten (chooseLandepunkt, canBeam, Hinbeamen) je Art fels/eis/wueste, und jeder Planet liegt in seiner Szene.
// Mutationsprobe: tools/mutation-planeten-eignung.js (npm run test:planeten-eignung-mutation).
// Aufruf: node tools/test-planeten-eignung.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const Locations = require('../shared/locations.js');
const space = require('../server/sim/space.js');
const away = require('../server/sim/away.js');
const LP = require('../server/sim/landepunkte.js');
const Faden = require('../server/sim/faden.js');
const AO = require('../server/sim/abenteuer-orte.js');
const E = require('../server/sim/planeten-eignung.js');
const ORTE = require('../content/welt/abenteuer-orte.json');
const F = require('./regie-fixture.js');

const ENV = { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', REISE_EREIGNISSE: '1' };
let fehler = 0, n = 0;
const pruefe = async (name, f) => { n++; try { await f(); console.log('✓ ' + name); } catch (e) { fehler++; console.log('✗ ' + name + ': ' + e.message); } };
const klon = (o) => JSON.parse(JSON.stringify(o));
const tick = (k) => new Promise((r) => { let i = 0; const s = () => (++i >= (k || 3) ? r() : setImmediate(s)); setImmediate(s); });

// Entscheidung Kai 2026-11-10 (Empfehlung des Leiters), hier festgeschrieben: ein Eintrag in der Datei ist erst dann geaendert, wenn dieser Test mitgeaendert wird.
const ENTSCHEIDUNG = {
  wueste: ['wildnis', 'aussenposten'], wiesenwald: ['wildnis', 'hoehle', 'aussenposten'], vulkan: ['wildnis', 'hoehle', 'aussenposten'],
  fels: ['wildnis', 'hoehle'], eis: ['wildnis', 'hoehle'], ozean: [], gasriese: [],
};
const PUNKT = ['schiff', 'station'];
const sund = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'welt', 'sund_frei.json'), 'utf8'));

function spiel() {
  const T = F.neuesSpiel({ crew: 1, seed: 7, env: ENV });
  T.run = (sek) => { for (let k = 0; k < Math.round(sek * CONFIG.tickHz); k++) T.g.step(); };
  return T;
}
function abenteuer(g) {
  const Fz = Faden.zustandVon(g); Fz.abenteuerAngebote = [];
  const plan = { format: 'faden-bauplan/1', titel: 'Absturz im Sektor', anlass: 'Ein Schiff ist abgestuerzt und niemand weiss warum.',
    beats: [{ typ: 'bitte', optionen: true, verzweigung: { gescheitert: 'ende' } }, { typ: 'notruf' }, { id: 'ende', typ: 'abschluss' }] };
  const hex = require('../server/sim/marken.js').hexVon(g.ship.scene);
  const a = Faden.abenteuerAnbieten(g, plan, { hex });
  assert.ok(a.ok, 'Angebot: ' + (a.fehler || []).join('; '));
  const r = Faden.abenteuerOeffnen(g, a.angebot.nr, {});
  assert.ok(r.ok, 'Oeffnen: ' + r.grund);
  return r.faden;
}
// alle Planeten der Karte: [{ hex, ort, i, p, sc }]
function allePlaneten() {
  const out = [];
  for (const hx of Object.keys(Sektoren.KARTE.hexe).sort()) {
    const ort = Sektoren.ortVonHex(hx); const l = ort && Locations.get(ort);
    ((l && l.scene && l.scene.planeten) || []).forEach((p, i) => out.push({ hex: hx, ort, i, p, sc: l.scene }));
  }
  return out;
}

(async () => {
  // ---------------- a) Schema ----------------
  await pruefe('a) Schema: die echte Datei ist gueltig; Mutationen (unbekannte Kartenart/Planetenart, fehlende Planetenart, falsches Format, Muell) werden mit Klartext abgelehnt', () => {
    assert.deepStrictEqual(E.pruefe(E.DATEN), [], 'Datei gueltig');
    const mut = (f) => { const d = klon(E.DATEN); f(d); return E.pruefe(d); };
    const hat = (fl, teil, was) => assert.ok(fl.some((s) => s.includes(teil)), `${was}: Fehler mit '${teil}' erwartet, war: ${JSON.stringify(fl)}`);
    hat(mut((d) => d.planetenarten.fels.push('ruine')), "Kartenart 'ruine' unbekannt", 'unbekannte Kartenart');
    hat(mut((d) => d.planetenarten.fels.push('ruine')), "Planetenart 'fels'", 'Fehler nennt die Planetenart');
    hat(mut((d) => { d.punkt = ['schiff', 'raumhafen']; }), "punkt[1]: Kartenart 'raumhafen' unbekannt", 'unbekannte Punkt-Art');
    hat(mut((d) => { d.planetenarten.lava = ['wildnis']; }), "Planetenart 'lava': unbekannt", 'unbekannte Planetenart');
    for (const pa of Object.keys(ENTSCHEIDUNG)) hat(mut((d) => { delete d.planetenarten[pa]; }), `Planetenart '${pa}': fehlt`, 'fehlende Planetenart ' + pa);
    hat(mut((d) => { d.planetenarten.eis = ['wildnis', 'wildnis']; }), 'Kartenart doppelt', 'doppelte Kartenart');
    hat(mut((d) => { d.planetenarten.eis = 'hoehle'; }), 'muss eine Liste', 'Wert keine Liste');
    hat(mut((d) => { d.format = 'x/9'; }), 'format', 'Format');
    hat(mut((d) => { delete d.punkt; }), 'punkt', 'punkt fehlt');
    hat(mut((d) => { delete d.planetenarten; }), 'planetenarten', 'planetenarten fehlt');
    assert.ok(E.pruefe(null).length && E.pruefe([]).length && E.pruefe(7).length, 'Muell statt Objekt');
    // Bindung an die beiden Quellen: Kartenarten aus abenteuer-orte.json, Planetenarten aus sektortypen.json (+ gasriese)
    assert.ok(E.DATEN.punkt.concat(...Object.values(E.DATEN.planetenarten)).every((a) => ORTE.arten.includes(a)), 'Kartenarten sind Teilmenge von abenteuer-orte.json arten');
    const kat = require('../shared/sektortypen.js').katalog().planetenarten;
    assert.deepStrictEqual(Object.keys(E.DATEN.planetenarten).sort(), Object.keys(kat).concat('gasriese').sort(), 'Planetenarten = sektortypen.json + gasriese');
  });

  // ---------------- b) Matrix ----------------
  await pruefe('b) jede Planetenart x jede Kartenart: zulaessig/unzulaessig laut Datei und laut festgeschriebener Entscheidung; unbekannte Planetenart = nicht landbar, wirft nicht', () => {
    assert.deepStrictEqual(E.DATEN.planetenarten, ENTSCHEIDUNG, 'Datei = Entscheidung Kais (2026-11-10)'); assert.deepStrictEqual(E.DATEN.punkt, PUNKT);
    let z = 0;
    for (const pa of Object.keys(ENTSCHEIDUNG)) {
      assert.deepStrictEqual(E.artenFuerPlanet(pa), ENTSCHEIDUNG[pa], 'artenFuerPlanet ' + pa);
      for (const art of ORTE.arten) {
        const soll = ENTSCHEIDUNG[pa].includes(art), ist = E.artPasstAmKoerper(pa, art); z++;
        assert.strictEqual(ist, soll, `${pa} x ${art}`);
        assert.strictEqual(E.grundGegen(pa, art) === null, soll, `Grund ${pa} x ${art}`);
        if (!soll) assert.ok(E.grundGegen(pa, art).includes(`'${art}'`) && E.grundGegen(pa, art).includes(`'${pa}'`), 'Klartext nennt Art und Planetenart');
      }
    }
    assert.strictEqual(z, 7 * ORTE.arten.length);
    for (const art of ['station', 'schiff']) for (const pa of Object.keys(ENTSCHEIDUNG)) assert.strictEqual(E.artPasstAmKoerper(pa, art), false, `${art} gehoert an einen Raumpunkt, nie an ${pa}`);
    for (const pa of ['lava', '', null, undefined, 7, {}, [], '__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
      assert.deepStrictEqual(E.artenFuerPlanet(pa), [], 'unbekannt: ' + String(pa)); assert.strictEqual(E.artPasstAmKoerper(pa, 'wildnis'), false);
      assert.ok(typeof E.grundGegen(pa, 'wildnis') === 'string');
    }
    const kopie = E.artenFuerPlanet('fels'); kopie.push('x'); assert.deepStrictEqual(E.artenFuerPlanet('fels'), ENTSCHEIDUNG.fels, 'Auskunft ist eine Kopie');
  });

  // ---------------- c) artenAmHex ----------------
  await pruefe('c) artenAmHex: alle 27 Planeten von sund_frei erkannt (fels 10, ozean 6, eis 5, wueste 5, gasriese 1); Leerraum und unbekannter Hex; typ-Hex ueber die Kachel', () => {
    spiel();   // setzt die Karte sund_frei
    const zaehl = {}; let gesamt = 0;
    for (const hx of Object.keys(Sektoren.KARTE.hexe)) {
      const r = E.artenAmHex(hx); const ort = Sektoren.ortVonHex(hx); const roh = ((ort && Locations.get(ort) && Locations.get(ort).scene.planeten) || []);
      assert.strictEqual(r.koerper.length, roh.length, 'Planetenzahl ' + hx);
      r.koerper.forEach((k, i) => { assert.strictEqual(k.id, i); assert.strictEqual(k.planetenart, roh[i].art); assert.deepStrictEqual(k.arten, ENTSCHEIDUNG[roh[i].art], `Arten ${hx}/${i}`); zaehl[k.planetenart] = (zaehl[k.planetenart] || 0) + 1; gesamt++; });
      assert.deepStrictEqual(r.punkt, roh.length || ort ? PUNKT : [], 'Punkt-Arten ' + hx);
    }
    assert.strictEqual(gesamt, 27); assert.deepStrictEqual(zaehl, { fels: 10, ozean: 6, eis: 5, wueste: 5, gasriese: 1 });
    assert.strictEqual(allePlaneten().length, 27);
    const skj = E.artenAmHex('0904'); assert.deepStrictEqual(skj.koerper.map((k) => k.planetenart), ['ozean', 'wueste']); assert.deepStrictEqual(skj.koerper[1].arten, ['wildnis', 'aussenposten']); assert.deepStrictEqual(skj.koerper[0].arten, []);
    // Leerraum: Hex im Raster ohne Eintrag -> keine Koerper, nur Punkt-Arten
    let leer = null; for (let x = 1; x <= 12 && !leer; x++) for (let y = 1; y <= 12 && !leer; y++) { const hx = String(x).padStart(2, '0') + String(y).padStart(2, '0'); if (Sektoren.istLeerraum(hx)) leer = hx; }
    assert.ok(leer, 'ein Leerraum-Hex existiert'); assert.deepStrictEqual(E.artenAmHex(leer), { koerper: [], punkt: PUNKT }, 'Leerraum ' + leer);
    for (const hx of ['9999', 'xx', '', null, undefined, 5, {}]) assert.deepStrictEqual(E.artenAmHex(hx), { koerper: [], punkt: [] }, 'kein Hex der Karte: ' + String(hx));
    const aus = E.artenAmHex('0904'); aus.punkt.push('x'); aus.koerper.length = 0; assert.deepStrictEqual(E.artenAmHex('0904').punkt, PUNKT, 'Kopie');
    // typ-Hex (KAC-01): die Kachel entscheidet; Kulisse (nicht landbar) hat keine Arten
    const karte = klon(sund); karte.hexe['0103'] = { name: 'Test 0103', region: 'rom', spielbar: true, typ: ['planet', 'planet', 'station'], fraktion: 'rom' };
    Sektoren.setzeKarte(karte);
    try {
      const r = E.artenAmHex('0103'); assert.ok(r.koerper.length >= 1 && r.koerper.length <= 3, 'Koerper der Kachel'); assert.deepStrictEqual(r.punkt, PUNKT);
      for (const k of r.koerper) {
        assert.ok(typeof k.id === 'string' && k.id.startsWith('k'), 'Kachel-Id');
        const d = LP.kachelDef('k_0103.' + k.id); assert.deepStrictEqual(k.arten, d ? [d.art] : [], 'Arten = Kartenart der Kachel ' + k.id);
      }
      assert.ok(r.koerper.some((k) => k.arten.length), 'ein landbarer Koerper');
    } finally { Sektoren.setzeKarte(klon(sund)); }
  });

  // ---------------- d) bestellenAmKoerper ----------------
  await pruefe('d) bestellenAmKoerper: unzulaessige Kartenart je Planet abgelehnt (null, kein Ort, nichts im Faden), zulaessige angelegt; grundAmKoerper nennt den Grund im Klartext', async () => {
    const T = spiel(), g = T.g; const f = abenteuer(g);
    const dyn = () => Object.keys((g.landepunkte && g.landepunkte.dyn) || {}).filter((id) => AO.parse(id));
    let abgelehnt = 0, angelegt = 0;
    for (const { ort, i, p } of allePlaneten()) {
      for (const art of ORTE.arten) {
        const erlaubt = ENTSCHEIDUNG[p.art].includes(art); const o = { ort, koerper: i, art };
        const grund = AO.grundAmKoerper(o);
        if (!erlaubt) {
          assert.ok(typeof grund === 'string' && grund.includes(`'${art}'`) && grund.includes(`'${p.art}'`), `${ort}/${i} ${p.art} x ${art}: Klartext (${grund})`);
          assert.strictEqual(AO.bestellenAmKoerper(g, f.id, o), null, `${ort}/${i} ${p.art} x ${art} abgelehnt`); abgelehnt++;
          assert.deepStrictEqual(dyn(), [], 'kein Ort entstanden'); assert.ok(!(Faden.zustandVon(g).liste[0].orte || []).length, 'nichts im Faden');
        } else {
          assert.strictEqual(grund, null, `${ort}/${i} ${p.art} x ${art} zulaessig`);
        }
      }
    }
    assert.strictEqual(abgelehnt, 95, 'Ablehnungen: fels 10x3, eis 5x3, wueste 5x3, ozean 6x5, gasriese 1x5');
    // zulaessige Bestellung je Planetenart gelingt und wird abgeraeumt (Ablauf selbst: test-abenteuer-orte.js)
    for (const [pa, ort, i] of [['wueste', 'skjaldborg', 1], ['fels', 'kaupangr', 0], ['eis', 'vulcania', 0]]) {
      for (const art of ENTSCHEIDUNG[pa]) {
        const id = AO.bestellenAmKoerper(g, f.id, { ort, koerper: i, art }); assert.ok(id, `${pa} ${art} bestellt`); angelegt++;
        assert.strictEqual(g.landepunkte.dyn[id].art, art); assert.strictEqual(AO.abraeumen(g, f.id), true);
      }
    }
    assert.strictEqual(angelegt, 6);
    // Ozean und Gasriese: gar nichts am Koerper; die Punkt-Arten gehen am Raumpunkt
    for (const [ort, i] of [['skjaldborg', 0], ['gasfeld', 0]]) for (const art of ORTE.arten) assert.strictEqual(AO.bestellenAmKoerper(g, f.id, { ort, koerper: i, art }), null, `${ort}/${i} ${art}`);
    const p = AO.bestellenAmPunkt(g, f.id, { ort: 'skjaldborg', x: 1400, y: 1000, art: 'station' }); assert.ok(p, 'station am Raumpunkt'); assert.strictEqual(AO.abraeumen(g, f.id), true);
    // grundAmKoerper: Ort/Koerper unbekannt, Muell
    assert.ok(/unbekannt/.test(AO.grundAmKoerper({ ort: 'gibtsnicht', koerper: 0, art: 'wildnis' }))); assert.ok(/gibt es/.test(AO.grundAmKoerper({ ort: 'skjaldborg', koerper: 9, art: 'wildnis' })));
    assert.ok(typeof AO.grundAmKoerper(null) === 'string'); assert.ok(typeof AO.grundAmKoerper({ ort: 'skjaldborg', koerper: 1, art: 'ruine' }) === 'string');
    // typ-Hex: die Eignungsliste gilt nicht, die Kachel entscheidet (KAC-01 unveraendert)
    const karte = klon(sund); karte.hexe['0103'] = { name: 'Test 0103', region: 'rom', spielbar: true, typ: ['planet', 'planet', 'station'], fraktion: 'rom' };
    Sektoren.setzeKarte(karte);
    try {
      space.enterScene(g, 'k_0103', {}); T.run(0.3);
      assert.strictEqual(AO.grundAmKoerper({ ort: 'k_0103', koerper: 'k0', art: 'wildnis' }), null);
      assert.strictEqual(AO.bestellenAmKoerper(g, f.id, { ort: 'k_0103', koerper: 'k0', art: 'wildnis' }), 'k_0103.k0');
    } finally { Sektoren.setzeKarte(klon(sund)); }
  });

  // ---------------- e) Beam ----------------
  await pruefe('e) Beam am Planeten: je Planet fels/eis/wueste liegt der Transferpunkt im Sektor, die Crew erreicht ihn mit Abstand Radius+150 (ausserhalb des Planeten), waehlt, canBeam, beamt runter und hoch; alle 27 Planeten liegen in ihrer Szene', async () => {
    const alle = allePlaneten(); assert.strictEqual(alle.length, 27);
    for (const { hex, i, p, sc } of alle) assert.ok(p.x > 0 && p.y > 0 && p.x < sc.w && p.y < sc.h, `Planet ${hex}/${i} (${p.art}) liegt in der Szene ${sc.w}x${sc.h}`);
    const nach = (id, ang) => { const b = LP.info(T.g, id).beam; return { x: b.x + Math.cos(ang) * (b.range - 50), y: b.y + Math.sin(ang) * (b.range - 50), b }; };
    const T = spiel(), g = T.g; const f = abenteuer(g);
    const stehen = (x, y) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; if (s.helm) { s.helm.thrust = 0; s.helm.turn = 0; } T.run(0.2); };
    const faelle = [['wueste', 'skjaldborg', 1, 'aussenposten'], ['fels', 'kaupangr', 0, 'hoehle'], ['fels', 'speculum', 1, 'wildnis'], ['eis', 'vulcania', 0, 'wildnis'], ['eis', 'brachland', 1, 'hoehle']];
    for (const [pa, ort, i, art] of faelle) {
      space.enterScene(g, ort, { docked: false }); T.run(0.3);
      const p = Locations.get(ort).scene.planeten[i]; assert.strictEqual(p.art, pa);
      const id = AO.bestellenAmKoerper(g, f.id, { ort, koerper: i, art }); assert.ok(id, `${ort}/${i} ${art} bestellt`);
      const b = LP.info(g, id).beam; assert.deepStrictEqual(b, { x: Math.round(p.x), y: Math.round(p.y), range: Math.round(p.r + AO.DATEN.koerper.beam_zuschlag) }, 'Transferpunkt = Planetenmitte, Reichweite Radius + beam_zuschlag');
      assert.ok(b.range > p.r, 'Reichweite reicht ueber den Planeten hinaus (der Rand ist erreichbar)');
      await tick(5);
      // Schiff am aeusseren Rand der Reichweite (nicht im Planeteninneren, kein Weg durch den Planeten noetig); in jede Himmelsrichtung, die in der Szene liegt
      let versucht = 0;
      for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const s = nach(id, ang); const sc = Locations.get(ort).scene; if (s.x < 60 || s.y < 60 || s.x > sc.w - 60 || s.y > sc.h - 60) continue;
        stehen(s.x, s.y); versucht++;
        assert.ok(Math.hypot(g.ship.x - p.x, g.ship.y - p.y) > p.r, 'Schiff steht ausserhalb des Planeten');
        assert.strictEqual(g.chooseLandepunkt(g.players[0], id), null, `${ort}/${i} chooseLandepunkt (Winkel ${ang.toFixed(2)})`);
        assert.deepStrictEqual(away.canBeam(g, 'down'), { ok: true }, `${ort}/${i} canBeam am Rand`);
      }
      assert.ok(versucht >= 1, `${ort}/${i}: mindestens ein Randpunkt in der Szene`);
      // zu weit weg: nicht erreichbar (die Reichweite ist begrenzt, kein Freibrief)
      stehen(b.x + b.range + 120 < Locations.get(ort).scene.w - 60 ? b.x + b.range + 120 : b.x - b.range - 120, b.y); const weit = away.canBeam(g, 'down'); assert.strictEqual(weit.ok, false, 'ausserhalb der Reichweite nicht erreichbar');
      // volle Runde einmal pro Art: runter, hoch
      stehen(Math.min(b.x + b.range - 50, Locations.get(ort).scene.w - 60), b.y); assert.strictEqual(g.chooseLandepunkt(g.players[0], id), null);
      assert.deepStrictEqual(away.canBeam(g, 'down'), { ok: true });
      away.executeBeam(g, g.players.map((q) => q.id), 'down'); T.run(0.5); assert.strictEqual(g.players[0].zone, 'away', `${ort}/${i} unten`);
      away.executeBeam(g, g.players.map((q) => q.id), 'up'); T.run(0.5); assert.strictEqual(g.players[0].zone, 'ship', `${ort}/${i} wieder oben`);
      assert.strictEqual(AO.abraeumen(g, f.id), true, 'abgeraeumt');
    }
  });

  console.log(`\n${n - fehler}/${n} Pruefungen gruen`);
  process.exit(fehler ? 1 : 0);
})().catch((e) => { console.log('✗ Absturz: ' + (e && e.stack || e)); process.exit(1); });
