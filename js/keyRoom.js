/**
 * keyRoom.js
 * --------------------------------------------------------------------------
 * Library "Sala de la Llave" set-piece (kill-all puzzle, v1).
 *
 * Flow:
 *   1. Player walks into a room flagged `isKeyRoom`.
 *   2. `updateKeyRoom` detects the entry, seals every entrance with
 *      walls and tags the encounter as `active`. Pre-placed enemies in
 *      the room are already marked `fromKeyRoom` by populateFloor.
 *   3. While `active`, the player must kill every `fromKeyRoom` enemy.
 *   4. When the count hits 0, the seals fall, a rune key pickup spawns
 *      at the room centre and a fanfare plays.
 *   5. The pickup, once collected, sets `state.hasArchiveKey = true`.
 *
 * The locked door of the Archivo Prohibido is opened in this module too:
 * if the player walks adjacent to the door tile while holding the key,
 * the tile flips to floor and the key is consumed.
 *
 * Three puzzle variants are planned (kill-all, runes, candles); only
 * `killAll` is wired up for now. The state object exposes a `puzzle`
 * field so future variants can branch off it.
 */

import { state }            from './state.js';
import { TILE, T_DOOR_LOCKED } from './config.js';
import { rebuildMapCache }  from './render.js';
import { Audio }            from './audio.js';
import { spawnParticles }   from './particles.js';

/* Tile constants — inlined to avoid a circular import with dungeon.js. */
const T_WALL  = 0;
const T_FLOOR = 1;

/** Reset the slot when the floor (re)builds. */
export function resetKeyRoom() {
  state.keyRoom = null;
  state.archiveDoor = null;
  state.hasArchiveKey = false;

  // Pick up the room and door references freshly each floor.
  if (!state.rooms) return;
  const room = state.rooms.find(r => r.isKeyRoom);
  if (room) {
    state.keyRoom = {
      room,
      state: 'idle',          // 'idle' | 'active' | 'completed'
      puzzle: 'killAll',      // future: 'runes' | 'candles'
      sealedTiles: [],
      keyDropped: false,
    };
  }
  const archive = state.rooms.find(r => r.isForbiddenArchive);
  if (archive && archive.doorTile) {
    state.archiveDoor = { tx: archive.doorTile.tx, ty: archive.doorTile.ty };
  }
}

/**
 * @private Find every floor tile just outside the room footprint
 * (= every entrance the corridor carver opened).
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

/** @private Player tile position. */
function playerTile() {
  const p = state.player;
  return { tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) };
}

/** @private Is the player standing inside `room`? */
function playerInside(room) {
  const { tx, ty } = playerTile();
  return tx >= room.x && tx < room.x + room.w &&
         ty >= room.y && ty < room.y + room.h;
}

/**
 * @private Is the player far enough from any entrance tile to safely
 * seal the room? The player's hitbox is a circle of radius `r`; if its
 * AABB still overlaps an entrance tile and we wrote a wall there, the
 * collision system would push the player outside the room — or worse,
 * trap them sliding against an instant wall. We require a 1-tile gap
 * (the entrance plus the room border) plus a small margin for the
 * hitbox radius.
 */
function playerSafeFromEntrances(entrances) {
  const p = state.player;
  if (!p) return false;
  const margin = (p.r || 10) + 2;
  for (const e of entrances) {
    const cx = (e.tx + 0.5) * TILE;
    const cy = (e.ty + 0.5) * TILE;
    // Manhattan check on tile distance: must be at least 2 tiles away
    // (one tile of room border + one tile of corridor entrance).
    const dx = Math.abs(p.x - cx);
    const dy = Math.abs(p.y - cy);
    if (dx < TILE + margin && dy < TILE + margin) return false;
  }
  return true;
}

/**
 * Per-frame update: drives the kill-all puzzle and the rune-locked
 * archive door.
 *
 * @param {number} dt
 * @param {(text: string) => void} toast
 */
export function updateKeyRoom(dt, toast) {
  // Locked-door check runs every frame regardless of the puzzle state.
  if (state.archiveDoor && state.hasArchiveKey) {
    const { tx, ty } = state.archiveDoor;
    if (state.map[ty] && state.map[ty][tx] === T_DOOR_LOCKED) {
      const p = state.player;
      const dx = (tx + 0.5) * TILE - p.x;
      const dy = (ty + 0.5) * TILE - p.y;
      if (Math.hypot(dx, dy) < TILE * 1.6) {
        state.map[ty][tx] = T_FLOOR;
        state.hasArchiveKey = false;
        rebuildMapCache();
        spawnParticles((tx + 0.5) * TILE, (ty + 0.5) * TILE, '#ffd040', 26);
        Audio.upgrade && Audio.upgrade();
        toast && toast('La puerta del Archivo se abre con la llave.');
      }
    }
  }

  const k = state.keyRoom;
  if (!k) return;

  if (k.state === 'idle') {
    if (!playerInside(k.room)) return;
    // Wait until the player has stepped fully clear of every entrance
    // before slamming the seals down — otherwise a wall can spawn on
    // top of the player's collision circle the very frame they cross
    // the threshold and trap them in the door.
    const entrances = findEntranceTiles(k.room);
    if (entrances.length === 0) return;
    if (!playerSafeFromEntrances(entrances)) return;
    k.sealedTiles = entrances;
    for (const t of k.sealedTiles) state.map[t.ty][t.tx] = T_WALL;
    k.state = 'active';
    rebuildMapCache();
    state.shake = Math.max(state.shake || 0, 5);
    spawnParticles(state.player.x, state.player.y - 6, '#80c0ff', 14);
    Audio.bossHit && Audio.bossHit();
    toast && toast('¡La sala se sella! Acaba con todos los enemigos.');
    return;
  }

  if (k.state === 'active') {
    const stillAlive = state.enemies.some(e => e.fromKeyRoom && !e.dead);
    if (stillAlive) return;
    // Wave cleared: tear down the seals and drop the rune key.
    for (const t of k.sealedTiles) state.map[t.ty][t.tx] = T_FLOOR;
    rebuildMapCache();
    if (!k.keyDropped) {
      state.loot.push({
        type: 'key',
        x:    k.room.cx * TILE + TILE / 2,
        y:    k.room.cy * TILE + TILE / 2,
        age:  0,
        r:    10,
        vx:   0,
        vy:   0,
      });
      k.keyDropped = true;
    }
    k.state = 'completed';
    spawnParticles(k.room.cx * TILE + TILE / 2, k.room.cy * TILE + TILE / 2, '#ffd040', 36);
    Audio.upgrade && Audio.upgrade();
    toast && toast('¡Sala liberada! La llave rúnica te espera.');
  }
}

/**
 * Render an "[!] Sala bloqueada" hint above the locked door while the
 * player is nearby and still hasn't earned the key.
 */
export function drawArchiveDoorPrompt(ctx) {
  if (!state.archiveDoor) return;
  if (state.hasArchiveKey) return;
  const { tx, ty } = state.archiveDoor;
  if (!state.map || state.map[ty]?.[tx] !== T_DOOR_LOCKED) return;
  const p = state.player;
  const cx = (tx + 0.5) * TILE;
  const cy = (ty + 0.5) * TILE;
  if (Math.hypot(p.x - cx, p.y - cy) > TILE * 2.4) return;
  const sx = cx - state.cameraX;
  const sy = cy - state.cameraY;
  const pulse = 0.7 + 0.3 * Math.sin(state.time * 4);
  ctx.save();
  ctx.shadowColor = 'rgba(255,180,80,0.9)';
  ctx.shadowBlur  = 10;
  ctx.fillStyle   = `rgba(255, 220, 160, ${pulse})`;
  ctx.font        = 'bold 12px sans-serif';
  ctx.textAlign   = 'center';
  ctx.fillText('Necesitas la llave rúnica', sx, sy - 28);
  ctx.restore();
}
