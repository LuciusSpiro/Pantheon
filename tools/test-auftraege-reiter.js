'use strict';
// SPT-02 5 (A Notrufe: Reiter „Aufträge“): Captain-Reiter 6 heißt „Aufträge“ und hat zwei Tabs, „Aktive Missionen“ und „Notrufe“ (public/js/notrufe.js, Frontend-Layer, keine neuen Snapshot-Felder).
//   A: Daten der Tabs (laufende Fäden samt Notruf-Fäden, aktive klassische Missionen, zuletzt-Pseudo-Eintrag; Kampagnen- und Takt-Notrufe, Brett-Angebote)
//   B: „Marke ohne Eintrag unmöglich“: jede Notruf-Marke (Takt reise:nN und Kampagne notruf:<id>) hat genau einen Eintrag im Tab „Notrufe“, auch mit drei laufenden Abenteuern (echter Server + echter Brett-Client)
//   H: Karte (starmap.js markeAn: die Plakette unter dem Klick) · C: Karten-Klick (oeffne): Tab „Notrufe“, Eintrag gewählt und gezeichnet · D: Tasten (Tab-Wechsel, Wahl, Enter/X nur beim Kampagnen-Notruf, Pseudo-Eintrag nicht annehmbar)
//   E: Anzeige (Tab-Leiste, Texte, Platz bei vielen Einträgen) · F: Benennung („Aufträge“ in Konsole, Pult und Tastenbelegung) · G: Takt-Notruf nicht im Reiter annehmbar (kein Befehl)
//   node tools/test-auftraege-reiter.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
process.chdir(path.join(__dirname, '..'));
const F = require('./regie-fixture.js');
const Sektoren = require('../shared/sektoren.js');
const RE = require('../server/sim/reise-ereignis.js');
const Faden = require('../server/sim/faden.js');
const Brett = require('../server/sim/abenteuer-brett.js');
const Marken = require('../server/sim/marken.js');
const Notrufe = require('../server/sim/notrufe.js');
const BrettClient = require('../public/js/brett.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); f(); };
const ENV = { FAEDEN: '1', REISE_EREIGNISSE: '1', LAGE_SPIELLEITER: '1', SPIELLEITER_RUECKFALL: '1' };
const Fz = (g) => Faden.zustandVon(g);
const R = (g) => g.weltsim.reise;
const NOTRUF = RE.KATALOG.find((e) => e.art === 'notruf' && !e.gefahr);
const NOTRUF_HEXE = ['0603', '0504', '0403', '0105', '0803'];
const klon = (x) => JSON.parse(JSON.stringify(x));
const plan = (i) => ({ format: 'faden-bauplan/1', titel: 'Auftrag Nummer ' + i, anlass: 'Ein Test ohne Namen fuer das Brett.', beats: [{ typ: 'geruecht' }, { typ: 'abschluss' }], volk_erlaubt: ['rom'] });
const QUELLE = fs.readFileSync('public/js/notrufe.js', 'utf8');

// Der Client wie im Browser (Render-Stub zeichnet nur Text/Knöpfe mit); Brett ist der ECHTE Client-Code (public/js/brett.js), StarMap hält die Marken.
function client(opt) {
  opt = opt || {};
  BrettClient.store.abenteuer = null;   // das Modul hält den Block global: jeder Client beginnt leer
  const gez = [], knoepfe = [], flaechen = [];
  const win = {
    Render: { PAL: { brass: '#a', panelLight: '#b', mint: '#c', amber: '#d', red: '#e', star: '#f', ice: '#g' }, text: (c, t) => gez.push(String(t)), button: (c, x, y, w, h, t) => knoepfe.push(String(t)), wrap: (t) => [String(t)], measure: (t) => String(t).length * 5, ui: { buttons: flaechen } },
    Brett: BrettClient, StarMap: { marken: [] }, Shared_Sektoren: { hexName: (h) => 'Hex' + h },
    Consoles: opt.buch ? { bookEntries: () => ({ list: opt.buch }) } : undefined,
    performance: { now: () => 1000 },
  };
  win.window = win;
  vm.runInNewContext(QUELLE, win);
  const ctx = { fillRect() {}, strokeRect() {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {} };
  const befehle = [];
  const cmd = (c, e) => befehle.push(c + (e && e.id != null ? ':' + e.id : ''));
  const zeichne = (view) => { gez.length = 0; knoepfe.length = 0; flaechen.length = 0; const h = win.NotrufView.drawCaptain(ctx, view, { x: 0, y: 0, w: 564, h: 238 }, cmd); return { bild: gez.join('|'), knoepfe: knoepfe.slice(), hinweis: h }; };
  return { win, V: win.NotrufView, view: { state: { nr: [] } }, befehle, cmd, zeichne, gez, knoepfe, flaechen };
}
const setzeWelt = (c, g, opt) => {   // Server-Stand -> Client-Stand (Brett-Block, Marken, nr), wie der Snapshot ihn liefert
  opt = opt || {};
  c.win.Brett.store.abenteuer = Brett.snapshot(g);
  c.win.StarMap.marken = Marken.snapshot(g).filter((m) => m.id);
  c.view.state = { nr: Notrufe.snapshot(g) || [] };
};

// ---- Server-Stand: Takt-Notrufe wie reise-ereignis.js ausloesenTaktNotruf sie anlegt (Eintrag, Marke, Brett-Angebot)
function neu() {
  const g = F.neuesSpiel({ crew: 1, seed: 7, env: ENV }).g;
  g.weltsim.zustand.flotten = [];
  g.ship.scene = Sektoren.ortVonHex('0305');
  Fz(g).abenteuerAngebote.length = 0;
  return g;
}
function regulaer(g, i) {
  const r = Faden.abenteuerAnbieten(g, plan(i), { hex: '0305' });
  if (!r.ok) return null;
  return Brett.annehmen(g, 'a' + r.angebot.nr) === null ? Fz(g).liste.find((x) => x.plan && !x.notruf && x.vorlage === r.angebot.ref) : null;
}
function takt(g, i, mitAngebot) {
  const nr = 100 + i, marke = 'reise:n' + nr, hex = NOTRUF_HEXE[i % NOTRUF_HEXE.length];
  R(g).offen.push({ nr, id: NOTRUF.id, hex, bis: Number.MAX_SAFE_INTEGER, bisUhr: R(g).taktUhr + 1e9, marke, ev: { nr, id: NOTRUF.id, hex, art: 'notruf' }, takt: true });
  Marken.setze(g, { id: marke, typ: 'notruf', hex, ticks: 30 });
  const a = mitAngebot ? Brett.notrufAnbieten(g, { nr, id: NOTRUF.id, hex, variante: NOTRUF.parameter.variante, sprecher: 'Probeschiff ' + i, marke, ankunft: '0305' }) : null;
  return { marke, hex, angebot: a };
}
const notrufMarken = (g) => Marken.snapshot(g).filter((m) => m.t === 'notruf');

section('A: Daten der Tabs', () => {
  const c = client({ buch: [{ id: 'm1', title: 'Funkspruch nach Concordia', state: 'aktiv', kind: 'mission', von: 'Hafenmeisterei' }, { id: 'm2', title: 'Alt', state: 'erledigt', kind: 'mission' }, { id: '__planning', pseudo: true, state: 'aktiv', title: 'Lage wird geprüft' }, { id: 'm3', title: 'Angebot', state: 'angeboten', kind: 'nebenauftrag' }] });
  c.win.Brett.store.abenteuer = { ok: 1, kopf: 'Brett', max: 3, angebote: [{ id: 'a9', titel: 'Notruf: Kutter', ort: '0603', ortname: 'X', notruf: 1, vorschau: {} }, { id: 'a8', titel: 'Regulaeres Angebot', ort: '0201', ortname: 'Y', vorschau: {} }], laufend: [
    { id: 'f1', titel: 'Geleit nach Ostia', ort: '0305', schritt: 1, schritte_gesamt: 3, schritt_text: 'Geleit', ph: 'laeuft', rest: 4 },
    { id: 'f2', notruf: 1, titel: 'Notruf: Kutter Fortuna', ort: '0504', schritt: 1, schritte_gesamt: 3, ph: 'wartet', rest: 2 }],
  zuletzt: { titel: 'Altes Geleit', ausgang: 'gelungen', text: 'Geschafft.' } };
  c.win.StarMap.marken = [{ h: '0603', t: 'notruf', id: 'reise:n5', b: 600, g: 900 }, { h: '0105', t: 'notruf', id: 'notruf:sl_klar', b: 300 }, { h: '0404', t: 'ziel' }, { h: '0201', t: 'fund', id: 'fund:x' }];
  c.view.state = { nr: [{ i: 'sl_klar', h: '0105', k: 'k', z: 0, r: 300 }] };
  const a = c.V.aktiveListe(c.view), nl = c.V.notrufListe(c.view);
  ok(a.map((e) => e.art + ':' + e.i).join() === 'faden:f:f1,faden:f:f2,mission:m:m1,undefined:zuletzt', 'Aktive Missionen: Fäden (auch der Notruf-Faden), aktive Mission (nicht erledigt/angeboten/Planung), dann zuletzt: ' + a.map((e) => e.i).join());
  ok(a[1].notruf === true && a[0].notruf === false, 'der Notruf-Faden ist als Notruf gekennzeichnet');
  ok(a[3].pseudo === true && a[3].ausgang === 'gelungen', 'zuletzt: Pseudo-Eintrag mit Ausgang');
  ok(nl.map((e) => e.art + ':' + e.i).join() === 'kampagne:sl_klar,takt:reise:n5', 'Notrufe: Kampagne zuerst, dann die Takt-Notruf-Marke; Ziel- und Fund-Marken sind keine Notrufe: ' + nl.map((e) => e.i).join());
  ok(nl[1].angebot && nl[1].angebot.id === 'a9' && nl[1].b === 600, 'der Takt-Eintrag trägt das Brett-Angebot am selben Hex und den Rest der Marke');
  // Notruf-Faden am Hex der Marke: der Eintrag weist auf den laufenden Faden
  c.win.StarMap.marken.push({ h: '0504', t: 'notruf', id: 'reise:n6', b: 100 });
  const nl2 = c.V.notrufListe(c.view);
  ok(nl2.length === 3 && nl2[2].faden && nl2[2].faden.id === 'f2' && !nl2[2].angebot, 'angenommener Takt-Notruf: kein Angebot mehr, dafür der laufende Notruf-Faden');
  ok(c.V.liste(c.view.state).length === 1, 'liste(st) bleibt die Kampagnen-Liste (Ops-Knopf)');
  // Brett-Notruf-Angebot ohne Marke bekommt trotzdem einen Eintrag
  c.win.StarMap.marken = [];
  const nl3 = c.V.notrufListe(c.view);
  ok(nl3.length === 2 && nl3[1].art === 'takt' && nl3[1].angebot && nl3[1].angebot.id === 'a9', 'ein Notruf-Angebot ohne Marke steht trotzdem im Tab (nichts am Brett ohne Eintrag), ein regulaeres Angebot nicht');
  c.win.Brett.store.abenteuer = null; c.win.StarMap.marken = []; c.view.state = { nr: [] };
  ok(c.V.aktiveListe(c.view).length === 1 && c.V.notrufListe(c.view).length === 0, 'ohne Brett-Block und Marken: nur die Mission, keine Notrufe, kein Absturz');
});

section('B: Marke ohne Eintrag unmöglich (echter Server, echter Brett-Client)', () => {
  let geprueft = 0, bad = [];
  for (const laufend of [0, 1, 3]) for (const nTakt of [0, 1, 3]) for (const ohneAngebot of [false, true]) for (const kamp of [false, true]) {
    if (nTakt === 0 && ohneAngebot) continue;
    const g = neu();
    for (let i = 0; i < laufend; i++) if (!regulaer(g, i)) bad.push('Abenteuer ' + i + ' nicht angenommen');
    const ts = []; for (let i = 0; i < nTakt; i++) ts.push(takt(g, i, !(ohneAngebot && i === 0)));
    if (nTakt >= 2 && ts[1].angebot) Brett.annehmen(g, 'a' + ts[1].angebot.nr);   // einer angenommen: Notruf-Faden, Marke bleibt
    if (kamp) Notrufe.freischalten(g, 'sl_klar,sl_echt');
    const c = client(); setzeWelt(c, g);
    const marken = notrufMarken(g), liste = c.V.notrufListe(c.view), ids = liste.map((e) => c.V.markeId(e));
    const tag = `laufend ${laufend}, takt ${nTakt}${ohneAngebot ? ' (eines ohne Angebot)' : ''}${kamp ? ', Kampagne' : ''}`;
    const fehlt = marken.filter((m) => !ids.includes(m.id));
    if (fehlt.length) bad.push(tag + ': Marke ohne Eintrag ' + fehlt.map((m) => m.id).join());
    if (new Set(ids).size !== ids.length) bad.push(tag + ': doppelter Eintrag ' + ids.join());
    if (marken.length !== nTakt + (kamp ? 2 : 0)) bad.push(tag + ': erwartet ' + (nTakt + (kamp ? 2 : 0)) + ' Notruf-Marken, gefunden ' + marken.length);
    for (const nrEin of c.view.state.nr) if (!liste.some((e) => e.art === 'kampagne' && e.i === nrEin.i)) bad.push(tag + ': Kampagnen-Notruf ohne Eintrag');
    const aktiv = c.V.aktiveListe(c.view).filter((e) => e.art === 'faden').length;
    if (aktiv !== Fz(g).liste.filter((f) => f.plan && f.phase !== 'abgeschlossen').length) bad.push(tag + ': Fäden im Tab Aktive Missionen ' + aktiv);
    geprueft++;
  }
  ok(bad.length === 0 && geprueft >= 20, `${geprueft} Kombinationen (0/1/3 laufende Abenteuer, 0/1/3 Takt-Notrufe mit und ohne Angebot, Kampagne): jede Marke hat genau einen Eintrag${bad.length ? ': ' + bad.slice(0, 4).join(' | ') : ''}`);
  // drei laufende Abenteuer UND drei Notruf-Fäden (notruf_aktiv_max 3) UND eine Takt-Marke: alle sichtbar, nichts verloren
  const g = neu(); for (let i = 0; i < 3; i++) regulaer(g, i);
  const ts = [0, 1, 2, 3].map((i) => takt(g, i, i < 3)); for (const t of ts.slice(0, 3)) Brett.annehmen(g, 'a' + t.angebot.nr);
  const c = client(); setzeWelt(c, g);
  const l = c.V.aktiveListe(c.view).filter((e) => e.art === 'faden');
  ok(l.length === 6 && l.filter((e) => e.notruf).length === 3, 'drei Abenteuer + drei Notruf-Fäden: sechs Fäden im Tab Aktive Missionen, drei davon Notruf (' + l.length + ')');
  ok(c.V.notrufListe(c.view).length === 4 && c.V.notrufListe(c.view).filter((e) => e.faden).length === 3 && c.V.notrufListe(c.view).filter((e) => !e.faden && !e.angebot).length === 1, 'vier Takt-Marken: drei angenommen (Faden), eine ohne Angebot, alle mit Eintrag');
});

section('C: Karten-Klick öffnet den Eintrag (oeffne)', () => {
  const g = neu(); for (let i = 0; i < 3; i++) regulaer(g, i);
  const ts = [takt(g, 0, true), takt(g, 1, false)]; Notrufe.freischalten(g, 'sl_klar,sl_echt');
  const c = client(); setzeWelt(c, g);
  ok(c.V.zustand().tab === 'aktiv', 'Anfangs steht der Tab Aktive Missionen');
  for (const m of notrufMarken(g)) {
    c.V.setzeTab('aktiv');
    ok(c.V.oeffne(m.id) === true && c.V.zustand().tab === 'notruf', `Klick auf ${m.id}: Tab Notrufe`);
    const e = c.V.notrufListe(c.view).find((x) => c.V.markeId(x) === m.id);
    ok(!!e && c.V.zustand().wahl.notruf === e.i, `Klick auf ${m.id}: Wahl auf genau diesen Eintrag (${e && e.i})`);
    const zz = c.zeichne(c.view), b = zz.bild;
    const erwartet = e.art === 'takt' ? 'NOTRUF · Hex' + e.h : (e.k === 'k' ? 'KLARER RUF' : 'VERSCHLÜSSELTER RUF') + ' · Hex' + e.h;
    ok(b.includes(erwartet) && zz.knoepfe.includes('Notrufe 4') && zz.knoepfe.includes('Aktive Missionen 3'), `Klick auf ${m.id}: der Eintrag wird gezeichnet (${erwartet}) und beide Tabs tragen ihre Zahl`);
  }
  ok(c.befehle.length > 0 && c.befehle.every((b) => b.startsWith('captain.notruf.fokus')), 'Kampagnen-Eintrag fragt beim Server den Fokus an, sonst kein Befehl: ' + c.befehle.join());
});

section('D: Tasten', () => {
  const g = neu(); regulaer(g, 0); const t0 = takt(g, 0, true); Notrufe.freischalten(g, 'sl_klar');
  const c = client(); setzeWelt(c, g);
  ok(c.V.key('KeyD', c.view, c.cmd) === true && c.V.zustand().tab === 'notruf', 'D wechselt zum Tab Notrufe');
  Notrufe.freischalten(g, 'sl_echt'); setzeWelt(c, g); c.befehle.length = 0;
  c.V.key('KeyS', c.view, c.cmd);
  ok(c.befehle.join() === 'captain.notruf.fokus:sl_echt', 'S auf einen Kampagnen-Notruf fragt dessen Fokus an: ' + c.befehle.join());
  c.V.key('KeyW', c.view, c.cmd); c.V.setzeTab('aktiv'); c.V.setzeTab('notruf');
  ok(c.V.key('KeyA', c.view, c.cmd) === true && c.V.zustand().tab === 'aktiv', 'A wechselt zurück zu Aktive Missionen');
  ok(c.V.key('ArrowRight', c.view, c.cmd) === true && c.V.zustand().tab === 'notruf' && c.V.key('ArrowLeft', c.view, c.cmd) === true && c.V.zustand().tab === 'aktiv', 'Pfeil rechts/links wechseln ebenso');
  c.V.setzeTab('notruf'); c.befehle.length = 0;
  // Kampagnen-Notruf zuerst: Enter = hinfliegen
  ok(c.V.key('Enter', c.view, c.cmd) === true && c.befehle[c.befehle.length - 1] === 'captain.notruf.hinfliegen:sl_klar', 'Kampagnen-Notruf: Enter fliegt hin');
  c.V.key('KeyS', c.view, c.cmd); c.V.key('KeyS', c.view, c.cmd);   // Wahl auf den Takt-Notruf (nach den zwei Kampagnen-Notrufen)
  const sel = c.V.zustand().wahl.notruf;
  ok(sel === t0.marke, 'S wählt den Takt-Notruf (' + sel + ')');
  c.befehle.length = 0;
  for (const code of ['Enter', 'NumpadEnter', 'KeyX', 'KeyQ', 'KeyE', 'KeyR', 'KeyF']) ok(c.V.key(code, c.view, c.cmd) === false, `Takt-Notruf: Taste ${code} nicht verbraucht`);
  ok(c.befehle.length === 0, 'Takt-Notruf: kein Befehl an den Server (Annahme nur am Brett)');
  const z = c.zeichne(c.view);
  ok(!z.knoepfe.some((t) => /Hinfliegen|Ignorieren|Annehmen/.test(t)) && /Annehmen dort \(Terminal, Bereich Brett\)/.test(z.bild), 'Takt-Notruf: kein Knopf Hinfliegen/Ignorieren/Annehmen, der Eintrag nennt das Brett');
  // W/S im Tab Aktive Missionen: kein Server-Befehl, Enter/X nicht verbraucht (Fäden, Pseudo)
  c.V.setzeTab('aktiv'); c.befehle.length = 0;
  ok(c.V.key('KeyS', c.view, c.cmd) === true && c.V.key('KeyW', c.view, c.cmd) === true && c.befehle.length === 0, 'Tab Aktive Missionen: W/S ohne Server-Befehl');
  for (const code of ['Enter', 'KeyX', 'KeyQ']) ok(c.V.key(code, c.view, c.cmd) === false, `Tab Aktive Missionen: Taste ${code} nicht verbraucht`);
  // Ops-Knopf liest weiter die Kampagnen-Liste
  const c2 = client(); c2.view.state = { nr: [{ i: 'sl_echt', h: '0105', k: 'v', z: 0, r: 100 }] };
  ok(c2.V.opsKey('KeyI', c2.view, c2.cmd) === true && c2.befehle[0] === 'weapons.notruf.entschluesseln:sl_echt', 'Ops: I entschlüsselt weiter den verschlüsselten Ruf');
});

section('E: Anzeige', () => {
  const g = neu(); for (let i = 0; i < 3; i++) regulaer(g, i); takt(g, 0, true); takt(g, 1, false); Notrufe.freischalten(g, 'sl_klar,sl_echt');
  const c = client(); setzeWelt(c, g);
  let z = c.zeichne(c.view);
  ok(z.knoepfe.includes('Aktive Missionen 3') && z.knoepfe.includes('Notrufe 4'), 'Tab-Leiste: beide Tabs sind Knöpfe (Klick und Taste) und tragen ihre Zahl: ' + z.knoepfe.slice(0, 2).join(' / '));
  ok(/LAUFENDES ABENTEUER/.test(z.bild) && /Schritt 1 von 2/.test(z.bild), 'Tab Aktive Missionen zeigt das laufende Abenteuer samt Schritt');
  // Klick auf die Tab-Knöpfe
  c.V.setzeTab('notruf'); z = c.zeichne(c.view);
  ok(/KLARER RUF|VERSCHLÜSSELTER RUF/.test(z.bild), 'Tab Notrufe zeigt zuerst den Kampagnen-Notruf');
  // viele Einträge: der gewählte bleibt sichtbar (Fenster folgt der Wahl)
  const gross = client(); const marken = []; for (let i = 0; i < 12; i++) marken.push({ h: '0' + (101 + i), t: 'notruf', id: 'reise:n' + i, b: 600 });
  gross.win.StarMap.marken = marken; gross.view.state = { nr: [] };
  gross.V.oeffne('reise:n11'); const zg = gross.zeichne(gross.view);
  ok(/NOTRUF · Hex0112/.test(zg.bild) && /! Hex0112/.test(zg.bild) && /12\/12/.test(zg.bild), 'zwölf Einträge: der letzte (gewählte) steht in der sichtbaren Liste, Zähler 12/12');
  ok(!/! Hex0101\b/.test(zg.bild), 'zwölf Einträge: die ersten rutschen aus dem Fenster (nichts läuft aus dem Bereich)');
  // leere Tabs
  const leer = client(); leer.V.setzeTab('notruf'); ok(/Keine Notrufe/.test(leer.zeichne(leer.view).bild), 'leerer Tab Notrufe nennt es');
  leer.V.setzeTab('aktiv'); ok(/Keine aktiven Missionen/.test(leer.zeichne(leer.view).bild), 'leerer Tab Aktive Missionen nennt es');
  ok(leer.V.key('KeyW', leer.view, leer.cmd) === false && leer.V.key('KeyD', leer.view, leer.cmd) === true, 'leere Liste: W/S tun nichts, der Tab-Wechsel geht trotzdem');
});

section('F: Benennung', () => {
  for (const f of ['public/js/consoles.js', 'public/js/pult-stationen.js']) {
    const q = fs.readFileSync(f, 'utf8'); const m = q.match(/const TABS = \[([^\]]*)\]/);
    ok(!!m && /'Sektorplan', 'Aufträge'\]?$/.test(m[1].trim()) && !/'Notrufe'/.test(m[1]), `${f}: Reiter 6 heißt Aufträge (TABS: ${m && m[1].trim()})`);
  }
  const T = (() => { const w = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }; vm.runInNewContext(fs.readFileSync('public/js/tasten.js', 'utf8'), { window: w, console }); return w.Tasten; })();
  const a = (id) => T.AKTIONEN.find((x) => x.id === id);
  ok(a('captain.reiter6').name === 'Reiter Aufträge' && T.BEREICHE['captain.notruf'].name === 'Reiter Aufträge', 'Tastenbelegung: Reiter 6 und Bereich heißen Aufträge');
  const ev = (code) => ({ code, shiftKey: false });
  ok(a('captain.notruf.tabAktiv') && a('captain.notruf.tabNotruf') && T.welche(ev('KeyA'), 'captain', 'captain.notruf') === 'captain.notruf.tabAktiv' && T.welche(ev('KeyD'), 'captain', 'captain.notruf') === 'captain.notruf.tabNotruf', 'Tastenbelegung: A/D (und Pfeile) wechseln die Tabs im Reiter Aufträge');
  ok(!/Reiter Notrufe/.test(fs.readFileSync('public/js/tasten.js', 'utf8')), 'tasten.js nennt keinen „Reiter Notrufe“ mehr');
  const sm = fs.readFileSync('public/js/starmap.js', 'utf8');
  ok(/markeAn\(x, y, rects\)/.test(sm) && /mkRects\.push/.test(sm), 'starmap.js: markeAn und die Klickflächen der Plaketten sind da');
  const co = fs.readFileSync('public/js/consoles.js', 'utf8');
  ok(/StarMap\.markeAn\(x, y, this\.starRects\)/.test(co) && /NotrufView\.oeffne\(mkHit\.id\)/.test(co) && /this\.tab = TAB_NOTRUF/.test(co), 'consoles.js: der Klick auf die Sternkarte fragt zuerst die Notruf-Marke und öffnet den Reiter');
});

section('H: Karte – markeAn liefert die Notruf-Plakette unter dem Klick (starmap.js im vm, Fake-Canvas)', () => {
  const T = require('../public/js/karte-tokens.js'), KL = require('../public/js/karte-lage.js'), KZ = require('../public/js/kartenzeichen.js'), KA = require('../public/js/kartenansicht.js');
  const SUND = require('../content/welt/sund_frei.json');
  const fakeCtx = () => new Proxy({}, { get(_, k) { return (...a) => { void a; if (k === 'createPattern') return {}; if (k === 'measureText') return { width: 10 }; return undefined; }; }, set() { return true; } });
  const Rn = { text() {}, measure: (s) => String(s).length * 5, wrap: (s) => [String(s)], worldOf: (st) => ({ location: (st && st.loc) || 'ostia_nova', locations: [] }), drawStarMapAlt() {}, drawPin() {}, button() {} };
  KL.env.Render = Rn;
  const listener = [];
  const win = { Kartenzeichen: KZ, KarteTokens: T, KarteLage: KL, KartenAnsicht: KA, Render: Rn, Net: { on: (f) => { listener.push(f); return () => {}; }, reportError() {} } };
  vm.runInNewContext('(function (window) {' + fs.readFileSync('public/js/starmap.js', 'utf8') + '\n})(win)', { win, performance, console });
  const SM = win.StarMap; SM.setKarte(SUND);
  listener.forEach((f) => f({ t: 'snap', phase: 'play', world: { marken: [{ h: '0603', t: 'notruf', id: 'reise:n1', b: 600, g: 900 }, { h: '0604', t: 'notruf', id: 'notruf:sl_klar', s: 'notruf', b: 300, g: 600 }, { h: '0503', t: 'fund', id: 'fund:x', b: 100, g: 200 }, { h: '0605', t: 'ziel' }] } }));
  const rects = [], rect = { x: 12, y: 48, w: 410, h: 272 };
  SM.draw(fakeCtx(), { state: { loc: 'ostia_nova', ship: { scene: 'ostia_nova' } }, time: 1 }, rect, { ansichtKey: 'h', rects });
  const treffer = {};
  for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) { const m = SM.markeAn(x, y, rects); if (m) { const q = treffer[m.id] || (treffer[m.id] = { n: 0, t: m.t, h: m.h }); q.n++; } }
  ok(!!treffer['reise:n1'] && treffer['reise:n1'].t === 'notruf' && treffer['reise:n1'].h === '0603' && treffer['reise:n1'].n >= 20, 'die Takt-Marke reise:n1 ist anklickbar (' + (treffer['reise:n1'] || {}).n + ' Punkte), mit Typ und Hex');
  ok(!!treffer['notruf:sl_klar'] && treffer['notruf:sl_klar'].t === 'notruf', 'die Kampagnen-Marke notruf:sl_klar ist anklickbar');
  ok(Object.keys(treffer).every((id) => id !== undefined) && !Object.keys(treffer).some((id) => !/^(reise:n1|notruf:sl_klar|fund:x)$/.test(id)), 'nur Plaketten mit Id treffen, die Ziel-Marke ohne Id nicht: ' + Object.keys(treffer).join());
  ok(SM.markeAn(1, 1, rects) === null && SM.markeAn(rect.x + rect.w + 40, rect.y + 5, rects) === null, 'ausserhalb der Karte: kein Treffer');
  ok(SM.markeAn(0, 0, []) === null, 'fremde rects (andere Karte): kein Treffer');
});

section('G: keine neuen Snapshot-Felder', () => {
  const g = neu(); regulaer(g, 0); takt(g, 0, true);
  const s = Brett.snapshot(g), l = s.laufend[0], a = s.angebote.find((x) => x.notruf);
  ok(Object.keys(l).sort().join() === 'anlass,gefahr,id,ort,ph,rest,schritt,schritt_text,schritte_gesamt,titel'.split(',').sort().join() || Object.keys(l).every((k) => ['id', 'notruf', 'titel', 'ort', 'schritt', 'schritte_gesamt', 'schritt_text', 'gefahr', 'ph', 'rest', 'anlass'].includes(k)), 'laufend: nur bestehende Felder: ' + Object.keys(l).join());
  ok(!!a && Object.keys(a).every((k) => ['id', 'titel', 'ort', 'ortname', 'von', 'aus_geruecht', 'vorschau', 'typen', 'notruf', 'hafen', 'anlass', 'ort_offen', 'rest'].includes(k)), 'Notruf-Angebot: nur bestehende Felder: ' + (a ? Object.keys(a).join() : '–'));
  ok(Marken.snapshot(g).every((m) => Object.keys(m).every((k) => ['h', 't', 'id', 's', 'b', 'g'].includes(k))), 'Marken: nur bestehende Felder (h, t, id, s, b, g)');
});

console.log(`\n${n - fails}/${n} Prüfungen bestanden.`);
process.exit(fails ? 1 : 0);
