'use strict';
// BOT-01 C2b: Mutationsproben zu tools/test-bot-befehle-ops-tech.js. Jede Mutation (Umgebungsvariable BOT_OT_MUT, die der Test selbst einhaengt) muss den Test rot machen:
//   feuer_halt  ops.feuer_halt/waffen sperren nichts (der Bot feuert trotz Halt)
//   schild      die gehaltene Technik-Einstellung wird nicht gehalten (die Verteilung nach Bedrohung laeuft weiter)
//   status      die Annahme uebernimmt den Registry-Text bei jedem Befehl, nicht nur bei bot.status
//   mensch      die Absicht wird bei Menschenuebernahme nicht verworfen (Mensch gewinnt faellt)
//   ziel_stumm  eine Station/Mine als Ziel legt das Feuer auf Gegner still (BOT-01 C2b Nacharbeit W1)
//   prio_sperre die Standard-Prioritaeten (Feuer zuerst) laufen gegen die gehaltene tech.prio
//   system_aktiv  tech.prio prueft nicht, ob das System eingebaut ist
//   prio_bleibt die vom Bot gesetzte Prioritaet bleibt im Schiff stehen (Mensch, Raeumen, bewusstlos; W2)
//   prio_endet_nie  eine System-Prioritaet endet nicht, wenn das System heil ist (W3)
//   unten       bewusstlos/abwesend verwirft keine Absicht
// Ohne Mutation laeuft der Test gruen (Gegenprobe). Dauer: je Lauf rund zwei Minuten (Stufe slow).   node tools/mutation-bot-befehle-ops-tech.js [name ...]
const { spawnSync } = require('child_process');
const path = require('path');
const test = path.join(__dirname, 'test-bot-befehle-ops-tech.js');
const alle = ['feuer_halt', 'schild', 'status', 'mensch', 'ziel_stumm', 'prio_sperre', 'system_aktiv', 'prio_bleibt', 'prio_endet_nie', 'unten'];
const gewaehlt = process.argv.slice(2).length ? process.argv.slice(2) : alle;
let fails = 0;
for (const m of ['', ...gewaehlt]) {
  const r = spawnSync(process.execPath, [test], { env: Object.assign({}, process.env, { BOT_OT_MUT: m }), encoding: 'utf8', maxBuffer: 1 << 26 });
  const rot = r.status !== 0;
  const zeilen = (r.stdout || '').split('\n').filter((l) => l.includes('FEHLER'));
  const gut = m ? rot : !rot;
  if (!gut) fails++;
  console.log(`${gut ? 'ok  ' : 'FEHLER'} ${m ? 'Mutation ' + m + ': Test ist ' + (rot ? 'rot (' + zeilen.length + ' Fehler, z. B. ' + (zeilen[0] || '').trim().slice(0, 90) + ')' : 'GRUEN (nicht erkannt)') : 'ohne Mutation: Test ist ' + (rot ? 'ROT' : 'gruen')}`);
}
console.log(fails ? `\nmutation-bot-befehle-ops-tech: ${fails} Fehler` : '\nmutation-bot-befehle-ops-tech: alle ok');
if (fails) process.exit(1);
