'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Calidrux — Warehouse Operations
   Floor map, Rack inspector, Receive & put-away, Expiry board, Layout
   ═══════════════════════════════════════════════════════════════════════════ */

const WH = {
  floor: null,          // last /api/warehouse/floor payload
  mode: 'expiry',       // floor colouring: expiry | occupancy | zone
  query: '',            // floor search
  zoom: 1,
  rack: null,           // rack currently open in the inspector
  selected: null,       // inventory_id selected in the inspector
  expiryFilter: { bucket: null, q: '', zone: 'all', hold: false },
  receive: { product: null, suggestion: null, suggestions: [] },
  layoutDraft: null,
};

// Status colors follow drawing mark-up conventions: redline for problems,
// highlighter for warnings, cobalt for healthy stock. Values live in theme.css.
const _tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const BUCKETS = {
  expired:  { label: 'Expired',     short: 'Expired',  color: _tok('--redline') || '#C8102E',   soft: '#FCEBEE' },
  critical: { label: '≤ 30 days',   short: '≤30 d',    color: _tok('--redline-2') || '#D2461F', soft: '#FBEAE4' },
  warning:  { label: '31–90 days',  short: '31–90 d',  color: _tok('--highlight-ink') || '#8A6A00', fill: _tok('--highlight') || '#F2C230', soft: '#FFF6D6' },
  watch:    { label: '91–180 days', short: '91–180 d', color: _tok('--watch') || '#7D93D6',     soft: '#EEF1FA' },
  ok:       { label: '> 180 days',  short: '>180 d',   color: _tok('--ok') || '#1B3A94',        soft: '#F2F5FC' },
};
const BUCKET_ORDER = ['expired', 'critical', 'warning', 'watch', 'ok'];

// ── Small helpers ─────────────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const pad2 = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const money = n => {
  n = Number(n || 0);
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
  return '$' + fmt(n, 0);
};
const pct = u => Math.round((u || 0) * 100) + '%';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const rackName = (a, b) => `Rack A${pad2(a)}-B${pad2(b)}`;

function daysText(d) {
  if (d < -1) return `Expired ${-d} days ago`;
  if (d === -1) return 'Expired yesterday';
  if (d === 0) return 'Expires today';
  if (d === 1) return 'Expires tomorrow';
  return `${fmt(d)} days left`;
}

async function whApi(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    const err = new Error(typeof d === 'string' ? d : (d && d.message) || res.statusText || 'Request failed');
    err.status = res.status; err.detail = d;
    throw err;
  }
  return data;
}

function countUp(el, to, { decimals = 0, prefix = '', suffix = '', format } = {}) {
  if (!el) return;
  el.textContent = format ? format(to) : prefix + fmt(to, decimals) + suffix;  // drawing skin: print, don't animate
  return;
  const start = performance.now(), dur = 900;
  const step = now => {
    const t = Math.min(1, (now - start) / dur);
    const v = to * (1 - Math.pow(1 - t, 3));
    el.textContent = format ? format(v) : prefix + fmt(v, decimals) + suffix;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function ring(u, { size = 76, stroke = 8, color = 'var(--blue-600)', label } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, Math.max(0, u)));
  return `<svg class="wh-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="var(--blue-100)" stroke-width="${stroke}" fill="none"/>
    <circle class="wh-ring-arc" cx="${size/2}" cy="${size/2}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${off}"
      transform="rotate(-90 ${size/2} ${size/2})"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" class="wh-ring-text">${label ?? pct(u)}</text>
  </svg>`;
}
function animateRings(root = document) {
  requestAnimationFrame(() => requestAnimationFrame(() =>
    $$('.wh-ring-arc', root).forEach(a => { a.style.strokeDashoffset = a.dataset.off; })));
}

// Floating tooltip shared by the map and the timeline
function tip(html, ev) {
  let t = $('#wh-tip');
  if (!t) { t = document.createElement('div'); t.id = 'wh-tip'; document.body.appendChild(t); }
  if (!html) { t.classList.remove('show'); return; }
  t.innerHTML = html;
  t.classList.add('show');
  const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
  t.style.transform = `translate(${x}px, ${y}px)`;
}

function whModal({ title, body, confirm = 'Confirm', cancel = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'wh-modal-wrap';
    wrap.innerHTML = `<div class="wh-modal" role="dialog" aria-modal="true">
      <div class="wh-modal-title">${title}</div>
      <div class="wh-modal-body">${body}</div>
      <div class="wh-modal-actions">
        ${cancel ? `<button class="btn btn-ghost" data-r="0">${cancel}</button>` : ''}
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${confirm}</button>
      </div></div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    const close = v => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 200); resolve(v); };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) close(false);
      const b = e.target.closest('[data-r]'); if (b) close(b.dataset.r === '1');
    });
  });
}

function bucketChip(key, extra = '') {
  if (!key) return '<span class="wh-chip">Empty</span>';
  const b = BUCKETS[key];
  return `<span class="wh-chip" style="--c:${b.color};--s:${b.soft}"><i></i>${b.label}${extra}</span>`;
}
const zoneChip = z => z === 'cold'
  ? `<span class="wh-chip cold">${icon('thermometer-snowflake')}Cold room, 2–8 °C</span>`
  : '<span class="wh-chip ambient">Ambient, 15–25 °C</span>';
const holdChip = '<span class="wh-chip hold">On hold</span>';

/* ═══════════════════════════════════════════════════════════════════════════
   Floor renderer — shared by the map, the receive screen and the layout preview
   ═══════════════════════════════════════════════════════════════════════════ */

function levelColor(mode, rack, lvl) {
  if (rack.zone === 'cold' && mode === 'zone') return 'var(--cold)';
  if (mode === 'zone') return 'var(--line)';
  if (mode === 'occupancy') return 'var(--ink)';
  return lvl.bucket ? (BUCKETS[lvl.bucket].fill || BUCKETS[lvl.bucket].color) : 'transparent';
}

function renderFloor(el, data, opts = {}) {
  const mode = opts.mode || 'expiry';
  const q = (opts.query || '').trim().toLowerCase();
  const compact = !!opts.compact;
  const maxBays = data.max_bays || Math.max(0, ...data.racks.map(r => r.bay));
  const byKey = new Map(data.racks.map(r => [`${r.aisle}-${r.bay}`, r]));
  const sel = opts.selected ? `${opts.selected.aisle}-${opts.selected.bay}` : null;
  const marks = new Set((opts.highlight || []).map(h => `${h.aisle}-${h.bay}`));
  let i = 0, hits = 0;

  const tile = (aisle, bay) => {
    const r = byKey.get(`${aisle}-${bay}`);
    if (!r) return '<div class="wh-rack-gap"></div>';
    const key = `${aisle}-${bay}`;
    const hit = q && r.search && r.search.includes(q);
    if (hit) hits++;
    const cls = ['wh-rack', `m-${mode}`, r.zone];
    if (r.state) cls.push(r.state);
    if (!r.quantity) cls.push('empty');
    if (q) cls.push(hit ? 'hit' : 'dim');
    if (key === sel) cls.push('sel');
    if (marks.has(key)) cls.push('mark');
    if (r.quarantine) cls.push('hold');
    if (r.bucket) cls.push('bk-' + r.bucket);
    const top = mode === 'expiry' && r.bucket ? BUCKETS[r.bucket].color : 'transparent';
    const levels = [...r.levels].sort((x, y) => y.level - x.level).map(l =>
      `<i style="--u:${Math.min(1, l.utilization || 0)};--c:${levelColor(mode, r, l)}"></i>`).join('');
    return `<button type="button" class="${cls.join(' ')}" data-a="${aisle}" data-b="${bay}"
      style="--i:${i++};--top:${top};--util:${Math.min(1, r.utilization || 0)}">
      <span class="wh-rack-lv">${levels}</span>
      ${compact ? '' : `<span class="wh-rack-tag">${pad2(bay)}</span>`}
      ${r.quarantine && !compact ? '<span class="wh-rack-flag" title="Lot on hold">!</span>' : ''}
      ${r.state === 'new' ? '<span class="wh-rack-state">new</span>' : ''}
      ${r.state === 'removed' ? '<span class="wh-rack-state">−</span>' : ''}
    </button>`;
  };

  let rowIdx = 0;
  const row = a => {
    let tiles = '';
    const ri = rowIdx++;
    for (let b = 1; b <= maxBays; b++) tiles += tile(a.aisle, b);
    return `<div class="wh-row ${a.zone}">
      <div class="wh-row-label"><b>A${pad2(a.aisle)}</b>${compact ? '' : `<small>${a.zone === 'cold' ? 'Cold' : 'Ambient'}</small>`}</div>
      <div class="wh-row-racks" style="grid-template-columns:repeat(${maxBays}, var(--rack-w));--r:${ri}">${tiles}</div>
    </div>`;
  };

  let body = '';
  const aisles = data.aisles;
  for (let k = 0; k < aisles.length;) {
    if (aisles[k].zone === 'cold') {
      const run = [];
      while (k < aisles.length && aisles[k].zone === 'cold') run.push(aisles[k++]);
      body += `<div class="wh-coldroom"><div class="wh-coldroom-tag">${icon('thermometer-snowflake')}Cold room, 2–8 °C</div>
        ${run.map(row).join('<div class="wh-walk cold"></div>')}</div>`;
    } else {
      body += row(aisles[k++]);
    }
    if (k < aisles.length) body += '<div class="wh-walk"></div>';
  }

  let header = '';
  if (!compact) {
    for (let b = 1; b <= maxBays; b++) header += `<span>B${pad2(b)}</span>`;
    header = `<div class="wh-row wh-bay-head"><div class="wh-row-label"></div>
      <div class="wh-row-racks" style="grid-template-columns:repeat(${maxBays}, var(--rack-w))">${header}</div></div>`;
  }

  const base = compact ? 30 : 58;
  const lay = data.layout;
  const dim = !compact && lay ? `<div class="dwg-dim h" style="left:58px"><i></i><span>${fmt(maxBays * lay.bay_width_m, 1)} m, ${maxBays} bays @ ${lay.bay_width_m} m</span><i></i></div>` : '';
  el.innerHTML = `<div class="wh-building ${compact ? 'compact' : ''}" style="--rack-w:${Math.round(base * (opts.zoom || 1))}px">
      <div class="wh-dock"><span>Dock</span><b class="wh-dock-door"></b></div>
      <div class="wh-floorplan">${dim}${header}${body}</div>
    </div>`;
  el.classList.toggle('plot', !!opts.plot);

  // Interactions (delegated)
  el.onclick = e => {
    const t = e.target.closest('.wh-rack');
    if (t && opts.onRack) opts.onRack(+t.dataset.a, +t.dataset.b, t);
  };
  el.onmousemove = e => {
    const t = e.target.closest('.wh-rack');
    if (!t || opts.noTip) return tip(null);
    const r = byKey.get(`${t.dataset.a}-${t.dataset.b}`);
    tip(rackTip(r), e);
  };
  el.onmouseleave = () => tip(null);
  return { hits };
}

function rackTip(r) {
  if (!r) return '';
  const head = `<b>${rackName(r.aisle, r.bay)}</b> ${r.zone === 'cold' ? `<span class="tip-cold">${icon('snowflake')}cold</span>` : ''}`;
  if (r.state === 'removed') return `${head}<div>Will be removed${r.quantity ? ', but it still holds stock' : ''}</div>`;
  if (r.state === 'new') return `${head}<div>New rack</div>`;
  if (!r.quantity) return `${head}<div class="tip-muted">Empty, ${fmt(r.capacity)} units free</div>`;
  const exp = r.min_days_left != null
    ? `<div><i class="sw" style="background:${BUCKETS[r.bucket].fill || BUCKETS[r.bucket].color}"></i>${daysText(r.min_days_left)} (earliest lot)</div>` : '';
  return `${head}
    <div>${fmt(r.quantity)} / ${fmt(r.capacity)} units, ${pct(r.utilization)} full</div>
    ${exp}
    <div class="tip-muted">${r.skus.slice(0, 4).map(esc).join(', ')}${r.skus.length > 4 ? ` +${r.skus.length - 4}` : ''}</div>
    ${r.quarantine ? `<div style="color:var(--hold)">${icon('circle-pause')}A lot here is on hold</div>` : ''}`;
}

function floorLegend(mode) {
  if (mode === 'occupancy') return `<span class="lg"><i style="background:linear-gradient(90deg,var(--blue-100),var(--blue-600))"></i>Bar length = how full each level is</span>
    <span class="lg"><i style="background:var(--blue-900)"></i>Over 90% full</span>`;
  if (mode === 'zone') return `<span class="lg"><i style="background:#38bdf8"></i>Cold room (2–8 °C)</span><span class="lg"><i style="background:#93a4c3"></i>Ambient</span>`;
  return BUCKET_ORDER.map(k => `<span class="lg"><i style="background:${BUCKETS[k].color}"></i>${BUCKETS[k].label}</span>`).join('') +
    `<span class="lg"><i class="lg-hold"></i>Lot on hold</span><span class="lg"><i style="background:var(--redline);clip-path:polygon(50% 0,100% 100%,0 100%);border:0"></i>Expired stock in rack</span>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   View: Warehouse floor
   ═══════════════════════════════════════════════════════════════════════════ */

async function viewFloor() {
  const floor = await whApi('GET', '/api/warehouse/floor');
  WH.floor = floor;
  const k = floor.kpis;
  const vc = document.getElementById('view-content');
  const lowStock = k.utilization < 0.05;
  vc.innerHTML = `
    <div class="wh-view">
    <div class="page-header">
      <div><h1 class="page-title">Floor plan</h1>
        <div class="page-sub">${esc(floor.layout.name)}: ${floor.aisles.length} aisles, ${k.slots} storage slots. Click a rack to open its elevation.</div></div>
      <div class="btn-group">
        <button class="btn btn-ghost" onclick="showView('expiry')">${icon('calendar-clock')}Expiry schedule</button>
        <button class="btn btn-primary" onclick="showView('receive')">${icon('package-plus')}Receive stock</button>
      </div>
    </div>

    <div class="wh-kpis">
      <div class="wh-kpi">${ring(k.occupied_slots / Math.max(1, k.slots), { size: 58, stroke: 7 })}
        <div><div class="kpi-label">Slots in use</div><div class="wh-kpi-v"><span data-count="${k.occupied_slots}"></span><small> / ${k.slots}</small></div></div></div>
      <div class="wh-kpi"><div><div class="kpi-label">Units stored</div><div class="wh-kpi-v" data-count="${k.units}"></div>
        <div class="wh-kpi-sub">${pct(k.utilization)} of capacity</div></div></div>
      <div class="wh-kpi"><div><div class="kpi-label">Stock value</div><div class="wh-kpi-v" data-money="${k.value}"></div>
        <div class="wh-kpi-sub">${k.skus} SKUs, ${k.batches} lots</div></div></div>
      <div class="wh-kpi cold">${ring(k.cold_utilization, { size: 58, stroke: 7, color: 'var(--cold)' })}
        <div><div class="kpi-label">Cold room fill</div><div class="wh-kpi-sub">2–8 °C storage</div></div></div>
      <div class="wh-kpi warn" onclick="WH.expiryFilter.bucket='critical';showView('expiry')">
        <div><div class="kpi-label">Expiring ≤ 30 days</div><div class="wh-kpi-v" data-count="${k.critical_lines}"></div>
        <div class="wh-kpi-sub">stock lines</div></div></div>
      <div class="wh-kpi danger" onclick="WH.expiryFilter.bucket='expired';showView('expiry')">
        <div><div class="kpi-label">Expired / on hold</div><div class="wh-kpi-v"><span data-count="${k.expired_lines}"></span><small> / ${k.quarantine_lines}</small></div>
        <div class="wh-kpi-sub">need action</div></div></div>
    </div>

    ${lowStock ? `<div class="wh-empty-banner">
        <div><b>Your warehouse is empty.</b> Receive your first delivery, or load sample stock to explore the map.</div>
        <div class="btn-group"><button class="btn btn-ghost" onclick="loadDemoStock()">Load sample stock</button>
        <button class="btn btn-primary" onclick="showView('receive')">Receive stock</button></div></div>` : ''}

    <div class="card wh-map-card">
      <div class="wh-toolbar">
        <div class="wh-seg" id="wh-mode">
          ${['expiry', 'occupancy', 'zone'].map(m => `<button data-m="${m}" class="${WH.mode === m ? 'on' : ''}">${{ expiry: 'Expiry', occupancy: 'Occupancy', zone: 'Zones' }[m]}</button>`).join('')}
        </div>
        <div class="wh-search">
          ${icon('search')}
          <input id="wh-q" placeholder="Find a SKU, product or lot…" value="${esc(WH.query)}" autocomplete="off">
          <span id="wh-hits"></span>
        </div>
        <div class="wh-zoom">
          <button onclick="zoomFloor(-1)" title="Zoom out">${icon('zoom-out')}</button>
          <button onclick="zoomFloor(0)" title="Fit">Fit</button>
          <button onclick="zoomFloor(1)" title="Zoom in">${icon('zoom-in')}</button>
        </div>
      </div>
      <div class="wh-map-scroll"><div id="wh-floor"></div></div>
      <div class="dwg-legend-bar">
        <div class="wh-legend" id="wh-legend">${floorLegend(WH.mode)}</div>
        <div style="display:flex;gap:18px;align-items:flex-end">
          <div class="dwg-scale"><div class="bar"><i></i><i></i><i></i><i></i></div><div class="lbl"><span>0</span><span>5</span><span>10 m</span></div></div>
          <svg class="dwg-north" viewBox="0 0 34 44" aria-label="North"><circle cx="17" cy="27" r="13" fill="none" stroke="var(--ink)"/>
            <path d="M17 12 L23 32 L17 27 L11 32 Z" fill="var(--ink)"/><text x="17" y="9" text-anchor="middle" font-size="9" font-family="B612 Mono" fill="var(--ink)">N</text></svg>
        </div>
      </div>
    </div>
    </div>`;

  $$('[data-count]', vc).forEach(el => countUp(el, +el.dataset.count));
  $$('[data-money]', vc).forEach(el => countUp(el, +el.dataset.money, { format: money }));
  animateRings(vc);

  $('#wh-mode').onclick = e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    WH.mode = b.dataset.m;
    $$('#wh-mode button').forEach(x => x.classList.toggle('on', x === b));
    $('#wh-legend').innerHTML = floorLegend(WH.mode);
    drawFloor(false);
  };
  let tmr;
  $('#wh-q').oninput = e => { clearTimeout(tmr); tmr = setTimeout(() => { WH.query = e.target.value; drawFloor(false); }, 120); };
  if (WH.zoom === 1 && !WH._zoomSet) fitZoom();
  drawFloor(true);
}

function drawFloor(animate) {
  const el = $('#wh-floor');
  if (!el || !WH.floor) return;
  const { hits } = renderFloor(el, WH.floor, {
    mode: WH.mode, query: WH.query, zoom: WH.zoom, plot: animate,
    selected: WH.rack ? { aisle: WH.rack.aisle, bay: WH.rack.bay } : null,
    onRack: (a, b) => openRack(a, b),
  });
  el.classList.toggle('no-anim', !animate);
  const h = $('#wh-hits');
  if (h) h.textContent = WH.query ? (hits ? `${hits} rack${hits > 1 ? 's' : ''}` : 'No match') : '';
}

function fitZoom() {
  const scroll = $('.wh-map-scroll');
  if (!scroll || !WH.floor) return;
  const avail = scroll.clientWidth - 150;
  const need = WH.floor.max_bays * 64;
  WH.zoom = Math.max(0.55, Math.min(1.5, avail / need));
}
function zoomFloor(dir) {
  WH._zoomSet = true;
  if (dir === 0) fitZoom();
  else WH.zoom = Math.max(0.5, Math.min(2, WH.zoom + dir * 0.15));
  drawFloor(false);
}

async function loadDemoStock() {
  const ok = await whModal({
    title: 'Load sample stock?',
    body: 'Adds realistic sample lots for every product and puts them away using the normal put-away rules. Everything is recorded in the audit log.',
    confirm: 'Load sample stock',
  });
  if (!ok) return;
  const r = await whApi('POST', '/api/warehouse/demo-stock');
  toast(`Loaded ${r.lots} lots into ${r.lines} slots`);
  showView('floor');
}

/* ═══════════════════════════════════════════════════════════════════════════
   Rack inspector — slide-in panel with an animated rack elevation
   ═══════════════════════════════════════════════════════════════════════════ */

function ensureDrawer() {
  if ($('#wh-drawer')) return;
  const bd = document.createElement('div');
  bd.id = 'wh-backdrop';
  bd.onclick = closeRack;
  const dr = document.createElement('aside');
  dr.id = 'wh-drawer';
  dr.setAttribute('aria-label', 'Rack inspector');
  document.body.append(bd, dr);
  document.addEventListener('keydown', e => {
    if (!document.body.classList.contains('wh-drawer-open')) return;
    if ($('.wh-modal-wrap')) return;
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'Escape') closeRack();
    if (e.key === 'ArrowLeft' && WH.rack?.prev) openRack(WH.rack.prev.aisle, WH.rack.prev.bay);
    if (e.key === 'ArrowRight' && WH.rack?.next) openRack(WH.rack.next.aisle, WH.rack.next.bay);
  });
}

function closeRack() {
  document.body.classList.remove('wh-drawer-open');
  WH.rack = null; WH.selected = null;
  $$('.wh-rack.sel').forEach(t => t.classList.remove('sel'));
}

async function openRack(aisle, bay, { highlight, batch, location } = {}) {
  ensureDrawer();
  tip(null);
  const dr = $('#wh-drawer');
  const wasOpen = document.body.classList.contains('wh-drawer-open');
  if (!wasOpen) dr.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
  document.body.classList.add('wh-drawer-open');
  let rack;
  try { rack = await whApi('GET', `/api/warehouse/racks/${aisle}/${bay}`); }
  catch (e) { toast(e.message, 'error'); closeRack(); return; }
  WH.rack = rack;
  if (batch) {
    const it = rack.levels.flatMap(l => l.items)
      .find(i => i.batch_id === batch && (!location || i.location_id === location));
    highlight = it ? it.inventory_id : undefined;
  }
  WH.selected = highlight ?? null;
  $$('.wh-rack').forEach(t => t.classList.toggle('sel', +t.dataset.a === aisle && +t.dataset.b === bay && !t.closest('.wh-building.compact')));
  renderRack(highlight);
}

function renderRack(highlight) {
  const r = WH.rack, dr = $('#wh-drawer');
  const items = r.levels.flatMap(l => l.items);
  const skus = new Set(items.map(i => i.sku)).size;
  const lots = new Set(items.map(i => i.batch_id)).size;
  dr.innerHTML = `
    <div class="wh-dr-head">
      <div>
        <div class="wh-dr-kicker">Rack inspector</div>
        <div class="wh-dr-title">${rackName(r.aisle, r.bay)}</div>
        <div class="wh-dr-chips">${zoneChip(r.zone)} ${r.bucket ? bucketChip(r.bucket, ' earliest') : ''}</div>
      </div>
      <div class="wh-dr-nav">
        <button ${r.prev ? '' : 'disabled'} onclick="openRack(${r.prev?.aisle},${r.prev?.bay})" title="Previous rack (←)">${icon('chevron-left')}</button>
        <button ${r.next ? '' : 'disabled'} onclick="openRack(${r.next?.aisle},${r.next?.bay})" title="Next rack (→)">${icon('chevron-right')}</button>
        <button onclick="closeRack()" title="Close (Esc)">${icon('x')}</button>
      </div>
    </div>
    <div class="wh-dr-body">
      <div class="wh-dr-stats">
        ${ring(r.utilization, { size: 84, stroke: 9, color: r.zone === 'cold' ? 'var(--cold)' : 'var(--ink)' })}
        <div class="wh-dr-statgrid">
          <div><span>Units</span><b>${fmt(r.quantity)}<small> / ${fmt(r.capacity)}</small></b></div>
          <div><span>Value</span><b>${money(r.value)}</b></div>
          <div><span>Products</span><b>${skus}</b></div>
          <div><span>Lots</span><b>${lots}</b></div>
        </div>
      </div>
      <div class="wh-elev-wrap ${r.zone}">${rackSvg(r)}</div>
      <div class="dwg-title"><span class="bub"><span>1</span></span>
        <div><b>Elevation, aisle ${pad2(r.aisle)}, bay ${pad2(r.bay)}${r.zone === 'cold' ? ' (cold room)' : ''}</b><small>Scale 1:25, ${r.levels.length} levels, ${fmt(r.capacity)} units capacity</small></div></div>
      <div class="wh-elev-hint">${items.length ? 'Each carton is about 1/16 of a shelf. Click a carton to see its lot.' : 'This rack is empty.'}</div>
      <div id="wh-item"></div>
      ${items.length ? `<div class="wh-dr-section">Contents by level</div>
      <div class="wh-contents">${[...r.levels].reverse().map(l => `
        <div class="wh-lvl">
          <div class="wh-lvl-head"><b>L${l.level}</b><span>${esc(l.code)}</span>
            <span class="wh-lvl-bar"><i style="width:${Math.min(100, l.utilization * 100)}%"></i></span>
            <span class="wh-lvl-pct">${pct(l.utilization)}</span></div>
          ${l.items.length ? l.items.map(i => `
            <button class="wh-line" data-inv="${i.inventory_id}">
              <i class="dot" style="background:${BUCKETS[i.bucket].color}"></i>
              <span class="wh-line-main"><b>${esc(i.name)}</b><small>${esc(i.sku)}, Lot ${esc(i.lot_number)}</small></span>
              <span class="wh-line-qty">${fmt(i.quantity)}</span>
              <span class="wh-line-exp" style="color:${BUCKETS[i.bucket].color}">${daysText(i.days_left)}</span>
              ${i.status === 'quarantine' ? holdChip : ''}
            </button>`).join('') : `<div class="wh-line empty">Empty, ${fmt(l.capacity)} units free</div>`}
        </div>`).join('')}</div>` : ''}
    </div>`;
  animateRings(dr);
  dr.onclick = e => {
    const g = e.target.closest('[data-inv]');
    if (g) selectItem(+g.dataset.inv, true);
  };
  dr.onmousemove = e => {
    const g = e.target.closest('g[data-inv]');
    if (!g) return tip(null);
    const it = items.find(i => i.inventory_id === +g.dataset.inv);
    tip(`<b>${esc(it.name)}</b><div>${esc(it.sku)}, Lot ${esc(it.lot_number)}</div>
      <div>${fmt(it.quantity)} units</div><div><i class="sw" style="background:${BUCKETS[it.bucket].fill || BUCKETS[it.bucket].color}"></i>${daysText(it.days_left)}</div>`, e);
  };
  dr.onmouseleave = () => tip(null);
  if (highlight) selectItem(highlight, false, true);
  else if (WH.selected) selectItem(WH.selected, false);
}

const CART_COLS = 8, CART_ROWS = 2, PER_LEVEL = CART_COLS * CART_ROWS;

function rackSvg(r) {
  const L = r.levels.length, LH = 74, W = 530, top = 26;
  const x0 = 64, x1 = 444, inner = x1 - x0;
  const cw = inner / CART_COLS, ch = 27;
  const H = top + L * LH + 30;
  const floorY = top + L * LH;
  let d = 0;
  let g = '';
  for (const lvl of r.levels) {
    const beamY = top + (L - lvl.level + 1) * LH;           // shelf this level sits on
    const slots = [];
    for (const it of lvl.items) {
      const n = Math.max(1, Math.round(it.quantity / lvl.capacity * PER_LEVEL));
      for (let k = 0; k < n; k++) slots.push({ it, first: k === 0 });
    }
    const shown = slots.slice(0, PER_LEVEL);
    let cur = null, grp = '';
    const flush = () => { if (cur) g += `<g class="wh-item${cur.it.status === 'quarantine' ? ' hold' : ''}" data-inv="${cur.it.inventory_id}">${grp}</g>`; };
    shown.forEach((s, idx) => {
      if (!cur || cur.it !== s.it) { flush(); cur = s; grp = ''; }
      const col = idx % CART_COLS, rowi = Math.floor(idx / CART_COLS);
      const x = x0 + col * cw + 2, y = beamY - (rowi + 1) * ch - 1;
      const c = BUCKETS[s.it.bucket].fill || BUCKETS[s.it.bucket].color;
      grp += `<g class="wh-carton" style="--d:${(L - lvl.level) * 70 + idx * 28 + 80}ms">
        <rect x="${x}" y="${y}" width="${cw - 4}" height="${ch - 2}" rx="3" fill="${c}"/>
        <rect x="${x}" y="${y}" width="${cw - 4}" height="5" rx="2" fill="#fff" opacity=".25"/>
        <line x1="${x + (cw - 4) / 2}" y1="${y}" x2="${x + (cw - 4) / 2}" y2="${y + 5}" stroke="#fff" stroke-opacity=".5"/>
        ${s.it.status === 'quarantine' ? `<rect x="${x}" y="${y}" width="${cw - 4}" height="${ch - 2}" rx="3" fill="url(#whHatch)"/>` : ''}
        ${s.first ? `<text x="${x + (cw - 4) / 2}" y="${y + ch / 2 + 3}" text-anchor="middle" class="wh-carton-t"${s.it.bucket === 'warning' || s.it.bucket === 'watch' ? ' style="fill:var(--ink)"' : ''}>${esc(s.it.sku.replace('PH-', ''))}</text>` : ''}
      </g>`;
    });
    flush();
    if (!lvl.items.length) {
      g += `<rect x="${x0 + 4}" y="${beamY - LH + 18}" width="${inner - 8}" height="${LH - 24}" rx="6" class="wh-empty-slot"/>
            <text x="${(x0 + x1) / 2}" y="${beamY - LH / 2 + 6}" text-anchor="middle" class="wh-empty-t">Empty, ${fmt(lvl.capacity)} free</text>`;
    } else if (slots.length > PER_LEVEL) {
      g += `<text x="${x1 - 4}" y="${beamY - 2 * ch - 6}" text-anchor="end" class="wh-over-t">over capacity</text>`;
    }
    // beam + level label + fill meter
    g += `<rect x="${x0 - 8}" y="${beamY}" width="${inner + 16}" height="7" rx="2" class="wh-beam"/>
      <text x="22" y="${beamY - LH / 2 + 4}" class="wh-lvl-t" text-anchor="middle">L${lvl.level}</text>
      <rect x="474" y="${beamY - LH + 14}" width="9" height="${LH - 18}" rx="4.5" class="wh-meter-bg"/>
      <rect x="474" y="${beamY - 4 - (LH - 18) * Math.min(1, lvl.utilization)}" width="9" height="${(LH - 18) * Math.min(1, lvl.utilization)}" rx="4.5"
        class="wh-meter" style="--d:${(L - lvl.level) * 70 + 300}ms"/>
      <text x="489" y="${beamY - LH / 2 + 8}" text-anchor="start" class="wh-meter-t">${pct(lvl.utilization)}</text>`;
    d++;
  }
  const frost = r.zone === 'cold'
    ? `<rect x="${x0 - 14}" y="${top - 14}" width="${inner + 28}" height="${L * LH + 20}" rx="10" fill="url(#whFrost)" pointer-events="none"/>
       <text x="${x1 + 4}" y="${top - 2}" class="wh-snow" text-anchor="end">❄ 2–8 °C</text>` : '';
  return `<svg class="wh-elev" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <pattern id="whHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="3" height="6" fill="#4c1d95" opacity=".55"/></pattern>
      <linearGradient id="whFrost" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e0f2fe" stop-opacity=".9"/><stop offset="1" stop-color="#bae6fd" stop-opacity=".35"/></linearGradient>
      <pattern id="whFloor" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="2" height="8" fill="#93c5fd"/></pattern>
    </defs>
    ${frost}
    <rect x="${x0 - 14}" y="${top - 12}" width="8" height="${L * LH + 18}" rx="2" class="wh-post"/>
    <rect x="${x1 + 6}" y="${top - 12}" width="8" height="${L * LH + 18}" rx="2" class="wh-post"/>
    <line x1="${x0 - 10}" y1="${top - 8}" x2="${x0 - 10}" y2="${floorY}" class="wh-post-holes"/>
    <line x1="${x1 + 10}" y1="${top - 8}" x2="${x1 + 10}" y2="${floorY}" class="wh-post-holes"/>
    ${g}
    <rect x="20" y="${floorY + 7}" width="${W - 40}" height="10" fill="url(#whFloor)" opacity=".7"/>
    <line x1="20" y1="${floorY + 7}" x2="${W - 20}" y2="${floorY + 7}" stroke="var(--blue-300)" stroke-width="2"/>
  </svg>`;
}

function selectItem(invId, scroll, pulse) {
  const r = WH.rack; if (!r) return;
  const it = r.levels.flatMap(l => l.items).find(i => i.inventory_id === invId);
  if (!it) return;
  WH.selected = invId;
  $$('#wh-drawer [data-inv]').forEach(n => n.classList.toggle('sel', +n.dataset.inv === invId));
  if (pulse) $$(`#wh-drawer g[data-inv="${invId}"]`).forEach(n => { n.classList.remove('pulse'); void n.getBoundingClientRect(); n.classList.add('pulse'); });
  const b = BUCKETS[it.bucket];
  const life = Math.max(0, Math.min(1, it.days_left / 365));
  const hold = it.status === 'quarantine';
  $('#wh-item').innerHTML = `
    <div class="wh-itemcard" style="--c:${b.color};--s:${b.soft}">
      <div class="wh-ic-top">
        <div class="wh-ic-count">
          <svg viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="27" fill="none" stroke="var(--s)" stroke-width="7"/>
            <circle cx="32" cy="32" r="27" fill="none" stroke="var(--c)" stroke-width="7" stroke-linecap="round"
              stroke-dasharray="${2 * Math.PI * 27}" stroke-dashoffset="${2 * Math.PI * 27 * (1 - (it.days_left < 0 ? 1 : life))}"
              transform="rotate(-90 32 32)" class="wh-ic-arc"/></svg>
          <div><b>${it.days_left < 0 ? -it.days_left : it.days_left}</b><small>${it.days_left < 0 ? 'days ago' : 'days'}</small></div>
        </div>
        <div class="wh-ic-main">
          <div class="wh-ic-name">${esc(it.name)}</div>
          <div class="wh-ic-sub">${esc(it.sku)}, Lot <b>${esc(it.lot_number)}</b></div>
          <div class="wh-dr-chips">${bucketChip(it.bucket)} ${it.storage_class === 'cold' ? `<span class="wh-chip cold">${icon('snowflake')}Cold chain</span>` : ''} ${hold ? holdChip : ''}</div>
        </div>
      </div>
      <div class="wh-ic-grid">
        <div><span>Expiry date</span><b>${fmtDate(it.expiry_date)}</b></div>
        <div><span>Quantity</span><b>${fmt(it.quantity)} units</b></div>
        <div><span>Value</span><b>${money(it.value)}</b></div>
        <div><span>Location</span><b>${esc(it.location_code)}</b></div>
        <div><span>Received</span><b>${it.received_at ? esc(it.received_at) : '—'}</b></div>
        <div><span>Status</span><b>${hold ? 'Quality hold' : it.days_left < 0 ? 'Expired' : 'Released'}</b></div>
      </div>
      <div class="wh-ic-life"><span>Shelf life left (of 12 months)</span><div><i style="width:${(it.days_left < 0 ? 0 : life) * 100}%"></i></div></div>
      <div class="wh-ic-actions">
        <button class="btn btn-ghost btn-sm" onclick="startMove(${it.inventory_id})">${icon('arrow-left-right')}Move</button>
        <button class="btn btn-ghost btn-sm" onclick="setHold(${it.batch_id}, ${!hold})">${hold ? icon('circle-check') + 'Release hold' : icon('circle-pause') + 'Put lot on hold'}</button>
        <button class="btn btn-ghost btn-sm" onclick="findOnMap('${esc(it.lot_number)}')">${icon('search')}Find this lot on the floor plan</button>
      </div>
      <div id="wh-move"></div>
    </div>`;
  if (scroll) $('#wh-item').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function refreshAfterChange() {
  if (WH.rack) {
    const sel = WH.selected;
    try {
      WH.rack = await whApi('GET', `/api/warehouse/racks/${WH.rack.aisle}/${WH.rack.bay}`);
      const still = WH.rack.levels.some(l => l.items.some(i => i.inventory_id === sel));
      WH.selected = still ? sel : null;
      renderRack();
    } catch { closeRack(); }
  }
  const active = $('.nav-item.active')?.dataset.view;
  if (active === 'floor') {
    WH.floor = await whApi('GET', '/api/warehouse/floor');
    drawFloor(false);
  } else if (active === 'expiry') {
    renderExpiry(await whApi('GET', '/api/warehouse/expiry'), false);
  }
}

async function setHold(batchId, hold) {
  try {
    await whApi('POST', `/api/warehouse/batches/${batchId}/status`, { status: hold ? 'quarantine' : 'active' });
    toast(hold ? 'Lot placed on quality hold' : 'Lot released from hold');
    await refreshAfterChange();
  } catch (e) { toast(e.message, 'error'); }
}

function findOnMap(lot) {
  closeRack();
  WH.query = lot;
  showView('floor');
}

async function startMove(invId) {
  const it = WH.rack.levels.flatMap(l => l.items).find(i => i.inventory_id === invId);
  const box = $('#wh-move');
  box.innerHTML = '<div class="wh-move-load">Finding slots that fit…</div>';
  let sug;
  try {
    sug = await whApi('POST', '/api/warehouse/putaway/suggest',
      { product_id: it.product_id, quantity: 1, lot_number: it.lot_number });
  } catch (e) { box.innerHTML = ''; return toast(e.message, 'error'); }
  const options = sug.suggestions.filter(s => s.location_id !== it.location_id);
  if (!options.length) { box.innerHTML = '<div class="wh-move-load">No other slot can take this product right now.</div>'; return; }
  box.innerHTML = `
    <form class="wh-move" onsubmit="doMove(event, ${invId})">
      <label>Move to<select name="to">${options.map(s =>
        `<option value="${s.location_id}" data-free="${s.free}">${esc(s.code)}: ${fmt(s.free)} free, ${esc(s.reasons[0])}</option>`).join('')}</select></label>
      <label>Units<input name="qty" type="number" min="1" max="${it.quantity}" value="${Math.min(it.quantity, options[0].free)}" step="1"></label>
      <button class="btn btn-primary btn-sm" type="submit">Move</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="document.getElementById('wh-move').innerHTML=''">Cancel</button>
    </form>`;
}

async function doMove(e, invId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const r = await whApi('POST', '/api/warehouse/move',
      { inventory_id: invId, to_location_id: +fd.get('to'), quantity: +fd.get('qty') });
    toast(`Moved to ${r.code}`);
    await refreshAfterChange();
  } catch (err) { toast(err.message, 'error'); }
}

/* Close the inspector whenever the user switches screens. */
const _baseShowView = showView;
showView = function (name) { tip(null); if (document.body.classList.contains('wh-drawer-open')) closeRack(); return _baseShowView(name); };
