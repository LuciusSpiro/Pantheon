'use strict';
// Anker-Interaktionen zur Laufzeit (CONTRACT-B1 §6.2, §3.3; Team BUEHNE). Nur gebaute Karten (W.AWAY_MAPS[id].karte);
// Handkarten laufen unverändert über away.js/combat.js (Tutorial-Schutz, Golden).
//
// Zustand: aw.zustaende[ankerId | kantenId] (Abweichungen vom Start; dieselbe Tabelle liest BODENKAMPF in
// interior.kachelZustand für Türen/Tore/Schotts), aw.alarm, aw.ankerLauf = { download: {id: s}, ladung: {id: {t}},
// raetsel: {id: zeit}, markiert: bool }.
//
// Einbau (BODENKAMPF interior.js, ENGINE game.js) – alle Aufrufe defensiv, nie in den Tick werfen:
//   interactionsAt(game, p, tx, ty, list)  im Außen-Zweig für gebaute Karten; legt { kind: 'anker:<rolle>'|'anker:tuer', … } an
//   istAnkerHold(kind)                      true für 'anker:*' -> holdDuration/holdValid/completeHold hierher delegieren
//   holdDuration(game, p, kind, it)         Sekunden (CONFIG.anker.halten)
//   holdValid(game, p, h)  completeHold(game, p, h)
//   update(game, dt)                        jeden Tick, wenn game.away eine gebaute Karte ist (Download-Fortschritt,
//                                           Countdown + Explosion, Rätselfenster aus dem Laufweg, F4)
//   onTreffer(game, pid)                    bei jedem Treffer auf einen Spieler (Abbruch Download/Ladung)
//   setzen(game, map, id, zustand, pid?, opts?)  Bausteine anker_zustand/kante_zustand, Debug `anker`
//   zustand(game, map, id)  alarm(game, map, an)  markieren(game, map)  awaySnap(game, aw)
const W = require('../world.js');
const Physics = require('../../shared/physics.js');
const Buehne = require('../../shared/buehne.js');

const TILE = Physics.TILE;
const TUER_ZEIT = Buehne.TUER_ZEIT;   // E (kurz halten): Tür/Luke/Schott/Tor im Zustand 'zu' öffnen (Quelle: shared/buehne.js)
const EXPLOSION = { radius: 2, segmente: 3 };   // Rückfall; maßgeblich ist CONFIG.anker.explosion

let rollenCache = null;
function rollen() {
  if (!rollenCache) { try { rollenCache = Buehne.daten().anker.rollen || {}; } catch (e) { rollenCache = {}; } }
  return rollenCache;
}
function startZustand(rolle) { const r = rollen()[rolle]; return r && r.zustaende && r.zustaende.length ? r.zustaende[0] : null; }
function kfg(game) { return (game.C && game.C.anker) || { halten: {}, countdown: 60, paarFenster: 1.5, paarSoloFenster: 15 }; }
function karteVon(map) { const e = W.AWAY_MAPS[map]; return e && e.karte && Array.isArray(e.karte.rows) ? e.karte : null; }
function awVon(game, map) { return (game.aways && game.aways[map]) || null; }
function lauf(aw) {
  if (!aw.ankerLauf) aw.ankerLauf = { download: {}, ladung: {}, raetsel: {} };
  if (!aw.zustaende) aw.zustaende = {};
  return aw.ankerLauf;
}
function safe(game, where, fn) {
  try { return fn(); } catch (e) { try { if (game.countError) game.countError(where, e); } catch (x) { /* */ } return null; }
}
function ankerById(k, id) { return k.anker.find((a) => a.id === id) || null; }
function zustandIn(aw, k, id) {
  const z = aw && aw.zustaende && aw.zustaende[id];
  if (z) return z;
  if (k.kanten && k.kanten[id]) return k.kanten[id].zustand;
  if (k.zustaende && k.zustaende[id]) return k.zustaende[id];
  const a = ankerById(k, id);
  return a ? startZustand(a.rolle) : null;
}
function zustand(game, map, id) {
  const k = karteVon(map); if (!k) return null;
  return zustandIn(awVon(game, map), k, id);
}
const mitte = (a) => ({ x: a.x * TILE + TILE / 2, y: a.y * TILE + TILE / 2 });

// Kachelgruppe (Tür/Tor/Schott/Luke bzw. schwache Wand) zu einem Anker -> Kanten-IDs, deren Kacheln sie berühren
// (Regel in shared/buehne.js ankerKanten, gemeinsam mit dem Client)
function kantenVonAnker(k, a) { return Buehne.ankerKanten(k, a).map((kk) => kk.id); }
// Eingang (art technisch): angebotene Aktion 'hacken' | 'luke' | null (shared/buehne.js eingangAktion, Client-E-Hinweis gleich)
function eingangOp(aw, k, a) { return Buehne.eingangAktion(k, a, (kk) => zustandIn(aw, k, kk.id)); }
// Anker-Zustand auf die Zustände einer Kachelart abbilden (tor offen -> Tür offen, gesprengt -> offen, wenn die Art das nicht kennt)
function kachelZustandFuer(kind, z, k) {
  const info = Object.values(k.legende || {}).find((i) => i.kind === kind);
  const liste = (info && info.zustaende) || [];
  if (liste.includes(z)) return z;
  if (z === 'gesprengt' || z === 'gehackt' || z === 'offen') return liste.includes('offen') ? 'offen' : liste[0];
  if (z === 'verschlossen') return liste.includes('verschlossen') ? 'verschlossen' : (liste.includes('zu') ? 'zu' : liste[0]);
  return liste.includes('zu') ? 'zu' : liste[0];
}

// ---------- Zustand setzen (eine Stelle für alle Wege: Interaktion, Bausteine, Debug) ----------
// opts: { merken: bool (in den Weltstand-Eintrag des Landepunkts), still: bool (ohne Ereignis) }. -> Fehlertext | null
function setzen(game, map, id, z, pid, opts) {
  const o = opts || {};
  const k = karteVon(map);
  if (!k) return `Karte ${map} ist keine gebaute Karte (Handkarten über ihre Objekte).`;
  const aw = awVon(game, map);
  if (!aw) return `Karte ${map} ist nicht geladen.`;
  lauf(aw);
  let rolle = null; let erlaubt;
  const a = ankerById(k, id);
  if (a) { rolle = a.rolle; erlaubt = (rollen()[rolle] || {}).zustaende || []; }
  else if (k.kanten && k.kanten[id]) { const kk = k.kanten[id]; erlaubt = ((Object.values(k.legende).find((i) => i.kind === kk.typ) || {}).zustaende) || []; }
  else return `Anker/Kante ${id} gibt es auf ${map} nicht.`;
  if (!erlaubt.includes(z)) return `Zustand ${z} unbekannt für ${id} (${erlaubt.join(', ') || 'keine Zustände'}).`;
  const vorher = zustandIn(aw, k, id);
  aw.zustaende[id] = z;
  // Tore, Eingänge, Verstecke steuern ihre Kacheln: Kanten mitsetzen
  if (a && (a.rolle === 'tor' || a.rolle === 'eingang' || a.rolle === 'versteck')) {
    const kz = a.rolle === 'eingang' ? (z === 'verschlossen' ? 'verschlossen' : null) : z;
    if (kz) for (const kid of kantenVonAnker(k, a)) aw.zustaende[kid] = kachelZustandFuer(k.kanten[kid].typ, kz, k);
  }
  if (o.merken) safe(game, 'anker-merken', () => {
    const L = require('./landepunkte.js');
    const e = L.eintrag(game, map);
    if (e) { e.zustaende = e.zustaende || {}; e.zustaende[id] = z; if (a && (a.rolle === 'tor' || a.rolle === 'versteck')) for (const kid of kantenVonAnker(k, a)) e.zustaende[kid] = aw.zustaende[kid]; }
  });
  if (!o.still && vorher !== z) {
    game.emit('ankerZustand', { map, anker: id, zustand: z, rolle: rolle || undefined, pid: pid || undefined });
    game.missionEvent('ankerZustand', { map, anker: id, rolle, zustand: z, pid: pid || null, vorher });
  }
  return null;
}

// ---------- Interaktionen ----------
function istAnkerHold(kind) { return typeof kind === 'string' && kind.startsWith('anker:'); }
function ankerAt(k, tx, ty) { return k.anker.filter((a) => a.x === tx && a.y === ty); }
function inventar(game) { return game.inventory || {}; }

function interactionsAt(game, p, tx, ty, list) {
  const aw = game.away; if (!aw || p.zone !== 'away') return;
  const k = karteVon(aw.map); if (!k) return;
  const L = lauf(aw);
  const H = (kfg(game).halten) || {};
  for (const a of ankerAt(k, tx, ty)) {
    const z = zustandIn(aw, k, a.id);
    const it = (extra) => list.push(Object.assign({ kind: 'anker:' + a.rolle, anker: a.id, tx, ty }, extra || {}));
    const block = (msg) => list.push({ kind: 'anker:' + a.rolle, blocked: msg });
    switch (a.rolle) {
      case 'terminal':
        if (z === 'bereit') it({ op: 'download' });
        else if (z === 'laedt') { if (holdOther(game, p, a.id)) block('Dort lädt schon jemand.'); else it({ op: 'download' }); }
        else if (z === 'geladen') it({ op: 'lesen' });
        else block('Das Terminal ist gesperrt.');
        break;
      case 'sprengpunkt':
        if (z === 'intakt') { if ((inventar(game).ladung || 0) > 0) it(); else block('Keine Sprengladung dabei.'); }
        else if (z === 'scharf') block(`Scharf! Noch ${Math.ceil((L.ladung[a.id] && L.ladung[a.id].t) || 0)} s – weg da!`);
        else block('Hier ist nichts mehr zu sprengen.');
        break;
      case 'zelle': if (z === 'zu') it(); else block('Die Zelle steht offen.'); break;
      case 'beute': if (z === 'voll') it(); else block('Leer geräumt.'); break;
      case 'ziel': if (z === 'frei') it(); else block('Erledigt.'); break;
      case 'fund': if (z === 'da') it(); else block('Der Sockel ist leer.'); break;
      case 'raetsel':
        if (z === 'geloest') block('Gelöst.');
        else if (z === 'gehalten') block(istSolo(game) ? 'Gedreht! Jetzt das zweite Schloss – ' + Buehne.raetselHinweis(true, paarFenster(game, k, a.paar)) + '.' : 'Gedreht! Jetzt muss das Gegenstück – sofort.');
        else it();
        break;
      case 'versteck':
        if (z === 'offen') break;
        if (L.markiert) it(); else block('Die Wand klingt hohl … Ein Weitscan aus dem Orbit zeigt, was dahinter ist.');
        break;
      case 'eingang': {
        // art technisch: Schott hacken (schott_hacken); Luke öffnen (Studioleitung: auch von innen, s. u. Türgruppe)
        const op = eingangOp(aw, k, a);
        if (op) it({ op });
        break;
      }
      default: break;
    }
  }
  // Türen/Luken/Schotts/Tore im Zustand 'zu' (nicht an einem tor-Anker): kurz halten öffnet
  const ch = k.rows[ty] && k.rows[ty][tx];
  const info = ch && k.legende[ch];
  if (info && info.kante === 'tuer') {
    const kid = Object.keys(k.kanten || {}).find((q) => (k.kanten[q].tiles || []).some((t) => t[0] === tx && t[1] === ty));
    if (kid) {
      const z = zustandIn(aw, k, kid);
      const torAnker = k.anker.find((a) => a.rolle === 'tor' && kantenVonAnker(k, a).includes(kid));
      // Luke eines technischen Eingangs: von innen wie von außen zu öffnen, auch wenn sie verschlossen ist
      const lukeTech = info.kind === 'luke' && k.anker.some((a) => a.rolle === 'eingang' && a.art === 'technisch' && kantenVonAnker(k, a).includes(kid));
      if (lukeTech && z !== 'offen') list.push({ kind: 'anker:tuer', kante: kid, typ: 'luke', tx, ty, technisch: true });
      // tor-Anker: nur rätselgebundene Tore sind verriegelt (Kassentür hinter dem Rätselpaar); ein Tor im Zustand 'zu'
      // ohne Rätsel (z. B. Schott-Füllplatz der Station) öffnet wie jede Tür mit E
      const verriegelt = torAnker && raetselGebunden(k, torAnker) && z !== 'offen' && z !== 'gesprengt';
      if (z === 'zu' && !verriegelt) list.push({ kind: 'anker:tuer', kante: kid, typ: info.kind, tx, ty, tor: torAnker ? torAnker.id : undefined });
      else if (z === 'verschlossen' || verriegelt) list.push({ kind: 'anker:tuer', blocked: verriegelt ? 'Verriegelt – das öffnet erst das Rätsel (beide Schlösser gleichzeitig).' : 'Verschlossen.' });
    }
  }
}
// Tor hängt an einem Rätselpaar: gleiches paar, oder (Tor ohne paar) die Karte hat Rätselanker
function raetselGebunden(k, tor) {
  const rs = k.anker.filter((a) => a.rolle === 'raetsel');
  if (!rs.length) return false;
  return tor.paar ? rs.some((a) => a.paar === tor.paar) : true;
}
function holdOther(game, p, id) { return game.players.some((o) => o !== p && o.hold && o.hold.anker === id); }

function holdDuration(game, p, kind, it) {
  const H = kfg(game).halten || {};
  const rolle = kind.slice(6);
  if (rolle === 'tuer') return TUER_ZEIT[(it && it.typ) || 'tuer'] || 0.5;
  if (rolle === 'terminal') {
    if (it && it.op === 'lesen') return H.lesen || 2;
    const aw = game.away; const L = lauf(aw);
    const done = (it && L.download[it.anker]) || 0;
    return Math.max(0.2, (H.terminal || 6) - done);
  }
  if (rolle === 'eingang') return it && it.op === 'luke' ? TUER_ZEIT.luke : (H.schott_hacken || 6);
  return H[rolle] || 1;
}
function holdValid(game, p, h) {
  const aw = game.away;
  if (!aw || p.zone !== 'away') return false;
  const k = karteVon(aw.map); if (!k) return false;
  if (h.kind === 'anker:tuer') { const z = zustandIn(aw, k, h.kante); return z === 'zu' || (h.technisch && z !== 'offen'); }
  const a = ankerById(k, h.anker); if (!a) return false;
  const z = zustandIn(aw, k, a.id);
  switch (a.rolle) {
    case 'terminal': return h.op === 'lesen' ? z === 'geladen' : (z === 'bereit' || z === 'laedt');
    case 'sprengpunkt': return z === 'intakt' && (inventar(game).ladung || 0) > 0;
    case 'zelle': return z === 'zu';
    case 'beute': return z === 'voll';
    case 'ziel': return z === 'frei';
    case 'fund': return z === 'da';
    case 'raetsel': return z === 'ruhe';
    case 'versteck': return z !== 'offen';
    case 'eingang': return !!eingangOp(aw, k, a);
    default: return false;
  }
}
// Hold-Start (optional; sonst übernimmt update den Fortschritt): Terminal -> 'laedt'
function holdStart(game, p, h) {
  const aw = game.away; const k = aw && karteVon(aw.map);
  if (!k || h.kind !== 'anker:terminal' || h.op === 'lesen') return;
  if (zustandIn(aw, k, h.anker) === 'bereit') setzen(game, aw.map, h.anker, 'laedt', p.id);
}
function completeHold(game, p, h) {
  const aw = game.away; const k = aw && karteVon(aw.map); if (!k) return;
  const map = aw.map; const L = lauf(aw);
  if (h.kind === 'anker:tuer') {
    if (h.tor && zustandIn(aw, k, h.tor) !== 'offen') setzen(game, map, h.tor, 'offen', p.id);   // Tor-Anker mitführen (setzt die Kanten mit)
    setzen(game, map, h.kante, 'offen', p.id); game.emit('sfx', { name: 'door', zone: 'away', x: h.tx * TILE + 16, y: h.ty * TILE + 16 }); return; }
  const a = ankerById(k, h.anker); if (!a) return;
  const c = mitte(a);
  switch (a.rolle) {
    case 'terminal':
      if (h.op === 'lesen') { game.missionEvent('ankerGelesen', { map, anker: a.id, pid: p.id }); return; }
      delete L.download[a.id];
      setzen(game, map, a.id, 'geladen', p.id);
      game.missionEvent('downloadFertig', { map, anker: a.id, pid: p.id });
      game.emit('sfx', { name: 'repair_done', zone: 'away', x: c.x, y: c.y });
      return;
    case 'sprengpunkt': {
      const inv = inventar(game);
      if ((inv.ladung || 0) <= 0) return;
      inv.ladung -= 1;
      ladungScharf(game, map, a.id, null, p.id);
      return;
    }
    case 'zelle': setzen(game, map, a.id, 'offen', p.id); return;
    case 'beute': setzen(game, map, a.id, 'leer', p.id); game.missionEvent('beuteGeborgen', { map, anker: a.id, pid: p.id }); return;
    case 'ziel': setzen(game, map, a.id, 'aktiviert', p.id); return;
    case 'fund': setzen(game, map, a.id, 'genommen', p.id); game.missionEvent('fundGeborgen', { map, anker: a.id, pid: p.id }); return;
    case 'versteck': setzen(game, map, a.id, 'offen', p.id); return;
    case 'eingang':
      for (const kid of kantenVonAnker(k, a)) {
        if (k.kanten[kid].typ === 'schott') setzen(game, map, kid, 'gehackt', p.id);
        else if (k.kanten[kid].typ === 'luke') setzen(game, map, kid, 'offen', p.id);
      }
      setzen(game, map, a.id, 'offen', p.id, { still: zustandIn(aw, k, a.id) === 'offen' });
      game.missionEvent('schottGehackt', { map, anker: a.id, pid: p.id });
      return;
    case 'raetsel': raetselGedreht(game, aw, k, a, p); return;
    default: return;
  }
}

// Ladung am Anker scharf schalten (Spiel, Debug `ladung`, Bausteine): ladungScharf(game, map, id, t?, pid?) -> Fehlertext | null.
// t = Countdown in s (Standard CONFIG.anker.countdown). Verbraucht kein Inventar. Ereignisse wie im Spiel.
function ladungScharf(game, map, id, t, pid) {
  const k = karteVon(map);
  if (!k) return `Karte ${map} ist keine gebaute Karte.`;
  const aw = awVon(game, map);
  if (!aw) return `Karte ${map} ist nicht geladen.`;
  const a = ankerById(k, id);
  if (!a || a.rolle !== 'sprengpunkt') return `${id} ist kein Sprengpunkt auf ${map}.`;
  if (zustandIn(aw, k, id) !== 'intakt') return `${id} ist nicht intakt (${zustandIn(aw, k, id)}).`;
  const sek = Number.isFinite(t) && t > 0 ? t : (kfg(game).countdown || 60);
  lauf(aw).ladung[id] = { t: sek };
  setzen(game, map, id, 'scharf', pid || null);
  game.emit('ladungScharf', { anker: id, t: sek, map });
  game.missionEvent('ladungScharf', { map, anker: id, pid: pid || null, t: sek });
  return null;
}

// ---------- Rätselpaare (allgemeine Kesh-Regel) ----------
// Fenster (Abnahme F4, Studioleitung): solo (genau 1 Spieler im Außenteam) aus dem Laufweg Schloss A -> Schloss B, einmal je
// gebauter Karte berechnet (WeakMap über das Kartenobjekt = Bau/Registrierung), Formel shared/buehne.js raetselFenster;
// ab 2 Spielern das enge Gruppenfenster CONFIG.anker.paarFenster (Koop: beide gleichzeitig).
function istSolo(game) { return Buehne.raetselSolo(game.players); }   // genau 1 Spieler im Außenteam (eine Zählung mit dem Client)
function paarFenster(game, k, paar) {
  if (!istSolo(game)) return kfg(game).paarFenster || 1.5;
  const C = game.C && game.C.anker ? game.C : { anker: kfg(game) };
  const f = safe(game, 'anker-raetselwege', () => Buehne.raetselSoloFenster(k, paar, C));
  return f == null ? Math.max(kfg(game).paarFenster || 1.5, kfg(game).paarSoloFenster || 15) : f;
}
function raetselGedreht(game, aw, k, a, p) {
  const L = lauf(aw);
  L.raetsel[a.id] = game.time;
  setzen(game, aw.map, a.id, 'gehalten', p && p.id);
  const partner = k.anker.find((q) => q.rolle === 'raetsel' && q.paar === a.paar && q.id !== a.id);
  if (partner && L.raetsel[partner.id] != null && game.time - L.raetsel[partner.id] <= paarFenster(game, k, a.paar)) {
    for (const q of [a, partner]) { delete L.raetsel[q.id]; setzen(game, aw.map, q.id, 'geloest', p && p.id); }
    // Tore öffnen: mit gleichem paar, sonst alle tor-Anker im Zustand zu/verschlossen
    const tore = k.anker.filter((q) => q.rolle === 'tor');
    const mitPaar = tore.filter((q) => q.paar === a.paar);
    for (const t of (mitPaar.length ? mitPaar : tore)) if (['zu', 'verschlossen'].includes(zustandIn(aw, k, t.id))) setzen(game, aw.map, t.id, 'offen', p && p.id);
    game.missionEvent('raetselGeloest', { map: aw.map, paar: a.paar });
  }
}

// ---------- Tick ----------
function update(game, dt) {
  const aw = game.away; if (!aw) return;
  const k = karteVon(aw.map); if (!k) return;
  const L = lauf(aw);
  // Download: Fortschritt laufender Holds mitschreiben; ohne Halter fällt 'laedt' auf 'bereit' zurück (Fortschritt bleibt)
  const haelt = new Set();
  for (const p of game.players) {
    const h = p.hold;
    if (!h || h.kind !== 'anker:terminal' || h.op === 'lesen' || p.zone !== 'away') continue;
    haelt.add(h.anker);
    if (h.basis == null) h.basis = L.download[h.anker] || 0;
    L.download[h.anker] = Math.min((kfg(game).halten || {}).terminal || 6, h.basis + h.t);
    if (zustandIn(aw, k, h.anker) === 'bereit') setzen(game, aw.map, h.anker, 'laedt', p.id);
  }
  for (const a of k.anker) if (a.rolle === 'terminal' && !haelt.has(a.id) && zustandIn(aw, k, a.id) === 'laedt') setzen(game, aw.map, a.id, 'bereit', null);
  // Ladung: Countdown -> Explosion
  for (const id of Object.keys(L.ladung).sort()) {
    const l = L.ladung[id];
    l.t -= dt;
    if (l.t > 0) continue;
    delete L.ladung[id];
    explodiere(game, aw, k, ankerById(k, id));
  }
  // Rätsel: einer allein -> nach dem Fenster zurück auf ruhe
  for (const id of Object.keys(L.raetsel).sort()) {
    const ra = ankerById(k, id);
    if (game.time - L.raetsel[id] <= paarFenster(game, k, ra && ra.paar)) continue;
    delete L.raetsel[id];
    if (zustandIn(aw, k, id) === 'gehalten') {
      setzen(game, aw.map, id, 'ruhe', null);
      if (!L.hinweisAt || game.time - L.hinweisAt > 6) { L.hinweisAt = game.time; if (game.oda) game.oda(istSolo(game) ? 'Zu langsam – das erste Schloss ist zurückgesprungen. Nacheinander, aber zügig.' : 'Beide gleichzeitig – einer allein reicht nicht.', null); }
    }
  }
}
function explodiere(game, aw, k, a) {
  if (!a) return;
  setzen(game, aw.map, a.id, 'zerstoert', null);
  const c = mitte(a);
  game.emit('ladungExplodiert', { anker: a.id, map: aw.map });
  game.emit('sfx', { name: 'explosion', zone: 'away', x: c.x, y: c.y });
  game.missionEvent('ladungGezuendet', { map: aw.map, anker: a.id });
  // Flächenwirkung r 2 Kacheln: alle (Friendly Fire, E17). Über combat (leitet bei aktiven Waffen an waffen.treffer weiter).
  const C = kfg(game).explosion || EXPLOSION;
  const r = (C.radius || 2) * TILE + TILE / 2;
  safe(game, 'anker-explosion', () => {
    const combat = require('./combat.js');
    for (const p of game.players) if (p.zone === 'away' && Math.hypot(p.x - c.x, p.y - c.y) <= r && typeof combat.hitPlayer === 'function') combat.hitPlayer(game, p, C.segmente || 3, { kind: 'ladung', x: c.x, y: c.y, flaeche: true });
    for (const e of aw.drones || []) if (e.alive && Math.hypot(e.x - c.x, e.y - c.y) <= r && typeof combat.hitEnemy === 'function') combat.hitEnemy(game, e, C.segmente || 3, { flaeche: true, x: c.x, y: c.y, kind: 'ladung' });
  });
}

// ---------- Treffer (BODENKAMPF ruft bei jedem Treffer auf einen Spieler) ----------
function onTreffer(game, pid) {
  const p = game.players.find((q) => q.id === pid);
  if (!p || !p.hold || !istAnkerHold(p.hold.kind)) return;
  const h = p.hold;
  const aw = game.away; const k = aw && karteVon(aw.map);
  if (h.kind === 'anker:terminal' && h.op !== 'lesen') {
    p.hold = null;   // Fortschritt bleibt (update hat ihn mitgeschrieben)
    if (k && zustandIn(aw, k, h.anker) === 'laedt') setzen(game, aw.map, h.anker, 'bereit', pid);
    game.emit('downloadAbbruch', { anker: h.anker, map: aw && aw.map });
    if (game.notice) game.notice(p, 'Getroffen – Download unterbrochen. Der Fortschritt bleibt.');
  } else if (h.kind === 'anker:sprengpunkt') {
    p.hold = null;   // Ladung zurück: nichts verbraucht, Zustand bleibt intakt
    if (game.notice) game.notice(p, 'Getroffen – die Ladung ist nicht scharf.');
  }
}

// ---------- Alarm, Weitscan ----------
function alarm(game, map, an) {
  const aw = awVon(game, map); if (!aw) return 'Karte nicht geladen.';
  const neu = !!an;
  if (!!aw.alarm === neu) return null;
  aw.alarm = neu;
  game.emit('landepunktAlarm', { map, an: neu });
  game.missionEvent('landepunktAlarm', { map, an: neu });
  return null;
}
function markieren(game, map) {
  const aw = awVon(game, map); if (!aw || !karteVon(map)) return false;
  lauf(aw).markiert = true;
  return true;
}

// ---------- Snapshot (§9): ao/ko nur Abweichungen vom Start, al, cd ----------
function awaySnap(game, aw) {
  const k = aw && karteVon(aw.map); if (!k) return {};
  const L = lauf(aw);
  const ao = [];
  k.anker.forEach((a, i) => {
    const z = aw.zustaende[a.id];
    if (!z) return;
    const liste = (rollen()[a.rolle] || {}).zustaende || [];
    const zi = liste.indexOf(z);
    if (zi > 0) ao.push([i, zi]);
  });
  const ko = [];
  Object.keys(k.kanten || {}).sort().forEach((kid, i) => {
    const z = aw.zustaende[kid];
    if (!z || z === k.kanten[kid].zustand) return;
    const liste = ((Object.values(k.legende).find((q) => q.kind === k.kanten[kid].typ) || {}).zustaende) || [];
    const zi = liste.indexOf(z);
    if (zi >= 0) ko.push([i, zi]);
  });
  const o = { ao, ko, al: aw.alarm ? 1 : 0 };
  const ids = Object.keys(L.ladung).sort();
  if (ids.length) { const i = k.anker.findIndex((a) => a.id === ids[0]); o.cd = { i, t: Math.max(0, Math.round(L.ladung[ids[0]].t * 10) / 10) }; }
  return o;
}

module.exports = {
  istAnkerHold, interactionsAt, holdDuration, holdValid, holdStart, completeHold, update, onTreffer,
  setzen, zustand, alarm, markieren, awaySnap, kantenVonAnker, ladungScharf, paarFenster,
};
