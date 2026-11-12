// Are the shoreline pebbles sitting on the sand, or hovering over it?
//
// For each `pebbles` node: take its world bounding box, then ask the *terrain*
// height (not the full collision soup — that would answer with the pebbles
// themselves) at a grid of points under it. A positive gap means the scatter
// floats; a negative one means it is buried.
//
// Usage: node tmp-pebcheck.mjs [map-id]
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'campground-lake';

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9393 });
await waitForGame(cdp);

const report = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const scene = h.game.scene ?? h.camera.parent;
  const groups = [];
  scene.traverse((o) => { if (/pebble/i.test(o.name)) groups.push(o); });

  const out = [];
  for (const g of groups) {
    g.updateWorldMatrix(true, true);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    g.traverse((o) => {
      const geo = o.geometry;
      if (!geo) return;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) return;
      const e = o.matrixWorld.elements;
      for (const cx of [bb.min.x, bb.max.x])
        for (const cy of [bb.min.y, bb.max.y])
          for (const cz of [bb.min.z, bb.max.z]) {
            const x = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
            const y = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
            const z = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
          }
    });
    if (!Number.isFinite(minY)) continue;

    let floats = 0, buried = 0, ok = 0, sum = 0, worst = 0, n = 0;
    const N = 9;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const px = minX + ((maxX - minX) * i) / (N - 1);
        const pz = minZ + ((maxZ - minZ) * j) / (N - 1);
        const th = h.collision.terrainHeight(px, pz);
        if (th === null || th === undefined) continue;
        const gap = minY - th;
        n++; sum += gap;
        if (gap > 0.03) { floats++; if (gap > worst) worst = gap; }
        else if (gap < -0.05) buried++;
        else ok++;
      }
    }
    out.push({
      name: g.name,
      minY: +minY.toFixed(2),
      maxY: +maxY.toFixed(2),
      footprint: [+minX.toFixed(1), +minZ.toFixed(1), +maxX.toFixed(1), +maxZ.toFixed(1)],
      samples: n, floats, ok, buried,
      meanGap: n ? +(sum / n).toFixed(2) : null,
      worstGap: +worst.toFixed(2),
    });
  }
  return { waterLevel: h.collision.waterLevel, groups: out };
})()`);

console.log(`water level ${report.waterLevel}`);
for (const g of report.groups) console.log(JSON.stringify(g));
await cdp.close();
