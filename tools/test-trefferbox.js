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
// game.js ist kein Freibrief: nur die Verteilung der Karte darf sie lesen. Jede Fundstelle wird der umschließenden Methode zugeordnet (Zeile `  name(...) {` mit zwei Leerzeichen Einzug).
// Erlaubt: onHello (Platzübernahme), helloKarte, sendeKarte, raeumeKarte (Lobby verlassen), karteOutfit, welcomeMsg; dazu die Kopfzeilen (Import, Katalog). Empfänger reg/sektorkarteCache sind Sim-Daten (Landepunkt-Registry, Sektorkarte).   Ebenso W.AWAY_MAPS[..].karte (Landepunkt-Karten).
const GAME_ERLAUBT = new Set(['onHello', 'helloKarte', 'sendeKarte', 'raeumeKarte', 'karteOutfit', 'hatCharakterkarte', 'welcomeMsg']);
const GAME_KOPF = /^(?:const Charakter = require\('\.\.\/shared\/charakter\.js'\)|let charakterKatalog|try \{ charakterKatalog)/;
const GAME_LESER = /(?<!\breg|\bsektorkarteCache|\bAWAY_MAPS\[[^\]]*\])\.karte\b|\bCharakter\.|\bcharakterKatalog\b/;
function gameLeser(text) {
  const treffer = []; let methode = null;
  text.split('\n').forEach((z, i) => {
    const m = /^  (?:static |async )?([A-Za-z_]\w*)\(.*\) \{/.exec(z);
    if (m) methode = m[1]; else if (/^\S/.test(z)) methode = null;
    const code = z.replace(/\/\/.*$/, '');
    if (!GAME_LESER.test(code)) return;
    if (methode === null ? (GAME_KOPF.test(code) && !code.includes(".karte")) : GAME_ERLAUBT.has(methode)) return;
    treffer.push('server/game.js:' + (i + 1) + ' (' + (methode || 'Kopf') + ')');
  });
  return treffer;
}
section('Statisch: wer liest die Karte eines Spielers?');
{
  ok(SPIELER_KARTE.test('const x = p.karte.outfit;') && SPIELER_KARTE.test('if (pl.karte) {') && SPIELER_KARTE.test("require('../shared/charakter.js')") && !SPIELER_KARTE.test('const K = info.karte; K.karte.anker'),
    'Selbsttest der Suche: findet p.karte und den Import, ignoriert die Landkarte der Außenmission');
  const alle = dateien('server', []);
  const t = leser(alle);
  const gameText = fs.readFileSync('server/game.js', 'utf8');
  const fremd = t.filter((x) => !x.startsWith('server/game.js:')).concat(gameLeser(gameText));
  const norm = alle.map((f) => f.replace(/\\/g, '/'));
  ok(['server/sim/combat.js', 'server/sim/away.js', 'server/sim/interior.js'].every((f) => norm.includes(f)), 'durchsucht werden unter anderem combat.js, away.js und interior.js (alles unter server/)');
  ok(t.some((x) => x.startsWith('server/game.js:')), 'game.js liest die Karte (Verteilung, Namen): die Suche wirkt');
  const einschleusen = (zeile) => gameText.replace('  karteOutfit(p, msg) {', '  tickSpieler(p) {\n    ' + zeile + '\n  }\n  karteOutfit(p, msg) {');
  ok(gameLeser(einschleusen('const x = p.karte.outfit;')).length === 1 && gameLeser(einschleusen('const y = other.karte;')).length === 1 && gameLeser(einschleusen('const z = Charakter.pruefeName(p.name);')).length === 1 && gameLeser(einschleusen('const w = this.katalogKarte;')).length === 0,
    'Selbsttest game.js: ein Lesen von .karte / Charakter. in einer anderen Methode wird rot, harmlose Zeile nicht');
  ok(gameLeser(gameText.replace('const Charakter = require', 'const Charakter2 = require').replace("charakterKatalog = null;   // CHA", "charakterKatalog = null; let q = p.karte; // CHA")).length >= 1, 'Selbsttest game.js: zusätzliche Karte-Nutzung in der Kopfzeile wird rot');
  ok(fremd.length === 0, 'kein anderer Servercode liest die Spielerkarte' + (fremd.length ? ' (' + fremd.join(', ') + ')' : ''));
}

// ------------------------------------------------------------------ 2. dynamisch
const VOLL = { v: 1, name: 'G0', koerper: 'standard', frisur: 'bartlang', haut: 3, haar: 2,
  outfit: { kopf: 'bordhelm', oberteil: 'plankenweste', hose: 'germanenhose', schuhe: 'germanenstiefel', haende: 'armschiene', umhang: 'fellumhang' } };
const LEER = { v: 1, name: 'G1', koerper: 'standard', frisur: 'keine', haut: 0, haar: 0,
  outfit: { kopf: 'keine', oberteil: 'keine', hose: 'keine', schuhe: 'keine', haende: 'keine', umhang: 'keiner' } };
const mitName = (k, name) => Object.assign({}, k, { name });

const SEKUNDEN = 22;
function lauf(karten, sekunden) {
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
  for (let s = 0; s < (sekunden || SEKUNDEN); s++) {
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
  return { g, spuren, lesen: zaehler.lesen, gegner, aw, zaehler };
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
  { const z = b.zaehler; const vor = z.lesen; z.an = true; void b.g.players[0].karte; void b.g.players[1].karte; z.an = false;
    ok(z.lesen === vor + 2, 'Positivkontrolle: ein absichtliches Lesen von p.karte wird vom Zugriffszähler gezählt (+2)'); }
  ok(b.lesen === 0 && c.lesen === 0, `Server liest p.karte in ${SEKUNDEN} s Spielzeit kein einziges Mal (Zugriffe: ${b.lesen}, ${c.lesen})`);
}

// CHA-02 E1a (Abnahme 12): jede Frisur, jede Kopfbedeckung und jedes Oberteil ändert Kollision, Treffer und Zustand nicht. Je Wert ein Lauf (Spieler 0 trägt ihn,
// Spieler 1 den nächsten Wert desselben Platzes, alles andere Standard), Snapshot je Sekunde tickgenau gleich dem Lauf ohne Karten.
section('Dynamisch: jede Frisur, jede Kopfbedeckung, jedes Oberteil (Katalog Version 2)');
{
  const SEK = SEKUNDEN;   // volle Länge: der Vergleich enthält Treffer und Gegnertode
  const basis = lauf(null, SEK);
  const STD = Ch.standardKarte('x', KAT);
  const werte = (platz) => KAT.teile.filter((t) => t.platz === platz).map((t) => t.id.slice(platz.length + 1));
  const karteMit = (platz, wert, name) => {
    const k = JSON.parse(JSON.stringify(STD)); k.name = name;
    if (platz === 'frisur') k.frisur = wert; else k.outfit[platz] = wert;
    return k;
  };
  const achsen = { frisur: werte('frisur'), kopf: werte('kopf'), oberteil: werte('oberteil') };
  ok(achsen.frisur.length === 9 && achsen.kopf.length === 5 && achsen.oberteil.length === 6, 'Katalog: 9 Frisuren (acht plus keine), 5 Kopfbedeckungen, 6 Oberteile');
  let abweichung = [], laeufe = 0;
  for (const [platz, liste] of Object.entries(achsen)) {
    liste.forEach((w, i) => {
      const r = lauf([karteMit(platz, w, 'G0'), karteMit(platz, liste[(i + 1) % liste.length], 'G1')], SEK);
      laeufe++;
      const getragen = platz === 'frisur' ? r.g.players[0].karte.frisur : r.g.players[0].karte.outfit[platz];
      if (getragen !== w) abweichung.push(platz + '/' + w + ' (nicht übernommen)');
      else if (erstesAbweichen(basis.spuren, r.spuren) !== -1) abweichung.push(platz + '/' + w + ' (Snapshot weicht ab)');
      else if (r.lesen !== 0) abweichung.push(platz + '/' + w + ' (Server liest die Karte)');
    });
  }
  ok(laeufe === 20 && abweichung.length === 0, laeufe + ' Läufe (jede der 8 Frisuren plus keine, jede Kopfbedeckung, jedes Oberteil): Snapshot je Sekunde tickgenau wie ohne Karten' + (abweichung.length ? ': ' + abweichung.join(', ') : ''));
  // Mutationsprobe: ein Spielwert, der an der Kopfbedeckung hängt, wird rot gemeldet (Spieler 0 mit galea bekommt eine andere Position)
  const mut = lauf([karteMit('kopf', 'galea', 'G0'), karteMit('kopf', 'keine', 'G1')], SEK);
  const p0 = mut.g.players[0]; p0.x += 3;
  ok(JSON.stringify(mut.g.snapshot()) !== basis.spuren[SEK - 1], 'Mutationsprobe: eine am Helm hängende Positionsänderung würde im Vergleich rot (Vergleich ist scharf)');
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
