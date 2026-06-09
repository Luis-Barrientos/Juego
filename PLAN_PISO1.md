# PLAN PISO 1 — Ruinas Verdes

> **Bioma:** `ruins` (id: `'ruins'`)  
> **Nombre:** Ruinas Verdes  
> **Subtitle:** I  
> **Tagline:** "Donde la naturaleza reclama lo que el tiempo olvidó"  
> **Estilo BSP:** `RUINS` (depth 5, minRoom 5×4, maxRoom 8×7, corridorW 2)  
> **Max star rooms:** 1–2 (expandidos a ~110 tiles área, max 14×11)

---

## 1. IDENTIDAD DEL PISO

- Castillo de entrada en ruinas, invadido por la vegetación y los hongos.
- Está **abandonado bajo tierra** — el castillo fue sepultado y la naturaleza ha reclamado el espacio.
- El **propósito del personaje está olvidado**; solo sabe que *debe bajar*.
- La iluminación es **cálida y verde**: antorchas de pared, campamentos, hongos brillantes y rayos de sol filtrándose por grietas del techo.
- **Paleta:** suelos verdes musgo, paredes verde oscuro, acento `#6ec050`.
- `hpRegenIdle: 0.6` — el jugador regenera vida lentamente al quedarse quieto (mecánica de explorador herido que descansa).

### Elementos ambientales recurrentes

| Elemento | Dónde se coloca | Propósito |
|---|---|---|
| **Antorchas de pared (`sconce`)** | Paredes de cada sala, ~1 cada 6 tiles de perímetro | Iluminación principal |
| **Grietas de techo (`sunbeam`)** | Star rooms (85% prob.), máximo 2 por piso | Luz solar + regeneración HP al estar dentro |
| **Rayos finos de luna (`moonbeam`, `kind: 'thin'`)** | Salas medianas no-star, 30% prob., máx 4 | Textura visual sutil |
| **Campamentos (`campfire`)** | Salas no-star ≥5×5, 1–2 por piso | Fogata con luz amplia, narrativa de viajeros previos |
| **Hongos brillantes (`glowMushroom`)** | Paredes interiores, 65% prob. por sala, 1–2 grupos | Luz fría azul-verdosa ambiental |
| **Pilares rotos (`pillar`)** | Salas ≥60 tiles, 1–2 normales / 3–5 en star | Cobertura táctica y textura visual |
| **Charcos (`puddle`)** | ~55% prob. en salas normales, 2–3 en star | Agua estancada con reflejos |
| **Decoraciones de pared** | Cara sur de salas, 18% prob. por tile, max 2 por sala | Placas, grietas con musgo, antorcheras rotas |
| **Decoración de suelo** | 20% prob. por tile: musgo, raíces, hongos | Textura orgánica |

---

## 2. SALAS EXCLUSIVAS DEL PISO 1

### 2.1 Guarida del Alfa (Alpha Lair)

**Estado:** ✅ Implementado (v0.9.0) — pendiente de refactor

#### Diseño

- **Probabilidad:** 55% sobre una **star room** (no garantizada, como el Observatorio).
- **Requisito de sala:** debe ser `isLarge` (expandida por `expandStarRooms`).
- **Encounter:**
  1. El jugador entra en la sala → se detecta (tetrada desde dentro, lejos de las entradas).
  2. Las entradas se sellan (`T_WALL` sobre los tiles de suelo justo fuera del perímetro).
  3. Aparece el **Alfa Lobo** (mini-boss) + 2–3 lobos.
  4. **Mecánica territorial:** si el jugador sale de la sala, el Alfa se cura rápidamente y desengacha.
  5. **Enfurecimiento <50% HP:** abanico de 5 proyectiles + anillo nova de 16 proyectiles.
  6. **Invocación:** aúlla cada ~8s y spawnear 2–3 lobos adicionales.
  7. Al morir todos los enemigos de la guarida, los sellos caen y aparece un **cofre legendario** (bendición + pociones + oro).
- **Iluminación actual:** 2 campamentos (brazierPos NW y SE de la sala).

#### Pendiente de refactor

- [ ] **`placeAlphaLair` debe ser una sala-arena dedicada:**
  - Diseño simétrico con **dais central** (plataforma elevada, como el pedestal del Gran Tomo pero en ruinas).
  - **Pilares rotos** en las esquinas (4 pilares para cobertura visual y táctica).
  - **Puntos de spawn fijos** para el Alfa (centro) y los lobos iniciales (alrededor en formación).
  - Los **enemigos deben spawnear en generación** (no al entrar), marcados con `fromAlphaLair: true`.
- [ ] **Simplificar `alphaLair.js`:**
  - Eliminar `spawnAlphaPack()` — los enemigos ya están pre-spawneados en el mapa.
  - Mantener: sellado al entrar, territorial, comprobación de victoria, cofre legendario.
- [ ] **Soportar `window.__DEBUG_FORCE.alphaLair`** en `generateDungeon` (actualmente solo se chequea dentro del bloque `if (isRuins)` al final).

#### Implementación técnica

- **Archivo:** `js/alphaLair.js` (190 líneas)
- **Enemigos:** `wolf` (HP 45, speed 110, melee), `alphaWolf` (HP 220, speed 65, territorial, enrage, howl-summon)
- **Render de lobo:** cuerpo cuadrúpedo alargado, orejas puntiagudas, cola, ojos amarillos.
- **Render de Alfa:** más grande, cicatrices, melena, ojos ámbar/rojo según enfurecimiento.
- **Cofre legendario:** `fromAlphaLair: true`, `legendary: true`, `cost: 0`.
- **Debug panel:** entrada "Guarida del Alfa" en `ROOM_CATALOGUE.ruins` con `force: 'alphaLair'`.

---

### 2.2 Claro Solar (Sunbeam Shrine)

**Estado:** 🔲 Pendiente de implementar

#### Diseño

- **Sala grande** (star room) transformada en un claro iluminado por el sol.
- El techo se ha derrumbado completamente en esta sala, dejando un **gran haz de luz solar** que ocupa la mayor parte de la sala.
- **Mecánica:**
  1. Al entrar por primera vez, el jugador recibe un **incremento permanente de HP máximo** (+30 HP, reutilizando la bendición `maxhp`).
  2. El **minimapa se revela completo** para el piso actual (todas las salas se marcan como visitadas).
  3. El haz de luz solar regenera HP más rápido que los sunbeams normales al estar dentro.
  4. Es una sala **segura** (no hay enemigos).
- **Decoración:**
  - Suelo cubierto de **hierba y flores** (decoración especial, no el suelo de baldosa normal).
  - El haz de luz es **mucho más ancho** que los sunbeams normales (cubre ~80% de la sala).
  - **Mariposas** o **partículas de luz** (polen brillante) flotando en el rayo.
  - Pequeño **altar de piedra** en el centro donde el jugador recibe la bendición (E-interaction reutilizando el sistema de `onAltar` / `onCircle`).

#### Implementación técnica

- **Nuevo flag de sala:** `r.isSunbeamShrine = true` (o `isClaroSolar`).
- **Colocación:** en `dungeon.js`, dentro del bloque `if (isRuins)`, antes de `placeAlphaLair`, con su propia probabilidad (55% sobre star rooms restantes). DEBUG: `force: 'claroSolar'`.
- **Sunbeam especial:** en `placeSunbeams`, si la sala es `isClaroSolar`, generar un haz que cubra casi toda la sala, con `kind: 'shrine'`.
- **Llamada en main.js:** en `update()`, detectar entrada al Claro Solar y si es la primera vez, otorgar `grantBlessing('maxhp')` + revelar minimapa.
- **Revelar minimapa:** `state.rooms.forEach(r => state.roomsVisited.add(\`\${r.x},\${r.y},\${r.w},\${r.h}\`))`.

---

### 2.3 Campamento del Último Explorador

**Estado:** 🔲 Pendiente de implementar

#### Diseño

- **Sala no-star**, de tamaño mediano-grande (≥6×5).
- El último explorador que llegó hasta aquí **no sobrevivió**, pero dejó su campamento.
- **Contenido:**
  - **Hoguera apagada** en el centro (campfire — se puede volver a encender al pasar cerca, o simplemente decorativa). Proporciona un punto de luz y calidez, pero es una hoguera ya usada.
  - **Notas del explorador** (1–3 "notas" en el suelo, interactuables con E que muestran un tooltip/modal). Las notas contienen **consejos prácticos sobre el piso 1**:
    - "Los hongos brillan más cuando hay peligro cerca" (pista sobre los glow mushrooms como indicador de seguridad).
    - "El Alfa no cruza la luz del sol" (pista sobre el Claro Solar como zona segura).
    - "Las grietas del techo filtran la maldición. Quédate bajo la luz." (pista sobre la regeneración de los sunbeams).
    - "Baja. Siempre hay que bajar." (lore — el propósito olvidado).
  - **Restos del explorador**: un esqueleto con una mochila vacía en una esquina (decoración).
  - Un **cofre normal** gratuito (`cost: 0`) junto al cuerpo (su último legado).
  - **Sin enemigos** — el campamento es seguro.

#### Notas del explorador (mecánica)

- Las notas son objetos `{ type: 'note', text: '...' }` en `state.loot`.
- Al pulsar E sobre una nota, se muestra un toast largo o un modal con el texto.
- Se reutiliza el sistema de E-interaction existente (el jugador ya pulsa E para cofres, escaleras, altares, etc.).
- Alternativa: las notas se pueden mostrar como `showToast` con duración extendida.

---

### 2.4 Invernadero Salvaje

**Estado:** 🔲 Pendiente de implementar

#### Diseño

- **Sala estándar** (no-star), tamaño mediano (6×5 a 8×7).
- La vegetación ha crecido sin control formando un **invernadero mortal**.
- **Mecánica:**
  - La sala contiene **plantas trepadoras** que bloquean parcialmente el paso (props sólidos `T_WALL` con apariencia de enredaderas/espinas).
  - **Plantas lanzadoras** (vineshooters): props decorativos que **disparan proyectiles lentos** al jugador cuando está cerca. Son **destructibles** (golpéalos para romperlos).
  - Las puertas de la sala están **bloqueadas por raíces** (se abren automáticamente al destruir todas las plantas lanzadoras).
  - Recompensa: al limpiar la sala, aparece un cofre normal en el centro.
- **Props:**
  - `vineWall`: enredadera sólida que bloquea el paso (T_WALL + decoración verde).
  - `vineShooter`: planta carnívora que dispara 1 proyectil lento cada ~2s al jugador. Se destruye con 1 golpe (cualquier daño). Al destruirse, suelta partículas verdes.
  - `rootDoor`: puerta bloqueada por raíces (T_WALL que se convierte en T_FLOOR al matar todos los vineShooters de la sala).

#### Variante opcional

- Si solo hay 1 vineShooter en la sala, los proyectiles son más rápidos.
- Si hay 2+, los proyectiles son más lentos pero cubren ángulos cruzados.
- Los vineShooters NO se mueven, solo rotan hacia el jugador y disparan.

---

## 3. MAPA Y MINIMAPA

### Niebla de guerra (Fog of War) — ✅ Implementado en v0.9.0

- `state.roomsVisited` es un `Set<string>` con IDs de sala (`"${r.x},${r.y},${r.w},${r.h}"`).
- La sala inicial se marca como visitada al generar el piso (`buildFloor`).
- Cada frame en `update()`, la sala actual se añade al set.
- En `drawMinimap`, los tiles se renderizan solo si la sala que los contiene está en `roomsVisited` (o es el start room).
- Los enemigos se muestran en el minimapa solo si están en la sala actual o en una sala visitada.

### Revelación completa del mapa

- Al completar el Claro Solar (Sala 2.2), todas las salas se añaden a `roomsVisited`.

---

## 4. ENEMIGOS DEL PISO 1

### Pool de generación normal

```js
pool = ['slime', 'bat'];  // floor === 1
```

### Wolf (Lobo)

| Atributo | Valor |
|---|---|
| HP | 45 (+escalado por piso) |
| Daño | 12 |
| Velocidad | 110 |
| Comportamiento | melee |
| Color | `#5a4a3a` |
| Glow | `#806040` |
| Score | 22 |
| Oro | 4–10 |

- Se usa como **enemigo normal** en la Guarida del Alfa y en oleadas invocadas por el Alfa.
- No aparece en el pool de generación normal del piso (solo como invocado).

### Alpha Wolf (Alfa Lobo)

| Atributo | Valor |
|---|---|
| HP | 220 |
| Daño | 24 |
| Velocidad | 65 |
| Comportamiento | `alphaWolf` (IA especial) |
| Color | `#3a2a1a` |
| Glow | `#a08050` |
| Score | 280 |
| Oro | 50–90 |
| howlCool | 8.0s |
| enrageThreshold | 50% HP |
| fanCool | 3.0s (enfurecido) |
| novaCool | 6.0s (enfurecido) |

#### IA (`alphaWolfAI` en `enemies.js:422`)

1. **Territorial:** si el jugador NO está en `e.room`, el Alfa se cura al 50% de su maxHP por segundo y desengacha si la distancia > 400.
2. **Howl Summon:** cada ~8s invoca 2–3 lobos (`createEnemy('wolf', ...)`) cerca del Alfa. Marca con `fromAlpha = true`.
3. **Enrage (<50% HP):**
   - **Abanico de proyectiles:** 5 proyectiles, spread 0.3, cada 3s.
   - **Anillo nova:** 16 proyectiles en círculo, cada 6s.
4. **Melee:** chase/attack normal cuando no usa habilidades.

---

## 5. GENERACIÓN DE MAZMORRA (dungeon.js)

### Flujo para Ruins

1. `generateDungeon(floor, seed, biome)` se llama desde `buildFloor` en `main.js:135`.
2. `STYLE_KEYS[(floor-1) % len]` → `'RUINS'`.
3. BSP genera salas con `STYLES.RUINS` (depth 5, min 5×4, max 8×7, corridorW 2).
4. `expandStarRooms` promueve 1–2 salas a `isLarge` (~110 tiles área).
5. Se detectan `startRoom` (top-left) y `stairsRoom` (más lejano).
6. `placePillars` — columnas rotas en salas espaciosas.
7. `buildConnections` + `carveCorridor` con MST + 27% edges extra.
8. `placeWallSconces` — antorchas en paredes.
9. **Bloque `isRuins` (línea 342 de dungeon.js):**
   - `placeSunbeams` — máximo 2 grietas en star rooms.
   - `placeCampfires` — máximo 2 hogueras en salas no-star.
   - `placeGlowMushrooms` — máximo 14 hongos en total.
   - `placeMoonbeams` — máximo 4 rayos finos de luna.
   - `placePuddles` — charcos de agua.
   - `placeRoomWallDecorations` — placas, grietas, antorcheras rotas.
   - `placeAlphaLair` — 55% prob. sobre star rooms disponibles.

### Reserva de salas especiales

- A diferencia del bioma Library (que reserva salas ANTES del BSP mediante `reserveSpecialRoom`), las ruinas **no necesitan reserva previa** porque las salas exclusivas del piso 1 usan star rooms existentes (ya generadas por BSP + expandidas).
- `placeAlphaLair` se aplica directamente sobre una star room en el post-procesado.
- Si en el futuro se necesita una sala más grande (e.g., una arena de boss para piso 1), habrá que usar `reserveSpecialRoom` igual que la Library.

---

## 6. ESTADO GLOBAL (state.js)

Campos relevantes para Piso 1:

```js
state.alphaLair = null;       // { room, state, sealedTiles, alphaDead, chestSpawned }
state.roomsVisited = new Set(); // IDs de sala visitadas
state.currentRoom = null;     // room actual (se actualiza cada frame)
state.biome = null;           // objeto BiomeDef activo
state.player = null;          // { hp, maxHp, x, y, ... }
state.enemies = [];           // [{ type, hp, fromAlphaLair, fromAlpha, ... }]
state.loot = [];              // [{ type: 'chest', legendary, fromAlphaLair, ... }]
```

---

## 7. DEBUG PANEL

- **Tecla:** `ç` (Semicolon en teclado español)
- **Entradas para `ruins`:**

| Label | Match | Force |
|---|---|---|
| Entrada (start) | `r.isStartRoom` | — |
| Escalera (stairs) | `r.isStairsRoom` | — |
| Guarida del Alfa | `r.isAlphaLair` | `alphaLair` |
| Sala grande (rayo) | `r.isLarge && !start && !stairs` | — |

- **Pendiente:** añadir entradas para Claro Solar, Campamento, Invernadero.

---

## 8. CHANGELOG

### v0.9.0 (2026-06-08) — Piso 1: Minimap Fog of War + Guarida del Alfa

- Minimapa con niebla de guerra: las salas solo se revelan al visitarlas. La sala inicial siempre es visible.
- Nueva sala exclusiva: Guarida del Alfa. Una star room que se sella al entrar, con el Alfa Lobo (mini-boss) y su manada.
  - El Alfa es territorial (si sales de la sala se cura y desengacha) y se enfurece al 50% HP con abanico de proyectiles y anillo nova.
  - Al vencerlo aparece un cofre legendario (bendición + pociones + oro).
- Nuevos enemigos: Lobo (rápido, melee) y Alfa Lobo (mini-boss con invocación de manada, proyectiles y nova).

---

## 9. PRÓXIMOS PASOS (orden sugerido)

1. 🔲 **Crear `PLAN_PISO1.md`** (este documento)
2. 🔲 **Refactorizar `placeAlphaLair`** para que sea una arena dedicada con:
   - Dais central
   - 4 pilares rotos en esquinas
   - Puntos de spawn fijos
   - Enemigos pre-spawneados en generación
3. 🔲 **Soportar `window.__DEBUG_FORCE.alphaLair`** en `generateDungeon`
4. 🔲 **Simplificar `alphaLair.js`** — quitar `spawnAlphaPack`, mantener seal/victory/chest
5. 🔲 **Implementar Claro Solar:**
   - Flag `isSunbeamShrine` en la sala
   - Sunbeam gigante que cubre toda la sala
   - Bendición `maxhp` al entrar por primera vez
   - Revelar todo el minimapa
6. 🔲 **Implementar Campamento del Último Explorador:**
   - Hoguera apagada (campfire decorativo)
   - 1–3 notas interactuables con consejos del piso
   - Esqueleto + mochila (decoración)
   - Cofre normal gratuito
7. 🔲 **Implementar Invernadero Salvaje:**
   - VineWalls (props sólidos de enredadera)
   - VineShooters (plantas lanzadoras destructibles)
   - RootDoors (puertas bloqueadas que se abren al limpiar)
   - Cofre normal al completar
8. 🔲 **Añadir entradas de debug** para todas las salas nuevas
9. 🔲 **Testear en navegador** (servidor localhost:8080)

---

## 10. NOTAS TÉCNICAS

- El juego usa **ES Modules sin bundler** — debe servirse con HTTP (no file://).
- Servidor activo en `localhost:8080` con `Cache-Control: no-cache` para desarrollo.
- Todas las salas exclusivas deben:
  - Reutilizar sistemas existentes (sellado de puertas, E-interaction, sunbeams, campfires, hongos, pilares, cofres legendarios, proyectiles, sistema de enemigos).
  - NO introducir mecánicas de movimiento nuevas (escalada, natación, etc.).
  - Tener probabilidad del 55% sobre el grupo de salas disponibles (a menos que se especifique otra cosa).
- Las salas que no se generan en un seed concreto simplemente no aparecen esa runa — el piso sigue siendo jugable sin ellas.
