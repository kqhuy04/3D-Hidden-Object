// Numbers, not guesses: where the mount thinks it is, where the seat is, and
// where the rider ended up.
import { launch, waitForGame } from './tmp-cdp.mjs';

const map = process.argv[2] ?? 'frontier-town';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port: 9483 });
await waitForGame(cdp);

const info = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  const V3 = h.player.getPosition().constructor;
  await h.game.selectMap('${map}');
  await h.game.startNewRound();
  h.game.loop.stop();

  const m = h.mounts.mounts[0];
  const p = m.unit.getWorldPosition(new V3());
  h.player.setPosition(p.x + 1.6, p.y, p.z + 1.6);
  for (let f = 0; f < 5; f++) h.game.update(1 / 60);
  h.mounts.actions[0].use();
  for (let f = 0; f < 5; f++) h.game.update(1 / 60);

  const r = (v) => v.toArray().map((n) => +n.toFixed(2));
  const before = {
    seatLocal: r(m.seatLocal),
    seatWorld: r(m.unit.localToWorld(m.seatLocal.clone())),
    unitWorld: r(m.unit.getWorldPosition(new V3())),
    unitLocal: r(m.unit.position),
    unitScale: r(m.unit.scale),
    unitQuat: m.unit.quaternion.toArray().map((n) => +n.toFixed(3)),
    forwardLocal: r(m.forwardLocal),
    rider: r(h.player.getPosition()),
    hipLift: +h.mounts.hipLift.toFixed(3),
  };

  // What is the player's own hips position, in world, right now?
  let hips = null;
  h.player.getGroup().traverse((o) => { if (!hips && o.isBone && /^Hips(_\\d+)?$/.test(o.name)) hips = o; });
  before.hipsWorldY = hips ? +hips.getWorldPosition(new V3()).y.toFixed(2) : null;

  // One frame of riding, then look again.
  h.game.input.getMovementVector = () => ({ x: 0, y: 1, length: () => 1 });
  for (let f = 0; f < 30; f++) h.game.update(1 / 60);
  const after = {
    unitWorld: r(m.unit.getWorldPosition(new V3())),
    seatWorld: r(m.unit.localToWorld(m.seatLocal.clone())),
    rider: r(h.player.getPosition()),
    hipsWorldY: hips ? +hips.getWorldPosition(new V3()).y.toFixed(2) : null,
    speed: +m.animator.speed?.toFixed?.(2),
  };
  return { before, after, riderOnUnit: r(m.unit.worldToLocal(h.player.getPosition().clone())) };
})()`);
console.log(JSON.stringify(info, null, 1));
await cdp.close();
