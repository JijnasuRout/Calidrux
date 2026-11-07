'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Calidrux — Optimization Lab
   Move a slider, see the impact. Every number is recomputed from the live
   warehouse; nothing in the warehouse is changed.
   ═══════════════════════════════════════════════════════════════════════════ */

const LAB = {
  tab: 'expiry',
  data: null,                 // products + stock lines
  charts: {},
  expiry: { mult: 1, upp: 6, horizon: 180 },
  routes: { orders: 120, lines: 8, seed: 7, result: null, busy: false },
  roi: { perDay: 600, speed: 1.0, rate: 24, days: 260 },
  slot: { abc_distance: 1.0, pick_frequency: 0.5, weight_level: 0.3, relocation: 0.2, result: null, sweep: null },
  abc: { a: 80, b: 95 },
  impact: {},
};

const LAB_TABS = [
  ['expiry', 'Expiry write-off forecast'],
  ['routes', 'Route savings simulator'],
  ['slotting', 'Slotting trade-offs'],
  ['abc', 'ABC sensitivity'],
];

/* ── Slider component ──────────────────────────────────────────────────── */
function labSlider(id, label, { min, max, step, value, fmt: f = v => v, hint = '' }) {
  const p = ((value - min) / (max - min)) * 100;
  return `<div class="ls">
    <div class="ls-head"><label for="ls-${id}">${label}</label><output id="lo-${id}">${f(value)}</output></div>
    <input type="range" id="ls-${id}" min="${min}" max="${max}" step="${step}" value="${value}" style="--p:${p}%">
    <div class="ls-foot"><span>${f(min)}</span>${hint ? `<span class="ls-hint">${hint}</span>` : ''}<span>${f(max)}</span></div>
  </div>`;
}

function bindSlider(id, f, onInput, onChange) {
  const el = document.getElementById('ls-' + id), out = document.getElementById('lo-' + id);
  if (!el) return;
  const upd = () => {
    const v = +el.value;
    el.style.setProperty('--p', ((v - el.min) / (el.max - el.min)) * 100 + '%');
    out.textContent = f(v);
    out.classList.remove('bump'); void out.offsetWidth; out.classList.add('bump');
    return v;
  };
  el.addEventListener('input', () => onInput && onInput(upd()));
  el.addEventListener('change', () => onChange && onChange(+el.value));
}

function labChart(key, canvasId, cfg) {
  const cv = document.getElementById(canvasId);
  if (!cv) return null;
  const ex = LAB.charts[key];
  if (ex && ex.canvas === cv) {
    ex.data.labels = cfg.data.labels;
    cfg.data.datasets.forEach((ds, i) => {
      if (ex.data.datasets[i]) Object.assign(ex.data.datasets[i], ds);
      else ex.data.datasets.push(ds);
    });
    ex.data.datasets.length = cfg.data.datasets.length;
    if (cfg.options?.scales) Object.entries(cfg.options.scales).forEach(([k, v]) => { if (ex.options.scales[k]) Object.assign(ex.options.scales[k], v); });
    ex.update();
    return ex;
  }
  if (ex) ex.destroy();
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options || {});
  cfg.options.animation = Object.assign({ duration: 550, easing: 'easeOutQuart', delay: 0 }, cfg.options.animation || {});
  LAB.charts[key] = new Chart(cv, cfg);
  return LAB.charts[key];
}

function setNum(id, value, format) {
  const el = document.getElementById(id);
  if (!el) return;
  const from = +(el.dataset.v || 0), to = value, t0 = performance.now(), dur = 600;
  el.dataset.v = to;
  cancelAnimationFrame(el._raf);
  const tick = now => {
    const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
    el.textContent = format(from + (to - from) * e);
    if (t < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}

const usd = v => '$' + (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : fmt(v));

/* ── Impact strip ──────────────────────────────────────────────────────── */
function renderImpact() {
  const i = LAB.impact;
  const card = (id, label, sub) => `<div class="lab-imp" id="imp-${id}"><div class="li-label">${label}</div>
    <div class="li-val" id="iv-${id}">—</div><div class="li-sub" id="is-${id}">${sub}</div></div>`;
  if (!document.getElementById('imp-labor')) {
    document.getElementById('lab-impact').innerHTML =
      card('labor', 'Labor saved by route optimization', 'per year, from the simulator') +
      card('routes', 'Shorter pick routes', 'mean, OR-Tools vs aisle-by-aisle') +
      card('slot', 'Less picker travel after re-slotting', 'with the current weights') +
      card('waste', 'Projected expiry write-off', 'next 180 days at current demand');
  }
  if (i.labor != null) { setNum('iv-labor', i.labor, usd); document.getElementById('is-labor').textContent = `${fmt(i.hours)} hours / year · ${i.fte.toFixed(1)} FTE`; }
  if (i.routes != null) setNum('iv-routes', i.routes, v => v.toFixed(1) + '%');
  if (i.slot != null) { setNum('iv-slot', i.slot, v => v.toFixed(1) + '%'); document.getElementById('is-slot').textContent = `${i.slotMoves} moves needed · current weights`; }
  if (i.waste != null) { setNum('iv-waste', i.waste, usd); document.getElementById('is-waste').textContent = `next ${LAB.expiry.horizon} days · demand ×${LAB.expiry.mult.toFixed(2)}`; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   View
   ═══════════════════════════════════════════════════════════════════════════ */
async function viewLab() {
  const [products, exp] = await Promise.all([whApi('GET', '/api/products'), whApi('GET', '/api/warehouse/expiry')]);
  LAB.data = { products, items: exp.items, pmap: Object.fromEntries(products.map(p => [p.id, p])) };
  Object.values(LAB.charts).forEach(c => c.destroy()); LAB.charts = {};
  const vc = document.getElementById('view-content');
  vc.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Optimization lab</h1>
        <div class="page-sub">Move the sliders and every number recomputes from your live warehouse: expiry risk, route savings, slotting trade-offs and ABC sensitivity. What-if only — nothing in the warehouse changes.</div></div>
      <span class="lab-badge"><i></i>What-if mode</span>
    </div>
    <div class="lab-impact" id="lab-impact"></div>
    <div class="tabs" id="lab-tabs">${LAB_TABS.map(([k, l]) => `<div class="tab ${LAB.tab === k ? 'active' : ''}" data-t="${k}">${l}</div>`).join('')}</div>
    <div id="lab-panel"></div>`;
  renderImpact();
  document.getElementById('lab-tabs').onclick = e => {
    const t = e.target.closest('[data-t]'); if (!t) return;
    LAB.tab = t.dataset.t;
    $$('#lab-tabs .tab').forEach(x => x.classList.toggle('active', x === t));
    renderLabPanel();
  };
  // Fill the impact strip right away, whichever tab is open.
  computeExpiry();
  runRouteSim(true);
  runSlotWhatIf(true);
  renderLabPanel();
}

function renderLabPanel() {
  Object.values(LAB.charts).forEach(c => c.destroy()); LAB.charts = {};
  ({ expiry: panelExpiry, routes: panelRoutes, slotting: panelSlotting, abc: panelAbc })[LAB.tab]();
}

/* ── 1. Expiry write-off forecast ─────────────────────────────────────── */
function forecastWriteOff({ mult, upp, horizon }) {
  const lots = new Map();
  for (const i of LAB.data.items) {
    const l = lots.get(i.batch_id);
    if (!l) lots.set(i.batch_id, { ...i, qty: i.quantity, main: i });
    else { l.qty += i.quantity; l.value += i.value; if (i.quantity > l.main.quantity) l.main = i; }
  }
  const byProduct = new Map();
  for (const l of lots.values()) byProduct.set(l.product_id, [...(byProduct.get(l.product_id) || []), l]);
  const out = [], onHold = [];
  for (const [pid, ls] of byProduct) {
    const p = LAB.data.pmap[pid];
    const rate = (p.pick_frequency_30d / 30) * upp * mult;      // units per day
    let t = 0;
    ls.sort((a, b) => a.days_left - b.days_left);
    for (const l of ls) {
      if (l.status === 'quarantine') { onHold.push(l); continue; }
      const d = l.days_left;
      let consumed, sellout;
      if (d < 0) { consumed = 0; sellout = null; }
      else {
        const cap = rate * Math.max(0, d - t);
        consumed = Math.min(l.qty, cap);
        sellout = rate > 0 ? t + l.qty / rate : Infinity;
        t = consumed < l.qty ? Math.max(t, d) : t + l.qty / rate;
      }
      const waste = l.qty - consumed;
      out.push({ ...l, rate, consumed, waste, wasteValue: waste * l.unit_cost, sellout, soldShare: l.qty ? consumed / l.qty : 1 });
    }
  }
  const inH = out.filter(l => l.days_left <= horizon && l.waste > 0.5);
  const stockValue = out.reduce((s, l) => s + l.qty * l.unit_cost, 0);
  const timeline = [];
  for (let day = 0; day <= horizon; day += Math.max(1, Math.round(horizon / 40))) {
    timeline.push([day, inH.filter(l => l.days_left <= day).reduce((s, l) => s + l.wasteValue, 0)]);
  }
  return {
    lots: inH.sort((a, b) => b.wasteValue - a.wasteValue),
    units: inH.reduce((s, l) => s + l.waste, 0),
    value: inH.reduce((s, l) => s + l.wasteValue, 0),
    already: out.filter(l => l.days_left < 0).reduce((s, l) => s + l.wasteValue, 0),
    share: stockValue ? inH.reduce((s, l) => s + l.wasteValue, 0) / stockValue : 0,
    onHold, timeline,
  };
}

function computeExpiry() {
  const f = forecastWriteOff(LAB.expiry);
  LAB.impact.waste = f.value;
  renderImpact();
  return f;
}

function panelExpiry() {
  const e = LAB.expiry;
  document.getElementById('lab-panel').innerHTML = `
    <div class="lab-grid">
      <div class="card lab-ctl">
        <div class="lab-ctl-title">Assumptions</div>
        ${labSlider('mult', 'Demand vs last 30 days', { min: 0.25, max: 3, step: 0.05, value: e.mult, fmt: v => '×' + (+v).toFixed(2), hint: 'seasonality, promos' })}
        ${labSlider('upp', 'Units per pick', { min: 1, max: 25, step: 1, value: e.upp, fmt: v => v + ' u' })}
        ${labSlider('hz', 'Forecast horizon', { min: 30, max: 730, step: 10, value: e.horizon, fmt: v => v + ' d' })}
        <div class="lab-explain">Each product sells at <b>picks ÷ 30 × units per pick × demand</b> per day. Lots are consumed oldest-expiry first (FEFO); whatever is left when a lot expires is written off.</div>
      </div>
      <div class="lab-results">
        <div class="lab-kpis">
          <div class="lab-k danger"><span>Projected write-off</span><b id="ex-v">$0</b><small id="ex-vs"></small></div>
          <div class="lab-k"><span>Units lost</span><b id="ex-u">0</b><small id="ex-us"></small></div>
          <div class="lab-k"><span>Lots affected</span><b id="ex-l">0</b><small id="ex-ls"></small></div>
          <div class="lab-k"><span>Already expired</span><b id="ex-a">$0</b><small>write-off today</small></div>
        </div>
        <div class="lab-charts">
          <div class="card"><div class="card-title">Cumulative write-off over the horizon</div><div class="lab-chart"><canvas id="ex-c1"></canvas></div></div>
          <div class="card"><div class="card-title">Biggest write-offs by product</div><div class="lab-chart"><canvas id="ex-c2"></canvas></div></div>
        </div>
        <div class="card"><div class="card-title">Lots to act on <span class="wh-muted">click a lot to see it on its shelf</span></div><div id="ex-tbl"></div></div>
      </div>
    </div>`;
  const redraw = () => {
    const f = computeExpiry();
    setNum('ex-v', f.value, usd); document.getElementById('ex-vs').textContent = `${(f.share * 100).toFixed(1)}% of stock value`;
    setNum('ex-u', f.units, v => fmt(v)); document.getElementById('ex-us').textContent = `in the next ${e.horizon} days`;
    setNum('ex-l', f.lots.length, v => fmt(v)); document.getElementById('ex-ls').textContent = f.onHold.length ? `+ ${f.onHold.length} on hold (excluded)` : 'none on hold';
    setNum('ex-a', f.already, usd);
    labChart('ex1', 'ex-c1', {
      type: 'line',
      data: { labels: f.timeline.map(([d]) => d === 0 ? 'Today' : `+${d}d`),
        datasets: [{ data: f.timeline.map(([, v]) => v), borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,.10)', fill: true, tension: .25, pointRadius: 0, borderWidth: 2.5 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => usd(c.parsed.y) } } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => usd(v) } }, x: { ticks: { maxTicksLimit: 8 } } } },
    });
    const byP = new Map();
    f.lots.forEach(l => byP.set(l.sku, (byP.get(l.sku) || 0) + l.wasteValue));
    const top = [...byP.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    labChart('ex2', 'ex-c2', {
      type: 'bar',
      data: { labels: top.map(([s]) => s), datasets: [{ data: top.map(([, v]) => v), backgroundColor: top.map((_, i) => i < 2 ? '#dc2626' : i < 5 ? '#f97316' : '#f59e0b'), borderRadius: 6, maxBarThickness: 26 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => usd(c.parsed.x) } } }, scales: { x: { beginAtZero: true, ticks: { callback: v => usd(v) } } } },
    });
    document.getElementById('ex-tbl').innerHTML = f.lots.length ? `<div class="table-wrap"><table><thead><tr>
      <th>Product</th><th>Lot</th><th>Slot</th><th>Expires</th><th>Sold before expiry</th><th>Write-off</th><th>Suggested action</th></tr></thead><tbody>
      ${f.lots.slice(0, 10).map(l => `<tr class="wh-click" onclick="openRack(${l.main.aisle},${l.main.bay},{highlight:${l.main.inventory_id}})">
        <td><b>${esc(l.sku)}</b> ${esc(l.name)}</td><td>${esc(l.lot_number)}</td><td><span class="wh-loc">${esc(l.main.location_code)}</span></td>
        <td style="color:${BUCKETS[l.bucket].color};font-weight:600">${daysText(l.days_left)}</td>
        <td><div class="lab-sold"><i style="width:${(l.soldShare * 100).toFixed(0)}%"></i></div><small>${(l.soldShare * 100).toFixed(0)}% · ${fmt(l.consumed)} of ${fmt(l.qty)}</small></td>
        <td><b style="color:#dc2626">${usd(l.wasteValue)}</b><br><small>${fmt(l.waste)} u</small></td>
        <td>${l.days_left < 0 ? 'Quarantine & destroy' : l.days_left <= 30 ? 'Discount or redistribute now' : l.days_left <= 90 ? 'Move to golden zone, promote' : 'Cut the next order'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No write-off expected in this horizon at this demand.</div>';
  };
  bindSlider('mult', v => '×' + v.toFixed(2), v => { e.mult = v; redraw(); });
  bindSlider('upp', v => v + ' u', v => { e.upp = v; redraw(); });
  bindSlider('hz', v => v + ' d', v => { e.horizon = v; redraw(); });
  redraw();
}

/* ── 2. Route savings simulator ───────────────────────────────────────── */
async function runRouteSim(quiet) {
  if (LAB.routes.busy) { LAB.routes.queued = true; return; }
  LAB.routes.busy = true;
  document.getElementById('rt-run')?.classList.add('busy');
  try {
    const r = LAB.routes;
    r.result = await whApi('POST', '/api/lab/routes', { orders: r.orders, lines: r.lines, seed: r.seed });
    computeRoi();
    if (LAB.tab === 'routes') drawRoutes();
  } catch (e) { if (!quiet) toast(e.message, 'error'); }
  LAB.routes.busy = false;
  document.getElementById('rt-run')?.classList.remove('busy');
  if (LAB.routes.queued) { LAB.routes.queued = false; runRouteSim(true); }
}

function computeRoi() {
  const s = LAB.routes.result?.summary; if (!s) return null;
  const { perDay, speed, rate, days } = LAB.roi;
  const metres = s.avg_saved_m * perDay * days;
  const hours = metres / speed / 3600;
  const roi = { km: metres / 1000, hours, usd: hours * rate, fte: hours / 1800 };
  Object.assign(LAB.impact, { labor: roi.usd, hours: roi.hours, fte: roi.fte, routes: s.mean_savings_pct });
  renderImpact();
  return roi;
}

function panelRoutes() {
  const r = LAB.routes, o = LAB.roi;
  document.getElementById('lab-panel').innerHTML = `
    <div class="lab-grid">
      <div class="card lab-ctl">
        <div class="lab-ctl-title">Simulation <button class="lab-run" id="rt-run" title="New random orders">↻ Re-roll</button></div>
        ${labSlider('ord', 'Orders to simulate', { min: 20, max: 400, step: 10, value: r.orders, fmt: v => v })}
        ${labSlider('lin', 'Lines per order', { min: 2, max: 25, step: 1, value: r.lines, fmt: v => v + ' stops' })}
        <div class="lab-ctl-title" style="margin-top:18px">Your operation</div>
        ${labSlider('pd', 'Orders per day', { min: 50, max: 3000, step: 50, value: o.perDay, fmt: v => fmt(v) })}
        ${labSlider('sp', 'Walking speed', { min: 0.6, max: 1.6, step: 0.05, value: o.speed, fmt: v => (+v).toFixed(2) + ' m/s' })}
        ${labSlider('rate', 'Loaded labor cost', { min: 15, max: 50, step: 1, value: o.rate, fmt: v => '$' + v + '/h' })}
        ${labSlider('days', 'Operating days / year', { min: 200, max: 365, step: 5, value: o.days, fmt: v => v })}
        <div class="lab-explain">Orders are sampled from slots that hold shippable stock, weighted by pick frequency. Each one is routed by OR-Tools and by the aisle-by-aisle baseline.</div>
      </div>
      <div class="lab-results">
        <div class="lab-roi">
          <div><span>Labor saved / year</span><b id="roi-usd">$0</b></div>
          <div><span>Hours saved / year</span><b id="roi-h">0</b></div>
          <div><span>Walking saved / year</span><b id="roi-km">0 km</b></div>
          <div><span>Full-time equivalents</span><b id="roi-fte">0</b></div>
        </div>
        <div class="lab-kpis">
          <div class="lab-k"><span>Mean route saving</span><b id="rt-mean">0%</b><small id="rt-band"></small></div>
          <div class="lab-k"><span>Saved per order</span><b id="rt-saved">0 m</b><small id="rt-dist"></small></div>
          <div class="lab-k"><span>Orders simulated</span><b id="rt-n">0</b><small id="rt-l"></small></div>
        </div>
        <div class="lab-charts">
          <div class="card"><div class="card-title">Distribution of savings per order</div><div class="lab-chart"><canvas id="rt-c1"></canvas></div></div>
          <div class="card"><div class="card-title">Every order: baseline vs optimized</div><div class="lab-chart"><canvas id="rt-c2"></canvas></div></div>
        </div>
      </div>
    </div>`;
  let tm;
  const rerun = () => { clearTimeout(tm); tm = setTimeout(() => runRouteSim(), 180); };
  bindSlider('ord', v => v, v => { r.orders = v; }, rerun);
  bindSlider('lin', v => v + ' stops', v => { r.lines = v; }, rerun);
  bindSlider('pd', v => fmt(v), v => { o.perDay = v; drawRoi(); });
  bindSlider('sp', v => v.toFixed(2) + ' m/s', v => { o.speed = v; drawRoi(); });
  bindSlider('rate', v => '$' + v + '/h', v => { o.rate = v; drawRoi(); });
  bindSlider('days', v => v, v => { o.days = v; drawRoi(); });
  document.getElementById('rt-run').onclick = () => { r.seed = Math.floor(Math.random() * 1e6); runRouteSim(); };
  if (r.result) drawRoutes(); else runRouteSim();
}

function drawRoi() {
  const roi = computeRoi(); if (!roi) return;
  setNum('roi-usd', roi.usd, usd);
  setNum('roi-h', roi.hours, v => fmt(v));
  setNum('roi-km', roi.km, v => fmt(v) + ' km');
  setNum('roi-fte', roi.fte, v => v.toFixed(2));
}

function drawRoutes() {
  const res = LAB.routes.result; if (!res || !document.getElementById('rt-c1')) return;
  const s = res.summary;
  setNum('rt-mean', s.mean_savings_pct, v => v.toFixed(1) + '%');
  document.getElementById('rt-band').textContent = `p10 ${s.p10_savings_pct}% · median ${s.median_savings_pct}% · p90 ${s.p90_savings_pct}%`;
  setNum('rt-saved', s.avg_saved_m, v => v.toFixed(1) + ' m');
  document.getElementById('rt-dist').textContent = `${s.avg_optimized_m} m vs ${s.avg_baseline_m} m baseline`;
  setNum('rt-n', s.orders, v => fmt(v));
  document.getElementById('rt-l').textContent = `${s.lines} stops each`;
  drawRoi();
  const bins = Array.from({ length: 12 }, (_, i) => i * 5);
  const counts = bins.map(b => res.orders.filter(o => o.savings_pct >= b && (b === 55 ? true : o.savings_pct < b + 5)).length);
  labChart('rt1', 'rt-c1', {
    type: 'bar',
    data: { labels: bins.map(b => b === 55 ? '55%+' : `${b}–${b + 5}%`),
      datasets: [{ data: counts, backgroundColor: bins.map(b => b < 10 ? '#bfdbfe' : b < 25 ? '#60a5fa' : '#1d4ed8'), borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'orders' } }, x: { ticks: { maxRotation: 0, autoSkip: true } } } },
  });
  const max = Math.ceil(Math.max(...res.orders.map(o => o.baseline_m)) * 1.05 / 10) * 10;
  labChart('rt2', 'rt-c2', {
    type: 'scatter',
    data: { datasets: [
      { label: 'Orders', data: res.orders.map(o => ({ x: o.baseline_m, y: o.optimized_m })), backgroundColor: 'rgba(29,78,216,.55)', pointRadius: 3.5, pointHoverRadius: 6 },
      { label: 'No saving (y = x)', type: 'line', data: [{ x: 0, y: 0 }, { x: max, y: max }], borderColor: '#f97316', borderDash: [6, 5], pointRadius: 0, borderWidth: 2 },
    ] },
    options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => c.datasetIndex ? '' : `baseline ${c.parsed.x} m → ${c.parsed.y} m` } } },
      scales: { x: { min: 0, max, title: { display: true, text: 'aisle-by-aisle route (m)' } }, y: { min: 0, max, title: { display: true, text: 'optimized route (m)' } } } },
  });
}

/* ── 3. Slotting trade-offs ───────────────────────────────────────────── */
let _slotTimer;
async function runSlotWhatIf(quiet) {
  const w = LAB.slot;
  try {
    w.result = await whApi('POST', '/api/lab/slotting', { abc_distance: w.abc_distance, pick_frequency: w.pick_frequency, weight_level: w.weight_level, relocation: w.relocation });
    Object.assign(LAB.impact, { slot: w.result.reduction_pct, slotMoves: w.result.moves });
    renderImpact();
    if (LAB.tab === 'slotting') drawSlot();
  } catch (e) { if (!quiet) toast(e.message, 'error'); }
}

function panelSlotting() {
  const w = LAB.slot;
  const f2 = v => (+v).toFixed(1);
  document.getElementById('lab-panel').innerHTML = `
    <div class="lab-grid">
      <div class="card lab-ctl">
        <div class="lab-ctl-title">Cost weights</div>
        ${labSlider('wa', 'ABC class × distance', { min: 0, max: 3, step: 0.1, value: w.abc_distance, fmt: f2, hint: 'pull A items to the dock' })}
        ${labSlider('wp', 'Pick frequency × distance', { min: 0, max: 3, step: 0.1, value: w.pick_frequency, fmt: f2 })}
        ${labSlider('ww', 'Weight × shelf level', { min: 0, max: 3, step: 0.1, value: w.weight_level, fmt: f2, hint: 'heavy items low' })}
        ${labSlider('wr', 'Relocation cost', { min: 0, max: 5, step: 0.1, value: w.relocation, fmt: f2, hint: 'penalty per move' })}
        <div class="btn-group" style="margin-top:6px">
          <button class="btn btn-ghost btn-sm" id="sl-sweep">⌁ Map the trade-off curve</button>
          <button class="btn btn-primary btn-sm" id="sl-apply">Use these weights</button>
        </div>
        <div class="lab-explain">Every change re-solves the assignment model with OR-Tools (SCIP) in a rolled-back transaction, then measures expected picker travel: <b>Σ picks × 2 × distance to dock</b>.</div>
      </div>
      <div class="lab-results">
        <div class="lab-kpis">
          <div class="lab-k"><span>Picker travel / month</span><b id="sl-after">0 km</b><small id="sl-before"></small></div>
          <div class="lab-k good"><span>Travel reduction</span><b id="sl-red">0%</b><small>vs today's slotting</small></div>
          <div class="lab-k"><span>Moves needed</span><b id="sl-moves">0</b><small>relocations to get there</small></div>
        </div>
        <div class="lab-charts">
          <div class="card"><div class="card-title">Average distance to the dock by ABC class</div><div class="lab-chart"><canvas id="sl-c1"></canvas></div></div>
          <div class="card"><div class="card-title">Trade-off: moves vs travel saved <span class="wh-muted" id="sl-sweep-note">run the sweep →</span></div><div class="lab-chart"><canvas id="sl-c2"></canvas></div></div>
        </div>
        <div class="card"><div class="card-title">Proposed moves</div><div id="sl-moves-list" class="lab-moves"></div></div>
      </div>
    </div>`;
  const queue = () => { clearTimeout(_slotTimer); _slotTimer = setTimeout(() => runSlotWhatIf(), 220); };
  bindSlider('wa', f2, v => { w.abc_distance = v; queue(); });
  bindSlider('wp', f2, v => { w.pick_frequency = v; queue(); });
  bindSlider('ww', f2, v => { w.weight_level = v; queue(); });
  bindSlider('wr', f2, v => { w.relocation = v; queue(); });
  document.getElementById('sl-sweep').onclick = runSweep;
  document.getElementById('sl-apply').onclick = applySlotWeights;
  if (w.result) drawSlot(); else runSlotWhatIf();
  if (w.sweep) drawSweep();
}

function drawSlot() {
  const r = LAB.slot.result; if (!r || !document.getElementById('sl-c1')) return;
  setNum('sl-after', r.travel_after_km, v => v.toFixed(1) + ' km');
  document.getElementById('sl-before').textContent = `down from ${r.travel_before_km} km today`;
  setNum('sl-red', r.reduction_pct, v => v.toFixed(1) + '%');
  setNum('sl-moves', r.moves, v => fmt(v));
  const cls = ['A', 'B', 'C'].filter(c => r.by_class[c]);
  labChart('sl1', 'sl-c1', {
    type: 'bar',
    data: { labels: cls.map(c => `Class ${c} (${r.by_class[c].skus})`), datasets: [
      { label: 'Today', data: cls.map(c => r.by_class[c].before_m), backgroundColor: '#bfdbfe', borderRadius: 6 },
      { label: 'After re-slotting', data: cls.map(c => r.by_class[c].after_m), backgroundColor: '#1d4ed8', borderRadius: 6 },
    ] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'metres to dock' } } } },
  });
  document.getElementById('sl-moves-list').innerHTML = r.move_list.length ? r.move_list.slice(0, 16).map((m, i) =>
    `<span class="lab-move" style="--i:${i}"><b>${esc(m.sku)}</b> <span class="wh-loc">${esc(m.from || '—')}</span> → <span class="wh-loc">${esc(m.to)}</span></span>`).join('')
    + (r.move_list.length > 16 ? `<span class="wh-muted">+${r.moves - 16} more</span>` : '') : '<div class="wh-muted">Current slotting is already optimal for these weights.</div>';
  if (LAB.slot.sweep) drawSweep();
}

async function runSweep() {
  const w = LAB.slot, btn = document.getElementById('sl-sweep');
  btn.disabled = true; btn.textContent = 'Solving 9 scenarios…';
  try {
    w.sweep = await whApi('POST', '/api/lab/slotting/sweep', { abc_distance: w.abc_distance, pick_frequency: w.pick_frequency, weight_level: w.weight_level, relocation: w.relocation,
      values: [0, 0.1, 0.25, 0.5, 1, 1.5, 2.5, 4, 6] });
    drawSweep();
  } catch (e) { toast(e.message, 'error'); }
  btn.disabled = false; btn.textContent = '⌁ Map the trade-off curve';
}

function drawSweep() {
  const sw = LAB.slot.sweep; if (!sw || !document.getElementById('sl-c2')) return;
  document.getElementById('sl-sweep-note').textContent = 'each point = one relocation weight';
  const cur = LAB.slot.result;
  labChart('sl2', 'sl-c2', {
    type: 'scatter',
    data: { datasets: [
      { label: 'Relocation weight scenarios', data: sw.map(p => ({ x: p.moves, y: p.reduction_pct, w: p.relocation })), showLine: true, borderColor: '#1d4ed8', backgroundColor: '#1d4ed8', pointRadius: 5, tension: .25 },
      ...(cur ? [{ label: 'Current sliders', data: [{ x: cur.moves, y: cur.reduction_pct }], backgroundColor: '#f97316', pointRadius: 9, pointStyle: 'rectRot' }] : []),
    ] },
    options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => c.raw.w != null ? `relocation ${c.raw.w}: ${c.parsed.x} moves → ${c.parsed.y}% less travel` : `current: ${c.parsed.x} moves → ${c.parsed.y}%` } } },
      scales: { x: { beginAtZero: true, title: { display: true, text: 'moves needed' } }, y: { title: { display: true, text: 'travel reduction %' } } } },
  });
}

async function applySlotWeights() {
  const w = LAB.slot;
  const ok = await whModal({ title: 'Use these slotting weights?', body: `ABC × distance <b>${w.abc_distance.toFixed(1)}</b>, pick frequency <b>${w.pick_frequency.toFixed(1)}</b>, weight × level <b>${w.weight_level.toFixed(1)}</b>, relocation <b>${w.relocation.toFixed(1)}</b>.<br><br>They will be saved to Settings and used the next time you run the Slotting solver.`, confirm: 'Save weights' });
  if (!ok) return;
  const s = await api('GET', '/api/settings');
  await api('PUT', '/api/settings', { ...s, slotting_w_abc: w.abc_distance, slotting_w_pick: w.pick_frequency, slotting_w_weight: w.weight_level, slotting_w_relocation: w.relocation });
  toast('Slotting weights saved');
}

/* ── 4. ABC sensitivity ───────────────────────────────────────────────── */
function abcClassify(a, b) {
  const rows = LAB.data.products.map(p => ({ sku: p.sku, name: p.name, uv: p.pick_frequency_30d * p.unit_cost })).sort((x, y) => y.uv - x.uv);
  const total = rows.reduce((s, r) => s + r.uv, 0) || 1;
  let cum = 0;
  return rows.map(r => { const prev = cum / total; cum += r.uv; return { ...r, cum: cum / total, cls: prev < a ? 'A' : prev < b ? 'B' : 'C' }; });
}

function panelAbc() {
  const s = LAB.abc;
  document.getElementById('lab-panel').innerHTML = `
    <div class="lab-grid">
      <div class="card lab-ctl">
        <div class="lab-ctl-title">Class boundaries</div>
        ${labSlider('ta', 'A covers the first', { min: 50, max: 95, step: 1, value: s.a, fmt: v => v + '%', hint: 'of usage value' })}
        ${labSlider('tb', 'A + B cover the first', { min: 60, max: 99, step: 1, value: s.b, fmt: v => v + '%' })}
        <div class="lab-explain">Usage value = picks (30 d) × unit cost. SKUs are ranked, and each one's class depends on the cumulative share <b>before</b> it is added.</div>
        <div id="abc-chg"></div>
      </div>
      <div class="lab-results">
        <div class="lab-kpis" id="abc-k"></div>
        <div class="card"><div class="card-title">Pareto: usage value by SKU and cumulative share</div><div class="lab-chart tall"><canvas id="abc-c1"></canvas></div></div>
      </div>
    </div>`;
  const base = Object.fromEntries(abcClassify(0.8, 0.95).map(r => [r.sku, r.cls]));
  const redraw = () => {
    if (s.b <= s.a) s.b = Math.min(99, s.a + 1);
    const tb = document.getElementById('ls-tb'); if (tb && +tb.value !== s.b) { tb.value = s.b; tb.dispatchEvent(new Event('input')); return; }
    const rows = abcClassify(s.a / 100, s.b / 100), total = rows.reduce((t, r) => t + r.uv, 0) || 1;
    document.getElementById('abc-k').innerHTML = ['A', 'B', 'C'].map(c => {
      const rs = rows.filter(r => r.cls === c), share = rs.reduce((t, r) => t + r.uv, 0) / total;
      return `<div class="lab-k cls-${c}"><span>Class ${c}</span><b>${rs.length} SKUs</b><small>${(share * 100).toFixed(1)}% of usage value</small></div>`;
    }).join('');
    const col = { A: '#1d4ed8', B: '#60a5fa', C: '#bfdbfe' };
    labChart('abc1', 'abc-c1', {
      type: 'bar',
      data: { labels: rows.map(r => r.sku), datasets: [
        { type: 'bar', label: 'Usage value', data: rows.map(r => r.uv), backgroundColor: rows.map(r => col[r.cls]), borderRadius: 5, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Cumulative %', data: rows.map(r => +(r.cum * 100).toFixed(1)), borderColor: '#0b2a6f', pointRadius: 2.5, tension: .25, yAxisID: 'y2', order: 1 },
        { type: 'line', label: `A cut-off (${s.a}%)`, data: rows.map(() => s.a), borderColor: '#1d4ed8', borderDash: [6, 4], pointRadius: 0, yAxisID: 'y2', order: 0 },
        { type: 'line', label: `B cut-off (${s.b}%)`, data: rows.map(() => s.b), borderColor: '#60a5fa', borderDash: [6, 4], pointRadius: 0, yAxisID: 'y2', order: 0 },
      ] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { callback: v => usd(v) } }, y2: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: v => v + '%' } } } },
    });
    const changed = rows.filter(r => r.cls !== base[r.sku]);
    document.getElementById('abc-chg').innerHTML = changed.length
      ? `<div class="lab-ctl-title" style="margin-top:14px">Changed vs 80/95 default</div>${changed.map(r => `<div class="lab-chg"><b>${esc(r.sku)}</b> ${base[r.sku]} → <b class="c-${r.cls}">${r.cls}</b></div>`).join('')}`
      : '<div class="wh-muted" style="margin-top:12px">Same classes as the 80/95 default.</div>';
  };
  bindSlider('ta', v => v + '%', v => { s.a = v; redraw(); });
  bindSlider('tb', v => v + '%', v => { s.b = Math.max(v, s.a + 1); redraw(); });
  redraw();
}

VIEWS.lab = viewLab;
