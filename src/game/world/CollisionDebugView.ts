import * as THREE from 'three';
import { CircleContact, CollisionGeometry } from './CollisionGeometry';
import { WorldCollision } from './WorldCollision';

/**
 * Visual overlay for the collision system, enabled with `?wire=1` or F3.
 *
 * Draws exactly what the physics uses, so a mismatch between a prop and its
 * collider is visible immediately:
 *  - green: collision triangles (what actually blocks the player)
 *  - orange: per-object AABB (the old behaviour, kept for comparison)
 *  - cyan: player capsule
 *  - blue: interaction bounds (the hunt's objects, never used as physics)
 *  - magenta: contact points with their push normals
 *  - yellow: ground contact under the player
 *
 * Off by default, and *not* implied by `?debug=1` any more: a 400k-triangle
 * map turns into 1.2 million line vertices, which is a frame-rate cliff on a
 * software renderer and pure waste in an automated walk test. `?debug=1` only
 * exposes the scripting handle; the overlay is a separate switch.
 *
 * The line buffers are built lazily on first enable, so a session that never
 * opens the overlay never pays for them.
 */
export class CollisionDebugView {
  private scene: THREE.Scene;
  private root = new THREE.Group();
  private collisionLines: THREE.LineSegments | null = null;
  private boundsLines: THREE.LineSegments | null = null;
  private interactionLines: THREE.LineSegments | null = null;
  private capsuleMesh: THREE.Mesh;
  private contactLines: THREE.LineSegments;
  private groundMarker: THREE.Mesh;
  private enabled = false;
  /** Kept so the static lines can be built the first time the overlay opens. */
  private source: { geometry: CollisionGeometry; collision: WorldCollision } | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root.name = 'collision-debug';
    this.root.visible = false;
    this.scene.add(this.root);

    const capsuleGeo = new THREE.CapsuleGeometry(0.3, 1.15, 6, 12);
    this.capsuleMesh = new THREE.Mesh(
      capsuleGeo,
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.9 })
    );
    this.capsuleMesh.renderOrder = 999;
    this.root.add(this.capsuleMesh);

    this.contactLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xff2fd0 })
    );
    this.contactLines.frustumCulled = false;
    this.root.add(this.contactLines);

    this.groundMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe14d })
    );
    this.root.add(this.groundMarker);

    const params = new URLSearchParams(window.location.search);
    if (params.get('wire') === '1') this.setEnabled(true);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.setEnabled(!this.enabled);
      }
    });
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(value: boolean): void {
    this.enabled = value;
    this.root.visible = value;
    if (value) this.ensureLines();
  }

  public toggle(): void {
    this.setEnabled(!this.enabled);
  }

  /** Builds the static visualisation from the collision data (called once, after load). */
  public setCollisionGeometry(geometry: CollisionGeometry, collision: WorldCollision): void {
    this.source = { geometry, collision };
    this.disposeLines();

    // Keep the capsule size in sync with the controller configuration even when
    // the overlay stays closed, so opening it later shows the right body.
    const capsule = collision.getCapsule();
    const geo = new THREE.CapsuleGeometry(capsule.radius, Math.max(0.05, capsule.height - capsule.radius * 2), 6, 12);
    this.capsuleMesh.geometry.dispose();
    this.capsuleMesh.geometry = geo;

    if (this.enabled) this.buildLines();
  }

  private ensureLines(): void {
    if (this.collisionLines || !this.source) return;
    this.buildLines();
  }

  private buildLines(): void {
    const { geometry } = this.source!;

    const triSegments: number[] = [];
    geometry.appendDebugSegments(triSegments);
    if (triSegments.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(triSegments, 3));
      this.collisionLines = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: 0x35d07f, transparent: true, opacity: 0.55 })
      );
      this.collisionLines.name = 'collision-triangles';
      this.root.add(this.collisionLines);
    }

    const boxSegments: number[] = [];
    for (const part of geometry.partStats) pushBoxSegments(boxSegments, part.bounds);
    if (boxSegments.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(boxSegments, 3));
      this.boundsLines = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.5 })
      );
      this.boundsLines.name = 'part-aabb';
      this.root.add(this.boundsLines);
    }
  }

  /** Interaction bounds are the hunt's object boxes: shown for contrast, never physics. */
  public setInteractionBounds(boxes: THREE.Box3[]): void {
    if (this.interactionLines) {
      this.root.remove(this.interactionLines);
      this.interactionLines.geometry.dispose();
      (this.interactionLines.material as THREE.Material).dispose();
      this.interactionLines = null;
    }
    const segs: number[] = [];
    for (const b of boxes) pushBoxSegments(segs, b);
    if (!segs.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    this.interactionLines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.6 })
    );
    this.interactionLines.name = 'interaction-bounds';
    this.root.add(this.interactionLines);
  }

  public update(
    playerPosition: THREE.Vector3,
    capsuleHeight: number,
    groundY: number,
    contacts: CircleContact[]
  ): void {
    if (!this.enabled) return;

    this.capsuleMesh.position.set(playerPosition.x, playerPosition.y + capsuleHeight / 2, playerPosition.z);
    this.groundMarker.position.set(playerPosition.x, groundY + 0.01, playerPosition.z);

    const pts: number[] = [];
    for (const c of contacts) {
      const len = 0.35;
      pts.push(c.point.x, c.point.y, c.point.z);
      pts.push(c.point.x + c.nx * len, c.point.y, c.point.z + c.nz * len);
    }
    this.contactLines.geometry.dispose();
    const g = new THREE.BufferGeometry();
    if (pts.length) g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.contactLines.geometry = g;
  }

  private disposeLines(): void {
    for (const line of [this.collisionLines, this.boundsLines]) {
      if (!line) continue;
      this.root.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.collisionLines = null;
    this.boundsLines = null;
  }
}

function pushBoxSegments(out: number[], box: THREE.Box3): void {
  const { min, max } = box;
  const corners: [number, number, number][] = [
    [min.x, min.y, min.z], [max.x, min.y, min.z], [max.x, min.y, max.z], [min.x, min.y, max.z],
    [min.x, max.y, min.z], [max.x, max.y, min.z], [max.x, max.y, max.z], [min.x, max.y, max.z],
  ];
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [a, b] of edges) {
    out.push(...corners[a], ...corners[b]);
  }
}
