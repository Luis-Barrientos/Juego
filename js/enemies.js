/**
 * Enemy archetypes, AI, boss logic and rendering.
 */

import { state } from './state.js';
import { Audio } from './audio.js';
import { tryMove, isWall } from './dungeon.js';
import { spawnParticles, spawnDamageText } from './particles.js';
import { irand, rand, choice } from './utils.js';
import { TILE } from './config.js';
import { spawnProp } from './loot.js';

/** Static stats for each enemy archetype. */
export const ENEMY_TYPES = {
  slime: {
    hp: 35, dmg: 10, speed: 50, r: 11,
    color: '#60c060', glow: '#80ff80',
    score: 15, gold: [3, 7],
    range: 22, attackCool: 0.9, behavior: 'melee',
  },
  skeleton: {
    hp: 50, dmg: 14, speed: 90, r: 10,
    color: '#e0e0d0', glow: '#ffffff',
    score: 25, gold: [5, 12],
    range: 26, attackCool: 0.7, behavior: 'melee',
  },
  mage: {
    hp: 40, dmg: 16, speed: 65, r: 10,
    color: '#a040c0', glow: '#e080ff',
    score: 40, gold: [8, 18],
    range: 220, attackCool: 1.4, behavior: 'ranged',
  },
  bat: {
    hp: 22, dmg: 8, speed: 130, r: 8,
    color: '#403040', glow: '#806080',
    score: 18, gold: [2, 6],
    range: 22, attackCool: 0.6, behavior: 'melee',
  },
};

/**
 * Build a regular enemy scaled to the current floor.
 */
export function createEnemy(type, x, y, floor) {
  const t = ENEMY_TYPES[type];
  const scale = 1 + (floor - 1) * 0.18;
  return {
    type, x, y, r: t.r,
    hp: Math.round(t.hp * scale),
    maxHp: Math.round(t.hp * scale),
    dmg: Math.round(t.dmg * scale),
    speed: t.speed,
    score: Math.round(t.score * scale),
    color: t.color, glow: t.glow,
    range: t.range,
    attackCool: 0,
    attackRate: t.attackCool,
    behavior: t.behavior,
    state: 'idle',
    knockX: 0, knockY: 0,
    hurtTime: 0,
    dead: false,
    walkAnim: Math.random() * Math.PI * 2,
    gold: t.gold,
    room: null,
  };
}

/**
 * Build the final boss.
 */
export function createBoss(x, y) {
  return {
    type: 'boss', x, y, r: 22,
    hp: 600, maxHp: 600,
    dmg: 25, speed: 70, score: 1000,
    color: '#c02020', glow: '#ff4040',
    range: 280, attackCool: 0,
    attackRate: 1.4, behavior: 'boss',
    state: 'idle', phase: 1, phaseTimer: 0,
    knockX: 0, knockY: 0, hurtTime: 0,
    dead: false, walkAnim: 0,
    gold: [100, 200],
    isBoss: true,
  };
}

/**
 * Per-frame enemy update. Activation depends on whether the enemy
 * is in the player's current room, or the player is close enough.
 */
export function enemyUpdate(e, dt, hooks) {
  if (e.dead) return;
  e.hurtTime  = Math.max(0, e.hurtTime  - dt);
  e.attackCool = Math.max(0, e.attackCool - dt);
  e.walkAnim += dt * 6;

  // Knockback decay
  if (Math.abs(e.knockX) > 1 || Math.abs(e.knockY) > 1) {
    tryMove(state.map, e, e.knockX * dt, e.knockY * dt);
    e.knockX *= 0.85;
    e.knockY *= 0.85;
  }

  const p = state.player;
  const dx = p.x - e.x, dy = p.y - e.y;
  const d  = Math.hypot(dx, dy);

  const inActiveRoom = (e.room && e.room === state.currentRoom) || e.isBoss;
  if (!inActiveRoom && d > 350) return;

  if (e.behavior === 'boss') {
    bossAI(e, dt, dx, dy, d, hooks);
    return;
  }

  if (e.behavior === 'melee') {
    if (d > e.range + p.r) {
      const sp = e.speed;
      tryMove(state.map, e, (dx / d) * sp * dt, (dy / d) * sp * dt);
      e.state = 'chase';
    } else {
      e.state = 'attack';
      if (e.attackCool <= 0) {
        e.attackCool = e.attackRate;
        hooks.onPlayerHit(e.dmg, e);
      }
    }
  } else if (e.behavior === 'ranged') {
    const ideal = 140;
    let mx = 0, my = 0;
    if (d < 80) { mx = -dx / d; my = -dy / d; }
    else if (d > ideal + 40) { mx = dx / d; my = dy / d; }
    if (mx || my) tryMove(state.map, e, mx * e.speed * dt, my * e.speed * dt);
    if (d <= e.range && e.attackCool <= 0) {
      e.attackCool = e.attackRate;
      const ang = Math.atan2(dy, dx);
      const speed = 220;
      state.projectiles.push({
        friendly: false, x: e.x, y: e.y, r: 6,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        life: 2.5, dmg: e.dmg,
        color: '#ff60ff', glow: '#ff80ff',
        type: 'magic',
      });
      Audio.magicShoot();
    }
  }
}

/** @private */
function bossAI(b, dt, dx, dy, d, hooks) {
  b.phaseTimer += dt;
  if (b.hp < b.maxHp * 0.5) b.phase = 2;

  if (d > 80) {
    tryMove(state.map, b, (dx / d) * b.speed * dt, (dy / d) * b.speed * dt);
  }

  if (b.attackCool <= 0) {
    if (b.phase === 1) {
      for (let i = 0; i < 8; i++) {
        const ang = (Math.PI * 2 * i / 8) + b.phaseTimer * 0.3;
        state.projectiles.push({
          friendly: false, x: b.x, y: b.y, r: 7,
          vx: Math.cos(ang) * 180, vy: Math.sin(ang) * 180,
          life: 3, dmg: b.dmg, color: '#ff4040', glow: '#ffa080', type: 'magic',
        });
      }
      b.attackCool = 1.8;
    } else {
      const a = Math.atan2(dy, dx);
      for (let i = -2; i <= 2; i++) {
        const ang = a + i * 0.18;
        state.projectiles.push({
          friendly: false, x: b.x, y: b.y, r: 7,
          vx: Math.cos(ang) * 240, vy: Math.sin(ang) * 240,
          life: 2.5, dmg: b.dmg, color: '#ff2020', glow: '#ff8060', type: 'magic',
        });
      }
      if (Math.random() < 0.4) {
        for (let i = 0; i < 12; i++) {
          const ang = (Math.PI * 2 * i / 12);
          state.projectiles.push({
            friendly: false, x: b.x, y: b.y, r: 6,
            vx: Math.cos(ang) * 150, vy: Math.sin(ang) * 150,
            life: 3, dmg: b.dmg * 0.7, color: '#ff60a0', glow: '#ffa0c0', type: 'magic',
          });
        }
      }
      b.attackCool = 1.1;
    }
    Audio.bossHit();
  }

  if (d < b.r + state.player.r + 4) {
    if (!b._touchCool || b._touchCool <= 0) {
      hooks.onPlayerHit(b.dmg, b);
      b._touchCool = 0.7;
    }
  }
  if (b._touchCool > 0) b._touchCool -= dt;
}

/**
 * Apply damage to an enemy, spawn FX, drop loot on kill.
 * @param {object} e
 * @param {number} dmg
 * @param {boolean} crit
 * @param {object} hooks { onWin, onLootDrop }
 */
export function damageEnemy(e, dmg, crit, hooks) {
  e.hp -= dmg;
  e.hurtTime = 0.15;
  spawnDamageText(e.x, e.y - e.r, dmg, !!crit);
  spawnParticles(e.x, e.y, e.color, 6);
  if (e.isBoss) Audio.bossHit();

  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    state.kills++;
    state.score += e.score;
    spawnParticles(e.x, e.y, e.color, 30);
    spawnParticles(e.x, e.y, e.glow, 14);
    state.shake = Math.min(14, state.shake + (e.isBoss ? 14 : 4));
    Audio.enemyDie();

    const goldMul = 1 + ((state.player && state.player.goldBonus) || 0);
    const coins = Math.max(1, Math.round(irand(e.gold[0], e.gold[1]) * goldMul));
    const splits = Math.min(coins, 8);
    for (let i = 0; i < splits; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp  = rand(40, 90);
      state.loot.push({
        type: 'coin', x: e.x, y: e.y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        value: Math.ceil(coins / splits),
        age: 0, r: 6,
      });
    }
    if (Math.random() < 0.08) {
      state.loot.push({ type: 'hp_potion', x: e.x, y: e.y, vx: 0, vy: 0, age: 0, r: 8 });
    } else if (Math.random() < 0.06) {
      state.loot.push({ type: 'mp_potion', x: e.x, y: e.y, vx: 0, vy: 0, age: 0, r: 8 });
    }

    if (e.isBoss) hooks.onWin();
  }
}

/**
 * Render an enemy. The look depends on `e.type`.
 */
export function drawEnemy(ctx, e) {
  if (e.dead) return;
  const x = e.x - state.cameraX;
  const y = e.y - state.cameraY;
  const flash = e.hurtTime > 0;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y + e.r * 0.7, e.r * 0.85, e.r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  const bob = Math.sin(e.walkAnim) * 1.5;

  if (e.type === 'slime') {
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.shadowColor = e.glow; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.ellipse(x, y + bob, e.r, e.r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 4, y - 2 + bob, 2, 2);
    ctx.fillRect(x + 2, y - 2 + bob, 2, 2);
  } else if (e.type === 'skeleton') {
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.shadowColor = e.glow; ctx.shadowBlur = 8;
    ctx.fillRect(x - 5, y - 3 + bob, 10, 10);
    ctx.beginPath(); ctx.arc(x, y - 8 + bob, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f00';
    ctx.shadowColor = '#f00'; ctx.shadowBlur = 6;
    ctx.fillRect(x - 3, y - 9 + bob, 1.5, 1.5);
    ctx.fillRect(x + 1.5, y - 9 + bob, 1.5, 1.5);
  } else if (e.type === 'mage') {
    ctx.fillStyle = flash ? '#fff' : '#3a1058';
    ctx.shadowColor = e.glow; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x - e.r, y + e.r);
    ctx.lineTo(x, y - e.r);
    ctx.lineTo(x + e.r, y + e.r);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = flash ? '#fff' : '#000';
    ctx.fillRect(x - 4, y - 4 + bob, 8, 4);
    ctx.fillStyle = e.glow;
    ctx.fillRect(x - 3, y - 3 + bob, 2, 2);
    ctx.fillRect(x + 1, y - 3 + bob, 2, 2);
  } else if (e.type === 'bat') {
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.shadowColor = e.glow; ctx.shadowBlur = 8;
    const wing = Math.sin(e.walkAnim * 3) * 5;
    ctx.beginPath(); ctx.ellipse(x, y, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 4, y); ctx.lineTo(x - 12, y - wing); ctx.lineTo(x - 5, y + 2);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 4, y); ctx.lineTo(x + 12, y - wing); ctx.lineTo(x + 5, y + 2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f80';
    ctx.fillRect(x - 2, y - 1, 1, 1);
    ctx.fillRect(x + 1, y - 1, 1, 1);
  } else if (e.type === 'boss') {
    ctx.shadowColor = e.glow; ctx.shadowBlur = 24;
    ctx.fillStyle = flash ? '#fff' : (e.phase === 2 ? '#801010' : e.color);
    ctx.beginPath();
    ctx.ellipse(x, y + 4 + bob, e.r, e.r * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - 12 + bob, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a0a0a';
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 18 + bob);
    ctx.lineTo(x - 16, y - 30 + bob);
    ctx.lineTo(x - 6,  y - 22 + bob);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + 10, y - 18 + bob);
    ctx.lineTo(x + 16, y - 30 + bob);
    ctx.lineTo(x + 6,  y - 22 + bob);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff0';
    ctx.shadowColor = '#ff0'; ctx.shadowBlur = 12;
    ctx.fillRect(x - 7, y - 13 + bob, 4, 4);
    ctx.fillRect(x + 3, y - 13 + bob, 4, 4);
    ctx.fillStyle = '#400';
    ctx.fillRect(x - 6, y - 5 + bob, 12, 4);
  }
  ctx.restore();

  // Health bar
  if (e.hp < e.maxHp) {
    const w    = e.isBoss ? 80 : 24;
    const h    = e.isBoss ? 6  : 3;
    const yoff = e.isBoss ? -38 : -e.r - 6;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - w / 2, y + yoff, w, h);
    ctx.fillStyle = e.isBoss ? '#ff3030' : '#f44';
    ctx.fillRect(x - w / 2, y + yoff, w * (e.hp / e.maxHp), h);
  }
}

/**
 * Spawn enemies and chests for a regular floor.
 * Caller passes a callback to spawn chests via loot module.
 */
export function populateFloor(floor, maxFloor, spawnChest) {
  state.enemies = [];
  state.loot = [];
  state.projectiles = [];
  state.particles = [];
  state.damageTexts = [];

  if (floor === maxFloor) {
    // Boss floor
    const bossRoom = state.rooms[0];
    let far = bossRoom;
    let bestD = 0;
    for (const r of state.rooms) {
      const d = Math.hypot(r.cx - bossRoom.cx, r.cy - bossRoom.cy);
      if (d > bestD) { bestD = d; far = r; }
    }
    const boss = createBoss(far.cx * TILE + TILE / 2, far.cy * TILE + TILE / 2);
    boss.room = far;
    state.enemies.push(boss);
    state.bossSpawned = true;

    for (let i = 0; i < 3; i++) {
      const r = choice(state.rooms);
      if (r === far) continue;
      const ex = (r.x + irand(1, r.w - 2)) * TILE + TILE / 2;
      const ey = (r.y + irand(1, r.h - 2)) * TILE + TILE / 2;
      const e = createEnemy(choice(['skeleton', 'mage']), ex, ey, floor);
      e.room = r;
      state.enemies.push(e);
    }
    if (state.rooms[1]) spawnChest(state.rooms[1]);
    return;
  }

  const pool = floor === 1 ? ['slime', 'bat']
             : floor === 2 ? ['slime', 'skeleton', 'bat']
             : ['skeleton', 'mage', 'bat', 'slime'];

  for (const r of state.rooms) {
    if (r.isStartRoom) continue;
    // Density scales with room area: ~1 enemy per 28 tiles, clamped to a
    // sensible band so tiny rooms still pose a threat and star rooms
    // don't become slaughterhouses.
    const area = r.w * r.h;
    const base = Math.ceil(area / 28);
    const n    = Math.max(2, Math.min(4 + floor, base + irand(0, 1 + Math.floor(floor / 2))));
    for (let i = 0; i < n; i++) {
      const ex = (r.x + irand(1, r.w - 2)) * TILE + TILE / 2;
      const ey = (r.y + irand(1, r.h - 2)) * TILE + TILE / 2;
      const e = createEnemy(choice(pool), ex, ey, floor);
      e.room = r;
      state.enemies.push(e);
      r.enemies.push(e);
    }
  }
  for (const r of state.rooms) {
    if (r.isStartRoom || r.isStairsRoom) continue;
    // Star rooms get two small chests grouped near the centre instead of
    // a single one — feels more rewarding to clear.
    if (r.isLarge) {
      if (Math.random() < 0.85) {
        spawnChest(r, { rare: Math.random() < 0.18 });
        const dx = (Math.random() < 0.5 ? -1 : 1);
        const dy = (Math.random() < 0.5 ? -1 : 1);
        spawnChest({ ...r, cx: r.cx + dx, cy: r.cy + dy }, { rare: false });
      }
    } else if (Math.random() < 0.32) {
      spawnChest(r, { rare: Math.random() < 0.18 });
    }
  }

  // Breakable props scattered through non-start rooms.
  for (const r of state.rooms) {
    if (r.isStartRoom) continue;
    placeProps(r, floor);
  }
}

/**
 * Place 1-4 breakable props (pots, barrels, urns) in a room. Props sit on
 * empty floor tiles and avoid the room centre (where the chest goes) and
 * walls (which include pillars).
 * @private
 */
function placeProps(r, floor) {
  const variants = ['pot', 'barrel', 'urn'];
  const area = r.w * r.h;
  const target = Math.max(1, Math.min(5, Math.floor(area / 18)));
  let placed = 0, attempts = 0;
  while (placed < target && attempts < 30) {
    attempts++;
    const tx = r.x + irand(1, r.w - 2);
    const ty = r.y + irand(1, r.h - 2);
    if (isWall(state.map, tx, ty)) continue;
    if (Math.abs(tx - r.cx) < 2 && Math.abs(ty - r.cy) < 2) continue;
    const px = tx * TILE + TILE / 2;
    const py = ty * TILE + TILE / 2;
    // Avoid stacking on existing loot/props/chests.
    let blocked = false;
    for (const l of state.loot) {
      if (Math.hypot(l.x - px, l.y - py) < 18) { blocked = true; break; }
    }
    if (blocked) continue;
    spawnProp(px, py, choice(variants));
    placed++;
  }
}
