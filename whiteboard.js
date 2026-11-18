/* =========================================================
   whiteboard.js — the drawing engine of Rishit's Canvas

   How it works (read this first):
   • Everything drawn is stored as plain objects in board.objects
     (strokes, shapes, text, geometry …). The canvas is just a picture
     of that list, so undo / redo / select / move / save are easy.
   • Each board has its own view: pan (ox, oy) and zoom (s).
       screen = world * s + (ox, oy)
   • Three stacked canvases:  backdrop  →  drawing  →  overlay (previews).
   • The eraser is a stroke that "cuts out" what is beneath it
     (destination-out), so it removes only the part you rub over.
   ========================================================= */
(function () {
  'use strict';

  const { h } = window.UI;
  const UI = window.UI;
  const ICONS = window.ICONS;
  const Geo = window.Geo;
  const $ = sel => document.querySelector(sel);
  const TAU = Math.PI * 2;
  const PX_CM = Geo.PX_PER_CM;
  const MIN_ZOOM = 0.1, MAX_ZOOM = 5;

  /* ---------------------------------------------------------
     1. DOM references
     --------------------------------------------------------- */
  const root = $('#ws-whiteboard');
  const bgCanvas = $('#bgCanvas'), drawCanvas = $('#drawCanvas'), ovCanvas = $('#overlayCanvas');
  const bgCtx = bgCanvas.getContext('2d');
  const ctx = drawCanvas.getContext('2d');
  const ov = ovCanvas.getContext('2d');
  const mctx = document.createElement('canvas').getContext('2d');   // scratch context for measuring text
  const instLayer = $('#instruments'), textLayer = $('#textLayer');
  const popover = $('#popover'), popBody = $('#popover .pop-body'), popScroll = $('#popover .pop-scroll'), popBg = $('#popover .pop-bg'), popPath = $('#popover .pop-bg path'), selBar = $('#selBar'), hintEl = $('#hint'), zoomBadge = $('#zoomBadge');
  const toolBar = $('#toolBar'), boardBar = $('#boardBar'), boardLabel = $('#boardLabel');
  const undoBtn = $('#undoBtn'), redoBtn = $('#redoBtn'), prevBtn = $('#prevBoard'), nextBtn = $('#nextBoard');

  /* ---------------------------------------------------------
     2. Options offered in the dialogs
     --------------------------------------------------------- */
  const COLORS = ['#000000', '#000455', '#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#8E24AA'];   // 8 presets + custom slot + rainbow = two full rows of 5
  const BACKDROP_COLORS = ['#FFFFFF', '#FFF8E1', '#F1F3F4', '#E3F2FD', '#E8F5E9', '#FCE4EC', '#0B0F2F', '#111111'];
  const FONTS = ['Times New Roman', 'Quicksand', 'Anta', 'Anton', 'Inter', 'Parkinsans', 'Roboto', 'Poppins', 'Montserrat', 'Raleway', 'Lato',
    'Oswald', 'Bebas Neue', 'Space Grotesk', 'Playfair Display', 'Merriweather', 'Lobster', 'Pacifico', 'Caveat', 'Dancing Script', 'Roboto Mono'];
  const PATTERNS = [
    { id: 'none', name: 'Plain', icon: 'p_none' }, { id: 'grid', name: 'Grid', icon: 'p_grid' }, { id: 'dots', name: 'Dotted', icon: 'p_dots' },
    { id: 'lines', name: 'Ruled lines', icon: 'p_lines' }, { id: 'columns', name: 'Columns', icon: 'p_columns' }, { id: 'iso', name: 'Isometric', icon: 'p_iso' }
  ];
  const SHAPES = [
    ['line', 'Line'], ['arrow', 'Arrow'], ['darrow', 'Double arrow'], ['rect', 'Rectangle'], ['square', 'Square'], ['circle', 'Circle'],
    ['ellipse', 'Ellipse'], ['triangle', 'Isosceles triangle'], ['rtriangle', 'Right triangle'], ['trapezium', 'Trapezium'],
    ['isotrap', 'Isosceles trapezium'], ['parallelogram', 'Parallelogram'], ['rhombus', 'Rhombus'], ['pentagon', 'Pentagon'],
    ['hexagon', 'Hexagon'], ['star', 'Star'], ['cross', 'Cross']
  ].map(([id, name]) => ({ id, name, icon: 'shape_' + id }));
  const LINE_STYLES = [
    { id: 'solid', name: 'Normal line', icon: 'ls_solid' }, { id: 'dashed', name: 'Dashed line', icon: 'ls_dashed' }, { id: 'dotted', name: 'Dotted line', icon: 'ls_dotted' }
  ];
  const INSTRUMENTS = [
    { id: 'ruler', label: 'Scale', icon: 'i_ruler' }, { id: 'compass', label: 'Compass', icon: 'i_compass' },
    { id: 'sq45', label: 'Set square 45°', icon: 'i_sq45' }, { id: 'sq30', label: 'Set square 30°', icon: 'i_sq30' },
    { id: 'protractor', label: 'Protractor', icon: 'i_protractor' }
  ];

  /* ---------------------------------------------------------
     3. State
     --------------------------------------------------------- */
  const state = {
    tool: 'pen',
    pen: { size: 4, color: '#000455' },
    eraser: { size: 24, mode: 'normal' },          // mode: normal | select
    select: { mode: 'free' },
    shape: { kind: 'line', size: 3, color: '#000455', dash: 'solid' },
    text: { font: 'Quicksand', size: 28, color: '#000455' },
    geo: { tool: null, tab: 'shapes' }       // tab: shapes | tools | instruments (the Geometry dialog)
  };

  const newBoard = () => ({
    objects: [], undo: [], redo: [],
    ox: 0, oy: 0, s: 1,                 // pan + zoom
    labelCount: 0,                      // next letter for geometry points (A, B, C …)
    instruments: [],
    backdrop: { color: '#FFFFFF', pattern: 'none', spacing: 32, src: null, img: null }
  });

  let boards = [newBoard()];
  let cur = 0;
  const board = () => boards[cur];

  let W = 0, H = 0, dpr = 1;
  let drag = null;                  // current pointer gesture
  let hover = null;                 // last pointer position (screen) for cursors / previews
  let sel = [];                     // selected objects
  const pointers = new Map();       // active pointers (for pinch-zoom)
  let pinch = null, ignoreUntilUp = false;
  let editor = null;                // on-canvas text editor
  let pop = { kind: null, anchor: null };
  const g = { inputs: [], pending: [] };   // geometry construction in progress

  /* ---------------------------------------------------------
     4. View helpers (pan / zoom)
     --------------------------------------------------------- */
  const toWorld = p => { const b = board(); return { x: (p.x - b.ox) / b.s, y: (p.y - b.oy) / b.s }; };
  const toScreen = p => { const b = board(); return { x: p.x * b.s + b.ox, y: p.y * b.s + b.oy }; };
  const worldView = c => { const b = board(); c.setTransform(dpr * b.s, 0, 0, dpr * b.s, b.ox * dpr, b.oy * dpr); };
  const screenView = c => c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pos = e => { const r = ovCanvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    for (const c of [bgCanvas, drawCanvas, ovCanvas]) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + 'px'; c.style.height = H + 'px';
    }
    renderAll();
  }

  /* zoom around a screen point (keeps that point still) and flash the percentage */
  function zoomAt(newScale, c) {
    finishText();
    const b = board();
    newScale = UI.clamp(newScale, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(newScale - b.s) < 1e-6) { showZoom(); return; }
    const k = newScale / b.s;
    b.ox = c.x - (c.x - b.ox) * k;
    b.oy = c.y - (c.y - b.oy) * k;
    b.s = newScale;
    showZoom();
    requestRender(true);
  }
  const zoomBy = f => zoomAt(board().s * f, { x: W / 2, y: H / 2 });

  let zoomTimer = 0;
  function showZoom() {
    zoomBadge.textContent = Math.round(board().s * 100) + '%';
    zoomBadge.classList.add('show');
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => zoomBadge.classList.remove('show'), 1300);
  }

  /* ---------------------------------------------------------
     5. Geometry maths for shapes and bounding boxes
     --------------------------------------------------------- */
  /* box between two drag points; "square" and "circle" force equal sides */
  function shapeBox(kind, a, b) {
    let bx = b.x, by = b.y;
    if (kind === 'square' || kind === 'circle') {
      const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      bx = a.x + (b.x < a.x ? -d : d); by = a.y + (b.y < a.y ? -d : d);
    }
    const x0 = Math.min(a.x, bx), y0 = Math.min(a.y, by), w = Math.abs(bx - a.x), hh = Math.abs(by - a.y);
    return { x0, y0, w, h: hh, cx: x0 + w / 2, cy: y0 + hh / 2 };
  }

  /* corner points of the polygon shapes, fitted inside the box */
  function polyPoints(kind, bx) {
    const { x0, y0, w, h: hh, cx, cy } = bx;
    const X = f => x0 + w * f, Y = f => y0 + hh * f;
    const radial = (n, start, inner) => {
      const pts = [], steps = inner ? n * 2 : n;
      for (let k = 0; k < steps; k++) {
        const a = start + (k * TAU) / steps, r = inner && k % 2 ? inner : 1;
        pts.push([cx + (w / 2) * r * Math.cos(a), cy + (hh / 2) * r * Math.sin(a)]);
      }
      return pts;
    };
    switch (kind) {
      case 'rect': case 'square': return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + hh], [x0, y0 + hh]];
      case 'triangle': return [[X(.5), y0], [x0 + w, y0 + hh], [x0, y0 + hh]];
      case 'rtriangle': return [[x0, y0], [x0, y0 + hh], [x0 + w, y0 + hh]];
      case 'trapezium': return [[X(.15), y0], [X(.65), y0], [x0 + w, y0 + hh], [x0, y0 + hh]];
      case 'isotrap': return [[X(.2), y0], [X(.8), y0], [x0 + w, y0 + hh], [x0, y0 + hh]];
      case 'parallelogram': return [[X(.25), y0], [x0 + w, y0], [X(.75), y0 + hh], [x0, y0 + hh]];
      case 'rhombus': return [[X(.5), y0], [x0 + w, Y(.5)], [X(.5), y0 + hh], [x0, Y(.5)]];
      case 'pentagon': return radial(5, -Math.PI / 2);
      case 'hexagon': return radial(6, 0);
      case 'star': return radial(5, -Math.PI / 2, 0.42);
      case 'cross': return [[X(1 / 3), y0], [X(2 / 3), y0], [X(2 / 3), Y(1 / 3)], [x0 + w, Y(1 / 3)], [x0 + w, Y(2 / 3)], [X(2 / 3), Y(2 / 3)],
        [X(2 / 3), y0 + hh], [X(1 / 3), y0 + hh], [X(1 / 3), Y(2 / 3)], [x0, Y(2 / 3)], [x0, Y(1 / 3)], [X(1 / 3), Y(1 / 3)]];
      default: return [];
    }
  }

  const fontCss = n => (n === 'Times New Roman' ? '"Times New Roman", Times, serif' : `"${n}", sans-serif`);
  const loadedFonts = new Set();
  /* canvas can't draw a web font before it has loaded, so load it then redraw */
  function ensureFont(name, size) {
    if (name === 'Times New Roman' || loadedFonts.has(name)) return;
    loadedFonts.add(name);
    document.fonts.load(`${size || 16}px "${name}"`).then(() => requestRender()).catch(() => {});
  }

  function measureText(o) {
    mctx.font = `${o.size}px ${fontCss(o.font)}`;
    const lines = o.text.split('\n');
    return { w: Math.max(...lines.map(l => mctx.measureText(l).width)), h: lines.length * o.size * 1.25, lines };
  }

  /* dash pattern for the three line styles */
  function setDash(c, dash, size) {
    const s = Math.max(size || 2, 1);
    if (dash === 'dashed') c.setLineDash([s * 4, s * 2.5]);
    else if (dash === 'dotted') c.setLineDash([0.1, s * 2.2]);
    else c.setLineDash([]);
  }

  function arrowHead(c, from, to, size) {
    const a = Math.atan2(to.y - from.y, to.x - from.x), L = Math.max(12, size * 4.5), sp = 0.45;
    c.beginPath();
    c.moveTo(to.x - L * Math.cos(a - sp), to.y - L * Math.sin(a - sp));
    c.lineTo(to.x, to.y);
    c.lineTo(to.x - L * Math.cos(a + sp), to.y - L * Math.sin(a + sp));
    c.stroke();
  }

  /* ---------------------------------------------------------
     6. Drawing one object (used for the real canvas AND previews)
     --------------------------------------------------------- */
  const imgCache = new Map();                       // loaded <img> elements, by data URL
  function getImage(src) {
    let im = imgCache.get(src);
    if (!im) { im = new Image(); im.onload = () => requestRender(); im.src = src; imgCache.set(src, im); }
    return im;
  }

  function drawObject(c, o) {
    c.save();
    c.globalCompositeOperation = o.erase ? 'destination-out' : 'source-over';
    if (o.hidden) c.globalAlpha = 0.25;              // hidden objects only show (faintly) while the Show/Hide tool is active
    c.strokeStyle = c.fillStyle = o.color || '#000';
    c.lineWidth = o.size || 2;
    c.lineCap = 'round'; c.lineJoin = 'round';
    setDash(c, o.dash, o.size);

    switch (o.type) {
      case 'stroke': {
        const p = o.pts;
        if (p.length === 1) { c.beginPath(); c.arc(p[0].x, p[0].y, o.size / 2, 0, TAU); c.fill(); break; }
        c.beginPath(); c.moveTo(p[0].x, p[0].y);
        for (let i = 1; i < p.length; i++) c.lineTo(p[i].x, p[i].y);
        c.stroke();
        break;
      }
      case 'shape': drawShape(c, o); break;
      case 'text': {
        ensureFont(o.font, o.size);
        c.font = `${o.size}px ${fontCss(o.font)}`;
        c.textBaseline = 'middle'; c.textAlign = 'left';
        const lh = o.size * 1.25;
        o.text.split('\n').forEach((line, i) => c.fillText(line, o.x, o.y + lh / 2 + i * lh));
        break;
      }
      case 'dot': {
        // points and their labels keep the same size ON SCREEN at every zoom level, so they stay readable when zoomed out
        const k = 1 / board().s;
        c.beginPath(); c.arc(o.x, o.y, (Math.max(4, o.size) - .5) * k, 0, TAU);
        c.fill(); c.lineWidth = 1.5 * k; c.strokeStyle = '#fff'; c.stroke();
        if (o.label && !o.labelHidden) {
          ensureFont('Quicksand', 16);
          c.font = `700 ${16 * k}px Quicksand, sans-serif`; c.textBaseline = 'alphabetic';
          c.lineWidth = 3.5 * k; c.strokeStyle = 'rgba(255,255,255,.9)'; c.strokeText(o.label, o.x + 8 * k, o.y - 9 * k);   // white halo
          c.fillStyle = o.color; c.fillText(o.label, o.x + 8 * k, o.y - 9 * k);
        }
        break;
      }
      case 'seg': {
        const d = { x: o.b.x - o.a.x, y: o.b.y - o.a.y }, L = Math.hypot(d.x, d.y) || 1, BIG = 1e5;
        const u = { x: d.x / L, y: d.y / L };
        const p1 = o.ext === 'line' ? { x: o.a.x - u.x * BIG, y: o.a.y - u.y * BIG } : o.a;
        const p2 = o.ext === 'none' ? o.b : { x: o.b.x + u.x * BIG, y: o.b.y + u.y * BIG };
        c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke();
        if (o.arrow) { c.setLineDash([]); arrowHead(c, o.a, o.b, o.size); }      // vectors have an arrow head
        break;
      }
      case 'circle': c.beginPath(); c.arc(o.cx, o.cy, Math.max(o.r, .1), 0, TAU); c.stroke(); break;
      case 'arc': c.beginPath(); c.arc(o.cx, o.cy, Math.max(o.r, .1), o.a0, o.a1, !!o.ccw); c.stroke(); break;
      case 'sector': {
        c.beginPath(); c.moveTo(o.cx, o.cy); c.arc(o.cx, o.cy, Math.max(o.r, .1), o.a0, o.a1, !!o.ccw); c.closePath();
        const a = c.globalAlpha; c.globalAlpha = a * 0.08; c.fill(); c.globalAlpha = a; c.stroke();
        break;
      }
      case 'curve': {                                                              // ellipse, hyperbola, parabola, polyline
        c.beginPath();
        o.paths.forEach(pp => { pp.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); if (o.closed) c.closePath(); });
        c.stroke();
        break;
      }
      case 'image': { const im = getImage(o.src); if (im.complete && im.naturalWidth) c.drawImage(im, o.x, o.y, o.w, o.h); break; }
      case 'poly': {
        c.beginPath(); o.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath();
        c.globalAlpha = 0.08; c.fill(); c.globalAlpha = 1; c.stroke();
        break;
      }
      case 'label': {
        const k = 1 / board().s;                                   // labels also keep their on-screen size
        ensureFont('Quicksand', o.fs);
        c.font = `700 ${o.fs * k}px Quicksand, sans-serif`; c.textBaseline = 'alphabetic';
        c.fillText(o.text, o.x, o.y);
        break;
      }
    }
    c.restore();
  }

  function drawShape(c, o) {
    const { kind, a, b } = o;
    if (kind === 'line' || kind === 'arrow' || kind === 'darrow') {
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      if (kind !== 'line') {
        c.setLineDash([]);
        arrowHead(c, a, b, o.size);
        if (kind === 'darrow') arrowHead(c, b, a, o.size);
      }
      return;
    }
    const bx = shapeBox(kind, a, b);
    c.beginPath();
    if (kind === 'ellipse' || kind === 'circle') {
      c.ellipse(bx.cx, bx.cy, Math.max(bx.w / 2, .1), Math.max(bx.h / 2, .1), 0, 0, TAU);
    } else {
      polyPoints(kind, bx).forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
    }
    c.stroke();
  }

  /* ---------------------------------------------------------
     7. Bounding boxes, key points and translation (for Select)
     --------------------------------------------------------- */
  function bboxOf(o) {
    const box = (xs, ys, pad = 0) => ({ x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad });
    switch (o.type) {
      case 'stroke': return box(o.pts.map(p => p.x), o.pts.map(p => p.y), o.size / 2);
      case 'shape': {
        if (['line', 'arrow', 'darrow'].includes(o.kind)) return box([o.a.x, o.b.x], [o.a.y, o.b.y], o.size + 4);
        const b = shapeBox(o.kind, o.a, o.b);
        return { x0: b.x0 - o.size / 2, y0: b.y0 - o.size / 2, x1: b.x0 + b.w + o.size / 2, y1: b.y0 + b.h + o.size / 2 };
      }
      case 'text': { const m = measureText(o); return { x0: o.x, y0: o.y, x1: o.x + m.w, y1: o.y + m.h }; }
      case 'dot': return box([o.x], [o.y], 9);
      case 'seg': return box([o.a.x, o.b.x], [o.a.y, o.b.y], 3);
      case 'circle': case 'arc': case 'sector': return box([o.cx - o.r, o.cx + o.r], [o.cy - o.r, o.cy + o.r], 2);
      case 'curve': { const xs = [], ys = []; o.paths.forEach(pp => pp.forEach(p => { xs.push(p.x); ys.push(p.y); })); return box(xs, ys, 2); }
      case 'image': return { x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h };
      case 'poly': return box(o.pts.map(p => p.x), o.pts.map(p => p.y), 2);
      case 'label': return { x0: o.x, y0: o.y - o.fs, x1: o.x + o.text.length * o.fs * 0.62, y1: o.y + 4 };
    }
    return { x0: 0, y0: 0, x1: 0, y1: 0 };
  }

  /* a few representative points of an object — if any lies inside the selection area, it is selected */
  function keyPoints(o) {
    const b = bboxOf(o);
    const centre = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    switch (o.type) {
      case 'stroke': return o.pts;
      case 'curve': return o.paths.flat();
      case 'seg': return [o.a, o.b, { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 }];
      case 'poly': return [...o.pts, centre];
      case 'shape': return [o.a, o.b, centre];
      default: return [centre, { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }];
    }
  }

  function translateObj(o, dx, dy) {
    const n = JSON.parse(JSON.stringify(o));
    const mv = p => { p.x += dx; p.y += dy; };
    switch (n.type) {
      case 'stroke': case 'poly': n.pts.forEach(mv); break;
      case 'shape': case 'seg': mv(n.a); mv(n.b); break;
      case 'text': case 'dot': case 'label': case 'image': mv(n); break;
      case 'curve': n.paths.forEach(pp => pp.forEach(mv)); break;
      case 'circle': case 'arc': case 'sector': n.cx += dx; n.cy += dy; break;
    }
    return n;
  }

  function pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  /* ---------------------------------------------------------
     8. Rendering
     --------------------------------------------------------- */
  let raf = 0, bgDirty = false;
  /* batches many requests into one redraw per frame */
  function requestRender(withBackdrop) {
    if (withBackdrop) bgDirty = true;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (bgDirty) { renderBackdrop(); bgDirty = false; }
      renderMain(); renderOverlay();
    });
  }
  let rafOv = 0;
  function requestOverlay() {
    if (rafOv) return;
    rafOv = requestAnimationFrame(() => { rafOv = 0; renderOverlay(); });
  }
  function renderAll() { renderBackdrop(); renderMain(); renderOverlay(); }

  function renderBackdrop() {
    const b = board(), bd = b.backdrop, c = bgCtx;
    screenView(c);
    c.clearRect(0, 0, W, H);
    c.fillStyle = bd.color; c.fillRect(0, 0, W, H);
    if (bd.img && bd.img.complete && bd.img.naturalWidth) {        // image "cover" fit
      const k = Math.max(W / bd.img.naturalWidth, H / bd.img.naturalHeight);
      const iw = bd.img.naturalWidth * k, ih = bd.img.naturalHeight * k;
      c.drawImage(bd.img, (W - iw) / 2, (H - ih) / 2, iw, ih);
    }
    const sp = bd.spacing * b.s;                                   // pattern follows pan + zoom
    if (bd.pattern !== 'none' && sp >= 6) drawPattern(c, bd.pattern, sp, b.ox, b.oy, bd.color);
  }

  function drawPattern(c, pattern, sp, ox, oy, bg) {
    const light = UI.luminance(bg) > 0.5;
    c.strokeStyle = c.fillStyle = light ? 'rgba(0,4,85,0.20)' : 'rgba(255,255,255,0.24)';
    c.lineWidth = 1;
    const x0 = ((ox % sp) + sp) % sp, y0 = ((oy % sp) + sp) % sp;
    const line = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
    if (pattern === 'grid' || pattern === 'columns') for (let x = x0; x < W; x += sp) line(x, 0, x, H);
    if (pattern === 'grid' || pattern === 'lines') for (let y = y0; y < H; y += sp) line(0, y, W, y);
    if (pattern === 'dots') {
      for (let x = x0; x < W; x += sp) for (let y = y0; y < H; y += sp) { c.beginPath(); c.arc(x, y, 1.4, 0, TAU); c.fill(); }
    }
    if (pattern === 'iso') {
      const hs = sp * 0.866, ys = ((oy % hs) + hs) % hs, dx = H / Math.sqrt(3);
      for (let y = ys; y < H; y += hs) line(0, y, W, y);
      for (let t = x0 - dx - sp; t < W + dx; t += sp) { line(t, 0, t + dx, H); line(t + dx, 0, t, H); }
    }
  }

  function renderMain() {
    const b = board();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    worldView(ctx);
    const showHidden = state.tool === 'tools' && state.geo.tool === 'hide';
    for (const o of b.objects) {
      if (o.hidden && !showHidden) continue;
      const moved = drag && drag.type === 'move' && sel.includes(o);
      if (moved) { ctx.save(); ctx.translate(drag.dx, drag.dy); }
      drawObject(ctx, o);
      if (moved) ctx.restore();
    }
    updateSelBar();
  }

  /* previews: shape being dragged, lasso, selection box, geometry construction, eraser cursor, compass arc */
  function renderOverlay() {
    const b = board(), px = 1 / b.s;
    ov.setTransform(1, 0, 0, 1, 0, 0);
    ov.clearRect(0, 0, ovCanvas.width, ovCanvas.height);
    worldView(ov);

    // shape preview
    if (drag && drag.type === 'shape') {
      drawObject(ov, { type: 'shape', kind: state.shape.kind, a: drag.a, b: drag.b, color: state.shape.color, size: state.shape.size, dash: state.shape.dash });
    }

    // selection area (only a dotted trail for free-form)
    if (drag && drag.type === 'region') {
      ov.save();
      ov.strokeStyle = '#000455'; ov.lineWidth = 2 * px; ov.lineCap = 'round'; ov.setLineDash([0.1, 6 * px]);
      ov.beginPath();
      if (drag.mode === 'free') drag.pts.forEach((p, i) => (i ? ov.lineTo(p.x, p.y) : ov.moveTo(p.x, p.y)));
      else if (drag.mode === 'rect') ov.rect(drag.start.x, drag.start.y, drag.cur.x - drag.start.x, drag.cur.y - drag.start.y);
      else ov.ellipse((drag.start.x + drag.cur.x) / 2, (drag.start.y + drag.cur.y) / 2, Math.abs(drag.cur.x - drag.start.x) / 2, Math.abs(drag.cur.y - drag.start.y) / 2, 0, 0, TAU);
      ov.stroke(); ov.restore();
    }

    // box around the selected objects
    if (sel.length) {
      const bb = selBox(true);
      ov.save();
      ov.strokeStyle = '#000455'; ov.lineWidth = 1.5 * px; ov.setLineDash([6 * px, 4 * px]);
      ov.strokeRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
      ov.restore();
    }

    if (state.tool === 'tools' && state.geo.tool) drawGeoPreview();

    // things in screen space (not zoomed)
    screenView(ov);
    if (state.tool === 'eraser' && state.eraser.mode === 'normal' && hover) {
      ov.save();
      ov.beginPath(); ov.arc(hover.x, hover.y, (state.eraser.size * b.s) / 2, 0, TAU);
      ov.fillStyle = 'rgba(255,255,255,.45)'; ov.fill();
      ov.strokeStyle = '#000455'; ov.lineWidth = 1.5; ov.stroke();
      ov.restore();
    }
    for (const inst of b.instruments) {                       // compass arc being drawn
      if (inst.type === 'compass' && inst.preview) {
        ov.save();
        ov.strokeStyle = state.pen.color; ov.lineWidth = state.pen.size * b.s; ov.lineCap = 'round';
        ov.beginPath(); ov.arc(inst.x, inst.y, inst.r, inst.preview.a0, inst.preview.a1, inst.preview.a1 < inst.preview.a0);
        ov.stroke(); ov.restore();
      }
    }
  }

  /* ---------------------------------------------------------
     9. History (undo / redo) and board bar
     --------------------------------------------------------- */
  function commit(newObjects, redraw = true) {
    const b = board();
    b.undo.push(b.objects);
    if (b.undo.length > 300) b.undo.shift();
    b.objects = newObjects;
    b.redo = [];
    clearSel();
    if (redraw) requestRender();
    updateBoardUI();
  }
  function undo() {
    const b = board(); if (!b.undo.length) return;
    finishText(); resetGeo();
    b.redo.push(b.objects); b.objects = b.undo.pop();
    clearSel(); requestRender(); updateBoardUI();
  }
  function redo() {
    const b = board(); if (!b.redo.length) return;
    b.undo.push(b.objects); b.objects = b.redo.pop();
    clearSel(); requestRender(); updateBoardUI();
  }
  function updateBoardUI() {
    const b = board();
    boardLabel.textContent = `Board ${cur + 1} of ${boards.length}`;
    prevBtn.disabled = cur === 0;
    nextBtn.disabled = cur === boards.length - 1;
    undoBtn.disabled = !b.undo.length;
    redoBtn.disabled = !b.redo.length;
  }
  function switchBoard(i) {
    if (i < 0 || i >= boards.length) return;
    finishText(); resetGeo(); clearSel(); closePopover();
    cur = i;
    renderInstruments(); renderAll(); updateBoardUI();
  }
  function addBoard() { boards.push(newBoard()); switchBoard(boards.length - 1); }
  async function deleteBoard() {
    const ok = await UI.confirm({
      title: `Delete Board ${cur + 1}?`,
      message: boards.length > 1 ? 'This board and everything on it will be removed.' : 'This is the only board, so it will be reset to a blank board.',
      okText: 'Delete'
    });
    if (!ok) return;
    if (boards.length === 1) boards[0] = newBoard();
    else { boards.splice(cur, 1); cur = Math.min(cur, boards.length - 1); }
    clearSel(); renderInstruments(); renderAll(); updateBoardUI();
  }
  async function confirmClear() {
    closePopover();
    const ok = await UI.confirm({ title: 'Clear this board?', message: 'Everything drawn on this board will be removed. You can still undo it afterwards.', okText: 'Clear' });
    if (ok) { finishText(); resetGeo(); commit([]); }
  }

  /* ---------------------------------------------------------
     10. Selection
     --------------------------------------------------------- */
  function clearSel() { sel = []; selBar.classList.remove('show'); }

  /* bounding box of the selection (optionally shifted by an ongoing move) */
  function selBox(withDrag) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of sel) {
      const b = bboxOf(o);
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    const pad = 6 / board().s;
    const dx = withDrag && drag && drag.type === 'move' ? drag.dx : 0, dy = withDrag && drag && drag.type === 'move' ? drag.dy : 0;
    return { x0: x0 - pad + dx, y0: y0 - pad + dy, x1: x1 + pad + dx, y1: y1 + pad + dy };
  }

  function updateSelBar() {
    if (!sel.length || (drag && drag.type === 'move')) { selBar.classList.remove('show'); return; }
    const bb = selBox(false), b = board();
    const sx0 = bb.x0 * b.s + b.ox, sx1 = bb.x1 * b.s + b.ox, sy0 = bb.y0 * b.s + b.oy, sy1 = bb.y1 * b.s + b.oy;
    let x = (sx0 + sx1) / 2 - 48, y = sy0 - 58;
    if (y < 70) y = sy1 + 12;
    x = UI.clamp(x, 8, W - 104); y = UI.clamp(y, 8, H - 140);
    selBar.style.left = x + 'px'; selBar.style.top = y + 'px';
    selBar.classList.add('show');
  }

  function selectInRegion(region) {
    const b = board();
    let inside;
    if (region.mode === 'free') {
      if (region.pts.length < 3) return [];
      inside = p => pointInPoly(p, region.pts);
    } else {
      const x0 = Math.min(region.start.x, region.cur.x), x1 = Math.max(region.start.x, region.cur.x);
      const y0 = Math.min(region.start.y, region.cur.y), y1 = Math.max(region.start.y, region.cur.y);
      if (region.mode === 'rect') inside = p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      else {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 || 1, ry = (y1 - y0) / 2 || 1;
        inside = p => ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1;
      }
    }
    return b.objects.filter(o => !o.erase && keyPoints(o).some(inside));
  }

  function deleteSelection() {
    if (!sel.length) return;
    const gone = new Set(sel);
    commit(board().objects.filter(o => !gone.has(o)));
  }
  function duplicateSelection() {
    if (!sel.length) return;
    const copies = sel.map(o => translateObj(o, 24 / board().s, 24 / board().s));
    commit([...board().objects, ...copies]);
    sel = copies; requestRender();
  }

  /* ---------------------------------------------------------
     11. Pointer handling
     --------------------------------------------------------- */
  function setCursor() {
    const c = { pen: 'crosshair', eraser: state.eraser.mode === 'normal' ? 'none' : 'crosshair', move: 'grab', select: 'crosshair', shapes: 'crosshair', text: 'text', backdrop: 'default', tools: state.geo.tool ? 'crosshair' : 'default' };
    ovCanvas.style.cursor = c[state.tool] || 'default';
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    closePopover(); finishText();
    ovCanvas.setPointerCapture(e.pointerId);
    const s = pos(e);
    pointers.set(e.pointerId, s);
    if (pointers.size === 2) { startPinch(); return; }       // two fingers → zoom
    if (pointers.size > 2 || ignoreUntilUp) return;
    hover = s;
    const w = toWorld(s), b = board();

    switch (state.tool) {
      case 'pen': startStroke(w); break;
      case 'eraser':                                         // normal eraser rubs out; "select & erase" draws a loop
        if (state.eraser.mode === 'select') drag = { type: 'region', mode: 'free', start: w, cur: w, pts: [w], erase: true };
        else startStroke(w);
        break;
      case 'backdrop': break;                                // the Backdrop tool only opens its dialog
      case 'move': drag = { type: 'pan', sx: s.x, sy: s.y, ox: b.ox, oy: b.oy }; ovCanvas.style.cursor = 'grabbing'; break;
      case 'select': selectDown(w); break;
      case 'shapes': drag = { type: 'shape', a: w, b: w }; break;
      case 'text': drag = { type: 'text' }; break;
      case 'tools': geoDown(w); break;
    }
  }

  function onMove(e) {
    const s = pos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, s);
    if (pinch) { doPinch(); return; }
    if (ignoreUntilUp) return;
    hover = s;
    const w = toWorld(s), b = board();
    if (!drag) { if (state.tool === 'eraser' || (state.tool === 'tools' && state.geo.tool)) requestOverlay(); return; }

    switch (drag.type) {
      case 'stroke': {
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const ev of events.length ? events : [e]) {
          const p = toWorld(pos(ev)), last = drag.obj.pts[drag.obj.pts.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) * b.s < 1) continue;       // skip tiny moves
          drag.obj.pts.push(p);
          drawStrokeSegment(drag.obj, drag.obj.pts.length - 1);
        }
        requestOverlay();
        break;
      }
      case 'pan': b.ox = drag.ox + (s.x - drag.sx); b.oy = drag.oy + (s.y - drag.sy); requestRender(true); break;
      case 'shape': drag.b = w; requestOverlay(); break;
      case 'region': if (drag.mode === 'free') drag.pts.push(w); else drag.cur = w; requestOverlay(); break;
      case 'move': drag.dx = w.x - drag.start.x; drag.dy = w.y - drag.start.y; requestRender(); break;
    }
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; if (pointers.size === 0) ignoreUntilUp = false; return; }
    if (ignoreUntilUp) { if (pointers.size === 0) ignoreUntilUp = false; return; }
    const s = pos(e), w = toWorld(s), b = board();
    const d = drag; drag = null;
    if (state.tool === 'move') setCursor();
    if (!d) return;

    switch (d.type) {
      case 'stroke': commit([...b.objects, d.obj], false); break;      // already drawn incrementally
      case 'shape':
        if (Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) * b.s > 3) {
          commit([...b.objects, { type: 'shape', kind: state.shape.kind, a: d.a, b: d.b, color: state.shape.color, size: state.shape.size, dash: state.shape.dash }]);
        } else requestOverlay();
        break;
      case 'region': {
        if (d.erase) {                                       // select & erase: delete everything inside the loop
          const gone = new Set(selectInRegion(d));
          if (gone.size) commit(b.objects.filter(o => !gone.has(o))); else requestRender();
          break;
        }
        sel = Math.hypot((d.cur || d.pts[d.pts.length - 1]).x - d.start.x, (d.cur || d.pts[d.pts.length - 1]).y - d.start.y) * b.s < 4 && d.mode !== 'free' ? [] : selectInRegion(d);
        requestRender();
        break;
      }
      case 'move': {
        if (Math.abs(d.dx) + Math.abs(d.dy) > 0.5) {
          const moving = new Set(sel);
          const map = new Map();
          const next = b.objects.map(o => { if (!moving.has(o)) return o; const n = translateObj(o, d.dx, d.dy); map.set(o, n); return n; });
          commit(next);
          sel = [...map.values()];
        }
        requestRender();
        break;
      }
      case 'text': openTextEditor(s, w); break;
    }
  }

  function onCancel(e) {
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) pinch = null;
    if (drag) cancelDrag();
    if (pointers.size === 0) ignoreUntilUp = false;
  }

  /* throw away an unfinished gesture (used when a second finger lands) */
  function cancelDrag() {
    const wasStroke = drag && drag.type === 'stroke';
    drag = null;
    if (wasStroke) requestRender();
    requestOverlay();
  }

  /* ----- pinch-zoom with two fingers ----- */
  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  function startPinch() { cancelDrag(); const i = pinchInfo(); pinch = { d: i.d, mid: i.mid, s: board().s }; ignoreUntilUp = true; }
  function doPinch() {
    if (pointers.size < 2) return;
    const i = pinchInfo(), b = board();
    b.ox += i.mid.x - pinch.mid.x; b.oy += i.mid.y - pinch.mid.y;     // two-finger pan
    zoomAt(pinch.s * (i.d / pinch.d), i.mid);
    pinch.mid = i.mid;
  }

  /* ----- pen & eraser strokes ----- */
  function startStroke(w) {
    const er = state.tool === 'eraser';
    drag = { type: 'stroke', obj: { type: 'stroke', erase: er, color: er ? '#000' : state.pen.color, size: er ? state.eraser.size : state.pen.size, pts: [w] } };
    drawStrokeSegment(drag.obj, 0);
  }
  /* draws just the newest piece of a stroke straight onto the canvas (fast) */
  function drawStrokeSegment(o, i) {
    ctx.save();
    worldView(ctx);
    ctx.globalCompositeOperation = o.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = o.color;
    ctx.lineWidth = o.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const p = o.pts[i];
    if (i === 0) { ctx.beginPath(); ctx.arc(p.x, p.y, o.size / 2, 0, TAU); ctx.fill(); }
    else { const q = o.pts[i - 1]; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    ctx.restore();
  }

  /* ----- select tool ----- */
  function selectDown(w) {
    if (sel.length) {
      const bb = selBox(false);
      if (w.x >= bb.x0 && w.x <= bb.x1 && w.y >= bb.y0 && w.y <= bb.y1) {       // grab the selection to move it
        drag = { type: 'move', start: w, dx: 0, dy: 0 };
        selBar.classList.remove('show');
        return;
      }
      clearSel(); requestRender();
    }
    drag = { type: 'region', mode: state.select.mode, start: w, cur: w, pts: [w] };
  }

  /* ---------------------------------------------------------
     12. Text tool
     --------------------------------------------------------- */
  function openTextEditor(s, w) {
    finishText();
    const t = state.text, b = board();
    ensureFont(t.font, t.size);
    const ta = h('textarea', { class: 'text-editor', rows: 1, spellcheck: 'false', 'aria-label': 'Text' });
    Object.assign(ta.style, { left: s.x + 'px', top: s.y + 'px', font: `${t.size * b.s}px ${fontCss(t.font)}`, color: t.color, lineHeight: '1.25' });
    const fit = () => {                                        // grow with the text
      const m = measureText({ text: ta.value || ' ', font: t.font, size: t.size * b.s });
      ta.style.width = Math.max(40, m.w + t.size * b.s) + 'px';
      ta.style.height = Math.max(1, m.lines.length) * t.size * b.s * 1.25 + 'px';
    };
    ta.addEventListener('input', fit);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { ta.value = ''; finishText(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finishText();
      e.stopPropagation();
    });
    ta.addEventListener('blur', finishText);
    textLayer.append(ta);
    editor = { ta, w, font: t.font, size: t.size, color: t.color, done: false };
    fit();
    setTimeout(() => ta.focus(), 0);
  }
  function finishText() {
    if (!editor || editor.done) return;
    editor.done = true;
    const { ta, w, font, size, color } = editor;
    editor = null;
    const text = ta.value.replace(/\s+$/, '');
    ta.remove();
    if (text.trim()) commit([...board().objects, { type: 'text', x: w.x, y: w.y, text, font, size, color }]);
  }

  /* ---------------------------------------------------------
     13. Geometry construction (Tools → geometry tools)
     --------------------------------------------------------- */
  function resetGeo() { g.inputs = []; g.pending = []; requestOverlay(); }
  const nextLabel = () => Geo.labelFor(board().labelCount++);

  function allDots() { return [...board().objects.filter(o => o.type === 'dot'), ...g.pending]; }
  function snapDot(w) {
    const r = 14 / board().s;
    let best = null, bd = r;
    for (const d of allDots()) { const dist = Math.hypot(d.x - w.x, d.y - w.y); if (dist <= bd) { best = d; bd = dist; } }
    return best;
  }
  function hitLine(w) {
    const r = 10 / board().s;
    let best = null, bd = r;
    for (const o of board().objects) {
      if (o.type !== 'seg') continue;
      const d = Geo.distToLine(w, o);
      if (d <= bd) { best = o; bd = d; }
    }
    return best;
  }
  const currentStep = () => { const t = Geo.byId[state.geo.tool]; return t ? (t.variable ? 'pt' : t.steps[g.inputs.length]) : null; };

  function geoDown(w) {
    const tool = Geo.byId[state.geo.tool];
    if (!tool || g.busy) return;     // ignore clicks while the number dialog is open
    const step = currentStep();
    if (step === 'pt') {
      let dot = snapDot(w);
      if (!dot) {
        dot = { type: 'dot', x: w.x, y: w.y, size: 5, color: Geo.NAVY, label: nextLabel() };
        g.pending.push(dot);
      }
      const last = g.inputs[g.inputs.length - 1];
      if (last && last.dot === dot) return;                                   // ignore double-click on the same point
      if (tool.variable && g.inputs.length >= 3 && dot === g.inputs[0].dot) { finishGeo(); return; }   // polygon closed
      g.inputs.push({ x: dot.x, y: dot.y, dot });
    } else if (step === 'line') {
      const l = hitLine(w);
      if (!l) return;
      g.inputs.push({ line: l });
    }
    if (!tool.variable && g.inputs.length === tool.steps.length) finishGeo();
    else requestOverlay();
  }

  /* Builds the construction from the clicked inputs. Tools with an "ask" (segment length, circle radius, angle,
     rotation, dilation, number of vertices …) first show a small number dialog, like GeoGebra / Desmos do. */
  async function finishGeo() {
    const tool = Geo.byId[state.geo.tool];
    if (!tool || g.busy) return;
    const inputs = g.inputs.map(i => (i.line ? { a: i.line.a, b: i.line.b, ext: i.line.ext } : { x: i.x, y: i.y }));
    const pending = g.pending;
    let val;
    if (tool.ask) {
      g.busy = true;
      val = await UI.prompt({ title: tool.ask.title, label: tool.ask.label, value: tool.ask.def, unit: tool.ask.unit, integer: tool.ask.integer, min: tool.ask.min, max: tool.ask.max });
      g.busy = false;
      if (val == null) { g.inputs = []; g.pending = []; requestOverlay(); return; }     // cancelled: nothing is drawn
    }
    const built = tool.build(inputs, { label: nextLabel, val });
    g.inputs = []; g.pending = [];
    if (built.length || pending.length) commit([...board().objects, ...built, ...pending]);
    else requestOverlay();
  }

  function drawGeoPreview() {
    const b = board(), px = 1 / b.s, tool = Geo.byId[state.geo.tool];
    ov.save();
    g.pending.forEach(d => drawObject(ov, d));
    if (hover) {
      const w = toWorld(hover), step = currentStep();
      ov.strokeStyle = '#000455'; ov.fillStyle = '#000455';
      if (step === 'pt') {
        const snap = snapDot(w), tip = snap || w;
        // rubber band from the last chosen point
        const last = g.inputs[g.inputs.length - 1];
        ov.lineWidth = 1.5 * px; ov.setLineDash([5 * px, 4 * px]); ov.globalAlpha = 0.7;
        if (tool.variable && g.inputs.length) {
          ov.beginPath(); g.inputs.forEach((p, i) => (i ? ov.lineTo(p.x, p.y) : ov.moveTo(p.x, p.y))); ov.lineTo(tip.x, tip.y); ov.stroke();
        } else if (last && last.dot) {
          ov.beginPath(); ov.moveTo(last.x, last.y); ov.lineTo(tip.x, tip.y); ov.stroke();
        }
        ov.setLineDash([]); ov.globalAlpha = snap ? 1 : 0.45;
        ov.beginPath(); ov.arc(tip.x, tip.y, snap ? 9 * px : 4.5 * px, 0, TAU);
        if (snap) ov.stroke(); else ov.fill();
      } else if (step === 'line') {
        const l = hitLine(w);
        if (l) { ov.globalAlpha = 0.35; drawObject(ov, { ...l, color: '#1E88E5', size: 7 * px, dash: 'solid' }); }
      }
    }
    ov.restore();
  }

  /* ---------------------------------------------------------
     14. Instruments: scale, compass, set squares, protractor
     Instruments live on the screen (they do not zoom). Only their small
     round handles take the mouse, so you can draw right along their edges.
     --------------------------------------------------------- */
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  /* Snapping: instruments click onto points made with the geometry tools.
     "keys" are the instrument's own key points (corners, centre …); if one comes within SNAP px of a point,
     the whole instrument is nudged so that the two coincide. */
  const SNAP = 16;
  const dotsOnScreen = () => board().objects.filter(o => o.type === 'dot').map(o => toScreen(o));
  function nearestDot(p) {
    let best = null, bd = SNAP;
    for (const d of dotsOnScreen()) { const k = Math.hypot(d.x - p.x, d.y - p.y); if (k <= bd) { best = d; bd = k; } }
    return best;
  }
  /* shifts (inst.x, inst.y) so the closest key point lands exactly on a nearby point; keys are in the instrument's local pixels */
  function snapInstrument(inst, keys) {
    const c = Math.cos(inst.rot || 0), s = Math.sin(inst.rot || 0);
    let best = null, bd = SNAP;
    for (const k of keys) {
      const p = { x: inst.x + k.x * c - k.y * s, y: inst.y + k.x * s + k.y * c };
      const d = nearestDot(p);
      if (d) { const dist = Math.hypot(d.x - p.x, d.y - p.y); if (dist <= bd) { bd = dist; best = { dx: d.x - p.x, dy: d.y - p.y }; } }
    }
    if (best) { inst.x += best.dx; inst.y += best.dy; }
  }

  /* generic drag helper for a handle element */
  function makeDrag(el, { down, move, up }) {
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const st = down(e) || {};
      const mv = ev => move && move(ev, st);
      const fin = ev => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', fin); el.removeEventListener('pointercancel', fin);
        up && up(ev, st);
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);
    });
  }
  const handle = (icon, title, x, y, small) => h('button', { class: 'handle' + (small ? ' small' : ''), type: 'button', title, html: ICONS[icon], style: { left: x + 'px', top: y + 'px' } });

  /* the SVG artwork + handle positions for each straight-edged instrument (local pixel units) */
  const INST = {
    ruler() {
      const cm = Math.max(5, Math.min(15, Math.floor((W - 80) / PX_CM))), L = cm * PX_CM, Hh = 58;
      let t = '';
      for (let mm = 0; mm <= cm * 10; mm++) {
        const x = (mm * PX_CM) / 10, len = mm % 10 === 0 ? 18 : mm % 5 === 0 ? 13 : 8;
        t += `<line x1="${x}" y1="0" x2="${x}" y2="${len}"/>`;
        if (mm % 10 === 0 && mm > 0 && mm < cm * 10) t += `<text x="${x}" y="33" text-anchor="middle" stroke="none" fill="#000455" font-size="11" font-family="Anta, sans-serif">${mm / 10}</text>`;
      }
      return { svg: `<svg width="${L}" height="${Hh}"><rect width="${L}" height="${Hh}" rx="4" fill="rgba(224,226,255,.72)" stroke="#000455" stroke-width="1.5"/><g stroke="#000455" stroke-width="1">${t}</g></svg>`,
        keys: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: 0, y: Hh }, { x: L, y: Hh }], ox: 0, oy: 0, grip: { x: L / 2, y: Hh - 15 }, rot: { x: L - 20, y: Hh - 15 }, del: { x: 20, y: Hh - 15 } };
    },
    sq45() {
      const L = Math.min(260, W - 90);
      const outer = `M0 0 L0 ${L} L${L} ${L} Z`;
      const inner = `M${.15 * L} ${.4 * L} L${.15 * L} ${.85 * L} L${.6 * L} ${.85 * L} Z`;
      let t = ''; for (let k = 1; k * PX_CM < L; k++) t += `<line x1="${k * PX_CM}" y1="${L}" x2="${k * PX_CM}" y2="${L - (k % 5 ? 8 : 14)}"/>`;
      return { svg: `<svg width="${L}" height="${L}"><path d="${outer} ${inner}" fill-rule="evenodd" fill="rgba(224,226,255,.72)" stroke="#000455" stroke-width="1.5"/><g stroke="#000455">${t}</g></svg>`,
        keys: [{ x: 0, y: 0 }, { x: 0, y: L }, { x: L, y: L }], ox: 0, oy: 0, grip: { x: .3 * L, y: .68 * L }, rot: { x: .78 * L, y: .92 * L }, del: { x: .07 * L, y: .22 * L } };
    },
    sq30() {
      let Hh = 200, Wd = Hh * Math.sqrt(3);
      if (Wd > W - 60) { Wd = W - 60; Hh = Wd / Math.sqrt(3); }
      const outer = `M0 0 L0 ${Hh} L${Wd} ${Hh} Z`;
      const inner = `M${.1 * Wd} ${.42 * Hh} L${.1 * Wd} ${.86 * Hh} L${.55 * Wd} ${.86 * Hh} Z`;
      let t = ''; for (let k = 1; k * PX_CM < Wd; k++) t += `<line x1="${k * PX_CM}" y1="${Hh}" x2="${k * PX_CM}" y2="${Hh - (k % 5 ? 8 : 14)}"/>`;
      return { svg: `<svg width="${Wd}" height="${Hh}"><path d="${outer} ${inner}" fill-rule="evenodd" fill="rgba(224,226,255,.72)" stroke="#000455" stroke-width="1.5"/><g stroke="#000455">${t}</g></svg>`,
        keys: [{ x: 0, y: 0 }, { x: 0, y: Hh }, { x: Wd, y: Hh }], ox: 0, oy: 0, grip: { x: .26 * Wd, y: .68 * Hh }, rot: { x: .78 * Wd, y: .93 * Hh }, del: { x: .05 * Wd, y: .22 * Hh } };
    },
    protractor() {
      const R = Math.min(170, (W - 60) / 2), cx = R + 10, cy = R + 10;
      let t = '';
      for (let d = 0; d <= 180; d++) {
        const a = (d * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), L = d % 10 === 0 ? 16 : d % 5 === 0 ? 11 : 6;
        t += `<line x1="${cx + R * c}" y1="${cy - R * s}" x2="${cx + (R - L) * c}" y2="${cy - (R - L) * s}"/>`;
        if (d % 10 === 0) {
          t += `<text x="${cx + (R - 28) * c}" y="${cy - (R - 28) * s + 3}" text-anchor="middle" stroke="none" fill="#000455" font-size="9" font-family="Anta, sans-serif">${d}</text>`;
          t += `<text x="${cx + (R - 46) * c}" y="${cy - (R - 46) * s + 3}" text-anchor="middle" stroke="none" fill="#000455" font-size="8" opacity=".7" font-family="Anta, sans-serif">${180 - d}</text>`;
        }
      }
      return { svg: `<svg width="${2 * R + 20}" height="${R + 20}"><path d="M10 ${cy} A${R} ${R} 0 0 1 ${2 * R + 10} ${cy} Z" fill="rgba(224,226,255,.72)" stroke="#000455" stroke-width="1.5"/><g stroke="#000455" stroke-width="1">${t}</g><path d="M${cx - 8} ${cy} h16 M${cx} ${cy - 8} v8" stroke="#000455" stroke-width="1.2"/></svg>`,
        keys: [{ x: 0, y: 0 }, { x: -R, y: 0 }, { x: R, y: 0 }], ox: -(R + 10), oy: -(R + 10), grip: { x: 0, y: -R * .35 }, rot: { x: R - 26, y: -14 }, del: { x: -(R - 26), y: -14 } };
    }
  };

  function buildInstrument(inst) {
    if (inst.type === 'compass') return buildCompass(inst);
    const spec = INST[inst.type]();
    const el = h('div', { class: 'inst' });
    el.append(h('div', { class: 'inst-svg', html: spec.svg, style: { left: spec.ox + 'px', top: spec.oy + 'px' } }));
    const grip = handle('move4', 'Move', spec.grip.x, spec.grip.y);
    const rot = handle('rotate', 'Rotate', spec.rot.x, spec.rot.y);
    const del = handle('close', 'Remove', spec.del.x, spec.del.y, true);
    el.append(grip, rot, del);

    const apply = () => {
      el.style.transform = `translate(${inst.x}px,${inst.y}px) rotate(${inst.rot}rad)`;
      [grip, rot, del].forEach(hd => { hd.style.transform = `rotate(${-inst.rot}rad)`; });   // keep icons upright
    };
    apply();
    makeDrag(grip, { down: e => ({ sx: e.clientX, sy: e.clientY, x: inst.x, y: inst.y }), move: (e, s) => { inst.x = s.x + e.clientX - s.sx; inst.y = s.y + e.clientY - s.sy; snapInstrument(inst, spec.keys); apply(); } });
    const base = Math.atan2(spec.rot.y, spec.rot.x);
    makeDrag(rot, { down: () => ({}), move: e => { inst.rot = Math.atan2(e.clientY - inst.y, e.clientX - inst.x) - base; apply(); } });
    makeDrag(del, { down: () => ({}), up: () => removeInstrument(inst.id) });
    return el;
  }

  /* the compass: drag the pivot to move it, the pencil tip to set the radius,
     and the hinge on top to swing it round — the pencil draws an arc as it goes */
  function buildCompass(inst) {
    const el = h('div', { class: 'inst compass' });
    const svg = svgEl('svg', { class: 'inst-full' });
    const INK = '#000455', LAV = '#E0E2FF';
    // artwork pieces (drawn in this order): two tapered legs, pencil lead, needle point, hinge, top handle
    const needleLeg = svgEl('path', { fill: LAV, stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    const needleTip = svgEl('path', { fill: INK });
    const pencilLeg = svgEl('path', { fill: LAV, stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    const barrel = svgEl('path', { fill: '#fff', stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' });
    const lead = svgEl('path', { fill: INK });
    const stem = svgEl('line', { stroke: INK, 'stroke-width': 5, 'stroke-linecap': 'round' });
    const knob = svgEl('circle', { r: 7, fill: LAV, stroke: INK, 'stroke-width': 2.5 });
    const hinge = svgEl('circle', { r: 8, fill: LAV, stroke: INK, 'stroke-width': 2.5 });
    const hingeDot = svgEl('circle', { r: 2.2, fill: INK });
    svg.append(needleLeg, needleTip, pencilLeg, barrel, lead, stem, knob, hinge, hingeDot);
    const hP = handle('move4', 'Move compass', 0, 0), hT = handle('tip', 'Set radius', 0, 0, true), hH = handle('rotate', 'Swing to draw an arc', 0, 0), hD = handle('close', 'Remove', 0, 0, true);
    el.append(svg, hP, hT, hH, hD);

    // a leg: tapered strip from a (width w1) to b (width w2)
    const strip = (a, b, w1, w2) => {
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / d, ny = (b.x - a.x) / d;
      const p = (q, w, s) => (q.x + nx * w * s).toFixed(1) + ' ' + (q.y + ny * w * s).toFixed(1);
      return `M${p(a, w1, 1)}L${p(b, w2, 1)}L${p(b, w2, -1)}L${p(a, w1, -1)}Z`;
    };
    const along = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const back = (a, b, px) => { const d = Math.hypot(b.x - a.x, b.y - a.y) || 1; return along(b, a, px / d); };   // point px before b, towards a

    function update() {
      const r = inst.r, N = { x: inst.x, y: inst.y }, T = { x: inst.x + r * Math.cos(inst.ang), y: inst.y + r * Math.sin(inst.ang) };
      const mx = (N.x + T.x) / 2, my = (N.y + T.y) / 2;
      const nx = Math.sin(inst.ang), ny = -Math.cos(inst.ang);
      const leg = Math.max(140, r / 2 + 50), ht = Math.sqrt(Math.max(leg * leg - (r / 2) ** 2, 400));
      const Hn = { x: mx + nx * ht, y: my + ny * ht };
      // needle leg ends in a sharp steel point
      const nb = back(Hn, N, 16);
      needleLeg.setAttribute('d', strip(Hn, nb, 6, 2.6));
      needleTip.setAttribute('d', strip(nb, N, 2.6, 0.2));
      // pencil leg, then the wooden barrel and the dark lead
      const pq = back(Hn, T, 46), pb = back(Hn, T, 16);
      pencilLeg.setAttribute('d', strip(Hn, pq, 6, 4.8));
      barrel.setAttribute('d', strip(pq, pb, 5.2, 5.2));
      lead.setAttribute('d', strip(pb, T, 5.2, 0.8));
      // hinge with a small handle on top, pointing away from the legs
      const hd = Math.hypot(Hn.x - mx, Hn.y - my) || 1, ux = (Hn.x - mx) / hd, uy = (Hn.y - my) / hd;
      stem.setAttribute('x1', Hn.x); stem.setAttribute('y1', Hn.y); stem.setAttribute('x2', Hn.x + ux * 18); stem.setAttribute('y2', Hn.y + uy * 18);
      knob.setAttribute('cx', Hn.x + ux * 24); knob.setAttribute('cy', Hn.y + uy * 24);
      hinge.setAttribute('cx', Hn.x); hinge.setAttribute('cy', Hn.y);
      hingeDot.setAttribute('cx', Hn.x); hingeDot.setAttribute('cy', Hn.y);
      const put = (hdl, x, y) => { hdl.style.left = x + 'px'; hdl.style.top = y + 'px'; };
      put(hP, N.x, N.y); put(hT, T.x, T.y); put(hH, Hn.x, Hn.y); put(hD, N.x, N.y + 30);
      requestOverlay();
    }
    update();

    makeDrag(hP, { down: e => ({ sx: e.clientX, sy: e.clientY, x: inst.x, y: inst.y }), move: (e, s) => {
      inst.x = s.x + e.clientX - s.sx; inst.y = s.y + e.clientY - s.sy;
      const keys = [{ x: 0, y: 0 }, { x: inst.r * Math.cos(inst.ang), y: inst.r * Math.sin(inst.ang) }];   // needle point and pencil tip
      const rr = inst.rot; inst.rot = 0; snapInstrument(inst, keys); inst.rot = rr;
      update();
    } });
    makeDrag(hT, { down: () => ({}), move: e => {
      let tx = e.clientX, ty = e.clientY;
      const d = nearestDot({ x: tx, y: ty });                          // pencil tip clicks onto a point
      if (d) { tx = d.x; ty = d.y; }
      inst.r = Math.max(20, Math.hypot(tx - inst.x, ty - inst.y));
      inst.ang = Math.atan2(ty - inst.y, tx - inst.x);
      update();
    } });
    makeDrag(hH, {
      down: e => { const pa = Math.atan2(e.clientY - inst.y, e.clientX - inst.x); return { a0: inst.ang, prev: pa, acc: 0 }; },
      move: (e, s) => {
        const pa = Math.atan2(e.clientY - inst.y, e.clientX - inst.x);
        let d = pa - s.prev;
        if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;         // keep the swing continuous
        s.acc += d; s.prev = pa;
        inst.ang = s.a0 + s.acc;
        inst.preview = { a0: s.a0, a1: inst.ang };
        update();
      },
      up: (e, s) => {
        inst.preview = null;
        if (Math.abs(s.acc) > 0.03) {                                    // save the arc in world coordinates
          const b = board(), c = toWorld({ x: inst.x, y: inst.y });
          commit([...b.objects, { type: 'arc', cx: c.x, cy: c.y, r: inst.r / b.s, a0: s.a0, a1: inst.ang, ccw: s.acc < 0, color: state.pen.color, size: state.pen.size }]);
        }
        requestOverlay();
      }
    });
    makeDrag(hD, { down: () => ({}), up: () => removeInstrument(inst.id) });
    return el;
  }

  function renderInstruments() {
    instLayer.innerHTML = '';
    board().instruments.forEach(i => instLayer.append(buildInstrument(i)));
  }
  function removeInstrument(id) {
    const b = board();
    b.instruments = b.instruments.filter(i => i.id !== id);
    renderInstruments(); requestOverlay();
    if (pop.kind === 'shapes') rerenderPopover();
  }
  function toggleInstrument(type) {
    const b = board();
    const have = b.instruments.find(i => i.type === type);
    if (have) { removeInstrument(have.id); return; }
    const inst = { id: Date.now() + Math.random(), type, x: W / 2 - 120, y: H / 2 - 40, rot: 0 };
    if (type === 'compass') Object.assign(inst, { x: W / 2, y: H / 2 + 40, r: 110, ang: 0 });
    if (type === 'protractor') Object.assign(inst, { x: W / 2, y: H / 2 + 80 });
    b.instruments.push(inst);
    renderInstruments();
    if (pop.kind === 'shapes') rerenderPopover();
  }

  /* ---------------------------------------------------------
     15. Option dialogs (popovers)
     --------------------------------------------------------- */
  const title = UI.title, section = UI.section;

  /* content of the three Geometry tabs */
  function geoTabBody() {
    if (state.geo.tab === 'tools') {
      const active = Geo.byId[state.geo.tool];
      return h('div', {},
        ...Geo.GROUPS.map(gr => h('div', {},
          h('div', { class: 'geo-group', text: gr }),
          UI.grid({ items: Geo.TOOLS.filter(t => t.group === gr), value: state.geo.tool, cols: 4, labels: true, onPick: id => setGeoTool(id) }))),
        active ? h('div', { class: 'hint-line', text: active.name + ' — ' + active.hint }) : h('div', { class: 'hint-line', text: 'Pick a tool, then click on the board.' }));
    }
    if (state.geo.tab === 'instruments') {
      const b = board();
      const items = INSTRUMENTS.map(it => ({ id: it.id, label: it.label, icon: it.icon }));
      const grid = UI.grid({ items, value: null, cols: 3, labels: true, onPick: id => toggleInstrument(id) });
      grid.querySelectorAll('.opt').forEach((btn, i) => btn.classList.toggle('active', b.instruments.some(x => x.type === items[i].id)));
      return h('div', {}, grid, h('div', { class: 'pop-note', style: { marginTop: '12px' }, text: 'Drag the round handles to move, rotate or remove an instrument. Swing the compass hinge to draw an arc.' }));
    }
    return h('div', {},
      section('Shape', UI.grid({ items: SHAPES, value: state.shape.kind, cols: 6, onPick: id => { state.shape.kind = id; rerenderPopover(); } })),
      section('Line style', UI.grid({ items: LINE_STYLES, value: state.shape.dash, cols: 3, onPick: id => { state.shape.dash = id; rerenderPopover(); } })),
      section('Thickness', UI.slider({ min: 1, max: 20, value: state.shape.size, unit: '', onInput: v => { state.shape.size = v; } })),
      section('Colour', UI.swatches({ colors: COLORS, value: state.shape.color, onPick: c => { state.shape.color = c; } })));
  }

  const panels = {
    select() {
      const modes = [{ id: 'free', icon: 'lasso', label: 'Free-form' }, { id: 'rect', icon: 'rectsel', label: 'Rectangle' }, { id: 'ellipse', icon: 'ellipsel', label: 'Ellipse' }];
      return h('div', {},
        section('Selection shape', UI.list({ items: modes, value: state.select.mode, onPick: id => { state.select.mode = id; rerenderPopover(); } })),
        section('', h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', html: ICONS.rectsel + '<span>Select all</span>', onclick: () => {
          sel = board().objects.filter(o => !o.erase); closePopover(); requestRender();
        } }))),
        h('div', { class: 'pop-note', text: 'Draw around objects to select them, then drag to move. Use the buttons that appear to duplicate or delete.' }));
    },

    /* Pen dialog: colour swatches first, then size (no preview, as in the design) */
    pen() {
      return h('div', {},
        section('Colour', UI.swatches({ colors: COLORS, value: state.pen.color, onPick: c => { state.pen.color = c; } })),
        section('Size', UI.slider({ min: 1, max: 40, value: state.pen.size, unit: '', onInput: v => { state.pen.size = v; } })));
    },

    /* Eraser dialog: two modes; size only matters for the normal eraser */
    eraser() {
      const modes = [{ id: 'normal', icon: 'eraser', label: 'Eraser' }, { id: 'select', icon: 'lasso', label: 'Select & erase' }];
      return h('div', {},
        section('Mode', UI.list({ items: modes, value: state.eraser.mode, onPick: id => { state.eraser.mode = id; setCursor(); rerenderPopover(); } })),
        state.eraser.mode === 'normal' ? section('Size', UI.slider({ min: 4, max: 100, value: state.eraser.size, unit: '', onInput: v => { state.eraser.size = v; } })) : null);
    },

    /* Geometry dialog: three tabs — Shapes (freehand-style shapes), Tools (GeoGebra / Desmos constructions),
       Instruments (scale, compass, set squares, protractor) */
    shapes() {
      const tabs = [['shapes', 'Shapes'], ['tools', 'Tools'], ['instruments', 'Instruments']];
      const bar = h('div', { class: 'geo-tabs' }, ...tabs.map(([id, label]) => h('button', {
        class: 'geo-tab' + (state.geo.tab === id ? ' active' : ''), type: 'button', text: label,
        onclick: () => {
          state.geo.tab = id;
          if (id === 'shapes' && state.tool === 'tools') setTool('shapes');
          if (id === 'tools' && state.geo.tool) setTool('tools');
          rerenderPopover();
        }
      })));
      return h('div', {}, bar, geoTabBody());
    },

    text() {
      const sample = h('div', { class: 'font-sample', text: 'The quick brown fox' });
      const upd = () => { sample.style.fontFamily = fontCss(state.text.font); sample.style.fontSize = Math.min(state.text.size, 44) + 'px'; sample.style.color = state.text.color; };
      upd();
      const list = h('div', { class: 'font-list' }, ...FONTS.map(f => h('button', {
        class: 'font-item' + (f === state.text.font ? ' active' : ''), type: 'button', text: f, style: { fontFamily: fontCss(f) },
        onclick: () => { state.text.font = f; ensureFont(f, 20); rerenderPopover(); }
      })));
      return h('div', {},
        section('Font', list),
        section('Size', UI.slider({ min: 10, max: 160, value: state.text.size, unit: ' px', onInput: v => { state.text.size = v; upd(); } })),
        section('Colour', UI.swatches({ colors: COLORS, value: state.text.color, onPick: c => { state.text.color = c; upd(); } })),
        section('Preview', sample),
        h('div', { class: 'pop-note', text: 'Click on the board to type. Click away (or Ctrl + Enter) to finish.' }));
    },

    backdrop() {
      const bd = board().backdrop;
      const apply = () => { renderBackdrop(); };
      const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
      fileIn.addEventListener('change', () => {
        const f = fileIn.files && fileIn.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { setBackdropImage(rd.result); rerenderPopover(); };
        rd.readAsDataURL(f);
      });
      return h('div', {},
        section('Colour', UI.swatches({ colors: BACKDROP_COLORS, value: bd.color, onPick: c => { bd.color = c; apply(); } })),
        section('Pattern', UI.grid({ items: PATTERNS, value: bd.pattern, cols: 3, onPick: id => { bd.pattern = id; apply(); rerenderPopover(); } })),
        bd.pattern !== 'none' ? section('Pattern spacing', UI.slider({ min: 16, max: 96, value: bd.spacing, unit: ' px', onInput: v => { bd.spacing = v; apply(); } })) : null,
        section('Image', h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', html: ICONS.upload + '<span>Upload image</span>', onclick: () => fileIn.click() }),
          bd.img ? h('button', { class: 'btn', type: 'button', html: ICONS.trash + '<span>Remove</span>', onclick: () => { setBackdropImage(null); rerenderPopover(); } }) : null),
          fileIn));
    }
  };

  /* Backdrop works like Clear: it opens a centred modal (it is not a "tool", so the button never turns navy) */
  let modalRerender = null;
  function openBackdropModal() {
    const modal = $('#modal');
    const body = h('div', { class: 'bd-body' });
    const close = () => { modal.classList.remove('open'); modal.innerHTML = ''; modalRerender = null; };
    modalRerender = () => { const st = body.scrollTop; body.replaceChildren(panels.backdrop()); body.scrollTop = st; };
    modalRerender();
    modal.innerHTML = '';
    modal.append(h('div', { class: 'modal-card bd-card', role: 'dialog', 'aria-label': 'Backdrop' },
      h('button', { class: 'pop-x', type: 'button', title: 'Close', 'aria-label': 'Close', html: ICONS.close, onclick: close }),
      h('h3', { text: 'Backdrop' }), body,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', text: 'Done', onclick: close }))));
    modal.classList.add('open');
    modal.onclick = e => { if (e.target === modal) close(); };
  }

  function setBackdropImage(src) {
    const bd = board().backdrop;
    bd.src = src; bd.img = null;
    if (src) { const im = new Image(); im.onload = () => renderBackdrop(); im.src = src; bd.img = im; }
    renderBackdrop();
  }

  /* The dialog is a speech bubble: .pop-body (white, inner shadow, scrolls) plus a small tail (.pop-tail)
     pointing at the tool button that opened it. Pen / Eraser / Select use the narrow 200px bubble from the design. */
  const DIALOG_H = { pen: 150, select: 250, eraser: 250, shapes: 300, text: 300 };   // height of each dialog's scrolling area, in px
  const NARROW = ['pen', 'eraser', 'select'];
  function fillPopover() {
    popScroll.replaceChildren(panels[pop.kind]());
    popover.classList.toggle('narrow', NARROW.includes(pop.kind));
    popover.classList.toggle('wide', pop.kind === 'shapes');
    popover.classList.toggle('pop-text', pop.kind === 'text');
  }
  function openPopover(kind, anchor) {
    pop = { kind, anchor };
    fillPopover();
    popover.classList.add('open');
    positionPopover();
  }
  function rerenderPopover() {
    if (modalRerender) { modalRerender(); return; }            // the Backdrop modal is open
    if (!pop.kind) return;
    const st = popScroll.scrollTop;
    fillPopover();
    positionPopover();
    popScroll.scrollTop = st;
  }
  function closePopover() { pop = { kind: null, anchor: null }; popover.classList.remove('open'); }
  function togglePopover(kind, anchor) { if (pop.kind === kind) closePopover(); else openPopover(kind, anchor); }

  /* Draws the bubble outline (exactly the design's shape): rounded box of size w x bh (radius 30)
     with a 17px tail whose tip is at x = cx on the bottom edge. */
  function drawBubble(w, bh, cx) {
    const R = 30, X = v => +(cx + v).toFixed(2), Y = v => +(bh + v).toFixed(2);
    // bottom corners get smaller when the tail is close to them (e.g. above the first tool)
    const rl = Math.max(4, Math.min(R, cx - 15.306)), rr = Math.max(4, Math.min(R, w - cx - 15.306));
    const kk = r => +(r * 0.4477).toFixed(3);                          // circle-like bezier handle
    popPath.setAttribute('d',
      `M${R} 0H${w - R}C${w - kk(R)} 0 ${w} ${kk(R)} ${w} ${R}V${bh - rr}C${w} ${bh - kk(rr)} ${w - kk(rr)} ${bh} ${w - rr} ${bh}` +
      `H${X(15.306)}C${X(14.344)} ${Y(0)} ${X(13.441)} ${Y(0.461)} ${X(12.877)} ${Y(1.239)}L${X(2.429)} ${Y(15.65)}` +
      `C${X(1.231)} ${Y(17.302)} ${X(-1.231)} ${Y(17.302)} ${X(-2.429)} ${Y(15.65)}L${X(-12.877)} ${Y(1.239)}` +
      `C${X(-13.441)} ${Y(0.461)} ${X(-14.344)} ${Y(0)} ${X(-15.306)} ${Y(0)}H${rl}` +
      `C${kk(rl)} ${bh} 0 ${bh - kk(rl)} 0 ${bh - rl}V${R}C0 ${kk(R)} ${kk(R)} 0 ${R} 0Z`);
    popBg.setAttribute('width', w); popBg.setAttribute('height', bh + 17);
  }

  /* sits just above the active tool button (3px gap, like the design) with the tail pointing at its centre */
  function positionPopover() {
    if (!pop.anchor) return;
    const a = pop.anchor.getBoundingClientRect();
    popScroll.style.height = Math.max(100, Math.min(DIALOG_H[pop.kind] || 150, a.top - 3 - 17 - 40 - 12)) + 'px';   // every dialog has the same height (content scrolls); shrinks only if the screen is too short
    popover.style.bottom = (H - a.top + 3) + 'px';
    const w = popover.offsetWidth;
    const left = UI.clamp(a.left + a.width / 2 - w / 2, 10, Math.max(10, W - w - 10));
    popover.style.left = left + 'px';
    drawBubble(w, popBody.offsetHeight, UI.clamp(a.left + a.width / 2 - left, 22, w - 22));
  }

  /* ---------------------------------------------------------
     16. Tool switching, hints
     --------------------------------------------------------- */
  function showHint(text) { hintEl.textContent = text; hintEl.classList.add('show'); }
  function hideHint() { hintEl.classList.remove('show'); }

  function setTool(tool) {
    if (state.tool !== tool) {
      finishText(); resetGeo();
      if (tool !== 'select') clearSel();
    }
    state.tool = tool;
    // the geometry constructions ('tools') belong to the Geometry button
    toolBar.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === (tool === 'tools' ? 'shapes' : tool)));
    const gt = Geo.byId[state.geo.tool];
    if (tool === 'tools' && gt) showHint(gt.name + ': ' + gt.hint); else hideHint();
    setCursor(); requestRender();
  }

  function setGeoTool(id) {
    state.geo.tool = id;
    resetGeo();
    setTool('tools');
    const t = Geo.byId[id];
    showHint(t.name + ': ' + t.hint);
    rerenderPopover();
  }

  /* ---------------------------------------------------------
     17. Files: export PNG, save / open board file
     --------------------------------------------------------- */
  function download(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportPNG() {
    finishText();
    renderAll();
    const c = document.createElement('canvas');
    c.width = bgCanvas.width; c.height = bgCanvas.height;
    const x = c.getContext('2d');
    x.drawImage(bgCanvas, 0, 0); x.drawImage(drawCanvas, 0, 0);
    c.toBlob(b => download(b, `rishits-canvas-board-${cur + 1}.png`));
  }
  function saveFile() {
    finishText();
    const data = {
      app: 'rishits-canvas', version: 1, current: cur,
      boards: boards.map(b => ({ ox: b.ox, oy: b.oy, s: b.s, labelCount: b.labelCount, objects: b.objects, backdrop: { color: b.backdrop.color, pattern: b.backdrop.pattern, spacing: b.backdrop.spacing, src: b.backdrop.src } }))
    };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'rishits-canvas-boards.json');
  }
  function openFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result);
        if (data.app !== 'rishits-canvas' || !Array.isArray(data.boards) || !data.boards.length) throw new Error('bad file');
        boards = data.boards.map(sb => {
          const b = newBoard();
          Object.assign(b, { ox: +sb.ox || 0, oy: +sb.oy || 0, s: UI.clamp(+sb.s || 1, MIN_ZOOM, MAX_ZOOM), labelCount: sb.labelCount | 0, objects: Array.isArray(sb.objects) ? sb.objects : [] });
          Object.assign(b.backdrop, sb.backdrop || {}); b.backdrop.img = null;
          if (b.backdrop.src) { const im = new Image(); im.onload = () => renderBackdrop(); im.src = b.backdrop.src; b.backdrop.img = im; }
          return b;
        });
        cur = UI.clamp(data.current | 0, 0, boards.length - 1);
        clearSel(); renderInstruments(); renderAll(); updateBoardUI();
      } catch (err) { window.alert('Sorry, that file is not a valid Rishit\'s Canvas board file.'); }
    };
    rd.readAsText(file);
  }

  /* ---------------------------------------------------------
     18. Wiring: buttons, keyboard, wheel
     --------------------------------------------------------- */
  function init() {
    ovCanvas.addEventListener('pointerdown', onDown);
    ovCanvas.addEventListener('pointermove', onMove);
    ovCanvas.addEventListener('pointerup', onUp);
    ovCanvas.addEventListener('pointercancel', onCancel);
    ovCanvas.addEventListener('pointerleave', () => { hover = null; requestOverlay(); });
    ovCanvas.addEventListener('dblclick', () => { const t = Geo.byId[state.geo.tool]; if (state.tool === 'tools' && t && t.variable && g.inputs.length >= t.min) finishGeo(); });
    ovCanvas.addEventListener('contextmenu', e => e.preventDefault());
    ovCanvas.addEventListener('wheel', e => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      zoomAt(board().s * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.005 : 0.0015)), pos(e));
    }, { passive: false });

    // keep the bubble outline and tail in step with the content (colour picker opening, custom swatch appearing …)
    if (window.ResizeObserver) new ResizeObserver(() => { if (pop.kind) positionPopover(); }).observe(popScroll);

    $('#popover .pop-x').addEventListener('click', closePopover);
    popBody.querySelector('.pop-x').innerHTML = ICONS.close;

    // clicks outside the dialog close it
    document.addEventListener('pointerdown', e => {
      if (pop.kind && !popover.contains(e.target) && !toolBar.contains(e.target)) closePopover();
    });

    // toolbar
    toolBar.addEventListener('click', e => {
      const btn = e.target.closest('[data-tool]'); if (!btn) return;
      const t = btn.dataset.tool;
      if (t === 'clear') { confirmClear(); return; }
      if (t === 'backdrop') { closePopover(); openBackdropModal(); return; }   // like Clear: a modal, the button is not selected
      const current = state.tool === 'tools' ? 'shapes' : state.tool;
      if (current !== t) { closePopover(); setTool(t); return; }      // other tools: first click just selects the tool
      if (t === 'move') return;                                       // Move has no dialog
      togglePopover(t, btn);                                          // clicking the active tool again: dialog
    });

    // board bar
    undoBtn.onclick = undo; redoBtn.onclick = redo;
    prevBtn.onclick = () => switchBoard(cur - 1); nextBtn.onclick = () => switchBoard(cur + 1);
    $('#addBoard').onclick = addBoard; $('#delBoard').onclick = deleteBoard;
    $('#selDelete').onclick = deleteSelection; $('#selCopy').onclick = duplicateSelection;

    // keyboard shortcuts (only while the whiteboard is showing and no input has focus)
    document.addEventListener('keydown', e => {
      if (!root.classList.contains('active')) return;
      if (e.target.closest && e.target.closest('input, textarea')) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && k === 'y') { e.preventDefault(); redo(); }
      else if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomBy(1.25); }
      else if (mod && k === '-') { e.preventDefault(); zoomBy(1 / 1.25); }
      else if (mod && k === '0') { e.preventDefault(); zoomAt(1, { x: W / 2, y: H / 2 }); }
      else if ((k === 'delete' || k === 'backspace') && sel.length) { e.preventDefault(); deleteSelection(); }
      else if (k === 'enter' && Geo.byId[state.geo.tool] && Geo.byId[state.geo.tool].variable && g.inputs.length >= Geo.byId[state.geo.tool].min) finishGeo();
      else if (k === 'escape') { resetGeo(); clearSel(); closePopover(); requestRender(); }
    });

    window.addEventListener('resize', resize);
    setTool('pen');
    resize();
    updateBoardUI();
  }

  window.Whiteboard = { init, exportPNG, saveFile, openFile, resize };
})();
