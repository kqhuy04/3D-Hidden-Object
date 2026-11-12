import { RoundItem } from '../game/missions/RoundManager';
import { AudioEngine } from '../app/audio/AudioEngine';

export class ResultsScreen {
  private element: HTMLDivElement;
  private onRetryCallback: (() => void) | null = null;
  private onNextRoundCallback: (() => void) | null = null;
  private onMenuCallback: (() => void) | null = null;
  private audio = AudioEngine.getInstance();

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'results-screen';
    this.element.className = 'screen-overlay hidden';
    this.render();
  }

  private render(): void {
    this.element.innerHTML = `
      <div class="menu-card results-card animate-pop">
        <span id="results-kicker" class="kicker">Hunt complete</span>
        <h2 id="results-title" class="results-title">All found</h2>
        <div id="results-stars" class="stars-large">★★★★★</div>
        <p id="results-summary" class="results-summary"></p>

        <div class="results-stats">
          <div class="stat-box">
            <span class="stat-label">Objects</span>
            <span id="stat-objectives" class="stat-val">5 / 5</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Time</span>
            <span id="stat-time" class="stat-val">0:00</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Best</span>
            <span id="stat-best" class="stat-val">&mdash;</span>
          </div>
        </div>

        <span id="results-best-chip" class="best-chip hidden">New best</span>

        <ul id="results-objectives-list" class="results-list"></ul>

        <div class="menu-actions">
          <button id="btn-results-next" class="btn btn-primary interactive-ui">
            Play again
          </button>
          <button id="btn-results-retry" class="btn btn-secondary interactive-ui">
            Retry this map
          </button>
          <button id="btn-results-menu" class="btn btn-outline interactive-ui">
            Main menu
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const nextBtn = this.element.querySelector('#btn-results-next');
    nextBtn?.addEventListener('click', () => {
      this.audio.playClick();
      this.onNextRoundCallback?.();
    });

    const retryBtn = this.element.querySelector('#btn-results-retry');
    retryBtn?.addEventListener('click', () => {
      this.audio.playClick();
      this.onRetryCallback?.();
    });

    const menuBtn = this.element.querySelector('#btn-results-menu');
    menuBtn?.addEventListener('click', () => {
      this.audio.playClick();
      this.onMenuCallback?.();
    });
  }

  /**
   * @param bestSeconds fastest complete clear on this map, after this round was
   *   recorded. Null if it has never been cleared.
   * @param isNewBest true when this round set that record.
   */
  public showResults(
    isWon: boolean,
    found: number,
    total: number,
    elapsedLabel: string,
    items: RoundItem[],
    bestSeconds: number | null = null,
    isNewBest = false
  ): void {
    const titleEl = this.element.querySelector('#results-title');
    const kickerEl = this.element.querySelector('#results-kicker');
    const summaryEl = this.element.querySelector('#results-summary');
    const starsEl = this.element.querySelector('#results-stars');
    const statObjEl = this.element.querySelector('#stat-objectives');
    const statTimeEl = this.element.querySelector('#stat-time');
    const statBestEl = this.element.querySelector('#stat-best');
    const bestChip = this.element.querySelector('#results-best-chip');
    const listEl = this.element.querySelector('#results-objectives-list');

    if (titleEl) {
      titleEl.textContent = isWon ? 'All five found' : 'Out of tries';
    }
    if (kickerEl) {
      kickerEl.textContent = isWon ? 'Hunt complete' : 'Hunt ended';
    }
    if (summaryEl) {
      summaryEl.textContent = isWon
        ? `You cleared the map in ${elapsedLabel}. Nothing else here is out of place.`
        : `You found ${found} of ${total} objects before the third wrong one.`;
    }

    if (statBestEl) {
      statBestEl.textContent = bestSeconds == null ? '\u2014' : formatClock(bestSeconds);
    }
    bestChip?.classList.toggle('hidden', !isNewBest);

    let starStr = '';
    for (let i = 0; i < total; i++) {
      starStr += i < found ? '★' : '☆';
    }
    if (starsEl) {
      starsEl.textContent = starStr;
    }

    if (statObjEl) {
      statObjEl.textContent = `${found} / ${total}`;
    }
    if (statTimeEl) {
      statTimeEl.textContent = elapsedLabel;
    }

    if (listEl) {
      listEl.innerHTML = '';
      for (const item of items) {
        const li = document.createElement('li');
        li.className = `result-item ${item.found ? 'completed' : 'missed'}`;
        li.innerHTML = `
          <span>${item.found ? '&#10003;' : '&#10007;'}</span>
          <span>${item.found ? escapeHtml(item.placement.name) : 'Not found'}</span>
        `;
        listEl.appendChild(li);
      }
    }

    this.show();
  }

  public show(): void {
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public onRetry(callback: () => void): void {
    this.onRetryCallback = callback;
  }

  public onNextRound(callback: () => void): void {
    this.onNextRoundCallback = callback;
  }

  public onMenu(callback: () => void): void {
    this.onMenuCallback = callback;
  }

  public getElement(): HTMLElement {
    return this.element;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Seconds as `m:ss`, the same shape the HUD clock uses. */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
