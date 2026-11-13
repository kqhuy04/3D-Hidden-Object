import * as THREE from 'three';
import { CircleContact, CollisionGeometry } from './CollisionGeometry';
import { GAME_CONFIG } from '../../data/gameConfig';

export interface CollisionBox {
  key: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

/** A ladder, as a box the body can climb inside. */
export interface ClimbVolume {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Height of the bottom rung, i.e. where a climb starts. */
  bottom: number;
  /** Height of the top rung, i.e. where the body steps off. */
  top: number;
}

export interface CapsuleConfig {  /** Body radius in metres. */
  radius: number;
  /** Total standing height in metres (feet to top of head). */
  height: number;
  /** Obstacles lower than this are stepped over instead of blocking. */
  stepHeight: number;
  /** Extra separation kept from surfaces, prevents contact jitter. */
  skinWidth: number;
}

export interface MoveResult {
  position: THREE.Vector3;
  /** Strongest contacts resolved during this move, for debug rendering. */
  contacts: CircleContact[];
  /** True when at least one contact was resolved. */
  blocked: boolean;
}

/**
 * Ground heights rasterised from the terrain triangles.
 *
 * `Raycaster.intersectObject` walks every triangle of the mesh: the campground
 * ground has 22,540 of them, which measured at 6.2 ms per query — two queries
 * per move, so 12 ms of every frame. Rasterising once at load turns the same
 * query into a bilinear lookup (~0.1 us).
 */
interface HeightField {
  data: Float32Array;
  size: number;
  minX: number;
  minZ: number;
  cell: number;
}

const _contact: CircleContact = {
  nx: 0,
  nz: 0,
  penetration: 0,
  point: new THREE.Vector3(),
  partName: '',
};

/** Unit offsets used to sample the standable surface across the body footprint. */
const SUPPORT_PROBES = [1, 0, -1, 0, 0, 1, 0, -1];

/**
 * Player collision against the static world.
 *
 * Two layers:
 *  - Mesh layer: triangle footprints from `CollisionGeometry`, band-limited to
 *    the player's body height, so the player follows the real shape of props.
 *  - Box layer: coarse AABB volumes, kept for callers that only need a rough
 *    blocker (unit tests, scripted volumes).
 *
 * Movement is resolved as a circle pushed out of overlaps, which produces
 * sliding along surfaces for free. Vertical placement comes from a terrain
 * raycast, so nothing can launch the player upwards.
 */
export class WorldCollision {
  private boxes: CollisionBox[] = [];
  private terrainMeshes: THREE.Mesh[] = [];
  private heightField: HeightField | null = null;
  private geometry: CollisionGeometry | null = null;
  private climbVolumes: ClimbVolume[] = [];
  private raycaster = new THREE.Raycaster();
  private downVector = new THREE.Vector3(0, -1, 0);
  /**
   * Last terrain height the heightfield actually had data for.
   *
   * Past the edge of the rasterised field there is no ground to sample, and the
   * exact answer — `raycastGround`, a `Raycaster` over every terrain triangle —
   * measured at 6.2 ms per query on the campground's 22,540 triangles. The walk
   * asks for the ground four times a frame, so a body standing on a pier or a
   * reef ledge just outside the field was paying 25 ms a frame for a number
   * nobody can see: off the field there is no terrain to be accurate about.
   * Holding the last real sample is both cheaper and steadier — the body keeps
   * the level of the edge instead of dropping to the skirt the kit modelled
   * twelve metres below it.
   */
  private lastGroundY = 0;
  /** Reused scratch space for multi-contact resolution. */
  private contactPool: CircleContact[] = Array.from({ length: 8 }, () => ({
    nx: 0, nz: 0, penetration: 0, point: new THREE.Vector3(), partName: '',
  }));

  private capsule: CapsuleConfig = {
    radius: GAME_CONFIG.player.capsuleRadius,
    height: GAME_CONFIG.player.capsuleHeight,
    stepHeight: GAME_CONFIG.player.stepHeight,
    skinWidth: GAME_CONFIG.player.skinWidth,
  };

  /**
   * Registers the meshes that *are* the ground.
   *
   * One map may split its floor across several meshes — the construction site
   * has nine `ground` slabs beside its terrain sheet — so the heightfield is
   * rasterised from all of them at once, keeping the highest surface per cell.
   * Registering only the first left holes where the body fell to y = 0.
   */
  public setTerrainMeshes(meshes: THREE.Mesh[]): void {
    this.terrainMeshes = meshes.filter(Boolean);
    this.heightField = buildHeightField(this.terrainMeshes);
    // A new map's heights mean nothing to the old map's last sample.
    this.lastGroundY = 0;
    const field = this.heightField;
    if (field) {
      const centreX = field.minX + (field.cell * field.size) / 2;
      const centreZ = field.minZ + (field.cell * field.size) / 2;
      const centre = sampleHeightField(field, centreX, centreZ);
      if (centre !== null) this.lastGroundY = centre;
    }
  }

  public setTerrainMesh(mesh: THREE.Mesh): void {
    this.setTerrainMeshes([mesh]);
  }

  public getTerrainMeshes(): THREE.Mesh[] {
    return this.terrainMeshes;
  }

  public setCollisionGeometry(geometry: CollisionGeometry): void {
    this.geometry = geometry;
  }

  public getCollisionGeometry(): CollisionGeometry | null {
    return this.geometry;
  }

  /**
   * How far the camera may sit from `from` along the way to `to`.
   *
   * The third-person rig lives four or five metres behind the body, so a wall
   * between the two puts the camera inside it and the screen fills with the
   * inside of a building. Two sources can block the view: the collision
   * triangles (walls, props) and the terrain, which is a heightfield rather
   * than a collider and so has to be sampled.
   *
   * @returns the usable distance, between 0 and `|to - from|`.
   */
  public cameraDistance(from: THREE.Vector3, to: THREE.Vector3): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-4) return 0;

    let t = this.geometry
      ? this.geometry.raycastSegment(from.x, from.y, from.z, to.x, to.y, to.z) ?? 1
      : 1;

    // The terrain is not a collider, so walk the segment and stop at the first
    // sample that would be under a hill. The coarse pass only brackets the
    // crossing; the answer is then bisected, because a scan that returns
    // multiples of `length / 8` makes the boom jump in 0.6 m steps on a 5 m
    // leash, and a boom that steps is a screen that judders.
    const STEPS = 8;
    const CLEARANCE = 0.35;
    // `terrainHeight`, not `getGroundHeight`: past the edge of the heightfield
    // the latter falls back to an exact raycast over every terrain triangle,
    // and fifteen of those per frame is a stutter. Off the field there is no
    // terrain to occlude the view, so the sample is simply skipped.
    const under = (s: number): boolean => {
      const ground = this.terrainHeight(from.x + dx * s, from.z + dz * s);
      return ground !== null && from.y + dy * s < ground + CLEARANCE;
    };

    let lo = 0;
    let hi = -1;
    for (let i = 1; i <= STEPS; i++) {
      const s = (i / STEPS) * t;
      if (under(s)) {
        hi = s;
        break;
      }
      lo = s;
    }

    if (hi >= 0) {
      for (let k = 0; k < 7; k++) {
        const mid = (lo + hi) * 0.5;
        if (under(mid)) hi = mid;
        else lo = mid;
      }
      t = lo;
    }

    return t * length;
  }

  public setCapsule(capsule: Partial<CapsuleConfig>): void {
    this.capsule = { ...this.capsule, ...capsule };
  }

  public getCapsule(): CapsuleConfig {
    return this.capsule;
  }

  public addObstacleBox(box: CollisionBox): void {
    this.boxes.push(box);
  }

  public getObstacleBoxes(): CollisionBox[] {
    return this.boxes;
  }

  public clear(): void {
    this.boxes = [];
    this.terrainMeshes = [];
    this.heightField = null;
    this.geometry = null;
    this.climbVolumes = [];
    this.lastGroundY = 0;
  }

  /**
   * A ladder the body can climb: a tall, narrow box in front of a ladder prop.
   *
   * Detected from the map's own geometry rather than authored by hand, because
   * the kits already name the prop — a `<map>-ladder` node with a two-metre
   * tall box is a ladder and nothing else is. Authoring coordinates for three
   * maps by hand would be three chances to be a metre off.
   */
  public setClimbVolumes(volumes: ClimbVolume[]): void {
    this.climbVolumes = volumes;
  }

  public getClimbVolumes(): readonly ClimbVolume[] {
    return this.climbVolumes;
  }

  /**
   * The ladder whose footprint contains (x, z), with `pad` metres of slack so
   * standing at the foot of it counts as being on it.
   *
   * The volumes are already padded by the body's radius when they are built, so
   * `pad` here is only the last few centimetres of slack. It used to default to
   * 0.6, which stacked with the 0.35 in the builder and put the grab boundary
   * more than a metre and a half from a ladder whose rungs are half a metre
   * wide.
   */
  public climbVolumeAt(x: number, z: number, pad = 0.05): ClimbVolume | null {
    for (const v of this.climbVolumes) {
      if (x < v.minX - pad || x > v.maxX + pad) continue;
      if (z < v.minZ - pad || z > v.maxZ + pad) continue;
      return v;
    }
    return null;
  }

  /**
   * Moves a capsule by `movement`, resolving overlaps against the mesh and box
   * layers. Sub-steps keep fast movement from tunnelling through thin walls;
   * the push-out loop handles several surfaces at once (corners).
   *
   * `bodyFeetY` is the height of the body's feet when that differs from the
   * ground it stands on — i.e. mid-jump or mid-fall. The collision band follows
   * the body, so an obstacle the feet have already cleared stops blocking, while
   * the returned `position.y` stays anchored to the ground so the caller keeps
   * owning the vertical arc.
   */
  public moveCapsule(
    currentPos: THREE.Vector3,
    movement: THREE.Vector3,
    capsule: CapsuleConfig = this.capsule,
    bodyFeetY?: number
  ): MoveResult {
    const position = currentPos.clone();
    const contacts: CircleContact[] = [];

    const dist = Math.hypot(movement.x, movement.z);

    // Eject any overlap the player starts in. Without this a body that has been
    // pushed into geometry (or spawned inside it) can never move again: every
    // sub-step is rejected by the safety net below and it stays frozen.
    const groundBefore = this.groundNear(position.x, position.z);
    const bandBefore = bodyFeetY ?? groundBefore;
    this.depenetrate(position, capsule, bandBefore, bandBefore + capsule.height);

    // The support query is anchored on the *body*, not on the last ground
    // reading. It used to be anchored on `position.y`, which the caller fills
    // with the ground height from the previous frame — a self-referential loop:
    // the window slides down with the answer, so once it slipped off a deck or a
    // bench it could never find it again, and the reported ground flickered
    // between the prop and the terrain every few frames. Mid-jump that flicker
    // is what the camera follows, which is the one-frame jerk that was reported
    // while falling; it is also why a body could never land on a roof, since
    // the window sat on the terrain 3 m below its feet.
    const supportRef = bodyFeetY ?? position.y;
    const supportStart = this.supportHeight(position.x, position.z, supportRef, capsule);
    const terrainStart = this.groundNear(position.x, position.z);
    const groundStart =
      supportStart !== null && supportStart > terrainStart ? supportStart : terrainStart;
    position.y = groundStart;

    if (dist < 1e-5) {
      return { position, contacts, blocked: false };
    }

    // One ground sample per move keeps the body reference stable; terrain slope
    // inside a single sub-step is far below the body height.
    const feetY = bodyFeetY ?? groundStart;
    const headY = feetY + capsule.height;

    // Sub-step below half the radius: a step can never jump across a surface.
    // The absolute 0.08 m ceiling additionally keeps a single sub-step from
    // carrying the centre past the mid-plane of the kit's thin parts (planks,
    // canvas, railings), which is where the push-out direction turns ambiguous.
    // At 60 fps a frame moves 0.08 m, so this costs nothing in normal play.
    const maxStep = Math.min(capsule.radius * 0.5, 0.08);
    const steps = Math.max(1, Math.min(512, Math.ceil(dist / maxStep)));
    const stepX = movement.x / steps;
    const stepZ = movement.z / steps;

    // Last position proven to be outside every surface. The returned position is
    // never worse than this, which makes tunnelling impossible rather than
    // unlikely.
    let blocked = false;
    let safeX = position.x;
    let safeZ = position.z;

    for (let s = 0; s < steps; s++) {
      const subStartX = position.x;
      const subStartZ = position.z;
      position.x += stepX;
      position.z += stepZ;

      // The playable area is the terrain mesh itself. Past its edge the
      // heightfield has no data and the ground silently reads as 0, so the old
      // square clamp let the player walk off the forest line into empty space.
      //
      // A prop may still reach past that edge — a reef rock, a pier, a
      // boardwalk — and a body standing on one is not in empty space. Rejecting
      // every step there fenced the player onto the rock: `coral-reef` has a
      // ledge at the edge of the heightfield where four of the eight directions
      // were walls and the other four were the only way back.
      if (!this.hasGround(position.x, position.z)) {
        const support = this.supportHeight(position.x, position.z, feetY, capsule);
        if (support === null) {
          // A wall at the edge of the map should still let the body slide along
          // it. Rejecting the whole sub-step made the boundary behave like glue:
          // a diagonal walk stopped dead instead of running parallel to the
          // edge, and `coral-reef` — whose ledge follows the heightfield border
          // — pinned the body for seven straight segments with five of eight
          // headings already blocked by the sea.
          const slideX = Math.abs(stepX) > 1e-6 && this.hasGround(subStartX + stepX, subStartZ);
          const slideZ = Math.abs(stepZ) > 1e-6 && this.hasGround(subStartX, subStartZ + stepZ);

          if (!slideX && !slideZ) {
            position.x = subStartX;
            position.z = subStartZ;
            blocked = true;
            break;
          }

          position.x = slideX ? subStartX + stepX : subStartX;
          position.z = slideZ ? subStartZ + stepZ : subStartZ;
          blocked = true;
          // Fall through to the push-out below: the slide may have carried the
          // body into a prop even though the ground under it is valid.
        }
      }

      // Push out of everything we now overlap. Four passes settle a corner
      // (two planes) plus a box, without oscillating.
      for (let iter = 0; iter < 4; iter++) {
        const mesh = this.combinedMeshContact(
          position.x, position.z, capsule.radius, feetY, headY, capsule.stepHeight
        );
        const box = this.deepestBoxContact(position.x, position.z, capsule.radius);

        let nx = 0;
        let nz = 0;
        let penetration = 0;
        let partName = '';
        let point: THREE.Vector3 | null = null;

        if (mesh && box) {
          if (box.penetration >= mesh.penetration) {
            nx = box.nx; nz = box.nz; penetration = box.penetration; partName = box.partName;
          } else {
            nx = mesh.nx; nz = mesh.nz; penetration = mesh.penetration; partName = mesh.partName;
            point = mesh.point;
          }
        } else if (mesh) {
          nx = mesh.nx; nz = mesh.nz; penetration = mesh.penetration; partName = mesh.partName;
          point = mesh.point;
        } else if (box) {
          nx = box.nx; nz = box.nz; penetration = box.penetration; partName = box.partName;
        }

        if (penetration <= 0) break;

        // A contact normal derived from "nearest surface point" is ambiguous
        // once the centre has crossed a thin surface: it can point the wrong
        // way and push the player through. Always push back against the step
        // that caused the overlap.
        if (nx * stepX + nz * stepZ > 0) {
          nx = -nx;
          nz = -nz;
        }

        blocked = true;
        const push = penetration + capsule.skinWidth;
        position.x += nx * push;
        position.z += nz * push;

        if (contacts.length < 8) {
          contacts.push({
            nx,
            nz,
            penetration,
            partName,
            point: point
              ? point.clone()
              : new THREE.Vector3(position.x, groundStart + 0.9, position.z),
          });
        }
      }

      // Resolution may cancel the step, but it may not reverse it. Pressed into
      // a convex corner (a chopping block's edge), the nearest-facet normal
      // alternates between two facets every frame, so the push rotates by a few
      // degrees and walks the body sideways, which flips the choice back: a
      // 1 cm orbit that reads as judder. If the step made no forward progress,
      // staying exactly where the body was is both correct and stable.
      if (blocked && (position.x - subStartX) * stepX + (position.z - subStartZ) * stepZ <= 0) {
        position.x = subStartX;
        position.z = subStartZ;
      }

      // Safety net against tunnelling. A thin double-sided part (a plank, a
      // railing, tent canvas) cannot be resolved when the body ends up
      // straddling it: the two faces push in opposite directions and the
      // push-out oscillates. Rather than accept a position inside geometry,
      // fall back to the last position that was provably clear. Measured need:
      // 0 penetrations up to 2 m per call, ~1.6% at 6 m; this removes them.
      if (this.geometry) {
        const after = this.geometry.deepestContact(
          position.x, position.z, capsule.radius, feetY, headY, capsule.stepHeight, _contact
        );
        if (after && after.penetration > capsule.skinWidth) {
          position.x = safeX;
          position.z = safeZ;
          blocked = true;
          break;
        }
      }
      safeX = position.x;
      safeZ = position.z;
    }

    // Final height: terrain, or the deck/bridge the body is standing on.
    const terrainEnd = this.groundNear(position.x, position.z);
    const supportEnd = this.supportHeight(position.x, position.z, supportRef, capsule);
    position.y =
      supportEnd !== null && supportEnd > terrainEnd ? supportEnd : terrainEnd;

    return { position, contacts, blocked };
  }

  /**
   * True when (x, z) is inside the rasterised terrain.
   *
   * The heightfield stores NaN wherever no triangle covers a cell, which is
   * exactly the "off the map" region. Without this test the ground there reads
   * as 0 and the player floats out over nothing.
   */
  private hasGround(x: number, z: number): boolean {
    const field = this.heightField;
    if (!field) return true; // no terrain registered: keep the previous behaviour

    const fx = (x - field.minX) / field.cell - 0.5;
    const fz = (z - field.minZ) / field.cell - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const size = field.size;
    if (i < 0 || j < 0 || i >= size - 1 || j >= size - 1) return false;

    const d = field.data;
    return !(
      Number.isNaN(d[j * size + i]) &&
      Number.isNaN(d[j * size + i + 1]) &&
      Number.isNaN(d[(j + 1) * size + i]) &&
      Number.isNaN(d[(j + 1) * size + i + 1])
    );
  }

  /**
   * Highest standable surface near the feet, or null.
   *
   * Sampled over the body's footprint, not just its centre point. A dock or
   * boardwalk deck is built from planks with 1-2 cm gaps, and a single point
   * sample lands in a gap often enough to return the crossbeam 11 cm lower —
   * which then leaves the deck top above the feet, so the deck blocks the very
   * player standing on it. A 0.3 m foot cannot fall through a 2 cm gap, so the
   * support query must not be able to either.
   */
  private supportHeight(
    x: number,
    z: number,
    feetY: number,
    capsule: CapsuleConfig
  ): number | null {
    if (!this.geometry) return null;

    let best = this.geometry.supportHeight(x, z, feetY, capsule.stepHeight);
    const r = capsule.radius * 0.5;
    for (let i = 0; i < SUPPORT_PROBES.length; i += 2) {
      const s = this.geometry.supportHeight(
        x + SUPPORT_PROBES[i] * r,
        z + SUPPORT_PROBES[i + 1] * r,
        feetY,
        capsule.stepHeight
      );
      if (s !== null && (best === null || s > best)) best = s;
    }
    return best;
  }

  /** Legacy entry point kept for callers that only move a circle. */
  public resolveMovement(
    currentPos: THREE.Vector3,
    movement: THREE.Vector3,
    radius = 0.45
  ): THREE.Vector3 {
    return this.moveCapsule(currentPos, movement, { ...this.capsule, radius }).position;
  }

  /**
   * Push direction for every triangle the body currently overlaps.
   *
   * Combining all contacts (weighted by penetration) instead of taking only the
   * deepest one is what stops the character vibrating at a seam: on a dome
   * tent, two panels give near-equal penetrations whose sideways components are
   * opposite, so a single-contact solver alternates between them every frame.
   * Summed, those components cancel and the push stays perpendicular to the
   * surface.
   */
  private combinedMeshContact(
    x: number,
    z: number,
    radius: number,
    feetY: number,
    headY: number,
    stepHeight: number
  ): { nx: number; nz: number; penetration: number; partName: string; point: THREE.Vector3 } | null {
    if (!this.geometry) return null;

    const count = this.geometry.collectContacts(
      x, z, radius, feetY, headY, stepHeight, this.contactPool
    );
    if (count === 0) return null;

    let sumX = 0;
    let sumZ = 0;
    let maxPen = 0;
    let deepest = this.contactPool[0];

    for (let i = 0; i < count; i++) {
      const c = this.contactPool[i];
      sumX += c.nx * c.penetration;
      sumZ += c.nz * c.penetration;
      if (c.penetration > maxPen) {
        maxPen = c.penetration;
        deepest = c;
      }
    }

    const len = Math.hypot(sumX, sumZ);
    if (len < 1e-6) {
      // Opposing surfaces cancel out (body wedged in a gap): keep the deepest
      // single contact rather than pushing nowhere.
      _contact.nx = deepest.nx;
      _contact.nz = deepest.nz;
    } else {
      _contact.nx = sumX / len;
      _contact.nz = sumZ / len;
    }
    _contact.penetration = maxPen;
    _contact.partName = deepest.partName;
    _contact.point.copy(deepest.point);
    return _contact;
  }

  /** Slides the body out of any overlap it is already in (horizontal only). */
  private depenetrate(
    position: THREE.Vector3,
    capsule: CapsuleConfig,
    feetY: number,
    headY: number
  ): void {
    for (let i = 0; i < 6; i++) {
      const mesh = this.combinedMeshContact(
        position.x, position.z, capsule.radius, feetY, headY, capsule.stepHeight
      );
      const box = this.deepestBoxContact(position.x, position.z, capsule.radius);

      let nx = 0;
      let nz = 0;
      let penetration = 0;
      if (mesh && box) {
        if (box.penetration >= mesh.penetration) {
          nx = box.nx; nz = box.nz; penetration = box.penetration;
        } else {
          nx = mesh.nx; nz = mesh.nz; penetration = mesh.penetration;
        }
      } else if (mesh) {
        nx = mesh.nx; nz = mesh.nz; penetration = mesh.penetration;
      } else if (box) {
        nx = box.nx; nz = box.nz; penetration = box.penetration;
      }

      if (penetration <= 0) return;
      position.x += nx * (penetration + capsule.skinWidth);
      position.z += nz * (penetration + capsule.skinWidth);
    }
  }

  /** Circle-vs-box overlap, returns the shortest horizontal push. */
  private deepestBoxContact(
    x: number,
    z: number,
    radius: number
  ): { nx: number; nz: number; penetration: number; partName: string } | null {
    let best: { nx: number; nz: number; penetration: number; partName: string } | null = null;

    for (const b of this.boxes) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      let dx = x - cx;
      let dz = z - cz;
      let d = Math.hypot(dx, dz);

      if (d > radius) continue;

      if (d < 1e-6) {
        // Centre is inside the box: leave through the nearest face.
        const toLeft = x - b.minX;
        const toRight = b.maxX - x;
        const toFront = z - b.minZ;
        const toBack = b.maxZ - z;
        const m = Math.min(toLeft, toRight, toFront, toBack);
        let nx = 0;
        let nz = 0;
        if (m === toLeft) nx = -1;
        else if (m === toRight) nx = 1;
        else if (m === toFront) nz = -1;
        else nz = 1;
        const penetration = radius + m;
        if (!best || penetration > best.penetration) best = { nx, nz, penetration, partName: b.key };
      } else {
        const penetration = radius - d;
        if (!best || penetration > best.penetration) {
          best = { nx: dx / d, nz: dz / d, penetration, partName: b.key };
        }
      }
    }

    return best;
  }

  /**
   * Rough blocking test kept for tools and scripted volumes; movement uses
   * `moveCapsule`. Water is not a blocker: the lake bed is ordinary terrain the
   * player may walk on.
   */
  public isBlocked(x: number, z: number, radius = 0.45): string | null {
    if (!this.hasGround(x, z)) return 'map_boundary';

    for (const b of this.boxes) {
      if (x >= b.minX - radius && x <= b.maxX + radius && z >= b.minZ - radius && z <= b.maxZ + radius) {
        return b.key;
      }
    }
    return null;
  }

  /**
   * Terrain height for the walk, without the exact-but-expensive fallback.
   *
   * Identical to `getGroundHeight` everywhere the heightfield has data, which is
   * everywhere the body can actually go: `hasGround` already refuses a step off
   * the rasterised field unless a prop is holding the body up. Off the field the
   * answer is the last height that *was* real, which is what the body should
   * stand at anyway — see `lastGroundY`.
   *
   * `getGroundHeight` is kept for the one-off queries that genuinely want the
   * exact surface: spawning, placing a hidden object, the debug view.
   */
  private groundNear(x: number, z: number): number {
    const field = this.heightField;
    if (field) {
      const h = sampleHeightField(field, x, z);
      if (h !== null) {
        this.lastGroundY = h;
        return h;
      }
    }
    return this.lastGroundY;
  }

  /** Terrain height at (x, z); returns 0 when no terrain is registered. */
  public getGroundHeight(x: number, z: number): number {
    const field = this.heightField;
    if (field) {
      const h = sampleHeightField(field, x, z);
      if (h !== null) return h;
    }
    return this.raycastGround(x, z);
  }

  /**
   * Terrain height at (x, z), or null where the map has no ground at all.
   *
   * The difference from `getGroundHeight` matters where a caller must stay
   * cheap: past the edge of the rasterised field that one falls back to an
   * exact raycast over every terrain triangle, which is the right answer for a
   * one-off query and far too expensive to run fifteen times a frame.
   */
  public terrainHeight(x: number, z: number): number | null {
    const field = this.heightField;
    if (!field) return null;
    return sampleHeightField(field, x, z);
  }

  /**
   * Height of whatever the body would stand on at (x, z) — terrain, or the
   * deck, ramp or bench above it — using the same support query as the move.
   *
   * Exposed so the walk can read the slope it is about to climb instead of the
   * one it just climbed; a heightfield lookup alone would see the sea floor
   * under a jetty and call every deck a cliff.
   */
  public groundAt(x: number, z: number, feetY: number, capsule = this.capsule): number {
    // `groundNear`, not `getGroundHeight`: this is asked once per frame by the
    // slope probe and by every NPC leg, and the exact fallback is the 6.2 ms
    // raycast this class exists to avoid.
    const terrain = this.groundNear(x, z);
    const support = this.supportHeight(x, z, feetY, capsule);
    return support !== null && support > terrain ? support : terrain;
  }

  /**
   * Finds a spot where the body can stand, near `hint`.
   *
   * A spawn point picked offline can only be a guess: it comes from bounding
   * boxes, and a bounding box does not know whether the inside of a building,
   * the bed of an excavation or the middle of a hedge is walkable. The
   * construction site spawned inside a 3 m deep pit and was pushed from every
   * direction at once, so it could not take a single step.
   *
   * The search asks the collision resolver itself — the same code the walk
   * uses — so a candidate is accepted only when a real capsule standing there
   * overlaps nothing. Rings widen until something is found; the returned point
   * is the nearest walkable ground to the hint.
   */
  public findSpawn(hint: { x: number; y?: number; z: number }, maxRadius = 28): THREE.Vector3 | null {
    const capsule = this.capsule;
    const RING_STEP = 1.5;
    const PER_RING = 12;
    /**
     * How much the floor may change within one body radius of the candidate.
     *
     * Just over one step, so a ramp or a kerb passes and a crate or a deck edge
     * does not: a body spawned on top of a 0.4 m box is not standing on the
     * ground, and one spawned at a ledge is half over a drop.
     */
    const SLOPE_TOLERANCE = 0.4;
    /**
     * How far the chosen floor may sit from the hint's own height, in metres.
     *
     * A little over one step, like the slope tolerance: the sidecar's y is the
     * level the floor was measured at, and a spawn a metre and a half below it is
     * not the same place — it is the foot of whatever the floor stands on.
     */
    const LEVEL_TOLERANCE = 1.2;
    /** How far to drop the reference when no surface is in reach, per pass. */
    const SETTLE_DROP = 0.6;
    const startY = Number.isFinite(hint.y) ? (hint.y as number) : this.getGroundHeight(hint.x, hint.z);

    /**
     * Height of whatever the body would end up standing on.
     *
     * The terrain is not the floor. The skatepark is a flat deck of
     * `skate-slab-tile` pieces laid over a sculpted bowl half a metre below:
     * measuring those slabs against the terrain turned every one of them into a
     * wall, and the nearest walkable ground was 21 m away at the map's edge.
     *
     * So the search settles the way the body does — start at the hint's height
     * and let the support query find the surface under it — and keeps dropping
     * by a body depth while the band is empty, which finds a deck up to six
     * metres down.
     */
    const floorAt = (x: number, z: number): number => {
      let ref = startY;
      for (let i = 0; i < 10; i++) {
        const support = this.geometry
          ? this.geometry.supportHeight(x, z, ref, capsule.stepHeight)
          : null;
        if (support !== null) {
          if (Math.abs(support - ref) < 1e-3) {
            return Math.max(support, this.getGroundHeight(x, z));
          }
          ref = support;
          continue;
        }
        ref -= SETTLE_DROP;
      }
      return this.getGroundHeight(x, z);
    };

    const walkable = (x: number, z: number, margin: number): number | null => {
      if (!this.hasGround(x, z)) return null;

      const ground = floorAt(x, z);
      if (!Number.isFinite(ground)) return null;

      // Reject cliff edges and stairs: the four neighbours must be close in
      // height, or the body spawns half over a drop.
      const probe = capsule.radius;
      for (const [dx, dz] of [[probe, 0], [-probe, 0], [0, probe], [0, -probe]]) {
        if (!this.hasGround(x + dx, z + dz)) return null;
        if (Math.abs(floorAt(x + dx, z + dz) - ground) > SLOPE_TOLERANCE) return null;
      }

      const feet = ground + 0.02;
      const head = feet + capsule.height;
      // Asking the resolver about an inflated body is the clearance test: with
      // reach = radius + margin, "no overlap" means the real body has `margin`
      // of air on every side.
      const reach = capsule.radius + margin;

      // Nothing may overlap the capsule where it stands.
      if (this.geometry) {
        const hit = this.geometry.deepestContact(
          x, z, reach, feet, head, capsule.stepHeight, _contact
        );
        if (hit && hit.penetration > capsule.skinWidth) return null;
      }

      if (this.deepestBoxContact(x, z, reach)) return null;

      return ground;
    };

    /**
     * Can the body actually leave?
     *
     * A metre of air on every side is worth nothing if the spot is a closed
     * pocket: the office map has such a pocket two metres from its floor
     * centre, and a spawn chosen on clearance alone landed there with all four
     * walk directions blocked. So the roomy pass also asks that at least two of
     * the four steps be free.
     */
    const canStepOut = (x: number, z: number): boolean => {
      let free = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (walkable(x + dx, z + dz, 0.45) !== null) free++;
        if (free >= 2) return true;
      }
      return false;
    };

    /** Exact number of free walk directions, without the early exit. */
    const exitCount = (x: number, z: number): number => {
      let free = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (walkable(x + dx, z + dz, 0.45) !== null) free++;
      }
      return free;
    };

    const search = (margin: number, needExit = false, level = LEVEL_TOLERANCE): THREE.Vector3 | null => {
      const onLevel = (ground: number) => Math.abs(ground - startY) <= level;

      const direct = walkable(hint.x, hint.z, margin);
      if (direct !== null && onLevel(direct) && (!needExit || canStepOut(hint.x, hint.z))) {
        return new THREE.Vector3(hint.x, direct, hint.z);
      }

      for (let r = RING_STEP; r <= maxRadius; r += RING_STEP) {
        const count = PER_RING + Math.floor(r / RING_STEP) * 2;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const x = hint.x + Math.cos(angle) * r;
          const z = hint.z + Math.sin(angle) * r;
          const ground = walkable(x, z, margin);
          if (ground === null) continue;
          if (!onLevel(ground)) continue;
          if (needExit && !canStepOut(x, z)) continue;
          return new THREE.Vector3(x, ground, z);
        }
      }
      return null;
    };

    // First look for room to breathe — a body that spawns with its nose against
    // a wall is not stuck, but it cannot take a step either, and the camera,
    // which sits a few metres behind, ends up inside the wall: the whole screen
    // becomes brick. Half a metre of clearance is enough to walk but not enough
    // to see, so the search asks for 1.2 m first, and only falls back to the
    // tight values when the entire neighbourhood is a corridor.
    //
    // Every tier also insists on the hint's own level. The hint is the centre of
    // the map's floor, and on a map built on a raised platform the ring search
    // used to take the first standable cell it met — which, on the outside of the
    // platform, is the ground at the bottom of the wall. That is how the Day of
    // the Dead town started the player two and a half metres below its own
    // square, on a slope, with the boom crushed to three metres. Walking around
    // the block is the right answer there; dropping off the edge is not.
    const chosen =
      search(1.2, true) ?? search(0.45) ?? search(0) ??
      // Only if nothing at the hint's height exists anywhere: an indoor map whose
      // sidecar recorded the floor above the one the player stands on.
      search(1.2, true, Infinity) ?? search(0.45, false, Infinity) ?? search(0, false, Infinity);
    if (!chosen) return null;

    // The tight tiers do not ask for a way out, so a dense map can land on a
    // spot that walks in one direction only — which reads as being stuck even
    // though nothing overlaps the body. Tightening the tiers would move the
    // spawn on maps that are already fine, so the winner is re-checked instead
    // and only a hemmed-in one is replaced, by the nearest spot with more ways
    // out. No current map needs it (all twenty-one resolve to at least two);
    // it is here because a new kit can be denser than any of these.
    if (exitCount(chosen.x, chosen.z) >= 2) return chosen;

    let bestPoint: THREE.Vector3 | null = null;
    let bestFree = exitCount(chosen.x, chosen.z);
    for (let r = RING_STEP; r <= maxRadius; r += RING_STEP) {
      const count = PER_RING + Math.floor(r / RING_STEP) * 2;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const x = hint.x + Math.cos(angle) * r;
        const z = hint.z + Math.sin(angle) * r;
        const ground = walkable(x, z, 0);
        if (ground === null) continue;
        const free = exitCount(x, z);
        if (free > bestFree) {
          bestFree = free;
          bestPoint = new THREE.Vector3(x, ground, z);
          if (free >= 3) return bestPoint;
        }
      }
    }
    return bestPoint ?? chosen;
  }

  /** Exact but slow; only used outside the rasterised field. */
  private raycastGround(x: number, z: number): number {
    if (this.terrainMeshes.length === 0) return 0;

    const origin = new THREE.Vector3(x, 100, z);
    this.raycaster.set(origin, this.downVector);
    this.raycaster.far = 400;

    // Several ground meshes may overlap (slabs over a terrain sheet): the body
    // stands on the highest one, matching how the heightfield is built.
    let best = -Infinity;
    for (const mesh of this.terrainMeshes) {
      const hits = this.raycaster.intersectObject(mesh, false);
      if (hits.length > 0 && hits[0].point && hits[0].point.y > best) best = hits[0].point.y;
    }
    return Number.isFinite(best) ? best : 0;
  }
}

/**
 * Rasterises the terrain meshes into one height grid by projecting each
 * triangle onto the XZ plane, so `getGroundHeight` becomes a bilinear lookup
 * instead of a full-mesh raycast.
 *
 * All meshes share one grid: the play area is the union of their bounds, and
 * where two of them overlap the higher surface wins, which is how a slab laid
 * over a terrain sheet stays walkable.
 */
function buildHeightField(meshes: THREE.Mesh[]): HeightField | null {
  const usable: { mesh: THREE.Mesh; pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; index: any }[] = [];
  const box = new THREE.Box3();

  for (const mesh of meshes) {
    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.getAttribute('position');
    if (!pos) continue;
    mesh.updateMatrixWorld(true);
    usable.push({ mesh, pos, index: geom.getIndex() });
    box.expandByObject(mesh);
  }
  if (usable.length === 0) return null;

  const width = box.max.x - box.min.x;
  const depth = box.max.z - box.min.z;
  if (!(width > 0) || !(depth > 0)) return null;

  const SIZE = 512;
  const cell = Math.max(width, depth) / SIZE;
  const data = new Float32Array(SIZE * SIZE).fill(NaN);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (const { mesh, pos, index } of usable) {
    const matrix = mesh.matrixWorld;
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos as THREE.BufferAttribute, ia).applyMatrix4(matrix);
      b.fromBufferAttribute(pos as THREE.BufferAttribute, ib).applyMatrix4(matrix);
      c.fromBufferAttribute(pos as THREE.BufferAttribute, ic).applyMatrix4(matrix);

      // Degenerate in the XZ plane (a vertical wall) cannot own a ground cell.
      const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
      if (Math.abs(area) < 1e-9) continue;

      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - box.min.x) / cell));
      const i1 = Math.min(SIZE - 1, Math.ceil((Math.max(a.x, b.x, c.x) - box.min.x) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - box.min.z) / cell));
      const j1 = Math.min(SIZE - 1, Math.ceil((Math.max(a.z, b.z, c.z) - box.min.z) / cell));

      for (let j = j0; j <= j1; j++) {
        const pz = box.min.z + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const px = box.min.x + (i + 0.5) * cell;
          const w0 = ((b.x - px) * (c.z - pz) - (c.x - px) * (b.z - pz)) / area;
          const w1 = ((c.x - px) * (a.z - pz) - (a.x - px) * (c.z - pz)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const y = w0 * a.y + w1 * b.y + w2 * c.y;
          const k = j * SIZE + i;
          // Highest surface wins: the ground is a heightfield, not an overhang.
          if (Number.isNaN(data[k]) || y > data[k]) data[k] = y;
        }
      }
    }
  }

  return { data, size: SIZE, minX: box.min.x, minZ: box.min.z, cell };
}

/** Bilinear lookup; null when the point is outside the rasterised area. */
function sampleHeightField(field: HeightField, x: number, z: number): number | null {
  const fx = (x - field.minX) / field.cell - 0.5;
  const fz = (z - field.minZ) / field.cell - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const size = field.size;
  if (i < 0 || j < 0 || i >= size - 1 || j >= size - 1) return null;

  const tx = fx - i;
  const tz = fz - j;
  const d = field.data;

  const h00 = d[j * size + i];
  const h10 = d[j * size + i + 1];
  const h01 = d[(j + 1) * size + i];
  const h11 = d[(j + 1) * size + i + 1];

  const n = (Number.isNaN(h00) ? 0 : 1) + (Number.isNaN(h10) ? 0 : 1)
    + (Number.isNaN(h01) ? 0 : 1) + (Number.isNaN(h11) ? 0 : 1);
  if (n === 0) return null;
  if (n < 4) {
    // Edge of the rasterised area: average what exists rather than inventing.
    let sum = 0;
    if (!Number.isNaN(h00)) sum += h00;
    if (!Number.isNaN(h10)) sum += h10;
    if (!Number.isNaN(h01)) sum += h01;
    if (!Number.isNaN(h11)) sum += h11;
    return sum / n;
  }

  const top = h00 * (1 - tx) + h10 * tx;
  const bottom = h01 * (1 - tx) + h11 * tx;
  return top * (1 - tz) + bottom * tz;
}
