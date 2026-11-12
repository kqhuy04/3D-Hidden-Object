// What is actually under the spawn hint? Samples a small grid and reports the
// surface height and the clearance, so "the spawn dropped 3 m" can be traced to
// a specific cause rather than guessed at.
//
// Usage: node tmp-probe-spawn.mjs <map-id>
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'dia-de-muertos';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9405 });
await waitForGame(cdp);

const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const col = h.collision;
  const cap = col.getCapsule();
  const hint = h.game.map.spawn;
  // deepestContact writes through the caller's scratch object, including
  // point.set(...), so it needs a real Vector3 rather than a literal.
  const _out = {
    nx: 0, nz: 0, penetration: 0, partName: '',
    point: h.camera.position.clone(),
  };
  const rows = [];
  const probe = (x, z) => {
    const sup = col.supportHeight(x, z, hint.y, cap.stepHeight);
    const terr = col.getGroundHeight(x, z);
    const ground = sup !== null && sup > terr ? sup : terr;
    const feet = ground + 0.02;
    const hit = h.geometry.deepestContact(x, z, cap.radius + 1.2, feet, feet + cap.height, cap.stepHeight, _out);
    return {
      x: +x.toFixed(1), z: +z.toFixed(1),
      sup: sup === null ? null : +sup.toFixed(2),
      terr: +terr.toFixed(2),
      ground: +ground.toFixed(2),
      pen: hit ? +hit.penetration.toFixed(2) : null,
    };
  };
  for (let dz = -3; dz <= 3; dz += 1.5) {
    for (let dx = -3; dx <= 3; dx += 1.5) {
      rows.push(probe(hint.x + dx, hint.z + dz));
    }
  }
  return { hint, capsule: cap, rows };
})()`);

console.log(`${mapId} hint`, JSON.stringify(out.hint), 'capsule', JSON.stringify(out.capsule));
const grid = new Map();
for (const r of out.rows) grid.set(`${r.x},${r.z}`, r);
const xs = [...new Set(out.rows.map((r) => r.x))].sort((a, b) => a - b);
const zs = [...new Set(out.rows.map((r) => r.z))].sort((a, b) => a - b);
console.log('\n   ground height (hint at y=' + out.hint.y + ')');
console.log('        ' + xs.map((x) => String(x).padStart(7)).join(''));
for (const z of zs) {
  let line = `z ${String(z).padStart(5)} `;
  for (const x of xs) {
    const r = grid.get(`${x},${z}`);
    const blocked = r.pen !== null && r.pen > out.capsule.skinWidth ? '*' : ' ';
    line += String(r.ground.toFixed(2) + blocked).padStart(7);
  }
  console.log(line);
}
console.log('\n   * = capsule overlaps something when standing there');
