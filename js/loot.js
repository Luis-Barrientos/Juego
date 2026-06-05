/**
 * Loot system: coins (with magnet), potions and chests.
 */

import { state } from './state.js';
import { tryMove, isWall } from './dungeon.js';
import { Audio } from './audio.js';
import { spawnParticles } from './particles.js';
import { spawnFloatText } from './particles.js';
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

    if (l.type === 'coin' && l.age > 0.6 && dist(l, p) < 80) {
      const ang  = Math.atan2(p.y - l.y, p.x - l.x);
      const pull = 200;
      l.x += Math.cos(ang) * pull * dt;
      l.y += Math.sin(ang) * pull * dt;
    }

    if (l.type !== 'chest' && l.type !== 'prop' && l.age > 0.4 && dist(l, p) < p.r + l.r) {
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
    } else if (l.type === 'prop') {
      drawProp(ctx, l, x, y);
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
  const legendary = !!l.legendary;
  const near = !l.opened && dist(l, state.player) < 50;
  const bob  = l.opened ? 0 : Math.sin(l.age * 3) * 0.8;
  const cy   = y + bob;

  // Halo / glow only while the chest still holds loot.
  if (!l.opened) {
    const pulse = 0.55 + Math.sin(l.age * 4) * 0.25;
    const glow  = ctx.createRadialGradient(x, cy, 2, x, cy, legendary ? 34 : 26);
    glow.addColorStop(0, legendary
      ? `rgba(255,210,80,${0.55 * pulse})`
      : rare
      ? `rgba(160,140,255,${0.35 * pulse})`
      : `rgba(255,200,80,${0.30 * pulse})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, cy, legendary ? 34 : 26, 0, Math.PI * 2); ctx.fill();
  }

  // Palette per chest tier.
  const woodMain   = l.opened ? '#2a1a0c'
                              : (legendary ? '#5a3a08'
                                : (rare ? '#3a2a5a' : '#6a4220'));
  const woodLight  = l.opened ? '#3a2614'
                              : (legendary ? '#a07820'
                                : (rare ? '#5a48a0' : '#8a5828'));
  const woodDark   = l.opened ? '#140a04'
                              : (legendary ? '#2a1a04'
                                : (rare ? '#1a1230' : '#3a2010'));
  const trim       = legendary ? '#ffe060' : (rare ? '#c0a0ff' : '#ffd060');
  const trimDark   = legendary ? '#a06010' : (rare ? '#604080' : '#a07020');

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
    ctx.fillStyle = legendary ? '#604010' : (rare ? '#403260' : '#3a2a18');
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
  ctx.fillStyle = legendary ? '#3a2008' : (rare ? '#1a1230' : '#2a1810');
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
  // Legendary crown ornament + bright sun runes on the lid.
  if (legendary) {
    const t = l.age * 2;
    // Crown points along the lid.
    ctx.fillStyle = '#ffe060';
    ctx.fillRect(x - 8, cy - 9, 2, 3);
    ctx.fillRect(x - 1, cy - 11, 2, 5);
    ctx.fillRect(x + 6, cy - 9, 2, 3);
    // Sparkling rune dots.
    ctx.fillStyle = `rgba(255,240,180,${0.6 + Math.sin(t) * 0.35})`;
    ctx.shadowColor = '#ffd060'; ctx.shadowBlur = 6;
    ctx.fillRect(x - 5, cy - 6, 1, 2);
    ctx.fillRect(x + 4, cy - 6, 1, 2);
    ctx.shadowBlur = 0;
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
    const label = (rare && l.cost > 0)
      ? `[E] ${l.cost}g`
      : '[E]';
    ctx.fillText(label, x, cy - 16);
  }
}

/** Place a chest at the centre of `room` (or the closest free floor tile
 *  if the centre is occupied by props/walls). */
export function spawnChest(room, opts = {}) {
  const rare = !!opts.rare;
  const legendary = !!opts.legendary;
  const { tx, ty } = findFreeTileNear(room, room.cx, room.cy);
  state.loot.push({
    type: 'chest', opened: false,
    rare, legendary,
    cost: legendary ? 0 : (rare ? 50 : 0),
    x: tx * TILE + TILE / 2,
    y: ty * TILE + TILE / 2,
    age: 0, r: 12, vx: 0, vy: 0,
  });
}

/**
 * Spiral outward from (cx, cy) looking for the first walkable floor tile
 * inside the room that is not already occupied by another chest. Falls
 * back to (cx, cy) if nothing is found.
 * @private
 */
function findFreeTileNear(room, cx, cy) {
  const isOccupied = (tx, ty) => {
    if (state.map && isWall(state.map, tx, ty)) return true;
    for (const l of state.loot) {
      if (l.type !== 'chest') continue;
      const lx = Math.floor(l.x / TILE);
      const ly = Math.floor(l.y / TILE);
      if (lx === tx && ly === ty) return true;
    }
    // Also avoid stair tile.
    if (state.map && state.map[ty] && state.map[ty][tx] === 3) return true;
    return false;
  };
  const inRoom = (tx, ty) =>
    tx >= room.x && tx < room.x + room.w &&
    ty >= room.y && ty < room.y + room.h;
  for (let radius = 0; radius < 6; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius && radius !== 0) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        if (!inRoom(tx, ty)) continue;
        if (!isOccupied(tx, ty)) return { tx, ty };
      }
    }
  }
  return { tx: cx, ty: cy };
}

/**
 * Open a chest.
 *
 *   • Common chests always drop something visible: at least 1 coin plus a
 *     guaranteed potion if the player needs healing/mana.
 *   • Rare chests cost gold and drop premium loot. They also have a 30%
 *     chance to grant a permanent BLESSING (a random upgrade) on top of
 *     the loot.
 *   • Legendary chests are unique reward chests dropped by mini-bosses
 *     (e.g. the Library Guardian). Free, lavish: a guaranteed blessing,
 *     two potions of each kind, and a fat coin pile.
 *
 * @param {object} c           Chest entity.
 * @param {(text:string)=>void} toast
 * @param {(id:string)=>void} [grantBlessing] Applies a permanent upgrade by id.
 */
export function openChest(c, toast, grantBlessing) {
  if (c.rare && c.cost > 0) {
    if (state.gold < c.cost) {
      toast(`Necesitas ${c.cost} oro`);
      Audio.hit && Audio.hit();
      return;
    }
    state.gold -= c.cost;
  }
  c.opened = true;
  Audio.pickup();
  spawnParticles(
    c.x, c.y - 6,
    c.legendary ? '#ffe060' : (c.rare ? '#c0a0ff' : '#ffd040'),
    c.legendary ? 44 : (c.rare ? 32 : 18),
  );

  /* Local helpers to record drops so we can summarise them at the end. */
  const summary = { coins: 0, gold: 0, hp: 0, mp: 0, blessing: null };
  const dropCoin = v => {
    state.loot.push(spawnItem('coin', c, v));
    summary.coins++; summary.gold += v;
  };
  const dropHp   = () => { state.loot.push(spawnItem('hp_potion', c)); summary.hp++; };
  const dropMp   = () => { state.loot.push(spawnItem('mp_potion', c)); summary.mp++; };

  if (c.legendary) {
    // Legendary: always grants a blessing + heavy resources.
    dropHp(); dropHp();
    dropMp(); dropMp();
    const nCoins = irand(10, 14);
    for (let i = 0; i < nCoins; i++) dropCoin(irand(20, 40));
    if (grantBlessing) {
      const id = pickRandomBlessingId();
      grantBlessing(id);
      summary.blessing = BLESSING_NAMES[id] || id;
      spawnParticles(c.x, c.y - 6, '#ffe060', 32);
      Audio.upgrade && Audio.upgrade();
    }
    revealLoot(c, summary, 'legendary', toast);
    return;
  }

  if (c.rare) {
    dropHp(); dropMp();
    const nCoins = irand(6, 9);
    for (let i = 0; i < nCoins; i++) dropCoin(irand(15, 30));
    if (grantBlessing && Math.random() < 0.30) {
      const id = pickRandomBlessingId();
      grantBlessing(id);
      summary.blessing = BLESSING_NAMES[id] || id;
      spawnParticles(c.x, c.y - 6, '#ffe0a0', 24);
      Audio.upgrade && Audio.upgrade();
    }
    revealLoot(c, summary, 'rare', toast);
    return;
  }

  /* ── Common chest: guarantee meaningful loot ─────────────────────── */
  const p = state.player;
  dropCoin(irand(8, 18));
  if (p && p.hp < p.maxHp - 20)       dropHp();
  else if (p && p.mp < p.maxMp - 15)  dropMp();
  const extras = irand(1, 2);
  for (let i = 0; i < extras; i++) {
    const r = Math.random();
    if (r < 0.55)      dropCoin(irand(8, 18));
    else if (r < 0.78) dropHp();
    else               dropMp();
  }
  revealLoot(c, summary, 'common', toast);
}

/**
 * Spawn floating labels above the chest summarising what fell out.
 * Lines are staggered vertically so the player can read them.
 *
 * @param {string} tier  'common' | 'rare' | 'legendary'
 */
function revealLoot(c, s, tier, toast) {
  const lines = [];
  if (s.gold > 0)     lines.push({ t: `+${s.gold} oro`, c: '#ffd040' });
  if (s.hp > 0)       lines.push({ t: `+${s.hp} poción HP`, c: '#ff7070' });
  if (s.mp > 0)       lines.push({ t: `+${s.mp} poción MP`, c: '#70a0ff' });
  if (s.blessing)     lines.push({ t: `★ ${s.blessing}`,   c: '#ffe0a0' });

  // Stack labels above the chest, slightly offset.
  let offsetY = -16;
  for (const ln of lines) {
    spawnFloatText(c.x, c.y + offsetY, ln.t, ln.c, 13, 1.8);
    offsetY -= 16;
  }

  if (tier === 'legendary')                    toast(`¡Cofre legendario! ★ ${s.blessing}`);
  else if (tier === 'rare' && s.blessing)      toast(`¡Bendición rara! ${s.blessing}`);
  else if (tier === 'rare')                    toast('¡Tesoro raro!');
  else                                         toast('¡Baúl abierto!');
}

/** Friendly names for blessings shown in toasts when a chest grants one. */
const BLESSING_NAMES = {
  sword: 'FILO AGUDO', magic: 'PODER ARCANO', speed: 'PIES LIGEROS',
  vampire: 'SED DE SANGRE', regen: 'REGENERACIÓN', crit: 'GOLPE LETAL',
  maxhp: 'VITALIDAD', maxmp: 'INTELECTO',
  swift: 'BRAZO ÁGIL', reach: 'GRAN ARCO', mana_eff: 'CONSERVACIÓN',
  fortune: 'AVARICIA', guard: 'PIEL DE PIEDRA', thorns: 'ESPINAS',
};

function pickRandomBlessingId() {
  const ids = Object.keys(BLESSING_NAMES);
  return ids[Math.floor(Math.random() * ids.length)];
}

/** Helper: build a loot entity that scatters from a chest. */
function spawnItem(type, c, value) {
  const ang = Math.random() * Math.PI * 2;
  const sp  = rand(35, 75);
  return {
    type, x: c.x, y: c.y,
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
    age: 0, r: type === 'coin' ? 6 : 8,
    value,
  };
}

/* ─── Breakable props ───────────────────────────────────────────────── */

/** Place a breakable prop at world coords (px, py). */
export function spawnProp(px, py, variant) {
  state.loot.push({
    type: 'prop', variant,           // 'pot' | 'barrel' | 'urn'
    x: px, y: py,
    age: 0, r: 9, hp: 1,
    vx: 0, vy: 0,
  });
}

/** Break a prop: drop loot and remove it from state.loot. */
export function breakProp(prop) {
  Audio.hit && Audio.hit();
  const colors = prop.variant === 'barrel' ? '#a06030'
               : prop.variant === 'urn'    ? '#c0a070'
                                           : '#b07050';
  spawnParticles(prop.x, prop.y, colors, 14);

  const r = Math.random();
  if (r < 0.60) {
    state.loot.push({
      type: 'coin', x: prop.x, y: prop.y,
      vx: rand(-30, 30), vy: rand(-30, 30),
      age: 0, r: 6, value: irand(2, 6),
    });
  } else if (r < 0.75) {
    state.loot.push({
      type: 'hp_potion', x: prop.x, y: prop.y,
      vx: rand(-25, 25), vy: rand(-25, 25),
      age: 0, r: 8,
    });
  }
  // remaining 25%: nothing
  prop._dead = true;
  const idx = state.loot.indexOf(prop);
  if (idx >= 0) state.loot.splice(idx, 1);
}

/**
 * Draw a breakable prop (pot, barrel, or urn).
 * @private
 */
function drawProp(ctx, l, x, y) {
  const bob = Math.sin(l.age * 2.4 + (l.x + l.y) * 0.01) * 0.4;
  ctx.save();
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.ellipse(x, y + 7, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();

  if (l.variant === 'pot') {
    // Round clay pot.
    ctx.fillStyle = '#8a4a2a';
    ctx.beginPath(); ctx.ellipse(x, y + bob, 6.5, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6a3520';
    ctx.fillRect(x - 4, y - 6 + bob, 8, 2);
    ctx.fillStyle = '#a86040';
    ctx.fillRect(x - 5, y - 7 + bob, 10, 1.5);
    // Highlight.
    ctx.fillStyle = 'rgba(255,200,150,0.35)';
    ctx.beginPath(); ctx.ellipse(x - 2, y - 1 + bob, 1.8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  } else if (l.variant === 'barrel') {
    // Wooden barrel with bands.
    ctx.fillStyle = '#7a4a26';
    ctx.fillRect(x - 6, y - 7 + bob, 12, 14);
    ctx.fillStyle = '#5a3418';
    ctx.fillRect(x - 6, y - 4 + bob, 12, 1.5);
    ctx.fillRect(x - 6, y + 2  + bob, 12, 1.5);
    ctx.fillStyle = '#3a2a18';
    ctx.fillRect(x - 6, y - 7 + bob, 1, 14);
    ctx.fillRect(x + 5, y - 7 + bob, 1, 14);
    ctx.fillStyle = 'rgba(255,200,140,0.25)';
    ctx.fillRect(x - 5, y - 6 + bob, 1.5, 12);
  } else { // urn
    // Tall narrow urn.
    ctx.fillStyle = '#9a7a4a';
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 6 + bob);
    ctx.lineTo(x + 4, y - 6 + bob);
    ctx.lineTo(x + 5, y     + bob);
    ctx.lineTo(x + 3, y + 7 + bob);
    ctx.lineTo(x - 3, y + 7 + bob);
    ctx.lineTo(x - 5, y     + bob);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7a5a30';
    ctx.fillRect(x - 4, y - 7 + bob, 8, 1.5);
    ctx.fillStyle = 'rgba(255,220,160,0.30)';
    ctx.fillRect(x - 3, y - 4 + bob, 1, 8);
  }
  ctx.restore();
}

