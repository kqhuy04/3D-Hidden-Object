import * as THREE from 'three';

/**
 * Playback for the kit's own humanoids.
 *
 * The kits ship rigged people with a Mixamo skeleton and no animation at all —
 * the rig is the deliverable, the motion is yours. Polyfork's own `clips.mjs`
 * is the answer to that, and this is a local copy of its two useful ideas:
 * fetch the baked clips as JSON, and build the tracks against the bones of the
 * character in front of you by *name*, because the tracks inside the file are
 * keyed by bone name and every humanoid in the kits has the same ones.
 *
 * ## Why the clips are vendored
 *
 * `clips.mjs` on their CDN asks `polyfork.dev` for the clip JSON at runtime.
 * That is fine for a demo and wrong for a desktop game: a player on a train
 * gets a person who never moves, and the failure is silent. The four clips this
 * game uses are 125 kB in total, so they live in `public/assets/clips/` and the
 * only network request at play time is the map itself.
 *
 * ## Why it binds per skeleton, not per scene
 *
 * A merged map has three hundred skeletons and every one of them has a bone
 * called `Hips`. Binding by name across the whole scene would hand one farmer's
 * leg to another farmer's hip. The bone table is built from one `Skeleton`, and
 * the mixer is rooted at that character's own node.
 */

/** Where the vendored clip JSONs live, relative to the web root. */
const BASE = '/assets/clips/';

/**
 * The hip height the clips were baked at, in metres.
 *
 * Bone lengths differ between a child and a giant, and these are rotation
 * tracks plus a hips height, so the height is scaled by the character's own
 * rest height. 0.95 m is the figure polyfork baked against.
 */
const BAKED_HIP = 0.95;

interface RawClip {
  name: string;
  times: number[];
  tracks: Record<string, number[]>;
  hips: number[];
}

/** Module-wide, like `CharacterAnimator`: ten people share three downloads. */
const cache = new Map<string, Promise<RawClip>>();

function loadClip(name: string): Promise<RawClip> {
  const url = `${BASE}anim-${name.toLowerCase()}.json`;
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`npc clips: no "${name}" (HTTP ${response.status})`);
      return response.json() as Promise<RawClip>;
    });
    cache.set(url, pending);
  }
  return pending;
}

export interface KitAnimator {
  mixer: THREE.AnimationMixer;
  names: string[];
  /** Cross-fades to a clip by name. */
  play(name: string, options?: { fade?: number; timeScale?: number; loop?: boolean }): void;
  /** Idle, Walk or Run for a body moving at `metresPerSecond`. */
  locomotion(metresPerSecond: number): void;
  update(deltaSeconds: number): void;
  dispose(): void;
}

/**
 * What a crowd actor needs from whatever is moving it.
 *
 * The kits' people are driven by baked clips and their animals by a procedural
 * gait, and the crowd should not have to care which. Both answer to the same
 * four calls, so a dog and a farmer can share a leg of the walk home.
 */
export interface ActorAnimator {
  locomotion(metresPerSecond: number): void;
  play(name: string): void;
  update(deltaSeconds: number): void;
  dispose(): void;
}

/** The bones a clip can be bound to must be present, or the clip folds a sheep. */
const REQUIRED_BONES = ['Hips', 'Spine2', 'LeftForeArm', 'RightUpLeg'];

/**
 * A bone's name without the merge's disambiguating suffix.
 *
 * A prepared map is one merged scene with three hundred skeletons in it, and
 * several of them have a bone called `Hips`. The merge renames them
 * `Hips_31`, `Spine2_18`, `LeftForeArm_7` so the file stays valid — which is
 * correct, and which silently broke every name lookup here: the first version
 * of this file asked for `Hips` and got nothing on twenty maps out of
 * twenty-one, so nobody ever moved.
 */
function boneKey(name: string): string {
  return name.replace(/_\d+$/, '');
}

/** True when this skeleton is one of the kits' people rather than an animal. */
export function isHumanoid(skeleton: THREE.Skeleton): boolean {
  const names = new Set(skeleton.bones.map((bone) => boneKey(bone.name)));
  return REQUIRED_BONES.every((name) => names.has(name));
}

function toClip(
  raw: RawClip,
  name: string,
  bones: Record<string, THREE.Bone>,
  hips: THREE.Bone,
  inPlace: boolean
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];

  for (const [boneName, values] of Object.entries(raw.tracks)) {
    const bone = bones[boneName];
    if (!bone || values.length === 0) continue;
    // By uuid, not by name: a character can carry a group called "Head" as well
    // as the bone, and a name would bind to whichever the search met first.
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${bone.uuid}.quaternion`,
        raw.times.slice(),
        Float32Array.from(values)
      )
    );
  }

  // The rest height, so a clip authored at 0.95 m fits a 1.6 m character.
  const rest = hips.position.clone();
  const ratio = (rest.y || BAKED_HIP) / BAKED_HIP;
  const positions = new Float32Array(raw.hips.length);
  for (let i = 0; i < raw.hips.length; i += 3) {
    positions[i] = rest.x + (inPlace ? 0 : raw.hips[i] * ratio);
    positions[i + 1] = rest.y + raw.hips[i + 1] * ratio;
    positions[i + 2] = rest.z + (inPlace ? 0 : raw.hips[i + 2] * ratio);
  }
  tracks.push(new THREE.VectorKeyframeTrack(`${hips.uuid}.position`, raw.times.slice(), positions));

  return new THREE.AnimationClip(name, -1, tracks);
}

/**
 * Attaches Idle / Walk / Talking to one character.
 *
 * `root` must be the node that owns the character and nothing else — the mixer
 * resolves tracks by uuid inside it, and `bone` is where the search for the
 * rest position starts.
 */
export async function animateKitHumanoid(
  skeleton: THREE.Skeleton,
  root: THREE.Object3D,
  clipNames: string[] = ['Idle', 'Walk', 'Talking']
): Promise<KitAnimator> {
  const bones: Record<string, THREE.Bone> = {};
  for (const bone of skeleton.bones) {
    const key = boneKey(bone.name);
    if (!bones[key]) bones[key] = bone;
  }
  const hips = bones.Hips;
  if (!hips) throw new Error('npc clips: skeleton has no Hips');

  const raws = await Promise.all(clipNames.map(loadClip));
  const mixer = new THREE.AnimationMixer(root);
  const actions: Record<string, THREE.AnimationAction> = {};
  clipNames.forEach((name, index) => {
    actions[name] = mixer.clipAction(toClip(raws[index], name, bones, hips, true));
  });

  let current: THREE.AnimationAction | null = null;

  const play: KitAnimator['play'] = (name, options = {}) => {
    const next = actions[name];
    if (!next) return;
    const fade = options.fade ?? 0.2;
    next.timeScale = options.timeScale ?? 1;
    if (next === current) return;
    next.reset();
    next.setLoop(options.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = options.loop === false;
    next.play();
    if (current) current.crossFadeTo(next, fade, false);
    current = next;
  };

  const scale = (hips.position.y || BAKED_HIP) / BAKED_HIP;
  const locomotion: KitAnimator['locomotion'] = (speed) => {
    const paced = Math.abs(speed) / scale;
    if (paced < 0.15 || !actions.Walk) {
      play('Idle');
      return;
    }
    // Walk was captured at 1.01 m/s; pacing the clip to the real speed is what
    // stops the feet from skating.
    play('Walk', { timeScale: Math.min(2.2, Math.max(0.55, paced / 1.01)) });
  };

  if (actions.Idle) play('Idle', { fade: 0 });

  return {
    mixer,
    names: clipNames,
    play,
    locomotion,
    update: (delta) => mixer.update(delta),
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
}
