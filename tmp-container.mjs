import { launch, waitForGame } from './tmp-cdp.mjs';
const mapId = process.argv[2] ?? 'campground-lake';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9401 });
await waitForGame(cdp);
const info = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const geo = h.geometry;
  const name = geo ? geo.getPartContainerName() : null;
  const scene = h.game.scene;
  const node = name ? scene.getObjectByName(name) : null;
  const props = h.game.selector.getProps();
  return {
    containerName: name,
    found: !!node,
    childCount: node ? node.children.length : -1,
    props: props.length,
    sample: props.slice(0, 12).map((p) => ({
      name: p.name,
      c: [+p.centre.x.toFixed(1), +p.centre.y.toFixed(1), +p.centre.z.toFixed(1)],
      r: +p.radius.toFixed(2),
    })),
  };
})()`);
console.log(JSON.stringify(info, null, 2));
await cdp.close();
