import { PRIZES, RARITY_COLOR, RARITY_LABEL, type PrizeSpec } from './prizes';

export interface UiHandlers {
  onCoin(): void;
  onCollection(): void;
  onCloseDrawer(): void;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

export class Ui {
  private readonly coinCount = byId('coin-count');
  private readonly collectCount = byId('collect-count');
  private readonly hint = byId('hint');
  private readonly btnCoin = byId<HTMLButtonElement>('btn-coin');
  private readonly btnCollection = byId('btn-collection');
  private readonly drawer = byId('drawer');
  private readonly grid = byId('collection-grid');
  private readonly reveal = byId('reveal');
  private readonly revealName = byId('reveal-name');
  private readonly revealRarity = byId('reveal-rarity');
  private readonly drawerNote = byId('drawer-note');

  constructor(handlers: UiHandlers) {
    this.btnCoin.addEventListener('click', () => handlers.onCoin());
    this.btnCollection.addEventListener('click', () => handlers.onCollection());
    byId('btn-close-drawer').addEventListener('click', () => handlers.onCloseDrawer());
  }

  setCoins(count: number): void {
    this.coinCount.textContent = String(count);
  }

  setCollected(owned: Set<string>): void {
    this.collectCount.textContent = `${owned.size} / ${PRIZES.length}`;
  }

  setHint(text: string): void {
    this.hint.textContent = text;
    // An empty pill would still draw its border, so hide it outright.
    this.hint.hidden = text === '';
  }

  setCoinEnabled(enabled: boolean): void {
    this.btnCoin.disabled = !enabled;
  }

  setFloorNote(text: string): void {
    this.drawerNote.textContent = text;
    // An empty pill would still draw its border, so hide the chip outright.
    this.drawerNote.hidden = text === '';
  }

  openDrawer(owned: Set<string>): void {
    this.grid.replaceChildren();
    for (const prize of PRIZES) {
      const has = owned.has(prize.id);
      const slot = document.createElement('div');
      slot.className = has ? 'slot' : 'slot locked';

      const emblem = document.createElement('div');
      emblem.className = 'slot-emblem';
      emblem.style.background = has ? prize.body : '#cfc8bc';

      const name = document.createElement('div');
      name.className = 'slot-name';
      name.textContent = has ? prize.name : 'Unknown';

      const rarity = document.createElement('div');
      rarity.className = 'slot-rarity';
      rarity.textContent = has ? RARITY_LABEL[prize.rarity] : 'Not found';
      rarity.style.color = has ? RARITY_COLOR[prize.rarity] : '#8d8577';

      slot.append(emblem, name, rarity);
      this.grid.append(slot);
    }
    this.drawer.hidden = false;
  }

  closeDrawer(): void {
    this.drawer.hidden = true;
  }

  get drawerOpen(): boolean {
    return !this.drawer.hidden;
  }

  showReveal(spec: PrizeSpec): void {
    this.revealName.textContent = spec.name;
    this.revealRarity.textContent = RARITY_LABEL[spec.rarity];
    this.revealRarity.style.background = RARITY_COLOR[spec.rarity];
    this.revealRarity.style.color = '#efe3ce';
    this.reveal.hidden = false;
  }

  hideReveal(): void {
    this.reveal.hidden = true;
  }

  get revealOpen(): boolean {
    return !this.reveal.hidden;
  }
}
