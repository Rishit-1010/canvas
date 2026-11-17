/* =========================================================
   geometry.js — GeoGebra-style construction tools
   Each tool says how many clicks it needs ("steps") and how to
   build drawable objects from those clicks ("build").
   Step kinds:  'pt'   = a point (click anywhere, or on an existing point)
                'line' = an existing line / segment / ray (click on it)
   Built objects are plain data, so they can be saved to JSON.
   ========================================================= */
(function () {
  'use strict';

  const NAVY = '#000455';
  const PX_PER_CM = 96 / 2.54;          // 1 cm on screen at 96 dpi
  const TAU = Math.PI * 2;

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

  /* ---------- object factories ---------- */
  const mk = (type, props) => Object.assign({ type, color: NAVY, size: 2 }, props);
  const seg = (a, b, ext = 'none') => mk('seg', { a: P(a), b: P(b), ext });          // ext: none | ray | line
  const dotObj = (p, label) => mk('dot', { x: p.x, y: p.y, size: 5, label });
  const label = (p, text, fs = 15) => mk('label', { x: p.x, y: p.y, text, fs });

  /* distance from point p to a seg/ray/line object */
  function distToLine(p, l) {
    const d = sub(l.b, l.a);
    const dd = dot(d, d) || 1;
    let t = dot(sub(p, l.a), d) / dd;
    if (l.ext === 'none') t = Math.min(1, Math.max(0, t));
    else if (l.ext === 'ray') t = Math.max(0, t);
    return len(sub(p, add(l.a, mul(d, t))));
  }

  /* intersection of two seg/ray/line objects (null when parallel or out of range) */
  function intersect(l1, l2) {
    const d1 = sub(l1.b, l1.a), d2 = sub(l2.b, l2.a);
    const den = cross(d1, d2);
    if (Math.abs(den) < 1e-9) return null;
    const ac = sub(l2.a, l1.a);
    const t = cross(ac, d2) / den, u = cross(ac, d1) / den;
    const ok = (v, ext) => ext === 'line' || (ext === 'ray' ? v >= 0 : v >= 0 && v <= 1);
    return ok(t, l1.ext) && ok(u, l2.ext) ? add(l1.a, mul(d1, t)) : null;
  }

  /* mirror point p across the infinite line through l.a, l.b */
  function reflect(p, l) {
    const d = sub(l.b, l.a);
    const t = dot(sub(p, l.a), d) / (dot(d, d) || 1);
    const foot = add(l.a, mul(d, t));
    return sub(mul(foot, 2), p);
  }

  /* circle through three points (null if they are in a straight line) */
  function circumcircle(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    return { x, y, r: Math.hypot(a.x - x, a.y - y) };
  }

  /* ---------- the tools ---------- */
  const TOOLS = [
    { id: 'point', name: 'Point', group: 'Points', icon: 'g_point', steps: ['pt'],
      hint: 'Click anywhere to place a point.', build: () => [] },

    { id: 'midpoint', name: 'Midpoint', group: 'Points', icon: 'g_midpoint', steps: ['pt', 'pt'],
      hint: 'Click two points to get the point halfway between them.',
      build: ([a, b], o) => [dotObj(mid(a, b), o.label())] },

    { id: 'intersect', name: 'Intersect', group: 'Points', icon: 'g_intersect', steps: ['line', 'line'],
      hint: 'Click two lines, segments or rays to mark where they cross.',
      build: ([l1, l2], o) => { const p = intersect(l1, l2); return p ? [dotObj(p, o.label())] : []; } },

    { id: 'segment', name: 'Segment', group: 'Lines', icon: 'g_segment', steps: ['pt', 'pt'],
      hint: 'Click two points to draw a segment.', build: ([a, b]) => [seg(a, b)] },

    { id: 'line', name: 'Line', group: 'Lines', icon: 'g_line', steps: ['pt', 'pt'],
      hint: 'Click two points to draw an infinite line through them.', build: ([a, b]) => [seg(a, b, 'line')] },

    { id: 'ray', name: 'Ray', group: 'Lines', icon: 'g_ray', steps: ['pt', 'pt'],
      hint: 'Click the start point, then a point on the ray.', build: ([a, b]) => [seg(a, b, 'ray')] },

    { id: 'perp', name: 'Perpendicular Line', group: 'Lines', icon: 'g_perp', steps: ['pt', 'line'],
      hint: 'Click a point, then the line it should be perpendicular to.',
      build: ([p, l]) => { const d = sub(l.b, l.a); return [seg(p, add(p, { x: -d.y, y: d.x }), 'line')]; } },

    { id: 'parallel', name: 'Parallel Line', group: 'Lines', icon: 'g_parallel', steps: ['pt', 'line'],
      hint: 'Click a point, then the line it should be parallel to.',
      build: ([p, l]) => [seg(p, add(p, sub(l.b, l.a)), 'line')] },

    { id: 'perpbis', name: 'Perpendicular Bisector', group: 'Lines', icon: 'g_perpbis', steps: ['pt', 'pt'],
      hint: 'Click the two end points of a segment.',
      build: ([a, b]) => { const m = mid(a, b), d = sub(b, a); return [seg(m, add(m, { x: -d.y, y: d.x }), 'line')]; } },

    { id: 'anglebis', name: 'Angle Bisector', group: 'Lines', icon: 'g_anglebis', steps: ['pt', 'pt', 'pt'],
      hint: 'Click a point on one arm, the vertex, then a point on the other arm.',
      build: ([a, v, c]) => {
        const u = unit(sub(a, v)), w = unit(sub(c, v));
        let b = add(u, w);
        if (len(b) < 1e-6) b = { x: -u.y, y: u.x };       // straight angle → perpendicular
        return [seg(v, add(v, b), 'ray')];
      } },

    { id: 'polygon', name: 'Polygon', group: 'Polygons', icon: 'g_polygon', steps: ['pt'], variable: true,
      hint: 'Click the corners. Click the first point again (or press Enter) to finish.',
      build: pts => (pts.length >= 3 ? [mk('poly', { pts: pts.map(P) })] : []) },

    { id: 'regpoly', name: 'Regular Polygon', group: 'Polygons', icon: 'g_regpoly', steps: ['pt', 'pt'], usesSides: true,
      hint: 'Click two neighbouring corners. Set the number of sides below.',
      build: ([a, b], o) => {
        const n = Math.max(3, o.sides | 0), ext = TAU / n;
        const pts = [P(a), P(b)];
        let v = sub(b, a), cur = P(b);
        for (let k = 2; k < n; k++) {
          const c = Math.cos(ext), s = Math.sin(ext);
          v = { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
          cur = add(cur, v); pts.push(P(cur));
        }
        return [mk('poly', { pts })];
      } },

    { id: 'circle', name: 'Circle: Centre & Point', group: 'Circles & Arcs', icon: 'g_circle', steps: ['pt', 'pt'],
      hint: 'Click the centre, then a point on the circle.',
      build: ([c, p]) => [mk('circle', { cx: c.x, cy: c.y, r: len(sub(p, c)) })] },

    { id: 'circle3', name: 'Circle: 3 Points', group: 'Circles & Arcs', icon: 'g_circle3', steps: ['pt', 'pt', 'pt'],
      hint: 'Click three points that lie on the circle.',
      build: ([a, b, c]) => { const k = circumcircle(a, b, c); return k ? [mk('circle', { cx: k.x, cy: k.y, r: k.r })] : [seg(a, c, 'line')]; } },

    { id: 'compass', name: 'Compass', group: 'Circles & Arcs', icon: 'g_compass', steps: ['pt', 'pt', 'pt'],
      hint: 'Click two points (they set the radius), then click the centre.',
      build: ([a, b, c]) => [mk('circle', { cx: c.x, cy: c.y, r: len(sub(b, a)) })] },

    { id: 'semicircle', name: 'Semicircle', group: 'Circles & Arcs', icon: 'g_semicircle', steps: ['pt', 'pt'],
      hint: 'Click the two ends of the diameter.',
      build: ([a, b]) => {
        const m = mid(a, b), a0 = Math.atan2(a.y - m.y, a.x - m.x);
        return [mk('arc', { cx: m.x, cy: m.y, r: len(sub(b, a)) / 2, a0, a1: a0 + Math.PI, ccw: false })];
      } },

    { id: 'arc', name: 'Arc: Centre & 2 Points', group: 'Circles & Arcs', icon: 'g_arc', steps: ['pt', 'pt', 'pt'],
      hint: 'Click the centre, the start of the arc, then the end direction (anticlockwise).',
      build: ([c, s, e]) => [mk('arc', { cx: c.x, cy: c.y, r: len(sub(s, c)), a0: Math.atan2(s.y - c.y, s.x - c.x), a1: Math.atan2(e.y - c.y, e.x - c.x), ccw: true })] },

    { id: 'angle', name: 'Angle', group: 'Measure', icon: 'g_angle', steps: ['pt', 'pt', 'pt'],
      hint: 'Click a point on the first arm, the vertex, then a point on the second arm.',
      build: ([a, v, c]) => {
        const a0 = Math.atan2(a.y - v.y, a.x - v.x), a1 = Math.atan2(c.y - v.y, c.x - v.x);
        let delta = (a0 - a1) % TAU; if (delta < 0) delta += TAU;           // anticlockwise sweep on screen
        const mAng = a0 - delta / 2, R = 26;
        const out = [mk('arc', { cx: v.x, cy: v.y, r: R, a0, a1, ccw: true })];
        out.push(label({ x: v.x + Math.cos(mAng) * (R + 22) - 14, y: v.y + Math.sin(mAng) * (R + 22) }, (delta * 180 / Math.PI).toFixed(1) + '°'));
        return out;
      } },

    { id: 'distance', name: 'Distance', group: 'Measure', icon: 'g_distance', steps: ['pt', 'pt'],
      hint: 'Click two points to measure the distance between them.',
      build: ([a, b]) => { const m = mid(a, b); return [label({ x: m.x + 6, y: m.y - 14 }, (len(sub(b, a)) / PX_PER_CM).toFixed(2) + ' cm')]; } },

    { id: 'reflect', name: 'Reflect about Line', group: 'Transform', icon: 'g_reflect', steps: ['pt', 'line'],
      hint: 'Click a point, then the mirror line.',
      build: ([p, l], o) => [dotObj(reflect(p, l), o.label() + '′')] }
  ];

  const GROUPS = [...new Set(TOOLS.map(t => t.group))];
  const byId = Object.fromEntries(TOOLS.map(t => [t.id, t]));

  /* A, B, C … Z, A1, B1 … */
  const labelFor = n => String.fromCharCode(65 + (n % 26)) + (n >= 26 ? Math.floor(n / 26) : '');

  window.Geo = { TOOLS, GROUPS, byId, distToLine, labelFor, PX_PER_CM, NAVY };
})();
