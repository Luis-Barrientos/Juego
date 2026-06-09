/**
 * Map rendering, lighting overlay and minimap.
 *
 * The static tile map is rendered once to an offscreen canvas whenever the
 * floor changes. Per-frame rendering simply blits that canvas — a major
 * performance win compared to drawing every tile every frame.
 */

import { state } from './state.js';
import {
  TILE, MAP_W, MAP_H, VIEW_W, VIEW_H, T_FLOOR, T_STAIR, T_DOOR_LOCKED, T_FLOOR_DARK,
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

      if (t === T_FLOOR || t === T_STAIR || t === T_FLOOR_DARK) {
        drawFloorTile(ctx, px, py, x, y, biome, t === T_FLOOR_DARK);
        if (decorRng() < biome.decorChance && t !== T_FLOOR_DARK) {
          drawDecoration(ctx, px, py, biome, decorRng);
        }
      } else if (t === T_DOOR_LOCKED) {
        drawFloorTile(ctx, px, py, x, y, biome, false);
        drawLockedDoor(ctx, px, py);
      } else {
        drawWallTile(ctx, px, py, x, y, biome);
      }
    }
  }

  // Ceiling cracks (ruins biome). Painted into the map cache so the fissure
  // sits on top of the wall row above each sunbeam-emitting room.
  if (state.sunbeams && state.sunbeams.length > 0) {
    for (const sb of state.sunbeams) {
      if (sb.crack) drawCeilingCrack(ctx, sb);
    }
  }

  // Static puddle bodies (dark water). The animated specular highlight is
  // drawn per-frame in drawPuddles() so it can react to nearby lights.
  if (state.puddles && state.puddles.length > 0) {
    for (const p of state.puddles) drawPuddleBase(ctx, p);
  }

  // Decorations baked into the map (loculi niches, cobwebs).
  if (state.decorations && state.decorations.length > 0) {
    for (const d of state.decorations) {
      if (d.kind === 'loculus') drawLoculus(ctx, d);
      else if (d.kind === 'web') drawWeb(ctx, d);
      else if (d.kind === 'plaque')       drawPlaque(ctx, d);
      else if (d.kind === 'crack')        drawCrack(ctx, d);
      else if (d.kind === 'sconceBroken') drawSconceBroken(ctx, d);
      else if (d.kind === 'namePlate')    drawNamePlate(ctx, d);
      else if (d.kind === 'clawMarks')    drawClawMarks(ctx, d);
      else if (d.kind === 'wallSkull')    drawWallSkull(ctx, d);
      else if (d.kind === 'wallShelf')      drawWallShelf(ctx, d);
      else if (d.kind === 'scrollHanging')  drawScrollHanging(ctx, d);
      else if (d.kind === 'runeSymbol')     drawRuneSymbol(ctx, d);
      else if (d.kind === 'darkPortrait')   drawDarkPortrait(ctx, d);
      else if (d.kind === 'noticeBoard')    drawNoticeBoard(ctx, d);
    }
  }

  // Sarcophagi painted over the underlying wall tile so the tomb stone
  // shows instead of the generic wall. Awakable (cracked) ones get an
  // animated aura per-frame in drawSarcophagiOverlay().
  if (state.sarcophagi && state.sarcophagi.length > 0) {
    for (const s of state.sarcophagi) drawSarcophagusBase(ctx, s);
  }

  // Library structural props (shelves, tables) painted over the wall tile
  // they occupy. Path-blocking is handled by them being T_WALL in the map.
  if (state.libraryProps && state.libraryProps.length > 0) {
    for (const p of state.libraryProps) drawLibraryProp(ctx, p);
  }
}

/**
 * Paint a burial niche carved into a corridor wall. The niche is a dark
 * recess with a small skull silhouette inside, half-shrouded.
 * @private
 */
function drawLoculus(ctx, d) {
  const px = d.tx * 32;          // TILE = 32
  const py = d.ty * 32;
  ctx.save();
  // Dark recess.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(px + 6, py + 12, 20, 16);
  // Inner gradient — darker at the back.
  const grd = ctx.createLinearGradient(px + 6, py + 12, px + 6, py + 28);
  grd.addColorStop(0, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(px + 6, py + 12, 20, 16);
  // Skull bone fragment inside.
  ctx.fillStyle = 'rgba(180, 170, 150, 0.65)';
  ctx.beginPath(); ctx.ellipse(px + 16, py + 22, 4, 3.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(px + 14, py + 21, 1.2, 1.2);
  ctx.fillRect(px + 16.8, py + 21, 1.2, 1.2);
  // Stone lip on top.
  ctx.fillStyle = 'rgba(70, 75, 85, 0.9)';
  ctx.fillRect(px + 5, py + 11, 22, 2);
  ctx.restore();
}

/**
 * Paint a cobweb in an inner room corner. `q` is 0=TL, 1=TR, 2=BL, 3=BR.
 * @private
 */
function drawWeb(ctx, d) {
  const px = d.tx * 32 + 16;
  const py = d.ty * 32 + 16;
  // Anchor offset toward the wall corner.
  const dx = d.q === 0 || d.q === 2 ? -14 : 14;
  const dy = d.q === 0 || d.q === 1 ? -14 : 14;
  const ax = px + dx;
  const ay = py + dy;
  ctx.save();
  ctx.strokeStyle = 'rgba(220, 220, 220, 0.45)';
  ctx.lineWidth = 0.6;
  // Radial threads from the corner toward the room.
  const spread = Math.PI / 2;
  const baseAng = Math.atan2(py - ay, px - ax);
  for (let i = 0; i < 5; i++) {
    const a = baseAng - spread / 2 + (spread * i) / 4;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + Math.cos(a) * 14, ay + Math.sin(a) * 14);
    ctx.stroke();
  }
  // Two arc rings of the web.
  ctx.strokeStyle = 'rgba(220, 220, 220, 0.35)';
  ctx.restore();
}

/* ─── Wall-face decorations ────────────────────────────────────────────
 * All of these paint into the bottom strip (~22..30) of the wall tile so
 * they read as carved/etched into the wall just above the floor as the
 * top-down camera sees them. Coordinates assume face === 'S' (floor below).
 */

/** Stone plaque with engraved illegible script (ruins). */
function drawPlaque(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  ctx.save();
  // Drop shadow under the plaque so it lifts off the wall.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(px + 5, py + 17, 22, 14);
  // Plaque slab — warmer, brighter sandstone tone.
  ctx.fillStyle = '#9a8458';
  ctx.fillRect(px + 6, py + 16, 20, 13);
  // Top bevel (light) and bottom bevel (dark) for relief.
  ctx.fillStyle = '#c8b078';
  ctx.fillRect(px + 6, py + 16, 20, 2);
  ctx.fillStyle = '#3a2e18';
  ctx.fillRect(px + 6, py + 28, 20, 1);
  ctx.fillRect(px + 25, py + 17, 1, 12);
  // Engraved illegible lines.
  ctx.fillStyle = '#2a1f10';
  ctx.fillRect(px + 8,  py + 20, 10, 1);
  ctx.fillRect(px + 8,  py + 23, 14, 1);
  ctx.fillRect(px + 8,  py + 26, 8,  1);
  // Subtle rim highlight.
  ctx.fillStyle = 'rgba(255, 235, 180, 0.30)';
  ctx.fillRect(px + 7, py + 17, 18, 1);
  ctx.restore();
}

/** Vertical crack with moss tufts (ruins). */
function drawCrack(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  ctx.save();
  // Lighter "stone exposed" stroke behind so the crack reads on dark walls.
  ctx.strokeStyle = 'rgba(170, 160, 140, 0.55)';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px + 16, py + 12);
  ctx.lineTo(px + 13, py + 17);
  ctx.lineTo(px + 18, py + 22);
  ctx.lineTo(px + 12, py + 27);
  ctx.lineTo(px + 16, py + 30);
  ctx.stroke();
  // Black inner crack on top.
  ctx.strokeStyle = 'rgba(0,0,0,0.95)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Moss tufts with bright dot on top.
  ctx.fillStyle = '#4f7530';
  ctx.fillRect(px + 11, py + 25, 4, 3);
  ctx.fillRect(px + 17, py + 20, 3, 3);
  ctx.fillStyle = '#88b048';
  ctx.fillRect(px + 12, py + 26, 2, 1);
  ctx.fillRect(px + 18, py + 21, 1, 1);
  // Tiny moss patch at the base for grounding.
  ctx.fillStyle = '#3a5820';
  ctx.fillRect(px + 14, py + 30, 5, 1);
  ctx.restore();
}

/** Broken iron sconce (ruins). Empty bowl, no flame. */
function drawSconceBroken(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  ctx.save();
  // Sooty smear on the wall above (the long-gone smoke).
  const grd = ctx.createLinearGradient(px + 16, py + 8, px + 16, py + 22);
  grd.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grd.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = grd;
  ctx.fillRect(px + 9, py + 8, 14, 14);
  // Mounting plate (lighter so it shows on dark wall).
  ctx.fillStyle = '#5a4838';
  ctx.fillRect(px + 13, py + 14, 6, 9);
  ctx.fillStyle = '#8a6a48';
  ctx.fillRect(px + 13, py + 14, 6, 1);
  // Bracket arm.
  ctx.fillStyle = '#6a4a30';
  ctx.fillRect(px + 10, py + 21, 12, 2);
  // Tilted broken bowl — dark cast iron with lighter rim chip.
  ctx.fillStyle = '#1a0e08';
  ctx.beginPath();
  ctx.moveTo(px + 8,  py + 23);
  ctx.lineTo(px + 24, py + 25);
  ctx.lineTo(px + 22, py + 30);
  ctx.lineTo(px + 10, py + 30);
  ctx.closePath();
  ctx.fill();
  // Highlight on the broken rim.
  ctx.fillStyle = '#7a5838';
  ctx.fillRect(px + 8, py + 23, 16, 1);
  // Cold ash trickle.
  ctx.fillStyle = 'rgba(60, 50, 40, 0.85)';
  ctx.fillRect(px + 13, py + 30, 6, 1);
  ctx.fillStyle = 'rgba(120, 100, 80, 0.55)';
  ctx.fillRect(px + 14, py + 31, 4, 1);
  ctx.restore();
}

/** Small upright tombstone-ish plate with engraved cross (catacombs). */
function drawNamePlate(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  ctx.save();
  // Slab body.
  ctx.fillStyle = '#3a4350';
  ctx.fillRect(px + 11, py + 17, 10, 13);
  // Rounded top.
  ctx.beginPath();
  ctx.arc(px + 16, py + 17, 5, Math.PI, 0);
  ctx.fill();
  // Engraved cross.
  ctx.fillStyle = 'rgba(20, 25, 32, 0.85)';
  ctx.fillRect(px + 15, py + 18, 2, 8);
  ctx.fillRect(px + 13, py + 21, 6, 2);
  // Top-edge highlight.
  ctx.fillStyle = 'rgba(180,200,230,0.22)';
  ctx.fillRect(px + 12, py + 17, 8, 1);
  ctx.restore();
}

/** Three diagonal claw scratches (catacombs). */
function drawClawMarks(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const ox = i * 4;
    ctx.beginPath();
    ctx.moveTo(px + 9 + ox,  py + 17);
    ctx.lineTo(px + 13 + ox, py + 29);
    ctx.stroke();
  }
  // Pale stone exposed beneath each scratch.
  ctx.strokeStyle = 'rgba(200, 210, 220, 0.18)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 3; i++) {
    const ox = i * 4;
    ctx.beginPath();
    ctx.moveTo(px + 10 + ox, py + 18);
    ctx.lineTo(px + 14 + ox, py + 30);
    ctx.stroke();
  }
  ctx.restore();
}

/** Skull embedded into the wall (catacombs). Smaller variant of the
 *  pedestal skull, with no candle on top. */
function drawWallSkull(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  ctx.save();
  // Recess shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.ellipse(px + 16, py + 24, 7, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Skull dome.
  ctx.fillStyle = 'rgba(190, 180, 160, 0.85)';
  ctx.beginPath();
  ctx.arc(px + 16, py + 22, 5, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(px + 11, py + 22, 10, 4);
  // Jaw.
  ctx.fillStyle = 'rgba(160, 150, 130, 0.85)';
  ctx.fillRect(px + 13, py + 26, 6, 2);
  ctx.fillRect(px + 14, py + 28, 4, 1);
  // Eye sockets.
  ctx.fillStyle = '#000';
  ctx.fillRect(px + 13, py + 22, 2, 2);
  ctx.fillRect(px + 17, py + 22, 2, 2);
  // Nose.
  ctx.fillRect(px + 15.5, py + 25, 1, 1);
  ctx.restore();
}

/** Recessed wall shelf with 2-3 books resting on it (library). */
function drawWallShelf(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  let s = (d.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  ctx.save();
  // Recess shadow behind the shelf.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(px + 7, py + 19, 18, 11);
  // Shelf board (wood plank).
  ctx.fillStyle = '#5a3818';
  ctx.fillRect(px + 6, py + 27, 20, 3);
  ctx.fillStyle = '#7a5028';
  ctx.fillRect(px + 6, py + 27, 20, 1);
  ctx.fillStyle = '#2a1808';
  ctx.fillRect(px + 6, py + 30, 20, 1);
  // Books leaning on the shelf.
  const colors = ['#8a3010', '#3a3060', '#2a5a30', '#604010', '#5a2a48'];
  let x = px + 8;
  while (x < px + 24) {
    const bw = 3 + Math.floor(rnd() * 2);
    const bh = 5 + Math.floor(rnd() * 3);
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.fillRect(x, py + 27 - bh, bw, bh);
    ctx.fillStyle = 'rgba(220,200,160,0.40)';
    ctx.fillRect(x, py + 27 - bh, bw, 1);
    x += bw + 1;
  }
  // Bracket pegs.
  ctx.fillStyle = '#1a0e08';
  ctx.fillRect(px + 7,  py + 30, 2, 1);
  ctx.fillRect(px + 23, py + 30, 2, 1);
  ctx.restore();
}

/** Long parchment scroll hanging from a rod (library). */
function drawScrollHanging(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  let s = (d.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  ctx.save();
  // Rod across the top.
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(px + 10, py + 17, 12, 2);
  ctx.fillStyle = '#1a0e08';
  ctx.fillRect(px + 9,  py + 17, 1, 2);
  ctx.fillRect(px + 22, py + 17, 1, 2);
  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(px + 12, py + 20, 9, 11);
  // Parchment body.
  ctx.fillStyle = '#d8c890';
  ctx.fillRect(px + 11, py + 19, 10, 11);
  // Parchment top fold (under rod).
  ctx.fillStyle = '#b8a872';
  ctx.fillRect(px + 11, py + 19, 10, 2);
  // Subtle lines of script.
  ctx.fillStyle = 'rgba(60,40,12,0.65)';
  for (let i = 0; i < 4; i++) {
    const ly = py + 22 + i * 2;
    const w  = 4 + Math.floor(rnd() * 5);
    ctx.fillRect(px + 12, ly, w, 1);
  }
  // Curled bottom.
  ctx.fillStyle = '#b8a872';
  ctx.fillRect(px + 11, py + 30, 10, 1);
  // Right edge shading.
  ctx.fillStyle = 'rgba(80, 50, 20, 0.35)';
  ctx.fillRect(px + 20, py + 19, 1, 12);
  ctx.restore();
}

/** Glowing arcane rune painted on the wall (library). */
function drawRuneSymbol(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  let s = (d.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  // Choose between a circular sigil, a triangle, or angular runes.
  const variant = Math.floor(rnd() * 3);
  ctx.save();
  ctx.strokeStyle = 'rgba(184, 144, 255, 0.85)';
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  // Faint glow halo (baked, no per-frame animation).
  ctx.fillStyle = 'rgba(184, 144, 255, 0.10)';
  ctx.beginPath();
  ctx.arc(px + 16, py + 24, 8, 0, Math.PI * 2);
  ctx.fill();

  if (variant === 0) {
    // Sigil: outer circle + inner triangle + dot.
    ctx.beginPath();
    ctx.arc(px + 16, py + 24, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 19);
    ctx.lineTo(px + 21, py + 27);
    ctx.lineTo(px + 11, py + 27);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(184, 144, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(px + 16, py + 24, 1.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (variant === 1) {
    // Triangle + bisecting line.
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 18);
    ctx.lineTo(px + 22, py + 29);
    ctx.lineTo(px + 10, py + 29);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 18);
    ctx.lineTo(px + 16, py + 29);
    ctx.stroke();
  } else {
    // Angular runes: three vertical strokes with crossbars.
    for (let i = 0; i < 3; i++) {
      const sx = px + 11 + i * 5;
      ctx.beginPath();
      ctx.moveTo(sx, py + 19);
      ctx.lineTo(sx, py + 29);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 2, py + 22 + i);
      ctx.lineTo(sx + 2, py + 22 + i);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Dark portrait — framed painting with worn face (library). */
function drawDarkPortrait(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  ctx.save();
  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(px + 9, py + 18, 14, 14);
  // Outer gilded frame.
  ctx.fillStyle = '#6a4a18';
  ctx.fillRect(px + 8, py + 17, 16, 14);
  ctx.fillStyle = '#8a6020';
  ctx.fillRect(px + 8, py + 17, 16, 1);
  ctx.fillStyle = '#3a2808';
  ctx.fillRect(px + 8, py + 30, 16, 1);
  // Canvas (dark).
  ctx.fillStyle = '#1a1418';
  ctx.fillRect(px + 10, py + 19, 12, 10);
  // Vignette.
  const grd = ctx.createRadialGradient(px + 16, py + 23, 1, px + 16, py + 24, 8);
  grd.addColorStop(0, 'rgba(80, 60, 50, 0.55)');
  grd.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grd;
  ctx.fillRect(px + 10, py + 19, 12, 10);
  // Faint silhouette: head + shoulders.
  ctx.fillStyle = 'rgba(60, 50, 45, 0.85)';
  ctx.beginPath();
  ctx.arc(px + 16, py + 23, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(px + 12, py + 26, 8, 3);
  // Pale eye glints (uncanny).
  ctx.fillStyle = 'rgba(220, 210, 190, 0.65)';
  ctx.fillRect(px + 15, py + 23, 1, 1);
  ctx.fillRect(px + 17, py + 23, 1, 1);
  ctx.restore();
}

/** Cork notice board with pinned papers (library). */
function drawNoticeBoard(ctx, d) {
  const px = d.tx * 32, py = d.ty * 32;
  let s = (d.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  ctx.save();
  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.50)';
  ctx.fillRect(px + 8, py + 19, 16, 12);
  // Wooden frame.
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(px + 7, py + 18, 18, 12);
  // Cork surface.
  ctx.fillStyle = '#7a5828';
  ctx.fillRect(px + 8, py + 19, 16, 10);
  // Cork dots (texture).
  ctx.fillStyle = 'rgba(40, 24, 8, 0.45)';
  for (let i = 0; i < 14; i++) {
    const dx = px + 9 + Math.floor(rnd() * 14);
    const dy = py + 20 + Math.floor(rnd() * 8);
    ctx.fillRect(dx, dy, 1, 1);
  }
  // Pinned notes (2-3 small papers at jaunty offsets).
  const notes = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < notes; i++) {
    const nx = px + 9 + i * 5 + Math.floor(rnd() * 2);
    const ny = py + 20 + Math.floor(rnd() * 3);
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fillRect(nx + 1, ny + 1, 5, 5);
    ctx.fillStyle = '#e8d8a0';
    ctx.fillRect(nx, ny, 5, 5);
    // Ink lines.
    ctx.fillStyle = 'rgba(60, 40, 12, 0.65)';
    ctx.fillRect(nx + 1, ny + 1, 3, 1);
    ctx.fillRect(nx + 1, ny + 3, 2, 1);
    // Red pin.
    ctx.fillStyle = '#a02018';
    ctx.fillRect(nx + 2, ny - 1, 1, 1);
  }
  ctx.restore();
}

/**
 * Paint a sarcophagus over its wall tiles in the map cache. The tile
 * underneath is the regular wall, so we first repaint a clean floor patch
 * to erase wall edges, then we draw the tomb silhouette on top.
 *
 * Variants:
 * - 'normal':  solid stone coffin with engraved cross.
 * - 'cracked': same shape with a visible crack + baked blue tint
 *              (awakable; gets a runtime aura from drawSarcophagiOverlay).
 * - 'altar':   stepped 2×2 pedestal with a flaming bowl on top.
 * @private
 */
function drawSarcophagusBase(ctx, s) {
  const px = s.tx * 32;
  const py = s.ty * 32;
  const w  = s.w * 32;
  const h  = s.h * 32;

  ctx.save();

  // 1. Erase the wall pattern under the sarcophagus footprint with a
  //    floor-tone patch so the tomb silhouette is unambiguous.
  ctx.fillStyle = '#1a1d22';
  ctx.fillRect(px, py, w, h);

  if (s.variant === 'altar') {
    drawAltar(ctx, px, py, w, h);
  } else if (s.variant === 'opened') {
    drawOpenedCoffin(ctx, px, py, w, h, s);
  } else {
    drawCoffin(ctx, px, py, w, h, s);
  }

  ctx.restore();
}

/**
 * 2×2 altar: stepped pedestal plus a stone bowl with a blue flame.
 * @private
 */
function drawAltar(ctx, px, py, w, h) {
  const cx = px + w * 0.5;
  // Base step (wider, dark stone).
  ctx.fillStyle = '#3a3f4a';
  ctx.fillRect(px + 3, py + h - 16, w - 6, 14);
  // Base highlight.
  ctx.fillStyle = '#5a6070';
  ctx.fillRect(px + 3, py + h - 16, w - 6, 3);
  // Base shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(px + 3, py + h - 4, w - 6, 2);

  // Top tier (narrower).
  ctx.fillStyle = '#454a56';
  ctx.fillRect(px + 9, py + h - 30, w - 18, 16);
  ctx.fillStyle = '#666c7c';
  ctx.fillRect(px + 9, py + h - 30, w - 18, 3);
  // Carved cross on top tier.
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(cx - 1, py + h - 27, 2, 11);
  ctx.fillRect(cx - 5, py + h - 22, 10, 2);

  // Stone bowl rim.
  ctx.fillStyle = '#2c3038';
  ctx.beginPath();
  ctx.ellipse(cx, py + h - 32, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a6070';
  ctx.beginPath();
  ctx.ellipse(cx, py + h - 33, 11, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Bowl interior shadow.
  ctx.fillStyle = '#15181e';
  ctx.beginPath();
  ctx.ellipse(cx, py + h - 32.5, 8, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Cool blue flame in the bowl. Static seed (animated lighting layer
  // adds the flicker via a 'candle'-style light placed elsewhere; here
  // we just paint a shape so the altar reads as 'lit'.)
  ctx.fillStyle = 'rgba(180, 220, 255, 0.85)';
  ctx.beginPath();
  ctx.ellipse(cx, py + h - 38, 4, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.ellipse(cx, py + h - 39, 1.6, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 2×1 (or 1×2) coffin. Rounded ends, raised lid with a seam down the
 * middle, engraved cross, and a crack + blue tint for the awakable
 * 'cracked' variant.
 * @private
 */
function drawCoffin(ctx, px, py, w, h, s) {
  const horizontal = (s.orient || 'h') === 'h';

  // Body (full tile width minus 1px so corners read).
  const bx = px + 1, by = py + 1, bw = w - 2, bh = h - 2;

  // Rounded coffin body.
  const r = horizontal ? Math.min(bh * 0.45, 10) : Math.min(bw * 0.45, 10);
  ctx.fillStyle = '#5a5e6a';
  roundedRect(ctx, bx, by, bw, bh, r);
  ctx.fill();

  // Lid (slightly smaller, lighter, raised).
  const lx = bx + 2, ly = by + 2, lw = bw - 4, lh = bh - 4;
  const lr = Math.max(0, r - 2);
  ctx.fillStyle = '#787d8c';
  roundedRect(ctx, lx, ly, lw, lh, lr);
  ctx.fill();

  // Lid highlight (top edge).
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  if (horizontal) ctx.fillRect(lx + 4, ly + 1, lw - 8, 2);
  else            ctx.fillRect(lx + 1, ly + 4, 2, lh - 8);

  // Lid seam.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  if (horizontal) ctx.fillRect(lx + 4, ly + lh * 0.5 - 0.5, lw - 8, 1);
  else            ctx.fillRect(lx + lw * 0.5 - 0.5, ly + 4, 1, lh - 8);

  // Engraved cross at one end (head of the coffin). Black for normal
  // tombs, blue for the awakable 'cracked' variant — the colour swap is
  // the whole interactive tell, no extra glow rectangle needed.
  const isCracked = s.variant === 'cracked';
  let ccx, ccy;
  if (horizontal) {
    ccx = lx + lw * 0.30;
    ccy = ly + lh * 0.5;
  } else {
    ccx = lx + lw * 0.5;
    ccy = ly + lh * 0.30;
  }
  // Stash cross centre so the per-frame overlay can pulse it.
  s._crossX = ccx;
  s._crossY = ccy;
  ctx.fillStyle = isCracked ? 'rgba(80, 140, 210, 1)' : 'rgba(0, 0, 0, 0.78)';
  ctx.fillRect(ccx - 1, ccy - 5, 2, 11);
  ctx.fillRect(ccx - 4, ccy - 1, 8, 2);

  // Outer outline so it pops against the dark wall behind it.
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth   = 1;
  roundedRect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, r);
  ctx.stroke();
}

/**
 * Same shape as drawCoffin but the lid is gone — the body is just a hollow
 * stone shell. Drawn after a cracked sarcophagus awakens during the
 * crypta challenge so the room reads as "the things are out, not in".
 * @private
 */
function drawOpenedCoffin(ctx, px, py, w, h, s) {
  const horizontal = (s.orient || 'h') === 'h';
  const bx = px + 1, by = py + 1, bw = w - 2, bh = h - 2;
  const r = horizontal ? Math.min(bh * 0.45, 10) : Math.min(bw * 0.45, 10);

  ctx.fillStyle = '#3a3d44';
  roundedRect(ctx, bx, by, bw, bh, r);
  ctx.fill();

  ctx.fillStyle = '#0a0c10';
  roundedRect(ctx, bx + 3, by + 3, bw - 6, bh - 6, Math.max(0, r - 2));
  ctx.fill();

  ctx.fillStyle = '#5a5e6a';
  if (horizontal) {
    ctx.fillRect(bx + bw * 0.55, by - 1, bw * 0.35, 4);
    ctx.fillRect(bx + bw * 0.10, by + bh - 3, bw * 0.30, 4);
  } else {
    ctx.fillRect(bx - 1, by + bh * 0.55, 4, bh * 0.35);
    ctx.fillRect(bx + bw - 3, by + bh * 0.10, 4, bh * 0.30);
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth   = 1;
  roundedRect(ctx, bx + 0.5, by + 0.5, bw - 1, bh - 1, r);
  ctx.stroke();
}

/** @private */
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Draw a library structural prop (shelf or table) over its T_WALL footprint.
 * Each kind has its own draw routine; shelves orient along their hugged wall,
 * tables include intact and broken variants.
 *
 * @private
 */
function drawLibraryProp(ctx, p) {
  const px = p.tx * TILE;
  const py = p.ty * TILE;
  const w  = p.w  * TILE;
  const h  = p.h  * TILE;

  // The summoning circle is a walkable floor decoration — it should NOT
  // wipe the underlying floor tile to a wall tone like the solid props do.
  if (p.kind === 'summoningCircle') {
    drawSummoningCircle(ctx, px, py, w, h, p);
    return;
  }
  // Same goes for the floor decorations around the Grand Tome pedestal.
  if (p.kind === 'tomeCircle')   { drawTomeCircle(ctx, px, py, w, h, p);   return; }
  if (p.kind === 'tomeBookPile') { drawTomeBookPile(ctx, px, py, w, h, p); return; }
  if (p.kind === 'libraryRuneMark') { drawLibraryRuneMark(ctx, px, py, w, h, p); return; }
  if (p.kind === 'strawBed')     { drawStrawBed(ctx, px, py, w, h, p);     return; }
  if (p.kind === 'clawMark')     { drawClawMark(ctx, px, py, w, h, p);     return; }
  if (p.kind === 'armor')        { drawArmor(ctx, px, py, w, h, p);        return; }
  if (p.kind === 'bones')        { drawBones(ctx, px, py, w, h, p);        return; }
  if (p.kind === 'tree')         return;
  if (p.kind === 'treeRoot')     { drawTreeRoot(ctx, px, py, w, h, p);     return; }
  if (p.kind === 'constellationRing') { drawConstellationRing(ctx, px, py, w, h, p); return; }
  // Key dais and archive pedestal are floor decorations — same early
  // return as the constellation ring so the underlying floor texture
  // shows around the round shape.
  if (p.kind === 'keyDais')          { drawKeyDais(ctx, px, py, w, h, p);          return; }
  if (p.kind === 'archivePedestal')  { drawArchivePedestal(ctx, px, py, w, h, p);  return; }
  // Telescope sits on top of the constellation ring — skip the square
  // floor patch so the round ring (and the fog overlay) show through the
  // corners of the 3×3 footprint instead of being punched out.
  if (p.kind === 'telescope') { drawTelescope(ctx, px, py, w, h, p); return; }

  // Wipe the underlying wall tile back to floor tone so the prop has its
  // own silhouette instead of inheriting the dark wall fill.
  ctx.fillStyle = 'rgba(40, 28, 18, 1)';
  ctx.fillRect(px, py, w, h);

  if (p.kind === 'shelf')         drawShelf(ctx, px, py, w, h, p);
  else if (p.kind === 'archiveShelf') drawArchiveShelf(ctx, px, py, w, h, p);
  else if (p.kind === 'table')        drawTable(ctx, px, py, w, h, p, false);
  else if (p.kind === 'tableBroken')  drawTable(ctx, px, py, w, h, p, true);
  else if (p.kind === 'tomePedestal') drawTomePedestal(ctx, px, py, w, h, p);
  else if (p.kind === 'tomeBrazier')  drawTomeBrazier(ctx, px, py, w, h, p);
  else if (p.kind === 'starObelisk')  drawStarObelisk(ctx, px, py, w, h, p);
}

/**
 * Tall hexagonal stone pedestal (the giant tome that levitates on top is
 * rendered as an overlay from grandTome.js so it can bob and glow). All
 * internal sizes scale with the prop footprint so a 3×3 pedestal still
 * reads as a proportioned monument.
 */
function drawTomePedestal(ctx, px, py, w, h, p) {
  const slabH = Math.max(6, Math.floor(h * 0.13));
  const stepH = Math.max(4, Math.floor(h * 0.08));
  const inset = Math.max(2, Math.floor(w * 0.05));

  // Base shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(px + inset + 1, py + inset + 2, w - inset * 2, h - inset * 2);
  // Stone body.
  ctx.fillStyle = '#5a4a3a';
  ctx.fillRect(px + inset, py + inset, w - inset * 2, h - inset * 2);
  // Vertical seams (carved stone blocks).
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(px + w * 0.33, py + inset + slabH + 2, 1, h - inset * 2 - slabH - stepH - 2);
  ctx.fillRect(px + w * 0.66, py + inset + slabH + 2, 1, h - inset * 2 - slabH - stepH - 2);
  // Top slab (lighter).
  ctx.fillStyle = '#7a6a55';
  ctx.fillRect(px + inset + 2, py + inset, w - inset * 2 - 4, slabH);
  // Slab top edge highlight.
  ctx.fillStyle = '#9c8a70';
  ctx.fillRect(px + inset + 2, py + inset, w - inset * 2 - 4, 2);
  // Carved purple rune cross in the centre column.
  const runeLen = Math.floor(w * 0.45);
  ctx.fillStyle = '#b890ff';
  ctx.shadowColor = 'rgba(184,144,255,0.6)';
  ctx.shadowBlur  = 6;
  ctx.fillRect(px + (w - runeLen) / 2, py + h / 2 - 2, runeLen, 3);
  ctx.fillRect(px + w / 2 - 2,         py + h / 2 - runeLen / 2, 3, runeLen);
  ctx.shadowBlur = 0;
  // Four corner rivets on the slab.
  ctx.fillStyle = '#3a2c1f';
  const rivet = 2;
  ctx.fillRect(px + inset + 3,             py + inset + 3,             rivet, rivet);
  ctx.fillRect(px + w - inset - 3 - rivet, py + inset + 3,             rivet, rivet);
  ctx.fillRect(px + inset + 3,             py + inset + slabH - 5,     rivet, rivet);
  ctx.fillRect(px + w - inset - 3 - rivet, py + inset + slabH - 5,     rivet, rivet);
  // Bottom step.
  ctx.fillStyle = '#3a2c1f';
  ctx.fillRect(px + inset - 1, py + h - stepH, w - (inset - 1) * 2, stepH);
}

/**
 * Large runic ring painted on the floor under the Grand Tome pedestal.
 * Two concentric circles, a six-point hexagram inscribed inside, eight
 * compass-cardinal rune marks on the outer ring, and a halo gradient.
 * Walkable: never wipes the underlying floor.
 */
function drawTomeCircle(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  const r  = Math.min(w, h) * 0.46;
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };

  ctx.save();
  // Soft purple halo behind the rings.
  const halo = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.05);
  halo.addColorStop(0,   'rgba(120, 80, 200, 0.30)');
  halo.addColorStop(0.6, 'rgba(80, 50, 160, 0.18)');
  halo.addColorStop(1,   'rgba(40, 20, 80, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2);
  ctx.fill();

  // Dark base disk so runes pop.
  ctx.fillStyle = 'rgba(18, 12, 28, 0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Outer painted ring (purple).
  ctx.strokeStyle = 'rgba(200, 160, 255, 0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // Inner ring.
  ctx.strokeStyle = 'rgba(220, 190, 255, 0.70)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.stroke();
  // Innermost ring around the pedestal.
  ctx.strokeStyle = 'rgba(140, 100, 200, 0.60)';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
  ctx.stroke();

  // Inscribed hexagram (two overlapping triangles).
  ctx.strokeStyle = 'rgba(180, 140, 255, 0.70)';
  ctx.lineWidth = 1.2;
  for (let t = 0; t < 2; t++) {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const ang = -Math.PI / 2 + (t ? Math.PI / 3 : 0) + i * (Math.PI * 2 / 3);
      const x = cx + Math.cos(ang) * (r - 4);
      const y = cy + Math.sin(ang) * (r - 4);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Compass rune marks (small bars) at 8 equally spaced points on the outer ring.
  ctx.fillStyle = 'rgba(230, 200, 255, 0.85)';
  for (let i = 0; i < 8; i++) {
    const ang = i * (Math.PI / 4);
    const bx = cx + Math.cos(ang) * (r + 1);
    const by = cy + Math.sin(ang) * (r + 1);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(ang);
    ctx.fillRect(-3, -1, 6, 2);
    ctx.restore();
  }

  // Tiny rune dots inside the outer ring.
  ctx.fillStyle = 'rgba(220, 180, 255, 0.60)';
  for (let i = 0; i < 16; i++) {
    const ang = i * (Math.PI / 8) + rnd() * 0.05;
    const dx = cx + Math.cos(ang) * (r - 3);
    const dy = cy + Math.sin(ang) * (r - 3);
    ctx.fillRect(dx - 0.5, dy - 0.5, 1.2, 1.2);
  }

  // Faint floor cracks radiating outward.
  ctx.strokeStyle = 'rgba(40, 24, 14, 0.45)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const x1 = cx + Math.cos(a) * (r * 0.5);
    const y1 = cy + Math.sin(a) * (r * 0.5);
    const x2 = cx + Math.cos(a) * (r * 0.95);
    const y2 = cy + Math.sin(a) * (r * 0.95);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Corner brazier: stone pillar with a magical purple flame on top. Solid
 * (writes T_WALL underneath). The actual light pool is rendered by the
 * lighting pass via an attached magicFlame entry.
 */
function drawTomeBrazier(ctx, px, py, w, h, p) {
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };

  ctx.save();
  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(px + 4, py + 22, 24, 7);
  // Stone base (trapezoid feel via two stacked rects).
  ctx.fillStyle = '#4a3d2c';
  ctx.fillRect(px + 5, py + 18, 22, 10);
  ctx.fillStyle = '#5e4c36';
  ctx.fillRect(px + 7, py + 12, 18, 10);
  // Brazier bowl (lighter rim).
  ctx.fillStyle = '#7a6248';
  ctx.fillRect(px + 6, py + 10, 20, 4);
  ctx.fillStyle = '#2a1f14';
  ctx.fillRect(px + 8, py + 12, 16, 2);
  // Engraved purple rune on the front of the base.
  ctx.fillStyle = 'rgba(180, 140, 255, 0.85)';
  ctx.fillRect(px + 14, py + 20, 4, 1);
  ctx.fillRect(px + 15, py + 18, 2, 5);

  // Static "flame" silhouette (the dynamic glow comes from the lighting
  // pass, but a small painted flame anchors it visually on the brazier).
  const flameCx = px + 16;
  const flameTopY = py + 4 + Math.floor(rnd() * 2);
  // Outer purple flame.
  ctx.fillStyle = 'rgba(170, 110, 230, 0.85)';
  ctx.beginPath();
  ctx.moveTo(flameCx,     flameTopY);
  ctx.quadraticCurveTo(px + 9,  py + 10, px + 12, py + 12);
  ctx.lineTo(px + 20, py + 12);
  ctx.quadraticCurveTo(px + 23, py + 10, flameCx, flameTopY);
  ctx.closePath();
  ctx.fill();
  // Inner brighter core.
  ctx.fillStyle = 'rgba(230, 200, 255, 0.95)';
  ctx.beginPath();
  ctx.moveTo(flameCx, flameTopY + 2);
  ctx.quadraticCurveTo(px + 12, py + 11, px + 14, py + 12);
  ctx.lineTo(px + 18, py + 12);
  ctx.quadraticCurveTo(px + 20, py + 11, flameCx, flameTopY + 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * A small pile of two or three open books / scrolls discarded on the
 * floor. Walkable, decorative; covers a single 1×1 tile.
 */
function drawTomeBookPile(ctx, px, py, w, h, p) {
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };

  ctx.save();
  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(px + 4, py + 22, 22, 6);

  // Pile of 2-3 books, alternating cover colour, slightly rotated.
  const covers = ['#5a2e1f', '#3a3a6a', '#4a2a5a', '#6a4a1f'];
  const count = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < count; i++) {
    const bx = px + 5 + Math.floor(rnd() * 4) + i;
    const by = py + 19 - i * 3;
    const bw = 14 + Math.floor(rnd() * 6);
    const bh = 4;
    const tilt = (rnd() - 0.5) * 0.5;
    ctx.save();
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.rotate(tilt);
    // Cover.
    ctx.fillStyle = covers[Math.floor(rnd() * covers.length)];
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    // Pages (lighter band along the long edge).
    ctx.fillStyle = '#e8d8b5';
    ctx.fillRect(-bw / 2 + 1, -bh / 2 + 1, bw - 2, 1);
    // Spine dot.
    ctx.fillStyle = 'rgba(220, 200, 140, 0.7)';
    ctx.fillRect(-bw / 2, -bh / 2, 1, bh);
    ctx.restore();
  }

  // One open book in front: two parchment halves around a dark spine.
  ctx.fillStyle = '#e8d8b5';
  ctx.fillRect(px + 8,  py + 24, 7, 4);
  ctx.fillRect(px + 17, py + 24, 7, 4);
  ctx.fillStyle = '#2a1808';
  ctx.fillRect(px + 15, py + 23, 2, 6);
  // Faint text lines on the open pages.
  ctx.fillStyle = 'rgba(80, 50, 30, 0.55)';
  ctx.fillRect(px + 9,  py + 25, 5, 1);
  ctx.fillRect(px + 9,  py + 27, 4, 1);
  ctx.fillRect(px + 18, py + 25, 5, 1);
  ctx.fillRect(px + 18, py + 27, 4, 1);
  ctx.restore();
}

/**
 * Small painted rune mark on the floor — a single tile-sized purple
 * glyph used as ambient decor next to magic flames. Walkable; never
 * wipes the underlying floor tile.
 */
function drawLibraryRuneMark(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  const r  = Math.min(w, h) * 0.36;
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  // Pick a glyph variant once per mark.
  const variant = Math.floor(rnd() * 3);

  ctx.save();
  // Subtle violet halo so the mark reads against the dark floor.
  const halo = ctx.createRadialGradient(cx, cy, 1, cx, cy, r * 1.4);
  halo.addColorStop(0, 'rgba(184, 144, 255, 0.22)');
  halo.addColorStop(1, 'rgba(40, 20, 80, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2);
  ctx.fill();

  // Outer ring (single thin stroke).
  ctx.strokeStyle = 'rgba(200, 160, 255, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(220, 180, 255, 0.85)';
  if (variant === 0) {
    // Cross glyph.
    ctx.fillRect(cx - r * 0.7, cy - 0.8, r * 1.4, 1.6);
    ctx.fillRect(cx - 0.8, cy - r * 0.7, 1.6, r * 1.4);
  } else if (variant === 1) {
    // Three-bar glyph.
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(cx - r * 0.55, cy + i * 3 - 0.5, r * 1.1, 1.2);
    }
  } else {
    // Diamond glyph (4 short bars meeting near the centre).
    ctx.beginPath();
    ctx.moveTo(cx,           cy - r * 0.65);
    ctx.lineTo(cx + r * 0.65, cy);
    ctx.lineTo(cx,           cy + r * 0.65);
    ctx.lineTo(cx - r * 0.65, cy);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(220, 180, 255, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

/* ───────────────── Alpha Lair floor decorations ───────────────── */

/**
 * Straw bed — a golden-brown oval on the floor. The Alpha's bed (w=3)
 * is larger and more prominent; smaller beds (w=2) dot the room.
 */
function drawStrawBed(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  const rx = w * 0.4;
  const ry = h * 0.35;
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  ctx.save();
  // Shadow underneath
  ctx.fillStyle = 'rgba(20, 14, 4, 0.5)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1, rx + 2, ry + 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Base straw fill
  ctx.fillStyle = p.large ? '#c8a840' : '#b09030';
  ctx.shadowColor = '#806020'; ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Dense straw texture — layered lines radiating from center
  ctx.strokeStyle = '#8a7020';
  ctx.lineWidth = 1;
  const count = p.large ? 40 : 22;
  for (let i = 0; i < count; i++) {
    const angle = rnd() * Math.PI * 2;
    const dist  = rnd() * rx * 0.85;
    const ax = cx + Math.cos(angle) * dist;
    const ay = cy + Math.sin(angle) * dist;
    const len = 3 + rnd() * 8;
    const dir = angle + (rnd() - 0.5) * 1.2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + Math.cos(dir) * len, ay + Math.sin(dir) * len);
    ctx.stroke();
  }
  // Highlight strands (lighter金色)
  ctx.strokeStyle = '#e0c060';
  ctx.lineWidth = 0.7;
  for (let i = 0; i < (p.large ? 14 : 8); i++) {
    const angle = rnd() * Math.PI * 2;
    const dist  = rnd() * rx * 0.7;
    const ax = cx + Math.cos(angle) * dist;
    const ay = cy + Math.sin(angle) * dist;
    const len = 2 + rnd() * 5;
    const dir = angle + (rnd() - 0.5) * 1.0;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + Math.cos(dir) * len, ay + Math.sin(dir) * len);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Claw marks — three parallel scratches on the floor, dark reddish-brown.
 */
function drawClawMark(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  const ang = rnd() * Math.PI * 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(60, 20, 10, 0.7)';
  ctx.lineWidth = 1.2;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 2, 0);
    ctx.quadraticCurveTo(i * 2 + 1, -4, i * 2 + 2, -8);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Scattered armour piece — a metallic grey breastplate/helmet silhouette.
 */
function drawArmor(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  ctx.save();
  ctx.shadowBlur = 0;
  // Base shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(cx - 5, cy - 3, 10, 6);
  // Armour body
  ctx.fillStyle = '#6a6a7a';
  ctx.fillRect(cx - 4, cy - 2, 8, 4);
  // Highlight
  ctx.fillStyle = '#8888a0';
  ctx.fillRect(cx - 3, cy - 1, 3, 2);
  ctx.fillRect(cx + 1, cy - 1, 2, 2);
  // Dark trim
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(cx - 4, cy - 2, 8, 1);
  ctx.restore();
}

/**
 * Animal bones — small white/grey bone shapes on the floor.
 */
function drawBones(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  ctx.save();
  ctx.shadowBlur = 0;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(cx - 4, cy - 2, 8, 4);
  // Bone
  ctx.fillStyle = '#c8c0b0';
  const ang = rnd() * Math.PI * 2;
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.fillRect(-3, -1, 6, 2);
  // Bone knobs at ends
  ctx.fillRect(-4, -2, 2, 4);
  ctx.fillRect(2, -2, 2, 4);
  ctx.restore();
}

/** 5×5 tree (back layer) — trunk, branches, shadow. Drawn BEFORE player. */
function drawTreeTrunkBack(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h - 2;  // Bottom of the tree (ground level)
  const trunkH = h * 0.65;  // Tall trunk
  const canopyR = Math.min(w, h) * 0.32;  // Smaller, more proportional canopy
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  const t = (typeof state !== 'undefined' ? state.time : 0) || 0;
  
  ctx.save();
  ctx.shadowBlur = 0;

  // Drop shadow under canopy
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy + 2, canopyR * 0.85, canopyR * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // ===== MASSIVE ANCIENT TRUNK (24px base, gnarled) =====
  ctx.fillStyle = '#3a2818';
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.lineTo(cx + 12, cy);
  ctx.lineTo(cx + 5, cy - trunkH);
  ctx.lineTo(cx - 5, cy - trunkH);
  ctx.closePath();
  ctx.fill();

  // Warm highlight side
  ctx.fillStyle = '#5a3e28';
  ctx.beginPath();
  ctx.moveTo(cx - 2, cy);
  ctx.lineTo(cx + 8, cy);
  ctx.lineTo(cx + 3.5, cy - trunkH);
  ctx.lineTo(cx - 1, cy - trunkH);
  ctx.closePath();
  ctx.fill();

  // Root bulges at the base
  ctx.fillStyle = '#3a2818';
  for (let i = 0; i < 4; i++) {
    const rx = cx - 10 + i * 7 + rnd() * 2;
    const ry = cy + rnd() * 2;
    const rw = 5 + rnd() * 7;
    const rh = 3 + rnd() * 3;
    ctx.beginPath();
    ctx.ellipse(rx, ry, rw, rh, rnd() * 0.4 - 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gnarled bark texture — thick dark streaks
  ctx.strokeStyle = 'rgba(25, 14, 8, 0.55)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 10; i++) {
    const bx = cx - 10 + i * 2.4 + rnd() * 0.5;
    const by1 = cy - trunkH + rnd() * 6;
    const by2 = cy - rnd() * 4;
    ctx.beginPath();
    ctx.moveTo(bx, by1);
    const cp = (by1 + by2) / 2 + rnd() * 6 - 3;
    ctx.quadraticCurveTo(bx + rnd() * 2 - 1, cp, bx + rnd() * 0.6 - 0.3, by2);
    ctx.stroke();
  }

  // ===== BRANCHES (FROM UPPER TRUNK) =====
  // Main branches radiating outward and slightly upward
  ctx.strokeStyle = '#5a4234';
  ctx.lineWidth = 2.4;
  const branchStarts = [
    { y: cy - trunkH * 0.2, angle: -2.2, dist: 7 },
    { y: cy - trunkH * 0.4, angle: -1.8, dist: 8 },
    { y: cy - trunkH * 0.5, angle: 0.2, dist: 8.5 },
    { y: cy - trunkH * 0.35, angle: 0.7, dist: 7.5 },
  ];
  
  for (const bs of branchStarts) {
    const angle = bs.angle;
    const dist = bs.dist;
    const bx = cx + Math.cos(angle) * dist;
    const by = bs.y + Math.sin(angle) * dist * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx, bs.y);
    ctx.lineTo(bx, by);
    ctx.stroke();
    
    // Sub-branches off main branches
    for (let j = 0; j < 2; j++) {
      const sbx = bx + (j === 0 ? -3.5 : 2.5) + rnd() * 1.5;
      const sby = by + rnd() * 2.5 - 0.5;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(sbx, sby);
      ctx.stroke();
      ctx.lineWidth = 2.4;
    }
  }

  ctx.restore();
}

/** 5×5 tree canopy (front layer) — foliage only. Drawn AFTER player. */
function drawTreeCanopyFront(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h - 2;
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  const t = (typeof state !== 'undefined' ? state.time : 0) || 0;

  ctx.save();

  const trunkH = h * 0.65;
  const canopyR = Math.min(w, h) * 0.32;
  const leafDark = '#3d7a2f';
  const leafMid = '#4a8c3a';
  const leafBright = '#6ec050';
  const leafAccent = '#8dd968';
  const canopyTop = cy - trunkH - canopyR * 0.3;

  // Foliage clusters (semi-transparent so player shows through)
  ctx.globalAlpha = 0.60;
  const patches1 = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < patches1; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * canopyR * 0.80;
    const lx = cx + Math.cos(a) * d;
    const ly = canopyTop + Math.sin(a) * d * 0.55;
    const r = 7 + rnd() * 11;
    ctx.fillStyle = rnd() < 0.3 ? leafMid : leafDark;
    ctx.beginPath();
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.72;
  const patches2 = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < patches2; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * canopyR * 0.55;
    const lx = cx + Math.cos(a) * d;
    const ly = canopyTop + Math.sin(a) * d * 0.48;
    const r = 5 + rnd() * 9;
    const col = rnd();
    if (col < 0.4) ctx.fillStyle = leafDark;
    else if (col < 0.7) ctx.fillStyle = leafMid;
    else if (col < 0.85) ctx.fillStyle = leafBright;
    else ctx.fillStyle = leafAccent;
    ctx.beginPath();
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.55;
  const patches3 = 3 + Math.floor(rnd() * 2);
  for (let i = 0; i < patches3; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * canopyR * 0.40;
    const lx = cx + Math.cos(a) * d;
    const ly = canopyTop - canopyR * 0.15 + Math.sin(a) * d * 0.40;
    const r = 3.5 + rnd() * 6;
    ctx.fillStyle = rnd() < 0.5 ? leafBright : leafAccent;
    ctx.beginPath();
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Paint the back layer (trunk, branches, shadow) of every tree prop.
 * Must be called BEFORE drawPlayer so the player walks in front of the trunk.
 */
export function drawTreeTrunkBackPass(ctx) {
  if (!state.libraryProps) return;
  for (const p of state.libraryProps) {
    if (p.kind !== 'tree') continue;
    const px = p.tx * TILE;
    const py = p.ty * TILE;
    drawTreeTrunkBack(ctx, px, py, p.w * TILE, p.h * TILE, p);
  }
}

/**
 * Paint the front layer (foliage canopy) of every tree prop.
 * Must be called AFTER drawPlayer so the player appears behind the leaves.
 */
export function drawTreeCanopyFrontPass(ctx) {
  if (!state.libraryProps) return;
  for (const p of state.libraryProps) {
    if (p.kind !== 'tree') continue;
    const px = p.tx * TILE;
    const py = p.ty * TILE;
    drawTreeCanopyFront(ctx, px, py, p.w * TILE, p.h * TILE, p);
  }
}

/**
 * Large exposed tree root for the Claro Solar puzzle — 1×1 walkable
 * "bumps" scattered around the tree. Painted as organic, gnarled wood
 * that rises from beneath the soil.
 */
function drawTreeRoot(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };

  ctx.save();

  // Root is a gnarled, organic knob rising from the ground
  const rootColor = '#3a2818';
  const rootHi = '#5a4838';
  const rootShadow = '#2a1810';

  // Drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 2.5, 5, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Main root body — knobbly, irregular shape (not a perfect circle)
  ctx.fillStyle = rootColor;
  ctx.beginPath();
  const bumps = 6;
  for (let i = 0; i < bumps; i++) {
    const a = (i / bumps) * Math.PI * 2;
    const r = 4.5 + Math.sin(a * 2.7 + (p.seed || 0) * 0.001) * 1.8;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.65;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // Highlight stripe on one side (shows dimension)
  ctx.fillStyle = rootHi;
  ctx.beginPath();
  ctx.ellipse(cx - 1.5, cy - 1.5, 3.5, 2.5, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Shadow ridge on the opposite side (depth)
  ctx.fillStyle = rootShadow;
  ctx.beginPath();
  ctx.ellipse(cx + 1.5, cy + 1.5, 2.5, 1.5, 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Rough wood texture — tiny cracks and growth rings
  ctx.strokeStyle = 'rgba(40, 20, 10, 0.4)';
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 3; i++) {
    const startA = rnd() * Math.PI * 2;
    const endA = startA + (rnd() * 0.8 + 0.4);
    const startR = rnd() * 3 + 1;
    const endR = rnd() * 3 + 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(startA) * startR, cy + Math.sin(startA) * startR * 0.65);
    ctx.lineTo(cx + Math.cos(endA) * endR, cy + Math.sin(endA) * endR * 0.65);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Walkable 7×7 constellation ring painted under the telescope. Dark base
 * (so the player silhouette pops), a few concentric thin rings in pale
 * cyan, and a scattering of small "stars" — fixed positions seeded by
 * `p.seed` so the pattern is stable across frames but unique per floor.
 */
function drawConstellationRing(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  const R  = Math.min(w, h) * 0.46;
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };

  ctx.save();

  // Dark disc base — fully opaque at the centre so the underlying floor
  // cobbles don't leak through and clutter the constellation. Fades out
  // at the rim so the edge blends with the surrounding floor.
  const base = ctx.createRadialGradient(cx, cy, 1, cx, cy, R);
  base.addColorStop(0,    'rgba(12, 18, 36, 1.00)');
  base.addColorStop(0.55, 'rgba(10, 16, 32, 0.96)');
  base.addColorStop(0.85, 'rgba(10, 16, 28, 0.72)');
  base.addColorStop(1,    'rgba(10, 16, 28, 0)');
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // Three concentric thin rings (pale cyan).
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.42)';
  ctx.lineWidth   = 0.8;
  for (let i = 0; i < 3; i++) {
    const r = R * (0.35 + i * 0.18);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Cardinal tick marks along the outer ring (N/E/S/W).
  ctx.strokeStyle = 'rgba(220, 240, 255, 0.7)';
  ctx.lineWidth   = 1;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const r1 = R * 0.78;
    const r2 = R * 0.92;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.stroke();
  }

  // Star dots scattered inside the ring.
  const STARS = 18;
  for (let i = 0; i < STARS; i++) {
    const ang = rnd() * Math.PI * 2;
    const rad = (0.10 + rnd() * 0.82) * R;
    const sx  = cx + Math.cos(ang) * rad;
    const sy  = cy + Math.sin(ang) * rad;
    const sz  = 0.6 + rnd() * 1.4;
    // Small halo for the brighter ones.
    if (sz > 1.4) {
      const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, sz * 3);
      halo.addColorStop(0, 'rgba(220, 240, 255, 0.55)');
      halo.addColorStop(1, 'rgba(220, 240, 255, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(sx, sy, sz * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(240, 248, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(sx, sy, sz, 0, Math.PI * 2);
    ctx.fill();
  }

  // Connect a handful of stars with thin lines so it reads as a
  // constellation rather than random dots.
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.32)';
  ctx.lineWidth   = 0.6;
  s = (p.seed | 0) || 1;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const r = (0.20 + rnd() * 0.70) * R;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.restore();
}

/**
 * Brass telescope on a tripod, occupying a 3×3 footprint. Tube is angled
 * up-right toward the skylight; tripod legs splay outward. A faint
 * starlight glow leaks from the eyepiece.
 */
function drawTelescope(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  const t  = (typeof state !== 'undefined' ? state.time : 0) || 0;

  ctx.save();

  // Soft halo on the floor below the telescope (so it reads as a
  // luminous instrument even when the lighting overlay is harsh).
  const halo = ctx.createRadialGradient(cx, cy + h * 0.25, 4, cx, cy + h * 0.25, w * 0.55);
  halo.addColorStop(0, 'rgba(140, 180, 255, 0.30)');
  halo.addColorStop(1, 'rgba(20, 40, 80, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy + h * 0.25, w * 0.55, 0, Math.PI * 2);
  ctx.fill();

  // Tripod base — three legs from a central hub down to the floor.
  ctx.strokeStyle = '#3a2818';
  ctx.lineWidth   = 3;
  const hubX = cx;
  const hubY = cy + h * 0.15;
  const legs = [
    { x: cx - w * 0.32, y: py + h - 4 },
    { x: cx + w * 0.32, y: py + h - 4 },
    { x: cx,            y: py + h - 4 },
  ];
  for (const lg of legs) {
    ctx.beginPath();
    ctx.moveTo(hubX, hubY);
    ctx.lineTo(lg.x, lg.y);
    ctx.stroke();
  }
  // Leg feet.
  ctx.fillStyle = '#221408';
  for (const lg of legs) ctx.fillRect(lg.x - 2, lg.y - 2, 4, 3);

  // Tripod hub: dark iron ball.
  ctx.fillStyle = '#1c1208';
  ctx.beginPath();
  ctx.arc(hubX, hubY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Brass tube — angled up-right from the hub.
  const angle  = -Math.PI / 3.2; // ~56° above horizontal, tilted right
  const tubeLen = w * 0.72;
  const tubeR   = h * 0.10;
  const ex = hubX + Math.cos(angle) * tubeLen; // eyepiece end (lower-left)
  const ey = hubY + Math.sin(angle) * tubeLen;
  const ox = hubX - Math.cos(angle) * tubeLen * 0.25; // opposite end (the "down" stub near hub)
  const oy = hubY - Math.sin(angle) * tubeLen * 0.25;

  // Tube body as a thick stroke with brass gradient effect.
  const grad = ctx.createLinearGradient(
    hubX + Math.sin(angle) * tubeR,
    hubY - Math.cos(angle) * tubeR,
    hubX - Math.sin(angle) * tubeR,
    hubY + Math.cos(angle) * tubeR,
  );
  grad.addColorStop(0,    '#d4a04c');
  grad.addColorStop(0.5,  '#a87830');
  grad.addColorStop(1,    '#5a3818');
  ctx.strokeStyle = grad;
  ctx.lineWidth   = tubeR * 2;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  // Brass rings around the tube.
  ctx.strokeStyle = '#3a2410';
  ctx.lineWidth   = 1.2;
  for (let i = 0.25; i <= 0.85; i += 0.20) {
    const rx = hubX + Math.cos(angle) * tubeLen * i;
    const ry = hubY + Math.sin(angle) * tubeLen * i;
    ctx.beginPath();
    ctx.moveTo(rx + Math.sin(angle) * tubeR, ry - Math.cos(angle) * tubeR);
    ctx.lineTo(rx - Math.sin(angle) * tubeR, ry + Math.cos(angle) * tubeR);
    ctx.stroke();
  }

  // Eyepiece (small cylinder at the lower-left end).
  ctx.fillStyle = '#2a1808';
  ctx.beginPath();
  ctx.arc(ex, ey, tubeR * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#caa050';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ex, ey, tubeR * 0.85, 0, Math.PI * 2);
  ctx.stroke();

  // Lens aperture at the upper-right end — glowing starlight.
  const apX = hubX + Math.cos(angle) * tubeLen * 1.06;
  const apY = hubY + Math.sin(angle) * tubeLen * 1.06;
  const lensPulse = 0.55 + Math.sin(t * 1.7) * 0.20;
  const lensHalo = ctx.createRadialGradient(apX, apY, 0, apX, apY, tubeR * 3.2);
  lensHalo.addColorStop(0, `rgba(220, 230, 255, ${0.70 * lensPulse})`);
  lensHalo.addColorStop(1, 'rgba(220, 230, 255, 0)');
  ctx.fillStyle = lensHalo;
  ctx.beginPath();
  ctx.arc(apX, apY, tubeR * 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8eeff';
  ctx.beginPath();
  ctx.arc(apX, apY, tubeR * 0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Slim 1×1 stone obelisk with a glowing blue crystal capstone — used as
 * a corner pillar inside the Observatorio.
 */
function drawStarObelisk(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const t  = (typeof state !== 'undefined' ? state.time : 0) || 0;
  const baseY = py + h - 2;
  const topY  = py + 4;

  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.34, baseY);
  ctx.lineTo(cx + w * 0.34, baseY);
  ctx.lineTo(cx + w * 0.18, topY);
  ctx.lineTo(cx - w * 0.18, topY);
  ctx.closePath();
  ctx.fill();

  // Stone body (tapered).
  const stoneGrad = ctx.createLinearGradient(px, py, px + w, py + h);
  stoneGrad.addColorStop(0, '#4a4458');
  stoneGrad.addColorStop(1, '#2a2438');
  ctx.fillStyle = stoneGrad;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.32, baseY);
  ctx.lineTo(cx + w * 0.32, baseY);
  ctx.lineTo(cx + w * 0.16, topY);
  ctx.lineTo(cx - w * 0.16, topY);
  ctx.closePath();
  ctx.fill();

  // Vertical highlight stripe.
  ctx.fillStyle = 'rgba(180, 180, 220, 0.20)';
  ctx.fillRect(cx - 1, topY, 2, baseY - topY);

  // Capstone crystal (small glowing gem) — the visible source of the
  // room's starlight, so we lean into the halo a bit.
  const pulse = 0.7 + Math.sin(t * 2.4 + (p.seed || 0)) * 0.25;
  const slow  = 0.6 + Math.sin(t * 0.9 + (p.seed || 0) * 0.5) * 0.40;
  const gemX = cx;
  const gemY = topY - 1;
  const gemR = 2.6;
  // Wide outer aura (very soft, slow pulse).
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const aura = ctx.createRadialGradient(gemX, gemY, 0, gemX, gemY, gemR * 8);
  aura.addColorStop(0,   `rgba(180, 210, 255, ${0.30 * slow})`);
  aura.addColorStop(0.5, `rgba(140, 180, 255, ${0.12 * slow})`);
  aura.addColorStop(1,   'rgba(40, 80, 160, 0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(gemX, gemY, gemR * 8, 0, Math.PI * 2);
  ctx.fill();
  // Tight inner halo.
  const halo = ctx.createRadialGradient(gemX, gemY, 0, gemX, gemY, gemR * 4);
  halo.addColorStop(0, `rgba(180, 220, 255, ${0.75 * pulse})`);
  halo.addColorStop(1, 'rgba(40, 80, 160, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(gemX, gemY, gemR * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Solid gem core with bright highlight.
  ctx.fillStyle = '#d8ecff';
  ctx.beginPath();
  ctx.arc(gemX, gemY, gemR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(gemX - 0.6, gemY - 0.8, gemR * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Floor dais painted at the centre of the Sala de la Llave. Concentric
 * rune circles in cool blue, with a small lock glyph at the centre.
 * Walkable — drawn into the map cache so it doesn't redraw every frame.
 */
function drawKeyDais(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  const r0 = Math.min(w, h) * 0.46;
  const r1 = r0 * 0.72;
  const r2 = r0 * 0.42;
  // Outer dim ring.
  ctx.strokeStyle = 'rgba(150, 190, 240, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r0, 0, Math.PI * 2); ctx.stroke();
  // Mid bright ring.
  ctx.strokeStyle = 'rgba(180, 220, 255, 0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx, cy, r1, 0, Math.PI * 2); ctx.stroke();
  // Inner ring.
  ctx.strokeStyle = 'rgba(220, 240, 255, 0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r2, 0, Math.PI * 2); ctx.stroke();
  // Eight tick marks between mid and outer ring.
  ctx.strokeStyle = 'rgba(200, 230, 255, 0.55)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const x0 = cx + Math.cos(a) * r1;
    const y0 = cy + Math.sin(a) * r1;
    const x1 = cx + Math.cos(a) * r0;
    const y1 = cy + Math.sin(a) * r0;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  // Centre keyhole glyph.
  ctx.fillStyle = 'rgba(220, 240, 255, 0.85)';
  ctx.beginPath(); ctx.arc(cx, cy - 2, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx - 0.8, cy - 1, 1.6, 5);
}

/**
 * Floor pedestal painted under the Archivo Prohibido legendary chest.
 * A square stone slab with a warm orange rune ring around it.
 */
function drawArchivePedestal(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  const size = Math.min(w, h) * 0.78;

  // Stone slab.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(cx - size / 2 + 1, cy - size / 2 + 1, size, size);
  const grad = ctx.createLinearGradient(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);
  grad.addColorStop(0, '#4a4030');
  grad.addColorStop(1, '#2a2418');
  ctx.fillStyle = grad;
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
  ctx.fillStyle = 'rgba(255, 200, 130, 0.18)';
  ctx.fillRect(cx - size / 2, cy - size / 2, size, 2);

  // Rune ring around the slab — blood-red for a forbidden vault.
  ctx.strokeStyle = 'rgba(200, 40, 40, 0.7)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.78, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(180, 60, 50, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.95, 0, Math.PI * 2); ctx.stroke();
}

/**
 * Paint a rune-locked door on a corridor tile. Iron-bound oak panel with
 * a glowing rune lock in the centre. Drawn into the map cache, so the
 * "glow" here is static — the live pulse hint is drawn per-frame in
 * keyRoom.js (drawArchiveDoorPrompt).
 */
function drawLockedDoor(ctx, px, py) {
  // Slightly inset frame so the corridor floor texture frames the door.
  const x = px + 2;
  const y = py + 2;
  const w = TILE - 4;
  const h = TILE - 4;

  // Iron studs strip across top and bottom.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(px, py, TILE, TILE);

  // Oak panel.
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#5a3818');
  grad.addColorStop(1, '#2a1808');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Plank divides.
  ctx.fillStyle = '#1a0e04';
  ctx.fillRect(x + w / 2 - 1, y, 2, h);
  // Iron bands.
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x, y + 4, w, 3);
  ctx.fillRect(x, y + h - 7, w, 3);
  // Rivets.
  ctx.fillStyle = '#3a3a3a';
  for (const ry of [y + 5.5, y + h - 5.5]) {
    for (let i = 0; i < 4; i++) {
      const rx = x + 3 + i * (w / 4);
      ctx.fillRect(rx - 1, ry - 1, 2, 2);
    }
  }

  // Rune lock circle in the centre — glowing orange.
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.strokeStyle = 'rgba(255, 180, 80, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 220, 130, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.stroke();
  // Cross inside the rune.
  ctx.fillStyle = 'rgba(255, 230, 160, 0.95)';
  ctx.fillRect(cx - 0.6, cy - 4, 1.2, 8);
  ctx.fillRect(cx - 4, cy - 0.6, 8, 1.2);
}

/** Tall bookshelf full of leaning books. Orientation follows p.orient. */
function drawShelf(ctx, px, py, w, h, p) {
  const horiz = p.orient === 'h';
  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(px + 2, py + 3, w - 2, h - 2);
  // Wood frame.
  ctx.fillStyle = '#3a2412';
  ctx.fillRect(px + 1, py + 1, w - 2, h - 2);
  // Inner cavity (where the books sit).
  ctx.fillStyle = '#1a0e08';
  const ix = px + 3, iy = py + 3, iw = w - 6, ih = h - 6;
  ctx.fillRect(ix, iy, iw, ih);
  // Wood top/bottom highlights.
  ctx.fillStyle = '#5a3818';
  ctx.fillRect(px + 1, py + 1, w - 2, 2);
  ctx.fillStyle = '#1c1108';
  ctx.fillRect(px + 1, py + h - 3, w - 2, 2);

  // Books — each shelf has 1-2 internal rows depending on size.
  const colors = ['#8a3010', '#3a3060', '#2a5a30', '#604010', '#5a2a48', '#2a4060'];
  // Deterministic pseudo-rng from p.seed.
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };

  if (horiz) {
    // Horizontal shelf: a single row of vertical books across the cavity.
    const rows = Math.max(1, Math.floor(ih / 14));
    const rowH = ih / rows;
    for (let r = 0; r < rows; r++) {
      const ry = iy + r * rowH;
      let x = ix + 1;
      while (x < ix + iw - 1) {
        const bw = 3 + Math.floor(rnd() * 3);
        const bh = rowH - 2 - Math.floor(rnd() * 3);
        ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
        ctx.fillRect(x, ry + (rowH - bh) - 1, bw, bh);
        // Page edge.
        ctx.fillStyle = 'rgba(220,200,160,0.35)';
        ctx.fillRect(x, ry + (rowH - bh) - 1, bw, 1);
        x += bw + 1;
      }
      // Shelf board between rows.
      if (r < rows - 1) {
        ctx.fillStyle = '#4a2c14';
        ctx.fillRect(ix, ry + rowH - 1, iw, 1);
      }
    }
  } else {
    // Vertical shelf: shelves stacked top to bottom.
    const rows = Math.max(2, Math.floor(ih / 14));
    const rowH = ih / rows;
    for (let r = 0; r < rows; r++) {
      const ry = iy + r * rowH + 1;
      let x = ix + 1;
      while (x < ix + iw - 1) {
        const bw = 3 + Math.floor(rnd() * 3);
        const bh = rowH - 3 - Math.floor(rnd() * 2);
        ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
        ctx.fillRect(x, ry + (rowH - bh) - 2, bw, bh);
        ctx.fillStyle = 'rgba(220,200,160,0.35)';
        ctx.fillRect(x, ry + (rowH - bh) - 2, bw, 1);
        x += bw + 1;
      }
      ctx.fillStyle = '#4a2c14';
      ctx.fillRect(ix, ry + rowH - 2, iw, 1);
    }
  }

  // Front rim highlight.
  ctx.strokeStyle = 'rgba(140, 90, 40, 0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 1.5, py + 1.5, w - 3, h - 3);
}

/** Dark archive shelf — same shape as a regular shelf but with dark
 *  wood and muted, shadowy books to match the forbidden vault mood. */
function drawArchiveShelf(ctx, px, py, w, h, p) {
  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(px + 2, py + 3, w - 2, h - 2);
  // Dark wood frame.
  ctx.fillStyle = '#1a0e08';
  ctx.fillRect(px + 1, py + 1, w - 2, h - 2);
  // Inner cavity.
  ctx.fillStyle = '#0a0504';
  const ix = px + 3, iy = py + 3, iw = w - 6, ih = h - 6;
  ctx.fillRect(ix, iy, iw, ih);
  // Wood top highlight (dim).
  ctx.fillStyle = '#2a1808';
  ctx.fillRect(px + 1, py + 1, w - 2, 2);
  ctx.fillStyle = '#0c0704';
  ctx.fillRect(px + 1, py + h - 3, w - 2, 2);

  // Dark, muted books — dark reds, deep purples, near-black.
  const colors = ['#2a0808', '#1a0820', '#0a2010', '#1a1008', '#200818', '#0a1020'];
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };

  // Only horizontal shelves used by the archive.
  const rows = Math.max(1, Math.floor(ih / 14));
  const rowH = ih / rows;
  for (let r = 0; r < rows; r++) {
    const ry = iy + r * rowH;
    let x = ix + 1;
    while (x < ix + iw - 1) {
      const bw = 3 + Math.floor(rnd() * 3);
      const bh = rowH - 2 - Math.floor(rnd() * 3);
      ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
      ctx.fillRect(x, ry + (rowH - bh) - 1, bw, bh);
      // No page edge — the books are too dark to show one.
      x += bw + 1;
    }
    if (r < rows - 1) {
      ctx.fillStyle = '#1a0c04';
      ctx.fillRect(ix, ry + rowH - 1, iw, 1);
    }
  }
}

/** Reading table — intact or toppled. Wood top with carved edge. */
function drawTable(ctx, px, py, w, h, p, broken) {
  // Drop shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(px + 2, py + 3, w - 2, h - 2);

  if (broken) {
    // Splintered planks lying on the floor: a couple of angled boards
    // plus a few debris dots.
    ctx.save();
    ctx.translate(px + w / 2, py + h / 2);
    ctx.rotate(-0.15);
    ctx.fillStyle = '#5a3a1c';
    ctx.fillRect(-w * 0.42, -3, w * 0.84, 6);
    ctx.fillStyle = '#3a2412';
    ctx.fillRect(-w * 0.42, 2,  w * 0.84, 1);
    ctx.fillStyle = '#7a5028';
    ctx.fillRect(-w * 0.40, -3, w * 0.80, 1);
    ctx.restore();
    ctx.save();
    ctx.translate(px + w / 2 + 4, py + h / 2 + 5);
    ctx.rotate(0.35);
    ctx.fillStyle = '#5a3a1c';
    ctx.fillRect(-w * 0.30, -2, w * 0.60, 4);
    ctx.fillStyle = '#7a5028';
    ctx.fillRect(-w * 0.30, -2, w * 0.60, 1);
    ctx.restore();
    // Splinters.
    ctx.fillStyle = 'rgba(60, 40, 20, 0.85)';
    for (let i = 0; i < 5; i++) {
      const sx = px + 4 + Math.random() * (w - 8);
      const sy = py + 4 + Math.random() * (h - 8);
      ctx.fillRect(sx, sy, 2, 1);
    }
    return;
  }

  // Intact table: top + 4 leg shadows + a book/paper on top.
  // Legs (corner shadows).
  ctx.fillStyle = '#1a0e08';
  ctx.fillRect(px + 2,         py + h - 4, 4, 3);
  ctx.fillRect(px + w - 6,     py + h - 4, 4, 3);
  // Tabletop.
  ctx.fillStyle = '#6a4220';
  ctx.fillRect(px + 1, py + 1, w - 2, h - 4);
  // Top highlight.
  ctx.fillStyle = '#8a5a30';
  ctx.fillRect(px + 1, py + 1, w - 2, 2);
  // Bottom edge shadow.
  ctx.fillStyle = '#3a2412';
  ctx.fillRect(px + 1, py + h - 5, w - 2, 1);
  // Wood grain.
  ctx.strokeStyle = 'rgba(60, 30, 10, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px + 3, py + 5);  ctx.lineTo(px + w - 3, py + 5);
  ctx.moveTo(px + 3, py + 9);  ctx.lineTo(px + w - 3, py + 9);
  ctx.stroke();

  // Open book on the table (deterministic via seed).
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
  if (rnd() < 0.7) {
    const bx = px + 4 + Math.floor(rnd() * Math.max(1, w - 16));
    const by = py + 3 + Math.floor(rnd() * Math.max(1, h - 12));
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(bx + 1, by + 1, 10, 6);
    ctx.fillStyle = '#d8c890';
    ctx.fillRect(bx, by, 10, 6);
    ctx.fillStyle = '#3a2810';
    ctx.fillRect(bx + 4, by, 1, 6);
    ctx.fillStyle = 'rgba(60,40,12,0.65)';
    ctx.fillRect(bx + 1, by + 2, 3, 1);
    ctx.fillRect(bx + 6, by + 2, 3, 1);
    ctx.fillRect(bx + 1, by + 4, 2, 1);
    ctx.fillRect(bx + 6, by + 4, 3, 1);
  }
}

/** Painted summoning circle: dark glyph ring + rune dots inside a 2x2 area. */
function drawSummoningCircle(ctx, px, py, w, h, p) {
  const cx = px + w / 2;
  const cy = py + h / 2;
  const r  = Math.min(w, h) * 0.46;
  let s = (p.seed | 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };

  ctx.save();
  // Subtle dark base disk (paint over floor) so the runes pop.
  ctx.fillStyle = 'rgba(20, 14, 30, 0.45)';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.fill();
  // Outer painted ring (purple).
  ctx.strokeStyle = 'rgba(184, 144, 255, 0.85)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // Inner thinner ring.
  ctx.strokeStyle = 'rgba(220, 180, 255, 0.65)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
  ctx.stroke();
  // Inscribed pentagram-ish star (5 strokes between 5 points on outer ring).
  const points = [];
  for (let i = 0; i < 5; i++) {
    const ang = -Math.PI / 2 + i * (Math.PI * 2 / 5);
    points.push({ x: cx + Math.cos(ang) * (r - 1), y: cy + Math.sin(ang) * (r - 1) });
  }
  ctx.strokeStyle = 'rgba(184, 144, 255, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = points[i];
    const b = points[(i + 2) % 5];
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // Rune dots on the outer ring.
  ctx.fillStyle = 'rgba(220, 180, 255, 0.80)';
  for (let i = 0; i < 8; i++) {
    const ang = i * (Math.PI / 4) + rnd() * 0.1;
    const dx = cx + Math.cos(ang) * (r - 1);
    const dy = cy + Math.sin(ang) * (r - 1);
    ctx.fillRect(dx - 0.5, dy - 0.5, 1.5, 1.5);
  }
  // Cracks on the floor under the circle.
  ctx.strokeStyle = 'rgba(40, 24, 14, 0.55)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2;
    const x1 = cx + Math.cos(a) * (r * 0.3);
    const y1 = cy + Math.sin(a) * (r * 0.3);
    const x2 = cx + Math.cos(a) * (r * 0.95);
    const y2 = cy + Math.sin(a) * (r * 0.95);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Per-frame pulse on the cross of awakable (cracked) sarcophagi. The
 * cross is already painted blue in the cache; here we add a soft halo
 * and a brighter pulse on top so the player can spot 'this one is alive'.
 */
export function drawSarcophagiOverlay(ctx) {
  if (!state.sarcophagi || state.sarcophagi.length === 0) return;
  const t = state.time;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of state.sarcophagi) {
    if (!s.awakable || s.awakened) continue;
    if (s._crossX == null) continue;       // cache hasn't painted it yet
    const cx = s._crossX - state.cameraX;
    const cy = s._crossY - state.cameraY;
    if (cx < -20 || cx > VIEW_W + 20 || cy < -20 || cy > VIEW_H + 20) continue;
    const pulse = 0.55 + Math.sin(t * 1.8 + (s.tx + s.ty) * 0.4) * 0.35;
    // Soft halo behind the cross.
    const grd = ctx.createRadialGradient(cx, cy, 1, cx, cy, 14);
    grd.addColorStop(0, `rgba(140, 200, 255, ${0.55 * pulse})`);
    grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grd;
    ctx.fillRect(cx - 14, cy - 14, 28, 28);
    // Bright pulse on the cross arms.
    ctx.fillStyle = `rgba(190, 220, 255, ${0.9 * pulse})`;
    ctx.fillRect(cx - 1, cy - 5, 2, 11);
    ctx.fillRect(cx - 4, cy - 1, 8, 2);
  }
  ctx.restore();
}

/**
 * Per-frame overlay for the library Great-Library set-piece:
 *   - Pulsing purple halo on the rune circle (always while alive).
 *   - Floating rune stones around the circle (with bob & sigil glow),
 *     animated inward when the event starts (`librarySetPiece.js` moves
 *     their world coords each frame).
 */
export function drawLibrarySetPiece(ctx) {
  const sp = state.librarySetPiece;
  if (!sp) return;

  const t  = state.time;
  const cx = (sp.circle.tx + sp.circle.w / 2) * TILE - state.cameraX;
  const cy = (sp.circle.ty + sp.circle.h / 2) * TILE - state.cameraY;

  // Halo on the circle (skip once the encounter is completed).
  if (!sp.completed) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.55 + Math.sin(t * 2.2) * 0.35;
    const grd = ctx.createRadialGradient(cx, cy, 1, cx, cy, 36);
    grd.addColorStop(0, `rgba(184, 144, 255, ${0.55 * pulse})`);
    grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grd;
    ctx.fillRect(cx - 36, cy - 36, 72, 72);
    ctx.restore();
  }

  // Rune stones (hidden once the guardian has materialised).
  if (sp.stones && !sp.stonesHidden) {
    ctx.save();
    for (const s of sp.stones) {
      const sx = s.x - state.cameraX;
      const sy = s.y - state.cameraY;
      if (sx < -20 || sx > VIEW_W + 20 || sy < -20 || sy > VIEW_H + 20) continue;
      const bob = Math.sin(t * 2 + s.phase) * 2;
      // Drop shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 7, 7, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Stone body (hex-ish shape, dark grey with purple sheen).
      ctx.fillStyle = '#3a3540';
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy - 2 + bob);
      ctx.lineTo(sx - 3, sy - 6 + bob);
      ctx.lineTo(sx + 3, sy - 6 + bob);
      ctx.lineTo(sx + 5, sy - 2 + bob);
      ctx.lineTo(sx + 3, sy + 4 + bob);
      ctx.lineTo(sx - 3, sy + 4 + bob);
      ctx.closePath();
      ctx.fill();
      // Top highlight.
      ctx.fillStyle = '#5a4a68';
      ctx.beginPath();
      ctx.moveTo(sx - 3, sy - 6 + bob);
      ctx.lineTo(sx + 3, sy - 6 + bob);
      ctx.lineTo(sx + 2, sy - 4 + bob);
      ctx.lineTo(sx - 2, sy - 4 + bob);
      ctx.closePath();
      ctx.fill();
      // Glowing rune (pulses).
      const pulse = 0.55 + 0.45 * Math.sin(t * 3 + s.phase);
      ctx.fillStyle = `rgba(184, 144, 255, ${pulse})`;
      ctx.shadowColor = '#b890ff';
      ctx.shadowBlur  = 8;
      ctx.fillRect(sx - 1, sy - 3 + bob, 2, 4);
      ctx.fillRect(sx - 2, sy + 0 + bob, 4, 1);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
}

/**
 * Paint the static dark body of a water puddle into the map cache.
 * @private
 */
function drawPuddleBase(ctx, p) {
  ctx.save();
  // Outer dark ring.
  ctx.fillStyle = 'rgba(10, 18, 22, 0.55)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, p.rx + 1.2, p.ry + 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Water body — slightly blue-green.
  ctx.fillStyle = 'rgba(35, 60, 70, 0.78)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Inner gradient for depth.
  const grd = ctx.createRadialGradient(p.x - p.rx * 0.3, p.y - p.ry * 0.4, 1, p.x, p.y, p.rx);
  grd.addColorStop(0, 'rgba(80, 120, 130, 0.35)');
  grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Paint a long jagged ceiling fissure with a bright leaking edge.
 * The crack is a polyline already computed in dungeon.js.
 * Thin moonbeams use a smaller, cooler highlight.
 * @private
 */
function drawCeilingCrack(ctx, sb) {
  const pts = sb.crack;
  if (!pts || pts.length < 2) return;
  const isThin = sb.kind === 'thin';
  const isShrine = sb.kind === 'shrine';
  ctx.save();

  ctx.shadowColor = isThin ? 'rgba(200, 220, 255, 0.45)' : isShrine ? 'rgba(255, 248, 200, 0.85)' : 'rgba(255, 240, 180, 0.55)';
  ctx.shadowBlur  = isThin ? 4 : isShrine ? 16 : 8;
  ctx.strokeStyle = isThin ? 'rgba(220, 235, 255, 0.30)' : isShrine ? 'rgba(255, 252, 220, 0.60)' : 'rgba(255, 245, 200, 0.35)';
  ctx.lineWidth   = isThin ? 2 : isShrine ? 7 : 4;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = 'rgba(8, 6, 4, 0.95)';
  ctx.lineWidth   = isThin ? 1.2 : isShrine ? 4 : 2.2;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();

  ctx.strokeStyle = isThin
    ? 'rgba(220, 240, 255, 0.7)'
    : isShrine
      ? 'rgba(255, 252, 230, 1.0)'
      : 'rgba(255, 248, 210, 0.85)';
  ctx.lineWidth   = isThin ? 0.6 : isShrine ? 1.8 : 0.9;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1] - 0.4);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1] - (isShrine ? 1.2 : 0.4));
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw a single floor cell using the biome's stone palette plus a subtle
 * checker variant and occasional crack.
 * @private
 */
function drawFloorTile(ctx, px, py, x, y, biome, dark) {
  if (dark) {
    ctx.fillStyle = '#181412';
    ctx.fillRect(px, py, TILE, TILE);
    // Subtle unevenness so it doesn't look like a solid black void.
    const hash = (x * 7 + y * 13 + 3) % 7;
    if (hash < 3) {
      ctx.fillStyle = hash === 0 ? '#201c18' : '#141210';
      ctx.fillRect(px + (hash * 5) % 12, py + (hash * 7) % 12, 8, 1);
    }
    return;
  }
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
      // 2-3 fallen books, varied tilt and binding hue, with a faint shadow.
      const colors = ['#8a3010', '#3a3060', '#2a5a30', '#604010', '#5a2a48'];
      const n = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const bx = px + 4 + i * 7 + (rng() - 0.5) * 3;
        const by = py + TILE - 9 + (rng() - 0.5) * 3;
        const w  = 5 + Math.floor(rng() * 2);
        const h  = 5 + Math.floor(rng() * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(bx + 1, by + 1, w, h);
        ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
        ctx.fillRect(bx, by, w, h);
        // Page edge.
        ctx.fillStyle = 'rgba(220,200,160,0.85)';
        ctx.fillRect(bx, by + h - 1, w, 1);
      }
      break;
    }
    case 'paper': {
      // Crumpled parchment scrap with a couple of ink lines.
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(cx - 3, cy - 1, 8, 6);
      ctx.fillStyle = 'rgba(225,205,165,0.85)';
      ctx.fillRect(cx - 4, cy - 2, 8, 6);
      ctx.fillStyle = 'rgba(70,40,12,0.7)';
      ctx.fillRect(cx - 3, cy, 5, 1);
      ctx.fillRect(cx - 3, cy + 2, 4, 1);
      ctx.fillStyle = 'rgba(180,140,60,0.4)';
      ctx.fillRect(cx + 1, cy - 2, 1, 2);
      break;
    }
    case 'pages': {
      // 3-4 loose paper sheets, scattered, slightly translucent.
      for (let i = 0; i < 4; i++) {
        const sx = px + 4 + rng() * (TILE - 10);
        const sy = py + 4 + rng() * (TILE - 10);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(sx + 0.5, sy + 0.5, 5, 4);
        ctx.fillStyle = 'rgba(230,210,170,0.85)';
        ctx.fillRect(sx, sy, 5, 4);
        if (rng() < 0.5) {
          ctx.fillStyle = 'rgba(60,40,10,0.55)';
          ctx.fillRect(sx + 1, sy + 1, 3, 1);
        }
      }
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

  // Torches, sconces, campfires and glowing mushrooms — each emits a
  // radial cut into the ambient overlay, with size and colour by type.
  const tc = (biome && biome.torchColor) || [255, 200, 140];
  for (const lt of state.lights) {
    lt.flicker = (lt.flicker || 0) + 0.15;
    const lx = lt.x - state.cameraX;
    const ly = lt.y - state.cameraY;
    if (lx < -lt.r || lx > VIEW_W + lt.r || ly < -lt.r || ly > VIEW_H + lt.r) continue;

    let color = tc;
    let radius = lt.r;
    if (lt.type === 'campfire') {
      // Big warm ember glow with strong flicker.
      radius = lt.r + Math.sin(lt.flicker) * 10 + Math.sin(lt.flicker * 2.3) * 4;
      color  = [255, 180, 90];
    } else if (lt.type === 'glowMushroom') {
      // Cool, almost steady cyan/teal pulse.
      const pulse = 1 + Math.sin(state.time * 1.6 + (lt.phase || 0)) * 0.18;
      radius = lt.r * pulse;
      color  = lt.variant === 0 ? [120, 230, 200] : [120, 200, 255];
    } else if (lt.type === 'skull') {
      // Skull pedestal: cool blue-white pulse, very steady.
      const pulse = 1 + Math.sin(state.time * 1.3 + (lt.phase || 0)) * 0.12;
      radius = lt.r * pulse;
      color  = [180, 200, 230];
    } else if (lt.type === 'candle') {
      // Steady cool flame: small flicker, cool blue-white pool.
      radius = lt.r + Math.sin(lt.flicker * 0.7) * 2 + Math.sin(lt.flicker * 1.9) * 1;
      color  = [180, 200, 255];
    } else if (lt.type === 'starObelisk') {
      // Magical starlight emitter: wide, steady blue pool with a slow
      // breath so the room feels alive without flickering.
      const pulse = 1 + Math.sin(state.time * 0.9 + (lt.phase || 0)) * 0.08;
      radius = lt.r * pulse;
      color  = lt.color || [180, 210, 255];
    } else if (lt.type === 'altar') {
      // Strong cool altar flame, lively flicker.
      radius = lt.r + Math.sin(lt.flicker * 0.8) * 6 + Math.sin(lt.flicker * 2.1) * 3;
      color  = [170, 210, 255];
    } else if (lt.type === 'magicFlame') {
      // Floating arcane flame: drifts between two anchors with irregular
      // speed, pulses and breathes. Position is updated here so the light
      // pool, the sprite pass and any other consumer see the same xy.
      const t = state.time * lt.speed + lt.phase;
      // Smoothstep-like ease so it slows near the anchors.
      const k = 0.5 - 0.5 * Math.cos(t);
      // Add a small perpendicular wobble so the path is not a straight line.
      const dx = lt.bx - lt.ax;
      const dy = lt.by - lt.ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const wob = Math.sin(state.time * 1.3 + lt.wobble) * 6;
      lt.x = lt.ax + dx * k + nx * wob;
      lt.y = lt.ay + dy * k + ny * wob - 2;
      const pulse = 1 + Math.sin(state.time * 2 + lt.phase) * 0.10;
      radius = lt.r * pulse;
      color  = lt.color || [180, 120, 255];
    } else {
      radius = lt.r + Math.sin(lt.flicker) * 6;
    }

    const grad = lctx.createRadialGradient(lx, ly, 5, lx, ly, radius);
    grad.addColorStop(0,   `rgba(${color[0]},${color[1]},${color[2]},1)`);
    grad.addColorStop(0.6, `rgba(${color[0]},${color[1]},${color[2]},0.5)`);
    grad.addColorStop(1,   'rgba(0,0,0,0)');
    lctx.fillStyle = grad;
    lctx.beginPath();
    lctx.arc(lx, ly, radius, 0, Math.PI * 2);
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
    // Library Guardian: arcane purple aura. Smaller than the final boss
    // but bright enough to act as a beacon across the dim Great Library.
    if (e.type === 'guardian' && !e.dead) {
      const ex = e.x - state.cameraX, ey = e.y - state.cameraY;
      const pulse = 1 + Math.sin(state.time * 1.6) * 0.08;
      const radius = 110 * pulse;
      const grad = lctx.createRadialGradient(ex, ey, 8, ex, ey, radius);
      grad.addColorStop(0,   'rgba(184,144,255,0.55)');
      grad.addColorStop(0.5, 'rgba(150,100,220,0.30)');
      grad.addColorStop(1,   'rgba(80,40,160,0)');
      lctx.fillStyle = grad;
      lctx.beginPath();
      lctx.arc(ex, ey, radius, 0, Math.PI * 2);
      lctx.fill();
    }
  }

  // Sunbeams cut the ambient overlay so the floor under the ceiling crack
  // actually receives sunlight. Each beam carries a deterministic irregular
  // polygon (the crack shape) precomputed at level generation. Thin
  // moonbeams cut a smaller hole.
  if (state.sunbeams && state.sunbeams.length > 0) {
    for (const sb of state.sunbeams) {
      const sx = sb.x - state.cameraX;
      const sy = sb.y - state.cameraY;
      const halfBBox = sb.length * 0.5 + sb.splay + 8;
      if (sx < -halfBBox || sx > VIEW_W + halfBBox) continue;
      if (sy + sb.h < 0 || sy > VIEW_H) continue;

      lctx.save();
      // Clip to the irregular crack shape, then fill with a vertical gradient.
      lctx.beginPath();
      const shape = sb.shape;
      lctx.moveTo(sx + shape[0][0], sy + shape[0][1]);
      for (let i = 1; i < shape.length; i++) {
        lctx.lineTo(sx + shape[i][0], sy + shape[i][1]);
      }
      lctx.closePath();
      lctx.clip();

      const isThin = sb.kind === 'thin';
      const isShrine = sb.kind === 'shrine';
      const grad = lctx.createLinearGradient(0, sy, 0, sy + sb.h);
      if (isThin) {
        grad.addColorStop(0,    'rgba(255,255,255,0.45)');
        grad.addColorStop(0.6,  'rgba(255,255,255,0.20)');
        grad.addColorStop(1,    'rgba(255,255,255,0)');
      } else if (isShrine) {
        grad.addColorStop(0,    'rgba(255,255,255,1.0)');
        grad.addColorStop(0.5,  'rgba(255,255,255,0.85)');
        grad.addColorStop(1,    'rgba(255,255,255,0)');
      } else {
        grad.addColorStop(0,    'rgba(255,255,255,0.95)');
        grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
        grad.addColorStop(1,    'rgba(255,255,255,0)');
      }
      lctx.fillStyle = grad;
      lctx.fillRect(sx - halfBBox, sy, halfBBox * 2, sb.h);
      lctx.restore();
    }
  }

  ctx.drawImage(lightCanvas, 0, 0);

  // Warm tint over fire-based lights and stairs (additive). Glow mushrooms
  // are cool-toned and skip this pass.
  ctx.globalCompositeOperation = 'lighter';
  const tint = (biome && biome.torchTint) || 'rgba(255,160,80,0.18)';
  for (const lt of state.lights) {
    if (lt.type === 'glowMushroom') continue;
    if (lt.type === 'skull')        continue;
    if (lt.type === 'altar')        continue;
    if (lt.type === 'starObelisk')  continue;
    const lx = lt.x - state.cameraX;
    const ly = lt.y - state.cameraY;
    if (lx < -120 || lx > VIEW_W + 120 || ly < -120 || ly > VIEW_H + 120) continue;
    const tintRadius = lt.type === 'campfire' ? 130 : 80;
    const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, tintRadius);
    grad.addColorStop(0, lt.type === 'campfire' ? 'rgba(255,140,60,0.28)' : tint);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lx, ly, tintRadius, 0, Math.PI * 2);
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
    if (lt.type === 'altar') continue;  // flame already painted into the cache
    if (lt.type === 'starObelisk') continue; // obelisk sprite is its own libraryProp
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
    } else if (lt.type === 'campfire') {
      drawCampfireSprite(ctx, lx, ly, lt.flicker);
    } else if (lt.type === 'glowMushroom') {
      drawGlowMushroomSprite(ctx, lx, ly, lt.variant, state.time + (lt.phase || 0));
    } else if (lt.type === 'skull') {
      drawSkullSprite(ctx, lx, ly, state.time + (lt.phase || 0));
    } else if (lt.type === 'candle') {
      // Wall niche candle: dark recess + thin candle + small cool flame.
      const dir = lt.dir === 'left' ? -1 : 1;
      // Niche carved into the wall (dark rectangle).
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(lx + (dir < 0 ? -6 : 0), ly - 5, 6, 9);
      // Candle stick.
      ctx.fillStyle = '#d8d0b8';
      ctx.fillRect(lx + dir * 2 - 0.5, ly - 4, 1.4, 5);
      // Small cool flame, gentle bob.
      const cfl = Math.sin(lt.flicker * 0.9) * 0.6;
      ctx.fillStyle = 'rgba(180, 210, 255, 0.95)';
      ctx.beginPath();
      ctx.ellipse(lx + dir * 2 + 0.2, ly - 5.5 + cfl, 1.2, 2.3 + cfl * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 1)';
      ctx.beginPath();
      ctx.ellipse(lx + dir * 2 + 0.2, ly - 5.5 + cfl, 0.5, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (lt.type === 'magicFlame') {
      // Floating arcane orb: outer halo, inner glow, bright core. Two thin
      // tendrils licking upward give it a flame feel without a wick.
      const c   = lt.color || [180, 120, 255];
      const bob = Math.sin(state.time * 2 + lt.phase) * 1.2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // Outer halo.
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.35)`;
      ctx.beginPath();
      ctx.arc(lx, ly + bob, 8, 0, Math.PI * 2);
      ctx.fill();
      // Inner glow.
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.85)`;
      ctx.beginPath();
      ctx.arc(lx, ly + bob, 4.5, 0, Math.PI * 2);
      ctx.fill();
      // Bright core.
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(lx, ly + bob, 1.8, 0, Math.PI * 2);
      ctx.fill();
      // Upward tendrils.
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.55)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx - 1.5, ly + bob - 2);
      ctx.quadraticCurveTo(lx - 0.5, ly + bob - 6, lx + 0.5, ly + bob - 9);
      ctx.moveTo(lx + 1.6, ly + bob - 1);
      ctx.quadraticCurveTo(lx + 1.0, ly + bob - 5, lx - 0.4, ly + bob - 8);
      ctx.stroke();
      ctx.restore();
      // Optional: small levitating rune glyph orbiting the flame.
      if (lt.rune) drawFloatingRune(ctx, lx, ly + bob, lt.rune, c);
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
 * Draw a small magical rune glyph levitating near a magic flame. The
 * glyph orbits the flame on a tiny circle and pulses; rendered in the
 * 'lighter' composite mode so it adds to the flame's bloom.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} fx Flame x (screen-space, already includes bob).
 * @param {number} fy Flame y (screen-space).
 * @param {{shape:number,orbitR:number,phase:number,bobAmp:number,bobSpeed:number}} rune
 * @param {[number,number,number]} c Flame colour for glow tint.
 */
function drawFloatingRune(ctx, fx, fy, rune, c) {
  const orbit = state.time * 0.6 + rune.phase;
  // Orbit above the flame: stays in the upper half so it doesn't clip.
  const ang = -Math.PI / 2 + Math.sin(orbit) * 0.9;
  const rx = fx + Math.cos(ang) * rune.orbitR;
  const ry = fy + Math.sin(ang) * rune.orbitR
           + Math.sin(state.time * rune.bobSpeed + rune.phase) * rune.bobAmp - 12;
  const pulse = 0.55 + 0.45 * Math.sin(state.time * 2.4 + rune.phase);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = pulse;
  ctx.shadowColor = `rgba(${c[0]},${c[1]},${c[2]},1)`;
  ctx.shadowBlur  = 8;
  ctx.fillStyle   = '#f0d8ff';
  ctx.strokeStyle = '#f0d8ff';
  ctx.lineWidth   = 1;
  // Four glyph variants (chosen per flame in dungeon.js).
  switch (rune.shape) {
    case 0: // small cross
      ctx.fillRect(rx - 3, ry - 0.5, 6, 1.2);
      ctx.fillRect(rx - 0.5, ry - 3, 1.2, 6);
      break;
    case 1: // triangle outline
      ctx.beginPath();
      ctx.moveTo(rx, ry - 3);
      ctx.lineTo(rx + 3, ry + 2);
      ctx.lineTo(rx - 3, ry + 2);
      ctx.closePath();
      ctx.stroke();
      break;
    case 2: // two parallel bars
      ctx.fillRect(rx - 3, ry - 2, 6, 1.2);
      ctx.fillRect(rx - 3, ry + 1, 6, 1.2);
      break;
    default: // diamond outline
      ctx.beginPath();
      ctx.moveTo(rx, ry - 3);
      ctx.lineTo(rx + 3, ry);
      ctx.lineTo(rx, ry + 3);
      ctx.lineTo(rx - 3, ry);
      ctx.closePath();
      ctx.stroke();
      break;
  }
  ctx.restore();
}

/**
 * Draw a traveller campfire: a stone ring, two crossed charred logs and a
 * lively flame with a couple of layers. Slight ash patch underneath sells
 * the 'someone camped here' vibe.
 * @private
 */
function drawCampfireSprite(ctx, lx, ly, flicker) {
  // Ash circle on the ground.
  ctx.fillStyle = 'rgba(40, 30, 25, 0.55)';
  ctx.beginPath();
  ctx.ellipse(lx, ly + 4, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ring of stones (6 stones around the fire).
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sx = lx + Math.cos(a) * 9;
    const sy = ly + Math.sin(a) * 4 + 3;
    ctx.fillStyle = '#5a5450';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 2.5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a7470';
    ctx.fillRect(sx - 1, sy - 1.5, 1, 1);
  }

  // Crossed logs.
  ctx.strokeStyle = '#3a2410';
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(lx - 6, ly + 3);
  ctx.lineTo(lx + 6, ly - 1);
  ctx.moveTo(lx - 6, ly - 1);
  ctx.lineTo(lx + 6, ly + 3);
  ctx.stroke();
  ctx.lineWidth = 1;

  // Flame layers (3 ellipses for depth) with flicker.
  const fl = Math.sin(flicker * 1.3) * 1.2 + Math.sin(flicker * 3.7) * 0.6;
  ctx.fillStyle = '#a02810';
  ctx.beginPath();
  ctx.ellipse(lx, ly - 4 + fl * 0.3, 5.5, 7 + fl, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff7028';
  ctx.beginPath();
  ctx.ellipse(lx, ly - 5 + fl * 0.5, 3.5, 5.5 + fl * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd070';
  ctx.beginPath();
  ctx.ellipse(lx, ly - 6 + fl * 0.7, 1.8, 3 + fl * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tiny ember rising above (one pixel).
  if ((Math.floor(flicker * 20) % 7) === 0) {
    ctx.fillStyle = 'rgba(255, 200, 100, 0.9)';
    const ey = ly - 12 - (flicker % 6);
    ctx.fillRect(lx + Math.sin(flicker) * 2, ey, 1, 1);
  }
}

/**
 * Draw a small bioluminescent mushroom: thin pale stalk with a coloured
 * dome cap and a soft glow halo. Variant 0 = teal/green, 1 = blue/cyan.
 * @private
 */
function drawGlowMushroomSprite(ctx, lx, ly, variant, t) {
  const cap = variant === 0
    ? { dim: '#1e5a48', mid: '#3aaa78', hi: '#a8ffd6' }
    : { dim: '#1e487a', mid: '#3a78aa', hi: '#a8d8ff' };
  const pulse = 0.7 + Math.sin(t * 2.4) * 0.3;

  // Halo
  const haloR = 6 * pulse + 3;
  const halo  = ctx.createRadialGradient(lx, ly - 2, 0, lx, ly - 2, haloR);
  halo.addColorStop(0, variant === 0 ? `rgba(160, 255, 220, ${0.45 * pulse})` : `rgba(160, 220, 255, ${0.45 * pulse})`);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(lx, ly - 2, haloR, 0, Math.PI * 2);
  ctx.fill();

  // Stalk
  ctx.fillStyle = '#d8d0b8';
  ctx.fillRect(lx - 0.5, ly - 1, 1, 4);

  // Cap (3 layers for shading)
  ctx.fillStyle = cap.dim;
  ctx.beginPath(); ctx.ellipse(lx, ly - 1, 3, 2, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = cap.mid;
  ctx.beginPath(); ctx.ellipse(lx, ly - 1.4, 2.4, 1.4, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = cap.hi;
  ctx.fillRect(lx - 1, ly - 2, 1, 1);
}

/**
 * Draw a luminous skull on a small stone pedestal (catacombs biome).
 * @private
 */
function drawSkullSprite(ctx, lx, ly, t) {
  const pulse = 0.7 + Math.sin(t * 1.6) * 0.3;
  // Cool halo.
  const haloR = 7 * pulse + 3;
  const halo  = ctx.createRadialGradient(lx, ly - 2, 0, lx, ly - 2, haloR);
  halo.addColorStop(0, `rgba(180, 210, 240, ${0.4 * pulse})`);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(lx, ly - 2, haloR, 0, Math.PI * 2); ctx.fill();

  // Pedestal (square block).
  ctx.fillStyle = '#3a3e46';
  ctx.fillRect(lx - 4, ly + 2, 8, 4);
  ctx.fillStyle = '#2a2d35';
  ctx.fillRect(lx - 4, ly + 5, 8, 1);

  // Skull (cranium + jaw).
  ctx.fillStyle = '#d8d0b8';
  ctx.beginPath(); ctx.ellipse(lx, ly - 1, 3.2, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(lx - 2, ly + 1.2, 4, 1.6);

  // Glowing eye sockets.
  ctx.fillStyle = `rgba(180, 220, 255, ${0.85 * pulse})`;
  ctx.fillRect(lx - 2, ly - 1.5, 1.4, 1.4);
  ctx.fillRect(lx + 0.6, ly - 1.5, 1.4, 1.4);

  // Nasal cavity.
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(lx - 0.4, ly + 0.2, 0.8, 1);

  // Tooth gap.
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(lx - 0.4, ly + 1.6, 0.8, 0.6);
}

/**
 * Draw atmospheric sunbeams falling from above (only used by 'ruins').
 * Each beam is composed of a clipped main body (warm gradient), a few
 * thin parallel god-rays drifting horizontally, and dust motes that fall
 * with gravity, twinkle, and respawn at the crack.
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
    const halfBBox = sb.length * 0.5 + sb.splay + 8;
    if (sx < -halfBBox || sx > VIEW_W + halfBBox) continue;
    if (sy + sb.h < 0 || sy > VIEW_H) continue;

    // Clip everything to the irregular crack polygon.
    ctx.save();
    ctx.beginPath();
    const shape = sb.shape;
    ctx.moveTo(sx + shape[0][0], sy + shape[0][1]);
    for (let i = 1; i < shape.length; i++) {
      ctx.lineTo(sx + shape[i][0], sy + shape[i][1]);
    }
    ctx.closePath();
    ctx.clip();

    // Main body — warm vertical gradient.
    const isThin = sb.kind === 'thin';
    const isShrine = sb.kind === 'shrine';
    const grad = ctx.createLinearGradient(0, sy, 0, sy + sb.h);
    if (isThin) {
      grad.addColorStop(0,    'rgba(220, 230, 255, 0.18)');
      grad.addColorStop(0.7,  'rgba(220, 230, 255, 0.06)');
      grad.addColorStop(1,    'rgba(220, 230, 255, 0)');
    } else if (isShrine) {
      grad.addColorStop(0,    'rgba(255, 248, 200, 0.45)');
      grad.addColorStop(0.5,  'rgba(255, 240, 180, 0.25)');
      grad.addColorStop(1,    'rgba(255, 220, 140, 0.00)');
    } else {
      grad.addColorStop(0,    'rgba(255, 240, 180, 0.26)');
      grad.addColorStop(0.55, 'rgba(255, 230, 160, 0.12)');
      grad.addColorStop(1,    'rgba(255, 220, 140, 0.00)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(sx - halfBBox, sy, halfBBox * 2, sb.h);

    if (!isThin) {
      const rayCount = isShrine ? 5 : 3;
      const rayHalf  = sb.length * 0.42;
      for (let k = 0; k < rayCount; k++) {
        const phase  = (sb.seed * 0.0001) + k * 1.7;
        const drift  = Math.sin(t * 0.35 + phase) * (sb.splay * 0.35);
        const baseX  = sx + ((k - (rayCount - 1) / 2) / (rayCount)) * rayHalf * 1.4 + drift;
        const width  = 6 + Math.sin(t * 0.7 + phase) * 1.5;
        const baseA  = isShrine ? 0.20 : 0.05;
        const alpha  = baseA + (Math.sin(t * 0.9 + phase) * 0.5 + 0.5) * (isShrine ? 0.18 : 0.06);
        const rgrad  = ctx.createLinearGradient(0, sy, 0, sy + sb.h);
        rgrad.addColorStop(0,   `rgba(255, 245, 200, ${alpha * 1.3})`);
        rgrad.addColorStop(0.7, `rgba(255, 235, 170, ${alpha * 0.6})`);
        rgrad.addColorStop(1,   'rgba(255, 220, 140, 0)');
        ctx.fillStyle = rgrad;
        ctx.fillRect(baseX - width / 2, sy, width, sb.h);
      }
    }
    ctx.restore();

    if (isThin) continue;

    const motesHalf = sb.length * 0.5;
    const nMotes = Math.max(isShrine ? 24 : 10, Math.floor(sb.length / (isShrine ? 5 : 10)));
    for (let i = 0; i < nMotes; i++) {
      const seed   = sb.seed + i * 137;
      const speed  = 0.05 + ((seed * 11) % 100) / 100 * 0.10;
      const phase  = ((seed % 1000) / 1000 + t * speed) % 1;
      const eased  = phase * phase;
      const driftX = Math.sin(t * 0.6 + seed) * 5;
      const baseX  = sx - motesHalf + ((seed * 13) % 100) / 100 * (motesHalf * 2);
      const dx = baseX + driftX;
      const dy = sy + eased * sb.h;
      const size = 1 + ((seed >> 3) % 3) * 0.6;
      const twinkle = 0.45 + 0.55 * (Math.sin(t * 2.3 + seed) * 0.5 + 0.5);
      const isSparkle = ((seed >> 5) % 17) === 0 && phase > 0.3 && phase < 0.7;
      const brightMul = isShrine ? 1.8 : 1;
      const a = Math.max(0, Math.min(1, twinkle * (1 - eased * 0.5) * brightMul));
      if (isSparkle) {
        ctx.fillStyle = `rgba(255, 252, 230, ${a * 1.6})`;
        ctx.fillRect(dx - size, dy - size, size * 2, size * 2);
      } else {
        ctx.fillStyle = `rgba(255, 245, 200, ${a})`;
        ctx.fillRect(dx, dy, size, size);
      }
    }
  }
  ctx.restore();
}

/**
 * Atmospheric fog drifting ABOVE the Observatorio. Replaces the previous
 * opaque cosmic floor: the regular library cobbles stay visible, and a
 * mystical haze hovers on top with twinkling stars and slow nebula wisps.
 *
 * Painted as a single top-layer pass (after lighting) so it reads as a
 * mist suspended in the room, not as a solid background to be overdrawn.
 */
export function drawObservatoryFog(ctx) {
  const room = state.observatoryRoom;
  if (!room) return;
  const rx = room.x * TILE - state.cameraX;
  const ry = room.y * TILE - state.cameraY;
  const rw = room.w * TILE;
  const rh = room.h * TILE;
  if (rx + rw < 0 || rx > VIEW_W || ry + rh < 0 || ry > VIEW_H) return;

  const t = state.time;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();

  // 1. Atmospheric veil — dense enough to mask the underlying cobbles
  //    while still letting the room outline read through. Stays opaque
  //    almost to the wall so no "gray tile" patches show at the edges.
  const ccx = rx + rw / 2;
  const ccy = ry + rh / 2;
  const veil = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, Math.max(rw, rh) * 0.85);
  veil.addColorStop(0,    'rgba(22, 18, 56, 0.62)');
  veil.addColorStop(0.55, 'rgba(18, 14, 46, 0.55)');
  veil.addColorStop(0.85, 'rgba(14, 10, 38, 0.42)');
  veil.addColorStop(1,    'rgba(10, 8, 28, 0.20)');
  ctx.fillStyle = veil;
  ctx.fillRect(rx, ry, rw, rh);

  // 2. Two slow-drifting nebula wisps (additive). Their offsets pulse with
  //    time so the fog never feels static.
  ctx.globalCompositeOperation = 'lighter';
  const driftA = Math.sin(t * 0.13) * rw * 0.06;
  const driftB = Math.cos(t * 0.10) * rh * 0.05;

  const nebA = ctx.createRadialGradient(
    ccx - rw * 0.20 + driftA, ccy - rh * 0.16, 0,
    ccx - rw * 0.20 + driftA, ccy - rh * 0.16, Math.max(rw, rh) * 0.45,
  );
  nebA.addColorStop(0,   'rgba(150, 90, 200, 0.16)');
  nebA.addColorStop(0.6, 'rgba(110, 60, 170, 0.05)');
  nebA.addColorStop(1,   'rgba(0, 0, 0, 0)');
  ctx.fillStyle = nebA;
  ctx.fillRect(rx, ry, rw, rh);

  const nebB = ctx.createRadialGradient(
    ccx + rw * 0.18, ccy + rh * 0.20 + driftB, 0,
    ccx + rw * 0.18, ccy + rh * 0.20 + driftB, Math.max(rw, rh) * 0.50,
  );
  nebB.addColorStop(0,   'rgba(70, 110, 220, 0.16)');
  nebB.addColorStop(0.6, 'rgba(40, 80, 180, 0.05)');
  nebB.addColorStop(1,   'rgba(0, 0, 0, 0)');
  ctx.fillStyle = nebB;
  ctx.fillRect(rx, ry, rw, rh);

  // 3. Twinkling star field suspended in the haze. Deterministic per-room
  //    so positions stay stable across frames.
  const STARS = 28;
  let s = ((room.x * 73856093) ^ (room.y * 19349663)) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const PALETTE = [
    [220, 235, 255], [220, 235, 255], [220, 235, 255], [220, 235, 255],
    [255, 235, 215], [255, 200, 200], [180, 210, 255],
  ];
  for (let i = 0; i < STARS; i++) {
    const ux = rnd();
    const uy = rnd();
    const ph = rnd() * Math.PI * 2;
    const sp = 0.9 + rnd() * 1.6;
    const sz = 0.5 + rnd() * 1.4;
    const col = PALETTE[Math.floor(rnd() * PALETTE.length)];
    const x  = rx + ux * rw;
    const y  = ry + uy * rh;
    const a  = 0.30 + 0.55 * (Math.sin(t * sp + ph) * 0.5 + 0.5);
    if (sz > 1.1) {
      const halo = ctx.createRadialGradient(x, y, 0, x, y, sz * 4);
      halo.addColorStop(0, `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${a * 0.45})`);
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, sz * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${a})`;
    ctx.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz);
  }

  ctx.restore();
}

/**
 * Draw the atmospheric vignette, floor rune glows, and central pedestal rune circle
 * for the Forbidden Archive.
 */
export function drawArchiveAtmosphere(ctx) {
  const room = state.archiveRoom;
  if (!room) return;

  const rx = room.x * TILE - state.cameraX;
  const ry = room.y * TILE - state.cameraY;
  const rw = room.w * TILE;
  const rh = room.h * TILE;
  if (rx + rw < 0 || rx > VIEW_W || ry + rh < 0 || ry > VIEW_H) return;

  const t = state.time;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();

  // 1. Dynamic darkness/vignette overlay inside the archive
  if (state.archiveVignetteAlpha > 0.01) {
    const ccx = rx + rw / 2;
    const ccy = ry + rh / 2;

    // Ambient dark layer
    ctx.fillStyle = `rgba(8, 4, 14, ${0.45 * state.archiveVignetteAlpha})`;
    ctx.fillRect(rx, ry, rw, rh);

    // Radial shadow vignette centered on the pedestal
    const vignette = ctx.createRadialGradient(ccx, ccy, TILE * 1.5, ccx, ccy, Math.max(rw, rh) * 0.78);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.5, `rgba(6, 2, 12, ${0.65 * state.archiveVignetteAlpha})`);
    vignette.addColorStop(1, `rgba(3, 0, 8, ${0.98 * state.archiveVignetteAlpha})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(rx, ry, rw, rh);
  }

  // 2. Dynamic glowing runes on the floor (where libraryRuneMark elements are)
  const runeMarks = state.libraryProps.filter(
    p => p.kind === 'libraryRuneMark' &&
         p.tx >= room.x && p.tx < room.x + room.w &&
         p.ty >= room.y && p.ty < room.y + room.h
  );

  if (runeMarks.length > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const runePulse = 0.4 + 0.3 * Math.sin(t * 3.2);

    for (const p of runeMarks) {
      const px = p.tx * TILE - state.cameraX;
      const py = p.ty * TILE - state.cameraY;
      const cx = px + TILE / 2;
      const cy = py + TILE / 2;
      const r = TILE * 0.36;

      // Draw an extra glowing circle on top
      const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, r * 1.5);
      grad.addColorStop(0, `rgba(255, 60, 60, ${0.35 * runePulse})`);
      grad.addColorStop(0.6, `rgba(180, 20, 40, ${0.15 * runePulse})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 3. Dynamic rotating and pulsing runic ring around the pedestal slab
  const cx = (room.cx + 0.5) * TILE - state.cameraX;
  const cy = (room.cy + 0.5) * TILE - state.cameraY;
  const size = TILE * 0.78;
  const pulse = 0.6 + 0.4 * Math.sin(t * 2.5);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Outer glowing pulse ring
  ctx.strokeStyle = `rgba(220, 40, 50, ${0.4 + 0.35 * pulse})`;
  ctx.shadowColor = 'rgba(255, 30, 40, 0.95)';
  ctx.shadowBlur = 8 + pulse * 6;
  ctx.lineWidth = 1.6 + pulse * 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.82, 0, Math.PI * 2);
  ctx.stroke();

  // Rotating rune segments
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.15); // slow rotate
  ctx.strokeStyle = `rgba(255, 80, 80, ${0.35 + 0.25 * pulse})`;
  ctx.shadowBlur = 4;
  ctx.lineWidth = 1.2;

  // Draw small lines/ticks representing runes
  const segments = 12;
  for (let i = 0; i < segments; i++) {
    const angle = (i * Math.PI * 2) / segments;
    const rStart = size * 0.88;
    const rEnd = size * 1.02;

    // Draw tick segment
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * rStart, Math.sin(angle) * rStart);
    ctx.lineTo(Math.cos(angle + 0.08) * rEnd, Math.sin(angle + 0.08) * rEnd);
    ctx.stroke();

    // Draw tiny dot
    if (i % 3 === 0) {
      ctx.fillStyle = `rgba(255, 120, 100, ${0.4 + 0.3 * pulse})`;
      ctx.beginPath();
      ctx.arc(Math.cos(angle + 0.2) * (rStart - 3), Math.sin(angle + 0.2) * (rStart - 3), 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.restore();

  ctx.restore();
}

/**
 * Draw an animated specular shimmer on each puddle. The highlight strength
 * scales with proximity to the nearest warm light, the player aura, or any
 * sunbeam covering the tile — so puddles only "wake up" when there is light
 * to reflect.
 */
export function drawPuddles(ctx) {
  if (!state.puddles || state.puddles.length === 0) return;
  const t = state.time;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of state.puddles) {
    const px = p.x - state.cameraX;
    const py = p.y - state.cameraY;
    if (px < -20 || px > VIEW_W + 20 || py < -20 || py > VIEW_H + 20) continue;

    // Influence: nearest warm light or player.
    let intensity = 0;
    const player = state.player;
    if (player) {
      const d = Math.hypot(player.x - p.x, player.y - p.y);
      intensity = Math.max(intensity, Math.max(0, 1 - d / 220));
    }
    for (const lt of state.lights) {
      if (lt.type === 'glowMushroom') continue; // ignored: cool tone, weak
      const range = lt.type === 'campfire' ? 200 : 130;
      const d = Math.hypot(lt.x - p.x, lt.y - p.y);
      const i = Math.max(0, 1 - d / range);
      if (i > intensity) intensity = i;
    }
    if (intensity < 0.05) continue;

    const wobble = Math.sin(t * 1.4 + p.seed) * 0.5 + 0.5;
    const a = intensity * (0.45 + wobble * 0.35);

    // Specular crescent — top of puddle catches the light.
    ctx.fillStyle = `rgba(220, 235, 245, ${a})`;
    ctx.beginPath();
    ctx.ellipse(px - p.rx * 0.25, py - p.ry * 0.5, p.rx * 0.55, p.ry * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Thin rim highlight.
    ctx.strokeStyle = `rgba(180, 210, 230, ${a * 0.7})`;
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.ellipse(px, py, p.rx, p.ry, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Render the minimap onto the supplied canvas.
 * Only rooms the player has visited are visible (fog of war).
 */
export function drawMinimap(mctx, w, h) {
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = 'rgba(0,0,0,0.6)';
  mctx.fillRect(0, 0, w, h);
  const sx = w / MAP_W;
  const sy = h / MAP_H;

  // Build a quick lookup: tile -> room id (only for floor tiles in rooms)
  const roomAt = new Map();
  for (const r of state.rooms) {
    const id = `${r.x},${r.y},${r.w},${r.h}`;
    for (let yy = r.y; yy < r.y + r.h; yy++) {
      for (let xx = r.x; xx < r.x + r.w; xx++) {
        roomAt.set(`${xx},${yy}`, id);
      }
    }
  }

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = state.map[y][x];
      if (t !== T_FLOOR && t !== T_STAIR && t !== T_DOOR_LOCKED) continue;

      const roomId = roomAt.get(`${x},${y}`);
      const visited = roomId && state.roomsVisited.has(roomId);
      const isCurrent = state.currentRoom && roomId === `${state.currentRoom.x},${state.currentRoom.y},${state.currentRoom.w},${state.currentRoom.h}`;

      if (!visited && !isCurrent) continue;

      if (t === T_FLOOR) {
        mctx.fillStyle = isCurrent ? '#4a3820' : '#3a2818';
        mctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      } else if (t === T_STAIR) {
        const pulse = 0.7 + Math.sin(state.time * 4) * 0.3;
        mctx.fillStyle = `rgba(200,120,255,${pulse})`;
        mctx.fillRect(x * sx - 2, y * sy - 2, sx + 4, sy + 4);
        mctx.fillStyle = '#fff';
        mctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      } else if (t === T_DOOR_LOCKED) {
        const pulse = 0.7 + Math.sin(state.time * 3) * 0.3;
        mctx.fillStyle = `rgba(255,180,80,${pulse})`;
        mctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      }
    }
  }

  // Only draw enemies in visited/current rooms
  for (const e of state.enemies) {
    if (e.dead) continue;
    const exTile = Math.floor(e.x / TILE);
    const eyTile = Math.floor(e.y / TILE);
    const roomId = roomAt.get(`${exTile},${eyTile}`);
    const visited = roomId && state.roomsVisited.has(roomId);
    const isCurrent = state.currentRoom && roomId === `${state.currentRoom.x},${state.currentRoom.y},${state.currentRoom.w},${state.currentRoom.h}`;
    if (!visited && !isCurrent) continue;

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
