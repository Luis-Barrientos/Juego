/**
 * Map rendering, lighting overlay and minimap.
 *
 * The static tile map is rendered once to an offscreen canvas whenever the
 * floor changes. Per-frame rendering simply blits that canvas — a major
 * performance win compared to drawing every tile every frame.
 */

import { state } from './state.js';
import {
  TILE, MAP_W, MAP_H, VIEW_W, VIEW_H, T_FLOOR, T_STAIR,
} from './config.js';
import { mulberry32 } from './utils.js';

let mapCanvas = null;
let mapCtx    = null;

let lightCanvas = null;
let lightCtx    = null;

/**
 * Pre-render the static map to an offscreen canvas, themed by the active biome.
 */
export function rebuildMapCache() {
  if (!mapCanvas) {
    mapCanvas = document.createElement('canvas');
    mapCanvas.width  = MAP_W * TILE;
    mapCanvas.height = MAP_H * TILE;
    mapCtx = mapCanvas.getContext('2d');
  }
  const ctx   = mapCtx;
  const biome = state.biome;
  ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);

  // Deterministic per-floor RNG so decorations don't flicker on rebuild.
  const decorRng = mulberry32(state.floor * 9176 + 53);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t  = state.map[y][x];
      const px = x * TILE;
      const py = y * TILE;

      if (t === T_FLOOR || t === T_STAIR) {
        drawFloorTile(ctx, px, py, x, y, biome);
        if (decorRng() < biome.decorChance) {
          drawDecoration(ctx, px, py, biome, decorRng);
        }
      } else {
        drawWallTile(ctx, px, py, x, y, biome);
      }
    }
  }
}

/**
 * Draw a single floor cell using the biome's stone palette plus a subtle
 * checker variant and occasional crack.
 * @private
 */
function drawFloorTile(ctx, px, py, x, y, biome) {
  const checker = (x + y) & 1;
  const [r, g, b] = checker ? biome.floor.alt : biome.floor.base;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(px, py, TILE, TILE);

  const hash = (x * 7 + y * 13) % 9;
  if (hash === 0) {
    ctx.fillStyle = biome.floor.crackTint;
    ctx.fillRect(px + 4, py + 6, 6, 1);
    ctx.fillRect(px + 5, py + 7, 4, 1);
  } else if (hash === 4) {
    ctx.fillStyle = biome.floor.crackTint;
    ctx.fillRect(px + TILE - 10, py + TILE - 8, 7, 1);
  }
}

/**
 * Draw a wall cell with a thin top edge and a darker bottom shadow when the
 * tile below is a floor.
 * @private
 */
function drawWallTile(ctx, px, py, x, y, biome) {
  ctx.fillStyle = biome.wall.top;
  ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = biome.wall.bottom;
  ctx.fillRect(px, py + TILE - 1, TILE, 1);
  ctx.fillRect(px + TILE - 1, py, 1, TILE);
  if (y + 1 < MAP_H && state.map[y + 1][x] !== 0) {
    ctx.fillStyle = biome.wall.side;
    ctx.fillRect(px, py + TILE - 6, TILE, 6);
    ctx.fillStyle = biome.wall.bottom;
    ctx.fillRect(px, py + TILE - 7, TILE, 1);
  }
}

/**
 * Pick a random decoration from the biome and draw it inside a floor tile.
 * Decorations are tiny pixel-art sprites painted with `fillRect` calls.
 * @private
 */
function drawDecoration(ctx, px, py, biome, rng) {
  const kind = biome.decorations[Math.floor(rng() * biome.decorations.length)];
  const cx   = px + TILE / 2;
  const cy   = py + TILE / 2;

  switch (kind) {
    case 'moss': {
      ctx.fillStyle = 'rgba(80,140,60,0.55)';
      for (let i = 0; i < 6; i++) {
        const ox = (rng() - 0.5) * TILE * 0.7;
        const oy = (rng() - 0.5) * TILE * 0.7;
        ctx.fillRect(cx + ox, cy + oy, 2 + rng() * 2, 1 + rng() * 2);
      }
      break;
    }
    case 'roots': {
      ctx.strokeStyle = 'rgba(40,80,30,0.7)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 4, py + 4);
      ctx.lineTo(cx + (rng() - 0.5) * 6, cy + (rng() - 0.5) * 6);
      ctx.lineTo(px + TILE - 4, py + TILE - 4);
      ctx.stroke();
      break;
    }
    case 'mushroom': {
      ctx.fillStyle = '#5a3018';
      ctx.fillRect(cx - 1, cy, 2, 4);
      ctx.fillStyle = '#c04030';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 2, cy - 1, 1, 1);
      ctx.fillRect(cx + 1, cy - 1, 1, 1);
      break;
    }
    case 'sunbeam': {
      ctx.fillStyle = 'rgba(255,230,150,0.10)';
      ctx.beginPath();
      ctx.moveTo(cx - 6, py);
      ctx.lineTo(cx + 6, py);
      ctx.lineTo(cx + 10, py + TILE);
      ctx.lineTo(cx - 10, py + TILE);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cobweb': {
      ctx.strokeStyle = 'rgba(220,220,220,0.45)';
      ctx.lineWidth   = 0.7;
      ctx.beginPath();
      const ox = px + (rng() < 0.5 ? 2 : TILE - 2);
      const oy = py + (rng() < 0.5 ? 2 : TILE - 2);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 0.5;
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + Math.cos(a) * 9 * (ox < px + TILE / 2 ? 1 : -1),
                   oy + Math.sin(a) * 9 * (oy < py + TILE / 2 ? 1 : -1));
      }
      ctx.stroke();
      break;
    }
    case 'skull': {
      ctx.fillStyle = 'rgba(220,210,180,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.fillRect(cx - 2, cy - 1, 1, 2);
      ctx.fillRect(cx + 1, cy - 1, 1, 2);
      ctx.fillRect(cx - 1, cy + 2, 3, 1);
      break;
    }
    case 'driedRoot': {
      ctx.strokeStyle = 'rgba(70,40,20,0.7)';
      ctx.lineWidth   = 1.2;
      ctx.beginPath();
      ctx.moveTo(px + 6, py + 6);
      ctx.quadraticCurveTo(cx, cy + 4, px + TILE - 6, py + TILE - 6);
      ctx.stroke();
      break;
    }
    case 'books': {
      const colors = ['#8a3010', '#3a3060', '#2a5a30', '#604010'];
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
        ctx.fillRect(px + 4 + i * 6, py + TILE - 8, 5, 6);
      }
      break;
    }
    case 'rune': {
      ctx.fillStyle = 'rgba(120,180,255,0.55)';
      ctx.fillRect(cx - 4, cy, 8, 1);
      ctx.fillRect(cx, cy - 4, 1, 8);
      ctx.fillRect(cx - 3, cy - 3, 1, 1);
      ctx.fillRect(cx + 3, cy - 3, 1, 1);
      ctx.fillRect(cx - 3, cy + 3, 1, 1);
      ctx.fillRect(cx + 3, cy + 3, 1, 1);
      break;
    }
    case 'paper': {
      ctx.fillStyle = 'rgba(220,200,160,0.5)';
      ctx.fillRect(cx - 3, cy - 2, 6, 5);
      ctx.fillStyle = 'rgba(60,40,10,0.5)';
      ctx.fillRect(cx - 2, cy - 1, 4, 1);
      ctx.fillRect(cx - 2, cy + 1, 3, 1);
      break;
    }
    case 'bones': {
      ctx.fillStyle = 'rgba(240,230,200,0.7)';
      ctx.fillRect(cx - 5, cy, 10, 1);
      ctx.fillRect(cx - 5, cy - 1, 1, 3);
      ctx.fillRect(cx + 4, cy - 1, 1, 3);
      break;
    }
    case 'lavaCrack': {
      ctx.fillStyle = 'rgba(255,80,20,0.7)';
      ctx.fillRect(px + 4, cy, TILE - 8, 1);
      ctx.fillStyle = 'rgba(255,200,80,0.6)';
      ctx.fillRect(px + 6, cy, TILE - 12, 1);
      break;
    }
    case 'ash': {
      ctx.fillStyle = 'rgba(90,80,80,0.5)';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(px + rng() * TILE, py + rng() * TILE, 1, 1);
      }
      break;
    }
  }
}

/**
 * Draw the cached map (and animated stair overlay) to the visible canvas.
 */
export function drawMap(ctx) {
  if (!mapCanvas) return;
  ctx.drawImage(
    mapCanvas,
    state.cameraX, state.cameraY, VIEW_W, VIEW_H,
    0, 0, VIEW_W, VIEW_H,
  );
  drawStairOverlay(ctx);
}

/**
 * Draw the animated stair tile (pulse, glow and prompt). Done per frame
 * because it is animated and would not benefit from caching.
 * @private
 */
function drawStairOverlay(ctx) {
  for (const r of state.rooms) {
    if (!r.isStairsRoom) continue;
    const tx = r.cx, ty = r.cy;
    if (state.map[ty][tx] !== T_STAIR) continue;

    const px = tx * TILE - state.cameraX;
    const py = ty * TILE - state.cameraY;
    if (px < -TILE || px > VIEW_W + TILE || py < -TILE || py > VIEW_H + TILE) continue;

    const pulse = 0.6 + Math.sin(state.time * 4) * 0.4;
    const cx = px + TILE / 2, cy = py + TILE / 2;

    const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, TILE);
    grd.addColorStop(0,   `rgba(200,120,255,${0.9 * pulse})`);
    grd.addColorStop(0.5, `rgba(140,60,220,${0.5 * pulse})`);
    grd.addColorStop(1,   'rgba(80,20,140,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(px - 8, py - 8, TILE + 16, TILE + 16);

    ctx.fillStyle = '#1a0828';
    ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
    ctx.fillStyle = '#a060ff';
    ctx.shadowColor = '#d090ff'; ctx.shadowBlur = 10;
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(px + 6, py + 7 + i * 5, TILE - 12, 2);
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(220,160,255,${pulse})`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 4, py + 4, TILE - 8, TILE - 8);

    const p = state.player;
    if (p) {
      const dxp = (cx + state.cameraX) - p.x;
      const dyp = (cy + state.cameraY) - p.y;
      if (Math.hypot(dxp, dyp) < 80) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
        ctx.fillText('[E] BAJAR', cx, py - 6);
        ctx.shadowBlur = 0;
      }
    }
  }
}

/**
 * Composite the lighting overlay (ambient darkness + light masks).
 */
export function drawLighting(ctx) {
  if (!lightCanvas) {
    lightCanvas = document.createElement('canvas');
    lightCanvas.width  = VIEW_W;
    lightCanvas.height = VIEW_H;
    lightCtx = lightCanvas.getContext('2d');
  } else if (lightCanvas.width !== VIEW_W || lightCanvas.height !== VIEW_H) {
    lightCanvas.width  = VIEW_W;
    lightCanvas.height = VIEW_H;
  }

  const lctx  = lightCtx;
  const biome = state.biome;
  lctx.globalCompositeOperation = 'source-over';
  lctx.fillStyle = biome ? biome.ambientTint : 'rgba(8, 4, 12, 0.82)';
  lctx.fillRect(0, 0, VIEW_W, VIEW_H);

  lctx.globalCompositeOperation = 'destination-out';

  // Player light
  const p = state.player;
  if (p) {
    const px = p.x - state.cameraX;
    const py = p.y - state.cameraY;
    const grad = lctx.createRadialGradient(px, py, 10, px, py, 180);
    grad.addColorStop(0,   'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1,   'rgba(255,255,255,0)');
    lctx.fillStyle = grad;
    lctx.beginPath();
    lctx.arc(px, py, 180, 0, Math.PI * 2);
    lctx.fill();
  }

  // Stair light — keeps the goal visible from far away.
  for (const r of state.rooms) {
    if (!r.isStairsRoom) continue;
    const sx = r.cx * TILE + TILE / 2 - state.cameraX;
    const sy = r.cy * TILE + TILE / 2 - state.cameraY;
    if (sx < -100 || sx > VIEW_W + 100 || sy < -100 || sy > VIEW_H + 100) continue;
    const radius = 90 + Math.sin(state.time * 4) * 8;
    const sgrad  = lctx.createRadialGradient(sx, sy, 4, sx, sy, radius);
    sgrad.addColorStop(0,   'rgba(255,255,255,0.95)');
    sgrad.addColorStop(0.6, 'rgba(255,255,255,0.4)');
    sgrad.addColorStop(1,   'rgba(255,255,255,0)');
    lctx.fillStyle = sgrad;
    lctx.beginPath();
    lctx.arc(sx, sy, radius, 0, Math.PI * 2);
    lctx.fill();
  }

  // Torches
  const tc = (biome && biome.torchColor) || [255, 200, 140];
  for (const lt of state.lights) {
    lt.flicker += 0.15;
    const lx = lt.x - state.cameraX;
    const ly = lt.y - state.cameraY;
    if (lx < -lt.r || lx > VIEW_W + lt.r || ly < -lt.r || ly > VIEW_H + lt.r) continue;
    const r = lt.r + Math.sin(lt.flicker) * 6;
    const grad = lctx.createRadialGradient(lx, ly, 5, lx, ly, r);
    grad.addColorStop(0,   `rgba(${tc[0]},${tc[1]},${tc[2]},1)`);
    grad.addColorStop(0.6, `rgba(${tc[0]},${tc[1]},${tc[2]},0.5)`);
    grad.addColorStop(1,   'rgba(0,0,0,0)');
    lctx.fillStyle = grad;
    lctx.beginPath();
    lctx.arc(lx, ly, r, 0, Math.PI * 2);
    lctx.fill();
  }

  // Boss aura
  for (const e of state.enemies) {
    if (e.isBoss && !e.dead) {
      const ex = e.x - state.cameraX, ey = e.y - state.cameraY;
      const grad = lctx.createRadialGradient(ex, ey, 10, ex, ey, 140);
      grad.addColorStop(0, 'rgba(255,80,80,0.7)');
      grad.addColorStop(1, 'rgba(255,80,80,0)');
      lctx.fillStyle = grad;
      lctx.beginPath();
      lctx.arc(ex, ey, 140, 0, Math.PI * 2);
      lctx.fill();
    }
  }

  ctx.drawImage(lightCanvas, 0, 0);

  // Warm tint over torches and stairs (additive).
  ctx.globalCompositeOperation = 'lighter';
  const tint = (biome && biome.torchTint) || 'rgba(255,160,80,0.18)';
  for (const lt of state.lights) {
    const lx = lt.x - state.cameraX;
    const ly = lt.y - state.cameraY;
    if (lx < -120 || lx > VIEW_W + 120 || ly < -120 || ly > VIEW_H + 120) continue;
    const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, 80);
    grad.addColorStop(0, tint);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lx, ly, 80, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const r of state.rooms) {
    if (!r.isStairsRoom) continue;
    const sx = r.cx * TILE + TILE / 2 - state.cameraX;
    const sy = r.cy * TILE + TILE / 2 - state.cameraY;
    if (sx < -120 || sx > VIEW_W + 120 || sy < -120 || sy > VIEW_H + 120) continue;
    const pulse = 0.18 + Math.sin(state.time * 4) * 0.08;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, 70);
    grad.addColorStop(0, `rgba(180,100,255,${pulse})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, 70, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Torch / sconce sprites on top.
  const flame   = (biome && biome.torchColor) || [255, 128, 48];
  const flameHi = `rgba(${Math.min(255, flame[0] + 40)},${Math.min(255, flame[1] + 60)},${Math.min(255, flame[2] + 90)},1)`;
  const flameLo = `rgb(${flame[0]},${flame[1]},${flame[2]})`;
  for (const lt of state.lights) {
    const lx = lt.x - state.cameraX;
    const ly = lt.y - state.cameraY;
    if (lx < -10 || lx > VIEW_W + 10 || ly < 0 || ly > VIEW_H) continue;
    const fl = Math.sin(lt.flicker * 1.7) * 1.5;
    if (lt.type === 'sconce') {
      // Wall bracket: short metal arm sticking out of the wall, bowl on top
      const dir = lt.dir === 'left' ? -1 : 1;
      ctx.fillStyle = '#2a1a10';
      ctx.fillRect(lx - (dir < 0 ? 5 : 0), ly - 1, 5, 2);   // bracket arm
      ctx.fillStyle = '#4a3020';
      ctx.fillRect(lx + dir * 3 - 2, ly - 4, 4, 3);          // bowl
      // Flame on bowl
      ctx.fillStyle = flameLo;
      ctx.beginPath();
      ctx.ellipse(lx + dir * 3, ly - 7 + fl, 2.2, 4 + fl * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = flameHi;
      ctx.beginPath();
      ctx.ellipse(lx + dir * 3, ly - 7 + fl, 1, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Floor torch: stake + flame
      ctx.fillStyle = '#3a2010';
      ctx.fillRect(lx - 1.5, ly - 2, 3, 8);
      ctx.fillStyle = flameLo;
      ctx.beginPath(); ctx.ellipse(lx, ly - 6 + fl, 3, 5 + fl * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = flameHi;
      ctx.beginPath(); ctx.ellipse(lx, ly - 6 + fl, 1.5, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/**
 * Draw atmospheric sunbeams falling from above (only used by 'ruins').
 * Beams are tall semi-transparent trapezoids with floating dust motes.
 * Call BEFORE drawLighting so the ambient overlay still tints them slightly.
 */
export function drawSunbeams(ctx) {
  if (!state.sunbeams || state.sunbeams.length === 0) return;
  const t = state.time;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const sb of state.sunbeams) {
    const sx = sb.x - state.cameraX;
    const sy = sb.y - state.cameraY;
    if (sx < -sb.w || sx > VIEW_W + sb.w) continue;
    if (sy + sb.h < 0 || sy > VIEW_H) continue;

    // Body of the beam — wider at the bottom, fading from top.
    const halfTop    = sb.w * 0.25;
    const halfBottom = sb.w * 0.75;
    const grad = ctx.createLinearGradient(0, sy, 0, sy + sb.h);
    grad.addColorStop(0,    'rgba(255, 240, 180, 0.22)');
    grad.addColorStop(0.6,  'rgba(255, 230, 160, 0.10)');
    grad.addColorStop(1,    'rgba(255, 220, 140, 0.00)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(sx - halfTop,    sy);
    ctx.lineTo(sx + halfTop,    sy);
    ctx.lineTo(sx + halfBottom, sy + sb.h);
    ctx.lineTo(sx - halfBottom, sy + sb.h);
    ctx.closePath();
    ctx.fill();

    // Inner brighter core
    const grad2 = ctx.createLinearGradient(0, sy, 0, sy + sb.h);
    grad2.addColorStop(0,   'rgba(255, 250, 220, 0.35)');
    grad2.addColorStop(1,   'rgba(255, 240, 180, 0.00)');
    ctx.fillStyle = grad2;
    ctx.beginPath();
    ctx.moveTo(sx - halfTop * 0.4,    sy);
    ctx.lineTo(sx + halfTop * 0.4,    sy);
    ctx.lineTo(sx + halfBottom * 0.4, sy + sb.h);
    ctx.lineTo(sx - halfBottom * 0.4, sy + sb.h);
    ctx.closePath();
    ctx.fill();

    // Dust motes (deterministic per-beam, animated by time)
    ctx.fillStyle = 'rgba(255, 245, 200, 0.7)';
    for (let i = 0; i < 7; i++) {
      const seed = sb.seed + i * 137;
      const phase = ((seed % 1000) / 1000 + t * 0.12) % 1;
      const driftX = Math.sin(t * 0.6 + seed) * 4;
      const dx = sx - halfBottom * 0.5 + ((seed * 13) % 100) / 100 * halfBottom + driftX;
      const dy = sy + phase * sb.h;
      ctx.fillRect(dx, dy, 1.2, 1.2);
    }
  }
  ctx.restore();
}

/**
 * Render the minimap onto the supplied canvas.
 */
export function drawMinimap(mctx, w, h) {
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = 'rgba(0,0,0,0.6)';
  mctx.fillRect(0, 0, w, h);
  const sx = w / MAP_W;
  const sy = h / MAP_H;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = state.map[y][x];
      if (t === T_FLOOR) {
        mctx.fillStyle = '#3a2818';
        mctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      } else if (t === T_STAIR) {
        const pulse = 0.7 + Math.sin(state.time * 4) * 0.3;
        mctx.fillStyle = `rgba(200,120,255,${pulse})`;
        mctx.fillRect(x * sx - 2, y * sy - 2, sx + 4, sy + 4);
        mctx.fillStyle = '#fff';
        mctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      }
    }
  }

  for (const e of state.enemies) {
    if (e.dead) continue;
    mctx.fillStyle = e.isBoss ? '#ff4040' : '#ff6060';
    const ex = (e.x / TILE) * sx, ey = (e.y / TILE) * sy;
    mctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
  }

  const p = state.player;
  if (p) {
    mctx.fillStyle = '#40c0ff';
    mctx.beginPath();
    mctx.arc((p.x / TILE) * sx, (p.y / TILE) * sy, 2.5, 0, Math.PI * 2);
    mctx.fill();
  }
}
