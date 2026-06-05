/**
 * grandTome.js
 * --------------------------------------------------------------------------
 * Library "Sala del Gran Tomo" set-piece (Simon-Says minigame).
 *
 * Flow:
 *   1. Player walks up to the pedestal at the centre of the room and
 *      presses E.
 *   2. `startTome()` seals every entrance, rolls a fresh sequence of
 *      5–7 directions (↑↓←→) and enters the 'showing' state. Each step
 *      flashes for ~0.85 s with an audible cue.
 *   3. Once the full sequence has been shown, state moves to 'awaiting'
 *      and the player must repeat it with arrows / WASD. A wrong key (or
 *      a 6 s idle window) consumes one attempt of three. The first two
 *      misses simply reset the input and start the showing again.
 *   4. Three failures: state becomes 'failed', a hostile wave is spawned
 *      and the room stays sealed until cleared.
 *   5. A correct full run: state becomes 'success', the seals fall and
 *      three rare chests drop around the pedestal.
 *
 * The module owns `state.grandTome`. Generation in `dungeon.js` builds
 * the room + pedestal; we just animate and resolve the encounter here.
 */

import { state }          from './state.js';
import { TILE }           from './config.js';
import { input }          from './input.js';
import { createEnemy }    from './enemies.js';
import { rebuildMapCache } from './render.js';
import { Audio }          from './audio.js';
import { spawnParticles } from './particles.js';

/* Tile constants — inlined to avoid a circular import with dungeon.js. */
const T_WALL  = 0;
const T_FLOOR = 1;

/** Timings (seconds). Tweak here, the rest reads them. */
const SHOW_STEP    = 0.85;   // how long each step of the sequence flashes
const SHOW_GAP     = 0.25;   // dark pause between steps
const INPUT_IDLE   = 6.0;    // max idle in 'awaiting' before the attempt expires
const FLASH_TIME   = 0.30;   // feedback flash after a player input

/** Map raw input codes to canonical direction names. */
const KEY_TO_DIR = {
  KeyW: 'up',    ArrowUp:    'up',
  KeyS: 'down',  ArrowDown:  'down',
  KeyA: 'left',  ArrowLeft:  'left',
  KeyD: 'right', ArrowRight: 'right',
};
const ALL_DIRS = ['up', 'down', 'left', 'right'];

/** Per-frame edge-detection scratch (keyed by input code). */
const prevDown = {
  KeyW: false, ArrowUp: false,
  KeyS: false, ArrowDown: false,
  KeyA: false, ArrowLeft: false,
  KeyD: false, ArrowRight: false,
};

/** Reset slot when the floor (re)builds. */
export function resetGrandTome() {
  if (!state.grandTome) state.grandTome = null;
  for (const k of Object.keys(prevDown)) prevDown[k] = false;
}

/** Tile distance from the player to the pedestal centre, in tiles. */
function pedestalUnderPlayer() {
  const gt = state.grandTome;
  if (!gt || !gt.pedestal) return null;
  const p = state.player;
  const cx = (gt.pedestal.tx + gt.pedestal.w / 2) * TILE;
  const cy = (gt.pedestal.ty + gt.pedestal.h / 2) * TILE;
  if (Math.hypot(p.x - cx, p.y - cy) < TILE * 2.2) return gt;
  return null;
}

/**
 * Walk the room perimeter and return every tile just OUTSIDE the room
 * footprint that is currently floor (= every entrance).
 * @private
 */
function findEntranceTiles(room) {
  const out = [];
  const map = state.map;
  const x0 = room.x - 1, x1 = room.x + room.w;
  const y0 = room.y - 1, y1 = room.y + room.h;
  for (let x = room.x; x < room.x + room.w; x++) {
    if (map[y0] && map[y0][x] === T_FLOOR) out.push({ tx: x, ty: y0 });
    if (map[y1] && map[y1][x] === T_FLOOR) out.push({ tx: x, ty: y1 });
  }
  for (let y = room.y; y < room.y + room.h; y++) {
    if (map[y] && map[y][x0] === T_FLOOR) out.push({ tx: x0, ty: y });
    if (map[y] && map[y][x1] === T_FLOOR) out.push({ tx: x1, ty: y });
  }
  return out;
}

/** Roll a fresh 5–7 step sequence with no immediate repeats. */
function rollSequence() {
  const len = 5 + Math.floor(Math.random() * 3); // 5..7
  const seq = [];
  let last = null;
  for (let i = 0; i < len; i++) {
    let d;
    do { d = ALL_DIRS[Math.floor(Math.random() * ALL_DIRS.length)]; }
    while (d === last);
    seq.push(d);
    last = d;
  }
  return seq;
}

/**
 * Public entry point: invoked from the player E-handler. Returns true if
 * the encounter actually started this frame.
 *
 * @param {(text: string) => void} toast
 */
export function tryStartGrandTome(toast) {
  const gt = pedestalUnderPlayer();
  if (!gt) return false;
  if (gt.state !== 'idle' || gt.completed) return false;

  const sealed = findEntranceTiles(gt.room);
  for (const t of sealed) state.map[t.ty][t.tx] = T_WALL;
  gt.sealedTiles = sealed;

  gt.sequence    = rollSequence();
  gt.showIndex   = 0;
  gt.showTimer   = 0;
  gt.inputIndex  = 0;
  gt.inputTimer  = 0;
  gt.attempts    = 0;
  gt.flashKey    = null;
  gt.flashTimer  = 0;
  gt.state       = 'showing';
  rebuildMapCache();
  state.shake = Math.max(state.shake || 0, 4);
  Audio.bossHit && Audio.bossHit();
  toast && toast('El tomo te muestra una secuencia…');
  return true;
}

/**
 * Per-frame update: drives the Simon-Says state machine.
 *
 * @param {number} dt
 * @param {(text: string) => void} toast
 * @param {(room: object, pedestal: object) => void} spawnRewards
 */
export function updateGrandTome(dt, toast, spawnRewards) {
  const gt = state.grandTome;
  if (!gt) return;

  if (gt.flashTimer > 0) gt.flashTimer = Math.max(0, gt.flashTimer - dt);

  if (gt.state === 'showing') {
    gt.showTimer += dt;
    const stepLen = SHOW_STEP + SHOW_GAP;
    if (gt.showTimer >= stepLen) {
      gt.showTimer -= stepLen;
      gt.showIndex++;
      Audio.bossHit && Audio.bossHit();
      if (gt.showIndex >= gt.sequence.length) {
        gt.state      = 'awaiting';
        gt.showIndex  = 0;
        gt.showTimer  = 0;
        gt.inputIndex = 0;
        gt.inputTimer = 0;
        toast && toast('¡Tu turno! Repite la secuencia.');
      }
    }
    return;
  }

  if (gt.state === 'awaiting') {
    gt.inputTimer += dt;

    // Edge-detect each direction key. Process at most one press per
    // frame so simultaneous keys don't drain attempts in a single tick.
    let consumed = false;
    for (const code of Object.keys(KEY_TO_DIR)) {
      const down    = !!input.keys[code];
      const wasDown = prevDown[code];
      prevDown[code] = down;
      if (!consumed && down && !wasDown) {
        handleInput(gt, KEY_TO_DIR[code], toast);
        consumed = true;
      }
    }

    // Idle timeout = an attempt consumed.
    if (gt.inputTimer > INPUT_IDLE) {
      consumeAttempt(gt, toast, 'Te has quedado en blanco…');
    }
    return;
  }

  if (gt.state === 'failed') {
    // The room stays sealed until all spawned enemies are dead.
    if (!gt.failWaveSpawned) return;
    const anyAlive = state.enemies.some(e =>
      !e.dead && e.fromGrandTome,
    );
    if (anyAlive) return;
    // Wave cleared: unseal but no rewards.
    for (const t of gt.sealedTiles) state.map[t.ty][t.tx] = T_FLOOR;
    rebuildMapCache();
    gt.state = 'idle';
    gt.completed = true;
    toast && toast('El tomo se cierra. Has fallado, pero estás vivo.');
    return;
  }

  if (gt.state === 'success' && !gt.rewardGiven) {
    for (const t of gt.sealedTiles) state.map[t.ty][t.tx] = T_FLOOR;
    rebuildMapCache();
    spawnRewards && spawnRewards(gt.room, gt.pedestal);
    gt.rewardGiven = true;
    gt.completed   = true;
    toast && toast('¡Secuencia perfecta! El tomo te recompensa.');
    Audio.upgrade && Audio.upgrade();
  }
}

/** Process one direction press in 'awaiting'. @private */
function handleInput(gt, dir, toast) {
  gt.inputTimer = 0;
  gt.flashKey = dir;
  gt.flashTimer = FLASH_TIME;

  const expected = gt.sequence[gt.inputIndex];
  if (dir === expected) {
    Audio.coin && Audio.coin();
    gt.inputIndex++;
    if (gt.inputIndex >= gt.sequence.length) {
      gt.state = 'success';
      gt.flashKey = null;
    }
    return;
  }

  // Wrong key → consume attempt.
  consumeAttempt(gt, toast, '¡Mal! Repite la secuencia.');
}

/** Consume one attempt; either restart the sequence or fail the puzzle. @private */
function consumeAttempt(gt, toast, reason) {
  gt.attempts++;
  Audio.hit && Audio.hit();
  if (gt.attempts >= gt.maxAttempts) {
    triggerFail(gt, toast);
    return;
  }
  // Reset input and replay the sequence.
  toast && toast(`${reason} (${gt.attempts}/${gt.maxAttempts})`);
  gt.state      = 'showing';
  gt.showIndex  = 0;
  gt.showTimer  = 0;
  gt.inputIndex = 0;
  gt.inputTimer = 0;
}

/** Failure: spawn a hostile wave that must be cleared to leave. @private */
function triggerFail(gt, toast) {
  gt.state = 'failed';
  toast && toast('El tomo se enfurece. ¡La sala se ha sellado!');
  state.shake = Math.max(state.shake || 0, 8);

  // Wave: ~6 enemies scaled by floor, mages + skeletons, scattered.
  const room = gt.room;
  const pool = ['skeleton', 'skeleton', 'mage'];
  const n = 6;
  for (let i = 0; i < n; i++) {
    let ex, ey, safety = 16;
    do {
      ex = (room.x + 1 + Math.floor(Math.random() * (room.w - 2))) * TILE + TILE / 2;
      ey = (room.y + 1 + Math.floor(Math.random() * (room.h - 2))) * TILE + TILE / 2;
      safety--;
    } while (safety > 0 && state.map[Math.floor(ey / TILE)][Math.floor(ex / TILE)] !== T_FLOOR);
    if (safety <= 0) continue;
    const e = createEnemy(pool[Math.floor(Math.random() * pool.length)], ex, ey, state.floor);
    e.room = room;
    e.fromGrandTome = true;
    state.enemies.push(e);
    spawnParticles(ex, ey, '#b890ff', 12);
  }
  gt.failWaveSpawned = true;
  Audio.enemyDie && Audio.enemyDie();
}

/**
 * Render an "[E] LEER EL TOMO" prompt above the pedestal while the
 * player is within reach and the puzzle has not started yet.
 */
export function drawTomePrompt(ctx) {
  const gt = state.grandTome;
  if (!gt || gt.state !== 'idle' || gt.completed) return;
  const at = pedestalUnderPlayer();
  if (!at) return;
  const cx = (gt.pedestal.tx + gt.pedestal.w / 2) * TILE - state.cameraX;
  const cy = (gt.pedestal.ty + gt.pedestal.h / 2) * TILE - state.cameraY;
  const pulse = 0.7 + 0.3 * Math.sin(state.time * 4);
  ctx.save();
  ctx.shadowColor = 'rgba(184,144,255,0.9)';
  ctx.shadowBlur  = 12;
  ctx.fillStyle   = `rgba(220, 200, 255, ${pulse})`;
  ctx.font        = 'bold 12px sans-serif';
  ctx.textAlign   = 'center';
  ctx.fillText('[E] LEER EL TOMO', cx, cy - 40);
  ctx.restore();
}

/**
 * Render the floating tome + the Simon-Says UI overlay. Called from the
 * main per-frame draw, AFTER the map and BEFORE lighting so the glow
 * gets the lighting pass.
 */
export function drawGrandTome(ctx) {
  const gt = state.grandTome;
  if (!gt) return;
  const cx = (gt.pedestal.tx + gt.pedestal.w / 2) * TILE - state.cameraX;
  const cy = (gt.pedestal.ty + gt.pedestal.h / 2) * TILE - state.cameraY;

  // Hovering tome above the pedestal (bobbing).
  const bob = Math.sin(state.time * 2.2) * 3;
  const tx = cx - 12, ty = cy - 30 + bob;
  ctx.save();
  // Halo.
  const halo = ctx.createRadialGradient(cx, cy - 24 + bob, 2, cx, cy - 24 + bob, 28);
  halo.addColorStop(0, 'rgba(184,144,255,0.55)');
  halo.addColorStop(1, 'rgba(184,144,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - 32, cy - 56 + bob, 64, 56);

  // Book body.
  ctx.fillStyle = '#5a3a1f';
  ctx.fillRect(tx, ty, 24, 16);
  ctx.fillStyle = '#3a2412';
  ctx.fillRect(tx, ty + 14, 24, 2);
  // Pages (glowing line down the middle).
  ctx.fillStyle = '#f0e0c0';
  ctx.fillRect(tx + 2, ty + 2, 20, 12);
  ctx.strokeStyle = 'rgba(120,80,160,0.6)';
  ctx.beginPath();
  ctx.moveTo(tx + 12, ty + 2);
  ctx.lineTo(tx + 12, ty + 14);
  ctx.stroke();
  // Rune glyph on the right page.
  ctx.fillStyle = 'rgba(140,90,200,0.85)';
  ctx.fillRect(tx + 15, ty + 5, 5, 1);
  ctx.fillRect(tx + 15, ty + 9, 5, 1);
  ctx.fillRect(tx + 17, ty + 5, 1, 5);
  ctx.restore();

  // Sequence UI: a horizontal strip of arrows above the pedestal.
  drawSequenceUI(ctx, gt, cx, cy + bob);
}

/** @private */
function drawSequenceUI(ctx, gt, cx, cy) {
  if (gt.state === 'idle' || gt.state === 'failed') return;
  const len = gt.sequence.length;
  if (!len) return;

  const STEP_W = 18;
  const stripW = len * STEP_W;
  const baseX  = cx - stripW / 2 + STEP_W / 2;
  const baseY  = cy - 64;

  // Attempts dots.
  ctx.save();
  for (let i = 0; i < gt.maxAttempts; i++) {
    ctx.fillStyle = i < (gt.maxAttempts - gt.attempts)
      ? 'rgba(184,144,255,0.9)' : 'rgba(60,40,80,0.6)';
    ctx.beginPath();
    ctx.arc(baseX + i * 10 - 12, baseY - 18, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  for (let i = 0; i < len; i++) {
    const x = baseX + i * STEP_W;
    const y = baseY;
    let active = false;
    let solved = false;
    if (gt.state === 'showing') {
      active = (i === gt.showIndex && gt.showTimer < SHOW_STEP);
    } else if (gt.state === 'awaiting') {
      solved = i < gt.inputIndex;
      if (i === gt.inputIndex && gt.flashTimer > 0 && gt.flashKey === gt.sequence[i]) {
        active = true;
      }
    } else if (gt.state === 'success') {
      solved = true;
      active = true;
    }
    drawArrowGlyph(ctx, x, y, gt.sequence[i],
      active ? '#ffffff' :
      solved ? '#c0a0ff' :
               'rgba(180,150,220,0.45)',
      active);
  }
}

/** @private */
function drawArrowGlyph(ctx, x, y, dir, color, glow) {
  ctx.save();
  if (glow) {
    ctx.shadowColor = '#e0c0ff';
    ctx.shadowBlur  = 10;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  const s = 7;
  if (dir === 'up') {
    ctx.moveTo(x,     y - s);
    ctx.lineTo(x + s, y + s);
    ctx.lineTo(x - s, y + s);
  } else if (dir === 'down') {
    ctx.moveTo(x,     y + s);
    ctx.lineTo(x + s, y - s);
    ctx.lineTo(x - s, y - s);
  } else if (dir === 'left') {
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y - s);
    ctx.lineTo(x + s, y + s);
  } else {
    ctx.moveTo(x + s, y);
    ctx.lineTo(x - s, y - s);
    ctx.lineTo(x - s, y + s);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
