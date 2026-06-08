import { TILE, MAP_H } from '../config.js';

export function buildBeamShape(sb, rng) {
  const steps = 14;
  const shape = [];
  const cx = (x) => x - sb.x;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = sb.y + t * sb.h;
    const spread = sb.splay * (t + 0.15 * Math.sin(t * Math.PI * 3 + sb.seed));
    const wobble = (rng() - 0.5) * sb.length * 0.04 * (0.5 + t * 1.5);
    const left  = cx(sb.x - spread * 0.5 + wobble);
    const right = cx(sb.x + spread * 0.5 + wobble);
    shape.push({ y, left, right });
  }
  return shape;
}

export function buildCrackPath(sb, rng) {
  const crackRng = () => { sb.seed = (sb.seed * 16807 + 0) % 2147483647; return (sb.seed & 0x7fffffff) / 2147483647; };
  const steps = 8;
  const path = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const jx = sb.wallRow >= 0 ? sb.x : sb.x;
    const jy = sb.wallRow >= 0 ? sb.wallRow * TILE : sb.y;
    const jitterX = (crackRng() - 0.5) * sb.length * 0.15;
    const jitterY = (crackRng() - 0.5) * TILE * 0.3;
    const depth = crackRng() * TILE * 0.4;
    path.push({ x: jx + jitterX, y: jy + jitterY, depth });
  }
  return path;
}
