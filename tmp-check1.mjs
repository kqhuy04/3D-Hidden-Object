import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9451 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const vols = h.collision.getClimbVolumes().map((v) => ({
    x: +((v.minX + v.maxX) / 2).toFixed(1),
    z: +((v.minZ + v.maxZ) / 2).toFixed(1),
    w: +(v.maxX - v.minX).toFixed(2),
    d: +(v.maxZ - v.minZ).toFixed(2),
    bottom: +v.bottom.toFixed(2),
    top: +v.top.toFixed(2),
  }));
  const bed = h.collision.terrainHeight(-26, 26);
  return {
    volumes: vols.slice(0, 8),
    volumeCount: vols.length,
    bedAtLake: bed === null ? null : +bed.toFixed(2),
    timings: h.game.worldLoader.timings,
  };
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
