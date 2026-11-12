// Does the "Get off" prompt follow the horse?
//
// The mount's action centre used to be a snapshot taken where the kit parked
// the animal, so riding twenty metres away left the prompt behind at the stable.
import { launch, waitForGame } from './tmp-cdp.mjs';

const map = process.argv[2] ?? 'frontier-town';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port: 9494 });
await waitForGame(cdp);

const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.loop.stop();
  const V = h.camera.position.constructor;
  const mount = h.mounts.mounts[0];
  if (!mount) return { error: 'no mount on this map' };

  // Mount up through the same verb the prompt offers.
  mount.action.use();
  const atStart = {
    riding: h.mounts.isRiding(),
    label: mount.action.label(),
    gap: +mount.action.centre.distanceTo(mount.unit.getWorldPosition(new V())).toFixed(2),
  };

  const forward = { x: 0, y: -1, length() { return 1; } };
  for (let i = 0; i < 240; i++) h.mounts.update(1 / 60, forward, 0);

  const horse = mount.unit.getWorldPosition(new V());
  const body = h.player.getPosition();
  const centre = mount.action.centre;
  return {
    atStart,
    travelled: +Math.hypot(horse.x - mount.home.x, horse.z - mount.home.z).toFixed(2),
    centreToHorse: +centre.distanceTo(horse).toFixed(2),
    centreToBody: +centre.distanceTo(body).toFixed(2),
    label: mount.action.label(),
    enabled: mount.action.enabled(),
  };
})()`);

console.log(JSON.stringify(out, null, 2));
await cdp.close();
