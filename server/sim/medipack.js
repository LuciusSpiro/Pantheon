'use strict';
// ITM-01 A: Medipack als Slot-Item mit Ladungen (Item `medipack` im Loadout-Slot). Action-Layer; Vorbild scanner.js.
// p.medkit ist der Ladungszähler am Spieler (0 = kein Medipack). Wiederbeleben und das Verarzten von Personen verbrauchen eine Ladung
// (combat.completeRevive, interior npcHeal), unabhängig vom aktiven Slot. Das Lager (game.inventory) führt ganze Packs (`medipack`) und
// einen angebrochenen Rest (`medipackCharges`, wie Löschgel; das Konto entsteht erst, wenn ein Rest anfällt). Alle Buchungen laufen über vorrat.js (Grund 'medkit').
//
//   traegt(game, p)           steht `medipack` in den wirksamen Slots des Spielers?
//   ladungen(game)            Ladungen je vollem Pack (config medipack.ladungen)
//   ausgeben(game, p)         Beamen nach unten (combat.onArrive): Träger bekommt erst ein voller Pack aus dem Lager, erst ohne volle Packs den Rest; Nichtträger 0
//   zurueckgeben(game, p)     Beamen nach oben/Abbruch (combat.onLeave): voller Pack zurück als `medipack`, Teilmenge als `medipackCharges`
//   verbrauchen(p)            eine Ladung weg (nach erfolgreichem Wiederbeleben/Verarzten)
//   aufheben(game, p)         Bodenpack (v2): füllt den Träger auf die Packgröße auf, sein alter Rest geht ins Lager (REST) -> null | Hinweistext (Pack bleibt dann liegen)
//   nutzen(game, p)           Item-Handler (Taste im Medipack-Slot): zeigt nur den Rest per game.notice
const Loadout = require('./loadout.js');
const Vorrat = require('./vorrat.js');

const ITEM_ID = 'medipack';
const REST = 'medipackCharges';

const ladungen = (game) => Math.max(1, Math.floor(Number(game.C.medipack && game.C.medipack.ladungen) || 1));
const traegt = (game, p) => Loadout.wirksam(game, p).includes(ITEM_ID);

function ausgeben(game, p) {
  const n = ladungen(game);
  p.medkit = 0;
  if (!traegt(game, p)) return;
  // Reihenfolge (ITM-01 H): erst volle Packs aus dem Lager, den Rest-Topf erst, wenn kein voller Pack mehr da ist
  if ((game.inventory.medipack || 0) > 0) {
    Vorrat.verbrauchen(game, 'medipack', 1, 'medkit');   // Wächter oben; bewusst verbrauchen, nicht entnehmen (Bruchteil-Bestand wie früher)
    p.medkit = n;
  } else if (Vorrat.stand(game, REST) > 0) {
    const rest = Vorrat.leeren(game, REST, 'medkit');
    p.medkit = Math.min(n, rest);
    if (rest > n) Vorrat.einlagern(game, REST, rest - n, 'medkit');   // mehr Rest als ein Pack: der Überschuss bleibt im Lager
  } else if (game.notice) game.notice(p, 'Kein Medipack im Lager.');
}

function zurueckgeben(game, p) {
  const n = ladungen(game);
  const rest = Math.max(0, Math.floor(Number(p.medkit) || 0));
  p.medkit = 0;
  if (rest <= 0) return;
  const packs = Math.floor(rest / n);
  if (packs > 0) Vorrat.einlagern(game, 'medipack', packs, 'medkit');
  if (rest - packs * n > 0) Vorrat.einlagern(game, REST, rest - packs * n, 'medkit');
}

function verbrauchen(p) { if (p.medkit > 0) p.medkit -= 1; }

function aufheben(game, p) {
  if (!traegt(game, p)) return 'Kein Medipack-Slot.';
  if (p.medkit >= ladungen(game)) return 'Dein Medipack ist schon voll.';
  // Ein Bodenpack hat eine volle Packgröße. Der Träger wird bis zur Packgröße aufgefüllt; was darüber hinaus im Pack steckt
  // (= die alten Restladungen des Trägers), geht als Rest ins Lager. So verschwinden nie Ladungen (Summe bleibt gleich).
  const n = ladungen(game);
  const alt = Math.max(0, Math.floor(Number(p.medkit) || 0));
  p.medkit = n;
  if (alt > 0) Vorrat.einlagern(game, REST, alt, 'medkit');
  return null;
}

function nutzen(game, p) {
  const n = Math.max(0, Math.floor(Number(p.medkit) || 0));
  if (game.notice) game.notice(p, n > 0 ? 'Medipack: ' + n + (n === 1 ? ' Ladung' : ' Ladungen') : 'Medipack leer');
  return null;
}

// Beim Laden des Moduls anmelden: `medipack` ist dann in jeden Slot wählbar (loadout.erlaubteIds), auch für loadout.restore
Loadout.itemRegistrieren(ITEM_ID, nutzen);

module.exports = { ITEM_ID, REST, traegt, ladungen, ausgeben, zurueckgeben, verbrauchen, aufheben, nutzen };
