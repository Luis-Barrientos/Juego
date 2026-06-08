import { TILE, MAP_W, MAP_H, T_FLOOR, T_WALL } from '../config.js';
import { buildBeamShape, buildCrackPath } from './beams.js';

export function placeSunbeams(rooms, rng, sunbeams) {
  const HARD_CAP = 2;
  const eligible = rooms.filter(r => r.isLarge);
  const PER_ROOM_CHANCE = 0.85;
  for (const r of eligible) {
    if (sunbeams.length >= HARD_CAP) break;
    if (rng() > PER_ROOM_CHANCE) continue;
    const lengthRatio = 0.60 + rng() * 0.30;
    const length = Math.max(4, Math.floor(r.w * lengthRatio)) * TILE;
    const slack = (r.w * TILE - length) * 0.5;
    const startX = r.x * TILE + slack + (rng() - 0.5) * slack * 0.6;
    const h = r.h * TILE;
    const sb = { x: startX + length / 2, y: r.y * TILE, h, length, splay: TILE * (0.8 + rng() * 0.6), seed: Math.floor(rng() * 1e9), wallRow: r.y - 1 };
    sb.shape = buildBeamShape(sb, rng);
    sb.crack = buildCrackPath(sb, rng);
    sunbeams.push(sb);
  }
}

export function placeMoonbeams(rooms, rng, beams) {
  const HARD_CAP = 4;
  const eligible = rooms.filter(r => !r.isLarge && r.w >= 5 && r.h >= 4);
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  let placed = 0;
  for (const r of eligible) {
    if (placed >= HARD_CAP) break;
    if (rng() > 0.30) continue;
    const length = 8 + Math.floor(rng() * 7);
    const ox = (rng() - 0.5) * (r.w - 2) * TILE * 0.6;
    const sb = { kind: 'thin', x: (r.x + r.w / 2) * TILE + ox, y: r.y * TILE, h: r.h * TILE, length, splay: 6 + rng() * 6, seed: Math.floor(rng() * 1e9), wallRow: r.y - 1 };
    sb.shape = buildBeamShape(sb, rng);
    sb.crack = buildCrackPath(sb, rng);
    beams.push(sb);
    placed++;
  }
}

export function placeCampfires(rooms, rng, lights) {
  const HARD_CAP = 2;
  const eligible = rooms.filter(r => !r.isLarge && !r.isStairsRoom && !r.isStartRoom && r.w >= 5 && r.h >= 5);
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  const target = Math.min(HARD_CAP, eligible.length, 1 + Math.floor(rng() * 2));
  for (let i = 0; i < target; i++) {
    const r = eligible[i];
    const ox = (rng() - 0.5) * Math.min(r.w - 4, 4);
    const oy = (rng() - 0.5) * Math.min(r.h - 4, 3);
    lights.push({ type: 'campfire', x: (r.x + r.w / 2 + ox) * TILE, y: (r.y + r.h / 2 + oy) * TILE, r: 170 + rng() * 30, flicker: rng() * Math.PI * 2 });
  }
}

export function placeGlowMushrooms(map, rooms, rng, lights) {
  const GLOBAL_CAP = 14;
  let placed = 0;
  for (const r of rooms) {
    if (placed >= GLOBAL_CAP) break;
    if (r.w < 5 || r.h < 4) continue;
    if (rng() > 0.65) continue;
    const clusterCount = 1 + Math.floor(rng() * 2);
    for (let c = 0; c < clusterCount && placed < GLOBAL_CAP; c++) {
      const wallSide = Math.floor(rng() * 4);
      let ax, ay;
      if (wallSide === 0)      { ax = r.x + 1 + Math.floor(rng() * (r.w - 2)); ay = r.y; }
      else if (wallSide === 1) { ax = r.x + r.w - 1; ay = r.y + 1 + Math.floor(rng() * (r.h - 2)); }
      else if (wallSide === 2) { ax = r.x + 1 + Math.floor(rng() * (r.w - 2)); ay = r.y + r.h - 1; }
      else                     { ax = r.x; ay = r.y + 1 + Math.floor(rng() * (r.h - 2)); }
      const groupSize = 2 + Math.floor(rng() * 3);
      for (let g = 0; g < groupSize && placed < GLOBAL_CAP; g++) {
        const jx = ax + (rng() - 0.5) * 1.6;
        const jy = ay + (rng() - 0.5) * 1.6;
        const tx = Math.round(jx), ty = Math.round(jy);
        if (ty < 0 || ty >= MAP_H || tx < 0 || tx >= MAP_W) continue;
        if (map[ty][tx] !== T_FLOOR) continue;
        lights.push({ type: 'glowMushroom', x: jx * TILE + TILE / 2, y: jy * TILE + TILE / 2, r: 42 + rng() * 14, variant: (placed + g) & 1, phase: rng() * Math.PI * 2 });
        placed++;
      }
    }
  }
}

export function placePuddles(map, rooms, rng, puddles) {
  for (const r of rooms) {
    if (r.w < 4 || r.h < 4) continue;
    const target = r.isLarge ? (2 + Math.floor(rng() * 2)) : (rng() < 0.55 ? 1 : 0);
    let placed = 0, safety = 20;
    while (placed < target && safety-- > 0) {
      const tx = r.x + 1 + Math.floor(rng() * (r.w - 2));
      const ty = r.y + 1 + Math.floor(rng() * (r.h - 2));
      if (map[ty][tx] !== T_FLOOR) continue;
      if (tx === r.cx && ty === r.cy) continue;
      let tooClose = false;
      for (const p of puddles) {
        if (Math.abs(p.tx - tx) <= 1 && Math.abs(p.ty - ty) <= 1) { tooClose = true; break; }
      }
      if (tooClose) continue;
      puddles.push({ tx, ty, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, rx: 8 + rng() * 4, ry: 4 + rng() * 2, seed: Math.floor(rng() * 1e9) });
      placed++;
    }
  }
}
