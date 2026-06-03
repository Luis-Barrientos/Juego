/**
 * Centralised input state. Listens once on module load and exposes a snapshot
 * object that game systems can read each frame.
 */

import { state } from './state.js';

export const input = {
  keys: Object.create(null),
  mouseX: 0,
  mouseY: 0,
  mouseDown: false,
  rightDown: false,
};

/**
 * Wire up keyboard / mouse / touch listeners.
 * @param {HTMLCanvasElement} canvas
 * @param {{ pause: () => void, resume: () => void }} hooks
 */
export function initInput(canvas, hooks) {
  document.addEventListener('keydown', e => {
    input.keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'Escape') {
      if (state.state === 'play') hooks.pause();
      else if (state.state === 'pause') hooks.resume();
    }
  });
  document.addEventListener('keyup', e => { input.keys[e.code] = false; });

  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    input.mouseX = (e.clientX - r.left) * (canvas.width  / r.width);
    input.mouseY = (e.clientY - r.top)  * (canvas.height / r.height);
  });
  canvas.addEventListener('mousedown', e => {
    e.preventDefault();
    if (e.button === 0) input.mouseDown = true;
    if (e.button === 2) input.rightDown = true;
  });
  canvas.addEventListener('mouseup', e => {
    if (e.button === 0) input.mouseDown = false;
    if (e.button === 2) input.rightDown = false;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}
