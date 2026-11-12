// Finds geometry that is standing in the air.
//
// The report was specific: on map 1, the last segment of a fence row has one
// end floating. That is a placement bug in the kit, and the kit's node names
// are mesh part names — there is no "fence" to search for. So this searches by
// geometry instead: anything whose bounding box starts well above the ground
// under it is standing in the air, whatever it is called.
//
// Two numbers per candidate, because they mean different things:
//   lift   how far the lowest corner of the box is above the terrain
//   skew   how much the box's own bottom is tilted — a segment with one end on
//          the ground and one in the air has a large lift *and* a large skew
//
// Usage: node tmp-float.mjs <map-id> [minLift]
import fs from 'node:fs';
import path from 'node:path';
import { launch, waitForGame } from './tools/cdp.mjs';

const mapId = process.argv[2] ?? 'campground-lake';
const minLift = Number(process.argv[3] ?? 0.45);
const outDir = path.join(process.env.TEMP || '/tmp', 'hunt-shots');
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9494 });
await waitForGame(cdp);

const report = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  const coll = h.collision;

  const out = [];
  const groups = new Map();

  const meshes = [];
  g.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    meshes.push(o);
  });

  for (const m of meshes) {
    const bb = m.geometry.boundingBox;
    // World-space box: transform the eight corners rather than scaling the box,
    // because a rotated prop's axis-aligned box is not its box scaled.
    let minY = Infinity, maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 8; i++) {
      const x = (i & 1) ? bb.max.x : bb.min.x;
      const y = (i & 2) ? bb.max.y : bb.min.y;
      const z = (i & 4) ? bb.max.z : bb.min.z;
      const v = m.localToWorld(m.position.clone().set(x, y, z));
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const ground = coll.getGroundHeight(cx, cz);
    if (!Number.isFinite(ground)) continue;

    const lift = minY - ground;
    if (lift < ${minLift}) continue;

    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const spanY = maxY - minY;

    // Skew: compare the terrain under the two ends of the long horizontal axis
    // against the box's own bottom. A rigid panel laid flat on a slope keeps
    // minY at its lowest corner, so lift alone cannot tell a slope from a
    // floating end; a panel with one end up in the air lifts the *whole* box.
    const longX = spanX >= spanZ;
    const ax = longX ? minX : cx;
    const az = longX ? cz : minZ;
    const bx = longX ? maxX : cx;
    const bz = longX ? cz : maxZ;
    const gA = coll.getGroundHeight(ax, az);
    const gB = coll.getGroundHeight(bx, bz);
    const skew = Number.isFinite(gA) && Number.isFinite(gB) ? Math.abs(gA - gB) : 0;

    const geoKey = m.geometry.uuid;
    const count = (groups.get(geoKey) ?? 0) + 1;
    groups.set(geoKey, count);

    out.push({
      name: m.name || '(unnamed)',
      geo: geoKey.slice(0, 8),
      pos: [+cx.toFixed(2), +minY.toFixed(2), +cz.toFixed(2)],
      lift: +lift.toFixed(2),
      skew: +skew.toFixed(2),
      span: [+spanX.toFixed(2), +spanY.toFixed(2), +spanZ.toFixed(2)],
    });
  }

  // How many copies share each geometry: a floating end is usually one of a
  // row of identical segments, and "1 of 14" is a much stronger signal than a
  // lone object that is simply a bird or a lamp.
  for (const o of out) o.copies = groups.get(o.geo) ?? 1;

  out.sort((a, b) => b.lift - a.lift);
  return { meshes: meshes.length, found: out.length, top: out.slice(0, 24) };
})()`);

console.log(JSON.stringify(report, null, 1));

// Photograph the worst three, from a standing position, so the report can be
// checked against what the player actually sees.
const shots = [];
for (let i = 0; i < Math.min(3, report.top.length); i++) {
  const target = report.top[i];
  await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const g = h.game;
    g.loop.stop();
    const cx = ${target.pos[0]}, cy = ${target.pos[1]}, cz = ${target.pos[2]};
    const px = cx + 4.5, pz = cz + 4.5;
    const ground = h.collision.getGroundHeight(px, pz);
    const spawn = h.collision.findSpawn({ x: px, y: ground + 0.5, z: pz }, 4) || { x: px, y: ground, z: pz };
    h.player.setPosition(spawn.x, spawn.y + 0.05, spawn.z);
    h.cameraController.targetYaw = Math.atan2(spawn.x - cx, spawn.z - cz);
    h.cameraController.snap(h.player.getPosition(), spawn.y);
    for (let f = 0; f < 40; f++) g.update(1 / 60);
    g.render();
    return true;
  })()`);
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `float-${mapId}-${i}.png`);
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  shots.push({ file, lift: target.lift, pos: target.pos, name: target.name });
}

console.log(JSON.stringify({ shots }, null, 1));
await cdp.close();
