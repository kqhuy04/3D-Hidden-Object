import { MainMenu } from './MainMenu';
import { GameHUD } from './GameHUD';
import { PauseMenu } from './PauseMenu';
import { ResultsScreen } from './ResultsScreen';
import { MapSelect } from './MapSelect';
import { SettingsScreen } from './SettingsScreen';
import { DebugOverlay } from './DebugOverlay';
import { RoundItem } from '../game/missions/RoundManager';

export class UIManager {
  public mainMenu: MainMenu;
  public hud: GameHUD;
  public pauseMenu: PauseMenu;
  public resultsScreen: ResultsScreen;
  public mapSelect: MapSelect;
  public settings: SettingsScreen;
  public debugOverlay: DebugOverlay;

  private rootContainer: HTMLElement;
  /** Shown while a map is being swapped, over the (now empty) world. */
  private loadingElement: HTMLDivElement;
  private loadingText: HTMLSpanElement;
  /** Shown when the GPU context is lost and three is rebuilding it. */
  private contextElement: HTMLDivElement;
  /** The place name that comes up over the establishing shot. */
  private titleElement: HTMLDivElement;
  private titleName: HTMLHeadingElement;
  private titleNote: HTMLParagraphElement;
  /** Pending "the caption is gone now" timer, so it can be cancelled. */
  private titleTimer: number | null = null;

  constructor(container: HTMLElement) {
    this.rootContainer = container;

    this.mainMenu = new MainMenu();
    this.hud = new GameHUD();
    this.pauseMenu = new PauseMenu();
    this.resultsScreen = new ResultsScreen();
    this.mapSelect = new MapSelect();
    this.settings = new SettingsScreen();
    this.debugOverlay = new DebugOverlay();

    this.loadingElement = document.createElement('div');
    this.loadingElement.id = 'map-loading-screen';
    this.loadingElement.className = 'screen-overlay hidden';
    this.loadingElement.innerHTML = `
      <div class="map-loading-card">
        <div class="map-loading-spinner"></div>
        <span class="map-loading-text">Loading…</span>
      </div>
    `;
    this.loadingText = this.loadingElement.querySelector('.map-loading-text') as HTMLSpanElement;

    this.contextElement = document.createElement('div');
    this.contextElement.id = 'context-lost-screen';
    this.contextElement.className = 'screen-overlay hidden';
    this.contextElement.innerHTML = `
      <div class="map-loading-card">
        <div class="map-loading-spinner"></div>
        <span class="map-loading-text">Restoring the view…</span>
      </div>
    `;

    this.titleElement = document.createElement('div');
    this.titleElement.id = 'map-title-card';
    this.titleElement.className = 'map-title-card hidden';
    this.titleElement.innerHTML = `
      <span class="map-title-rule"></span>
      <h2 class="map-title-name"></h2>
      <p class="map-title-note"></p>
    `;
    this.titleName = this.titleElement.querySelector('.map-title-name') as HTMLHeadingElement;
    this.titleNote = this.titleElement.querySelector('.map-title-note') as HTMLParagraphElement;

    this.rootContainer.appendChild(this.mainMenu.getElement());
    this.rootContainer.appendChild(this.hud.getElement());
    this.rootContainer.appendChild(this.pauseMenu.getElement());
    this.rootContainer.appendChild(this.resultsScreen.getElement());
    this.rootContainer.appendChild(this.mapSelect.getElement());
    this.rootContainer.appendChild(this.settings.getElement());
    this.rootContainer.appendChild(this.loadingElement);
    this.rootContainer.appendChild(this.contextElement);
    this.rootContainer.appendChild(this.titleElement);

    // Initial state: Show Main Menu, hide gameplay HUD & overlays
    this.showMainMenu();
  }

  public showMainMenu(): void {
    this.mainMenu.show();
    this.hud.hide();
    this.pauseMenu.hide();
    this.resultsScreen.hide();
    this.mapSelect.hide();
    this.settings.hide();
    this.titleElement.classList.add('hidden');
    this.hideLoading();
  }

  public showGameplay(): void {
    this.mainMenu.hide();
    this.hud.show();
    this.pauseMenu.hide();
    this.resultsScreen.hide();
    this.mapSelect.hide();
    this.settings.hide();
    this.hideTitleCard();
    this.hideLoading();
  }

  /**
   * The place name, over the establishing shot.
   *
   * Deliberately not part of the HUD: the HUD is a dashboard that is either on
   * or off, and this is a caption that belongs to the three seconds before the
   * hunt. It leaves when the cutscene does.
   */
  public showTitleCard(name: string, note: string): void {
    if (this.titleTimer !== null) {
      window.clearTimeout(this.titleTimer);
      this.titleTimer = null;
    }
    this.titleName.textContent = name;
    this.titleNote.textContent = note;
    this.titleElement.classList.remove('hidden', 'is-leaving');
  }

  public hideTitleCard(): void {
    if (this.titleTimer !== null) window.clearTimeout(this.titleTimer);
    if (this.titleElement.classList.contains('hidden')) {
      this.titleTimer = null;
      return;
    }
    // Faded out rather than cut: a caption that disappears on the same frame as
    // the HUD arrives reads as a flicker.
    this.titleElement.classList.add('is-leaving');
    this.titleTimer = window.setTimeout(() => {
      this.titleElement.classList.add('hidden');
      this.titleTimer = null;
    }, 450);
  }

  public showPause(): void {
    this.pauseMenu.show();
  }

  public hidePause(): void {
    this.pauseMenu.hide();
  }

  public showMapSelect(currentId: string, records?: Record<string, { found: number; bestSeconds: number | null }>): void {
    this.mapSelect.show(currentId, records);
  }

  public hideMapSelect(): void {
    this.mapSelect.hide();
  }

  public showSettings(settings: Parameters<SettingsScreen['show']>[0], autoStep: string): void {
    this.settings.show(settings, autoStep);
  }

  public hideSettings(): void {
    this.settings.hide();
  }

  public showLoading(text: string): void {
    this.loadingText.textContent = text;
    this.loadingElement.classList.remove('hidden');
  }

  public setLoadingText(text: string): void {
    this.loadingText.textContent = text;
  }

  public hideLoading(): void {
    this.loadingElement.classList.add('hidden');
  }

  /**
   * The GPU dropped the context — a driver reset, a laptop switching graphics
   * cards, a tab backgrounded on Android. three rebuilds every buffer itself,
   * but the map's meshes were uploaded from geometry that still exists, so the
   * game recovers on its own; the player only needs to be told why the screen
   * went black for a moment.
   */
  public showContextLost(): void {
    this.contextElement.classList.remove('hidden');
  }

  public hideContextLost(): void {
    this.contextElement.classList.add('hidden');
  }

  public showResults(
    isWon: boolean,
    found: number,
    total: number,
    elapsedLabel: string,
    items: RoundItem[],
    bestSeconds: number | null = null,
    isNewBest = false
  ): void {
    this.hud.hide();
    this.pauseMenu.hide();
    this.settings.hide();
    this.resultsScreen.showResults(isWon, found, total, elapsedLabel, items, bestSeconds, isNewBest);
  }
}
