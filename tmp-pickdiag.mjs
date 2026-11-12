import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=frontier-town', port: 9506 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.startNewRound();
  h.game.loop.stop();
  h.game.cutscene.skip(h.camera);
  h.game.endCutscene();
  const item = h.hiddenItems.getItems()[0];
  const spot = h.collision.findSpawn({ x: item.centre.x + 1.2, y: item.centre.y, z: item.centre.z + 1.2 }, 3);
  h.player.setPosition(spot.x, spot.y, spot.z);
  h.cameraController.snap(h.player.getPosition());
  for (let i = 0; i < 3; i++) h.game.update(1 / 60);
  let sel = h.selector.getSelected();
  for (let i = 0; i < 6 && sel?.item !== item; i++) {
    h.selector.cycle();
    h.game.refreshPickupPrompt();
    sel = h.selector.getSelected();
  }
  const before = {
    state: h.game.state,
    kind: sel?.kind ?? null,
    isItem: sel?.item === item,
    key: sel?.key ?? null,
    candidates: h.selector.getCandidates().map((c) => c.kind + ':' + (c.item?.placement.name ?? c.key)),
  };
  h.game.handlePickup();
  return {
    before,
    after: {
      state: h.game.state,
      itemsLeft: h.hiddenItems.getItems().length,
      found: h.game.roundManager.getFoundCount(),
      strikes: h.game.roundManager.getStrikes ? h.game.roundManager.getStrikes() : null,
      label: h.foundLabel.isShowing,
    },
  };
})()`);
console.log(JSON.stringify(out, null, 2));
await cdp.close();
