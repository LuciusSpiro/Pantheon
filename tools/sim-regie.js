'use strict';
// SUND-03 A: Messung der Befehle des Lage-Spielleiters gegen die SUND-01-Bänder. Ein einfacher Bot-Regisseur gibt in festem Abstand zufällige GÜLTIGE Befehle (über die echte Schnittstelle
// Regie.planAnwenden: Plan, Spielregeln, Vorwarnung, Abkühlzeit, Kern-Prüfer; die Sim läuft wie im Spiel über vorTick/Kern.tick/nachTick) und die Sim läuft 300 Ticks.
//   Bänder (content/welt/absichten.json, baender, SUND-01/02b): Eroberungen 1,0–2,2 je Lauf · Angriffe je 100 Ticks 1,5–3,0 · Stillstand ≤ 8 % · Kollaps 0 · Hauptwelt nie verloren.
//   Ohne Spielleiter bleibt der Lauf byte-gleich zu vorher (Test: tools/test-befehle.js). Hier gilt: ein Bot, der die Bänder sprengt, ist ein BEFUND, kein Anlass, die Bänder zu verbiegen.
//   node tools/sim-regie.js [--laeufe 100] [--ticks 300] [--saetze 5] [--seed0 0] [--nur <typ|alle>] [--strategie wenig|viel] [--json] [--pruefen]
//   Strategien: ohne (nichts) · wenig (alle 40 Ticks ab Tick 20 ein Plan) · viel (alle 8 Ticks ab Tick 10 ein Plan). Je Befehlstyp einer, dazu „alle“ (ein zufälliger Typ je Plan).
//   Seed-Sätze: 5 × 100 (Seeds 0–99, 100–199, …): 0–99 allein war in SUND-02b zu optimistisch.
//   --crew <id>  die Absicht der Crew (absichten.json) gilt für Rom über den ganzen Lauf, auch in der Zeile „ohne“
//   --pruefen   drei Sätze (Seeds 0–299, --saetze ändert es), nur „alle“ wenig und viel: beide müssen in den Bändern bleiben (Teil von npm test, etwa 25 s), sonst Exit 1
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Daten = require('../server/weltsim/daten.js');
const Kern = require('../server/weltsim/kern.js');
const Kz = require('../server/weltsim/kennzahlen.js');
const Regie = require('../server/sim/regie-befehle.js');
const BAENDER = require('../content/welt/absichten.json').werte.baender.wert;
const BW = Kern.BEFEHLE.WERTE;

const args = process.argv.slice(2);
const argVal = (k, d) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const PRUEFEN = args.includes('--pruefen');
const laeufe = Number(argVal('--laeufe', 100)), seed0 = Number(argVal('--seed0', 0));
const saetze = Number(argVal('--saetze', PRUEFEN ? 3 : 5));
const nur = argVal('--nur', null), nurStrategie = argVal('--strategie', null);
const CREW = argVal('--crew', null);   // --crew verteidigung: die Crew hält die Absicht den ganzen Lauf (zustand.absichten.rom, schärfster Fall), der Bot muss damit auskommen
const { karte, werte } = Daten.laden();
const ticks = Number(argVal('--ticks', werte.werte.ticks.wert));
// --set regie:abkuehlung.wert.angreifen=60 | befehle:werte.nachschub.wert.menge.max=6: überschreibt einen Wert dieses Laufs (zum Abstimmen), die Dateien bleiben unverändert
args.forEach((a, i) => {
  if (a !== '--set') return;
  const m = /^(regie|befehle):([\w.]+)=(.+)$/.exec(args[i + 1] || '');
  if (!m) { console.log('--set: regie:pfad=wert oder befehle:pfad=wert'); process.exit(2); }
  let o = m[1] === 'regie' ? Regie.R : Kern.BEFEHLE.WERTE;
  const pfad = m[2].split('.');
  for (const k of pfad.slice(0, -1)) o = o[k];
  o[pfad[pfad.length - 1]] = JSON.parse(m[3]);
});
const TYPEN = Object.keys(Kern.BEFEHLE.KATALOG);
const STRATEGIEN = { wenig: { ab: 20, abstand: 40 }, viel: { ab: 10, abstand: 8 } };

// eigener Zufallsstrom des Bots (mulberry32), nie der der Sim
function rng(seed) { let a = (seed ^ 0x9E3779B9) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const wahl = (r, l) => l[Math.floor(r() * l.length)];
const zw = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const mische = (r, l) => { const x = l.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

// Kandidaten je Typ (ohne Prüfung; der Bot probiert der Reihe nach, bis der Kern-Probelauf einen annimmt)
function kandidaten(typ, game, r) {
  const z = game.weltsim.zustand, d = Kern.datenVon(z), C = d.codes, out = [];
  const eigeneHaefen = (f) => C.filter((c) => d.hex[c].hafen && z.hexe[c].besitzer === f);
  switch (typ) {
    case 'angreifen':
      for (const f of ['rom', 'ger']) for (const c of C) out.push([{ typ, fraktion: f, ziel: c }]);
      break;
    case 'beanspruchen':
      for (const f of ['rom', 'ger', 'kon']) for (const c of C) if (!d.hex[c].hafen) out.push([{ typ, fraktion: f, sektor: c }]);
      break;
    case 'verstaerken':
      for (const fl of z.flotten) if (['rom', 'ger', 'kon'].includes(fl.fraktion)) for (const h of eigeneHaefen(fl.fraktion)) out.push([{ typ, fraktion: fl.fraktion, flotte: fl.id, hafen: h }]);
      break;
    case 'rueckzug':
      for (const fl of z.flotten) if (['rom', 'ger', 'kon'].includes(fl.fraktion)) out.push([{ typ, fraktion: fl.fraktion, flotte: fl.id }]);
      break;
    case 'nachschub':
      for (const an of ['rom', 'ger']) for (const gut of ['T', 'U']) out.push([{ typ, an, gut, menge: zw(r, BW.nachschub.wert.menge.min, BW.nachschub.wert.menge.max) }]);
      break;
    case 'embargo': {
      const s = Regie.lage(game).sieger;
      if (s !== 'offen') for (let i = 0; i < 3; i++) { const w = mische(r, ['M', 'T', 'E']).slice(0, zw(r, 1, 3)); out.push([{ typ, von: 'kon', gegen: s, waren: w, dauer: zw(r, BW.dauer.wert.embargo.min, BW.dauer.wert.embargo.max) }]); }
      break;
    }
    case 'soeldner':
      for (const fl of z.flotten) if (fl.fraktion === 'kon') for (const an of ['rom', 'ger']) out.push([{ typ, von: 'kon', an, flotten: [fl.id], dauer: zw(r, BW.dauer.wert.soeldner.min, BW.dauer.wert.soeldner.max) }]);
      break;
    case 'piratenueberfall':
      for (const c of C) out.push([{ typ, ort: c }]);
      break;
    case 'fokus':
      for (let i = 0; i < 4; i++) out.push([{ typ, fraktion: wahl(r, BW.fokus.wert.fraktionen), hex: wahl(r, C), radius: zw(r, BW.fokus.wert.radius.min, BW.fokus.wert.radius.max), dauer: zw(r, BW.dauer.wert.fokus.min, BW.dauer.wert.fokus.max) }]);
      break;
    case 'regler':
      for (let i = 0; i < 4; i++) {
        const k = wahl(r, ['p_act', 'aggr', 'max_active']), R = BW.regler.wert[k];
        const b = { typ, fraktion: wahl(r, BW.regler.wert.fraktionen), dauer: zw(r, BW.dauer.wert.regler.min, BW.dauer.wert.regler.max) };
        b[k] = k === 'max_active' ? zw(r, R.min, R.max) : Math.round((R.min + r() * (R.max - R.min)) * 100) / 100;
        out.push([b]);
      }
      break;
    default: break;
  }
  // Angriffe brauchen Treibstoff: der Bot stellt (wie ein Spielleiter) Nachschub voran, wenn es fehlt
  if (typ === 'angreifen') for (const c of out) {
    const f = c[0].fraktion, st = z.vorrat[f];
    const vor = [];
    if (st.T < 12) vor.push({ typ: 'nachschub', an: f, gut: 'T', menge: 12 });
    if (st.U < 12) vor.push({ typ: 'nachschub', an: f, gut: 'U', menge: 12 });
    c.unshift(...vor);
  }
  return mische(r, out);
}
function planFuer(typ, game, r) {
  if (typ === 'alle') return planFuer(wahl(r, TYPEN), game, r);
  const z = game.weltsim.zustand, ks = kandidaten(typ, game, r);
  let versuche = 0;
  for (const k of ks) {
    if (++versuche > 14) break;
    const f = Kern.filtereBefehle(z, k);
    if (f.gueltig.length === k.length) return typ === 'fokus' ? { fokus: { hex: k[0].hex, radius: k[0].radius, dauer: k[0].dauer, fraktionen: [k[0].fraktion] } } : { befehle: k };
  }
  return null;   // nichts Gültiges zu finden: der Bot gibt dann keinen Plan
}

// ---------- Ein Lauf
function einLauf(seed, typ, strategie) {
  const r = rng(seed * 7919 + 13);
  let game = null, faellig = [];
  const zaehl = { befAngriffe: 0, ruheTicks: 0, plaene: 0, ohnePlan: 0, vorgemerkt: 0, abgelehnt: 0, gespielt: 0, imTickAbgelehnt: 0, vorwarnung: 0 };
  const ring = [];
  const S = STRATEGIEN[strategie];
  const befehle = (z, i) => {
    if (!game) game = { weltsim: { zustand: z, tickZahl: 0, ereignisse: ring, regie: Regie.neu() }, emit() {}, countError() {}, worldsEnabled: false, env: {}, time: 0 };
    game.weltsim.tickZahl = i;
    if (S && i + 1 >= S.ab && (i + 1 - S.ab) % S.abstand === 0) {
      const plan = planFuer(typ, game, r);
      if (!plan) zaehl.ohnePlan++;
      else {
        zaehl.plaene++;
        const a = Regie.planAnwenden(game, plan);
        zaehl.vorgemerkt += a.angenommen.length; zaehl.abgelehnt += a.abgelehnt.length; zaehl.vorwarnung += a.angenommen.filter((x) => x.vorwarnung).length;
      }
    }
    faellig = Regie.vorTick(game, i + 1);
    return faellig.map((e) => e.b);
  };
  const nach = (z, i, res) => {
    zaehl.befAngriffe += res.befehle ? res.befehle.angewandt.filter((b) => b.typ === 'angreifen').length : 0;
    for (const f of ['rom', 'ger']) if (z.regie && z.regie[f] && z.regie[f].ruhe_bis > z.tick) zaehl.ruheTicks++;
    for (const e of res.ereignisse) ring.push(Object.assign({ n: i + 1 }, e));
    if (ring.length > 120) ring.splice(0, ring.length - 120);
    if (faellig.length) { const o = Regie.nachTick(game, res, faellig, i + 1); zaehl.gespielt += o.log.filter((l) => l.ausgang === 'gespielt').length; zaehl.imTickAbgelehnt += o.log.filter((l) => l.ausgang === 'im_tick_abgelehnt').length; }
    game.weltsim.tickZahl = i + 1;
  };
  const crewAb = CREW ? { rom: require('../content/welt/absichten.json').werte.absichten.wert.find((a) => a.id === CREW).wirkung } : null;
  const res = Kz.lauf({ karte, werte, seed, ticks, absichten: crewAb, befehle: strategie === 'ohne' ? null : befehle, nach: strategie === 'ohne' ? null : nach });
  res.zaehl = zaehl;
  return res;
}

function messen(typ, strategie, satz) {
  const rs = [];
  for (let i = 0; i < laeufe; i++) rs.push(einLauf(seed0 + satz * laeufe + i, typ, strategie));
  const s = Kz.zusammenfassung(rs), a = Kz.angriffsUebersicht(rs, 'reich', ticks);
  const mit = (f) => rs.reduce((x, r) => x + f(r), 0) / rs.length;
  return {
    typ, strategie, satz, eroberungen: s.eroberungen, angriffe_je100: a.je100, stillstand: s.still, kollaps: s.kollaps, hw_laeufe: rs.filter((r) => r.hw_lost).length,
    rom_haefen: s.rom_h, ger_haefen: s.ger_h, posten: s.posten, plaene: mit((r) => r.zaehl.plaene), ohne_plan: mit((r) => r.zaehl.ohnePlan), vorgemerkt: mit((r) => r.zaehl.vorgemerkt), gespielt: mit((r) => r.zaehl.gespielt),
    ki_angriffe: mit((r) => r.attacks - r.zaehl.befAngriffe), bef_angriffe: mit((r) => r.zaehl.befAngriffe), ruhe_anteil: mit((r) => r.zaehl.ruheTicks) / (2 * ticks),
    abgelehnt: mit((r) => r.zaehl.abgelehnt), im_tick_abgelehnt: mit((r) => r.zaehl.imTickAbgelehnt), vorwarnung: mit((r) => r.zaehl.vorwarnung),
  };
}
function baendeFehler(z) {
  const f = [];
  if (z.eroberungen < BAENDER.eroberungen.min || z.eroberungen > BAENDER.eroberungen.max) f.push(`Erob ${z.eroberungen.toFixed(2)}`);
  if (z.angriffe_je100 < BAENDER.angriffe_je100.min || z.angriffe_je100 > BAENDER.angriffe_je100.max) f.push(`Angr/100 ${z.angriffe_je100.toFixed(2)}`);
  if (z.stillstand > BAENDER.stillstand_max) f.push(`Stillstand ${(z.stillstand * 100).toFixed(0)} %`);
  if (z.kollaps > BAENDER.kollaps_max) f.push('Kollaps ' + z.kollaps);
  if (z.hw_laeufe > BAENDER.hauptwelt_verloren_max) f.push('Hauptwelt ' + z.hw_laeufe);
  return f;
}

// ---------- Kennzahl lage.sieger (Häufigkeit rom / ger / offen über viele Seeds), node tools/sim-regie.js --sieger [--laeufe 100] [--saetze 1]
function siegerVerteilung() {
  const ZEITEN = [30, 60, 120, 200, 250, 300];
  const Z = werte.werte.ticks.wert;
  const out = {};
  for (const t of ZEITEN) out[t] = { rom: 0, ger: 0, offen: 0, schwung: 0, n: 0 };
  const alle = { rom: 0, ger: 0, offen: 0, schwung: 0, n: 0 };
  for (let i = 0; i < laeufe * saetze; i++) {
    const z = Kern.erzeuge({ karte, werte, seed: seed0 + i });
    const ring = [];
    const game = { weltsim: { zustand: z, tickZahl: 0, ereignisse: ring, regie: Regie.neu() } };
    for (let t = 1; t <= Math.min(Z, 300); t++) {
      for (const e of Kern.tick(z).ereignisse) ring.push(Object.assign({ n: t }, e));
      if (ring.length > 120) ring.splice(0, ring.length - 120);
      game.weltsim.tickZahl = t;
      if (ZEITEN.includes(t)) {
        const l = Regie.lage(game);
        for (const o of [out[t], alle]) { o[l.sieger]++; o.n++; if (Math.abs(l.schwung.saldo) >= Regie.R.sieger.wert.schwung_min) o.schwung++; }
      }
    }
  }
  const p = (x, n) => (100 * x / n).toFixed(0).padStart(3) + ' %';
  console.log(`lage.sieger über ${laeufe * saetze} Läufe (Seeds ${seed0}…${seed0 + laeufe * saetze - 1}), Schwelle Macht ${Regie.R.sieger.wert.macht_schwelle}, Schwung ab ${Regie.R.sieger.wert.schwung_min} Unterschied in ${Regie.R.sieger.wert.schwung_fenster} Ticks:`);
  console.log('Tick'.padEnd(7) + 'rom'.padStart(7) + 'ger'.padStart(7) + 'offen'.padStart(7) + '  davon durch Schwung');
  for (const t of ZEITEN) console.log(String(t).padEnd(7) + p(out[t].rom, out[t].n).padStart(7) + p(out[t].ger, out[t].n).padStart(7) + p(out[t].offen, out[t].n).padStart(7) + '  ' + p(out[t].schwung, out[t].n));
  console.log('alle'.padEnd(7) + p(alle.rom, alle.n).padStart(7) + p(alle.ger, alle.n).padStart(7) + p(alle.offen, alle.n).padStart(7) + '  ' + p(alle.schwung, alle.n));
}
if (args.includes('--sieger')) { siegerVerteilung(); process.exit(0); }

// ---------- Ablauf
const t0 = Date.now();
const typen = PRUEFEN ? ['alle'] : (nur ? [nur] : TYPEN.concat('alle'));
const strategien = PRUEFEN ? ['wenig', 'viel'] : (nurStrategie ? [nurStrategie] : ['wenig', 'viel']);
const zeilen = [];
for (let satz = 0; satz < saetze; satz++) zeilen.push(messen('-', 'ohne', satz));
for (const typ of typen) for (const st of strategien) for (let satz = 0; satz < saetze; satz++) zeilen.push(messen(typ, st, satz));
if (args.includes('--json')) console.log(JSON.stringify({ laeufe, ticks, saetze, seed0, zeilen }));
else {
  console.log(`${laeufe} Läufe à ${ticks} Ticks, ${saetze} Seed-Sätze (Satz k = Seeds ${seed0}+k·${laeufe} …), ${((Date.now() - t0) / 1000).toFixed(0)} s. Bänder: Erob ${BAENDER.eroberungen.min}–${BAENDER.eroberungen.max}, Angr/100 ${BAENDER.angriffe_je100.min}–${BAENDER.angriffe_je100.max}, Stillstand ≤ ${BAENDER.stillstand_max * 100} %, Kollaps 0, Hauptwelt 0`);
  console.log('typ'.padEnd(18) + 'strat'.padEnd(7) + 'satz'.padStart(5) + 'Erob'.padStart(7) + 'Angr/100'.padStart(9) + 'Still%'.padStart(7) + 'Koll'.padStart(5) + 'HW'.padStart(4) + 'Rom-H'.padStart(7) + 'Ger-H'.padStart(7) + 'Pläne'.padStart(7) + 'gespielt'.padStart(9) + 'abgel.'.padStart(7) + 'imTick✗'.padStart(8) + 'Warn.'.padStart(7) + 'KI-Ang'.padStart(7) + 'bef.Ang'.padStart(8) + 'Ruhe%'.padStart(6) + '  Verstoß');
  for (const z of zeilen) {
    const f = baendeFehler(z);
    console.log(z.typ.padEnd(18) + z.strategie.padEnd(7) + String(z.satz).padStart(5) + z.eroberungen.toFixed(2).padStart(7) + z.angriffe_je100.toFixed(2).padStart(9) + (z.stillstand * 100).toFixed(0).padStart(7) + z.kollaps.toFixed(2).padStart(5) + String(z.hw_laeufe).padStart(4)
      + z.rom_haefen.toFixed(2).padStart(7) + z.ger_haefen.toFixed(2).padStart(7) + z.plaene.toFixed(1).padStart(7) + z.gespielt.toFixed(1).padStart(9) + z.abgelehnt.toFixed(1).padStart(7) + z.im_tick_abgelehnt.toFixed(1).padStart(8) + z.vorwarnung.toFixed(1).padStart(7) + z.ki_angriffe.toFixed(1).padStart(7) + z.bef_angriffe.toFixed(1).padStart(8) + (z.ruhe_anteil * 100).toFixed(0).padStart(6) + (f.length ? '  ' + f.join(', ') : ''));
  }
}
if (PRUEFEN) {
  let schlecht = 0;
  for (const z of zeilen) { const f = baendeFehler(z); if (f.length) { schlecht++; console.log(`FEHLER ${z.typ} ${z.strategie}: ${f.join('; ')}`); } if (z.strategie !== 'ohne' && z.gespielt < 1) { schlecht++; console.log(`FEHLER ${z.typ} ${z.strategie}: der Bot hat im Mittel weniger als einen Befehl gespielt (${z.gespielt.toFixed(2)})`); } }
  console.log(schlecht ? schlecht + ' Verstöße' : 'REGIE-MESSUNG OK: der Bot-Regisseur (alle Befehle, wenig und viel) hält die SUND-01-Bänder');
  process.exit(schlecht ? 1 : 0);
}
