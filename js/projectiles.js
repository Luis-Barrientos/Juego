/**
 * Friendly and hostile projectiles.
 */

import { state } from './state.js';
import { isWall } from './dungeon.js';
import { spawnParticles } from './particles.js';
import { TILE } from './config.js';

/**
 * @param {object} prj
 * @param {number} dt
 * @param {{ onEnemyHit: (e:object, dmg:number) => void, onPlayerHit: (dmg:number) => void }} hooks
 */
export function projectileUpdate(prj, dt, hooks) {
  prj.x += prj.vx * dt;
  prj.y += prj.vy * dt;
  prj.life -= dt;

  if (isWall(state.map, Math.floor(prj.x / TILE), Math.floor(prj.y / TILE))) {
    prj._dead = true;
    spawnParticles(prj.x, prj.y, prj.glow, 8);
    return;
  }

  if (prj.friendly) {
    for (const e of state.enemies) {
      if (e.dead) continue;
      if (Math.hypot(prj.x - e.x, prj.y - e.y) < prj.r + e.r) {
        hooks.onEnemyHit(e, prj.dmg);
        const ang = Math.atan2(prj.vy, prj.vx);
        e.knockX = Math.cos(ang) * 120;
        e.knockY = Math.sin(ang) * 120;
        spawnParticles(prj.x, prj.y, prj.glow, 10);
        prj._dead = true;
        return;
      }
    }
  } else {
    const p = state.player;
    if (Math.hypot(prj.x - p.x, prj.y - p.y) < prj.r + p.r) {
      hooks.onPlayerHit(prj.dmg);
      prj._dead = true;
      spawnParticles(prj.x, prj.y, prj.glow, 10);
    }
  }
  if (prj.life <= 0) prj._dead = true;
}

export function drawProjectile(ctx, prj) {
  const x = prj.x - state.cameraX;
  const y = prj.y - state.cameraY;
  ctx.save();
  ctx.shadowColor = prj.glow;
  ctx.shadowBlur = 16;
  ctx.fillStyle = prj.color;
  ctx.beginPath(); ctx.arc(x, y, prj.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y, prj.r * 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
