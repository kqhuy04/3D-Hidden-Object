// Does the rod go through the character?
//
//   node tools/rod-clearance.mjs [map] [port]
//
// Samples every vertex of the rod mesh against the character's bone segments,
// pose by pose, and prints the four closest bones for each. A screenshot from
// one angle cannot answer this — the rod is behind the shoulder at the top of
// the wind-up and the character's hat hides the answer — so the distance is
// measured instead of eyeballed.
//
// Under 0.10 m from a bone segment is a clip: the torso is about 0.20 m wide
// and a forearm is about 0.10. The two the rod is *allowed* to touch are the
// hands, which are excluded here because the rod is gripped by them.
//
// This is the harness that set `GRIP.x` and the `ROD_AIM` curve. Re-run it after
// moving either.
import { launch, waitForGame } from './cdp.mjs';

const map = process.argv[2] ?? 'campground-lake';
const port = Number(process.argv[3] ?? 9692);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port });
await waitForGame(cdp);
await new Promise((r) => setTimeout(r, 1500));

const out = await cdp.evaluate(`(async () => {
  const g = window.__hunt.game;
  g.startNewRound();
  await new Promise((r) => setTimeout(r, 400));
  g.cutscene.skip(window.__hunt.camera);
  g.endCutscene();
  await new Promise((r) => setTimeout(r, 400));
  const water = window.__hunt.worldLoader.getWater();
  const body = window.__hunt.player.getPosition();
  const lake = water.nearestOpenWater(body.x, body.z, 160, 0.6);
  let best = null;
  for (let i = 0; i < 40; i++) {
    const k = i / 40;
    const x = lake.x + (body.x - lake.x) * k;
    const z = lake.z + (body.z - lake.z) * k;
    if (water.depthAt(x, z) > 0.25) continue;
    const spot = g.collision.findSpawn({ x, y: lake.y + 1.5, z });
    if (!spot) continue;
    const ground = g.collision.groundAt(spot.x, spot.z, spot.y);
    if (ground < lake.y - 0.4) continue;
    best = { x: spot.x, y: ground + 0.05, z: spot.z };
    break;
  }
  window.__hunt.player.setPosition(best.x, best.y, best.z);
  const yaw = Math.atan2(best.x - lake.x, best.z - lake.z);
  window.__hunt.cameraController.targetYaw = yaw;
  window.__hunt.cameraController.currentYaw = yaw;
  await new Promise((r) => setTimeout(r, 500));
  g.fishing.interact();
  await new Promise((r) => setTimeout(r, 1200));

  const V = window.__hunt.camera.position.constructor;
  const animator = g.player.getAnimator();
  const holder = g.scene.getObjectByName('fishing-rod-holder');
  const rodMesh = holder.getObjectByName('rod-mesh');

  // The rod's vertices, once, in world space (recomputed per pose).
  const pos = rodMesh.geometry.getAttribute('position');
  const idx = rodMesh.geometry.getIndex();
  const n = idx ? idx.count : pos.count;
  const verts = [];
  for (let i = 0; i < n; i++) {
    const k = idx ? idx.getX(i) : i;
    verts.push(new V().fromBufferAttribute(pos, k));
  }

  // Bones, as segments from each bone to its parent.
  const WANT = /^(Hips|Spine|Spine1|Spine2|Neck|Head|LeftShoulder|LeftArm|LeftForeArm|RightShoulder|RightArm|RightForeArm|LeftUpLeg|LeftLeg|LeftFoot|RightUpLeg|RightLeg|RightFoot)$/;
  const bones = [];
  g.player.getGroup().traverse((b) => {
    if (!b.isBone) return;
    const name = b.name.replace(/^mixamorig/, '');
    if (!WANT.test(name)) return;
    if (!b.parent || !b.parent.isBone) return;
    bones.push({ name, bone: b, parent: b.parent });
  });

  const segDist = (p, a, b) => {
    const ab = b.clone().sub(a);
    const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
    return p.distanceTo(a.clone().addScaledVector(ab, t));
  };

  const measure = (label) => {
    holder.updateWorldMatrix(true, true);
    const world = verts.map((v) => v.clone().applyMatrix4(rodMesh.matrixWorld));
    const perBone = {};
    for (const { name, bone, parent } of bones) {
      const a = new V().setFromMatrixPosition(bone.matrixWorld);
      const b = new V().setFromMatrixPosition(parent.matrixWorld);
      let min = Infinity;
      for (const w of world) {
        const d = segDist(w, a, b);
        if (d < min) min = d;
      }
      perBone[name] = +min.toFixed(3);
    }
    const worst = Object.entries(perBone).sort((x, y) => x[1] - y[1]).slice(0, 4);
    return { label, worst, perBone };
  };

  const rows = [];
  animator.showIdle(0.1);
  await new Promise((r) => setTimeout(r, 900));
  rows.push(measure('idle'));
  for (const t of [0.55, 1.1, 1.3, 1.55, 1.8, 1.95, 2.2, 2.75, 4.0]) {
    animator.scrubCast(t);
    await new Promise((r) => setTimeout(r, 900));
    rows.push(measure('cast ' + t));
  }
  return rows;
})()`);

for (const row of out) {
  const bad = row.worst.filter(([, d]) => d < 0.10);
  console.log(
    row.label.padEnd(9),
    bad.length ? 'CLIPS' : 'clear',
    row.worst.map(([n, d]) => n + '=' + d).join('  ')
  );
}
process.exit(0);
