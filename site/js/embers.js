// The ember simulation, shared by the worker (embers-worker.js, preferred: drawing
// leaves the page's main thread) and the main-thread fallback in entity.js.
//
// Budget: 36 particles, ~30 fps, 1.5x device pixels. Between frames the loop
// waits on a timer, not on skipped animation frames: every requested frame makes
// the browser build a whole frame, and a 165 Hz screen would get 165 a second.

const MAX = 36;
const raf = globalThis.requestAnimationFrame ? (f) => requestAnimationFrame(f) : (f) => setTimeout(() => f(performance.now()), 0);
const unraf = globalThis.cancelAnimationFrame ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id);

export function createEmbers(ctx) {
  let w = 0, h = 0, parts = [], frameId = 0, timer = 0, last = 0;
  const spawn = (anywhere) => ({
    x: Math.random() * w, y: anywhere ? Math.random() * h : h + 10,
    vx: (Math.random() - 0.5) * 12, vy: -(14 + Math.random() * 30),
    r: 0.6 + Math.random() * 1.6, life: 0, ttl: 5 + Math.random() * 8, sway: Math.random() * 6.28,
  });
  const next = () => { timer = 0; frameId = raf(frame); };
  function frame(t) {
    frameId = 0;
    timer = setTimeout(next, 31); // + the wait for a frame: 30 fps at 60 Hz, 27.5 at 165 Hz; ~31 in a worker, where rAF hardly waits
    const dt = Math.max(0, Math.min(0.1, (t - last) / 1000));
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
  }
  return {
    resize(width, height, dpr) {
      w = width; h = height;
      ctx.canvas.width = Math.round(w * dpr); ctx.canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    start() { if (!frameId && !timer) { last = performance.now(); frameId = raf(frame); } },
    stop() { unraf(frameId); clearTimeout(timer); frameId = timer = 0; },
  };
}
