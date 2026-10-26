'use strict';
// Systemprompt für die Ollama-Route (SUND-03 B2). Gemma liest den Lexikon-Absatz des Szenen-Systemprompts und erfindet
// {{lex.<Nomen>:die}}-Platzhalter (Erkundung SUND-03, Frage 2: 99 von 101 Fehlläufen; ohne den Absatz 186 von 186 Läufen gültig).
// Hier wird der Absatz durch ein kurzes Verbot ersetzt. Der Claude-Prompt bleibt unberührt (eigene Datei, unverändert).
//
//   systemFuerOllama(kind, system)   // system = Dateipfad oder Text des Claude-Prompts -> Text für Ollama (sonst unverändert)
const fs = require('fs');

const ABSATZ_VON = '- **Lexikon-Platzhalter';
const ABSATZ_BIS = '- Namens-Parameter';
const VERBOT = '- **Keine Platzhalter:** Schreibe nie `{{…}}` in Texte. Artikel und Wörter schreibst du selbst aus.\n';

// Szenen-Prompt ohne Lexikon-Absatz; null, wenn die Absatzgrenzen nicht gefunden werden (dann bleibt der Prompt wie er ist)
function szeneOhneLexikon(text) {
  const a = text.indexOf(ABSATZ_VON); const b = text.indexOf(ABSATZ_BIS);
  if (a < 0 || b < a) return null;
  return text.slice(0, a) + VERBOT + text.slice(b);
}
const memo = new Map();
function lies(system) {
  const s = String(system);
  if (s.includes('\n') || s.length > 400) return s;
  try { if (fs.existsSync(s) && fs.statSync(s).isFile()) return fs.readFileSync(s, 'utf8'); } catch (e) { /* kein Pfad */ }
  return s;
}
function systemFuerOllama(kind, system) {
  if (kind !== 'szene' || !system) return system;
  const text = lies(system);
  const key = text.length + ':' + text.slice(0, 40);
  if (!memo.has(key)) memo.set(key, szeneOhneLexikon(text) || text);
  return memo.get(key);
}
module.exports = { systemFuerOllama, szeneOhneLexikon, VERBOT };
