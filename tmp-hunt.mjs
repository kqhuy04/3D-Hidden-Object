// Placement check for the odd-object hunt.
//
// For every object on a map: walk up to it from four sides, ask the game whether
// that object is actually pickable from each, and save a screenshot from the
// first side that works. A placement nobody can reach is a placement that does
// not exist, and a screenshot from inside a wall proves nothing — hence the four
// approaches rather than one.
//
// The camera controller is neutralised for the shot so the frame is composed
// exactly as measured, while the loop keeps rendering it.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const mapId = process.argv[2];
const outDir = process.argv[3] ?? 'docs/hunt';
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9334 });
await waitForGame(cdp);

const info = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  h.game.startNewRound();
  await new Promise((r) => setTimeout(r, 600));
  return {
    map: h.game.map.id,
    items: h.hiddenItems.getItems().map((i) => ({
      id: i.placement.id,
      name: i.placement.name,
      centre: [+i.centre.x.toFixed(2), +i.centre.y.toFixed(2), +i.centre.z.toFixed(2)],
      radius: +i.radius.toFixed(2),
    })),
  };
})()`);

console.log(`${info.map}: ${info.items.length} objects`);

const results = [];
for (const item of info.items) {
  const [cx, cy, cz] = item.centre;

  const shot = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const coll = h.collision;
    const cam = h.camera;

    if (!h.__origUpdate) h.__origUpdate = h.cameraController.update.bind(h.cameraController);
    h.cameraController.update = () => {};

    const DIRS = [[0, 2], [Math.PI / 2, 2], [Math.PI, 2], [-Math.PI / 2, 2]];
    let chosen = null;

    for (const [angle, dist] of DIRS) {
      const sx = ${cx} + Math.sin(angle) * dist;
      const sz = ${cz} + Math.cos(angle) * dist;
      const ground = coll.getGroundHeight(sx, sz);
      h.player.setPosition(sx, ground + 0.05, sz);

      cam.position.set(sx, ${cy} + 1.35, sz);
      cam.lookAt(${cx}, ${cy}, ${cz});
      cam.updateMatrixWorld(true);

      const target = h.hiddenItems.findTarget(cam, cam.position, h.player.getPosition(), coll);
      if (target && target.placement.id === '${item.id}') {
        chosen = { angle: +angle.toFixed(2), sx: +sx.toFixed(2), sz: +sz.toFixed(2), ground: +ground.toFixed(2) };
        break;
      }
    }

    if (!chosen) {
      // Leave the camera somewhere useful for the screenshot anyway.
      cam.position.set(${cx}, ${cy} + 1.35, ${cz} + 2);
      cam.lookAt(${cx}, ${cy}, ${cz});
      cam.updateMatrixWorld(true);
    }

    return { pickable: !!chosen, from: chosen };
  })()`);

  await new Promise((r) => setTimeout(r, 700));
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = `${outDir}/${info.map}-${item.id}.png`;
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));

  results.push({ id: item.id, name: item.name, centre: item.centre, ...shot, file });
  console.log(
    `  ${item.id.padEnd(20)} at ${String(item.centre[1]).padStart(6)}  ` +
      (shot.pickable ? `pickable from ${shot.from.angle} rad` : 'NOT PICKABLE')
  );
}

await cdp.evaluate(`(() => {
  const h = window.__hunt;
  if (h.__origUpdate) h.cameraController.update = h.__origUpdate;
})()`);

console.log(JSON.stringify({ map: info.map, results }));
await cdp.close();
