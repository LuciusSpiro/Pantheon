'use strict';
// BOT-01 A1: die einzige Zählstelle für die Mannschaft (Vertrag Bot-Befehle §2). Funktionen mit `game` als Parameter (nicht Methoden von Game),
// damit Mock-Games, die nur `players` haben, ebenso zählen.
//   menschen(game)   verbundene Menschen: Solo-Pause, Reset bei „alle weg“, Weiterlaufen bei Browser-Schluss, zerstoertOk, Kontingent (Farbe 0),
//                    „X ist an Bord gekommen“, Telemetrie (spielerzahl)
//   koepfe(game)     alle Verbundenen (Menschen und Bots): Skalierung (Gegner, Trupps, Wellen), Automatik-Schwellen – Standard, wo nicht ausdrücklich Menschen gebraucht werden
//   verbundene(game) die Liste dazu
//   istBot(p)        `p.bot` ist nur bei Bots gesetzt (true), bei Menschen fehlt das Feld
// Optionale Spielerfelder für Bots (Paket B, hier nur dokumentiert; resetPlayer setzt für Menschen nichts):
//   bot (true) · rolle (navigation | ops | technik | bord | frei) · botId (b0..b3) · stimme (Voicebox-Profil-ID, leer bis BOT-04/05)
// Boundary-Regel: außerhalb dieser Datei zählt in server/ niemand per `players.filter(... connected ...).length` (tools/test-crew-zaehlung.js).

const istBot = (p) => !!(p && p.bot);
const verbundene = (game) => ((game && game.players) || []).filter((p) => p && p.connected);
const koepfe = (game) => verbundene(game).length;
const menschen = (game) => verbundene(game).filter((p) => !p.bot).length;

module.exports = { menschen, koepfe, verbundene, istBot };
