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
const KT0 = require('../public/js/karte-tokens.js');   // Welle 5 (S7): das Porträt liest die Fraktionsflächen aus KarteTokens

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
const imSlot = (r) => r.y === 0 && r.y + r.h <= 11 && r.x >= 0 && r.x + r.w <= VW;   // Nacharbeit F4: der Streifen im Ruf-Slot oben (Köpfe beginnen bei y 12)
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
    ok(hit.length === 0 && (zugeklappt ? imSlot(r) : schirmDe(r, v.S)), `Bitte ${nOpt} Optionen${pid ? ' mit Porträt' : ''}, ${k} (${v.station}): ${zugeklappt ? 'Streifen' : 'volle Leiste'} ${r.x},${r.y} ${r.w}x${r.h}${hit.length ? ' verdeckt: ' + hit.map((b) => b.label).join(', ') : ''}`);
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

section('Geometrie mit dem längsten Bittentext (zwei Zeilen, F1): die volle Leiste liegt weiter auf dem Schirm und verdeckt an Steuer und Ops nichts');
{
  const lang = Object.assign(bitteBlock(3, 'f:1:rom'), { text: 'Wir brauchen dringend Hilfe bei Forschungsstation Helix, die Sensoren melden einen Verband, und wir sind allein da draussen.'.slice(0, 90) });
  alles({ bitte: lang });
  const m = FW.modell();
  ok(m.text.length === 90, 'Testtext mit 90 Zeichen');
  let geprueft = 0;
  for (const k of namen) {
    const v = F[k], ko = { S: v.S, station: v.station };
    FW.store.geoeffnetBei = v.station; FW.store.eingeklappt = false;
    const ra = FW.rechteck(m, ko, false);
    ok(schirmDe(ra, v.S), `${k} (${v.station}): aufgeklappt mit zwei Textzeilen auf dem Schirm (${ra.x},${ra.y} ${ra.w}x${ra.h}, S ${v.S})`);
    if (!bedien.includes(v.station)) { ok(v.knoepfe.every((b) => !schneiden(ra, b)), `${k}: die volle Leiste mit zwei Textzeilen verdeckt keine Bedienfläche`); geprueft++; }
  }
  FW.store.geoeffnetBei = null;
  ok(geprueft >= 2, 'Steuer und Ops geprueft (' + geprueft + ' Ansichten)');
}

section('Porträt-Zeichnung: gültig zeichnet, Müll zeichnet nichts und wirft nichts');
{
  // Die Zeichnung steht in hud.js (Hud.drawPortraetFaden). Ohne Browser: die Methode aus dem Quelltext laden und mit einem Protokoll-Kontext aufrufen
  const m = /drawPortraetFaden\(ctx, pid, x, y, w\) \{[\s\S]*?\n {4}\},\n {4}drawFunkBild/.exec(HUD_SRC);
  ok(!!m, 'drawPortraetFaden steht in hud.js');
  if (m) {
    const body = m[0].replace(/,\n {4}drawFunkBild$/, '');
    const fn = new Function('window', 'return { ' + body.trim().replace(/,$/, '') + ' }')({ KarteTokens: KT0 });
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

// =====================================================================================================================================================================
// Nacharbeit SUND-04a-2, Welle 2 (Design M1, M2, M4, S1–S5, K1–K3): Bittentext in der Leiste, Ruf-Slot oben mit Vorrang des Lagefunks, ODA, Rahmen, Kürzel, Frist, Kappe.
// Die Schriftbreite ist die ECHTE (art.js measureText, in einem vm-Kontext geladen), nicht 6 Pixel je Zeichen.
// =====================================================================================================================================================================
const vm = require('vm');
const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8').split('\r\n').join('\n');
const echt = (() => {
  const w = { console, Math, Object, String, Number, Array, JSON, Date, performance: { now: () => 0 }, document: { createElement: () => ({ getContext: () => ({}), style: {} }) }, setTimeout, clearTimeout, requestAnimationFrame: () => 0 };
  w.window = w; w.self = w;
  vm.createContext(w);
  vm.runInContext(SRC('art.js'), w, { filename: 'art.js' });
  const measure = (s) => w.Art.measureText(String(s), 1);
  const wrap = (str, maxW) => { const words = String(str || '').split(/\s+/); const lines = []; let line = ''; for (const x of words) { const t = line ? line + ' ' + x : x; if (measure(t) > maxW && line) { lines.push(line); line = x; } else line = t; } if (line) lines.push(line); return lines; };   // wie Render.wrap
  return { measure, wrap };
})();
// Methoden aus hud.js (echter Quelltext), mit Attrappen für die Umgebung
const methode = (name) => { const a = HUD_SRC.indexOf('\n    ' + name + '('); if (a < 0) return null; const b = HUD_SRC.indexOf('\n    },', a); return HUD_SRC.slice(a + 1, b + 6); };
const HUDQ = { lagefunkEinzeilig: methode('lagefunkEinzeilig'), odaHoehe: methode('odaHoehe'), zeichneFunkZeile: methode('zeichneFunkZeile') };
const LAGEFUNK_Y = +/LAGEFUNK_Y = (\d+)/.exec(HUD_SRC)[1];
function bauHud(o) {   // o: { lage, debug, szene, sitzBlick, oda }
  const rects = [];
  const R = { measure: echt.measure, wrap: echt.wrap, text() {} };
  const KT = { PULT: { tisch: '#0B0E1A', messing: '#C9974A' }, FARBE: { funk: { akzentFeind: '#E0473C', akzentLage: '#C9974A' } } };
  const wnd = { Sitz: o.sitz || null, KarteTokens: KT, Consoles: null };
  const quelle = '{ ' + [HUDQ.lagefunkEinzeilig, HUDQ.odaHoehe, HUDQ.zeichneFunkZeile].join(',\n') + ' }';
  const H = new Function('R', 'VW', 'PAL', 'window', 'KarteTokens', 'return ' + quelle)(R, VW, { star: '#F4EEDC', brass: '#C9974A' }, wnd, KT);
  H.oda = { cur: o.oda ? { text: o.oda } : null, queue: [] };
  H.radioAktuell = () => (o.lage ? { lage: true, from: 'Aufklärung', text: 'Lage.', fd: 0 } : null);
  H.radioOberkante = () => (o.debug ? 16 : 6);
  H.szeneVon = () => (o.szene ? { p: 'v' } : null);
  H.fitWort = (t) => t; H.lagefunkZeilenText = (f) => 'LAGE · ' + f.text; H.funkAkzent = () => '#E0473C';
  H.zeile = () => { rects.length = 0; const ctx = { fillStyle: '', fillRect(x, y, w, h) { rects.push({ x, y, w, h, c: this.fillStyle }); } }; H.zeichneFunkZeile(ctx, { me: { console: 'shop' } }, H.radioAktuell()); return rects[0]; };
  return H;
}

section('Methoden aus hud.js gefunden (Quelltext, nicht nachgebaut)');
ok(!!HUDQ.lagefunkEinzeilig && !!HUDQ.odaHoehe && !!HUDQ.zeichneFunkZeile, 'lagefunkEinzeilig, odaHoehe und zeichneFunkZeile stehen in hud.js');

section('Bittentext (F1): die Leiste zeigt ihn unter dem Kopf, höchstens zwei Zeilen, ohne doppelten Namen und ohne offenen Platzhalter');
{
  const R0 = root.Render;
  root.Render = Object.assign({}, R0, { measure: echt.measure, wrap: echt.wrap });
  const FWmod = (extra) => FW.bitteAus(Object.assign(bitteBlock(2), extra));
  ok(FWmod({ text: 'Wir brauchen Hilfe bei Ostia Nova.' }).text === 'Wir brauchen Hilfe bei Ostia Nova.', 'der Text des Servers wird übernommen');
  ok(FWmod({ text: 'Quintus Serran: Wir brauchen Hilfe.' }).text === 'Wir brauchen Hilfe.', 'ein führendes „<von>: “ wird abgeschnitten (der Absender steht im Kopf)');
  ok(FWmod({ text: 'Hilfe bei {ort}!' }).text === '' && FWmod({ text: 'Danke {name}' }).text === '', 'ein Text mit offenem Platzhalter wird nicht gezeigt');
  ok(FWmod({ text: 'x'.repeat(200) }).text.length === 90, 'höchstens 90 Zeichen');
  ok(FWmod({ text: undefined }).text === '' && FWmod({ text: 42 }).text === '', 'kein Text oder Müll: leerer Text, kein Fehler');
  ok(FW.bitteAus({ nr: 1, optionen: OPT(2) }).ignorieren === 'Einklappen', 'ohne Beschriftung vom Server: „Einklappen“ (S2), nicht „Später“');
  ok(FWmod({ fk: 'Rom' }).fk === 'Rom' && FWmod({ fk: 'x'.repeat(40) }).fk.length <= 4 && FWmod({ fk: undefined }).fk === '', 'Kürzel der Fraktion: höchstens 4 Zeichen, fehlt = leer');
  // Zeichnen (Bordansicht): Kopf, dann der Text, dann die Optionen
  const zeichneBitte = (block, k) => {
    alles({ bitte: block });
    FW.store.eingeklappt = false; FW.store.geoeffnetBei = null;
    gezeichnet.length = 0;
    root.Pult.konsole = () => k || null;
    const rects = [];
    const ctx = { fillStyle: '', fillRect(x, y, w, h) { rects.push({ x, y, w, h, c: this.fillStyle }); } };
    FW.zeichne(ctx, { me: { console: k ? k.station : null }, send() {} });
    root.Pult.konsole = () => null;
    return { text: gezeichnet.filter((g) => g[0] === 'text'), panel: gezeichnet.find((g) => g[0] === 'panel'), rects };
  };
  {
    const z = zeichneBitte(bitteBlock(2, 'f:1:rom'));
    const kopf = z.text.find((t) => /^BITTE · /.test(t[1])), satz = z.text.find((t) => t[1] === 'Hilfe bei Ostia Nova.'), opt = z.text.find((t) => t[1] === 'Wir helfen Euch.');
    ok(!!kopf && !!satz && !!opt && kopf[3] < satz[3] && satz[3] < opt[3], `der Text steht zwischen Kopf (y ${kopf && kopf[3]}) und Optionen (y ${opt && opt[3]}): y ${satz && satz[3]}`);
    ok(kopf[1] === 'BITTE · Quintus Serran · Rom'.replace(' · Rom', '') || kopf[1] === 'BITTE · Quintus Serran', `Kopf ohne Kürzel, wenn der Server keins schickt (${kopf[1]})`);
  }
  {
    const lang = 'Wir brauchen dringend Hilfe bei Forschungsstation Helix, die Sensoren melden einen Verband, und wir sind allein.';   // zu lang für zwei Zeilen
    const z = zeichneBitte(Object.assign(bitteBlock(2, null), { text: lang.slice(0, 90) }));
    const kopfY = z.text.find((t) => /^BITTE · /.test(t[1]))[3], optY = z.text.find((t) => t[1] === 'Wir helfen Euch.')[3];
    const zeilenText = z.text.filter((t) => t[3] > kopfY && t[3] < optY - 4);
    ok(zeilenText.length >= 1 && zeilenText.length <= 2, `höchstens zwei Textzeilen (${zeilenText.length})`);
    const breit = Object.assign(bitteBlock(2, null), { text: 'WWWWWWWWWW '.repeat(8).trim().slice(0, 90) });
    const zb = zeichneBitte(breit);
    const tz = zb.text.filter((t) => t[3] > kopfY && t[3] < optY && /^W/.test(t[1]));
    ok(tz.length === 2 && /…$/.test(tz[1][1]), `ein zu langer Text endet nach zwei Zeilen mit „…“ (${tz.map((t) => t[1].slice(-4)).join(' | ')})`);
    // Höhe der Leiste wächst mit dem Text: mit Text höher als ohne, genau um zwei Zeilen und den Abstand
    const mit = FW.rechteck(FW.modell(), null, false).h;
    alles({ bitte: Object.assign(bitteBlock(2, null), { text: '' }) });
    const ohne = FW.rechteck(FW.modell(), null, false).h;
    ok(mit - ohne === 23, `zwei Textzeilen kosten 23 Pixel Höhe (${mit} gegen ${ohne})`);
  }
  // Die Texte der Daten passen in zwei Zeilen der echten Schrift (sonst würde die Leiste kürzen)
  {
    const BW = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'bitte-werte.json'), 'utf8')).werte;
    const EIN = { ort: 'Forschungsstation Helix', ziel: 'Raffinerie Lumen', name: 'Aurelia Aschenfeld' };
    const falsch = [];
    for (const [k, t] of Object.entries(BW.texte.wert)) {
      const s = t.replace(/\{(\w+)\}/g, (m, p) => EIN[p] || m);
      const l = echt.wrap(s, 228);
      if (l.length > 2 || s.length > 90) falsch.push(k + ' (' + l.length + ' Zeilen, ' + s.length + ' Zeichen)');
    }
    ok(Object.keys(BW.texte.wert).length >= 5 && falsch.length === 0, 'jeder Bittentext der Daten passt mit dem längsten Ort in zwei Zeilen der echten Schrift' + (falsch.length ? ': ' + falsch.join(', ') : ''));
  }
  root.Render = R0;
}

section('Kopf, Frist, Plakette, Kappe (S4, S5, K2, K3)');
{
  const R0 = root.Render, H0 = root.Hud;
  root.Render = Object.assign({}, R0, { measure: echt.measure, wrap: echt.wrap });
  const bilder = [];
  root.Hud = { drawFunkBild: (ctx, pid, x, y, w) => bilder.push([pid, x, y, w]) };
  const rechtecke = [];   // fillRect-Aufrufe der Leiste: [x, y, w, h, Farbe] (Welle 5, S9: der Punkt der Kappe)
  const zeichne = (block, k, pult) => {
    alles({ bitte: block }); FW.store.eingeklappt = false; FW.store.geoeffnetBei = null;
    gezeichnet.length = 0; bilder.length = 0; rechtecke.length = 0; root.Pult.konsole = () => k || null; if (pult) root.Pult.kappe = pult;
    const ctx = { fillStyle: '', fillRect(x, y, w, h) { rechtecke.push([x, y, w, h, this.fillStyle]); } };
    FW.zeichne(ctx, { me: { console: k ? k.station : null }, send() {} });
    root.Pult.konsole = () => null; root.Pult.kappe = () => '';
    return gezeichnet.filter((g) => g[0] === 'text');
  };
  const voll = (r) => zeichne(Object.assign(bitteBlock(2, 'f:1:rom'), { fk: 'Rom', rest: r }), null);
  const t3 = voll(3);
  ok(t3.some((t) => t[1] === 'BITTE · Quintus Serran · Rom'), 'Kopf mit Kürzel der Fraktion: BITTE · Name · Rom (S5)');
  ok(!t3.some((t) => t[1] === 'offen'), 'volle Leiste: kein „offen“ (K2), es steht nie etwas Unwahres in der Ecke');
  const t1 = voll(1), t0 = voll(0);
  ok(t1.some((t) => t[1] === 'läuft ab') && t0.some((t) => t[1] === 'läuft ab'), 'rest 1 und 0: „läuft ab“ in der vollen Leiste (K2)');
  const kopfY = t1.find((t) => /^BITTE · /.test(t[1]))[3], abY = t1.find((t) => t[1] === 'läuft ab')[3];
  ok(kopfY === abY, `Kopf und Frist stehen auf einer Grundlinie (S4): y ${kopfY} und ${abY}`);
  // Plakette: bündig mit dem Rahmen der Leiste (r.x + 5, r.y + 3)
  {
    alles({ bitte: Object.assign(bitteBlock(2, 'f:1:rom'), { rest: 3 }) });
    const r = FW.rechteck(FW.modell(), null, false);
    voll(3);
    ok(bilder.length === 1 && bilder[0][1] === r.x + 7 && bilder[0][2] === r.y + 3 && bilder[0][3] === 22, `Plakette bei r.x+7 (2 px weiter innen, Welle 5 K4), r.y+3 (${bilder[0] && bilder[0].join(',')} gegen ${r.x + 7},${r.y + 3})`);
    const kopf = gezeichnet.find((q) => q[0] === 'text' && q[1].indexOf('BITTE') === 0);
    ok(!!kopf && kopf[2] === r.x + 6 + 29 && kopf[2] >= bilder[0][1] + 22 + 4, `Kopftext rückt mit: x ${kopf && kopf[2]} (≥ Plakette + 4 px Luft)`);
  }
  // Streifen: „offen“ erst im Streifen, „läuft ab“ bei rest ≤ 1
  {
    const k = { S: 152, station: 'technik' };
    const s3 = zeichne(Object.assign(bitteBlock(2, 'f:1:rom'), { fk: 'Rom', rest: 3 }), k);
    const s1 = zeichne(Object.assign(bitteBlock(2, 'f:1:rom'), { fk: 'Rom', rest: 1 }), k);
    ok(s3.some((t) => /^BITTE · Quintus Serran · Rom · offen$/.test(t[1])), `Streifen: „… · Rom · offen“ (${s3.map((t) => t[1]).join(' | ')})`);
    ok(s1.some((t) => /· läuft ab$/.test(t[1])), 'Streifen bei rest 1: „läuft ab“');
  }
  // Kappe (Welle 5, S9): die Punkt-Taste wird nicht als Glyph, sondern als 2×2-Block auf der Grundlinie gezeichnet; „Sh+.“ mit Präfix „Sh+“ als Text davor; ein Buchstabe bleibt Text
  {
    const bloecke = () => rechtecke.filter((r) => r[2] === 2 && r[3] === 2 && r[4] === '#F4EEDC');
    const kappen = (taste) => { const t = zeichne(Object.assign(bitteBlock(2, null), { rest: 3 }), null, () => taste); return t.filter((x) => x[1] === taste); };
    const punkt = kappen('.');
    ok(punkt.length === 0 && bloecke().length === 2, `Punkt-Kappe: kein Glyph „.“, dafür ein 2×2-Block je Kappe (${bloecke().length} Blöcke, zwei Kappen)`);
    const kappeR = rechtecke.filter((r) => r[3] === 9 && r[4] === '#46556A');
    const mitte = (b, k) => b[0] + 1 - (k[0] + k[2] / 2);
    ok(kappeR.length === 2 && bloecke().every((b, i) => Math.abs(mitte(b, kappeR[i])) <= 1 && b[1] === kappeR[i][1] + 6), 'der Block sitzt mittig in der Kappe, auf der Grundlinie des Textes (' + bloecke().map((b) => b.join(',')).join(' | ') + ')');
    const buchstabe = kappen('M');
    ok(buchstabe.length === 2 && bloecke().length === 0, 'Buchstaben-Kappe: Text, kein Block');
    const sh = zeichne(Object.assign(bitteBlock(2, null), { rest: 3 }), null, (n, a) => (a === 'allgemein.funkSenden' ? 'Sh+.' : '.'));
    ok(sh.filter((x) => x[1] === 'Sh+').length === 1 && sh.filter((x) => x[1] === 'Sh+.').length === 0 && bloecke().length === 2, '„Sh+.“: „Sh+“ als Text, der Punkt als Block dahinter (kein „.“-Glyph)');
    const shB = bloecke().find((b, i) => b[0] > 0 && sh.some((x) => x[1] === 'Sh+' && b[0] > x[2]));
    ok(!!shB, 'der Block von „Sh+.“ steht rechts neben „Sh+“');
  }
  root.Render = R0; root.Hud = H0;
}

section('Ruf-Slot oben mit Vorrang des Lagefunks (F4): gleiche Lage wie die Lagefunk-Zeile, nie darüber');
{
  const R0 = root.Render, H0 = root.Hud;
  root.Render = Object.assign({}, R0, { measure: echt.measure, wrap: echt.wrap });
  const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'funk-bedienflaechen.json'), 'utf8')).ansichten;
  const konsolen = { helm: 'helm', weapons: 'weapons', technik: 'technik', captain: 'captain', shop: 'shop' };
  const EINZEILIG = { helm: true, weapons: true, shop: true, technik: false, captain: false };   // Erwartung aus dem Design: die Konsolen, an denen der Lagefunk einzeilig oben steht
  const strip = (hud, konsole, block) => {
    root.Hud = hud; alles({ bitte: block || bitteBlock(2, 'f:1:rom') });
    FW.store.eingeklappt = true; FW.store.geoeffnetBei = null;
    const k = { S: 200, station: konsole };
    root.Pult.konsole = () => k;
    const rects = []; const ctx = { fillStyle: '', fillRect(x, y, w, h) { rects.push({ x, y, w, h, c: this.fillStyle }); } };
    FW.zeichne(ctx, { me: { console: konsole }, send() {} });
    root.Pult.konsole = () => null; FW.store.eingeklappt = false;
    return rects;
  };
  for (const [name, konsole] of Object.entries(konsolen)) {
    const hud = bauHud({ lage: true });
    const einzeilig = hud.lagefunkEinzeilig({ me: { console: konsole } });
    ok(einzeilig === EINZEILIG[name], `${name}: einzeilige Lagefunk-Zeile = ${EINZEILIG[name]} (Hud.lagefunkEinzeilig meldet ${einzeilig})`);
    const rects = strip(hud, konsole);
    const zeile = hud.zeile();
    if (einzeilig) ok(rects.length === 0, `${name}: solange die Lagefunk-Zeile steht, wird der Streifen NICHT gezeichnet (Vorrang, ${rects.length} Flächen)`);
    else {
      const slot = rects[0];
      ok(rects.length >= 2 && slot.y === 0 && slot.h === 11 && slot.x === 388 && slot.w === 240, `${name}: ohne Lagefunk-Zeile steht der Streifen im Ruf-Slot (${slot && [slot.x, slot.y, slot.w, slot.h].join(',')})`);
      ok(slot.y + slot.h <= LAGEFUNK_Y, `${name}: die Lagefunk-Tafel beginnt bei y ${LAGEFUNK_Y}, der Streifen endet bei ${slot.y + slot.h}: nie darüber`);
      ok(rects.some((q) => q.x === slot.x && q.w === 3 && q.h === slot.h && q.c === '#C9974A') && rects.some((q) => q.y === slot.y + slot.h - 1 && q.w === slot.w && q.h === 1 && q.c === '#C9974A') && rects.every((q) => q.c !== '#E0473C'), `${name}: Stil wie die Lagefunk-Zeile, 3 px Akzent und 1 px Unterkante in Messing, nie Gefahr-Rot`);
    }
    ok(zeile.y === 0 && zeile.h === 11, `${name}: die Lagefunk-Zeile liegt selbst bei y 0, ${zeile.h} hoch (Slot gemessen am echten zeichneFunkZeile)`);
    const ohneLage = strip(bauHud({ lage: false }), konsole);
    ok(ohneLage.length >= 2 && ohneLage[0].y === 0 && ohneLage[0].h === 11, `${name}: ohne Lagemeldung steht der Streifen im Ruf-Slot oben (y ${ohneLage[0] && ohneLage[0].y}), auch an Steuer und Ops nach „Einklappen“ (die Taste „.“ und der Klick klappen ihn auf)`);
  }
  // Slot, Höhe und Debug-Modus wie die Lagefunk-Zeile
  for (const [titel, o, ex] of [['normal', {}, { y: 0, h: 11 }], ['Szenenzeile (9 hoch)', { szene: true }, { y: 0, h: 9 }], ['Debug (x 404, 232 breit)', { debug: true }, { y: 0, h: 11, x: 404, w: 232 }], ['Debug mit Szenenzeile', { debug: true, szene: true }, { y: 0, h: 9, x: 404, w: 232 }]]) {
    const hud = bauHud(Object.assign({ lage: true }, o));
    root.Hud = hud;
    const sl = FW.slot({ me: { console: 'technik' } });
    const zeile = hud.zeile();
    ok(sl.y === ex.y && sl.h === ex.h && sl.h === zeile.h && (ex.x === undefined || (sl.x === ex.x && sl.w === ex.w && zeile.x === ex.x && zeile.w === ex.w)), `Slot ${titel}: ${[sl.x, sl.y, sl.w, sl.h].join(',')}, Lagefunk-Zeile ${[zeile.x, zeile.y, zeile.w, zeile.h].join(',')}`);
  }
  // Der Streifen überdeckt in keiner gemessenen Ansicht eine Bedienfläche und liegt über den Köpfen (die beginnen bei y 12: Technik-Zeile, Terminal-Kopf; MISSION 14, MARKEN 16)
  {
    root.Hud = bauHud({ lage: false });
    const KOPF_AB = 12;
    const sl = FW.slot({ me: { console: 'technik' } });
    ok(sl.y + sl.h <= KOPF_AB, `der Streifen endet bei y ${sl.y + sl.h}, die Köpfe beginnen bei y ${KOPF_AB}`);
    const nahe = Object.keys(F).filter((a) => F[a].knoepfe.some((b) => schneiden(sl, b)));
    ok(nahe.length === 0, 'der Streifen überdeckt in keiner der gemessenen Ansichten eine Bedienfläche' + (nahe.length ? ': ' + nahe.join(', ') : ''));
    const mitte = { x: 100, y: 0, w: 440, h: 11 };   // die Alternative (mittig wie die Lagefunk-Zeile) täte es: Technik Reiter 1 (Bots-Knopf y 8) und Captain Reiter 4 (y 10)
    ok(Object.keys(F).some((a) => F[a].knoepfe.some((b) => schneiden(mitte, b))), 'Gegenprobe: mittig (x 100 bis 540) würde der Slot Knöpfe überdecken, darum rechts');
  }
  root.Render = R0; root.Hud = H0;
}

section('ODA unten in der Bordansicht (S3): die Leiste steht darüber');
{
  const R0 = root.Render, H0 = root.Hud;
  root.Render = Object.assign({}, R0, { measure: echt.measure, wrap: echt.wrap });
  const ODA = 'Aus dem Sektor Lichtkordon kommt ein Notruf. Die Ortung meldet drei Kontakte und einen Frachter im Anflug auf den Hafen.';
  const hud = bauHud({ oda: ODA });
  root.Hud = hud;
  alles({ bitte: bitteBlock(2, 'f:1:rom') });
  FW.store.eingeklappt = false;
  const zeilenZahl = echt.wrap(ODA, 284 - 44).length;
  const odaH = 10 + zeilenZahl * 10, odaOben = 360 - odaH - 6;   // drawOda: y = VH - h - 6
  ok(hud.odaHoehe({ me: {} }) === odaH && odaH > 20, `odaHoehe = ${odaH} (${zeilenZahl} Zeilen)`);
  ok(hud.odaHoehe({ me: { console: 'helm' } }) === 0, 'an einer Konsole steht die ODA oben: Höhe 0 für die Leiste');
  const r = FW.rechteck(FW.modell(), null, false, { me: {} });
  ok(r.y + r.h <= odaOben, `Leiste (${r.y} bis ${r.y + r.h}) endet über der ODA-Zeile (beginnt bei ${odaOben})`);
  const ohne = FW.rechteck(FW.modell(), null, false, null);
  ok(ohne.y + ohne.h > odaOben, 'Gegenprobe: ohne die Rücksicht läge sie auf der ODA-Zeile');
  const rz = FW.rechteck(FW.modell(), null, true, { me: {} });
  ok(rz.y + rz.h <= odaOben, 'der zugeklappte Streifen in der Bordansicht ebenso');
  root.Hud = bauHud({ oda: null });
  ok(FW.rechteck(FW.modell(), null, false, { me: {} }).y === ohne.y, 'ohne ODA bleibt die Leiste, wo sie war');
  root.Render = R0; root.Hud = H0;
}

section('Faden-Porträt (S4, K1): Messingrahmen, hellere Mütze');
{
  const m = /drawPortraetFaden\(ctx, pid, x, y, w\) \{[\s\S]*?\n {4}\},\n {4}drawFunkBild/.exec(HUD_SRC);
  const body = m[0].replace(/,\n {4}drawFunkBild$/, '');
  const fn = new Function('window', 'return { ' + body.trim().replace(/,$/, '') + ' }')({ KarteTokens: KT0 });
  const zeichnen = (pid, w) => { const rects = []; const ctx = { save() {}, restore() {}, translate() {}, fillRect(x, y, bw, bh) { rects.push({ x, y, w: bw, h: bh, c: this.fillStyle }); }, fillStyle: '' }; fn.drawPortraetFaden.call({}, ctx, pid, 0, 0, w); return rects; };
  const r = zeichnen('f:0:rom', 24);
  const rahmen = [[0, 0, 24, 1], [0, 23, 24, 1], [0, 0, 1, 24], [23, 0, 1, 24]];
  ok(rahmen.every(([x, y, w, h]) => r.some((q) => q.x === x && q.y === y && q.w === w && q.h === h && q.c === '#C9974A')), 'Porträt: 1 px Messingrahmen (#C9974A) an allen vier Seiten');
  const farben = (v) => new Set(zeichnen('f:' + v + ':kon', 24).map((q) => q.c));
  ok(farben(2).has('#46556A') && !farben(2).has('#2A3A52'), 'Variante 2: Mütze in #46556A, nicht mehr #2A3A52 (K1)');
  ok([0, 1, 3, 4, 5].every((v) => zeichnen('f:' + v + ':ger', 22).length >= 6), 'die anderen Varianten zeichnen weiter');
}

section('Funkwahl (Welle 5, K5): Farben aus KarteTokens.PULT');
{
  const PULT = KT0.PULT;
  delete require.cache[require.resolve('../public/js/funkwahl.js')];
  root.KarteTokens = KT0;
  const FW2 = require('../public/js/funkwahl.js');
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'funkwahl.js'), 'utf8');
  ok(/text: PU.hell/.test(quelle) && /dim: PU.stahlhell/.test(quelle) && /frame: PU.messing/.test(quelle) && /offLine: PU.aus/.test(quelle) && /bg: PU.tisch/.test(quelle), 'SK liest hell, stahlhell, messing, aus und tisch aus KarteTokens.PULT');
  ok(!!FW2 && PULT.hell === '#F4EEDC' && PULT.stahlhell === '#8EA3B5' && PULT.messing === '#C9974A' && PULT.aus === '#3A4A66' && PULT.tisch === '#0B0E1A', 'die Pult-Werte sind dieselben wie die bisherigen festen Hex-Werte (keine Farbänderung)');
  delete root.KarteTokens;
  delete require.cache[require.resolve('../public/js/funkwahl.js')];
  require('../public/js/funkwahl.js');
}

section('Faden-Porträt (Welle 5, S7): Schulterfarbe aus den Fraktions-Tokens der Karte');
{
  const m = /drawPortraetFaden\(ctx, pid, x, y, w\) \{[\s\S]*?\n {4}\},\n {4}drawFunkBild/.exec(HUD_SRC);
  const body = m[0].replace(/,\n {4}drawFunkBild$/, '');
  const fn = new Function('window', 'return { ' + body.trim().replace(/,$/, '') + ' }')({ KarteTokens: KT0 });
  const schulter = (fr) => { const rects = []; const ctx = { save() {}, restore() {}, translate() {}, fillRect(x, y, bw, bh) { rects.push({ x, y, w: bw, h: bh, c: this.fillStyle }); }, fillStyle: '' }; fn.drawPortraetFaden.call({}, ctx, 'f:0:' + fr, 0, 0, 24); return rects.find((q) => q.x === 3 && q.y === 20 && q.w === 18 && q.h === 4); };
  for (const [fr, k] of [['rom', 'r'], ['ger', 'g'], ['kon', 'k']]) ok(!!schulter(fr) && schulter(fr).c === KT0.FARBE.fraktion[k].flaeche, `Schulter ${fr}: ${KT0.FARBE.fraktion[k].flaeche} (KarteTokens.FARBE.fraktion.${k}.flaeche)`);
  ok(new Set(['rom', 'ger', 'kon'].map((fr) => schulter(fr).c)).size === 3, 'die drei Fraktionen bleiben an der Schulter unterscheidbar');
}

section('Funk der Fäden als Lagefunk (F3a): Kennung fd, Messing statt Rot, Konsolen-Zeile und Funk-Reiter');
{
  const KT = { FARBE: { funk: { akzentFeind: '#E0473C', akzentLage: '#C9974A' } } };
  const nameM = ['onRadio', 'funkAkzent', 'lagefunkZeilenText', 'funkZeileUnten'];
  const src = nameM.map(methode);
  ok(src.every(Boolean), 'onRadio, funkAkzent, lagefunkZeilenText und funkZeileUnten stehen in hud.js');
  const wnd = { KarteTokens: KT, Sitz: null, Funkwahl: FW };
  const H = new Function('window', 'KarteTokens', 'performance', 'Funkwahl', 'return { ' + src.join(',\n') + ' }')(wnd, KT, { now: () => 5000 }, FW);
  H.radioAktuell = function () { return this.radioFlash || null; };
  H.szeneVon = () => null;
  H.onRadio('Titus Varro', 'Hallo', 'f:1:rom', 1, null, false, 1);
  ok(H.radioFlash.fd === 1 && H.radioFlash.lage === true, 'onRadio übernimmt fd 1 (Funk eines Fadens) und lage');
  H.radioFlash = null; H.onRadio('Titus Varro', 'Notruf', 'f:1:rom', 1, null, false, 2);
  ok(H.radioFlash.fd === 2, 'onRadio übernimmt fd 2 (Gefahr)');
  H.radioFlash = null; H.onRadio('X', 'y', null, 1, null, false, 7);
  ok(H.radioFlash.fd === 0, 'unbekannte Kennung: fd 0 (Müll wird nie Messing)');
  H.radioFlash = null; H.onRadio('X', 'y', null, 1, null, false);
  ok(H.radioFlash.fd === 0, 'ohne Kennung: fd 0, Lagemeldungen bleiben rot');
  ok(H.funkAkzent({ fd: 1 }) === '#C9974A' && H.funkAkzent({ fd: 2 }) === '#E0473C' && H.funkAkzent({ fd: 0 }) === '#E0473C' && H.funkAkzent({}) === '#E0473C', 'Akzent: Funk der Fäden Messing, Gefahr und gewöhnlicher Lagefunk Rot');
  ok(H.lagefunkZeilenText({ from: 'Titus Varro', text: 'Hallo.', fd: 1 }) === 'FUNK · Titus Varro · Hallo.', 'Zeile des Fadenfunks: „FUNK · Name · Text“ (kein „LAGE“, der Absender immer)');
  ok(H.lagefunkZeilenText({ from: 'Aufklärung', text: 'Hallo.', fd: 0 }) === 'LAGE · Hallo.' && H.lagefunkZeilenText({ from: 'HAFEN X', text: 'Hallo.', fd: 0, kz: '0305 · Rom' }) === 'LAGE · HAFEN X · 0305 · Rom · Hallo.', 'die gewöhnliche Lagemeldung bleibt unverändert');
  // Wiring: client.js reicht fd durch, KarteLage merkt es, der Funk-Reiter färbt danach
  ok(/H\.onRadio\(ev\.from, ev\.text, ev\.pid, ev\.lage, ev\.kz, !!\(ev\.sz && !ev\.r\), ev\.fd, ev\.ton\)/.test(SRC('client.js')), 'client.js: das radio-Ereignis reicht fd und ton an Hud.onRadio durch');
  global.self = global.self || root;
  const KL = require('../public/js/karte-lage.js');
  KL.funkLeeren(); KL.funkMerken({ text: 'Bringt die Ware.', from: 'Titus Varro', fd: 1 }); KL.funkMerken({ text: 'Lage.', from: 'HAFEN X' });
  ok(KL.funkListe()[1].fd === 1 && KL.funkListe()[0].fd === 0, 'KarteLage.funkMerken nimmt die Zeilen der Fäden auf (Captain-Funkreiter) und merkt fd');
  ok(/e\.fd === 1 \|\| e\.ton === 'meldung' \? KarteTokens\.FARBE\.funk\.akzentLage : KarteTokens\.FARBE\.funk\.akzentFeind/.test(SRC('consoles.js')), 'Funk-Reiter: Akzent Messing bei fd 1 und ton meldung, sonst Rot');
  // Welle 5 (M1): ton 'meldung' (Oberkommando: Angebot, Sieg, Rom bietet an) Messing, ton 'gefahr' und ohne ton Rot
  H.radioFlash = null; H.onRadio('Oberkommando', 'Rom bietet Euch an', null, 1, null, false, undefined, 'meldung');
  ok(H.radioFlash.ton === 'meldung' && H.radioFlash.fd === 0 && H.funkAkzent(H.radioFlash) === '#C9974A', 'onRadio: ton meldung färbt den Akzent Messing (Oberkommando)');
  H.radioFlash = null; H.onRadio('Oberkommando', 'Sie greifen an!', null, 1, null, false, undefined, 'gefahr');
  ok(H.radioFlash.ton === 'gefahr' && H.funkAkzent(H.radioFlash) === '#E0473C', 'onRadio: ton gefahr bleibt Rot');
  H.radioFlash = null; H.onRadio('X', 'y', null, 1, null, false, undefined, 'quatsch');
  ok(H.radioFlash.ton === '' && H.funkAkzent(H.radioFlash) === '#E0473C', 'unbekannter ton: wie ohne ton, Rot (Müll wird nie Messing)');
  KL.funkLeeren(); KL.funkMerken({ text: 'Rom bietet.', from: 'Oberkommando', ton: 'meldung' }); KL.funkMerken({ text: 'Angriff.', from: 'Oberkommando', ton: 'gefahr' });
  ok(KL.funkListe()[1].ton === 'meldung' && KL.funkListe()[0].ton === '', 'KarteLage.funkMerken merkt ton meldung (Funk-Reiter färbt Messing), gefahr bleibt leer = Rot');
  // Ops: der Streifen im Ruf-Slot nimmt der Karte die Zoom-Beschriftung (wie die Lagefunk-Zeile)
  H.radioFlash = null;   // keine Lagemeldung: nur der Streifen zaehlt
  alles({ bitte: bitteBlock(2, 'f:1:rom') });
  const ops = { me: { console: 'weapons' } };
  FW.store.konsole = { S: 196, station: 'weapons' }; FW.store.eingeklappt = true; FW.store.geoeffnetBei = null;
  ok(H.funkZeileUnten(ops) === 11, 'Ops mit Streifen: Unterkante 11 (die Zoom-Zeile der Karte entfällt)');
  FW.store.eingeklappt = false;
  ok(H.funkZeileUnten(ops) === 0, 'Ops mit voller Leiste: 0 (die Leiste liegt unten, nicht im Ruf-Slot)');
  FW.store.eingeklappt = true;
  ok(H.funkZeileUnten({ me: { console: 'helm' } }) === 0, 'andere Konsolen: 0');
  alles({ bitte: null }); alles({ funkwahl: null });
  ok(H.funkZeileUnten(ops) === 0, 'ohne Angebot: 0');
  FW.store.konsole = null; FW.store.eingeklappt = false;
}

console.log(`\n${n - fails} von ${n} Prüfungen bestanden` + (fails ? `, ${fails} FEHLER` : ''));
if (fails) process.exit(1);
