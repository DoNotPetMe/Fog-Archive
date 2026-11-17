// Draws the embers on the page's canvas from a worker (OffscreenCanvas), so the
// page's main thread does no per-frame work for them. entity.js hands the canvas
// over only after this posts 'ready' (the module loaded and can draw 2D).
// Messages from entity.js:
//   { canvas }            the transferred OffscreenCanvas
//   { size: [w, h, dpr] } the viewport changed
//   { idle }              stop while nobody is looking, start again when they are

import { createEmbers } from './embers.js';

let embers = null;
onmessage = ({ data }) => {
  if (data.canvas) embers = createEmbers(data.canvas.getContext('2d'));
  if (!embers) return;
  if (data.size) embers.resize(...data.size);
  if ('idle' in data) (data.idle ? embers.stop() : embers.start());
};

let can2d = false;
try { can2d = !!new OffscreenCanvas(1, 1).getContext('2d'); } catch { can2d = false; }
postMessage(can2d ? 'ready' : 'no-2d');
