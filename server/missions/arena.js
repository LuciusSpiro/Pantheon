'use strict';
// Pseudo-Mission „Testgelände: Raumkampf“ (Lobby-Start 'arena_space'). Die Wellen steuert server/sim/arena.js;
// hier steht nur die Zielanzeige ({arena} = „Welle n: … übrig“ bzw. Countdown). Kein Ende, kein Ende-Bildschirm.
// Nicht in MISSION_ORDER: taucht in der Missionsliste nicht auf.
module.exports = {
  id: 'arena_space',
  title: 'Testgelände: Raumkampf',
  steps: [
    {
      id: 'waves',
      timers: [
        { at: 2, oda: 'Allein? Steuer fliegt, Taktik schießt (T Ziel, 1/2 Feuer). Konsolen wechseln mit Esc und E.' },
      ],
      objectives: [
        { id: 'wave', text: '{arena}' },
        { id: 'hint', text: 'Captain: Schilde, Energie, Reaktor überladen ausprobieren', optional: true },
      ],
      skip: [{ do: 'arenaSkip' }],
    },
  ],
};
