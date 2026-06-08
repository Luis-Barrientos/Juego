/**
 * changelog.js
 * --------------------------------------------------------------------------
 * Lista de versiones del juego, de más reciente a más antigua.
 *
 * La primera entrada (`CHANGELOG[0]`) es la versión actual: su número se
 * pinta en el menú principal y, si difiere de la última versión vista por
 * el jugador (guardada en `localStorage.dd_seen_version`), el modal de
 * novedades se abre automáticamente la primera vez que entra.
 *
 * Para añadir una nueva versión, inserta un nuevo objeto al principio del
 * array siguiendo el formato existente. Mantén `version` con SemVer
 * (mayor.menor.parche) y `date` en formato ISO (YYYY-MM-DD).
 */

export const CHANGELOG = [
  {
    version: '0.8.8',
    date: '2026-06-08',
    title: 'Runas: apunta con la magia',
    items: [
      'El puzzle de runas ya no se resuelve pulsando E sobre los pedestales. Ahora tienes que colocarte en el centro de la sala (sobre el círculo brillante del suelo) y disparar magia a las runas para encenderlas.',
      'Si te sales del centro, las runas se apagan y pierdes la selección que llevases. Vuelve al centro para reactivarlas.',
      'Al igual que antes, encender dos runas iguales las valida (se ponen verdes). Si fallas, parpadean en rojo y se reinician. Al validar las cuatro, la sala se libera y cae la llave.',
    ],
  },
  {
    version: '0.8.7',
    date: '2026-06-06',
    title: 'Sala de la Llave: puzzle de runas',
    items: [
      'Nueva variante de la Sala de la Llave: "Emparejar runas". Al sellarse la sala, cuatro pedestales con runas aparecen alrededor del dais central. Pulsa E sobre un pedestal para encenderlo; empareja los dos pedestales con la misma runa para validarlos (verde). Si fallas, ambos parpadean en rojo y se apagan. Validar los cuatro libera la sala y deja caer la llave.',
      'La variante se decide al azar al generar el piso (50% oleada, 50% runas). Para fines de debug se pueden forzar por separado desde el panel (ç).',
      'La luz mágica que flanquea el dais cambia de color según la variante: azul frío para la oleada, morado-azul para el puzzle de runas.',
    ],
  },
  {
    version: '0.8.6',
    date: '2026-06-06',
    title: 'Archivo Prohibido: esquinas estrictas',
    items: [
      'El Archivo Prohibido ahora SOLO se genera en la esquina superior-derecha o inferior-izquierda del piso. Si por geometría no cabe en ninguna de las dos, el par Sala de la Llave + Archivo no se genera ese piso.',
      'Arreglado: la puerta rúnica podía quedar inaccesible aunque el resto del piso siguiera transitable (un muro tapaba el pasillo justo delante de la puerta). Ahora se valida que se pueda caminar hasta la puerta desde la entrada del piso, y si no, el archivo se desbloquea automáticamente.',
    ],
  },
  {
    version: '0.8.5',
    date: '2026-06-06',
    title: 'Archivo Prohibido: cerrojo siempre alcanzable',
    items: [
      'Arreglado: la puerta rúnica del Archivo podía colocarse sobre una entrada cuyo otro lado era un bolsillo de pasillo aislado del resto del piso, dejando el cofre legendario inaccesible. Ahora se eligen solo entradas cuyo exterior conecta de verdad con la entrada del piso; si ninguna lo hace, el archivo se deja abierto.',
    ],
  },
  {
    version: '0.8.4',
    date: '2026-06-06',
    title: 'Debug: forzado de set-pieces fiable',
    items: [
      'Arreglado: el panel de debug podía dejarte en el inicio del piso en lugar de teletransportarte al Archivo Prohibido (u otra set-piece) si el seed actual no tenía espacio físico para colocarla. Ahora se reintenta hasta 30 veces con seeds distintos hasta encontrar uno que la genere.',
    ],
  },
  {
    version: '0.8.3',
    date: '2026-06-06',
    title: 'Las escaleras ya no caen dentro de set-pieces',
    items: [
      'Arreglado: la escalera al siguiente piso (y la posición de inicio) podían generarse dentro de la Sala de la Llave, el Archivo Prohibido, el Gran Tomo, el Observatorio o la Gran Biblioteca, pisando su contenido. Ahora la selección de sala de inicio y de escaleras ignora todas las salas temáticas.',
    ],
  },
  {
    version: '0.8.2',
    date: '2026-06-06',
    title: 'Archivo Prohibido: generación dirigida',
    items: [
      'El Archivo Prohibido ahora se genera preferentemente en la esquina superior-derecha o inferior-izquierda del piso, fuera del corredor crítico entre la entrada y la escalera. Esto evita que su puerta cerrada bloquee el avance.',
      'Si por las dimensiones del piso no cabe en ninguna esquina segura, se genera donde quepa y el validador de softlock sigue desbloqueando la puerta automáticamente cuando es necesario.',
    ],
  },
  {
    version: '0.8.1',
    date: '2026-06-06',
    title: 'Sala de la Llave: sin trampas mortales',
    items: [
      'Arreglado: el Archivo Prohibido podía cerrar el único camino entre la entrada y la escalera, dejando el piso intransitable. Ahora se valida después de generar el cerrojo y, si bloquea, la puerta se desactiva y las entradas alternativas se restauran (te llevas el cofre legendario gratis).',
      'Arreglado: si entrabas a la Sala de la Llave justo en la línea de la puerta, los muros podían materializarse encima de ti y dejarte atrapado. Ahora la sala espera a que estés un paso por dentro antes de sellarse.',
    ],
  },
  {
    version: '0.8.0',
    date: '2026-06-05',
    title: 'La Sala de la Llave y el Archivo Prohibido',
    items: [
      'La Biblioteca esconde ahora un par de salas vinculadas: una arena sellada con un dais rúnico azul y una bóveda cerrada con runa dorada.',
      'Al entrar en la Sala de la Llave, todas las salidas se sellan y aparece una oleada extra de enemigos. Al limpiarla, la sala se libera y deja caer una llave rúnica dorada en el centro.',
      'El Archivo Prohibido permanece bloqueado por una puerta con runa naranja: necesitas la llave para entrar. Dentro te espera un cofre legendario gratis (bendición permanente + pociones + oro).',
      'Las dos salas siempre aparecen juntas o no aparecen: si una no cabe en el piso, ninguna se genera. Las puertas alternativas al Archivo se tapian para que la única entrada sea la cerradura rúnica.',
      'Nueva entrada en el panel de debug (ç) para teletransportarte directamente a la Sala de la Llave o al Archivo.',
    ],
  },
  {
    version: '0.7.8',
    date: '2026-06-05',
    title: 'El cosmos del Observatorio',
    items: [
      'Los obeliscos no solo iluminan la sala: ahora proyectan el cielo nocturno real sobre todo el suelo del Observatorio.',
      'El suelo de la sala se reemplaza por un fondo cósmico de azul profundo con dos sutiles nebulosas (rosa y azul) en modo aditivo.',
      'La capa de estrellas titilantes pasa de 36 a 72 estrellas, con tamaños, velocidades y colores variados (blanco frío, amarillo cálido, rosa nebulosa, azul pálido) y destellos de difracción en las más brillantes.',
      'Las baldosas grises del suelo ya no se cuelan por encima del círculo de constelaciones: ahora toda la sala está cubierta por el cosmos y el círculo, telescopio y obeliscos se re-pintan limpiamente encima.',
    ],
  },
  {
    version: '0.7.7',
    date: '2026-06-05',
    title: 'Observatorio sin cúpula, obeliscos brillantes',
    items: [
      'Eliminada la cúpula del Observatorio: no encajaba con el estilo plano cenital del resto del juego.',
      'Toda la sala emite ahora una sutil luminiscencia azul-violeta con estrellas titilando dispersas por el suelo, estables pero únicas por sala.',
      'Los 4 obeliscos de las esquinas son los emisores visibles de la luz: ahora con una aura azul mucho más intensa y un núcleo de cristal mucho más brillante.',
      'El teletransporte del panel de debug ya no te deja atrapado dentro del telescopio: busca la celda andable más cercana al centro.',
    ],
  },
  {
    version: '0.7.6',
    date: '2026-06-05',
    title: 'La cúpula del Observatorio',
    items: [
      'El Observatorio ya no recibe luz por una grieta del techo: ahora tiene una cúpula mágica grabada con costillas de piedra concentricas y radios desde el centro.',
      'En el centro de la cúpula brilla un óculo arcano que pulsa lentamente, con cuatro runas estelares orbitando a su alrededor.',
      'El haz de luz que cae al suelo emana ahora limpiamente desde el óculo, sin bordes dentados.',
      'El círculo de constelaciones es totalmente opaco en el centro — nada del suelo se cuela por debajo — y se limpia mejor de objetos generados antes.',
    ],
  },
  {
    version: '0.7.5',
    date: '2026-06-05',
    title: 'Luz que cura en las Ruinas',
    items: [
      'Las grietas del techo en las Ruinas dejan pasar luz solar real: si te quedas plantado dentro de un rayo, tu vida se regenera lentamente.',
      'El efecto solo cubre exactamente la silueta visible del rayo — sal un paso fuera y el efecto se corta al instante.',
      'No afecta a los rayos finos de la luna en las Catacumbas ni a la columna estelar del Observatorio (que ya tiene su propio santuario).',
    ],
  },
  {
    version: '0.7.4',
    date: '2026-06-05',
    title: 'El Observatorio',
    items: [
      'La Biblioteca puede esconder ahora un Observatorio: una sala sellada de 9×9 con un gran telescopio de latón apuntando al cielo.',
      'Sobre el telescopio se abre una columna de luz estelar fría que ilumina un círculo de constelaciones pintado en el suelo.',
      'Cuatro obeliscos rematados en cristal azul marcan las esquinas y emiten un suave resplandor astral.',
      'Mientras permanezcas dentro de la sala, las estrellas regeneran tu vida y tu maná de forma constante — un santuario seguro entre los pasillos de la Biblioteca.',
    ],
  },
  {
    version: '0.7.3',
    date: '2026-06-05',
    title: 'Aire arcano en la Biblioteca',
    items: [
      'La Biblioteca cobra vida con páginas y hojas secas que caen lentamente desde el techo, girando mientras se desvanecen.',
      'Junto a cada llama mágica levita ahora una pequeña runa luminosa que orbita y pulsa con el fuego.',
      'Algunas llamas tienen un círculo rúnico pintado en el suelo a sus pies con uno de varios glifos diferentes.',
      'De vez en cuando se oye el crujido de las maderas viejas de las estanterías acomodándose en la oscuridad.',
    ],
  },
  {
    version: '0.7.2',
    date: '2026-06-05',
    title: 'El santuario del Gran Tomo',
    items: [
      'La Sala del Gran Tomo es ahora una sala simétrica más amplia, con el pedestal y el círculo rúnico perfectamente alineados en el centro.',
      'El pedestal crece a un monolito de tres bloques de altura con runa central y rivets en las esquinas; el tomo flota claramente por encima.',
      'Cuatro braseros de piedra con llama violeta marcan las esquinas y bañan la sala en luz arcana.',
      'Estanterías cubren todo el perímetro dejando un hueco simétrico hacia el pedestal, y libros abiertos descansan en cada esquina interior.',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-06-05',
    title: 'La Sala del Gran Tomo',
    items: [
      'Una nueva sala puede aparecer en la Biblioteca: un pedestal de piedra con un tomo gigante levitando lleno de runas.',
      'Acércate y pulsa E: el tomo te muestra una secuencia de flechas. Repítela con las teclas WASD o las flechas del teclado.',
      'Tienes tres intentos. Si la aciertas, lluvia de tres cofres morados. Si fallas todo, el tomo se enfurece y desata una oleada que tendrás que limpiar.',
      'La Gran Biblioteca es ahora realmente grande: pasillos de estanterías formando hileras alrededor del círculo del Guardián.',
      'El Guardián ya no se rinde tan fácil: más vida, más daño, y al bajar de la mitad de su HP se enfurece, lanza abanicos más anchos de runas y manda ondas expansivas a su alrededor.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-06-05',
    title: 'El Guardián de la Biblioteca',
    items: [
      'En el corazón de algunas Bibliotecas late ahora un círculo rúnico rodeado por cuatro piedras flotantes.',
      'Pisa el círculo y pulsa E para invocar al Guardián: un golem de piedra cubierto de runas que ataca de cerca y dispara ráfagas de tres runas a distancia.',
      'La sala se sella mientras dura el combate. Al vencerlo aparecen dos cofres morados gratis y un nuevo cofre legendario dorado.',
      'El cofre legendario garantiza una bendición permanente, dos pociones de vida, dos de maná y una buena montaña de oro.',
    ],
  },
  {
    version: '0.6.2',
    date: '2026-06-04',
    title: 'Los muros de la Biblioteca hablan',
    items: [
      'Estanterías empotradas con libros olvidados.',
      'Pergaminos colgados de varilla con texto manuscrito.',
      'Runas mágicas pintadas con halo violeta.',
      'Retratos oscuros enmarcados en oro con una mirada que incomoda.',
      'Tablones de corcho con notas pinchadas con chinchetas rojas.',
    ],
  },
  {
    version: '0.6.1',
    date: '2026-06-04',
    title: 'Mobiliario de la Biblioteca',
    items: [
      'Estanterías llenas de libros pegadas a las paredes de las salas (más cuanto más grande la sala).',
      'Mesas de lectura en el centro: algunas intactas con un libro abierto encima, otras partidas y desperdigadas.',
      'Todo ello bloquea el paso y obliga a moverse con más cuidado.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-06-04',
    title: 'Bienvenido a la Biblioteca',
    items: [
      'Nueva paleta cálida de marrón y madera con acentos arcanos para el piso 2.',
      'Iluminación mixta: velas cálidas en los muros conviven con fuegos mágicos flotantes en azul-violeta y rojo que derivan entre dos puntos.',
      'Por el suelo encontrarás libros caídos, pergaminos arrugados y hojas sueltas.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-06-04',
    title: 'Reordenando el descenso',
    items: [
      'Pisos reordenados: I Ruinas → II Biblioteca Maldita → III Catacumbas → IV Núcleo Profundo.',
      'La identidad de cada bioma (sarcófagos, almas, susurros, sesgo de esqueletos) viaja con la biblioteca/catacumbas, no con el número de piso.',
      'Próxima parada: rellenar la Biblioteca con su propia personalidad.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-06-04',
    title: 'Susurros de la cripta',
    items: [
      'Las catacumbas (piso 2) ahora tienen almas flotantes que ascienden lentamente desde sarcófagos agrietados, el altar y rincones de las salas.',
      'Susurros procedurales de fondo que aparecen cada 18–30 segundos solo en este piso, reforzando la atmósfera.',
      'Las almas no aparecen en el piso 1 ni en los siguientes biomas: son exclusivas de la cripta.',
    ],
  },
  {
    version: '0.3.1',
    date: '2026-06-04',
    title: 'Más vida en los muros',
    items: [
      'Nuevas decoraciones empotradas en muros visibles desde el interior de las salas.',
      'Ruinas (piso 1): placas grabadas, grietas con musgo y antorcheras rotas.',
      'Catacumbas (piso 2): lápidas pequeñas, marcas de garras y calaveras empotradas.',
      'Aplican la misma regla que el loculus: solo en muros que la cámara ve, nunca en muros traseros.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-06-04',
    title: 'Desafío de la Cripta',
    items: [
      'Nuevo enemigo: Sepulcral. Élite encapuchado de la cripta, lento pero muy resistente.',
      'El altar central de la crypta es ahora interactuable: pulsa E para iniciar el desafío.',
      'Al activarlo, las puertas se sellan y los sarcófagos agrietados se abren uno a uno escupiendo Sepulcrales.',
      'Mientras emergen son invulnerables: espera a que terminen de salir.',
      'Al limpiar la sala, dos baúles raros aparecen junto al altar como recompensa.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-06-04',
    title: 'Catacumbas (Piso 2)',
    items: [
      'Nuevo bioma: catacumbas con paleta fría, velas azuladas y telarañas.',
      'Nuevas estructuras: cráneos en pedestal, loculi en muros y cobwebs.',
      'Sarcófagos sólidos con tapa elevada y altar central en la crypta.',
      'Sarcófagos agrietados marcados con una cruz azul brillante.',
      'Esqueletos: ahora lanzan huesos con un telegrafiado de 0.7s antes de disparar.',
      'Piso 2 sesgado a esqueletos para reforzar la identidad del bioma.',
    ],
  },
  {
    version: '0.1.2',
    date: '2026-06-04',
    title: 'Pulido de mazmorra',
    items: [
      'Los baúles y enemigos ya no aparecen sobre muros, pilares ni escaleras.',
      'Sarcófagos colocados después del tallado de pasillos: vuelven a ser sólidos.',
      'Rediseño visual de sarcófagos y altar para mejor lectura.',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-06-04',
    title: 'Ruinas vivas',
    items: [
      'Pilares decorativos, charcos y props ambientales en piso 1.',
      'Generación de baúles emparejados en cámaras grandes.',
      'Mejor densidad de props según el estilo de mazmorra.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-05-28',
    title: 'Versión base',
    items: [
      'Mazmorra procedural con BSP + Kruskal.',
      'Espada, magia, baúles, escaleras y boss final.',
      'Bendiciones entre pisos y tienda.',
    ],
  },
];

/** Versión actualmente publicada (la del primer entry del changelog). */
export const CURRENT_VERSION = CHANGELOG[0].version;

const SEEN_KEY = 'dd_seen_version';

/** Lee la última versión que el jugador ya vio. `null` si nunca abrió el modal. */
function getSeenVersion() {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

/** Marca la versión actual como vista para no repetir el auto-popup. */
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, CURRENT_VERSION); } catch { /* ignore */ }
}

/* ─────────────────────────── DOM helpers ──────────────────────────── */

function buildModal() {
  let modal = document.getElementById('changelogModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'changelogModal';
  modal.className = 'overlay hidden changelog-overlay';
  modal.innerHTML = `
    <div class="changelog-box">
      <button class="changelog-close" id="changelogClose" aria-label="Cerrar">×</button>
      <h2>NOVEDADES</h2>
      <div class="changelog-current">v${CURRENT_VERSION}</div>
      <div class="changelog-list" id="changelogList"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const list = modal.querySelector('#changelogList');
  for (const entry of CHANGELOG) {
    const block = document.createElement('div');
    block.className = 'changelog-entry';
    block.innerHTML = `
      <div class="changelog-head">
        <span class="changelog-ver">v${entry.version}</span>
        <span class="changelog-date">${entry.date}</span>
      </div>
      <div class="changelog-title">${entry.title}</div>
      <ul>${entry.items.map(i => `<li>${i}</li>`).join('')}</ul>
    `;
    list.appendChild(block);
  }

  modal.querySelector('#changelogClose').addEventListener('click', hideChangelog);
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) hideChangelog();
  });
  return modal;
}

export function showChangelog() {
  const modal = buildModal();
  modal.classList.remove('hidden');
  markSeen();
}

export function hideChangelog() {
  const modal = document.getElementById('changelogModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Inicializa el botón "NOVEDADES" en el menú y, si la versión cambió desde
 * la última visita, abre el modal automáticamente.
 */
export function initChangelogUI() {
  buildModal();

  // Botón en el menú principal.
  const menu = document.getElementById('menu');
  if (menu && !document.getElementById('changelogBtn')) {
    const btn = document.createElement('button');
    btn.id = 'changelogBtn';
    btn.className = 'changelog-btn';
    btn.type = 'button';
    btn.textContent = `NOVEDADES · v${CURRENT_VERSION}`;
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      showChangelog();
    });
    // Insertarlo antes del botón COMENZAR para que quede a la vista.
    const start = document.getElementById('startBtn');
    if (start && start.parentNode === menu) menu.insertBefore(btn, start);
    else menu.appendChild(btn);
  }

  // Etiqueta de versión esquinera (siempre visible).
  if (!document.getElementById('versionTag')) {
    const tag = document.createElement('div');
    tag.id = 'versionTag';
    tag.textContent = `v${CURRENT_VERSION}`;
    tag.title = 'Ver novedades';
    tag.addEventListener('click', showChangelog);
    document.body.appendChild(tag);
  }

  // Auto-popup si esta versión aún no se ha visto.
  if (getSeenVersion() !== CURRENT_VERSION) {
    showChangelog();
  }
}
