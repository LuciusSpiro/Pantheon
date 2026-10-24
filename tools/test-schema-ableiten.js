'use strict';
// SUND-03 B (c): Szenen-Schema aus dem Katalog. Gültiges JSON-Schema, jede Katalog-Umsetzung hat ein Parameter-Schema, bekannte
// gültige Szenen (Archiv, Ablage) bestehen, Fehlerinjektion fällt durch. Kein Netz.   node tools/test-schema-ableiten.js
const H = require('./transport-testhilfe.js');
const SB = require('../server/mission/szenenbau.js');
const Schema = require('../server/mission/schema-ableiten.js');
const Katalog = require('../server/mission/katalog.js');

const T = H.runner('Schema-Ableitung');
const clone = (o) => JSON.parse(JSON.stringify(o));
const katalog = Katalog.load({});
const env = SB.buildEnv(katalog);
// Ausgenommen: (1) Ablage und Archiv speichern Antworten NACH den Reparaturen des Spielleiters; dort steht bei Szenen ohne
// setzende Folge die Bedingung {v: …} („nie wahr“), die kein Modell schreibt; (2) handgeschriebene Archiv-Szenen mit Aktionen
// in der Wendung, die der Systemprompt nicht kennt (besetzen).
const LLM_AKTIONEN = ['setFlag', 'reward', 'do', 'radio', 'oda', 'log'];
const ausgenommen = [];
const szenen = H.bekannteSzenen().filter((x) => {
  const nachRep = JSON.stringify(x.antwort.verzweigung || []).includes('"v"');
  const fremd = ((x.antwort.wendung && x.antwort.wendung.wirkung) || []).some((a) => Object.keys(a).some((k) => !LLM_AKTIONEN.includes(k)) || (a.do && a.do !== 'pay_marks'));
  if (nachRep || fremd) ausgenommen.push(x.name);
  return !nachRep && !fremd;
});

T.check('Katalog lädt fehlerfrei, bekannte Szenen vorhanden', !katalog.fehler.length && szenen.length >= 40, `${katalog.fehler.length} Katalogfehler, ${szenen.length} Szenen (${ausgenommen.length} ausgenommen)`);

// 1. jede verfügbare Umsetzung bekommt ein Parameter-Schema (Szene mit genau dieser Umsetzung, Ort aus dem Test)
let n = 0; const schlecht = [];
for (const mol of Object.values(katalog.molekuele)) for (const u of mol.umsetzungen) {
  if (u.status !== 'verfuegbar') continue;
  n++;
  const ort = (u.test && u.test.params && u.test.params.loc) || (u.params.loc && u.params.loc.werte && u.params.loc.werte[0]) || 'hafen';
  const szene = { id: 's1_x', ort, molekuele: [{ id: mol.id, umsetzung: u.id }], weiter: [{ nach: 'ausgang:erfolg' }] };
  let sch;
  try { sch = Schema.szenenSchemaFuer(env, szene); } catch (e) { schlecht.push(`${mol.id}/${u.id}: ${e.message}`); continue; }
  const item = sch.properties.molekuele.prefixItems[0];
  const pr = item.properties.params.properties;
  const fehlt = Object.keys(u.params).filter((p) => !(p in pr));
  if (fehlt.length) schlecht.push(`${mol.id}/${u.id}: Parameter ohne Schema: ${fehlt.join(', ')}`);
  const fe = H.schemaFehler(sch);
  if (fe.length) schlecht.push(`${mol.id}/${u.id}: ${fe[0]}`);
  // Parameter, die das Spiel setzt (Landepunkt, Besetzung), sind nie Pflicht
  const req = item.properties.params.required;
  const vomSpiel = Object.keys(u.params).filter((p) => ['map', 'landepunkt'].includes(u.params[p].typ) || ['fraktion', 'staerke', 'haltung', 'besetzung', 'neue_rolle'].includes(p));
  if (vomSpiel.some((p) => req.includes(p))) schlecht.push(`${mol.id}/${u.id}: vom Spiel gesetzter Parameter ist Pflicht`);
  // Aufzählungen und Zahlenbereiche des Katalogs stehen im Schema
  for (const [p, d] of Object.entries(u.params)) {
    if (d.typ === 'zahl' && Number.isFinite(d.min) && pr[p] && pr[p].minimum !== d.min) schlecht.push(`${mol.id}/${u.id}.${p}: minimum fehlt`);
    if ((d.typ === 'kind' || d.typ === 'text') && Array.isArray(d.werte) && pr[p] && !H.pruefeSchema(pr[p], d.werte[0]).length === false) schlecht.push(`${mol.id}/${u.id}.${p}: Aufzählung`);
    if (d.typ === 'kind' && Array.isArray(d.werte) && pr[p] && H.pruefeSchema(pr[p], '__kein_wert__').length === 0) schlecht.push(`${mol.id}/${u.id}.${p}: falscher Wert erlaubt`);
  }
}
T.check(`jede verfügbare Umsetzung (${n}) hat ein gültiges Parameter-Schema mit Katalogtypen`, n > 20 && !schlecht.length, schlecht.slice(0, 4).join(' | '));

// 2. Schema-Aufbau einer Szene mit Verzweigung und Wendung
const mitWendung = szenen.find((x) => x.szene.weiter.length > 1 && SB.hasWendung(x.szene)) || szenen.find((x) => x.szene.weiter.length > 1);
const sch0 = Schema.szenenSchemaFuer(env, mitWendung.szene);
const ziele = [...new Set(mitWendung.szene.weiter.map((w) => w.nach))];
T.check('Schema ist ein wohlgeformtes JSON-Schema (nur bekannte Schlüsselwörter)', H.schemaFehler(sch0).length === 0, H.schemaFehler(sch0).slice(0, 3).join(' | '));
T.check('Verzweigung: je Ziel ein Eintrag, Ziele als Aufzählung, Bedingung flag|not', sch0.properties.verzweigung.minItems === ziele.length && sch0.properties.verzweigung.items.properties.nach.enum.length === ziele.length
  && sch0.properties.verzweigung.items.properties.if.anyOf.length === 2, JSON.stringify(sch0.properties.verzweigung).slice(0, 200));
const einZiel = szenen.find((x) => new Set(x.szene.weiter.map((w) => w.nach)).size === 1 && !SB.hasWendung(x.szene));
const sch1 = Schema.szenenSchemaFuer(env, einZiel.szene);
T.check('ein Ziel → verzweigung leer; keine Wendung im Grobplan → wendung null', sch1.properties.verzweigung.maxItems === 0 && sch1.properties.wendung.type === 'null', JSON.stringify(sch1.properties.wendung));
{
  const sw = Schema.szenenSchemaFuer(env, Object.assign(clone(mitWendung.szene), { wendung: 'Ein Wächter erwacht' }));
  const sn = Schema.szenenSchemaFuer(env, Object.assign(clone(mitWendung.szene), { wendung: 'keine' }));
  const w = sw.properties.wendung.anyOf && sw.properties.wendung.anyOf.find((x) => x.type === 'object');
  T.check('Wendung im Grobplan → Objekt (nach_s 20–120, wirkung nicht leer) oder null; „keine“ → nur null', !!w && w.properties.nach_s.minimum === 20 && w.properties.nach_s.maximum === 120 && w.properties.wirkung.minItems === 1 && sn.properties.wendung.type === 'null', JSON.stringify(sw.properties.wendung).slice(0, 150));
}
T.check('Ableitung ist deterministisch und verändert die Eingabe nicht', (() => { const s = clone(mitWendung.szene); const a = JSON.stringify(Schema.szenenSchemaFuer(env, s)); return a === JSON.stringify(Schema.szenenSchemaFuer(env, s)) && JSON.stringify(s) === JSON.stringify(mitWendung.szene); })(), '');

// 3. bekannte gültige Szenen bestehen das Schema
const durchgefallen = [];
for (const x of szenen) {
  const e = H.pruefeSchema(Schema.szenenSchemaFuer(env, x.szene), x.antwort);
  if (e.length) durchgefallen.push(`${x.name}: ${e[0]}`);
}
T.check(`${szenen.length} bekannte gültige Szenen (Archiv, Ablage) bestehen das Schema`, !durchgefallen.length, durchgefallen.slice(0, 5).join(' | '));

// 4. Fehlerinjektion: jede Mutation einer gültigen Szene fällt durch
const basis = szenen.find((x) => x.szene.weiter.length > 1 && x.antwort.molekuele.some((m) => Object.values(m.params).some((v) => Array.isArray(v) && v.length))) || mitWendung;
const sBasis = Schema.szenenSchemaFuer(env, basis.szene);
T.check('Ausgangsszene für die Fehlerinjektion ist gültig', !H.pruefeSchema(sBasis, basis.antwort).length, basis.name);
const mut = (name, fn) => { const a = clone(basis.antwort); fn(a); const e = H.pruefeSchema(sBasis, a); T.check(`ungültig: ${name}`, e.length > 0, 'Schema lässt die Mutation durch'); };
const m0 = (a) => a.molekuele[0];
mut('Molekül-Id erfunden', (a) => { m0(a).id = 'erfundenes_molekuel'; });
mut('Umsetzung erfunden', (a) => { m0(a).umsetzung = 'erfundene_umsetzung'; });
mut('Umsetzung doppelt präfixiert', (a) => { m0(a).umsetzung = `${m0(a).id}/${m0(a).umsetzung}`; });
mut('Molekül fehlt', (a) => { a.molekuele = []; });
mut('Molekül doppelt', (a) => { a.molekuele.push(clone(a.molekuele[0])); });
mut('unbekannter Parameter', (a) => { m0(a).params.erfunden = 1; });
mut('Pflichtparameter fehlt', (a) => { const u = katalog.molekuele[basis.szene.molekuele[0].id].umsetzungen.find((x) => x.id === basis.szene.molekuele[0].umsetzung); const p = Object.keys(u.params).find((k) => u.params[k].pflicht && u.params[k].default === undefined && u.params[k].typ !== 'map'); delete m0(a).params[p]; });
mut('loc falsch', (a) => { m0(a).params.loc = 'irgendwo'; });
mut('Verzweigung leer bei mehreren Zielen', (a) => { a.verzweigung = []; });
mut('Verzweigung nach unbekanntem Ziel', (a) => { a.verzweigung[0].nach = 'nirgendwo'; });
mut('Bedingung ohne flag', (a) => { a.verzweigung[0].if = { wenn: 'x' }; });
mut('"null" als Text statt null (wendung)', (a) => { a.wendung = 'null'; });
mut('Top-Level-Zusatzfeld', (a) => { a.kommentar = 'hallo'; });
// Typfehler an einem Zahl-/Aufzählungsparameter, falls die Szene einen hat
const zahlSzene = szenen.find((x) => x.antwort.molekuele.some((m) => { const u = katalog.molekuele[m.id].umsetzungen.find((y) => y.id === m.umsetzung); return Object.entries(m.params).some(([p, v]) => u.params[p] && u.params[p].typ === 'zahl' && typeof v === 'number'); }));
if (zahlSzene) {
  const sch = Schema.szenenSchemaFuer(env, zahlSzene.szene);
  const a = clone(zahlSzene.antwort);
  for (const m of a.molekuele) { const u = katalog.molekuele[m.id].umsetzungen.find((y) => y.id === m.umsetzung); const p = Object.keys(m.params).find((k) => u.params[k] && u.params[k].typ === 'zahl'); if (p) { m.params[p] = String(m.params[p]); break; } }
  T.check('ungültig: Zahl als Text', H.pruefeSchema(sch, a).length > 0, 'Schema lässt Text für Zahl durch');
}
// Aktionen: falsche Form
const aktSzene = szenen.find((x) => x.antwort.molekuele.some((m) => Object.values(m.params).some((v) => Array.isArray(v) && v.some((y) => y && y.radio))));
if (aktSzene) {
  const sch = Schema.szenenSchemaFuer(env, aktSzene.szene);
  const mk = (fn) => { const a = clone(aktSzene.antwort); for (const m of a.molekuele) for (const [k, v] of Object.entries(m.params)) if (Array.isArray(v) && v.some((y) => y && y.radio)) { fn(v.find((y) => y && y.radio), v, m, k); return a; } return a; };
  T.check('ungültig: radio von unbekanntem Sprecher', H.pruefeSchema(sch, mk((x) => { x.radio.from = 'unbekannt_xyz'; })).length > 0, '');
  T.check('gültig: radio von neuer Stimme neu:Name', !H.pruefeSchema(sch, mk((x) => { x.radio.from = 'neu:Herold'; })).length, '');
  T.check('ungültig: setFlag mit Textwert', H.pruefeSchema(sch, mk((x, v) => { v.push({ setFlag: { s3_x: 'ja' } }); })).length > 0, '');
  T.check('ungültig: do-Aktion außer pay_marks', H.pruefeSchema(sch, mk((x, v) => { v.push({ do: 'besetzen', marks: 1 }); })).length > 0, '');
  T.check('ungültig: erfundene Aktion', H.pruefeSchema(sch, mk((x, v) => { v.push({ teleport: 'hafen' }); })).length > 0, '');
}
T.finish();
