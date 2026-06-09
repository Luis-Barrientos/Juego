/**
 * Procedural dungeon generation using Binary Space Partition (BSP).
 *
 * Each floor receives a unique seed and one of several visual / structural
 * "styles" so consecutive floors look and feel distinct. Generation is
 * deterministic for a given (seed, style) pair, which makes it possible to
 * support daily runs in later phases.
 */

import {
  TILE, MAP_W, MAP_H, T_WALL, T_FLOOR, T_STAIR, T_DOOR_LOCKED, MAX_FLOOR,
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
 * @returns {{map: number[][], rooms: object[], lights: object[], sunbeams: object[], puddles: object[], decorations: object[], sarcophagi: object[], libraryProps: object[], soulSpawners: object[], leafSpawners: object[], archiveMistSpawners: object[], startRoom: object, stairsRoom: object, style: string, seed: number}}
 */
export function generateDungeon(floor, seed, biome) {
  const finalSeed = seed ?? Math.floor(Math.random() * 0xFFFFFFFF);
  const rng       = mulberry32(finalSeed + floor * 1009);
  // Rotate styles per floor so the visual rhythm changes.
  const styleKey  = STYLE_KEYS[(floor - 1) % STYLE_KEYS.length];
  const style     = STYLES[styleKey];

  const map = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(T_WALL));
  const rooms = [];

  // -------------------------------------------------------------------
  // Step 1: reserve big set-piece rooms BEFORE running BSP.
  // BSP partitions the entire map into leaves with no awareness of any
  // future "special" room, so once leaves are filled the only space left
  // for star rooms is the thin sliver of wall between them. That caps how
  // big anything can grow.
  //
  // To guarantee enough space for monumental set-pieces (Great Library,
  // future bosses, etc.), we carve the special rectangle FIRST, register
  // it as a real room, then run BSP only on the strips of map that
  // surround it. Any room from this point on is generic, but the special
  // one is already guaranteed to be 20×16.
  // -------------------------------------------------------------------
  const isLibraryBiome = biome && biome.id === 'library';
  let greatLibraryRoom = null;
  let grandTomeRoom    = null;
  let observatoryRoom  = null;
  let keyRoomRoom      = null;
  let archiveRoom      = null;
  const bspRoots = [];

  // Debug overrides: when the F2 panel teleports to a set-piece on a
  // different floor it sets a window flag so the regenerated dungeon
  // guarantees that room exists regardless of the natural spawn roll.
  const FORCE = (typeof window !== 'undefined' && window.__DEBUG_FORCE) || {};
  const forceGrandTome   = !!FORCE.grandTome;
  const forceObservatory = !!FORCE.observatory;
  const forceGreatLib    = !!FORCE.greatLibrary;
  const forceKeyPair     = !!FORCE.keyRoom || !!FORCE.keyRoomKill || !!FORCE.keyRoomRune || !!FORCE.keyRoomCandle || !!FORCE.archive;
  const forceKeyVariant  = FORCE.keyRoomRune ? 'rune' : FORCE.keyRoomKill ? 'kill' : FORCE.keyRoomCandle ? 'candle' : null;
  const forceAlphaLair   = !!FORCE.alphaLair;
  const forceClaroSolar  = !!FORCE.claroSolar;

  // Sala del Gran Tomo first: it's smaller (11×9) and easier to fit, so
  // reserving it before the Great Library guarantees it never gets
  // squeezed out by the larger reservation.
  if (isLibraryBiome && (forceGrandTome || rng() < 0.70)) {
    const reservation = reserveSpecialRoom(map, rng, 11, 9, 2);
    if (reservation) {
      reservation.room.isGrandTome = true;
      rooms.push(reservation.room);
      grandTomeRoom = reservation.room;
      bspRoots.push(...reservation.strips);
    }
  }

  // Observatorio: standalone 9×9 buff room. Reserved before the Great
  // Library so it's never squeezed out. Odd-sized so the telescope (3×3)
  // aligns pixel-perfect with the central skylight beam.
  if (isLibraryBiome && (forceObservatory || rng() < 0.55)) {
    const sources = bspRoots.length ? bspRoots : [{ x: 1, y: 1, w: MAP_W - 2, h: MAP_H - 2 }];
    const res = reserveInStrips(map, rng, 9, 9, 2, sources);
    if (res) {
      res.room.isObservatory = true;
      rooms.push(res.room);
      observatoryRoom = res.room;
      const idx = bspRoots.indexOf(res.consumedStrip);
      if (idx >= 0) bspRoots.splice(idx, 1, ...res.strips);
      else          bspRoots.push(...res.strips);
    }
  }

  // Sala de la Llave + Archivo Prohibido: coupled pair. The key room
  // hosts a kill-all puzzle that drops a rune key; the archive sits
  // behind a locked door and rewards the player with a free legendary
  // chest. Both must fit or neither spawns — a lone archive is unfair
  // (no way to open it) and a lone key room is pointless.
  if (isLibraryBiome && (forceKeyPair || rng() < 0.55)) {
    const sourcesK = bspRoots.length ? bspRoots : [{ x: 1, y: 1, w: MAP_W - 2, h: MAP_H - 2 }];
    const resKey = reserveInStrips(map, rng, 9, 8, 2, sourcesK);
    if (resKey) {
      // Provisionally update the strip list so the archive search sees
      // the leftover space around the key room.
      const ki = bspRoots.indexOf(resKey.consumedStrip);
      if (ki >= 0) bspRoots.splice(ki, 1, ...resKey.strips);
      else         bspRoots.push(...resKey.strips);

      const sourcesA = bspRoots.length ? bspRoots : [{ x: 1, y: 1, w: MAP_W - 2, h: MAP_H - 2 }];
      // STRICT TR/BL placement: the archive MUST land on the top-right
      // or bottom-left quadrant. The start room is always top-left and
      // the stairs are usually bottom-right, so those two corners host
      // the critical path. Forcing the archive into a free corner
      // guarantees the locked door cannot sit on the spine of the
      // floor. If neither quadrant has room, the whole pair is rolled
      // back — the player just gets an archive-less floor that run.
      const inSafeQuadrant = (rx, ry) => {
        const ccx = rx + (7 >> 1);
        const ccy = ry + (6 >> 1);
        const right  = ccx >= (MAP_W >> 1);
        const bottom = ccy >= (MAP_H >> 1);
        return (right && !bottom) || (!right && bottom);
      };
      const resArch = reserveInStrips(map, rng, 7, 6, 2, sourcesA, inSafeQuadrant);
      if (resArch) {
        resKey.room.isKeyRoom = true;
        rooms.push(resKey.room);
        keyRoomRoom = resKey.room;
        resArch.room.isForbiddenArchive = true;
        rooms.push(resArch.room);
        archiveRoom = resArch.room;
        const ai = bspRoots.indexOf(resArch.consumedStrip);
        if (ai >= 0) bspRoots.splice(ai, 1, ...resArch.strips);
        else         bspRoots.push(...resArch.strips);
      } else {
        // Roll back the key room: repaint walls and restore the strip
        // list to the state before we tried to reserve it.
        for (let y = resKey.room.y; y < resKey.room.y + resKey.room.h; y++) {
          for (let x = resKey.room.x; x < resKey.room.x + resKey.room.w; x++) {
            map[y][x] = T_WALL;
          }
        }
        for (const s of resKey.strips) {
          const idx = bspRoots.indexOf(s);
          if (idx >= 0) bspRoots.splice(idx, 1);
        }
        bspRoots.push(resKey.consumedStrip);
      }
    }
  }
  // Great Library second: claim the largest strip that fits its 20×16
  // footprint with a 3-tile margin, falling back to the full map if no
  // tome was reserved.
  if (isLibraryBiome && (forceGreatLib || rng() < 0.70)) {
    const sources = bspRoots.length ? bspRoots : [{ x: 1, y: 1, w: MAP_W - 2, h: MAP_H - 2 }];
    const res = reserveInStrips(map, rng, 20, 16, 3, sources);
    if (res) {
      res.room.isGreatLibrary = true;
      res.room.isLarge = true;
      rooms.push(res.room);
      greatLibraryRoom = res.room;
      const idx = bspRoots.indexOf(res.consumedStrip);
      if (idx >= 0) bspRoots.splice(idx, 1, ...res.strips);
      else          bspRoots.push(...res.strips);
    }
  }

  if (bspRoots.length === 0) {
    bspRoots.push({ x: 1, y: 1, w: MAP_W - 2, h: MAP_H - 2 });
  }

  // Step 2: BSP each free region independently. Strips smaller than the
  // BSP minimum are dropped automatically by splitNode.
  const leaves = [];
  for (const root of bspRoots) {
    splitNode(root, style.depth, leaves, rng, style);
  }

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
  // catacombs floor gets exactly one (the crypta). The library biome
  // already has its star reserved as the Great Library, so we skip the
  // generic promotion there.
  const starCount = isRuinsStyle(styleKey)     ? (1 + Math.floor(rng() * 2))
                  : isCatacombsStyle(styleKey) ? 1
                  : (isLibraryBiome && !greatLibraryRoom) ? 1
                  : 0;
  if (starCount > 0) expandStarRooms(rooms, map, rng, starCount);

  // Detect start (top-left-most) and stairs (farthest from start) rooms
  // BEFORE placing pillars/sarcophagi so those placers can skip them.
  // The actual T_STAIR tile is written later, after structural placers.
  // Set-pieces (Sala de la Llave, Archivo, Gran Tomo, Observatorio, Gran
  // Biblioteca) are excluded from both picks: they have their own
  // bespoke contents and putting the spawn or the staircase inside one
  // would either softlock the run (locked archive) or overwrite the
  // set-piece (e.g. stairs over the kill-all rune dais).
  const isSetPiece = (r) =>
    r.isKeyRoom || r.isForbiddenArchive || r.isObservatory ||
    r.isGrandTome || r.isGreatLibrary;
  const normalRooms = rooms.filter(r => !isSetPiece(r));
  // Fallback: if nothing else exists (very small floor) accept any room.
  const candidates = normalRooms.length ? normalRooms : rooms;
  let startRoom = candidates[0];
  for (const r of candidates) {
    if (r.cx + r.cy < startRoom.cx + startRoom.cy) startRoom = r;
  }
  let stairsRoom = startRoom;
  let bestD = 0;
  for (const r of candidates) {
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
      // Library uses magic flames as primary lighting; a couple of warm
      // sconces per room prevent the floor from feeling too dark.
      placeWallSconces(map, r, rng, lights, style.torchDensity * 0.15);
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
    // Claro Solar: safe room with maxhp blessing + full map reveal
    if (forceClaroSolar || rng() < 0.55) {
      const starRooms = rooms.filter(r => r.isLarge && !r.isStartRoom && !r.isStairsRoom);
      if (starRooms.length) {
        const shrineRoom = starRooms[Math.floor(rng() * starRooms.length)];
        placeClaroSolar(shrineRoom, map, rng, sunbeams, libraryProps);
      }
    }
    if (forceAlphaLair || rng() < 0.55) {
      const starRooms = rooms.filter(r => r.isLarge && !r.isStartRoom && !r.isStairsRoom && !r.isClaroSolar);
      if (starRooms.length) {
        const lairRoom = starRooms[Math.floor(rng() * starRooms.length)];
        placeAlphaLair(lairRoom, map, rng, lights, libraryProps);
      }
    }
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

  // Library biome ambient anchors: spawners that periodically drop
  // floating leaves / paper scraps from the ceiling. Filled by the
  // library block below so the magicFlame lights exist already.
  const leafSpawners = [];

  let librarySetPiece = null;
  let grandTome       = null;
  const archiveMistSpawners = [];
  if (isLibrary) {
    placeMagicFlames(rooms, rng, lights);
    placeRoomWallDecorations(map, rooms, rng, decorations, lights,
      ['wallShelf', 'scrollHanging', 'runeSymbol', 'darkPortrait', 'noticeBoard']);
    // Paint small floor rune marks next to ~40% of the magic flames.
    placeLibraryRuneMarks(map, rooms, rng, lights, libraryProps);
    // Attach a small floating rune glyph to every magic flame (live overlay).
    decorateMagicFlamesWithRunes(lights, rng);
    // Spawners for drifting leaves / paper scraps (per room).
    placeLibraryLeafSpawners(rooms, rng, leafSpawners);
    // Lay the Great Library set-piece on the room we reserved up top.
    if (greatLibraryRoom) {
      librarySetPiece = placeLibrarySetPiece(greatLibraryRoom, map, rng, libraryProps);
    }
    if (grandTomeRoom) {
      grandTome = placeGrandTome(grandTomeRoom, map, rng, libraryProps, lights);
    }
    if (observatoryRoom) {
      placeObservatory(observatoryRoom, map, rng, libraryProps, lights, sunbeams, decorations);
    }
    if (keyRoomRoom && archiveRoom) {
      if (forceKeyVariant) keyRoomRoom.keyVariant = forceKeyVariant;
      placeKeyRoom(keyRoomRoom, map, rng, libraryProps, lights);
      placeForbiddenArchive(archiveRoom, map, rng, libraryProps, lights, startRoom, archiveMistSpawners, decorations);
      // Two safety nets after the lock is placed:
      //  1) The locked door must NOT cut the start→stairs path.
      //  2) The locked door tile itself must be reachable from start
      //     (an outside neighbour of the door tile, walking around the
      //     archive). Otherwise the player cannot use the key even with
      //     it in hand — the door is buried in an isolated pocket.
      // Failing either check unlocks the archive entirely (chest stays
      // as a freebie reward — strictly better than softlocking the run).
      if (!isReachable(map, startRoom, stairsRoom) ||
          !isDoorReachableFromStart(map, archiveRoom, startRoom)) {
        unlockArchive(map, archiveRoom);
      }
    }
  }

  return { map, rooms, lights, sunbeams, puddles, decorations, sarcophagi, libraryProps, soulSpawners, leafSpawners, archiveMistSpawners, librarySetPiece, grandTome, startRoom, stairsRoom, style: styleKey, seed: finalSeed };
}

/**
 * BFS from the start room's centre to the stairs room's centre, treating
 * `T_DOOR_LOCKED` as blocking. Returns true if a path exists.
 * @private
 */
function isReachable(map, startRoom, stairsRoom) {
  const sx = startRoom.cx, sy = startRoom.cy;
  const tx = stairsRoom.cx, ty = stairsRoom.cy;
  const seen = new Uint8Array(MAP_W * MAP_H);
  const queue = [[sx, sy]];
  seen[sy * MAP_W + sx] = 1;
  while (queue.length) {
    const [x, y] = queue.shift();
    if (x === tx && y === ty) return true;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const idx = ny * MAP_W + nx;
      if (seen[idx]) continue;
      const t = map[ny][nx];
      // Locked doors block here — that's the whole point of the test.
      if (t === T_WALL || t === T_DOOR_LOCKED) continue;
      seen[idx] = 1;
      queue.push([nx, ny]);
    }
  }
  return false;
}

/**
 * Final reachability check for the locked archive door. Returns true if
 * any of the 4 outside neighbours of the door tile is reachable from
 * the start room (BFS treats archive interior and T_DOOR_LOCKED as
 * walls). False means the player can't even *walk up* to the door, so
 * the lock should be defused.
 * @private
 */
function isDoorReachableFromStart(map, archiveRoom, startRoom) {
  if (!archiveRoom || !archiveRoom.doorTiles || archiveRoom.doorTiles.length === 0) return true;
  const ax0 = archiveRoom.x, ax1 = archiveRoom.x + archiveRoom.w;
  const ay0 = archiveRoom.y, ay1 = archiveRoom.y + archiveRoom.h;
  const inArchive = (x, y) => x >= ax0 && x < ax1 && y >= ay0 && y < ay1;

  // Collect approach tiles (floor neighbours outside the archive) for ALL doors.
  const allApproaches = [];
  for (const door of archiveRoom.doorTiles) {
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = door.tx + dx, ny = door.ty + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (inArchive(nx, ny)) continue;
      if (map[ny][nx] === T_FLOOR) allApproaches.push({ tx: nx, ty: ny });
    }
  }
  if (allApproaches.length === 0) return false;
  const seen = new Uint8Array(MAP_W * MAP_H);
  const queue = [[startRoom.cx, startRoom.cy]];
  seen[startRoom.cy * MAP_W + startRoom.cx] = 1;
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const a of allApproaches) if (a.tx === x && a.ty === y) return true;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const idx = ny * MAP_W + nx;
      if (seen[idx]) continue;
      if (inArchive(nx, ny)) continue;
      const t = map[ny][nx];
      if (t === T_WALL || t === T_DOOR_LOCKED) continue;
      seen[idx] = 1;
      queue.push([nx, ny]);
    }
  }
  return false;
}

/**
 * Defuse the Archivo Prohibido lock when the validator detects a
 * softlock: turn every locked-door tile in the floor back into a
 * walkable floor tile, restore any alternate entrances that were
 * bricked up to enforce the puzzle, and clear the room's `doorTile`
 * reference so the gameplay layer doesn't try to consume the key.
 * @private
 */
function unlockArchive(map, archiveRoom) {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (map[y][x] === T_DOOR_LOCKED) map[y][x] = T_FLOOR;
    }
  }
  if (archiveRoom) {
    archiveRoom.doorTiles = null;
  }
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
    if (r.isKeyRoom) continue;          // arena room — no wall decor
    if (r.isForbiddenArchive) continue; // sealed vault, hand-decorated
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
    if (r.isObservatory) continue; // own corner candles, no roaming flames
    if (r.w < 5 || r.h < 4) continue;

    const count = 1 + (r.isLarge ? Math.floor(rng() * 2) : 0);
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
 * Attach a small levitating rune glyph to every existing magicFlame.
 * The glyph orbits the flame at a fixed offset and pulses; rendered as
 * a live overlay in render.js, never touches the map.
 * @private
 */
function decorateMagicFlamesWithRunes(lights, rng) {
  for (const l of lights) {
    if (l.type !== 'magicFlame') continue;
    l.rune = {
      // 4 possible glyph shapes — picked once per flame for variety.
      shape:    Math.floor(rng() * 4),
      // Orbit offset relative to the flame: small radius, random initial angle.
      orbitR:   8 + rng() * 4,
      phase:    rng() * Math.PI * 2,
      // Bob amplitude on the Y axis (in addition to orbiting).
      bobAmp:   2 + rng() * 2,
      bobSpeed: 1.4 + rng() * 0.8,
    };
  }
}

/**
 * Paint a small (1×1) rune mark on the floor adjacent to ~40% of the
 * magic flames. Walkable; stored as a 'libraryRuneMark' libraryProp so
 * the existing draw pass picks it up.
 * @private
 */
function placeLibraryRuneMarks(map, rooms, rng, lights, libraryProps) {
  for (const l of lights) {
    if (l.type !== 'magicFlame') continue;
    if (rng() > 0.40) continue;
    // Snap to the nearest interior floor tile within a 3-tile box.
    const cxT = Math.floor(l.ax / TILE);
    const cyT = Math.floor(l.ay / TILE);
    const candidates = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cxT + dx, yy = cyT + dy;
        if (!map[yy] || map[yy][xx] !== T_FLOOR) continue;
        candidates.push({ xx, yy });
      }
    }
    if (!candidates.length) continue;
    const c = candidates[Math.floor(rng() * candidates.length)];
    // Avoid stacking on a tile that already hosts a rune mark.
    if (libraryProps.some(p => p.kind === 'libraryRuneMark' && p.tx === c.xx && p.ty === c.yy)) continue;
    libraryProps.push({
      kind: 'libraryRuneMark',
      tx: c.xx, ty: c.yy, w: 1, h: 1,
      seed: Math.floor(rng() * 1e9),
    });
  }
}

/**
 * For each non-tiny library room, register 1-2 ambient leaf spawners
 * anchored at random ceiling-side positions. Each spawner periodically
 * emits a falling 'leaf' particle. Skips the Grand Tome and Great Library
 * since those rooms already have their own atmosphere.
 * @private
 */
function placeLibraryLeafSpawners(rooms, rng, leafSpawners) {
  for (const r of rooms) {
    if (r.isStartRoom) continue;
    if (r.isGrandTome) continue;
    if (r.isObservatory) continue;
    if (r.isForbiddenArchive) continue;
    if (r.w < 5 || r.h < 4) continue;
    if (rng() < 0.4) continue;
    const count = r.isLarge || r.isGreatLibrary
      ? 1 + Math.floor(rng() * 2)
      : 1;
    for (let i = 0; i < count; i++) {
      const sx = (r.x + 1 + rng() * (r.w - 2)) * TILE;
      const sy = (r.y + 0.5 + rng() * 1.5) * TILE;
      leafSpawners.push({
        x: sx,
        y: sy,
        timer: 3 + rng() * 5,
        hue:   rng() < 0.5 ? 'paper' : 'leaf',
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
    if (r.isGreatLibrary) continue; // hand-decorated by the set-piece placer
    if (r.isGrandTome) continue;    // pedestal is the only prop in here
    if (r.isObservatory) continue;  // hand-decorated by the observatory placer
    if (r.isKeyRoom) continue;       // arena room — must stay clear for combat
    if (r.isForbiddenArchive) continue; // hand-decorated by the archive placer
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
    if (r.isGreatLibrary) continue; // hand-decorated by the set-piece placer
    if (r.isGrandTome) continue;    // pedestal is the only prop in here
    if (r.isObservatory) continue;  // hand-decorated by the observatory placer
    if (r.isKeyRoom) continue;       // arena room — must stay clear for combat
    if (r.isForbiddenArchive) continue; // hand-decorated by the archive placer
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
 * Reserve a `w`×`h` rectangle in the map BEFORE BSP runs so a special
 * set-piece room (Great Library, future bosses, …) is guaranteed enough
 * space. The rectangle is carved as floor and returned alongside the
 * surrounding free strips, which the caller feeds to `splitNode` so
 * normal rooms grow only in the leftover space.
 *
 * Position is randomized but kept at least `margin` tiles from every
 * map edge so corridors can wrap around the reservation if needed.
 *
 * Returns `{ room, strips }` or `null` if the map is too small.
 *
 * @private
 */
function reserveSpecialRoom(map, rng, w, h, margin = 3) {
  const maxX = MAP_W - 1 - margin - w;
  const maxY = MAP_H - 1 - margin - h;
  if (maxX < margin || maxY < margin) return null;

  const rx = margin + Math.floor(rng() * (maxX - margin + 1));
  const ry = margin + Math.floor(rng() * (maxY - margin + 1));

  for (let y = ry; y < ry + h; y++) {
    for (let x = rx; x < rx + w; x++) map[y][x] = T_FLOOR;
  }

  const room = {
    x: rx, y: ry, w, h,
    cx: rx + (w >> 1),
    cy: ry + (h >> 1),
    enemies: [],
    cleared: false,
    visited: false,
  };

  // Up-to-4 free strips around the reservation (top / bottom / left /
  // right). A 1-tile wall buffer is preserved on every side so corridors
  // can carve through. Strips that are too thin for BSP to do anything
  // meaningful are dropped here; splitNode also filters by minDim.
  const MIN_STRIP = 6;
  const strips = [];
  // top
  if (ry - 2 >= MIN_STRIP) {
    strips.push({ x: 1, y: 1, w: MAP_W - 2, h: ry - 2 });
  }
  // bottom
  const bottomY = ry + h + 1;
  if (MAP_H - 1 - bottomY >= MIN_STRIP) {
    strips.push({ x: 1, y: bottomY, w: MAP_W - 2, h: MAP_H - 1 - bottomY });
  }
  // left (only spans the reservation's vertical band — top/bottom strips
  // already cover everything outside it).
  if (rx - 2 >= MIN_STRIP) {
    strips.push({ x: 1, y: ry, w: rx - 2, h });
  }
  // right
  const rightX = rx + w + 1;
  if (MAP_W - 1 - rightX >= MIN_STRIP) {
    strips.push({ x: rightX, y: ry, w: MAP_W - 1 - rightX, h });
  }

  return { room, strips };
}

/**
 * Try to reserve a w×h rectangle inside one of the existing free
 * `strips` (output of `reserveSpecialRoom`). Picks the largest strip
 * that fits, places the room with `margin` tiles of buffer to every
 * strip edge, carves it as floor and returns:
 *
 *   { room, strips: leftover strips that surround the new room,
 *     consumedStrip: the strip that was split }
 *
 * The caller is expected to remove `consumedStrip` from the BSP root
 * list and push the leftovers in its place.
 *
 * Returns null if no strip is big enough.
 *
 * @private
 */
function reserveInStrips(map, rng, w, h, margin, strips, prefer = null) {
  const fits = strips.filter(s => s.w >= w + margin * 2 && s.h >= h + margin * 2);
  if (!fits.length) return null;
  fits.sort((a, b) => (b.w * b.h) - (a.w * a.h));

  // With a `prefer(rx, ry)` filter active, walk every fitting strip from
  // largest to smallest and sample up to 16 random positions per strip
  // looking for one that satisfies the predicate. Without a filter,
  // keep the legacy single-shot pick on the largest strip.
  for (const strip of fits) {
    const maxX = strip.x + strip.w - margin - w;
    const maxY = strip.y + strip.h - margin - h;
    const minX = strip.x + margin;
    const minY = strip.y + margin;

    let rx, ry;
    if (prefer) {
      let found = false;
      for (let i = 0; i < 64; i++) {
        const tx = minX + Math.floor(rng() * Math.max(1, maxX - minX + 1));
        const ty = minY + Math.floor(rng() * Math.max(1, maxY - minY + 1));
        if (prefer(tx, ty)) { rx = tx; ry = ty; found = true; break; }
      }
      if (!found) continue;
    } else {
      rx = minX + Math.floor(rng() * Math.max(1, maxX - minX + 1));
      ry = minY + Math.floor(rng() * Math.max(1, maxY - minY + 1));
    }

    for (let y = ry; y < ry + h; y++) {
      for (let x = rx; x < rx + w; x++) map[y][x] = T_FLOOR;
    }

    const room = {
      x: rx, y: ry, w, h,
      cx: rx + (w >> 1),
      cy: ry + (h >> 1),
      enemies: [],
      cleared: false,
      visited: false,
    };

    // Cut the consumed strip into up to 4 leftover strips around the room.
    const MIN_STRIP = 6;
    const leftover = [];
    if (ry - strip.y - 2 >= MIN_STRIP) {
      leftover.push({ x: strip.x, y: strip.y, w: strip.w, h: ry - strip.y - 2 });
    }
    const bottomY = ry + h + 1;
    if (strip.y + strip.h - bottomY >= MIN_STRIP) {
      leftover.push({ x: strip.x, y: bottomY, w: strip.w, h: strip.y + strip.h - bottomY });
    }
    if (rx - strip.x - 2 >= MIN_STRIP) {
      leftover.push({ x: strip.x, y: ry, w: rx - strip.x - 2, h });
    }
    const rightX = rx + w + 1;
    if (strip.x + strip.w - rightX >= MIN_STRIP) {
      leftover.push({ x: rightX, y: ry, w: strip.x + strip.w - rightX, h });
    }

    return { room, strips: leftover, consumedStrip: strip };
  }
  return null;
}

/**
 * Paint horizontal bookshelf rows inside the Great Library, separated by
 * walking aisles, with a clear central rotunda for the summoning circle
 * and a 3-tile-wide central N-S aisle that connects every row.
 *
 * Each shelf tile is written as T_WALL and registered as a 'shelf'
 * libraryProp so it renders consistently with the existing shelves.
 * @private
 */
function paintGreatLibraryAisles(room, map, rng, libraryProps) {
  const { x, y, w, h, cx, cy } = room;
  // Need enough space for at least one row of shelves on either side of
  // the rotunda and a full perimeter aisle. Smaller rooms fall back to
  // a bare floor with the circle (handled by the caller).
  if (w < 11 || h < 9) return;

  // 5×5 rotunda kept clear around the centre (cx ± 2, cy ± 2). Smaller
  // than it sounds: 2 tiles around the 2×2 circle let the four rune
  // stones breathe without swallowing the bookshelf rows.
  const rotR = 2;
  const rotMinY = cy - rotR, rotMaxY = cy + rotR;

  // Bookshelf rows every 3 tiles starting at y+2. Aisles between rows are
  // 2 tiles thick (good for walking). Skip rows that fall inside the
  // rotunda y-band.
  for (let ty = y + 2; ty <= y + h - 3; ty += 3) {
    if (ty >= rotMinY && ty <= rotMaxY) continue;
    paintShelfRow(map, libraryProps, rng, x + 2, cx - 2, ty);          // left wing
    paintShelfRow(map, libraryProps, rng, cx + 2, x + w - 3, ty);      // right wing
  }
}

/**
 * Paint a horizontal shelf row from x1..x2 (inclusive) at y, in 2-tile
 * chunks, falling back to 1-tile chunks at the tail. Skips tiles that
 * aren't currently floor (so we never block a corridor entry).
 * @private
 */
function paintShelfRow(map, libraryProps, rng, x1, x2, y) {
  if (x2 < x1) return;
  let cur = x1;
  while (cur <= x2) {
    // Try a 2-tile chunk if both tiles are floor and there's room.
    if (cur + 1 <= x2 &&
        map[y] && map[y][cur] === T_FLOOR && map[y][cur + 1] === T_FLOOR) {
      map[y][cur] = T_WALL;
      map[y][cur + 1] = T_WALL;
      libraryProps.push({
        kind: 'shelf', tx: cur, ty: y, w: 2, h: 1,
        orient: 'h', face: rng() < 0.5 ? 'S' : 'N',
        seed: Math.floor(rng() * 1e9),
      });
      cur += 2;
      continue;
    }
    // 1-tile fallback (tail or blocked neighbour).
    if (map[y] && map[y][cur] === T_FLOOR) {
      map[y][cur] = T_WALL;
      libraryProps.push({
        kind: 'shelf', tx: cur, ty: y, w: 1, h: 1,
        orient: 'h', face: rng() < 0.5 ? 'S' : 'N',
        seed: Math.floor(rng() * 1e9),
      });
    }
    cur += 1;
  }
}

/**
 * Place the Great Library set-piece in the room reserved by
 * `reserveSpecialRoom`: paint bookshelf aisles around a clear central
 * rotunda, lay a 2×2 summoning circle at the centre and four floating
 * rune stones around it. The circle is walkable (no T_WALL writes) so
 * the player can step onto it to trigger the encounter via E.
 *
 * Returns the set-piece descriptor or null if `room` is missing.
 *
 * @private
 */
function placeLibrarySetPiece(room, map, rng, libraryProps) {
  if (!room) return null;
  room.isGreatLibrary = true;

  // Paint the bookshelf aisles + central rotunda. Only attempted on rooms
  // big enough to fit them; smaller rooms fall back to a bare circle.
  paintGreatLibraryAisles(room, map, rng, libraryProps);

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

/**
 * Place the Sala del Gran Tomo set-piece: a stone pedestal at the centre
 * of the room with a giant levitating tome on top. The pedestal is a
 * 2×2 solid (T_WALL) registered as a libraryProp so the rest of the
 * world ignores it (collision and rendering ride the existing pipeline).
 *
 * The encounter (Simon-Says of 5–7 directions) is driven entirely from
 * `grandTome.js`; here we just commit the geometry and return the
 * descriptor.
 *
 * @private
 */
function placeGrandTome(room, map, rng, libraryProps, lights) {
  if (!room) return null;
  room.isGrandTome = true;

  // -----------------------------------------------------------------
  // Symmetric layout for an 11×9 room.
  //
  //   cx = room.x + 5,  cy = room.y + 4
  //   Pedestal 3×3 at (cx-1, cy-1) — its visual centre falls on the
  //   centre of the room's central tile, NOT on a tile boundary, so it
  //   shares parity with the 5×5 floor circle.
  //   Circle   5×5 at (cx-2, cy-2) — centred on the same point.
  //   4 corner braziers (1×1) at the room's interior corners.
  //   Single-tile bookshelves all along the inner perimeter except
  //   the 5-tile-wide gap centred on the pedestal axes (so the rune
  //   ring is visible from any door).
  // -----------------------------------------------------------------

  const cx = room.cx;
  const cy = room.cy;
  const pedTx = cx - 1;
  const pedTy = cy - 1;
  const pedSize = 3;
  const circleSize = 5;
  const circleTx = cx - 2;
  const circleTy = cy - 2;

  // Wipe any prop that overlaps the pedestal/circle footprint (just in
  // case the order changes later).
  for (let i = libraryProps.length - 1; i >= 0; i--) {
    const p = libraryProps[i];
    if (p.tx + p.w <= circleTx || p.tx >= circleTx + circleSize) continue;
    if (p.ty + p.h <= circleTy || p.ty >= circleTy + circleSize) continue;
    for (let yy = p.ty; yy < p.ty + p.h; yy++) {
      for (let xx = p.tx; xx < p.tx + p.w; xx++) {
        if (map[yy] && map[yy][xx] === T_WALL) map[yy][xx] = T_FLOOR;
      }
    }
    libraryProps.splice(i, 1);
  }

  // 1. Big runic ring painted on the floor under the pedestal (5×5,
  //    walkable, does not touch the map).
  libraryProps.push({
    kind: 'tomeCircle',
    tx: circleTx, ty: circleTy, w: circleSize, h: circleSize,
    seed: Math.floor(rng() * 1e9),
  });

  // 2. Scattered open books / scrolls on the floor (walkable decor).
  //    Fixed symmetric positions: one in each "corner zone" between the
  //    circle and the brazier so the room reads as balanced.
  const bookSpots = [
    { x: room.x + 2,             y: room.y + 1 },             // NW
    { x: room.x + room.w - 3,    y: room.y + 1 },             // NE
    { x: room.x + 2,             y: room.y + room.h - 2 },    // SW
    { x: room.x + room.w - 3,    y: room.y + room.h - 2 },    // SE
  ];
  for (const spot of bookSpots) {
    if (!map[spot.y] || map[spot.y][spot.x] !== T_FLOOR) continue;
    libraryProps.push({
      kind: 'tomeBookPile',
      tx: spot.x, ty: spot.y, w: 1, h: 1,
      seed: Math.floor(rng() * 1e9),
    });
  }

  // 3. Carve the pedestal as solid wall tiles so it blocks movement.
  for (let yy = pedTy; yy < pedTy + pedSize; yy++) {
    for (let xx = pedTx; xx < pedTx + pedSize; xx++) map[yy][xx] = T_WALL;
  }
  libraryProps.push({
    kind: 'tomePedestal',
    tx: pedTx, ty: pedTy, w: pedSize, h: pedSize,
    seed: Math.floor(rng() * 1e9),
  });

  // 4. Four corner braziers at the room's interior corners. Symmetric.
  const corners = [
    { x: room.x,                 y: room.y },
    { x: room.x + room.w - 1,    y: room.y },
    { x: room.x,                 y: room.y + room.h - 1 },
    { x: room.x + room.w - 1,    y: room.y + room.h - 1 },
  ];
  for (const c of corners) {
    if (!map[c.y] || map[c.y][c.x] !== T_FLOOR) continue;
    if (isNearDoor(map, c.x, c.y, room)) continue;
    map[c.y][c.x] = T_WALL;
    libraryProps.push({
      kind: 'tomeBrazier',
      tx: c.x, ty: c.y, w: 1, h: 1,
      seed: Math.floor(rng() * 1e9),
    });
    if (lights) {
      lights.push({
        type:    'magicFlame',
        ax: c.x * TILE + TILE / 2,
        ay: c.y * TILE + 6,
        bx: c.x * TILE + TILE / 2,
        by: c.y * TILE + 6,
        x:  c.x * TILE + TILE / 2,
        y:  c.y * TILE + 6,
        phase:   rng() * Math.PI * 2,
        speed:   0.15 + rng() * 0.10,
        wobble:  rng() * Math.PI * 2,
        color:   [180, 120, 255],
        r:       70,
        flicker: rng() * Math.PI * 2,
      });
    }
  }

  // 5. Single-tile bookshelves along the inner perimeter. Skip a 5-tile
  //    gap centred on the pedestal so the runic ring stays visible from
  //    any approach, skip the corners (braziers) and any door tile.
  const GAP = 2; // half-width of the central gap (5 tiles total: cx-2..cx+2)
  const trySingleShelf = (xx, yy, orient, face) => {
    if (!map[yy] || map[yy][xx] !== T_FLOOR) return false;
    if (isNearDoor(map, xx, yy, room)) return false;
    map[yy][xx] = T_WALL;
    libraryProps.push({
      kind: 'shelf',
      tx: xx, ty: yy, w: 1, h: 1,
      orient, face,
      seed: Math.floor(rng() * 1e9),
    });
    return true;
  };

  // Top and bottom walls (skip corners and central gap).
  for (let xx = room.x + 1; xx <= room.x + room.w - 2; xx++) {
    if (Math.abs(xx - cx) <= GAP) continue;
    trySingleShelf(xx, room.y,             'h', 'S');
    trySingleShelf(xx, room.y + room.h - 1, 'h', 'N');
  }
  // Left and right walls (skip corners and central gap).
  for (let yy = room.y + 1; yy <= room.y + room.h - 2; yy++) {
    if (Math.abs(yy - cy) <= GAP) continue;
    trySingleShelf(room.x,             yy, 'v', 'E');
    trySingleShelf(room.x + room.w - 1, yy, 'v', 'W');
  }

  return {
    room,
    pedestal: { tx: pedTx, ty: pedTy, w: pedSize, h: pedSize },
    state: 'idle',         // 'idle' | 'showing' | 'awaiting' | 'failed' | 'success'
    sequence: [],          // ['up'|'down'|'left'|'right', ...]
    showIndex: 0,          // step currently flashing during 'showing'
    showTimer: 0,
    inputIndex: 0,         // step the player is expected to input next
    inputTimer: 0,         // soft idle timer in 'awaiting'
    attempts: 0,           // attempts spent
    maxAttempts: 3,
    completed: false,
    rewardGiven: false,
    sealedTiles: [],
    failWaveSpawned: false,
    flashKey: null,        // last key pressed, for the brief feedback flash
    flashTimer: 0,
  };
}

/**
 * True if (x,y) is a perimeter floor tile that has a corridor coming in
 * through the adjacent wall ring. We only care about the cardinal that
 * points OUT of the room: if that wall tile is floor (the corridor
 * carver punched through), this tile (and the one next to it) is the
 * door entry and must stay walkable.
 * @private
 */
function isNearDoor(map, x, y, room) {
  // Build the list of "outward" cardinals based on which edge(s) this
  // tile sits on. Interior tiles return false straight away.
  const out = [];
  if (x === room.x)             out.push([-1,  0]);
  if (x === room.x + room.w - 1) out.push([ 1,  0]);
  if (y === room.y)             out.push([ 0, -1]);
  if (y === room.y + room.h - 1) out.push([ 0,  1]);
  if (out.length === 0) return false;
  for (const [dx, dy] of out) {
    // This tile itself: outside neighbour is floor → door right here.
    if (map[y + dy] && map[y + dy][x + dx] === T_FLOOR) return true;
    // One tile to either side along the wall: protect a 3-tile gap so
    // the doorway never gets shouldered.
    for (let s = -1; s <= 1; s++) {
      if (s === 0) continue;
      const sx = dy === 0 ? x : x + s;
      const sy = dy === 0 ? y + s : y;
      if (map[sy + dy] && map[sy + dy][sx + dx] === T_FLOOR) return true;
    }
  }
  return false;
}

/**
 * Library biome: an "Observatorio". 9×9 sealed-roof room with a 3×3
 * telescope at the centre, a bright skylight beam falling on the
 * telescope, painted constellations on the floor, and four corner stone
 * obelisks. While the player stands inside, a passive HP/MP regen buff
 * applies (handled in main.js by checking room.isObservatory).
 *
 * Layout (cx = room.x+4, cy = room.y+4):
 *   • Telescope 3×3 at (cx-1, cy-1) — solid (T_WALL).
 *   • Floor circle 7×7 at (cx-3, cy-3) — walkable rune ring.
 *   • Skylight beam: single beam centred on the room, length = room.h.
 *   • Corner obelisks: 1×1 solid pillars in the 4 inner corners.
 *   • Bookstands lining inner perimeter, gap of 5 tiles centred on the
 *     telescope so the constellation stays visible from every door.
 *
 * @private
 */
function placeObservatory(room, map, rng, libraryProps, lights, sunbeams, decorations) {
  if (!room) return;
  room.isObservatory = true;

  const cx = room.cx;
  const cy = room.cy;
  const teleSize = 3;
  const teleTx = cx - 1;
  const teleTy = cy - 1;
  const ringSize = 7;
  const ringTx = cx - 3;
  const ringTy = cy - 3;

  // Wipe ANY existing library prop inside the room footprint — we hand-
  // place every prop in this sanctuary and don't want shelves or tables
  // leaking through into the constellation ring.
  for (let i = libraryProps.length - 1; i >= 0; i--) {
    const p = libraryProps[i];
    if (p.tx + p.w <= room.x || p.tx >= room.x + room.w) continue;
    if (p.ty + p.h <= room.y || p.ty >= room.y + room.h) continue;
    for (let yy = p.ty; yy < p.ty + p.h; yy++) {
      for (let xx = p.tx; xx < p.tx + p.w; xx++) {
        if (map[yy] && map[yy][xx] === T_WALL) map[yy][xx] = T_FLOOR;
      }
    }
    libraryProps.splice(i, 1);
  }

  // Wipe wall decorations on the row above the room — that's where the
  // dome silhouette lives now, so we don't want scroll hangings or
  // portraits painted in the middle of the cupola.
  if (decorations) {
    for (let i = decorations.length - 1; i >= 0; i--) {
      const d = decorations[i];
      if (d.ty !== room.y - 1) continue;
      if (d.tx < room.x || d.tx >= room.x + room.w) continue;
      decorations.splice(i, 1);
    }
  }

  // 1. Constellation ring painted on the floor (walkable, 7×7).
  libraryProps.push({
    kind: 'constellationRing',
    tx: ringTx, ty: ringTy, w: ringSize, h: ringSize,
    seed: Math.floor(rng() * 1e9),
  });

  // 2. Telescope: 3×3 solid prop carved as walls.
  for (let yy = teleTy; yy < teleTy + teleSize; yy++) {
    for (let xx = teleTx; xx < teleTx + teleSize; xx++) map[yy][xx] = T_WALL;
  }
  libraryProps.push({
    kind: 'telescope',
    tx: teleTx, ty: teleTy, w: teleSize, h: teleSize,
    seed: Math.floor(rng() * 1e9),
  });

  // 3. No skylight beam — the observatory is a sealed chamber.
  //    Atmosphere comes from a starlight overlay painted across the
  //    whole room (drawObservatoryStars in render.js) and the four
  //    corner obelisks acting as light emitters. This keeps the look
  //    fully top-down and consistent with the rest of the game.

  // 4. Four corner obelisks: 1×1 solid props at the interior corners.
  //    They are the sole light source of the room — a cool blue magical
  //    glow that bathes the floor and casts the constellation ring in
  //    soft starlight.
  const corners = [
    { x: room.x,                 y: room.y },
    { x: room.x + room.w - 1,    y: room.y },
    { x: room.x,                 y: room.y + room.h - 1 },
    { x: room.x + room.w - 1,    y: room.y + room.h - 1 },
  ];
  for (const c of corners) {
    if (!map[c.y] || map[c.y][c.x] !== T_FLOOR) continue;
    if (isNearDoor(map, c.x, c.y, room)) continue;
    map[c.y][c.x] = T_WALL;
    libraryProps.push({
      kind: 'starObelisk',
      tx: c.x, ty: c.y, w: 1, h: 1,
      seed: Math.floor(rng() * 1e9),
    });
    if (lights) {
      // Cool blue-white magical light — wider radius and brighter than
      // a regular candle since these are the only source in the room.
      lights.push({
        type:    'starObelisk',
        x:       c.x * TILE + TILE / 2,
        y:       c.y * TILE + TILE / 2,
        r:       190,
        color:   [180, 210, 255],
        flicker: rng() * Math.PI * 2,
        phase:   rng() * Math.PI * 2,
      });
    }
  }

  // 5. Bookstands (single-tile shelves) along the inner perimeter with
  //    a 5-tile gap centred on the telescope so the constellation is
  //    visible from every approach.
  const GAP = 2;
  const tryShelf = (xx, yy, orient, face) => {
    if (!map[yy] || map[yy][xx] !== T_FLOOR) return false;
    if (isNearDoor(map, xx, yy, room)) return false;
    map[yy][xx] = T_WALL;
    libraryProps.push({
      kind: 'shelf',
      tx: xx, ty: yy, w: 1, h: 1,
      orient, face,
      seed: Math.floor(rng() * 1e9),
    });
    return true;
  };
  for (let xx = room.x + 1; xx <= room.x + room.w - 2; xx++) {
    if (Math.abs(xx - cx) <= GAP) continue;
    tryShelf(xx, room.y,             'h', 'S');
    tryShelf(xx, room.y + room.h - 1, 'h', 'N');
  }
  for (let yy = room.y + 1; yy <= room.y + room.h - 2; yy++) {
    if (Math.abs(yy - cy) <= GAP) continue;
    tryShelf(room.x,             yy, 'v', 'E');
    tryShelf(room.x + room.w - 1, yy, 'v', 'W');
  }
}

/**
 * Library biome: "Sala de la Llave". Mid-sized arena room (9×8). Empty
 * by design — its only prop is a small rune dais painted on the floor
 * at the centre. When the player enters, every entrance is sealed and a
 * wave of bonus enemies spawns. Killing them all drops a rune key
 * pickup. Logic lives in keyRoom.js; here we just paint the room and
 * register the dais as a walkable decorative prop.
 *
 * @private
 */
function placeKeyRoom(room, map, rng, libraryProps, lights) {
  if (!room) return;
  room.isKeyRoom = true;

  // Pick a puzzle variant for this floor unless a debug flag already
  // fixed it. 33% each between kill, rune and candle.
  if (!room.keyVariant) {
    const roll = rng();
    room.keyVariant = roll < 0.33 ? 'rune' : roll < 0.66 ? 'kill' : 'candle';
  }
  const variant = room.keyVariant;

  // Wipe any prop that might have been laid down inside the footprint
  // (shelves/tables already skip via isKeyRoom, but magic flames or
  // rune marks could still land here). We want a clean arena.
  for (let i = libraryProps.length - 1; i >= 0; i--) {
    const p = libraryProps[i];
    if (p.tx + p.w <= room.x || p.tx >= room.x + room.w) continue;
    if (p.ty + p.h <= room.y || p.ty >= room.y + room.h) continue;
    for (let yy = p.ty; yy < p.ty + p.h; yy++) {
      for (let xx = p.tx; xx < p.tx + p.w; xx++) {
        if (map[yy] && map[yy][xx] === T_WALL) map[yy][xx] = T_FLOOR;
      }
    }
    libraryProps.splice(i, 1);
  }

  // Central rune dais (3×3, walkable). Pure visual marker that signals
  // "this is the arena". Drawn in render.js.
  libraryProps.push({
    kind: 'keyDais',
    tx:   room.cx - 1,
    ty:   room.cy - 1,
    w:    3, h: 3,
    seed: Math.floor(rng() * 1e9),
  });

  // Rune-pair puzzle: place 4 pedestals around the dais arranged as 2
  // matching pairs (runeId 0 × 2, runeId 1 × 2). Positions are pulled
  // toward the room corners but kept inside the walkable area so the
  // player can circle every pedestal freely. The live state lives in
  // keyRoom.js; here we just stash the layout on the room.
  if (variant === 'rune') {
    const slots = [
      { tx: room.cx - 3, ty: room.cy - 2 },
      { tx: room.cx + 3, ty: room.cy - 2 },
      { tx: room.cx - 3, ty: room.cy + 2 },
      { tx: room.cx + 3, ty: room.cy + 2 },
    ];
    const ids = [0, 0, 1, 1];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    room.keyPedestals = slots.map((s, i) => ({
      tx: s.tx, ty: s.ty, runeId: ids[i],
    }));
  }

  // Candle puzzle: place 5 candles around the perimeter. The player
  // must light them in the correct sequence by pressing E. The order
  // is a random permutation of [0..4].
  if (variant === 'candle') {
    const slots = [
      { tx: room.cx,     ty: room.cy - 3 },
      { tx: room.cx + 2, ty: room.cy - 2 },
      { tx: room.cx + 2, ty: room.cy + 2 },
      { tx: room.cx - 2, ty: room.cy + 2 },
      { tx: room.cx - 2, ty: room.cy - 2 },
    ];
    const seq = [0, 1, 2, 3, 4];
    for (let i = seq.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [seq[i], seq[j]] = [seq[j], seq[i]];
    }
    room.keyCandles = slots.map((s, i) => ({
      tx: s.tx, ty: s.ty, index: i,
    }));
    room.keyCandleSeq = seq;
  }

  // Flanking magic lights. Colour swaps with the variant so the room
  // reads at a glance: cool blue for the arena, warm purple-ish for
  // the puzzle. Candle variant skips these — the puzzle candles
  // themselves provide the visual beacon.
  if (lights && variant !== 'candle') {
    const tint = variant === 'rune' ? [180, 140, 255]
      : variant === 'candle' ? [255, 200, 100]
      : [120, 180, 255];
    const offs = [{ dx: -3, dy: 0 }, { dx: 3, dy: 0 }];
    for (const o of offs) {
      const lx = (room.cx + o.dx) * TILE + TILE / 2;
      const ly = (room.cy + o.dy) * TILE + TILE / 2;
      lights.push({
        type:    'magicFlame',
        ax: lx,  ay: ly,
        bx: lx,  by: ly,
        x:  lx,  y:  ly,
        phase:   rng() * Math.PI * 2,
        speed:   0.20 + rng() * 0.20,
        wobble:  rng() * Math.PI * 2,
        color:   tint,
        r:       110,
        flicker: rng() * Math.PI * 2,
      });
    }
  }

  // Ambient decorations: book piles at inner corners (all variants) and
  // braziers at NW/SE corners (rune/kill only). Adds a lived-in feel.
  const corners = [
    { tx: room.x + 1,                ty: room.y + 1 },
    { tx: room.x + room.w - 2,       ty: room.y + room.h - 2 },
  ];
  for (const c of corners) {
    if (map[c.ty] && map[c.ty][c.tx] === T_FLOOR) {
      libraryProps.push({
        kind: 'tomeBookPile',
        tx: c.tx, ty: c.ty, w: 1, h: 1,
        seed: Math.floor(rng() * 1e9),
      });
    }
  }

  if (variant !== 'candle') {
    // Two braziers at NW and SE interior corners.
    const brazierPos = [
      { tx: room.x + 1,                ty: room.y + room.h - 3 },
      { tx: room.x + room.w - 2,       ty: room.y + 1 },
    ];
    for (const bp of brazierPos) {
      if (!map[bp.ty] || map[bp.ty][bp.tx] !== T_FLOOR) continue;
      if (isNearDoor(map, bp.tx, bp.ty, room)) continue;
      map[bp.ty][bp.tx] = T_WALL;
      libraryProps.push({
        kind: 'tomeBrazier',
        tx: bp.tx, ty: bp.ty, w: 1, h: 1,
        seed: Math.floor(rng() * 1e9),
      });
      lights.push({
        type:    'magicFlame',
        ax: bp.tx * TILE + TILE / 2,
        ay: bp.ty * TILE + 6,
        bx: bp.tx * TILE + TILE / 2,
        by: bp.ty * TILE + 6,
        x:  bp.tx * TILE + TILE / 2,
        y:  bp.ty * TILE + 6,
        phase:   rng() * Math.PI * 2,
        speed:   0.25 + rng() * 0.15,
        wobble:  rng() * Math.PI * 2,
        color:   variant === 'rune' ? [180, 140, 255] : [120, 180, 255],
        r:       70,
        flicker: rng() * Math.PI * 2,
      });
    }
  }

  // Rune marks near the flanking lights (rune/kill variants).
  if (variant !== 'candle') {
    const markPos = [
      { tx: room.cx - 2, ty: room.cy },
      { tx: room.cx + 2, ty: room.cy },
    ];
    for (const mp of markPos) {
      if (!map[mp.ty] || map[mp.ty][mp.tx] !== T_FLOOR) continue;
      if (libraryProps.some(p => p.tx === mp.tx && p.ty === mp.ty)) continue;
      libraryProps.push({
        kind: 'libraryRuneMark',
        tx: mp.tx, ty: mp.ty, w: 1, h: 1,
        seed: Math.floor(rng() * 1e9),
      });
    }
  }
}

/**
 * Library biome: "Archivo Prohibido". Small (7×6) sealed vault. The
 * room contains a single legendary chest at its centre and is barred
 * from the rest of the dungeon by a single rune-locked door tile placed
 * on a corridor connection. The player must clear the Sala de la Llave
 * to obtain the rune key that opens this door.
 *
 * The locked door is placed AFTER corridors are carved, so the flow is:
 *   • room footprint already painted as floor (reservation step)
 *   • corridors carved by buildConnections
 *   • this placer scans the room perimeter for entrance tiles, picks
 *     one, converts it to T_DOOR_LOCKED and stores its coordinates on
  *     `room.doorTiles` for the gameplay layer to consume.
 *
 * The legendary chest is registered as a libraryProp marker; the
 * `populateFloor` step in enemies.js reads it and pushes the actual
 * loot.chest entity (so loot lifecycle stays in one place).
 *
 * @private
 */
function placeForbiddenArchive(room, map, rng, libraryProps, lights, startRoom, archiveMistSpawners, decorations) {
  if (!room) return;
  room.isForbiddenArchive = true;

  // Wipe any stray props inside.
  for (let i = libraryProps.length - 1; i >= 0; i--) {
    const p = libraryProps[i];
    if (p.tx + p.w <= room.x || p.tx >= room.x + room.w) continue;
    if (p.ty + p.h <= room.y || p.ty >= room.y + room.h) continue;
    for (let yy = p.ty; yy < p.ty + p.h; yy++) {
      for (let xx = p.tx; xx < p.tx + p.w; xx++) {
        if (map[yy] && map[yy][xx] === T_WALL) map[yy][xx] = T_FLOOR;
      }
    }
    libraryProps.splice(i, 1);
  }

  // Find every entrance tile (floor tile just outside the room border).
  // The corridor carver may have created several; lock the first.
  const entrances = [];
  const x0 = room.x - 1, x1 = room.x + room.w;
  const y0 = room.y - 1, y1 = room.y + room.h;
  for (let x = room.x; x < room.x + room.w; x++) {
    if (map[y0] && map[y0][x] === T_FLOOR) entrances.push({ tx: x, ty: y0 });
    if (map[y1] && map[y1][x] === T_FLOOR) entrances.push({ tx: x, ty: y1 });
  }
  for (let y = room.y; y < room.y + room.h; y++) {
    if (map[y] && map[y][x0] === T_FLOOR) entrances.push({ tx: x0, ty: y });
    if (map[y] && map[y][x1] === T_FLOOR) entrances.push({ tx: x1, ty: y });
  }

  // Convert EVERY entrance into a rune-locked door. This way rooms
  // adjacent to the archive stay accessible (they exit via the archive's
  // perimeter which is now a door), and the player only needs to reach
  // ANY one of them with the key to unlock the entire archive.
  room.doorTiles = [];
  for (const e of entrances) {
    map[e.ty][e.tx] = T_DOOR_LOCKED;
    room.doorTiles.push(e);
  }

  // Decorative perimeter shelves: the archive looks like an old vault.
  // Keep only the back wall (top) shelves — the rest stay bare for an
  // oppressive feel.
  for (let xx = room.x + 1; xx <= room.x + room.w - 2; xx++) {
    const ty = room.y;  // back wall only
    if (!map[ty] || map[ty][xx] !== T_FLOOR) continue;
    if (isNearDoor(map, xx, ty, room)) continue;
    if (rng() < 0.45) continue;
    map[ty][xx] = T_WALL;
    libraryProps.push({
      kind: 'archiveShelf',
      tx: xx, ty, w: 1, h: 1,
      orient: 'h',
      face:   'S',
      seed:   Math.floor(rng() * 1e9),
    });
  }

  // Central pedestal-with-chest marker. The actual loot.chest entity is
  // spawned by populateFloor (enemies.js) so chest lifecycle stays in
  // one place. The marker exists so the renderer can paint a stone
  // pedestal underneath the chest.
  libraryProps.push({
    kind: 'archivePedestal',
    tx:   room.cx,
    ty:   room.cy,
    w:    1, h: 1,
    seed: Math.floor(rng() * 1e9),
  });

  // Darken the entire archive floor so it reads as a forbidden vault.
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (map[y][x] === T_FLOOR) map[y][x] = T_FLOOR;
    }
  }

  // A single dim blood-red light at the centre — oppressive, not cosy.
  // No flanking flames; the red glow is enough to see the chest by.
  if (lights) {
    const cx = room.cx * TILE + TILE / 2;
    const cy = room.cy * TILE + TILE / 2;
    lights.push({
      type:    'magicFlame',
      ax: cx,  ay: cy,
      bx: cx,  by: cy,
      x:  cx,  y:  cy,
      phase:   0,
      speed:   0.08,
      wobble:  0,
      color:   [180, 20, 30],
      r:       55,
      flicker: 0,
    });
  }

  // Dark mist spawner — particles slowly rise from the pedestal.
  archiveMistSpawners.push({
    x: (room.cx + 0.5) * TILE,
    y: (room.cy + 0.5) * TILE,
    timer: 0,
  });

  // Floor rune marks left and right of the pedestal, adding visual
  // interest to the dark floor.
  for (const off of [{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }]) {
    const tx = room.cx + off.dx, ty = room.cy + off.dy;
    if (map[ty] && map[ty][tx] === T_FLOOR) {
      libraryProps.push({
        kind: 'libraryRuneMark',
        tx, ty, w: 1, h: 1,
        seed: Math.floor(rng() * 1e9),
      });
    }
  }

  // A couple of dark wall decorations on the side walls to break up
  // the bare walls — rune symbols and a dark portrait.
  if (decorations) {
    for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
      for (const x of [room.x - 1, room.x + room.w]) {
        if (x < 0 || x >= MAP_W) continue;
        if (map[y] && map[y][x] === T_WALL && rng() < 0.3) {
          decorations.push({
            kind:  rng() < 0.5 ? 'runeSymbol' : 'darkPortrait',
            tx: x, ty: y,
            seed:  Math.floor(rng() * 1e9),
          });
        }
      }
    }
  }
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
  const t = map[ty][tx];
  return t === T_WALL || t === T_DOOR_LOCKED;
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
/**
 * Ruins biome: Alpha Wolf Lair. A star room sealed on entry, hosting the
 * Alpha Wolf mini-boss and his pack. Clearing it drops a legendary chest.
 *
 * Layout (applied to an expanded star room):
 *   • 3×3 dark floor dais at centre (walkable)
 *   • 4 broken pillars at inner corners (solid cover)
 *   • 2 campfire braziers at mid-left / mid-right
 *   • Fixed spawn positions for Alpha + 3 wolves on the room object
 * @private
 */
function placeClaroSolar(room, map, rng, sunbeams, props) {
  if (!room) return;
  room.isClaroSolar = true;

  const cx = room.cx, cy = room.cy;
  const rx = room.x, ry = room.y, rw = room.w, rh = room.h;

  // Giant sunbeam covering ~80 % of the room
  const lengthRatio = 0.75 + rng() * 0.15;
  const length = Math.max(4, Math.floor(rw * lengthRatio)) * TILE;
  const slack = (rw * TILE - length) * 0.5;
  const startX = rx * TILE + slack + (rng() - 0.5) * slack * 0.6;
  const h = rh * TILE;
  const sb = {
    kind: 'shrine',
    x: startX + length / 2,
    y: ry * TILE,
    h,
    length,
    splay: TILE * (0.8 + rng() * 0.6),
    seed: Math.floor(rng() * 1e9),
    wallRow: ry - 1,
  };
  sb.shape = buildBeamShape(sb, rng);
  sb.crack = buildCrackPath(sb, rng);
  sunbeams.push(sb);

  // Large tree at the center of the room — trunk blocks movement
  if (props) {
    const trunkTx = cx, trunkTy = cy;
    if (map[trunkTy] && map[trunkTy][trunkTx] === T_FLOOR) {
      map[trunkTy][trunkTx] = T_WALL;
    }
    props.push({
      kind: 'tree',
      tx: cx - 2, ty: cy - 2, w: 5, h: 5,
      seed: Math.floor(rng() * 1e9),
    });
  }
}

function placeAlphaLair(room, map, rng, lights, props) {
  if (!room) return;
  room.isAlphaLair = true;

  const cx = room.cx, cy = room.cy;
  const rx = room.x, ry = room.y, rw = room.w, rh = room.h;
  const seed = Math.floor(rng() * 1e9);

  // 1. Four rubble piles at room corners (solid, marks arena boundary)
  const rubblePos = [
    { tx: rx + 1,          ty: ry + 1 },
    { tx: rx + rw - 2, ty: ry + 1 },
    { tx: rx + 1,          ty: ry + rh - 2 },
    { tx: rx + rw - 2, ty: ry + rh - 2 },
  ];
  for (const rp of rubblePos) {
    if (map[rp.ty] && map[rp.ty][rp.tx] === T_FLOOR) {
      map[rp.ty][rp.tx] = T_WALL;
    }
  }

  // 3. Four broken pillars at mid-wall positions (gameplay cover)
  const pillarPos = [
    { tx: rx + 2,      ty: cy },
    { tx: rx + rw - 3, ty: cy },
    { tx: cx,          ty: ry + 2 },
    { tx: cx,          ty: ry + rh - 3 },
  ];
  for (const p of pillarPos) {
    if (map[p.ty] && map[p.ty][p.tx] === T_FLOOR &&
        !isNearDoor(map, p.tx, p.ty, room)) {
      map[p.ty][p.tx] = T_WALL;
    }
  }

  // 4. Two campfire braziers at mid-left / mid-right
  const brazierPos = [
    { tx: rx + 1, ty: cy },
    { tx: rx + rw - 2, ty: cy },
  ];
  for (const bp of brazierPos) {
    if (map[bp.ty] && map[bp.ty][bp.tx] === T_FLOOR &&
        !isNearDoor(map, bp.tx, bp.ty, room)) {
      lights.push({
        type: 'campfire',
        x: bp.tx * TILE + TILE / 2,
        y: bp.ty * TILE + TILE / 2,
        r: 150 + rng() * 20,
        flicker: rng() * Math.PI * 2,
      });
    }
  }

  // 5. Floor decorations — lair atmosphere (guard-room vestiges)
  //    All are purely visual, drawn via libraryProps.

  // 5a. Alpha's large straw bed at centre (3×1)
  if (props) {
    props.push({
      kind: 'strawBed',
      tx: cx - 1, ty: cy, w: 3, h: 1,
      seed: seed + 1, large: true,
    });

    // 5b. Smaller scattered straw beds (sleeping spots for the pack)
    const smallBeds = [
      { tx: cx - 3, ty: cy + 2, w: 2, h: 1 },
      { tx: cx + 2, ty: cy - 3, w: 2, h: 1 },
      { tx: cx - 4, ty: cy - 2, w: 2, h: 1 },
      { tx: cx + 3, ty: cy + 2, w: 2, h: 1 },
    ];
    for (let i = 0; i < smallBeds.length; i++) {
      const b = smallBeds[i];
      if (map[b.ty] && map[b.ty][b.tx] === T_FLOOR) {
        props.push({
          kind: 'strawBed',
          tx: b.tx, ty: b.ty, w: b.w, h: b.h,
          seed: seed + 10 + i, large: false,
        });
      }
    }

    // 5c. Claw marks on the open floor
    const clawPos = [
      { tx: cx - 1, ty: cy - 1 },
      { tx: cx + 1, ty: cy + 1 },
      { tx: cx - 3, ty: cy },
      { tx: cx + 3, ty: cy + 1 },
      { tx: cx - 2, ty: cy - 2 },
    ];
    for (let i = 0; i < clawPos.length; i++) {
      const c = clawPos[i];
      if (map[c.ty] && map[c.ty][c.tx] === T_FLOOR) {
        props.push({
          kind: 'clawMark',
          tx: c.tx, ty: c.ty, w: 1, h: 1,
          seed: seed + 20 + i,
        });
      }
    }

    // 5d. Scattered armour pieces (guard-room remnants)
    const armorPos = [
      { tx: rx + 3, ty: ry + 1 },
      { tx: rx + rw - 4, ty: ry + rh - 2 },
      { tx: cx + 2, ty: ry + 1 },
    ];
    for (let i = 0; i < armorPos.length; i++) {
      const a = armorPos[i];
      if (map[a.ty] && map[a.ty][a.tx] === T_FLOOR) {
        props.push({
          kind: 'armor',
          tx: a.tx, ty: a.ty, w: 2, h: 1,
          seed: seed + 30 + i,
        });
      }
    }

    // 5e. Animal bones scattered
    const bonePos = [
      { tx: cx - 2, ty: cy + 1 },
      { tx: cx + 1, ty: cy + 2 },
      { tx: rx + 4, ty: cy - 1 },
      { tx: cx - 1, ty: ry + 2 },
    ];
    for (let i = 0; i < bonePos.length; i++) {
      const b = bonePos[i];
      if (map[b.ty] && map[b.ty][b.tx] === T_FLOOR) {
        props.push({
          kind: 'bones',
          tx: b.tx, ty: b.ty, w: 1, h: 1,
          seed: seed + 40 + i,
        });
      }
    }
  }

  // 6. Spawn positions validated against final map (avoid pillars/rubble)
  room.alphaLairSpawns = [];
  const desiredSpawns = [
    { type: 'alphaWolf', tx: cx,     ty: cy },
    { type: 'wolf',      tx: cx - 2, ty: cy },
    { type: 'wolf',      tx: cx + 2, ty: cy },
    { type: 'wolf',      tx: cx,     ty: cy - 2 },
  ];
  for (const s of desiredSpawns) {
    if (map[s.ty] && map[s.ty][s.tx] === T_FLOOR) {
      room.alphaLairSpawns.push(s);
      continue;
    }
    // Fallback: nearest free floor inside room
    let placed = false;
    for (let dx = -3; !placed && dx <= 3; dx++) {
      for (let dy = -3; !placed && dy <= 3; dy++) {
        const nx = s.tx + dx, ny = s.ty + dy;
        if (nx < room.x || nx >= room.x + room.w) continue;
        if (ny < room.y || ny >= room.y + room.h) continue;
        if (map[ny] && map[ny][nx] === T_FLOOR) {
          room.alphaLairSpawns.push({ type: s.type, tx: nx, ty: ny });
          placed = true;
        }
      }
    }
  }
}

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
