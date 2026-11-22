// Loose Fabric-style version comparison + predicate matching (">=1.2 <2", "~1.2", "^1", "*", "1.x", arrays = OR).
function parse(v) {
  const s = String(v).trim().replace(/^v/, '');
  const [noBuild] = s.split('+');
  const dash = noBuild.indexOf('-');
  const core = dash >= 0 ? noBuild.slice(0, dash) : noBuild;
  const pre = dash >= 0 ? noBuild.slice(dash + 1) : null;
  return { core: core.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x)), pre };
}
const cmpPart = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en', { numeric: true }));
export function compare(a, b) {
  const A = parse(a), B = parse(b);
  for (let i = 0; i < Math.max(A.core.length, B.core.length); i++) {
    const d = cmpPart(A.core[i] ?? 0, B.core[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (A.pre === B.pre) return 0;
  if (A.pre === null) return 1;
  if (B.pre === null) return -1;
  return Math.sign(A.pre.localeCompare(B.pre, 'en', { numeric: true }));
}
function single(ver, term) {
  term = term.trim();
  if (!term || term === '*') return true;
  const m = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(term);
  const [, op = '=', target] = m;
  if (/\.x$|\.\*$/i.test(target) && op === '=') {
    const pre = target.replace(/\.(x|\*)$/i, '').split('.');
    return parse(ver).core.slice(0, pre.length).join('.') === pre.join('.');
  }
  const c = compare(ver, target);
  const t = parse(target).core;
  switch (op) {
    case '>=': return c >= 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    case '<': return c < 0;
    case '~': return c >= 0 && compare(ver, `${t[0]}.${Number(t[1] ?? 0) + 1}`) < 0;
    case '^': return c >= 0 && compare(ver, `${Number(t[0]) + 1}`) < 0;
    default: return c === 0;
  }
}
/** Does version `ver` satisfy fabric predicate `pred` (string or array)? */
export function satisfies(ver, pred) {
  if (Array.isArray(pred)) return pred.some((p) => satisfies(ver, p));
  return String(pred).split(/\s+/).filter(Boolean).every((t) => single(ver, t));
}
