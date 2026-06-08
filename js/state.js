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
  sarcophagi: [],         // catacombs sarcophagi (solid props, some awakable)
  libraryProps: [],       // library shelves and tables (solid props)
  librarySetPiece: null,  // library Great-Library event state
  grandTome:       null,  // library Sala del Gran Tomo (Simon-Says) state
  keyRoom:         null,  // library Sala de la Llave (kill-all puzzle) state
  archiveDoor:     null,  // [{tx, ty}, ...] locked doors of the Archivo Prohibido
  archiveRoom:     null,  // active Forbidden Archive room object
  _archiveEntered: false, // true once the player has entered for the first time
  archiveVignetteAlpha: 0, // dynamic alpha (0-1) for screen overlay vignette
  hasArchiveKey:   false, // true once the player picks up the rune key
  challenge: null,        // crypta challenge state (see challenge.js)
  soulSpawners: [],       // catacombs ambient soul anchors (see main.js)
  leafSpawners: [],       // library ambient leaf / paper-scrap anchors
  _whisperTimer: 0,       // seconds until the next whisper sound
  _creakTimer: 0,         // seconds until the next library wood-creak sound
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
