/**
 * Particle and floating damage text systems.
 */
import { state } from './state.js';
import { rand } from './utils.js';

/**
 * Spawn a burst of particles at (x, y).
 */
export function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp  = rand(40, 180);
    state.particles.push({
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

/**
 * Spawn a rising damage number above an entity.
 */
export function spawnDamageText(x, y, dmg, crit) {
  state.damageTexts.push({
    x, y,
    text: crit ? `${dmg}!` : `${dmg}`,
    color: crit ? '#ffd040' : '#fff',
    size: crit ? 18 : 14,
    life: 0.9, maxLife: 0.9,
    vy: -55, vx: rand(-20, 20),
    gravity: 80,
  });
}

/**
 * Generic floating text (for loot reveals, pickups, blessings…).
 * Stays visible longer than damage numbers and rises slowly without gravity.
 *
 * @param {number} x World x
 * @param {number} y World y
 * @param {string} text
 * @param {string} [color='#ffd040']
 * @param {number} [size=13]
 * @param {number} [life=1.6]
 */
export function spawnFloatText(x, y, text, color = '#ffd040', size = 13, life = 1.6) {
  state.damageTexts.push({
    x, y, text, color, size,
    life, maxLife: life,
    vy: -28, vx: 0,
    gravity: 0,
  });
}

/** Tick particle simulation. */
export function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.life -= dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
  for (let i = state.damageTexts.length - 1; i >= 0; i--) {
    const t = state.damageTexts[i];
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.vy += (t.gravity || 0) * dt;
    t.life -= dt;
    if (t.life <= 0) state.damageTexts.splice(i, 1);
  }
}

export function drawParticles(ctx) {
  for (const p of state.particles) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(p.x - state.cameraX, p.y - state.cameraY, p.r * a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawDamageTexts(ctx) {
  ctx.save();
  ctx.textAlign = 'center';
  for (const t of state.damageTexts) {
    const a = Math.max(0, t.life / t.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = t.color || '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.font = `bold ${t.size || 14}px sans-serif`;
    const x = t.x - state.cameraX;
    const y = t.y - state.cameraY;
    ctx.strokeText(t.text, x, y);
    ctx.fillText(t.text, x, y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
