#!/usr/bin/env node
'use strict';
// SCH-01 P1: Erzeuger shared/gen-schiff.js (Kartenart schiff, Schablone gen-schiff, Layouts schiff und rechteck, Zustände intakt/verfallen/umkaempft)
//   a) Prüfer-Sweep je layout × zustand (K-KANTE, K-DECK …), Würfe < 2 %, awayMap-Größe, Länge   b) Pflichtsatz, Bereichsrollen
//   c) Determinismus   d) Zustandsunterschied   e) Rechteck symmetrisch   f) Wachen (Abstand, Türnähe), Fallenplätze
//   node tools/test-gen-schiff.js      (Umgebung: SEEDS=<n> je layout × zustand, Standard 50; VERBOSE=1)
const fs = require('fs');
const path = require('path');
const Buehne = require('../shared/buehne.js');
const GenSchiff = require('../shared/gen-schiff.js');
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const { Game } = require('../server/game.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else if (process.env.VERBOSE) console.log('  ok   ' + t); };
const abschnitt = (t) => console.log('[' + t + ']');
const SEEDS = Math.max(1, +process.env.SEEDS || 50);
const G = GenSchiff.erzeuger();
const LAYOUTS = ['schiff', 'rechteck'], ZUSTAENDE = ['intakt', 'verfallen', 'umkaempft'];
const MAX = Protocol.AWAY_MAP_MAX_BYTES || 16384;
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const seedVon = (i) => 1 + i * 37;
const TUEREN = 'DSLG';

const karten = {};   // layout/zustand -> [{ seed, roh, r }]
abschnitt('a) Prüfer-Sweep (' + SEEDS + ' Seeds je layout × zustand)');
for (const layout of LAYOUTS) for (const zustand of ZUSTAENDE) {
  const liste = []; let wuerfe = 0, rot = 0, bmax = 0, lmax = 0;
  for (let i = 0; i < SEEDS; i++) {
    const seed = seedVon(i);
    let roh;
    try { roh = G.karteRoh(seed, { layout, zustand, id: 'test.prise', bauweise: 'germanen', besitz: 'rostmeute' }); } catch (e) { wuerfe++; if (!/^gen-schiff:/.test(e.message)) ok(false, `${layout}/${zustand} Seed ${seed}: unkontrollierter Fehler ${e.message}`); continue; }
    const r = Buehne.ausRaster(roh, { spiel: true, cfg: CONFIG.buehne });
    if (!r.pruefung.ok) { rot++; ok(false, `${layout}/${zustand} Seed ${seed}: Prüfer ${r.fehler.slice(0, 3).map((f) => f.code + ' ' + f.msg).join('; ')}`); }
    const b = payloadB(r.karte); bmax = Math.max(bmax, b); lmax = Math.max(lmax, roh.w);
    liste.push({ seed, roh, r });
  }
  karten[layout + '/' + zustand] = liste;
  ok(wuerfe <= Math.floor(SEEDS * 0.02), `${layout}/${zustand}: ${wuerfe} von ${SEEDS} Würfen (höchstens 2 %)`);
  ok(rot === 0, `${layout}/${zustand}: ${rot} Karten mit Prüferfehlern`);
  ok(bmax <= MAX, `${layout}/${zustand}: awayMap max ${bmax} B <= ${MAX}`);
  ok(lmax <= GenSchiff.erzeuger().MAXLAENGE && lmax <= 74, `${layout}/${zustand}: Länge max ${lmax} <= 74`);
  console.log(`  ${layout}/${zustand}: ${liste.length} Karten, Würfe ${wuerfe}, awayMap max ${bmax} B, Länge max ${lmax}`);
}
const alle = [].concat(...Object.keys(karten).map((k) => karten[k].map((e) => Object.assign({ k }, e))));

abschnitt('b) Pflichtsatz und Bereichsrollen');
{
  let fehlt = 0, bereich = 0, art = 0, meta = 0;
  for (const e of alle) {
    const k = e.roh, zahl = {};
    for (const a of k.anker) zahl[a.rolle] = (zahl[a.rolle] || 0) + 1;
    for (const rolle of Object.keys(k.meta.pflicht)) {
      const nn = rolle === 'lift' || rolle === 'leiter' ? k.decks.links.filter((l) => l.via === rolle).length : (zahl[rolle] || 0);
      if (nn < k.meta.pflicht[rolle]) { fehlt++; ok(false, `${e.k} Seed ${e.seed}: ${rolle} ${nn} < ${k.meta.pflicht[rolle]}`); }
    }
    for (const rolle of ['hinein', 'ziel', 'rueckzug']) {
      const b = Object.values(k.bereiche).filter((x) => x.rolle === rolle);
      if (!b.length || b.every((x) => !x.rects.length)) { bereich++; ok(false, `${e.k} Seed ${e.seed}: Bereichsrolle ${rolle} fehlt oder leer`); }
    }
    const gef = Object.values(k.bereiche).filter((x) => x.gefecht);
    if (!gef.length || gef.some((x) => !x.rects.length)) { bereich++; ok(false, `${e.k} Seed ${e.seed}: Gefechtsbereich fehlt oder leer`); }
    // areaDef (server/mission/objects.js): hinein/ziel/rueckzug über Schlüssel oder Rolle auflösbar
    for (const rolle of ['hinein', 'ziel', 'rueckzug']) if (!k.bereiche[rolle] && !Object.values(k.bereiche).some((x) => x.rolle === rolle)) bereich++;
    if (k.art !== 'schiff' || k.schablone !== 'gen-schiff' || k.bauversion !== 'gschiff1' || k.decks.stride !== 16 || !k.ankunft) art++;
    if (!Array.isArray(k.meta.fallenplaetze) || !k.meta.fallenplaetze.length) meta++;
    if (e.k.endsWith('/umkaempft') && k.meta.haltung !== 'wach') meta++;
  }
  ok(fehlt === 0, `Pflichtsatz bei allen ${alle.length} Karten erfüllt`);
  ok(bereich === 0, 'Bereichsrollen hinein, ziel, rueckzug und ein Gefechtsbereich vorhanden und nicht leer (alle Layouts und Zustände)');
  ok(art === 0, 'Kartenfelder art/schablone/bauversion/decks/ankunft wie P0');
  ok(meta === 0, 'meta.fallenplaetze nicht leer, umkaempft setzt meta.haltung wach');
}

abschnitt('c) Determinismus');
{
  let gleich = 0, tot = 0;
  for (const layout of LAYOUTS) for (const zustand of ZUSTAENDE) for (const seed of [3, 77, 1234]) {
    const o = { layout, zustand, id: 'x', bauweise: 'rom', besitz: 'a' };
    let a, b; try { a = JSON.stringify(G.karteRoh(seed, o)); b = JSON.stringify(GenSchiff.erzeuger().karteRoh(seed, o)); } catch (e) { continue; }
    tot++; if (a === b) gleich++;
  }
  ok(tot > 0 && gleich === tot, `gleicher Seed + opts liefert byte-gleiche Rohkarte (${gleich}/${tot})`);
  const a = G.karteRoh(5, { layout: 'schiff' }), b = G.karteRoh(6, { layout: 'schiff' });
  ok(JSON.stringify(a.rows) !== JSON.stringify(b.rows), 'verschiedene Seeds liefern verschiedene Karten');
  ok(JSON.stringify(G.karteRoh(5, {}).rows) === JSON.stringify(G.karteRoh(5, { layout: 'schiff' }).rows), 'Standardlayout ist schiff');
  ok(JSON.stringify(G.karteRoh(5, { layout: 'schiff' }).rows) !== JSON.stringify(G.karteRoh(5, { layout: 'rechteck' }).rows), 'layout rechteck unterscheidet sich von schiff');
}

abschnitt('d) Zustandsunterschied');
{
  let verf = 0, umk = 0, wach = 0, vk = 0, tot = 0;
  const zaehle = (rows, re) => rows.join('').split('').filter((c) => re.test(c)).length;
  for (const layout of LAYOUTS) for (let i = 0; i < Math.min(SEEDS, 30); i++) {
    const seed = seedVon(i);
    let a, b, c; try { a = G.karteRoh(seed, { layout, zustand: 'intakt' }); b = G.karteRoh(seed, { layout, zustand: 'verfallen' }); c = G.karteRoh(seed, { layout, zustand: 'umkaempft' }); } catch (e) { continue; }
    tot++;
    if (zaehle(b.rows, /[xX~]/) > zaehle(a.rows, /[xX~]/)) verf++;
    if (JSON.stringify(c.rows) !== JSON.stringify(a.rows) && zaehle(c.rows, /[xXo~]/) > zaehle(a.rows, /[xXo~]/)) umk++;
    if (c.anker.filter((q) => q.rolle === 'wache').length > a.anker.filter((q) => q.rolle === 'wache').length) wach++;
    if (b.zustand === 'verfallen' && c.zustand === 'umkaempft' && a.zustand === 'intakt') vk++;
  }
  ok(tot > 0 && verf === tot, `verfallen hat mehr Trümmer/Löcher als intakt (${verf}/${tot})`);
  ok(umk === tot, `umkaempft verändert die Karte (mehr Deckung/Trümmer) (${umk}/${tot})`);
  ok(wach === tot, `umkaempft hat mehr Wachen als intakt (${wach}/${tot})`);
  ok(vk === tot, 'Rohkarte trägt zustand');
  const ueb = alle.filter((e) => e.roh.zustand !== 'intakt');
  ok(ueb.filter((e) => e.roh.meta.ueberzug === 'voll').length >= ueb.length * 0.9, `Überzug voll bei mindestens 90 % der Karten (${ueb.filter((e) => e.roh.meta.ueberzug === 'voll').length}/${ueb.length})`);
}

abschnitt('e) Rechteck symmetrisch');
{
  const klasse = (c) => (c === '#' ? '#' : c === '_' ? '_' : TUEREN.includes(c) ? 'D' : '.');
  let sym = 0, folgeOk = 0, rundum = 0, gleichBreit = 0, tot = 0;
  for (const e of karten['rechteck/intakt']) {
    tot++;
    const k = e.roh; let s = true;
    for (const d of [0, 1]) for (let y = 1; y <= 11; y++) { const r = k.rows[d * 16 + y]; for (let x = 0; x < k.w; x++) if (klasse(r[x]) !== klasse(r[k.w - 1 - x])) s = false; }
    for (const d of [0, 1]) for (const y of [0, 12]) { const r = k.rows[d * 16 + y]; if (r.replace(/[SDL]/g, '#') !== r.replace(/[SDL]/g, '#').split('').reverse().join('')) s = false; }
    if (s) sym++;
    let f = true;
    for (const fo of k.meta.raumfolge) { const o = fo.filter((_, i) => i % 2 === 0), u = fo.filter((_, i) => i % 2 === 1); if (o.join() !== o.slice().reverse().join() || u.join() !== u.slice().reverse().join()) f = false; }
    if (f) folgeOk++;
    // keine Verjüngung: Deck 1 Zeile 1 und Zeile 11 sind über die ganze Länge (außer Hüllenspalten) Innenraum oder Wand, nie '_'
    if (!k.rows[1].slice(1, -1).includes('_') && !k.rows[11].slice(1, -1).includes('_')) rundum++;
    // gleiche Sektionsbreiten: Abstände der Schottspalten (S in Zeile 6) spiegeln sich
    const sp = []; for (let x = 0; x < k.w; x++) if (k.rows[6][x] === 'S') sp.push(x);
    if (sp.every((x, i) => x === k.w - 1 - sp[sp.length - 1 - i])) gleichBreit++;
  }
  ok(sym === tot, `Raster ohne Ausstattung spiegelsymmetrisch (Wände, Türen, Hülle) (${sym}/${tot})`);
  ok(folgeOk === tot, `Raumfolge je Seite palindromisch (${folgeOk}/${tot})`);
  ok(rundum === tot, `Hülle nicht verjüngt (${rundum}/${tot})`);
  ok(gleichBreit === tot, `Schottspalten spiegeln sich (${gleichBreit}/${tot})`);
  const sch = karten['schiff/intakt'].filter((e) => e.roh.rows[1].includes('_', 4) && /_/.test(e.roh.rows[1].slice(2, -2))).length;
  ok(sch === karten['schiff/intakt'].length, `layout schiff ist verjüngt (${sch}/${karten['schiff/intakt'].length})`);
}

abschnitt('f) Wachen und Fallenplätze');
{
  let nahe = 0, tuer = 0, pad = 0, deckA = 0, fz = 0, fl = 0;
  for (const e of alle) {
    const k = e.roh, ws = k.anker.filter((a) => a.rolle === 'wache');
    const padA = k.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
    const c = (x, y) => (k.rows[y] || '')[x];
    for (let i = 0; i < ws.length; i++) {
      const a = ws[i];
      for (let j = i + 1; j < ws.length; j++) if (ws[j].deck === a.deck && Math.hypot(ws[j].x - a.x, ws[j].y - a.y) < 4) nahe++;
      let t = false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (TUEREN.includes(c(a.x + dx, a.y + dy) || '.')) t = true;
      if (t) tuer++;
      if (a.deck === padA.deck && Math.hypot(a.x - padA.x, a.y - padA.y) < 6) pad++;
    }
    if (new Set(ws.map((a) => a.deck)).size < 2) deckA++;
    for (const f of k.meta.fallenplaetze) {
      fz++;
      if (c(f.x, f.y) !== ',' || k.anker.some((a) => a.rolle !== 'falle' && Math.abs(a.x - f.x) <= 1 && Math.abs(a.y - f.y) <= 1)) fl++;
    }
  }
  ok(nahe === 0, `Wachen je Deck mindestens 4 Kacheln auseinander (${nahe} Verstöße)`);
  ok(tuer === 0, `keine Wache auf oder neben einer Tür/einem Schott (${tuer} Verstöße)`);
  ok(pad === 0, `keine Wache näher als 6 Kacheln an der Ankunft (${pad} Verstöße)`);
  ok(deckA === 0, 'Wachen auf beiden Decks');
  ok(fl === 0, `Fallenplätze liegen auf Gangkacheln ohne Anker in der Nähe (${fz} Plätze, ${fl} Verstöße)`);
}

abschnitt('g) Katalog-Bedarf (externe Referenz), Patrouillen, Ankerzahlen');
{
  // Referenz ist der Katalog, nicht der Generator: jede Molekül-Umsetzung mit buehne_braucht, die Kartenart schiff zulässt, muss auf jeder Generatorkarte bestehen
  const O = require('../server/mission/objects.js');
  const dir = path.join(__dirname, '..', 'content', 'katalog', 'molekuele');
  const bedarf = [];
  const geh = (o, datei) => { if (!o || typeof o !== 'object') return; if (o.buehne_braucht && (!o.buehne_braucht.kartenarten || o.buehne_braucht.kartenarten.includes('schiff'))) bedarf.push([datei + ':' + (o.id || '?'), o.buehne_braucht]); for (const v of Object.values(o)) geh(v, datei); };
  for (const fn of fs.readdirSync(dir)) if (fn.endsWith('.json')) geh(JSON.parse(fs.readFileSync(path.join(dir, fn), 'utf8')), fn);
  ok(bedarf.length >= 10, `Katalog: ${bedarf.length} Umsetzungen mit buehne_braucht für Kartenart schiff gefunden (mindestens 10)`);
  ok(bedarf.some(([nm, b]) => b.min && b.min.ziel >= 3), 'Katalog enthält den Bedarf ziel >= 3 (krise_eindaemmen/ventile)');
  const fehl = new Map(); let geprueft = 0;
  for (const e of alle) for (const [nm, b] of bedarf) { geprueft++; const f = O.pruefeBuehneBraucht(b, e.r.karte, 'test.prise'); if (f.length) fehl.set(nm + ' | ' + f[0].msg, (fehl.get(nm + ' | ' + f[0].msg) || 0) + 1); }
  ok(alle.length >= 30 * 6 || SEEDS < 30, `Stichprobe ${alle.length} Karten (Seeds x Layouts x Zustände)`);
  ok(fehl.size === 0, `alle ${bedarf.length} Katalog-Bedarfe auf allen ${alle.length} Generatorkarten erfüllt (${geprueft} Prüfungen)${fehl.size ? ' – ' + [...fehl].slice(0, 3).map(([k2, c]) => k2 + ' x' + c).join('; ') : ''}`);

  // Patrouillen: karte.patrouillen aus den Ankern (Prüfer), je Deck eine zusammenhängende Kette auf begehbaren Kacheln
  const BEG = ',.PDSLG';
  let leer = 0, ketten = 0, kachelFalsch = 0, luecke = 0, idFalsch = 0, zuWenig = 0, zielWenig = 0, beuteAus = 0, wacheFalsch = 0, spreng = 0;
  const SOLL_WACHE = { intakt: 5, verfallen: 4, umkaempft: 7 };
  for (const e of alle) {
    const k = e.r.karte, rows = k.rows, byId = new Map(k.anker.map((a) => [a.id, a]));
    const zahl = (rolle) => k.anker.filter((a) => a.rolle === rolle).length;
    if (!k.patrouillen.length || k.patrouillen.some((w) => !w.length)) leer++;
    if (k.patrouillen.length !== 2) ketten++;
    for (const w of k.patrouillen) {
      const pts = w.map((id) => byId.get(id));
      if (pts.some((a) => !a || a.rolle !== 'patrouille')) { idFalsch++; continue; }
      if (pts.some((a) => !BEG.includes(rows[a.y][a.x]))) kachelFalsch++;
      for (let i = 1; i < pts.length; i++) {   // Kettenglieder zusammenhängend: BFS über begehbare Kacheln (Decks getrennt, kein Lift nötig)
        const [a, b] = [pts[i - 1], pts[i]];
        if (Math.floor(a.y / 16) !== Math.floor(b.y / 16)) { luecke++; continue; }
        const seen = new Set([a.x + ',' + a.y]), q = [[a.x, a.y]]; let hit = false;
        for (let j = 0; j < q.length && !hit; j++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = q[j][0] + dx, y = q[j][1] + dy;
          if (x === b.x && y === b.y) { hit = true; break; }
          if (!seen.has(x + ',' + y) && BEG.includes((rows[y] || '')[x] || '_')) { seen.add(x + ',' + y); q.push([x, y]); }
        }
        if (!hit) luecke++;
      }
    }
    // Untere Schranken aus 30 Modul-Seeds (Modul: patrouille 8..9, ziel 5, beute 9..12, wache 9..10, sprengpunkt 2): Hälfte bzw. Katalogbedarf
    if (zahl('patrouille') < 4) zuWenig++;
    if (zahl('ziel') < 3) zielWenig++;
    if (zahl('beute') < 8 || zahl('beute') > 12) beuteAus++;
    if (zahl('wache') !== SOLL_WACHE[k.zustand]) wacheFalsch++;
    if (zahl('sprengpunkt') !== 1) spreng++;
  }
  ok(leer === 0, `Patrouillen vorhanden und nicht leer (${leer} Karten ohne)`);
  ok(ketten === 0, `je Deck eine Patrouillenkette, also genau 2 Wege (${ketten} Abweichungen)`);
  ok(idFalsch === 0 && kachelFalsch === 0, `Kettenglieder sind patrouille-Anker auf begehbaren Kacheln (${idFalsch} fremde Glieder, ${kachelFalsch} auf nicht begehbaren Kacheln)`);
  ok(luecke === 0, `Ketten zusammenhängend: aufeinanderfolgende Glieder über begehbare Kacheln verbunden (${luecke} Lücken)`);
  ok(zuWenig === 0, `patrouille-Anker >= 4 je Karte (${zuWenig} darunter)`);
  ok(zielWenig === 0, `ziel-Anker >= 3 je Karte (${zielWenig} darunter)`);
  ok(beuteAus === 0, `beute-Anker 8..12 je Karte (${beuteAus} außerhalb)`);
  ok(wacheFalsch === 0, `Wachen intakt 5 / verfallen 4 / umkaempft 7 (${wacheFalsch} Abweichungen)`);
  ok(spreng === 0, `sprengpunkt genau 1 (${spreng} Abweichungen)`);
}

abschnitt('h) Fallen (SCH-01 P5): Anzahl, Typmix, Sicht, Abstände, Erreichbarkeit mit Box, Id-Verschwiegenheit, Determinismus');
{
  const NAH2 = ['lift', 'leiter', 'abholpunkt', 'eingang', 'terminal', 'ziel', 'sprengpunkt'];
  const BLOCK = ['terminal', 'sprengpunkt', 'zelle', 'beute', 'ziel'];
  const z = { zahl: 0, bereich: 0, sicht: 0, mix: 0, deck: 0, abstand: 0, nah: 0, pad: 0, pflicht: 0, schussGang: 0, schussWand: 0, druckOrt: 0, druckMitte: 0, schottKante: 0, insel: 0, erreich: 0, payload: 0, ids: 0, ausserPflicht: 0 };
  const proTyp = {}, proSicht = { passiv: 0, verborgen: 0 }, ans = {};
  let maxPayload = 0, kontrolleOk = 0, kontrolleTot = 0;
  // unabhängige Erreichbarkeit (nicht der Prüfer, nicht der Generator): BFS über R.durchgang der gebauten Karte, Lift/Leiter-Links, Box der Selbstschussanlagen (auch verborgene) und blockende Objekte als Wand
  const bfsMenge = (k, extraWand) => {
    const R = Buehne.raster(k), wand = new Set(extraWand || []);
    for (const a of k.anker) if (BLOCK.includes(a.rolle) || (a.rolle === 'falle' && a.typ === 'schuss')) wand.add(a.x + ',' + a.y);
    const lk = new Map(); for (const l of k.decks.links) { lk.set(l.a[0] + ',' + l.a[1], l.b); lk.set(l.b[0] + ',' + l.b[1], l.a); }
    const pad = k.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
    const seen = new Set([pad.x + ',' + pad.y]), q = [[pad.x, pad.y]];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i]; const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]; const l = lk.get(x + ',' + y); if (l) nb.push(l);
      for (const [nx, ny] of nb) if (!seen.has(nx + ',' + ny) && !wand.has(nx + ',' + ny) && R.durchgang(nx, ny)) { seen.add(nx + ',' + ny); q.push([nx, ny]); }
    }
    return seen;
  };
  const erreichbar = (k, extraWand) => {
    const seen = bfsMenge(k, extraWand);
    return k.anker.filter((a) => !['wache', 'patrouille', 'falle'].includes(a.rolle) && !seen.has(a.x + ',' + a.y) && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((a.x + dx) + ',' + (a.y + dy))));
  };
  for (const e of alle) {
    const k = e.r.karte, rk = e.roh, fa = k.anker.filter((a) => a.rolle === 'falle');
    const zust = e.k.split('/')[1];
    ans[zust + ' ' + fa.length] = (ans[zust + ' ' + fa.length] || 0) + 1;
    if (zust === 'umkaempft' ? fa.length !== 2 : (fa.length < 3 || fa.length > 4)) z.zahl++;
    const sicht = fa.filter((a) => a.sicht === 'passiv').length, verb = fa.length - sicht;
    if (sicht < 1 || verb < 1) z.sicht++;
    for (const a of fa) { proTyp[a.typ] = (proTyp[a.typ] || 0) + 1; if (proSicht[a.sicht] != null) proSicht[a.sicht]++; if (!['schott', 'druck', 'schuss'].includes(a.typ) || !['passiv', 'verborgen'].includes(a.sicht) || a.bereich !== 'gefecht_d' + a.deck || a.deck !== (a.y >= 16 ? 2 : 1)) z.bereich++; }
    if (new Set(fa.map((a) => a.typ)).size < 2) z.mix++;
    if (fa.length >= 3 && !fa.some((a) => a.deck === 2)) z.deck++;
    if (!fa.some((a) => a.deck === 1)) z.deck++;
    const padA = k.anker.find((a) => a.rolle === 'abholpunkt' && a.ankunft);
    for (let i = 0; i < fa.length; i++) {
      const a = fa[i];
      for (let j = i + 1; j < fa.length; j++) if (Math.hypot(fa[j].x - a.x, fa[j].y - a.y) < 5) z.abstand++;   // Regel des Generators: Euklid-Abstand mindestens 5
      for (const b of k.anker) {
        if (b === a || b.rolle === 'falle') continue;
        const c = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        if (c <= 1) z.nah++;
        if (c <= 2 && NAH2.includes(b.rolle)) z.nah++;
      }
      if (Math.hypot(padA.x - a.x, padA.y - a.y) < 4) z.pad++;
      if (a.typ === 'schuss') {
        const rd = a.y % 16;
        if (rd === 6) z.schussGang++;
        if (![1, 3, 9, 11].includes(rd) || k.rows[a.y][a.x] !== '.') z.schussWand++;   // Hüllenzeile der Seitenräume (1, 11) oder Wandzeile der Brücke (3, 9), Bodenkachel
      }
      if (a.typ === 'druck') {
        let nahLoch = false; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx, dy) <= 3 && (k.rows[a.y + dy] || '')[a.x + dx] === '~') nahLoch = true;
        const heck = ['antrieb', 'reaktor'].includes(rk.plaetze[a.platz].typ);
        if (zust === 'intakt' ? !heck : !nahLoch) z.druckOrt++;
        if (rk.plaetze[a.platz].typ === 'sektion') z.druckMitte++;   // S1: das Druckfeld deckt das Platz-Rect; nur wo Sektion = Raum (Heck, Bug)
      }
      if (a.typ === 'schott' && !Buehne.fallenSchottKanten(k, a, CONFIG.anker.falle.schott.radius).length) z.schottKante++;
    }
    {   // H4: keine Druckfalle in einer Schott-Insel (alle Schott-Fallen geschlossen: Druckfallen von der Ankunft aus erreichbar)
      const zu = []; for (const s of fa.filter((q) => q.typ === 'schott')) for (const kk of Buehne.fallenSchottKanten(k, s, CONFIG.anker.falle.schott.radius)) for (const t of kk.tiles) zu.push(t[0] + ',' + t[1]);
      const seen = bfsMenge(k, zu);
      if (fa.some((q) => q.typ === 'druck' && !seen.has(q.x + ',' + q.y))) z.insel++;
    }
    if ((rk.meta.pflicht || {}).falle != null) z.ausserPflicht++;
    const fehlt = erreichbar(k);
    if (fehlt.length) { z.erreich++; ok(false, `${e.k} Seed ${e.seed}: nicht erreichbar mit Fallenbox: ${fehlt.slice(0, 3).map((a) => a.id).join(', ')}`); }
    // Payload: verborgene Fallen weder mit Id noch mit Koordinaten (Anker-Zeilen) im awayMap-Payload
    const pj = Game.prototype.awayMapPayload.call({}, k), ps = JSON.stringify(pj);
    maxPayload = Math.max(maxPayload, Buffer.byteLength(ps));
    for (const a of fa) {
      const inPayload = pj.anker.some((r) => r[0] === a.id || (r[1] === 'falle' && r[2] === a.x && r[3] === a.y));
      if (a.sicht === 'verborgen' ? (inPayload || ps.includes(a.id)) : !pj.anker.some((r) => r[0] === a.id)) z.payload++;
      if (a.sicht === 'verborgen' ? !/^falle\.[0-9a-z]{7}$/.test(a.id) : !/^sek\d+_d[12]\.falle(\.\d)?$/.test(a.id)) z.ids++;
    }
    if (kontrolleTot < 12 && e.k === 'schiff/intakt') {   // Gegenprobe: dieselbe Prüfung muss eine Box im Längsgang (1 Kachel breit) bemerken
      kontrolleTot++;
      let gefunden = false; for (let x = 4; x < k.w - 4 && !gefunden; x++) if (k.rows[6][x] === ',' && erreichbar(k, [x + ',6']).length) gefunden = true;
      if (gefunden) kontrolleOk++;
    }
  }
  const T = alle.length;
  ok(z.zahl === 0, `Anzahl je Karte: umkaempft genau 2, sonst 3 bis 4 (${z.zahl} Verstöße bei ${T} Karten)`);
  ok(z.sicht === 0, `mindestens eine sichtbare (passiv) und eine verborgene Falle je Karte (${z.sicht} Verstöße)`);
  ok(z.mix === 0, `mindestens zwei verschiedene Typen je Karte (${z.mix} Verstöße)`);
  ok(z.deck === 0, `Fallen auf beiden Decks, Deck 2 mindestens eine bei 3 oder mehr (${z.deck} Verstöße)`);
  ok(z.bereich === 0, `Typ und Sicht gültig, bereich gefecht_dN und deck passen zur Kachel (${z.bereich} Verstöße)`);
  ok(z.abstand === 0, `nie zwei Fallen näher als 5 Kacheln (Euklid) (${z.abstand} Verstöße)`);
  ok(z.nah === 0, `nie auf oder neben einem Anker, nie näher als 2 an Lift/Leiter/Abholpunkt/Eingang/Terminal/Ziel/Sprengpunkt (${z.nah} Verstöße)`);
  ok(z.pad === 0, `Mindestabstand 4 zur Ankunft (${z.pad} Verstöße)`);
  ok(z.schussGang === 0 && z.schussWand === 0, `Selbstschussanlage nie im Gang, immer an einer Raumwand auf einer Bodenkachel (${z.schussGang + z.schussWand} Verstöße)`);
  ok(z.druckOrt === 0, `Druckverlust: intakt im Antrieb/Reaktor, sonst höchstens 3 Kacheln von einem Hüllenloch (${z.druckOrt} Verstöße)`);
  ok(z.druckMitte === 0, `Druckverlust nie in einer Mittschiffs-Sektion (Sektion = Raum nur an Heck und Bug, ${z.druckMitte} Verstöße)`);
  ok(z.insel === 0, `Generatorgesetz: keine Druckfalle in einer Schott-Insel (${z.insel} Verstöße)`);
  ok(z.schottKante === 0, `jede Schott-Falle hat ein Schott im Wirkbereich (Buehne.fallenSchottKanten, ${z.schottKante} Verstöße)`);
  ok(z.ausserPflicht === 0, 'Fallen stehen nicht in meta.pflicht');
  ok(z.erreich === 0, `alle Anker (außer Wachen/Patrouillen/Fallen) von der Ankunft aus erreichbar, wenn jede Selbstschussanlage (auch verborgene) ein Hindernis ist (${z.erreich} Karten von ${T})`);
  ok(kontrolleTot > 0 && kontrolleOk === kontrolleTot, `Gegenprobe: eine Box im Längsgang wird von derselben Prüfung bemerkt (${kontrolleOk}/${kontrolleTot})`);
  ok(z.payload === 0, `awayMap-Payload: verborgene Fallen weder mit Id noch mit Koordinaten, sichtbare mit Id (${z.payload} Verstöße)`);
  ok(z.ids === 0, `Ids: verborgen falle.<Hash> (ohne Platz), sichtbar <platz>.falle[.n] (${z.ids} Verstöße)`);
  ok(maxPayload <= MAX, `awayMap-Maximum mit Fallen ${maxPayload} B <= ${MAX}`);
  console.log('  Fallen je Zustand/Anzahl: ' + JSON.stringify(ans) + '; je Typ ' + JSON.stringify(proTyp) + '; je Sicht ' + JSON.stringify(proSicht) + '; awayMap max ' + maxPayload + ' B');
  // Determinismus: gleiche Seeds, gleiche Fallen (auch aus frischem Erzeuger); verschiedene Seeds streuen
  let gleich = 0, tot = 0; const lagen = new Set();
  for (const layout of LAYOUTS) for (const zustand of ZUSTAENDE) for (const seed of [3, 77, 1234]) {
    const o = { layout, zustand, id: 'x' };
    let a, b; try { a = G.karteRoh(seed, o).anker.filter((q) => q.rolle === 'falle'); b = GenSchiff.erzeuger().karteRoh(seed, o).anker.filter((q) => q.rolle === 'falle'); } catch (err) { continue; }
    tot++; if (JSON.stringify(a) === JSON.stringify(b) && a.length >= 2) gleich++;
    lagen.add(JSON.stringify(a.map((q) => [q.x, q.y])));
  }
  ok(tot > 0 && gleich === tot, `Fallen sind seed-stabil (${gleich}/${tot})`);
  ok(lagen.size >= tot * 0.8, `verschiedene Seeds liefern verschiedene Fallenlagen (${lagen.size} von ${tot})`);
}

console.log(`\n${n - bad}/${n} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
