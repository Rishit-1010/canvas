/* =========================================================
   ui.js — small reusable UI building blocks
   (element helper, slider, swatches, figma-like colour picker,
    option grids, confirmation dialog)
   ========================================================= */
(function () {
  'use strict';
  const ICONS = window.ICONS;

  /* ---------- tiny DOM helper: h('div', {class:'x'}, child, child …) ---------- */
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return el;
  }

  /* fills every [data-icon="name"] element with the matching SVG */
  function hydrateIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = ICONS[el.dataset.icon] || ''; });
  }

  /* ---------- colour maths ---------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function normHex(s) {
    s = String(s).trim().replace('#', '');
    if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toUpperCase() : null;
  }
  const hexToRgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    if (d) {
      if (mx === r) hh = ((g - b) / d) % 6;
      else if (mx === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hh *= 60; if (hh < 0) hh += 360;
    }
    return [hh, mx ? d / mx : 0, mx];
  }
  function hsvToRgb(hh, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (hh < 60) { r = c; g = x; }
    else if (hh < 120) { r = x; g = c; }
    else if (hh < 180) { g = c; b = x; }
    else if (hh < 240) { g = x; b = c; }
    else if (hh < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  /* 0 (dark) … 1 (light) */
  function luminance(hex) { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

  /* ---------- figma-like colour picker: saturation/brightness square, hue slider, hex box ---------- */
  function colorPicker(initial, onChange) {
    let [hue, sat, val] = rgbToHsv(...hexToRgb(normHex(initial) || '#000000'));

    const sv = h('div', { class: 'cp-sv' });
    const handle = h('div', { class: 'cp-handle' });
    sv.append(handle);
    const hueIn = h('input', { type: 'range', class: 'cp-hue', min: 0, max: 360, value: hue });
    const swatch = h('div', { class: 'cp-swatch' });
    const hexIn = h('input', { type: 'text', maxlength: 7, spellcheck: 'false', 'aria-label': 'Hex colour' });
    const row = h('div', { class: 'cp-row' }, swatch, h('div', { class: 'cp-hexwrap' }, hexIn));

    const current = () => rgbToHex(...hsvToRgb(hue, sat, val));

    // redraws the picker; skipHex stops us overwriting what the user is typing
    function paint(skipHex) {
      sv.style.background = `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${hue},100%,50%))`;
      handle.style.left = sat * 100 + '%';
      handle.style.top = (1 - val) * 100 + '%';
      const c = current();
      swatch.style.background = c;
      handle.style.background = c;
      if (!skipHex) hexIn.value = c;
    }
    function emit(skipHex) { paint(skipHex); onChange(current()); }

    function svMove(e) {
      const r = sv.getBoundingClientRect();
      sat = clamp((e.clientX - r.left) / r.width, 0, 1);
      val = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
      emit();
    }
    sv.addEventListener('pointerdown', e => { sv.setPointerCapture(e.pointerId); svMove(e); sv.onpointermove = svMove; });
    sv.addEventListener('pointerup', () => { sv.onpointermove = null; });
    hueIn.addEventListener('input', () => { hue = +hueIn.value; emit(); });
    hexIn.addEventListener('input', () => {
      const n = normHex(hexIn.value);
      if (n) { [hue, sat, val] = rgbToHsv(...hexToRgb(n)); hueIn.value = hue; emit(true); }
    });
    hexIn.addEventListener('blur', () => { hexIn.value = current(); });

    // optional eyedropper (Chrome / Edge)
    if ('EyeDropper' in window) {
      row.append(h('button', { class: 'cp-eye', type: 'button', title: 'Pick from screen', html: ICONS.eyedrop, onclick: () => {
        new window.EyeDropper().open().then(r => api.set(r.sRGBHex)).catch(() => {});
      } }));
    }

    const el = h('div', { class: 'cp' }, sv, hueIn, row);
    paint();
    const api = {
      el,
      // lets the swatches update the picker from outside
      set(hex, silent) {
        const n = normHex(hex); if (!n) return;
        [hue, sat, val] = rgbToHsv(...hexToRgb(n)); hueIn.value = hue;
        if (silent) paint(); else emit();
      }
    };
    return api;
  }

  /* ---------- dialog helpers ---------- */
  const title = (text, icon) => h('div', { class: 'pop-title', html: (icon ? ICONS[icon] : '') + `<span>${text}</span>` });
  const section = (label, ...kids) => h('div', { class: 'pop-sec' }, label ? h('div', { class: 'pop-label', text: label }) : null, ...kids);

  /* slider with live value read-out */
  function slider({ min, max, value, step = 1, unit = '', onInput }) {
    const val = h('span', { class: 'slider-val' });
    const inp = h('input', { type: 'range', min, max, step, value });
    const upd = () => { val.textContent = inp.value + unit; };
    inp.addEventListener('input', () => { upd(); onInput(+inp.value); });
    upd();
    return h('div', { class: 'slider-row' }, inp, val);
  }

  /* row of preset colours + a "+" button that opens the colour picker */
  function swatches({ colors, value, onPick }) {
    let cur = value;
    let picker = null;
    const holder = h('div');
    const same = (a, b) => a.toLowerCase() === b.toLowerCase();

    const btns = colors.map(c => h('button', { class: 'sw', type: 'button', title: c, style: { background: c }, onclick: () => {
      cur = c; mark(); onPick(c); if (picker) picker.set(c, true);
    } }));
    const custom = h('button', { class: 'sw sw-custom', type: 'button', title: 'Custom colour', html: ICONS.plus, onclick: () => {
      if (picker) { picker.el.remove(); picker = null; return; }
      picker = colorPicker(cur, hex => { cur = hex; mark(); onPick(hex); });
      holder.append(picker.el);
    } });

    function mark() {
      btns.forEach((b, i) => b.classList.toggle('active', same(colors[i], cur)));
      custom.classList.toggle('active', !colors.some(c => same(c, cur)));
    }
    mark();
    return h('div', {}, h('div', { class: 'swatches' }, ...btns, custom), holder);
  }

  /* grid of icon buttons (shapes, patterns, geometry tools …) */
  function grid({ items, value, cols = 5, onPick, labels = false }) {
    return h('div', { class: 'opt-grid', style: { '--cols': cols } }, ...items.map(it =>
      h('button', { class: 'opt' + (it.id === value ? ' active' : ''), type: 'button', title: it.name || it.label || '', onclick: () => onPick(it.id) },
        h('span', { html: ICONS[it.icon] || '' }), labels ? h('span', { text: it.label || it.name }) : null)));
  }

  /* vertical list of wide option buttons (selection modes …) */
  function list({ items, value, onPick }) {
    return h('div', { class: 'opt-list' }, ...items.map(it =>
      h('button', { class: 'opt wide' + (it.id === value ? ' active' : ''), type: 'button', onclick: () => onPick(it.id) },
        h('span', { html: ICONS[it.icon] || '' }), h('span', { text: it.label }))));
  }

  /* promise-based confirmation dialog */
  function confirmDialog({ title: t, message, okText = 'Confirm' }) {
    return new Promise(resolve => {
      const modal = document.getElementById('modal');
      const close = ok => { modal.classList.remove('open'); modal.innerHTML = ''; resolve(ok); };
      modal.innerHTML = '';
      modal.append(h('div', { class: 'modal-card', role: 'dialog' },
        h('h3', { text: t }), h('p', { text: message }),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => close(false) }),
          h('button', { class: 'btn primary', type: 'button', text: okText, onclick: () => close(true) }))));
      modal.classList.add('open');
      modal.onclick = e => { if (e.target === modal) close(false); };
    });
  }

  window.UI = { h, hydrateIcons, clamp, normHex, hexToRgb, luminance, colorPicker, title, section, slider, swatches, grid, list, confirm: confirmDialog };
})();
