#!/usr/bin/env node
'use strict';
// GEL-01 B: Kartenart wildnis in Server und Daten verdrahtet (neu, Weltstand, Biom-Quelle, Szenenbau, Pflichtsatz, Besetzung).
// Der Erzeuger selbst prüft tools/proto-gelaende.js; hier nur die Verdrahtung.
//   node tools/test-wildnis-verdrahtung.js
const path = require('path');
const Buehne = require('../shared/buehne.js');
const Gelaende = require('../shared/gen-gelaende.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const W = require('../server/world.js');
const LP = require('../server/sim/landepunkte.js');
const Welt = require('../server/sim/welt.js');
const Anker = require('../server/sim/anker.js');
const Context = require('../server/mission/context.js');
const Objects = require('../server/mission/objects.js');
const SB = require('../server/mission/szenenbau.js');
const Katalog = require('../server/mission/katalog.js');
const Combat = require('../server/sim/combat.js');
const Arena = require('../server/sim/arena.js');
const { Game } = require('../server/game.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const klon = (o) => JSON.parse(JSON.stringify(o));

function fakeGame(o) {
  const g = Object.assign({
    C: CONFIG, time: 0, seed: 1234, players: [], inventory: {}, aways: { platform: { map: 'platform' }, wreck: { map: 'wreck' }, kesh: { map: 'kesh' } },
    ship: { scene: 'kesh', x: 1350, y: 760 }, weltstand: null, mission: {},
    emit() {}, missionEvent() {}, notice() {}, oda() {}, log() {}, countError(w, e) { throw e; }, setAwayMap(id) { this.away = this.aways[id]; },
  }, o || {});
  g.away = g.aways.platform;
  return g;
}
// Biom-Quelle der Welt austauschen (content/welt/<karte>.json "biome"); die Welt-Dateien selbst bleiben unberührt
const welt0 = Welt.karte;
const mitBiomen = (biome, fn) => { Welt.karte = () => ({ biome }); LP.cacheLeeren('wildnis'); try { return fn(); } finally { Welt.karte = welt0; LP.cacheLeeren('wildnis'); } };

// ---------------- Art-Listen und Daten ----------------
abschnitt('Art-Listen');
{
  ok(Protocol.KARTEN_ARTEN.includes('wildnis') && Protocol.KARTEN_ARTEN.includes('hand'), 'protocol.KARTEN_ARTEN enthält wildnis');
  ok(!Protocol.WELLEN_KARTEN.includes('wildnis') && !('wildnis' in Protocol.WELLEN_KARTEN_NAMEN), 'Wellenliste bleibt ohne wildnis (kein Wellenmodus, Kai)');
  ok(SB.KARTEN_ARTEN.includes('wildnis') && Objects.KARTEN_ARTEN.includes('wildnis'), 'Szenenbau und Objekte kennen wildnis');
  const ach = Buehne.daten().achsen;
  ok(ach.kartenarten.wildnis && ach.kartenarten.wildnis.kacheln.join('x') === `${Gelaende.GROESSEN.mittel.w}x${Gelaende.GROESSEN.mittel.h}`, 'achsen.json: kartenarten.wildnis (Größe mittel)');
  const schema = require('../content/katalog/schema/molekuel.schema.json');
  const en = JSON.stringify(schema).includes('"wildnis"');
  ok(en, 'Molekül-Schema: kartenarten-Enum kennt wildnis');
  ok(CONFIG.buehne.jeArt.wildnis && CONFIG.buehne.jeArt.wildnis.eingaengeMin === 0 && CONFIG.buehne.eingaengeMin === 2, 'config: buehne.jeArt.wildnis.eingaengeMin 0, globaler Wert bleibt 2');
}

// ---------------- Nachweis a): neu(), Bau, Prüfer ----------------
abschnitt('neu() und Bau');
const g = fakeGame();
const id = LP.neu(g, 'kesh', { art: 'wildnis', seed: 5 });
ok(id === 'kesh.wildnis-1', 'neu(): ID <ort>.wildnis-<n> (' + id + ')');
ok(LP.neu(g, 'kesh', { art: 'wildnis', seed: 6 }) === 'kesh.wildnis-2', 'neu(): fortlaufend');
ok(LP.neu(g, 'kesh', { art: 'wildnis', seed: 7, besitz: 'rostmeute', zustand: 'umkaempft' }) === 'kesh.wildnis-3', 'neu(): Besitz und Zustand übernommen');
let karte;
{
  const aw = LP.get(g, id);
  karte = W.AWAY_MAPS[id].karte;
  const e = LP.eintrag(g, id);
  ok(aw && g.aways[id] === aw && karte.art === 'wildnis' && karte.schablone === 'gen-gelaende' && karte.id === id, 'get() baut und registriert die Wildnis-Karte');
  ok(karte.bauversion.startsWith('gelaende.' + Gelaende.VERSION + '[') && e.bauversion === karte.bauversion && e.schablone === 'gen-gelaende', 'bauversion aus dem Erzeuger im Eintrag (gelaende.<VERSION>[sig])');
  ok(karte.meta.biom && karte.meta.boden && karte.meta.pflicht.fund === 2 && !(karte.eingaenge || []).length, 'Karte: meta.biom/boden/pflicht, keine Eingänge');
  const pr = Buehne.pruefen(karte);
  ok(pr.ok && !pr.fehler.some((f) => f.code === 'K-EINGAENGE'), 'Prüfer ok, kein K-EINGAENGE (' + pr.fehler.map((f) => f.code).join(',') + ')');
  // Gegenprobe: ohne den jeArt-Eintrag (nur globale Werte) meldet der Prüfer K-EINGAENGE
  const ohne = Buehne.pruefen(karte, { cfg: Object.assign({}, CONFIG.buehne, { jeArt: {} }) });
  ok(ohne.fehler.some((f) => f.code === 'K-EINGAENGE'), 'Gegenprobe: ohne jeArt.wildnis meldet der Prüfer K-EINGAENGE');
  ok(aw.kampf === 'v2' && aw.zustaende && aw.ankerLauf, 'Laufzeitfelder wie bei den anderen Kartenarten');
  let wirft = false; try { LP.neu(g, 'kesh', { art: 'hoehle' }); } catch (x) { wirft = /unbekannt/.test(x.message); }
  ok(wirft, 'neu(): unbekannte Kartenart weiter abgelehnt');
}
{
  // Seed-Folge: viele Seeds bauen alle ohne Wurf (Prüferfehler -> Seed + 1 fängt Ausreißer)
  const g2 = fakeGame(); let fehl = 0;
  for (let s = 1; s <= 24; s++) { const i = LP.neu(g2, 'kesh', { art: 'wildnis', seed: s * 37, gen: { biom: Gelaende.BIOME[s % 3], groesse: ['klein', 'mittel', 'gross'][s % 3] } }); try { LP.karte(g2, i); } catch (x) { fehl++; } }
  ok(fehl === 0, '24 Wildnis-Landepunkte (alle Biome/Größen) bauen ohne Fehler');
}

// ---------------- Nachweis b): Weltstand ----------------
abschnitt('Weltstand: Karte aus art+seed+besitz+zustand+Ort allein');
{
  const gA = fakeGame();
  const lp = LP.neu(gA, 'kesh', { art: 'wildnis', seed: 4711, besitz: 'rostmeute', zustand: 'umkaempft', gen: { biom: 'vulkan', groesse: 'klein' } });
  LP.get(gA, lp);
  const kA = W.AWAY_MAPS[lp].karte;
  const fund = kA.anker.find((a) => a.rolle === 'fund');
  gA.away = gA.aways[lp];
  ok(!!fund && Anker.setzen(gA, lp, fund.id, 'genommen', null) === null && Anker.zustand(gA, lp, fund.id) === 'genommen', 'Fund-Zustand gesetzt (genommen)');
  const z0 = Anker.zustand(gA, lp, fund.id);
  const hashA = Buehne.hash(kA);
  const block = JSON.parse(JSON.stringify(LP.toSave(gA)));
  ok(block[lp] && block[lp].art === 'wildnis' && block[lp].seed === kA.seed && block[lp].ort === 'kesh' && !('gen' in block[lp]), 'toSave: art/seed/Ort im Block, gen nicht gespeichert');
  ok(block[lp].zustaende[fund.id] === z0, 'toSave: Fund-Zustand im Block');
  // Frische Partie: gen gibt es dort nicht mehr. Darum trägt hier die Welt (biome) das Biom, wie im Spiel.
  const gB = fakeGame();
  mitBiomen({ kesh: 'vulkan' }, () => {
    // Referenz: gleiche Eingaben ohne gen, Biom aus der Welt
    const gR = fakeGame();
    const lpR = LP.neu(gR, 'kesh', { art: 'wildnis', seed: 4711, besitz: 'rostmeute', zustand: 'umkaempft', gen: { groesse: 'mittel' } });
    LP.get(gR, lpR);
    const kR = W.AWAY_MAPS[lpR].karte;
    ok(kR.meta.biom === 'vulkan', 'Referenzkarte nimmt das Biom aus der Welt');
    gR.away = gR.aways[lpR];
    Anker.setzen(gR, lpR, kR.anker.find((a) => a.rolle === 'fund').id, 'genommen', null);
    const blockR = JSON.parse(JSON.stringify(LP.toSave(gR)));
    ok(!('gen' in blockR[lpR]), 'Weltstand-Eintrag ohne gen');
    LP.cacheLeeren('wildnis');   // wie nach einem Neustart: kein Cache
    LP.restore(blockR, gB);
    LP.get(gB, lpR);
    const kB = W.AWAY_MAPS[lpR].karte;
    ok(Buehne.hash(kB) === Buehne.hash(kR) && JSON.stringify(kB.rows) === JSON.stringify(kR.rows) && kB.meta.biom === 'vulkan', 'restore: dieselbe Karte (Hash), Biom aus der Welt, gen nicht nötig');
    ok(gB.aways[lpR].zustaende[kR.anker.find((a) => a.rolle === 'fund').id] === Anker.zustand(gR, lpR, kR.anker.find((a) => a.rolle === 'fund').id), 'restore: Fund-Zustand bleibt erhalten');
    ok(LP.liste(gB, 'kesh').some((x) => x.id === lpR && x.art === 'wildnis'), 'restore: Landepunkt in der Liste des Orts');
    // bauversion-Wechsel (Generatorwechsel): neu gebaut, Logbuch, Zustände über IDs übertragen
    const blk = klon(blockR); blk[lpR].bauversion = 'gelaende.0[alt]';
    const gC = fakeGame(); let geloggt = ''; gC.log = (t) => { geloggt += t; };
    LP.restore(blk, gC); LP.get(gC, lpR);
    ok(/bauversion gelaende\.0\[alt\]/.test(geloggt) && LP.eintrag(gC, lpR).bauversion === kR.bauversion, 'bauversion-Wechsel (Generator): Karte neu gebaut, Logbuch');
  });
  // Testgelände landet nie im Weltstand
  const gT = fakeGame(); const t = LP.testgelaende(gT, { art: 'wildnis', seed: 3 }); LP.get(gT, t);
  ok(!(t in LP.toSave(gT)), 'Testgelände wildnis: nie im Weltstand');
  ok(hashA.length > 0, 'Hash der Ausgangskarte vorhanden');
}

// ---------------- Nachweis c): Biom-Quelle ----------------
abschnitt('Biom-Quelle');
{
  const bauen = (ort, seed, gen) => { const gg = fakeGame(); const i = LP.neu(gg, ort, { art: 'wildnis', seed, ...(gen ? { gen } : {}) }); W.unregister(i); return LP.karte(gg, i); };   // W.AWAY_MAPS ist global: frisch bauen statt eine früher registrierte Karte gleicher ID lesen
  const auto = bauen('kesh', 77);
  ok(Gelaende.BIOME.includes(auto.meta.biom) && LP.biomVonOrt('kesh') === 'auto' && LP.biomVonOrt('nirgends') === 'auto', 'ohne Weltkonfiguration: auto (Erzeuger wählt aus dem Seed: ' + auto.meta.biom + ')');
  const anders = Gelaende.BIOME.find((b) => b !== auto.meta.biom);
  mitBiomen({ kesh: anders, hafen: 'wueste', quatsch: 'tundra' }, () => {
    ok(LP.biomVonOrt('kesh') === anders && LP.biomVonOrt('quatsch') === 'auto', 'biomVonOrt: Eintrag gilt, unbekanntes Biom -> auto');
    const k1 = bauen('kesh', 77);
    ok(k1.meta.biom === anders && k1.bauversion !== auto.bauversion, 'Ort-Eintrag wirkt (meta.biom ' + k1.meta.biom + ') und ändert die bauversion');
    const k2 = bauen('hafen', 77);
    ok(k2.meta.biom === 'wueste', 'anderer Ort, eigener Eintrag (' + k2.meta.biom + ')');
    const k3 = bauen('splitter', 77);
    ok(k3.meta.biom === auto.meta.biom, 'Ort ohne Eintrag bleibt auto');
    const k4 = bauen('kesh', 77, { biom: 'vulkan', groesse: 'klein' });
    ok(k4.meta.biom === 'vulkan' && k4.w === Gelaende.GROESSEN.klein.w, 'gen.biom/gen.groesse überschreiben (Testgelände/Debug)');
    // Cache: gleicher Seed, anderes Biom -> keine Verwechslung
    const gx = fakeGame(); const a = LP.neu(gx, 'kesh', { art: 'wildnis', seed: 91 }); const b = LP.neu(gx, 'kesh', { art: 'wildnis', seed: 91, gen: { biom: 'wueste' } });
    const ka = LP.karte(gx, a), kb = LP.karte(gx, b);
    ok(kb.meta.biom === 'wueste' && ka.meta.biom === anders, 'Cache trennt Biome bei gleichem Seed');
  });
  ok(bauen('kesh', 77).meta.biom === auto.meta.biom, 'nach dem Austausch der Quelle wieder auto (kein Cache-Rest)');
  // echte Weltdateien: "biome" (falls vorhanden) trägt nur bekannte Biome
  const fs = require('fs'); const dir = path.join(__dirname, '..', 'content', 'welt');
  let schlecht = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^(limes|sund)\.json$/.test(x))) { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); for (const [, b] of Object.entries(j.biome || {})) if (!Gelaende.BIOME.includes(b)) schlecht++; }
  ok(schlecht === 0, 'Welt-Dateien: biome nur mit bekannten Biomen');
}

// ---------------- Nachweis e), f), g): Pflichtsatz, Generator-Zwang ----------------
abschnitt('Pflichtsatz, nutztGenerator, PANTHEON_GEN=0');
{
  const ka = Context.kartenartenOf().find((x) => x.id === 'wildnis');
  ok(ka && JSON.stringify(ka.pflichtsatz) === JSON.stringify(Gelaende.PFLICHT) && ka.kurz && Context.kartenartenOf().map((x) => x.id).join() === 'aussenposten,station,ruine,schiff,wildnis', 'kartenartenOf(): wildnis mit Gelaende.PFLICHT und Kurztext, übrige Arten unverändert');
  const gg = fakeGame(); const i = LP.neu(gg, 'kesh', { art: 'wildnis', seed: 5 });
  const e = LP.eintrag(gg, i);
  ok(LP.nutztGenerator(i, e) === true, 'nutztGenerator(wildnis) = true');
  const alt = process.env.PANTHEON_GEN;
  process.env.PANTHEON_GEN = '0';
  try {
    LP.cacheLeeren('wildnis');
    const g0 = fakeGame(); const i0 = LP.neu(g0, 'kesh', { art: 'wildnis', seed: 5 });
    const k0 = LP.karte(g0, i0);
    ok(LP.nutztGenerator(i0, LP.eintrag(g0, i0)) === true && k0.art === 'wildnis' && k0.schablone === 'gen-gelaende', 'PANTHEON_GEN=0: wildnis baut weiter mit dem Erzeuger (kein Modulbau vorhanden, bewusst)');
    const gs = fakeGame(); const is = LP.neu(gs, 'kesh', { art: 'station', seed: 5 });
    ok(LP.nutztGenerator(is, LP.eintrag(gs, is)) === false, 'PANTHEON_GEN=0 schaltet die übrigen Generator-Arten weiter ab (unverändert)');
  } finally { if (alt === undefined) delete process.env.PANTHEON_GEN; else process.env.PANTHEON_GEN = alt; LP.cacheLeeren(); }
}

// ---------------- Nachweis d): Szenenbau ----------------
abschnitt('Szenenbau-Probe');
{
  const katalog = Katalog.load({});
  const ctx = Context.build({}, {}, katalog);
  ok((ctx.kartenarten || []).some((x) => x.id === 'wildnis'), 'Spielleiter-Kontext führt wildnis');
  const plan = (szenen) => ({
    format: 'grobplan/2', id: 'wn_test', titel: 'Wildnis-Test', auftraggeber: 'melk', zielspieldauer_min: 12, aufhaenger: 'Ein Testauftrag.',
    szenen: [{ id: 's1_hafen', szenentyp: 'hafen', ort: 'hafen', karte: null, molekuele: [], sachverhalt: 'Auftrag.', wendung: null, dauer_min: 2, weiter: [{ wenn: 'immer', nach: szenen[0].id }] },
      ...szenen.map((s, i) => Object.assign({ karte: null, sachverhalt: s.id + ' (Test).', wendung: null, dauer_min: 4,
        molekuele: [{ id: 'probe_nehmen', umsetzung: 'am_fund' }], weiter: i < szenen.length - 1 ? [{ wenn: 'immer', nach: szenen[i + 1].id }] : [{ wenn: 'gut', nach: 'ausgang:erfolg' }, { wenn: 'sonst', nach: 'ausgang:teil' }] }, s))],
    entscheidungen: [],
  });
  const mitBraucht = (braucht) => {
    const kat = klon(katalog); const u = kat.molekuele.probe_nehmen && kat.molekuele.probe_nehmen.umsetzungen.find((x) => x.id === 'am_fund');
    if (u) u.buehne_braucht = braucht;
    return { env: SB.buildEnv(kat), u };
  };
  const codes = (r) => new Set(r.errors.map((x) => (/^([A-Z-]+):/.exec(x) || [])[1]));
  {
    const { env, u } = mitBraucht({ kartenarten: ['wildnis'], anker: ['fund', 'deckung'] });
    ok(!!u, 'Probe-Umsetzung im Katalog gefunden (probe_nehmen/am_fund)');
    const p = plan([{ id: 's2_wild', ort: 'kesh', szenentyp: 'erkundung', buehne: { kartenart: 'wildnis', neu: true } }]);
    const r = SB.aufloesen(p, env, ctx);
    ok(!codes(r).has('BUEHNE-ART') && !codes(r).has('BUEHNE-ANKER') && !r.errors.length, 'buehne { kartenart: wildnis, neu } mit Bedarf fund+deckung: kein BUEHNE-ART/-ANKER (' + r.errors.join(' | ').slice(0, 160) + ')');
    ok(/^kesh\.wildnis-\d+$/.test(p.szenen[1].landepunkt || '') && r.neu.some((x) => x.art === 'wildnis'), 'neuer Landepunkt kesh.wildnis-<n> in der Vorschau (' + p.szenen[1].landepunkt + ')');
    const lpBuch = (SB.passendeLandepunkte ? SB.passendeLandepunkte({ params: {}, buehne_braucht: { kartenarten: ['wildnis'], anker: ['fund', 'deckung'] } }, env, ctx, {}) : null);
    ok(!lpBuch || lpBuch.neu.includes('wildnis'), 'passendeLandepunkte: wildnis unter den neu baubaren Arten');
  }
  {
    const { env } = mitBraucht({ kartenarten: ['wildnis'], anker: ['fund', 'eingang'] });
    const p = plan([{ id: 's2_wild', ort: 'kesh', szenentyp: 'erkundung', buehne: { kartenart: 'wildnis', neu: true } }]);
    const r = SB.aufloesen(p, env, ctx);
    ok(codes(r).has('BUEHNE-ANKER') && !codes(r).has('BUEHNE-ART'), 'Gegenprobe: Anker eingang (gibt es nicht) -> BUEHNE-ANKER, nicht BUEHNE-ART');
  }
  {
    const { env } = mitBraucht({ kartenarten: ['station'], anker: ['fund'] });
    const p = plan([{ id: 's2_wild', ort: 'kesh', szenentyp: 'erkundung', buehne: { kartenart: 'wildnis', neu: true } }]);
    const r = SB.aufloesen(p, env, ctx);
    ok(r.errors.length > 0, 'Gegenprobe: Umsetzung nur für station -> Wildnis wird abgelehnt (' + r.errors.join(' | ').slice(0, 100) + ')');
  }
  {
    const { env } = mitBraucht({ kartenarten: ['wildnis'], anker: ['fund'] });
    const p = plan([{ id: 's2_x', ort: 'kesh', szenentyp: 'erkundung', buehne: { kartenart: 'hoehle', neu: true } }]);
    ok(codes(SB.aufloesen(p, env, ctx)).has('BUEHNE-ART'), 'unbekannte Kartenart meldet weiter BUEHNE-ART');
  }
  // pruefeBuehneBraucht direkt gegen eine gebaute Karte
  const braucht = { kartenarten: ['wildnis'], anker: ['fund', 'deckung', 'abholpunkt'], min: { fund: 2, deckung: 4 } };
  ok(Objects.pruefeBuehneBraucht(braucht, karte).length === 0, 'pruefeBuehneBraucht: gebaute Wildnis erfüllt fund/deckung/abholpunkt');
  ok(Objects.pruefeBuehneBraucht({ kartenarten: ['wildnis'], anker: ['eingang'] }, karte).some((x) => x.code === 'BUEHNE-ANKER'), 'pruefeBuehneBraucht: eingang fehlt -> BUEHNE-ANKER');
  ok(Objects.landepunkt('kesh.wildnis-4') && Objects.landepunkt('kesh.wildnis-4').art === 'wildnis', 'objects.landepunkt(): dynamische ID <ort>.wildnis-<n> wird erkannt');
}

// ---------------- Nachweis i): Besetzung über den echten Weg ----------------
abschnitt('Besetzung und Start (Testgelände über Arena)');
{
  const gm = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); } };
  gm.addConnection(c); gm.handleMessage(c, { t: 'hello', clientId: 'W0', name: 'W0', color: 0 }); gm.handleMessage(c, { t: 'ready', ready: true });
  Arena.start(gm, 'arena_away', { art: 'wildnis', seed: 5 });
  const map = gm.away && gm.away.map;
  const k = W.AWAY_MAPS[map] && W.AWAY_MAPS[map].karte;
  const p = gm.players[0];
  ok(/^kesh\.wildnis-\d+$/.test(map || '') && k && k.art === 'wildnis', 'Arena-Testgelände baut die Wildnis (' + map + ')');
  const ab = k.anker.find((a) => a.id === k.ankunft);
  ok(p.zone === 'away' && Math.floor(p.x / 32) === ab.x && Math.floor(p.y / 32) === ab.y, 'Spieler startet am Abholpunkt (Ankunft) der Karte');
  for (let i = 0; i < 90; i++) gm.step();
  ok(gm.errors === 0 && gm.away.drones.length === 0, 'ohne Besetzung: keine Gegner, keine Serverfehler (der Platz „gelaende“ stört nicht)');
  const lager = Object.keys(k.bereiche).filter((b) => k.bereiche[b].gefecht).sort();
  const wacheJe = {}; for (const a of k.anker) if (a.rolle === 'wache') wacheJe[a.bereich] = (wacheJe[a.bereich] || 0) + 1;
  let gesamt = 0; const imLager = [];
  for (const b of lager) {
    const vorher = gm.away.drones.length;
    const m = Combat.besetzen(gm, { map, bereich: b, fraktion: 'raubzug', staerke: 'klein', tag: 't_' + b });
    gesamt += m;
    const neue = gm.away.drones.slice(vorher);
    const r = k.bereiche[b].rects;
    imLager.push(m > 0 && neue.every((d) => { const tx = Math.floor(d.x / 32), ty = Math.floor(d.y / 32); return r.some((q) => tx >= q[0] && tx < q[0] + q[2] && ty >= q[1] && ty < q[1] + q[3]); }));
  }
  ok(lager.length >= 1 && gesamt > 0 && gm.away.drones.length === gesamt && imLager.every(Boolean), 'besetzen je Lager-Bereich: ' + gesamt + ' Gegner in ' + lager.length + ' Lagern, alle im Bereich (wache je Lager ' + JSON.stringify(wacheJe) + ')');
  const ohneBereich = Combat.besetzen(gm, { map, fraktion: 'raubzug', staerke: 'mittel', tag: 't_alle' });
  ok(ohneBereich > 0, 'besetzen ohne Bereich nimmt die Gefechtsbereiche (' + ohneBereich + ' Gegner)');
  ok((k.patrouillen || []).length > 0, 'Patrouillenwege aus den patrouille-Ankern kompiliert (' + (k.patrouillen || []).length + ')');
  for (let i = 0; i < 300; i++) gm.step();
  ok(gm.errors === 0 && gm.away.drones.filter((d) => d.alive).length > 0, 'nach 10 s Spielzeit: keine Serverfehler, Gegner leben (' + gm.away.drones.filter((d) => d.alive).length + ')');
  // Wellen-Menü bietet Wildnis nicht an
  ok(!Protocol.WELLEN_KARTEN.includes('wildnis'), 'Wellen-Menü (WELLEN_KARTEN) ohne wildnis');
}

console.log(`\n${n - bad}/${n} ok`);
if (bad) { console.log(`${bad} FEHLER`); process.exit(1); }
console.log('TEST-WILDNIS-VERDRAHTUNG OK');
