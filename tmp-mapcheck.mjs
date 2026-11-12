// Map smoke test: does the map load, does collision build, does the body stand
// on the floor and walk without falling out of the world?
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] || 'hospital';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9333 });
const t0 = Date.now();
await waitForGame(cdp);
const loadS = (Date.now() - t0) / 1000;

const info = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.geometry;
  let meshes = 0, tris = 0;
  h.game.scene.traverse((o) => { if (o.isMesh) { meshes++; const p = o.geometry.attributes.position; const i = o.geometry.index; tris += i ? i.count / 3 : (p ? p.count / 3 : 0); } });
  return {
    map: h.game.map?.id ?? '(unknown)',
    parts: g.parts.length,
    collisionTris: g.parts.reduce((s, p) => s + p.triangles, 0),
    meshes,
    tris: Math.round(tris),
    hasTerrain: !!h.collision.heightField,
    spawn: h.game.map?.spawn ?? null,
    body: (() => { const c = h.player.getController(); return { x: +c.getPosition().x.toFixed(2), y: +c.feetY.toFixed(2), z: +c.getPosition().z.toFixed(2) }; })(),
  };
})()`);

console.log(`\n=== ${mapId} ===`);
console.log(`  loaded in ${loadS.toFixed(1)}s`);
console.log(`  map id "${info.map}"  parts ${info.parts}  collision tris ${info.collisionTris.toLocaleString()}`);
console.log(`  scene: ${info.meshes} meshes / ${info.tris.toLocaleString()} tris  terrain ${info.hasTerrain}`);
console.log(`  spawn ${JSON.stringify(info.spawn)}  body ${JSON.stringify(info.body)}`);

// Settle, then walk in four directions from the spawn and see whether the body
// stays on solid ground.
const walk = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const c = h.player.getController();
  h.game.loop.stop();
  const mk = (x, y) => ({ x, y, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  const ZERO = mk(0, 0);
  const settle = () => { c.falling = true; c.fallSpeed = 0; let p = c.feetY, s = 0;
    for (let f = 0; f < 500; f++) { c.update(ZERO, 0, 1/60); if (Math.abs(c.feetY - p) < 1e-6 && !c.falling) s++; else s = 0; p = c.feetY; if (s >= 3) break; } };
  const spawn = h.game.map.spawn;
  // Walk from where the game actually put the body, not from the registry
  // hint: findSpawn may have moved it to reachable ground.
  const home = { x: c.getPosition().x, y: c.feetY, z: c.getPosition().z };
  const out = [];
  for (const [label, wx, wz] of [['+x', 1, 0], ['-x', -1, 0], ['+z', 0, 1], ['-z', 0, -1]]) {
    h.player.setPosition(home.x, home.y + 0.4, home.z);
    settle();
    const start = { x: +c.getPosition().x.toFixed(2), y: +c.feetY.toFixed(2), z: +c.getPosition().z.toFixed(2) };
    let blocked = 0, minY = Infinity;
    for (let f = 0; f < 120; f++) {
      const b = { x: c.getPosition().x, z: c.getPosition().z };
      c.update(mk(wx, -wz), 0, 1 / 60);
      const d = Math.hypot(c.getPosition().x - b.x, c.getPosition().z - b.z);
      if (d < 0.002) blocked++;
      if (c.feetY < minY) minY = c.feetY;
    }
    out.push({ label, start, end: { x: +c.getPosition().x.toFixed(2), y: +c.feetY.toFixed(2), z: +c.getPosition().z.toFixed(2) }, blocked, minY: +minY.toFixed(2) });
  }
  return out;
})()`);

const hint = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const s = h.game.map.spawn;
  const spot = h.collision.findSpawn({ x: s.x, y: s.y, z: s.z });
  return spot ? { x: +spot.x.toFixed(2), y: +spot.y.toFixed(2), z: +spot.z.toFixed(2),
    drift: +Math.hypot(spot.x - s.x, spot.z - s.z).toFixed(2) } : null;
})()`);
console.log(`  findSpawn(hint) -> ${JSON.stringify(hint)}`);

for (const w of walk) {
  const fell = w.minY < w.start.y - 1.5;
  console.log(
    `  walk ${w.label.padEnd(3)} from (${w.start.x}, ${w.start.y}, ${w.start.z})` +
    ` -> (${w.end.x}, ${w.end.y}, ${w.end.z})  blocked ${String(w.blocked).padStart(3)}/120` +
    `  lowest y ${w.minY}${fell ? '  FELL' : ''}`
  );
}

console.log('  console errors:', cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 3));
await cdp.close();
