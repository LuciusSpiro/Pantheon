'use strict';
// Mission 1 „Die stumme Boje“ als Daten (CONTRACT-M1 §9.3). Ablauf über Orte:
// Hafen (Übung optional) -> Splittergürtel (Bergung, Grauzahn) -> B-7 (Kampf, Relais-Scan, Außenmission, Entscheidung)
// -> zurück zum Hafen (Nachhut, Selas Notruf -> Vaelen bekannt) -> andocken -> Belohnung (Bojen-Trophäe), danach Mission 2.
// Bausteine siehe server/sim/mission.js (Bedingungen/Aktionen). ODA-Texte ≤ 120 Zeichen.

const TESK = 'Hafenmeisterin Tesk';
const GRAUZAHN = 'Grauzahn (Rostmeute)';

const radioTesk = { radio: { from: TESK, text: 'Lerche, hier Tesk. Boje B-7 ist verstummt – liegt hinter dem Splittergürtel. Seht nach, ja? Zahlung wie üblich.', accept: true } };
const notDrill = { not: { v: 'skip' } };
const drillOpen = { all: [notDrill, { not: { check: 'drillDone' } }] };
const repelled = { radio: { from: GRAUZAHN, text: 'Das… war nicht geplant. Wir sehen uns, Lerche!' } };

module.exports = {
  id: 'm1',
  title: 'Die stumme Boje',
  radioTesk,
  steps: [
    {
      id: 'dock', loc: 'hafen',
      enter: [{ do: 'drillSetup' }],
      timers: [
        { at: 0.5, oda: 'Guten Morgen, Crew der Lerche! Ich bin ODA, eure Bordintelligenz. Laufen: WASD oder Pfeiltasten.' },
        { at: 5, if: notDrill, oda: 'Andock-Rempler: Kabelbrand und Leck in der Messe, der Transfer ist hinüber. Die Schrauber machen Hafen-Check.' },
        { at: 11, if: drillOpen, oda: 'Lager oben links: E am Regal nimmt etwas – 1 Ersatzteil, 2 Löschgel, 3 Flickblech. G legt es ab.' },
        { at: 19, if: drillOpen, oda: 'Feuer: mit Löschgel davor E halten. Leck: mit Flickblech E halten. Kaputtes: Ersatzteil tragen, E halten.' },
        { at: 50, if: drillOpen, oda: 'Der Transfer steht in der Transferkammer unten links, Feuer und Leck sind in der Messe.' },
        { at: 95, if: drillOpen, oda: 'Kleiner Tipp: Zu zweit oder zu dritt teilt man sich die Übung auf. Allein dauert es halt etwas länger.' },
      ],
      rules: [
        { if: { all: [notDrill, { check: 'drillDone' }, { not: { v: 'radio' } }] },
          do: [{ set: { radio: true } }, { oda: 'Sauber! Genau so geht das im Ernstfall. Oh – ein Funkspruch. Ab auf die Brücke, Captain-Konsole!' },
            { after: { sec: 3, do: [radioTesk] } },
            { after: { sec: 25, do: [{ if: { not: { event: 'accepted' } }, oda: 'Der Funkspruch wartet: Captain-Konsole auf der Brücke, Reiter „Funk“, Enter.' }] } }] },
        { if: { all: [notDrill, { elapsed: 150 }, { not: { v: 'radio' } }] },
          do: [{ set: { radio: true } }, { oda: 'Die Übung holen wir später nach – da kommt ein Funkspruch rein. Captain-Konsole auf der Brücke!' },
            { after: { sec: 3, do: [radioTesk] } }] },
      ],
      objectives: [
        { id: 'drillFire', text: 'Übung: Löschgel holen (Lager), Kabelbrand in der Messe löschen', show: notDrill, done: { check: 'noFires' } },
        { id: 'drillBreach', text: 'Übung: Flickblech holen, Leck in der Messe flicken (E halten)', show: notDrill, done: { check: 'noBreaches' } },
        { id: 'drillRepair', text: 'Übung: Ersatzteil holen, Transfer reparieren (E halten)', show: notDrill, done: { check: { name: 'systemOk', system: 'transfer' } } },
        { id: 'captainConsole', text: 'Brücke: Captain-Konsole betreten (E)', show: { v: 'radio' }, done: { check: { name: 'consoleManned', console: 'captain' } } },
        { id: 'accept', text: 'Funkspruch annehmen', show: { v: 'radio' }, done: { event: 'accepted' } },
      ],
      onAccept: [{ reveal: 'b7', text: false }, { goto: 'undock' }],
      skip: [{ do: 'clearDrill' }, { do: 'forceRadio', from: TESK, text: 'Boje B-7 ist verstummt.' }, { do: 'acceptNow' }],
    },
    {
      id: 'undock', loc: 'hafen',
      timers: [
        { at: 0.5, oda: 'Auftrag angenommen! Steuerkonsole ganz vorn auf der Brücke: W gibt Schub und legt ab.' },
        { at: 5, oda: 'Captain: Sternkarte, Ziel „Splittergürtel“ – B-7 liegt dahinter. Gesprungen wird ab 300 px Abstand.' },
        { at: 30, if: { check: { name: 'players', max: 1 } }, oda: 'Wer am Steuer sitzt, kann nicht gleichzeitig Captain sein. Esc, rüberlaufen, E – Bordgymnastik.' },
        { at: 60, oda: 'Checkliste: abgelegt? Ziel Splittergürtel gewählt? 300 px Abstand? Dann F an der Steuer.' },
      ],
      objectives: [
        { id: 'undock', text: 'Steuer: ablegen (W)', done: { docked: false } },
        { id: 'destSplitter', text: 'Captain: Ziel Splittergürtel wählen (Sternkarte)', done: { any: [{ dest: 'splitter' }, { atLocation: 'splitter' }] } },
        { id: 'jump1', text: 'Steuer: Faltsprung (F)', done: { atLocation: 'splitter' } },
      ],
      next: [{ if: { atLocation: 'splitter' }, goto: 'route' }],
      skip: [{ do: 'debugJump', loc: 'splitter' }],
    },
    {
      id: 'route', loc: 'splitter',
      enter: [{ spawnSalvage: 3 }],
      timers: [
        { at: 0.5, oda: 'Faltsprung geglückt! B-7 liegt hinter dem Gürtel – aber erst das Bergungsgut.' },
        { at: 5, oda: 'Tesk meldet drei Bergungskisten im Feld (grün). Drüberfliegen sammelt sie ein. Taktik lotst!' },
        { at: 45, if: { not: { check: 'salvageDone' } }, oda: 'Die Kisten sind auf der Taktikkarte grün. Der Pilot sieht nur nach vorn – Taktik, Marker setzen!' },
      ],
      rules: [
        { if: { any: [{ check: { name: 'shipX', gt: 1500 } }, { check: 'salvageDone' }, { v: 'waived' }] },
          do: [{ set: { grauzahn: true } }, { radio: { from: GRAUZAHN, text: 'Hier Grauzahn. Die Boje gehört uns. Dreht um – oder zahlt Wegezoll.' } },
            { choice: 'grauzahn' }, { oda: 'Captain: Grauzahn wartet auf Antwort – Reiter „Funk“.' }] },
        { if: { all: [{ elapsed: 150 }, { not: { check: 'salvageDone' } }] },
          do: [{ set: { waived: true } }, { oda: 'Den Rest vom Bergungsgut lassen wir treiben. Vielleicht findet es jemand Bedürftigeres.' }] },
        { if: { all: [{ v: 'grauzahn' }, { elapsed: 40 }, { not: { choiceMade: 'grauzahn' } }] },
          do: [{ oda: 'Bestechen kostet 100 Marken. Kämpfen kostet Nerven. Beides ist legitim, sagt mein Handbuch.' }] },
      ],
      objectives: [
        { id: 'salvage', text: 'Bergungsgut im Feld einsammeln ({salvaged}/3)', done: { any: [{ check: 'salvageDone' }, { v: 'waived' }] } },
        { id: 'answer', text: 'Captain: auf Grauzahn antworten', show: { v: 'grauzahn' }, done: { choiceMade: 'grauzahn' } },
        { id: 'destB7', text: 'Captain: Ziel Boje B-7 wählen', done: { any: [{ dest: 'b7' }, { atLocation: 'b7' }] } },
        { id: 'jump2', text: 'Steuer: Faltsprung (F)', done: { atLocation: 'b7' } },
      ],
      choices: {
        grauzahn: {
          prompt: 'Grauzahn verlangt Wegezoll. Antwort?',
          options: [{ id: 'bribe', label: 'Bestechen (100 Marken)', disabledIf: { check: { name: 'marksBelow', n: 100 } } }, { id: 'fight', label: 'Kämpfen' }],
          on: {
            bribe: [{ do: 'pay', marks: 100 }, { setFlag: { bribed: true } }, { radio: { from: GRAUZAHN, text: 'Kluge Kleine. Fliegt weiter. Wir sehen nicht hin.' } },
              { oda: 'Bezahlt. Ob die Rostmeute Wort hält? Ich wette nicht. Weiter nach B-7.' }],
            fight: [{ setFlag: { bribed: false } }, { radio: { from: GRAUZAHN, text: 'Mutig. Dann treffen wir uns an der Boje.' } },
              { oda: 'Kampf also! Captain: Energie auf Schilde und Waffen. Dann Kurs B-7.' }],
          },
        },
      },
      jumpBlock: [
        { dest: 'b7', if: { not: { any: [{ check: 'salvageDone' }, { v: 'waived' }] } }, reason: 'Noch Bergungsgut im Feld – die Kisten sind grün markiert.' },
        { dest: 'b7', if: { not: { choiceMade: 'grauzahn' } }, reason: 'Captain: erst auf Grauzahn antworten.' },
      ],
      next: [{ if: { atLocation: 'b7' }, goto: 'combat' }],
      skip: [{ do: 'debugJump', loc: 'b7' }],
    },
    {
      id: 'combat', loc: 'b7',
      enter: [
        { if: { flag: { bribed: true } }, spawn: { kind: 'raider', angles: [0.3] } },
        { if: { flag: { bribed: true } }, after: { sec: 3, radio: { from: GRAUZAHN, text: 'Bezahlt hast du für die Durchfahrt, Kleine. Nicht fürs Ankommen.' } } },
        // M3a §15: ein Jäger ohne Staffelung (vorher zwei)
        { if: { not: { flag: { bribed: true } } }, spawn: { kind: 'raider', angles: [0.2] } },
        { if: { not: { flag: { bribed: true } } }, after: { sec: 3, radio: { from: GRAUZAHN, text: 'Da seid ihr ja. Mal sehen, wie lange eure Schilde halten.' } } },
      ],
      timers: [
        { at: 0.5, oda: 'Rostmeute auf dem Schirm! Taktik besetzen, Captain verteilt Schilde auf die bedrohte Seite.' },
        { at: 8, oda: 'Die Lerche feuert über die Seiten: Batterien backbord und steuerbord, vorn nur die Lanze. Pilot: Breitseite zum Gegner!' },
        { at: 15, oda: 'Taktik: Gegner anvisieren und S halten – der Scan zeigt Schilde und Feuerbögen.' },
        { at: 22, oda: 'Unbesetzte Taktik? Dann feuern die Waffen allein – mit halber Kraft. Besser als nichts.' },
        { at: 35, oda: 'Schäden? Die Schrauber reparieren selbst. Captain setzt im Reiter „Schäden“ Prioritäten.' },
      ],
      rules: [
        { if: { all: [{ elapsed: 40 }, { not: { event: 'fire' } }] }, do: [{ do: 'guaranteeFire' }] },
        { if: { all: [{ not: { flag: { bribed: true } } }, { any: [{ enemiesLeft: { max: 0 } }, { elapsed: 50 }] }] },
          do: [{ set: { gunboat: true } }, { spawn: { kind: 'gunboat', tag: 'gunboat' } },
            { radio: { from: GRAUZAHN, text: 'Genug gespielt. Das Kanonenboot übernimmt.' } },
            { after: { sec: 4, oda: 'Das Kanonenboot lädt seine Breitseite sichtbar auf. Captain: Schildstoß auf die Seite – Pilot: wegdrehen!' } },
            { do: 'breakShields', text: 'Kanonenboot! Seine erste Salve hat den Schildgenerator zerlegt – Ersatzteil, schnell!' }] },
        { if: { enemyHpBelow: { tag: 'gunboat', frac: 0.5 } },
          do: [{ do: 'guaranteeBreach', region: 3, text: 'Breitseite backbord – Hüllenbruch! Flickblech aus dem Lager, E halten.' }] },
        { if: { all: [{ flag: { bribed: true } }, { any: [{ elapsed: 25 }, { enemyHpBelow: { kind: 'raider', frac: 0.5 } }, { enemiesLeft: { max: 0 } }] }] },
          do: [{ set: { shieldBreak: true } }, { do: 'breakShields', text: 'Ein Treffer schlägt durch – Schildgenerator hinüber! Maschinenraum: E flickt, Ersatzteil repariert voll.' }] },
      ],
      objectives: [
        { id: 'repel', text: 'Rostmeute abwehren', done: false },
        { id: 'hintScan', text: 'Tipp: Taktik – Gegner scannen (S halten)', optional: true, done: { event: 'enemyScanned' } },
        { id: 'hintShields', text: 'Tipp: Captain – Schilde zur bedrohten Seite', optional: true, done: { event: 'shieldsChanged' } },
        { id: 'hintRepair', text: 'Tipp: Schäden reparieren (E halten) oder Bots machen lassen', optional: true, done: { event: 'repaired' } },
      ],
      next: [
        { if: { all: [{ v: 'gunboat' }, { enemiesLeft: { max: 0 } }] }, do: [repelled], goto: 'scan' },
        { if: { all: [{ flag: { bribed: true } }, { v: 'shieldBreak' }, { enemiesLeft: { max: 0 } }] }, do: [repelled], goto: 'scan' },
      ],
      skip: [{ do: 'killAll' }, { set: { gunboat: true } }],
    },
    {
      id: 'scan', loc: 'b7', restartOnReturn: true,
      enter: [{ spawn: { kind: 'relay', tag: 'relay', atStation: [{ dx: 157, dy: 66 }, { dx: -136, dy: 103 }, { dx: -21, dy: -169 }] } }],
      timers: [
        { at: 0.5, oda: 'Ruhe am Himmel. Gut gemacht! Jetzt zur Boje – die Markierung mitten in der Szene.' },
        { at: 6, oda: 'Drei Störrelais kreisen um die Boje und blockieren den Scan. Taktik: abschießen! Steuer: Bug drauf.' },
      ],
      rules: [
        { if: { all: [{ elapsed: 1 }, { enemiesLeft: { kind: 'relay', max: 0 } }] },
          do: [{ oda: 'Relais erledigt, der Weg ist frei! Captain: in Reichweite (420) die Leertaste halten – Scan.' }] },
      ],
      on: { enemyKilled: [{ if: { all: [{ evKind: 'relay' }, { not: { enemiesLeft: { kind: 'relay', max: 0 } } }] }, oda: 'Relais zerlegt! Noch {left:relay}.' }] },
      scan: { id: 'buoy', label: 'Boje B-7', range: 420, time: 5, requires: { enemiesLeft: { kind: 'relay', max: 0 } }, blocked: 'Störrelais stören den Scan – erst abschießen (Taktik).' },
      objectives: [
        { id: 'approach', text: 'Zur Boje fliegen', done: { near: { station: 420 } } },
        { id: 'relays', text: 'Taktik: Störrelais abschießen ({killed:relay}/3)', done: { all: [{ elapsed: 0.5 }, { enemiesLeft: { kind: 'relay', max: 0 } }] } },
        { id: 'scanDone', text: 'Captain: Boje scannen (Leertaste halten)', done: { scanDone: 'buoy' } },
      ],
      next: [{ if: { scanDone: 'buoy' }, do: [{ oda: 'Scan komplett: Kustoden-Signatur! Und ein schwaches Lebenszeichen auf der Plattform.' }], goto: 'away' }],
      skip: [{ do: 'killKind', kind: 'relay' }, { do: 'markScan', id: 'buoy' }],
    },
    {
      id: 'away', loc: 'b7', allowBeam: ['platform'],
      timers: [
        { at: 0.5, oda: 'Außenteam: auf die Transferpads (Kammer unten). Schiff ≤ 320 von der Boje, Tempo ≤ 30.' },
        { at: 6, oda: 'Beamen geht an der Transferkonsole – oder auf einem Pad E halten. Klappt auch solo.' },
        { at: 13, if: { not: { check: 'awayActive' } }, oda: 'Das Lebenszeichen klingt schwach. Ein Medipack aus dem Lager (Regal 5) mitzunehmen wäre klug.' },
        { at: 40, if: { all: [{ not: { check: 'awayActive' } }, { check: { name: 'players', max: 1 } }] }, oda: 'Ganz allein? Dann zeigt die Sonde nach 20 s ohne Menschen an Bord die Codetabelle selbst.' },
      ],
      rules: [
        { if: { check: 'nearInjuredNpc' }, do: [{ oda: 'Ivo ist verletzt. Ein Medipack hilft: mitbringen oder per Nachschub (Transfer) auf eine Markierung.' }] },
        { if: { check: { name: 'awaySince', sec: 90 } },
          do: [{ spawn: { kind: 'raider', tag: 'nachzuegler' } }, { oda: 'Ein Nachzügler der Rostmeute! Oben wird\'s ungemütlich – wer an Bord ist: Taktik!' }] },
        { if: { all: [{ check: 'awayActive' }, { not: { check: 'anyAway' } }, { itemAboard: 'datenkern' }, { not: { check: 'coreRebooted' } }] },
          do: [{ oda: 'Datenkern ist an Bord – aber B-7 schweigt noch. Jemand muss runter und den Bojenkern neu starten.' }] },
      ],
      on: {
        beamedUp: [
          { if: { not: { itemAboard: 'datenkern' } }, oda: 'Zurück an Bord – aber ohne Datenkern. Der liegt noch unten.', once: 'upNoCore' },
          { if: { all: [{ itemAboard: 'datenkern' }, { not: { check: 'coreRebooted' } }] }, oda: 'Kern an Bord, aber der Bojenkern ist noch aus. Ohne Neustart bleibt B-7 stumm.', once: 'upNoReboot' },
        ],
      },
      objectives: [
        { id: 'beamDown', text: 'Außenteam auf die Pads, Transfer auslösen', done: { check: 'awayActive' } },
        { id: 'sonde', text: 'Sonde abschalten', show: { check: 'awayActive' }, done: { check: 'sondeDisabled' } },
        { id: 'reboot', text: 'Bojenkern neu starten (E halten)', show: { check: 'awayActive' }, done: { check: 'coreRebooted' } },
        { id: 'core', text: 'Datenkern bergen', show: { check: 'awayActive' }, done: { itemAboard: 'datenkern' }, sticky: false },
        { id: 'npc', text: 'Techniker verarzten (Medipack) und retten', optional: true, show: { all: [{ check: 'awayActive' }, { check: 'npcInjured' }] }, done: { check: 'npcRescued' } },
        { id: 'npc', text: 'Techniker retten', optional: true, show: { all: [{ check: 'awayActive' }, { not: { check: 'npcInjured' } }] }, done: { check: 'npcRescued' } },
        { id: 'allBack', text: 'Alle zurück an Bord', show: { check: 'awayActive' }, done: { check: 'awayComplete' } },
      ],
      next: [{ if: { check: 'awayComplete' }, goto: 'decision' }],
      skip: [{ do: 'skipAway' }],
    },
    {
      id: 'decision', loc: 'b7',
      enter: [{ do: 'endAway' }, { choice: 'datenkern' }],
      timers: [{ at: 0.5, oda: 'Alle an Bord, Datenkern gesichert. Captain: Was machen wir damit? Reiter „Funk“.' }],
      choices: {
        datenkern: {
          prompt: 'Der Datenkern summt leise. Was tun wir damit?',
          options: [{ id: 'deliver', label: 'Ans Konkordat (+200)' }, { id: 'decode', label: 'Selbst entschlüsseln (+80, Spur zu den Kustoden)' }],
          on: {
            deliver: [{ setFlag: { decision: 'deliver' } }, { reward: { marks: 200 } }, { oda: 'Das Konkordat zahlt 200 Marken. Brav, ordentlich, ein bisschen langweilig.' }],
            decode: [{ setFlag: { decision: 'decode' } }, { reward: { marks: 80 } }, { oda: 'Ich entschlüssle im Hintergrund… Kustoden-Koordinaten! Das wird spannend. +80 Marken.' }],
          },
          after: [{ do: 'removeDatenkern' }, { log: 'B-7: Datenkern geborgen – Entscheidung getroffen.', loc: 'b7' }, { goto: 'return' }],
        },
      },
      objectives: [{ id: 'decide', text: 'Captain: über den Datenkern entscheiden', done: { choiceMade: 'datenkern' } }],
      skip: [{ do: 'choose', option: 'deliver' }],
    },
    {
      id: 'return', loc: 'b7',
      timers: [
        { at: 0.5, oda: 'Datenkern verstaut. Moment … Ortung achtern! Die Rostmeute ist noch nicht fertig mit uns.' },
        { at: 6, do: [
          { spawn: { kind: 'raider', tag: 'nachhut', crew: { 1: 1, 2: 2, 3: 2 }, behind: true } }, { set: { wave: true } },
          { if: { flag: { bribed: true } }, radio: { from: GRAUZAHN, text: 'Wegezoll galt für die Hinfahrt, Kleine. Die Rückfahrt kostet extra.' } },
          { if: { not: { flag: { bribed: true } } }, radio: { from: GRAUZAHN, text: 'Ihr habt meine Jungs blamiert. Die Nachhut verabschiedet euch persönlich.' } },
          { oda: 'Nachhut von achtern! Ihr Störsender blockiert den Faltsprung. Taktik besetzen, Schilde nach hinten!' }] },
      ],
      rules: [
        { if: { all: [{ v: 'wave' }, { enemiesLeft: { max: 0 } }] },
          do: [{ set: { waveDone: true } }, { radio: { from: GRAUZAHN, text: 'Schon gut, schon gut! Fliegt nach Hause, Lerche. Diesmal.' } },
            { oda: 'Störsender weg! Heimweg: über den Splittergürtel zum Hafen (Sternkarte).' },
            { after: { sec: 5, do: [{ do: 'selaCall' }] } }] },
      ],
      objectives: [
        { id: 'rearguard', text: 'Nachhut der Rostmeute abwehren', done: { v: 'waveDone' } },
        { id: 'vaelen', text: 'Notruf: bei der Vaelen-Karawane andocken (optional)', optional: true, show: { flag: 'selaCalled' }, done: { flag: 'vaelenHelped' } },
        { id: 'home', text: 'Heimflug: über den Splittergürtel zum Hafen', done: { atLocation: 'hafen' } },
      ],
      jumpBlock: [{ if: { not: { v: 'waveDone' } }, reason: 'Ortung läuft … Sprungantrieb wartet.' }],
      next: [{ if: { atLocation: 'hafen' }, goto: 'port' }],
      skip: [{ do: 'killAll' }, { do: 'selaCall' }, { do: 'debugJump', loc: 'hafen' }],
    },
    {
      id: 'port', loc: 'hafen',
      timers: [
        { at: 0.5, oda: 'Zuhause! Steuer: langsam in den Dock-Ring neben der Station. Unter 28 px/s docke ich an.' },
        { at: 40, if: { docked: false }, oda: 'Andock-Tipp: S bremst. Kurz vor dem Ring fast stehen, dann übernehme ich.' },
      ],
      objectives: [
        { id: 'dock', text: 'Steuer: im Hafen andocken (langsam in den Ring)', done: { docked: 'hafen' } },
        // QA M1: Selas Notruf bleibt auch zu Hause sichtbar (vorher nur im Rückflug-Schritt)
        { id: 'vaelen', text: 'Notruf: bei der Vaelen-Karawane andocken (optional)', optional: true, show: { flag: 'selaCalled' }, done: { flag: 'vaelenHelped' } },
      ],
      next: [{
        if: { docked: 'hafen' },
        do: [{ radio: { from: TESK, text: 'Willkommen zurück, Lerche. B-7 sendet wieder – sauber gemacht. Hier, eine Kleinigkeit für die Vitrine.' } },
          { reward: { deko: ['trophaee_boje'] } }, { log: 'Mission „Die stumme Boje“ abgeschlossen. Belohnung: Bojen-Trophäe.', loc: 'hafen' },
          { oda: 'Angedockt! Die Bojen-Trophäe liegt im Inventar – an der eigenen Koje aufstellen. Terminal ist offen.' }],
        complete: true,
      }],
      skip: [{ do: 'debugDock' }],
    },
  ],
  // Missionsweite Ereignisse
  on: {
    sondeDisabled: [{ oda: 'Sonde aus, Drohnen schlafen, Tür offen. Datenkern rechts unten, der Bojenkern steht mitten im Saal.', once: 'sondeOff' }],
    datenkernTaken: [{ oda: 'Datenkern geborgen! Er summt. Das ist entweder gut oder sehr schlecht.', once: 'coreTaken' }],
    coreRebooted: [{ reward: { marks: 40 } }, { radio: { from: TESK, text: 'Lerche? B-7 sendet wieder! Tesk dankt – 40 Marken Bonus sind unterwegs.' } }, { do: 'spawnGuards' }],
    npcRescued: [{ reward: { marks: 50 } }, { setFlag: { technikerRescued: true } }, { oda: 'Ivo ist an Bord! Er bringt 50 Marken Finderlohn mit. Und Kekse. Er zieht ins Gästequartier.' }],
    nachzueglerHit: [{ do: 'damage', system: 'transfer', state: 'broken' }, { oda: 'Treffer im Transferraum – Transfer ausgefallen! Bots holen ein Ersatzteil.', once: 'transferBroken' }],
    weaponsFired: [],
  },
  onComplete: [{ startMission: 'm2' }],
  // Debug: Voraussetzungen, wenn direkt in einen Schritt gesprungen wird
  debugPrep: {
    undock: [{ reveal: 'b7', text: false }],
    route: [{ reveal: 'b7', text: false }],
    combat: [{ reveal: 'b7', text: false }, { if: { flag: { bribed: null } }, setFlag: { bribed: false } }],
    scan: [{ reveal: 'b7', text: false }, { if: { flag: { bribed: null } }, setFlag: { bribed: false } }],
    away: [{ reveal: 'b7', text: false }, { do: 'markScan', id: 'buoy' }, { if: { flag: { bribed: null } }, setFlag: { bribed: false } }],
    decision: [{ reveal: 'b7', text: false }, { do: 'markScan', id: 'buoy' }, { do: 'skipAway' }, { if: { flag: { bribed: null } }, setFlag: { bribed: false } }],
    return: [{ reveal: 'b7', text: false }, { do: 'markScan', id: 'buoy' }, { if: { flag: { bribed: null } }, setFlag: { bribed: false } }, { if: { flag: { decision: null } }, setFlag: { decision: 'deliver' } }],
    port: [{ reveal: 'b7', text: false }, { if: { flag: { bribed: null } }, setFlag: { bribed: false } }, { if: { flag: { decision: null } }, setFlag: { decision: 'deliver' } }],
  },
  debugDone: [{ reveal: 'b7', text: false }, { setFlag: { bribed: false, decision: 'deliver' } }, { reward: { deko: ['trophaee_boje'] } }],
};
