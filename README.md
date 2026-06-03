# Dungeon Depths

> Un roguelite de mazmorra top-down hecho en **JavaScript moderno** (ES Modules), sin dependencias, sin bundler, sin frameworks.

[**▶ Jugar online**](https://luis-barrientos.github.io/Juego/)

![HTML5](https://img.shields.io/badge/HTML5-Canvas-orange) ![JS](https://img.shields.io/badge/JavaScript-ES2022-yellow) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## Descripción

Desciende a través de **4 pisos** de una mazmorra generada proceduralmente, lucha contra distintos tipos de enemigos, recoge oro y pociones, elige bendiciones entre pisos y derrota al **Señor de las Profundidades** en el piso final.

## Controles

| Acción | Teclas |
|---|---|
| Mover | `WASD` / Flechas |
| Espadazo | Click izquierdo / `Z` |
| Magia | Click derecho / `X` |
| Interactuar (baúles, escaleras) | `E` |
| Pausa | `ESC` |

La dirección de los ataques sigue al ratón.

## Características

- **Generación procedural** con Binary Space Partition (BSP) y **estilos rotativos** por piso (compacto, escaso, pasillos, equilibrado), todo determinista por seed
- **4 tipos de enemigos** con IA distinta — slime, esqueleto, mago, murciélago
- **Boss final** con dos fases y patrones de ataque diferenciados
- **Sistema de upgrades** — entre pisos eliges 1 de 3 bendiciones de un pool de 8
- **Iluminación dinámica** — luz radial del jugador, antorchas, escaleras siempre visibles, aura del boss
- **Audio procedural** generado en tiempo real con Web Audio API (sin assets de audio)
- **Pre-render del mapa** a canvas offscreen para máximo rendimiento
- **Partículas, screen shake y texto flotante de daño**
- **Minimapa** en tiempo real con enemigos y escaleras

## Tecnología

- HTML5 Canvas + Web Audio API
- JavaScript ES2022 (módulos nativos)
- CSS3

## Estructura del proyecto

```
.
├── index.html
├── style.css
├── js/
│   ├── main.js          # Entry point y game loop
│   ├── config.js        # Constantes y stats base
│   ├── state.js         # Estado compartido
│   ├── utils.js         # Helpers + PRNG (Mulberry32)
│   ├── audio.js         # Audio procedural
│   ├── input.js         # Teclado y ratón
│   ├── storage.js       # Wrapper localStorage
│   ├── dungeon.js       # BSP + colisión + estilos
│   ├── player.js        # Jugador
│   ├── enemies.js       # Enemigos + boss
│   ├── projectiles.js   # Proyectiles
│   ├── particles.js     # Partículas + damage text
│   ├── loot.js          # Oro, pociones, baúles
│   ├── render.js        # Mapa, iluminación, minimapa
│   └── ui.js            # HUD y overlays
├── LICENSE
└── README.md
```

## Cómo ejecutarlo localmente

Como el proyecto usa **ES Modules**, los navegadores requieren servirlo por HTTP (no `file://`). Cualquiera de estas opciones sirve:

```bash
# Python
python -m http.server 8000

# Node (npx, sin instalar nada extra)
npx serve

# VS Code: extensión "Live Server"
```

Luego abre `http://localhost:8000` en el navegador.

> Si abres `index.html` directamente con `file://` los módulos fallarán por CORS. En GitHub Pages funciona sin más, ya que sirve por HTTPS.

## Licencia

MIT — ver [LICENSE](LICENSE).
