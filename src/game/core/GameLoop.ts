export class GameLoop {
  private lastTime = 0;
  private running = false;
  private rafId = 0;
  private onUpdate: (delta: number) => void;
  private onRender: () => void;
  /** Told the real interval between frames, in milliseconds. */
  private onFrameTime: ((frameMs: number) => void) | null = null;

  constructor(onUpdate: (delta: number) => void, onRender: () => void) {
    this.onUpdate = onUpdate;
    this.onRender = onRender;
  }

  /**
   * Reports how long the last frame actually took.
   *
   * Not the same thing as the clamped `delta` handed to `onUpdate`: that is
   * clamped to 0.1 s so a tab that was asleep does not teleport the player, and
   * it therefore cannot be used to judge performance. This is the raw interval,
   * which is the only honest signal of whether the machine is keeping up.
   */
  public onFrame(callback: (frameMs: number) => void): void {
    this.onFrameTime = callback;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  public stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (time: number): void => {
    if (!this.running) return;

    const frameMs = time - this.lastTime;
    const delta = Math.min(0.1, frameMs / 1000);
    this.lastTime = time;

    // Before the draw, never after. `onFrameTime` is where the adaptive scaler
    // decides to change the internal resolution, and changing it calls
    // `renderer.setPixelRatio` → `setSize` → assigns `canvas.width`, which
    // resets the drawing buffer to transparent black. Run after `onRender` the
    // buffer was cleared with the finished frame already in it, so the browser
    // presented a black canvas until the next rAF painted over it — the
    // full-screen black flash reported while walking. Resizing first means the
    // same frame draws into the new buffer and nothing is ever presented empty.
    this.onFrameTime?.(frameMs);
    this.onUpdate(delta);
    this.onRender();

    this.rafId = requestAnimationFrame(this.tick);
  };
}
