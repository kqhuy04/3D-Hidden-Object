import * as THREE from 'three';
import { WorldCollision } from '../world/WorldCollision';
import { animateQuadruped, isQuadruped, QuadrupedAnimator } from './Quadruped';
import { Player } from '../player/Player';
import { InteractableAction } from '../interact/InteractableAction';

/**
 * The animals you can get on.
 *
 * Four of the kits ship a rigged four-legged animal, and one of them ships a
 * horse with a saddle already modelled on its back: `saddled-horse` on the
 * western town, `burro-with-panniers` on the day-of-the-dead street, a cow and
 * an ibex on the farm and the mountain. Standing next to a saddled horse and
 * being told it is scenery is the one thing a player will not believe, so the
 * horse is rideable.
 *
 * ## Steering, not strafing
 *
 * The horse does not move in the direction the stick points; it turns, and then
 * it walks where it is facing. That is the whole difference between driving a
 * vehicle and riding an animal, and it costs three lines: the input sets a
 * *heading*, the body turns toward it at a rate, and the movement is along the
 * body's own forward. A horse that sidesteps looks like a shopping trolley.
 *
 * ## Where the rider sits
 *
 * Measured off the skeleton, not guessed: the saddle is a little above the
 * `Spine` joint, and the rider's *hips* go there rather than his feet. The
 * player's model stands on its origin, so placing the origin on the saddle
 * would push the legs through the animal — the seated clip drops the hips
 * ~0.39 m, and that drop is measured once, from the posed body, and subtracted.
 */

/** Names that mean "this animal can carry a person". */
const RIDEABLE = /(^|[-_])(horse|pony|burro|donkey|mule|ibex|cow|llama|camel|ox|buffalo|deer)([-_]|$)/i;

/** How many rideable animals to wire up per map. */
const MAX_MOUNTS = 3;

/** How far from the spawn point a mount is worth finding, in metres. */
const MAX_SPAWN_DISTANCE = 50;

/** Metres per second at a canter, and radians per second of turn. */
const RIDE_SPEED = 3.4;
const TURN_RATE = 2.2;

/** Where the rider sits, as a fraction of the animal's height above `Spine`. */
const SEAT_LIFT = 0.13;

/** How far to the side the rider lands when getting off, in metres. */
const DISMOUNT_OFFSET = 1.1;

/** The height of the rider's hips in the seated pose, until it is measured. */
const HIP_LIFT_FALLBACK = 0.56;

interface Mount {
  unit: THREE.Object3D;
  animator: QuadrupedAnimator;
  /** Where the kit put it, in world space. */
  home: THREE.Vector3;
  /** Which way the model faces, in its own frame. */
  forwardLocal: THREE.Vector3;
  /** The saddle, in the unit's own frame. */
  seatLocal: THREE.Vector3;
  height: number;
  /** World heading, in radians. */
  yaw: number;
  action: InteractableAction;
}

const _world = new THREE.Vector3();
const _local = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _probe = new THREE.Vector3();
const _move = new THREE.Vector3();
/** Scratch for the saddle position, which is read every frame while riding. */
const _seat = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function boneKey(name: string): string {
  return name.replace(/_\d+$/, '');
}

function countSkeletons(root: THREE.Object3D): number {
  const seen = new Set<THREE.Skeleton>();
  root.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) seen.add(mesh.skeleton);
  });
  return seen.size;
}

/** The node that belongs to one animal and to nothing else. */
function characterUnit(bone: THREE.Object3D): THREE.Object3D {
  let node: THREE.Object3D = bone;
  while (node.parent) {
    if (countSkeletons(node.parent) > 1) break;
    node = node.parent;
  }
  return node;
}

export class Mounts {
  private mounts: Mount[] = [];
  private riding: Mount | null = null;
  /** Every mesh that moves with an animal, tack included. See `movingParts`. */
  private moving: THREE.Object3D[] = [];
  /** The rider's hip height in the seated pose, measured once per character. */
  private hipLift = HIP_LIFT_FALLBACK;
  private hipMeasured = false;

  constructor(
    private collision: WorldCollision,
    private player: Player
  ) {}

  public get count(): number {
    return this.mounts.length;
  }

  public isRiding(): boolean {
    return this.riding !== null;
  }

  /** The animal under the rider, if any — so the highlight can leave it alone. */
  public get mountedObject(): THREE.Object3D | null {
    return this.riding?.unit ?? null;
  }

  /** The ground the rider is over, which is what the camera settles onto. */
  public getGroundY(): number {
    return this.riding ? this.riding.unit.getWorldPosition(_world).y : 0;
  }

  public get actions(): readonly InteractableAction[] {
    return this.mounts.map((mount) => mount.action);
  }

  /** Units this class owns, so the crowd does not walk them off. */
  public get claimed(): Set<THREE.Object3D> {
    return new Set(this.mounts.map((mount) => mount.unit));
  }

  /**
   * Every mesh that moves with an animal, tack included.
   *
   * A horse is a body, a saddle, a collar and a bridle, and only the body is
   * inside the unit the mount system drives. Anything that has to follow the
   * animal — the shadow map, for one — needs all four.
   */
  public get movingParts(): readonly THREE.Object3D[] {
    return this.moving;
  }

  public async attach(root: THREE.Object3D, spawn: THREE.Vector3): Promise<void> {
    this.dispose();

    // One entry per animal: a horse is four skinned meshes (body, saddle,
    // collar, bridle) sharing a standing place, so the rig with the most bones
    // is the body and the rest are its tack.
    const byRootBone = new Map<THREE.Bone, THREE.SkinnedMesh[]>();
    const byPlace = new Map<
      string,
      { skeleton: THREE.Skeleton; unit: THREE.Object3D; distance: number; bones: number }
    >();
    root.traverse((child) => {
      const mesh = child as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
      if (!isQuadruped(mesh.skeleton)) return;
      const rootBone = mesh.skeleton.bones[0];
      if (!rootBone) return;
      const parts = byRootBone.get(rootBone);
      if (parts) parts.push(mesh);
      else byRootBone.set(rootBone, [mesh]);

      const unit = characterUnit(rootBone);
      if (!RIDEABLE.test(unit.name || '')) return;
      const world = unit.getWorldPosition(_world);
      const distance = world.distanceTo(spawn);
      if (distance > MAX_SPAWN_DISTANCE) return;
      const key = `${Math.round(world.x * 2)}:${Math.round(world.z * 2)}`;
      const previous = byPlace.get(key);
      if (!previous || mesh.skeleton.bones.length > previous.bones) {
        byPlace.set(key, { skeleton: mesh.skeleton, unit, distance, bones: mesh.skeleton.bones.length });
      }
    });

    const chosen = [...byPlace.values()]
      .sort((a, b) => a.distance - b.distance)
      .slice(0, MAX_MOUNTS);

    for (const { skeleton, unit } of chosen) {
      try {
        const mount = this.build(skeleton, unit);
        if (mount) {
          this.mounts.push(mount);
          this.moving.push(...(byRootBone.get(skeleton.bones[0]) ?? [unit]));
        }
      } catch (error) {
        console.warn('[mounts] could not rig an animal:', error);
      }
    }
  }

  private build(skeleton: THREE.Skeleton, unit: THREE.Object3D): Mount | null {
    const animator = animateQuadruped(skeleton, unit);
    const bones: Record<string, THREE.Bone> = {};
    for (const bone of skeleton.bones) {
      const key = boneKey(bone.name);
      if (!bones[key]) bones[key] = bone;
    }
    const hips = bones.Hips;
    const head = bones.Head ?? bones.Neck;
    if (!hips || !head) return null;

    unit.updateMatrixWorld(true);
    const hipsWorld = hips.getWorldPosition(new THREE.Vector3());
    const headWorld = head.getWorldPosition(new THREE.Vector3());

    // Which way the animal faces, measured from its own skeleton rather than
    // assumed: one kit's horse looks down -X, and the next one will not.
    const forwardWorld = headWorld.clone().sub(hipsWorld);
    forwardWorld.y = 0;
    if (forwardWorld.lengthSq() < 1e-4) return null;
    forwardWorld.normalize();
    const forwardLocal = unit.worldToLocal(hipsWorld.clone().add(forwardWorld)).sub(
      unit.worldToLocal(hipsWorld.clone())
    );
    forwardLocal.y = 0;
    forwardLocal.normalize();

    // The saddle: a little above the spine, in the middle of the back.
    const spine = bones.Spine ?? bones.Chest ?? hips;
    const seatWorld = spine.getWorldPosition(new THREE.Vector3());
    seatWorld.y += animator.height * SEAT_LIFT;
    const seatLocal = unit.worldToLocal(seatWorld.clone());

    const home = unit.getWorldPosition(new THREE.Vector3());
    const yaw = Math.atan2(forwardWorld.x, forwardWorld.z);

    const mount: Mount = {
      unit,
      animator,
      home,
      forwardLocal,
      seatLocal,
      height: animator.height,
      yaw,
      action: {
        key: `mount:${unit.uuid}`,
        object: unit,
        centre: home.clone().setY(home.y + animator.height * 0.55),
        radius: Math.max(0.8, animator.height * 0.5),
        // The centre above is rewritten every frame from where the animal
        // actually is: ride it twenty metres and the old one would still be
        // pointing at the stable, so "Get off" would never appear again.
        moving: true,
        label: () => (this.riding === mount ? 'Get off' : 'Ride'),
        // Only the animal under you answers E. Offering "Ride" on the next
        // horse along, while you are sitting on one, is a prompt that lies.
        enabled: () => this.riding === null || this.riding === mount,
        use: () => this.toggle(mount),
      },
    };
    return mount;
  }

  private toggle(mount: Mount): void {
    if (this.riding === mount) {
      this.dismount();
      return;
    }
    if (this.riding) this.dismount();
    this.mountUp(mount);
  }

  private mountUp(mount: Mount): void {
    this.riding = mount;
    this.hipMeasured = false;

    // Sit the body down. The clip is applied before anything is measured, so
    // the first frame of riding already has the hips where they belong.
    const animator = this.player.getAnimator();
    animator?.play('Driving', 0.15);
    animator?.update(0.2);

    // Where the rider's hips ended up, relative to the body's own origin. This
    // is what has to be subtracted from the saddle to put the seat of the
    // trousers on the seat of the saddle.
    const group = this.player.getGroup();
    const hips = this.findBone(group, 'Hips');
    if (hips) {
      group.updateMatrixWorld(true);
      this.hipLift = hips.getWorldPosition(new THREE.Vector3()).y - group.position.y;
      this.hipMeasured = true;
    }
  }

  private findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
    let found: THREE.Bone | null = null;
    root.traverse((child) => {
      const bone = child as THREE.Bone;
      if (!found && bone.isBone && boneKey(bone.name) === name) found = bone;
    });
    return found;
  }

  /** Steps off, if mounted. A new round teleports the body, so it must not ride. */
  public dismount(): void {
    const mount = this.riding;
    if (!mount) return;
    this.riding = null;

    const position = mount.unit.getWorldPosition(new THREE.Vector3());
    const right = new THREE.Vector3(Math.cos(mount.yaw), 0, -Math.sin(mount.yaw));
    const x = position.x + right.x * DISMOUNT_OFFSET;
    const z = position.z + right.z * DISMOUNT_OFFSET;
    const ground = this.collision.groundAt(x, z, position.y);

    this.player.setPosition(x, ground + 0.05, z);
    this.player.getGroup().rotation.y = mount.yaw;
    this.player.getAnimator()?.play('Idle', 0.2);
  }

  /**
   * One frame.
   *
   * `input` is the same camera-relative vector the player walks with; the mount
   * turns it into a heading. When nobody is riding, the animals breathe.
   */
  public update(delta: number, input: THREE.Vector2, cameraYaw: number): void {
    for (const mount of this.mounts) {
      if (mount !== this.riding) {
        mount.animator.locomotion(0);
        mount.animator.update(delta);
      }
      // Where the animal is, as of this frame — the prompt is measured from it.
      const here = mount.unit.getWorldPosition(_world);
      mount.action.centre.set(here.x, here.y + mount.height * 0.55, here.z);
    }

    const mount = this.riding;
    if (!mount) return;

    const wants = input.length() > 0.05;
    if (wants) {
      // Camera-relative, like walking: the heading the stick points at, then
      // the body turns toward it.
      const wanted = Math.atan2(input.x, -input.y) + cameraYaw;
      let diff = wanted - mount.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = Math.min(1, TURN_RATE * delta);
      mount.yaw += diff * turn;
    }

    const speed = wants ? RIDE_SPEED : 0;
    const unit = mount.unit;
    const from = unit.getWorldPosition(_world);
    _probe.set(from.x, from.y, from.z);
    _move.set(Math.sin(mount.yaw) * speed * delta, 0, Math.cos(mount.yaw) * speed * delta);
    const result = this.collision.moveCapsule(_probe, _move, undefined, from.y);
    const next = result.position;

    this.place(mount, next.x, next.y, next.z);
    this.face(mount, mount.yaw);

    // The gait is driven by how fast the animal is *actually* going, so a horse
    // stopped by a wall does not walk on the spot.
    const travelled = Math.hypot(next.x - from.x, next.z - from.z) / Math.max(delta, 1e-4);
    mount.animator.locomotion(travelled);
    mount.animator.update(delta);

    this.placeRider(mount);
  }

  /** Writes the animal's world position into its parent's space. */
  private place(mount: Mount, x: number, y: number, z: number): void {
    _local.set(x, y, z);
    const parent = mount.unit.parent;
    if (parent) parent.worldToLocal(_local);
    mount.unit.position.copy(_local);
  }

  private face(mount: Mount, yaw: number): void {
    // The model's own forward is not +Z, so the yaw the game steers by has to be
    // corrected by however far off the model is.
    const off = Math.atan2(mount.forwardLocal.x, mount.forwardLocal.z);
    _quat.setFromAxisAngle(UP, yaw - off);
    const parent = mount.unit.parent;
    if (parent) {
      const parentQuat = parent.getWorldQuaternion(new THREE.Quaternion());
      mount.unit.quaternion.copy(parentQuat.invert().multiply(_quat));
    } else {
      mount.unit.quaternion.copy(_quat);
    }
  }

  /** Puts the rider on the saddle, facing the way the animal faces. */
  private placeRider(mount: Mount): void {
    const group = this.player.getGroup();
    // The unit's own matrix, not its whole subtree: `place` has just written its
    // position, and the saddle is a point in the unit's frame. `true` for the
    // ancestors is what a rotated placement group needs; the forty bones under
    // it are re-derived by the scene's own traversal before the draw, so forcing
    // them here was doing that work twice every frame.
    mount.unit.updateWorldMatrix(true, false);
    const seat = mount.unit.localToWorld(_seat.copy(mount.seatLocal));

    group.position.set(seat.x, seat.y - (this.hipMeasured ? this.hipLift : HIP_LIFT_FALLBACK), seat.z);
    group.rotation.y = mount.yaw;
  }

  public dispose(): void {
    for (const mount of this.mounts) mount.animator.dispose();
    this.mounts = [];
    this.moving = [];
    this.riding = null;
    this.hipMeasured = false;
  }
}
