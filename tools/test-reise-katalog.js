'use strict';
// FRE-03 C: Katalog der Reise-Notrufe (content/reise/ereignisse.json) und die Folge beim Ignorieren (folge.ignoriert), Marken-Grenze (server/sim/marken.js). Prüft:
//   (g) jeder der 30 spielbaren Sektoren hat mindestens einen Katalog-Kandidaten (Notruf), auch für ger, pirat und Vorläufer · (Nr. 4) Katalog: mindestens ein Drittel der Notruf-Gewichte ohne Gefahr, die Gefahr steht im Text,
//   mindestens zwei Einträge je Besitzergruppe ger, pirat, vorl, mindestens eine Absicht mit der Wendung piraten (absichten.json) · Pflichtfeld folge.ignoriert je Notruf (der Prüfer meldet ein fehlendes Feld) ·
//   (Nr. 2) JEDER Notruf-Eintrag, einzeln: nach Verfall und nach Ablehnen liegt am Ort eine Fund-Marke (Typ fund, Zeichen und Ticks aus den Daten) und die Chronik hat die Zeile, nach der Ankunft ist folge.angenommen gebucht ·
//   (Nr. 3) Ignorieren kostet keinen Ruf: ruf und rufLog nach dem Verfall unverändert, der Sim-Zustand (weltsim.zustand) gleich · Takt: ein unbeantworteter Takt-Notruf hinterlässt seinen Fund ·
//   (Nr. 10, Kai 2026-11-12) Marken-Grenze: Marken.MAX gilt, offene Notrufe sind immer sichtbar, Funde nur, wenn Platz ist (Weichen: Fund, Kontakt/Spur, Notruf; Ziele bleiben); ohne Fund-Marke wie früher slice(0, MAX).        node tools/test-reise-katalog.js
const fs = require('fs');
const path = require('path');
const F = require('./regie-fixture.js');
const CONFIG = require('../shared/config.js');
const Sektoren = require('../shared/sektoren.js');
const Besitz = require('../server/sim/besitz.js');
const Ruf = require('../server/sim/ruf.js');
const RE = require('../server/sim/reise-ereignis.js');
const Sprung = require('../server/sim/sprung.js');
const Marken = require('../server/sim/marken.js');
const Kartenzeichen = require('../public/js/kartenzeichen.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); return f(); };
const HZ = CONFIG.tickHz;
const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'reise', 'ereignisse.json'), 'utf8'));
const NOTRUFE = D.eintraege.filter((e) => e.art === 'notruf');
const ENV = { REISE_EREIGNISSE: '1' };
const spiel = (o) => F.neuesSpiel(Object.assign({ crew: 1, seed: 7, env: ENV }, o || {}));
const ws = (g) => g.weltsim;
const ohneFlotten = (g) => { ws(g).zustand.flotten = []; };   // keine Sim-Szene beim Eintreffen
const klon = (x) => JSON.parse(JSON.stringify(x));
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };
const KAT = RE.KATALOG;
function nur(ids, fn) { const kopie = KAT.slice(); KAT.length = 0; for (const e of kopie) if (ids.includes(e.id)) KAT.push(e); try { return fn(); } finally { KAT.length = 0; KAT.push(...kopie); } }
function sicher(fn, p) { const alt = RE.WERTE.wahrscheinlichkeit; RE.WERTE.wahrscheinlichkeit = p == null ? 1 : p; try { return fn(); } finally { RE.WERTE.wahrscheinlichkeit = alt; } }
const springe = (g, hex) => Sprung.springeNach(g, Sektoren.ortVonHex(hex));
const HEX_JE_BESITZER = { rom: '0305', ger: '1003', saum: '0504', frei: '0503', pirat: '0602', vorl: '0706' };
const ruf = (g) => ({ rom: Ruf.ruf(g, 'rom'), kon: Ruf.ruf(g, 'kon'), ger: Ruf.ruf(g, 'ger') });
const QUELLEN = require('../content/welt/ruf-werte.json').werte.quellen.wert;
const tickS = (g) => Number(g.C && g.C.marken && g.C.marken.tickSekunden) || 30;
// Der Prüfer des Pflichtfelds folge.ignoriert (ein Notruf ohne es ist ein Datenfehler) -> Liste der Fehler
function pruefeIgnoriert(e) {
  const f = [];
  const ig = e && e.folge && e.folge.ignoriert;
  if (!ig || typeof ig !== 'object') return ['folge.ignoriert fehlt'];
  if (!ig.fund || typeof ig.fund !== 'object') f.push('fund fehlt');
  else {
    if (!(typeof ig.fund.sym === 'string' && Kartenzeichen.SYMBOL_ICON[ig.fund.sym])) f.push('fund.sym ist kein Kartenzeichen');
    if (!(Number.isInteger(ig.fund.ticks) && ig.fund.ticks > 0)) f.push('fund.ticks keine positive Ganzzahl');
  }
  if (!(typeof ig.chronik === 'string' && ig.chronik.length && ig.chronik.replace(/\{ort\}/g, 'Ostia Nova Hafen').length <= RE.WERTE.chronik_kurz_max)) f.push('chronik fehlt oder zu lang');
  return f;
}
// Einen Notruf des Katalogs erzwingen: Ankunft in einem Sektor des passenden Besitzers (nur dieser Eintrag, Wahrscheinlichkeit 1) -> { t, g, o }
function mitNotruf(e) {
  const t = spiel(); const g = t.g; ohneFlotten(g);
  Ruf.debug(g, ['rom', '30']);   // Centurio: Einträge mit rang_min stehen offen
  const b = (e.bedingungen.besitzer || ['rom'])[0];
  const ev = sicher(() => nur([e.id], () => springe(g, HEX_JE_BESITZER[b])));
  const o = ws(g).reise.offen.find((x) => x.id === e.id);
  return { t, g, o, ev };
}
// weitere Sprünge ohne neues Ereignis, bis der Notruf per Sprungzähler verfällt (Ziel nie der Ort des Notrufs)
function verfallenLassen(g, o) {
  const ziele = ['0305', '0304', '0405'].filter((h) => h !== o.hex);
  for (let i = 0; i < RE.WERTE.notruf_gilt_spruenge + 2 && ws(g).reise.offen.includes(o); i++) sicher(() => springe(g, ziele[i % ziele.length]), 0);
}
const fundVon = (g, o) => (g.marken || []).find((m) => m.id === 'fund:' + o.marke) || null;

(async () => {
  await section('(g) jeder der 30 Sektoren hat einen Katalog-Kandidaten', () => {
    const g = spiel().g; const R = ws(g).reise;
    const alle = Object.keys(Sektoren.KARTE.hexe).filter((h) => Sektoren.spielbar(h) && !Sektoren.istLeerraum(h) && Sektoren.hatSzene(h));
    ok(alle.length === 30, `die Sektorliste hat 30 spielbare Sektoren mit Szene (${alle.length})`);
    const ohne = alle.filter((h) => !RE.kandidaten(g, R, h).some((k) => k.e.art === 'notruf'));
    ok(ohne.length === 0, `0 von ${alle.length} Sektoren ohne Notruf-Kandidat` + (ohne.length ? ' (' + ohne.map((h) => h + '/' + (Besitz.besitzer(g, h) || 'frei')).join(', ') + ')' : ''));
    const proBesitzer = {};
    for (const h of alle) { const b = Besitz.besitzer(g, h) || 'frei'; (proBesitzer[b] = proBesitzer[b] || []).push(RE.kandidaten(g, R, h).filter((k) => k.e.art === 'notruf').length); }
    ok(['rom', 'ger', 'saum', 'pirat', 'vorl', 'frei'].every((b) => proBesitzer[b] && proBesitzer[b].every((c) => c >= 1)), 'je Besitzer mindestens ein Kandidat: ' + Object.entries(proBesitzer).map(([b, l]) => `${b} ${Math.min(...l)}`).join(', '));
    ok(alle.every((h) => RE.kandidaten(g, R, h).filter((k) => k.e.art === 'notruf').every((k) => k.p.hex)), 'jeder Kandidat hat einen Ort');
  });

  await section('(Nr. 4) Katalog: Mischung, Gefahr im Text, Besitzergruppen, Wendung piraten', () => {
    const gew = (l) => l.reduce((s, e) => s + e.gewicht, 0);
    const ohneG = NOTRUFE.filter((e) => !e.gefahr);
    ok(gew(ohneG) * 3 >= gew(NOTRUFE), `mindestens ein Drittel der Notruf-Gewichte ohne Gefahr (${gew(ohneG)} von ${gew(NOTRUFE)})`);
    ok(NOTRUFE.length >= 15 && NOTRUFE.some((e) => e.gefahr) && ohneG.length > 0, `${NOTRUFE.length} Notrufe, mit und ohne Gefahr`);
    for (const gr of ['ger', 'pirat', 'vorl']) {
      const l = NOTRUFE.filter((e) => (e.bedingungen.besitzer || []).includes(gr));
      ok(l.length >= 2 && l.some((e) => e.gefahr) && l.some((e) => !e.gefahr), `Besitzergruppe ${gr}: ${l.length} Einträge (mindestens 2), mit und ohne Gefahr`);
    }
    // Fairness: ein Notruf mit Gefahr nennt sie im Text (Piraten, Räuber, Plünderer, Belagerung, beschossen). Die neuen Einträge in JEDER Ankündigung (die Wahl des Textes ist Zufall), die sechs alten mindestens einmal
    const nennt = /Pirat|Räuber|Rostmeute|Plünderer|Bande|belager|umschlossen|lagern|beschießen|Kriegsschiff/i;
    const NEU = NOTRUFE.slice(6);
    const schlecht = NEU.filter((e) => e.gefahr && !e.texte.ankuendigung.every((t) => nennt.test(t))).map((e) => e.id);
    const alt = NOTRUFE.filter((e) => e.gefahr && !e.texte.ankuendigung.some((t) => nennt.test(t))).map((e) => e.id);
    ok(NEU.length === 9 && schlecht.length === 0 && alt.length === 0, 'Gefahr steht im Text: jede Ankündigung der neuen Einträge, mindestens eine je alter Eintrag (' + schlecht.concat(alt).join(', ') + ')');
    ok(NOTRUFE.filter((e) => !e.gefahr).every((e) => e.ankuendigung === 'keine' && !e.parameter.schiffe) && NOTRUFE.filter((e) => e.gefahr).every((e) => e.ankuendigung === 'im_notruf'), 'ohne Gefahr: keine Gegner; mit Gefahr: der Notruf nennt sie (im_notruf)');
    ok(NOTRUFE.every((e) => e.sprecher && !/Lerche/.test(e.sprecher)), 'jeder Notruf hat einen Sprecher');
    const absichten = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'absichten.json'), 'utf8')).absichten;
    const mitPiraten = Object.entries(absichten).filter(([, a]) => (a.wendungen || []).includes('piraten')).map(([k]) => k);
    ok(mitPiraten.length >= 1, 'mindestens eine Absicht mit der Wendung piraten (' + mitPiraten.join(', ') + ')');
    ok(NOTRUFE.filter((e) => e.parameter.variante === 'piratenueberfall').length >= 3, 'Piratenüberfälle im Katalog (Gegenstück der Wendung piraten)');
    const texte = NOTRUFE.flatMap((e) => Object.values(e.texte).flat());
    ok(texte.every((t) => t.length >= 20 && t.length <= 230) && texte.every((t) => (t.match(/\{(\w+)\}/g) || []).every((p) => p === '{ort}')), `${texte.length} Notruf-Texte: 20 bis 230 Zeichen, Platzhalter nur {ort}`);
  });

  await section('Pflichtfeld folge.ignoriert: der Prüfer meldet jeden Mangel', () => {
    ok(NOTRUFE.every((e) => pruefeIgnoriert(e).length === 0), `alle ${NOTRUFE.length} Notrufe (6 alte, ${NOTRUFE.length - 6} neue) haben folge.ignoriert mit Fund und Chronik`);
    const e0 = NOTRUFE[0];
    const ohne = klon(e0); delete ohne.folge.ignoriert;
    ok(pruefeIgnoriert(ohne).length === 1, 'fehlendes Feld wird gemeldet');
    const schief = klon(e0); schief.folge.ignoriert.fund.ticks = 0; schief.folge.ignoriert.fund.sym = 'gibtsnicht';
    ok(pruefeIgnoriert(schief).length === 2, 'Ticks 0 und unbekanntes Zeichen werden gemeldet');
    const lang = klon(e0); lang.folge.ignoriert.chronik = 'x'.repeat(RE.WERTE.chronik_kurz_max + 1);
    ok(pruefeIgnoriert(lang).length === 1, 'zu lange Chronikzeile wird gemeldet');
    ok(NOTRUFE.every((e) => Array.isArray(e.folge.ablehnen) && e.folge.ablehnen.length === 0), 'Ablehnen kostet weiter keinen Ruf (folge.ablehnen leer)');
    ok(D.eintraege.filter((e) => e.art !== 'notruf').every((e) => !(e.folge && e.folge.ignoriert)), 'andere Arten haben das Feld nicht (nur Notrufe verfallen)');
  });

  await section('(Nr. 2) je Eintrag: Verfall, Ablehnen und Ankunft (alle Notrufe, jeder für sich)', () => {
    for (const e of NOTRUFE) {
      const ig = e.folge.ignoriert;
      // Verfall
      const v = mitNotruf(e);
      const okEntstanden = !!v.o && v.g.errors === 0;
      if (v.o) verfallenLassen(v.g, v.o);
      const fund = v.o && fundVon(v.g, v.o);
      const zeile = v.o && (ws(v.g).chronik || []).some((c) => c.art === 'reise' && c.ref === e.id && c.kurz === ig.chronik.replace('{ort}', RE.hexName(v.o.hex)).slice(0, RE.WERTE.chronik_kurz_max));
      ok(okEntstanden && !ws(v.g).reise.offen.includes(v.o) && !!fund && fund.t === 'fund' && fund.h === v.o.hex && fund.s === ig.fund.sym && fund.ges === Math.round(ig.fund.ticks * tickS(v.g)) && zeile && v.g.errors === 0,
        `${e.id}: Verfall legt Fund-Marke (${ig.fund.sym}, ${ig.fund.ticks} Ticks) und Chronik-Zeile an`);
      // Kontrolllauf: derselbe Ablauf, aber der Eintrag ohne folge.ignoriert. Die Sprünge dazwischen verändern Ruf und Sim von allein, der Unterschied zum Kontrolllauf ist genau die Folge (soll: keiner).
      const k = (() => { const le = KAT.find((x) => x.id === e.id), ign = le.folge.ignoriert; delete le.folge.ignoriert; try { const x = mitNotruf(e); if (x.o) verfallenLassen(x.g, x.o); return x; } finally { le.folge.ignoriert = ign; } })();   // le = der Eintrag im Speicher des Servers
      ok(!fundVon(k.g, k.o) && JSON.stringify(ruf(v.g)) === JSON.stringify(ruf(k.g)) && JSON.stringify(ws(v.g).reise.rufLog) === JSON.stringify(ws(k.g).reise.rufLog) && ws(v.g).reise.rufLog.length === 0 && JSON.stringify(ws(v.g).zustand) === JSON.stringify(ws(k.g).zustand), `${e.id}: Ignorieren kostet keinen Ruf (ruf, rufLog wie im Kontrolllauf ohne die Folge) und lässt die Sim (weltsim.zustand) gleich`);
      // Ablehnen
      const a = mitNotruf(e);
      const rufA = klon(ruf(a.g));
      const abgelehnt = a.o ? RE.ablehnen(a.g, a.o.nr) : false;
      const fundA = a.o && fundVon(a.g, a.o);
      ok(abgelehnt && !!fundA && fundA.t === 'fund' && fundA.h === a.o.hex && JSON.stringify(ruf(a.g)) === JSON.stringify(rufA), `${e.id}: Ablehnen hinterlässt denselben Fund und kostet keinen Ruf`);
      // Ankunft: folge.angenommen wird gebucht, ohne Fund
      const b = mitNotruf(e);
      const rufB = klon(ruf(b.g));
      if (b.o) { sicher(() => springe(b.g, b.o.hex), 0); }
      if (b.o && e.gefahr) {
        lauf(b.g, e.parameter.vorlauf_s + 1);
        const tag = ws(b.g).reise.laufend[0] && ws(b.g).reise.laufend[0].tag;
        b.g.space.enemies = b.g.space.enemies.filter((x) => x.tag !== tag);
        b.g.step();
      }
      const erwartet = klon(rufB);
      for (const grund of e.folge.angenommen) erwartet[QUELLEN[grund].fraktion] += QUELLEN[grund].delta;
      ok(!!b.o && !fundVon(b.g, b.o) && JSON.stringify(ruf(b.g)) === JSON.stringify(erwartet) && e.folge.angenommen.length >= 1 && b.g.errors === 0, `${e.id}: nach der Ankunft${e.gefahr ? ' und dem Kampf' : ''} ist folge.angenommen gebucht (${e.folge.angenommen.join(', ')}), kein Fund`);
    }
  });

  await section('Takt: ein unbeantworteter Takt-Notruf hinterlässt seinen Fund', () => {
    const g = spiel().g;
    lauf(g, RE.WERTE.takt_s + RE.WERTE.takt_leben_s + 5);
    const R = ws(g).reise;
    const funde = (g.marken || []).filter((m) => m.t === 'fund' && m.id.startsWith('fund:reise:n-'));
    ok(R.taktNr >= 3 && funde.length >= 1 && funde.every((m) => m.bis > g.time), `nach Verfall des ersten Takt-Notrufs (taktNr ${R.taktNr}) liegt ${funde.length} Fund-Marke(n) am Ort, noch nicht abgelaufen`);
    ok(Marken.snapshot(g).some((m) => m.t === 'fund') && g.errors === 0, 'die Fund-Marke steht im Snapshot der Karte, keine Fehler');
  });

  await section('(Nr. 10, Kai 2026-11-12) Marken-Grenze: offene Notrufe vor Erinnerung, Marken.MAX bleibt eingehalten', () => {
    const neuG = () => { const g = spiel().g; g.marken = []; return g; };
    const HEXE = ['0305', '0603', '0105', '0504', '0704', '0204', '0403', '0503'];
    const typen = (g) => Marken.liste(g).map((m) => m.t);
    const zaehl = (l, t) => l.filter((m) => m.t === t).length;
    // a) 8 Notruf-Marken zuerst, dann ein frischer Fund: offene Notrufe sind immer sichtbar, der Fund (nur Erinnerung) weicht
    {
      const g = neuG();
      for (let i = 0; i < 8; i++) Marken.setze(g, { id: 'reise:n-' + i, typ: 'notruf', hex: HEXE[i], ticks: 100 });
      Marken.setze(g, { id: 'fund:frisch', typ: 'fund', hex: '0605', sym: 'wrack', ticks: 100 });
      const l = Marken.liste(g);
      ok(l.length === Marken.MAX && zaehl(l, 'notruf') === 8 && !l.some((m) => m.id === 'fund:frisch'), 'volle Liste aus Notruf-Marken: alle 8 Notrufe bleiben, der Fund weicht (Funde nur, wenn Platz ist)');
    }
    // b) 3 offene Notrufe und 8 Funde: alle 3 Notrufe sichtbar, die ältesten Funde weichen, MAX gilt
    {
      const g = neuG();
      for (let i = 0; i < 8; i++) Marken.setze(g, { id: 'fund:t' + i, typ: 'fund', hex: HEXE[i], ticks: 100 });
      for (let i = 0; i < 3; i++) Marken.setze(g, { id: 'reise:n-' + (i + 1), typ: 'notruf', hex: HEXE[i], ticks: 100 });
      const l = Marken.liste(g);
      ok(l.length === Marken.MAX && zaehl(l, 'notruf') === 3 && zaehl(l, 'fund') === 5, `3 offene Notrufe und 8 Funde: ${Marken.MAX} Marken, alle 3 Notrufe sichtbar, 5 Funde (${typen(g).join(',')})`);
      ok(['fund:t3', 'fund:t4', 'fund:t5', 'fund:t6', 'fund:t7'].every((id) => l.some((m) => m.id === id)) && !l.some((m) => m.id === 'fund:t0'), 'es weichen die ältesten Funde (t0 bis t2), die jüngsten bleiben');
      Marken.entferne(g, 'reise:n-1');
      ok(zaehl(Marken.liste(g), 'fund') === 6 && zaehl(Marken.liste(g), 'notruf') === 2, 'wird ein Notruf beantwortet, rückt ein Fund nach (6 Funde, 2 Notrufe)');
    }
    // c) 9 Funde: der jüngste bleibt sichtbar, der älteste weicht, MAX gilt
    {
      const g = neuG();
      for (let i = 0; i < 9; i++) Marken.setze(g, { id: 'fund:' + i, typ: 'fund', hex: HEXE[i % 8], ticks: 100 });
      const l = Marken.liste(g);
      ok(l.length === Marken.MAX && l.some((m) => m.id === 'fund:8') && !l.some((m) => m.id === 'fund:0'), 'neun Funde: der jüngste bleibt, der älteste weicht, höchstens MAX');
    }
    // d) Reihenfolge des Weichens: Funde zuerst, dann Kontakt und Spur, dann Notrufe; Ziele bleiben
    {
      const g = neuG();
      g.mission = { step: { objectives: [{ id: 'a', hex: '0604' }, { id: 'b', hex: '0503' }] }, state: { objectives: [] }, cond: () => true, focusSnapshot: () => ({ focusLoc: null }) };
      Marken.setze(g, { id: 's1', typ: 'spur', hex: '0105', ticks: 100 });
      Marken.setze(g, { id: 'k1', typ: 'kontakt', hex: '0105', ticks: 100 });
      for (let i = 0; i < 7; i++) Marken.setze(g, { id: 'f' + i, typ: 'fund', hex: HEXE[i], ticks: 100 });
      const l = Marken.liste(g);
      ok(l.length === Marken.MAX && zaehl(l, 'ziel') === 2 && zaehl(l, 'fund') === 4 && zaehl(l, 'spur') === 1 && zaehl(l, 'kontakt') === 1, `2 Ziele, Spur, Kontakt und 7 Funde: erst weichen Funde (4 bleiben), Spur und Kontakt bleiben (${l.map((m) => m.t).join(',')})`);
      for (let i = 0; i < 3; i++) Marken.setze(g, { id: 'reise:n-' + i, typ: 'notruf', hex: HEXE[i], ticks: 100 });
      const l2 = Marken.liste(g);
      ok(l2.length === Marken.MAX && zaehl(l2, 'notruf') === 3 && zaehl(l2, 'ziel') === 2 && zaehl(l2, 'fund') === 1 && zaehl(l2, 'spur') === 1 && zaehl(l2, 'kontakt') === 1, `dazu 3 Notrufe: Funde weichen weiter zuerst (1 bleibt), die 3 Notrufe sind sichtbar (${l2.map((m) => m.t).join(',')})`);
      for (let i = 0; i < 1; i++) Marken.entferne(g, 'f6');
      const l3 = Marken.liste(g);
      ok(l3.length === Marken.MAX && zaehl(l3, 'fund') === 1 && zaehl(l3, 'notruf') === 3 && zaehl(l3, 'spur') === 1 && zaehl(l3, 'kontakt') === 1, 'der letzte sichtbare Fund geht, der nächste (älter) rückt nach: Kontakt, Spur und die 3 Notrufe bleiben');
      Marken.setze(g, { id: 'fund:neu', typ: 'fund', hex: '0605', ticks: 100 });
      for (let i = 3; i < 6; i++) Marken.setze(g, { id: 'reise:n-' + i, typ: 'notruf', hex: HEXE[i], ticks: 100 });
      const l4 = Marken.liste(g);
      ok(l4.length === Marken.MAX && zaehl(l4, 'ziel') === 2 && zaehl(l4, 'fund') === 0 && zaehl(l4, 'kontakt') + zaehl(l4, 'spur') + zaehl(l4, 'notruf') === 6, `mit Fund: der Fund weicht vor Kontakt, Spur und Notruf (${l4.map((m) => m.t).join(',')})`);
      Marken.setze(g, { id: 'fund:neu2', typ: 'fund', hex: '0605', ticks: 100 });
      Marken.setze(g, { id: 'reise:n-9', typ: 'notruf', hex: HEXE[6], ticks: 100 });
      Marken.setze(g, { id: 'reise:n-10', typ: 'notruf', hex: HEXE[7], ticks: 100 });
      const l5 = Marken.liste(g);
      ok(l5.length === Marken.MAX && zaehl(l5, 'fund') === 0 && zaehl(l5, 'ziel') === 2 && zaehl(l5, 'notruf') === 6 && zaehl(l5, 'kontakt') === 0 && zaehl(l5, 'spur') === 0, `zu viele Notrufe: Kontakt und Spur weichen nach den Funden, dann der älteste Notruf, Ziele bleiben (${l5.map((m) => m.t).join(',')})`);
    }
    // e) End-zu-End mit dem Takt: drei offene Takt-Notrufe, die Karte voll mit Funden: alle 3 Notrufe sichtbar
    {
      const g = spiel().g;
      for (let i = 0; i < 8; i++) Marken.setze(g, { id: 'fund:t' + i, typ: 'fund', hex: HEXE[i], ticks: 1000 });
      lauf(g, RE.WERTE.takt_s * 3 + 5);
      const R = ws(g).reise; const sn = Marken.snapshot(g);
      ok(R.offen.length === 3 && sn.length === Marken.MAX && sn.filter((m) => m.t === 'notruf').length === 3 && sn.filter((m) => m.t === 'fund').length === 5 && R.offen.every((o) => sn.some((m) => m.id === o.marke)), 'Takt: 3 offene Notrufe (alle im Snapshot der Karte), dazu 5 Funde, genau MAX');
    }
    // f) 5.11: ohne Fund-Marke ist die Liste byte-gleich zur alten (slice(0, MAX) in Einfügereihenfolge); Zufallslisten aus Notruf, Kontakt und Spur, mit und ohne Ziele
    {
      let x = 12345; const zuf = (m) => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x % m; };
      let gleich = 0, ueber = 0;
      for (let lauf_ = 0; lauf_ < 60; lauf_++) {
        const g = neuG();
        if (lauf_ % 2) g.mission = { step: { objectives: [{ id: 'a', hex: '0604' }, { id: 'b', hex: '0503' }, { id: 'c', hex: '0105' }] }, state: { objectives: [] }, cond: () => true, focusSnapshot: () => ({ focusLoc: null }) };
        const anzahl = 4 + zuf(11);
        for (let i = 0; i < anzahl; i++) Marken.setze(g, { id: 'm' + i, typ: ['notruf', 'kontakt', 'spur'][zuf(3)], hex: HEXE[zuf(8)], ticks: 100 });
        const l = Marken.liste(g);
        const alt = Marken.ziele(g).concat(g.marken).slice(0, Marken.MAX);
        if (JSON.stringify(l) === JSON.stringify(alt)) gleich++;
        if (Marken.ziele(g).length + g.marken.length > Marken.MAX) ueber++;
      }
      ok(gleich === 60 && ueber >= 15, `ohne Fund-Marke: 60 von 60 Zufallslisten (davon ${ueber} über MAX) byte-gleich zum alten slice(0, MAX)`);
    }
  });

  console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
  process.exit(fails ? 1 : 0);
})();
