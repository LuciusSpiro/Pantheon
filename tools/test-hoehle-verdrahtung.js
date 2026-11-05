#!/usr/bin/env node
'use strict';
// GEL-02 B: Kartenart hoehle in Server, Spielleiter, Weltstand und Client verdrahtet (Vorbild tools/test-wildnis-verdrahtung.js).
// Der Erzeuger selbst prüft tools/test-hoehle.js; hier nur die Verdrahtung. Browser-Probe: tools/test-hoehle-shot.js.
//   node tools/test-hoehle-verdrahtung.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const Buehne = require('../shared/buehne.js');
const Hoehle = require('../shared/gen-hoehle.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const W = require('../server/world.js');
const LP = require('../server/sim/landepunkte.js');
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
const lies = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const rd = (f) => JSON.parse(lies(f).replace(/^﻿/, ''));
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const SEEDS = +(process.env.SEEDS || 50);

function fakeGame(o) {
  const g = Object.assign({
    C: CONFIG, time: 0, seed: 1234, players: [], inventory: {}, aways: { platform: { map: 'platform' }, wreck: { map: 'wreck' }, kesh: { map: 'kesh' } },
    ship: { scene: 'kesh', x: 1350, y: 760 }, weltstand: null, mission: {},
    emit() {}, missionEvent() {}, notice() {}, oda() {}, log() {}, countError(w, e) { throw e; }, setAwayMap(id) { this.away = this.aways[id]; },
  }, o || {});
  g.away = g.aways.platform;
  return g;
}
// frisch bauen (W.AWAY_MAPS ist global: frisch bauen statt eine früher registrierte Karte gleicher ID zu lesen)
function bauen(seed, gen, extra) {
  const gg = fakeGame(); const i = LP.neu(gg, 'kesh', Object.assign({ art: 'hoehle', seed }, gen ? { gen } : {}, extra || {})); W.unregister(i);
  return LP.karte(gg, i);
}

(async () => {
  // ---------------- Art-Listen und Daten ----------------
  abschnitt('Art-Listen');
  {
    ok(Protocol.KARTEN_ARTEN.includes('hoehle') && Protocol.KARTEN_ARTEN.includes('wildnis') && Protocol.KARTEN_ARTEN.includes('hand'), 'protocol.KARTEN_ARTEN enthält hoehle');
    ok(!Protocol.WELLEN_KARTEN.includes('hoehle') && !('hoehle' in Protocol.WELLEN_KARTEN_NAMEN), 'Wellenliste bleibt ohne hoehle (kein Wellenmodus, Kai 2026-11-05 wie wildnis)');
    ok(SB.KARTEN_ARTEN.includes('hoehle') && Objects.KARTEN_ARTEN.includes('hoehle'), 'Szenenbau und Objekte kennen hoehle');
    const ach = Buehne.daten().achsen;
    ok(ach.kartenarten.hoehle && ach.kartenarten.hoehle.kacheln.join('x') === `${Hoehle.GROESSEN.mittel.w}x${Hoehle.GROESSEN.mittel.h}`, 'achsen.json: kartenarten.hoehle (Größe mittel)');
    ok(rd('content/katalog/schema/molekuel.schema.json').properties && JSON.stringify(rd('content/katalog/schema/molekuel.schema.json')).includes('"hoehle"'), 'Molekül-Schema: kartenarten-Enum kennt hoehle');
    ok(rd('content/katalog/schema/fraktion.schema.json').properties.einsatz.additionalProperties.items.enum.includes('hoehle'), 'Fraktions-Schema: einsatz-Enum kennt hoehle');
    ok(CONFIG.buehne.jeArt.hoehle && CONFIG.buehne.jeArt.hoehle.eingaengeMin === 0 && CONFIG.buehne.eingaengeMin === 2, 'config: buehne.jeArt.hoehle.eingaengeMin 0, globaler Wert bleibt 2');
    ok(Protocol.ARENA_AWAY_FIELDS.includes('groesse'), 'protocol.ARENA_AWAY_FIELDS enthält groesse');
    ok(JSON.stringify(Protocol.GELAENDE_GROESSEN.slice().sort()) === JSON.stringify(Object.keys(Hoehle.GROESSEN).sort()), 'protocol.GELAENDE_GROESSEN entspricht Hoehle.GROESSEN');
  }

  // ---------------- a) neu(), Bau, Prüfer, Determinismus ----------------
  abschnitt('neu() und Bau (a)');
  const g = fakeGame();
  const id = LP.neu(g, 'kesh', { art: 'hoehle', seed: 5 });
  ok(id === 'kesh.hoehle-1', 'neu(): ID <ort>.hoehle-<n> (' + id + ')');
  ok(LP.neu(g, 'kesh', { art: 'hoehle', seed: 6 }) === 'kesh.hoehle-2', 'neu(): fortlaufend');
  ok(LP.neu(g, 'kesh', { art: 'hoehle', seed: 7, besitz: 'rostmeute', zustand: 'umkaempft' }) === 'kesh.hoehle-3', 'neu(): Besitz und Zustand übernommen');
  let karte;
  {
    const aw = LP.get(g, id);
    karte = W.AWAY_MAPS[id].karte;
    const e = LP.eintrag(g, id);
    ok(aw && g.aways[id] === aw && karte.art === 'hoehle' && karte.schablone === 'gen-hoehle' && karte.id === id, 'get() baut und registriert die Höhlen-Karte');
    ok(karte.w === Hoehle.GROESSEN.mittel.w && karte.h === Hoehle.GROESSEN.mittel.h, `Standardgröße mittel (${karte.w}x${karte.h})`);
    ok(karte.bauversion.startsWith('hoehle.' + Hoehle.VERSION + '[') && e.bauversion === karte.bauversion && e.schablone === 'gen-hoehle', 'bauversion aus dem Erzeuger im Eintrag (hoehle.<VERSION>[sig])');
    ok(karte.meta.boden2 === 'erde' && karte.meta.pflicht.fund === 2 && !(karte.eingaenge || []).length && !!karte.ankunft, 'Karte: meta.boden2 erde, meta.pflicht, keine Eingänge, Ankunft gesetzt');
    const pr = Buehne.pruefen(karte);
    ok(pr.ok && !pr.fehler.some((f) => f.code === 'K-EINGAENGE'), 'Prüfer grün, kein K-EINGAENGE (' + pr.fehler.map((f) => f.code).join(',') + ')');
    const ohne = Buehne.pruefen(karte, { cfg: Object.assign({}, CONFIG.buehne, { jeArt: {} }) });
    ok(ohne.fehler.some((f) => f.code === 'K-EINGAENGE'), 'Gegenprobe: ohne jeArt.hoehle meldet der Prüfer K-EINGAENGE');
    ok(aw.kampf === 'v2' && aw.zustaende && aw.ankerLauf, 'Laufzeitfelder wie bei den anderen Kartenarten');
    let wirft = false; try { LP.neu(g, 'kesh', { art: 'tundra' }); } catch (x) { wirft = /unbekannt/.test(x.message); }
    ok(wirft, 'neu(): unbekannte Kartenart weiter abgelehnt');
  }
  {
    const a = bauen(1234), b = bauen(1234), c = bauen(1235);
    ok(Buehne.hash(a) === Buehne.hash(b) && JSON.stringify(a.rows) === JSON.stringify(b.rows), 'gleicher Seed, gleiche Karte (Hash)');
    ok(Buehne.hash(a) !== Buehne.hash(c), 'anderer Seed, andere Karte');
    const k = bauen(1234, { groesse: 'klein' });
    ok(k.w === Hoehle.GROESSEN.klein.w && k.h === Hoehle.GROESSEN.klein.h && k.bauversion !== a.bauversion, 'gen.groesse überschreibt (Testgelände/Debug), ändert die bauversion');
    const gx = fakeGame(); const i1 = LP.neu(gx, 'kesh', { art: 'hoehle', seed: 91 }); const i2 = LP.neu(gx, 'kesh', { art: 'hoehle', seed: 91, gen: { groesse: 'gross' } });
    const k1 = LP.karte(gx, i1), k2 = LP.karte(gx, i2);
    ok(k1.w === Hoehle.GROESSEN.mittel.w && k2.w === Hoehle.GROESSEN.gross.w, 'Cache trennt Größen bei gleichem Seed');
  }
  {
    let fehl = 0;
    for (let s = 1; s <= 24; s++) { const g2 = fakeGame(); const i = LP.neu(g2, 'kesh', { art: 'hoehle', seed: s * 37, gen: { groesse: ['klein', 'mittel', 'gross'][s % 3] } }); try { LP.karte(g2, i); } catch (x) { fehl++; } W.unregister(i); }
    ok(fehl === 0, '24 Höhlen-Landepunkte (alle Größen) bauen ohne Fehler');
  }

  // ---------------- b) Weltstand ----------------
  abschnitt('Weltstand (b): Karte aus art+seed+besitz+zustand allein');
  {
    const gA = fakeGame();
    const lp = LP.neu(gA, 'kesh', { art: 'hoehle', seed: 4711, besitz: 'rostmeute', zustand: 'umkaempft' });
    LP.get(gA, lp);
    const kA = W.AWAY_MAPS[lp].karte;
    const fund = kA.anker.find((a) => a.rolle === 'fund');
    gA.away = gA.aways[lp];
    ok(!!fund && Anker.setzen(gA, lp, fund.id, 'genommen', null) === null && Anker.zustand(gA, lp, fund.id) === 'genommen', 'Fund-Zustand gesetzt (genommen)');
    const block = JSON.parse(JSON.stringify(LP.toSave(gA)));
    ok(block[lp] && block[lp].art === 'hoehle' && block[lp].seed === kA.seed && block[lp].ort === 'kesh' && !('gen' in block[lp]), 'toSave: art/seed/Ort im Block, gen nicht gespeichert');
    ok(block[lp].zustaende[fund.id] === 'genommen', 'toSave: Fund-Zustand im Block');
    LP.cacheLeeren('hoehle');   // wie nach einem Neustart: kein Cache
    const gB = fakeGame();
    LP.restore(block, gB); LP.get(gB, lp);
    const kB = W.AWAY_MAPS[lp].karte;
    ok(Buehne.hash(kB) === Buehne.hash(kA) && JSON.stringify(kB.rows) === JSON.stringify(kA.rows), 'restore (JSON-Roundtrip): dieselbe Karte (Hash)');
    ok(gB.aways[lp].zustaende[fund.id] === 'genommen' && LP.eintrag(gB, lp).zustaende[fund.id] === 'genommen', 'restore: Fund-Zustand bleibt erhalten');
    ok(LP.liste(gB, 'kesh').some((x) => x.id === lp && x.art === 'hoehle'), 'restore: Landepunkt in der Liste des Orts');
    // Wechsel der bauversion (Erzeuger-VERSION, Größe): neue Karte = neue Funde
    const blk = klon(block); blk[lp].bauversion = 'hoehle.0[alt]';
    const gC = fakeGame(); let geloggt = ''; gC.log = (t) => { geloggt += t; };
    LP.restore(blk, gC); LP.get(gC, lp);
    ok(/bauversion hoehle\.0\[alt\]/.test(geloggt) && LP.eintrag(gC, lp).bauversion === kA.bauversion, 'bauversion-Wechsel: Karte neu gebaut, Logbuch');
    ok(blk[lp].zustaende && blk[lp].zustaende[fund.id] === 'genommen', 'Ausgangslage: gespeicherter Zustand genommen');
    ok(!Object.keys(gC.aways[lp].zustaende).length && !Object.keys(LP.eintrag(gC, lp).zustaende || {}).length && /neue Karte = neue Funde/.test(geloggt) && /1 Zustände verworfen/.test(geloggt), 'bauversion-Wechsel: Zustände verworfen (Laufzeit und Eintrag), Logbuch nennt es');
    const gD = fakeGame(); LP.restore(klon(block), gD); LP.get(gD, lp);
    ok(gD.aways[lp].zustaende[fund.id] === 'genommen' && LP.eintrag(gD, lp).zustaende[fund.id] === 'genommen', 'ohne Wechsel der bauversion bleiben die Zustände');
    const gT = fakeGame(); const t = LP.testgelaende(gT, { art: 'hoehle', seed: 3 }); LP.get(gT, t);
    ok(!(t in LP.toSave(gT)), 'Testgelände hoehle: nie im Weltstand');
  }

  // ---------------- Pflichtsatz, nutztGenerator, PANTHEON_GEN=0 ----------------
  abschnitt('Pflichtsatz, nutztGenerator, PANTHEON_GEN=0');
  {
    const ka = Context.kartenartenOf().find((x) => x.id === 'hoehle');
    ok(ka && JSON.stringify(ka.pflichtsatz) === JSON.stringify(Hoehle.PFLICHT) && ka.kurz && Context.kartenartenOf().map((x) => x.id).join() === 'aussenposten,station,ruine,schiff,wildnis,hoehle', 'kartenartenOf(): hoehle mit Hoehle.PFLICHT und Kurztext, übrige Arten unverändert');
    const gg = fakeGame(); const i = LP.neu(gg, 'kesh', { art: 'hoehle', seed: 5 });
    ok(LP.nutztGenerator(i, LP.eintrag(gg, i)) === true, 'nutztGenerator(hoehle) = true');
    const alt = process.env.PANTHEON_GEN;
    process.env.PANTHEON_GEN = '0';
    try {
      LP.cacheLeeren('hoehle');
      const g0 = fakeGame(); const i0 = LP.neu(g0, 'kesh', { art: 'hoehle', seed: 5 });
      const k0 = LP.karte(g0, i0);
      ok(LP.nutztGenerator(i0, LP.eintrag(g0, i0)) === true && k0.art === 'hoehle' && k0.schablone === 'gen-hoehle', 'PANTHEON_GEN=0: hoehle baut weiter mit dem Erzeuger (kein Modulbau vorhanden)');
    } finally { if (alt === undefined) delete process.env.PANTHEON_GEN; else process.env.PANTHEON_GEN = alt; LP.cacheLeeren(); }
  }

  // ---------------- c) Szenenbau ----------------
  abschnitt('Szenenbau-Probe (c)');
  {
    const katalog = Katalog.load({});
    const ctx = Context.build({}, {}, katalog);
    ok((ctx.kartenarten || []).some((x) => x.id === 'hoehle'), 'Spielleiter-Kontext führt hoehle (e)');
    const plan = (szenen) => ({
      format: 'grobplan/2', id: 'hl_test', titel: 'Höhlen-Test', auftraggeber: 'melk', zielspieldauer_min: 12, aufhaenger: 'Ein Testauftrag.',
      szenen: [{ id: 's1_hafen', szenentyp: 'hafen', ort: 'hafen', karte: null, molekuele: [], sachverhalt: 'Auftrag.', wendung: null, dauer_min: 2, weiter: [{ wenn: 'immer', nach: szenen[0].id }] },
        ...szenen.map((s, i) => Object.assign({ karte: null, sachverhalt: s.id + ' (Test).', wendung: null, dauer_min: 4,
          molekuele: [{ id: 'probe_nehmen', umsetzung: 'am_fund' }], weiter: i < szenen.length - 1 ? [{ wenn: 'immer', nach: szenen[i + 1].id }] : [{ wenn: 'gut', nach: 'ausgang:erfolg' }, { wenn: 'schlecht', nach: 'ausgang:abbruch' }] }, s))],
      entscheidungen: [],
    });
    const mitBraucht = (braucht) => {
      const kat = klon(katalog); const u = kat.molekuele.probe_nehmen && kat.molekuele.probe_nehmen.umsetzungen.find((x) => x.id === 'am_fund');
      if (u) u.buehne_braucht = braucht;
      return { env: SB.buildEnv(kat), u };
    };
    const codes = (r) => new Set(r.errors.map((x) => (/^([A-Z-]+):/.exec(x) || [])[1]));
    {
      const { env, u } = mitBraucht({ kartenarten: ['hoehle'], anker: ['fund', 'deckung'] });
      ok(!!u, 'Probe-Umsetzung im Katalog gefunden (probe_nehmen/am_fund)');
      const p = plan([{ id: 's2_hoehle', ort: 'kesh', szenentyp: 'erkundung', buehne: { kartenart: 'hoehle', neu: true } }]);
      const r = SB.aufloesen(p, env, ctx);
      ok(!codes(r).has('BUEHNE-ART') && !codes(r).has('BUEHNE-ANKER') && !r.errors.length, 'buehne { kartenart: hoehle, neu } mit Bedarf fund+deckung: kein BUEHNE-ART/-ANKER (' + r.errors.join(' | ').slice(0, 160) + ')');
      ok(/^kesh\.hoehle-\d+$/.test(p.szenen[1].landepunkt || '') && r.neu.some((x) => x.art === 'hoehle'), 'neuer Landepunkt kesh.hoehle-<n> in der Vorschau (' + p.szenen[1].landepunkt + ')');
    }
    {
      const { env } = mitBraucht({ kartenarten: ['hoehle'], anker: ['fund', 'eingang'] });
      const p = plan([{ id: 's2_hoehle', ort: 'kesh', szenentyp: 'erkundung', buehne: { kartenart: 'hoehle', neu: true } }]);
      const r = SB.aufloesen(p, env, ctx);
      ok(codes(r).has('BUEHNE-ANKER') && !codes(r).has('BUEHNE-ART'), 'Gegenprobe: Anker eingang (fehlt in der Höhle) -> BUEHNE-ANKER, nicht BUEHNE-ART');
    }
    {
      const { env } = mitBraucht({ kartenarten: ['station'], anker: ['fund'] });
      const p = plan([{ id: 's2_hoehle', ort: 'kesh', szenentyp: 'erkundung', buehne: { kartenart: 'hoehle', neu: true } }]);
      ok(SB.aufloesen(p, env, ctx).errors.length > 0, 'Gegenprobe: Umsetzung nur für station -> Höhle wird abgelehnt');
    }
    {
      // Besetzung (Katalog: einsatz kennt hoehle bei den aussenposten-Rezepten; sonst Fallback auf ALLE Rezepte, GEL-01 Befund 1)
      const { env } = mitBraucht({ kartenarten: ['hoehle'], anker: ['fund'] });
      const p = plan([{ id: 's2_hoehle', ort: 'kesh', szenentyp: 'erkundung', buehne: { kartenart: 'hoehle', neu: true }, besetzung: [{ fraktion: 'raubzug', staerke: 'klein' }, { fraktion: 'rostmeute', staerke: 'mittel' }] }]);
      const r = SB.aufloesen(p, env, ctx);
      ok(!r.errors.some((x) => /^FRAKTION/.test(x)) && !r.errors.length, 'Szene hoehle + besetzung raubzug und rostmeute: kein FRAKTION-Problem (' + r.errors.join(' | ').slice(0, 160) + ')');
      const pb = Katalog.pruefeBesetzung([{ fraktion: 'raubzug', staerke: 'klein' }, { fraktion: 'rostmeute', staerke: 'mittel' }], { katalog, kartenart: 'hoehle' });
      ok(!pb.fehler.length, 'pruefeBesetzung(hoehle): raubzug und rostmeute zulässig');
      ok(Katalog.pruefeBesetzung([{ fraktion: 'kustoden', staerke: 'klein' }], { katalog, kartenart: 'hoehle' }).fehler.some((x) => x.code === 'FRAKTION'), 'Gegenprobe: kustoden hat auf der Höhle kein Rezept -> FRAKTION');
      const ohne = klon(katalog); for (const rz of Object.keys(ohne.fraktionen.raubzug.einsatz)) ohne.fraktionen.raubzug.einsatz[rz] = ohne.fraktionen.raubzug.einsatz[rz].filter((a) => a !== 'hoehle');
      ok(Katalog.pruefeBesetzung([{ fraktion: 'raubzug', staerke: 'klein' }], { katalog: ohne, kartenart: 'hoehle' }).fehler.some((x) => x.code === 'FRAKTION'), 'Gegenprobe: ohne hoehle im einsatz meldet pruefeBesetzung FRAKTION');
      // Invariante: je Fraktion gilt auf hoehle genau, was auf aussenposten und wildnis gilt (sieben Fraktionen)
      const abw = []; let mit = 0;
      for (const [fid, f] of Object.entries(katalog.fraktionen)) for (const rz of Object.keys(f.rezepte || {})) { const e = (f.einsatz || {})[rz]; if (!e) { abw.push(fid + '/' + rz + ' ohne einsatz'); continue; } if (e.includes('hoehle')) mit++; if (e.includes('aussenposten') !== e.includes('hoehle') || e.includes('wildnis') !== e.includes('hoehle')) abw.push(fid + '/' + rz); }
      ok(!abw.length && mit > 0, 'Katalog: hoehle steht genau bei den aussenposten-/wildnis-Rezepten (' + mit + ' Rezepte; Abweichungen: ' + abw.join(', ') + ')');
    }
    const braucht = { kartenarten: ['hoehle'], anker: ['fund', 'deckung', 'abholpunkt'], min: { fund: 2, deckung: 4 } };
    ok(Objects.pruefeBuehneBraucht(braucht, karte).length === 0, 'pruefeBuehneBraucht: gebaute Höhle erfüllt fund/deckung/abholpunkt');
    ok(Objects.pruefeBuehneBraucht({ kartenarten: ['hoehle'], anker: ['eingang'] }, karte).some((x) => x.code === 'BUEHNE-ANKER'), 'pruefeBuehneBraucht: eingang fehlt -> BUEHNE-ANKER');
    ok(Objects.landepunkt('kesh.hoehle-4') && Objects.landepunkt('kesh.hoehle-4').art === 'hoehle', 'objects.landepunkt(): dynamische ID <ort>.hoehle-<n> wird erkannt');
  }

  // ---------------- Besetzung über den echten Weg (Arena) ----------------
  abschnitt('Besetzung und Start (Testgelände über Arena)');
  {
    const gm = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    gm.addConnection(c); gm.handleMessage(c, { t: 'hello', clientId: 'H0', name: 'H0', color: 0 }); gm.handleMessage(c, { t: 'ready', ready: true });
    Arena.start(gm, 'arena_away', Game.arenaParams({ art: 'hoehle', seed: 5, groesse: 'klein', biom: 'vulkan' }));
    const map = gm.away && gm.away.map;
    const k = W.AWAY_MAPS[map] && W.AWAY_MAPS[map].karte;
    const p = gm.players[0];
    ok(/^kesh\.hoehle-\d+$/.test(map || '') && k && k.art === 'hoehle', 'Arena-Testgelände baut die Höhle (' + map + ')');
    ok(k.w === Hoehle.GROESSEN.klein.w && k.h === Hoehle.GROESSEN.klein.h, 'Testgelände groesse=klein: Karte ' + k.w + 'x' + k.h + ' (biom wird für hoehle verworfen)');
    ok(gm.arena && gm.arena.params && !('biom' in gm.arena.params) && gm.arena.params.groesse === 'klein', 'game.arena.params merkt groesse, kein biom');
    const ab = k.anker.find((a) => a.id === k.ankunft);
    ok(p.zone === 'away' && Math.floor(p.x / 32) === ab.x && Math.floor(p.y / 32) === ab.y, 'Spieler startet am Abholpunkt (Ankunft) der Karte');
    for (let i = 0; i < 90; i++) gm.step();
    ok(gm.errors === 0 && gm.away.drones.length === 0, 'ohne Besetzung: keine Gegner, keine Serverfehler');
    const lager = Object.keys(k.bereiche).filter((b) => k.bereiche[b].gefecht).sort();
    let gesamt = 0; const imLager = [];
    for (const b of lager) {
      const vorher = gm.away.drones.length;
      const m = Combat.besetzen(gm, { map, bereich: b, fraktion: 'raubzug', staerke: 'klein', tag: 't_' + b });
      gesamt += m;
      const r = k.bereiche[b].rects;
      imLager.push(m > 0 && gm.away.drones.slice(vorher).every((d) => { const tx = Math.floor(d.x / 32), ty = Math.floor(d.y / 32); return r.some((q) => tx >= q[0] && tx < q[0] + q[2] && ty >= q[1] && ty < q[1] + q[3]); }));
    }
    ok(lager.length >= 1 && gesamt > 0 && gm.away.drones.length === gesamt && imLager.every(Boolean), `besetzen je Lager-Bereich: ${gesamt} Gegner in ${lager.length} Lagern, alle im Bereich`);
    ok(Combat.besetzen(gm, { map, fraktion: 'raubzug', staerke: 'mittel', tag: 't_alle' }) > 0, 'besetzen ohne Bereich nimmt die Gefechtsbereiche');
    // nur Rezepte, die für aussenposten gelten, nie Schiffs-/Stationsrezepte (Fallback auf alle Rezepte wäre der Fehler)
    const kat = Katalog.load({}); const verboten = ['enterrotte', 'schiffswache', 'keil']; const bes = [];
    for (const fr of ['raubzug', 'kontor', 'rostmeute', 'rom', 'ger', 'herrenlos', 'hrafnheim_wache']) {
      for (let t = 0; t < 6; t++) Combat.besetzen(gm, { map, bereich: lager[0], fraktion: fr, staerke: 'gross', tag: 'r_' + fr + t });
      for (const [tag, b] of Object.entries(gm.away.besetzt)) if (tag.startsWith('r_' + fr)) for (const rz of b.rezepte) bes.push([fr, rz]);
    }
    const falsch = bes.filter(([fr, rz]) => verboten.includes(rz) || !(kat.fraktionen[fr].einsatz[rz] || []).includes('hoehle'));
    ok(bes.length > 20 && !falsch.length, `besetzen auf der Höhle: ${bes.length} Rezepte, alle mit hoehle im einsatz, keine Schiffsrezepte (${falsch.map((x) => x.join('/')).join(', ')})`);
    ok(bes.some(([fr, rz]) => fr === 'raubzug' && (rz === 'jaeger' || rz === 'sturm')) && !bes.some(([fr, rz]) => fr === 'raubzug' && rz === 'keil'), 'raubzug: jaeger/sturm ja, keil nie');
    ok(bes.some(([fr]) => fr === 'rostmeute'), 'rostmeute besetzt (' + bes.filter(([fr]) => fr === 'rostmeute').map((x) => x[1]).filter((v, i, a) => a.indexOf(v) === i).join(',') + ')');
    ok((k.patrouillen || []).length > 0, 'Patrouillenwege aus den patrouille-Ankern kompiliert (' + (k.patrouillen || []).length + ')');
    for (let i = 0; i < 300; i++) gm.step();
    ok(gm.errors === 0 && gm.away.drones.filter((d) => d.alive).length > 0, 'nach 10 s Spielzeit: keine Serverfehler, Gegner leben (' + gm.away.drones.filter((d) => d.alive).length + ')');
    const pl = gm.awayMapPayload(k);
    ok(pl && pl.art === 'hoehle' && pl.kv === Game.kartenVersion(k), 'awayMap-Nachricht: art hoehle, kv gesetzt');
    // Arena-Parameter: Größe bleibt für hoehle, biom nicht; andere Arten wie bisher
    let r = Game.arenaParams({ art: 'hoehle', seed: 3, biom: 'vulkan', groesse: 'GROSS' });
    ok(r && r.art === 'hoehle' && r.groesse === 'gross' && !('biom' in r), 'arenaParams: hoehle behält groesse, verwirft biom');
    r = Game.arenaParams({ art: 'hoehle', seed: 3, groesse: 'riesig' });
    ok(r && r.art === 'hoehle' && !('groesse' in r), 'arenaParams: ungültige groesse verworfen');
    r = Game.arenaParams({ art: 'aussenposten', seed: 3, groesse: 'klein' });
    ok(r && !('groesse' in r), 'arenaParams: groesse bei anderen Kartenarten (außer wildnis/hoehle) verworfen');
    r = Game.arenaParams({ art: 'wildnis', seed: 3, biom: 'vulkan', groesse: 'klein' });
    ok(r && r.biom === 'vulkan' && r.groesse === 'klein', 'arenaParams: wildnis unverändert');
  }

  // ---------------- d) Payload ----------------
  abschnitt(`awayMap-Payload (d): ${SEEDS} Seeds je Größe`);
  {
    const grenze = Protocol.AWAY_MAP_MAX_BYTES;
    let gesamtMax = 0;
    for (const gr of Object.keys(Hoehle.GROESSEN)) {
      let max = 0, ueber = 0, fehl = 0, versuche = 0;
      for (let s = 0; s < SEEDS; s++) {
        const gg = fakeGame(); const i = LP.neu(gg, 'kesh', { art: 'hoehle', seed: 101 + s * 7919, gen: { groesse: gr } });
        try {
          const k = LP.karte(gg, i);
          const b = Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
          if (b > max) max = b; if (b > grenze) ueber++; if (k.meta.versuche > 1) versuche++;
        } catch (x) { fehl++; }
        W.unregister(i);
      }
      gesamtMax = Math.max(gesamtMax, max);
      ok(fehl === 0 && ueber === 0, `${gr}: ${SEEDS} Karten, awayMap max ${max} B (Grenze ${grenze}), ${ueber} darüber, ${fehl} Fehlbauten, ${versuche} mit Seed-Wiederholung`);
    }
    console.log(`  awayMap-Payload max über alle Größen: ${gesamtMax} B`);
  }

  // ---------------- f) Client (ohne Browser) ----------------
  abschnitt('Client (f): Listen, Stimmung, Deko, Testgelände-URL');
  {
    const S = await imp('public/js/voxel/stimmung.js');
    const D = await imp('public/js/voxel/deko.js');
    const bauweisen = fs.readdirSync(path.join(ROOT, 'content/buehnen/bauweisen')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    ok(!!S.HOEHLE_STIMMUNG.hoehle && S.HOEHLE_ARTEN.includes('hoehle') && /\.\.\.HOEHLE_STIMMUNG/.test(lies('public/js/voxel/renderer.js')), 'stimmung.js/renderer.js: Höhlenstimmung eingebaut (MOOD_FALLBACK)');
    // Entscheidung: die Bauweisen-Tabellen bekommen keinen Schlüssel hoehle; stimmungVon liefert 'hoehle' für die Art immer (auch mit Tabelle ohne Eintrag oder ganz ohne Tabelle)
    for (const bw of bauweisen) { const t = rd('content/buehnen/bauweisen/' + bw + '.json'); ok(S.stimmungVon(t.stimmung, 'hoehle', null) === 'hoehle' && S.stimmungVon(t.stimmung, 'hoehle', 'erde') === 'hoehle', `${bw}: stimmungVon(hoehle) = hoehle ohne Tabelleneintrag`); }
    ok(S.stimmungVon(null, 'hoehle', null) === 'hoehle' && S.stimmungVon({ hoehle: 'x' }, 'hoehle', null) === 'x', 'stimmungVon: ohne Tabelle hoehle; ein Tabelleneintrag hoehle würde gewinnen');
    ok(D.regelFuer('hoehle', 'hoehle', { hoehle: { props: ['x'] }, '*': { props: ['y'] } }) === null && D.besitzStreuFuerOrt('hoehle', ['a', 'b']).length === 0, 'deko.js: Höhle nimmt weder Altstück-Regeln noch Besitz-Streugut (wie wildnis)');
    ok(D.streuenWildnis({ w: 4, h: 4, seed: 1, art: 'hoehle', boden: 'gras', kindAt: () => 'gelaende', anker: [] }).length === 0, 'deko.js: kein Bodenbewuchs in der Höhle');
    ok(/hoehle: 'HÖHLE'/.test(lies('public/js/consoles.js')) && /hoehle: 'Höhle'/.test(lies('public/js/consoles.js')), 'consoles.js: Anzeigenamen der Kartenart (Transfer-Konsole, Landepunkt-Liste)');
    ok(/'biom', 'groesse'\]\)\) \{/.test(lies('public/js/client.js')), 'client.js: Rückfall-Feldliste der URL kennt groesse (?arena=away&art=hoehle&seed=…&groesse=klein)');
    // Wellen: der Client baut sein Menü aus WELLEN_KARTEN
    ok(!(Protocol.WELLEN_KARTEN || []).includes('hoehle'), 'Wellen-Menü ohne hoehle');
    // Karten für den Client: Zeichen der Höhle gibt es alle in kacheln.json
    const kacheln = rd('content/buehnen/kacheln.json').zeichen;
    const k = bauen(3, { groesse: 'klein' });
    const zeichen = [...new Set(k.rows.join('').split(''))];
    ok(zeichen.every((c) => kacheln[c]), 'jedes Zeichen der Höhlenkarte steht in kacheln.json: ' + zeichen.sort().join(''));
  }

  console.log(`\n${n - bad}/${n} ok`);
  if (bad) { console.log(`${bad} FEHLER`); process.exit(1); }
  console.log('TEST-HOEHLE-VERDRAHTUNG OK');
})().catch((e) => { console.error(e); process.exit(1); });
