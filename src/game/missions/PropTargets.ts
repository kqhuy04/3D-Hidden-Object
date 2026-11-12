import * as THREE from 'three';
import { isPickablePart } from '../world/CollisionGeometry';

/**
 * A map prop that can be selected, but is not part of the hunt.
 *
 * The five objects that do not belong used to be the only things in the world
 * with an `E` prompt, which gave the answer away: walk close to something, see
 * the prompt, press E. The whole game was "find the only interactive prop".
 *
 * These are the rest of the small props. They take the same prompt, the same
 * outline and the same key, and pressing it on one costs a strike. Now the
 * prompt says *this is a thing you can touch*, not *this is the answer*, and the
 * question becomes the one the map was built around: which of these does not
 * belong?
 */
export interface PropTarget {
  object: THREE.Object3D;
  /** World-space centre of the prop's box. */
  centre: THREE.Vector3;
  /** Bounding-sphere radius, so a wide prop is not "too far" from its edge. */
  radius: number;
  /** The kit's part name, e.g. `goods-shed`. Used for debugging only. */
  name: string;
}

/**
 * Biggest prop that still reads as "a thing on a table".
 *
 * The user's own line: decoys must not be a whole building. Two metres is a
 * wardrobe, a phone booth, a rowing boat — the upper end of what a hand could
 * plausibly be laid on. Anything larger is architecture, and clicking a wall is
 * not a guess, it is a mistake the game invited.
 */
const MAX_PROP_SPAN = 2.0;

/** Below this the prop is a bolt head or a decal, not a target. */
const MIN_PROP_SPAN = 0.1;

/**
 * Reads every small prop out of a loaded map.
 *
 * Props are the children of the kit's placement node — the same node whose
 * children became collision parts, which is why the shape of this walk matches
 * `CollisionGeometry.build`. Going through the scene graph rather than the
 * collider is deliberate: the outline pass needs the *render* objects, and a
 * collision part is a triangle soup with no identity left.
 */
export function collectPropTargets(root: THREE.Object3D, containerName: string): PropTarget[] {
  const container =
    (containerName ? root.getObjectByName(containerName) : null) ?? findPlacementContainer(root);
  if (!container) return [];

  const targets: PropTarget[] = [];
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  const size = new THREE.Vector3();

  for (const child of container.children) {
    if (!isPickablePart(child.name)) continue;

    box.setFromObject(child);
    if (box.isEmpty()) continue;

    box.getSize(size);
    const span = Math.max(size.x, size.y, size.z);
    if (span > MAX_PROP_SPAN || span < MIN_PROP_SPAN) continue;

    box.getCenter(centre);
    box.getBoundingSphere(sphere);

    targets.push({
      object: child,
      centre: centre.clone(),
      radius: sphere.radius,
      name: child.name || '(unnamed)',
    });
  }

  return targets;
}

/**
 * The node whose children are the map's props.
 *
 * The kits put every placement under one group; the built-in campground uses
 * the same shape. If a map ever breaks that convention the fallback is the
 * largest direct child of the root, which is where a single-group map keeps it.
 */
function findPlacementContainer(root: THREE.Object3D): THREE.Object3D | null {
  let best: THREE.Object3D | null = null;
  root.traverse((node) => {
    if (node === root) return;
    if (node.children.length < 8) return;
    if (!best || node.children.length > best.children.length) best = node;
  });
  return best;
}
