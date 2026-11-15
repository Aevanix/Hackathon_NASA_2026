// ASTRA interface enhancements: accessible table controls, live sparklines, accent themes, and mobile navigation.
const $ = (s, r = document) => r.querySelector(s);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

/* Accent themes (persisted) */
const accents = ['cyan', 'green', 'amber', 'violet'];
const setAccent = (a) => { document.documentElement.dataset.accent = a; store.set('astra-accent', a); };
setAccent(accents.includes(store.get('astra-accent')) ? store.get('astra-accent') : 'cyan');

/* Sortable tables: pointer and keyboard users can sort; the current direction is announced. */
const sorts = new Map();
const tableSignature = (table) => [...table.tBodies[0].rows].map((row) => row.textContent.trim()).sort().join('\u0000');
function sortColumn(th, requestedDirection = '') {
  const table = th.closest('table'), tb = table.tBodies[0]; if (!tb) return;
  const i = [...th.parentNode.children].indexOf(th), dir = requestedDirection || (th.dataset.sort === 'asc' ? 'desc' : 'asc');
  table.querySelectorAll('th').forEach((h) => { delete h.dataset.sort; h.setAttribute('aria-sort', 'none'); });
  th.dataset.sort = dir; th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
  const rows = [...tb.rows].map((row, index) => ({ row, index })); if (rows.some(({ row }) => row.cells.length <= i)) return;
  const value = (row) => {
    const raw = (row.cells[i].dataset.sort || row.cells[i].textContent).trim();
    if (/^\d{4}-\d\d-\d\d(?:T|$)|\b[A-Za-z]{3,}\s+\d{1,2},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(raw)) {
      const time = Date.parse(raw); if (Number.isFinite(time)) return { kind: 'date', value: time };
    }
    const number = raw.replace(/,/g, '').match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) return { kind: 'number', value: Number(number[0]) };
    return { kind: 'text', value: raw.toLocaleLowerCase() };
  };
  rows.sort((a, b) => {
    const x = value(a.row), y = value(b.row);
    const order = x.kind === y.kind && (x.kind === 'date' || x.kind === 'number')
      ? x.value - y.value : String(x.value).localeCompare(String(y.value), undefined, { numeric: true, sensitivity: 'base' });
    return order === 0 ? a.index - b.index : order * (dir === 'asc' ? 1 : -1);
  });
  rows.forEach(({ row }) => tb.append(row));
  if (table.dataset.sortKey) sorts.set(table.dataset.sortKey, { column: i, direction: dir });
  table.dataset.sortSignature = tableSignature(table);
}
document.addEventListener('click', (e) => { const th = e.target.closest('.data-table th'); if (th) sortColumn(th); });
document.addEventListener('keydown', (e) => {
  const th = e.target.closest?.('.data-table th');
  if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sortColumn(th); }
});

/* Table quick-filter (kept across live re-renders) */
const filters = new Map(); let title = '', activeFilterKey = '';
document.addEventListener('focusin', (event) => {
  activeFilterKey = event.target.closest?.('.tbl-filter')?.dataset.filterKey || '';
});
function tables() {
  document.querySelectorAll('.table-wrap').forEach((wrap, n) => {
    const table = $('.data-table', wrap); if (!table?.tBodies[0]) return;
    const key = title + '|' + n; table.dataset.sortKey = key;
    table.querySelectorAll('thead th').forEach((th) => { th.tabIndex = 0; th.setAttribute('aria-sort', th.dataset.sort === 'asc' ? 'ascending' : th.dataset.sort === 'desc' ? 'descending' : 'none'); });
    const savedSort = sorts.get(key);
    if (savedSort && tableSignature(table) !== table.dataset.sortSignature) {
      const th = table.querySelectorAll('thead th')[savedSort.column];
      if (th) sortColumn(th, savedSort.direction);
    }
    if (table.tBodies[0].rows.length < 8) return;
    let box = wrap.previousElementSibling;
    if (!box?.classList.contains('tbl-filter')) {
      box = document.createElement('input'); box.className = 'tbl-filter'; box.type = 'search'; box.placeholder = 'Filter rows…'; box.setAttribute('aria-label', 'Filter table rows');
      box.dataset.filterKey = key;
      box.addEventListener('input', () => { filters.set(key, box.value); apply(table, box.value); }); wrap.before(box);
    }
    box.dataset.filterKey = key;
    if (filters.has(key) && box.value !== filters.get(key)) box.value = filters.get(key);
    apply(table, box.value);
    if (activeFilterKey === key && document.activeElement !== box) box.focus({ preventScroll: true });
  });
}
const apply = (table, q) => { q = q.trim().toLowerCase(); [...table.tBodies[0].rows].forEach((r) => r.classList.toggle('hide-row', !!q && !r.textContent.toLowerCase().includes(q))); };

/* Sparklines from real values seen on live updates (nothing is fabricated) */
const hist = new Map();
function sparks() {
  document.querySelectorAll('.stat-card,.launch-metric').forEach((card) => {
    const lab = $('.stat-label', card)?.textContent, v = $('.stat-value,.metric-big', card); if (!lab || !v) return;
    const n = parseFloat(v.textContent.replace(/,/g, '')); if (!isFinite(n)) return;
    const k = title + '|' + lab, h = hist.get(k) || []; if (h[h.length - 1] !== n) { h.push(n); if (h.length > 30) h.shift(); hist.set(k, h); }
    if (h.length < 2 || $('.spark', card)) return;
    const lo = Math.min(...h), hi = Math.max(...h), r = hi - lo || 1;
    const pts = h.map((x, j) => `${(j / (h.length - 1) * 74 + 1).toFixed(1)},${(24 - (x - lo) / r * 22).toFixed(1)}`);
    const [lx, ly] = pts[pts.length - 1].split(',');
    card.insertAdjacentHTML('beforeend', `<svg class="spark" viewBox="0 0 76 26" aria-hidden="true"><polyline points="${pts.join(' ')}"/><circle cx="${lx}" cy="${ly}" r="2.2"/></svg>`);
  });
}

/* Mobile bottom navigation + accent button */
function shell() {
  title = $('#page-content .page-head h1')?.textContent || title;
  const actions = $('.top-actions');
  if (actions && !$('.accent-btn', actions)) {
    const b = document.createElement('button'); b.className = 'accent-btn'; b.type = 'button'; b.title = 'Change accent colour';
    const nextAccent = () => accents[(accents.indexOf(document.documentElement.dataset.accent) + 1) % accents.length];
    b.setAttribute('aria-label', `Change accent colour; current theme ${document.documentElement.dataset.accent}`);
    b.addEventListener('click', () => { setAccent(nextAccent()); b.setAttribute('aria-label', `Change accent colour; current theme ${document.documentElement.dataset.accent}`); }); actions.prepend(b);
  }
  if ($('.sidebar') && !$('.bottom-nav')) {
    const nav = document.createElement('nav'); nav.className = 'bottom-nav'; nav.setAttribute('aria-label', 'Quick navigation');
    [['⌂', 'Overview', 'overview'], ['◉', 'Crew', 'crew'], ['⚑', 'Alerts', 'alerts'], ['⌁', 'Health', 'health'], ['☰', 'More', 'more']].forEach(([i, l, page]) => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.page = page; b.setAttribute('aria-label', page === 'more' ? 'Open full navigation' : l);
      const icon = document.createElement('span'); icon.setAttribute('aria-hidden', 'true'); icon.textContent = i;
      const label = document.createElement('span'); label.textContent = l; b.append(icon, label);
      b.addEventListener('click', () => {
        if (page === 'more') { $('.mobile-menu')?.click(); return; }
        document.querySelector(`.sidebar .nav-link[data-page="${page}"]`)?.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }); nav.append(b);
    }); document.body.append(nav);
  }
  if (!$('.sidebar')) $('.bottom-nav')?.remove();
  const active = $('.sidebar .nav-link.active')?.dataset.page;
  $('.bottom-nav')?.querySelectorAll('button').forEach((button) => {
    const destination = button.dataset.page === 'more' ? null : $(`.sidebar .nav-link[data-page="${button.dataset.page}"]`);
    button.hidden = button.dataset.page !== 'more' && !destination;
    const selected = Boolean(destination && button.dataset.page === active);
    button.classList.toggle('on', selected); if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  tables(); sparks();
}
let q = 0; new MutationObserver((m) => { if (m.every((x) => x.target.closest?.('.spark,.tbl-filter,.bottom-nav,.mission-clock'))) return; if (q) return; q = requestAnimationFrame(() => { q = 0; shell(); }); }).observe(document.getElementById('app'), { childList: true, subtree: true, characterData: true });
shell();
