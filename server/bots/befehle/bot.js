'use strict';
// BOT-01 C2b: Registry der Bot-Befehle fuer den Bot selbst (Katalog v1): bot.status, bot.automatik. Gelten fuer alle Rollen und ueber alle Bots (an: alle oder eine botId). Jede Funktion: (game, bot, args) => { ok: true, text? } | { ok: false, code }.
// bot.status liefert einen Text aus dem Zustand des Bots (status.js, kein LLM); die Annahme (annahme.js) uebernimmt ihn nur bei diesem Befehl in die Antwort.
// bot.automatik loescht die Absicht des Bots (Befehl, Feuerzustand, gehaltene Technik-Einstellungen) und stellt das Standardverhalten der Rolle her; ok auch, wenn nichts zu loeschen war.
const Lauf = require('../lauf.js');
const Status = require('../status.js');

const bot = {};

bot['bot.status'] = (game, spieler) => {
  const agent = Lauf.agent(game, spieler);
  return { ok: true, text: agent ? Status.text(game, agent) : 'Noch nicht an Bord.' };
};

bot['bot.automatik'] = (game, spieler) => {
  const agent = Lauf.agent(game, spieler);
  if (agent) agent.automatik();
  return { ok: true };
};

module.exports = bot;
