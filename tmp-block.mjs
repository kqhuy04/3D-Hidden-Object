import { launch, waitForGame } from './tmp-cdp.mjs';
const mapId = process.argv[2] ?? 'chronos-hearth';
const x = Number(process.argv[3]);
const z = Number(process.argv[4]);
const y = Number(process.argv[5] ?? 0);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9447 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const V = h.camera.position.constructor;
  const c = h.player.getController();
  h.player.setPosition(${x}, ${y}, ${z});
  const res = h.collision.moveCapsule(new V(${x}, ${y}, ${z}), new V(0.6, 0, 0), undefined, ${y});
  return {
    to: [+res.position.x.toFixed(2), +res.position.y.toFixed(2), +res.position.z.toFixed(2)],
    blocked: res.blocked,
    contacts: res.contacts.map((k) => ({ part: k.partName, pen: +k.penetration.toFixed(2), n: [+k.nx.toFixed(1), +k.nz.toFixed(1)] })),
    parts: h.geometry.partStats.filter((p) => p.bounds.max.x > ${x} && p.bounds.min.x < ${x} + 1 && p.bounds.max.z > ${z} - 1 && p.bounds.min.z < ${z} + 1 && p.bounds.max.y > ${y} - 0.5).map((p) => p.name),
  };
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
