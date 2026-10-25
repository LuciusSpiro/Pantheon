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
    info('Kapazitäts-Fallback frei_halten 2 → 1 ist in den Testdateien aktiv (frei_halten 2 im Lager); Abstand ≥ 2 zu Ankern gilt trotzdem');
  }

  console.log(`\ntest-rollen-modus: ${n - fails}/${n} ok`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
