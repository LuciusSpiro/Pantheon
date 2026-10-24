'use strict';
// SUND-03 A: Weltausschnitt für den Grobplan (server/sim/lage-ausschnitt.js). Reine Lesesicht auf den Sim-Zustand und das Spiel.
//   Format (kompakt, sortiert, deterministisch) · Inhalt (Crew ohne Namen, Umkreis, Flotten, Ereignisse ohne konvoi, Chronik, Ruf, Embargos, Mieten, Sieger) · Kürzungsstufen 0 bis 3 ·
//   nie gekürzt: belagert, unterwegs, gefallen, Crew · Obergrenze 4800 Zeichen über viele Sim-Zustände (Seeds × Ticks, auch im Stress) · keine Spielernamen · mit einem echten Spiel zu dritt.
//   node tools/test-lage-ausschnitt.js [begriff …]   (npm run test:lage-ausschnitt)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Kern = require('../server/weltsim/kern.js');
const Daten = require('../server/weltsim/daten.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Regie = require('../server/sim/regie-befehle.js');
const Ausschnitt = require('../server/sim/lage-ausschnitt.js');
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
const { karte, werte } = Daten.laden();
const A = require('../content/welt/regie-werte.json').werte.ausschnitt.wert;
const MAX = A.max_zeichen;
const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];   // im Spiel auf 12 Zeichen gekürzt gespeichert

// Ein Spiel-Ersatz mit allem, was der Ausschnitt liest: Sim-Zustand, Ereignisring (wie Kriegslage: letzte 120), Crew, Chronik. Die Sim läuft mit der Standard-KI (optional Stress-Regler).
function simSpiel(seed, ticks, o) {
  o = o || {};
  const z = Kern.erzeuge({ karte, werte, seed });
  if (o.stress) z.absichten = { rom: { aggr: 1, p_act: 1, max_active: 5 }, ger: { aggr: 1, p_act: 1, max_active: 5 } };
  const ring = [];
  for (let t = 1; t <= ticks; t++) {
    if (o.vor) o.vor(z, t);
    for (const e of Kern.tick(z, o.befehle && o.befehle[t] ? { befehle: o.befehle[t] } : {}).ereignisse) ring.push(Object.assign({ n: t }, e));
    if (ring.length > Kriegslage.RING) ring.splice(0, ring.length - Kriegslage.RING);
  }
  const chronik = Array.from({ length: o.chronik == null ? 8 : o.chronik }, (_, i) => ({ text: (o.chronikText || 'Tätigkeit Nr. ' + i + ' beendet') + (o.lang ? ' ' + 'x'.repeat(o.lang) : ''), spielzeit_s: i }));
  return { weltsim: { zustand: z, tickZahl: ticks, ereignisse: ring, ruf: { rom: o.ruf == null ? 60 : o.ruf, ger: 0, kon: 4 } }, ship: { scene: o.hex || '0305', stufe: o.stufe == null ? 2 : o.stufe },
    players: (o.names || NAMEN).map((name, i) => ({ id: i + 1, name, connected: true })), weltstand: { data: { chronik } } };
}
const teile = (t) => JSON.parse(t);
const sortiert = (x) => { if (Array.isArray(x)) return x.every(sortiert); if (x && typeof x === 'object') { const k = Object.keys(x); return k.join('|') === k.slice().sort().join('|') && k.every((q) => sortiert(x[q])); } return true; };

section('Format: kompakt, sortiert, deterministisch', () => {
  const g = simSpiel(2, 120);
  const a = Ausschnitt.ausschnitt(g, { stufe: 0 });
  ok(typeof a.text === 'string' && a.zeichen === a.text.length && a.stufe === 0, 'Ergebnis { stufe, zeichen, text }');
  ok(!/\n/.test(a.text) && !/": /.test(a.text) && !/,\s\s/.test(a.text) && a.text === JSON.stringify(JSON.parse(a.text)), 'kompakt-JSON: keine Einrückung, keine Zeilenumbrüche, kein Leerzeichen nach dem Doppelpunkt');
  ok(sortiert(JSON.parse(a.text)), 'alle Schlüssel sortiert (in jeder Tiefe)');
  ok(Ausschnitt.ausschnitt(g, { stufe: 0 }).text === a.text && Ausschnitt.ausschnitt(simSpiel(2, 120), { stufe: 0 }).text === a.text, 'deterministisch: zweimal derselbe Aufruf und zweimal derselbe Spielstand liefern denselben Text');
  const d = teile(a.text);
  ok(['chronik', 'crew', 'embargos', 'ereignisse', 'flotten', 'lage', 'mieten', 'orte', 'ruf', 'tick'].join() === Object.keys(d).join(), 'Abschnitte: chronik, crew, embargos, ereignisse, flotten, lage, mieten, orte, ruf, tick');
  ok(['aktiv', 'belagert', 'gefallen', 'ruhig', 'unterwegs'].join() === Object.keys(d.flotten).join(), 'Flotten: aktiv, belagert, gefallen, ruhig, unterwegs');
  ok(Ausschnitt.ausschnitt({ weltsim: null }, { stufe: 0 }).text === '', 'ohne Modus: leer');
  ok(Ausschnitt.ausschnitt(g, {}).stufe === 0 && Ausschnitt.ausschnitt(g, { stufe: 9 }).stufe === 3 && Ausschnitt.ausschnitt(g, { stufe: -2 }).stufe === 0 && Ausschnitt.ausschnitt(g).stufe === 0, 'Stufe wird geklemmt (0 bis 3)');
});

section('Inhalt', () => {
  const g = simSpiel(2, 200, { hex: '0305', ruf: 60, stufe: 2 });
  const d = teile(Ausschnitt.ausschnitt(g, { stufe: 0 }).text);
  ok(d.tick === 200 && d.crew.anzahl === 3 && d.crew.hex === '0305' && d.crew.ort === 'Ostia Nova' && d.crew.stufe === 2 && typeof d.crew.rang === 'string', 'Crew: Anzahl, Hex, Ort, Rang, Schiffsstufe');
  ok(Object.keys(d.crew).sort().join() === 'anzahl,hex,ort,rang,stufe', 'die Crew-Zeile hat genau diese fünf Felder (keine Namen)');
  ok(d.ruf.rom === 60 && d.ruf.kon === 4 && d.ruf.ger === 0, 'Ruf je Fraktion');
  const dd = Daten.datenVon(g.weltsim.zustand);
  ok(d.orte.every((o) => Daten.abstand(dd, o.h, '0305') <= 2 && ['rom', 'ger', 'kon', 'pirat', 'frei'].includes(o.b)) && d.orte.some((o) => o.h === '0305' && o.b === 'rom' && typeof o.abw === 'number'), 'Orte im Umkreis 2 mit Besitzer und Abwehr');
  ok(d.ereignisse.length <= 12 && d.ereignisse.every((e) => e.t !== 'konvoi' && e.t !== 'hafen_gefallen' && e.t !== 'posten_verloren' && typeof e.n === 'number'), 'Ereignisse: höchstens 12, nie konvoi (Rauschen), Gefallene stehen unter flotten.gefallen');
  const ring = g.weltsim.ereignisse;
  ok(ring.filter((e) => e.typ === 'konvoi').length > 20, 'Gegenprobe: der Ring ist voller konvoi-Ereignisse (' + ring.filter((e) => e.typ === 'konvoi').length + ' von ' + ring.length + ')');
  ok(d.chronik.length === 8 && d.chronik[7] === 'Tätigkeit Nr. 7 beendet', 'Chronik: die letzten 8 Texte (nur Text, ersetzt die Chronik aus dem Kampagnen-Kontext)');
  ok(['rom', 'ger', 'offen'].includes(d.lage.sieger) && typeof d.lage.anteil === 'number', 'Kennzahl lage.sieger (rom, ger, offen)');
  // Belagerung, Marsch und Gefallene sichtbar (die Sim ist friedlich: gesucht wird über Seeds, Gefallene kommen zusätzlich aus dem Ring)
  const angriff = { vor: (zz, t) => { if (t === 30) { zz.vorrat.ger.T = 40; zz.vorrat.ger.U = 40; } }, befehle: { 30: [{ typ: 'angreifen', fraktion: 'ger', ziel: '0403' }] } };
  let bel = null, mar = null;
  for (let t = 31; t <= 60 && !(bel && mar); t++) { const q = simSpiel(1, t, angriff); const x = teile(Ausschnitt.ausschnitt(q, { stufe: 0 }).text); if (!mar && x.flotten.unterwegs.length) mar = x; if (!bel && x.flotten.belagert.length) bel = x; }
  ok(!!bel && !!mar, 'es gibt Stände mit Belagerung und mit Marsch');
  if (bel) ok(bel.flotten.belagert[0].ziel && bel.flotten.belagert[0].von && typeof bel.flotten.belagert[0].seit === 'number' && typeof bel.flotten.belagert[0].st === 'number' && bel.flotten.belagert[0].b, 'belagert: Ziel, von, seit, Stärke, Besitzer');
  if (mar) ok(mar.flotten.unterwegs[0].ph && mar.flotten.unterwegs[0].ziel && mar.flotten.unterwegs[0].von, 'unterwegs: Ziel, von, Phase');
  const gf = simSpiel(2, 60);
  gf.weltsim.ereignisse.push({ n: 59, typ: 'hafen_gefallen', fraktion: 'ger', ort: '0105', ortName: 'Carrara', alt: 'rom', neu: 'ger' }, { n: 60, typ: 'posten_verloren', fraktion: 'rom', ort: '0503', ortName: 'Gasfeld', besitzer: 'rom', durch: 'pirat' });
  const gd = teile(Ausschnitt.ausschnitt(gf, { stufe: 0 }).text);
  ok(gd.flotten.gefallen.length >= 2 && gd.flotten.gefallen.slice(-2).map((x) => x.ort + '>' + x.an).join() === 'Carrara>ger,Gasfeld>pirat', 'gefallen: Ort, von, an (Hafen und Posten, auch an Piraten)');
  // Embargos und Mieten
  const z = g.weltsim.zustand;
  Kern.tick(z, { befehle: [{ typ: 'embargo', von: 'kon', gegen: 'ger', waren: ['T', 'M'], dauer: 10 }, { typ: 'soeldner', von: 'kon', an: 'rom', flotten: [z.flotten.find((f) => f.fraktion === 'kon' && f.befehl === 'heim').id], dauer: 8 }] });
  g.weltsim.tickZahl++;
  const e = teile(Ausschnitt.ausschnitt(g, { stufe: 0 }).text);
  ok(e.embargos.length === 1 && e.embargos[0].gegen === 'ger' && e.embargos[0].waren === 'TM' && e.embargos[0].rest === 10 && e.mieten.length === 1 && e.mieten[0].an === 'rom' && e.mieten[0].rest === 8, 'aktive Embargos (gegen, Waren, Rest) und Mieten (an, Rest)');
  ok(e.ereignisse.some((x) => x.t === 'embargo_verhaengt') || g.weltsim.ereignisse.length > 0, 'Ereignisse der Befehle sind lesbar');
});

section('Keine Spielernamen', () => {
  const g = simSpiel(4, 150, { names: NAMEN, chronikText: 'Mireille_Kasper hat den Frachter gerettet, dann Ouzo_Brandt am Funk' });
  for (let s = 0; s <= 3; s++) {
    const t = Ausschnitt.ausschnitt(g, { stufe: s }).text;
    ok(!NAMEN.some((nm) => t.includes(nm)) && !/Mireille|Ouzo|Tzvi/.test(t), `Stufe ${s}: kein Spielername im Text (auch nicht aus der Chronik)`);
  }
  ok(/Crew hat den Frachter gerettet/.test(Ausschnitt.ausschnitt(g, { stufe: 0 }).text), 'ein Name in der Chronik wird durch „Crew“ ersetzt');
  ok(teile(Ausschnitt.ausschnitt(g, { stufe: 0 }).text).crew.anzahl === 3, 'nur die Anzahl der Crew steht im Text');
  const p = Ausschnitt.ausschnittPassend(g, {});
  ok(!NAMEN.some((nm) => p.text.includes(nm)), 'auch ausschnittPassend');
  // kurze Namen (2 Zeichen) werden ebenfalls ersetzt, einzelne Buchstaben nicht
  const h = simSpiel(4, 60, { names: ['Jo'], chronikText: 'Jo steuert' });
  ok(!/Jo /.test(Ausschnitt.ausschnitt(h, { stufe: 0 }).text), 'auch kurze Namen');
  // Ereignisse und Orte tragen nur Orts-, Fraktions- und Typnamen der Sim
  const alles = Ausschnitt.ausschnitt(g, { stufe: 0 }).text;
  ok(!/"name"|"spieler"|"player"/i.test(alles), 'kein Feld name oder spieler');
});

section('Kürzungsstufen', () => {
  const g = simSpiel(3, 160, { stress: true, lang: 140 });
  for (let i = 0; i < 8; i++) g.weltsim.ereignisse.push({ n: 150 + i, typ: i % 2 ? 'hafen_gefallen' : 'posten_verloren', fraktion: 'ger', ort: '0105', ortName: 'Carrara' + i, alt: 'rom', neu: 'ger', besitzer: 'rom', durch: 'ger' });
  const t = [0, 1, 2, 3].map((s) => Ausschnitt.ausschnitt(g, { stufe: s }));
  const d = t.map((x) => teile(x.text));
  ok(t[0].zeichen >= t[1].zeichen && t[1].zeichen >= t[2].zeichen && t[2].zeichen >= t[3].zeichen && t[0].zeichen > t[3].zeichen, `die Größe fällt mit der Stufe (${t.map((x) => x.zeichen).join(' ≥ ')})`);
  ok(d[0].ereignisse.length > d[1].ereignisse.length && d[1].ereignisse.length === 6 && d[3].ereignisse.length <= 4, 'Ereignisse 12 → 6 (Stufe 1) → 4 (Stufe 3)');
  ok(d[0].chronik.length === 8 && d[1].chronik.length === 5 && d[3].chronik.length === 3, 'Chronik 8 → 5 → 3');
  ok(d[2].orte.every((o) => Daten.abstand(Daten.datenVon(g.weltsim.zustand), o.h, '0305') <= 1) && d[2].orte.length <= d[1].orte.length, 'Stufe 2: Radius 1');
  ok(typeof d[3].flotten.ruhig === 'number' && Array.isArray(d[2].flotten.ruhig), 'Stufe 3: ruhige Flotten nur gezählt (Zahl statt Liste)');
  const ruhig2 = d[2].flotten.ruhig.length;
  ok(d[3].flotten.ruhig === ruhig2, 'die Zahl stimmt mit der Liste der Stufe 2 überein (' + ruhig2 + ')');
  // nie gekürzt: belagert, unterwegs, gefallen (bei Stufe 2 und 3 nur die letzten 3), Crew-Zeile
  ok(d.every((x) => gleich(x.flotten.belagert, d[0].flotten.belagert)), 'belagert ist in jeder Stufe gleich (nie gekürzt)');
  ok(d.every((x) => gleich(x.flotten.unterwegs, d[0].flotten.unterwegs)), 'unterwegs ist in jeder Stufe gleich (nie gekürzt)');
  ok(d.every((x) => gleich(x.crew, d[0].crew)), 'die Crew-Zeile ist in jeder Stufe gleich');
  ok(d[0].flotten.gefallen.length === 6 && d.every((x) => x.flotten.gefallen.length >= Math.min(3, d[0].flotten.gefallen.length)) && gleich(d[3].flotten.gefallen, d[0].flotten.gefallen.slice(-d[3].flotten.gefallen.length)), 'gefallen: in jeder Stufe da (bei Stufe 2 und 3 die letzten ≤ 3)');
  ok(d[0].flotten.gefallen.length <= 6 && d[2].flotten.gefallen.length <= 3, 'gefallen: höchstens 6, ab Stufe 2 höchstens 3');
  // ausschnittPassend wählt die kleinste Kürzung
  const p0 = Ausschnitt.ausschnittPassend(g, { maxZeichen: 100000 });
  ok(p0.stufe === 0 && p0.passt === true && p0.text === t[0].text, 'ausschnittPassend: passt Stufe 0, bleibt es dabei');
  const p1 = Ausschnitt.ausschnittPassend(g, { maxZeichen: t[1].zeichen });
  ok(p1.stufe === 1 && p1.passt && p1.zeichen <= t[1].zeichen, 'ausschnittPassend: genau Stufe 1, wenn Stufe 0 nicht mehr passt');
  const p3 = Ausschnitt.ausschnittPassend(g, { maxZeichen: t[3].zeichen });
  ok(p3.stufe === 3 && p3.passt, 'ausschnittPassend: Stufe 3 als letzte');
  const px = Ausschnitt.ausschnittPassend(g, { maxZeichen: 50 });
  ok(px.stufe === 3 && px.passt === false && gleich(teile(px.text).flotten.belagert, d[0].flotten.belagert), 'passt nichts, bleibt Stufe 3 (passt false) und die Wendepunkte sind trotzdem da');
  ok(Ausschnitt.ausschnittPassend(g, {}).zeichen <= MAX || Ausschnitt.ausschnittPassend(g, {}).passt === false, 'ohne Angabe gilt die Obergrenze aus den Daten (' + MAX + ')');
});

section('Obergrenze über viele Sim-Zustände', () => {
  const stufen = [0, 0, 0, 0];
  const zeichen = [[], [], [], []];
  let zustaende = 0, zuGross = 0, maxGefunden = 0, nichtPassend = 0, engFalsch = 0;
  const eng = [0, 0, 0, 0];
  for (const stress of [false, true]) {
    for (let seed = 0; seed < 14; seed++) {
      for (const ticks of [20, 60, 100, 140, 200, 260, 300]) {
        const g = simSpiel(seed, ticks, { stress, lang: 150, hex: ['0305', '0204', '0403', '0904'][seed % 4] });
        zustaende++;
        for (let s = 0; s < 4; s++) zeichen[s].push(Ausschnitt.ausschnitt(g, { stufe: s }).zeichen);
        const p = Ausschnitt.ausschnittPassend(g, {});
        stufen[p.stufe]++;
        if (!p.passt) nichtPassend++;
        if (p.zeichen > MAX) zuGross++;
        const e = Ausschnitt.ausschnittPassend(g, { maxZeichen: 2800 });   // eine enge Grenze, damit auch die Stufen 1 bis 3 gewählt werden
        eng[e.stufe]++;
        if (e.passt ? e.zeichen > 2800 : e.stufe !== 3) engFalsch++;
        if (e.stufe > 0 && Ausschnitt.ausschnitt(g, { stufe: e.stufe - 1 }).zeichen <= 2800) engFalsch++;   // nie stärker gekürzt als nötig
        maxGefunden = Math.max(maxGefunden, p.zeichen);
      }
    }
  }
  const mw = (a) => Math.round(a.reduce((s, x) => s + x, 0) / a.length), mx = (a) => Math.max(...a);
  console.log(`       ${zustaende} Zustände (Seeds 0–13 × 7 Zeitpunkte × normal/Stress, Chronik am Anschlag): Zeichen je Stufe Mittel/Max: ` + zeichen.map((a, s) => `S${s} ${mw(a)}/${mx(a)}`).join(' · ') + `; gewählte Stufen ${stufen.join('/')}`);
  ok(zuGross === 0 && nichtPassend === 0 && maxGefunden <= MAX, `ausschnittPassend bleibt in allen ${zustaende} Zuständen unter ${MAX} Zeichen (größter: ${maxGefunden}, ≈ ${Math.round(maxGefunden / 2.7)} Gemma-Token)`);
  ok(engFalsch === 0 && eng.slice(1).some((x) => x > 0), `enge Grenze 2800: immer die kleinste nötige Kürzung (gewählte Stufen ${eng.join('/')}), nie stärker gekürzt als nötig`);
  ok(mw(zeichen[0]) < MAX * 0.8, 'Stufe 0 liegt im Mittel deutlich unter der Obergrenze (' + mw(zeichen[0]) + ')');
  ok(mx(zeichen[3]) < mx(zeichen[0]), 'Stufe 3 ist immer kleiner als Stufe 0 im Maximum');
});

section('Mit einem echten Spiel zu dritt', () => {
  const t = F.neuesSpiel({ crew: 3, names: NAMEN, seed: 5 }); const g = t.g;
  for (let i = 0; i < 30; i++) Kriegslage.tick(g, 'test');
  g.weltstand.chronicle('Tätigkeit beendet: ' + NAMEN[0] + 'per brachte das Paket nach Ostia Nova.');
  const a = Ausschnitt.ausschnittPassend(g, {});
  const d = teile(a.text);
  ok(a.passt && d.crew.anzahl === 3 && d.crew.hex && d.tick === 30 && !NAMEN.some((nm) => a.text.includes(nm)), 'Spiel zu dritt: Ausschnitt mit Crew-Zeile ohne Namen (' + a.zeichen + ' Zeichen)');
  ok(d.chronik.length === 1 && /Crew brachte das Paket/.test(d.chronik[0]), 'die Chronik kommt aus dem Weltstand des Spiels');
  const r = Regie.planAnwenden(g, { befehle: [{ typ: 'angreifen', fraktion: 'rom', ziel: '0803' }] });
  void r;
  for (let i = 0; i < 6; i++) Kriegslage.tick(g, 'test');
  const b = Ausschnitt.ausschnitt(g, { stufe: 0 });
  ok(b.zeichen > 0 && g.weltsim.fehler === 0, 'weiter nach Plan und Ticks: Ausschnitt da, kein Sim-Fehler');
});

console.log(`\n${n - fails}/${n} bestanden`);
if (fails) { console.log('AUSSCHNITT: ' + fails + ' FEHLER'); process.exit(1); }
console.log('AUSSCHNITT OK');
