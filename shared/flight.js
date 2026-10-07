// Gemeinsames Flugmodell (CONTRACT-M3B §2). UMD: window.Shared_Flight / require. Reine Funktionen, kein Zufall.
// Ein Schiff hat einen Temporegler in Stufen (cls.stages = Anteile von maxSpeed), regelt sein Vorwärtstempo darauf
// ein (accel / decel, Allstopp: decel × brakeFactor), dämpft Querbewegung (lateralDrag) und dreht abhängig vom Tempo
// (turnCurve; bei ½ am wendigsten). Server (maßgeblich) und Client (Anzeige/Vorhersage) benutzen dieselben Funktionen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared_Flight = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function normAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a <= -Math.PI) a += 2 * Math.PI;
    return a;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Drehfaktor 0..1 für ein (vorzeichenbehaftetes) Vorwärtstempo in px/s: lineare Interpolation über cls.turnCurve
  // (Stützpunkte [Tempo/maxSpeed, Faktor]). Außerhalb der Stützpunkte gilt der Randwert.
  function turnFactor(cls, speed) {
    const curve = cls.turnCurve;
    if (!curve || !curve.length) return 1;
    const f = cls.maxSpeed > 0 ? speed / cls.maxSpeed : 0;
    if (f <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1], b = curve[i];
      if (f <= b[0]) {
        const span = b[0] - a[0];
        return span > 0 ? a[1] + (b[1] - a[1]) * (f - a[0]) / span : b[1];
      }
    }
    return curve[curve.length - 1][1];
  }

  // Nenntempo einer Stufe in px/s (ohne Triebwerks-/Energiefaktor)
  function stageSpeed(cls, stage) {
    const st = cls.stages || [0];
    const i = clamp(Math.round(stage) || 0, 0, st.length - 1);
    return st[i] * cls.maxSpeed;
  }
  // Index der Stufe „Stopp“ (Anteil 0); gibt es keine, die langsamste Stufe
  function stopStage(cls) {
    const st = cls.stages || [0];
    const i = st.indexOf(0);
    if (i >= 0) return i;
    let best = 0;
    for (let k = 1; k < st.length; k++) if (Math.abs(st[k]) < Math.abs(st[best])) best = k;
    return best;
  }
  // Index der wendigsten Vorwärtsstufe (höchster Drehfaktor) – „½“ bei Lerche und Kanonenboot
  function agileStage(cls) {
    const st = cls.stages || [0];
    let best = 0, bf = -1;
    for (let k = 0; k < st.length; k++) {
      if (st[k] < 0) continue;
      const f = turnFactor(cls, st[k] * cls.maxSpeed);
      if (f > bf + 1e-9) { bf = f; best = k; }
    }
    return best;
  }

  // Vorwärtstempo (vorzeichenbehaftet) eines Körpers
  function forwardSpeed(body) { return (body.vx || 0) * Math.cos(body.angle) + (body.vy || 0) * Math.sin(body.angle); }

  // Einen Zeitschritt fliegen. Verändert body und gibt ihn zurück.
  // body  = { x, y, angle, vx, vy, turnVel, stage, dodgeT? }   dodgeT = Restsekunden der Dreh-Strafe nach dem Ausweichen
  // input = { stage?, rudder: -1..1, brake: bool }               stage fehlt -> body.stage bleibt
  // mods  = { speedFactor, turnCapPort, turnCapStbd }            alle optional (Standard 1)
  function stepBody(body, input, cls, mods, dt) {
    input = input || {};
    mods = mods || {};
    const stages = cls.stages || [0];
    if (input.stage != null) body.stage = clamp(Math.round(input.stage), 0, stages.length - 1);
    if (body.stage == null) body.stage = stopStage(cls);
    const sf = mods.speedFactor != null ? Math.max(0, mods.speedFactor) : 1;
    const brake = !!input.brake;

    // ---- Drehen (Drehfaktor nach dem Tempo vor dem Schritt) ----
    const f0 = forwardSpeed(body);
    const rudder = clamp(Number(input.rudder) || 0, -1, 1);
    const capP = mods.turnCapPort != null ? mods.turnCapPort : 1;
    const capS = mods.turnCapStbd != null ? mods.turnCapStbd : 1;
    let goal = rudder * (cls.turnRate || 0) * turnFactor(cls, f0) * (rudder < 0 ? capP : capS);
    if (body.dodgeT > 0) {
      const pen = cls.dodge && cls.dodge.turnPenalty != null ? cls.dodge.turnPenalty : 1;
      goal *= pen;
      body.dodgeT = Math.max(0, body.dodgeT - dt);
    }
    const ta = (cls.turnAccel || 1) * dt;
    const tv = body.turnVel || 0;
    body.turnVel = Math.abs(goal - tv) <= ta ? goal : tv + Math.sign(goal - tv) * ta;
    body.angle = normAngle(body.angle + body.turnVel * dt);

    // ---- Geschwindigkeit im neuen Kurs zerlegen (wie bisher: Drehen „schiebt“ nicht, Querdämpfung zieht nach) ----
    const hx = Math.cos(body.angle), hy = Math.sin(body.angle);
    let f = (body.vx || 0) * hx + (body.vy || 0) * hy;    // vorwärts
    let l = -(body.vx || 0) * hy + (body.vy || 0) * hx;   // quer (Steuerbord positiv)

    // ---- Tempo: auf die Stufe regeln. Weg von 0 mit accel, Richtung 0 mit decel (Allstopp: decel × brakeFactor) ----
    const target = brake ? 0 : stageSpeed(cls, body.stage) * sf;
    const accel = (cls.accel || 0) * dt;
    const decel = (cls.decel || 0) * (brake ? (cls.brakeFactor || 1) : 1) * dt;
    if (f < target) {
      f = f < 0 ? Math.min(f + decel, Math.min(target, 0)) : Math.min(f + accel, target);
    } else if (f > target) {
      f = f > 0 ? Math.max(f - decel, Math.max(target, 0)) : Math.max(f - accel, target);
    }
    // Mindesttempo (Jäger können nicht stehen bleiben; ohne Antrieb gilt es nicht)
    const vmin = sf > 0 ? (cls.minSpeed || 0) : 0;
    if (vmin > 0 && f < vmin) f = vmin;

    // ---- Drift: Querbewegung dämpfen; der Allstopp bremst sie zusätzlich ----
    l *= Math.max(0, 1 - (cls.lateralDrag || 0) * dt);
    if (brake) l = Math.abs(l) <= decel ? 0 : l - Math.sign(l) * decel;

    body.vx = f * hx - l * hy;
    body.vy = f * hy + l * hx;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    return body;
  }

  return { stepBody, turnFactor, stageSpeed, stopStage, agileStage, forwardSpeed, normAngle };
});
