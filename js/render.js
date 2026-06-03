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

let mapCanvas = null;
let mapCtx    = null;

let lightCanvas = null;
let lightCtx    = null;

/**
 * Pre-render the static map to an offscreen canvas. Call after the
 * dungeon for a new floor has been generated.
 */
export function rebuildMapCache() {
  if (!mapCanvas) {
    mapCanvas = document.createElement('canvas');
    mapCanvas.width  = MAP_W * TILE;
    mapCanvas.height = MAP_H * TILE;
    mapCtx = mapCanvas.getContext('2d');
  }
  const ctx = mapCtx;
  ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = state.map[y][x];
      const px = x * TILE;
      const py = y * TILE;
      if (t === T_FLOOR || t === T_STAIR) {
        const hash  = (x * 7 + y * 13) % 5;
        const shade = 32 + hash * 4;
        ctx.fillStyle = `rgb(${shade},${shade - 6},${shade - 12})`;
        ctx.fillRect(px, py, TILE, TILE);
        if ((x + y) % 7 === 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(px + 4, py + 6, 6, 1);
        }
      } else {
        ctx.fillStyle = '#1a1218';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = '#0a060a';
        ctx.fillRect(px, py + TILE - 1, TILE, 1);
        ctx.fillRect(px + TILE - 1, py, 1, TILE);
        if (y + 1 < MAP_H && state.map[y + 1][x] !== 0) {
          ctx.fillStyle = '#2a1820';
          ctx.fillRect(px, py + TILE - 6, TILE, 6);
          ctx.fillStyle = '#0a0408';
          ctx.fillRect(px, py + TILE - 7, TILE, 1);
        }
      }
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
  }

  const lctx = lightCtx;
  lctx.globalCompositeOperation = 'source-over';
  lctx.fillStyle = 'rgba(8, 4, 12, 0.82)';
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
  for (const lt of state.lights) {
    lt.flicker += 0.15;
    const lx = lt.x - state.cameraX;
    const ly = lt.y - state.cameraY;
    if (lx < -lt.r || lx > VIEW_W + lt.r || ly < -lt.r || ly > VIEW_H + lt.r) continue;
    const r = lt.r + Math.sin(lt.flicker) * 6;
    const grad = lctx.createRadialGradient(lx, ly, 5, lx, ly, r);
    grad.addColorStop(0,   'rgba(255,200,140,1)');
    grad.addColorStop(0.6, 'rgba(255,140,80,0.5)');
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
  for (const lt of state.lights) {
    const lx = lt.x - state.cameraX;
    const ly = lt.y - state.cameraY;
    if (lx < -120 || lx > VIEW_W + 120 || ly < -120 || ly > VIEW_H + 120) continue;
    const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, 80);
    grad.addColorStop(0, 'rgba(255,160,80,0.18)');
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

  // Torch sprites on top.
  for (const lt of state.lights) {
    const lx = lt.x - state.cameraX;
    const ly = lt.y - state.cameraY;
    if (lx < 0 || lx > VIEW_W || ly < 0 || ly > VIEW_H) continue;
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(lx - 1.5, ly - 2, 3, 8);
    const fl = Math.sin(lt.flicker * 1.7) * 1.5;
    ctx.fillStyle = '#ff8030';
    ctx.beginPath(); ctx.ellipse(lx, ly - 6 + fl, 3, 5 + fl * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd060';
    ctx.beginPath(); ctx.ellipse(lx, ly - 6 + fl, 1.5, 3, 0, 0, Math.PI * 2); ctx.fill();
  }
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
