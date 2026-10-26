'use strict';
// Wirtschaft: Hafenterminal (Shop, Kontext Hafen/Vaelen), Deko und Stile im Quartier (§6, M1 §7, §9.2).
const W = require('../world.js');
const Locations = require('../../shared/locations.js');
const Sektoren = require('../../shared/sektoren.js');
const Besitz = require('./besitz.js');   // SUND-02b A1: kein Handel am Stützpunkt der Crew
const Preise = require('./preise.js');   // SUND-03b P: Preisfaktor der Verbrauchsgüter (nur mit Weltsim); Terminal und Kauf rechnen mit derselben Funktion

// Sortiment-Kontext: die Orts-ID (hafen, vaelen) – oder, wenn der Ort es vorgibt (`shop`, EK7: Häfen aus Daten wie
// Castra Martis und Statio Limitis), dieser Kontext. Häfen ohne Ruf: es gilt nur der Kontext, keine Haltung.
function shopContext(game) {
  if (!game.ship.docked) return require('./werft.js').testumgebung(game) ? 'hafen' : null;   // Testumgebung: Handel auch abgedockt (Torpedos für den Test)
  const loc = Locations.get(game.ship.dockedAt);
  return (loc && loc.shop) || game.ship.dockedAt;
}

function entryAvailable(entry, ctx) { return !entry.where || entry.where.includes(ctx); }
function priceFor(entry, ctx) { return ctx === 'vaelen' && entry.priceVaelen != null ? entry.priceVaelen : entry.price; }

// SUND-02b A1: Stützpunkt der Crew: Werft ja, Handel nein (Text oder null); auch das Terminal (Preisfelder im Snapshot) fragt hier
function sperreFuer(game) { return game.ship.docked ? Besitz.handelSperre(game, Sektoren.hexVonOrt(game.ship.dockedAt)) : null; }

function buy(game, p, itemId) {
  const C = game.C;
  const ctx = shopContext(game);
  if (!ctx) return 'Das Hafenterminal funktioniert nur angedockt.';
  const sperre = sperreFuer(game);
  if (sperre) return sperre;
  const entry = C.shop.find((s) => s.id === itemId);
  if (!entry) return 'Unbekannter Artikel.';
  if (!entryAvailable(entry, ctx)) return ctx === 'vaelen' ? 'Das führt die Karawane nicht – gibt es im Hafen.' : 'Das gibt es nur bei der Vaelen-Karawane.';
  if (entry.kind === 'upgrade' && game.upgrades[entry.id]) return 'Schon eingebaut.';
  if (entry.kind === 'gear' && p.gear[entry.id]) return 'Hast du schon.';
  if (entry.kind === 'item' && entry.limit != null && (game.inventory[entry.id] || 0) >= entry.limit) return `Lager voll (höchstens ${entry.limit} ${entry.name}).`;   // PAN-01 C: hartes Lagerlimit (Torpedos)
  const price = Preise.preisFuer(game, entry, ctx);   // ohne Weltsim und für alles außer Verbrauchsgütern = priceFor(entry, ctx)
  if (game.inventory.marks < price) return 'Nicht genug Marken.';
  game.inventory.marks -= price;
  if (entry.kind === 'upgrade') {
    game.upgrades[entry.id] = true;
  } else if (entry.kind === 'gear') p.gear[entry.id] = true;
  else if (entry.kind === 'item') game.inventory[entry.id] = (game.inventory[entry.id] || 0) + 1;
  else if (entry.kind === 'deko') game.inventory.deko.push(entry.id);
  game.emit('sfx', { name: ctx === 'vaelen' ? 'trade' : 'buy' });
  // S2 (CONTRACT-S2 §6): Ereignis bought { item, n, marks } für `handeln`; Käufe je Mission für die Prüfung `purchased`
  const m = game.mission;
  game.purchases = game.purchases || [];
  game.purchases.push({ item: entry.id, n: 1, marks: price, ctx, mission: (m && m.activeId) || null, t: game.time });
  if (game.purchases.length > 100) game.purchases.splice(0, game.purchases.length - 100);
  game.missionEvent('bought', { item: entry.id, n: 1, marks: price, ctx });
  return null;
}

function ownBed(p) { return W.Maps.BEDS.find((b) => b.color === p.color); }

function placeDeco(game, p, slot, item) {
  const bed = ownBed(p);
  if (!bed || !bed.slots.some((s) => s.id === slot)) return 'Das ist nicht dein Deko-Platz.';
  const cur = game.deco[slot];
  if (item == null) {
    if (!cur) return 'Der Platz ist schon leer.';
    game.deco[slot] = null; game.inventory.deko.push(cur);
    return null;
  }
  const idx = game.inventory.deko.indexOf(item);
  if (idx < 0) return 'Diese Deko liegt nicht im Inventar.';
  game.inventory.deko.splice(idx, 1);
  if (cur) game.inventory.deko.push(cur);
  game.deco[slot] = item;
  game.emit('sfx', { name: 'drop' });
  game.missionEvent('decoPlaced', { item });
  return null;
}

function setStyle(game, p, part, value) {
  const Q = game.C.quarters;
  const bed = ownBed(p);
  if (!bed) return 'Du hast kein Quartier.';
  const allowed = { floor: Q.floors, wall: Q.walls, light: Q.lights }[part];
  if (!allowed) return 'Unbekannter Teil (floor, wall, light).';
  if (!allowed.includes(value)) return 'Diesen Stil gibt es nicht.';
  game.quarters[bed.room.id][part] = value;
  game.emit('sfx', { name: 'ui_click' });
  game.missionEvent('decoPlaced', { style: part });
  return null;
}

module.exports = { buy, placeDeco, setStyle, shopContext, priceFor, entryAvailable, sperreFuer };
