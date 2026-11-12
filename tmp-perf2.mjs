// Where the frame time goes, after the optimisation pass.
//
// SwiftShader cannot tell us what a real GPU will do, but three things it can
// tell us are hardware-independent: how many draw calls a frame issues, how many
// shadow casters there are, and how much of the frame is spent outside the draw
// calls. Those are what decide whether the game runs at 30 or 144 on the
// player's machine.
//
// Usage: node tmp-perf2.mjs [map-id]
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'chrome-arcology-transit';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9443, width: 1280, height: 800 });
await waitForGame(cdp);
// A previous run may have left a quality level in the shared Chrome profile;
// measuring "high" while claiming to measure the default is how a benchmark
// lies. Clear it and reload.
await cdp.evaluate(`(() => { localStorage.clear(); return true; })()`);
await cdp.send('Page.navigate', { url: `http://localhost:1420/?debug=1&map=${mapId}` });
for (let i = 0; i < 200; i++) {
  const ready = await cdp.evaluate(`!!window.__hunt && window.__hunt.game.map?.id === ${JSON.stringify(mapId)}`).catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 1200));

const scene = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  let meshes = 0, skinned = 0, shadowCasters = 0, tris = 0;
  const materials = new Set();
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (o.isSkinnedMesh) skinned++;
    if (o.castShadow) shadowCasters++;
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => materials.add(x.uuid)); else if (m) materials.add(m.uuid);
    const p = o.geometry && o.geometry.attributes.position;
    const ix = o.geometry && o.geometry.index;
    tris += ix ? ix.count / 3 : (p ? p.count / 3 : 0);
  });
  g.renderer.info.reset();
  g.renderer.render(g.scene, g.camera);
  return {
    meshes, skinned, shadowCasters, materials: materials.size,
    sceneTris: Math.round(tris),
    calls: g.renderer.info.render.calls,
    shadowMapSize: g.sun.sun.shadow.mapSize.width,
    shadowBox: g.sun.sun.shadow.camera.right * 2,
    shadowType: g.renderer.shadowMap.type,
    autoUpdate: g.renderer.shadowMap.autoUpdate,
    quality: g.quality.getLevel(),
    preset: g.quality.getPreset(),
    pixelRatio: +g.renderer.getPixelRatio().toFixed(3),
    drawingBuffer: [g.renderer.domElement.width, g.renderer.domElement.height],
  };
})()`);
console.log('scene', JSON.stringify(scene, null, 1));

// --- the frame the player actually gets ------------------------------------
// 90 frames through the real render path, which includes the shadow cadence,
// the composer bypass and the light follow. This is the only number that
// answers "is it faster".
const frames = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  const g = h.game;
  g.loop.stop();
  // Warm up: shader compile, first shadow build, texture upload.
  for (let i = 0; i < 10; i++) { g.update(1 / 60); g.render(); }

  const samples = [];
  for (let i = 0; i < 90; i++) {
    // Move the body a little so the light follow and the shadow cadence both
    // do what they do in a real session instead of sitting perfectly still.
    g.player.setPosition(
      g.player.getPosition().x + 0.02,
      g.player.getPosition().y,
      g.player.getPosition().z
    );
    const a = performance.now();
    g.update(1 / 60);
    g.render();
    samples.push(performance.now() - a);
  }
  samples.sort((a, b) => a - b);
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  return {
    avgMs: +avg.toFixed(1),
    medianMs: +samples[45].toFixed(1),
    p95Ms: +samples[85].toFixed(1),
    impliedFps: Math.round(1000 / avg),
  };
})()`);
console.log('frame', JSON.stringify(frames));

// --- worst case: a shadow rebuild every frame -----------------------------
const rebuild = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  const run = (force) => {
    const s = [];
    for (let i = 0; i < 8; i++) {
      if (force) g.renderer.shadowMap.needsUpdate = true;
      const a = performance.now();
      g.renderer.render(g.scene, g.camera);
      s.push(performance.now() - a);
    }
    s.sort((a, b) => a - b);
    return +s[4].toFixed(1);
  };
  return { rebuildMs: run(true), cachedMs: run(false) };
})()`);
console.log('shadow', JSON.stringify(rebuild));

// --- the post chain, while something is outlined --------------------------
// Shadows are switched off for this measurement: a rebuild landing on some of
// the samples would swamp the difference the composer makes.
const post = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  const shadowWas = g.renderer.shadowMap.enabled;
  g.renderer.shadowMap.enabled = false;

  let target = null;
  g.scene.traverse((o) => { if (!target && o.isMesh && o.castShadow && o.name) target = o; });
  const run = (outlined) => {
    g.highlight.setTarget(outlined ? target : null);
    const s = [];
    for (let i = 0; i < 10; i++) {
      const a = performance.now();
      g.render();
      s.push(performance.now() - a);
    }
    s.sort((a, b) => a - b);
    return +s[5].toFixed(1);
  };
  const plain = run(false);
  const outlined = run(true);
  g.highlight.setTarget(null);
  g.renderer.shadowMap.enabled = shadowWas;
  return { plainMs: plain, outlinedMs: outlined, extraMs: +(outlined - plain).toFixed(1) };
})()`);
console.log('post', JSON.stringify(post));

await cdp.close();
