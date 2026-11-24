'use strict';
// BOT-01 C2a: Mutationsproben zu tools/test-bot-befehle-nav.js. Jede Mutation (Umgebungsvariable BOT_NAV_MUT, die der Test selbst einhaengt) muss den Test rot machen:
//   mensch     die Absicht wird bei Menschenuebernahme nicht verworfen (Mensch gewinnt faellt)
//   kein_ziel  die Zielaufloesung findet immer ein Ziel (kein_ziel wird nicht mehr gemeldet)
//   abstand    nav.abstand tut nichts (der Abstand wird nicht gehalten)
//   wachposten_auf             erlaubt() laesst jede Nachricht durch (captain.*, hello ...)
//   jammer_reise_raus          nav.sprung ohne Vorpruefung Reise/Stoersender/Transfer (der noch alte blockedReason faengt es nicht)
//   ausweichen_im_befehl_raus  ein Befehl weicht Ladungen und Geschossen nicht aus
//   sprung_hex                 nav.sprung hex:<id> waehlt wieder das Sprungziel des Captains (W1)
//   sprung_blockiert_raus      die nav.sprung-Absicht ignoriert eine Blockade nach der Annahme (W2, Zombie-Absicht)
//   schub_aussenteam           die Schub-Absicht laeuft mit Aussenteam unten weiter (W3)
//   schub_ohne_fels            nav.schub weicht Felsen nicht aus (K1a)
// Ohne Mutation laeuft der Test gruen (Gegenprobe). Dauer: je Lauf rund eine Minute.   node tools/mutation-bot-befehle-nav.js [name ...]
const { spawnSync } = require('child_process');
const path = require('path');
const test = path.join(__dirname, 'test-bot-befehle-nav.js');
const alle = ['mensch', 'kein_ziel', 'abstand', 'wachposten_auf', 'jammer_reise_raus', 'ausweichen_im_befehl_raus', 'sprung_hex', 'sprung_blockiert_raus', 'schub_aussenteam', 'schub_ohne_fels'];
const gewaehlt = process.argv.slice(2).length ? process.argv.slice(2) : alle;
let fails = 0;
for (const m of ['', ...gewaehlt]) {
  const r = spawnSync(process.execPath, [test], { env: Object.assign({}, process.env, { BOT_NAV_MUT: m }), encoding: 'utf8', maxBuffer: 1 << 26 });
  const rot = r.status !== 0;
  const zeilen = (r.stdout || '').split('\n').filter((l) => l.includes('FEHLER'));
  const gut = m ? rot : !rot;
  if (!gut) fails++;
  console.log(`${gut ? 'ok  ' : 'FEHLER'} ${m ? 'Mutation ' + m + ': Test ist ' + (rot ? 'rot (' + zeilen.length + ' Fehler, z. B. ' + (zeilen[0] || '').trim().slice(0, 90) + ')' : 'GRUEN (nicht erkannt)') : 'ohne Mutation: Test ist ' + (rot ? 'ROT' : 'gruen')}`);
}
console.log(fails ? `\nmutation-bot-befehle-nav: ${fails} Fehler` : '\nmutation-bot-befehle-nav: alle ok');
if (fails) process.exit(1);
