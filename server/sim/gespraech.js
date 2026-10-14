'use strict';
// SL2 Gespräche mit NSC am Boden (Action-Layer). Feste Zeilen, höchstens eine Wahl, für alle am Ort sichtbar; kein Dialogbaum.
//   beginne(game, p, npc)        Spieler p spricht eine Person der Außenkarte an (E am NSC mit `gespraech`)
//   weiter(game, p)              nächste Zeile bzw. Wahl/Antwort schließen (Initiator; die anderen nach IDLE_FREI s ohne Eingabe)
//   waehle(game, p, optionId)    Option der Wahl
//   schliesse(game, grund?)      Gespräch beenden ohne Ergebnis ('abgebrochen': Weggehen, Verbindung weg)
//   update(game)                 jeden Tick: Gespräch bricht ab, wenn der Initiator geht oder zu weit weg ist
//   snapshot(game)               Snapshot `gp` (nur während eines Gesprächs) { id, nid, n, x, y, t, z, zn, w?, a? }
//   cmd(game, p, c, msg)         Befehle gespraech.next | gespraech.pick { opt } | gespraech.end -> Fehlertext | null
// Daten: content/welt/gespraeche.json. Ergebnis: Flag gespraech_<id> = Option-Id im Missionsstand (Regiebuch: { flag: { gespraech_<id>: 'annehmen' } }),
// Ereignis gespraechBeendet { id, wahl, person } an Mission und Clients. Ein Gespräch läuft zugleich (game.gespraech), sonst keine Parallelität.
const fs = require('fs');
const path = require('path');

const DATEI = path.join(__dirname, '..', '..', 'content', 'welt', 'gespraeche.json');
const REICHWEITE = 200;   // px: weiter weg bricht das Gespräch ab (gut 6 Kacheln)
const IDLE_FREI = 15;     // s: danach darf jeder Mitspieler am Ort weiterklicken

let DATEN = null;
function daten() {
  if (DATEN) return DATEN;
  try { DATEN = JSON.parse(fs.readFileSync(DATEI, 'utf8')); } catch (e) { DATEN = { gespraeche: {} }; }
  return DATEN;
}
function def(id) { const d = daten().gespraeche; return d && d[id] ? d[id] : null; }
function neuLaden() { DATEN = null; return daten(); }

const away = () => require('./away.js');
function person(game, id) { const aw = game.away; return aw ? away().personen(aw).find((n) => n.person === id && n.present && !n.rescued) || null : null; }

function zeile(g) {
  const d = def(g.id); if (!d) return { t: '' };
  if (g.phase === 'antwort') return { t: g.antwort || '' };
  if (g.phase === 'wahl') return { t: (d.wahl && d.wahl.frage) || '' };
  return { t: d.zeilen[g.z] || '' };
}

function beginne(game, p, npc) {
  if (!npc || !npc.gespraech) return 'Mit der Person lässt sich nicht reden.';
  const d = def(npc.gespraech);
  if (!d || !Array.isArray(d.zeilen) || !d.zeilen.length) return 'Dieses Gespräch gibt es nicht.';
  const g = game.gespraech;
  if (g) {
    if (g.id === npc.gespraech && g.pid === p.id) return weiter(game, p);   // E beim laufenden Gespräch = weiter
    return 'Es spricht gerade jemand.';
  }
  if (p.zone !== 'away') return 'Nur am Boden.';
  game.gespraech = { id: npc.gespraech, nid: npc.person, map: game.away.map, pid: p.id, z: 0, phase: 'zeilen', antwort: null, wahl: null, t0: game.time, last: game.time };
  game.emit('sfx', { name: 'ui_click', zone: 'away', x: Math.round(npc.x), y: Math.round(npc.y) });
  game.missionEvent('gespraechBegonnen', { id: npc.gespraech, person: npc.person });
  return null;
}

function darf(game, p) {
  const g = game.gespraech;
  if (!g) return false;
  if (p.id === g.pid) return true;
  return p.zone === 'away' && game.time - g.last >= IDLE_FREI;   // Initiator schläft: jeder am Ort darf weiter
}

function weiter(game, p) {
  const g = game.gespraech;
  if (!g) return 'Kein Gespräch.';
  if (!darf(game, p)) return 'Der Gesprächspartner ist noch dran.';
  const d = def(g.id);
  g.last = game.time;
  if (g.phase === 'zeilen') {
    if (g.z + 1 < d.zeilen.length) { g.z++; return null; }
    if (d.wahl && Array.isArray(d.wahl.optionen) && d.wahl.optionen.length) { g.phase = 'wahl'; return null; }
    return beenden(game, null);
  }
  if (g.phase === 'antwort') return beenden(game, g.wahl);
  return null;   // in der Wahl: erst wählen
}

function waehle(game, p, optionId) {
  const g = game.gespraech;
  if (!g) return 'Kein Gespräch.';
  if (g.phase !== 'wahl') return 'Gerade gibt es nichts zu wählen.';
  if (!darf(game, p)) return 'Der Gesprächspartner ist noch dran.';
  const d = def(g.id);
  const o = (d.wahl.optionen || []).find((x) => x.id === optionId);
  if (!o) return 'Unbekannte Option.';
  g.last = game.time; g.wahl = o.id;
  if (o.antwort) { g.phase = 'antwort'; g.antwort = o.antwort; return null; }
  return beenden(game, o.id);
}

// Ergebnis festhalten: Flag gespraech_<id> (Option-Id) und Ereignis. Option mit `offen` lässt das Gespräch wiederholen
function beenden(game, wahl) {
  const g = game.gespraech;
  if (!g) return null;
  const d = def(g.id);
  game.gespraech = null;
  const o = wahl && d && d.wahl ? (d.wahl.optionen || []).find((x) => x.id === wahl) : null;
  if (game.mission && game.mission.flags) game.mission.flags['gespraech_' + g.id] = wahl || 'gefuehrt';
  game.emit('gespraech', { id: g.id, wahl: wahl || null, person: g.nid, offen: !!(o && o.offen) });
  game.missionEvent('gespraechBeendet', { id: g.id, wahl: wahl || null, person: g.nid, offen: !!(o && o.offen) });
  return null;
}

function schliesse(game, grund) {
  const g = game.gespraech;
  if (!g) return null;
  game.gespraech = null;
  game.emit('gespraech', { id: g.id, wahl: null, person: g.nid, abgebrochen: grund || true });
  return null;
}

function update(game) {
  const g = game.gespraech;
  if (!g) return;
  const p = game.playerById(g.pid);
  const n = person(game, g.nid);
  if (!p || !p.connected || p.zone !== 'away' || !n || game.away.map !== g.map || p.downed) return void schliesse(game, 'abgebrochen');
  if (Math.hypot(p.x - n.x, p.y - n.y) > REICHWEITE) schliesse(game, 'abgebrochen');
}

function snapshot(game) {
  const g = game.gespraech;
  if (!g) return null;
  const d = def(g.id); const n = person(game, g.nid);
  if (!d || !n) return null;
  const out = { id: g.id, nid: g.nid, n: n.name || d.sprecher || '', x: Math.round(n.x), y: Math.round(n.y), t: zeile(g).t, z: g.z + 1, zn: d.zeilen.length };
  if (g.phase === 'wahl') out.w = d.wahl.optionen.map((o) => [o.id, o.text]);
  if (g.phase === 'antwort') out.a = 1;
  return out;
}

function cmd(game, p, c, msg) {
  if (c === 'gespraech.next') return weiter(game, p);
  if (c === 'gespraech.pick') return waehle(game, p, String(msg && msg.opt));
  if (c === 'gespraech.end') {
    const g = game.gespraech;
    if (!g) return null;
    if (p.id !== g.pid && !darf(game, p)) return 'Der Gesprächspartner ist noch dran.';
    return schliesse(game, 'beendet');
  }
  return 'Unbekannter Gesprächsbefehl.';
}

module.exports = { REICHWEITE, IDLE_FREI, daten, def, neuLaden, beginne, weiter, waehle, schliesse, update, snapshot, cmd };
