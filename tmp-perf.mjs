// Where the frame time goes.
//
// SwiftShader cannot tell us what a real GPU will do, but three things it can
// tell us are hardware-independent: how many draw calls a frame issues, how many
// triangles, and how much of the frame is spent outside the draw calls. Those are
// what decide whether the game runs at 30 or 144 on the player's machine.
//
// Usage: node tmp-perf.mjs [map-id]
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'chrome-arcology-transit';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9441, width: 1280, height: 800 });
await waitForGame(cdp);
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 1200));

const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  const scene = g.scene;
  const renderer = g.renderer;

  let meshes = 0, skinned = 0, materials = new Set(), geometries = new Set(), shadowCasters = 0;
  let tris = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    if (o.isSkinnedMesh) skinned++;
    if (o.castShadow) shadowCasters++;
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => materials.add(x.uuid)); else if (m) materials.add(m.uuid);
    if (o.geometry) {
      geometries.add(o.geometry.uuid);
      const p = o.geometry.attributes.position;
      const ix = o.geometry.index;
      tris += ix ? ix.count / 3 : (p ? p.count / 3 : 0);
    }
  });

  // One render, then read the counters the renderer keeps for that frame.
  renderer.info.reset();
  renderer.render(scene, g.camera);
  const info = {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    points: renderer.info.render.points,
    lines: renderer.info.render.lines,
    programs: renderer.info.programs ? renderer.info.programs.length : -1,
    textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries,
  };

  return {
    meshes, skinned, shadowCasters,
    materials: materials.size, geometries: geometries.size,
    sceneTris: Math.round(tris),
    draw: info,
    pixelRatio: renderer.getPixelRatio(),
    drawingBuffer: [renderer.domElement.width, renderer.domElement.height],
    shadows: renderer.shadowMap.enabled,
    shadowType: renderer.shadowMap.type,
    composer: !!g.highlight,
  };
})()`);

console.log(JSON.stringify(out, null, 1));

// --- timing: update vs render, over real frames ---------------------------
const timing = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  const g = h.game;
  // Stop the live loop so nothing else is drawing while we measure.
  g.loop.stop();
  const N = 12;
  const t = { update: [], render: [], composerRender: [], plainRender: [] };
  for (let i = 0; i < N; i++) {
    let a = performance.now();
    g.update(1 / 60);
    t.update.push(performance.now() - a);

    a = performance.now();
    g.render();
    t.render.push(performance.now() - a);

    a = performance.now();
    g.highlight.render();
    t.composerRender.push(performance.now() - a);

    a = performance.now();
    g.renderer.render(g.scene, g.camera);
    t.plainRender.push(performance.now() - a);
  }
  const avg = (a) => +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1); };
  return {
    updateMs: avg(t.update),
    composerMs: med(t.composerRender),
    plainMs: med(t.plainRender),
    ratio: +(med(t.composerRender) / med(t.plainRender)).toFixed(2),
  };
})()`);
console.log('timing', JSON.stringify(timing));

// --- shadow cost ----------------------------------------------------------
const shadow = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  const time = () => {
    const s = [];
    for (let i = 0; i < 8; i++) {
      const a = performance.now();
      g.renderer.render(g.scene, g.camera);
      s.push(performance.now() - a);
    }
    s.sort((a, b) => a - b);
    return +s[4].toFixed(1);
  };
  g.renderer.shadowMap.enabled = true;
  g.renderer.shadowMap.needsUpdate = true;
  const withShadows = time();
  g.renderer.shadowMap.enabled = false;
  const without = time();
  g.renderer.shadowMap.enabled = true;
  return { withShadows, without };
})()`);
console.log('shadow', JSON.stringify(shadow));

// --- pixel ratio cost -----------------------------------------------------
const pixels = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  const time = (r) => {
    g.renderer.setPixelRatio(r);
    g.renderer.setSize(window.innerWidth, window.innerHeight);
    const s = [];
    for (let i = 0; i < 6; i++) {
      const a = performance.now();
      g.renderer.render(g.scene, g.camera);
      s.push(performance.now() - a);
    }
    s.sort((a, b) => a - b);
    return +s[3].toFixed(1);
  };
  const at1 = time(1);
  const at2 = time(2);
  g.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  g.renderer.setSize(window.innerWidth, window.innerHeight);
  return { at1, at2 };
})()`);
console.log('pixelRatio', JSON.stringify(pixels));

await cdp.close();
