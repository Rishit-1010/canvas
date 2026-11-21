/* =========================================================
   graph.js — the Graph Calculator workspace
   ---------------------------------------------------------
    1. Setup, saved state, helpers
    2. MathLive loader (falls back to a plain text box if it cannot load)
    3. Recompute: reads every row, finds out what it is, and builds the things to draw
    4. The view (pan / zoom) and drawing: grid, axes, curves, inequalities, points, images, geometry
    5. The equation panel: rows (expression / note / image / table), sliders, colour menu, "+" menu
    6. The Tools tab (geometry tools, shared with the whiteboard through Geo.createController)
    7. Settings window
    8. Pointer input (drag to pan, wheel / pinch to zoom, hover tooltips, geometry clicks)
    9. Buttons: undo / redo / home / zoom / full screen, panel toggle, keypad
   10. init / resize / show
   ========================================================= */
(function () {
  'use strict';
  const $ = sel => document.querySelector(sel);
  const ME = window.MathEngine, E = ME.E;
  const h = window.UI.h;
  const TAU = Math.PI * 2;
  const KEY = 'canvas.graph.v1';

  /* ---------------------------------------------------------
     1. Setup, saved state, helpers
     --------------------------------------------------------- */
  // colours offered for an equation (the first six are used automatically, in order)
  const PALETTE = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#000000', '#fa7e19', '#0d9488', '#db2777'];
  const PHONE_MAX = 768;                              // at this width (and below) the graph uses the phone layout
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  const K = () => window.Geo.PX_PER_CM;               // geometry world units per graph unit

  const DEFAULT_SETTINGS = { grid: true, minor: true, axes: true, numbers: true, polar: false, angle: 'rad' };

  const st = {
    rows: [],                                         // the items in the equation panel
    settings: Object.assign({}, DEFAULT_SETTINGS),
    view: { ox: 0, oy: 0, sx: 110, sy: 110 },         // screen = origin + graph coordinate * scale (y is flipped)
    geo: { objects: [], labelCount: 0, tool: null },  // geometry objects, in "world" units: x = gx*K, y = -gy*K
    tab: 'algebra',
    panelOpen: true,
    colorCount: 0,
    undo: [], redo: [],
    active: null,                                     // id of the focused row
    hover: null,                                      // point under the pointer (for the tooltip)
    ready: false
  };

  let rowId = 1;
  const newId = () => 'r' + (rowId++);
  const newRow = (type = 'expr', extra = {}) => Object.assign({ id: newId(), type, src: '', mode: 'latex', color: PALETTE[st.colorCount++ % 6], hidden: false, style: 'solid' }, extra);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let saveTimer = 0;
  function save() {                                   // saved a moment after the last change
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          rows: st.rows.map(strip), settings: st.settings, view: st.view, geo: { objects: st.geo.objects, labelCount: st.geo.labelCount }, panelOpen: st.panelOpen, colorCount: st.colorCount
        }));
      } catch (e) { /* storage may be unavailable (private window) — the graph still works */ }
    }, 400);
  }
  const strip = r => { const o = {}; for (const k in r) if (k[0] !== '_') o[k] = r[k]; return o; };   // drop runtime fields (those starting with _)
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d || !Array.isArray(d.rows)) return false;
      st.rows = d.rows; st.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
      if (d.view && isFinite(d.view.ox)) st.view = d.view;
      if (d.geo) { st.geo.objects = d.geo.objects || []; st.geo.labelCount = d.geo.labelCount || 0; }
      st.panelOpen = d.panelOpen !== false; st.colorCount = d.colorCount || st.rows.length;
      rowId = 1 + Math.max(0, ...st.rows.map(r => parseInt(String(r.id).slice(1), 10) || 0));
      return true;
    } catch (e) { return false; }
  }

  /* ---------------------------------------------------------
     2. MathLive (the equation editor) — loaded from a CDN when the graph is first opened
     --------------------------------------------------------- */
  const MATHLIVE_URLS = [
    'https://cdn.jsdelivr.net/npm/mathlive@0.98/dist/mathlive.min.js',
    'https://unpkg.com/mathlive@0.98/dist/mathlive.min.js'
  ];
  let useMath = false, mlPromise = null;
  function loadMathLive() {
    if (customElements.get('math-field')) return Promise.resolve(true);
    if (mlPromise) return mlPromise;                    // already loading (started at page load by Graph.preload)
    return (mlPromise = new Promise(resolve => {
      let i = 0;
      const timeout = setTimeout(() => resolve(!!customElements.get('math-field')), 6000);
      const next = () => {
        if (i >= MATHLIVE_URLS.length) { clearTimeout(timeout); return resolve(false); }
        const s = document.createElement('script');
        s.src = MATHLIVE_URLS[i++];
        s.onload = () => customElements.whenDefined('math-field').then(() => { clearTimeout(timeout); resolve(true); });
        s.onerror = next;
        document.head.appendChild(s);
      };
      next();
    }));
  }
  function configureMathLive() {
    const M = window.MathfieldElement;
    if (!M) return;
    try { M.soundsDirectory = null; M.plonkSound = null; M.keypressSound = null; } catch (e) { /* older versions */ }
    try { if (!M.fontsDirectory) M.fontsDirectory = 'https://cdn.jsdelivr.net/npm/mathlive@0.98/dist/fonts'; } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------
     3. Recompute — every row is analysed, and what must be drawn is collected in `items`
     --------------------------------------------------------- */
  const env = { V: {}, F: {} };                       // V: variable values by name, F: user functions by name
  let items = [];                                     // drawable things, in row order
  const NAME = /^[A-Za-z](?:_[A-Za-z0-9]+)?$/;
  const FUNCDEF = /^\s*([A-Za-z](?:_[A-Za-z0-9]+)?)\s*\(\s*[A-Za-z]/;
  const VARDEF = /^\s*([A-Za-z](?:_[A-Za-z0-9]+)?)\s*=(?!=)(.*)$/;

  const rowText = r => (r.type !== 'expr' ? '' : r.mode === 'latex' ? ME.latexToText(r.src) : r.src);

  function recompute(depth = 0) {
    E.deg = st.settings.angle === 'deg';
    for (const k in env.V) delete env.V[k];
    for (const k in env.F) delete env.F[k];
    items = [];

    // 3a. which names are defined (functions / variables)?
    const ctx = { funcs: new Set(), vars: new Set() };
    st.rows.forEach(r => {
      r._text = rowText(r);
      if (r.type !== 'expr') return;
      const f = FUNCDEF.exec(r._text);
      if (f && /^\s*[A-Za-z](?:_[A-Za-z0-9]+)?\s*\([^)]*\)\s*=(?!=)/.test(r._text)) { ctx.funcs.add(f[1]); return; }
      const v = VARDEF.exec(r._text);
      if (v && !['x', 'y', 'e'].includes(v[1]) && !(v[1] === 'r' && /theta|θ/.test(v[2]))) ctx.vars.add(v[1]);
    });
    // table columns can also be used as names — skipped on purpose (keep it simple)

    // 3b. parse everything
    assignFolders();
    st.rows.forEach(r => { r._r = null; if (r.type === 'expr') r._st = ME.parseStatement(r._text, ctx); });
    // which variables / functions hold lists?  (then their formulas work element by element)
    env.listVars = env.listVars || new Set(); env.listVars.clear();
    for (let pass = 0; pass < 4; pass++) st.rows.forEach(r => {
      const q = r._st; if (!q) return;
      if (q.type === 'vardef' && ME.containsList(q.ast, env.listVars)) env.listVars.add(q.name);
      if (q.type === 'funcdef' && ME.containsList(q.ast, env.listVars)) env.listVars.add('f:' + q.name);
    });

    // 3c. functions first (their bodies only look names up when they run), then variables
    const defs = [];
    st.rows.forEach(r => {
      if (r.type !== 'expr') return;
      const s = r._st;
      try {
        if (s.type === 'funcdef') {
          env.F[s.name] = ME.compile(s.ast, s.args, env);
          const cond = ME.compileConds(s.cond, s.args, env);
          if (cond) { const f0 = env.F[s.name]; env.F[s.name] = (...a) => (cond(...a) ? f0(...a) : NaN); }
          if (s.args.length === 1) {                                   // f(x) = … is drawn like y = f(x)
            const fx = env.F[s.name];
            r._r = { graph: true, kind: 'explicit', fn: fx, cond: null };
          } else r._r = { graph: false };
        } else if (s.type === 'vardef') {
          const fn = ME.compile(s.ast, [], env);
          const constant = ME.freeVars(s.ast).size === 0;
          defs.push({ r, name: s.name, fn });
          r._r = { graph: false, slider: constant, name: s.name };
        }
      } catch (e) { r._r = { error: e.message }; }
    });
    // evaluate the variables a few times, so that a = b + 1 works whichever row comes first
    for (let pass = 0; pass < Math.min(6, defs.length + 1); pass++) defs.forEach(d => { try { env.V[d.name] = d.fn(); } catch (e) { env.V[d.name] = NaN; } });
    defs.forEach(d => {
      const info = d.r._r; if (!info) return;
      info.value = env.V[d.name];
      if (info.slider && typeof info.value !== 'number') info.slider = false;      // only plain numbers get a slider
      if (Array.isArray(info.value)) info.out = '= ' + ME.format(info.value);      // lists show their values
    });
    // sliders by name (so that a point like (a, b) can be dragged)
    const sliderByName = {};
    st.rows.forEach(r => { if (r._r && r._r.slider) sliderByName[r._r.name] = r; });

    // 3d. undefined single letters get a slider automatically (value 1, like Desmos)
    if (depth === 0) {
      const wanted = []; const seen = new Set();
      st.rows.forEach((r, i) => {
        if (r.type !== 'expr' || !r._st || !r._st.needs) return;
        r._st.needs.forEach(n => { if (NAME.test(n) && !seen.has(n) && !(n in env.V) && !ctx.funcs.has(n)) { seen.add(n); wanted.push({ n, at: i }); } });
      });
      if (wanted.length) {
        wanted.sort((a, b) => b.at - a.at).forEach(w => st.rows.splice(w.at, 0, newRow('expr', { src: w.n + '=1', mode: st.rows.some(r => r.mode === 'text') && !useMath ? 'text' : 'latex' })));
        if (!useMath) st.rows.forEach(r => { if (r.src && /^[A-Za-z](_\w+)?=1$/.test(r.src)) r.mode = 'text'; });
        buildPanel();
        return recompute(1);
      }
    }

    // 3e. everything else becomes something to draw
    st.rows.forEach((r, idx) => {
      if (r.type === 'image') { items.push({ row: r, kind: 'image' }); r._r = { graph: false }; return; }
      if (r.type === 'table') { buildTable(r); return; }
      if (r.type !== 'expr') return;
      const s = r._st;
      if (r._r && r._r.error) return;
      if (s.type === 'empty') { r._r = { graph: false }; return; }
      if (s.type === 'error') { r._r = { error: s.msg }; return; }
      if (s.type === 'funcdef') { if (r._r && r._r.graph) items.push({ row: r, kind: 'explicit', fn: r._r.fn, cond: null }); return; }
      if (s.type === 'vardef') return;
      try {
        // names that are neither defined nor allowed here (e.g. "theta" in a plain equation) are reported
        const bad = (s.needs || []).filter(n => !(n in env.V) && !NAME.test(n));
        if (bad.length) throw new Error(bad[0] + ' is not defined');
        let it = null;
        switch (s.type) {
          case 'explicit': it = { kind: 'explicit', fn: ME.compile(s.ast, ['x'], env), cond: ME.compileConds(s.cond, ['x', 'y'], env) }; break;
          case 'xexplicit': it = { kind: 'xexplicit', fn: ME.compile(s.ast, ['y'], env), cond: ME.compileConds(s.cond, ['x', 'y'], env) }; break;
          case 'polar': {
            const b = ME.boundsFor(s.cond, 'theta');
            it = { kind: 'polar', fn: ME.compile(s.ast, ['theta'], env), cond: ME.compileConds(s.cond, ['theta', 'r'], env),
              lo: b.lo ? ME.compile(b.lo, [], env) : () => 0, hi: b.hi ? ME.compile(b.hi, [], env) : () => 12 * Math.PI };
            break;
          }
          case 'implicit': it = { kind: 'implicit', fn: ME.compile(s.ast, ['x', 'y'], env), cond: ME.compileConds(s.cond, ['x', 'y'], env) }; break;
          case 'ineq': {
            it = { kind: 'ineq', L: ME.compile(s.L, ['x', 'y'], env), R: ME.compile(s.R, ['x', 'y'], env), rel: s.rel, cond: ME.compileConds(s.cond, ['x', 'y'], env) };
            if (s.bd) it.bd = { kind: s.bd.kind, fn: ME.compile(s.bd.ast, [s.bd.kind === 'y' ? 'x' : 'y'], env) };
            else it.F = ME.compile(s.boundary, ['x', 'y'], env);
            break;
          }
          case 'point': {
            const tuple = s.ast;
            it = { kind: 'point', fx: ME.compile(tuple.items[0], [], env), fy: ME.compile(tuple.items[1], [], env), cond: ME.compileConds(s.cond, [], env) };
            // a point whose coordinates are plain numbers (or sliders) can be dragged with the mouse
            const specs = tuple.items.map(n => dragSpec(n, sliderByName));
            if (specs.every(Boolean) && !s.cond) it.drag = specs;
            break;
          }
          case 'param': {
            const b = ME.boundsFor(s.cond, s.v);
            it = { kind: 'param', fx: ME.compile(s.ast.items[0], [s.v], env), fy: ME.compile(s.ast.items[1], [s.v], env), cond: ME.compileConds(s.cond, [s.v], env),
              lo: b.lo ? ME.compile(b.lo, [], env) : () => -10, hi: b.hi ? ME.compile(b.hi, [], env) : () => 10 };
            break;
          }
          case 'value': {
            const fn = ME.compile(s.ast, [], env);
            const v = fn();
            r._r = { graph: false, out: s.boolean ? ME.format(!!v) : '= ' + ME.format(v) };
            return;
          }
        }
        if (it) { it.row = r; items.push(it); r._r = { graph: true, kind: it.kind }; }
      } catch (e) { r._r = { error: e.message || 'Cannot read this' }; }
    });
    refreshRowStatus();
  }

  const unwrap = n => { while (n && n.n === 'group') n = n.a; return n; };
  function dragSpec(node, sliders) {
    node = unwrap(node);
    if (node.n === 'num') return { lit: node.v };
    if (node.n === 'neg' && unwrap(node.a).n === 'num') return { lit: -unwrap(node.a).v };
    if (node.n === 'var' && sliders[node.name]) return { slider: node.name, row: sliders[node.name] };
    return null;
  }

  // a table is a list of points (and optionally a polyline)
  function buildTable(r) {
    r._r = { graph: true, kind: 'table' };
    const pts = [];
    const ctx = { funcs: new Set(), vars: new Set(Object.keys(env.V)) };
    const val = txt => {
      if (!String(txt).trim()) return NaN;
      const s = ME.parseStatement(txt, ctx);
      if (s.type !== 'value') return NaN;
      try { return ME.compile(s.ast, [], env)(); } catch (e) { return NaN; }
    };
    (r.rows || []).forEach(rw => { const x = val(rw[0]), y = val(rw[1]); if (isFinite(x) && isFinite(y)) pts.push({ x, y }); });
    items.push({ row: r, kind: 'table', pts });
  }

  /* ---------------------------------------------------------
     4. The view and drawing
     --------------------------------------------------------- */
  const canvas = () => $('#gCanvas');
  let ctx2 = null, W = 0, H = 0, dpr = 1, raf = 0, fastUntil = 0;
  const imgCache = new Map();                          // data URL -> Image

  function resizeCanvas() {
    const c = canvas(); if (!c) return false;
    const r = c.getBoundingClientRect();
    const w = Math.round(r.width), hgt = Math.round(r.height), d = window.devicePixelRatio || 1;
    if (!w || !hgt) return false;
    if (w !== W || hgt !== H || d !== dpr) {
      W = w; H = hgt; dpr = d;
      c.width = Math.round(W * d); c.height = Math.round(H * d);
      ctx2 = c.getContext('2d');
    }
    return true;
  }
  const X = x => st.view.ox + x * st.view.sx;                 // graph x -> screen x
  const Y = y => st.view.oy - y * st.view.sy;                 // graph y -> screen y
  const gx = px => (px - st.view.ox) / st.view.sx;            // screen -> graph
  const gy = py => (st.view.oy - py) / st.view.sy;
  function redraw(fast) {
    if (fast) fastUntil = performance.now() + 120;            // coarser (faster) sampling while the view is moving
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  // the part of the screen that is not covered by the rail / panel — used to centre the home view
  function visibleLeft() {
    const rail = $('#gRail').getBoundingClientRect().width;
    const panel = (!isPhone() && st.panelOpen) ? $('#gPanel').getBoundingClientRect().width : 0;
    return rail + panel;
  }
  function homeView() {
    const left = visibleLeft(), s = isPhone() ? 97 : 110;
    return { ox: left + (W - left) / 2, oy: H / 2, sx: s, sy: s };
  }

  // a "nice" grid step (1, 2 or 5 × 10^k) so major lines are at least ~60px apart
  function niceStep(pxPerUnit) {
    const raw = 60 / pxPerUnit, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = [1, 2, 5, 10].find(v => v * p >= raw * 0.999);
    return { step: m * p, minorDiv: m === 2 ? 4 : 5 };
  }
  function tickText(v, step) {
    if (Math.abs(v) < step * 1e-9) return '0';
    if (Math.abs(v) >= 1e6 || step >= 1e6) { const [m, e] = v.toExponential(3).split('e'); return parseFloat(m) + 'e' + parseInt(e, 10); }
    const dec = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    return String(+v.toFixed(dec));
  }

  function draw() {
    if (!resizeCanvas()) return;
    const c = ctx2, v = st.view, S = st.settings;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    const fast = performance.now() < fastUntil;

    drawGrid(c, v, S);
    // images and inequality shading go underneath the curves
    items.forEach(it => { if (!isHidden(it.row)) { if (it.kind === 'image') drawImage(c, it); else if (it.kind === 'ineq') drawIneqFill(c, it, fast); } });
    drawNumbers(c, v, S);
    items.forEach(it => { if (!isHidden(it.row)) drawItem(c, it, fast); });
    drawGeometry(c);
    if (st.hover) drawHover(c, st.hover);
  }

  /* --- grid, axes, numbers --- */
  function drawGrid(c, v, S) {
    const xs = niceStep(v.sx), ys = niceStep(v.sy);
    const x0 = gx(0), x1 = gx(W), y1 = gy(0), y0 = gy(H);
    const line = (x1_, y1_, x2_, y2_) => { c.moveTo(x1_, y1_); c.lineTo(x2_, y2_); };
    const snap = p => Math.round(p) + 0.5;
    if (S.grid) {
      // minor lines first (they would otherwise draw over the major ones)
      if (S.minor) {
        c.beginPath(); c.strokeStyle = '#c4c4c4'; c.lineWidth = 1;
        const mx = xs.step / xs.minorDiv, my = ys.step / ys.minorDiv;
        for (let i = Math.ceil(x0 / mx); i <= Math.floor(x1 / mx); i++) if (i % xs.minorDiv) line(snap(X(i * mx)), 0, snap(X(i * mx)), H);
        for (let i = Math.ceil(y0 / my); i <= Math.floor(y1 / my); i++) if (i % ys.minorDiv) line(0, snap(Y(i * my)), W, snap(Y(i * my)));
        c.stroke();
      }
      c.beginPath(); c.strokeStyle = '#3a3a3a'; c.lineWidth = 1;
      for (let i = Math.ceil(x0 / xs.step); i <= Math.floor(x1 / xs.step); i++) line(snap(X(i * xs.step)), 0, snap(X(i * xs.step)), H);
      for (let i = Math.ceil(y0 / ys.step); i <= Math.floor(y1 / ys.step); i++) line(0, snap(Y(i * ys.step)), W, snap(Y(i * ys.step)));
      c.stroke();
    }
    if (S.polar) drawPolarGrid(c, v, xs);
    if (S.axes) {
      c.beginPath(); c.strokeStyle = '#000'; c.lineWidth = 2.5;
      if (v.ox >= -2 && v.ox <= W + 2) line(Math.round(v.ox), 0, Math.round(v.ox), H);
      if (v.oy >= -2 && v.oy <= H + 2) line(0, Math.round(v.oy), W, Math.round(v.oy));
      c.stroke();
    }
  }
  function drawPolarGrid(c, v, xs) {
    c.save(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1;
    const maxR = Math.hypot(Math.max(Math.abs(gx(0)), Math.abs(gx(W))), Math.max(Math.abs(gy(0)), Math.abs(gy(H))));
    c.beginPath();
    for (let r = xs.step; r <= maxR && r / xs.step < 80; r += xs.step) { c.moveTo(X(r), v.oy); c.ellipse(v.ox, v.oy, r * v.sx, r * v.sy, 0, 0, TAU); }
    const L = maxR * Math.max(v.sx, v.sy);
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; c.moveTo(v.ox, v.oy); c.lineTo(v.ox + Math.cos(a) * L, v.oy - Math.sin(a) * L); }
    c.stroke(); c.restore();
  }
  function drawNumbers(c, v, S) {
    if (!S.numbers || !S.axes) return;
    const xs = niceStep(v.sx), ys = niceStep(v.sy);
    c.font = '14px Anta, sans-serif'; c.fillStyle = '#000'; c.textBaseline = 'top';
    // x-axis numbers sit just below the axis, to the left of their grid line (as in the design)
    const yPos = clamp(v.oy + 4, 4, H - 20);
    c.textAlign = 'right';
    for (let i = Math.ceil(gx(0) / xs.step); i <= Math.floor(gx(W) / xs.step); i++) {
      const px = X(i * xs.step) - 4;
      if (px < 14 || px > W + 40) continue;
      c.fillText(tickText(i * xs.step, xs.step), px, yPos);
    }
    // y-axis numbers sit left of the axis, just under their grid line
    const xPos = clamp(v.ox - 6, 38, W - 6);
    for (let i = Math.ceil(gy(H) / ys.step); i <= Math.floor(gy(0) / ys.step); i++) {
      if (i === 0) continue;
      const py = Y(i * ys.step) + 4;
      if (py < -4 || py > H) continue;
      c.fillText(tickText(i * ys.step, ys.step), xPos, py);
    }
  }

  /* --- curves --- */
  function strokeStyle(c, row, w = 2.5) {
    c.strokeStyle = c.fillStyle = row.color; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
    c.setLineDash(row.style === 'dashed' ? [9, 7] : row.style === 'dotted' ? [1.5, 6] : []);
  }
  function drawItem(c, it, fast) {
    c.save();
    strokeStyle(c, it.row);
    try {
      switch (it.kind) {
        case 'explicit': plotExplicit(c, it.fn, it.cond); break;
        case 'xexplicit': plotX(c, it.fn, it.cond); break;
        case 'polar': plotPolar(c, it); break;
        case 'param': plotParam(c, it); break;
        case 'implicit': marching(c, it.fn, it.cond, fast ? 6 : 3); break;
        case 'ineq': drawIneqBoundary(c, it, fast); break;
        case 'point': drawPoint(c, it); break;
        case 'table': drawTable(c, it); break;
      }
    } catch (e) { /* a bad value in one curve must not stop the others */ }
    c.restore();
  }
  const BIG = 1e5;
  // y = f(x), one sample per pixel; the pen lifts at gaps and across asymptotes
  function plotExplicit(c, f, cond) {
    c.beginPath();
    let pen = false, prev = 0;
    for (let px = -1; px <= W + 1; px++) {
      const x = gx(px);
      let y = f(x);
      if (cond && isFinite(y) && !cond(x, y)) y = NaN;
      if (!isFinite(y)) { pen = false; continue; }
      const py = clamp(Y(y), -BIG, BIG);
      if (pen && ((prev < 0 && py > H) || (prev > H && py < 0))) pen = false;   // jumped across the whole screen: asymptote
      if (pen) c.lineTo(px, py); else c.moveTo(px, py);
      pen = true; prev = py;
    }
    c.stroke();
  }
  function plotX(c, f, cond) {
    c.beginPath();
    let pen = false, prev = 0;
    for (let py = -1; py <= H + 1; py++) {
      const y = gy(py);
      let x = f(y);
      if (cond && isFinite(x) && !cond(x, y)) x = NaN;
      if (!isFinite(x)) { pen = false; continue; }
      const px = clamp(X(x), -BIG, BIG);
      if (pen && ((prev < 0 && px > W) || (prev > W && px < 0))) pen = false;
      if (pen) c.lineTo(px, py); else c.moveTo(px, py);
      pen = true; prev = px;
    }
    c.stroke();
  }
  function plotPolar(c, it) {
    const lo = it.lo(), hi = it.hi();
    if (!isFinite(lo) || !isFinite(hi)) return;
    const N = 4000; c.beginPath(); let pen = false;
    for (let i = 0; i <= N; i++) {
      const th = lo + (hi - lo) * i / N, arg = E.deg ? th / (Math.PI / 180) : th;
      const r = it.fn(arg);
      if (!isFinite(r) || (it.cond && !it.cond(arg, r))) { pen = false; continue; }
      const px = X(r * Math.cos(th)), py = Y(r * Math.sin(th));
      if (pen) c.lineTo(px, py); else c.moveTo(px, py);
      pen = true;
    }
    c.stroke();
  }
  function plotParam(c, it) {
    const lo = it.lo(), hi = it.hi();
    if (!isFinite(lo) || !isFinite(hi)) return;
    const N = 2500; c.beginPath(); let pen = false;
    for (let i = 0; i <= N; i++) {
      const t = lo + (hi - lo) * i / N;
      const x = it.fx(t), y = it.fy(t);
      if (!isFinite(x) || !isFinite(y) || (it.cond && !it.cond(t))) { pen = false; continue; }
      const px = clamp(X(x), -BIG, BIG), py = clamp(Y(y), -BIG, BIG);
      if (pen) c.lineTo(px, py); else c.moveTo(px, py);
      pen = true;
    }
    c.stroke();
  }

  /* implicit curve F(x, y) = 0 by marching squares: the screen is cut into small cells; where F changes sign
     between two corners, the curve crosses that edge (position found by linear interpolation) */
  function marching(c, F, cond, cell) {
    const nx = Math.ceil(W / cell) + 1, ny = Math.ceil(H / cell) + 1;
    const vals = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const y = gy(j * cell);
      for (let i = 0; i < nx; i++) {
        const x = gx(i * cell);
        let v = F(x, y);
        if (cond && !cond(x, y)) v = NaN;
        vals[j * nx + i] = v;
      }
    }
    c.beginPath();
    const cross = (a, b) => a / (a - b);                       // where along an edge F is zero
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = vals[j * nx + i], b = vals[j * nx + i + 1], cc = vals[(j + 1) * nx + i + 1], d = vals[(j + 1) * nx + i];
        if (!(isFinite(a) && isFinite(b) && isFinite(cc) && isFinite(d))) continue;
        const m = Math.max(Math.abs(a), Math.abs(b), Math.abs(cc), Math.abs(d));
        if (m > 1e12) continue;                                 // asymptote: values are exploding
        const idx = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (cc > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x0 = i * cell, y0 = j * cell;
        const top = () => [x0 + cross(a, b) * cell, y0], right = () => [x0 + cell, y0 + cross(b, cc) * cell];
        const bottom = () => [x0 + cross(d, cc) * cell, y0 + cell], left = () => [x0, y0 + cross(a, d) * cell];
        const seg = (p, q) => { c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); };
        switch (idx) {
          case 1: case 14: seg(left(), bottom()); break;
          case 2: case 13: seg(bottom(), right()); break;
          case 3: case 12: seg(left(), right()); break;
          case 4: case 11: seg(top(), right()); break;
          case 6: case 9: seg(top(), bottom()); break;
          case 7: case 8: seg(left(), top()); break;
          case 5: case 10: {                                      // saddle: decide by the centre value
            const centre = (a + b + cc + d) / 4;
            if ((centre > 0) === (idx === 5)) { seg(left(), top()); seg(bottom(), right()); } else { seg(left(), bottom()); seg(top(), right()); }
          }
        }
      }
    }
    c.stroke();
  }

  /* inequalities: the region is painted into a small off-screen image, one pixel per `cell` screen pixels */
  const shade = document.createElement('canvas');
  function drawIneqFill(c, it, fast) {
    const cell = fast ? 5 : 2, nx = Math.ceil(W / cell), ny = Math.ceil(H / cell);
    shade.width = nx; shade.height = ny;
    const sc = shade.getContext('2d'), img = sc.createImageData(nx, ny), d = img.data;
    const rgb = hex2rgb(it.row.color), rel = it.rel;
    for (let j = 0; j < ny; j++) {
      const y = gy((j + .5) * cell);
      for (let i = 0; i < nx; i++) {
        const x = gx((i + .5) * cell);
        const l = it.L(x, y), r = it.R(x, y);
        let on = rel === '<' ? l < r : rel === '>' ? l > r : rel === '<=' ? l <= r : l >= r;
        if (on && it.cond && !it.cond(x, y)) on = false;
        if (on) { const k = (j * nx + i) * 4; d[k] = rgb[0]; d[k + 1] = rgb[1]; d[k + 2] = rgb[2]; d[k + 3] = 77; }
      }
    }
    sc.putImageData(img, 0, 0);
    c.save(); c.imageSmoothingEnabled = false; c.drawImage(shade, 0, 0, nx * cell, ny * cell); c.restore();
  }
  function drawIneqBoundary(c, it, fast) {
    c.setLineDash(it.rel === '<' || it.rel === '>' ? [10, 8] : (it.row.style === 'dotted' ? [1.5, 6] : []));     // dashed boundary when the value itself is not included
    if (it.bd) it.bd.kind === 'y' ? plotExplicit(c, it.bd.fn, null) : plotX(c, it.bd.fn, null);
    else marching(c, it.F, it.cond, fast ? 6 : 3);
  }
  const hex2rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  /* points and tables */
  function dot(c, x, y, color, r = 5.5) {
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = color; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.setLineDash([]); c.stroke();
  }
  // the coordinates of a point item as a list of [x, y] pairs (a list like (L1, L2) gives several points)
  function pointList(it) {
    const x = it.fx(), y = it.fy();
    if (it.cond && !it.cond()) return [];
    const xs = Array.isArray(x), ys = Array.isArray(y);
    if (!xs && !ys) return isFinite(x) && isFinite(y) ? [[x, y]] : [];
    const n = Math.min(xs ? x.length : Infinity, ys ? y.length : Infinity), out = [];
    for (let i = 0; i < n; i++) { const a = xs ? x[i] : x, b = ys ? y[i] : y; if (isFinite(a) && isFinite(b)) out.push([a, b]); }
    return out;
  }
  function drawPoint(c, it) { pointList(it).forEach(p => dot(c, X(p[0]), Y(p[1]), it.row.color)); }
  function drawTable(c, it) {
    if (it.row.line && it.pts.length > 1) {
      c.beginPath(); it.pts.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y)))); c.stroke();
    }
    it.pts.forEach(p => dot(c, X(p.x), Y(p.y), it.row.color));
  }

  /* images added from the "+" menu: centred at (cx, cy), width and height in graph units */
  function drawImage(c, it) {
    const r = it.row; if (!r.data) return;
    let im = imgCache.get(r.data);
    if (!im) { im = new Image(); im.onload = () => redraw(); im.src = r.data; imgCache.set(r.data, im); }
    if (!im.complete || !im.naturalWidth) return;
    const w = num(r.w, 6), hh = num(r.h, 6), cx = num(r.cx, 0), cy = num(r.cy, 0);
    c.save(); c.globalAlpha = clamp(r.opacity == null ? 1 : r.opacity, 0, 1);
    c.drawImage(im, X(cx - w / 2), Y(cy + hh / 2), w * st.view.sx, hh * st.view.sy);
    c.restore();
  }
  const num = (v, d) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);

  /* geometry objects (shared drawing code with the whiteboard).
     Geometry lives in "world" units; one graph unit = K world units, and y points down in world units. */
  function withWorld(c, fn) {
    c.save(); c.translate(st.view.ox, st.view.oy); c.scale(st.view.sx / K(), st.view.sy / K()); fn(); c.restore();
  }
  const geoScale = () => st.view.sx / K();
  function drawGeometry(c) {
    if (!st.geo.objects.length && !st.geo.tool) return;
    // geometry sizes are in world units, which are scaled by the view; divide line widths by that scale so lines stay ~2px on screen
    const drawObj = (cc, o) => window.Whiteboard.renderObject(cc, o.size ? Object.assign({}, o, { size: o.size / geoScale() }) : o, geoScale());
    withWorld(c, () => {
      st.geo.objects.forEach(o => { if (!o.hidden || hiddenVisible()) drawObj(c, o); });
      if (geo) geo.draw(c, drawObj);
    });
  }
  const hiddenVisible = () => st.geo.tool === 'showhide';

  /* hover tooltip highlight */
  function drawHover(c, hv) {
    c.save(); c.beginPath(); c.arc(hv.px, hv.py, 6.5, 0, TAU); c.fillStyle = hv.color; c.fill();
    c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); c.restore();
  }

  /* --- view changes --- */
  function setView(v, fast = true) { st.view = v; redraw(fast); save(); }
  function zoomAt(fx, fy, px, py) {                    // zoom by factors fx / fy keeping screen point (px, py) fixed
    const v = st.view;
    const sx = clamp(v.sx * fx, 1e-5, 1e8), sy = clamp(v.sy * fy, 1e-5, 1e8);
    setView({ ox: px - (px - v.ox) * (sx / v.sx), oy: py - (py - v.oy) * (sy / v.sy), sx, sy });
  }
  function animateTo(target) {
    const from = Object.assign({}, st.view), t0 = performance.now(), dur = 220;
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      const t = clamp((now - t0) / dur, 0, 1), k = ease(t);
      st.view = {
        ox: from.ox + (target.ox - from.ox) * k, oy: from.oy + (target.oy - from.oy) * k,
        sx: Math.exp(Math.log(from.sx) + (Math.log(target.sx) - Math.log(from.sx)) * k), sy: Math.exp(Math.log(from.sy) + (Math.log(target.sy) - Math.log(from.sy)) * k)
      };
      redraw(true);
      if (t < 1) requestAnimationFrame(step); else save();
    };
    requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------
     5. The equation panel
     --------------------------------------------------------- */
  let keypad = null;
  const fields = new Map();                            // row id -> { type:'math'|'text', el }
  const rowEls = new Map();                            // row id -> element
  let showErrTimer = 0;

  // the field currently being typed in (the keypad writes into it)
  const activeField = () => (st.active ? fields.get(st.active) : null);
  const lastField = { f: null };                       // remembered so the keypad still works right after tapping a key

  // a folder holds the rows that follow it, up to the next folder
  function assignFolders() {
    let cur = null;
    st.rows.forEach(r => { if (r.type === 'folder') { cur = r; r._folder = null; } else r._folder = cur; });
  }
  const isHidden = r => !!(r.hidden || (r._folder && r._folder.hidden));
  const isEmptyExpr = r => r.type === 'expr' && !r.src.trim();
  function ensureTrailingEmpty() {
    const last = st.rows[st.rows.length - 1];
    if (!last || !isEmptyExpr(last)) { st.rows.push(newRow('expr')); return true; }
    return false;
  }

  function buildPanel() {
    const box = $('#gRows');
    const keepScroll = box.scrollTop;
    box.innerHTML = ''; fields.clear(); rowEls.clear();
    st.rows.forEach((r, i) => box.appendChild(makeRow(r, i)));
    box.appendChild(h('div', { id: 'gGeo' }));
    renderGeoList();
    box.scrollTop = keepScroll;
    window.UI.hydrateIcons(box);
    refreshRowStatus();
  }
  // refresh numbers, colour dots, results, errors and sliders without rebuilding the inputs
  function refreshRowStatus() {
    assignFolders();
    let count = 0;
    st.rows.forEach(r => {
      const el = rowEls.get(r.id); if (!el) return;
      if (r.type !== 'folder') { count++; el.querySelector('.g-n').textContent = count; }
      el.classList.toggle('in-folder', !!r._folder);
      el.hidden = !!(r._folder && r._folder.collapsed);
      const info = r._r || {};
      const dotEl = el.querySelector('.g-dot');
      el.classList.toggle('has-graph', !!info.graph);
      el.classList.toggle('is-hidden', !!r.hidden);
      el.classList.toggle('active', st.active === r.id);
      dotEl.style.setProperty('--c', r.color);
      if (r.type === 'expr') {
        el.classList.toggle('empty', !r.src.trim());
        const out = el.querySelector('.g-out'); out.textContent = info.out || ''; out.hidden = !info.out;
        const err = el.querySelector('.g-err');
        err.textContent = info.error || ''; err.hidden = !(info.error && r._showErr);
        // slider for variables like  a = 1
        let sl = el.querySelector('.g-slider');
        if (info.slider && isFinite(info.value)) { if (!sl) sl = addSlider(el, r); updateSlider(sl, r, info.value); }
        else if (sl) sl.remove();
      }
    });
  }

  function makeRow(r, i) {
    const el = h('div', { class: 'g-row type-' + r.type, 'data-id': r.id });
    rowEls.set(r.id, el);
    const dot = h('button', { class: 'g-dot', type: 'button', title: 'Colour, style and visibility', 'aria-label': 'Row options', onclick: e => {
      e.stopPropagation();
      if (suppressClick) return;                                    // the click that ends a drag is not a click
      if (r.type === 'folder') toggleFolder(r, dot); else openRowMenu(r, dot);
    } }, h('span', { class: 'g-n', text: i + 1 }));
    const num = h('div', { class: 'g-num', title: 'Drag to reorder' }, dot);
    num.addEventListener('pointerdown', e => startReorder(e, r, el));
    const main = h('div', { class: 'g-main' });
    const del = h('button', { class: 'g-del', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: e => { e.stopPropagation(); deleteRow(r); } });
    del.innerHTML = window.ICONS.close;
    el.append(num, main, del);

    if (r.type === 'expr') buildExprField(r, main, el);
    else if (r.type === 'note') buildNote(r, main);
    else if (r.type === 'image') buildImageRow(r, main);
    else if (r.type === 'table') buildTableRow(r, main);
    else if (r.type === 'folder') buildFolder(r, main, dot);

    main.append(h('div', { class: 'g-out', hidden: true }), h('div', { class: 'g-err', hidden: true }));
    el.addEventListener('pointerdown', e => { if (e.target === el || e.target === main) { e.preventDefault(); focusRow(r); } });
    return el;
  }

  /* --- an expression row --- */
  function buildExprField(r, main, el) {
    const wrap = h('div', { class: 'g-input' });
    let f;
    if (useMath) {
      const mf = document.createElement('math-field');
      mf.className = 'g-mf';
      try { mf.mathVirtualKeyboardPolicy = 'manual'; } catch (e) { /* older versions */ }
      mf.setAttribute('virtual-keyboard-mode', 'off');
      try { mf.smartFence = true; mf.smartMode = false; mf.popoverPolicy = 'off'; mf.menuItems = []; } catch (e) { /* ignore */ }
      if (r.mode === 'text' && r.src) { try { mf.setValue(r.src, { format: 'ascii-math' }); r.src = mf.value; } catch (e) { /* keep text */ } }
      else mf.value = r.src || '';
      r.mode = 'latex';
      mf.addEventListener('input', () => { r.src = mf.value; onEdit(r); });
      mf.addEventListener('focus', () => setActive(r));
      mf.addEventListener('blur', () => { r._showErr = true; refreshRowStatus(); });
      mf.addEventListener('keydown', e => rowKeys(e, r, true));
      mf.addEventListener('move-out', e => {                      // arrow keys leaving the field move to the neighbouring row
        const d = e.detail && e.detail.direction;
        if (d === 'upward' || d === 'backward') { e.preventDefault(); focusNeighbour(r, -1); }
        if (d === 'downward' || d === 'forward') { e.preventDefault(); focusNeighbour(r, 1); }
      });
      f = { type: 'math', el: mf };
    } else {
      const inp = h('input', { type: 'text', class: 'g-plain', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', value: r.mode === 'text' ? r.src : ME.latexToText(r.src) });
      r.mode = 'text'; r.src = inp.value;
      inp.addEventListener('input', () => { r.src = inp.value; onEdit(r); });
      inp.addEventListener('focus', () => setActive(r));
      inp.addEventListener('blur', () => { r._showErr = true; refreshRowStatus(); });
      inp.addEventListener('keydown', e => rowKeys(e, r, false));
      f = { type: 'text', el: inp };
    }
    fields.set(r.id, f);
    wrap.append(f.el, h('span', { class: 'g-ph', text: 'Input…' }));
    main.append(wrap);
  }
  function rowKeys(e, r, isMath) {
    if (e.key === 'Enter') { e.preventDefault(); focusNeighbour(r, 1, true); }
    else if (e.key === 'Backspace' && !r.src.trim() && st.rows.length > 1) { e.preventDefault(); deleteRow(r, true); }
    else if (!isMath && e.key === 'ArrowUp') { e.preventDefault(); focusNeighbour(r, -1); }
    else if (!isMath && e.key === 'ArrowDown') { e.preventDefault(); focusNeighbour(r, 1); }
  }
  function setActive(r) {
    st.active = r.id; lastField.f = fields.get(r.id);
    rowEls.forEach((el, id) => el.classList.toggle('active', id === r.id));
  }
  function focusRow(r) {
    const f = fields.get(r.id);
    if (f) { f.el.focus(); setActive(r); }
  }
  function focusNeighbour(r, dir, create) {
    const i = st.rows.indexOf(r) + dir;
    if (i >= st.rows.length && create) { st.rows.push(newRow('expr')); buildPanel(); }
    const t = st.rows[clamp(i, 0, st.rows.length - 1)];
    if (t) focusRow(t);
  }

  /* Dragging the number column moves a row (a folder moves together with the rows inside it). */
  let suppressClick = false;
  function startReorder(e, r, el) {
    if (e.button) return;
    const startY = e.clientY, box = $('#gRows');
    let dragging = false, target = null;
    const i0 = st.rows.indexOf(r), members = [r];
    if (r.type === 'folder') for (let k = i0 + 1; k < st.rows.length && st.rows[k].type !== 'folder'; k++) members.push(st.rows[k]);
    const marks = () => box.querySelectorAll('.drop-before,.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    const move = ev => {
      const dy = ev.clientY - startY;
      if (!dragging) { if (Math.abs(dy) < 6) return; dragging = true; el.classList.add('dragging'); box.classList.add('reordering'); }
      el.style.transform = `translateY(${dy}px)`;
      marks(); target = null;
      const others = st.rows.filter(x => !members.includes(x) && rowEls.get(x.id) && !rowEls.get(x.id).hidden);
      for (const x of others) { const b = rowEls.get(x.id).getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { target = { row: x, after: false }; break; } }
      if (!target && others.length) target = { row: others[others.length - 1], after: true };
      if (target) rowEls.get(target.row.id).classList.add(target.after ? 'drop-after' : 'drop-before');
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!dragging) return;
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
      el.classList.remove('dragging'); el.style.transform = ''; box.classList.remove('reordering'); marks();
      if (!target) return;
      const rest = st.rows.filter(x => !members.includes(x));
      rest.splice(rest.indexOf(target.row) + (target.after ? 1 : 0), 0, ...members);
      st.rows = rest; ensureTrailingEmpty();
      recompute(1); buildPanel(); redraw(); save(); pushHistory();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  // called on every keystroke in a row
  let histTimer = 0;
  function onEdit(r) {
    r._showErr = false;
    clearTimeout(showErrTimer);
    showErrTimer = setTimeout(() => { st.rows.forEach(x => { x._showErr = true; }); refreshRowStatus(); }, 1100);
    scheduleHistory();
    const grew = ensureTrailingEmpty();
    recompute();
    if (grew) { const box = $('#gRows'); const nr = st.rows[st.rows.length - 1]; box.appendChild(makeRow(nr, st.rows.length - 1)); window.UI.hydrateIcons(box); }
    refreshRowStatus(); redraw(); save();
  }
  function scheduleHistory() { clearTimeout(histTimer); histTimer = setTimeout(pushHistory, 700); }

  function deleteRow(r, focusPrev) {
    pushHistory();
    const i = st.rows.indexOf(r);
    st.rows.splice(i, 1);
    ensureTrailingEmpty();
    if (!st.rows.length) st.rows.push(newRow('expr'));
    recompute(); buildPanel(); redraw(); save();
    if (focusPrev) { const t = st.rows[Math.max(0, i - 1)]; focusRow(t); }
  }

  /* --- slider under a variable row --- */
  function addSlider(el, r) {
    if (!r.slider) r.slider = { min: -10, max: 10, step: 0.01 };
    const sl = h('div', { class: 'g-slider' });
    const lo = h('input', { class: 'g-bound', type: 'text', value: r.slider.min, 'aria-label': 'Slider minimum' });
    const hi = h('input', { class: 'g-bound', type: 'text', value: r.slider.max, 'aria-label': 'Slider maximum' });
    const range = h('input', { class: 'g-range', type: 'range', min: r.slider.min, max: r.slider.max, step: 'any', 'aria-label': 'Value' });
    const play = h('button', { class: 'g-play', type: 'button', title: 'Animate', 'aria-label': 'Animate' });
    play.innerHTML = window.ICONS.play;
    lo.addEventListener('change', () => { const v = num(lo.value, r.slider.min); r.slider.min = Math.min(v, r.slider.max - 1e-9); lo.value = r.slider.min; syncSlider(sl, r); save(); });
    hi.addEventListener('change', () => { const v = num(hi.value, r.slider.max); r.slider.max = Math.max(v, r.slider.min + 1e-9); hi.value = r.slider.max; syncSlider(sl, r); save(); });
    range.addEventListener('input', () => setSliderValue(r, +range.value, true));
    range.addEventListener('change', pushHistory);
    play.addEventListener('click', () => toggleAnimation(r, play));
    sl.append(h('div', { class: 'g-slider-top' }, h('span', { class: 'g-val' }), play), h('div', { class: 'g-slider-bar' }, lo, range, hi));
    el.querySelector('.g-main').insertBefore(sl, el.querySelector('.g-out'));
    return sl;
  }
  function syncSlider(sl, r) {
    const range = sl.querySelector('.g-range');
    range.min = r.slider.min; range.max = r.slider.max;
    const v = (r._r && r._r.value) || 0;
    range.value = v;
    range.style.setProperty('--p', clamp((v - r.slider.min) / (r.slider.max - r.slider.min), 0, 1) * 100 + '%');
  }
  function updateSlider(sl, r, value) {
    if (value < r.slider.min) { r.slider.min = Math.floor(value); sl.querySelector('.g-bound').value = r.slider.min; }
    if (value > r.slider.max) { r.slider.max = Math.ceil(value); sl.querySelectorAll('.g-bound')[1].value = r.slider.max; }
    sl.querySelector('.g-val').textContent = r._r.name + ' = ' + ME.format(value, 6);
    syncSlider(sl, r);
  }
  // moving the slider rewrites the text of the row:  a = 1.37
  function setSliderValue(r, v, live) {
    const text = r._r.name + '=' + ME.format(+v.toFixed(6), 8).replace('×10^', 'e');
    r.src = r.mode === 'latex' ? r._r.name + '=' + (+v.toFixed(6)) : text;
    const f = fields.get(r.id);
    if (f) { if (f.type === 'math') { f.el.value = r.src; } else f.el.value = r.src; }
    recompute(1); refreshRowStatus(); redraw(true); save();
    if (!live) pushHistory();
  }
  const playing = new Map();                           // row id -> animation state
  function toggleAnimation(r, btn) {
    if (playing.has(r.id)) { playing.delete(r.id); btn.innerHTML = window.ICONS.play; return; }
    btn.innerHTML = window.ICONS.pause;
    playing.set(r.id, { dir: 1, last: performance.now(), btn });
    const tick = now => {
      const a = playing.get(r.id); if (!a) return;
      if (!st.rows.includes(r)) { playing.delete(r.id); return; }
      const dt = (now - a.last) / 1000; a.last = now;
      const span = r.slider.max - r.slider.min;
      let v = (r._r.value || 0) + a.dir * span / 8 * dt;                // a full sweep takes ~8 seconds
      if (v >= r.slider.max) { v = r.slider.max; a.dir = -1; } else if (v <= r.slider.min) { v = r.slider.min; a.dir = 1; }
      setSliderValue(r, v, true);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* --- folder row --- */
  function toggleFolder(r, dot) {
    r.collapsed = !r.collapsed;
    dot.classList.toggle('collapsed', r.collapsed);
    refreshRowStatus(); save();
  }
  function buildFolder(r, main, dot) {
    dot.innerHTML = window.ICONS.chevDown;
    dot.classList.toggle('collapsed', !!r.collapsed);
    dot.title = 'Open or close the folder';
    const title = h('input', { type: 'text', class: 'g-folder-title', placeholder: 'Folder', value: r.title || '', 'aria-label': 'Folder name', spellcheck: 'false' });
    title.addEventListener('input', () => { r.title = title.value; save(); });
    title.addEventListener('focus', () => { st.active = r.id; });
    const vis = h('button', { class: 'g-chip small', type: 'button', text: r.hidden ? 'Show' : 'Hide', title: 'Show or hide everything in this folder on the graph' });
    vis.addEventListener('click', () => { r.hidden = !r.hidden; vis.textContent = r.hidden ? 'Show' : 'Hide'; redraw(); save(); });
    main.append(h('div', { class: 'g-folder-row' }, title, vis));
  }

  /* --- note row --- */
  function buildNote(r, main) {
    const ta = h('textarea', { class: 'g-note', rows: 1, placeholder: 'Add a note…', spellcheck: 'true' });
    ta.value = r.src;
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.addEventListener('input', () => { r.src = ta.value; grow(); scheduleHistory(); save(); });
    ta.addEventListener('focus', () => { st.active = r.id; });
    main.append(ta);
    requestAnimationFrame(grow);
  }

  /* --- image row --- */
  function buildImageRow(r, main) {
    const field = (label, key, def) => {
      const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'g-num-in', value: r[key] == null ? def : r[key], 'aria-label': label });
      inp.addEventListener('input', () => { r[key] = inp.value; redraw(); save(); });
      inp.addEventListener('change', pushHistory);
      return h('label', { class: 'g-fld' }, h('span', { text: label }), inp);
    };
    const op = h('input', { class: 'g-range', type: 'range', min: 0, max: 1, step: 0.01, value: r.opacity == null ? 1 : r.opacity, 'aria-label': 'Opacity' });
    const setP = () => op.style.setProperty('--p', op.value * 100 + '%');
    setP();
    op.addEventListener('input', () => { r.opacity = +op.value; setP(); redraw(); save(); });
    main.append(
      h('div', { class: 'g-img-top' }, h('img', { class: 'g-thumb', src: r.data, alt: 'Image' }), h('span', { class: 'g-img-name', text: r.name || 'Image' })),
      h('div', { class: 'g-flds' }, field('Centre x', 'cx', 0), field('Centre y', 'cy', 0), field('Width', 'w', 6), field('Height', 'h', 6)),
      h('div', { class: 'g-opac' }, h('span', { text: 'Opacity' }), op));
  }

  /* --- table row --- */
  function buildTableRow(r, main) {
    if (!r.rows) r.rows = [['', ''], ['', ''], ['', '']];
    const tbl = h('div', { class: 'g-table' });
    const render = () => {
      tbl.innerHTML = '';
      tbl.append(h('div', { class: 'g-trow head' }, h('span', { html: 'x<sub>1</sub>' }), h('span', { html: 'y<sub>1</sub>' })));
      r.rows.forEach((rw, i) => {
        const a = h('input', { type: 'text', value: rw[0], 'aria-label': 'x value, row ' + (i + 1), inputmode: 'decimal' });
        const b = h('input', { type: 'text', value: rw[1], 'aria-label': 'y value, row ' + (i + 1), inputmode: 'decimal' });
        const upd = () => {
          rw[0] = a.value; rw[1] = b.value;
          const last = r.rows[r.rows.length - 1];
          if (last[0].trim() || last[1].trim()) { r.rows.push(['', '']); const keepA = document.activeElement === a, keepB = document.activeElement === b; tbl.append(rowFor(r.rows.length - 1)); void keepA; void keepB; }
          recompute(1); redraw(); save(); scheduleHistory();
        };
        a.addEventListener('input', upd); b.addEventListener('input', upd);
        tbl.append(h('div', { class: 'g-trow' }, a, b));
      });
    };
    // builds one extra input row without redrawing the others (so typing is not interrupted)
    const rowFor = i => {
      const rw = r.rows[i];
      const a = h('input', { type: 'text', value: rw[0], inputmode: 'decimal', 'aria-label': 'x value' });
      const b = h('input', { type: 'text', value: rw[1], inputmode: 'decimal', 'aria-label': 'y value' });
      const upd = () => {
        rw[0] = a.value; rw[1] = b.value;
        const last = r.rows[r.rows.length - 1];
        if (last[0].trim() || last[1].trim()) { r.rows.push(['', '']); tbl.append(rowFor(r.rows.length - 1)); }
        recompute(1); redraw(); save(); scheduleHistory();
      };
      a.addEventListener('input', upd); b.addEventListener('input', upd);
      return h('div', { class: 'g-trow' }, a, b);
    };
    render();
    const lineBtn = h('button', { class: 'g-chip' + (r.line ? ' on' : ''), type: 'button', text: 'Connect points' });
    lineBtn.addEventListener('click', () => { r.line = !r.line; lineBtn.classList.toggle('on', r.line); redraw(); save(); });
    main.append(tbl, lineBtn);
  }

  /* --- geometry objects drawn with the Tools tab, listed under the equations (like GeoGebra's Algebra view) --- */
  function describeGeo(o) {
    const k = K(), f = v => ME.format(+(+v).toPrecision(5), 6), P = p => '(' + f(p.x / k) + ', ' + f(-p.y / k) + ')';
    switch (o.type) {
      case 'dot': return { name: o.label || 'Point', text: P(o) };
      case 'seg': {
        const dx = (o.b.x - o.a.x) / k, dy = -(o.b.y - o.a.y) / k;
        if (o.arrow) return { name: 'Vector', text: '⟨' + f(dx) + ', ' + f(dy) + '⟩' };
        if (o.ext === 'line') {
          if (Math.abs(dx) < 1e-9) return { name: 'Line', text: 'x = ' + f(o.a.x / k) };
          const m = dy / dx, c = -o.a.y / k - m * (o.a.x / k);
          return { name: 'Line', text: 'y = ' + f(m) + 'x ' + (c < 0 ? '− ' : '+ ') + f(Math.abs(c)) };
        }
        if (o.ext === 'ray') return { name: 'Ray', text: 'from ' + P(o.a) };
        return { name: 'Segment', text: 'length ' + f(Math.hypot(dx, dy)) };
      }
      case 'circle': return { name: 'Circle', text: 'centre ' + P({ x: o.cx, y: o.cy }) + ', r = ' + f(o.r / k) };
      case 'arc': return { name: 'Arc', text: 'r = ' + f(o.r / k) };
      case 'sector': return { name: 'Sector', text: 'r = ' + f(o.r / k) };
      case 'poly': {
        let a = 0; o.pts.forEach((p, i) => { const q = o.pts[(i + 1) % o.pts.length]; a += p.x * q.y - q.x * p.y; });
        return { name: 'Polygon', text: o.pts.length + ' vertices, area ' + f(Math.abs(a) / 2 / (k * k)) };
      }
      case 'image': return { name: 'Image', text: '' };
      case 'label': case 'text': return { name: 'Text', text: o.text || '' };
      default: return { name: o.type, text: '' };
    }
  }
  function renderGeoList() {
    const box = $('#gGeo'); if (!box) return;
    box.innerHTML = '';
    const list = st.geo.objects.filter(o => !o.erase);
    if (!list.length) return;
    box.append(h('div', { class: 'g-geo-title', text: 'Geometry' }));
    list.forEach(o => {
      const d = describeGeo(o);
      const eye = h('button', { class: 'g-gbtn' + (o.hidden ? ' off' : ''), type: 'button', title: o.hidden ? 'Show' : 'Hide', 'aria-label': o.hidden ? 'Show object' : 'Hide object' });
      eye.innerHTML = o.hidden ? window.ICONS.eyeOff : window.ICONS.eye;
      eye.addEventListener('click', () => { o.hidden = !o.hidden; pushHistory(); renderGeoList(); redraw(); save(); });
      const del = h('button', { class: 'g-gbtn', type: 'button', title: 'Delete', 'aria-label': 'Delete object' });
      del.innerHTML = window.ICONS.close;
      del.addEventListener('click', () => { st.geo.objects = st.geo.objects.filter(x => x !== o); if (geo) geo.reset(); pushHistory(); renderGeoList(); redraw(); save(); });
      box.append(h('div', { class: 'g-grow' }, h('span', { class: 'g-gname', text: d.name }), h('span', { class: 'g-gtext', text: d.text }), eye, del));
    });
  }

  /* --- popup menus --- */
  let popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; } window.removeEventListener('pointerdown', outside, true); }
  function outside(e) { if (popEl && !popEl.contains(e.target)) closePop(); }
  function openPop(node, anchor) {
    closePop();
    popEl = h('div', { class: 'g-pop' }, node);
    $('#ws-graph').appendChild(popEl);
    const a = anchor.getBoundingClientRect(), root = $('#ws-graph').getBoundingClientRect(), w = popEl.offsetWidth, hh = popEl.offsetHeight;
    popEl.style.left = clamp(a.left - root.left, 8, root.width - w - 8) + 'px';
    popEl.style.top = clamp(a.bottom - root.top + 6, 8, root.height - hh - 8) + 'px';
    setTimeout(() => window.addEventListener('pointerdown', outside, true), 0);
  }

  function openRowMenu(r, anchor) {
    const info = r._r || {};
    const box = h('div', { class: 'g-menu-card' });
    if (info.graph || r.type === 'image' || r.type === 'table') {
      box.append(h('div', { class: 'g-menu-title', text: 'Colour' }),
        window.UI.swatches({ colors: PALETTE, value: r.color, onPick: c => { r.color = c; refreshRowStatus(); redraw(); save(); } }));
      if (r.type === 'expr') {
        const styles = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];
        const seg = h('div', { class: 'g-seg' }, ...styles.map(([k, label]) => h('button', {
          type: 'button', class: r.style === k ? 'on' : '', text: label,
          onclick: e => { r.style = k; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); redraw(); save(); }
        })));
        box.append(h('div', { class: 'g-menu-title', text: 'Line style' }), seg);
      }
      box.append(h('button', { class: 'g-menu-item', type: 'button', text: r.hidden ? 'Show on graph' : 'Hide from graph', onclick: () => { r.hidden = !r.hidden; refreshRowStatus(); redraw(); save(); closePop(); } }));
    }
    box.append(h('button', { class: 'g-menu-item danger', type: 'button', text: 'Delete', onclick: () => { closePop(); deleteRow(r); } }));
    openPop(box, anchor);
  }

  // the "+" menu: Expression / Note / Image / Table
  function openAddMenu() {
    const item = (icon, label, fn) => h('button', { class: 'g-menu-item with-icon', type: 'button', onclick: () => { closePop(); fn(); } },
      h('span', { class: 'mi', html: window.ICONS[icon] }), h('span', { text: label }));
    openPop(h('div', { class: 'g-menu-card' },
      item('expr', 'Expression', () => addRow(newRow('expr'))),
      item('note', 'Note', () => addRow(newRow('note'))),
      item('folder', 'Folder', () => addRow(newRow('folder', { title: '', collapsed: false }))),
      item('image', 'Image', addImage),
      item('table', 'Table', () => addRow(newRow('table', { rows: [['', ''], ['', ''], ['', '']] })))), $('#gAdd'));
  }
  function addRow(row) {
    pushHistory();
    const at = st.active ? st.rows.findIndex(r => r.id === st.active) : -1;
    const lastEmpty = st.rows.length && isEmptyExpr(st.rows[st.rows.length - 1]);
    // an empty expression row just before the end is replaced rather than left behind
    if (row.type === 'expr' && lastEmpty) { focusRow(st.rows[st.rows.length - 1]); return; }
    st.rows.splice(at >= 0 ? at + 1 : Math.max(0, st.rows.length - (lastEmpty ? 1 : 0)), 0, row);
    ensureTrailingEmpty();
    recompute(1); buildPanel(); redraw(); save();
    if (row.type === 'expr') focusRow(row);
    $('#gRows').querySelector(`[data-id="${row.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function addImage() {
    const inp = h('input', { type: 'file', accept: 'image/*' });
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const im = new Image();
        im.onload = () => {
          const w = 6, hh = +(w * im.naturalHeight / im.naturalWidth).toFixed(3);
          // centred in the visible part of the graph
          const cx = +gx(visibleLeft() + (W - visibleLeft()) / 2).toFixed(3), cy = +gy(H / 2).toFixed(3);
          addRow(newRow('image', { data: rd.result, name: f.name, cx, cy, w, h: hh, opacity: 1 }));
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(f);
    };
    inp.click();
  }

  /* ---------------------------------------------------------
     Undo / redo (rows + geometry)
     --------------------------------------------------------- */
  const snapshot = () => JSON.stringify({ rows: st.rows.map(strip), geo: st.geo.objects, labelCount: st.geo.labelCount });
  let lastSnap = '';
  function pushHistory() {
    clearTimeout(histTimer);
    const s = snapshot();
    if (s === lastSnap) return;
    if (lastSnap) { st.undo.push(lastSnap); if (st.undo.length > 100) st.undo.shift(); st.redo = []; }
    lastSnap = s; updateHistoryButtons();
  }
  function restore(s) {
    const d = JSON.parse(s);
    st.rows = d.rows; st.geo.objects = d.geo; st.geo.labelCount = d.labelCount;
    lastSnap = s;
    if (geo) geo.reset();
    recompute(1); buildPanel(); redraw(); save(); updateHistoryButtons();
  }
  function undo() { pushHistory(); if (st.undo.length) { st.redo.push(lastSnap); restore(st.undo.pop()); } }
  function redo() { if (st.redo.length) { st.undo.push(lastSnap); restore(st.redo.pop()); } }
  function updateHistoryButtons() {
    const u = document.querySelector('[data-gact="undo"]'), r = document.querySelector('[data-gact="redo"]');
    if (u) u.disabled = !st.undo.length; if (r) r.disabled = !st.redo.length;
  }

  /* ---------------------------------------------------------
     6. The Tools tab (geometry)
     --------------------------------------------------------- */
  let geo = null;                                      // the shared controller
  const HAND = { id: 'move', name: 'Move Graphics View', hint: 'Drag to move the graph.', icon: 'move' };

  function buildTools() {
    const box = $('#gTools'); box.innerHTML = '';
    box.append(h('p', { class: 'g-tools-note', text: 'Pick a tool, then click on the graph. Drag any time to move the view.' }));
    const clear = h('button', { class: 'g-chip', type: 'button', text: 'Remove all drawn objects', onclick: () => { if (!st.geo.objects.length) return; pushHistory(); st.geo.objects = []; st.geo.labelCount = 0; geo.reset(); pushHistory(); redraw(); save(); } });
    box.append(window.UI.grid({ items: [HAND], value: st.geo.tool || 'move', cols: 4, labels: true, onPick: () => selectTool(null) }));
    window.Geo.GROUPS.forEach(gr => box.append(h('div', { class: 'g-sec' },
      h('div', { class: 'g-sec-title', text: gr }),
      window.UI.grid({ items: window.Geo.TOOLS.filter(t => t.group === gr), value: st.geo.tool, cols: 4, labels: true, onPick: id => selectTool(id) }))));
    box.append(clear);
  }
  function selectTool(id) {
    st.geo.tool = id;
    if (id) geo.setTool(id); else geo.reset();
    buildTools();
    showHint(id ? window.Geo.byId[id].name + ': ' + window.Geo.byId[id].hint : '');
    canvas().style.cursor = id ? 'crosshair' : '';
    if (id && isPhone()) setPanel(false);              // on a phone, close the panel so the graph can be clicked
    redraw();
  }
  let hintTimer = 0;
  function showHint(t) {
    const el = $('#gTip'); clearTimeout(hintTimer);
    if (!t) { el.classList.remove('show'); return; }
    el.textContent = t; el.classList.add('show', 'hint'); el.style.left = '50%'; el.style.top = 'auto'; el.style.bottom = '24px'; el.style.transform = 'translateX(-50%)';
    hintTimer = setTimeout(() => { el.classList.remove('show', 'hint'); }, 3800);
  }
  function makeController() {
    return window.Geo.createController({
      objects: () => st.geo.objects,
      commit: list => { st.geo.objects = list; pushHistory(); renderGeoList(); redraw(); save(); setTimeout(redraw, 350); setTimeout(redraw, 1200); },
      nextLabel: () => window.Geo.labelFor(st.geo.labelCount++),
      scale: () => geoScale(),
      redraw: () => redraw(),
      zoomAt: (f, at) => { const px = X(at.x / K()), py = Y(-at.y / K()); zoomAt(f, f, px, py); },
      pickImage: () => new Promise(resolve => {
        const inp = h('input', { type: 'file', accept: 'image/*' });
        inp.onchange = () => {
          const f = inp.files[0]; if (!f) return resolve(null);
          const rd = new FileReader();
          rd.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, 400 / Math.max(im.naturalWidth, im.naturalHeight)); resolve({ src: rd.result, w: im.naturalWidth * k, h: im.naturalHeight * k }); }; im.onerror = () => resolve(null); im.src = rd.result; };
          rd.readAsDataURL(f);
        };
        inp.click();
      }),
      ask: o => window.UI.prompt(o),
      bbox: o => window.Whiteboard.bboxOf(o)
    });
  }
  // screen <-> geometry world coordinates
  const toWorld = (px, py) => ({ x: gx(px) * K(), y: -gy(py) * K() });
  const toScreenW = o => ({ x: X(o.x / K()), y: Y(-o.y / K()) });

  /* ---------------------------------------------------------
     7. Settings window
     --------------------------------------------------------- */
  function openSettings() {
    closePop();
    const S = st.settings;
    const overlay = h('div', { class: 'g-overlay', onpointerdown: e => { if (e.target === overlay) close(); } });
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    const toggle = (label, key, after) => {
      const b = h('button', { class: 'g-switch' + (S[key] ? ' on' : ''), type: 'button', role: 'switch', 'aria-checked': String(!!S[key]), 'aria-label': label });
      b.addEventListener('click', () => { S[key] = !S[key]; b.classList.toggle('on', S[key]); b.setAttribute('aria-checked', String(S[key])); if (after) after(); sync(); redraw(); save(); });
      return h('div', { class: 'g-set-row', 'data-key': key }, h('span', { text: label }), b);
    };
    const angle = h('div', { class: 'g-seg' }, ...[['rad', 'Radians'], ['deg', 'Degrees']].map(([k, label]) => h('button', {
      type: 'button', class: S.angle === k ? 'on' : '', text: label,
      onclick: e => { S.angle = k; angle.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); recompute(1); refreshRowStatus(); redraw(); save(); }
    })));

    // graph bounds (x-min, x-max, y-min, y-max)
    const bnd = {};
    const bf = (label, key) => { const i = h('input', { type: 'text', inputmode: 'decimal', class: 'g-num-in', 'aria-label': label }); bnd[key] = i; i.addEventListener('change', applyBounds); return h('label', { class: 'g-fld' }, h('span', { text: label }), i); };
    const fillBounds = () => {
      const v = st.view, f = n => String(+n.toPrecision(6));
      bnd.xmin.value = f(gx(0)); bnd.xmax.value = f(gx(W)); bnd.ymin.value = f(gy(H)); bnd.ymax.value = f(gy(0));
    };
    function applyBounds() {
      const x0 = num(bnd.xmin.value, NaN), x1 = num(bnd.xmax.value, NaN), y0 = num(bnd.ymin.value, NaN), y1 = num(bnd.ymax.value, NaN);
      if ([x0, x1, y0, y1].some(n => !isFinite(n)) || x1 <= x0 || y1 <= y0) { fillBounds(); return; }
      const left = visibleLeft(), width = W - left;
      const sx = width / (x1 - x0), sy = H / (y1 - y0);
      setView({ sx, sy, ox: left - x0 * sx, oy: y1 * sy }, false);
    }
    const sync = () => {                                                   // minor lines / numbers depend on other switches
      overlay.querySelector('[data-key="minor"] .g-switch').disabled = !S.grid;
      overlay.querySelector('[data-key="numbers"] .g-switch').disabled = !S.axes;
    };

    const card = h('div', { class: 'g-set-card', role: 'dialog', 'aria-label': 'Graph settings' },
      h('div', { class: 'g-set-head' }, h('h3', { text: 'Graph settings' }),
        h('button', { class: 'g-x', type: 'button', 'aria-label': 'Close', title: 'Close', html: window.ICONS.close, onclick: close })),
      h('div', { class: 'g-set-body' },
        h('div', { class: 'g-set-sec', text: 'Grid & axes' }),
        toggle('Grid', 'grid'), toggle('Minor gridlines', 'minor'), toggle('Axes', 'axes'), toggle('Axis numbers', 'numbers'), toggle('Polar grid', 'polar'),
        h('div', { class: 'g-set-sec', text: 'Angles' }), h('div', { class: 'g-set-row stack' }, angle),
        h('div', { class: 'g-set-sec', text: 'Graph bounds' }),
        h('div', { class: 'g-flds' }, bf('X min', 'xmin'), bf('X max', 'xmax'), bf('Y min', 'ymin'), bf('Y max', 'ymax')),
        h('div', { class: 'g-set-foot' },
          h('button', { class: 'g-chip', type: 'button', text: 'Equal axes (1:1)', onclick: () => { const v = st.view, cy = gy(H / 2); setView({ ...v, sy: v.sx, oy: H / 2 + cy * v.sx }, false); fillBounds(); } }),
          h('button', { class: 'g-chip', type: 'button', text: 'Reset view', onclick: () => { setView(homeView(), false); fillBounds(); } }),
          h('button', { class: 'g-chip', type: 'button', text: 'Reset settings', onclick: () => { Object.assign(S, DEFAULT_SETTINGS); close(); recompute(1); refreshRowStatus(); redraw(); save(); openSettings(); } }))));
    overlay.append(card);
    $('#ws-graph').appendChild(overlay);
    fillBounds(); sync();
  }

  /* ---------------------------------------------------------
     8. Pointer input on the graph
     --------------------------------------------------------- */
  /* a point defined by plain numbers (or sliders) can be dragged; its text (or slider) is rewritten as it moves */
  function findDraggable(px, py) {
    let best = null, bd = 13;
    items.forEach(it => {
      if (it.kind !== 'point' || !it.drag || isHidden(it.row)) return;
      pointList(it).forEach(p => { const d = Math.hypot(X(p[0]) - px, Y(p[1]) - py); if (d < bd) { bd = d; best = it; } });
    });
    return best;
  }
  function applyPointDrag(it, x, y) {
    const prec = Math.pow(10, Math.ceil(Math.log10(6 / Math.min(st.view.sx, st.view.sy))));   // snap to about 6 pixels
    const dec = Math.max(0, Math.ceil(-Math.log10(prec) - 1e-9));
    const snap = v => +(Math.round(v / prec) * prec).toFixed(dec);
    const row = it.row, text = [], moves = [];
    [x, y].forEach((v, i) => {
      const spec = it.drag[i], val = snap(v);
      if (spec.lit !== undefined) text[i] = String(val); else { text[i] = spec.slider; moves.push([spec.row, val]); }
    });
    moves.forEach(([r, v]) => setSliderValue(r, v, true));
    row.src = '(' + text[0] + ',' + text[1] + ')';
    const f = fields.get(row.id); if (f) f.el.value = row.src;
    recompute(1); refreshRowStatus(); redraw(true); save();
  }
  // the strips with the axis numbers: dragging them stretches that axis only
  function axisZone(px, py) {
    const S = st.settings;
    if (!S.axes || !S.numbers) return null;
    const yPos = clamp(st.view.oy + 4, 4, H - 20), xPos = clamp(st.view.ox - 6, 38, W - 6);
    if (py >= yPos - 6 && py <= yPos + 22) return 'x';
    if (px >= xPos - 46 && px <= xPos + 8) return 'y';
    return null;
  }

  function bindCanvas() {
    const c = canvas();
    const pts = new Map();                              // active pointers (for pinch zoom)
    let drag = null, pinch = null;
    const pos = e => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    c.addEventListener('pointerdown', e => {
      if (e.button && e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, pos(e));
      closePop();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; drag = null;
      } else if (pts.size === 1) {
        const p0 = pos(e), dp = !st.geo.tool && findDraggable(p0.x, p0.y), zone = !st.geo.tool && !dp && axisZone(p0.x, p0.y);
        drag = { x: e.clientX, y: e.clientY, ox: st.view.ox, oy: st.view.oy, moved: false, id: e.pointerId };
        if (dp) drag.pt = dp.row;                                              // dragging a point
        else if (zone) Object.assign(drag, { axis: zone, sx: st.view.sx, sy: st.view.sy, px: p0.x, py: p0.y });   // stretching an axis
      }
      setHover(null);
    });
    c.addEventListener('pointermove', e => {
      const p = pos(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const f = d / pinch.d;
        const v = st.view;
        // zoom about the midpoint and follow its movement
        const sx = clamp(v.sx * f, 1e-5, 1e8), sy = clamp(v.sy * f, 1e-5, 1e8);
        st.view = { sx, sy, ox: mx - (pinch.mx - v.ox) * (sx / v.sx), oy: my - (pinch.my - v.oy) * (sy / v.sy) };
        pinch = { d, mx, my }; redraw(true); save();
        return;
      }
      if (drag && drag.id === e.pointerId && drag.pt) {
        const it = items.find(i => i.row === drag.pt && i.kind === 'point');
        if (it && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3) { drag.moved = true; applyPointDrag(it, gx(p.x), gy(p.y)); }
        return;
      }
      if (drag && drag.id === e.pointerId && drag.axis) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y, v = st.view;
        if (Math.hypot(dx, dy) > 3) drag.moved = true;
        if (drag.axis === 'x') { const sx = clamp(drag.sx * Math.exp(dx * 0.004), 1e-5, 1e8); st.view = { ...v, sx, ox: drag.px - (drag.px - drag.ox) * (sx / drag.sx) }; }
        else { const sy = clamp(drag.sy * Math.exp(-dy * 0.004), 1e-5, 1e8); st.view = { ...v, sy, oy: drag.py - (drag.py - drag.oy) * (sy / drag.sy) }; }
        redraw(true);
        return;
      }
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; c.classList.add('panning'); }
        if (drag.moved) { st.view.ox = drag.ox + dx; st.view.oy = drag.oy + dy; redraw(true); }
        return;
      }
      if (e.pointerType === 'mouse') {
        const zone = !st.geo.tool && axisZone(p.x, p.y);
        c.style.cursor = st.geo.tool ? 'crosshair' : findDraggable(p.x, p.y) ? 'move' : zone === 'x' ? 'ew-resize' : zone === 'y' ? 'ns-resize' : '';
        if (st.geo.tool && geo) geo.move(toWorld(p.x, p.y));
        setHover(findHover(p.x, p.y), p);
      }
    });
    const end = e => {
      pts.delete(e.pointerId);
      if (pinch && pts.size < 2) { pinch = null; drag = null; save(); return; }
      if (drag && drag.id === e.pointerId && (drag.pt || drag.axis)) {
        const did = drag.moved; drag = null;
        if (did) { pushHistory(); save(); }
        return;
      }
      if (drag && drag.id === e.pointerId) {
        const wasClick = !drag.moved; drag = null; c.classList.remove('panning');
        if (e.type === 'pointerup') {
          if (wasClick && st.geo.tool && geo) geo.down(toWorld(pos(e).x, pos(e).y));
          else if (wasClick) { const p = pos(e); setHover(findHover(p.x, p.y, 14), p, true); }   // a tap shows the coordinates (touch screens)
          else save();
        }
      }
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { setHover(null); if (geo) geo.leave(); });
    c.addEventListener('dblclick', () => { if (st.geo.tool && geo && geo.canFinish()) geo.finish(); });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1, k = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.005 : 0.0015)), p = pos(e);
      zoomAt(e.altKey ? 1 : k, e.shiftKey ? 1 : k, p.x, p.y);       // Shift: only x, Alt: only y
    }, { passive: false });

    document.addEventListener('keydown', e => {
      if (!$('#ws-graph').classList.contains('active')) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/INPUT|TEXTAREA|MATH-FIELD/.test(tag)) return;
      if (e.key === 'Enter' && st.geo.tool && geo && geo.canFinish()) geo.finish();
      if (e.key === 'Escape' && st.geo.tool) selectTool(null);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    });
  }

  /* finds the point / curve under the pointer, so that its coordinates can be shown */
  function findHover(px, py, tol = 9) {
    let best = null, bd = tol;
    const consider = (x, y, color, label) => {
      const sx = X(x), sy = Y(y), d = Math.hypot(sx - px, sy - py);
      if (isFinite(d) && d < bd) { bd = d; best = { px: sx, py: sy, x, y, color, label }; }
    };
    items.forEach(it => {
      if (isHidden(it.row)) return;
      if (it.kind === 'point') pointList(it).forEach(p => consider(p[0], p[1], it.row.color));
      else if (it.kind === 'table') it.pts.forEach(p => consider(p.x, p.y, it.row.color));
      else if (it.kind === 'explicit') {
        const x = gx(px); let y = it.fn(x);
        if (isFinite(y) && Math.abs(Y(y) - py) < bd) { const sy = Y(y); const d = Math.abs(sy - py); if (d < bd) { bd = d; best = { px, py: sy, x, y, color: it.row.color }; } }
      }
    });
    st.geo.objects.forEach(o => { if (o.type === 'dot' && !o.hidden) { const p = toScreenW(o); const d = Math.hypot(p.x - px, p.y - py); if (d < bd) { bd = d; best = { px: p.x, py: p.y, x: o.x / K(), y: -o.y / K(), color: o.color || '#000', label: o.label }; } } });
    return best;
  }
  function setHover(hv, p, sticky) {
    const tip = $('#gTip');
    st.hover = hv; redraw();
    if (!hv) { if (!tip.classList.contains('hint')) tip.classList.remove('show'); return; }
    tip.classList.remove('hint'); tip.style.bottom = 'auto'; tip.style.transform = '';
    tip.textContent = (hv.label ? hv.label + ' ' : '') + '(' + ME.format(+hv.x.toPrecision(6), 6) + ', ' + ME.format(+hv.y.toPrecision(6), 6) + ')';
    tip.classList.add('show');
    const r = $('#ws-graph').getBoundingClientRect();
    tip.style.left = clamp(hv.px + 12, 8, r.width - 150) + 'px';
    tip.style.top = clamp(hv.py - 34, 8, r.height - 40) + 'px';
    if (sticky) { clearTimeout(hintTimer); hintTimer = setTimeout(() => { st.hover = null; tip.classList.remove('show'); redraw(); }, 2600); }
  }

  /* ---------------------------------------------------------
     9. Buttons and panel controls
     --------------------------------------------------------- */
  function setPanel(open) {
    st.panelOpen = open;
    const ws = $('#ws-graph');
    ws.classList.toggle('panel-closed', !open);
    const b = $('#gCollapse');
    b.title = b.ariaLabel = open ? 'Hide the equation panel' : 'Show the equation panel';
    if (!open && keypad) keypad.close();
    save();
    setTimeout(() => redraw(), 0);
  }
  function setTab(tab) {
    st.tab = tab;
    document.querySelectorAll('.g-tab').forEach(b => b.classList.toggle('active', b.dataset.gtab === tab));
    $('#gRows').hidden = tab !== 'algebra'; $('#gTools').hidden = tab !== 'tools';
    $('#gAdd').hidden = $('#gKey').hidden = tab !== 'algebra';
    $('#ws-graph').dataset.tab = tab;
    if (tab === 'tools') buildTools(); else if (st.geo.tool) selectTool(null);
    if (!st.panelOpen) setPanel(true);
    if (tab === 'tools' && keypad) keypad.close();
  }
  function toggleFullscreen() {
    const d = document;
    try { if (!d.fullscreenElement) d.documentElement.requestFullscreen && d.documentElement.requestFullscreen(); else d.exitFullscreen && d.exitFullscreen(); } catch (e) { /* not allowed here */ }
  }
  function centre() { const l = visibleLeft(); return { x: l + (W - l) / 2, y: H / 2 }; }
  function action(a) {
    if (a === 'undo') undo();
    else if (a === 'redo') redo();
    else if (a === 'home') animateTo(homeView());
    else if (a === 'zoomIn' || a === 'zoomOut') {
      const k = a === 'zoomIn' ? 1.4 : 1 / 1.4, c = centre(), v = st.view;
      const sx = clamp(v.sx * k, 1e-5, 1e8), sy = clamp(v.sy * k, 1e-5, 1e8);
      animateTo({ sx, sy, ox: c.x - (c.x - v.ox) * (sx / v.sx), oy: c.y - (c.y - v.oy) * (sy / v.sy) });
    } else if (a === 'fit') toggleFullscreen();
  }

  function bindUI() {
    document.querySelectorAll('[data-gact]').forEach(b => b.addEventListener('click', () => action(b.dataset.gact)));
    document.querySelectorAll('.g-tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.gtab)));
    $('#gSettings').addEventListener('click', openSettings);
    $('#gAdd').addEventListener('click', openAddMenu);
    $('#gCollapse').addEventListener('click', () => setPanel(!st.panelOpen));
    $('#gShade').addEventListener('click', () => setPanel(false));                 // phone: tap the dimmed graph to close the panel
    $('#gKey').addEventListener('click', () => {
      if (!keypad) return;
      if (!keypad.isOpen && !activeField()) { const r = st.rows.find(isEmptyExpr) || st.rows[st.rows.length - 1]; if (r && r.type === 'expr') focusRow(r); }
      keypad.toggle(); $('#gKey').classList.toggle('on', keypad.isOpen);
    });
    document.addEventListener('fullscreenchange', () => { const b = document.querySelector('[data-gact="fit"]'); if (b) b.classList.toggle('on', !!document.fullscreenElement); setTimeout(redraw, 50); });
    window.addEventListener('resize', onResize);
  }
  let lastW = 0;
  function onResize() {
    if (!$('#ws-graph').classList.contains('active')) return;
    const oldW = W, oldH = H;
    resizeCanvas();
    // keep the same graph point in the middle when the window changes size
    if (oldW && (oldW !== W || oldH !== H)) { st.view.ox += (W - oldW) / 2; st.view.oy += (H - oldH) / 2; }
    if (lastW <= PHONE_MAX !== window.innerWidth <= PHONE_MAX) { /* layout switched */ }
    lastW = window.innerWidth;
    redraw();
  }

  /* ---------------------------------------------------------
     10. init / show
     --------------------------------------------------------- */
  async function init() {
    if (st.ready) return;
    st.ready = true;
    const loaded = load();
    useMath = await loadMathLive();
    if (useMath) configureMathLive();
    geo = makeController();
    if (!loaded) { st.rows = [newRow('expr'), newRow('expr')]; }
    ensureTrailingEmpty();
    keypad = window.Keypad.create({
      host: $('#ws-graph'),
      getField: () => activeField() || lastField.f,
      onEnter: () => { const r = st.rows.find(x => x.id === st.active); if (r) focusNeighbour(r, 1, true); },
      onHide: () => { keypad.close(); $('#gKey').classList.remove('on'); }
    });
    bindUI(); bindCanvas();
    window.UI.hydrateIcons($('#ws-graph'));
    setPanel(isPhone() && loaded ? false : st.panelOpen);
    setTab('algebra');
    resizeCanvas();
    if (!loaded) st.view = homeView();
    recompute();
    buildPanel();
    lastSnap = snapshot(); updateHistoryButtons();
    redraw();
    // the Anta font draws the axis numbers: redraw once it is ready
    if (document.fonts && document.fonts.load) document.fonts.load('14px Anta').then(() => redraw());
  }
  function show() { init().then(() => { onResize(); redraw(); }); }

  window.Graph = { init, show, preload: () => { loadMathLive(); }, resize: () => { onResize(); } };
})();
