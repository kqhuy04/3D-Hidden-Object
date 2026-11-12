// One-off probe: water vs lake bed, the watchtower's rungs, and people props.
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'campground-lake';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9421 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 500));

const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const scene = h.game.scene;
  const res = {};

  // --- water and ground ------------------------------------------------
  const water = scene.getObjectByName('water');
  if (water) {
    const b = new (window.__THREE_BOX3__ || Object)();
  }
  const box = (obj) => {
    let minY = Infinity, maxY = -Infinity;
    obj.updateMatrixWorld(true);
    obj.traverse((n) => {
      const m = n;
      if (!m.isMesh || !m.geometry) return;
      const pos = m.geometry.getAttribute('position');
      const v = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < pos.count; i += 7) {
        const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
        const e = m.matrixWorld.elements;
        const wy = e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13];
        if (wy < minY) minY = wy;
        if (wy > maxY) maxY = wy;
      }
    });
    return { minY: +minY.toFixed(2), maxY: +maxY.toFixed(2) };
  };
  res.water = water ? box(water) : null;
  res.ground = scene.getObjectByName('ground') ? box(scene.getObjectByName('ground')) : null;

  // Ground heights across the lake, straight out from spawn along +x.
  const samples = [];
  for (let x = 0; x <= 40; x += 5) {
    samples.push({
      x,
      z: 10,
      ground: +h.collision.getGroundHeight(x, 10).toFixed(2),
      terrain: h.collision.terrainHeight(x, 10) === null ? null : +h.collision.terrainHeight(x, 10).toFixed(2),
    });
  }
  res.samples = samples;

  // --- watchtower rungs ------------------------------------------------
  const tower = scene.getObjectByName('tower');
  if (tower) {
    tower.updateMatrixWorld(true);
    const e = tower.matrixWorld.elements;
    const rungs = [];
    tower.traverse((n) => {
      if (!n.isMesh || !n.geometry) return;
      const g = n.geometry;
      const pos = g.getAttribute('position');
      const idx = g.index;
      const count = idx ? idx.count : pos.count;
      const get = (i) => {
        const k = idx ? idx.getX(i) : i;
        return { x: pos.getX(k), y: pos.getY(k), z: pos.getZ(k) };
      };
      for (let i = 0; i + 2 < count; i += 3) {
        const a = get(i), b = get(i + 1), c = get(i + 2);
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        if (Math.abs(ny / len) < 0.85) continue;
        const wy = e[1] * a.x + e[5] * a.y + e[9] * a.z + e[13];
        const wx = e[0] * a.x + e[4] * a.y + e[8] * a.z + e[12];
        const wz = e[2] * a.x + e[6] * a.y + e[10] * a.z + e[14];
        rungs.push([+wx.toFixed(2), +wy.toFixed(2), +wz.toFixed(2)]);
      }
    });
    res.tower = { rungFaces: rungs.length, sample: rungs.slice(0, 60) };
  }

  // --- people: skinned props with arm bones ----------------------------
  const people = [];
  scene.traverse((n) => {
    if (!n.isSkinnedMesh || !n.skeleton) return;
    const bones = n.skeleton.bones.map((b) => b.name).filter((s) => /arm|shoulder|clavicle/i.test(s));
    if (bones.length === 0) return;
    people.push({ node: n.name, parent: n.parent ? n.parent.name : '', bones: bones.slice(0, 6) });
  });
  res.people = people.slice(0, 20);
  res.peopleCount = people.length;
  return res;
})()`);

console.log(JSON.stringify(out, null, 2).slice(0, 6000));
await cdp.close();
