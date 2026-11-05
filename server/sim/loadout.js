'use strict';
// AUS-01 A: Loadout-Slots je Spieler statt einer einzelnen Waffenwahl.
// Gespeichert: Hash der Browser-Kennung (waffen.hashKennung) -> Array bis zu SLOTS_MAX Einträge (Id oder null). Wirksam sind die
// ersten N Slots (N = game.slotzahl, in startGame() einmal festgesetzt); gespeichert wird nie abgeschnitten.
// crew.waffen (game.crewWaffen) bleibt als abgeleiteter Spiegel der ersten Waffe erhalten (ältere Spielversionen, Migration), nie Quelle der Wahrheit.
const Waffen = require('./waffen.js');

const SLOTS_MAX = 3;
const SLOTS_BIS_2_SPIELER = 3;
const SLOTS_AB_3_SPIELER = 2;
// Standardloadout: Wirksamer Stand eines Spielers OHNE gespeichertes Loadout (Blaster in Slot 1, Medipack in Slot 2). Gespeichert wird er erst, wenn jemand etwas ändert.
// ITM-01 A: Blaster + Medipack (wie früher: jeder hatte ein Medipack); der dritte Slot ist leer.
const standardLoadout = () => ['blaster', 'medipack', ...Array(SLOTS_MAX - 2).fill(null)];
const OHNE_WAFFE = 'faust';   // Loadout gespeichert, aber keine Waffe in den wirksamen Slots

// Die EINE Stelle, die entscheidet, was in einen Slot darf. Spätere Aufträge (Medipack, Scanner) ergänzen hier ihre Ids.
// AUS-02 A: Items (Nicht-Waffen) kommen über die Registry ITEMS in einen Slot: Id -> Handler(game, p) -> null | Fehlertext. Heute leer (keine Items).
// Nicht exportiert und ohne Prototyp (Ids wie 'constructor' sind keine Items); eingetragen wird nur über itemRegistrieren.
const ITEMS = Object.create(null);
const erlaubteIds = () => [...Waffen.WAHL, ...Object.keys(ITEMS)];
const istErlaubt = (id) => typeof id === 'string' && erlaubteIds().includes(id);
const istWaffe = (id) => typeof id === 'string' && Waffen.WAHL.includes(id);

const hashVon = (p) => (p && p.clientId != null ? Waffen.hashKennung(p.clientId) : null);
function speicher(game) { if (!game.crewLoadout || typeof game.crewLoadout !== 'object') game.crewLoadout = {}; return game.crewLoadout; }
function spiegelAlt(game) { if (!game.crewWaffen || typeof game.crewWaffen !== 'object') game.crewWaffen = {}; return game.crewWaffen; }

// Slotzahl: 3 bei 1 oder 2 verbundenen Spielern, 2 ab 3. Einmal in startGame() festsetzen, danach fest.
function slotzahlFestsetzen(game) {
  const verbunden = (game.players || []).filter((p) => p.connected).length;
  game.slotzahl = verbunden >= 3 ? SLOTS_AB_3_SPIELER : SLOTS_BIS_2_SPIELER;
  return game.slotzahl;
}
function slotzahl(game) { const n = game && game.slotzahl; return Number.isInteger(n) && n >= 1 && n <= SLOTS_MAX ? n : SLOTS_BIS_2_SPIELER; }

// Gespeicherte Slots (immer SLOTS_MAX Einträge, Id oder null) oder null, wenn der Spieler kein Loadout hat. Altstand: crew.waffen = Slot 1.
function gespeichert(game, h) {
  if (!h) return null;
  const e = speicher(game)[h];
  if (Array.isArray(e)) return Array.from({ length: SLOTS_MAX }, (_, i) => (istErlaubt(e[i]) ? e[i] : null));
  const alt = spiegelAlt(game)[h];
  if (istWaffe(alt)) return [alt, null, null];
  return null;
}
function loadoutFuer(game, p) { return gespeichert(game, hashVon(p)) || standardLoadout(); }
function wirksam(game, p) { return loadoutFuer(game, p).slice(0, slotzahl(game)); }

// Aktive Waffe = erste Waffe unter den wirksamen Slots (ohne gespeichertes Loadout: Standardloadout = Blaster); keine Waffe belegt = Faust.
function aktiveWaffe(game, p) {
  return wirksam(game, p).find(istWaffe) || OHNE_WAFFE;
}

function spiegeln(game, h) {
  const e = gespeichert(game, h);
  const alt = spiegelAlt(game);
  const w = e ? e.slice(0, slotzahl(game)).find(istWaffe) : null;
  if (w) alt[h] = w; else delete alt[h];
}

// Befehl ausruestung.slot: Slot 0..slotzahl-1 auf Id oder leer (null). Rückgabe: Fehlertext oder null.
function slotSetzen(game, p, slot, id) {
  const h = hashVon(p);
  if (!h) return 'Ohne Kennung kein Loadout.';
  if (!Number.isInteger(slot) || slot < 0 || slot >= slotzahl(game)) return 'Diesen Slot gibt es in dieser Partie nicht.';
  const neu = id == null || id === '' ? null : id;
  if (neu !== null && !istErlaubt(neu)) return 'Unbekannte Waffe.';
  const e = gespeichert(game, h) || standardLoadout();
  const zahl = slotzahl(game);
  if (neu !== null && e.some((x, i) => i < zahl && i !== slot && x === neu)) return 'Diese Waffe steckt schon in einem anderen Slot.';
  // Steckt die Waffe in einem in dieser Partie nicht wirksamen Slot, wandert sie hierher: der versteckte Eintrag wird geleert (nie doppelt gespeichert).
  if (neu !== null) for (let i = zahl; i < SLOTS_MAX; i++) if (e[i] === neu) e[i] = null;
  const vorher = aktiveWaffe(game, p);
  e[slot] = neu;
  speicher(game)[h] = e;
  spiegeln(game, h);
  const jetzt = aktiveWaffe(game, p);
  if (jetzt !== vorher || p.waffe !== jetzt) Waffen.waffeAnlegen(game, p, jetzt);
  return null;
}

// AUS-01 B: Stand der Station an genau diesen Spieler: Slotzahl der Partie und die wirksamen Slots (der versteckte dritte Slot wird nicht gesendet).
// fehler = Text eines abgelehnten Befehls (die Station zeigt ihn an). Kein Snapshot-Feld, nur an Spieler, die die Station benutzen.
function standSenden(game, p, fehler) {
  if (!game || typeof game.sendTo !== 'function' || !p || !p.conn) return;
  const o = { t: 'event', kind: 'ausruestungStand', pid: p.id, slotzahl: slotzahl(game), slots: wirksam(game, p) };
  if (fehler) o.fehler = String(fehler);
  game.sendTo(p.conn, o);
}

// AUS-02 A: Slot am Boden benutzen (Befehl slot.nutzen). Waffe im Slot -> wird aktiv (waffen.waffeWechseln); Item im Slot -> itemNutzen (ändert die aktive Waffe nicht).
// Abgelehnt (Rückgabe Text, kein Effekt): Slot außerhalb der wirksamen Slots, leerer Slot, nicht am Boden, nicht handlungsfähig (ausgeschaltet, gefangen, bewusstlos, betäubt, an einer Konsole).
// Item-Id mit Handler(game, p) -> null | Fehlertext anmelden (SCA-01/ITM-01, Tests). Danach ist die Id in einen Slot erlaubt (erlaubteIds/istErlaubt). Liefert eine Funktion, die den Eintrag wieder entfernt.
// Waffen-Ids und doppelte Ids werden abgelehnt (Ausnahme), damit kein Auftrag einen anderen überschreibt.
function itemRegistrieren(id, handler) {
  if (typeof id !== 'string' || !id || Waffen.WAHL.includes(id) || id === OHNE_WAFFE || id in ITEMS) throw new Error('itemRegistrieren: Id ungültig oder schon vergeben: ' + id);
  if (typeof handler !== 'function') throw new Error('itemRegistrieren: Handler fehlt für ' + id);
  ITEMS[id] = handler;
  return () => { if (ITEMS[id] === handler) delete ITEMS[id]; };
}
function itemNutzen(game, p, id) {
  const h = ITEMS[id];
  return typeof h === 'function' ? (h(game, p) || null) : 'Dieses Item kann man nicht nutzen.';
}
function slotNutzen(game, p, slot) {
  if (!p || !game || !game.away || p.zone !== 'away' || !require('./combat.js').isV2(game)) return 'Nur am Boden (Kampf v2).';
  if (p.downed || p.gefangen || p.bewusstlos || p.console || p.beamLock || !Waffen.handlungsfaehig(game, p)) return 'Gerade nicht möglich.';
  if (!Number.isInteger(slot) || slot < 0 || slot >= slotzahl(game)) return 'Diesen Slot gibt es nicht.';
  const id = wirksam(game, p)[slot];
  if (id == null) return 'Dieser Slot ist leer.';
  return istWaffe(id) ? Waffen.waffeWechseln(game, p, id) : itemNutzen(game, p, id);
}

// Übernahme eines freien Platzes: der Vorbesitzer trug evtl. eine andere Waffe. Getragene Waffe auf das Loadout des Neuen bringen (Gefangene bleiben bei der Faust).
function waffeAbgleichen(game, p) {
  if (!p || p.gefangen || p.clientId == null || !p.waffe) return;
  const soll = aktiveWaffe(game, p);
  if (p.waffe !== soll) Waffen.waffeAnlegen(game, p, soll);
}

// Pfad der Aufrufer von waffeSetzen (Labor, Arena, Debug; der Befehl loadout.waffe ist mit AUS-01 C entfallen): die Waffe wird Slot 1; steckt sie schon in einem anderen Slot, tauschen beide.
function ersterSlotSetzen(game, p, waffe) {
  const h = hashVon(p);
  if (!h || !istWaffe(waffe)) return;
  const e = gespeichert(game, h) || standardLoadout();
  const i = e.indexOf(waffe);
  if (i > 0) e[i] = e[0];
  e[0] = waffe;
  speicher(game)[h] = e;
  spiegeln(game, h);
}

// Weltstand crew.loadout: { Hash -> [Id|null, ...] }, nie Namen.
function toSave(game) {
  const out = {};
  for (const [h, e] of Object.entries(game && game.crewLoadout && typeof game.crewLoadout === 'object' ? game.crewLoadout : {})) if (Array.isArray(e)) out[h] = e.slice(0, SLOTS_MAX);
  return out;
}
// Laden: crew.loadout hat Vorrang; Spieler nur mit crew.waffen (Altstand) bekommen die Waffe als Slot 1. Danach Spiegel neu ableiten.
// Setzt voraus, dass crew.waffen (waffen.restore) schon geladen ist.
function restore(obj, game) {
  if (!game) return;
  const out = {};
  for (const [h, e] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
    if (!/^[0-9a-f]{12}$/.test(h) || !Array.isArray(e)) continue;
    // Ungültige (entfernte/unbekannte) Ids fliegen raus. Bleibt dadurch keine gültige Waffe übrig, gilt der Eintrag als kaputt und wird verworfen
    // (Spieler fällt auf das Standardloadout); ein bewusst leeres Loadout (nur null) bleibt leer.
    const slots = [];
    let ungueltig = false;
    for (let i = 0; i < SLOTS_MAX; i++) {
      if (e[i] != null && !istErlaubt(e[i])) ungueltig = true;
      slots.push(istErlaubt(e[i]) && !slots.includes(e[i]) ? e[i] : null);
    }
    if (ungueltig && !slots.some(Boolean)) continue;
    out[h] = slots;
  }
  for (const [h, w] of Object.entries(spiegelAlt(game))) if (!(h in out) && istWaffe(w)) out[h] = [w, null, null];
  game.crewLoadout = out;
  for (const h of Object.keys(out)) spiegeln(game, h);
}

module.exports = { SLOTS_MAX, erlaubteIds, istErlaubt, slotzahlFestsetzen, slotzahl, loadoutFuer, wirksam, aktiveWaffe, slotSetzen, slotNutzen, itemRegistrieren, standSenden, waffeAbgleichen, ersterSlotSetzen, toSave, restore };
