import { AudioEngine } from '../app/audio/AudioEngine';

export class PauseMenu {
  private element: HTMLDivElement;
  private onResumeCallback: (() => void) | null = null;
  private onRetryCallback: (() => void) | null = null;
  private onMenuCallback: (() => void) | null = null;
  private onMapSelectCallback: (() => void) | null = null;
  private onSettingsCallback: (() => void) | null = null;
  private audio = AudioEngine.getInstance();

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'pause-menu-screen';
    this.element.className = 'screen-overlay hidden';
    this.render();
  }

  private render(): void {
    this.element.innerHTML = `
      <div class="menu-card animate-pop">
        <span class="kicker">Hunt suspended</span>
        <h2 class="menu-title">Paused</h2>
        <p class="menu-hint">The clock is stopped. Take a breather or change your route.</p>

        <div class="menu-actions">
          <button id="btn-pause-resume" class="btn btn-primary interactive-ui">
            Resume
          </button>
          <button id="btn-pause-map" class="btn btn-secondary interactive-ui">
            Change map
          </button>
          <button id="btn-pause-retry" class="btn btn-outline interactive-ui">
            Retry this round
          </button>
          <button id="btn-pause-settings" class="btn btn-outline interactive-ui">
            Settings
          </button>
          <button id="btn-pause-menu" class="btn btn-outline interactive-ui">
            Main menu
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const resumeBtn = this.element.querySelector('#btn-pause-resume');
    resumeBtn?.addEventListener('click', () => {
      this.audio.playClick();
      this.onResumeCallback?.();
    });

    const mapBtn = this.element.querySelector('#btn-pause-map');
    mapBtn?.addEventListener('click', () => {
      this.audio.playClick();
      this.onMapSelectCallback?.();
    });

    const retryBtn = this.element.querySelector('#btn-pause-retry');
    retryBtn?.addEventListener('click', () => {
      this.audio.playClick();
      this.onRetryCallback?.();
    });

    const menuBtn = this.element.querySelector('#btn-pause-menu');
    menuBtn?.addEventListener('click', () => {
      this.audio.playClick();
      this.onMenuCallback?.();
    });

    const settingsBtn = this.element.querySelector('#btn-pause-settings');
    settingsBtn?.addEventListener('click', () => {
      this.audio.playClick();
      this.onSettingsCallback?.();
    });
  }

  public show(): void {
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public onResume(callback: () => void): void {
    this.onResumeCallback = callback;
  }

  public onRetry(callback: () => void): void {
    this.onRetryCallback = callback;
  }

  public onMenu(callback: () => void): void {
    this.onMenuCallback = callback;
  }

  public onMapSelect(callback: () => void): void {
    this.onMapSelectCallback = callback;
  }

  public onSettings(callback: () => void): void {
    this.onSettingsCallback = callback;
  }

  public getElement(): HTMLElement {
    return this.element;
  }
}
