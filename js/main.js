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
  TILE, VIEW_W, VIEW_H, MAP_W, MAP_H, MAX_FLOOR,
  STATE_MENU, STATE_PLAY, STATE_PAUSE, STATE_DEAD, STATE_WIN, STATE_UPGRADE,
} from './config.js';
import { state }                          from './state.js';
import { Audio }                          from './audio.js';
import { initInput, updateTouchAim }      from './input.js';
import { clamp, lerp, rand }              from './utils.js';
import {
  generateDungeon, getRoomAt,
}                                         from './dungeon.js';
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
  updateParticles, drawParticles, drawDamageTexts,
}                                         from './particles.js';
import {
  updateLoot, drawLoot, spawnChest, openChest,
}                                         from './loot.js';
import {
  rebuildMapCache, drawMap, drawLighting, drawMinimap,
}                                         from './render.js';
import {
  updateHUD, showToast, hideAllOverlays, showMenu, showPause, hidePause,
  showGameOver, showWinScreen, showUpgradePicker, hideUpgradePicker,
}                                         from './ui.js';

/* ─────────────────────────── DOM bootstrap ─────────────────────────── */
const canvas  = document.getElementById('game');
const ctx     = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const mctx    = minimap.getContext('2d');

initInput(canvas, { pause: pauseGame, resume: resumeGame });

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
  const d = generateDungeon(floor);
  state.map    = d.map;
  state.rooms  = d.rooms;
  state.lights = d.lights;

  const start = d.startRoom;
  if (state.player) {
    state.player.x = start.cx * TILE + TILE / 2;
    state.player.y = start.cy * TILE + TILE / 2;
  } else {
    state.player = createPlayer(start.cx * TILE + TILE / 2, start.cy * TILE + TILE / 2);
  }

  populateFloor(floor, MAX_FLOOR, spawnChest);
  rebuildMapCache();

  document.getElementById('floorVal').textContent = floor;
  if (floor === MAX_FLOOR) showToast('¡EL SEÑOR DE LAS PROFUNDIDADES TE ESPERA!');
  else                     showToast(`Piso ${floor}`);
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

/** Apply the chosen upgrade and continue to the next floor. */
function applyUpgrade(id) {
  const p = state.player;
  switch (id) {
    case 'sword':   p.upgrades.sword++;   break;
    case 'magic':   p.upgrades.magic++;   break;
    case 'speed':   p.upgrades.speed++;   break;
    case 'vampire': p.upgrades.vampire++; break;
    case 'regen':   p.upgrades.regen++;   break;
    case 'crit':    p.upgrades.crit++;    break;
    case 'maxhp':   p.maxHp += 30; p.hp = p.maxHp; break;
    case 'maxmp':   p.maxMp += 25; p.mp = p.maxMp; break;
  }
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
  setTimeout(() => showGameOver({
    floor: state.floor, kills: state.kills,
    gold:  state.gold,  score: state.score,
  }), 600);
}

function triggerWin() {
  state.state = STATE_WIN;
  Audio.win();
  setTimeout(() => showWinScreen({
    kills: state.kills, gold: state.gold, score: state.score,
  }), 1200);
}

/* ─────────────────────────── Hooks ─────────────────────────── */

const enemyHooks = {
  onPlayerHit: dmg => damagePlayer(state.player, dmg, triggerDeath),
  onWin:       triggerWin,
};

const projectileHooks = {
  onEnemyHit:  (e, dmg) => damageEnemy(e, dmg, false, { onWin: triggerWin }),
  onPlayerHit: dmg      => damagePlayer(state.player, dmg, triggerDeath),
};

const playerHooks = {
  onStairs:    goToNextFloor,
  onChest:     c => openChest(c, showToast),
  onEnemyHit:  (e, dmg, crit) => damageEnemy(e, dmg, crit, { onWin: triggerWin }),
};

/* ─────────────────────────── Update / render ─────────────────────────── */

function update(dt) {
  if (state.state !== STATE_PLAY) return;
  state.time += dt;

  updateTouchAim();
  playerUpdate(state.player, dt, playerHooks);
  state.currentRoom = getRoomAt(state.rooms, state.player);

  for (const e of state.enemies) enemyUpdate(e, dt, enemyHooks);
  state.enemies = state.enemies.filter(e => !e.dead);

  for (const prj of state.projectiles) projectileUpdate(prj, dt, projectileHooks);
  state.projectiles = state.projectiles.filter(p => !p._dead);

  updateLoot(dt, showToast);
  updateParticles(dt);
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
  drawLighting(ctx);

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

state.lastTime = performance.now();
document.body.classList.add('overlay-active');
requestAnimationFrame(loop);
