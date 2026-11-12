// Starts a round in the production build and captures the actual 3D view, so
// the atmosphere can be judged on the scene rather than on a colour swatch.
import fs from 'node:fs';
import { launch, waitForGame } from './tools/cdp.mjs';

const log = (s) => fs.appendFileSync('tmp-scene.log', s + '\n');
fs.writeFileSync('tmp-scene.log', '');

const cdp = await launch({ url: 'http://localhost:8099/?debug=1', port: 9506, width: 1280, height: 800 });
try {
  await waitForGame(cdp);
  log('ready');

  await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    await h.game.startNewRound();
    return true;
  })()`);
  log('round started');

  // Real frames, so the follow camera settles and the atmosphere is applied.
  await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    for (let i = 0; i < 40; i++) { h.game.update(1 / 60); await new Promise(r => requestAnimationFrame(r)); }
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 2500));

  const info = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const scene = h.sun.sun.parent;
    const dbg = document.getElementById('debug-overlay');
    if (dbg) dbg.style.display = 'none';
    return {
      state: h.game.getState ? h.game.getState() : null,
      background: scene.background ? scene.background.getHexString() : null,
      sunIntensity: +h.sun.sun.intensity.toFixed(2),
      ambient: +h.sun.ambient.intensity.toFixed(2),
      drawCalls: h.renderer.info.render.calls,
      pos: [h.player.getPosition().x, h.player.getPosition().y, h.player.getPosition().z].map(v => +v.toFixed(1)),
    };
  })()`);
  log('scene ' + JSON.stringify(info));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(
    process.env.LOCALAPPDATA + '/Temp/hunt-shots/scene.png',
    Buffer.from(shot.data, 'base64')
  );
  log('screenshot saved');

  const errors = cdp.consoleLines.filter((l) => /error|Error|shader/i.test(l));
  log('console: ' + (errors.length ? errors.slice(0, 4).join(' | ') : 'none'));
} catch (e) {
  log('THROW ' + (e && e.message));
} finally {
  await cdp.close();
}
