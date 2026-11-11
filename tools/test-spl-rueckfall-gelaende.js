#!/usr/bin/env node
'use strict';
// SPL-01 b2 Teil 2: zwei Gelaende-Archiv-Eintraege fuer den Rueckfall (zuflucht_auf_kesh: Wildnis, Ueberlebende suchen + Ladung bergen;
// zwischenfall_am_stollen: Hoehle, Kontrollposten + Ladung bergen). Beide nutzen buehne { kartenart, neu: true }; das Archiv-Format kann das
// ohne Servercodeaenderung, weil planFromArchive wie ein frischer Plan aufloesen und neueLandepunkteAnlegen aufruft.
//  1. Dateien: Archiv.load ohne Fehler, die sechs alten Eintraege bleiben vorn in unveraenderter Reihenfolge (Auswahl der bisherigen Tests kippt nicht), beide neuen folgen.
//  2. Inhalt: Bodenszenen mit buehne.neu (wildnis/hoehle), kein fester Landepunkt, Umsetzungen aus dem Katalog, Auftraggeber und Besetzung verschieden von den Altbestaenden.
//  3. Pruefer: in drei Weltstaenden und ueber 30 Seeds (Seed bestimmt die neue Karte): aufloesen ohne Fehler, genau ein neuer Landepunkt je Eintrag, Grobplan-Pruefer, Buch.
//  4. Spielleiter-Pfad (planFromArchive, Landepunkte im Speicher): Angebot entsteht, Landepunkt wird angelegt und ist beiden Bodenszenen zugeordnet, Buch beim Pruefer registriert.
//  5. Rueckfall: bei faelliger Bodenquote und sonst gespielten Boden-Eintraegen waehlt der Archiv-Pick Gelaende; Zaehler messe-spl-rueckfall (50 Seeds): Gelaende > 0, Altanteile bleiben.
//  6. Bot-/Gruppenlauf (tools/sim-archiv-eintraege.js, Crew 3, 1 Seed): beide Eintraege werden gespielt, Ausgang erreicht, 0 Server-Fehler.
//   node tools/test-spl-rueckfall-gelaende.js   (npm run test:spl-rueckfall-gelaende)
const path = require('path');
const cp = require('child_process');
const M = require('./lib/messe-spl.js');
const Katalog = require('./katalog.js');
const Archiv = require('../server/mission/archiv.js');
const SB = require('../server/mission/szenenbau.js');
const Context = require('../server/mission/context.js');
const LLM = require('../server/mission/llm.js');
const Checker = require('../server/mission/checker.js');
const Spielleiter = require('../server/mission/spielleiter.js');

let n = 0, bad = 0;
const ok = (c, t) => { n++; if (!c) { bad++; console.log('  FEHLER ' + t); } else console.log('  ok   ' + t); };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { return body(); } catch (e) { bad++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};

const ALT = ['abschrift_b7', 'castellum_kesh', 'frachtlisten', 'karawane_im_nebel', 'treibgut_zaunkoenig', 'zollfeuer'];
const NEU = { zuflucht_auf_kesh: { art: 'wildnis', ort: 'kesh', auftraggeber: 'sela', mols: ['personen_bergen/ueberlebende_suchen', 'ladung_bergen/ladung_am_boden'] },
  zwischenfall_am_stollen: { art: 'hoehle', ort: 'splitter', auftraggeber: 'tesk', mols: ['stellung_nehmen/kontrollposten_im_gelaende', 'ladung_bergen/ladung_am_boden'] } };
const katalog = Katalog.load({});
const env = SB.buildEnv(katalog);
const geladen = Archiv.load();
const eintrag = (name) => geladen.entries.find((e) => e.name === name);

section('1. Dateien und Reihenfolge', () => {
  ok(!geladen.errors.length, `Archiv.load ohne Fehler (${geladen.errors.map((e) => e.file + ': ' + e.msg).join(' | ') || '–'})`);
  const names = geladen.entries.map((e) => e.name);
  ok(JSON.stringify(names.slice(0, 6)) === JSON.stringify(ALT), `die sechs alten Einträge stehen vorn in alter Reihenfolge (${names.slice(0, 6).join(', ')})`);
  ok(JSON.stringify(names.slice(6, 8)) === JSON.stringify(Object.keys(NEU)), `danach die beiden Gelände-Einträge (${names.slice(6, 8).join(', ')})`);
  ok(names.slice(8).every((x) => /^\d{4}-\d\d-\d\d_/.test(x)), 'dahinter nur die erzeugten, angenommenen Missionen');
  ok(new Set(names).size === names.length, 'Kennungen eindeutig');
});

section('2. Inhalt der Einträge', () => {
  const auftraggeberAlt = ALT.map((x) => eintrag(x).grobplan.auftraggeber);
  for (const [name, w] of Object.entries(NEU)) {
    const e = eintrag(name); const g = e.grobplan;
    ok(!!e && g.auftraggeber === w.auftraggeber && g.szenen.length >= 3 && g.szenen.length <= 6, `${name}: Auftraggeber ${g.auftraggeber}, ${g.szenen.length} Szenen`);
    const boden = g.szenen.filter((s) => s.buehne);
    ok(boden.length === 2 && boden.every((s) => s.buehne.neu === true && s.buehne.kartenart === w.art && s.ort === w.ort && !s.landepunkt && !s.karte), `${name}: zwei Bodenszenen mit buehne { kartenart: ${w.art}, neu: true } am Ort ${w.ort}, kein fester Landepunkt`);
    const ms = g.szenen.flatMap((s) => (s.molekuele || []).map((m) => m.id + '/' + m.umsetzung));
    ok(JSON.stringify(ms) === JSON.stringify(w.mols), `${name}: Umsetzungen ${ms.join(', ')}`);
    ok(ms.every((x) => { const [m, u] = x.split('/'); const um = katalog.molekuele[m].umsetzungen.find((y) => y.id === u); return um && um.status === 'verfuegbar' && um.buehne_braucht.kartenarten.includes(w.art); }), `${name}: jede Umsetzung ist verfügbar und nennt ${w.art} in buehne_braucht.kartenarten`);
    ok(Object.keys(g.ausgaenge).length === 2 && Object.keys(e.szenen).length === 2, `${name}: zwei Ausgänge, ausgearbeitete Parameter für beide Bodenszenen`);
  }
  ok(Object.values(NEU).every((w) => auftraggeberAlt.filter((a) => a === w.auftraggeber).length <= 2) && new Set(Object.values(NEU).map((w) => w.auftraggeber)).size === 2, 'zwei verschiedene Auftraggeber, keiner häufiger als bisher');
  const frak = (name) => eintrag(name).grobplan.szenen.flatMap((s) => (s.besetzung || []).map((b) => b.fraktion));
  ok(frak('zuflucht_auf_kesh').join() === 'ger' && frak('zwischenfall_am_stollen').join() === 'rostmeute', 'Besetzung: ger auf Wildnis, rostmeute (Besitz rostmeute) in der Höhle, also nicht dieselbe Fraktion');
  ok(eintrag('zwischenfall_am_stollen').grobplan.szenen.find((s) => s.buehne && s.buehne.besitz === 'rostmeute') && !eintrag('zuflucht_auf_kesh').grobplan.szenen.some((s) => s.buehne && s.buehne.besitz), 'Besitz: Höhle rostmeute, Wildnis ohne Besitzangabe');
});

section('3. Prüfer: drei Weltstände, 30 Seeds', () => {
  for (const [name, w] of Object.entries(NEU)) {
    const e = eintrag(name);
    for (const ws of ['nach-tutorial', 'ohne-tutorial', 'frisch']) {
      const welt = M.weltstand(ws); const ctx = Context.build(welt, M.anlass(), katalog);
      const lp = Context.lpAdapterAusWelt(welt);
      const g = M.clone(e.grobplan); const er = Archiv.erinnerung(e, ctx);
      if (er.ref) g.erinnerung = er.ref; else delete g.erinnerung; g.erinnerung_text = er.text;
      const auf = SB.aufloesen(g, env, ctx, { lp });
      const legacy = SB.checkGrobplan(Object.assign({ erinnerung: er.text || '' }, g), env);
      const s2 = SB.checkGrobplanS2(g, env, ctx, { origin: 'archiv' });
      const answers = {}; for (const [sid, a] of Object.entries(e.szenen)) answers[sid] = { answer: a, quelle: 'archiv' };
      const b = SB.buildBook(g, answers, env, { id: 'ar_1_' + SB.slug(name, 20), art: 'archiv', kontext: ctx });
      const roh = Object.entries(b.szenen).filter(([sid, v]) => answers[sid] && v.quelle !== 'archiv').map(([sid]) => sid);
      ok(!auf.errors.length && auf.neu.length === 1 && auf.neu[0].art === w.art && !legacy.length && !s2.errors.length && !b.errors.length && !roh.length,
        `${name} (${ws}): aufloesen ohne Fehler, ein neuer Landepunkt (${auf.neu.map((x) => x.art).join()}), Grobplan und Buch prüferfest, Szenenantworten übernommen (${[...auf.errors, ...legacy, ...s2.errors, ...b.errors.map((x) => x.code + ' ' + x.msg), ...roh].slice(0, 2).join(' | ') || 'ok'})`);
    }
    let gut = 0; const fehler = [];
    for (let s = 1; s <= 30; s++) {
      const welt = M.clone(M.weltstand('nach-tutorial')); welt.meta = Object.assign({}, welt.meta, { seed: s });
      const ctx = Context.build(welt, M.anlass(), katalog);
      const g = M.clone(e.grobplan); delete g.erinnerung; g.erinnerung_text = 'x';
      const auf = SB.aufloesen(g, env, ctx, { lp: Context.lpAdapterAusWelt(welt) });
      if (!auf.errors.length && auf.neu.length === 1) gut++; else fehler.push(`Seed ${s}: ${auf.errors[0]}`);
    }
    ok(gut === 30, `${name}: 30/30 Seeds ohne Prüferfehler (neue Karte je Seed)${fehler.length ? ' ' + fehler.slice(0, 2).join(' | ') : ''}`);
  }
});

// ---------- 4. Spielleiter-Pfad ----------
function fakeGame() {
  const events = []; const errors = [];
  const g = {
    time: 0, C: require('../shared/config.js'), env: {}, players: [{ connected: true }, { connected: true }, { connected: true }], ship: { scene: 'hafen' },
    emit(k, d) { events.push({ k, d }); }, oda() {}, notice() {}, countError(w, e) { errors.push(w + ': ' + (e && e.message)); }, log() {},
    weltstand: { id: 'w-test', persistent: true, data: null, npcMemory() { return true; } },
  };
  const m = {
    books: {}, activeId: null, step: null, missions: {}, order: ['m1', 'm2', 'm3'],
    info(id) { return ['m1', 'm2', 'm3'].includes(id) ? { id, tutorial: true } : (this.books[id] ? { id, tutorial: false } : null); },
    registerBook(b, o) { const r = Checker.check(b); this.books[b.id] = { book: b, origin: o && o.origin }; return { ok: !r.errors.length, errors: r.errors }; },
    updateBook(id, b) { const r = Checker.check(b); if (r.errors.length) return { ok: false, errors: r.errors }; this.books[id].book = b; return { ok: true }; },
    unregisterBook(id) { delete this.books[id]; }, startMission() {}, radio() {}, playTime() { return g.time; },
  };
  for (const id of m.order) m.missions[id] = { state: 'done' };
  g.mission = m;
  return { g, m, errors };
}
section('4. Spielleiter-Pfad (planFromArchive)', () => {
  for (const [name, w] of Object.entries(NEU)) {
    const welt = M.weltstand('nach-tutorial'); const ctx = Context.build(welt, M.anlass(), katalog);
    const lp = Context.lpAdapterAusWelt(welt);
    const F = fakeGame();
    const sl = Spielleiter.create(F.g, { llm: LLM.create({ mode: 'off' }), kontext: () => ctx, archiv: [eintrag(name)], regieDir: require('os').tmpdir() + path.sep + 'spl-b2-regie', katalog, lp });
    const vorher = lp.liste(w.ort).filter((x) => x.art === w.art).length;
    const plan = sl.newPlan('archiv', { art: 'test' });
    const gut = sl.planFromArchive(plan, 'Test');
    const nachher = lp.liste(w.ort).filter((x) => x.art === w.art);
    const szenen = (plan.grobplan && plan.grobplan.szenen || []).filter((s) => s.buehne);
    const ids = new Set(szenen.map((s) => s.landepunkt));
    ok(gut && plan.state === 'offered' && plan.quelle === 'archiv' && plan.archivName === name, `${name}: Archiv-Angebot entsteht (Zustand ${plan.state}, Quelle ${plan.quelle})`);
    ok(nachher.length === vorher + 1 && ids.size === 1 && nachher.some((x) => x.id === [...ids][0]) && /^(kesh|splitter)\.(wildnis|hoehle)-\d+$/.test([...ids][0] || ''), `${name}: ein neuer Landepunkt ${[...ids].join()} angelegt (${w.art} am Ort ${w.ort}), beide Bodenszenen darauf`);
    ok(!!F.m.books[plan.id] && !Checker.check(F.m.books[plan.id].book).errors.length && !F.errors.length, `${name}: Buch ist beim Prüfer registriert und fehlerfrei, keine Server-Fehler (${F.errors.join(' | ') || '–'})`);
  }
});

// ---------- 5. Rückfall ----------
section('5. Rückfall wählt Gelände', () => {
  const welt = M.weltstand('nach-tutorial');
  const ctx = Context.build(welt, M.anlass(), katalog);
  ctx.bodenbilanz = { letzte: [{ titel: 'x', boden: false }], pflicht_jetzt: true, lang_ab_min: 25 };
  const info = (x) => SB.bodenInfo(x.grobplan, env, { langAbMin: 25, langMaxMin: 35, langeJeRunde: 1, wiederholtFenster: 3 });
  const bodenNamen = geladen.entries.filter((e) => info(e).boden).map((e) => e.name);
  ok(bodenNamen.includes('zuflucht_auf_kesh') && bodenNamen.includes('zwischenfall_am_stollen'), `beide gelten als Bodenmissionen (Boden-Einträge: ${bodenNamen.length})`);
  const vorzug = { boden: true, ohneLang: false, info };
  const ohneNeu = bodenNamen.filter((x) => !NEU[x]);
  const p1 = Archiv.pick(geladen.entries, ohneNeu, ctx, [], vorzug);
  ok(p1 && p1.name === 'zuflucht_auf_kesh', `Quote fällig, alle alten Boden-Einträge gespielt: Pick wählt ${p1 && p1.name}`);
  const p2 = Archiv.pick(geladen.entries, ohneNeu.concat(['zuflucht_auf_kesh']), ctx, [], vorzug);
  ok(p2 && p2.name === 'zwischenfall_am_stollen', `danach: ${p2 && p2.name}`);
  const p0 = Archiv.pick(geladen.entries, [], ctx, [], vorzug);
  ok(p0 && p0.name === bodenNamen[0] && !NEU[p0.name], `nichts gespielt: die Reihenfolge der alten Auswahl bleibt (${p0 && p0.name})`);
  const z = cp.spawnSync(process.execPath, [path.join(__dirname, 'messe-spl-rueckfall.js'), '--seeds', '50', '--json'], { encoding: 'utf8' });
  let d = null; try { d = JSON.parse(z.stdout).daten || JSON.parse(z.stdout); } catch (e) { d = null; }
  ok(z.status === 0 && d, 'messe-spl-rueckfall --seeds 50 läuft');
  if (d) {
    const a = d.archiv.arten;
    ok(d.gelaendePlaene > 0 && (a.wildnis | 0) > 0 && (a.hoehle | 0) > 0, `Zähler: Gelände-Pläne ${d.gelaendePlaene} von ${d.plaeneGesamt} (vorher 0 von 100); Archiv-Arten ${JSON.stringify(a)}`);
    ok((a.hand | 0) > 0 && (a.ruine | 0) > 0 && (a.station | 0) > 0 && d.archiv.ohneBoden <= 2, `bestehende Anteile bleiben gültig (hand, ruine, station vorhanden; Pläne ohne Bodenszene ${d.archiv.ohneBoden})`);
  }
});

// ---------- 6. Bot-/Gruppenlauf ----------
section('6. Bot-/Gruppenlauf (Archiv-Einträge, Crew 3)', () => {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'sim-archiv-eintraege.js'), '--seeds', '1', '--crew', '3'], { encoding: 'utf8', cwd: path.join(__dirname, '..'), maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  const zeilen = out.split('\n').filter((l) => /erledigt – Ausgang|NICHT erledigt/.test(l));
  ok(r.status === 0 && /SIM ARCHIV-EINTRAEGE OK/.test(out), `Lauf Exit ${r.status}: ${zeilen.map((l) => l.trim().slice(0, 60)).join(' / ') || out.slice(-200)}`);
  ok(Object.keys(NEU).every((x) => new RegExp(x + ': erledigt').test(out)) && !/Fehler [1-9]/.test(out.split('\n').filter((l) => /Fehler \d/.test(l)).join('\n')), 'beide Einträge erledigt, in jeder Zeile Fehler 0');
});

console.log(`\n${n - bad}/${n} ok`);
if (bad) { console.log(`${bad} FEHLER`); process.exit(1); }
console.log('TEST-SPL-RUECKFALL-GELAENDE OK');
