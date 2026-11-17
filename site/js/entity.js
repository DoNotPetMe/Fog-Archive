// The Entity: drifting embers, limbs that reach in from the edges of the
// screen, and the skill check used by "Offer to the Entity".
//
// Performance budget: the ember canvas is capped at 36 particles, ~30 fps and
// 1.5x device pixels, and stops entirely when the tab is hidden or the user
// asks for reduced motion. The limbs are static SVG moved by CSS transforms.

import { openModal, closeModal, esc } from './ui.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ embers
export function initEmbers() {
  const canvas = document.getElementById('embers');
  if (!canvas || reduced()) return;
  const ctx = canvas.getContext('2d');
  const MAX = 36;
  let w = 0, h = 0, dpr = 1, parts = [], raf = 0, last = 0;
  const resize = () => {
    dpr = Math.min(1.5, devicePixelRatio || 1);
    w = innerWidth; h = innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const spawn = (anywhere) => ({
    x: Math.random() * w, y: anywhere ? Math.random() * h : h + 10,
    vx: (Math.random() - 0.5) * 12, vy: -(14 + Math.random() * 30),
    r: 0.6 + Math.random() * 1.6, life: 0, ttl: 5 + Math.random() * 8, sway: Math.random() * 6.28,
  });
  const frame = (t) => {
    raf = requestAnimationFrame(frame);
    if (t - last < 33) return; // ~30 fps is plenty for slow embers
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    ctx.clearRect(0, 0, w, h);
    while (parts.length < MAX) parts.push(spawn(parts.length < MAX / 2));
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.life += dt; p.sway += dt * 1.3;
      p.x += (p.vx + Math.sin(p.sway) * 9) * dt; p.y += p.vy * dt;
      if (p.life > p.ttl || p.y < -10) { parts[i] = spawn(false); continue; }
      const a = Math.sin((p.life / p.ttl) * Math.PI) * 0.75;
      ctx.fillStyle = `rgba(255,${110 + ((p.r * 50) | 0)},40,${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
    }
  };
  const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  resize();
  addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();
}

// ------------------------------------------------------------------- limbs
// The limbs are sprites rendered in Blender (tools/entity). Idle, only their
// tips show at the screen edges; when a build is opened they slide in and
// close around it. Moving them is a compositor-only transform.
export function initEntity() {
  const root = document.getElementById('entity');
  if (!root) return;
  const LEGS = [
    { img: 'limb-a', top: 0.05, scale: 1.0, flipY: false },
    { img: 'limb-b', top: 0.37, scale: 0.86, flipY: false },
    { img: 'limb-c', top: 0.62, scale: 1.04, flipY: true }, // reaches up from below
  ];
  const draw = () => {
    const w = innerWidth, h = innerHeight;
    // how far a limb must reach to grip the edge of an open build (1080px wide, centred)
    const gap = (w - Math.min(1080, w - 32)) / 2;
    const base = gap + 58;
    if (w < 1100 || base < 190) { root.innerHTML = ''; return; }
    let out = '';
    for (const side of ['left', 'right']) {
      LEGS.forEach((l, i) => {
        const width = Math.round(base * l.scale);
        const top = Math.round(h * (l.top + (side === 'right' ? 0.06 : 0)));
        out += `<img class="leg ${side}${l.flipY ? ' flip' : ''}" src="assets/ui/${l.img}.webp" alt="" decoding="async" style="width:${width}px;top:${top}px;--rest:${-(width - 44)}px;--d:${i * 80}ms">`;
      });
    }
    root.innerHTML = out;
  };
  let timer;
  addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(draw, 200); }, { passive: true });
  draw();
}

// ------------------------------------------------------------- skill check
/**
 * Runs a Dead by Daylight style skill check. Resolves with 'great' | 'good' | 'fail'.
 */
export function skillCheck({ title = 'Offer to the Entity', hint = '' } = {}) {
  return new Promise((resolve) => {
    const zoneStart = 110 + Math.random() * 190; // degrees clockwise from 12 o'clock
    const GREAT = 9, GOOD = 34;
    const R = 92, C = 110;
    const arc = (a0, a1) => {
      const p = (a) => { const r = ((a - 90) * Math.PI) / 180; return `${(C + R * Math.cos(r)).toFixed(2)} ${(C + R * Math.sin(r)).toFixed(2)}`; };
      return `M${p(a0)}A${R} ${R} 0 0 1 ${p(a1)}`;
    };
    let done = false;
    const modal = openModal(
      `<div class="sc-wrap"><h3>${esc(title)}</h3><p>${esc(hint)}</p>
        <div class="sc" role="button" tabindex="0" aria-label="Skill check: press Space or click when the needle is in the white zone">
          <svg viewBox="0 0 220 220"><circle class="ring" cx="${C}" cy="${C}" r="${R}"/>
            <path class="good" d="${arc(zoneStart + GREAT, zoneStart + GREAT + GOOD)}"/><path class="great" d="${arc(zoneStart, zoneStart + GREAT)}"/>
            <line class="needle" x1="${C}" y1="${C}" x2="${C}" y2="${C - R - 8}"/></svg>
          <div class="key"><span>SPACE</span></div>
        </div>
        <div class="sc-result" aria-live="polite"></div></div>`,
      { cls: 'narrow', label: title, onClose: () => { if (!done) { done = true; cleanup(); resolve('cancel'); } } },
    );
    modal.style.width = 'min(460px, 100%)';
    const needle = modal.querySelector('.needle');
    const result = modal.querySelector('.sc-result');
    const hit = modal.querySelector('.sc');
    let angle = 0, raf = 0, last = performance.now();
    const speed = 300; // degrees per second, like the in-game needle
    const finish = (grade) => {
      if (done) return;
      done = true;
      cleanup();
      result.className = `sc-result ${grade}`;
      result.textContent = grade === 'great' ? 'Great skill check' : grade === 'good' ? 'Good skill check' : 'Failed — the Entity is displeased';
      if (grade === 'fail') modal.classList.add('shake');
      setTimeout(() => { closeModal(true); document.body.classList.remove('grasp'); resolve(grade); }, grade === 'fail' ? 900 : 650);
    };
    const press = () => {
      if (done) return;
      const a = angle;
      finish(a >= zoneStart && a < zoneStart + GREAT ? 'great' : a >= zoneStart + GREAT && a <= zoneStart + GREAT + GOOD ? 'good' : 'fail');
    };
    const tick = (t) => {
      angle += ((t - last) / 1000) * speed; last = t;
      if (angle >= 360) { needle.setAttribute('transform', `rotate(359 ${C} ${C})`); finish('fail'); return; }
      needle.setAttribute('transform', `rotate(${angle.toFixed(1)} ${C} ${C})`);
      raf = requestAnimationFrame(tick);
    };
    const onKey = (e) => { if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); press(); } };
    function cleanup() { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey, true); }
    document.addEventListener('keydown', onKey, true);
    hit.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
    setTimeout(() => { if (!done) { last = performance.now(); raf = requestAnimationFrame(tick); } }, reduced() ? 0 : 500);
  });
}
