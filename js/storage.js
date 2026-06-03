/**
 * Thin wrapper over `localStorage` with namespacing and JSON encoding.
 * Currently used for high scores and settings (Phase 4 will extend).
 */

const NS = 'dungeon_depths.';

/**
 * Save a JSON-serialisable value under a namespaced key.
 * @param {string} key
 * @param {unknown} value
 */
export function save(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch (_) { /* storage may be disabled */ }
}

/**
 * Load a previously saved value or return `fallback` when missing/invalid.
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

/** Remove a saved entry. */
export function remove(key) {
  try { localStorage.removeItem(NS + key); } catch (_) { /* noop */ }
}
