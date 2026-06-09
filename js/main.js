/*!
 * Dungeon Depths
 *
 * A vanilla-JS roguelite dungeon crawler.
 *
 *   • Procedural BSP dungeons with rotating styles per floor
 *   • Tile-based collision and dynamic lighting
 *   • Enemy AI archetypes + a 2-phase boss
 *   • Procedural audio via Web Audio API
 *   • Particle FX, screen shake and floating damage text
 *   • Run-based progression with branching upgrades
 *
 * Entry point. Wires every module together and runs the game loop.
 *
 * @author  Luis Barrientos
 * @license MIT
 */

import {
  TILE, VIEW_W, VIEW_H, MAP_W, MAP_H, MAX_FLOOR, setViewSize,
  STATE_MENU, STATE_PLAY, STATE_PAUSE, STATE_DEAD, STATE_WIN, STATE_UPGRADE, STATE_INTRO,
} from './config.js';
import { state }                          from './state.js';
import { Audio }                          from './audio.js';
import { initInput, updateTouchAim }      from './input.js';
import { initDebugPanel }                 from './debugPanel.js';
import { clamp, lerp, rand }              from './utils.js';
import {
  generateDungeon, getRoomAt,
}                                         from './dungeon.js';
import { getBiomeForFloor }               from './biomes.js';
import {
  createPlayer, playerUpdate, drawPlayer, damagePlayer,
}                                         from './player.js';
import {
  enemyUpdate, drawEnemy, damageEnemy, populateFloor,
}                                         from './enemies.js';
import {
  projectileUpdate, drawProjectile,
}                                         from './projectiles.js';
import {
  updateParticles, drawParticles, drawDamageTexts, spawnParticles,
}                                         from './particles.js';
import {
  updateLoot, drawLoot, spawnChest, openChest,
}                                         from './loot.js';
import {
  rebuildMapCache, drawMap, drawLighting, drawSunbeams, drawObservatoryFog, drawArchiveAtmosphere, drawPuddles, drawSarcophagiOverlay, drawLibrarySetPiece, drawMinimap,
}                                         from './render.js';
import {
  updateHUD, showToast, hideAllOverlays, showMenu, showPause, hidePause,
  showGameOver, showWinScreen, showUpgradePicker, hideUpgradePicker,
  showFloorIntro,
}                                         from './ui.js';
import { save, load }                     from './storage.js';
import { initChangelogUI }                from './changelog.js';
import { tryStartChallenge, updateChallenge, resetChallenge, drawAltarPrompt } from './challenge.js';
import { tryStartLibraryEvent, updateLibraryEvent, resetLibraryEvent, drawCirclePrompt } from './librarySetPiece.js';
import { tryStartGrandTome, updateGrandTome, resetGrandTome, drawGrandTome, drawTomePrompt } from './grandTome.js';
import { resetKeyRoom, updateKeyRoom, drawArchiveDoorPrompt, drawKeyPedestals, tryLightCandle } from './keyRoom.js';
import { resetAlphaLair, updateAlphaLair } from './alphaLair.js';

/* ─────────────────────────── DOM bootstrap ─────────────────────────── */
const canvas  = document.getElementById('game');
const ctx     = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const mctx    = minimap.getContext('2d');
/**
 * Resize the canvas to fill the window. Capped on very large displays so the
 * lighting overlay (drawn each frame) stays cheap on the GPU.
 */
function resizeCanvas() {
  const maxW = 1920, maxH = 1200;
  const w = Math.min(window.innerWidth,  maxW);
  const h = Math.min(window.innerHeight, maxH);
  canvas.width  = w;
  canvas.height = h;
  setViewSize(w, h);
}
resizeCanvas();
window.addEventListener('resize',            resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);
initInput(canvas, { pause: pauseGame, resume: resumeGame });
initDebugPanel({ buildFloor });

/* ─────────────────────────── Game flow ─────────────────────────── */

/**
 * Start (or restart) a fresh run. Resets all run-scoped state,
 * including the player — fixes the regression where a new run
 * began with HP at 0 after dying.
 */
function startGame() {
  Audio.init();
  state.state       = STATE_PLAY;
  state.floor       = 1;
  state.gold        = 0;
  state.score       = 0;
  state.kills       = 0;
  state.bossSpawned = false;
  state.player      = null;   // forces buildFloor to recreate it
  state.enemies     = [];
  state.projectiles = [];
  state.particles   = [];
  state.loot        = [];
  state.damageTexts = [];
  state.lights      = [];
  state.sunbeams    = [];
  state.puddles     = [];
  state.decorations = [];
  state.sarcophagi  = [];
  state.libraryProps = [];
  state.librarySetPiece = null;
  state.grandTome    = null;
  state.keyRoom      = null;
  state.archiveDoor  = null;
  state.hasArchiveKey = false;
  state.soulSpawners = [];
  state.archiveMistSpawners = [];
  state.leafSpawners = [];
  state._whisperTimer = 6;
  state._creakTimer   = 12;
  state.shake       = 0;
  state.cameraX     = 0;
  state.cameraY     = 0;

  buildFloor(1);
  hideAllOverlays();
}

/**
 * Generate a floor and place the player at the start room.
 * @param {number} floor
 */
function buildFloor(floor) {
  state.biome = getBiomeForFloor(floor);
  const d = generateDungeon(floor, undefined, state.biome);
  state.map      = d.map;
  state.rooms    = d.rooms;
  state.lights   = d.lights;
  state.sunbeams = d.sunbeams || [];
  state.puddles     = d.puddles     || [];
  state.decorations = d.decorations || [];
  state.sarcophagi  = d.sarcophagi  || [];
  state.libraryProps = d.libraryProps || [];
  state.librarySetPiece = d.librarySetPiece || null;
  state.grandTome       = d.grandTome       || null;
  state.soulSpawners = d.soulSpawners || [];
  state.archiveMistSpawners = d.archiveMistSpawners || [];
  state.leafSpawners = d.leafSpawners || [];
  state.observatoryRoom = d.rooms.find(r => r.isObservatory) || null;
  state._observatoryEntered = false;
  state.archiveRoom = d.rooms.find(r => r.isForbiddenArchive) || null;
  state._archiveEntered = false;
  state.archiveVignetteAlpha = 0;
  state._whisperTimer = 6 + Math.random() * 6;
  state._creakTimer   = 8 + Math.random() * 14;

  state.claroSolarEntered = false;
  resetAlphaLair();
  resetChallenge();
  resetLibraryEvent();
  resetGrandTome();
  resetKeyRoom();

  state.roomsVisited.clear();

  const start = d.startRoom;
  if (state.player) {
    state.player.x = start.cx * TILE + TILE / 2;
    state.player.y = start.cy * TILE + TILE / 2;
  } else {
    state.player = createPlayer(start.cx * TILE + TILE / 2, start.cy * TILE + TILE / 2);
  }

  state.roomsVisited.add(`${start.x},${start.y},${start.w},${start.h}`);

  populateFloor(floor, MAX_FLOOR, spawnChest);
  rebuildMapCache();

  document.getElementById('floorVal').textContent = floor;

  // Pause world while the floor banner is on-screen so enemies can't
  // chip the player. Banner exits → resume play.
  const prevState = state.state;
  state.state = STATE_INTRO;
  showFloorIntro(state.biome, floor, () => {
    if (state.state === STATE_INTRO) {
      state.state = (prevState === STATE_PLAY ? STATE_PLAY : STATE_PLAY);
    }
    if (floor === MAX_FLOOR) showToast('¡EL SEÑOR DE LAS PROFUNDIDADES TE ESPERA!');
  });
}

/** Triggered when the player enters the stair tile and presses E. */
function goToNextFloor() {
  Audio.stairs();
  const newFloor = state.floor + 1;
  if (newFloor > MAX_FLOOR) return;
  state.floor = newFloor;
  if (newFloor >= 2 && newFloor <= MAX_FLOOR) {
    state.state = STATE_UPGRADE;
    showUpgradePicker(applyUpgrade);
  } else {
    buildFloor(newFloor);
  }
}

/** Sunbeam Shrine: on first entry, grant maxhp + reveal minimap. */
function updateClaroSolar(toast) {
  // Puzzle handled via tryTreePrayer.
}

/** Tree E-interaction: player presses E near the ancient trunk. */
function tryTreePrayer(toast) {
  if (state.claroSolarEntered) return false;
  const room = state.currentRoom;
  if (!room || !room.isClaroSolar) return false;
  const p = state.player;
  if (!p) return false;
  const trunkX = room.cx * TILE + TILE / 2;
  const trunkY = room.cy * TILE + TILE / 2;
  if (Math.hypot(p.x - trunkX, p.y - trunkY) > TILE * 1.8) return false;

  state.claroSolarEntered = true;
  grantBlessing('maxhp');
  for (const r of state.rooms) {
    const id = `${r.x},${r.y},${r.w},${r.h}`;
    state.roomsVisited.add(id);
  }
  spawnParticles(trunkX, trunkY - 20, '#c8ff80', 40);
  spawnParticles(trunkX, trunkY - 40, '#ffd040', 20);
  state.shake = Math.max(state.shake || 0, 4);
  toast && toast('El árbol milenario te infunde su savia. +30 HP máximo. El mapa se ha revelado.');
  return true;
}

/** Draw "[E] VENERAR EL ÁRBOL" near the ancient tree. */
function drawTreePrompt(ctx) {
  if (state.claroSolarEntered) return;
  const room = state.currentRoom;
  if (!room || !room.isClaroSolar) return;
  const trunkX = room.cx * TILE + TILE / 2;
  const trunkY = room.cy * TILE + TILE / 2;
  const sx = trunkX - state.cameraX;
  const sy = trunkY - state.cameraY;
  if (sx < -40 || sx > VIEW_W + 40 || sy < -40 || sy > VIEW_H + 40) return;
  const p = state.player;
  if (!p) return;
  if (Math.hypot(p.x - trunkX, p.y - trunkY) > TILE * 2.5) return;

  const pulse = 0.7 + 0.3 * Math.sin(state.time * 3);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = `rgba(255, 255, 220, ${pulse})`;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('[E] VENERAR EL ÁRBOL', sx, sy - 28);
  ctx.restore();
}

/** Apply an upgrade effect to the player (no UI side-effects). */
function grantBlessing(id) {
  const p = state.player;
  if (!p) return;
  switch (id) {
    case 'sword':    p.upgrades.sword++;   break;
    case 'magic':    p.upgrades.magic++;   break;
    case 'speed':    p.upgrades.speed++;   break;
    case 'vampire':  p.upgrades.vampire++; break;
    case 'regen':    p.upgrades.regen++;   break;
    case 'crit':     p.upgrades.crit++;    break;
    case 'maxhp':    p.maxHp += 30; p.hp = p.maxHp; break;
    case 'maxmp':    p.maxMp += 25; p.mp = p.maxMp; break;
    case 'swift':    p.swingDur *= 0.85; break;
    case 'reach':    p.swingRange += 10; p.swingArc = Math.min(Math.PI, p.swingArc + 0.15); break;
    case 'mana_eff': p.magicCost = Math.max(2, p.magicCost - 2); break;
    case 'fortune':  p.goldBonus = (p.goldBonus || 0) + 0.35; break;
    case 'guard':    p.dmgReduce = (p.dmgReduce || 0) + 0.08; break;
    case 'thorns':   p.thorns = (p.thorns || 0) + 0.30; break;
  }
}

/** Apply the chosen upgrade and continue to the next floor. */
function applyUpgrade(id) {
  grantBlessing(id);
  Audio.upgrade();
  hideUpgradePicker();
  state.state = STATE_PLAY;
  buildFloor(state.floor);
}

function pauseGame()  { if (state.state === STATE_PLAY)  { state.state = STATE_PAUSE; showPause(); } }
function resumeGame() { if (state.state === STATE_PAUSE) { state.state = STATE_PLAY;  hidePause(); } }

function triggerDeath() {
  state.state = STATE_DEAD;
  Audio.death();
  const stats = {
    floor: state.floor, kills: state.kills,
    gold:  state.gold,  score: state.score,
  };
  const records = updateBestStats(stats, false);
  setTimeout(() => showGameOver(stats, records), 600);
}

function triggerWin() {
  state.state = STATE_WIN;
  Audio.win();
  const stats = {
    floor: state.floor, kills: state.kills,
    gold:  state.gold,  score: state.score,
  };
  const records = updateBestStats(stats, true);
  setTimeout(() => showWinScreen(stats, records), 1200);
}

/**
 * Compare current run stats against the saved best per category, persist the
 * new maxima, and return a { floor, kills, gold, score } object whose fields
 * are `true` for any category that was beaten this run.
 */
function updateBestStats(stats, won) {
  const prev = load('best', null) || {};
  const records = {
    floor: stats.floor > (prev.floor || 0),
    kills: stats.kills > (prev.kills || 0),
    gold:  stats.gold  > (prev.gold  || 0),
    score: stats.score > (prev.score || 0),
  };
  const next = {
    floor: Math.max(prev.floor || 0, stats.floor),
    kills: Math.max(prev.kills || 0, stats.kills),
    gold:  Math.max(prev.gold  || 0, stats.gold),
    score: Math.max(prev.score || 0, stats.score),
    won:   prev.won || won,
    date:  Date.now(),
  };
  save('best', next);
  return records;
}

/**
 * Spawn the Library Guardian rewards near the rune circle: 2 rare chests
 * (free, since the player already paid in blood) + 1 legendary chest.
 * Free as in `cost = 0`, like the catacombs challenge.
 */
function spawnLibraryRewards(room, circle) {
  const cx = circle.tx + Math.floor(circle.w / 2);
  const cy = circle.ty + Math.floor(circle.h / 2);
  // Offsets around the circle, ordered so the legendary lands "in front".
  const slots = [
    { dx:  0, dy:  2, legendary: true  },
    { dx: -3, dy:  0, legendary: false },
    { dx:  3, dy:  0, legendary: false },
    { dx:  0, dy: -3, legendary: false },
    { dx: -2, dy:  2, legendary: false },
    { dx:  2, dy:  2, legendary: false },
  ];
  let rare = 0, legendary = 0;
  for (const s of slots) {
    if (rare >= 2 && legendary >= 1) break;
    const tx = cx + s.dx;
    const ty = cy + s.dy;
    if (!state.map[ty] || state.map[ty][tx] !== 1) continue;        // T_FLOOR
    const wantLegendary = s.legendary && legendary < 1;
    const wantRare      = !wantLegendary && rare < 2;
    if (!wantLegendary && !wantRare) continue;
    state.loot.push({
      type: 'chest', opened: false,
      rare: wantRare,
      legendary: wantLegendary,
      cost: 0,
      x: tx * TILE + TILE / 2,
      y: ty * TILE + TILE / 2,
      age: 0, r: 12, vx: 0, vy: 0,
      fromLibrary: true,
    });
    if (wantLegendary) legendary++;
    else if (wantRare)  rare++;
  }
}

/**
 * Spawn the Sala del Gran Tomo success rewards: 3 free rare chests
 * around the pedestal. Free as in `cost = 0` (the puzzle was the price).
 */
function spawnGrandTomeRewards(room, pedestal) {
  const cx = pedestal.tx + Math.floor(pedestal.w / 2);
  const cy = pedestal.ty + Math.floor(pedestal.h / 2);
  const slots = [
    { dx:  0, dy:  3 },
    { dx: -3, dy:  0 },
    { dx:  3, dy:  0 },
    { dx:  0, dy: -3 },
    { dx: -3, dy:  3 },
    { dx:  3, dy:  3 },
  ];
  let placed = 0;
  for (const s of slots) {
    if (placed >= 3) break;
    const tx = cx + s.dx;
    const ty = cy + s.dy;
    if (!state.map[ty] || state.map[ty][tx] !== 1) continue;        // T_FLOOR
    state.loot.push({
      type: 'chest', opened: false,
      rare: true, legendary: false,
      cost: 0,
      x: tx * TILE + TILE / 2,
      y: ty * TILE + TILE / 2,
      age: 0, r: 12, vx: 0, vy: 0,
      fromGrandTome: true,
    });
    placed++;
  }
}

/* ─────────────────────────── Hooks ─────────────────────────── */

const enemyHooks = {
  onPlayerHit: (dmg, attacker) => damagePlayer(state.player, dmg, triggerDeath, attacker),
  onWin:       triggerWin,
};

const projectileHooks = {
  onEnemyHit:  (e, dmg) => damageEnemy(e, dmg, false, { onWin: triggerWin }),
  onPlayerHit: (dmg, attacker) => damagePlayer(state.player, dmg, triggerDeath, attacker),
};

const playerHooks = {
  onStairs:    goToNextFloor,
  onChest:     c => openChest(c, showToast, grantBlessing),
  onEnemyHit:  (e, dmg, crit) => damageEnemy(e, dmg, crit, { onWin: triggerWin }),
  onAltar:     () => tryStartChallenge(showToast),
  onCircle:    () => tryStartLibraryEvent(showToast),
  onTome:      () => tryStartGrandTome(showToast),
  onCandle:    () => tryLightCandle(),
  onTree:      () => tryTreePrayer(showToast),
};

/* ─────────────────────────── Update / render ─────────────────────────── */

/**
 * Apply per-frame biome effects to the player. Currently:
 *   • hpRegenIdle  – heal HP per second while standing still
 *   • mpRegenBonus – multiplier added to MP regen
 */
function applyBiomeModifiers(dt) {
  const p = state.player;
  const m = state.biome && state.biome.modifiers;
  if (!p || !m) return;

  if (m.hpRegenIdle) {
    const moved = p._lastBX !== p.x || p._lastBY !== p.y;
    p._lastBX = p.x; p._lastBY = p.y;
    if (!moved && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + m.hpRegenIdle * dt);
    }
  }
  if (m.mpRegenBonus && p.mp < p.maxMp) {
    p.mp = Math.min(p.maxMp, p.mp + p.mpRegen * m.mpRegenBonus * dt);
  }
}

/**
 * While the player stands inside the Observatorio, restore HP and MP at
 * a steady tick. First-time entry on each floor pops a flavour toast.
 */
function applyObservatoryBuff(dt) {
  const room = state.observatoryRoom;
  const p    = state.player;
  if (!room || !p) return;
  const tx = Math.floor(p.x / TILE);
  const ty = Math.floor(p.y / TILE);
  const inside =
    tx >= room.x && tx < room.x + room.w &&
    ty >= room.y && ty < room.y + room.h;
  if (!inside) return;
  if (!state._observatoryEntered) {
    state._observatoryEntered = true;
    showToast('Bajo las estrellas, tus heridas sanan.');
  }
  if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 6 * dt);
  if (p.mp < p.maxMp) p.mp = Math.min(p.maxMp, p.mp + 4 * dt);
}

/**
 * Handle player entry and vignette transition for the Archivo Prohibido.
 */
function updateArchiveRoom(dt) {
  const room = state.archiveRoom;
  const p    = state.player;
  if (!room || !p) {
    state.archiveVignetteAlpha = lerp(state.archiveVignetteAlpha, 0, 4 * dt);
    return;
  }
  const tx = Math.floor(p.x / TILE);
  const ty = Math.floor(p.y / TILE);
  const inside =
    tx >= room.x && tx < room.x + room.w &&
    ty >= room.y && ty < room.y + room.h;

  if (inside) {
    state.archiveVignetteAlpha = lerp(state.archiveVignetteAlpha, 1, 3.5 * dt);
    if (!state._archiveEntered) {
      state._archiveEntered = true;
      showToast('Un aire gélido te oprime. Este archivo no debió ser abierto.');
      state.shake = Math.max(state.shake || 0, 10);
      if (Audio.whisper) Audio.whisper();
      
      // Spawn ritual embers burst around player
      for (let i = 0; i < 20; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp  = rand(30, 95);
        state.particles.push({
          kind: 'ritualEmber',
          x: p.x,
          y: p.y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 15,
          life: rand(0.6, 1.2),
          maxLife: 1.2,
          r: rand(0.9, 1.8),
          color: Math.random() < 0.35 ? '#ff6633' : '#ff1111',
          seed: Math.random() * Math.PI * 2,
        });
      }
    }
  } else {
    state.archiveVignetteAlpha = lerp(state.archiveVignetteAlpha, 0, 3.5 * dt);
  }
}

/**
 * Sunbeam regen: while the player stands inside one of the wide ceiling
 * cracks (floor-1 ruins), the sunlight slowly heals HP. Excludes the
 * thin moonbeams (crypts) and the observatory starlight column, which
 * has its own buff.
 *
 * Uses a point-in-polygon test against `sb.shape`, the same irregular
 * polygon the renderer uses to draw the beam — so the buff edge matches
 * the visible light exactly.
 */
function applySunbeamRegen(dt) {
  if (!state.sunbeams || state.sunbeams.length === 0) return;
  const p = state.player;
  if (!p || p.hp >= p.maxHp) return;
  for (const sb of state.sunbeams) {
    if (sb.kind === 'thin') continue;
    if (!sb.shape) continue;
    const halfBBox = sb.length * 0.5 + sb.splay + 8;
    const dx = p.x - sb.x;
    const dy = p.y - sb.y;
    if (dx < -halfBBox || dx > halfBBox)   continue;
    if (dy < -10        || dy > sb.h + 10) continue;
    if (pointInPolygon(dx, dy, sb.shape)) {
      const rate = sb.kind === 'shrine' ? 12 : 4;
      p.hp = Math.min(p.maxHp, p.hp + rate * dt);
      return;
    }
  }
}

/** Ray-casting point-in-polygon for an array of [x,y] tuples. */
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Per-biome ambient layer.
 * - Catacombs: drifting soul wisps + procedural whispers.
 * - Library:   drifting leaves / paper scraps + occasional wood creaks.
 */
function updateAmbient(dt) {
  if (!state.biome) return;
  const id = state.biome.id;

  if (id === 'crypt') {
    for (const s of state.soulSpawners) {
      s.timer -= dt;
      if (s.timer > 0) continue;
      s.timer = 1.6 + Math.random() * 2.8;
      state.particles.push({
        kind: 'soul',
        x: s.x + (Math.random() - 0.5) * 10,
        y: s.y + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 6,
        vy: -10 - Math.random() * 12,
        life: 2.4 + Math.random() * 0.9,
        maxLife: 3.3,
        r: 1.8 + Math.random() * 1.2,
        color: 'rgba(160,200,240,1)',
        seed: Math.random() * Math.PI * 2,
      });
    }
    for (const s of state.archiveMistSpawners) {
      s.timer -= dt;
      if (s.timer > 0) continue;
      s.timer = 0.35 + Math.random() * 0.35;
      if (Math.random() < 0.45) {
        // Spawn ritual ember
        state.particles.push({
          kind: 'ritualEmber',
          x: s.x + (Math.random() - 0.5) * 20,
          y: s.y + (Math.random() - 0.5) * 12,
          vx: (Math.random() - 0.5) * 8,
          vy: -20 - Math.random() * 16,
          life: 0.9 + Math.random() * 0.7,
          maxLife: 1.6,
          r: 0.8 + Math.random() * 0.8,
          color: Math.random() < 0.3 ? '#ff6633' : '#ff1111',
          seed: Math.random() * Math.PI * 2,
        });
      } else {
        // Spawn archive mist
        state.particles.push({
          kind: 'archiveMist',
          x: s.x + (Math.random() - 0.5) * 16,
          y: s.y + (Math.random() - 0.5) * 12,
          vx: (Math.random() - 0.5) * 5,
          vy: -6 - Math.random() * 5,
          life: 1.9 + Math.random() * 0.8,
          maxLife: 2.7,
          baseR: 5 + Math.random() * 4,
          r: 5 + Math.random() * 4,
          color: 'rgba(50, 8, 24, 0.35)',
          seed: Math.random() * Math.PI * 2,
        });
      }
    }

    state._whisperTimer -= dt;
    if (state._whisperTimer <= 0) {
      Audio.whisper();
      state._whisperTimer = 18 + Math.random() * 12;
    }
  }

  if (id === 'library') {
    for (const s of state.leafSpawners) {
      s.timer -= dt;
      if (s.timer > 0) continue;
      s.timer = 2.5 + Math.random() * 4.0;
      const paper = s.hue === 'paper';
      state.particles.push({
        kind: 'leaf',
        x: s.x + (Math.random() - 0.5) * 16,
        y: s.y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 14,
        // Falls downward slowly with mild side wobble (applied in particles.js).
        vy: 10 + Math.random() * 14,
        life: 4.5 + Math.random() * 2.0,
        maxLife: 6.5,
        r: 2.5 + Math.random() * 1.5,
        rot:    Math.random() * Math.PI * 2,
        rotSp:  (Math.random() - 0.5) * 2.4,
        color:  paper ? 'rgba(220, 200, 170, 1)' : 'rgba(140, 160, 100, 1)',
        // Marks the particle as paper so the draw call uses a rectangle.
        paper,
        seed:   Math.random() * Math.PI * 2,
      });
    }

    state._creakTimer -= dt;
    if (state._creakTimer <= 0) {
      Audio.woodCreak();
      state._creakTimer = 22 + Math.random() * 16;
    }
  }
}

function update(dt) {
  if (state.state !== STATE_PLAY) return;
  state.time += dt;

  updateTouchAim();
  playerUpdate(state.player, dt, playerHooks);
  applyBiomeModifiers(dt);
  applyObservatoryBuff(dt);
  updateArchiveRoom(dt);
  applySunbeamRegen(dt);
  state.currentRoom = getRoomAt(state.rooms, state.player);
  if (state.currentRoom) {
    const id = `${state.currentRoom.x},${state.currentRoom.y},${state.currentRoom.w},${state.currentRoom.h}`;
    state.roomsVisited.add(id);
  }

  for (const e of state.enemies) enemyUpdate(e, dt, enemyHooks);
  state.enemies = state.enemies.filter(e => !e.dead);

  for (const prj of state.projectiles) projectileUpdate(prj, dt, projectileHooks);
  state.projectiles = state.projectiles.filter(p => !p._dead);

  updateLoot(dt, showToast);
  updateParticles(dt);
  updateChallenge(dt, showToast);
  updateLibraryEvent(dt, showToast, spawnLibraryRewards);
  updateGrandTome(dt, showToast, spawnGrandTomeRewards);
  updateKeyRoom(dt, showToast);
  updateAlphaLair(dt, showToast);
  updateClaroSolar(showToast);
  updateAmbient(dt);
  updateCamera();
  updateHUD();
}

function updateCamera() {
  const p = state.player;
  let tx = p.x - VIEW_W / 2;
  let ty = p.y - VIEW_H / 2;
  tx = clamp(tx, 0, MAP_W * TILE - VIEW_W);
  ty = clamp(ty, 0, MAP_H * TILE - VIEW_H);
  state.cameraX = lerp(state.cameraX, tx, 0.15);
  state.cameraY = lerp(state.cameraY, ty, 0.15);
  if (state.shake > 0.1) {
    state.cameraX += rand(-state.shake, state.shake);
    state.cameraY += rand(-state.shake, state.shake);
    state.shake *= 0.85;
  }
}

function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  if (!state.map) return;

  drawMap(ctx);
  drawLoot(ctx);
  for (const e of state.enemies)     drawEnemy(ctx, e);
  if (state.player)                  drawPlayer(ctx, state.player);
  for (const prj of state.projectiles) drawProjectile(ctx, prj);
  drawParticles(ctx);
  drawDamageTexts(ctx);
  drawPuddles(ctx);
  drawSarcophagiOverlay(ctx);
  drawLibrarySetPiece(ctx);
  drawGrandTome(ctx);
  drawKeyPedestals(ctx);
  drawAltarPrompt(ctx);
  drawCirclePrompt(ctx);
  drawTomePrompt(ctx);
  drawArchiveDoorPrompt(ctx);
  drawTreePrompt(ctx);
  drawSunbeams(ctx);
  drawLighting(ctx);
  drawObservatoryFog(ctx);
  drawArchiveAtmosphere(ctx);

  // Boss banner
  for (const e of state.enemies) {
    if (e.isBoss && !e.dead) drawBossBar(e);
  }

  drawMinimap(mctx, minimap.width, minimap.height);
}

function drawBossBar(e) {
  const w = 460, h = 16;
  const x = (VIEW_W - w) / 2;
  const y = 18;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  ctx.fillStyle = '#400';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ff3030';
  ctx.fillRect(x, y, w * (e.hp / e.maxHp), h);
  ctx.strokeStyle = '#ff8060';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#ffe0a0';
  ctx.font = 'bold 14px serif';
  ctx.textAlign = 'center';
  ctx.fillText('SEÑOR DE LAS PROFUNDIDADES', VIEW_W / 2, y + 12);
}

/* ─────────────────────────── Game loop ─────────────────────────── */
function loop(now) {
  const dt = Math.min(0.05, (now - state.lastTime) / 1000);
  state.lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

/* ─────────────────────────── UI bindings ─────────────────────────── */

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('quitBtn').addEventListener('click', () => {
  state.state = STATE_MENU;
  hideAllOverlays();
  showMenu();
});
document.getElementById('retryBtn').addEventListener('click', () => {
  hideAllOverlays();
  startGame();
});
document.getElementById('winBtn').addEventListener('click', () => {
  hideAllOverlays();
  startGame();
});

initChangelogUI();

state.lastTime = performance.now();
document.body.classList.add('overlay-active');
requestAnimationFrame(loop);
