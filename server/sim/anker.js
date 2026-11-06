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
//   abbauStarten(game, p, h)  abbauAbbrechen(game, map, id, pid?)  abbauFertig(game, p, h)  abbauMenge(game, map, anker)   GEL-03 A1: Rolle abbau (Erzader), s. u. „Abbau“
//   abbauNeu(game, map)  abbauWahlZustaende(karte, runde)   GEL-03 C: frische Adern je Mission (Runde hoch, Auswahl aus adernWahl, Karte unverändert), Startauswahl beim Laden
//   payloadAnker(k)  ankerListe(game, aw, k)  startFuer(a)   ITM-01 C: Ankerreihenfolge für awayMap und ao (verborgene Fallen fehlen im Payload, enthüllte hängen hinten an), Startzustand je Anker (Falle: sicht)
const W = require('../world.js');
const Physics = require('../../shared/physics.js');
const Buehne = require('../../shared/buehne.js');
const GenHoehle = require('../../shared/gen-hoehle.js');   // GEL-03 C: adernWahl, istAderKandidat
const Vorrat = require('./vorrat.js');   // TEL-01 G: Verbrauchsgüter nur über den Buchungsdienst

const TILE = Physics.TILE;
const TUER_ZEIT = Buehne.TUER_ZEIT;   // E (kurz halten): Tür/Luke/Schott/Tor im Zustand 'zu' öffnen (Quelle: shared/buehne.js)
const EXPLOSION = { radius: 2, segmente: 3 };   // Rückfall; maßgeblich ist CONFIG.anker.explosion

let rollenCache = null;
function rollen() {
  if (!rollenCache) { try { rollenCache = Buehne.daten().anker.rollen || {}; } catch (e) { rollenCache = {}; } }
  return rollenCache;
}
function startZustand(rolle) { const r = rollen()[rolle]; return r && r.zustaende && r.zustaende.length ? r.zustaende[0] : null; }
// Startzustand eines Ankers: erster Eintrag der Rolle; eine passive Falle (sicht passiv) startet als erkannt (der Client kennt sicht aus dem Payload)
function startFuer(a) { return a.rolle === 'falle' && a.sicht === 'passiv' ? 'erkannt' : startZustand(a.rolle); }
function fallenMod() { return require('./fallen.js'); }   // lazy: fallen.js lädt anker.js
// ITM-01 C: verdeckte Anker (verborgene Fallen) stehen nicht im awayMap-Payload. EINE Quelle der Wahrheit für die Reihenfolge, die Payload und Snapshot-Indizes
// (ao, sp, cd) teilen: payloadAnker(k) = Anker im Payload (Karte ohne Fallen: k.anker selbst), ankerListe = payloadAnker + später enthüllte (in Enthüllungsreihenfolge).
const verdeckt = (a) => a.rolle === 'falle' && a.sicht !== 'passiv';
const payloadCache = new WeakMap();   // Karte -> { quelle, n, liste }
function payloadAnker(k) {
  const alle = k.anker || [];
  let c = payloadCache.get(k);
  if (!c || c.quelle !== alle || c.n !== alle.length) { c = { quelle: alle, n: alle.length, liste: alle.some(verdeckt) ? alle.filter((a) => !verdeckt(a)) : alle }; payloadCache.set(k, c); }
  return c.liste;
}
function ankerListe(game, aw, k) {
  const p = payloadAnker(k);
  if (p === k.anker) return p;
  const ids = fallenMod().enthuellteIds(game, aw);
  return ids.length ? p.concat(ids.map((id) => ankerById(k, id)).filter(Boolean)) : p;
}
function kfg(game) { return (game.C && game.C.anker) || { halten: {}, countdown: 60, paarFenster: 1.5, paarSoloFenster: 15 }; }
function karteVon(map) { const e = W.AWAY_MAPS[map]; return e && e.karte && Array.isArray(e.karte.rows) ? e.karte : null; }
function awVon(game, map) { return (game.aways && game.aways[map]) || null; }
const abbauKarten = new WeakMap();   // Karte -> hat Adern (Kartenobjekt ist je Laufzeitkarte fest)
function hatAbbau(aw) {
  const k = karteVon(aw.map); if (!k) return false;
  let h = abbauKarten.get(k); if (h === undefined) { h = (k.anker || []).some((x) => x.rolle === 'abbau'); abbauKarten.set(k, h); }
  return h;
}
function lauf(aw) {
  if (!aw.ankerLauf) aw.ankerLauf = { download: {}, ladung: {}, raetsel: {} };
  if (!aw.ankerLauf.abbau && hatAbbau(aw)) aw.ankerLauf.abbau = {};   // GEL-03: nur Karten mit Erzadern tragen das Feld (aw-JSON anderer Karten bleibt byteweise wie vor GEL-03); graben/landepunkte legen ankerLauf ohne abbau an
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
  return a ? startFuer(a) : null;
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
  if (rolle === 'falle' && vorher !== z && !fallenMod().uebergangErlaubt(vorher, z)) return `Falle ${id}: ${vorher} -> ${z} ist kein gültiger Übergang.`;   // ITM-01 C: entschaerft und ausgeloest sind endgültig
  // ITM-01 G (H1): Ein Übergang einer Falle nach ausgeloest ist immer ein Auslösen (Wirkung, Missionsereignis falleAusgeloest, Entschärfer-Abbruch): auch über den Baustein anker_zustand
  // und das Debug `anker` läuft er über Fallen.ausloesen. Dessen eigener setzen-Aufruf trägt opts.ausloesen und setzt nur den Zustand.
  if (rolle === 'falle' && z === 'ausgeloest' && vorher !== z && !o.ausloesen) {
    const e = fallenMod().ausloesenVonAnker(game, aw, id, pid, o);
    if (e !== undefined) return e;
  }
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
  if (rolle === 'falle' && vorher !== z) safe(game, 'falle-zustand', () => fallenMod().beiZustand(game, aw, a, z));   // verborgene Falle wird sichtbar: Enthüllen merken (Nachsendung an die Clients)
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
// EK6 (Feldzeichen): lebende Spieler im Außenteam (nicht verwundet/bewusstlos/gefangen) – Hissen braucht mindestens flagge.min (2) davon
function flaggeCfg(game) { return (game.C && game.C.anker && game.C.anker.flagge) || { min: 2 }; }
function flaggeCrew(game) { return game.players.filter((p) => p.zone === 'away' && p.connected !== false && !p.downed); }
function flaggeZeit(game) { return Number((kfg(game).halten || {}).flagge) || 6; }

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
        if (z === 'intakt' && aw.ankerSperre && aw.ankerSperre[a.id]) block(aw.ankerSperre[a.id]);   // Szenario sperrt den Sprengpunkt (Grabenangriff: bis die Oberfläche besiegt ist)
        else if (z === 'intakt') { if ((inventar(game).ladung || 0) > 0) it(a.modus === 'platzieren' ? { modus: 'platzieren' } : undefined); else block(a.modus === 'platzieren' ? 'Kein Sprengstoff dabei.' : 'Keine Sprengladung dabei.'); }
        else if (z === 'scharf') block(`Scharf! Noch ${Math.ceil((L.ladung[a.id] && L.ladung[a.id].t) || 0)} s – weg da!`);
        else if (z === 'platziert') block('Der Sprengstoff liegt. Jetzt unauffällig zurück zum Teleportpunkt.');
        else block('Hier ist nichts mehr zu sprengen.');
        break;
      case 'flagge':
        if (z === 'unten') {
          if (flaggeCrew(game).length < flaggeCfg(game).min) block('Das Feldzeichen hissen zwei gemeinsam – allein geht es nicht.');
          else it({ op: 'hissen' });
        } else block('Das Feldzeichen steht.');
        break;
      case 'zelle': if (z === 'zu') it(); else block('Die Zelle steht offen.'); break;
      case 'beute': if (z === 'voll') it(); else block('Leer geräumt.'); break;
      case 'ziel': if (z !== 'frei') block('Erledigt.'); else if (aw.ankerSperre && aw.ankerSperre[a.id]) block(aw.ankerSperre[a.id]); else it(); break;   // ankerSperre: { ankerId: Text } zur Laufzeit (Finale-Boden: Schrein gesperrt bis der Wächter fällt)
      case 'fund': if (z === 'da') it(); else block('Der Sockel ist leer.'); break;
      case 'abbau':   // GEL-03 A1: leer bietet nichts an (kein Hinweis); abgebaut ist erschöpft; ein Halter je Ader
        if (z === 'da' || z === 'laeuft') { if (abbauHalterAnderer(game, p, a.id)) block('Dort wird schon abgebaut.'); else it({ op: 'abbauen' }); }
        else if (z === 'abgebaut') block('Die Ader ist erschöpft.');
        break;
      case 'falle': if (z === 'erkannt') it({ op: 'entschaerfen', map: aw.map }); break;   // verborgen, entschärft, ausgelöst: nichts anzubieten (verborgen verrät sich nicht durch einen Hinweis)
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
  if (rolle === 'sprengpunkt' && it && it.modus === 'platzieren') return H.platzieren || H.sprengpunkt || 4;   // EK5: Sprengstoff legen
  if (rolle === 'abbau') return Number(H.abbau) || 5;   // GEL-03 A1: Gesamtzeit, kein Fortschritt-Merken
  if (rolle === 'flagge') return flaggeZeit(game) + 0.2;   // EK6: gemeinsamer Fortschritt (update); die eigene Zeit des Halters erreicht das nie vor update
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
    case 'sprengpunkt': return z === 'intakt' && !(aw.ankerSperre && aw.ankerSperre[a.id]) && (inventar(game).ladung || 0) > 0;
    case 'flagge': return z === 'unten' && flaggeCrew(game).length >= flaggeCfg(game).min;   // lebt nur noch einer: Hissen nicht möglich
    case 'zelle': return z === 'zu';
    case 'beute': return z === 'voll';
    case 'ziel': return z === 'frei' && !(aw.ankerSperre && aw.ankerSperre[a.id]);
    case 'fund': return z === 'da';
    case 'abbau': return (z === 'da' || z === 'laeuft') && !p.downed && !abbauHalterAnderer(game, p, a.id);   // erster Halter gewinnt: der andere ist ungültig
    case 'falle': return z === 'erkannt' && h.map === aw.map && !p.downed;   // nur aus erkannt, nur auf der Karte, auf der das Halten begann; nach dem Auslösen ist Entschärfen unmöglich
    case 'raetsel': return z === 'ruhe';
    case 'versteck': return z !== 'offen';
    case 'eingang': return !!eingangOp(aw, k, a);
    default: return false;
  }
}
// Hold-Start (optional; sonst übernimmt update den Fortschritt): Terminal -> 'laedt'
function holdStart(game, p, h) {
  const aw = game.away; const k = aw && karteVon(aw.map);
  if (k && h.kind === 'anker:abbau') { abbauStarten(game, p, h); return; }
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
      Vorrat.verbrauchen(game, 'ladung', 1, 'sprengung');
      if (a.modus === 'platzieren') ladungPlatzieren(game, map, a.id, p.id);   // EK5: legen statt zünden
      else ladungScharf(game, map, a.id, null, p.id);
      return;
    }
    case 'flagge': return;   // wird in update() vollendet (gemeinsamer Fortschritt zweier Halter)
    case 'zelle': setzen(game, map, a.id, 'offen', p.id); return;
    case 'beute': setzen(game, map, a.id, 'leer', p.id); game.missionEvent('beuteGeborgen', { map, anker: a.id, pid: p.id }); return;
    case 'ziel': setzen(game, map, a.id, 'aktiviert', p.id); return;
    case 'fund': setzen(game, map, a.id, 'genommen', p.id); game.missionEvent('fundGeborgen', { map, anker: a.id, pid: p.id }); return;
    case 'abbau': abbauFertig(game, p, h); return;
    case 'falle':
      if (zustandIn(aw, k, a.id) !== 'erkannt') return;
      setzen(game, map, a.id, 'entschaerft', p.id);
      game.emit('sfx', { name: 'repair_done', zone: 'away', x: c.x, y: c.y });
      game.missionEvent('falleEntschaerft', { map, anker: a.id, typ: a.typ || null, pid: p.id });
      return;
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

// ---------- Abbau (GEL-03 A1, Rolle abbau: Erzader) ----------
// Zustände da -> laeuft -> abgebaut (leer: in dieser Runde kein Vorkommen). Wie das Terminal ein Halte-Anker (da <-> laeuft, update setzt laeuft ohne Halter zurück), aber der Abbruch
// ist der der Falle: Treffer/Loslassen lässt KEINEN Fortschritt zurück (CONFIG.anker.halten.abbau ist die Gesamtzeit). Genau ein Halter je Ader: ankerLauf.abbau[id] = { pid, t }
// (t = Lärmtakt in s). Ereignisse (Spiel- und Missionsereignis): abbauStart {map, anker, pid}, abbauFertig {map, anker, pid, menge, art}, abbauLaerm {map, anker, pid, x, y}
// beim Start und danach alle CONFIG.anker.abbauLaermTakt s, solange gehalten wird. Die Wirkung des Lärms (Schwarm) gehört MON-03, hier nur das Ereignis.
const abbauHaelt = (p, id) => !!(p && p.hold && p.hold.kind === 'anker:abbau' && p.hold.anker === id && p.zone === 'away' && p.connected !== false);
// Hält ein ANDERER Spieler diese Ader? Maßgeblich ist der Halter-Eintrag (nicht die Spielerreihenfolge): erster Halter gewinnt, ein Eintrag ohne lebendes Halten ist verwaist.
function abbauHalterAnderer(game, p, id) {
  const aw = game.away; const b = aw && aw.ankerLauf && aw.ankerLauf.abbau && aw.ankerLauf.abbau[id];
  if (!b || b.pid === p.id) return false;
  return abbauHaelt(game.players.find((q) => q.id === b.pid), id);
}
// GEL-03 B: Menge je Abbau, 1 bis 3, deterministisch aus (abbau_runde des Landepunkts, Anker-ID) per FNV (kein Zufall, kein Spielzustand): dieselbe Ader gibt in derselben Runde immer
// dieselbe Menge, in einer späteren Runde (abbauNeu) darf sie anders ausfallen. Art: Attribut art der Ader, Standard und einzige Art heute erz. Rückgabe { menge, art }.
const ABBAU_ARTEN = ['erz'];
function abbauRunde(game, map) {
  try { const e = require('./landepunkte.js').eintrag(game, map); return (e && e.abbau_runde | 0) || 0; } catch (x) { return 0; }
}
function abbauMenge(game, map, a) {
  const art = a && ABBAU_ARTEN.includes(a.art) ? a.art : 'erz';
  const h = Buehne.fnv(`abbau:${abbauRunde(game, map)}:${a ? a.id : ''}`) >>> 0;
  return { menge: 1 + ((h >>> 8) % 3), art };
}
function abbauLaerm(game, map, a, pid) {
  const c = mitte(a);
  const d = { map, anker: a.id, pid, x: c.x, y: c.y };
  game.emit('abbauLaerm', d); game.missionEvent('abbauLaerm', d);
}
// Halten beginnt (aus holdStart): übernimmt die Ader, setzt laeuft, meldet abbauStart und den ersten Lärm. Hält schon ein anderer: Hold verwerfen (gleicher Tick).
function abbauStarten(game, p, h) {
  const aw = game.away; const k = aw && karteVon(aw.map); if (!k) return;
  const a = ankerById(k, h.anker); if (!a || a.rolle !== 'abbau') return;
  const z = zustandIn(aw, k, a.id);
  if (z !== 'da' && z !== 'laeuft') { p.hold = null; return; }
  if (abbauHalterAnderer(game, p, a.id)) { p.hold = null; if (game.notice) game.notice(p, 'Dort wird schon abgebaut.'); return; }
  const L = lauf(aw);
  const neu = !L.abbau[a.id] || L.abbau[a.id].pid !== p.id;
  L.abbau[a.id] = { pid: p.id, t: 0 };
  if (z === 'da') setzen(game, aw.map, a.id, 'laeuft', p.id);
  if (neu) {
    game.emit('abbauStart', { map: aw.map, anker: a.id, pid: p.id }); game.missionEvent('abbauStart', { map: aw.map, anker: a.id, pid: p.id });
    abbauLaerm(game, aw.map, a, p.id);
  }
}
// Halten endet ohne Ergebnis (Treffer, Loslassen, Verlassen): Halter-Eintrag weg, laeuft -> da. Kein Fortschritt. pid nur für den Zustandswechsel (Ereignis).
function abbauAbbrechen(game, map, id, pid) {
  const aw = awVon(game, map); const k = karteVon(map); if (!aw || !k) return;
  const a = ankerById(k, id); if (!a || a.rolle !== 'abbau') return;
  delete lauf(aw).abbau[id];
  if (zustandIn(aw, k, id) === 'laeuft') setzen(game, map, id, 'da', pid || null);
}
// Halten vollendet: nur aus da/laeuft und nur durch den Halter (erster gewinnt); setzt abgebaut, meldet abbauFertig mit Menge und Art.
function abbauFertig(game, p, h) {
  const aw = game.away; const k = aw && karteVon(aw.map); if (!k) return;
  const a = ankerById(k, h.anker); if (!a || a.rolle !== 'abbau') return;
  const z = zustandIn(aw, k, a.id);
  if (z !== 'da' && z !== 'laeuft') return;
  if (abbauHalterAnderer(game, p, a.id)) return;
  const L = lauf(aw);
  delete L.abbau[a.id];
  setzen(game, aw.map, a.id, 'abgebaut', p.id);
  const m = abbauMenge(game, aw.map, a);
  Vorrat.einlagern(game, m.art, m.menge, 'abbau');   // GEL-03 B: Ablage im Schiffslager (Buchungsdienst, Grund abbau); nicht Fracht
  const d = { map: aw.map, anker: a.id, pid: p.id, menge: m.menge, art: m.art };
  game.emit('abbauFertig', d); game.missionEvent('abbauFertig', d);
  const c = mitte(a);
  game.emit('sfx', { name: 'repair_done', zone: 'away', x: c.x, y: c.y });
}
// GEL-03 C: Neusetzen je Mission. Die Ader-Kandidaten (Anker hoehle.abbau*, shared/gen-hoehle.js) stehen in jeder Runde in der Karte; welche davon ein Vorkommen tragen (da) und welche leer sind,
// entscheidet adernWahl(Karte-Seed, Kandidaten, abbau_runde) – rein aus Seed und Runde, nie in die Karte geschrieben (JSON der Karte bleibt byteweise gleich), nur in die Zustände.
// Runde 0 (abbau_runde fehlt/0) wirkt beim Laden der Karte (landepunkte.makeAway, abbauWahlZustaende) für alle Kandidaten OHNE gespeicherten Zustand: ohne Aufruf von abbauNeu gibt es also schon
// in der ersten Mission nur 2 bis 3 aktive Adern, und gespeicherte Zustände (abgebaut, leer, da) gehen beim Laden nie verloren. Handgesetzte abbau-Anker (Tests, Regiebuch) sind keine Kandidaten.
const aderKandidaten = (k) => (k && k.anker ? k.anker.filter((a) => GenHoehle.istAderKandidat(a)) : []);
// { id: 'da' | 'leer' } für die Kandidaten einer Karte in dieser Runde
function abbauWahlZustaende(k, runde) {
  const kand = aderKandidaten(k); const out = {};
  if (!kand.length) return out;
  const w = GenHoehle.adernWahl(k.seed | 0, kand.map((a) => a.id), runde | 0);
  for (const id of w.da) out[id] = 'da';
  for (const id of w.leer) out[id] = 'leer';
  return out;
}
// GEL-03 Nacharbeit W1: Überlappt eine Figur (Spieler dieser Karte, lebende Drohne, lebende Kreatur) die Kachel (tx, ty)? Dieselbe Box-Prüfung wie die Bewegung (Physics.boxHits).
const DROHNEN_BOX = { w: 14, h: 10 };   // wie away.js DRONE_HITBOX / squad.js HITBOX
function figurAufKachel(game, aw, tx, ty) {
  const hier = (a, b) => a === tx && b === ty;
  if (game.away === aw) {
    const hb = (game.C && game.C.player && game.C.player.hitbox) || { w: 18, h: 12 };
    for (const p of game.players || []) if (p.zone === 'away' && Physics.boxHits(hier, p.x, p.y, hb.w, hb.h)) return true;
  }
  for (const d of aw.drones || []) if (d.alive !== false && Physics.boxHits(hier, d.x, d.y, DROHNEN_BOX.w, DROHNEN_BOX.h)) return true;
  const Kr = aw.kreaturen && aw.kreaturen.length ? require('./kreatur.js') : null;
  if (Kr) for (const K of aw.kreaturen) if (K.alive !== false) { const bx = Kr.koerperBox(K); if (Physics.boxHits(hier, K.x, K.y, bx, bx)) return true; }
  return false;
}
// GEL-03 Nacharbeit W1: ein Wechsel leer -> da wird zurückgestellt, solange eine Figur auf der Kachel steht (sonst wäre sie eingemauert: leer ist begehbar, da ist fest). Vormerkung in
// ankerLauf.abbauVormerk { id: true }; update() setzt da, sobald die Kachel frei ist (deterministisch, Spielzeit). Gespeichert wird eine vorgemerkte Ader ohne Zustand (landepunkte.sichern),
// beim Laden gilt die Auswahl der Runde. Gewählt gegenüber „Kachel erst fest, wenn keine Figur überlappt“: die Kollisionsregel bleibt eine reine Funktion des Zustands (Server, Client-Vorhersage,
// Snapshot ao stimmen überein), und es gibt keine Figurenabfrage in der Kollisionsabfrage (die läuft je Kachel und Figur).
function vormerkung(aw) { const L = lauf(aw); return L.abbauVormerk || (L.abbauVormerk = {}); }
function abbauVormerkTick(game, aw, k) {
  const vm = aw.ankerLauf && aw.ankerLauf.abbauVormerk; if (!vm) return;
  for (const id of Object.keys(vm).sort()) {
    const a = ankerById(k, id);
    if (!a || zustandIn(aw, k, id) !== 'leer') { delete vm[id]; continue; }   // inzwischen anders gesetzt (Baustein, Debug): nichts mehr zu tun
    if (figurAufKachel(game, aw, a.x, a.y)) continue;
    delete vm[id];
    setzen(game, aw.map, id, 'da', null, { merken: true });
  }
}
// abbauNeu(game, map) -> Fehlertext | null: abbau_runde + 1 (höchstens ABBAU_RUNDE_MAX), alle Kandidaten bekommen den Zustand der neuen Runde (vorher abgebaut/leer/laeuft wird überschrieben), laufende Halter
// DIESER Karte werden abgebrochen (Hold weg, Halter-Eintrag weg), der Weltstand-Eintrag merkt alles (Zustände + Runde). Ereignis abbauNeu {map, runde, adern:[ids da]} (Spiel und Mission).
// Geladene Karte: Zustände in aw.zustaende (setzen, mit merken); ein Wechsel leer -> da unter einer Figur wartet (W1). Nicht geladene Karte (K2): KEIN Kartenbau (58 bis 300 ms im Tick), nur
// abbau_runde im Eintrag hoch und die gespeicherten Zustände der Kandidaten verwerfen: makeAway leitet sie beim Laden aus Karte-Seed und neuer Runde ab. Das Ereignis trägt dort adern: []
// (die Kandidaten sind ohne Karte nicht bekannt); ist die Karte registriert (W.AWAY_MAPS, z. B. Ader-Prüfung durch einen anderen Aufrufer), wird adern aus adernWahl berechnet.
function abbauNeu(game, map) {
  const LP = require('./landepunkte.js');
  const e = LP.eintrag(game, map);
  if (!e) return `Karte ${map} ist kein Landepunkt.`;
  const k = karteVon(map);
  const aw = awVon(game, map);
  if (!k && !LP.hatAdern(game, map)) return `Karte ${map} hat keine Erzadern.`;
  const kand = k ? aderKandidaten(k) : null;
  if (k && !kand.length) return `Karte ${map} hat keine Erzadern.`;
  const runde = Math.min(LP.ABBAU_RUNDE_MAX, ((e.abbau_runde | 0) || 0) + 1);   // an der Obergrenze bleibt sie stehen
  e.abbau_runde = runde;
  e.zustaende = e.zustaende || {};
  if (!k) {   // nicht gebaut/geladen: Zustände der Kandidaten verfallen, beim Laden gilt die neue Runde
    for (const id of Object.keys(e.zustaende)) if (GenHoehle.istAderKandidat({ rolle: 'abbau', id })) delete e.zustaende[id];
    game.emit('abbauNeu', { map, runde, adern: [] }); game.missionEvent('abbauNeu', { map, runde, adern: [] });
    return null;
  }
  const neu = abbauWahlZustaende(k, runde);
  if (aw) {
    // K4: nur Halter DIESER Karte abbrechen (ein Halt auf einer anderen Karte bleibt)
    if (game.away && game.away.map === map) for (const p of game.players || []) if (p.hold && p.hold.kind === 'anker:abbau' && neu[p.hold.anker] !== undefined) p.hold = null;
    for (const a of kand) { if (lauf(aw).abbau[a.id]) abbauAbbrechen(game, map, a.id, null); }
    const vm = vormerkung(aw); for (const a of kand) delete vm[a.id];
  }
  for (const a of kand) {
    if (aw && neu[a.id] === 'da' && zustandIn(aw, k, a.id) === 'leer' && figurAufKachel(game, aw, a.x, a.y)) {   // W1: wartet, bis die Kachel frei ist
      vormerkung(aw)[a.id] = true; delete e.zustaende[a.id]; continue;
    }
    e.zustaende[a.id] = neu[a.id];
    if (aw) setzen(game, map, a.id, neu[a.id], null, { merken: true });
  }
  const adern = kand.map((a) => a.id).filter((id) => neu[id] === 'da');
  game.emit('abbauNeu', { map, runde, adern }); game.missionEvent('abbauNeu', { map, runde, adern });
  return null;
}

// Tick: ohne lebenden Halter fällt laeuft auf da zurück (Loslassen, Bewegung, Kartenwechsel, Trennung); mit Halter läuft der Lärmtakt über dt (deterministisch, Spielzeit).
function abbauTick(game, aw, k, L, dt) {
  const takt = Number(kfg(game).abbauLaermTakt) || 2;
  for (const a of k.anker) {
    if (a.rolle !== 'abbau') continue;
    const b = L.abbau[a.id];
    const z = zustandIn(aw, k, a.id);
    const halter = b ? game.players.find((q) => q.id === b.pid) : null;
    if (!b || !abbauHaelt(halter, a.id) || (z !== 'laeuft' && z !== 'da')) {
      if (b || z === 'laeuft') abbauAbbrechen(game, aw.map, a.id, null);
      continue;
    }
    b.t += dt;
    if (b.t >= takt - 1e-9) { b.t -= takt; abbauLaerm(game, aw.map, a, b.pid); }
  }
}

// GEL-03 G: Scanner-Anmeldung, Art `erz`: die Adern der Außenkarte im Zustand da oder laeuft (leer und abgebaut fehlen, sie fallen beim Scan-Aufräumen aus aw.sc). Position schon ab Stufe 1.
// ziele() billig: die Aderliste je Karte wird gemerkt (Anker einer gebauten Karte ändern sich nicht), je Aufruf nur die Zustandsabfrage.
const aderCache = new WeakMap();   // Karte -> { quelle, n, liste }
function aderListe(k) {
  const alle = k.anker || [];
  let c = aderCache.get(k);
  if (!c || c.quelle !== alle || c.n !== alle.length) { c = { quelle: alle, n: alle.length, liste: alle.filter((a) => a.rolle === 'abbau') }; aderCache.set(k, c); }
  return c.liste;
}
function erzZiele(game, aw) {
  const k = aw && karteVon(aw.map); if (!k) return [];
  const out = [];
  for (const a of aderListe(k)) { const z = zustandIn(aw, k, a.id); if (z === 'da' || z === 'laeuft') { const m = mitte(a); out.push({ id: a.id, x: m.x, y: m.y, typ: 'erzader' }); } }
  return out;
}
require('./scanbar.js').scanbarAnmelden('erz', { ziele: erzZiele, tiefen: { position: 1 } });

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
  if (aw.ankerSperre && aw.ankerSperre[id]) return aw.ankerSperre[id];   // vom Szenario gesperrt (ankerSperre), auch für Debug und Bausteine
  const sek = Number.isFinite(t) && t > 0 ? t : (kfg(game).countdown || 60);
  lauf(aw).ladung[id] = { t: sek };
  setzen(game, map, id, 'scharf', pid || null);
  game.emit('ladungScharf', { anker: id, t: sek, map });
  game.missionEvent('ladungScharf', { map, anker: id, pid: pid || null, t: sek });
  return null;
}

// EK5 (Methalle): Sprengstoff am Anker platzieren – keine Explosion, kein Countdown, kein Alarm, keine Wirkung vor Ort.
// ladungPlatzieren(game, map, id, pid?) -> Fehlertext | null. Verbraucht kein Inventar (das macht completeHold). Der Zustand 'platziert'
// bleibt; die Folge (Meldung nach dem Hochbeamen, Weltstand-Fakt sperrriegel, zweite Welle) hängt am Regiebuch, nicht hier.
function ladungPlatzieren(game, map, id, pid) {
  const k = karteVon(map);
  if (!k) return `Karte ${map} ist keine gebaute Karte.`;
  const aw = awVon(game, map);
  if (!aw) return `Karte ${map} ist nicht geladen.`;
  const a = ankerById(k, id);
  if (!a || a.rolle !== 'sprengpunkt') return `${id} ist kein Sprengpunkt auf ${map}.`;
  if (zustandIn(aw, k, id) !== 'intakt') return `${id} ist nicht intakt (${zustandIn(aw, k, id)}).`;
  if (aw.ankerSperre && aw.ankerSperre[id]) return aw.ankerSperre[id];   // vom Szenario gesperrt (ankerSperre), auch für Debug und Bausteine
  setzen(game, map, id, 'platziert', pid || null);
  const c = mitte(a);
  game.emit('ladungPlatziert', { anker: id, map });
  game.emit('sfx', { name: 'repair_done', zone: 'away', x: c.x, y: c.y });
  game.missionEvent('ladungPlatziert', { map, anker: id, pid: pid || null });
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
  abbauTick(game, aw, k, L, dt);
  abbauVormerkTick(game, aw, k);
  // Feldzeichen (EK6): Fortschritt läuft nur, solange mindestens flagge.min lebende Spieler gleichzeitig halten; er bleibt, wenn einer loslässt
  for (const a of k.anker) {
    if (a.rolle !== 'flagge' || zustandIn(aw, k, a.id) !== 'unten') continue;
    const F = L.flagge || (L.flagge = {});
    const f = F[a.id] || (F[a.id] = { t: 0 });
    const T = flaggeZeit(game);
    const halter = game.players.filter((p) => p.zone === 'away' && !p.downed && p.hold && p.hold.kind === 'anker:flagge' && p.hold.anker === a.id);
    if (halter.length >= flaggeCfg(game).min && flaggeCrew(game).length >= flaggeCfg(game).min) f.t = Math.min(T, f.t + dt);
    for (const p of halter) { p.hold.t = Math.min(f.t, T); p.hold.dur = T + 0.2; }   // Fortschrittsbalken der Halter = gemeinsamer Fortschritt
    if (f.t >= T - 1e-9) {
      delete F[a.id];
      for (const p of halter) p.hold = null;
      setzen(game, aw.map, a.id, 'gehisst', halter[0] ? halter[0].id : null);
      const c = mitte(a);
      game.emit('flaggeGehisst', { anker: a.id, map: aw.map });
      game.emit('sfx', { name: 'repair_done', zone: 'away', x: c.x, y: c.y });
      game.missionEvent('flaggeGehisst', { map: aw.map, anker: a.id, pids: halter.map((p) => p.id) });
    }
  }
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
  } else if (h.kind === 'anker:flagge') {
    p.hold = null;   // der Fortschritt bleibt (gemeinsamer Zähler in ankerLauf.flagge)
    if (game.notice) game.notice(p, 'Getroffen – das Hissen ist unterbrochen. Der Fortschritt bleibt.');
  } else if (h.kind === 'anker:sprengpunkt') {
    p.hold = null;   // Ladung zurück: nichts verbraucht, Zustand bleibt intakt
    const platz = k && (ankerById(k, h.anker) || {}).modus === 'platzieren';
    if (game.notice) game.notice(p, platz ? 'Getroffen – der Sprengstoff liegt noch nicht.' : 'Getroffen – die Ladung ist nicht scharf.');
  } else if (h.kind === 'anker:abbau') {
    p.hold = null;   // wie die Falle: kein Fortschritt gemerkt, Abbau von vorn; der andere Spieler kann sofort übernehmen
    abbauAbbrechen(game, aw && aw.map, h.anker, pid);
    if (game.notice) game.notice(p, 'Getroffen – der Abbau ist unterbrochen.');
  } else if (h.kind === 'anker:falle') {
    p.hold = null;   // Entschärfen von vorn (kein Fortschritt gemerkt); der Zustand bleibt erkannt
    if (game.notice) game.notice(p, 'Getroffen – das Entschärfen ist unterbrochen.');
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
  const al = ankerListe(game, aw, k);   // ITM-01 C: dieselbe Reihenfolge wie im awayMap-Payload (+ enthüllte Fallen am Ende)
  al.forEach((a, i) => {
    const z = aw.zustaende[a.id];
    if (!z) return;
    const liste = (rollen()[a.rolle] || {}).zustaende || [];
    const zi = liste.indexOf(z);
    if (zi >= 0 && z !== startFuer(a)) ao.push([i, zi]);   // nur Abweichungen vom Start (Falle: Start je sicht)
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
  const sp = aw.ankerSperre ? al.map((a, i) => (aw.ankerSperre[a.id] ? i : -1)).filter((i) => i >= 0) : [];
  // GEL-03 N2: Halter der laufenden Ader, [Index im ankerListe-Schema, Spieler-ID]; nur solange abgebaut wird (der Client zeigt „Dort wird schon abgebaut“ nur an der besetzten Ader)
  const ab = [];
  al.forEach((a, i) => { if (a.rolle !== 'abbau') return; const b = L.abbau[a.id]; if (b && aw.zustaende[a.id] === 'laeuft') ab.push([i, b.pid]); });
  if (ab.length) o.ab = ab;
  if (aw.ohneZaehler) o.oz = 1;   // Welle 5, M3: Boden des Finales ohne Erkunden-/Plünder-Zähler (finale-boden.js)
  if (sp.length) o.sp = sp;   // SUND-04a-3: gesperrte Anker (Index), der Client zeigt „Versiegelt“ statt des Haltehinweises
  const ids = Object.keys(L.ladung).sort();
  if (ids.length) { const i = al.findIndex((a) => a.id === ids[0]); o.cd = { i, t: Math.max(0, Math.round(L.ladung[ids[0]].t * 10) / 10) }; }
  return o;
}

module.exports = {
  istAnkerHold, interactionsAt, holdDuration, holdValid, holdStart, completeHold, update, onTreffer,
  setzen, zustand, alarm, markieren, awaySnap, kantenVonAnker, ladungScharf, ladungPlatzieren, paarFenster,
  payloadAnker, ankerListe, startFuer, abbauStarten, abbauAbbrechen, abbauFertig, abbauMenge, abbauNeu, abbauWahlZustaende,
};
