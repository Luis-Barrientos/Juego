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
    /** Bone-throw range band (min, max) and cooldown seconds. */
    throwMin: 110, throwMax: 220, throwCool: 3.2,
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
  /**
   * Wolf: fast pack hunter. Runs in packs, high speed, moderate HP.
   * Used as minions for the Alpha Wolf.
   */
  wolf: {
    hp: 45, dmg: 12, speed: 110, r: 10,
    color: '#5a4a3a', glow: '#806040',
    score: 22, gold: [4, 10],
    range: 24, attackCool: 0.7, behavior: 'melee',
  },
  /**
   * Alpha Wolf: mini-boss of the Ruins floor. Territorial, summons pack,
   * enrages at low HP with projectile fan and nova ring.
   */
  alphaWolf: {
    hp: 220, dmg: 24, speed: 80, r: 16,
    color: '#3a2a1a', glow: '#a08050',
    score: 280, gold: [50, 90],
    range: 26, attackCool: 0.7, behavior: 'alphaWolf',
    /** Howl summon cooldown (seconds). */
    howlCool: 8.0,
    /** Min HP fraction to trigger enrage. */
    enrageThreshold: 0.5,
    /** Projectile fan cooldown when enraged. */
    fanCool: 3.0,
    /** Nova ring cooldown when enraged. */
    novaCool: 6.0,
  },
  /**
   * Sepulchral: heavy melee elite that emerges from cracked sarcophagi
   * during the crypta challenge. Slow but tough; aura is cool blue so it
   * reads as undead-from-the-crypt instead of a regular skeleton.
   */
  sepulchral: {
    hp: 110, dmg: 22, speed: 55, r: 12,
    color: '#cfd8e8', glow: '#a8c8ff',
    score: 80, gold: [14, 26],
    range: 28, attackCool: 1.0, behavior: 'melee',
  },
  /**
   * Guardian of the Library: stone-and-rune mini-boss summoned from the
   * library's runestone circle. Tanky, hits hard, fires fans of rune
   * projectiles, and enrages below 50% HP with a wider fan and a
   * periodic shockwave ring.
   */
  guardian: {
    hp: 380, dmg: 34, speed: 52, r: 18,
    color: '#5a5a64', glow: '#b890ff',
    score: 320, gold: [60, 100],
    range: 36, attackCool: 1.0, behavior: 'guardian',
    /** Rune-burst cooldown band (seconds). */
    runeCool: 2.6, runeMin: 80, runeMax: 360,
    /** Shockwave ring cooldown when enraged (HP < 50%). */
    novaCool: 5.0,
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
    // Skeleton-specific bone throw timers/state (unused by other types).
    throwCool: t.throwCool ? 1 + Math.random() * 2 : 0,
    aimTime:   0,
    aimAng:    0,
    /** Brief invulnerable rise-from-the-floor animation (seconds). */
    emergeTime: 0,
  };
}

/**
 * Spawn a sepulchral elite at a world-space position. Used by the crypta
 * challenge when a cracked sarcophagus awakens. Marks the enemy with
 * `emergeTime` so it plays a short rise animation and stays invulnerable
 * until it finishes climbing out.
 *
 * @param {number} x        World pixel coords.
 * @param {number} y
 * @param {number} floor    Current floor (for stat scaling).
 * @returns {object} the new enemy (already pushed to state.enemies).
 */
export function spawnSepulchralAt(x, y, floor) {
  const e = createEnemy('sepulchral', x, y, floor);
  e.emergeTime = 0.9;
  e.state = 'emerging';
  e.fromChallenge = true;
  state.enemies.push(e);
  spawnParticles(x, y + 6, '#a8c8ff', 24);
  return e;
}

/**
 * Spawn the Guardian of the Library at a world-space position. Used by
 * the library set-piece when the player activates the summoning circle.
 * Plays a brief invulnerable assemble animation while the rune stones
 * coalesce into him.
 *
 * @param {number} x        World pixel coords.
 * @param {number} y
 * @param {number} floor    Current floor (for stat scaling).
 * @returns {object} the new enemy (already pushed to state.enemies).
 */
export function spawnGuardianAt(x, y, floor) {
  const e = createEnemy('guardian', x, y, floor);
  e.emergeTime  = 1.2;
  e.state       = 'emerging';
  e.fromLibrary = true;
  e.runeCool    = ENEMY_TYPES.guardian.runeCool;
  e.novaCool    = ENEMY_TYPES.guardian.novaCool;
  e.slamTel     = 0;
  e.slamFlash   = 0;
  state.enemies.push(e);
  spawnParticles(x, y, '#b890ff', 36);
  return e;
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

/** @private Wrap an angle to (-π, π]. */
function wrapAngle(a) {
  while (a > Math.PI)  a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
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

  // Sepulchrals climbing out of a sarcophagus: invulnerable, immobile,
  // and deal no damage until the rise animation finishes.
  // The library Guardian shares the same emerge gate (fromLibrary).
  if (e.emergeTime > 0) {
    e.emergeTime -= dt;
    if (e.emergeTime <= 0) {
      e.state = 'idle';
      Audio.hit && Audio.hit();
    }
    return;
  }

  // Skeleton-only: bone throw with telegraph. Replaces the chase frame
  // when winding up so the player can read the attack and dodge.
  if (e.type === 'skeleton') {
    const t = ENEMY_TYPES.skeleton;
    e.throwCool = Math.max(0, e.throwCool - dt);
    if (e.aimTime > 0) {
      e.aimTime -= dt;
      // Stay still and keep updating the aim angle slightly so the
      // player feels tracked but can still side-step.
      const wantAng = Math.atan2(dy, dx);
      const da = wrapAngle(wantAng - e.aimAng);
      e.aimAng += Math.max(-0.6 * dt, Math.min(0.6 * dt, da));
      if (e.aimTime <= 0) {
        // Release the bone.
        const speed = 220;
        state.projectiles.push({
          friendly: false, x: e.x, y: e.y, r: 5,
          vx: Math.cos(e.aimAng) * speed,
          vy: Math.sin(e.aimAng) * speed,
          life: 1.6, dmg: e.dmg,
          color: '#e4dcc4', glow: '#fff',
          type: 'bone', spin: Math.random() * Math.PI * 2,
        });
        Audio.magicShoot && Audio.magicShoot();
        e.throwCool = t.throwCool + Math.random() * 1.0;
        e.state = 'attack';
      } else {
        e.state = 'telegraph';
      }
      return;
    }
    if (e.throwCool <= 0 && d > t.throwMin && d < t.throwMax) {
      e.aimTime = 0.7;
      e.aimAng  = Math.atan2(dy, dx);
      e.state   = 'telegraph';
      return;
    }
  }

  if (e.behavior === 'melee') {
    // Territorial: wolves from the Alpha Lair only fight when encounter is active
    if ((e.fromAlphaLair || e.fromAlpha) && (!state.alphaLair || state.alphaLair.state !== 'active')) {
      e.state = 'idle';
      return;
    }
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
  } else if (e.behavior === 'guardian') {
    // Slow stone golem with a periodic rune fan attack. Below 50% HP it
    // enrages: faster runes, wider fan, and a shockwave nova every few
    // seconds that forces the player to keep moving.
    const t = ENEMY_TYPES.guardian;
    const enraged = e.hp <= e.maxHp * 0.5;
    e.runeCool = Math.max(0, (e.runeCool || 0) - dt);
    if (e.runeCool <= 0 && d > t.runeMin && d < t.runeMax) {
      e.runeCool = (enraged ? t.runeCool * 0.65 : t.runeCool) + Math.random() * 0.5;
      const a = Math.atan2(dy, dx);
      const speed = enraged ? 230 : 200;
      const count = enraged ? 5 : 3;          // 3-fan -> 5-fan when enraged
      const spread = enraged ? 0.28 : 0.22;
      const half = (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        const ang = a + (i - half) * spread;
        state.projectiles.push({
          friendly: false, x: e.x, y: e.y, r: 6,
          vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          life: 2.6, dmg: e.dmg * 0.7,
          color: '#b890ff', glow: '#e0c0ff',
          type: 'magic',
        });
      }
      Audio.magicShoot && Audio.magicShoot();
      e.state = 'attack';
    }
    // Enraged shockwave: ring of 12 slow projectiles centered on the
    // guardian. Punishes players who try to hug-and-burst him.
    if (enraged) {
      e.novaCool = Math.max(0, (e.novaCool || t.novaCool) - dt);
      if (e.novaCool <= 0) {
        e.novaCool = t.novaCool + Math.random() * 1.2;
        const N = 12;
        const speed = 150;
        for (let i = 0; i < N; i++) {
          const ang = (Math.PI * 2 * i) / N;
          state.projectiles.push({
            friendly: false, x: e.x, y: e.y, r: 7,
            vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
            life: 2.2, dmg: e.dmg * 0.6,
            color: '#d8a0ff', glow: '#f0d0ff',
            type: 'magic',
          });
        }
        Audio.magicShoot && Audio.magicShoot();
      }
    }
    if (d > e.range + p.r) {
      // Cancel any windup if the player escapes range.
      e.slamTel = 0;
      const sp = enraged ? e.speed * 1.15 : e.speed;
      tryMove(state.map, e, (dx / d) * sp * dt, (dy / d) * sp * dt);
      if (e.state !== 'attack') e.state = 'chase';
    } else {
      e.state = 'attack';
      // Telegraphed slam: when ready, raise arms for SLAM_TEL seconds and
      // then strike. Damage + camera shake + visual ring + particles fire
      // on impact. The flash window keeps the arms-down pose visible for
      // a few frames so the player understands what hit them.
      const SLAM_TEL = 0.45;
      const SLAM_FLASH = 0.18;
      e.slamFlash = Math.max(0, (e.slamFlash || 0) - dt);
      if (e.slamTel > 0) {
        e.slamTel -= dt;
        if (e.slamTel <= 0) {
          // Impact frame.
          e.slamTel = 0;
          e.slamFlash = SLAM_FLASH;
          // Damage only if the player is still in melee range at impact.
          const dx2 = state.player.x - e.x;
          const dy2 = state.player.y - e.y;
          const d2  = Math.hypot(dx2, dy2);
          if (d2 < e.range + state.player.r + 4) {
            hooks.onPlayerHit(e.dmg, e);
          }
          // Visual + audio feedback.
          state.shake = Math.max(state.shake || 0, enraged ? 9 : 6);
          for (let i = 0; i < 14; i++) {
            spawnParticles(
              e.x + (Math.random() - 0.5) * 28,
              e.y + 10 + (Math.random() - 0.5) * 6,
              '#3a2c4a', 1,
            );
          }
          // Expanding rune ring (rendered as a short-lived particle).
          state.particles.push({
            kind: 'guardianSlam',
            x: e.x, y: e.y + 8,
            life: 0.35, maxLife: 0.35,
            r: 6, maxR: enraged ? 64 : 52,
            color: 'rgba(184,144,255,0.85)',
          });
          Audio.bossHit && Audio.bossHit();
          e.attackCool = e.attackRate;
        }
      } else if (e.attackCool <= 0) {
        // Begin a new slam windup.
        e.slamTel = SLAM_TEL;
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
  } else if (e.behavior === 'alphaWolf') {
    alphaWolfAI(e, dt, dx, dy, d, hooks);
  }
}

/** @private Alpha Wolf mini-boss AI: territorial, howl summons pack, enrages with fan + nova. */
function alphaWolfAI(e, dt, dx, dy, d, hooks) {
  const t = ENEMY_TYPES.alphaWolf;
  const enraged = e.hp <= e.maxHp * t.enrageThreshold;
  const p = state.player;

  // Territorial: only active when the Alpha Lair encounter is triggered.
  // Before activation (state === 'idle') the Alpha stands still.
  // After activation (state === 'active') it fights freely.
  const lair = state.alphaLair;
  if (!lair || lair.state !== 'active') {
    e.state = 'idle';
    return;
  }

  // Howl summon: periodically spawn 2-3 wolves nearby.
  e.howlCool = (e.howlCool || t.howlCool) - dt;
  if (e.howlCool <= 0) {
    e.howlCool = t.howlCool + Math.random() * 2.0;
    const n = 2 + Math.floor(Math.random() * 2); // 2-3 wolves
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 40;
      const wx = e.x + Math.cos(ang) * dist;
      const wy = e.y + Math.sin(ang) * dist;
      // Ensure spawn is on floor.
      const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
      if (!isWall(state.map, tx, ty)) {
        const wolf = createEnemy('wolf', wx, wy, state.floor);
        wolf.room = e.room;
        wolf.fromAlpha = true;
        state.enemies.push(wolf);
        spawnParticles(wx, wy, '#806040', 10);
      }
    }
    state.shake = Math.max(state.shake || 0, 4);
    Audio.bossHit && Audio.bossHit();
  }

  // Enraged abilities: projectile fan + nova ring.
  if (enraged) {
    e.fanCool = (e.fanCool || t.fanCool) - dt;
    if (e.fanCool <= 0 && d > 80 && d < 350) {
      e.fanCool = t.fanCool + Math.random() * 0.8;
      const a = Math.atan2(dy, dx);
      const count = 5;
      const spread = 0.3;
      const half = (count - 1) / 2;
      for (let i = 0; i < count; i++) {
        const ang = a + (i - half) * spread;
        state.projectiles.push({
          friendly: false, x: e.x, y: e.y, r: 6,
          vx: Math.cos(ang) * 240, vy: Math.sin(ang) * 240,
          life: 2.2, dmg: e.dmg * 0.65,
          color: '#c08040', glow: '#e0a060',
          type: 'magic',
        });
      }
      Audio.magicShoot && Audio.magicShoot();
      e.state = 'attack';
    }
    e.novaCool = (e.novaCool || t.novaCool) - dt;
    if (e.novaCool <= 0) {
      e.novaCool = t.novaCool + Math.random() * 1.5;
      const N = 16;
      const speed = 140;
      for (let i = 0; i < N; i++) {
        const ang = (Math.PI * 2 * i) / N;
        state.projectiles.push({
          friendly: false, x: e.x, y: e.y, r: 7,
          vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
          life: 2.5, dmg: e.dmg * 0.55,
          color: '#a06030', glow: '#d09050',
          type: 'magic',
        });
      }
      state.shake = Math.max(state.shake || 0, 8);
      spawnParticles(e.x, e.y + 8, '#a06030', 20);
      Audio.bossHit && Audio.bossHit();
    }
  }

  // Movement & melee.
  if (d > e.range + p.r) {
    const sp = enraged ? e.speed * 1.2 : e.speed;
    tryMove(state.map, e, (dx / d) * sp * dt, (dy / d) * sp * dt);
    e.state = 'chase';
  } else {
    e.state = 'attack';
    if (e.attackCool <= 0) {
      e.attackCool = e.attackRate;
      hooks.onPlayerHit(e.dmg, e);
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
  if (e.emergeTime > 0) {
    // Invulnerable while emerging: still ping the visual but eat the damage.
    spawnParticles(e.x, e.y, '#a8c8ff', 4);
    return;
  }
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
    // Bone-throw telegraph: raised arm and a flickering aim line so the
    // player can read the wind-up and side-step before the bone flies.
    if (e.aimTime > 0) {
      // Raised arm.
      ctx.fillStyle = e.color;
      const ax = x + Math.cos(e.aimAng) * 7;
      const ay = y - 1 + bob + Math.sin(e.aimAng) * 4;
      ctx.fillRect(ax - 1.5, ay - 1.5, 3, 3);
      // Flickering dotted aim line (amber → white as it fires).
      const t01 = 1 - e.aimTime / 0.7;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(255, ${200 + t01 * 55}, ${120 + t01 * 135}, ${0.7 + 0.3 * Math.sin(state.time * 30)})`;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -state.time * 60;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + Math.cos(e.aimAng) * 80, ay + Math.sin(e.aimAng) * 80);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
  } else if (e.type === 'sepulchral') {
    // Tall hooded figure with a faint blue aura. Plays a vertical
    // climb-out animation while emerging from a sarcophagus.
    const rise   = e.emergeTime > 0 ? Math.max(0, e.emergeTime / 0.9) : 0;
    const sinkY  = rise * 14;       // pixels still buried
    const alpha  = 1 - rise * 0.4;
    ctx.globalAlpha = alpha;
    // Cool aura.
    ctx.shadowColor = e.glow; ctx.shadowBlur = 18;
    // Robe / body
    ctx.fillStyle = flash ? '#fff' : '#3a4658';
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 12 + bob);
    ctx.lineTo(x - 8,  y - 6  + bob - sinkY * 0.3);
    ctx.lineTo(x,      y - 14 + bob - sinkY * 0.5);
    ctx.lineTo(x + 8,  y - 6  + bob - sinkY * 0.3);
    ctx.lineTo(x + 10, y + 12 + bob);
    ctx.closePath();
    ctx.fill();
    // Skull
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.beginPath();
    ctx.arc(x, y - 10 + bob - sinkY * 0.5, 5.5, 0, Math.PI * 2);
    ctx.fill();
    // Glowing eyes
    if (rise < 0.5) {
      ctx.fillStyle = '#a8c8ff';
      ctx.shadowColor = '#a8c8ff'; ctx.shadowBlur = 10;
      ctx.fillRect(x - 3, y - 11 + bob - sinkY * 0.5, 1.5, 1.5);
      ctx.fillRect(x + 1.5, y - 11 + bob - sinkY * 0.5, 1.5, 1.5);
    }
    // Stone-dust particles while emerging.
    if (e.emergeTime > 0 && Math.random() < 0.4) {
      spawnParticles(e.x + (Math.random() - 0.5) * 14, e.y + 8, '#5a6678', 1);
    }
    ctx.globalAlpha = 1;
  } else if (e.type === 'guardian') {
    // Hulking rune golem. Plays an "assemble" rise during emergeTime
    // (rune stones fly into him from the circle, see set-piece module).
    const rise   = e.emergeTime > 0 ? Math.max(0, e.emergeTime / 1.2) : 0;
    const sinkY  = rise * 18;
    const alpha  = 1 - rise * 0.35;
    ctx.globalAlpha = alpha;
    // Purple aura.
    ctx.shadowColor = e.glow; ctx.shadowBlur = 22;
    // Legs / base block.
    ctx.fillStyle = flash ? '#fff' : '#3a3a44';
    ctx.fillRect(x - 12, y + 4 + bob - sinkY * 0.2, 24, 10);
    // Torso block.
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.fillRect(x - 14, y - 12 + bob - sinkY * 0.4, 28, 18);
    // Shoulder pads.
    ctx.fillStyle = flash ? '#fff' : '#4a4a54';
    ctx.fillRect(x - 18, y - 10 + bob - sinkY * 0.4, 6, 10);
    ctx.fillRect(x + 12, y - 10 + bob - sinkY * 0.4, 6, 10);
    // Arms — animate slam telegraph (arms raised, purple glow building)
    // and post-impact (arms slammed down past the body). Default pose:
    // arms hanging at the sides next to the shoulders.
    const tel    = e.slamTel   || 0;
    const flashT = e.slamFlash || 0;
    const SLAM_TEL = 0.45;
    let armUp = 0;        // 0..1 raise factor
    let armDn = 0;        // 0..1 slam-down factor
    if (tel > 0) {
      // Windup: armUp eases from 0 → 1 as tel decreases from SLAM_TEL → 0.
      armUp = 1 - (tel / SLAM_TEL);
    } else if (flashT > 0) {
      // Impact: arms held at slammed-down pose, decaying back.
      armDn = flashT / 0.18;
    }
    const armBaseY = y - 6 + bob - sinkY * 0.4;
    const armRaise = armUp * 22;         // pixels up during windup
    const armDrop  = armDn * 14;         // pixels down on impact
    ctx.fillStyle = flash ? '#fff' : '#4a4a54';
    // Left arm.
    ctx.fillRect(x - 22, armBaseY - armRaise + armDrop, 6, 14);
    // Right arm.
    ctx.fillRect(x + 16, armBaseY - armRaise + armDrop, 6, 14);
    // Fists glow brighter during windup.
    if (armUp > 0.15) {
      const g = 0.4 + 0.6 * armUp;
      ctx.fillStyle = `rgba(184,144,255,${g})`;
      ctx.shadowColor = '#e0c0ff'; ctx.shadowBlur = 14;
      ctx.fillRect(x - 23, armBaseY - armRaise - 4, 8, 6);
      ctx.fillRect(x + 15, armBaseY - armRaise - 4, 8, 6);
    }
    ctx.shadowColor = e.glow; ctx.shadowBlur = 22;
    // Head (smaller stone block).
    ctx.fillStyle = flash ? '#fff' : '#6a6a74';
    ctx.fillRect(x - 7, y - 22 + bob - sinkY * 0.5, 14, 10);
    // Carved cracks (darker line) on torso.
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(20, 12, 28, 0.65)';
    ctx.fillRect(x - 10, y - 6 + bob - sinkY * 0.4, 1, 6);
    ctx.fillRect(x + 4,  y - 8 + bob - sinkY * 0.4, 1, 8);
    // Glowing runes carved into the torso (pulse).
    if (rise < 0.6) {
      const pulse = 0.55 + 0.45 * Math.sin(state.time * 3 + e.walkAnim);
      ctx.fillStyle = `rgba(184,144,255,${pulse})`;
      ctx.shadowColor = '#b890ff'; ctx.shadowBlur = 8;
      ctx.fillRect(x - 6, y - 5  + bob - sinkY * 0.4, 2, 6);
      ctx.fillRect(x - 1, y - 8  + bob - sinkY * 0.4, 2, 4);
      ctx.fillRect(x + 4, y - 5  + bob - sinkY * 0.4, 2, 6);
      ctx.fillRect(x - 4, y - 1  + bob - sinkY * 0.4, 8, 2);
      // Eye slit on the head — flashes red during slam windup as a tell.
      const eyeColor = armUp > 0.2 ? `rgba(255,${Math.round(200 - armUp * 200)},${Math.round(200 - armUp * 200)},1)` : null;
      if (eyeColor) {
        ctx.fillStyle = eyeColor;
        ctx.shadowColor = '#ff8080'; ctx.shadowBlur = 10;
      } else {
        ctx.fillStyle = `rgba(184,144,255,${pulse})`;
      }
      ctx.fillRect(x - 5, y - 19 + bob - sinkY * 0.5, 10, 1.5);
    }
    // Stone dust while emerging.
    if (e.emergeTime > 0 && Math.random() < 0.5) {
      spawnParticles(e.x + (Math.random() - 0.5) * 22, e.y + 12, '#3a2c4a', 1);
    }
    ctx.globalAlpha = 1;
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
  } else if (e.type === 'wolf') {
    // Wolf: four-legged canine with pointed snout, pricked ears and bushy tail.
    ctx.shadowColor = e.glow; ctx.shadowBlur = 8;
    const wr = e.r;
    // Back legs (behind body, darker)
    ctx.fillStyle = flash ? '#ddd' : '#3a2a1a';
    ctx.fillRect(x - wr * 0.5, y + wr * 0.1 + bob, 3, wr * 0.8);
    ctx.fillRect(x + wr * 0.3, y + wr * 0.1 + bob, 3, wr * 0.8);
    // Tail (bushy, curved down)
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.beginPath();
    ctx.moveTo(x - wr * 1.0, y - wr * 0.1 + bob);
    ctx.quadraticCurveTo(x - wr * 1.8, y - wr * 0.9 + bob, x - wr * 1.2, y - wr * 0.1 + bob);
    ctx.fill();
    // Body (elongated ellipse)
    ctx.beginPath();
    ctx.ellipse(x, y + bob, wr * 1.2, wr * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // Front legs (over body, darker)
    ctx.fillStyle = flash ? '#ddd' : '#3a2a1a';
    ctx.fillRect(x - wr * 0.8, y + wr * 0.1 + bob, 3, wr * 0.8);
    ctx.fillRect(x + wr * 0.7, y + wr * 0.1 + bob, 3, wr * 0.8);
    // Neck
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.beginPath();
    ctx.ellipse(x + wr * 0.8, y - wr * 0.1 + bob, wr * 0.4, wr * 0.5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Head (pointed snout)
    ctx.beginPath();
    ctx.ellipse(x + wr * 1.2, y - wr * 0.15 + bob, wr * 0.65, wr * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Snout
    ctx.beginPath();
    ctx.ellipse(x + wr * 1.7, y + wr * 0.05 + bob, wr * 0.3, wr * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // Nose tip
    ctx.fillStyle = '#1a0a0a';
    ctx.fillRect(x + wr * 1.9, y + wr * 0.05 + bob, 2, 2);
    // Ears (triangles, pricked)
    ctx.fillStyle = flash ? '#fff' : '#4a3a2a';
    ctx.beginPath(); ctx.moveTo(x + wr * 1.1, y - wr * 0.6 + bob); ctx.lineTo(x + wr * 1.3, y - wr * 1.1 + bob); ctx.lineTo(x + wr * 1.5, y - wr * 0.5 + bob); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + wr * 1.4, y - wr * 0.5 + bob); ctx.lineTo(x + wr * 1.6, y - wr * 1.0 + bob); ctx.lineTo(x + wr * 1.8, y - wr * 0.4 + bob); ctx.closePath(); ctx.fill();
    // Eyes (yellow glow)
    ctx.fillStyle = '#ff0';
    ctx.shadowColor = '#ff0'; ctx.shadowBlur = 6;
    ctx.fillRect(x + wr * 1.3, y - wr * 0.2 + bob, 2, 1.5);
    ctx.fillRect(x + wr * 1.3, y + wr * 0.1 + bob, 2, 1.5);
    // Feet
    ctx.fillStyle = flash ? '#ddd' : '#2a1a0a';
    ctx.fillRect(x - wr * 0.5, y + wr * 0.85 + bob, 4, 2);
    ctx.fillRect(x + wr * 0.3, y + wr * 0.85 + bob, 4, 2);
    ctx.fillRect(x - wr * 0.8, y + wr * 0.85 + bob, 4, 2);
    ctx.fillRect(x + wr * 0.7, y + wr * 0.85 + bob, 4, 2);
  } else if (e.type === 'alphaWolf') {
    // Alpha Wolf: larger, scarred, with a dark mane and blazing eyes.
    ctx.shadowColor = e.glow; ctx.shadowBlur = 14;
    const ar = e.r;
    // Back legs
    ctx.fillStyle = flash ? '#ccc' : '#2a1a0a';
    ctx.fillRect(x - ar * 0.5, y + ar * 0.15 + bob, 4, ar * 0.9);
    ctx.fillRect(x + ar * 0.4, y + ar * 0.15 + bob, 4, ar * 0.9);
    // Tail (large bushy)
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.beginPath();
    ctx.moveTo(x - ar * 1.1, y - ar * 0.1 + bob);
    ctx.quadraticCurveTo(x - ar * 2.0, y - ar * 1.0 + bob, x - ar * 1.3, y - ar * 0.1 + bob);
    ctx.fill();
    // Body (larger, muscular)
    ctx.beginPath();
    ctx.ellipse(x, y + bob, ar * 1.35, ar * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Front legs
    ctx.fillStyle = flash ? '#ccc' : '#2a1a0a';
    ctx.fillRect(x - ar * 0.9, y + ar * 0.15 + bob, 4, ar * 0.9);
    ctx.fillRect(x + ar * 0.8, y + ar * 0.15 + bob, 4, ar * 0.9);
    // Neck
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.beginPath();
    ctx.ellipse(x + ar * 0.9, y - ar * 0.1 + bob, ar * 0.5, ar * 0.55, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Mane / scruff (ring around neck)
    ctx.fillStyle = flash ? '#fff' : '#4a3a2a';
    ctx.beginPath();
    ctx.ellipse(x + ar * 0.5, y - ar * 0.35 + bob, ar * 0.8, ar * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    // Head (larger, broader)
    ctx.fillStyle = flash ? '#fff' : e.color;
    ctx.beginPath();
    ctx.ellipse(x + ar * 1.3, y - ar * 0.1 + bob, ar * 0.75, ar * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Snout (thicker)
    ctx.beginPath();
    ctx.ellipse(x + ar * 1.9, y + ar * 0.1 + bob, ar * 0.35, ar * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    // Nose
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(x + ar * 2.1, y + ar * 0.1 + bob, 3, 3);
    // Ears (torn)
    ctx.fillStyle = flash ? '#fff' : '#2a1a0a';
    ctx.beginPath(); ctx.moveTo(x + ar * 1.2, y - ar * 0.7 + bob); ctx.lineTo(x + ar * 1.5, y - ar * 1.3 + bob); ctx.lineTo(x + ar * 1.8, y - ar * 0.6 + bob); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + ar * 1.5, y - ar * 0.6 + bob); ctx.lineTo(x + ar * 1.8, y - ar * 1.2 + bob); ctx.lineTo(x + ar * 2.1, y - ar * 0.5 + bob); ctx.closePath(); ctx.fill();
    // Eyes (amber, turn red when enraged)
    const enraged = e.hp <= e.maxHp * 0.5;
    ctx.fillStyle = enraged ? '#ff3030' : '#ffaa00';
    ctx.shadowColor = enraged ? '#ff3030' : '#ffaa00'; ctx.shadowBlur = 10;
    ctx.fillRect(x + ar * 1.5, y - ar * 0.25 + bob, 3, 3);
    ctx.fillRect(x + ar * 1.5, y + ar * 0.15 + bob, 3, 3);
    // Scars on face and body
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + ar * 0.8, y - ar * 0.2 + bob); ctx.lineTo(x + ar * 1.7, y + ar * 0.4 + bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - ar * 0.3, y + ar * 0.3 + bob); ctx.lineTo(x + ar * 0.6, y + ar * 0.7 + bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + ar * 1.3, y - ar * 0.7 + bob); ctx.lineTo(x + ar * 2.0, y - ar * 0.2 + bob); ctx.stroke();
    // Feet
    ctx.fillStyle = flash ? '#ccc' : '#1a0a00';
    ctx.fillRect(x - ar * 0.5, y + ar * 0.95 + bob, 5, 3);
    ctx.fillRect(x + ar * 0.4, y + ar * 0.95 + bob, 5, 3);
    ctx.fillRect(x - ar * 0.9, y + ar * 0.95 + bob, 5, 3);
    ctx.fillRect(x + ar * 0.8, y + ar * 0.95 + bob, 5, 3);
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
             : floor === 3 ? ['skeleton', 'skeleton', 'skeleton', 'slime', 'bat']
             : ['skeleton', 'mage', 'bat', 'slime'];

  for (const r of state.rooms) {
    if (r.isStartRoom) continue;
    // Sala del Gran Tomo: the Simon-Says encounter spawns its own wave on
    // failure; pre-populating the room would defeat the puzzle.
    if (r.isGrandTome) continue;
    // Observatorio: pacific buff room, no hostile spawns.
    if (r.isObservatory) continue;
    // Archivo Prohibido: sealed vault; the only thing inside is the
    // legendary chest. Populating with enemies would let them block the
    // chest and confuse the room's purpose.
    if (r.isForbiddenArchive) continue;
    // Density scales with room area: ~1 enemy per 28 tiles, clamped to a
    // sensible band so tiny rooms still pose a threat and star rooms
    // don't become slaughterhouses.
    const area = r.w * r.h;
    const base = Math.ceil(area / 28);
    let n      = Math.max(2, Math.min(4 + floor, base + irand(0, 1 + Math.floor(floor / 2))));
    // Sala de la Llave: extra mobs only for the kill-all variant. The
    // rune-pair puzzle is a mechanical room — spawning enemies in it
    // would block the pedestals and turn the puzzle into a brawl.
    const isKeyRoom = !!r.isKeyRoom;
    if (isKeyRoom && (r.keyVariant === 'rune' || r.keyVariant === 'candle')) continue;
    if (isKeyRoom) n += 3;
    // Guarida del Alfa: enemies are pre-placed via alphaLairSpawns
    if (r.isAlphaLair) continue;
    for (let i = 0; i < n; i++) {
      let ex, ey, safety = 12;
      do {
        ex = (r.x + irand(1, r.w - 2)) * TILE + TILE / 2;
        ey = (r.y + irand(1, r.h - 2)) * TILE + TILE / 2;
        safety--;
      } while (isWall(state.map, Math.floor(ex / TILE), Math.floor(ey / TILE)) && safety > 0);
      if (safety <= 0) continue;
      const e = createEnemy(choice(pool), ex, ey, floor);
      e.room = r;
      if (isKeyRoom) e.fromKeyRoom = true;
      state.enemies.push(e);
      r.enemies.push(e);
    }
  }
  for (const r of state.rooms) {
    if (r.isStartRoom || r.isStairsRoom) continue;
    // The Great Library hosts its own legendary + rare chests as a reward
    // for completing the Guardian encounter — skip the generic spawner
    // here so chests don't land on top of the summoning circle.
    if (r.isGreatLibrary) continue;
    // The Sala del Gran Tomo gives chests on Simon-Says success and
    // spawns a hostile wave on failure — no random chests on entry.
    if (r.isGrandTome) continue;
    // Observatorio: the buff is the reward, no chests inside.
    if (r.isObservatory) continue;
    // Sala de la Llave: the rune key is the only reward, dropped on
    // wave clear. No generic chests or it would dilute the goal.
    if (r.isKeyRoom) continue;
    // Archivo Prohibido: hand-placed legendary chest below.
    if (r.isForbiddenArchive) continue;
    // Guarida del Alfa: legendary chest drops from the encounter, not here.
    if (r.isAlphaLair) continue;
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

  // Archivo Prohibido: hand-place a legendary chest at the room centre
  // (free, since the player paid by clearing the Sala de la Llave). The
  // chest is tagged so the locked-door state never resets it.
  for (const r of state.rooms) {
    if (!r.isForbiddenArchive) continue;
    state.loot.push({
      type: 'chest', opened: false,
      rare: false, legendary: true,
      cost: 0,
      x: r.cx * TILE + TILE / 2,
      y: r.cy * TILE + TILE / 2,
      age: 0, r: 12, vx: 0, vy: 0,
      fromArchive: true,
    });
  }

  // Guarida del Alfa: spawn pre-placed alpha pack from alphaLairSpawns.
  // These enemies are already positioned in the arena; they are tagged
  // with fromAlphaLair so updateAlphaLair can track victory.
  for (const r of state.rooms) {
    if (!r.isAlphaLair || !r.alphaLairSpawns) continue;
    for (const spawn of r.alphaLairSpawns) {
      const ex = spawn.tx * TILE + TILE / 2;
      const ey = spawn.ty * TILE + TILE / 2;
      const e = createEnemy(spawn.type, ex, ey, state.floor);
      e.room = r;
      e.fromAlphaLair = true;
      state.enemies.push(e);
      r.enemies.push(e);
    }
  }

  // Breakable props scattered through non-start rooms.
  for (const r of state.rooms) {
    if (r.isStartRoom) continue;
    if (r.isObservatory) continue;
    if (r.isKeyRoom) continue;          // arena must stay clear
    if (r.isForbiddenArchive) continue; // sealed vault, no clutter
    if (r.isAlphaLair) continue;        // lair has its own set-dressing
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
