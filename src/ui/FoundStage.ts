import * as THREE from 'three';

/**
 * The object you just found, turning on its own little stage.
 *
 * A second WebGL context, for the same reason `CharacterStage` is one: the
 * found screen sits over a blurred game, and a thing drawn *inside* the game's
 * canvas would be blurred along with it. Drawing on a transparent canvas above
 * the veil puts the object on the near side of the blur, which is the whole
 * point — the background is out of focus and the object is not.
 *
 * It takes the real object out of the map rather than a copy. Cloning a kit prop
 * means cloning a skinned mesh, and `HiddenItemSystem.release` already has the
 * one the player picked up in hand; the screen owns it until it closes.
 */

/** Seconds for one full turn. Slow enough to read the shape, fast enough to
 *  feel alive — "quay vừa vừa" was the ask, and a turn every three seconds
 *  reads as a spin rather than a look. */
const TURN_SECONDS = 4.4;

/** Radians the object is tipped back, so its top is visible as well as its face. */
const TILT = -0.16;

/** Radius the object is normalised to, in stage units. */
const FIT_RADIUS = 0.94;

/** Degrees of vertical field of view. */
const FOV = 34;

export class FoundStage {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private holder = new THREE.Group();
  private object: THREE.Object3D | null = null;
  /**
   * Whether the stage may free the object's buffers.
   *
   * A hidden object comes out of the map and is gone, so it does. A fish shown
   * for a catch is a clone of a prototype the school still needs, and its
   * geometry is that prototype's geometry — disposing it here would empty the
   * water for the rest of the session.
   */
  private owns = true;
  private frame = 0;
  private running = false;
  private clock = new THREE.Clock();
  private observer: ResizeObserver;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'found-stage-canvas';
    host.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    // A 240 px well on screen. At 2x it is already more pixels than the thing
    // can show, and this canvas is only ever up for a few seconds.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setClearAlpha(0);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 30);
    this.holder.rotation.x = TILT;
    this.scene.add(this.holder);
    this.buildLights();

    // The well is `display: none` until the screen opens, so its measured size
    // is zero at construction. The observer fires on the way in and gives the
    // canvas its real size without a resize call at every show.
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  private buildLights(): void {
    // The same three-light shape as the character stage: a warm key that
    // describes the form, a cool fill that keeps the shadow side from going to
    // mud, and enough ambient that a dark object is still an object.
    const key = new THREE.DirectionalLight(0xfff4e2, 2.6);
    key.position.set(2.2, 3.4, 2.6);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xd2dcea, 1.35);
    fill.position.set(-2.6, 0.8, 1.4);
    this.scene.add(fill);

    // Behind and above, so the silhouette separates from the blurred game
    // rather than sinking into it.
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(-1.2, 2.0, -3.0);
    this.scene.add(rim);

    this.scene.add(new THREE.HemisphereLight(0xfdf8ec, 0x7d7466, 0.95));
  }

  private resize(): void {
    const host = this.canvas.parentElement;
    const size = Math.max(1, Math.round(host?.clientWidth || this.canvas.clientWidth || 240));
    if (size <= 1) return;
    this.renderer.setSize(size, size, false);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
    // Distance that puts a sphere of FIT_RADIUS exactly inside the frame, with
    // a little air. Measured from the geometry rather than guessed, so a wide
    // object and a tall one are both framed whole.
    const distance = (FIT_RADIUS * 1.06) / Math.sin((FOV * Math.PI) / 360);
    this.camera.position.set(0, 0, distance);
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Puts an object on the stage, taking ownership of it.
   *
   * The object arrives where the map had it — on the ground, turned to face
   * something, at whatever scale the kit authored. It is recentred on its own
   * bounding sphere and scaled to fit, so the screen does not depend on where
   * in the world the player happened to find it.
   */
  public show(object: THREE.Object3D, owns = true): void {
    this.clear();
    this.object = object;
    this.owns = owns;
    // The well may have been measured while the screen was `display: none`, and
    // the observer that fixes that fires on the next frame — which is one frame
    // of a badly sized canvas. Measure now that the element is up.
    this.resize();

    object.updateMatrixWorld(true);
    const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius > 0.0001 ? sphere.radius : 0.5;

    // Centre first, then scale: the sphere's centre is in world units and the
    // object has no parent left, so its own position is in the same units.
    object.position.sub(sphere.center);
    const scale = FIT_RADIUS / radius;
    object.scale.multiplyScalar(scale);

    this.holder.add(object);
    this.holder.rotation.y = 0;
    this.start();
  }

  /**
   * Compiles an object's materials in *this* context, before the screen opens.
   *
   * This is a second WebGL context, so every program the found screen needs is
   * compiled again from scratch the first time it is drawn — and the first time
   * it is drawn is the moment the player has just found something, which is the
   * one moment the game must not stutter. A proxy mesh sharing the real
   * geometry and material compiles the identical program without touching the
   * object, which is still standing in the map.
   *
   * Skinned meshes are skipped: their program depends on the rig, and binding a
   * second mesh to a live skeleton to save one compile is not a trade worth
   * making. No hidden object in the game is skinned.
   */
  public warm(object: THREE.Object3D): void {
    const proxies: THREE.Mesh[] = [];
    object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      const proxy = new THREE.Mesh(mesh.geometry, mesh.material);
      proxy.frustumCulled = false;
      proxies.push(proxy);
      this.holder.add(proxy);
    });
    if (proxies.length === 0) return;

    // The well is `display: none` until the screen opens, so its measured size
    // is zero and a zero-sized drawing buffer is not a reliable place to compile
    // anything. One pixel is; `show` measures the real size again.
    this.renderer.setSize(1, 1, false);
    this.renderer.render(this.scene, this.camera);

    for (const proxy of proxies) this.holder.remove(proxy);
  }

  public hide(): void {
    this.stop();
    this.clear();
  }

  public get isShowing(): boolean {
    return this.object !== null;
  }

  private clear(): void {
    if (!this.object) return;
    this.holder.remove(this.object);
    if (this.owns) {
      this.object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        // The object came out of the hunt with its buffers intact, so this is
        // the only place they are freed.
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
    }
    this.object = null;
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = (): void => {
      if (!this.running) return;
      this.frame = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.holder.rotation.y += (dt / TURN_SECONDS) * Math.PI * 2;
      this.renderer.render(this.scene, this.camera);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stop(): void {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  public dispose(): void {
    this.hide();
    this.observer.disconnect();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
