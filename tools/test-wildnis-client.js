#!/usr/bin/env node
'use strict';
// GEL-01 D: Kartenart wildnis auf der Client-/Werkzeugseite, ohne Browser: Bodentöne und Stimmungen je Biom in den Bauweisen-Dateien, Kit/Platzhalter
// je Kachelart der Wildnis, deterministische Bewuchs-Streuung (deko.js streuenWildnis), Testgelände-Parameter biom/groesse (Client -> Server -> Erzeuger).
//   node tools/test-wildnis-client.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
const Buehne = require('../shared/buehne.js');
const Gelaende = require('../shared/gen-gelaende.js');
const Protocol = require('../shared/protocol.js');
const W = require('../server/world.js');
const Arena = require('../server/sim/arena.js');
const { Game } = require('../server/game.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, ''));
const lies = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);

(async () => {
  const D = await imp('public/js/voxel/deko.js');
  const S = await imp('public/js/voxel/stimmung.js');
  const G = await imp('public/js/voxel/glut.js');
  const kit = lies('public/js/voxel/kit.js');
  const kacheln = rd('content/buehnen/kacheln.json').zeichen;
  const bauweisen = fs.readdirSync(path.join(ROOT, 'content/buehnen/bauweisen')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  const BIOME = Gelaende.BIOME;

  // Karten aller Biome (mehrere Seeds), fertig durch den Prüfer (wie der Server)
  const karten = [];
  for (const biom of BIOME) for (const seed of [3, 4, 7]) {
    const r = Buehne.ausRaster(Gelaende.erzeuger().karteRoh(seed, { biom, groesse: 'klein', bauweise: 'germanen' }), { spiel: true });
    if (r.pruefung.ok) karten.push({ biom, seed, k: r.karte });
  }
  const boeden = [...new Set(karten.map((x) => x.k.meta.boden))].sort();

  abschnitt('Bodentöne und Stimmungen je Biom in den Bauweisen-Dateien');
  ok(karten.length === 9, 'neun Karten (3 Biome x 3 Seeds) gebaut und vom Prüfer akzeptiert: ' + karten.length);
  ok(boeden.join(',') === 'gras,vulkan,wueste', 'Erzeuger setzt meta.boden: wueste, gras, vulkan (eigene Töne, kein Platzhalter wald): ' + boeden.join(','));
  const farben = new Set([...kit.matchAll(/^\s*(?:\/\/[^\n]*\n\s*)?(?:[a-z_]+: '#[0-9A-Fa-f]{6}',\s*)+/gm)].flatMap((m) => [...m[0].matchAll(/([a-z_]+): '#/g)].map((x) => x[1])));
  for (const bw of bauweisen) {
    const t = rd('content/buehnen/bauweisen/' + bw + '.json');
    ok(!!(t.stimmung && t.stimmung.wildnis), `${bw}: stimmung.wildnis (Rückfall)`);
    for (const b of boeden) {
      const id = t.stimmung && t.stimmung['wildnis:' + b];
      ok(!!id && !!S.WILDNIS_STIMMUNG[id], `${bw}: stimmung["wildnis:${b}"] -> ${id} ist in stimmung.js (WILDNIS_STIMMUNG) belegt`);
      ok(S.stimmungVon(t.stimmung, 'wildnis', b) === id, `${bw}: stimmungVon(wildnis, ${b}) liest den Biom-Eintrag`);
    }
    ok(S.stimmungVon(t.stimmung, 'wildnis', 'unbekannt') === t.stimmung.wildnis && S.stimmungVon(t.stimmung, 'wildnis', null) === t.stimmung.wildnis, `${bw}: unbekannter/fehlender Boden fällt auf stimmung.wildnis zurück`);
    ok(S.stimmungVon(t.stimmung, 'aussenposten', 'wueste') === (t.stimmung.aussenposten || null), `${bw}: andere Kartenarten lesen weiter stimmung[art] (Biom-Schlüssel wirkt nur für wildnis)`);
    // Bodentöne: nur Dateien mit boden_varianten (germanen, rom_feld: ohne diese Tabelle bleibt der Boden wie bisher, bewusst)
    if (t.boden_varianten) {
      for (const b of boeden) {
        const e = t.boden_varianten[b];
        ok(!!(e && e.gelaende && e.gelaende.top && e.gelaende.fill && e.weg && e.weg.top), `${bw}: boden_varianten.${b} mit gelaende.top/fill und weg.top`);
        for (const r of [e && e.gelaende && e.gelaende.top, e && e.gelaende && e.gelaende.fill, e && e.weg && e.weg.top]) ok(!r || farben.has(r) || /^(soil|soil_dark|stone)/.test(r), `${bw}: boden_varianten.${b}: Rolle ${r} hat eine Platzhalterfarbe (FARB_FB) oder ist eine Palettenrolle`);
      }
      for (const b of ['sand', 'gras', 'wald']) ok(!!t.boden_varianten[b], `${bw}: bisherige Töne bleiben (${b})`);
    }
  }
  for (const [id, m] of Object.entries(S.WILDNIS_STIMMUNG)) ok(m.background && m.hemi && m.sun && m.fog && m.exposure > 0, `Stimmung ${id}: Hintergrund, Nebel, Hemi, Sonne, Belichtung gesetzt`);
  const hell = (c) => { const v = parseInt(c.slice(1), 16); return ((v >> 16) & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11; };
  ok(hell(S.WILDNIS_STIMMUNG.wildnis_vulkan.background) < 60 && hell(S.WILDNIS_STIMMUNG.wildnis_wueste.background) > 150 && hell(S.WILDNIS_STIMMUNG.wildnis_wiesenwald.background) > 150, 'Stimmungen: Vulkan dunkel, Wüste und Wiesenwald hell');
  ok(/MOOD_FALLBACK = \{[\s\S]*\.\.\.WILDNIS_STIMMUNG/.test(lies('public/js/voxel/renderer.js')), 'renderer.js: MOOD_FALLBACK enthält die Wildnis-Stimmungen (im Spiel greifen sie ohne Datei)');
  ok(G.glutAusnahme('wildnis', 'germanen') && !G.glutAusnahme('ruine', 'germanen'), 'glut.js: wildnis (Lava bleibt im Nebel hell), Ruine unverändert');

  abschnitt('Kit/Platzhalter je Kachelart der Wildnis');
  const fbKinds = new Set([...kit.slice(kit.indexOf('\nconst FB = {')).matchAll(/^ {2}([a-z_0-9]+)\(pen, p, F/gm)].map((m) => m[1]));
  const zeichen = new Set(karten.flatMap((x) => x.k.rows.join('').split('')));
  const kinds = [...new Set([...zeichen].map((c) => (kacheln[c] || {}).kind))];
  ok(![...zeichen].some((c) => !kacheln[c]), 'jedes Zeichen der Wildnis-Karten steht in kacheln.json: ' + [...zeichen].sort().join(''));
  const NO_KIT = ['gelaende', 'fels', 'leere', 'abgrund'];   // wie tools/check-assets.mjs KIND_NO_KIT: Terrain macht kit.js selbst
  for (const kd of kinds) {
    const mitTabelle = bauweisen.every((bw) => rd('content/buehnen/bauweisen/' + bw + '.json').kits[kd]);
    ok(fbKinds.has(kd) || NO_KIT.includes(kd) || mitTabelle || kd === 'baum', `kind ${kd}: Platzhalter FB.${kd}, Terrain oder Bauweisen-Eintrag`);
  }
  ok(fbKinds.has('findling') && fbKinds.has('bewuchs'), 'kit.js: Platzhalter FB.findling (Steine o/O) und FB.bewuchs (Bodenbewuchs)');
  ok(/\(wildnis \|\| hoehle\) && \(kind === 'deckung_halb' \|\| kind === 'deckung_voll'\)/.test(kit) && /fb: 'findling'/.test(kit), 'kit.js: o/O der Wildnis laufen über FB.findling');
  ok(/streuenWildnis\(\{ w: k\.w/.test(kit) && /FB\.bewuchs\(pen/.test(kit), 'kit.js: Bodenbewuchs wird aus streuenWildnis über FB.bewuchs gezeichnet (nur Optik)');

  abschnitt('Bodenbewuchs: Determinismus und Grenzen');
  const kindAtVon = (k) => (x, y) => { const c = k.rows[y] && k.rows[y][x]; return c ? (kacheln[c] || {}).kind : null; };
  // Echter Spielweg: der Server schickt für die Wildnis kein `seed` (nur kv = Game.kartenVersion), der Client leitet den Bewuchs-Seed in kit.js ab:
  // seed = fnv(String(m.id || 'karte') + ':' + (m.kv || '')). Gleiche Ableitung hier (fnv wie in kit.js), nicht k.seed.
  ok(/const seed = m\.seed != null \? \(m\.seed >>> 0\) : fnv\(String\(m\.id \|\| 'karte'\) \+ ':' \+ \(m\.kv \|\| ''\)\);/.test(kit) && /for \(const dd of streuenWildnis\(\{ w: k\.w, h: k\.h, seed: k\.seed,/.test(kit), 'kit.js: Bewuchs-Seed = fnv(id:kv) (m.seed nur mit Kulisse), streuenWildnis bekommt k.seed');
  const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  ok(/function fnv\(str, h\) \{\n  h = h == null \? 0x811c9dc5 : h;\n  for \(let i = 0; i < str\.length; i\+\+\) \{ h \^= str\.charCodeAt\(i\); h = Math\.imul\(h, 16777619\); \}\n  return h >>> 0;/.test(kit.replace(/\r\n/g, '\n')), 'kit.js: fnv wie in diesem Test nachgebildet');
  const spielSeed = (k) => fnv(String(k.id || 'karte') + ':' + (Game.kartenVersion(k) || ''));
  const streu = (k, seed) => D.streuenWildnis({ w: k.w, h: k.h, seed: seed != null ? seed : spielSeed(k), art: 'wildnis', boden: k.meta.boden, kindAt: kindAtVon(k), anker: k.anker });
  const ZEICHEN_ERLAUBT = new Set('F:oOvsaY'.split(''));
  const IDS = { wueste: ['gras', 'kiesel'], wiesenwald: ['gras', 'blume'], vulkan: ['asche', 'kiesel'] };   // kein Kaktus (Gegenstand ohne Kollision) und keine Glutsteinchen (Glut nur in der Lava)
  for (const { biom, seed, k } of karten) {
    const a = streu(k), b = streu(k), c = streu(k, spielSeed(k) + 1);
    ok(a.length > 0 && JSON.stringify(a) === JSON.stringify(b), `${biom}/${seed}: gleiche Eingabe, gleiche Streuung (${a.length} Einträge)`);
    ok(JSON.stringify(a) !== JSON.stringify(c), `${biom}/${seed}: anderer Seed, andere Streuung`);
    const kd = kindAtVon(k), ank = k.anker;
    ok(a.every((d) => kd(d.x, d.y) === 'gelaende'), `${biom}/${seed}: nur auf freiem Gelände (nie auf fester Kachel, Stein, Busch, Wasser, Lava)`);
    ok(a.every((d) => !ank.some((q) => Math.max(Math.abs(q.x - d.x), Math.abs(q.y - d.y)) <= D.WILDNIS_ANKER_FREI)), `${biom}/${seed}: nie auf und neben Ankern (Abstand > ${D.WILDNIS_ANKER_FREI})`);
    ok(new Set(a.map((d) => d.x + ',' + d.y)).size === a.length, `${biom}/${seed}: höchstens ein Eintrag je Kachel`);
    ok(a.every((d) => IDS[biom].includes(d.id)), `${biom}/${seed}: nur Sätze des Bioms (${[...new Set(a.map((d) => d.id))].sort().join(',')})`);
    ok(a.every((d) => Number.isFinite(d.dx) && Math.abs(d.dx) <= 0.15 && Math.abs(d.dz) <= 0.15), `${biom}/${seed}: Versatz innerhalb der Kachel`);
    ok(k.rows.join('').split('').every((ch) => ZEICHEN_ERLAUBT.has(ch)), `${biom}/${seed}: rows enthalten keine Bewuchs-Zeichen (nur ${[...ZEICHEN_ERLAUBT].join('')}, kein awayMap-Byte für Bewuchs)`);
  }
  ok(karten.every((x) => x.k.rows.join('') === Buehne.ausRaster(Gelaende.erzeuger().karteRoh(x.seed, { biom: x.biom, groesse: 'klein', bauweise: 'germanen' }), { spiel: true }).karte.rows.join('')), 'die Streuung verändert die Karte nicht (rows gleich bei erneutem Bau)');
  const w = karten.find((x) => x.biom === 'wiesenwald').k;
  const bl = streu(w).filter((d) => d.id === 'blume');
  ok(bl.length > 20 && new Set(bl.map((d) => d.var)).size >= 3, `Wiesenwald: Blumen in mehreren Farbgruppen (${new Set(bl.map((d) => d.var)).size})`);
  const nachbar = new Map(); for (const d of bl) { const key = Math.floor(d.x / 5) + ',' + Math.floor(d.y / 5); (nachbar.get(key) || nachbar.set(key, new Set()).get(key)).add(d.var); }
  ok([...nachbar.values()].every((s) => s.size === 1), 'Wiesenwald: je Blühfleck (5x5) eine Farbgruppe');
  const dichte = (biom) => { const x = karten.find((q) => q.biom === biom).k; const frei = x.rows.join('').split('').filter((c) => c === ':').length; return streu(x).length / frei; };
  ok(dichte('wiesenwald') > dichte('vulkan') && dichte('vulkan') > dichte('wueste'), `Dichte je Biom unterschiedlich: Wiesenwald ${dichte('wiesenwald').toFixed(2)} > Vulkan ${dichte('vulkan').toFixed(2)} > Wüste ${dichte('wueste').toFixed(2)}`);
  ok(D.streuenWildnis({ w: 4, h: 4, seed: 1, art: 'aussenposten', boden: 'gras', kindAt: () => 'gelaende', anker: [] }).length === 0, 'andere Kartenarten: keine Bewuchs-Streuung');
  ok(D.streuenWildnis({ w: 4, h: 4, seed: 1, art: 'wildnis', boden: null, kindAt: () => 'gelaende', anker: [] }).length === 0, 'ohne bekannten Bodenton: keine Streuung');
  ok(D.regelFuer('gelaende', 'wildnis', { gelaende: { props: ['x'] }, '*': { props: ['y'] } }) === null && D.besitzStreuFuerOrt('wildnis', ['a', 'b']).length === 0, 'Wildnis nimmt weder Altstück-Regeln noch Besitz-Streugut der Bauweise (kein Fass im Gelände)');
  ok(D.regelFuer('hof', 'ruine', { hof: { props: ['x'] } }) !== null && D.besitzStreuFuerOrt('ruine', ['a']).length === 1, 'Ruine bleibt unverändert (Regeln und Besitz-Streu)');

  abschnitt('Testgelände-Parameter biom und groesse');
  ok(Protocol.ARENA_AWAY_FIELDS.includes('biom') && Protocol.ARENA_AWAY_FIELDS.includes('groesse'), 'protocol.ARENA_AWAY_FIELDS enthält biom und groesse');
  ok(JSON.stringify(Protocol.GELAENDE_BIOME) === JSON.stringify(Gelaende.BIOME) && JSON.stringify(Protocol.GELAENDE_GROESSEN.slice().sort()) === JSON.stringify(Object.keys(Gelaende.GROESSEN).sort()), 'protocol-Listen GELAENDE_BIOME/GROESSEN entsprechen dem Erzeuger (BIOME, GROESSEN)');
  ok(/'biom', 'groesse'(, 'hoehle')?\]\)\) \{/.test(lies('public/js/client.js')), 'client.js: Rückfall-Feldliste der URL kennt biom und groesse');
  const P = (o) => Game.arenaParams(o);
  let r = P({ art: 'wildnis', seed: 3, biom: 'vulkan', groesse: 'klein' });
  ok(r && r.art === 'wildnis' && r.seed === 3 && r.biom === 'vulkan' && r.groesse === 'klein', 'arenaParams: gültiges biom/groesse für wildnis durchgereicht');
  r = P({ art: 'wildnis', seed: 3, biom: 'VULKAN', groesse: 'Gross' });
  ok(r.biom === 'vulkan' && r.groesse === 'gross', 'arenaParams: Groß-/Kleinschreibung wie bei den anderen Feldern ignoriert');
  r = P({ art: 'wildnis', seed: 3, biom: 'dschungel', groesse: 'riesig' });
  ok(r && r.art === 'wildnis' && !('biom' in r) && !('groesse' in r), 'arenaParams: ungültiges biom/groesse wird verworfen, die Karte startet trotzdem');
  r = P({ art: 'wildnis', seed: 3, biom: 'vulkan; drop', groesse: '../x' });
  ok(r && !('biom' in r) && !('groesse' in r), 'arenaParams: Sonderzeichen verworfen');
  r = P({ art: 'aussenposten', seed: 3, biom: 'vulkan', groesse: 'klein' });
  ok(r && r.art === 'aussenposten' && !('biom' in r) && !('groesse' in r), 'arenaParams: biom/groesse bei anderen Kartenarten verworfen');
  ok(P({ biom: 'vulkan' }) === null, 'arenaParams: ohne art weiter null');
  // über den echten Weg Client-Parameter -> Game.arenaParams -> Arena.start -> landepunkte (gen) -> Erzeuger
  for (const [biom, groesse, boden] of [['vulkan', 'klein', 'vulkan'], ['wueste', 'gross', 'wueste'], ['wiesenwald', 'mittel', 'gras']]) {
    const gm = new Game({ noStore: true, seed: 9, debug: true, env: { MISSION_SOURCE: 'fallback' }, log: () => {} });
    const c = { inbox: [], send(m) { this.inbox.push(m); } };
    gm.addConnection(c); gm.handleMessage(c, { t: 'hello', clientId: 'W1', name: 'W1', color: 0 }); gm.handleMessage(c, { t: 'ready', ready: true });
    Arena.start(gm, 'arena_away', Game.arenaParams({ art: 'wildnis', seed: 3, biom, groesse }));
    const k = W.AWAY_MAPS[gm.away && gm.away.map] && W.AWAY_MAPS[gm.away.map].karte;
    const G2 = Gelaende.GROESSEN[groesse];
    ok(k && k.art === 'wildnis' && k.meta.biom === biom && k.meta.boden === boden && k.w === G2.w && k.h === G2.h, `Testgelände ?biom=${biom}&groesse=${groesse}: Karte ${k && k.w}x${k && k.h}, meta.biom ${k && k.meta.biom}, boden ${k && k.meta.boden}`);
    ok(k && k.bauversion.startsWith('gelaende.' + Gelaende.VERSION + '['), 'bauversion der Karte: gelaende.' + Gelaende.VERSION + '[…] (Erzeuger-VERSION, Cache-Invalidierung)');
    const pl = gm.awayMapPayload(k);
    ok(pl && pl.seed === undefined && pl.kv === Game.kartenVersion(k), 'awayMap-Nachricht der Wildnis: kein seed (nur kv): der Client-Bewuchs-Seed kommt aus id:kv');
    ok(gm.arena && gm.arena.params && gm.arena.params.biom === biom, 'game.arena.params merkt biom (Anzeige/Folgeläufe)');
    ok(gm.errors === 0, 'keine Serverfehler beim Start');
  }
  ok(Gelaende.VERSION >= 2, 'gen-gelaende VERSION >= 2');

  // Befund 6: Laden der Bauweisen-/Kacheldaten übersteht Verzögerung und Ausfall (kit-regeln.js jsonLader, von kit.js benutzt)
  abschnitt('JSON-Lader: Verzögerung, Wiederholung, kein null im Cache');
  {
    const R = await imp('public/js/voxel/kit-regeln.js');
    const antwort = (status, wert) => ({ ok: status >= 200 && status < 300, status, json: async () => wert });
    // fetch, der bei den ersten `haengt` Aufrufen nie antwortet (nur der Abbruch beendet ihn), danach den Wert liefert
    const mock = (haengt, wert) => { const m = { n: 0, f: (url, o) => { m.n++; if (m.n <= haengt) return new Promise((res, rej) => { if (o && o.signal) o.signal.addEventListener('abort', () => rej(new Error('abort'))); }); return Promise.resolve(antwort(200, wert)); } }; return m; };
    const klein = (m) => R.jsonLader({ fetch: m.f, ms: [25, 50, 100], pause: 2 });
    const bw = { id: 'germanen', stimmung: { 'wildnis:vulkan': 'wildnis_vulkan' } };
    let m = mock(0, bw), l = klein(m);
    ok((await l.lade('/b.json')) === bw && (await l.lade('/b.json')) === bw && m.n === 1, 'Normalfall: ein Abruf, danach aus dem Cache');
    m = mock(2, bw); l = klein(m);
    ok((await l.lade('/b.json')) === bw && m.n === 3, 'zwei hängende Abrufe (Zeitüberlauf) werden wiederholt, der dritte liefert die Bauweise (' + m.n + ' Abrufe)');
    m = mock(9, bw); l = klein(m);
    ok((await l.lade('/b.json')) === null && m.n === 3, 'dauerhaft hängend: nach drei Versuchen null');
    m.n = 99;   // jetzt antwortet der Server wieder: das gescheiterte Laden darf NICHT zwischengespeichert sein
    ok((await l.lade('/b.json')) === bw, 'gescheitertes Laden wird nicht gecacht: der nächste Bau holt die Bauweise nach (vorher: null blieb für die Sitzung)');
    let fehl = 0; const f5 = () => { fehl++; return Promise.resolve(fehl < 3 ? antwort(503, null) : antwort(200, bw)); };
    ok((await R.jsonLader({ fetch: f5, ms: [25, 50, 100], pause: 2 }).lade('/x.json')) === bw && fehl === 3, '5xx wird wiederholt');
    let n404 = 0; const l4 = R.jsonLader({ fetch: () => { n404++; return Promise.resolve(antwort(404, null)); }, ms: [25, 50, 100], pause: 2 });
    ok((await l4.lade('/o.json')) === null && (await l4.lade('/o.json')) === null && n404 === 1, '404 (optionale Datei): null, ohne Wiederholung, gemerkt');
    let wirft = 0; const lw = R.jsonLader({ fetch: () => { wirft++; return Promise.reject(new Error('Netz')); }, ms: [25, 50, 100], pause: 2 });
    ok((await lw.lade('/n.json')) === null && wirft === 3 && (await lw.lade('/n.json')) === null && wirft === 6, 'Netzfehler: drei Versuche, null, beim nächsten Laden wieder versucht');
    // Letzter Rückfall der Stimmung: ohne Bauweisen-Tabelle bekommt die Wildnis trotzdem die Stimmung ihres Bodentons
    ok(S.stimmungVon({}, 'wildnis', 'vulkan') === 'wildnis_vulkan' && S.stimmungVon(null, 'wildnis', 'gras') === 'wildnis_wiesenwald' && S.stimmungVon({}, 'wildnis', 'wueste') === 'wildnis_wueste' && S.stimmungVon({}, 'aussenposten', 'vulkan') === null, 'stimmungVon: leere Tabelle -> Biom-Stimmung nur für wildnis, andere Arten null');
    ok(/const lader = jsonLader\(\);\s*function getJson\(url\) \{ return lader\.lade\(url\); \}/.test(kit), 'kit.js: getJson läuft über den Lader mit Wiederholung (kein festes 4-s-null im Cache mehr)');
  }
  console.log(`\n${n - bad}/${n} ok${bad ? '  ' + bad + ' FEHLER' : ''}`);
  console.log(bad ? 'TEST-WILDNIS-CLIENT FEHLER' : 'TEST-WILDNIS-CLIENT OK');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
