import * as THREE from 'three';

export class InputController {
  private keys: Record<string, boolean> = {};
  private movementVector = new THREE.Vector2();
  private interactCallbacks: (() => void)[] = [];
  private pickupClickCallbacks: (() => void)[] = [];
  private cycleCallbacks: (() => void)[] = [];
  private crawlCallbacks: ((crawling: boolean) => void)[] = [];
  private runCallbacks: ((running: boolean) => void)[] = [];
  private viewCallbacks: (() => void)[] = [];
  private pauseCallbacks: (() => void)[] = [];
  private virtualJoystickVector = new THREE.Vector2();

  /**
   * Space is a jump now, so it is edge-triggered and latched: holding the key
   * must not re-trigger, and a press that lands between two frames must not be
   * lost. The controller consumes it once per frame.
   */
  private jumpQueued = false;

  /**
   * E is the same shape: a press between two frames is remembered until the next
   * frame reads it, so a quick tap never gets swallowed on a slow machine.
   */
  private interactQueued = false;

  /** Where the left button went down, to tell a click from a camera drag. */
  private clickOrigin: { x: number; y: number } | null = null;

  /** Crawl is latched: one tap down, the next tap up. */
  private crawlLatched = false;

  /** Shift is a gear, not a sprint key: tapped once to run, again to walk. */
  private runLatched = false;

  constructor() {
    this.setupKeyboardListeners();
    this.setupPointerListeners();
  }

  /**
   * A left click on the world picks up, the same as E.
   *
   * The canvas is also the camera's orbit surface, so a press that moves is a
   * drag and a press that does not is a click. Six pixels is the same tolerance
   * a hand has for holding still; anything wider turns small aiming
   * corrections into accidental pickups.
   */
  private setupPointerListeners(): void {
    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      // Menus, the pause button and every other control live under this class.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('.interactive-ui')) return;
      this.clickOrigin = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('pointerup', (e) => {
      const origin = this.clickOrigin;
      this.clickOrigin = null;
      if (!origin || e.button !== 0) return;

      const moved = Math.hypot(e.clientX - origin.x, e.clientY - origin.y);
      if (moved > 6) return;

      for (const cb of this.pickupClickCallbacks) cb();
    });

    window.addEventListener('pointercancel', () => {
      this.clickOrigin = null;
    });
  }

  private setupKeyboardListeners(): void {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.jumpQueued = true;
      }

      // E picks up the odd object under the crosshair.
      if (e.code === 'KeyE' && !e.repeat) {
        e.preventDefault();
        this.interactQueued = true;
        this.triggerInteract();
      }

      // Tab moves to the next object within reach. It has to take the key
      // before the browser does, or the focus ring walks out of the canvas and
      // the player is tabbing through the pause button instead of the props.
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat) this.triggerCycle();
      }

      // C toggles the crawl. Held, not toggled, would fight with WASD; a tap
      // that stays down until the next tap is the shape that works while the
      // other hand is on the mouse.
      if (e.code === 'KeyC' && !e.repeat) {
        e.preventDefault();
        this.crawlLatched = !this.crawlLatched;
        this.triggerCrawl(this.crawlLatched);
      }

      // Shift swaps gears. Toggle rather than hold: the player's left hand is
      // already holding W, and a sprint that has to be held is a sprint that
      // gets dropped every time the hand leaves the keyboard.
      if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) {
        e.preventDefault();
        this.runLatched = !this.runLatched;
        this.triggerRun(this.runLatched);
      }

      // V swaps the view between the boom and the head.
      if (e.code === 'KeyV' && !e.repeat) {
        e.preventDefault();
        this.triggerView();
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        this.triggerPause();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Clear keys if window loses focus
    window.addEventListener('blur', () => {
      this.keys = {};
      this.jumpQueued = false;
      this.interactQueued = false;
      this.virtualJoystickVector.set(0, 0);
    });
  }

  public onInteract(callback: () => void): void {
    this.interactCallbacks.push(callback);
  }

  /** Left click on the world; the game decides whether it picks anything up. */
  public onPickupClick(callback: () => void): void {
    this.pickupClickCallbacks.push(callback);
  }

  /** Tab: move the selection to the next object within reach. */
  public onCycle(callback: () => void): void {
    this.cycleCallbacks.push(callback);
  }

  /** C: enter or leave the crawl. */
  public onCrawl(callback: (crawling: boolean) => void): void {
    this.crawlCallbacks.push(callback);
  }

  /** Shift: swap between walking and running. */
  public onRun(callback: (running: boolean) => void): void {
    this.runCallbacks.push(callback);
  }

  /** V or the HUD button: swap between first and third person. */
  public onViewToggle(callback: () => void): void {
    this.viewCallbacks.push(callback);
  }

  public isRunning(): boolean {
    return this.runLatched;
  }

  public setRunning(running: boolean): void {
    this.runLatched = running;
  }

  public isCrawling(): boolean {
    return this.crawlLatched;
  }

  public setCrawling(crawling: boolean): void {
    this.crawlLatched = crawling;
  }

  public triggerCycle(): void {
    for (const cb of this.cycleCallbacks) cb();
  }

  public triggerCrawl(crawling: boolean): void {
    for (const cb of this.crawlCallbacks) cb(crawling);
  }

  public triggerRun(running: boolean): void {
    for (const cb of this.runCallbacks) cb(running);
  }

  public triggerView(): void {
    for (const cb of this.viewCallbacks) cb();
  }

  public onPause(callback: () => void): void {
    this.pauseCallbacks.push(callback);
  }

  public triggerInteract(): void {
    for (const cb of this.interactCallbacks) {
      cb();
    }
  }

  public triggerPause(): void {
    for (const cb of this.pauseCallbacks) {
      cb();
    }
  }

  public setVirtualJoystick(x: number, y: number): void {
    this.virtualJoystickVector.set(x, y);
  }

  /** True once per press of Space; the read clears the latch. */
  public consumeJump(): boolean {
    if (!this.jumpQueued) return false;
    this.jumpQueued = false;
    return true;
  }

  public getMovementVector(): THREE.Vector2 {
    let x = 0;
    let y = 0;

    // A / D / Left / Right
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) x -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) x += 1;

    // W / S / Up / Down
    if (this.keys['KeyW'] || this.keys['ArrowUp']) y += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) y -= 1;

    // If virtual joystick is active, blend or use it
    if (this.virtualJoystickVector.lengthSq() > 0.01) {
      x = this.virtualJoystickVector.x;
      y = this.virtualJoystickVector.y;
    }

    this.movementVector.set(x, y);
    if (this.movementVector.lengthSq() > 1.0) {
      this.movementVector.normalize();
    }

    return this.movementVector;
  }
}
