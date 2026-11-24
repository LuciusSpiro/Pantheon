'use strict';
// BOT-02 B2: Mutationsproben zu tools/test-bot02-rueckholung.js. Jede Mutation (Umgebungsvariable BOT_RUECK_MUT, die der Test selbst einhaengt) muss den Test rot machen:
//   rueck_einer                  Notrueckholung schon bei einem Downed, auch wenn ein anderer Mensch unten aufrecht ist
//   rueck_sperre_raus            Abklingzeit und Transfer-Ausfall werden nicht beachtet (Senden gegen die Sperre)
//   sofort_senden                kein Mindestabstand zwischen zwei Versuchen und keine Sperre (Dauerfeuer)
//   weg_vor_rueckholung          der Laufweg zur Captain-Konsole geht der Rueckholung vor
//   rueckholen_befehl_ignoriert  bord.rueckholen holt nicht (nur die Lage alle downed)
//   mensch_captain               ein Mensch an der Captain-Konsole wird ignoriert
//   abklingzeit_raus             Weg zur Captain-Konsole trotz Abklingzeit
//   sensor_ohne_gegner           Sensor-Automatik ohne aktive Gegner
//   sensor_pause_raus            Sensor-Automatik ohne die 60-s-Pause
//   kuppel_immer                 Kuppel-Automatik ohne Schwelle (50 %)
//   automatik_loescht_nicht      bot.automatik loescht Befehl und Weg nicht
//   bordloeschen_raus            Dienstende und bot.automatik verwerfen Befehl und Weg nicht
//   wachposten_auf               der Wachposten laesst jede Nachricht durch
//   registry_ok_immer            die Registry nimmt jeden bord.*-Befehl an (kein kein_ziel, kein nicht_jetzt)
//   weichen_captain_raus         ein Bot an der Captain-Konsole weicht dem Menschen nicht
// Ohne Mutation laeuft der Test gruen (Gegenprobe). Dauer: je Lauf rund 15 s.   node tools/mutation-bot02-rueckholung.js [name ...]
const { spawnSync } = require('child_process');
const path = require('path');
const test = path.join(__dirname, 'test-bot02-rueckholung.js');
const alle = ['rueck_einer', 'rueck_sperre_raus', 'sofort_senden', 'weg_vor_rueckholung', 'rueckholen_befehl_ignoriert', 'mensch_captain', 'abklingzeit_raus', 'sensor_ohne_gegner', 'sensor_pause_raus', 'kuppel_immer', 'automatik_loescht_nicht', 'bordloeschen_raus', 'wachposten_auf', 'registry_ok_immer', 'weichen_captain_raus'];
const gewaehlt = process.argv.slice(2).length ? process.argv.slice(2) : alle;
let fails = 0;
for (const m of ['', ...gewaehlt]) {
  const r = spawnSync(process.execPath, [test], { env: Object.assign({}, process.env, { BOT_RUECK_MUT: m }), encoding: 'utf8', maxBuffer: 1 << 26 });
  const rot = r.status !== 0;
  const zeilen = (r.stdout || '').split('\n').filter((l) => l.includes('FEHLER'));
  const gut = m ? rot : !rot;
  if (!gut) fails++;
  console.log(`${gut ? 'ok  ' : 'FEHLER'} ${m ? 'Mutation ' + m + ': Test ist ' + (rot ? 'rot (' + zeilen.length + ' Fehler, z. B. ' + (zeilen[0] || '').trim().slice(0, 100) + ')' : 'GRUEN (nicht erkannt)') : 'ohne Mutation: Test ist ' + (rot ? 'ROT' : 'gruen')}`);
}
console.log(fails ? `\nmutation-bot02-rueckholung: ${fails} Fehler` : '\nmutation-bot02-rueckholung: alle ok');
if (fails) process.exit(1);
