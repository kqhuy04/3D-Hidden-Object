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
 *    In this game nothing moves except the player, so the map is valid until
 *    the player moves. It is now rebuilt on distance travelled, not on a clock:
 *    standing still costs nothing, and a walking body triggers one rebuild per
 *    40 cm of ground — which is the stride length of the only thing whose
 *    shadow actually changes.
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
  /** Where the body was when the map was last built, in world XZ. */
  private lastRefreshX = Number.NaN;
  private lastRefreshZ = Number.NaN;

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
  /** Minimum milliseconds between rebuilds while the world is moving. */
  private refreshMs = 50;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
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
   * One frame has passed.
   *
   * `active` is false when nothing in the world is moving (a paused game, the
   * main menu). The shadow map is then already correct and does not need to be
   * rebuilt at all, so the idle screen costs nothing for it.
   *
   * `frameMs` is the smoothed frame interval. The refresh interval is the
   * larger of the preset's and two and a half frames, which caps the shadow
   * pass at a fixed *share* of the frame. A fixed number of milliseconds is the
   * wrong unit: 50 ms is a third of a 60 fps frame and more than a whole frame
   * at 15 fps, so a slow machine would rebuild on every single frame — the one
   * thing this class exists to stop.
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
    if (!this.enabled) return;

    const interval = Math.max(this.refreshMs, frameMs * SHADOW_FRAME_SHARE);

    // Nothing in these maps moves except the player, so the map is stale only
    // when the player has. Gate on distance travelled rather than on a clock:
    // a player standing still and reading a label was rebuilding a 1024² map
    // over nine hundred casters twenty times a second, and a player walking
    // felt each rebuild as a tick in the stride.
    const movedSq =
      (playerPosition.x - this.lastRefreshX) ** 2 +
      (playerPosition.z - this.lastRefreshZ) ** 2;

    if (!this.dirty) {
      if (!active) return;
      if (movedSq < SHADOW_REFRESH_DISTANCE * SHADOW_REFRESH_DISTANCE) return;
      if (nowMs - this.lastRefreshAt < interval) return;
    }

    this.renderer.shadowMap.needsUpdate = true;
    this.lastRefreshAt = nowMs;
    this.lastRefreshX = playerPosition.x;
    this.lastRefreshZ = playerPosition.z;
    this.dirty = false;
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
 * Ground distance that makes the shadow map stale, in metres.
 *
 * The only animated caster is the player, and a stride is about 0.75 m. At
 * 0.4 m the shadow of a swinging leg lags its pose by half a stride, which is
 * invisible at the distance a third-person boom puts the camera — while a
 * clock-based refresh paid the same cost standing still.
 */
const SHADOW_REFRESH_DISTANCE = 0.4;
