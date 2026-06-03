/*!
 * Dungeon Depths
 * A vanilla-JS roguelite dungeon crawler.
 *
 * Features:
 *   - Procedural dungeon generation (BSP)
 *   - Tile-based collision and lighting
 *   - 4 enemy archetypes + 2-phase boss
 *   - Procedural audio via Web Audio API
 *   - Particle FX, screen shake, floating damage text
 *   - Run-based progression with branching upgrades
 *
 * No build step, no dependencies. Just open index.html.
 *
 * @author  Luis Barrientos
 * @license MIT
 */
(function () {
'use strict';

/* ─────────────────────────── Constants ─────────────────────────── */
const TILE   = 32;
const MAP_W  = 48;
const MAP_H  = 48;
const VIEW_W = 800;
const VIEW_H = 600;

const T_WALL  = 0;
const T_FLOOR = 1;
const T_DOOR  = 2;
const T_STAIR = 3;

const STATE_MENU = 'menu';
const STATE_PLAY = 'play';
const STATE_PAUSE = 'pause';
const STATE_DEAD = 'dead';
const STATE_WIN = 'win';
const STATE_UPGRADE = 'upgrade';

/* ───────── DOM ───────── */
const canvas    = document.getElementById('game');
const ctx       = canvas.getContext('2d');
const minimap   = document.getElementById('minimap');
const mctx      = minimap.getContext('2d');
const hpBar     = document.getElementById('hpBar');
const hpText    = document.getElementById('hpText');
const mpBar     = document.getElementById('mpBar');
const mpText    = document.getElementById('mpText');
const floorVal  = document.getElementById('floorVal');
const goldVal   = document.getElementById('goldVal');
const scoreVal  = document.getElementById('scoreVal');
const buffsEl   = document.getElementById('buffs');
const toastEl   = document.getElementById('toast');
const menuEl    = document.getElementById('menu');
const pauseEl   = document.getElementById('pauseMenu');
const gameOverEl= document.getElementById('gameOver');
const winEl     = document.getElementById('winScreen');
const upgradeEl = document.getElementById('upgradePicker');
const upgradeOpts = document.getElementById('upgradeOptions');

/* ───────── Estado global ───────── */
const game = {
  state: STATE_MENU,
  map: null,
  rooms: [],
  player: null,
  enemies: [],
  projectiles: [],
  particles: [],
  loot: [],
  damageTexts: [],
  lights: [],            // antorchas
  cameraX: 0, cameraY: 0,
  shake: 0,
  floor: 1,
  maxFloor: 4,           // 3 normales + 1 boss
  gold: 0,
  score: 0,
  kills: 0,
  time: 0,
  lastTime: 0,
  currentRoom: null,
  bossSpawned: false,
};

/* ═══════════════════════════════════════════════════════════════════
 *  UTILIDADES
 * ═══════════════════════════════════════════════════════════════════ */
const rand  = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp  = (a, b, t) => a + (b - a) * t;
const choice = arr => arr[Math.floor(Math.random() * arr.length)];

/* ═══════════════════════════════════════════════════════════════════
 *  AUDIO PROCEDURAL
 * ═══════════════════════════════════════════════════════════════════ */
const Audio = (() => {
  let actx = null;
  let masterGain = null;
  let droneGain = null;

  function init() {
    if (actx) return;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = actx.createGain();
    masterGain.gain.value = 0.35;
    masterGain.connect(actx.destination);
    startDrone();
  }

  function tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.3, slide = 0, attack = 0.005, release = 0.05 }) {
    if (!actx) return;
    const t = actx.currentTime;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    osc.connect(gain).connect(masterGain);
    osc.start(t);
    osc.stop(t + dur + release + 0.05);
  }

  function noise({ dur = 0.15, vol = 0.3, freq = 1000 }) {
    if (!actx) return;
    const t = actx.currentTime;
    const buf = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const filter = actx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 4;
    const gain = actx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(masterGain);
    src.start();
  }

  function startDrone() {
    droneGain = actx.createGain();
    droneGain.gain.value = 0.04;
    droneGain.connect(masterGain);
    [55, 82.5, 110, 138].forEach((f, i) => {
      const o = actx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = actx.createGain();
      g.gain.value = 0.25;
      o.connect(g).connect(droneGain);
      o.start();
      // LFO para hacerlo "respirar"
      const lfo = actx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.03;
      const lfoGain = actx.createGain();
      lfoGain.gain.value = 0.1;
      lfo.connect(lfoGain).connect(g.gain);
      lfo.start();
    });
  }

  return {
    init,
    swordSwing: () => { noise({ dur: 0.08, vol: 0.18, freq: 2400 }); tone({ freq: 320, type: 'square', dur: 0.05, vol: 0.08, slide: -180 }); },
    hit:        () => { noise({ dur: 0.06, vol: 0.22, freq: 600 });  tone({ freq: 180, type: 'square', dur: 0.06, vol: 0.15, slide: -120 }); },
    enemyDie:   () => { tone({ freq: 220, type: 'sawtooth', dur: 0.25, vol: 0.18, slide: -200 }); noise({ dur: 0.18, vol: 0.12, freq: 400 }); },
    bossHit:    () => { noise({ dur: 0.12, vol: 0.3, freq: 200 }); tone({ freq: 90, type: 'square', dur: 0.18, vol: 0.25, slide: -50 }); },
    magicShoot: () => { tone({ freq: 880, type: 'sine', dur: 0.18, vol: 0.18, slide: 600 }); tone({ freq: 1320, type: 'triangle', dur: 0.14, vol: 0.1 }); },
    playerHurt: () => { tone({ freq: 220, type: 'sawtooth', dur: 0.18, vol: 0.25, slide: -120 }); noise({ dur: 0.1, vol: 0.15, freq: 300 }); },
    pickup:     () => { tone({ freq: 660, type: 'sine', dur: 0.08, vol: 0.18 }); tone({ freq: 990, type: 'sine', dur: 0.1, vol: 0.18 }); },
    coin:       () => { tone({ freq: 1320, type: 'square', dur: 0.05, vol: 0.12 }); tone({ freq: 1760, type: 'square', dur: 0.06, vol: 0.12 }); },
    stairs:     () => { [440, 660, 880, 1100].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'triangle', dur: 0.18, vol: 0.18 }), i * 70)); },
    upgrade:    () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'sine', dur: 0.22, vol: 0.18 }), i * 60)); },
    win:        () => { [523, 659, 784, 1047, 1318].forEach((f, i) => setTimeout(() => tone({ freq: f, type: 'sine', dur: 0.35, vol: 0.22 }), i * 130)); },
    death:      () => { tone({ freq: 440, type: 'sawtooth', dur: 1.2, vol: 0.3, slide: -380 }); },
  };
})();

/* ═══════════════════════════════════════════════════════════════════
 *  INPUT
 * ═══════════════════════════════════════════════════════════════════ */
const input = {
  keys: {},
  mouseX: 0, mouseY: 0,
  mouseDown: false,
  rightDown: false,
};

document.addEventListener('keydown', e => {
  input.keys[e.code] = true;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape') {
    if (game.state === STATE_PLAY) pauseGame();
    else if (game.state === STATE_PAUSE) resumeGame();
  }
});
document.addEventListener('keyup', e => { input.keys[e.code] = false; });

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  input.mouseX = (e.clientX - r.left) * (canvas.width / r.width);
  input.mouseY = (e.clientY - r.top)  * (canvas.height / r.height);
});
canvas.addEventListener('mousedown', e => {
  e.preventDefault();
  if (e.button === 0) input.mouseDown = true;
  if (e.button === 2) input.rightDown = true;
});
canvas.addEventListener('mouseup', e => {
  if (e.button === 0) input.mouseDown = false;
  if (e.button === 2) input.rightDown = false;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

/* ═══════════════════════════════════════════════════════════════════
 *  GENERACIÓN DE MAZMORRA (BSP)
 * ═══════════════════════════════════════════════════════════════════ */
function generateDungeon(floor) {
  const map = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(T_WALL));
  const rooms = [];

  // BSP
  const root = { x: 1, y: 1, w: MAP_W - 2, h: MAP_H - 2, child: null };
  const leaves = [];
  splitNode(root, 5, leaves);

  for (const leaf of leaves) {
    const rw = irand(6, Math.min(11, leaf.w - 2));
    const rh = irand(5, Math.min(9, leaf.h - 2));
    const rx = leaf.x + irand(1, leaf.w - rw - 1);
    const ry = leaf.y + irand(1, leaf.h - rh - 1);
    const room = { x: rx, y: ry, w: rw, h: rh, cx: rx + (rw>>1), cy: ry + (rh>>1), enemies: [], cleared: false, visited: false };
    rooms.push(room);
    for (let y = ry; y < ry + rh; y++)
      for (let x = rx; x < rx + rw; x++)
        map[y][x] = T_FLOOR;
  }

  // Conectar salas (orden de centros)
  rooms.sort((a, b) => a.cx - b.cx);
  for (let i = 0; i < rooms.length - 1; i++) {
    carveCorridor(map, rooms[i], rooms[i + 1]);
  }

  // Escaleras en última sala (la más lejana de la primera)
  const start = rooms[0];
  let stairsRoom = rooms[rooms.length - 1];
  let bestD = 0;
  for (const r of rooms) {
    const d = Math.hypot(r.cx - start.cx, r.cy - start.cy);
    if (d > bestD) { bestD = d; stairsRoom = r; }
  }
  if (floor < game.maxFloor) {
    map[stairsRoom.cy][stairsRoom.cx] = T_STAIR;
  }
  stairsRoom.isStairsRoom = true;
  start.isStartRoom = true;

  // Antorchas (luces)
  const lights = [];
  for (const r of rooms) {
    // 1-2 antorchas por sala en las esquinas
    const corners = [
      { x: r.x + 1,         y: r.y + 1 },
      { x: r.x + r.w - 2,   y: r.y + 1 },
      { x: r.x + 1,         y: r.y + r.h - 2 },
      { x: r.x + r.w - 2,   y: r.y + r.h - 2 },
    ];
    const n = irand(1, 2);
    for (let i = 0; i < n; i++) {
      const c = corners[irand(0, 3)];
      lights.push({
        x: c.x * TILE + TILE/2,
        y: c.y * TILE + TILE/2,
        r: 110 + Math.random() * 30,
        flicker: Math.random() * Math.PI * 2,
        color: '#ff8030',
      });
    }
  }

  return { map, rooms, lights, startRoom: start, stairsRoom };
}

function splitNode(node, depth, leaves) {
  if (depth <= 0 || (node.w < 14 && node.h < 12)) {
    leaves.push(node);
    return;
  }
  const horizontal = node.w < node.h ? true : node.h < node.w ? false : Math.random() < 0.5;
  if (horizontal) {
    if (node.h < 12) { leaves.push(node); return; }
    const split = irand(Math.floor(node.h * 0.4), Math.floor(node.h * 0.6));
    splitNode({ x: node.x, y: node.y,        w: node.w, h: split }, depth - 1, leaves);
    splitNode({ x: node.x, y: node.y + split, w: node.w, h: node.h - split }, depth - 1, leaves);
  } else {
    if (node.w < 14) { leaves.push(node); return; }
    const split = irand(Math.floor(node.w * 0.4), Math.floor(node.w * 0.6));
    splitNode({ x: node.x,         y: node.y, w: split,         h: node.h }, depth - 1, leaves);
    splitNode({ x: node.x + split, y: node.y, w: node.w - split, h: node.h }, depth - 1, leaves);
  }
}

function carveCorridor(map, a, b) {
  let x = a.cx, y = a.cy;
  const tx = b.cx, ty = b.cy;
  while (x !== tx) {
    map[y][x] = T_FLOOR;
    if (map[y+1] && map[y+1][x] === T_WALL && map[y-1] && map[y-1][x] === T_WALL) {
      // mantener pared simple
    }
    x += x < tx ? 1 : -1;
  }
  while (y !== ty) {
    map[y][x] = T_FLOOR;
    y += y < ty ? 1 : -1;
  }
  map[ty][tx] = T_FLOOR;
}

/* ═══════════════════════════════════════════════════════════════════
 *  COLISIÓN
 * ═══════════════════════════════════════════════════════════════════ */
function isWall(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return game.map[ty][tx] === T_WALL;
}

function isBlocked(x, y, r) {
  // chequea esquinas del bbox circular
  const pts = [
    [x - r, y - r], [x + r, y - r],
    [x - r, y + r], [x + r, y + r],
  ];
  for (const [px, py] of pts) {
    if (isWall(Math.floor(px / TILE), Math.floor(py / TILE))) return true;
  }
  return false;
}

function tryMove(entity, dx, dy) {
  const r = entity.r || 10;
  if (!isBlocked(entity.x + dx, entity.y, r)) entity.x += dx;
  if (!isBlocked(entity.x, entity.y + dy, r)) entity.y += dy;
}

/* ═══════════════════════════════════════════════════════════════════
 *  JUGADOR
 * ═══════════════════════════════════════════════════════════════════ */
function createPlayer(x, y) {
  return {
    x, y, r: 10,
    hp: 100, maxHp: 100,
    mp: 50,  maxMp: 50,
    speed: 165,
    dirX: 0, dirY: 1,    // dirección de cara
    facing: 'down',
    swingTime: 0,        // tiempo restante del swing
    swingCool: 0,
    swingDur: 0.22,
    swingRange: 44,
    swingArc: Math.PI * 0.7,
    swingDmg: 25,
    magicCool: 0,
    magicDmg: 30,
    magicCost: 12,
    iframes: 0,
    mpRegen: 4,           // por segundo
    walkAnim: 0,
    upgrades: { speed: 0, sword: 0, magic: 0, vampire: 0, regen: 0, crit: 0 },
  };
}

function playerUpdate(p, dt) {
  // Movimiento
  let mx = 0, my = 0;
  if (input.keys['KeyA'] || input.keys['ArrowLeft'])  mx -= 1;
  if (input.keys['KeyD'] || input.keys['ArrowRight']) mx += 1;
  if (input.keys['KeyW'] || input.keys['ArrowUp'])    my -= 1;
  if (input.keys['KeyS'] || input.keys['ArrowDown'])  my += 1;
  if (mx || my) {
    const len = Math.hypot(mx, my);
    mx /= len; my /= len;
    const sp = p.speed * (1 + p.upgrades.speed * 0.15);
    tryMove(p, mx * sp * dt, my * sp * dt);
    p.dirX = mx; p.dirY = my;
    p.facing = Math.abs(my) > Math.abs(mx) ? (my < 0 ? 'up' : 'down') : (mx < 0 ? 'left' : 'right');
    p.walkAnim += dt * 8;
  }

  // Apuntar al mouse cuando ataque a distancia
  const aimDx = (input.mouseX + game.cameraX) - p.x;
  const aimDy = (input.mouseY + game.cameraY) - p.y;
  const aimLen = Math.hypot(aimDx, aimDy) || 1;

  // Ataque melee
  p.swingCool -= dt;
  p.swingTime -= dt;
  if ((input.mouseDown || input.keys['KeyZ']) && p.swingCool <= 0) {
    p.swingCool = p.swingDur + 0.1;
    p.swingTime = p.swingDur;
    p.swingAngle = Math.atan2(aimDy, aimDx);
    Audio.swordSwing();
    doSwordHit(p);
  }

  // Magia
  p.magicCool -= dt;
  if ((input.rightDown || input.keys['KeyX']) && p.magicCool <= 0 && p.mp >= p.magicCost) {
    p.magicCool = 0.35;
    p.mp -= p.magicCost;
    Audio.magicShoot();
    const speed = 380;
    const angle = Math.atan2(aimDy, aimDx);
    game.projectiles.push({
      friendly: true,
      x: p.x, y: p.y, r: 6,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.6,
      dmg: p.magicDmg + p.upgrades.magic * 8,
      color: '#a060ff',
      glow: '#d0a0ff',
      type: 'magic',
    });
  }

  // Iframes
  p.iframes = Math.max(0, p.iframes - dt);

  // Regen MP
  p.mp = Math.min(p.maxMp, p.mp + (p.mpRegen + p.upgrades.magic * 0.5) * dt);
  // Regen HP (upgrade)
  if (p.upgrades.regen > 0) {
    p.hp = Math.min(p.maxHp, p.hp + p.upgrades.regen * 0.6 * dt);
  }

  // Interactuar
  if (input.keys['KeyE']) {
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    if (game.map[ty] && game.map[ty][tx] === T_STAIR) {
      input.keys['KeyE'] = false; // consumir
      goToNextFloor();
    }
    // baúles
    for (let i = game.loot.length - 1; i >= 0; i--) {
      const l = game.loot[i];
      if (l.type === 'chest' && !l.opened && dist(p, l) < 28) {
        input.keys['KeyE'] = false;
        openChest(l);
      }
    }
  }
}

function doSwordHit(p) {
  const dx = Math.cos(p.swingAngle);
  const dy = Math.sin(p.swingAngle);
  const range = p.swingRange + p.upgrades.sword * 4;
  const dmg = p.swingDmg + p.upgrades.sword * 10;
  const hits = [];
  for (const e of game.enemies) {
    if (e.dead) continue;
    const ex = e.x - p.x, ey = e.y - p.y;
    const d = Math.hypot(ex, ey);
    if (d > range + e.r) continue;
    const ang = Math.atan2(ey, ex);
    let diff = Math.abs(ang - p.swingAngle);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < p.swingArc / 2) {
      hits.push(e);
    }
  }
  for (const e of hits) {
    const isCrit = Math.random() < p.upgrades.crit * 0.12;
    const finalDmg = Math.round(dmg * (isCrit ? 2 : 1));
    damageEnemy(e, finalDmg, isCrit);
    // knockback
    const ang = Math.atan2(e.y - p.y, e.x - p.x);
    e.knockX = Math.cos(ang) * 180;
    e.knockY = Math.sin(ang) * 180;
    // vampirismo
    if (p.upgrades.vampire > 0) {
      p.hp = Math.min(p.maxHp, p.hp + p.upgrades.vampire * 1.5);
    }
  }
  if (hits.length) {
    game.shake = Math.min(8, game.shake + 4);
    Audio.hit();
  }
}

function damagePlayer(p, dmg) {
  if (p.iframes > 0) return;
  p.hp -= dmg;
  p.iframes = 0.6;
  game.shake = Math.min(14, game.shake + 6);
  Audio.playerHurt();
  spawnParticles(p.x, p.y, '#ff4040', 12);
  if (p.hp <= 0) {
    p.hp = 0;
    triggerDeath();
  }
}

function drawPlayer(p) {
  const x = p.x - game.cameraX;
  const y = p.y - game.cameraY;
  const blink = p.iframes > 0 && Math.floor(p.iframes * 16) % 2;
  if (blink) return;

  ctx.save();
  // sombra
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(x, y + 10, 10, 4, 0, 0, Math.PI * 2); ctx.fill();

  // bob caminando
  const bob = Math.sin(p.walkAnim) * 1.6;

  // capa
  ctx.fillStyle = '#5a2a8a';
  ctx.beginPath();
  ctx.ellipse(x, y + 2 + bob, 11, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // cuerpo
  ctx.fillStyle = '#d0a060';
  ctx.fillRect(x - 6, y - 6 + bob, 12, 14);

  // cabeza
  ctx.fillStyle = '#f0c890';
  ctx.beginPath();
  ctx.arc(x, y - 10 + bob, 6, 0, Math.PI * 2);
  ctx.fill();

  // casco
  ctx.fillStyle = '#888';
  ctx.fillRect(x - 6, y - 14 + bob, 12, 5);
  ctx.fillStyle = '#aaa';
  ctx.fillRect(x - 6, y - 14 + bob, 12, 1);

  // ojos según facing
  ctx.fillStyle = '#000';
  if (p.facing === 'down') {
    ctx.fillRect(x - 3, y - 9 + bob, 1.5, 1.5);
    ctx.fillRect(x + 1.5, y - 9 + bob, 1.5, 1.5);
  } else if (p.facing === 'up') {
    // sin ojos por detrás
  } else if (p.facing === 'left') {
    ctx.fillRect(x - 4, y - 9 + bob, 1.5, 1.5);
  } else {
    ctx.fillRect(x + 2.5, y - 9 + bob, 1.5, 1.5);
  }

  // escudo (si tiene)
  if (p.upgrades.regen > 0) {
    ctx.strokeStyle = 'rgba(80,200,120,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 16 + Math.sin(game.time * 4) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // espada en swing
  if (p.swingTime > 0) {
    const t = 1 - p.swingTime / p.swingDur;
    const ang = p.swingAngle + (t - 0.5) * p.swingArc;
    const len = p.swingRange + p.upgrades.sword * 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
    // arc trail
    ctx.strokeStyle = 'rgba(255,220,100,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, len, p.swingAngle - p.swingArc/2, ang);
    ctx.stroke();
  }
  ctx.restore();
}

/* ═══════════════════════════════════════════════════════════════════
 *  ENEMIGOS
 * ═══════════════════════════════════════════════════════════════════ */
const ENEMY_TYPES = {
  slime: {
    hp: 35, dmg: 10, speed: 50, r: 11,
    color: '#60c060', glow: '#80ff80',
    score: 15, gold: [3, 7],
    range: 22, attackCool: 0.9,
    behavior: 'melee',
  },
  skeleton: {
    hp: 50, dmg: 14, speed: 90, r: 10,
    color: '#e0e0d0', glow: '#ffffff',
    score: 25, gold: [5, 12],
    range: 26, attackCool: 0.7,
    behavior: 'melee',
  },
  mage: {
    hp: 40, dmg: 16, speed: 65, r: 10,
    color: '#a040c0', glow: '#e080ff',
    score: 40, gold: [8, 18],
    range: 220, attackCool: 1.4,
    behavior: 'ranged',
  },
  bat: {
    hp: 22, dmg: 8, speed: 130, r: 8,
    color: '#403040', glow: '#806080',
    score: 18, gold: [2, 6],
    range: 22, attackCool: 0.6,
    behavior: 'melee',
  },
};

function createEnemy(type, x, y, floor) {
  const t = ENEMY_TYPES[type];
  const scale = 1 + (floor - 1) * 0.18;
  return {
    type, x, y, r: t.r,
    hp: Math.round(t.hp * scale),
    maxHp: Math.round(t.hp * scale),
    dmg: Math.round(t.dmg * scale),
    speed: t.speed,
    score: Math.round(t.score * scale),
    color: t.color,
    glow: t.glow,
    range: t.range,
    attackCool: 0,
    attackRate: t.attackCool,
    behavior: t.behavior,
    state: 'idle',
    target: null,
    knockX: 0, knockY: 0,
    hurtTime: 0,
    dead: false,
    walkAnim: Math.random() * Math.PI * 2,
    gold: t.gold,
    room: null,
  };
}

function createBoss(x, y) {
  return {
    type: 'boss', x, y, r: 22,
    hp: 600, maxHp: 600,
    dmg: 25,
    speed: 70,
    score: 1000,
    color: '#c02020',
    glow: '#ff4040',
    range: 280,
    attackCool: 0,
    attackRate: 1.4,
    behavior: 'boss',
    state: 'idle',
    phase: 1,
    phaseTimer: 0,
    knockX: 0, knockY: 0,
    hurtTime: 0,
    dead: false,
    walkAnim: 0,
    gold: [100, 200],
    isBoss: true,
  };
}

function enemyUpdate(e, dt) {
  if (e.dead) return;
  e.hurtTime = Math.max(0, e.hurtTime - dt);
  e.attackCool = Math.max(0, e.attackCool - dt);
  e.walkAnim += dt * 6;

  // knockback
  if (Math.abs(e.knockX) > 1 || Math.abs(e.knockY) > 1) {
    tryMove(e, e.knockX * dt, e.knockY * dt);
    e.knockX *= 0.85;
    e.knockY *= 0.85;
  }

  const p = game.player;
  const dx = p.x - e.x, dy = p.y - e.y;
  const d = Math.hypot(dx, dy);

  // Activación: solo enemigos en la sala actual o el boss actúan
  const inActiveRoom = (e.room && e.room === game.currentRoom) || e.isBoss;
  if (!inActiveRoom && d > 350) return;

  if (e.behavior === 'boss') {
    bossAI(e, dt, dx, dy, d);
    return;
  }

  if (e.behavior === 'melee') {
    if (d > e.range + p.r) {
      // perseguir
      const sp = e.speed;
      tryMove(e, (dx / d) * sp * dt, (dy / d) * sp * dt);
      e.state = 'chase';
    } else {
      e.state = 'attack';
      if (e.attackCool <= 0) {
        e.attackCool = e.attackRate;
        damagePlayer(p, e.dmg);
      }
    }
  } else if (e.behavior === 'ranged') {
    const ideal = 140;
    let mx = 0, my = 0;
    if (d < 80) { mx = -dx / d; my = -dy / d; }       // huir
    else if (d > ideal + 40) { mx = dx / d; my = dy / d; } // acercar
    if (mx || my) tryMove(e, mx * e.speed * dt, my * e.speed * dt);
    if (d <= e.range && e.attackCool <= 0) {
      e.attackCool = e.attackRate;
      const ang = Math.atan2(dy, dx);
      const speed = 220;
      game.projectiles.push({
        friendly: false,
        x: e.x, y: e.y, r: 6,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 2.5,
        dmg: e.dmg,
        color: '#ff60ff',
        glow: '#ff80ff',
        type: 'magic',
      });
      Audio.magicShoot();
    }
  }
}

function bossAI(b, dt, dx, dy, d) {
  b.phaseTimer += dt;
  if (b.hp < b.maxHp * 0.5) b.phase = 2;

  // Movimiento lento hacia el jugador
  if (d > 80) {
    tryMove(b, (dx / d) * b.speed * dt, (dy / d) * b.speed * dt);
  }

  // Patrón 1: barrage radial
  if (b.attackCool <= 0) {
    if (b.phase === 1) {
      // 8 proyectiles
      for (let i = 0; i < 8; i++) {
        const ang = (Math.PI * 2 * i / 8) + b.phaseTimer * 0.3;
        game.projectiles.push({
          friendly: false, x: b.x, y: b.y, r: 7,
          vx: Math.cos(ang) * 180, vy: Math.sin(ang) * 180,
          life: 3, dmg: b.dmg, color: '#ff4040', glow: '#ffa080',
          type: 'magic',
        });
      }
      b.attackCool = 1.8;
    } else {
      // fase 2: aimed + spread
      const a = Math.atan2(dy, dx);
      for (let i = -2; i <= 2; i++) {
        const ang = a + i * 0.18;
        game.projectiles.push({
          friendly: false, x: b.x, y: b.y, r: 7,
          vx: Math.cos(ang) * 240, vy: Math.sin(ang) * 240,
          life: 2.5, dmg: b.dmg, color: '#ff2020', glow: '#ff8060',
          type: 'magic',
        });
      }
      // ráfaga circular cada 3 ataques
      if (Math.random() < 0.4) {
        for (let i = 0; i < 12; i++) {
          const ang = (Math.PI * 2 * i / 12);
          game.projectiles.push({
            friendly: false, x: b.x, y: b.y, r: 6,
            vx: Math.cos(ang) * 150, vy: Math.sin(ang) * 150,
            life: 3, dmg: b.dmg * 0.7, color: '#ff60a0', glow: '#ffa0c0',
            type: 'magic',
          });
        }
      }
      b.attackCool = 1.1;
    }
    Audio.bossHit();
  }

  // contacto
  if (d < b.r + game.player.r + 4) {
    if (b._touchCool === undefined || b._touchCool <= 0) {
      damagePlayer(game.player, b.dmg);
      b._touchCool = 0.7;
    }
  }
  if (b._touchCool > 0) b._touchCool -= dt;
}

function damageEnemy(e, dmg, crit) {
  e.hp -= dmg;
  e.hurtTime = 0.15;
  spawnDamageText(e.x, e.y - e.r, dmg, crit);
  spawnParticles(e.x, e.y, e.color, 6);
  if (e.isBoss) Audio.bossHit();
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    game.kills++;
    game.score += e.score;
    spawnParticles(e.x, e.y, e.color, 30);
    spawnParticles(e.x, e.y, e.glow, 14);
    game.shake = Math.min(14, game.shake + (e.isBoss ? 14 : 4));
    Audio.enemyDie();
    // gold drops
    const coins = irand(e.gold[0], e.gold[1]);
    for (let i = 0; i < Math.min(coins, 8); i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = rand(40, 90);
      game.loot.push({
        type: 'coin', x: e.x, y: e.y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        value: Math.ceil(coins / Math.min(coins, 8)),
        age: 0, r: 6,
      });
    }
    // poción ocasional
    if (Math.random() < 0.08) {
      game.loot.push({ type: 'hp_potion', x: e.x, y: e.y, vx: 0, vy: 0, age: 0, r: 8 });
    } else if (Math.random() < 0.06) {
      game.loot.push({ type: 'mp_potion', x: e.x, y: e.y, vx: 0, vy: 0, age: 0, r: 8 });
    }

    if (e.isBoss) {
      // ganaste el juego
      setTimeout(triggerWin, 1200);
    }
  }
}

function drawEnemy(e) {
  if (e.dead) return;
  const x = e.x - game.cameraX;
  const y = e.y - game.cameraY;

  ctx.save();
  // sombra
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.ellipse(x, y + e.r * 0.7, e.r * 0.85, e.r * 0.3, 0, 0, Math.PI * 2); ctx.fill();

  const bob = Math.sin(e.walkAnim) * 1.5;
  const flash = e.hurtTime > 0;

  if (e.type === 'slime') {
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.shadowColor = e.glow; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.ellipse(x, y + bob, e.r, e.r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 4, y - 2 + bob, 2, 2);
    ctx.fillRect(x + 2, y - 2 + bob, 2, 2);
  }
  else if (e.type === 'skeleton') {
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.shadowColor = e.glow; ctx.shadowBlur = 8;
    // cuerpo
    ctx.fillRect(x - 5, y - 3 + bob, 10, 10);
    // cabeza
    ctx.beginPath();
    ctx.arc(x, y - 8 + bob, 5, 0, Math.PI * 2);
    ctx.fill();
    // ojos rojos
    ctx.fillStyle = '#f00';
    ctx.shadowColor = '#f00'; ctx.shadowBlur = 6;
    ctx.fillRect(x - 3, y - 9 + bob, 1.5, 1.5);
    ctx.fillRect(x + 1.5, y - 9 + bob, 1.5, 1.5);
  }
  else if (e.type === 'mage') {
    // capa
    ctx.fillStyle = flash ? '#fff' : '#3a1058';
    ctx.shadowColor = e.glow; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x - e.r, y + e.r);
    ctx.lineTo(x, y - e.r);
    ctx.lineTo(x + e.r, y + e.r);
    ctx.closePath();
    ctx.fill();
    // cara
    ctx.fillStyle = flash ? '#fff' : '#000';
    ctx.fillRect(x - 4, y - 4 + bob, 8, 4);
    // ojos brillantes
    ctx.fillStyle = e.glow;
    ctx.fillRect(x - 3, y - 3 + bob, 2, 2);
    ctx.fillRect(x + 1, y - 3 + bob, 2, 2);
  }
  else if (e.type === 'bat') {
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.shadowColor = e.glow; ctx.shadowBlur = 8;
    const wing = Math.sin(e.walkAnim * 3) * 5;
    ctx.beginPath();
    ctx.ellipse(x, y, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // alas
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x - 12, y - wing);
    ctx.lineTo(x - 5, y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + 12, y - wing);
    ctx.lineTo(x + 5, y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f80';
    ctx.fillRect(x - 2, y - 1, 1, 1);
    ctx.fillRect(x + 1, y - 1, 1, 1);
  }
  else if (e.type === 'boss') {
    // BOSS — gran demonio
    ctx.shadowColor = e.glow; ctx.shadowBlur = 24;
    // cuerpo
    ctx.fillStyle = flash ? '#fff' : (e.phase === 2 ? '#801010' : e.color);
    ctx.beginPath();
    ctx.ellipse(x, y + 4 + bob, e.r, e.r * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    // cabeza
    ctx.beginPath();
    ctx.arc(x, y - 12 + bob, 14, 0, Math.PI * 2);
    ctx.fill();
    // cuernos
    ctx.fillStyle = '#1a0a0a';
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 18 + bob);
    ctx.lineTo(x - 16, y - 30 + bob);
    ctx.lineTo(x - 6, y - 22 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 10, y - 18 + bob);
    ctx.lineTo(x + 16, y - 30 + bob);
    ctx.lineTo(x + 6, y - 22 + bob);
    ctx.closePath();
    ctx.fill();
    // ojos
    ctx.fillStyle = '#ff0';
    ctx.shadowColor = '#ff0'; ctx.shadowBlur = 12;
    ctx.fillRect(x - 7, y - 13 + bob, 4, 4);
    ctx.fillRect(x + 3, y - 13 + bob, 4, 4);
    // boca
    ctx.fillStyle = '#400';
    ctx.fillRect(x - 6, y - 5 + bob, 12, 4);
  }
  ctx.restore();

  // barra de vida
  if (e.hp < e.maxHp) {
    const w = e.isBoss ? 80 : 24;
    const h = e.isBoss ? 6 : 3;
    const yoff = e.isBoss ? -38 : -e.r - 6;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - w/2, y + yoff, w, h);
    ctx.fillStyle = e.isBoss ? '#ff3030' : '#f44';
    ctx.fillRect(x - w/2, y + yoff, w * (e.hp / e.maxHp), h);
  }
}

/* ═══════════════════════════════════════════════════════════════════
 *  PROYECTILES
 * ═══════════════════════════════════════════════════════════════════ */
function projectileUpdate(prj, dt) {
  prj.x += prj.vx * dt;
  prj.y += prj.vy * dt;
  prj.life -= dt;

  // colisión con paredes
  if (isWall(Math.floor(prj.x / TILE), Math.floor(prj.y / TILE))) {
    prj._dead = true;
    spawnParticles(prj.x, prj.y, prj.glow, 8);
    return;
  }

  if (prj.friendly) {
    for (const e of game.enemies) {
      if (e.dead) continue;
      if (Math.hypot(prj.x - e.x, prj.y - e.y) < prj.r + e.r) {
        damageEnemy(e, prj.dmg);
        const ang = Math.atan2(prj.vy, prj.vx);
        e.knockX = Math.cos(ang) * 120;
        e.knockY = Math.sin(ang) * 120;
        spawnParticles(prj.x, prj.y, prj.glow, 10);
        prj._dead = true;
        return;
      }
    }
  } else {
    const p = game.player;
    if (Math.hypot(prj.x - p.x, prj.y - p.y) < prj.r + p.r) {
      damagePlayer(p, prj.dmg);
      prj._dead = true;
      spawnParticles(prj.x, prj.y, prj.glow, 10);
    }
  }
  if (prj.life <= 0) prj._dead = true;
}

function drawProjectile(prj) {
  const x = prj.x - game.cameraX;
  const y = prj.y - game.cameraY;
  ctx.save();
  ctx.shadowColor = prj.glow;
  ctx.shadowBlur = 16;
  ctx.fillStyle = prj.color;
  ctx.beginPath();
  ctx.arc(x, y, prj.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, prj.r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ═══════════════════════════════════════════════════════════════════
 *  PARTÍCULAS Y TEXTOS DE DAÑO
 * ═══════════════════════════════════════════════════════════════════ */
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = rand(40, 180);
    game.particles.push({
      x, y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: rand(0.4, 0.9),
      maxLife: 0.9,
      r: rand(1.5, 3.5),
      color,
    });
  }
}

function spawnDamageText(x, y, dmg, crit) {
  game.damageTexts.push({
    x, y, dmg, crit,
    life: 0.9, maxLife: 0.9,
    vy: -55,
    vx: rand(-20, 20),
  });
}

function updateParticles(dt) {
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.life -= dt;
    if (p.life <= 0) game.particles.splice(i, 1);
  }
  for (let i = game.damageTexts.length - 1; i >= 0; i--) {
    const t = game.damageTexts[i];
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.vy += 80 * dt;       // gravedad
    t.life -= dt;
    if (t.life <= 0) game.damageTexts.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of game.particles) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(p.x - game.cameraX, p.y - game.cameraY, p.r * a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawDamageTexts() {
  ctx.save();
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  for (const t of game.damageTexts) {
    const a = Math.max(0, t.life / t.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = t.crit ? '#ffd040' : '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.font = t.crit ? 'bold 18px sans-serif' : 'bold 14px sans-serif';
    const txt = t.crit ? `${t.dmg}!` : `${t.dmg}`;
    const x = t.x - game.cameraX, y = t.y - game.cameraY;
    ctx.strokeText(txt, x, y);
    ctx.fillText(txt, x, y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ═══════════════════════════════════════════════════════════════════
 *  LOOT (oro, pociones, baúles)
 * ═══════════════════════════════════════════════════════════════════ */
function updateLoot(dt) {
  const p = game.player;
  for (let i = game.loot.length - 1; i >= 0; i--) {
    const l = game.loot[i];
    l.age += dt;
    // movimiento
    if (l.vx || l.vy) {
      tryMove(l, l.vx * dt, l.vy * dt);
      l.vx *= 0.9;
      l.vy *= 0.9;
      if (Math.hypot(l.vx, l.vy) < 5) { l.vx = 0; l.vy = 0; }
    }
    // magnetismo
    if (l.type === 'coin' && dist(l, p) < 80) {
      const ang = Math.atan2(p.y - l.y, p.x - l.x);
      const pull = 200;
      l.x += Math.cos(ang) * pull * dt;
      l.y += Math.sin(ang) * pull * dt;
    }
    // pickup
    if (l.type !== 'chest' && dist(l, p) < p.r + l.r) {
      if (l.type === 'coin') {
        game.gold += l.value;
        game.score += l.value;
        Audio.coin();
      } else if (l.type === 'hp_potion') {
        p.hp = Math.min(p.maxHp, p.hp + 35);
        showToast('+35 HP');
        Audio.pickup();
      } else if (l.type === 'mp_potion') {
        p.mp = Math.min(p.maxMp, p.mp + 25);
        showToast('+25 MP');
        Audio.pickup();
      }
      game.loot.splice(i, 1);
    }
  }
}

function drawLoot() {
  for (const l of game.loot) {
    const x = l.x - game.cameraX;
    const y = l.y - game.cameraY;
    ctx.save();
    if (l.type === 'coin') {
      const bob = Math.sin(l.age * 6) * 1.5;
      ctx.shadowColor = '#ffc040';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffd040';
      ctx.beginPath();
      ctx.arc(x, y + bob, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a07020';
      ctx.fillRect(x - 1, y - 2 + bob, 2, 4);
    }
    else if (l.type === 'hp_potion') {
      const bob = Math.sin(l.age * 5) * 2;
      ctx.shadowColor = '#ff4040'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#ff4040';
      ctx.fillRect(x - 4, y - 5 + bob, 8, 10);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(x - 3, y - 8 + bob, 6, 3);
    }
    else if (l.type === 'mp_potion') {
      const bob = Math.sin(l.age * 5) * 2;
      ctx.shadowColor = '#4080ff'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#4080ff';
      ctx.fillRect(x - 4, y - 5 + bob, 8, 10);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(x - 3, y - 8 + bob, 6, 3);
    }
    else if (l.type === 'chest') {
      ctx.fillStyle = l.opened ? '#3a2010' : '#5a3818';
      ctx.fillRect(x - 12, y - 8, 24, 16);
      ctx.fillStyle = '#ffc040';
      ctx.fillRect(x - 12, y - 2, 24, 2);
      ctx.fillRect(x - 1, y - 8, 2, 16);
      if (!l.opened && dist(l, game.player) < 50) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('[E]', x, y - 14);
      }
    }
    ctx.restore();
  }
}

function spawnChest(room) {
  game.loot.push({
    type: 'chest', opened: false,
    x: room.cx * TILE + TILE/2,
    y: room.cy * TILE + TILE/2,
    age: 0, r: 12, vx: 0, vy: 0,
  });
}

function openChest(c) {
  c.opened = true;
  Audio.pickup();
  spawnParticles(c.x, c.y - 6, '#ffd040', 18);
  // 1-3 items
  const n = irand(2, 4);
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    const ang = Math.random() * Math.PI * 2;
    const sp = rand(60, 120);
    if (r < 0.55) {
      game.loot.push({ type: 'coin', x: c.x, y: c.y, vx: Math.cos(ang)*sp, vy: Math.sin(ang)*sp, value: irand(8, 18), age: 0, r: 6 });
    } else if (r < 0.78) {
      game.loot.push({ type: 'hp_potion', x: c.x, y: c.y, vx: Math.cos(ang)*sp, vy: Math.sin(ang)*sp, age: 0, r: 8 });
    } else {
      game.loot.push({ type: 'mp_potion', x: c.x, y: c.y, vx: Math.cos(ang)*sp, vy: Math.sin(ang)*sp, age: 0, r: 8 });
    }
  }
  showToast('¡Baúl abierto!');
}

/* ═══════════════════════════════════════════════════════════════════
 *  RENDER MAPA + ILUMINACIÓN
 * ═══════════════════════════════════════════════════════════════════ */
function drawMap() {
  const startX = Math.max(0, Math.floor(game.cameraX / TILE));
  const startY = Math.max(0, Math.floor(game.cameraY / TILE));
  const endX = Math.min(MAP_W, startX + Math.ceil(VIEW_W / TILE) + 2);
  const endY = Math.min(MAP_H, startY + Math.ceil(VIEW_H / TILE) + 2);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const t = game.map[y][x];
      const px = x * TILE - game.cameraX;
      const py = y * TILE - game.cameraY;
      if (t === T_FLOOR || t === T_STAIR) {
        // patrón pseudo-aleatorio estable
        const hash = (x * 7 + y * 13) % 5;
        const shade = 32 + hash * 4;
        ctx.fillStyle = `rgb(${shade},${shade-6},${shade-12})`;
        ctx.fillRect(px, py, TILE, TILE);
        // grietas sutiles
        if ((x + y) % 7 === 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(px + 4, py + 6, 6, 1);
        }
        if (t === T_STAIR) {
          // halo de fondo pulsante
          const pulse = 0.6 + Math.sin(game.time * 4) * 0.4;
          const cx = px + TILE / 2, cy = py + TILE / 2;
          const grd = ctx.createRadialGradient(cx, cy, 2, cx, cy, TILE);
          grd.addColorStop(0, `rgba(200,120,255,${0.9 * pulse})`);
          grd.addColorStop(0.5, `rgba(140,60,220,${0.5 * pulse})`);
          grd.addColorStop(1, 'rgba(80,20,140,0)');
          ctx.fillStyle = grd;
          ctx.fillRect(px - 8, py - 8, TILE + 16, TILE + 16);
          // hueco oscuro
          ctx.fillStyle = '#1a0828';
          ctx.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
          // peldaños bien visibles
          ctx.fillStyle = '#a060ff';
          ctx.shadowColor = '#d090ff';
          ctx.shadowBlur = 10;
          for (let i = 0; i < 4; i++) {
            ctx.fillRect(px + 6, py + 7 + i * 5, TILE - 12, 2);
          }
          ctx.shadowBlur = 0;
          // marco brillante
          ctx.strokeStyle = `rgba(220,160,255,${pulse})`;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 4, py + 4, TILE - 8, TILE - 8);
          // texto [E] si el jugador está cerca
          const p = game.player;
          if (p) {
            const dx = (cx + game.cameraX) - p.x;
            const dy = (cy + game.cameraY) - p.y;
            if (Math.hypot(dx, dy) < 80) {
              ctx.fillStyle = '#fff';
              ctx.font = 'bold 11px sans-serif';
              ctx.textAlign = 'center';
              ctx.shadowColor = '#000';
              ctx.shadowBlur = 4;
              ctx.fillText('[E] BAJAR', cx, py - 6);
              ctx.shadowBlur = 0;
            }
          }
        }
      } else {
        // pared
        ctx.fillStyle = '#1a1218';
        ctx.fillRect(px, py, TILE, TILE);
        // ladrillos
        ctx.fillStyle = '#0a060a';
        ctx.fillRect(px, py + TILE - 1, TILE, 1);
        ctx.fillRect(px + TILE - 1, py, 1, TILE);
        // top más claro si abajo es piso
        if (y + 1 < MAP_H && game.map[y + 1][x] !== T_WALL) {
          ctx.fillStyle = '#2a1820';
          ctx.fillRect(px, py + TILE - 6, TILE, 6);
          ctx.fillStyle = '#0a0408';
          ctx.fillRect(px, py + TILE - 7, TILE, 1);
        }
      }
    }
  }
}

function drawLighting() {
  // overlay oscuro con destellos de luz
  const lx = ctx;
  // construir un canvas offscreen para luz
  if (!drawLighting.cv) {
    drawLighting.cv = document.createElement('canvas');
    drawLighting.cv.width = VIEW_W;
    drawLighting.cv.height = VIEW_H;
  }
  const lcv = drawLighting.cv;
  const lctx = lcv.getContext('2d');
  lctx.globalCompositeOperation = 'source-over';
  lctx.fillStyle = 'rgba(8, 4, 12, 0.82)';
  lctx.fillRect(0, 0, VIEW_W, VIEW_H);

  lctx.globalCompositeOperation = 'destination-out';
  // luz del jugador
  const p = game.player;
  if (p) {
    const px = p.x - game.cameraX;
    const py = p.y - game.cameraY;
    const grad = lctx.createRadialGradient(px, py, 10, px, py, 180);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    lctx.fillStyle = grad;
    lctx.beginPath();
    lctx.arc(px, py, 180, 0, Math.PI * 2);
    lctx.fill();
  }
  // luz de las escaleras (siempre visibles)
  if (game.rooms) {
    for (const r of game.rooms) {
      if (!r.isStairsRoom) continue;
      const sx = r.cx * TILE + TILE/2 - game.cameraX;
      const sy = r.cy * TILE + TILE/2 - game.cameraY;
      if (sx < -100 || sx > VIEW_W + 100 || sy < -100 || sy > VIEW_H + 100) continue;
      const radius = 90 + Math.sin(game.time * 4) * 8;
      const sgrad = lctx.createRadialGradient(sx, sy, 4, sx, sy, radius);
      sgrad.addColorStop(0, 'rgba(255,255,255,0.95)');
      sgrad.addColorStop(0.6, 'rgba(255,255,255,0.4)');
      sgrad.addColorStop(1, 'rgba(255,255,255,0)');
      lctx.fillStyle = sgrad;
      lctx.beginPath();
      lctx.arc(sx, sy, radius, 0, Math.PI * 2);
      lctx.fill();
    }
  }
  // antorchas
  for (const lt of game.lights) {
    lt.flicker += 0.15;
    const lx2 = lt.x - game.cameraX;
    const ly2 = lt.y - game.cameraY;
    if (lx2 < -lt.r || lx2 > VIEW_W + lt.r || ly2 < -lt.r || ly2 > VIEW_H + lt.r) continue;
    const r = lt.r + Math.sin(lt.flicker) * 6;
    const grad = lctx.createRadialGradient(lx2, ly2, 5, lx2, ly2, r);
    grad.addColorStop(0, 'rgba(255,200,140,1)');
    grad.addColorStop(0.6, 'rgba(255,140,80,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = grad;
    lctx.beginPath();
    lctx.arc(lx2, ly2, r, 0, Math.PI * 2);
    lctx.fill();
  }

  // luz del boss
  for (const e of game.enemies) {
    if (e.isBoss && !e.dead) {
      const ex = e.x - game.cameraX, ey = e.y - game.cameraY;
      const grad = lctx.createRadialGradient(ex, ey, 10, ex, ey, 140);
      grad.addColorStop(0, 'rgba(255,80,80,0.7)');
      grad.addColorStop(1, 'rgba(255,80,80,0)');
      lctx.fillStyle = grad;
      lctx.beginPath();
      lctx.arc(ex, ey, 140, 0, Math.PI * 2);
      lctx.fill();
    }
  }

  ctx.drawImage(lcv, 0, 0);

  // tinte cálido sobre antorchas
  ctx.globalCompositeOperation = 'lighter';
  for (const lt of game.lights) {
    const lx2 = lt.x - game.cameraX;
    const ly2 = lt.y - game.cameraY;
    if (lx2 < -120 || lx2 > VIEW_W + 120 || ly2 < -120 || ly2 > VIEW_H + 120) continue;
    const grad = ctx.createRadialGradient(lx2, ly2, 0, lx2, ly2, 80);
    grad.addColorStop(0, 'rgba(255,160,80,0.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lx2, ly2, 80, 0, Math.PI * 2);
    ctx.fill();
  }
  // tinte morado sobre escaleras
  if (game.rooms) {
    for (const r of game.rooms) {
      if (!r.isStairsRoom) continue;
      const sx = r.cx * TILE + TILE/2 - game.cameraX;
      const sy = r.cy * TILE + TILE/2 - game.cameraY;
      if (sx < -120 || sx > VIEW_W + 120 || sy < -120 || sy > VIEW_H + 120) continue;
      const pulse = 0.18 + Math.sin(game.time * 4) * 0.08;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, 70);
      grad.addColorStop(0, `rgba(180,100,255,${pulse})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, 70, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // dibujar antorcha (sprite)
  for (const lt of game.lights) {
    const lx2 = lt.x - game.cameraX;
    const ly2 = lt.y - game.cameraY;
    if (lx2 < 0 || lx2 > VIEW_W || ly2 < 0 || ly2 > VIEW_H) continue;
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(lx2 - 1.5, ly2 - 2, 3, 8);
    // llama
    const fl = Math.sin(lt.flicker * 1.7) * 1.5;
    ctx.fillStyle = '#ff8030';
    ctx.beginPath();
    ctx.ellipse(lx2, ly2 - 6 + fl, 3, 5 + fl * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd060';
    ctx.beginPath();
    ctx.ellipse(lx2, ly2 - 6 + fl, 1.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ═══════════════════════════════════════════════════════════════════
 *  MINIMAPA
 * ═══════════════════════════════════════════════════════════════════ */
function drawMinimap() {
  const w = minimap.width, h = minimap.height;
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = 'rgba(0,0,0,0.6)';
  mctx.fillRect(0, 0, w, h);
  const sx = w / MAP_W;
  const sy = h / MAP_H;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = game.map[y][x];
      if (t === T_FLOOR) {
        mctx.fillStyle = '#3a2818';
        mctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      } else if (t === T_STAIR) {
        const pulse = 0.7 + Math.sin(game.time * 4) * 0.3;
        mctx.fillStyle = `rgba(200,120,255,${pulse})`;
        mctx.fillRect(x * sx - 2, y * sy - 2, sx + 4, sy + 4);
        mctx.fillStyle = '#fff';
        mctx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      }
    }
  }
  // enemigos
  for (const e of game.enemies) {
    if (e.dead) continue;
    mctx.fillStyle = e.isBoss ? '#ff4040' : '#ff6060';
    const ex = (e.x / TILE) * sx, ey = (e.y / TILE) * sy;
    mctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
  }
  // jugador
  const p = game.player;
  if (p) {
    mctx.fillStyle = '#40c0ff';
    mctx.beginPath();
    mctx.arc((p.x / TILE) * sx, (p.y / TILE) * sy, 2.5, 0, Math.PI * 2);
    mctx.fill();
  }
}

/* ═══════════════════════════════════════════════════════════════════
 *  SPAWNS Y SALAS
 * ═══════════════════════════════════════════════════════════════════ */
function populateFloor(floor) {
  game.enemies = [];
  game.loot = [];
  game.projectiles = [];
  game.particles = [];
  game.damageTexts = [];

  if (floor === game.maxFloor) {
    // boss floor — solo el boss en una sala grande, sin minions
    const bossRoom = game.rooms[0];
    const bx = bossRoom.cx * TILE + TILE/2;
    const by = bossRoom.cy * TILE + TILE/2;
    // boss colocado lejos del start
    let far = bossRoom;
    let bestD = 0;
    for (const r of game.rooms) {
      const d = Math.hypot(r.cx - bossRoom.cx, r.cy - bossRoom.cy);
      if (d > bestD) { bestD = d; far = r; }
    }
    const boss = createBoss(far.cx * TILE + TILE/2, far.cy * TILE + TILE/2);
    boss.room = far;
    game.enemies.push(boss);
    game.bossSpawned = true;

    // pocos minions iniciales para sabor
    for (let i = 0; i < 3; i++) {
      const r = choice(game.rooms);
      if (r === far) continue;
      const x = (r.x + irand(1, r.w - 2)) * TILE + TILE/2;
      const y = (r.y + irand(1, r.h - 2)) * TILE + TILE/2;
      const e = createEnemy(choice(['skeleton','mage']), x, y, floor);
      e.room = r;
      game.enemies.push(e);
    }
    // baúl extra
    spawnChest(game.rooms[1] || far);
    return;
  }

  // pisos normales
  const pool = floor === 1 ? ['slime','bat'] :
               floor === 2 ? ['slime','skeleton','bat'] :
               ['skeleton','mage','bat','slime'];

  for (const r of game.rooms) {
    if (r.isStartRoom) continue;
    const n = irand(2, 4 + floor);
    for (let i = 0; i < n; i++) {
      const ex = (r.x + irand(1, r.w - 2)) * TILE + TILE/2;
      const ey = (r.y + irand(1, r.h - 2)) * TILE + TILE/2;
      const e = createEnemy(choice(pool), ex, ey, floor);
      e.room = r;
      game.enemies.push(e);
      r.enemies.push(e);
    }
  }
  // baúles: ~30% de salas
  for (const r of game.rooms) {
    if (r.isStartRoom) continue;
    if (Math.random() < 0.32) spawnChest(r);
  }
}

function getCurrentRoom(p) {
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  for (const r of game.rooms) {
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
 *  FLUJO DEL JUEGO
 * ═══════════════════════════════════════════════════════════════════ */
function startGame() {
  Audio.init();
  game.state = STATE_PLAY;
  game.floor = 1;
  game.gold = 0;
  game.score = 0;
  game.kills = 0;
  game.bossSpawned = false;
  buildFloor(1);
  hideAllOverlays();
}

function buildFloor(floor) {
  const d = generateDungeon(floor);
  game.map = d.map;
  game.rooms = d.rooms;
  game.lights = d.lights;
  // jugador en sala inicial
  const start = d.startRoom;
  if (game.player) {
    game.player.x = start.cx * TILE + TILE/2;
    game.player.y = start.cy * TILE + TILE/2;
  } else {
    game.player = createPlayer(start.cx * TILE + TILE/2, start.cy * TILE + TILE/2);
  }
  populateFloor(floor);
  floorVal.textContent = floor;
  if (floor === game.maxFloor) showToast('¡EL SEÑOR DE LAS PROFUNDIDADES TE ESPERA!');
  else showToast(`Piso ${floor}`);
}

function goToNextFloor() {
  Audio.stairs();
  const newFloor = game.floor + 1;
  if (newFloor > game.maxFloor) return;
  game.floor = newFloor;
  // upgrade entre pisos
  if (newFloor === 2 || newFloor === 3 || newFloor === 4) {
    showUpgradePicker();
  } else {
    buildFloor(newFloor);
  }
}

function pauseGame() {
  if (game.state !== STATE_PLAY) return;
  game.state = STATE_PAUSE;
  pauseEl.classList.remove('hidden');
}
function resumeGame() {
  if (game.state !== STATE_PAUSE) return;
  game.state = STATE_PLAY;
  pauseEl.classList.add('hidden');
}

function triggerDeath() {
  game.state = STATE_DEAD;
  Audio.death();
  document.getElementById('goFloor').textContent = game.floor;
  document.getElementById('goKills').textContent = game.kills;
  document.getElementById('goGold').textContent  = game.gold;
  document.getElementById('goScore').textContent = game.score;
  setTimeout(() => gameOverEl.classList.remove('hidden'), 600);
}

function triggerWin() {
  game.state = STATE_WIN;
  Audio.win();
  document.getElementById('winKills').textContent = game.kills;
  document.getElementById('winGold').textContent  = game.gold;
  document.getElementById('winScore').textContent = game.score;
  winEl.classList.remove('hidden');
}

function hideAllOverlays() {
  menuEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
  gameOverEl.classList.add('hidden');
  winEl.classList.add('hidden');
  upgradeEl.classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════════════
 *  UPGRADES
 * ═══════════════════════════════════════════════════════════════════ */
const UPGRADES = [
  { id: 'sword',   icon: '⚔', name: 'FILO AGUDO',   desc: '+10 daño de espada y +4 alcance.' },
  { id: 'magic',   icon: '✦', name: 'PODER ARCANO',  desc: '+8 daño mágico y regen MP mejorado.' },
  { id: 'speed',   icon: '⚡', name: 'PIES LIGEROS', desc: '+15% velocidad de movimiento.' },
  { id: 'vampire', icon: '✤', name: 'SED DE SANGRE', desc: 'Robas vida con cada golpe de espada.' },
  { id: 'regen',   icon: '✚', name: 'REGENERACIÓN', desc: 'Regeneras HP lentamente.' },
  { id: 'crit',    icon: '✸', name: 'GOLPE LETAL',   desc: '12% probabilidad de crítico x2.' },
  { id: 'maxhp',   icon: '♥', name: 'VITALIDAD',     desc: '+30 HP máximo y cura completa.' },
  { id: 'maxmp',   icon: '◆', name: 'INTELECTO',     desc: '+25 MP máximo y restaura MP.' },
];

function showUpgradePicker() {
  game.state = STATE_UPGRADE;
  upgradeEl.classList.remove('hidden');
  // 3 únicos al azar
  const pool = UPGRADES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  upgradeOpts.innerHTML = '';
  for (const u of pool) {
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `
      <div class="icon">${u.icon}</div>
      <div class="name">${u.name}</div>
      <div class="desc">${u.desc}</div>
    `;
    card.addEventListener('click', () => applyUpgrade(u.id));
    upgradeOpts.appendChild(card);
  }
}

function applyUpgrade(id) {
  const p = game.player;
  if (id === 'sword')   p.upgrades.sword++;
  else if (id === 'magic')   p.upgrades.magic++;
  else if (id === 'speed')   p.upgrades.speed++;
  else if (id === 'vampire') p.upgrades.vampire++;
  else if (id === 'regen')   p.upgrades.regen++;
  else if (id === 'crit')    p.upgrades.crit++;
  else if (id === 'maxhp')   { p.maxHp += 30; p.hp = p.maxHp; }
  else if (id === 'maxmp')   { p.maxMp += 25; p.mp = p.maxMp; }
  Audio.upgrade();
  upgradeEl.classList.add('hidden');
  game.state = STATE_PLAY;
  buildFloor(game.floor);
}

/* ═══════════════════════════════════════════════════════════════════
 *  TOAST
 * ═══════════════════════════════════════════════════════════════════ */
function showToast(text) {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = text;
  toastEl.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/* ═══════════════════════════════════════════════════════════════════
 *  CÁMARA
 * ═══════════════════════════════════════════════════════════════════ */
function updateCamera() {
  const p = game.player;
  let tx = p.x - VIEW_W / 2;
  let ty = p.y - VIEW_H / 2;
  tx = clamp(tx, 0, MAP_W * TILE - VIEW_W);
  ty = clamp(ty, 0, MAP_H * TILE - VIEW_H);
  // suavizado
  game.cameraX = lerp(game.cameraX, tx, 0.15);
  game.cameraY = lerp(game.cameraY, ty, 0.15);
  // shake
  if (game.shake > 0.1) {
    game.cameraX += rand(-game.shake, game.shake);
    game.cameraY += rand(-game.shake, game.shake);
    game.shake *= 0.85;
  }
}

/* ═══════════════════════════════════════════════════════════════════
 *  HUD
 * ═══════════════════════════════════════════════════════════════════ */
function updateHUD() {
  const p = game.player;
  if (!p) return;
  hpBar.style.width = `${(p.hp / p.maxHp) * 100}%`;
  hpText.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
  mpBar.style.width = `${(p.mp / p.maxMp) * 100}%`;
  mpText.textContent = `${Math.ceil(p.mp)}/${p.maxMp}`;
  goldVal.textContent = game.gold;
  scoreVal.textContent = game.score;

  // buffs
  buffsEl.innerHTML = '';
  if (p.upgrades.sword)   buffsEl.innerHTML += `<div class="buff">⚔ ×${p.upgrades.sword}</div>`;
  if (p.upgrades.magic)   buffsEl.innerHTML += `<div class="buff">✦ ×${p.upgrades.magic}</div>`;
  if (p.upgrades.speed)   buffsEl.innerHTML += `<div class="buff">⚡ ×${p.upgrades.speed}</div>`;
  if (p.upgrades.vampire) buffsEl.innerHTML += `<div class="buff">✤ ×${p.upgrades.vampire}</div>`;
  if (p.upgrades.regen)   buffsEl.innerHTML += `<div class="buff">✚ ×${p.upgrades.regen}</div>`;
  if (p.upgrades.crit)    buffsEl.innerHTML += `<div class="buff">✸ ×${p.upgrades.crit}</div>`;
}

/* ═══════════════════════════════════════════════════════════════════
 *  GAME LOOP
 * ═══════════════════════════════════════════════════════════════════ */
function update(dt) {
  if (game.state !== STATE_PLAY) return;
  game.time += dt;

  playerUpdate(game.player, dt);
  game.currentRoom = getCurrentRoom(game.player);

  for (const e of game.enemies) enemyUpdate(e, dt);
  game.enemies = game.enemies.filter(e => !e.dead);

  for (const prj of game.projectiles) projectileUpdate(prj, dt);
  game.projectiles = game.projectiles.filter(p => !p._dead);

  updateLoot(dt);
  updateParticles(dt);
  updateCamera();
  updateHUD();
}

function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  if (!game.map) return;

  drawMap();
  drawLoot();
  for (const e of game.enemies) drawEnemy(e);
  if (game.player) drawPlayer(game.player);
  for (const prj of game.projectiles) drawProjectile(prj);
  drawParticles();
  drawDamageTexts();
  drawLighting();

  // boss healthbar overlay
  for (const e of game.enemies) {
    if (e.isBoss && !e.dead) {
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
  }

  drawMinimap();
}

function loop(now) {
  const dt = Math.min(0.05, (now - game.lastTime) / 1000);
  game.lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

/* ═══════════════════════════════════════════════════════════════════
 *  EVENTOS UI
 * ═══════════════════════════════════════════════════════════════════ */
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('quitBtn').addEventListener('click', () => {
  game.state = STATE_MENU;
  hideAllOverlays();
  menuEl.classList.remove('hidden');
});
document.getElementById('retryBtn').addEventListener('click', () => {
  hideAllOverlays();
  startGame();
});
document.getElementById('winBtn').addEventListener('click', () => {
  hideAllOverlays();
  startGame();
});

/* arranque */
game.lastTime = performance.now();
requestAnimationFrame(loop);

})();
