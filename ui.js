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

  /* Fills every [data-icon="name"] element with the matching SVG.
     Elements that also have data-exact are placed at the exact size and offset
     taken from the design (see ICON_BOX in icons-design.js); their parent must be position:relative. */
  function hydrateIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach(el => {
      const name = el.dataset.icon;
      el.innerHTML = ICONS[name] || '';
      const b = window.ICON_BOX && window.ICON_BOX[name];
      if (el.hasAttribute('data-exact') && b) {
        Object.assign(el.style, { position: 'absolute', left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
      }
    });
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
      hueIn.style.setProperty('--hue', 'hsl(' + hue + ',100%,50%)');   // colour shown inside the slider thumb
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

  /* Slider: a navy "filled" track, a big round thumb and a value pill.
     The filled part is drawn by CSS using the --p variable (0-100%). */
  function slider({ min, max, value, step = 1, unit = '', onInput }) {
    const val = h('span', { class: 'slider-val' });
    const inp = h('input', { type: 'range', min, max, step, value });
    const upd = () => {
      val.textContent = inp.value + unit;
      inp.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%');
    };
    inp.addEventListener('input', () => { upd(); onInput(+inp.value); });
    upd();
    return h('div', { class: 'slider-row' }, inp, val);
  }

  /* promise-based number prompt (used by tools that need a length, angle or factor) */
  function promptNumber({ title: t, label, value = '', unit = '', integer = false, min = null, max = null }) {
    return new Promise(resolve => {
      const modal = document.getElementById('modal');
      const input = h('input', { type: 'number', step: integer ? 1 : 'any', min, max, value, class: 'prompt-input', 'aria-label': label });
      const close = v => { modal.classList.remove('open'); modal.innerHTML = ''; resolve(v); };
      const ok = () => {
        let n = parseFloat(input.value);
        if (!Number.isFinite(n)) return input.focus();
        if (integer) n = Math.round(n);
        if ((min != null && n < min) || (max != null && n > max)) { input.classList.add('bad'); return input.focus(); }   // out of range: keep the dialog open
        close(n);
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') close(null); e.stopPropagation(); });
      modal.innerHTML = '';
      modal.append(h('div', { class: 'modal-card', role: 'dialog' },
        h('h3', { text: t }),
        h('div', { class: 'prompt-row' }, h('label', { text: label }), input, unit ? h('span', { class: 'prompt-unit', text: unit }) : null),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => close(null) }),
          h('button', { class: 'btn primary', type: 'button', text: 'OK', onclick: ok }))));
      modal.classList.add('open');
      modal.onclick = e => { if (e.target === modal) close(null); };
      setTimeout(() => { input.focus(); input.select(); }, 0);
    });
  }

  /* Row of preset colours, then (once the user has picked one) their custom colour, then the rainbow
     "+" button that opens the colour picker. The custom colour is remembered for every dialog. */
  let lastCustom = null;
  function swatches({ colors, value, onPick }) {
    let cur = value;
    let picker = null;
    const holder = h('div');
    const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
    const isPreset = c => colors.some(p => same(p, c));
    if (!lastCustom && value && !isPreset(value)) lastCustom = value;     // a custom colour is already in use

    const btns = colors.map(c => h('button', { class: 'sw', type: 'button', title: c, style: { background: c }, onclick: () => {
      cur = c; mark(); onPick(c); if (picker) picker.set(c, true);
    } }));
    // slot for the user's custom colour (sits immediately left of the rainbow button)
    const slot = h('button', { class: 'sw sw-slot', type: 'button', title: 'Your custom colour', onclick: () => {
      cur = lastCustom; mark(); onPick(cur); if (picker) picker.set(cur, true);
    } });
    const rainbow = h('button', { class: 'sw sw-custom', type: 'button', title: 'Custom colour', html: ICONS.plus, onclick: () => {
      if (picker) { picker.el.remove(); picker = null; mark(); return; }
      picker = colorPicker(cur, hex => { cur = hex; if (!isPreset(hex)) lastCustom = hex; mark(); onPick(hex); });
      holder.append(picker.el); mark();
    } });

    function mark() {
      btns.forEach((b, i) => b.classList.toggle('active', same(colors[i], cur)));
      slot.hidden = !lastCustom;
      if (lastCustom) { slot.style.background = lastCustom; slot.classList.toggle('active', same(lastCustom, cur)); }
      rainbow.classList.toggle('active', !!picker);
    }
    mark();
    return h('div', {}, h('div', { class: 'swatches' }, ...btns, slot, rainbow), holder);
  }

  /* grid of icon buttons (shapes, patterns, geometry tools …); labels:true shows the name under each icon */
  function grid({ items, value, cols = 5, onPick, labels = false }) {
    return h('div', { class: 'opt-grid' + (labels ? ' labelled' : ''), style: { '--cols': cols } }, ...items.map(it =>
      h('button', { class: 'opt' + (it.id === value ? ' active' : ''), type: 'button', title: it.name || it.label || '', onclick: () => onPick(it.id) },
        h('span', { class: 'opt-ico', html: ICONS[it.icon] || '' }), labels ? h('span', { class: 'opt-name', text: it.label || it.name }) : null)));
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

  window.UI = { h, hydrateIcons, clamp, normHex, hexToRgb, luminance, colorPicker, title, section, slider, swatches, grid, list, confirm: confirmDialog, prompt: promptNumber };
})();
