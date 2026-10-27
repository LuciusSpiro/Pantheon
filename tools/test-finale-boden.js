'use strict';
// SUND-04a-3 Boden (server/sim/finale-boden.js, content/welt/finale-boden.json, Fraktion hrafnheim_wache, Landepunkt hrafnheim.schrein). Direkt gegen die Game-Klasse.
// Erwartungen aus dem Vertrag des Pakets, nicht aus dem Code:
//   Daten · Fraktion/Katalog · bodenStarten baut die Karte, setzt das Transferziel · Landepunkt nur im Finale anwaehlbar · normales Hinunterbeamen (transfer.down) ·
//   Gegner erscheinen genau einmal beim Landen, Zahl nach Crewgroesse · Schrein erst nach dem Waechter · Sieg = bodenEnde('sieg') genau einmal ·
//   Crew gefallen / Hochbeamen = bodenEnde('crew_gefallen'), Neubeginn, zweiter Versuch geht · Laden mitten im Boden = Finale phase null ·
//   kein game.rng · Weltstand ohne Spur · Bot-Lauf solo und zu dritt (Landung, Waechter erschiessen, Schrein halten).
//   node tools/test-finale-boden.js [begriff …]   (npm run test:finale-boden)
const fs = require('fs');
const os = require('os');
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const CONFIG = require('../shared/config.js');
const { Game } = require('../server/game.js');
const Finale = require('../server/sim/finale.js');
const FB = require('../server/sim/finale-boden.js');
const LP = require('../server/sim/landepunkte.js');
const Anker = require('../server/sim/anker.js');
const away = require('../server/sim/away.js');
const interior = require('../server/sim/interior.js');
const combat = require('../server/sim/combat.js');
const Kat = require('../server/mission/katalog.js');
const Weltstand = require('../server/weltstand.js');

const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
let n = 0, fails = 0;
const ok = (c, t) => { n++; if (c) console.log('  ok   ' + t); else { fails++; console.log('  FEHLER ' + t); } };
function section(name, fn) {
  if (FILTER.length && !FILTER.some((f) => name.toLowerCase().includes(f))) return;
  console.log('\n' + name);
  try { fn(); } catch (e) { fails++; n++; console.log('  FEHLER Ausnahme: ' + (e && e.stack)); }
}

const D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'welt', 'finale-boden.json'), 'utf8'));
const ID = D.landepunkt.id;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pantheon-finale-boden-'));
let seq = 0;
const HZ = CONFIG.tickHz;
const run = (g, sek) => { for (let i = 0; i < Math.round(sek * HZ); i++) g.step(); };

// Spiel mit `crew` Spielern in Freie Fahrt Sund, am Ort hrafnheim, Rang Tribun
function neu(crew, seed) {
  const dir = path.join(TMP, 'w' + (++seq)); fs.mkdirSync(dir, { recursive: true });
  const g = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: dir, seed: seed || 3, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const cs = [];
  for (let i = 0; i < (crew || 1); i++) {
    const c = { inbox: [], send(m) { if (this.inbox.length < 800) this.inbox.push(m); }, sendRaw(s) { this.send(JSON.parse(s)); } };
    g.addConnection(c); g.handleMessage(c, { t: 'hello', clientId: 'B' + i, name: 'B' + i, color: i }); cs.push(c);
  }
  g.handleMessage(cs[0], { t: 'lobbyOpt', startMission: 'freie_fahrt' });
  for (const c of cs) g.handleMessage(c, { t: 'ready', ready: true });
  run(g, 1);
  g.space.enemies = [];
  g.debugGoto('hrafnheim', false); run(g, 2);
  g.weltsim.ruf.rom = 1e9;
  const radio = [];
  const emit0 = g.emit.bind(g);
  g.emit = (k, d) => { if (k === 'radio') radio.push(d.text); return emit0(k, d); };
  const t = { g, cs, ps: g.players, radio, dir, boden: [], abspann: [], bodenEnde0: Finale.bodenEnde };
  Finale.ersetzen('szene', { finaleStarten: () => ({ id: 1 }) });
  Finale.ersetzen('abspann', { beenden: (game, art) => { t.abspann.push(art); return true; } });
  Finale.bodenEnde = (game, a) => { t.boden.push(a); return t.bodenEnde0(game, a); };   // zaehlt die Meldungen (Finale().bodenEnde wird beim Aufruf nachgeschlagen)
  t.fertig = () => { Finale.bodenEnde = t.bodenEnde0; Finale.ersetzen('szene', null); Finale.ersetzen('abspann', null); };
  return t;
}
const imBoden = (t) => { t.g.ship.speed = 0; return Finale.starten(t.g) && Finale.orbitEnde(t.g, 'sieg'); };
// Hinunterbeamen wie die Crew: alle auf die Pads, Transfer-Konsole, Befehl transfer.down
function hinunter(t) {
  t.ps.forEach((p, i) => { interior.placeOnShipPad(t.g, p, i); p.console = 'transfer'; });
  t.g.handleMessage(t.cs[0], { t: 'cmd', c: 'transfer.down' });
  run(t.g, 6);
}
const unten = (t) => t.ps.filter((p) => p.zone === 'away');
const drones = (t) => (t.g.away && t.g.away.drones) || [];
const lebende = (t) => drones(t).filter((e) => e.alive);

// Bot: schiesst auf den Waechter (versetzt sich auf eine freie Kachel in 4 Kacheln Abstand, zielt, echtes away.shoot), danach haelt er den Schrein (Versetzen auf den Anker, E halten)
function botBoss(t, maxSek) {
  const g = t.g, aw = g.away, map = interior.awayInfoOf(aw.map).map;
  const t0 = g.time;
  for (let i = 0; i < HZ * maxSek; i++) {
    const boss = aw.drones.find((d) => d.boss && d.alive);
    if (!boss || !g.finaleBoden || g.finaleBoden.ende) break;
    for (const p of unten(t)) {
      if (p.downed) continue;
      if (Math.hypot(p.x - boss.x, p.y - boss.y) > 200 || i % 60 === 0) {
        for (const [ox, oy] of [[-4, 0], [4, 0], [0, -4], [0, 4], [-3, -3], [3, 3]]) {
          const tx = Math.floor(boss.x / 32) + ox, ty = Math.floor(boss.y / 32) + oy;
          if (!map.solid(tx, ty)) { p.x = tx * 32 + 16; p.y = ty * 32 + 16; break; }
        }
      }
      away.shoot(g, p, Math.atan2(boss.y - p.y, boss.x - p.x));
    }
    g.step();
  }
  return g.time - t0;
}
function botSchrein(t, maxSek) {
  const g = t.g, k = LP.karte(g, ID), z = k.anker.find((a) => a.id === g.finaleBoden.ziel);
  const p = unten(t)[0];
  const t0 = g.time;
  p.x = z.x * 32 + 16; p.y = z.y * 32 + 16;
  interior.onAct(g, p, true);
  for (let i = 0; i < HZ * maxSek && !(g.finaleBoden && g.finaleBoden.ende); i++) { if (!p.hold) interior.onAct(g, p, true); g.step(); }
  return g.time - t0;
}

// ---------------------------------------------------------------------------------------------
section('Daten', () => {
  const W = D.gegner.nach_crew.wert;
  ok(ID === 'hrafnheim.schrein' && D.landepunkt.art === 'aussenposten' && /^germanen_halle_(stein|holz)$/.test(D.landepunkt.bauweise), 'Landepunkt hrafnheim.schrein, Siedlung, Bauweise germanen_halle_*');
  ok(Number.isInteger(D.landepunkt.seed) && D.landepunkt.beam_reichweite > 0, 'fester Seed, Reichweite des Transferpunkts als Zahl');
  ok(W['1'] >= 1 && W['1'] < W['2'] && W['2'] < W['3'] && W['3'] <= W['4'], 'Wachen steigen mit der Crewgroesse (1 < 2 < 3 <= 4), Solo hat Gegner, aber weniger');
  ok(FB.wachenFuer(1) === W['1'] && FB.wachenFuer(2) === W['2'] && FB.wachenFuer(3) === W['3'] && FB.wachenFuer(9) === W['4'] && FB.wachenFuer(0) === W['1'], 'wachenFuer: Tabelle, ueber 4 der hoechste, unter 1 der kleinste');
  ok(['boss', 'wachen', 'boss_oder_wachen'].includes(D.freigabe.nach) && D.freigabe.nach === 'boss', 'Freigabe des Schreins aus den Daten: nach dem Waechter');
  ok(D.abbruch.wert === 'neubeginn', 'Abbruch = Neubeginn (Daten)');
  const Buehne = require('../shared/buehne.js');
  ok(Buehne.daten().anker.rollen[D.schrein.rolle] && D.schrein.rolle === 'ziel', 'Anker-Rolle des Schreins ist ziel (gibt es in anker.json)');
  const txt = JSON.stringify(D.texte);
  ok(['bereit', 'landung', 'frei', 'frei_wachen', 'schrein'].every((k) => D.texte.funk[k]) && D.texte.sperre && D.texte.sperre_wachen && D.texte.sperrgrund, 'alle Texte da');
  ok(!/\b(Ada|Bo|Cem)\b/.test(txt) && !/B[0-9]/.test(txt), 'keine Spielernamen in den Texten');
  const k = Kat.load();
  const f = k.fraktionen[D.gegner.fraktion];
  ok(k.fehler.length === 0, 'Katalog-Pruefer: keine Fehler (' + k.fehler.length + ')');
  ok(f && f.nur_skript === true && f.id === 'hrafnheim_wache' && f.staerke.klein && Object.keys(f.rezepte).length >= 1, 'Fraktion hrafnheim_wache im Katalog, nur_skript');
  const bes = Kat.pruefeBesetzung([{ fraktion: 'hrafnheim_wache', staerke: 'mittel', haltung: 'ruhig' }], { katalog: k, rollen_gesehen: [], spieler: 3 });
  ok(bes.fehler.some((e) => /nur_skript/.test(e.msg)), 'Spielleiter-Besetzung mit der Finale-Fraktion wird abgelehnt');
  const Context = require('../server/mission/context.js');
  const c = Context.build({}, {}, k);
  ok(!(c.fraktionen || []).some((x) => x.id === 'hrafnheim_wache') && (c.fraktionen || []).length === Object.values(k.fraktionen).filter((x) => !x.nur_skript).length, 'Kontext des Spielleiters nennt die Finale-Fraktion nicht');
  ok(LP.defs().byId[ID] === undefined, 'der Landepunkt steht nicht statisch in landepunkte.json (Laufzeit mit festem Seed)');
});

section('bodenStarten: Karte, Transferziel, Sperrgrund', () => {
  const t = neu(1); const g = t.g;
  ok(LP.waehlen(g, ID, t.ps[0]) !== null && LP.liste(g, 'hrafnheim').every((x) => x.id !== ID), 'ohne Finale: Landepunkt unbekannt / nicht in der Liste');
  ok(FB.sperrgrund(g, ID) === D.texte.sperrgrund, 'Sperrgrund ohne Finale: der Text aus den Daten');
  g.ship.speed = 0; Finale.starten(g);
  ok(Finale.phase(g) === 'orbit' && FB.sperrgrund(g, ID) === D.texte.sperrgrund, 'in der Phase orbit: gesperrt');
  ok(Finale.orbitEnde(g, 'sieg') && Finale.phase(g) === 'boden', 'Finale: Orbit-Sieg -> Phase boden, bodenStarten ok');
  const S = g.finaleBoden;
  ok(S && S.lp === ID && !S.gelandet && !S.frei && !S.ende, 'Zustand: Landepunkt, noch nicht gelandet');
  const k = LP.karte(g, ID);
  ok(k && k.w >= 60 && k.h >= 40 && g.aways[ID] && g.aways[ID].map === ID, `Karte gebaut (${k.w}x${k.h}), registriert`);
  const rollen = {}; for (const a of k.anker) rollen[a.rolle] = (rollen[a.rolle] || 0) + 1;
  ok(rollen.eingang >= 1 && rollen.ziel === 1 && rollen.wache >= 1 && rollen.patrouille >= 1 && rollen.abholpunkt >= 1 && rollen.terminal >= 1, 'Anker: eingang, ziel (genau einer), wache, patrouille, abholpunkt, terminal ' + JSON.stringify(rollen));
  ok(S.ziel === k.anker.find((a) => a.rolle === 'ziel').id && Anker.zustand(g, ID, S.ziel) === 'frei', 'Schrein = Anker ziel, Zustand frei (aber gesperrt)');
  ok(g.aways[ID].ankerSperre && g.aways[ID].ankerSperre[S.ziel] === D.texte.sperre, 'Schrein gesperrt, Text aus den Daten');
  ok(g.transferZiel && g.transferZiel.lp === ID && g.transferZiel.scene === g.ship.scene, 'Transferziel: der Schrein-Landepunkt');
  ok(LP.liste(g, 'hrafnheim').some((x) => x.id === ID && x.frei) && LP.sperrgrund(g, ID) === null, 'im Finale: in der Transfer-Liste, anwaehlbar');
  ok(LP.beamSpot(g) && LP.beamSpot(g).map === ID, 'Transferpunkt gesetzt');
  ok(t.radio.some((x) => x === D.texte.funk.bereit), 'Funk: Transfer ist gestellt');
  ok(!('hrafnheim.schrein' in LP.toSave(g)), 'der Landepunkt steht nicht im Weltstand-Block (fluechtig)');
  // gleicher Seed = gleiche Karte
  const rows1 = JSON.stringify(k.rows);
  ok(g.errors === 0, 'kein Serverfehler');
  // Phase orbit: gesperrt
  // zweiter Aufbau (Neubeginn) liefert dieselbe Karte
  Finale.bodenEnde(g, 'crew_gefallen'); run(g, 1);
  ok(!g.finaleBoden && !g.aways[ID] && LP.waehlen(g, ID, t.ps[0]) !== null, 'nach dem Ende: Landepunkt weg, wieder gesperrt/unbekannt');
  ok(imBoden(t), 'zweiter Versuch: Finale erneut bis in den Boden');
  ok(g.finaleBoden && JSON.stringify(LP.karte(g, ID).rows) === rows1, 'zweiter Versuch: dieselbe Karte (fester Seed)' + (g.finaleBoden ? '' : ' [kein Boden-Zustand, Phase ' + Finale.phase(g) + ']'));
  t.fertig();
});

section('Beamen und Gegner: genau einmal, nach Crewgroesse', () => {
  for (const crew of [1, 2, 3]) {
    const t = neu(crew); const g = t.g;
    imBoden(t);
    ok(t.ps.every((p) => p.zone === 'ship'), `${crew}: vor der Landung alle an Bord, keine Gegner`);
    let ek = 0; const me0 = g.missionEvent.bind(g); g.missionEvent = (k, d) => { if (k === 'endkampfAngriff') ek++; return me0(k, d); };
    hinunter(t);
    ok(unten(t).length === crew && g.away.map === ID, `${crew}: normales Beamen (transfer.down): alle am Boden auf ${ID}`);
    const soll = FB.wachenFuer(crew);
    ok(g.finaleBoden.gelandet && lebende(t).length === soll + 1, `${crew}: ${soll} Wachen + Waechter (${lebende(t).length})`);
    ok(drones(t).filter((e) => e.boss).length === 1 && drones(t).every((e) => e.fraktion === 'hrafnheim_wache' && e.tag === D.gegner.tag), `${crew}: ein Waechter, alle aus der Fraktion hrafnheim_wache`);
    ok(t.radio.some((x) => x === D.texte.funk.landung), `${crew}: Funk zur Landung`);
    run(g, 10);
    ok(ek === 1, `${crew}: Angriff genau einmal (${ek}) auch nach 10 s`);
    // ein zweites Beamen (hoch und wieder runter) spawnt nichts nach
    t.fertig();
  }
  const w = [1, 2, 3].map(FB.wachenFuer);
  ok(w[0] < w[1] && w[1] < w[2], 'Skalierung: mehr Spieler, mehr Wachen ' + w.join(' < '));
});

section('Schrein nur nach dem Waechter', () => {
  const t = neu(2); const g = t.g;
  imBoden(t); hinunter(t);
  const k = LP.karte(g, ID), z = k.anker.find((a) => a.rolle === 'ziel');
  const p = t.ps[0];
  const list = []; interior.interactionsAt ? null : null;
  Anker.interactionsAt(g, p, z.x, z.y, list);
  ok(list.length === 1 && list[0].blocked === D.texte.sperre, 'vor dem Waechter: Interaktion gesperrt mit Hinweis');
  ok(Anker.holdValid(g, p, { kind: 'anker:ziel', anker: z.id }) === false, 'vor dem Waechter: Halten ungueltig');
  const zi = k.anker.findIndex((a) => a.id === z.id);
  const sn = (gg) => { for (let i = 0; i < 6; i++) { const s = gg.snapshot(); if (s.away && s.away.ao) return s.away; } return {}; };
  ok(Array.isArray(sn(g).sp) && sn(g).sp.includes(zi), 'Snapshot away.sp nennt den gesperrten Schrein (der Client zeigt Versiegelt)');
  const q = t.ps[1]; p.x = q.x = z.x * 32 + 16; p.y = q.y = z.y * 32 + 16;
  interior.onAct(g, p, true); run(g, 4);
  ok(Anker.zustand(g, ID, z.id) === 'frei' && !p.hold && !g.finaleBoden.frei && g.finaleBoden.ende === null, 'vier Sekunden halten vor dem Waechter: nichts passiert');
  const boss = drones(t).find((e) => e.boss);
  for (const e of drones(t)) if (!e.boss) { e.alive = false; e.hp = 0; }
  run(g, 1);
  ok(!g.finaleBoden.frei, 'alle Wachen besiegt, Waechter steht (freigabe boss): weiter gesperrt');
  boss.alive = false; boss.hp = 0; run(g, 1);
  ok(g.finaleBoden.frei && !(g.away.ankerSperre && g.away.ankerSperre[z.id]), 'Waechter besiegt: Schrein frei');
  ok(sn(g).sp === undefined, 'Snapshot ohne away.sp, sobald frei');
  ok(t.radio.some((x) => x === D.texte.funk.frei), 'Funk zur Freigabe');
  ok(t.boden.length === 0, 'noch kein bodenEnde');
  interior.onAct(g, p, false); interior.onAct(g, p, true); run(g, 4);
  ok(Anker.zustand(g, ID, z.id) === 'aktiviert' && t.boden.length === 1 && t.boden[0] === 'sieg', 'Schrein gehalten: aktiviert, bodenEnde("sieg")');
  t.fertig();
});

section('Sieg genau einmal', () => {
  const t = neu(1); const g = t.g;
  imBoden(t); hinunter(t);
  botBoss(t, 120);
  ok(g.finaleBoden.frei && drones(t).length === 0, 'Waechter erschossen: Schrein frei, Wachen ziehen ab (Daten)');
  botSchrein(t, 20);
  run(g, 6);
  ok(t.boden.length === 1 && t.boden[0] === 'sieg', 'bodenEnde("sieg") genau einmal (' + t.boden.join(',') + ') auch nach 6 s weiter');
  ok(Finale.phase(g) === 'ende' && t.abspann.length === 1 && t.abspann[0] === 'sieg', 'Phase ende, Abspann genau einmal');
  ok(g.errors === 0, 'kein Serverfehler');
  // die Crew kann hochbeamen (Transferziel bleibt, solange jemand unten ist), danach raeumt der Treiber auf
  ok(g.transferZiel && g.transferZiel.lp === ID, 'Transferziel bleibt, solange die Crew unten ist');
  ok(LP.liste(g, 'hrafnheim').every((x) => x.id !== ID) && LP.waehlen(g, ID, t.ps[0]) === D.texte.sperrgrund, 'nach dem Finale: der Landepunkt steht nicht mehr in der Transfer-Liste und ist nicht anwaehlbar');
  away.executeBeam(g, [t.ps[0].id], 'up'); run(g, 2);
  ok(!g.finaleBoden && !g.aways[ID] && g.transferZiel === null, 'Crew oben: Landepunkt aufgeraeumt');
  ok(t.boden.length === 1, 'weiterhin genau eine Meldung');
  t.fertig();
});

section('Crew gefallen und Abbruch: Neubeginn', () => {
  // Notrueckholung (alle verwundet)
  let t = neu(2); let g = t.g;
  imBoden(t); hinunter(t);
  combat.squadRecall(g); run(g, 1);
  ok(t.boden.length === 1 && t.boden[0] === 'crew_gefallen', 'Notrueckholung: bodenEnde("crew_gefallen") einmal');
  ok(Finale.phase(g) === null && g.weltsim.finale.angebot === 1, 'Finale: Neubeginn (phase null, Angebot steht), kein Game Over');
  ok(t.radio.some((x) => x === require('../content/welt/finale-werte.json').texte.funk.crew_gefallen), 'Funk des Finale zum Ende des Einsatzes (neutraler Text, gilt auch fuer den freiwilligen Abbruch)');
  run(g, 3);
  ok(!g.finaleBoden && !g.aways[ID] && t.boden.length === 1, 'Landepunkt aufgeraeumt, keine zweite Meldung');
  // zweiter Versuch
  ok(Finale.waehlen(g) === null, "Finale laesst sich neu beginnen: Anfrage"); run(g, 1); ok(Finale.bestaetigen(g) === null, "Bestaetigung");
  g.ship.speed = 0; Finale.orbitEnde(g, 'sieg');
  ok(g.ship.systems.transfer !== 'ok', 'Notrueckholung beschaedigt den Transfer (bekannte Mechanik PAN-01 A, nicht Teil des Pakets)');
  g.ship.systems.transfer = 'ok';   // repariert
  hinunter(t);
  ok(g.finaleBoden && g.finaleBoden.gelandet && lebende(t).length === FB.wachenFuer(2) + 1, 'zweiter Versuch: neue Gegner (einmal), Karte frisch');
  // freiwilliges Hochbeamen mitten im Kampf
  away.executeBeam(g, t.ps.map((p) => p.id), 'up'); run(g, 1);
  ok(t.boden.length === 2 && t.boden[1] === 'crew_gefallen' && Finale.phase(g) === null, 'Hochbeamen mitten im Finale: Abbruch = Neubeginn (kein Game Over, keine Strafe)');
  ok(g.weltsim.ruf.rom === 1e9, 'keine Ruf-Folge');
  // nur einer geht hoch: Finale laeuft weiter
  run(g, 2); Finale.waehlen(g); run(g, 1); Finale.bestaetigen(g); g.ship.speed = 0; Finale.orbitEnde(g, "sieg"); hinunter(t);
  away.executeBeam(g, [t.ps[0].id], 'up'); run(g, 1);
  ok(Finale.phase(g) === 'boden' && t.boden.length === 2, 'geht nur einer hoch, laeuft der Boden-Teil weiter');
  // Schiff fliegt vor der Landung weg
  const t3 = neu(1); imBoden(t3); t3.g.ship.scene = 'kesh'; run(t3.g, 1);
  ok(t3.boden.length === 1 && t3.boden[0] === 'crew_gefallen', 'Schiff verlaesst den Ort vor der Landung: Neubeginn');
  t3.fertig(); t.fertig();
});

section('Laden mitten im Boden', () => {
  const t = neu(1); const g = t.g;
  imBoden(t); hinunter(t);
  g.markSaveDue('missionDone'); run(g, 2);
  const files = fs.readdirSync(g.worldDir).filter((f) => /^w-.*\.json$/.test(f) && !/bak/.test(f));
  ok(files.length >= 1, 'Weltstand-Datei geschrieben');
  const d = JSON.parse(fs.readFileSync(path.join(g.worldDir, files[0]), 'utf8'));
  ok(!JSON.stringify(d).includes(ID) && !JSON.stringify(d).includes('finaleBoden'), 'Datei enthaelt weder den Landepunkt noch den Boden-Zustand');
  const idw = files[0].replace('.json', ''); if (Weltstand.unlock) Weltstand.unlock(g.worldDir, idw);
  const g2 = new Game({ noStore: true, worlds: true, worldSaveSync: true, worldDir: g.worldDir, seed: 3, debug: true, env: { MISSION_SOURCE: 'fallback', SPIELLEITER_LLM: 'off', REGIE_DIR: path.join(TMP, 'regie') }, log: () => {} });
  const c2 = { inbox: [], send() {}, sendRaw() {} }; g2.addConnection(c2); g2.handleMessage(c2, { t: 'hello', clientId: 'B0', name: 'B0', color: 0 });
  g2.continueWorld(idw); run(g2, 2);
  ok(Finale.phase(g2) === null, 'geladen: Finale phase null (bekannt: nicht speicherbar, Neubeginn)');
  ok(g2.players[0].zone === 'ship' && g2.ship.docked, 'geladen: Crew an Bord, am Dock');
  ok(!g2.finaleBoden && !(g2.aways && g2.aways[ID]) && LP.liste(g2, 'hrafnheim').every((x) => x.id !== ID), 'geladen: kein Boden-Zustand, kein Schrein-Landepunkt');
  t.fertig();
});

section('Zufall und Weltstand', () => {
  const t = neu(1); const g = t.g;
  const vorher = JSON.stringify(g.weltsim.zustand);
  let zug = 0;
  for (const k of Object.keys(g.rng)) if (typeof g.rng[k] === 'function') { const f = g.rng[k].bind(g.rng); g.rng[k] = (...a) => { zug++; return f(...a); }; }
  const rng0 = g.rng;
  imBoden(t);
  ok(zug === 0, 'bodenStarten zieht nichts aus game.rng (' + zug + ')');
  t.ps.forEach((p, i) => { interior.placeOnShipPad(g, p, i); });
  g.transferZiel = { lp: ID, scene: g.ship.scene }; g.setAwayMap(ID);
  away.executeBeam(g, [t.ps[0].id], 'down');
  FB.update(g);
  ok(g.finaleBoden.gelandet && lebende(t).length > 0 && zug === 0 && g.rng === rng0, 'Landung (Gegner erscheinen) zieht nichts aus game.rng (' + zug + ')');
  ok(JSON.stringify(g.weltsim.zustand) === vorher, 'Sim-Zustand (weltsim.zustand) vom Boden unberuehrt');
  away.executeBeam(g, [t.ps[0].id], 'up'); run(g, 2);
  ok(Finale.phase(g) === null && !('hrafnheim.schrein' in LP.toSave(g)), 'danach: kein Landepunkt im Weltstand-Block');
  t.fertig();
});

section('Bot-Lauf: landen, Waechter besiegen, Schrein halten', () => {
  for (const crew of [1, 3]) {
    const t = neu(crew); const g = t.g;
    imBoden(t); hinunter(t);
    const d1 = botBoss(t, 240);
    const hp = t.ps.map((p) => p.downed ? 1 : 0).reduce((a, b) => a + b, 0);
    ok(g.finaleBoden.frei, `${crew} Spieler: Waechter in ${d1.toFixed(1)} s besiegt (Schrein frei, ${hp} am Boden)`);
    const d2 = botSchrein(t, 30);
    ok(t.boden.length === 1 && t.boden[0] === 'sieg' && Finale.phase(g) === 'ende', `${crew} Spieler: Schrein nach ${d2.toFixed(1)} s aktiviert, Sieg (Gesamt ${(d1 + d2).toFixed(1)} s Spielzeit)`);
    console.log(`  MESS crew ${crew}: Waechter ${d1.toFixed(1)} s, Schrein ${d2.toFixed(1)} s, Wachen ${FB.wachenFuer(crew)}`);
    t.fertig();
  }
});

console.log(`\n${n - fails}/${n} ok` + (fails ? `, ${fails} FEHLER` : ''));
process.exit(fails ? 1 : 0);
