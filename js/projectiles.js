/**
 * Friendly and hostile projectiles.
 */

import { state } from './state.js';
import { isWall } from './dungeon.js';
import { spawnParticles } from './particles.js';
import { breakProp } from './loot.js';
import { hitRunePedestal } from './keyRoom.js';
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
    for (const l of state.loot) {
      if (l.type !== 'prop') continue;
      if (Math.hypot(prj.x - l.x, prj.y - l.y) < prj.r + l.r) {
        breakProp(l);
        spawnParticles(prj.x, prj.y, prj.glow, 8);
        prj._dead = true;
        return;
      }
    }
    // Check rune pedestal hits (rune puzzle in Sala de la Llave).
    const pedTx = Math.floor(prj.x / TILE);
    const pedTy = Math.floor(prj.y / TILE);
    if (hitRunePedestal(pedTx, pedTy)) {
      spawnParticles(prj.x, prj.y, prj.glow, 10);
      prj._dead = true;
      return;
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
  if (prj.type === 'bone') {
    // Spinning bone: thin shaft + two knobs at the ends. Rotates as it
    // travels so it reads as a tossed object rather than a magic blob.
    const ang = (prj.spin = (prj.spin || 0) + 0.4);
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#e4dcc4';
    ctx.fillRect(-7, -1.4, 14, 2.8);
    ctx.beginPath(); ctx.arc(-7, 0, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc( 7, 0, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  ctx.shadowColor = prj.glow;
  ctx.shadowBlur = 16;
  ctx.fillStyle = prj.color;
  ctx.beginPath(); ctx.arc(x, y, prj.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y, prj.r * 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
