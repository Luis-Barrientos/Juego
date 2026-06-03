/**
 * Centralised input state. Listens once on module load and exposes a snapshot
 * object that game systems can read each frame.
 *
 * Supports keyboard, mouse and touch (virtual joystick + action buttons).
 */

import { state } from './state.js';
import { VIEW_W, VIEW_H } from './config.js';

export const input = {
  keys: Object.create(null),
  mouseX: VIEW_W / 2,
  mouseY: VIEW_H / 2,
  mouseDown: false,
  rightDown: false,
  /** True while any touch control is in use (enables auto-aim). */
  touchActive: false,
};

/** Detect coarse-pointer / no-hover devices (phones, tablets). */
function isTouchDevice() {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches
      || ('ontouchstart' in window);
}

/**
 * Wire up keyboard / mouse / touch listeners.
 * @param {HTMLCanvasElement} canvas
 * @param {{ pause: () => void, resume: () => void }} hooks
 */
export function initInput(canvas, hooks) {
  // ────────── Keyboard ──────────
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

  // ────────── Mouse ──────────
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

  // ────────── Touch ──────────
  if (isTouchDevice()) initTouch(hooks);
}

/* ─────────────────────────── Virtual touch pad ─────────────────────────── */

function initTouch(hooks) {
  const ui     = document.getElementById('touchUI');
  const stick  = document.getElementById('joystick');
  const knob   = document.getElementById('joystickKnob');
  const btnSwd = document.getElementById('btnSword');
  const btnMag = document.getElementById('btnMagic');
  const btnE   = document.getElementById('btnE');
  const btnPau = document.getElementById('btnPause');
  if (!ui || !stick || !knob) return;

  ui.classList.remove('hidden');

  let stickId  = null;
  let stickCx  = 0;
  let stickCy  = 0;
  const radius = 55;

  function applyStick(dx, dy) {
    const mag = Math.hypot(dx, dy);
    const lim = Math.min(mag, radius);
    const kx  = mag > 0 ? (dx / mag) * lim : 0;
    const ky  = mag > 0 ? (dy / mag) * lim : 0;
    knob.style.transform = `translate(${kx}px, ${ky}px)`;

    const norm = lim / radius;
    const ux   = (mag > 0 ? dx / mag : 0) * norm;
    const uy   = (mag > 0 ? dy / mag : 0) * norm;
    const thr  = 0.25;
    input.keys['KeyA'] = ux < -thr;
    input.keys['KeyD'] = ux >  thr;
    input.keys['KeyW'] = uy < -thr;
    input.keys['KeyS'] = uy >  thr;
  }

  function resetStick() {
    knob.style.transform = '';
    input.keys['KeyA'] = input.keys['KeyD'] = false;
    input.keys['KeyW'] = input.keys['KeyS'] = false;
  }

  stick.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    stickId = t.identifier;
    const r = stick.getBoundingClientRect();
    stickCx = r.left + r.width  / 2;
    stickCy = r.top  + r.height / 2;
    applyStick(t.clientX - stickCx, t.clientY - stickCy);
    input.touchActive = true;
  }, { passive: false });

  stick.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        applyStick(t.clientX - stickCx, t.clientY - stickCy);
      }
    }
  }, { passive: false });

  function endStick(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        stickId = null;
        resetStick();
      }
    }
  }
  stick.addEventListener('touchend',    endStick);
  stick.addEventListener('touchcancel', endStick);

  // Action buttons
  bindHold(btnSwd, () => { input.touchActive = true; input.mouseDown = true; }, () => { input.mouseDown = false; });
  bindHold(btnMag, () => { input.touchActive = true; input.rightDown = true; }, () => { input.rightDown = false; });
  bindHold(btnE,   () => { input.keys['KeyE'] = true; },                        () => { input.keys['KeyE'] = false; });

  if (btnPau) {
    const togglePause = e => {
      e.preventDefault();
      if      (state.state === 'play')  hooks.pause();
      else if (state.state === 'pause') hooks.resume();
    };
    btnPau.addEventListener('touchstart', togglePause, { passive: false });
    btnPau.addEventListener('click',      togglePause);
  }
}

function bindHold(btn, onDown, onUp) {
  if (!btn) return;
  const down = e => { e.preventDefault(); onDown(); };
  const up   = e => { e.preventDefault(); onUp();   };
  btn.addEventListener('touchstart',  down, { passive: false });
  btn.addEventListener('touchend',    up,   { passive: false });
  btn.addEventListener('touchcancel', up,   { passive: false });
  // Hybrid devices (mouse + touch).
  btn.addEventListener('mousedown',   down);
  btn.addEventListener('mouseup',     up);
  btn.addEventListener('mouseleave',  up);
}

/**
 * On touch devices, aim is auto-targeted to the nearest enemy. Call once per
 * frame from the game loop *before* the player update reads `input.mouseX/Y`.
 */
export function updateTouchAim() {
  if (!input.touchActive) return;
  const p = state.player;
  if (!p) return;
  let best = null, bestD = Infinity;
  for (const e of state.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best) {
    input.mouseX = best.x - state.cameraX;
    input.mouseY = best.y - state.cameraY;
  } else {
    const ang = p.facing ?? 0;
    input.mouseX = (p.x - state.cameraX) + Math.cos(ang) * 60;
    input.mouseY = (p.y - state.cameraY) + Math.sin(ang) * 60;
  }
}
