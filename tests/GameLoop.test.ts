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
});
