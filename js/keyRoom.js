/**
 * keyRoom.js
 * --------------------------------------------------------------------------
 * Library "Sala de la Llave" set-piece. The room hosts one of several
 * puzzles; clearing it spawns a rune key pickup that opens the locked
 * door(s) of the Archivo Prohibido.
 *
 * Implemented variants:
 *   • 'kill' — every entrance seals, an extra wave spawns inside,
 *              clearing them all drops the key.
 *   • 'rune' — stand on the central dais and hit the four rune pedestals
 *              with magic projectiles to match pairs.
 *   • 'candle' — press E on five candles around the room in the correct
 *              sequence. A mistake resets the sequence.
 *
 * All variants share the seal-on-entry behaviour, the key drop and the
 * locked-door logic.
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

/** Tiles from room centre the player must stay within to keep runes active. */
const CENTER_RADIUS = 1.6;

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

      // Rune-puzzle live state. For 'kill' and 'candle' these stay empty.
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

      // Candle-puzzle live state. For 'kill' and 'rune' these stay empty.
      candles: (room.keyCandles || []).map(c => ({
        tx: c.tx, ty: c.ty,
        index: c.index,
        lit: false,
      })),
      candleSeq:    room.keyCandleSeq || [],
      candleStep:   0,
      candleMistakeTimer: 0,
    };
  }
  const archive = state.rooms.find(r => r.isForbiddenArchive);
  if (archive && archive.doorTiles && archive.doorTiles.length > 0) {
    state.archiveDoor = archive.doorTiles.map(d => ({ tx: d.tx, ty: d.ty }));
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

/** @private Is the player close enough to the room centre to activate runes? */
function isPlayerInCenter(k) {
  const cx = (k.room.cx + 0.5) * TILE;
  const cy = (k.room.cy + 0.5) * TILE;
  const p  = state.player;
  if (!p) return false;
  return Math.hypot(p.x - cx, p.y - cy) < TILE * CENTER_RADIUS;
}

/** @private Pedestal centre in world coords. */
function pedestalCentre(ped) {
  return { x: (ped.tx + 0.5) * TILE, y: (ped.ty + 0.5) * TILE };
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
  if (state.archiveDoor && state.archiveDoor.length > 0 && state.hasArchiveKey) {
    const p = state.player;
    if (!p) return;
    for (const door of state.archiveDoor) {
      const { tx, ty } = door;
      if (!state.map[ty] || state.map[ty][tx] !== T_DOOR_LOCKED) continue;
      const dx = (tx + 0.5) * TILE - p.x;
      const dy = (ty + 0.5) * TILE - p.y;
      if (Math.hypot(dx, dy) < TILE * 1.6) {
        // Unlock ALL archive doors.
        for (const d of state.archiveDoor) {
          if (state.map[d.ty] && state.map[d.ty][d.tx] === T_DOOR_LOCKED) {
            state.map[d.ty][d.tx] = T_FLOOR;
          }
        }
        state.hasArchiveKey = false;
        rebuildMapCache();
        spawnParticles((tx + 0.5) * TILE, (ty + 0.5) * TILE, '#ffd040', 26);
        Audio.upgrade && Audio.upgrade();
        toast && toast('¡La puerta del Archivo se abre con la llave!');
        break;
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
    } else if (k.variant === 'candle') {
      toast && toast('¡La sala se sella! Enciende las velas en el orden correcto.');
    } else {
      toast && toast('¡La sala se sella! Acaba con todos los enemigos.');
    }
    return;
  }

  if (k.state !== 'active') return;

  if (k.variant === 'rune') {
    // If the player leaves the centre dais, drop any unvalidated picks.
    if (!isPlayerInCenter(k)) {
      if (k.pickedIdx >= 0) {
        const ped = k.pedestals[k.pickedIdx];
        ped.picked = false;
        k.pickedIdx = -1;
      }
      // Also cancel mismatch animation early — the runes go quiet.
      if (k.mismatchTimer > 0) {
        k.mismatchTimer = 0;
        if (k.mismatchA >= 0) {
          k.pedestals[k.mismatchA].picked = false;
          k.pedestals[k.mismatchA].mismatch = false;
        }
        if (k.mismatchB >= 0) {
          k.pedestals[k.mismatchB].picked = false;
          k.pedestals[k.mismatchB].mismatch = false;
        }
        k.mismatchA = -1; k.mismatchB = -1;
      }
    }
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

  // 'candle' variant — mistake timer reset.
  if (k.variant === 'candle') {
    if (k.candleMistakeTimer > 0) {
      k.candleMistakeTimer = Math.max(0, k.candleMistakeTimer - dt);
      if (k.candleMistakeTimer === 0) {
        // Reset all candles and sequence.
        for (const c of k.candles) c.lit = false;
        k.candleStep = 0;
      }
    }
    if (k.candleStep >= k.candles.length) {
      completePuzzle(k, toast);
    }
    return;
  }

  // 'kill' variant.
  const stillAlive = state.enemies.some(e => e.fromKeyRoom && !e.dead);
  if (!stillAlive) completePuzzle(k, toast);
}

/* ─────────────────────────── projectile handler ─────────────────────────── */

/**
 * Called when a friendly projectile lands on tile (tx, ty). If that tile
 * holds an unvalidated rune pedestal and the player is on the centre dais,
 * light it (and resolve pair matches). Returns true when the hit was
 * consumed.
 */
export function hitRunePedestal(tx, ty) {
  const k = state.keyRoom;
  if (!k || k.variant !== 'rune') return false;
  if (k.state !== 'active') return false;
  if (k.mismatchTimer > 0) return false;
  if (!isPlayerInCenter(k)) return false;

  const idx = k.pedestals.findIndex(p => p.tx === tx && p.ty === ty);
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

/* ─────────────────────────── candle E-handler ─────────────────────────── */

/** @private Find the candle closest to the player within reach. */
function nearestCandleInRange(k) {
  if (!k.candles.length) return -1;
  const p = state.player;
  let best = -1, bestD = TILE * 1.6;
  for (let i = 0; i < k.candles.length; i++) {
    const c = k.candles[i];
    const cx = (c.tx + 0.5) * TILE;
    const cy = (c.ty + 0.5) * TILE;
    const d  = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Player E-handler for the candle puzzle. If the player is near a
 * candle, lights it and checks if it's the next in sequence.
 */
export function tryLightCandle() {
  const k = state.keyRoom;
  if (!k || k.variant !== 'candle') return false;
  if (k.state !== 'active') return false;
  if (k.candleMistakeTimer > 0) return false;

  const idx = nearestCandleInRange(k);
  if (idx < 0) return false;
  const c = k.candles[idx];
  if (c.lit) return false;

  // Check if this candle is the next in sequence.
  const expectedIdx = k.candleSeq[k.candleStep];
  if (c.index === expectedIdx) {
    c.lit = true;
    k.candleStep++;
    spawnParticles((c.tx + 0.5) * TILE, (c.ty + 0.5) * TILE, '#ffd080', 10);
    Audio.bossHit && Audio.bossHit();
  } else {
    // Wrong candle — flash and reset the sequence.
    k.candleMistakeTimer = 0.8;
    for (const cc of k.candles) cc.lit = false;
    k.candleStep = 0;
    spawnParticles((c.tx + 0.5) * TILE, (c.ty + 0.5) * TILE, '#ff4040', 14);
    Audio.bossHit && Audio.bossHit();
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
  if (!k) return;
  const t = state.time || 0;

  if (k.variant === 'rune') {
    const playerInCenter = isPlayerInCenter(k);

    // Draw a subtle glowing ring on the centre dais.
    if (k.state === 'active') {
      const cx = (k.room.cx + 0.5) * TILE - state.cameraX;
      const cy = (k.room.cy + 0.5) * TILE - state.cameraY;
      const pulse = 0.15 + 0.1 * Math.sin(t * 2);
      ctx.save();
      ctx.globalAlpha = playerInCenter ? 1 : 0.35;
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, TILE * CENTER_RADIUS);
      grad.addColorStop(0, `rgba(180, 140, 255, ${pulse})`);
      grad.addColorStop(1, 'rgba(180, 140, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * CENTER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw pedestals, dimmed when player is away from centre.
    for (const ped of k.pedestals) {
      drawRunePedestal(ctx, ped, t, playerInCenter && k.state === 'active');
    }

    // Context-sensitive hint text above the dais.
    if (k.state === 'active') {
      const cx = (k.room.cx + 0.5) * TILE - state.cameraX;
      const sy = (k.room.cy - 0.5) * TILE - state.cameraY;
      const pulse = 0.6 + 0.4 * Math.sin(t * 3);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur  = 4;
      if (!playerInCenter) {
        ctx.fillStyle = `rgba(255, 220, 160, ${pulse})`;
        ctx.font      = 'bold 12px sans-serif';
        ctx.fillText('Párate en el centro para activar las runas', cx, sy - 14);
      } else if (k.mismatchTimer === 0 && k.pedestals.some(p => !p.validated)) {
        ctx.fillStyle = `rgba(180, 200, 255, ${pulse})`;
        ctx.font      = 'bold 12px sans-serif';
        ctx.fillText('Dispara a las runas para emparejarlas', cx, sy - 14);
      }
      ctx.restore();
    }
    return;
  }

  // Candle variant rendering.
  if (k.variant === 'candle') {
    if (k.state === 'active') {
      const cx = (k.room.cx + 0.5) * TILE - state.cameraX;
      const sy = (k.room.cy - 0.5) * TILE - state.cameraY;
      const pulse = 0.6 + 0.4 * Math.sin(t * 3);
      const mistake = k.candleMistakeTimer > 0;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur  = 4;
      if (mistake) {
        ctx.fillStyle = `rgba(255, 80, 60, ${pulse})`;
        ctx.font      = 'bold 12px sans-serif';
        ctx.fillText('¡Orden incorrecto! Vuelve a empezar', cx, sy - 14);
      } else if (k.candleStep < k.candles.length) {
        ctx.fillStyle = `rgba(255, 220, 160, ${pulse})`;
        ctx.font      = 'bold 12px sans-serif';
        ctx.fillText(`Enciende las velas en orden (${k.candleStep + 1}/${k.candles.length})`, cx, sy - 14);
      }
      ctx.restore();
    }
    drawCandles(ctx, k, t);
    return;
  }
}

/** @private Pick the colour the pedestal should currently glow with. */
function pedestalGlowColor(ped, time, active) {
  if (ped.validated) return RUNE_VALIDATED;
  if (ped.mismatch)  return RUNE_MISMATCH;
  if (ped.picked)    return RUNE_COLORS[ped.runeId].lit;
  if (!active)       return [30, 28, 40];
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
function drawRunePedestal(ctx, ped, time, active) {
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

  const col = pedestalGlowColor(ped, time, active);
  const bob = Math.sin(time * 2 + ped.tx * 0.7) * 1.5;
  const ry  = sy - r * 0.55 + bob;
  const alpha = active ? 0.9 : 0.3;
  const glow = `rgba(${col[0]|0}, ${col[1]|0}, ${col[2]|0}, ${alpha})`;
  ctx.shadowColor = glow;
  ctx.shadowBlur  = active ? 14 : 4;
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

/* ─────────────────────────── candle rendering ─────────────────────────── */

/** @private Draw all candles for the 'candle' variant. */
function drawCandles(ctx, k, time) {
  for (const c of k.candles) {
    drawOneCandle(ctx, c, time, k.candleMistakeTimer > 0);
  }
  // Draw [E] hint near the nearest unlit candle.
  if (k.state === 'active' && k.candleMistakeTimer === 0) {
    const idx = nearestCandleInRange(k);
    if (idx >= 0 && !k.candles[idx].lit) {
      const c = k.candles[idx];
      const cx = (c.tx + 0.5) * TILE - state.cameraX;
      const cy = (c.ty + 0.5) * TILE - state.cameraY;
      const pulse = 0.6 + 0.4 * Math.sin(time * 5);
      ctx.save();
      ctx.fillStyle = `rgba(255, 220, 160, ${pulse})`;
      ctx.font      = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur  = 4;
      ctx.fillText('[E]', cx, cy - 22);
      ctx.restore();
    }
  }
}

/** @private Draw a single candle. */
function drawOneCandle(ctx, c, time, mistakeFlash) {
  const cx = (c.tx + 0.5) * TILE - state.cameraX;
  const cy = (c.ty + 0.5) * TILE - state.cameraY;
  const lit = c.lit;

  ctx.save();

  // Small stone pedestal under the candle.
  const pedR = 10;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + pedR * 0.5, pedR, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const grad = ctx.createLinearGradient(cx, cy, cx, cy + pedR);
  grad.addColorStop(0, '#6a5a4a');
  grad.addColorStop(0.5, '#4a3a2a');
  grad.addColorStop(1, '#2a1f14');
  ctx.fillStyle = grad;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * pedR;
    const py = cy + Math.sin(a) * pedR * 0.45;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Candle body.
  const bodyH = 10;
  const bodyW = 4;
  const candleY = cy - pedR * 0.35;
  if (lit) {
    // Lit: warm glow around the candle.
    const pulse = 0.5 + 0.3 * Math.sin(time * 4 + c.tx + c.ty);
    const grad = ctx.createRadialGradient(cx, candleY - bodyH * 0.5, 2, cx, candleY - bodyH * 0.5, 16);
    grad.addColorStop(0, `rgba(255, 200, 100, ${pulse})`);
    grad.addColorStop(1, 'rgba(255, 200, 100, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, candleY - bodyH * 0.5, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wax body.
  ctx.fillStyle = mistakeFlash ? '#ff6060' : (lit ? '#e8d8b8' : '#c8b898');
  ctx.fillRect(cx - bodyW / 2, candleY - bodyH, bodyW, bodyH);

  // Wick.
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx, candleY - bodyH);
  ctx.lineTo(cx, candleY - bodyH - 2);
  ctx.stroke();

  // Flame (only if lit).
  if (lit) {
    const fl = 2 + Math.sin(time * 6 + c.tx) * 0.5;
    ctx.fillStyle = '#ffd080';
    ctx.shadowColor = '#ffa040';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.ellipse(cx, candleY - bodyH - fl, 1.5, 3 + fl * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.ellipse(cx, candleY - bodyH - fl - 0.5, 0.8, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

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
  if (!state.archiveDoor || state.archiveDoor.length === 0) return;
  if (state.hasArchiveKey) return;
  const p = state.player;
  if (!p) return;
  // Find the nearest still-locked door.
  let best = null, bestD = TILE * 2.4;
  for (const door of state.archiveDoor) {
    const { tx, ty } = door;
    if (!state.map || state.map[ty]?.[tx] !== T_DOOR_LOCKED) continue;
    const cx = (tx + 0.5) * TILE;
    const cy = (ty + 0.5) * TILE;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < bestD) { bestD = d; best = door; }
  }
  if (!best) return;
  const { tx, ty } = best;
  const cx = (tx + 0.5) * TILE;
  const cy = (ty + 0.5) * TILE;
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
