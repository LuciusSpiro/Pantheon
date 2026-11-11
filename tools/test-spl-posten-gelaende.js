#!/usr/bin/env node
'use strict';
// SPL-01 b2 Teil 1: Kontrollposten auf Wildnis und Hoehle als reine Katalog-DATEN (stellung_nehmen/kontrollposten_im_gelaende, Szenentyp C2 gefecht).
// Kein Typname, keine Szenenlogik im Servercode; der Test liest Katalog, Pruefer (szenenbau.aufloesen, Regiebuch-Pruefer), Generatoren und einen echten Labor-Lauf.
//  1. Katalog: verfuegbar, Kartenarten genau wildnis und hoehle, Anker wache (min 3) gegen den Pflichtsatz BEIDER Generatoren (nicht gegen den Generator selbst),
//     gefecht-Bereich, Fraktionen nur mit Rezept fuer wildnis UND hoehle, test.params.map und rueckfall.params.
//  2. Entscheidung (a) gegen (b): die vorhandenen Umsetzungen trupp_raeumen und zu_den_pads bleiben ohne Gelaende (Befund: trupp_raeumen verlangt den Bereich
//     'ziel' bzw. 'rueckzug'/'hinein', den kein Gelaende hat; zu_den_pads nennt Pads); Bereiche der Gelaende-Karten ueber viele Seeds.
//  3. Pruefer-Sweep: 5 Kartenfaelle (Wildnis in drei Biomen, Hoehle, Wildnis+Hoehle) x 50 Seeds, 0 Pruefer-Fehler; Mutationsprobe (min wache 99 -> BUEHNE-ANKER).
//  4. Unpassende Kartenarten: BUEHNE-ART. Besitz rom/ger/herrenlos/rostmeute und jede erlaubte Fraktion x Staerke: FRAKTION-gueltig.
//  5. Regiebuch-Pruefer: alle Fraktions-/Staerke-/Haltungswerte gueltig, kustoden und alte Parameter (durchbruch) abgelehnt, nur trupp_geraeumt als Bedingung.
//  6. Headless im echten Labor (Wildnis in drei Biomen, Hoehle): Gegner entstehen, stehen im Gefechtsbereich der Karte (Lager), Bedingung erst nach dem letzten, 0 Server-Fehler.
//   node tools/test-spl-posten-gelaende.js   (npm run test:spl-posten-gelaende)
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const M = require('./lib/messe-spl.js');
const Katalog = require('./katalog.js');
const Checker = require('../server/mission/checker.js');
const SB = require('../server/mission/szenenbau.js');
const Context = require('../server/mission/context.js');
const Labor = require('../server/mission/labor.js');
const Interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const GenGelaende = require('../shared/gen-gelaende.js');
const GenHoehle = require('../shared/gen-hoehle.js');
const Physics = require('../shared/physics.js');
const H = require('./gel02-hilfen.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { bad++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};

const MOL = 'stellung_nehmen', UMS = 'kontrollposten_im_gelaende', ID = MOL + '/' + UMS;
const SEEDS = 50;
const GELAENDE = ['wildnis', 'hoehle'];
const BIOME = ['wueste', 'wiesenwald', 'vulkan'];
const FREMD = ['tor', 'eingang', 'terminal', 'zelle', 'nsc', 'beute', 'ziel', 'sprengpunkt', 'flagge'];
const katalog = Katalog.load({});
const kat = katalog;
const umsetzung = (k, mol, id) => k.molekuele[mol].umsetzungen.find((x) => x.id === id);
const U = umsetzung(katalog, MOL, UMS);
const env = SB.buildEnv(kat);
const welt0 = M.weltstand('nach-tutorial');
const ctx0 = Context.build(welt0, M.anlass(), kat);
ctx0.bodenbilanz = { letzte: [], pflicht_jetzt: false, lang_ab_min: 25 };

section('1. Katalog', () => {
  ok(!!U && U.status === 'verfuegbar' && U.pruefung.fehler === 0, 'Umsetzung steht im Katalog, verfügbar, Prüfer ohne Fehler');
  const b = U.buehne_braucht;
  ok(JSON.stringify(b.kartenarten) === '["wildnis","hoehle"]', 'Kartenarten genau wildnis und hoehle');
  ok(JSON.stringify(b.anker) === '["wache"]' && b.min && b.min.wache === 3 && b.gefecht === true, 'Anker wache, min 3, Gefechtsbereich verlangt');
  ok(!(b.anker || []).some((r) => FREMD.includes(r)), 'kein Anker aus ' + FREMD.join('/'));
  ok(GenGelaende.PFLICHT.wache >= b.min.wache && GenHoehle.PFLICHT.wache >= b.min.wache, `min wache ${b.min.wache} höchstens der Pflichtsatz beider Erzeuger (Wildnis ${GenGelaende.PFLICHT.wache}, Höhle ${GenHoehle.PFLICHT.wache})`);
  ok(U.schauplatz === 'aussen' && Object.values(katalog.szenentypen).some((t) => t.kennung === 'C2' && t.status === 'verfuegbar' && t.verfuegbare_molekuele.includes(MOL)), 'Boden-Umsetzung unter stellung_nehmen (Szenentyp C2 gefecht)');
  ok(U.test && U.test.params && U.test.params.map && U.rueckfall && U.rueckfall.params && Object.keys(U.rueckfall.params).length === 0, 'test.params.map und rueckfall.params vorhanden');
  // jede erlaubte Fraktion hat ein Rezept mit Einsatz auf wildnis UND hoehle (Daten der Fraktionen, nicht des Codes)
  const werte = U.params.fraktion.werte;
  const luecke = werte.filter((f) => { const fr = katalog.fraktionen[f]; return !fr || !['wildnis', 'hoehle'].every((a) => Object.values(fr.einsatz || {}).some((arten) => arten.includes(a))); });
  ok(werte.length >= 5 && !luecke.length && !werte.includes('kustoden'), `Fraktionen ${werte.join(', ')}: jede mit Einsatz auf Wildnis und Höhle${luecke.length ? ' (Lücke: ' + luecke.join(', ') + ')' : ''}; kustoden ausgeschlossen (nur hand/ruine)`);
  ok(U.params.haltung.default === 'ruhig' && U.params.staerke.default === 'mittel' && !('durchbruch' in U.params), 'Standard: ruhig, mittel; kein Parameter durchbruch (kein Zielbereich)');
  const text = JSON.stringify(U.vorlage);
  ok(!/Tor|Mauer|Zielbereich|durchbr|Pads|Siedlung/i.test(text), 'Texte ohne Außenposten-Wörter (Tor, Mauer, Zielbereich, durchbrechen, Pads, Siedlung)');
  ok(/trupp_geraeumt/.test(text) && !/team_im_bereich/.test(text), 'Bedingung nur trupp_geraeumt (kein Bereichs-Durchbruch)');
  ok(!/\{\{lex\./.test(text), 'Texte ohne Lexikon-Platzhalter (nennen nur Posten, Wachen, Streifen; kein Eintrag nötig)');
  const treffer = [];
  const lies = (d) => { for (const f of require('fs').readdirSync(d, { withFileTypes: true })) { const p = require('path').join(d, f.name); if (f.isDirectory()) lies(p); else if (/\.js$/.test(f.name) && /kontrollposten_im_gelaende/.test(require('fs').readFileSync(p, 'utf8'))) treffer.push(p); } };
  lies(require('path').join(__dirname, '..', 'server'));
  ok(treffer.length === 0, `kein Umsetzungsname im Servercode (${treffer.join(', ') || 'kein Treffer'})`);
});

section('2. Entscheidung (b): vorhandene Umsetzungen bleiben ohne Gelände', () => {
  const tr = umsetzung(katalog, MOL, 'trupp_raeumen'); const zp = umsetzung(katalog, 'entkommen', 'zu_den_pads');
  ok(!tr.buehne_braucht.kartenarten.some((a) => GELAENDE.includes(a)), 'trupp_raeumen nennt weder wildnis noch hoehle');
  ok(!zp.buehne_braucht.kartenarten.some((a) => GELAENDE.includes(a)), 'zu_den_pads nennt weder wildnis noch hoehle');
  ok(['ziel', 'rueckzug', 'hinein'].includes(tr.params.durchbruch.default) && /Zielbereich/.test(JSON.stringify(tr.vorlage.texte)), 'trupp_raeumen verlangt einen Durchbruch-Bereich (ziel/rueckzug/hinein) und nennt ihn im Text');
  // Bereiche der Gelände-Karten: nie ziel/rueckzug/hinein (sonst meldete team_im_bereich 'Bereich unbekannt' in jeder Tick-Runde, im Labor gemessen: > 8000 Fehler)
  const namen = new Set();
  const L = (biom, hoehle) => M.lpMitGen(Context.lpAdapterAusWelt(welt0), biom, hoehle);
  for (const [art, biom, hoehle] of [['wildnis', 'wueste', false], ['wildnis', 'vulkan', true], ['hoehle', null, false]]) {
    const v = L(biom, hoehle).vorschau('kesh', { art });
    for (const k of Object.keys(v.karte.bereiche || {})) namen.add(k.replace(/\d+$/, '#'));
  }
  ok(!['ziel', 'rueckzug', 'hinein'].some((x) => namen.has(x)), 'Gelände-Karten kennen die Bereiche ' + [...namen].join(', ') + ' (kein ziel, rueckzug, hinein)');
});

const szenentyp = Object.values(kat.szenentypen).find((t) => t.bereich === 'aussen' && t.status === 'verfuegbar' && (t.verfuegbare_molekuele || []).includes(MOL));
function lps(biom, hoehle) {
  const out = [];
  for (let s = 1; s <= SEEDS; s++) { const w = M.clone(welt0); w.meta = Object.assign({}, w.meta, { seed: s }); out.push(M.lpMitGen(Context.lpAdapterAusWelt(w), biom, hoehle)); }
  return out;
}
function pruefe(art, lp, extra, e) {
  const g = M.testplan(Object.assign({ szenentyp: szenentyp.id, ort: 'kesh', buehne: { kartenart: art, neu: true }, mols: [ID] }, extra || {}));
  return SB.aufloesen(g, e || env, M.clone(ctx0), { lp });
}

section('3. Prüfer-Sweep', () => {
  const FAELLE = [['Wildnis Wüste', 'wildnis', 'wueste', false], ['Wildnis Wiesenwald', 'wildnis', 'wiesenwald', false], ['Wildnis Vulkan', 'wildnis', 'vulkan', false],
    ['Höhle', 'hoehle', null, false], ['Wildnis+Höhle', 'wildnis', null, true]];
  for (const [name, art, biom, hoehle] of FAELLE) {
    let gut = 0; const fehler = {};
    for (const lp of lps(biom, hoehle)) { const r = pruefe(art, lp); if (!r.errors.length) gut++; else for (const c of new Set(r.errors.map((e) => String(e).split(':')[0]))) fehler[c] = (fehler[c] || 0) + 1; }
    ok(gut === SEEDS, `${name}: ${gut}/${SEEDS} Seeds ohne Prüferfehler${gut === SEEDS ? '' : ' ' + JSON.stringify(fehler)}`);
  }
  // Mutationsprobe: der Sweep faengt eine zu hohe Anforderung (min wache 99) und eine falsche Kartenart-Liste
  const kat2 = Katalog.load({}); const u2 = umsetzung(kat2, MOL, UMS);
  u2.buehne_braucht.min.wache = 99;
  const e2 = SB.buildEnv(kat2); const lp = lps(null, false)[0];
  ok(pruefe('wildnis', lp, null, e2).errors.some((e) => /^BUEHNE-ANKER/.test(String(e))), 'Mutationsprobe: min wache 99 → BUEHNE-ANKER (der Sweep schlüge an)');
  u2.buehne_braucht.min.wache = 3; u2.buehne_braucht.kartenarten = ['hoehle'];
  ok(pruefe('wildnis', lp, null, SB.buildEnv(kat2)).errors.some((e) => /^BUEHNE-ART/.test(String(e))), 'Mutationsprobe: nur hoehle als Kartenart → BUEHNE-ART auf Wildnis');
});

section('4. Unpassende Kartenarten, Fraktionen', () => {
  const lp = lps(null, false)[0];
  for (const art of ['aussenposten', 'station', 'ruine', 'schiff']) ok(pruefe(art, lp).errors.some((e) => /^BUEHNE-ART/.test(String(e))), `auf ${art} abgelehnt (BUEHNE-ART)`);
  const lueck = [];
  for (const besitz of ['rom', 'ger', 'herrenlos', 'rostmeute']) for (const art of GELAENDE) for (const staerke of ['klein', 'mittel', 'gross']) for (const haltung of ['ruhig', 'wach']) {
    const r = pruefe(art, lp, { buehne: { kartenart: art, neu: true, besitz }, besetzung: [{ fraktion: besitz, staerke, haltung }] });
    const fr = r.errors.filter((e) => /^(FRAKTION|BUEHNE)/.test(String(e)));
    if (fr.length) lueck.push(`${besitz}/${art}/${staerke}/${haltung}: ${fr[0]}`);
  }
  ok(!lueck.length, `Besitz rom/ger/herrenlos/rostmeute auf Wildnis und Höhle FRAKTION-gültig (3 Stärken, 2 Haltungen)${lueck.length ? ': ' + lueck.slice(0, 3).join(' | ') : ''}`);
  const lueck2 = [];
  for (const f of U.params.fraktion.werte) for (const art of GELAENDE) for (const staerke of ['klein', 'mittel', 'gross']) {
    const r = pruefe(art, lp, { besetzung: [{ fraktion: f, staerke, haltung: 'ruhig' }] });
    const fr = r.errors.filter((e) => /^(FRAKTION|BUEHNE)/.test(String(e)));
    if (fr.length) lueck2.push(`${f}/${art}/${staerke}: ${fr[0]}`);
  }
  ok(!lueck2.length, `jede Besetzungs-Fraktion der Umsetzung (${U.params.fraktion.werte.join(', ')}) auf Wildnis und Höhle FRAKTION-gültig${lueck2.length ? ': ' + lueck2.slice(0, 3).join(' | ') : ''}`);
});

section('5. Regiebuch-Prüfer', () => {
  const frag = (p) => Katalog.instantiate(U, Object.assign({ loc: 'kesh', map: 'kesh.wildnis-1' }, p || {}), 's1', 'test_ende');
  const pruefer = (p) => Checker.check(Katalog.testRegiebuch(frag(p).frag, MOL, U)).errors;
  let schlecht = 0;
  for (const fraktion of U.params.fraktion.werte) for (const staerke of ['klein', 'mittel', 'gross']) for (const haltung of ['ruhig', 'wach']) {
    const f = frag({ fraktion, staerke, haltung });
    if (f.errs.length || pruefer({ fraktion, staerke, haltung }).length) schlecht++;
  }
  ok(schlecht === 0, `alle Kombinationen Fraktion x Stärke x Haltung (${U.params.fraktion.werte.length * 6}) bestehen den Regiebuch-Prüfer`);
  ok(frag({}).errs.length === 0 && pruefer({}).length === 0, 'ohne Angaben (Standard) gültig');
  ok(pruefer(U.test.params).length === 0 && frag(U.rueckfall.params).errs.length === 0, 'test.params und rueckfall.params gültig');
  for (const [p, was] of [[{ fraktion: 'kustoden' }, 'Fraktion kustoden'], [{ staerke: 'riesig' }, 'Stärke riesig'], [{ haltung: 'schlafend' }, 'Haltung schlafend'], [{ durchbruch: 'ziel' }, 'alter Parameter durchbruch']]) {
    ok(frag(p).errs.length > 0, `Gegenprobe: ${was} wird abgelehnt (${frag(p).errs.join(' | ').slice(0, 70)})`);
  }
  const st = JSON.stringify(frag({}).frag.steps[0].rules);
  ok(/trupp_geraeumt/.test(st) && !/team_im_bereich|any/.test(st), 'Regel: nur trupp_geraeumt beendet die Szene');
  const en = JSON.stringify(frag({}).frag.steps[0].enter);
  ok(/"do":"besetzen"/.test(en) && /_besetzt/.test(en) && !/"bereich"/.test(en), 'enter: besetzen ohne Bereich (Lager der Karte), gegen Wiederholung gesichert');
});

// ---------- 6. Headless im echten Labor ----------
const HZ = CONFIG.tickHz;
function labor(buehne, seed, params) {
  const g = new Game({ noStore: true, seed: 7, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < 3; i++) { const c = { inbox: [], send() {} }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'L' + i, name: 'L' + i, color: i }); cs.push(c); }
  g.reset(); g.phase = 'play';
  const S = { g, cs, me: [] };
  const m0 = g.missionEvent.bind(g); g.missionEvent = (nm, d) => { S.me.push({ nm, d }); return m0(nm, d); };
  const k = Katalog.load({}); const u = umsetzung(k, MOL, UMS);
  if (params) u.rueckfall.params = params;
  S.start = Labor.laborStart(g, ID, { seed, katalog: k, god: true, buehne });
  S.ticks = (sek) => { for (let i = 0, N = Math.round(sek * HZ); i < N; i++) g.step(); };
  S.ticks(2);
  const lpid = Object.keys(g.landepunkte.dyn)[0];
  const b = g.landepunkte.dyn[lpid].beam; g.ship.x = b.x; g.ship.y = b.y; g.ship.vx = 0; g.ship.vy = 0;
  g.players.forEach((p, i) => { Interior.placeOnShipPad(g, p, i); p.console = 'transfer'; });
  g.handleMessage(cs[0], { t: 'cmd', c: 'transfer.ziel', landepunkt: lpid }); S.ticks(1);
  g.handleMessage(cs[0], { t: 'cmd', c: 'transfer.down' }); S.ticks(7);
  S.aw = g.away; S.lp = lpid;
  return S;
}
const flag = (S) => { const m = S.g.mission; return !!((m.flags && m.flags.labs1_geraeumt) || (m.state && m.state.flags && m.state.flags.labs1_geraeumt)); };
const kacheln = (aw, e) => ({ x: Math.floor(e.x / Physics.TILE), y: Math.floor(e.y / Physics.TILE) });
// Abstand einer Kachel zum Rechteck [x, y, w, h] in Kacheln (0 = drin)
const abstand = (r, t) => Math.max(r[0] - t.x, 0, t.x - (r[0] + r[2] - 1)) + Math.max(r[1] - t.y, 0, t.y - (r[1] + r[3] - 1));

section('6. Headless: echtes Labor, Wildnis (3 Biome) und Höhle', () => {
  const FAELLE = [['Wildnis Wüste', { kartenart: 'wildnis', biom: 'wueste' }, 11], ['Wildnis Wiesenwald', { kartenart: 'wildnis', biom: 'wiesenwald' }, 12], ['Wildnis Vulkan', { kartenart: 'wildnis', biom: 'vulkan' }, 13], ['Höhle', { kartenart: 'hoehle' }, 14]];
  for (const [name, buehne, seed] of FAELLE) {
    let S;
    try { S = labor(buehne, seed); } catch (e) { ok(false, `${name}: Labor-Aufbau fehlgeschlagen: ${e.message}`); continue; }
    const aw = S.aw; const g = S.g;
    ok(S.start.ok && g.players.every((p) => p.zone === 'away') && /^kesh\.(wildnis|hoehle)-\d+$/.test(aw.map), `${name}: Labor startet, Crew unten auf neuer Karte (${aw.map})`);
    const D = aw.drones.filter((e) => e.tag === 'labs1_trupp');
    ok(D.length >= 2 && D.every((e) => e.alive), `${name}: ${D.length} Gegner mit Tag labs1_trupp besetzt (Rostmeute, mittel)`);
    const karte = Interior.awayInfoOf(aw.map).karte;
    const lager = Object.entries(karte.bereiche || {}).filter(([id, b]) => b.gefecht).map(([id, b]) => b.rects);
    // Wachen stehen im Lager, Streifen gehen die Patrouillenwege der Karte (hoechstens 12 Kacheln ausserhalb), mindestens die Haelfte steht im Lager
    const dist = D.map((e) => Math.min(...lager.flat().map((r) => abstand(r, kacheln(aw, e)))));
    ok(lager.length >= 1 && dist.every((d) => d <= 12) && dist.filter((d) => d === 0).length >= D.length / 2, `${name}: Gegner an den Lagern (${dist.filter((d) => d === 0).length} von ${D.length} im Lager, am weitesten ${Math.max(...dist)} Kacheln davon; ${lager.length} Lager auf der Karte)`);
    ok(!flag(S), `${name}: Szene nicht erledigt, solange Gegner stehen`);
    S.ticks(3);
    ok(g.errors === 0, `${name}: keine Server-Fehler im Lauf (g.errors ${g.errors})`);
    for (const e of D.slice(0, D.length - 1)) for (let i = 0; i < 12 && e.alive; i++) combat.hitEnemy(g, e, 99, { x: e.x - 40, y: e.y });
    S.ticks(2);
    ok(!flag(S) && D.slice(0, D.length - 1).every((e) => !e.alive), `${name}: einer steht noch → nicht erledigt`);
    for (const e of D) for (let i = 0; i < 12 && e.alive; i++) combat.hitEnemy(g, e, 99, { x: e.x - 40, y: e.y });
    S.ticks(3);
    ok(D.every((e) => !e.alive) && flag(S), `${name}: alle ausgeschaltet → Bedingung trupp_geraeumt erfüllt (Flag labs1_geraeumt)`);
    ok(g.errors === 0, `${name}: g.errors 0 am Ende (${g.errors})`);
  }
});

console.log(`\n${n - bad}/${n} ok`);
if (bad) { console.log(`${bad} FEHLER`); process.exit(1); }
console.log('TEST-SPL-POSTEN-GELAENDE OK');
