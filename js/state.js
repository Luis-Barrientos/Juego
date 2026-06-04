/**
 * Mutable game state shared across modules. Exposed as a single object so
 * other modules can read and write fields without circular imports.
 */
export const state = {
  state: 'menu',          // see config.STATE_*
  map: null,              // 2D tile array
  rooms: [],
  player: null,
  enemies: [],
  projectiles: [],
  particles: [],
  loot: [],
  damageTexts: [],
  lights: [],             // torches
  sunbeams: [],           // tall light shafts (biome 'ruins')
  puddles: [],            // water puddles on floor (biome 'ruins')
  decorations: [],        // painted decorations: loculi, cobwebs, etc.
  cameraX: 0,
  cameraY: 0,
  shake: 0,
  floor: 1,
  gold: 0,
  score: 0,
  kills: 0,
  time: 0,
  lastTime: 0,
  currentRoom: null,
  bossSpawned: false,
  /** Active biome definition for the current floor. See biomes.js. */
  biome: null,
};
