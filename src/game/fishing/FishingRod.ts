import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The rod, in the player's right hand.
 *
 * The model is Polyfork's `propped-fishing-rod`, which is exactly what its name
 * says: a rod leaning on a forked stick, with a line and a float modelled on
 * it. Three of those four things are wanted. The stick is a garden ornament,
 * and the modelled line is 1.1 m of it hanging straight down — the game draws
 * its own line from the tip to wherever the float actually landed, so the
 * authored one has to go.
 *
 * All of it is one mesh, so the line cannot be hidden by node. It is removed by
 * triangle instead: the line and float occupy a column below the tip, and the
 * rod above them is never in that column. 788 triangles are tested once, at
 * load, and the geometry keeps the rest.
 *
 * ## The rod is aimed, not inherited
 *
 * The first version parented the rod to the hand and let the wrist carry it.
 * That is what a prop usually does, and it was wrong here: the Mixamo cast
 * rolls the wrist through 140°, so the rod pointed at the sky at rest and at
 * the ground at the top of the back swing — 0.4 m under the terrain, and
 * through the character's own shoulder on the way. Clamping the tip above the
 * ground fixed the terrain and left the rod crossing the body.
 *
 * The two hands do not encode the answer either. At rest they sit side by side
 * with the rod vertical; at the top of the wind-up they have swapped heights.
 * There is no fixed offset from either hand that puts the rod where the
 * animator meant it.
 *
 * So the rod's *direction* is authored (see `ROD_AIM` in `FishingSystem`) and
 * only its *position* comes from the hand. The rod is a lever: the grip stays
 * in the fist and the tip points where the cast curve says. That is also what
 * makes the reel hang down instead of rolling with the palm.
 */
const ROD_URL = '/assets/props/fishing-rod.glb';

/**
 * Grip point in the rod's own frame, in metres.
 *
 * The handle runs 0 … 0.30 m along +X and the reel sits at 0.41. The grip is
 * kept near the butt end on purpose: everything behind it hangs down out of the
 * hand, and at the top of the wind-up the hand is beside the character's head,
 * so 30 cm of butt is 30 cm through the chest. At 0.20 the reel still clears
 * the top fist and the butt stops before it reaches the body.
 */
const GRIP = new THREE.Vector3(0.06, 0.055, 0);

/**
 * The rod's own node sits at x −1.1 inside the model, so the grip is at −0.80
 * in the frame the model is loaded in. Written out rather than derived because
 * it is a fact about the file, and a re-export that moves the node should be
 * noticed here rather than silently shift the rod in the hand.
 */
const GRIP_IN_MODEL = new THREE.Vector3(GRIP.x - 1.1, GRIP.y, GRIP.z);

/** Where the line leaves the rod: the far tip, in the model's frame. */
const TIP_IN_MODEL = new THREE.Vector3(1.03, 1.1, 0);

/**
 * The tip direction in the holder's frame: a rod is a diagonal, up 1.1 m as
 * well as out 2.1 m. Derived from the grip so that moving the grip cannot
 * silently tilt every pose.
 */
const TIP_DIR = new THREE.Vector3(
  TIP_IN_MODEL.x - GRIP_IN_MODEL.x,
  TIP_IN_MODEL.y - GRIP_IN_MODEL.y,
  0
).normalize();

/** Scratch, so aiming allocates nothing. */
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _targetUp = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _cross = new THREE.Vector3();
const _parentQ = new THREE.Quaternion();
const _other = new THREE.Vector3();

export class FishingRod {
  /** Attached to the hand bone; everything else hangs off it. */
  private holder = new THREE.Group();
  /** The model root, offset so `GRIP` lands on the holder's origin. */
  private body: THREE.Object3D | null = null;
  /** An empty at the tip, so the line has something to follow. */
  private tip = new THREE.Object3D();
  private crank: THREE.Object3D | null = null;
  private crankAngle = 0;
  private loaded = false;
  private visible = false;
  /**
   * The left hand, when there is one.
   *
   * Measured, not assumed: the idle clip puts the hands 22 cm apart *across*
   * the shaft, not along it, so a rod welded to the right hand passes 22 cm
   * from the left one and the left hand grips nothing. The holder is therefore
   * slid to the midpoint between the two hands every frame — each fist then
   * straddles the cork instead of one holding it and one waving beside it.
   */
  private otherHand: THREE.Bone | null = null;

  constructor() {
    this.holder.name = 'fishing-rod-holder';
    this.holder.visible = false;
  }

  public async load(): Promise<void> {
    if (this.loaded) return;
    const gltf = await new GLTFLoader().loadAsync(ROD_URL);
    const root = gltf.scene;

    // The forked stick is what propped the rod up on the ground. Nobody is
    // going to be holding that.
    const stick = root.getObjectByName('stick');
    stick?.removeFromParent();

    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      if (mesh.name === 'rod-mesh') stripHangingLine(mesh);
    });

    this.crank = root.getObjectByName('reel-crank') ?? null;

    // The model is authored at 2.22 m. A bone inherits the character's height
    // normalisation, so an un-compensated rod comes out 10 % short on a tall
    // character and 10 % long on a short one. Measured when it is attached.
    this.body = root;
    root.position.copy(GRIP_IN_MODEL).multiplyScalar(-1);
    this.holder.add(root);

    this.tip.position.copy(TIP_IN_MODEL);
    root.add(this.tip);

    this.loaded = true;
  }

  /**
   * Straps the rod to a hand bone.
   *
   * The bone's world scale is the character's own normalisation (the roster is
   * scaled to one capsule height), so the rod is counter-scaled here to keep
   * its authored 2.22 m. Without it the rod is a different size on every
   * character, which is the sort of thing nobody names but everybody sees.
   */
  public attach(hand: THREE.Bone, otherHand: THREE.Bone | null = null): void {
    hand.add(this.holder);
    this.otherHand = otherHand;
    hand.updateWorldMatrix(true, false);
    const scale = hand.getWorldScale(new THREE.Vector3()).x || 1;
    this.body?.scale.setScalar(1 / scale);
  }

  public detach(): void {
    this.holder.removeFromParent();
    this.otherHand = null;
    this.holder.position.set(0, 0, 0);
    this.visible = false;
    this.holder.visible = false;
  }

  public show(): void {
    this.visible = true;
    this.holder.visible = true;
  }

  public hide(): void {
    this.visible = false;
    this.holder.visible = false;
  }

  public isVisible(): boolean {
    return this.visible;
  }

  /** World position of the rod's tip, for the line and the cast. */
  public getTip(target: THREE.Vector3): THREE.Vector3 {
    this.tip.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.tip.matrixWorld);
  }

  /**
   * Points the rod along a world direction, with the reel hanging down.
   *
   * The grip does not move — it is wherever the hand is — so this only ever
   * turns the lever. Two rotations: one that takes the rod's authored diagonal
   * onto `direction`, and one about `direction` that rolls the rod until its
   * own "up" faces the world's, which is what keeps the reel underneath
   * instead of swinging round with the palm.
   */
  public aim(direction: THREE.Vector3): void {
    const parent = this.holder.parent;
    if (!parent) return;
    if (direction.lengthSq() < 1e-8) return;
    _dir.copy(direction).normalize();

    // Halfway between the fists. `worldToLocal` on the hand bone gives the
    // offset in the space the holder's own position lives in, so the
    // character's height normalisation is already baked in.
    if (this.otherHand) {
      this.otherHand.getWorldPosition(_other);
      parent.worldToLocal(_other);
      this.holder.position.copy(_other).multiplyScalar(0.5);
    }

    _q1.setFromUnitVectors(TIP_DIR, _dir);

    // The rod's "up" after the first rotation, flattened into the plane
    // perpendicular to the direction.
    _up.set(0, 1, 0).applyQuaternion(_q1);
    _up.addScaledVector(_dir, -_up.dot(_dir));

    // World up in that same plane. A rod pointed straight up has no answer —
    // every roll is equally upright — so it keeps whatever it had.
    _targetUp.set(0, 1, 0).addScaledVector(_dir, -_dir.y);
    if (_up.lengthSq() > 1e-6 && _targetUp.lengthSq() > 1e-6) {
      _up.normalize();
      _targetUp.normalize();
      _cross.copy(_up).cross(_targetUp);
      const angle = Math.atan2(_dir.dot(_cross), _up.dot(_targetUp));
      _q2.setFromAxisAngle(_dir, angle);
      _q1.premultiply(_q2);
    }

    parent.getWorldQuaternion(_parentQ);
    this.holder.quaternion.copy(_parentQ).invert().multiply(_q1);
  }

  /** Spins the reel while the player is reeling. */
  public update(deltaSeconds: number, reeling: boolean): void {
    if (!this.crank || !this.visible || !reeling) return;
    // One turn every 0.28 s, about the axis the crank was rigged on. The kit
    // names the pivot (`reel-crank`) precisely so it can be turned.
    this.crankAngle += deltaSeconds * Math.PI * 2 * 3.6;
    this.crank.rotation.z = this.crankAngle;
  }

  public dispose(): void {
    this.detach();
    this.body?.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.body = null;
    this.loaded = false;
  }
}

/**
 * Removes the modelled line and float.
 *
 * In the rod's own frame the rod runs from the butt at (0, 0) up to the tip at
 * (2.13, 1.12), and the line hangs from that tip down to a float sitting on the
 * ground at (2.25, 0). The rod is never below y 0.9 past x 1.9 — it has already
 * climbed by then — so a triangle whose centroid is down there belongs to the
 * line, the float, or the little loop of slack near the butt.
 *
 * Rebuilt in place: the index buffer is filtered and the position/normal/colour
 * attributes are left exactly as authored, because the rod's blue and the cork
 * handle are vertex colours and re-packing them is a chance to lose them.
 */
function stripHangingLine(mesh: THREE.Mesh): void {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.getAttribute('position');
  if (!position) return;

  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const keep: number[] = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let i = 0; i + 2 < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);

    const x = (a.x + b.x + c.x) / 3;
    const y = (a.y + b.y + c.y) / 3;
    if (x > 1.9 && y < 0.9) continue;

    keep.push(ia, ib, ic);
  }

  geometry.setIndex(keep);
  geometry.computeBoundingSphere();
}
