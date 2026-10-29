'use strict';
// SUND-04b D: Auftragsbrett in der Anzeige. Ohne Browser:
//  1. public/js/brett.js (Storage, Löschsignal, Müll, Grenzen, Text bleibt Text, Befehle im Protokollformat, Antwortcodes)
//  2. Layout mit den ECHTEN Dateien pult-terminal-tokens.js, pult-auftrag-tokens.js, pult-terminal-brett.js: Knopf Brett ohne Überlappung, Titellinie endet davor, Zustände (leer, 1 bis 3 Angebote, laufend,
//     Gerüchte, Absagen, lange Texte) ohne Textüberlappung und ohne Überlauf, Gefahr nie nur über Farbe, Modelltext wird nur als Text gezeichnet, Texte kommen aus den Daten
//  3. public/js/terminal-ui.js gegen einen ECHTEN Server (Game mit FAEDEN=1, drei Spieler): Tasten und Klicks -> Befehle im Protokollformat, Antworten, Zuschauer, zweite Antwort, ohne Block nichts
//  4. Tastenbelegung (tasten.js): O frei, keine Kollision im Bereich, Hilfe und Namen
// Die Erwartungen stehen hier selbst (von Hand gerechnet oder aus den Daten des Servers), nie aus dem Produktivcode des Clients abgeleitet.
// Aufruf: node tools/test-brett-ui.js   (npm run test:brett-ui)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const J = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
const CONFIG = require('../shared/config.js');
const Katalog = require('../shared/schiffskatalog.js');
const Maps = require('../shared/maps.js');
const Protocol = require('../shared/protocol.js');
const Locations = require('../shared/locations.js');
const PA = require('../public/js/pult-auftrag-tokens.js');
const KT = require('../public/js/karte-tokens.js');
const BrettClient = require('../public/js/brett.js');
const X = require('./faden-fixture.js');
const LLM = require('../server/mission/llm.js');
const LS = require('../server/sim/lage-spielleiter.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t) => console.log('\n[' + t + ']');
const DATEN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'faeden', 'abenteuer-brett.json'), 'utf8'));
const { FARBE, MASS, TEXT } = PA.TOKENS;

// ================================================================ 1. brett.js
section('brett.js: Storage, Löschsignal, Müll, Grenzen');
{
  const B = BrettClient;
  B.lesen({ t: 'welcome' });
  ok(B.modell() === null, 'ohne Block: kein Modell, keine Ausnahme');
  const block = { ok: 1, kopf: 'Auftragsbrett', ablehnen: 'Ablehnen kostet nichts.', scheitern: 'x', angebote: [{ id: 'a1', titel: 'Der Bernsteinkonvoi', ort: '0305', ortname: 'Kantenstein', rest: 9, von: 'kon', aus_geruecht: true, vorschau: { gefahr: true, schritte: [{ text: 'Nach Kantenstein', gefahr: false }, { text: 'Konvoi stellen', gefahr: true }], gelingt: ['Das Konkordat zahlt.', { f: 'kon', art: 'haltung', d: 1 }], scheitert: [{ f: 'kon', art: 'haltung', d: -1 }] } }], geruechte: [{ von: 'kon', text: 'Frachter laufen Kantenstein an.', angebot: 'a1' }] };
  B.lesen({ t: 'snap', world: { abenteuer: block } });
  let m = B.modell();
  ok(m && m.ok === true && m.kopf === 'Auftragsbrett' && m.angebote.length === 1 && m.angebote[0].titel === 'Der Bernsteinkonvoi' && m.angebote[0].rest === 9 && m.angebote[0].aus_geruecht === true && m.laufend === null, 'Block -> Modell');
  ok(m.angebote[0].vorschau.gefahr === true && m.angebote[0].vorschau.gefahrText === 'Konvoi stellen' && m.angebote[0].vorschau.schritte.length === 2 && m.angebote[0].vorschau.gelingt.length === 2, 'Vorschau: Gefahr, genannt wird der erste gefährliche Schritt, Folgen');
  ok(m.geruechte.length === 1 && m.geruechte[0].angebot === 'a1', 'Gerücht mit Verweis auf das Angebot');
  B.lesen({ t: 'snap', world: {} });
  ok(B.modell() !== null, 'ein Snapshot ohne world.abenteuer lässt den Block stehen');
  B.lesen({ t: 'snap', world: { abenteuer: null } });
  ok(B.modell() === null, 'world.abenteuer = null (Löschsignal) leert');
  B.lesen({ t: 'snap', world: { abenteuer: block } }); B.lesen({ t: 'welcome' });
  ok(B.modell() === null, 'welcome leert');
  B.lesen({ t: 'snap', world: { abenteuer: block } }); B.lesen({ t: 'snap', phase: 'lobby' });
  ok(B.modell() === null, 'die Lobby leert');
  for (const bad of ['x', 5, [], {}, { angebote: 'x' }, { angebote: [null, 5, {}, { id: 'x1', titel: 'T' }, { id: 'a1' }, { id: 'a1', titel: 7 }] }, { laufend: { id: 'a1' } }, { laufend: { titel: 'T', schritt: 'x', schritte_gesamt: -4, rest: 'x' } }, { angebote: [{ id: 'a1', titel: 'T', vorschau: { schritte: [1, null, { text: 5 }], gelingt: [null, 5, { f: 3 }, { f: 'rom' }], scheitert: 'x' } }] }]) {
    B.lesen({ t: 'snap', world: { abenteuer: bad } });
    let m2, fehler = null; try { m2 = B.modell(); } catch (e) { fehler = e; }
    ok(!fehler && (m2 === null || (Array.isArray(m2.angebote) && m2.angebote.length <= 3 && (!m2.laufend || m2.laufend.schritt >= 1 && m2.laufend.schritt <= m2.laufend.schritte_gesamt))), 'Müll als Block ohne Ausnahme: ' + JSON.stringify(bad).slice(0, 70));
  }
  B.lesen({ t: 'snap', world: { abenteuer: { ok: 1, kopf: 'Auftragsbrett', angebote: [], geruechte: [{ von: 'rom', text: 'nur ein Gerücht' }] } } });
  ok(B.modell() === null, 'weder Angebot noch laufendes Abenteuer (auch mit Gerüchten): kein Modell, kein Bereich');
  const viele = { angebote: [1, 2, 3, 4, 5].map((i) => ({ id: 'a' + i, titel: 'T' + i })), geruechte: [1, 2, 3, 4, 5].map((i) => ({ von: 'rom', text: 'g' + i })) };
  B.lesen({ t: 'snap', world: { abenteuer: viele } });
  ok(B.modell().angebote.length === 3 && B.modell().geruechte.length === 3, 'höchstens 3 Angebote und 3 Gerüchte');
  const lang = 'ä'.repeat(500);
  B.lesen({ t: 'snap', world: { abenteuer: { angebote: [{ id: 'a1', titel: lang, anlass: lang, ortname: lang, vorschau: { schritte: [{ text: lang }], gelingt: [lang] } }], geruechte: [{ von: 'rom', text: lang }] } } });
  m = B.modell();
  ok(m.angebote[0].titel.length <= B.GRENZE.titel && m.angebote[0].anlass.length <= B.GRENZE.anlass && m.angebote[0].ortname.length <= B.GRENZE.ort && m.angebote[0].vorschau.schritte[0].text.length <= 60 && m.angebote[0].vorschau.gelingt[0].length <= B.GRENZE.text && m.geruechte[0].text.length <= B.GRENZE.text, 'lange Texte werden begrenzt');
  const html = '<img src=x onerror=alert(1)>&amp;<b>Titel</b>';
  B.lesen({ t: 'snap', world: { abenteuer: { angebote: [{ id: 'a1', titel: html, anlass: html }] } } });
  ok(B.modell().angebote[0].titel === html.slice(0, B.GRENZE.titel - 1) + '…' && typeof B.modell().angebote[0].anlass === 'string', 'HTML im Titel bleibt Text (nicht ausgewertet); zu lang heißt mit „…“ gekürzt, nie still abgeschnitten');
  B.lesen({ t: 'snap', world: { abenteuer: { angebote: [{ id: 'a1', titel: 'A\u0000B\nC' }] } } });
  ok(B.modell().angebote[0].titel === 'A B C', 'Steuerzeichen werden zu Leerzeichen');
  B.lesen({ t: 'snap', world: { abenteuer: { angebote: [{ id: 'a12', titel: 'X' }], laufend: { id: 'a3', titel: 'L', schritt: 9, schritte_gesamt: 4, ph: 'laeuft', rest: 3.9 } } } });
  m = B.modell();
  ok(m.laufend.schritt === 4 && m.laufend.rest === 3 && m.laufend.ph === 'laeuft', 'laufend: Schritt auf die Gesamtzahl begrenzt, rest ganzzahlig');
  ok(B.frisch({ ph: 'wartet', schritt: 1 }) === true && B.frisch({ ph: 'laeuft', schritt: 1 }) === false && B.frisch({ ph: 'wartet', schritt: 2 }) === false && B.frisch(null) === false, 'frisch = wartet auf den ersten Schritt');

  section('brett.js: Befehle im Protokollformat, Antwortcodes');
  const gesendet = [];
  ok(B.annehmen((q) => gesendet.push(q), 'a12') === true && JSON.stringify(gesendet[0]) === '{"t":"cmd","c":"abenteuer.annehmen","id":"a12"}', 'annehmen sendet { t: cmd, c: abenteuer.annehmen, id }');
  ok(B.ablehnen((q) => gesendet.push(q), 'a7') === true && JSON.stringify(gesendet[1]) === '{"t":"cmd","c":"abenteuer.ablehnen","id":"a7"}', 'ablehnen sendet { t: cmd, c: abenteuer.ablehnen, id }');
  const vorher = gesendet.length;
  for (const id of ['', 'a', 'a1234567', 'x1', '__proto__', 'constructor', 5, null, undefined, 'a1 ']) B.annehmen((q) => gesendet.push(q), id);
  ok(gesendet.length === vorher, 'ungültige Ids (Form, Prototype-Keys, Typ) senden nichts');
  const CODES = ['modus', 'unbekannt', 'kein_angebot', 'schon_beantwortet', 'am_boden', 'kein_spielleiter', 'laeuft_schon', 'kein_platz', 'veraltet', 'fehler'];
  ok(CODES.every((c) => typeof DATEN.weigerungen[c] === 'string') && CODES.every((c) => B.CODE_KURZ[c] && B.antwortText(c, 'Servertext').length > 10), 'jeder Code der README (10) hat einen Kurztext, und der Server kennt dieselben 10');
  ok(new Set(CODES.map((c) => B.antwortText(c))).size === 10, 'die 10 Kurztexte sind verschieden');
  ok(B.antwortText('neu_unbekannter_code', 'Klartext des Servers') === 'Klartext des Servers' && B.antwortText('neu_unbekannter_code').length > 5 && B.antwortText(undefined, 5).length > 5, 'unbekannter Code: Klartext des Servers, sonst allgemeiner Satz');
  ok(/erste Antwort/.test(B.antwortText('schon_beantwortet')), 'schon_beantwortet sagt, dass die erste Antwort der Crew gilt');
  ok(CODES.filter((c) => /bleibt/.test(DATEN.weigerungen[c])).every((c) => /bleibt/.test(B.antwortText(c))), 'Codes, bei denen das Angebot bleibt, sagen es auch im Kurztext');
}

// ================================================================ 2. Layout und Zeichnen mit den echten Dateien
section('Layout: Knopf Brett, Titellinie, keine Überlappung (echte pult-terminal-tokens.js)');
const rec = { texte: [], rects: [], knoepfe: [], cham: [], klicks: [] };
let fill = null;
const ctx = new Proxy({}, { get: (t, k) => (k === 'fillRect' ? (x, y, w, h) => rec.rects.push({ x, y, w, h, col: fill }) : () => {}), set: (t, k, v) => { if (k === 'fillStyle') fill = v; return true; } });
// Die Zeilenumbrüche kommen aus der ECHTEN R.wrap (render.js, per Quelltext geladen), nicht aus einem Nachbau: sie bricht nur an Leerzeichen, ein langes Wort bleibt eine überbreite Zeile (R1)
const wrapQuelle = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'render.js'), 'utf8').match(/function wrap\(str, maxW, scale\) \{[\s\S]*?\r?\n  \}\r?\n/)[0];
const messen6 = (s) => String(s).length * 6;
const R2 = {
  measure: messen6,
  wrap: new Function('measure', wrapQuelle + '\nreturn wrap;')(messen6),
  text() {}, backdrop(c, x, y, w, h) { rec.cham.push({ x, y, w, h, col: 'backdrop' }); }, ui: { buttons: [], mouse: { x: -1, y: -1 } },
};
const P2 = {
  FN: PA.TOKENS.FN, SKINS: { rom: { screenBg: FARBE.grund, bg: '#0B0E1A', text: FARBE.text, dim: FARBE.dim, ink: FARBE.ink, off: '#18202F', offLine: FARBE.tagRand, frame: '#3A4A66' } }, mix: (a) => a, rgba: (a) => a,
  cham(c, x, y, w, h, col) { rec.cham.push({ x, y, w, h, col }); }, zelle() {}, titel() {}, rahmen(c, view, o) { o.anzeige(c); return {}; }, zeichneHilfe() {},
  knopf(c, x, y, w, h, label, o) { const b = { x, y, w, h, label, fn: o && o.fn, kontur: !!(o && o.kontur), disabled: !!(o && o.disabled), onClick: o && o.onClick, hotkey: o && o.hotkey }; rec.knoepfe.push(b); R2.ui.buttons.push(b); return b; },
};
const w2 = { Render: R2, Pult: P2, Shared_Protocol: {}, performance, KarteTokens: KT, PultAuftrag: PA };
w2.window = w2; vm.createContext(w2);
vm.runInContext(J('pult-terminal-tokens.js'), w2, { filename: 'pult-terminal-tokens.js' });
const PT = w2.PultTerminal;
// Text mitschreiben (Zeichenfolge, Farbe, Optionen); die Breite kommt aus der echten tw
PT.txt = (c, s, x, y, col, o) => {
  s = String(s == null ? '' : s); if (!s) return x; o = o || {};
  if (o.versal) s = s.toUpperCase();
  const w = PT.tw(s, o.scale || 1, o.sperr || 0), dx = o.align === 'center' ? x - Math.round(w / 2) : o.align === 'right' ? x - w : x;
  rec.texte.push({ s, x: dx, y, w, h: 7, col, o }); return dx + w;
};
vm.runInContext(J('pult-terminal-brett.js'), w2, { filename: 'pult-terminal-brett.js' });
const L = PT.layout(640, 360);
const schneiden = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const drin = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
{
  const A = L.aktionen;
  ok(typeof PT.zeichneBrett === 'function' && typeof PT.zeichneAbenteuerHud === 'function', 'zeichneBrett und zeichneAbenteuerHud am PultTerminal');
  ok(A.brett && A.brett.x === MASS.knopf.brett.x && A.brett.w === MASS.knopf.brett.w && A.brett.x === 374 && A.brett.w === 48, 'Knopf Brett: x 374, 48 breit (= Vorgabe des Designers)');
  ok(L.modulTitel.w === MASS.knopf.modulTitelW && L.modulTitel.w === 104, 'Titellinie MODULRAUM: 104 breit (Designer)');
  ok(L.modulTitel.x + L.modulTitel.w < A.brett.x, 'die Linie MODULRAUM endet vor dem Knopf Brett (' + (L.modulTitel.x + L.modulTitel.w) + ' < ' + A.brett.x + ')');
  const reihe = ['brett', 'info', 'lage', 'handel', 'werft'].map((k) => A[k]);
  ok(reihe.every((r, i) => reihe.every((q, j) => i === j || !schneiden(r, q))), 'die fünf Bereichsknöpfe überlappen sich nicht');
  ok(reihe.every((r) => r.y === reihe[0].y && r.h === reihe[0].h), 'alle Bereichsknöpfe liegen auf einer Zeile gleicher Höhe');
  ok(reihe.slice(0, -1).every((r, i) => r.x + r.w <= reihe[i + 1].x), 'Reihenfolge von links: Brett, Info, Kurs, Handel, Werft');
  ok(reihe.every((r) => r.x + r.w <= L.pult.x + L.pult.w), 'alle Knöpfe liegen im Pult (rechter Rand ' + (L.pult.x + L.pult.w) + ')');
  const zellen = [].concat(Object.values(L.kreuz), Object.values(L.module));
  ok(!zellen.some((z) => schneiden(z, A.brett)) && !schneiden(L.energie, A.brett), 'der Knopf Brett überdeckt weder Waffenkreuz noch Modulräume noch Energiezeile');
  ok(!schneiden(A.brett, A.haupt) && !schneiden(A.brett, A.hinweis) && !schneiden(A.brett, A.ausbau) && !schneiden(A.brett, A.teil), 'der Knopf Brett überdeckt Haupt-, Hinweis-, Ablehnen- und Teil-Knopf nicht');
  ok(drin(L.handel, { x: 62, y: 6, w: 572, h: 340 }) && L.handel.x === PA.TOKENS.MASS.bereich.x && L.handel.y === MASS.bereich.y && L.handel.w === MASS.bereich.w && L.handel.h === MASS.bereich.h, 'der Bereich des Terminals ist der des Designers (70,42 558×152)');
  ok(L.handelInfo.x === MASS.info.x && L.handelInfo.y === MASS.info.y && L.handelInfo.w === MASS.info.w && L.handelInfo.h === MASS.info.h, 'die Infozeile ist die des Designers (70,198 558×30)');
}

// Beispieldaten (von Hand, im Ton der Freien Fahrt; Form wie world.abenteuer, durch das echte brett.js)
const klon = (o) => JSON.parse(JSON.stringify(o));
const SCH = (t, g) => ({ text: t, gefahr: !!g });
const KONVOI = { id: 'a1', titel: 'Der Bernsteinkonvoi', ort: '0305', ortname: 'Kantenstein', rest: 9, von: 'kon', aus_geruecht: true, anlass: 'Ein Händler des Konkordats will wissen, warum germanische Frachter neuerdings Kantenstein anlaufen. Er zahlt für Gewissheit.',
  vorschau: { gefahr: true, schritte: [SCH('Gerücht in Concordia prüfen'), SCH('Nach Kantenstein springen'), SCH('Konvoi stellen und aufhalten', true), SCH('Ladung in Concordia löschen')], gelingt: [{ f: 'kon', art: 'haltung', d: 1 }, { f: 'ger', art: 'haltung', d: -1 }, 'Das Konkordat zahlt, Kantenstein verliert Nachschub.'], scheitert: [{ f: 'kon', art: 'haltung', d: -1 }, 'Der Konvoi kommt durch.'] } };
const HEIMWEG = { id: 'a2', titel: 'Sigrids Heimweg', ort: '0508', ortname: 'Gullfjord', rest: 2, von: 'ger', aus_geruecht: false, anlass: 'Sigrid Wolfsang bittet um Geleit nach Hause. Rom sieht so etwas nicht gern.',
  vorschau: { gefahr: true, schritte: [SCH('In Ostia Nova an Bord nehmen'), SCH('Durch die Front bei Gullfjord', true), SCH('In Gullfjord absetzen')], gelingt: [{ f: 'ger', art: 'haltung', d: 2 }, { f: 'rom', art: 'ruf', d: -1 }, 'Sigrid erinnert sich an Euch.'], scheitert: [{ f: 'ger', art: 'haltung', d: -1 }, 'Sigrid wird gefangen.'] } };
const BOJE = { id: 'a3', titel: 'Die stumme Boje', ort: '0102', ortname: 'Bojenfeld', rest: 11, von: 'rom', anlass: 'Eine Boje sendet seit drei Tagen nichts mehr.',
  vorschau: { gefahr: false, schritte: [SCH('Im Bojenfeld scannen'), SCH('Der Spur folgen'), SCH('Fundort melden')], gelingt: [{ f: 'rom', art: 'ruf', d: 1 }, 'Ein neuer Weg auf der Karte.'], scheitert: ['Die Spur verläuft.'] } };
const LAUFEND = { id: 'a9', titel: 'Der Bernsteinkonvoi', schritt: 3, schritte_gesamt: 4, schritt_text: 'Konvoi stellen und aufhalten', gefahr: true, ph: 'laeuft', rest: 5 };
const GER = [{ von: 'kon', text: 'Germanische Frachter meiden die Bojen.', angebot: 'a1' }, { von: 'kon', text: 'Eine Germanin fragt nach der Lerche.', angebot: 'a2' }];
const modellAus = (blk) => { BrettClient.lesen({ t: 'snap', world: { abenteuer: Object.assign({ ok: 1, kopf: 'Auftragsbrett', ablehnen: 'Ablehnen kostet nichts.', scheitern: 'Scheitern blockiert nichts.', angebote: [] }, klon(blk)) } }); return BrettClient.modell(); };
// Modell wie terminal-ui.js es dem Baustein gibt
const baustein = (m, gew, info) => ({ titel: m.kopf, hilfe: m.angebote.length ? '↑↓ wählen · Ent annehmen · X ablehnen' : '', laufend: m.laufend, gewaehlt: gew || (m.angebote[0] && m.angebote[0].id), geruechte: m.geruechte, scheitern: m.scheitern, leerText: '', info: info || null,
  angebote: m.angebote.map((a, i) => Object.assign({}, a, { nr: i + 1, kappe: String(i + 1), onClick: () => {} })) });
function zeichne(b) { rec.texte.length = 0; rec.rects.length = 0; rec.knoepfe.length = 0; rec.cham.length = 0; R2.ui.buttons.length = 0; try { PT.zeichneBrett(ctx, b); } catch (e) { ok(false, 'Zeichnen des Bretts wirft: ' + e.message); } return rec.texte.map((t) => t.s); }
const hat = (s) => rec.texte.some((t) => t.s === s);
const hatTeil = (re) => rec.texte.some((t) => re.test(t.s));
// Geometrie: alle Texte im Bereich, keine zwei Texte überlappen, Detail endet über der Infozeile
function geometrie(name) {
  const B = L.handel, I = L.handelInfo, T = rec.texte.filter((t) => t.s.trim());
  const raus = T.filter((t) => t.x < B.x || t.x + t.w > B.x + B.w || t.y < MASS.titelY || t.y + t.h > I.y + I.h);
  ok(raus.length === 0, name + ': alle Texte im Bereich 70..628 × 29..228' + (raus.length ? ' (draußen: ' + raus.slice(0, 3).map((t) => '„' + t.s + '“@' + t.x + ',' + t.y + '+' + t.w).join('; ') + ')' : ''));
  const paare = []; for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) if (schneiden(T[i], T[j])) paare.push(T[i].s + ' × ' + T[j].s);
  ok(paare.length === 0, name + ': keine zwei Texte überlappen' + (paare.length ? ' (' + paare.slice(0, 3).join('; ') + ')' : ''));
  const oben = T.filter((t) => t.y < I.y - 3), unten = T.filter((t) => t.y >= I.y - 3);
  ok(oben.every((t) => t.y + t.h <= I.y - 3) && unten.every((t) => t.y >= I.y), name + ': Detail endet über der Trennlinie (' + Math.max(0, ...oben.map((t) => t.y + t.h)) + ' ≤ ' + (I.y - 3) + '), Infozeile darunter');
  const spalte = T.filter((t) => t.y >= L.handel.y && t.y < I.y - 3 && t.x >= L.handel.x + MASS.liste.w + MASS.spalte - 1);
  ok(spalte.every((t) => t.x + t.w <= B.x + B.w), name + ': die Detailspalte läuft nicht über den rechten Rand');
}

section('Zeichnen: drei Angebote, Gefahr nie nur über Farbe, Zahlen und Texte');
{
  const m = modellAus({ angebote: [KONVOI, HEIMWEG, BOJE], geruechte: GER });
  const texte = zeichne(baustein(m));
  geometrie('drei');
  ok(hat('Der Bernsteinkonvoi') && hat('Sigrids Heimweg') && hat('Die stumme Boje'), 'alle drei Titel');
  ok(hat('noch 9') && hat('! noch 2') && hat('noch 11'), 'Verfall je Karte: „noch 9“, „! noch 2“ (bald, mit Ausrufezeichen), „noch 11“');
  ok(hat('Kantenstein') && hat('Gullfjord') && hat('Bojenfeld'), 'Ortsnamen in den Karten (der Server schickt keine Typen)');
  ok(rec.texte.filter((t) => /^gefahr$/i.test(t.s)).length === 3, 'das Wort GEFAHR steht in den zwei Karten mit Gefahr und im Detail (3 mal), nicht in der Karte ohne Gefahr');
  const gefahrWorte = rec.texte.filter((t) => /^gefahr$/i.test(t.s));
  const karteGefahr = gefahrWorte.filter((t) => t.x < L.handel.x + MASS.liste.w);
  ok(karteGefahr.length === 2, 'Karten mit Gefahr tragen das Wort (2 von 3: Konvoi, Heimweg; die Boje nicht), ' + karteGefahr.length);
  ok(gefahrWorte.every((t) => t.col === FARBE.gefahrText || t.col === FARBE.ink), 'Gefahr als Text nur in gefahrText (oder ink auf Messing), nie in Rot der Bake');
  const rote = rec.rects.filter((r) => r.col === FARBE.gefahrRot);
  ok(rote.length >= 3 && rec.rects.some((r) => r.col === FARBE.gefahrHell), 'Bake gezeichnet (rote und helle Streifen)');
  ok(hat('Konvoi stellen und aufhalten'), 'Detail (gewählt: Konvoi) nennt den gefährlichen Schritt hinter GEFAHR');
  ok(hat('Gerücht in Concordia prüfen') && hat('Nach Kantenstein springen') && hat('Ladung in Concordia löschen') && hat('1') && hat('4'), 'Schritte 1 bis 4 aus dem Snapshot');
  ok(hat('verfällt nach 9 Tätigkeiten'), 'Detail: „verfällt nach 9 Tätigkeiten“');
  ok(hat('Das Konkordat zahlt, Kantenstein verliert Nachschub.') || hatTeil(/^Das Konkordat zahlt/), 'Satz bei „Gelingt“ aus dem Snapshot');
  ok(hat('GELINGT'), 'Überschrift Gelingt');
  ok(rec.texte.some((t) => /^SCHEITERT$/i.test(t.s)) && !rec.texte.some((t) => /^(MISSLINGT|VERLOREN|STRAFE)/i.test(t.s)), 'Überschrift Scheitert (kein Strafwort)');
  ok(hatTeil(/▲/) && hatTeil(/▼/), 'Marken tragen die Richtung als Pfeil ▲ ▼ (nicht nur als Farbe)');
  ok(rec.texte.some((t) => /^GERÜCHT$/i.test(t.s)) && hat('Germanische Frachter meiden die Bojen.') && hat('Eine Germanin fragt nach der Lerche.'), 'Gerüchte in der Infozeile');
  ok(rec.texte.filter((t) => t.s === '→').length === 2 && ['1', '2'].every((k) => rec.texte.some((t) => t.s === k && t.y >= L.handelInfo.y)), 'Gerüchte verweisen mit → [n] auf das Angebot (1 und 2)');
  ok(!rec.texte.some((t) => /angenommen/i.test(t.s)) && !hat('Kein Angebot'), 'ohne Info keine Meldung ANGENOMMEN, kein leerer Zustand');
  ok(hat('AUFTRAGSBRETT'), 'Titel des Bereichs aus dem Snapshot (kopf)');
  const karten = R2.ui.buttons.filter((b) => b.onClick);
  ok(karten.length === 3 && karten.every((b) => typeof b.onClick === 'function' && b.h === MASS.liste.karteH && b.w === MASS.liste.w), 'drei Klickflächen 214 × 46 (Karten); die Flächen der Marken tragen nur einen Tooltip, keinen Klick');
}

section('Zeichnen: gewähltes Angebot wechselt das Detail, ein Angebot, kein Angebot, laufend');
{
  let m = modellAus({ angebote: [KONVOI, HEIMWEG, BOJE], geruechte: GER });
  zeichne(baustein(m, 'a3'));
  geometrie('Boje');
  ok(hat('kein Kampf angekündigt') && !rec.texte.some((t) => /^GEFAHR$/i.test(t.s) && t.x >= L.handel.x + MASS.liste.w), 'Angebot ohne Gefahr: ausdrücklich „kein Kampf angekündigt“, kein GEFAHR im Detail');
  ok(hat('Eine Boje sendet seit drei Tagen nichts mehr.') && hat('verfällt nach 11 Tätigkeiten'), 'Detail der Boje');
  zeichne(baustein(m, 'a2'));
  geometrie('Heimweg');
  ok(hat('! verfällt nach 2 Tätigkeiten') && hat('Durch die Front bei Gullfjord') && rec.texte.some((t) => t.s === 'Germanen'), 'Detail Heimweg: bald (!), gefährlicher Schritt, Auftraggeber Germanen');
  m = modellAus({ angebote: [BOJE] });
  zeichne(baustein(m));
  geometrie('eins');
  ok(!rec.texte.some((t) => /^GERÜCHT$/i.test(t.s)), 'ohne Gerüchte keine Gerüchtzeile');
  m = modellAus({ angebote: [], laufend: LAUFEND });
  zeichne(baustein(m));
  geometrie('nurLaufend');
  ok(rec.texte.some((t) => /^KEIN ANGEBOT$/i.test(t.s)) && hatTeil(/^Gerade liegt am Brett nichts aus/), 'leer (nur Laufendes): „Kein Angebot“ mit Erklärung');
  const bLeer = baustein(m); bLeer.leerText = 'Eigener Satz aus den Daten.'; zeichne(bLeer);
  ok(hatTeil(/^Eigener Satz aus den Daten/), 'der Satz im leeren Zustand kann aus den Daten kommen');
  m = modellAus({ angebote: [HEIMWEG, BOJE], laufend: LAUFEND, geruechte: GER.slice(1) });
  zeichne(baustein(m));
  geometrie('laeuft');
  ok(rec.texte.some((t) => /^LÄUFT$/i.test(t.s)) && hat('Frist noch 5 Tätigkeiten') && hat('Schritt 3 von 4 ·') && hat('Konvoi stellen und aufhalten'), 'Laufend-Streifen: LÄUFT, Frist noch 5 Tätigkeiten, Schritt 3 von 4, Schrittname');
  ok(rec.texte.filter((t) => t.s === 'Der Bernsteinkonvoi').length === 1, 'der Streifen nennt den Titel des laufenden Abenteuers');
  ok(R2.ui.buttons.filter((b) => b.onClick).every((b) => b.h === MASS.liste.karteHKompakt), 'bei laufendem Abenteuer sind die Karten kompakt (36)');
  ok(rec.rects.filter((r) => r.col === FARBE.text && r.h === 1 && r.w === MASS.laeuft.beatW + 2).length === 2, 'der aktuelle Beat trägt einen Rahmen (oben und unten), Form statt nur Farbe');
  ok(rec.rects.filter((r) => r.col === FARBE.laeuft && r.h === MASS.laeuft.beatH).length === 3, 'Beats: 3 volle (zwei fertig, einer jetzt), der vierte hohl');
  const wartet = klon(LAUFEND); wartet.ph = 'wartet'; wartet.rest = 3;
  m = modellAus({ angebote: [BOJE], laufend: wartet }); zeichne(baustein(m));
  ok(!hatTeil(/^Frist noch/) && !hatTeil(/^! Frist/), 'wartet das Abenteuer auf den nächsten Schritt, steht keine Frist (rest ist dann keine Frist)');
  const bald = klon(LAUFEND); bald.rest = 1;
  m = modellAus({ angebote: [BOJE], laufend: bald }); zeichne(baustein(m));
  ok(hat('! Frist läuft ab') && rec.texte.find((t) => t.s === '! Frist läuft ab').col === FARBE.bald, 'Frist fast um: „! Frist läuft ab“ in Gelb');
}

section('Zeichnen: Infozeile (Absagen, angenommen), lange Texte, Text bleibt Text');
{
  let m = modellAus({ angebote: [HEIMWEG, BOJE], laufend: LAUFEND, geruechte: GER });
  zeichne(baustein(m, 'a2', { grund: BrettClient.antwortText('schon_beantwortet') }));
  geometrie('Absage');
  const ab = rec.texte.find((t) => t.s === BrettClient.antwortText('schon_beantwortet'));
  ok(!!ab && ab.col === FARBE.bald && ab.y === L.handelInfo.y + 2, 'Absage des Servers in Gelb auf der ersten Zeile der Infozeile');
  ok(!rec.texte.some((t) => /^ANGENOMMEN$/i.test(t.s)), 'Absage und ANGENOMMEN stehen nie zusammen (Absage ersetzt die erste Zeile)');
  zeichne(baustein(m, 'a2', { angenommen: 'Der Bernsteinkonvoi' }));
  geometrie('Angenommen');
  ok(rec.texte.some((t) => /^ANGENOMMEN$/i.test(t.s) && t.col === FARBE.laeuft) && hat('Die Crew hat „Der Bernsteinkonvoi“ angenommen.'), 'ANGENOMMEN in Mint, Satz „Die Crew hat „…“ angenommen.“ (ohne Spielernamen)');
  // alle zehn Codes: der Kurztext passt in die Infozeile (kürzt sich selbst, läuft nie über)
  for (const c of ['modus', 'unbekannt', 'kein_angebot', 'schon_beantwortet', 'am_boden', 'kein_spielleiter', 'laeuft_schon', 'kein_platz', 'veraltet', 'fehler']) {
    zeichne(baustein(m, 'a2', { grund: BrettClient.antwortText(c) }));
    const t = rec.texte.find((q) => q.y === L.handelInfo.y + 2 && q.col === FARBE.bald);
    ok(!!t && t.x + t.w <= L.handelInfo.x + L.handelInfo.w && t.s.replace('…', '').length > 10, 'Code ' + c + ': „' + (t && t.s.slice(0, 40)) + '…“ in Gelb und innerhalb der Infozeile');
  }
  // lange Texte und Müll aus dem Modell
  const lang = 'Wort '.repeat(120);
  const L1 = { id: 'a1', titel: 'Ein sehr langer Titel des Abenteuers mit zu vielen Wörtern drin', ortname: 'Ein Ort mit einem sehr langen Namen im Sund', rest: 7, von: 'rom', anlass: lang,
    vorschau: { gefahr: true, schritte: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => SCH('Ein sehr langer Schritt Nummer ' + i + ' mit viel Text hinten dran', i === 2)), gelingt: [lang, { f: 'rom', art: 'ruf', d: 2 }, { f: 'kon', art: 'haltung', d: -2 }, { f: 'ger', art: 'haltung', d: 1 }, { f: 'kon', art: 'ruf', d: 1 }], scheitert: [lang] } };
  m = modellAus({ angebote: [L1, Object.assign(klon(L1), { id: 'a2', rest: 1 }), Object.assign(klon(L1), { id: 'a3' })], geruechte: [{ von: 'rom', text: lang, angebot: 'a1' }, { von: 'ger', text: lang, angebot: 'a2' }, { von: 'kon', text: lang, angebot: 'a3' }] });
  zeichne(baustein(m));
  geometrie('lang');
  ok(hat('+5 weitere'), 'mehr als 4 Schritte: 3 Schritte und „+5 weitere“ in der letzten Zeile');
  m = modellAus({ angebote: [Object.assign(klon(L1), { titel: '<script>alert(1)</script>', anlass: '<b>fett</b> &lt;i&gt; ${x} {{y}}' })] });
  zeichne(baustein(m));
  ok(hat('<script>alert(1)</script>'), 'HTML im Titel wird als Text gezeichnet (Zeichen für Zeichen unverändert)');
  ok(rec.texte.some((t) => t.s.indexOf('<b>fett</b>') >= 0), 'HTML im Anlass wird als Text gezeichnet');
}

section('Zeichnen: Flug-HUD, vier Fälle');
{
  const fall = (o) => { rec.texte.length = 0; rec.rects.length = 0; rec.cham.length = 0; const l = Object.assign(klon(LAUFEND), o); const unten = PT.zeichneAbenteuerHud(ctx, 40, l); return { l, unten }; };
  let r = fall({ titel: 'Der Bernsteinkonvoi', schritt: 2, schritt_text: 'Nach Kantenstein', gefahr: false, rest: 7 });
  const H = MASS.hud;
  ok(r.unten === 40 + H.h && rec.cham.length === 1 && rec.cham[0].x === H.x && rec.cham[0].w === H.w && rec.cham[0].y === 40 && rec.cham[0].h === H.h && H.w === 192 && H.h === 23, 'Streifen 192 × 23 bei y, Unterkante = y + 23');
  ok(rec.texte.some((t) => t.s === 'Frist 7' && t.col === FARBE.hudDim) && rec.texte.some((t) => t.s === 'Der Bernsteinkonvoi' && t.col === FARBE.hudTitel) && rec.texte.some((t) => t.s === 'Nach Kantenstein'), 'normal: Titel in Bernstein, „Frist 7“, aktueller Schritt');
  ok(rec.rects.filter((q) => q.col === FARBE.laeuft && q.w === H.beatW && q.h === H.beatH).length === 2, 'Beats: 2 volle (1 fertig + jetzt), 2 offene hohl (Schritt 2 von 4)');
  ok(!rec.rects.some((q) => q.col === FARBE.gefahrRot), 'ohne Gefahr keine Bake');
  ok(rec.rects.filter((q) => q.col === FARBE.hudText && q.h === 1 && q.w === H.beatW).length === 1, 'der aktuelle Beat trägt einen Strich darunter (Form, nicht nur Farbe)');
  r = fall({ schritt: 3, gefahr: true, rest: 5 });
  ok(rec.rects.some((q) => q.col === FARBE.gefahrRot) && rec.texte.some((t) => t.s === 'Frist 5'), 'Schritt mit Gefahr: Bake vor dem Schritt (Form, nicht nur Farbe), „Frist 5“');
  r = fall({ schritt: 4, gefahr: false, rest: 1, schritt_text: 'Ladung nach Concordia bringen' });
  ok(rec.texte.some((t) => t.s === '! Frist 1' && t.col === FARBE.bald), 'Frist läuft ab: „! Frist 1“ in Gelb');
  r = fall({ schritt: 1, ph: 'wartet', neu: true, titel: 'Sigrids Heimweg', schritt_text: 'In Ostia Nova an Bord nehmen' });
  ok(rec.texte.some((t) => t.s === 'ANGENOMMEN' && t.col === FARBE.laeuft) && !rec.texte.some((t) => /Frist/.test(t.s)), 'eben angenommen: ANGENOMMEN in Mint statt Frist');
  r = fall({ schritt: 2, ph: 'wartet', rest: 3 });
  ok(!rec.texte.some((t) => /Frist/.test(t.s)), 'wartet auf den nächsten Schritt: keine Frist');
  fall({ titel: 'Ein ganz ungewöhnlich langer Titel eines Abenteuers', schritt_text: 'Ein ungewöhnlich langer Schrittname der nicht in den Streifen passt' });
  ok(rec.texte.every((t) => t.x >= H.x && t.x + t.w <= H.x + H.w), 'lange Texte im HUD werden gekürzt und laufen nicht aus dem Streifen');
}

section('Zeichnen: ganzes Terminal (Knopf Brett, Bereich Brett nur mit Modell)');
{
  const m0 = modellAus({ angebote: [KONVOI, HEIMWEG, BOJE], geruechte: GER });
  const ganz = (m, extra) => { rec.texte.length = 0; rec.rects.length = 0; rec.knoepfe.length = 0; rec.cham.length = 0; R2.ui.buttons.length = 0; PT.zeichneTerminal(ctx, {}, Object.assign({ status: {}, kopf: { ort: 'Ostia Nova', art: 'hafen', marken: 840 }, kreuz: {}, module: {} }, extra || {}, m)); };
  ganz({ bereich: 'brett', brett: baustein(m0), bereichUmschalter: { bereich: 'brett', brett: { label: TEXT.knopf }, onBereich: () => {} }, aktionen: { haupt: { art: 'brettAnnehmen', text: 'Annehmen' }, ausbau: { label: 'Ablehnen', aktion: 'terminal.brettAblehnen', taste: 'X', kontur: true }, teil: {} } });
  const kb = rec.knoepfe.find((b) => b.label === TEXT.knopf);
  ok(kb && kb.x === 374 && kb.w === 48 && kb.y === L.aktionen.brett.y && kb.h === L.aktionen.brett.h && kb.hotkey === 'O' && kb.fn === 'nav' && typeof kb.onClick === 'function', 'zeichneTerminal: Knopf „Brett“ auf dem Platz des Designers, Taste O, anklickbar');
  ok(rec.knoepfe.filter((b) => b.y === L.aktionen.brett.y).map((b) => b.label).sort().join() === 'Brett,Handel,Werft', 'ohne Info und Kurs: Brett, Handel und Werft auf einer Zeile');
  ok(hat('AUFTRAGSBRETT') && hat('Der Bernsteinkonvoi'), 'zeichneTerminal: Bereich brett zeichnet das Brett');
  const kn = rec.knoepfe.find((b) => b.label === 'Ablehnen');
  ok(kn && kn.kontur === true && kn.hotkey === 'X', 'Ablehnen: Kontur-Knopf mit Taste X (leise)');
  const ha = rec.knoepfe.find((b) => b.label === 'Annehmen');
  ok(ha && ha.hotkey === 'Ent' && ha.fn === 'nav', 'Annehmen: Hauptknopf mit Taste Ent');
  ganz({ bereich: 'werft', bereichUmschalter: { bereich: 'werft', brett: null }, aktionen: {} });
  ok(!rec.knoepfe.some((b) => b.label === TEXT.knopf) && !hat('AUFTRAGSBRETT'), 'ohne Brett-Modell: kein Knopf, kein Brett (bestehendes Verhalten)');
  ganz({ bereich: 'werft', bereichUmschalter: { bereich: 'werft', brett: { label: TEXT.knopf } }, aktionen: {} });
  ok(rec.knoepfe.find((b) => b.label === TEXT.knopf) && !hat('AUFTRAGSBRETT'), 'Knopf da, Bereich Werft offen: das Brett wird nicht gezeichnet');
  // gewählte Karte: Plakette mit 1-px-Rahmen in ink (G liegt auf Messing bei 1,1:1)
  zeichne(baustein(m0, 'a2'));
  const rahmen = rec.rects.filter((r) => r.col === FARBE.ink && r.w === MASS.plakette + 2 && r.h === 1);
  ok(rahmen.length >= 2, 'Plakette auf der gewählten (Messing-)Karte trägt einen ink-Rahmen (' + rahmen.length + ' Linien)');
  const flaeche = rec.cham.find((q) => q.col === FARBE.angebot);
  ok(flaeche && flaeche.w === MASS.liste.w && flaeche.h === MASS.liste.karteH && flaeche.y === L.handel.y + MASS.liste.karteH + MASS.liste.luft, 'volle Messingfläche liegt auf der zweiten Karte (gewählt)');
  ok(rec.rects.some((r) => r.col === FARBE.angebot && r.w === MASS.geruecht.balken) && rec.cham.filter((q) => q.col === FARBE.kachel).length === 2, 'die zwei anderen Karten sind Kacheln; die Karte „aus Gerücht“ trägt den gestrichelten Balken');
  // Gerücht mit unbekanntem Verweis: kein Verweis, kein Absturz
  const mg = modellAus({ angebote: [BOJE], geruechte: [{ von: 'rom', text: 'Ein Gerücht ohne Angebot', angebot: 'a77' }] });
  ok(mg.geruechte[0].angebot === '', 'Gerücht mit unbekannter Angebots-Id verweist auf nichts');
  zeichne(baustein(mg));
  ok(hat('Ein Gerücht ohne Angebot') && !hat('→'), 'Gerücht ohne Verweis: nur der Text, kein →');
}

// ================================================================ Nacharbeit SUND-04b D: R1, D1 bis D4, H1 bis H9
const D0 = PA.layout(false).detail, Z = MASS.detail;
// ein Wurf im Client bei Müll zählt als Fehler des Tests (nicht als Absturz des Laufs)
const sicher = (fn, was) => { try { return fn(); } catch (e) { ok(false, was + ' wirft: ' + e.message); return null; } };
const wortW = (n) => 'W'.repeat(n);
section('R1: lange Wörter ohne Leerzeichen laufen nie über die Spalte (R.wrap bricht nur an Leerzeichen)');
{
  for (const n of [40, 100]) {
    const W = wortW(n);
    const lang = { id: 'a1', titel: W, ortname: W, rest: 5, von: 'rom', anlass: W, vorschau: { gefahr: true, schritte: [SCH(W, true), SCH(W)], gelingt: [W, W, { f: 'rom', art: 'ruf', d: 1 }], scheitert: [W, W] } };
    const m = modellAus({ angebote: [lang, Object.assign(klon(lang), { id: 'a2' })], geruechte: [{ von: 'rom', text: W, angebot: 'a1' }, { von: 'rom', text: W, angebot: 'a2' }] });
    const b = baustein(m); b.scheitern = W; b.info = { grund: W };
    zeichne(b);
    const T = rec.texte.filter((t) => /^W{3}/.test(t.s) || /^w{3}/i.test(t.s));
    const rechts = (t) => (t.y < L.handelInfo.y - 3 && t.x < L.handel.x + MASS.liste.w ? L.handel.x + MASS.liste.w : L.handel.x + L.handel.w);
    ok(T.length >= 6 && T.every((t) => t.x + t.w <= rechts(t)), n + ' Zeichen ohne Leerzeichen in Titel, Ort, Anlass, Schritt, Gelingt, Scheitert, Scheitern-Satz, Gerücht, Absage: jede Zeile bleibt in ihrer Spalte (' + T.length + ' Zeilen, größte Überschreitung ' + Math.max(0, ...T.map((t) => t.x + t.w - rechts(t))) + ' px)');
    const fol = rec.texte.filter((t) => t.x === D0.gelingt.x && /^W{2}/.test(t.s));
    ok(fol.length >= 2 && fol.every((t) => t.w <= D0.gelingt.w), n + ' Zeichen: Gelingt und Scheitert höchstens ' + D0.gelingt.w + ' px breit (' + fol.length + ' Zeilen)');
    geometrie('Langwort ' + n);
    const bl = baustein(modellAus({ angebote: [], laufend: LAUFEND })); bl.leerText = wortW(120); zeichne(bl);
    const lt = rec.texte.filter((t) => /^W{3}/.test(t.s));
    ok(lt.length >= 1 && lt.every((t) => t.x + t.w <= L.handel.x + L.handel.w - MASS.leer.x), 'leerText mit einem Wort von 120 Zeichen: höchstens ' + (L.handel.w - 2 * MASS.leer.x) + ' px breit');
  }
  const Rw = R2.wrap(wortW(40), 100, 1);
  ok(Rw.length === 1 && Rw[0].length * 6 > 100, 'Kontrolle: die echte R.wrap lässt ein 40-Zeichen-Wort überbreit stehen (der Fehler ist hier real, der Baustein kappt)');
}

section('D1: Titel in Versalien mit Sperrung, passt er nicht in normaler Schreibweise, erst dann gekürzt; Server und Anzeige kürzen auf 40');
{
  let versal = 0, normal = 0, punkt = 0; const fehlerD1 = [];
  for (let n = 10; n <= 40; n++) {
    const titel = ('Titel ' + 'm'.repeat(n)).slice(0, n);
    zeichne(baustein(modellAus({ angebote: [Object.assign(klon(BOJE), { titel, von: 'kon' })] })));
    const von = rec.texte.find((t) => t.s === 'Auftrag von'), tt = rec.texte.find((t) => t.y === D0.titel.y && t.x === D0.titel.x);
    const avail = von.x - Z.titelLuft - D0.titel.x;
    const sollVersal = PT.tw(titel.toUpperCase(), 1, 1) <= avail, sollNormal = !sollVersal && PT.tw(titel) <= avail;
    if (sollVersal) { versal++; if (!(tt.s === titel.toUpperCase() && tt.o && tt.o.versal && tt.w <= avail)) fehlerD1.push(n + ' versal'); }
    else if (sollNormal) { normal++; if (!(tt.s === titel && !(tt.o && tt.o.versal) && tt.w <= avail)) fehlerD1.push(n + ' normal'); }
    else { punkt++; if (!(tt.s.endsWith('…') && tt.w <= avail)) fehlerD1.push(n + ' …'); }
  }
  ok(fehlerD1.length === 0 && versal > 5 && normal >= 1, 'Titel von 10 bis 40 Zeichen: Versalien mit Sperrung (' + versal + ' Längen), dann normal ohne Sperrung (' + normal + '), dann mit „…“ (' + punkt + '); nie überbreit' + (fehlerD1.length ? ' (' + fehlerD1.join(', ') + ')' : ''));
  ok(DATEN.werte.titel_max.wert === BrettClient.GRENZE.titel && BrettClient.GRENZE.titel === 40, 'Server (titel_max in den Daten) und Anzeige (Brett.GRENZE.titel) kürzen beide auf 40');
  const lang = 'Ein Titel der deutlich länger als vierzig Zeichen ist und gekürzt wird';
  BrettClient.lesen({ t: 'snap', world: { abenteuer: { angebote: [{ id: 'a1', titel: lang }], laufend: { id: 'a2', titel: lang, schritt: 1, schritte_gesamt: 2 } } } });
  const mm = BrettClient.modell();
  ok(mm.angebote[0].titel.length === 40 && mm.angebote[0].titel.endsWith('…') && lang.startsWith(mm.angebote[0].titel.slice(0, -1)) && mm.laufend.titel === mm.angebote[0].titel, 'brett.js kürzt Titel (Angebot und laufend) mit „…“ statt still abzuschneiden');
}

section('D2: Zustand „wartet“ sieht nicht aus wie „läuft“ (Streifen und HUD), H5');
{
  const flaechen = (b) => ({ voll: rec.rects.filter((r) => r.col === FARBE.laeuft && r.h === b.h && r.w === b.w).length, rahmen: rec.rects.filter((r) => r.col === FARBE.text && r.h === 1 && r.w === b.w + 2).length });
  const wartet = klon(LAUFEND); wartet.ph = 'wartet'; wartet.rest = 3;
  let m = modellAus({ angebote: [BOJE], laufend: wartet }); zeichne(baustein(m));
  const bt = rec.texte.find((t) => t.s === 'beginnt in 3 Tätigkeiten');
  ok(!!bt && bt.col === FARBE.dim && bt.o && bt.o.align === 'right' && !hatTeil(/Frist/), 'Streifen: rechts „beginnt in 3 Tätigkeiten“ in dim, keine Frist');
  const bw = { w: MASS.laeuft.beatW, h: MASS.laeuft.beatH };
  ok(flaechen(bw).voll === 2 && flaechen(bw).rahmen === 2, 'Streifen: der Beat „jetzt“ ist hohl (nur die 2 fertigen sind voll), trägt aber den Creme-Rahmen; bei „läuft“ sind es 3 volle');
  m = modellAus({ angebote: [BOJE], laufend: Object.assign(klon(wartet), { rest: 1 }) }); zeichne(baustein(m));
  ok(hat('beginnt in 1 Tätigkeit') && rec.texte.find((t) => t.s === 'beginnt in 1 Tätigkeit').col === FARBE.dim, 'rest 1: „beginnt in 1 Tätigkeit“ in dim (nicht gelb)');
  m = modellAus({ angebote: [BOJE], laufend: Object.assign(klon(wartet), { rest: 0 }) }); zeichne(baustein(m));
  ok(hat('beginnt gleich'), 'rest 0: „beginnt gleich“');
  m = modellAus({ angebote: [BOJE], laufend: LAUFEND }); zeichne(baustein(m));
  ok(!hatTeil(/beginnt/) && flaechen(bw).voll === 3, 'läuft: keine „beginnt“-Zeile, der Beat „jetzt“ ist voll');
  const hud = (o) => { rec.texte.length = 0; rec.rects.length = 0; rec.cham.length = 0; PT.zeichneAbenteuerHud(ctx, 40, Object.assign(klon(LAUFEND), o)); };
  const Hm = MASS.hud, hb = { w: Hm.beatW, h: Hm.beatH };
  hud({ ph: 'wartet', rest: 3, schritt: 2 });
  ok(rec.texte.some((t) => t.s === 'in 3' && t.col === FARBE.hudDim) && !hatTeil(/Frist/), 'HUD wartet: rechts „in 3“ in dim, keine Frist');
  hud({ ph: 'wartet', rest: 1, schritt: 2 });
  ok(rec.texte.some((t) => t.s === 'in 1' && t.col === FARBE.hudDim), 'HUD wartet mit rest 1: „in 1“ bleibt dim (keine gelbe Frist, auch wenn es gleich losgeht)');
  ok(rec.rects.filter((r) => r.col === FARBE.laeuft && r.w === hb.w && r.h === hb.h).length === 1 && rec.rects.filter((r) => r.col === FARBE.hudText && r.w === hb.w && r.h === 1).length === 3, 'HUD wartet: „jetzt“ hohl mit Creme-Rahmen und Strich darunter (nur 1 voller Beat, der fertige)');
  hud({ ph: 'laeuft', rest: 3, schritt: 2 });
  ok(rec.rects.filter((r) => r.col === FARBE.laeuft && r.w === hb.w && r.h === hb.h).length === 2 && rec.rects.filter((r) => r.col === FARBE.hudText && r.w === hb.w && r.h === 1).length === 1, 'HUD läuft: „jetzt“ voll mit Strich darunter');
  hud({ ph: 'wartet', schritt: 1, neu: true });
  ok(rec.texte.some((t) => t.s === 'ANGENOMMEN' && t.col === FARBE.laeuft) && !hatTeil(/^in \d/), 'HUD frisch angenommen: ANGENOMMEN bleibt');
  hud({ ph: 'wartet', schritt: 1, neu: true, titel: 'Ein ganz ungewöhnlich langer Titel eines Abenteuers' });
  const ti = rec.texte.find((t) => t.col === FARBE.hudTitel), an = rec.texte.find((t) => t.s === 'ANGENOMMEN');
  ok(Hm.titelLuft === 10 && ti.x + ti.w + Hm.titelLuft <= an.x, 'H5: zwischen Titel und ANGENOMMEN bleiben mindestens 10 px (' + (an.x - ti.x - ti.w) + ')');
  hud({ schritte_gesamt: 8, schritt: 3 });
  ok(rec.rects.filter((r) => r.col === FARBE.laeuft && r.w === Hm.beatW && r.h === hb.h).length === 3, 'H5: bis 8 Beats 6 breit');
  hud({ schritte_gesamt: 9, schritt: 3 });
  ok(Hm.beatWSchmal === 4 && Hm.schmalAb === 9 && rec.rects.filter((r) => r.col === FARBE.laeuft && r.w === Hm.beatWSchmal && r.h === hb.h).length === 3 && !rec.rects.some((r) => r.col === FARBE.laeuft && r.w === Hm.beatW && r.h === hb.h), 'H5: ab 9 Beats 4 breit (wie im Terminal schmaler)');
}

section('D3: Ruf und Haltung sind unterscheidbar (Wort in dim vor der Plakette, Tooltip „Ruf Konkordat +2“)');
{
  const m = modellAus({ angebote: [HEIMWEG, BOJE, KONVOI] });
  zeichne(baustein(m, 'a2'));
  const G = D0.gelingt, zeile1 = G.y + Z.kopfH;
  const hw = rec.texte.find((t) => t.s === 'Haltung' && t.y === zeile1), rw = rec.texte.find((t) => t.s === 'Ruf' && t.y === zeile1);
  ok(!!hw && !!rw && hw.col === FARBE.dim && rw.col === FARBE.dim && hw.x === G.x && rw.x > hw.x, 'Gelingt: erste Textzeile „Haltung [G]▲▲ · Ruf [R]▼“, die Wörter in dim');
  ok(rec.texte.some((t) => /▲▲/.test(t.s) && t.y === zeile1) && rec.texte.some((t) => /▼/.test(t.s) && t.y === zeile1), 'Pfeile in derselben Zeile (die Richtung trägt der Pfeil)');
  ok(rec.texte.some((t) => /^Sigrid erinnert/.test(t.s) && t.y === zeile1 + MASS.zeile), 'der Satz steht unter der Markenzeile');
  const labels = R2.ui.buttons.map((b) => b.label);
  ok(['Haltung Germanen +2', 'Ruf Rom −1', 'Haltung Germanen −1'].every((l) => labels.includes(l)), 'je Marke eine Fläche in R.ui.buttons mit dem Wortlaut („Ruf Rom −1“): ' + labels.filter((l) => /^(Ruf|Haltung) /.test(l)).join(' | '));
  ok(R2.ui.buttons.filter((b) => /^(Ruf|Haltung) /.test(b.label)).every((b) => !b.onClick && b.w >= MASS.plakette && b.h === MASS.marke.h), 'die Flächen sind reine Tooltips (kein Klick), mindestens so breit wie die Plakette');
  const fl = R2.ui.buttons.find((b) => b.label === 'Ruf Rom −1'); R2.ui.mouse = { x: fl.x + 1, y: fl.y + 1 }; R2.ui.tooltip = null; zeichne(baustein(m, 'a2'));
  ok(R2.ui.tooltip && R2.ui.tooltip.text === 'Ruf Rom −1', 'mit der Maus darüber erscheint der Tooltip „Ruf Rom −1“'); R2.ui.mouse = { x: -1, y: -1 }; R2.ui.tooltip = null;
  zeichne(baustein(m, 'a1'));
  ok(PA.markeText({ f: 'kon', art: 'ruf', d: 2 }) === 'Ruf Konkordat +2' && rec.texte.some((t) => t.s === 'Haltung' && t.y === zeile1) && R2.ui.buttons.some((b) => b.label === 'Haltung Konkordat +1'), 'Konvoi: „Haltung Konkordat +1“ (Marke der Fraktion des Auftraggebers); markeText(Ruf Konkordat +2)');
  const viel = { id: 'a1', titel: 'Viel', ortname: 'Ort', rest: 5, von: 'rom', anlass: 'a', vorschau: { gefahr: false, schritte: [SCH('x')], gelingt: [{ f: 'rom', art: 'ruf', d: 2 }, { f: 'kon', art: 'ruf', d: 1 }, { f: 'ger', art: 'haltung', d: -2 }, { f: 'rom', art: 'haltung', d: 1 }, 'Satz eins.', 'Satz zwei.', 'Satz drei.'], scheitert: [{ f: 'rom', art: 'haltung', d: -1 }, 'Scheitern eins.', 'Scheitern zwei.', 'Scheitern drei.'] } };
  zeichne(baustein(modellAus({ angebote: [viel] })));
  geometrie('viele Marken');
  ok(hat('Ruf') && hat('Haltung') && hat('Satz eins.') && !hat('Satz drei.'), 'Platzmangel: die Markenzeile verdrängt einen Satz (der letzte entfällt, mit „…“), nichts läuft über');
}

section('D4: die Wahl einer Bitte (vorschau.schritte[].wahl) wird durchgereicht, gekennzeichnet und im Tooltip gezeigt');
{
  const B = BrettClient;
  const wahl = [{ text: 'Helfen', folgen: [{ f: 'rom', art: 'haltung', d: 1 }] }, { text: 'Ablehnen', folgen: [{ f: 'rom', art: 'haltung', d: -1 }] }];
  B.lesen({ t: 'snap', world: { abenteuer: { angebote: [{ id: 'a1', titel: 'Bitte', anlass: 'x', vorschau: { schritte: [{ text: 'Bitte um Hilfe', gefahr: false, wahl }, { text: 'Ohne Wahl' }] } }] } } });
  let st = B.modell().angebote[0].vorschau.schritte;
  ok(JSON.stringify(st[0].wahl) === JSON.stringify(wahl) && st[1].wahl === null, 'brett.js: die Wahl kommt durch (Optionen und ihre Marken), ein Schritt ohne Wahl hat keine');
  const muell = [5, null, 'x', { text: 5 }, { text: 'ok', folgen: 'x' }, { text: 'y', folgen: [null, 5, { f: 3 }, { f: 'rom', art: 'haltung', d: 'x' }, { f: 'rom', art: 'ruf', d: 1 }] }, { text: 'z'.repeat(300) }, { text: 'vier' }, { text: 'fünf' }];
  st = sicher(() => { B.lesen({ t: 'snap', world: { abenteuer: { angebote: [{ id: 'a1', titel: 'Bitte', vorschau: { schritte: [{ text: 'S', wahl: muell }, { text: 'T', wahl: 'x' }, { text: 'U', wahl: [] }, { text: 'V', wahl: {} }] } }] } } }); return B.modell().angebote[0].vorschau.schritte; }, 'wahl') || [{ wahl: [] }, {}, {}, {}];
  ok(st[0].wahl.length === 4 && st[0].wahl[0].text === 'ok' && st[0].wahl[0].folgen.length === 0 && st[0].wahl[1].folgen.length === 1 && st[0].wahl.every((o) => o.text.length <= B.GRENZE.wahlText) && st[1].wahl === null && st[2].wahl === null && st[3].wahl === null, 'Müll in der Wahl (Typ, Länge, Anzahl) fällt weg oder wird begrenzt, kein Absturz');
  const m = modellAus({ angebote: [Object.assign(klon(BOJE), { vorschau: Object.assign(klon(BOJE.vorschau), { schritte: [{ text: 'Im Bojenfeld scannen', gefahr: false, wahl }, SCH('Der Spur folgen')] }) })] });
  zeichne(baustein(m));
  const y0 = D0.schritte.y + Z.kopfH;
  const wz = rec.texte.find((t) => t.s === ' · Wahl' && t.y === y0);
  ok(!!wz && wz.col === FARBE.dim && !rec.texte.some((t) => t.s === ' · Wahl' && t.y !== y0), 'der Schritt mit Wahl trägt „· Wahl“ in dim hinter dem Text, der andere nicht');
  const tf = R2.ui.buttons.find((b) => /^Wahl: /.test(b.label || ''));
  ok(!!tf && tf.label === 'Wahl: Helfen (Haltung Rom +1) · Ablehnen (Haltung Rom −1)' && !tf.onClick && tf.y === y0, 'Tooltip-Fläche des Schritts nennt die Optionen mit ihren Marken: ' + (tf && tf.label));
  R2.ui.mouse = { x: tf.x + 5, y: tf.y + 2 }; R2.ui.tooltip = null; zeichne(baustein(m));
  ok(R2.ui.tooltip && R2.ui.tooltip.text === tf.label, 'mit der Maus über dem Schritt erscheint der Tooltip'); R2.ui.mouse = { x: -1, y: -1 }; R2.ui.tooltip = null;
  geometrie('Wahl');
}

section('H2: Scheitern-Satz als letzte Zeile unter SCHEITERT, Gelingt bis 4 Zeilen');
{
  const eins = { id: 'a1', titel: 'Vier', ortname: 'Ort', rest: 9, von: 'rom', anlass: 'a', vorschau: { gefahr: false, schritte: [SCH('x')], gelingt: [{ f: 'rom', art: 'ruf', d: 1 }, { f: 'ger', art: 'haltung', d: 1 }, 'Gelingt eins.', 'Gelingt zwei.', 'Gelingt drei.'], scheitert: ['Scheitert eins.'] } };
  zeichne(baustein(modellAus({ angebote: [eins] })));
  geometrie('Scheitern-Satz');
  const G = D0.gelingt, gz = (i) => G.y + Z.kopfH + i * MASS.zeile;
  ok(rec.texte.some((t) => t.s === 'Gelingt eins.' && t.y === gz(1)) && rec.texte.some((t) => t.s === 'Gelingt zwei.' && t.y === gz(2)) && rec.texte.some((t) => t.s === 'Gelingt drei.' && t.y === gz(3)), 'Scheitert braucht höchstens 2 Zeilen: Gelingt bekommt 4 (Markenzeile und 3 Sätze)');
  const sy = gz(4) + Z.folgeLuft - 0, sk = rec.texte.find((t) => t.s === 'SCHEITERT');
  ok(!!sk && sk.y === sy, 'SCHEITERT beginnt unter der vierten Gelingt-Zeile (' + (sk && sk.y) + ' = ' + sy + ')');
  const satz = rec.texte.find((t) => /^Scheitern bl/.test(t.s) && t.x === D0.scheitert.x);
  ok(!!satz && satz.col === FARBE.dim && satz.y === sy + Z.kopfH + MASS.zeile && rec.texte.some((t) => t.s === 'Scheitert eins.' && t.y === sy + Z.kopfH), 'der Scheitern-Satz des Servers steht in dim als letzte Zeile unter SCHEITERT (nach dem eigenen Satz)');
  ok(R2.ui.buttons.some((b) => b.label === 'Scheitern blockiert nichts.'), 'der volle Satz ist auch als Tooltip da');
  const drei = Object.assign(klon(eins), { vorschau: Object.assign(klon(eins.vorschau), { scheitert: ['Eins.', 'Zwei.', 'Drei.'] }) });
  zeichne(baustein(modellAus({ angebote: [drei] })));
  ok(!rec.texte.some((t) => t.s === 'Gelingt drei.') && hatTeil(/^Gelingt zwei/) && hatTeil(/^Scheitern bl/) && hat('Eins.') && hatTeil(/^Zwei./), 'braucht Scheitert mehr als 2, bleiben Gelingt 3 Zeilen (Markenzeile, 2 Sätze), Scheitert zeigt 2 eigene Zeilen plus den Satz');
  geometrie('Scheitern-Satz 3');
  zeichne(baustein(modellAus({ angebote: [eins, BOJE], laufend: LAUFEND })));
  ok(!hatTeil(/^Scheitern bl/), 'mit laufendem Abenteuer (kompaktes Detail) entfällt der Scheitern-Satz');
  geometrie('Scheitern-Satz laufend');
}

section('H3: Typen aus dem Server auf der Karte (Zeile 2) und im Detail');
{
  const B = BrettClient;
  const mm = sicher(() => { B.lesen({ t: 'snap', world: { abenteuer: { angebote: [{ id: 'a1', titel: 'T', typen: ['bitte', 5, null, {}, 'x'.repeat(100), '', 'spur', 'konvoi', 'geleit'] }, { id: 'a2', titel: 'U', typen: 'x' }] } } }); return B.modell(); }, 'typen') || { angebote: [{ typen: [] }, { typen: [] }] };
  ok(mm.angebote[0].typen.join() === 'bitte,' + 'x'.repeat(16) + ',spur,konvoi' && mm.angebote[1].typen.length === 0, 'brett.js: typen typgeprüft, begrenzt (4 Stück, 16 Zeichen), Müll fällt weg');
  const k = klon(KONVOI); k.typen = ['geruecht', 'konvoi'];
  const m = modellAus({ angebote: [k, Object.assign(klon(HEIMWEG), { typen: ['geleit'] }), Object.assign(klon(BOJE), { typen: ['spur', 'bitte', 'konvoi', 'geleit'] })] });
  zeichne(baustein(m));
  ok(hat('Gerücht · Kantenstein') || hat('Gerücht · Konvoi · Kantenstein'), 'Karte, Zeile 2: Typ und Ort („Gerücht · …Kantenstein“)');
  ok(hat('Geleit · Gullfjord'), 'zweite Karte: „Geleit · Gullfjord“');
  ok(rec.texte.some((t) => /Bojenfeld$/.test(t.s)), 'dritte Karte: vier Typen passen nicht neben den Ort, die hinteren entfallen, der Ort bleibt');
  ok(rec.texte.some((t) => t.s === 'GERÜCHT' && t.x >= D0.ort.x && t.y === D0.ort.y + MASS.tag.textY), 'Detail: die Typen als Marken mit Rand vor dem Ort (so viele, wie neben Ort und Verfall passen)');
  geometrie('Typen');
}

section('H1, H4 bis H9: Ersetzungsmuster, Hilfe, Aufrufer, Tokens');
{
  ok(PA.text('gesperrtGrund', { titel: "a$'b" }) === "Erst „a$'b“ abschließen" && PA.text('gesperrtGrund', { titel: '$& $1 $$' }) === 'Erst „$& $1 $$“ abschließen', 'H1: Titel mit $-Mustern bleiben unverändert im Grund (kein String.replace-Muster)');
  ok(PT.zeichneBrett.length === 2, 'H8: zeichneBrett(c, b) ohne ungenutzte Parameter');
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
  const tb = src('public/js/pult-terminal-brett.js');
  ok(!/P\.mix\(/.test(tb) && FARBE.kappeGew === '#443728', 'H6: die gemischte Kappenfarbe ist ein Token (kappeGew), kein P.mix im Baustein');
  const mixhex = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) + (parseInt(b.slice(i, i + 2), 16) - parseInt(a.slice(i, i + 2), 16)) * t).toString(16).padStart(2, '0')).join('');
  ok(mixhex(FARBE.ink, FARBE.angebot, 0.3) === FARBE.kappeGew, 'H6: kappeGew = ink zu 70 % mit Messing zu 30 % gemischt');
  ok(!/y1 = r\.y \+ \d|y2 = r\.y \+ \d|const h = 58|B\.x \+ 14|B\.y \+ 25/.test(tb), 'H6: die Maße der Karte, des Streifens und des leeren Zustands stehen in MASS');
  const pt = src('public/js/pult-terminal-tokens.js');
  ok(!/brett: \{ x: 374/.test(pt) && !/modulTitel: \{ x: 266, y: py - 4, w: 104/.test(pt) && /KB\.brett\.x/.test(pt) && /KB \? KB\.modulTitelW/.test(pt), 'H7: Knopf und Titellinie stehen nur noch in PultAuftrag (MASS.knopf), pult-terminal-tokens liest sie');
  ok(L.aktionen.brett.x === 374 && L.aktionen.brett.x === MASS.knopf.brett.x, 'H7: der Knopf liegt weiter auf x 374');
  const w3 = { Render: R2, Pult: P2, Shared_Protocol: {}, performance, KarteTokens: KT }; w3.window = w3; vm.createContext(w3);
  vm.runInContext(J('pult-terminal-tokens.js'), w3, { filename: 'pult-terminal-tokens.js' });
  const L3 = w3.PultTerminal.layout(640, 360);
  ok(L3.modulTitel.w === 154 && !('brett' in L3.aktionen), 'ohne PultAuftrag: Linie MODULRAUM 154 breit, kein Brett-Knopf (Stand vor dem Brett)');
  rec.knoepfe.length = 0; R2.ui.buttons.length = 0;
  PT.zeichneTerminal(ctx, {}, { bereich: 'brett', brett: baustein(modellAus({ angebote: [BOJE] })), status: {}, kopf: { ort: 'Ostia Nova', art: 'hafen', marken: 1 }, kreuz: {}, module: {}, bereichUmschalter: { bereich: 'brett', brett: { label: 'Brett' }, info: { label: 'Info' }, lage: { label: 'Kurs' }, onBereich: () => {} }, aktionen: {} });
  const rr = R2.ui.buttons.filter((b) => b.y === L.aktionen.brett.y && b.hotkey).map((b) => b.hotkey + ' ' + b.label).join(', ');
  ok(rr === 'O Brett, I Info, K Kurs, H Handel, W Werft', 'H9: Hilfe-Reihenfolge wie auf dem Pult von links: ' + rr);
}

section('brett.js: Typprüfungen (Folgen, Schritte, laufend, Listen) und Zeichnen der Kappen und Typ-Marken');
{
  const B = BrettClient, blk = (a) => sicher(() => { B.lesen({ t: 'snap', world: { abenteuer: a } }); return B.modell(); }, 'brett.js bei Müll');
  let m = blk({ angebote: [{ id: 'a1', titel: 'T', vorschau: { gelingt: [null, 5, { f: 3, d: 1 }, { f: 'rom' }, { f: 'rom', d: 'x' }, { f: '', d: 1 }, { f: 'rom', art: 'haltung', d: 2 }, 'Satz', ''], scheitert: [{ f: 'kon', d: NaN }, { f: 'kon', d: Infinity }, { f: 'kon', d: -1 }] } }] });
  ok(JSON.stringify(m.angebote[0].vorschau.gelingt) === JSON.stringify([{ f: 'rom', art: 'haltung', d: 2 }, 'Satz']), 'Folgen: nur Zeichenketten und Marken mit Fraktion (Text) und Delta (Zahl); sonst fällt es weg: ' + JSON.stringify(m.angebote[0].vorschau.gelingt));
  ok(JSON.stringify(m.angebote[0].vorschau.scheitert) === JSON.stringify([{ f: 'kon', art: 'ruf', d: -1 }]), 'Delta NaN und Infinity gelten nicht (nur endliche Zahlen)');
  m = blk({ angebote: [{ id: 'a1', titel: 'T', vorschau: { schritte: ['Als Text', { text: 'Objekt', gefahr: true }, 5, null, { text: '' }, {}, { text: 7 }] } }] });
  ok(JSON.stringify(m.angebote[0].vorschau.schritte.map((s) => [s.text, s.gefahr])) === JSON.stringify([['Als Text', false], ['Objekt', true]]) && m.angebote[0].vorschau.gefahr === true, 'Schritte: Zeichenketten und Objekte mit Text; leere und fremde fallen weg');
  m = blk({ angebote: [{ id: 'a1', titel: 'T' }], laufend: { id: 'a2', schritt: 1, schritte_gesamt: 3 } });
  ok(m.laufend === null && m.angebote.length === 1, 'laufend ohne Titel gilt nicht');
  m = blk({ laufend: { id: 'a2', schritt: 1 } });
  ok(m === null, 'nur ein laufendes Abenteuer ohne Titel: kein Modell');
  m = blk({ angebote: 'x', geruechte: 'y' });
  ok(m === null, 'Listen, die keine sind (Zeichenkette), zählen als leer');
  m = blk({ angebote: { length: 2, slice: () => [{ id: 'a1', titel: 'T' }] } });
  ok(m === null, 'ein Objekt mit slice ist keine Liste');
  // Kappe auf der gewählten Karte: eigene Farbe (Token), nicht die der anderen Karten
  zeichne(baustein(modellAus({ angebote: [KONVOI, HEIMWEG] }), 'a2'));
  ok(rec.rects.some((r) => r.col === FARBE.kappeGew && r.h === MASS.kappe.h) && rec.rects.filter((r) => r.col === FARBE.kappe && r.h === MASS.kappe.h).length === 1, 'Nummernkappe: auf der gewählten Karte kappeGew, auf der anderen kappe');
  // vier Typen im Detail: nur so viele Marken, wie neben den Verfall passen (keine Überlappung)
  const k4 = klon(KONVOI); k4.typen = ['geruecht', 'konvoi', 'sabotage', 'wiedersehen'];
  zeichne(baustein(modellAus({ angebote: [k4] })));
  geometrie('vier Typen');
  const tags = rec.texte.filter((t) => t.y === D0.ort.y + MASS.tag.textY && t.o && t.o.versal && t.x >= D0.ort.x);
  ok(tags.length >= 1 && tags.length < 4 && hat('Kantenstein'), 'Typ-Marken: ' + tags.length + ' von 4 passen neben den Verfall, der Ort bleibt sichtbar');
}

section('Quellen: Anschluss in hud.js, consoles.js, client.js und werft.js (nicht im Node-Test ausführbar, Sicht: tools/sicht-brett.js)');
{
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
  const hud = src('public/js/hud.js');
  ok(/drawAbenteuerStreifen\(ctx, y\) \{[\s\S]*?Brett\.modell\(\)[\s\S]*?zeichneAbenteuerHud\(ctx, y,[\s\S]*?Brett\.frisch\(BR\.laufend\)/.test(hud) && /planY = this\.drawAbenteuerStreifen\(ctx, planY\)/.test(hud) && /drawPlanningLine\(ctx, view, planY\)/.test(hud), 'hud.js: der Streifen kommt aus Brett.modell(), „frisch“ aus dem Snapshot, die Planungszeile rückt unter ihn');
  ok(/objBottom \|\| 30\) \+ 2;\n[^\n]*drawAbenteuerStreifen/.test(hud), 'hud.js: der Streifen sitzt bei objBottom + 2 direkt unter dem Ziele-Kasten');
  ok(/tu\.bereichJetzt === 'brett' \? 'terminal\.brett'/.test(src('public/js/consoles.js')), 'consoles.js: tastenBereiche kennt den Bereich Brett (umbelegte Tasten gelten dort)');
  ok(/ev\.kind === 'abenteuerAntwort'/.test(src('public/js/client.js')), 'client.js: abenteuerAntwort geht an das Terminal');
  ok(/msg\.b === 'b' \? 'b'/.test(src('server/sim/werft.js')), 'werft.js: werft.ansicht kennt b = b (Zuschauer)');
  const idx = src('public/index.html');
  const ord = ['js/pult-terminal-tokens.js', 'js/pult-auftrag-tokens.js', 'js/pult-terminal-brett.js', 'js/terminal-ui.js'].map((f) => idx.indexOf('src="' + f + '"'));
  ok(ord.every((i) => i > 0) && ord.every((i, k) => k === 0 || i > ord[k - 1]) && idx.indexOf('src="js/brett.js"') > idx.indexOf('src="js/net.js"') && idx.indexOf('src="js/brett.js"') < idx.indexOf('src="js/hud.js"') && idx.indexOf('src="js/pult-auftrag-tokens.js"') > idx.indexOf('src="js/pult.js"') && idx.indexOf('src="js/pult-auftrag-tokens.js"') > idx.indexOf('src="js/karte-tokens.js"'), 'index.html: Ladereihenfolge (Net → brett.js → hud.js; pult.js und karte-tokens.js → pult-auftrag-tokens.js → pult-terminal-brett.js → terminal-ui.js)');
}

// ================================================================ 3. terminal-ui.js gegen einen echten Server
const win = { Shared_Schiffskatalog: Katalog, Shared_Maps: Maps, Shared_Config: CONFIG, Shared_Protocol: Protocol, Shared_Locations: Locations, performance, Net: { reportError(w, e) { throw e; }, on() {} } };
win.window = win;
win.Render = { PAL: {}, text() {}, drawTooltip() {}, ui: { buttons: [], mouse: { x: 0, y: 0 } } };
win.Pult = {};
let letztesModell = null;
win.PultTerminal = { TOKENS: { RASTER: { deckName: ['Mitteldeck', 'Oberdeck', 'Unterdeck'] } }, kappe: (a, e) => e, tw: (s) => String(s).length * 6, zeichneTerminal(c, v, m) { letztesModell = m; } };
win.Consoles = { shopRows() { return []; }, denied() {} };
win.PultAuftrag = PA;
vm.createContext(win);
vm.runInContext(J('brett.js'), win, { filename: 'brett.js' });
vm.runInContext(J('terminal-ui.js'), win, { filename: 'terminal-ui.js' });
const TU = win.TerminalUI, BR = win.Brett;
ok(TU && BR && typeof BR.modell === 'function' && typeof TU.keyDown === 'function', 'TerminalUI und Brett geladen');

const NAMEN = ['Mireille_Kas', 'Ouzo_Brandt', 'Tzvi_Lund'];
const plan = (beats, o) => Object.assign({ format: 'faden-bauplan/1', titel: 'Probe Auftrag', anlass: 'Ein Probeanlass ohne Namen fuer den Test', beats }, o || {});
const notrufplan = (i) => plan([{ typ: 'notruf' }, { typ: 'abschluss' }], { titel: 'Notruf ' + i, anlass: 'Probeanlass Nummer ' + i + ' ohne Namen' });
// Spiel mit Lage-Spielleiter (Mock) und drei Spielern; Spieler 0 sitzt am Terminal. Die Befehle gehen über den echten Befehlsweg (game.handleMessage), die Ereignisse kommen erst NACH dem Tastendruck an
// (wie im Netz: die Antwort ist asynchron), der Snapshot wird wie im Browser gelesen (Brett.lesen).
function partie(opt) {
  opt = opt || {};
  const t = X.F.neuesSpiel({ crew: 3, seed: 11, names: NAMEN, env: { FAEDEN: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_LLM: 'mock', ABENTEUER_ANSCHLUSS: '0' } });
  t.g.lageSpielleiter = LS.create(t.g, { llm: LLM.create({ mode: 'mock' }), werte: { min_abstand_ticks: 1, deckel_je_sitzung: 0 }, abenteuerWerte: { deckel_je_sitzung: 0 } });
  t.g.lageSchalter = true;
  t.g.players[0].console = 'shop';
  t.sent = [];
  for (let i = 1; i <= (opt.angebote === undefined ? 3 : opt.angebote); i++) { const a = X.Faden.abenteuerAnbieten(t.g, notrufplan(i), { hex: '0305' }); if (!a.ok) throw new Error('Angebot ' + i + ': ' + JSON.stringify(a)); }
  BR.lesen({ t: 'welcome' });
  t.view = (i) => { const snap = t.g.snapshot(); if (t.einfrieren) (t.puffer = t.puffer || []).push(snap); else BR.lesen(Object.assign({ t: 'snap' }, snap)); return { state: JSON.parse(JSON.stringify(snap)), me: t.g.players[i], send(m) { t.sent.push(m); t.g.handleMessage(t.cs[i], m); }, actions: { sfx() {}, leave() {} } }; };   // der Snapshot, den die Ansicht bekommt, geht auch an brett.js (der Block kommt nur einmal, wie im Netz)
  t.auftauen = () => { t.einfrieren = false; for (const q of t.puffer || []) BR.lesen(Object.assign({ t: 'snap' }, q)); t.puffer = []; };   // der zurückgehaltene Stand kommt beim Client an
  t.nachlauf = (i) => { const inbox = t.cs[i].inbox.splice(0); for (const m of inbox) if (m.t === 'event' && /^(werft|abenteuerAntwort)/.test(m.kind)) TU.onEvent(m); };
  t.lesen = () => { for (let i = 0; i < 40; i++) BR.lesen(Object.assign({ t: 'snap' }, t.g.snapshot())); };
  t.key = (code, i, ohneLesen) => { if (!ohneLesen) t.lesen(); const v = t.view(i || 0); const r = TU.keyDown({ code, preventDefault() {} }, v); t.nachlauf(i || 0); return r; };
  t.m = (i) => { t.lesen(); return TU.modell(t.view(i || 0)); };
  t.ids = () => X.Faden.zustandVon(t.g).abenteuerAngebote.map((a) => 'a' + a.nr);
  // Terminal öffnen wie im Spiel: das erste Zeichnen setzt den Bereich, danach gelten die Tasten
  t.oeffnen = () => { TU.zuruecksetzen(); t.lesen(); TU.draw({}, t.view(0)); t.nachlauf(0); };
  return t;
}
const warte = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* aktiv warten, Test ist synchron */ } };   // ansichtSenden entprellt auf 120 ms
const cmds = (t, c) => t.sent.filter((q) => /^abenteuer\./.test(q.c || '') && (!c || q.c === c));

section('terminal-ui: ohne Block (kein FAEDEN=1) bleibt alles wie vorher');
{
  const t = partie({ angebote: 0 });
  t.oeffnen();
  let m = t.m();
  ok(BR.modell() === null && m.bereichUmschalter.brett === null && m.bereich !== 'brett', 'ohne world.abenteuer: kein Knopf Brett, kein Bereich Brett');
  const bereich = TU.zustand.bereich;
  t.key('KeyO');
  ok(TU.zustand.bereich === bereich && TU.bereichJetzt !== 'brett', 'Taste O wechselt nicht (der Bereich gibt es nicht)');
  t.key('KeyX'); t.key('Enter');
  ok(cmds(t).length === 0, 'kein Befehl abenteuer.* ohne Bereich');
  t.key('KeyW'); t.key('Digit3');
  ok(TU.zustand.bereich === 'werft' && TU.zustand.platz === 3, 'W und 3: die Werft wählt Platz 3 wie gehabt (der Bereich Brett schluckt nichts)');
}

section('terminal-ui: Brett mit drei Angeboten, Tasten und Befehle');
{
  const t = partie();
  t.oeffnen();
  const ids = t.ids();
  ok(ids.length === 3 && BR.modell().angebote.map((a) => a.id).join() === ids.join(), 'Snapshot: 3 Angebote ' + ids.join(','));
  let m = t.m();
  ok(m.bereichUmschalter.brett && m.bereichUmschalter.brett.label === TEXT.knopf, 'Knopf „Brett“ (Beschriftung aus den Tokens) nur mit Block');
  t.key('KeyO');
  m = t.m();
  ok(TU.zustand.bereich === 'brett' && m.bereich === 'brett' && m.bereichUmschalter.bereich === 'brett' && TU.bereichJetzt === 'brett', 'Taste O öffnet den Bereich Brett');
  ok(m.brett.angebote.length === 3 && m.brett.angebote.map((a) => a.nr).join() === '1,2,3' && m.brett.gewaehlt === ids[0], 'Modell: 3 Karten, Nummern 1..3, die erste gewählt');
  ok(m.brett.angebote.every((a, i) => a.id === ids[i] && a.titel === 'Notruf ' + (i + 1) && a.anlass === 'Probeanlass Nummer ' + (i + 1) + ' ohne Namen'), 'Titel und Anlass kommen aus dem Snapshot (Server)');
  ok(m.kopf.art === 'hafen' && m.brett.titel === DATEN.werte.kopf.wert, 'Kopf: Titel des Bretts aus den Daten des Servers („' + DATEN.werte.kopf.wert + '“)');
  ok(m.aktionen.haupt.disabled === false && m.aktionen.haupt.text === TEXT.annehmen && m.aktionen.ausbau.label === TEXT.ablehnen && m.aktionen.ausbau.kontur === true && m.aktionen.ausbau.disabled === false, 'Annehmen aktiv, Ablehnen als Kontur-Knopf (leise)');
  ok(m.aktionen.hinweis.text === DATEN.werte.ablehnen_text.wert.replace(/\.$/, '') && m.aktionen.hinweis.fn === 'modul', 'Hinweis „' + m.aktionen.hinweis.text + '“ in Mint (Text aus den Daten des Servers)');
  ok(/kostet nichts/.test(m.aktionen.hinweis.text), 'Ablehnen trägt den Hinweis „kostet nichts“');
  ok(m.brett.hilfe.indexOf('wählen') >= 0 && m.brett.hilfe.indexOf('annehmen') >= 0 && m.brett.hilfe.indexOf('ablehnen') >= 0, 'Tastenzeile: wählen, annehmen, ablehnen');
  ok(m.aktionen.haupt.art === 'brettAnnehmen' && m.aktionen.ausbau.aktion === 'terminal.brettAblehnen' && m.aktionen.ausbau.taste === 'X', 'Aktionen tragen die Brett-Belegung (brettAnnehmen, terminal.brettAblehnen, X)');
  t.key('ArrowDown'); ok(TU.zustand.brettId === ids[1] && t.m().brett.gewaehlt === ids[1], '↓ wählt das zweite Angebot');
  t.key('ArrowDown'); t.key('ArrowDown'); ok(TU.zustand.brettId === ids[0], 'am Ende springt die Auswahl zum ersten (im Kreis)');
  t.key('ArrowUp'); ok(TU.zustand.brettId === ids[2], '↑ vom ersten zum letzten');
  t.key('Digit2'); ok(TU.zustand.brettId === ids[1], 'Taste 2 wählt das zweite Angebot');
  t.key('Numpad1'); ok(TU.zustand.brettId === ids[0], 'Ziffernblock 1 wählt das erste');
  const platz = TU.zustand.platz; t.key('Digit5'); ok(TU.zustand.platz === platz && TU.zustand.bereich === 'brett', 'andere Ziffern tun im Bereich Brett nichts (kein Waffenplatz)');
  t.m().brett.angebote[2].onClick(); ok(TU.zustand.brettId === ids[2], 'Klick auf die Karte wählt sie');
  ok(cmds(t).length === 0, 'Wählen sendet nichts an den Server');
  // ablehnen (X): leise, kostet nichts
  const haltungVorher = JSON.stringify(t.g.weltsim && t.g.weltsim.faeden && t.g.weltsim.faeden.liste.length);
  t.key('KeyX');
  ok(cmds(t).length === 1 && JSON.stringify(cmds(t)[0]) === JSON.stringify({ t: 'cmd', c: 'abenteuer.ablehnen', id: ids[2] }), 'X sendet { t: cmd, c: abenteuer.ablehnen, id } mit der Id des gewählten Angebots');
  ok(t.ids().join() === ids.slice(0, 2).join() && TU.zustand.antwort === null && TU.zustand.wartet === null, 'der Server nimmt es vom Brett; die Antwort ok ist leise (keine Meldung), nichts wartet mehr');
  m = t.m();
  ok(m.brett.info === null && m.brett.angebote.length === 2 && BR.modell().laufend === null && JSON.stringify(t.g.weltsim.faeden.liste.length) === haltungVorher, 'Ablehnen: keine Meldung, 2 Angebote bleiben, nichts startet');
  // annehmen (Enter)
  t.key('Enter');
  ok(cmds(t, 'abenteuer.annehmen').length === 1 && cmds(t, 'abenteuer.annehmen')[0].id === ids[0] && cmds(t, 'abenteuer.annehmen')[0].t === 'cmd', 'Enter sendet abenteuer.annehmen mit der Id des gewählten Angebots (' + ids[0] + ', nach dem Ablehnen die erste)');
  m = t.m();
  ok(!!BR.modell().laufend && BR.modell().angebote.every((a) => a.id !== ids[0]), 'Annahme: das Abenteuer läuft laut Snapshot (world.abenteuer.laufend), das Angebot ist vom Brett');
  ok(m.brett.laufend && m.brett.laufend.titel === 'Notruf 1', 'Modell trägt das laufende Abenteuer (Titel aus dem Snapshot)');
  ok(m.brett.info && m.brett.info.angenommen === m.brett.laufend.titel, 'ANGENOMMEN steht, solange das Abenteuer auf den ersten Schritt wartet (Snapshot, kein lokaler Zustand)');
  ok(m.aktionen.haupt.disabled === true && m.aktionen.haupt.grund === 'Erst „Notruf 1“ abschließen', 'Annehmen gesperrt, Grund: Erst „Notruf 1“ abschließen');
  ok(m.aktionen.hinweis.text === TEXT.gesperrt && m.aktionen.hinweis.fn === 'warn', 'sichtbarer Hinweis „Ein Abenteuer läuft schon“ in Gelb (nicht nur Tooltip)');
  ok(m.aktionen.ausbau.disabled === false, 'Ablehnen bleibt möglich, solange ein Abenteuer läuft');
  const vor = t.sent.length; t.key('Enter');
  ok(t.sent.length === vor, 'Enter bei laufendem Abenteuer sendet nichts');
  // Mausklick auf Annehmen / Ablehnen geht denselben Weg wie die Tasten
  m.aktionen.ausbau.onClick(); t.nachlauf(0);
  ok(cmds(t, 'abenteuer.ablehnen').length === 2 && cmds(t, 'abenteuer.ablehnen')[1].id === t.sent.filter((q) => q.c === 'abenteuer.ablehnen')[1].id, 'Klick auf Ablehnen sendet denselben Befehl (jetzt mit dem gewählten Rest-Angebot)');
}

section('terminal-ui: zweite Antwort (schon_beantwortet) und alle Absagen');
{
  const t = partie();
  t.oeffnen(); t.key('KeyO');
  const ids = t.ids();
  // Spieler 1 hat schon abgelehnt; der Client von Spieler 0 hält noch den alten Stand (Angebot da) und nimmt an
  t.g.handleMessage(t.cs[1], { t: 'cmd', c: 'abenteuer.ablehnen', id: ids[0] }); t.cs[1].inbox.length = 0;
  t.einfrieren = true;   // der Client bekommt den Stand der Ablehnung noch nicht
  const alt = klon(BR.store.abenteuer);
  ok(alt.angebote.some((a) => a.id === ids[0]), 'Vorbedingung: der Client kennt das Angebot noch');
  t.key('Enter', 0, true);
  const a = TU.zustand.antwort;
  ok(a && a.ok === false && a.code === 'schon_beantwortet', 'der Server antwortet schon_beantwortet (Ereignis abenteuerAntwort an den Absender)');
  const m = TU.modell(t.view(0));
  ok(m.brett.info && m.brett.info.grund === BR.antwortText('schon_beantwortet') && /erste Antwort der Crew gilt/.test(m.brett.info.grund), 'die Infozeile zeigt „… die erste Antwort der Crew gilt.“');
  ok(!m.brett.info.angenommen && TU.zustand.wartet === null, 'Absage ersetzt ANGENOMMEN, nichts wartet mehr');
  ok(t.ids().indexOf(ids[0]) < 0 && !BR.modell().laufend, 'die erste Antwort bleibt, es startet nichts');
}
{
  // ein anderer Spieler hat ANGENOMMEN: der Snapshot zeigt „ANGENOMMEN“ für alle, die zweite Antwort (Enter am veralteten Stand) bringt die Absage und ersetzt es
  const t = partie();
  t.oeffnen(); t.key('KeyO');
  const ids = t.ids();
  t.g.handleMessage(t.cs[1], { t: 'cmd', c: 'abenteuer.annehmen', id: ids[0] }); t.cs[1].inbox.length = 0;
  t.einfrieren = true;
  t.key('Enter', 0, true);
  ok(TU.zustand.antwort && TU.zustand.antwort.code === 'schon_beantwortet' && cmds(t, 'abenteuer.annehmen').length === 1, 'zweite Annahme: schon_beantwortet');
  t.auftauen(); t.lesen();
  const m = TU.modell(t.view(0));
  ok(m.brett.laufend && m.brett.laufend.titel === 'Notruf 1' && m.brett.info && m.brett.info.grund === BR.antwortText('schon_beantwortet') && !m.brett.info.angenommen, 'das Abenteuer läuft (frisch), die Absage steht trotzdem in der Infozeile (sie ersetzt ANGENOMMEN)');
}
{
  // Doppeldruck: bevor die Antwort da ist, sendet das Terminal nichts ein zweites Mal
  const t = partie();
  t.oeffnen(); t.key('KeyO'); t.einfrieren = true;
  const v = t.view(0);
  TU.keyDown({ code: 'Enter', preventDefault() {} }, v); TU.keyDown({ code: 'Enter', preventDefault() {} }, v); TU.keyDown({ code: 'KeyX', preventDefault() {} }, v);
  ok(cmds(t).length === 1 && cmds(t)[0].c === 'abenteuer.annehmen', 'zweimal Enter und X vor der Antwort: genau ein Befehl (Entprellung, Antwort steht aus)');
  t.nachlauf(0);
  t.auftauen(); t.lesen();
}
{
  // Ziffernblock-Enter wie Enter; die Daten des Servers bestimmen den Hinweistext
  const t = partie();
  t.oeffnen(); t.key('KeyO');
  t.key('NumpadEnter');
  ok(cmds(t, 'abenteuer.annehmen').length === 1, 'Enter auf dem Ziffernblock nimmt an');
  const t2 = partie();
  t2.oeffnen(); t2.key('KeyO');
  BR.lesen({ t: 'snap', world: { abenteuer: Object.assign(klon(BR.store.abenteuer), { ablehnen: 'Anderer Text vom Server.' }) } });
  ok(TU.modell(t2.view(0)).aktionen.hinweis.text === 'Anderer Text vom Server', 'der Hinweis unter Annehmen ist der Text aus dem Snapshot (ohne Schlusspunkt)');
}
{
  const t = partie();
  t.oeffnen(); t.key('KeyO');
  for (const code of ['modus', 'unbekannt', 'kein_angebot', 'schon_beantwortet', 'am_boden', 'kein_spielleiter', 'laeuft_schon', 'kein_platz', 'veraltet', 'fehler']) {
    TU.onEvent({ t: 'event', kind: 'abenteuerAntwort', pid: undefined, op: 'annehmen', ok: false, code, text: DATEN.weigerungen[code] });
    const m = TU.modell(t.view(0));
    ok(m.brett.info && m.brett.info.grund === BR.antwortText(code) && m.brett.info.grund.length > 10 && TU.zustand.wartet === null, 'Code ' + code + ': Infozeile „' + m.brett.info.grund.slice(0, 44) + '…“, nicht mehr wartend');
  }
  TU.onEvent({ t: 'event', kind: 'abenteuerAntwort', op: 'annehmen', ok: false, code: 'code_neu', text: 'Freier Text' });
  ok(TU.modell(t.view(0)).brett.info.grund === 'Freier Text', 'unbekannter Code: Klartext des Servers');
  TU.onEvent({ t: 'event', kind: 'abenteuerAntwort', op: 'annehmen', ok: true });
  ok(TU.modell(t.view(0)).brett.info === null, 'eine ok-Antwort räumt die Absage weg (leise)');
  win.Client = { pid: 5 };
  TU.onEvent({ t: 'event', kind: 'abenteuerAntwort', pid: 9, op: 'annehmen', ok: false, code: 'kein_platz', text: 'x' });
  ok(TU.modell(t.view(0)).brett.info === null, 'Antworten für einen anderen Spieler (pid) werden ignoriert');
  TU.onEvent({ t: 'event', kind: 'abenteuerAntwort', pid: 5, op: 'annehmen', ok: false, code: 'kein_platz', text: 'x' });
  ok(TU.modell(t.view(0)).brett.info && TU.modell(t.view(0)).brett.info.grund === BR.antwortText('kein_platz'), 'die eigene Antwort (pid) wird gezeigt');
  delete win.Client;
}

section('terminal-ui: Zuschauer sehen das Brett, bedienen nichts');
{
  const t = partie();
  t.oeffnen(); t.key('KeyO');
  const ids = t.ids();
  t.key('ArrowDown');
  warte(130);
  TU.draw({}, t.view(0)); t.nachlauf(0);   // sendet werft.ansicht
  const ansicht = t.sent.filter((q) => q.c === 'werft.ansicht').pop();
  ok(ansicht && ansicht.b === 'b' && ansicht.i === ids[1], 'werft.ansicht: b = b und die Id des gewählten Angebots');
  const ui = t.g.snapshot().werft && t.g.snapshot().werft.ui;
  ok(ui && ui.b === 'b' && ui.i === ids[1], 'der Server reicht b = b und die Id an die Zuschauer durch (' + JSON.stringify(ui) + ')');
  // Zuschauer = Spieler 1 (derselbe Client-Zustand, jetzt im Zuschauermodus)
  TU.zuruecksetzen();
  TU.zusehen(t.view(1), true);
  const gesendetVor = t.sent.length;
  const m = t.m(1);
  ok(m.bereich === 'brett' && m.brett.gewaehlt === ids[1] && m.titel === 'ZUSEHEN', 'der Zuschauer sieht das Brett mit dem gewählten Angebot des Nutzers');
  ok(m.aktionen.haupt.disabled === true && m.aktionen.haupt.onClick === null && m.aktionen.ausbau.disabled === true && m.aktionen.teil.disabled === true, 'alle Knöpfe des Zuschauers sind gesperrt');
  ok(m.brett.angebote.every((x) => x.onClick === null) && m.brett.hilfe === '', 'keine Klickflächen und keine Tastenzeile für den Zuschauer');
  t.key('Enter', 1); t.key('KeyX', 1); t.key('ArrowDown', 1); t.key('Digit3', 1); m.aktionen.ausbau.onClick();
  ok(t.sent.slice(gesendetVor).filter((q) => /^abenteuer\./.test(q.c || '')).length === 0 && TU.zustand.brettId === null, 'Tasten und Klick des Zuschauers senden nichts und ändern nichts');
  // Annahme an einem Gerät: der Zuschauer sieht sie aus dem Snapshot
  TU.zusehen(t.view(1), false);
  t.oeffnen(); t.key('KeyO'); warte(130); TU.draw({}, t.view(0)); t.nachlauf(0); t.key('Enter', 0);
  TU.zusehen(t.view(1), true);
  const m1 = t.m(1);
  ok(m1.brett.laufend && m1.brett.info && m1.brett.info.angenommen === m1.brett.laufend.titel && m1.aktionen.hinweis.text === 'Du siehst zu · Esc zurück', 'der Zuschauer sieht das laufende Abenteuer und ANGENOMMEN (Snapshot-getrieben), dazu „Du siehst zu“');
  TU.zusehen(t.view(1), false);
}

section('terminal-ui: ohne Spielleiter (ok 0) und Löschsignal');
{
  const t = partie();
  t.oeffnen(); t.key('KeyO');
  BR.lesen({ t: 'snap', world: { abenteuer: Object.assign(klon(BR.store.abenteuer), { ok: 0 }) } });
  let m = TU.modell(t.view(0));
  ok(m.aktionen.haupt.disabled === true && m.aktionen.haupt.grund === BR.antwortText('kein_spielleiter') && m.aktionen.hinweis.fn === 'warn' && m.aktionen.hinweis.text === BR.antwortText('kein_spielleiter'), 'ok 0: Annehmen gesperrt mit sichtbarem Grund, Angebote bleiben sichtbar');
  const vor = t.sent.length; t.key('Enter', 0, true);
  ok(t.sent.length === vor, 'ok 0: Enter sendet nichts');
  m = TU.modell(t.view(0));
  ok(m.brett.angebote.length === 3 && m.aktionen.ausbau.disabled === false, 'ok 0: Ablehnen bleibt möglich');
  BR.lesen({ t: 'snap', world: { abenteuer: null } });
  const jetzt = TU.bereichJetzt;   // vor dem Modell: die Tastenbelegung fragt den wirksamen Bereich, bevor etwas gezeichnet wurde
  m = TU.modell(t.view(0));
  ok(m.bereich !== 'brett' && jetzt === 'werft' && m.bereichUmschalter.brett === null, 'Löschsignal: der Bereich fällt weg, wirksamer Bereich ist wieder die Werft (die Tasten greifen nicht mehr auf das Brett)');
  t.key('Digit3', 0, true);
  ok(TU.zustand.platz === 3, 'danach wählt die Taste 3 wieder Platz 3');
}

// ================================================================ 4. Tasten
section('Tasten: O frei, keine Kollision, Namen');
{
  const tw = { localStorage: null }; tw.window = tw; vm.createContext(tw);
  vm.runInContext(J('tasten.js'), tw, { filename: 'tasten.js' });
  const Ta = tw.Tasten, term = Ta.AKTIONEN.filter((a) => a.gruppe === 'terminal');
  const mit = (code) => term.filter((a) => a.std.indexOf(code) >= 0);
  const o = Ta.AKTIONEN.find((a) => a.id === 'terminal.brett');
  ok(o && o.std.join() === 'KeyO' && !o.bereich, 'terminal.brett = O, ohne Bereich (gilt überall im Terminal)');
  ok(mit('KeyO').length === 1, 'O ist im Terminal sonst nirgends belegt');
  ok(Ta.AKTIONEN.filter((a) => a.id !== 'terminal.brett' && a.std.indexOf('KeyO') >= 0).every((a) => a.gruppe !== 'terminal' && a.gruppe !== 'allgemein'), 'O gehört in anderen Gruppen nur Ops (Orbitalschlag), nie dem Terminal oder allgemein');
  ok(['KeyB', 'KeyA', 'KeyK', 'KeyI', 'KeyH', 'KeyW'].every((k) => !mit(k).some((a) => a.id === 'terminal.brett')), 'B, A, K, I, H, W bleiben, was sie waren');
  const B = (id) => Ta.AKTIONEN.find((a) => a.id === id);
  ok(B('terminal.brettAnnehmen').bereich === 'terminal.brett' && B('terminal.brettAnnehmen').std.join() === 'Enter,NumpadEnter' && B('terminal.brettAblehnen').std.join() === 'KeyX' && B('terminal.brettAblehnen').bereich === 'terminal.brett', 'Enter nimmt an, X lehnt ab, nur im Bereich Brett');
  ok([1, 2, 3].every((i) => B('terminal.brett' + i) && B('terminal.brett' + i).bereich === 'terminal.brett' && B('terminal.brett' + i).std.join() === 'Numpad' + i + ',Digit' + i), 'Ziffern 1–3 wählen im Bereich Brett');
  ok(Ta.BEREICHE['terminal.brett'] && /Brett/.test(Ta.BEREICHE['terminal.brett'].name) && term.filter((a) => a.bereich === 'terminal.brett').length === 5 && term.filter((a) => a.bereich === 'terminal.brett').every((a) => a.name.length > 8), 'Bereich und Aktionen sind für das Menü benannt');
  // Kollisionen: gleiche Taste in demselben Bereich (Aktionen ohne Bereich zählen mit jedem Bereich)
  const bereiche = [...new Set(term.map((a) => a.bereich).filter(Boolean))];
  const kollisionen = [];
  for (const b of bereiche) {
    const aktiv = term.filter((a) => !a.bereich || a.bereich === b), seen = {};
    for (const a of aktiv) for (const tk of a.std) { if (seen[tk]) kollisionen.push(b + ': ' + tk + ' = ' + seen[tk] + ' / ' + a.id); else seen[tk] = a.id; }
  }
  ok(kollisionen.length === 0, 'keine Tastenkollision in einem Bereich des Terminals (' + bereiche.length + ' Bereiche)' + (kollisionen.length ? ': ' + kollisionen.join('; ') : ''));

  ok(Ta.konflikte('terminal').length === 0, 'die Konfliktprüfung des Menüs (Tasten.konflikte, inkl. Gruppe allgemein) findet im Terminal nichts');
  const brettBelegt = Ta.AKTIONEN.filter((q) => q.bereich === 'terminal.brett').flatMap((q) => q.std);
  ok(['KeyB', 'KeyA', 'KeyK', 'KeyI', 'KeyH', 'KeyW', 'KeyE', 'KeyN', 'KeyF', 'KeyG'].every((k) => brettBelegt.indexOf(k) < 0), 'im Bereich Brett ist keine der Bereichs- und Werfttasten belegt (nur Enter, X, 1–3)');
  // die Belegung wirkt: die Tastenkanon-Logik (Consoles) ist bereichsgebunden; Terminal-Bereich Brett nimmt O nicht in der Werft
  ok(Ta.passt({ code: 'KeyO' }, 'terminal.brett') && !Ta.passt({ code: 'KeyP' }, 'terminal.brett'), 'passt: O trifft terminal.brett');
  ok(Ta.kappe('terminal.brett') === 'O' && Ta.kappe('terminal.brettAnnehmen') === 'Ent' && Ta.kappe('terminal.brettAblehnen') === 'X', 'Kappen: O, Ent, X');
}

section('H1, H4: terminal-ui (Sperrgrund ohne Ersetzungsmuster, Tastenzeile bei gesperrter Annahme)');
{
  const t = partie({ angebote: 0 });
  const a1 = X.Faden.abenteuerAnbieten(t.g, plan([{ typ: 'notruf' }, { typ: 'abschluss' }], { titel: "A$'B $& x", anlass: 'Probeanlass ohne Namen im Test' }), { hex: '0305' });
  const a2 = X.Faden.abenteuerAnbieten(t.g, notrufplan(2), { hex: '0305' });
  ok(a1.ok && a2.ok, 'zwei Angebote');
  t.oeffnen(); t.key('KeyO');
  let m = t.m();
  ok(/annehmen/.test(m.brett.hilfe) && /ablehnen/.test(m.brett.hilfe) && m.brett.scheitern === DATEN.werte.scheitern_text.wert, 'ohne Sperre: „wählen · annehmen · ablehnen“, der Scheitern-Satz des Servers geht ins Modell');
  t.key('Enter'); m = t.m();
  ok(m.aktionen.haupt.disabled === true && m.aktionen.haupt.grund === "Erst „A$'B $& x“ abschließen", 'H1: Sperrgrund mit dem Titel „A$\'B $& x“ unverändert: ' + m.aktionen.haupt.grund);
  ok(!/annehmen/.test(m.brett.hilfe) && /ablehnen/.test(m.brett.hilfe) && /kostet nichts/.test(m.brett.hilfe), 'H4: bei gesperrter Annahme entfällt „Ent annehmen“ in der Tastenzeile, „ablehnen kostet nichts“ bleibt sichtbar: ' + m.brett.hilfe);
  ok(m.aktionen.hinweis.text === TEXT.gesperrt && m.aktionen.hinweis.fn === 'warn', 'H4: der Sperrgrund steht sichtbar unter dem Knopf');
}

console.log('\n' + (fails ? fails + ' FEHLER von ' + n : 'alle ' + n + ' Prüfungen ok'));
process.exit(fails ? 1 : 0);
