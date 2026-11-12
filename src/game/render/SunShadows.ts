import * as THREE from 'three';

/**
 * The sun, and the shadow map that goes with it.
 *
 * The profile that prompted this file: 1063 shadow casters, a 2048² map, a
 * 90 × 90 m box, re-rendered on every frame — 39 ms of a 54 ms frame, three
 * quarters of the budget, spent redrawing a picture that had not changed.
 *
 * Three things were wrong with that, and they are all the same mistake: the
 * shadow pass was sized for "everything, always" instead of for what the player
 * can actually see.
 *
 * 1. **It was redrawn every frame.** A shadow map is stored in *light* space.
 *    It does not depend on where the camera is, only on where the casters are.
 *    In this game almost nothing moves, so the map is valid until something
 *    does. It is now rebuilt on distance travelled, not on a clock: standing
 *    still costs nothing.
 *
 * 2. **It covered the whole map.** A ±45 m box pinned to the world origin means
 *    a player who walks 60 m from spawn sees their shadow stop. The box now
 *    follows the body — snapped to a grid so the light does not crawl and
 *    force a refresh every frame — and is small enough that the casters outside
 *    it are frustum-culled out of the pass entirely. Fewer casters *and*
 *    shadows everywhere, which is the rare fix that is both cheaper and better.
 *
 * 3. **The map was oversized for the box.** 2048² over 90 m is 4.4 cm per
 *    texel. 1024² over the 60 m box is 5.9 cm — a third of the memory and a
 *    quarter of the fill, for a resolution difference nobody can see at the
 *    distance a shadow is legible.
 *
 * ## Why the map is now split in two
 *
 * Step 1 still left the *player* in the static map, and the player is the one
 * thing that is never still. Rebuilding the map every 40 cm — one stride —
 * meant the character's own shadow was drawn where the character had been and
 * snapped forward once per step, which is the stutter reported from play:
 * smooth, tick, smooth, tick, and gone the moment shadows are switched off.
 *
 * Rebuilding every frame is not the answer: a measured rebuild on `frontier-town`
 * is **1423 draw calls and 372k triangles, 2.4× the whole main pass**, and even
 * culling every caster under half a metre leaves 765 of them. So the map is
 * split by what moves.
 *
 * `worldMap` holds the world and nothing else. It is rendered by three exactly
 * as before, but only when the anchor steps (every 6 m) or a map loads.
 * `sun.shadow.map` — the map every material samples — is rebuilt every frame
 * from a blit of `worldMap` plus a second pass over the dozen-odd meshes that
 * actually moved: the player, the people, the ridden animals. One blit and a
 * few dozen draws, instead of fifteen hundred, and the character's shadow is
 * never more than a frame behind its feet.
 *
 * The movers are lifted onto their own render layer and have `castShadow`
 * cleared, so three's own pass cannot bake them into `worldMap` — a copy taken
 * with the player frozen in it would leave a ghost of the player standing
 * wherever it happened to be when the anchor last stepped.
 *
 * The follow is deliberately not a per-frame lerp. A light that chases the body
 * changes the shadow map's projection matrix every frame, which means the map
 * can never be reused and the whole scheme collapses back to the cost it was
 * built to remove. Snapping the anchor to a 6 m grid gives a light that moves
 * in discrete steps a few seconds apart, each of which costs one refresh.
 */
export class SunShadows {
  /** Exposed so a debug view can find the light. */
  public readonly sun: THREE.DirectionalLight;
  public readonly ambient: THREE.HemisphereLight;

  private anchorX = Number.NaN;
  private anchorY = Number.NaN;
  private anchorZ = Number.NaN;

  /** Forces the next `update` to rebuild the map regardless of the cadence. */
  private dirty = true;
  private lastRefreshAt = Number.NEGATIVE_INFINITY;
  /**
   * Set on the frame a rebuild was asked for, consumed on the next one.
   *
   * three draws the world during `renderer.render`, which happens after
   * `update`, so the copy can only be taken once the frame is over.
   */
  private pendingCapture = false;

  /**
   * Where the light sits relative to what it is aimed at.
   *
   * A field rather than a constant because the atmosphere moves it: each map is
   * pinned to an hour, and the hour decides the angle. It is clamped to stay
   * above the horizon by `skyModel`, so the shadow camera never has to deal
   * with a light under the ground.
   */
  private direction = new THREE.Vector3(45, 60, 35).normalize();

  private enabled = true;
  private mapSize = 1024;
  /** Half-width of the square the sun covers, in metres. */
  private radius = 30;
  /** Minimum milliseconds between rebuilds. */
  private refreshMs = 50;

  /** The world's shadow map, with nothing that moves baked into it. */
  private worldMap: THREE.WebGLRenderTarget | null = null;

  /** Roots to walk each frame for the meshes that need to follow their shadow. */
  private dynamicRoots: readonly THREE.Object3D[] = [];
  /** Flattened from the roots, rebuilt every frame so a model swap is picked up. */
  private readonly movers: THREE.Mesh[] = [];

  /** A full-screen quad that copies one shadow map into another. */
  private readonly blitScene = new THREE.Scene();
  private readonly blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blitMaterial: THREE.ShaderMaterial;
  private readonly blitGeometry = new THREE.PlaneGeometry(2, 2);
  /** Draws the movers into the shadow map as packed depth, as three would. */
  private readonly depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  /** Stands where the sun's shadow camera stands, but sees only the movers. */
  private readonly moverCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene
  ) {
    // Daylight fill. Kept exactly as it was: the whole look of every map is
    // tuned against these two intensities.
    this.ambient = new THREE.HemisphereLight(0xfffaed, 0x6e8858, 1.2);
    this.ambient.position.set(0, 50, 0);
    scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff7e8, 1.8);
    this.sun.castShadow = true;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 170;
    // The bias is written as a distance in metres and converted, because a
    // normalised bias means something different every time the depth range
    // changes — and a bias tuned for a 135 m range quietly becomes twice the
    // peter-panning when the range doubles.
    this.sun.shadow.bias = -SHADOW_BIAS_METRES / (this.sun.shadow.camera.far - this.sun.shadow.camera.near);
    this.sun.shadow.normalBias = 0.02;

    scene.add(this.sun);
    // The target has to be in the scene for its world matrix to be updated on
    // the normal traversal. Without it the light aims at whatever position the
    // target happened to hold when it was last updated by hand.
    scene.add(this.sun.target);

    // The shadow map holds *packed* depth in its colour attachment, so copying
    // it is a plain texture read with no unpacking — and no colour-space
    // conversion, which is why the material writes `gl_FragColor` directly
    // rather than going through one of three's built-ins.
    this.blitMaterial = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4( position.xy, 0.0, 1.0 );
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D( map, vUv );
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(this.blitGeometry, this.blitMaterial);
    quad.frustumCulled = false;
    this.blitScene.add(quad);

    this.moverCamera.layers.set(MOVER_LAYER);

    this.applyShadowSettings();
  }

  /**
   * Applies a quality preset.
   *
   * Changing the shadow map *type* changes the shader defines, so every
   * material has to be recompiled. That is a one-off hitch of about a tenth of
   * a second on the frame the player changes the setting, which is a far better
   * trade than paying for soft-filtered shadows on a machine that asked for the
   * cheap ones.
   */
  public apply(preset: {
    shadows: boolean;
    shadowMapSize: number;
    shadowRadius: number;
    shadowType: THREE.ShadowMapType;
    shadowRefreshMs: number;
  }): void {
    const typeChanged = this.sun.shadow.mapSize.width !== preset.shadowMapSize;
    this.enabled = preset.shadows;
    this.mapSize = preset.shadowMapSize;
    this.radius = preset.shadowRadius;
    this.refreshMs = preset.shadowRefreshMs;

    if (this.renderer.shadowMap.type !== preset.shadowType) {
      this.renderer.shadowMap.type = preset.shadowType;
      this.renderer.shadowMap.needsUpdate = true;
    }

    this.applyShadowSettings();

    if (typeChanged) {
      // A different map size reallocates the render target on the next pass;
      // dropping the old one here frees the 2048² buffer immediately instead of
      // holding both until the map is swapped.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.worldMap?.dispose();
      this.worldMap = null;
      this.pendingCapture = false;
    }
    this.dirty = true;
  }

  private applyShadowSettings(): void {
    this.renderer.shadowMap.enabled = this.enabled;
    this.sun.castShadow = this.enabled;
    this.sun.shadow.mapSize.set(this.mapSize, this.mapSize);

    const camera = this.sun.shadow.camera;
    camera.left = -this.radius;
    camera.right = this.radius;
    camera.top = this.radius;
    camera.bottom = -this.radius;
    camera.updateProjectionMatrix();
  }

  /** Forces a rebuild on the next frame — a map load, a preset change. */
  public invalidate(): void {
    this.dirty = true;
  }

  /**
   * Names the things that move.
   *
   * Only these are re-drawn into the shadow map each frame; everything else is
   * baked into `worldMap` and costs nothing until the anchor steps. They are
   * also taken out of three's own pass, because a copy of the world taken with
   * the player frozen inside it leaves a ghost of the player standing wherever
   * it was when the anchor last moved.
   *
   * Roots, not meshes: the list is re-walked every frame, so a character whose
   * model is swapped mid-round — the roster arrows do exactly that — needs no
   * second call.
   */
  public setDynamic(roots: readonly THREE.Object3D[]): void {
    this.dynamicRoots = [...roots];
  }

  /**
   * One frame has passed.
   *
   * `frameMs` is the smoothed frame interval. The rebuild interval is the
   * larger of the preset's and two and a half frames, which caps the shadow
   * pass at a fixed *share* of the frame. A fixed number of milliseconds is the
   * wrong unit: 50 ms is a third of a 60 fps frame and more than a whole frame
   * at 15 fps, so a slow machine would rebuild on every single frame — the one
   * thing this class exists to stop.
   *
   * `active` gates the rebuild only. The composite still runs on a paused
   * frame, because a rebuild can land on the very frame the player pauses on,
   * and that map has no movers in it at all.
   */
  public update(
    playerPosition: THREE.Vector3,
    nowMs: number,
    active: boolean,
    frameMs = 16.7
  ): void {
    const ax = Math.round(playerPosition.x / ANCHOR_SNAP_XZ) * ANCHOR_SNAP_XZ;
    const ay = Math.round(playerPosition.y / ANCHOR_SNAP_Y) * ANCHOR_SNAP_Y;
    const az = Math.round(playerPosition.z / ANCHOR_SNAP_XZ) * ANCHOR_SNAP_XZ;

    if (ax !== this.anchorX || ay !== this.anchorY || az !== this.anchorZ) {
      this.anchorX = ax;
      this.anchorY = ay;
      this.anchorZ = az;

      this.sun.target.position.set(ax, ay, az);
      this.sun.position.set(
        ax + this.direction.x * SUN_DISTANCE,
        ay + this.direction.y * SUN_DISTANCE,
        az + this.direction.z * SUN_DISTANCE
      );
      this.sun.target.updateMatrixWorld();
      this.dirty = true;
    }

    // Aiming is not shadow work: a directional light's *direction* is its
    // position minus its target, so a light that is never repositioned keeps
    // shining from wherever it was first placed. That is invisible at noon and
    // wrong at dusk, and it used to happen every time the player picked "low".
    if (!this.enabled) {
      this.pendingCapture = false;
      return;
    }

    // The world map three drew last frame is still the world; take the copy
    // before anything overwrites it.
    if (this.pendingCapture) {
      this.pendingCapture = false;
      this.captureWorldMap();
    }

    if (this.dirty && active) {
      const interval = Math.max(this.refreshMs, frameMs * SHADOW_FRAME_SHARE);
      if (nowMs - this.lastRefreshAt >= interval) {
        this.renderer.shadowMap.needsUpdate = true;
        this.lastRefreshAt = nowMs;
        this.dirty = false;
        this.pendingCapture = true;
        // This frame's map is the world on its own; the movers are drawn in on
        // the next one. One frame of a shadowless character every six metres is
        // not something an eye can catch, and the alternative — compositing a
        // map three has not drawn yet — is not possible from here.
        return;
      }
    }

    this.composite();
  }

  /** Copies the map three just drew — world only — into `worldMap`. */
  private captureWorldMap(): void {
    const map = this.sun.shadow.map;
    if (!map) return;
    if (!this.worldMap || this.worldMap.width !== map.width || this.worldMap.height !== map.height) {
      this.worldMap?.dispose();
      this.worldMap = new THREE.WebGLRenderTarget(map.width, map.height, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        // The composite never depth-tests, so it needs no depth buffer; three's
        // own pass draws into `sun.shadow.map`, which keeps its own.
        depthBuffer: false,
      });
    }
    this.blit(this.worldMap, map.texture);
  }

  /**
   * Rebuilds the map the materials sample: the world, plus whatever moved.
   *
   * The movers are drawn with the depth test off. The map's depth buffer holds
   * last frame's composite rather than the world's, so a test against it would
   * be a test against the wrong thing — and it is not needed: a mover is
   * overwritten unconditionally, and where it happens to stand in front of
   * something the world already shadows, the two shadows coincide.
   */
  private composite(): void {
    const map = this.sun.shadow.map;
    if (!map || !this.worldMap) return;

    this.blit(map, this.worldMap.texture);

    this.collectMovers();
    if (this.movers.length === 0) return;

    const source = this.sun.shadow.camera;
    const camera = this.moverCamera;
    camera.position.copy(source.position);
    camera.quaternion.copy(source.quaternion);
    camera.near = source.near;
    camera.far = source.far;
    camera.left = source.left;
    camera.right = source.right;
    camera.top = source.top;
    camera.bottom = source.bottom;
    camera.updateProjectionMatrix();

    // The pass must add to the blit, not paint over it, and the sky is not part
    // of a depth map. Both are put back before the frame continues.
    const background = this.scene.background;
    const fog = this.scene.fog;
    const override = this.scene.overrideMaterial;
    const autoClear = this.renderer.autoClear;
    const target = this.renderer.getRenderTarget();

    this.scene.background = null;
    this.scene.fog = null;
    this.scene.overrideMaterial = this.depthMaterial;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(map);
    this.renderer.render(this.scene, camera);
    this.renderer.setRenderTarget(target);
    this.renderer.autoClear = autoClear;
    this.scene.overrideMaterial = override;
    this.scene.fog = fog;
    this.scene.background = background;
  }

  /**
   * Flattens the moving roots into a list of meshes, and lifts them off three's
   * own shadow pass.
   *
   * `castShadow` is cleared here rather than once at registration because the
   * player's model is re-loaded on every character swap and comes back with it
   * set; the next frame's walk puts it back.
   */
  private collectMovers(): void {
    this.movers.length = 0;
    for (const root of this.dynamicRoots) {
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false;
        mesh.layers.enable(MOVER_LAYER);
        this.movers.push(mesh);
      });
    }
  }

  /** Copies `source` into `target` with a full-screen quad. */
  private blit(target: THREE.WebGLRenderTarget, source: THREE.Texture): void {
    const previous = this.renderer.getRenderTarget();
    const autoClear = this.renderer.autoClear;
    this.blitMaterial.uniforms.map.value = source;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.blitScene, this.blitCamera);
    this.renderer.setRenderTarget(previous);
    this.renderer.autoClear = autoClear;
  }

  /**
   * Aims and colours the light. Called once per map, and again only by the
   * handful of maps whose sun moves.
   */
  public setLight(direction: THREE.Vector3, color: THREE.Color, intensity: number): void {
    const moved = this.direction.distanceToSquared(direction) > 1e-8;
    this.direction.copy(direction).normalize();
    this.sun.color.copy(color);
    this.sun.intensity = intensity;

    // The anchor caches where the light was placed; a new angle invalidates it.
    if (moved) {
      this.anchorX = Number.NaN;
      this.anchorY = Number.NaN;
      this.anchorZ = Number.NaN;
      this.dirty = true;
    }
  }

  /** Sets the fill light: sky colour from above, bounce colour from below. */
  public setAmbient(sky: THREE.Color, ground: THREE.Color, intensity: number): void {
    this.ambient.color.copy(sky);
    this.ambient.groundColor.copy(ground);
    this.ambient.intensity = intensity;
  }

  /** Frees the shadow map on teardown. */
  public dispose(): void {
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.worldMap?.dispose();
    this.worldMap = null;
    this.blitGeometry.dispose();
    this.blitMaterial.dispose();
    this.depthMaterial.dispose();
    this.sun.removeFromParent();
    this.sun.target.removeFromParent();
    this.ambient.removeFromParent();
  }
}

/** Distance from the anchor to the light, in metres. */
const SUN_DISTANCE = 95;

/**
 * Depth offset, in metres.
 *
 * Chosen against the 90 m box the old fixed light used, so switching to the
 * following light does not change how much a shadow detaches from its caster.
 */
const SHADOW_BIAS_METRES = 0.055;

/** The light moves in steps of this many metres, so it does not crawl. */
const ANCHOR_SNAP_XZ = 6;
const ANCHOR_SNAP_Y = 4;

/**
 * Shadow rebuilds are spaced by at least this many frames.
 *
 * 2.5 means the pass can never take more than 40% of the frame, whatever the
 * machine is doing. Without a floor in frames, a machine running at 15 fps
 * rebuilds on every frame and pays the full cost exactly where it hurts most.
 */
const SHADOW_FRAME_SHARE = 2.5;

/**
 * Render layer reserved for the meshes whose shadow has to follow them.
 *
 * Layer 0 is what every camera sees by default, so the movers are *added* to
 * layer 1 rather than moved onto it: they still belong to the world, and only
 * the shadow composite looks at the new one.
 */
const MOVER_LAYER = 1;
