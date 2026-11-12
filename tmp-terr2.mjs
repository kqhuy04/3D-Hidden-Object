import { loadDraco, readGlb, decodeTerrain } from './tools/terrain.mjs';
const mod = await loadDraco();
const { gltf, bin } = readGlb('public/assets/environment/scene.glb');
const terrain = decodeTerrain(mod, gltf, bin);
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const tri of terrain) for (const v of tri) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v[i]); mx[i] = Math.max(mx[i], v[i]); }
console.log('terrain bbox', mn.map(v => v.toFixed(1)), mx.map(v => v.toFixed(1)));
console.log('first tri', JSON.stringify(terrain[0].map(v => v.map(x => +x.toFixed(2)))));
// brute force: nearest triangle in XZ to the point of interest
const P = [-14.4, 4];
let best = 1e9, bestY = null;
for (const tri of terrain) {
  const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
  const cz = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
  const d = Math.hypot(cx - P[0], cz - P[1]);
  if (d < best) { best = d; bestY = (tri[0][1] + tri[1][1] + tri[2][1]) / 3; }
}
console.log('nearest triangle centre distance', best.toFixed(2), 'at y', bestY?.toFixed(2));
