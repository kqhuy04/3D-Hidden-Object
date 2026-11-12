// Smoke test for the production build: does the game boot with the atmosphere
// system in place, and is the sky the one the map asked for?
//
// Runs against `dist/` on a plain static server rather than the dev server, so
// it also proves the built bundle works — including the Draco decoder path and
// the map assets, which the dev server resolves differently.
import fs from 'node:fs';
import { launch, waitForGame } from './tools/cdp.mjs';

const log = (s) => fs.appendFileSync('tmp-smoke2.log', s + '\n');
fs.writeFileSync('tmp-smoke2.log', '');

const cdp = await launch({ url: 'http://localhost:8099/?debug=1', port: 9505, width: 1100, height: 700 });
try {
  await waitForGame(cdp);
  log('game ready');

  // Give the first frames a chance: the atmosphere is applied during load, but
  // the weather geometry is built on the same call.
  await new Promise((r) => setTimeout(r, 5000));

  const state = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    if (!h) return { error: 'no handle' };
    const g = h.game;
    const a = h.atmosphere;
    const scene = h.sun.sun.parent;
    return {
      map: g.map ? g.map.id : null,
      weather: a && a.getWeather ? a.getWeather() : null,
      background: scene && scene.background ? scene.background.getHexString() : null,
      fogColor: scene && scene.fog ? scene.fog.color.getHexString() : null,
      fogDensity: scene && scene.fog ? +scene.fog.density.toFixed(4) : null,
      weatherPoints: !!(scene && scene.getObjectByName &&
        (scene.getObjectByName('weather-rain') || scene.getObjectByName('weather-snow'))),
      sunIntensity: +h.sun.sun.intensity.toFixed(3),
      sunColor: h.sun.sun.color.getHexString(),
      ambientIntensity: +h.sun.ambient.intensity.toFixed(3),
      ambientColor: h.sun.ambient.color.getHexString(),
      sunY: +h.sun.sun.position.y.toFixed(1),
      targetFrame: !!h.targetFrame,
      drawCalls: h.renderer.info.render.calls,
      frameMs: +h.quality.getFrameMs().toFixed(1),
    };
  })()`);
  log('state ' + JSON.stringify(state, null, 1));

  const errors = cdp.consoleLines.filter((l) => /error|Error|ERROR|shader|WebGL/i.test(l));
  log('console errors: ' + (errors.length ? errors.join(' | ') : 'none'));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(
    process.env.LOCALAPPDATA + '/Temp/hunt-shots/boot.png',
    Buffer.from(shot.data, 'base64')
  );
  log('screenshot saved');
} catch (e) {
  log('THROW ' + (e && e.message));
} finally {
  await cdp.close();
}
