/**
 * Biome definitions. Each entry describes the visual identity (palette,
 * decorations, ambient light) and gameplay modifiers of one floor type.
 *
 * Keep this file pure data — biome behaviour is applied by the modules that
 * read it (render.js for visuals, main.js for modifiers, dungeon.js for
 * torch colours).
 */

/**
 * Biome lookup table keyed by id.
 * @type {Object<string, BiomeDef>}
 */
export const BIOMES = {
  /* ── Piso 1 — superficie invadida por la vegetación ───────────────── */
  ruins: {
    id: 'ruins',
    name: 'Ruinas Verdes',
    subtitle: 'I',
    floor: { base: [44, 50, 38], alt: [60, 70, 50], crackTint: 'rgba(20,40,15,0.35)' },
    wall:  { top: '#2a3820', side: '#162010', bottom: '#0a1408', edge: '#3a5028' },
    accent: '#6ec050',
    /** RGB of light radius colour (used by drawLighting). */
    torchColor:    [255, 220, 140],
    /** Additive tint over torches for the warm halo. */
    torchTint:     'rgba(255,220,150,0.20)',
    /** Ambient overlay alpha — lower means brighter floor. */
    ambientAlpha:  0.55,
    ambientTint:   'rgba(20, 30, 14, 0.55)',
    /** Density of decoration sprites on floor tiles. */
    decorChance:   0.20,
    decorations:   ['moss', 'roots', 'mushroom', 'sunbeam'],
    modifiers:     { hpRegenIdle: 0.6 },
  },

  /* ── Piso 2 — bajamos a la cripta, vegetación moribunda ──────────── */
  crypt: {
    id: 'crypt',
    name: 'Cripta Sumergida',
    subtitle: 'II',
    floor: { base: [38, 32, 38], alt: [52, 44, 52], crackTint: 'rgba(0,0,0,0.4)' },
    wall:  { top: '#2a1838', side: '#1a0e22', bottom: '#0a060c', edge: '#4a2868' },
    accent: '#a060ff',
    torchColor:    [180, 100, 220],
    torchTint:     'rgba(160, 80, 220, 0.18)',
    ambientAlpha:  0.84,
    ambientTint:   'rgba(8, 4, 14, 0.84)',
    decorChance:   0.16,
    decorations:   ['cobweb', 'skull', 'driedRoot', 'moss'],
    modifiers:     {},
  },

  /* ── Piso 3 — biblioteca de magia perdida ────────────────────────── */
  library: {
    id: 'library',
    name: 'Biblioteca Maldita',
    subtitle: 'III',
    floor: { base: [40, 30, 22], alt: [56, 42, 28], crackTint: 'rgba(255,200,80,0.18)' },
    wall:  { top: '#3a2818', side: '#22180c', bottom: '#0a0604', edge: '#806030' },
    accent: '#60a0ff',
    torchColor:    [120, 180, 255],
    torchTint:     'rgba(100, 160, 255, 0.20)',
    ambientAlpha:  0.78,
    ambientTint:   'rgba(8, 12, 24, 0.78)',
    decorChance:   0.22,
    decorations:   ['books', 'rune', 'paper'],
    modifiers:     { mpRegenBonus: 0.5 },
  },

  /* ── Piso 4 — núcleo profundo, dominio del boss ──────────────────── */
  core: {
    id: 'core',
    name: 'Núcleo Profundo',
    subtitle: 'IV',
    floor: { base: [26, 14, 12], alt: [54, 22, 14], crackTint: 'rgba(255,80,20,0.45)' },
    wall:  { top: '#1a0a08', side: '#0a0402', bottom: '#000', edge: '#a02810' },
    accent: '#ff6030',
    torchColor:    [255, 90, 40],
    torchTint:     'rgba(255, 80, 30, 0.24)',
    ambientAlpha:  0.92,
    ambientTint:   'rgba(20, 4, 0, 0.92)',
    decorChance:   0.12,
    decorations:   ['bones', 'lavaCrack', 'ash'],
    modifiers:     {},
  },
};

/** Order of biomes per floor. Index = floor - 1. */
export const BIOMES_BY_FLOOR = ['ruins', 'crypt', 'library', 'core'];

/**
 * Resolve the biome for a given (1-based) floor number.
 * Falls back to looping through the list if the floor exceeds the array.
 * @param {number} floor
 * @returns {BiomeDef}
 */
export function getBiomeForFloor(floor) {
  const id = BIOMES_BY_FLOOR[(floor - 1) % BIOMES_BY_FLOOR.length];
  return BIOMES[id];
}

/**
 * @typedef {object} BiomeDef
 * @property {string} id
 * @property {string} name
 * @property {string} subtitle
 * @property {{base:number[],alt:number[],crackTint:string}} floor
 * @property {{top:string,side:string,bottom:string,edge:string}} wall
 * @property {string} accent
 * @property {number[]} torchColor
 * @property {string}   torchTint
 * @property {number}   ambientAlpha
 * @property {string}   ambientTint
 * @property {number}   decorChance
 * @property {string[]} decorations
 * @property {object}   modifiers
 */
