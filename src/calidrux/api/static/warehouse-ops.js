'use strict';
/* Calidrux — Warehouse Operations: Receive & put-away · Expiry board · Layout designer */

/* ═══════════════════════════════════════════════════════════════════════════
   View: Receive & put away
   ═══════════════════════════════════════════════════════════════════════════ */

async function viewReceive() {
  const [products, floor, receipts] = await Promise.all([
    whApi('GET', '/api/products'),
    whApi('GET', '/api/warehouse/floor'),
    whApi('GET', '/api/warehouse/receipts'),
  ]);
  WH.floor = floor;
  WH.receive = { products, suggestion: null, suggestions: [], lots: {} };
  const vc = document.getElementById('view-content');
  vc.innerHTML = `
    <div class="wh-view">
    <div class="page-header">
      <div><h1 class="page-title">Receiving &amp; put-away</h1>
        <div class="page-sub">Log an incoming delivery. Calidrux checks temperature zone, space and lot rules, then picks the best slot and shows the route from the dock.</div></div>
      <button class="btn btn-ghost" onclick="showView('floor')">Open floor plan</button>
    </div>
    <div class="wh-recv">
      <div class="card wh-recv-form">
        <div class="wh-step"><span>1</span>What's arriving</div>
        <form id="rcv-form" autocomplete="off" onsubmit="return false">
          <div class="form-group"><label>Product</label>
            <select name="product_id" required>
              <option value="">Select a product…</option>
              ${products.map(p => `<option value="${p.id}">${esc(p.sku)}, ${esc(p.name)}${p.storage_class === 'cold' ? ' (cold)' : ''}</option>`).join('')}
            </select></div>
          <div id="rcv-prod"></div>
          <div class="wh-form2">
            <div class="form-group"><label>Lot number</label><input name="lot" list="rcv-lots" required placeholder="e.g. LOT-24A117"></div>
            <div class="form-group"><label>Expiry date</label><input name="expiry" type="date" required></div>
            <div class="form-group"><label>Quantity (units)</label><input name="qty" type="number" min="1" step="1" required placeholder="0"></div>
            <div class="form-group"><label>Reference (PO / ASN)</label><input name="ref" placeholder="Optional"></div>
          </div>
          <datalist id="rcv-lots"></datalist>
          <div id="rcv-note"></div>
        </form>
        <div class="wh-step"><span>2</span>Where it goes</div>
        <div id="rcv-sugs" class="wh-sugs"><div class="wh-muted wh-pad">Choose a product and enter a quantity to see the slots that can take it.</div></div>
        <button id="rcv-go" class="btn btn-primary wh-go" disabled onclick="confirmReceive()">Put away</button>
      </div>
      <div class="card wh-recv-map">
        <div class="card-title">Route from the dock <span id="rcv-dest" class="wh-muted"></span></div>
        <div class="wh-recv-mapwrap" id="rcv-wrap"><div id="rcv-floor"></div><svg id="rcv-path" class="wh-path"></svg></div>
        <div class="wh-legend">
          <span class="lg"><i style="background:var(--blue-600)"></i>Stored stock</span>
          <span class="lg"><i class="lg-target"></i>Chosen slot</span>
          <span class="lg"><i class="lg-cand"></i>Other good slots</span>
          <span class="lg muted">Click a highlighted rack to choose it</span>
        </div>
      </div>
    </div>
    <div class="card"><div class="card-title">Recent receipts</div><div id="rcv-recent">${receiptsTable(receipts)}</div></div>
    </div>`;

  const f = $('#rcv-form');
  f.product_id.onchange = onProductChange;
  f.lot.oninput = () => { onLotChange(); queueSuggest(); };
  f.qty.oninput = queueSuggest;
  f.expiry.oninput = updateGoButton;
  drawRecvMap();
}

function receiptsTable(rows) {
  if (!rows.length) return '<div class="empty">No receipts yet.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>When</th><th>Product</th><th>Lot</th><th>Units</th><th>Slot</th><th>Reference</th></tr></thead>
    <tbody>${rows.map(r => `<tr class="wh-click" onclick="openRack(${r.aisle},${r.bay})">
      <td>${esc(r.created_at)}</td><td><b>${esc(r.sku)}</b> ${esc(r.name)}</td><td>${esc(r.lot_number)}</td>
      <td>${fmt(r.quantity)}</td><td><span class="wh-loc">${esc(r.code)}</span></td><td>${esc(r.reference || '—')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function onProductChange() {
  const f = $('#rcv-form');
  const p = WH.receive.products.find(x => x.id === +f.product_id.value);
  WH.receive.product = p || null;
  WH.receive.lots = {};
  $('#rcv-lots').innerHTML = '';
  if (!p) { $('#rcv-prod').innerHTML = ''; queueSuggest(); return; }
  const maxF = Math.max(...WH.receive.products.map(x => x.pick_frequency_30d), 1);
  const v = p.pick_frequency_30d / maxF;
  const speed = v >= 0.5 ? 'Fast mover' : v >= 0.15 ? 'Medium mover' : 'Slow mover';
  $('#rcv-prod').innerHTML = `<div class="wh-prodinfo">
      ${p.storage_class === 'cold' ? `<span class="wh-chip cold">${icon('snowflake')}Cold chain: goes to the cold room</span>` : '<span class="wh-chip ambient">Ambient storage</span>'}
      <span class="wh-chip">${speed}, ${fmt(p.pick_frequency_30d)} picks / 30 d</span>
      <span class="wh-chip">${p.weight_kg} kg / unit</span></div>`;
  const batches = await whApi('GET', `/api/batches?product_id=${p.id}`);
  batches.forEach(b => { WH.receive.lots[b.lot_number] = b; });
  $('#rcv-lots').innerHTML = batches.map(b => `<option value="${esc(b.lot_number)}">expires ${b.expiry_date}</option>`).join('');
  onLotChange();
  queueSuggest();
}

function onLotChange() {
  const f = $('#rcv-form');
  const b = WH.receive.lots[f.lot.value.trim()];
  const note = $('#rcv-note');
  if (b) {
    f.expiry.value = b.expiry_date; f.expiry.readOnly = true;
    note.innerHTML = `<div class="wh-note">This lot is already on file. Its expiry is fixed at <b>${fmtDate(b.expiry_date)}</b> and new units will be consolidated with it where possible.${b.status === 'quarantine' ? ' <b>This lot is on hold and cannot be received.</b>' : ''}</div>`;
  } else {
    if (f.expiry.readOnly) { f.expiry.readOnly = false; f.expiry.value = ''; }
    note.innerHTML = f.lot.value.trim() ? '<div class="wh-note new">New lot. It is created when you put it away.</div>' : '';
  }
  updateGoButton();
}

let _sugTimer;
function queueSuggest() { clearTimeout(_sugTimer); _sugTimer = setTimeout(runSuggest, 280); }

async function runSuggest() {
  const f = $('#rcv-form');
  if (!f) return;
  const pid = +f.product_id.value, qty = +f.qty.value;
  const box = $('#rcv-sugs');
  WH.receive.suggestion = null; WH.receive.suggestions = [];
  if (!pid || !(qty > 0)) {
    box.innerHTML = '<div class="wh-muted wh-pad">Pick a product and quantity — the best slots appear here.</div>';
    drawRecvMap(); updateGoButton(); return;
  }
  box.innerHTML = '<div class="wh-muted wh-pad">Checking every slot…</div>';
  try {
    const r = await whApi('POST', '/api/warehouse/putaway/suggest',
      { product_id: pid, quantity: qty, lot_number: f.lot.value.trim() || null });
    WH.receive.suggestions = r.suggestions;
    WH.receive.suggestion = r.suggestions[0] || null;
    if (!r.suggestions.length) {
      box.innerHTML = `<div class="wh-note warn">${esc(r.message)}</div>`;
    } else renderSuggestions();
  } catch (e) {
    box.innerHTML = `<div class="wh-note warn">${esc(e.message)}</div>`;
  }
  drawRecvMap(); updateGoButton();
}

function renderSuggestions() {
  const qty = +$('#rcv-form').qty.value;
  const cur = WH.receive.suggestion;
  $('#rcv-sugs').innerHTML = WH.receive.suggestions.map((s, i) => {
    const before = s.current_qty / s.capacity * 100, add = qty / s.capacity * 100;
    return `<button type="button" class="wh-sug ${cur && cur.location_id === s.location_id ? 'on' : ''}" data-i="${i}" style="--i:${i}">
      <div class="wh-sug-top"><span class="wh-sug-code">${esc(s.code)}</span>${i === 0 ? '<span class="wh-sug-best">Best match</span>' : ''}
        <span class="wh-sug-dist">${s.distance_m} m</span></div>
      <div class="wh-sug-meta">Aisle ${s.aisle}, Bay ${s.bay}, Level ${s.level}, ${fmt(s.free)} free</div>
      <div class="wh-sug-bar"><i style="width:${before}%"></i><b style="left:${before}%;width:${Math.min(add, 100 - before)}%"></b></div>
      <div class="wh-sug-tags">${s.reasons.map(t => `<span>${esc(t)}</span>`).join('')}</div>
    </button>`;
  }).join('');
  $('#rcv-sugs').onclick = e => {
    const b = e.target.closest('.wh-sug'); if (!b) return;
    WH.receive.suggestion = WH.receive.suggestions[+b.dataset.i];
    $$('.wh-sug').forEach(x => x.classList.toggle('on', x === b));
    drawRecvMap(); updateGoButton();
  };
}

function updateGoButton() {
  const f = $('#rcv-form'), btn = $('#rcv-go');
  if (!f || !btn) return;
  const s = WH.receive.suggestion;
  const lot = WH.receive.lots[f.lot.value.trim()];
  const ok = s && f.lot.value.trim() && f.expiry.value && +f.qty.value > 0 && !(lot && lot.status === 'quarantine');
  btn.disabled = !ok;
  btn.innerHTML = s ? `Put away ${fmt(+f.qty.value)} units in <b>${esc(s.code)}</b>` : 'Put away';
  const dest = $('#rcv-dest');
  if (dest) dest.innerHTML = s ? `${icon('arrow-right')}${s.code}, ${s.distance_m} m from the dock` : '';
}

function drawRecvMap() {
  const el = $('#rcv-floor'); if (!el) return;
  const s = WH.receive.suggestion;
  const avail = ($('#rcv-wrap')?.clientWidth || 600) - 80;
  const zoom = Math.max(0.9, Math.min(2.2, avail / ((WH.floor.max_bays || 8) * 33)));
  renderFloor(el, WH.floor, {
    mode: 'occupancy', compact: true, noTip: false, zoom,
    selected: s ? { aisle: s.aisle, bay: s.bay } : null,
    highlight: WH.receive.suggestions.map(x => ({ aisle: x.aisle, bay: x.bay })),
    onRack: (a, b) => {
      const pick = WH.receive.suggestions.find(x => x.aisle === a && x.bay === b);
      if (!pick) return toast(WH.receive.suggestions.length ? 'No suitable slot in that rack (zone, space or another product).' : 'Choose a product and quantity first.', 'info');
      WH.receive.suggestion = pick;
      renderSuggestions(); drawRecvMap(); updateGoButton();
    },
  });
  requestAnimationFrame(drawRoute);
}

function routePoints() {
  const wrap = $('#rcv-wrap'), s = WH.receive.suggestion;
  if (!wrap || !s) return null;
  const tile = $(`.wh-rack[data-a="${s.aisle}"][data-b="${s.bay}"]`, wrap);
  const door = $('.wh-dock-door', wrap);
  if (!tile || !door) return null;
  const W = wrap.getBoundingClientRect(), T = tile.getBoundingClientRect(), D = door.getBoundingClientRect();
  const sx = D.right - W.left, sy = D.top + D.height / 2 - W.top;
  const tx = T.left + T.width / 2 - W.left, tb = T.bottom - W.top;
  const laneX = T.left - W.left - 10 - (s.bay - 1) * 0;  // cross-aisle just left of the racks
  const firstRack = $('.wh-row-racks', wrap).getBoundingClientRect().left - W.left - 8;
  const walkY = tb + 5;
  return { sx, sy, tx, ty: tb - 2, walkY, laneX: Math.min(laneX, firstRack) };
}

function drawRoute() {
  const svg = $('#rcv-path'), wrap = $('#rcv-wrap');
  if (!svg || !wrap) return;
  const p = routePoints();
  svg.setAttribute('width', wrap.scrollWidth); svg.setAttribute('height', wrap.scrollHeight);
  if (!p) { svg.innerHTML = ''; return; }
  const d = `M${p.sx},${p.sy} H${p.laneX} V${p.walkY} H${p.tx} V${p.ty}`;
  svg.innerHTML = `
    <path d="${d}" class="wh-route-base"/>
    <path d="${d}" class="wh-route" pathLength="100"/>
    <circle r="5" class="wh-route-dot"><animateMotion dur="2.6s" repeatCount="indefinite" path="${d}" rotate="auto"/></circle>
    <circle cx="${p.sx}" cy="${p.sy}" r="6" class="wh-route-start"/>
    <circle cx="${p.tx}" cy="${p.ty}" r="7" class="wh-route-end"/>`;
}

async function confirmReceive() {
  const f = $('#rcv-form'), s = WH.receive.suggestion;
  if (!s) return;
  const body = {
    product_id: +f.product_id.value, lot_number: f.lot.value.trim(), expiry_date: f.expiry.value,
    quantity: +f.qty.value, location_id: s.location_id, reference: f.ref.value.trim() || null,
  };
  const btn = $('#rcv-go'); btn.disabled = true;
  let res;
  try { res = await whApi('POST', '/api/warehouse/receive', body); }
  catch (e) { toast(e.message, 'error'); btn.disabled = false; return; }

  await flyBox(s);
  const p = WH.receive.product;
  toast(`Stored ${fmt(body.quantity)} × ${p.name} in ${res.code}`);
  [WH.floor] = await Promise.all([whApi('GET', '/api/warehouse/floor')]);
  $('#rcv-recent').innerHTML = receiptsTable(await whApi('GET', '/api/warehouse/receipts'));
  WH.receive.suggestions = []; WH.receive.suggestion = null;
  $('#rcv-sugs').innerHTML = `
    <div class="wh-success">
      <div class="wh-success-icon">${icon('check')}</div>
      <div><b>${fmt(body.quantity)} units of ${esc(p.name)}</b><div>Lot ${esc(body.lot_number)} stored in <b>${esc(res.code)}</b>${res.batch_created ? '. New lot created.' : ''}</div></div>
      <div class="btn-group">
        <button class="btn btn-ghost btn-sm" onclick="openRack(${res.aisle}, ${res.bay}, { batch: ${res.batch_id}, location: ${res.location_id} })">Open rack</button>
        <button class="btn btn-primary btn-sm" onclick="resetReceive()">Receive another</button>
      </div>
    </div>`;
  WH.receive.last = { aisle: res.aisle, bay: res.bay };
  const avail = ($('#rcv-wrap')?.clientWidth || 600) - 80;
  renderFloor($('#rcv-floor'), WH.floor, { mode: 'occupancy', compact: true, highlight: [], selected: { aisle: res.aisle, bay: res.bay },
    zoom: Math.max(0.9, Math.min(2.2, avail / ((WH.floor.max_bays || 8) * 33))),
    onRack: (a, b) => openRack(a, b) });
  const t = $(`#rcv-floor .wh-rack[data-a="${res.aisle}"][data-b="${res.bay}"]`);
  if (t) t.classList.add('flash');
  $('#rcv-path').innerHTML = '';
  updateGoButton();
}

function resetReceive() {
  const f = $('#rcv-form');
  f.lot.value = ''; f.qty.value = ''; f.ref.value = ''; f.expiry.value = ''; f.expiry.readOnly = false;
  $('#rcv-note').innerHTML = '';
  if (f.product_id.value) onProductChange(); else queueSuggest();
  f.lot.focus();
}

function flyBox(s) {
  return new Promise(resolve => {
    const door = $('#rcv-wrap .wh-dock-door');
    const tile = $(`#rcv-floor .wh-rack[data-a="${s.aisle}"][data-b="${s.bay}"]`);
    if (!door || !tile) return resolve();
    const a = door.getBoundingClientRect(), b = tile.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'wh-fly';
    box.style.left = a.left + 'px'; box.style.top = (a.top + a.height / 2 - 14) + 'px';
    document.body.appendChild(box);
    const dx = b.left + b.width / 2 - a.left - 14, dy = b.top + b.height / 2 - a.top - a.height / 2;
    box.animate([
      { transform: 'translate(0,0) scale(.6) rotate(0deg)', opacity: 0 },
      { transform: `translate(${dx * 0.15}px, ${dy * 0.15 - 40}px) scale(1.15) rotate(-8deg)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${dx}px, ${dy - 30}px) scale(1) rotate(6deg)`, opacity: 1, offset: 0.8 },
      { transform: `translate(${dx}px, ${dy}px) scale(.4) rotate(0deg)`, opacity: 0 },
    ], { duration: 1100, easing: 'cubic-bezier(.45,.05,.3,1)' }).onfinish = () => {
      box.remove(); tile.classList.add('flash'); resolve();
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   View: Expiry board
   ═══════════════════════════════════════════════════════════════════════════ */

async function viewExpiry() {
  const data = await whApi('GET', '/api/warehouse/expiry');
  const vc = document.getElementById('view-content');
  vc.innerHTML = `
    <div class="wh-view">
    <div class="page-header">
      <div><h1 class="page-title">Expiry schedule</h1>
        <div class="page-sub">Every lot in the building, ordered by how soon it expires. Click any lot to see it on its shelf.</div></div>
      <button class="btn btn-ghost" onclick="showView('floor')">Open floor plan</button>
    </div>
    <div class="wh-buckets" id="exp-sum"></div>
    <div class="card">
      <div class="card-title">Expiry timeline <span class="wh-muted" id="exp-tl-note">bubble size shows units; axis runs 12 months from today</span></div>
      <div id="exp-tl" class="wh-timeline"></div>
    </div>
    <div class="card">
      <div class="wh-toolbar">
        <div class="wh-search">${icon('search')}
          <input id="exp-q" placeholder="Filter by product, SKU, lot or slot…" value="${esc(WH.expiryFilter.q)}"></div>
        <div class="wh-seg" id="exp-zone">${['all', 'ambient', 'cold'].map(z =>
          `<button data-z="${z}" class="${WH.expiryFilter.zone === z ? 'on' : ''}">${{ all: 'All zones', ambient: 'Ambient', cold: `${icon('snowflake')}Cold` }[z]}</button>`).join('')}</div>
        <label class="wh-toggle"><input type="checkbox" id="exp-hold" ${WH.expiryFilter.hold ? 'checked' : ''}> On hold only</label>
        <button class="btn btn-ghost btn-sm" id="exp-clear">Clear filters</button>
      </div>
      <div id="exp-board" class="wh-board"></div>
    </div>
    </div>`;
  let t;
  $('#exp-q').oninput = e => { clearTimeout(t); t = setTimeout(() => { WH.expiryFilter.q = e.target.value; renderExpiry(WH.expiry, false); }, 150); };
  $('#exp-zone').onclick = e => {
    const b = e.target.closest('[data-z]'); if (!b) return;
    WH.expiryFilter.zone = b.dataset.z;
    $$('#exp-zone button').forEach(x => x.classList.toggle('on', x === b));
    renderExpiry(WH.expiry, false);
  };
  $('#exp-hold').onchange = e => { WH.expiryFilter.hold = e.target.checked; renderExpiry(WH.expiry, false); };
  $('#exp-clear').onclick = () => { WH.expiryFilter = { bucket: null, q: '', zone: 'all', hold: false }; showView('expiry'); };
  renderExpiry(data, true);
  window.onresize = () => { if ($('#exp-tl')) renderTimeline(expFiltered(WH.expiry.items), false); };
}

function expFiltered(items) {
  const f = WH.expiryFilter, q = f.q.trim().toLowerCase();
  return items.filter(i =>
    (f.zone === 'all' || i.zone === f.zone) &&
    (!f.hold || i.status === 'quarantine') &&
    (!q || `${i.sku} ${i.name} ${i.lot_number} ${i.location_code}`.toLowerCase().includes(q)));
}

function renderExpiry(data, animate) {
  WH.expiry = data;
  const items = expFiltered(data.items);
  const focus = WH.expiryFilter.bucket;

  $('#exp-sum').innerHTML = data.buckets.map(b => {
    const m = BUCKETS[b.key];
    const rows = items.filter(i => i.bucket === b.key);
    const value = rows.reduce((s, i) => s + i.value, 0), units = rows.reduce((s, i) => s + i.quantity, 0);
    return `<button class="wh-bucket ${focus === b.key ? 'on' : ''} ${focus && focus !== b.key ? 'off' : ''}" data-k="${b.key}" style="--c:${m.color};--s:${m.soft}">
      <span class="wh-bucket-label"><i></i>${m.label}</span>
      <span class="wh-bucket-n" data-count="${rows.length}">${animate ? 0 : rows.length}</span>
      <span class="wh-bucket-sub">${fmt(units)} units, ${money(value)}${b.key === 'expired' || b.key === 'critical' ? ' at risk' : ''}</span>
    </button>`;
  }).join('');
  if (animate) $$('#exp-sum [data-count]').forEach(el => countUp(el, +el.dataset.count));
  $('#exp-sum').onclick = e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    WH.expiryFilter.bucket = WH.expiryFilter.bucket === b.dataset.k ? null : b.dataset.k;
    renderExpiry(WH.expiry, false);
  };

  renderTimeline(items, animate);

  $('#exp-board').innerHTML = BUCKET_ORDER.map(k => {
    const m = BUCKETS[k];
    const rows = items.filter(i => i.bucket === k);
    const shown = rows.slice(0, 60);
    return `<div class="wh-col ${focus && focus !== k ? 'off' : ''} ${focus === k ? 'on' : ''}" style="--c:${m.color};--s:${m.soft}">
      <div class="wh-col-head"><i></i>${m.label}<span>${rows.length}</span></div>
      <div class="wh-col-body">${shown.map((i, n) => xcard(i, n, animate)).join('') || '<div class="wh-col-empty">Nothing here</div>'}
        ${rows.length > shown.length ? `<div class="wh-col-more">+ ${rows.length - shown.length} more. Narrow the filter to see them.</div>` : ''}</div>
    </div>`;
  }).join('');
  $('#exp-board').onclick = async e => {
    const h = e.target.closest('[data-hold]');
    if (h) { e.stopPropagation(); return setHold(+h.dataset.hold, true); }
    const c = e.target.closest('.wh-xcard');
    if (c) openRack(+c.dataset.a, +c.dataset.b, { highlight: +c.dataset.inv });
  };
  if (focus) $(`.wh-col.on`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function xcard(i, n, animate) {
  const m = BUCKETS[i.bucket];
  const life = i.days_left < 0 ? 0 : Math.min(1, i.days_left / 365);
  const hold = i.status === 'quarantine';
  return `<div class="wh-xcard ${hold ? 'hold' : ''} ${animate ? 'anim' : ''}" style="--i:${Math.min(n, 20)}"
      data-a="${i.aisle}" data-b="${i.bay}" data-inv="${i.inventory_id}" tabindex="0">
    <div class="wh-xcard-top"><b>${esc(i.name)}</b>${i.zone === 'cold' ? `<span class="wh-snowflake" title="Cold room">${icon('snowflake')}</span>` : ''}</div>
    <div class="wh-xcard-sub">${esc(i.sku)}, Lot ${esc(i.lot_number)} ${hold ? holdChip : ''}</div>
    <div class="wh-xcard-bar"><i style="width:${life * 100}%;background:${m.color}"></i></div>
    <div class="wh-xcard-meta"><span style="color:${m.color};font-weight:600">${daysText(i.days_left)}</span><span>${fmtDate(i.expiry_date)}</span></div>
    <div class="wh-xcard-foot"><span class="wh-loc">${esc(i.location_code)}</span><span title="${money(i.value)}">${fmt(i.quantity)} units</span></div>
    ${i.bucket === 'expired' && !hold ? `<button class="btn btn-danger btn-sm wh-xcard-act" data-hold="${i.batch_id}">${icon('circle-pause')}Put lot on hold</button>` : ''}
  </div>`;
}

function renderTimeline(items, animate) {
  items = items.slice();
  const el = $('#exp-tl'); if (!el) return;
  const W = Math.max(640, el.clientWidth || 1000), H = 230, L = 18, R = 18, base = 150;
  const min = -45, max = 400;
  const x = d => L + (Math.max(min, Math.min(max, d)) - min) / (max - min) * (W - L - R);
  const focus = WH.expiryFilter.bucket;
  // One bubble per lot: a lot spread across several slots is still one expiry event.
  const lots = new Map();
  for (const i of items) {
    const l = lots.get(i.batch_id);
    if (!l) lots.set(i.batch_id, { ...i, slots: 1, main: i });
    else {
      l.quantity += i.quantity; l.value += i.value; l.slots++;
      if (i.quantity > l.main.quantity) l.main = i;
    }
  }
  items = [...lots.values()];
  const maxQ = Math.max(1, ...items.map(i => i.quantity));
  const bands = [
    [min, 0, '#fee2e2', 'Expired'], [0, 30, '#ffedd5', '≤30 d'], [30, 90, '#fef3c7', '31–90 d'],
    [90, 180, '#e0ecff', '91–180 d'], [180, max, '#eef4ff', '> 180 days'],
  ];
  // month ticks
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let ticks = '';
  for (let k = -1; k <= 14; k++) {
    const dt = new Date(today.getFullYear(), today.getMonth() + k, 1);
    const days = Math.round((dt - today) / 864e5);
    if (days < min || days > max) continue;
    ticks += `<line x1="${x(days)}" y1="${base + 34}" x2="${x(days)}" y2="${base + 40}" class="tl-tick"/>
      <text x="${x(days)}" y="${base + 54}" class="tl-tick-t" text-anchor="middle">${MONTHS[dt.getMonth()]}${dt.getMonth() === 0 ? ' ' + String(dt.getFullYear()).slice(2) : ''}</text>`;
  }
  // beeswarm layout
  const placed = [];
  const nodes = [...items].sort((a, b) => b.quantity - a.quantity).map(i => {
    const r = 4 + Math.sqrt(i.quantity / maxQ) * 13;
    const cx = x(i.days_left);
    let cy = base;
    for (let step = 0; step < 60; step++) {
      const off = Math.ceil(step / 2) * 5 * (step % 2 ? -1 : 1);
      cy = base - 48 + off;
      if (!placed.some(p => (p.cx - cx) ** 2 + (p.cy - cy) ** 2 < (p.r + r + 1.5) ** 2)) break;
    }
    cy = Math.max(26 + r, Math.min(base + 26 - r, cy));
    const n = { i, cx, cy, r }; placed.push(n); return n;
  }).sort((a, b) => a.i.days_left - b.i.days_left);

  el.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" class="tl-svg">
    ${bands.map(([a, b, c, t]) => `<rect x="${x(a)}" y="14" width="${x(b) - x(a)}" height="${base + 20}" fill="${c}" rx="4"/>
      ${x(b) - x(a) > 54 ? `<text x="${(x(a) + x(b)) / 2}" y="30" text-anchor="middle" class="tl-band-t">${t}</text>` : ''}`).join('')}
    <line x1="${L}" y1="${base + 34}" x2="${W - R}" y2="${base + 34}" class="tl-axis"/>
    ${ticks}
    <line x1="${x(0)}" y1="10" x2="${x(0)}" y2="${base + 40}" class="tl-today"/>
    <text x="${x(0)}" y="${H - 6}" text-anchor="middle" class="tl-today-t">Today</text>
    ${nodes.map((n, k) => `<circle cx="${n.cx}" cy="${n.cy}" r="${n.r}" fill="${BUCKETS[n.i.bucket].color}"
       class="tl-dot ${animate ? 'anim' : ''} ${focus && focus !== n.i.bucket ? 'off' : ''} ${n.i.status === 'quarantine' ? 'hold' : ''}"
       style="--d:${Math.min(k, 120) * 9}ms" data-k="${k}"/>`).join('')}
  </svg>`;
  const svg = $('svg', el);
  svg.onmousemove = e => {
    const c = e.target.closest('.tl-dot'); if (!c) return tip(null);
    const i = nodes[+c.dataset.k].i;
    tip(`<b>${esc(i.name)}</b><div>${esc(i.sku)}, Lot ${esc(i.lot_number)}</div>
      <div>${fmt(i.quantity)} units, ${money(i.value)}</div>
      <div><i class="sw" style="background:${BUCKETS[i.bucket].fill || BUCKETS[i.bucket].color}"></i>${daysText(i.days_left)}, ${fmtDate(i.expiry_date)}</div>
      <div class="tip-muted">${esc(i.main.location_code)}${i.slots > 1 ? ` + ${i.slots - 1} more slot${i.slots > 2 ? 's' : ''}` : ''}. Click to open the rack.</div>`, e);
  };
  svg.onmouseleave = () => tip(null);
  svg.onclick = e => {
    const c = e.target.closest('.tl-dot'); if (!c) return;
    const m = nodes[+c.dataset.k].i.main;
    openRack(m.aisle, m.bay, { highlight: m.inventory_id });
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   View: Layout designer
   ═══════════════════════════════════════════════════════════════════════════ */

const LAY_FIELDS = [
  ['aisles', 'Aisles', 1, 30, 'rows of racks'],
  ['bays_per_aisle', 'Bays per aisle', 1, 40, 'racks in each row'],
  ['levels', 'Levels per rack', 1, 8, 'shelves, floor to top'],
];

async function viewLayout() {
  const [lay, floor] = await Promise.all([whApi('GET', '/api/warehouse/layout'), whApi('GET', '/api/warehouse/floor')]);
  WH.floor = floor;
  WH.layoutBase = { ...lay.layout };
  WH.layoutDraft = { ...lay.layout, cold_aisles: [...lay.layout.cold_aisles] };
  const d = WH.layoutDraft;
  const vc = document.getElementById('view-content');
  vc.innerHTML = `
    <div class="wh-view">
    <div class="page-header">
      <div><h1 class="page-title">Layout</h1>
        <div class="page-sub">Set the size and zones of your warehouse. The preview updates live, and slots that hold stock are protected.</div></div>
    </div>
    ${lay.inferred ? `<div class="wh-note" style="margin-bottom:16px">This layout was detected from your existing storage slots. Applying it saves it as the official layout.</div>` : ''}
    <div class="wh-lay">
      <div class="card wh-lay-form">
        <div class="form-group"><label>Warehouse name</label><input id="lay-name" value="${esc(d.name)}"></div>
        ${LAY_FIELDS.map(([k, label, lo, hi, hint]) => `
          <div class="wh-ctl">
            <div class="wh-ctl-head"><label for="lay-${k}">${label}</label><span class="wh-ctl-hint">${hint}</span>
              <input type="number" class="wh-ctl-num" data-k="${k}" min="${lo}" max="${hi}" value="${d[k]}"></div>
            <input type="range" id="lay-${k}" data-k="${k}" min="${lo}" max="${hi}" value="${d[k]}">
          </div>`).join('')}
        <div class="wh-ctl">
          <div class="wh-ctl-head"><label>Cold-room aisles</label><span class="wh-ctl-hint">2–8 °C. Click an aisle to toggle it.</span></div>
          <div class="wh-coldpick" id="lay-cold"></div>
        </div>
        <div class="wh-form2">
          <div class="form-group"><label>Units per slot, ambient</label><input type="number" min="1" data-n="slot_capacity_units" value="${d.slot_capacity_units}"></div>
          <div class="form-group"><label>Units per slot, cold</label><input type="number" min="1" data-n="cold_slot_capacity_units" value="${d.cold_slot_capacity_units}"></div>
          <div class="form-group"><label>Max kg per slot, ambient</label><input type="number" min="1" data-n="max_weight_kg" value="${d.max_weight_kg}"></div>
          <div class="form-group"><label>Max kg per slot, cold</label><input type="number" min="1" data-n="cold_max_weight_kg" value="${d.cold_max_weight_kg}"></div>
          <div class="form-group"><label>Aisle spacing (m)</label><input type="number" min="0.5" step="0.1" data-n="aisle_spacing_m" value="${d.aisle_spacing_m}"></div>
          <div class="form-group"><label>Bay width (m)</label><input type="number" min="0.5" step="0.1" data-n="bay_width_m" value="${d.bay_width_m}"></div>
        </div>
        <div class="wh-lay-stats" id="lay-stats"></div>
        <div class="btn-group" style="margin-top:14px">
          <button class="btn btn-ghost" onclick="viewLayout()">Reset</button>
          <button class="btn btn-primary" id="lay-apply" onclick="applyLayout()">Apply layout</button>
        </div>
      </div>
      <div class="wh-lay-right">
        <div class="card">
          <div class="card-title">Live preview
            <span class="wh-legend inline"><span class="lg"><i class="lg-new"></i>New</span><span class="lg"><i class="lg-removed"></i>Removed</span>
            <span class="lg"><i style="background:var(--blue-600)"></i>Holds stock</span></span></div>
          <div class="wh-map-scroll"><div id="lay-floor"></div></div>
        </div>
        <div class="wh-lay-bottom">
          <div class="card"><div class="card-title">One rack, front view</div><div id="lay-elev" class="wh-lay-elev"></div></div>
          <div class="card"><div class="card-title">What will change</div><div id="lay-diff"></div></div>
        </div>
      </div>
    </div>
    </div>`;

  const form = $('.wh-lay-form');
  form.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'lay-name') d.name = t.value;
    if (t.dataset.k) {
      const k = t.dataset.k, f = LAY_FIELDS.find(x => x[0] === k);
      const v = Math.max(f[2], Math.min(f[3], Math.round(+t.value || f[2])));
      d[k] = v;
      $$(`[data-k="${k}"]`, form).forEach(o => { if (o !== t) o.value = v; });
      if (k === 'aisles') d.cold_aisles = d.cold_aisles.filter(a => a <= v);
    }
    if (t.dataset.n) d[t.dataset.n] = +t.value;
    layoutChanged();
  });
  layoutChanged(true);
}

let _layTimer;
function layoutChanged(first) {
  const d = WH.layoutDraft;
  $('#lay-cold').innerHTML = Array.from({ length: d.aisles }, (_, k) => k + 1).map(a =>
    `<button type="button" class="${d.cold_aisles.includes(a) ? 'on' : ''}" data-a="${a}">${d.cold_aisles.includes(a) ? icon('snowflake') : ''}A${pad2(a)}</button>`).join('');
  $('#lay-cold').onclick = e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = +b.dataset.a;
    d.cold_aisles = d.cold_aisles.includes(a) ? d.cold_aisles.filter(x => x !== a) : [...d.cold_aisles, a].sort((x, y) => x - y);
    layoutChanged();
  };
  const total = d.aisles * d.bays_per_aisle * d.levels;
  const cold = d.cold_aisles.length * d.bays_per_aisle * d.levels;
  const area = (d.aisles + 1) * d.aisle_spacing_m * (d.bays_per_aisle + 1) * d.bay_width_m;
  const cap = (total - cold) * d.slot_capacity_units + cold * d.cold_slot_capacity_units;
  $('#lay-stats').innerHTML = `
    <div><span>Storage slots</span><b>${fmt(total)}</b></div>
    <div><span>Cold slots</span><b>${fmt(cold)}</b></div>
    <div><span>Racks</span><b>${fmt(d.aisles * d.bays_per_aisle)}</b></div>
    <div><span>Total capacity</span><b>${fmt(cap)} u</b></div>
    <div><span>Floor area</span><b>${fmt(area)} m²</b></div>
    <div><span>Footprint</span><b>${fmt((d.aisles + 1) * d.aisle_spacing_m, 1)} × ${fmt((d.bays_per_aisle + 1) * d.bay_width_m, 1)} m</b></div>`;

  const preview = layoutPreviewData(d, WH.floor);
  const scroll = $('#lay-floor').parentElement;
  const zoom = Math.max(0.4, Math.min(1.2, (scroll.clientWidth - 150) / (preview.max_bays * 60)));
  renderFloor($('#lay-floor'), preview, { mode: 'occupancy', zoom, onRack: () => {} });
  $('#lay-floor').classList.toggle('no-anim', !first);
  $('#lay-elev').innerHTML = rackSvg({
    zone: 'ambient',
    levels: Array.from({ length: d.levels }, (_, k) => ({ level: k + 1, capacity: d.slot_capacity_units, items: [], utilization: 0 })),
  });
  clearTimeout(_layTimer);
  _layTimer = setTimeout(previewDiff, first ? 0 : 280);
}

function layoutPreviewData(d, floor) {
  const cur = new Map(floor.racks.map(r => [`${r.aisle}-${r.bay}`, r]));
  const aisles = new Map();
  const racks = [];
  for (let a = 1; a <= d.aisles; a++) {
    const zone = d.cold_aisles.includes(a) ? 'cold' : 'ambient';
    aisles.set(a, zone);
    for (let b = 1; b <= d.bays_per_aisle; b++) {
      const ex = cur.get(`${a}-${b}`);
      const levels = Array.from({ length: d.levels }, (_, k) => {
        const el = ex && ex.levels.find(l => l.level === k + 1);
        return { level: k + 1, utilization: el ? el.utilization : 0, bucket: el ? el.bucket : null };
      });
      const conflict = ex && ex.quantity > 0 && ex.zone !== zone;
      racks.push({ aisle: a, bay: b, zone, levels, quantity: ex ? ex.quantity : 0, capacity: ex ? ex.capacity : 0,
        utilization: ex ? ex.utilization : 0, skus: ex ? ex.skus : [], search: '',
        state: !ex ? 'new' : conflict ? 'removed' : null });
    }
  }
  for (const r of floor.racks) {
    if (r.aisle > d.aisles || r.bay > d.bays_per_aisle) {
      racks.push({ ...r, state: 'removed' });
      if (!aisles.has(r.aisle)) aisles.set(r.aisle, r.zone);
    }
  }
  return {
    aisles: [...aisles.entries()].sort((x, y) => x[0] - y[0]).map(([aisle, zone]) => ({ aisle, zone })),
    racks,
    max_bays: Math.max(d.bays_per_aisle, ...racks.map(r => r.bay)),
  };
}

async function previewDiff() {
  const box = $('#lay-diff'); if (!box) return;
  let plan;
  try { plan = await whApi('POST', '/api/warehouse/layout/preview', WH.layoutDraft); }
  catch (e) { box.innerHTML = `<div class="wh-note warn">${esc(e.message)}</div>`; $('#lay-apply').disabled = true; return; }
  WH.layoutPlan = plan;
  const s = plan.summary;
  box.innerHTML = `
    <div class="wh-diff">
      <div class="add"><b>+${fmt(s.add)}</b><span>slots added</span></div>
      <div><b>${fmt(s.keep)}</b><span>kept</span></div>
      <div class="rem"><b>−${fmt(s.remove)}</b><span>slots removed</span></div>
    </div>
    ${plan.blocked.length ? `<div class="wh-note warn"><b>${plan.blocked.length} slot${plan.blocked.length > 1 ? 's' : ''} block this change.</b> Move their stock first:
      <ul>${plan.blocked.slice(0, 6).map(b => `<li><b>${esc(b.code)}</b> ${esc(b.reason)}</li>`).join('')}${plan.blocked.length > 6 ? `<li>…and ${plan.blocked.length - 6} more</li>` : ''}</ul></div>` : ''}
    ${plan.warnings.length ? `<div class="wh-note"><b>Heads up:</b><ul>${plan.warnings.slice(0, 4).map(w => `<li><b>${esc(w.code)}</b> ${esc(w.reason)}</li>`).join('')}</ul></div>` : ''}
    ${!plan.blocked.length && !s.add && !s.remove ? '<div class="wh-muted">No slot changes. Capacity, weight and spacing settings are still saved.</div>' : ''}
    ${!plan.blocked.length && s.remove ? '<div class="wh-muted">Removed slots are empty. They are retired (kept for history), not deleted.</div>' : ''}`;
  $('#lay-apply').disabled = plan.blocked.length > 0;
}

async function applyLayout() {
  const d = WH.layoutDraft, s = WH.layoutPlan?.summary;
  const ok = await whModal({
    title: 'Apply this layout?',
    body: `<b>${esc(d.name)}</b>: ${d.aisles} aisles × ${d.bays_per_aisle} bays × ${d.levels} levels = <b>${fmt(s?.total_slots)}</b> slots
      (${fmt(s?.cold_slots)} cold).<br><br>+${fmt(s?.add)} slots added, −${fmt(s?.remove)} removed. All changes are recorded in the audit log.`,
    confirm: 'Apply layout',
  });
  if (!ok) return;
  try {
    const r = await whApi('PUT', '/api/warehouse/layout', d);
    toast(`Layout saved with ${fmt(r.summary.total_slots)} slots`);
    showView('floor');
  } catch (e) {
    if (e.status === 409) { toast('Some slots you are removing still hold stock. Move it first; the list shows where.', 'error'); previewDiff(); }
    else toast(e.message, 'error');
  }
}

/* ── Register views ──────────────────────────────────────────────────────── */
Object.assign(VIEWS, { floor: viewFloor, receive: viewReceive, expiry: viewExpiry, layout: viewLayout });
