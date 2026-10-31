'use strict';
// BOD-01 P4: Szenario Grabenangriff (Lobby-Start 'arena_graben', arena.js startGraben). Die Crew greift eine römische Stellung auf der festen Karte
// content/buehnen/festkarten/grabenangriff.json an: Wiese und Graben, Wald, Bunkereingang. Eigene Bühne in wellen.js (BUEHNEN.graben): der Zustand liegt
// wie bei den Wellen in game.arena.wellen (buehne 'graben'), damit Snapshot-Block, Zielzeile, Rüstphase (werft.szeneStarten) und Siegbild (Ereignis
// wellenEnde) die vorhandenen Wege nutzen. Eigener Ablauf statt der Hooks plan/erstbesetzung/kampf/auffuellen, weil das Szenario nicht Welle für Welle
// läuft: beide Wellen stehen VON BEGINN postiert (kein Nachrücken, kein Nachspawn), es gibt keinen Countdown und keine Pause.
//
// Ablauf: Rüstphase (nur mit game.ruestphase: die Crew rüstet am Terminal, „Szene starten“ -> vorbereitungEnde beamt sie am Abholpunkt hinunter) -> kampf -> ende.
//  - Besetzung: CONFIG.graben.besetzung (Rollen je Gruppe und Crewgröße), Gruppen und Wellen aus der Karte (meta.gruppen, meta.wellen). Die Gegner stehen
//    wie bei combat.besetzen als ruhiger Trupp (schleich), einer je Gruppe; Rom (Fraktion, Palette, Namen, Funk). Die Rollen setzt das Szenario selbst:
//    combat.besetzen würde ungesehene Rollen durch Grundtyp ersetzen.
//  - Ziel (Anker meta.ziel, Rolle ziel): gesperrt (anker.js ankerSperre, Hinweistext), bis Welle 2 besiegt ist; dann offen; Halten (CONFIG.anker.halten.ziel)
//    setzt es auf aktiviert = erreicht. Danach gewinnt das Hochbeamen: niemand der verbundenen Spieler mehr unten.
//  - Niederlage: Notrückholung, die die GANZE verbundene Crew betrifft (combat.squadRecall, bestehend; ist ein Spieler gesund an Bord, läuft es weiter) -> das GANZE Szenario beginnt neu (neuBeginnen): alle Gegner zurück auf die
//    Anfangsplätze, Ziel wieder gesperrt, Zähler zurück, Transfer wieder heil. Die Karte wird nicht neu gebaut, nur Zustände und Gegner (Vorbild map_reset, Siedlung Eisenwald).
//  - Hochbeamen vor dem Ziel: kein Sieg, wie in Wellen Boden bleibt der Stand stehen (Gegner bleiben, die Crew kann ausrüsten und wieder hinunter).
//  - Alle Texte und Zahlen: CONFIG.graben. Die KI bleibt unberührt (BOD-02).
const GenFest = require('../../shared/gen-fest.js');

let mods = null;
function M() {
  if (!mods) mods = { combat: require('./combat.js'), interior: require('./interior.js'), away: require('./away.js'), squad: require('./squad.js'), anker: require('./anker.js'), wellen: require('./wellen.js'), verteidigung: require('./verteidigung.js') };
  return mods;
}
const cfg = (game) => game.C.graben;
const team = (game) => game.players.filter((p) => p.connected);
const text = (game, key, ...a) => String((cfg(game).texte || {})[key] || '').replace(/\{(\d)\}/g, (m, i) => (a[i] == null ? '' : a[i]));
const fehler = (game, wo, e) => { if (game.countError) game.countError(wo, e); };

// ---------- Variantenwahl (Lobby): datengetrieben aus den Kartendaten (gen-fest varianten) ----------
const festDef = (game) => require('./landepunkte.js').festkarte(cfg(game).fest);
// wählbare Abschnitte in Kartenreihenfolge: [{ abschnitt, name, varianten: [{ id, name }] }]
function liste(game) { return GenFest.varianten(festDef(game)).filter((a) => a.waehlbar).map((a) => ({ abschnitt: a.abschnitt, name: a.name, varianten: a.varianten })); }
// Auswahl der wählbaren Abschnitte: Standard der Karte, überlagert von der gewählten (null = Standard)
function auswahl(game, gewaehlt) {
  const std = GenFest.standardAuswahl(festDef(game)); const out = {};
  for (const a of liste(game)) out[a.abschnitt] = (gewaehlt && gewaehlt[a.abschnitt]) || std[a.abschnitt];
  return out;
}
// auswahlSetzen(game, alt, neu) -> { auswahl } | { fehler }: nur wählbare Abschnitte und bekannte Varianten
function auswahlSetzen(game, alt, neu) {
  const wb = new Set(liste(game).map((a) => a.abschnitt));
  for (const k of Object.keys(neu)) if (!wb.has(k)) return { fehler: 'Grabenangriff: Abschnitt ' + k + ' ist nicht wählbar.' };
  const w = Object.assign(auswahl(game, alt), neu);
  const fe = GenFest.auswahlPruefen(festDef(game), w);
  return fe ? { fehler: 'Grabenangriff: ' + fe + '.' } : { auswahl: w };
}

function crewGroesse(game) { return Math.max(1, Math.min(game.C.maxPlayers, team(game).length)); }
// Besetzung für die Crewgröße: der höchste Eintrag ≤ Crewgröße, sonst der kleinste
function besetzungFuer(game, n) {
  const B = cfg(game).besetzung; const keys = Object.keys(B).map(Number).sort((a, b) => a - b);
  let k = keys[0];
  for (const x of keys) if (x <= n) k = x;
  return B[String(k)];
}
const karteVon = (game, lp) => { const i = M().interior.awayInfoOf(lp); return i && i.karte ? i.karte : null; };
const wellenNummern = (k) => Object.keys((k.meta && k.meta.wellen) || {}).sort((a, b) => Number(a) - Number(b));

// n Plätze aus den Ankern einer Gruppe, gleichmäßig verteilt; reichen die Anker nicht, freie Nachbarkacheln der Anker
function plaetzeFuer(game, info, gruppe, n) {
  const k = info.karte;
  const anker = ((k.meta.gruppen || {})[gruppe] || []).map((id) => k.anker.find((a) => a.id === id)).filter(Boolean);
  const out = [];
  const used = new Set();
  const nA = Math.min(n, anker.length);
  for (let i = 0; i < nA; i++) {
    const a = anker[Math.min(anker.length - 1, Math.floor((i + 0.5) * anker.length / nA))];
    if (used.has(a.x + ',' + a.y)) continue;
    used.add(a.x + ',' + a.y); out.push({ x: a.x, y: a.y });
  }
  for (const a of anker) {   // Anker, die noch fehlen (Rundungskollision), dann Nachbarkacheln
    if (out.length >= n) break;
    if (!used.has(a.x + ',' + a.y)) { used.add(a.x + ',' + a.y); out.push({ x: a.x, y: a.y }); }
  }
  const pads = new Set((info.pads || []).map((q) => q.x + ',' + q.y));
  for (let r = 1; out.length < n && r <= 3; r++) {
    for (const a of anker) for (let dy = -r; dy <= r && out.length < n; dy++) for (let dx = -r; dx <= r && out.length < n; dx++) {
      const x = a.x + dx, y = a.y + dy, key = x + ',' + y;
      if (used.has(key) || pads.has(key) || info.map.solid(x, y)) continue;
      used.add(key); out.push({ x, y });
    }
  }
  return out;
}

function fraktionDaten(game, id) {
  try { return (M().combat.katalogDaten(game).fraktionen || {})[id] || null; } catch (e) { return null; }
}

// Gegner der Szene (alle Wellen) – Tag der Wellen, damit wellen.zaehleAbschuesse sie zählt
const TAG = () => M().wellen.TAG;
const gegner = (aw) => ((aw && aw.drones) || []).filter((e) => e.tag === TAG());
const lebende = (aw) => gegner(aw).filter((e) => e.alive);
const welleLebt = (aw, S, n) => { const ids = new Set(S.ids[n] || []); return gegner(aw).filter((e) => e.alive && ids.has(e.id)).length; };

// Gegner aufstellen: je Welle (meta.wellen) und Gruppe ein ruhiger Trupp an den Gruppen-Ankern -> Zahl
function aufstellen(game, S) {
  const aw = game.aways[S.lp]; const info = M().interior.awayInfoOf(S.lp); const k = info.karte;
  const F = fraktionDaten(game, S.fraktion);
  const plan = besetzungFuer(game, crewGroesse(game));
  S.ids = {}; let gesamt = 0;
  const linie1 = [];   // BOD-02 P8: Trupps der ersten Welle bekommen ein Verteidigungsprofil (halten, Rückzug auf Linie 2, Gegenstoß)
  for (const wn of wellenNummern(k)) {
    S.ids[wn] = [];
    for (const gruppe of k.meta.wellen[wn]) {
      const rollen = plan[gruppe] || [];
      if (!rollen.length) continue;
      const plaetze = plaetzeFuer(game, info, gruppe, rollen.length);
      const name = 'graben.' + gruppe;
      const n = M().squad.spawnSquad(game, name, { map: S.lp, besetzung: rollen.map((r) => ({ typ: r, anzahl: 1 })), force: true, plaetze, festeZahl: true });
      if (n !== rollen.length) fehler(game, 'graben-aufstellen', new Error(`Gruppe ${gruppe}: ${n}/${rollen.length} Gegner`));
      for (const e of aw.drones) if (e.squad === name) {
        e.tag = TAG(); e.fraktion = S.fraktion; if (F && F.palette) e.palette = F.palette;
        M().combat.kaempfer(game, e);
        S.ids[wn].push(e.id); S.lebt.add(e.id);
      }
      const s = aw.squads[name];
      if (s && wn === wellenNummern(k)[0] && n) linie1.push(name);
      if (s) { s.schleich = true; s.posten = true; s.tag = TAG(); s.fraktion = S.fraktion; s.gruppe = gruppe; }
      gesamt += n;
    }
  }
  const nr = wellenNummern(k);
  if (linie1.length && nr.length > 1) M().verteidigung.zuweisen(game, aw, info, linie1, k.meta.wellen[nr[1]]);
  S.gesamt = gesamt;
  return gesamt;
}

function sperre(game, S, an) {
  const aw = game.aways[S.lp];
  if (!aw) return;
  if (an) aw.ankerSperre = Object.assign(aw.ankerSperre || {}, { [S.zielId]: text(game, 'sperre') });
  else if (aw.ankerSperre) delete aw.ankerSperre[S.zielId];
}
// Ziel zurück auf offen-für-Halten (Zustand frei), aber gesperrt
function zielZurueck(game, S) {
  const aw = game.aways[S.lp];
  if (!aw) return;
  M().anker.setzen(game, S.lp, S.zielId, 'frei', null, { still: true });
  for (const p of game.players) if (p.hold && p.hold.anker === S.zielId) p.hold = null;
  S.ziel = 'gesperrt'; sperre(game, S, true);
}

// start(game, { karte, seed, lp, auswahl, name }) – Karte steht (arena.js), das Team ist noch an Bord bzw. unten
function start(game, o) {
  const aw = game.aways[o.lp];
  M().combat.ensureV2(game, aw, o.lp);
  aw.drones = []; aw.squads = {}; aw.projectiles = [];
  aw.ausbruchErlaubt = false;   // kein Ausbruch: gefangen = kampfunfähig (wie Wellen Boden)
  const k = karteVon(game, o.lp);
  const S = {
    buehne: 'graben', karte: o.karte, seed: o.seed, lp: o.lp, fraktion: cfg(game).fraktion, n: 1, ph: 'kampf', bis: null, queue: [], gesamt: 0, start: game.time,
    kills: {}, abschuesse: 0, lebt: new Set(), proj: [], ids: {}, ziel: 'gesperrt', zielId: k && k.meta.ziel, versuch: 1, recalls: (aw.stats && aw.stats.squadRecalls) || 0,
    untenSeit: null, ergebnis: null, maxLebend: 0, auswahl: o.auswahl || null,
  };
  if (!S.zielId) throw new Error('Grabenangriff: Karte ohne Ziel-Anker');
  game.arena.wellen = S;
  sperre(game, S, true);
  const n = aufstellen(game, S);
  S.maxLebend = n;
  if (game.ruestphase) S.ph = 'vorbereitung';
  game.oda(S.ph === 'vorbereitung' ? text(game, 'start_ruest', o.name, n) : text(game, 'start', o.name, n), null);
  game.log(`Grabenangriff gestartet: ${o.karte} (${o.lp}), ${n} Gegner, Auswahl ${JSON.stringify(o.auswahl)}.`);
  if (S.ph === 'kampf') { hinunter(game); game.oda(text(game, 'los'), null); }   // ohne Rüstphase beamt die Crew gleich hinunter (Tests, Bots)
  return S;
}

// Crew am Abholpunkt hinunterbeamen (Rüstphase-Ende bzw. Neubeginn ohne Rüstphase)
function hinunter(game) {
  const t = team(game);
  for (const p of t) { if (p.console) M().interior.leaveConsole(game, p); if (p.downed) M().interior.revivePlayer(game, p); }
  if (t.length) M().away.executeBeam(game, t.map((p) => p.id), 'down');
}
// Ende der Rüstphase (werft.szeneStarten -> wellen.vorbereitungEnde)
function vorbereitungEnde(game, S) {
  if (S.ph !== 'vorbereitung') return false;
  hinunter(game);
  S.ph = 'kampf';
  game.oda(text(game, 'los'), null);
  return true;
}

// Niederlage: das ganze Szenario beginnt neu (alle Gegner zurück, Ziel gesperrt, Zähler zurück)
function neuBeginnen(game, S) {
  const aw = game.aways[S.lp];
  aw.drones = aw.drones.filter((e) => e.tag !== TAG());
  for (const nm of Object.keys(aw.squads || {})) if (aw.squads[nm] && aw.squads[nm].tag === TAG()) delete aw.squads[nm];
  for (const nm of Object.keys(aw.spawned || {})) if (/^graben\./.test(nm)) delete aw.spawned[nm];
  aw.projectiles = []; aw.alarm = false; aw.items = (aw.items || []).filter((i) => i.kind !== 'medipack');
  aw.zustaende = {}; aw.ankerLauf = { download: {}, ladung: {}, raetsel: {} };   // Anker und Türen zurück auf den Kartenstand
  S.lebt.clear(); S.proj = []; S.kills = {}; S.abschuesse = 0; S.untenSeit = null; S.maxLebend = 0;
  S.versuch++; S.start = game.time; S.n = 1;
  S.recalls = (aw.stats && aw.stats.squadRecalls) || 0;
  // Die Notrückholung brennt den Transfer durch (module.notrueckholungFolge) und sperrt ihn ab: ohne Transfer gäbe es nach dem Neubeginn kein Hochbeamen, also keinen Sieg
  aw.recallLockUntil = 0;
  if (game.ship.systems.transfer !== 'ok') M().interior.damageSystem(game, 'transfer', 'ok', { quiet: true });
  zielZurueck(game, S);
  S.maxLebend = aufstellen(game, S);
  game.emit('szeneZurueck', { map: S.lp, versuch: S.versuch });
  game.oda(text(game, 'neustart'), null);
  game.log(`Grabenangriff: Neubeginn (Versuch ${S.versuch}).`);
  if (game.ruestphase) S.ph = 'vorbereitung';   // Rüstphase wie am Anfang: ausrüsten, „Szene starten“, am Abholpunkt hinunter
  else hinunter(game);
}

function sieg(game, S) {
  S.ph = 'ende'; S.bis = game.time + Number(cfg(game).ergebnisZeit || 10);
  const zeit = Math.round(game.time - S.start);
  const kills = game.players.map((p) => [p.id, p.name, S.kills[p.id] || 0]);
  S.ergebnis = { karte: S.karte, seed: S.seed, welle: S.n, geschafft: wellenNummern(karteVon(game, S.lp)).length, zeit, kills, sieg: true, versuche: S.versuch };
  game.emit('wellenEnde', S.ergebnis);
  game.oda(text(game, 'sieg'), null);
  game.log(`Grabenangriff gewonnen: ${zeit} s, Versuch ${S.versuch}, Abschüsse ${kills.map((q) => q[1] + ' ' + q[2]).join(', ')}.`);
}

// Tick (wellen.update, solange game.phase === 'play')
function update(game, S) {
  if (S.ph === 'vorbereitung') return;
  if (S.ph === 'ende') { if (game.time >= S.bis && typeof game.endSession === 'function') game.endSession(null, { grund: 'wellen' }); return; }
  const aw = game.aways[S.lp];
  if (!aw) return;
  M().wellen.zaehleAbschuesse(game, S, aw);
  // Niederlage: die Notrückholung (combat.squadRecall) zählt aw.stats.squadRecalls hoch. Sie holt nur die Spieler UNTEN zurück: Ein Neubeginn ist es nur,
  // wenn sie die ganze verbundene Crew betraf (kein Spieler war gesund an Bord). Sonst sind die Zurückgeholten schlicht an Bord, das Szenario läuft weiter
  // (und ist das Ziel erreicht, entscheidet gleich unten die Siegprüfung: alle an Bord = Sieg).
  const rz = (aw.stats && aw.stats.squadRecalls) || 0;
  if (rz > S.recalls) {
    S.recalls = rz;
    const pids = (aw.letzteRueckholung && aw.letzteRueckholung.pids) || null;
    if (!pids || team(game).every((p) => pids.includes(p.id))) { neuBeginnen(game, S); return; }
  }
  S.maxLebend = Math.max(S.maxLebend, lebende(aw).length);
  S.n = welleLebt(aw, S, 1) > 0 ? 1 : 2;
  if (S.ziel === 'gesperrt' && welleLebt(aw, S, 2) === 0) {
    S.ziel = 'offen'; sperre(game, S, false);
    game.oda(text(game, 'ziel_offen'), null);
    game.emit('sfx', { name: 'repair_done', zone: 'away' });
  }
  if (S.ziel === 'offen' && M().anker.zustand(game, S.lp, S.zielId) === 'aktiviert') {
    S.ziel = 'erreicht';
    game.oda(text(game, 'ziel_erreicht'), null);
    game.emit('sfx', { name: 'repair_done', zone: 'away' });
  }
  // Sieg: Ziel erreicht und die ganze Crew wieder an Bord (Hochbeamen am Abholpunkt)
  const t = team(game);
  if (S.ziel === 'erreicht' && t.length && !t.some((p) => p.zone === 'away')) sieg(game, S);
}

// Zeile für Zielanzeige/HUD (arena.wellenText)
function zeile(game, S) {
  if (S.ph === 'vorbereitung') return text(game, 'zeile_ruest');
  if (S.ph === 'ende') return text(game, 'zeile_sieg');
  const aw = game.aways[S.lp];
  if (S.ziel === 'erreicht') return text(game, 'zeile_hoch');
  if (S.ziel === 'offen') return text(game, 'zeile_ziel');
  return text(game, 'zeile_kampf', welleLebt(aw, S, 1), welleLebt(aw, S, 2));
}

// ---------- Hooks der Bühne (wellen.js BUEHNEN.graben): nur, was Snapshot-Block und Ablauf brauchen ----------
const BUEHNE = {
  bereit(game, S) { return !!game.aways[S.lp]; },
  zaehle(game, S) { /* update zählt selbst */ },
  stehend(game, S) { const aw = game.aways[S.lp]; return aw ? lebende(aw).length : 0; },
  update, vorbereitungEnde,
};

// Debug `graben <welle2|reset|status>` (nur --debug): Welle 2 sofort besiegt (Ziel wird frei) bzw. Neubeginn
function debug(game, arg) {
  const S = game.arena && game.arena.wellen;
  if (!S || S.buehne !== 'graben') return 'graben: nur im Grabenangriff.';
  const aw = game.aways[S.lp];
  const a = String(arg || 'status');
  if (a === 'welle2') { const ids = new Set(S.ids[2] || []); aw.drones = aw.drones.filter((e) => !ids.has(e.id)); return null; }
  if (a === 'reset') { neuBeginnen(game, S); return null; }
  if (a === 'status') return `graben: Versuch ${S.versuch}, Phase ${S.ph}, Ziel ${S.ziel}, Gegner ${lebende(aw).length}/${S.gesamt}`;
  return 'graben: welle2 | reset | status';
}

module.exports = { BUEHNE, liste, auswahl, auswahlSetzen, start, update, vorbereitungEnde, neuBeginnen, zeile, debug, besetzungFuer, plaetzeFuer };
