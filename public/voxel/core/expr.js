// Kleiner, sicherer Ausdrucksauswerter für Rezept-Parameter.
// Erlaubt: Zahlen, Parameternamen, + - * / % ( ), Vergleiche (< <= > >= == !=), && || !,
// Bedingung a ? b : c und die Funktionen min max floor ceil round abs sqrt sin cos.
// Beispiel: "h - 2", "floor(w / 2)", "damage > 0.5", "side == 1 ? 3 : 0"

const FUNCS = {
  min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  abs: Math.abs, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos,
};
const TOKEN = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|==|!=|&&|\|\||[-+*/%()<>!?:,]))/y;

function tokenize(src) {
  const out = []; TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const at = TOKEN.lastIndex, m = TOKEN.exec(src);
    if (!m) throw new Error(`Ausdruck "${src}": unerwartetes Zeichen bei ${at}`);
    if (m[1] !== undefined) out.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push({ t: 'id', v: m[2] });
    else out.push({ t: 'op', v: m[3] });
  }
  return out;
}

const cache = new Map();
function compile(src) {
  let fn = cache.get(src);
  if (fn) return fn;
  const tk = tokenize(src); let i = 0;
  const peek = () => tk[i], next = () => tk[i++];
  const isOp = (v) => tk[i] && tk[i].t === 'op' && tk[i].v === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`Ausdruck "${src}": "${v}" erwartet`); i++; };
  // Jede Stufe liefert eine Funktion (scope) → Zahl
  const ternary = () => {
    const c = or();
    if (!isOp('?')) return c;
    i++; const a = ternary(); expect(':'); const b = ternary();
    return (s) => (c(s) ? a(s) : b(s));
  };
  const binLevel = (sub, ops) => () => {
    let l = sub();
    while (tk[i] && tk[i].t === 'op' && ops[tk[i].v]) { const f = ops[next().v], r = sub(), L = l; l = (s) => f(L(s), r(s)); }
    return l;
  };
  const unary = () => {
    if (isOp('-')) { i++; const u = unary(); return (s) => -u(s); }
    if (isOp('!')) { i++; const u = unary(); return (s) => (u(s) ? 0 : 1); }
    if (isOp('+')) { i++; return unary(); }
    return primary();
  };
  const mul = binLevel(unary, { '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b });
  const add = binLevel(mul, { '+': (a, b) => a + b, '-': (a, b) => a - b });
  const cmp = binLevel(add, { '<': (a, b) => +(a < b), '<=': (a, b) => +(a <= b), '>': (a, b) => +(a > b), '>=': (a, b) => +(a >= b) });
  const eq = binLevel(cmp, { '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b) });
  const and = binLevel(eq, { '&&': (a, b) => +(a && b) });
  const or = binLevel(and, { '||': (a, b) => +(a || b) });
  function primary() {
    const t = next();
    if (!t) throw new Error(`Ausdruck "${src}": unvollständig`);
    if (t.t === 'num') return () => t.v;
    if (t.t === 'op' && t.v === '(') { const e = ternary(); expect(')'); return e; }
    if (t.t === 'id') {
      if (isOp('(')) {
        const f = FUNCS[t.v]; if (!f) throw new Error(`Ausdruck "${src}": unbekannte Funktion ${t.v}`);
        i++; const args = [];
        if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { i++; args.push(ternary()); } }
        expect(')');
        return (s) => f(...args.map((a) => a(s)));
      }
      const name = t.v;
      return (s) => {
        if (!(name in s)) throw new Error(`Ausdruck "${src}": unbekannter Parameter "${name}"`);
        return s[name];
      };
    }
    throw new Error(`Ausdruck "${src}": unerwartet "${t.v}"`);
  }
  fn = ternary();
  if (i < tk.length) throw new Error(`Ausdruck "${src}": Rest "${tk.slice(i).map((t) => t.v).join(' ')}"`);
  cache.set(src, fn);
  return fn;
}

/** Wertet eine Zahl oder einen Ausdrucks-String aus. */
export function evalNum(v, scope) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return +v;
  if (typeof v === 'string') return compile(v)(scope);
  throw new Error(`Zahl oder Ausdruck erwartet, bekommen: ${JSON.stringify(v)}`);
}

/** Wertet ein Array [a,b,c] elementweise aus. */
export const evalVec = (arr, scope) => arr.map((v) => evalNum(v, scope));
