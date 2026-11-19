'use strict';
// BOT-01 B3: Schnittstelle der Bot-Befehle (Inhalt kommt in Paket C): befehl(game, bot, name, args) -> { ok, code?, text? }.
// Gesucht wird in der Registry der Rolle des Bots, dann in bord und bot; ein Name ohne Eintrag liefert { ok: false, code: 'unbekannt' }.
const REGISTER = {
  navigation: require('./navigation.js'),
  ops: require('./ops.js'),
  technik: require('./technik.js'),
  bord: require('./bord.js'),
  bot: require('./bot.js'),
};

const hat = (reg, name) => Object.prototype.hasOwnProperty.call(reg, name) && typeof reg[name] === 'function';

function befehl(game, bot, name, args) {
  const rolle = bot && typeof bot.rolle === 'string' ? bot.rolle : null;
  const suche = [rolle && Object.prototype.hasOwnProperty.call(REGISTER, rolle) ? REGISTER[rolle] : null, REGISTER.bord, REGISTER.bot];
  for (const reg of suche) {
    if (reg && hat(reg, name)) return reg[name](game, bot, args || {});
  }
  return { ok: false, code: 'unbekannt', text: 'Diesen Befehl kenne ich nicht.' };
}

module.exports = { befehl, REGISTER };
