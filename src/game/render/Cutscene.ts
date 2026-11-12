import * as THREE from 'three';

/**
 * The three seconds before a hunt: the camera drops out of the sky onto the map.
 *
 * A map starts with a jump cut — loading screen, then the player standing
 * somewhere — and the first thing a player does is spend a second working out
 * where they are. An establishing shot answers that before they touch a key:
 * the lens starts high and off to one side, falls toward the body while turning
 * to face the way the player will be looking, and hands over to the boom camera
 * exactly where the boom camera would have been.
 *
 * ## Why it lands rather than cuts
 *
 * The end pose is not approximated, it is *captured*: the boom camera is placed
 * first, its position and orientation are read, and the descent interpolates
 * into them. The last frame of the cutscene and the first frame of play are the
 * same frame, so there is nothing to blend and nothing to snap. Anything else —
 * a fade, a lerp over the first second of play — is a visible seam.
 *
 * ## Why it is spherical
 *
 * The camera moves in yaw, pitch and distance around the body rather than along
 * a straight line. A straight line from a high corner to a low shoulder passes
 * through the world, and on a map with a roof over the spawn it passes through
 * that too. Orbiting keeps the body centred — and, since a dense city street is
 * still a place where a twenty-six-metre lens can be inside a tenement, the
 * start pose is chosen against the collider rather than assumed. See
 * `START_CANDIDATES`.
 */

/** Seconds from the first frame to the handover. */
const DURATION = 3.0;

/**
 * Where the descent may start, best first: yaw offset, pitch, distance.
 *
 * One fixed start does not survive contact with the kits. Twenty-six metres out
 * and ten up is a beautiful establishing shot on a lake and the inside of a
 * tenement on a city street — the shot opened on the back of a fire escape with
 * the map visible down one side of the frame. So the start is *chosen*: the
 * first of these whose lens and whose whole descent are clear of geometry wins,
 * and the list ends with a short, steep, nearly overhead drop that no map with a
 * roof over the spawn can block.
 */
const START_CANDIDATES: readonly { yaw: number; pitch: number; distance: number }[] = [
  { yaw: 0.85, pitch: 0.62, distance: 26 },
  { yaw: -0.85, pitch: 0.62, distance: 26 },
  { yaw: 1.5, pitch: 0.55, distance: 20 },
  { yaw: -1.5, pitch: 0.55, distance: 20 },
  { yaw: 0.85, pitch: 0.9, distance: 14 },
  { yaw: 0, pitch: 1.2, distance: 9 },
];

/** The point on the body the lens looks at, in metres above the feet. */
const FOCUS_LIFT = 1.35;

/** Height at which the title card appears, as a fraction of the descent. */
const TITLE_AT = 0.18;

/**
 * How close to the lens a wall may be and still count as "not in the way".
 *
 * The same 0.35 m near-miss the hunt allows: a prop clipping the edge of the
 * frame is a prop, and a camera half a metre from a wall is a wall.
 */
const CLEARANCE = 0.6;

/** Fractions of the descent that are tested, as well as its start. */
const PROBES = [0.35, 0.7];

function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  // Ease-out cubic: fast at the start, settling at the end. The descent should
  // feel like it is arriving, not like it is being lowered.
  return 1 - (1 - x) ** 3;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const _focus = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _look = new THREE.Quaternion();
const _end = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class Cutscene {
  private running = false;
  private elapsed = 0;

  /** The boom pose the descent lands on. */
  private endPosition = new THREE.Vector3();
  private endQuaternion = new THREE.Quaternion();
  private endYaw = 0;
  private endPitch = 0;
  private endDistance = 8;

  /** The chosen start pose, in the same terms the boom uses. */
  private startYaw = START_CANDIDATES[0].yaw;
  private startPitch = START_CANDIDATES[0].pitch;
  private startDistance = START_CANDIDATES[0].distance;

  public get isRunning(): boolean {
    return this.running;
  }

  /**
   * Captures the boom pose and starts the descent.
   *
   * `yaw`, `pitch` and `distance` are the camera controller's own numbers, so
   * the start of the flight is described in the same terms the boom uses and
   * the two cannot disagree about where "behind the player" is.
   *
   * `raycast` is the collider's segment test, and it is what keeps the shot out
   * of the walls: every candidate start is checked against it, along with two
   * points on the way down. Returns false when even the shortest drop is
   * blocked — a map with the spawn under a low roof — and the caller should
   * then play the round with no establishing shot at all rather than open on
   * the inside of a ceiling.
   */
  public start(
    playerPosition: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    yaw: number,
    pitch: number,
    distance: number,
    raycast?: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number | null
  ): boolean {
    this.endYaw = yaw;
    this.endPitch = pitch;
    this.endDistance = distance;
    this.endPosition.copy(camera.position);
    this.endQuaternion.copy(camera.quaternion);

    const chosen = this.pickStart(playerPosition, raycast);
    if (!chosen) {
      this.running = false;
      return false;
    }

    this.startYaw = chosen.yaw;
    this.startPitch = chosen.pitch;
    this.startDistance = chosen.distance;
    this.running = true;
    this.elapsed = 0;
    return true;
  }

  /**
   * The first start pose whose whole descent is clear of geometry.
   *
   * Each candidate is tested as three segments from the body outwards: the
   * start of the flight and two points along it. Testing only the start would
   * let the lens begin in the open and pass straight through a wall on the way
   * down, which is worse than starting in one — the map appears, and then the
   * screen is a wall for a second.
   */
  private pickStart(
    playerPosition: THREE.Vector3,
    raycast?: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number | null
  ): { yaw: number; pitch: number; distance: number } | null {
    if (!raycast) return START_CANDIDATES[0];

    _focus.set(playerPosition.x, playerPosition.y + FOCUS_LIFT, playerPosition.z);
    for (const candidate of START_CANDIDATES) {
      let clear = true;
      for (const eased of [0, ...PROBES]) {
        this.orbit(candidate, playerPosition, eased, _pos);
        if (!this.sees(_focus, _pos, raycast)) {
          clear = false;
          break;
        }
      }
      if (clear) return candidate;
    }
    return null;
  }

  /** True when nothing solid sits between the body and a point on the flight. */
  private sees(
    focus: THREE.Vector3,
    point: THREE.Vector3,
    raycast: (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => number | null
  ): boolean {
    const span = focus.distanceTo(point);
    if (span < 0.01) return true;
    const hit = raycast(focus.x, focus.y, focus.z, point.x, point.y, point.z);
    if (hit === null || hit === undefined) return true;
    return hit * span > span - CLEARANCE;
  }

  /**
   * Where the lens is at a given point of the descent.
   *
   * `eased` runs 0…1 from the start of the flight to the handover. The same
   * spherical placement the boom camera uses, so the two cannot disagree about
   * what "eight metres behind the player" means.
   */
  private orbit(
    pose: { yaw: number; pitch: number; distance: number },
    playerPosition: THREE.Vector3,
    eased: number,
    out: THREE.Vector3
  ): THREE.Vector3 {
    const yaw = this.endYaw + pose.yaw * (1 - eased);
    const pitch = this.endPitch + (pose.pitch - this.endPitch) * (1 - eased);
    const distance = this.endDistance + (pose.distance - this.endDistance) * (1 - eased);
    const cosPitch = Math.cos(pitch);
    return out.set(
      playerPosition.x + cosPitch * Math.sin(yaw) * distance,
      playerPosition.y + Math.sin(pitch) * distance,
      playerPosition.z + cosPitch * Math.cos(yaw) * distance
    );
  }

  /**
   * One frame. Returns false once the cutscene has handed the camera back.
   *
   * `playerPosition` is read every frame rather than captured: the body is
   * placed at the spawn before this starts, and a map whose spawn settles on
   * the first frames would otherwise leave the camera orbiting a point the
   * player is no longer standing on.
   */
  public update(
    delta: number,
    camera: THREE.PerspectiveCamera,
    playerPosition: THREE.Vector3
  ): boolean {
    if (!this.running) return false;

    this.elapsed += delta;
    const t = Math.min(1, this.elapsed / DURATION);
    const eased = ease(t);

    this.orbit(
      { yaw: this.startYaw, pitch: this.startPitch, distance: this.startDistance },
      playerPosition,
      eased,
      _pos
    );

    _focus.set(playerPosition.x, playerPosition.y + FOCUS_LIFT, playerPosition.z);

    // Orientation: look at the body for the whole descent, then settle into the
    // boom's own aim over the last quarter. Both are looking at the player, so
    // the two are a few degrees apart and the change is invisible.
    _m.lookAt(_pos, _focus, camera.up);
    _look.setFromRotationMatrix(_m);
    camera.position.copy(_pos);
    camera.quaternion.copy(_look);
    const settle = smoothstep(0.72, 1, eased);
    if (settle > 0) {
      _end.copy(this.endQuaternion);
      camera.quaternion.slerp(_end, settle);
      camera.position.lerp(this.endPosition, settle * settle);
    }

    if (t >= 1) {
      this.running = false;
      camera.position.copy(this.endPosition);
      camera.quaternion.copy(this.endQuaternion);
      return false;
    }
    return true;
  }

  /** Hands the camera back immediately, e.g. because the player pressed a key. */
  public skip(camera: THREE.PerspectiveCamera): void {
    if (!this.running) return;
    this.running = false;
    camera.position.copy(this.endPosition);
    camera.quaternion.copy(this.endQuaternion);
  }

  /** True while the title card should be on screen. */
  public wantsTitle(): boolean {
    return this.running && this.elapsed / DURATION >= TITLE_AT;
  }
}
