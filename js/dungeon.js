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
import { mulberry32 } from './utils.js';

/**
 * Generation styles. Each tweaks BSP parameters to produce a distinct layout.
 * `corridorW` controls the visible width of carved corridors (1 = standard).
 */
const STYLES = {
  /** Many small rooms, tight corridors. Feels like a cramped crypt. */
  COMPACT:  { depth: 6, minRoomW: 5, maxRoomW: 8,  minRoomH: 4, maxRoomH: 7,  splitMin: 0.42, splitMax: 0.58, torchDensity: 1.6, corridorW: 1 },
  /** Few but large rooms, big arenas. */
  SPARSE:   { depth: 3, minRoomW: 9, maxRoomW: 14, minRoomH: 7, maxRoomH: 11, splitMin: 0.45, splitMax: 0.55, torchDensity: 1.0, corridorW: 3 },
  /** Long corridors, asymmetric splits. */
  HALLWAYS: { depth: 5, minRoomW: 6, maxRoomW: 10, minRoomH: 4, maxRoomH: 8,  splitMin: 0.30, splitMax: 0.70, torchDensity: 1.2, corridorW: 2 },
  /** Balanced default. */
  BALANCED: { depth: 5, minRoomW: 6, maxRoomW: 11, minRoomH: 5, maxRoomH: 9,  splitMin: 0.40, splitMax: 0.60, torchDensity: 1.4, corridorW: 1 },
  /**
   * Floor 1 (ruins). Many small/medium intimate rooms; a post-pass picks
   * 1-2 rooms and expands them into 'star' rooms that host the spectacle
   * (ceiling cracks, sunbeams, set-piece encounters).
   */
  RUINS:    { depth: 5, minRoomW: 5, maxRoomW: 8,  minRoomH: 4, maxRoomH: 7,  splitMin: 0.40, splitMax: 0.60, torchDensity: 1.3, corridorW: 2 },
  /**
   * Floor 2 (catacombs). A web of small cubiculae (4-6 tiles) joined by
   * 2-tile galleries; a single 'crypta' room is grown later to host the
   * altar, awakable sarcophagi and the floor's set-piece event.
   */
  CATACOMBS:{ depth: 6, minRoomW: 4, maxRoomW: 6,  minRoomH: 4, maxRoomH: 5,  splitMin: 0.45, splitMax: 0.55, torchDensity: 1.6, corridorW: 2 },
};

/**
 * Style rotation per floor (index = floor - 1). Curve: intimate ruins →
 * medium → labyrinthine → open (boss).
 */
const STYLE_KEYS = ['RUINS', 'BALANCED', 'CATACOMBS', 'SPARSE'];

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
    // Rooms now fill 75-92% of their BSP leaf — almost no dead space.
    const ratioW = 0.75 + rng() * 0.17;
    const ratioH = 0.75 + rng() * 0.17;
    let rw = Math.floor(leaf.w * ratioW);
    let rh = Math.floor(leaf.h * ratioH);
    rw = Math.min(rw, leaf.w - 2);
    rh = Math.min(rh, leaf.h - 2);
    if (rw < 4 || rh < 4) continue;
    // Centre the room in its leaf with a small jitter so they don't all align.
    const slackX = leaf.w - rw - 1;
    const slackY = leaf.h - rh - 1;
    const rx = leaf.x + 1 + (slackX > 0 ? Math.floor(rng() * slackX) : 0);
    const ry = leaf.y + 1 + (slackY > 0 ? Math.floor(rng() * slackY) : 0);
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

  // Promote rooms to 'star' rooms — larger than the rest, used to host
  // the visual spectacle and key encounters. Ruins gets 1-2 stars; the
  // catacombs and library floors get exactly one (the crypta / Great
  // Library), since they each host a single set-piece encounter.
  const isLibraryBiome = biome && biome.id === 'library';
  const starCount = isRuinsStyle(styleKey)     ? (1 + Math.floor(rng() * 2))
                  : isCatacombsStyle(styleKey) ? 1
                  : isLibraryBiome             ? 1
                  : 0;
  if (starCount > 0) expandStarRooms(rooms, map, rng, starCount);

  // Detect start (top-left-most) and stairs (farthest from start) rooms
  // BEFORE placing pillars/sarcophagi so those placers can skip them.
  // The actual T_STAIR tile is written later, after structural placers.
  let startRoom = rooms[0];
  for (const r of rooms) {
    if (r.cx + r.cy < startRoom.cx + startRoom.cy) startRoom = r;
  }
  let stairsRoom = startRoom;
  let bestD = 0;
  for (const r of rooms) {
    const d = Math.hypot(r.cx - startRoom.cx, r.cy - startRoom.cy);
    if (d > bestD) { bestD = d; stairsRoom = r; }
  }
  stairsRoom.isStairsRoom = true;
  startRoom.isStartRoom   = true;

  // Pillars (broken stone columns inside roomy spaces). Only meaningful in
  // ruins; other biomes feel different.
  const isRuinsBiome = biome && biome.id === 'ruins';
  if (isRuinsBiome) placePillars(rooms, map, rng);

  // Sarcophagi placement is deferred until AFTER corridor carving so the
  // pasillos no las pisan (carveCorridor convierte tiles a T_FLOOR sin
  // mirar lo que había antes).
  const isCatacombsBiome = biome && biome.id === 'crypt';
  const sarcophagi = [];
  const lights     = [];

  // Connect rooms using a Minimum Spanning Tree built from a complete
  // distance graph. Then add ~27% extra short edges to create loops and
  // shortcuts — much more interesting to navigate than a single chain.
  const connections = buildConnections(rooms, rng, 0.27);
  for (const [i, j] of connections) {
    carveCorridor(map, rooms[i], rooms[j], rooms, rng, style.corridorW);
  }

  // Catacombs structural decor (after corridors so tombs survive).
  if (isCatacombsBiome) placeSarcophagi(rooms, map, rng, sarcophagi, lights);

  // Library structural props (shelves on room walls, tables in centre).
  // Same timing rationale as sarcophagi: after corridors so they survive.
  const libraryProps = [];
  if (biome && biome.id === 'library') {
    placeShelves(rooms, map, rng, libraryProps);
    placeTables(rooms, map, rng, libraryProps);
  }

  // Now that corridors are carved, place the stair tile. Its centre is
  // protected from sarcophagi/pillars by the room flag check above.
  if (floor < MAX_FLOOR) {
    map[stairsRoom.cy][stairsRoom.cx] = T_STAIR;
  }

  // Place lights. Each biome uses a different fixture (warm sconces in
  // ruins, cool wall candles in catacombs, plain floor torches elsewhere).
  // Note: `lights` was already declared above so placeSarcophagi could
  // append the altar's flame.
  const sunbeams    = [];
  const puddles     = [];
  const decorations = [];
  const isRuins      = biome && biome.id === 'ruins';
  const isCatacombs  = biome && biome.id === 'crypt';
  const isLibrary    = biome && biome.id === 'library';

  for (const r of rooms) {
    if (isRuins) {
      placeWallSconces(map, r, rng, lights, style.torchDensity);
    } else if (isCatacombs) {
      placeWallCandles(map, r, rng, lights, style.torchDensity);
    } else if (isLibrary) {
      placeWallSconces(map, r, rng, lights, style.torchDensity);
    } else {
      placeFloorTorches(r, rng, lights, style.torchDensity);
    }
  }

  // Sunbeams are rare and biased toward the largest rooms. We pick the
  // top candidates by area and roll a low-probability per candidate, with
  // a hard cap so the floor never feels like an open courtyard.
  if (isRuins) {
    placeSunbeams(rooms, rng, sunbeams);
    placeCampfires(rooms, rng, lights);
    placeGlowMushrooms(map, rooms, rng, lights);
    placeMoonbeams(rooms, rng, sunbeams);
    placePuddles(map, rooms, rng, puddles);
    placeRoomWallDecorations(map, rooms, rng, decorations, lights,
      ['plaque', 'crack', 'sconceBroken']);
  }

  if (isCatacombs) {
    placeSkullPedestals(map, rooms, rng, lights);
    placeLoculi(map, rooms, rng, decorations);
    placeWebs(rooms, rng, decorations);
    placeRoomWallDecorations(map, rooms, rng, decorations, lights,
      ['namePlate', 'clawMarks', 'wallSkull']);
  }

  const soulSpawners = [];
  if (isCatacombs) placeSoulSpawners(rooms, rng, soulSpawners, sarcophagi);

  let librarySetPiece = null;
  if (isLibrary) {
    placeMagicFlames(rooms, rng, lights);
    placeRoomWallDecorations(map, rooms, rng, decorations, lights,
      ['wallShelf', 'scrollHanging', 'runeSymbol', 'darkPortrait', 'noticeBoard']);
    // 70% chance to spawn the Great Library set-piece on a star room.
    if (rng() < 0.70) {
      librarySetPiece = placeLibrarySetPiece(rooms, map, rng, libraryProps);
    }
  }

  return { map, rooms, lights, sunbeams, puddles, decorations, sarcophagi, libraryProps, soulSpawners, librarySetPiece, startRoom, stairsRoom, style: styleKey, seed: finalSeed };
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
  // Scale count with room area: ~1 torch per ~25 floor tiles, clamped.
  const target = Math.round(density + r.w * r.h / 25);
  const n = Math.max(1, Math.min(corners.length, target));
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let idx;
    do { idx = Math.floor(rng() * corners.length); } while (used.has(idx) && used.size < corners.length);
    used.add(idx);
    const c = corners[idx];
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
  // Scale with room perimeter: roughly 1 sconce per 6 wall tiles.
  const perimeter = (r.w + r.h) * 2;
  const target = Math.max(2, Math.round(density + perimeter / 6));
  const n = Math.min(target, candidates.length);
  // Shuffle candidates and take the first N for a spread layout.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (let i = 0; i < n; i++) {
    const c = candidates[i];
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
 * Place small wall candles in niches around a catacombs room. Mechanically
 * identical to sconces but with a denser distribution and a smaller, cooler
 * pool of light — the room never feels fully lit, just punctuated.
 * @private
 */
function placeWallCandles(map, r, rng, lights, density) {
  const candidates = [];
  // Left wall (candle facing right into the room)
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    if (r.x - 1 >= 0 && map[y][r.x - 1] === T_WALL) {
      candidates.push({ tx: r.x, ty: y, dir: 'right', edge: r.x * TILE + 2 });
    }
  }
  // Right wall (candle facing left)
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
  // Catacombs are darker but more punctuated — pack candles tighter.
  const perimeter = (r.w + r.h) * 2;
  const target = Math.max(2, Math.round(density + perimeter / 4));
  const n = Math.min(target, candidates.length);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (let i = 0; i < n; i++) {
    const c = candidates[i];
    lights.push({
      type: 'candle',
      dir:  c.dir,
      x:    c.edge,
      y:    c.ty * TILE + TILE / 2,
      r:    85 + rng() * 20,
      flicker: rng() * Math.PI * 2,
    });
  }
}

/**
 * Drop a few luminous skull pedestals in catacombs rooms. Each emits a
 * cool blue-white pulse and serves as the equivalent of glow mushrooms in
 * the ruins biome. Pedestals sit on floor tiles, never on top of doorways
 * or walls.
 * @private
 */
function placeSkullPedestals(map, rooms, rng, lights) {
  const GLOBAL_CAP = 10;
  let placed = 0;
  for (const r of rooms) {
    if (placed >= GLOBAL_CAP) break;
    if (r.w < 4 || r.h < 4) continue;
    if (r.isStartRoom || r.isStairsRoom) continue;
    // 50% chance per room. Star rooms (crypta) always try.
    if (!r.isLarge && rng() > 0.50) continue;
    const count = r.isLarge ? (2 + Math.floor(rng() * 2))   // crypta: 2-3
                            : 1;                             // cubicula: 1
    for (let i = 0; i < count && placed < GLOBAL_CAP; i++) {
      // Place hugging an inner wall edge (1 tile inside the room border).
      const wallSide = Math.floor(rng() * 4);
      let tx, ty;
      if (wallSide === 0)      { tx = r.x + 1 + Math.floor(rng() * (r.w - 2)); ty = r.y + 1; }
      else if (wallSide === 1) { tx = r.x + r.w - 2;                            ty = r.y + 1 + Math.floor(rng() * (r.h - 2)); }
      else if (wallSide === 2) { tx = r.x + 1 + Math.floor(rng() * (r.w - 2)); ty = r.y + r.h - 2; }
      else                     { tx = r.x + 1;                                  ty = r.y + 1 + Math.floor(rng() * (r.h - 2)); }
      if (map[ty][tx] !== T_FLOOR) continue;
      lights.push({
        type:  'skull',
        x:     tx * TILE + TILE / 2,
        y:     ty * TILE + TILE / 2,
        r:     55 + rng() * 15,
        phase: rng() * Math.PI * 2,
      });
      placed++;
    }
  }
}

/**
 * Find painted-on loculi (burial niches) along walls bordering corridors.
 * For every corridor-adjacent wall tile, with low probability, push a
 * decoration entry that render.js will paint into the map cache.
 * @private
 */
function placeLoculi(map, rooms, rng, decorations) {
  const PER_TILE_CHANCE = 0.05;
  const PER_FLOOR_CAP   = 28;
  let placed = 0;
  // We want loculi on walls that line corridors, not on room walls. A
  // corridor tile is a floor tile that is NOT inside any room rect.
  const inAnyRoom = (tx, ty) => {
    for (const r of rooms) {
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return true;
    }
    return false;
  };
  for (let y = 1; y < MAP_H - 1 && placed < PER_FLOOR_CAP; y++) {
    for (let x = 1; x < MAP_W - 1 && placed < PER_FLOOR_CAP; x++) {
      if (map[y][x] !== T_WALL) continue;
      // Only walls whose tile below is a corridor floor. That way the
      // niche faces the player as they walk past.
      if (map[y + 1] && map[y + 1][x] === T_FLOOR && !inAnyRoom(x, y + 1)) {
        if (rng() < PER_TILE_CHANCE) {
          decorations.push({
            kind:  'loculus',
            tx: x, ty: y,
            seed:  Math.floor(rng() * 1e9),
          });
          placed++;
        }
      }
    }
  }
}

/**
 * Cobwebs in inner room corners. Decorative; ignored by collision and AI.
 * @private
 */
function placeWebs(rooms, rng, decorations) {
  for (const r of rooms) {
    if (r.w < 4 || r.h < 4) continue;
    if (r.isStartRoom) continue;
    // Each of the 4 inner corners has an independent chance.
    const corners = [
      { tx: r.x + 1,         ty: r.y + 1,         q: 0 }, // TL
      { tx: r.x + r.w - 2,   ty: r.y + 1,         q: 1 }, // TR
      { tx: r.x + 1,         ty: r.y + r.h - 2,   q: 2 }, // BL
      { tx: r.x + r.w - 2,   ty: r.y + r.h - 2,   q: 3 }, // BR
    ];
    for (const c of corners) {
      if (rng() < 0.45) {
        decorations.push({ kind: 'web', tx: c.tx, ty: c.ty, q: c.q });
      }
    }
  }
}

/**
 * Place biome-specific flat decorations on the inward face of the **top**
 * wall of each room — i.e. wall tiles whose tile below is room floor.
 * That is the face the player sees head-on with a top-down camera, which
 * is why it looks "ambient" instead of buried (same rule that made the
 * loculus work). One kind per pick, randomised from `kinds`.
 *
 * @param {Array<number[]>} map
 * @param {object[]} rooms
 * @param {() => number} rng
 * @param {object[]} decorations  Output: each entry `{kind, tx, ty, face:'S', seed}`.
 * @param {object[]} lights       Existing lights (to avoid placing on top of sconces/candles).
 * @param {string[]} kinds        Decoration kinds for this biome.
 * @private
 */
function placeRoomWallDecorations(map, rooms, rng, decorations, lights, kinds) {
  const PER_TILE_CHANCE = 0.18;
  const PER_ROOM_CAP    = 2;

  // Quick lookup for tiles already taken by something visible on the wall.
  const tileTaken = (tx, ty) => {
    if (decorations.some(d => d.tx === tx && d.ty === ty)) return true;
    if (lights && lights.some(l =>
      Math.floor(l.x / TILE) === tx && Math.floor(l.y / TILE) === ty)) return true;
    return false;
  };

  for (const r of rooms) {
    if (r.isStartRoom) continue;
    if (r.w < 4 || r.h < 3) continue;
    const y = r.y - 1;
    if (y < 1) continue;

    let placedHere = 0;
    // Skip the two corner tiles so decorations don't fight with the
    // corner cobwebs / corner torches.
    for (let x = r.x + 1; x < r.x + r.w - 1 && placedHere < PER_ROOM_CAP; x++) {
      if (!map[y] || map[y][x] !== T_WALL) continue;
      if (!map[y + 1] || map[y + 1][x] !== T_FLOOR) continue;
      if (tileTaken(x, y)) continue;
      if (rng() < PER_TILE_CHANCE) {
        const kind = kinds[Math.floor(rng() * kinds.length)];
        decorations.push({
          kind, tx: x, ty: y, face: 'S',
          seed: Math.floor(rng() * 1e9),
        });
        placedHere++;
      }
    }
  }
}

/**
 * Place a small number of sunbeams across the floor. Only the largest rooms
 * are eligible, each with a low independent chance, and a hard cap of 2
 * sunbeams per floor keeps them feeling rare and atmospheric — a collapsed
 * dungeon, not an open courtyard.
 * @private
 */
function placeSunbeams(rooms, rng, sunbeams) {
  const HARD_CAP = 2;
  // Only star rooms can host a ceiling crack — keeps the spectacle rare.
  const eligible = rooms.filter(r => r.isLarge);
  // High per-room chance: if the floor has a star room, it almost always
  // has a beam through it. The contrast is the whole point.
  const PER_ROOM_CHANCE = 0.85;

  for (const r of eligible) {
    if (sunbeams.length >= HARD_CAP) break;
    if (rng() > PER_ROOM_CHANCE) continue;
    // The crack runs across most of the ceiling: 60-90% of room width.
    const lengthRatio = 0.60 + rng() * 0.30;
    const length      = Math.max(4, Math.floor(r.w * lengthRatio)) * TILE;
    // Centre the crack horizontally with a small offset.
    const slack       = (r.w * TILE - length) * 0.5;
    const startX      = r.x * TILE + slack + (rng() - 0.5) * slack * 0.6;
    const h           = r.h * TILE;
    const sb = {
      // Anchor at the centre of the crack so render maths stay simple.
      x: startX + length / 2,
      y: r.y * TILE,
      h,
      length,
      // Beam splays outward by `splay` pixels on each side at the floor.
      splay: TILE * (0.8 + rng() * 0.6),
      seed: Math.floor(rng() * 1e9),
      // Tile row of the wall above this room — used to paint the visible
      // ceiling fissure into the map cache.
      wallRow: r.y - 1,
    };
    sb.shape = buildBeamShape(sb, rng);
    sb.crack = buildCrackPath(sb, rng);
    sunbeams.push(sb);
  }
}

/**
 * Place 1-2 traveller campfires across the floor in non-star, non-stairs
 * rooms. Each campfire emits a wide warm light and is decorated with a
 * stone ring + crossed logs, giving the impression that someone camped
 * here before. Skips small rooms (no space for the ring).
 * @private
 */
function placeCampfires(rooms, rng, lights) {
  const HARD_CAP = 2;
  const eligible = rooms.filter(r =>
    !r.isLarge && !r.isStairsRoom && !r.isStartRoom &&
    r.w >= 5 && r.h >= 5
  );
  // Shuffle and pick.
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  const target = Math.min(HARD_CAP, eligible.length, 1 + Math.floor(rng() * 2));
  for (let i = 0; i < target; i++) {
    const r = eligible[i];
    // Place near centre with a small offset so it doesn't sit on the
    // exact pathing midpoint.
    const ox = (rng() - 0.5) * Math.min(r.w - 4, 4);
    const oy = (rng() - 0.5) * Math.min(r.h - 4, 3);
    lights.push({
      type:    'campfire',
      x:       (r.x + r.w / 2 + ox) * TILE,
      y:       (r.y + r.h / 2 + oy) * TILE,
      r:       170 + rng() * 30,
      flicker: rng() * Math.PI * 2,
    });
  }
}

/**
 * Drop clusters of glowing mushrooms hugging the inside of room walls.
 * Each mushroom emits a faint cool light, evoking the 'green ruins'
 * biome. Total light count is capped to keep the lighting overlay cheap.
 * @private
 */
function placeGlowMushrooms(map, rooms, rng, lights) {
  const GLOBAL_CAP = 14;
  let placed = 0;
  for (const r of rooms) {
    if (placed >= GLOBAL_CAP) break;
    // Skip the smallest rooms; clusters need a wall edge with space.
    if (r.w < 5 || r.h < 4) continue;
    if (rng() > 0.65) continue;     // not every room
    const clusterCount = 1 + Math.floor(rng() * 2); // 1-2 clusters
    for (let c = 0; c < clusterCount && placed < GLOBAL_CAP; c++) {
      const wallSide = Math.floor(rng() * 4); // 0=top 1=right 2=bot 3=left
      // Pick anchor 1 tile inside the wall.
      let ax, ay;
      if (wallSide === 0)      { ax = r.x + 1 + Math.floor(rng() * (r.w - 2)); ay = r.y; }
      else if (wallSide === 1) { ax = r.x + r.w - 1; ay = r.y + 1 + Math.floor(rng() * (r.h - 2)); }
      else if (wallSide === 2) { ax = r.x + 1 + Math.floor(rng() * (r.w - 2)); ay = r.y + r.h - 1; }
      else                     { ax = r.x; ay = r.y + 1 + Math.floor(rng() * (r.h - 2)); }
      const groupSize = 2 + Math.floor(rng() * 3); // 2-4
      for (let g = 0; g < groupSize && placed < GLOBAL_CAP; g++) {
        const jx = ax + (rng() - 0.5) * 1.6;
        const jy = ay + (rng() - 0.5) * 1.6;
        // Skip if anchor isn't on a floor tile (safety).
        const tx = Math.round(jx), ty = Math.round(jy);
        if (ty < 0 || ty >= MAP_H || tx < 0 || tx >= MAP_W) continue;
        if (map[ty][tx] !== T_FLOOR) continue;
        lights.push({
          type:    'glowMushroom',
          x:       jx * TILE + TILE / 2,
          y:       jy * TILE + TILE / 2,
          r:       42 + rng() * 14,
          // Variant 0 = blue-green, 1 = teal — picked deterministically.
          variant: (placed + g) & 1,
          phase:   rng() * Math.PI * 2,
        });
        placed++;
      }
    }
  }
}

/**
 * Thin moonbeams: small, fine shafts of light coming through tiny holes
 * in the ceiling on rooms that are NOT star rooms. No god-rays or dust,
 * just a delicate vertical sliver — gives texture to medium rooms.
 * Re-uses the sunbeam container/render path with a `kind: 'thin'` tag.
 * @private
 */
function placeMoonbeams(rooms, rng, beams) {
  const HARD_CAP = 4;
  const eligible = rooms.filter(r =>
    !r.isLarge && r.w >= 5 && r.h >= 4
  );
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  let placed = 0;
  for (const r of eligible) {
    if (placed >= HARD_CAP) break;
    if (rng() > 0.30) continue;
    // Tiny crack: 8-14 px wide, slightly off-centre horizontally.
    const length = 8 + Math.floor(rng() * 7);
    const ox     = (rng() - 0.5) * (r.w - 2) * TILE * 0.6;
    const sb = {
      kind: 'thin',
      x:    (r.x + r.w / 2) * TILE + ox,
      y:    r.y * TILE,
      h:    r.h * TILE,
      length,
      splay: 6 + rng() * 6,
      seed:  Math.floor(rng() * 1e9),
      wallRow: r.y - 1,
    };
    sb.shape = buildBeamShape(sb, rng);
    sb.crack = buildCrackPath(sb, rng);
    beams.push(sb);
    placed++;
  }
}

/**
 * Drop a few stone pillars (single wall tiles) inside roomy spaces. Each
 * pillar gives tactical cover and visual texture. Skips small rooms,
 * keeps a 2-tile buffer to room edges, never blocks the room centre or
 * adjacent tiles to start/stairs.
 * @private
 */
function placePillars(rooms, map, rng) {
  for (const r of rooms) {
    if (r.w * r.h < 60) continue;
    if (r.isStartRoom) continue;
    const target = r.isLarge ? (3 + Math.floor(rng() * 3))   // 3-5 in stars
                             : (1 + Math.floor(rng() * 2));  // 1-2 elsewhere
    let placed = 0, safety = 30;
    while (placed < target && safety-- > 0) {
      const tx = r.x + 2 + Math.floor(rng() * (r.w - 4));
      const ty = r.y + 2 + Math.floor(rng() * (r.h - 4));
      // Avoid blocking centre tile (where stairs may sit) and its neighbours.
      if (Math.abs(tx - r.cx) <= 1 && Math.abs(ty - r.cy) <= 1) continue;
      if (map[ty][tx] !== T_FLOOR) continue;
      // Don't drop a pillar adjacent to another pillar (no walls of pillars).
      let touching = false;
      for (let dy = -1; dy <= 1 && !touching; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          // Only check inside the room (so room walls don't count).
          if (nx < r.x || nx >= r.x + r.w || ny < r.y || ny >= r.y + r.h) continue;
          if (map[ny][nx] === T_WALL) { touching = true; break; }
        }
      }
      if (touching) continue;
      map[ty][tx] = T_WALL;
      placed++;
    }
  }
}

/**
 * Place stone sarcophagi in catacombs rooms. Each sarcophagus occupies a
 * 2×1 footprint (rotated 1×2 sometimes) of T_WALL tiles, blocking pathing
 * just like a pillar but reading visually as a tomb.
 *
 * Cubiculae: 30-40% chance of a single normal sarcophagus.
 * Crypta (star room): central 2×2 altar plus 2-3 'cracked' sarcophagi
 * along the inner border. Cracked variants are highlighted with a faint
 * blue aura at runtime — they are awakable/breakable in commit 5.
 * @private
 */
/**
 * Anchor 5–8 ambient soul spawners across the catacombs floor. Each anchor
 * stores world coordinates that main.js uses to emit drifting soul wisps.
 * Anchors prefer cracked sarcophagi (and the altar) for thematic effect,
 * filling the rest with random non-start, non-stairs room centres.
 *
 * @private
 */
function placeSoulSpawners(rooms, rng, soulSpawners, sarcophagi) {
  // Cracked sarcophagi and the altar are the strongest narrative anchors.
  for (const s of (sarcophagi || [])) {
    if (s.variant === 'cracked' || s.variant === 'altar') {
      soulSpawners.push({
        x: s.tx * TILE + (s.w * TILE) / 2,
        y: s.ty * TILE + (s.h * TILE) / 2,
        timer: rng() * 2.5,
      });
    }
  }
  // Top up with random rooms until we have 5–8 anchors.
  const target = 5 + Math.floor(rng() * 4);
  const candidates = rooms.filter(r => !r.isStartRoom && !r.isStairsRoom);
  let safety = 40;
  while (soulSpawners.length < target && candidates.length && safety-- > 0) {
    const r = candidates[Math.floor(rng() * candidates.length)];
    const ox = r.x + 1 + Math.floor(rng() * Math.max(1, r.w - 2));
    const oy = r.y + 1 + Math.floor(rng() * Math.max(1, r.h - 2));
    soulSpawners.push({
      x: ox * TILE + TILE / 2,
      y: oy * TILE + TILE / 2,
      timer: rng() * 2.5,
    });
  }
}

/**
 * Library biome: place 1–3 floating magic flames per non-start room. Each
 * flame oscillates between two anchor points inside the room, drifting
 * irregularly so two flames never feel synced. Colour alternates between
 * arcane purple and crimson per spawn for variety.
 *
 * @private
 */
function placeMagicFlames(rooms, rng, lights) {
  for (const r of rooms) {
    if (r.isStartRoom) continue;
    if (r.w < 4 || r.h < 3) continue;

    const count = 1 + Math.floor(rng() * 2) + (r.isLarge ? 1 : 0);
    for (let i = 0; i < count; i++) {
      // Anchor A and B inside the room, kept away from the walls.
      const ax = (r.x + 1 + rng() * (r.w - 2)) * TILE;
      const ay = (r.y + 1 + rng() * (r.h - 2)) * TILE;
      const bx = (r.x + 1 + rng() * (r.w - 2)) * TILE;
      const by = (r.y + 1 + rng() * (r.h - 2)) * TILE;
      const purple = rng() < 0.65;
      lights.push({
        type:    'magicFlame',
        ax, ay, bx, by,
        x:       ax,
        y:       ay,
        // Independent phase + frequency so flames desync.
        phase:   rng() * Math.PI * 2,
        speed:   0.25 + rng() * 0.35,
        wobble:  rng() * Math.PI * 2,
        color:   purple ? [180, 120, 255] : [255,  90, 110],
        r:       70 + rng() * 25,
        flicker: rng() * Math.PI * 2,
      });
    }
  }
}

/**
 * Library biome: place tall bookshelves along the inner perimeter of each
 * room (one tile in from a wall). Shelves are 2-tile wide solids written
 * as T_WALL, oriented along the wall they hug.
 *
 * Skips start, stairs and any room shorter than 4 in either axis. Roughly
 * 35% of eligible rooms get 1 shelf, large rooms get 2-3.
 *
 * @private
 */
function placeShelves(rooms, map, rng, libraryProps) {
  for (const r of rooms) {
    if (r.isStartRoom || r.isStairsRoom) continue;
    if (r.w < 4 || r.h < 4) continue;
    if (!r.isLarge && rng() > 0.55) continue;

    const target = r.isLarge ? 2 + Math.floor(rng() * 2) : 1;
    let placed = 0;
    let safety = 16;
    while (placed < target && safety-- > 0) {
      // Side: 0=top, 1=right, 2=bottom, 3=left.
      const side = Math.floor(rng() * 4);
      const horizontal = side === 0 || side === 2;
      const len = 2;
      let tx, ty;
      if (side === 0)      { tx = r.x + 1 + Math.floor(rng() * (r.w - 2 - len + 1)); ty = r.y + 1; }
      else if (side === 2) { tx = r.x + 1 + Math.floor(rng() * (r.w - 2 - len + 1)); ty = r.y + r.h - 2; }
      else if (side === 1) { tx = r.x + r.w - 2; ty = r.y + 1 + Math.floor(rng() * (r.h - 2 - len + 1)); }
      else                 { tx = r.x + 1;       ty = r.y + 1 + Math.floor(rng() * (r.h - 2 - len + 1)); }

      const w = horizontal ? len : 1;
      const h = horizontal ? 1   : len;

      // Skip if it covers the room centre (door axis area).
      let blocksCentre = false;
      for (let yy = ty; yy < ty + h; yy++) {
        for (let xx = tx; xx < tx + w; xx++) {
          if (xx === r.cx && yy === r.cy) blocksCentre = true;
        }
      }
      if (blocksCentre) continue;

      // All target tiles must be floor and not already taken.
      let ok = true;
      for (let yy = ty; yy < ty + h && ok; yy++) {
        for (let xx = tx; xx < tx + w; xx++) {
          if (!map[yy] || map[yy][xx] !== T_FLOOR) { ok = false; break; }
          if (libraryProps.some(p => xx >= p.tx && xx < p.tx + p.w && yy >= p.ty && yy < p.ty + p.h)) {
            ok = false; break;
          }
        }
      }
      if (!ok) continue;

      for (let yy = ty; yy < ty + h; yy++) {
        for (let xx = tx; xx < tx + w; xx++) map[yy][xx] = T_WALL;
      }
      libraryProps.push({
        kind: 'shelf',
        tx, ty, w, h,
        orient: horizontal ? 'h' : 'v',
        // Which side it hugs determines which side of the prop is the front.
        face:   side === 0 ? 'S' : side === 2 ? 'N' : side === 1 ? 'W' : 'E',
        seed:   Math.floor(rng() * 1e9),
      });
      placed++;
    }
  }
}

/**
 * Library biome: place 1-2 reading tables in the middle of each non-start
 * room. Tables are 1×1 (small) or 2×1 (long) solids written as T_WALL.
 *
 * @private
 */
function placeTables(rooms, map, rng, libraryProps) {
  for (const r of rooms) {
    if (r.isStartRoom || r.isStairsRoom) continue;
    if (r.w < 5 || r.h < 4) continue;
    if (rng() > 0.6) continue;

    const target = r.isLarge ? 2 : 1;
    let placed = 0;
    let safety = 12;
    while (placed < target && safety-- > 0) {
      const horizontal = rng() < 0.5;
      const w = horizontal ? 2 : 1;
      const h = horizontal ? 1 : (rng() < 0.4 ? 2 : 1);
      // Stay one tile away from walls and avoid the room centre tile.
      const tx = r.x + 2 + Math.floor(rng() * Math.max(1, r.w - 3 - w));
      const ty = r.y + 2 + Math.floor(rng() * Math.max(1, r.h - 3 - h));

      let blocksCentre = false;
      for (let yy = ty; yy < ty + h; yy++) {
        for (let xx = tx; xx < tx + w; xx++) {
          if (xx === r.cx && yy === r.cy) blocksCentre = true;
        }
      }
      if (blocksCentre) continue;

      let ok = true;
      for (let yy = ty; yy < ty + h && ok; yy++) {
        for (let xx = tx; xx < tx + w; xx++) {
          if (!map[yy] || map[yy][xx] !== T_FLOOR) { ok = false; break; }
          if (libraryProps.some(p => xx >= p.tx && xx < p.tx + p.w && yy >= p.ty && yy < p.ty + p.h)) {
            ok = false; break;
          }
        }
      }
      if (!ok) continue;

      for (let yy = ty; yy < ty + h; yy++) {
        for (let xx = tx; xx < tx + w; xx++) map[yy][xx] = T_WALL;
      }
      libraryProps.push({
        kind:    rng() < 0.45 ? 'tableBroken' : 'table',
        tx, ty, w, h,
        orient:  horizontal ? 'h' : 'v',
        seed:    Math.floor(rng() * 1e9),
      });
      placed++;
    }
  }
}

/**
 * Place the Great Library set-piece in a star room: a 2×2 summoning circle
 * at the centre, plus four floating rune stones around it. The circle is
 * a walkable decoration (no T_WALL writes) so the player can step onto it
 * to trigger the encounter via E.
 *
 * Picks the largest non-start, non-stairs star room. Returns the set-piece
 * descriptor or null if no eligible room exists.
 *
 * @private
 */
function placeLibrarySetPiece(rooms, map, rng, libraryProps) {
  // Star rooms first; pick the largest by area.
  const stars = rooms.filter(r =>
    r.isLarge && !r.isStartRoom && !r.isStairsRoom &&
    r.w >= 7 && r.h >= 7,
  );
  if (!stars.length) return null;
  stars.sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const room = stars[0];
  room.isGreatLibrary = true;

  // Centre 2×2 circle on the room centre.
  const cx = Math.floor(room.x + room.w / 2);
  const cy = Math.floor(room.y + room.h / 2);
  const circle = { tx: cx - 1, ty: cy - 1, w: 2, h: 2, seed: Math.floor(rng() * 1e9) };

  // If a previously-placed shelf/table happens to overlap the circle
  // footprint, remove it and restore the underlying floor so the circle
  // stays walkable.
  for (let i = libraryProps.length - 1; i >= 0; i--) {
    const p = libraryProps[i];
    if (p.tx + p.w <= circle.tx || p.tx >= circle.tx + circle.w) continue;
    if (p.ty + p.h <= circle.ty || p.ty >= circle.ty + circle.h) continue;
    for (let yy = p.ty; yy < p.ty + p.h; yy++) {
      for (let xx = p.tx; xx < p.tx + p.w; xx++) {
        if (map[yy] && map[yy][xx] === T_WALL) map[yy][xx] = T_FLOOR;
      }
    }
    libraryProps.splice(i, 1);
  }

  // Bake the circle as a flag on the libraryProps array so it renders into
  // the cached map (drawLibraryProp dispatches on `kind`). We do NOT write
  // T_WALL here — the circle is walkable.
  libraryProps.push({ kind: 'summoningCircle', tx: circle.tx, ty: circle.ty,
                      w: circle.w, h: circle.h, seed: circle.seed });

  // Four rune stones at NE/NW/SE/SW around the centre, ~2 tiles out so
  // they stay inside even the smallest 7×7 star room. World pixel coords
  // go to set-piece state so we can animate them later from
  // librarySetPiece.js.
  const radius = 2;
  const wx = (circle.tx + circle.w / 2) * TILE;
  const wy = (circle.ty + circle.h / 2) * TILE;
  const candidates = [
    { dx: -radius, dy: -radius },
    { dx:  radius, dy: -radius },
    { dx: -radius, dy:  radius },
    { dx:  radius, dy:  radius },
  ];
  const stones = [];
  for (const c of candidates) {
    stones.push({
      x: wx + c.dx * TILE,
      y: wy + c.dy * TILE,
      seed: Math.floor(rng() * 1e9),
      phase: rng() * Math.PI * 2,
    });
  }

  return {
    room,
    circle,
    stones,
    active: false,
    completed: false,
    timer: 0,
    sealedTiles: [],
    guardian: null,
    guardianSpawned: false,
    rewardGiven: false,
    stonesHidden: false,
  };
}

function placeSarcophagi(rooms, map, rng, sarcophagi, lights) {
  for (const r of rooms) {
    if (r.isStartRoom || r.isStairsRoom) continue;
    if (r.w < 4 || r.h < 4) continue;

    if (r.isLarge) {
      placeAltar(r, map, sarcophagi, lights);
      placeCryptaSarcophagi(r, map, rng, sarcophagi);
    } else {
      // Cubicula: 35% chance of a normal sarcophagus.
      if (rng() > 0.35) continue;
      tryPlaceSarcophagus(r, map, rng, sarcophagi, 'normal');
    }
  }
}

/**
 * Place the 2×2 altar at the centre of the crypta plus a cool blue light
 * source coming from the bowl on top.
 * @private
 */
function placeAltar(r, map, sarcophagi, lights) {
  const tx = r.cx - 1;
  const ty = r.cy - 1;
  // Verify all 4 tiles are floor.
  for (let y = ty; y < ty + 2; y++) {
    for (let x = tx; x < tx + 2; x++) {
      if (map[y] === undefined || map[y][x] !== T_FLOOR) return;
    }
  }
  for (let y = ty; y < ty + 2; y++) {
    for (let x = tx; x < tx + 2; x++) map[y][x] = T_WALL;
  }
  sarcophagi.push({
    tx, ty, w: 2, h: 2,
    variant: 'altar',
    awakable: false, awakened: false,
  });
  // Flickering cool flame light on the bowl.
  if (lights) {
    lights.push({
      type: 'altar',
      x: (tx + 1) * TILE,           // centre of 2x2 footprint
      y: (ty + 1) * TILE,           // bowl sits roughly at the centre row
      r: 140,
      seed: Math.floor(Math.random() * 1000),
    });
  }
}

/**
 * Place 2-3 awakable (cracked) sarcophagi along the inner border of the
 * crypta. They are placed against the room walls but still inside the
 * floor area, leaving the centre clear for the player.
 * @private
 */
function placeCryptaSarcophagi(r, map, rng, sarcophagi) {
  const target = 2 + Math.floor(rng() * 2); // 2-3
  let placed = 0, safety = 40;
  while (placed < target && safety-- > 0) {
    if (tryPlaceSarcophagus(r, map, rng, sarcophagi, 'cracked', /*nearWall*/ true)) {
      placed++;
    }
  }
}

/**
 * Try to place a single 2×1 (or 1×2) sarcophagus in the room. Marks the
 * occupied tiles as T_WALL and pushes an entry to `sarcophagi`. Returns
 * true on success, false if no spot was found.
 * @private
 */
function tryPlaceSarcophagus(r, map, rng, sarcophagi, variant, nearWall = false) {
  const horizontal = rng() < 0.5;
  const w = horizontal ? 2 : 1;
  const h = horizontal ? 1 : 2;
  // Random anchor within the room interior (with 1-tile buffer to room walls).
  const minX = r.x + 1;
  const maxX = r.x + r.w - 1 - w;
  const minY = r.y + 1;
  const maxY = r.y + r.h - 1 - h;
  if (maxX < minX || maxY < minY) return false;

  for (let attempt = 0; attempt < 12; attempt++) {
    let tx, ty;
    if (nearWall) {
      // Bias toward the room border — pick a wall side.
      const side = Math.floor(rng() * 4);
      if (side === 0)      { tx = minX + Math.floor(rng() * (maxX - minX + 1)); ty = minY; }
      else if (side === 1) { tx = maxX;                                        ty = minY + Math.floor(rng() * (maxY - minY + 1)); }
      else if (side === 2) { tx = minX + Math.floor(rng() * (maxX - minX + 1)); ty = maxY; }
      else                 { tx = minX;                                        ty = minY + Math.floor(rng() * (maxY - minY + 1)); }
    } else {
      tx = minX + Math.floor(rng() * (maxX - minX + 1));
      ty = minY + Math.floor(rng() * (maxY - minY + 1));
    }
    // Avoid blocking the room centre.
    let blocksCentre = false;
    for (let yy = ty; yy < ty + h; yy++) {
      for (let xx = tx; xx < tx + w; xx++) {
        if (Math.abs(xx - r.cx) <= 0 && Math.abs(yy - r.cy) <= 0) blocksCentre = true;
      }
    }
    if (blocksCentre) continue;
    // Verify all target tiles are floor.
    let ok = true;
    for (let yy = ty; yy < ty + h && ok; yy++) {
      for (let xx = tx; xx < tx + w; xx++) {
        if (map[yy] === undefined || map[yy][xx] !== T_FLOOR) { ok = false; break; }
      }
    }
    if (!ok) continue;
    for (let yy = ty; yy < ty + h; yy++) {
      for (let xx = tx; xx < tx + w; xx++) map[yy][xx] = T_WALL;
    }
    sarcophagi.push({
      tx, ty, w, h, variant,
      awakable: variant === 'cracked',
      awakened: false,
      orient: horizontal ? 'h' : 'v',
    });
    return true;
  }
  return false;
}

/**
 * Place small puddles of water on floor tiles. Each puddle records its
 * tile centre and a deterministic ellipse radius so render passes can
 * paint it (and its specular highlight) consistently.
 * @private
 */
function placePuddles(map, rooms, rng, puddles) {
  for (const r of rooms) {
    if (r.w < 4 || r.h < 4) continue;
    const target = r.isLarge ? (2 + Math.floor(rng() * 2))  // 2-3 in stars
                             : (rng() < 0.55 ? 1 : 0);      // ~55% chance else
    let placed = 0, safety = 20;
    while (placed < target && safety-- > 0) {
      const tx = r.x + 1 + Math.floor(rng() * (r.w - 2));
      const ty = r.y + 1 + Math.floor(rng() * (r.h - 2));
      if (map[ty][tx] !== T_FLOOR) continue;
      // Avoid stair tile and pathing centre.
      if (tx === r.cx && ty === r.cy) continue;
      // Don't stack puddles.
      let tooClose = false;
      for (const p of puddles) {
        if (Math.abs(p.tx - tx) <= 1 && Math.abs(p.ty - ty) <= 1) { tooClose = true; break; }
      }
      if (tooClose) continue;
      puddles.push({
        tx, ty,
        x:  tx * TILE + TILE / 2,
        y:  ty * TILE + TILE / 2,
        rx: 8 + rng() * 4,         // 8-12 px ellipse radius x
        ry: 4 + rng() * 2,         // 4-6 px radius y
        seed: Math.floor(rng() * 1e9),
      });
      placed++;
    }
  }
}

/**
 * Build a jagged polyline describing the visible ceiling crack on the wall
 * tile row directly above the room. Coordinates are world-space pixels.
 * The polyline is a horizontal random walk inside the wall row, ranging
 * across ±length/2 around `sb.x` and biased toward y = wallRow*TILE + ~half.
 * @private
 */
function buildCrackPath(sb, rng) {
  const halfLen = sb.length * 0.5;
  const baseY   = sb.wallRow * TILE + TILE * 0.55;
  const n       = Math.max(8, Math.floor(sb.length / 8));
  const pts     = [];
  let y = baseY;
  for (let i = 0; i < n; i++) {
    const t  = i / (n - 1);
    const x  = sb.x - halfLen + t * sb.length;
    // Random-walk Y inside the wall row, clamped to stay visible.
    y += (rng() - 0.5) * 4;
    const minY = sb.wallRow * TILE + 3;
    const maxY = sb.wallRow * TILE + TILE - 3;
    if (y < minY) y = minY;
    if (y > maxY) y = maxY;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Build an irregular polygon for a long ceiling crack widening into a sheet
 * of light. The top edge is a jagged line spanning `sb.length`, the sides
 * slope outward by `sb.splay`, and the bottom is a wider uneven edge.
 * Coordinates are relative to (sb.x, sb.y).
 * @private
 */
function buildBeamShape(sb, rng) {
  const halfTop    = sb.length * 0.5;
  const halfBottom = halfTop + sb.splay;
  const h          = sb.h;
  const pts        = [];

  // ── Top edge: long jagged crack across the ceiling ─────────────────
  // One zig-zag point every ~12 px, with vertical jitter.
  const nTop = Math.max(6, Math.floor(sb.length / 12));
  for (let i = 0; i < nTop; i++) {
    const t = i / (nTop - 1);
    const x = -halfTop + t * (halfTop * 2);
    const y = (rng() - 0.3) * 5;       // mostly above 0, occasional dip
    pts.push([x + (rng() - 0.5) * 3, y]);
  }

  // ── Right side: 1–2 kinks down to the floor ───────────────────────
  const rightKinks = 1 + Math.floor(rng() * 2);
  for (let i = 1; i <= rightKinks; i++) {
    const t = i / (rightKinks + 1);
    const x = halfTop + t * sb.splay + (rng() - 0.5) * 4;
    const y = t * h;
    pts.push([x, y]);
  }
  pts.push([halfBottom + (rng() - 0.5) * 4, h]);

  // ── Bottom edge: wide, slightly uneven ────────────────────────────
  const nBot = Math.max(3, Math.floor(sb.length / 16));
  for (let i = 0; i < nBot; i++) {
    const t = (i + 1) / (nBot + 1);
    const x = halfBottom - t * (halfBottom * 2);
    pts.push([x + (rng() - 0.5) * 4, h + (rng() - 0.5) * 3]);
  }
  pts.push([-halfBottom + (rng() - 0.5) * 4, h]);

  // ── Left side: kinks back up to the top ───────────────────────────
  const leftKinks = 1 + Math.floor(rng() * 2);
  for (let i = leftKinks; i >= 1; i--) {
    const t = i / (leftKinks + 1);
    const x = -halfTop - t * sb.splay + (rng() - 0.5) * 4;
    const y = t * h;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * True if the style key represents the floor-1 ruins layout.
 * @private
 */
function isRuinsStyle(key) {
  return key === 'RUINS';
}

/**
 * True if the style key represents the floor-2 catacombs layout.
 * @private
 */
function isCatacombsStyle(key) {
  return key === 'CATACOMBS';
}

/**
 * Pick a few rooms and grow them outward into surrounding wall tiles so they
 * become noticeably bigger than the rest. These 'star' rooms are where the
 * spectacle (ceiling cracks, sunbeams, set-piece encounters) lives.
 *
 * Rooms grow one tile at a time in random directions, only into solid walls
 * and only while a 1-tile buffer to other rooms is preserved. Capped by area.
 * @private
 */
function expandStarRooms(rooms, map, rng, count) {
  if (rooms.length === 0) return;
  const sorted = rooms.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const targets = sorted.slice(0, Math.min(count, sorted.length));
  const TARGET_AREA = 110;          // ~12x9
  const MAX_DIM     = { w: 14, h: 11 };

  for (const r of targets) {
    let safety = 60;
    const dirs = ['left', 'right', 'up', 'down'];
    while (r.w * r.h < TARGET_AREA && safety-- > 0) {
      // Shuffle directions each iteration so growth feels organic.
      for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
      }
      let grew = false;
      for (const dir of dirs) {
        if (tryExpand(r, map, dir, rooms, MAX_DIM)) { grew = true; break; }
      }
      if (!grew) break;
    }
    r.cx = r.x + (r.w >> 1);
    r.cy = r.y + (r.h >> 1);
    r.isLarge = true;
  }
}

/**
 * Try to grow a room by one tile in the given direction. Returns true on
 * success. Refuses to grow into the map border, into another room's tiles,
 * or to within 1 tile of another room (preserves a wall buffer).
 * @private
 */
function tryExpand(r, map, dir, allRooms, maxDim) {
  let nx = r.x, ny = r.y, nw = r.w, nh = r.h;
  let strip; // [{x,y}] tiles to convert to floor

  if (dir === 'left') {
    if (r.w >= maxDim.w) return false;
    if (r.x - 1 <= 1) return false;
    strip = [];
    for (let y = r.y; y < r.y + r.h; y++) strip.push({ x: r.x - 1, y });
    nx = r.x - 1; nw = r.w + 1;
  } else if (dir === 'right') {
    if (r.w >= maxDim.w) return false;
    if (r.x + r.w >= MAP_W - 1) return false;
    strip = [];
    for (let y = r.y; y < r.y + r.h; y++) strip.push({ x: r.x + r.w, y });
    nw = r.w + 1;
  } else if (dir === 'up') {
    if (r.h >= maxDim.h) return false;
    if (r.y - 1 <= 1) return false;
    strip = [];
    for (let x = r.x; x < r.x + r.w; x++) strip.push({ x, y: r.y - 1 });
    ny = r.y - 1; nh = r.h + 1;
  } else {
    if (r.h >= maxDim.h) return false;
    if (r.y + r.h >= MAP_H - 1) return false;
    strip = [];
    for (let x = r.x; x < r.x + r.w; x++) strip.push({ x, y: r.y + r.h });
    nh = r.h + 1;
  }

  // Every tile in the strip must currently be a wall.
  for (const t of strip) {
    if (map[t.y][t.x] !== T_WALL) return false;
  }
  // Preserve a 1-tile buffer to any other room.
  for (const other of allRooms) {
    if (other === r) continue;
    if (rectsOverlapWithBuffer(nx, ny, nw, nh, other, 1)) return false;
  }
  for (const t of strip) map[t.y][t.x] = T_FLOOR;
  r.x = nx; r.y = ny; r.w = nw; r.h = nh;
  return true;
}

/** Axis-aligned overlap test with a buffer in tiles. @private */
function rectsOverlapWithBuffer(x, y, w, h, other, buf) {
  return !(x + w + buf <= other.x ||
           other.x + other.w + buf <= x ||
           y + h + buf <= other.y ||
           other.y + other.h + buf <= y);
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
 * Build connections between rooms using Kruskal's MST plus a fraction of
 * extra short edges to introduce loops. Returns an array of [i, j] index
 * pairs into the `rooms` array.
 *
 * @param {Array} rooms
 * @param {() => number} rng
 * @param {number} extraRatio Extra edges as fraction of MST size (0.25–0.30 recommended).
 */
function buildConnections(rooms, rng, extraRatio) {
  const n = rooms.length;
  if (n < 2) return [];

  // Complete graph of room-centre distances.
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = rooms[i].cx - rooms[j].cx;
      const dy = rooms[i].cy - rooms[j].cy;
      edges.push({ i, j, d: dx * dx + dy * dy });
    }
  }
  edges.sort((a, b) => a.d - b.d);

  // Union-find for Kruskal.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return false;
    parent[ra] = rb;
    return true;
  };

  const out = [];
  const remaining = [];
  for (const e of edges) {
    if (union(e.i, e.j)) out.push([e.i, e.j]);
    else                 remaining.push(e);
  }

  // Add extra short edges from the unused pool to create loops.
  const nExtra = Math.round(out.length * extraRatio);
  // Bias toward shorter remaining edges (already sorted).
  const pickPool = remaining.slice(0, Math.max(nExtra * 3, 4));
  for (let k = 0; k < nExtra && pickPool.length > 0; k++) {
    const idx = Math.floor(rng() * pickPool.length);
    const e = pickPool.splice(idx, 1)[0];
    out.push([e.i, e.j]);
  }
  return out;
}

/**
 * Test if the L-shaped path between (ax,ay) and (bx,by) — going `horizontalFirst`
 * — passes through the interior of a room other than `a` or `b`.
 * @private
 */
function pathCrossesOtherRoom(rooms, a, b, horizontalFirst) {
  let x = a.cx, y = a.cy;
  const tx = b.cx, ty = b.cy;
  const cells = [];
  if (horizontalFirst) {
    while (x !== tx) { cells.push([x, y]); x += x < tx ? 1 : -1; }
    while (y !== ty) { cells.push([x, y]); y += y < ty ? 1 : -1; }
  } else {
    while (y !== ty) { cells.push([x, y]); y += y < ty ? 1 : -1; }
    while (x !== tx) { cells.push([x, y]); x += x < tx ? 1 : -1; }
  }
  for (const [px, py] of cells) {
    for (const r of rooms) {
      if (r === a || r === b) continue;
      // Strict interior — touching the edge is fine (that's a natural door).
      if (px > r.x && px < r.x + r.w - 1 && py > r.y && py < r.y + r.h - 1) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Carve a single floor cell plus a perpendicular brush so the corridor has
 * width `w`. For w=1 this is a single tile; for w=2 one extra tile is added
 * down/right; for w=3 one tile to each side.
 * @private
 */
function carveCell(map, x, y, w) {
  const half  = (w - 1) >> 1;
  const extra = (w - 1) - half;
  for (let dy = -half; dy <= extra; dy++) {
    for (let dx = -half; dx <= extra; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx > 0 && ny > 0 && nx < MAP_W - 1 && ny < MAP_H - 1) {
        map[ny][nx] = T_FLOOR;
      }
    }
  }
}

/**
 * Dig an L-shaped corridor of width `w` between two room centres. If the
 * default L would cross a third room's interior, try the alternative axis
 * order first; if both cross, fall back to the random pick.
 * @private
 */
function carveCorridor(map, a, b, allRooms, rng, w = 1) {
  let horizontalFirst = rng() < 0.5;
  if (pathCrossesOtherRoom(allRooms, a, b, horizontalFirst) &&
     !pathCrossesOtherRoom(allRooms, a, b, !horizontalFirst)) {
    horizontalFirst = !horizontalFirst;
  }

  let x = a.cx, y = a.cy;
  const tx = b.cx, ty = b.cy;
  if (horizontalFirst) {
    while (x !== tx) { carveCell(map, x, y, w); x += x < tx ? 1 : -1; }
    while (y !== ty) { carveCell(map, x, y, w); y += y < ty ? 1 : -1; }
  } else {
    while (y !== ty) { carveCell(map, x, y, w); y += y < ty ? 1 : -1; }
    while (x !== tx) { carveCell(map, x, y, w); x += x < tx ? 1 : -1; }
  }
  carveCell(map, tx, ty, w);
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
