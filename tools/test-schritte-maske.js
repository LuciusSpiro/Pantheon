'use strict';
// SPT-01 D + E: Auftragsbrett, Schritte mit Fragezeichen und „Ticks“. Ohne Browser, mit den ECHTEN Dateien pult-terminal-tokens.js, pult-auftrag-tokens.js, pult-terminal-brett.js, brett.js.
//  D: ein Angebot zeigt nur Schritt 1, die übrigen Schritte als „?“; kein Text, keine Bake, keine Wahl eines späteren Schritts steht irgendwo (gezeichneter Text, Klick- und Tooltipflächen);
//     die Gesamtzeile GEFAHR bleibt, nennt aber nur einen sichtbaren gefährlichen Schritt; Gelingt/Scheitert/Scheitern-Satz bleiben unverändert; der laufende Auftrag zeigt nur den aktuellen Schritt.
//     Mutationsprobe im Test: ohne Maskierung (A.schrittSicht gibt alles frei) schlägt die Leckprüfung an.
//  E: „noch n Ticks“, „gilt noch n Ticks“ (n = 0: „verfällt mit dem nächsten Tick“), Hinweis, was ein Tick ist (an die Arten gebunden, die der Fadenkern zählt, content/faeden/werte.json); Notruf-Angebot ohne Frist und ohne Hinweis;
//     das Wort „Tätigkeit(en)“ steht nirgends mehr im sichtbaren Text.
//   node tools/test-schritte-maske.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const J = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
const PA = require('../public/js/pult-auftrag-tokens.js');
const KT = require('../public/js/karte-tokens.js');
const B = require('../public/js/brett.js');
const WERTE = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'faeden', 'werte.json'), 'utf8'));
let fails = 0;
const ok = (c, t) => { if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const { FARBE, MASS, TEXT } = PA.TOKENS;
const klon = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- Aufbau wie test-brett-ui.js
const rec = { texte: [], rects: [] };
let fill = null;
const ctx = new Proxy({}, { get: (t, k) => (k === 'fillRect' ? (x, y, w, h) => rec.rects.push({ x, y, w, h, col: fill }) : () => {}), set: (t, k, v) => { if (k === 'fillStyle') fill = v; return true; } });
const wrapQuelle = J('render.js').match(/function wrap\(str, maxW, scale\) \{[\s\S]*?\r?\n  \}\r?\n/)[0];
const messen6 = (s) => String(s).length * 6;
const R2 = { measure: messen6, wrap: new Function('measure', wrapQuelle + '\nreturn wrap;')(messen6), text() {}, backdrop() {}, ui: { buttons: [], mouse: { x: -1, y: -1 }, tooltip: null } };
const P2 = {
  FN: PA.TOKENS.FN, SKINS: { rom: { screenBg: FARBE.grund, bg: '#0B0E1A', text: FARBE.text, dim: FARBE.dim, ink: FARBE.ink, off: '#18202F', offLine: FARBE.tagRand, frame: '#3A4A66' } }, mix: (a) => a,
  cham() {}, zelle() {}, titel() {}, rahmen(c, view, o) { o.anzeige(c); return {}; }, zeichneHilfe() {}, knopf() {},
};
const w2 = { Render: R2, Pult: P2, Shared_Protocol: {}, performance, KarteTokens: KT, PultAuftrag: PA };
w2.window = w2; vm.createContext(w2);
vm.runInContext(J('pult-terminal-tokens.js'), w2, { filename: 'pult-terminal-tokens.js' });
const PT = w2.PultTerminal;
PT.txt = (c, s, x, y, col, o) => {
  s = String(s == null ? '' : s); if (!s) return x; o = o || {};
  if (o.versal) s = s.toUpperCase();
  const w = PT.tw(s, o.scale || 1, o.sperr || 0), dx = o.align === 'center' ? x - Math.round(w / 2) : o.align === 'right' ? x - w : x;
  rec.texte.push({ s, x: dx, y, w, h: 7, col, o }); return dx + w;
};
vm.runInContext(J('pult-terminal-brett.js'), w2, { filename: 'pult-terminal-brett.js' });

const modell = (blk) => { B.lesen({ t: 'snap', world: { abenteuer: Object.assign({ ok: 1, kopf: 'Auftragsbrett', ablehnen: 'Ablehnen kostet nichts.', scheitern: 'Scheitern ist frei.', angebote: [] }, klon(blk)) } }); return B.modell(); };
const baustein = (m, gew) => ({ titel: m.kopf, hilfe: '', laufend: m.laufend, gewaehlt: gew || (m.angebote[0] && m.angebote[0].id), geruechte: m.geruechte, scheitern: m.scheitern, leerText: '', info: null,
  angebote: m.angebote.map((a, i) => Object.assign({}, a, { nr: i + 1, kappe: String(i + 1), onClick: () => {} })) });
function zeichne(b) { rec.texte.length = 0; rec.rects.length = 0; R2.ui.buttons.length = 0; PT.zeichneBrett(ctx, b); }
const alleTexte = () => rec.texte.map((t) => t.s).concat(R2.ui.buttons.map((b) => b.label || ''));   // gezeichneter Text UND Tooltip-/Klickflächen
const hat = (s) => rec.texte.some((t) => t.s === s);
const hatTeil = (re) => rec.texte.some((t) => re.test(t.s));
const D = PA.layout(false).detail, Z = MASS.detail;

// Schritttexte mit eindeutigen Wörtern: so findet die Leckprüfung jede Spur
const SCH = (t, g, wahl) => Object.assign({ text: t, gefahr: !!g }, wahl ? { wahl } : {});
const WAHL = [{ text: 'WAHLOPTIONGEHEIM', folgen: [{ f: 'rom', art: 'haltung', d: 1 }] }, { text: 'Ablehnen', folgen: [] }];
const FOLGEN = { gelingt: [{ f: 'kon', art: 'haltung', d: 1 }, 'Das Konkordat zahlt.'], scheitert: [{ f: 'kon', art: 'haltung', d: -1 }, 'Der Konvoi kommt durch.'] };
const ANG = (id, schritte, o) => Object.assign({ id, titel: 'Titel ' + id, ort: '0305', ortname: 'Kantenstein', rest: 9, von: 'kon', anlass: 'Ein Anlass ohne Schrittnamen.', vorschau: Object.assign({ gefahr: schritte.some((s) => s.gefahr), schritte }, klon(FOLGEN)) }, o || {});
const A4 = ANG('a1', [SCH('ERSTERSCHRITT prüfen'), SCH('ZWEITERSCHRITT springen'), SCH('DRITTERSCHRITT stellen', true), SCH('VIERTERSCHRITT melden')]);
const SPAETER = ['ZWEITERSCHRITT', 'DRITTERSCHRITT', 'VIERTERSCHRITT'];
// Leckprüfung: liefert alle Wörter späterer Schritte, die irgendwo stehen
const leckt = (woerter) => woerter.filter((w) => alleTexte().some((s) => s.indexOf(w) >= 0));

// ================================================================ D1: schrittSicht (rein)
section('D1: PultAuftrag.schrittSicht');
{
  const l = [SCH('a'), SCH('b', true, WAHL), SCH('c', true), SCH('d')];
  const s1 = PA.schrittSicht(l, 1), s3 = PA.schrittSicht(l, 3);
  ok(JSON.stringify(s1.map((s) => s.zustand)) === '["jetzt","verborgen","verborgen","verborgen"]', 'Angebot (aktuell 1): Schritt 1 aktuell, alle weiteren verborgen');
  ok(JSON.stringify(s3.map((s) => s.zustand)) === '["fertig","fertig","jetzt","verborgen"]', 'laufend (aktuell 3): zwei erledigt, einer aktuell, einer verborgen');
  ok(s3[0].text === 'a' && s3[1].text === 'b' && s3[1].gefahr === true && !!s3[1].wahl && s3[2].text === 'c', 'erledigte und aktueller Schritt behalten Text, Gefahr und Wahl');
  ok(s1.slice(1).every((s) => s.text === '' && s.gefahr === false && s.wahl === null), 'ein verborgener Schritt trägt keinen Text, keine Gefahr, keine Wahl');
  ok(PA.schrittSicht(l)[1].zustand === 'verborgen' && PA.schrittSicht(l, 99).every((s) => s.zustand !== 'verborgen') && PA.schrittSicht(l, 0)[0].zustand === 'jetzt' && PA.schrittSicht(null, 1).length === 0, 'ohne Angabe gilt Schritt 1; zu groß: alles sichtbar; 0 wie 1; keine Liste: leer');
  ok(l[1].text === 'b', 'die Eingabe bleibt unverändert');
}

// ================================================================ D2: Angebot-Detail
section('D2: Angebot zeigt Schritt 1 und „?“ für die übrigen');
{
  zeichne(baustein(modell({ angebote: [A4] })));
  ok(hat('ERSTERSCHRITT prüfen'), 'Schritt 1 steht im Klartext');
  ok(rec.texte.filter((t) => t.s === '?').length === 3, 'die Schritte 2 bis 4 stehen als „?“ (3 Stück)');
  ok(['1', '2', '3', '4'].every((k) => hat(k)), 'die Nummern 1 bis 4 stehen (die Zahl der Schritte bleibt sichtbar)');
  ok(leckt(SPAETER).length === 0, 'kein Wort eines späteren Schritts in Text, Klickflächen oder Tooltips (' + leckt(SPAETER).join(',') + ')');
  ok(rec.texte.filter((t) => t.s === '?').every((t) => t.col === FARBE.dim), '„?“ in dim (leise, kein Alarm)');
  ok(R2.ui.buttons.some((b) => b.label === TEXT.schrittVerborgenTip && !b.onClick), 'jede „?“-Zeile trägt den Tooltip „' + TEXT.schrittVerborgenTip + '“ (ohne Klick)');
  const S = D.schritte, ab = S.y + Z.kopfH;
  ok(!rec.rects.some((r) => r.col === FARBE.gefahrRot && r.x >= S.x + Z.schrittX - 1 && r.x < S.x + S.w && r.y >= ab), 'an keinem Schritt steht eine Gefahr-Bake (sie würde den gefährlichen Schritt 3 verraten)');
  ok(rec.texte.some((t) => /^GEFAHR$/i.test(t.s) && t.y === D.gefahr.y + 1), 'die Gesamtzeile GEFAHR steht oben weiter (Gefahr wird angekündigt)');
  const ge = rec.texte.filter((t) => t.y === D.gefahr.y + 1 && t.x > D.gefahr.x + MASS.bake.w + Z.gefahrX + 20);
  ok(ge.length === 0, 'die Gefahrzeile nennt keinen Schritttext (der gefährliche Schritt ist verborgen)');
  // Gelingt, Scheitert, Scheitern-Satz unverändert
  ok(hat('Das Konkordat zahlt.') && hat('Der Konvoi kommt durch.') && hat('Scheitern ist frei.') && hat('GELINGT') && hat('SCHEITERT'), 'Gelingt, Scheitert und der Scheitern-Satz stehen unverändert');
  ok(hatTeil(/▲/) && hatTeil(/▼/), 'Marken von Gelingt/Scheitert unverändert');
}
{
  // Schritt 1 gefährlich: sichtbar mit Bake, und die Gefahrzeile nennt ihn
  zeichne(baustein(modell({ angebote: [ANG('a2', [SCH('ERSTERGEFAHR stellen', true), SCH('ZWEITERSCHRITT')])] })));
  ok(rec.texte.filter((t) => t.s === 'ERSTERGEFAHR stellen').length === 2 && rec.rects.some((r) => r.col === FARBE.gefahrRot && r.w === MASS.bakeKlein.w), 'gefährlicher Schritt 1: Text in der Gefahrzeile und im Schritt, mit kleiner Bake');
  ok(leckt(['ZWEITERSCHRITT']).length === 0 && hat('?'), 'Schritt 2 bleibt „?“');
  // mehr als 4 Schritte: „+n weitere“ bleibt, Layout wie vorher
  const acht = ANG('a3', [1, 2, 3, 4, 5, 6, 7, 8].map((i) => SCH(i === 1 ? 'ERSTERSCHRITT' : 'SPAET' + i + 'SCHRITT')));
  zeichne(baustein(modell({ angebote: [acht] })));
  ok(hat('+5 weitere') && rec.texte.filter((t) => t.s === '?').length === 2 && hat('ERSTERSCHRITT') && leckt(['SPAET']).length === 0, '8 Schritte: Schritt 1, zwei „?“ und „+5 weitere“ (schritteMax 4), kein späterer Text');
  // Wahl: Schritt 1 mit Wahl behält Tooltip, spätere Wahl wird nicht gezeigt
  zeichne(baustein(modell({ angebote: [ANG('a4', [SCH('BITTEERSTER', false, WAHL), SCH('BITTEZWEITER', false, WAHL)])] })));
  ok(R2.ui.buttons.filter((b) => /WAHLOPTIONGEHEIM/.test(b.label || '')).length === 1 && rec.texte.filter((t) => t.s === ' · Wahl').length === 1, 'die Wahl des sichtbaren Schritts 1 hat Tooltip und „· Wahl“, die des verborgenen Schritts 2 nicht');
}

// ================================================================ D3: laufender Auftrag
section('D3: laufender Auftrag zeigt nur den aktuellen Schritt (Streifen)');
{
  const laufend = { id: 'a9', titel: 'Der Bernsteinkonvoi', schritt: 2, schritte_gesamt: 4, schritt_text: 'AKTUELLERSCHRITT', gefahr: false, ph: 'laeuft', rest: 5 };
  zeichne(baustein(modell({ angebote: [A4], laufend })));
  ok(hat('AKTUELLERSCHRITT') && hat('Schritt 2 von 4 ·'), 'Streifen: der aktuelle Schritt steht im Klartext');
  ok(leckt(SPAETER).length === 0 && hat('?'), 'daneben bleibt das Angebot maskiert (kein Text eines späteren Schritts), auch im kompakten Layout');
  ok(rec.rects.filter((r) => r.col === FARBE.laeuft && r.h === MASS.laeuft.beatH).length === 2, 'Beats: 1 erledigt + aktuell voll, 2 offene hohl (ohne Text)');
}

// ================================================================ D4: Mutationsprobe
section('D4: Mutationsprobe: ohne Maskierung schlägt die Leckprüfung an');
{
  const echt = PA.schrittSicht;
  PA.schrittSicht = (l) => l.map((s) => Object.assign(PA.schritt(s), { zustand: 'jetzt' }));   // Maskierung entfernt
  zeichne(baustein(modell({ angebote: [A4] })));
  const lecks = leckt(SPAETER);
  PA.schrittSicht = echt;
  ok(lecks.length === 3, 'Mutation (alle Schritte sichtbar): die Leckprüfung findet ' + lecks.join(', '));
  zeichne(baustein(modell({ angebote: [A4] })));
  ok(leckt(SPAETER).length === 0, 'mit der Maskierung wieder dicht');
}

// ================================================================ E1: Ticks
section('E1: „noch n Ticks“ / „gilt noch n Ticks“ und der Hinweis');
{
  const v = PA.verfall;
  ok(v(9).kurz === 'noch 9 Ticks' && v(9).lang === 'gilt noch 9 Ticks' && v(12).lang === 'gilt noch 12 Ticks' && v(2).lang === 'gilt noch 2 Ticks' && v(0).kurz === '! läuft ab' && v(0).lang === 'verfällt mit dem nächsten Tick' && v(1).kurz === '! noch 1 Tick' && v(1).lang === 'gilt noch einen Tick' && v(2).kurz === '! noch 2 Ticks', 'Kurzform, Langform, Einzahl (1 Tick), bald mit „!“');
  ok(PA.beginnt(3) === 'beginnt in 3 Ticks' && PA.beginnt(1) === 'beginnt in 1 Tick' && PA.text('frist', { n: 5 }) === 'Frist noch 5 Ticks' && /Tick/.test(TEXT.leerText), 'beginnt, Frist und leerer Zustand sagen Ticks');
  // Der Hinweis nennt jede Art, die der Fadenkern zählt (content/faeden/werte.json taetigkeiten), und nur diese
  const arten = WERTE.werte.taetigkeiten.wert, wort = { szene_ende: /Szene endet/, andocken: /dockt an/, absicht: /Strat\. Option gewählt\/abgelehnt|Strategische Option gewählt oder abgelehnt/, notruf: /Notruf/ };
  ok(arten.every((a) => wort[a] && wort[a].test(TEXT.tickHinweis) && wort[a].test(TEXT.tickHinweisLang)) && Object.keys(wort).length === arten.length, 'der Hinweis nennt jede gezählte Art (' + arten.join(', ') + ') und keine andere');
  ok(!/Sprung|Sprünge/.test(TEXT.tickHinweis + TEXT.tickHinweisLang + TEXT.tickHinweisKurz), 'der Hinweis behauptet keinen Sprung (ein Sprung zählt nicht als Tick des Angebots)');
  zeichne(baustein(modell({ angebote: [A4] })));
  const T0 = D.tick, zeilen = rec.texte.filter((t) => t.x === T0.x && t.y >= T0.y && t.y < T0.y + T0.h);
  ok(zeilen.length >= 2 && zeilen.map((t) => t.s).join(' ') === TEXT.tickHinweis, 'Detail: der volle Hinweis steht in der linken Spalte unter den Schritten (' + zeilen.length + ' Zeilen)');
  ok(zeilen.every((t) => t.col === FARBE.dim && t.x + t.w <= T0.x + T0.w && t.y + t.h <= D.unten), 'Hinweis in dim, innerhalb der Spalte und über der Unterkante des Details');
  ok(R2.ui.buttons.some((b) => b.label === TEXT.tickHinweisLang && /Strategische Option gewählt oder abgelehnt/.test(b.label) && /dockt an/.test(b.label)), 'Tooltip mit dem ausgeschriebenen Satz');
  ok(hat('gilt noch 9 Ticks') && hat('noch 9 Ticks'), 'Karte „noch 9 Ticks“, Detail „gilt noch 9 Ticks“');
  // kompakt (ein Abenteuer läuft): nur eine Zeile Platz: Kurzform
  const laufend = { id: 'a9', titel: 'L', schritt: 2, schritte_gesamt: 4, schritt_text: 'x', ph: 'laeuft', rest: 5 };
  zeichne(baustein(modell({ angebote: [A4], laufend })));
  const Dk = PA.layout(true).detail.tick, zk = rec.texte.filter((t) => t.x === Dk.x && t.y >= Dk.y && t.y < Dk.y + Dk.h);
  ok(zk.length === 1 && zk[0].s === TEXT.tickHinweisKurz, 'kompaktes Detail: ' + zk.length + ' Zeile, Kurzform „' + TEXT.tickHinweisKurz + '“');
}
section('E2: Notruf-Angebot ohne Frist und ohne Hinweis; „Tätigkeit“ nirgends sichtbar');
{
  const NOTRUF = { id: 'a5', titel: 'Notruf: Kutter', ort: '0603', ortname: 'Speculum', von: 'rom', notruf: 1, hafen: 'Kantenstein', anlass: 'Ein Schiff ruft um Hilfe.', typen: ['notruf'] };
  const m = modell({ angebote: [NOTRUF] });
  ok(m.angebote[0].rest === null, 'ohne rest bleibt rest null');
  zeichne(baustein(m));
  ok(!hatTeil(/Tick|noch \d|verfällt|Frist/) && !alleTexte().some((s) => /Ticks? zählt/.test(s)), 'kein „noch n“, kein „verfällt“, kein Tick-Hinweis (auch nicht als Tooltip)');
  // alle Zustände: das Wort Tätigkeit steht nirgends
  const lf = (ph, rest) => ({ id: 'a9', titel: 'L', schritt: 2, schritte_gesamt: 3, schritt_text: 'x', ph, rest });
  const faelle = [baustein(modell({ angebote: [A4, NOTRUF] })), baustein(modell({ angebote: [A4], laufend: lf('laeuft', 5) })), baustein(modell({ angebote: [A4], laufend: lf('wartet', 3) })), baustein(modell({ angebote: [], laufend: lf('laeuft', 2) }))];
  let treffer = [];
  faelle.forEach((b) => { zeichne(b); treffer = treffer.concat(alleTexte().filter((s) => /Tätigkeit/i.test(s))); });
  [{ ph: 'wartet', rest: 3 }, { ph: 'laeuft', rest: 5 }, { ph: 'wartet', rest: 1, neu: true }].forEach((o) => { rec.texte.length = 0; PT.zeichneAbenteuerHud(ctx, 40, Object.assign({ titel: 'L', schritt: 2, schritte_gesamt: 3, schritt_text: 'x', gefahr: false }, o)); treffer = treffer.concat(rec.texte.map((t) => t.s).filter((s) => /Tätigkeit/i.test(s))); });
  ok(treffer.length === 0, 'Brett (Angebot, laufend, wartend, leer) und HUD zeigen nie „Tätigkeit“ (' + treffer.join(' | ') + ')');
  ok(Object.values(TEXT).every((s) => !/Tätigkeit/i.test(s)), 'die Texttabelle von PultAuftrag enthält das Wort nicht mehr');
}

console.log(fails ? '\n' + fails + ' FEHLER' : '\nSCHRITTE-MASKE OK');
process.exit(fails ? 1 : 0);
