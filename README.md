# Dungeon Depths

> Un roguelite de mazmorra top-down hecho en JavaScript puro. Sin dependencias, sin build step, sin frameworks.

[**▶ Jugar online**](https://luis-barrientos.github.io/Juego/)

![Dungeon Depths](https://img.shields.io/badge/HTML5-Canvas-orange) ![JS](https://img.shields.io/badge/JavaScript-Vanilla-yellow) ![License](https://img.shields.io/badge/license-MIT-blue)

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

- **Generación procedural** de mazmorras con algoritmo BSP (Binary Space Partition)
- **4 tipos de enemigos** con IA distinta — slime, esqueleto, mago, murciélago
- **Boss final** con dos fases y patrones de ataque diferenciados
- **Sistema de upgrades** — entre pisos eliges 1 de 3 bendiciones de un pool de 8
- **Iluminación dinámica** — luz radial del jugador, antorchas y aura del boss
- **Audio procedural** generado en tiempo real con Web Audio API (sin assets de audio)
- **Partículas, screen shake y texto flotante de daño**
- **Minimapa** en tiempo real con enemigos y escaleras

## Tecnología

- HTML5 Canvas
- JavaScript ES6+ (vanilla)
- Web Audio API
- CSS3

Tres archivos: [`index.html`](index.html), [`style.css`](style.css), [`game.js`](game.js).

## Cómo ejecutarlo localmente

```bash
git clone https://github.com/Luis-Barrientos/Juego.git
cd Juego
```

Y abre `index.html` en cualquier navegador moderno. No hay nada que instalar.

> Consejo: si lo abres con `file://` y el audio no suena, recarga después del primer click — algunos navegadores bloquean `AudioContext` hasta una interacción del usuario.

## Estructura del proyecto

```
.
├── index.html      # Estructura, HUD y overlays
├── style.css       # Tema gótico oscuro
├── game.js         # Lógica completa del juego (~1500 líneas)
├── LICENSE
└── README.md
```

`game.js` está organizado por secciones marcadas con cabeceras (`Constants`, `Audio`, `Input`, `Dungeon Generation`, `Player`, `Enemies`, `Projectiles`, `Particles`, `Loot`, `Render`, `UI`, `Game Loop`).

## Licencia

MIT — ver [LICENSE](LICENSE).
