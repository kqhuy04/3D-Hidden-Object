import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CharacterAnimator } from '../game/player/CharacterAnimator';
import { GAME_CONFIG } from '../data/gameConfig';
import { characterModelUrl, stepCharacter } from '../data/characters';

/**
 * The character on the left half of the start screen.
 *
 * A separate renderer, not a corner of the game's. The game's camera is a boom
 * eight metres behind a body standing in a loaded map; pointing that at a
 * character on a plain background would mean tearing down and rebuilding the
 * whole view every time the player pages the roster. One extra context with one
 * model in it costs a fraction of a frame and cannot disturb the hunt.
 *
 * It draws on a transparent canvas, so whatever is behind it — the washed map
 * backdrop — is the background, and the portrait sits on the same surface as
 * the rest of the screen rather than looking like a window cut into a card.
 *
 * Dragging with the left mouse button turns the character. That is the whole
 * interaction: no zoom, no tilt, because a portrait you can orbit into a
 * strange angle stops being a portrait of the person you are about to play.
 */
export class CharacterStage {
  private host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private holder = new THREE.Group();
  private animator: CharacterAnimator | null = null;
  private model: THREE.Object3D | null = null;
  /** Parsed GLBs by id — paging back and forth must not re-download. */
  private cache = new Map<string, Promise<THREE.Object3D>>();
  private loader = new GLTFLoader();
  private clock = new THREE.Clock();
  private frame = 0;
  private running = false;
  private currentId = '';
  /** Serialises swaps: two fast clicks must not leave two characters standing. */
  private token = 0;
  private observer: ResizeObserver;

  // --- drag to turn -------------------------------------------------------
  private dragging = false;
  private pointerId = -1;
  private lastX = 0;
  private lastMoveAt = 0;
  /** Radians per second left over from the drag, bled off in the tick. */
  private spin = 0;
  private static readonly RADIANS_PER_PIXEL = 0.011;
  private static readonly SPIN_DAMPING = 5.5;
  private static readonly SPIN_FLOOR = 0.05;

  constructor(host: HTMLElement) {
    this.host = host;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'char-stage-canvas';
    host.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    // The stage is a portrait of a person, not a scene: 2x is already more
    // pixels than a 480 px column can show.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
    // A three-quarter view, slightly above the eyeline. Straight-on reads as a
    // character sheet; the quarter turn reads as someone standing there.
    //
    // Framing is measured, not eyeballed: at 30° and 3.8 m the frame is 2.04 m
    // tall, and looking at 0.85 m puts it from -0.17 to 1.87. That leaves about
    // 8% of clear air under the boots and 6% over the head — enough that a hat
    // or a pair of heels is never sliced off by the edge of the panel.
    this.camera.position.set(1.05, 1.42, 4.15);
    this.camera.lookAt(0, 0.86, 0);

    this.scene.add(this.holder);
    this.buildLights();
    this.buildShadowPlate();

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.bindDrag();
  }

  /**
   * Left-button drag turns the character, with a little momentum on release.
   *
   * Pointer capture, not a `mousemove` on the window: the drag has to keep
   * working when the cursor leaves the panel — which it does almost
   * immediately, because the panel is only half the screen — and it has to stop
   * cleanly if the pointer is released outside the window.
   *
   * The arrows are separate elements, so a press that starts on one never
   * reaches this handler and can never be read as the start of a turn.
   */
  private bindDrag(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.pointerId = e.pointerId;
      this.lastX = e.clientX;
      this.lastMoveAt = performance.now();
      this.spin = 0;
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.classList.add('is-dragging');
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || e.pointerId !== this.pointerId) return;
      const now = performance.now();
      const dx = e.clientX - this.lastX;
      const dt = Math.max((now - this.lastMoveAt) / 1000, 0.008);
      const radians = dx * CharacterStage.RADIANS_PER_PIXEL;
      this.holder.rotation.y += radians;
      // Remember the speed so the release can coast. Clamped: a jumpy event
      // pair can report a whole panel of movement in one millisecond, and the
      // model would then spin like a top.
      this.spin = THREE.MathUtils.clamp(radians / dt, -6, 6);
      this.lastX = e.clientX;
      this.lastMoveAt = now;
    });

    const end = (e: PointerEvent): void => {
      if (!this.dragging || e.pointerId !== this.pointerId) return;
      this.dragging = false;
      this.pointerId = -1;
      // A press that ends where it started was a click, not a throw.
      if (performance.now() - this.lastMoveAt > 90) this.spin = 0;
      this.canvas.classList.remove('is-dragging');
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    // Losing the window mid-drag must not leave the model coasting forever.
    this.canvas.addEventListener('lostpointercapture', end);
  }

  private buildLights(): void {
    // Warm key from the front-left, matching the paper palette rather than the
    // game's sky. The character is the only subject here, so the light exists
    // to describe a face, not a place.
    const key = new THREE.DirectionalLight(0xfff2dd, 2.0);
    // High and slightly to the front-right. Lower than this and the shadow
    // stretches a body-length to the left, which reads as a second, darker
    // person standing beside the first.
    key.position.set(1.5, 4.4, 2.1);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 12;
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -2.2;
    cam.right = 2.2;
    cam.top = 2.6;
    cam.bottom = -1.4;
    cam.updateProjectionMatrix();
    key.shadow.bias = -0.0015;
    this.scene.add(key);

    // Cool fill from the right, weak, so the shadow side keeps its shape
    // instead of going to mud.
    const fill = new THREE.DirectionalLight(0xcfd8e6, 0.7);
    fill.position.set(-2.6, 1.8, 1.4);
    this.scene.add(fill);

    // A little ambient, tinted to the cream background, so the underside of a
    // hat is not a black hole.
    this.scene.add(new THREE.HemisphereLight(0xfdf8ec, 0x8a7d69, 0.6));
  }

  /**
   * A shadow catcher, not a floor.
   *
   * `ShadowMaterial` draws only where something is in shadow, so the canvas
   * stays transparent everywhere else and the panel's paper shows through. A
   * real plane with a light colour would put a grey rectangle behind the feet
   * and the stage would stop looking like it belongs to the page.
   */
  private buildShadowPlate(): void {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.ShadowMaterial({ opacity: 0.22 })
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.002;
    plate.receiveShadow = true;
    this.scene.add(plate);
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Pull back only when the panel is genuinely narrow. Above 0.8 the frame is
    // already wide enough for a standing body, and the pull-back was making the
    // character smaller for nothing; below it the shoulders would start to clip.
    const fit = this.camera.aspect >= 0.8 ? 1 : Math.min(1.9, 0.8 / this.camera.aspect);
    this.camera.position.set(1.05 * fit, 1.42 + (fit - 1) * 0.2, 4.15 * fit);
    this.camera.lookAt(0, 0.86, 0);
    this.camera.updateProjectionMatrix();
  }

  public async setCharacter(id: string): Promise<void> {
    if (id === this.currentId && this.model) return;
    this.currentId = id;
    const mine = ++this.token;
    const tStart = performance.now();

    let source: THREE.Object3D;
    try {
      source = await this.loadSource(id);
    } catch (err) {
      console.warn(`CharacterStage: could not load ${id}`, err);
      return;
    }
    const glbMs = Math.round(performance.now() - tStart);
    if (mine !== this.token) return;

    // `clone` from SkeletonUtils, not `Object3D.clone`: a plain clone shares
    // the skeleton's bones between copies and every model after the first
    // would be posed by the first one's mixer.
    const model = cloneSkinned(source);
    normalise(model);

    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      // The GLBs ship with their own material setup; forcing the shadow flags
      // is all this needs. Touching the materials would break the palette the
      // kits were authored with.
    });

    // The whole swap happens **off screen**, and only then is the model put in
    // front of the camera.
    //
    // A GLB arrives in its bind pose, which for a Mixamo rig is a T. Adding it
    // first and loading the clips afterwards — the obvious order — shows that
    // T for as long as the eight animation files take to arrive, so every click
    // on an arrow flashed a scarecrow before the character relaxed. The clips
    // have to be applied to a model nobody can see yet.
    const animator = new CharacterAnimator(model);
    const tClips = performance.now();
    // One clip, not eight: the portrait idles and does nothing else.
    await animator.loadAnimations('/assets/anims/', ['idle']);
    const clipsMs = Math.round(performance.now() - tClips);
    if (mine !== this.token) {
      // Superseded while the clips were loading: this model is never shown, so
      // it has to be freed here or its bone texture leaks.
      disposeModel(model);
      return;
    }
    // `loadAnimations` leaves Idle playing; one step of the mixer bakes the
    // first frame of it into the bones. Zero would evaluate but not advance,
    // and a clip that starts on frame zero is not guaranteed to have written
    // every joint yet.
    animator.update(1 / 60);

    this.clearModel();
    this.holder.add(model);
    this.holder.rotation.y = 0;
    this.spin = 0;
    this.model = model;
    this.animator = animator;

    // One line per swap, the same shape as the map loader's `[load]`. The stage
    // is the only thing a player can click twice a second, so a regression here
    // is felt immediately and has to be visible without a profiler.
    console.info(
      `[stage] ${id} total=${Math.round(performance.now() - tStart)}ms ` +
        `glb=${glbMs}ms clips=${clipsMs}ms`
    );

    // The next click should not pay for a model that was not loaded yet. Two
    // neighbours, after the swap has settled, so the parse never lands in the
    // same frame as the one the player is looking at.
    window.setTimeout(() => this.prefetchNeighbours(id), 500);
  }

  /**
   * Parses and caches one character, at most once.
   *
   * The promise, not the result: a prefetch that is still in flight when the
   * player clicks the same arrow must be joined, not duplicated.
   */
  private loadSource(id: string): Promise<THREE.Object3D> {
    let pending = this.cache.get(id);
    if (!pending) {
      pending = this.loader
        .loadAsync(characterModelUrl(id))
        .then((gltf) => gltf.scene)
        .catch((err) => {
          this.cache.delete(id);
          throw err;
        });
      this.cache.set(id, pending);
    }
    return pending;
  }

  private prefetchNeighbours(id: string): void {
    if (!this.running) return;
    for (const step of [1, -1]) {
      const next = stepCharacter(id, step);
      if (!this.cache.has(next.id)) void this.loadSource(next.id).catch(() => {});
    }
  }

  private clearModel(): void {
    this.animator = null;
    if (!this.model) return;
    this.holder.remove(this.model);
    disposeModel(this.model);
    this.model = null;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = (): void => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.1);

      // Coast after the release. Exponential damping rather than a fixed
      // subtraction, so the tail is smooth at any frame rate and stops dead
      // once it is too slow to see.
      if (!this.dragging && Math.abs(this.spin) > CharacterStage.SPIN_FLOOR) {
        this.holder.rotation.y += this.spin * dt;
        this.spin *= Math.exp(-CharacterStage.SPIN_DAMPING * dt);
      }

      this.animator?.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(tick);
  }

  public stop(): void {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  public dispose(): void {
    this.stop();
    this.observer.disconnect();
    this.clearModel();
    for (const pending of this.cache.values()) {
      void pending.then((source) => {
        source.traverse((child) => {
          const skinned = child as THREE.SkinnedMesh;
          if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry.dispose();
        });
      });
    }
    this.cache.clear();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

/** Same normalisation the game applies on load. See `Player.normaliseHeight`. */
function normalise(model: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(model);
  const height = box.max.y - box.min.y;
  if (!Number.isFinite(height) || height <= 0.01) return;
  const scale = GAME_CONFIG.player.capsuleHeight / height;
  if (scale < 0.25 || scale > 4) return;
  model.scale.setScalar(scale);
}

/**
 * Frees a discarded character.
 *
 * The skeleton matters more than the geometry: three uploads a bone texture per
 * skinned mesh, and paging the roster would leak one per click if the clone
 * were only dropped.
 */
function disposeModel(model: THREE.Object3D): void {
  model.traverse((child) => {
    const skinned = child as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
  });
}
