import * as THREE from 'three';
import { GAME_CONFIG } from '../../data/gameConfig';
import { WorldCollision } from '../world/WorldCollision';

/**
 * Shortest boom, so the camera never ends up inside the character's head.
 *
 * Half a metre was the old value and it produced a screen full of the back of
 * the character's head — at that range the lens is inside the model. A metre is
 * far enough back to read the silhouette, and the lift below raises it as well.
 */
const MIN_BOOM = 1.1;
/**
 * Extra pitch, in radians, applied at full boom squeeze.
 *
 * Zooming in on the character when something is behind them answers the wrong
 * question: the player wants to see the world, and a metre behind the head shows
 * a hat. Rising instead — the camera swings up and looks down over the
 * character — keeps the scene legible, and a fence or a crate that forced the
 * squeeze is usually something the raised lens can see over anyway.
 */
const BOOM_LIFT_PITCH = 0.6;
/** Air kept between the lens and whatever the ray hit. */
const BOOM_MARGIN = 0.2;
/**
 * How fast the boom may retract, in metres per second.
 *
 * Not instant, even though instant is what keeps the lens out of the geometry.
 * A ray that grazes a fence post moves its intersection along the ray far
 * faster than the body moves, so the required boom can drop a metre in one
 * frame; snapping to it teleported the camera 7.2 m in a single frame on
 * `cozy-farm`, which is exactly the judder this whole exercise is about. A fast
 * retraction reads as the camera moving in because something is in the way; a
 * teleport reads as a glitch. The cost is up to a third of a second where the
 * lens is on the far side of a thin object, which is legible — you see the
 * fence with the character behind it — rather than a lurch.
 */
const BOOM_IN_SPEED = 20;
/** How fast the boom may extend again, per second, once the way is clear. */
const BOOM_OUT_RATE = 3.5;
/**
 * How much room must open up before the boom starts extending, in metres.
 *
 * Without it the boom tracks every wobble of the ray: retraction is immediate,
 * so once it sits on the obstruction the smallest change flips it between
 * pulling in and easing out, and the view shivers. Retraction keeps no dead
 * band — being too close to a wall is never the safe side of that trade.
 */
const BOOM_OUT_DEADBAND = 0.3;
/** Height the camera keeps above the ground under it. */
const GROUND_CLEARANCE = 0.6;

/**
 * Where the first-person lens sits, in metres above the feet.
 *
 * Slightly above the third-person focus point (1.5 m): the focus is aimed at
 * the character's chest so the boom frames the whole body, while a lens in the
 * head has to be at the eyes or the world reads as knee-high.
 */
const EYE_HEIGHT = 1.62;

/** How fast the view blends between first and third person, per second. */
const VIEW_BLEND_RATE = 9;

const _boomEnd = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _thirdPos = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _eyeTarget = new THREE.Vector3();
const _viewDir = new THREE.Vector3();

export type ViewMode = 'third' | 'first';

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;
  private collision: WorldCollision | null = null;

  // Spherical state
  private currentYaw = GAME_CONFIG.camera.defaultYaw;
  private targetYaw = GAME_CONFIG.camera.defaultYaw;
  private currentPitch = GAME_CONFIG.camera.defaultPitch;
  private targetPitch = GAME_CONFIG.camera.defaultPitch;
  private currentDistance = GAME_CONFIG.camera.defaultDistance;
  private targetDistance = GAME_CONFIG.camera.defaultDistance;
  /**
   * Boom length after collision, in metres.
   *
   * Separate from `currentDistance` — that is the user's zoom, this is how much
   * of it the world allows. It is state rather than a per-frame value because
   * recomputing it from scratch makes the camera pump in and out as the ray
   * alternately hits and misses; and it is rate-limited in both directions
   * because the ray intersection it comes from can move much faster than the
   * body does.
   */
  private boomDistance = GAME_CONFIG.camera.defaultDistance;
  /**
   * Where the boom is heading, before the rate limits.
   *
   * The obstruction is tracked here rather than compared against `boomDistance`
   * directly so the outward move can have hysteresis without the boom itself
   * stopping short of its target.
   */
  private boomTarget = GAME_CONFIG.camera.defaultDistance;
  /**
   * How far the boom is squeezed, 0 (free) to 1 (at `MIN_BOOM`).
   *
   * Kept from the previous frame so the pitch lift and the collision ray agree:
   * computing the lift from this frame's boom would need the boom, which needs
   * the ray, which needs the lift. The boom is rate-limited, so last frame's
   * value is a good predictor and the lag is a frame at most.
   */
  private liftSqueeze = 0;

  private lookOffset = new THREE.Vector3(
    GAME_CONFIG.camera.lookOffset.x,
    GAME_CONFIG.camera.lookOffset.y,
    GAME_CONFIG.camera.lookOffset.z
  );
  private currentLookAt = new THREE.Vector3();
  private currentPosition = new THREE.Vector3();

  /** 'third' is the boom; 'first' puts the lens in the head. */
  private mode: ViewMode = 'third';
  /** 0 = fully third person, 1 = fully first person. Damped, not snapped. */
  private viewBlend = 0;
  /** Where the first-person lens is, damped on its own so it never lags a jump. */
  private eyePoint = new THREE.Vector3();
  private targetFov = GAME_CONFIG.camera.fov;
  /** The third-person field of view, which the settings screen can change. */
  private baseFov = GAME_CONFIG.camera.fov;

  // Pointer drag state
  private isDragging = false;
  private lastPointerPos = { x: 0, y: 0 };
  private sensitivity = GAME_CONFIG.camera.mouseSensitivity;
  private scrollSensitivity = GAME_CONFIG.camera.scrollSensitivity;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.setupListeners();
  }

  public setCollision(collision: WorldCollision): void {
    this.collision = collision;
  }

  private setupListeners(): void {
    this.domElement.addEventListener('pointerdown', (e) => {
      // Ignore if clicking UI buttons (shutter, menus)
      if ((e.target as HTMLElement).closest('.interactive-ui')) return;

      this.isDragging = true;
      this.lastPointerPos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;

      const deltaX = e.clientX - this.lastPointerPos.x;
      const deltaY = e.clientY - this.lastPointerPos.y;
      this.lastPointerPos = { x: e.clientX, y: e.clientY };

      this.targetYaw -= deltaX * this.sensitivity;
      this.targetPitch += deltaY * this.sensitivity;

      // Clamp vertical pitch to avoid flipping over or digging through ground
      this.targetPitch = Math.max(
        GAME_CONFIG.camera.minPitch,
        Math.min(GAME_CONFIG.camera.maxPitch, this.targetPitch)
      );
    });

    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });

    window.addEventListener('pointercancel', () => {
      this.isDragging = false;
    });

    this.domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.mode === 'first') {
          // In the head there is no boom to shorten, so the wheel zooms the
          // lens instead — the same gesture, doing the only thing it can.
          this.targetFov = Math.max(
            GAME_CONFIG.camera.minFov,
            Math.min(GAME_CONFIG.camera.maxFov, this.targetFov + e.deltaY * 0.04)
          );
          return;
        }
        this.targetDistance += e.deltaY * this.scrollSensitivity;
        this.targetDistance = Math.max(
          GAME_CONFIG.camera.minDistance,
          Math.min(GAME_CONFIG.camera.maxDistance, this.targetDistance)
        );
      },
      { passive: false }
    );
  }

  /** Switches between the boom and the head. */
  public setMode(mode: ViewMode): void {
    this.mode = mode;
    if (mode === 'third') {
      this.targetFov = this.baseFov;
    }
  }

  /**
   * Mouse look multiplier from the settings screen, 0.4 … 2.5.
   *
   * A multiplier rather than an absolute value so the tuned 0.0035 stays the
   * definition of "1×": a player who never opens the settings gets exactly the
   * feel the game was balanced around.
   */
  public setSensitivity(multiplier: number): void {
    this.sensitivity = GAME_CONFIG.camera.mouseSensitivity * multiplier;
  }

  /** Field of view of the third-person view, in degrees. */
  public setBaseFov(degrees: number): void {
    this.baseFov = degrees;
    // First person keeps its own zoom, which the wheel owns; only the boom view
    // follows the setting, so changing it mid-hunt does not fight the player.
    if (this.mode === 'third') this.targetFov = degrees;
  }

  public toggleMode(): ViewMode {
    this.setMode(this.mode === 'third' ? 'first' : 'third');
    return this.mode;
  }

  public getMode(): ViewMode {
    return this.mode;
  }

  public isFirstPerson(): boolean {
    return this.mode === 'first';
  }

  /**
   * @param targetPosition the body's feet.
   * @param surfaceY height of the ground the body stands on, when it is off it
   *   (mid-jump, mid-fall). The camera aims at this plus a share of the gap, so
   *   it settles onto the terrain instead of being dragged along the arc.
   */
  public update(
    targetPosition: THREE.Vector3,
    deltaSeconds: number,
    surfaceY = targetPosition.y
  ): void {
    const t = Math.min(1.0, GAME_CONFIG.camera.damping * deltaSeconds);
    const tv = Math.min(1.0, GAME_CONFIG.camera.verticalDamping * deltaSeconds);

    // Smooth damp spherical parameters
    this.currentYaw += (this.targetYaw - this.currentYaw) * t;
    this.currentPitch += (this.targetPitch - this.currentPitch) * t;
    this.currentDistance += (this.targetDistance - this.currentDistance) * t;

    // Target look-at point (character chest/head). Horizontal follows the body
    // at the full rate — walking must not lag — while the vertical follows the
    // surface under it, slowly, with a quarter of the jump's lift folded back
    // in so a jump is felt rather than ignored.
    const focusY =
      surfaceY + (targetPosition.y - surfaceY) * GAME_CONFIG.camera.jumpFollow;
    this.currentLookAt.x += (targetPosition.x + this.lookOffset.x - this.currentLookAt.x) * t;
    this.currentLookAt.z += (targetPosition.z + this.lookOffset.z - this.currentLookAt.z) * t;
    this.currentLookAt.y += (focusY + this.lookOffset.y - this.currentLookAt.y) * tv;

    // The boom is a direction and a length, not a point. Keeping the length as
    // its own piece of state is what makes the camera stop juddering: the old
    // code snapped a *position* to the wall and then lerped the camera towards
    // it, so on one frame the lens jumped 4.5 m and on the next it crept back.
    //
    // Two directions: the collision ray uses the pitch the player set, the
    // camera is placed with the lift added. Casting the ray along the lifted
    // direction would close a feedback loop — lifting can clear the obstacle,
    // which extends the boom, which lowers the lift, which puts the obstacle
    // back — and that loop is a sawtooth, i.e. the judder again. A conservative
    // ray cannot oscillate, at the cost of staying short where a raised lens
    // could have seen over the obstruction.
    const baseCosPitch = Math.cos(this.currentPitch);
    const baseSinPitch = Math.sin(this.currentPitch);
    const sinYaw = Math.sin(this.currentYaw);
    const cosYaw = Math.cos(this.currentYaw);

    const rayX = baseCosPitch * sinYaw;
    const rayY = baseSinPitch;
    const rayZ = baseCosPitch * cosYaw;

    const pitch = this.currentPitch + this.liftSqueeze * BOOM_LIFT_PITCH;
    const dirX = Math.cos(pitch) * sinYaw;
    const dirY = Math.sin(pitch);
    const dirZ = Math.cos(pitch) * cosYaw;

    const ideal = this.currentDistance;
    let allowed = ideal + BOOM_MARGIN;
    if (this.collision) {
      // The ray reaches `BOOM_MARGIN` past the boom, not exactly to its end, so
      // that "nothing in the way" and "a surface right at the end" are different
      // answers. Without the extra reach both come back as the boom length and
      // the camera sits 20 cm short of the zoom the player asked for, forever.
      const reach = ideal + BOOM_MARGIN;
      _boomEnd.set(
        this.currentLookAt.x + rayX * reach,
        this.currentLookAt.y + rayY * reach,
        this.currentLookAt.z + rayZ * reach
      );
      allowed = this.collision.cameraDistance(this.currentLookAt, _boomEnd);
    }

    // The margin only applies once something is actually in the way: in open
    // air the boom is exactly the zoom the player asked for, and subtracting a
    // fixed 20 cm there left the camera permanently a little too close.
    // `min(ideal, ...)` keeps the two branches continuous at the point where the
    // obstruction first reaches the end of the boom.
    const wanted = Math.min(ideal, Math.max(MIN_BOOM, allowed - BOOM_MARGIN));

    // Hysteresis on the *target*, not on the gap. Moving the target outward in
    // steps of at least a dead band stops the boom tracking every wobble of the
    // ray, while the boom itself always converges to the target — a dead band on
    // the gap instead leaves the camera permanently short of its proper length.
    if (wanted < this.boomTarget || wanted > this.boomTarget + BOOM_OUT_DEADBAND) {
      this.boomTarget = wanted;
    }

    // In fast, out slowly. Both directions are rate-limited, for the same
    // reason: the boom length is derived from a ray intersection, and a ray that
    // grazes a corner slides along it far faster than the body walks.
    const gap = this.boomTarget - this.boomDistance;
    if (gap < 0) {
      const step = BOOM_IN_SPEED * deltaSeconds;
      this.boomDistance = Math.max(this.boomTarget, this.boomDistance - step);
    } else if (gap > 0) {
      const outT = 1 - Math.exp(-BOOM_OUT_RATE * deltaSeconds);
      this.boomDistance += gap * outT;
      if (this.boomDistance > this.boomTarget) this.boomDistance = this.boomTarget;
    }

    _thirdPos.set(
      this.currentLookAt.x + dirX * this.boomDistance,
      this.currentLookAt.y + dirY * this.boomDistance,
      this.currentLookAt.z + dirZ * this.boomDistance
    );
    this.currentPosition.copy(_thirdPos);

    // How much the world cut the boom this frame, for next frame's lift. The
    // rate limits above make this a smooth signal, so the pitch it drives never
    // steps.
    this.liftSqueeze = ideal > 1e-3
      ? Math.max(0, Math.min(1, 1 - this.boomDistance / ideal))
      : 0;

    if (this.collision) {
      const groundY = this.collision.terrainHeight(
        this.currentPosition.x,
        this.currentPosition.z
      );
      if (groundY !== null && this.currentPosition.y < groundY + GROUND_CLEARANCE) {
        this.currentPosition.y = groundY + GROUND_CLEARANCE;
      }
    }

    // The lens, when there is one in the head. It follows the body's own
    // height rather than the damped focus: a first-person view that eases
    // vertically is a view that lags a jump by half a second.
    _eye.set(targetPosition.x, targetPosition.y + EYE_HEIGHT, targetPosition.z);
    if (this.viewBlend < 0.001) this.eyePoint.copy(_eye);
    else this.eyePoint.lerp(_eye, Math.min(1, tv * 1.6));

    const wantBlend = this.mode === 'first' ? 1 : 0;
    this.viewBlend += (wantBlend - this.viewBlend) * Math.min(1, VIEW_BLEND_RATE * deltaSeconds);
    if (Math.abs(wantBlend - this.viewBlend) < 0.002) this.viewBlend = wantBlend;

    // Zoom is the field of view in first person and the boom in third; both
    // are damped the same way so the wheel never steps.
    if (Math.abs(this.targetFov - this.camera.fov) > 0.01) {
      this.camera.fov += (this.targetFov - this.camera.fov) * Math.min(1, 10 * deltaSeconds);
      this.camera.updateProjectionMatrix();
    }

    if (this.viewBlend <= 0) {
      this.camera.position.copy(this.currentPosition);
      this.camera.lookAt(this.currentLookAt);
      return;
    }

    // Aiming: the boom looks *back* along its own direction at the body, so a
    // lens in the head has to look the other way down the same axis.
    _viewDir.set(
      Math.cos(this.currentPitch) * sinYaw,
      Math.sin(this.currentPitch),
      Math.cos(this.currentPitch) * cosYaw
    );
    _eyeTarget.copy(this.eyePoint).addScaledVector(_viewDir, -1);

    this.camera.position.lerpVectors(this.currentPosition, this.eyePoint, this.viewBlend);
    _lookTarget.copy(this.currentLookAt).lerp(_eyeTarget, this.viewBlend);
    this.camera.lookAt(_lookTarget);
  }

  public getYaw(): number {
    return this.currentYaw;
  }

  /**
   * Places the camera where `update` would settle it, with nothing left to
   * interpolate.
   *
   * Used after a teleport — a map change puts the body a hundred metres from
   * where it was, and a damped camera spends the next second flying across the
   * new map to reach it. `deltaSeconds` large enough to saturate every damping
   * factor is the same maths as one frame of `update`, so there is no second
   * copy of the spherical-to-cartesian code to keep in sync.
   */
  public snap(targetPosition: THREE.Vector3, surfaceY = targetPosition.y): void {
    this.update(targetPosition, 1e6, surfaceY);
  }

  public getPitch(): number {
    return this.currentPitch;
  }

  /**
   * Length of the boom, in metres.
   *
   * The establishing shot interpolates in the same spherical terms the boom
   * uses — yaw, pitch, distance — so it needs the third one to land exactly
   * where `update` would have put the lens.
   */
  public getDistance(): number {
    return this.currentDistance;
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }
}
