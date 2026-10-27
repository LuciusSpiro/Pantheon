'use strict';
// SYS-01 B2 Teil 2: Cooldown-Zelle der Energiewaffen (Ops-Pult, Ziffernblock).
//  1. Snapshot (Server): rest10 je Energiewaffe am Ladepool (Ganzzahl, Zehntelsekunden); keine Restzeit für Lanze, bereite Waffen, Salve.
//  2. Zeichenmodell (PultSysteme.cdZelle): Füllung von links, Sekunden mit einer Nachkommastelle („1,4 s“), Farbe Sekunden (cdText, beschädigt cdBesch).
//  3. Kontrast über die Tokens: Sekunden und Balken auf dem Zellenkörper in beiden Skins (rom: cdFlaeche, germanen: Platte).
//  4. Quelltext: Ops-Ziffernblock (pult-stationen.js) übergibt die Zelle und Pult.zelle reicht subFarbe/balken weiter.
//   node tools/test-cooldown-zelle.js   (npm run test:cooldown-zelle)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const PS = require('../public/js/pult-systeme-tokens.js');
const { Game } = require('../server/game.js');
const Waffen = require('../server/sim/schiffswaffen.js');
const Katalog = require('../shared/schiffskatalog.js');

let fails = 0, n = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-cooldown-zelle-'));

// ---- 1. Snapshot am echten Server
console.log('\n[Snapshot: Restzeit am Ladepool]');
{
  const g = new Game({ noStore: true, worlds: false, seed: 5, debug: true, env: { MISSION_SOURCE: 'fallback', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c = { inbox: [], send(m) { this.inbox.push(m); }, sendRaw(s) { this.inbox.push(JSON.parse(s)); } };
  g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'F0', name: 'F0', color: 0 });
  g.handleMessage(c, { t: 'lobbyOpt', startMission: 'arena_space' }); g.handleMessage(c, { t: 'ready', ready: true });
  if (g.arena) g.arena.nextAt = null;
  for (let i = 0; i < 30; i++) g.step();   // Arena: Waffen starten geladen (Anfangsstoß)
  g.ship.mount.port.charge = 0.35; g.ship.mount.stbd.charge = 0;   // Batterie 1 lädt bei 35 %, Batterie 2 leer (Testzustand)
  g.step();
  const snap = Waffen.mountsSnapshot(g);
  const energie = snap.filter((m) => m.alloc != null && m.typ !== 'torpedo');
  const laden = energie.filter((m) => m.charge < 1 && m.alloc > 0 && m.state !== 'broken' && m.state !== 'offline' && !(m.salvo > 0) && !m.blk);
  const lanze = snap.filter((m) => m.power !== undefined);   // Server sendet power nur bei der Lanze (Ladeanzeige)
  ok(lanze.length === 1, `genau eine Lanze im Snapshot (${lanze.length})`);
  ok(laden.length >= 1, `mindestens eine ladende Energiewaffe im Snapshot (${laden.length})`);
  ok(laden.every((m) => Number.isInteger(m.rest10) && m.rest10 >= 0), 'jede ladende Batterie trägt rest10 als Ganzzahl');
  const erwartet = laden.map((m) => { const mm = g.ship.mount[m.id]; return Math.ceil((1 - Math.min(1, Math.max(0, mm.charge))) * Waffen.chargeTime(g, m.id) * 10); });
  ok(laden.every((m, i) => Math.abs(m.rest10 - erwartet[i]) <= 1), `rest10 entspricht (1 − Füllung) × Ladezeit am Pool (${laden.map((m) => m.rest10).join(', ')} ⇢ ${erwartet.join(', ')})`);
  ok(lanze.every((m) => m.rest10 === undefined), 'Lanze trägt kein rest10 (eigene Ladeanzeige)');
  const voll = energie.filter((m) => m.charge >= 1);
  ok(voll.every((m) => m.rest10 === undefined), 'geladene Waffe (bereit) trägt kein rest10');
  // Pool-Verteilung: mehr Ladepunkte am Pool = kürzerer Zyklus (ladekosten / Ladepunkte + nachlauf); die Anzeige rechnet mit dem echten Wert
  const mm = laden[0] ? g.ship.mount[laden[0].id] : null;
  if (mm) {
    const alt = mm.alloc;
    mm.alloc = 1; const t1 = Waffen.chargeTime(g, laden[0].id);
    mm.alloc = 2; const t2 = Waffen.chargeTime(g, laden[0].id);
    mm.alloc = alt;
    ok(t2 < t1, `2 Ladepunkte: Zyklus ${t2.toFixed(2)} s, 1 Punkt: ${t1.toFixed(2)} s (kürzer mit mehr Punkten)`);
  }
}

// ---- 2. Zeichenmodell
console.log('\n[Zeichenmodell]');
{
  const z = PS.cdZelle({ charge: 0.6, rest10: 14 }, 'rom');
  ok(z && z.p === 0.6, `Füllung 0,6 von links (p ${z && z.p})`);
  ok(z && z.sek === '1,4 s', `Sekunden „1,4 s“ (${z && z.sek})`);
  ok(z && z.farbe === PS.farben('rom').cdText && z.balken === PS.farben('rom').cdBalken, 'Farben: Sekunden cdText, Balken cdBalken');
  ok(PS.cdZelle({ charge: 0.1, rest10: 20 }, 'rom').sek === '2,0 s', 'ganze Sekunden mit einer Nachkommastelle („2,0 s“)');
  ok(PS.cdZelle({ charge: 0.95, rest10: 1 }, 'germanen').sek === '0,1 s', 'kurze Restzeit („0,1 s“)');
  ok(PS.cdZelle({ charge: 0.4, rest10: 9, besch: true }, 'rom').farbe === PS.farben('rom').cdBesch, 'beschädigte Waffe: Sekunden in cdBesch');
  ok(PS.cdZelle({ charge: 1, rest10: 0 }, 'rom') === null, 'geladen (1) → keine Cooldown-Zelle (bereit)');
  ok(PS.cdZelle({ charge: 0.5 }, 'rom') === null, 'ohne rest10 (Lanze, Salve) → keine Cooldown-Zelle');
  ok(PS.cdZelle({ charge: -0.2, rest10: 5 }, 'rom').p === 0, 'Füllung wird auf 0 begrenzt');
}

// ---- 3. Kontrast über die Tokens (Körper der Zelle: rom cdFlaeche, germanen Platte)
console.log('\n[Kontrast]');
{
  for (const skin of ['rom', 'germanen']) {
    const F = PS.farben(skin);
    const koerper = skin === 'rom' ? F.cdFlaeche : F.kachel;
    const kt = PS.kontrast(F.cdText, koerper), kb = PS.kontrast(F.cdBesch, koerper), kbal = PS.kontrast(F.cdBalken, koerper);
    ok(kt >= 4.5, `${skin}: Sekunden cdText ${kt.toFixed(1)}:1 auf Zellenkörper (≥ 4,5)`);
    ok(kb >= 4.5, `${skin}: beschädigt cdBesch ${kb.toFixed(1)}:1 (≥ 4,5)`);
    ok(kbal >= 3, `${skin}: Balken cdBalken ${kbal.toFixed(1)}:1 (≥ 3)`);
    ok(F.cdText !== F.zerText && F.cdText !== F.zer, `${skin}: Sekunden sind nicht Rot (Rot auf der Zelle nur 3,0:1, Tokens-Regel)`);
  }
}

// ---- 4. Quelltext: Ops-Ziffernblock und Pult.zelle
console.log('\n[Quelltext]');
{
  const st = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pult-stationen.js'), 'utf8');
  const pu = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pult.js'), 'utf8');
  ok(/cdZelle\(\{ charge: ch, rest10: m\.rest10/.test(st), 'pult-stationen.js: Energiewaffe lädt → cdZelle mit Füllung und rest10');
  ok(/subFarbe: cd && cd\.farbe, balken: cd && cd\.balken/.test(st), 'pult-stationen.js: subFarbe und balken an Pult.zelle');
  ok(/opts && opts\.subFarbe/.test(pu) && /opts && opts\.balken/.test(pu), 'pult.js: Pult.zelle (beide Skins) nimmt subFarbe und balken aus opts');
  ok(/K\.zelle\(c, b, kz, label, sub, FN\[fn\] \|\| fn, zustand, p, opts\)/.test(pu), 'pult.js: Wrapper reicht opts an den Skin weiter');
  const co = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'consoles.js'), 'utf8');
  ok(/sel: !!cd && zustand === 'sel'/.test(st) && (pu.match(/opts && opts\.sel/g) || []).length === 2, 'Auswahl: die Cooldown-Zelle (hold) behält in beiden Skins den Auswahlrahmen (opts.sel)');
  ok(/PultSysteme\.cdZelle\(\{ charge: n\(m\.charge\), rest10: m\.rest10/.test(co), 'consoles.js: Ops-Kompaktliste (mountStatus) zeigt die Restsekunden über cdZelle');
}

console.log('\n' + (fails ? 'FEHLER: ' + fails + ' von ' + n : 'alle ' + n + ' Prüfungen grün') + ' (test-cooldown-zelle)');
process.exit(fails ? 1 : 0);
