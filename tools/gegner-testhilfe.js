'use strict';
// SYS-01 C1a-1: gemeinsame Testhilfe für Gegner mit Systemmodell (server/sim/gegnersystem.js). Gegner haben keine Hülle mehr:
// e.hp ist die abgeleitete Summe der Systemintegrität. Tests setzen e.hp deshalb nie von Hand, sondern über diese Hilfen.
// Gegner ohne Modell (Störrelais `relay`) behalten die alte Hülle, die Hilfen fallen dort auf e.hp zurück.
const CONFIG = require('../shared/config.js');
const Schilde = require('../shared/schilde.js');
const space = require('../server/sim/space.js');
const Gsys = require('../server/sim/gegnersystem.js');
const Gegnertod = require('../server/sim/gegnertod.js');   // SYS-01 C1a-2: Countdown und Sofort-Tod
const Integ = require('../server/sim/integritaet.js');
const Escort = require('../server/sim/escort.js');   // SYS-01 C2b: Verbündete (Escort-Einträge mit ally)

const schwelle = () => Number(CONFIG.systemModell && CONFIG.systemModell.schwelle) || 0.6;
const zustand = (e, id) => Integ.zustandVon(e.sys[id].i, Gsys.maxOf(e, id), schwelle());

// Gesamtintegrität (Σ der Systeme), ohne Modell die alte Hülle
function gesamtIntegritaet(e) { return Gsys.hat(e) ? Gsys.summe(e) : e.hp; }

// Integrität setzen: ziel = System-Id (z. B. 'reaktor', 'waffe_bug') oder Zone ('bug','stb','heck','bb','mitte' = jedes System der Zone);
// wert in Punkten. Der Zustand folgt der Integrität (gleiche Schwellen wie im Spiel), e.hp wird neu abgeleitet.
function setzeIntegritaet(e, ziel, wert) {
  if (!Gsys.hat(e)) { e.hp = wert; return; }
  const idsZiel = e.sys[ziel] ? [ziel] : Gsys.ids(e).filter((id) => Gsys.defOf(e.kind, id).zone === ziel);
  if (!idsZiel.length) throw new Error('setzeIntegritaet: kein System/keine Zone ' + ziel + ' bei ' + e.kind);
  for (const id of idsZiel) { e.sys[id].i = Math.max(0, wert); e.sys[id].z = zustand(e, id); }
  e.hp = Gsys.summe(e);
}

// Gesamtintegrität auf wert bringen (Anteil an hpMax auf alle Systeme gleich verteilt; wert = hpMax füllt alles auf ok).
function setzeGesamt(e, wert) {
  if (!Gsys.hat(e)) { e.hp = wert; return; }
  const f = Math.max(0, wert) / (e.hpMax || 1);
  for (const id of Gsys.ids(e)) { e.sys[id].i = Gsys.maxOf(e, id) * f; e.sys[id].z = zustand(e, id); }
  e.hp = wert >= e.hpMax ? e.hpMax : Gsys.summe(e);   // voll = exakt hpMax (keine Gleitkomma-Reste)
}

// Klassenbudget setzen (statt e.hp = e.hpMax = n): alle Systeme voll, Maxima neu aus dem Budget
function setzeBudget(e, budget) {
  e.hpMax = budget;
  if (Gsys.hat(e)) setzeGesamt(e, budget); else e.hp = budget;
}

// Schild einer Seite auf 0 (seite 0 Bug, 1 Steuerbord, 2 Heck, 3 Backbord wie shared/schilde.js; ohne seite alle Seiten).
// Mit game werden die Segmente der Klasse (mehrere je Seite) aus dem Layout bestimmt, ohne game gilt der Index als Segment.
function schildNull(e, seite, game) {
  if (!e.shields) return;
  if (seite == null) { for (let i = 0; i < e.shields.length; i++) e.shields[i] = 0; return; }
  const lay = game ? Schilde.layout(game.C, e.kind) : null;
  for (let i = 0; i < e.shields.length; i++) if (!lay || !lay.segs[i] || lay.segs[i].seite === seite) e.shields[i] = 0;
}

// Die Mitte besteht nur noch aus dem Reaktor (die übrigen Systeme der Mitte zerstört): ein Treffer in die Mitte trifft sicher den Reaktor.
function mitteNurReaktor(e) {
  if (!Gsys.hat(e)) return;
  for (const id of Gsys.ids(e)) {
    const d = Gsys.defOf(e.kind, id);
    if (d.zone === 'mitte' && d.art !== 'reaktor') { e.sys[id].i = 0; e.sys[id].z = 'broken'; }
  }
  e.hp = Gsys.summe(e);
}

// Schilde samt Obergrenze setzen (updateEnemies kappt die Schilde auf shieldsMax bzw. die Grenzen aus Emitter und Schildgenerator; ein Test mit Schild 6 braucht Maximum 6)
function setzeSchilde(e, werte) { e.shields = werte.slice(); e.shieldsMax = werte.slice(); }

// SYS-01 C1a-2: Abschuss über den echten Modellpfad mit Zeitvorlauf. Schilde weg; zuerst der Schildgenerator (Übergang wie im Spiel: ein Enterziel
// wird dabei Prise, dann ist der Abschuss erledigt, kein Tod); danach die übrigen Systeme der Mitte, damit ein Durchschlag 'zone' sicher den Reaktor trifft.
// Der Reaktor startet den Countdown (Gegnertod.systemZerstoert), der hier bis zum Ablauf vorgespult wird: der Gegner stirbt über space.enemyDown.
// opts: von = [x, y] (Quelle, Standard 100 px hinter dem Gegner), dazu alle damageEnemy-Optionen. Ohne Modell: alte Hülle (hp 1, Treffer 500).
function toeten(game, e, opts) {
  const o = Object.assign({}, opts || {}); const von = o.von || [e.x - 100, e.y]; delete o.von;
  if (!Gsys.hat(e)) { e.hp = 1; space.damageEnemy(game, e, 500, von[0], von[1], o); return; }
  schildNull(e);
  const sg = Gsys.idVon(e, 'schildgenerator');
  if (sg && e.sys[sg].z !== 'broken' && Gegnertod.brechen(game, e, sg)) return;   // Enterziel: Prise, der Gegner treibt
  mitteNurReaktor(e);
  const r = Gsys.idVon(e, 'reaktor');
  e.sys[r].i = Math.min(e.sys[r].i, 0.01); e.sys[r].z = 'damaged'; e.hp = Gsys.summe(e);
  space.damageEnemy(game, e, 1e6, von[0], von[1], Object.assign(o, { durchschlag: 'zone' }));
  if (e.rt && e.rt.rest != null && game.space.enemies.includes(e) && Gegnertod.tick(game, e, e.rt.rest)) space.enemyDown(game, e);   // Countdown ablaufen lassen
}
// Abschuss ohne Countdown (Tests, die ihn nicht abwarten wollen): wie der Torpedo-Sofort-Tod, kein Kapern. Ohne Modell wie toeten.
function toetenSofort(game, e) {
  if (!Gsys.hat(e)) { toeten(game, e); return; }
  Gegnertod.sofort(e); space.enemyDown(game, e);
}

// SYS-01 C2b: Verbündeten abschießen (Verlust über die Flotte, wie der Tod eines Verbündeten im Spiel): alle Systeme zerstört, Countdown aus, escort.disable -> allyLost.
// Ein einzelner Großtreffer zerstört nur ein System (Trefferweg), darum Tests, die einen Verbündeten abschießen wollen, über diese Hilfe.
function toetenVerbuendeten(game, es) {
  if (!Escort.active(es)) return;   // schon zerstört (Treffer bis 0): kein zweiter Verlust
  if (!Gsys.hat(es)) { Escort.hit(game, es, 1e6, {}); return; }
  Gegnertod.sofort(es); Escort.disable(game, es);
}

module.exports = { toetenVerbuendeten, setzeSchilde, toeten, toetenSofort, mitteNurReaktor, setzeIntegritaet, setzeGesamt, setzeBudget, gesamtIntegritaet, schildNull };
