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
//  - Wellen: beliebig viele (meta.wellen, Nummern aufsteigend). Welle 1 und 2 stehen oben (Deck 0), Welle 3 im Bunker (Deck 1, BOD-03). Jeder Trupp bekommt eine
//    Deck-Bindung (s.deckBindung, squad.js gegnerWeg): Gegner wechseln das Deck nie über Lift oder Rohr, ein Alarm oben zieht den Bunker nicht hoch.
//  - Ziel (BOD-03 C1): die SPRENGUNG im Reaktorraum. Der einzige Anker der Rolle sprengpunkt (S.zielId) im Zustand zerstoert (Zünden: E halten, Countdown, Knall = anker.js) setzt
//    S.ziel auf erreicht. gesperrt/offen steuern Sperre UND Zielzeile: gesperrt (aw.ankerSperre[S.zielId], Hinweis 'sperre', anker.js) bis zielOeffnet erfüllt ist (alle Wellen der
//    Oberfläche besiegt), dann offen (Sound, ODA); Neubeginn sperrt wieder. Das Rohr ändert daran nichts. Der alte Oberflächen-Anker meta.ziel (Bunkereingang, Optik) bleibt auf der Karte und ist STILL (S.stillId, ankerSperre ziel_still): kein Halten, keine Siegbedingung.
//    Die Crew startet mit EINER Ladung im Teaminventar (Neubeginn: wieder 1).
//  - Nachschub (C2/C3): der Knall löst EINMAL das Warnsignal und vier Mann (CONFIG.graben.nachschub) oben am Bunkereingang aus (S.nachschub). Kein Timer, keine Lift-Sperre.
//    Danach gewinnt das Hochbeamen: niemand der verbundenen Spieler mehr unten (Pad am Bunkereingang, immer aktiv).
//  - Niederlage: Notrückholung, die die GANZE verbundene Crew betrifft (combat.squadRecall, bestehend; ist ein Spieler gesund an Bord, läuft es weiter) -> das GANZE Szenario beginnt neu (neuBeginnen): alle Gegner zurück auf die
//    Anfangsplätze, Sprengpunkt wieder intakt, Ladung wieder 1, Nachschub-Auslöser zurück, Zähler zurück, Transfer wieder heil. Die Karte wird nicht neu gebaut, nur Zustände und Gegner (Vorbild map_reset, Siedlung Eisenwald).
//  - Hochbeamen vor dem Ziel: kein Sieg, wie in Wellen Boden bleibt der Stand stehen (Gegner bleiben, die Crew kann ausrüsten und wieder hinunter).
//  - Alle Texte und Zahlen: CONFIG.graben. Die KI bleibt unberührt (BOD-02).
const GenFest = require('../../shared/gen-fest.js');
const Tel = require('../telemetrie/gefecht.js');   // TEL-01 B1: Szene, Neubeginn, Gegner (nur lesen)

let mods = null;
function M() {
  if (!mods) mods = { combat: require('./combat.js'), interior: require('./interior.js'), away: require('./away.js'), squad: require('./squad.js'), anker: require('./anker.js'), wellen: require('./wellen.js'), verteidigung: require('./verteidigung.js') };
  return mods;
}
const cfg = (game) => game.C.graben;
const team = (game) => game.players.filter((p) => p.connected);
const text = (game, key, ...a) => String((cfg(game).texte || {})[key] || '').replace(/\{(\d)\}/g, (m, i) => (a[i] == null ? '' : a[i]));
const fehler = (game, wo, e) => { if (game.countError) game.countError(wo, e); };
const Vorrat = require('./vorrat.js');
const Physics = require('../../shared/physics.js');

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
// Deck einer Kachelzeile (0 ohne Decks) und Deck einer Gruppe (Deck ihrer Anker, das der ersten reicht: alle Anker einer Gruppe stehen auf einem Deck)
const deckVonY = (k, y) => (k.decks && k.decks.stride ? Math.floor(y / k.decks.stride) : 0);
function deckVonGruppe(k, gruppe) {
  const a = ((k.meta.gruppen || {})[gruppe] || []).map((id) => k.anker.find((q) => q.id === id)).filter(Boolean)[0];
  return a ? deckVonY(k, a.y) : 0;
}

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
// Aktive Welle (Zeile, Ergebnis): die erste mit Lebenden, sonst die letzte
const aktiveWelle = (aw, S, nr) => Number(nr.find((n) => welleLebt(aw, S, n) > 0) || nr[nr.length - 1] || 1);
// BOD-03 B4: die Zielregel in EINER benannten Funktion. Wie vor BOD-03: das Ziel öffnet, wenn die letzte Welle der OBERFLÄCHE (Deck 0; heute Welle 2) besiegt ist;
// Welle 3 im Bunker zählt nicht. Die Sprengung als Ziel (BOD-03 C1) tauscht nur diese Funktion.
function zielOeffnet(game, S, aw) {
  const oben = Object.keys(S.deckVon || {}).filter((n) => S.deckVon[n] === 0);
  return oben.length > 0 && welleLebt(aw, S, oben[oben.length - 1]) === 0;
}

// Gegner aufstellen: je Welle (meta.wellen) und Gruppe ein ruhiger Trupp an den Gruppen-Ankern -> Zahl
function aufstellen(game, S) {
  const aw = game.aways[S.lp]; const info = M().interior.awayInfoOf(S.lp); const k = info.karte;
  const F = fraktionDaten(game, S.fraktion);
  const plan = besetzungFuer(game, crewGroesse(game));
  S.ids = {}; S.deckVon = {}; let gesamt = 0;
  const linie1 = [];   // BOD-02 P8: Trupps der ersten Welle bekommen ein Verteidigungsprofil (halten, Rückzug auf Linie 2, Gegenstoß)
  for (const wn of wellenNummern(k)) {
    S.ids[wn] = []; S.deckVon[wn] = deckVonGruppe(k, k.meta.wellen[wn][0]);
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
      if (s) { s.schleich = true; s.posten = true; s.tag = TAG(); s.fraktion = S.fraktion; s.gruppe = gruppe; s.deckBindung = S.deckVon[wn]; }   // BOD-03 C4: bleibt auf seinem Deck
      gesamt += n;
    }
  }
  const nr = wellenNummern(k);
  if (linie1.length && nr.length > 1) M().verteidigung.zuweisen(game, aw, info, linie1, k.meta.wellen[nr[1]]);
  S.gesamt = gesamt;
  return gesamt;
}

// BOD-03 C1: der Oberflächen-Anker meta.ziel (Bunkereingang) ist kein Ziel mehr. Er bleibt als Optik auf der Karte und wird still gelegt: E zeigt nur den Hinweis ziel_still.
function stillLegen(game, S) {
  const aw = game.aways[S.lp];
  if (!aw || !S.stillId) return;
  aw.ankerSperre = Object.assign(aw.ankerSperre || {}, { [S.stillId]: text(game, 'ziel_still') });
}
// Der Sprengpunkt (S.zielId): gesperrt (E zeigt den Hinweis 'sperre', kein Zünden) bzw. freigegeben. Die Stufe S.ziel führt der Aufrufer.
function zielSperren(game, S) {
  const aw = game.aways[S.lp];
  if (aw) aw.ankerSperre = Object.assign(aw.ankerSperre || {}, { [S.zielId]: text(game, 'sperre') });
}
function zielFreigeben(game, S) {
  const aw = game.aways[S.lp];
  if (aw && aw.ankerSperre) delete aw.ankerSperre[S.zielId];
}
// Das Ziel (Sprengpunkt) zurück auf Anfang: Zustand intakt (aw.zustaende ist schon leer), Halter lösen, Stufe gesperrt, Nachschub-Auslöser zurück
function zielZurueck(game, S) {
  for (const p of game.players) if (p.hold && p.hold.anker === S.zielId) p.hold = null;
  S.ziel = 'gesperrt'; zielSperren(game, S);
  S.nachschub = null; S.nachschubIds = [];
  stillLegen(game, S);
}
// Die Crew startet mit EINER Ladung im Teaminventar (Start und Neubeginn gleich: auf genau 1 gesetzt, nicht addiert)
function ladungBereitstellen(game) { Vorrat.standSetzen(game, 'ladung', 1, 'mission'); }
// Der Sprengpunkt der Karte: genau einer (BOD-03: Reaktorraum des Bunkers)
function sprengpunktVon(k) { const l = (k ? k.anker : []).filter((a) => a.rolle === 'sprengpunkt'); return l.length === 1 ? l[0].id : null; }

// ---------- Nachschub (BOD-03 C3): einmal vier Mann oben am Bunkereingang, ausgelöst vom Knall ----------
// Kandidaten für n Mann um den Lift oben (Deck 0): freie Kacheln im Abstand 2 bis 5 (Chebyshev), weder Pad noch Anker noch von einem lebenden Gegner oder Spieler besetzt,
// nach Abstand, dann y, x. Reichen die Kacheln des Rings nicht (Welle 2 am Eingang, Spieler am Lift), weitere Ringe bis 10. Geliefert werden ALLE Kandidaten (nicht nur n):
// spawnSquad nimmt die ersten freien, so bleibt es bei genau n, auch wenn ihm etwas dazwischenkommt.
function nachschubPlaetze(game, aw, info, n) {
  const k = info.karte;
  const lift = k.anker.filter((a) => a.rolle === 'lift' && deckVonY(k, a.y) === 0)[0];
  if (!lift) return [];
  const belegt = new Set((info.pads || []).map((q) => q.x + ',' + q.y).concat(k.anker.map((a) => a.x + ',' + a.y)));
  const besetzt = (e) => { const t = Physics.toTile(e.x, e.y); belegt.add(t.x + ',' + t.y); };
  for (const e of lebende(aw)) besetzt(e);
  for (const p of game.players) if (p.connected && p.zone === 'away') besetzt(p);
  const kandidaten = (rmax) => {
    const frei = [];
    for (let dy = -rmax; dy <= rmax; dy++) for (let dx = -rmax; dx <= rmax; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = lift.x + dx, y = lift.y + dy;
      if (d < 2 || belegt.has(x + ',' + y) || info.map.solid(x, y) || deckVonY(k, y) !== 0) continue;
      frei.push({ x, y, d });
    }
    return frei.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  };
  let frei = kandidaten(5);
  for (let r = 6; frei.length < n && r <= 10; r++) frei = kandidaten(r);
  return frei.map((q) => ({ x: q.x, y: q.y }));
}
// Warnsignal und Nachschub, genau einmal je Versuch (S.nachschub: null -> 'gesendet'; neuBeginnen setzt es zurück)
function nachschubSenden(game, S) {
  if (S.nachschub) return 0;
  S.nachschub = 'gesendet';
  const aw = game.aways[S.lp]; const info = M().interior.awayInfoOf(S.lp);
  game.oda(text(game, 'nachschub'), null);
  game.emit('sfx', { name: 'alarm_yellow', zone: 'away' });
  game.emit('nachschub', { map: S.lp, versuch: S.versuch });
  const rollen = cfg(game).nachschub || [];
  const plaetze = nachschubPlaetze(game, aw, info, rollen.length);
  const name = 'graben.nachschub';
  const n = M().squad.spawnSquad(game, name, { map: S.lp, besetzung: rollen.map((r) => ({ typ: r, anzahl: 1 })), force: true, plaetze, festeZahl: true, alert: true });
  if (n !== rollen.length) fehler(game, 'graben-nachschub', new Error(`Nachschub: ${n}/${rollen.length} Gegner`));
  const F = fraktionDaten(game, S.fraktion);
  S.nachschubIds = [];
  for (const e of aw.drones) if (e.squad === name) {
    e.tag = TAG(); e.fraktion = S.fraktion; if (F && F.palette) e.palette = F.palette;
    M().combat.kaempfer(game, e);
    S.nachschubIds.push(e.id); S.lebt.add(e.id);
  }
  const s = aw.squads[name];
  if (s) { s.tag = TAG(); s.fraktion = S.fraktion; s.gruppe = 'nachschub'; s.deckBindung = 0; }   // Oberflächen-Gegner: bleiben oben (squad.js gegnerWeg)
  S.gesamt += n; S.maxLebend = Math.max(S.maxLebend, lebende(aw).length);
  game.log(`Grabenangriff: Nachschub ${n} Mann am Bunkereingang (Versuch ${S.versuch}).`);
  return n;
}

// start(game, { karte, seed, lp, auswahl, name }) – Karte steht (arena.js), das Team ist noch an Bord bzw. unten
function start(game, o) {
  const aw = game.aways[o.lp];
  M().combat.ensureV2(game, aw, o.lp);
  aw.drones = []; aw.squads = {}; aw.projectiles = [];
  aw.ausbruchErlaubt = false;   // kein Ausbruch: gefangen = kampfunfähig (wie Wellen Boden)
  aw.ohneZaehler = true;   // BOD-03: das HUD zeigt keine Zähler für Terminal, Kiste, Sprengpunkt, Zelle der Bunker-Anker (das Szenario hat ein eigenes Ziel)
  const k = karteVon(game, o.lp);
  const S = {
    buehne: 'graben', karte: o.karte, seed: o.seed, lp: o.lp, fraktion: cfg(game).fraktion, n: 1, ph: 'kampf', bis: null, queue: [], gesamt: 0, start: game.time,
    kills: {}, abschuesse: 0, lebt: new Set(), proj: [], ids: {}, ziel: 'gesperrt', zielId: sprengpunktVon(k), stillId: (k && k.meta.ziel) || null, nachschub: null, nachschubIds: [], versuch: 1, recalls: (aw.stats && aw.stats.squadRecalls) || 0,
    untenSeit: null, ergebnis: null, maxLebend: 0, auswahl: o.auswahl || null,
  };
  if (!S.zielId) throw new Error('Grabenangriff: Karte ohne (genau einen) Sprengpunkt');
  game.arena.wellen = S;
  Tel.szeneStart(game, 'graben', o.karte, { seed: o.seed });   // TEL-01 B1
  stillLegen(game, S); zielSperren(game, S);
  ladungBereitstellen(game);
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
  for (const p of t) { if (p.console) M().interior.konsoleVerlassen(game, p, 'graben'); if (p.downed) M().interior.revivePlayer(game, p); }
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
  for (const e of aw.drones) if (e.tag === TAG()) Tel.bodenGegnerWeg(game, e, 'neubeginn');   // TEL-01 B1
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
  ladungBereitstellen(game);
  S.maxLebend = aufstellen(game, S);
  game.emit('szeneZurueck', { map: S.lp, versuch: S.versuch });
  Tel.szeneNeustart(game, 'graben', S.karte, S.versuch);   // TEL-01 B1: die Crew war unten, Niederlage
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
  Tel.szeneEnde(game, 'graben', S.karte, 'sieg', { versuche: S.versuch });   // TEL-01 B1
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
  S.n = aktiveWelle(aw, S, wellenNummern(karteVon(game, S.lp)));
  if (S.ziel === 'gesperrt' && zielOeffnet(game, S, aw)) {
    S.ziel = 'offen'; zielFreigeben(game, S);
    game.oda(text(game, 'ziel_offen'), null);
    game.emit('sfx', { name: 'repair_done', zone: 'away' });
  }
  // Ziel: die Sprengung ist erfolgt (der Knall, nicht das Zünden). Dann Warnsignal und Nachschub, genau einmal
  if (S.ziel !== 'erreicht' && M().anker.zustand(game, S.lp, S.zielId) === 'zerstoert') {
    S.ziel = 'erreicht';
    game.oda(text(game, 'ziel_erreicht'), null);
    nachschubSenden(game, S);
  }
  // Sieg: Sprengung erfolgt und die ganze Crew wieder an Bord (Hochbeamen am Pad des Bunkereingangs oder am Abholpunkt)
  const t = team(game);
  if (S.ziel === 'erreicht' && t.length && !t.some((p) => p.zone === 'away')) sieg(game, S);
}

// Zeile für Zielanzeige/HUD (arena.wellenText)
function zeile(game, S) {
  if (S.ph === 'vorbereitung') return text(game, 'zeile_ruest');
  if (S.ph === 'ende') return text(game, 'zeile_sieg');
  const aw = game.aways[S.lp];
  if (S.ziel === 'erreicht') return text(game, 'zeile_hoch');
  if (M().anker.zustand(game, S.lp, S.zielId) === 'scharf') return text(game, 'zeile_scharf');
  if (S.ziel === 'offen') return text(game, 'zeile_ziel');
  if (S.deckVon && S.deckVon[3] != null) return text(game, 'zeile_kampf3', welleLebt(aw, S, 1), welleLebt(aw, S, 2), welleLebt(aw, S, 3));   // mit Welle 3 (Bunker)
  return text(game, 'zeile_kampf', welleLebt(aw, S, 1), welleLebt(aw, S, 2));
}

// ---------- Hooks der Bühne (wellen.js BUEHNEN.graben): nur, was Snapshot-Block und Ablauf brauchen ----------
const BUEHNE = {
  bereit(game, S) { return !!game.aways[S.lp]; },
  zaehle(game, S) { /* update zählt selbst */ },
  // Anzeige „Gegner übrig“ (Snapshot l/r): nur die Gegner der Wellen, der Nachschub (S.nachschubIds) mischt sich nicht in die Wellenanzeige
  stehend(game, S) { const aw = game.aways[S.lp]; const nach = new Set(S.nachschubIds || []); return aw ? lebende(aw).filter((e) => !nach.has(e.id)).length : 0; },
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

module.exports = { BUEHNE, liste, auswahl, auswahlSetzen, start, update, vorbereitungEnde, neuBeginnen, zeile, debug, besetzungFuer, plaetzeFuer, _nachschubPlaetze: nachschubPlaetze };   // _nachschubPlaetze: nur Tests
