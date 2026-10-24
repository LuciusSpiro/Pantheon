'use strict';
// Transport-Router des Spielleiters (SUND-03 B): ein Transport-Objekt für llm.create({ transport }), das je Anfrageart
// (`kind`: grobplan | szene | text) an einen Anbieter verzweigt.
//
//   const T = routeTransport({ grobplan: { anbieter: 'claude', modell: 'sonnet' }, szene: { anbieter: 'ollama' }, text: { anbieter: 'ollama' } },
//                            { eskalation: { anbieter: 'claude', modell: 'sonnet' } /* | null = keine */, transports: { claude, ollama } })
//   T.call(text, { system, model, timeoutMs, kind, schema, anbieter? })   // -> Antwort des Anbieters + { anbieter, modell }
//   T.anbieterFuer(kind[, erzwungen]) / T.eskalationFuer(kind)             // 'claude' | 'ollama' | null
//
// Jeder Eintrag der Arten darf auch ein fertiges Transport-Objekt sein ({ name, call }); sein name zählt dann als Anbieter.
// Das Schema (JSON-Schema für Ollama `format`) geht nur an Ollama, Claude bekommt es nicht.
//
// Eskalation: Eine Anfrage, die an Ollama ging und deren Antwort der Spielleiter nach der Prüfung verwirft, schickt der Spielleiter
// über llm.eskaliere() mit `anbieter` = eskalationFuer(kind) an Claude (nicht ein zweiter Versuch bei Gemma). Zusätzlich fällt der
// Router selbst auf die Eskalation zurück, wenn Ollama gar nicht erreichbar ist (OFFLINE, schnell erkennbar) – die Antwort trägt dann
// `eskaliert: true`. Ist auch Claude tot, wirft der Aufruf; der Spielleiter bleibt bei der Rohfassung (S2).
//
// Konfiguration aus der Umgebung (routerAusEnv): LLM_ROUTER=1 (Standardzuordnung) und/oder
//   LLM_ANBIETER_GROBPLAN|SZENE|TEXT = claude|ollama,  LLM_MODELL_GROBPLAN|SZENE|TEXT = Modellname des Anbieters,
//   LLM_ESKALATION = claude|aus (Standard claude), LLM_ESKALATION_MODELL (Standard sonnet).
// Standard: grobplan -> claude (sonnet), szene -> ollama, text -> ollama. Ohne diese Variablen ist kein Router aktiv.

const LLM = require('./llm.js');
const Ollama = require('./transport-ollama.js');

const ARTEN = ['grobplan', 'szene', 'text'];
const ANBIETER = ['claude', 'ollama'];
const STANDARD = { grobplan: { anbieter: 'claude', modell: 'sonnet' }, szene: { anbieter: 'ollama' }, text: { anbieter: 'ollama' } };
const STANDARD_ESKALATION = { anbieter: 'claude', modell: 'sonnet' };

function norm(eintrag, art) {
  const std = STANDARD[art];
  if (eintrag && typeof eintrag === 'object' && typeof eintrag.call === 'function') return { transport: eintrag, anbieter: eintrag.name || 'claude', modell: eintrag.modell };
  const e = eintrag && typeof eintrag === 'object' ? eintrag : {};
  const anbieter = String(e.anbieter || std.anbieter).toLowerCase();
  if (!ANBIETER.includes(anbieter)) throw new Error(`Unbekannter Anbieter '${anbieter}' für '${art}' (erlaubt: ${ANBIETER.join(', ')})`);
  // Modell: eigene Angabe, sonst Standard nur bei unverändertem Anbieter (Claude: sonnet; Ollama: Standard des Transports)
  const modell = e.modell || (anbieter === std.anbieter ? std.modell : (anbieter === 'claude' ? 'sonnet' : undefined));
  return { anbieter, modell };
}

function routeTransport(arten, o) {
  const opts = o || {};
  const cfg = {};
  for (const a of ARTEN) cfg[a] = norm(arten && arten[a], a);
  const eskCfg = opts.eskalation === null || opts.eskalation === false ? null
    : (opts.eskalation === undefined ? Object.assign({}, STANDARD_ESKALATION) : norm(opts.eskalation, 'grobplan'));
  if (eskCfg && eskCfg.anbieter !== 'claude') throw new Error(`Eskalation nur an claude (nicht '${eskCfg.anbieter}')`);
  const T = Object.assign({ claude: LLM.TRANSPORTS.cli, ollama: Ollama.create({ env: opts.env }) }, opts.transports || {});
  const transportOf = (anbieter, eintrag) => (eintrag && eintrag.transport) || T[anbieter];

  const anbieterFuer = (kind, erzwungen) => {
    if (erzwungen) return erzwungen;
    return (cfg[kind] || { anbieter: 'claude' }).anbieter;
  };
  // Eskalation gibt es nur für Arten, die an Ollama gehen (Claude eskaliert nicht an sich selbst)
  const eskalationFuer = (kind) => (eskCfg && cfg[kind] && cfg[kind].anbieter === 'ollama' ? eskCfg.anbieter : null);

  async function einzeln(text, c, anbieter, modell, eintrag) {
    const t = transportOf(anbieter, eintrag);
    const co = Object.assign({}, c);
    delete co.anbieter;
    if (anbieter === 'ollama') { co.model = modell; } else { delete co.schema; if (modell) co.model = modell; }
    const r = await t.call(text, co);
    return Object.assign({}, r, { anbieter, modell: r.modelId || modell || null });
  }

  return {
    name: 'router',
    arten: cfg, eskalation: eskCfg,
    anbieterFuer, eskalationFuer,
    async call(text, c) {
      const co = c || {};
      const kind = co.kind;
      const eintrag = cfg[kind];
      // ausdrücklich erzwungener Anbieter (Eskalation): Modell der Eskalation
      if (co.anbieter) {
        const modell = eskCfg && eskCfg.anbieter === co.anbieter ? eskCfg.modell : (eintrag && eintrag.anbieter === co.anbieter ? eintrag.modell : undefined);
        const r = await einzeln(text, co, co.anbieter, modell, null);
        return Object.assign(r, { eskaliert: true });
      }
      if (!eintrag) return einzeln(text, co, 'claude', co.model, null);   // Art ohne Eintrag (direkter Aufruf): wie bisher Claude
      try {
        return await einzeln(text, co, eintrag.anbieter, eintrag.modell, eintrag);
      } catch (e) {
        const ziel = e && e.code === 'OFFLINE' ? eskalationFuer(kind) : null;
        if (!ziel) throw e;
        const r = await einzeln(text, co, ziel, eskCfg.modell, null);
        return Object.assign(r, { eskaliert: true });
      }
    },
  };
}

function ist(v) { return v !== undefined && v !== ''; }
// Router nur, wenn die Umgebung ihn verlangt (LLM_ROUTER=1 oder eine LLM_ANBIETER_*); sonst null = bisheriges Verhalten.
function routerAusEnv(env, opts) {
  const e = env || process.env;
  const gewaehlt = e.LLM_ROUTER === '1' || ARTEN.some((a) => ist(e['LLM_ANBIETER_' + a.toUpperCase()]));
  if (!gewaehlt) return null;
  const arten = {};
  for (const a of ARTEN) arten[a] = { anbieter: ist(e['LLM_ANBIETER_' + a.toUpperCase()]) ? e['LLM_ANBIETER_' + a.toUpperCase()] : undefined, modell: ist(e['LLM_MODELL_' + a.toUpperCase()]) ? e['LLM_MODELL_' + a.toUpperCase()] : undefined };
  const esk = String(e.LLM_ESKALATION || 'claude').toLowerCase();
  const eskalation = esk === 'aus' || esk === 'nein' || esk === '0' ? null : { anbieter: esk, modell: ist(e.LLM_ESKALATION_MODELL) ? e.LLM_ESKALATION_MODELL : 'sonnet' };
  return routeTransport(arten, Object.assign({ eskalation, env: e }, opts || {}));
}

module.exports = { routeTransport, routerAusEnv, ARTEN, ANBIETER, STANDARD };
