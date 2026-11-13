'use strict';
// FAB-01 A: Ereignis-Verteiler fuer den Boden (server/sim/faden-boden.js, Haken in game.missionEvent, Marker notrueckholung in combat.js).
// Geprueft: (a) alle fuenf Ereignisse erreichen den Handler der Beat-Art (ueber den ECHTEN Haken game.missionEvent) · (b) beamedDown/-Up mit der Karte eines anderen Fadens oder ohne Faden-Ort erreichen ihn nicht;
// Ereignisse ohne Karte gehen an alle laufenden Beats angemeldeter Art, eine fremde Karte schliesst aus · (c) ein werfender Handler erhoeht nur g.errors, bricht nichts ab · (d) ohne FAEDEN=1, ohne laufenden Beat
// und ohne angemeldete Art wird nie ein Handler gerufen · (e) Notrueckholung (squadRecall, Ausbluten) meldet beamedUp mit notrueckholung: true, die freiwillige Rueckholung (away.js) ohne Marker
// (f) Haken und Marker stehen im Quelltext. Erwartete Werte: eigene Zaehlung im Test.      node tools/test-faden-boden.js
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const Faden = require('../server/sim/faden.js');
const Boden = require('../server/sim/faden-boden.js');
const Combat = require('../server/sim/combat.js');
const X = require('./faden-fixture.js');
const { D, spiel, oeffne, grenzen } = X;

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const section = (t, f) => { console.log('\n' + t); try { f(); } catch (e) { fails++; n++; console.log('  ABSTURZ Ausnahme: ' + (e && e.stack)); } };
const klon = (x) => JSON.parse(JSON.stringify(x));
const EREIGNISSE = ['beamedDown', 'beamedUp', 'npcRescued', 'personAnBord', 'personAbgegeben'];
const ART = 'bitte';   // Katalogtyp des ersten Beats der Testvorlage (ein Beat, der ohne Eingabe laeuft)
const ortId = (fadenId) => 'testort.' + fadenId + '-ort';
const weiter = (g, f) => Faden.befehlAnwenden(g, { typ: 'faden_weiter', faden: f.id, beat: D.vorlage(f.vorlage).beats[f.beat].id });
// Spiel mit einem Faden, dessen erster Beat laeuft
function laufend(o) {
  const x = spiel(o); const g = x.g;
  g.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
  const f = oeffne(g);
  grenzen(g, 5);
  weiter(g, f);
  return { g, f };
}
const probe = () => { const p = { aufrufe: [], ereignis(game, faden, ev) { p.aufrufe.push({ faden: faden.id, name: ev.name, data: ev.data }); } }; return p; };
const namen = (p) => p.aufrufe.map((a) => a.name);

const { g, f } = laufend();
const fremd = 'f' + (Number(f.id.slice(1)) + 50);

section('(a) alle fuenf Ereignisse erreichen den Handler (Haken in game.missionEvent)', () => {
  ok(g.weltsim.faeden.liste[0] === f && f.phase === 'laeuft' && f.laufend && D.vorlage(f.vorlage).beats[f.beat].typ === ART, 'Aufbau: Faden ' + f.id + ' mit laufendem Beat der Art ' + ART);
  const p = probe(); Boden.anmelden(ART, p);
  const e0 = g.errors;
  g.missionEvent('beamedDown', { players: [], map: ortId(f.id) });
  g.missionEvent('beamedUp', { players: [], map: ortId(f.id) });
  g.missionEvent('npcRescued', { person: 'p1', map: ortId(f.id) });
  g.missionEvent('personAnBord', { person: 'p1', name: 'X', n: 1 });
  g.missionEvent('personAbgegeben', { person: 'p1', name: 'X', ort: 'o', map: null });
  ok(JSON.stringify(namen(p)) === JSON.stringify(EREIGNISSE), 'in Reihenfolge: ' + namen(p).join(', '));
  ok(p.aufrufe.every((a) => a.faden === f.id), 'der Handler bekommt den Faden');
  ok(p.aufrufe[0].data.map === ortId(f.id) && p.aufrufe[3].data.person === 'p1', 'ev.data kommt unveraendert an');
  ok(g.errors === e0, 'g.errors unveraendert');
  g.missionEvent('docked', {}); g.missionEvent('weaponsFired', {}); g.missionEvent('notsprung', {});
  ok(p.aufrufe.length === 5, 'andere Ereignisse (docked, weaponsFired, notsprung) erreichen den Handler nicht');
  ok(Boden.zugestellt(g) === 5, 'Zaehler der Zustellungen 5');
  Boden.abmelden(ART);
});

section('(b) Zuordnung ueber die Karte', () => {
  const p = probe(); Boden.anmelden(ART, p);
  g.missionEvent('beamedDown', { players: [], map: ortId(fremd) });
  g.missionEvent('beamedUp', { players: [], map: ortId(fremd) });
  ok(p.aufrufe.length === 0, 'beamedDown/-Up mit der Karte eines anderen Fadens: nicht zugestellt');
  g.missionEvent('beamedDown', { players: [], map: 'skjaldborg_wildnis' });
  g.missionEvent('beamedUp', { players: [] });
  ok(p.aufrufe.length === 0, 'beamedDown/-Up mit einer Karte ohne Faden-Ort oder ohne Karte: nicht zugestellt');
  g.missionEvent('npcRescued', { person: 'p', map: ortId(fremd) });
  g.missionEvent('personAbgegeben', { person: 'p', map: ortId(fremd) });
  ok(p.aufrufe.length === 0, 'npcRescued/personAbgegeben mit fremder Faden-Karte: nicht zugestellt');
  g.missionEvent('personAnBord', { person: 'p', name: 'X', n: 1 });
  g.missionEvent('npcRescued', {});
  g.missionEvent('npcRescued', { person: 'p', map: 'skjaldborg_wildnis' });
  ok(namen(p).join() === 'personAnBord,npcRescued,npcRescued', 'ohne Karte oder mit Karte ausserhalb der Faeden: an alle laufenden Beats der Art: ' + namen(p).join());
  g.missionEvent('beamedDown', { players: [], map: ortId(f.id) });
  ok(namen(p).length === 4 && namen(p)[3] === 'beamedDown', 'die Karte dieses Fadens trifft ihn');
  Boden.abmelden(ART);
  const q = probe(); Boden.anmelden('andere_art', q);
  g.missionEvent('beamedDown', { players: [], map: ortId(f.id) }); g.missionEvent('personAnBord', {});
  ok(q.aufrufe.length === 0, 'Handler einer anderen Beat-Art wird nicht gerufen');
  Boden.abmelden('andere_art');
});

section('(c) werfender Handler: nur g.errors, nichts bricht', () => {
  const e0 = g.errors; let gerufen = 0;
  Boden.anmelden(ART, { ereignis() { gerufen++; throw new Error('Probe-Fehler'); } });
  let geworfen = false;
  try { g.missionEvent('beamedDown', { players: [], map: ortId(f.id) }); g.missionEvent('personAnBord', {}); } catch (e) { geworfen = true; }
  ok(!geworfen, 'missionEvent wirft nicht');
  ok(gerufen === 2 && g.errors === e0 + 2, 'je Ereignis ein Fehler gezaehlt: ' + (g.errors - e0));
  ok(f.phase === 'laeuft' && g.weltsim.faeden.liste.length === 1, 'Faden unveraendert');
  Boden.anmelden(ART, () => { throw new Error('Funktion wirft'); });
  g.missionEvent('personAbgegeben', {});
  ok(g.errors === e0 + 3, 'auch ein Funktions-Handler');
  const p = probe(); Boden.anmelden(ART, p);
  g.missionEvent('personAnBord', {});
  ok(p.aufrufe.length === 1 && g.errors === e0 + 3, 'danach laeuft ein normaler Handler weiter');
  // zwei laufende Faeden: wirft der Handler beim ersten, bekommt der zweite das Ereignis trotzdem
  const z = spiel({ crew: 1, seed: 7 }).g; z.lageSpielleiter = { disposed: false, mode: 'mock', beiGrenze() {} };
  const z1 = oeffne(z), z2 = oeffne(z); grenzen(z, 6); weiter(z, z1); weiter(z, z2);
  const gesehen = [];
  Boden.anmelden(ART, (game, faden, ev) => { gesehen.push(faden.id); if (faden.id === z1.id) throw new Error('erster wirft'); });
  const ze0 = z.errors;
  z.missionEvent('personAnBord', {});
  ok(gesehen.join() === z1.id + ',' + z2.id && z.errors === ze0 + 1, 'zwei laufende Faeden: der zweite bekommt das Ereignis trotz Fehler beim ersten (Fehler 1)');
  let ohneEreignis = false; try { Boden.anmelden(ART, {}); } catch (e) { ohneEreignis = true; }
  ok(ohneEreignis, 'anmelden ohne ereignis() wird abgelehnt');
  let leer = true; try { Boden.ereignis(null, null); Boden.ereignis(g, null); Boden.ereignis({}, { name: 'beamedDown' }); } catch (e) { leer = false; }
  ok(leer, 'ereignis wirft nie (null, kein weltsim)');
  Boden.abmelden(ART);
});

section('(d) Gate: ohne FAEDEN=1, ohne laufenden Beat, ohne Handler nie ein Aufruf', () => {
  const p = probe(); Boden.anmelden(ART, p);
  // ohne Schalter: derselbe Faden im Weltstand eines Spiels ohne FAEDEN=1
  const h = spiel({ aus: true }).g;
  h.weltsim.faeden = klon(g.weltsim.faeden);
  ok(h.weltsim.faeden.liste[0].phase === 'laeuft' && !Faden.aktiv(h), 'Aufbau: Beat laeuft im Weltstand, FAEDEN aus');
  for (const e of EREIGNISSE) h.missionEvent(e, { players: [], map: ortId(f.id) });
  ok(p.aufrufe.length === 0, 'ohne FAEDEN=1: kein Aufruf');
  // mit Schalter, aber der Beat laeuft nicht (phase wartet)
  const w = laufend().g;
  const wf = w.weltsim.faeden.liste[0];
  Faden.beatAusgang(w, wf.id, 'gelungen');
  ok(wf.phase !== 'laeuft', 'Aufbau: Beat zu Ende');
  for (const e of EREIGNISSE) w.missionEvent(e, { players: [], map: ortId(wf.id) });
  ok(p.aufrufe.length === 0, 'ohne laufenden Beat: kein Aufruf');
  // ohne Faeden im Weltstand
  const k = spiel({}).g;
  for (const e of EREIGNISSE) k.missionEvent(e, {});
  const vorher = JSON.stringify(k.weltsim.faeden);
  for (const e of EREIGNISSE) k.missionEvent(e, {});
  ok(p.aufrufe.length === 0 && JSON.stringify(k.weltsim.faeden) === vorher && k.weltsim.faeden.liste.length === 0, 'ohne Faden: kein Aufruf, Faeden-Zustand unveraendert');
  Boden.abmelden(ART);
  const q = probe();   // ohne Anmeldung
  g.missionEvent('personAnBord', {}); g.missionEvent('beamedDown', { map: ortId(f.id) });
  ok(q.aufrufe.length === 0 && p.aufrufe.length === 0, 'nach abmelden: kein Aufruf');
});

section('(e) Marker notrueckholung', () => {
  const x = laufend(); const gg = x.g;
  const ev = []; const o = gg.missionEvent.bind(gg);
  gg.missionEvent = (name, data) => { ev.push({ name, data }); return o(name, data); };
  const p = gg.players[0];
  const hoch = () => ev.filter((e) => e.name === 'beamedUp');
  p.zone = 'away'; gg.away = { map: 'testkarte', stats: {}, recallT: 0 };
  Combat.squadRecall(gg);
  ok(hoch().length === 1 && hoch()[0].data.notrueckholung === true, 'squadRecall: beamedUp mit notrueckholung: true');
  const y = laufend().g;   // frisches Spiel: squadRecall bricht den Transfer (Folge), danach gaebe es nur die Fern-Heilung
  const ev2 = []; const o2 = y.missionEvent.bind(y);
  y.missionEvent = (name, data) => { ev2.push({ name, data }); return o2(name, data); };
  const p2 = y.players[0];
  p2.zone = 'away'; p2.downed = true; p2.bleed = 0; p2.downedFor = 0; y.away = { map: 'testkarte', stats: {}, kampf: 'v2' };
  Combat.updateWounded(y, p2, 0.05);
  const hoch2 = ev2.filter((e) => e.name === 'beamedUp');
  ok(hoch2.length === 1 && hoch2[0].data.notrueckholung === true, 'Ausbluten (updateWounded): beamedUp mit notrueckholung: true');
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'combat.js'), 'utf8');
  const alle = quelle.match(/missionEvent\('beamedUp'[^\n]*/g) || [];
  ok(alle.length === 3 && alle.every((z) => /notrueckholung: true/.test(z)), 'Quelltext: alle drei beamedUp in combat.js tragen den Marker (3 Stellen, darunter die Krankenstation)');
  const away = fs.readFileSync(path.join(__dirname, '..', 'server', 'sim', 'away.js'), 'utf8');
  const af = away.match(/missionEvent\('beamedUp'[^\n]*/g) || [];
  ok(af.length === 2 && af.every((z) => !/notrueckholung/.test(z)), 'Quelltext: away.js (freiwillig, Beamen) ohne Marker');
});

section('(f) Haken im Quelltext', () => {
  const game = fs.readFileSync(path.join(__dirname, '..', 'server', 'game.js'), 'utf8');
  const z = (game.match(/[^\n]*FadenBoden\.ereignis\(this[^\n]*/g) || []);
  ok(z.length === 1 && /try \{/.test(z[0]) && /countError\('faden-boden'/.test(z[0]) && /this\.weltsim/.test(z[0]), 'ein Haken in game.js, mit weltsim, try/catch und countError');
});

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log('FEHLER: ' + fails); process.exit(1); }
console.log('test-faden-boden: alles ok');
