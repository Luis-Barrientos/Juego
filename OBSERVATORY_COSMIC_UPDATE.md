# Observatorio: Actualización Cósmica (v0.7.8)

## Resumen
Los obeliscos del Observatorio ahora proyectan una réplica precisa del cielo nocturno sobre toda la sala, reemplazando completamente el suelo de baldosas grises por un fondo cósmico profundo.

## Cambios Técnicos

### 1. Nueva Función: `drawObservatoryFloor(ctx)`
Ubicado en `js/render.js`, se ejecuta **inmediatamente después de `drawMap()`** (antes de entidades).

**Responsabilidades:**
- Pinta una base sólida en azul-índigo profundo (`#08061a`)
- Aplica un gradiente radial suave desde el centro (más luminoso) hacia los bordes (más oscuro)
- Añade dos nebulosas sutiles en modo aditivo:
  - **Nebulosa Rosa**: ubicada arriba-izquierda del centro (~22% horizontal, 18% vertical)
  - **Nebulosa Azul**: ubicada abajo-derecha del centro (~20% horizontal, 22% vertical)
- Clips de la zona al rectángulo de la sala para evitar sangrado

**Stack de composición:**
```
drawMap (baldosas + props cacheados)
    ↓
drawObservatoryFloor (cosmos denso opaco)
    ↓
[Re-pintado local de props del observatorio]
    ↓
drawLoot, drawEnemy, drawPlayer, etc.
    ↓
drawSunbeams, drawObservatoryStars
    ↓
drawLighting
```

### 2. Re-pintado de Props en `drawObservatoryFloor()`
Dentro de `drawObservatoryFloor`, después de pintar las nebulosas:
- Se itera sobre `state.libraryProps`
- Se filtran props que caen dentro de los límites del `state.observatoryRoom`
- Se re-pinta cada prop (anillo de constelaciones, telescopio, 4 obeliscos) trasladando el contexto

**Razón:** El map cache ya contiene estos props, pero al pintarse la capa cósmica sobre ellos, desaparecen. Redibujándolos aquí se garantiza que sean visibles.

### 3. Mejorado: `drawObservatoryStars(ctx)`
Cambios respecto a la versión anterior (v0.7.7):

| Aspecto | v0.7.7 | v0.7.8 |
|---------|--------|--------|
| Cantidad de estrellas | 36 | 72 |
| Paleta de colores | Solo blanco frío | 7 colores (blanco frío mayoría, amarillo cálido, rosa nebulosa, azul pálido) |
| Velocidad de titileo | Fija | Variada por estrella (`0.9 + rnd() * 1.6`) |
| Tamaño | Variado | Variado, correlacionado con el brillo |
| Efectos especiales | Halos simples | Halos + **destellos de difracción en cruz** en estrellas brillantes (~1 de cada 7) |

**Paleta detallada:**
```javascript
[220, 235, 255], // cool white (4× peso)
[255, 235, 215], // warm yellowish
[255, 200, 200], // pinkish
[180, 210, 255], // pale blue
```

## Lore & Diseño

**Concepto:** Los obeliscos azules de las esquinas no son meros decorativos. Funcionan como **proyectores cósmicos** que replican exactamente la bóveda celeste dentro de la cámara del Observatorio. De esta forma, los astrónomos de la Biblioteca podían estudiar las constelaciones sin salir de la sala sellada.

**Impacto Visual:**
- Elimina el bug visual de baldosas grises visible sobre el círculo de constelaciones
- Crea una atmósfera única y evocadora: una isla de cosmos en medio de mazmorras subterráneas
- Refuerza la idea de que el Observatorio es una **cámara sagrada** separada del resto

## Commits Relacionados
- `a50fbac` feat(observatory): obelisks project full cosmic night-sky backdrop

## Testing Checklist
- [ ] Las baldosas grises **no** son visibles dentro de la sala del Observatorio
- [ ] El anillo de constelaciones es claramente visible sobre el fondo cósmico
- [ ] El telescopio es claramente visible
- [ ] Los 4 obeliscos están posicionados correctamente
- [ ] Las estrellas titilan a velocidades variadas
- [ ] Las nebulosas son sutiles pero visibles (no abrumadoras)
- [ ] Los destellos de difracción están presentes en estrellas brillantes
- [ ] Sin glitches de clipping entre tiles fuera de la sala

---

**Fecha:** 2026-06-05  
**Versión:** 0.7.8  
**Creado por:** Implementación automática
