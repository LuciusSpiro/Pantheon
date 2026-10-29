'use strict';
// Transport-Router des Spielleiters (SUND-03 B): ein Transport-Objekt für llm.create({ transport }), das je Anfrageart
// (`kind`: grobplan | szene | text) an einen Anbieter verzweigt.
//
//   const T = routeTransport({ grobplan: { anbieter: 'claude', modell: 'sonnet' }, szene: { anbieter: 'ollama' }, text: { anbieter: 'ollama' } },
//                            { eskalation: { anbieter: 'claude', modell: 'sonnet' } /* | null = keine */, transports: { claude, ollama } })
//   T.call(text, { system, model, timeoutMs, kind, schema })              // -> Antwort des Anbieters + { anbieter, modell }
//   T.callEskalation(text, { system, timeoutMs, kind })                    // -> dieselbe Anfrage beim Eskalations-Anbieter (eskaliert:true)
//   T.anbieterFuer(kind) / T.eskalationFuer(kind)                          // 'claude' | 'ollama' | null
//
// Jeder Eintrag der Arten darf auch ein fertiges Transport-Objekt sein ({ name, call }); sein name zählt dann als Anbieter.
// Das Schema (JSON-Schema für Ollama `format`) geht nur an Ollama, Claude bekommt es nicht.
//
// Eskalation: Eine Anfrage, die an Ollama ging und deren Antwort der Spielleiter nach der Prüfung verwirft, schickt der Spielleiter
// über llm.eskaliere() (-> callEskalation) an Claude (nicht ein zweiter Versuch bei Gemma). Dasselbe gilt, wenn Ollama
// ausfällt (OFFLINE, EMPTY, EXIT): der Router fällt nie selbst zurück, sondern meldet den Fehler (mit anbieter/modell); die
// Eskalation geht nur über callEskalation (eine Stelle, Budgetprüfung in llm.js). Ist auch Claude tot, wirft der Aufruf; der Spielleiter bleibt bei der Rohfassung (S2).
//
// Konfiguration aus der Umgebung (routerAusEnv): LLM_ROUTER=1 (Standardzuordnung) und/oder
//   LLM_ANBIETER_GROBPLAN|SZENE|TEXT = claude|ollama,  LLM_MODELL_GROBPLAN|SZENE|TEXT = Modellname des Anbieters,
//   LLM_ESKALATION = claude|aus (Standard claude), LLM_ESKALATION_MODELL (Standard sonnet).
// Standard: grobplan -> claude (sonnet), szene -> ollama, text -> ollama. Ohne diese Variablen ist kein Router aktiv.
//
// SUND-04b A2, Stufen (server/mission/stufen.js, content/spielleiter/stufen.json): bauplan | figuren_haupt | figuren_neben | geruechte_funk sind weitere Arten dieses Routers, mit denselben Variablen
// (LLM_ANBIETER_BAUPLAN, LLM_MODELL_BAUPLAN, ...; dazu LLM_ESKALATION_<STUFE>). Anders als grobplan und lage duerfen sie bei Claude ODER Ollama liegen. Eine Anfrage nennt ihre Stufe (opts.stufe) oder ihre
// Art ordnet sie zu (abenteuer -> bauplan); die Eskalation an Claude gibt es fuer eine Stufe nur mit eskalation: true (Standard aus).

const LLM = require('./llm.js');
const Ollama = require('./transport-ollama.js');
const Prompts = require('./prompts-ollama.js');

const Stufen = require('./stufen.js');
const ARTEN_ALT = ['grobplan', 'szene', 'text', 'lage'];   // lage (SUND-03 A2): Grobplan des Lage-Spielleiters, wie der Grobplan immer Claude
const STUFEN = Stufen.STUFEN;   // SUND-04b A2
const ARTEN = ARTEN_ALT.concat(STUFEN);
const ANBIETER = ['claude', 'ollama'];
const STANDARD = { grobplan: { anbieter: 'claude', modell: 'sonnet' }, szene: { anbieter: 'ollama' }, text: { anbieter: 'ollama' }, lage: { anbieter: 'claude', modell: 'sonnet' } };
for (const s of STUFEN) STANDARD[s] = { anbieter: Stufen.STANDARD[s].anbieter, modell: Stufen.STANDARD[s].modell || undefined };
const STANDARD_ESKALATION = { anbieter: 'claude', modell: 'sonnet' };

function norm(eintrag, art) {
  const std = STANDARD[art];
  if (eintrag && typeof eintrag === 'object' && typeof eintrag.call === 'function') return { transport: eintrag, anbieter: eintrag.name || 'claude', modell: eintrag.modell };
  const e = eintrag && typeof eintrag === 'object' ? eintrag : {};
  const anbieter = String(e.anbieter || std.anbieter).toLowerCase();
  if (art === 'grobplan' && anbieter === 'ollama') throw new Error("Der Grobplan bleibt bei Claude (LLM_ANBIETER_GROBPLAN=ollama ist nicht erlaubt)");
  if (art === 'lage' && anbieter === 'ollama') throw new Error("Der Grobplan der Lage bleibt bei Claude (LLM_ANBIETER_LAGE=ollama ist nicht erlaubt)");
  if (!ANBIETER.includes(anbieter)) throw new Error(`Unbekannter Anbieter '${anbieter}' für '${art}' (erlaubt: ${ANBIETER.join(', ')})`);
  // Modell: eigene Angabe, sonst Standard nur bei unverändertem Anbieter (Claude: sonnet; Ollama: Standard des Transports)
  const modell = e.modell || (anbieter === std.anbieter ? std.modell : (anbieter === 'claude' ? 'sonnet' : undefined));
  if (STUFEN.includes(art)) return { anbieter, modell, eskalation: e.eskalation === true && anbieter === 'ollama' };   // SUND-04b A2: Eskalation je Stufe, nur fuer Stufen bei Ollama
  return { anbieter, modell };
}

function routeTransport(arten, o) {
  const opts = o || {};
  const cfg = {};
  for (const a of ARTEN) cfg[a] = norm(arten && arten[a], a);
  const eskCfg = opts.eskalation === null || opts.eskalation === false ? null
    : (opts.eskalation === undefined ? Object.assign({}, STANDARD_ESKALATION) : norm(opts.eskalation, 'szene'));
  if (eskCfg && eskCfg.anbieter !== 'claude') throw new Error(`Eskalation nur an claude (nicht '${eskCfg.anbieter}')`);
  const T = Object.assign({ claude: LLM.TRANSPORTS.cli, ollama: Ollama.create({ env: opts.env }) }, opts.transports || {});
  const transportOf = (anbieter, eintrag) => (eintrag && eintrag.transport) || T[anbieter];

  // SUND-04b A2: der Schluessel der Konfiguration einer Anfrage: ihre Stufe (opts.stufe), sonst die Stufe ihrer Art (abenteuer -> bauplan), sonst die Art selbst
  const schluessel = (kind, stufe) => {
    if (stufe && cfg[stufe] && STUFEN.includes(stufe)) return stufe;
    const s = Stufen.stufeFuerKind(kind);
    return s && cfg[s] ? s : kind;
  };
  const anbieterFuer = (kind, stufe) => (cfg[schluessel(kind, stufe)] || { anbieter: 'claude' }).anbieter;
  // Eskalation gibt es nur für Arten, die an Ollama gehen (Claude eskaliert nicht an sich selbst); eine Stufe eskaliert nur mit ihrem eigenen Schalter
  const eskalationFuer = (kind, stufe) => {
    const k = schluessel(kind, stufe), c = cfg[k];
    if (!eskCfg || !c || c.anbieter !== 'ollama') return null;
    if (STUFEN.includes(k) && c.eskalation !== true) return null;
    return eskCfg.anbieter;
  };

  // Ein Aufruf bei einem Anbieter. Fehler tragen anbieter/modell (für das Regie-Logbuch), nichts wird verschluckt.
  async function einzeln(text, c, anbieter, modell, eintrag) {
    const t = transportOf(anbieter, eintrag);
    const co = Object.assign({}, c);
    if (anbieter === 'ollama') { co.model = modell; if (co.system) co.system = Prompts.systemFuerOllama(co.kind, co.system); } else { delete co.schema; if (modell) co.model = modell; }
    try {
      const r = await t.call(text, co);
      return Object.assign({}, r, { anbieter, modell: r.modelId || modell || null });
    } catch (e) {
      if (e && typeof e === 'object') { if (e.anbieter === undefined) e.anbieter = anbieter; if (e.modell === undefined) e.modell = modell || null; }
      throw e;
    }
  }

  return {
    name: 'router',
    arten: cfg, eskalation: eskCfg, warnungen: opts.warnungen || [],
    anbieterFuer, eskalationFuer,
    // normaler Weg: der Anbieter der Art. Ein Ausfall (auch OFFLINE) geht als Fehler zurück; ob und wie eskaliert wird, entscheidet
    // allein der Spielleiter (callEskalation über llm.eskaliere, mit Budgetprüfung) – es gibt nur diesen einen Eskalationsweg.
    async call(text, c) {
      const co = c || {};
      const eintrag = cfg[schluessel(co.kind, co.stufe)];
      if (!eintrag) return einzeln(text, co, 'claude', co.model, null);   // Art ohne Eintrag (direkter Aufruf): wie bisher Claude
      return einzeln(text, co, eintrag.anbieter, eintrag.modell, eintrag);
    },
    // Eskalation: dieselbe Anfrage an den Eskalations-Anbieter (Claude), ohne Schema
    async callEskalation(text, c) {
      if (!eskCfg) throw Object.assign(new Error('Keine Eskalation konfiguriert'), { code: 'EXIT' });
      const r = await einzeln(text, c || {}, eskCfg.anbieter, eskCfg.modell, null);
      return Object.assign(r, { eskaliert: true });
    },
  };
}

function ist(v) { return v !== undefined && v !== ''; }
// Eskalations-Anbieter aus der Umgebung (LLM_ESKALATION=claude|aus, LLM_ESKALATION_MODELL); null = keine Eskalation
function eskalationAusEnv(env) {
  const e = env || process.env;
  const esk = String(e.LLM_ESKALATION || 'claude').toLowerCase();
  return esk === 'aus' || esk === 'nein' || esk === '0' ? null : { anbieter: esk, modell: ist(e.LLM_ESKALATION_MODELL) ? e.LLM_ESKALATION_MODELL : 'sonnet' };
}
// Router nur, wenn die Umgebung ihn verlangt (LLM_ROUTER=1 oder eine LLM_ANBIETER_*); sonst null = bisheriges Verhalten.
function routerAusEnv(env, opts) {
  const e = env || process.env;
  // SUND-04b A2: die Stufen (Datei stufen.json, dann Umgebung); ein Router entsteht auch, wenn eine Stufe vom Standard abweicht. Ohne Abweichung und ohne Variablen bleibt es beim Verhalten von main (kein Router).
  const geladen = Stufen.lade(e, opts && opts.stufen ? opts.stufen : undefined);
  const ausVariablen = e.LLM_ROUTER === '1' || ARTEN_ALT.some((a) => ist(e['LLM_ANBIETER_' + a.toUpperCase()]));
  const nurStufen = !ausVariablen;   // der Router entsteht allein wegen der Stufen: grobplan, szene, text und lage behalten das Verhalten von main (Claude)
  if (nurStufen && Stufen.abweichend(geladen).length === 0) return null;
  const arten = {}; const warnungen = geladen.fehler.slice();
  for (const a of ARTEN_ALT) arten[a] = { anbieter: ist(e['LLM_ANBIETER_' + a.toUpperCase()]) ? e['LLM_ANBIETER_' + a.toUpperCase()] : undefined, modell: ist(e['LLM_MODELL_' + a.toUpperCase()]) ? e['LLM_MODELL_' + a.toUpperCase()] : undefined };
  if (nurStufen) for (const a of ARTEN_ALT) arten[a] = { anbieter: 'claude', modell: 'sonnet' };
  if (String(arten.grobplan.anbieter || '').toLowerCase() === 'ollama') { warnungen.push('LLM_ANBIETER_GROBPLAN=ollama ignoriert: der Grobplan bleibt bei Claude'); arten.grobplan = {}; }
  if (String(arten.lage.anbieter || '').toLowerCase() === 'ollama') { warnungen.push('LLM_ANBIETER_LAGE=ollama ignoriert: der Grobplan der Lage bleibt bei Claude'); arten.lage = {}; }
  for (const s of STUFEN) arten[s] = { anbieter: geladen.stufen[s].anbieter, modell: geladen.stufen[s].modell || undefined, eskalation: geladen.stufen[s].eskalation };
  const eskalation = eskalationAusEnv(e);
  return routeTransport(arten, Object.assign({ eskalation, env: e, warnungen }, opts || {}));
}

module.exports = { routeTransport, routerAusEnv, eskalationAusEnv, ARTEN, ANBIETER, STANDARD, STUFEN };
