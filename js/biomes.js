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
    tagline: 'Donde la naturaleza reclama lo que el tiempo olvidó',
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
    decorations:   ['moss', 'roots', 'mushroom'],
    modifiers:     { hpRegenIdle: 0.6 },
  },

  /* ── Piso 3 — catacumbas frías, dominio funerario ────────────── */
  crypt: {
    id: 'crypt',
    name: 'Catacumbas',
    subtitle: 'III',
    tagline: 'Galerías estrechas y velas azules guardan a los muertos',
    floor: { base: [34, 36, 42], alt: [48, 50, 58], crackTint: 'rgba(0,0,0,0.45)' },
    wall:  { top: '#2a2e36', side: '#1a1d22', bottom: '#080a0c', edge: '#3c4250' },
    accent: '#a8c8ff',
    /** Cool blue-white candle flame. */
    torchColor:    [180, 200, 255],
    /** Subtle cool halo around candles. */
    torchTint:     'rgba(160, 190, 240, 0.16)',
    /** Slightly darker than ruins so candle pools really stand out. */
    ambientAlpha:  0.78,
    ambientTint:   'rgba(10, 14, 24, 0.78)',
    decorChance:   0.16,
    decorations:   ['cobweb', 'skull', 'driedRoot'],
    modifiers:     {},
  },

  /* ── Piso 2 — biblioteca de magia perdida ────────────────── */
  library: {
    id: 'library',
    name: 'Biblioteca Maldita',
    subtitle: 'II',
    tagline: 'Restos de un saber prohibido, atravesado por ecos de magia residual',
    floor: { base: [44, 32, 22], alt: [60, 44, 30], crackTint: 'rgba(180,140,200,0.18)' },
    wall:  { top: '#3a2818', side: '#22180c', bottom: '#0a0604', edge: '#806030' },
    accent: '#b890ff',
    /** Warm sconces are the dominant light; magic flames add cool accents. */
    torchColor:    [255, 200, 130],
    torchTint:     'rgba(255, 200, 130, 0.20)',
    ambientAlpha:  0.80,
    ambientTint:   'rgba(14, 8, 18, 0.80)',
    decorChance:   0.20,
    decorations:   ['books', 'paper', 'pages'],
    modifiers:     { mpRegenBonus: 0.5 },
  },

  /* ── Piso 4 — núcleo profundo, dominio del boss ──────────────────── */
  core: {
    id: 'core',
    name: 'Núcleo Profundo',
    subtitle: 'IV',
    tagline: 'El corazón ardiente espera al último descendiente',
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
export const BIOMES_BY_FLOOR = ['ruins', 'library', 'crypt', 'core'];

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
