import { TILE, MAP_W, MAP_H, T_WALL, T_FLOOR } from '../config.js';

export function placeSkullPedestals(map, rooms, rng, lights) {
  const GLOBAL_CAP = 10;
  let placed = 0;
  for (const r of rooms) {
    if (placed >= GLOBAL_CAP) break;
    if (r.w < 4 || r.h < 4) continue;
    if (r.isStartRoom || r.isStairsRoom) continue;
    if (!r.isLarge && rng() > 0.50) continue;
    const count = r.isLarge ? (2 + Math.floor(rng() * 2)) : 1;
    for (let i = 0; i < count && placed < GLOBAL_CAP; i++) {
      const wallSide = Math.floor(rng() * 4);
      let tx, ty;
      if (wallSide === 0)      { tx = r.x + 1 + Math.floor(rng() * (r.w - 2)); ty = r.y + 1; }
      else if (wallSide === 1) { tx = r.x + r.w - 2; ty = r.y + 1 + Math.floor(rng() * (r.h - 2)); }
      else if (wallSide === 2) { tx = r.x + 1 + Math.floor(rng() * (r.w - 2)); ty = r.y + r.h - 2; }
      else                     { tx = r.x + 1; ty = r.y + 1 + Math.floor(rng() * (r.h - 2)); }
      if (map[ty][tx] !== T_FLOOR) continue;
      lights.push({ type: 'skull', x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, r: 55 + rng() * 15, phase: rng() * Math.PI * 2 });
      placed++;
    }
  }
}

export function placeLoculi(map, rooms, rng, decorations) {
  const PER_TILE_CHANCE = 0.05;
  const PER_FLOOR_CAP = 28;
  let placed = 0;
  const inAnyRoom = (tx, ty) => {
    for (const r of rooms) {
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return true;
    }
    return false;
  };
  for (let y = 1; y < MAP_H - 1 && placed < PER_FLOOR_CAP; y++) {
    for (let x = 1; x < MAP_W - 1 && placed < PER_FLOOR_CAP; x++) {
      if (map[y][x] !== T_WALL) continue;
      if (map[y + 1] && map[y + 1][x] === T_FLOOR && !inAnyRoom(x, y + 1)) {
        if (rng() < PER_TILE_CHANCE) {
          decorations.push({ kind: 'loculus', tx: x, ty: y, seed: Math.floor(rng() * 1e9) });
          placed++;
        }
      }
    }
  }
}

export function placeWebs(rooms, rng, decorations) {
  for (const r of rooms) {
    if (r.w < 4 || r.h < 4) continue;
    if (r.isStartRoom) continue;
    const corners = [
      { tx: r.x + 1, ty: r.y + 1, q: 0 },
      { tx: r.x + r.w - 2, ty: r.y + 1, q: 1 },
      { tx: r.x + 1, ty: r.y + r.h - 2, q: 2 },
      { tx: r.x + r.w - 2, ty: r.y + r.h - 2, q: 3 },
    ];
    for (const c of corners) {
      if (rng() < 0.45) decorations.push({ kind: 'web', tx: c.tx, ty: c.ty, q: c.q });
    }
  }
}

export function placeSoulSpawners(rooms, rng, soulSpawners, sarcophagi) {
  for (const s of (sarcophagi || [])) {
    if (s.variant === 'cracked' || s.variant === 'altar') {
      soulSpawners.push({ x: s.tx * TILE + (s.w * TILE) / 2, y: s.ty * TILE + (s.h * TILE) / 2, timer: rng() * 2.5 });
    }
  }
  const target = 5 + Math.floor(rng() * 4);
  const candidates = rooms.filter(r => !r.isStartRoom && !r.isStairsRoom);
  let safety = 40;
  while (soulSpawners.length < target && candidates.length && safety-- > 0) {
    const r = candidates[Math.floor(rng() * candidates.length)];
    const ox = r.x + 1 + Math.floor(rng() * Math.max(1, r.w - 2));
    const oy = r.y + 1 + Math.floor(rng() * Math.max(1, r.h - 2));
    soulSpawners.push({ x: ox * TILE + TILE / 2, y: oy * TILE + TILE / 2, timer: rng() * 2.5 });
  }
}

export function placeSarcophagi(rooms, map, rng, sarcophagi, lights) {
  for (const r of rooms) {
    if (r.isStartRoom || r.isStairsRoom) continue;
    if (r.w < 4 || r.h < 4) continue;
    if (r.isLarge) {
      placeAltar(r, map, sarcophagi, lights);
      placeCryptaSarcophagi(r, map, rng, sarcophagi);
    } else {
      if (rng() > 0.35) continue;
      tryPlaceSarcophagus(r, map, rng, sarcophagi, 'normal');
    }
  }
}

function placeAltar(r, map, sarcophagi, lights) {
  const tx = r.cx - 1;
  const ty = r.cy - 1;
  for (let y = ty; y < ty + 2; y++) {
    for (let x = tx; x < tx + 2; x++) {
      if (map[y] === undefined || map[y][x] !== T_FLOOR) return;
    }
  }
  for (let y = ty; y < ty + 2; y++) {
    for (let x = tx; x < tx + 2; x++) map[y][x] = T_WALL;
  }
  sarcophagi.push({ tx, ty, w: 2, h: 2, variant: 'altar', awakable: false, awakened: false });
  if (lights) {
    lights.push({ type: 'altar', x: (tx + 1) * TILE, y: (ty + 1) * TILE, r: 140, seed: Math.floor(Math.random() * 1000) });
  }
}

function placeCryptaSarcophagi(r, map, rng, sarcophagi) {
  const target = 2 + Math.floor(rng() * 2);
  let placed = 0, safety = 40;
  while (placed < target && safety-- > 0) {
    if (tryPlaceSarcophagus(r, map, rng, sarcophagi, 'cracked', true)) placed++;
  }
}

function tryPlaceSarcophagus(r, map, rng, sarcophagi, variant, nearWall = false) {
  const horizontal = rng() < 0.5;
  const w = horizontal ? 2 : 1;
  const h = horizontal ? 1 : 2;
  const minX = r.x + 1, maxX = r.x + r.w - 1 - w;
  const minY = r.y + 1, maxY = r.y + r.h - 1 - h;
  if (maxX < minX || maxY < minY) return false;
  for (let attempt = 0; attempt < 12; attempt++) {
    let tx, ty;
    if (nearWall) {
      const side = Math.floor(rng() * 4);
      if (side === 0)      { tx = minX + Math.floor(rng() * (maxX - minX + 1)); ty = minY; }
      else if (side === 1) { tx = maxX; ty = minY + Math.floor(rng() * (maxY - minY + 1)); }
      else if (side === 2) { tx = minX + Math.floor(rng() * (maxX - minX + 1)); ty = maxY; }
      else                 { tx = minX; ty = minY + Math.floor(rng() * (maxY - minY + 1)); }
    } else {
      tx = minX + Math.floor(rng() * (maxX - minX + 1));
      ty = minY + Math.floor(rng() * (maxY - minY + 1));
    }
    let blocksCentre = false;
    for (let yy = ty; yy < ty + h; yy++) {
      for (let xx = tx; xx < tx + w; xx++) {
        if (Math.abs(xx - r.cx) <= 0 && Math.abs(yy - r.cy) <= 0) blocksCentre = true;
      }
    }
    if (blocksCentre) continue;
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
    sarcophagi.push({ tx, ty, w, h, variant, awakable: variant === 'cracked', awakened: false, orient: horizontal ? 'h' : 'v' });
    return true;
  }
  return false;
}
