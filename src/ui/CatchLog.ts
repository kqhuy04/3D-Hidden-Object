import { FISH, FishSpecies, rarityClass } from '../data/fishing';

/**
 * The catch log: every fish in the game, and which ones you have met.
 *
 * It is a screen rather than a menu page on purpose. A collection you have to
 * leave the map to look at is a collection you look at twice — once when it
 * fills up, and never again. This one opens over the map, on one key, and the
 * world is still there behind it when you close it.
 *
 * ## Why the pictures are files
 *
 * Sixteen models is sixteen megabytes, and the player presses this key while
 * standing in the middle of a hunt. The thumbnails are 192 px PNGs rendered
 * once by `tools/fish-thumbs.mjs` and shipped with the map, so opening the log
 * costs nothing but layout.
 *
 * An uncaught fish is the *same* picture with `brightness(0)` on it: a solid
 * black silhouette, which is the standard bargain a collection screen makes —
 * you can see the shape and not the animal. One file serves both states, and
 * the two can never disagree about which way a fish faces.
 */

export class CatchLog {
  private element: HTMLDivElement;
  private grid: HTMLDivElement;
  private countEl: HTMLSpanElement;
  private onCloseCallback: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'catch-log-screen';
    this.element.className = 'screen-overlay hidden';
    this.element.innerHTML = `
      <div class="catch-log-card">
        <div class="catch-log-head">
          <div>
            <span class="kicker">Catch log</span>
            <h2 class="catch-log-title">What you have landed</h2>
          </div>
          <span id="catch-log-count" class="catch-log-count"></span>
        </div>
        <div id="catch-log-grid" class="catch-log-grid"></div>
        <div class="catch-log-foot">
          <p class="catch-log-hint">Uncaught fish are shown as silhouettes.</p>
          <button id="btn-catch-log-close" class="btn btn-primary interactive-ui">Back</button>
        </div>
      </div>
    `;

    this.grid = this.element.querySelector('#catch-log-grid') as HTMLDivElement;
    this.countEl = this.element.querySelector('#catch-log-count') as HTMLSpanElement;
    this.element.querySelector('#btn-catch-log-close')?.addEventListener('click', () => {
      this.onCloseCallback?.();
    });
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public get isShowing(): boolean {
    return !this.element.classList.contains('hidden');
  }

  public onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  /**
   * Builds the grid from the save.
   *
   * Rebuilt rather than patched on every open: sixteen cells is less work than
   * the bookkeeping that would avoid it, and a cell that kept a stale "???"
   * after the fish was caught would be the sort of bug that survives a release.
   */
  public show(caught: Record<string, number>): void {
    this.element.classList.remove('hidden');
    this.grid.replaceChildren(...FISH.map((fish) => this.cell(fish, caught[fish.id] ?? 0)));

    const found = FISH.filter((fish) => (caught[fish.id] ?? 0) > 0).length;
    this.countEl.textContent = `${found} of ${FISH.length}`;
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  private cell(fish: FishSpecies, best: number): HTMLElement {
    const has = best > 0;
    const cell = document.createElement('div');
    cell.className = `catch-cell${has ? ' is-caught' : ''}`;
    cell.innerHTML = `
      <span class="catch-thumb${has ? '' : ' is-unknown'}">
        <img src="/assets/fish/thumbs/${fish.id}.png" alt="" draggable="false">
      </span>
      <span class="catch-name ${has ? rarityClass(fish.rarity) : 'rarity-unknown'}">
        ${has ? escapeHtml(fish.name) : '???'}
      </span>
      <span class="catch-meta">${has ? `${best.toFixed(1)} kg` : rarityLabel(fish)}</span>
    `;
    return cell;
  }
}

/** Rarity is printed under an uncaught fish: the shape is hidden, not the odds. */
function rarityLabel(fish: FishSpecies): string {
  return fish.rarity.charAt(0).toUpperCase() + fish.rarity.slice(1);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
