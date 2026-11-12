import * as THREE from 'three';

interface RawAnimTrackData {
  name: string;
  times: number[];
  tracks: Record<string, number[]>;
  hips: number[];
  /**
   * Airborne part of the hip curve, one value per key. Present only on clips
   * that leave the ground; see tools/convert-fbx-anim.mjs for the split.
   */
  rootLift?: number[];
}

export interface Curve {
  times: number[];
  values: number[];
}

/**
 * Which locomotion clip the body should be in.
 *
 * The old animator had two answers — idle and walk — and chose between them
 * from speed alone. The maps have stairs, ladders and gaps you have to crawl
 * through, and a walk cycle on a staircase reads as skating: the feet never
 * lift to a tread.
 */
export type Gait = 'flat' | 'up' | 'down' | 'crawl' | 'climb';

/** Clip name for each gait. Idle has no gait of its own. */
const GAIT_CLIPS: Record<Exclude<Gait, 'flat'>, string> = {
  up: 'StairsUp',
  down: 'StairsDown',
  crawl: 'Crawl',
  climb: 'Ladder',
};

/**
 * Playback rate of the jump clip per phase.
 *
 * The authored clip is 1.90 s: a 0.533 s crouch, 0.600 s in the air and a
 * 0.767 s landing recovery. Played straight that is 1.3 s of standing still for
 * a jump whose flight lasts half a second, which reads as sluggish rather than
 * weighty — the crouch in particular holds the body motionless for half a
 * second before the feet ever leave the ground.
 *
 * The crouch and the recovery are the parts that carry no travel, so they are
 * the parts to speed up. The flight keeps its authored rate, and with it the
 * relationship between each metre of arc and the pose that goes with it: slow
 * the flight down and the body hangs in the air; speed it up and it is pulled
 * down faster than the arc, so the feet skate.
 *
 * Measured on the clip: 3.0x turns the crouch into 0.178 s, 2.4x turns the
 * recovery into 0.320 s, for a 1.10 s jump of which 0.60 s is airborne.
 */
const JUMP_CROUCH_RATE = 3.0;
const JUMP_RECOVERY_RATE = 2.4;

/**
 * How soon after a landing a jump stops counting as a chained one, in ms.
 *
 * Inside this window the gather is skipped and the clip starts at take-off, so
 * a hop-hop-hop rhythm reads as three jumps rather than three crouches. The
 * landing absorb itself lasts about 320 ms, so the window covers it with a
 * little room for the player's own reaction time.
 */
const CHAIN_WINDOW_MS = 320;

/**
 * Longest stretch of flight an early landing may skip, in seconds.
 *
 * The rest is rushed rather than cut: the clip's remaining flight is played at
 * up to this many seconds' worth of speed so the pose reaches the contact frame
 * smoothly. Cutting straight there is a visible snap, which is what a jump onto
 * higher ground used to do.
 */
const LANDING_SKIP = 0.15;

/** Every clip the animator knows how to drive. */
const CLIP_NAMES = ['idle', 'walk', 'run', 'jump', 'stairsUp', 'stairsDown', 'ladder', 'crawl', 'driving'] as const;

/**
 * The raw keyframe files, fetched once for the whole app.
 *
 * They are the same eight files for every character — a clip is authored once
 * and re-bound to each skeleton — so re-fetching and re-parsing 430 kB of JSON
 * on every swap was pure waste. The parsed data is immutable, so one copy
 * serves every animator.
 *
 * Promises are cached rather than results, so two callers asking for the same
 * clip at the same time share one request instead of racing two.
 */
const RAW_CLIPS = new Map<string, Promise<RawAnimTrackData>>();

function fetchClip(url: string): Promise<RawAnimTrackData> {
  let pending = RAW_CLIPS.get(url);
  if (!pending) {
    pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<RawAnimTrackData>;
    });
    // A failed fetch must not be cached, or one dropped request poisons every
    // character for the rest of the session.
    pending.catch(() => RAW_CLIPS.delete(url));
    RAW_CLIPS.set(url, pending);
  }
  return pending;
}

/**
 * Lift above which the feet count as off the ground, in metres. The authored
 * curve leaves 0 with a soft first key, so a plain `> 0` test would report the
 * take-off several frames early and open the crouch to movement.
 */
const AIRBORNE_LIFT = 0.01;

/** Linear sample of a keyed curve, clamped outside its range. */
export function sampleCurve(curve: Curve, time: number): number {
  const { times, values } = curve;
  if (times.length === 0) return 0;
  if (time <= times[0]) return values[0];
  const last = times.length - 1;
  if (time >= times[last]) return values[last];

  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  const t = span > 0 ? (time - times[lo]) / span : 0;
  return values[lo] + (values[hi] - values[lo]) * t;
}

export class CharacterAnimator {
  private character: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions: Map<string, THREE.AnimationAction> = new Map();
  private currentAction: THREE.AnimationAction | null = null;
  private currentActionName = '';
  private bakedHip = 0.95;

  private jumpAction: THREE.AnimationAction | null = null;
  private jumpLiftCurve: Curve | null = null;
  /** Clip time at which the feet leave the ground. */
  private jumpTakeoffTime = 0;
  /** Clip time at which the feet touch the ground again. */
  private jumpContactTime = Infinity;
  /** Clip time after which the body is upright again and may walk out of it. */
  private jumpReleaseTime = Infinity;
  /**
   * Steepest descent of the authored arc, in m/s, and the clip time it happens
   * at — the physical moment of impact, before the clip's landing cushion.
   */
  private jumpPeakFallSpeed = 0;
  private jumpImpactTime = Infinity;
  private jumping = false;
  /** The clip is frozen at its contact frame while the body falls to a ledge. */
  private jumpHeld = false;
  /**
   * Wall-clock time the last jump put its feet down, in milliseconds.
   *
   * A jump pressed while the landing is still being absorbed used to restart
   * the clip from frame zero, which plays the whole gather crouch again — the
   * body snaps from the landing pose into a squat and only then leaves the
   * ground. Chaining a jump should go straight to the flight; the crouch is
   * anticipation for a jump from standing, and there is nothing to anticipate
   * from a body that has just landed.
   */
  private lastLandingAt = -Infinity;
  /**
   * Multiplier on the flight playback rate after an early landing.
   *
   * On a slope the ground rises to meet the body before the authored arc has
   * finished, and the old code cut straight to the contact frame — up to half a
   * second of animation discarded in one frame, which is the snap seen when
   * jumping from low ground onto high. The clip is rushed to its contact frame
   * instead, so the pose accelerates into the landing rather than jumping there.
   */
  private jumpRush = 1;
  constructor(character: THREE.Object3D) {
    this.character = character;
    this.mixer = new THREE.AnimationMixer(character);

    // A one-shot clip stays clamped on its last frame; that is what ends the
    // jump. Without this the body would keep the landing pose until the next
    // locomotion call happened to run on the same frame.
    this.mixer.addEventListener('finished', (e) => {
      if ((e as { action?: THREE.AnimationAction }).action === this.jumpAction) {
        this.jumping = false;
        this.jumpHeld = false;
      }
    });
  }

  public async loadAnimations(basePath = '/assets/anims/', only?: readonly string[]): Promise<void> {
    const bones: Record<string, THREE.Bone> = {};
    this.character.traverse((o) => {
      if ((o as THREE.Bone).isBone && !bones[o.name]) {
        bones[o.name] = o as THREE.Bone;
      }
    });

    const hips = bones.Hips;
    if (!hips) {
      console.warn('CharacterAnimator: No Hips bone found for Mixamo humanoid mapping');
      return;
    }

    // `only` exists for the start screen, which plays one clip and nothing else.
    // Loading the full set there meant eight fetches and eight clip builds on
    // every click of a roster arrow, for seven clips the portrait never plays.
    const clipNames = only ?? CLIP_NAMES;
    for (const name of clipNames) {
      try {
        const raw = await fetchClip(`${basePath}anim-${name}.json`);
        const clip = this.buildClip(raw, name.charAt(0).toUpperCase() + name.slice(1), bones, hips);
        const action = this.mixer.clipAction(clip);

        if (name === 'jump') {
          // Played once per jump, not looped: the clip contains its own crouch,
          // launch, flight and landing.
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          this.jumpAction = action;
          this.readJumpPhases(raw);
        } else {
          action.setLoop(THREE.LoopRepeat, Infinity);
        }

        this.actions.set(clip.name, action);
      } catch (err) {
        console.warn(`CharacterAnimator: Could not load anim-${name}.json`, err);
      }
    }

    // Start with Idle
    this.play('Idle', 0);
  }

  /**
   * Reads the three phase boundaries straight out of the clip instead of
   * hard-coding them.
   *
   * The jump is authored as one continuous motion, and everything that has to
   * line up with the physics — when the feet leave the ground, when they come
   * back, when the body is upright enough to run out of the landing — is
   * already encoded in the curves. The airborne height curve marks the flight
   * exactly, and the hip curve marks the crouch, because a squat is a hip that
   * drops and rises again. Re-exporting the animation therefore re-times the
   * jump on its own, with no numbers to keep in sync by hand.
   */
  private readJumpPhases(raw: RawAnimTrackData): void {
    const { times } = raw;

    if (raw.rootLift) {
      this.jumpLiftCurve = { times: times.slice(), values: raw.rootLift.slice() };

      // Flight = the span where the authored root is lifted. Take-off is the
      // first lifted key, contact the first key after the flight where the
      // root is back down: the body is on the ground for the whole of both
      // the crouch before it and the absorb after it.
      let first = -1;
      let last = -1;
      for (let i = 0; i < raw.rootLift.length; i++) {
        if (raw.rootLift[i] > AIRBORNE_LIFT) {
          if (first < 0) first = i;
          last = i;
        }
      }
      if (first > 0) this.jumpTakeoffTime = times[first];
      if (last >= 0) {
        let contact = last;
        while (contact < raw.rootLift.length && raw.rootLift[contact] > AIRBORNE_LIFT) contact++;
        this.jumpContactTime =
          contact < times.length ? times[contact] : times[times.length - 1];
      }

      // The clip's landing cushion: over its last few keys the root decelerates
      // so a jump on the spot settles instead of slamming. That is a landing
      // only if the ground is where the arc expects it — dropping to a ledge
      // three metres below, those same keys are a hang in mid-air, and the body
      // visibly slows to 40% of its fall speed for two frames before it starts
      // again. Remember where the descent is steepest; that is the impact.
      if (Number.isFinite(this.jumpContactTime)) {
        const span = 0.05;
        let peak = 0;
        let peakTime = this.jumpContactTime;
        for (let t = this.jumpTakeoffTime; t < this.jumpContactTime; t += span * 0.5) {
          const v =
            (sampleCurve(this.jumpLiftCurve, t) - sampleCurve(this.jumpLiftCurve, t + span)) /
            span;
          if (v > peak) {
            peak = v;
            peakTime = Math.min(this.jumpContactTime, t + span);
          }
        }
        this.jumpPeakFallSpeed = peak;
        this.jumpImpactTime = peakTime;
      }
    }

    // The clip keeps a landing crouch for its last half second. Standing in
    // that pose while the player is running reads as sliding, so the walk is
    // allowed back in as soon as the hips have recovered — the last key still
    // below the crouch threshold is exactly that moment.
    const hipsY = raw.hips.filter((_, i) => i % 3 === 1);
    const crouchDepth = Math.min(...hipsY);
    if (crouchDepth < -0.05) {
      const threshold = crouchDepth * 0.35;
      let lastCrouched = -1;
      for (let i = 0; i < hipsY.length; i++) {
        if (hipsY[i] < threshold) lastCrouched = i;
      }
      if (lastCrouched >= 0 && lastCrouched < times.length - 1) {
        this.jumpReleaseTime = Math.max(this.jumpContactTime, times[lastCrouched]);
      }
    } else {
      // No landing crouch to wait for: the body is free as soon as it lands.
      this.jumpReleaseTime = this.jumpContactTime;
    }
  }

  public addExistingClip(clip: THREE.AnimationClip): void {
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    this.actions.set(clip.name, action);
  }

  private buildClip(
    raw: RawAnimTrackData,
    clipName: string,
    bones: Record<string, THREE.Bone>,
    hips: THREE.Bone
  ): THREE.AnimationClip {
    const tracks: THREE.KeyframeTrack[] = [];

    // Quaternion tracks for each bone
    for (const [boneName, values] of Object.entries(raw.tracks)) {
      const b = bones[boneName];
      if (!b || !values.length) continue;

      // A track whose key count does not match the shared time array makes
      // three compute a fractional valueSize (4 values / 58 times = 0.069),
      // which zeroes the mixer buffer and hangs PropertyMixer.saveOriginalState
      // the first time the clip is played. Drop it instead of freezing.
      if (values.length !== raw.times.length * 4) {
        console.warn(
          `CharacterAnimator: ${clipName}.${boneName} has ${values.length / 4} keys, expected ${raw.times.length}; skipped`
        );
        continue;
      }

      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${b.uuid}.quaternion`,
          raw.times.slice(),
          Float32Array.from(values)
        )
      );
    }

    // Position track for Hips (in-place)
    if (raw.hips.length !== raw.times.length * 3) {
      console.warn(
        `CharacterAnimator: ${clipName} hips has ${raw.hips.length / 3} keys, expected ${raw.times.length}; skipped`
      );
      return new THREE.AnimationClip(clipName, -1, tracks);
    }
    const rest = hips.position.clone();
    const ratio = (rest.y || this.bakedHip) / this.bakedHip;
    const pos = new Float32Array(raw.hips.length);
    for (let i = 0; i < raw.hips.length; i += 3) {
      pos[i] = rest.x;
      pos[i + 1] = rest.y + raw.hips[i + 1] * ratio;
      pos[i + 2] = rest.z;
    }
    tracks.push(
      new THREE.VectorKeyframeTrack(`${hips.uuid}.position`, raw.times.slice(), pos)
    );

    return new THREE.AnimationClip(clipName, -1, tracks);
  }

  public play(name: string, fadeDuration = 0.2, timeScale = 1.0): void {
    const nextAction = this.actions.get(name);
    if (!nextAction) return;

    nextAction.timeScale = timeScale;

    if (this.currentAction === nextAction) {
      return;
    }

    nextAction.reset();
    nextAction.play();

    if (this.currentAction) {
      this.currentAction.crossFadeTo(nextAction, fadeDuration, false);
    }

    this.currentAction = nextAction;
    this.currentActionName = name;
  }

  /**
   * @param wantsToMove the player is holding a direction, regardless of how far
   *   the body actually moved this frame. The walk-out test must use intent:
   *   while the jump owns the feet the body cannot move, so measuring intent by
   *   resulting speed would deadlock the release.
   * @param running the Shift gear. Only ever a speed flag: the clip follows the
   *   same number the controller moved the body at.
   */
  public locomotion(
    speed: number,
    wantsToMove = speed > 0.15,
    gait: Gait = 'flat',
    running = false
  ): void {
    // A jump owns the whole body: letting the walk cycle fade in halfway
    // through would cancel the crouch and the landing. The exception is the
    // tail of the clip — once the hips are upright again and the player is
    // already moving, the landing pose would only make them slide.
    if (this.jumping) {
      const canWalkOut =
        wantsToMove &&
        !this.jumpHeld &&
        this.jumpAction !== null &&
        this.jumpAction.time >= this.jumpReleaseTime;
      if (!canWalkOut) return;
      this.jumping = false;
    }

    // Crawling is a pose, not a loop, until the player actually crawls. The
    // clip starts on the hands-and-knees frame, so holding it there is what
    // "press C and go down" looks like; playing it on the spot would scrabble
    // the arms with nowhere to go.
    if (gait === 'crawl') {
      const crawl = this.actions.get('Crawl');
      if (crawl) {
        if (speed < 0.08) {
          this.holdPose(crawl);
          return;
        }
        crawl.paused = false;
        this.play('Crawl', 0.18, this.gaitRate('crawl', speed));
        return;
      }
    }

    // Stairs, ladder and crawl are their own cycles. They replace the walk
    // outright rather than blending with it: a body halfway between a walk and
    // a stair climb has feet that plant in neither.
    if (gait !== 'flat') {
      const clip = GAIT_CLIPS[gait];
      if (this.actions.has(clip)) {
        if (speed < 0.12 && gait !== 'climb') {
          // Stopped mid-staircase is standing, not marching on the spot.
          this.play('Idle', 0.2);
          return;
        }
        this.play(clip, 0.18, this.gaitRate(gait, speed));
        return;
      }
    }

    if (speed < 0.15) {
      this.play('Idle', 0.2);
      return;
    }

    if (running && this.actions.has('Run') && speed > 2.2) {
      // The run clip is authored for a 7 m/s stride; at 8.4 m/s it plays a
      // shade fast, at 5 m/s a shade slow. Clamped so neither end skates.
      this.play('Run', 0.2, Math.min(1.35, Math.max(0.75, speed / 7)));
      return;
    }

    const walkTimeScale = Math.min(1.8, Math.max(0.6, speed / 3.0));
    this.play('Walk', 0.2, walkTimeScale);
  }

  /**
   * Freezes a looping clip on the frame it is already on.
   *
   * The entry pose comes free from `play`, which resets any clip it has to
   * switch to: pressing C from a standstill lands on the hands-and-knees frame
   * without any help from here.
   *
   * What this must *not* do is reset the clip. It used to set `time = 0` on
   * every frame the player was stopped, which meant that letting go of the
   * stick halfway through a crawl snapped the body back to the entry frame —
   * a quarter of a stride backwards, arms flipping. Crawling and then stopping
   * is a person who has stopped crawling; they hold the pose they reached.
   */
  private holdPose(action: THREE.AnimationAction): void {
    // Switching into the crawl from a walk still has to reset it — that is the
    // entry pose — but only on that first frame.
    if (this.currentAction !== action) this.play(action.getClip().name, 0.18);
    action.paused = true;
    action.timeScale = 0;
  }

  /**
   * Playback rate for a gait clip.
   *
   * Each clip was authored at one cadence, and the body moves at whatever speed
   * the player is walking. The ratio between the two is the rate: at the
   * authored speed the clip plays at 1.0, and a player who is being slowed by a
   * slope takes proportionally shorter strides instead of skating.
   *
   * The authored speeds differ per clip — a stair tread is taken more slowly
   * than a crawl — so each has its own reference.
   */
  private gaitRate(gait: Gait, speed: number): number {
    switch (gait) {
      case 'up':
      case 'down':
        // 2.4 m/s of ground speed is a brisk walk up a staircase.
        return Math.min(1.7, Math.max(0.55, speed / 2.4));
      case 'crawl':
        // A crawl covers much less ground per cycle than a walk.
        return Math.min(1.8, Math.max(0.6, speed / 1.5));
      case 'climb':
        // Here `speed` is the vertical rate, not the ground speed.
        return Math.min(2.0, Math.max(0.4, speed / 1.3));
      default:
        return 1;
    }
  }

  /**
   * How much of the requested horizontal movement the animation allows.
   *
   * Zero while the jump has its feet on the ground — the crouch that gathers
   * for the take-off and the absorb on landing. Moving the body then drags a
   * planted-foot pose across the terrain, which is exactly the "sliding" that
   * was reported when jumping while holding W.
   *
   * This is decided by phase, not by sampling the lift curve: while the body
   * hangs at its contact frame waiting to fall to a lower ledge the lift is
   * zero but the feet are in the air, and a lift-based test would lock the
   * body in place for the whole drop.
   */
  public getMoveScale(): number {
    const action = this.jumpAction;
    if (!this.jumping || !action) return 1;
    if (this.jumpHeld) return 1;

    const t = action.time;
    if (t < this.jumpTakeoffTime) return 0; // gather: both feet planted
    if (t < this.jumpContactTime) return 1; // flight: the arc owns the body
    return 0; // absorb: both feet planted again
  }

  /**
   * Starts a jump if one is not already running. Returns false when the clip is
   * missing or the character is mid-jump, so the caller does not need to track
   * that state itself.
   */
  public startJump(): boolean {
    const action = this.jumpAction;
    if (!action || this.jumping) return false;

    this.jumping = true;
    this.jumpHeld = false;
    this.jumpRush = 1;
    action.reset();
    action.setEffectiveWeight(1);
    // A chained jump skips the gather: the body is already on the ground and
    // already moving, so the crouch is anticipation with nothing to anticipate.
    if (performance.now() - this.lastLandingAt < CHAIN_WINDOW_MS) {
      action.time = this.jumpTakeoffTime;
    }
    action.play();

    if (this.currentAction && this.currentAction !== action) {
      this.currentAction.crossFadeTo(action, 0.12, false);
    }
    this.currentAction = action;
    this.currentActionName = 'Jump';
    return true;
  }

  public isJumping(): boolean {
    return this.jumping;
  }

  /** True once the clip's flight is over and the feet are on the ground. */
  public isJumpArcFinished(): boolean {
    const action = this.jumpAction;
    if (!this.jumping || !action) return false;
    return action.time >= this.jumpContactTime;
  }

  /** True while the clip waits at its contact frame for the body to fall. */
  public isJumpHeld(): boolean {
    return this.jumpHeld;
  }

  /**
   * Freezes the clip on its contact frame.
   *
   * The clip's arc is measured from the ground the jump started on, so jumping
   * off a ledge finishes the flight in mid-air: the feet still have a metre or
   * three to drop. Playing the landing crouch there puts the character in a
   * squat with nothing under the soles — the "feet standing in the air" that
   * was reported. Holding the last airborne frame instead keeps the legs
   * extended for as long as the body is genuinely falling, and the absorb
   * plays once there is ground to absorb against.
   */
  public holdJumpAtContact(): void {
    const action = this.jumpAction;
    if (!action || this.jumpHeld) return;

    action.time = this.jumpContactTime;
    action.timeScale = 0;
    action.paused = true;
    this.jumpHeld = true;
  }

  /**
   * Ends the flight: the feet are on something. Resumes the landing absorb from
   * the contact frame, so a drop that outlasted the clip still lands on a
   * crouch instead of snapping upright.
   */
  public landJump(): void {
    const action = this.jumpAction;
    if (!action) return;

    this.jumpHeld = false;
    action.paused = false;
    this.lastLandingAt = performance.now();
    // Only a body that is actually airborne skips ahead. During the gather the
    // feet are already down and the caller reports the same ground on every
    // frame, so skipping there would throw the crouch away on frame one.
    if (action.time >= this.jumpTakeoffTime && action.time < this.jumpContactTime) {
      const remaining = this.jumpContactTime - action.time;
      if (remaining <= LANDING_SKIP) {
        action.time = this.jumpContactTime;
        this.jumpRush = 1;
      } else {
        // Ground that rose to meet the body early: play the rest of the flight
        // at speed instead of discarding it, so the pose arrives at the landing
        // instead of being teleported there.
        this.jumpRush = Math.min(4, remaining / LANDING_SKIP);
      }
    }
  }

  /**
   * True while the authored arc is still climbing.
   *
   * The caller uses this to tell a real landing from ground rising into the
   * body mid-flight: jumping from low ground onto high ends the flight early,
   * and treating that as a landing cuts the ascent short.
   */
  public isArcRising(): boolean {
    const action = this.jumpAction;
    if (!this.jumping || !action || !this.jumpLiftCurve) return false;
    const now = sampleCurve(this.jumpLiftCurve, action.time);
    const before = sampleCurve(this.jumpLiftCurve, Math.max(0, action.time - 0.06));
    return now > before + 1e-4;
  }

  /**
   * Height the player's root should be lifted by, in metres, for the current
   * frame of the jump. Zero whenever the feet are on the ground, so the crouch
   * and the landing stay in the skeleton where the leg pose expects them.
   */
  public getRootLift(): number {
    if (!this.jumping || !this.jumpLiftCurve || !this.jumpAction) return 0;
    return sampleCurve(this.jumpLiftCurve, this.jumpAction.time);
  }

  /**
   * Downward speed of the authored arc at the contact frame, in m/s.
   *
   * The arc is the clip's own curve, so its last frames already carry the speed
   * the body was falling at. A drop that outlasts the arc has to start from
   * that speed, not from rest: falling from zero makes the body hang for a
   * frame at the end of the flight and then visibly re-accelerate.
   */
  public getContactFallSpeed(): number {
    if (!this.jumpLiftCurve || !Number.isFinite(this.jumpContactTime)) return 0;
    const span = 0.12;
    const before = sampleCurve(this.jumpLiftCurve, this.jumpContactTime - span);
    const at = sampleCurve(this.jumpLiftCurve, this.jumpContactTime);
    return Math.max(0, (before - at) / span);
  }

  /**
   * True once the clip is inside its authored landing cushion — past the
   * steepest point of the descent, on the way to a stop.
   *
   * Nothing here decides *where* the body is; the caller compares the ground
   * with the feet. On a landing at the height the jump started from the cushion
   * is the landing and should play. With the ground still below, it is the
   * slowdown that reads as a stutter in the middle of a fall.
   */
  public isArcCushioning(): boolean {
    const action = this.jumpAction;
    if (!this.jumping || !action) return false;
    return action.time > this.jumpImpactTime;
  }

  /** Speed of the descent at its steepest, in m/s: what a fall should start at. */
  public getPeakFallSpeed(): number {
    return this.jumpPeakFallSpeed;
  }

  public update(deltaSeconds: number): void {
    this.applyJumpRate();
    this.mixer.update(deltaSeconds);
  }

  /**
   * Playback rate for the jump, chosen per frame from the action's own time.
   *
   * The three phases want three different rates, and one clip can only carry
   * one at a time, so it is set from the phase the clip is in rather than once
   * at the start: the crouch runs fast, the flight runs at its authored rate so
   * the arc and the pose stay locked together, and the absorb runs fast again.
   */
  private applyJumpRate(): void {
    const action = this.jumpAction;
    if (!action || !this.jumping || this.jumpHeld) return;

    const t = action.time;
    action.timeScale =
      t < this.jumpTakeoffTime
        ? JUMP_CROUCH_RATE
        : t < this.jumpContactTime
          ? this.jumpRush
          : JUMP_RECOVERY_RATE;
  }

  public getCurrentActionName(): string {
    return this.currentActionName;
  }
}
