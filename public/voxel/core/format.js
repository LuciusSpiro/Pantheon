// JSON lesbar und diff-freundlich formatieren: kurze Objekte/Arrays bleiben auf einer Zeile.
// Inline-Form wird rekursiv gebaut – Strings werden nie verändert.
function inline(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(inline).join(', ') + ']';
  const e = Object.entries(v).filter(([, x]) => x !== undefined);
  return e.length ? '{ ' + e.map(([k, x]) => JSON.stringify(k) + ': ' + inline(x)).join(', ') + ' }' : '{}';
}

export function formatJSON(value, width = 110) {
  const fmt = (v, ind) => {
    const one = inline(v);
    if (v === null || typeof v !== 'object' || ind.length + one.length <= width) return one;
    const nx = ind + '  ';
    if (Array.isArray(v)) return '[\n' + v.map((x) => nx + fmt(x, nx)).join(',\n') + '\n' + ind + ']';
    return '{\n' + Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => nx + JSON.stringify(k) + ': ' + fmt(x, nx)).join(',\n') + '\n' + ind + '}';
  };
  return fmt(value, '') + '\n';
}
