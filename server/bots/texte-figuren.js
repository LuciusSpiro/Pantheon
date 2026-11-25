'use strict';
// BOT-05 A3: Antworttexte je Figur (content/bots/texte-figuren.json). Einzige Stelle, die entscheidet, welche Liste ein Bot fuer eine textId spricht; annahme.js (Server-Text) und tools/bot-clips.js (Clip-Vorrat) fragen beide hier, damit Text und Clip denselben Index meinen.
//   listeFuer(botId, textId, texte?, daten?)  die Textliste: Figurliste, sonst die Grundliste aus texte.json (texte), sonst null
//   figurListe(botId, textId, daten?)         nur die Figurliste oder null
//   schluesselFuer(textId, daten?)            der Schluessel der Datei, der die textId abdeckt (exakt, sonst das spezifischste Muster) oder null
//   pruefe(daten)                             Liste der Formatfehler (leer = gueltig); der Loader wirft beim Start bei jedem Fehler
// Schluessel: exakte textId oder Muster mit * (= beliebiger Text). Bei mehreren Treffern gewinnt der Schluessel mit den meisten festen Zeichen.
const TEXTE = require('../../content/bots/texte.json');
const FORMAT = 'bot-texte-figuren/1';
const hat = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const istObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function pruefe(daten) {
  const f = [];
  if (!istObjekt(daten) || daten.format !== FORMAT) return ['Format ist nicht ' + FORMAT];
  if (!istObjekt(daten.figuren)) return ['figuren fehlt'];
  for (const [botId, liste] of Object.entries(daten.figuren)) {
    if (!/^b\d$/.test(botId)) f.push('botId ' + botId + ' hat falsche Form');
    if (!istObjekt(liste)) { f.push(botId + ': kein Objekt'); continue; }
    for (const [schl, l] of Object.entries(liste)) {
      if (!Array.isArray(l) || l.length < 2 || l.some((t) => typeof t !== 'string' || t.trim().length < 3)) f.push(botId + ' ' + schl + ': mindestens 2 Texte');
    }
  }
  return f;
}

// Aus den Schluesseln einer Figur: [{ schl, re, fest }] nach festen Zeichen absteigend (exakte Schluessel haben alle Zeichen fest)
function baueRegeln(schluessel) {
  return schluessel.map((schl) => {
    const teile = schl.split('*');
    const re = new RegExp('^' + teile.map((t) => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$');
    return { schl, re, fest: teile.join('').length, exakt: teile.length === 1 };
  }).sort((a, b) => (b.exakt - a.exakt) || (b.fest - a.fest));
}
const CACHE = new WeakMap();   // daten -> Map(botId -> Regeln)
function regeln(daten, botId) {
  let m = CACHE.get(daten); if (!m) { m = new Map(); CACHE.set(daten, m); }
  let r = m.get(botId);
  if (!r) { r = baueRegeln(Object.keys(daten.figuren[botId])); m.set(botId, r); }
  return r;
}

function standard() {
  const daten = require('../../content/bots/texte-figuren.json');
  const fehler = pruefe(daten);
  if (fehler.length) throw new Error('content/bots/texte-figuren.json ungueltig:\n  ' + fehler.join('\n  '));
  return daten;
}
const DATEN = standard();

function schluesselFuer(textId, daten, botId) {
  daten = daten || DATEN;
  const ids = botId && hat(daten.figuren, botId) ? [botId] : Object.keys(daten.figuren);
  for (const b of ids) { const t = regeln(daten, b).find((r) => r.re.test(textId)); if (t) return t.schl; }
  return null;
}
function figurListe(botId, textId, daten) {
  daten = daten || DATEN;
  if (typeof botId !== 'string' || typeof textId !== 'string' || !hat(daten.figuren, botId)) return null;
  const t = regeln(daten, botId).find((r) => r.re.test(textId));
  return t ? daten.figuren[botId][t.schl] : null;
}
function listeFuer(botId, textId, texte, daten) {
  const fl = figurListe(botId, textId, daten);
  if (fl && fl.length) return fl;
  const t = texte || TEXTE;
  return hat(t, textId) && Array.isArray(t[textId]) && t[textId].length ? t[textId] : null;
}

module.exports = { listeFuer, figurListe, schluesselFuer, pruefe, DATEN, FORMAT };
