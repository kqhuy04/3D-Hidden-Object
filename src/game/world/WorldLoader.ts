import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { CollisionGeometry } from './CollisionGeometry';
import { WorldCollision, ClimbVolume } from './WorldCollision';
import { PROP_REMOVALS, PROP_SHIFTS, PropRemoval, PropShift } from '../../data/mapFixes';
import { GAME_CONFIG } from '../../data/gameConfig';

export class WorldLoader {
  private loader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private sceneGroup: THREE.Group = new THREE.Group();
  private collisionGeometry = new CollisionGeometry();
  /** Where the load time went, in milliseconds. Logged once per map. */
  public timings: Record<string, number> = {};
  /** The map's water, if it has any. Kept after the load for the fishing rod. */
  private water: WaterSurface | null = null;

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
    const water = buildWaterSurface(root, terrainMeshes);
    this.water = water;
    this.timings.dredge = water ? Math.round(dredgeWaterBeds(terrainMeshes, water)) : 0;
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

    // Props that float or stand are placed at the author's eye height, not on
    // the surface they belong to: boats hang over the lake, lily pads hover, a
    // camper's boots sink into the sand. Settled here, after the bed has been
    // dug and the ground can be asked for a height, and before the collider is
    // built from them.
    root.updateMatrixWorld(true);
    this.timings.settle = Math.round(settleProps(root, collision, water));
    const shifts = mapId ? PROP_SHIFTS[mapId] : undefined;
    if (shifts?.length) {
      applyPropShifts(root, shifts);
      root.updateMatrixWorld(true);
    }

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
    this.water = null;
    this.collisionGeometry.clear();
  }

  public getCollisionGeometry(): CollisionGeometry {
    return this.collisionGeometry;
  }

  /**
   * The water sheet the map was built with, or null on a map with none.
   *
   * Read by the fishing system, which needs three answers the collider cannot
   * give: where the surface is, how deep the water is under a point, and
   * whether a point is open water at all. The sheet wanders 30 cm across the
   * lake, so every one of those has to come from the sheet and never from a
   * constant.
   */
  public getWater(): WaterSurface | null {
    return this.water;
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
    // The campground puts the water sheet *inside* the terrain group, so
    // sweeping the group's meshes drags the lake in with the land. It has to be
    // filtered out here and not one level up: the group is named
    // `campground-lake-terrain`, which is exactly what makes it ground.
    //
    // Left in, the sheet became part of the heightfield, the player stood on the
    // water surface instead of in it, and the bed dredge below moved the lake
    // down with the bed so the depth never changed.
    if (mesh.isMesh && !seen.has(mesh) && !/water/i.test(mesh.name || '')) {
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
 * The map's water, read off the water mesh itself.
 *
 * The kits ship water as a *surface*, not as a level. The campground's lake is
 * a sheet whose height wanders 30 cm across the map, so a single `waterLevel`
 * constant is wrong at one end of the shore or the other — the old one was 30 cm
 * above the sheet everywhere. Anything that needs to know where the water is
 * asks this instead of a constant.
 *
 * The sheet is rasterised into 1 m cells and sampled bilinearly: a vertex
 * lookup leaves holes wherever the sheet is coarser than the grid, and a hole is
 * a cell that keeps its authored height and reads as ground under the water.
 */
export interface WaterSurface {
  /** Height of the sheet at (x, z), or null where the sheet does not reach. */
  heightAt(x: number, z: number): number | null;
  /** Metres from the nearest shoreline. 0 at the waterline itself. */
  shoreDistance(x: number, z: number): number;
  /** True when the sheet is above the ground here, i.e. there is open water. */
  isOpen(x: number, z: number): boolean;
  /**
   * Metres of water between the sheet and the bed, or 0 on land.
   *
   * `isOpen` answers "is there water", which is a cell test; this answers "how
   * much", which is what a float needs. A bobber dropped in five centimetres of
   * puddle at the waterline sits on the sand; the cast has to reach the shelf.
   */
  depthAt(x: number, z: number): number;
  /**
   * The nearest patch of water at least `minDepth` deep, searched outwards from
   * (x, z) in rings up to `maxRadius` metres.
   *
   * The lake is not where the map spawns — the campground's spawn is a clearing
   * 25 m from the shore — so "put the fish in the water" needs a search rather
   * than a position. Null when the map has no water within reach.
   */
  nearestOpenWater(
    x: number,
    z: number,
    maxRadius: number,
    minDepth?: number
  ): { x: number; z: number; y: number } | null;
}

/** Marker for "the sheet is not here", so the grid can be one Float32Array. */
const NO_WATER = -1e9;
const SQRT2 = Math.SQRT2;

/**
 * Rasterises every water mesh into a height grid, works out the shoreline, and
 * makes the sheet see-through so a wading body shows below the waterline.
 *
 * The transparency is done here rather than in the material data because the
 * kits ship the sheet opaque, and an opaque sheet hides the half of the player
 * that is under it — which is the difference between wading and standing on the
 * lake. Materials already blended by the kit are left at their own opacity.
 */
function buildWaterSurface(root: THREE.Object3D, terrainMeshes: THREE.Mesh[]): WaterSurface | null {
  const waterMeshes = new Set<THREE.Mesh>();
  root.traverse((node) => {
    if (!/water/i.test(node.name || '')) return;
    // The kits wrap water in a group; the built-in campground names the mesh
    // itself. Both are water; only a leaf with no geometry is not.
    if (node.children.length === 0 && !(node as THREE.Mesh).isMesh) return;
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) waterMeshes.add(mesh);
    });
  });
  if (waterMeshes.size === 0) return null;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  // --- bounds ------------------------------------------------------------
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const mesh of waterMeshes) {
    mesh.updateMatrixWorld(true);
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    for (let i = 0; i < position.count; i++) {
      a.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (a.z < minZ) minZ = a.z;
      if (a.z > maxZ) maxZ = a.z;
    }
  }
  if (!Number.isFinite(minX)) return null;

  const cols = Math.ceil(maxX - minX) + 2;
  const rows = Math.ceil(maxZ - minZ) + 2;
  const cellOf = (x: number, z: number): number =>
    Math.floor(z - minZ) * cols + Math.floor(x - minX);

  // --- the sheet, one height per cell ------------------------------------
  // Every cell a triangle's footprint touches, not just the ones whose centre
  // it covers: a triangle that straddles a cell boundary without covering its
  // centre would otherwise leave a hole, and a hole is ground at water level.
  const sheet = new Float32Array(cols * rows).fill(NO_WATER);
  for (const mesh of waterMeshes) {
    const material = mesh.material as THREE.Material | THREE.Material[];
    const first = Array.isArray(material) ? material[0] : material;
    if (first) {
      // The sheet is a single-sided plane, which is invisible from underneath:
      // wade out and look up and the lake simply stops existing above your
      // head. Double-sided is the whole fix — a sheet has no "inside".
      const clone = first.clone();
      clone.side = THREE.DoubleSide;
      if (!clone.transparent || clone.opacity > 0.75) {
        clone.transparent = true;
        clone.opacity = 0.6;
        clone.depthWrite = false;
      }
      mesh.material = Array.isArray(material) ? material.map((m, i) => (i === 0 ? clone : m)) : clone;
    }

    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);

      const y = (a.y + b.y + c.y) / 3;
      const x0 = Math.floor(Math.min(a.x, b.x, c.x) - minX);
      const x1 = Math.floor(Math.max(a.x, b.x, c.x) - minX);
      const z0 = Math.floor(Math.min(a.z, b.z, c.z) - minZ);
      const z1 = Math.floor(Math.max(a.z, b.z, c.z) - minZ);
      if (x1 - x0 > 40 || z1 - z0 > 40) continue; // a degenerate sheet

      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const k = cz * cols + cx;
          if (k < 0 || k >= sheet.length) continue;
          if (sheet[k] === NO_WATER || y > sheet[k]) sheet[k] = y;
        }
      }
    }
  }

  // --- the ground, one height per cell -----------------------------------
  // The lowest terrain vertex in the cell: a cell holding both bank and bed
  // counts as water, which pushes the computed shoreline half a cell onto the
  // bank. Harmless, because the dredge gives the waterline itself zero depth.
  const ground = new Float32Array(cols * rows).fill(Infinity);
  const p = new THREE.Vector3();
  for (const mesh of terrainMeshes) {
    const position = mesh.geometry.getAttribute('position');
    if (!position) continue;
    mesh.updateMatrixWorld(true);
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const k = cellOf(p.x, p.z);
      if (k < 0 || k >= ground.length) continue;
      if (p.y < ground[k]) ground[k] = p.y;
    }
  }

  // --- open water, and the distance to its edge --------------------------
  const BIG = 1e6;
  const shore = new Float32Array(cols * rows);
  for (let k = 0; k < sheet.length; k++) {
    const open = sheet[k] !== NO_WATER && sheet[k] > (ground[k] === Infinity ? -Infinity : ground[k]) + 0.02;
    shore[k] = open ? BIG : 0;
  }

  // Chamfer distance transform, two passes: exact along the axes, within 2 %
  // diagonally. This is what turns "there is water here" into a beach profile —
  // without it every cell is either shore (depth 0) or lake (full depth), and
  // the character steps off a 1 m ledge instead of walking into the water.
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      const k = r * cols + cc;
      let d = shore[k];
      if (d === 0) continue;
      if (r > 0) d = Math.min(d, shore[k - cols] + 1);
      if (cc > 0) d = Math.min(d, shore[k - 1] + 1);
      if (r > 0 && cc > 0) d = Math.min(d, shore[k - cols - 1] + SQRT2);
      if (r > 0 && cc < cols - 1) d = Math.min(d, shore[k - cols + 1] + SQRT2);
      shore[k] = d;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let cc = cols - 1; cc >= 0; cc--) {
      const k = r * cols + cc;
      let d = shore[k];
      if (d === 0) continue;
      if (r < rows - 1) d = Math.min(d, shore[k + cols] + 1);
      if (cc < cols - 1) d = Math.min(d, shore[k + 1] + 1);
      if (r < rows - 1 && cc < cols - 1) d = Math.min(d, shore[k + cols + 1] + SQRT2);
      if (r < rows - 1 && cc > 0) d = Math.min(d, shore[k + cols - 1] + SQRT2);
      shore[k] = d;
    }
  }

  /** Bilinear read of one grid, or NaN if any corner of the cell is missing. */
  const read = (grid: Float32Array, missing: number, x: number, z: number): number => {
    const fx = x - minX - 0.5;
    const fz = z - minZ - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    if (x0 < 0 || z0 < 0 || x0 + 1 >= cols || z0 + 1 >= rows) return NaN;
    const tx = fx - x0;
    const tz = fz - z0;
    const k = z0 * cols + x0;
    const v00 = grid[k];
    const v10 = grid[k + 1];
    const v01 = grid[k + cols];
    const v11 = grid[k + cols + 1];
    if (v00 === missing || v10 === missing || v01 === missing || v11 === missing) return NaN;
    return (
      v00 * (1 - tx) * (1 - tz) + v10 * tx * (1 - tz) + v01 * (1 - tx) * tz + v11 * tx * tz
    );
  };

  return {
    heightAt(x, z) {
      const y = read(sheet, NO_WATER, x, z);
      return Number.isFinite(y) ? y : null;
    },
    shoreDistance(x, z) {
      const d = read(shore, -1, x, z);
      // The first water cell is one cell from land, so subtract it: distance 0
      // is the waterline, which is where the depth has to be zero.
      return Number.isFinite(d) ? Math.max(0, d - 1) : 0;
    },
    isOpen(x, z) {
      const k = cellOf(x, z);
      if (k < 0 || k >= sheet.length) return false;
      return sheet[k] !== NO_WATER && sheet[k] > (ground[k] === Infinity ? -Infinity : ground[k]) + 0.02;
    },
    depthAt(x, z) {
      const surface = read(sheet, NO_WATER, x, z);
      const bed = read(ground, Infinity, x, z);
      if (!Number.isFinite(surface) || !Number.isFinite(bed)) return 0;
      return Math.max(0, surface - bed);
    },
    nearestOpenWater(x, z, maxRadius, minDepth = 0.5) {
      // Rings of one grid cell, so the answer is the closest water by Manhattan
      // distance and the search is bounded by the lake rather than by the map.
      const cx = Math.floor(x - minX);
      const cz = Math.floor(z - minZ);
      const limit = Math.ceil(maxRadius);
      for (let r = 0; r <= limit; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            // Only the ring, not the disc: the inside was searched already.
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const col = cx + dx;
            const row = cz + dz;
            if (col < 1 || row < 1 || col >= cols - 1 || row >= rows - 1) continue;
            const wx = minX + col + 0.5;
            const wz = minZ + row + 0.5;
            const surface = read(sheet, NO_WATER, wx, wz);
            const bed = read(ground, Infinity, wx, wz);
            if (!Number.isFinite(surface) || !Number.isFinite(bed)) continue;
            if (surface - bed < minDepth) continue;
            return { x: wx, z: wz, y: surface };
          }
        }
      }
      return null;
    },
  };
}

/**
 * Digs the bed out from under the water sheet.
 *
 * The campground's water is a sheet *draped on the ground*: over most of the
 * lake its vertices sit a centimetre or two above the terrain they cover. There
 * is therefore no depth to it at all, and the character stands on the ground
 * with the waterline at their ankles — which reads as walking on top of the
 * lake. The old fix lowered the bed by a flat 18-50 cm, which is ankle-deep at
 * the shore and knee-deep in the middle: still walking on water.
 *
 * This one gives the lake a *beach profile*: the depth is zero at the waterline
 * and grows by `BED_SLOPE` per metre out, up to `BED_SHELF`. Wading therefore
 * reads as wading from the first step, the way out is a continuous ramp rather
 * than a ledge, and the profile stops at the shelf so the authored basin beyond
 * it is left exactly as the kit made it.
 */
const BED_SLOPE = 0.5;
const BED_SHELF = 1.25;

function dredgeWaterBeds(terrainMeshes: THREE.Mesh[], water: WaterSurface): number {
  const started = performance.now();
  let moved = 0;
  const p = new THREE.Vector3();

  for (const mesh of terrainMeshes) {
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!position) continue;
    mesh.updateMatrixWorld(true);

    let touched = 0;
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const surface = water.heightAt(p.x, p.z);
      if (surface === null) continue;
      // Above the sheet is the bank the water runs under, not the bed.
      if (p.y > surface + 0.02) continue;

      const depth = Math.min(BED_SHELF, water.shoreDistance(p.x, p.z) * BED_SLOPE);
      if (depth < 0.02) continue;

      const target = surface - depth;
      // Already deeper than the profile asks: this is the authored basin, and
      // the fix is not allowed to flatten it into a bathtub.
      if (p.y <= target) continue;

      p.y = target;
      p.applyMatrix4(_toLocal.copy(mesh.matrixWorld).invert());
      position.setXYZ(i, p.x, p.y, p.z);
      touched++;
    }

    if (touched > 0) {
      position.needsUpdate = true;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
      moved += touched;
    }
  }

  return moved === 0 ? 0 : performance.now() - started;
}


const _toLocal = new THREE.Matrix4();

/**
 * What a prop is supposed to rest on.
 *
 * - `water` — a hull, sunk to its draft below the sheet.
 * - `surface` — a floating mat: lily pads lie *on* the water, not in it.
 * - `bed` — a plant, rooted in whatever is underneath, water or sand.
 * - `feet` — a person. Raised onto the ground if they are sunk; never lowered,
 *   because a person standing on a rock or a deck is standing on something this
 *   pass cannot see.
 */
type RestOn = 'water' | 'surface' | 'bed' | 'feet';

interface SettleRule {
  test: RegExp;
  rest: RestOn;
  /** How far a hull sits below the surface, metres. */
  draft?: number;
}

/**
 * The families that are placed by hand at one Y and end up wrong when the
 * ground under them is not flat.
 *
 * These are *rules*, not a list of offenders: a canoe floats wherever it is put
 * down, and the reason it was hanging in the air on map 1 is that the kit drops
 * every prop at the author's eye height rather than on the surface it belongs
 * to. Naming the family means the same correction holds on the other maps,
 * without a hundred coordinates to maintain.
 */
const SETTLE_RULES: SettleRule[] = [
  { test: /canoe|kayak|raft|skiff|boat|dinghy|paddleboard|punt/i, rest: 'water' },
  { test: /lily|lotus|duckweed/i, rest: 'surface' },
  { test: /reed|rush|sedge|cattail/i, rest: 'bed' },
  {
    // Anchored, and never a *building*: `hip-roof-ranger-station` is a station,
    // and a rule that reads "ranger" as "a person called Ranger" would try to
    // stand a building on the ground it is already standing on.
    test: /^(backpacker|angler|hiker|camper|ranger|visitor|keeper|tourist|swimmer|fisher|walker|jogger)(?![a-z-])/i,
    rest: 'feet',
  },
];

/**
 * Things that are fixed or stored rather than afloat, so nothing about them
 * should be "corrected" toward the water. A canoe on a rack is stored; a launch
 * ramp is poured concrete that happens to have `boat` in its name.
 */
const NOT_A_CRAFT = /rack|trailer|shelf|stand|hook|roof|ceiling|awning|table|board|ramp|slipway|dock|pier|jetty|mooring|cradle|winch/i;

/** Hull draft by kind, in metres. A board barely draws a finger. */
const DRAFT: [RegExp, number][] = [
  [/paddleboard/i, 0.05],
  [/raft/i, 0.08],
  [/kayak/i, 0.1],
  [/canoe/i, 0.12],
  [/skiff|boat/i, 0.14],
];
const draftFor = (name: string): number => DRAFT.find(([re]) => re.test(name))?.[1] ?? 0.12;

/**
 * The lowest vertex under a node, in world space.
 *
 * This is the point that has to meet the ground: a boot, a keel, the underside
 * of a lily pad. The bounding box cannot answer it — a box is as wide as the
 * hat and the backpack, so its base is a corner of empty air beside the person.
 */
const _lowest = new THREE.Vector3();
function lowestPoint(node: THREE.Object3D): { x: number; y: number; z: number } | null {
  let best: { x: number; y: number; z: number } | null = null;
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    mesh.updateMatrixWorld(true);
    for (let i = 0; i < position.count; i++) {
      _lowest.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (!best || _lowest.y < best.y) best = { x: _lowest.x, y: _lowest.y, z: _lowest.z };
    }
  });
  return best;
}

/**
 * Sits floating props on the water and people on the ground.
 *
 * Each match is moved as one placement node, so a boat keeps its oars and a
 * person keeps their backpack. Moving the node rather than the geometry matters:
 * the collision build runs after this, so what the player walks into is the
 * thing they can see.
 *
 * The thresholds are deliberately dull. A prop is only touched when it is off
 * its surface by more than 3 cm, because a pass that nudges everything to
 * "perfect" flattens the small deliberate differences — a canoe pulled half up
 * a slipway, a pad drifting against a reed bed — that make a place look lived
 * in rather than laid out.
 */
function settleProps(
  root: THREE.Object3D,
  collision: WorldCollision,
  water: WaterSurface | null
): number {
  const started = performance.now();
  const box = new THREE.Box3();
  let moved = 0;

  const settle = (node: THREE.Object3D, rule: SettleRule): boolean => {
    box.setFromObject(node);
    if (box.isEmpty()) return false;

    // The lowest *vertex*, not the box corner. A person's box is as wide as
    // their hat and backpack, so "the ground under the box" can be 15 cm above
    // the ground under their boots — and raising them to it leaves them
    // hovering. The lowest vertex is the boot, the keel, the pad's underside.
    const lowest = lowestPoint(node);
    if (!lowest) return false;

    const ground = collision.getGroundHeight(lowest.x, lowest.z);
    const surface = water ? water.heightAt(lowest.x, lowest.z) : null;
    const dry = ground !== null && surface !== null && ground > surface - 0.02;

    let target: number | null = null;
    switch (rule.rest) {
      case 'feet':
        if (ground === null) return false;
        target = ground;
        break;
      case 'water':
        if (surface === null || dry) return false; // beached, not floating
        target = surface - (rule.draft ?? draftFor(node.name));
        break;
      case 'surface':
        if (surface === null || dry) return false;
        target = surface - 0.02;
        break;
      case 'bed':
        if (surface === null || dry) {
          if (ground === null) return false;
          target = ground;
        } else {
          // Rooted in the bottom, but a clump whose bottom is two metres down
          // would be planted out of sight: hold its feet just under the surface
          // and let the water hide the rest.
          target = Math.max(ground ?? surface, surface - 0.45);
        }
        break;
    }
    if (target === null || !Number.isFinite(target)) return false;

    const shift = target - lowest.y;
    // A person is only ever raised. Lowering one would push them through
    // whatever they are actually standing on — a rock, a deck, a boat.
    if (rule.rest === 'feet' && shift < 0) return false;
    if (Math.abs(shift) < 0.03) return false;

    node.position.y += shift;
    return true;
  };

  const visit = (node: THREE.Object3D): void => {
    if (node.name) {
      const rule = SETTLE_RULES.find((r) => r.test.test(node.name));
      if (rule) {
        // Settle the outermost node that matches and stop: the parts inside a
        // boat are named after the boat, and settling both would move it twice.
        if (!NOT_A_CRAFT.test(node.name) && settle(node, rule)) moved++;
        return;
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);

  return moved === 0 ? 0 : performance.now() - started;
}

/**
 * Applies the explicit per-map moves from `mapFixes.ts`.
 *
 * Addressed by placement-node name, not by mesh: a structure is one node with a
 * dozen parts under it, and a bridge whose deck moves while its posts stay put
 * is a worse artefact than the one being fixed.
 */
export function applyPropShifts(root: THREE.Object3D, shifts: PropShift[]): number {
  let moved = 0;
  for (const shift of shifts) {
    root.traverse((node) => {
      if (node.name !== shift.node) return;
      node.position.x += shift.by[0];
      node.position.y += shift.by[1];
      node.position.z += shift.by[2];
      moved++;
    });
  }
  return moved;
}


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