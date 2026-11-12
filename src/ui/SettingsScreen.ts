import { AudioEngine } from '../app/audio/AudioEngine';
import { DEFAULT_SETTINGS, Settings, QualityLevel } from '../app/Storage';

/**
 * The options sheet.
 *
 * It is a *view*: it reports what the player chose and lets the game decide
 * what to do with it, for the same reason the map picker is one — the settings
 * have to be applied to a renderer, a camera and an audio graph that this class
 * does not own.
 *
 * Everything is persisted by the caller, so closing the tab and coming back
 * does not cost the player their sensitivity a second time.
 */
export class SettingsScreen {
  private element: HTMLDivElement;
  private qualityButtons: HTMLButtonElement[] = [];
  private qualityNote: HTMLSpanElement;
  private shadowsButton: HTMLButtonElement;
  private fpsButton: HTMLButtonElement;
  private fovInput: HTMLInputElement;
  private fovValue: HTMLSpanElement;
  private sensitivityInput: HTMLInputElement;
  private sensitivityValue: HTMLSpanElement;
  private volumeInput: HTMLInputElement;
  private volumeValue: HTMLSpanElement;
  private resetButton: HTMLButtonElement;

  private current: Settings = { ...DEFAULT_SETTINGS };
  private autoStep = 'medium';

  private onChangeCallback: ((patch: Partial<Settings>, persist: boolean) => void) | null = null;
  private onResetCallback: (() => void) | null = null;
  private onCloseCallback: (() => void) | null = null;

  private resetArmed = false;
  private resetTimer = 0;
  private audio = AudioEngine.getInstance();

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'settings-screen';
    this.element.className = 'screen-overlay hidden';
    this.element.innerHTML = `
      <div class="settings-card animate-pop">
        <span class="kicker">Options</span>
        <h2 class="menu-title">Settings</h2>
        <p class="menu-hint">Kept for next time. Everything here is reversible.</p>

        <div class="settings-rows">
          <div class="settings-row">
            <div class="settings-label">
              <span class="settings-name">Quality</span>
              <span class="settings-note" id="settings-quality-note">Auto picks as you play</span>
            </div>
            <div class="segmented" role="group" aria-label="Quality">
              <button type="button" class="seg is-active" data-quality="auto">Auto</button>
              <button type="button" class="seg" data-quality="low">Low</button>
              <button type="button" class="seg" data-quality="medium">Medium</button>
              <button type="button" class="seg" data-quality="high">High</button>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-label">
              <span class="settings-name">Shadows</span>
              <span class="settings-note">The most expensive thing on screen</span>
            </div>
            <button type="button" class="switch" id="settings-shadows" role="switch" aria-checked="true">
              <span class="switch-track"></span>
              <span class="switch-word">On</span>
            </button>
          </div>

          <div class="settings-row">
            <div class="settings-label">
              <span class="settings-name">Field of view</span>
              <span class="settings-note">Wider sees more and shrinks the world</span>
            </div>
            <div class="settings-slider">
              <input id="settings-fov" class="range" type="range" min="55" max="85" step="1" value="62" aria-label="Field of view" />
              <span class="settings-value" id="settings-fov-value">62&deg;</span>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-label">
              <span class="settings-name">Look speed</span>
              <span class="settings-note">How far the view turns per pixel dragged</span>
            </div>
            <div class="settings-slider">
              <input id="settings-sensitivity" class="range" type="range" min="0.4" max="2.5" step="0.1" value="1" aria-label="Look speed" />
              <span class="settings-value" id="settings-sensitivity-value">1.0&times;</span>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-label">
              <span class="settings-name">Volume</span>
              <span class="settings-note">Clicks, chimes and the shutter</span>
            </div>
            <div class="settings-slider">
              <input id="settings-volume" class="range" type="range" min="0" max="1" step="0.05" value="0.85" aria-label="Volume" />
              <span class="settings-value" id="settings-volume-value">85%</span>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-label">
              <span class="settings-name">Frame counter</span>
              <span class="settings-note">Shows the frame rate while you play</span>
            </div>
            <button type="button" class="switch" id="settings-fps" role="switch" aria-checked="false">
              <span class="switch-track"></span>
              <span class="switch-word">Off</span>
            </button>
          </div>
        </div>

        <div class="settings-foot">
          <button type="button" class="btn btn-quiet interactive-ui" id="btn-settings-reset">
            Reset progress
          </button>
          <button type="button" class="btn btn-primary interactive-ui" id="btn-settings-back">
            Back
          </button>
        </div>
      </div>
    `;

    this.qualityNote = this.element.querySelector('#settings-quality-note') as HTMLSpanElement;
    this.shadowsButton = this.element.querySelector('#settings-shadows') as HTMLButtonElement;
    this.fpsButton = this.element.querySelector('#settings-fps') as HTMLButtonElement;
    this.fovInput = this.element.querySelector('#settings-fov') as HTMLInputElement;
    this.fovValue = this.element.querySelector('#settings-fov-value') as HTMLSpanElement;
    this.sensitivityInput = this.element.querySelector('#settings-sensitivity') as HTMLInputElement;
    this.sensitivityValue = this.element.querySelector('#settings-sensitivity-value') as HTMLSpanElement;
    this.volumeInput = this.element.querySelector('#settings-volume') as HTMLInputElement;
    this.volumeValue = this.element.querySelector('#settings-volume-value') as HTMLSpanElement;
    this.resetButton = this.element.querySelector('#btn-settings-reset') as HTMLButtonElement;
    this.qualityButtons = Array.from(
      this.element.querySelectorAll<HTMLButtonElement>('.seg')
    );

    this.bindEvents();
  }

  private bindEvents(): void {
    for (const button of this.qualityButtons) {
      button.addEventListener('click', () => {
        const level = button.dataset.quality as QualityLevel | undefined;
        if (!level) return;
        this.audio.playClick();
        this.emit({ quality: level });
      });
    }

    this.shadowsButton.addEventListener('click', () => {
      this.audio.playClick();
      this.emit({ shadows: !this.current.shadows });
    });

    this.fpsButton.addEventListener('click', () => {
      this.audio.playClick();
      this.emit({ showFps: !this.current.showFps });
    });

    // Sliders report continuously so the effect is felt while dragging — a
    // sensitivity you have to close a menu to test is a sensitivity nobody
    // tunes. Only the release is persisted, so dragging does not write to
    // localStorage sixty times a second.
    this.fovInput.addEventListener('input', () => {
      this.fovValue.textContent = `${this.fovInput.value}\u00b0`;
      this.emit({ fov: Number(this.fovInput.value) }, false);
    });
    this.fovInput.addEventListener('change', () => {
      this.emit({ fov: Number(this.fovInput.value) }, true);
    });

    this.sensitivityInput.addEventListener('input', () => {
      this.sensitivityValue.textContent = `${Number(this.sensitivityInput.value).toFixed(1)}\u00d7`;
      this.emit({ sensitivity: Number(this.sensitivityInput.value) }, false);
    });
    this.sensitivityInput.addEventListener('change', () => {
      this.emit({ sensitivity: Number(this.sensitivityInput.value) }, true);
    });

    this.volumeInput.addEventListener('input', () => {
      this.volumeValue.textContent = `${Math.round(Number(this.volumeInput.value) * 100)}%`;
      this.emit({ volume: Number(this.volumeInput.value) }, false);
    });
    this.volumeInput.addEventListener('change', () => {
      this.emit({ volume: Number(this.volumeInput.value) }, true);
    });

    // Resetting progress throws away every cleared map, which is the one thing
    // in this menu that cannot be undone by moving a slider back. Two clicks.
    this.resetButton.addEventListener('click', () => {
      this.audio.playClick();
      if (!this.resetArmed) {
        this.armReset();
        return;
      }
      this.disarmReset();
      this.onResetCallback?.();
    });

    this.element.querySelector('#btn-settings-back')?.addEventListener('click', () => {
      this.audio.playClick();
      this.onCloseCallback?.();
    });
  }

  private armReset(): void {
    this.resetArmed = true;
    this.resetButton.textContent = 'Erase all records?';
    this.resetButton.classList.add('is-armed');
    window.clearTimeout(this.resetTimer);
    this.resetTimer = window.setTimeout(() => this.disarmReset(), 4000);
  }

  private disarmReset(): void {
    this.resetArmed = false;
    this.resetButton.textContent = 'Reset progress';
    this.resetButton.classList.remove('is-armed');
    window.clearTimeout(this.resetTimer);
  }

  private emit(patch: Partial<Settings>, persist = true): void {
    this.current = { ...this.current, ...patch };
    this.sync();
    this.onChangeCallback?.(patch, persist);
  }

  /**
   * Paints the controls from `current`.
   *
   * Called after every change and on open, so the screen and the saved values
   * cannot drift: the only state is `current`, and it is always the truth.
   */
  private sync(): void {
    for (const button of this.qualityButtons) {
      button.classList.toggle('is-active', button.dataset.quality === this.current.quality);
    }
    this.qualityNote.textContent =
      this.current.quality === 'auto' ? `Auto — running at ${this.autoStep}` : 'Fixed';

    this.setSwitch(this.shadowsButton, this.current.shadows, 'On', 'Off');
    this.setSwitch(this.fpsButton, this.current.showFps, 'On', 'Off');

    this.fovInput.value = String(this.current.fov);
    this.fovValue.textContent = `${Math.round(this.current.fov)}\u00b0`;

    this.sensitivityInput.value = String(this.current.sensitivity);
    this.sensitivityValue.textContent = `${this.current.sensitivity.toFixed(1)}\u00d7`;

    this.volumeInput.value = String(this.current.volume);
    this.volumeValue.textContent = `${Math.round(this.current.volume * 100)}%`;
  }

  private setSwitch(button: HTMLButtonElement, on: boolean, onWord: string, offWord: string): void {
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-checked', on ? 'true' : 'false');
    const word = button.querySelector('.switch-word');
    if (word) word.textContent = on ? onWord : offWord;
  }

  public show(settings: Settings, autoStep: string): void {
    this.current = { ...settings };
    this.autoStep = autoStep;
    this.disarmReset();
    this.sync();
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.disarmReset();
    this.element.classList.add('hidden');
  }

  public get isOpen(): boolean {
    return !this.element.classList.contains('hidden');
  }

  /** Re-reports which preset "Auto" has settled on, while the sheet is open. */
  public setAutoStep(step: string): void {
    if (step === this.autoStep) return;
    this.autoStep = step;
    if (this.current.quality === 'auto') this.sync();
  }

  public onChange(callback: (patch: Partial<Settings>, persist: boolean) => void): void {
    this.onChangeCallback = callback;
  }

  public onReset(callback: () => void): void {
    this.onResetCallback = callback;
  }

  public onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  public getElement(): HTMLElement {
    return this.element;
  }
}
