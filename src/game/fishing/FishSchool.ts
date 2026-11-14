import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FISH, DEFAULT_CLIPS, FishingSpot, FishSpecies, speciesById } from '../../data/fishing';
import { WaterSurface } from '../world/WorldLoader';

/**
 * The fish in the lake.
 *
 * They are not decoration and they are not the minigame either — they are the
 * thing between the two. A float that lands on open water and then produces a
 * fish out of nowhere is a slot machine; a float that lands next to a koi you
 * were watching, and that koi turns and takes it, is fishing.
 *
 * So every fish here is a real actor with three states: drifting, bolting and
 * hooked. The minigame never spawns anything — it asks the school for the
 * nearest fish and takes it over.
 *
 * ## Why the clips are per-fish
 *
 * A Polyfork animal arrives rigged, with Idle / Swim / Swim fast baked into the
 * GLB. `SkeletonUtils.clone` is what makes a second one possible: a plain
 * `Object3D.clone()` copies the bones but leaves every copy pointing at the
 * original's skeleton, so ten fish would all move as one.
 */

/** How many fish the lake holds at once. */
const SCHOOL_SIZE = 9;

/** Metres a fish may wander from where it was placed. */
const ROAM_RADIUS = 5.5;

/** Below this depth there is not enough water for a fish to swim in. */
const MIN_DEPTH = 0.7;

/** Height of a fish's body above the bed, as a fraction of its length. */
const BODY_LIFT = 0.22;

interface Actor {
  species: FishSpecies;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: Record<'idle' | 'swim' | 'fast', THREE.AnimationAction | null>;
  playing: 'idle' | 'swim' | 'fast';
  /** World position of the body's centre. */
  position: THREE.Vector3;
  home: THREE.Vector3;
  target: THREE.Vector3;
  /** Water surface height at the fish, refreshed as it swims. */
  surface: number;
  /** Yaw the body is turning towards, radians. */
  heading: number;
  /** Seconds until a new wander target is chosen. */
  timer: number;
  state: 'free' | 'approach' | 'hooked' | 'lifted';
  /** Set while the fish is being pulled out of the water. */
  lift: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null;
  /** Half the body height, so the model's feet-on-origin box sits in the water. */
  halfHeight: number;
}

const _dir = new THREE.Vector3();
const _next = new THREE.Vector3();

export class FishSchool {
  private group = new THREE.Group();
  private actors: Actor[] = [];
  /** One loaded scene per species, cloned per fish. */
  private prototypes = new Map<string, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>();
  private water: WaterSurface | null = null;
  private loading: Promise<void> | null = null;
  private ready = false;
  /**
   * The water being fished, and the fish that live in it.
   *
   * A school is built per spot rather than per game: the reef's eleven models
   * are eleven megabytes nobody needs on the campground, and loading them all
   * to place nine is the sort of thing that shows up as a long first cast.
   */
  private spot: FishingSpot | null = null;
  /** The spot whose models are loaded or loading. */
  private loadedSpot: FishingSpot | null = null;

  constructor(private scene: THREE.Scene) {
    this.group.name = 'fish-school';
    scene.add(this.group);
  }

  /**
   * Loads the five species and puts a school in the water near `centre`.
   *
   * The fish are placed within a ring around the player's shore rather than
   * scattered over the whole lake: a school the player can see from the bank is
   * the point, and nine fish spread over 40 m of water are nine fish nobody
   * ever watches.
   */
  public async populate(water: WaterSurface, centre: THREE.Vector3, spot: FishingSpot): Promise<void> {
    this.clear();
    this.water = water;
    this.spot = spot;
    // `prototypes` outlives a spot, so the promise is only reusable for the
    // spot it was started for: walking from the lake to the reef has to fetch
    // the reef's models, and walking back has to not fetch them again.
    if (this.loadedSpot !== spot) {
      this.loadedSpot = spot;
      this.loading = this.loadSpecies(spot);
    }
    await this.loading;
    this.ready = true;

    let placed = 0;
    // Two passes. The first is a wide ring around the shore the player is
    // standing on, which is what a lake wants. The second is a tight one, for
    // the reef: a 6 × 5 m pool of water inside a ring of 4 … 26 m is mostly
    // land, and the first pass alone puts two fish in it.
    const rings: ReadonlyArray<readonly [number, number, number]> = [
      [4, 22, 220],
      [1.2, 6, 160],
    ];
    for (const [near, far, budget] of rings) {
      let tries = 0;
      while (placed < SCHOOL_SIZE && tries < budget) {
        tries++;
        const angle = Math.random() * Math.PI * 2;
        const radius = near + Math.random() * (far - near);
        const x = centre.x + Math.cos(angle) * radius;
        const z = centre.z + Math.sin(angle) * radius;

        const surface = water.heightAt(x, z);
        if (surface === null) continue;
        if (water.depthAt(x, z) < MIN_DEPTH) continue;

        // Keep the school off the sand: a koi that can be watched from the bank
        // still has to be *in* the lake, not in an inch of water at its edge.
        if (water.shoreDistance(x, z) < 1.4) continue;

        const species = pickWeighted(spot, placed);
        const actor = this.makeActor(species, x, surface, z);
        if (!actor) continue;
        this.actors.push(actor);
        placed++;
      }
    }
  }

  /**
   * Loads the species this spot's roster names, and only those.
   *
   * `prototypes` is kept across spots: walking from the lake to the reef and
   * back should not re-download the koi. The map change is the one moment the
   * game is already busy.
   */
  private async loadSpecies(spot: FishingSpot): Promise<void> {
    const loader = new GLTFLoader();
    const wanted = spot.roster
      .map((entry) => speciesById(entry.id))
      .filter((s): s is FishSpecies => s !== undefined && !this.prototypes.has(s.id));
    await Promise.all(
      wanted.map(async (species) => {
        try {
          const gltf = await loader.loadAsync(species.model);
          this.prototypes.set(species.id, { scene: gltf.scene, animations: gltf.animations });
        } catch (err) {
          console.warn(`FishSchool: could not load ${species.id}`, err);
        }
      })
    );
  }

  private makeActor(species: FishSpecies, x: number, surface: number, z: number): Actor | null {
    const proto = this.prototypes.get(species.id);
    if (!proto) return null;

    const root = cloneSkinned(proto.scene) as THREE.Object3D;
    root.name = `fish-${species.id}`;

    // The models are authored with their origin on the bed and their length
    // along +Z, nose forward. Scale by body length so a 1.6 m shark is 1.15 m
    // of shark and a 0.74 m koi is 0.62 m of koi.
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const authored = Math.max(0.01, size.z);
    const scale = species.length / authored;
    root.scale.setScalar(scale);

    const halfHeight = (size.y * scale) / 2;

    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // A skinned mesh's cached bounding sphere is computed from the bind pose
      // and then never updated, which makes a swimming fish disappear whenever
      // its bind-pose box leaves the frustum. Give it room instead.
      mesh.frustumCulled = false;
    });

    const mixer = new THREE.AnimationMixer(root);
    const clips: Actor['clips'] = { idle: null, swim: null, fast: null };
    const names = species.clips ?? DEFAULT_CLIPS;
    for (const clip of proto.animations) {
      const action = mixer.clipAction(clip);
      if (clip.name === names.idle) clips.idle = action;
      else if (clip.name === names.fast) clips.fast = action;
      else if (clip.name === names.swim) clips.swim = action;
    }
    clips.swim?.play();

    const y = this.restY(species, x, z, surface, halfHeight);
    root.position.set(x, y, z);
    this.group.add(root);

    return {
      species,
      root,
      mixer,
      clips,
      playing: 'swim',
      position: new THREE.Vector3(x, y, z),
      home: new THREE.Vector3(x, surface, z),
      target: new THREE.Vector3(x, y, z),
      surface,
      heading: Math.random() * Math.PI * 2,
      timer: Math.random() * 3,
      state: 'free',
      lift: null,
      halfHeight,
    };
  }

  /**
   * How deep the body's centre sits, for a species at a place on the sheet.
   *
   * Swimmers are a fixed depth under the surface, which is what makes a koi
   * read as cruising. Walkers — the two crabs — have to sit on the bed instead,
   * and where the bed is changes every metre, so the column is measured rather
   * than assumed. A crab in a 20 cm puddle ends up at the surface either way,
   * which is correct: that is where a crab in a puddle is.
   */
  /**
   * The height a body's centre belongs at, for a species at a place on the
   * sheet.
   *
   * `depthFor` answers "how deep does this species cruise", which is a property
   * of the fish and says nothing about the bed. Over the shelf by the shore
   * that depth is *under the sand*: the school spawned inside the bank with its
   * heads out of the water. Half a body above the bed is the floor, and the
   * same rule has to hold at spawn and every frame after it, or a fish placed
   * in the bank stays there until something moves it.
   */
  private restY(
    species: FishSpecies,
    x: number,
    z: number,
    surface: number,
    halfHeight: number
  ): number {
    const wanted = this.depthFor(species, x, z, surface, halfHeight);
    const column = this.water?.depthAt(x, z) ?? 0;
    return Math.max(wanted, surface - column + halfHeight);
  }

  private depthFor(species: FishSpecies, x: number, z: number, surface: number, halfHeight: number): number {
    if (!species.benthic) return surface - species.depth - halfHeight;
    const column = this.water?.depthAt(x, z) ?? species.depth + 1;
    return surface - column + halfHeight + 0.08;
  }

  /** Plays one clip and pauses the other two, so no two weights fight. */  private play(actor: Actor, which: 'idle' | 'swim' | 'fast', fade = 0.25): void {
    if (actor.playing === which) return;
    const next = actor.clips[which];
    if (!next) return;
    next.reset().play();
    const current = actor.clips[actor.playing];
    if (current) current.crossFadeTo(next, fade, false);
    actor.playing = which;
  }

  /**
   * The nearest free fish to a point, or null.
   *
   * Used when the float is taken: the fish that bites is the one that was
   * already closest, which is what makes the school feel like it noticed the
   * bait rather than like the game rolled a die.
   */
  public nearest(point: THREE.Vector3, maxDistance = 14): Actor | null {
    let best: Actor | null = null;
    let bestDistance = maxDistance;
    for (const actor of this.actors) {
      if (actor.state !== 'free') continue;
      const distance = actor.position.distanceTo(point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = actor;
      }
    }
    return best;
  }

  /**
   * Sends a fish at the float.
   *
   * Returns the species so the minigame can size its bar before the fish has
   * arrived. A fish that is not close enough to see is replaced by one that is
   * — the alternative is a bite with no fish in the frame.
   */
  public approach(point: THREE.Vector3): FishSpecies | null {
    const actor = this.nearest(point, 18) ?? this.spawnAt(point);
    if (!actor) return null;
    actor.state = 'approach';
    actor.target.copy(point);
    this.play(actor, 'fast', 0.18);
    return actor.species;
  }

  /** A fish of the requested species, brought in for a bite that had none. */
  private spawnAt(point: THREE.Vector3): Actor | null {
    if (!this.water || !this.spot) return null;
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const x = point.x + Math.cos(angle) * 5;
      const z = point.z + Math.sin(angle) * 5;
      const surface = this.water.heightAt(x, z);
      if (surface === null || this.water.depthAt(x, z) < MIN_DEPTH) continue;
      const species = pickWeighted(this.spot, this.actors.length);
      const actor = this.makeActor(species, x, surface, z);
      if (actor) {
        this.actors.push(actor);
        return actor;
      }
    }
    return null;
  }

  /** The fish has taken the bait: hold it at the float, thrashing. */
  public hook(point: THREE.Vector3): void {
    for (const actor of this.actors) {
      if (actor.state !== 'approach') continue;
      actor.state = 'hooked';
      actor.target.copy(point);
      this.play(actor, 'fast', 0.12);
    }
  }

  /** It got away. Every fish near the float bolts. */
  public scatter(point: THREE.Vector3): void {
    for (const actor of this.actors) {
      if (actor.state === 'hooked' || actor.state === 'approach') {
        actor.state = 'free';
        actor.timer = 0;
        const away = _dir.copy(actor.position).sub(point).setY(0).normalize();
        if (away.lengthSq() < 0.01) away.set(1, 0, 0);
        actor.target
          .copy(actor.position)
          .addScaledVector(away, ROAM_RADIUS)
          .setY(actor.position.y);
      }
    }
  }

  /**
   * Lifts the hooked fish out of the water, towards the rod.
   *
   * The arc is the one thing the player will look at after winning, so it is
   * not a fade: the fish is pulled up through the surface, hanging from the
   * line, and only leaves the scene once it is in the air beside the rod.
   */
  public lift(point: THREE.Vector3, to: THREE.Vector3): void {
    for (const actor of this.actors) {
      if (actor.state !== 'hooked') continue;
      actor.state = 'lifted';
      actor.lift = { from: actor.position.clone(), to: to.clone(), t: 0 };
      this.play(actor, 'fast', 0.1);
    }
  }

  public update(delta: number, player: THREE.Vector3): void {
    if (!this.ready) return;

    for (let i = this.actors.length - 1; i >= 0; i--) {
      const actor = this.actors[i];
      actor.mixer.update(delta);

      if (actor.state === 'lifted') {
        this.updateLift(actor, delta, i);
        continue;
      }

      this.steer(actor, delta);

      // Keep the fish in water: the sheet wanders, and a fish that swims over a
      // sandbar has to rise with the bed rather than beach itself.
      const surface = this.water?.heightAt(actor.position.x, actor.position.z) ?? null;
      if (surface !== null) {
        actor.surface = surface;
        const floor = this.restY(actor.species, actor.position.x, actor.position.z, surface, actor.halfHeight);
        actor.position.y += (floor - actor.position.y) * Math.min(1, delta * 1.6);
      }

      actor.root.position.copy(actor.position);
      actor.root.rotation.y = actor.heading;
    }
  }

  /**
   * One fish's steering.
   *
   * The body turns towards its target and moves along its own nose — a fish
   * that strafes is a fish on rails. Turn rate is what makes a koi look placid
   * and a barracuda look nervous.
   */
  /**
   * A point a fish may swim to: inside its roaming radius, and over water deep
   * enough to cover it.
   *
   * The target used to be picked blind, so a koi whose home was ten metres off
   * a point could be sent straight at the beach and spend the next two seconds
   * swimming up the sand. Six tries, then home — a school pinned against a
   * shoreline still has to keep moving, and a target that is never accepted
   * would be a fish that stops dead.
   */
  private wanderTarget(actor: Actor): { x: number; z: number } {
    for (let tries = 0; tries < 6; tries += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * ROAM_RADIUS;
      const x = actor.home.x + Math.cos(angle) * radius;
      const z = actor.home.z + Math.sin(angle) * radius;
      if ((this.water?.depthAt(x, z) ?? 0) >= MIN_DEPTH) return { x, z };
    }
    return { x: actor.home.x, z: actor.home.z };
  }

  private steer(actor: Actor, delta: number): void {
    actor.timer -= delta;

    if (actor.state === 'free') {
      if (actor.timer <= 0 || actor.position.distanceTo(actor.target) < 0.6) {
        actor.timer = 1.6 + Math.random() * 2.6;
        const spot = this.wanderTarget(actor);
        actor.target.set(spot.x, actor.position.y, spot.z);
        // Drifting fish idle now and then; it is what keeps the school from
        // reading as nine identical wind-up toys.
        if (Math.random() < 0.22) this.play(actor, 'idle', 0.4);
        else this.play(actor, 'swim', 0.3);
      }
    }

    _dir.copy(actor.target).sub(actor.position);
    _dir.y = 0;
    const distance = _dir.length();

    if (distance > 0.05) {
      _dir.divideScalar(distance);
      const wanted = Math.atan2(_dir.x, _dir.z);
      let turn = wanted - actor.heading;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;

      const rate = actor.state === 'free' ? 1.8 : 3.4;
      actor.heading += turn * Math.min(1, delta * rate);

      const speed =
        actor.state === 'approach' || actor.state === 'hooked'
          ? 1.9
          : actor.playing === 'idle'
            ? 0.12
            : 0.55 + actor.species.speed * 0.35;

      // Only move where the nose points, and never past the target.
      const step = Math.min(distance, speed * delta);
      _next.set(Math.sin(actor.heading), 0, Math.cos(actor.heading));
      actor.position.addScaledVector(_next, step);
    }

    if (actor.state === 'hooked') {
      // A hooked fish circles the float instead of sitting still.
      actor.target.set(
        actor.target.x + Math.sin(performance.now() * 0.004) * 0.6,
        actor.position.y,
        actor.target.z + Math.cos(performance.now() * 0.005) * 0.6
      );
    }
  }

  /** The catch: up through the surface, then gone. */
  private updateLift(actor: Actor, delta: number, index: number): void {
    const lift = actor.lift;
    if (!lift) return;
    lift.t = Math.min(1, lift.t + delta / 0.85);
    const k = lift.t;
    actor.position.lerpVectors(lift.from, lift.to, k);
    // Out of the water first, then across: a fish on a line swings up and in.
    actor.position.y += Math.sin(k * Math.PI) * 0.55;
    actor.root.position.copy(actor.position);
    actor.root.rotation.y += delta * 6;
    actor.root.rotation.z = Math.sin(k * Math.PI) * 0.7;

    if (k >= 1) {
      this.group.remove(actor.root);
      actor.mixer.stopAllAction();
      actor.mixer.uncacheRoot(actor.root);
      this.actors.splice(index, 1);
    }
  }

  /** Removes every fish and frees their skeletons. */
  public clear(): void {
    for (const actor of this.actors) {
      this.group.remove(actor.root);
      actor.mixer.stopAllAction();
      actor.mixer.uncacheRoot(actor.root);
      // Geometry is deliberately not disposed: a clone shares its buffers with
      // the prototype the next school is built from, and freeing them here
      // would leave the lake empty for the rest of the session.
    }
    this.actors.length = 0;
    this.ready = false;
  }

  public dispose(): void {
    this.clear();
    this.prototypes.clear();
    this.loading = null;
    this.scene.remove(this.group);
  }

  public get count(): number {
    return this.actors.length;
  }

  /**
   * A fish to turn on the catch card, or null if its model is not loaded.
   *
   * Cloned rather than taken from the school: the one that was hooked is
   * mid-lift and mid-animation, and the card wants it at rest, centred, with no
   * mixer of its own. The clone shares the prototype's buffers, so the caller
   * must not dispose it — `FoundStage.show(object, false)` is how that is said.
   */
  public displayClone(id: string): THREE.Object3D | null {
    const proto = this.prototypes.get(id);
    if (!proto) return null;
    const root = cloneSkinned(proto.scene) as THREE.Object3D;
    root.name = `catch-${id}`;
    // A fish is authored nose-first along +Z, which is straight at the card's
    // camera: shown as-is it is a head-on disc of a fish, and the stage frames
    // it by its bounding sphere, so the length it is proud of is the length
    // pointing away. A quarter turn puts the profile to the lens.
    root.rotateY(Math.PI / 2);
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
    });
    return root;
  }

  /** Distance from a point to the closest fish, or Infinity for an empty lake. */
  public distanceTo(point: THREE.Vector3): number {
    let best = Infinity;
    for (const actor of this.actors) {
      best = Math.min(best, actor.position.distanceTo(point));
    }
    return best;
  }

  /** Only for the debug handle: the fish a probe can watch swim. */
  public get actorsDebug(): ReadonlyArray<{ id: string; x: number; y: number; z: number; state: string }> {
    return this.actors.map((a) => ({
      id: a.species.id,
      x: +a.position.x.toFixed(2),
      y: +a.position.y.toFixed(2),
      z: +a.position.z.toFixed(2),
      state: a.state,
    }));
  }
}

/** The first few are the common fish; the rest are what a lake stocked later. */
function pickWeighted(spot: FishingSpot, index: number): FishSpecies {
  // The school is built front to back from the common end, so the lake always
  // has its commonest fish in it and only ever one of the last entry — which
  // for the campground is the shark and for the reef is the turtle.
  const common = spot.roster.filter((entry) => speciesById(entry.id)?.rarity === 'common');
  const order = [...common, ...spot.roster.filter((entry) => !common.includes(entry))];
  const entry = order[index % order.length] ?? order[0];
  return speciesById(entry.id) ?? FISH[0];
}

export type { Actor as FishActor };
