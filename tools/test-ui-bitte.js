'use strict';
// SUND-04a-2 P2 (UI): die Bitte eines Fadens in der Antwortleiste (public/js/funkwahl.js, gemeinsame Anzeige mit den Funk-Antworten). Prüft ohne Browser:
//   Modell (world.bitte: Vorrang vor der Funk-Antwort, Löschsignal null, müllfest, Porträt nur in der Form f:<0..5>:<rom|ger|kon>) · Befehle (faden.bitte mit Id und Nummer; „Später“ nur lokal,
//   kein Befehl) · Geometrie: die Leiste mit Porträt liegt je Konsole und Ansicht auf dem Schirm, über der Statusleiste, und verdeckt keine gemessene Bedienfläche
//   (dieselben Messwerte wie tools/test-ui-03b.js: tools/fixtures/funk-bedienflaechen.json) · Porträt-Zeichnung (gültig zeichnet, Müll zeichnet nichts und wirft nichts).
//   node tools/test-ui-bitte.js   (npm run test:ui-bitte)
const fs = require('fs');
const path = require('path');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const schneiden = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const VW = 640;

// Attrappe des Render-Moduls (Maße, Zeichnen als Protokoll) und des Pults (keine Konsole gezeichnet: die Leiste ist dann die Bordansicht)
const gezeichnet = [];
const root = {
  Render: {
    measure: (s) => String(s).length * 6,
    text: (ctx, s, x, y) => gezeichnet.push(['text', String(s), x, y]),
    panel: (ctx, x, y, w, h) => gezeichnet.push(['panel', x, y, w, h]),
    ui: { buttons: [], mouse: { x: -1, y: -1 } },
  },
  Pult: { kappe: () => '', statusOben: () => null, konsole: () => null },
};
global.self = root;
const FW = require('../public/js/funkwahl.js');
const HUD_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'hud.js'), 'utf8').split('\r\n').join('\n');

const OPT = (n) => [{ id: 'zusagen', text: 'Wir helfen Euch.' }, { id: 'ablehnen', text: 'Dafuer haben wir keine Zeit.' }, { id: 'spaeter', text: 'Meldet Euch spaeter.' }].slice(0, n);
const bitteBlock = (n, pid) => ({ nr: 7, von: 'Quintus Serran', text: 'Hilfe bei Ostia Nova.', optionen: OPT(n), kopf: 'BITTE', spaeter: 'Später', rest: 3, pid: pid === undefined ? 'f:1:rom' : pid });
const funkBlock = (n) => ({ nr: 5, von: 'Römische Streife', optionen: OPT(n).map((o) => ({ id: 'f' + o.id, text: o.text })), ignorieren: 'Nicht antworten', rest: 2 });
const snap = (world) => ({ t: 'snap', phase: 'play', world });
const alles = (world) => FW.lesen(snap(world));

section('Modell: Vorrang der Bitte, Löschsignal, müllfest');
alles({ funkwahl: funkBlock(2) });
ok(FW.modell() && FW.modell().art === 'funk', 'ohne Bitte: die Funk-Antwort wie bisher');
alles({ funkwahl: funkBlock(2), bitte: bitteBlock(2) });
ok(FW.modell().art === 'bitte' && FW.modell().nr === 7, 'Bitte und Funk-Antwort zugleich: die Bitte hat den Vorrang');
ok(FW.modell().kopf === 'BITTE' && FW.modell().ignorieren === 'Später', 'Kopf BITTE, Beschriftung Später aus den Daten');
alles({ funkwahl: funkBlock(2), bitte: null });
ok(FW.modell() && FW.modell().art === 'funk', 'bitte = null (Löschsignal): zurück zur Funk-Antwort');
alles({ funkwahl: null, bitte: null });
alles({ bitte: bitteBlock(1) });
ok(FW.modell() === null, 'Bitte mit nur einer Option: keine Wahl, nichts anzeigen');
alles({ bitte: { nr: 'x', optionen: OPT(2) } });
ok(FW.modell() === null, 'Bitte mit kaputter Nummer: nichts anzeigen, kein Fehler');
alles({ bitte: 'Müll' });
ok(FW.modell() === null, 'Bitte als Text: nichts anzeigen, kein Fehler');
alles({ bitte: bitteBlock(2, 'f:6:rom') });
ok(FW.modell().art === 'bitte' && FW.modell().pid === null, 'Porträt außerhalb der Form (Variante 6): kein Porträt, die Bitte bleibt');
alles({ bitte: bitteBlock(2, '<script>') });
ok(FW.modell().pid === null, 'Porträt als Müll: kein Porträt');
for (const pid of ['f:0:kon', 'f:5:ger', 'f:3:rom']) { alles({ bitte: bitteBlock(2, pid) }); ok(FW.modell().pid === pid, 'gültige Porträt-Kennung ' + pid + ' bleibt'); }
ok(FW.bitteAus({ nr: 1, optionen: OPT(2), spaeter: 'x'.repeat(60) }).ignorieren.length <= 20, 'Beschriftung Später auf 20 Zeichen gekürzt');

section('Befehle: faden.bitte mit Id und Nummer, Später nur lokal');
{
  const sent = [];
  const send = (m) => sent.push(m);
  alles({ bitte: bitteBlock(2) });
  ok(FW.antworten(send, 'zusagen') === true && sent.length === 1 && sent[0].c === 'faden.bitte' && sent[0].id === 'zusagen' && sent[0].nr === 7, 'Annahme sendet faden.bitte { id, nr }');
  ok(FW.antworten(send, 'ablehnen') === true && sent[1].id === 'ablehnen', 'Ablehnung sendet faden.bitte mit der Option');
  ok(FW.antworten(send, 'gibt_es_nicht') === false && sent.length === 2, 'unbekannte Zeile: nichts gesendet');
  ok(FW.antworten(send, 'ignorieren') === false && sent.length === 2, 'die Funk-Id „ignorieren“ gilt bei einer Bitte nicht');
  FW.store.eingeklappt = false; FW.store.geoeffnetBei = null;
  ok(FW.antworten(send, '__zuklappen') === true && sent.length === 2 && FW.store.eingeklappt === true, 'Später (__zuklappen): klappt nur zu, kein Befehl');
  alles({ funkwahl: funkBlock(2), bitte: null });   // das Löschsignal der Bitte (der Server schickt es, wenn sie weg ist)
  FW.antworten(send, 'fzusagen');
  ok(sent[sent.length - 1].c === 'funk.antworten', 'die Funk-Antwort sendet wie bisher funk.antworten');
  ok(FW.zeilen(FW.modell()).some((z) => z.id === 'ignorieren'), 'Funk: Zeile „Nicht antworten“ (ignorieren) wie bisher');
}
{
  alles({ bitte: bitteBlock(3) });
  const z = FW.zeilen(FW.modell()).map((x) => x.id);
  ok(z.join(',') === 'zusagen,ablehnen,spaeter,__zuklappen', 'Bitte: die drei Optionen, dann Später (lokal) – die Daten-Option „spaeter“ bleibt eine echte Antwort');
}

section('Geometrie: Leiste mit Porträt auf dem Schirm, über der Statusleiste, ohne verdeckte Bedienflächen');
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'funk-bedienflaechen.json'), 'utf8')).ansichten;
const namen = Object.keys(F);
const bedien = FW.BEDIENFLAECHEN;
const schirmDe = (r, S) => r.x >= 62 && r.y >= 6 && r.x + r.w <= 634 && r.y + r.h <= S - 6;
let verdeckt = 0, plaketten = 0;
for (const pid of ['f:1:rom', null]) for (const nOpt of [2, 3]) {
  alles({ bitte: bitteBlock(nOpt, pid) });
  const m = FW.modell();
  for (const k of namen) {
    const v = F[k], ko = { S: v.S, station: v.station };
    FW.store.eingeklappt = false; FW.store.geoeffnetBei = null;
    const zugeklappt = FW.zu(ko);
    const r = FW.rechteck(m, ko);
    const hit = v.knoepfe.filter((b) => schneiden(r, b));
    ok(hit.length === 0 && schirmDe(r, v.S), `Bitte ${nOpt} Optionen${pid ? ' mit Porträt' : ''}, ${k} (${v.station}): ${zugeklappt ? 'Streifen' : 'volle Leiste'} ${r.x},${r.y} ${r.w}x${r.h}${hit.length ? ' verdeckt: ' + hit.map((b) => b.label).join(', ') : ''}`);
    ok(zugeklappt === bedien.includes(v.station), '   ... Streifen genau an den Bedienflächen-Konsolen');
    FW.store.geoeffnetBei = v.station; FW.store.eingeklappt = false;
    const ra = FW.rechteck(m, ko, false);
    ok(schirmDe(ra, v.S) && ra.y + ra.h <= v.S - 6, '   ... aufgeklappt auf dem Schirm über der Statusleiste');
    verdeckt += v.knoepfe.filter((b) => schneiden(ra, b)).length;
    if (!bedien.includes(v.station) && pid) plaketten++;
  }
  FW.store.geoeffnetBei = null;
}
ok(verdeckt > 0 && plaketten > 0, 'Gegenprobe: die aufgeklappte Leiste verdeckt an den Bedienflächen-Konsolen Knöpfe (der Streifen ist nötig)');
{
  alles({ bitte: bitteBlock(2, 'f:1:rom') });
  const m = FW.modell();
  const hoch = FW.rechteck(m, { S: 258, station: 'helm' }, false).h;
  alles({ bitte: bitteBlock(2, null) });
  const ohne = FW.rechteck(FW.modell(), { S: 258, station: 'helm' }, false).h;
  ok(hoch === ohne + 11, `die Kopfzeile mit Porträt ist 11 Pixel höher (${hoch} gegen ${ohne})`);
}

section('Porträt-Zeichnung: gültig zeichnet, Müll zeichnet nichts und wirft nichts');
{
  // Die Zeichnung steht in hud.js (Hud.drawPortraetFaden). Ohne Browser: die Methode aus dem Quelltext laden und mit einem Protokoll-Kontext aufrufen
  const m = /drawPortraetFaden\(ctx, pid, x, y, w\) \{[\s\S]*?\n {4}\},\n {4}drawFunkBild/.exec(HUD_SRC);
  ok(!!m, 'drawPortraetFaden steht in hud.js');
  if (m) {
    const body = m[0].replace(/,\n {4}drawFunkBild$/, '');
    const fn = new Function('return { ' + body.trim().replace(/,$/, '') + ' }')();
    const rects = [];
    const ctx = { save() {}, restore() {}, translate() {}, fillRect(x, y, w, h) { rects.push([x, y, w, h]); }, fillStyle: '' };
    const draw = fn.drawPortraetFaden;
    let gueltig = 0;
    for (const v of [0, 1, 2, 3, 4, 5]) for (const fr of ['rom', 'ger', 'kon']) {
      rects.length = 0;
      const r = draw.call({}, ctx, 'f:' + v + ':' + fr, 0, 0, 22);
      if (r === true && rects.length >= 5) gueltig++;
    }
    ok(gueltig === 18, `alle 18 gültigen Kennungen zeichnen (${gueltig}/18)`);
    rects.length = 0;
    ok(draw.call({}, ctx, 'f:9:rom', 0, 0, 22) === false && rects.length === 0, 'Variante 9: nichts gezeichnet');
    ok(draw.call({}, ctx, { kaputt: true }, 0, 0, 22) === false, 'Müll als Objekt: nichts gezeichnet, kein Fehler');
    ok(draw.call({}, ctx, undefined, 0, 0, 22) === false, 'ohne Kennung: nichts gezeichnet');
  }
}

console.log(`\n${n - fails} von ${n} Prüfungen bestanden` + (fails ? `, ${fails} FEHLER` : ''));
if (fails) process.exit(1);
