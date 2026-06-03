/**
 * Game-wide configuration constants.
 * Edit values here to tune balance without touching logic.
 */

// ── Tile / world ──────────────────────────────────────────────
export const TILE   = 32;
export const MAP_W  = 48;
export const MAP_H  = 48;

/**
 * Viewport size. These are *live bindings*: importers always see the latest
 * value. Use `setViewSize(w, h)` to update them on window resize.
 */
export let VIEW_W = 800;
export let VIEW_H = 600;

export function setViewSize(w, h) {
  VIEW_W = w;
  VIEW_H = h;
}

// ── Tile types ────────────────────────────────────────────────
export const T_WALL  = 0;
export const T_FLOOR = 1;
export const T_DOOR  = 2;
export const T_STAIR = 3;

// ── High-level game states ────────────────────────────────────
export const STATE_MENU    = 'menu';
export const STATE_PLAY    = 'play';
export const STATE_PAUSE   = 'pause';
export const STATE_DEAD    = 'dead';
export const STATE_WIN     = 'win';
export const STATE_UPGRADE = 'upgrade';
export const STATE_INTRO   = 'intro';

// ── Run length ────────────────────────────────────────────────
/** Number of floors in a complete run (last floor is the final boss). */
export const MAX_FLOOR = 4;

// ── Player baseline stats ─────────────────────────────────────
export const PLAYER_BASE = Object.freeze({
  hp: 100,
  mp: 50,
  speed: 165,
  swingDur: 0.22,
  swingRange: 44,
  swingArc: Math.PI * 0.7,
  swingDmg: 25,
  magicDmg: 30,
  magicCost: 12,
  mpRegen: 4,
});
