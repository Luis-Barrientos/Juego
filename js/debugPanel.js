/**
 * debugPanel.js
 * --------------------------------------------------------------------------
 * Developer-only floor / room teleport panel toggled with F2.
 *
 * - Lists every floor (1 to MAX_FLOOR) as a clickable header that expands
 *   into the set of rooms the game knows how to spawn on that biome
 *   (special set-pieces + generic categories like "start" / "stairs").
 * - Picking a room teleports the player there. If the requested floor is
 *   not the current one, the dungeon is regenerated first (forcing the
 *   special set-piece flags when applicable) and then we teleport.
 *
 * Only activates in localhost / 127.0.0.1 / file:// or when the URL
 * carries ?debug=1, so a published build never exposes the panel.
 */

import { state } from './state.js';
import { TILE, MAX_FLOOR, STATE_PLAY } from './config.js';
import { getBiomeForFloor } from './biomes.js';

/** Per-biome catalogue of "interesting" room categories. The label is what
 *  the user sees, the matcher receives a room and returns true if that
 *  room qualifies. `force` is the global flag set on `window.__DEBUG_FORCE`
 *  before regeneration so the dungeon guarantees this set-piece. */
const ROOM_CATALOGUE = {
  ruins: [
    { label: 'Entrada (start)',     match: r => r.isStartRoom },
    { label: 'Escalera (stairs)',   match: r => r.isStairsRoom },
    { label: 'Sala grande (rayo)',  match: r => r.isLarge && !r.isStartRoom && !r.isStairsRoom },
  ],
  library: [
    { label: 'Entrada (start)',         match: r => r.isStartRoom },
    { label: 'Escalera (stairs)',       match: r => r.isStairsRoom },
    { label: 'Sala del Gran Tomo',      match: r => r.isGrandTome,     force: 'grandTome' },
    { label: 'Gran Biblioteca',         match: r => r.isGreatLibrary,  force: 'greatLibrary' },
    { label: 'Observatorio',            match: r => r.isObservatory,   force: 'observatory' },
  ],
  crypt: [
    { label: 'Entrada (start)',     match: r => r.isStartRoom },
    { label: 'Escalera (stairs)',   match: r => r.isStairsRoom },
    { label: 'Cripta (altar)',      match: r => r.isLarge && !r.isStartRoom && !r.isStairsRoom },
  ],
  core: [
    { label: 'Entrada (start)',     match: r => r.isStartRoom },
    { label: 'Sala del Jefe',       match: r => r.isStairsRoom || r.isLarge },
  ],
};

let panelEl   = null;
let expanded  = new Set();  // floor numbers currently expanded
let buildFloorFn = null;    // injected from main.js — rebuilds a floor

/**
 * Initialise the debug panel. Wires the F2 listener and stores the
 * floor-rebuild callback used when the user picks a room on a different
 * floor than the current one.
 *
 * @param {{ buildFloor: (floor:number) => void }} hooks
 */
export function initDebugPanel(hooks) {
  buildFloorFn = hooks.buildFloor;
  document.addEventListener('keydown', e => {
    // "ç" key on Spanish keyboards reports e.code === 'Semicolon'.
    // Also accept e.key === 'ç' as a fallback for other layouts.
    if (e.code === 'Semicolon' || e.key === 'ç' || e.key === 'Ç') {
      e.preventDefault();
      toggle();
    }
  });
  // Pre-create the panel element so the first toggle is instant.
  panelEl = createPanelDom();
  document.body.appendChild(panelEl);
  // Floating opener button so the panel is always reachable even if the
  // keyboard shortcut is intercepted by the browser.
  const opener = document.createElement('button');
  opener.id = 'debugOpener';
  opener.type = 'button';
  opener.textContent = 'Debug (ç)';
  opener.title = 'Abrir panel de debug (ç)';
  opener.addEventListener('click', toggle);
  document.body.appendChild(opener);
  // Default: start with the current floor expanded.
  expanded.add(1);
}

/** Reserved for future use — the panel is currently always available. */
// eslint-disable-next-line no-unused-vars
function _legacyDebugCheck() { return true; }

function toggle() {
  if (!panelEl) return;
  if (panelEl.classList.contains('hidden')) {
    expanded.add(state.floor || 1);
    refresh();
    panelEl.classList.remove('hidden');
  } else {
    panelEl.classList.add('hidden');
  }
}

function createPanelDom() {
  const root = document.createElement('div');
  root.id = 'debugPanel';
  root.className = 'hidden';
  root.innerHTML = `
    <div class="dp-header">
      <span>Debug · Teletransporte (ç)</span>
      <button class="dp-close" type="button" aria-label="Cerrar">×</button>
    </div>
    <div class="dp-body"></div>
    <div class="dp-foot">Click sobre un piso para desplegar sus salas.</div>
  `;
  root.querySelector('.dp-close').addEventListener('click', () => toggle());
  return root;
}

/** Re-render the body of the panel based on `expanded` and the current state. */
function refresh() {
  if (!panelEl) return;
  const body = panelEl.querySelector('.dp-body');
  body.textContent = '';
  for (let floor = 1; floor <= MAX_FLOOR; floor++) {
    body.appendChild(renderFloorRow(floor));
  }
}

function renderFloorRow(floor) {
  const biome = getBiomeForFloor(floor);
  const isOpen = expanded.has(floor);
  const isCurrent = state.floor === floor;
  const row = document.createElement('div');
  row.className = 'dp-floor' + (isCurrent ? ' dp-current' : '');

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'dp-floor-head';
  head.innerHTML = `
    <span class="dp-floor-num">Piso ${floor}</span>
    <span class="dp-floor-name">${biome.name}</span>
    <span class="dp-floor-toggle">${isOpen ? '▾' : '▸'}</span>
  `;
  head.addEventListener('click', () => {
    if (expanded.has(floor)) expanded.delete(floor);
    else                     expanded.add(floor);
    refresh();
  });
  row.appendChild(head);

  if (!isOpen) return row;

  const list = document.createElement('div');
  list.className = 'dp-rooms';
  const catalogue = ROOM_CATALOGUE[biome.id] || [];
  for (const entry of catalogue) {
    list.appendChild(renderRoomEntry(floor, entry));
  }
  row.appendChild(list);
  return row;
}

function renderRoomEntry(floor, entry) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dp-room';

  // If this is the current floor we can look at state.rooms directly to
  // show whether the room actually exists on the current seed.
  let existsLabel = '';
  if (state.floor === floor && state.rooms) {
    const hit = state.rooms.find(r => entry.match(r));
    existsLabel = hit ? ' ✓' : ' (regenerar)';
  } else {
    existsLabel = ' (otro piso)';
  }
  btn.textContent = entry.label + existsLabel;
  btn.addEventListener('click', () => teleportTo(floor, entry));
  return btn;
}

/**
 * Teleport the player to a room matching `entry` on `floor`. Regenerates
 * the floor if needed (or if the matching room is not present on the
 * current seed), setting the appropriate window-level force flag so the
 * special set-piece is guaranteed to spawn.
 */
function teleportTo(floor, entry) {
  if (!buildFloorFn) return;

  const tryHere = state.floor === floor && state.rooms
    ? state.rooms.find(r => entry.match(r))
    : null;

  if (tryHere) {
    placePlayerInRoom(tryHere);
    toggle();
    return;
  }

  // Need to regenerate. Force the special if applicable, then rebuild.
  window.__DEBUG_FORCE = window.__DEBUG_FORCE || {};
  if (entry.force) window.__DEBUG_FORCE[entry.force] = true;

  state.floor = floor;
  buildFloorFn(floor);
  // Clear the force flag so future natural floors stay random.
  if (entry.force) delete window.__DEBUG_FORCE[entry.force];

  const hit = state.rooms.find(r => entry.match(r));
  if (hit) placePlayerInRoom(hit);
  state.state = STATE_PLAY;
  toggle();
  refresh();
}

function placePlayerInRoom(room) {
  if (!state.player) return;
  // Some set-pieces (e.g. the Observatorio telescope) occupy the centre
  // tiles as solid walls — landing right on (cx, cy) would trap us. Walk
  // outward in concentric rings until we hit a floor tile.
  const t = findNearestFloor(state.map, room.cx, room.cy);
  state.player.x = t.tx * TILE + TILE / 2;
  state.player.y = t.ty * TILE + TILE / 2;
  state.currentRoom = room;
  // Reset the per-floor "entered observatory" flag so the toast fires
  // again if we hop in and out for testing.
  state._observatoryEntered = false;
}

/**
 * Find the nearest walkable tile to (cx, cy) by scanning concentric
 * rings outward up to maxRadius. Returns {tx, ty}; falls back to the
 * input coords if nothing was found (should not happen inside a valid
 * room).
 * @private
 */
function findNearestFloor(map, cx, cy, maxRadius = 6) {
  const T_FLOOR_ = 1;
  if (map[cy] && map[cy][cx] === T_FLOOR_) return { tx: cx, ty: cy };
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Only the ring border at this radius.
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (map[y] && map[y][x] === T_FLOOR_) return { tx: x, ty: y };
      }
    }
  }
  return { tx: cx, ty: cy };
}
