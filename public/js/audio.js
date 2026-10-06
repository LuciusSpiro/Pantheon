/* Sternenschicht – Audio (Team AUDIO)
 * Globales Objekt GameAudio nach CONTRACT §11. Reine WebAudio-Synthese, keine Samples,
 * keine externen Dateien, klassisches Skript (kein ES-Modul).
 *
 * Vor init() ist jede Funktion ein No-op (wirft nie). setMusic/setIntensity/setLoop/
 * setVolume/mute merken sich vor init() nur den Wunschzustand; init() setzt ihn dann um.
 * Abgefangene Fehler werden in GameAudio.errors gezählt und (gedrosselt) per console.warn geloggt.
 *
 * Signalfluss:
 *   musicBus -> duck -> mix      (duck = Sidechain-artiges Ducking bei lauten Ereignissen)
 *   sfxBus   ------- -> mix
 *   loopBus  ------- -> mix -> Kompressor -> Soft-Clipper (Limiter) -> master (Lautstärke/Mute) -> Ausgang
 */
(function (global) {
  'use strict';

  var SOUNDS = ['ui_click', 'ui_back', 'console_on', 'console_off', 'step', 'pickup', 'drop',
    'repair_tick', 'repair_done', 'extinguish', 'patch', 'shield_hit', 'hull_hit',
    'explosion_small', 'explosion_big', 'lanze', 'bolzen', 'seitenturm', 'dodge', 'jump_charge',
    'jump', 'alarm_yellow', 'alarm_red', 'beam', 'oda_blip', 'radio', 'blaster', 'drone_shot',
    'drone_die', 'code_ok', 'code_fail', 'buy', 'strike', 'error', 'emergency', 'bot_beep',
    'heal', 'door',
    // M1
    'phase', 'scan_tick', 'scan_done', 'widescan', 'marker_set', 'overload_start', 'overload_warn',
    'reactor_down', 'reactor_up', 'switch_hold', 'discovery', 'salvage', 'emp', 'pylon_down',
    'trade', 'table_sit', 'lore',
    // M2 „Schildwall“ (shield_hit steht oben, nimmt jetzt optional seg/max)
    'shield_break', 'shield_up', 'shield_full', 'wounded', 'revive_done', 'pistol', 'enemy_aim', 'enemy_shot',
    'warden_wake', 'warden_aim', 'warden_shot', 'warden_deflect', 'cover_hit', 'jammer_off', 'archkey',
    'vault_open', 'tablet', 'bark', 'order', 'squad_recall'];
  var LOOPS = ['fire', 'breach', 'engine', 'reactor_hum'];
  var MOODS = ['ship', 'explore', 'combat', 'port', 'mystery', 'ruin', 'none'];

  var MAX_VOICES = 64;          // weiche Obergrenze gleichzeitiger Quellen
  var LOOKAHEAD = 0.2;          // s, Musik-Scheduler plant so weit voraus
  var TIMER_MS = 25;            // Weckintervall des Schedulers (nur Wecker, Timing kommt aus ctx.currentTime)
  var FADE = 1.5;               // s, Crossfade zwischen Musikstimmungen

  // Mindestabstand je Sound in ms (Rate-Limit gegen Lärmteppich bei 3 Spielern)
  var MIN_GAP = {
    step: 120, repair_tick: 90, ui_click: 40, ui_back: 60, shield_hit: 70, hull_hit: 90,
    explosion_small: 70, explosion_big: 200, alarm_yellow: 900, alarm_red: 900, emergency: 900,
    beam: 600, jump_charge: 800, jump: 800, radio: 300, oda_blip: 150, bot_beep: 180,
    door: 150, blaster: 60, drone_shot: 70, seitenturm: 120, lanze: 150, bolzen: 120,
    code_ok: 120, code_fail: 120, buy: 120, error: 150, extinguish: 250, heal: 200,
    pickup: 80, drop: 80, patch: 150, strike: 70, console_on: 120, console_off: 120,
    dodge: 150, drone_die: 80, repair_done: 250,
    // M1
    phase: 90, scan_tick: 70, scan_done: 300, widescan: 1500, marker_set: 120, overload_start: 1500,
    overload_warn: 700, reactor_down: 1500, reactor_up: 1500, switch_hold: 250, discovery: 800,
    salvage: 200, emp: 400, pylon_down: 400, trade: 200, table_sit: 300, lore: 1500,
    // M2
    shield_break: 150, shield_up: 60, shield_full: 400, wounded: 300, revive_done: 400, pistol: 60,
    enemy_aim: 90, enemy_shot: 60, warden_wake: 2000, warden_aim: 400, warden_shot: 200, warden_deflect: 90,
    cover_hit: 70, jammer_off: 400, archkey: 300, vault_open: 2000, tablet: 800, bark: 250, order: 150, squad_recall: 1500
  };
  var DEFAULT_GAP = 50;

  // Basispegel je Sound (Alarme und Treffer vorne im Mix)
  var LEVEL = {
    alarm_yellow: 1.1, alarm_red: 1.25, emergency: 1.2, hull_hit: 1.3, shield_hit: 1.15,
    explosion_big: 1.3, explosion_small: 1.1, step: 0.75, repair_tick: 0.9, ui_click: 0.8,
    overload_start: 1.1, overload_warn: 1.05, emp: 1.1, scan_tick: 0.8, table_sit: 0.9,
    // M2
    enemy_aim: 1.3, warden_aim: 1.2, shield_break: 1.15, wounded: 1.15, squad_recall: 1.1, warden_shot: 1.1,
    cover_hit: 0.9, pistol: 0.9
  };
  // Ducking der Musik: [Zielpegel, Haltezeit s]
  var DUCK = {
    shield_hit: [0.55, 0.25], hull_hit: [0.35, 0.4], explosion_small: [0.55, 0.3],
    explosion_big: [0.25, 0.9], alarm_red: [0.45, 0.9], alarm_yellow: [0.7, 0.6],
    emergency: [0.4, 0.9], jump: [0.45, 0.9], bolzen: [0.7, 0.2], beam: [0.75, 1.2],
    // M1
    widescan: [0.75, 0.8], overload_start: [0.55, 1.0], overload_warn: [0.75, 0.4], reactor_down: [0.6, 1.2],
    reactor_up: [0.7, 1.2], discovery: [0.6, 1.0], emp: [0.45, 0.6], pylon_down: [0.6, 0.5], lore: [0.65, 1.6],
    // M2
    shield_break: [0.45, 0.5], wounded: [0.45, 1.0], enemy_aim: [0.65, 0.7], warden_aim: [0.55, 1.3],
    warden_wake: [0.4, 2.0], warden_shot: [0.5, 0.5], vault_open: [0.5, 2.4], squad_recall: [0.45, 1.6],
    tablet: [0.65, 1.0]
  };
  // Sounds, die die Stimmen-Obergrenze ignorieren dürfen
  var PRIORITY = { alarm_yellow: 1, alarm_red: 1, emergency: 1, hull_hit: 1, shield_hit: 1, explosion_big: 1,
    overload_start: 1, overload_warn: 1, reactor_down: 1, emp: 1,
    // M2: Warntöne und Schildzustand müssen immer durchkommen
    enemy_aim: 1, warden_aim: 1, shield_break: 1, wounded: 1, squad_recall: 1, warden_wake: 1 };

  var GA = {
    errors: 0,
    ready: false,
    supported: !!(global.AudioContext || global.webkitAudioContext),
    SOUNDS: SOUNDS.slice(),
    LOOPS: LOOPS.slice(),
    MOODS: MOODS.slice()
  };

  var ac = null;     // aktuell bespielter Kontext (live oder Offline-Test)
  var bus = null;    // Busse zum aktuellen Kontext
  var live = null;   // { ctx, bus }
  var state = { volume: 0.8, muted: false, mood: 'none', intensity: 0, loops: {} };
  var lastPlay = {};
  var voices = 0;
  var warnCount = 0;
  var music = { cur: null, timer: null };
  var loops = {};

  // ---------------------------------------------------------------- Hilfen
  function fail(where, e) {
    GA.errors++;
    if (warnCount < 25) {
      warnCount++;
      try { console.warn('[GameAudio] ' + where + ': ' + (e && e.message ? e.message : e)); } catch (_) { /* nichts */ }
    }
  }
  function safe(where, fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) { fail(where, e); }
    };
  }
  function clamp(x, a, b) { x = +x; if (!isFinite(x)) x = a; return x < a ? a : (x > b ? b : x); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function pos(v) { return Math.max(0.0001, v); }
  function hrand(a, b) { var x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }
  function isLive() { return live && ac === live.ctx; }
  function later(fn, ms) { if (isLive()) setTimeout(function () { try { fn(); } catch (e) { fail('cleanup', e); } }, ms); }
  function disc(nodes) { for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (_) { /* schon getrennt */ } } }

  function finish(src, nodes) {
    var counted = isLive();
    if (counted) voices++;
    src.onended = function () { if (counted) voices = Math.max(0, voices - 1); disc(nodes); };
  }

  // Ressourcen je Kontext (Puffer, PeriodicWave sind kontextgebunden)
  function res() {
    if (ac.__gaRes) return ac.__gaRes;
    var r = {}, sr = ac.sampleRate, i, d;
    r.noise = ac.createBuffer(1, Math.floor(sr * 2), sr);
    d = r.noise.getChannelData(0);
    for (i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Feuer-Knistern: leises Grollen + verstreute Knackser, 3 s, nahtlos loopbar genug
    r.crackle = ac.createBuffer(1, Math.floor(sr * 3), sr);
    d = r.crackle.getChannelData(0);
    var lp = 0;
    for (i = 0; i < d.length; i++) { lp += 0.02 * ((Math.random() * 2 - 1) - lp); d[i] = lp * 2.2; }
    var pops = 75;
    for (var p = 0; p < pops; p++) {
      var at = Math.floor(Math.random() * (d.length - sr * 0.02));
      var len = Math.floor(sr * (0.002 + Math.random() * 0.01));
      var amp = 0.25 + Math.random() * 0.6;
      for (var k = 0; k < len; k++) d[at + k] += (Math.random() * 2 - 1) * amp * Math.exp(-6 * k / len);
    }

    // Pulswelle 25 %
    var n = 40, re = new Float32Array(n), im = new Float32Array(n);
    for (i = 1; i < n; i++) re[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * 0.25);
    r.pulse = ac.createPeriodicWave(re, im);

    // Soft-Clipper-Kurve (tanh) als Limiter-Sicherung
    var c = new Float32Array(2048);
    for (i = 0; i < c.length; i++) { var x = (i / (c.length - 1)) * 2 - 1; c[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
    r.clipCurve = c;
    ac.__gaRes = r;
    return r;
  }

  function buildChain(ctx, raw) {
    var b = {};
    b.master = ctx.createGain();
    b.comp = ctx.createDynamicsCompressor();
    b.comp.threshold.value = -16; b.comp.knee.value = 10; b.comp.ratio.value = 6;
    b.comp.attack.value = 0.004; b.comp.release.value = 0.22;
    b.mix = ctx.createGain(); b.mix.gain.value = 0.8;
    b.music = ctx.createGain(); b.music.gain.value = 0.42;
    b.duck = ctx.createGain(); b.duck.gain.value = 1;
    b.sfx = ctx.createGain(); b.sfx.gain.value = 0.85;
    b.loop = ctx.createGain(); b.loop.gain.value = 0.55;
    b.music.connect(b.duck); b.duck.connect(b.mix);
    b.sfx.connect(b.mix); b.loop.connect(b.mix);
    b.mix.connect(b.comp);
    if (raw) {
      b.comp.connect(b.master);
    } else {
      b.clip = ctx.createWaveShaper();
      var prev = ac; ac = ctx; b.clip.curve = res().clipCurve; ac = prev;
      b.clip.oversample = '2x';
      b.comp.connect(b.clip); b.clip.connect(b.master);
    }
    b.master.connect(ctx.destination);
    return b;
  }

  function applyMaster() {
    if (!live) return;
    var g = live.bus.master.gain, t = live.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(state.muted ? 0 : state.volume, t + 0.08);
  }

  // Hüllkurve: Anstieg a, Halten hold, exponentieller Abfall bis t+dur
  function env(p, t, a, peak, dur, hold) {
    hold = hold || 0;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(pos(peak), t + a);
    if (hold) p.setValueAtTime(pos(peak), t + a + hold);
    p.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, a + hold + 0.01));
  }

  function addFilter(o, t, dur, nodes) {
    var f = ac.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.ff || 1000, t);
    if (o.ff2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.ff2), t + (o.fglide || dur));
    f.Q.value = o.q == null ? 0.8 : o.q;
    nodes.push(f);
    return f;
  }

  // Oszillator-Ton. o: {type|wave, f, f2, glide, lin, t, dur, a, hold, vol, out, detune, filter, ff, ff2, q}
  function tone(o) {
    var t = o.t, dur = o.dur, a = o.a || 0.004;
    var osc = ac.createOscillator(), g = ac.createGain(), nodes = [osc, g];
    if (o.wave) osc.setPeriodicWave(o.wave); else osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) {
      if (o.lin) osc.frequency.linearRampToValueAtTime(o.f2, t + (o.glide || dur));
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.glide || dur));
    }
    if (o.detune) osc.detune.value = o.detune;
    env(g.gain, t, a, o.vol, dur, o.hold);
    if (o.filter) { var f = addFilter(o, t, dur, nodes); osc.connect(f); f.connect(g); } else osc.connect(g);
    g.connect(o.out);
    osc.start(t); osc.stop(t + dur + 0.05);
    finish(osc, nodes);
    return dur;
  }

  // Gefiltertes Rauschen. o: {t, dur, a, hold, vol, out, filter, ff, ff2, q, rate}
  function noise(o) {
    var t = o.t, dur = o.dur, a = o.a || 0.002;
    var src = ac.createBufferSource(), g = ac.createGain(), nodes = [src, g];
    src.buffer = res().noise; src.loop = true;
    src.playbackRate.value = o.rate || 1;
    o.filter = o.filter || 'lowpass';
    var f = addFilter(o, t, dur, nodes);
    env(g.gain, t, a, o.vol, dur, o.hold);
    src.connect(f); f.connect(g); g.connect(o.out);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    finish(src, nodes);
    return dur;
  }

  // Zwei-Operator-FM. o: {f, ratio, index, index2, t, dur, a, vol, out, hold}
  function fm(o) {
    var t = o.t, dur = o.dur, a = o.a || 0.003;
    var car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
    car.frequency.setValueAtTime(o.f, t);
    mod.frequency.setValueAtTime(o.f * o.ratio, t);
    mg.gain.setValueAtTime(pos(o.f * o.index), t);
    mg.gain.exponentialRampToValueAtTime(pos(o.f * (o.index2 == null ? 0.02 : o.index2)), t + (o.iglide || dur));
    mod.connect(mg); mg.connect(car.frequency);
    car.connect(g); g.connect(o.out);
    env(g.gain, t, a, o.vol, dur, o.hold);
    car.start(t); mod.start(t);
    car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
    finish(car, [car, mod, mg, g]);
    return dur;
  }

  // E-Piano-artig: Sinus + leichte FM + kurzer "Tine"-Anschlag
  function epiano(f, t, dur, vol, out) {
    fm({ f: f, ratio: 1, index: 1.3, index2: 0.08, iglide: 0.6, t: t, dur: dur, a: 0.006, vol: vol, out: out });
    tone({ f: f * 4, t: t, dur: 0.12, a: 0.002, vol: vol * 0.12, out: out });
  }

  function click(t, out, vol, ff) {
    noise({ t: t, dur: 0.02, vol: vol, out: out, filter: 'bandpass', ff: ff || 2600, q: 2.5 });
    tone({ type: 'square', f: 140, t: t, dur: 0.015, vol: vol * 0.3, out: out, filter: 'lowpass', ff: 1200 });
  }

  // ---------------------------------------------------------------- SFX
  // Jede Funktion bekommt Startzeit t und Ausgangsknoten o, gibt die Dauer zurück.
  var SFX = {
    ui_click: function (t, o) {
      tone({ type: 'square', f: 1800, f2: 1200, t: t, dur: 0.035, vol: 0.12, out: o, filter: 'lowpass', ff: 4000 });
      noise({ t: t, dur: 0.012, vol: 0.12, out: o, filter: 'highpass', ff: 5000 });
      return 0.05;
    },
    ui_back: function (t, o) {
      tone({ type: 'triangle', f: 900, f2: 480, t: t, dur: 0.1, vol: 0.28, out: o });
      return 0.12;
    },
    console_on: function (t, o) {
      tone({ f: 880, t: t, dur: 0.06, vol: 0.22, out: o });
      tone({ f: 1320, t: t + 0.075, dur: 0.07, vol: 0.22, out: o });
      click(t + 0.17, o, 0.5);
      return 0.22;
    },
    console_off: function (t, o) {
      click(t, o, 0.5);
      tone({ f: 1320, t: t + 0.05, dur: 0.06, vol: 0.2, out: o });
      tone({ f: 880, t: t + 0.125, dur: 0.08, vol: 0.2, out: o });
      return 0.22;
    },
    step: function (t, o) {
      var v = 0.85 + Math.random() * 0.3;
      noise({ t: t, dur: 0.06, vol: 0.28, out: o, filter: 'lowpass', ff: 700 * v, ff2: 220, q: 1.2 });
      tone({ f: 95 * v, f2: 60, t: t, dur: 0.05, vol: 0.18, out: o });
      return 0.07;
    },
    pickup: function (t, o) {
      tone({ type: 'triangle', f: 600, f2: 1200, t: t, dur: 0.09, vol: 0.24, out: o });
      tone({ f: 1500, t: t + 0.06, dur: 0.1, vol: 0.12, out: o });
      return 0.17;
    },
    drop: function (t, o) {
      tone({ type: 'triangle', f: 520, f2: 200, t: t, dur: 0.1, vol: 0.22, out: o });
      noise({ t: t + 0.07, dur: 0.06, vol: 0.3, out: o, filter: 'lowpass', ff: 800 });
      tone({ f: 120, f2: 70, t: t + 0.07, dur: 0.07, vol: 0.2, out: o });
      return 0.15;
    },
    repair_tick: function (t, o) {
      for (var i = 0; i < 3; i++) {
        noise({ t: t + i * 0.035, dur: 0.016, vol: 0.34, out: o, filter: 'bandpass', ff: 2800 + Math.random() * 900, q: 4 });
        tone({ type: 'square', f: 2200, t: t + i * 0.035, dur: 0.01, vol: 0.05, out: o });
      }
      return 0.12;
    },
    repair_done: function (t, o) {
      SFX.repair_tick(t, o);
      var notes = [72, 76, 79, 84];
      for (var i = 0; i < notes.length; i++) {
        fm({ f: mtof(notes[i]), ratio: 1, index: 1.2, index2: 0.05, t: t + 0.12 + i * 0.08,
          dur: i === 3 ? 0.9 : 0.4, vol: 0.13, out: o });
      }
      return 1.3;
    },
    extinguish: function (t, o) {
      noise({ t: t, dur: 0.55, a: 0.02, hold: 0.2, vol: 0.32, out: o, filter: 'bandpass', ff: 3200, ff2: 1200, q: 0.7 });
      noise({ t: t, dur: 0.4, a: 0.01, vol: 0.12, out: o, filter: 'highpass', ff: 6000 });
      return 0.6;
    },
    patch: function (t, o) {
      tone({ f: 220, f2: 110, t: t, dur: 0.13, vol: 0.3, out: o });
      noise({ t: t, dur: 0.08, vol: 0.22, out: o, filter: 'bandpass', ff: 1200, q: 1.5 });
      fm({ f: 660, ratio: 2.76, index: 1, t: t + 0.12, dur: 0.3, vol: 0.1, out: o });
      return 0.45;
    },
    shield_hit: function (t, o) {
      fm({ f: 1250, ratio: 2.41, index: 3, index2: 0.1, t: t, dur: 0.9, vol: 0.26, out: o });
      fm({ f: 1870, ratio: 1.73, index: 2, index2: 0.05, t: t + 0.005, dur: 0.7, vol: 0.15, out: o });
      noise({ t: t, dur: 0.08, vol: 0.25, out: o, filter: 'highpass', ff: 4000 });
      tone({ f: 300, f2: 170, t: t, dur: 0.16, vol: 0.25, out: o });
      return 0.95;
    },
    hull_hit: function (t, o) {
      noise({ t: t, dur: 0.55, a: 0.003, vol: 0.85, out: o, filter: 'lowpass', ff: 900, ff2: 140, q: 1 });
      tone({ f: 140, f2: 38, t: t, dur: 0.5, vol: 0.6, out: o });
      fm({ f: 520, ratio: 3.47, index: 4, t: t + 0.01, dur: 0.38, vol: 0.16, out: o });
      fm({ f: 777, ratio: 2.03, index: 3, t: t + 0.02, dur: 0.32, vol: 0.11, out: o });
      return 0.6;
    },
    explosion_small: function (t, o) {
      noise({ t: t, dur: 0.45, a: 0.003, vol: 0.7, out: o, filter: 'lowpass', ff: 2500, ff2: 200 });
      tone({ f: 120, f2: 45, t: t, dur: 0.32, vol: 0.4, out: o });
      return 0.5;
    },
    explosion_big: function (t, o) {
      noise({ t: t, dur: 1.7, a: 0.008, vol: 0.95, out: o, filter: 'lowpass', ff: 1800, ff2: 80, rate: 0.6 });
      tone({ f: 90, f2: 28, t: t, dur: 1.3, vol: 0.7, out: o });
      noise({ t: t + 0.15, dur: 0.9, a: 0.02, vol: 0.4, out: o, filter: 'bandpass', ff: 650, ff2: 200, q: 0.8 });
      for (var i = 0; i < 6; i++) {
        noise({ t: t + 0.2 + Math.random() * 0.9, dur: 0.03, vol: 0.18, out: o, filter: 'bandpass', ff: 1500 + Math.random() * 2500, q: 3 });
      }
      return 1.8;
    },
    lanze: function (t, o) {
      noise({ t: t, dur: 0.65, a: 0.02, hold: 0.25, vol: 0.45, out: o, filter: 'bandpass', ff: 6000, ff2: 2400, q: 3 });
      tone({ type: 'sawtooth', f: 880, f2: 440, t: t, dur: 0.6, a: 0.02, hold: 0.2, vol: 0.1, out: o, filter: 'lowpass', ff: 3000 });
      tone({ f: 1760, f2: 1500, t: t, dur: 0.5, a: 0.01, vol: 0.05, out: o });
      return 0.7;
    },
    bolzen: function (t, o) {
      tone({ f: 160, f2: 52, t: t, dur: 0.26, vol: 0.7, out: o });
      noise({ t: t, dur: 0.18, vol: 0.5, out: o, filter: 'lowpass', ff: 700, ff2: 150 });
      tone({ type: 'square', f: 90, f2: 50, t: t, dur: 0.1, vol: 0.08, out: o, filter: 'lowpass', ff: 400 });
      return 0.3;
    },
    seitenturm: function (t, o) {
      for (var i = 0; i < 3; i++) {
        tone({ type: 'square', f: 420, f2: 180, t: t + i * 0.07, dur: 0.06, vol: 0.11, out: o, filter: 'lowpass', ff: 2000 });
        noise({ t: t + i * 0.07, dur: 0.04, vol: 0.25, out: o, filter: 'bandpass', ff: 1800, q: 1.5 });
      }
      return 0.25;
    },
    dodge: function (t, o) {
      noise({ t: t, dur: 0.38, a: 0.12, vol: 0.4, out: o, filter: 'bandpass', ff: 400, ff2: 2400, q: 1.5 });
      tone({ f: 300, f2: 600, t: t, dur: 0.3, a: 0.08, vol: 0.07, out: o });
      return 0.4;
    },
    jump_charge: function (t, o) {
      tone({ type: 'sawtooth', f: 110, f2: 880, t: t, dur: 1.6, a: 0.3, hold: 1.0, vol: 0.16, out: o, filter: 'lowpass', ff: 400, ff2: 4000, q: 6 });
      tone({ f: 220, f2: 1760, t: t, dur: 1.6, a: 0.3, hold: 1.0, vol: 0.08, out: o });
      return 1.65;
    },
    jump: function (t, o) {
      tone({ f: 440, f2: 1760, t: t, dur: 0.35, a: 0.05, vol: 0.14, out: o });
      noise({ t: t + 0.3, dur: 1.0, a: 0.02, vol: 0.7, out: o, filter: 'bandpass', ff: 3000, ff2: 200, q: 1 });
      tone({ f: 220, f2: 34, t: t + 0.3, dur: 0.9, vol: 0.5, out: o });
      return 1.35;
    },
    alarm_yellow: function (t, o) {
      // sanfter Zweiton (fallende Quarte), weich gefiltert
      tone({ type: 'triangle', f: 698.5, t: t, dur: 0.38, a: 0.04, hold: 0.12, vol: 0.32, out: o, filter: 'lowpass', ff: 2500 });
      tone({ type: 'triangle', f: 523.3, t: t + 0.42, dur: 0.45, a: 0.04, hold: 0.12, vol: 0.32, out: o, filter: 'lowpass', ff: 2500 });
      return 0.9;
    },
    alarm_red: function (t, o) {
      // eigener wechselnder Zweiton: Puls + Sinus-Unterton, jede Note leicht hochgezogen
      var w = res().pulse, hi = 622.3, lo = 466.2;
      for (var i = 0; i < 6; i++) {
        var f = i % 2 ? lo : hi, tt = t + i * 0.16;
        tone({ wave: w, f: f * 0.96, f2: f, glide: 0.04, t: tt, dur: 0.15, a: 0.008, hold: 0.09, vol: 0.2, out: o, filter: 'lowpass', ff: 2200 });
        tone({ f: f / 2, t: tt, dur: 0.15, a: 0.008, hold: 0.09, vol: 0.16, out: o });
      }
      return 1.0;
    },
    beam: function (t, o) {
      noise({ t: t, dur: 1.5, a: 0.3, hold: 0.75, vol: 0.55, out: o, filter: 'bandpass', ff: 300, ff2: 6000, fglide: 1.3, q: 5 });
      tone({ f: 220, f2: 880, t: t, dur: 1.5, a: 0.4, hold: 0.6, vol: 0.05, out: o });
      var penta = [84, 86, 88, 91, 93, 96, 98, 100];
      for (var i = 0; i < 14; i++) {
        fm({ f: mtof(penta[Math.floor(Math.random() * penta.length)]), ratio: 3.5, index: 2, t: t + 0.2 + i * 0.09,
          dur: 0.25, vol: 0.05, out: o });
      }
      return 1.55;
    },
    oda_blip: function (t, o) {
      tone({ f: 880, f2: 1320, glide: 0.06, t: t, dur: 0.1, vol: 0.22, out: o });
      fm({ f: 1760, ratio: 2, index: 0.5, t: t + 0.1, dur: 0.14, vol: 0.18, out: o });
      return 0.26;
    },
    radio: function (t, o) {
      noise({ t: t, dur: 0.24, a: 0.01, hold: 0.12, vol: 0.28, out: o, filter: 'bandpass', ff: 1800, q: 0.8 });
      tone({ f: 1200, t: t + 0.25, dur: 0.1, vol: 0.2, out: o });
      noise({ t: t + 0.38, dur: 0.06, vol: 0.2, out: o, filter: 'bandpass', ff: 2400, q: 1 });
      return 0.45;
    },
    blaster: function (t, o) {
      tone({ type: 'square', f: 1400, f2: 300, t: t, dur: 0.14, vol: 0.13, out: o, filter: 'lowpass', ff: 3500 });
      tone({ f: 2000, f2: 600, t: t, dur: 0.12, vol: 0.12, out: o });
      noise({ t: t, dur: 0.03, vol: 0.2, out: o, filter: 'highpass', ff: 3000 });
      return 0.16;
    },
    drone_shot: function (t, o) {
      tone({ type: 'sawtooth', f: 900, f2: 400, t: t, dur: 0.1, vol: 0.4, out: o, filter: 'bandpass', ff: 1200, q: 2 });
      noise({ t: t, dur: 0.04, vol: 0.25, out: o, filter: 'bandpass', ff: 2500, q: 2 });
      return 0.12;
    },
    drone_die: function (t, o) {
      tone({ type: 'square', f: 600, f2: 80, t: t, dur: 0.5, vol: 0.13, out: o, filter: 'lowpass', ff: 1500 });
      noise({ t: t, dur: 0.35, vol: 0.4, out: o, filter: 'lowpass', ff: 3000, ff2: 300 });
      for (var i = 0; i < 3; i++) noise({ t: t + 0.1 + i * 0.08, dur: 0.02, vol: 0.2, out: o, filter: 'bandpass', ff: 3000, q: 3 });
      return 0.55;
    },
    code_ok: function (t, o) {
      tone({ f: 987.8, t: t, dur: 0.12, vol: 0.22, out: o });
      tone({ f: 1318.5, t: t + 0.09, dur: 0.16, vol: 0.22, out: o });
      return 0.26;
    },
    code_fail: function (t, o) {
      tone({ type: 'square', f: 220, t: t, dur: 0.15, hold: 0.08, vol: 0.16, out: o, filter: 'lowpass', ff: 1200 });
      tone({ type: 'square', f: 185, t: t + 0.17, dur: 0.2, hold: 0.1, vol: 0.16, out: o, filter: 'lowpass', ff: 1200 });
      return 0.4;
    },
    buy: function (t, o) {
      click(t, o, 0.25, 4000);
      fm({ f: 1568, ratio: 2, index: 1, t: t + 0.02, dur: 0.2, vol: 0.18, out: o });
      fm({ f: 2093, ratio: 2, index: 1, t: t + 0.1, dur: 0.45, vol: 0.18, out: o });
      return 0.55;
    },
    strike: function (t, o) {
      noise({ t: t, dur: 0.1, vol: 0.55, out: o, filter: 'bandpass', ff: 900, q: 1 });
      tone({ f: 200, f2: 70, t: t, dur: 0.12, vol: 0.45, out: o });
      return 0.13;
    },
    error: function (t, o) {
      tone({ type: 'square', f: 160, t: t, dur: 0.2, hold: 0.12, vol: 0.14, out: o, filter: 'lowpass', ff: 900 });
      tone({ type: 'square', f: 167, t: t, dur: 0.2, hold: 0.12, vol: 0.1, out: o, filter: 'lowpass', ff: 900 });
      return 0.22;
    },
    emergency: function (t, o) {
      for (var i = 0; i < 4; i++) {
        tone({ type: 'triangle', f: 500, f2: 1000, lin: true, t: t + i * 0.22, dur: 0.2, a: 0.01, hold: 0.14, vol: 0.26, out: o });
        tone({ wave: res().pulse, f: 250, f2: 500, lin: true, t: t + i * 0.22, dur: 0.2, a: 0.01, hold: 0.14, vol: 0.07, out: o, filter: 'lowpass', ff: 1800 });
      }
      return 0.9;
    },
    bot_beep: function (t, o) {
      var set = [1046.5, 1318.5, 1568, 1174.7];
      for (var i = 0; i < 2; i++) {
        tone({ type: 'square', f: set[Math.floor(Math.random() * set.length)], t: t + i * 0.07, dur: 0.05, vol: 0.08, out: o, filter: 'lowpass', ff: 3000 });
      }
      return 0.13;
    },
    heal: function (t, o) {
      var n = [67, 71, 74, 79];
      for (var i = 0; i < n.length; i++) fm({ f: mtof(n[i]), ratio: 2, index: 0.6, t: t + i * 0.06, dur: 0.45, vol: 0.11, out: o });
      noise({ t: t, dur: 0.5, a: 0.1, vol: 0.05, out: o, filter: 'highpass', ff: 7000 });
      return 0.7;
    },
    door: function (t, o) {
      noise({ t: t, dur: 0.35, a: 0.02, vol: 0.32, out: o, filter: 'bandpass', ff: 1200, ff2: 400, q: 1 });
      tone({ f: 120, f2: 80, t: t + 0.3, dur: 0.15, vol: 0.2, out: o });
      return 0.47;
    },

    // ------------------------------------------------------------ M1
    phase: function (t, o) {
      // warm-elektrisch: gefilterter Sägezahn mit fallendem Band + weicher Sinus-Körper + kurzes Funkeln
      var v = 0.95 + Math.random() * 0.1;
      tone({ type: 'sawtooth', f: 330 * v, f2: 196 * v, t: t, dur: 0.24, a: 0.006, vol: 0.14, out: o, filter: 'bandpass', ff: 1600, ff2: 520, q: 2.2 });
      tone({ f: 660 * v, f2: 392 * v, t: t, dur: 0.2, a: 0.004, vol: 0.16, out: o });
      fm({ f: 1320 * v, ratio: 1.5, index: 1.8, index2: 0.05, t: t, dur: 0.12, vol: 0.06, out: o });
      noise({ t: t, dur: 0.05, vol: 0.12, out: o, filter: 'bandpass', ff: 3500, q: 1.5 });
      return 0.27;
    },
    scan_tick: function (t, o) {
      tone({ f: 1480, t: t, dur: 0.045, a: 0.003, vol: 0.12, out: o });
      tone({ f: 2960, t: t, dur: 0.02, a: 0.002, vol: 0.03, out: o });
      return 0.06;
    },
    scan_done: function (t, o) {
      tone({ f: 1174.7, t: t, dur: 0.12, vol: 0.16, out: o });
      tone({ f: 1760, t: t + 0.08, dur: 0.3, vol: 0.15, out: o });
      fm({ f: 3520, ratio: 2, index: 0.6, t: t + 0.08, dur: 0.25, vol: 0.04, out: o });
      return 0.4;
    },
    widescan: function (t, o) {
      // weiter Sonar-Puls: Anschlag mit Gleiten, dann sich entfernende Echos, darunter eine Rauschwelle
      var f = 587.3;
      for (var i = 0; i < 5; i++) {
        var tt = t + i * 0.34, v = 0.24 * Math.pow(0.5, i);
        tone({ f: f * 1.02, f2: f, glide: 0.05, t: tt, dur: 1.1 - i * 0.12, a: 0.004, vol: v, out: o,
          filter: i ? 'lowpass' : null, ff: 2400 - i * 400 });
      }
      tone({ f: f / 2, t: t, dur: 0.9, a: 0.01, vol: 0.08, out: o });
      noise({ t: t, dur: 1.6, a: 0.15, vol: 0.12, out: o, filter: 'bandpass', ff: 300, ff2: 2500, fglide: 1.4, q: 3 });
      return 2.0;
    },
    marker_set: function (t, o) {
      tone({ type: 'triangle', f: 1046.5, t: t, dur: 0.07, vol: 0.2, out: o });
      tone({ type: 'triangle', f: 1568, t: t + 0.06, dur: 0.1, vol: 0.16, out: o });
      click(t, o, 0.18, 4200);
      return 0.17;
    },
    overload_start: function (t, o) {
      // aufheulend: Sägezahn mit öffnendem Resonanzfilter, Sinus-Sirene darüber
      tone({ type: 'sawtooth', f: 70, f2: 520, t: t, dur: 1.4, a: 0.15, hold: 0.9, vol: 0.16, out: o, filter: 'lowpass', ff: 250, ff2: 3200, fglide: 1.2, q: 7 });
      tone({ type: 'sawtooth', f: 70.6, f2: 524, t: t, dur: 1.4, a: 0.15, hold: 0.9, vol: 0.1, out: o, filter: 'lowpass', ff: 250, ff2: 3000, fglide: 1.2, q: 3 });
      tone({ f: 180, f2: 1250, t: t + 0.1, dur: 1.3, a: 0.3, hold: 0.7, vol: 0.09, out: o });
      noise({ t: t, dur: 1.4, a: 0.4, hold: 0.6, vol: 0.12, out: o, filter: 'bandpass', ff: 400, ff2: 3000, q: 2 });
      return 1.45;
    },
    overload_warn: function (t, o) {
      // dringlicher, aber weicher Zweiton (steigende kleine Terz), kurz
      var hi = 784, lo = 659.3;
      tone({ type: 'triangle', f: lo, t: t, dur: 0.18, a: 0.01, hold: 0.08, vol: 0.26, out: o, filter: 'lowpass', ff: 2600 });
      tone({ type: 'triangle', f: hi, t: t + 0.2, dur: 0.2, a: 0.01, hold: 0.08, vol: 0.26, out: o, filter: 'lowpass', ff: 2600 });
      tone({ f: lo / 2, t: t, dur: 0.18, hold: 0.08, vol: 0.08, out: o });
      tone({ f: hi / 2, t: t + 0.2, dur: 0.2, hold: 0.08, vol: 0.08, out: o });
      return 0.42;
    },
    reactor_down: function (t, o) {
      // absterbendes Brummen: Tonhöhe und Filter sinken
      tone({ f: 110, f2: 28, t: t, dur: 2.0, a: 0.01, hold: 0.3, vol: 0.4, out: o });
      tone({ type: 'sawtooth', f: 55, f2: 18, t: t, dur: 1.9, a: 0.01, hold: 0.2, vol: 0.14, out: o, filter: 'lowpass', ff: 700, ff2: 80 });
      tone({ type: 'triangle', f: 330, f2: 60, t: t, dur: 1.2, vol: 0.06, out: o });
      noise({ t: t, dur: 0.9, a: 0.01, vol: 0.18, out: o, filter: 'lowpass', ff: 900, ff2: 120 });
      click(t + 0.02, o, 0.4, 1500);
      return 2.05;
    },
    reactor_up: function (t, o) {
      // anlaufende Turbine: Grundton steigt, heller Turbinenpfeifton darüber
      tone({ f: 30, f2: 110, t: t, dur: 2.3, a: 0.4, hold: 1.3, vol: 0.28, out: o });
      tone({ type: 'sawtooth', f: 20, f2: 55, t: t, dur: 2.3, a: 0.4, hold: 1.3, vol: 0.12, out: o, filter: 'lowpass', ff: 120, ff2: 700 });
      tone({ f: 220, f2: 1900, t: t + 0.1, dur: 2.2, a: 0.8, hold: 0.8, vol: 0.05, out: o });
      noise({ t: t, dur: 2.2, a: 1.0, hold: 0.6, vol: 0.12, out: o, filter: 'bandpass', ff: 200, ff2: 2200, q: 1.5 });
      tone({ type: 'triangle', f: 440, t: t + 1.9, dur: 0.4, vol: 0.06, out: o });
      return 2.35;
    },
    switch_hold: function (t, o) {
      // Hebel-Klack + elektrisches Summen
      noise({ t: t, dur: 0.04, vol: 0.5, out: o, filter: 'bandpass', ff: 1400, q: 2 });
      tone({ f: 180, f2: 90, t: t, dur: 0.07, vol: 0.35, out: o });
      noise({ t: t + 0.05, dur: 0.02, vol: 0.25, out: o, filter: 'bandpass', ff: 3000, q: 3 });
      tone({ type: 'triangle', f: 120, t: t + 0.05, dur: 0.5, a: 0.06, hold: 0.25, vol: 0.12, out: o, filter: 'lowpass', ff: 600 });
      tone({ f: 240.5, t: t + 0.05, dur: 0.5, a: 0.06, hold: 0.25, vol: 0.05, out: o });
      return 0.58;
    },
    discovery: function (t, o) {
      // kleine freundliche Fanfare, eigenes Motiv (Sexte hoch, Sekunde zurück, Terz, langer Schlusston)
      var notes = [67, 76, 74, 79, 83], at = [0, 0.11, 0.22, 0.33, 0.5], len = [0.2, 0.2, 0.2, 0.3, 1.1];
      for (var i = 0; i < notes.length; i++) {
        fm({ f: mtof(notes[i]), ratio: 1, index: 1.4, index2: 0.06, t: t + at[i], dur: len[i] + 0.2, vol: 0.12, out: o });
        tone({ type: 'triangle', f: mtof(notes[i] - 12), t: t + at[i], dur: len[i], vol: 0.06, out: o });
      }
      tone({ f: mtof(55), t: t + 0.5, dur: 1.1, a: 0.02, vol: 0.12, out: o });
      noise({ t: t + 0.5, dur: 0.9, a: 0.2, vol: 0.04, out: o, filter: 'highpass', ff: 7000 });
      return 1.6;
    },
    salvage: function (t, o) {
      // metallisches Klonk + aufsteigendes Einsammeln
      fm({ f: 420, ratio: 3.71, index: 3, index2: 0.1, t: t, dur: 0.35, vol: 0.16, out: o });
      noise({ t: t, dur: 0.05, vol: 0.3, out: o, filter: 'bandpass', ff: 1800, q: 1.5 });
      tone({ type: 'triangle', f: 520, f2: 1040, t: t + 0.12, dur: 0.12, vol: 0.18, out: o });
      tone({ f: 1390, t: t + 0.22, dur: 0.15, vol: 0.1, out: o });
      return 0.42;
    },
    emp: function (t, o) {
      // Knistern + Ausfall: Entladung, Knackser, Ton bricht nach unten weg
      noise({ t: t, dur: 0.25, a: 0.003, vol: 0.45, out: o, filter: 'highpass', ff: 2500 });
      fm({ f: 900, ratio: 0.51, index: 6, index2: 0.3, t: t, dur: 0.35, vol: 0.12, out: o });
      for (var i = 0; i < 10; i++) {
        noise({ t: t + 0.03 + Math.random() * 0.5, dur: 0.012 + Math.random() * 0.02, vol: 0.2 + Math.random() * 0.2, out: o,
          filter: 'bandpass', ff: 1500 + Math.random() * 5000, q: 3 });
      }
      tone({ type: 'square', f: 800, f2: 35, t: t + 0.05, dur: 0.7, a: 0.005, vol: 0.09, out: o, filter: 'lowpass', ff: 2500, ff2: 200 });
      tone({ f: 120, f2: 30, t: t, dur: 0.5, vol: 0.3, out: o });
      return 0.85;
    },
    pylon_down: function (t, o) {
      // Pylon fällt: Energieabfall, metallisches Kreischen, dumpfer Aufprall
      tone({ f: 880, f2: 110, t: t, dur: 0.5, vol: 0.08, out: o });
      fm({ f: 310, ratio: 2.63, index: 3.5, index2: 0.2, t: t + 0.05, dur: 0.6, vol: 0.12, out: o });
      noise({ t: t + 0.35, dur: 0.5, a: 0.004, vol: 0.6, out: o, filter: 'lowpass', ff: 1100, ff2: 150 });
      tone({ f: 130, f2: 42, t: t + 0.35, dur: 0.5, vol: 0.45, out: o });
      return 0.95;
    },
    trade: function (t, o) {
      click(t, o, 0.25, 3500);
      fm({ f: 1318.5, ratio: 2.01, index: 1, t: t + 0.03, dur: 0.18, vol: 0.15, out: o });
      fm({ f: 1174.7, ratio: 2.01, index: 1, t: t + 0.12, dur: 0.18, vol: 0.13, out: o });
      fm({ f: 1760, ratio: 2.01, index: 1, t: t + 0.21, dur: 0.4, vol: 0.15, out: o });
      return 0.6;
    },
    table_sit: function (t, o) {
      // Stuhlrücken + gedämpftes Setzen
      noise({ t: t, dur: 0.2, a: 0.03, vol: 0.22, out: o, filter: 'bandpass', ff: 650, ff2: 900, q: 4 });
      tone({ type: 'sawtooth', f: 95, f2: 120, t: t, dur: 0.18, a: 0.03, vol: 0.04, out: o, filter: 'lowpass', ff: 600 });
      noise({ t: t + 0.22, dur: 0.08, vol: 0.3, out: o, filter: 'lowpass', ff: 500 });
      tone({ f: 110, f2: 70, t: t + 0.22, dur: 0.1, vol: 0.25, out: o });
      return 0.34;
    },
    lore: function (t, o) {
      // geheimnisvoller Glockenton: unharmonische Teiltöne, langsame Schwebung, tiefer Schatten
      var f = 349.2;
      fm({ f: f, ratio: 1.414, index: 2.2, index2: 0.05, iglide: 1.5, t: t, dur: 3.2, a: 0.005, vol: 0.14, out: o });
      fm({ f: f * 2.76, ratio: 1.0, index: 0.4, t: t, dur: 1.6, a: 0.003, vol: 0.04, out: o });
      tone({ f: f * 1.003, t: t, dur: 3.2, a: 0.01, vol: 0.06, out: o });
      tone({ f: f / 2, t: t + 0.05, dur: 2.8, a: 0.3, vol: 0.07, out: o });
      noise({ t: t, dur: 2.2, a: 0.6, vol: 0.03, out: o, filter: 'bandpass', ff: 4500, q: 4 });
      return 3.3;
    },

    // ------------------------------------------------------------ M2 „Schildwall“
    // Parameter kommen als drittes Argument (prm) aus opts von GameAudio.play, siehe Kopf von GA.play.
    shield_break: function (t, o) {
      // Glasbruch: helle unharmonische Splitter + Klirr-Rauschen, darunter ein Sub-Drop
      noise({ t: t, dur: 0.12, a: 0.002, vol: 0.5, out: o, filter: 'highpass', ff: 3500 });
      fm({ f: 2350, ratio: 2.71, index: 2.5, index2: 0.1, t: t, dur: 0.45, vol: 0.1, out: o });
      fm({ f: 3170, ratio: 1.93, index: 2, index2: 0.1, t: t + 0.01, dur: 0.35, vol: 0.08, out: o });
      for (var i = 0; i < 12; i++) {
        var tt = t + 0.02 + Math.pow(Math.random(), 1.6) * 0.5;
        tone({ f: 2500 + Math.random() * 4500, t: tt, dur: 0.04 + Math.random() * 0.08, a: 0.001, vol: 0.05 + Math.random() * 0.05, out: o });
        noise({ t: tt, dur: 0.02, vol: 0.15, out: o, filter: 'bandpass', ff: 4000 + Math.random() * 4000, q: 4 });
      }
      tone({ f: 160, f2: 32, t: t, dur: 0.75, a: 0.004, vol: 0.62, out: o });
      tone({ type: 'triangle', f: 320, f2: 60, t: t, dur: 0.35, vol: 0.12, out: o });
      return 0.8;
    },
    shield_up: function (t, o, prm) {
      // kurzer Ding, je Segment eine Stufe höher (seg = Segmente nach dem Laden)
      var seg = prm && prm.seg != null ? clamp(Math.round(prm.seg), 1, 8) : 2;
      var steps = [0, 72, 76, 79, 84, 88, 91, 96, 100], f = mtof(steps[seg]);
      fm({ f: f, ratio: 2, index: 0.7, index2: 0.02, t: t, dur: 0.32, a: 0.003, vol: 0.18, out: o });
      tone({ f: f * 2, t: t, dur: 0.08, vol: 0.04, out: o });
      return 0.34;
    },
    shield_full: function (t, o) {
      // sauberer Akkord (Cadd9, leicht gefächert), weicher Anstieg
      var n = [60, 67, 74, 76, 79];
      for (var i = 0; i < n.length; i++) {
        fm({ f: mtof(n[i]), ratio: 1, index: 0.6, index2: 0.02, t: t + i * 0.025, dur: 1.1, a: 0.02, vol: 0.08, out: o });
      }
      tone({ f: mtof(91), t: t + 0.12, dur: 0.6, a: 0.05, vol: 0.025, out: o });
      return 1.2;
    },
    wounded: function (t, o) {
      // dumpfer Aufprall, Herzschlag-Doppel, fallender gedämpfter Ton
      noise({ t: t, dur: 0.3, a: 0.003, vol: 0.55, out: o, filter: 'lowpass', ff: 700, ff2: 120 });
      tone({ f: 120, f2: 45, t: t, dur: 0.3, vol: 0.55, out: o });
      tone({ f: 70, f2: 45, t: t + 0.42, dur: 0.18, vol: 0.45, out: o });
      tone({ f: 66, f2: 42, t: t + 0.62, dur: 0.22, vol: 0.38, out: o });
      tone({ type: 'triangle', f: 523.3, f2: 196, t: t + 0.05, dur: 1.1, a: 0.02, hold: 0.2, vol: 0.12, out: o, filter: 'lowpass', ff: 1800, ff2: 400 });
      tone({ type: 'triangle', f: 554.4, f2: 207.7, t: t + 0.05, dur: 1.1, a: 0.02, hold: 0.2, vol: 0.06, out: o, filter: 'lowpass', ff: 1500, ff2: 350 });
      return 1.2;
    },
    revive_done: function (t, o) {
      // Aufstehen: warmes Aufwärts-Arpeggio + Atemzug
      noise({ t: t, dur: 0.45, a: 0.2, vol: 0.12, out: o, filter: 'bandpass', ff: 600, ff2: 2400, q: 1.2 });
      var n = [62, 66, 69, 74, 78];
      for (var i = 0; i < n.length; i++) {
        fm({ f: mtof(n[i]), ratio: 2, index: 0.8, index2: 0.03, t: t + 0.1 + i * 0.07, dur: i === 4 ? 0.8 : 0.35, vol: 0.12, out: o });
      }
      tone({ type: 'triangle', f: mtof(50), t: t + 0.1, dur: 0.7, a: 0.03, vol: 0.14, out: o });
      return 1.0;
    },
    pistol: function (t, o) {
      // kleiner, heller als der Blaster, mit trockenem Klick
      tone({ type: 'square', f: 2300, f2: 700, t: t, dur: 0.08, vol: 0.1, out: o, filter: 'lowpass', ff: 4500 });
      tone({ f: 1600, f2: 500, t: t, dur: 0.07, vol: 0.12, out: o });
      noise({ t: t, dur: 0.02, vol: 0.22, out: o, filter: 'highpass', ff: 3500 });
      click(t, o, 0.18, 3200);
      return 0.1;
    },
    enemy_aim: function (t, o) {
      // Lade-Whine (~0,8 s): steigendes, resonantes Band im empfindlichen 1–4-kHz-Bereich,
      // darüber beschleunigende Pips. Wichtigster Warnton – klar, hoch, rhythmisch, nichts anderes klingt so.
      var d = 0.8;
      tone({ type: 'sawtooth', f: 520, f2: 1560, t: t, dur: d, a: 0.08, hold: d - 0.14, vol: 0.13, out: o,
        filter: 'bandpass', ff: 900, ff2: 3000, q: 6 });
      tone({ f: 1040, f2: 3120, t: t, dur: d, a: 0.1, hold: d - 0.16, vol: 0.07, out: o });
      var at = 0, gap = 0.16, k = 0;
      while (at < d - 0.03 && k < 12) {
        var fr = 1700 + (at / d) * 1700;
        tone({ type: 'square', f: fr, t: t + at, dur: 0.035, a: 0.002, vol: 0.09, out: o, filter: 'lowpass', ff: 5000 });
        at += gap; gap = Math.max(0.045, gap * 0.72); k++;
      }
      return d + 0.02;
    },
    enemy_shot: function (t, o) {
      // Plünderer-Schuss: rauer, tiefer als die Drohne, kratziges FM
      tone({ type: 'sawtooth', f: 720, f2: 170, t: t, dur: 0.16, vol: 0.32, out: o, filter: 'lowpass', ff: 2600, ff2: 600, q: 2 });
      fm({ f: 380, ratio: 1.41, index: 5, index2: 0.4, t: t, dur: 0.14, vol: 0.1, out: o });
      noise({ t: t, dur: 0.06, vol: 0.4, out: o, filter: 'bandpass', ff: 1600, q: 1.2 });
      tone({ f: 140, f2: 70, t: t, dur: 0.08, vol: 0.25, out: o });
      return 0.18;
    },
    warden_wake: function (t, o) {
      // Lamassu erwacht: Steinmahlen, tiefes Aufstöhnen, öffnendes Filter, fremder Resonanzton, schwerer Schlag
      for (var i = 0; i < 8; i++) {
        noise({ t: t + i * 0.18 + Math.random() * 0.06, dur: 0.22, a: 0.03, vol: 0.16 + i * 0.015, out: o, filter: 'lowpass', ff: 500 + Math.random() * 300, q: 2, rate: 0.5 });
      }
      tone({ type: 'sawtooth', f: 27.5, f2: 55, t: t, dur: 2.2, a: 0.5, hold: 1.2, vol: 0.13, out: o, filter: 'lowpass', ff: 90, ff2: 900, fglide: 1.8, q: 5 });
      tone({ f: 41.2, f2: 55, t: t, dur: 2.3, a: 0.6, hold: 1.2, vol: 0.13, out: o });
      fm({ f: 110, ratio: 1.414, index: 2.5, index2: 0.2, iglide: 2.0, t: t + 0.5, dur: 2.0, a: 0.6, vol: 0.09, out: o });
      tone({ f: 82.4 * 2.76, t: t + 1.0, dur: 1.4, a: 0.5, vol: 0.03, out: o });
      noise({ t: t + 1.75, dur: 0.6, a: 0.004, vol: 0.6, out: o, filter: 'lowpass', ff: 600, ff2: 90 });
      tone({ f: 90, f2: 30, t: t + 1.75, dur: 0.7, vol: 0.6, out: o });
      return 2.5;
    },
    warden_aim: function (t, o) {
      // schweres Aufladen (~1,4 s): tiefes Brummen mit öffnendem Resonanzfilter, langsame tiefe Pulse.
      // Bewusst tiefer und langsamer als enemy_aim, damit beide unterscheidbar bleiben.
      var d = 1.4;
      tone({ type: 'sawtooth', f: 55, f2: 165, t: t, dur: d, a: 0.15, hold: d - 0.25, vol: 0.11, out: o,
        filter: 'lowpass', ff: 180, ff2: 2200, q: 9 });
      tone({ type: 'sawtooth', f: 55.4, f2: 166, t: t, dur: d, a: 0.15, hold: d - 0.25, vol: 0.05, out: o, filter: 'lowpass', ff: 300, ff2: 1400 });
      tone({ f: 330, f2: 990, t: t, dur: d, a: 0.3, hold: d - 0.4, vol: 0.07, out: o });
      var at = 0, gap = 0.3, k = 0;
      while (at < d - 0.05 && k < 12) {
        tone({ type: 'triangle', f: 440 + (at / d) * 440, t: t + at, dur: 0.07, a: 0.004, vol: 0.12, out: o });
        tone({ f: 80, f2: 50, t: t + at, dur: 0.08, vol: 0.18, out: o });
        at += gap; gap = Math.max(0.08, gap * 0.8); k++;
      }
      return d + 0.02;
    },
    warden_shot: function (t, o) {
      // dicker, langsamer Energiebrocken: Wumms + Sub + Metallklang
      tone({ f: 130, f2: 34, t: t, dur: 0.7, a: 0.004, vol: 0.62, out: o });
      noise({ t: t, dur: 0.5, a: 0.004, vol: 0.55, out: o, filter: 'lowpass', ff: 1400, ff2: 120 });
      tone({ type: 'sawtooth', f: 260, f2: 60, t: t, dur: 0.45, vol: 0.12, out: o, filter: 'lowpass', ff: 1500, ff2: 200, q: 3 });
      fm({ f: 220, ratio: 2.76, index: 3, index2: 0.1, t: t, dur: 0.5, vol: 0.08, out: o });
      return 0.75;
    },
    warden_deflect: function (t, o) {
      // Treffer auf den Frontpanzer: schweres metallisches Tonk + Abpraller, kein Schaden
      fm({ f: 360, ratio: 2.71, index: 3.5, index2: 0.1, t: t, dur: 0.55, vol: 0.18, out: o });
      fm({ f: 541, ratio: 1.93, index: 2, index2: 0.05, t: t + 0.003, dur: 0.4, vol: 0.09, out: o });
      noise({ t: t, dur: 0.04, vol: 0.35, out: o, filter: 'bandpass', ff: 2200, q: 1.5 });
      tone({ f: 2400, f2: 900, t: t + 0.03, dur: 0.18, vol: 0.05, out: o });
      tone({ f: 110, f2: 60, t: t, dur: 0.12, vol: 0.3, out: o });
      return 0.58;
    },
    cover_hit: function (t, o) {
      // Splitter an der halben Deckung: Steinknacken + Bröseln
      noise({ t: t, dur: 0.08, a: 0.001, vol: 0.5, out: o, filter: 'bandpass', ff: 1400, q: 1.2 });
      tone({ f: 170, f2: 80, t: t, dur: 0.09, vol: 0.3, out: o });
      for (var i = 0; i < 6; i++) {
        noise({ t: t + 0.04 + Math.random() * 0.2, dur: 0.012 + Math.random() * 0.02, vol: 0.12 + Math.random() * 0.15, out: o,
          filter: 'bandpass', ff: 2000 + Math.random() * 4000, q: 3 });
      }
      return 0.28;
    },
    jammer_off: function (t, o) {
      // Störrelais aus: Brummen kippt weg, Klick, drei fallende Töne
      tone({ type: 'square', f: 233, f2: 40, t: t, dur: 0.45, a: 0.003, vol: 0.1, out: o, filter: 'lowpass', ff: 1800, ff2: 200 });
      fm({ f: 466, ratio: 0.5, index: 4, index2: 0.1, t: t, dur: 0.3, vol: 0.08, out: o });
      click(t, o, 0.4, 2200);
      var n = [84, 79, 72];
      for (var i = 0; i < 3; i++) tone({ f: mtof(n[i]), t: t + 0.18 + i * 0.09, dur: 0.12, vol: 0.13, out: o });
      return 0.5;
    },
    archkey: function (t, o) {
      // Vorläufer-Schlüssel rastet ein: Steinklack + fremde Glocke
      noise({ t: t, dur: 0.05, vol: 0.45, out: o, filter: 'bandpass', ff: 900, q: 2 });
      tone({ f: 140, f2: 80, t: t, dur: 0.1, vol: 0.32, out: o });
      fm({ f: 311.1, ratio: 2.76, index: 1.6, index2: 0.04, t: t + 0.06, dur: 1.0, a: 0.004, vol: 0.12, out: o });
      fm({ f: 466.2, ratio: 1.414, index: 0.8, index2: 0.03, t: t + 0.06, dur: 0.8, a: 0.004, vol: 0.06, out: o });
      return 1.08;
    },
    vault_open: function (t, o) {
      // schweres Steintor: langes Mahlen, Akkord fremder Resonanzen schwillt an, dumpfer Endanschlag
      noise({ t: t, dur: 2.2, a: 0.25, hold: 1.4, vol: 0.2, out: o, filter: 'bandpass', ff: 220, ff2: 420, q: 2.5, rate: 0.6 });
      for (var i = 0; i < 9; i++) {
        noise({ t: t + 0.1 + i * 0.22 + Math.random() * 0.05, dur: 0.15, a: 0.02, vol: 0.14, out: o, filter: 'lowpass', ff: 700, q: 2, rate: 0.5 });
      }
      tone({ f: 36.7, t: t, dur: 2.6, a: 0.5, hold: 1.4, vol: 0.12, out: o });
      var n = [50, 57, 63, 68];   // Quinte + Tritonus-Färbung
      for (var k = 0; k < n.length; k++) {
        fm({ f: mtof(n[k]), ratio: 1.414, index: 0.9, index2: 0.05, iglide: 2.0, t: t + 0.6 + k * 0.12, dur: 2.0, a: 0.6, vol: 0.05, out: o });
      }
      noise({ t: t + 2.25, dur: 0.45, a: 0.004, vol: 0.5, out: o, filter: 'lowpass', ff: 500, ff2: 90 });
      tone({ f: 80, f2: 32, t: t + 2.25, dur: 0.5, vol: 0.5, out: o });
      return 2.8;
    },
    tablet: function (t, o) {
      // die Tafel: aufsteigende fremde Glocken + Schimmer
      var n = [69, 72, 76, 81];
      for (var i = 0; i < n.length; i++) {
        fm({ f: mtof(n[i]), ratio: 2.76, index: 1.2, index2: 0.03, t: t + i * 0.09, dur: i === 3 ? 1.2 : 0.5, vol: 0.1, out: o });
      }
      tone({ f: mtof(45), t: t, dur: 1.2, a: 0.1, vol: 0.12, out: o });
      noise({ t: t + 0.2, dur: 1.0, a: 0.3, vol: 0.05, out: o, filter: 'highpass', ff: 7000 });
      return 1.5;
    },
    bark: function (t, o, prm) {
      // Plünderer-Funk: Piepsprache, verzerrt, bandbegrenzt. Silbenzahl aus prm.syl, sonst aus Textlänge,
      // sonst zufällig 3–6. Jede Silbe: Rechteck mit Tonhöhenknick, Pausen dazwischen.
      prm = prm || {};
      var syl;
      if (prm.syl != null) syl = prm.syl;
      else if (prm.text != null) syl = Math.ceil(String(prm.text).length / 6);
      else if (prm.len != null) syl = Math.ceil(prm.len / 6);
      else syl = 3 + Math.floor(Math.random() * 4);
      syl = clamp(Math.round(syl), 2, 10);
      var sh = ac.createWaveShaper(), bp = ac.createBiquadFilter(), g = ac.createGain();
      sh.curve = BARK_CURVE;
      bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9;
      g.gain.value = 0.5;
      sh.connect(bp); bp.connect(g); g.connect(o);
      var base = 330 + Math.random() * 60, at = 0.05;
      noise({ t: t, dur: 0.05, vol: 0.12, out: o, filter: 'bandpass', ff: 2500, q: 1 });   // Squelch an
      for (var i = 0; i < syl; i++) {
        var len = 0.05 + Math.random() * 0.07, f = base * Math.pow(2, (Math.floor(Math.random() * 7) - 2) / 12 * 2);
        var up = Math.random() < 0.5 ? 1.25 : 0.8;
        if (i === syl - 1) up = prm.q ? 1.5 : 0.7;   // Satzende: fallend, bei Frage (prm.q) steigend
        tone({ type: 'square', f: f, f2: f * up, t: t + at, dur: len, a: 0.004, hold: len * 0.5, vol: 0.32, out: sh });
        tone({ type: 'sawtooth', f: f * 0.5, t: t + at, dur: len, a: 0.004, hold: len * 0.5, vol: 0.12, out: sh });
        at += len + 0.025 + (Math.random() < 0.2 ? 0.07 : 0);
      }
      noise({ t: t + at, dur: 0.06, vol: 0.12, out: o, filter: 'bandpass', ff: 2500, q: 1 });   // Squelch aus
      var total = at + 0.08;
      var nodes = [sh, bp, g];
      later(function () { disc(nodes); }, (total + 0.4) * 1000);
      return total;
    },
    order: function (t, o) {
      // Captain-Befehl: knapper Funk-Klick + zwei bestimmte Töne (Quarte hoch)
      noise({ t: t, dur: 0.03, vol: 0.2, out: o, filter: 'bandpass', ff: 2400, q: 1 });
      fm({ f: 784, ratio: 2, index: 0.8, t: t + 0.03, dur: 0.1, vol: 0.16, out: o });
      fm({ f: 1046.5, ratio: 2, index: 0.8, t: t + 0.12, dur: 0.18, vol: 0.16, out: o });
      tone({ type: 'triangle', f: 261.6, t: t + 0.03, dur: 0.2, vol: 0.1, out: o });
      return 0.32;
    },
    squad_recall: function (t, o) {
      // Notrückholung aller: drei fallende Warntöne, dann Transferflirren nach oben
      var n = [76, 72, 67];
      for (var i = 0; i < 3; i++) {
        tone({ type: 'triangle', f: mtof(n[i]), t: t + i * 0.2, dur: 0.18, a: 0.01, hold: 0.1, vol: 0.24, out: o, filter: 'lowpass', ff: 2600 });
        tone({ f: mtof(n[i] - 12), t: t + i * 0.2, dur: 0.18, hold: 0.1, vol: 0.08, out: o });
      }
      noise({ t: t + 0.6, dur: 1.3, a: 0.3, hold: 0.5, vol: 0.45, out: o, filter: 'bandpass', ff: 400, ff2: 6000, fglide: 1.1, q: 5 });
      tone({ f: 220, f2: 1320, t: t + 0.6, dur: 1.2, a: 0.3, hold: 0.5, vol: 0.06, out: o });
      return 1.95;
    }
  };

  // Verzerrungskurve für bark (harte, asymmetrische Sättigung -> „kaputtes Funkgerät“), kontextunabhängig
  var BARK_CURVE = (function () {
    var c = new Float32Array(1024);
    for (var i = 0; i < c.length; i++) {
      var x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.max(-0.6, Math.min(0.8, Math.tanh(x * 5) * 0.9));
    }
    return c;
  })();

  // shield_hit (M2): Tonhöhe je verlorenem Segment. Ohne seg -> exakt der bisherige Klang (Schiffsschild).
  (function () {
    var base = SFX.shield_hit;
    SFX.shield_hit = function (t, o, prm) {
      if (!prm || prm.seg == null) return base(t, o);
      var max = prm.max != null ? clamp(Math.round(prm.max), 1, 12) : 3;
      var seg = clamp(Math.round(prm.seg), 0, max);
      var lost = (max - seg) / max;                     // 1/3, 2/3, 1 bei max 3
      var r = Math.pow(2, ((lost - 0.5) * 12) / 12);    // -> etwa -2, +2, +6 Halbtöne
      fm({ f: 1250 * r, ratio: 2.41, index: 3, index2: 0.1, t: t, dur: 0.6, vol: 0.24, out: o });
      fm({ f: 1870 * r, ratio: 1.73, index: 2, index2: 0.05, t: t + 0.005, dur: 0.45, vol: 0.13, out: o });
      noise({ t: t, dur: 0.07, vol: 0.25, out: o, filter: 'highpass', ff: 4000 });
      tone({ f: 300 * r, f2: 170 * r, t: t, dur: 0.14, vol: 0.25, out: o });
      if (seg === 0) tone({ type: 'square', f: 1250 * r, t: t + 0.08, dur: 0.12, a: 0.002, vol: 0.05, out: o, filter: 'lowpass', ff: 4000 });
      return 0.65;
    };
  })();

  function duck(level, hold) {
    var p = bus.duck.gain, t = ac.currentTime;
    if (p.value < level) level = p.value;   // schon tiefer geduckt: nicht wieder anheben
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(level, t + 0.03);
    p.setValueAtTime(level, t + 0.03 + hold);
    p.linearRampToValueAtTime(1, t + 0.03 + hold + 0.6);
  }

  // Intern, ohne Rate-Limit (auch für Offline-Test)
  // prm: optionale Klangparameter (M2), z. B. { seg, max, syl, text, dist }
  function playAt(name, t, vol, pan, prm) {
    var g = ac.createGain();
    g.gain.value = vol * (LEVEL[name] || 1);
    var nodes = [g], head = g;
    // Entfernung (optional, 0 = nah … 1 = Rand des Sichtfelds): dumpfer und etwas leiser
    var dist = prm && prm.dist != null ? clamp(prm.dist, 0, 1) : 0;
    if (dist > 0) {
      var lp = ac.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = 16000 * Math.pow(2500 / 16000, dist); lp.Q.value = 0.5;
      g.gain.value *= 1 - 0.45 * dist;
      head.connect(lp); head = lp; nodes.push(lp);
    }
    if (pan && ac.createStereoPanner) {
      var p = ac.createStereoPanner(); p.pan.value = pan;
      head.connect(p); p.connect(bus.sfx); nodes.push(p);
    } else {
      head.connect(bus.sfx);
    }
    var dur = SFX[name](t, g, prm || null) || 1;
    if (DUCK[name]) duck(DUCK[name][0], DUCK[name][1]);
    later(function () { disc(nodes); }, (dur + 0.6) * 1000);
    return dur;
  }

  // ---------------------------------------------------------------- Musik
  // Stimmungen: bpm, Schritt = Sechzehntel. start() baut Dauerklänge, step() plant Noten.
  function chordAt(def, i) { return def.chords[Math.floor(i / (16 * (def.barsPerChord || 1))) % def.chords.length]; }

  function drone(p, t, specs, filterFreq, vol) {
    var g = ac.createGain(), f = ac.createBiquadFilter(), lfo = ac.createOscillator(), lg = ac.createGain();
    f.type = 'lowpass'; f.frequency.value = filterFreq; f.Q.value = 1.5;
    lfo.frequency.value = 0.07; lg.gain.value = filterFreq * 0.35;
    lfo.connect(lg); lg.connect(f.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 2);
    f.connect(g); g.connect(p.gain);
    var srcs = [lfo];
    for (var i = 0; i < specs.length; i++) {
      var o = ac.createOscillator(); o.type = specs[i][0]; o.frequency.value = specs[i][1];
      var og = ac.createGain(); og.gain.value = specs[i][2];
      o.connect(og); og.connect(f); srcs.push(o); p.nodes.push(og);
    }
    for (var k = 0; k < srcs.length; k++) { srcs[k].start(t); p.srcs.push(srcs[k]); }
    p.nodes.push(g, f, lg);
  }

  function brush(t, out, vol) { noise({ t: t, dur: 0.09, a: 0.01, vol: vol, out: out, filter: 'bandpass', ff: 5500, q: 0.9 }); }
  function hat(t, out, vol) { noise({ t: t, dur: 0.035, vol: vol, out: out, filter: 'highpass', ff: 7500 }); }
  function kick(t, out, vol) { tone({ f: 150, f2: 45, glide: 0.12, t: t, dur: 0.25, vol: vol, out: out }); }
  function snare(t, out, vol) {
    noise({ t: t, dur: 0.18, vol: vol, out: out, filter: 'bandpass', ff: 1900, q: 0.7 });
    tone({ type: 'triangle', f: 190, f2: 140, t: t, dur: 0.08, vol: vol * 0.5, out: out });
  }

  function layerGain(x, thresh) { return clamp((x - thresh) / 0.15, 0, 1); }

  var MOOD_DEFS = {
    ship: {
      bpm: 76,
      // Dmaj9 – Bm9 – Gmaj7 – Asus(6)
      chords: [[62, 66, 69, 73, 76], [59, 62, 66, 69, 73], [55, 59, 62, 66, 69], [57, 62, 64, 66, 69]],
      roots: [38, 35, 31, 33],
      start: function (p, t) {
        drone(p, t, [['sine', 55, 0.8], ['triangle', 55.25, 0.35], ['sine', 110, 0.12]], 180, 0.13);
      },
      step: function (p, i, t) {
        var def = this, s = i % 16, bar = Math.floor(i / 16), ch = chordAt(def, i), root = def.roots[bar % 4];
        var sp = 60 / def.bpm / 4;
        if (s === 0) {
          for (var k = 0; k < ch.length - 1; k++) epiano(mtof(ch[k]), t + k * 0.012, 2.6, 0.05, p.gain);
          tone({ type: 'triangle', f: mtof(root), t: t, dur: 1.5, a: 0.02, vol: 0.2, out: p.gain, filter: 'lowpass', ff: 500 });
        }
        if (s === 6) for (var j = 2; j < ch.length; j++) epiano(mtof(ch[j]), t, 0.8, 0.032, p.gain);
        if (s === 10) tone({ type: 'triangle', f: mtof(root + 7), t: t, dur: 0.7, a: 0.02, vol: 0.13, out: p.gain, filter: 'lowpass', ff: 500 });
        if (s === 4 || s === 12) brush(t, p.gain, 0.025);
        // eigenes Motiv: 4-Takt-Phrase, deterministisch aus Takt- und Schrittposition
        if (s % 2 === 0 && s !== 0) {
          var r = hrand(bar % 4, s);
          if (r < 0.32) {
            var note = ch[Math.floor(hrand(s, bar % 4 + 9) * ch.length)] + 12;
            epiano(mtof(note), t + sp * 0.1, 1.0, 0.045, p.gain);
          }
        }
      }
    },
    port: {
      bpm: 88,
      // Fmaj9 – Dm9 – Bbmaj9 – C9sus
      chords: [[65, 69, 72, 76, 79], [62, 65, 69, 72, 76], [58, 62, 65, 69, 72], [60, 65, 67, 70, 74]],
      roots: [41, 38, 34, 36],
      start: function (p, t) {
        drone(p, t, [['sine', 55, 0.5], ['sine', 82.4, 0.15]], 220, 0.05);
      },
      step: function (p, i, t) {
        var def = this, s = i % 16, bar = Math.floor(i / 16), ch = chordAt(def, i), root = def.roots[bar % 4];
        if (s === 0 || s === 7 || s === 10) {
          var len = s === 0 ? 1.4 : 0.6, v = s === 0 ? 0.045 : 0.032;
          for (var k = 1; k < ch.length; k++) epiano(mtof(ch[k]), t + k * 0.01, len, v, p.gain);
        }
        if (s === 0) {
          // warmes Pad unter dem Takt
          for (var q = 0; q < 3; q++) {
            tone({ type: 'sawtooth', f: mtof(ch[q]), t: t, dur: 2.9, a: 0.6, hold: 1.4, vol: 0.012, out: p.gain, filter: 'lowpass', ff: 900 });
          }
        }
        var walk = { 0: 0, 6: 7, 8: 12, 12: 10, 14: 11 };
        if (walk[s] !== undefined) tone({ type: 'triangle', f: mtof(root + walk[s]), t: t, dur: s === 0 ? 0.9 : 0.4, a: 0.015, vol: 0.18, out: p.gain, filter: 'lowpass', ff: 650 });
        hat(t, p.gain, s % 4 === 2 ? 0.018 : 0.008);
        if (s % 2 === 0 && s !== 0) {
          var r = hrand(bar % 4 + 20, s);
          if (r < 0.4) epiano(mtof(ch[Math.floor(hrand(s + 3, bar % 4) * ch.length)] + 12), t, 0.7, 0.04, p.gain);
        }
      }
    },
    explore: {
      bpm: 80,
      barsPerChord: 2,
      // Am(add9) – Fmaj7 – Cadd9 – G6
      chords: [[57, 60, 64, 71], [53, 57, 60, 64], [48, 55, 62, 64], [55, 59, 62, 64]],
      roots: [45, 41, 36, 43],
      penta: [69, 72, 74, 76, 79, 81, 84, 86, 88],
      start: function (p, t) {
        // Echo für die Glocken
        var d = ac.createDelay(2), fb = ac.createGain(), lp = ac.createBiquadFilter(), wet = ac.createGain();
        d.delayTime.value = (60 / this.bpm) * 0.75; fb.gain.value = 0.32;
        lp.type = 'lowpass'; lp.frequency.value = 2600;
        d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.gain.value = 0.5; wet.connect(p.gain);
        p.send = d; p.nodes.push(d, fb, lp, wet);
      },
      step: function (p, i, t) {
        var def = this, barLen = 60 / def.bpm * 4;
        var ci = Math.floor(i / 32) % def.chords.length, ch = def.chords[ci];
        if (i % 32 === 0) {
          var dur = barLen * 2 + 1.5;
          for (var k = 0; k < ch.length; k++) {
            for (var dt = -1; dt <= 1; dt += 2) {
              var o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
              o.type = 'sawtooth'; o.frequency.value = mtof(ch[k]); o.detune.value = dt * 7;
              f.type = 'lowpass'; f.Q.value = 0.7;
              f.frequency.setValueAtTime(500, t);
              f.frequency.linearRampToValueAtTime(1300, t + barLen);
              f.frequency.linearRampToValueAtTime(600, t + dur);
              env(g.gain, t, 1.2, 0.022, dur, barLen * 2 - 1.2);
              o.connect(f); f.connect(g); g.connect(p.gain);
              o.start(t); o.stop(t + dur + 0.05);
              finish(o, [o, f, g]);
            }
          }
          tone({ f: mtof(def.roots[ci]), t: t, dur: barLen * 1.5, a: 0.4, vol: 0.12, out: p.gain });
        }
        // langsames pentatonisches Glocken-Arpeggio (Achtel, auf und ab, jede 4. Note Pause)
        if (i % 2 === 0) {
          var n = Math.floor(i / 2), seqLen = 12, ph = n % seqLen;
          if (ph % 4 !== 3) {
            var idx = ph < seqLen / 2 ? ph : seqLen - ph;
            idx = (idx + ci * 2) % def.penta.length;
            var note = def.penta[idx];
            var out = p.gain;
            fm({ f: mtof(note), ratio: 3.5, index: 2.4, index2: 0.05, t: t, dur: 1.6, vol: 0.07, out: out });
            if (p.send) fm({ f: mtof(note), ratio: 3.5, index: 2.4, index2: 0.05, t: t, dur: 1.6, vol: 0.045, out: p.send });
          }
        }
      }
    },
    combat: {
      bpm: 120,
      // Em – C – D – Bm  (i – VI – VII – v)
      roots: [40, 36, 38, 35],
      minor: [true, false, false, true],
      start: function (p, t) {
        drone(p, t, [['sawtooth', 41.2, 0.5]], 120, 0.06);
      },
      step: function (p, i, t) {
        var def = this, s = i % 16, bar = Math.floor(i / 16) % 4, root = def.roots[bar];
        var third = def.minor[bar] ? 3 : 4, x = (p.intensity == null ? state.intensity : p.intensity);
        var w = res().pulse;
        // L0: Pulsbass (Achtel) + Kick
        if (s % 2 === 0) {
          var pat = [0, 0, 12, 0, 0, 7, 0, 12];
          tone({ wave: w, f: mtof(root + pat[s / 2]), t: t, dur: 0.2, a: 0.005, vol: 0.11, out: p.gain, filter: 'lowpass', ff: 1800, ff2: 350, q: 3 });
        }
        if (s % 4 === 0) kick(t, p.gain, 0.42);
        // L1: Noise-Snare auf 2 und 4
        var l1 = layerGain(x, 0.2);
        if (l1 > 0 && (s === 4 || s === 12)) snare(t, p.gain, 0.3 * l1);
        // L2: Hi-Hats + Arpeggio-Ostinato
        var l2 = layerGain(x, 0.45);
        if (l2 > 0) {
          hat(t, p.gain, (s % 2 ? 0.05 : 0.03) * l2);
          var arp = [0, 7, 12, 7, third, 7, 12, 12 + third];
          tone({ wave: w, f: mtof(root + 24 + arp[s % 8]), t: t, dur: 0.11, a: 0.003, vol: 0.03 * l2, out: p.gain, filter: 'lowpass', ff: 2600 });
        }
        // L3: Akkord-Stöße (punktiert), Zusatz-Kick, Tom-Fill
        var l3 = layerGain(x, 0.72);
        if (l3 > 0) {
          if (s === 0 || s === 3 || s === 6) {
            var chord = [root + 24, root + 24 + third, root + 31];
            for (var k = 0; k < 3; k++) tone({ type: 'sawtooth', f: mtof(chord[k]), t: t, dur: 0.22, a: 0.005, vol: 0.026 * l3, out: p.gain, filter: 'lowpass', ff: 1900, ff2: 700 });
          }
          if (s === 14) kick(t, p.gain, 0.3 * l3);
          if (bar === 3 && s >= 12) tone({ f: 220 - (s - 12) * 30, f2: 80, t: t, dur: 0.14, vol: 0.2 * l3, out: p.gain });
        }
      }
    },
    mystery: {
      // Nebel / Kustoden-Relais: schwebend, kühl, sparsam. D-äolisch, kein Schlagwerk.
      bpm: 60,
      // D5(add9) – Bb(add9) – Gm(add9) – Asus4
      chords: [[50, 57, 62, 64], [46, 53, 57, 62], [43, 50, 57, 58], [45, 50, 52, 57]],
      // eigenes Motiv über 8 Takte: [Sechzehntel-Position, MIDI-Note], viel Pause
      motif: [[0, 74], [6, 77], [12, 76], [28, 69], [40, 72], [46, 74], [52, 70], [56, 69],
        [64, 81], [70, 77], [76, 76], [96, 74], [104, 72], [110, 69], [116, 70], [120, 74]],
      start: function (p, t) {
        drone(p, t, [['sine', 36.7, 0.7], ['sine', 55.0, 0.25], ['triangle', 73.6, 0.12]], 160, 0.12);
        var d = ac.createDelay(3), fb = ac.createGain(), lp = ac.createBiquadFilter(), wet = ac.createGain();
        d.delayTime.value = 0.9; fb.gain.value = 0.42;
        lp.type = 'lowpass'; lp.frequency.value = 1800;
        d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.gain.value = 0.55; wet.connect(p.gain);
        p.send = d; p.nodes.push(d, fb, lp, wet);
      },
      step: function (p, i, t) {
        var def = this, barLen = 60 / def.bpm * 4, ch = def.chords[Math.floor(i / 32) % def.chords.length];
        if (i % 32 === 0) {
          // kühles Pad: Sinus + Dreieck leicht verstimmt, langsam ein- und ausgeblendet
          var dur = barLen * 2 + 2;
          for (var k = 0; k < ch.length; k++) {
            tone({ f: mtof(ch[k]), detune: -5, t: t, dur: dur, a: 2.5, hold: barLen * 2 - 2.5, vol: 0.03, out: p.gain });
            tone({ type: 'triangle', f: mtof(ch[k] + 12), detune: 6, t: t + 0.3, dur: dur, a: 3, hold: barLen * 2 - 3.3,
              vol: 0.008, out: p.gain, filter: 'lowpass', ff: 1400 });
          }
        }
        var p16 = i % 128;
        for (var m = 0; m < def.motif.length; m++) {
          if (def.motif[m][0] !== p16) continue;
          var f = mtof(def.motif[m][1]);
          fm({ f: f, ratio: 1.414, index: 1.1, index2: 0.03, t: t, dur: 2.4, a: 0.01, vol: 0.05, out: p.gain });
          if (p.send) fm({ f: f, ratio: 1.414, index: 1.1, index2: 0.03, t: t, dur: 2.4, a: 0.01, vol: 0.04, out: p.send });
        }
        // seltenes Relais-Flimmern hoch oben
        if (i % 64 === 36) {
          tone({ f: mtof(93 + (Math.floor(i / 64) % 2) * 2), t: t, dur: 1.8, a: 0.5, vol: 0.012, out: p.gain });
          noise({ t: t, dur: 2.0, a: 0.8, vol: 0.015, out: p.gain, filter: 'bandpass', ff: 6000, q: 6 });
        }
      }
    },
    ruin: {
      // Mond Kesh / Kustoden-Ruine (M2): staubig, fremd, Vorläufer. E-phrygisch mit Tritonus-Färbung.
      // Intensität (setIntensity) schichtet bei Feindkontakt Rahmentrommeln, Pulsbass und Spannungsklang dazu.
      bpm: 72,
      roots: [40, 41, 40, 46],   // E – F – E – Bb (Tritonus)
      bells: [[0, 76], [10, 77], [24, 71], [36, 74], [44, 76], [64, 82], [74, 77], [88, 76], [100, 70], [112, 71]],
      start: function (p, t) {
        drone(p, t, [['sine', 41.2, 0.7], ['triangle', 61.7, 0.18], ['sine', 82.6, 0.1]], 150, 0.12);
        // Staubwind: langsam atmendes Bandrauschen
        var n = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
        n.buffer = res().noise; n.loop = true; n.playbackRate.value = 0.5;
        bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.4;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + 3);
        lfo.frequency.value = 0.09; lg.gain.value = 500;
        lfo.connect(lg); lg.connect(bp.frequency);
        n.connect(bp); bp.connect(g); g.connect(p.gain);
        n.start(t, Math.random() * 1.5); lfo.start(t);
        p.srcs.push(n, lfo); p.nodes.push(bp, g, lg);
        // langes Echo für die Glocken
        var d = ac.createDelay(3), fb = ac.createGain(), lp = ac.createBiquadFilter(), wet = ac.createGain();
        d.delayTime.value = 1.25; fb.gain.value = 0.38;
        lp.type = 'lowpass'; lp.frequency.value = 1600;
        d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.gain.value = 0.5; wet.connect(p.gain);
        p.send = d; p.nodes.push(d, fb, lp, wet);
      },
      step: function (p, i, t) {
        var def = this, s = i % 16, bar = Math.floor(i / 16), root = def.roots[bar % 4];
        var x = (p.intensity == null ? state.intensity : p.intensity), barLen = 60 / def.bpm * 4;
        // Grundschicht: hohle Quint-Pads je Takt, fremde Glocken (Teiltonverhältnis 2,76)
        if (s === 0) {
          var pad = [root + 12, root + 19, root + 24];
          for (var k = 0; k < pad.length; k++) {
            tone({ type: 'triangle', f: mtof(pad[k]), detune: k * 4 - 4, t: t, dur: barLen + 0.8, a: 0.9, hold: barLen - 1.2,
              vol: 0.022, out: p.gain, filter: 'lowpass', ff: 900 });
          }
          tone({ f: mtof(root), t: t, dur: barLen, a: 0.3, vol: 0.1, out: p.gain });
        }
        var p16 = i % 128;
        for (var m = 0; m < def.bells.length; m++) {
          if (def.bells[m][0] !== p16) continue;
          var f = mtof(def.bells[m][1]);
          fm({ f: f, ratio: 2.76, index: 1.3, index2: 0.03, t: t, dur: 2.0, a: 0.004, vol: 0.04, out: p.gain });
          if (p.send) fm({ f: f, ratio: 2.76, index: 1.3, index2: 0.03, t: t, dur: 2.0, a: 0.004, vol: 0.035, out: p.send });
        }
        // Rieseln: vereinzelte Steinkörner
        if (hrand(bar % 8, s) < 0.08) noise({ t: t, dur: 0.03, vol: 0.02, out: p.gain, filter: 'bandpass', ff: 3000 + hrand(s, bar) * 3000, q: 3 });
        // L1 (Kontakt): Rahmentrommel, eigener 3-3-2-Rhythmus
        var l1 = layerGain(x, 0.2);
        if (l1 > 0) {
          if (s === 0 || s === 6 || s === 12) tone({ f: 110, f2: 60, glide: 0.1, t: t, dur: 0.3, vol: 0.32 * l1, out: p.gain });
          if (s === 3 || s === 9 || s === 14) noise({ t: t, dur: 0.07, vol: 0.06 * l1, out: p.gain, filter: 'bandpass', ff: 900, q: 1.5 });
        }
        // L2 (Gefecht): Pulsbass in Achteln + Schellen
        var l2 = layerGain(x, 0.45);
        if (l2 > 0) {
          if (s % 2 === 0) {
            var pat = [0, 0, 1, 0, 0, 12, 1, 0];
            tone({ wave: res().pulse, f: mtof(root + pat[s / 2]), t: t, dur: 0.2, a: 0.005, vol: 0.09 * l2, out: p.gain,
              filter: 'lowpass', ff: 1400, ff2: 300, q: 3 });
          }
          if (s % 4 === 2) noise({ t: t, dur: 0.05, vol: 0.035 * l2, out: p.gain, filter: 'highpass', ff: 6500 });
        }
        // L3 (heftig): Spannungs-Cluster (kleine Sekunde + Tritonus), Zusatzschläge
        var l3 = layerGain(x, 0.72);
        if (l3 > 0) {
          if (s === 0 && bar % 2 === 0) {
            var cl = [root + 24, root + 25, root + 30];
            for (var c = 0; c < 3; c++) tone({ type: 'sawtooth', f: mtof(cl[c]), t: t, dur: barLen * 2, a: barLen, hold: 0.2,
              vol: 0.012 * l3, out: p.gain, filter: 'lowpass', ff: 1500 });
          }
          if (s === 10 || s === 15) tone({ f: 150, f2: 70, t: t, dur: 0.16, vol: 0.22 * l3, out: p.gain });
        }
      }
    }
  };

  function MoodPlayer(mood, t, out) {
    this.mood = mood;
    this.def = MOOD_DEFS[mood];
    this.gain = ac.createGain();
    this.gain.gain.setValueAtTime(0.0001, t);
    this.gain.gain.linearRampToValueAtTime(1, t + FADE);
    this.gain.connect(out);
    this.step = 0;
    this.next = t + 0.05;
    this.srcs = [];
    this.nodes = [];
    this.send = null;
    this.intensity = null;
    if (this.def.start) this.def.start(this, t);
  }
  MoodPlayer.prototype.scheduleUntil = function (until) {
    var sp = 60 / this.def.bpm / 4, guard = 0;
    while (this.next < until && guard++ < 256) {
      try { this.def.step(this, this.step, this.next); } catch (e) { fail('music.' + this.mood, e); }
      this.next += sp;
      this.step++;
    }
  };
  MoodPlayer.prototype.stop = function (t) {
    var g = this.gain.gain, self = this;
    g.cancelScheduledValues(t);
    g.setValueAtTime(pos(g.value), t);
    g.linearRampToValueAtTime(0.0001, t + FADE);
    for (var i = 0; i < this.srcs.length; i++) { try { this.srcs[i].stop(t + FADE + 0.1); } catch (_) { /* schon gestoppt */ } }
    later(function () { disc(self.srcs); disc(self.nodes); disc([self.gain]); }, (FADE + 1.5) * 1000);
  };

  function musicTick() {
    try {
      var cur = music.cur;
      if (!cur || !live) return;
      var now = live.ctx.currentTime;
      if (cur.next < now - 0.25) {  // Tab war gedrosselt: nicht nachholen, sondern weiterspielen
        var sp = 60 / cur.def.bpm / 4, skip = Math.ceil((now + 0.05 - cur.next) / sp);
        cur.next += skip * sp; cur.step += skip;
      }
      cur.scheduleUntil(now + LOOKAHEAD);
    } catch (e) { fail('musicTick', e); }
  }

  function applyMood(mood) {
    var t = ac.currentTime;
    if (music.cur && music.cur.mood === mood) return;
    if (music.cur) { music.cur.stop(t); music.cur = null; }
    if (mood !== 'none' && MOOD_DEFS[mood]) {
      music.cur = new MoodPlayer(mood, t, bus.music);
      music.cur.scheduleUntil(t + LOOKAHEAD);
      if (!music.timer) music.timer = setInterval(musicTick, TIMER_MS);
    } else if (music.timer) {
      clearInterval(music.timer); music.timer = null;   // ausblendende Stimmung braucht keine neuen Noten
    }
  }

  // ---------------------------------------------------------------- Loops
  var LOOP_LEVEL = { fire: 0.7, breach: 0.55, engine: 0.35, reactor_hum: 0.35 };

  function buildLoop(name, t, vol) {
    var L = { gain: ac.createGain(), srcs: [], nodes: [] };
    L.gain.gain.setValueAtTime(0.0001, t);
    L.gain.gain.linearRampToValueAtTime(pos(vol), t + 0.4);
    L.gain.connect(bus.loop);
    var r = res();
    function src(type, f) { var o = ac.createOscillator(); o.type = type; o.frequency.value = f; L.srcs.push(o); return o; }
    function nsrc(buf) { var s = ac.createBufferSource(); s.buffer = buf; s.loop = true; L.srcs.push(s); return s; }
    function node(n) { L.nodes.push(n); return n; }
    function filt(type, f, q) { var b = node(ac.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; return b; }
    function gain(v) { var g = node(ac.createGain()); g.gain.value = v; return g; }
    function lfo(rate, depth, target) { var o = src('sine', rate), g = gain(depth); o.connect(g); g.connect(target); }

    if (name === 'fire') {
      var c = nsrc(r.crackle), hp = filt('highpass', 120), g1 = gain(0.9);
      c.connect(hp); hp.connect(g1); g1.connect(L.gain);
      var n = nsrc(r.noise), lp = filt('lowpass', 400), g2 = gain(0.25);
      n.playbackRate.value = 0.7; n.connect(lp); lp.connect(g2); g2.connect(L.gain);
      lfo(0.6, 0.1, g2.gain);
    } else if (name === 'breach') {
      var n1 = nsrc(r.noise), bp = filt('bandpass', 2200, 1.2), gb = gain(0.6);
      n1.connect(bp); bp.connect(gb); gb.connect(L.gain);
      lfo(0.3, 700, bp.frequency);
      var n2 = nsrc(r.noise), lp2 = filt('lowpass', 280, 1), gs = gain(0.7);
      n2.playbackRate.value = 0.5; n2.connect(lp2); lp2.connect(gs); gs.connect(L.gain);
      lfo(0.45, 0.3, gs.gain);
    } else if (name === 'engine') {
      var lp3 = filt('lowpass', 220, 2), ge = gain(0.5);
      lp3.connect(ge); ge.connect(L.gain);
      var a = src('sawtooth', 55), b = src('sawtooth', 55.3), s = src('sine', 27.5), gs2 = gain(0.8);
      a.connect(lp3); b.connect(lp3); s.connect(gs2); gs2.connect(L.gain);
      lfo(0.2, 0.08, ge.gain);
    } else if (name === 'reactor_hum') {
      var gh = gain(0.5);
      gh.connect(L.gain);
      var h1 = src('sine', 110), h2 = src('sine', 220.4), h3 = src('triangle', 330.2);
      var g3 = gain(0.4), g4 = gain(0.12);
      h1.connect(gh); h2.connect(g3); g3.connect(gh); h3.connect(g4); g4.connect(gh);
      lfo(5.5, 0.12, gh.gain);
    }
    for (var i = 0; i < L.srcs.length; i++) L.srcs[i].start(t, L.srcs[i].buffer ? Math.random() * 1.5 : 0);
    return L;
  }

  function stopLoop(L, t) {
    var g = L.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(pos(g.value), t);
    g.linearRampToValueAtTime(0.0001, t + 0.5);
    for (var i = 0; i < L.srcs.length; i++) { try { L.srcs[i].stop(t + 0.6); } catch (_) { /* schon gestoppt */ } }
    later(function () { disc(L.srcs); disc(L.nodes); disc([L.gain]); }, 1200);
  }

  function applyLoop(name, on, vol) {
    var t = ac.currentTime, L = loops[name], v = clamp(vol, 0, 1) * LOOP_LEVEL[name];
    if (on) {
      if (L) {
        L.gain.gain.cancelScheduledValues(t);
        L.gain.gain.setValueAtTime(pos(L.gain.gain.value), t);
        L.gain.gain.linearRampToValueAtTime(pos(v), t + 0.2);
      } else {
        loops[name] = buildLoop(name, t, v);
      }
    } else if (L) {
      stopLoop(L, t);
      delete loops[name];
    }
  }

  // ---------------------------------------------------------------- öffentliche API
  GA.init = safe('init', function () {
    if (live) {
      if (live.ctx.state === 'suspended') live.ctx.resume();
      return true;
    }
    var Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) { GA.supported = false; return false; }
    var ctx = new Ctor();
    ac = ctx;
    bus = buildChain(ctx, false);
    live = { ctx: ctx, bus: bus };
    GA.ready = true;
    applyMaster();
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) { /* Browser lehnt ab */ } }
    // Vor init gemerkte Wünsche umsetzen
    if (state.mood !== 'none') applyMood(state.mood);
    for (var k in state.loops) if (state.loops[k]) applyLoop(k, true, state.loops[k].volume);
    return true;
  });

  // opts: { volume 0..1, pan -1..1 } wie bisher. M2-Zusätze, alle optional (Unbekanntes wird ignoriert):
  //   seg, max – shield_hit: seg = Segmente NACH dem Treffer (max Standard 3); ohne seg klingt er wie bisher.
  //              shield_up: seg = Segmente nach dem Laden (höherer Ding je Segment).
  //   syl      – bark: Silbenzahl 2..10; ersatzweise text (Silben = Länge/6) oder len (Zeichenzahl); q: true = Frage.
  //   dist     – 0..1 Entfernung zum Hörer (dumpfer, leiser), für alle Sounds, gedacht v. a. für enemy_aim.
  GA.play = safe('play', function (name, opts) {
    if (!live || !SFX.hasOwnProperty(name)) return;
    opts = opts || {};
    var nowMs = Date.now(), gap = MIN_GAP[name] || DEFAULT_GAP;
    if (lastPlay[name] && nowMs - lastPlay[name] < gap) return;
    if (voices > MAX_VOICES && !PRIORITY[name]) return;
    lastPlay[name] = nowMs;
    ac = live.ctx; bus = live.bus;
    if (ac.state === 'suspended') ac.resume();
    var vol = opts.volume == null ? 1 : clamp(opts.volume, 0, 1);
    var pan = opts.pan == null ? 0 : clamp(opts.pan, -1, 1);
    if (vol <= 0) return;
    playAt(name, ac.currentTime + 0.005, vol, pan, opts);
  });

  GA.setLoop = safe('setLoop', function (name, on, opts) {
    if (LOOP_LEVEL[name] === undefined) return;
    var vol = opts && opts.volume != null ? clamp(opts.volume, 0, 1) : 1;
    state.loops[name] = on ? { volume: vol } : null;
    if (!live) return;
    ac = live.ctx; bus = live.bus;
    applyLoop(name, !!on, vol);
  });

  GA.setMusic = safe('setMusic', function (mood) {
    if (MOODS.indexOf(mood) < 0) return;
    state.mood = mood;
    if (!live) return;
    ac = live.ctx; bus = live.bus;
    applyMood(mood);
  });

  GA.setIntensity = safe('setIntensity', function (x) {
    state.intensity = clamp(x, 0, 1);
  });

  GA.setVolume = safe('setVolume', function (v) {
    state.volume = clamp(v, 0, 1);
    applyMaster();
  });

  GA.mute = safe('mute', function (b) {
    state.muted = b === undefined ? true : !!b;
    applyMaster();
  });

  // Diagnose (nicht Teil des Vertrags)
  GA.getState = function () {
    return {
      ready: GA.ready, supported: GA.supported, ctxState: live ? live.ctx.state : 'none',
      mood: state.mood, intensity: state.intensity, volume: state.volume, muted: state.muted,
      loops: Object.keys(loops), voices: voices, errors: GA.errors
    };
  };

  // Test-Hilfe: rendert einen Sound/Loop/eine Stimmung offline und misst Pegel.
  // kind: 'sfx'|'loop'|'music'. Liefert Promise<{peak, rms}>. raw=true misst ohne Soft-Clipper.
  GA._renderOffline = function (kind, name, seconds, opts) {
    opts = opts || {};
    var Off = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!Off) return Promise.reject(new Error('kein OfflineAudioContext'));
    var sr = 44100, off = new Off(2, Math.floor(sr * seconds), sr);
    var prevAc = ac, prevBus = bus;
    try {
      ac = off;
      bus = buildChain(off, !!opts.raw);
      bus.master.gain.value = 1;
      if (kind === 'sfx') {
        var reps = opts.repeat || 1;
        for (var i = 0; i < reps; i++) playAt(name, 0.02 + i * (opts.every || 0.1), 1, opts.pan || 0, opts.prm || null);
      } else if (kind === 'loop') {
        buildLoop(name, 0, LOOP_LEVEL[name]);
      } else if (kind === 'music') {
        var p = new MoodPlayer(name, 0, bus.music);
        p.intensity = opts.intensity == null ? 1 : opts.intensity;
        p.scheduleUntil(seconds);
      }
    } catch (e) {
      ac = prevAc; bus = prevBus;
      return Promise.reject(e);
    }
    ac = prevAc; bus = prevBus;
    return off.startRendering().then(function (buf) {
      var peak = 0, sum = 0, n = 0;
      for (var c = 0; c < buf.numberOfChannels; c++) {
        var d = buf.getChannelData(c);
        for (var j = 0; j < d.length; j++) { var a = Math.abs(d[j]); if (a > peak) peak = a; sum += d[j] * d[j]; n++; }
      }
      return { peak: peak, rms: Math.sqrt(sum / Math.max(1, n)) };
    });
  };

  global.GameAudio = GA;
})(typeof window !== 'undefined' ? window : this);
