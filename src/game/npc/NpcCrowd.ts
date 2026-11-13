import * as THREE from 'three';
import { WorldCollision } from '../world/WorldCollision';
import { animateKitHumanoid, ActorAnimator, isHumanoid } from './KitClips';
import { animateQuadruped, isQuadruped } from './Quadruped';
import { InteractableAction } from '../interact/Interactions';
import { stopCullingAnimatedParts } from '../render/skinnedCulling';

/**
 * The people already standing in a map, given something to do.
 *
 * Every kit ships its own cast — a ranger, an angler, a kid with a torch, a
 * queue at a counter — and until now they stood in the exact pose they were
 * modelled in, which is the single loudest thing that says "this is a model and
 * not a place". This walks them about a little and lets them talk to each
 * other.
 *
 * ## Deliberately dull
 *
 * A short leg in a random direction, a pause, a chat, another leg. No pathing
 * graph, no schedules, no crowd simulation. The brief was "enough to feel
 * alive, and nothing that looks strange", and a person who walks four metres,
 * stands for a moment and turns round never looks strange. A person who
 * threads a route between a stall and a doorway does, the first time the route
 * is wrong.
 *
 * ## The ground is the gate
 *
 * There is no navigation mesh, so every candidate leg is *tested*: five samples
 * along it, and the leg is rejected if the ground moves more than `MAX_STEP`
 * under it or if anything solid is in the way. That is what keeps them off the
 * stairs, out of the lake, and off the edge of a ravine. When every direction
 * fails, they stand still — which is exactly what the map did before, so the
 * worst case is the old behaviour.
 */

/** How many people to animate per map. Enough to notice, few enough to afford. */
const MAX_ACTORS = 5;

/**
 * How many animals to animate per map, on their own budget.
 *
 * The farm has a dog, two cows and four sheep, and a shared budget would have
 * spent all five on livestock and left the farmer standing. Animals are also
 * cheaper: their gait is a few sines on twelve bones, where a person is a
 * keyframe clip.
 */
const MAX_ANIMALS = 4;

/** Metres per second. A stroll, not a walk cycle pushed to its limit. */
const WALK_SPEED = 0.85;

/** Bounds of one leg, in metres. */
const LEG_MIN = 2.0;
const LEG_MAX = 4.5;

/**
 * The most the ground may rise or fall along a leg.
 *
 * 0.3 m is a kerb. Anything more is a step, a slope or a ledge, and a person
 * who walks up a staircase with a walk cycle looks like a lift.
 */
const MAX_STEP = 0.3;

/** How far from where the kit placed them they are allowed to drift. */
const HOME_RADIUS = 7;

/** Two people this close during a pause will talk to each other. */
const TALK_RANGE = 3.5;

/** Seconds spent standing between legs. */
const IDLE_MIN = 2.5;
const IDLE_MAX = 6.0;

/**
 * How many directions to try before giving up on a leg.
 *
 * A rejection is not free: each attempt walks six samples of the ground query
 * over the whole collision soup, which on the heaviest map is a couple of
 * milliseconds. Twelve attempts in one frame was the largest remaining spike in
 * the game — 26 ms, on a map with a big terrain.
 */
const LEG_TRIES = 12;

/**
 * How many of those attempts the whole crowd may spend in one frame.
 *
 * One, not one per person: five people finishing a pause on the same frame
 * would otherwise be five searches at once, which is the spike this exists to
 * remove. One attempt is six ground samples, and the search simply resumes next
 * frame — the actor is standing still either way, so the only thing that changes
 * is that a leg that used to be chosen in one frame is now chosen over twelve.
 * Nobody can see the difference between a person who starts walking 200 ms
 * after a pause and one who starts immediately.
 */
const LEG_TRIES_PER_FRAME = 1;

/** How far from the spawn point a person may be and still be worth animating. */
const MAX_SPAWN_DISTANCE = 45;

/**
 * How long a person stays stopped and talking after being spoken to.
 *
 * Long enough that the conversation is over before they wander off — a person
 * who answers your question and immediately walks away mid-sentence is the one
 * thing that would make asking feel broken.
 */
const ANSWER_SECONDS = 7;

/** How far from a person's own origin the prompt is measured, in metres. */
const HEAD_LIFT = 1.15;
const BODY_RADIUS = 0.5;

const UP = new THREE.Vector3(0, 1, 0);

interface Actor {
  unit: THREE.Object3D;
  animator: ActorAnimator;
  /** Where the kit put them, in world space. The centre of their wandering. */
  home: THREE.Vector3;
  target: THREE.Vector3 | null;
  yaw: number;
  /** Seconds left standing still. Above zero means "not walking". */
  idle: number;
  /** True while the current pause is a conversation. */
  talking: boolean;
  speed: number;
  /**
   * How far the character's origin sits above the ground it stands on.
   *
   * Not zero for every kit: some author a character with its origin at the
   * hips, some place a figure on a step. Measuring it once at attach time and
   * holding it constant is what lets the ground test below compare like with
   * like — the first version compared a raw origin height against a ground
   * sample, found a 0.37 m disagreement on every leg, and rejected all of them,
   * so the whole cast stood still.
   */
  footOffset: number;
  /** Height the current leg started at, and the height it ends at. */
  fromY: number;
  toY: number;
  /** Length of the current leg, so progress along it can be interpolated. */
  legLength: number;
  /**
   * Candidate directions left to try for the next leg. Zero means "not
   * searching", which is also the state of somebody who is walking or idling.
   */
  searchTries: number;
  /** Where the search was started from. The actor does not move while it runs. */
  searchFrom: THREE.Vector3;
  /**
   * The "Ask" verb, for a person. Null for an animal — you do not interview a
   * sheep, and a prompt offering to would be the first joke the map makes.
   */
  talk: InteractableAction | null;
}

const _world = new THREE.Vector3();
const _local = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _parentQuat = new THREE.Quaternion();

/**
 * The node that belongs to one character and to nothing else.
 *
 * A merged map nests `character` inside `character-mesh` inside the map root,
 * and only the innermost of those is one person: moving `character-mesh` moves
 * nine of them. So walk up from a bone and stop at the last ancestor whose
 * subtree still holds a single skeleton.
 */
function characterUnit(bone: THREE.Object3D): THREE.Object3D {
  let node: THREE.Object3D = bone;
  while (node.parent) {
    if (countSkeletons(node.parent) > 1) break;
    node = node.parent;
  }
  return node;
}

function countSkeletons(root: THREE.Object3D): number {
  const seen = new Set<THREE.Skeleton>();
  root.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) seen.add(mesh.skeleton);
  });
  return seen.size;
}

/** The world-space heading a node is facing, in radians around +Y. */
function worldYaw(node: THREE.Object3D): number {
  const euler = new THREE.Euler().setFromQuaternion(
    node.getWorldQuaternion(new THREE.Quaternion()),
    'YXZ'
  );
  return euler.y;
}

export class NpcCrowd {
  private actors: Actor[] = [];
  /**
   * Every person the map placed, animated or not.
   *
   * The five who walk are the ones you can talk to, but the rest must still not
   * be decoys: pressing E on a farmer and being told you guessed wrong is the
   * game punishing you for the map's own furniture. This set is what the prop
   * list is filtered against.
   */
  private people = new Set<THREE.Object3D>();
  /**
   * Every mesh that moves with an animated person or animal.
   *
   * Not the same thing as the actor's `unit`: a kit person is a body, a coat
   * and a pair of trousers, and only the body is inside the unit. Anything that
   * has to follow one of these people — the shadow map, for one — has to be
   * handed all of them or the coat stays behind.
   */
  private moving: THREE.Object3D[] = [];
  /** Where the player is, so a person can turn to face them. */
  private playerPosition = new THREE.Vector3();
  /** What to do when the player asks somebody something. */
  private askHandler: ((speaker: THREE.Object3D) => void) | null = null;
  /**
   * Attempts left this frame, across the whole crowd.
   *
   * A field rather than a parameter because the search is entered from three
   * places in `update` and the budget has to be shared by all of them.
   */
  private legBudget = 0;

  constructor(private collision: WorldCollision) {}

  public get count(): number {
    return this.actors.length;
  }

  /** The people on the map, for keeping them out of the decoy list. */
  public get characters(): ReadonlySet<THREE.Object3D> {
    return this.people;
  }

  /** Every mesh that moves with an animated person or animal. */
  public get movingParts(): readonly THREE.Object3D[] {
    return this.moving;
  }

  /** The "Ask" verbs, for the selector. */
  public get actions(): readonly InteractableAction[] {
    const list: InteractableAction[] = [];
    for (const actor of this.actors) if (actor.talk) list.push(actor.talk);
    return list;
  }

  /**
   * What to do when the player asks a person something.
   *
   * The crowd knows who was asked and how to make them answer; the game knows
   * which of the five is still missing and how to say so. Keeping the split
   * here is what stops the hint from becoming a timer with a face on it.
   */
  public setAskHandler(handler: ((speaker: THREE.Object3D) => void) | null): void {
    this.askHandler = handler;
  }

  /** Where each animated person is, for probes and the debug overlay. */
  public positions(): THREE.Vector3[] {
    return this.actors.map((actor) => actor.unit.getWorldPosition(new THREE.Vector3()));
  }

  /**
   * Finds the people in a freshly loaded map and starts them.
   *
   * The nearest `MAX_ACTORS` to the spawn point, because the point of this is
   * that the player *sees* it, and a farmer idling two hundred metres away is
   * a cost with no payoff.
   *
   * `skip` holds the units somebody else is already driving — the horses, which
   * the mount system owns. Walking a horse home mid-ride would be a bad joke.
   */
  public async attach(
    root: THREE.Object3D,
    spawn: THREE.Vector3,
    skip: ReadonlySet<THREE.Object3D> = new Set()
  ): Promise<void> {
    this.dispose();

    const bySkeleton = new Map<THREE.Skeleton, THREE.SkinnedMesh[]>();
    // A kit person is several skinned meshes — body, hair, hat, coat, trousers —
    // and each carries **its own `Skeleton` instance over the same bone
    // objects**. `bySkeleton` therefore sees five rigs where the player sees one
    // person, and `characterUnit` keeps the body and leaves the rest outside the
    // unit it animates. Those parts still move, because they are skinned to the
    // same bones — but they are not inside the unit, so anything done to "the
    // character" has to be done to them separately. Grouping by the root bone
    // finds all of them: same bone object, five skeletons.
    const byRootBone = new Map<THREE.Bone, THREE.SkinnedMesh[]>();
    root.traverse((child) => {
      const mesh = child as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
      const list = bySkeleton.get(mesh.skeleton);
      if (list) list.push(mesh);
      else bySkeleton.set(mesh.skeleton, [mesh]);

      const rootBone = mesh.skeleton.bones[0];
      if (!rootBone) return;
      const parts = byRootBone.get(rootBone);
      if (parts) parts.push(mesh);
      else byRootBone.set(rootBone, [mesh]);
    });

    // One entry per *person*, not per skeleton.
    //
    // A kit character is often several skinned meshes — body, hair, coat — and
    // each can carry its own skeleton at the same coordinates. Without this,
    // the five nearest "skeletons" were five parts of the same man: he walked
    // as one, and four invisible copies of him walked with him. Grouping by
    // where the character stands and keeping the rig with the most bones picks
    // the body and drops the hair.
    const byPlace = new Map<
      string,
      { skeleton: THREE.Skeleton; unit: THREE.Object3D; distance: number; bones: number; animal: boolean }
    >();
    for (const skeleton of bySkeleton.keys()) {
      const human = isHumanoid(skeleton);
      if (!human && !isQuadruped(skeleton)) continue;
      const unit = characterUnit(skeleton.bones[0]);
      // Everyone the map placed, however far away, so that none of them can be
      // mistaken for a prop and cost the player a strike for touching a person.
      if (human) this.people.add(unit);
      if (skip.has(unit)) continue;
      const world = unit.getWorldPosition(_world);
      const distance = world.distanceTo(spawn);
      if (distance > MAX_SPAWN_DISTANCE) continue;
      const key = `${Math.round(world.x * 2)}:${Math.round(world.z * 2)}`;
      const previous = byPlace.get(key);
      if (!previous || skeleton.bones.length > previous.bones) {
        byPlace.set(key, { skeleton, unit, distance, bones: skeleton.bones.length, animal: !human });
      }
    }

    const all = [...byPlace.values()].sort((a, b) => a.distance - b.distance);
    const chosen = [
      ...all.filter((candidate) => !candidate.animal).slice(0, MAX_ACTORS),
      ...all.filter((candidate) => candidate.animal).slice(0, MAX_ANIMALS),
    ];

    const started = await Promise.all(
      chosen.map(async ({ skeleton, unit, animal }): Promise<Actor | null> => {
        try {
          const animator: ActorAnimator = animal
            ? animateQuadruped(skeleton, unit)
            : await animateKitHumanoid(skeleton, unit);
          // Every mesh skinned to this rig, not just the one the unit holds:
          // the coat and the trousers are separate objects, and they are the
          // parts that vanish.
          const parts = byRootBone.get(skeleton.bones[0]) ?? [];
          for (const part of parts) part.frustumCulled = false;
          stopCullingAnimatedParts(unit);
          this.moving.push(...parts);
          const home = unit.getWorldPosition(new THREE.Vector3());
          return {
            unit,
            animator,
            home,
            target: null,
            yaw: worldYaw(unit),
            idle: Math.random() * IDLE_MAX,
            talking: false,
            // An animal trots; a person strolls.
            speed: (animal ? WALK_SPEED * 1.35 : WALK_SPEED) * (0.85 + Math.random() * 0.3),
            footOffset: this.measureFootOffset(home),
            fromY: home.y,
            toY: home.y,
            legLength: 1,
            searchTries: 0,
            searchFrom: home.clone(),
            talk: animal
              ? null
              : {
                  key: `talk:${unit.uuid}`,
                  object: unit,
                  centre: home.clone().setY(home.y + HEAD_LIFT),
                  radius: BODY_RADIUS,
                  // Rewritten every frame in `update`: people walk.
                  moving: true,
                  quiet: true,
                  label: () => 'Ask',
                  use: () => this.ask(unit),
                },
          };
        } catch (error) {
          console.warn('[npc] could not animate a character:', error);
          return null;
        }
      })
    );

    this.actors = started.filter((actor): actor is Actor => actor !== null);
  }

  /**
   * Somebody has been asked something.
   *
   * The person stops, turns, and talks; the game decides what they say. The
   * turn is the whole reason this is not just a line of text — a hint that
   * arrives while the speaker is walking away from you reads as a subtitle,
   * not as a conversation.
   */
  private ask(unit: THREE.Object3D): void {
    const actor = this.actors.find((candidate) => candidate.unit === unit);
    if (!actor) return;

    actor.target = null;
    // A search that was part-way through would otherwise walk them off
    // mid-answer: the tries are the only thing keeping them standing.
    actor.searchTries = 0;
    actor.idle = Math.max(actor.idle, ANSWER_SECONDS);
    actor.talking = true;
    actor.animator.play('Talking');
    this.faceTowards(actor, this.playerPosition.x, this.playerPosition.z);
    this.askHandler?.(unit);
  }

  /**
   * One frame. `delta` is already clamped by the game loop.
   *
   * `player` is where the body is, so a person who is asked something can turn
   * round. Optional because the crowd also runs behind the menu, where there is
   * nobody to turn to.
   */
  public update(delta: number, player?: THREE.Vector3): void {
    if (player) this.playerPosition.copy(player);
    this.legBudget = LEG_TRIES_PER_FRAME;

    for (const actor of this.actors) {
      actor.animator.update(delta);

      // The prompt follows the person, not the place the kit put them.
      if (actor.talk) {
        const here = actor.unit.getWorldPosition(_world);
        actor.talk.centre.set(here.x, here.y + HEAD_LIFT, here.z);
      }

      if (actor.target) {
        this.walk(actor, delta);
        continue;
      }

      // Mid-search. `startLeg` spends at most what is left of the frame's
      // budget, so a search can span a dozen frames and never blocks the frame.
      if (actor.searchTries > 0) {
        this.startLeg(actor);
        continue;
      }

      if (actor.idle > 0) {
        actor.idle -= delta;
        if (actor.idle <= 0) this.startLeg(actor);
        continue;
      }

      this.startLeg(actor);
    }
  }

  private walk(actor: Actor, delta: number): void {
    const target = actor.target;
    if (!target) return;

    const position = actor.unit.getWorldPosition(_world);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < 0.2) {
      this.arrive(actor);
      return;
    }

    const step = Math.min(distance, actor.speed * delta);
    const nextX = position.x + (dx / distance) * step;
    const nextZ = position.z + (dz / distance) * step;

    // The height comes from the leg, not from a fresh ground query at every
    // step. Two reasons: a query per frame per person is the expensive part of
    // this whole system, and the query at the character's own feet reads the
    // character — skinned meshes are baked into the collision soup, so an actor
    // standing still reports the top of its own legs as the floor, 0.37 m up.
    // The leg was validated end to end when it was chosen, so interpolating is
    // both cheaper and more honest.
    const progress = Math.min(1, Math.max(0, 1 - distance / actor.legLength));
    const nextY = actor.fromY + (actor.toY - actor.fromY) * progress;

    this.setPosition(actor, nextX, nextY, nextZ);
    this.faceTowards(actor, nextX + dx, nextZ + dz);
    actor.animator.locomotion(actor.speed);
  }

  private arrive(actor: Actor): void {
    actor.target = null;
    actor.idle = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);

    // A pause is a chance to talk. If somebody else is standing nearby, the two
    // turn to each other and both talk; otherwise it is a coin toss between
    // talking to yourself and plain idling.
    const partner = this.nearestIdle(actor, TALK_RANGE);
    if (partner) {
      actor.talking = true;
      partner.talking = true;
      partner.idle = Math.max(partner.idle, actor.idle);
      partner.animator.play('Talking');
      actor.animator.play('Talking');
      this.faceTowards(actor, partner.unit.getWorldPosition(_world).x, _world.z);
      return;
    }

    actor.talking = Math.random() < 0.4;
    actor.animator.play(actor.talking ? 'Talking' : 'Idle');
  }

  private nearestIdle(actor: Actor, range: number): Actor | null {
    const here = actor.unit.getWorldPosition(_world);
    let best: Actor | null = null;
    let bestDistance = range;
    for (const other of this.actors) {
      if (other === actor || other.target) continue;
      const distance = other.unit.getWorldPosition(new THREE.Vector3()).distanceTo(here);
      if (distance < bestDistance) {
        best = other;
        bestDistance = distance;
      }
    }
    return best;
  }

  private startLeg(actor: Actor): void {
    actor.talking = false;

    const position = actor.unit.getWorldPosition(_world);

    // First slice of a new pause. The leg used to be picked here in one go;
    // now the pause only decides whether the wander has gone too far, and the
    // candidate directions are tried a frame at a time.
    if (actor.searchTries <= 0) {
      // Walk home once they have drifted too far, so a map's cast stays where
      // the kit arranged it instead of slowly collecting in a corner. This one
      // is a single ground query, so it does not need slicing.
      const fromHome = position.distanceTo(actor.home);
      if (fromHome > HOME_RADIUS) {
        actor.target = actor.home.clone();
        actor.fromY = position.y;
        actor.legLength = Math.max(0.01, fromHome);
        actor.toY =
          this.collision.groundAt(actor.home.x, actor.home.z, position.y) + actor.footOffset;
        return;
      }
      actor.searchFrom.copy(position);
      actor.searchTries = LEG_TRIES;
    }

    // Somebody else's search already spent this frame's budget.
    if (this.legBudget <= 0) return;
    this.legBudget--;
    actor.searchTries--;

    const angle = Math.random() * Math.PI * 2;
    const length = LEG_MIN + Math.random() * (LEG_MAX - LEG_MIN);
    const x = actor.searchFrom.x + Math.cos(angle) * length;
    const z = actor.searchFrom.z + Math.sin(angle) * length;

    if (this.legIsWalkable(actor, actor.searchFrom, x, z)) {
      actor.target = new THREE.Vector3(x, position.y, z);
      actor.fromY = position.y;
      actor.legLength = length;
      actor.toY = this.collision.groundAt(x, z, position.y) + actor.footOffset;
      actor.searchTries = 0;
      return;
    }

    // Out of directions. Stand still — which is what the map did before.
    if (actor.searchTries <= 0) {
      actor.idle = IDLE_MIN;
      actor.animator.play('Idle');
    }
  }

  /**
   * Five samples along a leg: flat enough, and nothing solid in the way.
   *
   * Five is a compromise. The legs are at most 4.5 m, so the samples are under
   * a metre apart and a stair is caught; sampling every frame of the walk would
   * cost more than the walk itself.
   */
  private legIsWalkable(actor: Actor, from: THREE.Vector3, toX: number, toZ: number): boolean {
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      // From 0.25 of the way out: the first sample of a short leg would still
      // be inside the character's own baked collision.
      const t = 0.25 + (0.75 * i) / steps;
      const x = from.x + (toX - from.x) * t;
      const z = from.z + (toZ - from.z) * t;
      const ground = this.collision.groundAt(x, z, from.y);
      if (Math.abs(ground + actor.footOffset - from.y) > MAX_STEP) return false;
      if (this.collision.isBlocked(x, z, 0.3)) return false;
    }
    return true;
  }

  /**
   * How far the character's origin sits above the floor *around* it.
   *
   * Sampled in a ring at 1.2 m, not at the feet: skinned meshes are baked into
   * the collision soup at their bind pose, so a ground query at a character's
   * own position returns the top of its own legs. Measured there, every actor
   * reported a 0.37 m offset and every leg was then rejected as a cliff — the
   * whole cast stood still. The median of eight ring samples is the floor.
   */
  private measureFootOffset(home: THREE.Vector3): number {
    const offsets: number[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const x = home.x + Math.cos(angle) * 1.2;
      const z = home.z + Math.sin(angle) * 1.2;
      offsets.push(home.y - this.collision.groundAt(x, z, home.y));
    }
    offsets.sort((a, b) => a - b);
    return offsets[4];
  }

  private setPosition(actor: Actor, x: number, y: number, z: number): void {
    _local.set(x, y, z);
    const parent = actor.unit.parent;
    if (parent) parent.worldToLocal(_local);
    actor.unit.position.copy(_local);
  }

  private faceTowards(actor: Actor, x: number, z: number): void {
    const position = actor.unit.getWorldPosition(_world);
    const yaw = Math.atan2(x - position.x, z - position.z);
    if (Math.abs(yaw - actor.yaw) < 0.01) return;
    actor.yaw = yaw;

    // The unit's parent may itself be rotated (a placement group that turned a
    // prop to face a wall), so the local rotation is the world one minus the
    // parent's.
    _quat.setFromAxisAngle(UP, yaw);
    const parent = actor.unit.parent;
    if (parent) {
      parent.getWorldQuaternion(_parentQuat);
      actor.unit.quaternion.copy(_parentQuat.invert().multiply(_quat));
    } else {
      actor.unit.quaternion.copy(_quat);
    }
  }

  public dispose(): void {
    for (const actor of this.actors) actor.animator.dispose();
    this.actors = [];
    this.people.clear();
    this.moving = [];
  }
}
