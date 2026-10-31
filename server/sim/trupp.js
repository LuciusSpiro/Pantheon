'use strict';
// BOD-02 P7: Trupp-Gehirn der Boden-KI. Aufgaben statt neuer Gegnertypen: der Trupp verteilt Aufgaben, die Waffenrollen bestimmen nur,
// wer welche bevorzugt. Gleiche Regeln für alle Fraktionen (Spieler und Gegner kennen dieselben Waffen, nur die KI-Zuteilung ist neu).
//
// Aufgaben (e.aufgabe, nur serverintern, nicht im Snapshot; Debug: aw.squads[name].aufgaben):
//   niederhalten    Deckungsfeuer auf den Spieler bzw. seine letzte bekannte Position (Sturmgewehr: Niederhalter; sonst ein Blaster-Träger)
//   scharf          Scharfschütze: hält Abstand >= truppGehirn.scharfAbstand Kacheln (Lanze: Schütze)
//   unterstuetzung  Granaten auf die gedeckte Position bzw. letzte bekannte Position (Granatwerfer: Grenadier)
//   flanke          Flankenschutz: bleibt in Deckung an der Seite, überwacht die Flanken, meldet Umgehung (Funk) und schwenkt den Trupp um
//   sturm           Stürmer (Nahkampf: Enterer)
//   allround        Rest (Blaster/Grundtyp, Häscher, Trupps mit < 2 Lebenden)
//   gegenstoss      BOD-02 P9 (nur Trupps mit Verteidigungsprofil): geht in den Graben auf einen Spieler zu, der in der Stellung steht; höchstens einer je Spieler
//                   (gegenstossVerteilen, Aufruf aus verteidigung.tick); liegt außerhalb der Verteilung unten (e.gegenstoss = Spieler-id)
// Nur für alarmierte Trupps mit >= 2 Lebenden; Wächter (kind warden) zählen nicht. Ab 4 Lebenden hält mindestens einer nieder und
// einer sichert die Flanke (lückenfüllend, Allrounder zuerst). Die Verteilung hängt nur von den lebenden Mitgliedern ab: sie ändert sich
// bei Tod (sofort, mit Beharrung: wer seine Aufgabe behalten kann, behält sie) bzw. Zugang (frühestens nach haltezeit s), sonst nie (kein Flackern).
const Physics = require('../../shared/physics.js');
const { dist } = require('../util.js');

const TILE = Physics.TILE;
const squadMod = () => require('./squad.js');
const cfg = (game) => game.C.awayCombat;

const AUFGABEN = ['niederhalten', 'scharf', 'unterstuetzung', 'flanke', 'sturm', 'allround', 'gegenstoss'];
// Standardwerte (überschreibbar über CONFIG.awayCombat.truppGehirn, tune awayCombat.truppGehirn.<name>)
//   hz: Takt des Gehirns (Verteilung + Flankenüberwachung); haltezeit: s bis Zugang zu einer Neuverteilung führt
//   flankeWinkel/flankeKacheln: Spieler im Flankensektor = mehr als Winkel Grad von der Trupp-Achse bei höchstens so vielen Kacheln Abstand
//   bedrohungSek: so lange gilt die Umgehung als Bedrohung (verlängert sich, solange der Spieler dort gesehen wird); sperreSek: Pause bis zur nächsten Meldung desselben Spielers
//   scharfAbstand: Kacheln Mindestabstand des Scharfschützen; niederhaltenSek/unterstuetzungSek: so lange nach letzter Sicht wird auf die letzte Position gefeuert
//   stossBlaster: Schüsse je Deckungsfeuer-Stoß eines Blaster-Trägers mit Aufgabe niederhalten (Sturmgewehr: gegner.niederhalter.stoss)
//   umgehungSek: so lange muss ein Spieler (gesehen) im Flankensektor stehen, bevor er als umgangen gilt (Hysterese; nur Trupps ohne Verteidigungsprofil)
//   achseNeuKacheln: wandert der Trupp-Schwerpunkt weiter als so viele Kacheln vom Achsen-Ursprung, wird die Achse neu gesetzt
const STANDARD = { hz: 1.5, haltezeit: 4, flankeWinkel: 50, flankeKacheln: 14, bedrohungSek: 8, sperreSek: 12, scharfAbstand: 7,
  niederhaltenSek: 8, unterstuetzungSek: 8, stossBlaster: 4, achseNeuKacheln: 6, umgehungSek: 1 };
const truppCfg = (game) => Object.assign({}, STANDARD, cfg(game).truppGehirn || {});

const BASIS = { schuetze: 'scharf', grenadier: 'unterstuetzung', niederhalter: 'niederhalten', enterer: 'sturm' };
const RANG = { grundtyp: 0, haescher: 1, enterer: 2, niederhalter: 3, grenadier: 4, schuetze: 5 };   // wer zuerst für fremde Aufgaben herangezogen wird
const rolleVon = (e) => e.rolle || 'grundtyp';
const winkelDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
const idZahl = (e) => String(e.id);

function mitglieder(game, s) {
  return game.away.drones.filter((e) => e.alive && !e.asleep && e.kind !== 'warden' && e.squad === s.name);
}

// Blaster-Träger (Grundtyp) können Deckungsfeuer übernehmen, wenn kein Niederhalter da ist
function niederhaelt(e) { return e.rolle === 'niederhalter' || (e.aufgabe === 'niederhalten' && rolleVon(e) === 'grundtyp'); }

// Aufgabenverteilung: Rolle -> Basisaufgabe, ab 4 Lebenden lückenfüllend (niederhalten, flanke)
function verteile(ms0) {
  const ms = ms0.filter((e) => !e.gegenstoss);   // P9: der Gegenstoßler behält seine Aufgabe
  const neu = new Map();
  for (const e of ms) neu.set(e, BASIS[rolleVon(e)] || 'allround');
  if (ms.length < 4) return neu;
  const zahl = (task) => ms.filter((e) => neu.get(e) === task).length;
  const fuelle = (task) => {
    if (zahl(task)) return;
    // Kandidaten: Allrounder zuerst, dann Rollen, deren Aufgabe doppelt besetzt ist; Beharrung (gleiche Aufgabe wie bisher) vor Rang
    let kand = ms.filter((e) => neu.get(e) === 'allround');
    if (!kand.length) { kand = ms.filter((e) => zahl(neu.get(e)) >= 2 && neu.get(e) !== 'scharf'); }
    if (!kand.length) { kand = ms.filter((e) => ['sturm', 'unterstuetzung'].includes(neu.get(e))); }   // letzter Ausweg: der einzige Stürmer/Werfer
    if (!kand.length) return;
    kand.sort((a, b) => ((a.aufgabe === task ? 0 : 1) - (b.aufgabe === task ? 0 : 1)) || (RANG[rolleVon(a)] - RANG[rolleVon(b)]) || (idZahl(a) < idZahl(b) ? -1 : 1));
    neu.set(kand[0], task);
  };
  fuelle('niederhalten');
  fuelle('flanke');
  return neu;
}

function schwerpunkt(ms) {
  let x = 0, y = 0;
  for (const e of ms) { x += e.x; y += e.y; }
  return { x: x / ms.length, y: y / ms.length };
}
// Spieler, die der Trupp kennt (sieht oder aus dem Trupp-Wissen), mit Position
function bekannte(game, s, ms) {
  const out = [];
  for (const p of game.players) {
    if (p.zone !== 'away' || !p.connected || p.downed) continue;
    const gesehen = ms.some((e) => (e.sees || []).includes(p)) || (s.geteilt && s.geteilt[p.id] > game.time);
    if (gesehen) out.push({ p, x: p.x, y: p.y, gesehen: true });
    else if (s.lastKnown && s.lastKnown[p.id]) out.push({ p, x: s.lastKnown[p.id].x, y: s.lastKnown[p.id].y, gesehen: false });
  }
  return out;
}
// Trupp-Achse: mittlere Richtung Schwerpunkt -> bekannte Spieler VOR dem Trupp; bleibt fest, bis der Trupp weit gewandert ist.
// Spieler mehr als flankeWinkel von der bisherigen Achse (Umgeher) fließen nicht in die Neuberechnung ein, die Achse enthält so nie den Spieler, dessen
// Umgehung geprüft wird (und mit nur einem bekannten Spieler bleibt sie die bisherige feste Achse). Steht niemand mehr vor dem Trupp, zählen alle
// bekannten Spieler (sonst bliebe die Achse für immer veraltet).
function achseSetzen(game, s, ms, T, bk) {
  const sp = schwerpunkt(ms);
  if (s.achse != null && s.achseOrt && dist(sp.x, sp.y, s.achseOrt.x, s.achseOrt.y) <= T.achseNeuKacheln * TILE) return sp;
  if (!bk.length) return sp;
  if (s.achse != null) {
    const lim = T.flankeWinkel * Math.PI / 180;
    const vorn = bk.filter((k) => winkelDiff(Math.atan2(k.y - sp.y, k.x - sp.x), s.achse) <= lim);
    if (vorn.length) bk = vorn;
  }
  let ux = 0, uy = 0;
  for (const k of bk) { const d = dist(k.x, k.y, sp.x, sp.y) || 1; ux += (k.x - sp.x) / d; uy += (k.y - sp.y) / d; }
  if (Math.hypot(ux, uy) < 0.2) { const n = bk.slice().sort((a, b) => dist(a.x, a.y, sp.x, sp.y) - dist(b.x, b.y, sp.x, sp.y))[0]; ux = n.x - sp.x; uy = n.y - sp.y; }
  s.achse = Math.atan2(uy, ux); s.achseOrt = { x: sp.x, y: sp.y };
  return sp;
}

// Flankenschutz überwacht die Flanken: Spieler im Flankensektor der Achse (gesehen) = Umgehung -> Funk + Trupp schwenkt um
function beobachteFlanke(game, s, ms, T, bk, sp) {
  const sq = squadMod();
  const wache = ms.find((e) => e.aufgabe === 'flanke');
  if (!wache || s.achse == null) return;
  const lim = T.flankeWinkel * Math.PI / 180;
  const V = s.verteidigung;   // K1: Trupps mit Verteidigungsprofil bemessen die Umgehung an der Linie (Hinterland/Flanke der Sohle), nicht am Schwerpunkt
  const imSektor = V ? (k) => k.gesehen && require('./verteidigung.js').umgehung(game, V, k.x, k.y) : (k) => k.gesehen && dist(k.x, k.y, sp.x, sp.y) <= T.flankeKacheln * TILE && winkelDiff(Math.atan2(k.y - sp.y, k.x - sp.x), s.achse) > lim;
  if (s.bedrohung) {
    const b = s.bedrohung;
    const k = bk.find((q) => q.p.id === b.pid);
    if (k && imSektor(k)) { b.bis = game.time + T.bedrohungSek; b.x = k.x; b.y = k.y; }   // noch dort: Bedrohung bleibt
    else if (game.time > b.bis) s.bedrohung = null;
  }
  if (s.bedrohung) return;
  if (!s.umgangen) s.umgangen = {};
  if (!s.imSektorAb) s.imSektorAb = {};
  for (const k of bk) {
    // ohne Verteidigungsprofil: der Spieler muss umgehungSek am Stück im Sektor stehen (Vert.umgehung hat ihre eigene Dauer)
    if (!imSektor(k)) { delete s.imSektorAb[k.p.id]; continue; }
    if (!V) { if (s.imSektorAb[k.p.id] == null) s.imSektorAb[k.p.id] = game.time; if (game.time - s.imSektorAb[k.p.id] < T.umgehungSek - 1e-6) continue; }
    if ((s.umgangen[k.p.id] || 0) > game.time) continue;
    const ang = Math.atan2(k.y - sp.y, k.x - sp.x);
    s.umgangen[k.p.id] = game.time + T.sperreSek;
    s.bedrohung = { pid: k.p.id, x: k.x, y: k.y, t: game.time, bis: game.time + T.bedrohungSek, winkel: ang };
    // Seite der Flankenwache: dorthin, wo der Spieler kommt (rechts = Kreuzprodukt > 0, wie squad.sideOf)
    const cross = Math.cos(s.achse) * Math.sin(ang) - Math.sin(s.achse) * Math.cos(ang);
    s.flankSeite = cross > 0 ? 1 : -1;
    const aw = game.away;
    aw.truppStats = aw.truppStats || { umgangen: 0 };
    aw.truppStats.umgangen++;
    s.barkAt = Math.min(s.barkAt, game.time - cfg(game).barkCooldown);   // diese Meldung geht immer raus
    sq.bark(game, s, wache, 'flanke_umgangen');
    if (s.geteilt) s.geteilt[k.p.id] = game.time + (Number(cfg(game).sicht && cfg(game).sicht.geteiltTtl) || 6);   // Trupp-Funk: alle kennen ihn
    for (const e of ms) { e.goal = null; e.path = null; e.goalAt = -99; e.bedrohungT = null; e.umschwenkT = game.time; }   // ALLE lebenden Mitglieder verwerfen Platz und Weg und wählen neu (planPin/planPush/planAdvance gegen die neue Richtung)
    return;
  }
}

// Seite der Flankenwache: dort, wo weniger Kameraden stehen (quer zur Achse); wird bei jeder Neuverteilung bestimmt, bei Umgehung auf die Seite des Spielers
function seiteWaehlen(s, ms, sp) {
  if (s.achse == null) { s.flankSeite = s.flankSeite || 1; return; }
  let sum = 0;
  for (const e of ms) { const vx = e.x - sp.x, vy = e.y - sp.y; sum += Math.cos(s.achse) * vy - Math.sin(s.achse) * vx; }
  s.flankSeite = sum > 0 ? -1 : 1;
}

function leeren(s, ms) {
  s.aufgaben = null; s.gehirnIds = null; s.achse = null; s.achseOrt = null; s.bedrohung = null; s.imSektorAb = null; s.flankSeite = 0;
  for (const e of ms) e.aufgabe = null;
}

// Ein Trupp: Aufgaben verteilen und Flanken überwachen
function truppGehirn(game, E, s) {
  const T = truppCfg(game);
  const ms = mitglieder(game, s);
  if (!s.alert || s.noBark || s.name === 'warden' || ms.length < 2) {
    const alle = game.away.drones.filter((e) => e.squad === s.name && e.kind !== 'warden');
    if (s.alert && ms.length >= 1) { s.aufgaben = null; s.gehirnIds = null; s.achse = null; s.bedrohung = null; for (const e of alle) e.aufgabe = e.alive ? (e.gegenstoss ? 'gegenstoss' : 'allround') : null; }
    else leeren(s, alle);
    return;
  }
  const ids = ms.map(idZahl).sort().join(',');
  if (s.gehirnIds !== ids) {
    const alt = s.gehirnIds ? s.gehirnIds.split(',') : [];
    const tod = alt.some((id) => !ms.some((e) => idZahl(e) === id));
    if (!s.gehirnIds || tod || game.time - (s.aufgabeAt || -99) >= T.haltezeit) {
      const neu = verteile(ms);
      s.aufgaben = {};
      for (const e of ms) {
        if (e.gegenstoss) { e.aufgabe = 'gegenstoss'; s.aufgaben[e.id] = e.aufgabe; continue; }
        if (e.aufgabe === 'aufrichten') { e.aufgabeVor = neu.get(e); s.aufgaben[e.id] = neu.get(e); continue; }   // P10: Helfer behält die Aufgabe aufrichten, danach gilt die Verteilung
        if (e.aufgabe !== neu.get(e)) e.aufgabeAt = game.time;
        e.aufgabe = neu.get(e); s.aufgaben[e.id] = e.aufgabe;
      }
      s.gehirnIds = ids; s.aufgabeAt = game.time;
      seiteWaehlen(s, ms, schwerpunkt(ms));
    }
  }
  const bk = bekannte(game, s, ms);
  const sp = achseSetzen(game, s, ms, T, bk);
  s.schwerpunkt = sp;
  beobachteFlanke(game, s, ms, T, bk, sp);
  aufrichtenVerteilen(game, E, s, ms);
}

// P9 Gegenstoß: steht ein Spieler in der Stellung, geht höchstens EIN Verteidiger je Spieler gegen ihn vor (Stürmer zuerst, dann Allrounder, sonst der
// Nächste); die übrigen halten. Beendet (Aufgabe zurück), wenn der Spieler die Stellung verlässt, stirbt/fällt oder der Gegenstoßler fällt (dann der Nächste).
// ms: lebende Mitglieder der Linie, spieler: Spieler in der Stellung (mit Verweildauer gegenstossSek). C = Config awayCombat.verteidigung.
function gegenstossVerteilen(game, ms, spieler, C) {
  const aw = game.away;
  const ids = new Set(spieler.map((p) => p.id));
  for (const e of ms) {
    if (!e.gegenstoss || ids.has(e.gegenstoss)) continue;
    e.gegenstoss = null; e.aufgabe = null; e.goal = null; e.path = null; e.goalAt = -99; e.stopNear = 0; e.stopTarget = null; e.shootTarget = null;
  }
  const min = Math.max(2, Number(C.gegenstossMinLinie) || 2);
  const rangG = (e) => (rolleVon(e) === 'enterer' ? 0 : rolleVon(e) === 'grundtyp' ? 1 : 2);   // Stürmer, dann Allrounder, sonst Nächster
  for (const p of spieler) {
    if (ms.some((e) => e.gegenstoss === p.id)) continue;
    const frei = ms.filter((e) => !e.gegenstoss && e.aufgabe !== 'aufrichten' && e.role !== 'aufrichten' && !e.hilft);   // W2: Aufrichter zählen nicht als frei
    if (ms.length < min || frei.length < 2) break;   // die Linie darf nicht leerlaufen: mindestens einer bleibt
    frei.sort((a, b) => (rangG(a) - rangG(b)) || (dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y)) || (idZahl(a) < idZahl(b) ? -1 : 1));
    const e = frei[0];
    if (e.hilft) squadMod().aufrichtenEnde(game, e, 'gegenstoss');   // W1 (Absicherung; frei enthält keine Aufrichter): laufenden Auftrag sauber beenden
    e.gegenstoss = p.id; e.aufgabe = 'gegenstoss'; e.goal = null; e.path = null; e.goalAt = -99; e.aim = null;
    aw.truppStats = aw.truppStats || { umgangen: 0 };
    aw.truppStats.gegenstoss = (aw.truppStats.gegenstoss || 0) + 1;
  }
}


// BOD-02 P10: Aufrichten als Aufgabe. Für jeden Liegenden gibt der Trupp genau einem geeigneten Helfer (nächster; Niederhalter/Flanke/Scharfschütze nur ohne
// Alternative) die Aufgabe `aufrichten`, wenn eine Sicherung besteht (server/sim/aufrichten.js pruefe). Ohne Sicherung bleibt der Liegende liegen (kein Köder).
// Das Gehirn sieht nur Trupps mit Aufgabenverteilung; Beginn und Abbruch macht squad.js aufrichtenSchritt.
function aufrichtenVerteilen(game, E, s, ms) {
  const Aufr = require('./aufrichten.js');
  if (!Aufr.cfg(game).sichtPruefen) return;
  for (const d of Aufr.liegende(game)) {
    const w = Aufr.waehleHelfer(game, E, s, d, ms);
    if (!w) continue;
    const m = w.m;
    m.aufgabeVor = m.aufgabe; m.aufgabe = 'aufrichten'; m.hilft = d.id; d.helfer = m.id;
  }
}

// Läuft das Gehirn für diesen Trupp (alarmiert, >= 2 Lebende, nicht noBark, kein Wächter)?
function laeuft(game, s) { return !!s && s.alert && !s.noBark && s.name !== 'warden' && mitglieder(game, s).length >= 2; }

// Alle Trupps (aufgerufen aus squad.update im KI-Takt, selbst gedrosselt auf hz)
function update(game, E) {
  const aw = game.away; const T = truppCfg(game);
  if (aw.gehirnAt != null && game.time - aw.gehirnAt < 1 / Math.max(0.2, T.hz) - 1e-6) return;
  aw.gehirnAt = game.time;
  for (const s of Object.values(aw.squads || {})) {
    if (!s) continue;
    try { truppGehirn(game, E, s); } catch (err) { game.countError('squad-trupp', err); }
  }
}

// Die laufende Umgehung, falls vorhanden (squad.planPin/pickTarget)
function bedrohung(game, s) {
  const b = s && s.bedrohung;
  return b && game.time <= b.bis ? b : null;
}

module.exports = { AUFGABEN, STANDARD, cfg: truppCfg, update, truppGehirn, verteile, bedrohung, niederhaelt, mitglieder, gegenstossVerteilen, laeuft };
