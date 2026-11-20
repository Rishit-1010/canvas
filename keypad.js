/* =========================================================
   keypad.js — the on-screen keyboard of the Graph Calculator
   ---------------------------------------------------------
   Opened by the keyboard button beside "+". It types into whichever equation field is focused:
     • a MathLive <math-field>  -> keys insert LaTeX (placeholders "#?" are filled in by MathLive)
     • the plain <input> fallback (used if MathLive could not load) -> keys insert plain text
   Tabs:  123 (numbers & basics) · f(x) (trig, calculus, logs …) · ABC (letters) · αβγ (Greek) · #+= (symbols)
   A key is described as  [ label (HTML), latex, plain-text, extra class ]
   or  { act(mf), plain, label }  when it needs a special MathLive command (like "moveToSuperscript").
   ========================================================= */
(function () {
  'use strict';

  /* ---------- key tables ---------- */
  const K = (label, latex, plain, cls) => ({ label, latex, plain: plain === undefined ? latex : plain, cls });
  const fn = (label, name, plain) => K(label, `\\${name}\\left(#?\\right)`, plain || name + '(', 'fn');
  // "a²" and "aᵇ" use MathLive's own commands so the exponent is created properly
  const SQUARE = { label: 'a<sup>2</sup>', plain: '^2', act: mf => { mf.executeCommand('moveToSuperscript'); mf.insert('2'); mf.executeCommand('moveToNextChar'); } };
  const POWER = { label: 'a<sup>b</sup>', plain: '^', act: mf => mf.executeCommand('moveToSuperscript') };
  const SUBSCR = { label: 'a<sub>b</sub>', plain: '_', act: mf => mf.executeCommand('moveToSubscript') };
  const CLOSE = { label: ')', plain: ')', act: mf => mf.executeCommand('moveToNextChar') };      // steps out of a bracket pair

  // the "123" tab: 4 columns of symbols, then 4 columns of digits
  const NUM = [
    [K('x', 'x'), K('y', 'y'), SQUARE, POWER,            K('7', '7', '7', 'num'), K('8', '8', '8', 'num'), K('9', '9', '9', 'num'), K('÷', '\\div', '/', 'op')],
    [K('(', '\\left(#?\\right)', '('), CLOSE, K('&lt;', '<'), K('&gt;', '>'),   K('4', '4', '4', 'num'), K('5', '5', '5', 'num'), K('6', '6', '6', 'num'), K('×', '\\times', '*', 'op')],
    [K('|a|', '\\left|#?\\right|', '|'), K(',', ','), K('≤', '\\le', '<='), K('≥', '\\ge', '>='), K('1', '1', '1', 'num'), K('2', '2', '2', 'num'), K('3', '3', '3', 'num'), K('−', '-', '-', 'op')],
    [K('√', '\\sqrt{#?}', 'sqrt('), K('π', '\\pi', 'pi'), K('e', 'e'), K('a/b', '\\frac{#@}{#?}', '/'),   K('0', '0', '0', 'num'), K('.', '.', '.', 'num'), K('=', '='), K('+', '+', '+', 'op')]
  ];

  // the "f(x)" tab — grouped, scrolls
  const FUNCS = [
    ['Trigonometry', [fn('sin', 'sin'), fn('cos', 'cos'), fn('tan', 'tan'), fn('csc', 'csc'), fn('sec', 'sec'), fn('cot', 'cot')]],
    ['Inverse trig', [fn('sin<sup>−1</sup>', 'arcsin', 'arcsin('), fn('cos<sup>−1</sup>', 'arccos', 'arccos('), fn('tan<sup>−1</sup>', 'arctan', 'arctan('),
      fn('csc<sup>−1</sup>', 'arccsc', 'arccsc('), fn('sec<sup>−1</sup>', 'arcsec', 'arcsec('), fn('cot<sup>−1</sup>', 'arccot', 'arccot(')]],
    ['Hyperbolic', [fn('sinh', 'sinh'), fn('cosh', 'cosh'), fn('tanh', 'tanh'), fn('csch', 'operatorname{csch}', 'csch('), fn('sech', 'operatorname{sech}', 'sech('), fn('coth', 'coth')]],
    ['Calculus', [K('d/dx', '\\frac{d}{dx}\\left(#?\\right)', 'ddx(', 'fn'), K('∫', '\\int_{#?}^{#?}#?\\,dx', 'int(0,1,,x)', 'fn'), K('Σ', '\\sum_{n=#?}^{#?}\\left(#?\\right)', 'sum(n,1,10,', 'fn'),
      K('Π', '\\prod_{n=#?}^{#?}\\left(#?\\right)', 'prod(n,1,10,', 'fn'), K('f′', "'", "'", 'fn'), K('∞', '1e308', '1e308', 'fn')]],
    ['Logs & powers', [fn('ln', 'ln'), fn('log', 'log'), K('log<sub>a</sub>', '\\log_{#?}\\left(#?\\right)', 'log_2(', 'fn'), K('e<sup>x</sup>', 'e^{#?}', 'e^', 'fn'), K('10<sup>x</sup>', '10^{#?}', '10^', 'fn'),
      K('√', '\\sqrt{#?}', 'sqrt(', 'fn'), K('ⁿ√', '\\sqrt[#?]{#?}', 'nroot(', 'fn'), K('a/b', '\\frac{#@}{#?}', '/', 'fn'), SQUARE, POWER, SUBSCR]],
    ['Numbers', [fn('abs', 'operatorname{abs}', 'abs('), fn('floor', 'operatorname{floor}', 'floor('), fn('ceil', 'operatorname{ceil}', 'ceil('), fn('round', 'operatorname{round}', 'round('), fn('sign', 'operatorname{sign}', 'sign('), K('n!', '!', '!', 'fn'),
      fn('min', 'operatorname{min}', 'min('), fn('max', 'operatorname{max}', 'max('), fn('mod', 'operatorname{mod}', 'mod('), fn('gcd', 'operatorname{gcd}', 'gcd('), fn('lcm', 'operatorname{lcm}', 'lcm('), fn('nCr', 'operatorname{nCr}', 'nCr('), fn('nPr', 'operatorname{nPr}', 'nPr(')]],
    ['Constants', [K('π', '\\pi', 'pi'), K('e', 'e'), K('τ', '\\tau', 'tau'), K('θ', '\\theta', 'theta'), K('°', '^{\\circ}', '°')]]
  ];

  const ROWS_ABC = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const GREEK = [['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ε', 'epsilon'], ['ζ', 'zeta'], ['η', 'eta'], ['θ', 'theta'], ['λ', 'lambda'], ['μ', 'mu'],
    ['ν', 'nu'], ['ξ', 'xi'], ['ρ', 'rho'], ['σ', 'sigma'], ['τ', 'tau'], ['φ', 'phi'], ['χ', 'chi'], ['ψ', 'psi'], ['ω', 'omega'], ['π', 'pi'],
    ['Γ', 'Gamma'], ['Δ', 'Delta'], ['Θ', 'Theta'], ['Λ', 'Lambda'], ['Ξ', 'Xi'], ['Σ', 'Sigma'], ['Φ', 'Phi'], ['Ψ', 'Psi'], ['Ω', 'Omega']];
  const SYMBOLS = [K('(', '\\left(#?\\right)', '('), CLOSE, K('[', '['), K(']', ']'), K('{', '\\left\\{#?\\right\\}', '{'), K('}', '}'),
    K('|', '|'), K(',', ','), K(':', ':'), K('!', '!'), K("′", "'", "'"), K('°', '^{\\circ}', '°'), K('=', '='), K('&lt;', '<'), K('&gt;', '>'), K('≤', '\\le', '<='), K('≥', '\\ge', '>='),
    K('+', '+'), K('−', '-'), K('×', '\\times', '*'), K('÷', '\\div', '/'), K('^', '^', '^'), SUBSCR, K('√', '\\sqrt{#?}', 'sqrt('), K('π', '\\pi', 'pi')];

  /* ---------- the keypad ---------- */
  function create({ host, getField, onEnter, onHide }) {
    let shift = false, tab = 'num';
    const el = document.createElement('div');
    el.id = 'gKeypad';
    el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'On-screen keypad');
    host.appendChild(el);

    /* --- typing into the focused field --- */
    function field() { return getField && getField(); }
    function press(key) {
      const f = field(); if (!f) return;
      if (f.type === 'math') {
        const mf = f.el;
        mf.focus();
        try {
          if (key.act) key.act(mf);
          else mf.insert(key.latex, { format: 'latex', focus: true, feedback: false });
        } catch (e) { console.warn('keypad insert failed', e); }
      } else {                                                   // plain <input> fallback
        const inp = f.el; inp.focus();
        const text = key.plain !== undefined ? key.plain : key.latex || '';
        const a = inp.selectionStart, b = inp.selectionEnd;
        inp.setRangeText(text, a, b, 'end');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    function control(kind) {
      const f = field();
      if (kind === 'enter') return onEnter && onEnter();
      if (!f) return;
      if (f.type === 'math') {
        const mf = f.el; mf.focus();
        mf.executeCommand(kind === 'left' ? 'moveToPreviousChar' : kind === 'right' ? 'moveToNextChar' : 'deleteBackward');
      } else {
        const inp = f.el; inp.focus();
        if (kind === 'left') inp.setSelectionRange(Math.max(0, inp.selectionStart - 1), Math.max(0, inp.selectionStart - 1));
        else if (kind === 'right') inp.setSelectionRange(inp.selectionEnd + 1, inp.selectionEnd + 1);
        else {
          const a = inp.selectionStart, b = inp.selectionEnd;
          if (a !== b) inp.setRangeText('', a, b, 'end'); else if (a > 0) inp.setRangeText('', a - 1, a, 'end');
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }

    /* --- building the buttons --- */
    const btn = (label, cls, handler, opts = {}) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'kp-key ' + (cls || '');
      b.innerHTML = label.startsWith('<span') ? label : '<span class="kp-l">' + label + '</span>';   // one inner box keeps sup / sub on the same line
      if (opts.title) { b.title = opts.title; b.setAttribute('aria-label', opts.title); }
      // pointerdown + preventDefault keeps the keyboard focus in the equation field
      b.addEventListener('pointerdown', e => { e.preventDefault(); handler(); opts.repeat && startRepeat(handler, b); });
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', e => e.preventDefault());
      return b;
    };
    let rep = null;
    function startRepeat(handler) {                            // hold ⌫ to keep deleting
      stopRepeat();
      rep = setTimeout(() => { rep = setInterval(handler, 70); }, 380);
      const stop = () => { stopRepeat(); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
      window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
    }
    function stopRepeat() { clearTimeout(rep); clearInterval(rep); rep = null; }

    function grid(cols, keys) {
      const g = document.createElement('div');
      g.className = 'kp-grid'; g.style.setProperty('--cols', cols);
      keys.forEach(k => g.appendChild(k));
      return g;
    }
    const keyBtn = k => btn(k.label, k.cls, () => press(k));

    function bodyNum() {
      return grid(8, NUM.flat().map(keyBtn));
    }
    function bodyFuncs() {
      const wrap = document.createElement('div'); wrap.className = 'kp-scroll';
      FUNCS.forEach(([title, keys]) => {
        const h = document.createElement('div'); h.className = 'kp-title'; h.textContent = title;
        wrap.append(h, grid(6, keys.map(keyBtn)));
      });
      return wrap;
    }
    function bodyAbc() {
      const wrap = document.createElement('div'); wrap.className = 'kp-abc';
      ROWS_ABC.forEach((row, i) => {
        const keys = [...row].map(ch => { const c = shift ? ch.toUpperCase() : ch; return btn(c, 'let', () => press(K(c, c))); });
        if (i === 2) keys.unshift(btn('⇧', 'op' + (shift ? ' on' : ''), () => { shift = !shift; render(); }, { title: 'Shift' }));
        if (i === 2) keys.push(btn('_', 'op', () => press(SUBSCR), { title: 'Subscript' }));
        const g = grid(row.length + (i === 2 ? 2 : 0), keys);
        if (i === 1) g.classList.add('kp-indent');
        wrap.appendChild(g);
      });
      return wrap;
    }
    function bodyGreek() {
      const wrap = document.createElement('div'); wrap.className = 'kp-scroll';
      wrap.appendChild(grid(8, GREEK.map(([ch, name]) => btn(ch, 'let', () => press(K(ch, '\\' + name, name))))));
      return wrap;
    }
    function bodySymbols() { return grid(6, SYMBOLS.map(keyBtn)); }

    const TABS = [['num', '123'], ['func', 'f(x)'], ['abc', 'ABC'], ['greek', 'αβγ'], ['sym', '#+=']];

    function render() {
      el.innerHTML = '';
      // top bar: tabs + hide button
      const bar = document.createElement('div'); bar.className = 'kp-bar';
      TABS.forEach(([id, label]) => {
        const t = btn(label, 'kp-tab' + (tab === id ? ' on' : ''), () => { tab = id; render(); });
        bar.appendChild(t);
      });
      const hide = btn('<span data-icon="chevDown"></span>', 'kp-hide', () => onHide && onHide(), { title: 'Hide keypad' });
      bar.appendChild(hide);
      el.appendChild(bar);
      // body
      const body = { num: bodyNum, func: bodyFuncs, abc: bodyAbc, greek: bodyGreek, sym: bodySymbols }[tab]();
      body.classList.add('kp-body'); el.appendChild(body);
      // bottom row (same on every tab)
      const ctl = document.createElement('div'); ctl.className = 'kp-ctl';
      ctl.append(
        btn('<span data-icon="chevL"></span>', 'op', () => control('left'), { title: 'Move left', repeat: true }),
        btn('<span data-icon="chevR"></span>', 'op', () => control('right'), { title: 'Move right', repeat: true }),
        btn('<span data-icon="backspace"></span>', 'op', () => control('back'), { title: 'Backspace', repeat: true }),
        btn('<span data-icon="enter"></span>', 'op enter', () => control('enter'), { title: 'Enter' })
      );
      el.appendChild(ctl);
      if (window.UI) window.UI.hydrateIcons(el);
    }
    render();

    return {
      el,
      get isOpen() { return document.body.classList.contains('kp-open'); },
      open() { document.body.classList.add('kp-open'); },
      close() { document.body.classList.remove('kp-open'); },
      toggle() { document.body.classList.toggle('kp-open'); }
    };
  }

  window.Keypad = { create };
})();
