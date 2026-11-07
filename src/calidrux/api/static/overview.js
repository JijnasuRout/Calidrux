'use strict';
/* Calidrux — G-001 Cover sheet
   Laid out like the cover of a drawing set: project block, key plan, a schedule of
   the numbers that matter, general notes about current conditions, the sheet index
   and the revision history (recent changes from the audit log). */

function relTime(ts) {
  const t = new Date(ts.replace(' ', 'T') + 'Z');
  const s = Math.max(0, (Date.now() - t.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function activityLine(a) {
  return {
    'inventory.receive': 'Stock received', 'inventory.transfer': 'Stock moved', 'inventory.adjust': 'Cycle-count adjustment',
    'batch.create': 'New lot registered', 'batch.status': 'Lot status changed', 'product.create': 'Product added',
    'product.update': 'Product updated', 'location.create': 'Slot created', 'location.update': 'Slot updated',
    'warehouse_layout.apply': 'Warehouse layout saved', 'pick_list.create': 'Pick list routed', 'pick_list.complete': 'Pick list completed',
  }[`${a.entity_type}.${a.action}`] || `${a.entity_type.replace(/_/g, ' ')}: ${a.action}`;
}

const sheetLink = (view, label) => `<a onclick="showView('${view}')">${label || SHEETS[view].no}</a>`;

async function viewOverview() {
  const [dash, floor, exp, audit, pm] = await Promise.all([
    whApi('GET', '/api/dashboard'), whApi('GET', '/api/warehouse/floor'), whApi('GET', '/api/warehouse/expiry'),
    whApi('GET', '/api/audit?limit=8'), whApi('GET', '/api/picking/metrics'),
  ]);
  WH.floor = floor;
  const k = floor.kpis, kp = dash.kpis;
  const b = Object.fromEntries(exp.buckets.map(x => [x.key, x]));
  const d = new Date();
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const held = exp.quarantine.lines;

  const notes = [];
  if (b.expired.lines) notes.push(`<span class="rl">${b.expired.lines} expired stock line${b.expired.lines > 1 ? 's are' : ' is'} still on the shelves (${money(b.expired.value)}). Put the lots on hold and arrange destruction.</span> See ${sheetLink('expiry')}.`);
  if (b.critical.lines) notes.push(`${b.critical.lines} stock lines expire within 30 days, worth ${money(b.critical.value)}. Pick these first or redistribute them. See ${sheetLink('expiry')}.`);
  if (held) notes.push(`${held} stock line${held > 1 ? 's are' : ' is'} on quality hold and excluded from picking until released.`);
  notes.push(`The cold room (2–8 °C) is at ${pct(k.cold_utilization)} of capacity; the building overall is at ${pct(k.utilization)}.`);
  if (pm.completed_picks) notes.push(`Optimized pick routes have averaged ${pm.distance_savings_pct}% less walking than aisle-by-aisle over ${pm.completed_picks} completed pick lists. See ${sheetLink('picking')}.`);
  notes.push(`What-if analysis of expiry risk, route savings and slotting is on ${sheetLink('lab')}.`);

  const sched = [
    ['Units stored', fmt(k.units), 'floor'],
    ['Stock value', money(k.value), 'floor'],
    ['Slots in use', `${k.occupied_slots} of ${k.slots}`, 'floor'],
    ['Products / lots in stock', `${k.skus} / ${k.batches}`, 'inventory'],
    ['Cold room fill', pct(k.cold_utilization), 'floor'],
    ['Lines expiring in 30 days', k.critical_lines, 'expiry', k.critical_lines > 0],
    ['Expired lines on shelf', k.expired_lines, 'expiry', k.expired_lines > 0],
    ['Open pick lists', kp.open_picks, 'picking'],
  ];

  const vc = document.getElementById('view-content');
  vc.innerHTML = `
    <div class="cv-head">
      <div>
        <div class="cv-title">${esc(floor.layout.name)}: inventory status</div>
        <div class="page-sub">${fmt(k.units)} units of medicine in ${k.occupied_slots} slots across ${floor.aisles.length} aisles, one of them a 2–8 °C cold room.</div>
      </div>
      <table class="cv-proj">
        <tr><td>Facility</td><td>${esc(floor.layout.name)}</td></tr>
        <tr><td>Issued</td><td>${date}</td></tr>
        <tr><td>Revision</td><td>${APP_VERSION}</td></tr>
        <tr><td>Prepared by</td><td>${DRAWN_BY}</td></tr>
        <tr><td>Status</td><td>Issued for operations</td></tr>
      </table>
    </div>

    <div class="cv-grid">
      <div class="card">
        <div class="card-title">Key plan</div>
        <div id="ov-floor" class="wh-map-scroll"></div>
        <div class="wh-legend">${BUCKET_ORDER.map(x => `<span class="lg"><i style="background:${BUCKETS[x].fill || BUCKETS[x].color}"></i>${BUCKETS[x].label}</span>`).join('')}
          <span class="lg muted">Click a rack for its elevation · full plan on ${sheetLink('floor')}</span></div>
      </div>
      <div class="card">
        <div class="card-title">Inventory schedule</div>
        <table class="cv-sched">${sched.map(([l, v, view, alert]) =>
          `<tr class="${alert ? 'alert' : ''}" onclick="showView('${view}')"><td>${l}</td><td>${v}</td></tr>`).join('')}</table>
      </div>
    </div>

    <div class="cv-grid2">
      <div class="card">
        <div class="card-title">General notes</div>
        <ol class="cv-notes">${notes.map(n => `<li>${n}</li>`).join('')}</ol>
      </div>
      <div class="card">
        <div class="card-title">Sheet index</div>
        <table class="cv-index">${Object.entries(SHEETS).map(([v, s]) =>
          `<tr onclick="showView('${v}')"><td>${s.no}</td><td>${s.title}</td></tr>`).join('')}</table>
      </div>
    </div>

    <div class="card" style="margin-top:22px">
      <div class="card-title">Revision history</div>
      ${audit.length ? `<table class="cv-rev"><thead><tr><th></th><th>When</th><th>Description</th><th>Detail</th><th>By</th></tr></thead><tbody>
        ${audit.map((a, i) => `<tr><td><span class="cv-delta">${audit.length - i}</span></td><td>${relTime(a.created_at)}</td>
          <td>${esc(activityLine(a))}</td><td>${esc(a.notes || '')}</td><td>${esc(a.user_name)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No changes recorded yet.</div>'}
    </div>`;

  const host = document.getElementById('ov-floor');
  const zoom = Math.max(0.9, Math.min(2, (host.clientWidth - 70) / ((floor.max_bays || 8) * 33)));
  renderFloor(host, floor, { mode: 'expiry', compact: true, zoom, onRack: (a, bb) => openRack(a, bb) });
}

VIEWS.dashboard = viewOverview;
