// "Nobody is looking": the tab is hidden, the window is minimised, another window
// has focus, or a video fills the screen. While idle, <html> gets the class "idle"
// (CSS pauses the looping animations) and subscribers stop their work (the ember
// canvas, pointer effects), so a background window costs nothing.
//
// A focused YouTube embed is not idle: the page still has focus through it. The
// page gets no events while focus is inside an embed, so only while a video embed
// is on screen is focus re-checked once a second.

const subs = new Set();
let idle = null;
let poll = 0;

function watchEmbeds() {
  const need = !document.hidden && !!document.querySelector('iframe');
  if (need && !poll) poll = setInterval(update, 1000);
  else if (!need && poll) { clearInterval(poll); poll = 0; }
}

function update() {
  watchEmbeds();
  const now = document.hidden || !document.hasFocus() || !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (now === idle) return;
  idle = now;
  document.documentElement.classList.toggle('idle', idle);
  subs.forEach((f) => f(idle));
}

// blur fires before focus settles (and also when focus moves into an embed), so check on the next tick
addEventListener('blur', () => setTimeout(update, 0));
addEventListener('focus', update);
document.addEventListener('visibilitychange', update);
document.addEventListener('fullscreenchange', update);
document.addEventListener('webkitfullscreenchange', update); // Safari before 16.4
// a tap or click means someone is here, even where a browser sends no focus event
addEventListener('pointerdown', update, { capture: true, passive: true });
addEventListener('pageshow', update);
update();

export const isIdle = () => idle;

/** Calls f(idle) now and whenever the idle state changes. Returns an unsubscribe function. */
export function onIdle(f) {
  subs.add(f);
  f(idle);
  return () => subs.delete(f);
}
