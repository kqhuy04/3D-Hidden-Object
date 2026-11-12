// Is the walk stutter the character, or the ground under it?
//
// Same map, same spot, same 120 frames of held W, two different bodies. If the
// numbers match, the rig is innocent and the body is being pushed around by
// something shared. If they differ, it is the model.
//
// Usage: node tmp-walkjit.mjs [map]
import { launch, waitForGame } from './tmp-cdp.mjs';

const map = process.argv[2] ?? 'campground-lake';
const BODIES = [
  ['road-tripper', 'family-road-tripper-247570'],
  ['mariachi', 'skeleton-mariachi-c1b4d5'],
  ['magician', 'stage-magician-2ecd48'],
];
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port: 9512 });
await waitForGame(cdp);

await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.startNewRound();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 4000));

// Freeze the round and remember the spot, so every body walks the same metre.
const home = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();
  h.game.cutscene.skip(h.camera);
  h.game.endCutscene();
  const p = h.player.getPosition();
  return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];
})()`);
console.log('start', JSON.stringify(home));

for (const [name, id] of BODIES) {
  await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    await h.player.swapModel('/assets/characters/${id}.glb');
    h.player.setPosition(${home[0]}, ${home[1]}, ${home[2]});
    for (let i = 0; i < 4; i++) h.game.update(1 / 60);
    return true;
  })()`);

  const result = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const group = h.player.getGroup();
    let hips = null;
    let foot = null;
    group.traverse((o) => {
      if (!o.isBone) return;
      if (!hips && o.name === 'Hips') hips = o;
      if (!foot && (o.name === 'LeftFoot' || o.name === 'LeftToeBase')) foot = o;
    });
    const anim = h.player.getAnimator();
    const V = h.camera.position.constructor;
    const worldY = (b) => (b ? b.getWorldPosition(new V()).y : null);

    h.game.input.keys['KeyW'] = true;
    const frames = [];
    let prev = h.player.getPosition().clone();
    for (let i = 0; i < 120; i++) {
      h.game.update(1 / 60);
      const p = h.player.getPosition();
      const ground = h.collision.groundAt(p.x, p.z, p.y + 0.5);
      frames.push({
        bodyY: p.y,
        ground: ground ?? p.y,
        gap: ground === null ? null : p.y - ground,
        hipsY: worldY(hips),
        footY: worldY(foot),
        step: Math.hypot(p.x - prev.x, p.z - prev.z),
      });
      prev = p.clone();
    }
    h.game.input.keys['KeyW'] = false;

    const col = (key) => frames.map((f) => f[key]).filter((v) => v !== null);
    const stats = (key) => {
      const v = col(key);
      if (v.length < 2) return null;
      const deltas = [];
      for (let i = 1; i < v.length; i++) deltas.push(v[i] - v[i - 1]);
      let reversals = 0;
      let last = 0;
      for (const d of deltas) {
        if (Math.abs(d) < 1e-4) continue;
        const s = Math.sign(d);
        if (last !== 0 && s !== last) reversals++;
        last = s;
      }
      return {
        span: +(Math.max(...v) - Math.min(...v)).toFixed(3),
        maxStep: +Math.max(...deltas.map(Math.abs)).toFixed(4),
        reversals,
      };
    };
    return {
      action: anim?.getCurrentActionName() ?? null,
      body: stats('bodyY'),
      hips: stats('hipsY'),
      foot: stats('footY'),
      gap: stats('gap'),
      step: stats('step'),
      gapMean: +(
        col('gap').reduce((a, b) => a + b, 0) / Math.max(1, col('gap').length)
      ).toFixed(3),
      hipsMinusBody: +(
        col('hipsY').reduce((a, b) => a + b, 0) / Math.max(1, col('hipsY').length) -
        col('bodyY').reduce((a, b) => a + b, 0) / Math.max(1, col('bodyY').length)
      ).toFixed(3),
      stepSeries: frames.slice(0, 60).map((f) => +(f.step * 1000).toFixed(1)),
      bodySeries: frames.slice(0, 60).map((f) => +(f.bodyY * 1000).toFixed(1)),
    };
  })()`);

  const { stepSeries, bodySeries, ...rest } = result;
  console.log(name.padEnd(13), JSON.stringify(rest));
  if (name === 'magician') {
    console.log('  step mm  ', JSON.stringify(stepSeries));
    console.log('  body mm  ', JSON.stringify(bodySeries));
  }
}

console.log('console errors:', cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 6));
await cdp.close();
