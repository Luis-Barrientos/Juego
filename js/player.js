/**
 * Player entity: stats, controls, swing logic, magic shooting.
 */

import { state } from './state.js';
import { input } from './input.js';
import { Audio } from './audio.js';
import { tryMove, isWall } from './dungeon.js';
import { spawnParticles } from './particles.js';
import { TILE, T_STAIR, PLAYER_BASE } from './config.js';

/**
 * Build a fresh player object with baseline stats.
 * @param {number} x world-space X
 * @param {number} y world-space Y
 */
export function createPlayer(x, y) {
  return {
    x, y, r: 10,
    hp: PLAYER_BASE.hp, maxHp: PLAYER_BASE.hp,
    mp: PLAYER_BASE.mp, maxMp: PLAYER_BASE.mp,
    speed: PLAYER_BASE.speed,
    dirX: 0, dirY: 1,
    facing: 'down',
    swingTime: 0,
    swingCool: 0,
    swingDur:   PLAYER_BASE.swingDur,
    swingRange: PLAYER_BASE.swingRange,
    swingArc:   PLAYER_BASE.swingArc,
    swingDmg:   PLAYER_BASE.swingDmg,
    magicCool: 0,
    magicDmg:  PLAYER_BASE.magicDmg,
    magicCost: PLAYER_BASE.magicCost,
    iframes: 0,
    mpRegen: PLAYER_BASE.mpRegen,
    walkAnim: 0,
    swingAngle: 0,
    upgrades: { speed: 0, sword: 0, magic: 0, vampire: 0, regen: 0, crit: 0 },
  };
}

/**
 * Per-frame update for the player.
 * @param {object} p
 * @param {number} dt seconds since last frame
 * @param {(p: object, dmg: number) => void} onPlayerDie called when hp <= 0
 * @param {() => void} onStairs called when player stands on stair tile and presses E
 * @param {(chest: object) => void} onChest called when interacting with a chest
 * @param {(e: object, dmg: number, crit: boolean) => void} onEnemyHit
 */
export function playerUpdate(p, dt, hooks) {
  const { onStairs, onChest, onEnemyHit } = hooks;

  // Movement
  let mx = 0, my = 0;
  if (input.keys['KeyA'] || input.keys['ArrowLeft'])  mx -= 1;
  if (input.keys['KeyD'] || input.keys['ArrowRight']) mx += 1;
  if (input.keys['KeyW'] || input.keys['ArrowUp'])    my -= 1;
  if (input.keys['KeyS'] || input.keys['ArrowDown'])  my += 1;
  if (mx || my) {
    const len = Math.hypot(mx, my);
    mx /= len; my /= len;
    const sp = p.speed * (1 + p.upgrades.speed * 0.15);
    tryMove(state.map, p, mx * sp * dt, my * sp * dt);
    p.dirX = mx; p.dirY = my;
    p.facing = Math.abs(my) > Math.abs(mx)
      ? (my < 0 ? 'up' : 'down')
      : (mx < 0 ? 'left' : 'right');
    p.walkAnim += dt * 8;
  }

  // Aim
  const aimDx = (input.mouseX + state.cameraX) - p.x;
  const aimDy = (input.mouseY + state.cameraY) - p.y;

  // Sword
  p.swingCool -= dt;
  p.swingTime -= dt;
  if ((input.mouseDown || input.keys['KeyZ']) && p.swingCool <= 0) {
    p.swingCool  = p.swingDur + 0.1;
    p.swingTime  = p.swingDur;
    p.swingAngle = Math.atan2(aimDy, aimDx);
    Audio.swordSwing();
    doSwordHit(p, onEnemyHit);
  }

  // Magic
  p.magicCool -= dt;
  if ((input.rightDown || input.keys['KeyX']) && p.magicCool <= 0 && p.mp >= p.magicCost) {
    p.magicCool = 0.35;
    p.mp -= p.magicCost;
    Audio.magicShoot();
    const speed = 380;
    const angle = Math.atan2(aimDy, aimDx);
    state.projectiles.push({
      friendly: true,
      x: p.x, y: p.y, r: 6,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.6,
      dmg: p.magicDmg + p.upgrades.magic * 8,
      color: '#a060ff', glow: '#d0a0ff',
      type: 'magic',
    });
  }

  p.iframes = Math.max(0, p.iframes - dt);
  p.mp = Math.min(p.maxMp, p.mp + (p.mpRegen + p.upgrades.magic * 0.5) * dt);
  if (p.upgrades.regen > 0) {
    p.hp = Math.min(p.maxHp, p.hp + p.upgrades.regen * 0.6 * dt);
  }

  // Interact
  if (input.keys['KeyE']) {
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    if (state.map[ty] && state.map[ty][tx] === T_STAIR) {
      input.keys['KeyE'] = false;
      onStairs();
    }
    for (const l of state.loot) {
      if (l.type === 'chest' && !l.opened &&
          Math.hypot(p.x - l.x, p.y - l.y) < 28) {
        input.keys['KeyE'] = false;
        onChest(l);
        break;
      }
    }
  }
}

/**
 * Resolve a sword hit against all enemies in arc.
 * @private
 */
function doSwordHit(p, onEnemyHit) {
  const range = p.swingRange + p.upgrades.sword * 4;
  const dmg   = p.swingDmg   + p.upgrades.sword * 10;
  let landed = 0;

  for (const e of state.enemies) {
    if (e.dead) continue;
    const ex = e.x - p.x, ey = e.y - p.y;
    const d  = Math.hypot(ex, ey);
    if (d > range + e.r) continue;
    const ang = Math.atan2(ey, ex);
    let diff = Math.abs(ang - p.swingAngle);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < p.swingArc / 2) {
      const isCrit = Math.random() < p.upgrades.crit * 0.12;
      const finalDmg = Math.round(dmg * (isCrit ? 2 : 1));
      onEnemyHit(e, finalDmg, isCrit);
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      e.knockX = Math.cos(a) * 180;
      e.knockY = Math.sin(a) * 180;
      if (p.upgrades.vampire > 0) {
        p.hp = Math.min(p.maxHp, p.hp + p.upgrades.vampire * 1.5);
      }
      landed++;
    }
  }
  if (landed) {
    state.shake = Math.min(8, state.shake + 4);
    Audio.hit();
  }
}

/** Apply damage to the player respecting i-frames. */
export function damagePlayer(p, dmg, onDeath, attacker) {
  if (p.iframes > 0) return;
  if (p.dmgReduce) dmg *= Math.max(0.1, 1 - p.dmgReduce);
  p.hp -= dmg;
  p.iframes = 0.6 * (p.iframesMul || 1);
  state.shake = Math.min(14, state.shake + 6);
  Audio.playerHurt();
  spawnParticles(p.x, p.y, '#ff4040', 12);
  // Thorns: reflect a fraction back to the attacker.
  if (p.thorns && attacker && !attacker.dead) {
    const reflect = Math.max(1, Math.round(dmg * p.thorns));
    attacker.hp -= reflect;
    spawnParticles(attacker.x, attacker.y, '#ffffff', 6);
  }
  if (p.hp <= 0) {
    p.hp = 0;
    onDeath();
  }
}

/** Render the player. */
export function drawPlayer(ctx, p) {
  const x = p.x - state.cameraX;
  const y = p.y - state.cameraY;
  const blink = p.iframes > 0 && Math.floor(p.iframes * 16) % 2;
  if (blink) return;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(x, y + 10, 10, 4, 0, 0, Math.PI * 2); ctx.fill();

  const bob = Math.sin(p.walkAnim) * 1.6;

  ctx.fillStyle = '#5a2a8a';
  ctx.beginPath();
  ctx.ellipse(x, y + 2 + bob, 11, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#d0a060';
  ctx.fillRect(x - 6, y - 6 + bob, 12, 14);

  ctx.fillStyle = '#f0c890';
  ctx.beginPath();
  ctx.arc(x, y - 10 + bob, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#888';
  ctx.fillRect(x - 6, y - 14 + bob, 12, 5);
  ctx.fillStyle = '#aaa';
  ctx.fillRect(x - 6, y - 14 + bob, 12, 1);

  ctx.fillStyle = '#000';
  if (p.facing === 'down') {
    ctx.fillRect(x - 3, y - 9 + bob, 1.5, 1.5);
    ctx.fillRect(x + 1.5, y - 9 + bob, 1.5, 1.5);
  } else if (p.facing === 'left') {
    ctx.fillRect(x - 4, y - 9 + bob, 1.5, 1.5);
  } else if (p.facing === 'right') {
    ctx.fillRect(x + 2.5, y - 9 + bob, 1.5, 1.5);
  }

  if (p.upgrades.regen > 0) {
    ctx.strokeStyle = 'rgba(80,200,120,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 16 + Math.sin(state.time * 4) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }

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
    ctx.strokeStyle = 'rgba(255,220,100,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, len, p.swingAngle - p.swingArc / 2, ang);
    ctx.stroke();
  }
  ctx.restore();
}
