// A/B in one page: the old render configuration vs the new one, measured on the
// same scene, same session, same thermal state.
//
// The old configuration is reconstructed at runtime rather than by checking out
// old code: shadow map 2048² over a ±45 m box pinned to the origin, PCFSoft
// filtering, rebuilt every frame, and every frame drawn through the composer.
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'chrome-arcology-transit';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9450, width: 1280, height: 800 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { localStorage.clear(); return true; })()`);
await cdp.send('Page.navigate', { url: `http://localhost:1420/?debug=1&map=${mapId}` });
for (let i = 0; i < 200; i++) {
  const ready = await cdp.evaluate(`!!window.__hunt && window.__hunt.game.map?.id === ${JSON.stringify(mapId)}`).catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 1500));

const result = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  const sun = h.sun.sun;
  const THREE_PCFSoft = 2;

  g.loop.stop();

  // --- helpers ------------------------------------------------------------
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1); };
  const avg = (a) => +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1);

  const warm = (n) => { for (let i = 0; i < n; i++) { g.update(1 / 60); g.render(); } };

  // --- the old configuration ---------------------------------------------
  const goOld = () => {
    g.renderer.shadowMap.autoUpdate = true;
    g.renderer.shadowMap.enabled = true;
    g.renderer.shadowMap.type = THREE_PCFSoft;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.map?.dispose(); sun.shadow.map = null;
    const c = sun.shadow.camera;
    c.left = -45; c.right = 45; c.top = 45; c.bottom = -45;
    c.near = 5; c.far = 140;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.position.set(45, 60, 35);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    // The old render path: the composer, unconditionally.
    g.render = () => { g.highlight.composer.render(); };
  };

  // --- the new configuration ---------------------------------------------
  const goNew = () => {
    g.renderer.shadowMap.autoUpdate = false;
    g.renderer.shadowMap.enabled = true;
    g.quality.setLevel('medium');
    h.sun.apply(g.quality.getPreset());
    sun.position.set(sun.target.position.x + 45, sun.target.position.y + 60, sun.target.position.z + 35);
    // The real render method, restored from the prototype.
    delete g.render;
  };

  const measure = (label, setup) => {
    setup();
    warm(14);
    const s = [];
    for (let i = 0; i < 60; i++) {
      // Move the body so the light follow and the shadow cadence behave as they
      // do in a real session.
      const p = g.player.getPosition();
      g.player.setPosition(p.x + 0.02, p.y, p.z);
      const a = performance.now();
      g.update(1 / 60);
      g.render();
      s.push(performance.now() - a);
    }
    return { label, avgMs: avg(s), medianMs: median(s), fps: Math.round(1000 / avg(s)) };
  };

  // Interleaved rounds: SwiftShader's throughput drifts over a run, so measuring
  // all of one and then all of the other attributes the drift to the config.
  // Alternating and comparing medians cancels it out.
  const rounds = [];
  for (let r = 0; r < 3; r++) {
    rounds.push(measure('old', goOld));
    rounds.push(measure('new', goNew));
  }
  goNew();

  const pick = (label) => rounds.filter((r) => r.label === label).map((r) => r.medianMs).sort((a, b) => a - b);
  const oldMeds = pick('old');
  const newMeds = pick('new');

  return {
    rounds,
    oldMedianOfMedians: oldMeds[1],
    newMedianOfMedians: newMeds[1],
    speedup: +(oldMeds[1] / newMeds[1]).toFixed(2),
    casters: (() => { let n = 0; g.scene.traverse((o) => { if (o.isMesh && o.castShadow) n++; }); return n; })(),
    calls: (() => { g.renderer.info.reset(); g.renderer.render(g.scene, g.camera); return g.renderer.info.render.calls; })(),
  };
})()`);

console.log(JSON.stringify(result, null, 1));
await cdp.close();
