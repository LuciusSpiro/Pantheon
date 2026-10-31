'use strict';
// CHA-01 B2 (Abnahme 10): Die Charakterkarte ändert keine Spielwerte. Kollision, Trefferflächen, Schaden und Zustand hängen nicht an Kleidung oder Aussehen.
//   1. Statisch: außer game.js (Verteilung der Karte) liest kein Servercode die Karte eines Spielers (Suche über server/ mit Ausnahmeliste, Selbsttest der Suche)
//   2. Dynamisch: derselbe Grabenangriff (Bodenkampf mit Gegnern, Bewegung, Schüsse) mit drei Besetzungen – ohne Karten, extrem verschiedene Karten, Karten vertauscht –
//      liefert tickgenau denselben Snapshot, und der Server liest p.karte während der Ticks kein einziges Mal (Zugriffszähler am Spielerobjekt)
//   3. Die Werte, an denen Kollision und Treffer hängen, stehen in der Konfiguration (C.player.hitbox, hitRadius.player) und nicht an der Karte
//   node tools/test-trefferbox.js   (npm run test:trefferbox)
const fs = require('fs');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.MISSION_SOURCE = 'fallback'; process.env.SPIELLEITER_LLM = 'off';
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Wellen = require('../server/sim/wellen.js');
const Ch = require('../shared/charakter.js');
const KAT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'katalog', 'charakter.json'), 'utf8'));

let n = 0, fails = 0;
const ok = (c, t) => { n++; console.log((c ? '  ok   ' : '  FEHLER ') + t); if (!c) fails++; };
const section = (t) => console.log('\n' + t);

// ------------------------------------------------------------------ 1. statisch
// Eine Zeile liest „die Karte eines Spielers“, wenn auf p.karte (auch p2., pl., player., spieler., other.; o./i./q. sind Optionen bzw. Szenen-Info mit der Landkarte) oder auf ein Karten-Feld zugegriffen wird.
// Die Sim-Daten `info.karte` / `K.karte` (Landkarte der Außenmission) sind etwas anderes und treffen das Muster nicht.
const SPIELER_KARTE = /\b(?:p|p\d|pl|pp|player|spieler|other|me|pa|pb|pj)\.karte\b|\bshared\/charakter\b|\bCharakter\./;
function dateien(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) dateien(f, out); else if (f.endsWith('.js')) out.push(f);
  }
  return out;
}
function leser(dateiListe) {
  const treffer = [];
  for (const f of dateiListe) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((z, i) => { if (SPIELER_KARTE.test(z.replace(/\/\/.*$/, ''))) treffer.push(path.relative('.', f).replace(/\\/g, '/') + ':' + (i + 1)); });
  }
  return treffer;
}
section('Statisch: wer liest die Karte eines Spielers?');
{
  ok(SPIELER_KARTE.test('const x = p.karte.outfit;') && SPIELER_KARTE.test('if (pl.karte) {') && SPIELER_KARTE.test("require('../shared/charakter.js')") && !SPIELER_KARTE.test('const K = info.karte; K.karte.anker'),
    'Selbsttest der Suche: findet p.karte und den Import, ignoriert die Landkarte der Außenmission');
  const alle = dateien('server', []);
  const t = leser(alle);
  const fremd = t.filter((x) => !x.startsWith('server/game.js:'));
  const norm = alle.map((f) => f.replace(/\\/g, '/'));
  ok(['server/sim/combat.js', 'server/sim/away.js', 'server/sim/interior.js'].every((f) => norm.includes(f)), 'durchsucht werden unter anderem combat.js, away.js und interior.js (alles unter server/)');
  ok(t.some((x) => x.startsWith('server/game.js:')), 'game.js liest die Karte (Verteilung, Namen): die Suche wirkt');
  ok(fremd.length === 0, 'kein anderer Servercode liest die Spielerkarte' + (fremd.length ? ' (' + fremd.join(', ') + ')' : ''));
}

// ------------------------------------------------------------------ 2. dynamisch
const VOLL = { v: 1, name: 'G0', koerper: 'standard', gesicht: 'narbe', frisur: 'zoepfe', bart: 'vollbart', haut: 3, haar: 2,
  outfit: { kopf: 'bordhelm', oberteil: 'plankenweste', hose: 'germanenhose', schuhe: 'germanenstiefel', haende: 'armschiene', umhang: 'fellumhang' } };
const LEER = { v: 1, name: 'G1', koerper: 'standard', gesicht: 'lerche', frisur: 'keine', bart: 'keiner', haut: 0, haar: 0,
  outfit: { kopf: 'keine', oberteil: 'keine', hose: 'keine', schuhe: 'keine', haende: 'keine', umhang: 'keiner' } };
const mitName = (k, name) => Object.assign({}, k, { name });

const SEKUNDEN = 22;
function lauf(karten) {
  const g = new Game({ noStore: true, seed: 11, debug: true, ruestphase: false, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', LLM_LIVE: '0' }, log: () => {} });
  const cs = [];
  for (let i = 0; i < 2; i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 200) this.inbox.push(m); } };
    cs.push(c); g.addConnection(c);
    const hello = { t: 'hello', clientId: 'G' + i, name: 'G' + i, color: i };
    if (karten && karten[i]) hello.karte = karten[i];
    g.handleMessage(c, hello);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'arena_graben' });
  // Zugriffszähler auf p.karte (Accessor mit demselben Wert); gezählt wird erst ab Rundenstart
  const zaehler = { lesen: 0, an: false };
  for (const p of g.players) {
    let wert = p.karte;
    Object.defineProperty(p, 'karte', { configurable: true, enumerable: true, get() { if (zaehler.an) zaehler.lesen++; return wert; }, set(v) { wert = v; } });
  }
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  zaehler.an = true;
  const spuren = [];
  let tick = 0;
  const hz = CONFIG.tickHz;
  for (let s = 0; s < SEKUNDEN; s++) {
    for (let i = 0; i < hz; i++) {
      if (tick % Math.round(hz / 2) === 0) {
        const oben = tick % (4 * hz) < 2 * hz;
        g.handleMessage(cs[0], { t: 'input', seq: tick + 1, mx: 1, my: oben ? 0.4 : -0.4 });
        g.handleMessage(cs[1], { t: 'input', seq: tick + 1, mx: 1, my: oben ? -0.4 : 0.4 });
      }
      if (tick % Math.round(0.6 * hz) === 0) for (let k = 0; k < 2; k++) g.handleMessage(cs[k], { t: 'shoot', angle: 0 });
      g.step(); tick++;
    }
    spuren.push(JSON.stringify(g.snapshot()));
  }
  zaehler.an = false;
  const aw = g.arena && g.arena.wellen && g.aways[g.arena.wellen.lp];
  const gegner = aw ? aw.drones.filter((e) => e.tag === Wellen.TAG) : [];
  return { g, spuren, lesen: zaehler.lesen, gegner, aw };
}
const erstesAbweichen = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
// Namen stehen in den Karten; alle Läufe benutzen dieselben Namen G0/G1, damit der Snapshot (players[].name) vergleichbar bleibt.
section('Dynamisch: Grabenangriff, drei Besetzungen, gleiche Eingaben');
{
  const a = lauf(null);
  const a2 = lauf(null);
  ok(erstesAbweichen(a.spuren, a2.spuren) === -1, 'Voraussetzung: zwei Läufe ohne Karten sind tickgenau gleich (Sim deterministisch)');
  const b = lauf([mitName(VOLL, 'G0'), mitName(LEER, 'G1')]);
  const c = lauf([mitName(LEER, 'G0'), mitName(VOLL, 'G1')]);
  ok(b.g.players[0].karte.outfit.kopf === 'bordhelm' && b.g.players[1].karte.outfit.oberteil === 'keine' && c.g.players[0].karte.outfit.kopf === 'keine', 'Server hat die extremen Karten übernommen (Bordhelm+Fellumhang+Plankenweste vs. alles leer)');
  ok(b.g.players[0].name === 'G0' && b.g.players[1].name === 'G1', 'Namen in allen Läufen gleich (G0, G1)');
  ok(a.gegner.length > 0 && !!a.aw && a.g.players.every((p) => p.zone === 'away'), `Szenario läuft wirklich (Spieler am Boden, ${a.gegner.length} Gegner)`);
  ok(a.spuren[0] !== a.spuren[SEKUNDEN - 1], 'Snapshot ändert sich über die Zeit (Bewegung, Schüsse)');
  const tot = a.gegner.filter((e) => !e.alive).length;
  const getroffen = a.g.players.some((p) => (p.shield && p.shield.seg < 3) || p.downed || (p.wunden | 0) > 0 || (p.hp != null && p.hp < 100));
  ok(tot > 0 || getroffen, `im Lauf fallen Treffer (${tot} Gegner erledigt, Spieler getroffen: ${getroffen}): der Vergleich ist nicht leer`);
  ok(erstesAbweichen(a.spuren, b.spuren) === -1, 'Snapshot je Sekunde: ohne Karten = Voll/Leer (Positionen, Treffer, Schilde, Gegnerzustände gleich)');
  ok(erstesAbweichen(a.spuren, c.spuren) === -1, 'Snapshot je Sekunde: ohne Karten = Leer/Voll (vertauscht)');
  ok(erstesAbweichen(b.spuren, c.spuren) === -1, 'Voll/Leer = Leer/Voll');
  ok(b.lesen === 0 && c.lesen === 0, `Server liest p.karte in ${SEKUNDEN} s Spielzeit kein einziges Mal (Zugriffe: ${b.lesen}, ${c.lesen})`);
}

// ------------------------------------------------------------------ 3. Werte stehen in der Konfiguration
section('Kollisions- und Trefferwerte kommen aus der Konfiguration');
{
  const C = CONFIG;
  ok(C.player.hitbox && C.player.hitbox.w > 0 && C.player.hitbox.h > 0, `C.player.hitbox { w: ${C.player.hitbox.w}, h: ${C.player.hitbox.h} } (ein Wert für alle Spieler)`);
  ok((C.awayCombat && C.awayCombat.hitRadius && C.awayCombat.hitRadius.player) > 0 && (C.awayExtra && C.awayExtra.hitRadiusPlayer) > 0, `awayCombat.hitRadius.player ${C.awayCombat && C.awayCombat.hitRadius && C.awayCombat.hitRadius.player}, awayExtra.hitRadiusPlayer ${C.awayExtra && C.awayExtra.hitRadiusPlayer}`);
  const text = JSON.stringify(KAT);
  ok(!!Ch.pruefeKarte(VOLL, KAT) && !text.includes('hitbox') && !text.includes('hitRadius'), 'der Katalog kennt keine Maße (kein hitbox, kein hitRadius)');
}

console.log(`\n${n - fails}/${n} ok`);
if (fails) { console.log(fails + ' FEHLER'); process.exit(1); }
