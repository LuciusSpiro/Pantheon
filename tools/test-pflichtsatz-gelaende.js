#!/usr/bin/env node
'use strict';
// SPL-01 a1: Pflichtsatz der Gelände-Erzeuger (Wildnis, Höhle) gegen Sweep und Katalog, nicht gegen den Erzeuger allein.
//  1. Sweep: je Kartenart >= 50 Seeds (Wildnis: 3 Biome x 3 Größen, Höhle: 2 Größen, Wildnis+Höhle: 3 Biome x 2 Größen):
//     die tatsächliche Anzahl der Anker je Rolle ist >= Pflichtsatz, den der Spielleiter-Kontext zusagt (nicht der Erzeuger-Konstante).
//  2. Soll-Satz fest im Test (Katalog: Umsetzungen mit Anker wache verlangen bis zu min 2 .. 3): wache >= 3 für wildnis und hoehle.
//  3. Kontext: eine Umsetzung mit buehne_braucht { kartenarten: [wildnis|hoehle], anker: [wache] } ist dort passend (vorher unsichtbar).
// Aufruf: node tools/test-pflichtsatz-gelaende.js     (Mutationsprobe: tools/mutation-pflichtsatz-gelaende.js)
const Gelaende = require('../shared/gen-gelaende.js');
const Hoehle = require('../shared/gen-hoehle.js');
const Context = require('../server/mission/context.js');
const Katalog = require('../server/mission/katalog.js');
const SB = require('../server/mission/szenenbau.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } };
const SEEDS = 50;

const katalog = Katalog.load({});
const ctx = Context.build({}, {}, katalog);
const zusage = (art) => ((ctx.kartenarten || []).find((x) => x.id === art) || {}).pflichtsatz || {};

// 2. Soll-Satz aus dem Katalog: höchster verlangter Anker-Mindestwert je Rolle über alle Umsetzungen (min.<rolle>), Rolle wache muss gedeckt sein
const katMin = {};
for (const m of Object.values(katalog.molekuele || {})) for (const u of m.umsetzungen || []) {
  const bb = u.buehne_braucht; if (!bb || typeof bb !== 'object') continue;
  for (const r of bb.anker || []) katMin[r] = Math.max(katMin[r] || 0, (bb.min && bb.min[r]) || 1);
}
ok(katMin.wache >= 2, 'Katalog verlangt wache (min ' + katMin.wache + ')');
const SOLL = { wildnis: { abholpunkt: 1, fund: 2, deckung: 4, wache: 3 }, hoehle: { abholpunkt: 1, fund: 2, deckung: 4, wache: 3, abbau: 4 } };
for (const art of ['wildnis', 'hoehle']) {
  const z = zusage(art);
  for (const [r, v] of Object.entries(SOLL[art])) ok(z[r] >= v, `Kontext sagt für ${art} ${r} >= ${v} zu (ist ${z[r]})`);
  ok((z.wache || 0) >= (katMin.wache || 0), `${art}: wache-Zusage deckt den Katalog-Bedarf (${z.wache} >= ${katMin.wache})`);
}

// 3. Kontext: wache-Umsetzung für Gelände sichtbar
const env = SB.buildEnv(katalog);
const wache = (arten, min) => ({ params: {}, buehne_braucht: Object.assign({ kartenarten: arten, anker: ['wache'] }, min ? { min: { wache: min } } : {}) });
for (const art of ['wildnis', 'hoehle']) {
  const andere = art === 'wildnis' ? 'hoehle' : 'wildnis';
  const r = SB.passendeLandepunkte(wache([art]), env, ctx, {});
  ok(r.neu.includes(art) && !r.neu.includes(andere), `Kontext: Umsetzung mit Anker wache zeigt ${art} als passend (neu: ${r.neu.join('/')})`);
  ok(SB.passendeLandepunkte(wache([art], 3), env, ctx, {}).neu.includes(art), `Kontext: wache min 3 für ${art} erfüllt`);
  ok(!SB.passendeLandepunkte(wache([art], 4), env, ctx, {}).neu.includes(art), `Kontext: wache min 4 für ${art} nicht zugesagt`);
}
// Vorgabenblock (Prompt): dieselbe Umsetzung als Katalogeintrag erscheint mit wildnis/hoehle
{
  const kat = JSON.parse(JSON.stringify(katalog));
  const u = Object.values(kat.molekuele).flatMap((m) => m.umsetzungen).find((x) => x.schauplatz === 'aussen' && x.buehne_braucht && x.status === 'verfuegbar');
  ok(!!u, 'Katalog hat eine verfügbare Außen-Umsetzung mit buehne_braucht');
  if (u) {
    u.buehne_braucht = { kartenarten: ['wildnis', 'hoehle'], anker: ['wache'] };
    const k2 = Object.assign({}, ctx, { orte: [{ id: 'kesh', landepunkte: [{ id: 'kesh.wildnis-1', art: 'wildnis' }] }] });
    const text = SB.grobplanVorgaben(SB.buildEnv(kat), k2, {});
    const zeile = text.split('\n').find((l) => l.startsWith('- ') && l.includes('/' + u.id + ':')) || '';
    ok(/wildnis\/hoehle/.test(zeile), 'Vorgabenblock nennt wildnis/hoehle für die wache-Umsetzung (' + zeile.slice(0, 120) + ')');
  }
}
// Ohne gültige Zusage im Kontext ist der Sweep sinnlos (und die Mutationsprobe schneller)
if (bad) { console.log(`test-pflichtsatz-gelaende: ${n - bad}/${n} ok (Sweep übersprungen)`); process.exit(1); }

// 1. Sweep gegen die Zusage des Kontexts
function zaehle(karte, nurOberflaeche) {
  const z = {};
  const grenze = nurOberflaeche && karte.decks ? karte.decks.stride : Infinity;
  for (const a of karte.anker) if (a.y < grenze) z[a.rolle] = (z[a.rolle] || 0) + 1;
  return z;
}
function sweep(name, art, varianten, bauen) {
  const zus = zusage(art); let karten = 0, minWache = Infinity, fehl = 0, wirft = 0;
  for (const v of varianten) for (let s = 1; s <= SEEDS && !fehl; s++) {
    let k; try { k = bauen(s * 37 + 11, v); } catch (e) { wirft++; continue; }
    karten++;
    for (const nurOben of [false, true]) {
      const z = zaehle(k, nurOben);
      if (!nurOben) minWache = Math.min(minWache, z.wache || 0);
      for (const [r, soll] of Object.entries(zus)) {
        if (r === 'leiter' || r === 'lift') continue;
        if ((z[r] || 0) < soll) { fehl++; if (fehl <= 5) console.log(`    ${name} ${JSON.stringify(v)} Seed ${s * 37 + 11}: ${r} ${z[r] || 0} < ${soll}${nurOben ? ' (Oberfläche)' : ''}`); }
      }
    }
  }
  ok(wirft === 0, `${name}: ${wirft} Würfe des Erzeugers`);
  ok(karten === varianten.length * SEEDS && fehl === 0, `${name}: ${karten} Karten, ${fehl} Unterschreitungen des Pflichtsatzes (kleinste wache-Zahl ${minWache}, Zusage ${zus.wache})`);
}
const G = Gelaende.erzeuger(), H = Hoehle.erzeuger();
const biome = Gelaende.BIOME, gr3 = ['klein', 'mittel', 'gross'], gr2 = Gelaende.HOEHLE_GROESSEN;
const kreuz = (a, b, f) => a.flatMap((x) => b.map((y) => f(x, y)));
sweep('Wildnis', 'wildnis', kreuz(biome, gr3, (biom, groesse) => ({ biom, groesse })), (seed, v) => G.karteRoh(seed, v));
sweep('Höhle', 'hoehle', gr3.concat().filter((g) => Hoehle.GROESSEN[g]).map((groesse) => ({ groesse })), (seed, v) => H.karteRoh(seed, v));
sweep('Wildnis+Höhle', 'wildnis', kreuz(biome, gr2, (biom, groesse) => ({ biom, groesse, hoehle: true })), (seed, v) => G.karteRoh(seed, v));

console.log(`test-pflichtsatz-gelaende: ${n - bad}/${n} ok`);
process.exit(bad ? 1 : 0);
