'use strict';
/* Calidrux — Overview: the warehouse at a glance */

function relTime(ts) {
  const t = new Date(ts.replace(' ', 'T') + 'Z');
  const s = Math.max(0, (Date.now() - t.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const ACT_ICON = {
  receive: '⤓', transfer: '⇄', adjust: '±', create: '＋', update: '✎', delete: '✕',
  status: '⏸', apply: '▤', accept: '✓', reject: '✕', complete: '✓',
};

function activityLine(a) {
  const what = {
    'inventory.receive': 'Stock received', 'inventory.transfer': 'Stock moved', 'inventory.adjust': 'Cycle-count adjustment',
    'batch.create': 'New lot registered', 'batch.status': 'Lot status changed', 'product.create': 'Product added',
    'product.update': 'Product updated', 'location.create': 'Slot created', 'location.update': 'Slot updated',
    'warehouse_layout.apply': 'Warehouse layout saved',
  }[`${a.entity_type}.${a.action}`] || `${a.entity_type.replace(/_/g, ' ')} · ${a.action}`;
  return what;
}

async function viewOverview() {
  const [dash, floor, exp, audit] = await Promise.all([
    whApi('GET', '/api/dashboard'),
    whApi('GET', '/api/warehouse/floor'),
    whApi('GET', '/api/warehouse/expiry'),
    whApi('GET', '/api/audit?limit=9'),
  ]);
  WH.floor = floor;
  const k = floor.kpis, kp = dash.kpis;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const b = Object.fromEntries(exp.buckets.map(x => [x.key, x]));
  const urgentLots = exp.items.filter(i => i.bucket === 'expired' || i.bucket === 'critical').length;

  const amb = floor.racks.filter(r => r.zone !== 'cold'), cold = floor.racks.filter(r => r.zone === 'cold');
  const fill = rs => { const q = rs.reduce((s, r) => s + r.quantity, 0), c = rs.reduce((s, r) => s + r.capacity, 0); return [q, c, c ? q / c : 0]; };
  const [aq, ac, au] = fill(amb), [cq, cc, cu] = fill(cold);

  const units = exp.buckets.reduce((s, x) => s + x.units, 0) || 1;
  const urgent = exp.items.filter(i => i.bucket === 'expired' || i.bucket === 'critical').slice(0, 6);

  const vc = document.getElementById('view-content');
  vc.innerHTML = `
    <div class="ov-hero">
      <div class="ov-date">${today}</div>
      <div class="ov-greet">${greet}.</div>
      <div class="ov-line"><b>${fmt(k.units)}</b> units of medicine across <b>${k.occupied_slots}</b> of ${k.slots} slots in ${esc(floor.layout.name)}.
        ${urgentLots ? `<b>${urgentLots}</b> stock line${urgentLots > 1 ? 's' : ''} expire within 30 days or already have.` : 'Nothing is close to expiry.'}</div>
      <div class="ov-actions">
        <button class="btn solid" onclick="showView('receive')">＋ Receive stock</button>
        <button class="btn" onclick="showView('floor')">Open floor map</button>
        <button class="btn" onclick="showView('expiry')">Expiry board</button>
        <button class="btn" onclick="showView('lab')">⚗ Optimization Lab</button>
        <button class="btn" onclick="openPalette()">Search <kbd>Ctrl K</kbd></button>
      </div>
    </div>

    <div class="ov-kpis">
      <div class="ov-kpi"><div class="k-top"><span class="k-label">Units stored</span><span class="k-ico">▦</span></div>
        <div class="k-val" data-count="${k.units}">0</div><div class="k-sub">${pct(k.utilization)} of capacity</div></div>
      <div class="ov-kpi"><div class="k-top"><span class="k-label">Stock value</span><span class="k-ico">$</span></div>
        <div class="k-val" data-money="${k.value}">$0</div><div class="k-sub">${k.skus} SKUs · ${k.batches} lots</div></div>
      <div class="ov-kpi" onclick="showView('floor')"><div class="k-top"><span class="k-label">Slots in use</span><span class="k-ico">▥</span></div>
        <div class="k-val"><span data-count="${k.occupied_slots}">0</span><small style="font-size:14px;color:var(--muted)"> / ${k.slots}</small></div>
        <div class="k-sub">open floor map →</div></div>
      <div class="ov-kpi cold"><div class="k-top"><span class="k-label">Cold room</span><span class="k-ico">❄</span></div>
        <div class="k-val" data-count="${Math.round(k.cold_utilization * 100)}" data-suffix="%">0%</div><div class="k-sub">2–8 °C capacity used</div></div>
      <div class="ov-kpi warn" onclick="WH.expiryFilter={bucket:'critical',q:'',zone:'all',hold:false};showView('expiry')">
        <div class="k-top"><span class="k-label">Expiring ≤ 30 d</span><span class="k-ico">◷</span></div>
        <div class="k-val" data-count="${k.critical_lines}">0</div><div class="k-sub">${money(b.critical.value)} at risk →</div></div>
      <div class="ov-kpi" onclick="showView('picking')"><div class="k-top"><span class="k-label">Open picks</span><span class="k-ico">↯</span></div>
        <div class="k-val" data-count="${kp.open_picks}">0</div><div class="k-sub">pick lists to work →</div></div>
    </div>

    <div class="ov-grid">
      <div class="card">
        <div class="card-title">Warehouse at a glance <a class="ov-link" onclick="showView('floor')">Open floor map →</a></div>
        <div id="ov-floor" class="wh-map-scroll"></div>
        <div class="wh-legend">${BUCKET_ORDER.map(x => `<span class="lg"><i style="background:${BUCKETS[x].color}"></i>${BUCKETS[x].label}</span>`).join('')}
          <span class="lg muted">Click a rack to look inside</span></div>
      </div>
      <div class="card">
        <div class="card-title">Expiry outlook <a class="ov-link" onclick="showView('expiry')">Expiry board →</a></div>
        <div class="ov-stack">${BUCKET_ORDER.map((x, i) => `<i style="width:${b[x].units / units * 100}%;background:${BUCKETS[x].color};animation-delay:${i * 90}ms" title="${BUCKETS[x].label}: ${fmt(b[x].units)} units"></i>`).join('')}</div>
        <div class="ov-legend">${BUCKET_ORDER.map(x => `<div style="--c:${BUCKETS[x].color}"><span>${BUCKETS[x].short}</span><b>${b[x].lines}</b>${money(b[x].value)}</div>`).join('')}</div>
        <div class="card-title" style="margin:6px 0 8px;font-size:12.5px">Act next</div>
        <div class="ov-urgent">${urgent.length ? urgent.map(i => `
          <button class="ov-u" onclick="openRack(${i.aisle},${i.bay},{highlight:${i.inventory_id}})">
            <i class="dot" style="background:${BUCKETS[i.bucket].color}"></i>
            <span class="m"><b>${esc(i.name)}</b><small>Lot ${esc(i.lot_number)} · ${esc(i.location_code)} · ${fmt(i.quantity)} u</small></span>
            <span class="d" style="color:${BUCKETS[i.bucket].color}">${daysText(i.days_left)}</span>
            ${i.status === 'quarantine' ? holdChip : ''}
          </button>`).join('') : '<div class="wh-muted">Nothing expires in the next 30 days. 🎉</div>'}</div>
      </div>
    </div>

    <div class="ov-grid2">
      <div class="card">
        <div class="card-title">Zone fill</div>
        <div class="ov-zone"><div class="ov-zone-h"><span>Ambient · 15–25 °C</span><span><b>${pct(au)}</b> · ${fmt(aq)} / ${fmt(ac)} u</span></div>
          <div class="ov-zone-bar"><i style="width:${Math.min(100, au * 100)}%"></i></div></div>
        <div class="ov-zone"><div class="ov-zone-h"><span>❄ Cold room · 2–8 °C</span><span><b>${pct(cu)}</b> · ${fmt(cq)} / ${fmt(cc)} u</span></div>
          <div class="ov-zone-bar cold"><i style="width:${Math.min(100, cu * 100)}%;animation-delay:.15s"></i></div></div>
        <div class="ov-zone"><div class="ov-zone-h"><span>Lots on quality hold</span><span><b>${exp.quarantine.lines}</b> lines · ${fmt(exp.quarantine.units)} u</span></div>
          <div class="ov-zone-bar"><i style="width:${Math.min(100, exp.quarantine.units / units * 100 * 5)}%;background:linear-gradient(90deg,#a78bfa,#7c3aed);animation-delay:.3s"></i></div></div>
        <div class="wh-muted" style="margin-top:4px">${floor.aisles.length} aisles · ${floor.max_bays} bays · ${floor.max_levels} levels · layout set in <a class="ov-link" onclick="showView('layout')">Layout Designer</a></div>
      </div>
      <div class="card">
        <div class="card-title">Recent activity <a class="ov-link" onclick="showView('audit')">Audit log →</a></div>
        <div class="ov-act">${audit.length ? audit.map(a => `
          <div class="ov-a"><span class="ai">${ACT_ICON[a.action] || '•'}</span>
            <div class="am"><b>${esc(activityLine(a))}</b><div>${esc(a.notes || `${a.entity_type} #${a.entity_id ?? ''}`)} · ${esc(a.user_name)}</div></div>
            <time title="${esc(a.created_at)} UTC">${relTime(a.created_at)}</time></div>`).join('') : '<div class="wh-muted">No activity yet.</div>'}</div>
      </div>
    </div>`;

  $$('[data-count]', vc).forEach(el => countUp(el, +el.dataset.count, { suffix: el.dataset.suffix || '' }));
  $$('[data-money]', vc).forEach(el => countUp(el, +el.dataset.money, { format: money }));
  const host = $('#ov-floor');
  const zoom = Math.max(0.9, Math.min(2, (host.clientWidth - 70) / ((floor.max_bays || 8) * 33)));
  renderFloor(host, floor, { mode: 'expiry', compact: true, zoom, onRack: (a, bb) => openRack(a, bb) });
}

VIEWS.dashboard = viewOverview;
