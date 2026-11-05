'use strict';
// TEL-01 G: Laufzeitprobe zur Grenze der Buchungsdienste. KEIN Spielcode: wird nur von tools/test-buchungen.js als Preload geladen
//   node -r ./tools/buchungen-probe.js <Skript> [Argumente]
// Hüllt game.inventory jedes Game (auch nach reset()) in einen Proxy, dessen set/defineProperty/deleteProperty über den Aufrufer prüft: ein Schreibzugriff auf
// marks oder ein Verbrauchsgut ist nur erlaubt, wenn der aufrufende Code server/sim/geld.js oder server/sim/vorrat.js ist – gleich in welcher Syntax er geschrieben wurde
// (Alias, Destructuring, Parameter, Reflect, Object.assign, || {} …). Das Ersetzen des ganzen Objekts ist nur in server/game.js erlaubt (Anlage in reset()).
// Aufrufer ausserhalb von server/ und shared/ (Tests, Bots in tools/) werden nicht beanstandet. Der Proxy ändert keinen Wert und kein Ereignis.
// Ausgabe beim Beenden: "[buchungen-probe] <n> Schreibzugriffe geprüft, <m> Verstöße" (+ Liste); bei Verstößen Exit-Code 1.
const path = require('path');

const ROOT = (process.env.BUCHUNGEN_ROOT || path.join(__dirname, '..')).split(path.sep).join('/').replace(/\/$/, '');
const NAMEN = new Set(['marks', 'bolzen', 'sonde', 'medipack', 'loeschgel', 'loeschgelCharges', 'medipackCharges', 'ersatzteil', 'flickblech', 'tafel', 'ladung']);
const DIENSTE = [ROOT + '/server/sim/geld.js', ROOT + '/server/sim/vorrat.js'];
const SELF = path.join(__dirname, 'buchungen-probe.js').split(path.sep).join('/');
Error.stackTraceLimit = 40;

let geprueft = 0;
const verstoesse = new Map();   // "datei:zeile  Schlüssel" -> Anzahl

// Erster Rahmen des Aufrufers: Rahmen ohne Datei (Reflect.set, Array.forEach, node:internal) und die Probe selbst überspringen
function aufrufer() {
  const zeilen = (new Error().stack || '').split('\n').slice(1);
  for (const z of zeilen) {
    const m = /(?:\(|\s)((?:[A-Za-z]:)?[^()\s]*?\.js):(\d+):(\d+)\)?\s*$/.exec(z);
    if (!m) continue;
    const datei = m[1].split('\\').join('/').replace(/^file:\/\/\//, '');
    if (datei === SELF || datei.startsWith('node:')) continue;
    return { datei, zeile: Number(m[2]) };
  }
  return null;
}
const imSpiel = (datei) => datei.startsWith(ROOT + '/server/') || datei.startsWith(ROOT + '/shared/');
function pruefen(was) {
  geprueft++;
  const a = aufrufer();
  if (!a || !imSpiel(a.datei) || DIENSTE.includes(a.datei)) return;
  const k = a.datei.slice(ROOT.length + 1) + ':' + a.zeile + '  ' + was;
  verstoesse.set(k, (verstoesse.get(k) || 0) + 1);
}
const handler = {
  set(t, k, v) { if (NAMEN.has(k)) pruefen('set ' + String(k)); return Reflect.set(t, k, v); },
  defineProperty(t, k, d) { if (NAMEN.has(k)) pruefen('defineProperty ' + String(k)); return Reflect.defineProperty(t, k, d); },
  deleteProperty(t, k) { if (NAMEN.has(k)) pruefen('delete ' + String(k)); return Reflect.deleteProperty(t, k); },
};

const { Game } = require(ROOT + '/server/game.js');
const SLOT = Symbol('inventory');
Object.defineProperty(Game.prototype, 'inventory', {
  configurable: true,
  enumerable: false,
  get() { return this[SLOT]; },
  set(v) {
    geprueft++;
    const a = aufrufer();
    if (a && imSpiel(a.datei) && a.datei !== ROOT + '/server/game.js') verstoesse.set(a.datei.slice(ROOT.length + 1) + ':' + a.zeile + '  ganzes Inventar ersetzt', 1);
    this[SLOT] = v && typeof v === 'object' ? new Proxy(v, handler) : v;
  },
});

process.on('exit', () => {
  console.log(`[buchungen-probe] ${geprueft} Schreibzugriffe geprüft, ${verstoesse.size} Verstöße`);
  for (const [k, n] of verstoesse) console.log('  Verstoß: ' + k + ' (' + n + 'x)');
  if (verstoesse.size) process.exitCode = 1;
});
