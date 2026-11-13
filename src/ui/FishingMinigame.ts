/**
 * The reeling bar, and everything that happens around it.
 *
 * The reference is Stardew Valley's fishing: a green zone the player lifts with
 * a held button, a fish that darts up and down the bar, and a progress meter
 * that fills while the two overlap. That is the whole game, and it works
 * because it is a *tracking* task with momentum — the zone does not teleport to
 * the cursor, it accelerates, so holding too long overshoots.
 *
 * The look is this game's, not Stardew's: paper, ink, one rust accent, hard
 * offset shadows and no gradients anywhere. The bar is a printed gauge, the
 * fish is a rust mark on it, and the zone is a moss band between two ink rules.
 *
 * The panel is DOM rather than drawn in the scene. A 3D bar would have to
 * follow the camera, fight the fog and be re-lit by the atmosphere; this is a
 * gauge the player reads for four seconds, and it belongs on the paper.
 */

/** Everything the panel needs to draw one frame of the reeling game. */
export interface ReelFrame {
  /** Bottom of the zone, 0 … 1, from the bottom of the track. */
  zoneY: number;
  /** Height of the zone, 0 … 1. */
  zoneH: number;
  /** Fish position, 0 … 1. */
  fishY: number;
  /** Catch progress, 0 … 1. */
  progress: number;
  /** Whether the fish is inside the zone this frame. */
  inZone: boolean;
}

export interface CatchReport {
  name: string;
  kg: number;
  xp: number;
  perfect: boolean;
  /** Set when this catch took the player up a level. */
  level: number | null;
}

export class FishingMinigame {
  private element: HTMLDivElement;
  private status: HTMLDivElement;
  private statusText: HTMLSpanElement;
  private power: HTMLDivElement;
  private powerFill: HTMLDivElement;
  private panel: HTMLDivElement;
  private speciesLabel: HTMLSpanElement;
  private track: HTMLDivElement;
  private zone: HTMLDivElement;
  private fish: HTMLDivElement;
  private progressFill: HTMLDivElement;
  private tension: HTMLSpanElement;
  private levelNote: HTMLSpanElement;
  private bite: HTMLDivElement;
  private card: HTMLDivElement;
  private cardName: HTMLHeadingElement;
  private cardLine: HTMLParagraphElement;
  private cardXp: HTMLSpanElement;
  private chip: HTMLDivElement;
  private chipLevel: HTMLSpanElement;
  private chipFill: HTMLDivElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'fishing-layer';
    this.element.innerHTML = `
      <div id="fishing-status" class="fishing-status hidden">
        <span class="key-cap">LMB</span>
        <span id="fishing-status-text">Hold to cast</span>
      </div>

      <div id="fishing-power" class="fishing-power hidden">
        <div class="fishing-power-track"><i id="fishing-power-fill"></i></div>
        <span class="fishing-power-label">CAST</span>
      </div>

      <div id="fishing-minigame" class="fishing-minigame hidden">
        <div class="fishing-head">
          <span class="fishing-kicker">On the line</span>
          <span id="fishing-species" class="fishing-species">Koi</span>
        </div>
        <div class="fishing-body">
          <div id="fishing-track" class="fishing-track">
            <div id="fishing-zone" class="fishing-zone"></div>
            <div id="fishing-fish" class="fishing-fish"></div>
          </div>
          <div class="fishing-gauge">
            <i id="fishing-progress-fill"></i>
          </div>
        </div>
        <div class="fishing-foot">
          <span id="fishing-tension">HOLD</span>
          <span id="fishing-level-note" class="fishing-level-note"></span>
        </div>
      </div>

      <div id="fishing-bite" class="fishing-bite hidden">
        <span class="fishing-bite-mark">!</span>
        <span class="fishing-bite-text">Strike</span>
      </div>

      <div id="fishing-card" class="fishing-card hidden">
        <span class="fishing-card-kicker">Landed</span>
        <h3 id="fishing-card-name"></h3>
        <p id="fishing-card-line"></p>
        <span id="fishing-card-xp" class="fishing-card-xp"></span>
      </div>

      <div id="fishing-chip" class="fishing-chip hidden">
        <span class="fishing-chip-label">Fishing</span>
        <span id="fishing-chip-level" class="fishing-chip-level">Lv 1</span>
        <div class="fishing-chip-bar"><i id="fishing-chip-fill"></i></div>
      </div>
    `;

    this.status = this.element.querySelector('#fishing-status')!;
    this.statusText = this.element.querySelector('#fishing-status-text')!;
    this.power = this.element.querySelector('#fishing-power')!;
    this.powerFill = this.element.querySelector('#fishing-power-fill')!;
    this.panel = this.element.querySelector('#fishing-minigame')!;
    this.speciesLabel = this.element.querySelector('#fishing-species')!;
    this.track = this.element.querySelector('#fishing-track')!;
    this.zone = this.element.querySelector('#fishing-zone')!;
    this.fish = this.element.querySelector('#fishing-fish')!;
    this.progressFill = this.element.querySelector('#fishing-progress-fill')!;
    this.tension = this.element.querySelector('#fishing-tension')!;
    this.levelNote = this.element.querySelector('#fishing-level-note')!;
    this.bite = this.element.querySelector('#fishing-bite')!;
    this.card = this.element.querySelector('#fishing-card')!;
    this.cardName = this.element.querySelector('#fishing-card-name')!;
    this.cardLine = this.element.querySelector('#fishing-card-line')!;
    this.cardXp = this.element.querySelector('#fishing-card-xp')!;
    this.chip = this.element.querySelector('#fishing-chip')!;
    this.chipLevel = this.element.querySelector('#fishing-chip-level')!;
    this.chipFill = this.element.querySelector('#fishing-chip-fill')!;
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  /** The one-line instruction under the reticle. Null hides it. */
  public setStatus(text: string | null): void {
    this.status.classList.toggle('hidden', text === null);
    if (text !== null && this.statusText.textContent !== text) this.statusText.textContent = text;
  }

  public setPower(visible: boolean, value = 0): void {
    this.power.classList.toggle('hidden', !visible);
    if (visible) this.powerFill.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  }

  public showBite(visible: boolean): void {
    this.bite.classList.toggle('hidden', !visible);
  }

  /**
   * Opens the reeling panel.
   *
   * The species is printed on it. Hiding it until the catch would be a nicer
   * surprise and a worse game: the bar's difficulty is a property of the fish,
   * and a player who cannot see what they are fighting cannot learn the
   * difference between a koi and a shark.
   */
  public startReel(speciesName: string, level: number, zoneHeight: number): void {
    this.speciesLabel.textContent = speciesName;
    this.levelNote.textContent = `Lv ${level}`;
    this.zone.style.height = `${zoneHeight * 100}%`;
    this.panel.classList.remove('hidden');
    this.setStatus(null);
    this.showBite(false);
    this.tension.textContent = 'HOLD TO LIFT';
  }

  /**
   * One frame of the reeling game.
   *
   * Written straight to `style` rather than through a class: the zone and the
   * fish move every frame, and a class per pixel would be a stylesheet of
   * nothing. The colours are toggled by class because that is a state, not a
   * position.
   */
  public updateReel(frame: ReelFrame): void {
    this.zone.style.bottom = `${frame.zoneY * 100}%`;
    this.fish.style.bottom = `${frame.fishY * 100}%`;
    this.progressFill.style.height = `${Math.max(0, Math.min(1, frame.progress)) * 100}%`;
    this.track.classList.toggle('in-zone', frame.inZone);
    this.tension.textContent = frame.inZone ? 'ON IT' : 'KEEP IT ON THE FISH';
  }

  public endReel(): void {
    this.panel.classList.add('hidden');
    this.track.classList.remove('in-zone');
  }

  /**
   * The catch card.
   *
   * A perfect landing is worth saying out loud — it is the one skill expression
   * the minigame has, and a bonus nobody is told about is a bonus nobody
   * chases.
   */
  public showCatch(report: CatchReport): void {
    this.cardName.textContent = report.name;
    this.cardLine.textContent = `${report.kg.toFixed(1)} kg${report.perfect ? ' · landed clean' : ''}`;
    this.cardXp.textContent = report.level
      ? `+${report.xp} XP · level ${report.level}`
      : `+${report.xp} XP`;
    this.card.classList.toggle('is-level', report.level !== null);
    this.card.classList.remove('hidden');
  }

  /**
   * It got away.
   *
   * Two words and nothing else. The bar already said how it happened — the
   * zone fell behind — and a sentence explaining it is a sentence the player
   * reads instead of recasting.
   */
  public showEscape(): void {
    this.cardName.textContent = 'It got away';
    this.cardLine.textContent = '';
    this.cardXp.textContent = '';
    this.card.classList.remove('is-level');
    this.card.classList.remove('hidden');
  }

  public hideCard(): void {
    this.card.classList.add('hidden');
  }

  /** The little level chip in the corner, with its experience bar. */
  public setChip(visible: boolean, level: number, xp: number, needed: number): void {
    this.chip.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.chipLevel.textContent = `Lv ${level}`;
    const ratio = needed > 0 ? Math.max(0, Math.min(1, xp / needed)) : 0;
    this.chipFill.style.width = `${Math.round(ratio * 100)}%`;
  }

  public hideAll(): void {
    this.panel.classList.add('hidden');
    this.card.classList.add('hidden');
    this.bite.classList.add('hidden');
    this.power.classList.add('hidden');
    this.status.classList.add('hidden');
    this.track.classList.remove('in-zone');
  }
}
