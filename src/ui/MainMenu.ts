import { AudioEngine } from '../app/audio/AudioEngine';
import { CharacterStage } from './CharacterStage';
import { CHARACTERS, CharacterDef, characterFor, stepCharacter } from '../data/characters';
import { MAPS } from '../data/mapRegistry';

/**
 * The start screen: a character on the left, four ways in on the right.
 *
 * The two halves are one surface, not a card floating over the game. The left
 * half is a live portrait — the same model, rig and idle clip the hunt uses —
 * because a still image of twelve characters reads as a shop, and the point of
 * showing them at all is that you will be walking around inside that body.
 *
 * Paging is by arrow, not by a grid of avatars: a grid turns picking a character
 * into comparing twelve thumbnails, and this is not that game.
 */
export class MainMenu {
  private element: HTMLDivElement;
  private stageHost: HTMLDivElement | null = null;
  private stage: CharacterStage | null = null;
  private current: CharacterDef;
  private onPlayCallback: (() => void) | null = null;
  private onExitCallback: (() => void) | null = null;
  private onSettingsCallback: (() => void) | null = null;
  private onCharacterCallback: ((id: string) => void) | null = null;
  private audio = AudioEngine.getInstance();
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** Whether the screen is on display — the portrait is only built while it is. */
  private visible = false;
  /** Set once the game has told us who the player is. */
  private characterReady = false;

  constructor() {
    this.current = characterFor(null);
    this.element = document.createElement('div');
    this.element.id = 'main-menu-screen';
    this.element.className = 'screen-overlay start-overlay';
    this.render();
  }

  private render(): void {
    this.element.innerHTML = `
      <div class="start-screen">
        <div class="start-backdrop" id="start-backdrop" aria-hidden="true"></div>

        <section class="start-left">
          <div class="char-stage" id="char-stage">
            <div class="char-stage-loading" id="char-stage-loading">Loading</div>
          </div>

          <div class="char-nav">
            <button id="btn-char-prev" class="char-arrow interactive-ui" aria-label="Previous character">&lsaquo;</button>
            <button id="btn-char-next" class="char-arrow interactive-ui" aria-label="Next character">&rsaquo;</button>
          </div>
        </section>

        <section class="start-right">
          <div class="start-head">
            <span class="kicker">A hidden object hunt</span>
            <h1 class="game-title">Odd Objects</h1>
            <p class="game-subtitle">Five things in every place that do not belong.</p>
          </div>

          <div class="menu-actions start-actions">
            <button id="btn-play" class="btn btn-primary interactive-ui">Play</button>
            <p class="play-note"><span class="play-note-key">Next</span><span id="current-map-name">—</span></p>
            <button id="btn-controls" class="btn btn-outline interactive-ui">How to play</button>
            <button id="btn-settings" class="btn btn-outline interactive-ui">Settings</button>
            <button id="btn-credits" class="btn btn-outline interactive-ui">Credits</button>
          </div>

          <div class="start-foot">
            <button id="btn-exit" class="link-btn interactive-ui">Exit game</button>
            <span class="start-version">v0.1.0 &middot; Offline casual 3D</span>
          </div>
        </section>
      </div>

      <div id="controls-modal" class="controls-modal hidden">
        <div class="controls-sheet animate-pop">
          <span class="kicker">Manual</span>
          <h3>How to play</h3>
          <ul class="controls-list">
            <li><strong>W A S D</strong><span>Walk. Arrow keys work too.</span></li>
            <li><strong>Shift</strong><span>Swap between walking and running.</span></li>
            <li><strong>Space</strong><span>Jump.</span></li>
            <li><strong>C</strong><span>Crawl under low props. Tap again to stand.</span></li>
            <li><strong>Drag mouse</strong><span>Look around. Wheel zooms the camera.</span></li>
            <li><strong>E / click</strong><span>Pocket the object under the crosshair.</span></li>
            <li><strong>Tab</strong><span>Switch between objects within reach.</span></li>
            <li><strong>V</strong><span>First or third person.</span></li>
            <li><strong>Esc</strong><span>Pause. The clock stops with you.</span></li>
          </ul>
          <p class="mission-hint">
            <em>Every map hides five objects that do not belong to it &mdash; a toaster
            in a forest, a barrel in a chrome city. Walk close, put the crosshair on
            one, press E. You are told what they are only after you find them. Wrong
            object three times and the hunt is over. Stuck for five minutes? A vague
            hint appears.</em>
          </p>
          <button id="btn-close-controls" class="btn btn-small interactive-ui">Got it</button>
        </div>
      </div>

      <div id="credits-modal" class="controls-modal hidden">
        <div class="controls-sheet credits-sheet animate-pop">
          <span class="kicker">Credits</span>
          <h3>Who made what</h3>
          <p class="credits-note">
            Every map and every character is a free low-poly asset from
            <strong>Polyfork</strong>, used under CC BY 4.0. All of it is stored
            locally, so the game works with the network off.
          </p>
          <div class="credits-block">
            <span class="credits-label">Characters</span>
            <ul class="credits-list" id="credits-characters"></ul>
          </div>
          <div class="credits-block">
            <span class="credits-label">Maps</span>
            <p class="credits-line">${MAPS.length} kits &mdash; ${MAPS.map((m) =>
              escapeHtml(m.label)
            ).join(', ')}.</p>
          </div>
          <div class="credits-block">
            <span class="credits-label">Engine</span>
            <p class="credits-line">three.js &middot; Vite &middot; Tauri &middot; TypeScript</p>
          </div>
          <button id="btn-close-credits" class="btn btn-small interactive-ui">Close</button>
        </div>
      </div>
    `;

    this.stageHost = this.element.querySelector('#char-stage') as HTMLDivElement;
    this.bindEvents();
    this.renderCredits();
  }

  private renderCredits(): void {
    const chars = this.element.querySelector('#credits-characters');
    if (chars) {
      chars.innerHTML = CHARACTERS.map(
        (c) =>
          `<li><span>${escapeHtml(c.name)}</span><em>${escapeHtml(prettyAsset(c.id))}</em></li>`
      ).join('');
    }
  }

  private bindEvents(): void {
    this.element.querySelector('#btn-play')?.addEventListener('click', () => {
      this.audio.playClick();
      this.onPlayCallback?.();
    });

    this.element.querySelector('#btn-settings')?.addEventListener('click', () => {
      this.audio.playClick();
      this.onSettingsCallback?.();
    });

    this.element.querySelector('#btn-exit')?.addEventListener('click', () => {
      this.audio.playClick();
      this.onExitCallback?.();
    });

    const controlsModal = this.element.querySelector('#controls-modal');
    const creditsModal = this.element.querySelector('#credits-modal');

    this.element.querySelector('#btn-controls')?.addEventListener('click', () => {
      this.audio.playClick();
      controlsModal?.classList.remove('hidden');
    });
    this.element.querySelector('#btn-close-controls')?.addEventListener('click', () => {
      this.audio.playClick();
      controlsModal?.classList.add('hidden');
    });
    this.element.querySelector('#btn-credits')?.addEventListener('click', () => {
      this.audio.playClick();
      creditsModal?.classList.remove('hidden');
    });
    this.element.querySelector('#btn-close-credits')?.addEventListener('click', () => {
      this.audio.playClick();
      creditsModal?.classList.add('hidden');
    });

    // A click on the dimmed area behind a sheet closes it, the same as any other
    // modal. The check is on the backdrop element itself, so a click that lands
    // on the sheet — including its padding — does nothing.
    for (const modal of [controlsModal, creditsModal]) {
      modal?.addEventListener('click', (e) => {
        if (e.target !== modal) return;
        this.audio.playClick();
        modal.classList.add('hidden');
      });
    }

    this.element.querySelector('#btn-char-prev')?.addEventListener('click', () => this.page(-1));
    this.element.querySelector('#btn-char-next')?.addEventListener('click', () => this.page(1));
  }

  private page(step: number): void {
    this.audio.playClick();
    this.setCharacter(stepCharacter(this.current.id, step).id);
    this.onCharacterCallback?.(this.current.id);
  }

  /**
   * Shows a character and, if the menu is open, starts its portrait.
   *
   * Safe to call before the stage exists: the id is remembered and applied on
   * the first `show()`, which is how the saved choice survives a reload.
   */
  public setCharacter(id: string): void {
    this.current = characterFor(id);
    this.characterReady = true;
    if (!this.stage) {
      this.ensureStage();
      return;
    }
    void this.stage.setCharacter(this.current.id);
  }

  public get characterId(): string {
    return this.current.id;
  }

  /**
   * Sets the map the screen is standing in — the note under Play, and the
   * out-of-focus view behind everything.
   *
   * The backdrop is a still, not the live render. The game does keep rendering
   * the world behind the menu, but blurring a canvas that changes every frame
   * costs the compositor a full-screen pass per frame for something the player
   * is not looking at, and it goes black the moment the renderer resizes.
   *
   * It is also already blurred on disk (`tools/make-backdrops.mjs`, 320 px wide,
   * 3 kB each), so the menu runs no `filter` at all: a small bitmap stretched
   * over the screen *is* the blur, for none of the per-frame cost.
   */
  public setMap(id: string, label: string): void {
    const note = this.element.querySelector('#current-map-name');
    if (note) note.textContent = label;

    const backdrop = this.element.querySelector('#start-backdrop') as HTMLDivElement | null;
    if (!backdrop) return;
    const baked = `/maps/backdrop/${id}.jpg`;
    const cover = `/maps/${id}.jpg`;
    const probe = new Image();
    probe.onload = () => {
      backdrop.style.backgroundImage = `url("${baked}")`;
    };
    probe.onerror = () => {
      backdrop.style.backgroundImage = `url("${cover}")`;
    };
    probe.src = baked;
  }

  public show(): void {
    this.element.classList.remove('hidden');
    this.visible = true;
    if (this.stage) {
      this.stage.start();
    } else if (this.characterReady) {
      this.ensureStage();
    }
    // Otherwise wait for `setCharacter`, which `Game.initialize` calls once the
    // first map is in. `UIManager` attaches this screen while that load is
    // still running — tens of seconds on a slow machine — and building the
    // portrait here would load the *default* character and throw it away, which
    // at 1.5 s a model is a visible waste on every launch.
    this.bindKeys();
  }

  /** Builds the portrait once, and only while the menu is actually on screen. */
  private ensureStage(): void {
    if (this.stage || !this.stageHost || !this.visible) return;
    this.stage = new CharacterStage(this.stageHost);
    this.stage.start();
    // `finally`, not `then`: a model that fails to load must not leave the word
    // "Loading" sitting over an empty portrait for the rest of the session.
    void this.stage
      .setCharacter(this.current.id)
      .finally(() => this.element.querySelector('#char-stage-loading')?.remove());
  }

  public hide(): void {
    this.element.classList.add('hidden');
    this.visible = false;
    // Stopped, not disposed: the parsed GLBs stay in memory so paging back to a
    // character you have already seen is instant, and the context is not
    // re-created every time the player returns to the menu.
    this.stage?.stop();
    this.unbindKeys();
    this.element.querySelector('#controls-modal')?.classList.add('hidden');
    this.element.querySelector('#credits-modal')?.classList.add('hidden');
  }

  /**
   * Arrow keys page the roster while the start screen is up.
   *
   * Bound on `window` only while visible, and removed on hide: a listener that
   * outlives the screen would turn the arrow keys into a character switch in
   * the middle of a hunt.
   */
  private bindKeys(): void {
    if (this.keyHandler) return;
    this.keyHandler = (e: KeyboardEvent) => {
      if (this.element.classList.contains('hidden')) return;
      const open = this.element.querySelector('.controls-modal:not(.hidden)');
      if (open) return;
      if (e.key === 'ArrowLeft') {
        this.page(-1);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        this.page(1);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  private unbindKeys(): void {
    if (!this.keyHandler) return;
    window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
  }

  public onPlay(callback: () => void): void {
    this.onPlayCallback = callback;
  }

  public onExit(callback: () => void): void {
    this.onExitCallback = callback;
  }

  public onSettings(callback: () => void): void {
    this.onSettingsCallback = callback;
  }

  public onCharacter(callback: (id: string) => void): void {
    this.onCharacterCallback = callback;
  }

  public getElement(): HTMLElement {
    return this.element;
  }
}

/** `family-road-tripper-247570` → `Family Road-Tripper`. */
function prettyAsset(id: string): string {
  const name = id.replace(/-[0-9a-f]{6}$/i, '');
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
