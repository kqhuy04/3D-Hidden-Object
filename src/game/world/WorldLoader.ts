import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { CollisionGeometry } from './CollisionGeometry';
import { WorldCollision, ClimbVolume } from './WorldCollision';
import { PROP_REMOVALS, PropRemoval } from '../../data/mapFixes';
import { GAME_CONFIG } from '../../data/gameConfig';

export class WorldLoader {
  private loader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private sceneGroup: THREE.Group = new THREE.Group();
  private collisionGeometry = new CollisionGeometry();
  /** Where the load time went, in milliseconds. Logged once per map. */
  public timings: Record<string, number> = {};

  constructor() {
    this.loader = new GLTFLoader();
    // The map is Draco-compressed: 19 MB of raw float vertex data becomes
    // 1.5 MB, and the 250 kB decoder is paid once. The loader only touches it
    // when the glTF actually declares the extension.
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('/draco/');
    this.loader.setDRACOLoader(this.dracoLoader);
    this.sceneGroup.name = 'world-root';
  }

  public async load(
    sceneUrl: string,
    collision: WorldCollision,
    onProgress?: (percent: number) => void,
    /** Registry id of the map, so its entry in `PROP_REMOVALS` can be applied. */
    mapId?: string
  ): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      const started = performance.now();
      this.loader.load(
        sceneUrl,
        (gltf) => {
          // Parsing — including the Draco decode — happens before this callback,
          // so the first mark is the cost of turning bytes into a scene.
          const parsedAt = performance.now();
          this.timings.fetchAndParse = Math.round(parsedAt - started);

          const root = gltf.scene;
          this.sceneGroup.add(root);

          // Configure shadows, terrain, targets, collisions
          this.processScene(root, collision, mapId);
          this.timings.process = Math.round(performance.now() - parsedAt);

          onProgress?.(100);
          resolve(this.sceneGroup);
        },
        (event) => {
          if (event.lengthComputable && onProgress) {
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
          }
        },
        (error) => {
          reject(new Error(`Failed to load world scene from ${sceneUrl}: ${error}`));
        }
      );
    });
  }

  private processScene(root: THREE.Object3D, collision: WorldCollision, mapId?: string): void {
    root.updateMatrixWorld(true);

    // Authored defects first, before anything is measured from the geometry.
    // A removed prop must not reach the collision builder, or the player bumps
    // into the fence that is no longer there.
    const removals = mapId ? PROP_REMOVALS[mapId] : undefined;
    if (removals?.length) this.timings.removals = removeProps(root, removals);

    // Terrain first: the collision builder asks it for the ground under every
    // triangle, so it has to be registered before the build.
    const tTerrain = performance.now();
    const terrainMeshes = findTerrainMeshes(root);
    // The water in the built-in campground is a sheet *draped on the ground*:
    // its vertices sit one centimetre above the terrain they cover, so there is
    // no depth to it at all and the character appears to walk on the surface.
    // Dig the bed out from under it before the heightfield is rasterised, so
    // what the player walks on is the bottom of the lake.
    this.timings.dredge = Math.round(dredgeWaterBeds(root, terrainMeshes));
    const terrainSet = new Set<THREE.Object3D>(terrainMeshes);
    collision.setTerrainMeshes(terrainMeshes);
    this.timings.terrain = Math.round(performance.now() - tTerrain);

    // Flat ground scatter — pebbles, gravel, shingle — is authored as a single
    // thin decal: one plane of stones, nine centimetres thick, laid at one Y.
    // On a beach that slopes and dips toward the water that plane cannot follow
    // the sand, so half of every cluster hangs in the air and the rest sinks
    // out of sight. Bend the decal onto the terrain before the collider is
    // built, so what the player sees and what they walk on agree.
    this.timings.scatter = Math.round(conformGroundScatter(root, collision));

    // Collision is built from the real triangles of every solid mesh, so props
    // block by their actual shape instead of an enclosing bounding box. The
    // terrain sampler lets each triangle record the ground it stands on, which
    // is what decides "step over or wall" without depending on the player.
    // The ground meshes are handed over as `skip`: they are already the
    // heightfield, and keeping them as props fenced the body inside the
    // landscape.
    this.collisionGeometry.build(root, (x, z) => collision.getGroundHeight(x, z), terrainSet);
    collision.setCollisionGeometry(this.collisionGeometry);
    this.timings.collision = this.collisionGeometry.stats.buildMs;

    // Ladders: the kits already name them, so there is nothing to author. A
    // ladder is a tall, narrow box, which is exactly the test below — the
    // narrowness matters, because a tall *wall* also has "ladder" nowhere in
    // its name but a tall crate stack might.
    collision.setClimbVolumes(findClimbVolumes(root));

    // People in the kits are authored in a T-pose and never rigged to a clip,
    // so the crowd in `chrome-arcology-transit` stands with both arms straight
    // out. Dropping the upper-arm bones is a pose change, not an animation, and
    // it is done here — once, at load — because nothing else touches those
    // skeletons again.
    this.timings.arms = Math.round(relaxPosedArms(root));

    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      // Everything used to cast, including 400-odd pebbles, gravel decals and
      // grass tufts. At the shadow map's texel size those cover a fraction of a
      // pixel, so they contributed a draw call each to the depth pass and no
      // visible shadow at all. The cutoff is generous — a 40 cm prop still
      // casts — because the point is to drop the scatter, not to thin the props
      // the player actually looks at.
      mesh.castShadow = isShadowCaster(mesh);
    });
  }

  /**
   * Drops the loaded map: geometry, materials, lights, and the collision parts
   * built from it.
   *
   * Switching maps without this leaves the previous world in the scene and its
   * buffers in memory — a few maps in, the tab is holding half a gigabyte of
   * vertex data that nothing draws.
   */
  public unload(): void {
    for (const child of [...this.sceneGroup.children]) {
      this.sceneGroup.remove(child);
      disposeObject(child);
    }
    this.timings = {};
    this.collisionGeometry.clear();
  }

  public getCollisionGeometry(): CollisionGeometry {
    return this.collisionGeometry;
  }
}

/**
 * Detaches authored-defect props from the map.
 *
 * Matching is name plus distance from the mesh's own bounding-box centre. Name
 * alone is not enough — map 1 has ten meshes called `fence` — and position
 * alone would be brittle the day the kit is re-exported, so the pair is
 * required. The box centre comes from the geometry's declared bounds pushed
 * through the world matrix, which is the same number
 * `tools/audit-grounding.mjs` reports, so a removal can be copied straight from
 * the audit.
 *
 * Nothing is disposed here. Geometry and material are shared between the
 * instances a kit copies around, and disposing one would blank its siblings;
 * `unload` frees them all when the map goes.
 */
export function removeProps(root: THREE.Object3D, removals: PropRemoval[]): number {
  const doomed = new Set<THREE.Object3D>();
  const centre = new THREE.Vector3();
  const box = new THREE.Box3();

  for (const removal of removals) {
    const tolerance = removal.radius ?? 0.6;
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || mesh.name !== removal.name) return;
      if (!mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const local = mesh.geometry.boundingBox;
      if (!local) return;
      box.copy(local).applyMatrix4(mesh.matrixWorld);
      box.getCenter(centre);
      const dx = centre.x - removal.at[0];
      const dy = centre.y - removal.at[1];
      const dz = centre.z - removal.at[2];
      if (dx * dx + dy * dy + dz * dz <= tolerance * tolerance) doomed.add(mesh);
    });
  }

  for (const mesh of doomed) mesh.removeFromParent();
  return doomed.size;
}

/**
 * Whether a mesh is worth a draw call in the shadow pass.
 *
 * Measured by world-space bounding radius, not by triangle count: a gravel
 * decal is one quad and a door handle is 200 triangles, but it is the gravel
 * that covers no texel. Anything under `MIN_SHADOW_RADIUS` is scatter.
 */
const MIN_SHADOW_RADIUS = 0.18;
const _worldScale = new THREE.Vector3();

function isShadowCaster(mesh: THREE.Mesh): boolean {
  const geometry = mesh.geometry;
  if (!geometry) return true;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  // No bounds means no way to judge it. Casting is the safe answer: a missing
  // shadow is more obvious than a redundant draw call.
  if (!sphere) return true;

  mesh.getWorldScale(_worldScale);
  const scale = Math.max(Math.abs(_worldScale.x), Math.abs(_worldScale.y), Math.abs(_worldScale.z));
  return sphere.radius * scale >= MIN_SHADOW_RADIUS;
}

/** Frees every geometry and material under `root`. */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();

    // A light owns a shadow map — a 2048² render target per directional light.
    // Removing the light from the scene does not free it, so a map swap would
    // leak 16 MB of GPU memory every time without this.
    const light = node as THREE.Light;
    if (light.isLight) light.dispose();

    // Every kit ships its props as SkinnedMesh (the stadium has 391 of them),
    // and each skeleton owns a bone texture uploaded to the GPU. Dropping the
    // node does not free that texture, so every map swap leaked one small
    // texture per skinned mesh — invisible in the frame time, permanent in
    // VRAM. `Skeleton.dispose` releases it.
    const skinned = node as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) skinned.skeleton.dispose();

    const material = (mesh as THREE.Mesh).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      // Textures are per-material and none of these kits carry any, but a map
      // with a baked texture would leak it without this.
      for (const value of Object.values(m)) {
        if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
      }
      m.dispose();
    }
  });
}

/**
 * The meshes that are the ground, as the kit names them.
 *
 * Name-based detection is the only thing that works across kits, and it has to
 * look at the *node*, not the mesh: every kit calls the wrapper
 * `<map>-terrain` and leaves the mesh inside it unnamed. Testing
 * `mesh.name.includes('terrain')` — the obvious version — matched nothing, so
 * no terrain was ever registered, `getGroundHeight` answered 0 everywhere, and
 * the whole map was walked on a flat plane through hills and into the sea.
 *
 * The construction site adds nine separate `ground` slabs beside its terrain
 * sheet (a concrete apron); the heightfield rasterises all of them and keeps
 * the highest surface per cell. Water is deliberately not ground.
 */
/**
 * Nodes that are a *thin scatter of small things lying on the ground*, rather
 * than an object standing on it.
 *
 * These are the ones that break when the terrain is not the flat plane the kit
 * was authored against. They are also exactly the ones where bending the mesh
 * onto the ground is invisible as a technique: nobody can tell that a pebble
 * moved four centimetres, and everybody can tell that it is floating.
 */
const GROUND_SCATTER = /pebble|gravel|shingle|cobble|litter|debris|rubble/i;

/** Below this the scatter is already on the ground and not worth touching. */
const SCATTER_TOLERANCE = 0.02;

/**
 * Bends flat ground scatter onto the terrain and returns the milliseconds it
 * took.
 *
 * Each vertex keeps its height *above the scatter's own base plane* — that is
 * what preserves the thickness of every individual stone — while the base plane
 * itself is replaced by the ground underneath. A stone therefore moves as a
 * stone; only the field it sits in follows the sand.
 *
 * Vertices over water, or past the edge of the heightfield, are left exactly
 * where they were: there is no ground there to sit on, and lowering a pebble to
 * the sea floor would put it out of sight for no reason.
 */
function conformGroundScatter(root: THREE.Object3D, collision: WorldCollision): number {
  const started = performance.now();
  const meshes: THREE.Mesh[] = [];

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!GROUND_SCATTER.test(node.name) && !GROUND_SCATTER.test(mesh.name)) return;
    meshes.push(mesh);
  });
  if (meshes.length === 0) return 0;

  const world = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  // A geometry shared by two scatters would be bent twice, and the second bend
  // would be applied to already-bent vertices. Copy on first use.
  const detached = new Set<THREE.BufferGeometry>();

  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position || position.count === 0) continue;

    if (!detached.has(geometry)) {
      detached.add(geometry);
      // Only copy when something else still points at the original.
      let users = 0;
      root.traverse((n) => {
        if ((n as THREE.Mesh).geometry === geometry) users++;
      });
      if (users > 1) mesh.geometry = geometry.clone();
    }
    const target = mesh.geometry;
    const attr = target.getAttribute('position') as THREE.BufferAttribute;
    const count = attr.count;

    inverse.copy(mesh.matrixWorld).invert();

    // The scatter's own base: the lowest point of the decal in world space.
    // The same pass measures how flat the thing is, which is the guard that
    // keeps this away from a 2 m gravel *pile*: only a sheet is bent.
    let baseY = Infinity;
    let topY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      world.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      if (world.y < baseY) baseY = world.y;
      if (world.y > topY) topY = world.y;
      if (world.x < minX) minX = world.x;
      if (world.x > maxX) maxX = world.x;
      if (world.z < minZ) minZ = world.z;
      if (world.z > maxZ) maxZ = world.z;
    }
    if (!Number.isFinite(baseY)) continue;

    // Not a sheet: a pile, a boulder, a stack of logs. Leave it alone — bending
    // its vertices would smear it across the ground instead of sitting it on it.
    const thickness = topY - baseY;
    const footprint = Math.max(maxX - minX, maxZ - minZ);
    if (thickness > 0.5 || footprint < 0.6) continue;

    let moved = 0;
    for (let i = 0; i < count; i++) {
      world.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      const ground = collision.terrainHeight(world.x, world.z);
      if (ground === null) continue;

      const lifted = ground + (world.y - baseY);
      if (Math.abs(lifted - world.y) < SCATTER_TOLERANCE) continue;

      world.y = lifted;
      world.applyMatrix4(inverse);
      attr.setXYZ(i, world.x, world.y, world.z);
      moved++;
    }

    if (moved > 0) {
      attr.needsUpdate = true;
      target.computeBoundingBox();
      target.computeBoundingSphere();
    }
  }

  return performance.now() - started;
}

function findTerrainMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const seen = new Set<THREE.Mesh>();

  const collect = (node: THREE.Object3D): void => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && !seen.has(mesh)) {
      seen.add(mesh);
      meshes.push(mesh);
    }
    for (const child of node.children) collect(child);
  };

  root.traverse((node) => {
    // Both conventions exist: the kits name the *node* and leave the mesh
    // unnamed, the built-in campground does the opposite. Match either.
    const mesh = node as THREE.Mesh;
    const names = [node.name || '', mesh.isMesh ? mesh.name || '' : ''];
    if (names.some((n) => /water/i.test(n))) return;
    const isGround = names.some(
      (n) => /-terrain$/i.test(n) || /^terrain$/i.test(n) || n === 'ground'
    );
    if (!isGround) return;
    collect(node);
  });

  return meshes;
}

/**
 * Ladders, as boxes the body can climb inside.
 *
 * A ladder prop is a tall, narrow thing: the kits call it `<map>-ladder` and
 * its box is under a metre across and over two metres high. Both tests are
 * applied — the name alone would catch a ladder lying flat on the ground as a
 * prop, and the shape alone would catch a crate stack or a fence post.
 *
 * The volume is widened by the body's radius so that standing at the foot of
 * the ladder, not inside it, counts as being on it.
 *
 * The campground's watchtower is deliberately *not* climbable. Its bracing was
 * briefly read as rungs — a column of small horizontal faces a third of a metre
 * apart — and it produced thirteen "ladders" out of one tower, none of them a
 * ladder: the braces are what a splayed-leg lookout is made of, and the only
 * real one is a red-and-white ladder between two platforms that cannot be
 * reached from the ground anyway. The body can now crawl in under the bracing,
 * which is what the tower is actually good for.
 */
function findClimbVolumes(root: THREE.Object3D): ClimbVolume[] {
  const volumes: ClimbVolume[] = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  // Wide enough that a body stopped by the rungs is still "at the foot of it":
  // the capsule is 0.3 across, so its centre comes to rest one radius clear of
  // the surface it is pressed against.
  const pad = GAME_CONFIG.player.capsuleRadius + GAME_CONFIG.player.skinWidth + 0.05;

  root.traverse((node) => {
    if (!/ladder/i.test(node.name || '')) return;
    if (node.children.length === 0 && !(node as THREE.Mesh).isMesh) return;

    box.setFromObject(node);
    if (box.isEmpty()) return;
    box.getSize(size);
    if (size.y < 1.6 || Math.max(size.x, size.z) > 1.4) return;

    // The rung column, not the node's box. A kit's ladder node is the ladder
    // *plus its mounting brackets and handrail*: on the farm the node measures
    // 1.32 x 1.38 m while the rungs themselves are 0.17 x 0.50 m. A footprint
    // built from the box therefore reaches most of a metre past the rungs, and
    // a body that grabbed it from there climbed straight up beside the silo,
    // hanging in mid-air with nothing under it.
    const rungs = rungColumn(node);
    const minX = (rungs ? rungs.minX : box.min.x) - pad;
    const maxX = (rungs ? rungs.maxX : box.max.x) + pad;
    const minZ = (rungs ? rungs.minZ : box.min.z) - pad;
    const maxZ = (rungs ? rungs.maxZ : box.max.z) + pad;
    // Height still comes from the node: the climb has to start at the ladder's
    // own foot and stop at its top handrail, which the rungs alone do not
    // describe (the top one sits below the rail).
    const bottom = box.min.y;
    const top = box.max.y;

    // A kit names both the group and its mesh `ladder`, so the same box arrives
    // twice. Two identical volumes are harmless to the query but make the
    // debug view double-draw and every future count wrong.
    const duplicate = volumes.some(
      (v) =>
        Math.abs(v.minX - minX) < 1e-3 &&
        Math.abs(v.maxX - maxX) < 1e-3 &&
        Math.abs(v.minZ - minZ) < 1e-3 &&
        Math.abs(v.maxZ - maxZ) < 1e-3 &&
        Math.abs(v.bottom - bottom) < 1e-3 &&
        Math.abs(v.top - top) < 1e-3
    );
    if (duplicate) return;

    volumes.push({ minX, maxX, minZ, maxZ, bottom, top });
  });

  return volumes;
}

/**
 * The horizontal rungs of a ladder, as an XZ extent.
 *
 * Rungs are small, level faces stacked up a narrow column, so a face that is
 * near-horizontal and smaller than half a square metre is a rung. Returns null
 * when there are too few of them to be sure — a ladder-shaped crate stack, a
 * railing, a prop whose "ladder" is a single slab — and the caller falls back
 * to the node's own box.
 *
 * Deliberately *not* used to find ladders, only to narrow ones already found by
 * name: the campground's watchtower bracing is a column of small horizontal
 * faces a third of a metre apart, and rung-detection alone turned that one
 * tower into thirteen ladders.
 */
function rungColumn(
  node: THREE.Object3D
): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let faces = 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();

  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    const index = mesh.geometry.index;
    const count = index ? index.count : position.count;
    mesh.updateWorldMatrix(true, false);

    for (let i = 0; i + 2 < count; i += 3) {
      const ka = index ? index.getX(i) : i;
      const kb = index ? index.getX(i + 1) : i + 1;
      const kc = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(position, ka).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, kb).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, kc).applyMatrix4(mesh.matrixWorld);

      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.crossVectors(ab, ac);
      const twiceArea = normal.length();
      if (twiceArea < 1e-6) continue;
      // Level, and small: a rung, not a deck, a platform or a roof.
      if (Math.abs(normal.y) / twiceArea < 0.8) continue;
      if (twiceArea / 2 > 0.4) continue;

      faces++;
      minX = Math.min(minX, a.x, b.x, c.x);
      maxX = Math.max(maxX, a.x, b.x, c.x);
      minZ = Math.min(minZ, a.z, b.z, c.z);
      maxZ = Math.max(maxZ, a.z, b.z, c.z);
    }
  });

  // Three rungs is the least that describes a climb rather than a single step.
  if (faces < 3) return null;
  return { minX, maxX, minZ, maxZ };
}


/**
 * Digs the bed out from under a draped water sheet.
 *
 * The campground's water is not a plane at a fixed level — every one of its
 * vertices sits a centimetre above the terrain it covers. There is therefore no
 * depth anywhere: the character stands on the ground with the waterline at
 * their ankles, which reads as walking on top of the lake.
 *
 * Lowering the terrain under the sheet by `BED_DEPTH` gives the water somewhere
 * to be. The cut is tapered over the first metre and a half inside the
 * shoreline, because a vertical step at the water's edge would show as a trench
 * with a sheet of water floating over it.
 *
 * Only terrain that the water actually covers *and* that is within `BED_SNAP`
 * of it is touched: a pond on a cliff does not drag the cliff down with it.
 */
const BED_DEPTH = 0.5;
const BED_TAPER = 1.5;
const BED_SNAP = 0.7;
/**
 * Depth kept even at the water's edge, in metres.
 *
 * The taper exists so the shoreline does not become a trench, but a taper that
 * reaches zero leaves the shallows exactly as they were — and on this map the
 * shallows are most of the lake. 18 cm is ankle-deep, still under the 35 cm
 * step limit, so the player can always wade back out.
 */
const BED_MIN_DEPTH = 0.18;

function dredgeWaterBeds(root: THREE.Object3D, terrainMeshes: THREE.Mesh[]): number {
  const started = performance.now();

  const waterNodes: THREE.Object3D[] = [];
  root.traverse((node) => {
    if (!/water/i.test(node.name || '')) return;
    // The kits wrap water in a group; the built-in campground names the mesh
    // itself. Both are water; only a leaf with no geometry is not.
    if (node.children.length === 0 && !(node as THREE.Mesh).isMesh) return;
    waterNodes.push(node);
  });
  if (waterNodes.length === 0 || terrainMeshes.length === 0) return 0;

  // A 1 m grid of "there is water over this cell", holding the surface height.
  // Rasterised from the sheet's own triangles rather than sampled from its
  // vertices: the sheet is coarse — a vertex every 80 cm — so a vertex lookup
  // leaves holes, and filling them by widening the search would dig the bank
  // outside the shoreline as well as the bed inside it.
  const mask = new Map<string, number>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (const water of waterNodes) {
    water.updateMatrixWorld(true);
    water.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;

      // Water that is drawn opaque hides whatever is under it, so a body
      // standing in ankle-deep water looks like a body standing *on* water —
      // the legs simply stop at the surface. Blending the sheet lets the
      // submerged half of the character show through, tinted, which is what
      // makes wading read as wading.
      const material = mesh.material as THREE.Material | THREE.Material[];
      const first = Array.isArray(material) ? material[0] : material;
      if (first && !first.transparent) {
        const clone = first.clone();
        clone.transparent = true;
        clone.opacity = 0.72;
        clone.depthWrite = false;
        mesh.material = Array.isArray(material)
          ? material.map((m, i) => (i === 0 ? clone : m))
          : clone;
      }
      const geometry = mesh.geometry;
      const position = geometry.getAttribute('position');
      if (!position) return;
      const index = geometry.getIndex();
      const count = index ? index.count : position.count;

      for (let i = 0; i + 2 < count; i += 3) {
        a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);

        const y = (a.y + b.y + c.y) / 3;
        const minX = Math.floor(Math.min(a.x, b.x, c.x));
        const maxX = Math.floor(Math.max(a.x, b.x, c.x));
        const minZ = Math.floor(Math.min(a.z, b.z, c.z));
        const maxZ = Math.floor(Math.max(a.z, b.z, c.z));
        if (maxX - minX > 40 || maxZ - minZ > 40) continue; // a degenerate sheet

        // Every cell the triangle's footprint touches. Testing cell centres
        // instead misses any triangle that straddles a cell boundary without
        // covering its centre, and those holes are exactly the cells the bed
        // would then be left at water level in.
        for (let cx = minX; cx <= maxX; cx++) {
          for (let cz = minZ; cz <= maxZ; cz++) {
            const key = `${cx}:${cz}`;
            const known = mask.get(key);
            if (known === undefined || y > known) mask.set(key, y);
          }
        }
      }
    });
  }
  if (mask.size === 0) return 0;

  const waterAt = (x: number, z: number): number | null => {
    const hit = mask.get(`${Math.floor(x)}:${Math.floor(z)}`);
    return hit === undefined ? null : hit;
  };

  const ring: [number, number][] = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  /** Chebyshev distance to the shoreline, capped at the taper length. */
  const shoreDistance = (x: number, z: number): number => {
    for (let r = 1; r <= Math.ceil(BED_TAPER); r++) {
      for (const [dx, dz] of ring) {
        if (waterAt(x + dx * r, z + dz * r) === null) return r - 1;
      }
    }
    return BED_TAPER;
  };

  let moved = 0;
  const p = new THREE.Vector3();
  for (const mesh of terrainMeshes) {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position) continue;
    mesh.updateMatrixWorld(true);

    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const surface = waterAt(p.x, p.z);
      if (surface === null || Math.abs(surface - p.y) > BED_SNAP) continue;

      const depth = Math.max(
        BED_MIN_DEPTH,
        BED_DEPTH * Math.min(1, shoreDistance(p.x, p.z) / BED_TAPER)
      );
      if (depth < 0.02) continue;

      p.y -= depth;
      p.applyMatrix4(_toLocal.copy(mesh.matrixWorld).invert());
      position.setXYZ(i, p.x, p.y, p.z);
      moved++;
    }

    if (moved > 0) {
      position.needsUpdate = true;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
  }

  return performance.now() - started;
}

const _toLocal = new THREE.Matrix4();

/** 2D point-in-triangle, used to rasterise the water sheet into a grid. */
function insideTriangle(
  x: number,
  z: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3
): boolean {
  const d1 = (x - b.x) * (a.z - b.z) - (a.x - b.x) * (z - b.z);
  const d2 = (x - c.x) * (b.z - c.z) - (b.x - c.x) * (z - c.z);
  const d3 = (x - a.x) * (c.z - a.z) - (c.x - a.x) * (z - a.z);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/**
 * Drops the arms of any prop authored in a T-pose.
 *
 * The kits ship every rigged character with its upper-arm bones at identity:
 * both arms straight out to the sides. They have no clips and never will, so the
 * pose is fixed once at load by rotating each upper arm from its current
 * direction onto "down and slightly out" — expressed as a world-space rotation,
 * so it does not matter which way the prop itself was turned when it was placed.
 *
 * This used to be driven by a list of prop names, which meant it fixed the four
 * `city-commuter` props it was written for and left the pirate captain, the
 * astronaut, the pilot, the commander, the police officer and the construction
 * workers standing like scarecrows on fourteen other maps. It is a rig question,
 * not a naming one, so it is answered from the rig.
 *
 * Two things make that safe:
 *
 * - **Both** arms have to be horizontal. A rig with one arm out is posed on
 *   purpose — a goalkeeper, a caller with a hand up — and dropping that arm
 *   would be a worse bug than the one being fixed. A rest pose is symmetric.
 * - Props whose arms are *meant* to be out are excluded by name. A scarecrow is
 *   a hidden object in this game, and a scarecrow with its arms down is a bin
 *   bag.
 */
const POSED_ARM_EXCLUDE = /scarecrow|effigy|crucifix/i;
/**
 * An upper-arm bone, with the per-instance suffix the kit exporter adds.
 *
 * The four commuters are copies of one rig, so their bones are named
 * `LeftArm`, `LeftArm_3`, `LeftArm_4`, `LeftArm_6` — an exact-name test fixed
 * exactly one of them and left the other three standing with their arms out.
 */
const ARM_BONE = /^(Left|Right)(Upper)?Arm(_\d+)?$/;

function relaxPosedArms(root: THREE.Object3D): number {
  const started = performance.now();
  const target = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const bonePos = new THREE.Vector3();
  const childPos = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion();
  let changed = 0;

  // One pass to collect the rigs, because the attachments (a hat, a belt, a
  // tablet) are separate skinned meshes sharing the same skeleton: rotating the
  // arms once per attachment would rotate them four times over.
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((node) => {
    const skin = node as THREE.SkinnedMesh;
    if (skin.isSkinnedMesh && skin.skeleton) skeletons.add(skin.skeleton);
  });

  for (const skeleton of skeletons) {
    // The prop this rig belongs to: every name from the bone up to the scene
    // root, joined. A kit places its props under one map root, so climbing to a
    // single "owner" would report the map's name for all of them and the
    // exclusion below would never match anything.
    let node: THREE.Object3D | null = skeleton.bones[0] ?? null;
    let ancestry = '';
    while (node) {
      ancestry += ' ' + (node.name || '');
      node = node.parent;
    }
    if (POSED_ARM_EXCLUDE.test(ancestry)) continue;

    const arms: { bone: THREE.Bone; next: THREE.Bone; droop: number }[] = [];
    for (const bone of skeleton.bones) {
      if (!ARM_BONE.test(bone.name)) continue;
      const next = bone.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
      if (!next || !bone.parent) continue;

      bone.updateWorldMatrix(true, false);
      next.updateWorldMatrix(true, false);
      bone.getWorldPosition(bonePos);
      next.getWorldPosition(childPos);
      direction.subVectors(childPos, bonePos);
      if (direction.lengthSq() < 1e-8) continue;
      direction.normalize();
      arms.push({ bone, next, droop: direction.y });
    }

    // A rest pose is symmetric. One arm out is somebody doing something.
    const horizontal = arms.filter((a) => a.droop > -0.55);
    if (horizontal.length < 2) continue;

    for (const { bone } of horizontal) {
      const next = bone.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone;
      if (!next || !bone.parent) continue;
      bone.updateWorldMatrix(true, false);
      next.updateWorldMatrix(true, false);
      bone.getWorldPosition(bonePos);
      next.getWorldPosition(childPos);
      direction.subVectors(childPos, bonePos);
      if (direction.lengthSq() < 1e-8) continue;
      direction.normalize();

      target.set(direction.x * 0.28, -1, direction.z * 0.28).normalize();
      rotation.setFromUnitVectors(direction, target);

      bone.parent.getWorldQuaternion(parentRotation);
      // newLocal = parentWorld⁻¹ · q · parentWorld · oldLocal
      bone.quaternion
        .premultiply(parentRotation)
        .premultiply(rotation)
        .premultiply(parentRotation.invert());
      bone.updateMatrixWorld(true);
      changed++;
    }

    skeleton.update();
  }

  return performance.now() - started;
}