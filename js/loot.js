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
      drawChest(ctx, l, x, y);
    }
    ctx.restore();
  }
}

/**
 * Draw a chest. The closed and opened states are rendered as fundamentally
 * different sprites so the player can tell at a glance which chests are
 * still pending. Rare chests use a cooler palette and a stronger glow.
 * @private
 */
function drawChest(ctx, l, x, y) {
  const rare = !!l.rare;
  const near = !l.opened && dist(l, state.player) < 50;
  const bob  = l.opened ? 0 : Math.sin(l.age * 3) * 0.8;
  const cy   = y + bob;

  // Halo / glow only while the chest still holds loot.
  if (!l.opened) {
    const pulse = 0.55 + Math.sin(l.age * 4) * 0.25;
    const glow  = ctx.createRadialGradient(x, cy, 2, x, cy, 26);
    glow.addColorStop(0, rare
      ? `rgba(160,140,255,${0.35 * pulse})`
      : `rgba(255,200,80,${0.30 * pulse})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, cy, 26, 0, Math.PI * 2); ctx.fill();
  }

  // Palette per chest tier.
  const woodMain   = l.opened ? '#2a1a0c'
                              : (rare ? '#3a2a5a' : '#6a4220');
  const woodLight  = l.opened ? '#3a2614'
                              : (rare ? '#5a48a0' : '#8a5828');
  const woodDark   = l.opened ? '#140a04'
                              : (rare ? '#1a1230' : '#3a2010');
  const trim       = rare ? '#c0a0ff' : '#ffd060';
  const trimDark   = rare ? '#604080' : '#a07020';

  if (l.opened) {
    /* ── Open chest: lid tilted back, dark interior ─────────────── */
    // Interior (back wall, deep shadow)
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 11, cy - 6, 22, 10);
    // Body
    ctx.fillStyle = woodMain;
    ctx.fillRect(x - 12, cy - 2, 24, 12);
    ctx.fillStyle = woodDark;
    ctx.fillRect(x - 12, cy + 8, 24, 2);
    // Front planks
    ctx.fillStyle = woodLight;
    ctx.fillRect(x - 11, cy + 1, 22, 1);
    ctx.fillRect(x - 11, cy + 5, 22, 1);
    // Iron bands (dim, rare keeps purple tint)
    ctx.fillStyle = rare ? '#403260' : '#3a2a18';
    ctx.fillRect(x - 1, cy - 2, 2, 12);
    // Lid leaning back (parallelogram going up-left)
    ctx.fillStyle = woodLight;
    ctx.beginPath();
    ctx.moveTo(x - 12, cy - 2);
    ctx.lineTo(x + 12, cy - 2);
    ctx.lineTo(x + 9,  cy - 12);
    ctx.lineTo(x - 15, cy - 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = woodDark;
    ctx.beginPath();
    ctx.moveTo(x - 15, cy - 12);
    ctx.lineTo(x - 12, cy - 2);
    ctx.lineTo(x - 12, cy - 3);
    ctx.lineTo(x - 15, cy - 13);
    ctx.closePath();
    ctx.fill();
    // Broken lock dangling
    ctx.fillStyle = trimDark;
    ctx.fillRect(x - 1, cy + 2, 2, 3);
    return;
  }

  /* ── Closed chest: domed lid, bright trim, lock ──────────────── */
  // Body
  ctx.fillStyle = woodMain;
  ctx.fillRect(x - 12, cy - 2, 24, 12);
  // Front shading
  ctx.fillStyle = woodDark;
  ctx.fillRect(x - 12, cy + 8, 24, 2);
  ctx.fillStyle = woodLight;
  ctx.fillRect(x - 11, cy - 1, 22, 1);
  // Domed lid (closed): rounded top
  ctx.fillStyle = woodMain;
  ctx.beginPath();
  ctx.moveTo(x - 12, cy - 2);
  ctx.lineTo(x - 12, cy - 6);
  ctx.quadraticCurveTo(x, cy - 12, x + 12, cy - 6);
  ctx.lineTo(x + 12, cy - 2);
  ctx.closePath();
  ctx.fill();
  // Lid highlight
  ctx.fillStyle = woodLight;
  ctx.beginPath();
  ctx.moveTo(x - 10, cy - 4);
  ctx.quadraticCurveTo(x, cy - 10, x + 10, cy - 4);
  ctx.lineTo(x + 10, cy - 5);
  ctx.quadraticCurveTo(x, cy - 11, x - 10, cy - 5);
  ctx.closePath();
  ctx.fill();
  // Iron bands across body
  ctx.fillStyle = rare ? '#1a1230' : '#2a1810';
  ctx.fillRect(x - 11, cy + 4, 22, 1);
  ctx.fillRect(x - 1,  cy - 6, 2, 12);
  // Gold/rune trim
  ctx.fillStyle = trim;
  ctx.fillRect(x - 12, cy - 2, 24, 1);
  ctx.fillRect(x - 12, cy + 7, 24, 1);
  // Rare runes on the lid
  if (rare) {
    const t = l.age * 2;
    ctx.fillStyle = `rgba(220,200,255,${0.5 + Math.sin(t) * 0.3})`;
    ctx.fillRect(x - 6, cy - 7, 1, 3);
    ctx.fillRect(x - 1, cy - 9, 1, 3);
    ctx.fillRect(x + 4, cy - 7, 1, 3);
  }
  // Lock plate
  ctx.fillStyle = trim;
  ctx.fillRect(x - 3, cy + 1, 6, 5);
  ctx.fillStyle = trimDark;
  ctx.fillRect(x - 1, cy + 3, 2, 2);
  // Keyhole
  ctx.fillStyle = '#000';
  ctx.fillRect(x, cy + 4, 1, 1);

  // Interaction prompt
  if (near) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    const label = rare
      ? `[E] ${l.cost}g`
      : '[E]';
    ctx.fillText(label, x, cy - 16);
  }
}

/** Place a chest at the centre of `room`. */
export function spawnChest(room, opts = {}) {
  const rare = !!opts.rare;
  state.loot.push({
    type: 'chest', opened: false,
    rare,
    cost: rare ? 50 : 0,
    x: room.cx * TILE + TILE / 2,
    y: room.cy * TILE + TILE / 2,
    age: 0, r: 12, vx: 0, vy: 0,
  });
}

/**
 * Open a chest. Rare chests cost gold and drop premium loot.
 * If the player can't afford a rare chest, the chest stays closed and the
 * caller is informed via toast.
 */
export function openChest(c, toast) {
  if (c.rare) {
    if (state.gold < c.cost) {
      toast(`Necesitas ${c.cost} oro`);
      Audio.hit && Audio.hit();
      return;
    }
    state.gold -= c.cost;
  }
  c.opened = true;
  Audio.pickup();
  spawnParticles(c.x, c.y - 6, c.rare ? '#c0a0ff' : '#ffd040', c.rare ? 32 : 18);

  if (c.rare) {
    // Premium drop: lots of high-value coins + 1 HP and 1 MP potion guaranteed.
    state.loot.push(spawnItem('hp_potion', c));
    state.loot.push(spawnItem('mp_potion', c));
    const n = irand(6, 9);
    for (let i = 0; i < n; i++) {
      state.loot.push(spawnItem('coin', c, irand(15, 30)));
    }
    toast('¡Tesoro raro!');
    return;
  }

  const n = irand(2, 4);
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    if (r < 0.55)      state.loot.push(spawnItem('coin', c, irand(8, 18)));
    else if (r < 0.78) state.loot.push(spawnItem('hp_potion', c));
    else               state.loot.push(spawnItem('mp_potion', c));
  }
  toast('¡Baúl abierto!');
}

/** Helper: build a loot entity that scatters from a chest. */
function spawnItem(type, c, value) {
  const ang = Math.random() * Math.PI * 2;
  const sp  = rand(60, 120);
  return {
    type, x: c.x, y: c.y,
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
    age: 0, r: type === 'coin' ? 6 : 8,
    value,
  };
}
