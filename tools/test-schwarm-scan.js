'use strict';
// MON-03 C: Datenblatt, Scan-Filter, Sichtregel für Größe 2, Zerfall und Bodenspur des Schwarms. Echtes Spiel (Game), Client-Funktionen aus public/js/voxel/actors.js aus dem Quelltext.
// Geprüft: (a) Datenblätter Schwarmling/Königin (Längen, Wahrheit, Gefahr); (b) Königsposition erst ab Scan-Qualität 3 in aw.sc, im Snapshot (sc und kr) UND in der Anzeige (ScanAnzeige), der Nest-Anker steht in keinem Payload;
//   (c) Scan-Filter: 20 Schwarmlinge verdrängen die Königin nicht aus den 16 Plätzen (auch wenn die Schwarmlinge zuerst erfasst wurden), Gefolge nachrangig und begrenzt, andere Kreaturen vorrangig, kein Typname im Servercode;
//   (d) Sichtregel Größe 2: eine Königin, von der ein Körperteil zu sehen ist, steht in kr (Höhle), Größe 1 unverändert, ohne Sichtlinie kein kr-Eintrag; (e) Zerfall am Ereignis (nur für gesehene Tiere, einmal, Eintrag aus dem Content, Skala);
//   (f) Bodenspur (deterministisch, nur aus der Wegstrecke gesehener Tiere, kein Anker, begrenzt, nur Typen mit `spur`), Einhängestellen im Quelltext; (g) Nacharbeit: Spurdeckel je Tier und insgesamt, Lebensdauer bei mehreren Tieren,
//   Übernahme statt Neubau, Vorrat und Dispose; Zerfallsfleck nur für Tiere, die im selben Moment noch in kr waren (nicht bis 3 s danach).
//   node tools/test-schwarm-scan.js   (npm run test:schwarm-scan)
const fs = require('fs');
const path = require('path');
const CONFIG = require('../shared/config.js');
const combat = require('../server/sim/combat.js');
const Kreatur = require('../server/sim/kreatur.js');
const Scanbar = require('../server/sim/scanbar.js');
const SA = require('../public/js/scan-anzeige.js');
const H = require('./gel02-hilfen.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (name, body) => {
  console.log('\n[' + name + ']');
  try { body(); } catch (e) { fails++; n++; console.log('  FEHLER Abschnitt abgebrochen: ' + (e.stack || e).toString().split('\n').slice(0, 5).join(' | ')); }
};
const DATEN = JSON.parse(read('content/scanner/datenblaetter.json'));
const MODELLE = JSON.parse(read('content/kreaturen/modelle.json'));
const MAXE = CONFIG.scanner.maxEintraege, R = CONFIG.scanner.reichweite;

// ---------- Szene: Wildnis, Spieler unverwundbar, Königin und Schwarmlinge von Hand ----------
function szene(seed) {
  const s = H.neuesSpiel(1, { art: 'wildnis', seed: seed || 101, groesse: 'mittel', biom: 'wueste' });
  const g = s.g, p = g.players[0];
  g.away.drones = []; combat.ensureV2(g, g.away, s.map); g.away.kreaturen = [];
  g.god = true;
  const S = { g, k: s.k, map: s.map, p, aw: g.away, fehler: [] };
  g.countError = (w, e) => { S.fehler.push(w + ': ' + (e && e.message)); };
  return S;
}
// Königin in etwa `kacheln` Kacheln Abstand vom Spieler (erste Richtung mit Platz)
function koenigin(S, kacheln) {
  const tx = Math.floor(S.p.x / 32), ty = Math.floor(S.p.y / 32);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    const r = Kreatur.nestSetzen(S.g, { map: S.map, typ: 'koenigin', gruppe: 'nest', x: tx + Math.round(dx * kacheln), y: ty + Math.round(dy * kacheln) });
    if (!r.fehler) return S.aw.kreaturen.find((K) => K.id === r.ids[0]);
  }
  throw new Error('kein Platz für die Königin');
}
// bis zu `anzahl` Schwarmlinge auf einem Ring um den Spieler (nur Plätze, an denen erzeugen gelingt)
function schwarmlinge(S, anzahl, r0) {
  const out = [];
  for (let i = 0; out.length < anzahl && i < anzahl * 12; i++) {
    const w = (i / anzahl) * Math.PI * 2 + i * 0.37, r = (r0 + (i % 5) * 0.4) * 32;
    try { out.push(Kreatur.erzeugen(S.g, 'schwarmling', S.p.x + Math.cos(w) * r, S.p.y + Math.sin(w) * r)); } catch (e) { /* Platz belegt oder Wand */ }
  }
  return out;
}
const scan = (S, stufe) => Scanbar.debugScanfertig(S.g, S.p, stufe);
const sc = (S, id) => (S.aw.sc || {})['monster:' + id];
const anzahlTyp = (S, typ) => Object.values(S.aw.sc || {}).filter((e) => e.typ === typ).length;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / 32;

// ---------- (a) Datenblätter ----------
section('(a) Datenblätter Schwarmling und Königin', () => {
  const W = DATEN.typen.schwarmling, Q = DATEN.typen.koenigin;
  ok(W && Q, 'beide Einträge vorhanden');
  for (const [t, d] of [['schwarmling', W], ['koenigin', Q]]) {
    ok(d.name.length <= 20 && d.zeile.length <= 34 && d.hinweis.length <= 100, t + ': Längen (Name ' + d.name.length + ', Zeile ' + d.zeile.length + ', Hinweis ' + d.hinweis.length + ')');
    ok(!/Platzhalter|Testziel/i.test(d.zeile + d.hinweis) && d.symbol === 'MO' && d.hinweisAb >= 1 && d.hinweisAb <= 3, t + ': kein Platzhaltertext, Symbol MO, hinweisAb 1..3');
  }
  ok(/Ersatz|wieder/i.test(W.zeile + W.hinweis) && /Lärm/.test(W.hinweis) && /Königin/.test(W.hinweis) && /zerf/.test(W.hinweis), 'Schwarmling nennt Wiederkehr, Lärm lockt und den Zerfall mit der Königin');
  ok(/Königin beseitigen|beseitig/.test(Q.hinweis) && /zerf/.test(Q.hinweis) && /Nachwuchs|Schwarmlinge/.test(Q.zeile + Q.hinweis), 'Königin nennt Nachwuchs und: Königin beseitigen, Schwarm zerfällt');
  ok(Q.gefahr > W.gefahr && !('positionAb' in Q) && !('x' in Q), 'Königin gefährlicher als Schwarmling; der Content trägt keine Positionsregel (Standard Stufe 3)');
  ok(!/Position|Feld|Kachel/.test(Q.zeile + Q.hinweis + W.zeile + W.hinweis), 'die Texte verraten keine Position');
});

// ---------- (b) Königsposition erst ab Qualität 3 ----------
section('(b) Königsposition erst ab Scan-Qualität 3: Snapshot (sc, kr) und Anzeige', () => {
  for (const stufe of [1, 2, 3]) {
    const S = szene();
    const Q = koenigin(S, 11);   // über dem Sichtradius (10), unter der Scan-Reichweite (12)
    const d = dist(S.p, Q);
    ok(d > CONFIG.awayCombat.sightTiles && d * 32 <= R, 'Stufe ' + stufe + ': Königin außerhalb der Sicht (' + d.toFixed(1) + ' Kacheln), aber im Scanradius');
    scan(S, stufe);
    const e = sc(S, Q.id);
    ok(e && e.sk === stufe && e.typ === 'koenigin', 'Stufe ' + stufe + ': Königin in aw.sc erfasst (sk ' + (e && e.sk) + ')');
    ok(stufe >= 3 ? e.x === Math.round(Q.x) && e.y === Math.round(Q.y) : e.x === undefined && e.y === undefined, 'Stufe ' + stufe + ': ' + (stufe >= 3 ? 'Position gesetzt' : 'KEINE Position in aw.sc'));
    const snap = S.g.snapshot().away || {};
    const row = (snap.sc || []).find((r) => r[0] === Q.id);
    ok(row && row.length === (stufe >= 3 ? 6 : 4), 'Stufe ' + stufe + ': Snapshot-Zeile sc mit ' + (stufe >= 3 ? '6' : '4') + ' Feldern (' + (row && row.length) + ')');
    const text = JSON.stringify(snap);
    const mitPos = text.includes(',' + Math.round(Q.x) + ',' + Math.round(Q.y) + ']');
    ok(stufe >= 3 ? mitPos : !mitPos, 'Stufe ' + stufe + ': ' + (stufe >= 3 ? 'Position steht im sc-Feld' : 'die Position steht nirgends im away-Snapshot'));
    ok(!(snap.kr || []).some((r) => r[0] === Number(Q.id.slice(1))), 'Stufe ' + stufe + ': ungesehene Königin nicht in kr (auch nicht nach dem Scan)');
    // Anzeige: Datenblatt und Marker
    SA.beobachte([]);
    const z = SA.ansicht(snap.sc, 12, DATEN).zeilen.find((r) => r.typ === 'koenigin');
    const b = SA.blatt(z, 32);
    ok(z && (stufe >= 3 ? z.pos && z.pos.x === Math.round(Q.x) : z.pos === null) && b.hatPosition === (stufe >= 3), 'Stufe ' + stufe + ': Anzeige ' + (stufe >= 3 ? 'zeigt die Position' : 'ohne Position (Marker entfällt)') + ': "' + (b && b.position) + '"');
    ok(stufe >= 3 || /Stufe 3/.test(b.position), 'Stufe ' + stufe + ': Positionszeile nennt Stufe 3' + (stufe >= 3 ? ' (entfällt)' : ''));
    SA.beobachte([]);
  }
  // Sicht ist Sicht: eine gesehene Königin steht in kr, mit Position
  const S = szene();
  const Q = koenigin(S, 6);
  const kr = Kreatur.snap(S.g) || [];
  ok(kr.some((r) => r[0] === Number(Q.id.slice(1)) && Math.round(r[2]) === Math.round(Q.x)), 'gesehene Königin (6 Kacheln): in kr mit Position (Sicht ist Sicht, kein Leck)');
});

section('(b2) Nest-Anker in keinem Payload (Höhle)', () => {
  const s = H.neuesSpiel(1, { art: 'hoehle', seed: 3, groesse: 'mittel' });
  const g = s.g, k = s.k, ne = (k.anker || []).find((a) => a.rolle === 'nest');
  ok(!!ne, 'die Höhle hat einen Nest-Anker');
  const pay = JSON.stringify(g.awayMapPayload(k));
  ok(!pay.includes('"nest"') && !pay.includes(ne.id), 'awayMap-Payload: weder Rolle noch Anker-Id des Nests');
  g.away.drones = []; combat.ensureV2(g, g.away, s.map); g.away.kreaturen = [];
  const r = Kreatur.nestBesetzen(g, { map: s.map, typ: 'koenigin', gruppe: 'n' });
  ok(!r.fehler, 'Königin am Nest angelegt');
  const Q = g.away.kreaturen[0];
  g.players[0].x = Q.x + 40 * 32; g.players[0].y = Q.y;   // weit weg: nicht gesehen
  g.step();
  const snap = JSON.stringify(g.snapshot().away || {});
  ok(!snap.includes(',' + Math.round(Q.x) + ',' + Math.round(Q.y)) && !snap.includes('"nest"') && !snap.includes(ne.id), 'Snapshot away ohne Nest-Anker und ohne Königsposition (ungesehen, ungescannt)');
});

// ---------- (c) Scan-Filter ----------
section('(c) Scan-Filter: 20 Schwarmlinge verdrängen die Königin nicht', () => {
  const S = szene();
  const Q = koenigin(S, 10);
  const W = schwarmlinge(S, 20, 2);
  ok(W.length === 20, '20 Schwarmlinge angelegt (' + W.length + ')');
  ok(W.every((w) => dist(S.p, w) < dist(S.p, Q)), 'alle Schwarmlinge näher am Scanpunkt als die Königin (Worst Case für „nächste zuerst“)');
  ok(MAXE === 16, 'Scan-Kapazität 16 (' + MAXE + ')');
  scan(S, 3);
  const e = sc(S, Q.id);
  ok(e && e.x !== undefined, 'Königin erfasst, mit Position (Stufe 3)');
  const wn = anzahlTyp(S, 'schwarmling'), alle = Object.keys(S.aw.sc).length;
  ok(alle <= MAXE && wn <= MAXE - 4 && wn >= 8, 'Schwarmlinge nur bis max - Reserve (' + wn + ' von 20), insgesamt ' + alle + ' von ' + MAXE);
  ok(S.fehler.length === 0, 'keine Fehler (' + S.fehler.join('|') + ')');
  // ohne Königin im Radius zuerst: die Schwarmlinge belegen höchstens max - Reserve, die Königin kommt beim nächsten Scan trotzdem hinein
  const S2 = szene();
  const Q2 = koenigin(S2, 11);
  const W2 = schwarmlinge(S2, 20, 2);
  const ox = S2.p.x, oy = S2.p.y, d2 = Math.hypot(ox - Q2.x, oy - Q2.y);
  S2.p.x = ox + (ox - Q2.x) / d2 * 6 * 32; S2.p.y = oy + (oy - Q2.y) / d2 * 6 * 32;   // 6 Kacheln von der Königin weg: sie liegt außerhalb des Scanradius, die Schwarmlinge nicht
  ok(W2.length === 20 && dist(S2.p, Q2) * 32 > R, 'zweiter Fall: 20 Schwarmlinge, Königin außerhalb des ersten Scanradius (' + dist(S2.p, Q2).toFixed(1) + ' Kacheln)');
  scan(S2, 3);
  const vorher = anzahlTyp(S2, 'schwarmling');
  ok(vorher >= 8 && vorher <= MAXE - 4 && !sc(S2, Q2.id), 'erster Scan: nur Schwarmlinge erfasst (' + vorher + ', höchstens ' + (MAXE - 4) + '), Königin noch nicht');
  S2.p.x = ox; S2.p.y = oy;
  scan(S2, 3);
  ok(!!sc(S2, Q2.id), 'zweiter Scan: Königin erfasst, obwohl die Schwarmlinge schon Plätze belegen (Reserve)');
  ok(Object.keys(S2.aw.sc).length <= MAXE, 'nie mehr als ' + MAXE + ' Einträge (' + Object.keys(S2.aw.sc).length + ')');
  // andere (nicht gebundene) Kreaturen sind vorrangig
  const S3 = szene();
  const Q3 = koenigin(S3, 10);
  const W3 = schwarmlinge(S3, 20, 2);
  const P = Kreatur.erzeugen(S3.g, 'probe', S3.p.x + 8 * 32, S3.p.y);
  scan(S3, 3);
  ok(!!sc(S3, P.id) && !!sc(S3, Q3.id) && W3.length === 20, 'eine nicht gebundene Kreatur (probe) und die Königin kommen vor den Schwarmlingen hinein');
  // Vorrangige zuerst: 14 andere Kreaturen weiter weg als 20 Schwarmlinge, alle 14 und die Königin kommen hinein, die Schwarmlinge füllen nur den Rest
  const S4 = szene();
  const Q4 = koenigin(S4, 10);
  const W4 = schwarmlinge(S4, 20, 2);
  const P4 = [];
  for (let i = 0; P4.length < 14 && i < 120; i++) { const w = i * 0.9, r = (7 + (i % 4) * 0.7) * 32; try { P4.push(Kreatur.erzeugen(S4.g, 'probe', S4.p.x + Math.cos(w) * r, S4.p.y + Math.sin(w) * r)); } catch (e) { /* Wand */ } }
  scan(S4, 3);
  ok(W4.length === 20 && P4.length === 14 && P4.every((x) => !!sc(S4, x.id)) && !!sc(S4, Q4.id) && anzahlTyp(S4, 'schwarmling') === MAXE - 15, 'Vorrang: 14 Kreaturen ohne Gefolge-Bindung und die Königin zuerst, die Schwarmlinge nur auf dem Rest (' + anzahlTyp(S4, 'schwarmling') + ')');
  // der Filter lebt in Daten (Bindung an eine Kreatur), nicht in Typnamen
  const sb = read('server/sim/scanbar.js'), kr = read('server/sim/kreatur.js');
  const ziele = kr.slice(kr.indexOf("scanbarAnmelden('monster'"), kr.indexOf('tiefen: { position: 3 }'));
  ok(!/schwarm|koenigin|königin/i.test(sb.replace(/\/\/.*$/gm, '')) && !/schwarm|koenigin/i.test(ziele.replace(/\/\/.*$/gm, '')) && /nachrang: !!\(K\.bindung && K\.bindung\.art === 'kreatur'\)/.test(ziele), 'Servercode: kein Typname im Scan-Filter, Nachrang kommt aus der Bindung an eine Kreatur');
});

// ---------- (d) Sichtregel Größe 2 ----------
section('(d) Sichtregel: Königin (Größe 2) in der Höhle', () => {
  let gefunden = 0, verborgen = 0, vergleich = 0, abweichung = 0;
  for (const seed of [2, 4]) {
    const s = H.neuesSpiel(1, { art: 'hoehle', seed, groesse: 'mittel' });
    const g = s.g, p = g.players[0]; g.away.drones = []; combat.ensureV2(g, g.away, s.map); g.away.kreaturen = []; g.god = true;
    const r = Kreatur.nestBesetzen(g, { map: s.map, typ: 'koenigin', gruppe: 'n' });
    if (r.fehler) throw new Error(r.fehler);
    const Q = g.away.kreaturen[0], E = combat.env(g), team = combat.teamOf(g), RR = g.C.awayCombat.sightTiles * 32;
    const W = Kreatur.erzeugen(g, 'schwarmling', Q.x + 64, Q.y);   // Größe 1 zum Vergleich (gleiche Regel wie zuvor)
    const nrQ = Number(Q.id.slice(1)), nrW = Number(W.id.slice(1));
    const qx = Math.floor(Q.x / 32), qy = Math.floor(Q.y / 32);
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const tx = qx + dx, ty = qy + dy;
      if (E.blocked(tx, ty)) continue;
      p.x = tx * 32 + 16; p.y = ty * 32 + 16;
      const alt = combat.sichtbarFuerTeam(g, E, team, RR, Q, false);   // alte Regel: nur die Mitte
      const kr = Kreatur.snap(g) || [];
      const q = kr.some((z) => z[0] === nrQ);
      if (alt && !q) abweichung++;   // die neue Regel darf nie weniger zeigen als die alte
      if (!alt && q) gefunden++;
      const koerper = [[-16, -16], [16, -16], [-16, 16], [16, 16]].some(([ox, oy]) => combat.sichtbarFuerTeam(g, E, team, RR, { x: Q.x + ox, y: Q.y + oy }, false));
      if (!q && !koerper) verborgen++;   // kein Körperteil zu sehen: auch nicht in kr
      if (q && !alt && !koerper) abweichung++;
      // Größe 1: genau die alte Regel
      const w1 = combat.sichtbarFuerTeam(g, E, team, RR, W, false), w2 = kr.some((z) => z[0] === nrW);
      vergleich++; if (w1 !== w2) abweichung++;
    }
  }
  ok(gefunden >= 10, 'Positionen, an denen nur ein Körperteil der Königin zu sehen ist: sie steht jetzt in kr (' + gefunden + ')');
  ok(verborgen >= 10, 'ohne Sichtlinie auf irgendeinen Körperteil bleibt sie aus kr (' + verborgen + ' Positionen)');
  ok(vergleich > 100 && abweichung === 0, 'Größe 1 unverändert (' + vergleich + ' Positionen), die neue Regel zeigt nie weniger als die alte und nie ohne sichtbaren Körperteil (Abweichungen ' + abweichung + ')');
});

// ---------- (e), (f) Client: Zerfall und Bodenspur ----------
const ac = read('public/js/voxel/actors.js');
const a0 = ac.indexOf('const KR_SCHRITT'), a1 = ac.indexOf('// KREATUR-OPTIK-ENDE'), a2 = ac.indexOf('function kreaturInhaltLaden'), a3 = ac.indexOf('function updateEnemy(');
if (a0 < 0 || a1 < a0 || a2 < a1 || a3 < a2) { console.log('  FEHLER Quelltext-Blöcke in actors.js nicht gefunden'); process.exit(1); }
const REIN = ac.slice(a0, a1), ANZEIGE = ac.slice(a2, a3);
const NAMEN = 'KR_BODEN_VORRAT, KR_SPUR_MAX, KR_SPUR_JE_TIER, kreaturEintrag, kreaturZerfallEintrag, kreaturZerfallZeigen, kreaturSkala, kreaturSpurEintrag, kreaturSpurAnzahl, kreaturSpurDrehung, kreaturSpurVersatz, kreaturSpur, kreaturZerfallEreignis, KR_ZERFALL_ZEIT, KR_ZERFALL_SCHWUND, KR_BEKANNT_FENSTER, KR_SPUR_ABSTAND, KR_SPUR_LEBEN, KR_SPUR_SCHWUND, KR_SPUR_VERSATZ, KR_SPUR_DREH';
const baue = (L) => new Function('L', 'yawOf', 'window', REIN + ANZEIGE + '\nreturn { ' + NAMEN + ' };')(L, (dx, dy) => Math.atan2(dx, dy), {});
const IDS = Object.keys(require('../content/kampf/kreaturen.json').typen);

section('(e) Zerfall am Ereignis', () => {
  const abgelegt = [];
  const L = { kreaturInhalt: MODELLE, frame: 100, time: 100, kreaturZuletzt: new Map(), bodenAblegen: (o) => abgelegt.push(o) };
  const F = baue(L);
  const wz = F.kreaturZerfallEintrag(MODELLE, 'schwarmling'), qz = F.kreaturZerfallEintrag(MODELLE, 'koenigin');
  ok(wz && wz.modell === 'kreatur/schwarm_fleck' && wz.params.gross === 0 && qz && qz.params.gross === 1, 'Zerfalls-Eintrag aus dem Content: Schwarmling gross 0, Königin gross 1, Modell schwarm_fleck');
  ok(F.kreaturZerfallEintrag(MODELLE, 'rudeltier') === null && F.kreaturZerfallEintrag(MODELLE, 'probe') === null && F.kreaturZerfallEintrag(MODELLE, 'constructor') === null && F.kreaturZerfallEintrag(null, 'x') === null && F.kreaturZerfallEintrag(MODELLE, undefined) === null, 'ohne zerfall-Eintrag (rudeltier, probe, unbekannt, kaputter Content) kein Zerfall');
  const ev = (o) => Object.assign({ kind: 'kreaturAufgeloest', id: 'K7', typ: 'schwarmling', x: 480, y: 352 }, o || {});
  L.kreaturZuletzt.set('K7', 99.97);
  ok(F.kreaturZerfallZeigen(L.kreaturZuletzt, 100, ev(), F.KR_BEKANNT_FENSTER), 'bekanntes Tier (vor 0,03 s, einem Frame, in kr gesehen): zeigen');
  ok(!F.kreaturZerfallZeigen(L.kreaturZuletzt, 100, ev({ id: 'K9' }), 90) && !F.kreaturZerfallZeigen(L.kreaturZuletzt, 400, ev(), F.KR_BEKANNT_FENSTER), 'unbekanntes oder lange nicht gesehenes Tier: nicht zeigen (kein Ort, kein Dasein verraten)');
  ok(!F.kreaturZerfallZeigen(L.kreaturZuletzt, 100, ev({ kind: 'enemyDown' }), 0.25) && !F.kreaturZerfallZeigen(L.kreaturZuletzt, 100, ev({ x: null }), 0.25) && !F.kreaturZerfallZeigen(L.kreaturZuletzt, 100, ev({ id: 7 }), 0.25) && !F.kreaturZerfallZeigen(L.kreaturZuletzt, 100, null, 0.25), 'falsche Art, fehlender Ort, falsche Id, kein Ereignis: nicht zeigen');
  ok(F.kreaturZerfallEreignis(ev()) === true && abgelegt.length === 1, 'kreaturAufgeloest eines gesehenen Schwarmlings legt genau einen Fleck ab');
  const o = abgelegt[0];
  ok(o.art === 'zerfall' && o.key === 'zerfall:K7' && o.modell === 'kreatur/schwarm_fleck' && o.params.gross === 0 && o.x === 480 && o.y === 352 && o.leben === F.KR_ZERFALL_ZEIT && o.leben >= 3 && o.leben <= 5, 'Fleck: am Ort des Ereignisses, Modell und Größe aus dem Content, ' + o.leben + ' s');
  ok(F.kreaturZerfallEreignis(ev()) === false && abgelegt.length === 1, 'dasselbe Tier zerfällt nur einmal (kein zweiter Fleck)');
  L.kreaturZuletzt.set('K8', 99.95);
  ok(F.kreaturZerfallEreignis(ev({ kind: 'kreaturAusgefallen', id: 'K8', typ: 'koenigin' })) && abgelegt[1].params.gross === 1, 'kreaturAusgefallen der Königin: Fleck gross 1');
  ok(F.kreaturZerfallEreignis(ev({ id: 'K99' })) === false && abgelegt.length === 2, 'unbekanntes Tier: kein Fleck');
  const L2 = { frame: 1, time: 1, kreaturZuletzt: new Map([['K7', 1]]) }, F2 = baue(L2);
  ok(F2.kreaturZerfallEreignis(ev()) === false, 'ohne geladenen Content oder Bodenkulisse: kein Fleck, kein Wurf (Rückfall)');
  ok(F.kreaturSkala(0, 4, 1) === 1 && F.kreaturSkala(2.9, 4, 1) === 1 && F.kreaturSkala(3.5, 4, 1) === 0.5 && F.kreaturSkala(4, 4, 1) === 0 && F.kreaturSkala(9, 4, 1) === 0, 'Skala: 3 s voll, die letzte Sekunde schrumpft, ab 4 s weg');
  ok(F.kreaturSkala(1, 4, 9) <= 1 && F.kreaturSkala(1, 4, 9) > 0 && F.kreaturSkala(0, 4, 0) === 1, 'Skala: Schwund größer als die Lebensdauer wird begrenzt');
});

section('(f) Bodenspur: deterministisch, nur aus gesehenen Tieren, begrenzt', () => {
  const spurLauf = (nr, strecke, schritt) => {
    const abgelegt = [], L = { kreaturInhalt: MODELLE, frame: 1, bodenAblegen: (o) => abgelegt.push(o) };
    const F = baue(L), eintrag = MODELLE.typen.schwarmling, a = { dist: 0 };
    for (let d = 0; d <= strecke + 1e-9; d += schritt) { a.dist = d; F.kreaturSpur(a, { id: 'K' + nr, x: 100 + d * 32, y: 200, facing: 0 }, eintrag); }
    return abgelegt;
  };
  const S1 = spurLauf(5, 12, 0.05), S2 = spurLauf(5, 12, 0.05), S3 = spurLauf(6, 12, 0.05);
  const sp = MODELLE.typen.schwarmling.spur;
  ok(S1.length === Math.floor(12 / sp.abstand), 'ein Stück je ' + sp.abstand + ' m Wegstrecke (12 m: ' + S1.length + ')');
  ok(JSON.stringify(S1) === JSON.stringify(S2), 'deterministisch: derselbe Lauf, dieselben Stücke');
  ok(JSON.stringify(S1.map((o) => o.yaw)) !== JSON.stringify(S3.map((o) => o.yaw)), 'anderes Tier, andere Streuung');
  ok(S1.every((o) => o.art === 'spur' && o.modell === 'kreatur/myzel_faden' && o.max === sp.max && o.jeTier === sp.jeTier && o.tier === 5 && o.leben === sp.leben && o.schwund < o.leben) && new Set(S1.map((o) => o.key)).size === S1.length, 'Stücke: Modell, Höchstzahl und Lebensdauer aus dem Content, eindeutige Schlüssel');
  const F0 = baue({ bodenAblegen: () => {} });
  ok(S1.every((o) => o.x >= 100 && o.x <= 100 + 12 * 32 + 1e-6) && S1.every((o) => Math.abs(o.y - 200) <= F0.KR_SPUR_VERSATZ + 1e-9), 'Stücke liegen auf dem Weg des Tieres (x entlang der Strecke, Versatz quer höchstens ' + F0.KR_SPUR_VERSATZ + ' px)');
  ok(S1.every((o) => Math.abs(o.yaw - Math.atan2(1, 0)) <= F0.KR_SPUR_DREH + 1e-9), 'Drehung folgt der Laufrichtung mit kleiner Streuung');
  ok(spurLauf(5, 0, 0.05).length === 0 && (() => { const a = []; const L = { kreaturInhalt: MODELLE, frame: 1, bodenAblegen: (o) => a.push(o) }; const F = baue(L); const t = { dist: 50 }; F.kreaturSpur(t, { id: 'K1', x: 0, y: 0, facing: 0 }, MODELLE.typen.schwarmling); return a.length; })() === 0, 'Stillstand und der erste Frame legen nichts ab (kein Nachholen der bisherigen Strecke)');
  const keine = []; const Fk = baue({ bodenAblegen: (o) => keine.push(o) });
  Fk.kreaturSpur({ dist: 0 }, { id: 'K2', x: 0, y: 0, facing: 0 }, MODELLE.typen.koenigin); Fk.kreaturSpur({ dist: 30 }, { id: 'K2', x: 0, y: 0, facing: 0 }, MODELLE.typen.koenigin);
  ok(keine.length === 0 && MODELLE.typen.koenigin.spur === undefined && MODELLE.typen.rudeltier.spur === undefined, 'nur Typen mit Eintrag `spur` legen eine Spur (Königin, Rudeltier nicht)');
  ok(Fk.kreaturSpurAnzahl(0, 100, 1.2) <= 2 && Fk.kreaturSpurAnzahl(5, 4, 1.2) === 0 && Fk.kreaturSpurAnzahl(0, 5, 0) === 0, 'höchstens 2 Stücke je Frame, nie negativ, Abstand 0 sicher');
  const kaputt = Fk.kreaturSpurEintrag({ spur: { modell: 'm', max: 9999, abstand: -1, leben: 'x' } });
  ok(kaputt.max === Fk.KR_SPUR_MAX && kaputt.jeTier <= kaputt.max && kaputt.abstand === Fk.KR_SPUR_ABSTAND && kaputt.leben === Fk.KR_SPUR_LEBEN, 'kaputte Werte im Content fallen auf Standardwerte zurück (jeTier nie über max)');
  ok(Fk.kreaturSpurEintrag({ spur: { modell: 'm', max: 10, jeTier: 50 } }).jeTier === 10, 'jeTier wird auf max begrenzt');
  const leer = Fk.kreaturSpurEintrag({ spur: { modell: 'm' } });
  ok(leer.max === Fk.KR_SPUR_MAX && leer.jeTier === Fk.KR_SPUR_JE_TIER && Fk.KR_SPUR_JE_TIER < Fk.KR_SPUR_MAX, 'ohne Angaben: Standard-Deckel insgesamt ' + Fk.KR_SPUR_MAX + ' und je Tier ' + Fk.KR_SPUR_JE_TIER);
  ok(Fk.kreaturSpurEintrag({}) === null && Fk.kreaturSpurEintrag({ spur: { modell: '' } }) === null && Fk.kreaturSpurEintrag(null) === null, 'ohne gültigen Eintrag keine Spur');
  const man = JSON.parse(read('assets/manifest/mon03.json')).assets.find((x) => x.id === 'kreatur/myzel_faden');
  ok(man && man.tags.includes('boden') && man.height <= 0.3 && /kreatur\/myzel_faden/.test(read('public/voxel/index.json')), 'Fadenstück: Bodenoptik (höchstens 0,3 m, keine Kollision nötig), in public/voxel synchronisiert');
});

// ---------- (g) Bodenkulisse: Deckel je Tier und insgesamt, Übernahme, Vorrat, Dispose; Zerfall nur im selben Moment ----------
const BODEN = ac.slice(ac.indexOf('L.boden = new Map();'), ac.indexOf('const layer = {'));
if (BODEN.length < 500) { console.log('  FEHLER Quelltext der Bodenkulisse nicht gefunden'); process.exit(1); }
// Mock-Akteur: zählt Neubauten und Entsorgungen (dispose); alles andere ist die echte Bodenkulisse aus actors.js
function bodenWelt() {
  const W = { neu: 0, weg: 0 };
  class Actor {
    constructor(key) { W.neu++; this.key = key; this.entsorgt = false; this.container = { visible: true, rotation: { y: 0 } }; this.body = { scale: { v: 1, setScalar(v) { this.v = v; } }, add() {} }; }
    dispose() { if (!this.entsorgt) { this.entsorgt = true; W.weg++; } }
  }
  const L = { boden: null, group: {}, frame: 1, time: 0, kreaturInhalt: MODELLE, kreaturZuletzt: new Map() };
  const kreaturSkala = (alter, leben, schwund) => { if (!(alter < leben)) return 0; const ab = leben - Math.min(schwund, leben); return alter <= ab ? 1 : (leben - alter) / (leben - ab); };
  const F0 = baue(L);
  const B = new Function('L', 'Actor', 'kreaturTeil', 'place', 'refreshSlot', 'kreaturSkala', 'KR_BODEN_VORRAT', BODEN + '\nreturn { bodenAblegen, bodenAufraeumen, bodenLeeren };')(L, Actor, () => ({ userData: {} }), () => {}, () => {}, kreaturSkala, F0.KR_BODEN_VORRAT);
  return { W, L, F: F0, B };
}
// Lauf: np Tiere laufen je mit v m/s (gleiches Alter der Strecke), 60 Bilder/s, sek Sekunden; liefert Messwerte
function spurWelt(np, v, sek) {
  const w = bodenWelt(), { L, F, B, W } = w, sp = MODELLE.typen.schwarmling.spur, eintrag = MODELLE.typen.schwarmling;
  const tiere = []; for (let i = 0; i < np; i++) tiere.push({ id: 'K' + (10 + i), a: { dist: 0 }, x: 100 + i * 40, facing: 0 });
  const dt = 1 / 60; let maxGesamt = 0, maxJeTier = 0, maxAlter = 0, maxAlterBeiTod = 0, bisherWeg = 0;
  const gesamt = () => [...L.boden.values()].filter((b) => b.art === 'spur');
  for (let f = 0; f < sek * 60; f++) {
    L.frame++; L.time += dt;
    for (const t of tiere) { t.a.dist += v * dt; F.kreaturSpur(t.a, { id: t.id, x: t.x + t.a.dist * 32, y: 200, facing: 0 }, eintrag); }
    B.bodenAufraeumen(dt);
    const g = gesamt(); maxGesamt = Math.max(maxGesamt, g.length);
    const je = {}; for (const b of g) je[b.tier] = (je[b.tier] || 0) + 1;
    maxJeTier = Math.max(maxJeTier, ...Object.values(je), 0);
    for (const b of g) maxAlter = Math.max(maxAlter, b.alter);
  }
  return { w, sp, maxGesamt, maxJeTier, maxAlter, tiere };
}
section('(g1) Bodenspur: Deckel je Tier und insgesamt, Lebensdauer bei mehreren Tieren, Übernahme statt Neubau', () => {
  const sp = MODELLE.typen.schwarmling.spur;
  ok(sp.max >= 48 && sp.max <= 96 && sp.jeTier >= 8 && sp.jeTier < sp.max && sp.leben >= 10, 'Content: Gesamtdeckel ' + sp.max + ', je Tier ' + sp.jeTier + ', Lebensdauer ' + sp.leben + ' s');
  // Gruppe von 3 Tieren im Heimlauf (1,7 m/s): kein Stück wird vor Ablauf verdrängt, die Lebensdauer wird erreicht
  const R3 = spurWelt(3, 1.7, 45);
  ok(R3.maxAlter >= sp.leben - 0.1 && R3.w.W.neu === R3.w.W.weg + [...R3.w.L.boden.values()].length + R3.w.L.bodenVorrat.length, '3 Tiere: ein Stück lebt die vollen ' + sp.leben + ' s (ältestes erreichte ' + R3.maxAlter.toFixed(1) + ' s), nichts geht verloren');
  ok(R3.maxGesamt <= sp.max && R3.maxJeTier <= sp.jeTier, '3 Tiere: Deckel nie überschritten (gesamt ' + R3.maxGesamt + ', je Tier ' + R3.maxJeTier + ')');
  // 10 Tiere (Rückkehr vieler Schwarmlinge): Deckel hält, ein Stück lebt deutlich länger als die 1,2 bis 2,4 s des Gesamtdeckels 24
  const R10 = spurWelt(10, 1.7, 60);
  ok(R10.maxGesamt <= sp.max && R10.maxGesamt >= sp.max - 2 && R10.maxJeTier <= sp.jeTier, '10 Tiere: Gesamtdeckel ' + sp.max + ' gilt und wird genutzt (' + R10.maxGesamt + '), je Tier höchstens ' + R10.maxJeTier);
  ok(R10.maxAlter >= 5, '10 Tiere: ein Stück lebt mindestens 5 s (ältestes ' + R10.maxAlter.toFixed(1) + ' s; mit Gesamtdeckel 24 und je Tier 2 bis 4 Stücken/s wären es 1,2 bis 2,4 s)');
  // kein ständiges Neuerzeugen: nach 60 s Dauerlauf wurden höchstens so viele Akteure gebaut wie Stücke gleichzeitig da sein dürfen (plus Vorrat)
  ok(R10.w.W.neu <= sp.max + R10.w.F.KR_BODEN_VORRAT, '10 Tiere, 60 s: ' + R10.w.W.neu + ' Akteure gebaut (höchstens ' + (sp.max + R10.w.F.KR_BODEN_VORRAT) + '), das Verdrängen und Ablaufen baut nicht neu');
  // ein extrem schnelles einzelnes Tier erreicht den Deckel je Tier, nicht den Gesamtdeckel
  const R1 = spurWelt(1, 4.5, 30);
  ok(R1.maxJeTier === sp.jeTier && R1.maxGesamt === sp.jeTier, '1 sehr schnelles Tier: Deckel je Tier (' + sp.jeTier + ') greift vor dem Gesamtdeckel (gesamt ' + R1.maxGesamt + ')');
  // zwei Tiere teilen sich den Gesamtdeckel fair: das langsame wird vom schnellen nicht verdrängt, solange der Gesamtdeckel nicht erreicht ist
  const w = bodenWelt();
  const ablegen = (key, tier) => w.L.bodenAblegen({ art: 'spur', key, tier, modell: 'kreatur/myzel_faden', params: {}, x: 0, y: 0, yaw: 0, leben: 16, schwund: 4, max: 6, jeTier: 3 });
  for (let i = 0; i < 3; i++) ablegen('a' + i, 1);
  for (let i = 0; i < 3; i++) ablegen('b' + i, 2);
  ok(w.L.boden.size === 6 && w.W.neu === 6, 'zwei Tiere à 3 Stücke füllen den Gesamtdeckel 6 ohne Verdrängung');
  ablegen('b3', 2);
  ok(w.L.boden.size === 6 && !w.L.boden.has('b0') && w.L.boden.has('a0') && w.L.boden.has('b3') && w.W.neu === 6 && w.W.weg === 0, 'Tier 2 verdrängt nur sein eigenes ältestes Stück (b0), Tier 1 bleibt, der Akteur wird übernommen (kein Neubau, kein Dispose)');
  ablegen('c0', 3);
  ok(w.L.boden.size === 6 && !w.L.boden.has('a0') && w.L.boden.has('c0') && w.W.neu === 6, 'ein drittes Tier bei vollem Gesamtdeckel verdrängt das insgesamt älteste Stück (a0)');
  ablegen('c0', 3);
  ok(w.L.boden.size === 6 && w.W.neu === 6, 'gleicher Schlüssel: kein zweites Stück');
});

section('(g2) Bodenkulisse: Vorrat, Dispose, andere Arten unberührt', () => {
  const w = bodenWelt();
  const ab = (art, key, extra) => w.L.bodenAblegen(Object.assign({ art, key, tier: null, modell: 'kreatur/myzel_faden', params: {}, x: 0, y: 0, yaw: 0, leben: 2, schwund: 1, max: 10 }, extra || {}));
  for (let i = 0; i < 5; i++) ab('spur', 's' + i, { tier: 1, jeTier: 9 });
  for (let i = 0; i < 3; i++) ab('zerfall', 'z' + i, { max: 3 });
  ok(w.W.neu === 8 && w.L.boden.size === 8, 'fünf Spurstücke und drei Zerfallsflecken (eigene Deckel je Art)');
  ab('zerfall', 'z3', { max: 3 });
  ok(w.L.boden.size === 8 && !w.L.boden.has('z0') && w.L.boden.has('s0') && w.W.neu === 8, 'der Deckel einer Art verdrängt nur Stücke derselben Art');
  for (let f = 0; f < 150; f++) w.B.bodenAufraeumen(1 / 60);   // 2,5 s: alles abgelaufen
  ok(w.L.boden.size === 0 && w.L.bodenVorrat.length === 8 && w.W.weg === 0 && w.L.bodenVorrat.every((b) => b.a.container.visible === false), 'abgelaufene Stücke: nicht mehr in der Kulisse, versteckt im Vorrat (' + w.L.bodenVorrat.length + ' von höchstens ' + w.F.KR_BODEN_VORRAT + '), nicht entsorgt');
  ab('spur', 'n0', { tier: 2, jeTier: 9 });
  ok(w.W.neu === 8 && w.L.bodenVorrat.length === 7 && w.L.boden.get('n0').a.container.visible === true && w.L.boden.get('n0').a.body.scale.v === 1, 'ein neues Stück nimmt einen Akteur aus dem Vorrat (kein Neubau), sichtbar und in voller Größe');
  ab('spur', 'n1', { tier: 2, jeTier: 9, modell: 'kreatur/anderes' });
  ok(w.W.neu === 9, 'anderes Modell: der Vorrat passt nicht, ein neuer Akteur wird gebaut');
  // Vorrat ist begrenzt: mehr abgelaufene Stücke als KR_BODEN_VORRAT werden entsorgt
  const w2 = bodenWelt();
  const N = w2.F.KR_BODEN_VORRAT + 10;
  for (let i = 0; i < N; i++) w2.L.bodenAblegen({ art: 'zerfall', key: 'q' + i, tier: null, modell: 'kreatur/schwarm_fleck', params: {}, x: 0, y: 0, yaw: 0, leben: 1, schwund: 0.5, max: 200 });
  for (let f = 0; f < 90; f++) w2.B.bodenAufraeumen(1 / 60);
  ok(w2.L.bodenVorrat.length === w2.F.KR_BODEN_VORRAT && w2.W.weg === 10, 'Vorrat höchstens ' + w2.F.KR_BODEN_VORRAT + ', der Rest wird entsorgt (' + w2.W.weg + ')');
  // Zonenwechsel/Dispose: alles weg, auch der Vorrat
  w2.L.bodenAblegen({ art: 'zerfall', key: 'r0', tier: null, modell: 'kreatur/schwarm_fleck', params: {}, x: 0, y: 0, yaw: 0, leben: 5, schwund: 1, max: 200 });
  w2.B.bodenLeeren();
  ok(w2.L.boden.size === 0 && w2.L.bodenVorrat.length === 0 && w2.W.neu === w2.W.weg, 'bodenLeeren: Kulisse und Vorrat leer, jeder gebaute Akteur entsorgt (' + w2.W.neu + ' gebaut, ' + w2.W.weg + ' entsorgt)');
});

section('(g3) Zerfallsfleck nur, wenn das Tier im selben Moment noch in kr war', () => {
  const abgelegt = [];
  const L = { kreaturInhalt: MODELLE, frame: 1, time: 50, kreaturZuletzt: new Map(), bodenAblegen: (o) => abgelegt.push(o) };
  const F = baue(L);
  const ev = (id) => ({ kind: 'kreaturAufgeloest', id, typ: 'schwarmling', x: 300, y: 300 });
  L.kreaturZuletzt.set('K1', 49.98);   // vor einem Frame noch sichtbar
  L.kreaturZuletzt.set('K2', 49.0);    // vor 1 s aus der Sicht
  L.kreaturZuletzt.set('K3', 47.5);    // vor 2,5 s aus der Sicht (bisher: gezeigt)
  ok(F.KR_BEKANNT_FENSTER <= 0.5, 'Fenster höchstens eine halbe Sekunde (' + F.KR_BEKANNT_FENSTER + ' s), nicht 3 s');
  ok(F.kreaturZerfallEreignis(ev('K1')) === true && abgelegt.length === 1, 'Tier im selben Moment noch sichtbar: Fleck');
  ok(F.kreaturZerfallEreignis(ev('K2')) === false && F.kreaturZerfallEreignis(ev('K3')) === false && abgelegt.length === 1, 'Tier, das 1 s bzw. 2,5 s zuvor aus der Sicht geriet: kein Fleck (der Fleck verriete seine Position)');
  L.time = 50.2; L.kreaturZuletzt.set('K4', 50.0);
  ok(F.kreaturZerfallEreignis(ev('K4')) === true, 'Ereignis 0,2 s nach der letzten Sicht (Netzverzug, wenige Frames): noch gezeigt');
  L.time = 50.4; L.kreaturZuletzt.set('K5', 50.0);
  ok(F.kreaturZerfallEreignis(ev('K5')) === false, 'Ereignis 0,4 s nach der letzten Sicht: nicht mehr gezeigt');
});

section('(f2) Quelltext: Spur ohne Nest, Zerfall ohne Typnamen, Einhängestellen', () => {
  const strip = (t) => t.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const kern = strip(ac.slice(a0, a3)), rein = strip(ac.slice(a0, a1));
  const spurCode = kern.slice(kern.indexOf('function kreaturSpur('), kern.indexOf('function kreaturZerfallEreignis('));
  ok(spurCode.length > 200 && !/nest|anker|koenigin|schwarm/i.test(spurCode) && !/Math\.random/.test(rein.slice(rein.indexOf('const KR_ZERFALL_ZEIT'))), 'Spur-Code: keine Nest-, Anker- oder Königsdaten, kein Math.random');
  ok(!/schwarm|koenigin|myzel|rudeltier/i.test(kern.slice(kern.indexOf('const KR_ZERFALL_ZEIT'))), 'Client-Kern: kein Typname und keine feste Modell-ID (alles aus dem Content)');
  ok(/onEvent\('\*', \(msg\) => \{ try \{ kreaturZerfallEreignis\(msg\)/.test(ac) && /bodenAufraeumen\(dt\)/.test(ac) && /bodenLeeren\(\); L\.lastZone = zone/.test(ac) && /kreaturSpur\(a, e, eintrag\);/.test(ac), 'Einhängestellen: Ereignis-Hörer, Altern je Frame, Leeren beim Zonenwechsel, Spur in updateKreatur');
  ok(/L\.kreaturZuletzt \|\| \(L\.kreaturZuletzt = new Map\(\)\)\)\.set\(e\.id, L\.time\)/.test(ac), 'jedes Tier in kr wird als gesehen vermerkt (Quelle der Spur und des Zerfalls ist nur kr)');
  ok(IDS.indexOf('schwarmling') > 0 && JSON.stringify(MODELLE.reihenfolge) === JSON.stringify(IDS), 'Reihenfolge des Client-Contents unverändert gleich kreaturen.json');
});

console.log('\n' + (n - fails) + '/' + n + ' ok');
process.exit(fails ? 1 : 0);
