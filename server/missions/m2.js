'use strict';
// Mission 2 „Echo im Nebel“ als Daten (CONTRACT-M1 §9.3). Start nach Mission 1 im Hafen (Funk Ivo bzw. Tesk).
// Vaelen-Karawane (Sela kennt den Nebel: Karte kaufen oder ihre Messsonde per Weitscan suchen) ->
// Graue Weite (Nebel, Rostmeute-Hinterhalt, danach Funkduell mit Grauzahn) -> Weitscan: Leitbake finden + scannen ->
// Relais bekannt -> Kustoden-Relais: 3 Pylonen (Frontschild) + Wächter -> Prüfung: 2 Pylonen (Front zum Kern) ->
// Relaiskern scannen (Captain, 6 s) -> Finale, Ende-Screen M1.
// QA M1 (Inhalt für 30–45 min): Schritte vaelen/sonde und parley sowie die zweite Pylonwelle sind neu.

const TESK = 'Hafenmeisterin Tesk';
const IVO = 'Techniker Ivo';
const SELA = 'Sela (Vaelen-Händlerin)';
const GRAUZAHN = 'Grauzahn (Rostmeute)';
const C = require('../../shared/config.js').missionM1;

module.exports = {
  id: 'm2',
  title: 'Echo im Nebel',
  // §21.2 Missionsbuch (from als Funktion: Ivo meldet sich, wenn er gerettet wurde)
  book: { from: (m) => (m.flags.technikerRescued ? IVO : TESK),
    briefing: 'B-7 hat vor dem Ausfall ein Echo aus der Grauen Weite aufgefangen – Kustoden-Muster. Hinfliegen und die Quelle finden.',
    reward: '150 Marken' },
  steps: [
    {
      id: 'briefing', loc: 'hafen',
      timers: [
        { at: C.wreckRumorAfter, do: [
          { radio: { from: TESK, text: 'Übrigens: Hinter dem Splittergürtel treibt das Wrack der „Zaunkönig“. Plünderer waren da – aber nicht gründlich.' } },
          { reveal: 'wrack', text: 'Gerücht notiert: Wrack „Zaunkönig“ ist neu auf der Sternkarte. Optional – aber lohnend.' }] },
        { at: C.wreckRumorAfter + C.m2OfferAfter, do: [
          { set: { offer: true } },
          { if: { flag: 'technikerRescued' }, radio: { from: IVO, text: 'Captain? Mein Bojenlog sagt: B-7 hat vor dem Ausfall ein Echo aus der Grauen Weite empfangen. Kustoden-Muster. Sehen wir nach?', accept: true } },
          { if: { not: { flag: 'technikerRescued' } }, radio: { from: TESK, text: 'Lerche, noch was: B-7 hat vor dem Ausfall ein Echo aus der Grauen Weite aufgefangen. Kustoden-Muster. Seht ihr nach?', accept: true } }] },
        { at: C.wreckRumorAfter + C.m2OfferAfter + 30, if: { not: { event: 'accepted' } }, oda: 'Ein neuer Auftrag wartet: Captain-Konsole, Reiter „Funk“, Enter. Einkaufen dürft ihr vorher.' },
      ],
      objectives: [
        { id: 'shop', text: 'Hafenterminal: einkaufen (optional)', optional: true, done: { event: 'bought' } },
        { id: 'deco', text: 'Quartier einrichten – Trophäe aufstellen (optional)', optional: true, done: { event: 'decoPlaced' } },
        { id: 'accept', text: 'Captain: neuen Funkspruch annehmen', show: { v: 'offer' }, done: { event: 'accepted' } },
      ],
      onAccept: [
        { reveal: ['nebel', 'vaelen'], text: 'Graue Weite auf der Sternkarte! Erreichbar über B-7, die Vaelen-Karawane oder das Wrack.' },
        { goto: 'vaelen' }],
      skip: [{ do: 'forceRadio', from: TESK, text: 'Echo aus der Grauen Weite.' }, { do: 'acceptNow' }],
    },
    {
      // QA M1: Sela kennt die Graue Weite – Entscheidung: Karte kaufen oder ihre verlorene Messsonde suchen (Weitscan + Scan)
      id: 'vaelen',
      timers: [
        { at: 2, radio: { from: TESK, text: 'Noch ein Tipp: Sela von der Vaelen-Karawane fliegt seit Jahren am Nebelrand. Fragt sie, bevor ihr reinfliegt.' } },
        { at: 8, oda: 'Kurs Vaelen-Karawane (Sternkarte), dort am Ring andocken. Von da ist es nur ein Sprung in die Graue Weite.' },
        { at: 120, if: { not: { atLocation: 'vaelen' } }, oda: 'Die Vaelen-Karawane liegt direkt am Hafen. Captain: Sternkarte, Ziel Vaelen, dann andocken.' },
      ],
      rules: [
        { if: { docked: 'vaelen' }, do: [
          { radio: { from: SELA, text: 'Die Graue Weite? Meine Messsonde ging dort beim Reaktorausfall verloren – sie treibt hier am Rand. Oder ihr kauft meine Nebelkarte.' } },
          { choice: 'sela' }, { oda: 'Captain: Sela wartet auf Antwort – Reiter „Funk“.' }] },
      ],
      choices: {
        sela: {
          prompt: 'Sela bietet Hilfe für die Graue Weite an. Was tun wir?',
          options: [{ id: 'buy', label: 'Nebelkarte kaufen (60 Marken)', disabledIf: { check: { name: 'marksBelow', n: 60 } } }, { id: 'search', label: 'Messsonde suchen (Weitscan)' }],
          on: {
            buy: [{ do: 'pay', marks: 60 }, { setFlag: { nebelMap: true } }, { radio: { from: SELA, text: 'Bitte sehr. Die Bake singt im Nordosten der Weite – und die Rostmeute lauert im Süden.' } },
              { log: 'Selas Nebelkarte gekauft: Leitbake im Nordosten der Grauen Weite.', loc: 'vaelen' }, { goto: 'nebelFlight' }],
            search: [{ setFlag: { selaProbe: true } }, { radio: { from: SELA, text: 'Ihr seid Schätze! Sie sendet nicht mehr – ein Weitscan sollte sie trotzdem finden. Irgendwo hier draußen.' } },
              { oda: 'Ablegen, Taktik: Weitscan (W) an verschiedenen Stellen der Szene. Die Sonde dann anvisieren und scannen.' }, { goto: 'sonde' }],
          },
        },
      },
      objectives: [
        { id: 'toVaelen', text: 'Zur Vaelen-Karawane fliegen und andocken', done: { docked: 'vaelen' } },
        { id: 'answerSela', text: 'Captain: Selas Angebot beantworten (Funk)', show: { docked: 'vaelen' }, done: { choiceMade: 'sela' } },
      ],
      // Wer Sela auslässt und direkt in den Nebel springt, wird nicht zurückgeschickt.
      next: [{ if: { atLocation: 'nebel' }, do: [{ oda: 'Ohne Selas Rat in die Graue Weite – mutig. Augen auf!' }], goto: 'ambush' }],
      skip: [{ do: 'debugJump', loc: 'vaelen' }, { setFlag: { nebelMap: true } }, { goto: 'nebelFlight' }],
    },
    {
      id: 'sonde', loc: 'vaelen',
      rules: [
        { if: { all: [{ elapsed: 50 }, { not: { revealed: 'vaelen_sonde' } }] }, do: [{ oda: 'Tipp: Die Karawane schirmt Signale ab. Weiter weg von ihr weitscannen – zum Beispiel Richtung Südwesten.' }] },
        { if: { all: [{ elapsed: 150 }, { not: { revealed: 'vaelen_sonde' } }] }, do: [{ do: 'revealHidden', id: 'vaelen_sonde' }, { oda: 'Sela hat ein schwaches Piepen aufgefangen: Sonde markiert. Anvisieren (T) und scannen (S).' }] },
        { if: { all: [{ revealed: 'vaelen_sonde' }, { elapsed: 300 }, { not: { found: 'vaelen_sonde' } }] }, do: [{ do: 'scanHidden', id: 'vaelen_sonde' }] },
      ],
      objectives: [
        { id: 'findProbe', text: 'Taktik: Weitscan (W) – Selas Messsonde suchen', done: { revealed: 'vaelen_sonde' } },
        { id: 'scanProbe', text: 'Taktik: Sonde anvisieren (T) und scannen (S halten)', show: { revealed: 'vaelen_sonde' }, done: { found: 'vaelen_sonde' } },
      ],
      next: [{ if: { found: 'vaelen_sonde' }, do: [
        { setFlag: { nebelMap: true } }, { reward: { marks: 40 } },
        { radio: { from: SELA, text: 'Meine Sonde! Ihre Daten zeigen: Die Bake singt im Nordosten der Weite. Nehmt die Karte – und 40 Marken.' } },
        { log: 'Selas Messsonde gefunden: Leitbake im Nordosten der Grauen Weite.', loc: 'vaelen' }], goto: 'nebelFlight' },
        { if: { atLocation: 'nebel' }, do: [{ oda: 'Die Sonde lassen wir treiben – vielleicht später. Jetzt: Graue Weite!' }], goto: 'ambush' }],
      skip: [{ do: 'scanHidden', id: 'vaelen_sonde' }],
    },
    {
      id: 'nebelFlight',
      timers: [
        { at: 4, oda: 'Kurs Graue Weite – von hier ein Sprung. Der Planungstisch zeigt alle Routen, Pins helfen beim Absprechen.' },
        { at: 90, if: { not: { atLocation: 'nebel' } }, oda: 'Zur Grauen Weite geht es von B-7, der Vaelen-Karawane oder dem Wrack aus. Sternkarte!' },
      ],
      objectives: [{ id: 'toNebel', text: 'Zur Grauen Weite fliegen (über B-7, Vaelen oder das Wrack)', done: { atLocation: 'nebel' } }],
      next: [{ if: { atLocation: 'nebel' }, goto: 'ambush' }],
      skip: [{ do: 'debugJump', loc: 'nebel' }],
    },
    {
      id: 'ambush', loc: 'nebel',
      timers: [
        { at: 0.5, oda: 'Im Nebel ist die Taktik die Augen des Piloten. Marker setzen, ansagen, lotsen!' },
        { at: C.ambushAfter, do: [
          { spawn: { kind: 'raider', tag: 'hinterhalt', angles: [-1.2, 1.4] } }, { set: { ambush: true } },
          { radio: { from: GRAUZAHN, text: 'Nebel ist praktisch, Lerche. Man sieht euch nicht kommen – und uns auch nicht.' } },
          { oda: 'Hinterhalt! Zwei Jäger aus dem Nebel. Taktik: scannen, Ziel ansagen. Captain: Schilde!' }] },
      ],
      objectives: [{ id: 'ambush', text: 'Rostmeute-Hinterhalt abwehren', done: false }],
      next: [{ if: { all: [{ v: 'ambush' }, { enemiesLeft: { max: 0 } }] }, goto: 'parley' }],
      skip: [{ do: 'killAll' }, { set: { ambush: true } }],
    },
    {
      // QA M1: Funkduell mit Grauzahn – die Antwort entscheidet, ob die Rostmeute an der Leitbake noch einmal auftaucht
      id: 'parley', loc: 'nebel',
      enter: [
        { radio: { from: GRAUZAHN, text: 'Nicht schlecht, Lerche. Aber was sucht so ein Kahn wie eurer in der Grauen Weite? Raus mit der Sprache.' } },
        { choice: 'parley' },
        { oda: 'Grauzahn funkt. Captain: Antwort im Reiter „Funk“ – bluffen, teilen oder schweigen?' }],
      timers: [{ at: 45, if: { not: { choiceMade: 'parley' } }, oda: 'Grauzahn wird ungeduldig. Schweigen ist auch eine Antwort – aber keine freundliche.' }],
      rules: [{ if: { all: [{ elapsed: 75 }, { not: { choiceMade: 'parley' } }] }, do: [{ do: 'choose', option: 'silent' }] }],
      choices: {
        parley: {
          prompt: 'Grauzahn will wissen, was ihr hier sucht. Antwort?',
          options: [{ id: 'bluff', label: 'Bluffen: „Konkordat-Patrouille!“' }, { id: 'share', label: 'Teilen: vom Kustoden-Echo erzählen' }, { id: 'silent', label: 'Funkstille' }],
          on: {
            bluff: [
              { if: { flag: { decision: 'deliver' } }, setFlag: { rostmeuteGone: true } },
              { if: { flag: { decision: 'deliver' } }, radio: { from: GRAUZAHN, text: 'Das Konkordat? Ihr habt denen wirklich den Datenkern gebracht … Na gut. Wir waren nie hier.' } },
              { if: { flag: { decision: 'deliver' } }, log: 'Grauzahn geblufft – das Konkordat hat einen Ruf. Die Rostmeute zieht ab.', loc: 'nebel' },
              { if: { not: { flag: { decision: 'deliver' } } }, radio: { from: GRAUZAHN, text: 'Konkordat? Ihr habt deren Kern geknackt, das weiß jeder. Jungs – noch eine Runde!' } },
              { if: { not: { flag: { decision: 'deliver' } } }, spawn: { kind: 'raider', tag: 'bluff', n: 1 } },
              { if: { not: { flag: { decision: 'deliver' } } }, oda: 'Bluff durchschaut! Ein Jäger kommt zurück. Taktik!' }],
            share: [{ setFlag: { rostmeuteGone: true, sharedEcho: true } }, { reward: { marks: 30 } },
              { radio: { from: GRAUZAHN, text: 'Kustoden? Geister jagen ist nichts für uns. Hier, für die Geschichte: 30 Marken. Und tief im Süden liegt eine alte Bake.' } },
              { do: 'revealHidden', id: 'nebel_lore' }, { log: 'Mit Grauzahn das Kustoden-Echo geteilt. Er zahlt – und verrät eine alte Bake.', loc: 'nebel' }],
            silent: [{ radio: { from: GRAUZAHN, text: 'Schweigen, hm? Dann finden wir es eben selbst heraus.' } }],
          },
        },
      },
      objectives: [
        { id: 'parley', text: 'Captain: Grauzahn antworten (Funk)', done: { choiceMade: 'parley' } },
        { id: 'bluffFight', text: 'Jäger abwehren', show: { all: [{ choiceMade: 'parley' }, { not: { enemiesLeft: { max: 0 } } }] }, done: { enemiesLeft: { max: 0 } } },
      ],
      next: [{ if: { all: [{ choiceMade: 'parley' }, { enemiesLeft: { max: 0 } }] },
        do: [{ if: { flag: 'nebelMap' }, oda: 'Jetzt das Echo. Selas Karte sagt: Nordosten. Taktik: dort Weitscan (W) – Marker für den Pilot!' },
          { if: { not: { flag: 'nebelMap' } }, oda: 'Jetzt das Echo: Taktik, Weitscan (W) – die Leitbake muss hier irgendwo sein.' }], goto: 'beacon' }],
      skip: [{ do: 'choose', option: 'silent' }, { do: 'killAll' }],
    },
    {
      id: 'beacon', loc: 'nebel',
      rules: [
        { if: { all: [{ revealed: 'nebel_beacon' }, { not: { flag: 'rostmeuteGone' } }] },
          do: [{ after: { sec: 6, do: [{ spawn: { kind: 'raider', tag: 'echo', n: 1 } },
            { radio: { from: GRAUZAHN, text: 'Eine Kustoden-Bake? Die holen wir uns, Lerche. Danke fürs Finden!' } },
            { oda: 'Ein Jäger hat unser Echo mitgehört. Erst abwehren – sein Störsender stört aber nicht den Scan.' }] } }] },
        { if: { all: [{ elapsed: 35 }, { not: { check: 'widescanUsed' } }, { not: { revealed: 'nebel_beacon' } }] },
          do: [{ oda: 'Taktik: W drückt den Weitscan – Reichweite 1000. Mehrmals und an verschiedenen Stellen probieren.' }] },
        { if: { all: [{ elapsed: C.beaconHintAt }, { not: { revealed: 'nebel_beacon' } }] }, do: [{ do: 'beaconHint' }] },
        { if: { all: [{ elapsed: C.beaconAutoAt }, { not: { revealed: 'nebel_beacon' } }] },
          do: [{ do: 'revealHidden', id: 'nebel_beacon' }, { oda: 'Ich habe das Echo angepeilt: Leitbake auf der Taktikkarte markiert. Anvisieren und scannen!' }] },
        { if: { all: [{ revealed: 'nebel_beacon' }, { elapsed: C.beaconAutoAt + 60 }, { not: { found: 'nebel_beacon' } }] },
          do: [{ oda: 'Leitbake: Taktik wählt sie mit T, fliegt auf ≤ 800 heran und hält S. Zwei Sekunden reichen.' }] },
        { if: { all: [{ revealed: 'nebel_beacon' }, { elapsed: C.beaconAutoAt + 200 }, { not: { found: 'nebel_beacon' } }] },
          do: [{ do: 'scanHidden', id: 'nebel_beacon' }] },
      ],
      objectives: [
        { id: 'findBeacon', text: 'Taktik: Weitscan (W) – Leitbake suchen', done: { revealed: 'nebel_beacon' } },
        { id: 'scanBeacon', text: 'Taktik: Leitbake anvisieren (T) und scannen (S halten)', show: { revealed: 'nebel_beacon' }, done: { found: 'nebel_beacon' } },
      ],
      next: [{ if: { found: 'nebel_beacon' }, goto: 'toRelais' }],
      skip: [{ do: 'scanHidden', id: 'nebel_beacon' }],
    },
    {
      id: 'toRelais',
      timers: [{ at: 1, oda: 'Kurs Kustoden-Relais – Captain, Sternkarte. Pylonen mit Frontschild erwarten uns. Vorher reparieren?' }],
      objectives: [{ id: 'toRelais', text: 'Captain: Kurs Kustoden-Relais (Sternkarte), Faltsprung', done: { atLocation: 'relais' } }],
      next: [{ if: { atLocation: 'relais' }, goto: 'relay' }],
      skip: [{ do: 'debugJump', loc: 'relais' }],
    },
    {
      id: 'relay', loc: 'relais', restartOnReturn: true,
      enter: [{ spawn: { kind: 'pylon', tag: 'pylon', face: 'out', atStation: [{ dx: -300, dy: -240 }, { dx: 340, dy: -40 }, { dx: -230, dy: 290 }] } }],
      timers: [
        { at: 1, oda: 'Drei Pylonen, Frontschild 4. Taktik: scannen und den Piloten an die Seite lotsen – Marker helfen!' },
        { at: 30, if: { not: { event: 'enemyScanned' } }, oda: 'Tipp: Pylon anvisieren, S halten – dann seht ihr, wo sein Schild ist. Von der Seite geht es schneller.' },
      ],
      rules: [
        // QA M1: nur am Relais (wer zwischendurch wegspringt, bekommt sonst Funk/ODA aus dem Nichts)
        { if: { all: [{ atLocation: 'relais' }, { any: [{ elapsed: 30 }, { killed: { kind: 'pylon', min: 1 } }] }] },
          do: [{ set: { sentinel: true } }, { spawn: { kind: 'sentinel', tag: 'waechter', atStation: [{ dx: 160, dy: 120 }] } },
            { oda: 'Ein Kustoden-Wächter erwacht! Seine EMP-Schüsse legen Systeme lahm – Schilde oben halten.' }] },
        { if: { all: [{ atLocation: 'relais' }, { v: 'sentinel' }, { enemiesLeft: { max: 0 } }, { not: { v: 'wave2' } }] },
          do: [{ set: { wave2: true } }, { radio: { from: 'Kustoden-Relais', text: '…FREMDE STIMME. PRÜFUNG BEGINNT.' } },
            { spawn: { kind: 'pylon', tag: 'pylon2', face: 'in', atStation: [{ dx: 0, dy: -330 }, { dx: 0, dy: 330 }] } },
            { oda: 'Das Relais prüft uns: zwei neue Pylonen – ihre Front zeigt zum Kern! Taktik: scannen, Pilot von außen ran.' }] },
        { if: { all: [{ atLocation: 'relais' }, { v: 'wave2' }, { enemiesLeft: { max: 0 } }] },
          do: [{ oda: 'Prüfung bestanden. Captain: nah an den Kern (≤ 460) und die Leertaste halten – 6 Sekunden.' }] },
      ],
      scan: { id: 'relaycore', label: 'Relaiskern', range: C.relayCoreRange, time: C.relayCoreScanTime, requires: { all: [{ v: 'wave2' }, { enemiesLeft: { max: 0 } }] }, blocked: 'Die Wächter des Relais stören den Scan – erst Pylonen und Wächter ausschalten.' },
      objectives: [
        { id: 'pylons', text: 'Pylonen ausschalten ({killed:pylon}/3) – von der Seite!', done: { all: [{ elapsed: 0.5 }, { enemiesLeft: { kind: 'pylon', max: 0 } }] } },
        { id: 'sentinel', text: 'Kustoden-Wächter abwehren', show: { v: 'sentinel' }, done: { all: [{ v: 'sentinel' }, { enemiesLeft: { kind: 'sentinel', max: 0 } }] } },
        { id: 'pylons2', text: 'Prüfung: Pylonen am Kern ausschalten ({left:pylon2} übrig) – von außen!', show: { v: 'wave2' }, done: { all: [{ v: 'wave2' }, { enemiesLeft: { tag: 'pylon2', max: 0 } }] } },
        { id: 'core', text: 'Captain: Relaiskern scannen (nah ran, Leertaste halten)', done: { scanDone: 'relaycore' } },
      ],
      next: [{ if: { scanDone: 'relaycore' }, goto: 'finale' }],
      skip: [{ do: 'killAll' }, { set: { sentinel: true, wave2: true } }, { do: 'markScan', id: 'relaycore' }],
    },
    {
      id: 'finale', loc: 'relais',
      enter: [
        { radio: { from: 'Kustoden-Relais', text: '…FRAGE ERKANNT. ANTWORT WIRD VORBEREITET. BITTE WARTEN, KLEINES SCHIFF…' } },
        { reward: { marks: 150 } },
        { log: 'Mission „Echo im Nebel“: Das Kustoden-Relais hat geantwortet. Fortsetzung folgt.', loc: 'relais' },
        { if: { flag: 'sharedEcho' }, after: { sec: 2, do: [{ radio: { from: GRAUZAHN, text: 'Lerche? Der ganze Nebel leuchtet! … Vielleicht sind Geister doch was für uns.' } }] } },
        { startTeaser: true },
        { after: { sec: 4, do: [{ oda: 'Das Relais antwortet uns. Ich glaube, wir haben gerade etwas sehr Großes geweckt.' }, { complete: true }] } },
      ],
      objectives: [{ id: 'listen', text: 'Dem Relais zuhören …', done: false }],
    },
  ],
  on: {},
  // M2 „Schildwall“: Kampagne geht weiter – Tesk bietet danach Mission 3 an (CONTRACT-M2 §3.2)
  onComplete: [{ startMission: 'm3' }],
  debugDone: [{ reveal: ['wrack', 'nebel', 'vaelen'], text: false }],
  debugPrep: {
    vaelen: [{ reveal: ['wrack', 'nebel', 'vaelen'], text: false }],
    sonde: [{ reveal: ['wrack', 'nebel', 'vaelen'], text: false }],
    parley: [{ reveal: ['wrack', 'nebel'], text: false }],
    nebelFlight: [{ reveal: ['wrack', 'nebel'], text: false }],
    ambush: [{ reveal: ['wrack', 'nebel'], text: false }],
    beacon: [{ reveal: ['wrack', 'nebel'], text: false }],
    toRelais: [{ reveal: ['wrack', 'nebel'], text: false }, { do: 'scanHidden', id: 'nebel_beacon' }],
    relay: [{ reveal: ['wrack', 'nebel'], text: false }, { do: 'scanHidden', id: 'nebel_beacon' }],
    finale: [{ reveal: ['wrack', 'nebel'], text: false }, { do: 'scanHidden', id: 'nebel_beacon' }],
  },
};
