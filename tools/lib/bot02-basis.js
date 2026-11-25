'use strict';
// BOT-02: Basisbaum fuer den Vergleich "reine Menschenpartie byte-gleich". Die Basis ist kein fest verdrahteter Commit (der veraltet mit jeder gewollten Spielaenderung auf main), sondern
// `git merge-base HEAD main`: der Stand, auf dem dieser Zweig aufsetzt. Gewollte Aenderungen auf main, die der Zweig noch nicht kennt, liegen nicht in der Basis; was der Zweig selbst
// an der Menschenpartie aendert, faellt auf. Ohne Ref main (flacher Klon, anderer Hauptzweig) oder ohne git: { ref: null, grund } - der Aufrufer meldet das als info, nicht als Fehler.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const WURZEL = path.join(__dirname, '..', '..');
const git = (args, opt) => cp.execFileSync('git', args, Object.assign({ cwd: WURZEL, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 29 }, opt || {}));

// Entpackt die Basis nach <tmp>/basis. Rueckgabe: { ref, baum } oder { ref: null, grund }
function basisBaum(tmp, hauptzweig) {
  let ref;
  try { ref = git(['merge-base', 'HEAD', hauptzweig || 'main'], { encoding: 'utf8' }).trim(); } catch (e) { return { ref: null, grund: 'kein merge-base mit ' + (hauptzweig || 'main') + ' (' + String(e.message).split('\n')[0].slice(0, 80) + ')' }; }
  if (!/^[0-9a-f]{7,40}$/.test(ref)) return { ref: null, grund: 'merge-base liefert keinen Commit' };
  const baum = path.join(tmp, 'basis');
  try {
    fs.mkdirSync(baum, { recursive: true });
    // ohne Shell und ohne -C <Laufwerkspfad> (GNU tar liest C: als Host)
    cp.execFileSync('tar', ['-x'], { cwd: baum, input: git(['archive', ref]) });
    if (!fs.existsSync(path.join(baum, 'server', 'game.js'))) return { ref: null, grund: 'Basisbaum ' + ref.slice(0, 8) + ' enthaelt server/game.js nicht' };
  } catch (e) { return { ref: null, grund: 'git archive ' + ref.slice(0, 8) + ' nicht moeglich: ' + String(e.message).split('\n')[0].slice(0, 80) }; }
  return { ref: ref.slice(0, 8), baum };
}

module.exports = { basisBaum };
