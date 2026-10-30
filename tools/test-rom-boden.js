'use strict';
// BOD-01 P2: Rom am Boden. Römische Namen und Funksprüche aus den Katalogdaten (content/katalog/gegner/*.json:
// namen.rom, vornamen.rom, funk_nach_fraktion.rom), Rezept `graben` (Grenadier und Schütze), kein Rückfall auf germanische Namen.
//   node tools/test-rom-boden.js
const Katalog = require('../server/mission/katalog.js');
const squad = require('../server/sim/squad.js');
const LP = require('../server/sim/landepunkte.js');
const { Game } = require('../server/game.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t) => console.log('\n[' + t + ']');

const K = Katalog.load();
const ROLLEN = ['grundtyp', 'niederhalter', 'grenadier', 'schuetze', 'enterer', 'haescher'];
const ROLLENNAME = { grundtyp: 'Legionär', niederhalter: 'Ballistarius', grenadier: 'Funditor', schuetze: 'Speculator', enterer: 'Triarius' };
const gegner = (r) => Object.values(K.gegner).find((g) => g.rolle === r);
const STANDARD_ANLAESSE = ['kamerad_liegt', 'spieler_gefesselt', 'alarm_laerm', 'friendly_fire'];

section('Katalog: römische Namen und Funk je Rolle');
{
  ok(!K.fehler.length, 'Katalog lädt ohne Fehler' + (K.fehler.length ? ': ' + K.fehler.slice(0, 2).map((f) => f.msg).join(' | ') : ''));
  const alle = [];
  for (const r of ROLLEN) {
    const g = gegner(r);
    ok(g && g.namen.rom && (r === 'haescher' || g.namen.rom === ROLLENNAME[r]), `${r}: namen.rom = ${g && g.namen.rom}`);
    const vn = (g && g.vornamen && g.vornamen.rom) || [];
    ok(vn.length >= 12 && new Set(vn).size === vn.length, `${r}: ${vn.length} römische Vornamen, ohne Dopplung`);
    alle.push(...vn);
    const f = g && g.funk_nach_fraktion && g.funk_nach_fraktion.rom;
    ok(f && f.allgemein && f.allgemein.length >= 4 && STANDARD_ANLAESSE.every((k) => f[k] && f[k].length), `${r}: römischer Funk (allgemein + Standardanlässe)`);
    const gleiche = Object.keys((g && g.funk) || {}).filter((k) => f && f[k] && f[k].some((t) => g.funk[k].includes(t)));
    ok(!gleiche.length, `${r}: römische Sätze nicht aus dem germanischen Funk übernommen` + (gleiche.length ? ' (' + gleiche.join(', ') + ')' : ''));
  }
  ok(new Set(alle).size === alle.length, `Vornamen über alle Rollen verschieden (${alle.length})`);
}

section('Rezept graben');
{
  const f = K.fraktionen.rom;
  const rz = f.rezepte.graben || [];
  const rollen = new Set(rz.map((t) => t.rolle));
  ok(rollen.has('grenadier') && rollen.has('schuetze'), 'graben: Grenadier und Schütze');
  ok(rz.reduce((s, t) => s + t.n, 0) <= 4 && rollen.size <= 3, 'graben: höchstens 4 Mann und 3 Typen (besetzen verdichtet sonst)');
  ok(JSON.stringify(f.einsatz.graben) === '["graben"]', 'graben: einsatz nur Kartenart graben');
  ok(f.rezepte.wache && f.rezepte.sturmtrupp && f.einsatz.wache.includes('station') && f.einsatz.sturmtrupp.includes('station'), 'wache/sturmtrupp unverändert vorhanden');
  const r = Katalog.pruefeBesetzung([{ fraktion: 'rom', staerke: 'gross', haltung: 'wach' }], { katalog: K, kartenart: 'graben', spieler: 3 });
  ok(!r.fehler.length, 'pruefeBesetzung(rom, gross) auf graben: keine Fehler');
}

// Headless: Trupps einer Fraktion nach Rezept setzen, jeden Gegner alle Funkanlässe sprechen lassen
function lauf(fraktion, trupps, rezeptName) {
  const g = new Game({ noStore: true, seed: 11, log: () => {} });
  const fe = []; g.countError = (w, e) => { fe.push(w + ': ' + (e && e.message)); };
  const id = LP.testgelaende(g, { ort: 'kesh', art: 'station', besitz: fraktion, seed: 3, zustand: 'umkaempft' });
  LP.get(g, id);
  const aw = g.aways[id];
  g.away = aw;
  const besetzung = K.fraktionen[fraktion].rezepte[rezeptName].map((t) => ({ typ: t.rolle, anzahl: t.n }));
  for (let i = 0; i < trupps; i++) {
    const name = 'g' + i;
    squad.spawnSquad(g, name, { map: id, besetzung, force: true, festeZahl: true });
    for (const e of aw.drones) if (e.squad === name) e.fraktion = fraktion;
  }
  const ev = [];
  const emit = g.emit;
  g.emit = function (t, d) { if (t === 'bark') ev.push(d); return emit.apply(this, arguments); };
  const anlaesse = ['contact', 'playerDown', 'allgemein', 'kamerad_liegt', 'spieler_gefesselt', 'alarm_laerm', 'friendly_fire', 'ueberhitzt', 'geteilte_sicht', 'erste_wunde', 'liegend'];
  for (const e of aw.drones) {
    const s = squad.squadOf(g, e);
    for (const k of anlaesse) { s.barkAt = -999; squad.bark(g, s, e, k); }
  }
  return { aw, ev, fe };
}

section('Headless: römischer Trupp (graben) – nur römische Namen und Texte');
{
  const R = lauf('rom', 4, 'graben');
  const germNamen = new Set(), germTexte = new Set();
  for (const r of ROLLEN) {
    const g = gegner(r);
    for (const v of Object.values(g.namen)) if (v !== g.namen.rom) germNamen.add(v);
    for (const l of Object.values(g.funk || {})) for (const t of l) germTexte.add(t);
  }
  germNamen.add('Plünderer');
  ok(R.aw.drones.length === 16 && R.aw.drones.every((e) => e.fraktion === 'rom'), `16 römische Gegner (${R.aw.drones.length})`);
  ok(R.ev.length >= R.aw.drones.length, `Funksprüche gefallen: ${R.ev.length}`);
  const namenGerm = R.ev.filter((b) => [...germNamen].some((x) => b.from.includes(x)));
  ok(!namenGerm.length, 'kein Sprecher mit germanischem Namen (Karl, Bolzer, Donnerwerfer, Jäger, Berserker, Wergeld-Fänger, Plünderer)' + (namenGerm.length ? ': ' + namenGerm[0].from : ''));
  const textGerm = R.ev.filter((b) => germTexte.has(b.text));
  ok(!textGerm.length, 'kein germanischer Funktext' + (textGerm.length ? ': ' + textGerm[0].text : ''));
  ok(R.ev.every((b) => Object.values(ROLLENNAME).some((rn) => b.from.startsWith(rn + ' '))), 'jeder Sprecher heißt „<Rollenname> <Vorname>“');
  const jeId = new Map();
  for (const b of R.ev) jeId.set(b.id, b.from);
  const namen = [...jeId.values()];
  ok(namen.length === 16 && new Set(namen).size === 16, `16 Gegner, 16 verschiedene Namen im Szenario (${new Set(namen).size})`);
  ok(['Funditor', 'Speculator', 'Legionär'].every((rn) => namen.some((x) => x.startsWith(rn + ' '))), 'Funditor, Speculator und Legionär sprechen');
  ok(!R.fe.length, 'keine Server-Fehler' + (R.fe.length ? ' (' + R.fe.join(' | ') + ')' : ''));
}

section('Gegenrichtung: Germanen unverändert');
{
  const germ = [].concat(...ROLLEN.map((r) => Object.values(gegner(r).funk || {}).flat()));
  const W = lauf('ger', 2, 'wache');
  ok(W.ev.length > 0 && W.ev.every((b) => b.from === 'Karl' || b.from === 'Jäger'), 'ger wache: Sprecher Karl/Jäger wie bisher (' + [...new Set(W.ev.map((b) => b.from))].join(', ') + ')');
  ok(W.ev.every((b) => germ.includes(b.text)), 'ger wache: Texte aus dem germanischen Funk');
  const S = lauf('ger', 1, 'sturmtrupp');
  ok(S.ev.length > 0 && S.ev.every((b) => ['Bolzer', 'Berserker', 'Karl'].includes(b.from)), 'ger sturmtrupp: Bolzer/Berserker/Karl (' + [...new Set(S.ev.map((b) => b.from))].join(', ') + ')');
}

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log(fails + ' FEHLER'); process.exit(1); }
