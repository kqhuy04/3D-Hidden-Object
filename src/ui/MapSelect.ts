import { AudioEngine } from '../app/audio/AudioEngine';
import { MAPS, MapEntry } from '../data/mapRegistry';
import { HIDDEN_ITEMS } from '../data/hiddenItems';
import { MapRecord } from '../app/Storage';

/** Cards per page: two rows of three. */
const PER_PAGE = 6;
const COLUMNS = 3;

/**
 * Map browser: every map the build knows about, as a card you can click.
 *
 * It is a *view*, not a router — it reports the chosen id and lets the game
 * decide what to do with it, because loading a map is the game's job (unload,
 * rebuild collision, place the body). Keeping the two apart is what makes it
 * safe to open the picker from the pause menu while a round is running.
 *
 * ## Why it pages instead of scrolling
 *
 * Twenty-one maps in a scrolling column is a list; twenty-one maps seen six at
 * a time is a catalogue. The difference is that a page has a bottom, so the
 * player can see how much of the game is left without dragging a scrollbar, and
 * the picture at the top of each card becomes the thing they choose by rather
 * than a caption under a name. Six is the most that still fits two rows at a
 * legible thumbnail size on a 1280 × 800 window.
 */
export class MapSelect {
  private element: HTMLDivElement;
  private grid: HTMLDivElement;
  private pagerLabel: HTMLSpanElement;
  private prevButton: HTMLButtonElement;
  private nextButton: HTMLButtonElement;
  private currentId = '';
  private records: Record<string, MapRecord> = {};
  private page = 0;
  private busy = false;
  private onSelectCallback: ((id: string) => void) | null = null;
  private onCloseCallback: (() => void) | null = null;
  private audio = AudioEngine.getInstance();

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'map-select-screen';
    this.element.className = 'screen-overlay map-overlay hidden';
    this.element.innerHTML = `
      <div class="map-screen animate-pop">
        <header class="map-screen-head">
          <div class="map-screen-title-block">
            <span class="kicker">${MAPS.length} places</span>
            <h2 class="map-screen-title">Choose a map</h2>
            <p class="map-screen-hint">Every map is walkable &mdash; collision is built from its own geometry.</p>
          </div>
          <button id="btn-map-close" class="btn btn-outline interactive-ui">
            <span class="btn-icon">&larr;</span> Back
          </button>
        </header>

        <div class="map-grid" id="map-grid"></div>

        <footer class="map-screen-foot">
          <span class="map-foot-note" id="map-foot-note"></span>
          <div class="map-pager">
            <button id="btn-map-prev" class="pager-btn interactive-ui" aria-label="Previous page">&lsaquo;</button>
            <span class="map-pager-label" id="map-pager-label">1 / 1</span>
            <button id="btn-map-next" class="pager-btn interactive-ui" aria-label="Next page">&rsaquo;</button>
          </div>
        </footer>
      </div>
    `;

    this.grid = this.element.querySelector('#map-grid') as HTMLDivElement;
    this.pagerLabel = this.element.querySelector('#map-pager-label') as HTMLSpanElement;
    this.prevButton = this.element.querySelector('#btn-map-prev') as HTMLButtonElement;
    this.nextButton = this.element.querySelector('#btn-map-next') as HTMLButtonElement;
    this.bindEvents();
  }

  private get pageCount(): number {
    return Math.max(1, Math.ceil(MAPS.length / PER_PAGE));
  }

  private bindEvents(): void {
    this.element.querySelector('#btn-map-close')?.addEventListener('click', () => {
      this.audio.playClick();
      this.onCloseCallback?.();
    });

    this.prevButton.addEventListener('click', () => {
      if (this.page === 0) return;
      this.audio.playClick();
      this.page--;
      this.renderPage();
    });

    this.nextButton.addEventListener('click', () => {
      if (this.page >= this.pageCount - 1) return;
      this.audio.playClick();
      this.page++;
      this.renderPage();
    });
  }

  /**
   * Opens on the page holding the map the player is already in.
   *
   * The alternative — always opening on page one — means a player who is in the
   * eleventh place has to page through ten they have already finished before
   * they can see where they are.
   */
  public render(currentId: string, records: Record<string, MapRecord> = {}): void {
    this.currentId = currentId;
    this.records = records;

    const index = MAPS.findIndex((map) => map.id === currentId);
    this.page = index >= 0 ? Math.floor(index / PER_PAGE) : 0;
    this.renderPage();
  }

  private renderPage(): void {
    this.grid.innerHTML = '';

    const start = this.page * PER_PAGE;
    const pageMaps = MAPS.slice(start, start + PER_PAGE);

    for (const map of pageMaps) {
      this.grid.appendChild(this.buildCard(map));
    }

    // Keep the grid three columns wide on the last page rather than letting the
    // two remaining cards stretch to fill it.
    for (let i = pageMaps.length; i < Math.min(PER_PAGE, COLUMNS); i++) {
      const filler = document.createElement('span');
      filler.className = 'map-card-filler';
      this.grid.appendChild(filler);
    }

    this.pagerLabel.textContent = `${this.page + 1} / ${this.pageCount}`;
    this.prevButton.disabled = this.page === 0;
    this.nextButton.disabled = this.page >= this.pageCount - 1;

    const footNote = this.element.querySelector('#map-foot-note');
    if (footNote) {
      const cleared = MAPS.filter((m) => (this.records[m.id]?.found ?? 0) >= 5).length;
      footNote.textContent = `${cleared} of ${MAPS.length} cleared`;
    }
  }

  private buildCard(map: MapEntry): HTMLButtonElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'map-card interactive-ui';
    card.dataset.mapId = map.id;
    if (map.id === this.currentId) card.classList.add('is-current');

    const record = this.records[map.id];
    const found = record?.found ?? 0;
    const cleared = found >= 5;
    if (cleared) card.classList.add('is-cleared');

    const recordLine = found > 0
      ? `<span class="map-card-record">${cleared ? 'Cleared' : `${found} of 5 found`}${
          record?.bestSeconds != null ? ` &middot; ${formatClock(record.bestSeconds)}` : ''
        }</span>`
      : '';

    card.innerHTML = `
      <span class="map-card-frame">
        <img class="map-card-image" src="${escapeHtml(thumbnail(map.id))}" alt="" loading="lazy" decoding="async">
      </span>
      <span class="map-card-body">
        <span class="map-card-name">${escapeHtml(map.label)}</span>
        <span class="map-card-meta">${escapeHtml(metaLine(map))}</span>
        ${recordLine}
      </span>
      ${map.id === this.currentId ? '<span class="map-card-chip">PLAYING</span>' : ''}
    `;

    // A map without artwork falls back to a ruled plate with its initial on it.
    // A broken-image icon would read as a bug in a picker whose whole job is to
    // look finished.
    //
    // Two sources, in order: the kit's own cover (an isometric picture of
    // everything the map is made of), then the in-game capture at the spawn
    // point. The second is the fallback rather than the first because a capture
    // is a view from standing height — it says what the player sees, not what
    // the place is.
    const image = card.querySelector('.map-card-image') as HTMLImageElement;
    image.addEventListener('error', () => {
      const fallback = captureFallback(map.id);
      if (image.dataset.fallback !== '1') {
        image.dataset.fallback = '1';
        image.src = fallback;
        return;
      }
      image.remove();
      const frame = card.querySelector('.map-card-frame') as HTMLSpanElement;
      frame.classList.add('is-blank');
      frame.dataset.mark = map.label.slice(0, 1).toUpperCase();
    });

    card.addEventListener('click', () => {
      if (this.busy) return;
      this.audio.playClick();
      this.onSelectCallback?.(map.id);
    });

    return card;
  }

  /**
   * Locks the cards while a map is loading.
   *
   * Without it a second click lands on a card that is about to be replaced by
   * the first map's load, and the game ends up unloading the world it is in the
   * middle of building.
   */
  public setBusy(busy: boolean): void {
    this.busy = busy;
    this.element.classList.toggle('is-busy', busy);
    for (const card of Array.from(this.grid.querySelectorAll('.map-card'))) {
      (card as HTMLButtonElement).disabled = busy;
    }
    this.prevButton.disabled = busy || this.page === 0;
    this.nextButton.disabled = busy || this.page >= this.pageCount - 1;
  }

  public show(currentId: string, records: Record<string, MapRecord> = {}): void {
    this.render(currentId, records);
    this.setBusy(false);
    this.element.classList.remove('hidden');
  }

  public hide(): void {
    this.element.classList.add('hidden');
  }

  public get isOpen(): boolean {
    return !this.element.classList.contains('hidden');
  }

  public onSelect(callback: (id: string) => void): void {
    this.onSelectCallback = callback;
  }

  public onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  public getElement(): HTMLElement {
    return this.element;
  }
}

/**
 * Where a map's artwork lives.
 *
 * `/maps/<id>.jpg` is the kit cover, written by `tools/fetch-kit-covers.mjs`;
 * `/maps/shots/<id>.jpg` is the in-game capture from `tools/map-thumbs.mjs`.
 * Both are plain static files, so the picker works offline with no manifest.
 */
function thumbnail(id: string): string {
  return `/maps/${id}.jpg`;
}

function captureFallback(id: string): string {
  return `/maps/shots/${id}.jpg`;
}

/**
 * The one line of flavour that map carries, shown under its name.
 *
 * It used to read "1,073 objects · 3.8 MB". That is build metadata: it tells the
 * player how big the download is, which is a question nobody asks while picking
 * where to hunt, and it made every card look like a debug list. The map's own
 * brief says what the place is, and it is the same sentence the HUD opens with,
 * so the picker and the hunt agree.
 */
function metaLine(map: MapEntry): string {
  const brief = HIDDEN_ITEMS[map.id]?.brief;
  if (brief) return brief;
  if (map.objects) return `${map.objects.toLocaleString()} props, five of them out of place.`;
  return 'Five things here do not belong.';
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/** Seconds as `m:ss` — the same shape the HUD clock uses. */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
