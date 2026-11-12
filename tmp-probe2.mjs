import { launch, waitForGame } from './tmp-cdp.mjs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9338 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 600));

const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  const item = h.hiddenItems.getItems().find((i) => i.placement.id === 'camp-toaster');
  const c = item.centre;
  const sx = c.x, sz = c.z + 1.5;
  const ground = h.collision.getGroundHeight(sx, sz);
  h.player.setPosition(sx, ground + 0.05, sz);
  h.cameraController.snap(h.player.getPosition(), ground);
  await new Promise((r) => setTimeout(r, 500));

  const reach = h.player.getPosition().clone();
  reach.y += 1.1;
  const t = h.hiddenItems.findTarget(h.camera, h.camera.position, reach, h.collision);

  return {
    state: h.game.state,
    foundByProbe: t ? t.placement.id : null,
    gameTarget: h.game.pickupTarget ? h.game.pickupTarget.placement.id : null,
    promptHidden: document.querySelector('#hud-pickup-prompt').className,
    bodyY: +h.player.getPosition().y.toFixed(2),
    camY: +h.camera.position.y.toFixed(2),
    dist: +reach.distanceTo(c).toFixed(2),
  };
})()`);

console.log(JSON.stringify(out, null, 2));
await cdp.close();
