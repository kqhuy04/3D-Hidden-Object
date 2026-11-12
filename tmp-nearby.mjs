// What is near this point? Lists prop names and boxes within a radius, so an
// object that was meant to sit on something can be put back on the something
// rather than guessed at.
//
// Usage: node tmp-nearby.mjs <map-id> <x> <z> [radius]
import { launch, waitForGame } from './tmp-cdp.mjs';

const [mapId, xArg, zArg, rArg] = process.argv.slice(2);
const x = Number(xArg), z = Number(zArg), R = Number(rArg) || 3;
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9425 });
await waitForGame(cdp);

console.log(await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const out = [];
  const v = h.camera.position.clone();
  h.game.scene.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const g = node.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    if (!b) return;
    // World box, via the object's own matrix.
    node.updateWorldMatrix(true, false);
    const m = node.matrixWorld.elements;
    const ys = [];
    for (const cx of [b.min.x, b.max.x]) for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z]) {
      ys.push(m[1] * cx + m[5] * cy + m[9] * cz + m[13]);
    }
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const wx = m[12], wz = m[14];
    const d = Math.hypot(wx - ${x}, wz - ${z});
    if (d > ${R}) return;
    out.push({ name: node.name || '(unnamed)', d: +d.toFixed(1), minY: +minY.toFixed(2), maxY: +maxY.toFixed(2) });
  });
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, 18).map((o) => '  ' + o.name.padEnd(34) + ' d=' + o.d + 'm  y ' + o.minY + '..' + o.maxY).join('\\n');
})()`));

await cdp.close();
