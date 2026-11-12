// Does the picture change when the post chain takes over?
//
// The idle path renders straight to the canvas; the outlined path goes through
// the composer. If those two produce different images, the whole scene shifts
// brightness every time the crosshair crosses a prop — which is worse than any
// frame rate.
//
// Measured by reading the actual framebuffer pixels after each path, not by
// eyeballing a screenshot.
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'chrome-arcology-transit';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9444, width: 1280, height: 800 });
await waitForGame(cdp);
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 1200));

const result = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  g.loop.stop();
  const gl = g.renderer.getContext();
  const w = gl.drawingBufferWidth, hgt = gl.drawingBufferHeight;
  const W = 96, H = 96;

  const sample = () => {
    const buf = new Uint8Array(4 * W * H);
    gl.readPixels((w - W) >> 1, (hgt - H) >> 1, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let r = 0, gg = 0, b = 0, max = 0;
    for (let i = 0; i < buf.length; i += 4) {
      r += buf[i]; gg += buf[i + 1]; b += buf[i + 2];
      max = Math.max(max, buf[i], buf[i + 1], buf[i + 2]);
    }
    const n = W * H;
    return { r: +(r / n).toFixed(1), g: +(gg / n).toFixed(1), b: +(b / n).toFixed(1), max };
  };

  // Warm up both paths so shaders and targets exist.
  g.render();
  g.render();

  const direct = sample();

  // Through the composer with an *empty* selection: same image, different path.
  // Selecting something would draw gold edges and the comparison would just be
  // measuring the outline.
  g.highlight.setTarget(null);
  g.highlight.composer.render();
  const composed = sample();

  const diff = {
    r: +(composed.r - direct.r).toFixed(1),
    g: +(composed.g - direct.g).toFixed(1),
    b: +(composed.b - direct.b).toFixed(1),
  };
  return { direct, composed, diff, bufferType: g.highlight.composer.renderTarget1.texture.type };
})()`);

console.log(JSON.stringify(result, null, 1));
await cdp.close();
