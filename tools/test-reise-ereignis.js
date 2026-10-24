'use strict';
// SUND-03 D: Reise-Ereignisse der Freien Fahrt Sund (server/sim/reise-ereignis.js, Daten content/reise/). Prüft:
//   Katalog (Schema, Vollständigkeit, Fairness-Felder) · Rate über viele Sprünge (höchstens 1 je 3, mittlere Rate) · eigener, zählerbasierter Zufallsstrom (Sim und game.rng unberührt) ·
//   Wiederholungsregeln (Id, Parametersatz, Mindestabstand) · Auslösen je Art (Funk, Ankündigung vor Gefahr, Ausweichen) · Notruf (Marke, Hinfliegen, Ablehnen kostet nichts, Verfall) ·
//   Folgen (Ruf über den Wirkungen-Katalog) · Schnellsprung (Abbruch, Rest der Route, Abfangen zählt) · Mehrspieler zu dritt · Sim-Notruf aufnehmen · Sim-Parität ·
//   Weltstand (Speichern, Laden, Altstand, Müll, schemagültig) · Schalter.        node tools/test-reise-ereignis.js
const fs = require('fs');
const path = require('path');
const F = require('./regie-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Kriegslage = require('../server/sim/kriegslage.js');
const Sprung = require('../server/sim/sprung.js');
const Reise = require('../server/sim/reise.js');
const RE = require('../server/sim/reise-ereignis.js');
const Chronik = require('../server/sim/chronik.js');
const Marken = require('../server/sim/marken.js');
const Ruf = require('../server/sim/ruf.js');
const Besitz = require('../server/sim/besitz.js');
const Regie = require('../server/sim/regie-befehle.js');
const CONFIG = require('../shared/config.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); f(); };
const klon = F.klon;
const ws = (g) => g.weltsim;
const ENV = { REISE_EREIGNISSE: '1' };
const spiel = (o) => F.neuesSpiel(Object.assign({ crew: 1, seed: 7, env: ENV }, o || {}));
const ohneFlotten = (g) => { ws(g).zustand.flotten = []; };   // keine Sim-Szene beim Eintreffen (die Szenarien prüfen die Ereignisse, nicht die Szene)
const abbild = (g) => JSON.stringify(Kriegslage.abbild(ws(g).zustand));
const HEX = { rom: '0305', rom2: '0304', ger: '1003', ger2: '1004', saum: '0504', frei: '0503', pirat: '0602' };
const funkTexte = (t, i) => t.cs[i || 0].inbox.filter((m) => m.t === 'event' && m.kind === 'radio').map((m) => m.text);
const KAT = RE.KATALOG;
// Nur diese Katalogeinträge gelten (die Szenarien erzwingen eine Art), danach ist der Katalog wieder vollständig
function nur(ids, fn) { const kopie = KAT.slice(); KAT.length = 0; for (const e of kopie) if (ids.includes(e.id)) KAT.push(e); try { return fn(); } finally { KAT.length = 0; KAT.push(...kopie); } }
function sicher(fn, p) { const alt = RE.WERTE.wahrscheinlichkeit; RE.WERTE.wahrscheinlichkeit = p == null ? 1 : p; try { return fn(); } finally { RE.WERTE.wahrscheinlichkeit = alt; } }
const springe = (g, hex) => Sprung.springeNach(g, Sektoren.ortVonHex(hex));
const rom = (g) => Ruf.ruf(g, 'rom');
const neuerStrom = (g) => { ws(g).reise = RE.neu(); };
const lauf = (g, sek) => { for (let i = 0; i < Math.round(sek * CONFIG.tickHz); i++) g.step(); };

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Katalog: Schema und Vollständigkeit', () => {
  const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'reise', 'ereignisse.json'), 'utf8'));
  const W = RE.WERTE;
  const E = D.eintraege;
  const quellen = require('../content/welt/ruf-werte.json').werte.quellen.wert;
  const raenge = Ruf.RAENGE.map((r) => r.id);
  const ids = E.map((e) => e.id);
  ok(D.format === 'reise-ereignisse/1' && E.length >= 12, `Format reise-ereignisse/1, ${E.length} Einträge (mindestens 12)`);
  ok(new Set(ids).size === ids.length && ids.every((i) => /^[a-z][a-z0-9_]*$/.test(i)), 'Ids eindeutig, klein geschrieben');
  ok(RE.ARTEN.every((a) => E.some((e) => e.art === a)), 'alle vier Arten: Notruf, Patrouille, Piraten, Funkmeldung');
  ok(E.every((e) => RE.ARTEN.includes(e.art) && Number.isFinite(e.gewicht) && e.gewicht > 0), 'Art gültig, Gewicht > 0');
  ok(['piratenueberfall', 'belagerung', 'havarie'].every((v) => E.some((e) => e.art === 'notruf' && e.parameter.variante === v)), 'Notrufe mit Varianten: Piratenüberfall, Belagerung, Havarie');
  ok(E.filter((e) => e.art === 'notruf').every((e) => W.ort_typen[e.parameter.ort_typ] && (e.gefahr ? ['piratenueberfall', 'belagerung'].includes(e.parameter.variante) : true)), 'Notrufe: Ortstyp gültig, Gefahr nur bei Überfall und Belagerung');
  const bk = ['besitzer', 'rang_min', 'rang_max', 'lage', 'min_abstand'];
  ok(E.every((e) => Object.keys(e.bedingungen || {}).every((k) => bk.includes(k))), 'Bedingungen: nur bekannte Schlüssel');
  ok(E.every((e) => (!e.bedingungen.besitzer || e.bedingungen.besitzer.every((b) => ['rom', 'ger', 'saum', 'pirat', 'frei'].includes(b))) && (!e.bedingungen.lage || e.bedingungen.lage.every((l) => ['rom', 'ger', 'offen'].includes(l))) && [e.bedingungen.rang_min, e.bedingungen.rang_max].filter(Boolean).every((r) => raenge.includes(r))), 'Bedingungen: Besitzer, Lage und Ränge gibt es');
  ok(E.every((e) => !e.bedingungen.rang_min || !e.bedingungen.rang_max || raenge.indexOf(e.bedingungen.rang_min) <= raenge.indexOf(e.bedingungen.rang_max)), 'Rangfenster nicht leer');
  // Fairness: Gefahr wird angekündigt, keine Scheinwahl
  const gef = E.filter((e) => e.gefahr);
  ok(gef.length >= 6 && gef.every((e) => ['funk', 'im_notruf'].includes(e.ankuendigung)), `Gefahr (${gef.length} Einträge) kündigt sich an: funk oder im_notruf`);
  ok(E.filter((e) => !e.gefahr).every((e) => e.ankuendigung === 'keine' && !(e.parameter.schiffe) && e.parameter.vorlauf_s === undefined), 'ohne Gefahr: keine Ankündigung, keine Gegner');
  ok(gef.every((e) => e.parameter.vorlauf_s >= W.vorlauf_min_s && e.parameter.schiffe && e.parameter.schiffe.min >= 1 && e.parameter.schiffe.max >= e.parameter.schiffe.min && CONFIG.enemies[e.parameter.schiffe.art]), `Gefahr: Vorlauf mindestens ${W.vorlauf_min_s} s, Gegnerzahl und -art gültig`);
  ok(E.filter((e) => ['patrouille', 'piraten'].includes(e.art) && e.gefahr).every((e) => e.ankuendigung === 'funk' && e.texte.ankuendigung && e.texte.eintreffen), 'Patrouille und Piraten: Funk vor dem Eintreffen, danach der Funk beim Eintreffen');
  ok(E.filter((e) => e.art === 'notruf').every((e) => e.texte.ankuendigung && e.texte.eintreffen && e.texte.dank), 'Notrufe: Funk beim Entstehen, beim Eintreffen und Dank');
  ok(E.filter((e) => e.art === 'funkmeldung').every((e) => !e.gefahr && (e.folge.angenommen || []).length === 0), 'Funkmeldungen: keine Gefahr, keine Folge');
  const texte = E.flatMap((e) => Object.values(e.texte).flat());
  ok(texte.every((t) => typeof t === 'string' && t.length >= 20 && t.length <= 230) && E.every((e) => Object.values(e.texte).every((l) => Array.isArray(l) && l.length >= 1)), `Funktexte: ${texte.length} feste Texte, kurz (20 bis 230 Zeichen)`);
  ok(texte.every((t) => (t.match(/\{(\w+)\}/g) || []).every((p) => ['{ort}', '{n}'].includes(p))), 'Platzhalter nur {ort} und {n}');
  ok(E.every((e) => e.sprecher && typeof e.sprecher === 'string' && !/legat|mars/i.test(e.sprecher)), 'Sprecher als Namensplakette, keine neuen Funkporträts (legat, mars)');
  ok(E.every((e) => typeof e.chronik === 'string' && e.chronik.replace(/\{ort\}/g, 'Ostia Nova Hafen').length <= W.chronik_kurz_max), `Chronikzeile je Eintrag, höchstens ${W.chronik_kurz_max} Zeichen`);
  ok(E.every((e) => Array.isArray(e.folge.angenommen) && Array.isArray(e.folge.ablehnen) && e.folge.ablehnen.length === 0 && e.folge.angenommen.every((g) => quellen[g])), 'Folgen: Gründe aus ruf-werte.json, Ablehnen ohne Folge (leer)');
  ok(E.filter((e) => e.art === 'notruf').every((e) => !e.parameter.sim_art || ['piratenueberfall', 'belagerung'].includes(e.parameter.sim_art)), 'sim_art: nur Überfall und Belagerung (Ereignisarten der Sim)');
  ok(E.every((e) => e.art === 'notruf' ? e.folge.angenommen.length >= 1 : true), 'jeder Notruf hat eine Folge für die Hilfe');
  // jeder Besitzer des Ankunftssektors findet mindestens einen Eintrag
  for (const b of ['rom', 'ger', 'saum', 'pirat', 'frei']) ok(E.some((e) => !e.bedingungen.besitzer || e.bedingungen.besitzer.includes(b)), `Besitzer ${b}: mindestens ein Eintrag passt`);
  // Zahlen
  ok(W.min_abstand_spruenge >= 3 && RE.ABSTAND_HART === 3 && W.wahrscheinlichkeit > 0 && W.wahrscheinlichkeit < 1 && W.wiederholung.fenster >= 2 && W.wiederholung.ring >= W.wiederholung.fenster, 'Werte: Abstand ≥ 3 (hart 3), Wahrscheinlichkeit in (0,1), Fenster und Ring');
  const mittel = RE.ABSTAND_HART - 1 + 1 / W.wahrscheinlichkeit;
  ok(mittel >= 6 && mittel <= 10, `mittlerer Abstand nach den Daten ${mittel.toFixed(1)} Sprünge (Startwert 6 bis 10)`);
  ok(RE.textFuer({ id: ids[0], textIdx: 1, hex: '0305' }, 'ankuendigung').text.length > 10 && RE.textFuer({ id: 'funk_lage_rom', textIdx: 0, hex: '0305' }, 'dank') === null, 'textFuer: benannte Stelle liefert den Katalogtext, fehlt der Slot: null');
  const t0 = RE.textFuer({ id: 'piraten_hinterhalt', textIdx: 0, hex: '0602' }, 'ankuendigung'), t1 = RE.textFuer({ id: 'piraten_hinterhalt', textIdx: 1, hex: '0602' }, 'ankuendigung');
  ok(t0.von === 'Aufklärung' && t0.text !== t1.text && /\b10 Sekunden\b/.test(t0.text) && !/\{/.test(t0.text), 'textFuer: Sprecher, Textwahl nach textIdx, Platzhalter {n} ersetzt');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Rate über viele Sprünge: nur die Entscheidung (zaehleSprung + entscheiden), keine Szene; 20 Seeds × 5000 Sprünge über alle Besitzer des Sundes
section('Rate: höchstens 1 Ereignis je 3 Sprünge, viele Sprünge', () => {
  const t = spiel(); const g = t.g;
  const hexe = Object.keys(ws(g).zustand.hexe).filter((h) => Sektoren.ortVonHex(h) && Sektoren.spielbar(h)).sort();
  ok(hexe.length >= 20, `Ankunftssektoren der Messung: ${hexe.length} Hexe mit allen Besitzern (${[...new Set(hexe.map((h) => Besitz.besitzer(g, h) || 'frei'))].sort().join(', ')})`);
  const SEEDS = 20, SPRUENGE = 5000;
  const lageEcht = Regie.lage;
  let ereignisse = 0, gesamt = 0, zuDicht = 0, gleicheId = 0, gleicherSatz = 0, abstandId = 0;
  const arten = {}, ids = {}, gaps = [];
  const verlaeufe = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    ws(g).zustand.seed = seed * 7919; neuerStrom(g);
    ws(g).ruf.rom = seed % 2 ? 60 : 0;   // Ränge wechseln (Miles bis Tribun), damit auch die Einträge mit Rangfenster vorkommen
    const lage = ['rom', 'ger', 'offen'][seed % 3]; Regie.lage = () => ({ sieger: lage });   // die Lagefenster (die Sim steht hier still)
    const R = ws(g).reise;
    let letzteN = null; const ev = [];
    for (let i = 0; i < SPRUENGE; i++) {
      RE.zaehleSprung(g);
      const h = hexe[(i * 7 + seed) % hexe.length];
      const e = RE.entscheiden(g, h);
      gesamt++;
      if (e) {
        if (letzteN != null) { gaps.push(R.n - letzteN); if (R.n - letzteN < 3) zuDicht++; }
        letzteN = R.n; ev.push(e);
        ereignisse++; arten[e.art] = (arten[e.art] || 0) + 1; ids[e.id] = (ids[e.id] || 0) + 1;
      }
    }
    // Wiederholungsregeln über die ganze Reihe
    for (let k = 1; k < ev.length; k++) {
      if (ev[k].id === ev[k - 1].id) gleicheId++;
      for (let j = Math.max(0, k - RE.WERTE.wiederholung.fenster); j < k; j++) if (ev[j].schluessel === ev[k].schluessel) { gleicherSatz++; break; }
      const bed = RE.KATALOG.find((x) => x.id === ev[k].id).bedingungen.min_abstand;
      if (bed) for (let j = k - 1; j >= 0; j--) if (ev[j].id === ev[k].id && ev[k].nr - ev[j].nr < bed) { abstandId++; break; }
    }
    verlaeufe.push(ev.slice(0, 60).map((x) => x.id + '@' + x.nr).join());
  }
  Regie.lage = lageEcht; ws(g).ruf.rom = 0;
  const rate = ereignisse / gesamt, mittel = gaps.reduce((s, x) => s + x, 0) / gaps.length;
  console.log(`       Messung: ${SEEDS} Seeds × ${SPRUENGE} Sprünge = ${gesamt}, Ereignisse ${ereignisse}, Rate ${rate.toFixed(4)} (1 je ${(1 / rate).toFixed(2)} Sprünge), mittlerer Abstand ${mittel.toFixed(2)}, kleinster ${Math.min(...gaps)}; Arten ${JSON.stringify(arten)}`);
  ok(zuDicht === 0 && Math.min(...gaps) >= 3, `nie mehr als 1 Ereignis je 3 aufeinanderfolgende Sprünge (${gaps.length} Abstände, kleinster ${Math.min(...gaps)})`);
  ok(rate >= 1 / 10 && rate <= 1 / 6, `mittlere Rate 1 je ${(1 / rate).toFixed(1)} Sprünge, im Bereich 6 bis 10`);
  ok(RE.ARTEN.every((a) => arten[a] > ereignisse * 0.03), `alle vier Arten kommen vor, keine verhungert (${JSON.stringify(arten)})`);
  ok(Object.keys(ids).length === RE.KATALOG.length, `jeder Katalogeintrag kam vor (${Object.keys(ids).length} von ${RE.KATALOG.length})`);
  ok(gleicheId === 0, 'nie dieselbe Katalog-Id zweimal in Folge (' + ereignisse + ' Ereignisse)');
  ok(gleicherSatz === 0, `nie derselbe Parametersatz wie eines der letzten ${RE.WERTE.wiederholung.fenster} Ereignisse`);
  ok(abstandId === 0, 'Mindestabstand je Id (bedingungen.min_abstand) eingehalten');
  ok(new Set(verlaeufe).size === SEEDS, 'verschiedene Seeds geben verschiedene Reihen');
  // der Code erzwingt den Abstand auch bei falschen Daten
  const alt = RE.WERTE.min_abstand_spruenge, altW = RE.WERTE.wahrscheinlichkeit;
  RE.WERTE.min_abstand_spruenge = 1; RE.WERTE.wahrscheinlichkeit = 1;
  ws(g).zustand.seed = 99; neuerStrom(g);
  let letzte = null, min = 99;
  for (let i = 0; i < 400; i++) { RE.zaehleSprung(g); if (RE.entscheiden(g, hexe[i % hexe.length])) { if (letzte != null) min = Math.min(min, ws(g).reise.n - letzte); letzte = ws(g).reise.n; } }
  RE.WERTE.min_abstand_spruenge = alt; RE.WERTE.wahrscheinlichkeit = altW;
  ok(min >= 3 && letzte != null, `hart im Code: auch mit Abstand 1 in den Daten und Wahrscheinlichkeit 1 kommen Ereignisse nie dichter als 3 Sprünge (kleinster ${min})`);
  // auch ein größerer Abstand in den Daten gilt
  RE.WERTE.min_abstand_spruenge = 5; RE.WERTE.wahrscheinlichkeit = 1; neuerStrom(g);
  letzte = null; min = 99;
  for (let i = 0; i < 400; i++) { RE.zaehleSprung(g); if (RE.entscheiden(g, hexe[i % hexe.length])) { if (letzte != null) min = Math.min(min, ws(g).reise.n - letzte); letzte = ws(g).reise.n; } }
  RE.WERTE.min_abstand_spruenge = alt; RE.WERTE.wahrscheinlichkeit = altW;
  ok(min >= 5, `Daten dürfen den Abstand vergrößern (5: kleinster ${min})`);
});

section('Eigener Zufallsstrom: Sim und game.rng bleiben unberührt, Ergebnis ist deterministisch', () => {
  const a = spiel({ seed: 11 }).g, b = spiel({ seed: 11 }).g;
  const hexe = ['0305', '0304', '0504', '1003', '0503', '0105', '0603'];
  const zuf0 = ws(a).zustand.zufall;
  const reihe = (g) => { const out = []; for (let i = 0; i < 600; i++) { RE.zaehleSprung(g); const e = RE.entscheiden(g, hexe[i % hexe.length]); if (e) out.push(e.id + '@' + e.nr + ':' + e.hex); } return out.join(); };
  const ra = reihe(a), rb = reihe(b);
  ok(ra.length > 50 && ra === rb, 'gleiches Spiel (gleicher Seed), gleiche Reihe');
  ok(ws(a).zustand.zufall === zuf0, 'der Zufallsstrom der Sim wurde nicht berührt (Sim-Bit-Parität bleibt)');
  const c = spiel({ seed: 11 }).g;
  ok(a.rng() === c.rng() && a.rng() === c.rng(), 'game.rng wurde nicht verbraucht (gleiche nächste Zahlen wie in einem Spiel ohne Ereignisse)');
  const d = spiel({ seed: 12 }).g; ws(d).zustand.seed = 4242;
  ok(reihe(d) !== ra, 'anderer Sim-Seed, andere Reihe');
  ok(JSON.stringify(Object.keys(ws(a).reise).sort()) === JSON.stringify(['laufend', 'letzte', 'letzter', 'n', 'offen']), 'der Strom hat keinen eigenen Zustand (nur Zähler n, letzter, letzte, offen, laufend)');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Wiederholungsregeln im Einzelnen', () => {
  const g = spiel().g; const R = ws(g).reise;
  // der Parametersatz einer Notruf-Variante am selben Ort ist verboten, solange er im Fenster steht
  R.n = 20;
  const p = nur(['notruf_havarie_reaktor'], () => RE.kandidaten(g, R, '0305'));
  ok(p.length === 1, 'Ausgangslage: der Havarie-Notruf ist Kandidat');
  R.letzte = [{ id: 'andere', k: p[0].p.schluessel, n: 19 }];
  ok(nur(['notruf_havarie_reaktor'], () => RE.kandidaten(g, R, '0305')).length === 0, 'derselbe Parametersatz wie das letzte Ereignis (andere Id): abgelehnt');
  R.letzte = [{ id: 'andere', k: p[0].p.schluessel, n: 1 }, { id: 'x', k: 'a', n: 2 }, { id: 'y', k: 'b', n: 3 }, { id: 'z', k: 'c', n: 4 }];
  ok(nur(['notruf_havarie_reaktor'], () => RE.kandidaten(g, R, '0305')).length === 1, 'außerhalb des Fensters (die letzten drei) ist derselbe Satz wieder erlaubt');
  R.letzte = [{ id: 'notruf_havarie_reaktor', k: 'x', n: 19 }];
  const eh = RE.KATALOG.find((x) => x.id === 'notruf_havarie_reaktor'), minAbstand = eh.bedingungen.min_abstand;
  delete eh.bedingungen.min_abstand;   // ohne den Mindestabstand der Id muss die Regel „nie zweimal in Folge“ allein halten
  ok(nur(['notruf_havarie_reaktor'], () => RE.kandidaten(g, R, '0305')).length === 0, 'dieselbe Katalog-Id zweimal in Folge: abgelehnt (auch ohne Mindestabstand)');
  R.letzte = [{ id: 'notruf_havarie_reaktor', k: 'x', n: 10 }, { id: 'andere', k: 'y', n: 11 }];
  ok(nur(['notruf_havarie_reaktor'], () => RE.kandidaten(g, R, '0305')).length === 1, 'dieselbe Id, aber nicht unmittelbar davor: erlaubt');
  eh.bedingungen.min_abstand = minAbstand;
  R.letzte = [{ id: 'andere', k: p[0].p.schluessel, n: 17 }, { id: 'x', k: 'a', n: 18 }, { id: 'y', k: 'b', n: 19 }];
  ok(nur(['notruf_havarie_reaktor'], () => RE.kandidaten(g, R, '0305')).length === 0, 'derselbe Parametersatz als drittletztes Ereignis: noch verboten (Fenster drei)');
  R.letzte = [{ id: 'notruf_havarie_reaktor', k: 'x', n: 17 }, { id: 'andere', k: 'y', n: 18 }];
  ok(nur(['notruf_havarie_reaktor'], () => RE.kandidaten(g, R, '0305')).length === 0, 'Mindestabstand der Id (6 Sprünge): zu früh abgelehnt');
  R.n = 40;
  ok(nur(['notruf_havarie_reaktor'], () => RE.kandidaten(g, R, '0305')).length === 1, 'nach dem Mindestabstand wieder erlaubt');
  // Bedingungen: Besitzer, Rang, Lage
  R.letzte = [];
  ok(nur(['patrouille_rom_gruss'], () => RE.kandidaten(g, R, HEX.ger)).length === 0 && nur(['patrouille_rom_gruss'], () => RE.kandidaten(g, R, HEX.rom)).length === 1, 'Besitzer des Ankunftssektors: Roms Streife nur in römischem Raum');
  ws(g).ruf.rom = 0;
  ok(nur(['patrouille_ger_streife'], () => RE.kandidaten(g, R, HEX.ger)).length === 0, 'Rangfenster: Streife erst ab Optio (Miles: nicht)');
  ws(g).ruf.rom = 20;
  ok(nur(['patrouille_ger_streife'], () => RE.kandidaten(g, R, HEX.ger)).length === 1, 'Rangfenster: Optio genügt');
  // Lagefenster: Lage von Hand über Ereignisse und Macht ist umständlich; die Bedingung liest Regie.lage
  const lage = require('../server/sim/regie-befehle.js').lage(g).sieger;
  const gl = nur(['funk_lage_rom', 'funk_lage_ger', 'funk_lage_offen'], () => RE.kandidaten(g, R, HEX.rom));
  ok(gl.length === 1 && gl[0].e.id === 'funk_lage_' + lage, `Lagefenster: bei ${lage} genau die passende Meldung`);
  // Rangfenster nach oben (kein Katalogeintrag nutzt rang_max, eine Probe schon)
  const probe = klon(RE.KATALOG.find((e) => e.id === 'patrouille_rom_gruss')); probe.id = 'probe_rang'; probe.bedingungen.rang_max = 'miles'; KAT.push(probe);
  ws(g).ruf.rom = 60;
  const hoch = nur(['probe_rang'], () => RE.kandidaten(g, R, HEX.rom)).length;
  ws(g).ruf.rom = 0;
  const tief = nur(['probe_rang'], () => RE.kandidaten(g, R, HEX.rom)).length;
  KAT.pop();
  ok(hoch === 0 && tief === 1, 'Rangfenster nach oben: rang_max miles gilt nur für Miles');
  // keine Ereignisse während einer Sim-Szene
  const vorher = ws(g).reise.n; g.simSzene = { phase: 'kampf', hex: HEX.rom };
  const imKampf = sicher(() => { RE.zaehleSprung(g); return nur(['funk_handel_stimmen'], () => RE.entscheiden(g, HEX.rom2)); });
  g.simSzene = null; ws(g).reise.letzter = null; ws(g).reise.letzte = [];
  const danach = sicher(() => { RE.zaehleSprung(g); return nur(['funk_handel_stimmen'], () => RE.entscheiden(g, HEX.rom2)); });
  ok(imKampf === null && danach && ws(g).reise.n === vorher + 2, 'während einer Sim-Szene (Feindkontakt) kein Reise-Ereignis, danach wieder');
  ws(g).reise.letzter = null; ws(g).reise.letzte = [];
  // Notruf-Ort: nie der Ankunftssektor, im Abstandsfenster, spielbar mit Ort, nicht doppelt belegt
  const nahP = RE.parameterFuer(g, R, RE.KATALOG.find((e) => e.id === 'notruf_pirat_frachter'), HEX.rom);
  const umk = RE.umkreis(HEX.rom, 2, 3);
  const nahe = new Set(); for (let i = 0; i < 40; i++) { R.n = 100 + i; nahe.add(RE.parameterFuer(g, R, RE.KATALOG.find((e) => e.id === 'notruf_pirat_frachter'), HEX.rom).hex); }
  ok(nahP.hex !== HEX.rom && umk.includes(nahP.hex) && Sektoren.ortVonHex(nahP.hex) && nahe.size >= 2 && [...nahe].every((h) => h !== HEX.rom && !Sektoren.sindNachbarn(h, HEX.rom) && umk.includes(h)), `Notruf „nah“: Orte (${[...nahe].join(' ')}) liegen 2 bis 3 Sektoren entfernt, nie der Ankunftssektor oder ein Nachbar`);
  const nbP = RE.parameterFuer(g, R, RE.KATALOG.find((e) => e.id === 'notruf_havarie_reaktor'), HEX.rom);
  ok(Sektoren.sindNachbarn(nbP.hex, HEX.rom), `Notruf „nachbar“: Ort ${nbP.hex} grenzt an`);
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Funkmeldung und Mehrspieler zu dritt', () => {
  const t = spiel({ crew: 3, names: ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'] }); const g = t.g;
  ohneFlotten(g);
  const ev = sicher(() => nur(['funk_handel_stimmen'], () => springe(g, HEX.rom2)));
  ok(ev && ev.id === 'funk_handel_stimmen' && ev.art === 'funkmeldung', 'Sprung: eine Funkmeldung entsteht');
  const f = [0, 1, 2].map((i) => funkTexte(t, i).filter((x) => /Händlerfunk/.test(x)));
  ok(f.every((l) => l.length === 1) && f[0][0] === f[1][0] && f[1][0] === f[2][0], 'Funk geht an alle drei Spieler, genau einmal je Spieler');
  ok(ws(g).chronik.length === 1 && ws(g).chronik[0].art === 'reise' && ws(g).chronik[0].ref === 'funk_handel_stimmen', 'ein Chronik-Eintrag (das Ereignis ist nicht doppelt)');
  ok(ws(g).reise.n === 1 && ws(g).reise.letzte.length === 1, 'ein Sprung gezählt, ein Ereignis gemerkt');
  ok(!ws(g).chronik.some((c) => /Mireille|Ouzo|Tzvi/.test(JSON.stringify(c))), 'keine Spielernamen in der Chronik');
  ok(ws(g).ruf.rom === 0 && ws(g).wirkungenAngewandt === 0, 'Funkmeldung ändert nichts (kein Ruf, keine Wirkung)');
  // der Sprung danach: 2 Sprünge Pause, auch bei Wahrscheinlichkeit 1
  const e2 = sicher(() => springe(g, HEX.rom)), e3 = sicher(() => springe(g, HEX.rom2)), e4 = sicher(() => springe(g, HEX.rom));
  ok(!e2 && !e3 && e4, `nach einem Ereignis zwei Sprünge frei (${!!e2}, ${!!e3}), der dritte darf wieder (${!!e4})`);
});

section('Patrouille und Piraten: Ankündigung vor dem Eintreffen, Ausweichen', () => {
  const t = spiel({ crew: 3 }); const g = t.g; ohneFlotten(g);
  const ev = sicher(() => nur(['piraten_hinterhalt'], () => springe(g, HEX.saum)));
  const e = RE.KATALOG.find((x) => x.id === 'piraten_hinterhalt');
  ok(ev && ev.art === 'piraten', 'Sprung in den Saumraum: Piraten angekündigt');
  const ank = funkTexte(t).filter((x) => /Aufklärung|Rostmeute|Piraten/.test(x));
  ok(ank.length === 1 && /Sekunden/.test(ank[0]), 'Funk zuerst: die Ankündigung nennt die Zeit (' + (ank[0] || '').slice(0, 60) + ')');
  const gegner = () => g.space.enemies.filter((x) => /^reise/.test(x.tag || ''));
  ok(gegner().length === 0, 'beim Funk ist noch kein Gegner da');
  ok(ws(g).reise.laufend.length === 1 && ws(g).reise.laufend[0].ab - g.time >= e.parameter.vorlauf_s - 0.1, `Vorlauf ${e.parameter.vorlauf_s} s ist eingeplant`);
  lauf(g, e.parameter.vorlauf_s - 1.5);
  ok(gegner().length === 0, 'vor Ablauf des Vorlaufs kommt kein Gegner');
  const funkVor = funkTexte(t).length;
  lauf(g, 2.5);
  const nGegner = gegner().length;
  ok(nGegner >= e.parameter.schiffe.min && nGegner <= e.parameter.schiffe.max && nGegner === Math.max(e.parameter.schiffe.min, Math.min(e.parameter.schiffe.max, 3 + RE.WERTE.jaeger_je_spieler)), `nach dem Vorlauf kommen ${nGegner} Gegner (zu dritt, höchstens ${e.parameter.schiffe.max})`);
  const alle = funkTexte(t);
  ok(alle.length > funkVor && alle.indexOf(ank[0]) < alle.length - 1, 'danach der Funk beim Eintreffen, nach der Ankündigung');
  ok(ws(g).reise.laufend[0].phase === 'kampf', 'Phase Kampf');
  // Ausweichen: vor dem Eintreffen wegspringen
  const t2 = spiel(); const g2 = t2.g; ohneFlotten(g2);
  sicher(() => nur(['piraten_hinterhalt'], () => springe(g2, HEX.saum)));
  lauf(g2, 3);
  springe(g2, HEX.rom);   // weg (kein neues Ereignis: Abstand)
  lauf(g2, e.parameter.vorlauf_s + 3);
  ok(g2.space.enemies.filter((x) => /^reise/.test(x.tag || '')).length === 0 && ws(g2).reise.laufend.length === 0, 'wer vor dem Eintreffen springt, bekommt nichts und zahlt nichts');
  ok(rom(g2) === 0 && ws(g2).wirkungenAngewandt === 0, 'Ausweichen kostet nichts (kein Ruf, keine Wirkung)');
  // Patrouille der Germanen: gleiche Regel
  const t3 = spiel(); const g3 = t3.g; ohneFlotten(g3);
  const ev3 = sicher(() => nur(['patrouille_ger_spaeher'], () => springe(g3, HEX.ger)));
  ok(ev3 && ev3.art === 'patrouille' && /Späher/.test(funkTexte(t3).join(' ')), 'Patrouille der Germanen: Funk mit Ankündigung');
  lauf(g3, 14);
  ok(g3.space.enemies.some((x) => /^reise/.test(x.tag || '')), 'sie kommt nach dem Vorlauf');
  // römische Streife: keine Gefahr, kleine Folge
  const t4 = spiel(); const g4 = t4.g; ohneFlotten(g4);
  const ev4 = sicher(() => nur(['patrouille_rom_gruss'], () => springe(g4, HEX.rom)));
  ok(ev4 && ws(g4).reise.laufend.length === 0 && g4.space.enemies.length === 0, 'römische Streife: keine Gefahr, keine Gegner');
  ok(rom(g4) === require('../content/welt/ruf-werte.json').werte.quellen.wert.reise_patrouille_rom.delta, 'Folge über den Wirkungen-Katalog: Ruf +1 (reise_patrouille_rom)');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Notruf: Hinfliegen, Ablehnen kostet nichts, Verfall', () => {
  const ruhe = (g, k) => { for (let i = 0; i < k; i++) springe(g, i % 2 ? HEX.rom : HEX.rom2); };   // Sprünge ohne neue Ereignisse (Wahrscheinlichkeit 0)
  // Havarie: hinfliegen -> Hilfe, Ruf
  const t = spiel({ crew: 3 }); const g = t.g; ohneFlotten(g);
  const ev = sicher(() => nur(['notruf_havarie_reaktor'], () => springe(g, HEX.rom)));
  const R = ws(g).reise;
  ok(ev && ev.art === 'notruf' && R.offen.length === 1 && Marken.liste(g).some((m) => m.id === 'reise:n' + R.offen[0].nr && m.t === 'notruf'), 'Notruf: Funk, offener Eintrag und Marke auf der Karte');
  const ort = R.offen[0].hex;
  ok(ort !== HEX.rom && Sektoren.sindNachbarn(ort, HEX.rom) && /Fortuna/.test(funkTexte(t).join(' ')), 'der Notruf nennt einen Ort in der Nähe (' + ort + ')');
  const ruf0 = rom(g);
  const e2 = sicher(() => springe(g, ort), 0);
  ok(e2 === null && R.offen.length === 0 && !Marken.liste(g).some((m) => /^reise:/.test(m.id)), 'Hinfliegen: der Notruf ist beantwortet (kein neues Ereignis im selben Sprung), Marke weg');
  ok(rom(g) === ruf0 + require('../content/welt/ruf-werte.json').werte.quellen.wert.reise_hilfe_rom.delta, 'Folge: Ruf +3 bei Rom (ruf_aenderung, Grund reise_hilfe_rom)');
  const dank = RE.KATALOG.find((x) => x.id === 'notruf_havarie_reaktor').texte.dank;
  const f = [0, 1, 2].map((i) => funkTexte(t, i).filter((x) => dank.includes(x)).length);
  ok(f.every((x) => x === 1), 'Dank-Funk an alle drei, einmal');
  ok(ws(g).chronik.some((c) => /beantwortet/.test(c.kurz)), 'Chronik: beantwortet');
  // Überfall: Gefahr kommt NACH der Ankündigung, Hilfe zählt erst nach dem Kampf
  const t2 = spiel(); const g2 = t2.g; ohneFlotten(g2);
  sicher(() => nur(['notruf_pirat_frachter'], () => springe(g2, HEX.rom)));
  const R2 = ws(g2).reise, o2 = R2.offen[0];
  ok(/Piraten|Räuber/.test(funkTexte(t2).join(' ')), 'der Notruf nennt die Gefahr im Text (Piraten): keine Scheinwahl');
  const ruf2 = rom(g2);
  sicher(() => springe(g2, o2.hex), 0);
  ok(R2.laufend.length === 1 && R2.laufend[0].phase === 'erwartet' && rom(g2) === ruf2, 'beim Eintreffen: Vorlauf läuft, noch keine Gegner, noch kein Ruf');
  const vor = funkTexte(t2).length;
  lauf(g2, RE.KATALOG.find((x) => x.id === 'notruf_pirat_frachter').parameter.vorlauf_s + 1);
  const tag = R2.laufend[0].tag;
  ok(g2.space.enemies.filter((x) => x.tag === tag).length >= 2 && funkTexte(t2).length > vor, 'danach kommen die Räuber, mit Funk');
  ok(rom(g2) === ruf2 && R2.laufend.length === 1, 'solange die Räuber leben: noch kein Ruf');
  g2.space.enemies = g2.space.enemies.filter((x) => x.tag !== tag);
  g2.step();
  ok(rom(g2) === ruf2 + 3 && R2.laufend.length === 0, 'Gegner besiegt: Ruf +3 (Hilfe geleistet)');
  ok(funkTexte(t2).some((x) => RE.KATALOG.find((e) => e.id === 'notruf_pirat_frachter').texte.dank.includes(x)), 'Dank-Funk nach dem Kampf');
  // Ablehnen kostet nichts: Sim und Ruf wie in einem Spiel ohne Ereignisse
  const a = spiel(), b = spiel({ env: { REISE_EREIGNISSE: 'off' } });
  for (const x of [a.g, b.g]) ohneFlotten(x);
  sicher(() => nur(['notruf_pirat_haendler'], () => springe(a.g, HEX.saum))); springe(b.g, HEX.saum);
  ok(ws(a.g).reise.offen.length === 1 && ws(b.g).reise.n === 0, 'Ausgangslage: A hat einen offenen Notruf, B (Ereignisse aus) keinen und zählt nicht');
  const nr = ws(a.g).reise.offen[0].nr;
  ok(RE.ablehnen(a.g, nr) === true && ws(a.g).reise.offen.length === 0 && !Marken.liste(a.g).some((m) => /^reise:/.test(m.id)), 'ablehnen(): Notruf weg, Marke weg');
  ok(RE.ablehnen(a.g, nr) === false, 'zweimal ablehnen: nichts');
  sicher(() => ruhe(a.g, 3), 0); ruhe(b.g, 3);
  ok(abbild(a.g) === abbild(b.g) && JSON.stringify(ws(a.g).ruf) === JSON.stringify(ws(b.g).ruf) && ws(a.g).wirkungenAngewandt === ws(b.g).wirkungenAngewandt && ws(a.g).wirkungenVerworfen === ws(b.g).wirkungenVerworfen, 'Ablehnen kostet nichts: Sim, Ruf und Wirkungen gleich wie ohne Ereignis');
  ok(ws(a.g).chronik.some((c) => /abgelehnt/.test(c.kurz)), 'Chronik: Notruf abgelehnt');
  // Verfall durch Nichtstun: gleich
  const c = spiel(), d = spiel({ env: { REISE_EREIGNISSE: 'off' } });
  for (const x of [c.g, d.g]) ohneFlotten(x);
  sicher(() => nur(['notruf_pirat_haendler'], () => springe(c.g, HEX.saum))); springe(d.g, HEX.saum);
  sicher(() => ruhe(c.g, RE.WERTE.notruf_gilt_spruenge + 2), 0); ruhe(d.g, RE.WERTE.notruf_gilt_spruenge + 2);
  ok(ws(c.g).reise.offen.length === 0 && !Marken.liste(c.g).some((m) => /^reise:/.test(m.id)) && abbild(c.g) === abbild(d.g) && JSON.stringify(ws(c.g).ruf) === JSON.stringify(ws(d.g).ruf), 'verfällt unbeantwortet: Marke weg, Sim und Ruf unverändert');
  ok(ws(c.g).chronik.some((x) => /unbeantwortet/.test(x.kurz)), 'Chronik: unbeantwortet');
});

section('Sim-Notruf aufnehmen', () => {
  const t = spiel(); const g = t.g;
  const W = ws(g), z = W.zustand;
  // ein Notruf der Sim: Ereignis im Ring plus Notruf im Wissen von Rom (Marke lage:n1) bei 0504 (Saumraum)
  const simEv = { n: 1, typ: 'notruf', fraktion: 'kon', art: 'piratenueberfall', ort: '0504', ortName: 'Test', opfer: 'kon', angreifer: 'pirat', staerke: 5, klasse: 1, angriff: 77 };
  W.ereignisse.push(simEv);
  W.wissen.notrufe = [{ an: 77, h: '0504', m: 'lage:n1', t: 1, s: 1 }];
  const zuvor = Marken.liste(g).length;
  const R = W.reise;
  const k = nur(['notruf_pirat_haendler'], () => RE.kandidaten(g, R, HEX.frei));
  ok(k.length === 1 && k[0].p.hex === '0504' && k[0].p.sim === 'lage:n1', 'Katalog-Notruf nimmt den Sim-Notruf auf (Ort und Art), statt einen eigenen zu erfinden');
  const ev = sicher(() => nur(['notruf_pirat_haendler'], () => springe(g, HEX.frei)));
  ok(ev && R.offen.length === 0 && Marken.liste(g).length === zuvor, 'ohne eigene Marke und ohne eigenen Offen-Eintrag (die Sim kennt den Notruf)');
  ok(ws(g).chronik.some((c) => c.param && c.param.hex === '0504'), 'Chronik nennt den Sim-Ort');
  // falsche Art: kein Platz für diesen Katalogeintrag mit der Sim, aber ein eigener Ort
  simEv.art = 'belagerung'; R.letzte = [];
  const k2 = nur(['notruf_pirat_haendler'], () => RE.kandidaten(g, R, HEX.frei));
  ok(k2.length === 1 && k2[0].p.sim === null, 'passt die Art nicht, entsteht ein eigener Notruf');
  void z;
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Schnellsprung: Abbruch bei einem Ereignis', () => {
  // Route über drei erkundete Hexe: Ostia Nova (0305) -> 0304 -> 0303 -> 0302?  Die Kette wird aus den Nachbarn gebaut.
  function kette(g, laenge) {
    let h = Sektoren.hexVonOrt(g.ship.scene); const out = [];
    const nicht = new Set([h]);
    while (out.length < laenge) {
      const nb = Sektoren.nachbarn(h).find((x) => !nicht.has(x) && Sektoren.spielbar(x) && !Sektoren.istLeerraum(x) && Sektoren.ortVonHex(x) && ['rom', 'saum', 'frei'].includes(Besitz.besitzer(g, x) || 'frei') && (Sektoren.kante(h, x) || {}).art !== 'far' && (Sektoren.kante(h, x) || {}).art !== 'hidden' && Sektoren.kante(h, x));
      if (!nb) break; out.push(nb); nicht.add(nb); h = nb;
    }
    return out;
  }
  function vorbereiten(t, laenge) {
    const g = t.g; ohneFlotten(g); g.space.enemies = [];
    g.C.reise.neutralChance = 0; g.C.reise.neutralPlus = 0; g.C.reise.feindChance = 0;
    const von = Sektoren.hexVonOrt(g.ship.scene);
    const hops = kette(g, laenge);
    let a = von;
    for (const h of hops) { g.explore.erkunde(h); g.explore.markBoje(Sektoren.kanteId(a, h)); a = h; }
    g.explore.erkunde(von);
    g.reisePlan = { ziel: Sektoren.ortVonHex(hops[hops.length - 1]), hops: hops.slice() };
    const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0;
    const p = Sprung.sprungpunkt(g, hops[0]); s.x = p.x - 80; s.y = p.y;
    s.jump.dest = Sektoren.ortVonHex(hops[0]); s.jump.charge = 1; s.jump.ready = true;
    return hops;
  }
  // Kontrolle: ohne Ereignis läuft die Reise durch
  const t0 = spiel(); const g0 = t0.g; const h0 = vorbereiten(t0, 3);
  ok(h0.length === 3, `Strecke aus drei Hexen: ${h0.join(' → ')}`);
  const err0 = Reise.befehl(g0);
  sicher(() => lauf(g0, 14), 0);
  ok(err0 === null && !g0.reise && Sektoren.hexVonOrt(g0.ship.scene) === h0[2], 'ohne Ereignis: der Schnellsprung erreicht das Ziel');
  // mit Ereignis: bricht nach dem ersten Hop ab, Rest der Strecke bleibt offen
  const t1 = spiel(); const g1 = t1.g; const h1 = vorbereiten(t1, 3);
  const odas = []; const odaEcht = g1.oda.bind(g1); g1.oda = (x, k) => { odas.push(x); return odaEcht(x, k); };
  ok(Reise.befehl(g1) === null && g1.reise, 'Schnellsprung läuft');
  nur(['funk_handel_stimmen'], () => sicher(() => lauf(g1, 5)));
  ok(!g1.reise && Sektoren.hexVonOrt(g1.ship.scene) === h1[0], 'ein Ereignis im ersten Hop beendet den Schnellsprung dort');
  ok(g1.reisePlan && g1.reisePlan.hops.join() === h1.slice(1).join(), 'der Rest der Strecke bleibt gewählt (Faltsprung setzt ihn fort)');
  ok(odas.some((x) => /^Schnellsprung unterbrochen: /.test(x)) && t1.cs[0].inbox.some((m) => m.t === 'event' && m.kind === 'schnellsprung' && m.phase === 'ende'), 'Meldung „Schnellsprung unterbrochen: …“ (ODA) und Ende-Ereignis');
  ok(ws(g1).chronik.length === 1 && ws(g1).reise.n === 1, 'ein Hop gezählt, ein Chronik-Eintrag');
  // Reise-Ereignis hat Vorrang vor dem Abfangen: im selben Hop kein zweites Ereignis
  const t2 = spiel(); const g2 = t2.g; const h2 = vorbereiten(t2, 2);
  for (const h of h2) ws(g2).zustand.hexe[h] && (ws(g2).zustand.hexe[h].besitzer = 'ger');   // feindlich: Abfangen würde sicher würfeln
  g2.weltBesitz.hexe[h2[0]].besitzer = 'ger';
  g2.C.reise.feindChance = 1;
  Reise.befehl(g2);
  nur(['funk_handel_stimmen', 'patrouille_ger_spaeher'], () => sicher(() => lauf(g2, 5)));
  ok(!g2.reise && !g2.space.enemies.some((x) => x.tag === 'abfang'), 'Ereignis im Hop: das Abfangen wird nicht zusätzlich gewürfelt (kein doppeltes Ereignis)');
  // Abfangen zählt für den Abstand
  const t3 = spiel(); const g3 = t3.g; ohneFlotten(g3);
  g3.C.reise.feindChance = 1; g3.weltBesitz.hexe[HEX.ger] = { besitzer: 'ger', posten: false };
  const n1 = ws(g3).reise.n;
  sicher(() => Sprung.springeNach(g3, Sektoren.ortVonHex(HEX.ger)), 0);   // der Hop selbst bringt kein Reise-Ereignis
  g3.space.enemies = [];
  ok(ws(g3).reise.letzter === null && ws(g3).reise.n === n1 + 1, 'Ausgangslage: der Hop ohne Ereignis, nichts gemerkt');
  Reise.abfangen(g3, HEX.ger);
  ok(ws(g3).reise.letzter === ws(g3).reise.n && g3.space.enemies.some((x) => x.tag === 'abfang'), 'Abfangen: gilt für den Abstand (letzter = aktueller Sprung)');
  const folge = [sicher(() => springe(g3, HEX.rom)), sicher(() => springe(g3, HEX.rom2))];
  const dritter = sicher(() => springe(g3, HEX.rom));
  ok(!folge[0] && !folge[1] && dritter, 'nach dem Abfangen zwei Sprünge ohne Reise-Ereignis, danach wieder möglich');
  // Notfallsprung ist kein Reise-Sprung
  const t4 = spiel(); const g4 = t4.g; ohneFlotten(g4);
  g4.ship.docked = false; g4.ship.dockedAt = null; g4.players.forEach((p) => { p.zone = 'bridge'; });
  const nVor = ws(g4).reise.n;
  sicher(() => Sprung.notsprung(g4));
  ok(ws(g4).reise.n === nVor, 'Notfallsprung zählt nicht und löst kein Reise-Ereignis aus');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Sim-Parität und Schalter', () => {
  const reihe = (g, mitEreignis) => {
    const hexe = ['0305', '0304', '0204', '0305', '0105', '0203', '0305', '0405', '0305', '0304'];
    for (let r = 0; r < 12; r++) for (const h of hexe) { if (mitEreignis) sicher(() => springe(g, h), 0.3); else springe(g, h); }
  };
  const a = spiel({ seed: 21 }), b = spiel({ seed: 21, env: { REISE_EREIGNISSE: 'off' } });
  reihe(a.g, true); reihe(b.g, false);
  ok(ws(a.g).reise.n === 120 && ws(a.g).reise.letzte.length > 0 && ws(b.g).reise.n === 0, `Ausgangslage: 120 Sprünge, mit ${ws(a.g).chronik.filter((c) => c.art === 'reise').length} Ereignissen im Spiel A, keine im Spiel B (Schalter aus)`);
  ok(abbild(a.g) === abbild(b.g) && ws(a.g).tickZahl === ws(b.g).tickZahl, 'Sim-Zustand byte-gleich mit und ohne Reise-Ereignisse (die Ereignisse verändern die Sim nicht)');
  ok(ws(b.g).chronik.every((c) => c.art !== 'reise'), 'Schalter aus: keine Reise-Ereignisse, keine Chronik der Ereignisse');
  const c = spiel({ env: {} }); const c2 = spiel({ env: { REISE_EREIGNISSE: '0' } }); const c3 = spiel({ env: { REISE_EREIGNISSE: 'on' } });
  ok(RE.aktiv(c.g) === (RE.WERTE.standard_an === true) && RE.WERTE.standard_an === false && !RE.aktiv(c2.g) && RE.aktiv(c3.g), 'Standard aus (Datum standard_an), REISE_EREIGNISSE=1/on an, 0/off aus');
  // Matrix Lage-Spielleiter × REISE_EREIGNISSE
  const mx = [];
  for (const lage of [{}, { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock' }, { LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'off' }, { SPIELLEITER_LLM: 'mock' }]) for (const r of [undefined, '1', '0']) {
    const env = Object.assign({}, lage); if (r) env.REISE_EREIGNISSE = r;
    const an = lage.LAGE_SPIELLEITER === '1' && lage.SPIELLEITER_LLM === 'mock';
    const soll = r === '1' ? true : r === '0' ? false : an;
    mx.push(RE.aktiv({ weltsim: { zustand: {} }, env }) === soll);
  }
  ok(mx.every(Boolean), 'Matrix: ohne REISE_EREIGNISSE folgt der Schalter dem Lage-Spielleiter (an nur mit LAGE_SPIELLEITER=1 und SPIELLEITER_LLM ≠ off), REISE_EREIGNISSE=1/0 überschreibt');
  // ohne Modus (Kampagne): nichts
  ok(RE.nachSprung({ weltsim: null, env: ENV }, 'ostia_nova') === null && RE.entscheiden({ weltsim: null }, '0305') === null, 'ohne Modus Freie Fahrt Sund: nichts');
});

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------
section('Weltstand: Speichern, Laden, Altstand, Müll', () => {
  const t = spiel(); const g = t.g; ohneFlotten(g);
  for (let i = 0; i < 80; i++) sicher(() => springe(g, [HEX.rom, HEX.rom2, '0204', '0105'][i % 4]), 0.3);
  g.space.enemies = [];
  const R = ws(g).reise;
  ok(R.n === 80 && R.letzte.length > 0, `Ausgangslage: ${R.n} Sprünge, ${R.letzte.length} gemerkte Ereignisse`);
  const d1 = klon(Weltstand.capture(g));
  ok(d1.version === 3 && d1.welt.sim.reise && d1.welt.sim.reise.n === 80 && Array.isArray(d1.welt.sim.chronik) && d1.welt.sim.chronik.length > 0, 'Weltstand Version 3 trägt welt.sim.reise und welt.sim.chronik');
  const v = Weltstand.validate(d1);
  ok(v.length === 0, 'schemagültig' + v.slice(0, 2).map((x) => ' – ' + x).join(''));
  ok(!('offen' in d1.welt.sim.reise) && !('laufend' in d1.welt.sim.reise), 'offene Notrufe und laufende Gefahren stehen nicht im Weltstand');
  const dir = F.freshDir(); d1.id = 'w-reise'; fs.writeFileSync(path.join(dir, 'w-reise.json'), JSON.stringify(d1));
  const g2 = spiel({ dir, world: 'w-reise' }).g;
  ok(g2.phase === 'play' && g2.weltsim && g2.errors === 0, 'Laden: das Spiel läuft');
  ok(F.gleich(RE.toSave(ws(g2)), RE.toSave(ws(g))) && F.gleich(Chronik.toSave(ws(g2)), Chronik.toSave(ws(g))), 'Zähler, Wiederholungsdaten und Chronik sind nach dem Laden gleich');
  const d2 = klon(Weltstand.capture(g2));
  ok(F.gleich(d2.welt.sim.reise, d1.welt.sim.reise) && F.gleich(d2.welt.sim.chronik, d1.welt.sim.chronik), 'Runde Speichern, Laden, Speichern: gleich');
  // Weiterspielen nach dem Laden = Durchspielen (gleicher Strom)
  const hexe = [HEX.rom, HEX.rom2, '0204', '0105'];
  const weiter = (x, von) => { const out = []; for (let i = von; i < von + 200; i++) { RE.zaehleSprung(x); const e = RE.entscheiden(x, hexe[i % 4]); if (e) out.push(e.id + '@' + e.nr + ':' + e.hex); } return out.join(); };
  const direkt = weiter(g, 80);
  ok(direkt.length > 20 && weiter(g2, 80) === direkt, 'nach dem Laden geht dieselbe Reihe weiter wie ohne Speichern');
  // Altstand ohne die Blöcke
  const alt = klon(d1); delete alt.welt.sim.reise; delete alt.welt.sim.chronik; alt.id = 'w-alt'; fs.writeFileSync(path.join(dir, 'w-alt.json'), JSON.stringify(alt));
  ok(Weltstand.validate(alt).length === 0, 'Altstand ohne die Blöcke: schemagültig (additiv)');
  const g3 = spiel({ dir, world: 'w-alt' }).g;
  ok(g3.phase === 'play' && ws(g3).reise.n === 0 && ws(g3).chronik.length === 0 && g3.errors === 0, 'Altstand lädt: Zähler 0, Chronik leer');
  // Ruhezustand: kein Block
  const frisch = klon(Weltstand.capture(spiel().g));
  ok(!('reise' in frisch.welt.sim) && !('chronik' in frisch.welt.sim), 'Ruhezustand (nichts geschehen): keine Blöcke, wie im Altstand');
  // Müll im Leser
  ok(RE.lesen(null).n === 0 && RE.lesen('x').n === 0 && RE.lesen([]).n === 0 && RE.lesen({ n: 'x', letzte: 5 }).letzte.length === 0, 'Leser: Müll = Anfang');
  const m = RE.lesen({ n: 10, letzter: 99, letzte: [{ id: 'gibt_es_nicht', k: 'x', n: 1 }, { id: 'funk_lage_rom', k: 'k', n: 50 }, null, { id: 'funk_lage_rom' }] });
  ok(m.n === 10 && m.letzter === 10 && m.letzte.length === 1 && m.letzte[0].n === 10, 'Leser: unbekannte Ids und kaputte Einträge fallen weg, Zeiten werden auf die Gegenwart geklemmt');
});

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
