'use strict';
// ORT-01 Paket 1: Rollenmodus der Deko (public/js/voxel/deko.js, opts.rollen).
//   Rückfall (leere/fremde Raumtypen = byte-gleich zum Zellenmodus), Determinismus ohne Math.random, Grenzen (nie Anker/Tür/Pad/
//   Kantenmitte, Abstand zu Ankern und Türen, höchstens 12 je Zelle), Layout-Parität Rom ↔ Germanen (gleicher Strom, nur die Modelle
//   unterscheiden sich), Siedlungs-Innenboden boden2, keine Props fremder Platztypen in Rollenräumen, Besitz-Streuung, Ausschluss.
//   node tools/test-rollen-modus.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const Buehne = require('../shared/buehne.js');
const GS = require('../shared/gen-siedlung.js');
const GT = require('../shared/gen-station.js');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const info = (t) => console.log('  info ' + t);
const section = (name) => console.log('\n[' + name + ']');
const json = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const kacheln = json('content/buehnen/kacheln.json');
const dekoGerm = json('content/buehnen/deko/germanen.json');
const bauweiseGerm = json('content/buehnen/bauweisen/germanen.json');
const ROLLEN = { station: json('tools/fixtures/rollen/station.json'), aussenposten: json('tools/fixtures/rollen/aussenposten.json') };
const BESITZ = json('content/buehnen/paletten/kontor.json').streu || [];

function karte(art, seed, bw) {
  const roh = art === 'station'
    ? GT.erzeuger(96, 56).karteRoh(seed, 8, { bauweise: bw, zustand: 'intakt', id: 't' })
    : GS.erzeuger(130, 90).karteRoh(seed, 10, { bauweise: bw, typ: 'handel', zustand: 'intakt', id: 't' });
  const k = Buehne.ausRaster(roh, { spiel: true }).karte;
  const kindAt = (x, y) => { const c = (k.rows[y] || '')[x]; return c == null || c === '' ? null : kacheln.zeichen[c] ? kacheln.zeichen[c].kind : null; };
  const plaetze = Object.keys(k.plaetze).sort().map((id) => { const p = k.plaetze[id]; return { id, typ: p.typ, x: p.rect[0], y: p.rect[1], w: p.rect[2], h: p.rect[3] }; });
  return { id: 't', w: k.w, h: k.h, seed: k.seed, art: k.art, kindAt, anker: k.anker, plaetze };
}
const dp = bauweiseGerm.deckung_props && bauweiseGerm.deckung_props;
function regelnFuer(art) {   // wie kit.js: Deckungs-Props nicht zusätzlich als Deko
  const ids = new Set(dp && dp[art] ? Object.values(dp[art]).flat() : []);
  for (const id of (bauweiseGerm.deko_ausschluss && bauweiseGerm.deko_ausschluss[art]) || []) ids.add(id);
  const r = Object.assign({}, dekoGerm, { regeln: {} });
  for (const [t, v] of Object.entries(dekoGerm.regeln)) r.regeln[t] = Object.assign({}, v, { props: v.props.filter((i) => !ids.has(i)) });
  return { regeln: r, ids };
}
const inRect = (d, p) => d.x >= p.x && d.y >= p.y && d.x < p.x + p.w && d.y < p.y + p.h;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

(async () => {
  const D = await import(pathToFileURL(path.join(ROOT, 'public/js/voxel/deko.js')).href);
  const { streuen, pruefeStreuung, raumtypVon, belegungVon, MAX_JE_ZELLE } = D;
  const plain = (k, art, extra, rollen, bw) => {
    const { regeln, ids } = regelnFuer(art);
    return streuen(k, regeln, { extra: extra || [], rollen: rollen ? { daten: rollen, bauweise: bw || 'germanen', ausschluss: ids } : null });
  };

  section('Raumtyp aus der Platz-ID');
  ok(raumtypVon('werkstatt_2') === 'werkstatt' && raumtypVon('kommando') === 'kommando' && raumtypVon('krankenstation_11') === 'krankenstation', 'werkstatt_2 → werkstatt, kommando → kommando, krankenstation_11 → krankenstation');
  ok(raumtypVon('strasse_1') === 'strasse' && raumtypVon('') === '' && raumtypVon(null) === '', 'strasse_1 → strasse, leer/null → leer');
  ok(JSON.stringify(belegungVon(ROLLEN.station, 'lager.behaelter', 'rom')) === '["prop/rom/ruine/schutt","prop/rom/ruine/deko_stein"]' && belegungVon(ROLLEN.station, 'lager.werkzeug', 'germanen').length === 1, 'Belegung als Liste (String und Liste)');
  ok(belegungVon(ROLLEN.station, 'gibts.nicht', 'rom').length === 0 && belegungVon(ROLLEN.station, 'lager.behaelter', 'aegypten').length === 0, 'unbekannte Rolle/Bauweise → leere Belegung');
  ok(belegungVon(ROLLEN.station, 'lager.behaelter', 'rom', new Set(['prop/rom/ruine/schutt'])).join() === 'prop/rom/ruine/deko_stein', 'Ausschluss (Deckungs-Props) nimmt IDs aus der Belegung');

  section('Rückfall: ohne Rollen byte-gleich zum Zellenmodus');
  for (const art of ['station', 'aussenposten']) {
    let gleich = 0, gesamt = 0, props = 0;
    for (const s of SEEDS) {
      const k = karte(art, s, 'germanen');
      const basis = JSON.stringify(plain(k, art, BESITZ, null));
      props += JSON.parse(basis).length;
      const leer = { format: 'rollen/1', kartenart: art, raumtypen: {}, rollen: {} };
      const fremd = { format: 'rollen/1', kartenart: art, raumtypen: { nirgends_vorhanden: ROLLEN[art].raumtypen[Object.keys(ROLLEN[art].raumtypen)[0]] }, rollen: ROLLEN[art].rollen };
      gesamt += 2;
      if (JSON.stringify(plain(k, art, BESITZ, leer)) === basis) gleich++;
      if (JSON.stringify(plain(k, art, BESITZ, fremd)) === basis) gleich++;
    }
    ok(gleich === gesamt && props > 0, `${art}: leere Rollen-Datei und Raumtyp ohne Platz auf der Karte → Deko byte-gleich (${gleich}/${gesamt} Karten, ${props} Props)`);
  }

  section('Determinismus, kein Math.random');
  const zufall = Math.random;
  Math.random = () => { throw new Error('Math.random im Rollenmodus'); };
  let det = true, fehlerText = '';
  try {
    for (const art of ['station', 'aussenposten']) for (const s of SEEDS.slice(0, 4)) {
      const k = karte(art, s, 'germanen');
      const a = JSON.stringify(plain(k, art, BESITZ, ROLLEN[art])), b = JSON.stringify(plain(k, art, BESITZ, ROLLEN[art]));
      if (a !== b) det = false;
    }
  } catch (e) { det = false; fehlerText = e.message; }
  Math.random = zufall;
  ok(det, 'zweimal gleich, Math.random wird nicht berührt ' + fehlerText);
  {
    const k1 = karte('station', 1, 'germanen'), k2 = karte('station', 2, 'germanen');
    const a = JSON.stringify(plain(k1, 'station', [], ROLLEN.station).filter((d) => d.rolle)), b = JSON.stringify(plain(k2, 'station', [], ROLLEN.station).filter((d) => d.rolle));
    ok(a !== b, 'verschiedene Seeds → verschiedene Rollen-Stücke');
  }

  section('Grenzen und Rollen-Stücke je Bauweise');
  for (const art of ['station', 'aussenposten']) for (const bw of ['germanen', 'rom']) {
    let verstoesse = 0, rollenStuecke = 0, rollenPlaetze = 0, nah = 0, fremdInRaum = 0, ohneRolle = 0, ausserhalb = 0, deckungInDeko = 0, zelleMax = 0;
    const ids = new Set();
    for (const s of SEEDS) {
      const k = karte(art, s, bw);
      const liste = plain(k, art, [], ROLLEN[art], bw);
      verstoesse += pruefeStreuung(k, liste).length;
      const rp = k.plaetze.filter((p) => ROLLEN[art].raumtypen[raumtypVon(p.id)]);
      rollenPlaetze += rp.length;
      const sperre = [];
      for (const a of k.anker) sperre.push([a.x, a.y]);
      for (let y = 0; y < k.h; y++) for (let x = 0; x < k.w; x++) if (['tuer', 'schott', 'tor', 'luke', 'wand_schwach'].includes(k.kindAt(x, y))) sperre.push([x, y]);
      const jeZelle = new Map();
      for (const d of liste) {
        const z = Math.floor(d.x / 8) + ',' + Math.floor(d.y / 8); jeZelle.set(z, (jeZelle.get(z) || 0) + 1);
        if (d.rolle) {
          rollenStuecke++; ids.add(d.id);
          if (sperre.some(([x, y]) => Math.max(Math.abs(x - d.x), Math.abs(y - d.y)) < 2)) nah++;   // frei_halten ≥ 1: mindestens eine freie Kachel dazwischen
          const p = k.plaetze.find((q) => q.id === d.platz); if (!p || !inRect(d, p)) ausserhalb++;
        } else if (rp.some((p) => inRect(d, p))) fremdInRaum++;
        if (d.rolle && !ROLLEN[art].raumtypen[raumtypVon(d.platz)]) ohneRolle++;
      }
      zelleMax = Math.max(zelleMax, ...jeZelle.values());
    }
    ok(verstoesse === 0, `${art}/${bw}: 0 Verstöße gegen die Vertragsregeln (Anker, Tür, Weg/Pad, Kantenmitte, ≤ ${MAX_JE_ZELLE} je Zelle; größte Zelle ${zelleMax})`);
    ok(rollenStuecke > 0 && rollenPlaetze > 0, `${art}/${bw}: ${rollenStuecke} Rollen-Stücke in ${rollenPlaetze} Rollen-Plätzen (${[...ids].length} verschiedene Modelle)`);
    ok(nah === 0, `${art}/${bw}: Abstand ≥ 2 zu Ankern und Türen (frei_halten)`);
    ok(ausserhalb === 0 && ohneRolle === 0, `${art}/${bw}: Rollen-Stücke nur im Rechteck eines Platzes mit Raumtyp-Eintrag`);
    ok(fremdInRaum === 0, `${art}/${bw}: in Rollen-Räumen steht nur Rollen-Deko (kein Prop eines fremden Platztyps, z. B. Gang-Wandmonitore)`);
    const modelle = [...ids];
    const erlaubt = new Set(Object.values(ROLLEN[art].rollen).flatMap((r) => [].concat(r[bw])));
    ok(modelle.every((m) => erlaubt.has(m)), `${art}/${bw}: nur Modelle der ${bw}-Belegung`);
  }

  section('Fehler im Zellenmodus (Gegenprobe): Props fremder Platztypen wandern in Räume');
  {
    let leck = 0;
    for (const s of SEEDS) {
      const k = karte('station', s, 'germanen');
      const liste = plain(k, 'station', [], null);
      const raeume = k.plaetze.filter((p) => ['lager', 'kommando'].includes(raumtypVon(p.id)));
      for (const d of liste) { const r = raeume.find((p) => inRect(d, p)); if (r && d.platz !== r.id) leck++; }
    }
    ok(leck > 0, `Zellenmodus: ${leck} Props mit fremder Platz-Zuordnung in Lager/Kommando (der Rollenmodus verhindert das, siehe oben)`);
  }

  section('Layout-Parität Rom ↔ Germanen (gleicher Strom, nur die Modelle wechseln)');
  for (const art of ['station', 'aussenposten']) {
    let gleich = 0;
    for (const s of SEEDS) {
      const k = karte(art, s, 'germanen');
      const sig = (bw) => JSON.stringify(plain(k, art, [], ROLLEN[art], bw).map((d) => [d.x, d.y, d.rolle, d.platz, d.rot, d.seed, d.dx, d.dz]));
      if (sig('germanen') === sig('rom')) gleich++;
    }
    ok(gleich === SEEDS.length, `${art}: Positionen, Rollen, Drehung und Versatz in beiden Bauweisen identisch (${gleich}/${SEEDS.length} Seeds)`);
  }

  section('Siedlung: Innenboden boden2 nur mit Rollen');
  {
    let aufBoden2 = 0, gesamt = 0, zellenBoden2 = 0;
    for (const s of SEEDS) {
      const k = karte('aussenposten', s, 'germanen');
      for (const d of plain(k, 'aussenposten', [], ROLLEN.aussenposten)) { gesamt++; if (k.kindAt(d.x, d.y) === 'boden2') { if (d.rolle) aufBoden2++; else zellenBoden2++; } }
    }
    ok(aufBoden2 > 0, `Rollen-Deko steht in Gebäudeplätzen auf boden2 (${aufBoden2} von ${gesamt} Stücken)`);
    ok(zellenBoden2 === 0, 'der Zellenmodus bestreut boden2 weiterhin nie');
  }

  section('Pflichtrollen, kind leit/anker, Besitz-Streuung, Ausschluss');
  {
    let pflichtOk = 0, pflichtN = 0, leitStuecke = 0, besitzMax = 0, besitzAnz = 0, kapFallback = 0;
    for (const s of SEEDS) {
      const k = karte('station', s, 'germanen');
      const liste = plain(k, 'station', BESITZ, ROLLEN.station);
      for (const p of k.plaetze.filter((q) => raumtypVon(q.id) === 'lager')) {
        pflichtN++;
        if (liste.some((d) => d.platz === p.id && d.rolle === 'lager.behaelter')) pflichtOk++;
        besitzMax = Math.max(besitzMax, liste.filter((d) => d.platz === p.id && d.rolle === 'besitz').length);
        besitzAnz += liste.filter((d) => d.platz === p.id && d.rolle === 'besitz').length;
      }
      leitStuecke += liste.filter((d) => d.rolle === 'lager.hauptstueck').length;
    }
    ok(pflichtN > 0 && pflichtOk === pflichtN, `Pflichtrolle lager.behaelter steht in jedem Lager (${pflichtOk}/${pflichtN})`);
    ok(leitStuecke === 0, 'kind anker/leit streut der Rollenmodus nicht (Hauptstücke laufen über Anker/Leit)');
    ok(besitzMax <= 1 && besitzAnz > 0, `Besitz-Streuung: höchstens 1 Stück je Rollen-Platz (${besitzAnz} gesamt)`);
    const k = karte('station', 3, 'germanen');
    const alle = streuen(k, regelnFuer('station').regeln, { rollen: { daten: ROLLEN.station, bauweise: 'germanen', ausschluss: new Set(['prop/germanen/gemein/fass']) } });
    ok(!alle.some((d) => d.rolle && d.id === 'prop/germanen/gemein/fass'), 'Ausschluss-Set (Deckungs-Props) wird in der Rollen-Belegung beachtet');
  }

  section('frei_halten: gewünschte Stufe, Fallback, kein Platz');
  {
    const stufen = { gehalten: 0, fallback: 0, plaetze: 0 };
    for (const s of SEEDS) {
      const k = karte('station', s, 'germanen'), bericht = {};
      const { regeln, ids } = regelnFuer('station');
      streuen(k, regeln, { rollen: { daten: ROLLEN.station, bauweise: 'germanen', ausschluss: ids, bericht } });
      for (const b of Object.values(bericht)) { stufen.plaetze++; if (b.frei_halten === b.gewuenscht) stufen.gehalten++; else stufen.fallback++; }
    }
    ok(stufen.plaetze > 0 && stufen.gehalten > 0, `frei_halten 2 wird bei genug Platz eingehalten (${stufen.gehalten} von ${stufen.plaetze} Plätzen)`);
    // Fallback erzwingen: frei_halten 4 passt in keinen Raum
    const hart = JSON.parse(JSON.stringify(ROLLEN.station)); hart.raumtypen.lager.frei_halten = 4; hart.raumtypen.kommando.frei_halten = 4;
    let fb = 0, fbPlaetze = 0, nahe = 0;
    for (const s of SEEDS) {
      const k = karte('station', s, 'germanen'), bericht = {};
      const liste = streuen(k, regelnFuer('station').regeln, { rollen: { daten: hart, bauweise: 'germanen', bericht } });
      for (const b of Object.values(bericht)) { fbPlaetze++; if (b.frei_halten < 4) fb++; if (b.frei_halten < 1) nahe++; }
      if (pruefeStreuung(k, liste).length) nahe++;
    }
    ok(fbPlaetze > 0 && fb > 0, `Fallback greift: frei_halten 4 fällt zurück (${fb} von ${fbPlaetze} Plätzen), nie unter 1, 0 Verstöße`);
    ok(nahe === 0, 'Fallback-Stufe nie unter 1 und keine Vertragsverstöße');
    // Raum zu klein: ein 1×1-Platz neben einer Tür hat 0 Kandidaten (Anker/Tür-Sperre) und bleibt ohne Stück, ohne Fehler
    const klein = { id: 'k', w: 10, h: 10, seed: 5, art: 'station', kindAt: (x, y) => (x === 2 && y === 1 ? 'tuer' : x >= 0 && y >= 0 && x < 10 && y < 10 ? 'boden' : null), anker: [], plaetze: [{ id: 'lager_1', typ: 'lager', x: 1, y: 1, w: 1, h: 1 }] };
    const bericht = {};
    let wurf = null, liste = null;
    try { liste = streuen(klein, {}, { rollen: { daten: ROLLEN.station, bauweise: 'germanen', bericht } }); } catch (e) { wurf = e; }
    ok(!wurf && liste.length === 0 && bericht.lager_1 && bericht.lager_1.kandidaten === 0 && bericht.lager_1.frei_halten === 1, 'Raum zu klein (0 Kandidaten): kein Stück, kein Fehler, Fallback bis 1');
  }

  section('Zellenmodus bleibt, wo der Rollenmodus nichts streuen kann');
  {
    const nurAnker = { format: 'rollen/1', kartenart: 'station', raumtypen: { lager: { rollen: [ROLLEN.station.raumtypen.lager.rollen[0]] }, kommando: { rollen: [] } }, rollen: ROLLEN.station.rollen };
    const ohneRom = JSON.parse(JSON.stringify(ROLLEN.station)); for (const r of Object.values(ohneRom.rollen)) delete r.rom;
    const kaputt = { format: 'rollen/1', kartenart: 'station', raumtypen: { lager: { rollen: 'kaputt' }, kommando: null }, rollen: ROLLEN.station.rollen };
    let gleich = 0, n2 = 0;
    for (const s of SEEDS) {
      const k = karte('station', s, 'rom');
      const basis = JSON.stringify(plain(k, 'station', BESITZ, null, 'rom'));
      for (const [daten, bw] of [[nurAnker, 'rom'], [ohneRom, 'rom'], [kaputt, 'rom']]) { n2++; if (JSON.stringify(plain(k, 'station', BESITZ, daten, bw)) === basis) gleich++; }
    }
    ok(gleich === n2, `Raumtyp ohne streu-Rolle, Bauweise ohne Belegung und strukturell kaputte Datei: Deko byte-gleich zum Zellenmodus (${gleich}/${n2})`);
    // Fehler im Rollenmodus: Zellen-Deko bleibt, Fehler wird gemeldet
    const k = karte('station', 2, 'germanen'), basisLeer = streuen(k, regelnFuer('station').regeln, {});
    let gemeldet = 0;
    const falle = new Proxy({}, { set() { throw new Error('Testfehler'); } });
    const l = streuen(k, regelnFuer('station').regeln, { rollen: { daten: ROLLEN.station, bauweise: 'germanen', bericht: falle }, onFehler: () => gemeldet++ });
    ok(gemeldet === 1 && l.length > 0 && l.every((d) => !d.rolle), 'Ausnahme im Rollenmodus: kein Wurf, onFehler gemeldet, Zellen-Deko bleibt (keine Rollen-Stücke)');
  }

  section('boden2 nur in Gebäuden des Außenpostens');
  {
    const def = ROLLEN.aussenposten.raumtypen.lager;
    let strasse = 0, gang = 0, gebaeude = 0;
    for (const s of SEEDS) {
      const ka = karte('aussenposten', s, 'germanen');
      const mitStrasse = { format: 'rollen/1', kartenart: 'aussenposten', raumtypen: { strasse: def, platz: def, tor: def }, rollen: ROLLEN.aussenposten.rollen };
      for (const d of plain(ka, 'aussenposten', [], mitStrasse)) if (d.rolle && ka.kindAt(d.x, d.y) === 'boden2') strasse++;
      const ks = karte('station', s, 'germanen');
      const mitGang = { format: 'rollen/1', kartenart: 'station', raumtypen: { gang: def, kreuzung: def, transporter: def }, rollen: ROLLEN.aussenposten.rollen };
      for (const d of plain(ks, 'station', [], mitGang)) if (d.rolle && ks.kindAt(d.x, d.y) === 'boden2') gang++;
      for (const d of plain(ka, 'aussenposten', [], ROLLEN.aussenposten)) if (d.rolle && ka.kindAt(d.x, d.y) === 'boden2') gebaeude++;
    }
    ok(strasse === 0, 'Straße, Platz, Tor (auch mit Rollen-Eintrag): nie auf boden2');
    ok(gang === 0, 'Station: Gang, Kreuzung, Transporter (auch mit Rollen-Eintrag): nie auf boden2 (dort ist boden2 Weg)');
    ok(gebaeude > 0, `Gebäude des Außenpostens (kommando, lager): boden2 erlaubt (${gebaeude} Stücke)`);
    const k = karte('aussenposten', 1, 'germanen');
    const v = pruefeStreuung(Object.assign({}, k, { art: 'station' }), [{ id: 'x', x: 0, y: 0, rolle: 'r', platz: 'lager_1' }]);
    ok(Array.isArray(v), 'pruefeStreuung läuft für Rollen-Stücke ohne Absturz');
  }

  // ---------------- ORT-01 Integration: Hauptstücke (kind leit) und die produktiven Rollen-Dateien ----------------
  const WANDKINDS = ['wand', 'zaun', 'fels', 'gitter', 'fenster', 'pfeiler', 'kante'];
  const PROD = { station: json('content/buehnen/rollen/station.json'), aussenposten: json('content/buehnen/rollen/aussenposten.json') };
  const BAUW = { rom: json('content/buehnen/bauweisen/rom.json'), germanen: json('content/buehnen/bauweisen/germanen.json') };
  const dekoR = { rom: json('content/buehnen/deko/rom.json'), germanen: json('content/buehnen/deko/germanen.json') };
  const prod = (k, art, bw, extra) => {
    const dp = BAUW[bw].deckung_props && BAUW[bw].deckung_props[art];
    const ids = new Set(dp ? Object.values(dp).flat() : []);
    for (const id of (BAUW[bw].deko_ausschluss && BAUW[bw].deko_ausschluss[art]) || []) ids.add(id);
    const r = Object.assign({}, dekoR[bw], { regeln: {} });
    for (const [t, v] of Object.entries(dekoR[bw].regeln)) r.regeln[t] = Object.assign({}, v, { props: v.props.filter((i) => !ids.has(i)) });
    return streuen(k, r, { extra: extra || [], rollen: { daten: PROD[art], bauweise: bw, ausschluss: ids, leitFuss: BAUW[bw].leit_fuss } });
  };
  // Rückwand des Hauptstücks nach Drehung: 0 Norden, π Süden, π/2 Westen, −π/2 Osten
  const rueckwandOk = (k, d) => {
    const [x0, y0, w, h] = d.fuss;
    const rot = d.rot, W = (x, y) => WANDKINDS.includes(k.kindAt(x, y));
    let ok = true;
    if (Math.abs(rot) < 1e-9) { for (let x = x0; x < x0 + w; x++) ok = ok && W(x, y0 - 1); }
    else if (Math.abs(rot - Math.PI) < 1e-9) { for (let x = x0; x < x0 + w; x++) ok = ok && W(x, y0 + h); }
    else if (Math.abs(rot - Math.PI / 2) < 1e-9) { for (let y = y0; y < y0 + h; y++) ok = ok && W(x0 - 1, y); }
    else { for (let y = y0; y < y0 + h; y++) ok = ok && W(x0 + w, y); }
    return ok;
  };

  section('Hauptstücke (kind leit): Platzierung nach Fußabdruck');
  {
    const daten = (wand) => ({ format: 'rollen/1', kartenart: 'station', raumtypen: { lager: { frei_halten: 1, rollen: [{ rolle: 'lager.haupt', kind: 'leit', wandnah: wand }, { rolle: 'lager.streu', kind: 'streu', zug: [1, 2] }] } },
      rollen: { 'lager.haupt': { rom: 'leit/rom/ruine/x', germanen: 'leit/germanen/x' }, 'lager.streu': { rom: ['prop/rom/ruine/deko_stein'], germanen: ['prop/germanen/gemein/kette'] } } });
    const fuss = { 'leit/rom/ruine/x': [2, 1], 'leit/germanen/x': [2, 1] };
    const lauf = (k, wand, bw) => streuen(k, {}, { rollen: { daten: daten(wand), bauweise: bw, leitFuss: fuss } });
    let gesamt = 0, platziert = 0, verstoss = 0, ohneWand = 0, ausserhalb = 0, inhalt = 0;
    const rotAnz = new Set();
    for (const s of SEEDS) {
      const k = karte('station', s, 'germanen');
      const liste = lauf(k, true, 'germanen');
      verstoss += pruefeStreuung(k, liste).length;
      for (const p of k.plaetze.filter((q) => raumtypVon(q.id) === 'lager')) {
        gesamt++;
        const d = liste.find((q) => q.platz === p.id && q.fuss);
        if (!d) continue;
        platziert++;
        rotAnz.add(d.rot);
        if (!rueckwandOk(k, d)) ohneWand++;
        const [x0, y0, w, h] = d.fuss;
        if (x0 < p.x || y0 < p.y || x0 + w > p.x + p.w || y0 + h > p.y + p.h) ausserhalb++;
        if (!((d.rot === 0 || Math.abs(d.rot - Math.PI) < 1e-9) ? w === 2 && h === 1 : w === 1 && h === 2)) inhalt++;
        // kein Streustück auf dem Fuß des Hauptstücks
        if (liste.some((q) => q !== d && q.platz === p.id && q.x >= x0 && q.x < x0 + w && q.y >= y0 && q.y < y0 + h)) inhalt++;
      }
    }
    ok(platziert === gesamt && gesamt > 0, `wandnah: jedes Lager bekommt sein 2×1-Hauptstück (${platziert}/${gesamt})`);
    ok(verstoss === 0 && ausserhalb === 0, 'alle Kacheln des Fußes: nie Anker, Tür, Weg, Kantenmitte, nie über die Raumgrenze (pruefeStreuung inkl. fuss)');
    ok(ohneWand === 0, 'wandnah: der Rücken (−z) liegt über die ganze Breite an einer Wand');
    ok(inhalt === 0, 'Fuß passt zur Drehung (gerade: 2×1, quer: 1×2) und Streu steht nicht auf dem Hauptstück');
    ok(rotAnz.size >= 2, `Drehungen variieren je Seed (${rotAnz.size} verschiedene)`);
    // frei (nicht wandnah): alle Kacheln erlaubt, deterministisch
    let freiOk = 0, freiN = 0;
    for (const s of SEEDS) {
      const k = karte('station', s, 'germanen');
      const a = lauf(k, false, 'germanen');
      freiN++; if (pruefeStreuung(k, a).length === 0 && JSON.stringify(a) === JSON.stringify(lauf(k, false, 'germanen'))) freiOk++;
    }
    ok(freiOk === freiN, `frei stehend: 0 Verstöße und deterministisch (${freiOk}/${freiN})`);
    // Layout-Parität: gleicher Fuß → gleiche Platzierung
    let par = 0;
    for (const s of SEEDS) {
      const k = karte('station', s, 'germanen');
      const sig = (bw) => JSON.stringify(lauf(k, true, bw).map((d) => [d.x, d.y, d.rot, d.dx, d.dz, d.seed, d.rolle, d.fuss]));
      if (sig('rom') === sig('germanen')) par++;
    }
    ok(par === SEEDS.length, `Hauptstück-Position in Rom und Germanen identisch (${par}/${SEEDS.length} Seeds)`);
    // ohne Fuß-Eintrag oder ohne Platz: entfällt ohne Fehler
    const kk = karte('station', 3, 'germanen');
    const ohneFuss = streuen(kk, {}, { rollen: { daten: daten(true), bauweise: 'germanen', leitFuss: {} } });
    ok(!ohneFuss.some((d) => d.fuss) && ohneFuss.length > 0, 'Hauptstück ohne leit_fuss-Eintrag entfällt, Streu bleibt');
    const breit = streuen(kk, {}, { rollen: { daten: daten(true), bauweise: 'germanen', leitFuss: { 'leit/germanen/x': [30, 1] } } });
    ok(!breit.some((d) => d.fuss), 'Hauptstück, das in keinen Raum passt, entfällt ohne Fehler');
    const bericht = {};
    streuen(kk, {}, { rollen: { daten: daten(true), bauweise: 'germanen', leitFuss: fuss, bericht } });
    ok(Object.keys(bericht).length > 0, 'Kapazitätsbericht berücksichtigt den Fuß');
  }

  section('Produktive Rollen-Dateien: Raumtypen, Hauptstücke, Streu, Parität');
  {
    const erwartet = { station: ['kommando', 'reaktor', 'lager', 'quartier', 'messe', 'werkstatt', 'krankenstation', 'zellen'], aussenposten: ['kommando', 'lager', 'werkstatt', 'quartier', 'krankenstation'] };
    for (const art of ['station', 'aussenposten']) {
      ok(JSON.stringify(Object.keys(PROD[art].raumtypen).sort()) === JSON.stringify(erwartet[art].slice().sort()), `${art}: Raumtypen ${Object.keys(PROD[art].raumtypen).join(', ')} (keine Kantine)`);
      for (const [rt, def] of Object.entries(PROD[art].raumtypen)) ok(def.rollen.length >= 5 && def.rollen.length <= 7 && def.rollen.some((e) => e.kind === 'leit'), `${art}/${rt}: ${def.rollen.length} Rollen, mindestens ein Hauptstück`);
    }
    for (const art of ['station', 'aussenposten']) {
      let par = 0, verstoss = 0, hauptSoll = 0, hauptIst = 0, wandFehl = 0, dichteMin = 99, nahAnker = 0;
      const modelle = { rom: new Set(), germanen: new Set() };
      for (const s of SEEDS) {
        const k = karte(art, s, 'germanen');
        const kr = karte(art, s, 'rom');
        const sig = (kk, bw) => JSON.stringify(prod(kk, art, bw).filter((d) => d.rolle).map((d) => [d.x, d.y, d.rot, d.dx, d.dz, d.seed, d.rolle, d.platz, d.fuss]));
        for (const bw of ['rom', 'germanen']) {
          const kk = bw === 'rom' ? kr : k, liste = prod(kk, art, bw);
          verstoss += pruefeStreuung(kk, liste).length;
          for (const d of liste) if (d.rolle) modelle[bw].add(d.id);
          if (bw === 'germanen') {
            for (const p of kk.plaetze) {
              const def = PROD[art].raumtypen[raumtypVon(p.id)]; if (!def) continue;
              hauptSoll += def.rollen.filter((e) => e.kind === 'leit').length;
              const mine = liste.filter((d) => d.platz === p.id && d.rolle);
              hauptIst += mine.filter((d) => d.fuss).length;
              for (const d of mine.filter((q) => q.fuss)) { const e = def.rollen.find((r) => r.rolle === d.rolle); if (e.wandnah && !rueckwandOk(kk, d)) wandFehl++; }
              if (art === 'station') dichteMin = Math.min(dichteMin, mine.length);
              for (const a of kk.anker.filter((q) => q.platz === p.id)) for (const d of mine) { const t = d.fuss ? [] : [[d.x, d.y]]; if (d.fuss) for (let y = d.fuss[1]; y < d.fuss[1] + d.fuss[3]; y++) for (let x = d.fuss[0]; x < d.fuss[0] + d.fuss[2]; x++) t.push([x, y]); if (t.some(([x, y]) => x === a.x && y === a.y)) nahAnker++; }
            }
          }
        }
        // Layout-Parität: bei gleicher Karte (Station: identisches Raster) gleiche Positionen; Außenposten hat für rom ein eigenes Layout, dort wird die Bauweise auf derselben Karte getauscht
        const sigTausch = (bw) => JSON.stringify(prod(k, art, bw).filter((d) => d.rolle).map((d) => [d.x, d.y, d.rot, d.dx, d.dz, d.seed, d.rolle, d.platz, d.fuss]));
        if (sigTausch('rom') === sigTausch('germanen')) par++;
      }
      ok(verstoss === 0, `${art}: 0 Verstöße in 10 Seeds × 2 Bauweisen (Anker, Tür, Weg, Kantenmitte, Raumgrenze, ≤ 12 je Zelle)`);
      ok(par === SEEDS.length, `${art}: Layout-Parität Rom ↔ Germanen ${par}/${SEEDS.length} Seeds (Position, Drehung, Versatz, Fuß je Rolle)`);
      ok(wandFehl <= Math.ceil(hauptIst * 0.1), `${art}: wandnahe Hauptstücke stehen mit dem Rücken an der Wand (${wandFehl} von ${hauptIst} im Rückfall frei gestellt, höchstens 10 %)`);
      ok(nahAnker === 0, `${art}: kein Rollen-Stück auf einem Anker`);
      ok(hauptIst > 0 && hauptIst <= hauptSoll, `${art}: ${hauptIst} von ${hauptSoll} Hauptstücken fanden Platz (der Rest entfällt ohne Fehler)`);
      if (art === 'station') ok(dichteMin >= 4, `station: jeder Raum zeigt mindestens 4 Rollen-Stücke (Minimum ${dichteMin})`);
      ok(modelle.rom.size > 5 && modelle.germanen.size > 5 && ![...modelle.rom].some((m) => /germanen/.test(m)) && ![...modelle.germanen].some((m) => /(^|\/)rom\//.test(m)), `${art}: römische Räume nur mit römischen, germanische nur mit germanischen Stücken (${modelle.rom.size}/${modelle.germanen.size} Modelle)`);
    }
    // Determinismus mit den produktiven Daten, ohne Math.random
    const zufall = Math.random; Math.random = () => { throw new Error('Math.random'); };
    let det = true;
    try { for (const art of ['station', 'aussenposten']) for (const s of SEEDS.slice(0, 5)) { const k = karte(art, s, 'rom'); if (JSON.stringify(prod(k, art, 'rom')) !== JSON.stringify(prod(k, art, 'rom'))) det = false; } } catch (e) { det = false; }
    Math.random = zufall;
    ok(det, 'Determinismus mit den produktiven Rollen (zweimal gleich, kein Math.random)');
    // keine Deckungs-Props als Belegung (Außenposten)
    const verboten = new Set(['prop/germanen/gemein/fass', 'prop/germanen/gemein/werkzeug', 'prop/germanen/gemein/feuerschale']);
    for (const bw of ['rom', 'germanen']) for (const l of Object.values(BAUW[bw].deckung_props.aussenposten)) if (Array.isArray(l)) for (const id of l) verboten.add(id);
    let deck = 0;
    for (const art of ['station', 'aussenposten']) for (const r of Object.values(PROD[art].rollen)) for (const bw of ['rom', 'germanen']) for (const id of [].concat(r[bw])) if (verboten.has(id)) deck++;
    ok(deck === 0, 'keine Belegung ist ein Deckungs-Prop (fass, werkzeug, feuerschale, römische Ersatzmodelle)');
  }

  console.log(`\ntest-rollen-modus: ${n - fails}/${n} ok`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
