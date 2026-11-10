/* Rishit's Canvas – Whiteboard
 * Vanilla JS, no build step. Objects are kept as vectors in world coordinates;
 * the camera (pan / zoom) is stored per board. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const NAVY = '#000455';
const FONTS = { sans: "'Jura','Segoe UI',system-ui,sans-serif", serif: "Georgia,'Times New Roman',serif", mono: "'Courier New',monospace", hand: "'Comic Sans MS','Segoe Print',cursive" };
const COLORS = ['#000455', '#111111', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ffffff', '#9e9e9e'];
const MIN_Z = 0.1, MAX_Z = 4;
let uidN = 0; const uid = () => Date.now().toString(36) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 5);

/* ───────── State ───────── */
const cv = $('#cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, dpr = 1;
const newBoard = () => ({ id: uid(), objs: [], bg: { type: 'none', color: '#ffffff', img: null }, view: { x: 0, y: 0, z: 1 }, undo: [], redo: [], inst: [] });
let boards = [newBoard()], cur = 0;
const imgs = new Map();                     // id -> {src, el}
let tool = 'select', prevTool = 'select', sel = new Set(), clip = [];
const S = {                                 // tool settings
  pen: { color: '#000455', w: 4, hl: false },
  eraser: { size: 28 },
  shape: { kind: 'rect', color: '#000455', w: 3, fill: null },
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
function shapePoly(o) {
  const { x, y, w, h } = shapeBox(o);
  switch (o.kind) {
    case 'rect': return { pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true };
    case 'triangle': return { pts: [[x + w / 2, y], [x + w, y + h], [x, y + h]], closed: true };
    case 'diamond': return { pts: [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], closed: true };
    case 'ellipse': { const p = []; for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; p.push([x + w / 2 + Math.cos(a) * w / 2, y + h / 2 + Math.sin(a) * h / 2]); } return { pts: p, closed: true }; }
    case 'star': { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .42 : 1; p.push([x + w / 2 + Math.cos(a) * r * w / 2, y + h / 2 + Math.sin(a) * r * h / 2]); } return { pts: p, closed: true }; }
    default: return { pts: [[o.x1, o.y1], [o.x2, o.y2]], closed: false };
  }
}
function gbox(o) {                         // geometric bounding box (no stroke width)
  if (o.type === 'stroke') {
    let a = 1e18, b = 1e18, c = -1e18, d = -1e18;
    for (let i = 0; i < o.pts.length; i += 2) { a = Math.min(a, o.pts[i]); c = Math.max(c, o.pts[i]); b = Math.min(b, o.pts[i + 1]); d = Math.max(d, o.pts[i + 1]); }
    return { x: a, y: b, w: c - a, h: d - b };
  }
  if (o.type === 'shape') return shapeBox(o);
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}
function hit(o, p, tol) {
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
function drawObj(c, o) {
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
    const { x, y, w, h } = shapeBox(o); c.beginPath();
    if (o.kind === 'ellipse') c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 7);
    else { const { pts, closed } = shapePoly(o); pts.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); if (closed) c.closePath(); }
    if (o.fill && o.kind !== 'line' && o.kind !== 'arrow') { c.fillStyle = o.fill; c.fill(); }
    if (o.kind === 'arrow') {
      const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), L = Math.min(Math.max(14, o.w * 4), Math.hypot(o.x2 - o.x1, o.y2 - o.y1) * .6 + 2);
      for (const s of [-1, 1]) { c.moveTo(o.x2, o.y2); c.lineTo(o.x2 - L * Math.cos(a + s * .45), o.y2 - L * Math.sin(a + s * .45)); }
    }
    c.stroke();
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
function drawInst(c, i, z) {
  c.save(); c.translate(i.x, i.y); c.rotate(i.a);
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
function dirty() { if (!needs) { needs = true; requestAnimationFrame(frame); } }
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
  for (const o of objs()) {
    if (o.type !== 'stroke' || objs().length < 400) { /* cull cheaply */ }
    const g = gbox(o), pad = (o.w || 0) * 2 + 4;
    if (g.x - pad > x1 || g.x + g.w + pad < x0 || g.y - pad > y1 || g.y + g.h + pad < y0) continue;
    drawObj(ctx, o);
  }
  for (const i of B().inst) drawInst(ctx, i, v.z);
  // selection overlay in screen space
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const list = selObjs();
  if (list.length && tool === 'select' && !(drawing && drawing.t === 'draw')) {
    const ub = unionBox(list), a = toS(ub.x, ub.y), b = toS(ub.x + ub.w, ub.y + ub.h);
    ctx.strokeStyle = '#1e88e5'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.strokeRect(a.x - 4, a.y - 4, b.x - a.x + 8, b.y - a.y + 8); ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    for (const [k, h] of selHandles(list)) { const s = toS(h[0], h[1]); ctx.beginPath(); ctx.rect(s.x - 5, s.y - 5, 10, 10); ctx.fill(); ctx.stroke(); void k; }
  }
  if (marquee) { const a = toS(marquee.x1, marquee.y1), b = toS(marquee.x2, marquee.y2); ctx.fillStyle = 'rgba(30,136,229,.12)'; ctx.strokeStyle = '#1e88e5'; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); }
  if (tool === 'eraser' && hover) { ctx.beginPath(); ctx.arc(hover.x, hover.y, S.eraser.size / 2, 0, 7); ctx.strokeStyle = NAVY; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = 'rgba(0,4,85,.06)'; ctx.fill(); }
  placeSelBar();
}
function selHandles(list) {                  // [[name,[wx,wy]]]
  if (list.length === 1 && list[0].type === 'shape' && (list[0].kind === 'line' || list[0].kind === 'arrow')) return [['p1', [list[0].x1, list[0].y1]], ['p2', [list[0].x2, list[0].y2]]];
  if (list.length !== 1) return [];
  return Object.entries(handlePos(gbox(list[0])));
}

/* ───────── Canvas sizing ───────── */
function resize() {
  const r = $('#stage').getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); dirty(); layout();
}
window.addEventListener('resize', resize);

/* ───────── Toolbar layout / dragging ───────── */
const ltb = $('#ltb'), bbar = $('#bbar');
let tbPos = null; try { tbPos = JSON.parse(localStorage.getItem('rmcanvas.tb')); } catch (e) { }
let tbScale = 1;
function layout() {
  const vw = innerWidth, vh = innerHeight;
  const sb = clamp((vw - 16) / 664, .6, 1); bbar.style.transform = `scale(${sb})`;
  tbScale = clamp((vh - 60 - 70 * sb - 22) / 682, .5, 1);
  ltb.style.transform = `scale(${tbScale})`;
  placeTb(tbPos ? tbPos.x : 10, tbPos ? tbPos.y : vh - 70 * sb - 10 - 682 * tbScale, !tbPos);
  placePop();
}
function placeTb(x, y, auto) {
  const vw = innerWidth, vh = innerHeight, sb = clamp((vw - 16) / 664, .6, 1), w = 80 * tbScale, h = 682 * tbScale;
  x = clamp(x, 0, vw - w);
  const overlapsBar = x < 664 * sb;
  const maxY = overlapsBar ? vh - 70 * sb - 6 - h : vh - 4 - h;
  y = clamp(y, 64, Math.max(64, maxY));
  ltb.style.left = x + 'px'; ltb.style.top = y + 'px';
  if (!auto) tbPos = { x, y };
}
(() => {
  const grip = $('#grip'); let d = null;
  grip.addEventListener('pointerdown', e => {
    grip.setPointerCapture(e.pointerId); grip.classList.add('dragging');
    const r = ltb.getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top }; e.preventDefault();
  });
  grip.addEventListener('pointermove', e => { if (d) { placeTb(e.clientX - d.dx, e.clientY - d.dy, false); placePop(); } });
  const end = () => { if (!d) return; d = null; grip.classList.remove('dragging'); try { localStorage.setItem('rmcanvas.tb', JSON.stringify(tbPos)); } catch (e) { } };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => { tbPos = null; try { localStorage.removeItem('rmcanvas.tb'); } catch (e) { } layout(); });
})();

/* ───────── Tool selection & popovers ───────── */
const pop = $('#pop'); let popFor = null;
const toolBtn = n => document.querySelector(`.tool[data-tool="${n}"],.tool[data-action="${n}"]`);
function setTool(t) {
  if (t === 'tools') { if (tool !== 'tools') prevTool = tool; }
  tool = t; document.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  if (!['select', 'tools'].includes(t)) sel.clear();
  closeEditor(true); updateCursor(); dirty();
}
function updateCursor() {
  cv.style.cursor = { select: 'default', tools: 'default', move: 'grab', pen: 'crosshair', shapes: 'crosshair', text: 'text', eraser: 'none' }[tool] || 'default';
}
function openPop(name) { popFor = name; renderPop(); pop.hidden = false; placePop(); document.querySelectorAll('.tool').forEach(b => b.classList.toggle('open', (b.dataset.tool || b.dataset.action) === name && !b.classList.contains('active'))); }
function closePop() { popFor = null; pop.hidden = true; document.querySelectorAll('.tool.open').forEach(b => b.classList.remove('open')); }
function placePop() {
  if (!popFor || pop.hidden) return;
  const b = toolBtn(popFor).getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let x = b.right + 10; if (x + pw > innerWidth - 6) x = b.left - pw - 10; x = clamp(x, 6, innerWidth - pw - 6);
  pop.style.left = x + 'px'; pop.style.top = clamp(b.top, 66, innerHeight - ph - 6) + 'px';
}
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => {
  const t = b.dataset.tool, a = b.dataset.action;
  if (a === 'clear') { closePop(); askClear(); return; }
  if (a === 'backdrop') { popFor === 'backdrop' ? closePop() : openPop('backdrop'); return; }
  if (t === tool && popFor === t) { closePop(); return; }
  const had = t === tool; setTool(t);
  if (['pen', 'eraser', 'shapes', 'text', 'tools'].includes(t)) openPop(t); else closePop();
  void had;
}));

const h = (tag, attrs = {}, kids = []) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); } kids.forEach(c => e.append(c)); return e; };
function sec(title, ...kids) { return h('div', { class: 'sec' }, [h('h3', { html: title }), ...kids]); }
function swatches(cur, set, extra) {
  const wrap = h('div', { class: 'sw' });
  COLORS.forEach(c => wrap.append(h('button', { style: `background:${c}`, class: c.toLowerCase() === (cur || '').toLowerCase() ? 'on' : '', title: c, on: { click: () => { set(c); renderPop(); } } })));
  const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#000455', on: { input: e => set(e.target.value) } });
  inp.addEventListener('change', renderPop); wrap.append(h('label', { class: 'rainbow', title: 'Custom colour' }, [inp]));
  if (extra) wrap.append(extra); return wrap;
}
function slider(min, max, val, set, unit = '') {
  const out = h('b', { html: val + unit }), r = h('input', { type: 'range', min, max, value: val, on: { input: e => { set(+e.target.value); out.textContent = e.target.value + unit; } } });
  return h('div', { class: 'row' }, [r, out]);
}
const SHAPE_ICONS = {
  rect: '<rect x="4" y="5" width="16" height="14" fill="none" stroke="currentColor" stroke-width="2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="7" fill="none" stroke="currentColor" stroke-width="2"/>',
  triangle: '<path d="M12 4L21 20H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  diamond: '<path d="M12 3L21 12L12 21L3 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  star: '<path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  line: '<path d="M4 20L20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  arrow: '<path d="M4 20L20 4M10 4h10v10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};
function renderPop() {
  pop.replaceChildren();
  if (popFor === 'pen') {
    const s = S.pen;
    pop.append(
      sec('Type', h('div', { class: 'chips' }, [['Pen', false], ['Highlighter', true]].map(([n, v]) => h('button', { class: 'chip' + (s.hl === v ? ' on' : ''), on: { click: () => { s.hl = v; renderPop(); } } }, [n])))),
      sec('Colour', swatches(s.color, c => s.color = c)),
      sec('Thickness', slider(1, 30, s.w, v => s.w = v, 'px')),
      h('p', { class: 'hint', html: 'Tip: with the ruler or set square open, start a line next to its edge to draw straight lines.' }));
  } else if (popFor === 'eraser') {
    pop.append(sec('Eraser size', slider(8, 100, S.eraser.size, v => { S.eraser.size = v; dirty(); }, 'px')), h('p', { class: 'hint', html: 'Erases parts of pen strokes; shapes, text and images are removed when touched.' }));
  } else if (popFor === 'shapes') {
    const s = S.shape, fillBtns = h('div', { class: 'sw' });
    fillBtns.append(h('button', { style: 'background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/8px 8px', class: !s.fill ? 'on' : '', title: 'No fill', on: { click: () => { s.fill = null; renderPop(); } } }));
    COLORS.slice(0, 8).forEach(c => fillBtns.append(h('button', { style: `background:${c}`, class: s.fill === c ? 'on' : '', on: { click: () => { s.fill = c; renderPop(); } } })));
    pop.append(
      sec('Shape', h('div', { class: 'chips' }, Object.keys(SHAPE_ICONS).map(k => h('button', { class: 'chip' + (s.kind === k ? ' on' : ''), title: k, on: { click: () => { s.kind = k; renderPop(); } }, html: `<svg viewBox="0 0 24 24">${SHAPE_ICONS[k]}</svg>` })))),
      sec('Outline', swatches(s.color, c => s.color = c)), sec('Fill', fillBtns), sec('Thickness', slider(1, 20, s.w, v => s.w = v, 'px')));
  } else if (popFor === 'text') {
    const s = S.text;
    pop.append(
      sec('Font', h('div', { class: 'chips' }, [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono'], ['hand', 'Hand']].map(([k, n]) => h('button', { class: 'chip' + (s.font === k ? ' on' : ''), style: `font-family:${FONTS[k]}`, on: { click: () => { s.font = k; renderPop(); } } }, [n])))),
      sec('Colour', swatches(s.color, c => s.color = c)), sec('Size', slider(10, 120, s.size, v => s.size = v, 'px')),
      h('p', { class: 'hint', html: 'Click on the board to type. Double-click text with the Select tool to edit it.' }));
  } else if (popFor === 'tools') {
    const add = k => { const z = view().z, c = toW(W / 2, H / 2); const same = B().inst.filter(i => i.k === k); if (same.length) { B().inst = B().inst.filter(i => i.k !== k); } else { const n = B().inst.length * 50; B().inst.push({ id: uid(), k, x: c.x + n, y: c.y + n, a: 0 }); }; renderPop(); dirty(); void z; };
    const on = k => B().inst.some(i => i.k === k);
    pop.append(sec('Geometry tools', h('div', { class: 'chips' }, [['ruler', 'Ruler'], ['square', 'Set square'], ['protractor', 'Protractor']].map(([k, n]) => h('button', { class: 'chip' + (on(k) ? ' on' : ''), on: { click: () => add(k) } }, [n])))),
      h('p', { class: 'hint', html: 'Drag a tool to move it, use the round arrow handle to rotate it and × to remove it. Pen strokes started next to an edge snap to a straight line.' }));
  } else if (popFor === 'backdrop') {
    const bg = B().bg, set = patch => action(() => Object.assign(B().bg, patch)), bgs = ['#ffffff', '#fff8e1', '#f2f2f2', '#e8f1ff', '#e8f5e9', '#1f3d2b', '#111111', '#000455'];
    pop.append(
      sec('Pattern', h('div', { class: 'chips' }, [['none', 'Plain'], ['grid', 'Grid'], ['dots', 'Dots'], ['lines', 'Lines'], ['graph', 'Graph']].map(([k, n]) => h('button', { class: 'chip' + (bg.type === k ? ' on' : ''), on: { click: () => { set({ type: k }); renderPop(); } } }, [n])))),
      sec('Colour', (() => { const w = h('div', { class: 'sw' }); bgs.forEach(c => w.append(h('button', { style: `background:${c}`, class: bg.color.toLowerCase() === c ? 'on' : '', on: { click: () => { set({ color: c }); renderPop(); } } }))); return w; })()),
      sec('Image', h('div', { class: 'chips' }, [h('button', { class: 'chip', on: { click: () => { pickImage('backdrop'); } } }, ['Upload…']), bg.type === 'image' ? h('button', { class: 'chip', on: { click: () => { set({ type: 'none', img: null }); renderPop(); } } }, ['Remove']) : '']))
    );
  }
}
document.addEventListener('pointerdown', e => { if (popFor && !pop.contains(e.target) && !e.target.closest('.tool') && !e.target.closest('#ltb')) closePop(); }, true);

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
  if (popFor) closePop();
  if (pts.size === 2) { cancelDrag(); const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, z: view().z, v: { ...view() } }; return; }
  if (pts.size > 2) return;
  ensureNotEditing();
  const z = view().z, p = toW(s.x, s.y); let t = tool === 'tools' ? 'select' : tool;
  if (e.button === 1 || spaceDown) { drawing = { t: 'pan', sx: s.x, sy: s.y, vx: view().x, vy: view().y }; cv.style.cursor = 'grabbing'; return; }
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  // instruments take priority for select / pen (pen only away from their edges)
  if (t === 'select' || t === 'pen') {
    let hitI = instAt(p, z, false);
    if (hitI && hitI.part === 'body' && t === 'pen' && snapEdge(p, z)) hitI = null;   // near an edge: draw, don't drag
    if (hitI) {
      const i = hitI.i, list = B().inst; list.push(list.splice(list.indexOf(i), 1)[0]);
      if (hitI.part === 'close') { B().inst = list.filter(q => q !== i); if (popFor === 'tools') renderPop(); dirty(); return; }
      drawing = hitI.part === 'rot' ? { t: 'irot', i, off: Math.atan2(INST[i.k].handle[1], INST[i.k].handle[0]) } : { t: 'imove', i, dx: p.x - i.x, dy: p.y - i.y };
      dirty(); return;
    }
  }
  if (t === 'move') { drawing = { t: 'pan', sx: s.x, sy: s.y, vx: view().x, vy: view().y }; cv.style.cursor = 'grabbing'; return; }
  if (t === 'pen') {
    const sn = snapEdge(p, z), p0 = sn ? projEdge(sn, p) : p;
    const o = { id: uid(), type: 'stroke', pts: [p0.x, p0.y], color: S.pen.color, w: S.pen.w, hl: S.pen.hl };
    drawing = { t: 'draw', o, before: snap(), sn }; objs().push(o); dirty(); return;
  }
  if (t === 'eraser') { drawing = { t: 'erase', before: snap(), last: p, changed: false }; eraseAt(p); return; }
  if (t === 'shapes') {
    const o = { id: uid(), type: 'shape', kind: S.shape.kind, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: S.shape.color, w: S.shape.w, fill: S.shape.fill };
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
  const top = [...objs()].reverse().find(o => hit(o, p, 6 / z));
  if (top) {
    if (e.shiftKey) { sel.has(top.id) ? sel.delete(top.id) : sel.add(top.id); }
    else if (!sel.has(top.id)) sel = new Set([top.id]);
    if (sel.has(top.id)) drawing = { t: 'move', last: p, before: snap(), moved: false, id: top.id, dbl: e.detail === 2 };
    syncUI(); dirty(); return;
  }
  if (!e.shiftKey) sel.clear();
  marquee = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, add: e.shiftKey, base: new Set(sel) }; drawing = { t: 'marquee' }; syncUI(); dirty();
});

cv.addEventListener('pointermove', e => {
  const s = pos(e); hover = s; if (tool === 'eraser') dirty();
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
    if (e.shiftKey) {
      if (o.kind === 'line' || o.kind === 'arrow') { const a = Math.round(Math.atan2(y - o.y1, x - o.x1) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(x - o.x1, y - o.y1); x = o.x1 + Math.cos(a) * l; y = o.y1 + Math.sin(a) * l; }
      else { const m = Math.max(Math.abs(x - o.x1), Math.abs(y - o.y1)); x = o.x1 + Math.sign(x - o.x1 || 1) * m; y = o.y1 + Math.sign(y - o.y1 || 1) * m; }
    }
    o.x2 = x; o.y2 = y; dirty(); return;
  }
  if (d.t === 'imove') { d.i.x = p.x - d.dx; d.i.y = p.y - d.dy; dirty(); return; }
  if (d.t === 'irot') { d.i.a = Math.atan2(p.y - d.i.y, p.x - d.i.x) - d.off; if (e.shiftKey) d.i.a = Math.round(d.i.a / (Math.PI / 12)) * Math.PI / 12; dirty(); return; }
  if (d.t === 'move') {
    const dx = p.x - d.last.x, dy = p.y - d.last.y; if (!d.moved && Math.hypot(s.x - pts.get(e.pointerId).x, 0) >= 0) d.moved = true;
    for (const o of selObjs()) moveObj(o, dx, dy); d.last = p; d.moved = true; dirty(); return;
  }
  if (d.t === 'marquee') {
    marquee.x2 = p.x; marquee.y2 = p.y; const bx = { x: Math.min(marquee.x1, p.x), y: Math.min(marquee.y1, p.y), w: Math.abs(p.x - marquee.x1), h: Math.abs(p.y - marquee.y1) };
    sel = new Set(marquee.base);
    for (const o of objs()) { const g = gbox(o); if (g.x <= bx.x + bx.w && g.x + g.w >= bx.x && g.y <= bx.y + bx.h && g.y + g.h >= bx.y) sel.add(o.id); }
    dirty(); return;
  }
  if (d.t === 'resize') resizeDrag(d, p, e.shiftKey);
});

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
  const keep = shift || o.type === 'image' || o.type === 'text';
  if (keep && b.w && b.h && n.length === 2) {
    const k = Math.max(w / b.w, hh / b.h); w = b.w * k; hh = b.h * k;
    if (n.includes('w')) x1 = x2 - w; else x2 = x1 + w; if (n.includes('n')) y1 = y2 - hh; else y2 = y1 + hh;
  } else if (o.type === 'text' || (o.type === 'image' && b.w && b.h)) {
    if (n === 'e' || n === 'w') { const k = w / b.w; hh = b.h * k; y2 = y1 + hh; } else { const k = hh / b.h; w = b.w * k; x2 = x1 + w; }
  }
  fitObj(o0, o, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }); dirty();
}

function cancelDrag() {
  if (drawing && (drawing.t === 'draw' || drawing.t === 'shape')) B().objs = B().objs.filter(o => o !== drawing.o);
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
  else if (d.t === 'draw') { pushUndo(d.before); }
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
  else if (d.t === 'marquee') { marquee = null; syncUI(); }
  else if (d.t === 'imove' || d.t === 'irot') save();
  void s; dirty();
}
cv.addEventListener('pointerup', endPointer); cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { hover = null; if (tool === 'eraser') dirty(); });
cv.addEventListener('dblclick', e => {
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
  const z = view().z, r = S.eraser.size / 2 / z, b = B(); let changed = false; const out = [];
  for (const o of b.objs) {
    if (o.type === 'stroke') {
      const g = gbox(o), pad = r + o.w * (o.hl ? 1.5 : .5);
      if (p.x < g.x - pad || p.x > g.x + g.w + pad || p.y < g.y - pad || p.y > g.y + g.h + pad) { out.push(o); continue; }
      const parts = eraseStroke(o, p, r); if (parts === null) out.push(o); else { changed = true; out.push(...parts); }
    } else if (hit(o, p, r)) { changed = true; sel.delete(o.id); } else out.push(o);
  }
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
  if (!list.length || tool !== 'select' || drawing && drawing.t !== 'marquee' || editing) { selbar.hidden = true; return; }
  const ub = unionBox(list), a = toS(ub.x, ub.y), b = toS(ub.x + ub.w, ub.y + ub.h); selbar.hidden = false;
  const w = selbar.offsetWidth, hh = selbar.offsetHeight;
  selbar.style.left = clamp((a.x + b.x) / 2 - w / 2, 4, W - w - 4) + 'px';
  selbar.style.top = clamp(a.y - hh - 14, 4, H - hh - 4) + 'px';
  const f = list.find(o => o.type !== 'image'), hasShape = list.some(o => o.type === 'shape' && o.kind !== 'line' && o.kind !== 'arrow');
  $('#selColor').parentElement.style.display = f ? '' : 'none'; if (f) $('#selColor').value = f.color;
  $('#selFillWrap').style.display = $('#selNoFill').style.display = hasShape ? '' : 'none';
  if (hasShape) $('#selFill').value = list.find(o => o.fill)?.fill || '#ffffff';
}
$('#selColor').addEventListener('input', e => recolor(e.target.value, 'color'));
$('#selFill').addEventListener('input', e => recolor(e.target.value, 'fill'));
$('#selNoFill').addEventListener('click', () => action(() => selObjs().forEach(o => { if (o.type === 'shape') o.fill = null; })));
let recolorBefore = null;
function recolor(c, k) {
  if (!recolorBefore) { recolorBefore = snap(); }
  selObjs().forEach(o => { if (k === 'color' && o.type !== 'image') o.color = c; if (k === 'fill' && o.type === 'shape' && o.kind !== 'line' && o.kind !== 'arrow') o.fill = c; });
  dirty(); clearTimeout(recolor.t); recolor.t = setTimeout(() => { pushUndo(recolorBefore); recolorBefore = null; }, 500);
}
$('#selDel').addEventListener('click', delSel); $('#selDup').addEventListener('click', dupSel);
function delSel() { if (!sel.size) return; action(() => { B().objs = objs().filter(o => !sel.has(o.id)); sel.clear(); }); syncUI(); }
function copySel() { clip = structuredClone(selObjs()); }
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
function syncZoom() { const p = z2p(view().z); zr.value = Math.round(p * 1000); zr.style.setProperty('--p', p * 100 + '%'); toast(Math.round(view().z * 100) + '%'); }
zr.addEventListener('input', () => zoomAt(p2z(zr.value / 1000), W / 2, H / 2));
$('#zoomInBtn').addEventListener('click', () => zoomAt(view().z * 1.25, W / 2, H / 2));
$('#zoomOutBtn').addEventListener('click', () => zoomAt(view().z / 1.25, W / 2, H / 2));
let toastT; function toast(msg, ms = 900) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }

/* ───────── Boards ───────── */
const pageNum = $('#pageNum');
function goBoard(i) {
  i = clamp(i, 0, boards.length - 1); closeEditor(true); cancelDrag(); cur = i; sel.clear(); pageSync(); syncZoom(); toast('Board ' + (i + 1) + ' of ' + boards.length); syncUI(); dirty(); save();
}
function pageSync() { pageNum.value = cur + 1; $('#pageOf').textContent = 'of ' + boards.length; $('#prevBtn').disabled = cur === 0; $('#nextBtn').disabled = cur === boards.length - 1; if (popFor === 'backdrop' || popFor === 'tools') renderPop(); }
$('#prevBtn').addEventListener('click', () => goBoard(cur - 1));
$('#nextBtn').addEventListener('click', () => goBoard(cur + 1));
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
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });

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
  x.setTransform(k, 0, 0, k, v.x * k, v.y * k); b.objs.forEach(o => drawObj(x, o));
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
  if (k === 'escape') { sel.clear(); closePop(); toggleSidebar(false); dirty(); return; }
  if (k.startsWith('arrow') && sel.size) {
    e.preventDefault(); const st = e.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -st : k === 'arrowright' ? st : 0, dy = k === 'arrowup' ? -st : k === 'arrowdown' ? st : 0;
    action(() => selObjs().forEach(o => moveObj(o, dx, dy))); return;
  }
  const map = { v: 'select', h: 'move', p: 'pen', e: 'eraser', s: 'shapes', t: 'text' };
  if (map[k]) { setTool(map[k]); if (['pen', 'eraser', 'shapes', 'text'].includes(map[k])) openPop(map[k]); else closePop(); }
});
window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; updateCursor(); } });

/* ───────── Init ───────── */
(function init() {
  try { const d = JSON.parse(localStorage.getItem('rmcanvas.wb.v1')); if (d && d.boards) load(d); } catch (e) { }
  resize(); pageSync(); syncUI(); syncZoom(); $('#toast').hidden = true; updateCursor();
  if (document.fonts) document.fonts.ready.then(() => { boards.forEach(b => b.objs.forEach(o => o.type === 'text' && measure(o))); dirty(); });
  // test hook
  window.__wb = { get boards() { return boards; }, get tool() { return tool; }, get sel() { return sel; }, S };
})();
})();
