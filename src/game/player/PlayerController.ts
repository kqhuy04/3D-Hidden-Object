import * as THREE from 'three';
import { CharacterAnimator, Gait } from './CharacterAnimator';
import { CircleContact } from '../world/CollisionGeometry';
import { WorldCollision, ClimbVolume } from '../world/WorldCollision';
import { GAME_CONFIG } from '../../data/gameConfig';

/** Scratch vector for the collision call; keeps the jump lift out of physics. */
const _groundProbe = new THREE.Vector3();
/** Zero-length move: asks the resolver to settle the body where it stands. */
const _noMovement = new THREE.Vector3();
/**
 * Scratch for this frame's step.
 *
 * The resolver copies the position it is given and only reads the movement, so
 * a shared vector is safe here — and a walk is 60 of these a second, which is
 * 60 objects a second the collector has to sweep for no reason.
 */
const _movementDelta = new THREE.Vector3();

/**
 * Floor for the slope speed correction, as a fraction of the flat speed.
 *
 * Walking up a slope at a constant *horizontal* speed means the body's speed
 * along the ground grows with 1/cos(slope): measured on the forest hill, 0.080 m
 * across and 0.122 m up per frame, i.e. 1.8x the flat speed, which is exactly
 * the "it suddenly walks faster uphill" that was reported. Scaling by cos(slope)
 * makes the distance travelled *along the surface* the constant instead.
 *
 * A cliff face should slow the walk, not stop it, so the correction is floored
 * at 0.55 — about a 57° slope.
 */
const MIN_SLOPE_SCALE = 0.55;

/**
 * How far ahead the ground is sampled to read the slope, in metres.
 *
 * Measured before the step is taken, not after it, because a *previous*-frame
 * gradient is always one frame stale: walking off the flat onto the forest hill
 * the first slope frame still used the flat reading and lunged 0.146 m instead
 * of 0.080 m. A 0.3 m lead is short enough to describe the ground underfoot and
 * long enough that a single 2 cm plank gap cannot swing the reading.
 */
const SLOPE_PROBE = 0.3;

/**
 * How far the ground must be below the height the jump started from before the
 * clip's landing cushion stops counting as a landing, in metres.
 *
 * The authored cushion travels about 5 cm and lands the body where it took off.
 * Ground further down than that means the jump is going over a ledge, and the
 * cushion played there is a stall in mid-air. A jump that lands back on its own
 * ground — flat, a slope, the deck it started on — is untouched.
 */
const CUSHION_SKIP = 0.12;

/**
 * Gradient at which a walk becomes a climb, as rise over run.
 *
 * A staircase is a series of flat treads and vertical risers, so a per-frame
 * reading alternates between "flat" and "up" several times a second — the
 * gradient test alone needs `STAIR_MIN_RISE` beside it to tell a stair from a
 * hillside.
 */
const STAIR_GRADIENT = 0.45;

/**
 * Rise over one frame below which nothing is a stair, in metres.
 *
 * This is the fix for the character sitting down on a beach. The `down` clip is
 * a deep crouch, and it was being chosen from gradient alone: walking down the
 * lakeside slope at 4.8 m/s covers 8 cm per frame and drops 2.4 cm, which is
 * 0.30 rise over run — over the old 0.30 threshold, so every step downhill on
 * the sand played a sit.
 *
 * It was 0.07, which is still far below a real riser, and that is what made the
 * western map's ravine play the stair-descent clip. Measured walking into that
 * ravine: the body creeps 2 cm a frame against the wall while the jagged
 * ground drops 9-17 cm under it, so every one of those drops looked like a
 * step. A kit's stair risers are 0.34-0.47 m; 0.20 m is the smallest thing
 * worth playing a staircase for, and it excludes all of them.
 */
const STAIR_MIN_RISE = 0.2;

/**
 * Rise over one frame above which it is a cliff rather than a stair, in metres.
 *
 * No step in any kit is over half a metre, so a frame that drops more than that
 * is the body falling off something, and the fall is what should play.
 */
const STAIR_MAX_RISE = 0.6;

/** Capsule height while crawling, in metres. Low enough for a vent, high enough
 *  to keep the camera and the reach test sensible. */
const CRAWL_HEIGHT = 0.75;

/**
 * How far below the top of the capsule the eyes are, in metres.
 *
 * The first-person lens used to be a constant 1.62 m, which is correct for a
 * 1.75 m standing capsule and wrong for everything else: pressing C put the
 * body on its forearms and left the camera looking over the top of it. Reading
 * the eye from the capsule means the crawl lowers the view by construction.
 */
const EYE_DROP = 0.13;

/** How fast a ladder is climbed, in metres per second. */
const CLIMB_SPEED = 1.4;

/**
 * How fast the body slides onto the rungs once it has grabbed a ladder, m/s.
 *
 * The grab footprint has to be wide enough for a body stopped by the rungs to
 * count as "at the foot of it", which puts it up to half a metre off the rung
 * line. Rising from there is the "climbing in mid-air" that was reported beside
 * the farm's silo: the body climbed six metres with nothing under it and a
 * metre of daylight between it and the ladder. It now steps onto the rungs
 * first — at 3.5 m/s that is a fifth of a second, which reads as grabbing on.
 */
const CLIMB_SLIDE_SPEED = 3.5;

/** Distance from the rung line, in metres, at which the climb proper starts. */
const CLIMB_ON_RUNGS = 0.12;

/**
 * How much of the input must point at the ladder before it grabs.
 *
 * A ladder's footprint is a box around its rungs, so without this a player
 * walking along a wall grabbed every ladder they merely passed — and then rode
 * it upwards. 0.35 is about seventy degrees, so brushing past at an angle still
 * works while walking parallel does not.
 */
const CLIMB_APPROACH = 0.35;

export class PlayerController {
  private characterGroup: THREE.Group;
  private animator: CharacterAnimator;
  private collision: WorldCollision;

  private targetRotationY = 0;
  private currentRotationY = 0;
  private walkSpeed = GAME_CONFIG.player.walkSpeed;
  private lastContacts: CircleContact[] = [];

  /** Surface the body stands on: terrain, or a deck/bridge underfoot. */
  private groundY = 0;
  /** Actual height of the feet. Equals groundY unless jumping or falling. */
  private feetY = 0;
  /** Ground height when the current jump started; the arc is measured from it. */
  private takeoffY = 0;
  /** Downward speed while falling off a ledge, in m/s. */
  private fallSpeed = 0;
  private falling = false;

  /** Player asked to crawl; the capsule follows unless a ceiling refuses it. */
  private crawlWanted = false;
  private crawling = false;
  /** Shift is a mode, not a hold: walking and running are two gears. */
  private running = false;
  /** Height the capsule is currently standing at, so it is only touched on change. */
  private capsuleHeight = GAME_CONFIG.player.capsuleHeight;

  /** Non-null while the body is on a ladder. */
  private climbVolume: ClimbVolume | null = null;
  /** Horizontal spot held while climbing, so the body stays on the rungs. */
  private climbX = 0;
  private climbZ = 0;
  /**
   * Lowest height the current climb may descend to.
   *
   * Normally the ladder's own bottom rung, but not always: a kit can hang a
   * ladder so its lowest rung is well above the ground — the campground's is
   * 0.72 m up — and starting the climb at the rung instead of at the feet
   * teleported the body upwards the moment it grabbed on. The climb starts
   * wherever the body is and treats that as the floor.
   */
  private climbFloor = 0;

  /** What the body was doing last frame, for the animation. */
  private gait: Gait = 'flat';
  /** How long the current up/down gait is held through a flat tread. */
  private gaitHold = 0;
  private gaitHoldValue: Gait = 'flat';

  constructor(
    characterGroup: THREE.Group,
    animator: CharacterAnimator,
    collision: WorldCollision
  ) {
    this.characterGroup = characterGroup;
    this.animator = animator;
    this.collision = collision;
    this.groundY = characterGroup.position.y;
    this.feetY = this.groundY;
  }

  public update(
    inputDirection: THREE.Vector2,
    cameraYaw: number,
    deltaSeconds: number,
    jumpRequested = false
  ): void {
    // 0. Crouch state. The capsule has to change before anything moves, or the
    //    frame the player presses C is resolved against the standing body and
    //    the crawl starts a frame late — which reads as "C did nothing".
    this.applyCrawlState();
    if (this.gaitHold > 0) this.gaitHold = Math.max(0, this.gaitHold - deltaSeconds);

    // 1. A ladder owns the body completely: no gravity, no horizontal move, and
    //    no jump. Climbing is a state, not a modifier.
    if (this.climbVolume) {
      this.updateClimb(inputDirection, deltaSeconds);
      this.animator.update(deltaSeconds);
      return;
    }

    // 2. Walking into a ladder's footprint starts the climb. The check comes
    //    before movement so the first frame of the climb does not also shove
    //    the body forward into the rungs.
    if (this.tryEnterClimb(inputDirection, cameraYaw)) {
      this.updateClimb(inputDirection, deltaSeconds);
      this.animator.update(deltaSeconds);
      return;
    }

    if (jumpRequested && !this.animator.isJumping() && this.animator.startJump()) {
      // The arc is authored relative to the ground the jump starts from, so a
      // jump off a dock still comes back down to the dock, then falls.
      this.takeoffY = this.groundY;
      this.fallSpeed = 0;
      this.falling = false;
    }

    const inputLength = inputDirection.length();
    // The crouch and the landing have both feet planted; moving then is what
    // reads as sliding. The animator decides, because only it knows the phase.
    const moveScale = this.animator.getMoveScale();
    const groundBefore = this.groundY;

    if (inputLength > 0.05) {
      // Normalize input so diagonal movement is not faster than straight
      const normalizedInput = inputDirection.clone().normalize();

      // Transform input direction based on camera yaw
      // Camera yaw: 0 faces +Z, PI faces -Z
      // The camera sits at player + (sin yaw, cos yaw) * distance and looks
      // back at the player, so "forward" is the opposite of that offset:
      // negate input.y to walk away from the camera (W into the screen).
      const moveAngle = Math.atan2(normalizedInput.x, -normalizedInput.y) + cameraYaw;

      const nominalStep = this.moveSpeed() * deltaSeconds * moveScale;
      const step = nominalStep * this.slopeScale(moveAngle, nominalStep);
      const moveX = Math.sin(moveAngle) * step;
      const moveZ = Math.cos(moveAngle) * step;

      const movementDelta = _movementDelta.set(moveX, 0, moveZ);

      // Resolve movement with the capsule collider: sub-stepped, pushed out of
      // real mesh triangles, sliding along surfaces. The probe carries the
      // standing ground; the body's own height is passed separately so the
      // collision band follows the body when it is off the ground.
      _groundProbe.set(this.characterGroup.position.x, this.groundY, this.characterGroup.position.z);
      const result = this.collision.moveCapsule(
        _groundProbe,
        movementDelta,
        undefined,
        this.feetY
      );
      const nextPos = result.position;
      this.lastContacts = result.contacts;

      // Actual speed calculation
      const actualDx = nextPos.x - _groundProbe.x;
      const actualDz = nextPos.z - _groundProbe.z;
      const actualSpeed = Math.hypot(actualDx, actualDz) / deltaSeconds;

      this.groundY = nextPos.y;
      this.characterGroup.position.x = nextPos.x;
      this.characterGroup.position.z = nextPos.z;

      // Smooth character rotation toward movement direction
      this.targetRotationY = moveAngle;
      let angleDiff = this.targetRotationY - this.currentRotationY;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      const rotSpeed = GAME_CONFIG.player.rotationSpeed;
      this.currentRotationY += angleDiff * Math.min(1.0, rotSpeed * deltaSeconds);
      this.characterGroup.rotation.y = this.currentRotationY;

      // Which cycle the feet should be in, from the ground that was actually
      // walked rather than from the map's idea of what is under it.
      this.gait = this.resolveGait(Math.hypot(actualDx, actualDz), this.groundY - groundBefore);
      this.animator.locomotion(actualSpeed, true, this.gait, this.running);
    } else {
      // Idle state
      this.gait = this.crawling ? 'crawl' : 'flat';
      this.animator.locomotion(0, false, this.gait);
      this.lastContacts.length = 0;

      // Settle on whatever is actually underfoot. A plain terrain sample would
      // drop a player standing still on a boardwalk or dock through the deck,
      // because the deck is not terrain; the resolver already knows how to
      // prefer a standable surface within step height, so ask it with a
      // zero-length move.
      _groundProbe.set(
        this.characterGroup.position.x,
        this.groundY,
        this.characterGroup.position.z
      );
      this.groundY = this.collision.moveCapsule(
        _groundProbe,
        _noMovement,
        undefined,
        this.feetY
      ).position.y;
    }

    this.animator.update(deltaSeconds);
    this.resolveVertical(deltaSeconds);
  }

  /**
   * Chooses the gait from the ground the body just walked over.
   *
   * The measurement is `rise / run` over one frame, which is exactly the
   * gradient of the surface — a staircase gives about 0.6, a hill 0.15. The
   * hysteresis matters: a staircase is a series of flat treads and vertical
   * risers, so a per-frame reading flips between "flat" and "up" several times
   * a second, and the clip would restart on every tread.
   */
  private resolveGait(travelled: number, rise: number): Gait {
    if (this.crawling) return 'crawl';

    let next: Gait = 'flat';
    const riseMagnitude = Math.abs(rise);
    if (
      travelled > 1e-4 &&
      riseMagnitude >= STAIR_MIN_RISE &&
      riseMagnitude <= STAIR_MAX_RISE
    ) {
      const gradient = rise / travelled;
      if (gradient > STAIR_GRADIENT) next = 'up';
      else if (gradient < -STAIR_GRADIENT) next = 'down';
    }

    if (next !== 'flat') {
      this.gaitHold = 0.22;
      this.gaitHoldValue = next;
      return next;
    }
    if (this.gaitHold > 0) return this.gaitHoldValue;
    return 'flat';
  }

  /**
   * Applies the crawl the player asked for, unless the body is under something.
   *
   * Standing up inside a vent would put the head inside the geometry and the
   * capsule would then be pushed out of the map. The ceiling is checked with a
   * ray from the crawl height to the standing height: anything in between is
   * something the body would have to stand *through*.
   */
  private applyCrawlState(): void {
    if (this.crawlWanted === this.crawling) return;

    if (this.crawlWanted) {
      this.setCrawling(true);
      return;
    }

    if (!this.hasHeadroom()) {
      // Keep the request alive so the player does not have to press C twice.
      this.crawlWanted = true;
      return;
    }
    this.setCrawling(false);
  }

  private hasHeadroom(): boolean {
    const geometry = this.collision.getCollisionGeometry();
    if (!geometry) return true;
    const p = this.characterGroup.position;
    const from = this.feetY + CRAWL_HEIGHT;
    const to = this.feetY + GAME_CONFIG.player.capsuleHeight + 0.1;
    return geometry.raycastSegment(p.x, from, p.z, p.x, to, p.z) === null;
  }

  private setCrawling(on: boolean): void {
    this.crawling = on;
    this.capsuleHeight = on ? CRAWL_HEIGHT : GAME_CONFIG.player.capsuleHeight;
    this.collision.setCapsule({ height: this.capsuleHeight });
  }

  /** C toggles this; the controller decides whether it is allowed. */
  public setCrawl(on: boolean): void {
    this.crawlWanted = on;
  }

  public isCrawling(): boolean {
    return this.crawling;
  }

  /** Shift toggles this. Running is a gear, so it survives standing still. */
  public setRunning(on: boolean): void {
    this.running = on;
  }

  /**
   * Turns the body to a heading on the spot.
   *
   * Used when the rod comes out: the player is about to cast at whatever the
   * camera is pointing at, and a body that swivels 180° over the first half
   * second of the animation would drag the rod across the screen.
   */
  public setFacing(yaw: number): void {
    this.targetRotationY = yaw;
    this.currentRotationY = yaw;
    this.characterGroup.rotation.y = yaw;
  }

  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Ground speed for this frame, in m/s.
   *
   * Three gears rather than one: a crawl is a third of a walk because the body
   * is on its forearms, and a run is most of twice a walk. The run is only ever
   * a *speed* — the clip is chosen from the same number in the animator, so the
   * two cannot disagree about which gear the player is in.
   */
  private moveSpeed(): number {
    if (this.crawling) return this.walkSpeed * GAME_CONFIG.player.crawlMultiplier;
    if (this.running) return this.walkSpeed * GAME_CONFIG.player.runMultiplier;
    return this.walkSpeed;
  }

  public getGait(): Gait {
    return this.gait;
  }

  /**
   * Advances the animation without moving the body.
   *
   * Fishing freezes the controller — the feet are planted and the rod owns the
   * whole body — but the mixer still has to run or the cast would be a still
   * frame. Everything the controller does on its own (gravity, collision, the
   * walk cycle) is deliberately skipped.
   */
  public poseOnly(deltaSeconds: number): void {
    this.animator.update(deltaSeconds);
  }

  public isClimbing(): boolean {
    return this.climbVolume !== null;
  }

  /**
   * Starts a climb if the body is standing at the foot of a ladder.
   *
   * Beyond "inside the footprint": the player has to be pushing *at* the ladder
   * (otherwise walking past one sticks to it), there has to be at least half a
   * metre of ladder left above the feet (otherwise the body is already at the
   * top and climbing would be a twitch), and the climb has to start at the foot
   * of the ladder — a compound prop can report several runs of rungs, the
   * watchtower's platform railings are one, and without that test a body on the
   * ground grabbed a railing eight metres up and snapped to it.
   */
  private tryEnterClimb(inputDirection: THREE.Vector2, cameraYaw: number): boolean {
    if (inputDirection.length() < 0.3) return false;

    const p = this.characterGroup.position;
    const volume = this.collision.climbVolumeAt(p.x, p.z);
    if (!volume) return false;
    if (volume.top - this.feetY < 0.6) return false;
    if (this.feetY > volume.top - 0.4) return false;
    if (Math.abs(this.feetY - volume.bottom) > 1.2) return false;

    // Pushing at the ladder, not merely near it. Same camera-relative
    // convention as the movement itself.
    const centreX = (volume.minX + volume.maxX) / 2;
    const centreZ = (volume.minZ + volume.maxZ) / 2;
    const toX = centreX - p.x;
    const toZ = centreZ - p.z;
    const reach = Math.hypot(toX, toZ);
    if (reach > 1e-4) {
      const moveAngle = Math.atan2(inputDirection.x, -inputDirection.y) + cameraYaw;
      const toward = (Math.sin(moveAngle) * toX + Math.cos(moveAngle) * toZ) / reach;
      if (toward < CLIMB_APPROACH) return false;
    }

    this.climbVolume = volume;
    // Where the rungs are. The climb slides the body onto this line before it
    // moves vertically, so it can never rise beside the ladder.
    this.climbX = centreX;
    this.climbZ = centreZ;
    // Start from the feet, not from the rung: see `climbFloor`.
    this.climbFloor = Math.min(volume.bottom, this.feetY);
    this.falling = false;
    this.fallSpeed = 0;
    return true;
  }

  /**
   * W climbs, S descends, and nothing else moves.
   *
   * The horizontal position is *not* snapped to the ladder's centre on the
   * frame the body grabs it: the grab footprint is padded by the body's radius,
   * so a snap would slide the body sideways the instant it touched the rungs.
   * It slides there instead, and the rungs do not turn until it has arrived —
   * see `CLIMB_SLIDE_SPEED`.
   */
  private updateClimb(inputDirection: THREE.Vector2, deltaSeconds: number): void {
    const volume = this.climbVolume;
    if (!volume) return;

    const p = this.characterGroup.position;

    // Step onto the rungs first. Until the body is on the line, W and S do
    // nothing: climbing from a metre out is what put the player in mid-air.
    const offX = this.climbX - p.x;
    const offZ = this.climbZ - p.z;
    const off = Math.hypot(offX, offZ);
    if (off > CLIMB_ON_RUNGS) {
      // The whole remaining distance, not the distance past the threshold: a
      // step of `off - CLIMB_ON_RUNGS` shrinks to zero as it arrives, so the
      // body parks exactly 12 cm out with the comparison still true and never
      // climbs at all. Stepping by `off` crosses the threshold in one frame.
      const slide = Math.min(off, CLIMB_SLIDE_SPEED * deltaSeconds);
      p.x += (offX / off) * slide;
      p.z += (offZ / off) * slide;
      p.y = this.feetY;
      this.gait = 'climb';
      this.animator.locomotion(CLIMB_SPEED, true, 'climb');
      return;
    }

    const up = inputDirection.y;
    this.feetY = Math.min(
      volume.top,
      Math.max(this.climbFloor, this.feetY + up * CLIMB_SPEED * deltaSeconds)
    );
    this.groundY = this.feetY;
    this.characterGroup.position.y = this.feetY;
    this.gait = 'climb';
    this.animator.locomotion(Math.abs(up) * CLIMB_SPEED, Math.abs(up) > 0.05, 'climb');

    if (this.feetY >= volume.top - 0.02 && up > 0) {
      this.exitClimbAtTop(volume);
    } else if (this.feetY <= this.climbFloor + 0.02 && up < 0) {
      // Back on the floor: hand the body back to gravity.
      this.climbVolume = null;
      this.groundY = this.collision.getGroundHeight(p.x, p.z);
      this.feetY = this.groundY;
    }
  }

  /** Steps off the top rung onto whatever is up there. */
  private exitClimbAtTop(volume: ClimbVolume): void {
    const p = this.characterGroup.position;
    this.climbVolume = null;

    const spawn = this.collision.findSpawn({ x: p.x, y: volume.top + 0.7, z: p.z }, 3);
    if (spawn) {
      this.setPosition(spawn.x, spawn.y + 0.05, spawn.z);
      return;
    }
    // Nothing walkable up there: stay at the top rung rather than fall.
    this.feetY = volume.top;
    this.groundY = volume.top;
    this.characterGroup.position.y = volume.top;
  }

  /**
   * Vertical placement, in four states: riding the jump arc, hanging on the
   * clip's contact frame while the body falls to a lower landing, falling off a
   * ledge, or standing on the ground.
   *
   * The jump arc is measured from the take-off ground, so jumping off a dock
   * comes back to the dock's height and only then starts falling. Falling is
   * integrated rather than snapping straight to the ground: a 1.5 m drop used
   * to teleport the body, which read as a glitch on the docks.
   *
   * Jumping off a height finishes the arc in mid-air, because the arc only
   * ever reaches back down to where it started. The body has to keep falling
   * from there — the clip is held on its last airborne frame while it does,
   * and its landing absorb starts on touchdown. Clamping the body to the
   * lower ground instead (what `Math.max(arc, groundY)` alone does) played the
   * whole landing crouch with the feet hanging over the drop.
   */
  private resolveVertical(deltaSeconds: number): void {
    const stepDown = GAME_CONFIG.player.stepDown;

    if (this.animator.isJumping()) {
      if (this.animator.isJumpHeld()) {
        // The arc is spent and the landing is still below: fall to it.
        this.fallSpeed += GAME_CONFIG.player.gravity * deltaSeconds;
        this.feetY -= this.fallSpeed * deltaSeconds;
        if (this.feetY <= this.groundY) {
          this.feetY = this.groundY;
          this.fallSpeed = 0;
          // Re-anchor the arc on the landing. The absorb still has a few frames
          // to play, and while it does `getRootLift()` is zero: measured from
          // the old take-off height that reads as "the arc is over and the
          // landing is below" again, which snaps the body back up to where it
          // jumped from and drops it a second time, forever.
          this.takeoffY = this.groundY;
          this.animator.landJump();
        }
        this.falling = false;
      } else {
        const arc = this.takeoffY + this.animator.getRootLift();
        if (arc <= this.groundY) {
          // The ground rose to meet the body: a ledge, a slope, a deck.
          this.feetY = this.groundY;
          this.fallSpeed = 0;
          this.falling = false;
          // ...unless it rose into a body that is still climbing. Jumping from
          // low ground onto high ends the flight early, and treating that as a
          // landing cuts the ascent and snaps the pose into the crouch. The
          // body is held on the ground instead, and lands properly once the
          // authored arc has turned over.
          if (!this.animator.isArcRising()) this.animator.landJump();
        } else if (this.animator.isJumpArcFinished()) {
          // Flight over, landing still below. Hold the airborne pose and fall —
          // from the speed the arc had at contact, not from rest.
          this.feetY = arc;
          this.fallSpeed = this.animator.getContactFallSpeed();
          this.falling = false;
          this.animator.holdJumpAtContact();
        } else if (
          this.groundY < this.takeoffY - CUSHION_SKIP &&
          this.animator.isArcCushioning()
        ) {
          // The clip is settling into its landing pose with the ground still
          // well below the feet: play the fall instead of the cushion, at the
          // speed the descent had at impact. Without this the body slows to
          // 40% of its fall speed for two frames and then drops again, which is
          // the one-frame jerk reported while falling from a height.
          this.feetY = arc;
          this.fallSpeed = this.animator.getPeakFallSpeed();
          this.falling = false;
          this.animator.holdJumpAtContact();
        } else {
          this.feetY = arc;
          this.fallSpeed = 0;
          this.falling = false;
        }
      }
    } else if (this.falling) {
      this.fallSpeed += GAME_CONFIG.player.gravity * deltaSeconds;
      this.feetY -= this.fallSpeed * deltaSeconds;
      if (this.feetY <= this.groundY) {
        this.feetY = this.groundY;
        this.fallSpeed = 0;
        this.falling = false;
      }
    } else if (this.feetY > this.groundY + stepDown) {
      // The ground fell away by more than a small step: drop instead of
      // snapping. 0.35 m used to be glued in one frame, which is the sideways
      // flicker seen when walking off the edge of a dock.
      this.falling = true;
      this.fallSpeed = 0;
    } else {
      // Walking down a slope or a low step stays glued to the surface.
      this.feetY = this.groundY;
    }

    this.characterGroup.position.y = this.feetY;
  }

  /**
   * Speed correction for the slope about to be walked: cos(slope), floored.
   *
   * The ground is sampled a short lead ahead of the body, through the same
   * support query the move itself uses, so decks, ramps and boardwalks are
   * measured as surfaces rather than as terrain underneath them. Sampling the
   * previous frame's own step instead was exact but a frame late, which is a
   * one-frame lunge every time the ground changes class — and a lunge at the
   * foot of a hill is indistinguishable from a stutter.
   */
  private slopeScale(moveAngle: number, stepLength: number): number {
    // In the air there is no surface under the feet to walk up, and the ground
    // below is whatever is passing underneath: a bench edge then reads as a
    // 1.4 gradient and brakes the body for one frame in mid-air — a jerk.
    if (this.animator.isJumping() || this.falling) return 1;
    const lead = Math.min(0.5, Math.max(SLOPE_PROBE, stepLength));
    const aheadX = this.characterGroup.position.x + Math.sin(moveAngle) * lead;
    const aheadZ = this.characterGroup.position.z + Math.cos(moveAngle) * lead;
    const ahead = this.collision.groundAt(aheadX, aheadZ, this.feetY);
    const gradient = (ahead - this.groundY) / lead;
    // A lip is not a slope: stepping off a bench drops the reading by more than
    // a walkable gradient, and throttling for it would read as hesitation.
    if (!Number.isFinite(gradient) || Math.abs(gradient) > 3) return 1;
    return Math.max(MIN_SLOPE_SCALE, 1 / Math.hypot(1, gradient));
  }

  public setPosition(x: number, y: number, z: number): void {
    this.characterGroup.position.set(x, y, z);
    this.groundY = y;
    this.feetY = y;
    this.fallSpeed = 0;
    this.falling = false;
    // A teleport ends any climb and any crawl: both are tied to the geometry
    // the body was on, and neither survives being moved to another map.
    this.climbVolume = null;
    this.crawlWanted = false;
    if (this.crawling) this.setCrawling(false);
  }

  public getPosition(): THREE.Vector3 {
    return this.characterGroup.position;
  }

  /**
   * Height of the surface the body stands on, which is not the body's own
   * height while it is jumping or falling. The camera aims at this.
   */
  public getGroundY(): number {
    return this.groundY;
  }

  /**
   * Height of the eyes above the feet, in metres.
   *
   * From the capsule rather than a constant, so the crawl carries the camera
   * down with it. 1.75 - 0.13 is the 1.62 the standing view was tuned at.
   */
  public getEyeHeight(): number {
    return this.capsuleHeight - EYE_DROP;
  }

  /** Contacts resolved on the last moving frame, used by the collision debug view. */
  public getLastContacts(): CircleContact[] {
    return this.lastContacts;
  }

  public getCharacterGroup(): THREE.Group {
    return this.characterGroup;
  }
}
