import * as THREE from 'three';
import { WorldCollision } from '../world/WorldCollision';

/**
 * Things in the map that do something when you press E.
 *
 * The kits are full of furniture with moving parts — doors, shutters, chests,
 * drawers, valves, wagon wheels, hanging signs, lanterns — and every one of them
 * was, until now, scenery. Worse than scenery: the game taught the player that
 * pressing E on a prop is a *mistake*, so the whole world was a field of things
 * you must not touch. This is the other half of that lesson. Some props answer.
 *
 * ## Four verbs, not forty
 *
 * Everything here is one of four motions, because those four cover two thousand
 * props across twenty-two maps, and because a player learns four rules and then
 * reads the world correctly:
 *
 * - **hinge** — doors, gates, shutters, chests, drawers, cabinets, lids. A panel
 *   turning about its own edge.
 * - **spin** — wheels, valves, cranks, winches. A round thing turning about its
 *   own centre.
 * - **rock** — bells, hanging signs, swings, rocking chairs. A hanging thing,
 *   pushed, settling.
 * - **lamp** — lanterns, street lamps, candles. Something that was dark and is
 *   now lit.
 *
 * ## Found by name, validated by shape
 *
 * A kit names its parts descriptively (`door-l`, `chest`, `bull-wheel`,
 * `paper-lantern`), and there is no other index to go by — the merge destroys
 * materials but keeps node names. A name alone is not enough, though: it can
 * lie, and a node can be a group holding four doors. So a candidate must also
 * *be* the thing — no more than three metres across, not a bracket, mount, frame
 * or post (the static halves of the same objects), and not a bone. The kits'
 * skeletons have a bone called `Chest`, and a horse's ribcage is not a chest.
 *
 * ## The pivot is the hard part
 *
 * A door swings on its edge, not its centre, and the kits do not say which edge.
 * They do, however, author the panel with its origin *at* the hinge: a door's
 * geometry runs from x=0 to x=0.89 while the node itself sits at x=-1.55, and
 * the panel then swings correctly about the node's own origin. So the hinge
 * point is taken from the box — the nearest point of the footprint to the node's
 * origin — which is the hinge for a panel authored that way and the centre for
 * one authored centrally. The rotation is applied about that point in the
 * parent's space, which is exact for both.
 */

export type Family = 'hinge' | 'spin' | 'rock' | 'lamp';

/** A prop the player can act on, as the selector sees it. */
export interface InteractableAction {
  key: string;
  object: THREE.Object3D;
  centre: THREE.Vector3;
  radius: number;
  /** What E will do, in the imperative. Changes as the prop changes state. */
  label(): string;
  use(): void;
  /**
   * False while the action makes no sense, e.g. "Ride" offered for a horse you
   * are already sitting on a different one of. The selector skips it entirely,
   * so the prompt cannot offer something that is not on.
   */
  enabled?(): boolean;
  /**
   * True when the thing walks. A door stays where the kit built it, so its
   * centre can be filed in the spatial hash once at load; a horse ridden across
   * the map and a person strolling home cannot, because a cell key worked out
   * at load time is a lie two seconds later. Moving actions are held in a flat
   * list and re-measured every frame — there are a handful of them, so the cost
   * is a few distance checks rather than a second hash.
   */
  moving?: boolean;
  /**
   * True when the highlight should leave this alone.
   *
   * A person is not a prop: lighting one up like a lantern to say "you can talk
   * to this" makes the map feel like a vending machine. The prompt alone is
   * enough, and the same is already true of the horse you are sitting on.
   */
  quiet?: boolean;
}

/** Parts of a family that are the static half: a hinge is not a door. */
const STATIC_SUFFIX =
  /-(mount|base|bracket|frame|support|arm|post|pole|stand|hub|axle|holder|housing|hinge|wax|ring|rope|chain|track|rail)s?(-|$)/i;

/** Names that belong to a family's vocabulary but are not props at all. */
const NEVER = /(^|[-_])(tree|log|palm|birch|oak|pine|branch|root|bone)s?(-|$)/i;

const FAMILIES: { family: Family; match: RegExp }[] = [
  // `door-l` and `door-r` are leaves; `door-frame` is not.
  {
    family: 'hinge',
    match: /(^|[-_])(doors?|gates?|shutters?|hatch|lid|lids|drawers?|cabinets?|cupboard|wardrobe|chest|trunk|locker|fridge|freezer|toolbox)([-_]|$)/i,
  },
  { family: 'spin', match: /(^|[-_])(wheel|valve|crank|propeller|turbine|winch|reel|spool|handwheel)([-_]|$)/i },
  { family: 'rock', match: /(^|[-_])(swing|bell|rocking-chair|hanging-sign|chime)([-_]|$)/i },
  { family: 'lamp', match: /(^|[-_])(lamp|lantern|torch|candle|sconce|streetlight|floodlight)([-_]|$)/i },
];

/**
 * Props whose opening has to be walked through.
 *
 * Only these re-bake their collider when they move. A chest lid does not need
 * one — nothing was ever going to walk through it — and re-baking two thousand
 * of them would cost more than the whole interaction system.
 */
const PASSAGE = /(^|[-_])(doors?|gates?|shutters?|hatch)([-_]|$)/i;

/** How far a door swings, and how far a lid lifts. */
const PANEL_ANGLE = 1.75;
const LID_ANGLE = 1.25;
/** Seconds to open, and to close. Closing is slower: it settles. */
const OPEN_TIME = 0.45;
const CLOSE_TIME = 0.6;

/** A wheel kicked once turns about a revolution before it stops. */
const SPIN_IMPULSE = 13;
const SPIN_DAMPING = 2.0;

/** A hanging thing, pushed: it swings and settles. */
const ROCK_IMPULSE = 1.9;
const ROCK_SPRING = 9;
const ROCK_DAMPING = 1.1;
const ROCK_LIMIT = 0.28;

/** Warm light, and how long it takes to come up. */
const LAMP_COLOUR = 0xffd39a;
const LAMP_RAMP = 0.4;
const LAMP_INTENSITY = 1.35;

const _box = new THREE.Box3();
const _local = new THREE.Box3();
const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _vec = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** One prop, its rest transform, and whatever it is currently doing. */
interface Entry extends InteractableAction {
  family: Family;
  /** Rest transform, in the parent's space. */
  home: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  /** The point the motion turns about, in the parent's space. */
  pivot: THREE.Vector3;
  /** The motion's axis, in the parent's space. */
  axis: THREE.Vector3;
  /** Angle now, the angle it started this move from, and where it is going. */
  angle: number;
  from: number;
  target: number;
  /** The fully-open angle, sign included. */
  span: number;
  /** Seconds the current move takes, and how long it has taken. */
  duration: number;
  elapsed: number;
  moving: boolean;
  /** Angular velocity, for the verbs that are impulses rather than targets. */
  velocity: number;
  /** Lamps: the materials to light, built on first use. */
  glow: THREE.MeshStandardMaterial[] | null;
  level: number;
  lit: boolean;
}

/** Eased 0..1, so a door starts and stops instead of snapping. */
function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * The node's own bounding box, in its own local space.
 *
 * Not `setFromObject`: that answers in world space, and a box turned by the
 * map's placement tells you nothing about where the hinge is on the panel.
 */
function localBox(node: THREE.Object3D): THREE.Box3 {
  node.updateWorldMatrix(true, true);
  _inv.copy(node.matrixWorld).invert();
  _local.makeEmpty();
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    _box.copy(geometry.boundingBox).applyMatrix4(_m);
    _local.union(_box);
  });
  return _local;
}

export class Interactions {
  private entries: Entry[] = [];
  /** Nodes that answer to E, for filtering the decoy list. */
  private claimed = new Set<THREE.Object3D>();
  /** Props that contain one of those nodes, likewise. */
  private containers = new Set<THREE.Object3D>();

  constructor(private collision: WorldCollision) {}

  public get count(): number {
    return this.entries.length;
  }

  /** Every prop that answers to E, as candidates. */
  public get actions(): readonly InteractableAction[] {
    return this.entries;
  }

  /** True when this prop is part of something interactive. */
  public covers(object: THREE.Object3D): boolean {
    return this.claimed.has(object) || this.containers.has(object);
  }

  /**
   * Finds every verb-bearing prop in a freshly loaded map.
   *
   * Walked top-down, and a match claims its whole subtree: a door is `door` with
   * a `door-mesh` inside it, and animating both would swing the panel twice as
   * far. The outermost match wins, because the outermost is where the kit put
   * the hinge.
   */
  public attach(root: THREE.Object3D): void {
    this.dispose();
    root.updateMatrixWorld(true);

    const walk = (node: THREE.Object3D, inside: boolean): void => {
      // A skeleton is not furniture. `Chest` is a bone in every one of these
      // rigs, and a horse's ribcage does not open.
      if ((node as THREE.Bone).isBone) return;

      const name = node.name || '';
      let claimed = inside;
      if (!claimed && name && !STATIC_SUFFIX.test(name) && !NEVER.test(name)) {
        const family = FAMILIES.find((f) => f.match.test(name))?.family;
        if (family) {
          const box = localBox(node).clone();
          if (!box.isEmpty()) {
            const size = box.getSize(new THREE.Vector3());
            const span = Math.max(size.x, size.y, size.z);
            // A whole building is not a chest, and a bolt is not a wheel.
            if (span <= 3 && span >= 0.08 && this.add(node, family, box, size)) claimed = true;
          }
        }
      }
      for (const child of node.children) walk(child, claimed);
    };

    walk(root, false);

    // The props that *contain* an interactive node: a `fence-gate` sitting in a
    // paddock group is a decoy prop and an interaction at once, and two
    // candidates on one object is a coin toss on every press.
    for (const entry of this.entries) {
      let parent = entry.object.parent;
      while (parent) {
        this.containers.add(parent);
        parent = parent.parent;
      }
    }
  }

  private add(node: THREE.Object3D, family: Family, box: THREE.Box3, size: THREE.Vector3): boolean {
    if (this.claimed.has(node)) return false;

    const centreLocal = box.getCenter(new THREE.Vector3());

    // The node's rest frame, and world up expressed in it.
    const worldQuat = node.getWorldQuaternion(new THREE.Quaternion());
    const upLocal = UP.clone().applyQuaternion(worldQuat.clone().invert()).normalize();

    // Which local horizontal axis is long, and which is thin. Kits stand their
    // props up the same way round, so a yaw-only placement keeps these
    // horizontal in world space.
    const longIsX = size.x >= size.z;
    const long = longIsX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const thin = longIsX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);

    const hingeLocal = new THREE.Vector3();
    let axisLocal = upLocal;
    let span = PANEL_ANGLE;

    if (family === 'hinge') {
      const tall = size.y > 1.2 * Math.max(size.x, size.z);
      if (tall) {
        // A door: turns about the vertical line through the edge nearest the
        // node's origin, which is where the kit authored the hinge.
        axisLocal = upLocal;
        hingeLocal.set(
          Math.min(Math.max(0, box.min.x), box.max.x),
          box.min.y,
          Math.min(Math.max(0, box.min.z), box.max.z)
        );
        // Swing away from whichever side the panel was drawn on, so the two
        // leaves of a double door part instead of both going the same way.
        const freeX = Math.abs(box.max.x) > Math.abs(box.min.x) ? 1 : -1;
        span = PANEL_ANGLE * (longIsX ? -freeX : freeX);
      } else {
        // A lid or a drawer: turns about the long horizontal edge, and lifts.
        axisLocal = long;
        const nearest = longIsX ? box.min.z : box.min.x;
        const farthest = longIsX ? box.max.z : box.max.x;
        const free = Math.abs(farthest) > Math.abs(nearest) ? 1 : -1;
        hingeLocal.copy(centreLocal);
        if (longIsX) hingeLocal.z = free > 0 ? box.max.z : box.min.z;
        else hingeLocal.x = free > 0 ? box.max.x : box.min.x;
        hingeLocal.y = box.max.y;
        span = LID_ANGLE * -free;
      }
    } else if (family === 'spin') {
      // A round thing turns about its own centre, about the thin axis — the
      // direction a wheel's axle points.
      axisLocal = thin;
      hingeLocal.copy(centreLocal);
    } else if (family === 'rock') {
      // Hanging things swing from the top; nothing else here is big enough for
      // the pivot to read.
      axisLocal = long;
      hingeLocal.set(centreLocal.x, box.max.y, centreLocal.z);
    } else {
      // Lamps do not move.
      hingeLocal.copy(centreLocal);
    }

    // From the node's frame into its parent's: the node's rest rotation is the
    // whole of the conversion.
    const home = node.position.clone();
    const homeQuat = node.quaternion.clone();
    const axis = axisLocal.clone().applyQuaternion(homeQuat).normalize();
    const pivot = home
      .clone()
      .add(hingeLocal.clone().multiply(node.scale).applyQuaternion(homeQuat));

    const centre = box.getCenter(new THREE.Vector3()).applyMatrix4(node.matrixWorld);

    const entry: Entry = {
      key: `act:${node.uuid}`,
      family,
      object: node,
      centre,
      radius: Math.max(0.25, size.length() * 0.5),
      home,
      homeQuat,
      pivot,
      axis,
      angle: 0,
      from: 0,
      target: 0,
      span,
      duration: OPEN_TIME,
      elapsed: 0,
      moving: false,
      velocity: 0,
      glow: null,
      level: 0,
      lit: false,
      label: () => this.labelOf(entry),
      use: () => this.use(entry),
    };

    this.entries.push(entry);
    this.claimed.add(node);
    return true;
  }

  private labelOf(entry: Entry): string {
    switch (entry.family) {
      case 'hinge':
        return entry.target !== 0 ? 'Close' : 'Open';
      case 'spin':
        return 'Turn';
      case 'rock':
        return 'Push';
      default:
        return entry.lit ? 'Blow out' : 'Light';
    }
  }

  private use(entry: Entry): void {
    switch (entry.family) {
      case 'hinge': {
        const open = entry.target === 0;
        entry.from = entry.angle;
        entry.target = open ? entry.span : 0;
        entry.elapsed = 0;
        entry.duration = open ? OPEN_TIME : CLOSE_TIME;
        entry.moving = true;
        break;
      }
      case 'spin':
        entry.velocity = SPIN_IMPULSE;
        break;
      case 'rock':
        entry.velocity += ROCK_IMPULSE;
        break;
      default:
        entry.lit = !entry.lit;
        break;
    }
  }

  /**
   * One frame of motion.
   *
   * A map holds two hundred of these and all but a handful are at rest, so the
   * loop exits almost immediately for the ones that are not moving.
   */
  public update(delta: number): void {
    for (const entry of this.entries) {
      if (entry.family === 'lamp') {
        const goal = entry.lit ? 1 : 0;
        // Nothing to do until the first press, and nothing to do once settled.
        if (entry.glow && entry.level === goal) continue;
        if (!entry.glow && !entry.lit) continue;
        this.updateLamp(entry, delta);
        continue;
      }

      if (entry.family === 'hinge') {
        if (!entry.moving) continue;
        entry.elapsed += delta;
        const t = Math.min(1, entry.elapsed / entry.duration);
        entry.angle = entry.from + (entry.target - entry.from) * ease(t);
        this.place(entry);
        if (t >= 1) {
          entry.moving = false;
          // The collider follows the panel only for the things a body could walk
          // through, and only once the swing has settled: re-reading a thousand
          // triangles per frame would cost more than the whole render.
          if (PASSAGE.test(entry.object.name || '')) {
            this.collision.getCollisionGeometry()?.rebakePart(entry.object);
          }
        }
        continue;
      }

      if (entry.family === 'spin') {
        if (Math.abs(entry.velocity) < 0.02) {
          entry.velocity = 0;
          continue;
        }
        entry.angle += entry.velocity * delta;
        entry.velocity *= Math.exp(-SPIN_DAMPING * delta);
        this.place(entry);
        continue;
      }

      // Rock: a spring back to hanging straight down, carrying the energy the
      // push gave it. Damping is what stops a bell ringing forever.
      if (Math.abs(entry.velocity) < 0.01 && Math.abs(entry.angle) < 0.002) {
        entry.angle = 0;
        entry.velocity = 0;
        continue;
      }
      entry.velocity -= (ROCK_SPRING * entry.angle + ROCK_DAMPING * entry.velocity) * delta;
      entry.angle = Math.max(-ROCK_LIMIT, Math.min(ROCK_LIMIT, entry.angle + entry.velocity * delta));
      this.place(entry);
    }
  }

  /** Writes the entry's current angle into the scene graph. */
  private place(entry: Entry): void {
    _quat.setFromAxisAngle(entry.axis, entry.angle);
    entry.object.quaternion.copy(_quat).multiply(entry.homeQuat);
    // The rotation happens about a point that is not the node's own origin, so
    // its position has to orbit that point as well.
    _vec.copy(entry.home).sub(entry.pivot).applyQuaternion(_quat).add(entry.pivot);
    entry.object.position.copy(_vec);
  }

  /**
   * Switches a lamp on or off.
   *
   * Emissive only — no light is added. A hundred point lights in a merged map
   * would cost more than the map itself, and what the player actually reads at
   * dusk is the glass going from dark to warm. The materials are cloned on the
   * first press, so a kit that shares one material between forty lanterns lights
   * the one that was touched.
   */
  private updateLamp(entry: Entry, delta: number): void {
    if (!entry.glow) {
      const glow: THREE.MeshStandardMaterial[] = [];
      entry.glow = glow;
      entry.object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        // A mesh may hold one material or an array of them, and either may be
        // shared with meshes elsewhere in the map. Both are replaced with a copy
        // that only this lamp owns.
        const list = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).slice();
        if (Array.isArray(mesh.material)) mesh.material = list;
        for (let i = 0; i < list.length; i++) {
          const source = list[i] as THREE.MeshStandardMaterial;
          if (!source || !source.emissive) continue;
          const clone = source.clone();
          clone.emissive = new THREE.Color(LAMP_COLOUR);
          clone.emissiveIntensity = 0;
          if (Array.isArray(mesh.material)) mesh.material[i] = clone;
          else mesh.material = clone;
          glow.push(clone);
        }
      });
      if (glow.length === 0) {
        // Nothing emissive to light: leave it off and stop asking.
        entry.lit = false;
        entry.level = 0;
        entry.glow = null;
        return;
      }
    }

    const goal = entry.lit ? 1 : 0;
    const step = delta / LAMP_RAMP;
    entry.level =
      entry.level < goal ? Math.min(goal, entry.level + step) : Math.max(goal, entry.level - step);

    for (const material of entry.glow) {
      material.emissiveIntensity = entry.level * LAMP_INTENSITY;
    }
  }

  public dispose(): void {
    for (const entry of this.entries) {
      if (!entry.glow) continue;
      for (const material of entry.glow) material.dispose();
    }
    this.entries = [];
    this.claimed.clear();
    this.containers.clear();
  }
}
