/* =========================================================
   geometry.js — GeoGebra / Desmos style construction tools

   Every tool lists the clicks it needs ("steps") and a "build" function
   that turns those clicks into drawable objects.

   Step kinds:
     pt     a point (click empty space, or click an existing point)
     at     just a position on the board (no point is created)
     line   a line, segment, ray or vector      circ   a circle, arc or sector
     poly   a polygon                           vec    a vector (arrow)
     dot    an existing point
     obj    any object        objnd  any object except a point
     area   a polygon, circle or sector         anyh   any object, including hidden ones

   Built objects are plain data, so they are saved to / loaded from JSON.
   A build function may also return an "operation" such as { __op: 'delete' }
   which the whiteboard carries out (delete, hide, label, style, zoom, image).

   NOTE: constructions are static (like drawing on paper): if you move a point
   afterwards, lines built from it do not follow. They can all be moved freely
   with the Select tool.
   ========================================================= */
(function () {
  'use strict';

  const NAVY = '#000455';
  const PX_PER_CM = 96 / 2.54;          // 1 cm on screen at 96 dpi
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  /* ---------- tiny vector helpers ---------- */
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const len = a => Math.hypot(a.x, a.y);
  const unit = a => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const P = p => ({ x: p.x, y: p.y });
  const angOf = (c, p) => Math.atan2(p.y - c.y, p.x - c.x);
  const polar = (c, r, a) => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  const wrap = a => { a %= TAU; return a < 0 ? a + TAU : a; };            // angle into [0, 2π)

  /* ---------- object factories ---------- */
  const mk = (type, props) => Object.assign({ type, color: NAVY, size: 2 }, props);
  const seg = (a, b, ext = 'none', extra) => mk('seg', Object.assign({ a: P(a), b: P(b), ext }, extra));   // ext: none | ray | line
  const dotObj = (p, label) => mk('dot', { x: p.x, y: p.y, size: 5, label });
  const label = (p, text, fs = 15) => mk('label', { x: p.x, y: p.y, text, fs });
  const curve = (paths, closed) => mk('curve', { paths, closed: !!closed });

  /* ---------- object classes ---------- */
  const isCirc = o => o.type === 'circle' || o.type === 'arc' || o.type === 'sector';
  /* does the arc/sector object cover this angle? (a0→a1, anticlockwise on screen if ccw) */
  function inArc(o, ang) {
    if (o.type === 'circle') return true;
    return o.ccw ? wrap(o.a0 - ang) <= wrap(o.a0 - o.a1) + 1e-9 : wrap(ang - o.a0) <= wrap(o.a1 - o.a0) + 1e-9;
  }
  /* list of [a, b] segments that approximate a poly-like object */
  function segsOf(o) {
    const out = [];
    const chain = (pts, closed) => {
      for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i + 1]]);
      if (closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]]);
    };
    if (o.type === 'poly') chain(o.pts, true);
    else if (o.type === 'curve') o.paths.forEach(p => chain(p, o.closed));
    else if (o.type === 'stroke') chain(o.pts, false);
    return out;
  }

  /* ---------- distances & nearest points ---------- */
  function distSeg(p, a, b) {
    const d = sub(b, a), dd = dot(d, d) || 1;
    const t = Math.min(1, Math.max(0, dot(sub(p, a), d) / dd));
    return len(sub(p, add(a, mul(d, t))));
  }
  /* distance from point p to a seg/ray/line object */
  function distToLine(p, l) {
    const d = sub(l.b, l.a), dd = dot(d, d) || 1;
    let t = dot(sub(p, l.a), d) / dd;
    if (l.ext === 'none') t = Math.min(1, Math.max(0, t));
    else if (l.ext === 'ray') t = Math.max(0, t);
    return len(sub(p, add(l.a, mul(d, t))));
  }
  function distToObj(p, o) {
    switch (o.type) {
      case 'dot': return Math.hypot(p.x - o.x, p.y - o.y);
      case 'seg': return distToLine(p, o);
      case 'circle': return Math.abs(Math.hypot(p.x - o.cx, p.y - o.cy) - o.r);
      case 'arc': case 'sector': {
        const c = { x: o.cx, y: o.cy }, ang = angOf(c, p);
        let d;
        if (inArc(o, ang)) d = Math.abs(len(sub(p, c)) - o.r);
        else d = Math.min(len(sub(p, polar(c, o.r, o.a0))), len(sub(p, polar(c, o.r, o.a1))));
        if (o.type === 'sector') d = Math.min(d, distSeg(p, c, polar(c, o.r, o.a0)), distSeg(p, c, polar(c, o.r, o.a1)));
        return d;
      }
      case 'poly': case 'curve': case 'stroke': {
        let d = Infinity;
        for (const [a, b] of segsOf(o)) d = Math.min(d, distSeg(p, a, b));
        if (o.type === 'stroke' && o.pts.length === 1) d = len(sub(p, o.pts[0]));
        return d;
      }
    }
    return Infinity;
  }
  /* nearest point that lies ON the object (used by "Point on Object") */
  function nearestOn(p, o) {
    switch (o.type) {
      case 'dot': return { x: o.x, y: o.y };
      case 'seg': {
        const d = sub(o.b, o.a), dd = dot(d, d) || 1;
        let t = dot(sub(p, o.a), d) / dd;
        if (o.ext === 'none') t = Math.min(1, Math.max(0, t)); else if (o.ext === 'ray') t = Math.max(0, t);
        return add(o.a, mul(d, t));
      }
      case 'circle': case 'arc': case 'sector': {
        const c = { x: o.cx, y: o.cy }, ang = angOf(c, p);
        if (inArc(o, ang)) return polar(c, o.r, ang);
        const e0 = polar(c, o.r, o.a0), e1 = polar(c, o.r, o.a1);
        return len(sub(p, e0)) < len(sub(p, e1)) ? e0 : e1;
      }
      default: {
        let best = null, bd = Infinity;
        for (const [a, b] of segsOf(o)) {
          const d = sub(b, a), dd = dot(d, d) || 1;
          const t = Math.min(1, Math.max(0, dot(sub(p, a), d) / dd));
          const q = add(a, mul(d, t)), dist = len(sub(p, q));
          if (dist < bd) { bd = dist; best = q; }
        }
        return best || P(p);
      }
    }
  }

  /* ---------- intersections ---------- */
  function lineLine(l1, l2) {
    const d1 = sub(l1.b, l1.a), d2 = sub(l2.b, l2.a);
    const den = cross(d1, d2);
    if (Math.abs(den) < 1e-9) return [];
    const ac = sub(l2.a, l1.a);
    const t = cross(ac, d2) / den, u = cross(ac, d1) / den;
    const ok = (v, ext) => ext === 'line' || (ext === 'ray' ? v >= -1e-9 : v >= -1e-9 && v <= 1 + 1e-9);
    return ok(t, l1.ext) && ok(u, l2.ext) ? [add(l1.a, mul(d1, t))] : [];
  }
  function lineCircle(l, c) {
    const d = sub(l.b, l.a), f = { x: l.a.x - c.cx, y: l.a.y - c.cy };
    const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - c.r * c.r;
    const disc = B * B - 4 * A * C;
    if (A < 1e-12 || disc < 0) return [];
    const ts = disc < 1e-9 ? [-B / (2 * A)] : [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)];
    const out = [];
    for (const t of ts) {
      if (l.ext === 'none' && (t < -1e-9 || t > 1 + 1e-9)) continue;
      if (l.ext === 'ray' && t < -1e-9) continue;
      const q = add(l.a, mul(d, t));
      if (c.obj && !inArc(c.obj, angOf({ x: c.cx, y: c.cy }, q))) continue;
      out.push(q);
    }
    return out;
  }
  function circleCircle(c1, c2) {
    const dx = c2.cx - c1.cx, dy = c2.cy - c1.cy, d = Math.hypot(dx, dy);
    if (d < 1e-9 || d > c1.r + c2.r || d < Math.abs(c1.r - c2.r)) return [];
    const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d), hh = Math.sqrt(Math.max(c1.r * c1.r - a * a, 0));
    const mx = c1.cx + (a * dx) / d, my = c1.cy + (a * dy) / d;
    const pts = [{ x: mx + (hh * dy) / d, y: my - (hh * dx) / d }];
    if (hh > 1e-6) pts.push({ x: mx - (hh * dy) / d, y: my + (hh * dx) / d });
    return pts.filter(q => (!c1.obj || inArc(c1.obj, angOf({ x: c1.cx, y: c1.cy }, q))) && (!c2.obj || inArc(c2.obj, angOf({ x: c2.cx, y: c2.cy }, q))));
  }
  function prim(o) {
    if (o.type === 'seg') return { k: 'L', a: o.a, b: o.b, ext: o.ext };
    if (isCirc(o)) return { k: 'C', cx: o.cx, cy: o.cy, r: o.r, obj: o.type === 'circle' ? null : o };
    const s = segsOf(o);
    return s.length ? { k: 'S', segs: s } : null;
  }
  function interPrims(p, q) {
    if (p.k === 'S' || q.k === 'S') {
      if (p.k !== 'S') [p, q] = [q, p];
      const out = [];
      for (const [a, b] of p.segs) {
        const sp = { k: 'L', a, b, ext: 'none' };
        if (q.k === 'S') for (const [c, d] of q.segs) out.push(...interPrims(sp, { k: 'L', a: c, b: d, ext: 'none' }));
        else out.push(...interPrims(sp, q));
      }
      return out;
    }
    if (p.k === 'L' && q.k === 'L') return lineLine(p, q);
    if (p.k === 'L') return lineCircle(p, q);
    if (q.k === 'L') return lineCircle(q, p);
    return circleCircle(p, q);
  }
  function intersectObjs(o1, o2) {
    const p = prim(o1), q = prim(o2);
    if (!p || !q) return [];
    const pts = interPrims(p, q), out = [];
    for (const t of pts) if (!out.some(u => Math.hypot(u.x - t.x, u.y - t.y) < 0.5)) out.push(t);
    return out.slice(0, 12);
  }

  /* ---------- misc constructions ---------- */
  function reflectPoint(p, l) {                       // mirror p across the infinite line through l.a, l.b
    const d = sub(l.b, l.a), t = dot(sub(p, l.a), d) / (dot(d, d) || 1);
    return sub(mul(add(l.a, mul(d, t)), 2), p);
  }
  function circumcircle(a, b, c) {                    // circle through three points (null if collinear)
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    return { x, y, r: Math.hypot(a.x - x, a.y - y) };
  }
  /* circular arc from a, through b, to c */
  function arcThrough(a, b, c) {
    const k = circumcircle(a, b, c);
    if (!k) return null;
    const aa = angOf(k, a), ab = angOf(k, b), ac = angOf(k, c);
    const forward = wrap(ab - aa) < wrap(ac - aa);        // b reached before c when angle increases?
    return { cx: k.x, cy: k.y, r: k.r, a0: aa, a1: ac, ccw: !forward };
  }
  const polyArea = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + (p.x * q.y - q.x * p.y); }, 0)) / 2;

  /* apply a point-mapping f to any supported object; returns a new object (or null) */
  function mapObj(o, f, opt = {}) {
    const n = JSON.parse(JSON.stringify(o));
    delete n.hidden;
    const m = p => { const q = f(p); return { x: q.x, y: q.y }; };
    switch (o.type) {
      case 'dot': { const q = f(o); n.x = q.x; n.y = q.y; if (n.label) n.label += '′'; break; }
      case 'seg': n.a = m(o.a); n.b = m(o.b); break;
      case 'poly': case 'stroke': n.pts = o.pts.map(m); break;
      case 'curve': n.paths = o.paths.map(pp => pp.map(m)); break;
      case 'circle': { const c = f({ x: o.cx, y: o.cy }), e = f({ x: o.cx + o.r, y: o.cy }); n.cx = c.x; n.cy = c.y; n.r = Math.hypot(e.x - c.x, e.y - c.y); break; }
      case 'arc': case 'sector': {
        const c0 = { x: o.cx, y: o.cy }, c = f(c0);
        const p0 = f(polar(c0, o.r, o.a0)), p1 = f(polar(c0, o.r, o.a1));
        n.cx = c.x; n.cy = c.y; n.r = Math.hypot(p0.x - c.x, p0.y - c.y);
        n.a0 = angOf(c, p0); n.a1 = angOf(c, p1); n.ccw = opt.flip ? !o.ccw : o.ccw;
        break;
      }
      case 'label': case 'text': case 'image': { const q = f(o); n.x = q.x; n.y = q.y; break; }
      default: return null;
    }
    return n;
  }
  const mapAll = (o, f, opt) => { const n = mapObj(o, f, opt); return n ? [n] : []; };

  /* ---------- hit testing ---------- */
  const KINDS = {
    line: o => o.type === 'seg',
    circ: isCirc,
    obj: () => true,
    objnd: o => o.type !== 'dot',
    poly: o => o.type === 'poly',
    area: o => o.type === 'poly' || o.type === 'circle' || o.type === 'sector',
    vec: o => o.type === 'seg' && !!o.arrow,
    dot: o => o.type === 'dot',
    anyh: () => true
  };
  /* finds the object under world point w (within radius r). bboxOf is used for text, images and shapes. */
  function hit(objects, w, r, kind, bboxOf, includeHidden) {
    const pred = KINDS[kind] || KINDS.obj;
    let best = null, bd = r;
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (o.erase || (o.hidden && !includeHidden) || !pred(o)) continue;
      let d = distToObj(w, o);
      if (d === Infinity && bboxOf) {
        const b = bboxOf(o);
        d = (w.x >= b.x0 && w.x <= b.x1 && w.y >= b.y0 && w.y <= b.y1) ? r * 0.9 : Infinity;
      }
      if (o.type === 'dot') d -= 3;                     // points win ties
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /* ---------- conic helpers (drawn as sampled curves) ---------- */
  function ellipseCurve(f1, f2, p) {
    const a = (len(sub(p, f1)) + len(sub(p, f2))) / 2, c = len(sub(f2, f1)) / 2;
    if (a <= c + 1e-6) return null;
    const b = Math.sqrt(a * a - c * c), m = mid(f1, f2), u = unit(sub(f2, f1)), v = { x: -u.y, y: u.x };
    const pts = [];
    for (let i = 0; i < 240; i++) { const t = (i / 240) * TAU; pts.push(add(m, add(mul(u, a * Math.cos(t)), mul(v, b * Math.sin(t))))); }
    return curve([pts], true);
  }
  function hyperbolaCurve(f1, f2, p) {
    const a = Math.abs(len(sub(p, f1)) - len(sub(p, f2))) / 2, c = len(sub(f2, f1)) / 2;
    if (a < 1e-3 || a >= c - 1e-6) return null;
    const b = Math.sqrt(c * c - a * a), m = mid(f1, f2), u = unit(sub(f2, f1)), v = { x: -u.y, y: u.x };
    const T = Math.min(8, Math.acosh(Math.max(1.0001, 1800 / a)));
    const right = [], left = [];
    for (let i = 0; i <= 200; i++) {
      const t = -T + (2 * T * i) / 200, ch = Math.cosh(t), sh = Math.sinh(t);
      right.push(add(m, add(mul(u, a * ch), mul(v, b * sh))));
      left.push(add(m, add(mul(u, -a * ch), mul(v, b * sh))));
    }
    return curve([right, left], false);
  }
  function parabolaCurve(f, l) {
    const d = sub(l.b, l.a), t = dot(sub(f, l.a), d) / (dot(d, d) || 1);
    const foot = add(l.a, mul(d, t)), dv = sub(f, foot), h = len(dv);
    if (h < 1) return null;
    const w = mul(dv, 1 / h), u = { x: -w.y, y: w.x }, pp = h / 2, vtx = add(foot, mul(w, h / 2));
    const pts = [];
    for (let s = -1200; s <= 1200; s += 8) pts.push(add(vtx, add(mul(u, s), mul(w, (s * s) / (4 * pp)))));
    return curve([pts], false);
  }

  /* ---------- the tools ---------- */
  const T = (id, name, group, icon, steps, hint, build, extra) => Object.assign({ id, name, group, icon, steps, hint, build }, extra);
  const out = (o, r) => (r ? [r] : []);

  const TOOLS = [
    /* ===== Points ===== */
    T('point', 'Point', 'Points', 'g_point', ['pt'], 'Click anywhere to place a point.', () => []),
    T('pointon', 'Point on Object', 'Points', 'g_pointon', ['objnd'], 'Click a line, circle or curve to put a point on it.',
      ([ob], o) => [dotObj(nearestOn(o.at[0], ob), o.label())]),
    T('intersect', 'Intersect', 'Points', 'g_intersect', ['objnd', 'objnd'], 'Click two objects to mark every point where they cross.',
      ([a, b], o) => intersectObjs(a, b).map(p => dotObj(p, o.label()))),
    T('midpoint', 'Midpoint', 'Points', 'g_midpoint', ['pt', 'pt'], 'Click two points to get the point halfway between them.',
      ([a, b], o) => [dotObj(mid(a, b), o.label())]),
    T('center', 'Centre of Circle', 'Points', 'g_center', ['circ'], 'Click a circle or arc to mark its centre.',
      ([c], o) => [dotObj({ x: c.cx, y: c.cy }, o.label())]),

    /* ===== Lines ===== */
    T('line', 'Line', 'Lines', 'g_line', ['pt', 'pt'], 'Click two points to draw an infinite line through them.', ([a, b]) => [seg(a, b, 'line')]),
    T('segment', 'Segment', 'Lines', 'g_segment', ['pt', 'pt'], 'Click two points to draw a segment.', ([a, b]) => [seg(a, b)]),
    T('seglen', 'Segment with Given Length', 'Lines', 'g_seglen', ['pt'], 'Click the start point, then type the length.',
      ([a], o) => { const b = { x: a.x + o.val * PX_PER_CM, y: a.y }; return [seg(a, b), dotObj(b, o.label())]; },
      { ask: { title: 'Segment with Given Length', label: 'Length', unit: 'cm', def: 5 } }),
    T('ray', 'Ray', 'Lines', 'g_ray', ['pt', 'pt'], 'Click the start point, then a point on the ray.', ([a, b]) => [seg(a, b, 'ray')]),
    T('polyline', 'Polyline', 'Lines', 'g_polyline', ['pt'], 'Click each corner. Click the last point again (or press Enter) to finish.',
      pts => (pts.length >= 2 ? [curve([pts.map(P)], false)] : []), { variable: true, min: 2, finishOnLast: true }),
    T('vector', 'Vector', 'Lines', 'g_vector', ['pt', 'pt'], 'Click the start and the end point of the vector.', ([a, b]) => [seg(a, b, 'none', { arrow: true })]),

    /* ===== Special lines ===== */
    T('perp', 'Perpendicular Line', 'Special Lines', 'g_perp', ['pt', 'line'], 'Click a point, then the line it should be perpendicular to.',
      ([p, l]) => { const d = sub(l.b, l.a); return [seg(p, add(p, { x: -d.y, y: d.x }), 'line')]; }),
    T('parallel', 'Parallel Line', 'Special Lines', 'g_parallel', ['pt', 'line'], 'Click a point, then the line it should be parallel to.',
      ([p, l]) => [seg(p, add(p, sub(l.b, l.a)), 'line')]),
    T('perpbis', 'Perpendicular Bisector', 'Special Lines', 'g_perpbis', ['pt', 'pt'], 'Click the two end points of a segment.',
      ([a, b]) => { const m = mid(a, b), d = sub(b, a); return [seg(m, add(m, { x: -d.y, y: d.x }), 'line')]; }),
    T('anglebis', 'Angle Bisector', 'Special Lines', 'g_anglebis', ['pt', 'pt', 'pt'], 'Click a point on one arm, the vertex, then a point on the other arm.',
      ([a, v, c]) => {
        const u = unit(sub(a, v)), w = unit(sub(c, v));
        let b = add(u, w);
        if (len(b) < 1e-6) b = { x: -u.y, y: u.x };       // straight angle → perpendicular
        return [seg(v, add(v, b), 'line')];
      }),
    T('tangent', 'Tangents', 'Special Lines', 'g_tangent', ['pt', 'circ'], 'Click a point, then a circle to draw the tangent lines.',
      ([p, c]) => {
        const C = { x: c.cx, y: c.cy }, d = len(sub(p, C));
        if (d < c.r - 1e-6) return [];                    // point inside the circle: no tangent
        if (Math.abs(d - c.r) < 1e-6) { const r = sub(p, C); return [seg(p, add(p, { x: -r.y, y: r.x }), 'line')]; }
        const base = angOf(C, p), off = Math.acos(c.r / d);
        return [base + off, base - off].map(a => seg(p, polar(C, c.r, a), 'line'));
      }),

    /* ===== Polygons ===== */
    T('polygon', 'Polygon', 'Polygons', 'g_polygon', ['pt'], 'Click the corners. Click the first point again (or press Enter) to finish.',
      pts => (pts.length >= 3 ? [mk('poly', { pts: pts.map(P) })] : []), { variable: true, min: 3, closeOnFirst: true }),
    T('regpoly', 'Regular Polygon', 'Polygons', 'g_regpoly', ['pt', 'pt'], 'Click two neighbouring corners, then enter the number of vertices.',
      ([a, b], o) => {
        const n = Math.max(3, Math.min(100, Math.round(o.val))), turn = TAU / n;
        const pts = [P(a), P(b)];
        let v = sub(b, a), cur = P(b);
        for (let k = 2; k < n; k++) {
          const c = Math.cos(turn), s = Math.sin(turn);
          v = { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
          cur = add(cur, v); pts.push(P(cur));
        }
        // the two clicked corners already have labelled points; label every other corner too
        return [mk('poly', { pts }), ...pts.slice(2).map(p => dotObj(p, o.label()))];
      }, { ask: { title: 'Regular Polygon', label: 'Vertices', unit: '', def: 5, integer: true, min: 3, max: 100 } }),

    /* ===== Circles & arcs ===== */
    T('circle', 'Circle: Centre & Point', 'Circles & Arcs', 'g_circle', ['pt', 'pt'], 'Click the centre, then a point on the circle.',
      ([c, p]) => [mk('circle', { cx: c.x, cy: c.y, r: len(sub(p, c)) })]),
    T('circler', 'Circle: Centre & Radius', 'Circles & Arcs', 'g_circler', ['pt'], 'Click the centre, then type the radius.',
      ([c], o) => [mk('circle', { cx: c.x, cy: c.y, r: Math.abs(o.val) * PX_PER_CM })],
      { ask: { title: 'Circle with Centre and Radius', label: 'Radius', unit: 'cm', def: 3 } }),
    T('compass', 'Compass', 'Circles & Arcs', 'g_compass', ['pt', 'pt', 'pt'], 'Click two points (they set the radius), then click the centre.',
      ([a, b, c]) => [mk('circle', { cx: c.x, cy: c.y, r: len(sub(b, a)) })]),
    T('circle3', 'Circle: 3 Points', 'Circles & Arcs', 'g_circle3', ['pt', 'pt', 'pt'], 'Click three points that lie on the circle.',
      ([a, b, c]) => { const k = circumcircle(a, b, c); return k ? [mk('circle', { cx: k.x, cy: k.y, r: k.r })] : [seg(a, c, 'line')]; }),
    T('semicircle', 'Semicircle', 'Circles & Arcs', 'g_semicircle', ['pt', 'pt'], 'Click the two ends of the diameter.',
      ([a, b]) => { const m = mid(a, b), a0 = angOf(m, a); return [mk('arc', { cx: m.x, cy: m.y, r: len(sub(b, a)) / 2, a0, a1: a0 + Math.PI, ccw: false })]; }),
    T('arc', 'Arc: Centre & 2 Points', 'Circles & Arcs', 'g_arc', ['pt', 'pt', 'pt'], 'Click the centre, the start of the arc, then a point in the end direction (anticlockwise).',
      ([c, s, e]) => [mk('arc', { cx: c.x, cy: c.y, r: len(sub(s, c)), a0: angOf(c, s), a1: angOf(c, e), ccw: true })]),
    T('arc3', 'Arc through 3 Points', 'Circles & Arcs', 'g_arc3', ['pt', 'pt', 'pt'], 'Click the start, a point on the arc, then the end.',
      ([a, b, c]) => { const k = arcThrough(a, b, c); return k ? [mk('arc', k)] : [seg(a, c)]; }),
    T('sector', 'Sector: Centre & 2 Points', 'Circles & Arcs', 'g_sector', ['pt', 'pt', 'pt'], 'Click the centre, the start of the sector, then a point in the end direction (anticlockwise).',
      ([c, s, e]) => [mk('sector', { cx: c.x, cy: c.y, r: len(sub(s, c)), a0: angOf(c, s), a1: angOf(c, e), ccw: true })]),
    T('sector3', 'Sector through 3 Points', 'Circles & Arcs', 'g_sector3', ['pt', 'pt', 'pt'], 'Click the start, a point on the arc, then the end.',
      ([a, b, c]) => { const k = arcThrough(a, b, c); return k ? [mk('sector', k)] : [seg(a, c)]; }),

    /* ===== Conics ===== */
    T('ellipse', 'Ellipse', 'Conics', 'g_ellipse', ['pt', 'pt', 'pt'], 'Click the two foci, then a point on the ellipse.',
      ([f1, f2, p]) => out(0, ellipseCurve(f1, f2, p))),
    T('hyperbola', 'Hyperbola', 'Conics', 'g_hyperbola', ['pt', 'pt', 'pt'], 'Click the two foci, then a point on the hyperbola.',
      ([f1, f2, p]) => out(0, hyperbolaCurve(f1, f2, p))),
    T('parabola', 'Parabola', 'Conics', 'g_parabola', ['pt', 'line'], 'Click the focus, then the directrix line.',
      ([f, l]) => out(0, parabolaCurve(f, l))),

    /* ===== Measurement ===== */
    T('angle', 'Angle', 'Measure', 'g_angle', ['pt', 'pt', 'pt'], 'Click a point on the first arm, the vertex, then a point on the second arm.',
      ([a, v, c]) => {
        const a0 = angOf(v, a), a1 = angOf(v, c), delta = wrap(a0 - a1), mAng = a0 - delta / 2, R = 26;
        return [mk('arc', { cx: v.x, cy: v.y, r: R, a0, a1, ccw: true }),
          label({ x: v.x + Math.cos(mAng) * (R + 22) - 14, y: v.y + Math.sin(mAng) * (R + 22) }, (delta / DEG).toFixed(1) + '°')];
      }),
    T('anglesize', 'Angle with Given Size', 'Measure', 'g_anglesize', ['pt', 'pt'], 'Click a point on the first arm, then the vertex, then type the angle.',
      ([a, v], o) => {
        const a0 = angOf(v, a), a1 = a0 - o.val * DEG, e = polar(v, len(sub(a, v)), a1), R = 26, mAng = (a0 + a1) / 2;
        return [seg(v, e), dotObj(e, o.label() + '′'), mk('arc', { cx: v.x, cy: v.y, r: R, a0, a1, ccw: true }),
          label({ x: v.x + Math.cos(mAng) * (R + 22) - 14, y: v.y + Math.sin(mAng) * (R + 22) }, o.val + '°')];
      }, { ask: { title: 'Angle with Given Size', label: 'Angle', unit: '°', def: 45 } }),
    T('distance', 'Distance or Length', 'Measure', 'g_distance', ['pt', 'pt'], 'Click two points to measure the distance between them.',
      ([a, b]) => { const m = mid(a, b); return [label({ x: m.x + 6, y: m.y - 14 }, (len(sub(b, a)) / PX_PER_CM).toFixed(2) + ' cm')]; }),
    T('area', 'Area', 'Measure', 'g_area', ['area'], 'Click a polygon, circle or sector to measure its area.',
      ([ob]) => {
        let a, c;
        if (ob.type === 'poly') { a = polyArea(ob.pts); c = ob.pts.reduce((s, p) => add(s, p), { x: 0, y: 0 }); c = mul(c, 1 / ob.pts.length); }
        else if (ob.type === 'circle') { a = Math.PI * ob.r * ob.r; c = { x: ob.cx, y: ob.cy }; }
        else { a = (ob.r * ob.r * wrap(ob.ccw ? ob.a0 - ob.a1 : ob.a1 - ob.a0)) / 2; c = polar({ x: ob.cx, y: ob.cy }, ob.r / 2, (ob.a0 + ob.a1) / 2); }
        return [label({ x: c.x - 28, y: c.y + 5 }, (a / (PX_PER_CM * PX_PER_CM)).toFixed(2) + ' cm²')];
      }),
    T('slope', 'Slope', 'Measure', 'g_slope', ['line'], 'Click a line, segment or ray to measure its slope.',
      ([l]) => {
        const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, m = mid(l.a, l.b);
        return [label({ x: m.x + 8, y: m.y - 10 }, Math.abs(dx) < 1e-6 ? 'slope = undefined' : 'slope = ' + (-dy / dx).toFixed(2))];
      }),

    /* ===== Transformations ===== */
    T('reflect', 'Reflect about Line', 'Transform', 'g_reflect', ['obj', 'line'], 'Click an object, then the mirror line.',
      ([ob, l]) => mapAll(ob, p => reflectPoint(p, l), { flip: true })),
    T('reflectpoint', 'Reflect about Point', 'Transform', 'g_reflectpoint', ['obj', 'pt'], 'Click an object, then the centre point.',
      ([ob, c]) => mapAll(ob, p => ({ x: 2 * c.x - p.x, y: 2 * c.y - p.y }))),
    T('inversion', 'Reflect about Circle', 'Transform', 'g_inversion', ['pt', 'circ'], 'Click a point, then the circle (inversion).',
      ([p, c], o) => {
        const C = { x: c.cx, y: c.cy }, v = sub(p, C), d2 = dot(v, v);
        return d2 < 1e-9 ? [] : [dotObj(add(C, mul(v, (c.r * c.r) / d2)), o.label() + '′')];
      }),
    T('rotate', 'Rotate around Point', 'Transform', 'g_rotate', ['obj', 'pt'], 'Click an object, then the centre point, then type the angle.',
      ([ob, c], o) => {
        const a = -o.val * DEG, cs = Math.cos(a), sn = Math.sin(a);
        return mapAll(ob, p => ({ x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs }));
      }, { ask: { title: 'Rotate around Point', label: 'Angle (anticlockwise)', unit: '°', def: 90 } }),
    T('translate', 'Translate by Vector', 'Transform', 'g_translate', ['obj', 'vec'], 'Click an object, then a vector (draw one with the Vector tool).',
      ([ob, v]) => { const d = sub(v.b, v.a); return mapAll(ob, p => add(p, d)); }),
    T('dilate', 'Dilate from Point', 'Transform', 'g_dilate', ['obj', 'pt'], 'Click an object, then the centre point, then type the factor.',
      ([ob, c], o) => mapAll(ob, p => ({ x: c.x + (p.x - c.x) * o.val, y: c.y + (p.y - c.y) * o.val })),
      { ask: { title: 'Dilate from Point', label: 'Factor', unit: '×', def: 2 } }),

    /* ===== General ===== */
    T('image', 'Image', 'General', 'g_image', ['at'], 'Click where the image should go, then choose a picture.', ([], o) => [{ __op: 'image', at: o.at[0] }]),
    T('delete', 'Delete Object', 'General', 'g_delete', ['obj'], 'Click an object to delete it.', ([ob]) => [{ __op: 'delete', target: ob }]),
    T('hide', 'Show / Hide Object', 'General', 'g_hide', ['anyh'], 'Click an object to hide it. Hidden objects show faintly while this tool is active; click one to show it again.',
      ([ob]) => [{ __op: 'hide', target: ob }]),
    T('label', 'Show / Hide Label', 'General', 'g_label', ['dot'], 'Click a point to show or hide its label.', ([ob]) => [{ __op: 'label', target: ob }]),
    T('copystyle', 'Copy Visual Style', 'General', 'g_copystyle', ['obj', 'obj'], 'Click the object to copy from, then click each object to give it that colour and thickness.',
      ([from, to]) => [{ __op: 'style', from, to }], { keep: 1 }),
    T('zoomin', 'Zoom In', 'General', 'g_zoomin', ['at'], 'Click on the board to zoom in there.', ([], o) => [{ __op: 'zoom', f: 1.25, at: o.at[0] }]),
    T('zoomout', 'Zoom Out', 'General', 'g_zoomout', ['at'], 'Click on the board to zoom out from there.', ([], o) => [{ __op: 'zoom', f: 0.8, at: o.at[0] }])
  ];

  const GROUPS = [...new Set(TOOLS.map(t => t.group))];
  const byId = Object.fromEntries(TOOLS.map(t => [t.id, t]));

  /* A, B, C … Z, A1, B1 … */
  const labelFor = n => String.fromCharCode(65 + (n % 26)) + (n >= 26 ? Math.floor(n / 26) : '');


  /* =========================================================
     Controller: the click-by-click interaction shared by the whiteboard and the graph calculator.
     The host (whiteboard / graph) supplies a few functions:
       objects()           the current list of objects (plain data, in the host's own coordinates)
       commit(list)        replace the objects (the host makes it undoable)
       nextLabel()         next free point name (A, B, C …)
       scale()             screen pixels per coordinate unit (used for click tolerances)
       redraw()            repaint the preview
       zoomAt(f, at)       zoom by factor f around position "at"
       pickImage()         promise of { src, w, h } or null
       ask(opts)           number prompt (promise of a number or null)
       bbox(o)             optional bounding box for text / images
     ========================================================= */
  function createController(host) {
    let tool = null, chosen = [], ats = [], pending = [], busy = false, hover = null;
    const px = () => 1 / host.scale();
    const stepOf = () => (tool ? (tool.variable ? 'pt' : tool.steps[chosen.length + ats.length]) : null);
    const dotsNow = () => [...host.objects().filter(o => o.type === 'dot' && !o.hidden), ...pending];
    function snapDot(w) {
      let best = null, bd = 14 * px();
      for (const d of dotsNow()) { const k = Math.hypot(d.x - w.x, d.y - w.y); if (k <= bd) { best = d; bd = k; } }
      return best;
    }
    const reset = () => { chosen = []; ats = []; pending = []; host.redraw(); };

    function down(w) {
      if (!tool || busy) return;
      const step = stepOf();
      if (step === 'pt') {
        let d = snapDot(w);
        if (!d) { d = { type: 'dot', x: w.x, y: w.y, size: 5, color: NAVY, label: host.nextLabel() }; pending.push(d); }
        const last = chosen[chosen.length - 1];
        if (last && last.dot === d) return;                                           // double-click on the same point
        if (tool.variable && chosen.length >= 3 && d === chosen[0].dot && tool.closeOnFirst) { finish(); return; }
        chosen.push({ x: d.x, y: d.y, dot: d });
      } else if (step === 'at') {
        ats.push({ x: w.x, y: w.y });
      } else {
        const ob = hit([...host.objects(), ...pending], w, 10 * px(), step, host.bbox, step === 'anyh' || tool.id === 'hide');
        if (!ob) return;
        chosen.push({ obj: ob });
      }
      if (!tool.variable && chosen.length + ats.length === tool.steps.length) finish(); else host.redraw();
    }

    async function finish() {
      if (!tool || busy) return;
      if (tool.variable && chosen.length < (tool.min || 2)) return;
      const t = tool, objects = host.objects();
      const inputs = chosen.map(c => (c.obj ? c.obj : { x: c.x, y: c.y }));
      const dotsMade = pending;
      let val;
      if (t.ask) {
        busy = true;
        val = await host.ask({ title: t.ask.title, label: t.ask.label, value: t.ask.def, unit: t.ask.unit, integer: t.ask.integer, min: t.ask.min, max: t.ask.max });
        busy = false;
        if (val == null) { reset(); return; }                                         // cancelled: nothing is drawn
      }
      let result = t.build(inputs, { label: host.nextLabel, val, at: ats.slice() });
      let list = objects.slice(), built = [];
      for (const r of result) {
        if (!r.__op) { built.push(r); continue; }
        if (r.__op === 'delete') list = list.filter(o => o !== r.target);
        else if (r.__op === 'hide') list = list.map(o => (o === r.target ? { ...o, hidden: !o.hidden } : o));
        else if (r.__op === 'label') list = list.map(o => (o === r.target ? { ...o, labelHidden: !o.labelHidden } : o));
        else if (r.__op === 'style') list = list.map(o => (o === r.to ? { ...o, color: r.from.color, size: r.from.size, dash: r.from.dash } : o));
        else if (r.__op === 'zoom') host.zoomAt(r.f, r.at);
        else if (r.__op === 'image') {
          const im = await host.pickImage();
          if (im) built.push({ type: 'image', x: r.at.x, y: r.at.y, w: im.w, h: im.h, src: im.src });
        }
      }
      // "keep" tools (Copy Visual Style) keep their first pick for the next click
      const keepN = t.keep || 0;
      chosen = chosen.slice(0, keepN); ats = []; pending = [];
      if (built.length || dotsMade.length || list.length !== objects.length || list.some((o, i) => o !== objects[i])) host.commit([...list, ...built, ...dotsMade]);
      else host.redraw();
    }

    /* preview: new points, rubber band, hover highlight; px = size of one screen pixel in coordinates */
    function draw(c, drawObject) {
      const p1 = px();
      c.save();
      pending.forEach(d => drawObject(c, d));
      chosen.forEach(ch => { if (ch.obj) { c.globalAlpha = 0.35; drawObject(c, { ...ch.obj, color: '#1E88E5', size: 7 * p1, dash: 'solid' }); c.globalAlpha = 1; } });
      if (hover && tool) {
        const step = stepOf();
        c.strokeStyle = c.fillStyle = NAVY;
        if (step === 'pt') {
          const snap = snapDot(hover), tip = snap || hover, last = chosen[chosen.length - 1];
          c.lineWidth = 1.5 * p1; c.setLineDash([5 * p1, 4 * p1]); c.globalAlpha = 0.7;
          if (tool.variable && chosen.length) { c.beginPath(); chosen.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.lineTo(tip.x, tip.y); c.stroke(); }
          else if (last && last.dot) { c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(tip.x, tip.y); c.stroke(); }
          c.setLineDash([]); c.globalAlpha = snap ? 1 : 0.45;
          c.beginPath(); c.arc(tip.x, tip.y, (snap ? 9 : 4.5) * p1, 0, TAU);
          if (snap) c.stroke(); else c.fill();
        } else if (step === 'at') {
          c.globalAlpha = 0.45; c.beginPath(); c.arc(hover.x, hover.y, 4.5 * p1, 0, TAU); c.fill();
        } else if (step) {
          const ob = hit([...host.objects(), ...pending], hover, 10 * p1, step, host.bbox, step === 'anyh' || tool.id === 'hide');
          if (ob && ob.type !== 'image' && ob.type !== 'text') { c.globalAlpha = 0.35; drawObject(c, { ...ob, color: '#1E88E5', size: 7 * p1, dash: 'solid' }); }
        }
      }
      c.restore();
    }

    return {
      setTool(id) { tool = id ? byId[id] : null; reset(); },
      get tool() { return tool; },
      down, finish, reset, draw,
      move(w) { hover = w; if (tool) host.redraw(); },
      leave() { hover = null; host.redraw(); },
      count: () => chosen.length,
      canFinish: () => !!(tool && tool.variable && chosen.length >= (tool.min || 2))
    };
  }

  window.Geo = { createController, TOOLS, GROUPS, byId, KINDS, hit, distToObj, distToLine, nearestOn, segsOf, labelFor, PX_PER_CM, NAVY };
})();
