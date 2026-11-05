#!/usr/bin/env node
'use strict';
// GEL-02 F: Gesamtnachweis der Abnahmekriterien 1 bis 5 und 7 (Werkzeug, kein Produkttest). Prüft die Kriterien einzeln gegen den Stand und gibt
// eine Tabelle mit Beleg aus. Kriterien 6 und 8 stehen in tools/gel02-tickmess.js und tools/test-hoehle-gruppenlauf.js.
//   node tools/gel02-abnahme.js [--ohne-browser] [--ketten]
//   --ohne-browser  überspringt die zwei Browserläufe (Kriterium 3, je mehrere Minuten)
//   --ketten        führt zusätzlich `run-tests --parallel --stufe fast` und `run-tests --kette check` aus (Zahl roter Schritte)
// Exit 0, wenn alle Kriterien erfüllt sind, sonst 1.
const { spawnSync } = require('child_process');
const path = require('path');
const Buehne = require('../shared/buehne.js');
const Hoehle = require('../shared/gen-hoehle.js');
const Gelaende = require('../shared/gen-gelaende.js');
const Protocol = require('../shared/protocol.js');
const combat = require('../server/sim/combat.js');
const { Game } = require('../server/game.js');
const H = require('./gel02-hilfen.js');

const args = process.argv.slice(2);
const OHNE_BROWSER = args.includes('--ohne-browser'), KETTEN = args.includes('--ketten');
const ROOT = path.join(__dirname, '..');
const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const seedVon = (i) => 101 + i * 7919;
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const tabelle = [];
const eintrag = (nr, kriterium, gruen, beleg) => { tabelle.push({ nr, kriterium, gruen, beleg }); console.log(`  [${gruen ? 'ok ' : 'ROT'}] ${nr}: ${beleg}`); };

function lauf(datei, extra, env) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join('tools', datei)].concat(extra || []), { cwd: ROOT, env: Object.assign({}, process.env, env || {}), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 25 * 60 * 1000 });
  const zeilen = ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  return { datei, exit: r.status, s: Math.round((Date.now() - t0) / 1000), zeilen, ende: [...zeilen].reverse().find((z) => /\d+\/\d+.*ok|\bOK\b/i.test(z) && !/^ok /.test(z)) || zeilen.slice(-1)[0] || '' };
}
const beleg = (r) => `${r.datei} Exit ${r.exit} (${r.s} s): ${r.ende.slice(0, 160)}`;

// Fallback wie der Aufrufer (Wurf oder Prüferfehler: Seed + 1, bis 6 Versuche)
function bauen(erz, seed, opts) {
  for (let v = 0; v < 6; v++) {
    let roh; try { roh = erz.karteRoh(seed + v, opts); } catch (e) { continue; }
    const r = Buehne.ausRaster(roh, { spiel: true });
    if (!r.fehler.length) return { roh, r, v };
  }
  return null;
}
// Flutfüllung (unabhängig vom Prüfer) über Boden, optional über Links
function flut(roh, sx, sy, links) {
  const w = roh.w, h = roh.rows.length, seen = new Uint8Array(w * h);
  const geh = (x, y) => x >= 0 && y >= 0 && x < w && y < h && ':s,'.includes(roh.rows[y][x]);
  const q = [sy * w + sx]; seen[q[0]] = 1;
  const lk = new Map();
  if (links) for (const l of roh.decks.links) { lk.set(l.a[1] * w + l.a[0], l.b[1] * w + l.b[0]); lk.set(l.b[1] * w + l.b[0], l.a[1] * w + l.a[0]); }
  for (let i = 0; i < q.length; i++) {
    const u = q[i], ux = u % w, uy = (u - ux) / w, nach = [];
    for (const [dx, dy] of N4) if (geh(ux + dx, uy + dy)) nach.push((uy + dy) * w + ux + dx);
    if (lk.has(u)) nach.push(lk.get(u));
    for (const v of nach) if (!seen[v]) { seen[v] = 1; q.push(v); }
  }
  return seen;
}

console.log('GEL-02 Abnahme-Nachweis (Stand ' + spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() + ')\n');

// ---- 1: eigene Höhle, 50 Seeds je Größe ----
{
  const teil = [];
  let rot = 0;
  for (const gr of Object.keys(Hoehle.GROESSEN)) {
    let nichtGebaut = 0, ersatz = 0, kammerFehl = 0, fundFehl = 0, ankerFehl = 0, kammern = 0, funde = 0;
    for (let i = 0; i < 50; i++) {
      const b = bauen(Hoehle.erzeuger(), seedVon(i), { groesse: gr });
      if (!b) { nichtGebaut++; continue; }
      if (b.v > 0) ersatz++;
      const roh = b.roh, ab = roh.anker.find((a) => a.id === roh.ankunft);
      const seen = flut(roh, ab.x, ab.y, false);
      const ok = (a) => seen[a.y * roh.w + a.x];
      for (const a of roh.anker) if (!ok(a)) ankerFehl++;
      for (const a of roh.anker.filter((x) => x.rolle === 'fund')) { funde++; if (!ok(a)) fundFehl++; }
      for (const [id, bb] of Object.entries(roh.bereiche)) {
        if (!bb.gefecht) continue;
        kammern++;
        // Kammer erreichbar: mindestens eine erreichbare Bodenkachel im Bereichsrechteck, und alle ihre Anker erreichbar
        let drin = false;
        for (const r of bb.rects) for (let y = r[1]; y < r[1] + r[3] && !drin; y++) for (let x = r[0]; x < r[0] + r[2]; x++) if (seen[y * roh.w + x]) { drin = true; break; }
        if (!drin) kammerFehl++;
      }
    }
    teil.push(`${gr}: 50 Seeds, ungebaut ${nichtGebaut}, Seed+1-Ersatz ${ersatz}, Kammern ${kammern} (nicht erreichbar ${kammerFehl}), Funde ${funde} (nicht erreichbar ${fundFehl}), Anker nicht erreichbar ${ankerFehl}`);
    rot += nichtGebaut + kammerFehl + fundFehl + ankerFehl;
  }
  eintrag(1, 'Eigene Höhle: 50 Seeds je Größe, Prüfer, Kammern und Funde erreichbar', rot === 0, 'Prüfer (Buehne.ausRaster spiel:true) ohne Fehler und eigene Flutfüllung ab Ankunft; ' + teil.join(' | '));
}

// ---- 2: Wildnis mit Höhle, 50 Seeds klein + mittel ----
{
  const teil = []; let rot = 0, payMax = 0;
  for (const gr of ['klein', 'mittel']) {
    let nichtGebaut = 0, deckFehl = 0, endeFehl = 0, ersatz = 0; const pl = [];
    for (let i = 0; i < 50; i++) {
      const biom = Gelaende.BIOME[i % 3];
      const b = bauen(Gelaende.erzeuger(), seedVon(i), { groesse: gr, biom, hoehle: true });
      if (!b) { nichtGebaut++; continue; }
      if (b.v > 0) ersatz++;
      if (b.r.fehler.some((f) => f.code === 'K-DECK')) deckFehl++;
      const roh = b.roh, ab = roh.anker.find((a) => a.ankunft);
      const l = roh.decks.links[0], seen = flut(roh, ab.x, ab.y, true), seenOhne = flut(roh, ab.x, ab.y, false);
      const a = l.a, c = l.b;
      // beide Enden erreichbar (oben direkt, unten nur über den Link); der Link ist die einzige Verbindung
      if (!seen[a[1] * roh.w + a[0]] || !seen[c[1] * roh.w + c[0]] || !seenOhne[a[1] * roh.w + a[0]] || seenOhne[c[1] * roh.w + c[0]]) endeFehl++;
      pl.push(payloadB(b.r.karte));
    }
    const max = Math.max(...pl); payMax = Math.max(payMax, max);
    teil.push(`${gr}: 50 Seeds (Biome reihum), ungebaut ${nichtGebaut}, Seed+1-Ersatz ${ersatz}, K-DECK-Fehler ${deckFehl}, Link-Enden nicht erreichbar ${endeFehl}, awayMap min/Median/max ${Math.min(...pl)}/${pl.slice().sort((x, y) => x - y)[pl.length >> 1]}/${max} B`);
    rot += nichtGebaut + deckFehl + endeFehl;
  }
  eintrag(2, 'Wildnis mit Höhle: 50 Seeds klein+mittel, Link-Enden erreichbar, K-DECK grün, awayMap <= 16 384 B', rot === 0 && payMax <= 16384 && payMax < Protocol.AWAY_MAP_MAX_BYTES, `Messwert max ${payMax} B (Grenze 16 384, Protokoll ${Protocol.AWAY_MAP_MAX_BYTES}); ` + teil.join(' | '));
}

// ---- 3: Browserläufe ----
if (OHNE_BROWSER) eintrag(3, 'Fahrt Oberfläche <-> Höhle im echten Browser', false, 'ÜBERSPRUNGEN (--ohne-browser)');
else {
  const a = lauf('test-wildnis-hoehle-client.js'), b = lauf('test-hoehle-client.js');
  eintrag(3, 'Fahrt Oberfläche <-> Höhle im echten Browser, players[].deck', a.exit === 0 && b.exit === 0, beleg(a) + ' || ' + beleg(b));
}

// ---- 4 und 5: Kindläufe ----
const wh = lauf('test-wildnis-hoehle.js', [], { VERBOSE: '1' }), hv = lauf('test-hoehle-verdrahtung.js'), db = lauf('test-deck-bindung.js');
eintrag(4, 'Determinismus, Speichern und Laden (Weltstand, beide Decks)', wh.exit === 0 && hv.exit === 0, beleg(wh) + ' || ' + beleg(hv));
eintrag(5, 'Gegner nehmen den Link nach oben nicht (60 s), Spieler können jederzeit zurück', wh.exit === 0 && db.exit === 0, beleg(wh) + ' (g: 60 s Bindung inkl. Gegenprobe ohne Bindung; f: Leiter hin und zurück) || ' + beleg(db));

// ---- 7: Hash-Baseline, Fixture, Kollision ----
{
  const hb = lauf('hash-baseline.js', ['--compare', '--karten', '--ohne-zeichen', 's,a,v']);
  const karten = hb.zeilen.find((z) => /karten:/.test(z)) || hb.ende;
  eintrag('7a', 'Bestehende Karten byteweise unverändert (Hash-Baseline)', hb.exit === 0 && /72\/72/.test(karten), `npm run hash:karten: ${karten} (Exit ${hb.exit})`);
  const fx = wh.zeilen.find((z) => /ohne hoehle: \d+\/360/.test(z));
  const fxOk = !!fx && /ohne hoehle: 360\/360/.test(fx) && wh.exit === 0;
  eintrag('7b', 'Wildnis-sha1-Fixture tools/fixtures/wildnis-basis.json (360 Karten)', fxOk, `test-wildnis-hoehle Abschnitt a), Exit ${wh.exit}: ${fx ? fx.replace(/^ok\s+/, '').slice(0, 130) : 'Zeile nicht gefunden'}`);
  // Kollision: jedes Gegenständliche in rows (Fels F, Steine o/O, Wasser a) ist für Spieler/Gegner undurchdringlich (combat.env solid), Boden , nicht
  let falsch = 0, pruef = 0; const karten7 = [];
  for (const par of [{ art: 'hoehle', seed: 5, groesse: 'mittel' }, { art: 'hoehle', seed: 6, groesse: 'klein' }, { art: 'hoehle', seed: 7, groesse: 'gross' },
    { art: 'wildnis', seed: 11, groesse: 'mittel', biom: 'wueste', hoehle: true }, { art: 'wildnis', seed: 12, groesse: 'klein', biom: 'wiesenwald', hoehle: true }, { art: 'wildnis', seed: 13, groesse: 'mittel', biom: 'vulkan', hoehle: true }]) {
    const { g, k } = H.neuesSpiel(1, par); const E = combat.env(g);
    for (let y = 0; y < k.h; y++) for (let x = 0; x < k.w; x++) {
      const c = k.rows[y][x];
      if ('FoOa'.includes(c)) { pruef++; if (!E.solid(x, y)) falsch++; } else if (c === ',') { pruef++; if (E.solid(x, y)) falsch++; }
    }
    karten7.push(par.art + par.seed);
  }
  eintrag('7c', 'Kein Gegenstand ohne Kollisionsbox (Raster: Fels, Steine, Wasser solid, Boden begehbar)', falsch === 0, `${pruef} Kacheln auf ${karten7.length} Karten (${karten7.join(', ')}) per combat.env.solid geprüft, ${falsch} Abweichungen; Deko ohne Kollision (Bodenbewuchs, Licht) liegt nicht in rows und wird von test-hoehle-client geprüft`);
}

// ---- Ketten ----
if (KETTEN) {
  for (const [name, a] of [['fast', ['--parallel', '--stufe', 'fast']], ['check', ['--parallel', '--kette', 'check']]]) {
    const r = lauf('run-tests.js', a);
    const rote = r.zeilen.filter((z) => /^\s*(ROT|FAIL|✗)/.test(z));
    console.log(`  run-tests ${name}: Exit ${r.exit} (${r.s} s), ${r.ende}; rote Zeilen ${rote.length}${rote.length ? ': ' + rote.slice(0, 6).join(' | ') : ''}`);
  }
}

console.log('\nAbnahme  Kriterium                                                                                 Ergebnis');
for (const t of tabelle) console.log(`${String(t.nr).padEnd(8)} ${t.kriterium.slice(0, 92).padEnd(92)} ${t.gruen ? 'erfüllt' : 'OFFEN/ROT'}`);
console.log('\nKriterium 6 (Tick-Zeit): node tools/gel02-tickmess.js; Kriterium 8 (Gruppenlauf): node tools/test-hoehle-gruppenlauf.js');
process.exit(tabelle.every((t) => t.gruen) ? 0 : 1);
