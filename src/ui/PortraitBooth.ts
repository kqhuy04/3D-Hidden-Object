import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * A head-and-shoulders photograph of whoever is talking to you.
 *
 * The dialogue panel wants a face, and the map's people are skinned meshes
 * living in the world: they cannot be moved into a portrait, and cloning them
 * into a second WebGL context would compile every material twice for a picture
 * that is taken once.
 *
 * So the shot is taken with the renderer that is already running: a clone of the
 * speaker goes into a private scene, a camera is aimed at its head from the
 * player's side, one frame is drawn into a 256² target, and the pixels are
 * copied into a 2D canvas the panel can hold. No second context, no per-frame
 * cost, and the result is a real picture of the actual person — which is the
 * whole point of putting a portrait there at all.
 *
 * The clone is disposed of immediately. Its geometry and materials belong to
 * the map and must not be freed; only the skeletons the clone created are its
 * own, and those own a bone texture each.
 */

/** Pixels across the portrait. A 96 px well at 2x, so it survives a retina screen. */
const SIZE = 256;

/** Vertical field of view. Narrow, because a portrait is not a photograph of a room. */
const FOV = 30;

/** Head height as a share of the body, measured down from the top of the box. */
const HEAD_SHARE = 0.11;

/** Camera distance as a share of the body's height. */
const FRAMING = 0.52;

/** How far above the head the lens aims, as a share of body height. */
const AIM_SHARE = 0.02;

/**
 * How many ancestors the rig may be reached through before this gives up.
 *
 * A kit sometimes keeps a character's bones outside the node that holds its
 * body. Cloning the body alone would leave the skeleton half-missing, so the
 * clone has to start above the bones — but a rig root that turns out to be the
 * whole map is not a portrait, it is a second copy of the level.
 */
const MAX_RIG_CLIMB = 4;

const _dir = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _clear = new THREE.Color();

export class PortraitBooth {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);
  private target: THREE.WebGLRenderTarget;
  private pixels: Uint8Array;
  /** One picture per speaker, so asking twice does not take two shots. */
  private cache = new Map<string, HTMLCanvasElement | null>();
  /**
   * What the last shot measured, for a probe.
   *
   * Framing a rig is guesswork until it is checked against a number: the box,
   * the head bone and the lens have to agree, and a portrait that comes back as
   * a slab of shirt says only that one of them does not.
   */
  public lastShot: {
    height: number;
    head: [number, number, number];
    camera: [number, number, number];
    bones: number;
    root: string;
    box: [number, number, number, number, number, number];
    scale: [number, number, number];
  } | null = null;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, { depthBuffer: true });
    // The renderer writes the colour space of whatever it is drawing into. Left
    // linear, every portrait would come back several stops too dark.
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.pixels = new Uint8Array(SIZE * SIZE * 4);

    const key = new THREE.DirectionalLight(0xfff4e2, 2.4);
    key.position.set(0.8, 1.4, 1.6);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xd2dcea, 1.2);
    fill.position.set(-1.6, 0.4, 0.9);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(-0.4, 1.0, -1.8);
    this.scene.add(rim);

    this.scene.add(new THREE.HemisphereLight(0xfdf8ec, 0x7d7466, 1.1));
  }

  /**
   * @param unit the person, as the crowd sees them.
   * @param from where the player is standing — the face is turned towards them,
   *   so the lens goes on that side.
   * @returns a transparent portrait, or null when the rig could not be cloned.
   */
  public capture(
    unit: THREE.Object3D,
    from: THREE.Vector3,
    parts: readonly THREE.Object3D[] = [unit]
  ): HTMLCanvasElement | null {
    const cached = this.cache.get(unit.uuid);
    if (cached !== undefined) return cached;

    let shot: HTMLCanvasElement | null = null;
    try {
      shot = this.shoot(unit, from, parts);
    } catch (error) {
      console.warn('[portrait] could not take a picture:', error);
      shot = null;
    }
    this.cache.set(unit.uuid, shot);
    return shot;
  }

  /** Drops the cache. A map change replaces every person in it. */
  public clear(): void {
    this.cache.clear();
  }

  private shoot(
    unit: THREE.Object3D,
    from: THREE.Vector3,
    parts: readonly THREE.Object3D[]
  ): HTMLCanvasElement | null {
    const root = rigRoot(unit, parts);
    if (!root) return null;

    const clone = cloneSkinned(root) as THREE.Object3D;
    // The clone arrives with the *local* transform it had under its parent, and
    // its parent here is a bare scene. A kit that bakes its scale into a
    // placement group therefore comes back life-size in a room built for a
    // doll, or the other way round — the first version framed a hat brim
    // because the model was eleven metres tall and the camera was not. Copying
    // the world transform puts it back exactly where it stood.
    root.updateWorldMatrix(true, false);
    clone.matrix.copy(root.matrixWorld);
    clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);

    this.scene.add(clone);
    clone.updateMatrixWorld(true);

    try {
      // A skeleton that lost a bone in the clone is a collapsed mesh: the bones
      // are looked up by identity, and a bone outside the cloned subtree comes
      // back undefined. Better a panel with no portrait than a smear of NaN.
      let intact = true;
      clone.traverse((node) => {
        const mesh = node as THREE.SkinnedMesh;
        if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
        if (mesh.skeleton.bones.some((bone) => !bone)) intact = false;
      });
      if (!intact) return null;

      const box = new THREE.Box3().setFromObject(clone);
      const bodyHeight = box.isEmpty() ? 1.8 : box.max.y - box.min.y;

      // Aim at the head *bone* when the rig has one. A bounding box is the
      // wrong tool here: a skinned mesh reports its bind-pose bounds, which on
      // a kit character is the pose it was authored in and not the pose it is
      // standing in — the first version framed the inside of a ranger's hat.
      const head = headBone(clone);
      if (head) {
        head.getWorldPosition(_centre);
      } else {
        box.getCenter(_centre);
        _centre.y = box.max.y - bodyHeight * HEAD_SHARE;
      }

      // The speaker was turned to face the player a moment ago, so the player's
      // side of them is the side with the face on it.
      _dir.set(from.x - _centre.x, 0, from.z - _centre.z);
      if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, 1);
      _dir.normalize();

      const distance = Math.min(12, Math.max(0.35, bodyHeight * FRAMING));
      this.camera.position.set(
        _centre.x + _dir.x * distance,
        _centre.y + bodyHeight * AIM_SHARE,
        _centre.z + _dir.z * distance
      );
      this.camera.lookAt(_centre.x, _centre.y, _centre.z);
      this.camera.updateMatrixWorld(true);

      let bones = 0;
      clone.traverse((node) => {
        if ((node as THREE.Bone).isBone) bones++;
      });
      this.lastShot = {
        height: +bodyHeight.toFixed(2),
        head: [+_centre.x.toFixed(2), +_centre.y.toFixed(2), +_centre.z.toFixed(2)],
        camera: [
          +this.camera.position.x.toFixed(2),
          +this.camera.position.y.toFixed(2),
          +this.camera.position.z.toFixed(2),
        ],
        bones,
        root: root.name || '(unnamed)',
        box: [
          +box.min.x.toFixed(2),
          +box.min.y.toFixed(2),
          +box.min.z.toFixed(2),
          +box.max.x.toFixed(2),
          +box.max.y.toFixed(2),
          +box.max.z.toFixed(2),
        ],
        scale: [+clone.scale.x.toFixed(2), +clone.scale.y.toFixed(2), +clone.scale.z.toFixed(2)],
      };

      return this.draw();
    } finally {
      this.scene.remove(clone);
      // The clone's own skeletons own a bone texture each; the geometry and the
      // materials are the map's and are shared with the person still standing
      // in the world.
      clone.traverse((node) => {
        const mesh = node as THREE.SkinnedMesh;
        if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.dispose();
      });
    }
  }

  /** One frame into the target, then the pixels into a canvas. */
  private draw(): HTMLCanvasElement {
    const previousTarget = this.renderer.getRenderTarget();
    const previousAlpha = this.renderer.getClearAlpha();
    this.renderer.getClearColor(_clear);

    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);

    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(_clear, previousAlpha);

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    if (!context) return canvas;

    // WebGL reads bottom-up, a canvas is top-down.
    const image = context.createImageData(SIZE, SIZE);
    const row = SIZE * 4;
    for (let y = 0; y < SIZE; y++) {
      const source = (SIZE - 1 - y) * row;
      image.data.set(this.pixels.subarray(source, source + row), y * row);
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }
}

/**
 * The lowest ancestor that holds the whole rig, so a clone can be complete.
 *
 * Usually the unit itself: `characterUnit` already picks the node that owns one
 * skeleton. When a kit keeps the bones beside the body instead of inside it,
 * this climbs until it finds a node that contains both — or gives up, because
 * the only node above that may be the entire map.
 */
function rigRoot(unit: THREE.Object3D, parts: readonly THREE.Object3D[]): THREE.Object3D | null {
  // A kit splits one person into several skinned meshes that share a rig, and
  // each carries its own `Skeleton` over the same bones. The clone has to hold
  // all of them — the body is not the person — and all of their bones.
  const bones = new Set<THREE.Bone>();
  for (const part of parts) {
    part.traverse((node) => {
      const mesh = node as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
      for (const bone of mesh.skeleton.bones) if (bone) bones.add(bone);
    });
  }

  const holdsAll = (node: THREE.Object3D): boolean => {
    for (const part of parts) if (!isUnder(node, part)) return false;
    for (const bone of bones) if (!isUnder(node, bone)) return false;
    return true;
  };

  // Start at the prop, not at the body. A kit's character is a skinned torso
  // with plain meshes for the boots and the hat beside it, so the node the
  // crowd drives (`body_6`) is a torso with no head on it. The first ancestor
  // whose name is not a wrapper is the person.
  let node: THREE.Object3D | null = propRoot(unit);
  for (let climb = 0; node && climb <= MAX_RIG_CLIMB; climb++) {
    if (holdsAll(node)) return node;
    node = node.parent;
  }
  return null;
}

/** Node names that describe a wrapper rather than a person (see `NpcCrowd`). */
const WRAPPER_NAME =
  /^(character|char|body|rig|root|armature|group|scene|skeleton|.*-mesh|.*-character)(_?\d+)?$/i;

/** The node that is the person, rather than the body inside them. */
function propRoot(unit: THREE.Object3D): THREE.Object3D {
  let node: THREE.Object3D = unit;
  for (let climb = 0; climb < MAX_RIG_CLIMB && node.parent; climb++) {
    const name = (node.name || '').trim();
    if (name && !WRAPPER_NAME.test(name)) return node;
    node = node.parent;
  }
  return node;
}

function isUnder(ancestor: THREE.Object3D, node: THREE.Object3D): boolean {
  let walk: THREE.Object3D | null = node;
  while (walk) {
    if (walk === ancestor) return true;
    walk = walk.parent;
  }
  return false;
}

/**
 * The rig's head bone, if it has one.
 *
 * `Head`, `mixamorig:Head`, `Head_01` — every exporter spells it differently
 * and every one of them contains the word. A "headlight" does not, because the
 * letter after it is a letter.
 */
function headBone(root: THREE.Object3D): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((node) => {
    if (found) return;
    const bone = node as THREE.Bone;
    if (!bone.isBone) return;
    if (/(^|[^a-z])head([^a-z]|$)/i.test(bone.name || '')) found = bone;
  });
  return found;
}
