// The Entity: drifting embers, limbs that reach in from the edges of the
// screen, and the skill check used by "Offer to the Entity".
//
// Performance budget: the embers (embers.js) are capped at 36 particles, ~30 fps
// and 1.5x device pixels, are drawn from a worker where the browser allows it, and
// stop entirely while the window is hidden or not focused (idle.js). The limbs are
// sprites moved by CSS transforms.

import { openModal, closeModal, esc } from './ui.js';
import { onIdle } from './idle.js';
import { createEmbers } from './embers.js';

// ------------------------------------------------------------------ embers
export function initEmbers() {
  const canvas = document.getElementById('embers');
  if (!canvas) return;
  // The embers are drawn from a worker when it proves it can run (it posts 'ready'); only then is
  // the canvas handed over, because a transferred canvas can never be drawn here again. If the
  // worker can't be made, errors or stays silent, the same embers run on the main thread instead.
  let embers = null, size = null, idle = null;
  const apply = () => { if (size) embers.resize(...size); if (idle !== null) (idle ? embers.stop() : embers.start()); };
  const local = () => { embers = createEmbers(canvas.getContext('2d')); apply(); };
  let wk = null;
  if (canvas.transferControlToOffscreen && typeof Worker === 'function') {
    try { wk = new Worker(new URL('./embers-worker.js', import.meta.url), { type: 'module' }); } catch { wk = null; }
  }
  if (wk) {
    const fail = () => { clearTimeout(wait); wk.onmessage = wk.onerror = null; wk.terminate(); if (!embers) local(); };
    const wait = setTimeout(fail, 4000);
    wk.onerror = fail;
    wk.onmessage = ({ data }) => {
      if (data !== 'ready') return fail();
      clearTimeout(wait);
      wk.onmessage = null;
      wk.onerror = (e) => console.warn('embers worker:', e.message);
      let off = null;
      try {
        off = canvas.transferControlToOffscreen();
        wk.postMessage({ canvas: off }, [off]);
      } catch (err) {
        wk.terminate();
        if (!off) local(); // the canvas is still ours
        else console.warn('embers off:', err); // handed over but never arrived: nothing can draw it now
        return;
      }
      embers = { resize: (...s) => wk.postMessage({ size: s }), start: () => wk.postMessage({ idle: false }), stop: () => wk.postMessage({ idle: true }) };
      apply();
    };
  } else local();
  const resize = () => { size = [innerWidth, innerHeight, Math.min(1.5, devicePixelRatio || 1)]; embers?.resize(...size); };
  resize();
  addEventListener('resize', resize, { passive: true });
  onIdle((now) => { idle = now; if (embers) (now ? embers.stop() : embers.start()); });
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
      // capped so the needle waits while the tab is hidden instead of jumping past the zone on return
      angle += Math.max(0, Math.min(0.05, (t - last) / 1000)) * speed; last = t;
      if (angle >= 360) { needle.setAttribute('transform', `rotate(359 ${C} ${C})`); finish('fail'); return; }
      needle.setAttribute('transform', `rotate(${angle.toFixed(1)} ${C} ${C})`);
      raf = requestAnimationFrame(tick);
    };
    const onKey = (e) => { if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); press(); } };
    function cleanup() { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey, true); }
    document.addEventListener('keydown', onKey, true);
    hit.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
    setTimeout(() => { if (!done) { last = performance.now(); raf = requestAnimationFrame(tick); } }, 500);
  });
}
