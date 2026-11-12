// Where does the load time go? Reads the build stats the game already keeps.
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] || 'stadium';
const tLaunch = Date.now();
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9333 });
const tReady = Date.now();
await waitForGame(cdp);
const tGame = Date.now();
const loadS = (tGame - tLaunch) / 1000;

console.log(`  chrome start ${((tReady - tLaunch) / 1000).toFixed(1)}s, page+game ${((tGame - tReady) / 1000).toFixed(1)}s`);

const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource')
    .filter((r) => /glb|draco|wasm/.test(r.name))
    .map((r) => ({ name: r.name.split('/').pop(), start: Math.round(r.startTime), dur: Math.round(r.duration), size: r.transferSize }));
  const g = h.geometry;
  return {
    stats: g.stats,
    timings: h.game.worldLoader.timings,
    parts: g.parts.length,
    terrain: h.collision.getTerrainMeshes().length,
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
    resources: res,
  };
})()`);

console.log(`=== ${mapId}  wall ${loadS.toFixed(1)}s`);
console.log('  timings', JSON.stringify(out.timings));
console.log('  build stats', JSON.stringify(out.stats));
console.log('  parts', out.parts, 'terrain meshes', out.terrain);
console.log('  domContentLoaded', out.domContentLoaded, 'ms');
for (const r of out.resources) console.log(`   ${r.name.padEnd(28)} start ${String(r.start).padStart(6)} dur ${String(r.dur).padStart(6)} ${r.size} B`);
for (const l of cdp.consoleLines.filter((l) => /\[load\]|\[collision\]/.test(l))) console.log('  ', l);
await cdp.close();
