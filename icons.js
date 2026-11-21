/* =========================================================
   icons.js — every icon used in the app, as inline SVG
   All icons use "currentColor", so CSS decides their colour.
   ========================================================= */
(function () {
  'use strict';

  // wraps path markup in a standard 24x24 stroke icon
  const s = (body, sw = 1.7) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  // small filled dot used by the geometry icons
  const dot = (x, y, r = 1.9) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

  const HAND = {
    /* ---------- app / sidebar ---------- */
    panel: s('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M9.5 3.5v17"/>'),
    pencil: s('<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>'),
    chart: s('<path d="M4 4v16h16"/><path d="M7 15l3.5-5 3 3 4-6"/>'),
    image: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>'),
    download: s('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>'),
    upload: s('<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 20h14"/>'),
    folder: s('<path d="M3.5 7a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),

    /* ---------- main toolbar ---------- */
    select: s('<path d="M5 3.5l13 7.5-5.8 1.6-2.2 5.9z"/>'),
    move: s('<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8.5a6 6 0 0 1-6 6h-.5a5.5 5.5 0 0 1-4.6-2.5L3.5 14a1.5 1.5 0 0 1 2.5-1.6L8 15"/>'),
    pen: s('<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>'),
    eraser: s('<path d="M9 20h11M4.6 14.4l8.3-8.3a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L11.5 19.5a1.5 1.5 0 0 1-1 .4H8a2 2 0 0 1-1.4-.6L4.6 17.2a1.5 1.5 0 0 1 0-2.8z"/><path d="M9 9.5l6 6"/>'),
    shapes: s('<path d="M12 3.5l-3.2 6h6.4z"/><circle cx="7.5" cy="16.5" r="3.5"/><rect x="13" y="13" width="7.5" height="7.5" rx="1"/>'),
    wrench: s('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>'),
    broom: s('<path d="M13.5 3.5l-3 7.5"/><path d="M7 11h8.5l2.5 9.5H4.5z"/><path d="M9.5 20.5l1-5M13.5 20.5l-.5-5"/>'),
    text: s('<path d="M5 5h14v3.2h-1.2V6.8H13v10.4h2v1.8H9v-1.8h2V6.8H6.2v1.4H5z" fill="currentColor" stroke="none"/>', 1),
    backdrop: s('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7.5 16l3.5-4 2.5 3 1.5-2 2 3"/><circle cx="15.5" cy="9" r="1"/>'),

    /* ---------- board bar & misc ---------- */
    undo: s('<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H15a5 5 0 0 1 0 10h-3"/>'),
    redo: s('<path d="M15 14l4.5-4.5L15 5"/><path d="M19.5 9.5H9a5 5 0 0 0 0 10h3"/>'),
    chevL: s('<path d="M15 5l-7 7 7 7"/>', 2),
    chevR: s('<path d="M9 5l7 7-7 7"/>', 2),
    plus: s('<path d="M12 5v14M5 12h14"/>', 2.4),
    minus: s('<path d="M5 12h14"/>', 2.4),
    trash: s('<path d="M9 3.5h6l.7 1.5H20v2H4V5h4.3zM6 9h12l-.9 11H6.9z" fill="currentColor" stroke="none"/>', 1),
    folder: s('<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
    eye: s('<path d="M2.5 12C5 7.5 8.5 6 12 6s7 1.5 9.5 6c-2.5 4.5-6 6-9.5 6S5 16.5 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
    eyeOff: s('<path d="M3 3l18 18M10.6 6.1A9 9 0 0 1 21.5 12c-.6 1.2-1.4 2.2-2.3 3M6.5 7.7C4.8 8.8 3.4 10.3 2.5 12c2.5 4.5 6 6 9.5 6 1.3 0 2.5-.3 3.7-.8"/>'),
    close: s('<path d="M6 6l12 12M18 6L6 18"/>', 2),
    copy: s('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>'),
    rotate: s('<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 4v4.5h-4.5"/>'),
    move4: s('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
    tip: s('<circle cx="12" cy="12" r="3.2" fill="currentColor"/>'),
    eyedrop: s('<path d="M14 6l4 4M16 4.5a2.1 2.1 0 0 1 3 3L9 17.5 5 19l1.5-4z"/>'),

    /* ---------- selection modes ---------- */
    lasso: s('<path d="M12 4c4.5 0 8 1.8 8 4.2S16.5 12.5 12 12.5 4 10.6 4 8.2 7.5 4 12 4z" stroke-dasharray="2 2.4"/><path d="M8.5 12.2c-1 1.8-.5 4 1.5 5s1.5 2.5.5 3.5"/>'),
    rectsel: s('<rect x="4" y="5.5" width="16" height="13" rx="1" stroke-dasharray="2.5 2.5"/>'),
    ellipsel: s('<ellipse cx="12" cy="12" rx="8.5" ry="6" stroke-dasharray="2.5 2.5"/>'),

    /* ---------- shapes ---------- */
    shape_line: s('<path d="M5 19L19 5"/>'),
    shape_arrow: s('<path d="M5 19L19 5M10 5h9v9"/>'),
    shape_darrow: s('<path d="M5 19L19 5M10 5h9v9M5 10v9h9"/>'),
    shape_rect: s('<rect x="3.5" y="7" width="17" height="10"/>'),
    shape_square: s('<rect x="5" y="5" width="14" height="14"/>'),
    shape_circle: s('<circle cx="12" cy="12" r="8"/>'),
    shape_ellipse: s('<ellipse cx="12" cy="12" rx="9" ry="6"/>'),
    shape_triangle: s('<path d="M12 4.5L20 19H4z"/>'),
    shape_rtriangle: s('<path d="M5 4.5V19h14z"/>'),
    shape_trapezium: s('<path d="M7 6h7l6 12H4z"/>'),
    shape_isotrap: s('<path d="M8 6h8l4 12H4z"/>'),
    shape_parallelogram: s('<path d="M8 6h12l-4 12H4z"/>'),
    shape_rhombus: s('<path d="M12 4l8 8-8 8-8-8z"/>'),
    shape_pentagon: s('<path d="M12 3.5l8 6-3 10H7l-3-10z"/>'),
    shape_hexagon: s('<path d="M7.5 4.5h9L21 12l-4.5 7.5h-9L3 12z"/>'),
    shape_star: s('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/>'),
    shape_cross: s('<path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5z"/>'),

    /* ---------- line styles ---------- */
    ls_solid: s('<path d="M3 12h18"/>', 2),
    ls_dashed: s('<path d="M3 12h4M10 12h4M17 12h4"/>', 2),
    ls_dotted: s('<path d="M4 12h.01M8.5 12h.01M13 12h.01M17.5 12h.01"/>', 3.2),

    /* ---------- physical instruments ---------- */
    i_ruler: s('<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M6 8v3M9.5 8v4.5M13 8v3M16.5 8v4.5"/>'),
    i_compass: s('<circle cx="12" cy="3.6" r="1.5"/><path d="M12 5.1v2.4"/><circle cx="12" cy="8.6" r="1.1"/><path d="M11.2 9.5 6.8 20.6M12.8 9.5l4.4 8.6M9 15.4h6.2"/><path d="M17.2 18.1l.9 2.7 1.6-2.2z"/>'),
    i_sq45: s('<path d="M4 4v16h16z"/><path d="M8 12v4h4z"/>'),
    i_sq30: s('<path d="M4 19V8l16 11z"/><path d="M8 19v-3"/>'),
    i_protractor: s('<path d="M3 18a9 9 0 0 1 18 0z"/><path d="M12 18v-3M6.5 13.5l1.2 1M17.5 13.5l-1.2 1"/>'),

    /* ---------- backdrop patterns ---------- */
    p_none: s('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 20L20 4"/>'),
    p_grid: s('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>'),
    p_dots: s(`<g fill="currentColor" stroke="none">${[6, 12, 18].map(x => [6, 12, 18].map(y => `<circle cx="${x}" cy="${y}" r="1.4"/>`).join('')).join('')}</g>`),
    p_lines: s('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    p_columns: s('<path d="M7 4v16M12 4v16M17 4v16"/>'),
    p_iso: s('<path d="M4 8h16M4 15h16M8 4l8 16M16 4L8 20"/>'),

    /* ---------- geometry tools (GeoGebra-style, drawn in the app's navy line style) ---------- */
    /* Points */
    g_point: s(dot(12, 12, 3.2) + '<circle cx="12" cy="12" r="6.5" stroke-dasharray="1.5 3"/>'),
    g_pointon: s('<path d="M3.5 18C7 7 15 5 20.5 10"/>' + dot(11.5, 8.6, 2.8)),
    g_intersect: s('<path d="M4 6l16 12M4 18L20 6"/>' + dot(12, 12, 3)),
    g_midpoint: s('<path d="M4 18L20 6"/>' + dot(4, 18) + dot(20, 6) + dot(12, 12, 2.8)),
    g_center: s('<circle cx="12" cy="12" r="8.5"/>' + dot(12, 12, 2.8)),
    /* Lines */
    g_line: s('<path d="M3 21L21 3"/>' + dot(8, 16) + dot(16, 8)),
    g_segment: s('<path d="M5 18L19 6"/>' + dot(5, 18) + dot(19, 6)),
    g_seglen: s('<path d="M4 16h16"/>' + dot(4, 16) + dot(20, 16) + '<path d="M4 11v2.5M8 12v1.5M12 11v2.5M16 12v1.5M20 11v2.5" stroke-width="1.3"/>'),
    g_ray: s('<path d="M5 19L21 5"/>' + dot(5, 19) + dot(12, 13)),
    g_polyline: s('<path d="M3.5 17.5l5-9.5 5 7 7-9"/>' + dot(3.5, 17.5) + dot(8.5, 8) + dot(13.5, 15) + dot(20.5, 6)),
    g_vector: s('<path d="M4.5 19.5L19 5"/><path d="M19.5 4.5l-6.3.9M19.5 4.5l-.9 6.3"/>' + dot(4.5, 19.5)),
    /* Special lines */
    g_perp: s('<path d="M3 18h18M12 3v15"/><path d="M12 14h4v4"/>' + dot(12, 8)),
    g_parallel: s('<path d="M3 10L21 4M3 20l18-6"/>' + dot(12, 7) + dot(12, 17)),
    g_perpbis: s('<path d="M4 15h16M12 3v18"/>' + dot(4, 15) + dot(20, 15) + '<path d="M9.5 12.5h5" stroke-width="1.2"/>'),
    g_anglebis: s('<path d="M4 19h16M4 19L18 5"/><path d="M4 19l16-8" stroke-dasharray="2 2.4"/>'),
    g_tangent: s('<circle cx="10" cy="14" r="6"/><path d="M3 8h18"/>' + dot(10, 8, 2.2)),
    /* Polygons */
    g_polygon: s('<path d="M12 3.5l8.5 6.5-3.2 10H6.7L3.5 10z"/>' + dot(12, 3.5) + dot(20.5, 10) + dot(17.3, 20) + dot(6.7, 20) + dot(3.5, 10)),
    g_regpoly: s('<path d="M7.5 4.5h9L21 12l-4.5 7.5h-9L3 12z"/>' + dot(12, 12, 1.6)),
    /* Circles & arcs */
    g_circle: s('<circle cx="12" cy="12" r="8.5"/>' + dot(12, 12) + dot(20.5, 12)),
    g_circler: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 12h8.5"/>' + dot(12, 12) + '<path d="M16 10v4" stroke-width="1.3"/>'),
    g_compass: s('<circle cx="14" cy="13" r="7" stroke-dasharray="2 2.4"/><path d="M3 5h8"/>' + dot(3, 5) + dot(11, 5) + dot(14, 13)),
    g_circle3: s('<circle cx="12" cy="12" r="8.5"/>' + dot(12, 3.5) + dot(19.4, 16.2) + dot(4.6, 16.2)),
    g_semicircle: s('<path d="M3.5 16a8.5 8.5 0 0 1 17 0z"/>' + dot(3.5, 16) + dot(20.5, 16)),
    g_arc: s('<path d="M19 18.5A9.5 9.5 0 0 0 5.5 5.5"/>' + dot(5.5, 18.5) + dot(19, 18.5) + dot(5.5, 5.5)),
    g_arc3: s('<path d="M4 18a9 9 0 0 1 16 0"/>' + dot(4, 18) + dot(12, 9.2) + dot(20, 18)),
    g_sector: s('<path d="M12 19L5 9.5a9 9 0 0 1 14 0z"/>' + dot(12, 19) + dot(5, 9.5) + dot(19, 9.5)),
    g_sector3: s('<path d="M12 19L5 9.5a9 9 0 0 1 14 0z"/>' + dot(5, 9.5) + dot(12, 6.2) + dot(19, 9.5)),
    /* Conics */
    g_ellipse: s('<ellipse cx="12" cy="12" rx="9" ry="5.5"/>' + dot(8, 12, 1.7) + dot(16, 12, 1.7)),
    g_hyperbola: s('<path d="M9.5 3c-3 6-3 12 0 18M14.5 3c3 6 3 12 0 18"/>' + dot(6, 12, 1.5) + dot(18, 12, 1.5)),
    g_parabola: s('<path d="M5 4c1 10 4.5 15 7 15s6-5 7-15"/><path d="M3 21h18" stroke-dasharray="2 2.4"/>' + dot(12, 11.5, 1.8)),
    /* Measurement */
    g_angle: s('<path d="M4 19h16M4 19L17 6"/><path d="M11 19a7 7 0 0 0-2-5"/>'),
    g_anglesize: s('<path d="M4 19h16M4 19L17 7"/><path d="M11 19a7 7 0 0 0-1.5-4.5"/><circle cx="17.5" cy="14" r="1.3" stroke-width="1.2"/>'),
    g_distance: s('<path d="M4 12h16M4 8v8M20 8v8M7 12l2-2M7 12l2 2M17 12l-2-2M17 12l-2 2"/>'),
    g_area: s('<path d="M5 18.5V8.5l7-4.5 7 4.5v10z"/><path d="M8.5 16l7-7M8.5 11.5l3.5-3.5M12 16l3.5-3.5" stroke-width="1.2"/>'),
    g_slope: s('<path d="M3.5 19.5L20.5 4.5"/><path d="M9 15h8V8.5" stroke-dasharray="2 2.4"/>'),
    /* Transformations */
    g_reflect: s('<path d="M12 3v18" stroke-dasharray="2 2.4"/><path d="M3.5 8l6 4-6 4z"/><path d="M20.5 8l-6 4 6 4z"/>'),
    g_reflectpoint: s(dot(6, 17.5) + dot(18, 6.5) + '<circle cx="12" cy="12" r="2.2"/><path d="M6 17.5L10.2 13.6M13.8 10.4L18 6.5" stroke-dasharray="2 2"/>'),
    g_inversion: s('<circle cx="9.5" cy="12" r="6"/>' + dot(9.5, 12, 1.4) + dot(13.8, 12, 1.8) + dot(19.5, 12, 1.8) + '<path d="M9.5 12h11" stroke-width="1.2"/>'),
    g_rotate: s('<path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4"/><path d="M19.8 3.8v4.4h-4.4"/>' + dot(12, 12, 2.2)),
    g_translate: s('<path d="M3.5 17.5l3-5.5 3 5.5z"/><path d="M12.5 12.5h8M17.5 9l3.5 3.5-3.5 3.5"/>'),
    g_dilate: s('<path d="M4 20h7V13z"/><path d="M4 20h16V4z"/>' + dot(4, 20, 2.2)),
    /* General */
    g_image: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/>'),
    g_delete: s('<path d="M4.5 7h15M9.5 4h5M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>'),
    g_hide: s('<path d="M2.5 12C5 7 9 5.5 12 5.5s7 1.5 9.5 6.5c-2.5 5-6.5 6.5-9.5 6.5S5 17 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
    g_label: s('<path d="M6.5 19L12 5l5.5 14M8.6 14h6.8"/>' + dot(19.5, 5.5, 1.6)),
    g_copystyle: s('<path d="M5 4.5h10v5H5zM15 7h3.5v4.5h-8V15M10.5 15v5"/>'),
    g_zoomin: s('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5M7.5 10.5h6M10.5 7.5v6"/>'),
    g_zoomout: s('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5M7.5 10.5h6"/>'),
    /* ---------- graph calculator (hand-drawn) ---------- */
    keyboard: s('<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 14h.01M18 14h.01M9 14h6" stroke-width="2.2"/>'),
    note: s('<path d="M5 4.5h14v15H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>'),
    table: s('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M12 4.5v15"/>'),
    expr: s('<path d="M4 18c3 0 3-12 6-12M7 11h5M14 11l5 7M19 11l-5 7"/>', 1.8),
    close: s('<path d="M6 6l12 12M18 6L6 18"/>', 2),
    play: s('<path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/>', 1.4),
    pause: s('<path d="M8 5.5v13M16 5.5v13"/>', 2.6),
    chevDown: s('<path d="M5 9l7 7 7-7"/>', 2),
    backspace: s('<path d="M9 5.5h10.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L2.8 12z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/>', 1.6),
    enter: s('<path d="M19 5v7a2 2 0 0 1-2 2H5M9 9.5L4.5 14 9 18.5"/>', 1.9)
  };

  // the traced design icons (icons-design.js) win over the hand-drawn ones of the same name
  window.ICONS = Object.assign({}, HAND, window.ICONS_D || {}, window.ICONS_G || {});
})();
