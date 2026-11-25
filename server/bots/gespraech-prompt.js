'use strict';
// BOT-05 B1: Prompt fuer das freie Gespraech mit einem Bot (deutsch). Reine Funktion, liest nur.
//   baue({ game, bot, agent, figur, captain, text, verlauf })  -> { system, messages }   messages: System, Verlauf (user/assistant) und die neue Zeile des Captains, direkt fuer Ollama /api/chat; systemPrompt(...) allein der Systemtext
// Aufbau des Systemprompts: vorn die festen Teile (Figur, Regeln: Praefix-Cache des Modells), hinten der wechselnde Teil (Rolle, Zustand, Absicht, LAGE, GEDAECHTNIS, Captain).
// Der Anzeigename des Captains steht NUR hier (lokal auf Sleipnir, Kai 2026-11-18) und nie in Anfragen an Claude; dieses Modul wird nur vom Gespraech geladen.
const Lage = require('./gespraech-lage.js');
const Gedaechtnis = require('./gedaechtnis.js');

const GEDAECHTNIS_ZEILEN = 8;

const REGELN = [
  'Antworte mit 1 bis 3 kurzen Sätzen. Der erste Satz hat höchstens 10 Wörter.',
  'Nenne nur Werte, die unter LAGE stehen, und schreibe Zahlen als Ziffern (zum Beispiel 270 Grad, 45 Prozent). Erfinde nichts, was weder unter LAGE noch unter GEDÄCHTNIS steht, auch keine Wetter-, See- oder Stimmungsbilder als Tatsache (nicht „Die See ist ruhig“). Seemannsbilder nur als Redewendung, nie als Zustandsmeldung. Steht ein Wert als „unbekannt“ da, sag ehrlich, dass du ihn nicht kennst.',
  'Du führst im Gespräch keine Befehle aus. Sag nie zu, etwas zu tun, und behaupte nie, etwas getan zu haben („wird erledigt“, „ist erledigt“, „sofort“). Antworte auf einen Auftrag nie mit „Verstanden“, „Aye“ oder „Jawohl“. Will der Captain etwas getan haben, bitte ihn kurz, es als Befehl zu geben (in deiner Art).',
  'Wiederhole keine Wendung aus deinen letzten Antworten; wechsle Satzbau und Wortwahl.',
  'Bleib in deiner Figur. Kein Markdown, keine Aufzählung, keine Emojis, keine Regieanweisungen, keine Anführungszeichen um die ganze Antwort.',
];

// Anzeigename: nur druckbare Zeichen, eine Zeile, begrenzt
const bereinigt = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const captainName = (n) => bereinigt(n, 24);
const anrede = (n) => { const x = captainName(n); return x ? `Captain ${x}` : 'Captain'; };

function systemPrompt({ game, bot, agent, figur, captain }) {
  const gedaechtnis = Gedaechtnis.lesen(game, figur.botId).slice(-GEDAECHTNIS_ZEILEN).map((e) => '- ' + bereinigt(e.text, 140)).filter((z) => z.length > 2);
  const teile = [
    `Du bist ${figur.name}, Besatzungsmitglied der Lerche, eines kleinen Raumschiffs. Der Captain spricht dich an; du antwortest laut, in deiner Rolle und in deiner Art.`,
    '',
    `FIGUR: ${figur.persoenlichkeit}`,
    '',
    'REGELN:',
    ...REGELN.map((r, i) => `${i + 1}. ${r}`),
    '',
    `ROLLE: ${Lage.rolleText(bot)}`,
    `ZUSTAND: ${Lage.zustandText(game, bot, agent)}`,
    `ABSICHT: ${Lage.absichtText(game, bot, agent)}`,
    '',
    'LAGE (echte Werte, Stand jetzt):',
    ...Lage.lageZeilen(Lage.lageAuszug(game, bot)).map((z) => '- ' + z),
    '',
    'GEDÄCHTNIS (neueste zuletzt):',
    ...(gedaechtnis.length ? gedaechtnis : ['- (nichts Besonderes)']),
    '',
    `Der Captain, der dich anspricht, heißt ${captainName(captain) || 'unbekannt'}.`,
  ];
  return teile.join('\n');
}

function baue(o) {
  const messages = [];
  for (const w of (o.verlauf || []).slice(-3)) {
    messages.push({ role: 'user', content: `${anrede(w.von)}: ${w.frage}` });
    messages.push({ role: 'assistant', content: w.antwort });
  }
  messages.push({ role: 'user', content: `${anrede(o.captain)}: ${bereinigt(o.text, 200)}` });
  const system = systemPrompt(o);
  return { system, messages: [{ role: 'system', content: system }].concat(messages) };
}

module.exports = { baue, systemPrompt, REGELN, GEDAECHTNIS_ZEILEN };
