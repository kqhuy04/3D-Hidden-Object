import * as THREE from 'three';

/**
 * Builds collision geometry from the *actual triangles* of the loaded scene,
 * instead of a hand-maintained list of bounding boxes.
 *
 * Two ideas keep it both accurate and cheap:
 *
 * 1. Classification. Not every render mesh is a physical obstacle. Tree
 *    canopies, reeds, lily pads, flames and lamp glass must not block the
 *    player. Meshes are classified by name (the kit names its parts
 *    descriptively) and by measured extent, never by editing one-off cases.
 *
 * 2. Step measurement. Collision is resolved as a 2D circle against triangle
 *    footprints, but only for triangles the body would actually collide with:
 *    those that stand more than `stepHeight` above the ground they are built
 *    on, that rise above the feet, and that stay below the head. A tabletop
 *    blocks; an awning at 2.2 m, a 0.1 m pebble or a kerb does not. This is
 *    what removes the "infinite wall" behaviour of AABBs.
 *
 *    The height of each triangle is measured against the terrain *under that
 *    triangle*, captured at build time. Measuring it against the player's own
 *    ground — the obvious alternative — makes the answer depend on where the
 *    player happens to be standing, and on a slope that changes by 4 cm per
 *    frame. A bench rail sitting 0.35 m above the ground then flips between
 *    "step over" and "wall" every frame, and the character vibrates in place.
 */

/** Meshes that never block the player. Names come from the kit's own vocabulary. */
const NON_SOLID_PATTERNS: RegExp[] = [
  /needles?$/i, // conifer canopy layers
  /^crown-\d/i, // canopy shells
  /reeds?/i, // reed clumps and litter
  /reed-litter/i,
  /lily-pad/i,
  /^bud-\d/i,
  /pebbles?/i,
  /flames?/i,
  /spark|smoke|steam/i,
  /^lights$/i, // string light bulbs
  /bulb-lamp|globe-glass/i,
  /pennant-cloth|banner|flag/i,
  /bail-wire/i, // cooler handles, thinner than the body
  /handle-[lr]-loop/i,
  /litter/i,
];

/** Whole-object names that are handled elsewhere (terrain raycast) or are not solid. */
const NON_SOLID_EXACT = new Set(['ground', 'water', 'terrain', 'duff', 'grass']);

/**
 * Whole *parts* that are vegetation and must not block.
 *
 * A field of crops is a field you walk through. Treated as solid, each plant is
 * a metre-tall wall, and the body that wanders into a row gets pushed from one
 * plant into the next until the depenetration loop gives up — the body ends up
 * eight centimetres inside a tomato plant with every direction blocked. On
 * `cozy-farm` a random walker managed 2.3 m in twenty-eight attempts before
 * this rule.
 *
 * The kit names them `<thing>-crop`, `<thing>-bush`, `flower-bed`, `sunflower`,
 * `seedling-tray`; trees are deliberately left out, because a trunk is
 * something you walk around.
 */
const NON_SOLID_PART_PATTERNS: RegExp[] = [
  /(^|-)crops?(-|_|$)/i,
  /(^|-)plants?(-|_|$)/i,
  /(^|-)(bush|shrub|vine|fern)(-|_|$)/i,
  /seedling/i,
  /sunflower/i,
  /flower-bed/i,
  // Bicycles are a frame with holes in it. The body fits through the gaps and
  // then sits inside a rack, walled in by the next bike — `japanese-suburban-
  // city-street` trapped a random walker for ten straight attempts that way.
  /bicycle|motorbike|scooter/i,
];

/**
 * Whole *parts* that are the ground itself.
 *
 * Every kit places one `<map>-terrain` node as a child of the placement group,
 * so it lands in the part list like a prop. It must not: its triangles span the
 * whole map, from a skirt 12 m below the play area up to the hilltops, and a
 * slope that rises more than one step above the feet is a wall. The body then
 * spawns inside a landscape that pushes it in every direction at once and can
 * never move again — which is exactly what the construction site did.
 *
 * The ground height is the heightfield's job (`setTerrainMeshes`), so the part
 * is dropped here and re-registered as terrain before the build.
 */
const TERRAIN_PART_PATTERNS: RegExp[] = [/-terrain$/i, /^terrain$/i];

/**
 * Parts you can stand on but that never block.
 *
 * A hammock is cloth slung between two posts: a body that jumps onto it stands
 * on the sag, and walking off the end is a step down, not a jump — but the
 * cloth's own steep end panels were walls, so a body on the cloth was fenced in
 * by the thing it was standing on. Excluding the part outright (the non-solid
 * list) also removed its floor, which is why it could not be stood on at all.
 * These keep their support and lose their walls.
 */
const NEVER_WALL_PATTERNS: RegExp[] = [/hammock/i];

/** True when the part must be left out of the horizontal resolver. */
function isNeverWall(name: string): boolean {
  return NEVER_WALL_PATTERNS.some((re) => re.test(name));
}

/**
 * Reads one placement node into a collider.
 *
 * Used twice: once per part when a map loads, and again by `rebakePart` when
 * something the player opened has moved. The second use passes the ground and
 * flatness columns of the part being replaced, so a door that swings keeps the
 * floor it was measured against instead of being re-measured against a
 * heightfield it is now standing somewhere else on.
 */
function collectPart(
  child: THREE.Object3D,
  groundAt?: (x: number, z: number) => number,
  skip?: Set<THREE.Object3D>,
  keepBases?: Float32Array,
  keepFlats?: Uint8Array
): { part: CollisionPart | null; skipped: number } {
  const vertices: number[] = [];
  const triBounds: number[] = [];
  const bases: number[] = [];
  const flats: number[] = [];
  let partMeshes = 0;
  let skipped = 0;

  child.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (skip && skip.has(mesh)) {
      skipped++;
      return;
    }
    if (CollisionGeometry.isNonSolid(mesh)) {
      skipped++;
      return;
    }

    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.getAttribute('position');
    if (!pos) return;

    // Measured extent, not a guess: skip surface detail.
    if (!geom.boundingBox) geom.computeBoundingBox();
    const size = geom.boundingBox ? geom.boundingBox.getSize(_v) : null;
    const scale = mesh.getWorldScale(new THREE.Vector3());
    const extent = size
      ? Math.max(size.x * Math.abs(scale.x), size.y * Math.abs(scale.y), size.z * Math.abs(scale.z))
      : 0;
    if (extent < MIN_SOLID_EXTENT) {
      skipped++;
      return;
    }

    const index = geom.getIndex();
    const triCountForMesh = (index ? index.count : pos.count) / 3;
    if (triCountForMesh < 1) return;

    partMeshes++;

    const matrix = mesh.matrixWorld;
    const readVertex = (i: number, out: number[]) => {
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      out.push(_v.x, _v.y, _v.z);
    };

    const tri = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      tri.length = 0;
      if (index) {
        readVertex(index.getX(i), tri);
        readVertex(index.getX(i + 1), tri);
        readVertex(index.getX(i + 2), tri);
      } else {
        readVertex(i, tri);
        readVertex(i + 1, tri);
        readVertex(i + 2, tri);
      }
      pushTriangle(vertices, triBounds, tri);
      const t = bases.length;
      bases.push(keepBases ? keepBases[t] : groundUnder(tri, groundAt));
      flats.push(keepFlats ? keepFlats[t] : isFlat(tri) ? 1 : 0);
    }
  });

  if (partMeshes === 0) return { part: null, skipped };

  let minBase = Infinity;
  for (let i = 0; i < bases.length; i++) if (bases[i] < minBase) minBase = bases[i];
  if (!Number.isFinite(minBase)) minBase = 0;

  const part: CollisionPart = {
    name: child.name || '(unnamed part)',
    node: child,
    vertices: Float32Array.from(vertices),
    triBounds: Float32Array.from(triBounds),
    triBase: Float32Array.from(bases),
    triFlat: Uint8Array.from(flats),
    minBase,
    bounds: new THREE.Box3(),
    meshes: partMeshes,
    triangles: vertices.length / 9,
    neverWall: isNeverWall(child.name || ''),
    stepBonus: stairBonusFor(child),
  };
  // Derive the part bounds from the triangle bounds we already computed.
  part.bounds.makeEmpty();
  for (let t = 0; t < part.triangles; t++) {
    const o = t * 6;
    part.bounds.expandByPoint(
      _v.set(part.triBounds[o], part.triBounds[o + 2], part.triBounds[o + 4])
    );
    part.bounds.expandByPoint(
      _v.set(part.triBounds[o + 1], part.triBounds[o + 3], part.triBounds[o + 5])
    );
  }

  return { part, skipped };
}

/**
 * True when a placement node is a *thing*, rather than the ground, the water or
 * a field of crops.
 *
 * This is the test the hunt's decoy list uses: any part that is solid enough to
 * be walked around is also solid enough to be clicked on, so the two questions
 * share one answer. Vegetation is excluded because a tomato plant is scenery —
 * a player who tabs onto a sunflower and presses E has been given a target that
 * nobody would describe as "an object in this room".
 */
export function isPickablePart(name: string): boolean {
  if (!name) return false;
  if (NON_SOLID_EXACT.has(name.toLowerCase())) return false;
  if (TERRAIN_PART_PATTERNS.some((re) => re.test(name))) return false;
  if (NON_SOLID_PART_PATTERNS.some((re) => re.test(name))) return false;
  return true;
}

/** Anything smaller than this in every axis is surface detail, not an obstacle. */
const MIN_SOLID_EXTENT = 0.15;

/**
 * A surface at most this far above the feet is the floor being stood on, not an
 * obstacle. Without it, standing on a dock deck would block against the deck
 * itself: the deck's triangles are the tallest thing at that spot.
 */
const FLOOR_TOLERANCE = 0.05;

/**
 * How far below the feet a part's surface can be and still count as the floor
 * the body is standing on. A body standing in a hammock's sag is up to half a
 * metre above the deepest part of the cloth.
 */
const STANDING_DEPTH = 0.6;

/**
 * Unit offsets used to sample a part's standable surface across the body
 * footprint.
 *
 * The centre alone is not enough. The hammock's cloth is a coarse mesh with
 * seams and gaps: at some points on it no flat triangle covers the body's exact
 * centre, so a point probe reports "nothing under the feet" while the body is
 * standing squarely on the cloth — and the cloth then becomes a wall around the
 * body standing on it. The same footprint sampling the support query uses for
 * plank gaps applies here. The ring reaches the full radius, diagonals
 * included: a half-radius ring still fell through the cloth's seams, and one
 * missed probe is enough to turn the floor back into a fence.
 */
const D = Math.SQRT1_2;
const FOOTPRINT_PROBES = [
  0, 0,
  1, 0, -1, 0, 0, 1, 0, -1,
  D, D, D, -D, -D, D, -D, -D,
];

export interface CollisionPartStats {
  name: string;
  meshes: number;
  triangles: number;
  bounds: THREE.Box3;
}

export interface CollisionBuildStats {
  parts: number;
  meshes: number;
  triangles: number;
  skippedMeshes: number;
  buildMs: number;
}

/**
 * Parts bucketed by their XZ footprint.
 *
 * The triangle-level index was tried first and it lost: a prop is a metre or
 * two across, so every triangle of it lands in the same handful of cells and
 * the lookup culls nothing while adding an indirection per triangle. What the
 * profiles actually showed is that the *loop over parts* is the cost — 480
 * parts, five probes per ground query, seven ground queries per NPC leg — and
 * that is a broad phase, so the broad phase is what gets indexed.
 *
 * A part goes into every cell its box touches. A query then walks the cells its
 * own box touches and gets exactly the parts the linear scan would have kept,
 * which is why the answers do not move.
 */
interface PartGrid {
  cell: number;
  minX: number;
  minZ: number;
  nx: number;
  nz: number;
  start: Int32Array;
  items: Int32Array;
}

/** Edge of one part bucket. Props are metres across; two metres keeps the lists short. */
const PART_CELL = 2.0;

/** Below this many parts, walking the list beats looking anything up. */
const PART_GRID_MIN = 16;

function buildPartGrid(parts: CollisionPart[]): PartGrid | null {
  if (parts.length < PART_GRID_MIN) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const part of parts) {
    const b = part.bounds;
    if (b.min.x < minX) minX = b.min.x;
    if (b.max.x > maxX) maxX = b.max.x;
    if (b.min.z < minZ) minZ = b.min.z;
    if (b.max.z > maxZ) maxZ = b.max.z;
  }
  if (!(maxX > minX) || !(maxZ > minZ)) return null;

  const nx = Math.max(1, Math.ceil((maxX - minX) / PART_CELL));
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / PART_CELL));
  const cells = nx * nz;
  const start = new Int32Array(cells + 1);

  const cellX = (v: number) => clampCell(Math.floor((v - minX) / PART_CELL), nx);
  const cellZ = (v: number) => clampCell(Math.floor((v - minZ) / PART_CELL), nz);

  for (const part of parts) {
    const b = part.bounds;
    const x0 = cellX(b.min.x);
    const x1 = cellX(b.max.x);
    const z0 = cellZ(b.min.z);
    const z1 = cellZ(b.max.z);
    for (let cz = z0; cz <= z1; cz++) {
      const row = cz * nx;
      for (let cx = x0; cx <= x1; cx++) start[row + cx + 1]++;
    }
  }
  for (let i = 0; i < cells; i++) start[i + 1] += start[i];

  const items = new Int32Array(start[cells]);
  const cursor = Int32Array.from(start.subarray(0, cells));
  for (let p = 0; p < parts.length; p++) {
    const b = parts[p].bounds;
    const x0 = cellX(b.min.x);
    const x1 = cellX(b.max.x);
    const z0 = cellZ(b.min.z);
    const z1 = cellZ(b.max.z);
    for (let cz = z0; cz <= z1; cz++) {
      const row = cz * nx;
      for (let cx = x0; cx <= x1; cx++) items[cursor[row + cx]++] = p;
    }
  }

  return { cell: PART_CELL, minX, minZ, nx, nz, start, items };
}

function clampCell(index: number, count: number): number {
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

export interface CircleContact {
  /** Horizontal push direction (unit). */
  nx: number;
  nz: number;
  /** How far the circle must move along (nx, nz) to stop overlapping. */
  penetration: number;
  /** World-space contact point on the surface, for debug rendering. */
  point: THREE.Vector3;
  /** Part that produced the contact. */
  partName: string;
}

interface CollisionPart {
  name: string;
  /** The placement node this part was read from, so it can be re-baked. */
  node: THREE.Object3D;
  /** 9 floats per triangle: ax ay az bx by bz cx cy cz (world space). */
  vertices: Float32Array;
  /** 6 floats per triangle: minX maxX minY maxY minZ maxZ. */
  triBounds: Float32Array;
  /** 1 float per triangle: terrain height under the triangle (world space). */
  triBase: Float32Array;
  /** 1 byte per triangle: 1 when the face is flat enough to stand on. */
  triFlat: Uint8Array;
  /** Lowest `triBase` in the part, for the broad phase. */
  minBase: number;
  bounds: THREE.Box3;
  meshes: number;
  triangles: number;
  /** Support only: the part never pushes the body sideways. */
  neverWall: boolean;
  /**
   * Extra step height this part allows, in metres.
   *
   * A staircase is the one thing the body is *meant* to walk up, and the kits'
   * stairs have 0.47 m risers — half again the general step limit. Raising the
   * limit globally would turn every chair seat and crate lid into a step, which
   * is why the allowance lives on the part: the stair prop gets it, the chair
   * next to it does not.
   */
  stepBonus: number;
}

/**
 * Parts the player is expected to walk up, by name.
 *
 * A staircase is not always called a staircase. The kits also ship raised
 * *decks* reached by a lip — a wetland boardwalk on its piles, a lake dock a
 * hand's width above the bank — and those lips are the same problem: 0.4-0.5 m
 * of riser that the body refuses, on a surface it is plainly meant to mount.
 * The family is therefore "things built to be walked along", which is exactly
 * the set whose name says so.
 */
const STAIR_PART = /stair|steps?(-|_|$)|staircase|boardwalk|dock|pier|jetty|deck|landing|footbridge|catwalk|ramp/i;
/** How much extra step a staircase gets, in metres. */
const STAIR_STEP_BONUS = 0.22;

/**
 * The step allowance for a part, taken from the part *and its ancestors*.
 *
 * The kit names the prop and leaves the parts inside it numbered: a boardwalk
 * run is `wetland-boardwalk-run` and its slabs are `boardwalk-bay`,
 * `boardwalk-bay_1`, and so on. Testing the part name alone therefore catches
 * exactly the kits that happened to name the leaf — and misses the ones that
 * did not, which is why the campground's boardwalk could not be climbed.
 */
function stairBonusFor(node: THREE.Object3D): number {
  let current: THREE.Object3D | null = node;
  for (let depth = 0; current && depth < 4; depth++, current = current.parent) {
    if (STAIR_PART.test(current.name || '')) return STAIR_STEP_BONUS;
  }
  return 0;
}

const _v = new THREE.Vector3();

export class CollisionGeometry {
  private parts: CollisionPart[] = [];
  /**
   * How many parts carry a step allowance. Zero on most maps, and then the
   * carry-over lookup is a single comparison rather than a pass over the scene.
   */
  private bonusParts = 0;
  private _stats: CollisionBuildStats = { parts: 0, meshes: 0, triangles: 0, skippedMeshes: 0, buildMs: 0 };
  /** Name of the placement node the parts were taken from (see `build`). */
  private containerName = '';

  /** Parts bucketed by footprint, so a query does not walk all of them. */
  private partGrid: PartGrid | null = null;
  /** Scratch: part indices a query is about to visit, ascending. */
  private _candidates = new Int32Array(256);
  /** Per-part stamp, so a part in two queried cells is visited once. */
  private _candidateStamp = new Int32Array(0);
  private _candidateQuery = 0;

  public get stats(): CollisionBuildStats {
    return this._stats;
  }

  /** The node whose children became collision parts, as named by the kit. */
  public getPartContainerName(): string {
    return this.containerName;
  }

  public get partStats(): CollisionPartStats[] {
    return this.parts.map((p) => ({
      name: p.name,
      meshes: p.meshes,
      triangles: p.triangles,
      bounds: p.bounds.clone(),
    }));
  }

  public get worldBounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const p of this.parts) box.union(p.bounds);
    return box;
  }

  public clear(): void {
    this.parts = [];
    this.bonusParts = 0;
    this.containerName = '';
    this.partGrid = null;
    this._stats = { parts: 0, meshes: 0, triangles: 0, skippedMeshes: 0, buildMs: 0 };
  }

  /**
   * Fills `_candidates` with the parts whose box overlaps an XZ rectangle, in
   * ascending part order, and returns how many there are.
   *
   * Ascending order is not cosmetic: `collectContacts` keeps the deepest few
   * contacts out of everything it finds and breaks ties by the order it met
   * them in. Visiting the same parts in the same order is what lets the index
   * be a pure accelerator instead of a change in behaviour.
   */
  private gatherParts(minX: number, maxX: number, minZ: number, maxZ: number): number {
    const grid = this.partGrid;
    const parts = this.parts;
    if (!grid) {
      if (this._candidates.length < parts.length) this._candidates = new Int32Array(parts.length);
      for (let i = 0; i < parts.length; i++) this._candidates[i] = i;
      return parts.length;
    }

    const cx0 = clampCell(Math.floor((minX - grid.minX) / grid.cell), grid.nx);
    const cx1 = clampCell(Math.floor((maxX - grid.minX) / grid.cell), grid.nx);
    const cz0 = clampCell(Math.floor((minZ - grid.minZ) / grid.cell), grid.nz);
    const cz1 = clampCell(Math.floor((maxZ - grid.minZ) / grid.cell), grid.nz);

    const stamp = ++this._candidateQuery;
    const out = this._candidates;
    let n = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      const row = cz * grid.nx;
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = row + cx;
        const from = grid.start[cell];
        const to = grid.start[cell + 1];
        for (let k = from; k < to; k++) {
          const p = grid.items[k];
          if (this._candidateStamp[p] === stamp) continue;
          this._candidateStamp[p] = stamp;
          out[n++] = p;
        }
      }
    }

    // Ascending, because the scan this replaces was in part order. Insertion
    // sort: the list is the handful of props around one body.
    for (let i = 1; i < n; i++) {
      const v = out[i];
      let j = i - 1;
      while (j >= 0 && out[j] > v) {
        out[j + 1] = out[j];
        j--;
      }
      out[j + 1] = v;
    }
    return n;
  }

  /** True when the mesh must not contribute collision. */
  public static isNonSolid(mesh: THREE.Mesh): boolean {
    // A skinned mesh is a *thing that moves*. Baked into the static soup it
    // leaves a copy of itself where it was standing: the people this game
    // started animating walked away and left invisible bodies behind, and a
    // horse that a player rides out of the stable would have been a two-metre
    // wall standing in the yard for the rest of the round. Nothing that walks
    // is architecture, so nothing that walks is a collider.
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) return true;

    const name = mesh.name || '';
    if (!name) return false; // unnamed meshes in this kit are real parts (doors, wheels)
    if (NON_SOLID_EXACT.has(name)) return true;
    return NON_SOLID_PATTERNS.some((re) => re.test(name));
  }

  /**
   * Collects solid triangles per object. One "part" is one compound collider:
   * all of its solid meshes merged into a single triangle soup, so a chair
   * keeps its legs and its open space in between.
   *
   * The kit wraps every prop in a single placement node (`kit-composition`, or
   * `<map>-<hash>` in the construction-site kit), so the grouping level is
   * found first. Without that step the whole map becomes one 110k-triangle
   * collider and nothing can be tuned per prop.
   *
   * `groundAt` is the terrain height sampler. Each triangle records the ground
   * beneath it, which is what lets the resolver decide "step over or wall"
   * without asking where the player is standing.
   *
   * `skip` holds the terrain meshes. They are the ground, not props: they are
   * registered with `WorldCollision.setTerrainMeshes` before this runs, and
   * keeping them here as well would fence the body inside the landscape.
   */
  public build(
    root: THREE.Object3D,
    groundAt?: (x: number, z: number) => number,
    skip?: Set<THREE.Object3D>
  ): void {
    const t0 = performance.now();
    this.clear();
    root.updateMatrixWorld(true);

    const container = findPartContainer(root);
    this.containerName = container.name;

    const parts: CollisionPart[] = [];
    let meshCount = 0;
    let triCount = 0;
    let skipped = 0;

    for (const child of container.children) {
      // The ground itself is the heightfield's job, never a prop collider.
      if (TERRAIN_PART_PATTERNS.some((re) => re.test(child.name || ''))) {
        skipped++;
        continue;
      }

      // Vegetation: walk-through, so it never becomes a part at all.
      if (NON_SOLID_PART_PATTERNS.some((re) => re.test(child.name || ''))) {
        skipped++;
        continue;
      }

      const built = collectPart(child, groundAt, skip);
      skipped += built.skipped;
      if (!built.part) continue;

      meshCount += built.part.meshes;
      triCount += built.part.triangles;
      parts.push(built.part);
    }

    this.parts = parts;
    this.bonusParts = parts.reduce((n, p) => n + (p.stepBonus > 0 ? 1 : 0), 0);
    this.partGrid = buildPartGrid(parts);
    this._candidateStamp = new Int32Array(parts.length);
    this._candidateQuery = 0;
    if (this._candidates.length < parts.length) this._candidates = new Int32Array(parts.length);
    this._stats = {
      parts: parts.length,
      meshes: meshCount,
      triangles: triCount,
      skippedMeshes: skipped,
      buildMs: Math.round((performance.now() - t0) * 100) / 100,
    };
  }

  /**
   * Re-measures the collider that owns this node, after the node has moved.
   *
   * A door that swings open has to take its collider with it, or the player
   * walks into an invisible door standing in a doorway they can plainly see
   * through. The part's triangles are re-read from the same meshes, in the same
   * order, so only the positions change — the ground under each triangle and its
   * flatness are kept, because a door turning on its hinge neither moves to a
   * different hill nor stops being flat.
   *
   * A door is usually *not* a part of its own: the kit nests it inside the
   * building it belongs to, and the collider is the whole building. So the node
   * is matched against the nearest part it sits inside, which is the one whose
   * triangle soup contains its meshes.
   *
   * Returns false when no part owns the node, or when re-reading produced a
   * different number of triangles; the caller then leaves the collider where it
   * was rather than half-updating it.
   */
  public rebakePart(node: THREE.Object3D): boolean {
    let index = -1;
    let scope: THREE.Object3D | null = node;
    while (scope && index < 0) {
      index = this.parts.findIndex((part) => part.node === scope);
      scope = scope.parent;
    }
    if (index < 0) return false;

    const before = this.parts[index];
    before.node.updateMatrixWorld(true);
    const built = collectPart(before.node, undefined, undefined, before.triBase, before.triFlat);
    if (!built.part || built.part.triangles !== before.triangles) return false;

    this.parts[index] = built.part;
    // A door that swung open has a different footprint, so the buckets are
    // rebuilt. It is a few thousand integer writes, paid once per interaction,
    // next to a re-read of every triangle in the part.
    this.partGrid = buildPartGrid(this.parts);
    return true;
  }

  /**
   * Highest near-horizontal surface the body can stand on at (x, z), within
   * `stepHeight` above the feet.
   *
   * The body band starts at feet + stepHeight so that low obstacles are stepped
   * over. That rule is wrong for *platforms*: a dock deck 0.27 m above the feet
   * falls below the band, so nothing blocks it and the player walks straight
   * through the boards. Stepping onto it instead is what makes decks, bridges
   * and boardwalks solid.
   */
  public supportHeight(x: number, z: number, feetY: number, stepHeight: number): number | null {
    const lo = feetY - 0.6;
    const carry = this.stepBonusUnder(x, z, feetY);
    let best: number | null = null;

    const found = this.gatherParts(x, x, z, z);
    for (let i = 0; i < found; i++) {
      const part = this.parts[this._candidates[i]];
      const hi = feetY + stepHeight + Math.max(part.stepBonus, carry) + 0.02;
      const top = topOfPart(part, x, z, lo, hi);
      if (top !== null && (best === null || top > best)) best = top;
    }

    return best;
  }

  /**
   * Step allowance carried by the surface underfoot, in metres.
   *
   * A staircase's bonus used to be a property of the surface being *stepped
   * onto*, which is right for the treads and wrong for the last one: the top
   * tread meets a landing or a deck belonging to another prop, that prop has no
   * bonus, and a 0.5 m last step was refused where the four before it were
   * allowed. That is the "walk to the top, then you have to jump" report, on
   * three different maps.
   *
   * Read from the ground instead — standing on a staircase, your step is a
   * staircase's step, whatever you are stepping onto — and the run is one rule
   * from bottom to top.
   */
  private stepBonusUnder(x: number, z: number, feetY: number): number {
    if (this.bonusParts === 0) return 0;
    let bonus = 0;
    const found = this.gatherParts(x, x, z, z);
    for (let i = 0; i < found; i++) {
      const part = this.parts[this._candidates[i]];
      if (part.stepBonus <= bonus) continue;
      if (part.bounds.max.y < feetY - 0.3) continue;
      if (part.bounds.min.y > feetY + 0.05) continue;
      if (topOfPart(part, x, z, feetY - 0.35, feetY + 0.05) === null) continue;
      bonus = part.stepBonus;
    }
    return bonus;
  }

  /**
   * True when this part is the floor the body is climbing, not a wall.
   *
   * A never-wall part is only skipped while this holds. Skipping it always let
   * the body walk straight through the hammock from the beach: the cloth was
   * not a floor there, so nothing else stopped it.
   *
   * Two details matter, and both were wrong at first:
   *
   *  - The test is one-sided. Requiring the surface to sit within a hand's
   *    width of the feet failed on the hammock's own end panel, which rises
   *    0.29 m just ahead of a body walking up the sag. That is a step the
   *    movement model is happy to climb, so it must not be a wall either: any
   *    surface at most `stepHeight` above the feet is climbable ground.
   *  - The probe covers the footprint, not the centre point. See
   *    FOOTPRINT_PROBES.
   */
  private standingOn(
    part: CollisionPart,
    x: number,
    z: number,
    feetY: number,
    stepHeight: number,
    radius: number
  ): boolean {
    const lo = feetY - STANDING_DEPTH;
    const hi = feetY + stepHeight + 0.02;
    for (let i = 0; i < FOOTPRINT_PROBES.length; i += 2) {
      const top = topOfPart(
        part,
        x + FOOTPRINT_PROBES[i] * radius,
        z + FOOTPRINT_PROBES[i + 1] * radius,
        lo,
        hi
      );
      if (top !== null) return true;
    }
    return false;
  }

  /**
   * Collects every triangle the circle overlaps, deepest first, up to
   * `out.length` entries.
   *
   * Resolving only the single deepest contact is not enough: where two
   * triangles meet at a seam (a dome tent's panels, a log's facets) they give
   * near-equal penetrations with opposing normal components, and the solver
   * ping-pongs between them every frame — visible as the character vibrating in
   * place. Combining all contacts cancels the opposing components and leaves
   * one stable push direction.
   */
  public collectContacts(
    x: number,
    z: number,
    radius: number,
    feetY: number,
    headY: number,
    stepHeight: number,
    out: CircleContact[]
  ): number {
    let count = 0;
    let smallest = 0;

    const carry = this.stepBonusUnder(x, z, feetY);
    const found = this.gatherParts(x - radius, x + radius, z - radius, z + radius);
    for (let i = 0; i < found; i++) {
      const part = this.parts[this._candidates[i]];
      const bonus = Math.max(part.stepBonus, carry);
      const step = stepHeight + bonus;
      if (part.neverWall && this.standingOn(part, x, z, feetY, step, radius)) continue;
      const b = part.bounds;
      if (b.min.y > headY) continue;
      if (b.max.y <= Math.min(part.minBase, feetY) + step) continue;
      if (x + radius < b.min.x || x - radius > b.max.x) continue;
      if (z + radius < b.min.z || z - radius > b.max.z) continue;

      const tb = part.triBounds;
      const base = part.triBase;
      const flat = part.triFlat;
      const verts = part.vertices;
      for (let t = 0; t < part.triangles; t++) {
        const o = t * 6;
        if (!triangleIsSolid(tb, o, base[t], feetY, headY, stepHeight, bonus, flat[t])) continue;
        if (x + radius < tb[o] || x - radius > tb[o + 1]) continue;
        if (z + radius < tb[o + 4] || z - radius > tb[o + 5]) continue;

        const v = t * 9;
        const hit = circleTriangle2D(
          x, z, radius,
          verts[v], verts[v + 2],
          verts[v + 3], verts[v + 5],
          verts[v + 6], verts[v + 8]
        );
        if (!hit) continue;
        // Solid where the body meets it, not where its bounding box is lowest.
        if (surfaceYAt(verts, v, hit.px, hit.pz) > headY) continue;

        if (count < out.length) {
          smallest = count;
          count++;
        } else if (hit.penetration > out[smallest].penetration) {
          // keep the deepest few
        } else {
          continue;
        }

        const slot = out[smallest];
        slot.nx = hit.nx;
        slot.nz = hit.nz;
        slot.penetration = hit.penetration;
        slot.point.set(hit.px, (tb[o + 2] + tb[o + 3]) * 0.5, hit.pz);
        slot.partName = part.name;

        smallest = 0;
        for (let k = 1; k < count; k++) {
          if (out[k].penetration < out[smallest].penetration) smallest = k;
        }
      }
    }

    return count;
  }

  /**
   * Deepest overlap between a vertical capsule footprint (circle at x,z) and
   * the scene, restricted to triangles the body can actually hit.
   *
   * Returns null when the circle is free. Only horizontal push is reported:
   * vertical motion is owned by the ground heightfield, so a tabletop can never
   * "launch" the player.
   */
  public deepestContact(
    x: number,
    z: number,
    radius: number,
    feetY: number,
    headY: number,
    stepHeight: number,
    out: CircleContact
  ): CircleContact | null {
    let found = false;

    const carry = this.stepBonusUnder(x, z, feetY);
    const nearby = this.gatherParts(x - radius, x + radius, z - radius, z + radius);
    for (let i = 0; i < nearby; i++) {
      const part = this.parts[this._candidates[i]];
      const bonus = Math.max(part.stepBonus, carry);
      const step = stepHeight + bonus;
      if (part.neverWall && this.standingOn(part, x, z, feetY, step, radius)) continue;
      const b = part.bounds;
      if (b.min.y > headY) continue;
      if (b.max.y <= Math.min(part.minBase, feetY) + step) continue;
      if (x + radius < b.min.x || x - radius > b.max.x) continue;
      if (z + radius < b.min.z || z - radius > b.max.z) continue;

      const tb = part.triBounds;
      const base = part.triBase;
      const flat = part.triFlat;
      const verts = part.vertices;
      for (let t = 0; t < part.triangles; t++) {
        const o = t * 6;
        if (!triangleIsSolid(tb, o, base[t], feetY, headY, stepHeight, bonus, flat[t])) continue;
        if (x + radius < tb[o] || x - radius > tb[o + 1]) continue;
        if (z + radius < tb[o + 4] || z - radius > tb[o + 5]) continue;

        const v = t * 9;
        const hit = circleTriangle2D(
          x,
          z,
          radius,
          verts[v], verts[v + 2],
          verts[v + 3], verts[v + 5],
          verts[v + 6], verts[v + 8]
        );
        if (!hit) continue;
        // Solid where the body meets it, not where its bounding box is lowest.
        if (surfaceYAt(verts, v, hit.px, hit.pz) > headY) continue;
        if (found && hit.penetration <= out.penetration) continue;

        found = true;
        out.nx = hit.nx;
        out.nz = hit.nz;
        out.penetration = hit.penetration;
        out.point.set(hit.px, (tb[o + 2] + tb[o + 3]) * 0.5, hit.pz);
        out.partName = part.name;
      }
    }

    return found ? out : null;
  }

  /**
   * First solid triangle a segment meets, as a fraction of its length.
   *
   * This is what keeps the camera out of walls. The third-person rig sits four
   * or five metres behind the body, and a wall between the two used to fill the
   * screen with the inside of a building; the fix is to ask the same triangles
   * the body collides with whether anything is in the way.
   *
   * Broad phase is the per-part AABB, so a segment through open air costs one
   * box test per prop. The narrow phase is Möller–Trumbore, and it stops at the
   * nearest hit.
   *
   * @returns `t` in [0, 1] along the segment, or null if nothing is in the way.
   */
  public raycastSegment(
    fromX: number, fromY: number, fromZ: number,
    toX: number, toY: number, toZ: number
  ): number | null {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dz = toZ - fromZ;

    // The segment's own box, to reject triangles before the narrow phase. A
    // five-metre ray through a church crosses hundreds of pews, and each of
    // them is a part with hundreds of triangles; six comparisons here cost far
    // less than Möller–Trumbore on every one of them.
    const segMinX = Math.min(fromX, toX);
    const segMaxX = Math.max(fromX, toX);
    const segMinY = Math.min(fromY, toY);
    const segMaxY = Math.max(fromY, toY);
    const segMinZ = Math.min(fromZ, toZ);
    const segMaxZ = Math.max(fromZ, toZ);

    let best = 1;

    const found = this.gatherParts(segMinX, segMaxX, segMinZ, segMaxZ);
    for (let i = 0; i < found; i++) {
      const part = this.parts[this._candidates[i]];
      const b = part.bounds;
      // Slab test, segment against the part's box.
      let tMin = 0;
      let tMax = best;
      let hitBox = true;
      for (let axis = 0; axis < 3; axis++) {
        const origin = axis === 0 ? fromX : axis === 1 ? fromY : fromZ;
        const dir = axis === 0 ? dx : axis === 1 ? dy : dz;
        const lo = axis === 0 ? b.min.x : axis === 1 ? b.min.y : b.min.z;
        const hi = axis === 0 ? b.max.x : axis === 1 ? b.max.y : b.max.z;
        if (Math.abs(dir) < 1e-9) {
          if (origin < lo || origin > hi) { hitBox = false; break; }
          continue;
        }
        let t1 = (lo - origin) / dir;
        let t2 = (hi - origin) / dir;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) { hitBox = false; break; }
      }
      if (!hitBox) continue;

      const verts = part.vertices;
      const tb = part.triBounds;
      for (let t = 0; t < part.triangles; t++) {
        const o = t * 6;
        if (tb[o] > segMaxX || tb[o + 1] < segMinX) continue;
        if (tb[o + 2] > segMaxY || tb[o + 3] < segMinY) continue;
        if (tb[o + 4] > segMaxZ || tb[o + 5] < segMinZ) continue;

        const v = t * 9;
        const ax = verts[v], ay = verts[v + 1], az = verts[v + 2];
        const e1x = verts[v + 3] - ax, e1y = verts[v + 4] - ay, e1z = verts[v + 5] - az;
        const e2x = verts[v + 6] - ax, e2y = verts[v + 7] - ay, e2z = verts[v + 8] - az;

        // Möller–Trumbore, no backface culling: a wall is opaque from both sides.
        const px = dy * e2z - dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;

        const inv = 1 / det;
        const tx = fromX - ax, ty = fromY - ay, tz = fromZ - az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;

        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const w = (dx * qx + dy * qy + dz * qz) * inv;
        if (w < 0 || u + w > 1) continue;

        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist > 0 && dist < best) best = dist;
      }
    }

    return best < 1 ? best : null;
  }

  /** Adds every collision triangle to a list of line segments, for debug rendering. */
  public appendDebugSegments(target: number[]): void {
    for (const part of this.parts) {
      const v = part.vertices;
      for (let i = 0; i < v.length; i += 9) {
        for (let e = 0; e < 3; e++) {
          const a = i + e * 3;
          const b = i + ((e + 1) % 3) * 3;
          target.push(v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2]);
        }
      }
    }
  }
}

/**
 * Descends through pass-through wrappers to the level that actually holds the
 * props.
 *
 * A wrapper is a node with exactly one child, and that child is not a mesh and
 * has children of its own (e.g. `gltf.scene` -> `kit-composition` -> 174 props).
 * The descent stops at the first branch point, which is the placement level.
 *
 * The one thing that must *not* stop the descent is a wrapper whose child
 * happens to contain a mesh beside its groups: `nyc-city` and
 * `japanese-suburban-city-street` wrap 208 and 524 props in a single node, and
 * a couple of those props are bare meshes. Treating "some child is a mesh" as
 * "this is the placement level" left the whole city as one 94k-triangle
 * collider — collision still worked, but every query scanned the entire map.
 */
function findPartContainer(root: THREE.Object3D): THREE.Object3D {
  let node = root;
  for (let depth = 0; depth < 8; depth++) {
    if (node.children.length !== 1) break;
    const only = node.children[0];
    if ((only as THREE.Mesh).isMesh) break;
    if (only.children.length === 0) break;
    node = only;
  }
  return node;
}

/**
 * Is this triangle something the body can collide with?
 *
 * Four independent questions, and the order matters:
 *
 *  - `flat && top <= feet + stepHeight` — a near-horizontal surface within one
 *    step of the feet is a *step*, not a wall: the support query lifts the body
 *    onto it. Classifying it as solid is what made every ramp unclimbable and
 *    every dock enterable only from exactly its own height. The ramp of the
 *    creek footbridge rises 4 cm per 25 cm; measured against the creek bed
 *    below it, the deck stands 0.75 m up, so the rule below called it a wall and
 *    the body stopped dead at the first plank.
 *  - `top > min(ground under the triangle, ground under the feet) + stepHeight`
 *    — otherwise the triangle is low enough to walk over. Taking the *lower* of
 *    the two grounds is what makes the answer stable: a bench rail 0.35 m above
 *    the ground stays a wall whether the player approaches it from the uphill
 *    or the downhill side, instead of flipping every frame as the feet ride the
 *    slope.
 *  - `top > feet + FLOOR_TOLERANCE` — otherwise this triangle *is* the floor
 *    underfoot (a dock deck, a step already climbed) and must not block.
 *  - `bottom <= headY` — otherwise it is entirely overhead: an awning, a roof,
 *    a bridge the player walks under.
 */
/**
 * Height of one triangle's surface at an (x, z) point, or `-Infinity`.
 *
 * `triangleIsSolid` can only see a triangle's *bounds*, and that is wrong for a
 * long thin member. The watchtower's diagonal braces are single triangles three
 * metres long that climb from 0.4 m to 2.8 m above the ground: their lowest
 * corner is inside a crawling body's band, so the brace counted as a wall for
 * its entire length and the body was stopped a metre short of the rungs, under
 * a plank a metre over its head. Measured *at the contact*, the brace is where
 * it looks — overhead — and the crawl passes under it.
 *
 * `-Infinity` means "cannot answer, treat as solid": the projection is
 * degenerate, i.e. the triangle is vertical, and a vertical face has no single
 * height at an (x, z) — a wall panel projects to a line, and every point along
 * that line is a different height of the same wall. Those keep the bounds test.
 */
function surfaceYAt(
  verts: Float32Array,
  v: number,
  px: number,
  pz: number
): number {
  const ax = verts[v], az = verts[v + 2];
  const bx = verts[v + 3], bz = verts[v + 5];
  const cx = verts[v + 6], cz = verts[v + 8];

  const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
  if (Math.abs(area) < 1e-5) return -Infinity;

  const w0 = ((bx - px) * (cz - pz) - (cx - px) * (bz - pz)) / area;
  const w1 = ((cx - px) * (az - pz) - (ax - px) * (cz - pz)) / area;
  const w2 = 1 - w0 - w1;
  return w0 * verts[v + 1] + w1 * verts[v + 4] + w2 * verts[v + 7];
}

function triangleIsSolid(
  tb: Float32Array,
  o: number,
  base: number,
  feetY: number,
  headY: number,
  stepHeight: number,
  bonus: number,
  flat: number
): boolean {
  // A floor is not a wall where the body is standing on it, or is about to step
  // onto it.
  //
  // The bounds used below are the triangle's *highest* corner, and a roof is
  // often one long sheet running from the eave to the ridge. Standing near the
  // eave the feet are half a metre under that corner, so every test below
  // called the roof a wall — and the body, whose centre is over the sheet's own
  // footprint, was pushed out of it sideways by more than a metre. That is the
  // "landed on the roof and was teleported" report.
  //
  // Measured from the sheet's *lowest* corner instead, so only a floor entirely
  // out of reach above the feet still blocks: the edge of a deck too high to
  // step onto. Whether the body is above or below a floor is the support
  // query's question, not this one's.
  if (flat && tb[o + 2] <= feetY + stepHeight) return false;

  const top = tb[o + 3];

  // "Low enough to step over" is measured from the ground the prop stands on,
  // unless the body has risen a full step above that ground — then it is
  // measured from the feet.
  //
  // The second half is what lets a jump clear anything its feet have risen
  // past. Without it a vertical face was a wall for the whole arc: on the
  // ground the feet sit at the base, and mid-jump the test still measured from
  // the base, so a bench's side stopped the body dead while its head was
  // already over the seat. The switch is deliberately a whole step above the
  // base rather than "whichever is higher": on a slope the feet are a few
  // centimetres above a prop's base and that difference changes every frame,
  // which is the flip-flop that used to make the body vibrate against a rail.
  //
  // A staircase is the exception, and it is not a knife-edge one. Its risers are
  // cut to a constant height — the arcology's plaza stair uses 0.34 m, one
  // centimetre under the general step limit — so on the first tread the feet
  // never clear `base + stepHeight`, every riser above stays measured from the
  // ground, and the body stops dead on step one. On a flight the reference is
  // always the feet: that is what a flight is.
  const standing = bonus > 0 || feetY > base + stepHeight ? feetY : base;
  if (top <= standing + stepHeight + bonus) return false;
  if (top <= feetY + FLOOR_TOLERANCE) return false;
  return tb[o + 2] <= headY;
}

/**
 * Highest standable point of one part at (x, z), or null.
 *
 * The same interpolation `supportHeight` does, lifted out so the horizontal
 * resolver can ask "is the body on top of this thing?" without scanning every
 * part again.
 */
function topOfPart(
  part: CollisionPart,
  x: number,
  z: number,
  lo: number,
  hi: number
): number | null {
  const b = part.bounds;
  if (b.max.y < lo || b.min.y > hi) return null;
  if (x < b.min.x || x > b.max.x) return null;
  if (z < b.min.z || z > b.max.z) return null;

  const tb = part.triBounds;
  const flat = part.triFlat;
  const verts = part.vertices;
  let best: number | null = null;

  for (let t = 0; t < part.triangles; t++) {
    const o = t * 6;
    if (tb[o + 3] < lo || tb[o + 2] > hi) continue;
    if (x < tb[o] || x > tb[o + 1]) continue;
    if (z < tb[o + 4] || z > tb[o + 5]) continue;
    // Only surfaces flat enough to stand on, never a wall or a steep slope.
    if (flat[t] === 0) continue;

    const v = t * 9;
    const ax = verts[v], ay = verts[v + 1], az = verts[v + 2];
    const bx = verts[v + 3], by = verts[v + 4], bz = verts[v + 5];
    const cx = verts[v + 6], cy = verts[v + 7], cz = verts[v + 8];

    const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (Math.abs(area) < 1e-9) continue;
    if (!pointInTriangle2D(x, z, ax, az, bx, bz, cx, cz)) continue;

    const w0 = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area;
    const w1 = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area;
    const y = w0 * ay + w1 * by + (1 - w0 - w1) * cy;

    if (y < lo || y > hi) continue;
    if (best === null || y > best) best = y;
  }

  return best;
}

/**
 * Flat enough to stand on: the same threshold `supportHeight` uses, evaluated
 * once at build time instead of per query.
 */
function isFlat(tri: number[]): boolean {
  const ux = tri[3] - tri[0], uy = tri[4] - tri[1], uz = tri[5] - tri[2];
  const wx = tri[6] - tri[0], wy = tri[7] - tri[1], wz = tri[8] - tri[2];
  const nx = uy * wz - uz * wy;
  const ny = uz * wx - ux * wz;
  const nz = ux * wy - uy * wx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return Math.abs(ny / len) >= 0.7;
}

/**
 * Terrain height under a triangle, taken as the highest of its corners and
 * centre. A prop straddling a slope is held to the highest ground it stands on,
 * so it cannot be walked through from the uphill side.
 */
function groundUnder(tri: number[], groundAt?: (x: number, z: number) => number): number {
  if (!groundAt) return 0;
  let g = groundAt(tri[0], tri[2]);
  const g1 = groundAt(tri[3], tri[5]);
  const g2 = groundAt(tri[6], tri[8]);
  const g3 = groundAt(
    (tri[0] + tri[3] + tri[6]) / 3,
    (tri[2] + tri[5] + tri[8]) / 3
  );
  if (g1 > g) g = g1;
  if (g2 > g) g = g2;
  if (g3 > g) g = g3;
  return g;
}

function pushTriangle(vertices: number[], triBounds: number[], tri: number[]): void {
  vertices.push(tri[0], tri[1], tri[2], tri[3], tri[4], tri[5], tri[6], tri[7], tri[8]);
  triBounds.push(
    Math.min(tri[0], tri[3], tri[6]),
    Math.max(tri[0], tri[3], tri[6]),
    Math.min(tri[1], tri[4], tri[7]),
    Math.max(tri[1], tri[4], tri[7]),
    Math.min(tri[2], tri[5], tri[8]),
    Math.max(tri[2], tri[5], tri[8])
  );
}

interface CircleTriangleHit {
  nx: number;
  nz: number;
  penetration: number;
  px: number;
  pz: number;
}

/**
 * 2D circle vs triangle in the XZ plane.
 * Returns the shortest push that separates them, or null.
 */
function circleTriangle2D(
  cx: number,
  cz: number,
  radius: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  tx: number,
  tz: number
): CircleTriangleHit | null {
  const inside = pointInTriangle2D(cx, cz, ax, az, bx, bz, tx, tz);

  if (inside) {
    // Centre is inside the footprint: push out through the nearest edge.
    const e1 = closestOnSegment2D(cx, cz, ax, az, bx, bz);
    const e2 = closestOnSegment2D(cx, cz, bx, bz, tx, tz);
    const e3 = closestOnSegment2D(cx, cz, tx, tz, ax, az);
    let best = e1;
    if (e2.d2 < best.d2) best = e2;
    if (e3.d2 < best.d2) best = e3;
    const d = Math.sqrt(best.d2);
    // Direction points from the edge towards the centre, then outwards.
    let nx = cx - best.x;
    let nz = cz - best.z;
    const len = Math.hypot(nx, nz);
    if (len < 1e-6) {
      // Degenerate: use the edge normal.
      nx = -(bz - az);
      nz = bx - ax;
      const l2 = Math.hypot(nx, nz) || 1;
      nx /= l2;
      nz /= l2;
    } else {
      nx /= len;
      nz /= len;
    }
    return { nx, nz, penetration: radius + d, px: best.x, pz: best.z };
  }

  const q1 = closestOnSegment2D(cx, cz, ax, az, bx, bz);
  const q2 = closestOnSegment2D(cx, cz, bx, bz, tx, tz);
  const q3 = closestOnSegment2D(cx, cz, tx, tz, ax, az);
  let q = q1;
  if (q2.d2 < q.d2) q = q2;
  if (q3.d2 < q.d2) q = q3;

  if (q.d2 >= radius * radius) return null;

  const d = Math.sqrt(q.d2);
  let nx = cx - q.x;
  let nz = cz - q.z;
  if (d < 1e-6) return null;
  nx /= d;
  nz /= d;
  return { nx, nz, penetration: radius - d, px: q.x, pz: q.z };
}

function pointInTriangle2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number
): boolean {
  // A triangle with no area in XZ is a vertical surface — a wall's end cap, a
  // fence post's face, a table's apron. Its projection is a *line*, and the
  // three sign tests below collapse into the same "which side of that line"
  // answer, so the function would report "inside" for almost every point in the
  // plane. Measured on the amphitheatre bench end cap: a body 0.27 m away from
  // the face was told it was 0.57 m deep inside it, and was ejected 0.47 m.
  // Such a triangle is a segment, never a containing region.
  const area2 = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
  if (Math.abs(area2) < 1e-9) return false;

  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function closestOnSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): { x: number; z: number; d2: number } {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = 0;
  if (len2 > 1e-12) {
    t = ((px - ax) * abx + (pz - az) * abz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const x = ax + abx * t;
  const z = az + abz * t;
  const dx = px - x;
  const dz = pz - z;
  return { x, z, d2: dx * dx + dz * dz };
}
