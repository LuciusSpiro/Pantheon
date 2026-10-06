'use strict';
// Mission 3 „Die Tafel von Kesh“ als Daten (CONTRACT-M2 §3.2). Start nach Mission 2 (Funk Tesk) oder per Lobby-Direktstart.
// Hafen -> Mond Kesh (Außenteam unten, Captain an Bord) -> Hof der Ruine (Trupp 1, optional 2 Störrelais) -> Archivhalle
// (Ruhe: zwei Archivschlüssel gleichzeitig) -> Gewölbe (Tafel direkt ins Inventar) -> Wächter erwacht + Trupp 2 (Zange)
// -> Nachhut im Hof -> zurück zu den Pads und hochbeamen. Notrückholung setzt den Schritt nicht zurück.
// Kampf v2: server/sim/combat.js + squad.js. ODA-Texte ≤ 120 Zeichen.

const TESK = 'Hafenmeisterin Tesk';
const M = require('../../shared/config.js').missionM3;

const radioOffer = { radio: { from: TESK, text: 'Lerche, hier Tesk. Plünderer graben auf Mond Kesh in einem Kustoden-Archiv. Dort liegt eine Vertragstafel – die darf nicht verkauft werden. Holt sie?', accept: true } };

module.exports = {
  id: 'm3',
  title: 'Die Tafel von Kesh',
  steps: [
    {
      id: 'briefing',
      timers: [
        { at: M.offerDirectAt, if: { flag: 'm3Direct' }, do: [{ set: { offer: true } },
          { oda: 'Direkt zur Planetenmission! Wir liegen im Hafen. Captain: Funk annehmen, dann Kurs Mond Kesh.' }, radioOffer] },
        { at: M.offerAfter, if: { not: { flag: 'm3Direct' } }, do: [{ set: { offer: true } }, radioOffer] },
        { at: M.offerAfter + 30, if: { not: { event: 'accepted' } }, oda: 'Tesk wartet auf Antwort: Captain-Konsole, Reiter „Funk“, Enter.' },
      ],
      objectives: [{ id: 'accept', text: 'Captain: Funkspruch von Tesk annehmen', show: { v: 'offer' }, done: { event: 'accepted' } }],
      onAccept: [
        { do: 'revealKesh', text: 'Mond Kesh ist auf der Sternkarte – direkt vom Hafen oder vom Splittergürtel aus.' },
        { radio: { from: TESK, text: 'Danke. Die Plünderer sind gut bewaffnet, aber schlecht organisiert. Nehmt Medipacks mit – und bringt alle heil zurück.' } },
        { goto: 'flight' }],
      skip: [{ do: 'forceRadio', from: TESK, text: 'Plünderer auf Kesh. Holt die Tafel.' }, { do: 'acceptNow' }],
    },
    {
      id: 'flight',
      timers: [
        { at: 3, oda: 'Kurs Mond Kesh: Captain wählt das Ziel auf der Sternkarte, Steuer springt mit F.' },
        { at: 12, oda: 'Unten zählt der Schild in Segmenten. Ohne Schild macht ein Treffer euch verwundet – nicht tot.' },
        { at: 24, oda: 'Deckung wirkt nur in Richtung des Schützen. Mauerreste schlucken viel – von der Seite nichts.' },
        { at: 120, if: { not: { atLocation: 'kesh' } }, oda: 'Kesh liegt gleich beim Hafen. Captain: Sternkarte, Ziel Kesh. Steuer: F.' },
      ],
      rules: [
        { if: { all: [{ atLocation: 'kesh' }, { not: { check: 'keshTeamDown' } }] },
          do: [{ oda: 'Kesh! Steuer: auf ≤ 360 an den Mond und langsam. Außenteam auf die Pads, der Captain bleibt oben.' }] },
        { if: { all: [{ atLocation: 'kesh' }, { elapsed: 90 }, { not: { check: 'keshTeamDown' } }] },
          do: [{ oda: 'Tipp: Transferkammer unten links an Bord. Auf die Pads stellen, E halten – oder Transfer-Konsole.' }] },
      ],
      objectives: [
        { id: 'toKesh', text: 'Zum Mond Kesh fliegen', done: { atLocation: 'kesh' } },
        { id: 'beam', text: 'Außenteam runterbeamen (Captain bleibt an Bord)', show: { atLocation: 'kesh' }, done: { check: 'keshTeamDown' } },
      ],
      next: [{ if: { check: 'keshTeamDown' }, goto: 'courtyard' }],
      skip: [{ do: 'debugJump', loc: 'kesh' }],
    },
    {
      id: 'courtyard', loc: 'kesh',
      enter: [{ do: 'spawnSquad', squad: 'squad1' }],
      timers: [
        { at: 2, oda: 'Plünderer im Hof der Ruine, hinterm Südtor. Deckung suchen, Schilde laden lassen, zusammen vorrücken.' },
        { at: 8, radio: { from: TESK, text: 'Die Plünderer haben Störrelais in den Gängen. Solange die laufen, sieht euer Captain nur Rauschen.' } },
        { at: 40, oda: 'Captain: Reiter „Außenteam“ – Befehle setzen, Sensor und Kuppel. Ihr seid die Augen von oben.' },
      ],
      objectives: [
        { id: 'squad1', text: 'Plünderer im Hof ausschalten ({awayLeft:squad1} übrig) – oder weiter in die Halle',
          done: { any: [{ check: { name: 'squadCleared', squad: 'squad1' } }, { check: 'playerInHall' }] } },
        { id: 'jammers', text: 'Störrelais in den Gängen abschalten ({jammersOff}/2)', optional: true, done: { check: 'jammersAllOff' } },
      ],
      next: [{ if: { any: [{ check: { name: 'squadCleared', squad: 'squad1' } }, { check: 'playerInHall' }] }, goto: 'archive' }],
      skip: [{ do: 'killSquad', squad: 'squad1' }],
    },
    {
      id: 'archive', loc: 'kesh',
      enter: [{ oda: 'Ruhe. Zwei Archivschlüssel, weit auseinander: beide gleichzeitig E halten, dann öffnet das Tor.' }],
      timers: [
        { at: 5, radio: { from: TESK, text: 'Die Kustoden bauten für Paare. Einer allein kommt da nicht rein – das war Absicht.' } },
        { at: 60, if: { not: { check: 'vaultOpen' } }, oda: 'Ein Schlüssel oben an der Hallenwand, einer unten rechts am Gewölbe. Anzählen, dann beide E!' },
      ],
      objectives: [
        { id: 'keys', text: 'Beide Archivschlüssel gleichzeitig halten (E)', done: { check: 'vaultOpen' } },
        { id: 'jammers', text: 'Störrelais abschalten ({jammersOff}/2)', optional: true, done: { check: 'jammersAllOff' } },
      ],
      next: [{ if: { check: 'vaultOpen' }, goto: 'tablet' }],
      skip: [{ do: 'openVault' }],
    },
    {
      id: 'tablet', loc: 'kesh',
      enter: [{ oda: 'Das Tor ist offen! Die Tafel liegt im Gewölbe – E halten, dann ist sie direkt im Inventar.' }],
      objectives: [{ id: 'tablet', text: 'Die Vertragstafel bergen (E halten)', done: { check: 'tabletTaken' } }],
      next: [{ if: { check: 'tabletTaken' }, goto: 'warden' }],
      skip: [{ do: 'takeTablet' }],
    },
    {
      id: 'warden', loc: 'kesh',
      enter: [
        { do: 'wakeWarden' }, { do: 'spawnSquad', squad: 'squad2', alert: true },
        { oda: 'Der Wächter erwacht! Vorn hält sein Schild alles ab – von der Seite oder hinten treffen. Und dann raus!' },
        { after: { sec: 4, do: [{ radio: { from: TESK, text: 'Lerche, das Camp hat euch gehört! Sie kommen durch beide Gänge – passt auf eure Flanken auf.' } }] } }],
      objectives: [
        { id: 'out', text: 'Mit der Tafel zurück in den Hof', done: { check: 'tabletInCourtyard' } },
        { id: 'warden', text: 'Den Wächter ausschalten (Belohnung)', optional: true, done: { flag: 'wardenKilled' } },
      ],
      next: [{ if: { any: [{ check: 'tabletInCourtyard' }, { elapsed: M.wardenStepMax }] }, goto: 'extract' }],
      skip: [{ do: 'killSquad', squad: 'squad2' }],
    },
    {
      id: 'extract', loc: 'kesh',
      enter: [{ do: 'spawnSquad', squad: 'rearguard' }, { oda: 'Nachhut im Hof! Durch zum Südtor, dann zu den Pads und hochbeamen.' }],
      timers: [{ at: 45, oda: 'Die Pads liegen unten links in der Landezone. Draufstellen und E halten – ich hole euch.' }],
      objectives: [{ id: 'extract', text: 'Alle zurück an Bord (Pads, hochbeamen)', done: { check: 'keshExtracted' } }],
      next: [{
        if: { check: 'keshExtracted' },
        do: [{ do: 'm3Reward', key: 'complete' },
          { radio: { from: TESK, text: 'Ihr habt die Tafel? Dann bleibt sie, wo sie hingehört. Danke, Lerche – 120 Marken sind unterwegs.' } },
          { log: 'Mission „Die Tafel von Kesh“: Vertragstafel geborgen und sicher an Bord.', loc: 'kesh' }],
        complete: true,
      }],
      skip: [{ do: 'keshRecallAll' }],
    },
  ],
  on: {
    jammerOff: [{ do: 'm3Reward', key: 'jammer' }, { do: 'reliefSquad' }],   // QA M2: erstes Relais aus -> Verstärkung
    wardenKilled: [{ do: 'm3Reward', key: 'warden' }],
  },
  onComplete: [{ end: true, title: 'Die Tafel ist sicher', text: 'Die Vertragstafel der Kustoden ist an Bord der Lerche. Was darauf steht? Fortsetzung folgt.' }],
  debugPrep: {
    briefing: [],
    flight: [{ do: 'revealKesh' }],
    courtyard: [{ do: 'revealKesh' }],
    archive: [{ do: 'revealKesh' }, { do: 'm3Prep', upTo: 'archive' }],
    tablet: [{ do: 'revealKesh' }, { do: 'm3Prep', upTo: 'tablet' }],
    warden: [{ do: 'revealKesh' }, { do: 'm3Prep', upTo: 'warden' }],
    extract: [{ do: 'revealKesh' }, { do: 'm3Prep', upTo: 'extract' }],
  },
};
