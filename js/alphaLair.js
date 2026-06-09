/**
 * alphaLair.js
 * --------------------------------------------------------------------------
 * Ruins floor "Alpha Wolf Lair" set-piece.
 *
 * Flow:
 *   1. Enemies (Alpha + 3 wolves) are pre-spawned at build time via
 *      alphaLairSpawns on the room object (populateFloor in enemies.js).
 *   2. Player enters the star room marked as isAlphaLair.
 *   3. Room seals (entrances become walls).
 *   4. Territorial: if player leaves room, Alpha heals to full and disengages.
 *   5. Alpha enrages at <50% HP: projectile fan + nova ring.
 *   6. Once all enemies (Alpha + spawned wolves) are dead, seals drop
 *      and a legendary chest appears at room center.
 */

import { state }              from './state.js';
import { TILE, T_WALL, T_FLOOR } from './config.js';
import { rebuildMapCache }    from './render.js';
import { Audio }              from './audio.js';
import { spawnParticles }     from './particles.js';

/** Reset the slot when the floor (re)builds. */
export function resetAlphaLair() {
  if (!state.rooms) return;
  const room = state.rooms.find(r => r.isAlphaLair);
  if (room) {
    state.alphaLair = {
      room,
      state: 'idle',          // 'idle' | 'active' | 'completed'
      sealedTiles: [],
      alphaDead: false,
      chestSpawned: false,
    };
  } else {
    state.alphaLair = null;
  }
}

/* ─────────────────────────── helpers ─────────────────────────── */

/** Find every floor tile just outside the room footprint (= entrances). */
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

/** Player tile position. */
function playerTile() {
  const p = state.player;
  return { tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) };
}

/** Is the player inside `room`? */
function playerInside(room) {
  const { tx, ty } = playerTile();
  return tx >= room.x && tx < room.x + room.w &&
         ty >= room.y && ty < room.y + room.h;
}

/** Is the player far enough from entrances to safely seal? */
function playerSafeFromEntrances(entrances) {
  const p = state.player;
  if (!p) return false;
  const margin = (p.r || 10) + 2;
  for (const e of entrances) {
    const cx = (e.tx + 0.5) * TILE;
    const cy = (e.ty + 0.5) * TILE;
    const dx = Math.abs(p.x - cx);
    const dy = Math.abs(p.y - cy);
    if (dx < TILE + margin && dy < TILE + margin) return false;
  }
  return true;
}

/** Drop legendary chest at room center (idempotent). */
function dropChest(a, toast) {
  if (a.chestSpawned) return;
  state.loot.push({
    type: 'chest',
    x:    a.room.cx * TILE + TILE / 2,
    y:    a.room.cy * TILE + TILE / 2,
    age:  0,
    r:    12,
    vx:   0,
    vy:   0,
    rare: false,
    legendary: true,
    cost: 0,
    fromAlphaLair: true,
  });
  a.chestSpawned = true;
  spawnParticles(a.room.cx * TILE + TILE / 2, a.room.cy * TILE + TILE / 2, '#ffd040', 36);
  Audio.upgrade && Audio.upgrade();
  toast && toast('¡La Guarida del Alfa ha caído! Un cofre legendario aparece.');
}

/** Knock down seals and complete. */
function completeLair(a, toast) {
  for (const t of a.sealedTiles) state.map[t.ty][t.tx] = T_FLOOR;
  rebuildMapCache();
  dropChest(a, toast);
  a.state = 'completed';
}

/* ─────────────────────────── public update ─────────────────────────── */

/**
 * Per-frame update: drives the Alpha Lair encounter.
 * @param {number} dt
 * @param {(text: string) => void} toast
 */
export function updateAlphaLair(dt, toast) {
  const a = state.alphaLair;
  if (!a) return;

  if (a.state === 'idle') {
    if (!playerInside(a.room)) return;
    const entrances = findEntranceTiles(a.room);
    if (entrances.length === 0) return;
    if (!playerSafeFromEntrances(entrances)) return;

    // Seal the room
    a.sealedTiles = entrances;
    for (const t of a.sealedTiles) state.map[t.ty][t.tx] = T_WALL;
    a.state = 'active';
    rebuildMapCache();

    state.shake = Math.max(state.shake || 0, 6);
    spawnParticles(state.player.x, state.player.y - 6, '#a08050', 16);
    Audio.bossHit && Audio.bossHit();
    toast && toast('¡Un aullido helador resuena! El Alfa ha despertado.');
    return;
  }

  if (a.state !== 'active') return;

  // Check victory: all enemies from this lair are dead
  const stillAlive = state.enemies.some(e =>
    (e.fromAlphaLair || e.fromAlpha) && !e.dead
  );

  if (!stillAlive && !a.alphaDead) {
    a.alphaDead = true;
    completeLair(a, toast);
  }
}