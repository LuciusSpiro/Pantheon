'use strict';
// CHA-01 D: Spind im eigenen Quartier (Server im Prozess). Interaktion nur am eigenen Spind (Raum q<Spielerfarbe>) und nur mit Charakterkarte, Konsole 'spind' öffnen/verlassen,
// karte.outfit nur an der Konsole (sonst ignoriert), Ereignis an alle, Alarm blockiert nicht, der Charakterteil ist über karte.outfit nicht änderbar.
// Aufruf: node tools/test-spind.js   (Exit 1 bei Fehlern; npm run test:spind)   Mutationsprobe: tools/mutation-spind.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const ROOT = process.env.SPIND_ROOT || path.join(__dirname, '..');
const { Game } = require(path.join(ROOT, 'server', 'game.js'));
const interior = require(path.join(ROOT, 'server', 'sim', 'interior.js'));
const W = require(path.join(ROOT, 'server', 'world.js'));

let fehler = 0, n = 0;
const ok = (b, t) => { n++; if (!b) { fehler++; console.log('FEHLER: ' + t); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-spind-'));
const g = new Game({ noStore: true, seed: 5, debug: true, ruestphase: false, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0', REGIE_DIR: path.join(dir, 'r') }, log: () => {} });
const KARTE = (name) => ({ v: 1, name, koerper: 'standard', gesicht: 'lerche', frisur: 'dutt', bart: 'keiner', haut: 1, haar: 2,
  outfit: { kopf: 'keine', oberteil: 'bordtunika', hose: 'bordhose', schuhe: 'bordstiefel', haende: 'keine', umhang: 'keiner' } });
const cs = [];
const verbinde = (id, name, color, karte) => {
  const c = cs[id] || { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  if (!cs[id]) { cs[id] = c; g.addConnection(c); }
  const h = { t: 'hello', clientId: 'S' + id, name, color };
  if (karte) h.karte = karte;
  g.handleMessage(c, h);
};
verbinde(0, 'Aurelia', 0, KARTE('Aurelia'));
verbinde(1, 'Brennus', 1, KARTE('Brennus'));
verbinde(2, 'Bot', 2, null);   // ohne Karte (wie ein Bot)
const [p0, p1, p2] = g.players;
// Farbwechsel in der Lobby (erneutes hello mit anderem Wunsch): Spieler 0 zieht von Quartier 0 nach 3
verbinde(0, 'Aurelia', 3, KARTE('Aurelia'));
ok(p0.color === 3 && p1.color === 1 && p2.color === 2, 'Farben nach dem Wechsel: 3, 1, 2');
for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
const run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) g.step(); };
run(0.5);
ok(g.phase !== 'lobby' && p0.zone === 'ship' && p0.karte && p1.karte && !p2.karte, 'Runde läuft an Bord; Spieler 0 und 1 haben eine Karte, Spieler 2 nicht');

const SPINDE = [{ x: 13, y: 17, q: 0 }, { x: 27, y: 17, q: 2 }, { x: 13, y: 27, q: 1 }, { x: 27, y: 27, q: 3 }];
const kinds = (p, s) => interior.interactionsAt(g, p, s.x, s.y, false).map((i) => i.kind + (i.blocked ? '!' : ''));
const sm = W.Maps.ship;
ok(SPINDE.every((s) => sm.info(s.x, s.y).kind === 'locker' && W.Maps.roomAt(s.x, s.y).id === 'q' + s.q), 'Karte: vier Spinde, je einer im Quartier q0..q3');

// ---- Interaktionsliste
for (const [p, name] of [[p0, 'Spieler 0 (Farbe 3)'], [p1, 'Spieler 1 (Farbe 1)'], [p2, 'Spieler 2 (ohne Karte, Farbe 2)']]) {
  for (const s of SPINDE) {
    const hat = kinds(p, s).includes('locker');
    const soll = !!p.karte && s.q === p.color;
    ok(hat === soll, `${name}: Spind in q${s.q} ${soll ? 'wird angeboten' : 'wird nicht angeboten'} (ist: ${kinds(p, s).join(',') || 'nichts'})`);
  }
}
ok(SPINDE.every((s) => kinds(p0, s).every((k) => !k.endsWith('!'))), 'fremde Spinde: keine gesperrte Zeile, also kein Hinweistext');
// Farbwechsel: Spieler 0 hatte q0 gewünscht, bekam q3 – der Spind in q0 bietet nichts an
ok(!kinds(p0, SPINDE[0]).includes('locker') && kinds(p0, SPINDE[3]).includes('locker'), 'nach dem Farbwechsel gilt der Spind des neuen Quartiers');
// ohne Karte (Bot) in seinem eigenen Quartier: nichts
ok(kinds(p2, SPINDE[1]).length === 0, 'ohne Karte: am eigenen Spind (q2) nichts, auch keine gesperrte Zeile');

// ---- E am Spind
const setze = (p, tx, ty, dir) => { p.x = tx * 32 + 16; p.y = ty * 32 + 16; p.dir = dir; p.console = null; p.input.mx = 0; p.input.my = 0; };
const notices = (c) => c.inbox.filter((m) => m.t === 'event' && m.kind === 'notice').length;
const druecke = (p) => { interior.onAct(g, p, true); interior.onAct(g, p, false); };
ok(!sm.solid(26, 27) && !sm.solid(12, 27) && !sm.solid(26, 17), 'Kacheln neben den Spinden sind begehbar');
setze(p0, 26, 27, 'right');
const n0 = notices(cs[0]);
druecke(p0);
ok(p0.console === 'spind', 'E am eigenen Spind öffnet die Konsole spind');
setze(p1, 12, 27, 'right');
druecke(p1);
ok(p1.console === 'spind' && p0.console === 'spind', 'Spieler 1 öffnet gleichzeitig seinen Spind: nicht exklusiv, kein „besetzt“');
ok(notices(cs[0]) === n0 && notices(cs[1]) === 0, 'beim Öffnen kein Hinweistext');
// fremder Spind: Spieler 0 steht an Spieler 1s Spind
setze(p0, 12, 27, 'right');
druecke(p0);
ok(p0.console === null && notices(cs[0]) === n0, 'fremder Spind: nichts passiert, kein Hinweis');
// Bot ohne Karte am eigenen Spind
setze(p2, 26, 17, 'right');
druecke(p2);
ok(p2.console === null, 'ohne Karte: E am eigenen Spind öffnet nichts');

// ---- karte.outfit
const NEU = { kopf: 'bordhelm', oberteil: 'plankenweste', hose: 'bordhose', schuhe: 'bordstiefel', haende: 'keine', umhang: 'fellumhang' };
const karteEvents = (c) => c.inbox.filter((m) => m.t === 'event' && m.kind === 'karte');
const leere = () => cs.forEach((c) => { c.inbox.length = 0; });
const sende = (i, outfit, extra) => g.handleMessage(cs[i], Object.assign({ t: 'cmd', c: 'karte.outfit', outfit }, extra || {}));
const vorher = JSON.stringify(Object.assign({}, p0.karte, { outfit: null }));
setze(p0, 20, 6, 'down');   // Gang auf dem Mitteldeck, keine Konsole
leere(); sende(0, NEU);
ok(p0.karte.outfit.kopf === 'keine' && cs.every((c) => !karteEvents(c).length), 'karte.outfit außerhalb der Konsole: ignoriert, kein Ereignis');
p0.console = 'helm'; leere(); sende(0, NEU); p0.console = null;
ok(p0.karte.outfit.kopf === 'keine' && cs.every((c) => !karteEvents(c).length), 'karte.outfit an einer anderen Konsole (Steuer): ignoriert');
setze(p0, 26, 27, 'right'); druecke(p0);
ok(p0.console === 'spind', 'Spieler 0 wieder am Spind');
leere(); sende(0, NEU);
ok(p0.karte.outfit.kopf === 'bordhelm' && p0.karte.outfit.umhang === 'fellumhang' && p0.karte.outfit.oberteil === 'plankenweste', 'karte.outfit an der Konsole: Outfit übernommen');
ok(cs.every((c) => karteEvents(c).length === 1 && karteEvents(c)[0].pid === p0.id && karteEvents(c)[0].k.outfit.kopf === 'bordhelm'), 'Ereignis karte geht an alle drei Verbindungen');
leere(); sende(0, NEU);
ok(cs.every((c) => !karteEvents(c).length), 'unverändertes Outfit: kein neues Ereignis');
ok(JSON.stringify(Object.assign({}, p0.karte, { outfit: null })) === vorher, 'Charakterteil (Name, Gesicht, Frisur, Bart, Farben, Körper) unverändert');
// Spieler 1 an seiner Konsole ändert nur seine eigene Karte
leere(); sende(1, Object.assign({}, NEU, { kopf: 'keine' }));
ok(p1.karte.outfit.oberteil === 'plankenweste' && p0.karte.outfit.kopf === 'bordhelm' && karteEvents(cs[0]).length === 1 && karteEvents(cs[0])[0].pid === p1.id, 'jeder ändert nur seine eigene Karte');
// Charakterteil per karte.outfit nicht änderbar
leere();
sende(0, { kopf: 'keine', oberteil: 'bordtunika', hose: 'bordhose', schuhe: 'bordstiefel', haende: 'keine', umhang: 'keiner', gesicht: 'narbe', frisur: 'zoepfe', bart: 'vollbart', name: 'Hacker', haut: 3, koerper: 'riese' },
  { name: 'Hacker', gesicht: 'narbe', frisur: 'zoepfe', haut: 3, haar: 0, koerper: 'riese', karte: { gesicht: 'narbe', name: 'Hacker', outfit: NEU } });
ok(JSON.stringify(Object.assign({}, p0.karte, { outfit: null })) === vorher && p0.name === 'Aurelia', 'zusätzliche Felder (Name, Gesicht, Frisur, Farben, Körper, ganze Karte) ändern den Charakter nicht');
ok(Object.keys(p0.karte.outfit).sort().join() === 'haende,hose,kopf,oberteil,schuhe,umhang' && p0.karte.outfit.kopf === 'keine' && p0.karte.outfit.umhang === 'keiner', 'im Outfit stehen genau die sechs Plätze (fremde Schlüssel fallen weg)');
// ungültige Teile → Standard
sende(0, { kopf: 'gibtsnicht', oberteil: 'fellumhang', hose: 5, schuhe: null });
ok(p0.karte.outfit.kopf === 'keine' && p0.karte.outfit.oberteil === 'bordtunika' && p0.karte.outfit.hose === 'bordhose' && p0.karte.outfit.schuhe === 'bordstiefel', 'ungültige oder fremde Teile werden zum Standard');
// ohne Karte: nichts
leere(); sende(2, NEU); p2.console = 'spind'; sende(2, NEU); p2.console = null;
ok(!p2.karte && cs.every((c) => !karteEvents(c).length), 'ohne Karte: karte.outfit bewirkt auch an einer (erzwungenen) Konsole nichts');

// ---- Alarm blockiert nicht
g.ship.alert = 'red';
setze(p1, 12, 27, 'right'); druecke(p1);
ok(p1.console === 'spind', 'bei Alarm (rot) öffnet der Spind');
leere(); sende(1, NEU);
ok(p1.karte.outfit.kopf === 'bordhelm' && cs.every((c) => karteEvents(c).length === 1), 'bei Alarm: Umziehen wird angenommen und verteilt');
g.ship.alert = 'normal';

// ---- Verlassen
g.handleMessage(cs[1], { t: 'leave' });
ok(p1.console === null, 'Verlassen schließt die Konsole');
leere(); sende(1, Object.assign({}, NEU, { kopf: 'keine' }));
ok(p1.karte.outfit.kopf === 'bordhelm' && cs.every((c) => !karteEvents(c).length), 'nach dem Verlassen wird karte.outfit wieder ignoriert');
ok(p0.console === 'spind', 'Spieler 0 bleibt am Spind, wenn Spieler 1 geht');

console.log(fehler ? `${fehler} von ${n} Prüfungen fehlgeschlagen` : `Alle ${n} Prüfungen bestanden`);
process.exit(fehler ? 1 : 0);
