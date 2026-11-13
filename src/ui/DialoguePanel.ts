/**
 * What somebody in the map says to you.
 *
 * This used to be a hint box folded into the objectives panel in the corner —
 * which is where a *system message* belongs, not a person. A conversation is
 * the one moment the map talks back, and it has to arrive where the eye already
 * is after walking up to somebody: across the bottom of the screen, with a face
 * and a name on it.
 *
 * Paper and ink like everything else. No portrait is not a failure: a speaker
 * whose rig could not be photographed gets a paper seal with their initial,
 * which is still a person and still not a toast.
 */

/** How long a line stays up before the panel puts itself away. */
const HOLD_MS = 7500;

export class DialoguePanel {
  private element: HTMLDivElement;
  private portrait: HTMLDivElement;
  private nameEl: HTMLSpanElement;
  private lineEl: HTMLParagraphElement;
  private timer: number | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'dialogue-panel';
    this.element.className = 'dialogue-panel hidden';
    this.element.innerHTML = `
      <div class="dialogue-portrait"></div>
      <div class="dialogue-body">
        <span class="dialogue-name"></span>
        <p class="dialogue-line"></p>
      </div>
      <span class="dialogue-dismiss">E &middot; ask again</span>
    `;

    this.portrait = this.element.querySelector('.dialogue-portrait')!;
    this.nameEl = this.element.querySelector('.dialogue-name')!;
    this.lineEl = this.element.querySelector('.dialogue-line')!;
  }

  /**
   * @param name who is speaking, as the panel should print it.
   * @param line what they say. Plain text; it is written with `textContent`.
   * @param portrait a picture of them, or null for the initial seal.
   */
  public show(name: string, line: string, portrait: HTMLCanvasElement | null): void {
    if (this.timer !== null) window.clearTimeout(this.timer);

    this.nameEl.textContent = name;
    this.lineEl.textContent = line;
    this.portrait.replaceChildren();

    if (portrait) {
      this.portrait.classList.add('has-photo');
      this.portrait.appendChild(portrait);
    } else {
      this.portrait.classList.remove('has-photo');
      const seal = document.createElement('span');
      seal.className = 'dialogue-initial';
      seal.textContent = (name.trim()[0] ?? '?').toUpperCase();
      this.portrait.appendChild(seal);
    }

    this.element.classList.remove('hidden');
    this.timer = window.setTimeout(() => this.hide(), HOLD_MS);
  }

  public hide(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.element.classList.add('hidden');
  }

  public get isOpen(): boolean {
    return !this.element.classList.contains('hidden');
  }

  public getElement(): HTMLElement {
    return this.element;
  }
}
