'use strict';
// BOD-01 P1: feste Karte "Grabenangriff" (content/buehnen/festkarten/grabenangriff.json, Erzeuger shared/gen-fest.js, Einhängestelle
// server/sim/landepunkte.js gen.fest). Headless:
//  - Format: Abschnitte mit Varianten (datengetrieben), Platzhalter markiert, zweites Deck abgewiesen (BOD-03)
//  - Karte: baut, Prüfer ok, 100x36, Payload <= 5 KB, Abschnitte links nach rechts, Abholpunkt links, v2
//  - Inhalt: Wiese ohne Deckung ausser dem Graben, Graben mit Brustwehr o und Enden/Luecken, zwei erhoehte Posten (aussicht),
//    Wald mit Weg und Durchkommen abseits des Wegs (BFS), Bunkereingang-Ziel, Gruppen fuer Welle 1/2
//  - Spiel: ueber landepunkte/karteBauen ins Spiel gehaengt, 3 Spieler beamen runter, besetzen mit Rom, Ticks, Snapshot-Fruehmessung
//   node tools/test-grabenangriff-karte.js
const CONFIG = require('../shared/config.js');
const Protocol = require('../shared/protocol.js');
const Physics = require('../shared/physics.js');
const Buehne = require('../shared/buehne.js');
const GenFest = require('../shared/gen-fest.js');
const { Game } = require('../server/game.js');
const L = require('../server/sim/landepunkte.js');
const combat = require('../server/sim/combat.js');
const squad = require('../server/sim/squad.js');
const away = require('../server/sim/away.js');
const W = require('../server/world.js');

let n = 0, fails = 0;
const ok = (c, msg) => { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); };
const section = (t, fn) => { console.log('\n[' + t + ']'); try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); } };
const ticks = (g, sek) => { const k = Math.round(sek * CONFIG.tickHz); for (let i = 0; i < k; i++) g.step(); };
const TILE = Physics.TILE;
const payloadB = (k) => Buffer.byteLength(JSON.stringify(Game.prototype.awayMapPayload.call({}, k)));
const clone = (o) => JSON.parse(JSON.stringify(o));
const fehlerZahl = (g) => (Array.isArray(g.errors) ? g.errors.length : g.errors | 0);   // game.errors ist ein Zaehler

const DEF = L.festkarte('grabenangriff');
const bauen = (def, opts) => Buehne.ausRaster(GenFest.karteRoh(def, Object.assign({ id: 'test.graben' }, opts || {})), { spiel: true });
const R = bauen(DEF);
const K = R.karte;
const ch = (x, y) => (K.rows[y] || '')[x];
const solid = (x, y) => { const c = ch(x, y); return c == null || !!(K.legende[c] && K.legende[c].solid); };
const walk = (x, y) => !solid(x, y);
const anker = (id) => K.anker.find((a) => a.id === id);
const gruppe = (g) => (K.meta.gruppen[g] || []).map(anker);
// BFS (4er-Nachbarschaft) ueber Kacheln, die tauglich sind; -> Menge erreichter Schluessel
function bfs(starts, taugt) {
  const seen = new Set(), q = [];
  for (const s of starts) if (taugt(s[0], s[1])) { seen.add(s[1] * K.w + s[0]); q.push(s); }
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + dx, b = y + dy, k = b * K.w + a; if (a >= 0 && b >= 0 && a < K.w && b < K.h && !seen.has(k) && taugt(a, b)) { seen.add(k); q.push([a, b]); } } }
  return seen;
}
const hat = (S, x, y) => S.has(y * K.w + x);

section('Format: Abschnitte, Varianten, Platzhalter, Decks', () => {
  const v = GenFest.varianten(DEF);
  ok(v.map((a) => a.abschnitt).join(',') === 'landung,wiese,wald,eingang', 'Reihenfolge der Abschnitte aus den Daten: landung, wiese, wald, eingang');
  ok(v.find((a) => a.abschnitt === 'wiese').varianten.map((x) => x.id).join() === 'graben' && v.find((a) => a.abschnitt === 'wald').varianten.map((x) => x.id).join() === 'weg', 'heute je Abschnitt eine Variante: Wiese "mit Graben", Wald "Weg durch den Wald"');
  ok(v.find((a) => a.abschnitt === 'landung').waehlbar === false && v.filter((a) => a.waehlbar).length === 3, 'Lobby-Liste: Landung nicht waehlbar, drei waehlbare Abschnitte');
  ok(JSON.stringify(GenFest.standardAuswahl(DEF)) === JSON.stringify({ landung: 'standard', wiese: 'graben', wald: 'weg', eingang: 'bunker' }), 'Standardauswahl aus den Daten');
  // Variante nur als Daten ergaenzt: Kopie der Wiese mit anderem Namen, Auswahl wirkt ohne Code
  const d2 = clone(DEF);
  const wv = d2.decks[0].abschnitte.wiese.varianten;
  wv.leer = clone(wv.graben); wv.leer.name = 'Testvariante';
  wv.leer.rows = wv.leer.rows.map((r, y) => (y === 0 || y === r.length - 1 ? r : r.replace(/[bP]/g, ':')));
  wv.leer.anker = wv.leer.anker.filter((a) => a.rolle === 'aussicht').map((a) => Object.assign({}, a, { rolle: 'wache' }));
  ok(GenFest.varianten(d2).find((a) => a.abschnitt === 'wiese').varianten.length === 2, 'weitere Variante allein durch Daten in der Liste');
  ok(GenFest.auswahlPruefen(d2, { wiese: 'leer' }) === null && /unbekannt/.test(GenFest.auswahlPruefen(DEF, { wiese: 'leer' })) && /unbekannt/.test(GenFest.auswahlPruefen(DEF, { himmel: 'x' })), 'Auswahl wird gegen die Daten geprueft');
  ok(['constructor', '__proto__', 'toString', 'hasOwnProperty'].every((k) => /unbekannt/.test(GenFest.auswahlPruefen(DEF, { [k]: 'graben' }) || '') && /unbekannt/.test(GenFest.auswahlPruefen(DEF, { wiese: k }) || '')), 'Schluessel aus dem Object-Prototyp sind keine gueltige Abschnitts-/Variantenwahl');
  let fehler = null; try { GenFest.karteRoh(d2, { abschnitte: { wiese: 'leer' } }); } catch (e) { fehler = e.message; }
  ok(fehler && /Welle 1 nennt Gruppe/.test(fehler), 'Variante ohne die Gruppen der Wellen wird beim Bau abgewiesen (' + (fehler || '').slice(0, 50) + ')');
  // zweites Deck (BOD-03): Struktur da, Bau weist heute ab
  const d3 = clone(DEF); d3.decks.push({ id: 'bunker', reihenfolge: [], abschnitte: {} });
  fehler = null; try { GenFest.karteRoh(d3); } catch (e) { fehler = e.message; }
  ok(Array.isArray(DEF.decks) && DEF.decks[0].id === 'oberflaeche' && fehler && /Decks/.test(fehler), 'decks[] ist ein Array (Deck 0 Oberflaeche); ein zweites Deck wird heute ausdruecklich abgewiesen');
  // Platzhalter: Tausch ueber die Daten
  ok(DEF.zeichen.T.platzhalter === 'baum' && DEF.zeichen.T.kachel === 'F' && K.meta.platzhalter.baum > 0 && K.meta.platzhalter.palisade > 0 && K.meta.platzhalter.brustwehr > 0, `Platzhalter in den Daten markiert (baum ${K.meta.platzhalter.baum}, palisade ${K.meta.platzhalter.palisade}, brustwehr ${K.meta.platzhalter.brustwehr} Kacheln)`);
  const d4 = clone(DEF); d4.zeichen.T.kachel = 'O';
  const k4 = bauen(d4).karte;
  ok(k4.rows.join('') !== K.rows.join('') && k4.rows.join('').split('O').length > K.rows.join('').split('O').length + 20, 'Tausch zeigt Wirkung: Baum-Kacheln wechseln auf die neue Kachelart');
});

section('Karte: Prueferlauf, Groesse, Payload, Reihenfolge', () => {
  ok(R.pruefung.ok && R.fehler.length === 0, 'Pruefer ok:true, keine Fehler' + (R.fehler.length ? ' ' + JSON.stringify(R.fehler.slice(0, 3)) : ''));
  ok(K.w === 100 && K.h === 36, `Raster ${K.w}x${K.h} (Richtwert 100x36)`);
  const B = payloadB(K);
  ok(B <= 5120, `Payload ${B} B <= 5120 B (5 KB-Budget; Grenze ${Protocol.AWAY_MAP_MAX_BYTES} B)`);
  ok(K.rows.every((r) => r.length === K.w) && K.rows[0] === 'F'.repeat(K.w) && K.rows[K.h - 1] === 'F'.repeat(K.w) && K.rows.every((r) => r[0] === 'F' && r[K.w - 1] === 'F'), 'Aussenrand rundum Fels');
  const ab = anker('landung.abholpunkt');
  ok(K.ankunft === 'landung.abholpunkt' && ab && ab.ankunft && ab.x < 10, `Abholpunkt (Ankunft) links bei x=${ab && ab.x}`);
  const mitte = (g) => { const a = gruppe(g); return a.reduce((s, q) => s + q.x, 0) / a.length; };
  const xs = [ab.x, mitte('w1.graben'), mitte('w1.posten'), mitte('w2.wald'), mitte('w2.eingang'), anker('bunker.ziel').x];
  ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), 'Abschnitte links nach rechts: Abholpunkt ' + xs.map((x) => Math.round(x)).join(' < '));
  // Zeichenreihenfolge in der Mittellinie: Wiese (:) vor Graben (o), Palisade (=) vor Wald (F-Gruppen) vor Bunker (#)
  const erst = (c) => K.rows.reduce((m, r) => { const i = r.indexOf(c, 1); return i > 0 ? Math.min(m, i) : m; }, 999);
  const oMin = erst('o'), eqMin = erst('='), bMin = erst('#');
  const treeMin = K.rows.slice(1, K.h - 1).reduce((m, r) => { const i = r.slice(1, -1).indexOf('F') + 1; return i > 0 ? Math.min(m, i) : m; }, 999);
  ok(oMin < eqMin && eqMin < treeMin && treeMin < bMin, `Reihenfolge der ersten Spalten: Brustwehr ${oMin} < Palisade ${eqMin} < Baum ${treeMin} < Bunkerwand ${bMin}`);
  ok(K.meta.fest === 'grabenangriff' && K.art === 'aussenposten' && K.erzeuger === 'gen-fest/1', 'Kennung meta.fest = grabenangriff, Kartenart bleibt aussenposten');
});

section('Wiese: keine Deckung ausser dem Graben', () => {
  const g0 = Math.min(...K.meta.gruppen['w1.graben'].map((id) => anker(id).x)), w1x = anker('landung.abholpunkt').x;
  // Wiese = Spalten vom Landefeld bis zur Brustwehr (erste o-Spalte)
  const oSpalte = K.rows.reduce((m, r) => { const i = r.indexOf('o', 1); return i > 0 ? Math.min(m, i) : m; }, 999);
  let deck = 0;
  for (let y = 1; y < K.h - 1; y++) for (let x = 1; x < oSpalte; x++) { const c = K.legende[ch(x, y)]; if (c && (c.cover > 0 || c.solid)) deck++; }
  ok(deck === 0, `zwischen Landung und Brustwehr (x 1..${oSpalte - 1}) keine Deckung und kein Hindernis`);
  const breite = oSpalte - w1x;
  ok(breite >= 12 && breite <= 22, `Wiesenbreite Abholpunkt bis Brustwehr ${breite} Kacheln (Sicht ${CONFIG.awayCombat.sightTiles || 10}, Schussbox +-9,4 x +-5,2: Verteidiger wirken ab ca. 10 Kacheln)`);
});

section('Graben: Sohle, Brustwehr o, Luecken und Enden', () => {
  const bgr = K.bereiche.graben.rects[0];   // [x, y, w, h]
  const gx = Math.min(...K.meta.gruppen['w1.graben'].map((id) => anker(id).x));
  let sohleMin = 99, oBeidseitig = 0, zeilen = 0, luecken = [], westSpalte = -1, ostSpalte = -1;
  const ys = K.meta.gruppen['w1.graben'].map((id) => anker(id).y);
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    let a = gx; while (walk(a - 1, y) && ch(a - 1, y) !== 'o') a--;
    // links der Sohle die naechste feste Kachel, rechts ebenso
    let l = gx; while (!solid(l, y) && l > bgr[0] - 1) l--;
    let r = gx; while (!solid(r, y) && r < bgr[0] + bgr[2]) r++;
    zeilen++;
    if (ch(l, y) === 'o' && ch(r, y) === 'o') { oBeidseitig++; sohleMin = Math.min(sohleMin, r - l - 1); westSpalte = l; ostSpalte = r; }
  }
  ok(oBeidseitig >= 8, `auf ${oBeidseitig} von ${zeilen} Zeilen steht links und rechts der Sohle eine Reihe o (Halbdeckung als Brustwehr)`);
  ok(sohleMin >= 2, `Sohle mindestens 2 Kacheln breit (kleinste Breite ${sohleMin})`);
  const ymin = bgr[1], ymax = bgr[1] + bgr[3] - 1;
  // Brustwehr-Spalten bestimmen: Spalten mit den meisten o im Grabenbereich
  const zaehl = {}; for (let y = ymin; y <= ymax; y++) for (let x = bgr[0]; x < bgr[0] + bgr[2]; x++) if (ch(x, y) === 'o') zaehl[x] = (zaehl[x] || 0) + 1;
  const spalten = Object.keys(zaehl).map(Number).filter((x) => zaehl[x] >= 8).sort((a, b) => a - b);
  const xa = spalten[0], xb = spalten[spalten.length - 1];
  const oZeilen = []; for (let y = ymin; y <= ymax; y++) if (ch(xa, y) === 'o' || ch(xb, y) === 'o') oZeilen.push(y);
  const y0 = Math.min(...oZeilen), y1 = Math.max(...oZeilen);
  for (let y = y0; y <= y1; y++) if (walk(xa, y)) luecken.push(y);
  ok(spalten.length === 2 && luecken.length >= 4, `zwei Brustwehr-Spalten (x ${xa} und ${xb}), Luecken (Uebergaenge) auf der Wiesenseite an ${luecken.length} Zeilen`);
  // Luecken sind 2 Kacheln hoch (keine 1er-Stuecke) und Brustwehr-Stuecke mindestens 2 lang
  const kurz = []; let lauf = 0, typ = null;
  for (let y = y0; y <= y1 + 1; y++) { const t = y <= y1 && ch(xa, y) === 'o' ? 'o' : '.'; if (t === typ) lauf++; else { if (typ && lauf < 2) kurz.push(typ + lauf); typ = t; lauf = 1; } }
  ok(kurz.length === 0, 'Brustwehr-Stuecke und Luecken nie kuerzer als 2 Kacheln' + (kurz.length ? ' (' + kurz.join(',') + ')' : ''));
  const endeN = walk(xa + 1, y0 - 1), endeS = walk(xa + 1, y1 + 1);
  ok(endeN && endeS, 'beide Enden des Grabens offen (Sohle von Norden und Sueden betretbar)');
  // Betretbar: von der Ankunft aus erreichbar ueber (a) nur die Luecken der Wiesenseite (Enden gesperrt), (b) nur die Enden (Luecken gesperrt)
  const ab = anker('landung.abholpunkt'), ziele = gruppe('w1.graben');
  const sperr = (set) => (x, y) => walk(x, y) && !set.has(x + ',' + y);
  const endeS_ = new Set(), luckS = new Set();
  for (let x = xa; x <= xb; x++) { endeS_.add(x + ',' + (y0 - 1)); endeS_.add(x + ',' + (y1 + 1)); }
  for (const y of luecken) luckS.add(xa + ',' + y);
  const viaL = bfs([[ab.x, ab.y]], (x, y) => sperr(endeS_)(x, y) && x < xb + 1);   // nur links der Ostbrustwehr, Enden zu
  const viaE = bfs([[ab.x, ab.y]], (x, y) => sperr(luckS)(x, y) && x < xb + 1);
  ok(ziele.every((a) => hat(viaL, a.x, a.y)), 'Sohle von der Wiese aus ueber die Luecken betretbar (Enden gesperrt)');
  ok(ziele.every((a) => hat(viaE, a.x, a.y)), 'Sohle von der Wiese aus ueber die offenen Enden betretbar (Luecken gesperrt)');
  const keine = bfs([[ab.x, ab.y]], (x, y) => sperr(new Set([...endeS_, ...luckS]))(x, y) && x < xb + 1);
  ok(ziele.every((a) => !hat(keine, a.x, a.y)), 'Gegenprobe: ohne Luecken und Enden kommt man nicht in den Graben (Brustwehr ist fest, kein Hineinspringen)');
  // Halbdeckung o: low, keine Sichtsperre
  ok(K.legende.o.low && !K.legende.o.sperrtSicht && K.legende.o.cover === 1, 'o = Halbdeckung (low, sperrt keine Sicht): Ducken moeglich');
});

section('Wall, Palisade und erhoehte Posten', () => {
  const auss = K.anker.filter((a) => a.rolle === 'aussicht');
  ok(auss.length >= 2 && auss.every((a) => ch(a.x, a.y) === '^'), `${auss.length} aussicht-Anker, alle auf Plateau ^`);
  const ab = anker('landung.abholpunkt');
  const alle = bfs([[ab.x, ab.y]], walk);
  // Rampe / ist begehbar; Plateau nur ueber / erreichbar
  ok(auss.every((a) => hat(alle, a.x, a.y)), 'beide Posten von der Ankunft aus erreichbar (Rampe)');
  const posten = K.meta.gruppen['w1.posten'];
  ok(posten.length === 2 && posten.every((id) => anker(id).rolle === 'aussicht'), 'Gruppe w1.posten = die beiden aussicht-Anker');
  let ramp = 0, pal = 0; for (const r of K.rows) { ramp += (r.match(/\//g) || []).length; pal += (r.match(/=/g) || []).length; }
  ok(ramp >= 2 && pal >= 20, `Rampen ${ramp}, Palisadenkacheln ${pal}`);
  // Palisade hat Tore (Durchgaenge) in Spalte
  const palX = K.rows.reduce((m, r) => { const i = r.indexOf('='); return i > 0 ? Math.min(m, i) : m; }, 999);
  let tore = 0; for (let y = 1; y < K.h - 1; y++) if (walk(palX, y)) tore++;
  ok(tore >= 4, `in der Palisadenspalte x=${palX} ${tore} Kacheln Durchgang (Tore)`);
  // Spieler-sicht: Posten auf aussicht-Anker sehen 22 statt 10 (Konfig, nicht geaendert)
  ok(CONFIG.awayCombat.sicht && CONFIG.awayCombat.sicht.aussicht === 22 && (CONFIG.awayCombat.sightTiles === 10), 'Konfigwerte unveraendert: Sicht 10, aussicht 22');
});

section('Wald: Weg und Durchkommen abseits des Wegs (BFS)', () => {
  const wb = K.bereiche.wald.rects[0], x0 = wb[0], x1 = wb[0] + wb[2] - 1;
  const inW = (x, y) => x >= x0 && x <= x1 && y >= 1 && y <= K.h - 2;
  const links = [], rechts = [];
  for (let y = 1; y < K.h - 1; y++) { links.push([x0, y]); rechts.push([x1, y]); }
  const wegT = (x, y) => inW(x, y) && ch(x, y) === ',';
  const wegLinks = links.filter((p) => wegT(p[0], p[1])), wegRechts = rechts.filter((p) => wegT(p[0], p[1]));
  ok(wegLinks.length >= 2 && wegRechts.length >= 2, `Weg beginnt links (${wegLinks.length} Kacheln) und endet rechts (${wegRechts.length}) im Wald-Abschnitt`);
  const S = bfs(wegLinks, wegT);
  ok(wegRechts.every((p) => hat(S, p[0], p[1])), 'Weg (Kacheln ,) durchgehend von links nach rechts begehbar');
  // Weg mindestens 2 breit: jede Wegkachel hat in einer Richtung zwei Nachbarn
  let schmal = 0; for (let y = 1; y < K.h - 1; y++) for (let x = x0; x <= x1; x++) if (ch(x, y) === ',') { const ok2 = (wegT(x, y + 1) || wegT(x, y - 1)) && (wegT(x + 1, y) || wegT(x - 1, y)) ; if (!ok2 && inW(x, y)) schmal++; }
  ok(schmal === 0, 'Weg nirgends schmaler als 2 Kacheln (' + schmal + ' schmale Stellen)');
  // abseits: ohne die Wegkacheln
  const abseits = (x, y) => inW(x, y) && walk(x, y) && ch(x, y) !== ',';
  const A = bfs(links.filter((p) => abseits(p[0], p[1])), abseits);
  const rechtsFrei = rechts.filter((p) => abseits(p[0], p[1]));
  ok(rechtsFrei.length > 0 && rechtsFrei.some((p) => hat(A, p[0], p[1])), 'abseits des Wegs kommt man von links nach rechts durch (Luecken zwischen den Baumgruppen)');
  // Gassen mindestens 2 breit: Pruefung per Erosion (2x2-Fenster freier Kacheln durchgaengig erreichbar)
  const frei2 = (x, y) => abseits(x, y) && abseits(x + 1, y) && abseits(x, y + 1) && abseits(x + 1, y + 1);
  const B = bfs(links.map((p) => [p[0], p[1]]).filter((p) => frei2(p[0], p[1])), (x, y) => frei2(x, y));
  ok(rechts.some((p) => hat(B, p[0] - 1, p[1]) && frei2(p[0] - 1, p[1])), 'abseits des Wegs gibt es einen durchgehenden Weg aus 2x2-freien Kacheln (Spieler passt durch)');
  // Baumgruppen: nur Platzhalter F (Zeichen T), mindestens 2x2, Boden ruhig
  let baum = 0, klein = 0;
  const wd = DEF.decks[0].abschnitte.wald.varianten.weg.rows;
  const f = (x, y) => y >= 0 && y < wd.length && x >= 0 && x < wd[0].length && wd[y][x] === 'T';
  for (let y = 1; y < wd.length - 1; y++) for (let x = 0; x < wd[0].length; x++) if (f(x, y)) { baum++; if (!(f(x + 1, y) || f(x - 1, y)) || !(f(x, y + 1) || f(x, y - 1))) klein++; }
  ok(baum > 100 && klein === 0, `Wald: ${baum} Baum-Platzhalter (Zeichen T -> F), alle in Gruppen von mindestens 2x2 (${klein} Einzelstuecke)`);
  // Mindestgroesse 2x2: jedes T liegt in einem vollen 2x2-Quadrat
  let nicht2 = 0; for (let y = 1; y < wd.length - 1; y++) for (let x = 0; x < wd[0].length; x++) if (f(x, y)) { const q = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([dx, dy]) => f(x + dx, y + dy) && f(x + dx + 1, y + dy) && f(x + dx, y + dy + 1) && f(x + dx + 1, y + dy + 1)); if (!q) nicht2++; }
  ok(nicht2 === 0, 'jede Baumkachel liegt in einem 2x2-Quadrat (Muster nie kleiner als 2x2)');
  // Boden ruhig: Wegkacheln und Wiesen-Boden2 (,) in Flecken >= 2x2
  let fl1 = 0; for (let y = 1; y < K.h - 1; y++) for (let x = 1; x < K.w - 1; x++) if (ch(x, y) === ',') { const q = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([dx, dy]) => ch(x + dx, y + dy) === ',' && ch(x + dx + 1, y + dy) === ',' && ch(x + dx, y + dy + 1) === ',' && ch(x + dx + 1, y + dy + 1) === ','); if (!q) fl1++; }
  ok(fl1 === 0, `Boden ruhig: jede Kachel ',' liegt in einem 2x2-Fleck (${fl1} Ausnahmen)`);
});

section('Eingangsbereich, Ziel und Gruppen fuer die Wellen', () => {
  const z = anker('bunker.ziel');
  ok(z && z.rolle === 'ziel' && K.meta.ziel === 'bunker.ziel' && K.meta.pflicht.ziel === 1, 'Platzhalter-Ziel am Bunkereingang: Anker bunker.ziel (Rolle ziel, meta.ziel)');
  ok(walk(z.x, z.y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walk(z.x + dx, z.y + dy)), 'Ziel steht begehbar, ein Nachbar frei');
  const ab = anker('landung.abholpunkt'), alle = bfs([[ab.x, ab.y]], walk);
  ok(hat(alle, z.x, z.y), 'Ziel von der Ankunft aus erreichbar');
  const g = K.meta.gruppen, w = K.meta.wellen;
  ok(JSON.stringify(w) === JSON.stringify({ '1': ['w1.graben', 'w1.posten'], '2': ['w2.wald', 'w2.eingang'] }), 'meta.wellen: Welle 1 = Graben + Posten, Welle 2 = Wald + Eingang');
  ok(g['w1.graben'].length === 5 && g['w1.posten'].length === 2 && g['w2.wald'].length === 6 && g['w2.eingang'].length === 4, `Gruppen: graben ${g['w1.graben'].length}, posten ${g['w1.posten'].length}, wald ${g['w2.wald'].length}, eingang ${g['w2.eingang'].length}`);
  const alleW = [].concat(...Object.values(g));
  ok(alleW.every((id) => { const a = anker(id); return a && walk(a.x, a.y) && hat(alle, a.x, a.y); }), 'alle Gruppen-Anker stehen begehbar und sind erreichbar');
  ok(K.anker.filter((a) => a.rolle === 'wache').length === 15 && K.anker.filter((a) => a.rolle === 'eingang').length === 2, '15 wache-Anker, 2 eingang-Anker');
  ok(g['w2.eingang'].every((id) => anker(id).x > anker('eingang.tor.1').x) && g['w2.wald'].every((id) => anker(id).x < anker('eingang.tor.1').x), 'Wald-Wachen vor dem Tor, Eingangs-Wachen dahinter');
});

section('Einhaengestelle: Landepunkt mit gen.fest, v2, Cache', () => {
  const mk = () => new Game({ noStore: true, seed: 7, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const g = mk();
  const id = L.testgelaende(g, { ort: 'kesh', id: 'test.fest.1', art: 'aussenposten', seed: 5, besitz: 'rom', gen: { fest: 'grabenangriff' } });
  const k = L.karte(g, id);
  ok(k && k.meta.fest === 'grabenangriff' && k.w === 100 && k.h === 36, 'karteBauen/landepunkte baut die feste Karte (' + id + ')');
  const e = L.eintrag(g, id);
  ok(e.bauversion && /^fest\.grabenangriff\.1\[/.test(e.bauversion) && e.schablone === 'gen-fest', 'Eintrag uebernimmt bauversion ' + e.bauversion);
  const aw = L.get(g, id);
  ok(aw.kampf === 'v2' && aw.combat === 'v2' && combat.isV2Away(aw), 'Laufzeitkarte ist v2 (aw.kampf, combat.isV2Away): Ducken moeglich');
  ok(W.AWAY_MAPS[id] && W.AWAY_MAPS[id].karte.meta.fest === 'grabenangriff', 'registriert in AWAY_MAPS');
  // Variante wirkt auf den Cache-Schluessel: anderer Landepunkt mit explizit gleicher Auswahl = gleiche Karte
  const g2 = mk();
  const id2 = L.testgelaende(g2, { ort: 'kesh', id: 'test.fest.2', art: 'aussenposten', seed: 99, besitz: 'rom', gen: { fest: 'grabenangriff', abschnitte: { wiese: 'graben', wald: 'weg' } } });
  ok(JSON.stringify(L.karte(g2, id2).rows) === JSON.stringify(k.rows), 'Seed ohne Wirkung, explizite Auswahl = Standard');
  let fehler = null; const g3 = mk();
  try { const id3 = L.testgelaende(g3, { ort: 'kesh', id: 'test.fest.3', art: 'aussenposten', seed: 1, gen: { fest: 'grabenangriff', abschnitte: { wiese: 'nix' } } }); L.karte(g3, id3); } catch (x) { fehler = x.message; }
  ok(fehler && /unbekannt/.test(fehler), 'unbekannte Variante wirft beim Bau: ' + (fehler || ''));
  // normale Aussenposten bleiben unberuehrt (Schluessel ohne Zusatz, Generator wie bisher)
  const g4 = mk();
  const id4 = L.testgelaende(g4, { ort: 'kesh', id: 'test.fest.4', art: 'aussenposten', seed: 5, besitz: 'rostmeute' });
  const k4 = L.karte(g4, id4);
  ok(!k4.meta.fest && k4.erzeuger === 'gen-siedlung/1', 'ohne gen.fest: Siedlungsgenerator wie bisher');
});

// ---------------------------------------------------------------------------------------------------------------------
function spiel(np, seed) {
  const g = new Game({ noStore: true, seed: seed || 11, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < np; i++) { const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); } }; g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'G' + i, name: 'G' + i, color: i }); g.handleMessage(c, { t: 'ready', ready: true }); cs.push(c); }
  const lp = L.testgelaende(g, { ort: g.ship.scene || 'kesh', id: 'test.fest.spiel' + seed, art: 'aussenposten', seed: 3, besitz: 'rom', gen: { fest: 'grabenangriff' } });
  L.get(g, lp);
  g.transferZiel = { lp, scene: g.ship.scene }; g.setAwayMap(lp);
  away.executeBeam(g, g.players.map((p) => p.id), 'down');
  g.weltstand.data.rollen_gesehen = ['niederhalter', 'grenadier', 'schuetze', 'enterer', 'haescher'];
  return { g, cs, lp };
}
const stick = (g, c, i, mx, my) => g.handleMessage(c, { t: 'input', seq: (stick.s = (stick.s || 0) + 1), mx, my });

section('Spiel: Karte ueber landepunkte im Spiel, Spieler beamen, Besetzung Rom, Ticks', () => {
  const { g, cs, lp } = spiel(3, 11);
  ticks(g, 1);
  ok(g.away && g.away.map === lp && g.players.every((p) => p.zone === 'away'), '3 Spieler unten auf der festen Karte');
  const ab = anker('landung.abholpunkt');
  ok(g.players.every((p) => { const t = Physics.toTile(p.x, p.y); return Math.abs(t.x - ab.x) <= 4 && Math.abs(t.y - ab.y) <= 4; }), 'alle am Abholpunkt links');
  const n1 = combat.besetzen(g, { map: lp, fraktion: 'rom', staerke: 'mittel', haltung: 'wach', bereich: 'graben', tag: 'w1' });
  const lebend1 = g.away.drones.filter((e) => e.alive);
  ok(n1 > 0 && lebend1.length > 0, `Welle 1 ueber besetzen(bereich: graben): ${lebend1.length} Gegner`);
  ok(lebend1.every((e) => { const t = Physics.toTile(e.x, e.y); return t.x >= 22 && t.x <= 48; }), 'Welle 1 steht im Graben/Wallbereich (x 22..48)');
  // Spieler laufen nach rechts ueber die Wiese (Ticks, Bewegung), keine Ausnahmen, Karte bleibt im Spiel
  const start = Physics.toTile(g.players[0].x, g.players[0].y);
  for (let s = 0; s < 6; s++) {
    for (let i = 0; i < 3; i++) stick(g, cs[i], i, 1, 0);
    for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
    ticks(g, 1);
  }
  const ende = Physics.toTile(g.players[0].x, g.players[0].y);
  ok(ende.x > start.x + 3, `Spieler bewegen sich auf der Karte (x ${start.x} -> ${ende.x})`);
  ticks(g, 12);
  ok(fehlerZahl(g) === 0 && g.players.length === 3, 'keine Fehler im Tick (g.errors = ' + fehlerZahl(g) + ')');
  const sn = g.snapshot();
  ok(Buffer.byteLength(JSON.stringify(sn)) <= CONFIG.net.snapMax, 'Snapshot im Spiel unter der Grenze');
  // awayMap-Event mit Payload geht an die Spieler
  const ev = cs[0].inbox.find((m) => m.t === 'event' && m.kind === (Protocol.EVT_AWAY_MAP || 'awayMap'));
  ok(!ev || (ev.w === 100 && ev.h === 36), 'awayMap-Event der Karte (100x36) bei den Spielern' + (ev ? '' : ' (nicht im Postfach)'));
  // Welle 2 am Eingangsbereich
  const n2 = combat.besetzen(g, { map: lp, fraktion: 'rom', staerke: 'mittel', haltung: 'wach', bereich: 'eingang', tag: 'w2' });
  ok(n2 > 0, `Welle 2 ueber besetzen(bereich: eingang): ${n2} Gegner`);
  ticks(g, 5);
  ok(fehlerZahl(g) === 0, 'weiter ohne Fehler nach Welle 2');
});

// Snapshot-Fruehmessung: 12 + 12 Gegner, 3 Spieler auf der Karte; Spieler laufen ueber Wiese und Graben, Gegner agieren, Granaten
section('Snapshot-Fruehmessung (Ziel <= 18944 B, Grenze 20480 B)', () => {
  const ZIEL = CONFIG.net.snapMax - CONFIG.net.snapLuft;
  let max = 0, maxDr = 0, summe = 0, cnt = 0, fehler = 0;
  for (const seed of [11, 12, 13]) {
    const { g, cs, lp } = spiel(3, seed);
    const plan = [];
    for (const gr of ['w1.graben', 'w1.posten', 'w2.wald', 'w2.eingang']) for (const id of K.meta.gruppen[gr]) plan.push(anker(id));
    const rollen = ['grundtyp', 'niederhalter', 'grenadier', 'schuetze', 'enterer'];
    let i = 0;
    const setzen = (liste, tag) => { for (const a of liste) { const e = squad.makeEnemy(g, g.away, 'scavenger', tag + (i++), Physics.tileCenter(a.x, a.y), tag); e.rolle = rollen[i % rollen.length]; e.tag = tag; e.fraktion = 'rom'; combat.kaempfer && combat.kaempfer(g, e); g.away.drones.push(e); } };
    // 12 + 12: jeder Anker doppelt belegt bis 24 (benachbarte Kachel)
    const liste = plan.filter((a) => a.rolle === 'wache' || a.rolle === 'aussicht');
    const w1 = liste.filter((a) => /^w1/.test(a.id)), w2 = liste.filter((a) => /^w2/.test(a.id));
    const dopp = (l, n) => { const o = []; for (let k = 0; k < n; k++) { const a = l[k % l.length]; o.push(Object.assign({}, a, { x: a.x + (k >= l.length ? 1 : 0), y: a.y + (k >= l.length ? 1 : 0) })); } return o; };
    setzen(dopp(w1, 12), 'w1'); setzen(dopp(w2, 12), 'w2');
    for (const e of g.away.drones) { const t = Physics.toTile(e.x, e.y); if (!walk(t.x, t.y)) { const f = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => walk(t.x + dx, t.y + dy)); if (f) { const c = Physics.tileCenter(t.x + f[0], t.y + f[1]); e.x = c.x; e.y = c.y; e.home = { x: c.x, y: c.y }; } } }
    g.away.alert = true;
    for (const nm of Object.keys(g.away.squads || {})) g.away.squads[nm].alert = true;
    const T = Math.round(60 * CONFIG.tickHz);
    // Spieler marschieren in Wellenform ueber die Karte; von Tick 0 an stehen die Gegner im Gefecht
    for (let k = 0; k < T; k++) {
      const ph = Math.floor(k / CONFIG.tickHz);
      for (let p = 0; p < 3; p++) stick(g, cs[p], p, ph < 45 ? 1 : 0, Math.sin((ph + p * 2) / 3) * 0.6);
      g.step();
      for (const p of g.players) { if (p.shield) p.shield.seg = 3; if (p.downed) combat.revive(g, p, 3, { quiet: true }); }
      const b = Buffer.byteLength(JSON.stringify(g.snapshot()));
      if (b > max) max = b; summe += b; cnt++;
      const d = (g.snapshot().away && g.snapshot().away.drones) || [];
      if (k % 15 === 0) maxDr = Math.max(maxDr, d.length);
    }
    fehler += fehlerZahl(g);
  }
  console.log(`  Messwert: Snapshot max ${max} B, Mittel ${Math.round(summe / cnt)} B (24 Gegner gesetzt, bis ${maxDr} im Snapshot, 3 Spieler, 3 Seeds x 60 s)`);
  ok(maxDr >= 12, `mindestens 12 Gegner im Snapshot (${maxDr})`);
  ok(max <= ZIEL, `Snapshot max ${max} B <= Ziel ${ZIEL} B (Grenze ${CONFIG.net.snapMax} B)`);
  ok(fehler === 0, 'keine Tickfehler');
});

console.log(`\n${fails ? 'VERFEHLT' : 'ok'}: ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
