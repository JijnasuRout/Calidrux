'use strict';
/* Calidrux — upgrades to the original screens:
   friendly pickers instead of raw IDs, animated pick-route map, slotting and audit polish. */

/* ── 1. Replace raw ID boxes with searchable dropdowns ─────────────────────── */
const ID_FIELDS = ['product_id', 'batch_id', 'location_id', 'from_location_id', 'to_location_id'];
let _refCache = null, _refAt = 0;

async function refData() {
  if (_refCache && Date.now() - _refAt < 15000) return _refCache;
  const [products, batches, locations] = await Promise.all([
    whApi('GET', '/api/products'), whApi('GET', '/api/batches'), whApi('GET', '/api/locations'),
  ]);
  _refCache = { products, batches, locations, pmap: Object.fromEntries(products.map(p => [p.id, p])) };
  _refAt = Date.now();
  return _refCache;
}

async function enhanceForm(form) {
  if (form.dataset.enhanced) return;
  const inputs = ID_FIELDS.map(n => form.querySelector(`input[name="${n}"]`)).filter(Boolean);
  if (!inputs.length) return;
  form.dataset.enhanced = '1';
  const d = await refData();
  const swap = (input, optionsHtml, placeholder) => {
    const sel = document.createElement('select');
    sel.name = input.name; sel.required = input.required;
    sel.innerHTML = `<option value="">${placeholder}</option>${optionsHtml}`;
    const label = input.closest('.form-group')?.querySelector('label');
    if (label) label.textContent = { product_id: 'Product', batch_id: 'Lot', location_id: 'Slot',
      from_location_id: 'From slot', to_location_id: 'To slot' }[input.name] || label.textContent;
    input.replaceWith(sel);
    return sel;
  };
  let productSel = null;
  for (const input of inputs) {
    if (input.name === 'product_id') {
      productSel = swap(input, d.products.map(p =>
        `<option value="${p.id}">${esc(p.sku)}, ${esc(p.name)}${p.storage_class === 'cold' ? ' (cold)' : ''}</option>`).join(''), 'Choose a product…');
    } else if (input.name === 'batch_id') {
      const sel = swap(input, '', 'Choose a lot…');
      const fill = () => {
        const pid = productSel ? +productSel.value : 0;
        const list = d.batches.filter(b => !pid || b.product_id === pid);
        sel.innerHTML = `<option value="">${pid ? 'Choose a lot…' : 'Pick a product first…'}</option>` + list.map(b =>
          `<option value="${b.id}">${esc(b.lot_number)}, ${esc(d.pmap[b.product_id]?.sku || '')}, exp ${b.expiry_date}${b.status !== 'active' ? ', ' + b.status : ''}</option>`).join('');
      };
      fill();
      if (productSel) productSel.addEventListener('change', fill);
    } else {
      swap(input, d.locations.map(l =>
        `<option value="${l.id}">${esc(l.code)}${l.zone_type === 'cold' ? ' (cold)' : ''}</option>`).join(''), 'Choose a slot…');
    }
  }
  form.addEventListener('submit', () => { _refCache = null; });
}

new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    (n.matches('form') ? [n] : n.querySelectorAll('form')).forEach(f => {
      if (f.closest('#inv-panel')) enhanceForm(f);
    });
  }
}).observe(document.getElementById('view-content'), { childList: true, subtree: true });


/* ── 2. Picking: multi-line pick lists + animated route on the floor plan ──── */
_renderPickPanel = async function (tab) {
  const el = document.getElementById('pick-panel');
  if (!el) return;
  if (tab !== 'lists') return _renderPickMetrics(el);
  const [picks, d] = await Promise.all([api('GET', '/api/picks'), refData()]);
  const stocked = new Set((await whApi('GET', '/api/warehouse/expiry')).items.filter(i => i.status === 'active' && i.days_left >= 0).map(i => i.product_id));
  const opts = d.products.filter(p => stocked.has(p.id)).map(p => `<option value="${p.id}">${esc(p.sku)}, ${esc(p.name)}</option>`).join('');
  const ref = `PL-${new Date().toISOString().slice(5, 10).replace('-', '')}-${String(picks.length + 1).padStart(3, '0')}`;
  el.innerHTML = `
    <div class="card">
      <div class="card-title">New pick list <span class="wh-muted">FEFO picks the oldest lot and OR-Tools orders the stops</span></div>
      <form id="pk-form" onsubmit="createPickList2(event)">
        <div class="form-grid" style="margin-bottom:12px"><div class="form-group"><label>Reference</label><input name="reference" value="${ref}" required></div></div>
        <div class="pk-lines" id="pk-lines"></div>
        <div class="btn-group" style="margin-top:12px">
          <button type="button" class="btn btn-ghost btn-sm" onclick="addPickLine()">${icon('plus')}Add line</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="randomPickLines()">${icon('dices')}Fill 6 random lines</button>
          <button class="btn btn-primary" type="submit" style="margin-left:auto">Create & route</button>
        </div>
      </form>
    </div>
    <div class="card">
      <div class="card-title">Pick lists</div>
      ${tbl(['Reference', 'Lines', 'Status', 'Optimized', 'Baseline', 'Saved', 'Created', ''], picks.map(p => {
        const save = p.baseline_distance_m ? Math.round((1 - p.optimized_distance_m / p.baseline_distance_m) * 100) : 0;
        return [
          `<strong>${esc(p.reference)}</strong>`, p.lines, badge(p.status, STATUS_BADGE),
          `${p.optimized_distance_m} m`, `${p.baseline_distance_m} m`,
          save > 0 ? `<span class="au-chip">−${save}%</span>` : '—', p.created_at,
          `<button class="btn btn-ghost btn-sm" onclick="showPickLines(${p.id})">View route</button>
           ${p.status === 'open' ? `<button class="btn btn-primary btn-sm" onclick="completePick(${p.id})">Complete</button>` : ''}`,
        ];
      }), 'No pick lists yet. Add lines above and select Create & route.')}
    </div>
    <div id="pick-lines-detail"></div>`;
  window._pkOpts = opts;
  addPickLine();
  if (picks.length && !el.dataset.auto) { el.dataset.auto = '1'; showPickLines(picks[0].id, false); }
};

function addPickLine(pid, qty) {
  const box = $('#pk-lines'); if (!box) return;
  const row = document.createElement('div');
  row.className = 'pk-line';
  row.innerHTML = `<div class="form-group"><label>Product</label><select name="pid" required><option value="">Choose a product…</option>${window._pkOpts}</select></div>
    <div class="form-group"><label>Units</label><input name="qty" type="number" min="1" step="1" value="${qty || 1}" required></div>
    <button type="button" class="pk-x" title="Remove line" onclick="this.parentElement.remove()">×</button>`;
  box.appendChild(row);
  if (pid) row.querySelector('select').value = pid;
}

function randomPickLines() {
  const box = $('#pk-lines'); if (!box) return;
  box.innerHTML = '';
  const ids = [...new DOMParser().parseFromString(`<select>${window._pkOpts}</select>`, 'text/html').querySelectorAll('option')].map(o => o.value);
  ids.sort(() => Math.random() - .5).slice(0, 6).forEach(id => addPickLine(id, 1 + Math.floor(Math.random() * 20)));
}

async function createPickList2(e) {
  e.preventDefault();
  const f = e.target;
  const lines = $$('.pk-line', f).map(r => ({ product_id: +r.querySelector('select').value, quantity: +r.querySelector('input').value }))
    .filter(l => l.product_id && l.quantity > 0);
  if (!lines.length) return toast('Add at least one line', 'error');
  const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Routing…';
  try {
    const pl = await api('POST', '/api/picks', { reference: f.reference.value, lines });
    const save = pl.baseline_distance_m ? Math.round((1 - pl.optimized_distance_m / pl.baseline_distance_m) * 100) : 0;
    toast(`${pl.reference}: ${pl.lines} stops, ${pl.optimized_distance_m} m${save > 0 ? `, ${save}% shorter than aisle-by-aisle` : ''}`);
    await _renderPickPanel('lists');
    showPickLines(pl.id);
  } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Create & route'; }
}

async function _renderPickMetrics(el) {
  const m = await api('GET', '/api/picking/metrics');
  el.innerHTML = `
    ${m.completed_picks ? '' : '<div class="wh-note" style="margin-bottom:14px">No completed pick lists yet. Complete one on the Pick lists tab to start tracking distance.</div>'}
    <div class="metric-row">
      ${metricItem('Completed picks', m.completed_picks)}
      ${metricItem('Avg picks / hour', m.avg_picks_per_hour)}
      ${metricItem('Avg optimized distance', m.avg_optimized_distance_m + ' m')}
      ${metricItem('Avg baseline distance', m.avg_baseline_distance_m + ' m')}
      ${metricItem('Distance savings', m.distance_savings_pct + '%')}
      ${metricItem('FEFO compliance', m.fefo_compliance_pct + '%')}
      ${metricItem('Error rate', m.error_rate_pct + '%')}
    </div>
    <div class="card"><div class="card-title">Route distance: optimized vs aisle-by-aisle</div>
      <div class="chart-container" style="height:240px"><canvas id="metrics-chart"></canvas></div></div>`;
  if (_metricsChart) { _metricsChart.destroy(); _metricsChart = null; }
  _metricsChart = new Chart(document.getElementById('metrics-chart'), {
    type: 'bar',
    data: { labels: ['Optimized route', 'Aisle-by-aisle baseline'],
      datasets: [{ data: [m.avg_optimized_distance_m, m.avg_baseline_distance_m], backgroundColor: ['#1d4ed8', '#bfdbfe'], borderRadius: 10, maxBarThickness: 90 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, title: { display: true, text: 'Average metres walked' } } } },
  });
}

showPickLines = async function (id, scroll = true) {
  const detail = document.getElementById('pick-lines-detail');
  if (!detail) return;
  const [pl, floor] = await Promise.all([api('GET', `/api/picks/${id}`), whApi('GET', '/api/warehouse/floor')]);
  const lines = [...pl.lines].sort((a, b) => a.sequence - b.sequence);
  const save = pl.baseline_distance_m ? Math.max(0, Math.round((1 - pl.optimized_distance_m / pl.baseline_distance_m) * 100)) : 0;
  detail.innerHTML = `
    <div class="card">
      <div class="card-title">Route for ${esc(pl.reference)} ${badge(pl.status, STATUS_BADGE)}
        <span class="pk-save"><b>${save}%</b> shorter, ${pl.optimized_distance_m} m vs ${pl.baseline_distance_m} m</span></div>
      <div class="pk-route-wrap" id="pk-wrap"><div id="pk-floor"></div><svg class="pk-svg" id="pk-svg"></svg></div>
      <div class="pk-legend"><span><i></i>Optimized route (OR-Tools)</span>
        <label class="wh-toggle"><input type="checkbox" id="pk-base" checked> <i class="b"></i>Aisle-by-aisle baseline</label>
        <button class="btn btn-ghost btn-sm" onclick="showPickLines(${id})">${icon('rotate-cw')}Replay route</button></div>
      <div style="margin-top:14px">${tbl(['Stop', 'Product', 'Lot', 'Expiry', 'Slot', 'Units', 'Picked'], lines.map(l => [
        `<b>${l.sequence}</b>`, `<strong>${esc(l.sku)}</strong> ${esc(l.product_name || '')}`, esc(l.lot_number), l.expiry_date,
        `<span class="wh-loc">${esc(l.location_code)}</span>`, fmt(l.quantity), l.picked ? icon('check') : '—']))}</div>
    </div>`;
  const host = $('#pk-floor');
  const zoom = Math.max(0.9, Math.min(2, (host.parentElement.clientWidth - 80) / ((floor.max_bays || 8) * 33)));
  renderFloor(host, floor, { mode: 'occupancy', compact: true, zoom, highlight: lines.map(l => ({ aisle: l.aisle, bay: l.bay })), onRack: (a, b) => openRack(a, b) });
  host.classList.add('no-anim');
  const draw = () => drawPickRoute(lines);
  requestAnimationFrame(draw);
  $('#pk-base').onchange = draw;
  if (scroll) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function pickPath(stops, wrap) {
  const W = wrap.getBoundingClientRect();
  const door = $('.wh-dock-door', wrap).getBoundingClientRect();
  const racks = $('.wh-row-racks', wrap).getBoundingClientRect();
  const sx = door.right - W.left + wrap.scrollLeft, sy = door.top + door.height / 2 - W.top + wrap.scrollTop;
  const lane = racks.left - W.left - 8 + wrap.scrollLeft;
  const pos = s => {
    const t = $(`.wh-rack[data-a="${s.aisle}"][data-b="${s.bay}"]`, wrap).getBoundingClientRect();
    return { x: t.left + t.width / 2 - W.left + wrap.scrollLeft, walk: t.bottom - W.top + 5 + wrap.scrollTop, top: t.bottom - W.top - 6 + wrap.scrollTop, cy: t.top + t.height / 2 - W.top + wrap.scrollTop };
  };
  let d = `M${sx},${sy} H${lane}`, row = null;
  for (const s of stops) {
    const p = pos(s);
    if (row !== s.aisle) { if (row !== null) d += ` H${lane}`; d += ` V${p.walk}`; row = s.aisle; }
    d += ` H${p.x} V${p.top} V${p.walk}`;
  }
  d += ` H${lane} V${sy} H${sx}`;
  return { d, pos };
}

function drawPickRoute(lines) {
  const wrap = $('#pk-wrap'), svg = $('#pk-svg');
  if (!wrap || !svg) return;
  svg.setAttribute('width', wrap.scrollWidth); svg.setAttribute('height', wrap.scrollHeight);
  const uniq = [];
  for (const l of lines) if (!uniq.some(u => u.aisle === l.aisle && u.bay === l.bay)) uniq.push(l);
  const opt = pickPath(uniq, wrap);
  const base = pickPath([...uniq].sort((a, b) => a.aisle - b.aisle || a.bay - b.bay), wrap);
  const showBase = $('#pk-base')?.checked;
  const labels = new Map();
  lines.forEach(l => { const k = `${l.aisle}-${l.bay}`; labels.set(k, [...(labels.get(k) || []), l.sequence]); });
  const stops = uniq.map((u, i) => {
    const p = opt.pos(u), txt = labels.get(`${u.aisle}-${u.bay}`).join(',');
    const r = 9 + Math.max(0, txt.length - 2) * 2.5;
    return `<circle cx="${p.x}" cy="${p.cy}" r="${r}" class="pk-stop" style="animation-delay:${300 + i * 160}ms"/>
      <text x="${p.x}" y="${p.cy + 3.5}" text-anchor="middle" class="pk-stop-t" style="animation-delay:${300 + i * 160}ms">${txt}</text>`;
  }).join('');
  svg.innerHTML = `
    ${showBase ? `<path d="${base.d}" class="pk-base" transform="translate(5,5)"/>` : ''}
    <path d="${opt.d}" class="pk-opt draw" pathLength="100"/>
    ${stops}
    <circle r="6" class="pk-walker"><animateMotion dur="${4 + uniq.length * 0.6}s" begin="1.4s" repeatCount="indefinite" path="${opt.d}"/></circle>`;
}


/* ── 3. Slotting: clearer recommendations, progress, animated decisions ────── */
viewSlotting = async function () {
  const recs = await api('GET', '/api/slotting/recommendations');
  const by = s => recs.filter(r => r.status === s).length;
  const pending = recs.filter(r => r.status === 'pending');
  document.getElementById('view-content').innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Slotting</h1>
        <div class="page-sub">OR-Tools assigns each product to the slot with the lowest combined cost — travel × ABC class, pick frequency, weight × level and relocation, while honouring cold-chain, quarantine and weight limits.</div></div>
      <button class="btn btn-primary" data-run-slotting onclick="runSlotting(this)">${icon('play')}Run solver</button>
    </div>
    <div id="slotting-msg"></div>
    <div class="kpi-grid">${kpiCard('Pending', by('pending'))}${kpiCard('Accepted', by('accepted'))}${kpiCard('Rejected', by('rejected'))}</div>
    <div class="card">
      <div class="card-title">Recommendations ${pending.length ? `<button class="btn btn-ghost btn-sm" onclick="acceptAllRecs()">Accept all ${pending.length}</button>` : ''}</div>
      ${tbl(['SKU', 'Move', 'Cost score', 'Why', 'Status', ''], recs.map(r => [
        `<strong>${esc(r.sku)}</strong>`,
        `<span class="sl-move"><span class="wh-loc">${esc(r.from_code)}</span><span class="arr">${icon('arrow-right')}</span><span class="wh-loc">${esc(r.to_code)}</span></span>`,
        r.cost_delta.toFixed(1), `<span class="wh-muted">${esc(r.reason || '')}</span>`, badge(r.status, STATUS_BADGE),
        r.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="decideRec(${r.id}, true, this)">Accept</button>
          <button class="btn btn-danger btn-sm" onclick="decideRec(${r.id}, false, this)">Reject</button>` : '',
      ]), 'No recommendations yet. Select Run solver to generate them.')}
    </div>`;
};

runSlotting = async function (btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Solving…'; }
  $('#slotting-msg').innerHTML = `<div class="card"><div class="card-title">Running the assignment solver…</div><div class="sl-progress"><i></i></div>
    <div class="wh-muted">Scoring every product against every compatible slot.</div></div>`;
  try {
    const res = await api('POST', '/api/slotting/run');
    toast(`${res.count} recommendation${res.count === 1 ? '' : 's'} generated`);
    viewSlotting();
  } catch (err) {
    toast(err.message, 'error'); $('#slotting-msg').innerHTML = '';
    if (btn) { btn.disabled = false; btn.innerHTML = `${icon('play')}Run solver`; }
  }
};

async function decideRec(id, accept, btn) {
  const tr = btn.closest('tr');
  try {
    await api('POST', `/api/slotting/${id}/${accept ? 'accept' : 'reject'}`);
    tr.classList.add('row-out');
    toast(accept ? 'Stock moved to the new slot' : 'Recommendation rejected', accept ? 'success' : 'info');
    setTimeout(viewSlotting, 420);
  } catch (err) { toast(err.message, 'error'); }
}

async function acceptAllRecs() {
  const recs = (await api('GET', '/api/slotting/recommendations?status=pending'));
  let ok = 0, fail = 0;
  for (const r of recs) { try { await api('POST', `/api/slotting/${r.id}/accept`); ok++; } catch { fail++; } }
  toast(`Accepted ${ok}${fail ? `, ${fail} could not be applied` : ''}`, fail ? 'info' : 'success');
  viewSlotting();
}


/* ── 4. Audit log: search, filter, readable times ───────────────────────── */
viewAudit = async function () {
  const logs = await api('GET', '/api/audit?limit=500');
  const types = [...new Set(logs.map(l => l.entity_type))].sort();
  document.getElementById('view-content').innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Audit log</h1><div class="page-sub">Every change, with who made it and when. Entries can't be edited or deleted.</div></div>
      <button class="btn btn-ghost" onclick="showView('audit')">${icon('rotate-cw')}Refresh</button>
    </div>
    <div class="card">
      <div class="au-tools">
        <div class="wh-search">${icon('search')}
          <input id="au-q" placeholder="Search notes, users, actions…"><span id="au-n"></span></div>
        <select id="au-type"><option value="">All entities</option>${types.map(t => `<option>${esc(t)}</option>`).join('')}</select>
      </div>
      <div id="au-table"></div>
    </div>`;
  const render = () => {
    const q = $('#au-q').value.trim().toLowerCase(), t = $('#au-type').value;
    const rows = logs.filter(l => (!t || l.entity_type === t) &&
      (!q || `${l.entity_type} ${l.action} ${l.user_name} ${l.notes || ''}`.toLowerCase().includes(q)));
    $('#au-n').textContent = `${rows.length} of ${logs.length}`;
    $('#au-table').innerHTML = tbl(['When', 'Entity', 'Action', 'User', 'Notes'], rows.slice(0, 300).map(l => [
      `<span title="${esc(l.created_at)} UTC">${relTime(l.created_at)}</span>`,
      `${esc(l.entity_type.replace(/_/g, ' '))} <span class="wh-muted">#${l.entity_id ?? '—'}</span>`,
      `<span class="au-chip ${esc(l.action)}">${esc(l.action)}</span>`, esc(l.user_name), esc(l.notes || '—'),
    ]), 'No matching entries.');
  };
  let tm;
  $('#au-q').oninput = () => { clearTimeout(tm); tm = setTimeout(render, 120); };
  $('#au-type').onchange = render;
  render();
};

/* Keep the registry pointing at the upgraded views. */
Object.assign(VIEWS, { slotting: viewSlotting, audit: viewAudit });
