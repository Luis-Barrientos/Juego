/**
 * Generic numeric / array helpers used across modules.
 */

/**
 * Mulberry32 — small, fast deterministic PRNG.
 * @param {number} seed 32-bit unsigned integer seed.
 * @returns {() => number} Function returning floats in [0, 1).
 */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [a, b). */
export const rand  = (a, b) => a + Math.random() * (b - a);
/** Uniform integer in [a, b] (inclusive). */
export const irand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
/** Clamp value between min and max. */
export const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
/** Euclidean distance between two `{x, y}` points. */
export const dist  = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Linear interpolation between a and b by t ∈ [0, 1]. */
export const lerp  = (a, b, t) => a + (b - a) * t;
/** Pick a random element from a non-empty array. */
export const choice = arr => arr[Math.floor(Math.random() * arr.length)];

/** Seeded variants — accept an `rng` function `() => float`. */
export const srand   = (rng, a, b) => a + rng() * (b - a);
export const sirand  = (rng, a, b) => Math.floor(a + rng() * (b - a + 1));
export const schoice = (rng, arr) => arr[Math.floor(rng() * arr.length)];
