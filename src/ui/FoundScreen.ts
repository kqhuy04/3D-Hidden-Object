import * as THREE from 'three';
import { FoundStage } from './FoundStage';

/**
 * What the screen does when you find the right object.
 *
 * The game keeps running underneath — the player asked for a veil, not a pause
 * — so this is deliberately passive: no scrim that swallows clicks, no button,
 * no input of any kind. It fades up, holds long enough to read the name and see
 * the object turn, and leaves on its own.
 *
 * The blur is a `backdrop-filter` on the veil rather than a post-processing pass
 * in the renderer. This project has no composer and is not getting one; a
 * backdrop filter is the compositor's job, costs the game nothing to build, and
 * disappears with the element.
 */

/** How long the screen stays fully up, before the fade. */
const HOLD_MS = 2600;
/** Length of the fade, matched by `--found-fade` in the stylesheet. */
const FADE_MS = 460;

export class FoundScreen {
  private element: HTMLDivElement;
  private nameEl: HTMLParagraphElement;
  private countEl: HTMLParagraphElement;
  private stage: FoundStage;
  private holdTimer: number | null = null;
  private fadeTimer: number | null = null;
  private onHidden: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'found-screen';
    this.element.className = 'found-screen hidden';
    this.element.innerHTML = `
      <div class="found-card">
        <p class="found-title">Found</p>
        <div class="found-well"></div>
        <p class="found-name"></p>
        <p class="found-count"></p>
      </div>
    `;

    this.nameEl = this.element.querySelector('.found-name') as HTMLParagraphElement;
    this.countEl = this.element.querySelector('.found-count') as HTMLParagraphElement;
    const well = this.element.querySelector('.found-well') as HTMLDivElement;
    this.stage = new FoundStage(well);
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  /** True while the veil is up, so the caller can hold off anything that would
   *  draw attention to the screen it is covering. */
  public get isShowing(): boolean {
    return !this.element.classList.contains('hidden');
  }

  /**
   * Shows the object and says what it is.
   *
   * `object` is the real thing out of the map; this screen owns it from here and
   * frees it when the veil goes. Finding a second object while the first is
   * still up restarts the whole thing rather than stacking.
   */
  public show(
    object: THREE.Object3D,
    name: string,
    found: number,
    total: number,
    onHidden?: () => void
  ): void {
    this.clearTimers();
    this.onHidden = onHidden ?? null;

    // Unhidden first: the stage measures its well, and a `display: none`
    // element measures zero.
    this.element.classList.remove('hidden', 'is-leaving');

    this.nameEl.textContent = name;
    this.countEl.textContent = `${found} of ${total}`;
    this.stage.show(object);

    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = null;
      this.element.classList.add('is-leaving');
      this.fadeTimer = window.setTimeout(() => {
        this.fadeTimer = null;
        this.hide();
      }, FADE_MS);
    }, HOLD_MS);
  }

  public hide(): void {
    this.clearTimers();
    this.element.classList.add('hidden');
    this.element.classList.remove('is-leaving');
    this.stage.hide();
    const done = this.onHidden;
    this.onHidden = null;
    done?.();
  }

  private clearTimers(): void {
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    if (this.fadeTimer !== null) window.clearTimeout(this.fadeTimer);
    this.holdTimer = null;
    this.fadeTimer = null;
  }

  public dispose(): void {
    this.clearTimers();
    this.stage.dispose();
    this.element.remove();
  }
}
