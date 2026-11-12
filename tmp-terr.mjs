import { loadDraco, readGlb, decodeTerrain, makeSampler } from './tools/terrain.mjs';
const t0 = Date.now();
const mod = await loadDraco();
console.log('draco ready in', Date.now() - t0, 'ms');
const { gltf, bin } = readGlb('public/assets/environment/scene.glb');
const terrain = decodeTerrain(mod, gltf, bin);
console.log('terrain triangles', terrain.length);
const g = makeSampler(terrain);
for (const z of [3, 4, 5, 6, 7, 8, 9, 10, 10.9, 11.5, 12]) {
  const h = g(-14.4, z);
  console.log(`x=-14.4 z=${z}  ground ${h === null ? 'none' : h.toFixed(3)}`);
}
