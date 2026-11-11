#!/usr/bin/env node
'use strict';
// SPL-01 b1: Fund-Szenen auf Wildnis und Hoehle als reine Katalog-DATEN (personen_bergen/ueberlebende_suchen, ladung_bergen/ladung_am_boden,
// ladung_bergen/absturzstelle). Kein Typname, keine Szenenlogik im Servercode: der Test liest nur Katalog, Pruefer (szenenbau.aufloesen),
// Generatoren und Bot-Laeufe (tools/sim-headless.js labor).
//  1. Katalog: verfuegbar, Kartenarten wildnis+hoehle, Anker nur aus dem Pflichtsatz BEIDER Generatoren (gegen den Katalog, nicht gegen sich selbst),
//     kein tor/eingang/terminal/zelle/nsc, kein Szenentyp- oder Fraktionsname im Code (Steckbrief-No-Go: kein Treffer im Servercode).
//  2. Pruefer-Sweep: jede Umsetzung x (Wildnis in drei Biomen, Hoehle, Wildnis+Hoehle) x 50 Seeds, 0 Pruefer-Fehler (BUEHNE-ART, BUEHNE-ANKER, FRAKTION, PARAM-WERT ...).
//  3. Unpassende Kartenarten (aussenposten, station, ruine, schiff): BUEHNE-ART. Besitz rom/ger/herrenlos/rostmeute auf Gelaende: FRAKTION-gueltig.
//  4. Person: erster deckung-Anker (dort stellt ueberlebende_suchen die Person hin) liegt auf Deck 0, ist begehbar und vom Abholpunkt erreichbar;
//     ein E genuegt zum Versorgen (kein Fund-Hold davor, anders als beim Anker fund). Gegenprobe: auf fund haelt E zuerst den Fund (Befund, deshalb deckung).
//  5. Mock-Rueckfall: bei faelliger Bodenquote bleibt die erste Boden-Umsetzung fund_aus_gewoelbe (die Reihenfolge der neuen Umsetzungen aendert sie nicht).
//  6. Bot-/Gruppenlauf (sim-headless labor, Crew 3, Wildnis und Hoehle): Bedingung erfuellt, 0 Fehler, 0 Softlock, 0 Skips.
//   node tools/test-spl-gelaende-szenen.js
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const M = require('./lib/messe-spl.js');
const Katalog = require('./katalog.js');
const SB = require('../server/mission/szenenbau.js');
const Context = require('../server/mission/context.js');
const LLM = require('../server/mission/llm.js');
const Objects = require('../server/mission/objects.js');
const Physics = require('../shared/physics.js');
const CONFIG = require('../shared/config.js');
const combat = require('../server/sim/combat.js');
const away = require('../server/sim/away.js');
const { bfs } = require('../server/util.js');
const H = require('./gel02-hilfen.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };

const UMSETZUNGEN = ['personen_bergen/ueberlebende_suchen', 'ladung_bergen/ladung_am_boden', 'ladung_bergen/absturzstelle'];
const GELAENDE = ['wildnis', 'hoehle'];
const SEEDS = 50;
const BIOME = ['wueste', 'wiesenwald', 'vulkan'];
const FREMD = ['tor', 'eingang', 'terminal', 'zelle', 'nsc', 'beute', 'ziel', 'sprengpunkt'];

const katalog = Katalog.load({});
const env = SB.buildEnv(katalog);
const umsetzung = (id) => { const [m, u] = id.split('/'); return katalog.molekuele[m].umsetzungen.find((x) => x.id === u); };

console.log('\n[1. Katalog]');
{
  const pflichtW = require('../shared/gen-gelaende.js').PFLICHT; const pflichtH = require('../shared/gen-hoehle.js').PFLICHT;
  for (const id of UMSETZUNGEN) {
    const u = umsetzung(id);
    ok(u && u.status === 'verfuegbar', `${id} verfuegbar (Prüfer des Katalogs)`);
    const b = u.buehne_braucht || {};
    ok(JSON.stringify((b.kartenarten || []).slice().sort()) === JSON.stringify(GELAENDE.slice().sort()), `${id}: kartenarten genau wildnis und hoehle`);
    const rollen = b.anker || [];
    ok(rollen.every((r) => pflichtW[r] >= 1 && pflichtH[r] >= 1), `${id}: Anker ${rollen.join(', ')} stehen im Pflichtsatz beider Generatoren`);
    ok(!rollen.some((r) => FREMD.includes(r)), `${id}: kein Anker aus ${FREMD.join('/')}`);
    ok(Object.entries(b.min || {}).every(([r, k]) => k <= Math.min(pflichtW[r], pflichtH[r])), `${id}: min-Werte ${JSON.stringify(b.min || {})} höchstens der Pflichtsatz`);
    ok(u.test && u.test.params && u.test.params.map && u.rueckfall && u.rueckfall.params, `${id}: test.params.map und rueckfall.params vorhanden`);
  }
  const text = (id) => JSON.stringify(umsetzung(id).vorlage);
  ok(UMSETZUNGEN.slice(1).every((id) => /"anker":"fund"/.test(text(id)) && /"min":"\{\{anzahl\}\}"/.test(text(id)) && /"state":"genommen"/.test(text(id)) && !/"anker":"tor"/.test(text(id))), 'Ladung/Absturzstelle: fund, Zustand genommen, min, ohne tor');
  ok(/"do":"spawn_person".*?"anker":"deckung"/.test(text(UMSETZUNGEN[0])), 'Überlebende: spawn_person mit anker deckung');
  ok(umsetzung(UMSETZUNGEN[1]).params.fund_name.default === '{{lex.ladung:der}}' && umsetzung(UMSETZUNGEN[2]).params.fund_name.default === '{{lex.wrackteil:der}}', 'Namen über fund_name aus dem Lexikon (ladung, wrackteil)');
  const Lex = require('../server/mission/lexikon.js');
  ok(['ladung', 'wrackteil'].every((k) => Lex.bekannt().has(k)), 'Lexikon kennt ladung und wrackteil');
  ok(['ladung', 'wrackteil'].every((k) => ['germanen', 'rom', 'vorlaeufer', null].every((bw) => Lex.form(Lex.eintrag(k, bw), 'der'))), 'ladung und wrackteil in jeder Bauweise und neutral mit Genus (Form mit Artikel möglich)');
  // Steckbrief-No-Go: kein Typname im Servercode
  const treffer = [];
  const lies = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) lies(p); else if (/\.js$/.test(f.name) && /ueberlebende_suchen|ladung_am_boden|absturzstelle/.test(fs.readFileSync(p, 'utf8'))) treffer.push(p); } };
  lies(path.join(__dirname, '..', 'server'));
  ok(treffer.length === 0, `kein Umsetzungsname im Servercode (${treffer.join(', ') || 'kein Treffer'})`);
}

console.log('\n[2. Prüfer-Sweep]');
const szenentyp = (id) => Object.values(katalog.szenentypen).find((t) => t.bereich === 'aussen' && t.status === 'verfuegbar' && (t.verfuegbare_molekuele || []).includes(id.split('/')[0]));
const welt0 = M.weltstand('nach-tutorial');
const ctx0 = Context.build(welt0, M.anlass(), katalog);
ctx0.bodenbilanz = { letzte: [], pflicht_jetzt: false, lang_ab_min: 25 };
function lps(biom, hoehle) {
  const out = [];
  for (let s = 1; s <= SEEDS; s++) { const w = M.clone(welt0); w.meta = Object.assign({}, w.meta, { seed: s }); out.push(M.lpMitGen(Context.lpAdapterAusWelt(w), biom, hoehle)); }
  return out;
}
function pruefe(id, art, lp, extra) {
  const g = M.testplan(Object.assign({ szenentyp: szenentyp(id).id, ort: 'kesh', buehne: { kartenart: art, neu: true }, mols: [id] }, extra || {}));
  return SB.aufloesen(g, env, M.clone(ctx0), { lp });
}
{
  const FAELLE = [['Wildnis Wüste', 'wildnis', 'wueste', false], ['Wildnis Wiesenwald', 'wildnis', 'wiesenwald', false], ['Wildnis Vulkan', 'wildnis', 'vulkan', false],
    ['Höhle', 'hoehle', null, false], ['Wildnis+Höhle', 'wildnis', null, true]];
  const karten = {};
  for (const [name, art, biom, hoehle] of FAELLE) {
    const L = lps(biom, hoehle);
    // der Biom-/Höhlen-Schalter wirkt wirklich: Karte des ersten Seeds
    const v = L[0].vorschau('kesh', { art });
    karten[name] = require('../shared/buehne.js').fnv(JSON.stringify(v.karte.rows)) + ':' + (v.karte.decks ? 'decks' : 'flach');
    for (const id of UMSETZUNGEN) {
      let gut = 0; const fehler = {};
      for (const lp of L) { const r = pruefe(id, art, lp); if (!r.errors.length) gut++; else for (const c of new Set(r.errors.map((e) => String(e).split(':')[0]))) fehler[c] = (fehler[c] || 0) + 1; }
      ok(gut === SEEDS, `${name}: ${id} ${gut}/${SEEDS} Seeds ohne Prüferfehler${gut === SEEDS ? '' : ' ' + JSON.stringify(fehler)}`);
    }
  }
  ok(new Set([karten['Wildnis Wüste'], karten['Wildnis Wiesenwald'], karten['Wildnis Vulkan']]).size === 3, 'die drei Biome liefern für denselben Seed drei verschiedene Karten (Schalter wirkt)');
  ok(karten['Wildnis+Höhle'].endsWith('decks') && karten['Höhle'].endsWith('flach') && karten['Wildnis Wüste'].endsWith('flach'), 'Wildnis+Höhle hat zwei Decks, Wildnis und Höhle allein nicht');
}

console.log('\n[3. Unpassende Kartenarten, Fraktionen]');
{
  const lp = lps(null, false)[0];
  for (const id of UMSETZUNGEN) {
    for (const art of ['aussenposten', 'station', 'ruine', 'schiff']) {
      const r = pruefe(id, art, lp);
      ok(r.errors.some((e) => /^BUEHNE-ART/.test(String(e))), `${id} auf ${art} abgelehnt (BUEHNE-ART)`);
    }
  }
  const alle = Object.keys(katalog.fraktionen || {});
  const lueck = [];
  for (const besitz of ['rom', 'ger', 'herrenlos', 'rostmeute']) for (const art of GELAENDE) for (const staerke of ['klein', 'mittel', 'gross']) {
    for (const id of UMSETZUNGEN) {
      const r = pruefe(id, art, lp, { buehne: { kartenart: art, neu: true, besitz }, besetzung: [{ fraktion: besitz, staerke, haltung: 'wach' }] });
      const fr = r.errors.filter((e) => /^FRAKTION/.test(String(e)));
      if (fr.length) lueck.push(`${besitz}/${art}/${staerke}/${id}: ${fr[0]}`);
    }
  }
  ok(!lueck.length, `Besitz rom/ger/herrenlos/rostmeute auf Wildnis und Höhle FRAKTION-gültig (3 Stärken, 3 Umsetzungen)${lueck.length ? ': ' + lueck.slice(0, 3).join(' | ') : ''}`);
  console.log(`  Info: Fraktionen im Katalog: ${alle.join(', ') || '(Katalog liefert sie nicht)'}; herrenlos hat auf Gelände nur das Rezept kastellwache (Kastell-Automaten), thematisch schwach`);
}

console.log('\n[4. Person auf deckung]');
{
  let karten = 0, tot = 0;
  const kaputt = [];
  const faelle = [];
  for (const biom of BIOME) for (let s = 1; s <= 6; s++) faelle.push({ art: 'wildnis', seed: 100 + s, groesse: 'mittel', biom });
  for (let s = 1; s <= 6; s++) faelle.push({ art: 'hoehle', seed: 200 + s, groesse: 'mittel' });
  for (const biom of BIOME) for (let s = 1; s <= 3; s++) faelle.push({ art: 'wildnis', seed: 300 + s, groesse: 'mittel', biom, hoehle: true });
  for (const f of faelle) {
    const { g, map, k } = H.neuesSpiel(1, f);
    const E = combat.env(g); const beg = (x, y) => !E.solid(x, y);
    const ab = k.anker.find((a) => a.rolle === 'abholpunkt');
    const a = Objects.resolveAnker(g, map, 'deckung')[0];
    karten++;
    const deck = k.decks ? Math.floor(a.y / k.decks.stride) : 0;
    const weg = a && bfs(beg, { x: ab.x, y: ab.y }, (x, y) => x === a.x && y === a.y, k.w, k.h);
    if (!a || deck !== 0 || E.solid(a.x, a.y) || !weg) kaputt.push(`${JSON.stringify(f)}: ${a ? `deck ${deck}, solid ${E.solid(a.x, a.y)}, weg ${weg ? weg.length : 'X'}` : 'kein deckung-Anker'}`);
    tot += weg ? weg.length : 0;
  }
  ok(!kaputt.length, `${karten} Karten (Wildnis 3 Biome, Höhle, Wildnis+Höhle): erster deckung-Anker auf Deck 0, begehbar, vom Abholpunkt erreichbar (mittlerer Weg ${Math.round(tot / karten)} Kacheln)${kaputt.length ? ': ' + kaputt.slice(0, 2).join(' | ') : ''}`);

  // ein E am Verletzten auf deckung: Versorgen (kein Fund-Hold); Gegenprobe fund: erst der Fund-Hold
  const probe = (rolle) => {
    const { g, map, k } = H.neuesSpiel(1, { art: 'wildnis', seed: 3, groesse: 'mittel', biom: 'wueste' });
    const a = Objects.resolveAnker(g, map, rolle)[0];
    away.spawnPersonDazu(g, map, { x: a.x, y: a.y }, { person: 'p1', name: 'Brann', injured: true });
    const p = g.players[0]; p.carry = 'medipack';
    const c = Physics.tileCenter(a.x, a.y); p.x = c.x + Physics.TILE; p.y = c.y; p.dir = 'left';
    g.step(); g.handleMessage(g.cs[0], { t: 'act', down: true }); g.step();
    const person = (g.away.npcs || g.away.personen || []);
    const aw = g.away;
    const np = require('../server/sim/away.js').personAn(aw, a.x, a.y, p.id);
    return { hold: p.hold && p.hold.kind, geheilt: !!np && !np.injured && np.following === p.id, fehler: H.fehlerZahl(g) };
  };
  const pd = probe('deckung'); const pf = probe('fund');
  ok(pd.hold === null && pd.geheilt && pd.fehler === 0, `deckung: ein E versorgt sofort (Hold ${pd.hold}, versorgt ${pd.geheilt})`);
  ok(pf.hold === 'anker:fund' && !pf.geheilt, `Gegenprobe fund: E hält zuerst den Fund (${pf.hold}), die Person bleibt unversorgt (Befund, Grund für deckung)`);
}

console.log('\n[5. Mock-Rückfall]');
{
  const ctx = M.clone(ctx0);
  ctx.bodenbilanz = { letzte: [{ titel: 'x', boden: false }], pflicht_jetzt: true, lang_ab_min: 25 };
  const g = LLM.mockGrobplan({ anlass: { art: 'missionsgrenze', crew: 3 }, kontext: ctx }, katalog);
  const s = g.szenen.find((x) => x.id === 's2_mock');
  const m = s.molekuele[0];
  ok(m.id + '/' + m.umsetzung === 'artefakt_freilegen/fund_aus_gewoelbe', `Mock wählt bei fälliger Bodenquote weiter ${m.id}/${m.umsetzung}`);
  ok(!UMSETZUNGEN.includes(m.id + '/' + m.umsetzung) && !s.buehne, 'Mock wählt keine Gelände-Umsetzung und keine buehne');
  const r = SB.aufloesen(M.clone(g), env, M.clone(ctx), { lp: Context.lpAdapterAusWelt(welt0) });
  ok(!r.errors.length, 'Mock-Plan besteht den Prüfer');
}

console.log('\n[6. Bot-/Gruppenlauf (sim-headless labor)]');
const lauf = (id, buehne) => new Promise((resolve) => {
  const p = cp.spawn(process.execPath, [path.join(__dirname, 'sim-headless.js'), 'labor', id, '--seeds', '2', '--crew', '3', '--buehne', buehne], { cwd: path.join(__dirname, '..') });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ id, buehne, code, out }));
});
(async () => {
  const laeufe = [];
  for (const id of UMSETZUNGEN) for (const b of GELAENDE) laeufe.push(lauf(id, b));
  for (const r of await Promise.all(laeufe)) {
    const z = r.out.split('\n').find((l) => l.startsWith('| ' + r.id + ' |')) || '';
    const c = z.split('|').map((x) => x.trim());   // '', id, crew, erledigt, median, fehler, softlock, skips
    const fertig = /^(\d+)\/(\d+)$/.exec(c[3] || '');
    ok(r.code === 0 && fertig && fertig[1] === fertig[2] && c[5] === '0' && c[6] === '0' && c[7] === '0',
      `${r.id} auf ${r.buehne}, Crew 3: erledigt ${c[3]}, Fehler ${c[5]}, Softlock ${c[6]}, Skips ${c[7]} (Exit ${r.code})`);
  }
  console.log(`\n${n - bad}/${n} ok`);
  if (bad) { console.log(`${bad} FEHLER`); process.exit(1); }
  console.log('TEST-SPL-GELAENDE-SZENEN OK');
})();
