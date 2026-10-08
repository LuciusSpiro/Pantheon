'use strict';
// Pseudo-Mission „Testgelände: Raumkampf“ (Lobby-Start 'arena_space'). Die Wellen steuert server/sim/arena.js;
// hier steht nur die Zielanzeige ({arena} = „Welle n: … übrig“ bzw. Countdown). Kein Ende, kein Ende-Bildschirm.
// S1 (Wahl ENGINE): bleibt ein JS-Modul mit Art 'intern' (kein Regiebuch, kein Weltstand, nicht in der Missionsliste);
// skip nutzt den internen Baustein debug_arena_skip aus server/mission/registry.js.
module.exports = {
  id: 'arena_space',
  title: 'Testgelände: Raumkampf',
  kopf: { art: 'intern' },
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
      skip: [{ do: 'debug_arena_skip' }],
    },
  ],
};
