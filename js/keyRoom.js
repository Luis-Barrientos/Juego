/**
 * keyRoom.js
 * --------------------------------------------------------------------------
 * Library "Sala de la Llave" set-piece. The room hosts one of several
 * puzzles; clearing it spawns a rune key pickup that opens the locked
 * door of the Archivo Prohibido.
 *
 * Implemented variants:
 *   • 'kill' — every entrance seals, an extra wave spawns inside,
 *              clearing them all drops the key. (Original v1 puzzle.)
 *   • 'rune' — every entrance seals; four rune pedestals stand around
 *              the dais arranged as two matching pairs. Press E on a
 *              pedestal to light its rune; light two with the same rune
 *              to validate them (they turn green). Mismatches flash red
 *              and reset. Validating all four pedestals completes the
 *              puzzle and drops the key.
 *
 * Both variants share the seal-on-entry behaviour, the key drop and the
 * locked-door logic. A future 'candle' variant will plug in here too.
 */

import { state }              from './state.js';
import { TILE, T_DOOR_LOCKED } from './config.js';
import { rebuildMapCache }    from './render.js';
import { Audio }              from './audio.js';
import { spawnParticles }     from './particles.js';

/* Tile constants — inlined to avoid a circular import with dungeon.js. */
const T_WALL  = 0;
const T_FLOOR = 1;

/** Visual palette for the two rune families used by the 'rune' variant. */
const RUNE_COLORS = [
  { dim: [120, 180, 255], lit: [200, 230, 255] }, // azul claro
  { dim: [255, 140, 80],  lit: [255, 220, 160] }, // naranja cálido
];
const RUNE_VALIDATED = [120, 230, 140]; // verde validado
const RUNE_MISMATCH  = [255, 90,  80];  // rojo error
const MISMATCH_HOLD  = 0.6;             // segundos que parpadea el error

/** Reset the slot when the floor (re)builds. */
export function resetKeyRoom() {
  state.keyRoom = null;
  state.archiveDoor = null;
  state.hasArchiveKey = false;

  if (!state.rooms) return;
  const room = state.rooms.find(r => r.isKeyRoom);
  if (room) {
    const variant = room.keyVariant || 'kill';
    state.keyRoom = {
      room,
      variant,
      state: 'idle',          // 'idle' | 'active' | 'completed'
      sealedTiles: [],
      keyDropped: false,

      // Rune-puzzle live state. For 'kill' these stay empty/unused.
      pedestals: (room.keyPedestals || []).map(p => ({
        tx: p.tx, ty: p.ty,
        runeId: p.runeId,
        picked: false,
        validated: false,
        mismatch: false,
      })),
      pickedIdx:     -1,
      mismatchTimer: 0,
      mismatchA:     -1,
      mismatchB:     -1,
    };
  }
  const archive = state.rooms.find(r => r.isForbiddenArchive);
  if (archive && archive.doorTile) {
    state.archiveDoor = { tx: archive.doorTile.tx, ty: archive.doorTile.ty };
  }
}

/* ─────────────────────────── helpers ─────────────────────────── */

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
 * seal the room without trapping them in the door?
 */
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

/** @private Pedestal centre in world coords. */
function pedestalCentre(ped) {
  return { x: (ped.tx + 0.5) * TILE, y: (ped.ty + 0.5) * TILE };
}

/** @private Index of the pedestal closest to the player within reach. */
function nearestPedestalInRange(k) {
  if (!k.pedestals.length) return -1;
  const p = state.player;
  let best = -1, bestD = TILE * 1.6;
  for (let i = 0; i < k.pedestals.length; i++) {
    const c = pedestalCentre(k.pedestals[i]);
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/* ─────────────────────────── shared transitions ─────────────────────────── */

/** @private Drop the rune key in the centre of the room (idempotent). */
function dropKey(k, toast) {
  if (k.keyDropped) return;
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
  spawnParticles(k.room.cx * TILE + TILE / 2, k.room.cy * TILE + TILE / 2, '#ffd040', 36);
  Audio.upgrade && Audio.upgrade();
  toast && toast('¡Sala liberada! La llave rúnica te espera.');
}

/** @private Knock down the seals and complete the puzzle. */
function completePuzzle(k, toast) {
  for (const t of k.sealedTiles) state.map[t.ty][t.tx] = T_FLOOR;
  rebuildMapCache();
  dropKey(k, toast);
  k.state = 'completed';
}

/* ─────────────────────────── public update ─────────────────────────── */

/**
 * Per-frame update: drives whichever puzzle variant is active plus the
 * rune-locked archive door.
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
    if (k.variant === 'rune') {
      toast && toast('¡La sala se sella! Empareja las runas de los pedestales.');
    } else {
      toast && toast('¡La sala se sella! Acaba con todos los enemigos.');
    }
    return;
  }

  if (k.state !== 'active') return;

  if (k.variant === 'rune') {
    if (k.mismatchTimer > 0) {
      k.mismatchTimer = Math.max(0, k.mismatchTimer - dt);
      if (k.mismatchTimer === 0) {
        if (k.mismatchA >= 0) {
          const a = k.pedestals[k.mismatchA];
          a.picked = false; a.mismatch = false;
        }
        if (k.mismatchB >= 0) {
          const b = k.pedestals[k.mismatchB];
          b.picked = false; b.mismatch = false;
        }
        k.mismatchA = -1; k.mismatchB = -1;
      }
    }
    if (k.pedestals.length > 0 && k.pedestals.every(p => p.validated)) {
      completePuzzle(k, toast);
    }
    return;
  }

  // 'kill' variant.
  const stillAlive = state.enemies.some(e => e.fromKeyRoom && !e.dead);
  if (!stillAlive) completePuzzle(k, toast);
}

/* ─────────────────────────── E-handler ─────────────────────────── */

/**
 * Player E-handler hook. If the player is standing next to a rune
 * pedestal while the puzzle is active, light it (and resolve pair
 * matches). Returns true when the press was consumed.
 */
export function tryActivateKeyPedestal() {
  const k = state.keyRoom;
  if (!k || k.variant !== 'rune') return false;
  if (k.state !== 'active') return false;
  if (k.mismatchTimer > 0) return false;

  const idx = nearestPedestalInRange(k);
  if (idx < 0) return false;
  const ped = k.pedestals[idx];
  if (ped.validated || ped.picked) return false;

  ped.picked = true;
  spawnParticles((ped.tx + 0.5) * TILE, (ped.ty + 0.5) * TILE,
    rgb(RUNE_COLORS[ped.runeId].lit), 10);
  Audio.bossHit && Audio.bossHit();

  if (k.pickedIdx < 0) {
    k.pickedIdx = idx;
  } else {
    const otherIdx = k.pickedIdx;
    const other    = k.pedestals[otherIdx];
    k.pickedIdx = -1;
    if (other.runeId === ped.runeId) {
      other.validated = true;
      ped.validated   = true;
      spawnParticles((ped.tx + 0.5) * TILE, (ped.ty + 0.5) * TILE,
        rgb(RUNE_VALIDATED), 22);
      Audio.upgrade && Audio.upgrade();
    } else {
      other.mismatch = true;
      ped.mismatch   = true;
      k.mismatchA    = otherIdx;
      k.mismatchB    = idx;
      k.mismatchTimer = MISMATCH_HOLD;
    }
  }
  return true;
}

/* ─────────────────────────── render ─────────────────────────── */

/**
 * Render the rune pedestals (live overlay — colour reacts to puzzle
 * state, so they can't be baked into the static map cache).
 */
export function drawKeyPedestals(ctx) {
  const k = state.keyRoom;
  if (!k || k.variant !== 'rune') return;
  const t = state.time || 0;
  for (const ped of k.pedestals) {
    drawRunePedestal(ctx, ped, t);
  }
  if (k.state === 'active' && k.mismatchTimer === 0) {
    const idx = nearestPedestalInRange(k);
    if (idx >= 0 && !k.pedestals[idx].validated && !k.pedestals[idx].picked) {
      const ped = k.pedestals[idx];
      const c   = pedestalCentre(ped);
      const sx  = c.x - state.cameraX;
      const sy  = c.y - state.cameraY;
      const pulse = 0.6 + 0.4 * Math.sin(t * 5);
      ctx.save();
      ctx.fillStyle = `rgba(255, 220, 160, ${pulse})`;
      ctx.font      = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur  = 4;
      ctx.fillText('[E]', sx, sy - 22);
      ctx.restore();
    }
  }
}

/** @private Pick the colour the pedestal should currently glow with. */
function pedestalGlowColor(ped, time) {
  if (ped.validated) return RUNE_VALIDATED;
  if (ped.mismatch)  return RUNE_MISMATCH;
  if (ped.picked)    return RUNE_COLORS[ped.runeId].lit;
  const a = 0.5 + 0.5 * Math.sin(time * 2 + ped.tx + ped.ty);
  const dim = RUNE_COLORS[ped.runeId].dim;
  const lit = RUNE_COLORS[ped.runeId].lit;
  return [
    dim[0] + (lit[0] - dim[0]) * a * 0.3,
    dim[1] + (lit[1] - dim[1]) * a * 0.3,
    dim[2] + (lit[2] - dim[2]) * a * 0.3,
  ];
}

/** @private Paint one pedestal: hex base + floating rune disc on top. */
function drawRunePedestal(ctx, ped, time) {
  const c  = pedestalCentre(ped);
  const sx = c.x - state.cameraX;
  const sy = c.y - state.cameraY;
  const r  = TILE * 0.42;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.55, r * 0.95, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  const baseGrad = ctx.createLinearGradient(sx, sy - r, sx, sy + r);
  baseGrad.addColorStop(0, '#5a4838');
  baseGrad.addColorStop(1, '#2a1f14');
  ctx.fillStyle   = baseGrad;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const px = sx + Math.cos(a) * r;
    const py = sy + Math.sin(a) * r * 0.78;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 220, 160, 0.18)';
  ctx.beginPath();
  ctx.ellipse(sx, sy - r * 0.18, r * 0.78, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  const col = pedestalGlowColor(ped, time);
  const bob = Math.sin(time * 2 + ped.tx * 0.7) * 1.5;
  const ry  = sy - r * 0.55 + bob;
  const glow = `rgba(${col[0]|0}, ${col[1]|0}, ${col[2]|0}, 0.9)`;
  ctx.shadowColor = glow;
  ctx.shadowBlur  = 14;
  ctx.fillStyle   = glow;
  ctx.beginPath();
  ctx.arc(sx, ry, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur  = 0;

  ctx.strokeStyle = 'rgba(20, 10, 0, 0.85)';
  ctx.lineWidth   = 1.6;
  ctx.beginPath();
  if (ped.runeId === 0) {
    const s = r * 0.22;
    ctx.moveTo(sx,     ry - s);
    ctx.lineTo(sx - s, ry + s * 0.7);
    ctx.lineTo(sx + s, ry + s * 0.7);
    ctx.closePath();
  } else {
    const s = r * 0.24;
    ctx.moveTo(sx,     ry - s);
    ctx.lineTo(sx + s, ry);
    ctx.lineTo(sx,     ry + s);
    ctx.lineTo(sx - s, ry);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}

/** @private Format an [r,g,b] tuple as a CSS rgb string. */
function rgb([r, g, b]) {
  return `rgb(${r|0}, ${g|0}, ${b|0})`;
}

/**
 * Render an "[!] Necesitas la llave rúnica" hint above the locked door
 * while the player is nearby and still hasn't earned the key.
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
