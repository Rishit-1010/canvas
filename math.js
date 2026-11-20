/* =========================================================
   math.js — the maths engine of the Graph Calculator
   ---------------------------------------------------------
   1. E            numeric helpers (trig with radians/degrees, factorial, nCr, integrals …)
   2. latexToText  turns the LaTeX written by the MathLive input into plain text ("\frac{1}{2}" -> "((1)/(2))")
   3. tokenizer + parser   plain text -> syntax tree (handles implicit multiplication, f(x), |x|, piecewise …)
   4. parseStatement       decides WHAT a line is: y = f(x), x = g(y), r = f(θ), implicit equation, inequality,
                           point, parametric curve, number, variable (slider) or function definition
   5. compile              turns a syntax tree into a fast JavaScript function
   Everything is exposed as window.MathEngine.
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     1. Numeric helpers
     --------------------------------------------------------- */
  const D2R = Math.PI / 180;

  // Lanczos approximation of the gamma function (for factorials of non-integers)
  const G = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function gamma(z) {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    let a = 0.99999999999980993;
    const t = z + 7.5;
    for (let i = 0; i < 8; i++) a += G[i] / (z + i + 1);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
  }

  const E = {
    deg: false,                                   // true = trig functions work in degrees
    // trigonometry (radians or degrees depending on E.deg)
    sin: x => Math.sin(E.deg ? x * D2R : x),
    cos: x => Math.cos(E.deg ? x * D2R : x),
    tan: x => Math.tan(E.deg ? x * D2R : x),
    csc: x => 1 / E.sin(x),
    sec: x => 1 / E.cos(x),
    cot: x => 1 / E.tan(x),
    asin: x => (E.deg ? Math.asin(x) / D2R : Math.asin(x)),
    acos: x => (E.deg ? Math.acos(x) / D2R : Math.acos(x)),
    atan: x => (E.deg ? Math.atan(x) / D2R : Math.atan(x)),
    acsc: x => E.asin(1 / x),
    asec: x => E.acos(1 / x),
    acot: x => (x > 0 ? E.atan(1 / x) : E.atan(1 / x) + (E.deg ? 180 : Math.PI)),
    atan2: (y, x) => (E.deg ? Math.atan2(y, x) / D2R : Math.atan2(y, x)),
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    csch: x => 1 / Math.sinh(x), sech: x => 1 / Math.cosh(x), coth: x => 1 / Math.tanh(x),
    asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    // exponentials and roots
    exp: Math.exp, ln: Math.log, log: Math.log10,
    logb: (b, x) => Math.log(x) / Math.log(b),
    sqrt: Math.sqrt,
    // x^y that also gives real answers for odd roots of negative numbers: (-8)^(1/3) = -2
    pow(a, b) {
      if (a >= 0 || Number.isInteger(b)) return Math.pow(a, b);
      for (let q = 3; q <= 99; q += 2) {                          // is b ≈ p / q with q odd?
        const p = b * q;
        if (Math.abs(p - Math.round(p)) < 1e-9) return (Math.round(p) % 2 === 0 ? 1 : -1) * Math.pow(-a, b);
      }
      return NaN;
    },
    nroot: (n, x) => E.pow(x, 1 / n),
    // rounding and friends
    abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
    round: (x, n = 0) => { const k = Math.pow(10, n); return Math.round(x * k) / k; },
    mod: (a, b) => a - b * Math.floor(a / b),
    min: Math.min, max: Math.max,
    gcd: (a, b) => { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) [a, b] = [b, a % b]; return a; },
    lcm: (a, b) => (a && b ? Math.abs(Math.round(a) * Math.round(b)) / E.gcd(a, b) : 0),
    // factorial, combinations, permutations
    fact(n) {
      if (n < 0 && Number.isInteger(n)) return NaN;
      if (Number.isInteger(n)) { if (n > 170) return Infinity; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
      return gamma(n + 1);
    },
    nCr(n, r) { if (r < 0 || r > n) return 0; r = Math.min(r, n - r); let v = 1; for (let i = 1; i <= r; i++) v = v * (n - r + i) / i; return Math.round(v); },
    nPr(n, r) { if (r < 0 || r > n) return 0; let v = 1; for (let i = 0; i < r; i++) v *= (n - i); return v; },
    // calculus
    sum(f, lo, hi) { lo = Math.round(lo); hi = Math.round(hi); if (hi - lo > 1e6) return NaN; let s = 0; for (let i = lo; i <= hi; i++) s += f(i); return s; },
    prod(f, lo, hi) { lo = Math.round(lo); hi = Math.round(hi); if (hi - lo > 1e6) return NaN; let s = 1; for (let i = lo; i <= hi; i++) s *= f(i); return s; },
    // definite integral: adaptive Simpson rule
    int(f, a, b) {
      if (!isFinite(a) || !isFinite(b)) return NaN;
      if (a === b) return 0;
      const sgn = a < b ? 1 : -1; if (sgn < 0) [a, b] = [b, a];
      const simpson = (fa, fm, fb, a, b) => (b - a) / 6 * (fa + 4 * fm + fb);
      const rec = (a, b, fa, fm, fb, whole, tol, depth) => {
        const m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2;
        const flm = f(lm), frm = f(rm);
        const left = simpson(fa, flm, fm, a, m), right = simpson(fm, frm, fb, m, b);
        if (depth <= 0 || Math.abs(left + right - whole) <= 15 * tol) return left + right + (left + right - whole) / 15;
        return rec(a, m, fa, flm, fm, left, tol / 2, depth - 1) + rec(m, b, fm, frm, fb, right, tol / 2, depth - 1);
      };
      const fa = f(a), fb = f(b), fm = f((a + b) / 2);
      return sgn * rec(a, b, fa, fm, fb, simpson(fa, fm, fb, a, b), 1e-9, 18);
    },
    // derivative at a point (4th-order central difference)
    ddx(f, x) { const h = 1e-3 * (1 + Math.abs(x)); return (8 * (f(x + h) - f(x - h)) - (f(x + 2 * h) - f(x - 2 * h))) / (12 * h); },
    deriv(f, x, n) {
      if (n <= 1) return E.ddx(f, x);
      const h = 1e-2 * (1 + Math.abs(x));
      return n === 2 ? (f(x + h) - 2 * f(x) + f(x - h)) / (h * h) : E.ddx(t => E.deriv(f, t, n - 1), x);
    }
  };

  // names the user can type, and how many arguments each expects (null = any number)
  const FUNCS = {
    sin: 'sin', cos: 'cos', tan: 'tan', csc: 'csc', sec: 'sec', cot: 'cot',
    arcsin: 'asin', arccos: 'acos', arctan: 'atan', arccsc: 'acsc', arcsec: 'asec', arccot: 'acot', asin: 'asin', acos: 'acos', atan: 'atan',
    sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', csch: 'csch', sech: 'sech', coth: 'coth',
    arcsinh: 'asinh', arccosh: 'acosh', arctanh: 'atanh', asinh: 'asinh', acosh: 'acosh', atanh: 'atanh',
    ln: 'ln', log: 'log', exp: 'exp', sqrt: 'sqrt', abs: 'abs', floor: 'floor', ceil: 'ceil', round: 'round',
    sign: 'sign', sgn: 'sign', min: 'min', max: 'max', mod: 'mod', gcd: 'gcd', lcm: 'lcm', nCr: 'nCr', nPr: 'nPr',
    nroot: 'nroot', logb: 'logb', atan2: 'atan2',
    sum: 'sum', prod: 'prod', int: 'int', ddx: 'ddx'
  };
  const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega', 'pi',
    'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega'];
  const CONSTS = { e: Math.E, pi: Math.PI, tau: 2 * Math.PI };
  // longest names first, so "sinh" wins over "sin"
  const NAMES = Object.keys(FUNCS).concat(GREEK).sort((a, b) => b.length - a.length);

  /* ---------------------------------------------------------
     2. LaTeX (from MathLive) -> plain text
     --------------------------------------------------------- */
  function latexToText(src) {
    let s = String(src || '');
    // spacing commands and delimiters
    s = s.replace(/\\(?:,|;|:|!|quad|qquad| \s*)/g, ' ').replace(/\\left|\\right|\\displaystyle|\\mathrm|\\mathit|\\text/g, m => (m === '\\text' || m === '\\mathrm' || m === '\\mathit' ? '' : ''));
    s = s.replace(/\\placeholder\{[^{}]*\}/g, '').replace(/\\operatorname\{([^{}]*)\}/g, '$1');
    s = s.replace(/\\lbrace|\\\{/g, '{').replace(/\\rbrace|\\\}/g, '}').replace(/\\lbrack/g, '[').replace(/\\rbrack/g, ']');
    s = s.replace(/\\lfloor/g, 'floor(').replace(/\\rfloor/g, ')').replace(/\\lceil/g, 'ceil(').replace(/\\rceil/g, ')');
    s = s.replace(/\^\{\\circ\}|\\degree|\\circ/g, '°');
    s = s.replace(/\\cdot|\\times|\\ast/g, '*').replace(/\\div/g, '/').replace(/\\le(?:q|qslant)?(?![a-z])/g, '<=').replace(/\\ge(?:q|qslant)?(?![a-z])/g, '>=').replace(/\\ne(?:q)?(?![a-z])/g, '!=');
    s = s.replace(/\\mid|\\vert/g, '|').replace(/\\infty/g, '1e308');

    // \sum, \prod and \int headers become markers that are expanded below
    s = s.replace(/\\(sum|prod)_\{([^{}]*)\}\^\{?([^{}\s]*)\}?/g, (m, k, lo, hi) => `⟦${k}|${lo}|${hi}⟧`);
    s = s.replace(/\\int_\{?([^{}\s^]*)\}?\^\{?([^{}\s]*)\}?/g, (m, lo, hi) => `⟦int|${lo}|${hi}⟧`);

    // innermost-first rewriting of brace groups (loop until nothing changes, so nesting works)
    for (let guard = 0; guard < 40; guard++) {
      const before = s;
      s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
      s = s.replace(/\\frac\s*(\d)\s*(\d)/g, '(($1)/($2))');
      s = s.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, 'nroot(($1),($2))');
      s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
      s = s.replace(/\\sqrt\s*([0-9a-zA-Z])/g, 'sqrt($1)');
      s = s.replace(/\^\{([^{}]*)\}/g, '^($1)');
      s = s.replace(/_\{([^{}]*)\}/g, (m, a) => '_' + a.replace(/[^A-Za-z0-9]/g, ''));
      if (s === before) break;
    }
    s = s.replace(/\\log_(\w)/g, 'log_$1');
    // any other command: drop the backslash, keep the name (\sin -> sin, \theta -> theta, \pi -> pi)
    s = s.replace(/\\([A-Za-z]+)/g, '$1').replace(/\\/g, ' ');
    s = s.replace(/[{}]/g, m => m);               // braces that remain are piecewise / restriction braces

    // expand \sum / \prod / \int markers
    const bodyEnd = (str, from) => {              // index where the body of a sum / integral ends
      let d = 0;
      for (let i = from; i < str.length; i++) {
        const c = str[i];
        if (c === '(' || c === '{') d++;
        else if (c === ')' || c === '}') { if (d === 0) return i; d--; }
        else if (d === 0 && (c === '=' || c === '<' || c === '>' || c === ',')) return i;
      }
      return str.length;
    };
    for (let guard = 0; guard < 10; guard++) {
      const m = /⟦(sum|prod|int)\|([^|]*)\|([^⟧]*)⟧/.exec(s);
      if (!m) break;
      const head = s.slice(0, m.index), rest = s.slice(m.index + m[0].length);
      if (m[1] === 'int') {
        const dm = /(^|[\s)\d])d([a-zA-Z])(?![a-zA-Z])/.exec(rest);
        if (!dm) { s = head + 'int(' + m[2] + ',' + m[3] + ',0,x)' + rest; continue; }
        const body = rest.slice(0, dm.index + dm[1].length), after = rest.slice(dm.index + dm[0].length);
        s = `${head}int(${m[2]},${m[3]},${body},${dm[2]})${after}`;
      } else {
        const [v, lo] = m[2].split('=');
        const e = bodyEnd(rest, 0);
        s = `${head}${m[1]}(${(v || 'n').trim()},${lo || '1'},${m[3] || '10'},${rest.slice(0, e)})${rest.slice(e)}`;
      }
    }
    // d/dx notation:  ((d)/(dx))(body)  ->  ddx(body, x)
    s = s.replace(/\(\(d\)\/\(d([a-zA-Z])\)\)\s*(\((?:[^()]|\([^()]*\))*\)|[A-Za-z0-9_^.]+)/g, (m, v, body) => `ddx(${body.replace(/^\((.*)\)$/s, '$1')},${v})`);
    return s.replace(/\s+/g, ' ').trim();
  }

  /* ---------------------------------------------------------
     3. Tokenizer
     --------------------------------------------------------- */
  class MathError extends Error {}
  const fail = msg => { throw new MathError(msg); };

  // nicer characters people may type or paste
  function prep(text) {
    return String(text)
      .replace(/π/g, ' pi ').replace(/θ/g, ' theta ').replace(/τ/g, ' tau ').replace(/φ/g, ' phi ').replace(/α/g, ' alpha ').replace(/β/g, ' beta ').replace(/λ/g, ' lambda ').replace(/μ/g, ' mu ').replace(/σ/g, ' sigma ').replace(/ω/g, ' omega ')
      .replace(/×|·/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=')
      .replace(/²/g, '^2').replace(/³/g, '^3').replace(/√/g, ' sqrt ').replace(/∞/g, '1e308');
  }

  /* splits a run of letters like "sinxy" into names: sin, x, y.  (Desmos does the same.) */
  function splitNames(letters) {
    const out = [];
    for (let i = 0; i < letters.length;) {
      const hit = NAMES.find(n => letters.startsWith(n, i));
      if (hit) { out.push(hit); i += hit.length; } else { out.push(letters[i]); i++; }
    }
    return out;
  }

  function tokenize(text, ctx) {
    const toks = [];
    const funcs = (ctx && ctx.funcs) || new Set();
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (/\s/.test(c)) { i++; continue; }
      let m;
      if ((m = /^(\d+\.?\d*|\.\d+)/.exec(text.slice(i)))) { toks.push({ t: 'num', v: parseFloat(m[1]) }); i += m[1].length; continue; }
      if ((m = /^[A-Za-z]+(?:_[A-Za-z0-9]+)?/.exec(text.slice(i)))) {
        const run = m[0]; i += run.length;
        if (/^log_/.test(run)) { toks.push({ t: 'fn', v: 'logb', base: run.slice(4) }); continue; }
        const us = run.indexOf('_');
        const letters = us < 0 ? run : run.slice(0, us), sub = us < 0 ? '' : run.slice(us);
        const names = splitNames(letters);
        names.forEach((nm, k) => {
          const last = k === names.length - 1;
          const full = last && sub && !FUNCS[nm] ? nm + sub : nm;
          const after = text.slice(i).trimStart();
          if (FUNCS[nm] && !(last && sub)) toks.push({ t: 'fn', v: FUNCS[nm] });
          else if (funcs.has(full) && last && (after[0] === '(' || after[0] === "'")) {
            let primes = 0; while (text[i + primes] === "'") primes++;
            i += primes; toks.push({ t: 'ufn', v: full, primes });
          } else toks.push({ t: 'id', v: full });
        });
        continue;
      }
      const two = text.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '!=' || two === '==') { toks.push({ t: 'op', v: two === '==' ? '=' : two }); i += 2; continue; }
      if ('+-*/^()[]{},=<>!|:\'°'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
      fail('Unexpected "' + c + '"');
    }
    return toks;
  }

  /* ---------------------------------------------------------
     4. Parser  (tokens -> syntax tree)
     --------------------------------------------------------- */
  const REL = ['=', '<', '>', '<=', '>=', '!='];

  function parseTokens(tokens) {
    let p = 0, absDepth = 0;
    const peek = () => tokens[p];
    const isOp = v => peek() && peek().t === 'op' && peek().v === v;
    const expect = v => { if (!isOp(v)) fail('Expected "' + v + '"'); p++; };

    function parseAdd() {
      let a = parseTerm();
      while (isOp('+') || isOp('-')) { const op = tokens[p++].v; a = { n: 'bin', op, a, b: parseTerm() }; }
      return a;
    }
    function startsPrimary(tk) {
      if (!tk) return false;
      if (tk.t === 'num' || tk.t === 'id' || tk.t === 'fn' || tk.t === 'ufn') return true;
      return tk.t === 'op' && (tk.v === '(' || tk.v === '{' || (tk.v === '|' && absDepth === 0));
    }
    function parseTerm() {
      let a = parseUnary();
      for (;;) {
        if (isOp('*') || isOp('/')) { const op = tokens[p++].v; a = { n: 'bin', op, a, b: parseUnary() }; }
        else if (startsPrimary(peek())) a = { n: 'bin', op: '*', a, b: parsePower() };     // implicit multiplication: 2x, 3(x+1), x sin x
        else break;
      }
      return a;
    }
    function parseUnary() {
      if (isOp('-')) { p++; return { n: 'neg', a: parseUnary() }; }
      if (isOp('+')) { p++; return parseUnary(); }
      return parsePower();
    }
    function parsePower() {
      const base = parsePostfix();
      if (isOp('^')) { p++; return { n: 'bin', op: '^', a: base, b: parseUnary() }; }
      return base;
    }
    function parsePostfix() {
      let a = parsePrimary();
      for (;;) {
        if (isOp('!')) { p++; a = { n: 'fact', a }; }
        else if (isOp('°')) { p++; a = { n: 'deg', a }; }
        else break;
      }
      return a;
    }
    function parseArgs() {                       // after "(": a, b, c )
      const args = [parseAdd()];
      while (isOp(',')) { p++; args.push(parseAdd()); }
      expect(')');
      return args;
    }
    // chain of comparisons such as  0 <= t <= 1   (used by restrictions and piecewise conditions)
    function parseCmp(first) {
      const parts = [first];
      while (peek() && peek().t === 'op' && REL.includes(peek().v)) { parts.push(tokens[p++].v); parts.push(parseAdd()); }
      return parts.length > 1 ? { n: 'cmp', parts } : null;
    }
    function parsePrimary() {
      const tk = tokens[p];
      if (!tk) fail('Expression is incomplete');
      if (tk.t === 'num') { p++; return { n: 'num', v: tk.v }; }
      if (tk.t === 'id') { p++; return { n: 'var', name: tk.v }; }
      if (tk.t === 'ufn') {
        p++; expect('(');
        return { n: 'ucall', name: tk.v, args: parseArgs(), primes: tk.primes };
      }
      if (tk.t === 'fn') {
        p++;
        let name = tk.v, power = null, base = null;
        if (name === 'logb' && tk.base !== undefined) base = parseTokens(tokenize(tk.base, {}));
        if (isOp('^')) { p++; power = parseUnary(); }                 // sin^2 x   or   sin^-1 x
        let args;
        if (isOp('(')) { p++; args = parseArgs(); }
        else args = [parsePowerOperand()];                            // sin x, sin 2x
        if (base) args.unshift(base);
        let node = { n: 'call', name, args };
        if (power) {
          const isMinusOne = power.n === 'neg' && power.a.n === 'num' && power.a.v === 1;
          const inv = { sin: 'asin', cos: 'acos', tan: 'atan', csc: 'acsc', sec: 'asec', cot: 'acot', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' }[name];
          if (isMinusOne && inv) node = { n: 'call', name: inv, args };
          else node = { n: 'bin', op: '^', a: node, b: power };
        }
        return node;
      }
      if (tk.t === 'op') {
        if (tk.v === '(') {
          p++;
          const first = parseAdd();
          if (isOp(',')) {                                             // (a, b)  -> a point
            const items = [first];
            while (isOp(',')) { p++; items.push(parseAdd()); }
            expect(')');
            return { n: 'tuple', items };
          }
          expect(')');
          return { n: 'group', a: first };
        }
        if (tk.v === '|') { p++; absDepth++; const a = parseAdd(); absDepth--; expect('|'); return { n: 'call', name: 'abs', args: [a] }; }
        if (tk.v === '{') return parsePiecewise();
      }
      fail('Unexpected "' + (tk.v !== undefined ? tk.v : '?') + '"');
    }
    // argument of a function written without brackets: the factors that follow, up to the next function name
    function parsePowerOperand() {
      let a = parseUnary();
      while (startsPrimary(peek()) && peek().t !== 'fn' && peek().t !== 'ufn') a = { n: 'bin', op: '*', a, b: parsePower() };
      return a;
    }
    function parsePiecewise() {
      expect('{');
      const cases = []; let def = null;
      while (!isOp('}')) {
        const first = parseAdd();
        const cmp = parseCmp(first);
        if (cmp) {
          let val = { n: 'num', v: 1 };
          if (isOp(':')) { p++; val = parseAdd(); }
          cases.push({ cond: cmp, val });
        } else def = first;
        if (isOp(',')) p++; else break;
      }
      expect('}');
      return { n: 'piece', cases, def };
    }

    const result = parseAdd();
    if (p < tokens.length) fail('Unexpected "' + (tokens[p].v !== undefined ? tokens[p].v : '?') + '"');
    return result;
  }

  // parse "cmp, cmp, …" (the inside of a restriction  { … } )
  function parseConditions(tokens) {
    const conds = []; let depth = 0, start = 0;
    const pieces = [];
    tokens.forEach((tk, i) => {
      if (tk.t === 'op') { if ('({['.includes(tk.v)) depth++; if (')}]'.includes(tk.v)) depth--; }
      if (depth === 0 && tk.t === 'op' && tk.v === ',') { pieces.push(tokens.slice(start, i)); start = i + 1; }
    });
    pieces.push(tokens.slice(start));
    pieces.forEach(pc => {
      if (!pc.length) return;
      // split the piece at relation operators
      const parts = []; let cur = [], d = 0;
      pc.forEach(tk => {
        if (tk.t === 'op') { if ('({'.includes(tk.v)) d++; if (')}'.includes(tk.v)) d--; }
        if (d === 0 && tk.t === 'op' && REL.includes(tk.v)) { parts.push(parseTokens(cur)); parts.push(tk.v); cur = []; } else cur.push(tk);
      });
      parts.push(parseTokens(cur));
      if (parts.length < 3) fail('A restriction needs a comparison such as x > 0');
      conds.push({ n: 'cmp', parts });
    });
    return conds;
  }

  /* ---------------------------------------------------------
     Syntax-tree utilities
     --------------------------------------------------------- */
  // names of the free variables of a tree (those not bound by a sum / integral and not constants)
  function freeVars(node, bound = new Set(), out = new Set()) {
    if (!node) return out;
    switch (node.n) {
      case 'var': if (!bound.has(node.name) && !(node.name in CONSTS)) out.add(node.name); break;
      case 'bin': freeVars(node.a, bound, out); freeVars(node.b, bound, out); break;
      case 'neg': case 'fact': case 'deg': case 'group': freeVars(node.a, bound, out); break;
      case 'call': {
        if ((node.name === 'sum' || node.name === 'prod') && node.args[0].n === 'var') {
          const b2 = new Set(bound); b2.add(node.args[0].name);
          freeVars(node.args[1], bound, out); freeVars(node.args[2], bound, out); freeVars(node.args[3], b2, out);
        } else if (node.name === 'int' && node.args[3] && node.args[3].n === 'var') {
          const b2 = new Set(bound); b2.add(node.args[3].name);
          freeVars(node.args[0], bound, out); freeVars(node.args[1], bound, out); freeVars(node.args[2], b2, out);
        } else if (node.name === 'ddx' && node.args[1] && node.args[1].n === 'var') {
          const b2 = new Set(bound); b2.add(node.args[1].name);
          freeVars(node.args[0], b2, out); out.add(node.args[1].name); if (bound.has(node.args[1].name)) out.delete(node.args[1].name);
        } else node.args.forEach(a => freeVars(a, bound, out));
        break;
      }
      case 'ucall': node.args.forEach(a => freeVars(a, bound, out)); break;
      case 'tuple': node.items.forEach(a => freeVars(a, bound, out)); break;
      case 'cmp': node.parts.forEach(a => { if (typeof a !== 'string') freeVars(a, bound, out); }); break;
      case 'piece': node.cases.forEach(c => { freeVars(c.cond, bound, out); freeVars(c.val, bound, out); }); freeVars(node.def, bound, out); break;
    }
    return out;
  }
  const strip = n => (n && n.n === 'group' ? strip(n.a) : n);                // remove redundant ( )
  const isVar = (n, name) => { n = strip(n); return n && n.n === 'var' && n.name === name; };

  /* ---------------------------------------------------------
     5. Code generation: syntax tree -> JavaScript source
     Generated functions get three helpers:  E (numeric library),  V (variable values by name),  F (user functions by name)
     --------------------------------------------------------- */
  const id = name => '$' + name.replace(/\W/g, '_');
  function gen(node, bound) {
    switch (node.n) {
      case 'num': return String(node.v);
      case 'var':
        if (bound.has(node.name)) return id(node.name);
        if (node.name in CONSTS) return String(CONSTS[node.name]);
        return `V[${JSON.stringify(node.name)}]`;
      case 'group': return '(' + gen(node.a, bound) + ')';
      case 'neg': return '(-' + gen(node.a, bound) + ')';
      case 'fact': return `E.fact(${gen(node.a, bound)})`;
      case 'deg': return `(E.deg?${gen(node.a, bound)}:${gen(node.a, bound)}*${D2R})`;
      case 'bin':
        if (node.op === '^') return `E.pow(${gen(node.a, bound)},${gen(node.b, bound)})`;
        return `(${gen(node.a, bound)}${node.op}${gen(node.b, bound)})`;
      case 'call': {
        const a = node.args;
        if (node.name === 'sum' || node.name === 'prod') {
          if (a.length !== 4 || a[0].n !== 'var') fail(node.name + '(variable, from, to, expression)');
          const b2 = new Set(bound); b2.add(a[0].name);
          return `E.${node.name}(function(${id(a[0].name)}){return ${gen(a[3], b2)}},${gen(a[1], bound)},${gen(a[2], bound)})`;
        }
        if (node.name === 'int') {
          if (a.length !== 4 || a[3].n !== 'var') fail('int(from, to, expression, variable)');
          const b2 = new Set(bound); b2.add(a[3].name);
          return `E.int(function(${id(a[3].name)}){return ${gen(a[2], b2)}},${gen(a[0], bound)},${gen(a[1], bound)})`;
        }
        if (node.name === 'ddx') {
          if (a.length !== 2 || a[1].n !== 'var') fail('ddx(expression, variable)');
          const b2 = new Set(bound); b2.add(a[1].name);
          return `E.ddx(function(${id(a[1].name)}){return ${gen(a[0], b2)}},${gen(a[1], bound)})`;
        }
        return `E.${node.name}(${a.map(x => gen(x, bound)).join(',')})`;
      }
      case 'ucall':
        if (node.primes) return `E.deriv(F[${JSON.stringify(node.name)}],${gen(node.args[0], bound)},${node.primes})`;
        return `F[${JSON.stringify(node.name)}](${node.args.map(x => gen(x, bound)).join(',')})`;
      case 'cmp': {
        const p = node.parts, tests = [];
        for (let i = 1; i < p.length; i += 2) {
          const op = p[i] === '=' ? '===' : p[i];
          tests.push(`(${gen(p[i - 1], bound)}${op}${gen(p[i + 1], bound)})`);
        }
        return '(' + tests.join('&&') + ')';
      }
      case 'piece': {
        let code = node.def ? gen(node.def, bound) : 'NaN';
        for (let i = node.cases.length - 1; i >= 0; i--) code = `(${gen(node.cases[i].cond, bound)}?${gen(node.cases[i].val, bound)}:${code})`;
        return code;
      }
      case 'tuple': fail('A point cannot be used here');
    }
    fail('Cannot understand this expression');
  }

  /* builds a JS function of the named parameters.  env = { V, F }  */
  function compile(node, params, env) {
    const bound = new Set(params);
    const code = gen(node, bound);
    return new Function('E', 'V', 'F', `"use strict";return function(${params.map(id).join(',')}){return ${code};}`)(E, env.V, env.F);
  }
  // the same, for a list of conditions: the function returns true when all of them hold
  function compileConds(conds, params, env) {
    if (!conds || !conds.length) return null;
    const bound = new Set(params);
    const code = conds.map(c => gen(c, bound)).join('&&');
    return new Function('E', 'V', 'F', `"use strict";return function(${params.map(id).join(',')}){return ${code};}`)(E, env.V, env.F);
  }

  /* ---------------------------------------------------------
     6. parseStatement — what kind of line is this?
     ctx = { funcs:Set of user-function names, vars:Set of names that are defined (variables/sliders) }
     Returns an object with `type` and the syntax trees needed to compile it:
       empty | error | funcdef | vardef | explicit | xexplicit | polar | implicit | ineq | point | param | value
     `needs` lists single-letter variables that are not defined anywhere (the app then adds sliders for them).
     --------------------------------------------------------- */
  const FUNCDEF = /^\s*([A-Za-z](?:_[A-Za-z0-9]+)?)\s*\(\s*([A-Za-z](?:_[A-Za-z0-9]+)?(?:\s*,\s*[A-Za-z](?:_[A-Za-z0-9]+)?)*)\s*\)\s*=(?!=)(.*)$/;

  // finds a trailing restriction { … } with no ":" inside it
  function splitRestriction(tokens) {
    if (!tokens.length || !(tokens[tokens.length - 1].t === 'op' && tokens[tokens.length - 1].v === '}')) return { main: tokens, cond: null };
    let d = 0, open = -1;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const tk = tokens[i];
      if (tk.t === 'op' && tk.v === '}') d++;
      if (tk.t === 'op' && tk.v === '{') { d--; if (d === 0) { open = i; break; } }
    }
    if (open < 0) return { main: tokens, cond: null };
    const inside = tokens.slice(open + 1, -1);
    // a colon at nesting depth 0 means piecewise notation, not a restriction
    let dd = 0, colon = false;
    inside.forEach(tk => { if (tk.t === 'op') { if ('({'.includes(tk.v)) dd++; if (')}'.includes(tk.v)) dd--; if (dd === 0 && tk.v === ':') colon = true; } });
    if (colon || open === 0) return { main: tokens, cond: null };
    return { main: tokens.slice(0, open), cond: parseConditions(inside) };
  }

  function splitRelations(tokens) {
    const parts = [], rels = []; let cur = [], d = 0;
    tokens.forEach(tk => {
      if (tk.t === 'op') { if ('({'.includes(tk.v)) d++; if (')}'.includes(tk.v)) d--; }
      if (d === 0 && tk.t === 'op' && REL.includes(tk.v)) { parts.push(cur); rels.push(tk.v); cur = []; } else cur.push(tk);
    });
    parts.push(cur);
    return { parts, rels };
  }

  function parseStatement(text, ctx) {
    ctx = ctx || {};
    const funcs = ctx.funcs || new Set(), vars = ctx.vars || new Set();
    const src = prep(text || '');
    if (!src.trim()) return { type: 'empty' };
    try {
      // --- function definition  f(x) = …
      const fm = FUNCDEF.exec(src);
      if (fm && !CONSTS[fm[1]] && !FUNCS[fm[1]]) {
        const args = fm[2].split(',').map(s => s.trim());
        const { main, cond } = splitRestriction(tokenize(fm[3], ctx));
        if (!main.length) fail('Nothing after "="');
        const ast = parseTokens(main);
        const free = freeVars(ast); args.forEach(a => free.delete(a));
        (cond || []).forEach(c => freeVars(c, new Set(args), free));
        return { type: 'funcdef', name: fm[1], args, ast, cond, needs: [...free].filter(n => !vars.has(n)) };
      }

      const { main, cond } = splitRestriction(tokenize(src, ctx));
      const { parts, rels } = splitRelations(main);
      if (parts.some(pt => !pt.length)) fail('Expression is incomplete');
      const trees = parts.map(parseTokens);
      const condFree = new Set(); (cond || []).forEach(c => freeVars(c, new Set(), condFree));

      const undef = set => [...set].filter(n => !vars.has(n));
      const none = new Set();

      // --- no relation: a bare expression
      if (rels.length === 0) {
        const ast = strip(trees[0]);
        const free = freeVars(ast);
        if (ast.n === 'tuple') {
          if (ast.items.length !== 2) fail('Only 2-D points (x, y) are supported');
          // a parametric curve: a point whose free variable is limited by a restriction
          const pv = [...free].find(n => condFree.has(n) && !vars.has(n));
          if (pv && cond) return { type: 'param', ast, cond, v: pv, needs: undef(new Set([...free, ...condFree].filter(n => n !== pv))) };
          return { type: 'point', ast, cond, needs: undef(new Set([...free, ...condFree])) };
        }
        if (free.has('x') || (free.has('y') && !free.has('x') && false)) return { type: 'explicit', ast, cond, needs: undef(new Set([...free, ...condFree].filter(n => n !== 'x'))) };
        return { type: 'value', ast, cond, needs: undef(free) };
      }
      if (rels.length > 1) fail('Only one =, <, > … per line (use { } for restrictions)');
      const rel = rels[0], L = strip(trees[0]), R = strip(trees[1]);
      const fl = freeVars(L), fr = freeVars(R);
      const allFree = new Set([...fl, ...fr]);
      const need = excl => undef(new Set([...allFree, ...condFree].filter(n => !excl.includes(n))));

      if (rel === '=') {
        // y = f(x)   (also f(x) = y)
        if (isVar(L, 'y') && !fr.has('y')) return { type: 'explicit', ast: R, cond, needs: need(['x', 'y']) };
        if (isVar(R, 'y') && !fl.has('y')) return { type: 'explicit', ast: L, cond, needs: need(['x', 'y']) };
        // x = g(y)
        if (isVar(L, 'x') && !fr.has('x')) return { type: 'xexplicit', ast: R, cond, needs: need(['x', 'y']) };
        if (isVar(R, 'x') && !fl.has('x')) return { type: 'xexplicit', ast: L, cond, needs: need(['x', 'y']) };
        // r = f(θ)  — polar curve
        if (isVar(L, 'r') && !vars.has('r') && !fr.has('r') && !fr.has('x') && !fr.has('y')) return { type: 'polar', ast: R, cond, needs: need(['theta', 'r']) };
        // a = 3 or a = b + 1 — a variable (shows a slider if it is a plain number)
        if (L.n === 'var' && !['x', 'y', 'e', 'pi', 'tau'].includes(L.name) && !fr.has('x') && !fr.has('y') && !fr.has(L.name))
          return { type: 'vardef', name: L.name, ast: R, needs: undef(fr) };
        if (allFree.has('x') || allFree.has('y') || condFree.has('x') || condFree.has('y'))
          return { type: 'implicit', ast: { n: 'bin', op: '-', a: L, b: R }, cond, needs: need(['x', 'y']) };
        return { type: 'value', ast: { n: 'cmp', parts: [L, '=', R] }, cond, needs: undef(allFree), boolean: true };
      }

      // inequalities
      const boundary = { n: 'bin', op: '-', a: L, b: R };
      let bd = null;                                           // an explicit form of the boundary, if there is one
      if (isVar(L, 'y') && !fr.has('y')) bd = { kind: 'y', ast: R };
      else if (isVar(R, 'y') && !fl.has('y')) bd = { kind: 'y', ast: L };
      else if (isVar(L, 'x') && !fr.has('x')) bd = { kind: 'x', ast: R };
      else if (isVar(R, 'x') && !fl.has('x')) bd = { kind: 'x', ast: L };
      if (!(allFree.has('x') || allFree.has('y'))) return { type: 'value', ast: { n: 'cmp', parts: [L, rel, R] }, cond, needs: undef(allFree), boolean: true };
      if (rel === '!=') fail('≠ cannot be graphed');
      return { type: 'ineq', L, R, rel, boundary, bd, cond, needs: need(['x', 'y']) };
    } catch (e) {
      if (e instanceof MathError) return { type: 'error', msg: e.message };
      throw e;
    }
  }

  /* ---------------------------------------------------------
     7. Small helpers for the app
     --------------------------------------------------------- */
  // nice number text:  0.30000000000004 -> 0.3 ; very large/small numbers use ×10^
  function format(v, digits = 10) {
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (!isFinite(v)) return v === Infinity ? '∞' : v === -Infinity ? '−∞' : 'undefined';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e12 || a < 1e-6) {
      const [m, ex] = v.toExponential(digits - 1).split('e');
      return parseFloat(m) + '×10^' + parseInt(ex, 10);
    }
    return String(parseFloat(v.toPrecision(digits)));
  }

  // from a restriction like  0 <= t <= 2  pull out the lower / upper bound trees for variable v
  function boundsFor(cond, v) {
    let lo = null, hi = null;
    (cond || []).forEach(c => {
      const p = c.parts;
      for (let i = 0; i < p.length; i += 2) {
        if (!isVar(p[i], v)) continue;
        const prevOp = p[i - 1], nextOp = p[i + 1];
        if (nextOp === '<' || nextOp === '<=') hi = p[i + 2];            // t <= b
        if (nextOp === '>' || nextOp === '>=') lo = p[i + 2];            // t >= a
        if (prevOp === '<' || prevOp === '<=') lo = p[i - 1 - 1];        // a <= t
        if (prevOp === '>' || prevOp === '>=') hi = p[i - 1 - 1];        // b >= t
      }
    });
    return { lo, hi };
  }

  window.MathEngine = { E, latexToText, parseStatement, compile, compileConds, freeVars, boundsFor, format, CONSTS, FUNCS };
})();
