'use strict';
/* Calidrux — command palette (Ctrl+K / ⌘K / "/")
   Jump to any screen, product, lot, rack or action from the keyboard. */

const PAL = { open: false, items: [], idx: 0, data: null, loadedAt: 0 };

const PAL_VIEWS = [
  ['dashboard', 'Overview', 'Today at a glance', '◎', 'home dashboard kpi'],
  ['floor', 'Floor Map', 'Every rack, coloured by expiry', '▦', 'warehouse map racks floor plan'],
  ['receive', 'Receive Stock', 'Log a delivery and put it away', '⤓', 'inbound goods receipt putaway'],
  ['expiry', 'Expiry Board', 'Lots by how soon they expire', '◷', 'fefo shelf life expiring expired'],
  ['layout', 'Layout Designer', 'Aisles, bays, levels and cold rooms', '▤', 'size configure warehouse'],
  ['abc', 'ABC Analysis', 'Pareto classification by usage value', '◔', 'pareto classify'],
  ['slotting', 'Slotting', 'OR-Tools slot assignment', '⇄', 'optimize optimise solver'],
  ['picking', 'Picking', 'FEFO pick lists and TSP routes', '↯', 'pick route tsp travel'],
  ['inventory', 'Inventory', 'Products, locations, lots and stock', '☰', 'products batches stock movements'],
  ['audit', 'Audit Log', 'Every change, append-only', '⌕', 'history gdp trail'],
  ['settings', 'Settings', 'User, dock position, weights', '⚙', 'preferences config'],
];

const PAL_ACTIONS = [
  ['Receive a delivery', 'Open the receiving flow', '＋', 'new receipt inbound', () => showView('receive')],
  ['Show expired lots', 'Expiry board filtered to expired', '!', 'expired quarantine hold', () => { WH.expiryFilter = { bucket: 'expired', q: '', zone: 'all', hold: false }; showView('expiry'); }],
  ['Show lots expiring in 30 days', 'Expiry board · ≤ 30 days', '◷', 'critical soon', () => { WH.expiryFilter = { bucket: 'critical', q: '', zone: 'all', hold: false }; showView('expiry'); }],
  ['Show the cold room', 'Floor map coloured by zone', '❄', 'cold chain fridge 2-8', () => { WH.mode = 'zone'; WH.query = ''; showView('floor'); }],
  ['Run ABC analysis', 'Classify every SKU now', '◔', 'pareto', async () => { showView('abc'); setTimeout(() => window.runABC && runABC(), 350); }],
  ['Run the slotting solver', 'Generate slot recommendations', '⇄', 'optimize', async () => { showView('slotting'); setTimeout(() => { const b = document.querySelector('[data-run-slotting]'); b && b.click(); }, 450); }],
];

async function palLoad() {
  if (PAL.data && Date.now() - PAL.loadedAt < 30000) return PAL.data;
  const [products, exp, floor] = await Promise.all([
    whApi('GET', '/api/products'), whApi('GET', '/api/warehouse/expiry'), whApi('GET', '/api/warehouse/floor'),
  ]);
  const lots = new Map();
  for (const i of exp.items) {
    const l = lots.get(i.batch_id);
    if (!l) lots.set(i.batch_id, { ...i, slots: 1, total: i.quantity, main: i });
    else { l.slots++; l.total += i.quantity; if (i.quantity > l.main.quantity) l.main = i; }
  }
  PAL.data = { products, lots: [...lots.values()], racks: floor.racks };
  PAL.loadedAt = Date.now();
  return PAL.data;
}

function palScore(hay, q) {
  if (!q) return 1;
  hay = hay.toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const w of words) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    s += i === 0 ? 3 : hay[i - 1] === ' ' || hay[i - 1] === '-' ? 2 : 1;
  }
  return s;
}

function palBuild(q) {
  const out = [];
  const take = (group, list, n) => {
    const scored = list.map(x => [palScore(x.hay, q), x]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, n);
    if (scored.length) out.push({ group }, ...scored.map(([, x]) => x));
  };
  take('Go to', PAL_VIEWS.map(([v, label, sub, ico, kw]) => ({
    label, sub, ico, hay: `${label} ${sub} ${kw}`, run: () => showView(v),
  })), q ? 5 : 11);
  take('Actions', PAL_ACTIONS.map(([label, sub, ico, kw, fn]) => ({ label, sub, ico, hay: `${label} ${sub} ${kw}`, run: fn })), q ? 4 : 3);
  if (q && PAL.data) {
    take('Products', PAL.data.products.map(p => ({
      label: p.name, sub: `${p.sku} · ${p.storage_class === 'cold' ? 'cold chain' : 'ambient'} · show on map`,
      ico: p.storage_class === 'cold' ? '❄' : '◼', tag: p.sku, hay: `${p.sku} ${p.name}`,
      run: () => { WH.query = p.sku; WH.mode = 'expiry'; showView('floor'); },
    })), 5);
    take('Lots', PAL.data.lots.map(l => ({
      label: `Lot ${l.lot_number}`, sub: `${l.name} · ${fmt(l.total)} units · ${daysText(l.days_left)}`,
      ico: '◉', icoColor: BUCKETS[l.bucket].color, tag: l.main.location_code,
      hay: `${l.lot_number} ${l.sku} ${l.name}`,
      run: () => openRack(l.main.aisle, l.main.bay, { highlight: l.main.inventory_id }),
    })), 5);
    take('Racks', PAL.data.racks.map(r => ({
      label: `Aisle ${pad2(r.aisle)} · Bay ${pad2(r.bay)}`,
      sub: r.quantity ? `${fmt(r.quantity)} units · ${pct(r.utilization)} full · ${r.skus.slice(0, 3).join(', ')}` : 'Empty',
      ico: '▥', tag: r.zone === 'cold' ? '❄ cold' : '',
      hay: `A${pad2(r.aisle)}-B${pad2(r.bay)} a${r.aisle} b${r.bay} aisle ${r.aisle} bay ${r.bay} rack ${r.levels.map(l => l.code).join(' ')}`,
      run: () => openRack(r.aisle, r.bay),
    })), 4);
  }
  return out;
}

function palRender() {
  const q = $('#cmdk-q').value.trim();
  const list = palBuild(q);
  PAL.items = list.filter(x => !x.group);
  PAL.idx = Math.min(PAL.idx, Math.max(0, PAL.items.length - 1));
  let k = -1;
  $('#cmdk-list').innerHTML = '<span class="cmdk-hl"></span>' + (list.length ? list.map(x => {
    if (x.group) return `<div class="cmdk-group">${x.group}</div>`;
    k++;
    return `<div class="cmdk-item" data-k="${k}">
      <span class="ci-ico" ${x.icoColor ? `style="color:${x.icoColor}"` : ''}>${x.ico}</span>
      <span class="ci-main"><b>${esc(x.label)}</b><small>${esc(x.sub || '')}</small></span>
      ${x.tag ? `<span class="ci-tag">${esc(x.tag)}</span>` : ''}
    </div>`;
  }).join('') : `<div class="cmdk-empty">No matches for “${esc(q)}”</div>`);
  palHighlight(false);
}

function palHighlight(scroll = true) {
  const items = $$('#cmdk-list .cmdk-item');
  items.forEach((el, i) => el.classList.toggle('on', i === PAL.idx));
  const on = items[PAL.idx], hl = $('#cmdk-list .cmdk-hl');
  if (!hl) return;
  if (!on) { hl.style.height = '0px'; return; }
  hl.style.transform = `translateY(${on.offsetTop}px)`;
  hl.style.height = on.offsetHeight + 'px';
  if (scroll) on.scrollIntoView({ block: 'nearest' });
}

async function openPalette() {
  if (PAL.open) return;
  PAL.open = true; PAL.idx = 0;
  tip(null);
  const wrap = document.createElement('div');
  wrap.className = 'cmdk-wrap';
  wrap.innerHTML = `<div class="cmdk" role="dialog" aria-label="Search">
    <div class="cmdk-in">
      <svg width="18" height="18" viewBox="0 0 20 20"><path fill="currentColor" d="M8 3a5 5 0 013.9 8.1l4 4-1.4 1.4-4-4A5 5 0 118 3zm0 2a3 3 0 100 6 3 3 0 000-6z"/></svg>
      <input id="cmdk-q" placeholder="Search screens, products, lots, racks…" autocomplete="off" spellcheck="false">
      <kbd>Esc</kbd>
    </div>
    <div class="cmdk-list" id="cmdk-list"></div>
    <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span>
      <span style="margin-left:auto">Try “insulin”, “A03”, or a lot number</span></div>
  </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  const input = $('#cmdk-q');
  input.focus();
  palRender();
  palLoad().then(() => { if (PAL.open) palRender(); }).catch(() => {});

  input.oninput = () => { PAL.idx = 0; palRender(); };
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) closePalette(); });
  $('#cmdk-list').addEventListener('mousemove', e => {
    const it = e.target.closest('.cmdk-item');
    if (it && +it.dataset.k !== PAL.idx) { PAL.idx = +it.dataset.k; palHighlight(false); }
  });
  $('#cmdk-list').addEventListener('click', e => { const it = e.target.closest('.cmdk-item'); if (it) palRun(+it.dataset.k); });
  wrap.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); PAL.idx = (PAL.idx + 1) % Math.max(1, PAL.items.length); palHighlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); PAL.idx = (PAL.idx - 1 + PAL.items.length) % Math.max(1, PAL.items.length); palHighlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); palRun(PAL.idx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
  });
}

function palRun(i) {
  const it = PAL.items[i];
  if (!it) return;
  closePalette();
  setTimeout(() => it.run(), 120);
}

function closePalette() {
  const wrap = $('.cmdk-wrap');
  PAL.open = false;
  if (!wrap) return;
  wrap.classList.remove('show');
  setTimeout(() => wrap.remove(), 220);
}

document.addEventListener('keydown', e => {
  const typing = e.target.matches && e.target.matches('input, select, textarea');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); PAL.open ? closePalette() : openPalette(); }
  else if (e.key === '/' && !typing && !PAL.open) { e.preventDefault(); openPalette(); }
});
window.openPalette = openPalette;
