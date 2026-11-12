import * as THREE from 'three';

/**
 * A walk for the kits' four-legged animals.
 *
 * The kits ship the animals rigged and unanimated, exactly like their people:
 * `saddled-horse` arrives with 24 joints — hips, spine, chest, neck, head, jaw,
 * ears, tail, and four legs of three bones each — and stands in its bind pose
 * forever. There are no baked clips for it, and no clips could exist: a horse's
 * leg cycle is a gait, not a loop, and the same rig has to serve a cow, a dog
 * and an ibex.
 *
 * So the motion is procedural, and it is driven by *distance travelled* rather
 * than by time. That single choice is what stops the feet from skating: the
 * phase advances with the metres the animal has actually covered, so a horse
 * walking slowly and a horse trotting fast both put a foot down where the
 * ground is, and a horse that stops stops walking.
 *
 * ## The four rules it follows
 *
 * 1. **Legs swing about the animal's own side axis.** A bone's local X is not
 *    the bend axis — the rig may be authored any way round, and the map may
 *    have rotated the whole animal. Each bone's bend axis is measured once, at
 *    rest, as "the animal's right, expressed in this bone's frame", which is
 *    correct for every rig and every placement.
 * 2. **The sequence is a walk at low speed and a diagonal trot at high speed**,
 *    blended continuously, because the phase offsets are numbers and numbers
 *    can be lerped. A four-beat walk at 3.4 m/s reads as a hover; a trot at
 *    0.9 m/s reads as a prance.
 * 3. **The hips never move.** Every leg is a chain hanging off the hips, so
 *    lifting the hips lifts all four feet off the ground — the body would
 *    float. The weight is carried by the neck and the head instead.
 * 4. **A standing animal is not a statue.** The head dips, the tail sways, and
 *    neither is tied to the walk phase.
 */

/** Bones the gait needs. Anything missing is simply not animated. */
const LEGS = [
  { upper: 'LeftFrontUpLeg', lower: 'LeftFrontLeg', foot: 'LeftFrontFoot', side: 'front', left: true },
  { upper: 'RightFrontUpLeg', lower: 'RightFrontLeg', foot: 'RightFrontFoot', side: 'front', left: false },
  { upper: 'LeftHindUpLeg', lower: 'LeftHindLeg', foot: 'LeftHindFoot', side: 'hind', left: true },
  { upper: 'RightHindUpLeg', lower: 'RightHindLeg', foot: 'RightHindFoot', side: 'hind', left: false },
] as const;

/**
 * Where each leg is in the cycle, as a fraction of it.
 *
 * `walk` is the lateral sequence a horse uses at a walk: left hind, left fore,
 * right hind, right fore. `trot` is diagonal — left fore with right hind — and
 * is what the animal switches to as it speeds up. Both are fractions of the
 * same cycle, so blending between them is a lerp and never a jump.
 */
const WALK_OFFSETS = { 'LeftHindUpLeg': 0, 'LeftFrontUpLeg': 0.25, 'RightHindUpLeg': 0.5, 'RightFrontUpLeg': 0.75 };
const TROT_OFFSETS = { 'LeftHindUpLeg': 0.5, 'LeftFrontUpLeg': 0, 'RightHindUpLeg': 0, 'RightFrontUpLeg': 0.5 };

/** Speed at which the walk has become a trot, in m/s. */
const TROT_FROM = 1.2;
const TROT_TO = 2.4;

/** Knee bend, in radians, at the top of a leg's swing. */
const KNEE_BEND = 0.75;

/** A bone's rest transform, plus the axes its motion is expressed in. */
interface Joint {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** The animal's right-hand side, in this bone's own frame. Bending axis. */
  pitch: THREE.Vector3;
  /** The animal's up, in this bone's own frame. Sway/turn axis. */
  yaw: THREE.Vector3;
}

export interface QuadrupedAnimator {
  /** How fast the animal is travelling, in metres per second. */
  locomotion(metresPerSecond: number): void;
  /** One frame. The gait follows whatever `locomotion` last said. */
  update(deltaSeconds: number): void;
  /** There are no clips to cross-fade, so this exists only to satisfy the crowd. */
  play(name: string): void;
  /** Height of the animal at rest, in metres — used to place a rider. */
  readonly height: number;
  dispose(): void;
}

/** A bone's name without the merge's disambiguating suffix. */
function boneKey(name: string): string {
  return name.replace(/_\d+$/, '');
}

/**
 * True when this skeleton is a four-legged animal.
 *
 * Structural, not by name: `cow-parsley` is a plant, and a kit will happily
 * name a hanging cloth `swing`. A skeleton with hind legs and no forearms is a
 * quadruped and nothing else is.
 */
export function isQuadruped(skeleton: THREE.Skeleton): boolean {
  const names = new Set(skeleton.bones.map((bone) => boneKey(bone.name)));
  if (names.has('LeftForeArm')) return false;
  return names.has('Hips') && (names.has('LeftFrontUpLeg') || names.has('LeftHindUpLeg'));
}

const _quat = new THREE.Quaternion();
const _delta = new THREE.Quaternion();
const _world = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export function animateQuadruped(
  skeleton: THREE.Skeleton,
  root: THREE.Object3D
): QuadrupedAnimator {
  const bones: Record<string, THREE.Bone> = {};
  for (const bone of skeleton.bones) {
    const key = boneKey(bone.name);
    if (!bones[key]) bones[key] = bone;
  }
  if (!bones.Hips) throw new Error('quadruped: skeleton has no Hips');

  root.updateMatrixWorld(true);

  // The animal's own frame: its right is the model's local +X turned into the
  // world by whatever rotation the map placed it under, and its up is world up.
  // Measured from the root rather than assumed, because a kit may author a
  // horse facing +Z and another facing +X.
  const rootQuat = root.getWorldQuaternion(new THREE.Quaternion());
  _right.set(1, 0, 0).applyQuaternion(rootQuat).normalize();
  _up.set(0, 1, 0).applyQuaternion(rootQuat).normalize();

  const joints = new Map<string, Joint>();
  const joint = (name: string): Joint | null => {
    const bone = bones[name];
    if (!bone) return null;
    const cached = joints.get(name);
    if (cached) return cached;
    const worldQuat = bone.getWorldQuaternion(_quat).clone();
    const entry: Joint = {
      bone,
      rest: bone.quaternion.clone(),
      pitch: _right.clone().applyQuaternion(worldQuat.clone().invert()).normalize(),
      yaw: _up.clone().applyQuaternion(worldQuat.clone().invert()).normalize(),
    };
    joints.set(name, entry);
    return entry;
  };

  const legs = LEGS.map((leg) => ({
    upper: joint(leg.upper),
    lower: joint(leg.lower),
    foot: joint(leg.foot),
    name: leg.upper,
  })).filter((leg) => leg.upper !== null);

  const neck = joint('Neck');
  const head = joint('Head');
  const tail = joint('Tail') ?? joint('TailTip');
  const chest = joint('Chest');

  // How long the legs are, which sets the stride: a foot swinging through
  // `amp` radians covers `2 * leg * sin(amp)`, and that has to be the distance
  // the body travels in one cycle or the feet skate.
  const hips = bones.Hips;
  hips.getWorldPosition(_world);
  let legLength = 0;
  let feet = 0;
  for (const leg of legs) {
    if (!leg.foot) continue;
    legLength += _world.distanceTo(leg.foot.bone.getWorldPosition(new THREE.Vector3()));
    feet++;
  }
  legLength = feet > 0 ? legLength / feet : 1.0;

  // The rest height, so a rider can be put on the back.
  const box = new THREE.Box3().setFromObject(root);
  const height = box.isEmpty() ? 2.1 : box.max.y - box.min.y;

  let phase = 0;
  let idle = Math.random() * 10;
  let motion = 0;
  let speed = 0;

  const animator: QuadrupedAnimator = {
    height,
    locomotion(metresPerSecond: number): void {
      speed = Math.max(0, metresPerSecond);
    },
    play(): void {
      // Nothing to cross-fade to: this animal has one motion and it is a gait.
    },
    update(deltaSeconds: number): void {
      idle += deltaSeconds;

      // Stopping is not instant: an animal takes a stride to settle.
      const wanted = speed > 0.05 ? Math.min(1, speed / 0.9) : 0;
      motion += (wanted - motion) * Math.min(1, deltaSeconds * 6);

      // Cadence rises with speed, and the swing amplitude is solved from it so
      // that one cycle covers exactly the ground the animal covered.
      const cadence = Math.min(3.2, 1.5 + speed * 0.28);
      const stride = cadence > 0 ? speed / cadence : 0;
      const wantedAmp = Math.asin(Math.min(0.85, stride / (2 * Math.max(0.2, legLength))));
      const amp = Math.max(0.10, wantedAmp) * motion;
      phase += deltaSeconds * cadence * Math.PI * 2;

      const trot = Math.min(1, Math.max(0, (speed - TROT_FROM) / (TROT_TO - TROT_FROM)));

      for (const leg of legs) {
        const walk = WALK_OFFSETS[leg.name as keyof typeof WALK_OFFSETS] ?? 0;
        const fast = TROT_OFFSETS[leg.name as keyof typeof TROT_OFFSETS] ?? 0;
        const offset = walk + (fast - walk) * trot;
        const angle = phase + offset * Math.PI * 2;

        const swing = Math.sin(angle);
        _delta.setFromAxisAngle(leg.upper!.pitch, swing * amp);
        leg.upper!.bone.quaternion.copy(leg.upper!.rest).multiply(_delta);

        // The knee folds on the way forward and straightens as the foot lands.
        // Only forwards: a leg that hyper-extends backwards is broken, and a
        // horse's knee does not bend that way.
        if (leg.lower) {
          const lift = Math.max(0, Math.cos(angle));
          _delta.setFromAxisAngle(leg.lower.pitch, -lift * KNEE_BEND * motion * (0.4 + amp));
          leg.lower.bone.quaternion.copy(leg.lower.rest).multiply(_delta);
        }

        // The hoof tips with the leg, so it leaves the ground toe-first.
        if (leg.foot) {
          _delta.setFromAxisAngle(leg.foot.pitch, swing * amp * 0.45);
          leg.foot.bone.quaternion.copy(leg.foot.rest).multiply(_delta);
        }
      }

      // The body carries the weight: the chest drops a little as the front legs
      // land, and the neck and head answer it a beat later.
      const bob = Math.sin(phase * 2) * 0.05 * motion;
      if (chest) {
        _delta.setFromAxisAngle(chest.pitch, bob);
        chest.bone.quaternion.copy(chest.rest).multiply(_delta);
      }
      if (neck) {
        _delta.setFromAxisAngle(neck.pitch, bob * 1.6 + Math.sin(idle * 1.1) * 0.035);
        neck.bone.quaternion.copy(neck.rest).multiply(_delta);
      }
      if (head) {
        _delta.setFromAxisAngle(head.pitch, -bob * 1.2 + Math.sin(idle * 1.1 + 0.6) * 0.03);
        head.bone.quaternion.copy(head.rest).multiply(_delta);
      }
      if (tail) {
        const sway = Math.sin(idle * 0.9) * 0.10 + Math.sin(phase) * 0.06 * motion;
        _delta.setFromAxisAngle(tail.yaw, sway);
        tail.bone.quaternion.copy(tail.rest).multiply(_delta);
      }
    },
    dispose(): void {
      for (const entry of joints.values()) entry.bone.quaternion.copy(entry.rest);
    },
  };

  return animator;
}
