// Find every thin, ground-hugging mesh in a map that is NOT sitting on the
// terrain. Works on shape, not on name: any mesh whose world bounding box is
// under 40 cm tall and at least 40 cm across is a decal of some kind (pebbles,
// gravel, leaf litter, a painted patch), and a decal that floats is a bug
// whatever it is called.
//
// Usage: node tmp-flatcheck.mjs [map-id] [name-filter]
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'campground-lake';
const filter = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9395 });
await waitForGame(cdp);

const report = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const scene = h.game.scene;
  const out = [];
  const seen = new Set();

  scene.traverse((o) => {
    const mesh = o;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (seen.has(mesh.geometry)) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    seen.add(mesh.geometry);

    mesh.updateWorldMatrix(true, false);
    const e = mesh.matrixWorld.elements;
    const v = new (h.camera.position.constructor)();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    }
    const height = maxY - minY;
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    if (height > 0.4 || Math.max(spanX, spanZ) < 0.4) return;
    if (pos.count > 20000) return; // terrain sheets are not decals
    const label = mesh.name || o.parent?.name || '';
    if (${filter ? `!/${filter.source}/i.test(label) && !/${filter.source}/i.test(o.parent?.name ?? '')` : 'false'}) return;

    // Per-vertex gap to the terrain. A decal is "floating" when a vertex sits
    // above the ground under it and nothing of the decal reaches the ground.
    let worst = 0, floaters = 0, samples = 0;
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const th = h.collision.terrainHeight(v.x, v.z);
      if (th === null) continue;
      const gap = v.y - th;
      samples++;
      if (gap > 0.03) floaters++;
      if (gap > worst) worst = gap;
    }
    if (samples < 4) return;
    out.push({
      name: mesh.name || o.parent?.name || '(unnamed)',
      parent: o.parent?.name ?? '',
      verts: pos.count,
      height: +height.toFixed(2),
      span: [+spanX.toFixed(1), +spanZ.toFixed(1)],
      y: [+minY.toFixed(2), +maxY.toFixed(2)],
      at: [+((minX + maxX) / 2).toFixed(1), +((minZ + maxZ) / 2).toFixed(1)],
      floaters,
      samples,
      worst: +worst.toFixed(2),
    });
  });

  out.sort((a, b) => b.worst - a.worst);
  return out;
})()`);

console.log(`${mapId}: ${report.length} flat meshes`);
for (const r of report.slice(0, 40)) {
  console.log(
    `${r.name.padEnd(22)} verts=${String(r.verts).padStart(6)} h=${r.height} at ${r.at.join(',')} ` +
      `float=${r.floaters}/${r.samples} worst=${r.worst}`
  );
}
await cdp.close();
