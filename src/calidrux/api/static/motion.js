'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Calidrux — motion layer
   Adds smooth transitions to every screen without each view knowing about it:
   staggered entrances, skeleton loading, a sliding sidebar pill, sliding tab
   and segment indicators, count-up numbers, spring toasts and chart defaults.
   ═══════════════════════════════════════════════════════════════════════════ */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const APP_VERSION = '0.6.0';

// ── Entrances ────────────────────────────────────────────────────────────────
const ENTER_SEL = [
  '.page-header', '.card', '.kpi-grid', '.metric-row', '.tabs', '.wh-kpis', '.wh-buckets',
  '.wh-recv', '.wh-lay', '.wh-empty-banner', '.ov-hero', '.ov-kpis', '.ov-grid', '.ov-grid2',
].join(',');

function enterAnimate(els) {
  return;  // drawing skin: no decorative entrances
  if (REDUCED) return;
  els.slice(0, 14).forEach((el, i) => {
    el.animate([
      { opacity: 0, transform: 'translateY(14px) scale(.992)', filter: 'blur(3px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
    ], { duration: 520, delay: i * 55, easing: EASE, fill: 'backwards' });
  });
}

function rowsAnimate(table) {
  return;  // drawing skin: tables appear at once
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
  return;  // drawing skin: numbers are printed, not animated
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
  return;  // drawing skin: active sheet is marked by a rule, not a moving pill
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
  const ico = icon({ success: 'circle-check', error: 'circle-alert', info: 'info' }[type] || 'circle-check');
  el.innerHTML = `<span class="t-ico">${ico}</span><span class="t-msg"></span><span class="t-bar"></span>`;
  el.querySelector('.t-msg').textContent = msg;
  box.appendChild(el);
  const life = type === 'error' ? 5200 : 3600;
  if (!REDUCED) {
    el.animate([{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
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
  const css = getComputedStyle(document.documentElement);
  const tok = n => css.getPropertyValue(n).trim();
  const INK = tok('--ink') || '#1B3A94', INK2 = tok('--ink-2') || '#4E6199';
  const d = Chart.defaults;
  d.font.family = "'B612', 'Segoe UI', sans-serif";
  d.font.size = 11;
  d.color = INK2;
  d.borderColor = tok('--line-faint') || '#DCE3F3';
  d.animation.duration = REDUCED ? 0 : 450;
  d.animation.easing = 'easeOutQuad';
  d.animation.delay = 0;
  Object.assign(d.plugins.tooltip, {
    backgroundColor: '#fff', titleColor: INK, bodyColor: INK, borderColor: INK, borderWidth: 1,
    padding: 8, cornerRadius: 0, titleFont: { weight: '700' }, boxPadding: 3,
  });
  d.plugins.legend.labels.usePointStyle = false;
  d.plugins.legend.labels.boxWidth = 14;
  d.plugins.legend.labels.boxHeight = 8;
  d.elements.bar.borderRadius = 0;
  d.elements.bar.borderWidth = 1;
  d.elements.bar.borderColor = INK;
  d.elements.line.borderWidth = 1.5;
  d.elements.point.radius = 2.5;
  d.scale.grid.color = tok('--line-faint') || '#DCE3F3';
  d.scale.border = { color: INK };

  // Older screens hard-code the previous palette; map those colors onto the theme
  // so every chart follows theme.css without editing each chart.
  const MAP = {
    '#1d4ed8': INK, '#2563eb': INK, '#0b2a6f': INK, '#1e3a8a': INK, '#3b82f6': '#3F5BB5',
    '#bfdbfe': '#C9D3EE', '#dbeafe': '#E3E9F7', '#93c5fd': tok('--line'), '#60a5fa': tok('--watch'),
    '#dc2626': tok('--redline'), '#ef4444': tok('--redline'), '#f97316': tok('--redline-2'),
    '#f59e0b': tok('--highlight'), '#16a34a': INK, '#22c55e': INK, '#94a3b8': tok('--line'),
  };
  const remap = v => (typeof v === 'string' && MAP[v.toLowerCase()]) || v;
  Chart.register({
    id: 'drawingPalette',
    beforeUpdate(chart) {
      for (const ds of chart.data.datasets) {
        for (const k of ['backgroundColor', 'borderColor', 'pointBackgroundColor']) {
          if (Array.isArray(ds[k])) ds[k] = ds[k].map(remap); else if (ds[k]) ds[k] = remap(ds[k]);
        }
        if (ds.type === 'line' || chart.config.type === 'line') { ds.tension = 0; }
        if (typeof ds.borderRadius === 'number') ds.borderRadius = 0;
      }
    },
  });
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
    b.innerHTML = `${icon('search')}
      <span>Find a sheet, lot or rack</span><kbd>Ctrl K</kbd>`;
    b.onclick = () => window.openPalette && openPalette();
    brand.after(b);
  }
  const foot = document.querySelector('.sidebar-footer');
  if (foot) foot.innerHTML = `<span>Pharma warehouse optimizer</span><span class="ver">Rev ${APP_VERSION}</span>`;

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
