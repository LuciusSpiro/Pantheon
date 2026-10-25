'use strict';
// SUND-03b P: Preisfaktor der Verbrauchsgüter im Hafenterminal (nur Freie Fahrt Sund, game.weltsim). Action-Layer, liest die Sim nur, speichert nichts:
// der Faktor ist abgeleitet aus dem Sim-Zustand (Embargo, Belagerung, Vorrat) und ändert sich daher nur, wenn die Sim tickt (Sprung), nie während das Terminal offen ist.
// Alle Zahlen und Texte stehen in content/welt/preise-werte.json. Werft-Preise (server/sim/werft.js) kennen diese Schicht nicht und bleiben fest.
//   faktorAus(zustand, artikelId, hex)   reiner Kern (Sim-Zustand, ohne Spiel; Messung und Tests) -> { faktor, gruende: [Schlüssel] }
//   lageFuer(game, artikelId, ctx)       dasselbe für den Hafen, an dem die Lerche liegt (Spiel: weltsim, Dock, Kontext)
//   faktorFuer(game, artikelId, hex)     nur die Zahl, für den Hafen hex (1 ohne Weltsim)
//   preisFuer(game, entry, ctx)          der Kaufpreis (Marken, ganze Zahl >= 1): Terminal und shop.buy rechnen mit dieser einen Funktion
//   snapshot(game, ctx)                  { artikel: [preis, hinweis] } nur für Artikel mit Faktor != 1, sonst null (kein Byte im Snapshot)
const Daten = require('../weltsim/daten.js');
const Kern = require('../weltsim/kern.js');
const Wirkungen = require('../weltsim/wirkungen.js');
const Sektoren = require('../../shared/sektoren.js');

const W = require('../../content/welt/preise-werte.json').werte;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const artikelDaten = (id) => (has(W.artikel.wert, id) ? W.artikel.wert[id] : null);
const klemme = (f) => Math.min(W.faktor_grenzen.wert.max, Math.max(W.faktor_grenzen.wert.min, f));
const rund = (x) => Math.round(x * 1e6) / 1e6;   // Summen wie 1 + 0,3 - 0,2 ohne Gleitkomma-Rest

// Reiner Kern: Faktor eines Artikels im Hafen hex nach dem Zustand der Sim.
function faktorAus(z, artikelId, hex) {
  const ohne = { faktor: 1, gruende: [] };
  const a = artikelDaten(artikelId);
  if (!a || a.verbrauchsgut !== true || !z || !z.hexe || !has(z.hexe, hex)) return ohne;
  const d = Daten.datenVon(z);
  if (!d.hex[hex] || d.hex[hex].hafen === '') return ohne;   // nur Häfen: kein Posten, kein freies Hex
  const besitzer = z.hexe[hex].besitzer;
  if (!besitzer || W.neutrale_besitzer.wert.includes(besitzer)) return ohne;
  let summe = 1; const gruende = [];
  if (Kern.BEFEHLE.embargoAktiv(z, besitzer) && a.gut && z.embargo[besitzer].waren.includes(a.gut)) { summe += W.embargo.wert.zuschlag; gruende.push('embargo'); }
  const B = W.belagerung.wert;
  if (Wirkungen.belagerungen(z, hex).length) { summe += B.hafen; gruende.push('belagerung'); }
  else if (d.codes.some((c) => c !== hex && Daten.abstand(d, hex, c) <= B.radius && Wirkungen.belagerungen(z, c).length)) { summe += B.umkreis; gruende.push('umkreis'); }
  const V = W.vorrat.wert;
  if (a.gut === V.gut && z.vorrat && z.vorrat[besitzer] && Number.isFinite(z.vorrat[besitzer][V.gut])) {
    const v = z.vorrat[besitzer][V.gut];
    if (v <= V.knapp.bis) { summe += V.knapp.zuschlag; gruende.push('vorrat_knapp'); }
    else if (v >= V.reichlich.ab) { summe += V.reichlich.zuschlag; gruende.push('vorrat_reichlich'); }
  }
  return { faktor: klemme(rund(summe)), gruende };
}

const zustandVon = (game) => (game && game.weltsim && game.weltsim.zustand) || null;
const hexVon = (game) => (game.ship && game.ship.docked ? Sektoren.hexVonOrt(game.ship.dockedAt) : null);

function lageFuer(game, artikelId, ctx) {
  const z = zustandVon(game), hex = hexVon(game);
  if (!z || !hex || W.kontexte_ohne.wert.includes(ctx)) return { faktor: 1, gruende: [] };
  return faktorAus(z, artikelId, hex);
}

function faktorFuer(game, artikelId, hex) {
  const z = zustandVon(game);
  return z ? faktorAus(z, artikelId, hex).faktor : 1;
}

// Grundpreis des Kontexts (die Karawane hat eigene Preise)
const grundpreis = (entry, ctx) => (ctx === 'vaelen' && entry.priceVaelen != null ? entry.priceVaelen : entry.price);

function preisFuer(game, entry, ctx) {
  const p = grundpreis(entry, ctx);
  const f = lageFuer(game, entry.id, ctx).faktor;   // 1 für alles, was kein Verbrauchsgut ist (faktorAus)
  return f === 1 ? p : Math.max(1, Math.round(p * f));
}

// Vorzeichen, mit dem ein Treiber auf den Faktor wirkt (aus den Daten: + teurer, - günstiger)
function vorzeichenVon(grund) {
  const B = W.belagerung.wert, V = W.vorrat.wert;
  const z = { embargo: W.embargo.wert.zuschlag, belagerung: B.hafen, umkreis: B.umkreis, vorrat_knapp: V.knapp.zuschlag, vorrat_reichlich: V.reichlich.zuschlag }[grund];
  return Math.sign(z || 0);
}
// Hinweis: Grundtext nach der Richtung der PREISÄNDERUNG (preis gegen Grundpreis), genannt werden nur die Treiber mit diesem Vorzeichen (bei „Belagerung in der Nähe“ und „Munition reichlich“ zugleich steht nie „günstiger: Belagerung …“)
function hinweisText(game, richtung, gruende) {
  const T = W.texte.wert, z = zustandVon(game), hex = hexVon(game);
  const wer = z && hex && z.hexe[hex] ? W.fraktionen.wert[z.hexe[hex].besitzer] || '' : '';
  const nenne = gruende.filter((g) => vorzeichenVon(g) === richtung);
  return (richtung > 0 ? T.teurer : T.billiger) + ': ' + nenne.map((g) => (T[g] || g).replace('{fraktion}', wer)).join(', ');
}

function snapshot(game, ctx) {
  if (!zustandVon(game) || !hexVon(game) || !game.C || !Array.isArray(game.C.shop)) return null;
  let out = null;
  for (const e of game.C.shop) {
    const l = lageFuer(game, e.id, ctx);
    const preis = preisFuer(game, e, ctx), grund = grundpreis(e, ctx);
    if (preis === grund) continue;   // kein Faktor oder der gerundete Preis ändert sich nicht: kein Hinweis (nichts, was er erklären könnte)
    (out || (out = {}))[e.id] = [preis, hinweisText(game, Math.sign(preis - grund), l.gruende)];
  }
  return out;
}

module.exports = { vorzeichenVon, faktorAus, lageFuer, faktorFuer, preisFuer, snapshot, WERTE: W };
