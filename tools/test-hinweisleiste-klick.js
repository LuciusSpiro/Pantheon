'use strict';
// SPT-01 B: Hinweisleiste der Menüs (Titel, Hauptmenü, Moduswahl, Lobby, Einladung) ist klickbar.
//  1. Jeder Text der Leiste mit Taste hat eine Klickfläche (R.ui.buttons) in derselben Geometrie wie die Zeichnung (Text liegt im Rechteck).
//  2. Der Klick löst dieselbe Action aus wie die Taste (gleiche Aufrufe der view.actions, gleiche Töne, gleicher Menüzustand, gleiche gesendete Nachrichten).
//  3. Zustandsabhängig: ohne eigenen Spieler (M, L, P) bzw. ohne Raumcode (L) tut die Taste nichts, die Leiste hat dort keine Klickfläche.
//  4. Die Beschriftung der Leiste bleibt (die Kappentexte kommen unverändert aus der Texttabelle).
//  5. Mutationsproben: Klickfläche mit falscher Action, Klick ohne Gültigkeitsprüfung, Aktion verändert → der Test wird rot.
//   node tools/test-hinweisleiste-klick.js
const fs = require('fs');
const path = require('path');
const Protocol = require('../shared/protocol.js');
const TOKENS = require('../public/js/menue-tokens.js');
const ROOT = path.join(__dirname, '..');
const ART = require('../public/js/art.js').Art;   // echte Textbreiten der Pixelschrift
const Q = { fluss: path.join(ROOT, 'public', 'js', 'menue.js'), ui: path.join(ROOT, 'public', 'js', 'menue-ui.js') };

let n = 0, fails = 0;
function ok(c, msg) { n++; if (!c) { fails++; console.log('  FEHLER ' + msg); } else console.log('  ok ' + msg); }
function section(name) { console.log('\n[' + name + ']'); }
const lies = (p) => fs.readFileSync(p, 'utf8');
function modul(quelltext) { const m = { exports: {} }; new Function('module', 'exports', 'self', quelltext)(m, m.exports, undefined); return m.exports; }

const AKTIONEN = ['openOptions', 'openHilfe', 'openKammer', 'openWorlds', 'toggleReady', 'copyInvite', 'botPlatzFuellen', 'botLetztenEntfernen', 'setColor', 'sfx'];
// Eine frische Menü-Umgebung: Ablauf (menue.js), Oberfläche (menue-ui.js), Spione auf allen Actions, Render-Attrappe mit Klickliste
function umgebung(q, schirm, o) {
  o = o || {};
  const log = [], gesendet = [];
  const F = modul(q.fluss).erzeuge({
    protokoll: Protocol, senden: (m) => { gesendet.push(m); return true; }, debug: false, szenenIds: () => ['s_eins'], weltstandMax: 5, verlasseRaum: () => { log.push('verlasseRaum'); return true; },
    oeffneKammer: () => true, charaktere: { MAX: 4, neuAnlegen: () => { log.push('neuAnlegen'); return { ok: true }; }, lies: () => ({ liste: [{ id: 'c1' }], gewaehlt: 'c1' }), waehle: (id) => { log.push('waehle:' + id); return { ok: true, id }; } },
  });
  const texte = [], noop = () => {};
  const R = { text: (c, s, x, y) => { texte.push({ s: String(s), x, y }); }, measure: (s, sk) => ART.measureText(String(s), sk || 1), wrap: (s) => [String(s)], shape: noop, ui: { buttons: [], mouse: { x: -1, y: -1 } } };
  const ctx = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop), set: () => true });
  const win = { Render: R, Pult: { rgba: () => '#000000', cham: noop }, Menue: TOKENS, MenueFluss: F, Hud: { fit: (s) => String(s) }, Net: { status: 'open', inviteLink: () => 'http://x/?room=AB', serverRoomCode: o.ohneCode ? '' : 'AB' }, Tasten: { passt: (e, id) => (id === 'charakter.oeffnen' && e.code === 'KeyC') || (id === 'allgemein.hilfe' && e.code === 'KeyH') } };
  new Function('window', 'Net', 'Tasten', q.ui)(win, win.Net, win.Tasten);
  const A = {}; for (const a of AKTIONEN) A[a] = (x) => { log.push(a + (x !== undefined ? ':' + x : '')); };
  const lob = { startMission: 'eisenwald', worlds: [], laborAn: false };
  const view = { actions: A, pid: o.ohneIch ? 'fremd' : 'p1', state: { lobby: lob, players: [{ id: 'p1', name: 'A', ready: false, connected: true, color: 0 }] } };
  if (schirm === 'titel') F.starte({});
  else if (schirm === 'menue') { F.starte({}); F.weiter(); }
  else if (schirm === 'einladung') F.starte({ link: true });
  else { F.starte({ direkt: true }); if (schirm === 'modus') F.oeffneModusWahl(lob); }
  const zeichne = () => { texte.length = 0; R.ui.buttons.length = 0; win.MenueUi.zeichne(ctx, view); };
  const druecke = (code) => win.MenueUi.taste({ code, key: code, repeat: false }, view);
  // wie Render.clickUi: oberster Treffer
  const klickeAuf = (b) => { const x = b.x + Math.floor(b.w / 2), y = b.y + Math.floor(b.h / 2); for (let i = R.ui.buttons.length - 1; i >= 0; i--) { const t = R.ui.buttons[i]; if (x >= t.x && y >= t.y && x < t.x + t.w && y < t.y + t.h) { t.onClick(); return true; } } return false; };
  const stand = () => JSON.stringify({ log, gesendet, s: F.lies().schirm, m: F.lies().modusOffen, a: F.lies().auswahl });
  return { F, R, view, log, texte, zeichne, druecke, klickeAuf, stand, knoepfe: () => R.ui.buttons.slice() };
}

// Je Bildschirm: [Taste (code), Beschriftung der Leiste (aus der Texttabelle)]
function faelle() {
  const Tx = modul(lies(Q.fluss)).TEXT || {}, H = Tx.hinweise || {}, M = Tx.modus || {}, E = Tx.hinweisEinladung || {};
  return {
    titel: [['KeyC', H.charakter], ['KeyO', H.optionen], ['KeyH', H.hilfe]],
    menue: [['KeyC', H.charakter], ['KeyO', H.optionen], ['KeyH', H.hilfe], ['Escape', H.zurueck]],
    modus: [['Enter', M.enter], ['KeyF', M.weltstaende], ['Escape', M.esc]],
    lobby: [['Enter', H.bereit], ['KeyC', H.charakter], ['KeyM', H.modus], ['KeyL', H.link], ['Escape', H.menue], ['KeyP', H.bot], ['KeyH', H.hilfe], ['KeyO', H.optionen]],
    einladung: [['KeyN', E.neu], ['KeyC', E.liste], ['Enter', E.anBord], ['Escape', E.abbrechen]],
  };
}

function pruefe(q, laut) {
  let schlecht = 0;
  const p = (c, msg) => { if (laut) ok(c, msg); else if (!c) schlecht++; };
  const F0 = faelle();

  // 4 Beschriftung
  p(Object.values(F0).every((l) => l.every(([, t]) => typeof t === 'string' && t.length)), 'Texte der Leiste kommen aus der Texttabelle (alle gefunden)');
  const quelle = q.ui.replace(/\/\/.*$/gm, '');
  p(/T\.hinweise\.charakter, 'charakter'/.test(quelle) && /T\.hinweise\.hilfe, 'hilfe'/.test(quelle), 'Leiste zeichnet weiter die Texte der Tabelle (Kappe + Text), jetzt mit Action-ID');

  for (const [schirm, liste] of Object.entries(F0)) {
    for (const [code, text] of liste) {
      // Tastenpfad
      const a = umgebung(q, schirm); a.zeichne(); const vorher = a.stand(); a.druecke(code); const taste = a.stand();
      // Klickpfad
      const b = umgebung(q, schirm); b.zeichne(); const treffer = b.knoepfe().filter((k) => k.label === text);
      const k = treffer[0];
      p(treffer.length === 1, schirm + ' „' + text + '“: genau eine Klickfläche (' + treffer.length + ')');
      if (!k) continue;
      const t = b.texte.find((x) => x.s === text && x.x >= k.x && x.x < k.x + k.w && x.y >= k.y && x.y < k.y + k.h);
      p(!!t && t.x >= k.x && t.x < k.x + k.w && t.y >= k.y && t.y < k.y + k.h, schirm + ' „' + text + '“: der gezeichnete Text liegt in der Klickfläche');
      const ging = b.klickeAuf(k), klick = b.stand();
      p(ging && taste !== vorher && klick === taste, schirm + ' „' + text + '“: Klick = Taste ' + code + ' → ' + (JSON.parse(taste).log.slice(-2).join(',') || JSON.parse(taste).s + (JSON.parse(taste).m ? '/modus' : '')));
    }
  }

  // 3 Zustandsabhängigkeit: ohne eigenen Spieler tun M, L, P nichts; ohne Raumcode tut L nichts → keine Klickfläche
  for (const [code, text, opt, wie] of [['KeyM', F0.lobby[2][1], { ohneIch: true }, 'ohne Spieler'], ['KeyL', F0.lobby[3][1], { ohneIch: true }, 'ohne Spieler'], ['KeyP', F0.lobby[5][1], { ohneIch: true }, 'ohne Spieler'], ['KeyL', F0.lobby[3][1], { ohneCode: true }, 'ohne Raumcode']]) {
    const a = umgebung(q, 'lobby', opt); a.zeichne(); const vorher = a.stand(); a.druecke(code);
    p(a.stand() === vorher, 'Lobby ' + wie + ': Taste ' + code + ' tut nichts');
    p(!a.knoepfe().some((k) => k.label === text), 'Lobby ' + wie + ': „' + text + '“ hat keine Klickfläche');
  }
  // Titel/Menü ohne die Action (z. B. Hilfe nicht verdrahtet): Taste und Klickfläche fehlen gemeinsam
  { const a = umgebung(q, 'titel'); delete a.view.actions.openHilfe; a.zeichne(); const vorher = a.stand(); a.druecke('KeyH');
    p(a.stand() === vorher && !a.knoepfe().some((k) => k.label === F0.titel[2][1]), 'Titel ohne openHilfe: Taste und Klickfläche fehlen gemeinsam'); }
  return schlecht;
}

const quellen = { fluss: lies(Q.fluss), ui: lies(Q.ui) };
section('Hinweisleiste: Klick = Taste');
pruefe(quellen, true);

section('Mutationsproben');
const MUT = [
  ['Klickfläche „Optionen“ ruft die Action „Hilfe“', "if (an) klick(r, t, () => tue(id, view));", "if (an) klick(r, t, () => tue(id === 'optionen' ? 'hilfe' : id, view));"],
  ['Klick ohne Gültigkeitsprüfung (Link ohne Raumcode)', "const an = !!id && gilt(id, view),", "const an = !!id,"],
  ['Klick auf „zurück“ tut nichts, die Taste schon', "if (an) klick(r, t, () => tue(id, view));", "if (an) klick(r, t, () => { if (id === 'zurueck') return; tue(id, view); });"],
  ['Taste „Hilfe“ löst nicht mehr über die gemeinsame Aktion aus', "if (hilfe) { tue('hilfe', view); return true; }", "if (hilfe) { view.actions.openOptions(); return true; }"],
];
for (const [name, von, nach] of MUT) {
  if (quellen.ui.split(von).length !== 2) { ok(false, 'Mutation nicht anwendbar: ' + name); continue; }
  const schlecht = pruefe({ fluss: quellen.fluss, ui: quellen.ui.replace(von, () => nach) }, false);
  ok(schlecht > 0, 'Mutation macht den Test rot (' + schlecht + ' Fehler): ' + name);
}
ok(pruefe(quellen, false) === 0, 'unveränderter Quelltext besteht still');

console.log(fails ? '\n' + fails + ' FEHLER' : '\nHINWEISLEISTE-KLICK OK (' + n + ' Prüfungen)');
process.exit(fails ? 1 : 0);
