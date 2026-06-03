/**
 * HUD updates, overlay management, toasts and the upgrade picker.
 */

import { state } from './state.js';

const dom = {
  hpBar:   document.getElementById('hpBar'),
  hpText:  document.getElementById('hpText'),
  mpBar:   document.getElementById('mpBar'),
  mpText:  document.getElementById('mpText'),
  floor:   document.getElementById('floorVal'),
  gold:    document.getElementById('goldVal'),
  score:   document.getElementById('scoreVal'),
  buffs:   document.getElementById('buffs'),
  toast:   document.getElementById('toast'),
  menu:        document.getElementById('menu'),
  pause:       document.getElementById('pauseMenu'),
  gameOver:    document.getElementById('gameOver'),
  win:         document.getElementById('winScreen'),
  upgrade:     document.getElementById('upgradePicker'),
  upgradeOpts: document.getElementById('upgradeOptions'),
  shopOpts:    document.getElementById('shopOptions'),
  shopGold:    document.getElementById('shopGold'),
  descendBtn:  document.getElementById('descendBtn'),
  floorIntro:     document.getElementById('floorIntro'),
  floorIntroNum:  document.getElementById('floorIntroNum'),
  floorIntroName: document.getElementById('floorIntroName'),
  floorIntroSub:  document.getElementById('floorIntroSub'),
};

/** Refresh HUD bars and counters from the player state. */
export function updateHUD() {
  const p = state.player;
  if (!p) return;
  dom.hpBar.style.width = `${(p.hp / p.maxHp) * 100}%`;
  dom.hpText.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
  dom.mpBar.style.width = `${(p.mp / p.maxMp) * 100}%`;
  dom.mpText.textContent = `${Math.ceil(p.mp)}/${p.maxMp}`;
  dom.floor.textContent = state.floor;
  dom.gold.textContent  = state.gold;
  dom.score.textContent = state.score;

  let html = '';
  if (p.upgrades.sword)   html += `<div class="buff">⚔ ×${p.upgrades.sword}</div>`;
  if (p.upgrades.magic)   html += `<div class="buff">✦ ×${p.upgrades.magic}</div>`;
  if (p.upgrades.speed)   html += `<div class="buff">⚡ ×${p.upgrades.speed}</div>`;
  if (p.upgrades.vampire) html += `<div class="buff">✤ ×${p.upgrades.vampire}</div>`;
  if (p.upgrades.regen)   html += `<div class="buff">✚ ×${p.upgrades.regen}</div>`;
  if (p.upgrades.crit)    html += `<div class="buff">✸ ×${p.upgrades.crit}</div>`;
  dom.buffs.innerHTML = html;
}

/** Show a transient message at the bottom of the screen. */
export function showToast(text) {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = text;
  dom.toast.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

export function hideAllOverlays() {
  dom.menu.classList.add('hidden');
  dom.pause.classList.add('hidden');
  dom.gameOver.classList.add('hidden');
  dom.win.classList.add('hidden');
  dom.upgrade.classList.add('hidden');
  document.body.classList.remove('overlay-active');
}

function markOverlayActive() {
  document.body.classList.add('overlay-active');
}

export function showMenu()      { markOverlayActive(); dom.menu.classList.remove('hidden'); }
export function showPause()     { markOverlayActive(); dom.pause.classList.remove('hidden'); }
export function hidePause()     {
  dom.pause.classList.add('hidden');
  document.body.classList.remove('overlay-active');
}
export function showGameOver(stats) {
  document.getElementById('goFloor').textContent = stats.floor;
  document.getElementById('goKills').textContent = stats.kills;
  document.getElementById('goGold').textContent  = stats.gold;
  document.getElementById('goScore').textContent = stats.score;
  markOverlayActive();
  dom.gameOver.classList.remove('hidden');
}
export function showWinScreen(stats) {
  document.getElementById('winKills').textContent = stats.kills;
  document.getElementById('winGold').textContent  = stats.gold;
  document.getElementById('winScore').textContent = stats.score;
  markOverlayActive();
  dom.win.classList.remove('hidden');
}

/** Available upgrades. Picked from at floor transitions. */
export const UPGRADES = [
  { id: 'sword',   icon: '⚔', name: 'FILO AGUDO',     desc: '+10 daño de espada y +4 alcance.' },
  { id: 'magic',   icon: '✦', name: 'PODER ARCANO',   desc: '+8 daño mágico y regen MP mejorado.' },
  { id: 'speed',   icon: '⚡', name: 'PIES LIGEROS',  desc: '+15% velocidad de movimiento.' },
  { id: 'vampire', icon: '✤', name: 'SED DE SANGRE',  desc: 'Robas vida con cada golpe de espada.' },
  { id: 'regen',   icon: '✚', name: 'REGENERACIÓN',  desc: 'Regeneras HP lentamente.' },
  { id: 'crit',    icon: '✸', name: 'GOLPE LETAL',    desc: '12% probabilidad de crítico x2.' },
  { id: 'maxhp',   icon: '♥', name: 'VITALIDAD',      desc: '+30 HP máximo y cura completa.' },
  { id: 'maxmp',   icon: '◆', name: 'INTELECTO',      desc: '+25 MP máximo y restaura MP.' },
];

/**
 * Items sold by the between-floors shop. Each item knows how to apply
 * itself to the player. Randomly sampled when the picker is shown.
 */
export const SHOP_ITEMS = [
  { id: 'hp_pot', icon: '♥',  name: 'POCIÓN HP',   desc: 'Restaura 50 HP.',           price: 25,
    apply: p => { p.hp = Math.min(p.maxHp, p.hp + 50); } },
  { id: 'mp_pot', icon: '◆',  name: 'POCIÓN MP',   desc: 'Restaura 40 MP.',           price: 20,
    apply: p => { p.mp = Math.min(p.maxMp, p.mp + 40); } },
  { id: 'full',   icon: '✤',  name: 'CURA TOTAL',  desc: 'Restaura HP y MP al máximo.', price: 60,
    apply: p => { p.hp = p.maxHp; p.mp = p.maxMp; } },
  { id: 'maxhp',  icon: '✚',  name: '+15 HP MÁX',  desc: 'Aumenta el HP máximo en 15.', price: 90,
    apply: p => { p.maxHp += 15; p.hp += 15; } },
  { id: 'maxmp',  icon: '✦',  name: '+12 MP MÁX',  desc: 'Aumenta el MP máximo en 12.', price: 70,
    apply: p => { p.maxMp += 12; p.mp += 12; } },
  { id: 'shield', icon: '◈',  name: 'GUARDIA',     desc: 'Reduce daño recibido en 10%.', price: 110,
    apply: p => { p.dmgReduce = (p.dmgReduce || 0) + 0.10; } },
];

/**
 * Show the upgrade picker plus the gold-driven shop. Picking an upgrade
 * card highlights it but does NOT close the screen — the player must press
 * the "DESCENDER" button to commit. This lets them shop first or change
 * their mind.
 *
 * @param {(id:string) => void} onConfirm Called with the chosen upgrade id
 *                                        when the player presses DESCENDER.
 */
export function showUpgradePicker(onConfirm) {
  markOverlayActive();
  dom.upgrade.classList.remove('hidden');

  let chosen = null;

  // ── Free upgrade cards (one is required to continue) ──────────────
  const pool = UPGRADES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  dom.upgradeOpts.innerHTML = '';
  const cards = [];
  for (const u of pool) {
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `
      <div class="icon">${u.icon}</div>
      <div class="name">${u.name}</div>
      <div class="desc">${u.desc}</div>`;
    card.addEventListener('click', () => {
      chosen = u.id;
      for (const c of cards) {
        c.classList.toggle('picked', c === card);
        c.classList.toggle('dimmed', c !== card);
      }
      dom.descendBtn.disabled = false;
    });
    dom.upgradeOpts.appendChild(card);
    cards.push(card);
  }

  dom.descendBtn.disabled = true;
  dom.descendBtn.onclick = () => {
    if (!chosen) return;
    onConfirm(chosen);
  };

  // ── Shop cards (optional, cost gold, can buy multiple) ────────────
  buildShop();
}

/**
 * Show the floor-intro banner, themed to the active biome's accent colour.
 * Auto-hides after `duration` ms and then calls `onDone`.
 *
 * @param {object} biome    Active biome (from biomes.js).
 * @param {number} floorNum 1-based floor number.
 * @param {() => void} onDone Callback when the banner finishes.
 * @param {number} [duration=2200] Visible time in ms.
 */
export function showFloorIntro(biome, floorNum, onDone, duration = 2200) {
  const el = dom.floorIntro;
  if (!el) { onDone && onDone(); return; }

  dom.floorIntroNum.textContent  = `${floorNum} · ${biome.subtitle}`;
  dom.floorIntroName.textContent = biome.name;
  dom.floorIntroSub.textContent  = biome.tagline || '';

  el.style.setProperty('--intro-accent', biome.accent || '#ffd060');
  el.style.setProperty('--intro-glow',
    biome.torchColor
      ? `rgba(${biome.torchColor[0]},${biome.torchColor[1]},${biome.torchColor[2]},0.55)`
      : 'rgba(255,200,80,0.55)');

  el.classList.remove('hidden');
  // Force reflow so the CSS transition runs reliably.
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;
  el.classList.add('show');

  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.classList.add('hidden');
      onDone && onDone();
    }, 500);
  }, duration);
}

/** (Re)render the shop section using the current player's gold. */
function buildShop() {
  const p = state.player;
  if (!dom.shopOpts) return;
  dom.shopGold.textContent = state.gold;
  const items = SHOP_ITEMS.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  dom.shopOpts.innerHTML = '';
  for (const it of items) {
    const affordable = state.gold >= it.price;
    const card = document.createElement('div');
    card.className = 'shop-card' + (affordable ? '' : ' disabled');
    card.innerHTML = `
      <div class="icon">${it.icon}</div>
      <div class="name">${it.name}</div>
      <div class="desc">${it.desc}</div>
      <div class="price">${it.price} oro</div>`;
    if (affordable) {
      card.addEventListener('click', () => {
        if (state.gold < it.price) return;
        state.gold -= it.price;
        it.apply(p);
        card.classList.add('sold');
        // Refresh disabled state on remaining cards.
        dom.shopGold.textContent = state.gold;
        for (const c of dom.shopOpts.children) {
          if (c === card || c.classList.contains('sold')) continue;
          const priceEl = c.querySelector('.price');
          const cost = parseInt(priceEl.textContent, 10);
          c.classList.toggle('disabled', state.gold < cost);
        }
      });
    }
    dom.shopOpts.appendChild(card);
  }
}

export function hideUpgradePicker() {
  dom.upgrade.classList.add('hidden');
  document.body.classList.remove('overlay-active');
}
