import * as THREE from 'three';

/**
 * How hard the renderer is allowed to work.
 *
 * The game is a walk-and-look game: the frame is fill-bound, not
 * geometry-bound. Shadows re-render a thousand props, the post chain draws the
 * scene twice, and the canvas is sized by the monitor's pixel ratio — three
 * multipliers that compound. This module owns all of them in one place so the
 * settings screen, the presets and the adaptive scaler cannot disagree.
 */
export type QualityLevel = 'auto' | 'low' | 'medium' | 'high';

export interface QualityPreset {
  /** Cap on `devicePixelRatio`, before the adaptive scale is applied. */
  pixelCap: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Half-width of the shadow box that follows the player, in metres. */
  shadowRadius: number;
  /** Filtering used by the shadow lookup. Soft is two taps per axis more. */
  shadowType: THREE.ShadowMapType;
  /** Minimum milliseconds between shadow map rebuilds while moving. */
  shadowRefreshMs: number;
}

export const QUALITY_PRESETS: Record<Exclude<QualityLevel, 'auto'>, QualityPreset> = {
  // 1.0 is the "native" cap: on a 2x display this alone halves the pixel count.
  low: {
    pixelCap: 1.0,
    shadows: false,
    shadowMapSize: 512,
    shadowRadius: 24,
    shadowType: THREE.PCFShadowMap,
    shadowRefreshMs: 80,
  },
  medium: {
    pixelCap: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    shadowRadius: 30,
    shadowType: THREE.PCFShadowMap,
    shadowRefreshMs: 50,
  },
  high: {
    pixelCap: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    shadowRadius: 36,
    shadowType: THREE.PCFSoftShadowMap,
    shadowRefreshMs: 34,
  },
};

const LADDER: Exclude<QualityLevel, 'auto'>[] = ['low', 'medium', 'high'];

/**
 * Frame time above which the adaptive scaler starts giving resolution back.
 *
 * 20.5 ms is a *sustained* 49 fps. The band is deliberately wide and lopsided:
 * a game that flickers between 58 and 60 fps must not spend the evening
 * stepping the resolution up and down, and every step is a canvas reallocation
 * that the player feels as a stutter.
 */
const SLOW_FRAME_MS = 20.5;
/** Frame time below which it can afford to give some back. */
const FAST_FRAME_MS = 13.0;
/**
 * How often the scaler is allowed to make a decision, in milliseconds.
 *
 * Time, not frames. A frame count is the wrong unit in exactly the situation
 * this class exists for: thirty frames is half a second at 60 fps and
 * twenty-three seconds at 1.3 fps, so the machine that most needs the drop would
 * wait half a minute for it.
 */
const DECIDE_MS = 1000;
/**
 * Floor for the internal resolution, as a fraction of the preset's cap.
 *
 * This was 0.55, and 0.55 is why the game looked "low resolution": on a 1x
 * display it renders 55% of native and lets the browser stretch it back, which
 * softens every edge and every texture on screen. The scaler exists to protect
 * the frame rate, not to win an argument with it — a picture that is 20% smaller
 * is a compromise, a picture that is 45% smaller is a different, worse game.
 */
const MIN_SCALE = 0.8;
const MAX_SCALE = 1.0;

/**
 * Renderer settings plus adaptive resolution.
 *
 * The scaler is deliberately slow and sticky: it looks at a smoothed frame time,
 * decides twice a second, and moves in small steps. A scaler that reacts to a
 * single hitch spends the whole game oscillating, which is more distracting than
 * the low frame rate it was trying to fix.
 *
 * Resolution moves first, because it is the cheapest lever and the least
 * visible: a 10% drop in internal resolution is hard to see at 60 fps, while a
 * dropped shadow map is obvious. Only when resolution is already at its floor
 * does "Auto" step the whole preset down.
 */
export class RenderQuality {
  private level: QualityLevel = 'auto';
  private preset: QualityPreset = QUALITY_PRESETS.medium;
  /** Index into LADDER while the level is 'auto'. */
  private autoStep = 1;
  private scale = 1;
  private frameMs = 16.7;
  private sinceDecisionMs = 0;
  private enabled = true;

  constructor(
    private renderer: THREE.WebGLRenderer,
    /** Called when the internal resolution changed, so post targets can follow. */
    private onScaleChange: () => void,
    /**
     * Called when the preset itself changed — a new quality level, the shadow
     * toggle, or "Auto" stepping the whole ladder. Everything that has to be
     * rebuilt for it (shadow map, MSAA sample count) hangs off this one hook,
     * so there is exactly one place that can forget.
     */
    private onPresetChange: () => void
  ) {}

  public getLevel(): QualityLevel {
    return this.level;
  }

  public getPreset(): QualityPreset {
    return this.preset;
  }

  /** Current multiplier on the preset's pixel cap, `MIN_SCALE` … 1. */
  public getScale(): number {
    return this.scale;
  }

  public getPixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.preset.pixelCap) * this.scale;
  }

  /** The preset "Auto" has settled on, for the settings screen to report. */
  public getAutoStep(): string {
    return LADDER[this.autoStep];
  }

  /**
   * Smoothed frame interval in milliseconds.
   *
   * Other systems budget against it: the shadow pass caps itself at a share of
   * the frame rather than at a fixed number of milliseconds, because "rebuild
   * every 50 ms" is a third of the frame at 60 fps and *the whole frame* at
   * 20 fps — exactly backwards from what a slow machine needs.
   */
  public getFrameMs(): number {
    return this.frameMs;
  }

  public setLevel(level: QualityLevel): void {
    this.level = level;
    if (level === 'auto') {
      this.autoStep = 1;
      this.preset = QUALITY_PRESETS.medium;
    } else {
      this.preset = { ...QUALITY_PRESETS[level] };
    }
    // A fresh preset starts at full resolution and finds its own footing again;
    // carrying the old scale over would make switching to "high" a no-op on a
    // machine that had already dropped to 0.6.
    this.scale = 1;
    this.frameMs = 16.7;
    this.sinceDecisionMs = 0;
    this.onPresetChange();
    this.apply();
  }

  public setShadows(enabled: boolean): void {
    if (this.preset.shadows === enabled) return;
    this.preset = { ...this.preset, shadows: enabled };
    this.onPresetChange();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Pushes the current pixel ratio into the renderer and tells the caller. */
  public apply(): void {
    this.renderer.setPixelRatio(this.getPixelRatio());
    this.onScaleChange();
  }

  /**
   * One frame has passed.
   *
   * `frameMs` is the wall-clock time between frames, not the CPU time spent in
   * our own update: when the GPU is the bottleneck the browser blocks on the
   * swap, and the only place that shows up is the interval.
   */
  public tick(frameMs: number): void {
    if (!this.enabled) return;
    if (!Number.isFinite(frameMs) || frameMs <= 0) return;

    // Exponential average: one stalled frame (a map load, a garbage collection)
    // must not drop the resolution for the next half second.
    const sample = Math.min(frameMs, 100);
    this.frameMs = this.frameMs * 0.9 + sample * 0.1;

    this.sinceDecisionMs += sample;
    if (this.sinceDecisionMs < DECIDE_MS) return;
    this.sinceDecisionMs = 0;

    const slow = this.frameMs > SLOW_FRAME_MS;
    const fast = this.frameMs < FAST_FRAME_MS;

    if (slow && this.scale > MIN_SCALE) {
      this.scale = Math.max(MIN_SCALE, this.scale - 0.05);
      this.apply();
      return;
    }
    if (fast && this.scale < MAX_SCALE) {
      this.scale = Math.min(MAX_SCALE, this.scale + 0.05);
      this.apply();
      return;
    }

    // Resolution is already at a limit, so the only lever left is the preset —
    // and only "Auto" is allowed to touch it. The scale is reset when the preset
    // changes: a lighter preset can afford full resolution again, and leaving it
    // pinned at the floor would step down again on the very next decision, all
    // the way to "low" on a machine that only needed one nudge.
    if (this.level !== 'auto') return;
    if (slow && this.scale <= MIN_SCALE + 1e-3 && this.autoStep > 0) {
      this.autoStep--;
      this.preset = { ...QUALITY_PRESETS[LADDER[this.autoStep]] };
      this.scale = MAX_SCALE;
      this.onPresetChange();
      this.apply();
    } else if (fast && this.scale >= MAX_SCALE - 1e-3 && this.autoStep < LADDER.length - 1) {
      this.autoStep++;
      this.preset = { ...QUALITY_PRESETS[LADDER[this.autoStep]] };
      // Headroom for the heavier preset, or it would step back down immediately.
      this.scale = 0.85;
      this.onPresetChange();
      this.apply();
    }
  }
}
