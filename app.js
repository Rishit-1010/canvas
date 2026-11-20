/* =========================================================
   app.js — glue: sidebar, workspace switching, board file actions
   ========================================================= */
(function () {
  'use strict';
  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  // 1. put the SVG icons into every [data-icon] element
  window.UI.hydrateIcons(document);

  // 2. start the whiteboard
  window.Whiteboard.init();

  // start downloading the equation editor now, so the Graph Calculator opens instantly later
  window.Graph.preload();

  // 3. main sidebar open / close
  const openSidebar = () => document.body.classList.add('sb-open');
  const closeSidebar = () => document.body.classList.remove('sb-open');
  $$('[data-open-sidebar]').forEach(b => b.addEventListener('click', openSidebar));
  $('#scrim').addEventListener('click', closeSidebar);
  $('#sbClose').addEventListener('click', closeSidebar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });

  // 4. switch between Whiteboard and Graph Calculator
  $$('[data-workspace]').forEach(btn => btn.addEventListener('click', () => {
    const name = btn.dataset.workspace;
    $$('.workspace').forEach(w => w.classList.toggle('active', w.id === 'ws-' + name));
    $$('[data-workspace]').forEach(b => b.classList.toggle('active', b === btn));
    if (name === 'whiteboard') window.Whiteboard.resize();
    if (name === 'graph') window.Graph.show();                 // the graph starts the first time it is opened
    closeSidebar();
  }));

  // 5. board actions (export / save / open)
  const fileInput = $('#fileInput');
  $$('[data-action]').forEach(btn => btn.addEventListener('click', () => {
    const a = btn.dataset.action;
    if (a === 'export-png') window.Whiteboard.exportPNG();
    if (a === 'save-file') window.Whiteboard.saveFile();
    if (a === 'open-file') fileInput.click();
    closeSidebar();
  }));
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) window.Whiteboard.openFile(fileInput.files[0]);
    fileInput.value = '';
  });
})();
