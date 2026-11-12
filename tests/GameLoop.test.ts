import { describe, it, expect, beforeEach } from 'vitest';
import { GameLoop } from '../src/game/core/GameLoop';

/**
 * The order of the three callbacks is load-bearing, not incidental.
 *
 * `onFrameTime` is where the adaptive scaler decides to change the internal
 * resolution, and changing it calls `renderer.setPixelRatio` → `setSize`, which
 * assigns `canvas.width` and resets the drawing buffer to transparent black.
 * When that ran after `onRender` it cleared the finished frame out of the
 * buffer, and the browser presented a black canvas until the next rAF painted
 * over it — the full-screen flash reported while walking.
 */
describe('GameLoop frame order', () => {
  beforeEach(() => {
    // The loop schedules itself through rAF; a stub keeps the test synchronous.
    const g = globalThis as unknown as {
      requestAnimationFrame: (cb: (t: number) => void) => number;
      cancelAnimationFrame: (id: number) => void;
    };
    g.requestAnimationFrame = () => 1;
    g.cancelAnimationFrame = () => {};
  });

  it('reports the frame time before drawing, so a resolution change cannot clear the presented frame', () => {
    const order: string[] = [];
    const loop = new GameLoop(
      () => order.push('update'),
      () => order.push('render')
    );
    loop.onFrame(() => order.push('frame'));

    loop.start();
    (loop as unknown as { tick: (t: number) => void }).tick(performance.now() + 16);

    expect(order).toEqual(['frame', 'update', 'render']);
  });

  it('stops calling anything once stopped', () => {
    const order: string[] = [];
    const loop = new GameLoop(
      () => order.push('update'),
      () => order.push('render')
    );
    loop.onFrame(() => order.push('frame'));

    loop.start();
    loop.stop();
    (loop as unknown as { tick: (t: number) => void }).tick(performance.now() + 16);

    expect(order).toEqual([]);
  });

  /**
   * `start` stamps `lastTime` with `performance.now()`, but the first animation
   * frame reports the timestamp of the frame it belongs to — which can be
   * earlier. The delta was only clamped at the top, so that first frame went to
   * the animation mixer negative and played the walk cycle backwards: a body
   * that steps backwards and then carries on.
   */
  it('never hands the game a negative delta', () => {
    const deltas: number[] = [];
    const loop = new GameLoop(
      (delta) => deltas.push(delta),
      () => {}
    );

    loop.start();
    const tick = (loop as unknown as { tick: (t: number) => void }).tick.bind(loop);
    // A frame timestamp from before `start` was called.
    tick(performance.now() - 40);
    tick(performance.now() + 16);

    expect(deltas[0]).toBeGreaterThanOrEqual(0);
    expect(deltas[1]).toBeGreaterThanOrEqual(0);
  });
});
