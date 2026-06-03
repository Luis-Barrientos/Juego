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
}

export function showMenu()      { dom.menu.classList.remove('hidden'); }
export function showPause()     { dom.pause.classList.remove('hidden'); }
export function hidePause()     { dom.pause.classList.add('hidden'); }
export function showGameOver(stats) {
  document.getElementById('goFloor').textContent = stats.floor;
  document.getElementById('goKills').textContent = stats.kills;
  document.getElementById('goGold').textContent  = stats.gold;
  document.getElementById('goScore').textContent = stats.score;
  dom.gameOver.classList.remove('hidden');
}
export function showWinScreen(stats) {
  document.getElementById('winKills').textContent = stats.kills;
  document.getElementById('winGold').textContent  = stats.gold;
  document.getElementById('winScore').textContent = stats.score;
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
 * Show the 3-card upgrade picker.
 * @param {(id:string) => void} onPick
 */
export function showUpgradePicker(onPick) {
  dom.upgrade.classList.remove('hidden');
  const pool = UPGRADES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  dom.upgradeOpts.innerHTML = '';
  for (const u of pool) {
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `
      <div class="icon">${u.icon}</div>
      <div class="name">${u.name}</div>
      <div class="desc">${u.desc}</div>`;
    card.addEventListener('click', () => onPick(u.id));
    dom.upgradeOpts.appendChild(card);
  }
}

export function hideUpgradePicker() {
  dom.upgrade.classList.add('hidden');
}
