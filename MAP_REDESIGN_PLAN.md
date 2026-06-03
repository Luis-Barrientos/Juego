# Plan maestro: Rediseño del mapa en 5 fases

> Documento vivo. Cada fase es un commit independiente y verificable.
> Marcar `[x]` cuando una fase quede integrada en `main`.

---

## Decisiones recogidas

| Pregunta | Decisión |
|----------|----------|
| Tienda | Existen DOS: overlay al subir escalera (actual) + sala física aleatoria |
| Armería | Sala con 3 armas en pedestales. Cambiar arma o pagar oro para almacenar la actual y recuperarla en otra armería |
| Mutex tienda/armería | Estricto. Solo una de las dos por piso (o ninguna) |
| Tipos de sala a guardar | tesoro, arena, santuario, tienda, armería, élite, trampa, mini-boss |
| Pisos donde aparecen | 1: sin tienda/armería. 2-3: pueden aparecer. 4: solo boss, nada especial |
| Densidad por piso | 1 abierto · 2 medio · 3 laberíntico · 4 abierto (boss) |
| Sala-arena | Puerta cierra al entrar, cofre raro al inicio Y al final, oleada de enemigos |
| Implementación | Fase por fase, validando cada una en navegador antes de seguir |

---

## Fase 1 — Estructura base del mapa  `[ ]`

**Objetivo:** que el mapa se sienta menos vacío y permita rodear enemigos.

### Cambios en `js/dungeon.js`

1. **Salas que llenan su hoja BSP**
   - Cambiar `sirand(rng, minRoomW, maxRoomW)` por `Math.floor(leaf.w * rand(0.80, 0.95))` (similar para alto)
   - Mantener `min/maxRoomW` solo como límites de seguridad

2. **Conectividad MST + bucles**
   - Construir grafo: cada sala con vecinos por distancia (k-nearest, k=4)
   - Calcular MST (Prim o Kruskal) → garantiza conectividad sin cadena
   - Añadir 25-30% aristas extra del grafo completo → bucles y atajos

3. **Pasillos respetan salas**
   - Antes de carve, comprobar si segmento atraviesa otra sala
   - Si sí, redirigir o cortar como "puerta natural" (sin perforar)

4. **Ancho de pasillo por estilo**
   - Nuevo campo `corridorW` en STYLES
   - COMPACT/BALANCED 1, HALLWAYS 2, SPARSE 3

5. **Densidad por piso**
   - Cambiar rotación `[BALANCED, COMPACT, HALLWAYS, SPARSE]` a `[SPARSE, BALANCED, COMPACT, SPARSE]`
   - Encaja con la curva: abierto → medio → laberíntico → abierto (boss)

### Archivos
- `js/dungeon.js`

### Verificación
- [ ] Generar varias semillas y comprobar bucles
- [ ] Salas grandes que llenan el espacio
- [ ] Pasillos no parten salas
- [ ] Ancho de pasillo varía visiblemente entre pisos

### Commit sugerido
`feat(map): MST connectivity + room sizing + corridor styles`

---

## Fase 2 — Tipos de sala genéricos  `[ ]`

**Objetivo:** que cada sala tenga propósito y la exploración recompense.

### Cambios

1. **Metadata `room.type`** (en `dungeon.js`)
   - Valores: `'start' | 'stairs' | 'normal' | 'treasure' | 'shrine' | 'arena'`

2. **Asignación de tipos al final de generación**
   - `start`: rooms[0]
   - `stairs`: la más lejana (ya existe)
   - `arena`: la más grande (sustituye a stairs si coinciden — la arena lleva las escaleras)
   - `treasure`: 1 sala con sólo 1 conexión (sala "hoja" del MST), pequeña preferentemente
   - `shrine`: 1 sala mediana, no adyacente a la arena
   - `normal`: el resto

3. **Sala-tesoro** (`js/enemies.js` `populateFloor`)
   - 0 enemigos
   - 2 cofres garantizados (1 normal + 1 raro)

4. **Sala-santuario** — nuevo entity `shrine` en `js/loot.js`
   - Pedestal interactuable con E
   - Al activar: 1 blessing aleatoria gratuita (de UPGRADES)
   - One-shot (se desactiva visualmente tras usar)

5. **Sala-arena** — lógica nueva
   - Spawn al entrar (no pre-poblada): cofre raro al centro
   - Detectar entrada del jugador → cerrar puerta (overlay tile T_WALL en huecos del corredor de entrada)
   - Spawn oleada (4 + floor*2 enemigos)
   - Al matar al último → abrir puerta, spawn segundo cofre raro
   - Sin T_DOOR aún (eso es Fase 5); de momento usar T_WALL temporal y reabrir manualmente

6. **Decoración por tipo** (`js/render.js` y/o `dungeon.js`)
   - Tesoro: muchas decoraciones acumuladas
   - Santuario: sunbeam centrado garantizado en `ruins`; antorchas violetas en otros biomas
   - Arena: pocos decoradores (espacio limpio para combate); sunbeam si bioma `ruins`
   - Normal: como ahora

### Archivos
- `js/dungeon.js`
- `js/enemies.js`
- `js/loot.js`
- `js/render.js`
- `js/main.js`

### Verificación
- [ ] Cada piso (excepto boss) tiene 1 tesoro + 1 santuario + 1 arena + escaleras dentro de la arena
- [ ] Tesoro spawnea cofre raro garantizado
- [ ] Santuario aplica blessing al pulsar E
- [ ] Arena cierra puerta y spawneа oleada al entrar

### Commit sugerido
`feat(map): treasure/shrine/arena room types`

---

## Fase 3 — Tienda física + Armería + sistema de armas  `[ ]`

**Objetivo:** el contenido de la sala influye en el build del jugador.

### 3a. Mutex tienda/armería
En `dungeon.js`, en pisos 2-3:
- 40% sala-tienda física
- 40% sala-armería
- 20% ninguna

### 3b. Sala-tienda física
- Tipo `'shop'`. Sala mediana
- Pedestal interactuable (E) en centro
- Al activar abre el mismo overlay que el shop entre pisos pero sin upgrade picker (solo `SHOP_ITEMS`)
- Cierra al pulsar fuera o ESC

### 3c. Sistema de armas (NUEVO)
En `js/player.js`:
- `p.weapon = { type, dmg, range, cooldown, arc, sprite }`
- Tipos del catálogo:
  - `'sword'` — actual (dmg medio, range medio, cooldown medio, arc 0.7π)
  - `'spear'` — dmg alto, range +50%, cooldown +20%, arc estrecho 0.3π (estoque)
  - `'staff'` — dmg bajo cuerpo a cuerpo PERO el ataque dispara proyectil mágico gratis (sin coste MP), cooldown +30%
- `doSwordHit` se renombra a `doMeleeHit` y consulta `p.weapon` para parámetros
- Al iniciar partida → `p.weapon = sword` por defecto

### 3d. Sala-armería
- Tipo `'armory'`. Sala mediana, 1 pedestal en medio de la sala
- El pedestal muestra un arma aleatoria del catálogo (excluyendo el arma actual del jugador)
- Interactuar con pedestal (E) → modal pequeño:
  - "Cambiar mi `[arma actual]` por `[arma nueva]`" — gratis
  - "Almacenar mi `[arma actual]` por `100 oro`" — guarda en `state.storedWeapon`
- Si hay arma almacenada → cuando pases de piso tendras una nueva sección donde podras cambiar de arma libremente
- One-shot por pedestal

### 3e. HUD de arma
- Icono del arma actual en HUD junto a los buffs
- Si hay arma almacenada, badge pequeño "GUARDADA: ⚔"

### Archivos
- `js/dungeon.js`
- `js/player.js`
- `js/loot.js`
- `js/ui.js`
- `js/main.js`
- `js/state.js`
- `index.html`
- `style.css`

### Verificación
- [ ] En pisos 2-3, a veces aparece sala-tienda, a veces armería, a veces ninguna (nunca ambas)
- [ ] Tienda física abre overlay igual al de entre-pisos
- [ ] 3 armas distintas funcionan con sus mecánicas
- [ ] Almacenar/recuperar arma persiste entre pisos

### Commit sugerido
`feat(map): physical shop + armory + weapon system`

---

## Fase 4 — Tipos avanzados (élite, trampa, mini-boss)  `[ ]`

**Objetivo:** variedad de encuentros.

1. **Sala-élite** (10% prob en pisos 2-4)
   - 1 enemigo "élite" del pool del piso, x3 HP, x2 daño, sprite con halo
   - 0 enemigos normales
   - Cofre raro garantizado al matarlo

2. **Sala-trampa** (12% prob en pisos 2-3)
   - Cofre raro visible al entrar
   - Al recogerlo, puerta cierra y spawn de horda densa
   - Tras limpiar, puerta reabre. Sin recompensa adicional (la recompensa fue el cofre)

3. **Mini-boss** (15% prob en pisos 2-3, mutex con sala-arena del piso)
   - Sala dedicada, mini-jefe con AI única (variante del boss final, menor escala)
   - Cofre raro + bendición garantizada al matar

4. **Decoraciones temáticas** por tipo
   - Huesos en élite
   - Marcas de runas en trampa
   - Símbolo de boss en mini-boss

### Archivos
- `js/dungeon.js`
- `js/enemies.js`
- `js/loot.js`
- `js/render.js`

### Verificación
- [ ] Élite: 1 enemigo, mucho HP, recompensa garantizada
- [ ] Trampa: cofre activa horda
- [ ] Mini-boss aparece ocasionalmente y reemplaza la arena del piso

### Commit sugerido
`feat(map): elite/trap/miniboss rooms`

---

## Fase 5 — Polish  `[ ]`

1. **T_DOOR real**
   - Marcar uniones sala↔pasillo
   - Arenas/trampas usan puertas reales (cerradas/abiertas) en lugar del hack T_WALL
   - Renderizar puertas con sprite específico por bioma

2. **Salas en L**
   - 15% prob de fundir 2 hojas BSP adyacentes pequeñas en una sala en L

3. **Pilares internos**
   - Salas con `w*h > 80` reciben 2-4 muros sueltos en interior (cobertura táctica)

4. *(Opcional)* Salas secretas
   - Si llegamos hasta aquí

### Archivos
- `js/dungeon.js`
- `js/render.js`
- `js/config.js`

### Commit sugerido
`feat(map): doors, L-shaped rooms, pillars`

---

## Tabla de progreso

| Fase | Estado | Commit hash |
|------|--------|-------------|
| 1 | Pendiente | — |
| 2 | Pendiente | — |
| 3 | Pendiente | — |
| 4 | Pendiente | — |
| 5 | Pendiente | — |

---

## Decisiones / Asunciones

- **No aleatorio puro**: garantizamos siempre tesoro, santuario y arena por piso 2-4. Son 3 salas de las ~6-10 generadas, encaja sin problema.
- **Boss en piso 4**: NO recibe ninguno de los tipos especiales. Lógica boss intacta.
- **Sala-armería sin overlay UI nuevo**: el modal de cambio de arma es un mini-popup en el canvas o un overlay simple, no rediseño de UI.
- **Compatibilidad con saves**: `state.storedWeapon` y `p.weapon` son nuevos campos; runs anteriores sin estos campos default a `sword`.

---

## Cuestiones abiertas (decidir antes/durante)

1. **Frecuencia de cofres normales**: con tantos tipos especiales, ¿reducimos el 32% actual de las salas normales para no inflar el loot?  *Recomendado: bajar a 25%*
2. **AI de la lanza/báculo**: ¿la lanza es estoque (1 enemigo, alto dmg) o barrido lineal?  *Recomendado: estoque rápido, mecánica distinta a la espada en arco*
3. **Precio de almacenar arma en armería**: ¿100 oro fijo o escalar con piso?  *Recomendado: 100 fijo, simple*

---

## Inventario de elementos existentes a respetar

| Elemento | Estado actual | Cómo encaja en el plan |
|----------|---------------|------------------------|
| Cofres comunes | 32% prob por sala | Reducir a 25% en `normal`; `treasure` los garantiza |
| Cofres raros | 18% de los que spawnean | `treasure`, `arena`, `élite`, `mini-boss` los garantizan |
| Sunbeams (ruins) | 35% prob en salas grandes | Garantizado en `shrine` (ruins); decorativo en `arena` grande |
| Antorchas/sconces | Por sala | Color/densidad varía por tipo de sala en F2 |
| Decoraciones (musgo, libros…) | `decorChance` por bioma | Modificada por tipo de sala |
| Toast / banner intro | Sin cambios | — |
| Tienda overlay (entre pisos) | Funciona | Coexiste con sala-tienda física |
| Sistema de blessings (UPGRADES) | Funciona | Reusado por `shrine` |
| Sistema de SHOP_ITEMS | Funciona | Reusado por `shop` físico |
