'use strict';
// SUND-02b B: Messwerkzeug für Ruf und Dienstgrade (content/welt/ruf-werte.json). Zwei Teile:
//   1. node tools/sim-ruf.js --messen [--seeds 20] [--spruenge 80] [--seed0 100]
//      Zufallsgang mit ECHTEN Sprüngen im Modus Freie Fahrt Sund (wie tools/sim-freie-fahrt.js, passive Crew, springt aus jeder Szene sofort weiter): wie oft löst die
//      Ankunft eine Sim-Szene aus, getrennt nach Art (Feld/Ort × Germanen/Piraten). Das ist die Szenenrate je Sprung, die der Rechenlauf unten verwendet.
//   2. node tools/sim-ruf.js [--seeds 2000] [--einmalig 6:8:1,26:4:1,12:8:0.64] (SUND-02b A1: einzelne Posten-Ereignisse bei Sprung n mit Ruf delta und Wahrscheinlichkeit p, dass es sie gibt) [--max 3000] [--sieg 0.7] [--flucht 0.2] [--posten 0,2,4,6,8,12] [--posten-delta 6] [--rate feld_ger=0.012,...] [--json]
//      Rechenlauf (Monte Carlo, eigener Zufallsstrom): je Sprung löst eine Szene aus (Raten aus der Messung), die Crew gewinnt sie (--sieg), flieht (--flucht) oder
//      verliert (Rest, kein Ruf). Ruf und Rang nach ruf-werte.json (echte Daten, geklemmt wie im Spiel). Die Quellen aus Paket A (Posten gründen/halten, --posten =
//      Ereignisse je 80 Sprünge, je --posten-delta Ruf) sind eine ANNAHME, solange A fehlt: die Szenen allein tragen die Rangleiter nicht. Ausgabe: Sprünge bis zum
//      ersten Erreichen von Optio/Centurio/Tribun/Legat (Median, 10 %, 90 %, Anteil der Läufe, die es in --max Sprüngen schaffen).
//      SUND-02b A2: --sprengen p:delta:ab:bis[,…] (je Eintrag eine Sprengung eines gegnerischen Postens: mit Wahrscheinlichkeit p, zu einem gleichverteilten Sprung in [ab, bis], Ruf delta;
//      die Sim hält höchstens ~1 feindlichen Posten je Lauf, Messung tools/sim-crew-sprengen.js, deshalb Wahrscheinlichkeiten statt Rate). Was-wäre-wenn ohne Datenänderung:
//      SUND-02b E: --verrat n[,n…] (die Crew verrät Rom bei Sprung n: Abzug verrat_beginn + verrat_flotte_vernichtet, geklemmt auf 0).
//      --quelle grund=delta[,…] (überschreibt Quellen) und --schwelle rang=ab[,…] (überschreibt Schwellen).
// Kais Zielvorgabe: Centurio nach etwa einem Spielabend = ca. 40–80 Sprünge, Tribun nach etwa zwei Abenden, Legat Langzeitziel.
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Zufall = require('../server/weltsim/zufall.js');
const DATEN = require('../content/welt/ruf-werte.json');

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const val = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const W = DATEN.werte;
const RAENGE = W.raenge.wert.map((r) => Object.assign({}, r));
const Q = JSON.parse(JSON.stringify(W.quellen.wert));
for (const kv of String(val('--quelle', '')).split(',').filter(Boolean)) { const [k, v] = kv.split('='); if (Q[k] && Number.isFinite(Number(v))) Q[k].delta = Number(v); }   // Was-wäre-wenn (Datei bleibt unverändert)
for (const kv of String(val('--schwelle', '')).split(',').filter(Boolean)) { const [k, v] = kv.split('='); const r = RAENGE.find((x) => x.id === k); if (r && Number.isFinite(Number(v))) r.ab = Number(v); }
const KLEMM = W.fraktionen.wert.rom;
const KLASSEN = ['feld_ger', 'feld_pirat', 'ort_ger', 'ort_pirat'];

// ---------------------------------------------------------------------------------------------------------------- 1. Messung
async function messen() {
  const { Game } = require('../server/game.js');
  const Sektoren = require('../shared/sektoren.js');
  const Sprung = require('../server/sim/sprung.js');
  const SEEDS = Math.max(1, Number(val('--seeds', 20)) | 0);
  const J = Math.max(1, Number(val('--spruenge', 80)) | 0);
  const SEED0 = Number(val('--seed0', 100)) | 0;
  const HZ = require('../shared/config.js').tickHz;
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-rufmess-'));
  const zaehl = { feld_ger: 0, feld_pirat: 0, ort_ger: 0, ort_pirat: 0 }; const buckets = {}; let gesamt = 0; let fehler = 0;
  for (let k = 0; k < SEEDS; k++) {
    const seed = SEED0 + k;
    let zs = (seed * 2654435761) >>> 0;
    const zufall = () => { zs = (zs + 0x6D2B79F5) >>> 0; let t = zs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const dir = path.join(TMP, 'w' + k); fs.mkdirSync(dir, { recursive: true });
    const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
    const conn = { inbox: [], send() {}, sendRaw() {} };
    g.addConnection(conn); g.handleMessage(conn, { t: 'hello', clientId: 'M0', name: 'Bot', color: 0 });
    g.handleMessage(conn, { t: 'lobbyOpt', startMission: 'freie_fahrt' }); g.handleMessage(conn, { t: 'ready', ready: true });
    for (let i = 0; i < 30; i++) g.step();
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;   // keine Abfangjäger: nur die Sim-Szenen zählen
    const hier = () => Sektoren.hexVonOrt(g.ship.scene);
    const place = (x, y) => { const s = g.ship; s.helm.stage = 1; s.docked = false; s.dockedAt = null; s.x = x; s.y = y; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
    for (let n = 0; n < J; n++) {
      const von = hier(); const kand = [];
      for (const h of Sektoren.nachbarn(von)) {
        if (!Sektoren.spielbar(h) || !Sektoren.ortVonHex(h) || Sektoren.istLeerraum(h)) continue;
        g.explore.markBoje(Sektoren.kanteId(von, h));
        if (Sprung.hexGrund(g, von, h)) continue;
        kand.push(h);
      }
      if (!kand.length) break;
      const ziel = kand[Math.floor(zufall() * kand.length)];
      if (Sprung.selectDest(g, Sektoren.ortVonHex(ziel))) { fehler++; continue; }
      const p = Sprung.sprungpunkt(g, ziel); place(p.x - 80, p.y);
      for (let i = 0; i < 40 * HZ && !g.ship.jump.ready; i++) { g.space.enemies = []; g.step(); }
      g.space.enemies = []; g.ship.jump.ready = true;
      if (Sprung.doJump(g)) { fehler++; continue; }
      gesamt++;
      const S = g.simSzene;
      if (S) {
        const art = (S.ort ? 'ort_' : 'feld_') + S.fraktion;
        if (art in zaehl) zaehl[art]++;
        const b = Math.floor(n / 20) * 20; buckets[b] = (buckets[b] || 0) + 1;
      }
    }
    if (g.errors) fehler += g.errors;
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* egal */ }
  const szenen = Object.values(zaehl).reduce((a, b) => a + b, 0);
  const je = (c) => (c / gesamt);
  console.log(`Messung Szenenrate: ${SEEDS} Seeds (ab ${SEED0}) × ${J} Sprünge = ${gesamt} Sprünge, Fehler/Sperren ${fehler}`);
  console.log(`  Szenen gesamt ${szenen} = ${(100 * je(szenen)).toFixed(2)} % der Sprünge = ${(80 * je(szenen)).toFixed(2)} je 80 Sprünge`);
  for (const k of KLASSEN) console.log(`  ${k.padEnd(11)} ${String(zaehl[k]).padStart(4)} = ${je(zaehl[k]).toFixed(4)} je Sprung = ${(80 * je(zaehl[k])).toFixed(2)} je 80 Sprünge`);
  console.log('  nach Sprungnummer (Bucket 20): ' + JSON.stringify(buckets));
  console.log('  für den Rechenlauf: --rate ' + KLASSEN.map((k) => `${k}=${je(zaehl[k]).toFixed(4)}`).join(','));
  process.exit(fehler ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------------------------- 2. Rechenlauf
// Standard-Raten je Sprung: Messung dieser Ausgabe (tools/sim-ruf.js --messen --seeds 40 --spruenge 80 --seed0 100, siehe Bericht SUND-02b B)
const RATEN = { feld_ger: 0.0187, feld_pirat: 0.0091, ort_ger: 0.0056, ort_pirat: 0.0016 };
function ratenLesen() {
  const r = Object.assign({}, RATEN);
  for (const kv of String(val('--rate', '')).split(',').filter(Boolean)) { const [k, v] = kv.split('='); if (k in r && Number.isFinite(Number(v))) r[k] = Number(v); }
  return r;
}
const rangVon = (w) => RAENGE.reduce((m, r, i) => (w >= r.ab ? i : m), 0);
const klemmen = (v) => Math.min(KLEMM.max, Math.max(KLEMM.min, v));

// ein Lauf: Sprünge bis zum ersten Erreichen jedes Rangs (null = nicht in max Sprüngen)
function lauf(seed, o) {
  const z = { zufall: Zufall.startzustand(seed) };
  const erster = RAENGE.map(() => null); erster[0] = 0;
  let ruf = 0; let szenen = 0; let siege = 0; let fluchten = 0;
  if (o.reise) { o.reise.stand = { letzter: -99, log: [], summe: 0 }; }
  for (const e of o.einmalig || []) e.vorhanden = Zufall.zahl(z) < e.p;
  for (const s of o.sprengen || []) { s.vorhanden = Zufall.zahl(z) < s.p; s.n = s.ab + Math.floor(Zufall.zahl(z) * (s.bis - s.ab + 1)); }   // SUND-02b A2: gibt es in diesem Lauf einen feindlichen Posten, und wann sprengt die Crew ihn   // Versorgung: gibt es das Ereignis in diesem Lauf (freies Hex da, römischer Posten da)? Nur der Lauf entscheidet, nie die Crew
  const pPosten = o.posten / 80;
  for (let n = 1; n <= o.max; n++) {
    // höchstens eine Szene je Sprung (die Raten sind klein); Reihenfolge der Klassen fest
    let u = Zufall.zahl(z); let art = null;
    for (const k of KLASSEN) { if (u < o.raten[k]) { art = k; break; } u -= o.raten[k]; }
    if (art) {
      szenen++;
      const ort = art.startsWith('ort_'); const fr = art.slice(art.indexOf('_') + 1);
      const v = Zufall.zahl(z);
      if (v < o.sieg) { siege++; const e = Q[(ort ? 'ort_gehalten_' : 'sieg_feld_') + fr]; if (e) ruf = klemmen(ruf + e.delta); }
      else if (v < o.sieg + o.flucht) { fluchten++; const e = Q['fahrerflucht' + (ort ? '_ort_' : '_') + fr]; if (e) ruf = klemmen(ruf + e.delta); }
    }
    if (pPosten > 0 && Zufall.zahl(z) < pPosten) ruf = klemmen(ruf + o.postenDelta);   // Annahme Paket A: Posten gründen/halten
    if (o.reise) ruf = klemmen(ruf + reiseSprung(z, o.reise, n));   // SUND-03 D-Fix2: Reise-Ereignisse (Katalog content/reise/ereignisse.json)
    for (const e of o.einmalig || []) if (e.n === n && e.vorhanden) ruf = klemmen(ruf + e.delta);
    for (const s of o.sprengen || []) if (s.n === n && s.vorhanden) ruf = klemmen(ruf + s.delta);   // SUND-02b A2   // SUND-02b A1: einmalige Posten-Ereignisse zu festen Sprüngen (--einmalig n:delta:p)
    const r = rangVon(ruf);
    for (let i = 1; i <= r; i++) if (erster[i] === null) erster[i] = n;
  }
  return { erster, ruf, szenen, siege, fluchten, reiseRuf: o.reise ? o.reise.stand.summe : 0, antworten: o.reise ? (o.reise.stand.antworten || 0) : 0, angebote: o.reise ? (o.reise.stand.angebote || 0) : 0 };
}
// SUND-03 D-Fix2: Ruf aus Reise-Ereignissen je Sprung. Echter Katalog und echte Werte (content/reise), Annahmen als Argumente: --reise (an), --reise-raum rom=0.4,saum=0.2,frei=0.2,ger=0.15,pirat=0.05 (Besitzer der Ankunftssektoren),
// --reise-annahme 0.6 (Anteil der Notrufe, die die Crew beantwortet), --reise-funk-cap (Rom-Deckel der Antworten, Standard aus den Daten), --reise-funk 1 (SUND-03b A: Anteil der Funk-Antwort-Angebote, die die Crew mit der Rom-günstigsten Option beantwortet; 0 = keine), --reise-sieg 0.9 (Anteil der Kämpfe, die sie gewinnt), --reise-cap 5 (Deckel je 100 Sprünge, 0 = ohne Deckel). Rang- und Lagefenster zählen nicht.
const REISE_KAT = require('../content/reise/ereignisse.json').eintraege;
const REISE_W = Object.fromEntries(Object.entries(require('../content/reise/werte.json').werte).map(([k, v]) => [k, v.wert]));
function reiseSprung(z, r, n) {
  const s = r.stand;
  if (n - s.letzter < Math.max(3, REISE_W.min_abstand_spruenge) || !(Zufall.zahl(z) < REISE_W.wahrscheinlichkeit)) return 0;
  let u = Zufall.zahl(z), besitzer = null;
  for (const [b, p] of Object.entries(r.raum)) { if (u < p) { besitzer = b; break; } u -= p; }
  const kand = REISE_KAT.filter((e) => !e.bedingungen.besitzer || e.bedingungen.besitzer.includes(besitzer || 'rom'));
  let w = Zufall.zahl(z) * kand.reduce((a, e) => a + e.gewicht, 0); let e = kand[kand.length - 1];
  for (const k of kand) { w -= k.gewicht; if (w < 0) { e = k; break; } }
  s.letzter = n;
  const gelaufen = e.art !== 'notruf' || Zufall.zahl(z) < r.annahme;
  const gewonnen = !e.gefahr || e.art === 'patrouille' || Zufall.zahl(z) < r.sieg;
  if (!gelaufen || !gewonnen) return 0;
  // Folgen buchen: Wirkung auf Rom (Grund und Nebenwirkung `folge`), Deckel wie reise-ereignis.js gruendeBuchen
  const buchen = (gruende, nurRom) => {
    const qs = gruende.map((g) => Q[g]).filter(Boolean);
    const betrag = qs.filter((q) => !nurRom || q.fraktion === 'rom').reduce((a, q) => a + Math.abs(q.delta), 0);   // Funk-Antworten: im Deckel zählt nur Rom (wie gruendeBuchen mit nurFraktion)
    if (!qs.length) return 0;
    if (betrag > 0) {
      s.log = s.log.filter((x) => n - x[0] < 100);
      if (r.cap > 0 && s.log.reduce((a, x) => a + x[1], 0) + betrag > r.cap) return 0;
      s.log.push([n, betrag]);
    }
    s.gebucht = true;
    const d = qs.reduce((a, q) => a + (q.fraktion === 'rom' ? q.delta : 0) + ((q.folge && q.folge.rom) || 0), 0);
    s.summe += d;
    return d;
  };
  let d = buchen(e.folge.angenommen);
  // SUND-03b A: Funk-Antworten (Eintraege ohne Gefahr mit `antworten`): die Crew antwortet mit der Wahrscheinlichkeit r.funk und waehlt IMMER die Option mit dem groessten Rom-Ruf (unguenstigster Fall fuer die Rangleiter); gleicher Deckel
  // Rom-Deckel der Antworten (werte.antwort_rom_max_je_100, --reise-funk-cap): Optionen, deren Rom-Gewinn der Deckel nicht mehr zuließe, entfallen; unter zwei Optionen gibt es kein Angebot (wie server/sim/funk-antwort.js)
  if (r.funk > 0 && !e.gefahr && Array.isArray(e.antworten) && e.antworten.length) {
    const netto = (o) => o.folge.map((g) => Q[g]).filter(Boolean).reduce((a, q) => a + (q.fraktion === 'rom' ? q.delta : 0) + ((q.folge && q.folge.rom) || 0), 0);   // Wirkung auf Rom (die Crew wählt die größte)
    const wert = (o) => o.folge.map((g) => Q[g]).filter(Boolean).reduce((a, q) => a + Math.max(0, (q.fraktion === 'rom' ? q.delta : 0) + ((q.folge && q.folge.rom) || 0)), 0);   // Rom-Gewinn für den Deckel (wie funk-antwort.js romGewinn)
    s.fl = (s.fl || []).filter((x) => n - x[0] < 100);
    const raum = r.funkCap - s.fl.reduce((a, x) => a + x[1], 0);
    const rufRaum = r.cap > 0 ? r.cap - s.log.filter((x) => n - x[0] < 100).reduce((a, x) => a + x[1], 0) : Infinity;
    const romBetrag = (o) => o.folge.map((g) => Q[g]).filter((q) => q && q.fraktion === 'rom').reduce((a, q) => a + Math.abs(q.delta), 0);
    const erlaubt = e.antworten.filter((o) => wert(o) <= raum + 1e-9 && romBetrag(o) <= rufRaum + 1e-9);
    if (erlaubt.length >= 2) {
      s.angebote = (s.angebote || 0) + 1;
      if (Zufall.zahl(z) < r.funk) {
        const best = erlaubt.slice().sort((a, b) => netto(b) - netto(a))[0];
        s.gebucht = false; d += buchen(best.folge, true);
        if (s.gebucht) { s.antworten = (s.antworten || 0) + 1; if (wert(best) > 0) s.fl.push([n, wert(best)]); }
      }
    }
  }
  return d;
}
const quantil = (liste, q) => { if (!liste.length) return null; const s = liste.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

function rechnen() {
  const SEEDS = Math.max(10, Number(val('--seeds', 2000)) | 0);
  const o = { max: Math.max(100, Number(val('--max', 3000)) | 0), sieg: Number(val('--sieg', 0.7)), flucht: Number(val('--flucht', 0.2)), postenDelta: Number(val('--posten-delta', 6)), raten: ratenLesen() };
  o.einmalig = String(val('--einmalig', '')).split(',').filter(Boolean).map((x) => { const [n, delta, p] = x.split(':').map(Number); return { n, delta, p: Number.isFinite(p) ? p : 1 }; });
  // SUND-02b E: --verrat n[,n…]: die Crew verrät Rom bei den Sprüngen n (je Verrat Beginn + vernichtet aus den Quellen, sicher gebucht: p 1; Ruf nur Abzug, geklemmt auf 0). Zeigt, wie weit ein Verrat die Rangleiter zurückwirft.
  o.verrat = String(val('--verrat', '')).split(',').filter(Boolean).map(Number).filter((x) => Number.isFinite(x) && x >= 1);
  const vd = ((Q.verrat_beginn || {}).delta || 0) + ((Q.verrat_flotte_vernichtet || {}).delta || 0);
  for (const n of o.verrat) o.einmalig.push({ n, delta: vd, p: 1 });
  o.sprengen = String(val('--sprengen', '')).split(',').filter(Boolean).map((x) => { const [p, delta, ab, bis] = x.split(':').map(Number); return { p, delta, ab, bis: Number.isFinite(bis) ? bis : ab }; });
  if (has('--reise')) o.reise = { raum: Object.fromEntries(String(val('--reise-raum', 'rom=0.4,saum=0.2,frei=0.2,ger=0.15,pirat=0.05')).split(',').map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; })), annahme: Number(val('--reise-annahme', 0.6)), funk: Number(val('--reise-funk', 0)), funkCap: Number(val('--reise-funk-cap', REISE_W.antwort_rom_max_je_100)), sieg: Number(val('--reise-sieg', 0.9)), cap: Number(val('--reise-cap', REISE_W.ruf_max_je_100)) };
  const postenListe = String(val('--posten', '0,2,4,6,8,12')).split(',').map(Number).filter((x) => x >= 0);
  const ergebnis = [];
  for (const posten of postenListe) {
    const runs = [];
    for (let s = 0; s < SEEDS; s++) runs.push(lauf(1000 + s, Object.assign({ posten }, o)));
    const zeile = { postenJe80: posten, raenge: {} };
    RAENGE.slice(1).forEach((r, i) => {
      const ok = runs.map((x) => x.erster[i + 1]).filter((x) => x !== null);
      zeile.raenge[r.id] = { median: quantil(ok, 0.5), p10: quantil(ok, 0.1), p90: quantil(ok, 0.9), anteil: ok.length / runs.length };
    });
    zeile.szenenJe80 = 80 * runs.reduce((a, x) => a + x.szenen, 0) / (SEEDS * o.max);
    if (o.reise) { zeile.reiseRufJe100 = 100 * runs.reduce((a, x) => a + x.reiseRuf, 0) / (SEEDS * o.max); zeile.antwortenJe100 = 100 * runs.reduce((a, x) => a + x.antworten, 0) / (SEEDS * o.max); zeile.angeboteJe100 = 100 * runs.reduce((a, x) => a + x.angebote, 0) / (SEEDS * o.max); }
    ergebnis.push(zeile);
  }
  if (has('--json')) { console.log(JSON.stringify({ parameter: o, schwellen: RAENGE.map((r) => [r.id, r.ab]), ergebnis }, null, 1)); return; }
  console.log(`Rechenlauf Ruf: ${SEEDS} Läufe je Zeile, bis ${o.max} Sprünge; Raten je Sprung ${KLASSEN.map((k) => `${k} ${o.raten[k]}`).join(', ')}`);
  console.log(`  Crew gewinnt ${Math.round(o.sieg * 100)} % der Szenen, flieht ${Math.round(o.flucht * 100)} %, Rest verloren (kein Ruf); Posten-Ereignisse (Annahme Paket A): je ${o.postenDelta} Ruf`);
  if (o.verrat.length) console.log(`  Verrat (E): bei Sprung ${o.verrat.join(', ')} je ${((Q.verrat_beginn || {}).delta || 0) + ((Q.verrat_flotte_vernichtet || {}).delta || 0)} Ruf (Beginn ${(Q.verrat_beginn || {}).delta} + vernichtet ${(Q.verrat_flotte_vernichtet || {}).delta})`);
  if (o.sprengen.length) console.log(`  Sprengungen (A2): ${o.sprengen.map((s) => `p ${s.p}, +${s.delta} Ruf, Sprung ${s.ab}–${s.bis}`).join('; ')}`);
  console.log(`  Schwellen: ${RAENGE.slice(1).map((r) => `${r.name} ${r.ab}`).join(', ')} (Rom ${KLEMM.min}..${KLEMM.max}); Quellen: ${Object.entries(Q).map(([k, e]) => `${k} ${e.delta > 0 ? '+' : ''}${e.delta}`).join(', ')}`);
  if (o.reise) console.log(`  Ruf aus Reise-Ereignissen im Mittel: ${ergebnis.map((z) => z.reiseRufJe100.toFixed(2)).join(' / ')} Rom je 100 Sprünge (Zeilen wie unten), Funk-Angebote ${ergebnis.map((z) => z.angeboteJe100.toFixed(2)).join(' / ')}, davon beantwortet und gebucht ${ergebnis.map((z) => z.antwortenJe100.toFixed(2)).join(' / ')} je 100 Sprünge (Rom-Deckel der Antworten ${o.reise.funkCap})`);
  if (o.reise) console.log(`  Reise-Ereignisse (D-Fix2): Raum ${JSON.stringify(o.reise.raum)}, Notrufe beantwortet ${o.reise.annahme}, Kämpfe gewonnen ${o.reise.sieg}, Deckel ${o.reise.cap || 'keiner'} je 100 Sprünge`);
  console.log('  Sprünge bis zum ERSTEN Erreichen: Median (10 % – 90 %), in Klammern der Anteil der Läufe, die es schaffen');
  console.log('  Posten/80   Szenen/80   ' + RAENGE.slice(1).map((r) => r.name.padEnd(26)).join(''));
  for (const z of ergebnis) {
    const f = (x) => (x.median === null ? '–'.padEnd(26) : `${x.median} (${x.p10}–${x.p90})${x.anteil < 0.995 ? ' [' + Math.round(100 * x.anteil) + ' %]' : ''}`.padEnd(26));
    console.log('  ' + String(z.postenJe80).padEnd(11) + z.szenenJe80.toFixed(2).padEnd(12) + RAENGE.slice(1).map((r) => f(z.raenge[r.id])).join(''));
  }
}

if (has('--messen')) messen().catch((e) => { console.error(e); process.exit(1); });
else rechnen();
