/**
 * Procedural dungeon generation using Binary Space Partition (BSP).
 *
 * Each floor receives a unique seed and one of several visual / structural
 * "styles" so consecutive floors look and feel distinct. Generation is
 * deterministic for a given (seed, style) pair, which makes it possible to
 * support daily runs in later phases.
 */

import {
  TILE, MAP_W, MAP_H, T_WALL, T_FLOOR, T_STAIR, MAX_FLOOR,
} from './config.js';
import { mulberry32, sirand } from './utils.js';

/**
 * Generation styles. Each tweaks BSP parameters to produce a distinct layout.
 */
const STYLES = {
  /** Many small rooms, tight corridors. Feels like a cramped crypt. */
  COMPACT:  { depth: 6, minRoomW: 5, maxRoomW: 8,  minRoomH: 4, maxRoomH: 7,  splitMin: 0.42, splitMax: 0.58, torchDensity: 1.6 },
  /** Few but large rooms, big arenas. */
  SPARSE:   { depth: 3, minRoomW: 9, maxRoomW: 14, minRoomH: 7, maxRoomH: 11, splitMin: 0.45, splitMax: 0.55, torchDensity: 1.0 },
  /** Long corridors, asymmetric splits. */
  HALLWAYS: { depth: 5, minRoomW: 6, maxRoomW: 10, minRoomH: 4, maxRoomH: 8,  splitMin: 0.30, splitMax: 0.70, torchDensity: 1.2 },
  /** Balanced default. */
  BALANCED: { depth: 5, minRoomW: 6, maxRoomW: 11, minRoomH: 5, maxRoomH: 9,  splitMin: 0.40, splitMax: 0.60, torchDensity: 1.4 },
};

const STYLE_KEYS = ['BALANCED', 'COMPACT', 'HALLWAYS', 'SPARSE'];

/**
 * Generate a complete floor.
 * @param {number} floor 1-based floor number.
 * @param {number} [seed] Optional explicit seed; otherwise random.
 * @param {object} [biome] Active biome (see biomes.js). Used to vary lighting
 *                         (e.g. wall sconces and sunbeams in 'ruins').
 * @returns {{map: number[][], rooms: object[], lights: object[], sunbeams: object[], startRoom: object, stairsRoom: object, style: string, seed: number}}
 */
export function generateDungeon(floor, seed, biome) {
  const finalSeed = seed ?? Math.floor(Math.random() * 0xFFFFFFFF);
  const rng       = mulberry32(finalSeed + floor * 1009);
  // Rotate styles per floor so the visual rhythm changes.
  const styleKey  = STYLE_KEYS[(floor - 1) % STYLE_KEYS.length];
  const style     = STYLES[styleKey];

  const map = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(T_WALL));
  const rooms = [];

  const root = { x: 1, y: 1, w: MAP_W - 2, h: MAP_H - 2 };
  const leaves = [];
  splitNode(root, style.depth, leaves, rng, style);

  for (const leaf of leaves) {
    const rw = sirand(rng, style.minRoomW, Math.min(style.maxRoomW, leaf.w - 2));
    const rh = sirand(rng, style.minRoomH, Math.min(style.maxRoomH, leaf.h - 2));
    if (rw < 3 || rh < 3) continue;
    const rx = leaf.x + sirand(rng, 1, leaf.w - rw - 1);
    const ry = leaf.y + sirand(rng, 1, leaf.h - rh - 1);
    const room = {
      x: rx, y: ry, w: rw, h: rh,
      cx: rx + (rw >> 1),
      cy: ry + (rh >> 1),
      enemies: [],
      cleared: false,
      visited: false,
    };
    rooms.push(room);
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) map[y][x] = T_FLOOR;
    }
  }

  // Connect rooms in spatial order. Sort by centre on the dominant axis
  // for the chosen style: HALLWAYS prefers x, SPARSE prefers diagonal.
  if (styleKey === 'SPARSE') {
    rooms.sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy));
  } else {
    rooms.sort((a, b) => a.cx - b.cx);
  }
  for (let i = 0; i < rooms.length - 1; i++) {
    carveCorridor(map, rooms[i], rooms[i + 1], rng);
  }

  // Pick start (first) and stairs (farthest from start) rooms.
  const startRoom = rooms[0];
  let stairsRoom  = rooms[rooms.length - 1];
  let bestD = 0;
  for (const r of rooms) {
    const d = Math.hypot(r.cx - startRoom.cx, r.cy - startRoom.cy);
    if (d > bestD) { bestD = d; stairsRoom = r; }
  }
  if (floor < MAX_FLOOR) {
    map[stairsRoom.cy][stairsRoom.cx] = T_STAIR;
  }
  stairsRoom.isStairsRoom = true;
  startRoom.isStartRoom   = true;

  // Place lights. Most biomes use floor torches in room corners; the
  // 'ruins' biome instead uses wall-mounted sconces plus a few sunbeam
  // columns falling through the broken ceiling of large rooms.
  const lights   = [];
  const sunbeams = [];
  const isRuins  = biome && biome.id === 'ruins';

  for (const r of rooms) {
    if (isRuins) {
      placeWallSconces(map, r, rng, lights, style.torchDensity);
      maybePlaceSunbeam(r, rng, sunbeams);
    } else {
      placeFloorTorches(r, rng, lights, style.torchDensity);
    }
  }

  return { map, rooms, lights, sunbeams, startRoom, stairsRoom, style: styleKey, seed: finalSeed };
}

/**
 * Place torches in floor corners of a room (default lighting style).
 * @private
 */
function placeFloorTorches(r, rng, lights, density) {
  const corners = [
    { x: r.x + 1,         y: r.y + 1 },
    { x: r.x + r.w - 2,   y: r.y + 1 },
    { x: r.x + 1,         y: r.y + r.h - 2 },
    { x: r.x + r.w - 2,   y: r.y + r.h - 2 },
  ];
  const n = Math.max(1, Math.min(corners.length, Math.round(density + rng() * 0.8)));
  for (let i = 0; i < n; i++) {
    const c = corners[Math.floor(rng() * corners.length)];
    lights.push({
      type: 'torch',
      x: c.x * TILE + TILE / 2,
      y: c.y * TILE + TILE / 2,
      r: 110 + rng() * 30,
      flicker: rng() * Math.PI * 2,
    });
  }
}

/**
 * Place wall-mounted sconces along vertical walls of a room. Each sconce
 * is positioned just outside the floor area, attached to the inner edge
 * of the bordering wall tile, and 'orient'ed left or right so the bracket
 * sticks the right way.
 * @private
 */
function placeWallSconces(map, r, rng, lights, density) {
  const candidates = [];
  // Left wall (sconce facing right into the room)
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    if (r.x - 1 >= 0 && map[y][r.x - 1] === T_WALL) {
      candidates.push({ tx: r.x, ty: y, dir: 'right', edge: r.x * TILE + 2 });
    }
  }
  // Right wall (sconce facing left)
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    const wx = r.x + r.w;
    if (wx < MAP_W && map[y][wx] === T_WALL) {
      candidates.push({ tx: r.x + r.w - 1, ty: y, dir: 'left', edge: (r.x + r.w) * TILE - 2 });
    }
  }
  if (candidates.length === 0) {
    placeFloorTorches(r, rng, lights, density);
    return;
  }
  const n = Math.max(1, Math.round(density + rng() * 0.5));
  for (let i = 0; i < n; i++) {
    const c = candidates[Math.floor(rng() * candidates.length)];
    lights.push({
      type: 'sconce',
      dir:  c.dir,
      x:    c.edge,
      y:    c.ty * TILE + TILE / 2,
      r:    120 + rng() * 30,
      flicker: rng() * Math.PI * 2,
    });
  }
}

/**
 * 35% chance to drop a tall sunbeam in a sufficiently large room.
 * Sunbeams are rendered separately and animated with floating dust.
 * @private
 */
function maybePlaceSunbeam(r, rng, sunbeams) {
  if (r.w * r.h < 60) return;
  if (rng() > 0.35) return;
  const cx = r.x + 1 + Math.floor(rng() * (r.w - 2));
  sunbeams.push({
    x: cx * TILE + TILE / 2,
    y: r.y * TILE,
    h: r.h * TILE,
    w: TILE * (1.6 + rng() * 0.8),
    seed: Math.floor(rng() * 1e9),
  });
}

/**
 * Recursively split a rectangular region into smaller rectangles.
 * @private
 */
function splitNode(node, depth, leaves, rng, style) {
  const minDim = style.minRoomW + 4;
  if (depth <= 0 || (node.w < minDim + 2 && node.h < minDim)) {
    leaves.push(node);
    return;
  }
  const horizontal = node.w < node.h ? true
                    : node.h < node.w ? false
                    : rng() < 0.5;

  if (horizontal) {
    if (node.h < minDim) { leaves.push(node); return; }
    const split = Math.floor(node.h * (style.splitMin + rng() * (style.splitMax - style.splitMin)));
    splitNode({ x: node.x, y: node.y,         w: node.w, h: split },          depth - 1, leaves, rng, style);
    splitNode({ x: node.x, y: node.y + split, w: node.w, h: node.h - split }, depth - 1, leaves, rng, style);
  } else {
    if (node.w < minDim + 2) { leaves.push(node); return; }
    const split = Math.floor(node.w * (style.splitMin + rng() * (style.splitMax - style.splitMin)));
    splitNode({ x: node.x,         y: node.y, w: split,         h: node.h }, depth - 1, leaves, rng, style);
    splitNode({ x: node.x + split, y: node.y, w: node.w - split, h: node.h }, depth - 1, leaves, rng, style);
  }
}

/**
 * Dig an L-shaped corridor between two room centres. Order of axes is
 * randomised so corridors are not always horizontal-first.
 * @private
 */
function carveCorridor(map, a, b, rng) {
  let x = a.cx, y = a.cy;
  const tx = b.cx, ty = b.cy;
  const horizontalFirst = rng() < 0.5;

  if (horizontalFirst) {
    while (x !== tx) { map[y][x] = T_FLOOR; x += x < tx ? 1 : -1; }
    while (y !== ty) { map[y][x] = T_FLOOR; y += y < ty ? 1 : -1; }
  } else {
    while (y !== ty) { map[y][x] = T_FLOOR; y += y < ty ? 1 : -1; }
    while (x !== tx) { map[y][x] = T_FLOOR; x += x < tx ? 1 : -1; }
  }
  map[ty][tx] = T_FLOOR;
}

/**
 * Tile-coord wall test, treating out-of-bounds as walls.
 * @param {number[][]} map
 */
export function isWall(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return map[ty][tx] === T_WALL;
}

/**
 * AABB-like test against the tile grid for a circular entity.
 */
export function isBlocked(map, x, y, r) {
  const pts = [
    [x - r, y - r], [x + r, y - r],
    [x - r, y + r], [x + r, y + r],
  ];
  for (const [px, py] of pts) {
    if (isWall(map, Math.floor(px / TILE), Math.floor(py / TILE))) return true;
  }
  return false;
}

/**
 * Try to move an entity by (dx, dy), sliding along walls.
 */
export function tryMove(map, entity, dx, dy) {
  const r = entity.r || 10;
  if (!isBlocked(map, entity.x + dx, entity.y, r)) entity.x += dx;
  if (!isBlocked(map, entity.x, entity.y + dy, r)) entity.y += dy;
}

/**
 * Find the room containing world-space position `p`.
 * @returns {object|null}
 */
export function getRoomAt(rooms, p) {
  const tx = Math.floor(p.x / TILE);
  const ty = Math.floor(p.y / TILE);
  for (const r of rooms) {
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
  }
  return null;
}
