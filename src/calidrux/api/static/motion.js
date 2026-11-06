'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Calidrux — motion layer
   Adds smooth transitions to every screen without each view knowing about it:
   staggered entrances, skeleton loading, a sliding sidebar pill, sliding tab
   and segment indicators, count-up numbers, spring toasts and chart defaults.
   ═══════════════════════════════════════════════════════════════════════════ */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const APP_VERSION = '0.4.0';

// ── Entrances ────────────────────────────────────────────────────────────────
const ENTER_SEL = [
  '.page-header', '.card', '.kpi-grid', '.metric-row', '.tabs', '.wh-kpis', '.wh-buckets',
  '.wh-recv', '.wh-lay', '.wh-empty-banner', '.ov-hero', '.ov-kpis', '.ov-grid', '.ov-grid2',
].join(',');

function enterAnimate(els) {
  if (REDUCED) return;
  els.slice(0, 14).forEach((el, i) => {
    el.animate([
      { opacity: 0, transform: 'translateY(14px) scale(.992)', filter: 'blur(3px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
    ], { duration: 520, delay: i * 55, easing: EASE, fill: 'backwards' });
  });
}

function rowsAnimate(table) {
  if (REDUCED) return;
  [...table.querySelectorAll('tbody tr')].slice(0, 28).forEach((tr, i) => {
    tr.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 360, delay: 120 + i * 18, easing: EASE, fill: 'backwards' });
  });
}

function topLevelMatches(node) {
  if (node.matches(ENTER_SEL)) return [node];
  return [...node.querySelectorAll(ENTER_SEL)].filter(el => {
    const parent = el.parentElement.closest(ENTER_SEL);
    return !parent || !node.contains(parent);
  });
}

// ── Count-up numbers for any .kpi-value / .metric-value ─────────────────────
function countUpText(el) {
  if (REDUCED || el.dataset.counted) return;
  const raw = el.textContent.trim();
  const m = raw.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!m) return;
  el.dataset.counted = '1';
  const [, pre, num, post] = m;
  const target = parseFloat(num.replace(/,/g, ''));
  if (!isFinite(target) || target === 0) return;
  const dec = (num.split('.')[1] || '').length;
  const comma = num.includes(',') || Math.abs(target) >= 1000;
  const t0 = performance.now(), dur = 900;
  const tick = now => {
    const t = Math.min(1, (now - t0) / dur), v = target * (1 - Math.pow(1 - t, 3));
    el.textContent = pre + (comma ? v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec)) + post;
    if (t < 1) requestAnimationFrame(tick); else el.textContent = raw;
  };
  requestAnimationFrame(tick);
}

// ── Sliding indicators ───────────────────────────────────────────────────────
function placeIndicator(host, active, cls, readyAfter = true) {
  let ink = host.querySelector(':scope > .' + cls);
  if (!ink) {
    ink = document.createElement('span');
    ink.className = cls;
    host.prepend(ink);
  }
  if (!active) { ink.style.width = '0px'; return; }
  ink.style.transform = `translateX(${active.offsetLeft}px)`;
  ink.style.width = active.offsetWidth + 'px';
  if (readyAfter && !ink.classList.contains('ready')) requestAnimationFrame(() => ink.classList.add('ready'));
}

function syncIndicators() {
  document.querySelectorAll('.tabs').forEach(t => {
    t.classList.add('has-ink');
    placeIndicator(t, t.querySelector('.tab.active'), 'tab-ink');
  });
  document.querySelectorAll('.wh-seg').forEach(s => {
    s.classList.add('has-thumb');
    placeIndicator(s, s.querySelector('button.on'), 'seg-thumb');
  });
}

function placeNavPill(view) {
  const nav = document.querySelector('.nav');
  const item = nav && nav.querySelector(`.nav-item[data-view="${view}"]`);
  if (!nav || !item) return;
  let pill = nav.querySelector('.nav-pill');
  if (!pill) { pill = document.createElement('span'); pill.className = 'nav-pill'; nav.prepend(pill); nav.classList.add('has-pill'); }
  pill.style.transform = `translateY(${item.offsetTop}px)`;
  pill.style.height = item.offsetHeight + 'px';
  if (!pill.classList.contains('ready')) requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.add('ready')));
}

// ── Skeleton while a view loads ──────────────────────────────────────────────
const SKELETON = `<div class="skel" aria-busy="true"><div class="skel-title"></div><div class="skel-sub"></div>
  <div class="skel-row"><i></i><i></i><i></i><i></i></div><div class="skel-block"></div></div>`;

// ── Toasts ───────────────────────────────────────────────────────────────────
toast = function (msg, type = 'success') {
  const box = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  const ico = { success: '✓', error: '!', info: 'i' }[type] || '✓';
  el.innerHTML = `<span class="t-ico">${ico}</span><span class="t-msg"></span><span class="t-bar"></span>`;
  el.querySelector('.t-msg').textContent = msg;
  box.appendChild(el);
  const life = type === 'error' ? 5200 : 3600;
  if (!REDUCED) {
    el.animate([
      { opacity: 0, transform: 'translateY(18px) scale(.94)' },
      { opacity: 1, transform: 'translateY(-3px) scale(1.01)', offset: .7 },
      { opacity: 1, transform: 'none' },
    ], { duration: 520, easing: EASE });
  }
  const bar = el.querySelector('.t-bar').animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: life, easing: 'linear' });
  el.onmouseenter = () => bar.pause();
  el.onmouseleave = () => bar.play();
  bar.onfinish = () => {
    const h = el.offsetHeight;
    el.animate([
      { opacity: 1, transform: 'none', height: h + 'px', marginTop: '0px' },
      { opacity: 0, transform: 'translateX(40px) scale(.96)', height: '0px', marginTop: '-10px', paddingTop: '0px', paddingBottom: '0px' },
    ], { duration: 380, easing: EASE, fill: 'forwards' }).onfinish = () => el.remove();
  };
  el.onclick = () => bar.finish();
};

// ── Chart.js defaults: one look and one motion for every chart ───────────────
if (window.Chart) {
  const d = Chart.defaults;
  d.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";
  d.color = '#5a6f94';
  d.borderColor = '#e6eefb';
  d.animation.duration = REDUCED ? 0 : 1000;
  d.animation.easing = 'easeOutQuart';
  d.animation.delay = ctx => (ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 28 : 0);
  Object.assign(d.plugins.tooltip, {
    backgroundColor: 'rgba(11,42,111,.92)', padding: 10, cornerRadius: 10, titleFont: { weight: '700' },
    boxPadding: 4, displayColors: true,
  });
  d.plugins.legend.labels.usePointStyle = true;
  d.elements.bar.borderRadius = 6;
}

// ── Wire it up ───────────────────────────────────────────────────────────────
(function initMotion() {
  // Wrap the view switcher: pill, skeleton, scroll reset.
  const prevShow = showView;
  showView = function (name) {
    placeNavPill(name);
    const main = document.querySelector('.main');
    if (main) main.scrollTo({ top: 0, behavior: 'instant' });
    const r = prevShow(name);
    const vc = document.getElementById('view-content');
    if (vc && vc.querySelector('.spinner-wrap') && vc.children.length === 1) vc.innerHTML = SKELETON;
    return r;
  };

  // Animate whatever a view renders.
  const vc = document.getElementById('view-content');
  const mo = new MutationObserver(muts => {
    const added = [];
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || n.closest('.skel')) continue;
        added.push(...topLevelMatches(n));
        (n.matches('table') ? [n] : n.querySelectorAll('table')).forEach(rowsAnimate);
        (n.matches('.kpi-value, .metric-value') ? [n] : n.querySelectorAll('.kpi-value, .metric-value')).forEach(countUpText);
      }
    }
    if (added.length) enterAnimate([...new Set(added)]);
    requestAnimationFrame(syncIndicators);
  });
  mo.observe(vc, { childList: true, subtree: true });

  document.addEventListener('click', () => { requestAnimationFrame(syncIndicators); setTimeout(syncIndicators, 60); }, true);
  window.addEventListener('resize', () => { syncIndicators(); const a = document.querySelector('.nav-item.active'); if (a) placeNavPill(a.dataset.view); });

  // Sidebar extras: search button and version.
  const brand = document.querySelector('.brand');
  if (brand && !document.querySelector('.nav-search')) {
    const b = document.createElement('button');
    b.className = 'nav-search';
    b.type = 'button';
    b.innerHTML = `<svg width="14" height="14" viewBox="0 0 20 20"><path fill="currentColor" d="M8 3a5 5 0 013.9 8.1l4 4-1.4 1.4-4-4A5 5 0 118 3zm0 2a3 3 0 100 6 3 3 0 000-6z"/></svg>
      <span>Search</span><kbd>Ctrl K</kbd>`;
    b.onclick = () => window.openPalette && openPalette();
    brand.after(b);
  }
  const foot = document.querySelector('.sidebar-footer');
  if (foot) foot.innerHTML = `<span>Pharma WH Optimizer</span><span class="ver">v${APP_VERSION}</span>`;

  // Launch splash: leave once the first screen has painted.
  const splash = document.getElementById('splash');
  if (splash) {
    const t0 = performance.now();
    const hide = () => setTimeout(() => { splash.classList.add('out'); setTimeout(() => splash.remove(), 700); },
      Math.max(0, (REDUCED ? 0 : 900) - (performance.now() - t0)));
    const watch = new MutationObserver(() => {
      if (!vc.querySelector('.skel, .spinner-wrap')) { watch.disconnect(); hide(); }
    });
    watch.observe(vc, { childList: true, subtree: true });
    setTimeout(hide, 4000);
  }
})();
