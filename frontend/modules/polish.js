// ASTRA polish layer: starfield, page transitions, spotlight, ripple, mission clock, command palette.
const reduced = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const $ = (s, r = document) => r.querySelector(s);

/* Starfield (canvas, pauses when tab hidden) */
function starfield() {
  if (reduced) return;
  const c = document.createElement('canvas'); c.id = 'starfield'; c.setAttribute('aria-hidden', 'true');
  document.body.prepend(c);
  const g = c.getContext('2d'); if (!g) { c.remove(); return; }
  let w, h, stars = [];
  const resize = () => {
    const d = Math.min(devicePixelRatio || 1, 2); w = c.width = innerWidth * d; h = c.height = innerHeight * d;
    const n = Math.round(Math.min(90, innerWidth * innerHeight / 14000));
    stars = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.1 + .3) * d, s: Math.random() * .12 + .02, t: Math.random() * 6.28 }));
  };
  resize(); addEventListener('resize', resize);
  let raf; const draw = (ts) => {
    g.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.y += s.s; if (s.y > h) { s.y = 0; s.x = Math.random() * w; }
      g.globalAlpha = .35 + .45 * Math.sin(ts / 900 + s.t);
      g.fillStyle = s.r > 1.1 ? '#bfe6ff' : '#8fb7d4';
      g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.283); g.fill();
    }
    raf = requestAnimationFrame(draw);
  };
  if (!document.hidden) raf = requestAnimationFrame(draw);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) raf = requestAnimationFrame(draw);
  });
}

/* Command palette */
let overlay, input, list, items = [], sel = 0;
function navItems() {
  return [...document.querySelectorAll('.sidebar .nav-link')].map((el) => ({
    el, ico: el.querySelector('.nav-ico')?.textContent || '•',
    label: el.textContent.replace(el.querySelector('.nav-ico')?.textContent || '', '').trim(),
    group: (() => { let n = el.previousElementSibling; while (n && !n.classList.contains('nav-group')) n = n.previousElementSibling; return n?.textContent || ''; })(),
  }));
}
function build() {
  overlay = document.createElement('div'); overlay.className = 'cmd-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Jump to module');
  overlay.innerHTML = '<div class="cmd-box"><input class="cmd-input" role="combobox" aria-controls="astra-command-list" aria-expanded="false" aria-autocomplete="list" placeholder="Jump to a module…  (e.g. radiation, sleep, alerts)" aria-label="Search modules" autocomplete="off"/><ul class="cmd-list" id="astra-command-list" role="listbox"></ul><div class="cmd-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
  document.body.append(overlay); input = $('.cmd-input', overlay); list = $('.cmd-list', overlay);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); mark(); e.preventDefault(); }
    else if (e.key === 'Enter') { run(items[sel]); }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('.cmd-item'); if (li) run(items[+li.dataset.i]); });
}
function render() {
  const q = input.value.trim().toLowerCase();
  items = navItems().filter((i) => !q || (i.label + ' ' + i.group).toLowerCase().includes(q));
  sel = 0; list.textContent = '';
  if (!items.length) { list.innerHTML = '<li class="cmd-empty">No matching module</li>'; return; }
  items.forEach((it, i) => {
    const li = document.createElement('li'); li.className = 'cmd-item'; li.id = `astra-command-option-${i}`; li.dataset.i = i; li.setAttribute('role', 'option');
    const ico = document.createElement('span'); ico.className = 'nav-ico'; ico.textContent = it.ico;
    const name = document.createElement('span'); name.textContent = it.label;
    const grp = document.createElement('small'); grp.textContent = it.group;
    li.append(ico, name, grp); list.append(li);
  });
  mark();
}
function mark() {
  [...list.children].forEach((li, i) => {
    li.classList.toggle('sel', i === sel);
    li.setAttribute('aria-selected', String(i === sel));
  });
  const active = list.children[sel];
  if (active) { input.setAttribute('aria-activedescendant', active.id); active.scrollIntoView?.({ block: 'nearest' }); }
  else input.removeAttribute('aria-activedescendant');
}
let returnFocus = null;
function open() {
  if (!$('.sidebar')) return;
  if (!overlay) build();
  returnFocus = document.activeElement;
  overlay.classList.add('open'); input.setAttribute('aria-expanded', 'true');
  input.value = ''; render(); input.focus();
}
function close(restoreFocus = true) {
  overlay?.classList.remove('open'); input?.setAttribute('aria-expanded', 'false');
  if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}
function run(it) {
  if (!it) return;
  close(false); it.el.click(); $('.sidebar')?.classList.remove('open');
  const heading = $('#page-content h1');
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); overlay?.classList.contains('open') ? close() : open(); }
  else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && $('.sidebar')) { e.preventDefault(); open(); }
});

/* Decorate shell: clock, palette trigger, back-to-top, page transitions */
let lastTitle = '';
function decorate() {
  const actions = $('.top-actions');
  if (actions && !$('.cmd-trigger', actions)) {
    const b = document.createElement('button'); b.className = 'cmd-trigger'; b.type = 'button'; b.setAttribute('aria-label', 'Open command palette');
    b.innerHTML = '<span aria-hidden="true">⌕</span><span class="lbl">Jump to…</span><kbd>Ctrl K</kbd>';
    b.addEventListener('click', open); actions.prepend(b);
    const clock = document.createElement('span'); clock.className = 'mission-clock'; clock.title = 'Current Coordinated Universal Time (UTC)'; actions.prepend(clock);
  }
  const t = $('#page-content .page-head h1')?.textContent || '';
  if (t && t !== lastTitle) {
    lastTitle = t; const pc = $('#page-content'); pc.classList.remove('page-enter'); void pc.offsetWidth;
    if (!reduced) { pc.classList.add('page-enter'); setTimeout(() => pc.classList.remove('page-enter'), 900); }
  }
  if (!$('.to-top')) {
    const t2 = document.createElement('button'); t2.className = 'to-top'; t2.type = 'button'; t2.textContent = '↑'; t2.setAttribute('aria-label', 'Back to top');
    t2.addEventListener('click', () => scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })); document.body.append(t2);
  }
}
addEventListener('scroll', () => $('.to-top')?.classList.toggle('show', scrollY > 500), { passive: true });
setInterval(() => { const c = $('.mission-clock'); if (c) c.textContent = '◷ UTC ' + new Date().toISOString().slice(11, 19); }, 1000);
let raf2 = 0;
new MutationObserver((changes) => {
  if (changes.every((change) => change.target.closest?.('.mission-clock'))) return;
  if (raf2) return;
  raf2 = requestAnimationFrame(() => { raf2 = 0; decorate(); });
}).observe(document.getElementById('app'), { childList: true, subtree: true });
starfield(); decorate();

/* Offline-safe hero photo: fall back to a styled panel if the NASA image can't load */
document.addEventListener('error', (e) => {
  const img = e.target; if (!(img instanceof HTMLImageElement)) return;
  img.closest('.hero-photo')?.classList.add('img-failed');
}, true);
