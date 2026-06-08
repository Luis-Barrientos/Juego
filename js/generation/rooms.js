import { TILE, MAP_W, MAP_H, T_WALL, T_FLOOR } from '../config.js';

export function placeFloorTorches(r, rng, lights, density) {
  const corners = [
    { x: r.x + 1, y: r.y + 1 },
    { x: r.x + r.w - 2, y: r.y + 1 },
    { x: r.x + 1, y: r.y + r.h - 2 },
    { x: r.x + r.w - 2, y: r.y + r.h - 2 },
  ];
  const target = Math.round(density + r.w * r.h / 25);
  const n = Math.max(1, Math.min(corners.length, target));
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let idx;
    do { idx = Math.floor(rng() * corners.length); } while (used.has(idx) && used.size < corners.length);
    used.add(idx);
    const c = corners[idx];
    lights.push({ type: 'torch', x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2, r: 110 + rng() * 30, flicker: rng() * Math.PI * 2 });
  }
}

export function placeWallSconces(map, r, rng, lights, density) {
  const candidates = [];
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    if (r.x - 1 >= 0 && map[y][r.x - 1] === T_WALL) {
      candidates.push({ tx: r.x, ty: y, dir: 'right', edge: r.x * TILE + 2 });
    }
  }
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
  const perimeter = (r.w + r.h) * 2;
  const target = Math.max(2, Math.round(density + perimeter / 6));
  const n = Math.min(target, candidates.length);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (let i = 0; i < n; i++) {
    const c = candidates[i];
    lights.push({ type: 'sconce', dir: c.dir, x: c.edge, y: c.ty * TILE + TILE / 2, r: 120 + rng() * 30, flicker: rng() * Math.PI * 2 });
  }
}

export function placeWallCandles(map, r, rng, lights, density) {
  const candidates = [];
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    if (r.x - 1 >= 0 && map[y][r.x - 1] === T_WALL) {
      candidates.push({ tx: r.x, ty: y, dir: 'right', edge: r.x * TILE + 2 });
    }
  }
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
  const perimeter = (r.w + r.h) * 2;
  const target = Math.max(2, Math.round(density + perimeter / 4));
  const n = Math.min(target, candidates.length);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (let i = 0; i < n; i++) {
    const c = candidates[i];
    lights.push({ type: 'candle', dir: c.dir, x: c.edge, y: c.ty * TILE + TILE / 2, r: 85 + rng() * 20, flicker: rng() * Math.PI * 2 });
  }
}

export function placeRoomWallDecorations(map, rooms, rng, decorations, lights, kinds) {
  const PER_TILE_CHANCE = 0.18;
  const PER_ROOM_CAP = 2;
  const tileTaken = (tx, ty) => {
    if (decorations.some(d => d.tx === tx && d.ty === ty)) return true;
    if (lights && lights.some(l => Math.floor(l.x / TILE) === tx && Math.floor(l.y / TILE) === ty)) return true;
    return false;
  };
  for (const r of rooms) {
    if (r.isStartRoom) continue;
    if (r.isKeyRoom) continue;
    if (r.isForbiddenArchive) continue;
    if (r.w < 4 || r.h < 3) continue;
    const y = r.y - 1;
    if (y < 1) continue;
    let placedHere = 0;
    for (let x = r.x + 1; x < r.x + r.w - 1 && placedHere < PER_ROOM_CAP; x++) {
      if (!map[y] || map[y][x] !== T_WALL) continue;
      if (!map[y + 1] || map[y + 1][x] !== T_FLOOR) continue;
      if (tileTaken(x, y)) continue;
      if (rng() < PER_TILE_CHANCE) {
        const kind = kinds[Math.floor(rng() * kinds.length)];
        decorations.push({ kind, tx: x, ty: y, face: 'S', seed: Math.floor(rng() * 1e9) });
        placedHere++;
      }
    }
  }
}

export function placePillars(rooms, map, rng) {
  for (const r of rooms) {
    if (r.w * r.h < 60) continue;
    if (r.isStartRoom) continue;
    const target = r.isLarge ? (3 + Math.floor(rng() * 3)) : (1 + Math.floor(rng() * 2));
    let placed = 0, safety = 30;
    while (placed < target && safety-- > 0) {
      const tx = r.x + 2 + Math.floor(rng() * (r.w - 4));
      const ty = r.y + 2 + Math.floor(rng() * (r.h - 4));
      if (Math.abs(tx - r.cx) <= 1 && Math.abs(ty - r.cy) <= 1) continue;
      if (map[ty][tx] !== T_FLOOR) continue;
      let touching = false;
      for (let dy = -1; dy <= 1 && !touching; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
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
