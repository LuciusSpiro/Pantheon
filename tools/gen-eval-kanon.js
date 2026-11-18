'use strict';
// BOT-04 A3: erzeugt tools/fixtures/bot-eval/eval-kanon.json aus content/bots/kanon.json (wiederholbar, ohne Zufall).
//   node tools/gen-eval-kanon.js            schreibt die Datei
//   node tools/gen-eval-kanon.js --pruefen  Exit 1, wenn die Datei nicht dem Stand des Generators entspricht (Selbsttest)
// Faelle (Format wie eval.json: { text, art: positiv | stt-fehler | negativ, erwartet: { befehl, args } | null, form }):
//   positiv      jede Sprechform und Kurzform: pur, klein mit Punkt, mit "bitte", mit Adressierung vorn und hinten; nav.abstand mit Meterangabe
//   stt-fehler   abgeleitet aus den bekannten Fehlern: Lexikon (Backboard/Backbord, Wolle/Volle, Cours/Kurs, Wortgrenzen) und mechanisch fuer
//                Woerter ab 7 Buchstaben: letzter Buchstabe weg, Buchstabendreher in der Mitte, Buchstabe in der Mitte weg, zwei Woerter
//                zusammengezogen. Kurze Woerter (bis 6 Buchstaben, z. B. Kuppel, Sensor, Heck) bekommen nur Lexikonfehler.
//   negativ      Beinahe-Treffer: fehlendes Argument, ungueltiger Wert, Verneinung, Frage, zwei Argumente, falsche Rolle, Fremdsprache,
//                zu langer Text, Zusatzwoerter, nav.sprung (nicht sprechbar)
const fs = require('fs');
const path = require('path');
const M = require('../shared/bot-matcher.js');

const ZIEL = path.join(__dirname, 'fixtures', 'bot-eval', 'eval-kanon.json');
const norm = M._intern.norm;

const ROLLE = { navigation: 'Navigation', ops: 'Ops', technik: 'Technik', bord: 'Bord', alle: 'Crew' };
const ROLLE_FALSCH = { navigation: 'Technik', ops: 'Navigation', technik: 'Ops', bord: 'Technik' };

// bekannte und wahrscheinliche STT-Fehler je Wort (Erkundung Frage 6a und Entwicklungssets): Wort (klein) -> Varianten
const LEXIKON = {
  backbord: ['Backboard', 'Bagbord', 'Back Bord'],
  steuerbord: ['Steuerboard', 'Steuer Bord', 'Steuerbort'],
  volle: ['Wolle'],
  kurs: ['Cours'],
  feuer: ['Feier'],
  maschinen: ['Maschienen'],
  stopp: ['Stop'],
  markierung: ['Markirung'],
  person: ['Persohn'],
  fracht: ['Fraght'],
  torpedo: ['Torpedoh'],
  antrieb: ['Antrib'],
  schilde: ['Schielde'],
  reaktor: ['Reaktohr'],
  landepunkt: ['Lande Punkt'],
  'außenteam': ['Außen Team'],
  statusbericht: ['Status Bericht'],
  'ausweichmanöver': ['Ausweich Manöver'],
  bug: ['Buk'],
  heck: ['Hek'],
  null: ['Nul'],
};

// ungueltige Argumentwerte je Argumentname
const UNGUELTIG = {
  sektor: ['Mitte', 'Oben', 'Unten'],
  ziel: ['Concordia', 'den Hafen', 'Hex fünf', 'Objekt drei'],
  stufe: ['Schub sieben', 'Stufe sieben', 'Schub zehn'],
  waffen: ['Laser'],
  was: ['Tiere'],
  system: ['Kombüse', 'Lafette vier', 'Modul fünf', 'Sensor'],
};

const SPRUNG = ['Sprung nach Hex fünf', 'Sprung zur Basis', 'Springe zur Markierung', 'Sprung Hex 12', 'Schnellsprung', 'Navigation, Sprung zur Markierung'];

const NICHT_ZUSAMMEN = new Set(['auf', 'die', 'das', 'den', 'der', 'zur', 'zum', 'null', 'eins', 'zwei', 'drei', 'vier', 'fuenf', 'sechs', 'sieben', 'neun']);
function wortliste(t) { return t.split(' ').filter(Boolean); }
function ersetzeWort(text, i, neu) { const w = wortliste(text); w[i] = neu; return w.join(' '); }

function sttVarianten(text) {
  const out = new Set();
  const w = wortliste(text);
  w.forEach((wort, i) => {
    const k = wort.toLowerCase();
    for (const v of LEXIKON[k] || []) out.add(ersetzeWort(text, i, i === 0 ? v : v.toLowerCase() === v ? v : v));
    const n = norm(wort);
    if (n.length >= 7) {
      out.add(ersetzeWort(text, i, wort.slice(0, -1)));                                   // Endung weg
      const m = Math.floor(wort.length / 2);
      out.add(ersetzeWort(text, i, wort.slice(0, m - 1) + wort[m] + wort[m - 1] + wort.slice(m + 1)));   // Dreher
      out.add(ersetzeWort(text, i, wort.slice(0, m) + wort.slice(m + 1)));                // Buchstabe weg
    }
  });
  for (let i = 0; i + 1 < w.length; i++) {                                                // Wortgrenze: zwei Woerter zusammen (nicht mit Fuellwoertern und Zahlwoertern: "zwei" und "drei" sind nach dem Zusammenziehen nicht mehr unterscheidbar)
    const a = norm(w[i]), b = norm(w[i + 1]);
    if (a.length >= 3 && b.length >= 5 && !NICHT_ZUSAMMEN.has(a) && !NICHT_ZUSAMMEN.has(b)) out.add(w.slice(0, i).concat([w[i] + w[i + 1].toLowerCase()], w.slice(i + 2)).join(' '));
  }
  out.delete(text);
  return Array.from(out);
}

function erzeuge() {
  const formen = M.formen();
  const bekannt = new Set();   // normalisierte Texte aller Sprech- und Kurzformen (nie als Negativfall)
  for (const f of formen) for (const t of [f.anzeige].concat(f.kurz)) bekannt.add(norm(t));
  const faelle = []; const gesehen = new Set();
  const add = (text, art, erwartet, form) => {
    const key = art + '|' + text + '|' + JSON.stringify(erwartet);
    if (gesehen.has(key)) return; gesehen.add(key);
    if (art === 'negativ' && bekannt.has(norm(text))) return;
    faelle.push({ text, art, erwartet, form });
  };
  const erw = (f, extra) => ({ befehl: f.befehl, args: Object.assign({}, f.args, extra || {}) });

  for (const f of formen) {
    const R = ROLLE[f.an];
    for (let idx = 0; idx <= f.kurz.length; idx++) {
      const t = idx === 0 ? f.anzeige : f.kurz[idx - 1];
      const e = erw(f);
      add(t, 'positiv', e, f.anzeige);
      add(t.toLowerCase() + '.', 'positiv', e, f.anzeige);
      add(R + ', ' + t, 'positiv', e, f.anzeige);
      if (idx === 0) {
        add('Bitte ' + t, 'positiv', e, f.anzeige);
        add(t + ' bitte', 'positiv', e, f.anzeige);
        add(t + ', ' + R, 'positiv', e, f.anzeige);
        add(R + ', bitte ' + t, 'positiv', e, f.anzeige);
      }
      if (f.meter && idx === 0) {
        add(t + ' 500 Meter', 'positiv', erw(f, { meter: 500 }), f.anzeige);
        add(R + ', ' + t + ' fünfzig Meter', 'positiv', erw(f, { meter: 50 }), f.anzeige);
      }
    }
    for (const v of sttVarianten(f.anzeige)) add(v, 'stt-fehler', erw(f), f.anzeige);
  }

  // Negativfaelle je Eintrag mit Schablone (fehlendes Argument, ungueltiger Wert, zwei Argumente)
  const kan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'bots', 'kanon.json'), 'utf8'));
  for (const e of kan.befehle) {
    const sk = Object.keys(e.args || {}).find((k) => typeof e.args[k] === 'string' && /^\{[a-z_]+\}$/.test(e.args[k]));
    if (!sk) continue;
    const name = e.args[sk].slice(1, -1);
    const tpl = e.anzeige;
    const ohne = tpl.split('{' + name + '}').join('').replace(/\s+/g, ' ').trim();
    if (ohne) add(ohne, 'negativ', null, e.befehl + ' ohne ' + name);
    for (const s of UNGUELTIG[sk] || []) add(tpl.split('{' + name + '}').join(s), 'negativ', null, e.befehl + ' ungueltig');
    const ws = Object.keys(e.werte[name]);
    if (ws.length >= 2) {
      const paare = [[ws[0], ws[1]], [ws[0], ws[ws.length - 1]]];
      for (const [a, b] of paare) add(tpl.split('{' + name + '}').join(e.werte[name][a].wort + ' und ' + e.werte[name][b].wort), 'negativ', null, e.befehl + ' zwei Argumente');
    }
  }

  // Negativfaelle je Sprechform
  for (const f of formen) {
    const t = f.anzeige, R = f.an !== 'alle' ? ROLLE_FALSCH[f.an] : null;
    add('Nicht ' + t, 'negativ', null, f.anzeige);
    add(t + ' nicht', 'negativ', null, f.anzeige);
    add('Auf keinen Fall ' + t, 'negativ', null, f.anzeige);
    add('Kannst du bitte ' + t + '?', 'negativ', null, f.anzeige);
    add('Warum ' + t + '?', 'negativ', null, f.anzeige);
    add('Wer soll ' + t + '?', 'negativ', null, f.anzeige);
    if (R) { add(R + ', ' + t, 'negativ', null, f.anzeige); add(t + ', ' + R, 'negativ', null, f.anzeige); }
    add('Please ' + t, 'negativ', null, f.anzeige);
    add(t + ' und ich glaube wir sollten danach noch einen Kaffee holen', 'negativ', null, f.anzeige);
    add('Vielleicht ' + t, 'negativ', null, f.anzeige);
    add(t + ' wäre gut', 'negativ', null, f.anzeige);
    add('Wir sollten ' + t + ' irgendwann', 'negativ', null, f.anzeige);
    if (f.befehl !== 'nav.abstand') add(t + ' 500 Meter', 'negativ', null, f.anzeige);
  }
  for (const t of SPRUNG) add(t, 'negativ', null, 'nav.sprung');
  return faelle;
}

const faelle = erzeuge();
const text = JSON.stringify(faelle, null, 1) + '\n';
if (process.argv.includes('--pruefen')) {
  let alt = '';
  try { alt = fs.readFileSync(ZIEL, 'utf8').replace(/\r\n/g, '\n'); } catch (e) { /* fehlt */ }
  if (alt !== text) { console.error('eval-kanon.json entspricht nicht dem Generator (node tools/gen-eval-kanon.js)'); process.exit(1); }
  console.log('eval-kanon.json aktuell (' + faelle.length + ' Faelle)');
} else {
  fs.writeFileSync(ZIEL, text);
  const je = {}; for (const f of faelle) je[f.art] = (je[f.art] || 0) + 1;
  console.log('eval-kanon.json: ' + faelle.length + ' Faelle ' + JSON.stringify(je));
}
