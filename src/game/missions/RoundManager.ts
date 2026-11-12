import { HiddenItemPlacement } from '../../data/hiddenItems';

export interface RoundItem {
  placement: HiddenItemPlacement;
  found: boolean;
  /** Seconds on the clock when it was found. */
  foundAt?: number;
}

export type RoundStatus = 'idle' | 'playing' | 'paused' | 'won' | 'lost';

/**
 * How many wrong objects end the hunt.
 *
 * Three is the number of guesses a player can make on a hunch before the hunch
 * has to become a decision. One would make every crowded corner a coin flip
 * that costs the round; five would make the decoys decorative.
 */
export const MAX_STRIKES = 3;

/**
 * State of one hunt: what is still missing, how long the player has been at it.
 *
 * There is no countdown any more. The old round was a three-photo sprint against
 * 180 seconds; a hunt for five small objects in a 100-metre map is a different
 * animal, and a clock would push players to sprint past the thing they are
 * supposed to notice. Time is counted up instead, and shown on the results card.
 */
export class RoundManager {
  private items: RoundItem[] = [];
  private elapsed = 0;
  private status: RoundStatus = 'idle';
  /** Wrong objects picked so far this round. */
  private strikes = 0;

  /**
   * A map with no hunt authored yet. The round has no objectives, so the map can
   * still be walked and its collision inspected.
   */
  private freeRoam = false;

  private onStateChangeCallbacks: ((status: RoundStatus) => void)[] = [];
  private onItemFoundCallbacks: ((item: RoundItem) => void)[] = [];

  public isFreeRoam(): boolean {
    return this.freeRoam;
  }

  public startFreeRoam(): void {
    this.freeRoam = true;
    this.items = [];
    this.elapsed = 0;
    this.strikes = 0;
    this.status = 'playing';
    this.notifyStateChange();
  }

  public startRound(placements: HiddenItemPlacement[]): void {
    this.freeRoam = false;
    this.items = placements.map((placement) => ({ placement, found: false }));
    this.elapsed = 0;
    this.strikes = 0;
    this.status = 'playing';
    this.notifyStateChange();
  }

  public retryRound(): void {
    for (const item of this.items) {
      item.found = false;
      item.foundAt = undefined;
    }
    this.elapsed = 0;
    this.strikes = 0;
    this.status = 'playing';
    this.notifyStateChange();
  }

  /**
   * Records a wrong object. Returns the strike count, or null when the round was
   * not running.
   *
   * The round ends on the third one. This is the whole reason the map's other
   * props are clickable: without a cost, a decoy is only a decoration that
   * wastes a keystroke, and the player learns nothing from it.
   */
  public addStrike(): number | null {
    if (this.status !== 'playing') return null;
    this.strikes++;
    if (this.strikes >= MAX_STRIKES) {
      this.status = 'lost';
      this.notifyStateChange();
    }
    return this.strikes;
  }

  public getStrikes(): number {
    return this.strikes;
  }

  public update(deltaSeconds: number): void {
    if (this.status !== 'playing') return;
    this.elapsed += deltaSeconds;
  }

  public pause(): void {
    if (this.status === 'playing') {
      this.status = 'paused';
      this.notifyStateChange();
    }
  }

  public resume(): void {
    if (this.status === 'paused') {
      this.status = 'playing';
      this.notifyStateChange();
    }
  }

  /** Marks an object found. Returns false if it was already in the bag. */
  public complete(itemId: string): boolean {
    if (this.status !== 'playing') return false;

    const item = this.items.find((i) => !i.found && i.placement.id === itemId);
    if (!item) return false;

    item.found = true;
    item.foundAt = this.elapsed;

    for (const cb of this.onItemFoundCallbacks) cb(item);

    if (this.items.every((i) => i.found)) {
      this.status = 'won';
      this.notifyStateChange();
    }

    return true;
  }

  public getItems(): RoundItem[] {
    return this.items;
  }

  public getFoundCount(): number {
    return this.items.filter((i) => i.found).length;
  }

  public getTotal(): number {
    return this.items.length;
  }

  /** Seconds since the hunt started. */
  public getElapsed(): number {
    return this.elapsed;
  }

  /** Elapsed time as m:ss, which is how the HUD and results card show it. */
  public getElapsedLabel(): string {
    const total = Math.floor(this.elapsed);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  public getStatus(): RoundStatus {
    return this.status;
  }

  public onStateChange(callback: (status: RoundStatus) => void): void {
    this.onStateChangeCallbacks.push(callback);
  }

  public onItemFound(callback: (item: RoundItem) => void): void {
    this.onItemFoundCallbacks.push(callback);
  }

  private notifyStateChange(): void {
    for (const cb of this.onStateChangeCallbacks) {
      cb(this.status);
    }
  }
}
