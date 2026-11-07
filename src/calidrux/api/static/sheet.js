'use strict';
/* Calidrux — drawing-set chrome: sheet numbers, the sheet frame and the title block.
   To rename a sheet or change its number, edit SHEETS below (and the matching
   link in index.html). */

const SHEETS = {
  dashboard: { no: 'G-001', title: 'Cover sheet', scale: 'NTS' },
  floor:     { no: 'W-101', title: 'Floor plan', scale: '1:200' },
  receive:   { no: 'W-102', title: 'Receiving & put-away', scale: '1:200' },
  expiry:    { no: 'W-103', title: 'Expiry schedule', scale: 'NTS' },
  layout:    { no: 'W-104', title: 'Layout', scale: '1:200' },
  lab:       { no: 'A-201', title: 'Optimization lab', scale: 'NTS' },
  abc:       { no: 'A-202', title: 'ABC analysis', scale: 'NTS' },
  slotting:  { no: 'A-203', title: 'Slotting', scale: 'NTS' },
  picking:   { no: 'A-204', title: 'Pick routes', scale: '1:200' },
  inventory: { no: 'R-301', title: 'Inventory register', scale: 'NTS' },
  audit:     { no: 'R-302', title: 'Audit log', scale: 'NTS' },
  settings:  { no: 'R-303', title: 'Settings', scale: 'NTS' },
};
const DRAWN_BY = 'JPR';

(function buildZones() {
  const z = document.querySelector('.sheet-zones');
  if (!z) return;
  const letters = 'ABCDEFGH'.split(''), nums = ['1', '2', '3', '4', '5', '6'];
  const row = cls => `<div class="${cls}">${letters.map(l => `<span>${l}</span>`).join('')}</div>`;
  const col = cls => `<div class="${cls}">${nums.map(n => `<span>${n}</span>`).join('')}</div>`;
  z.innerHTML = row('zt') + row('zb') + col('zl') + col('zr');
})();

function renderTitleBlock(view) {
  const tb = document.getElementById('title-block');
  const s = SHEETS[view];
  if (!tb || !s) return;
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const proj = (window.WH && WH.floor && WH.floor.layout && WH.floor.layout.name) || 'Main Warehouse';
  tb.innerHTML = `
    <div><small>Project</small><b>Calidrux</b></div>
    <div><small>Sheet title</small><b>${s.title}</b></div>
    <div class="tb-no"><small>Sheet</small><b>${s.no}</b></div>
    <div><small>Facility</small>${esc(proj)}</div>
    <div class="tb-meta"><span><small>Rev</small>${APP_VERSION}</span><span><small>Date</small>${date}</span>
      <span><small>Drawn</small>${DRAWN_BY}</span><span><small>Scale</small>${s.scale}</span></div>`;
  document.title = `${s.no} ${s.title} — Calidrux`;
}

(function wrapShowView() {
  const prev = showView;
  showView = function (name) { renderTitleBlock(name); return prev(name); };
  renderTitleBlock('dashboard');
})();
