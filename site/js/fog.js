// The fog layer: small things in the fog. No story text, nothing to collect.
// Self-contained: remove the <script src="js/fog.js"> line in index.html to turn all of it off,
// or use the "Fog effects" switch in the footer.
//
//   lantern     a soft light follows the pointer through a darker fog (not on touch screens)
//   scratches   moving the pointer fast leaves fading scratch marks (not on touch screens)
//
// Both only react to a mouse or pen, and ignore it while the window is hidden or not focused
// or a build is open (the lantern is hidden there, and marks would re-blur the modal backdrop).

import { isIdle } from './idle.js';

const asleep = (e) => e.pointerType === 'touch' || isIdle() || document.body.classList.contains('grasp');

const OFF = 'fog.effects.off';
const coarse = matchMedia('(pointer: coarse)').matches;
const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };
let enabled = !get(OFF, false);

// The darkness is drawn into a quarter-resolution canvas that the compositor scales up:
// a smooth gradient loses nothing, and a pointer frame repaints 1/16 of the pixels a
// full-screen CSS gradient would. Clear within 180px of the pointer, .28 dark at 380px,
// .5 at 75% of the distance to the farthest corner and beyond.
function lantern() {
  const S = 4;
  const el = document.createElement('canvas');
  el.id = 'fog-lantern';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  const ctx = el.getContext('2d');
  // W/H: the canvas's own CSS box, which leaves out the scrollbar (innerWidth would not, and the light
  // would sit left of the pointer). k: canvas pixels per CSS pixel, exact even when W/S isn't whole.
  let x = innerWidth / 2, y = innerHeight / 3, W = 1, H = 1, k = 1 / S, raf = 0;
  const draw = () => {
    raf = 0;
    const far = Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));
    const r = Math.max(381, 0.75 * far);
    const g = ctx.createRadialGradient(x * k, y * k, 0, x * k, y * k, r * k);
    g.addColorStop(0, 'rgba(4,6,8,0)'); g.addColorStop(180 / r, 'rgba(4,6,8,0)'); g.addColorStop(380 / r, 'rgba(4,6,8,.28)'); g.addColorStop(1, 'rgba(4,6,8,.5)');
    ctx.clearRect(0, 0, el.width, el.height * 2); ctx.fillStyle = g; ctx.fillRect(0, 0, el.width, el.height * 2); // * 2: covers the canvas whatever the vertical scale
  };
  const size = () => {
    W = el.clientWidth || innerWidth; H = el.clientHeight || innerHeight;
    el.width = Math.ceil(W / S); el.height = Math.ceil(H / S);
    k = el.width / W;
    ctx.setTransform(1, 0, 0, el.height / H / k, 0, 0); // the vertical scale can differ by a fraction; keep the light round
    draw();
  };
  const move = (e) => {
    if (asleep(e)) return;
    x = e.clientX; y = e.clientY;
    if (!raf) raf = requestAnimationFrame(draw);
  };
  // fires once at the start and whenever the box changes, including a scrollbar appearing (no resize event)
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null;
  if (ro) ro.observe(el); else { size(); addEventListener('resize', size, { passive: true }); }
  addEventListener('pointermove', move, { passive: true });
  return () => { removeEventListener('pointermove', move); removeEventListener('resize', size); ro?.disconnect(); cancelAnimationFrame(raf); el.remove(); };
}

function scratches() {
  let lx = 0, ly = 0, lt = 0, lastMark = 0, alive = 0;
  const move = (e) => {
    if (asleep(e)) { lt = 0; return; }
    const t = e.timeStamp;
    const speed = Math.hypot(e.clientX - lx, e.clientY - ly) / (t - lt || 16); // px per ms
    if (speed > 1.5 && t - lastMark > 70 && alive < 24) {
      lastMark = t;
      alive++;
      const m = document.createElement('i');
      m.className = 'fog-scratch';
      m.style.left = `${e.clientX}px`;
      m.style.top = `${e.clientY}px`;
      m.style.setProperty('--r', `${Math.atan2(e.clientY - ly, e.clientX - lx) + Math.PI / 2}rad`);
      document.body.appendChild(m);
      setTimeout(() => { if (m.isConnected) { m.remove(); alive--; } }, 1700);
    }
    lx = e.clientX; ly = e.clientY; lt = t;
  };
  addEventListener('pointermove', move, { passive: true });
  return () => { removeEventListener('pointermove', move); document.querySelectorAll('.fog-scratch').forEach((m) => m.remove()); alive = 0; };
}

let stops = [];
function start() {
  if (!enabled || coarse) return;
  stops.push(lantern(), scratches());
}
function end() {
  stops.forEach((f) => f());
  stops = [];
}

const toggle = document.createElement('button');
toggle.id = 'fog-toggle';
toggle.className = 'linkish';
const label = () => { toggle.textContent = `Fog effects: ${enabled ? 'on' : 'off'}`; toggle.setAttribute('aria-pressed', String(enabled)); };
label();
toggle.addEventListener('click', () => { enabled = !enabled; set(OFF, !enabled); label(); if (enabled) start(); else end(); });
if (!coarse) document.querySelector('.foot')?.appendChild(toggle);
start();
