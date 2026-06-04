/**
 * challenge.js
 * --------------------------------------------------------------------------
 * Crypta challenge room (floor 2).
 *
 * Flow:
 *   1. Player walks onto the altar at the centre of the crypta and presses E.
 *   2. `startChallenge(room)` seals every entrance of the room with walls and
 *      schedules each cracked sarcophagus to "awaken" — opening its lid and
 *      spawning one Sepulchral elite that climbs out (invulnerable for the
 *      first ~0.9s of the rise animation).
 *   3. While the challenge runs, `state.challenge.active === true`. The
 *      altar's interaction prompt is hidden.
 *   4. Once every challenge-spawned enemy is dead, the seals fall and two
 *      rare reward chests drop next to the altar.
 *
 * The module owns very little state (just a small object on `state.challenge`)
 * and rewires nothing — it pokes `state.map`, `state.sarcophagi`, and pushes
 * to `state.enemies` / `state.loot`. The render system only needs to be told
 * to rebuild its tile cache when walls change, so we re-export the entry
 * point that does that.
 */

import { state }            from './state.js';
import { TILE }             from './config.js';
import { spawnSepulchralAt } from './enemies.js';
import { rebuildMapCache }  from './render.js';
import { Audio }            from './audio.js';
import { spawnParticles }   from './particles.js';

/* Tile constants — inlined to avoid a circular import with dungeon.js. */
const T_WALL = 0;
const T_FLOOR = 1;
const T_DOOR = 2;
const T_STAIR = 3;

/** Reset the challenge slot when the floor (re)builds. */
export function resetChallenge() {
  state.challenge = null;
}

/**
 * Try to detect whether the player is currently next to the crypta altar.
 * Used by player E-press handling. Returns the altar object (a sarcophagus
 * with `variant === 'altar'`) when within reach, else null.
 */
export function altarUnderPlayer() {
  if (!state.sarcophagi || !state.sarcophagi.length) return null;
  const p = state.player;
  for (const s of state.sarcophagi) {
    if (s.variant !== 'altar') continue;
    // 2×2 footprint centre.
    const cx = (s.tx + s.w / 2) * TILE;
    const cy = (s.ty + s.h / 2) * TILE;
    if (Math.hypot(p.x - cx, p.y - cy) < TILE * 1.6) return s;
  }
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
 * Find every cracked sarcophagus that lives inside `room`.
 * @private
 */
function crackedInRoom(room) {
  return state.sarcophagi.filter(s =>
    s.variant === 'cracked' &&
    s.tx >= room.x && s.tx < room.x + room.w &&
    s.ty >= room.y && s.ty < room.y + room.h,
  );
}

/**
 * Locate the room that contains the altar (the crypta). Returns null if
 * there is none on the current floor (e.g. floors without the catacombs
 * biome).
 * @private
 */
function findCryptaRoom() {
  const altar = state.sarcophagi.find(s => s.variant === 'altar');
  if (!altar) return null;
  const ax = altar.tx + altar.w / 2;
  const ay = altar.ty + altar.h / 2;
  return state.rooms.find(r =>
    ax >= r.x && ax <= r.x + r.w &&
    ay >= r.y && ay <= r.y + r.h,
  ) || null;
}

/**
 * Public entry point: invoked from the player E-handler. If the conditions
 * are right (altar within reach, no challenge already running, at least one
 * cracked sarcophagus left to awaken), starts the encounter.
 *
 * @param {(text: string) => void} toast  Toast notifier (from ui.js).
 * @returns {boolean} true if a challenge actually started this frame.
 */
export function tryStartChallenge(toast) {
  if (state.challenge && state.challenge.active) return false;
  if (state.challenge && state.challenge.completed) return false;

  const altar = altarUnderPlayer();
  if (!altar) return false;

  const room = findCryptaRoom();
  if (!room) return false;

  const cracked = crackedInRoom(room);
  if (!cracked.length) {
    toast && toast('El altar está silencioso.');
    return false;
  }

  /* Seal the room. Save every changed tile so we can restore it later. */
  const sealed = findEntranceTiles(room);
  for (const t of sealed) {
    state.map[t.ty][t.tx] = T_WALL;
  }

  /* Schedule one awakening per cracked sarcophagus, staggered so they don't
     all rise on the same frame. */
  const queue = cracked.map((s, i) => ({ sarc: s, at: 0.6 + i * 0.55 }));

  state.challenge = {
    active: true,
    completed: false,
    room,
    sealedTiles: sealed,
    awakenQueue: queue,
    timer: 0,
    rewardGiven: false,
  };

  // Cosmetic punch.
  state.shake = Math.max(state.shake || 0, 6);
  spawnParticles(state.player.x, state.player.y - 6, '#a8c8ff', 14);
  Audio.bossHit && Audio.bossHit();
  toast && toast('La cripta se ha cerrado…');
  rebuildMapCache();
  return true;
}

/** @private Awaken a single cracked sarcophagus and spawn a Sepulchral. */
function awakenSarcophagus(s) {
  s.awakened = true;
  s.variant  = 'opened';
  // Free up the footprint so the new enemy can walk out of it.
  for (let yy = s.ty; yy < s.ty + s.h; yy++) {
    for (let xx = s.tx; xx < s.tx + s.w; xx++) {
      if (state.map[yy] && state.map[yy][xx] === T_WALL) {
        state.map[yy][xx] = T_FLOOR;
      }
    }
  }
  const wx = (s.tx + s.w / 2) * TILE;
  const wy = (s.ty + s.h / 2) * TILE;
  const enemy = spawnSepulchralAt(wx, wy, state.floor);
  enemy.room = state.challenge ? state.challenge.room : null;
  state.shake = Math.max(state.shake || 0, 5);
  Audio.enemyDie && Audio.enemyDie();
}

/**
 * Per-frame update for the active challenge. Drives the awakening queue
 * and detects completion (= every spawned enemy is dead).
 *
 * @param {number} dt
 * @param {(text: string) => void} toast
 */
export function updateChallenge(dt, toast) {
  const c = state.challenge;
  if (!c || !c.active) return;
  c.timer += dt;

  // Spawn pending sepulcrals.
  while (c.awakenQueue.length && c.awakenQueue[0].at <= c.timer) {
    awakenSarcophagus(c.awakenQueue.shift().sarc);
  }

  // Don't check completion until everything has at least been spawned.
  if (c.awakenQueue.length) return;

  const stillAlive = state.enemies.some(e => e.fromChallenge && !e.dead);
  if (stillAlive) return;

  /* Victory: tear down the seals and drop the reward chests. */
  for (const t of c.sealedTiles) {
    state.map[t.ty][t.tx] = T_FLOOR;
  }
  rebuildMapCache();
  spawnRewardChests(c.room);
  c.active = false;
  c.completed = true;
  c.rewardGiven = true;
  toast && toast('¡Cripta superada! Recompensas aparecen junto al altar.');
  Audio.upgrade && Audio.upgrade();
}

/**
 * Render an "[E] DESPERTAR LA CRIPTA" prompt above the altar while the
 * player is within reach and the challenge has not been started yet.
 * Drawn in the world space pass (between sprites and lighting).
 */
export function drawAltarPrompt(ctx) {
  if (state.challenge && (state.challenge.active || state.challenge.completed)) return;
  const altar = altarUnderPlayer();
  if (!altar) return;
  const cx = (altar.tx + altar.w / 2) * TILE - state.cameraX;
  const cy = (altar.ty + altar.h / 2) * TILE - state.cameraY;
  const pulse = 0.7 + 0.3 * Math.sin(state.time * 4);
  ctx.save();
  ctx.shadowColor = 'rgba(140,200,255,0.9)';
  ctx.shadowBlur  = 10;
  ctx.fillStyle = `rgba(190, 225, 255, ${pulse})`;
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('[E] DESPERTAR LA CRIPTA', cx, cy - 36);
  ctx.restore();
}

/**
 * Drop two rare reward chests near the altar.
 * @private
 */
function spawnRewardChests(room) {
  const cx = room.cx, cy = room.cy;
  const offsets = [
    { dx: -2, dy: 0 }, { dx: 2, dy: 0 },
    { dx: 0, dy: -2 }, { dx: 0, dy: 2 },
    { dx: -2, dy: -2 }, { dx: 2, dy: 2 },
  ];
  let placed = 0;
  for (const o of offsets) {
    if (placed >= 2) break;
    const tx = cx + o.dx;
    const ty = cy + o.dy;
    if (!state.map[ty] || state.map[ty][tx] !== T_FLOOR) continue;
    state.loot.push({
      type: 'chest', opened: false,
      rare: true,
      cost: 0,                         // free reward — already earned.
      x: tx * TILE + TILE / 2,
      y: ty * TILE + TILE / 2,
      age: 0, r: 12, vx: 0, vy: 0,
      fromChallenge: true,
    });
    placed++;
  }
}
