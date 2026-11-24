'use strict';
// BOT-02 B3: Mutationsproben zu tools/test-bot02-vorlauf.js. Jede Mutation (Umgebungsvariable BOT_VOR_MUT, die der Test selbst einhaengt) muss den Test rot machen:
//   vorlauf_aus               der Vorlauf beginnt nie (Bot geht erst mit dem Beam zum Transfer, Ops scannt nicht, Navigation stoppt nicht)
//   frist_raus                die 120-s-Frist beendet den Vorlauf nicht (der Bot bliebe ewig am Transfer)
//   ziel_mehrfach             dasselbe Ziel beginnt nach dem Ende einen neuen Vorlauf (nach Frist, Aufstieg)
//   scan_auto_aus             der Ops-Bot scannt nicht automatisch
//   scan_doppelt              ein bereits gescannter Landepunkt wird erneut gescannt (kein „nur ein Scan“)
//   scan_vor_transfer_raus    der Bord-Bot als Ops-Bot scannt nicht vor dem Gang zum Transfer
//   stopp_aus                 der Navigations-Bot stoppt das Schiff nicht
//   stopp_immer               der Navigations-Bot stoppt auch ohne Landepunkt und ohne Beam
//   mensch_gewinnt_raus       der Bord-Bot geht zum Transfer, obwohl ein Mensch ihn haelt
//   vorlauf_nav_offen         Navigationsbefehle im Vorlauf sind nicht gesperrt (nicht_jetzt)
// Ohne Mutation laeuft der Test gruen (Gegenprobe). Der Vergleich mit dem Basisstand (git archive) entfaellt dabei (VORLAUF_OHNE_BASIS). Dauer: je Lauf rund 15 s.   node tools/mutation-bot02-vorlauf.js [name ...]
const { spawnSync } = require('child_process');
const path = require('path');
const test = path.join(__dirname, 'test-bot02-vorlauf.js');
const alle = ['vorlauf_aus', 'frist_raus', 'ziel_mehrfach', 'scan_auto_aus', 'scan_doppelt', 'scan_vor_transfer_raus', 'stopp_aus', 'stopp_immer', 'mensch_gewinnt_raus', 'vorlauf_nav_offen'];
const gewaehlt = process.argv.slice(2).length ? process.argv.slice(2) : alle;
let fails = 0;
for (const m of ['', ...gewaehlt]) {
  const r = spawnSync(process.execPath, [test], { env: Object.assign({}, process.env, { BOT_VOR_MUT: m, VORLAUF_OHNE_BASIS: '1' }), encoding: 'utf8', maxBuffer: 1 << 26 });
  const rot = r.status !== 0;
  const zeilen = (r.stdout || '').split('\n').filter((l) => l.includes('FEHLER'));
  const gut = m ? rot : !rot;
  if (!gut) fails++;
  console.log(`${gut ? 'ok  ' : 'FEHLER'} ${m ? 'Mutation ' + m + ': Test ist ' + (rot ? 'rot (' + zeilen.length + ' Fehler, z. B. ' + (zeilen[0] || '').trim().slice(0, 100) + ')' : 'GRUEN (nicht erkannt)') : 'ohne Mutation: Test ist ' + (rot ? 'ROT' : 'gruen')}`);
}
console.log(fails ? `\nmutation-bot02-vorlauf: ${fails} Fehler` : '\nmutation-bot02-vorlauf: alle ok');
if (fails) process.exit(1);
