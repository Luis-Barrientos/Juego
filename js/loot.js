/**
 * Loot system: coins (with magnet), potions and chests.
 */

import { state } from './state.js';
import { tryMove } from './dungeon.js';
import { Audio } from './audio.js';
import { spawnParticles } from './particles.js';
import { rand, irand, dist } from './utils.js';
import { TILE } from './config.js';

/**
 * Per-frame update for all loot. Handles magnet, pickup, chests.
 * @param {(text: string) => void} toast
 */
export function updateLoot(dt, toast) {
  const p = state.player;
  for (let i = state.loot.length - 1; i >= 0; i--) {
    const l = state.loot[i];
    l.age += dt;

    if (l.vx || l.vy) {
      tryMove(state.map, l, l.vx * dt, l.vy * dt);
      l.vx *= 0.9; l.vy *= 0.9;
      if (Math.hypot(l.vx, l.vy) < 5) { l.vx = 0; l.vy = 0; }
    }

    if (l.type === 'coin' && dist(l, p) < 80) {
      const ang  = Math.atan2(p.y - l.y, p.x - l.x);
      const pull = 200;
      l.x += Math.cos(ang) * pull * dt;
      l.y += Math.sin(ang) * pull * dt;
    }

    if (l.type !== 'chest' && dist(l, p) < p.r + l.r) {
      if (l.type === 'coin') {
        state.gold  += l.value;
        state.score += l.value;
        Audio.coin();
      } else if (l.type === 'hp_potion') {
        p.hp = Math.min(p.maxHp, p.hp + 35);
        toast('+35 HP');
        Audio.pickup();
      } else if (l.type === 'mp_potion') {
        p.mp = Math.min(p.maxMp, p.mp + 25);
        toast('+25 MP');
        Audio.pickup();
      }
      state.loot.splice(i, 1);
    }
  }
}

/** Render every loot entity. */
export function drawLoot(ctx) {
  for (const l of state.loot) {
    const x = l.x - state.cameraX;
    const y = l.y - state.cameraY;
    ctx.save();
    if (l.type === 'coin') {
      const bob = Math.sin(l.age * 6) * 1.5;
      ctx.shadowColor = '#ffc040'; ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffd040';
      ctx.beginPath(); ctx.arc(x, y + bob, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a07020';
      ctx.fillRect(x - 1, y - 2 + bob, 2, 4);
    } else if (l.type === 'hp_potion') {
      const bob = Math.sin(l.age * 5) * 2;
      ctx.shadowColor = '#ff4040'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#ff4040';
      ctx.fillRect(x - 4, y - 5 + bob, 8, 10);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(x - 3, y - 8 + bob, 6, 3);
    } else if (l.type === 'mp_potion') {
      const bob = Math.sin(l.age * 5) * 2;
      ctx.shadowColor = '#4080ff'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#4080ff';
      ctx.fillRect(x - 4, y - 5 + bob, 8, 10);
      ctx.fillStyle = '#aaa';
      ctx.fillRect(x - 3, y - 8 + bob, 6, 3);
    } else if (l.type === 'chest') {
      ctx.fillStyle = l.opened ? '#3a2010' : '#5a3818';
      ctx.fillRect(x - 12, y - 8, 24, 16);
      ctx.fillStyle = '#ffc040';
      ctx.fillRect(x - 12, y - 2, 24, 2);
      ctx.fillRect(x - 1, y - 8, 2, 16);
      if (!l.opened && dist(l, state.player) < 50) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('[E]', x, y - 14);
      }
    }
    ctx.restore();
  }
}

/** Place a chest at the centre of `room`. */
export function spawnChest(room) {
  state.loot.push({
    type: 'chest', opened: false,
    x: room.cx * TILE + TILE / 2,
    y: room.cy * TILE + TILE / 2,
    age: 0, r: 12, vx: 0, vy: 0,
  });
}

/** Open a chest, scattering items. */
export function openChest(c, toast) {
  c.opened = true;
  Audio.pickup();
  spawnParticles(c.x, c.y - 6, '#ffd040', 18);
  const n = irand(2, 4);
  for (let i = 0; i < n; i++) {
    const r   = Math.random();
    const ang = Math.random() * Math.PI * 2;
    const sp  = rand(60, 120);
    if (r < 0.55) {
      state.loot.push({ type: 'coin', x: c.x, y: c.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, value: irand(8, 18), age: 0, r: 6 });
    } else if (r < 0.78) {
      state.loot.push({ type: 'hp_potion', x: c.x, y: c.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, age: 0, r: 8 });
    } else {
      state.loot.push({ type: 'mp_potion', x: c.x, y: c.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, age: 0, r: 8 });
    }
  }
  toast('¡Baúl abierto!');
}
