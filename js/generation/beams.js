import { TILE } from '../config.js';

export function buildCrackPath(sb, rng) {
  const halfLen = sb.length * 0.5;
  const baseY   = sb.wallRow * TILE + TILE * 0.55;
  const n       = Math.max(8, Math.floor(sb.length / 8));
  const pts     = [];
  let y = baseY;
  for (let i = 0; i < n; i++) {
    const t  = i / (n - 1);
    const x  = sb.x - halfLen + t * sb.length;
    y += (rng() - 0.5) * 4;
    const minY = sb.wallRow * TILE + 3;
    const maxY = sb.wallRow * TILE + TILE - 3;
    if (y < minY) y = minY;
    if (y > maxY) y = maxY;
    pts.push([x, y]);
  }
  return pts;
}

export function buildBeamShape(sb, rng) {
  const halfTop    = sb.length * 0.5;
  const halfBottom = halfTop + sb.splay;
  const h          = sb.h;
  const pts        = [];

  const nTop = Math.max(6, Math.floor(sb.length / 12));
  for (let i = 0; i < nTop; i++) {
    const t = i / (nTop - 1);
    const x = -halfTop + t * (halfTop * 2);
    const y = (rng() - 0.3) * 5;
    pts.push([x + (rng() - 0.5) * 3, y]);
  }

  const rightKinks = 1 + Math.floor(rng() * 2);
  for (let i = 1; i <= rightKinks; i++) {
    const t = i / (rightKinks + 1);
    const x = halfTop + t * sb.splay + (rng() - 0.5) * 4;
    const y = t * h;
    pts.push([x, y]);
  }
  pts.push([halfBottom + (rng() - 0.5) * 4, h]);

  const nBot = Math.max(3, Math.floor(sb.length / 16));
  for (let i = 0; i < nBot; i++) {
    const t = (i + 1) / (nBot + 1);
    const x = halfBottom - t * (halfBottom * 2);
    pts.push([x + (rng() - 0.5) * 4, h + (rng() - 0.5) * 3]);
  }
  pts.push([-halfBottom + (rng() - 0.5) * 4, h]);

  const leftKinks = 1 + Math.floor(rng() * 2);
  for (let i = leftKinks; i >= 1; i--) {
    const t = i / (leftKinks + 1);
    const x = -halfTop - t * sb.splay + (rng() - 0.5) * 4;
    const y = t * h;
    pts.push([x, y]);
  }
  return pts;
}
