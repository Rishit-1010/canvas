/* Geometry construction tools (GeoGebra-style).
 * Every construction is a dependent object: it stores references to its parents and is
 * re-computed each frame, so dragging a free point updates everything built on it. */
window.WBGeo = function (env) {
'use strict';
const { objs, uid, CM } = env;
const GEO = '#0b3d91', TAU = Math.PI * 2, FAR = 1e5;
let cache = new Map(), idx = null;
const reset = () => { cache = new Map(); idx = null; };
const O = id => { if (!idx) idx = new Map(objs().map(o => [o.id, o])); return idx.get(id); };
const ev = o => {
  if (!o) return null; if (cache.has(o.id)) return cache.get(o.id);
  cache.set(o.id, null); let r = null; try { r = compute(o); } catch (e) { r = null; } cache.set(o.id, r); return r;
};
const P = id => ev(O(id));
const pp = id => { const r = P(id); return r && r.t === 'p' ? r : null; };
const nrm = a => ((a % TAU) + TAU) % TAU;
const mang = (a, b) => Math.atan2(-(b.y - a.y), b.x - a.x);          // maths angle (y up)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pt = (x, y) => ({ t: 'p', x, y });
const rot = (x, y, f) => [x * Math.cos(f) + y * Math.sin(f), -x * Math.sin(f) + y * Math.cos(f)];
const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const cm = v => (v / CM).toFixed(2);
const lineP = (a, b, mode = 'line') => (a.x === b.x && a.y === b.y) ? null : { t: 'l', mode, ax: a.x, ay: a.y, bx: b.x, by: b.y };

/* ───── intersections ───── */
function segsOf(r) {
  if (r.t === 'l') return [[r.ax, r.ay, r.bx, r.by, r.mode === 'vec' ? 'seg' : r.mode]];
  if (r.t === 'poly' || r.t === 'pl') {
    const q = r.pts, s = []; for (let i = 0; i < q.length - 1; i++) s.push([q[i].x, q[i].y, q[i + 1].x, q[i + 1].y, 'seg']);
    if (r.t === 'poly' && q.length > 2) s.push([q[q.length - 1].x, q[q.length - 1].y, q[0].x, q[0].y, 'seg']); return s;
  }
  return null;
}
const okT = (m, v) => m === 'line' || (m === 'ray' ? v >= -1e-9 : (v >= -1e-9 && v <= 1 + 1e-9));
function ll(s1, s2) {
  const [x1, y1, x2, y2, m1] = s1, [x3, y3, x4, y4, m2] = s2, d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d, u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return okT(m1, t) && okT(m2, u) ? pt(x1 + t * (x2 - x1), y1 + t * (y2 - y1)) : null;
}
const inArc = (c, p) => c.a0 == null || nrm(mang(c, p) - c.a0) <= c.a1 - c.a0 + 1e-9;
function lc(s, c) {
  const [ax, ay, bx, by, m] = s, dx = bx - ax, dy = by - ay, fx = ax - c.x, fy = ay - c.y;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - c.r * c.r, D = B * B - 4 * A * C;
  if (D < 0) return []; const q = Math.sqrt(D), ts = D < 1e-9 ? [-B / (2 * A)] : [(-B - q) / (2 * A), (-B + q) / (2 * A)];
  return ts.filter(t => okT(m, t)).map(t => pt(ax + t * dx, ay + t * dy)).filter(p => inArc(c, p));
}
function cc(c1, c2) {
  const d = dist(c1, c2); if (d < 1e-9 || d > c1.r + c2.r || d < Math.abs(c1.r - c2.r)) return [];
  const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
  const ux = (c2.x - c1.x) / d, uy = (c2.y - c1.y) / d, mx = c1.x + a * ux, my = c1.y + a * uy;
  return [pt(mx + h * uy, my - h * ux), pt(mx - h * uy, my + h * ux)].filter(p => inArc(c1, p) && inArc(c2, p));
}
function intersect(A, B) {
  const sa = segsOf(A), sb = segsOf(B), out = [];
  if (sa && sb) { for (const x of sa) for (const y of sb) { const p = ll(x, y); if (p) out.push(p); } return out; }
  if (sa && B.t === 'c') return sa.flatMap(s => lc(s, B));
  if (sb && A.t === 'c') return sb.flatMap(s => lc(s, A));
  if (A.t === 'c' && B.t === 'c') return cc(A, B);
  return out;
}

/* ───── evaluation ───── */
function xform(o) {
  const a = pp(o.refs[0]); if (!a) return null;
  const aux = o.refs[1] && P(o.refs[1]), n = o.num;
  switch (o.xf) {
    case 'reflLine': { if (!aux || aux.t !== 'l') return null; const dx = aux.bx - aux.ax, dy = aux.by - aux.ay, l2 = dx * dx + dy * dy, t = ((a.x - aux.ax) * dx + (a.y - aux.ay) * dy) / l2, fx = aux.ax + t * dx, fy = aux.ay + t * dy; return pt(2 * fx - a.x, 2 * fy - a.y); }
    case 'reflPt': if (!aux || aux.t !== 'p') return null; return pt(2 * aux.x - a.x, 2 * aux.y - a.y);
    case 'inv': { if (!aux || aux.t !== 'c') return null; const dx = a.x - aux.x, dy = a.y - aux.y, d2 = dx * dx + dy * dy; if (d2 < 1e-9) return null; const k = aux.r * aux.r / d2; return pt(aux.x + dx * k, aux.y + dy * k); }
    case 'rot': { if (!aux || aux.t !== 'p') return null; const [x, y] = rot(a.x - aux.x, a.y - aux.y, n * Math.PI / 180); return pt(aux.x + x, aux.y + y); }
    case 'trans': if (!aux || aux.t !== 'l') return null; return pt(a.x + aux.bx - aux.ax, a.y + aux.by - aux.ay);
    case 'dil': if (!aux || aux.t !== 'p') return null; return pt(aux.x + (a.x - aux.x) * n, aux.y + (a.y - aux.y) * n);
  }
  return null;
}
function circum(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)); if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}
function perimeter(r) { const q = r.pts; let s = 0; for (let i = 0; i < q.length - 1; i++) s += dist(q[i], q[i + 1]); if (r.t === 'poly') s += dist(q[q.length - 1], q[0]); return s; }
function area(r) { let s = 0; const q = r.pts; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
const ptsOf = o => o.refs.map(pp);
function compute(o) {
  const R = o.refs || [];
  switch (o.kind) {
    case 'pt': return pt(o.x, o.y);
    case 'ptOn': {
      const r = P(R[0]); if (!r) return null;
      if (r.t === 'l') { let t = o.t; if (r.mode === 'seg' || r.mode === 'vec') t = Math.min(1, Math.max(0, t)); else if (r.mode === 'ray') t = Math.max(0, t); return pt(r.ax + t * (r.bx - r.ax), r.ay + t * (r.by - r.ay)); }
      if (r.t === 'c') return pt(r.x + r.r * Math.cos(o.th), r.y - r.r * Math.sin(o.th));
      return null;
    }
    case 'mid': {
      if (R.length === 2) { const a = pp(R[0]), b = pp(R[1]); return a && b ? pt((a.x + b.x) / 2, (a.y + b.y) / 2) : null; }
      const r = P(R[0]); if (!r) return null; if (r.t === 'l') return pt((r.ax + r.bx) / 2, (r.ay + r.by) / 2); if (r.t === 'c') return pt(r.x, r.y); return null;
    }
    case 'inter': { const A = P(R[0]), B = P(R[1]); if (!A || !B) return null; const p = intersect(A, B)[o.i]; return p || null; }
    case 'polar': { const a = pp(R[0]); return a ? pt(a.x + o.r * Math.cos(o.th), a.y - o.r * Math.sin(o.th)) : null; }
    case 'ptX': return xform(o);
    case 'regv': {
      const a = pp(R[0]), b = pp(R[1]); if (!a || !b) return null; const th = TAU / o.n; let x = a.x, y = a.y;
      for (let j = 0; j < o.k; j++) { const [dx, dy] = rot(b.x - a.x, b.y - a.y, j * th); x += dx; y += dy; } return pt(x, y);
    }
    case 'line': case 'seg': case 'ray': case 'vec': { const a = pp(R[0]), b = pp(R[1]); return a && b ? lineP(a, b, o.kind) : null; }
    case 'perp': case 'par': { const p = pp(R[0]), L = P(R[1]); if (!p || !L || L.t !== 'l') return null; const dx = L.bx - L.ax, dy = L.by - L.ay; return lineP(p, pt(p.x + (o.kind === 'perp' ? -dy : dx), p.y + (o.kind === 'perp' ? dx : dy))); }
    case 'perpBis': {
      let a, b; if (R.length === 1) { const s = P(R[0]); if (!s || s.t !== 'l') return null; a = pt(s.ax, s.ay); b = pt(s.bx, s.by); } else { a = pp(R[0]); b = pp(R[1]); }
      if (!a || !b) return null; const m = pt((a.x + b.x) / 2, (a.y + b.y) / 2); return lineP(m, pt(m.x - (b.y - a.y), m.y + (b.x - a.x)));
    }
    case 'angBis': {
      const [a, b, c] = ptsOf(o); if (!a || !b || !c) return null; const u = unit(a.x - b.x, a.y - b.y), v = unit(c.x - b.x, c.y - b.y);
      let wx = u[0] + v[0], wy = u[1] + v[1]; if (Math.hypot(wx, wy) < 1e-6) { wx = -u[1]; wy = u[0]; } return lineP(b, pt(b.x + wx, b.y + wy));
    }
    case 'tan': {
      const p = pp(R[0]), c = P(R[1]); if (!p || !c || c.t !== 'c') return null; const d = dist(p, c);
      if (Math.abs(d - c.r) < 1e-6) { if (o.i) return null; return lineP(p, pt(p.x - (p.y - c.y), p.y + (p.x - c.x))); }
      if (d < c.r) return null; const al = Math.asin(c.r / d) * (o.i ? -1 : 1), u = unit(c.x - p.x, c.y - p.y);
      return lineP(p, pt(p.x + u[0] * Math.cos(al) - u[1] * Math.sin(al), p.y + u[0] * Math.sin(al) + u[1] * Math.cos(al)));
    }
    case 'poly': case 'polyline': { const q = ptsOf(o); if (q.some(x => !x)) return null; return { t: o.kind === 'poly' ? 'poly' : 'pl', pts: q }; }
    case 'circ2': { const c = pp(R[0]), q = pp(R[1]); return c && q ? { t: 'c', x: c.x, y: c.y, r: dist(c, q) } : null; }
    case 'circR': { const c = pp(R[0]); return c ? { t: 'c', x: c.x, y: c.y, r: o.r } : null; }
    case 'circR2': {
      const f = P(R[0]); if (!f) return null;
      if (f.t === 'l') { const c = pp(R[1]); return c ? { t: 'c', x: c.x, y: c.y, r: Math.hypot(f.bx - f.ax, f.by - f.ay) } : null; }
      const b = pp(R[1]), c = pp(R[2]); return f.t === 'p' && b && c ? { t: 'c', x: c.x, y: c.y, r: dist(f, b) } : null;
    }
    case 'circ3': { const [a, b, c] = ptsOf(o); if (!a || !b || !c) return null; const k = circum(a, b, c); return k && { t: 'c', ...k }; }
    case 'semi': { const a = pp(R[0]), b = pp(R[1]); if (!a || !b) return null; const m = pt((a.x + b.x) / 2, (a.y + b.y) / 2), a0 = mang(m, a); return { t: 'c', x: m.x, y: m.y, r: dist(a, b) / 2, a0, a1: a0 + Math.PI }; }
    case 'arc': case 'sector': {
      const [c, s, e] = ptsOf(o); if (!c || !s || !e) return null; const a0 = mang(c, s), sw = nrm(mang(c, e) - a0);
      return { t: 'c', x: c.x, y: c.y, r: dist(c, s), a0, a1: a0 + (sw < 1e-9 ? 1e-6 : sw), sector: o.kind === 'sector' };
    }
    case 'arc3': case 'sector3': {
      const [a, b, c] = ptsOf(o); if (!a || !b || !c) return null; const k = circum(a, b, c); if (!k) return null;
      const aA = mang(k, a), aB = mang(k, b), aC = mang(k, c), dB = nrm(aB - aA), dC = nrm(aC - aA);
      const a0 = dB < dC ? aA : aC, a1 = dB < dC ? aA + dC : aC + nrm(aA - aC);
      return { t: 'c', ...k, a0, a1, sector: o.kind === 'sector3' };
    }
    case 'ellipse': case 'hyper': {
      const [f1, f2, q] = ptsOf(o); if (!f1 || !f2 || !q) return null; const d1 = dist(q, f1), d2 = dist(q, f2), c = dist(f1, f2) / 2, rt = Math.atan2(f2.y - f1.y, f2.x - f1.x);
      const m = pt((f1.x + f2.x) / 2, (f1.y + f2.y) / 2);
      if (o.kind === 'ellipse') { const a = (d1 + d2) / 2; return a > c + 1e-6 ? { t: 'cn', k: 'e', x: m.x, y: m.y, a, b: Math.sqrt(a * a - c * c), rt } : null; }
      const a = Math.abs(d1 - d2) / 2; return a > 1e-6 && a < c - 1e-6 ? { t: 'cn', k: 'h', x: m.x, y: m.y, a, b: Math.sqrt(c * c - a * a), rt } : null;
    }
    case 'parab': {
      const f = pp(R[0]), L = P(R[1]); if (!f || !L || L.t !== 'l') return null; const [ux, uy] = unit(L.bx - L.ax, L.by - L.ay);
      let nx = -uy, ny = ux; const s = (f.x - L.ax) * nx + (f.y - L.ay) * ny; if (Math.abs(s) < 1e-6) return null; if (s < 0) { nx = -nx; ny = -ny; }
      const p = Math.abs(s); return { t: 'cn', k: 'p', x: f.x - nx * p / 2, y: f.y - ny * p / 2, ux, uy, nx, ny, p };
    }
    case 'angle': {
      const [a, b, c] = ptsOf(o); if (!a || !b || !c) return null; const a0 = mang(b, a), sw = nrm(mang(b, c) - a0);
      return { t: 'ang', x: b.x, y: b.y, a0, a1: a0 + sw, deg: sw * 180 / Math.PI };
    }
    case 'angle2': {
      const A = P(R[0]), B = P(R[1]); if (!A || !B || A.t !== 'l' || B.t !== 'l') return null; const v = ll([A.ax, A.ay, A.bx, A.by, 'line'], [B.ax, B.ay, B.bx, B.by, 'line']); if (!v) return null;
      const a0 = Math.atan2(-(A.by - A.ay), A.bx - A.ax), sw = nrm(Math.atan2(-(B.by - B.ay), B.bx - B.ax) - a0); return { t: 'ang', x: v.x, y: v.y, a0, a1: a0 + sw, deg: sw * 180 / Math.PI };
    }
    case 'meas': {
      const r = R.map(P); if (r.some(x => !x)) return null; let v, x, y, txt;
      if (o.mt === 'dist') {
        const [A, B] = r;
        if (A.t === 'p' && B && B.t === 'p') { v = dist(A, B); x = (A.x + B.x) / 2; y = (A.y + B.y) / 2 - 12; }
        else if (A.t === 'l') { v = Math.hypot(A.bx - A.ax, A.by - A.ay); x = (A.ax + A.bx) / 2; y = (A.ay + A.by) / 2 - 12; }
        else if (A.t === 'c') { v = TAU * A.r * (A.a0 == null ? 1 : (A.a1 - A.a0) / TAU); x = A.x; y = A.y - A.r - 12; }
        else if (A.t === 'poly' || A.t === 'pl') { v = perimeter(A); x = A.pts[0].x; y = A.pts[0].y - 14; } else return null;
        txt = `${o.name} = ${cm(v)} cm`;
      } else if (o.mt === 'area') {
        const A = r[0]; if (A.t === 'poly') { v = area(A); x = A.pts.reduce((s, q) => s + q.x, 0) / A.pts.length; y = A.pts.reduce((s, q) => s + q.y, 0) / A.pts.length; }
        else if (A.t === 'c') { v = Math.PI * A.r * A.r; x = A.x; y = A.y; } else return null;
        txt = `${o.name} = ${(v / CM / CM).toFixed(2)} cm²`;
      } else {
        const A = r[0]; if (A.t !== 'l') return null; const dx = A.bx - A.ax; x = (A.ax + A.bx) / 2; y = (A.ay + A.by) / 2 - 12;
        txt = Math.abs(dx) < 1e-9 ? `${o.name} = undefined` : `${o.name} = ${(-(A.by - A.ay) / dx).toFixed(2)}`;
      }
      return { t: 'txt', x, y, text: txt };
    }
  }
  return null;
}

/* ───── geometry of drawn curves ───── */
function conicLines(r) {
  const out = [], push = (ax, ay, f) => { const [x, y] = rot(ax, ay, -f); return [r.x + x, r.y + y]; };
  void push;
  const R2 = (lx, ly) => { const c = Math.cos(r.rt), s = Math.sin(r.rt); return [r.x + lx * c - ly * s, r.y + lx * s + ly * c]; };
  if (r.k === 'e') { const l = []; for (let i = 0; i <= 120; i++) { const t = i / 120 * TAU; l.push(R2(r.a * Math.cos(t), r.b * Math.sin(t))); } out.push(l); }
  else if (r.k === 'h') for (const sg of [1, -1]) { const l = []; for (let i = -60; i <= 60; i++) { const t = i / 60 * 4; l.push(R2(sg * r.a * Math.cosh(t), r.b * Math.sinh(t))); } out.push(l); }
  else { const l = []; for (let i = -150; i <= 150; i++) { const t = i / 150 * 2500; l.push([r.x + t * r.ux + (t * t / (2 * r.p)) * r.nx, r.y + t * r.uy + (t * t / (2 * r.p)) * r.ny]); } out.push(l); }
  return out;
}
const extent = r => {                             // visible endpoints of a line-like prim
  const [ux, uy] = unit(r.bx - r.ax, r.by - r.ay);
  if (r.mode === 'line') return [r.ax - ux * FAR, r.ay - uy * FAR, r.ax + ux * FAR, r.ay + uy * FAR];
  if (r.mode === 'ray') return [r.ax, r.ay, r.ax + ux * FAR, r.ay + uy * FAR];
  return [r.ax, r.ay, r.bx, r.by];
};
function inPolyG(p, q) { let c = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { if ((q[i].y > p.y) !== (q[j].y > p.y) && p.x < (q[j].x - q[i].x) * (p.y - q[i].y) / (q[j].y - q[i].y) + q[i].x) c = !c; } return c; }
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function hit(o, p, tol) {
  const r = ev(o); if (!r) return false; const z = env.z();
  switch (r.t) {
    case 'p': return Math.hypot(p.x - r.x, p.y - r.y) <= tol + 4 / z;
    case 'l': { const e = extent(r); return segDist(p.x, p.y, e[0], e[1], e[2], e[3]) <= tol; }
    case 'c': { const d = dist(p, r); if (r.sector && d < r.r && inArc(r, p)) return true; return Math.abs(d - r.r) <= tol && inArc(r, p); }
    case 'poly': case 'pl': if (r.t === 'poly' && inPolyG(p, r.pts)) return true; return (segsOf(r) || []).some(s => segDist(p.x, p.y, s[0], s[1], s[2], s[3]) <= tol);
    case 'cn': return conicLines(r).some(l => { for (let i = 0; i < l.length - 1; i++) if (segDist(p.x, p.y, l[i][0], l[i][1], l[i + 1][0], l[i + 1][1]) <= tol) return true; return false; });
    case 'txt': return Math.abs(p.x - r.x) < 50 / z && Math.abs(p.y - r.y) < 10 / z;
  }
  return false;
}
function gbox(o) {
  const r = ev(o); if (!r) return { x: 0, y: 0, w: 0, h: 0 };
  const bb = pts => { const xs = pts.map(q => q.x ?? q[0]), ys = pts.map(q => q.y ?? q[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
  switch (r.t) {
    case 'p': case 'ang': return { x: r.x, y: r.y, w: 0, h: 0 };
    case 'txt': return { x: r.x - 40, y: r.y - 8, w: 80, h: 16 };
    case 'l': return bb([[r.ax, r.ay], [r.bx, r.by]]);
    case 'c': return { x: r.x - r.r, y: r.y - r.r, w: 2 * r.r, h: 2 * r.r };
    case 'poly': case 'pl': return bb(r.pts);
    case 'cn': return bb(conicLines(r)[0].filter((_, i, a) => i % 6 === 0).slice(0, 40));
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

/* ───── drawing ───── */
function draw(c, o, z, f) {
  const r = ev(o); if (!r) return; if (o.hidden && !f.ghost) return;
  const col = o.color || GEO, lw = 2 / z; c.save();
  if (o.hidden) c.globalAlpha = .28;
  c.strokeStyle = col; c.fillStyle = col; c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round';
  const halo = () => { if (f.sel) { c.save(); c.strokeStyle = 'rgba(30,136,229,.4)'; c.lineWidth = 9 / z; c.stroke(); c.restore(); } };
  const label = (x, y) => { if (o.lbl) { c.font = `${15 / z}px Quicksand,sans-serif`; c.fillStyle = col; c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.fillText(o.name, x, y); } };
  switch (r.t) {
    case 'p': {
      if (f.sel) { c.beginPath(); c.arc(r.x, r.y, 10 / z, 0, TAU); c.fillStyle = 'rgba(30,136,229,.35)'; c.fill(); }
      c.beginPath(); c.arc(r.x, r.y, 5 / z, 0, TAU); c.fillStyle = col; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.5 / z; c.stroke();
      label(r.x + 8 / z, r.y - 8 / z); break;
    }
    case 'l': {
      const e = extent(r); c.beginPath(); c.moveTo(e[0], e[1]); c.lineTo(e[2], e[3]); halo(); c.stroke();
      if (r.mode === 'vec') { const a = Math.atan2(r.by - r.ay, r.bx - r.ax), L = 14 / z; c.beginPath(); c.moveTo(r.bx, r.by); c.lineTo(r.bx - L * Math.cos(a - .4), r.by - L * Math.sin(a - .4)); c.lineTo(r.bx - L * Math.cos(a + .4), r.by - L * Math.sin(a + .4)); c.closePath(); c.fill(); }
      label((r.ax + r.bx) / 2 + 6 / z, (r.ay + r.by) / 2 - 6 / z); break;
    }
    case 'c': {
      c.beginPath();
      if (r.a0 == null) c.arc(r.x, r.y, r.r, 0, TAU);
      else { if (r.sector) { c.moveTo(r.x, r.y); c.lineTo(r.x + r.r * Math.cos(r.a0), r.y - r.r * Math.sin(r.a0)); } c.arc(r.x, r.y, r.r, -r.a0, -r.a1, true); if (r.sector) c.closePath(); }
      if (r.sector) { c.save(); c.fillStyle = 'rgba(11,61,145,.1)'; c.fill(); c.restore(); }
      halo(); c.stroke(); label(r.x, r.y - r.r - 6 / z); break;
    }
    case 'poly': case 'pl': {
      c.beginPath(); r.pts.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); if (r.t === 'poly') { c.closePath(); c.save(); c.fillStyle = 'rgba(11,61,145,.1)'; c.fill(); c.restore(); }
      halo(); c.stroke(); break;
    }
    case 'cn': { for (const l of conicLines(r)) { c.beginPath(); l.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); halo(); c.stroke(); } break; }
    case 'ang': {
      const rad = 28 / z; c.beginPath(); c.moveTo(r.x, r.y); c.arc(r.x, r.y, rad, -r.a0, -r.a1, true); c.closePath(); c.save(); c.fillStyle = 'rgba(220,60,60,.18)'; c.fill(); c.restore();
      c.lineWidth = 1.5 / z; c.stroke(); const m = (r.a0 + r.a1) / 2;
      c.font = `${14 / z}px Quicksand,sans-serif`; c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(r.deg.toFixed(1) + '°', r.x + 46 / z * Math.cos(m), r.y - 46 / z * Math.sin(m)); break;
    }
    case 'txt': {
      c.font = `${15 / z}px Quicksand,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; const w = c.measureText(r.text).width + 10 / z;
      c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(r.x - w / 2, r.y - 10 / z, w, 20 / z);
      if (f.sel) { c.strokeStyle = '#1e88e5'; c.lineWidth = 1 / z; c.strokeRect(r.x - w / 2, r.y - 10 / z, w, 20 / z); }
      c.fillStyle = col; c.fillText(r.text, r.x, r.y); break;
    }
  }
  c.restore();
}

/* ───── editing helpers ───── */
function collectFree(o, s, seen = new Set()) {
  if (!o || seen.has(o.id)) return; seen.add(o.id);
  if (o.kind === 'pt') { s.add(o.id); return; } if (o.kind === 'ptOn') return;
  (o.refs || []).forEach(r => collectFree(O(r), s, seen));
}
function reparam(o, p) {
  const r = P(o.refs[0]); if (!r) return;
  if (r.t === 'l') o.t = ((p.x - r.ax) * (r.bx - r.ax) + (p.y - r.ay) * (r.by - r.ay)) / ((r.bx - r.ax) ** 2 + (r.by - r.ay) ** 2);
  else if (r.t === 'c') o.th = mang(r, p);
}
function moveMany(list, dx, dy, mv, p) {
  const free = new Set();
  for (const o of list) {
    if (o.type !== 'geo') { mv(o, dx, dy); continue; }
    if (o.kind === 'ptOn') { if (list.length === 1 && p) reparam(o, p); continue; }
    collectFree(o, free);
  }
  for (const id of free) { const q = O(id); if (q) { q.x += dx; q.y += dy; } }
}
function withDependents(ids) {
  const out = new Set(ids); let ch = true;
  while (ch) { ch = false; for (const o of objs()) if (o.type === 'geo' && !out.has(o.id) && (o.refs || []).some(r => out.has(r))) { out.add(o.id); ch = true; } }
  return out;
}
const isPoint = o => o.type === 'geo' && !!ev(o) && ev(o).t === 'p';

/* ───── naming / creation ───── */
function nextName(kind) {
  const used = new Set(objs().filter(o => o.type === 'geo').map(o => o.name));
  const pts = ['pt', 'ptOn', 'mid', 'inter', 'polar', 'ptX', 'regv'].includes(kind);
  const pool = pts ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : kind === 'angle' || kind === 'angle2' ? 'αβγδεζηθικλμνξπρστφχψω' : kind === 'meas' ? 'dsvwxyzuabcefghijklmnopqrt' : 'fghijklmnopqrstuvwxyzabcde';
  for (let n = 0; n < 40; n++) for (const ch of pool) { const nm = ch + (n ? n : ''); if (!used.has(nm)) return nm; }
  return uid();
}
const mk = (kind, props = {}) => {
  const o = { id: uid(), type: 'geo', kind, ...props };
  o.name = nextName(kind); o.lbl = ['pt', 'ptOn', 'mid', 'inter', 'polar', 'ptX', 'regv'].includes(kind);
  objs().push(o); reset(); return o;       // added immediately so later names/refs resolve
};

/* ───── tool catalogue ───── */
const fx = (...ty) => refs => refs.length < ty.length ? ty[refs.length] : null;
const either = (a, b) => (refs, pr) => !refs.length ? [a, b] : refs.length === 1 ? (pr[0].t === (a === 'P' ? 'p' : 'x') ? b : a) : null;
const isPt = r => r && r.t === 'p';
const TX = (id, label, xf, auxType, num) => ({ id, cat: 'Transform', label, next: fx('X', auxType),
  num, make: (r, c) => transform(r[0], xf, r[1], c.num) });
function transform(id, xf, aux, num) {
  const o = O(id), pr = P(id); if (!o || !pr) return null;
  if (pr.t === 'p') return [mk('ptX', { refs: [id, aux], xf, num })];
  if (xf === 'inv') { env.toast('Inversion works on points only'); return null; }
  if (!o.refs || o.refs.some(r => !pp(r))) { env.toast("This object can't be transformed"); return null; }
  const map = {}, out = [];
  for (const r of new Set(o.refs)) { const n = mk('ptX', { refs: [r, aux], xf, num }); map[r] = n.id; out.push(n); }
  const props = { ...o, id: uid(), refs: o.refs.map(r => map[r]) }; delete props.name; delete props.hidden;
  if (o.kind === 'circR') { props.refs = [map[o.refs[0]]]; props.r = xf === 'dil' ? o.r * Math.abs(num) : o.r; }
  const n = mk(o.kind, props); n.color = o.color; out.push(n); return out;
}
const TOOLS = [
  { id: 'point', cat: 'Points', label: 'Point', next: fx('P'), make: () => [] },
  { id: 'pointOn', cat: 'Points', label: 'Point on object', next: fx('ON'), make: () => [] },
  { id: 'intersect', cat: 'Points', label: 'Intersect', next: fx('I', 'I'), make: r => { const n = intersect(P(r[0]), P(r[1])).length; if (!n) { env.toast('No intersection found'); return null; } return Array.from({ length: Math.min(n, 4) }, (_, i) => mk('inter', { refs: r, i })); } },
  { id: 'midpoint', cat: 'Points', label: 'Midpoint or centre', next: (refs, pr) => !refs.length ? 'M' : refs.length === 1 && pr[0].t === 'p' ? 'P' : null, make: r => [mk('mid', { refs: r })] },

  { id: 'line', cat: 'Lines', label: 'Line', next: fx('P', 'P'), make: r => [mk('line', { refs: r })] },
  { id: 'segment', cat: 'Lines', label: 'Segment', next: fx('P', 'P'), make: r => [mk('seg', { refs: r })] },
  { id: 'segLen', cat: 'Lines', label: 'Segment with length', next: fx('P'), num: { msg: 'Segment length (cm)', def: 3 }, make: (r, c) => { const b = mk('polar', { refs: [r[0]], r: c.num * CM, th: 0 }); return [b, mk('seg', { refs: [r[0], b.id] })]; } },
  { id: 'ray', cat: 'Lines', label: 'Ray', next: fx('P', 'P'), make: r => [mk('ray', { refs: r })] },
  { id: 'polyline', cat: 'Lines', label: 'Polyline', next: () => 'P', open: true, minPts: 2, make: r => [mk('polyline', { refs: r })] },
  { id: 'vector', cat: 'Lines', label: 'Vector', next: fx('P', 'P'), make: r => [mk('vec', { refs: r })] },
  { id: 'vecFrom', cat: 'Lines', label: 'Vector from point', next: fx('V', 'P'), make: r => { const q = mk('ptX', { refs: [r[1], r[0]], xf: 'trans' }); return [q, mk('vec', { refs: [r[1], q.id] })]; } },

  { id: 'perp', cat: 'Special lines', label: 'Perpendicular line', next: either('P', 'L'), make: (r, c) => [mk('perp', { refs: c.pt(r[0]) ? r : [r[1], r[0]] })] },
  { id: 'par', cat: 'Special lines', label: 'Parallel line', next: either('P', 'L'), make: (r, c) => [mk('par', { refs: c.pt(r[0]) ? r : [r[1], r[0]] })] },
  { id: 'perpBis', cat: 'Special lines', label: 'Perpendicular bisector', next: (refs, pr) => !refs.length ? ['P', 'S'] : refs.length === 1 && pr[0].t === 'p' ? 'P' : null, make: r => [mk('perpBis', { refs: r })] },
  { id: 'angBis', cat: 'Special lines', label: 'Angle bisector', next: fx('P', 'P', 'P'), hint: ['first point', 'vertex', 'third point'], make: r => [mk('angBis', { refs: r })] },
  { id: 'tangent', cat: 'Special lines', label: 'Tangents', next: either('P', 'C'), make: (r, c) => { const x = c.pt(r[0]) ? r : [r[1], r[0]]; const a = [mk('tan', { refs: x, i: 0 })]; if (c.P(x[0]) && Math.abs(c.dist(c.P(x[0]), c.P(x[1])) - c.P(x[1]).r) > 1e-6) a.push(mk('tan', { refs: x, i: 1 })); return a; } },

  { id: 'polygon', cat: 'Polygons', label: 'Polygon', next: () => 'P', closeOnFirst: true, minPts: 3, make: r => [mk('poly', { refs: r })] },
  { id: 'regPoly', cat: 'Polygons', label: 'Regular polygon', next: fx('P', 'P'), num: { msg: 'Number of vertices', def: 5, int: true, min: 3 }, make: (r, c) => { const out = []; const ids = [r[0], r[1]]; for (let k = 2; k < c.num; k++) { const v = mk('regv', { refs: [r[0], r[1]], n: c.num, k }); out.push(v); ids.push(v.id); } out.push(mk('poly', { refs: ids })); return out; } },

  { id: 'circ2', cat: 'Circles & arcs', label: 'Circle: centre & point', next: fx('P', 'P'), hint: ['centre', 'a point on the circle'], make: r => [mk('circ2', { refs: r })] },
  { id: 'circR', cat: 'Circles & arcs', label: 'Circle: centre & radius', next: fx('P'), hint: ['centre'], num: { msg: 'Radius (cm)', def: 2 }, make: (r, c) => [mk('circR', { refs: r, r: c.num * CM })] },
  { id: 'compassC', cat: 'Circles & arcs', label: 'Compass', next: (refs, pr) => !refs.length ? ['P', 'S'] : refs.length === 1 ? (pr[0].t === 'p' ? 'P' : 'P') : refs.length === 2 && pr[0].t === 'p' ? 'P' : null, hint: ['segment or first point', 'second point / centre', 'centre'], make: r => [mk('circR2', { refs: r })] },
  { id: 'circ3', cat: 'Circles & arcs', label: 'Circle through 3 points', next: fx('P', 'P', 'P'), make: r => [mk('circ3', { refs: r })] },
  { id: 'semi', cat: 'Circles & arcs', label: 'Semicircle', next: fx('P', 'P'), make: r => [mk('semi', { refs: r })] },
  { id: 'arc', cat: 'Circles & arcs', label: 'Arc: centre, start, end', next: fx('P', 'P', 'P'), hint: ['centre', 'start point', 'end point'], make: r => [mk('arc', { refs: r })] },
  { id: 'sector', cat: 'Circles & arcs', label: 'Sector: centre, start, end', next: fx('P', 'P', 'P'), hint: ['centre', 'start point', 'end point'], make: r => [mk('sector', { refs: r })] },
  { id: 'arc3', cat: 'Circles & arcs', label: 'Arc through 3 points', next: fx('P', 'P', 'P'), make: r => [mk('arc3', { refs: r })] },
  { id: 'sector3', cat: 'Circles & arcs', label: 'Sector through 3 points', next: fx('P', 'P', 'P'), make: r => [mk('sector3', { refs: r })] },

  { id: 'ellipse', cat: 'Conics', label: 'Ellipse', next: fx('P', 'P', 'P'), hint: ['focus 1', 'focus 2', 'point on ellipse'], make: r => [mk('ellipse', { refs: r })] },
  { id: 'hyper', cat: 'Conics', label: 'Hyperbola', next: fx('P', 'P', 'P'), hint: ['focus 1', 'focus 2', 'point on hyperbola'], make: r => [mk('hyper', { refs: r })] },
  { id: 'parab', cat: 'Conics', label: 'Parabola', next: fx('P', 'L'), hint: ['focus', 'directrix (a line)'], make: r => [mk('parab', { refs: r })] },

  { id: 'angle', cat: 'Measure', label: 'Angle', next: (refs, pr) => !refs.length ? ['P', 'L'] : pr[0].t === 'l' ? (refs.length === 1 ? 'L' : null) : refs.length < 3 ? 'P' : null, hint: ['first point (or a line)', 'vertex', 'third point'], make: r => [mk(P(r[0]).t === 'l' ? 'angle2' : 'angle', { refs: r })] },
  { id: 'angleSize', cat: 'Measure', label: 'Angle with given size', next: fx('P', 'P'), hint: ['start point', 'vertex'], num: { msg: 'Angle (degrees)', def: 45 }, make: (r, c) => { const a = mk('ptX', { refs: [r[0], r[1]], xf: 'rot', num: c.num }); return [a, mk('angle', { refs: [r[0], r[1], a.id] })]; } },
  { id: 'dist', cat: 'Measure', label: 'Distance or length', next: (refs, pr) => !refs.length ? 'D' : refs.length === 1 && pr[0].t === 'p' ? 'P' : null, make: r => [mk('meas', { refs: r, mt: 'dist' })] },
  { id: 'area', cat: 'Measure', label: 'Area', next: fx('A'), make: r => [mk('meas', { refs: r, mt: 'area' })] },
  { id: 'slope', cat: 'Measure', label: 'Slope', next: fx('L'), make: r => [mk('meas', { refs: r, mt: 'slope' })] },

  TX('reflLine', 'Reflect about line', 'reflLine', 'L'),
  TX('reflPt', 'Reflect about point', 'reflPt', 'P'),
  TX('inv', 'Reflect about circle', 'inv', 'C'),
  TX('rotate', 'Rotate around point', 'rot', 'P', { msg: 'Rotation angle (degrees, anticlockwise)', def: 90 }),
  TX('translate', 'Translate by vector', 'trans', 'V'),
  TX('dilate', 'Dilate from point', 'dil', 'P', { msg: 'Dilation factor', def: 2 }),

  { id: 'showHide', cat: 'General', label: 'Show / hide object', special: 'vis' },
  { id: 'showLabel', cat: 'General', label: 'Show / hide label', special: 'lbl' },
  { id: 'delete', cat: 'General', label: 'Delete object', special: 'del' },
];
const CATS = [...new Set(TOOLS.map(t => t.cat))];
const DESC = { P: 'a point', L: 'a line', S: 'a segment', C: 'a circle', Y: 'a polygon', O: 'an object', X: 'an object', D: 'a point, segment, circle or polygon', A: 'a polygon or circle', M: 'a point, segment or circle', V: 'a vector', I: 'an object to intersect', ON: 'an object to place the point on' };
function match(n, r, o) {
  if (!r) return false;
  switch (n) {
    case 'P': return r.t === 'p'; case 'L': return r.t === 'l'; case 'S': return r.t === 'l' && (o.kind === 'seg' || o.kind === 'vec');
    case 'C': return r.t === 'c'; case 'Y': return r.t === 'poly'; case 'V': return o.kind === 'vec';
    case 'O': return r.t !== 'txt' && r.t !== 'ang'; case 'ON': return r.t === 'l' || r.t === 'c';
    case 'X': return ['p', 'l', 'c', 'poly', 'pl'].includes(r.t); case 'I': return ['l', 'c', 'poly', 'pl'].includes(r.t);
    case 'D': return ['p', 'l', 'c', 'poly', 'pl'].includes(r.t); case 'A': return r.t === 'poly' || r.t === 'c';
    case 'M': return r.t === 'p' || (r.t === 'l' && (o.kind === 'seg' || o.kind === 'vec')) || r.t === 'c';
  }
  return false;
}

/* ───── tool engine ───── */
const state = { tool: null, refs: [], created: [], before: null, ghost: false };
const T = () => TOOLS.find(t => t.id === state.tool);
function setTool(id) { cancel(); state.tool = id; state.ghost = id === 'showHide'; env.changed(); }
function cancel() {
  if (state.created.length) { const dead = new Set(state.created); env.setObjs(objs().filter(o => !dead.has(o.id))); }
  state.refs = []; state.created = []; state.before = null; reset(); env.changed();
}
function hintText() {
  const t = T(); if (!t) return '';
  if (t.special) return t.label + ': click an object';
  const need = t.next(state.refs, state.refs.map(P));
  if (!need) return t.label;
  const n = state.refs.length, d = t.hint?.[n] || [].concat(need).map(x => DESC[x]).join(' or ');
  let h = `${t.label}: select ${d}`;
  if (t.closeOnFirst && n >= 3) h += ' — click the first point to close';
  if (t.open && n >= 2) h += ' — double-click to finish';
  return h;
}
function pick(need, p, z) {
  const tol = 9 / z, needs = [].concat(need), list = objs().filter(o => o.type === 'geo').reverse();
  const ok = o => !o.hidden || state.ghost;
  if (needs.includes('P')) { const e = list.find(o => ok(o) && ev(o)?.t === 'p' && hit(o, p, tol)); if (e) return e.id; }
  for (const n of needs) if (n !== 'P') { const e = list.find(o => ok(o) && match(n, ev(o), o) && (ev(o).t !== 'p') && hit(o, p, tol)); if (e) return e.id; }
  if (needs.includes('ON') || needs.includes('P')) {
    const on = list.find(o => ok(o) && ['l', 'c'].includes(ev(o)?.t) && hit(o, p, tol));
    if (on) {
      const r = ev(on), n = r.t === 'l' ? { t: ((p.x - r.ax) * (r.bx - r.ax) + (p.y - r.ay) * (r.by - r.ay)) / ((r.bx - r.ax) ** 2 + (r.by - r.ay) ** 2) } : { th: mang(r, p) };
      const q = mk('ptOn', { refs: [on.id], ...n }); state.created.push(q.id); return q.id;
    }
  }
  if (needs.includes('P')) { const q = mk('pt', { x: p.x, y: p.y }); state.created.push(q.id); return q.id; }
  return null;
}
function click(p, z) {
  const t = T(); if (!t) return false;
  if (t.special) {
    const e = objs().filter(o => o.type === 'geo').reverse().find(o => (!o.hidden || state.ghost) && hit(o, p, 9 / z));
    if (!e) return true;
    env.action(() => {
      if (t.special === 'vis') e.hidden = !e.hidden; else if (t.special === 'lbl') e.lbl = !e.lbl;
      else { const ids = withDependents([e.id]); env.setObjs(objs().filter(o => !ids.has(o.id))); }
    }); reset(); env.changed(); return true;
  }
  if (!state.refs.length) { state.before = env.snap(); state.created = []; }
  const need = t.next(state.refs, state.refs.map(P)); if (!need) return true;
  // polygon: clicking the first point closes it
  if (t.closeOnFirst && state.refs.length >= 3) { const e = objs().filter(o => o.type === 'geo').reverse().find(o => ev(o)?.t === 'p' && hit(o, p, 9 / z)); if (e && e.id === state.refs[0]) { finish(); return true; } }
  const id = pick(need, p, z);
  if (!id) { env.toast('Select ' + [].concat(need).map(x => DESC[x]).join(' or ')); return true; }
  state.refs.push(id); state.lastP = p; reset();
  if (!t.next(state.refs, state.refs.map(P))) finish(); else env.changed();
  return true;
}
function finish() {
  const t = T(); if (!t) return;
  if (t.minPts && state.refs.length < t.minPts) return;
  const refs = [...state.refs], before = state.before, created = state.created;
  const done = num => {
    const mkn = objs().length;
    const out = t.make(refs, { num, P, dist, pt: id => P(id)?.t === 'p' });
    if (out === null) { state.refs = [], state.created = created; cancel(); return; }
    void mkn; state.refs = []; state.created = []; state.before = null; reset(); env.commit(before); env.changed();
  };
  if (t.num) { state.refs = []; env.ask(t.num, v => { v == null ? (state.created = created, cancel()) : done(v); }); }
  else done();
}
const dblclick = () => { const t = T(); if (t && t.open) { /* the 2nd click of the double-click added a duplicate point: drop it */ const last = state.refs.length > 2 && state.refs[state.refs.length - 1] === state.refs[state.refs.length - 2]; if (last) state.refs.pop(); finish(); } };
function preview(c, z, hover) {
  const t = T(); if (!t || t.special) return;
  c.save(); c.lineWidth = 1.5 / z;
  for (const id of state.refs) { const r = P(id); if (!r) continue; c.strokeStyle = '#e53935'; c.beginPath(); if (r.t === 'p') c.arc(r.x, r.y, 9 / z, 0, TAU); else { const b = gbox(O(id)); c.rect(b.x, b.y, b.w, b.h); } c.stroke(); }
  const last = state.refs.length && P(state.refs[state.refs.length - 1]);
  if (last && last.t === 'p' && hover) { c.setLineDash([6 / z, 5 / z]); c.strokeStyle = GEO; c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(hover.x, hover.y); c.stroke(); }
  c.restore();
}

return { TOOLS, CATS, state, setTool, cancel, click, finish, dblclick, preview, draw, hit, gbox, reset, moveMany, withDependents, isPoint, hintText, ev, O, P };
};


/* Rishit's Canvas – Whiteboard
 * Vanilla JS, no build step. Objects are kept as vectors in world coordinates;
 * the camera (pan / zoom) is stored per board. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const NAVY = '#000455';
const FONTS = { sans: "'Quicksand','Segoe UI',system-ui,sans-serif", serif: "Georgia,'Times New Roman',serif", mono: "'Courier New',monospace", hand: "'Comic Sans MS','Segoe Print',cursive" };
const COLORS = ['#000455', '#111111', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ffffff', '#9e9e9e'];
const MIN_Z = 0.1, MAX_Z = 4;
let uidN = 0; const uid = () => Date.now().toString(36) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 5);

/* ───────── State ───────── */
const cv = $('#cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, dpr = 1;
const newBoard = () => ({ id: uid(), objs: [], bg: { type: 'none', color: '#ffffff', img: null }, view: { x: 0, y: 0, z: 1 }, undo: [], redo: [], inst: [] });
let boards = [newBoard()], cur = 0;
const imgs = new Map();                     // id -> {src, el}
let geo = null;
let tool = 'pen', prevTool = 'pen', sel = new Set(), clip = [];
const S = {                                 // tool settings
  pen: { color: '#000455', w: 4, hl: false },
  eraser: { size: 28 },
  shape: { kind: 'rect', color: '#000455', w: 3, dash: 'solid', more: false },
  sel: { mode: 'lasso' },
  text: { size: 28, color: '#000455', font: 'sans' },
};
const B = () => boards[cur];
const view = () => B().view;

/* ───────── History ───────── */
const snap = () => structuredClone({ objs: B().objs, bg: B().bg });
function pushUndo(before) { const b = B(); b.undo.push(before); if (b.undo.length > 100) b.undo.shift(); b.redo.length = 0; syncUI(); save(); }
function restore(s) { const b = B(); b.objs = s.objs; b.bg = s.bg; sel = new Set([...sel].filter(id => b.objs.some(o => o.id === id))); closeEditor(true); dirty(); syncUI(); save(); }
function undo() { const b = B(); if (!b.undo.length) return; b.redo.push(snap()); restore(b.undo.pop()); }
function redo() { const b = B(); if (!b.redo.length) return; b.undo.push(snap()); restore(b.redo.pop()); }
function action(fn) { const before = snap(); fn(); pushUndo(before); dirty(); }

/* ───────── Geometry helpers ───────── */
const toW = (sx, sy) => { const v = view(); return { x: (sx - v.x) / v.z, y: (sy - v.y) / v.z }; };
const toS = (x, y) => { const v = view(); return { x: x * v.z + v.x, y: y * v.z + v.y }; };
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function inPoly(p, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p.y) !== (b[1] > p.y) && p.x < (b[0] - a[0]) * (p.y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const mctx = document.createElement('canvas').getContext('2d');
function measure(o) {
  mctx.font = `${o.size}px ${FONTS[o.font] || FONTS.sans}`;
  const lines = o.text.split('\n'); let w = 0;
  for (const l of lines) w = Math.max(w, mctx.measureText(l || ' ').width);
  o.w = Math.max(w, 8); o.h = lines.length * o.size * 1.25; return o;
}
function shapeBox(o) { return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) }; }
const OPEN = new Set(['line', 'arrow', 'darrow']);
const regular = (n, x, y, w, h, r0) => { const p = []; for (let i = 0; i < n; i++) { const a = r0 + i * Math.PI * 2 / n; p.push([x + w / 2 + Math.cos(a) * w / 2, y + h / 2 + Math.sin(a) * h / 2]); } return p; };
const HEART = (() => { const r = []; for (let i = 0; i < 72; i++) { const t = i / 72 * Math.PI * 2; r.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); } return r; })();
function shapePoly(o) {
  const { x, y, w, h } = shapeBox(o), X = f => x + w * f, Y = f => y + h * f, poly = pts => ({ pts, closed: true });
  switch (o.kind) {
    case 'rect': case 'square': return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    case 'triangle': return poly([[X(.5), y], [x + w, y + h], [x, y + h]]);
    case 'rtriangle': return poly([[x, y], [x + w, y + h], [x, y + h]]);
    case 'diamond': case 'rhombus': return poly([[X(.5), y], [x + w, Y(.5)], [X(.5), y + h], [x, Y(.5)]]);
    case 'parallelogram': return poly([[X(.25), y], [x + w, y], [X(.75), y + h], [x, y + h]]);
    case 'trapezium': return poly([[X(.15), y], [X(.7), y], [x + w, y + h], [x, y + h]]);
    case 'itrapezium': return poly([[X(.22), y], [X(.78), y], [x + w, y + h], [x, y + h]]);
    case 'ellipse': case 'circle': return poly(regular(64, x, y, w, h, 0));
    case 'pentagon': return poly(regular(5, x, y, w, h, -Math.PI / 2));
    case 'hexagon': return poly(regular(6, x, y, w, h, 0));
    case 'octagon': return poly(regular(8, x, y, w, h, Math.PI / 8));
    case 'star': { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .42 : 1; p.push([x + w / 2 + Math.cos(a) * r * w / 2, y + h / 2 + Math.sin(a) * r * h / 2]); } return poly(p); }
    case 'heart': return poly(HEART.map(q => [X((q[0] + 16) / 32), Y((q[1] + 17) / 29)]));
    case 'cross': return poly([[X(1 / 3), y], [X(2 / 3), y], [X(2 / 3), Y(1 / 3)], [x + w, Y(1 / 3)], [x + w, Y(2 / 3)], [X(2 / 3), Y(2 / 3)], [X(2 / 3), y + h], [X(1 / 3), y + h], [X(1 / 3), Y(2 / 3)], [x, Y(2 / 3)], [x, Y(1 / 3)], [X(1 / 3), Y(1 / 3)]]);
    default: return { pts: [[o.x1, o.y1], [o.x2, o.y2]], closed: false };
  }
}
function gbox(o) {                         // geometric bounding box (no stroke width)
  if (o.type === 'geo') return geo.gbox(o);
  if (o.type === 'stroke') {
    let a = 1e18, b = 1e18, c = -1e18, d = -1e18;
    for (let i = 0; i < o.pts.length; i += 2) { a = Math.min(a, o.pts[i]); c = Math.max(c, o.pts[i]); b = Math.min(b, o.pts[i + 1]); d = Math.max(d, o.pts[i + 1]); }
    return { x: a, y: b, w: c - a, h: d - b };
  }
  if (o.type === 'shape') return shapeBox(o);
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}
function hit(o, p, tol) {
  if (o.type === 'geo') return !(o.hidden && !geo.state.ghost) && geo.hit(o, p, tol);
  if (o.type === 'stroke') {
    const r = o.w * (o.hl ? 1.5 : .5) + tol, q = o.pts;
    if (q.length === 2) return Math.hypot(p.x - q[0], p.y - q[1]) <= r;
    for (let i = 0; i < q.length - 2; i += 2) if (segDist(p.x, p.y, q[i], q[i + 1], q[i + 2], q[i + 3]) <= r) return true;
    return false;
  }
  if (o.type === 'shape') {
    const { pts, closed } = shapePoly(o);
    if (closed && o.fill && inPoly(p, pts)) return true;
    const n = pts.length, r = o.w / 2 + tol;
    for (let i = 0; i < (closed ? n : n - 1); i++) { const a = pts[i], b = pts[(i + 1) % n]; if (segDist(p.x, p.y, a[0], a[1], b[0], b[1]) <= r) return true; }
    return false;
  }
  return p.x >= o.x - tol && p.x <= o.x + o.w + tol && p.y >= o.y - tol && p.y <= o.y + o.h + tol;
}
function moveObj(o, dx, dy) {
  if (o.type === 'stroke') for (let i = 0; i < o.pts.length; i += 2) { o.pts[i] += dx; o.pts[i + 1] += dy; }
  else if (o.type === 'shape') { o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy; }
  else { o.x += dx; o.y += dy; }
}
function fitObj(o0, o, nb) {               // map o0's box to nb, write into o
  const ob = gbox(o0), sx = ob.w ? nb.w / ob.w : 1, sy = ob.h ? nb.h / ob.h : 1;
  const fx = x => nb.x + (x - ob.x) * sx, fy = y => nb.y + (y - ob.y) * sy;
  if (o.type === 'stroke') for (let i = 0; i < o.pts.length; i += 2) { o.pts[i] = fx(o0.pts[i]); o.pts[i + 1] = fy(o0.pts[i + 1]); }
  else if (o.type === 'shape') { o.x1 = fx(o0.x1); o.x2 = fx(o0.x2); o.y1 = fy(o0.y1); o.y2 = fy(o0.y2); }
  else if (o.type === 'image') { o.x = nb.x; o.y = nb.y; o.w = nb.w; o.h = nb.h; }
  else { o.size = Math.max(6, o0.size * sy); o.x = nb.x; o.y = nb.y; measure(o); }
}
const objs = () => B().objs;
const selObjs = () => objs().filter(o => sel.has(o.id));
const selectLike = () => tool === 'select' || (tool === 'tools' && !geo.state.tool);
geo = WBGeo({
  objs, uid, CM: 37.795, z: () => view().z, snap: () => snap(), commit: b => { pushUndo(b); dirty(); }, action: fn => action(fn),
  setObjs: a => { B().objs = a; }, toast: m => toast(m), ask: (spec, cb) => askNumber(spec, cb), changed: () => geoChanged(),
});
function unionBox(list) {
  let a = 1e18, b = 1e18, c = -1e18, d = -1e18;
  for (const o of list) { const g = gbox(o); a = Math.min(a, g.x); b = Math.min(b, g.y); c = Math.max(c, g.x + g.w); d = Math.max(d, g.y + g.h); }
  return list.length ? { x: a, y: b, w: c - a, h: d - b } : null;
}

/* ───────── Backdrop ───────── */
const isDark = c => { const n = parseInt(c.slice(1), 16); return ((n >> 16) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114) < 110; };
function drawBackdrop(c, v, w, h, bg) {
  c.fillStyle = bg.color || '#fff'; c.fillRect(0, 0, w, h);
  if (bg.type === 'image' && bg.img && imgs.get(bg.img)?.el?.complete) {
    const im = imgs.get(bg.img).el, iw = 1440, ih = iw * im.naturalHeight / im.naturalWidth;
    c.drawImage(im, v.x, v.y, iw * v.z, ih * v.z);
  }
  const t = bg.type; if (!['grid', 'dots', 'lines', 'graph'].includes(t)) return;
  const dark = isDark(bg.color || '#fff');
  const col = a => dark ? `rgba(255,255,255,${a})` : `rgba(0,4,85,${a})`;
  let sp = t === 'graph' ? 20 : 40; while (sp * v.z < 10) sp *= 5;
  const s = sp * v.z, ox = ((v.x % s) + s) % s, oy = ((v.y % s) + s) % s;
  c.lineWidth = 1;
  if (t === 'dots') {
    c.fillStyle = col(.4);
    for (let x = ox; x < w; x += s) for (let y = oy; y < h; y += s) c.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    return;
  }
  const line = (x1, y1, x2, y2) => { c.moveTo(x1, y1); c.lineTo(x2, y2); };
  c.beginPath(); c.strokeStyle = col(t === 'graph' ? .1 : .16);
  if (t !== 'lines') for (let x = ox; x < w; x += s) line(Math.round(x) + .5, 0, Math.round(x) + .5, h);
  for (let y = oy; y < h; y += s) line(0, Math.round(y) + .5, w, Math.round(y) + .5);
  c.stroke();
  if (t === 'graph') {                      // heavier line every 5 cells
    const S5 = s * 5, ox5 = ((v.x % S5) + S5) % S5, oy5 = ((v.y % S5) + S5) % S5;
    c.beginPath(); c.strokeStyle = col(.28);
    for (let x = ox5; x < w; x += S5) line(Math.round(x) + .5, 0, Math.round(x) + .5, h);
    for (let y = oy5; y < h; y += S5) line(0, Math.round(y) + .5, w, Math.round(y) + .5);
    c.stroke();
  }
}

/* ───────── Object rendering ───────── */
function drawObj(c, o, z = view().z) {
  if (o.type === 'geo') { geo.draw(c, o, z, { sel: sel.has(o.id), ghost: geo.state.ghost }); return; }
  c.save();
  if (o.type === 'stroke') {
    c.strokeStyle = o.color; c.fillStyle = o.color; c.lineCap = o.hl ? 'butt' : 'round'; c.lineJoin = 'round';
    c.lineWidth = o.w * (o.hl ? 3 : 1); if (o.hl) c.globalAlpha = .4;
    const p = o.pts;
    if (p.length <= 2) { c.beginPath(); c.arc(p[0], p[1], o.w * (o.hl ? 1.5 : .5), 0, 7); c.fill(); }
    else {
      c.beginPath(); c.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length - 2; i += 2) c.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
      c.lineTo(p[p.length - 2], p[p.length - 1]); c.stroke();
    }
  } else if (o.type === 'shape') {
    c.strokeStyle = o.color; c.lineWidth = o.w; c.lineJoin = 'round'; c.lineCap = 'round';
    if (o.dash === 'dotted') c.setLineDash([0.01, o.w * 2.6]); else if (o.dash === 'dashed') c.setLineDash([o.w * 3.5, o.w * 2.5]);
    const { x, y, w, h } = shapeBox(o); c.beginPath();
    if (o.kind === 'ellipse' || o.kind === 'circle') c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 7);
    else { const { pts, closed } = shapePoly(o); pts.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); if (closed) c.closePath(); }
    c.stroke(); c.setLineDash([]);
    if (o.kind === 'arrow' || o.kind === 'darrow') {
      const ln = Math.hypot(o.x2 - o.x1, o.y2 - o.y1), a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), L = Math.min(Math.max(14, o.w * 4), ln * .6 + 2); c.beginPath();
      const head = (px, py, ang) => { for (const s of [-1, 1]) { c.moveTo(px, py); c.lineTo(px - L * Math.cos(ang + s * .45), py - L * Math.sin(ang + s * .45)); } };
      head(o.x2, o.y2, a); if (o.kind === 'darrow') head(o.x1, o.y1, a + Math.PI); c.stroke();
    }
  } else if (o.type === 'text') {
    c.fillStyle = o.color; c.textBaseline = 'top'; c.font = `${o.size}px ${FONTS[o.font] || FONTS.sans}`;
    o.text.split('\n').forEach((l, i) => c.fillText(l, o.x, o.y + i * o.size * 1.25 + o.size * .12));
  } else if (o.type === 'image') {
    const e = imgs.get(o.img)?.el; if (e && e.complete) c.drawImage(e, o.x, o.y, o.w, o.h);
  }
  c.restore();
}

/* ───────── Geometry instruments (ruler, set square, protractor) ───────── */
const CM = 37.795;
const triHit = (l) => l.x >= -180 && l.y <= 180 && l.y >= l.x;
const INST = {
  ruler: { hit: l => Math.abs(l.x) <= 320 && Math.abs(l.y) <= 32, edges: [[-320, -32, 320, -32], [-320, 32, 320, 32]], handle: [346, 0], close: [-346, 0] },
  square: { hit: triHit, edges: [[-180, 180, 180, 180], [-180, 180, -180, -180], [180, 180, -180, -180]], handle: [30, -30], close: [-150, 150] },
  protractor: { hit: l => (l.x * l.x + (l.y - 100) ** 2 <= 40000 && l.y <= 100) || (Math.abs(l.x) <= 200 && l.y >= 100 && l.y <= 124), edges: [[-200, 100, 200, 100]], handle: [178, 112], close: [-178, 112] },
  compass: { hit: () => false, edges: [], handle: [0, 0], close: [0, 0] },
};
const loc2w = (i, x, y) => { const c = Math.cos(i.a), s = Math.sin(i.a); return { x: i.x + x * c - y * s, y: i.y + x * s + y * c }; };
const w2loc = (i, p) => { const c = Math.cos(-i.a), s = Math.sin(-i.a), dx = p.x - i.x, dy = p.y - i.y; return { x: dx * c - dy * s, y: dx * s + dy * c }; };
function drawTicks(c, x0, y0, x1, y1, nx, ny, z) {  // cm/mm ticks along a segment, normal (nx,ny) points inward
  const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len, mm = CM / 10;
  c.beginPath();
  for (let i = 0; i * mm <= len; i++) {
    const l = i % 10 === 0 ? 16 : i % 5 === 0 ? 11 : 6, px = x0 + ux * i * mm, py = y0 + uy * i * mm;
    c.moveTo(px, py); c.lineTo(px + nx * l, py + ny * l);
  }
  c.stroke();
  c.fillStyle = NAVY; c.font = '11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 10; i * mm <= len - 10; i += 10) c.fillText(String(i / 10), x0 + ux * i * mm + nx * 26, y0 + uy * i * mm + ny * 26);
}
const CL = 240;
function compassGeom(i) { const r = clamp(i.r || 150, 20, CL * 2 - 30), hh = Math.sqrt(CL * CL - (r / 2) ** 2); return { r, T: [r, 0], H: [r / 2, -hh], X: [r / 2, -hh - 38] }; }
function drawCompass(c, i, z) {
  const g = compassGeom(i); c.lineJoin = 'round'; c.lineCap = 'round';
  c.save(); c.strokeStyle = 'rgba(0,4,85,.28)'; c.lineWidth = 1 / z; c.setLineDash([6 / z, 6 / z]); c.beginPath(); c.arc(0, 0, g.r, 0, 7); c.stroke(); c.restore();
  c.strokeStyle = '#6b7280'; c.lineWidth = 6; c.beginPath(); c.moveTo(0, 0); c.lineTo(g.H[0], g.H[1]); c.stroke();           // needle leg
  c.strokeStyle = '#c9964b'; c.lineWidth = 7; c.beginPath(); c.moveTo(g.T[0], g.T[1]); c.lineTo(g.H[0], g.H[1]); c.stroke();  // pencil leg
  const u = [(g.T[0] - g.H[0]) / CL, (g.T[1] - g.H[1]) / CL];
  c.strokeStyle = NAVY; c.lineWidth = 7; c.beginPath(); c.moveTo(g.T[0], g.T[1]); c.lineTo(g.T[0] - u[0] * 26, g.T[1] - u[1] * 26); c.stroke();
  c.fillStyle = NAVY; c.beginPath(); c.arc(0, 0, 4, 0, 7); c.fill();
  c.strokeStyle = NAVY; c.lineWidth = 3; c.beginPath(); c.moveTo(g.H[0], g.H[1]); c.lineTo(g.X[0], g.X[1] + 12); c.stroke();
  c.fillStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.arc(g.H[0], g.H[1], 9, 0, 7); c.fill(); c.stroke();
  c.beginPath(); c.arc(g.T[0], g.T[1], 11 / z, 0, 7); c.lineWidth = 1.5 / z; c.stroke();
  const r = 11 / z, k = r * .4; c.beginPath(); c.arc(g.X[0], g.X[1], r, 0, 7); c.fillStyle = '#fff'; c.fill(); c.stroke();
  c.beginPath(); c.moveTo(g.X[0] - k, g.X[1] - k); c.lineTo(g.X[0] + k, g.X[1] + k); c.moveTo(g.X[0] + k, g.X[1] - k); c.lineTo(g.X[0] - k, g.X[1] + k); c.stroke();
}
function drawInst(c, i, z) {
  c.save(); c.translate(i.x, i.y); c.rotate(i.a);
  if (i.k === 'compass') { drawCompass(c, i, z); c.restore(); return; }
  c.fillStyle = 'rgba(110,160,255,.28)'; c.strokeStyle = NAVY; c.lineWidth = 1.5 / z; c.lineJoin = 'round';
  c.beginPath();
  if (i.k === 'ruler') { c.rect(-320, -32, 640, 64); c.fill(); c.stroke(); c.lineWidth = 1; drawTicks(c, -320, -32, 320, -32, 0, 1, z); }
  else if (i.k === 'square') {
    c.moveTo(-180, 180); c.lineTo(180, 180); c.lineTo(-180, -180); c.closePath();
    c.moveTo(-135, 135); c.lineTo(-135, -45); c.lineTo(45, 135); c.closePath(); c.fill('evenodd'); c.stroke();
    c.lineWidth = 1; drawTicks(c, -180, 180, 180, 180, 0, -1, z); drawTicks(c, -180, 180, -180, -180, 1, 0, z);
  } else {
    c.arc(0, 100, 200, Math.PI, 0); c.lineTo(200, 124); c.lineTo(-200, 124); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-200, 100); c.lineTo(200, 100); c.stroke();
    c.beginPath(); c.arc(0, 100, 6, 0, 7); c.stroke();
    c.lineWidth = 1; c.beginPath();
    for (let d = 0; d <= 180; d++) {
      const l = d % 10 === 0 ? 16 : d % 5 === 0 ? 11 : 6, a = d * Math.PI / 180, ca = Math.cos(a), sa = -Math.sin(a);
      c.moveTo(ca * 200, 100 + sa * 200); c.lineTo(ca * (200 - l), 100 + sa * (200 - l));
    }
    c.stroke(); c.fillStyle = NAVY; c.font = '11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let d = 10; d <= 170; d += 10) { const a = d * Math.PI / 180; c.fillText(d, Math.cos(a) * 166, 100 - Math.sin(a) * 166); }
  }
  // close + rotate handles (constant on-screen size)
  const def = INST[i.k], r = 11 / z;
  for (const [pt, kind] of [[def.close, 'x'], [def.handle, 'r']]) {
    c.beginPath(); c.arc(pt[0], pt[1], r, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.5 / z; c.strokeStyle = NAVY; c.stroke();
    c.beginPath();
    if (kind === 'x') { const k = r * .4; c.moveTo(pt[0] - k, pt[1] - k); c.lineTo(pt[0] + k, pt[1] + k); c.moveTo(pt[0] + k, pt[1] - k); c.lineTo(pt[0] - k, pt[1] + k); }
    else c.arc(pt[0], pt[1], r * .5, -Math.PI * .8, Math.PI * .6);
    c.stroke();
  }
  c.restore();
}
function instAt(p, z, edgeOnly) {
  const list = B().inst;
  for (let n = list.length - 1; n >= 0; n--) {
    const i = list[n], def = INST[i.k], l = w2loc(i, p), r = 14 / z;
    if (i.k === 'compass') {
      const g = compassGeom(i), dd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), q = [l.x, l.y];
      if (dd(q, g.X) <= r) return { i, part: 'close' };
      if (dd(q, g.T) <= r) return { i, part: 'tip' };
      if (dd(q, g.H) <= r || segDist(l.x, l.y, 0, 0, g.H[0], g.H[1]) <= 8 + 4 / z || segDist(l.x, l.y, g.T[0], g.T[1], g.H[0], g.H[1]) <= 8 + 4 / z) return { i, part: 'body' };
      continue;
    }
    if (Math.hypot(l.x - def.close[0], l.y - def.close[1]) <= r) return { i, part: 'close' };
    if (Math.hypot(l.x - def.handle[0], l.y - def.handle[1]) <= r) return { i, part: 'rot' };
    if (def.hit(l)) {
      if (edgeOnly) {
        for (const e of def.edges) if (segDist(l.x, l.y, e[0], e[1], e[2], e[3]) <= r) return { i, part: 'edge' };
      }
      return { i, part: 'body' };
    }
  }
  return null;
}
function snapEdge(p, z) {                    // nearest instrument edge within reach -> world segment
  let best = null, bd = 14 / z;
  for (const i of B().inst) for (const e of INST[i.k].edges) {
    const a = loc2w(i, e[0], e[1]), b = loc2w(i, e[2], e[3]), d = segDist(p.x, p.y, a.x, a.y, b.x, b.y);
    if (d < bd) { bd = d; best = { a, b }; }
  }
  return best;
}
function projEdge(sn, p) {
  const dx = sn.b.x - sn.a.x, dy = sn.b.y - sn.a.y, t = clamp(((p.x - sn.a.x) * dx + (p.y - sn.a.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return { x: sn.a.x + dx * t, y: sn.a.y + dy * t };
}

/* ───────── Rendering ───────── */
let needs = false;
function dirty() { if (geo) geo.reset(); if (!needs) { needs = true; requestAnimationFrame(frame); } }
let hover = null, marquee = null, drawing = null;   // overlay state
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
function handlePos(b) {
  const x2 = b.x + b.w, y2 = b.y + b.h, mx = b.x + b.w / 2, my = b.y + b.h / 2;
  return { nw: [b.x, b.y], n: [mx, b.y], ne: [x2, b.y], e: [x2, my], se: [x2, y2], s: [mx, y2], sw: [b.x, y2], w: [b.x, my] };
}
function frame() {
  needs = false;
  const v = view();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBackdrop(ctx, v, W, H, B().bg);
  ctx.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y);
  const x0 = -v.x / v.z, y0 = -v.y / v.z, x1 = x0 + W / v.z, y1 = y0 + H / v.z;
  for (const pass of [0, 1]) for (const o of objs()) {
    if ((pass === 1) !== (o.type === 'geo' && geo.isPoint(o))) continue;   // construction points on top
    if (o.type !== 'geo') {
      const g = gbox(o), pad = (o.w || 0) * 2 + 4;
      if (g.x - pad > x1 || g.x + g.w + pad < x0 || g.y - pad > y1 || g.y + g.h + pad < y0) continue;
    }
    drawObj(ctx, o, v.z);
  }
  for (const i of B().inst) drawInst(ctx, i, v.z);
  if (tool === 'tools' && geo.state.tool) geo.preview(ctx, v.z, hover ? toW(hover.x, hover.y) : null);
  // selection overlay in screen space
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const list = selObjs();
  if (list.length && selectLike() && !list.every(o => o.type === 'geo') && !(drawing && drawing.t === 'draw')) {
    const ub = unionBox(list), a = toS(ub.x, ub.y), b = toS(ub.x + ub.w, ub.y + ub.h);
    ctx.strokeStyle = '#1e88e5'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.strokeRect(a.x - 4, a.y - 4, b.x - a.x + 8, b.y - a.y + 8); ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    for (const [k, h] of selHandles(list)) { const s = toS(h[0], h[1]); ctx.beginPath(); ctx.rect(s.x - 5, s.y - 5, 10, 10); ctx.fill(); ctx.stroke(); void k; }
  }
  if (marquee) {
    const m = marquee, a = toS(m.x1, m.y1), b = toS(m.x2, m.y2); ctx.fillStyle = 'rgba(30,136,229,.12)'; ctx.strokeStyle = '#1e88e5'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
    ctx.beginPath();
    if (m.mode === 'ellipse') ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, 7);
    else if (m.mode === 'lasso' || m.mode === 'touch') { m.pts.forEach((q, i) => { const s = toS(q[0], q[1]); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); }
    else ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    if (m.mode !== 'touch' && m.mode !== 'lasso') ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }
  if (tool === 'eraser' && hover) { ctx.beginPath(); ctx.arc(hover.x, hover.y, S.eraser.size / 2, 0, 7); ctx.strokeStyle = NAVY; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = 'rgba(0,4,85,.06)'; ctx.fill(); }
  placeSelBar();
}
function selHandles(list) {                  // [[name,[wx,wy]]]
  if (list.length === 1 && list[0].type === 'shape' && OPEN.has(list[0].kind)) return [['p1', [list[0].x1, list[0].y1]], ['p2', [list[0].x2, list[0].y2]]];
  if (list.length !== 1 || list[0].type === 'geo') return [];
  return Object.entries(handlePos(gbox(list[0])));
}

/* ───────── Canvas sizing ───────── */
function resize() {
  const r = $('#stage').getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); dirty(); layout();
}
window.addEventListener('resize', resize);

/* ───────── Bottom bar layout ───────── */
const bbar = $('#bbar');
const barTop = () => bbar.getBoundingClientRect().top;
function layout() {
  const h = Math.round(bbar.getBoundingClientRect().height);
  if (String(h) !== document.documentElement.style.getPropertyValue('--bar-h').replace('px', '')) {
    document.documentElement.style.setProperty('--bar-h', h + 'px'); resize(); return;
  }
  placePop();
}
if (window.ResizeObserver) new ResizeObserver(() => layout()).observe(bbar);

/* ───────── Tool selection & popovers ───────── */
const pop = $('#pop'); let popFor = null;
const toolBtn = n => document.querySelector(`.tool[data-tool="${n}"],.tool[data-action="${n}"]`);
function setTool(t) {
  if (t === 'tools') { if (tool !== 'tools') prevTool = tool; }
  if (tool === 'tools' && t !== 'tools') geo.cancel();
  tool = t; document.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  if (!['select', 'tools'].includes(t)) sel.clear();
  closeEditor(true); geoChanged();
}
function updateCursor() {
  cv.style.cursor = { select: 'default', tools: geo.state.tool ? 'crosshair' : 'default', move: 'grab', pen: 'crosshair', shapes: 'crosshair', text: 'text', eraser: 'none' }[tool] || 'default';
}
function openPop(name) { popFor = name; renderPop(); pop.hidden = false; placePop(); document.querySelectorAll('.tool').forEach(b => b.classList.toggle('open', (b.dataset.tool || b.dataset.action) === name && !b.classList.contains('active'))); }
function closePop() { closePicker(); popFor = null; pop.hidden = true; document.querySelectorAll('.tool.open').forEach(b => b.classList.remove('open')); }
function placePop() {
  if (!popFor || pop.hidden) return;
  const b = toolBtn(popFor).getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  const bt = barTop(); pop.style.maxHeight = Math.max(160, bt - 78) + 'px';
  const ph2 = Math.min(ph, bt - 78), x = clamp(b.left + b.width / 2 - pw / 2, 6, innerWidth - pw - 6);
  pop.style.left = x + 'px'; pop.style.top = Math.max(66, bt - ph2 - 12) + 'px';
}
const HAS_POP = new Set(['select', 'pen', 'eraser', 'shapes', 'text', 'tools']);
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.tool, a = b.dataset.action;
  if (a === 'clear') { closePop(); askClear(); return; }
  if (a === 'backdrop') { popFor === 'backdrop' ? closePop() : openPop('backdrop'); return; }
  if (t === tool) { if (popFor === t) closePop(); else if (HAS_POP.has(t)) openPop(t); return; }   // clicking the active tool again opens its options
  closePop(); setTool(t);
}));

const h = (tag, attrs = {}, kids = []) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); } kids.forEach(c => e.append(c)); return e; };
function sec(title, ...kids) { return h('div', { class: 'sec' }, [h('h3', { html: title }), ...kids]); }
/* ── Figma-style colour picker: saturation/brightness square, hue bar, hex field ── */
const cp = $('#cp'); let cpS = null;
const hex2rgb = hx => { hx = hx.replace('#', ''); if (hx.length === 3) hx = hx.split('').map(c => c + c).join(''); const n = parseInt(hx, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = (r, g, b) => '#' + [r, g, b].map(q => q.toString(16).padStart(2, '0')).join('');
function rgb2hsv(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); let hh = 0; if (d) { hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; } return [hh, mx ? d / mx : 0, mx]; }
function hsv2rgb(hh, s, v) { const c = v * s, x = c * (1 - Math.abs((hh / 60) % 2 - 1)), m = v - c; const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.min(5, Math.floor(hh / 60))]; return t.map(q => Math.round((q + m) * 255)); }
cp.innerHTML = '<div class="cp-sv"><i></i></div><div class="cp-hue"><i></i></div><div class="cp-row"><span class="cp-prev"></span><label class="cp-field"><b>#</b><input class="cp-hex" maxlength="6" spellcheck="false" autocomplete="off"></label><button class="cp-eye" title="Pick a colour from the screen" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l5 5-3 1-7 7-3 1-1 3-2-2 3-1 1-3 7-7z"/></svg></button></div>';
const cpSV = $('.cp-sv', cp), cpHue = $('.cp-hue', cp), cpHex = $('.cp-hex', cp), cpPrev = $('.cp-prev', cp), cpEye = $('.cp-eye', cp);
if (window.EyeDropper) cpEye.hidden = false;
function cpPaint(skipHex) {
  const [hh, s2, v] = cpS.hsv, hex = rgb2hex(...hsv2rgb(hh, s2, v));
  cp.style.setProperty('--h', hh); cpSV.firstChild.style.left = s2 * 100 + '%'; cpSV.firstChild.style.top = (1 - v) * 100 + '%'; cpHue.firstChild.style.left = hh / 360 * 100 + '%';
  cpSV.firstChild.style.background = hex; cpPrev.style.background = hex; if (!skipHex) cpHex.value = hex.slice(1).toUpperCase();
  cpS.hex = hex; cpS.cb(hex);
}
function drag(el, fn) { el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); const mv = ev => { const r = el.getBoundingClientRect(); fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1)); }; mv(e); el.onpointermove = mv; el.onpointerup = el.onpointercancel = () => { el.onpointermove = null; }; e.preventDefault(); }); }
drag(cpSV, (x, y) => { cpS.hsv[1] = x; cpS.hsv[2] = 1 - y; cpPaint(); });
drag(cpHue, x => { cpS.hsv[0] = x * 359.99; cpPaint(); });
cpHex.addEventListener('input', () => { const v = cpHex.value.replace(/[^0-9a-f]/gi, ''); if (v.length === 6 || v.length === 3) { cpS.hsv = rgb2hsv(...hex2rgb(v)); cpPaint(true); } });
cpHex.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') closePicker(); });
cpHex.addEventListener('blur', () => { if (cpS) cpHex.value = cpS.hex.slice(1).toUpperCase(); });
cpEye.addEventListener('click', async () => { try { const r = await new EyeDropper().open(); cpS.hsv = rgb2hsv(...hex2rgb(r.sRGBHex)); cpPaint(); } catch (e) { } });
function openPicker(anchor, color, cb, onClose) {
  closePicker(); const c = /^#[0-9a-f]{3,6}$/i.test(color || '') ? color : '#000455';
  cpS = { anchor, cb, onClose, hsv: rgb2hsv(...hex2rgb(c)), hex: c }; cp.hidden = false; cp.classList.remove('in'); void cp.offsetWidth; cp.classList.add('in');
  const old = cpS.cb; cpS.cb = () => { }; cpPaint(); cpS.cb = old;
  const ar = anchor.getBoundingClientRect(), pw = cp.offsetWidth, ph = cp.offsetHeight;
  const pr = !pop.hidden && pop.contains(anchor) ? pop.getBoundingClientRect() : ar;     // sit beside the dialog, never on top of it
  let x = pr.right + 10; if (x + pw > innerWidth - 6) x = pr.left - pw - 10;
  let y = clamp(ar.top - ph / 2, 66, barTop() - ph - 8);
  if (x < 6) { x = clamp(ar.left, 6, innerWidth - pw - 6); y = ar.top - ph - 10 >= 66 ? ar.top - ph - 10 : Math.max(66, Math.min(ar.bottom + 10, barTop() - ph - 8)); }
  cp.style.left = x + 'px'; cp.style.top = y + 'px';
}
function closePicker() { if (!cpS) return; const f = cpS.onClose; cpS = null; cp.hidden = true; if (f) f(); }
document.addEventListener('pointerdown', e => { if (cpS && !cp.contains(e.target) && !cpS.anchor.contains(e.target)) closePicker(); }, true);

function swatches(cur, set, onCustomClose) {
  const wrap = h('div', { class: 'sw' }), low = (cur || '').toLowerCase(), custom = !COLORS.some(c => c.toLowerCase() === low);
  COLORS.forEach(c => wrap.append(h('button', { style: `--c:${c}`, class: 'dot' + (c.toLowerCase() === low ? ' on' : ''), title: c, on: { click: () => { closePicker(); set(c); renderPop(); } } })));
  const b = h('button', { class: 'dot rainbow' + (custom ? ' on' : ''), title: 'Custom colour…' }, [h('i', { style: custom ? `background:${cur}` : '' })]);
  b.addEventListener('click', () => { if (cpS && cpS.anchor === b) closePicker(); else openPicker(b, cur, c => set(c), onCustomClose || (() => renderPop())); });
  wrap.append(b); return wrap;
}
function slider(min, max, val, set, unit = '') {
  const out = h('b', { html: val + unit }), pct = v => ((v - min) / (max - min)) * 100 + '%';
  const r = h('input', { type: 'range', min, max, value: val, style: `--p:${pct(val)}`, on: { input: e => { const v = +e.target.value; e.target.style.setProperty('--p', pct(v)); set(v); out.textContent = v + unit; } } });
  return h('div', { class: 'row' }, [r, out]);
}
const SHAPES = [['rect', 'Rectangle'], ['square', 'Square'], ['circle', 'Circle'], ['ellipse', 'Ellipse'], ['rhombus', 'Rhombus'], ['parallelogram', 'Parallelogram'], ['trapezium', 'Trapezium'], ['itrapezium', 'Isosceles trapezium']];
const MORE = [['triangle', 'Triangle'], ['rtriangle', 'Right triangle'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['octagon', 'Octagon'], ['star', 'Star'], ['heart', 'Heart'], ['cross', 'Cross']];
const LINES = [['line', 'Line'], ['dotline', 'Dotted line'], ['arrow', 'Arrow'], ['dotarrow', 'Dotted arrow'], ['darrow', 'Double arrow']];
function shapeIcon(k) {
  const st = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
  if (LINES.some(l => l[0] === k)) {
    const dash = k.startsWith('dot') ? ' stroke-dasharray="0.1 4.2"' : '';
    return `<svg viewBox="0 0 24 24"><path d="M4 20L20 4"${dash} ${st}/>${k.includes('arrow') ? `<path d="M11 4h9v9" ${st}/>` : ''}${k === 'darrow' ? `<path d="M13 20H4v-9" ${st}/>` : ''}</svg>`;
  }
  if (k === 'circle') return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" ${st}/></svg>`;
  if (k === 'ellipse') return `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9.5" ry="6" ${st}/></svg>`;
  const box = { square: [4, 4, 20, 20], star: [2, 2, 22, 22], hexagon: [3, 3, 21, 21], octagon: [3, 3, 21, 21], pentagon: [3, 3, 21, 21], heart: [3, 4, 21, 21], cross: [4, 4, 20, 20], rtriangle: [4, 4, 20, 20], triangle: [3, 4, 21, 20] }[k] || [3, 5, 21, 19];
  const pts = shapePoly({ kind: k, x1: box[0], y1: box[1], x2: box[2], y2: box[3] }).pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
  return `<svg viewBox="0 0 24 24"><polygon points="${pts}" ${st}/></svg>`;
}
const ICON = {
  rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2.4"/></svg>',
  ellipse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="12" rx="8.5" ry="6.5" stroke-dasharray="3 2.4"/></svg>',
  lasso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9c0-3 4-5 8-4s7 3 6 6-5 5-9 5c-1 0-2 0-3-.5"/><path d="M7 15c-1.5.5-2 2-1 3s3 1 3-1"/></svg>',
  touch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3-8 7 2 10-6s5-4 8-6"/><circle cx="21" cy="5" r="1.2" fill="currentColor"/></svg>',
};
const dashSvg = d => `<svg viewBox="0 0 44 8"><path d="M3 4H41" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" ${d === 'dotted' ? 'stroke-dasharray="0.1 6"' : d === 'dashed' ? 'stroke-dasharray="8 5"' : ''}/></svg>`;
const chipBtn = (label, on, fn, extra = {}) => h('button', { class: 'chip' + (on ? ' on' : ''), on: { click: fn }, ...extra }, [label]);
function renderPop() {
  pop.replaceChildren(); pop.classList.toggle('wide', popFor === 'tools');
  const head = (t, sub) => pop.append(h('div', { class: 'ph' }, [h('b', { html: t }), sub ? h('span', { html: sub }) : '']));
  if (popFor === 'select') {
    head('Select', S.sel.mode === 'lasso' ? 'Free-form selects only what is inside your loop' : 'How dragging on the board selects');
    const m = S.sel.mode, modes = [['lasso', 'Free-form'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['touch', 'Touch line']];
    pop.append(sec('Selection mode', h('div', { class: 'grid2' }, modes.map(([k, n]) => h('button', { class: 'chip tall' + (m === k ? ' on' : ''), on: { click: () => { S.sel.mode = k; renderPop(); } }, html: `${ICON[k]}<span>${n}</span>` })))),
      sec('Quick actions', h('div', { class: 'chips' }, [
        chipBtn('Select all', 0, () => { sel = new Set(objs().map(o => o.id)); dirty(); }),
        chipBtn('Invert', 0, () => { sel = new Set(objs().filter(o => !sel.has(o.id)).map(o => o.id)); dirty(); }),
        chipBtn('Deselect', 0, () => { sel.clear(); dirty(); })])),
      h('p', { class: 'hint', html: 'Free-form: draw a loop around objects. Touch line: swipe across the objects you want. Hold <b>Shift</b> while clicking to add to a selection.' }));
  } else if (popFor === 'pen') {
    head('Pen', 'Freehand drawing');
    const s = S.pen, prev = h('div', { class: 'prev' }); const upd = () => { prev.innerHTML = `<svg viewBox="0 0 200 40"><path d="M12 28C40 6 60 6 90 24S150 36 188 12" fill="none" stroke="${s.color}" stroke-width="${s.w}" stroke-linecap="round"/></svg>`; }; upd();
    pop.append(prev, sec('Colour', swatches(s.color, c => { s.color = c; upd(); }, () => renderPop())), sec('Thickness', slider(1, 30, s.w, v => { s.w = v; upd(); }, 'px')),
      h('p', { class: 'hint', html: 'Open the ruler or set square (Tools) and start a line next to its edge to draw perfectly straight lines.' }));
  } else if (popFor === 'eraser') {
    head('Eraser', 'Rub out parts of drawings');
    const dot = h('div', { class: 'eprev' }, [h('i', { style: `width:${S.eraser.size}px;height:${S.eraser.size}px` })]);
    pop.append(dot, sec('Eraser size', slider(8, 100, S.eraser.size, v => { S.eraser.size = v; dot.firstChild.style.width = dot.firstChild.style.height = v + 'px'; dirty(); }, 'px')),
      h('p', { class: 'hint', html: 'Cuts through pen strokes; shapes, text, images and constructions are removed when touched.' }));
  } else if (popFor === 'shapes') {
    head('Shapes', 'Drag on the board to draw');
    const s = S.shape, grid = list => h('div', { class: 'grid4' }, list.map(([k, n]) => h('button', { class: 'chip icon' + (s.kind === k ? ' on' : ''), title: n, on: { click: () => { s.kind = k; renderPop(); } }, html: shapeIcon(k) })));
    const more = h('div', { class: 'more' + (s.more ? ' open' : '') }, [grid(MORE)]);
    const prev = h('div', { class: 'prev small' }); const upd = () => { prev.innerHTML = `<svg viewBox="0 0 200 26"><path d="M12 13H188" fill="none" stroke="${s.color}" stroke-width="${s.w}" stroke-linecap="round" ${s.dash === 'dotted' ? `stroke-dasharray="0.01 ${s.w * 2.6}"` : s.dash === 'dashed' ? `stroke-dasharray="${s.w * 3.5} ${s.w * 2.5}"` : ''}/></svg>`; }; upd();
    pop.append(sec('Lines', grid(LINES)), sec('Shapes', grid(SHAPES),
      h('button', { class: 'morebtn', on: { click: () => { s.more = !s.more; more.classList.toggle('open', s.more); b2.textContent = s.more ? 'Fewer shapes' : 'More shapes'; } } }, []), more),
      sec('Outline', h('div', { class: 'chips' }, [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']].map(([k, n]) => h('button', { class: 'chip dash' + (s.dash === k ? ' on' : ''), title: n, on: { click: () => { s.dash = k; renderPop(); } }, html: dashSvg(k) })))),
      sec('Colour', swatches(s.color, c => { s.color = c; upd(); })), sec('Thickness', slider(1, 20, s.w, v => { s.w = v; upd(); }, 'px')), prev);
    var b2 = pop.querySelector('.morebtn'); b2.textContent = s.more ? 'Fewer shapes' : 'More shapes';
  } else if (popFor === 'text') {
    head('Text', 'Click the board to type');
    const s = S.text, prev = h('div', { class: 'prev tx' }); const upd = () => { prev.textContent = 'Aa Bb 123'; prev.style.cssText = `font-family:${FONTS[s.font]};color:${s.color};font-size:${Math.min(44, s.size)}px`; }; upd();
    pop.append(prev, sec('Font', h('div', { class: 'chips' }, [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono'], ['hand', 'Hand']].map(([k, n]) => h('button', { class: 'chip' + (s.font === k ? ' on' : ''), style: `font-family:${FONTS[k]}`, on: { click: () => { s.font = k; renderPop(); } } }, [n])))),
      sec('Colour', swatches(s.color, c => { s.color = c; upd(); })), sec('Size', slider(10, 120, s.size, v => { s.size = v; upd(); }, 'px')),
      h('p', { class: 'hint', html: 'Double-click existing text with the Select tool to edit it.' }));
  } else if (popFor === 'tools') {
    head('Geometry tools', 'Constructions work like GeoGebra');
    const on = k => B().inst.some(i => i.k === k);
    const toggle = k => { if (on(k)) B().inst = B().inst.filter(i => i.k !== k); else { const c = toW(W / 2, H / 2), n = B().inst.length * 50; B().inst.push({ id: uid(), k, x: c.x + n, y: c.y + n, a: 0, r: 150 }); } renderPop(); dirty(); };
    pop.append(sec('Instruments', h('div', { class: 'grid2' }, [['ruler', 'Ruler'], ['square', 'Set square'], ['protractor', 'Protractor'], ['compass', 'Compass']].map(([k, n]) => chipBtn(n, on(k), () => toggle(k))))));
    for (const cat of geo.CATS) {
      const items = geo.TOOLS.filter(t => t.cat === cat).map(t => chipBtn(t.label, geo.state.tool === t.id, () => { geo.setTool(t.id); closePop(); }));
      if (cat === 'General') items.unshift(chipBtn('Move / select', !geo.state.tool, () => { geo.setTool(null); closePop(); }));
      pop.append(sec(cat, h('div', { class: 'grid2 tl' }, items)));
    }
    pop.append(h('p', { class: 'hint', html: 'Pick a tool, then click on the board. <b>Esc</b> cancels. Drag points with <i>Move / select</i> and everything built on them follows.' }));
  } else if (popFor === 'backdrop') {
    head('Backdrop', 'Background of this board');
    const bg = B().bg, set = patch => action(() => Object.assign(B().bg, patch)), bgs = ['#ffffff', '#fff8e1', '#f2f2f2', '#e8f1ff', '#e8f5e9', '#1f3d2b', '#111111', '#000455'];
    const w = h('div', { class: 'sw' }), custom = !bgs.includes(bg.color.toLowerCase());
    bgs.forEach(c => w.append(h('button', { style: `--c:${c}`, class: 'dot' + (bg.color.toLowerCase() === c ? ' on' : ''), title: c, on: { click: () => { closePicker(); set({ color: c }); renderPop(); } } })));
    const rb = h('button', { class: 'dot rainbow' + (custom ? ' on' : ''), title: 'Custom colour…' }, [h('i', { style: custom ? `background:${bg.color}` : '' })]);
    rb.addEventListener('click', () => {
      if (cpS && cpS.anchor === rb) return closePicker(); const before = snap();
      openPicker(rb, bg.color, c => { B().bg.color = c; dirty(); save(); }, () => { if (JSON.stringify(before.bg) !== JSON.stringify(B().bg)) pushUndo(before); renderPop(); });
    });
    w.append(rb);
    pop.append(sec('Pattern', h('div', { class: 'grid3' }, [['none', 'Plain'], ['grid', 'Grid'], ['dots', 'Dots'], ['lines', 'Lines'], ['graph', 'Graph']].map(([k, n]) => chipBtn(n, bg.type === k, () => { set({ type: k }); renderPop(); })))),
      sec('Colour', w),
      sec('Image', h('div', { class: 'chips' }, [chipBtn('Upload…', 0, () => pickImage('backdrop')), bg.type === 'image' ? chipBtn('Remove', 0, () => { set({ type: 'none', img: null }); renderPop(); }) : ''])));
  }
}
document.addEventListener('pointerdown', e => { if (popFor && !pop.contains(e.target) && !cp.contains(e.target) && !e.target.closest('.tool') && !e.target.closest('#bbar')) closePop(); }, true);

/* ───────── Images ───────── */
const fileImg = $('#fileImg'); let imgMode = 'object';
function pickImage(mode) { imgMode = mode; fileImg.value = ''; fileImg.click(); }
fileImg.addEventListener('change', () => { if (fileImg.files[0]) loadImageFile(fileImg.files[0], imgMode); });
function loadImageFile(file, mode, at) {
  if (!file || !file.type.startsWith('image/')) return;
  const fr = new FileReader();
  fr.onload = () => {
    const im = new Image();
    im.onload = () => {
      const m = 1800, k = Math.min(1, m / Math.max(im.naturalWidth, im.naturalHeight)); let src = fr.result, el = im;
      if (k < 1) { const c = document.createElement('canvas'); c.width = im.naturalWidth * k; c.height = im.naturalHeight * k; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); src = c.toDataURL('image/jpeg', .88); el = new Image(); el.src = src; }
      const id = uid(); imgs.set(id, { src, el });
      const go = () => {
        if (mode === 'backdrop') { action(() => { B().bg.type = 'image'; B().bg.img = id; }); if (popFor === 'backdrop') renderPop(); }
        else {
          const c = at || toW(W / 2, H / 2), s = Math.min(1, 480 / Math.max(im.naturalWidth, im.naturalHeight)), w = im.naturalWidth * s, hh = im.naturalHeight * s;
          const o = { id: uid(), type: 'image', img: id, x: c.x - w / 2, y: c.y - hh / 2, w, h: hh };
          action(() => objs().push(o)); setTool('select'); sel = new Set([o.id]); syncUI();
        }
        dirty();
      };
      el.complete ? go() : (el.onload = go);
    };
    im.src = fr.result;
  };
  fr.readAsDataURL(file);
}
window.addEventListener('paste', e => { if (/input|textarea/i.test(e.target.tagName)) return; const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/')); if (f) { loadImageFile(f, 'object'); e.preventDefault(); } else if (clip.length) pasteClip(); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) { const r = $('#stage').getBoundingClientRect(); loadImageFile(f, 'object', toW(e.clientX - r.left, e.clientY - r.top)); } });

/* ───────── Text editor overlay ───────── */
const ted = $('#ted'); let editing = null;       // {obj|null, x, y, isNew}
function openEditor(o, wx, wy) {
  closeEditor(true);
  const base = o || { size: S.text.size, color: S.text.color, font: S.text.font };
  editing = { o, x: o ? o.x : wx, y: o ? o.y : wy, before: snap() };
  ted.value = o ? o.text : ''; ted.style.display = 'block'; positionEditor(base); ted.focus(); ted.select();
  if (o) dirty();
}
function positionEditor(base) {
  const v = view(), b = base || editing.o || { size: S.text.size, color: S.text.color, font: S.text.font };
  ted.style.left = editing.x * v.z + v.x + 'px'; ted.style.top = editing.y * v.z + v.y + 'px';
  ted.style.fontSize = b.size * v.z + 'px'; ted.style.fontFamily = FONTS[b.font] || FONTS.sans; ted.style.color = b.color;
  fitEditor();
}
function fitEditor() { ted.style.width = '10px'; ted.style.height = '10px'; ted.style.width = ted.scrollWidth + 6 + 'px'; ted.style.height = ted.scrollHeight + 'px'; }
ted.addEventListener('input', fitEditor);
ted.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') closeEditor(false); else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) closeEditor(false); });
ted.addEventListener('blur', () => closeEditor(false));
ted.addEventListener('pointerdown', e => e.stopPropagation());
function closeEditor(silent) {
  if (!editing) return; const ed = editing; editing = null; const txt = ted.value; ted.style.display = 'none';
  if (silent === true && !txt.trim()) return;
  const b = B();
  if (ed.o) {
    const o = b.objs.find(q => q.id === ed.o.id); if (!o) return;
    if (!txt.trim()) { b.objs = b.objs.filter(q => q !== o); sel.delete(o.id); pushUndo(ed.before); }
    else if (txt !== o.text) { o.text = txt; measure(o); pushUndo(ed.before); }
  } else if (txt.trim()) {
    const o = measure({ id: uid(), type: 'text', x: ed.x, y: ed.y, text: txt, size: S.text.size, color: S.text.color, font: S.text.font });
    b.objs.push(o); pushUndo(ed.before);
  }
  dirty();
}

/* ───────── Pointer interaction ───────── */
const pts = new Map(); let pinch = null, spaceDown = false, space0 = null;
const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function ensureNotEditing() { if (editing) closeEditor(false); }

cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); const s = pos(e); pts.set(e.pointerId, s);
  if (popFor) closePop(); closePicker();
  if (pts.size === 2) { cancelDrag(); const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, z: view().z, v: { ...view() } }; return; }
  if (pts.size > 2) return;
  ensureNotEditing();
  const z = view().z, p = toW(s.x, s.y); let t = tool === 'tools' ? (geo.state.tool ? 'geo' : 'select') : tool;
  if (e.button === 1 || spaceDown) { drawing = { t: 'pan', sx: s.x, sy: s.y, vx: view().x, vy: view().y }; cv.style.cursor = 'grabbing'; return; }
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  // instruments take priority for select / pen (pen only away from their edges)
  if (t === 'select' || t === 'pen' || t === 'geo') {
    let hitI = instAt(p, z, false);
    if (t === 'geo' && hitI && hitI.part === 'body') hitI = null;
    if (hitI && hitI.part === 'body' && t === 'pen' && snapEdge(p, z)) hitI = null;   // near an edge: draw, don't drag
    if (hitI) {
      const i = hitI.i, list = B().inst; list.push(list.splice(list.indexOf(i), 1)[0]);
      if (hitI.part === 'close') { B().inst = list.filter(q => q !== i); if (popFor === 'tools') renderPop(); dirty(); return; }
      if (hitI.part === 'tip') {
        const th = Math.atan2(p.y - i.y, p.x - i.x);
        if (t === 'pen') { const g = compassGeom(i), o = { id: uid(), type: 'stroke', pts: [i.x + g.r * Math.cos(th), i.y + g.r * Math.sin(th)], color: S.pen.color, w: S.pen.w, hl: false }; i.a = th; drawing = { t: 'cdraw', i, o, before: snap(), th }; objs().push(o); }
        else drawing = { t: 'ctip', i };
      } else drawing = hitI.part === 'rot' ? { t: 'irot', i, off: Math.atan2(INST[i.k].handle[1], INST[i.k].handle[0]) } : { t: 'imove', i, dx: p.x - i.x, dy: p.y - i.y };
      dirty(); return;
    }
  }
  if (t === 'geo') { geo.click(p, z); dirty(); return; }
  if (t === 'move') { drawing = { t: 'pan', sx: s.x, sy: s.y, vx: view().x, vy: view().y }; cv.style.cursor = 'grabbing'; return; }
  if (t === 'pen') {
    const sn = snapEdge(p, z), p0 = sn ? projEdge(sn, p) : p;
    const o = { id: uid(), type: 'stroke', pts: [p0.x, p0.y], color: S.pen.color, w: S.pen.w, hl: S.pen.hl };
    drawing = { t: 'draw', o, before: snap(), sn }; objs().push(o); dirty(); return;
  }
  if (t === 'eraser') { drawing = { t: 'erase', before: snap(), last: p, changed: false }; eraseAt(p); return; }
  if (t === 'shapes') {
    let kind = S.shape.kind, dash = S.shape.dash;
    if (kind === 'dotline') { kind = 'line'; dash = 'dotted'; } else if (kind === 'dotarrow') { kind = 'arrow'; dash = 'dotted'; }
    const o = { id: uid(), type: 'shape', kind, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: S.shape.color, w: S.shape.w, dash };
    drawing = { t: 'shape', o, before: snap() }; objs().push(o); dirty(); return;
  }
  if (t === 'text') {
    const th = [...objs()].reverse().find(o => o.type === 'text' && hit(o, p, 4 / z));
    th ? openEditor(th) : openEditor(null, p.x, p.y); e.preventDefault(); return;
  }
  // select tool
  const list = selObjs();
  if (list.length) {                          // handles of current selection
    for (const [name, hp] of selHandles(list)) { const sp = toS(hp[0], hp[1]); if (Math.abs(sp.x - s.x) <= 8 && Math.abs(sp.y - s.y) <= 8) { drawing = { t: 'resize', name, o: list[0], o0: structuredClone(list[0]), before: snap(), shift: e.shiftKey }; return; } }
  }
  if (list.length && !e.shiftKey) {            // drag inside the current selection moves it (never starts a new selection)
    const pad = 8 / z; let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    for (const o of list) { const g = gbox(o); x0 = Math.min(x0, g.x); y0 = Math.min(y0, g.y); x1 = Math.max(x1, g.x + g.w); y1 = Math.max(y1, g.y + g.h); }
    if (p.x >= x0 - pad && p.x <= x1 + pad && p.y >= y0 - pad && p.y <= y1 + pad) { drawing = { t: 'move', last: p, before: snap(), moved: false, id: list[0].id, dbl: e.detail === 2 }; return; }
  }
  const all = [...objs()].reverse(), top = all.find(o => geo.isPoint(o) && hit(o, p, 6 / z)) || all.find(o => hit(o, p, 6 / z));
  if (top) {
    if (e.shiftKey) { sel.has(top.id) ? sel.delete(top.id) : sel.add(top.id); }
    else if (!sel.has(top.id)) sel = new Set([top.id]);
    if (sel.has(top.id)) drawing = { t: 'move', last: p, before: snap(), moved: false, id: top.id, dbl: e.detail === 2 };
    syncUI(); dirty(); return;
  }
  if (!e.shiftKey) sel.clear();
  marquee = { mode: S.sel.mode, x1: p.x, y1: p.y, x2: p.x, y2: p.y, pts: [[p.x, p.y]], base: new Set(sel) }; drawing = { t: 'marquee' }; syncUI(); dirty();
});

cv.addEventListener('pointermove', e => {
  const s = pos(e); hover = s; if (tool === 'eraser' || (tool === 'tools' && geo.state.tool)) dirty();
  if (pts.has(e.pointerId)) pts.set(e.pointerId, s);
  if (pinch && pts.size >= 2) {
    const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, v = view();
    const nz = clamp(pinch.z * d / pinch.d, MIN_Z, MAX_Z), wx = (pinch.cx - pinch.v.x) / pinch.v.z, wy = (pinch.cy - pinch.v.y) / pinch.v.z;
    v.z = nz; v.x = cx - wx * nz; v.y = cy - wy * nz; syncZoom(); dirty(); return;
  }
  if (!drawing) return;
  const z = view().z, d = drawing;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; const list = evs.length ? evs : [e];
  if (d.t === 'pan') { const v = view(); v.x = d.vx + s.x - d.sx; v.y = d.vy + s.y - d.sy; dirty(); return; }
  if (d.t === 'draw') {
    for (const ev of list) {
      const q = toW(ev.clientX - cv.getBoundingClientRect().left, ev.clientY - cv.getBoundingClientRect().top), P = d.o.pts;
      if (d.sn) { const a = projEdge(d.sn, q); P[2] = a.x; P[3] = a.y; P.length = 4; }
      else { const lx = P[P.length - 2], ly = P[P.length - 1]; if (Math.hypot(q.x - lx, q.y - ly) * z > 1.2) P.push(q.x, q.y); }
    }
    dirty(); return;
  }
  const p = toW(s.x, s.y);
  if (d.t === 'erase') {
    const dist = Math.hypot(p.x - d.last.x, p.y - d.last.y), step = Math.max(1, S.eraser.size / 3 / z), n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) eraseAt({ x: d.last.x + (p.x - d.last.x) * i / n, y: d.last.y + (p.y - d.last.y) * i / n });
    d.last = p; return;
  }
  if (d.t === 'shape') {
    const o = d.o; let x = p.x, y = p.y;
    if (e.shiftKey || o.kind === 'square' || o.kind === 'circle') {
      if (OPEN.has(o.kind)) { if (e.shiftKey) { const a = Math.round(Math.atan2(y - o.y1, x - o.x1) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(x - o.x1, y - o.y1); x = o.x1 + Math.cos(a) * l; y = o.y1 + Math.sin(a) * l; } }
      else { const m = Math.max(Math.abs(x - o.x1), Math.abs(y - o.y1)); x = o.x1 + Math.sign(x - o.x1 || 1) * m; y = o.y1 + Math.sign(y - o.y1 || 1) * m; }
    }
    o.x2 = x; o.y2 = y; dirty(); return;
  }
  if (d.t === 'ctip') { d.i.r = clamp(Math.hypot(p.x - d.i.x, p.y - d.i.y), 20, CL * 2 - 30); d.i.a = Math.atan2(p.y - d.i.y, p.x - d.i.x); dirty(); return; }
  if (d.t === 'cdraw') {
    const i = d.i, g = compassGeom(i), th = Math.atan2(p.y - i.y, p.x - i.x); let dl = th - d.th;
    while (dl > Math.PI) dl -= 2 * Math.PI; while (dl < -Math.PI) dl += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dl) / .05)); for (let k = 1; k <= n; k++) { const a = d.th + dl * k / n; d.o.pts.push(i.x + g.r * Math.cos(a), i.y + g.r * Math.sin(a)); }
    d.th = th; i.a = th; dirty(); return;
  }
  if (d.t === 'imove') { d.i.x = p.x - d.dx; d.i.y = p.y - d.dy; dirty(); return; }
  if (d.t === 'irot') { d.i.a = Math.atan2(p.y - d.i.y, p.x - d.i.x) - d.off; if (e.shiftKey) d.i.a = Math.round(d.i.a / (Math.PI / 12)) * Math.PI / 12; dirty(); return; }
  if (d.t === 'move') {
    const dx = p.x - d.last.x, dy = p.y - d.last.y; if (!d.moved && Math.hypot(s.x - pts.get(e.pointerId).x, 0) >= 0) d.moved = true;
    geo.moveMany(selObjs(), dx, dy, moveObj, p); d.last = p; d.moved = true; dirty(); return;
  }
  if (d.t === 'marquee') { marqueeMove(p); return; }
  if (d.t === 'resize') resizeDrag(d, p, e.shiftKey);
});

function samples(o) {
  if (o.type === 'stroke') { const r = []; for (let i = 0; i < o.pts.length; i += 2) r.push([o.pts[i], o.pts[i + 1]]); return r; }
  const g = gbox(o), r = []; for (const fx of [0, .5, 1]) for (const fy of [0, .5, 1]) r.push([g.x + g.w * fx, g.y + g.h * fy]); return r;
}
/* Free-form: a pen stroke that crosses the loop is cut at the boundary; only the part inside is selected. */
function lassoSplit(poly) {
  if (poly.length < 3) return;
  const z = view().z, before = snap(), step = 3 / z, out = [], nsel = new Set(sel); let changed = false;
  for (const o of B().objs) {
    if (o.type !== 'stroke' || sel.has(o.id) || o.pts.length < 4) { out.push(o); continue; }
    const P = []; for (let i = 0; i < o.pts.length; i += 2) {
      const x = o.pts[i], y = o.pts[i + 1];
      if (i) { const px = P[P.length - 1][0], py = P[P.length - 1][1], n = Math.min(400, Math.floor(Math.hypot(x - px, y - py) / step)); for (let k = 1; k <= n; k++) P.push([px + (x - px) * k / (n + 1), py + (y - py) * k / (n + 1)]); }
      P.push([x, y]);
    }
    const ins = P.map(q => inPoly({ x: q[0], y: q[1] }, poly));
    if (!ins.some(Boolean) || ins.every(Boolean)) { out.push(o); continue; }
    changed = true; let run = [P[0]], cin = ins[0];
    const flush = () => { if (!run.length) return; if (run.length < 2) run.push(run[0]); const n = { ...structuredClone(o), id: uid(), pts: run.flat() }; out.push(n); if (cin) nsel.add(n.id); };
    for (let i = 1; i < P.length; i++) { if (ins[i] !== cin) { run.push(P[i]); flush(); run = [P[i]]; cin = ins[i]; } else run.push(P[i]); }
    flush();
  }
  if (changed) { B().objs = out; sel = nsel; pushUndo(before); }
}
function marqueeMove(p) {
  const m = marquee, z = view().z; m.x2 = p.x; m.y2 = p.y; m.pts.push([p.x, p.y]);
  const skip = o => o.type === 'geo' && o.hidden && !geo.state.ghost;
  if (m.mode === 'touch') { for (const o of objs()) if (!skip(o) && hit(o, p, 6 / z)) sel.add(o.id); dirty(); return; }
  sel = new Set(m.base);
  const bx = { x: Math.min(m.x1, p.x), y: Math.min(m.y1, p.y), w: Math.abs(p.x - m.x1), h: Math.abs(p.y - m.y1) };
  const cx = (m.x1 + p.x) / 2, cy = (m.y1 + p.y) / 2, rx = bx.w / 2 || 1e-6, ry = bx.h / 2 || 1e-6;
  for (const o of objs()) {
    if (skip(o)) continue; let ok = false;
    if (m.mode === 'rect') { const g = gbox(o); ok = g.x <= bx.x + bx.w && g.x + g.w >= bx.x && g.y <= bx.y + bx.h && g.y + g.h >= bx.y; }
    else if (m.mode === 'ellipse') ok = samples(o).some(q => ((q[0] - cx) / rx) ** 2 + ((q[1] - cy) / ry) ** 2 <= 1);
    else ok = m.pts.length > 2 && samples(o).every(q => inPoly({ x: q[0], y: q[1] }, m.pts));   // strictly inside the loop
    if (ok) sel.add(o.id);
  }
  dirty();
}
function resizeDrag(d, p, shift) {
  const o = d.o, o0 = d.o0;
  if (d.name === 'p1' || d.name === 'p2') {
    let x = p.x, y = p.y; const ox = d.name === 'p1' ? o0.x2 : o0.x1, oy = d.name === 'p1' ? o0.y2 : o0.y1;
    if (shift) { const a = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(x - ox, y - oy); x = ox + Math.cos(a) * l; y = oy + Math.sin(a) * l; }
    if (d.name === 'p1') { o.x1 = x; o.y1 = y; } else { o.x2 = x; o.y2 = y; }
    dirty(); return;
  }
  const b = gbox(o0), n = d.name, min = 6 / view().z;
  let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
  if (n.includes('w')) x1 = Math.min(p.x, x2 - min); if (n.includes('e')) x2 = Math.max(p.x, x1 + min);
  if (n.includes('n')) y1 = Math.min(p.y, y2 - min); if (n.includes('s')) y2 = Math.max(p.y, y1 + min);
  let w = x2 - x1, hh = y2 - y1;
  const sq = o.type === 'shape' && (o.kind === 'square' || o.kind === 'circle'), keep = shift || sq || o.type === 'image' || o.type === 'text';
  if (keep && b.w && b.h && n.length === 2) {
    const k = Math.max(w / b.w, hh / b.h); w = b.w * k; hh = b.h * k;
    if (n.includes('w')) x1 = x2 - w; else x2 = x1 + w; if (n.includes('n')) y1 = y2 - hh; else y2 = y1 + hh;
  } else if (sq || o.type === 'text' || (o.type === 'image' && b.w && b.h)) {
    if (n === 'e' || n === 'w') { const k = w / b.w; hh = b.h * k; y2 = y1 + hh; } else { const k = hh / b.h; w = b.w * k; x2 = x1 + w; }
  }
  fitObj(o0, o, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }); dirty();
}

function cancelDrag() {
  if (drawing && (drawing.t === 'draw' || drawing.t === 'cdraw' || drawing.t === 'shape')) B().objs = B().objs.filter(o => o !== drawing.o);
  if (drawing && drawing.before && ['move', 'resize', 'erase'].includes(drawing.t)) restoreQuiet(drawing.before);
  drawing = null; marquee = null; dirty();
}
function restoreQuiet(s) { const b = B(); b.objs = s.objs; b.bg = s.bg; }

function endPointer(e) {
  pts.delete(e.pointerId);
  if (pinch) { if (pts.size < 2) { pinch = null; save(); } return; }
  const d = drawing; if (!d) return; drawing = null; updateCursor();
  const s = pos(e);
  if (d.t === 'pan') { save(); }
  else if (d.t === 'draw' || d.t === 'cdraw') { pushUndo(d.before); }
  else if (d.t === 'shape') {
    const o = d.o, g = shapeBox(o), min = 3 / view().z;
    if (g.w < min && g.h < min) { B().objs = B().objs.filter(q => q !== o); }
    else { pushUndo(d.before); setTool('select'); sel = new Set([o.id]); syncUI(); }
  }
  else if (d.t === 'erase') { if (d.changed) pushUndo(d.before); }
  else if (d.t === 'move') {
    if (d.moved && d.before && JSON.stringify(d.before.objs) !== JSON.stringify(B().objs.map(o => o))) pushUndo(d.before);
    else if (!d.moved && d.dbl) { const o = objs().find(q => q.id === d.id); if (o?.type === 'text') openEditor(o); }
    syncUI();
  }
  else if (d.t === 'resize') { pushUndo(d.before); }
  else if (d.t === 'marquee') { if (marquee && marquee.mode === 'lasso') lassoSplit(marquee.pts); marquee = null; syncUI(); }
  else if (d.t === 'imove' || d.t === 'irot' || d.t === 'ctip') save();
  void s; dirty();
}
cv.addEventListener('pointerup', endPointer); cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { hover = null; if (tool === 'eraser' || (tool === 'tools' && geo.state.tool)) dirty(); });
cv.addEventListener('dblclick', e => {
  if (tool === 'tools' && geo.state.tool) { geo.dblclick(); dirty(); return; }
  if (tool !== 'select' && tool !== 'tools') return; const s = pos(e), p = toW(s.x, s.y);
  const t = [...objs()].reverse().find(o => o.type === 'text' && hit(o, p, 4 / view().z)); if (t) openEditor(t);
});
cv.addEventListener('contextmenu', e => e.preventDefault());

/* Wheel: scroll pans, Ctrl/pinch zooms */
cv.addEventListener('wheel', e => {
  e.preventDefault(); const s = pos(e), v = view();
  if (e.ctrlKey || e.metaKey) zoomAt(v.z * Math.exp(-e.deltaY * (e.deltaMode ? .05 : .01)), s.x, s.y);
  else if (e.shiftKey && !e.deltaX) { v.x -= e.deltaY; dirty(); } else { v.x -= e.deltaX; v.y -= e.deltaY; dirty(); }
  if (editing) positionEditor(); save();
}, { passive: false });

/* ───────── Eraser ───────── */
function eraseAt(p) {
  const z = view().z, r = S.eraser.size / 2 / z, b = B(); let changed = false, out = []; const dead = new Set();
  for (const o of b.objs) {
    if (o.type === 'stroke') {
      const g = gbox(o), pad = r + o.w * (o.hl ? 1.5 : .5);
      if (p.x < g.x - pad || p.x > g.x + g.w + pad || p.y < g.y - pad || p.y > g.y + g.h + pad) { out.push(o); continue; }
      const parts = eraseStroke(o, p, r); if (parts === null) out.push(o); else { changed = true; out.push(...parts); }
    } else if (o.type === 'geo') { if (hit(o, p, r)) { dead.add(o.id); changed = true; } else out.push(o); }
    else if (hit(o, p, r)) { changed = true; sel.delete(o.id); } else out.push(o);
  }
  if (dead.size) { const all = geo.withDependents(dead); out = out.filter(o => !all.has(o.id)); }
  if (changed) { b.objs = out; if (drawing) drawing.changed = true; syncUI(); dirty(); }
}
function eraseStroke(o, p, r) {
  const P = o.pts, reach = r + o.w * (o.hl ? 1.5 : .5); let touched = false;
  if (P.length === 2) return Math.hypot(P[0] - p.x, P[1] - p.y) <= reach ? [] : null;
  for (let i = 0; i < P.length - 2; i += 2) if (segDist(p.x, p.y, P[i], P[i + 1], P[i + 2], P[i + 3]) <= reach) { touched = true; break; }
  if (!touched) return null;
  const D = [[P[0], P[1]]], step = Math.max(.5, r / 3);
  for (let i = 0; i < P.length - 2; i += 2) {
    const ax = P[i], ay = P[i + 1], bx = P[i + 2], by = P[i + 3], n = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let k = 1; k <= n; k++) D.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  const res = []; let curr = [];
  const flush = () => { if (curr.length) { const f = curr.flat(); res.push({ ...o, id: uid(), pts: f.length === 2 ? f : f }); curr = []; } };
  for (const q of D) { if (Math.hypot(q[0] - p.x, q[1] - p.y) <= r) flush(); else curr.push(q); }
  flush();
  return res.filter(s => s.pts.length >= 2);
}

/* ───────── Selection bar, clipboard, delete ───────── */
const selbar = $('#selbar');
function placeSelBar() {
  const list = selObjs();
  if (!list.length || !selectLike() || (drawing && drawing.t !== 'marquee') || editing) { selbar.hidden = true; return; }
  const ub = unionBox(list), a = toS(ub.x, ub.y), b = toS(ub.x + ub.w, ub.y + ub.h); selbar.hidden = false;
  const w = selbar.offsetWidth, hh = selbar.offsetHeight;
  selbar.style.left = clamp((a.x + b.x) / 2 - w / 2, 4, W - w - 4) + 'px';
  selbar.style.top = clamp(a.y - hh - 14, 4, H - hh - 4) + 'px';
  const f = list.find(o => o.type !== 'image'); $('#selColor').style.display = f ? '' : 'none';
  if (f) $('#selColor span').style.background = f.color || '#0b3d91';
}
$('#selColor').addEventListener('click', e => {
  const btn = e.currentTarget, f = selObjs().find(o => o.type !== 'image'); if (!f) return;
  if (cpS && cpS.anchor === btn) closePicker(); else openPicker(btn, f.color || '#0b3d91', c => recolor(c));
});
let recolorBefore = null;
function recolor(c) {
  if (!recolorBefore) recolorBefore = snap();
  selObjs().forEach(o => { if (o.type !== 'image') o.color = c; });
  dirty(); clearTimeout(recolor.t); recolor.t = setTimeout(() => { pushUndo(recolorBefore); recolorBefore = null; }, 500);
}
$('#selDel').addEventListener('click', delSel); $('#selDup').addEventListener('click', dupSel);
function delSel() { if (!sel.size) return; action(() => { const ids = geo.withDependents([...sel]); B().objs = objs().filter(o => !ids.has(o.id)); sel.clear(); }); syncUI(); }
function copySel() { clip = structuredClone(selObjs().filter(o => o.type !== 'geo')); }
function pasteClip(off = 24) {
  if (!clip.length) return; const c = structuredClone(clip).map(o => { o.id = uid(); moveObj(o, off, off); return o; });
  action(() => objs().push(...c)); clip = structuredClone(c); setTool('select'); sel = new Set(c.map(o => o.id)); syncUI();
}
function dupSel() { if (sel.size) { copySel(); pasteClip(); } }

/* ───────── Zoom ───────── */
const zr = $('#zoomRange');
const z2p = z => z <= 1 ? (z - MIN_Z) / (1 - MIN_Z) * .38 : .38 + (z - 1) / (MAX_Z - 1) * .62;
const p2z = p => p <= .38 ? MIN_Z + (p / .38) * (1 - MIN_Z) : 1 + (p - .38) / .62 * (MAX_Z - 1);
function zoomAt(nz, sx, sy) {
  const v = view(); nz = clamp(nz, MIN_Z, MAX_Z); const wx = (sx - v.x) / v.z, wy = (sy - v.y) / v.z;
  v.z = nz; v.x = sx - wx * nz; v.y = sy - wy * nz; syncZoom(); dirty();
}
function syncZoom() { const p = z2p(view().z); zr.value = Math.round(p * 1000); zr.style.setProperty('--p', p * 100 + '%'); $('#zoomPct').textContent = Math.round(view().z * 100) + '%'; toast(Math.round(view().z * 100) + '%'); }
zr.addEventListener('input', () => zoomAt(p2z(zr.value / 1000), W / 2, H / 2));
$('#zoomPct').addEventListener('click', () => zoomAt(1, W / 2, H / 2));
$('#zoomInBtn').addEventListener('click', () => zoomAt(view().z * 1.25, W / 2, H / 2));
$('#zoomOutBtn').addEventListener('click', () => zoomAt(view().z / 1.25, W / 2, H / 2));
let toastT; function toast(msg, ms = 900) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }

/* ───────── Boards ───────── */
const pageNum = $('#pageNum');
function goBoard(i) {
  geo.cancel(); i = clamp(i, 0, boards.length - 1); closeEditor(true); cancelDrag(); cur = i; sel.clear(); pageSync(); syncZoom(); toast('Board ' + (i + 1) + ' of ' + boards.length); syncUI(); dirty(); save();
}
function pageSync() { $('#delBtn').disabled = boards.length < 2; pageNum.value = cur + 1; $('#pageOf').textContent = 'of ' + boards.length; $('#prevBtn').disabled = cur === 0; $('#nextBtn').disabled = cur === boards.length - 1; if (popFor === 'backdrop' || popFor === 'tools') renderPop(); }
$('#prevBtn').addEventListener('click', () => goBoard(cur - 1));
$('#nextBtn').addEventListener('click', () => goBoard(cur + 1));
$('#delBtn').addEventListener('click', () => { if (boards.length < 2) return; modal('Delete board ' + (cur + 1) + ' of ' + boards.length + '? This cannot be undone.', [['Cancel'], ['Delete board', () => { boards.splice(cur, 1); goBoard(Math.min(cur, boards.length - 1)); }, true]]); });
$('#addBtn').addEventListener('click', () => { boards.splice(cur + 1, 0, newBoard()); goBoard(cur + 1); });
pageNum.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const n = parseInt(pageNum.value, 10); goBoard(isNaN(n) ? cur : n - 1); pageNum.blur(); } if (e.key === 'Escape') { pageSync(); pageNum.blur(); } });
pageNum.addEventListener('blur', () => { const n = parseInt(pageNum.value, 10); if (!isNaN(n) && n - 1 !== cur) goBoard(n - 1); else pageSync(); });
pageNum.addEventListener('focus', () => pageNum.select());
$('#undoBtn').addEventListener('click', undo); $('#redoBtn').addEventListener('click', redo);
function syncUI() { $('#undoBtn').disabled = !B().undo.length; $('#redoBtn').disabled = !B().redo.length; }

/* ───────── Modal / clear ───────── */
function modal(msg, buttons) {
  $('#modalMsg').textContent = msg; const row = $('#modalBtns'); row.replaceChildren();
  buttons.forEach(([label, fn, primary]) => row.append(h('button', { class: primary ? 'primary' : '', on: { click: () => { $('#modal').hidden = true; fn && fn(); } } }, [label])));
  $('#modal').hidden = false; row.lastChild.focus();
}
function askClear() {
  const btns = [['Cancel'], ];
  if (boards.length > 1) btns.push(['Delete board', () => { boards.splice(cur, 1); goBoard(Math.min(cur, boards.length - 1)); }]);
  btns.push(['Clear board', () => { action(() => { B().objs = []; sel.clear(); }); }, true]);
  modal('Clear everything on this board?', btns);
}
let onModalCancel = null;
const closeModal = () => { $('#modal').hidden = true; if (onModalCancel) { const f = onModalCancel; onModalCancel = null; f(); } };
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closeModal(); });
function askNumber(spec, cb) {
  $('#modalMsg').textContent = spec.msg; const row = $('#modalBtns'); row.replaceChildren();
  const inp = h('input', { type: 'number', value: spec.def, step: spec.int ? 1 : 'any', class: 'num' });
  const ok = () => { let v = parseFloat(inp.value); if (isNaN(v)) return; if (spec.int) v = Math.round(v); if (spec.min != null && v < spec.min) v = spec.min; onModalCancel = null; $('#modal').hidden = true; cb(v); };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') ok(); if (e.key === 'Escape') closeModal(); });
  row.append(inp, h('button', { on: { click: closeModal } }, ['Cancel']), h('button', { class: 'primary', on: { click: ok } }, ['OK']));
  onModalCancel = () => cb(null); $('#modal').hidden = false; inp.focus(); inp.select();
}
function geoChanged() {
  const hint = $('#hint'), on = tool === 'tools' && geo.state.tool; hint.hidden = !on; if (on) hint.textContent = geo.hintText();
  updateCursor(); dirty();
}

/* ───────── Sidebar ───────── */
const sidebar = $('#sidebar'), scrim = $('#scrim');
function toggleSidebar(open) { open = open ?? !sidebar.classList.contains('open'); sidebar.classList.toggle('open', open); scrim.hidden = !open; }
$('#sidebarBtn').addEventListener('click', () => toggleSidebar()); scrim.addEventListener('click', () => toggleSidebar(false));
sidebar.querySelector('.disabled').addEventListener('click', e => { e.preventDefault(); toast('Graph calculator is coming soon', 1600); });
$('#exportPng').addEventListener('click', () => { exportPng(); toggleSidebar(false); });
$('#saveJson').addEventListener('click', () => { download(new Blob([JSON.stringify(serialize())], { type: 'application/json' }), 'board.json'); toggleSidebar(false); });
$('#openJson').addEventListener('click', () => $('#fileJson').click());
$('#fileJson').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { load(JSON.parse(t)); toggleSidebar(false); toast('Board file opened'); } catch (er) { toast('Not a valid board file', 1800); } }); e.target.value = ''; });
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
function exportPng() {
  const b = B(), box = unionBox(b.objs) || { x: 0, y: 0, w: W, h: H }, pad = 40, k = 2;
  const c = document.createElement('canvas'); c.width = (box.w + pad * 2) * k; c.height = (box.h + pad * 2) * k; const x = c.getContext('2d');
  const v = { x: -box.x + pad, y: -box.y + pad, z: 1 };
  x.setTransform(k, 0, 0, k, 0, 0); drawBackdrop(x, v, box.w + pad * 2, box.h + pad * 2, b.bg);
  x.setTransform(k, 0, 0, k, v.x * k, v.y * k); b.objs.forEach(o => drawObj(x, o, 1));
  c.toBlob(bl => download(bl, 'whiteboard.png'));
}

/* ───────── Persistence ───────── */
function serialize() {
  const used = new Set(); boards.forEach(b => { b.objs.forEach(o => o.img && used.add(o.img)); if (b.bg.img) used.add(b.bg.img); });
  const im = {}; used.forEach(id => { if (imgs.get(id)) im[id] = imgs.get(id).src; });
  return { v: 1, cur, imgs: im, boards: boards.map(b => ({ id: b.id, objs: b.objs, bg: b.bg, view: b.view })) };
}
function load(d) {
  imgs.clear(); for (const [id, src] of Object.entries(d.imgs || {})) { const el = new Image(); el.onload = dirty; el.src = src; imgs.set(id, { src, el }); }
  boards = d.boards.map(b => ({ ...newBoard(), ...b, undo: [], redo: [], inst: [] })); if (!boards.length) boards = [newBoard()];
  boards.forEach(b => b.objs.forEach(o => { if (o.type === 'text') measure(o); }));
  cur = clamp(d.cur || 0, 0, boards.length - 1); sel.clear(); pageSync(); syncZoom(); syncUI(); dirty();
}
let saveT, warned = false;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem('rmcanvas.wb.v1', JSON.stringify(serialize())); } catch (e) { if (!warned) { warned = true; toast('Could not autosave (browser storage is full)', 2500); } } }, 500);
}

/* ───────── Keyboard ───────── */
window.addEventListener('keydown', e => {
  if (/input|textarea|select/i.test(e.target.tagName) && e.target.type !== 'range') return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (!$('#modal').hidden) { if (k === 'escape') $('#modal').hidden = true; return; }
  if (k === ' ' && !spaceDown) { spaceDown = true; cv.style.cursor = 'grab'; e.preventDefault(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a') { e.preventDefault(); setTool('select'); sel = new Set(objs().map(o => o.id)); dirty(); return; }
  if (mod && k === 'c') { copySel(); return; } if (mod && k === 'x') { copySel(); delSel(); return; }
  if (mod && k === 'd') { e.preventDefault(); dupSel(); return; }
  if (mod) return;
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); delSel(); return; }
  if (k === 'escape') { sel.clear(); geo.cancel(); closePop(); toggleSidebar(false); dirty(); return; }
  if (k === 'enter' && tool === 'tools' && geo.state.tool) { geo.finish(); return; }
  if (k.startsWith('arrow') && sel.size) {
    e.preventDefault(); const st = e.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -st : k === 'arrowright' ? st : 0, dy = k === 'arrowup' ? -st : k === 'arrowdown' ? st : 0;
    action(() => geo.moveMany(selObjs(), dx, dy, moveObj)); return;
  }
  const map = { v: 'select', h: 'move', p: 'pen', e: 'eraser', s: 'shapes', t: 'text' };
  if (map[k]) { closePop(); setTool(map[k]); }
});
window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; updateCursor(); } });

/* ───────── Init ───────── */
(function init() {
  try { const d = JSON.parse(localStorage.getItem('rmcanvas.wb.v1')); if (d && d.boards) load(d); } catch (e) { }
  resize(); pageSync(); syncUI(); syncZoom(); $('#toast').hidden = true; updateCursor();
  if (document.fonts) document.fonts.ready.then(() => { boards.forEach(b => b.objs.forEach(o => o.type === 'text' && measure(o))); dirty(); });
  // test hook
  window.__wb = { geo, get boards() { return boards; }, get tool() { return tool; }, get sel() { return sel; }, S };
})();
})();

