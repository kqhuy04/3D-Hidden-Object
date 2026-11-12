// Is the target frame actually visible when something is in reach?
//
// It replaced the GPU outline, so if it is behind the canvas or off screen the
// player loses the "you are on target" signal entirely and the bug fix becomes
// a feature removal.
import fs from 'node:fs';
import { launch, waitForGame } from './tools/cdp.mjs';

const log = (s) => fs.appendFileSync('tmp-frame.log', s + '\n');
fs.writeFileSync('tmp-frame.log', '');

const cdp = await launch({ url: 'http://localhost:8099/?debug=1', port: 9507, width: 1280, height: 800 });
try {
  await waitForGame(cdp);
  await cdp.evaluate(`(async () => { await window.__hunt.game.startNewRound(); return true; })()`);

  // Walk the body until the game reports a target, driving real frames.
  const found = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    const frame = document.querySelector('.target-frame');
    const out = { frameInDom: !!frame, samples: [] };
    for (let i = 0; i < 240; i++) {
      h.game.update(1 / 60);
      await new Promise(r => requestAnimationFrame(r));
      const shown = frame && frame.classList.contains('is-shown');
      if (shown) {
        const r = frame.getBoundingClientRect();
        const cs = getComputedStyle(frame);
        out.hitAt = i;
        out.rect = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
        out.opacity = cs.opacity;
        out.zIndex = cs.zIndex;
        out.parent = frame.parentElement ? frame.parentElement.className || frame.parentElement.id : null;
        break;
      }
    }
    if (!out.hitAt) out.note = 'never shown in 240 frames';
    return out;
  })()`);
  log('frame ' + JSON.stringify(found, null, 1));

  // Is it painted above the canvas, or hidden behind it?
  const paint = await cdp.evaluate(`(() => {
    const frame = document.querySelector('.target-frame');
    if (!frame) return { error: 'no frame element' };
    const r = frame.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2);
    const cy = Math.round(r.y + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const canvas = document.querySelector('canvas');
    const cRect = canvas.getBoundingClientRect();
    return {
      topElementAtCentre: top ? (top.className || top.tagName) : null,
      canvasRect: [Math.round(cRect.x), Math.round(cRect.y), Math.round(cRect.width), Math.round(cRect.height)],
      frameCentre: [cx, cy],
      frameVisible: r.width > 0 && r.height > 0,
    };
  })()`);
  log('paint ' + JSON.stringify(paint, null, 1));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(process.env.LOCALAPPDATA + '/Temp/hunt-shots/frame.png', Buffer.from(shot.data, 'base64'));
  log('saved');
} catch (e) {
  log('THROW ' + (e && e.message));
} finally {
  await cdp.close();
}
