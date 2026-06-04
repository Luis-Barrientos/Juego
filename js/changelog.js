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
