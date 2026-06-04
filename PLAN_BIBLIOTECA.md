# Plan — Piso II: Biblioteca Maldita

> Restos de una gran biblioteca arcana donde se estudiaba la magia.
> Caída en el olvido y en ruinas, conserva todavía ecos de esa magia.

---

## Identidad

- **Tono**: ruina polvorienta + magia residual viva.
- **Estructura**: salas medianas tipo "estudio" + alguna **GRAN sala** con pasillos de 2 de ancho forrados de estanterías y mesas por medio.
- **Iluminación mixta** (todo conviviendo):
  - Velas y farolillos cálidos (ámbar) sobre muros.
  - **Fuegos mágicos flotantes** azul-violeta y rojo, derivan irregularmente entre 2 puntos.
- **Paleta**: marrón cálido como base, acentos azul-violeta y rojo para magia.

---

## Props sólidos (bloquean paso)

- **Estanterías** alineadas en muros y formando pasillos internos.
- **Mesas de lectura** (intactas o tiradas).
- **Pedestales** con tomo abierto que brilla.
- **Atriles** sueltos.

## Decoración pisable

- Libros desperdigados, pergaminos arrugados, hojas de papel.
- Pasillos siempre con libros por el suelo.

## Decoraciones de muro (regla loculus — solo muros visibles)

- Estanterías empotradas (con/sin libros).
- Pergaminos / mapas colgados.
- Tablones con clavos y notas.
- Cuadros oscuros / retratos.
- Símbolos rúnicos pintados.

---

## Set-pieces (TODOS aleatorios, ninguno garantizado por run)

### 1. Gran Biblioteca + Guardián

- **Misma sala**: sala estrella expandida.
- Pasillos internos de 2 de ancho con estanterías a ambos lados, mesas y libros entre ellos.
- Al fondo, **círculo de invocación** con piedras rúnicas dispersas alrededor.
- E sobre el círculo → las piedras se juntan y forman al **Guardián de la Biblioteca** (golem grande de piedra rúnica, ~2× HP de un Sepulcral).
- Recompensa al matarlo: 2 cofres morados + 1 amarillo (legendario, definir al implementar)..

### 2. Sala del Gran Tomo (Simon Says)

- Pedestal central con tomo gigante levitando.
- E activa: muestra secuencia de **5–7 direcciones** (↑↓←→), 1.5s cada una.
- Repites con flechas/WASD, **3 intentos** de margen.
- **Éxito**: 2-3 cofres morados.
- **Falla total**: oleada y sala sellada hasta limpiarla.

### 3. Observatorio (standalone, sin llave)

- Tragaluz con fondo de estrellas/galaxias animadas.
- Aura pasiva mientras estás dentro: curación HP + regen MP acelerados.
- Sin evento, solo zona buff.

### 4. Archivo Prohibido (standalone, con puerta cerrada por llave)

- Sala con la puerta cerrada hasta tener la **llave**.
- Recompensa: 1–2 pickups de **habilidad garantizada** (pool a definir más tarde).

### 5. Sala de la Llave

- Random, en cualquier parte de la mazmorra.
- 1 de 3 puzzles elegido por seed:
  - **Emparejar runas** en pedestales.
  - **Encender velas en orden** indicado.
  - **Matar a todos los enemigos**.
- Debe generarse con suficiente espacio para el puzzle, sin otros enemigos ni props sólidos que lo bloqueen. Además de que si sale el Archivo Prohibido, la sala de la llave debe puede salir en el mismo piso (porque se necesita la llave para entrar al Archivo). Si seguenera el archivo se debe generar esta sala obligatoriamente en otro punto de la mazmorra.

---

## Capa ambiental

- **Hojas de papel** flotando: caen, se mueven o levitan, **siempre se desvanecen** con el tiempo.
- **Runas mágicas flotando**: levitan + parpadean.
- **Círculos mágicos pintados en el suelo**: pasivos, no hacen nada. Se colocan **junto a los fuegos mágicos flotantes** para sugerir que la magia los provoca.
- **Crujidos de madera** procedurales cada cierto tiempo.

---

## Plan de commits

### Commit 1 — Bioma + iluminación + decoraciones de suelo

- Biome `library` con paleta retocada (marrón + acentos azul-violeta + rojo).
- Iluminación mixta: velas/farolillos cálidos + fuegos mágicos flotantes (azul-violeta y rojo) que derivan irregularmente entre 2 puntos.
- Decoraciones pisables: libros desperdigados, pergaminos arrugados, hojas de papel.

### Commit 2 — Estanterías y mesas como props sólidos

- `placeShelves`: estanterías sólidas en muros y formando pasillos.
- `placeTables`: mesas tiradas/intactas sólidas (1–2 por sala mediana).
- Pasillos con libros decorativos pisables.

### Commit 3 — Decoraciones de muro (regla loculus)

- Estanterías empotradas, pergaminos colgados, runas pintadas, retratos oscuros, tablones con notas, símbolos rúnicos.
- Solo en muros visibles desde dentro de la sala.

### Commit 4 — Set-piece: Gran Biblioteca + Guardián

- Sala estrella expandida con pasillos internos de 2 de ancho.
- Círculo de invocación + piedras dispersas.
- Guardián de la Biblioteca (golem grande de piedra rúnica).
- Recompensa: 2–3 cofres raros.
- Generación aleatoria.

### Commit 5 — Set-piece: Sala del Gran Tomo (Simon Says)

- Pedestal central con tomo levitando.
- E activa: secuencia de 5–7 direcciones, 3 intentos.
- Éxito: 3 cofres morados. Fallo: oleada + sala sellada.
- Generación aleatoria.

### Commit 6 — Observatorio + Archivo Prohibido + Llave + capa ambiental

- Observatorio (random, standalone, zona buff).
- Archivo Prohibido (random, standalone, con llave, 1–2 habilidades garantizadas).
- Sala de la Llave (random, 1 de 3 puzzles).
- Capa ambiental: hojas, runas levitando, círculos mágicos junto a fuegos, crujidos de madera.

---

## Pendientes para más adelante

- Mobs de la biblioteca (los esqueletos no encajan, los slimes triángulo tampoco).
  - Posibles candidatos: cultistas, espectros de eruditos, libros poseídos, etc.
- Pool de habilidades nuevas exclusivas del Archivo / Observatorio.
- Habitaciones secretas.
- Cofre amarillo (categoría legendaria) — definir contenido/loot table al implementar commit 4 (Guardián).
