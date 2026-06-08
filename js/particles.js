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
    if (p.kind === 'soul') {
      // Souls drift slowly upward without friction and wobble side-to-side.
      p.phase = (p.phase || 0) + dt;
      p.x += Math.sin(p.phase * 2.2 + (p.seed || 0)) * 8 * dt;
    } else if (p.kind === 'leaf') {
      // Leaves: drift downward, wobble horizontally, rotate slowly.
      p.phase = (p.phase || 0) + dt;
      // Skip wobble for leaves far from the player (cheap culling).
      if (state.player && Math.hypot(p.x - state.player.x, p.y - state.player.y) < 250) {
        p.x += Math.sin(p.phase * 1.8 + (p.seed || 0)) * 12 * dt;
      }
      p.rot = (p.rot || 0) + (p.rotSp || 0) * dt;
      p.vy *= 0.995;
    } else if (p.kind === 'guardianSlam') {
      // Expanding shockwave ring: radius grows from r to maxR over life.
      const t = 1 - (p.life / p.maxLife);
      p.r = 6 + (p.maxR - 6) * t;
    } else if (p.kind === 'archiveMist') {
      // Mist: expand radius over lifetime, decelerate quickly
      const ageRatio = 1 - (p.life / p.maxLife);
      p.r = p.baseR * (1 + ageRatio * 1.6);
      p.vx *= 0.95;
      p.vy *= 0.95;
    } else if (p.kind === 'ritualEmber') {
      // Embers: drift upward with high-frequency wobble, slight drag
      p.phase = (p.phase || 0) + dt;
      p.x += Math.sin(p.phase * 5.8 + (p.seed || 0)) * 16 * dt;
      p.vx *= 0.97;
      p.vy *= 0.97;
    } else {
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
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
    const x = p.x - state.cameraX;
    const y = p.y - state.cameraY;
    if (p.kind === 'archiveMist') {
      // Soft crimson-purple mist cloud
      ctx.save();
      ctx.globalAlpha = a * 0.35;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, p.r);
      grad.addColorStop(0, 'rgba(65, 10, 28, 0.9)');
      grad.addColorStop(0.5, 'rgba(40, 5, 18, 0.45)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    if (p.kind === 'ritualEmber') {
      // Glow-in-the-dark additive spark
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color || '#ff3333';
      ctx.shadowColor = p.color || '#ff3333';
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(x, y, p.r * a, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    if (p.kind === 'soul') {
      // Soul: outer halo + bright core.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.55;
      ctx.fillStyle = 'rgba(140,200,255,1)';
      ctx.beginPath();
      ctx.arc(x, y, p.r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#e8f4ff';
      ctx.beginPath();
      ctx.arc(x, y, p.r * a, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    if (p.kind === 'leaf') {
      // Leaf / paper scrap: small rotated quad with subtle shadow.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot || 0);
      ctx.globalAlpha = a;
      const w = (p.r || 2) * 2.2;
      const h = (p.r || 2) * 1.4;
      // Drop shadow underneath.
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-w / 2 + 1, -h / 2 + 1, w, h);
      // Body.
      ctx.fillStyle = p.color;
      if (p.paper) {
        ctx.fillRect(-w / 2, -h / 2, w, h);
        // Fold/seam highlight along the centre.
        ctx.fillStyle = 'rgba(255,235,200,0.55)';
        ctx.fillRect(-w / 2, -0.5, w, 1);
      } else {
        // Leaf: rounded with a vein.
        ctx.beginPath();
        ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(80, 100, 60, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-w / 2 + 1, 0);
        ctx.lineTo( w / 2 - 1, 0);
        ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    if (p.kind === 'guardianSlam') {
      // Expanding rune ring: bright stroke that fades as it grows.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3;
      ctx.shadowColor = '#e0c0ff';
      ctx.shadowBlur  = 12;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    ctx.fillStyle = p.color;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(x, y, p.r * a, 0, Math.PI * 2);
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
