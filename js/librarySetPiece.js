/**
 * librarySetPiece.js
 * --------------------------------------------------------------------------
 * Library "Gran Biblioteca" set-piece (floor 2).
 *
 * Flow:
 *   1. Player walks onto the rune circle at the centre of the great
 *      library and presses E.
 *   2. `startEvent(setPiece)` seals every entrance of the room and animates
 *      the surrounding rune stones converging onto the centre. While the
 *      stones fly inward, particles trail behind them.
 *   3. When the stones reach the circle, the Guardian of the Library is
 *      spawned at the centre with an emerge animation (invulnerable for
 *      the rise).
 *   4. While `state.librarySetPiece.active === true` the prompt is hidden.
 *   5. Once the Guardian is dead the seals fall and the rewards drop:
 *      two rare chests + one legendary chest near the circle.
 *
 * The module owns a small slot on `state.librarySetPiece`. Generation in
 * `dungeon.js` populates the room/circle/stones; we just animate and
 * resolve the encounter here.
 */

import { state }            from './state.js';
import { TILE }             from './config.js';
import { spawnGuardianAt }  from './enemies.js';
import { rebuildMapCache }  from './render.js';
import { Audio }            from './audio.js';
import { spawnParticles }   from './particles.js';

/* Tile constants — inlined to avoid a circular import with dungeon.js. */
const T_WALL  = 0;
const T_FLOOR = 1;

/** Reset the slot when the floor (re)builds. */
export function resetLibraryEvent() {
  // Generation in dungeon.js owns this object; we only clear it when the
  // floor doesn't actually have one.
  if (!state.librarySetPiece) state.librarySetPiece = null;
}

/**
 * Try to detect whether the player is currently on the summoning circle.
 * Returns the set-piece object when within reach, else null.
 */
export function circleUnderPlayer() {
  const sp = state.librarySetPiece;
  if (!sp || !sp.circle) return null;
  const p = state.player;
  const cx = (sp.circle.tx + sp.circle.w / 2) * TILE;
  const cy = (sp.circle.ty + sp.circle.h / 2) * TILE;
  if (Math.hypot(p.x - cx, p.y - cy) < TILE * 1.6) return sp;
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
    if (map[y0] && map[y0][x] === T_FLOOR)  out.push({ tx: x, ty: y0 });
    if (map[y1] && map[y1][x] === T_FLOOR)  out.push({ tx: x, ty: y1 });
  }
  for (let y = room.y; y < room.y + room.h; y++) {
    if (map[y] && map[y][x0] === T_FLOOR)   out.push({ tx: x0, ty: y });
    if (map[y] && map[y][x1] === T_FLOOR)   out.push({ tx: x1, ty: y });
  }
  return out;
}

/**
 * Public entry point: invoked from the player E-handler. If conditions
 * are right (circle within reach, no event already running, not yet
 * completed), starts the encounter.
 *
 * @param {(text: string) => void} toast  Toast notifier (from ui.js).
 * @returns {boolean} true if an event actually started this frame.
 */
export function tryStartLibraryEvent(toast) {
  const sp = circleUnderPlayer();
  if (!sp) return false;
  if (sp.active || sp.completed) return false;

  // Seal the room and remember every changed tile.
  const sealed = findEntranceTiles(sp.room);
  for (const t of sealed) state.map[t.ty][t.tx] = T_WALL;

  // Snapshot rune stones for the converge animation.
  const cx = (sp.circle.tx + sp.circle.w / 2) * TILE;
  const cy = (sp.circle.ty + sp.circle.h / 2) * TILE;
  for (const s of sp.stones) {
    s.startX = s.x;
    s.startY = s.y;
    s.targetX = cx;
    s.targetY = cy;
  }

  sp.active = true;
  sp.completed = false;
  sp.sealedTiles = sealed;
  sp.timer = 0;
  sp.guardianSpawned = false;
  sp.rewardGiven = false;

  state.shake = Math.max(state.shake || 0, 6);
  spawnParticles(cx, cy, '#b890ff', 28);
  Audio.bossHit && Audio.bossHit();
  toast && toast('Las piedras rúnicas se elevan…');
  rebuildMapCache();
  return true;
}

/**
 * Per-frame update: drives stone convergence and detects victory.
 *
 * @param {number} dt
 * @param {(text: string) => void} toast
 * @param {(room: object) => void} spawnRewards  Callback to drop chests.
 */
export function updateLibraryEvent(dt, toast, spawnRewards) {
  const sp = state.librarySetPiece;
  if (!sp || !sp.active) return;
  sp.timer += dt;

  // Stones converge toward the centre over CONVERGE_T seconds, then the
  // Guardian materialises at the circle.
  const CONVERGE_T = 1.2;
  if (!sp.guardianSpawned) {
    const t = Math.min(1, sp.timer / CONVERGE_T);
    const ease = t * t * (3 - 2 * t);   // smoothstep
    for (const s of sp.stones) {
      s.x = s.startX + (s.targetX - s.startX) * ease;
      s.y = s.startY + (s.targetY - s.startY) * ease;
      // Trailing sparks.
      if (Math.random() < 0.5) {
        spawnParticles(s.x, s.y, '#b890ff', 1);
      }
    }
    if (t >= 1) {
      const cx = (sp.circle.tx + sp.circle.w / 2) * TILE;
      const cy = (sp.circle.ty + sp.circle.h / 2) * TILE;
      const guardian = spawnGuardianAt(cx, cy, state.floor);
      guardian.room = sp.room;
      sp.guardianSpawned = true;
      sp.guardian = guardian;
      // Hide the rune stones — they "are" the guardian now.
      sp.stonesHidden = true;
      state.shake = Math.max(state.shake || 0, 8);
      Audio.enemyDie && Audio.enemyDie();
    }
    return;
  }

  // Wait for the guardian to die.
  if (sp.guardian && !sp.guardian.dead) return;

  // Victory: tear down the seals, drop the rewards.
  for (const t of sp.sealedTiles) state.map[t.ty][t.tx] = T_FLOOR;
  rebuildMapCache();
  spawnRewards && spawnRewards(sp.room, sp.circle);
  sp.active = false;
  sp.completed = true;
  sp.rewardGiven = true;
  toast && toast('¡Guardián vencido! La biblioteca calla por fin.');
  Audio.upgrade && Audio.upgrade();
}

/**
 * Render an "[E] DESPERTAR AL GUARDIÁN" prompt above the circle while the
 * player is within reach and the event has not been started yet.
 */
export function drawCirclePrompt(ctx) {
  const sp = state.librarySetPiece;
  if (!sp || sp.active || sp.completed) return;
  const at = circleUnderPlayer();
  if (!at) return;
  const cx = (sp.circle.tx + sp.circle.w / 2) * TILE - state.cameraX;
  const cy = (sp.circle.ty + sp.circle.h / 2) * TILE - state.cameraY;
  const pulse = 0.7 + 0.3 * Math.sin(state.time * 4);
  ctx.save();
  ctx.shadowColor = 'rgba(184,144,255,0.9)';
  ctx.shadowBlur  = 12;
  ctx.fillStyle = `rgba(220, 200, 255, ${pulse})`;
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('[E] DESPERTAR AL GUARDIÁN', cx, cy - 36);
  ctx.restore();
}
