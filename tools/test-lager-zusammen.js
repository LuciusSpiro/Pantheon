'use strict';
// LAD-01 C: Zusammenführung der Ablagen. Die Faden-Ware (faden-fracht.js) liegt als Art 'fracht' im Frachtraum (nur über fracht.lagerAufnehmen, quelle 'faden'),
// Ablieferung bleibt der Hook andocken; die Schnittstelle erzEinlagern/beuteEinlagern (fracht.js) ist für WRK-01 und AST-01 da; das GEL-03-Abbauerz (inventory.erz) bleibt unverändert.
// Erwartete Werte: eigene Zählung im Test.      node tools/test-lager-zusammen.js
const fs = require('fs');
const path = require('path');
const Space = require('../server/sim/space.js');
const Sektoren = require('../shared/sektoren.js');
const Weltstand = require('../server/weltstand.js');
const Faden = require('../server/sim/faden.js');
const FF = require('../server/sim/faden-fracht.js');
const Fracht = require('../server/sim/fracht.js');
const Modul = require('../server/sim/module.js');
const Ausbau = require('../server/sim/ausbau.js');
const Vorrat = require('../server/sim/vorrat.js');
const X = require('./faden-fixture.js');
const { D, spiel, oeffne, grenzen, alsVorlage, registriere } = X;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ ' + (e && e.stack)); } };
const ab = (g) => { const s = g.ship; s.docked = false; s.dockedAt = null; s.helm.stage = 1; s.vx = 0; s.vy = 0; s.speed = 0; s.helm.thrust = 0; s.helm.turn = 0; };
const ankunft = (g, hex) => { Space.enterScene(g, Sektoren.ortVonHex(hex), {}); ab(g); };
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
function vorlage(id) {
  const r = registriere(alsVorlage(id, (v) => {
    v.nsc.status = 'aktiv'; v.volk_erlaubt = ['rom', 'kon', 'ger']; delete v.wahrheit; delete v.hinweise;
    v.beats = [
      { id: 'b_szene', typ: 'fracht', parameter: { nach: '0305' }, aus: { gelungen: { status: 'verbuendet', weiter: 'b_ende' }, gescheitert: { status: 'geflohen', weiter: 'b_ende' } } },
      { id: 'b_ende', typ: 'abschluss', erfolg: { ereignis: ['fracht_gelungen'] }, aus: { gelungen: {}, gescheitert: { text_key: 'ende_verpasst' } } },
    ];
  }));
  if (!r.ok) throw new Error('Vorlage ungueltig: ' + r.fehler.join('; '));
}
function bereit(seed) {
  const g = spiel({ crew: 1, seed }).g;
  ab(g); ankunft(g, '0305');
  return g;
}
// Frachträume setzen (Raumnummern)
function raeume(g, liste) {
  Ausbau.setStufe(g, 3);
  g.ship.module = liste.map((r) => ({ id: 'frachtraum', raum: r, an: true, lauf: true }));
  Modul.verteilungSetzen(g);
}
const lager = (g) => g.fracht.lager.map((l) => l.art);

section('Faden-Ware landet im Frachtraum (Art fracht, ein Platz, quelle faden)', () => {
  vorlage('lz_a');
  const g = bereit(31);
  const l0 = lager(g).length, z0 = g.fracht.zugang.faden || 0;
  const f = oeffne(g, 'lz_a'); grenzen(g, 5);
  ok(weiter(g, f).ok && f.phase === 'laeuft' && f.fracht && f.fracht.nach === '0305', 'Beat fracht läuft, Auftrag steht im Faden');
  ok(lager(g).length === l0 + 1 && lager(g)[l0] === 'fracht', 'die Ware liegt als Art fracht im Frachtraum');
  ok(g.fracht.zugang.faden === z0 + 1, 'Zugang gezählt unter quelle faden');
  ok(Fracht.anBord(g, 'fracht') === 1 && Fracht.frei(g) === Fracht.capacity(g) - l0 - 1, 'belegt genau einen Platz');
  const ws = Weltstand.capture(g);
  ok(Weltstand.validate(ws, g).length === 0, 'Weltstand mit Ware im Frachtraum besteht das Schema');
  ankunft(g, '0305'); g.missionEvent('docked', {});
  ok(f.phase === 'wartet' && !f.fracht && f.nsc.status === 'verbuendet', 'andocken: abgeliefert (gelungen)');
  ok(lager(g).length === l0 && Fracht.anBord(g, 'fracht') === 0, 'die Ladung hat den Frachtraum verlassen (Platz wieder frei)');
});

section('Verlust: Notsprung, Frist, fehlende Ladung beim Andocken', () => {
  vorlage('lz_b');
  const g = bereit(32);
  g.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
  const f = oeffne(g, 'lz_b'); grenzen(g, 5); weiter(g, f);
  ok(Fracht.anBord(g, 'fracht') === 1, 'Ware an Bord');
  FF.notsprung(g);
  ok(!f.fracht && f.nsc.status === 'geflohen' && Fracht.anBord(g, 'fracht') === 0, 'Notsprung: Auftrag gescheitert, Ladung aus dem Frachtraum');
  const h = oeffne(g, 'lz_b'); grenzen(g, 5); weiter(g, h);
  grenzen(g, D.WERTE.beat_frist + 1);
  ok(!h.fracht && Fracht.anBord(g, 'fracht') === 0, 'Frist abgelaufen: Ladung weg, kein Rest im Frachtraum');
  const k = oeffne(g, 'lz_b'); grenzen(g, 5); weiter(g, k);
  ok(Fracht.anBord(g, 'fracht') === 1, 'dritte Ware an Bord');
  g.fracht.lager.length = 0;   // z. B. Huellentreffer im ungesicherten Frachtraum: die Ladung ist weg
  ankunft(g, '0305'); g.missionEvent('docked', {});
  ok(k.phase === 'wartet' && k.nsc.status === 'geflohen', 'Ladung fehlt beim Andocken: nicht abgeliefert, Auftrag gescheitert (keine Scheinablieferung)');
});

section('Typ-Regel gilt für die Faden-Ware', () => {
  vorlage('lz_c');
  const g = bereit(33);
  raeume(g, [1]);
  Fracht.debug(g, ['leer']);
  ok(Fracht.anBordLegen(g, 'sprengstoff'), 'Sprengstoff legt den Typ des einzigen Moduls fest');
  const f = oeffne(g, 'lz_c'); grenzen(g, 5);
  weiter(g, f);
  ok(!f.fracht && lager(g).join() === 'sprengstoff', 'Faden-Ware wird abgelehnt (ein Modul, eine Art): kein Auftrag, nichts im Lager');
  ok(f.phase === 'wartet' && f.nsc.status === 'geflohen', 'der Beat scheitert sauber, der Faden lebt');
  raeume(g, [1, 3]); Fracht.debug(g, ['leer']);
  Fracht.anBordLegen(g, 'sprengstoff');
  const h = oeffne(g, 'lz_c'); grenzen(g, 5); weiter(g, h);
  ok(!!h.fracht && lager(g).join() === 'sprengstoff,fracht', 'zwei Module: Sprengstoff und Faden-Ware nebeneinander');
  const L = FF.laden(g, { fadenId: h.id, nachHafen: '0305' });
  ok(!L.ok && L.grund === 'schon eine Ware an Bord', 'zweites Laden im selben Faden: abgelehnt');
  Fracht.debug(g, ['leer']); raeume(g, [1]);
  for (let i = 0; i < 4; i++) Fracht.anBordLegen(g, 'fracht');
  const pf = Fracht.platzFuer(g, 'fracht');
  ok(!pf.ok && pf.grund === 'voll', 'volles Modul (4 Plätze): kein weiterer Platz für die Ware');
});

section('Erz- und Beute-Schnittstelle (für WRK-01 und AST-01)', () => {
  const g = bereit(34);
  raeume(g, [1, 3]); Fracht.debug(g, ['leer']);
  const r = Fracht.erzEinlagern(g, 3);
  ok(r.ok && r.eingelagert === 3 && r.rest === 0 && lager(g).join() === 'erz,erz,erz', 'Erz: 3 Stapel, 3 Plätze (Art erz)');
  ok(g.fracht.zugang.abbau === 3, 'Quelle abbau gezählt');
  const b = Fracht.beuteEinlagern(g, 'bergungsgut', 2);
  ok(b.ok && b.eingelagert === 2 && lager(g).join() === 'erz,erz,erz,bergungsgut,bergungsgut', 'Bergungsgut: eigenes Modul, Art bergungsgut');
  ok(g.fracht.zugang.beute === 2, 'Quelle beute gezählt');
  const w = Fracht.beuteEinlagern(g, 'waffen', 1);
  ok(!w.ok && w.eingelagert === 0 && w.rest === 1 && /nur eine Art/.test(w.text), 'fremde Art: abgelehnt, Rest zurück, klarer Hinweis (' + w.text + ')');
  const t = Fracht.erzEinlagern(g, 4);
  ok(!t.ok && t.eingelagert === 1 && t.rest === 3 && Fracht.anBord(g, 'erz') === 4, 'Erz: nur 1 passt (Modul voll), Rest 3 kommt zurück');
  const v = Fracht.erzEinlagern(g, 1);
  ok(!v.ok && v.rest === 1 && !!v.text, 'Erz bei vollem Modul: abgelehnt mit Hinweis');
  const n0 = Fracht.erzEinlagern(g, 0);
  ok(!n0.ok && n0.eingelagert === 0, 'Menge 0: nichts eingelagert');
  const u = Fracht.beuteEinlagern(g, 'unsinn', 1);
  ok(!u.ok && !!u.text, 'unbekannte Art: abgelehnt');
  raeume(g, []); Fracht.debug(g, ['leer']);
  const k = Fracht.erzEinlagern(g, 1);
  ok(!k.ok && k.rest === 1 && /Kein Frachtraum/.test(k.text), 'ohne Frachtraum: abgelehnt (' + k.text + ')');
  raeume(g, [1]); Fracht.debug(g, ['leer']);
  ok(Fracht.beuteEinlagern(g).ok && lager(g).join() === 'bergungsgut', 'ohne Art: Bergungsgut, 1 Stapel');
});

section('GEL-03-Abbau-Erz bleibt unverändert (inventory.erz, nicht im Frachtraum)', () => {
  const g = bereit(35);
  const l0 = lager(g).length;
  Vorrat.einlagern(g, 'erz', 2, 'abbau');
  ok(Vorrat.stand(g, 'erz') === 2 && lager(g).length === l0, 'Vorrat.einlagern(erz, abbau): Zähler steigt, Frachtraum unberührt');
  Fracht.erzEinlagern(g, 1);
  ok(Vorrat.stand(g, 'erz') === 2, 'die Schnittstelle fasst den Erz-Zähler nicht an');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'anker.js'), 'utf8');
  ok(/Vorrat\.einlagern\(game, m\.art, m\.menge, 'abbau'\)/.test(src) && !/erzEinlagern|beuteEinlagern|lagerAufnehmen/.test(src), 'anker.js (GEL-03-Abbau) lagert weiter über Vorrat ein und kennt die neue Schnittstelle nicht');
});

section('Kein Weg am lagerAufnehmen vorbei (statischer Scan)', () => {
  const treffer = [];
  const scan = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) scan(p); else if (/\.js$/.test(f.name)) fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l, i) => { if (/\blager\.(?:push|unshift)\(/.test(l)) treffer.push(path.basename(p) + ':' + (i + 1)); }); } };
  scan(path.join(__dirname, '..', 'server'));
  ok(treffer.length === 1 && /^fracht\.js:/.test(treffer[0]), 'nur eine Schreibstelle ins Lager, in fracht.js (' + treffer.join(', ') + ')');
  const ff = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'faden-fracht.js'), 'utf8');
  ok(/lagerAufnehmen\(game, \{ art: 'fracht', quelle: 'faden' \}\)/.test(ff) && !/\.lager\b/.test(ff.replace(/\/\/.*$/gm, '')), 'faden-fracht.js schreibt nie selbst ins Lager');
});

console.log('\n' + (n - fails) + '/' + n + ' Prüfungen ok' + (fails ? ' – ' + fails + ' FEHLER' : ''));
process.exit(fails ? 1 : 0);
