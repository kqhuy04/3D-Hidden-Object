import { RoundItem } from '../game/missions/RoundManager';
import { AudioEngine } from '../app/audio/AudioEngine';

/**
 * In-game HUD for the hunt.
 *
 * The photo mode's viewfinder, shutter button and flash are gone: there is
 * nothing to frame any more, only things to notice. What replaced them is a
 * crosshair for aiming at an object, a prompt that appears when one is in reach,
 * and a list of five slots that read `???` until each object is found.
 */
export class GameHUD {
  private element: HTMLDivElement;
  private feedbackBanner: HTMLDivElement;
  private timerDisplay: HTMLSpanElement;
  private counterDisplay: HTMLSpanElement;
  private itemsContainer: HTMLUListElement;
  private briefText: HTMLParagraphElement;
  private hintBox: HTMLDivElement;
  private hintText: HTMLSpanElement;
  private pickupPrompt: HTMLDivElement;
  private pickupCycle: HTMLSpanElement;
  private strikesBox: HTMLDivElement;
  private pauseBtn: HTMLButtonElement;
  private viewBtn: HTMLButtonElement;
  private reticle: HTMLDivElement;
  private fpsChip: HTMLDivElement;
  private fpsValue: HTMLSpanElement;
  /** Last strings written, so a per-frame update can skip the DOM. */
  private lastTimerLabel = '';
  private lastFpsLabel = '';

  private onPauseCallback: (() => void) | null = null;
  private onViewCallback: (() => void) | null = null;
  private feedbackTimeout: number | null = null;
  private audio = AudioEngine.getInstance();

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'game-hud';
    this.element.className = 'hud-container';

    this.element.innerHTML = `
      <!-- Top Left: what is still missing -->
      <div class="hud-panel hud-top-left">
        <div class="panel-header">
          <span class="panel-title">Odd objects</span>
          <span id="hud-counter" class="panel-counter">0 / 5</span>
        </div>
        <p id="hud-brief" class="panel-brief"></p>
        <ul id="hud-objectives-list" class="objectives-list">
          <li class="objective-item pending">
            <span class="obj-index">01</span>
            <span class="obj-text">???</span>
            <span class="obj-check">&#10003;</span>
          </li>
        </ul>
        <div id="hud-hint" class="hud-hint hidden">
          <span class="hint-label">HINT</span>
          <span id="hud-hint-text"></span>
        </div>
      </div>

      <!-- Top Center: time spent hunting, and how many wrong guesses are left -->
      <div class="hud-panel hud-top-center">
        <div class="timer-badge">
          <span id="hud-timer-display" class="timer-value">0:00</span>
        </div>
        <div id="hud-strikes" class="strikes" title="Wrong objects left before the hunt ends">
          <span class="strikes-label">MISTAKES</span>
          <span class="strikes-pips">
            <span class="strike-pip"></span>
            <span class="strike-pip"></span>
            <span class="strike-pip"></span>
          </span>
        </div>
      </div>

      <!-- Top Right: view toggle and pause -->
      <div class="hud-panel hud-top-right">
        <button id="btn-hud-view" class="btn-icon-pause interactive-ui view-toggle" title="First / third person (V)">
          3P
        </button>
        <button id="btn-hud-pause" class="btn-icon-pause interactive-ui" title="Pause Game (ESC)">
          II
        </button>
      </div>

      <!-- Centre: aiming reticle -->
      <div class="aim-reticle">
        <div class="ch-line-h"></div>
        <div class="ch-line-v"></div>
        <div class="ch-dot"></div>
      </div>

      <!-- Appears when something is within arm's reach -->
      <div id="hud-pickup-prompt" class="pickup-prompt hidden">
        <span class="key-cap">E</span>
        <span class="pickup-label">Pick up</span>
        <span class="pickup-alt">or click</span>
        <span id="hud-pickup-cycle" class="pickup-cycle hidden">
          <span class="key-cap key-cap-small">TAB</span> switch
        </span>
      </div>

      <!-- Feedback toast -->
      <div id="hud-feedback-banner" class="feedback-banner hidden">
        <span id="feedback-text"></span>
      </div>

      <!-- Frame rate, off by default. Same paper chip as the controls hint. -->
      <div id="hud-fps" class="hud-fps hidden">
        <span id="hud-fps-value">60</span>
        <span class="hud-fps-unit">fps</span>
      </div>

      <!-- Bottom bar -->
      <div class="hud-bottom-bar">
        <div class="controls-hint">
          <span><strong>WASD</strong> Walk</span>
          <span><strong>SHIFT</strong> Run</span>
          <span><strong>SPACE</strong> Jump</span>
          <span><strong>E</strong> Pick up</span>
          <span><strong>TAB</strong> Switch</span>
          <span><strong>C</strong> Crawl</span>
          <span><strong>V</strong> View</span>
          <span><strong>DRAG</strong> Look</span>
          <span><strong>WHEEL</strong> Zoom</span>
        </div>
      </div>
    `;

    this.timerDisplay = this.element.querySelector('#hud-timer-display')!;
    this.counterDisplay = this.element.querySelector('#hud-counter')!;
    this.itemsContainer = this.element.querySelector('#hud-objectives-list')!;
    this.briefText = this.element.querySelector('#hud-brief')!;
    this.hintBox = this.element.querySelector('#hud-hint')!;
    this.hintText = this.element.querySelector('#hud-hint-text')!;
    this.feedbackBanner = this.element.querySelector('#hud-feedback-banner')!;
    this.pickupPrompt = this.element.querySelector('#hud-pickup-prompt')!;
    this.pickupCycle = this.element.querySelector('#hud-pickup-cycle')!;
    this.strikesBox = this.element.querySelector('#hud-strikes')!;
    this.pauseBtn = this.element.querySelector('#btn-hud-pause')!;
    this.viewBtn = this.element.querySelector('#btn-hud-view')!;
    this.reticle = this.element.querySelector('.aim-reticle')!;
    this.fpsChip = this.element.querySelector('#hud-fps')!;
    this.fpsValue = this.element.querySelector('#hud-fps-value')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playClick();
      this.onPauseCallback?.();
    });

    this.viewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.playClick();
      this.onViewCallback?.();
    });
  }

  /** `3P` / `1P` on the toggle, so the button also reports the current view. */
  public setViewMode(firstPerson: boolean): void {
    this.viewBtn.textContent = firstPerson ? '1P' : '3P';
    this.viewBtn.classList.toggle('is-first', firstPerson);
  }

  public onViewToggle(callback: () => void): void {
    this.onViewCallback = callback;
  }

  /** One line of flavour at the top of the list, set per map. */
  public setBrief(text: string): void {
    this.briefText.textContent = text;
  }

  public updateTimer(label: string, freeRoam = false): void {
    // A map without a hunt has nothing to time.
    const text = freeRoam ? 'Free roam' : label;
    // Called sixty times a second, and the label only changes once a second.
    // Writing identical text to a live node still costs a style invalidation
    // on the containing layer, which is the sort of thing that shows up as a
    // constant 1.5 ms of layout on a phone.
    if (text === this.lastTimerLabel) return;
    this.lastTimerLabel = text;
    this.timerDisplay.textContent = text;
  }

  /** Turns the frame-rate chip on or off. */
  public setFpsVisible(visible: boolean): void {
    this.fpsChip.classList.toggle('hidden', !visible);
    if (!visible) this.lastFpsLabel = '';
  }

  /** Frame rate readout. Rounded, and only rewritten when the number changes. */
  public updateFps(fps: number): void {
    if (!Number.isFinite(fps) || fps <= 0) return;
    const rounded = Math.round(fps);
    const text = String(Math.min(999, rounded));
    if (text === this.lastFpsLabel) return;
    this.lastFpsLabel = text;
    this.fpsValue.textContent = text;
    // Below 45 the chip turns rust: the number is only on screen because the
    // player suspects something, so it should agree with them at a glance.
    this.fpsChip.classList.toggle('is-low', rounded < 45);
  }

  /**
   * Renders the five slots. A missing object is `???` — the point of the hunt is
   * to notice something that does not belong, not to shop for a list of names.
   */
  public updateItems(items: RoundItem[]): void {
    this.itemsContainer.innerHTML = '';

    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'objective-item note';
      li.innerHTML = `
        <span class="obj-index">&mdash;</span>
        <span class="obj-text">Nothing to find here &mdash; free roam</span>
        <span class="obj-check"></span>
      `;
      this.itemsContainer.appendChild(li);
      this.counterDisplay.textContent = '';
      return;
    }

    // Numbered slots, not bullets: five rows that all read `???` still need to
    // look like five distinct things, and the number is what does that. The tick
    // is always in the DOM and only becomes visible on a found row, so a row
    // never changes width when it flips.
    items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = `objective-item ${item.found ? 'completed' : 'pending'}`;
      li.innerHTML = `
        <span class="obj-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="obj-text">${item.found ? escapeHtml(item.placement.name) : '???'}</span>
        <span class="obj-check">&#10003;</span>
      `;
      this.itemsContainer.appendChild(li);
    });

    const found = items.filter((i) => i.found).length;
    this.counterDisplay.textContent = `${found} / ${items.length}`;
  }

  /** The five-minute nudge, shown inside the list panel. */
  public showHint(text: string): void {
    this.hintText.textContent = text;
    this.hintBox.classList.remove('hidden');
  }

  public hideHint(): void {
    this.hintBox.classList.add('hidden');
  }

  /**
   * Shown while an object is close enough and under the crosshair.
   *
   * `canCycle` adds the TAB hint. It appears only when there is actually more
   * than one thing in reach: a hint to switch between one object is noise, and
   * a permanent hint trains the player to stop reading it.
   */
  public setPickupPrompt(visible: boolean, canCycle = false): void {
    this.pickupPrompt.classList.toggle('hidden', !visible);
    this.pickupCycle.classList.toggle('hidden', !visible || !canCycle);
    // The reticle is the "you are on target" signal; it opens up and turns rust
    // the moment something is in reach, a beat before the label is read.
    this.reticle.classList.toggle('is-active', visible);
  }

  /**
   * The mistake counter: one pip per wrong object still allowed.
   *
   * Pips rather than a number because the number is only ever 1, 2 or 3, and a
   * pip the player watches go dark is felt without being read.
   */
  public setStrikes(strikes: number, max: number): void {
    const pips = this.strikesBox.querySelectorAll('.strike-pip');
    pips.forEach((pip, index) => {
      pip.classList.toggle('spent', index < strikes);
    });
    this.strikesBox.classList.toggle('critical', strikes >= max - 1);
    this.strikesBox.classList.toggle('hidden', max === 0);
  }

  public showFeedback(message: string, isSuccess: boolean): void {
    if (this.feedbackTimeout) {
      window.clearTimeout(this.feedbackTimeout);
    }

    const textEl = this.feedbackBanner.querySelector('#feedback-text');
    if (textEl) {
      textEl.textContent = message;
    }

    // No entry animation: a banner that starts at zero opacity is a banner that
    // is invisible until the animation clock gets a frame, and the machines that
    // drop frames are exactly the ones where "3 MISTAKES LEFT" matters. It
    // appears, fully opaque, and leaves on its timer.
    this.feedbackBanner.className = `feedback-banner ${isSuccess ? 'success' : 'failure'}`;
    this.feedbackBanner.classList.remove('hidden');

    this.feedbackTimeout = window.setTimeout(() => {
      this.feedbackBanner.classList.add('hidden');
    }, 2400);
  }

  public show(): void {
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
    this.setPickupPrompt(false);
  }

  public onPause(callback: () => void): void {
    this.onPauseCallback = callback;
  }

  public getElement(): HTMLElement {
    return this.element;
  }
}

/** Object names come from the data file, but they are still injected as HTML. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
