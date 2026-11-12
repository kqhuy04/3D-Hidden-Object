import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HiddenItemMap, HiddenItemPlacement } from '../../data/hiddenItems';
import { WorldCollision } from '../world/WorldCollision';

export interface HiddenItem {
  placement: HiddenItemPlacement;
  object: THREE.Object3D;
  /** World-space centre, used for the crosshair test and the prompt. */
  centre: THREE.Vector3;
  /** Bounding-sphere radius, so a wide object is not "too far" from its edge. */
  radius: number;
  found: boolean;
}

const _projected = new THREE.Vector3();
const _toItem = new THREE.Vector3();

/**
 * The objects that do not belong.
 *
 * They are loaded as their own little group rather than merged into the map:
 * picking one up has to remove it from the scene in the same frame, and a map
 * whose collision is rebuilt on every pickup would stutter on the 1.2-million
 * triangle kits. Keeping them separate also means they never block the player,
 * which is the right feel for a toaster.
 */
export class HiddenItemSystem {
  private group = new THREE.Group();
  private items: HiddenItem[] = [];
  private loader = new GLTFLoader();
  private loading = false;

  constructor() {
    this.group.name = 'hidden-items';
  }

  /**
   * Loads a map's five objects into `parent`.
   *
   * Failures are per object: one broken asset leaves a gap in the hunt rather
   * than an unplayable map, and the count adapts.
   */
  public async load(
    map: HiddenItemMap | null,
    parent: THREE.Object3D,
    collision: WorldCollision,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    this.clear();
    if (!map) return;

    this.loading = true;
    parent.add(this.group);

    let loaded = 0;
    const total = map.items.length;

    await Promise.all(
      map.items.map(async (placement) => {
        try {
          const item = await this.loadOne(placement, collision);
          this.items.push(item);
          this.group.add(item.object);
        } catch (err) {
          console.error(`[hidden] could not load ${placement.asset}:`, err);
        } finally {
          loaded++;
          onProgress?.(loaded, total);
        }
      })
    );

    this.loading = false;
  }

  private async loadOne(
    placement: HiddenItemPlacement,
    collision: WorldCollision
  ): Promise<HiddenItem> {
    const gltf = await this.loader.loadAsync(
      `/assets/hidden/${placement.asset}.glb`
    );
    const object = gltf.scene;

    object.name = `hidden:${placement.id}`;
    object.position.set(
      placement.spot.x,
      placement.spot.y ?? this.groundAt(placement.spot.x, placement.spot.z, collision),
      placement.spot.z
    );
    object.rotation.y = placement.rotationY;
    if (placement.scale) object.scale.setScalar(placement.scale);

    object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });

    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const centre = new THREE.Vector3();
    box.getCenter(centre);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);

    return { placement, object, centre, radius: sphere.radius, found: false };
  }

  /**
   * Height of the first solid surface under (x, z).
   *
   * A downward ray against the collision triangles, not the terrain sampler:
   * these objects are placed on decks, plaza tiles and grass alike, and only
   * the triangles know which of those is under a given point.
   */
  private groundAt(x: number, z: number, collision: WorldCollision): number {
    const geometry = collision.getCollisionGeometry();
    if (geometry) {
      // Start the ray just above head height, not in the sky. A ray dropped from
      // sixty metres lands on the first roof it meets, which put a traffic cone
      // on a cabin roof instead of on the ground behind it. Only if nothing is
      // under three metres — a spot on a hillside, say — is the long ray used.
      for (const startY of [3, 60]) {
        const t = geometry.raycastSegment(x, startY, z, x, -30, z);
        if (t !== null) return startY - (startY + 30) * t;
      }
    }
    return collision.getGroundHeight(x, z);
  }

  /**
   * The object under the crosshair, or null.
   *
   * Three gates, in the order the player experiences them: close enough to
   * reach, near the centre of the screen, and not behind a wall. The occlusion
   * test is deliberately lenient — an object tucked behind a crate lip should
   * still be grabbable once you can see it.
   *
   * Reach is measured from `reachFrom` — the player's chest — and not from the
   * camera. The camera is a third-person boom that sits eight metres behind the
   * body by default, so measuring from it meant no object on any map was ever
   * within 3.2 m: the prompt never appeared and E did nothing, while a harness
   * that parked the camera two metres out said everything was fine. Aim and
   * line of sight still come from the camera, because that is what the player
   * is actually looking through.
   */
  public findTarget(
    camera: THREE.PerspectiveCamera,
    cameraPosition: THREE.Vector3,
    reachFrom: THREE.Vector3,
    collision: WorldCollision,
    maxDistance = 2.8
  ): HiddenItem | null {
    if (this.loading) return null;

    let best: HiddenItem | null = null;
    let bestScore = Infinity;

    for (const item of this.items) {
      if (item.found) continue;

      const distance = reachFrom.distanceTo(item.centre);
      if (distance - item.radius > maxDistance) continue;

      _projected.copy(item.centre).project(camera);
      if (_projected.z < -1 || _projected.z > 1) continue;
      const offAxis = Math.max(Math.abs(_projected.x), Math.abs(_projected.y));
      if (offAxis > 0.55) continue;

      const geometry = collision.getCollisionGeometry();
      if (geometry) {
        _toItem.copy(item.centre);
        // `t` is a fraction of the camera-to-item segment, so the near-miss
        // tolerance has to be expressed against that same length. Scaling it by
        // the body distance instead would call a hit 0.35 m from the object
        // "clear" whenever the two lengths differ — which, with a boom camera,
        // they always do.
        const sightDistance = cameraPosition.distanceTo(_toItem);
        const t = geometry.raycastSegment(
          cameraPosition.x,
          cameraPosition.y,
          cameraPosition.z,
          _toItem.x,
          _toItem.y,
          _toItem.z
        );
        if (t !== null && t * sightDistance < sightDistance - 0.35) continue;
      }

      if (offAxis < bestScore) {
        bestScore = offAxis;
        best = item;
      }
    }

    return best;
  }

  /** Removes the object from the scene and frees its GPU buffers. */
  public take(item: HiddenItem): void {
    item.found = true;
    this.group.remove(item.object);
    item.object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }

  /**
   * Hands the object over instead of destroying it.
   *
   * The find screen shows the thing you just picked up, turning it over for a
   * couple of seconds. That needs the real object with its materials still
   * intact, so the caller takes ownership: it is out of the hunt, out of the
   * map, and it is the caller's job to free it when the screen closes.
   */
  public release(item: HiddenItem): THREE.Object3D {
    item.found = true;
    this.group.remove(item.object);
    return item.object;
  }

  public getItems(): readonly HiddenItem[] {
    return this.items;
  }

  public getFoundCount(): number {
    return this.items.filter((i) => i.found).length;
  }

  /** World boxes of the objects still in the world, for the debug wireframe. */
  public getBounds(): THREE.Box3[] {
    return this.items
      .filter((i) => !i.found)
      .map((i) => new THREE.Box3().setFromObject(i.object));
  }

  public clear(): void {
    for (const item of this.items) {
      this.group.remove(item.object);
      item.object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
    }
    this.items = [];
    this.group.clear();
  }
}
