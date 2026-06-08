import { TILE, MAP_W, MAP_H, T_FLOOR, T_WALL } from '../config.js';

export function placeMagicFlames(rooms, rng, lights) {
  for (const r of rooms) {
    if (r.isStartRoom) continue;
    if (r.isObservatory) continue;
    if (r.w < 5 || r.h < 4) continue;
    const count = 1 + (r.isLarge ? Math.floor(rng() * 2) : 0);
    for (let i = 0; i < count; i++) {
      const ax = (r.x + 1 + rng() * (r.w - 2)) * TILE;
      const ay = (r.y + 1 + rng() * (r.h - 2)) * TILE;
      const bx = (r.x + 1 + rng() * (r.w - 2)) * TILE;
      const by = (r.y + 1 + rng() * (r.h - 2)) * TILE;
      const purple = rng() < 0.65;
      lights.push({
        type: 'magicFlame', ax, ay, bx, by, x: ax, y: ay,
        phase: rng() * Math.PI * 2, speed: 0.25 + rng() * 0.35,
        wobble: rng() * Math.PI * 2, color: purple ? [180, 120, 255] : [255, 90, 110],
        r: 70 + rng() * 25, flicker: rng() * Math.PI * 2,
      });
    }
  }
}

export function decorateMagicFlamesWithRunes(lights, rng) {
  for (const l of lights) {
    if (l.type !== 'magicFlame') continue;
    l.rune = {
      shape: Math.floor(rng() * 4),
      orbitR: 8 + rng() * 4,
      phase: rng() * Math.PI * 2,
      bobAmp: 2 + rng() * 2,
      bobSpeed: 1.4 + rng() * 0.8,
    };
  }
}

export function placeLibraryRuneMarks(map, rooms, rng, lights, libraryProps) {
  for (const l of lights) {
    if (l.type !== 'magicFlame') continue;
    if (rng() > 0.40) continue;
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
    if (libraryProps.some(p => p.kind === 'libraryRuneMark' && p.tx === c.xx && p.ty === c.yy)) continue;
    libraryProps.push({ kind: 'libraryRuneMark', tx: c.xx, ty: c.yy, w: 1, h: 1, seed: Math.floor(rng() * 1e9) });
  }
}

export function placeLeafSpawners(rooms, rng, leafSpawners) {
  for (const r of rooms) {
    if (r.isStartRoom) continue;
    if (r.isGrandTome) continue;
    if (r.isObservatory) continue;
    if (r.isForbiddenArchive) continue;
    if (r.w < 5 || r.h < 4) continue;
    if (rng() < 0.4) continue;
    const count = r.isLarge || r.isGreatLibrary ? 1 + Math.floor(rng() * 2) : 1;
    for (let i = 0; i < count; i++) {
      leafSpawners.push({
        x: (r.x + 1 + rng() * (r.w - 2)) * TILE,
        y: (r.y + 0.5 + rng() * 1.5) * TILE,
        timer: 3 + rng() * 5,
        hue: rng() < 0.5 ? 'paper' : 'leaf',
      });
    }
  }
}

export function placeShelves(rooms, map, rng, libraryProps) {
  for (const r of rooms) {
    if (r.isStartRoom || r.isStairsRoom) continue;
    if (r.isGreatLibrary) continue;
    if (r.isGrandTome) continue;
    if (r.isObservatory) continue;
    if (r.isKeyRoom) continue;
    if (r.isForbiddenArchive) continue;
    if (r.w < 4 || r.h < 4) continue;
    if (!r.isLarge && rng() > 0.55) continue;
    const target = r.isLarge ? 2 + Math.floor(rng() * 2) : 1;
    let placed = 0, safety = 16;
    while (placed < target && safety-- > 0) {
      const side = Math.floor(rng() * 4);
      const horizontal = side === 0 || side === 2;
      const len = 2;
      let tx, ty;
      if (side === 0) { tx = r.x + 1 + Math.floor(rng() * (r.w - 2 - len + 1)); ty = r.y + 1; }
      else if (side === 2) { tx = r.x + 1 + Math.floor(rng() * (r.w - 2 - len + 1)); ty = r.y + r.h - 2; }
      else if (side === 1) { tx = r.x + r.w - 2; ty = r.y + 1 + Math.floor(rng() * (r.h - 2 - len + 1)); }
      else { tx = r.x + 1; ty = r.y + 1 + Math.floor(rng() * (r.h - 2 - len + 1)); }
      const w = horizontal ? len : 1;
      const h = horizontal ? 1 : len;
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
          if (libraryProps.some(p => xx >= p.tx && xx < p.tx + p.w && yy >= p.ty && yy < p.ty + p.h)) { ok = false; break; }
        }
      }
      if (!ok) continue;
      for (let yy = ty; yy < ty + h; yy++) {
        for (let xx = tx; xx < tx + w; xx++) map[yy][xx] = T_WALL;
      }
      libraryProps.push({ kind: 'shelf', tx, ty, w, h, orient: horizontal ? 'h' : 'v', face: side === 0 ? 'S' : side === 2 ? 'N' : side === 1 ? 'W' : 'E', seed: Math.floor(rng() * 1e9) });
      placed++;
    }
  }
}

export function placeTables(rooms, map, rng, libraryProps) {
  for (const r of rooms) {
    if (r.isStartRoom || r.isStairsRoom) continue;
    if (r.isGreatLibrary) continue;
    if (r.isGrandTome) continue;
    if (r.isObservatory) continue;
    if (r.isKeyRoom) continue;
    if (r.isForbiddenArchive) continue;
    if (r.w < 5 || r.h < 4) continue;
    if (rng() > 0.6) continue;
    const target = r.isLarge ? 2 : 1;
    let placed = 0, safety = 12;
    while (placed < target && safety-- > 0) {
      const horizontal = rng() < 0.5;
      const w = horizontal ? 2 : 1;
      const h = horizontal ? 1 : (rng() < 0.4 ? 2 : 1);
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
          if (libraryProps.some(p => xx >= p.tx && xx < p.tx + p.w && yy >= p.ty && yy < p.ty + p.h)) { ok = false; break; }
        }
      }
      if (!ok) continue;
      for (let yy = ty; yy < ty + h; yy++) {
        for (let xx = tx; xx < tx + w; xx++) map[yy][xx] = T_WALL;
      }
      libraryProps.push({ kind: rng() < 0.45 ? 'tableBroken' : 'table', tx, ty, w, h, orient: horizontal ? 'h' : 'v', seed: Math.floor(rng() * 1e9) });
      placed++;
    }
  }
}
