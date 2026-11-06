'use strict';

// ── API helper ────────────────────────────────────────────────────────────────
async function api(method, path, body = null, isForm = false) {
  const opts = { method };
  if (body && !isForm) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  } else if (body && isForm) {
    opts.body = body;
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
function badge(val, map) {
  const cls = map[val] || '';
  return `<span class="badge ${cls}">${val}</span>`;
}

function tbl(headers, rows, empty = 'No data.') {
  if (!rows || !rows.length) return `<div class="empty">${empty}</div>`;
  const ths = headers.map(h => `<th>${h}</th>`).join('');
  const trs = rows.map(r => `<tr>${r.map(c => `<td>${c ?? '—'}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

function kpiCard(label, value, cls = '') {
  return `<div class="kpi-card ${cls}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div></div>`;
}

function metricItem(label, value) {
  return `<div class="metric-item"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`;
}

const STATUS_BADGE = {
  active: 'b-active', quarantine: 'b-quarantine', expired: 'b-expired',
  pending: 'b-pending', accepted: 'b-accepted', rejected: 'b-rejected',
  open: 'b-open', in_progress: 'b-pending', completed: 'b-completed', cancelled: 'b-cancelled',
  ambient: 'b-ambient', cold: 'b-cold',
  A: 'b-a', B: 'b-b', C: 'b-c',
};

// ── Navigation ────────────────────────────────────────────────────────────────
let _paretoChart = null;
let _metricsChart = null;
let _invTab = 'products';
let _pickTab = 'lists';

function showView(name) {
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.view === name));
  const vc = document.getElementById('view-content');
  vc.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
  VIEWS[name]().catch(e => {
    vc.innerHTML = `<div class="empty" style="color:var(--danger)">Error: ${e.message}</div>`;
    console.error(e);
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function viewDashboard() {
  const { kpis, alerts } = await api('GET', '/api/dashboard');
  const alertRows = alerts.map(a => {
    const cls = a.days_left <= 30 ? 'row-30' : 'row-60';
    return `<tr class="${cls}"><td>${a.product_sku}</td><td>${a.lot_number}</td><td>${a.expiry_date}</td><td><strong>${a.days_left}</strong></td></tr>`;
  });
  document.getElementById('view-content').innerHTML = `
    <div class="page-header"><h1 class="page-title">Dashboard</h1></div>
    <div class="kpi-grid">
      ${kpiCard('Products', kpis.product_count)}
      ${kpiCard('Locations', kpis.location_count)}
      ${kpiCard('Stock Lines', kpis.stock_lines)}
      ${kpiCard('Open Picks', kpis.open_picks)}
      ${kpiCard('Expiry Alerts', kpis.expiry_alerts, kpis.expiry_alerts > 0 ? 'warn' : '')}
    </div>
    <div class="card">
      <div class="card-title">${alerts.length ? 'Expiry Alerts' : 'No Expiry Alerts'}</div>
      ${alerts.length ? `<div class="table-wrap"><table>
        <thead><tr><th>SKU</th><th>Lot</th><th>Expiry Date</th><th>Days Left</th></tr></thead>
        <tbody>${alertRows.join('')}</tbody>
      </table></div>` : '<div class="empty">All batches are within safe expiry windows.</div>'}
    </div>`;
}

// ── Inventory ─────────────────────────────────────────────────────────────────
async function viewInventory() {
  document.getElementById('view-content').innerHTML = `
    <div class="page-header"><h1 class="page-title">Inventory</h1></div>
    <div class="tabs">
      ${['products','locations','batches','stock','receive','transfer','movements']
        .map(t => `<div class="tab${_invTab===t?' active':''}" onclick="switchInv('${t}')">${t.charAt(0).toUpperCase()+t.slice(1)}</div>`).join('')}
    </div>
    <div id="inv-panel"></div>`;
  await _renderInvPanel(_invTab);
}

async function switchInv(tab) {
  _invTab = tab;
  document.querySelectorAll('.tabs .tab').forEach((el, i) => {
    const tabs = ['products','locations','batches','stock','receive','transfer','movements'];
    el.classList.toggle('active', tabs[i] === tab);
  });
  await _renderInvPanel(tab);
}

async function _renderInvPanel(tab) {
  const el = document.getElementById('inv-panel');
  if (!el) return;

  if (tab === 'products') {
    const items = await api('GET', '/api/products');
    const rows = items.map(p => [
      `<strong>${p.sku}</strong>`, p.name,
      badge(p.storage_class, STATUS_BADGE),
      `$${p.unit_cost.toFixed(2)}`, `${p.weight_kg}kg`, p.pick_frequency_30d
    ]);
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Products
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            ↑ Import CSV<input type="file" accept=".csv" style="display:none" onchange="importCSV(this,'products')">
          </label>
        </div>
        ${tbl(['SKU','Name','Storage','Unit Cost','Weight','Pick Freq/30d'], rows, 'No products yet.')}
      </div>
      <div class="card">
        <div class="card-title">Add Product</div>
        <form onsubmit="addProduct(event)">
          <div class="form-grid">
            <div class="form-group"><label>SKU</label><input name="sku" required placeholder="PH-001"></div>
            <div class="form-group"><label>Name</label><input name="name" required></div>
            <div class="form-group"><label>Storage class</label>
              <select name="storage_class"><option value="ambient">Ambient</option><option value="cold">Cold chain</option></select>
            </div>
            <div class="form-group"><label>Unit cost $</label><input name="unit_cost" type="number" step="0.01" min="0" value="0"></div>
            <div class="form-group"><label>Weight kg</label><input name="weight_kg" type="number" step="0.001" min="0" value="0"></div>
            <div class="form-group"><label>Pick freq 30d</label><input name="pick_frequency_30d" type="number" min="0" value="0"></div>
          </div>
          <div style="margin-top:14px"><button class="btn btn-primary" type="submit">Add Product</button></div>
        </form>
      </div>`;
  }

  else if (tab === 'locations') {
    const items = await api('GET', '/api/locations');
    const rows = items.map(l => [
      `<strong>${l.code}</strong>`, badge(l.zone_type, STATUS_BADGE),
      l.aisle, l.bay, l.level, l.x_coord, l.y_coord, `${l.max_weight_kg}kg`
    ]);
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Locations
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            ↑ Import CSV<input type="file" accept=".csv" style="display:none" onchange="importCSV(this,'locations')">
          </label>
        </div>
        ${tbl(['Code','Zone','Aisle','Bay','Level','X','Y','Max kg'], rows, 'No locations yet.')}
      </div>
      <div class="card">
        <div class="card-title">Add Location</div>
        <form onsubmit="addLocation(event)">
          <div class="form-grid">
            <div class="form-group"><label>Code</label><input name="code" required placeholder="A01-B01-L1"></div>
            <div class="form-group"><label>Zone</label>
              <select name="zone_type"><option value="ambient">Ambient</option><option value="cold">Cold</option></select>
            </div>
            <div class="form-group"><label>Aisle</label><input name="aisle" type="number" value="0"></div>
            <div class="form-group"><label>Bay</label><input name="bay" type="number" value="0"></div>
            <div class="form-group"><label>Level</label><input name="level" type="number" value="0"></div>
            <div class="form-group"><label>X coord</label><input name="x_coord" type="number" step="0.1" value="0"></div>
            <div class="form-group"><label>Y coord</label><input name="y_coord" type="number" step="0.1" value="0"></div>
            <div class="form-group"><label>Max weight kg</label><input name="max_weight_kg" type="number" value="500"></div>
          </div>
          <div style="margin-top:14px"><button class="btn btn-primary" type="submit">Add Location</button></div>
        </form>
      </div>`;
  }

  else if (tab === 'batches') {
    const items = await api('GET', '/api/batches');
    const rows = items.map(b => [
      b.id, b.product_id, b.lot_number, b.expiry_date,
      badge(b.status, STATUS_BADGE)
    ]);
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Batches / Lots</div>
        ${tbl(['ID','Product ID','Lot Number','Expiry Date','Status'], rows, 'No batches yet.')}
      </div>
      <div class="card">
        <div class="card-title">Create Batch</div>
        <form onsubmit="createBatch(event)">
          <div class="form-grid">
            <div class="form-group"><label>Product ID</label><input name="product_id" type="number" required></div>
            <div class="form-group"><label>Lot number</label><input name="lot_number" required placeholder="LOT-0001"></div>
            <div class="form-group"><label>Expiry date</label><input name="expiry_date" type="date" required></div>
          </div>
          <div style="margin-top:14px"><button class="btn btn-primary" type="submit">Create Batch</button></div>
        </form>
      </div>`;
  }

  else if (tab === 'stock') {
    const items = await api('GET', '/api/inventory');
    const rows = items.map(i => [
      `<strong>${i.sku}</strong>`, i.product_name, i.lot_number, i.expiry_date,
      badge(i.batch_status, STATUS_BADGE),
      i.location_code, badge(i.zone_type, STATUS_BADGE),
      `<strong>${i.quantity}</strong>`
    ]);
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Current Stock Levels
          <button class="btn btn-ghost btn-sm" onclick="switchInv('stock')">↺ Refresh</button>
        </div>
        ${tbl(['SKU','Product','Lot','Expiry','Batch','Location','Zone','Qty'], rows, 'No stock on hand.')}
      </div>`;
  }

  else if (tab === 'receive') {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Receive Stock</div>
        <form onsubmit="receiveStock(event)">
          <div class="form-grid">
            <div class="form-group"><label>Product ID</label><input name="product_id" type="number" required></div>
            <div class="form-group"><label>Batch ID</label><input name="batch_id" type="number" required></div>
            <div class="form-group"><label>Location ID</label><input name="location_id" type="number" required></div>
            <div class="form-group"><label>Quantity</label><input name="quantity" type="number" step="0.01" min="0.01" required></div>
            <div class="form-group"><label>Reference (optional)</label><input name="reference" placeholder="PO-001"></div>
          </div>
          <div style="margin-top:14px"><button class="btn btn-success" type="submit">Receive Stock</button></div>
        </form>
      </div>
      <div class="card">
        <div class="card-title">Cycle-Count Adjustment</div>
        <form onsubmit="adjustStock(event)">
          <div class="form-grid">
            <div class="form-group"><label>Product ID</label><input name="product_id" type="number" required></div>
            <div class="form-group"><label>Batch ID</label><input name="batch_id" type="number" required></div>
            <div class="form-group"><label>Location ID</label><input name="location_id" type="number" required></div>
            <div class="form-group"><label>New quantity</label><input name="new_quantity" type="number" step="0.01" min="0" required></div>
            <div class="form-group"><label>Reason</label><input name="reason" required placeholder="Cycle count correction"></div>
          </div>
          <div style="margin-top:14px"><button class="btn btn-primary" type="submit">Adjust</button></div>
        </form>
      </div>`;
  }

  else if (tab === 'transfer') {
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Transfer Stock</div>
        <form onsubmit="transferStock(event)">
          <div class="form-grid">
            <div class="form-group"><label>Product ID</label><input name="product_id" type="number" required></div>
            <div class="form-group"><label>Batch ID</label><input name="batch_id" type="number" required></div>
            <div class="form-group"><label>From location ID</label><input name="from_location_id" type="number" required></div>
            <div class="form-group"><label>To location ID</label><input name="to_location_id" type="number" required></div>
            <div class="form-group"><label>Quantity</label><input name="quantity" type="number" step="0.01" min="0.01" required></div>
          </div>
          <div style="margin-top:14px"><button class="btn btn-primary" type="submit">Transfer</button></div>
        </form>
      </div>`;
  }

  else if (tab === 'movements') {
    const items = await api('GET', '/api/movements');
    const rows = items.map(m => [m.id, m.type, m.reference, m.user, m.created_at, m.lines]);
    el.innerHTML = `
      <div class="card">
        <div class="card-title">Movement History</div>
        ${tbl(['ID','Type','Reference','User','Time','Lines'], rows, 'No movements.')}
      </div>`;
  }
}

async function addProduct(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('POST', '/api/products', {
      sku: fd.get('sku'), name: fd.get('name'), storage_class: fd.get('storage_class'),
      unit_cost: +fd.get('unit_cost'), weight_kg: +fd.get('weight_kg'),
      pick_frequency_30d: +fd.get('pick_frequency_30d'),
    });
    toast('Product added'); e.target.reset(); switchInv('products');
  } catch (err) { toast(err.message, 'error'); }
}

async function addLocation(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('POST', '/api/locations', {
      code: fd.get('code'), zone_type: fd.get('zone_type'),
      aisle: +fd.get('aisle'), bay: +fd.get('bay'), level: +fd.get('level'),
      x_coord: +fd.get('x_coord'), y_coord: +fd.get('y_coord'),
      max_weight_kg: +fd.get('max_weight_kg'),
    });
    toast('Location added'); e.target.reset(); switchInv('locations');
  } catch (err) { toast(err.message, 'error'); }
}

async function createBatch(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('POST', '/api/batches', {
      product_id: +fd.get('product_id'), lot_number: fd.get('lot_number'),
      expiry_date: fd.get('expiry_date'),
    });
    toast('Batch created'); e.target.reset(); switchInv('batches');
  } catch (err) { toast(err.message, 'error'); }
}

async function receiveStock(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('POST', '/api/inventory/receive', {
      product_id: +fd.get('product_id'), batch_id: +fd.get('batch_id'),
      location_id: +fd.get('location_id'), quantity: +fd.get('quantity'),
      reference: fd.get('reference') || null,
    });
    toast('Stock received'); e.target.reset();
  } catch (err) { toast(err.message, 'error'); }
}

async function adjustStock(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('POST', '/api/inventory/adjust', {
      product_id: +fd.get('product_id'), batch_id: +fd.get('batch_id'),
      location_id: +fd.get('location_id'), new_quantity: +fd.get('new_quantity'),
      reason: fd.get('reason'),
    });
    toast('Stock adjusted'); e.target.reset();
  } catch (err) { toast(err.message, 'error'); }
}

async function transferStock(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('POST', '/api/inventory/transfer', {
      product_id: +fd.get('product_id'), batch_id: +fd.get('batch_id'),
      from_location_id: +fd.get('from_location_id'), to_location_id: +fd.get('to_location_id'),
      quantity: +fd.get('quantity'),
    });
    toast('Transfer complete'); e.target.reset();
  } catch (err) { toast(err.message, 'error'); }
}

async function importCSV(input, type) {
  if (!input.files[0]) return;
  const fd = new FormData();
  fd.append('file', input.files[0]);
  try {
    const res = await api('POST', `/api/import/${type}`, fd, true);
    toast(`Imported ${res.imported} records`);
    switchInv(type === 'products' ? 'products' : 'locations');
  } catch (err) { toast(err.message, 'error'); }
}

// ── ABC Analysis ──────────────────────────────────────────────────────────────
async function viewABC() {
  document.getElementById('view-content').innerHTML = `
    <div class="page-header"><h1 class="page-title">ABC Analysis</h1></div>
    <div class="card">
      <div class="card-title">Run Analysis</div>
      <form onsubmit="runABC(event)">
        <div class="form-grid">
          <div class="form-group"><label>Threshold A (cumulative %)</label>
            <input id="abc-ta" name="threshold_a" type="number" step="0.01" min="0.5" max="1" value="0.80"></div>
          <div class="form-group"><label>Threshold B (cumulative %)</label>
            <input id="abc-tb" name="threshold_b" type="number" step="0.01" min="0.5" max="1" value="0.95"></div>
        </div>
        <div class="btn-group" style="margin-top:14px">
          <button class="btn btn-primary" type="submit">Run ABC Analysis</button>
        </div>
      </form>
    </div>
    <div id="abc-results"></div>`;
}

async function runABC(e) {
  if (e) e.preventDefault();
  const ta = parseFloat(document.getElementById('abc-ta').value);
  const tb = parseFloat(document.getElementById('abc-tb').value);
  try {
    const data = await api('POST', '/api/abc/run', { threshold_a: ta, threshold_b: tb });
    _renderABCResults(data);
  } catch (err) { toast(err.message, 'error'); }
}

function _renderABCResults({ results, pareto }) {
  if (!results.length) {
    document.getElementById('abc-results').innerHTML = '<div class="empty">No products found. Add products first.</div>';
    return;
  }
  const counts = results.reduce((a, r) => { a[r.abc_class] = (a[r.abc_class] || 0) + 1; return a; }, {});
  const rows = results.map(r => [
    `<strong>${r.sku}</strong>`, r.name, r.pick_frequency,
    `$${r.unit_cost.toFixed(2)}`, `$${r.auv.toFixed(2)}`,
    `${r.cum_pct.toFixed(1)}%`,
    badge(r.abc_class, STATUS_BADGE), r.recommended_zone,
  ]);

  document.getElementById('abc-results').innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('Class A SKUs', counts.A || 0)}
      ${kpiCard('Class B SKUs', counts.B || 0)}
      ${kpiCard('Class C SKUs', counts.C || 0)}
    </div>
    <div class="card">
      <div class="card-title">Pareto Chart — Annual Usage Value</div>
      <div class="chart-container" style="height:280px"><canvas id="pareto-chart"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title">Classification Results
        <form onsubmit="saveSnapshot(event)" style="display:flex;gap:8px;align-items:center">
          <input name="label" placeholder="Snapshot label…" style="width:180px">
          <button class="btn btn-ghost btn-sm" type="submit">Save Snapshot</button>
        </form>
      </div>
      ${tbl(['SKU','Name','Pick Freq','Unit Cost','AUV','Cum %','Class','Recommended Zone'], rows)}
    </div>`;

  if (_paretoChart) { _paretoChart.destroy(); _paretoChart = null; }
  const colors = pareto.abc_class.map(c => c === 'A' ? '#1d4ed8' : c === 'B' ? '#60a5fa' : '#bfdbfe');
  _paretoChart = new Chart(document.getElementById('pareto-chart'), {
    type: 'bar',
    data: {
      labels: pareto.labels,
      datasets: [
        { label: 'AUV', data: pareto.auv, backgroundColor: colors, yAxisID: 'y', order: 2 },
        {
          label: 'Cumulative %', data: pareto.cumulative, type: 'line',
          borderColor: '#0b2a6f', backgroundColor: 'rgba(11,42,111,.06)',
          yAxisID: 'y1', order: 1, tension: 0.3, pointRadius: 2, borderWidth: 2,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { position: 'left', title: { display: true, text: 'Annual Usage Value ($)' } },
        y1: { position: 'right', min: 0, max: 100,
              title: { display: true, text: 'Cumulative %' },
              grid: { drawOnChartArea: false } }
      },
      plugins: { legend: { position: 'top' } }
    }
  });
}

async function saveSnapshot(e) {
  e.preventDefault();
  const label = new FormData(e.target).get('label') || 'Snapshot';
  try {
    await api('POST', '/api/abc/snapshot', { label });
    toast(`Snapshot "${label}" saved`);
    e.target.reset();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Slotting ──────────────────────────────────────────────────────────────────
async function viewSlotting() {
  const recs = await api('GET', '/api/slotting/recommendations');
  const pending = recs.filter(r => r.status === 'pending').length;
  const rows = recs.map(r => [
    r.id, `<strong>${r.sku}</strong>`, r.from_code, r.to_code,
    r.cost_delta.toFixed(1),
    badge(r.status, STATUS_BADGE),
    r.created_at,
    r.status === 'pending' ? `
      <button class="btn btn-success btn-sm" onclick="acceptRec(${r.id})">Accept</button>
      <button class="btn btn-danger btn-sm" onclick="rejectRec(${r.id})">Reject</button>` : '—'
  ]);

  document.getElementById('view-content').innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Slotting Optimization</h1>
      <button class="btn btn-primary" onclick="runSlotting(this)">▶ Run OR-Tools Solver</button>
    </div>
    <div id="slotting-msg"></div>
    <div class="card">
      <div class="card-title">Recommendations &nbsp;<span class="badge b-pending">${pending} pending</span></div>
      ${tbl(['ID','SKU','From','To','Cost','Status','Created','Actions'], rows,
            'No recommendations yet — click "Run OR-Tools Solver" to generate.')}
    </div>`;
}

async function runSlotting(btn) {
  if (btn) btn.disabled = true;
  document.getElementById('slotting-msg').innerHTML =
    '<div class="card"><div class="empty">Running assignment solver… this may take a few seconds.</div></div>';
  try {
    const res = await api('POST', '/api/slotting/run');
    toast(`${res.count} recommendation(s) generated`);
    viewSlotting();
  } catch (err) {
    toast(err.message, 'error');
    document.getElementById('slotting-msg').innerHTML = '';
    if (btn) btn.disabled = false;
  }
}

async function acceptRec(id) {
  try {
    await api('POST', `/api/slotting/${id}/accept`);
    toast('Accepted — transfer task created'); viewSlotting();
  } catch (err) { toast(err.message, 'error'); }
}

async function rejectRec(id) {
  await api('POST', `/api/slotting/${id}/reject`);
  toast('Rejected', 'info'); viewSlotting();
}

// ── Picking ───────────────────────────────────────────────────────────────────
async function viewPicking() {
  document.getElementById('view-content').innerHTML = `
    <div class="page-header"><h1 class="page-title">Picking</h1></div>
    <div class="tabs">
      <div class="tab${_pickTab==='lists'?' active':''}" onclick="switchPick('lists')">Pick Lists</div>
      <div class="tab${_pickTab==='metrics'?' active':''}" onclick="switchPick('metrics')">Efficiency Metrics</div>
    </div>
    <div id="pick-panel"></div>`;
  await _renderPickPanel(_pickTab);
}

async function switchPick(tab) {
  _pickTab = tab;
  document.querySelectorAll('.tabs .tab').forEach((el, i) => {
    el.classList.toggle('active', ['lists','metrics'][i] === tab);
  });
  await _renderPickPanel(tab);
}

async function _renderPickPanel(tab) {
  const el = document.getElementById('pick-panel');
  if (!el) return;

  if (tab === 'lists') {
    const picks = await api('GET', '/api/picks');
    const rows = picks.map(p => [
      p.id, `<strong>${p.reference}</strong>`, p.lines,
      badge(p.status, STATUS_BADGE),
      `${p.optimized_distance_m}m`, `${p.baseline_distance_m}m`,
      p.created_at,
      `<button class="btn btn-ghost btn-sm" onclick="showPickLines(${p.id})">View</button>
       ${p.status==='open'?`<button class="btn btn-success btn-sm" onclick="completePick(${p.id})">Complete</button>`:''}`
    ]);

    el.innerHTML = `
      <div class="card">
        <div class="card-title">Create Pick List (FEFO + TSP routing)</div>
        <form onsubmit="createPickList(event)">
          <div class="form-grid">
            <div class="form-group"><label>Reference</label><input name="reference" placeholder="PL-001" required></div>
            <div class="form-group"><label>Product ID</label><input name="product_id" type="number" required></div>
            <div class="form-group"><label>Quantity</label><input name="quantity" type="number" step="0.01" min="0.01" value="1" required></div>
          </div>
          <div style="margin-top:14px"><button class="btn btn-primary" type="submit">Create Pick List</button></div>
        </form>
      </div>
      <div class="card">
        <div class="card-title">Pick Lists</div>
        ${tbl(['ID','Reference','Lines','Status','Opt. Dist','Base Dist','Created','Actions'], rows, 'No pick lists.')}
      </div>
      <div id="pick-lines-detail"></div>`;
  }

  else if (tab === 'metrics') {
    const m = await api('GET', '/api/picking/metrics');
    el.innerHTML = `
      <div class="metric-row">
        ${metricItem('Completed Picks', m.completed_picks)}
        ${metricItem('Avg Picks / Hour', m.avg_picks_per_hour)}
        ${metricItem('Avg Optimised Dist', m.avg_optimized_distance_m + 'm')}
        ${metricItem('Avg Baseline Dist', m.avg_baseline_distance_m + 'm')}
        ${metricItem('Distance Savings', m.distance_savings_pct + '%')}
        ${metricItem('FEFO Compliance', m.fefo_compliance_pct + '%')}
        ${metricItem('Error Rate', m.error_rate_pct + '%')}
      </div>
      <div class="card">
        <div class="card-title">Route Distance Comparison</div>
        <div class="chart-container" style="height:220px"><canvas id="metrics-chart"></canvas></div>
      </div>`;

    if (_metricsChart) { _metricsChart.destroy(); _metricsChart = null; }
    _metricsChart = new Chart(document.getElementById('metrics-chart'), {
      type: 'bar',
      data: {
        labels: ['Optimised (m)', 'Baseline (m)'],
        datasets: [{
          data: [m.avg_optimized_distance_m, m.avg_baseline_distance_m],
          backgroundColor: ['#1d4ed8', '#bfdbfe'],
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Metres' } } }
      }
    });
  }
}

async function createPickList(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const pl = await api('POST', '/api/picks', {
      reference: fd.get('reference'),
      lines: [{ product_id: +fd.get('product_id'), quantity: +fd.get('quantity') }],
    });
    toast(`Pick list created — ${pl.lines} line(s), ${pl.optimized_distance_m}m optimised route`);
    e.target.reset();
    switchPick('lists');
  } catch (err) { toast(err.message, 'error'); }
}

async function showPickLines(id) {
  const detail = document.getElementById('pick-lines-detail');
  if (!detail) return;
  const pl = await api('GET', `/api/picks/${id}`);
  const rows = pl.lines.map(l => [
    l.sequence, `<strong>${l.sku}</strong>`, l.lot_number, l.expiry_date,
    l.location_code, l.quantity,
    l.picked ? '✓' : '—', l.pick_error || '—'
  ]);
  detail.innerHTML = `
    <div class="card">
      <div class="card-title">Pick List <strong>${pl.reference}</strong> — Optimised Pick Route
        &nbsp; ${badge(pl.status, STATUS_BADGE)}
        &nbsp;<small style="color:var(--muted)">opt ${pl.optimized_distance_m}m vs baseline ${pl.baseline_distance_m}m</small>
      </div>
      ${tbl(['Seq','SKU','Lot','Expiry','Location','Qty','Picked','Error'], rows)}
    </div>`;
}

async function completePick(id) {
  try {
    await api('POST', `/api/picks/${id}/complete`, { duration_seconds: 0 });
    toast('Pick list completed'); switchPick('lists');
  } catch (err) { toast(err.message, 'error'); }
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
async function viewAudit() {
  const logs = await api('GET', '/api/audit');
  const rows = logs.map(l => [l.id, l.created_at, l.entity_type, l.entity_id, l.action, l.user_name, l.notes]);
  document.getElementById('view-content').innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Audit Log</h1>
      <button class="btn btn-ghost" onclick="showView('audit')">↺ Refresh</button>
    </div>
    <div class="card">
      ${tbl(['ID','Time','Entity','Entity ID','Action','User','Notes'], rows, 'No audit entries.')}
    </div>`;
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function viewSettings() {
  const cfg = await api('GET', '/api/settings');
  document.getElementById('view-content').innerHTML = `
    <div class="page-header"><h1 class="page-title">Settings</h1></div>
    <div class="card">
      <div class="card-title">General &amp; Audit</div>
      <form onsubmit="saveSettings(event)">
        <div class="form-grid">
          <div class="form-group"><label>User name (audit trail)</label>
            <input name="user_name" value="${cfg.user_name}"></div>
          <div class="form-group"><label>Dispatch dock X</label>
            <input name="dispatch_x" type="number" step="0.1" value="${cfg.dispatch_x}"></div>
          <div class="form-group"><label>Dispatch dock Y</label>
            <input name="dispatch_y" type="number" step="0.1" value="${cfg.dispatch_y}"></div>
        </div>
        <div style="margin-top:18px;margin-bottom:8px;font-weight:600;font-size:13px;color:var(--muted)">ABC THRESHOLDS</div>
        <div class="form-grid">
          <div class="form-group"><label>Class A (cumulative %)</label>
            <input name="abc_threshold_a" type="number" step="0.01" min="0" max="1" value="${cfg.abc_threshold_a}"></div>
          <div class="form-group"><label>Class B (cumulative %)</label>
            <input name="abc_threshold_b" type="number" step="0.01" min="0" max="1" value="${cfg.abc_threshold_b}"></div>
        </div>
        <div style="margin-top:18px;margin-bottom:8px;font-weight:600;font-size:13px;color:var(--muted)">SLOTTING WEIGHTS</div>
        <div class="form-grid">
          <div class="form-group"><label>ABC distance penalty</label>
            <input name="slotting_w_abc" type="number" step="0.1" value="${cfg.slotting_w_abc}"></div>
          <div class="form-group"><label>Pick frequency</label>
            <input name="slotting_w_pick" type="number" step="0.1" value="${cfg.slotting_w_pick}"></div>
          <div class="form-group"><label>Weight × level</label>
            <input name="slotting_w_weight" type="number" step="0.1" value="${cfg.slotting_w_weight}"></div>
          <div class="form-group"><label>Relocation cost</label>
            <input name="slotting_w_relocation" type="number" step="0.1" value="${cfg.slotting_w_relocation}"></div>
        </div>
        <div class="btn-group" style="margin-top:18px">
          <button class="btn btn-primary" type="submit">Save Settings</button>
        </div>
      </form>
    </div>`;
}

async function saveSettings(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('PUT', '/api/settings', {
      user_name: fd.get('user_name'),
      dispatch_x: +fd.get('dispatch_x'),
      dispatch_y: +fd.get('dispatch_y'),
      abc_threshold_a: +fd.get('abc_threshold_a'),
      abc_threshold_b: +fd.get('abc_threshold_b'),
      slotting_w_abc: +fd.get('slotting_w_abc'),
      slotting_w_pick: +fd.get('slotting_w_pick'),
      slotting_w_weight: +fd.get('slotting_w_weight'),
      slotting_w_relocation: +fd.get('slotting_w_relocation'),
      expiry_alert_days: [30, 60, 90],
    });
    toast('Settings saved');
  } catch (err) { toast(err.message, 'error'); }
}

// ── View registry & init ──────────────────────────────────────────────────────
const VIEWS = {
  dashboard: viewDashboard,
  inventory: viewInventory,
  abc: viewABC,
  slotting: viewSlotting,
  picking: viewPicking,
  audit: viewAudit,
  settings: viewSettings,
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); showView(el.dataset.view); }));
  showView('dashboard');
});
