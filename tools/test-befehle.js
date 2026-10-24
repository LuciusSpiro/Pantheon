'use strict';
// SUND-03 A: Kern-Befehle der Weltsimulation (server/weltsim/befehle.js, content/welt/befehle-werte.json). Reiner Kern, ohne Spiel und Netz (Spielaufsatz: tools/test-regie.js).
//   Daten · Bit-Parität (tick ohne Befehle = unveränderter Kern, 40 Seeds) · je Befehlstyp Positiv und Negativ mit Ablehnungsgrund · keine Zufallszahl · Embargo (Wirkung, Ende, Speichern) ·
//   Söldner (Wechsel, Rückkehr, Standard-KI setzt sie nie ein) · Nachschub · Fokus und Regler (Überlagerung, Schichtung mit zustand.absichten) · Bereinigung geladener Daten.
//   node tools/test-befehle.js [begriff …]   (npm run test:befehle)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
process.chdir(path.join(__dirname, '..'));
const Kern = require('../server/weltsim/kern.js');
const Daten = require('../server/weltsim/daten.js');
const Ereignisse = require('../server/weltsim/ereignisse.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const F = require('./regie-fixture.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}
const { klon, gleich } = F;
const DATEN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'befehle-werte.json'), 'utf8'));
const REGIE_DATEN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'regie-werte.json'), 'utf8')).werte;
const W = DATEN.werte;
const B = Kern.BEFEHLE;
const { karte, werte } = Daten.laden();
const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'weltsim-golden-ohne-befehle.json'), 'utf8'));

// Ausgangslage: Seed 1, fünf Ticks, dann alle Flotten ruhig und voll im Heimathafen, keine laufenden Feldzüge der Standard-KI (der Test legt fest, was geschieht).
// Rom und Germanen haben Munition und Treibstoff über 10, das Konkordat Treibstoff. Flotten: rom 1–8, kon 9, 11, 13, pirat 10, 12, ger 14–21.
function lage(seed, ticks) {
  const z = Kern.erzeuge({ karte, werte, seed: seed == null ? 1 : seed });
  for (let i = 0; i < (ticks == null ? 5 : ticks); i++) Kern.tick(z);
  z.angriffe = [];
  for (const fl of z.flotten) { fl.ort = fl.heimat; fl.befehl = 'heim'; fl.ziel = null; fl.angriff = null; fl.warte = 0; fl.staerke = fl.kap; fl.versorgung = 1; }
  for (const h of Object.values(z.hexe)) h.anspruch = {};
  z.vorrat.ger.T = 40; z.vorrat.ger.U = 40; z.vorrat.rom.T = 40; z.vorrat.rom.U = 40; z.vorrat.kon.T = 31; z.vorrat.kon.U = 10;
  return z;
}
const tick1 = (z, befehle) => Kern.tick(z, { befehle });
const typen = (r) => r.ereignisse.map((e) => e.typ);
const flotte = (z, id) => z.flotten.find((f) => f.id === id);
const GRUND = (z, b) => B.pruefe(z, b).grund;
const alleOk = (z, b) => B.pruefe(z, b).ok;

section('Daten', () => {
  ok(DATEN.format === 'weltsim-befehle/1' && typeof DATEN._hinweis === 'string', 'Format weltsim-befehle/1 mit Hinweis');
  ok(Number.isInteger(W.je_tick_max.wert) && W.je_tick_max.wert >= 4, 'je_tick_max: ganze Zahl, ausreichend für einen Plan samt Fokus');
  const D = W.dauer.wert;
  ok(['embargo', 'soeldner', 'fokus', 'regler'].every((k) => D[k] && Number.isInteger(D[k].min) && D[k].min >= 1 && D[k].max >= D[k].min), 'Dauer je Typ mit zeitlicher Wirkung: min >= 1, max >= min (alles endet von selbst)');
  ok(D.embargo.max <= 40 && D.soeldner.max <= 30 && D.fokus.max <= 30 && D.regler.max <= 30, 'Dauer: Obergrenzen kurz genug, dass nichts zum Dauerzustand wird (Embargo höchstens 40 Ticks)');
  ok(W.embargo.wert.waren.every((g) => ['M', 'T', 'E'].includes(g)) && W.embargo.wert.gegen.every((f) => ['rom', 'ger'].includes(f)) && W.embargo.wert.von.join() === 'kon', 'Embargo: nur M, T, E, nur gegen rom und ger, nur von kon');
  ok(W.fokus.wert.fraktionen.join() === 'rom,ger' && W.fokus.wert.radius.min >= 1, 'Fokus: Rom und Germanen (Piraten haben auf dieser Karte je Basis nur ein Raubzugsziel), Radius');
  ok(['p_act', 'aggr', 'max_active'].every((k) => W.regler.wert[k].min < W.regler.wert[k].max) && W.regler.wert.p_act.max <= 1 && W.regler.wert.aggr.max <= 1, 'Regler: Grenzen der drei Regler');
  ok(W.nachschub.wert.guete.every((g) => ['T', 'U'].includes(g)) && W.nachschub.wert.kon_reserve >= 0 && W.nachschub.wert.preis_faktor > 0, 'Nachschub: nur Treibstoff und Munition, Reserve und Preis in den Daten');
  ok(W.soeldner.wert.preis_je_staerke_tick > 0 && W.soeldner.wert.flotten_max >= 1 && W.soeldner.wert.aktiv_max_je_an >= 1, 'Söldner: Mietpreis, Flottenzahl und Obergrenze in den Daten');
  ok(W.angreifen.wert.hauptwelt_erlaubt === false, 'Angriffsbefehle auf eine Hauptwelt sind ausgeschlossen');
  for (const t of ['embargo_verhaengt', 'embargo_beendet', 'soeldner_vermietet', 'soeldner_zurueck', 'flotte_verlegt', 'konvoi']) ok(Array.isArray(Ereignisse.TYPEN[t]), 'Ereignistyp ' + t + ' ist vereinbart');
  ok(Object.keys(B.KATALOG).sort().join() === ['angreifen', 'beanspruchen', 'embargo', 'fokus', 'nachschub', 'piratenueberfall', 'regler', 'rueckzug', 'soeldner', 'verstaerken'].join(), 'der Katalog hat genau die zehn Befehle');
});

section('Bit-Parität: Referenz', () => {
  // Die Referenz-Hashes (tools/fixtures/weltsim-golden-ohne-befehle.json) stammen vom Kern VOR den Befehlen: Ereignisse je Tick plus Endzustand.
  let schlecht = 0;
  for (const modus of ['ohne', 'leer', 'liste']) {
    for (let seed = 0; seed < 40; seed++) {
      const z = Kern.erzeuge({ karte, werte, seed }); const h = crypto.createHash('sha256');
      for (let i = 0; i < 300; i++) h.update(JSON.stringify((modus === 'ohne' ? Kern.tick(z) : modus === 'leer' ? Kern.tick(z, {}) : Kern.tick(z, { befehle: [] })).ereignisse));
      const { werte: _w, karte: _k, ...rest } = z; h.update(JSON.stringify(rest));
      if (h.digest('hex').slice(0, 16) !== GOLD[seed]) schlecht++;
    }
  }
  ok(schlecht === 0, `3 Aufrufarten × 40 Seeds × 300 Ticks bitgleich zu den Referenz-Hashes des unveränderten Kerns (${schlecht} Abweichungen)`);
  ok(Object.keys(GOLD).length === 40, 'die Referenz hat 40 Seeds');
  // Zustandsfelder der Befehle erscheinen ohne Befehle nie im Zustand (sonst änderte sich das Abbild)
  const z = Kern.erzeuge({ karte, werte, seed: 5 });
  for (let i = 0; i < 300; i++) Kern.tick(z);
  ok(!('embargo' in z) && !('regie' in z) && !z.flotten.some((f) => 'miete' in f) && !z.angriffe.some((a) => 'befohlen' in a), 'ohne Befehle: kein embargo, regie, miete, befohlen im Zustand');
  ok(typeof Kern.tick(z).befehle === 'undefined', 'Rückgabe ohne Befehle: { zustand, ereignisse }');
  let wirft = false; try { Kern.tick(z, { befehle: 'x' }); } catch (e) { wirft = true; }
  ok(wirft, 'befehle, die keine Liste sind, werfen (Programmierfehler, nicht still ignorieren)');
});

section('Obergrenze je Tick', () => {
  const z = lage();
  const r = { typ: 'regler', fraktion: 'rom', p_act: 0.3, dauer: 5 };
  const liste = Array.from({ length: W.je_tick_max.wert + 1 }, () => r);
  const f = B.filtere(z, liste);
  ok(f.gueltig.length === W.je_tick_max.wert && f.verworfen.length === 1 && /mehr als \d+ Befehle in einem Tick/.test(f.verworfen[0].grund), `filtere: höchstens ${W.je_tick_max.wert} Befehle, der Rest wird mit Grund verworfen`);
  const q = klon(z); Object.assign(q, { werte: z.werte, karte: z.karte });
  const t = tick1(q, liste);
  ok(t.befehle.angewandt.length === W.je_tick_max.wert && t.befehle.abgelehnt.length === 1 && /mehr als \d+ Befehle in einem Tick/.test(t.befehle.abgelehnt[0].grund), 'Tick: höchstens je_tick_max Befehle angewandt, der Rest abgelehnt (Grund geht zurück)');
});

section('Prüfer: unbekannt und Müll', () => {
  const z = lage();
  for (const [b, teil] of [[null, 'kein Befehl'], [[], 'kein Befehl'], ['angreifen', 'kein Befehl'], [{}, 'unbekannter Typ'], [{ typ: 'zaubern' }, 'unbekannter Typ'], [{ typ: '__proto__' }, 'unbekannter Typ'], [{ typ: 'toString' }, 'unbekannter Typ'], [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', extra: 1 }, 'unbekanntes Feld']]) {
    const p = B.pruefe(z, b);
    ok(!p.ok && p.grund.includes(teil), `${JSON.stringify(b)}: abgelehnt (${p.grund})`);
  }
  // ein Prüfer, der wirft, lehnt ab statt zu werfen
  const b = { typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: 5 };
  ok(!B.pruefe(z, b).ok, 'Müllfelder lehnen ab, werfen nicht');
});

section('angreifen', () => {
  const z = lage();
  const b = { typ: 'angreifen', fraktion: 'ger', ziel: '0403' };
  ok(alleOk(z, b), 'Germanen gegen Speculum (römischer Hafen, schwach verteidigt): gültig');
  const r = tick1(klon(z) && Object.assign(klon(z), { werte: z.werte, karte: z.karte }), [b]);
  ok(r.befehle && r.befehle.angewandt.length === 1 && r.befehle.abgelehnt.length === 0, 'im Tick angewandt, nichts abgelehnt');
  ok(typen(r).some((t) => t === 'flotte_sammelt' || t === 'flotte_aufbruch') && r.ereignisse.some((e) => e.fraktion === 'ger' && e.ziel === '0403'), 'Ereignis flotte_sammelt/flotte_aufbruch der Germanen mit Ziel Speculum');
  const rec = r.zustand.angriffe.find((a) => a.ziel === '0403');
  ok(rec && rec.befohlen === true && rec.von === 'ger' && rec.art === 'reich' && rec.flotten.length >= 1 && rec.flotten.every((id) => flotte(r.zustand, id).fraktion === 'ger' && flotte(r.zustand, id).angriff === rec.id), 'Feldzug mit befohlen: true, Flotten der Germanen sind ihm zugeordnet');
  ok(r.ereignisse.every((e) => e.tick === r.zustand.tick), 'Ereignisse tragen den Tick des Befehls');
  // Wirkt wirklich: die Flotte setzt sich in Marsch bis zum Ziel
  const z2 = klon(z); Object.assign(z2, { werte: z.werte, karte: z.karte });
  tick1(z2, [b]);
  let belagert = false;
  for (let i = 0; i < 25 && !belagert; i++) belagert = Kern.tick(z2).ereignisse.some((e) => e.typ === 'flotte_belagert' && e.ziel === '0403');
  ok(belagert, 'der Feldzug erreicht sein Ziel und belagert es (flotte_belagert)');
  // Negativ
  const neg = [
    [{ typ: 'angreifen', fraktion: 'kon', ziel: '0403' }, 'fraktion muss rom oder ger sein'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '9999' }, 'unbekanntes Ziel'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0803' }, 'kein feindlicher Hafen oder Posten'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0503' }, 'kein feindlicher Hafen oder Posten'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0604' }, 'kein feindlicher Hafen oder Posten'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0204' }, 'Hauptwelten'],
    [{ typ: 'angreifen', fraktion: 'rom', ziel: '1004' }, 'Hauptwelten'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [] }, 'flotten:'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [16, 16] }, 'flotten:'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [1] }, 'gehört nicht zu ger'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [999] }, 'gehört nicht zu ger'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: 'alle' }, 'flotten:'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotte: 16, flotten: [17] }, 'schließen sich aus'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotte: 14 }, 'zu schwach'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', von: 'x' }, 'von ist kein Hex'],
    [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', von: '0105' }, 'keine bereite Flotte'],
  ];
  for (const [bb, teil] of neg) { const g = GRUND(z, bb); ok(typeof g === 'string' && g.includes(teil), `${JSON.stringify(bb)} → „${g}“`); }
  const arm = klon(z); Object.assign(arm, { werte: z.werte, karte: z.karte }); arm.vorrat.ger.T = 9;
  ok((GRUND(arm, b) || '').includes('Munition oder Treibstoff'), 'Treibstoff unter 10: abgelehnt');
  const arm2 = klon(z); Object.assign(arm2, { werte: z.werte, karte: z.karte }); arm2.vorrat.ger.U = 9;
  ok((GRUND(arm2, b) || '').includes('Munition oder Treibstoff'), 'Munition unter 10: abgelehnt');
  const krieg = klon(z); Object.assign(krieg, { werte: Object.assign({}, z.werte, { war: false }), karte: z.karte });
  ok(GRUND(krieg, b) === 'Krieg ist aus', 'ohne Krieg abgelehnt');
  // Doppelt: zweiter Angriff auf dasselbe Ziel in einem Probelauf
  const f = B.filtere(z, [b, b]);
  ok(f.gueltig.length === 1 && f.verworfen.length === 1 && /läuft schon/.test(f.verworfen[0].grund), 'filtere: ein zweiter Angriff auf dasselbe Ziel sieht den Stand des ersten (abgelehnt, Zustand unberührt)');
  ok(z.angriffe.length === 0 || !z.angriffe.some((a) => a.befohlen), 'filtere ändert den Zustand nicht');
  // Abgelehnt im Tick: nie halb ausgeführt
  const z3 = klon(z); Object.assign(z3, { werte: z.werte, karte: z.karte }); z3.vorrat.ger.T = 1;   // zu wenig Treibstoff (Wirtschaft verbraucht zusätzlich)
  const vor = JSON.stringify(Object.assign({}, z3, { werte: undefined, karte: undefined }));
  const r3 = tick1(z3, [b]);
  ok(r3.befehle.abgelehnt.length === 1 && r3.befehle.angewandt.length === 0 && r3.befehle.abgelehnt[0].grund.includes('Treibstoff') && !z3.angriffe.some((a) => a.befohlen), 'Tick: ungültiger Befehl wird abgelehnt (Grund geht zurück), kein Feldzug entsteht');
  void vor;
  // Zusammenspiel mit max_active
  const z4 = lage();
  const lauf = B.filtere(z4, [b, { typ: 'angreifen', fraktion: 'ger', ziel: '0405' }, { typ: 'angreifen', fraktion: 'ger', ziel: '0105' }, { typ: 'angreifen', fraktion: 'ger', ziel: '0205' }]);
  ok(lauf.gueltig.length <= z4.werte.max_active.ger, 'höchstens max_active Flotten zugleich im Einsatz (gültig: ' + lauf.gueltig.length + ')');
});

section('angreifen mit festen Flotten', () => {
  const z = lage();
  const b = { typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [16, 17] };
  ok(alleOk(z, b), 'flotten [16, 17] (zwei bereite germanische Flotten): gültig');
  const z2 = klon(z); Object.assign(z2, { werte: z.werte, karte: z.karte });
  tick1(z2, [b]);
  ok(flotte(z2, 16).angriff !== null && flotte(z2, 17).angriff !== null && z2.angriffe.some((a) => a.befohlen && a.flotten.join() === '16,17'), 'genau diese Flotten nimmt der Feldzug');
  const eins = { typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotte: 16 };
  ok(alleOk(z, eins) || (GRUND(z, eins) || '').includes('zu schwach'), 'flotte (eine Id) wird wie flotten [id] gelesen');
  const von = { typ: 'angreifen', fraktion: 'ger', ziel: '0403', von: '0904' };
  ok(alleOk(z, von), 'von: nur Flotten dieses Hexes kommen in Frage');
  const z3 = klon(z); Object.assign(z3, { werte: z.werte, karte: z.karte }); tick1(z3, [von]);
  ok(z3.angriffe.filter((a) => a.befohlen).every((a) => a.flotten.every((id) => flotte(z3, id).heimat === '0904')), 'von 0904: nur Flotten aus 0904');
  // Zu viele Flotten: mehr als flotten_max
  const viele = { typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [14, 15, 16, 17, 18] };
  ok((GRUND(z, viele) || '').includes('flotten:'), 'mehr als flotten_max Flotten: abgelehnt');
});

section('angreifen: freie Plätze, Bereitschaft, Reichweite', () => {
  const z = lage(); z.absichten = { ger: { max_active: 1 } };
  flotte(z, 18).befehl = 'anspruch'; flotte(z, 18).ziel = '0703';   // eine Flotte der Germanen ist schon unterwegs
  ok((GRUND(z, { typ: 'angreifen', fraktion: 'ger', ziel: '0403' }) || '').includes('keine freie Flotte'), 'max_active erreicht: kein weiterer Angriff');
  ok((GRUND(z, { typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [16] }) || '').includes('keine freie Flotte'), 'auch nicht mit fester Flotte');
  z.absichten = { ger: { max_active: 2 } };
  ok((GRUND(z, { typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [16, 17] }) || '').includes('mehr Flotten als freie Plätze'), 'zwei feste Flotten bei einem freien Platz: abgelehnt');
  ok(alleOk(z, { typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [16] }), 'eine feste Flotte bei einem freien Platz: gültig');
  ok((GRUND(z, { typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [18] }) || '').includes('nicht bereit'), 'eine Flotte, die unterwegs ist, ist keine feste Flotte');
  const q = lage(); const d = Kern.datenVon(q);
  let weit = null;
  for (const fl of q.flotten) if (fl.fraktion === 'ger' && fl.staerke >= 5) for (const c of d.codes) if (q.hexe[c].besitzer === 'rom' && d.hex[c].hafen && c !== '0204' && Daten.abstand(d, fl.ort, c) > W.angreifen.wert.reichweite) weit = weit || { id: fl.id, ziel: c };
  ok(!!weit, 'es gibt einen römischen Hafen, der von einer germanischen Flotte weiter als die Reichweite entfernt liegt');
  if (weit) ok((GRUND(q, { typ: 'angreifen', fraktion: 'ger', ziel: weit.ziel, flotten: [weit.id] }) || '').includes('zu weit'), 'feste Flotte außerhalb der Reichweite: abgelehnt');
});

section('beanspruchen', () => {
  const z = lage();
  const b = { typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' };
  ok(alleOk(z, b), 'Rom beansprucht Gasfeld (frei, nahe): gültig');
  const z2 = klon(z); Object.assign(z2, { werte: z.werte, karte: z.karte });
  const r = tick1(z2, [b]);
  ok(r.ereignisse.some((e) => e.typ === 'flotte_aufbruch' && e.art === 'beanspruchen' && e.fraktion === 'rom' && e.ziel === '0503') && z2.flotten.some((f) => f.befehl === 'anspruch' && f.ziel === '0503'), 'Ereignis flotte_aufbruch (beanspruchen), eine Flotte hat den Befehl anspruch');
  let gegruendet = false; for (let i = 0; i < 30 && !gegruendet; i++) gegruendet = Kern.tick(z2).ereignisse.some((e) => e.typ === 'posten_gegruendet' && e.ort === '0503' && e.fraktion === 'rom');
  ok(gegruendet && z2.hexe['0503'].posten && z2.hexe['0503'].besitzer === 'rom', 'die Sim gründet den Posten');
  for (const [bb, teil] of [[{ typ: 'beanspruchen', fraktion: 'rom', sektor: '0204' }, 'nicht frei'], [{ typ: 'beanspruchen', fraktion: 'rom', sektor: '0602' }, 'nicht frei'], [{ typ: 'beanspruchen', fraktion: 'rom', sektor: 'xx' }, 'unbekannter Sektor'], [{ typ: 'beanspruchen', fraktion: 'pirat', sektor: '0503' }, 'fraktion'], [{ typ: 'beanspruchen', fraktion: 'ger', sektor: '0105' }, 'nicht frei']]) {
    const g = GRUND(z, bb); ok(typeof g === 'string' && g.includes(teil), `${JSON.stringify(bb)} → „${g}“`);
  }
  const klein = klon(z); Object.assign(klein, { werte: z.werte, karte: z.karte }); for (const fl of klein.flotten) if (fl.fraktion === 'rom') { fl.kap = 4; fl.staerke = 4; }
  ok((GRUND(klein, { typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' }) || '').includes('keine bereite Flotte'), 'beanspruchen: keine Flotte mit Garnisonsstärke (garrison + 1)');
  const e0 = klon(z); Object.assign(e0, { werte: z.werte, karte: z.karte }); e0.vorrat.rom.E = 1;
  ok((GRUND(e0, b) || '').includes('Ersatzteile'), 'ohne Ersatzteile abgelehnt');
  const fern = { typ: 'beanspruchen', fraktion: 'ger', sektor: '0105' };
  ok(!alleOk(z, fern), 'ein besetztes Hex ist kein Sektor');
  const doppelt = B.filtere(z, [b, b]);
  ok(doppelt.gueltig.length === 1 && /läuft schon/.test(doppelt.verworfen[0].grund), 'derselbe Sektor nicht zweimal');
});

section('verstaerken', () => {
  const z = lage();
  const b = { typ: 'verstaerken', fraktion: 'rom', flotte: 8, hafen: '0305' };
  ok(alleOk(z, b), 'Flotte aus Porta Australis nach Ostia Nova: gültig');
  const z2 = klon(z); Object.assign(z2, { werte: z.werte, karte: z.karte });
  const r = tick1(z2, [b]);
  ok(flotte(z2, 8).heimat === '0305' && (flotte(z2, 8).befehl === 'rueckzug' ? flotte(z2, 8).ziel === '0305' : flotte(z2, 8).ort === '0305'), 'neue Heimat, Rückzug dorthin (oder schon angekommen)');
  ok(r.ereignisse.some((e) => e.typ === 'flotte_verlegt' && e.fraktion === 'rom' && e.zielName === 'Ostia Nova'), 'Ereignis flotte_verlegt');
  let heim = false; for (let i = 0; i < 12 && !heim; i++) { Kern.tick(z2); heim = flotte(z2, 8).befehl === 'heim' && flotte(z2, 8).ort === '0305'; }
  ok(heim, 'die Flotte kommt an und liegt dort bereit');
  for (const [bb, teil] of [[{ typ: 'verstaerken', fraktion: 'rom', flotte: 8, hafen: '0405' }, 'schon'], [{ typ: 'verstaerken', fraktion: 'rom', flotte: 8, hafen: '0503' }, 'kein eigener Hafen'], [{ typ: 'verstaerken', fraktion: 'rom', flotte: 8, hafen: '1004' }, 'kein eigener Hafen'], [{ typ: 'verstaerken', fraktion: 'ger', flotte: 8, hafen: '0305' }, 'unbekannte Flotte'], [{ typ: 'verstaerken', fraktion: 'rom', flotte: 999, hafen: '0305' }, 'unbekannte Flotte'], [{ typ: 'verstaerken', fraktion: 'rom', flotte: 8, hafen: 'zz' }, 'unbekannter Hafen'], [{ typ: 'verstaerken', fraktion: 'ger', flotte: 16, hafen: '0203' }, 'kein eigener Hafen']]) {
    const g = GRUND(z, bb); ok(typeof g === 'string' && g.includes(teil), `${JSON.stringify(bb)} → „${g}“`);
  }
  const unterwegs = klon(z); Object.assign(unterwegs, { werte: z.werte, karte: z.karte }); flotte(unterwegs, 8).befehl = 'anspruch';
  ok((GRUND(unterwegs, b) || '').includes('unterwegs'), 'eine Flotte im Einsatz wird nicht verlegt');
});

section('rueckzug', () => {
  const z = lage();
  const z2 = klon(z); Object.assign(z2, { werte: z.werte, karte: z.karte });
  tick1(z2, [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403' }]);
  const im = z2.flotten.find((f) => f.fraktion === 'ger' && f.angriff !== null);
  ok(!!im && ['sammeln', 'angriff'].includes(im.befehl), 'Ausgangslage: eine Flotte der Germanen im Einsatz (' + (im && im.befehl) + ')');
  const b = { typ: 'rueckzug', fraktion: 'ger', flotte: im.id };
  ok(alleOk(z2, b), 'Rückzug einer Flotte im Einsatz: gültig');
  const r = tick1(z2, [b]);
  ok(r.befehle.angewandt.length === 1 && (im.befehl === 'rueckzug' || im.befehl === 'heim') && im.ziel !== '0403', 'die Flotte bricht ab (rueckzug nach Heimat)');
  ok((GRUND(z, { typ: 'rueckzug', fraktion: 'ger', flotte: 16 }) || '').includes('nicht im Einsatz'), 'eine ruhige Flotte hat nichts abzubrechen');
  ok((GRUND(z2, { typ: 'rueckzug', fraktion: 'rom', flotte: im.id }) || '').includes('unbekannte Flotte'), 'fremde Flotte: abgelehnt');
  ok((GRUND(z2, { typ: 'rueckzug', fraktion: 'ger', flotte: 'x' }) || '').includes('unbekannte Flotte'), 'Müll-Id: abgelehnt');
  // Sammelnde Flotten: der Rückzug löst die Bindung an den Feldzug (wie sammeln() beim Abbruch)
  const z3 = lage(); z3.absichten = { ger: { p_act: 0 } }; tick1(z3, [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403' }]);   // die Standard-KI plant nichts dazwischen
  const sam = z3.flotten.find((f) => f.fraktion === 'ger' && f.befehl === 'sammeln');
  if (sam) { tick1(z3, [{ typ: 'rueckzug', fraktion: 'ger', flotte: sam.id }]); ok(sam.angriff === null && ['rueckzug', 'heim'].includes(sam.befehl) && sam.ziel !== '0403', 'Rückzug beim Sammeln: Flotte löst sich vom Feldzug'); }
  else ok(true, 'kein Sammeln in dieser Lage (Marsch direkt): Fall nicht nötig');
});

section('nachschub', () => {
  const z = lage();
  const b = { typ: 'nachschub', an: 'ger', gut: 'T', menge: 10 };
  ok(alleOk(z, b), 'Nachschub Treibstoff 10 an die Germanen: gültig (Konkordat hat 31)');
  const z2 = klon(z); Object.assign(z2, { werte: z.werte, karte: z.karte });
  const vor = { t: z2.vorrat.ger.T, k: z2.vorrat.kon.T, mg: z2.marken.ger, mk: z2.marken.kon };
  // Vorrat vor dem Befehl: nach der Wirtschaft des Tick; wir messen die Differenz gegen denselben Tick ohne Befehl
  const ref = klon(z); Object.assign(ref, { werte: z.werte, karte: z.karte });
  Kern.tick(ref);
  const r = tick1(z2, [b]);
  const eps = 1e-9;
  ok(Math.abs((z2.vorrat.ger.T - ref.vorrat.ger.T) - 10) < eps && Math.abs((ref.vorrat.kon.T - z2.vorrat.kon.T) - 10) < eps, 'Treibstoff wandert vom Konkordat zu den Germanen (10)');
  ok(Math.abs((ref.marken.ger - z2.marken.ger) - 10 * z.werte.price_sell) < eps && Math.abs((z2.marken.kon - ref.marken.kon) - 10 * z.werte.price_sell) < eps, 'Marken-Senke: die Germanen zahlen menge × price_sell an das Konkordat (dieselbe Überweisung wie im Handel)');
  const kv = r.ereignisse.filter((e) => e.typ === 'konvoi');
  const mein = kv.find((e) => e.handel && e.handel.ger && e.handel.ger.verkauf && e.handel.ger.verkauf.T === 10 && e.menge === 10);
  ok(!!mein && mein.fraktion === 'kon' && Object.keys(mein).sort().join() === 'fraktion,handel,menge,tick,typ', 'Ereignis konvoi im Format der Sim (handel, menge), fraktion kon');
  ok(JSON.stringify(mein.handel) === '{"ger":{"verkauf":{"T":10},"kauf":{}}}', 'handel: { ger: { verkauf: { T: 10 }, kauf: {} } }');
  void vor;
  const neg = [
    [{ typ: 'nachschub', an: 'kon', gut: 'T', menge: 5 }, 'an muss'],
    [{ typ: 'nachschub', an: 'ger', gut: 'M', menge: 5 }, 'gut muss'],
    [{ typ: 'nachschub', an: 'ger', gut: 'T', menge: 0 }, 'menge'],
    [{ typ: 'nachschub', an: 'ger', gut: 'T', menge: 99 }, 'menge'],
    [{ typ: 'nachschub', an: 'ger', gut: 'T', menge: 2.5 }, 'menge'],
    [{ typ: 'nachschub', an: 'ger', gut: 'T', menge: 5, hafen: '0105' }, 'hafen ist kein Hafen von an'],
    [{ typ: 'nachschub', an: 'ger', gut: 'U', menge: 12 }, 'Konkordat hat nicht genug'],
  ];
  for (const [bb, teil] of neg) { const g = GRUND(z, bb); ok(typeof g === 'string' && g.includes(teil), `${JSON.stringify(bb)} → „${g}“`); }
  ok(alleOk(z, { typ: 'nachschub', an: 'ger', gut: 'T', menge: 5, hafen: '0904' }), 'hafen (eigener Hafen) ist erlaubt');
  const arm = klon(z); Object.assign(arm, { werte: z.werte, karte: z.karte }); arm.marken.ger = 3;
  ok((GRUND(arm, b) || '').includes('Marken reichen nicht'), 'ohne Marken kein Nachschub');
  // das Konkordat behält seine Reserve
  const knapp = klon(z); Object.assign(knapp, { werte: z.werte, karte: z.karte }); knapp.vorrat.kon.T = 12;
  ok(!alleOk(knapp, b) && alleOk(knapp, { typ: 'nachschub', an: 'ger', gut: 'T', menge: 9 }), 'das Konkordat behält kon_reserve (12 − 3 = 9 abgebbar)');
  // Schlüssel zum Krieg: mit Nachschub wird ein sonst gesperrter Angriff möglich
  const dürr = klon(z); Object.assign(dürr, { werte: z.werte, karte: z.karte }); dürr.vorrat.ger.T = 2;
  const ang = { typ: 'angreifen', fraktion: 'ger', ziel: '0403' };
  const plan = B.filtere(dürr, [ang]);
  ok(plan.gueltig.length === 0, 'ohne Treibstoff ist der Angriff gesperrt');
  const mitNach = B.filtere(dürr, [{ typ: 'nachschub', an: 'ger', gut: 'T', menge: 12 }, ang]);
  ok(mitNach.gueltig.length === 2, 'nach einem Nachschub von 12 geht derselbe Angriff durch (Treibstoff ≥ 10)');
});

section('Reihenfolge im Tick: erst die Wirtschaft, dann die Befehle', () => {
  // Der Befehl sieht den Stand NACH dem Handel des Ticks: das Konkordat verkauft erst an Rom und Germanen (sie sind knapp), dann prüft der Nachschub seinen Vorrat.
  const z = lage(); z.vorrat.kon.T = 12; z.vorrat.rom.T = 2; z.vorrat.ger.T = 2;
  const b = { typ: 'nachschub', an: 'ger', gut: 'T', menge: 9 };
  ok(alleOk(z, b), 'vor dem Tick ist der Nachschub gültig (12 − 3 Reserve = 9)');
  const r = tick1(z, [b]);
  ok(r.befehle.abgelehnt.length === 1 && /Konkordat hat nicht genug/.test(r.befehle.abgelehnt[0].grund) && r.befehle.angewandt.length === 0, 'im Tick lehnt der Kern ihn ab: der Handel hat dem Konkordat den Treibstoff schon abgenommen (Prüfung gegen den Stand nach der Wirtschaft)');
  ok(!r.ereignisse.some((e) => e.typ === 'konvoi' && e.handel && e.handel.ger && e.handel.ger.verkauf && e.handel.ger.verkauf.T === 9), 'und es entsteht kein Nachschub-Ereignis');
  // Die Standard-KI sieht die befohlenen Flotten als aktiv (Befehle vor ki): max_active gilt für beide gemeinsam
  const q = lage(); q.absichten = { ger: { max_active: 1, p_act: 1, aggr: 1 } };
  tick1(q, [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403' }]);
  ok(q.angriffe.filter((a) => a.von === 'ger' && a.art === 'reich').length === 1, 'bei max_active 1 startet die Standard-KI im selben Tick keinen zweiten Feldzug neben dem befohlenen (sie plant um ihn herum)');
  // Das Konkordat bekommt keine Ruhe
  const k = lage(); const rk = tick1(k, [{ typ: 'beanspruchen', fraktion: 'kon', sektor: '0503' }]);
  ok(rk.befehle.angewandt.length === 1 && (!('regie' in k) || !k.regie.kon), 'Ruhe gibt es nur für Rom und Germanen (das Konkordat führt keine Reichsangriffe)');
});

section('embargo', () => {
  const z = lage();
  const b = { typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['M', 'T', 'E'], dauer: 12 };
  ok(alleOk(z, b), 'Konkordat sperrt M, T, E gegen Rom für 12 Ticks: gültig');
  const z2 = klon(z); Object.assign(z2, { werte: z.werte, karte: z.karte });
  const r = tick1(z2, [b]);
  ok(z2.embargo && z2.embargo.rom && z2.embargo.rom.bis === z2.tick + 12 + 1 && z2.embargo.rom.from === z2.tick && z2.embargo.rom.waren.join('') === 'MTE', 'zustand.embargo.rom { waren, von, from, bis }');
  ok(r.ereignisse.some((e) => e.typ === 'embargo_verhaengt' && e.gegen === 'rom' && e.dauer === 12 && e.waren.join('') === 'MTE'), 'Ereignis embargo_verhaengt');
  // Wirkung: Rom kauft nichts mehr beim Konkordat (Vorrat M, T, E sinkt nur noch durch Verbrauch), die Germanen kaufen weiter
  const arm = klon(z); Object.assign(arm, { werte: z.werte, karte: z.karte }); arm.vorrat.rom.T = 2;   // Rom kauft Treibstoff, wenn es welchen braucht
  const ref = klon(arm); Object.assign(ref, { werte: z.werte, karte: z.karte });
  const z3 = klon(arm); Object.assign(z3, { werte: z.werte, karte: z.karte });
  tick1(z3, [b]); Kern.tick(ref);
  for (let i = 0; i < 10; i++) { Kern.tick(z3); Kern.tick(ref); }
  ok(z3.vorrat.rom.T < ref.vorrat.rom.T - 1 && z3.vorrat.kon.T > ref.vorrat.kon.T - 40, 'Rom hat mit Embargo weniger Treibstoff als ohne');
  // Ende von selbst
  let beendet = false, tickBeendet = null;
  for (let i = 0; i < 20 && !beendet; i++) { const e = Kern.tick(z2).ereignisse; if (e.some((x) => x.typ === 'embargo_beendet' && x.gegen === 'rom')) { beendet = true; tickBeendet = z2.tick; } }
  ok(beendet && !('embargo' in z2) && tickBeendet === 6 + 12 + 1, 'das Embargo endet von selbst (Ereignis embargo_beendet in Tick 19, zwölf Handels-Ticks 7 bis 18 sind gesperrt, Feld verschwindet, kein Dauerzustand)');
  // Nie wirksam nach dem Ende: Rom kauft wieder
  for (let i = 0; i < 6; i++) Kern.tick(z2);
  ok(!('embargo' in z2), 'danach bleibt kein Rest im Zustand');
  // K1: dauer zählt Handels-Ticks: genau dauer Ticks nach dem Befehl wirkt die Sperre
  const gz = klon(z); Object.assign(gz, { werte: z.werte, karte: z.karte });
  tick1(gz, [Object.assign({}, b, { dauer: 7 })]);
  let wirk = 0; for (let i = 0; i < 12; i++) { Kern.tick(gz); if (gz.embargo) wirk++; }
  ok(wirk === 7, 'Embargo mit dauer 7 sperrt genau sieben Handels-Ticks (gezählt: ' + wirk + ')');
  // Negativ
  const neg = [
    [{ typ: 'embargo', von: 'rom', gegen: 'ger', waren: ['T'], dauer: 5 }, 'nur das Konkordat'],
    [{ typ: 'embargo', von: 'kon', gegen: 'kon', waren: ['T'], dauer: 5 }, 'gegen muss'],
    [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: [], dauer: 5 }, 'waren:'],
    [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['N'], dauer: 5 }, 'waren:'],
    [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['T', 'T'], dauer: 5 }, 'waren:'],
    [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['T'], dauer: 0 }, 'dauer'],
    [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['T'], dauer: W.dauer.wert.embargo.max + 1 }, 'dauer'],
    [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['T'], dauer: 5.5 }, 'dauer'],
    [{ typ: 'embargo', von: 'kon', gegen: 'rom', waren: 'T', dauer: 5 }, 'waren:'],
  ];
  for (const [bb, teil] of neg) { const g = GRUND(z, bb); ok(typeof g === 'string' && g.includes(teil), `${JSON.stringify(bb)} → „${g}“`); }
  ok(alleOk(z2, b), 'nach dem Ende ist ein neues Embargo wieder möglich');
  const doppelt = B.filtere(z, [b, Object.assign({}, b, { waren: ['T'] })]);
  ok(doppelt.gueltig.length === 1 && /läuft schon/.test(doppelt.verworfen[0].grund), 'höchstens eine aktive Sanktion je Ziel-Fraktion');
  const beide = B.filtere(z, [b, Object.assign({}, b, { gegen: 'ger' })]);
  ok(beide.gueltig.length === 2, 'gegen verschiedene Ziele zugleich möglich (eine je Ziel)');
});

section('embargo: speichern und laden', () => {
  const z = lage();
  tick1(z, [{ typ: 'embargo', von: 'kon', gegen: 'ger', waren: ['T', 'M'], dauer: 25 }]);
  for (let i = 0; i < 5; i++) Kern.tick(z);
  ok(!!z.embargo && !!z.embargo.ger, 'Ausgangslage: Embargo läuft');
  // Weg des Spiels: abbild() lässt werte und karte weg, voll() holt sie aus den Dateien
  const gespeichert = JSON.parse(JSON.stringify(Kriegslage.abbild(z)));
  ok(gleich(gespeichert.embargo, z.embargo), 'abbild() trägt das Embargo (werte.embargo wäre verloren gegangen)');
  const voll = (() => { const a = Kriegslage.abbild(z); const frisch = Kern.erzeuge({ karte, werte, seed: 0 }); return Object.assign(JSON.parse(JSON.stringify(a)), { werte: frisch.werte, karte: frisch.karte }); })();
  const hz = (zz, k) => { const c = klon(zz.hexe); void c; const h = crypto.createHash('sha256'); for (let i = 0; i < k; i++) h.update(JSON.stringify(Kern.tick(zz).ereignisse)); const { werte: _w, karte: _k, ...rest } = zz; h.update(JSON.stringify(rest)); return h.digest('hex'); };
  const direkt = hz(z, 40);
  const nachLaden = hz(voll, 40);
  ok(direkt === nachLaden, 'speichern, laden, 40 Ticks = ohne Speichern 40 Ticks (Embargo überlebt, endet zur selben Zeit)');
  ok(!('embargo' in z) && !('embargo' in voll), 'beide Läufe sind danach embargo-frei');
  // Altstand ohne Felder
  const alt = Kriegslage.abbild(lage(7, 3)); ok(!('embargo' in alt) && !('regie' in alt), 'ein Zustand ohne Befehle trägt weder embargo noch regie im Abbild');
});

section('söldner', () => {
  const z = lage();
  const b = { typ: 'soeldner', von: 'kon', an: 'ger', flotten: [11], dauer: 10 };
  ok(alleOk(z, b), 'Konkordat vermietet die Flotte 11 an die Germanen für 10 Ticks: gültig');
  const z2 = klon(z); Object.assign(z2, { werte: z.werte, karte: z.karte });
  const ref = klon(z); Object.assign(ref, { werte: z.werte, karte: z.karte });
  Kern.tick(ref);
  const stark = flotte(z2, 11).staerke;
  const r = tick1(z2, [b]);
  const fl = flotte(z2, 11);
  const preis = Math.round(stark * 10 * W.soeldner.wert.preis_je_staerke_tick);
  ok(fl.fraktion === 'ger' && fl.miete && fl.miete.von === 'kon' && fl.miete.an === 'ger' && fl.miete.preis === preis && fl.miete.bis === z2.tick + 10 - 0, 'Flotte wechselt zu den Germanen, miete { von, an, bis, preis }');
  ok(Math.abs((ref.marken.ger - z2.marken.ger) - preis) < 1e-9 && Math.abs((z2.marken.kon - ref.marken.kon) - preis) < 1e-9, 'die Marken gehen vom Mieter an das Konkordat (' + preis + ')');
  ok(r.ereignisse.some((e) => e.typ === 'soeldner_vermietet' && e.fraktion === 'kon' && e.an === 'ger' && e.flotten === 1 && e.dauer === 10), 'Ereignis soeldner_vermietet');
  // Standard-KI setzt die Mietflotte nie ein (viele Läufe, aggressive Regler, viele Ticks)
  let eingesetzt = 0, gesehen = 0;
  for (let seed = 0; seed < 12; seed++) {
    const q = lage(seed, 3); q.absichten = { ger: { p_act: 1, aggr: 1, max_active: 5 }, rom: { p_act: 1, aggr: 1, max_active: 5 } }; q.marken.ger = 1000;
    tick1(q, [{ typ: 'soeldner', von: 'kon', an: 'ger', flotten: [11], dauer: 20 }]);
    for (let i = 0; i < 18; i++) { Kern.tick(q); const f = flotte(q, 11); if (f && f.miete) { gesehen++; if (f.befehl !== 'heim' || f.ort !== f.heimat) eingesetzt++; } }
  }
  ok(gesehen > 150 && eingesetzt === 0, `die Standard-KI setzt Mietflotten nie ein (${gesehen} Beobachtungen, ${eingesetzt} Einsätze, 12 Seeds, Regler am Anschlag)`);
  // Rückkehr
  let zurueck = false; for (let i = 0; i < 15 && !zurueck; i++) zurueck = Kern.tick(z2).ereignisse.some((e) => e.typ === 'soeldner_zurueck' && e.an === 'ger');
  ok(zurueck && fl.fraktion === 'kon' && !('miete' in fl), 'nach der Dauer dient die Flotte wieder dem Konkordat (Feld miete weg, Ereignis soeldner_zurueck)');
  // Miete endet, während die Flotte im Feld steht: sie kämpft nicht für das Konkordat weiter, sondern zieht sich zurück
  const feld = lage(); feld.absichten = { ger: { p_act: 0 } };
  tick1(feld, [{ typ: 'soeldner', von: 'kon', an: 'ger', flotten: [11], dauer: W.dauer.wert.soeldner.min }]);
  tick1(feld, [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [11, 16] }]);
  for (let i = 0; i < W.dauer.wert.soeldner.min; i++) Kern.tick(feld);
  ok(flotte(feld, 11).fraktion === 'kon' && !flotte(feld, 11).miete && ['rueckzug', 'heim'].includes(flotte(feld, 11).befehl) && flotte(feld, 11).ziel !== '0403', 'Miete endet mit der Flotte im Einsatz: sie kehrt zum Konkordat zurück und zieht sich zurück (kämpft nicht weiter)');
  const verl = lage(); tick1(verl, [{ typ: 'soeldner', von: 'kon', an: 'rom', flotten: [11], dauer: 10 }]);
  ok(/Mietflotten werden nicht verlegt/.test(GRUND(verl, { typ: 'verstaerken', fraktion: 'rom', flotte: 11, hafen: '0305' }) || ''), 'eine Mietflotte wird nicht verlegt (keine neue Heimat beim Mieter)');
  // Befohlener Angriff nimmt die Mietflotte nur mit flotten
  const q = lage(); tick1(q, [Object.assign({}, b, { dauer: 20 })]);
  const auto = B.filtere(q, [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403' }]);
  ok(auto.gueltig.length === 1, 'Angriff ohne flotten geht (mit den eigenen Flotten)');
  const q2 = klon(q); Object.assign(q2, { werte: q.werte, karte: q.karte }); tick1(q2, [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403' }]);
  ok(!q2.angriffe.filter((a) => a.befohlen).some((a) => a.flotten.includes(11)), 'ohne flotten wählt der Kern nie die Mietflotte');
  const fest = { typ: 'angreifen', fraktion: 'ger', ziel: '0403', flotten: [11, 16] };
  const fe = B.filtere(q, [fest]);
  ok(fe.gueltig.length === 1, 'mit flotten: [ids] nimmt der Angriff die Mietflotte: ' + (fe.verworfen[0] ? fe.verworfen[0].grund : 'gültig'));
  const q3 = klon(q); Object.assign(q3, { werte: q.werte, karte: q.karte }); tick1(q3, [fest]);
  ok(q3.angriffe.some((a) => a.befohlen && a.flotten.includes(11)) && flotte(q3, 11).angriff !== null, 'der Feldzug enthält die Mietflotte');
  // Keine Neubau-Subvention
  const arm = lage(); flotte(arm, 11).staerke = 6; tick1(arm, [Object.assign({}, b, { dauer: 20 })]);
  const s0 = flotte(arm, 11).staerke; for (let i = 0; i < 5; i++) Kern.tick(arm);
  ok(flotte(arm, 11).staerke <= s0 + 1e-9, 'der Mieter zahlt keinen Neubau für die Mietflotte (Stärke wächst nicht)');
  // Negativ
  const neg = [
    [{ typ: 'soeldner', von: 'rom', an: 'ger', flotten: [11], dauer: 10 }, 'nur das Konkordat'],
    [{ typ: 'soeldner', von: 'kon', an: 'kon', flotten: [11], dauer: 10 }, 'an muss'],
    [{ typ: 'soeldner', von: 'kon', an: 'ger', flotten: [11], dauer: 1 }, 'dauer'],
    [{ typ: 'soeldner', von: 'kon', an: 'ger', flotten: [], dauer: 10 }, 'flotten:'],
    [{ typ: 'soeldner', von: 'kon', an: 'ger', flotten: [11, 9, 13], dauer: 10 }, 'flotten:'],
    [{ typ: 'soeldner', von: 'kon', an: 'ger', flotten: [16], dauer: 10 }, 'keine freie Flotte des Konkordats'],
    [{ typ: 'soeldner', von: 'kon', an: 'ger', flotten: [999], dauer: 10 }, 'keine freie Flotte des Konkordats'],
    [{ typ: 'soeldner', von: 'kon', an: 'ger', flotten: [11, 11], dauer: 10 }, 'flotten:'],
  ];
  for (const [bb, teil] of neg) { const g = GRUND(z, bb); ok(typeof g === 'string' && g.includes(teil), `${JSON.stringify(bb)} → „${g}“`); }
  const arm2 = klon(z); Object.assign(arm2, { werte: z.werte, karte: z.karte }); arm2.marken.ger = 10;
  ok((GRUND(arm2, b) || '').includes('Marken reichen nicht'), 'ohne Marken keine Miete');
  const zweimal = B.filtere(z, [b, b]);
  ok(zweimal.gueltig.length === 1, 'dieselbe Flotte nicht zweimal');
  const drei = B.filtere(z, [{ typ: 'soeldner', von: 'kon', an: 'ger', flotten: [11, 9], dauer: 5 }, { typ: 'soeldner', von: 'kon', an: 'ger', flotten: [13], dauer: 5 }]);
  ok(drei.gueltig.length === 1 && /Mietflotten/.test(drei.verworfen[0].grund), 'höchstens aktiv_max_je_an Mietflotten je Mieter zugleich');
  // Embargo und Miete schließen sich aus
  const em = B.filtere(z, [{ typ: 'embargo', von: 'kon', gegen: 'ger', waren: ['T'], dauer: 5 }, b]);
  ok(em.gueltig.length === 1 && /Embargo/.test(em.verworfen[0].grund), 'unter Embargo vermietet das Konkordat nicht');
  const em2 = B.filtere(z, [{ typ: 'embargo', von: 'kon', gegen: 'ger', waren: ['T'], dauer: 5 }, { typ: 'nachschub', an: 'ger', gut: 'T', menge: 5 }]);
  ok(em2.gueltig.length === 1 && /Embargo/.test(em2.verworfen[0].grund), 'unter Embargo liefert das Konkordat keinen Nachschub (kein Umweg um die Sperre)');
});

section('söldner: speichern und laden', () => {
  const z = lage(); tick1(z, [{ typ: 'soeldner', von: 'kon', an: 'rom', flotten: [9], dauer: 15 }]);
  for (let i = 0; i < 4; i++) Kern.tick(z);
  const voll = (() => { const a = Kriegslage.abbild(z); const frisch = Kern.erzeuge({ karte, werte, seed: 0 }); return Object.assign(JSON.parse(JSON.stringify(a)), { werte: frisch.werte, karte: frisch.karte }); })();
  const lauf = (zz) => { const h = crypto.createHash('sha256'); for (let i = 0; i < 40; i++) h.update(JSON.stringify(Kern.tick(zz).ereignisse)); const { werte: _w, karte: _k, ...rest } = zz; h.update(JSON.stringify(rest)); return h.digest('hex'); };
  ok(flotte(voll, 9).miete && flotte(voll, 9).fraktion === 'rom', 'die Miete steht im Abbild');
  ok(lauf(z) === lauf(voll), 'speichern, laden, 40 Ticks: gleich (Rückkehr zur selben Zeit)');
});

section('piratenueberfall', () => {
  const z = lage();
  const ziele = z.hexe; void ziele;
  // ein Ort im Piratennetz mit Besitzer: Pulverhorn ist frei in dieser Lage, Hammerwerke gehören dem Konkordat; wir suchen einen gültigen
  const d = Kern.datenVon(z);
  const gueltig = d.codes.filter((c) => alleOk(z, { typ: 'piratenueberfall', ort: c }));
  ok(gueltig.length >= 1, 'es gibt gültige Ziele im Piratennetz: ' + gueltig.join(', '));
  const ort = gueltig[0];
  const z2 = klon(z); Object.assign(z2, { werte: z.werte, karte: z.karte });
  const zufall0 = z2.zufall;
  const r = tick1(z2, [{ typ: 'piratenueberfall', ort }]);
  void zufall0;
  ok(r.ereignisse.some((e) => e.typ === 'flotte_aufbruch' && e.art === 'raubzug' && e.fraktion === 'pirat' && e.ziel === ort), 'Ereignis flotte_aufbruch (raubzug) der Piraten');
  const rec = z2.angriffe.find((a) => a.art === 'pirat' && a.ziel === ort);
  ok(rec && rec.befohlen === true && rec.von === 'pirat', 'Feldzug art pirat, befohlen: true');
  let notruf = false; for (let i = 0; i < 12 && !notruf; i++) notruf = Kern.tick(z2).ereignisse.some((e) => e.typ === 'notruf' && e.art === 'piratenueberfall' && e.ort === ort);
  ok(notruf, 'die Piraten erreichen den Ort, der Notruf des Besitzers folgt (ohne Würfel gesetzt, von der Sim ausgeführt)');
  for (const [bb, teil] of [[{ typ: 'piratenueberfall', ort: '0602' }, 'gehört den Piraten'], [{ typ: 'piratenueberfall', ort: 'zz' }, 'unbekannter Ort'], [{ typ: 'piratenueberfall', ort: '0503' }, 'keinen Besitzer'], [{ typ: 'piratenueberfall', ort: '1004' }, 'keine bereite Piratenflotte'], [{ typ: 'piratenueberfall' }, 'unbekannter Ort']]) {
    const g = GRUND(z, bb); ok(typeof g === 'string' && g.includes(teil), `${JSON.stringify(bb)} → „${g}“`);
  }
  // zwei bereite Piratenflotten in Reichweite: derselbe Ort trotzdem nicht zweimal
  const beide = d.codes.find((c) => z.hexe[c].besitzer !== null && z.hexe[c].besitzer !== 'pirat' && z.flotten.filter((f) => f.fraktion === 'pirat' && d.distP[f.heimat][c] !== undefined && d.distP[f.heimat][c] <= W.piratenueberfall.wert.netz_sprunge).length >= 2);
  ok(!!beide, 'es gibt einen Ort, den zwei Piratenflotten erreichen (' + beide + ')');
  const doppelt = B.filtere(z, [{ typ: 'piratenueberfall', ort: beide }, { typ: 'piratenueberfall', ort: beide }]);
  ok(doppelt.gueltig.length === 1 && /läuft schon/.test(doppelt.verworfen[0].grund), 'derselbe Ort nicht zweimal (auch wenn eine zweite Flotte bereit wäre)');
  const schwach = klon(z); Object.assign(schwach, { werte: z.werte, karte: z.karte }); for (const f of schwach.flotten) if (f.fraktion === 'pirat') f.staerke = 0.5 * f.kap;
  ok((GRUND(schwach, { typ: 'piratenueberfall', ort }) || '').includes('keine bereite Piratenflotte'), 'angeschlagene Piratenflotten (unter 80 % ihrer Kapazität) sind nicht bereit');
});

section('keine Zufallszahl', () => {
  // Jeder Befehl des Katalogs ändert zustand.zufall nicht (der Haupt-Strom gehört der Standard-KI)
  const beispiele = [
    { typ: 'angreifen', fraktion: 'ger', ziel: '0403' }, { typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' }, { typ: 'verstaerken', fraktion: 'rom', flotte: 8, hafen: '0305' },
    { typ: 'nachschub', an: 'ger', gut: 'T', menge: 5 }, { typ: 'embargo', von: 'kon', gegen: 'rom', waren: ['T'], dauer: 5 }, { typ: 'soeldner', von: 'kon', an: 'ger', flotten: [11], dauer: 5 },
    { typ: 'fokus', fraktion: 'ger', hex: '0403', radius: 2, dauer: 6 }, { typ: 'regler', fraktion: 'rom', p_act: 0.3, dauer: 6 },
  ];
  const z = lage();
  const Daten2 = Kern.datenVon(z);
  const gueltigPirat = Daten2.codes.find((c) => alleOk(z, { typ: 'piratenueberfall', ort: c }));
  beispiele.push({ typ: 'piratenueberfall', ort: gueltigPirat });
  for (const b of beispiele) {
    const c = { z: klon(z), d: Daten2, w: z.werte, ev: [], mess: null, abgelehnt: [], angewandt: [] };
    Object.assign(c.z, { werte: z.werte, karte: z.karte });
    const ok0 = B.pruefeIn(c, b);
    const z0 = c.z.zufall;
    if (ok0.ok) B.KATALOG[b.typ].anwenden(c, b);
    ok(ok0.ok && c.z.zufall === z0, `${b.typ}: gültig und zieht keine Zufallszahl`);
  }
  const st = klon(z); Object.assign(st, { werte: z.werte, karte: z.karte });
  const quelltext = fs.readFileSync(path.join(__dirname, '..', 'server', 'weltsim', 'befehle.js'), 'utf8');
  ok(!/Zufall|Math\.random|Date\.now|require\('fs'\)/.test(quelltext.replace(/\/\/.*$/gm, '')), 'befehle.js benutzt weder den Zufallsstrom noch Math.random, Date.now oder Dateien (reiner Kern)');
});

section('fokus und regler', () => {
  const z = lage();
  const f = { typ: 'fokus', fraktion: 'ger', hex: '0403', radius: 2, dauer: 6 };
  ok(alleOk(z, f), 'Fokus der Germanen auf Speculum, Radius 2, 6 Ticks: gültig');
  const z2 = klon(z); Object.assign(z2, { werte: z.werte, karte: z.karte });
  tick1(z2, [f]);
  ok(z2.regie && z2.regie.ger && z2.regie.ger.fokus && z2.regie.ger.fokus.hex === '0403' && z2.regie.ger.fokus.radius === 2 && z2.regie.ger.fokus.bis === z2.tick + 6, 'zustand.regie.ger.fokus { hex, radius, bis }');
  ok(gleich(z2.absichten, {}), 'die Absichten (zustand.absichten) bleiben unberührt');
  for (let i = 0; i < 8; i++) Kern.tick(z2);
  ok(!('regie' in z2), 'der Fokus endet von selbst und räumt seinen Namensraum auf');
  for (const [bb, teil] of [[{ typ: 'fokus', fraktion: 'kon', hex: '0403', radius: 2, dauer: 6 }, 'fraktion muss'], [{ typ: 'fokus', fraktion: 'ger', hex: 'zz', radius: 2, dauer: 6 }, 'unbekanntes Hex'], [{ typ: 'fokus', fraktion: 'ger', hex: '0403', radius: 9, dauer: 6 }, 'radius'], [{ typ: 'fokus', fraktion: 'ger', hex: '0403', radius: 2, dauer: 99 }, 'dauer'], [{ typ: 'fokus', fraktion: 'ger', hex: '0403', radius: 2 }, 'dauer']]) {
    const g = GRUND(z, bb); ok(typeof g === 'string' && g.includes(teil), `${JSON.stringify(bb)} → „${g}“`);
  }
  const r = { typ: 'regler', fraktion: 'rom', p_act: 0.4, aggr: 0.7, max_active: 4, dauer: 8 };
  ok(alleOk(z, r), 'Regler für Rom: gültig');
  for (const [bb, teil] of [[{ typ: 'regler', fraktion: 'rom', dauer: 8 }, 'mindestens einer'], [{ typ: 'regler', fraktion: 'pirat', p_act: 0.3, dauer: 8 }, 'fraktion muss'], [{ typ: 'regler', fraktion: 'rom', p_act: 0.9, dauer: 8 }, 'p_act'], [{ typ: 'regler', fraktion: 'rom', aggr: 'viel', dauer: 8 }, 'aggr'], [{ typ: 'regler', fraktion: 'rom', max_active: 2.5, dauer: 8 }, 'max_active'], [{ typ: 'regler', fraktion: 'rom', max_active: 9, dauer: 8 }, 'max_active'], [{ typ: 'regler', fraktion: 'rom', p_act: 0.3, dauer: 0 }, 'dauer']]) {
    const g = GRUND(z, bb); ok(typeof g === 'string' && g.includes(teil), `${JSON.stringify(bb)} → „${g}“`);
  }
  // Wirksam
  const z3 = klon(z); Object.assign(z3, { werte: z.werte, karte: z.karte });
  tick1(z3, [r]);
  const w = B.wirksam(z3, 'rom');
  ok(w.p_act === 0.4 && w.aggr === 0.7 && w.max_active === 4 && w.fokus === null, 'wirksam(): die Regler der Regie gelten');
  ok(B.wirksam(z3, 'ger').p_act === z.werte.p_act && B.wirksam(z3, 'kon').max_active === z.werte.max_active.kon, 'andere Fraktionen unverändert (Werte)');
  for (let i = 0; i < 9; i++) Kern.tick(z3);
  ok(!('regie' in z3) && B.wirksam(z3, 'rom').p_act === z.werte.p_act, 'Regler enden von selbst');
});

section('Ruhe der Standard-KI nach einem befohlenen Angriff', () => {
  const RUHE = W.ruhe.wert;
  ok(RUHE.angreifen > 0 && RUHE.nachschub === 0 && RUHE.verstaerken === 0 && Object.keys(RUHE).every((k) => Object.prototype.hasOwnProperty.call(B.KATALOG, k) && Number.isInteger(RUHE[k]) && RUHE[k] >= 0 && RUHE[k] <= 300), 'Daten: Ruhe je Befehlstyp (der Angriff ersetzt Angriffe der KI; Nachschub und Verstärken lösen keine aus, das lähmte die Fraktion)');
  const z = lage();
  tick1(z, [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403' }]);
  ok(z.regie && z.regie.ger && z.regie.ger.ruhe_bis === z.tick + RUHE.angreifen && !z.regie.rom, 'der Angriff der Germanen setzt ruhe_bis für die Germanen, nicht für Rom');
  ok(B.wirksam(z, 'ger').aggr === 0 && B.wirksam(z, 'rom').aggr === z.werte.aggr, 'wirksam: aggr 0 für die Germanen, Rom unberührt');
  // Die Wahl der Crew gilt vor der Ruhe
  const c = klon(z); Object.assign(c, { werte: z.werte, karte: z.karte }); c.absichten = { ger: { aggr: 0.7 } };
  ok(B.wirksam(c, 'ger').aggr === 0.7, 'die Wahl der Crew (zustand.absichten) wird von der Ruhe nie überstimmt');
  ok(W.ruhe_max.wert > 0 && Object.entries(RUHE).every(([k, v]) => v <= W.ruhe_max.wert && v <= REGIE_DATEN.abkuehlung.wert[k]), 'Daten: keine Ruhe ist länger als ruhe_max oder als die Abkühlzeit ihres Befehls (der Spielleiter kann eine Fraktion nicht durch Schweigen stilllegen)');
  // Der Spielleiter gibt EINMAL einen Befehl und danach nichts mehr: die KI der Fraktion greift spätestens nach dem Ablauf der Ruhe wieder an
  let waehrend = 0, danach = 0, probiert = 0;
  for (let seed = 0; seed < 24; seed++) {
    const q = lage(seed, 3); q.regie = { ger: { p_act: 0.5, aggr: 0.9, regler_bis: 99999 } }; q.vorrat.ger.T = 300; q.vorrat.ger.U = 300;   // eifrige KI über die Regie (die Ruhe geht vor den Reglern der Regie)
    const r0 = tick1(q, [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403' }]);
    if (!r0.befehle.angewandt.length) continue;
    probiert++;
    const ende = q.regie.ger.ruhe_bis;
    const start = q.tick;
    for (let i = 0; i < RUHE.angreifen + 40; i++) {
      const bis = q.tick;
      for (const e of Kern.tick(q).ereignisse) if (e.fraktion === 'ger' && (e.typ === 'flotte_sammelt' || (e.typ === 'flotte_aufbruch' && e.art === 'angriff'))) { if (bis + 1 < ende) waehrend++; else danach++; }
    }
    if (q.regie && q.regie.ger && q.regie.ger.ruhe_bis !== undefined) waehrend += 1000;   // die Ruhe ist abgelaufen und weg
    if (ende > start + RUHE.angreifen) waehrend += 1000;
  }
  ok(probiert >= 10 && waehrend === 0 && danach > 0, `ein einziger Befehl, danach Schweigen: in der Ruhe beginnt die KI nichts (${waehrend}), danach greift sie wieder an (${danach} Angriffe in ${probiert} Läufen), die Ruhe räumt sich auf`);
  // Ruhe endet von selbst und räumt auf
  for (let i = 0; i < RUHE.angreifen + 2; i++) Kern.tick(z);
  ok(!('regie' in z) && B.wirksam(z, 'ger').aggr === z.werte.aggr, 'die Ruhe endet nach ruhe Ticks und räumt zustand.regie auf');
  // Messung: während der Ruhe beginnt die KI keine eigenen Reichsangriffe
  const std = (ruhe) => { let a = 0; for (let seed = 0; seed < 16; seed++) { const q = lage(seed, 3); q.absichten = { ger: { p_act: 0.5, aggr: 0.9 } }; if (ruhe) q.regie = { ger: { ruhe_bis: 9999 } }; q.vorrat.ger.T = 200; q.vorrat.ger.U = 200; for (let i = 0; i < 60; i++) for (const e of Kern.tick(q).ereignisse) if (e.fraktion === 'ger' && (e.typ === 'flotte_sammelt' || (e.typ === 'flotte_aufbruch' && e.art === 'angriff'))) a++; } return a; };
  ok(std(false) > 0, 'Gegenprobe: ohne Ruhe greift die Standard-KI der Germanen an');
  // mit Wahl der Crew gilt aggr 0,9 weiter: dort ändert die Ruhe nichts (absichten vor regie)
  const sr = (() => { let a = 0; for (let seed = 0; seed < 16; seed++) { const q = lage(seed, 3); q.regie = { ger: { ruhe_bis: 9999 } }; q.absichten = { ger: { p_act: 0.5 } }; q.vorrat.ger.T = 200; q.vorrat.ger.U = 200; for (let i = 0; i < 60; i++) for (const e of Kern.tick(q).ereignisse) if (e.fraktion === 'ger' && (e.typ === 'flotte_sammelt' || (e.typ === 'flotte_aufbruch' && e.art === 'angriff'))) a++; } return a; })();
  ok(sr === 0, 'unter Ruhe beginnt die Standard-KI der Germanen keine Reichsangriffe (60 Ticks, 16 Seeds, Munition und Treibstoff im Überfluss)');
  // Ruhe nur nach angenommenen Befehlen
  const ab = lage(); tick1(ab, [{ typ: 'angreifen', fraktion: 'ger', ziel: '0204' }]);
  ok(!('regie' in ab), 'ein abgelehnter Angriff setzt keine Ruhe');
  const nach = lage(); tick1(nach, [{ typ: 'nachschub', an: 'ger', gut: 'T', menge: 5 }]);
  ok(!('regie' in nach), 'Nachschub setzt keine Ruhe');
  const emb = lage(); tick1(emb, [{ typ: 'embargo', von: 'kon', gegen: 'ger', waren: ['T'], dauer: 6 }]);
  ok(emb.regie && emb.regie.ger && emb.regie.ger.ruhe_bis === emb.tick + RUHE.embargo && !emb.regie.rom, 'Embargo: die Ruhe trifft die Fraktion, gegen die es geht');
  const anspruch = lage(); tick1(anspruch, [{ typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' }]);
  ok(anspruch.regie && anspruch.regie.rom && anspruch.regie.rom.ruhe_bis === anspruch.tick + RUHE.beanspruchen, 'Anspruch: die Ruhe trifft die beanspruchende Fraktion');
  // bereinigung
  const b = lage(); b.regie = { ger: { ruhe_bis: 'x' }, rom: { ruhe_bis: 40 } }; B.bereinige(b);
  ok(!b.regie.ger && b.regie.rom && b.regie.rom.ruhe_bis === 40, 'Bereinigung: kaputtes ruhe_bis fällt weg, gültiges bleibt');
});

section('Crew vor Regie auch bei Befehlen', () => {
  const z = lage();
  const angriffRom = { typ: 'angreifen', fraktion: 'rom', ziel: '0803' }, claimRom = { typ: 'beanspruchen', fraktion: 'rom', sektor: '0503' };
  ok(alleOk(z, angriffRom) && alleOk(z, claimRom), 'ohne Absicht der Crew gehen beide Befehle für Rom durch');
  z.absichten = { rom: { p_act: 0.12, aggr: 0.4, max_active: 3 } };   // verteidigung
  ok(/Crew-Absicht aktiv/.test(GRUND(z, angriffRom) || '') && /Crew-Absicht aktiv/.test(GRUND(z, claimRom) || ''), 'Absicht „Die Grenze halten“ (aggr 0,4, p_act 0,12): Angriff und Anspruch für Rom werden abgelehnt (Grund: Crew-Absicht aktiv)');
  ok(alleOk(z, { typ: 'angreifen', fraktion: 'ger', ziel: '0403' }) && alleOk(z, { typ: 'beanspruchen', fraktion: 'ger', sektor: '0705' }), 'die Germanen sind nicht betroffen (die Crew spielt für Rom)');
  z.absichten = { rom: { p_act: 0.35, aggr: 0.1, max_active: 3 } };   // ausgreifen: viele Ansprüche, kaum Angriffe
  ok(/Crew-Absicht/.test(GRUND(z, angriffRom) || '') && alleOk(z, claimRom), 'Absicht „Neue Posten setzen“ (aggr 0,1, p_act 0,35): Angriffe gebremst, Ansprüche nicht');
  z.absichten = { rom: { p_act: 0.4, aggr: 0.7, max_active: 5 } };   // offensive
  ok(alleOk(z, angriffRom) && alleOk(z, claimRom), 'Absicht „Vorstoß“ (offensiver als die Werte): nichts wird gebremst');
  z.absichten = { rom: { aggr: 0.3 } }; z.regie = { rom: { aggr: 0.25 } };
  ok(alleOk(z, angriffRom), 'die Crew bremst nur, wenn ihr Wert unter dem liegt, der ohne sie gälte (Regie-Regler 0,25 gegen Crew 0,3)');
  const k = klon(z); Object.assign(k, { werte: z.werte, karte: z.karte }); k.absichten = { rom: { p_act: 0.12, aggr: 0.4 } }; k.regie = {};
  const r = tick1(k, [angriffRom]);
  ok(r.befehle.abgelehnt.length === 1 && /Crew-Absicht/.test(r.befehle.abgelehnt[0].grund), 'auch im Tick: der Befehl wird abgelehnt (wählt die Crew erst nach der Annahme)');
});

section('Schichtung: zustand.regie und zustand.absichten', () => {
  const z = lage();
  // Die Crew wählt eine Absicht (zustand.absichten.rom, wie absicht.js), die Regie überlagert Fokus und Regler (zustand.regie)
  z.absichten = { rom: { p_act: 0.35, aggr: 0.1, max_active: 3 } };
  tick1(z, [{ typ: 'fokus', fraktion: 'rom', hex: '0403', radius: 2, dauer: 10 }, { typ: 'regler', fraktion: 'rom', p_act: 0.12, aggr: 0.8, max_active: 1, dauer: 10 }]);
  const w = B.wirksam(z, 'rom');
  ok(w.p_act === 0.35 && w.aggr === 0.1 && w.max_active === 3, 'beide aktiv: die Wahl der Crew gilt für ihre Felder (sie wird nie überstimmt)');
  ok(w.fokus && w.fokus.hex === '0403', 'beide aktiv: der Fokus der Regie gilt zusätzlich (die Wahl der Crew setzt keinen)');
  ok(z.regie.rom.p_act === 0.12 && z.absichten.rom.p_act === 0.35, 'beide Namensräume bleiben getrennt');
  // Rückbau der Absicht (wie absicht.js wirkungRaeumen): die Regie steht weiter
  delete z.absichten.rom;
  const w2 = B.wirksam(z, 'rom');
  ok(w2.p_act === 0.12 && w2.aggr === 0.8 && w2.max_active === 1 && w2.fokus && w2.fokus.radius === 2, 'Rückbau der Absicht: die Regler und der Fokus der Regie gelten unverändert weiter');
  // Rückbau der Regie: die Absicht steht weiter
  z.absichten.rom = { p_act: 0.35, aggr: 0.1, max_active: 3 };
  B.regieRaeumen(z);
  const w3 = B.wirksam(z, 'rom');
  ok(w3.p_act === 0.35 && w3.fokus === null && 'rom' in z.absichten && !('regie' in z), 'Rückbau der Regie: die Absicht der Crew steht unverändert');
  // Tick überschreibt zustand.absichten NICHT durch Befehle (nur tick({absichten}) tut das: das ist der Weg des Aufrufers)
  tick1(z, [{ typ: 'regler', fraktion: 'rom', p_act: 0.2, dauer: 5 }]);
  ok(z.absichten.rom.p_act === 0.35 && z.regie.rom.p_act === 0.2, 'ein Befehl schreibt nie nach zustand.absichten');
  // Die Standard-KI liest wirklich wirksam(): Regler p_act 0 zählt nicht (Grenze), p_act am Minimum senkt die Aktionen
  const zaehle = (regie) => { let a = 0; for (let seed = 0; seed < 12; seed++) { const q = lage(seed, 3); if (regie) q.regie = klon(regie); for (let i = 0; i < 120; i++) for (const e of Kern.tick(q).ereignisse) if (e.fraktion === 'rom' && e.typ === 'flotte_aufbruch') a++; } return a; };
  const ohne = zaehle(null), mit = zaehle({ rom: { p_act: 0.1, regler_bis: 9999 } });
  ok(mit < ohne, `die Standard-KI liest die Überlagerung (Aktionen von Rom mit p_act 0,1: ${mit}, ohne: ${ohne})`);
});

section('Fokus lenkt die Angriffe', () => {
  // Messung der Erkundung: +29 % Angriffs-Aufbrüche im Umkreis, Gesamtzahl gleich (Germanen p_act 0,5, aggr 0,9)
  const d = Kern.datenVon(Kern.erzeuge({ karte, werte, seed: 0 }));
  const lauf = (fokus) => {
    let nah = 0, ges = 0;
    for (let seed = 0; seed < 20; seed++) {
      const z = Kern.erzeuge({ karte, werte, seed }); z.absichten = { ger: { p_act: 0.5, aggr: 0.9 } };
      if (fokus) z.regie = { ger: { fokus: { hex: '0403', radius: 2, bis: 9999 } } };
      for (let i = 0; i < 200; i++) for (const e of Kern.tick(z).ereignisse) {
        if (e.fraktion === 'ger' && (e.typ === 'flotte_sammelt' || (e.typ === 'flotte_aufbruch' && e.art === 'angriff'))) { ges++; if (Daten.abstand(d, e.ziel, '0403') <= 2) nah++; }
      }
    }
    return { nah, ges };
  };
  const a = lauf(false), b = lauf(true);
  ok(b.nah > a.nah * 1.1, `Angriffe der Germanen im Umkreis 2 von Speculum: ${a.nah} → ${b.nah} (mindestens +10 %)`);
  ok(b.ges <= a.ges * 1.25 && b.ges >= a.ges * 0.6, `die Gesamtzahl bleibt in der Größenordnung (${a.ges} → ${b.ges}): gezielter, nicht mehr`);
  ok(b.nah / Math.max(1, b.ges) > a.nah / Math.max(1, a.ges), 'der Anteil der Angriffe im Umkreis steigt');
});

section('Bereinigung geladener Daten', () => {
  const z = lage();
  z.embargo = { rom: { waren: 'T', from: 1, bis: 9 }, ger: { waren: ['T', 'X'], from: 1, bis: 20 }, kon: { waren: ['T'], from: 1, bis: 5 } };
  z.regie = { rom: { p_act: 'viel', regler_bis: 5, fokus: { hex: 'zz', radius: 2, bis: 9 } }, ger: { fokus: { hex: '0403', radius: 2, bis: 30 }, p_act: 0.3, regler_bis: 12 }, pirat: 7 };
  flotte(z, 9).miete = { von: 'kon', an: 'pirat', bis: 'x', preis: 3 };
  flotte(z, 11).miete = { von: 'kon', an: 'rom', bis: 30, preis: 12 }; flotte(z, 11).fraktion = 'rom';
  B.bereinige(z);
  ok(Object.keys(z.embargo).join() === 'ger' && z.embargo.ger.waren.join() === 'T', 'Embargo: nur Gültiges bleibt (waren gefiltert, falsche Fraktion und Müll fallen weg)');
  ok(Object.keys(z.regie).join() === 'ger' && z.regie.ger.fokus.hex === '0403' && z.regie.ger.p_act === 0.3, 'Regie: nur Gültiges bleibt');
  ok(!('miete' in flotte(z, 9)) && flotte(z, 11).miete.an === 'rom', 'Miete: Müll fällt weg, Gültiges bleibt');
  let wirft = false; try { for (let i = 0; i < 5; i++) Kern.tick(z); } catch (e) { wirft = true; }
  ok(!wirft, 'ein Tick über bereinigte Daten wirft nicht');
  // Klemmen, Fraktionen, Null-Einträge, Miete ohne passende Fraktion
  const k = lage(); const t = k.tick;
  k.embargo = { rom: { waren: ['T', 'T', 'M'], von: 'x', from: 99999, bis: 99999999 } };
  k.regie = { rom: { p_act: 7, aggr: -3, max_active: 99.4, regler_bis: 9999999, ruhe_bis: 9999999, fokus: { hex: '0403', radius: 99, bis: 9999999 } }, ger: null, kon: { fokus: { hex: '0403', radius: 1, bis: 9 } }, zzz: { p_act: 0.2, regler_bis: 9 } };
  flotte(k, 11).fraktion = 'ger'; flotte(k, 11).miete = { von: 'kon', an: 'rom', bis: 30, preis: 5 };   // Fraktion passt nicht zum Mieter
  flotte(k, 9).fraktion = 'rom'; flotte(k, 9).miete = { von: 'kon', an: 'rom', bis: 99999, preis: 5 };
  B.bereinige(k);
  const e = k.embargo.rom, r = k.regie.rom;
  ok(e.waren.join('') === 'TM' && e.von === 'kon' && e.from <= t && e.bis <= t + W.dauer.wert.embargo.max + 1, 'Embargo: doppelte Waren weg, von auf kon, Zeiten auf höchstens Tick + größte Dauer geklemmt');
  ok(r.p_act === W.regler.wert.p_act.max && r.aggr === W.regler.wert.aggr.min && r.max_active === W.regler.wert.max_active.max, 'Regler auf die Bereiche aus den Daten geklemmt (und max_active ganzzahlig)');
  ok(r.regler_bis <= t + W.dauer.wert.regler.max && r.ruhe_bis <= t + W.ruhe_max.wert && r.fokus.radius === W.fokus.wert.radius.max && r.fokus.bis <= t + W.dauer.wert.fokus.max, 'regler_bis, ruhe_bis, Fokus-Radius und Fokus-Ende geklemmt');
  ok(!('ger' in k.regie) && !('zzz' in k.regie) && !(k.regie.kon && k.regie.kon.fokus), 'null als Eintrag, unbekannte Fraktion und ein Fokus für das Konkordat fallen weg');
  ok(!('miete' in flotte(k, 11)) && flotte(k, 9).miete.bis <= t + W.dauer.wert.soeldner.max, 'Miete nur, wenn die Fraktion der Flotte zum Mieter passt; das Ende ist geklemmt');
  const nul = lage(); nul.regie = { rom: null }; B.bereinige(nul);
  ok(!('regie' in nul), 'regie: { rom: null } wird verworfen (wirft nicht)');
  const leer = lage(); leer.embargo = 'x'; leer.regie = []; B.bereinige(leer);
  ok(!('embargo' in leer) && !('regie' in leer), 'Unsinn als ganzes Feld: das Feld verschwindet');
});

console.log(`\n${n - fails}/${n} bestanden`);
if (fails) { console.log('BEFEHLE: ' + fails + ' FEHLER'); process.exit(1); }
console.log('BEFEHLE OK');
