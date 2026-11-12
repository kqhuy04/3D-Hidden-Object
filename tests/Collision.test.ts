import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { CollisionGeometry } from '../src/game/world/CollisionGeometry';
import { WorldCollision, CapsuleConfig } from '../src/game/world/WorldCollision';
import { GAME_CONFIG } from '../src/data/gameConfig';

const CAPSULE: CapsuleConfig = {
  radius: GAME_CONFIG.player.capsuleRadius,
  height: GAME_CONFIG.player.capsuleHeight,
  stepHeight: GAME_CONFIG.player.stepHeight,
  skinWidth: GAME_CONFIG.player.skinWidth,
};

const mat = new THREE.MeshBasicMaterial();

function box(w: number, h: number, d: number, x: number, y: number, z: number, name: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.name = name;
  m.position.set(x, y, z);
  m.updateMatrixWorld(true);
  return m;
}

/** A chair built from real parts: seat slab, back rest and four legs. */
function makeChair(x = 0, z = 0): THREE.Group {
  const chair = new THREE.Group();
  chair.name = 'test-chair';
  chair.position.set(x, 0, z);

  chair.add(box(0.5, 0.06, 0.5, 0, 0.45, 0, 'chair-seat'));
  chair.add(box(0.5, 0.5, 0.06, 0, 0.72, -0.22, 'chair-back'));

  const legX = 0.22;
  const legZ = 0.22;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      chair.add(box(0.05, 0.44, 0.05, sx * legX, 0.22, sz * legZ, 'chair-leg'));
    }
  }
  chair.updateMatrixWorld(true);
  return chair;
}

/** Two posts 1.2 m apart with a lintel above head height: a passable doorway. */
function makeGate(x = 0, z = 0): THREE.Group {
  const gate = new THREE.Group();
  gate.name = 'test-gate';
  gate.position.set(x, 0, z);
  for (const sx of [-1, 1]) {
    gate.add(box(0.12, 2.4, 0.12, sx * 0.6, 1.2, 0, 'gate-post'));
  }
  // Above capsule height (1.75 m) so it must not block the body.
  gate.add(box(1.32, 0.15, 0.15, 0, 2.35, 0, 'gate-lintel'));
  gate.updateMatrixWorld(true);
  return gate;
}

function makeWorld(parts: THREE.Object3D[], ground?: THREE.Mesh): WorldCollision {
  const collision = new WorldCollision();

  // Flat ground, same convention as the game's terrain mesh.
  if (!ground) {
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    groundGeo.rotateX(-Math.PI / 2);
    ground = new THREE.Mesh(groundGeo, mat);
    ground.name = 'ground';
    ground.updateMatrixWorld(true);
  }
  collision.setTerrainMesh(ground);

  const root = new THREE.Group();
  root.name = 'kit-composition';
  for (const p of parts) root.add(p);
  root.updateMatrixWorld(true);

  const geometry = new CollisionGeometry();
  geometry.build(root, (x, z) => collision.getGroundHeight(x, z));
  collision.setCollisionGeometry(geometry);
  collision.setCapsule(CAPSULE);
  return collision;
}

/** Terrain whose height follows `fn`, so slopes can be tested, not just planes. */
function slopedGround(fn: (x: number, z: number) => number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(200, 200, 80, 80);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, fn(pos.getX(i), pos.getZ(i)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground';
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** One compound prop made of boxes. */
function prop(name: string, boxes: THREE.Mesh[]): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  for (const b of boxes) g.add(b);
  g.updateMatrixWorld(true);
  return g;
}

/**
 * Walk in a straight line until blocked or the distance is consumed.
 *
 * The body height is passed through on every call, exactly as the controller
 * does: without it the resolver measures the collision band from the terrain,
 * which is the ground *under* a deck rather than the deck the body stands on.
 */
function walk(collision: WorldCollision, from: THREE.Vector3, dir: THREE.Vector2, distance: number, steps = 40): THREE.Vector3 {
  let pos = from.clone();
  const per = distance / steps;
  for (let i = 0; i < steps; i++) {
    pos = collision.moveCapsule(pos, new THREE.Vector3(dir.x * per, 0, dir.y * per), CAPSULE, pos.y).position;
  }
  return pos;
}

describe('CollisionGeometry classification', () => {
  it('keeps solid props and drops decorative meshes', () => {
    const geo = new CollisionGeometry();
    const root = new THREE.Group();
    const chair = makeChair();
    root.add(chair);
    const reeds = new THREE.Group();
    reeds.name = 'clump-1-reeds';
    reeds.add(box(1, 1, 1, 0, 0.5, 0, 'clump-1-reeds'));
    root.add(reeds);
    const canopy = new THREE.Group();
    canopy.name = 'campground-pine-stand';
    canopy.add(box(6, 1, 6, 0, 8, 0, 'crown-1-needles'));
    root.add(canopy);
    root.updateMatrixWorld(true);

    geo.build(root);
    const names = geo.partStats.map((p) => p.name);
    expect(names).toContain('test-chair');
    expect(names).not.toContain('clump-1-reeds');
    expect(geo.stats.skippedMeshes).toBeGreaterThanOrEqual(2);
    expect(geo.stats.triangles).toBeGreaterThan(0);
  });

  it('skips sub-15cm surface detail', () => {
    const geo = new CollisionGeometry();
    const root = new THREE.Group();
    const part = new THREE.Group();
    part.name = 'table';
    part.add(box(0.04, 0.04, 0.04, 0, 0.5, 0, 's-hook-pan'));
    root.add(part);
    root.updateMatrixWorld(true);
    geo.build(root);
    expect(geo.partStats).toHaveLength(0);
  });
});

describe('Capsule collision against a chair', () => {
  let collision: WorldCollision;

  beforeEach(() => {
    collision = makeWorld([makeChair(0, 0)]);
  });

  it('stops at the seat edge, not at an inflated bounding box', () => {
    const start = new THREE.Vector3(0, 0, 2);
    const end = walk(collision, start, new THREE.Vector2(0, -1), 4);

    // Seat spans z -0.25..0.25, so the player must stop at 0.25 + radius.
    expect(end.z).toBeGreaterThan(0.25 + CAPSULE.radius - 0.03);
    expect(end.z).toBeLessThan(0.25 + CAPSULE.radius + 0.08);
  });

  it('never lets the player stand inside the seat footprint from any approach angle', () => {
    // The player is a circle, so the invariant is distance-to-rectangle, not a
    // per-axis box: on a 45 degree approach the body correctly rests against
    // the seat *corner*, where |x| and |z| are both ~0.48 but the circle is
    // still fully clear of the slab.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const start = new THREE.Vector3(Math.sin(a) * 2, 0, Math.cos(a) * 2);
      const dir = new THREE.Vector2(-Math.sin(a), -Math.cos(a));
      const end = walk(collision, start, dir, 4);

      const cx = Math.max(-0.25, Math.min(end.x, 0.25));
      const cz = Math.max(-0.25, Math.min(end.z, 0.25));
      const clearance = Math.hypot(end.x - cx, end.z - cz) - CAPSULE.radius;

      // Never overlapping the seat slab...
      expect(clearance).toBeGreaterThanOrEqual(-0.001);
      // ...and never through it: still on the near side of the chair centre.
      expect(end.x * dir.x + end.z * dir.y).toBeLessThan(0);
    }
  });

  it('blocks the back rest from behind', () => {
    const end = walk(collision, new THREE.Vector3(0, 0, -2), new THREE.Vector2(0, 1), 4);
    expect(end.z).toBeLessThan(-0.25 - CAPSULE.radius + 0.03);
  });

  it('is blocked by the legs when the gap is narrower than the player', () => {
    // Legs sit at x +/-0.22 with 0.05 width: 0.39 m gap, player is 0.6 m wide.
    const end = walk(collision, new THREE.Vector3(0, 0, 1.2), new THREE.Vector2(0, -1), 3);
    expect(end.z).toBeGreaterThan(0.5);
  });

  it('does not jitter while pushing into the seat', () => {
    const first = walk(collision, new THREE.Vector3(0, 0, 1.5), new THREE.Vector2(0, -1), 3);
    const second = walk(collision, first, new THREE.Vector2(0, -1), 1);
    const third = walk(collision, second, new THREE.Vector2(0, -1), 1);
    expect(Math.abs(second.z - first.z)).toBeLessThan(0.01);
    expect(Math.abs(third.z - first.z)).toBeLessThan(0.01);
  });
});

describe('Capsule collision: gaps, sliding, speed', () => {
  it('walks through a gap wider than the capsule', () => {
    const collision = makeWorld([makeGate(0, 0)]);
    const end = walk(collision, new THREE.Vector3(0, 0, 2), new THREE.Vector2(0, -1), 4);
    expect(end.z).toBeLessThan(-0.5);
  });

  it('is blocked by a gap narrower than the capsule', () => {
    const narrow = makeGate(0, 0);
    // Move the posts inwards: 0.3 m gap, narrower than the 0.6 m capsule.
    const posts = narrow.children.filter((c) => c.name === 'gate-post');
    posts[0].position.x = -0.21;
    posts[1].position.x = 0.21;
    narrow.updateMatrixWorld(true);
    const collision = makeWorld([narrow]);
    const end = walk(collision, new THREE.Vector3(0, 0, 2), new THREE.Vector2(0, -1), 4);
    expect(end.z).toBeGreaterThan(0.1);
  });

  it('slides along a wall instead of stopping dead', () => {
    const collision = makeWorld([
      (() => {
        const wall = new THREE.Group();
        wall.name = 'test-wall';
        wall.add(box(0.2, 3, 20, 1, 1.5, 0, 'wall-panel'));
        wall.updateMatrixWorld(true);
        return wall;
      })(),
    ]);

    // Push diagonally into the wall: forward progress along Z must survive.
    const start = new THREE.Vector3(0, 0, 0);
    const end = walk(collision, start, new THREE.Vector2(1, 1).normalize(), 4);
    expect(end.x).toBeLessThan(1 - CAPSULE.radius + 0.05);
    expect(end.z).toBeGreaterThan(1.5);
  });

  it('does not tunnel through a thin wall at high speed', () => {
    const collision = makeWorld([
      (() => {
        const wall = new THREE.Group();
        wall.name = 'thin-wall';
        wall.add(box(10, 3, 0.08, 0, 1.5, 0, 'wall-panel'));
        wall.updateMatrixWorld(true);
        return wall;
      })(),
    ]);

    // 6 m in a single call: far more than the 0.08 m wall thickness.
    const end = collision.moveCapsule(new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 0, -6), CAPSULE).position;
    expect(end.z).toBeGreaterThan(0.04 + CAPSULE.radius - 0.02);
  });

  it('steps over low obstacles below stepHeight', () => {
    const collision = makeWorld([
      (() => {
        const kerb = new THREE.Group();
        kerb.name = 'low-kerb';
        kerb.add(box(2, 0.2, 2, 0, 0.1, 0, 'kerb-body'));
        kerb.updateMatrixWorld(true);
        return kerb;
      })(),
    ]);
    const end = walk(collision, new THREE.Vector3(0, 0, 2), new THREE.Vector2(0, -1), 4);
    expect(end.z).toBeLessThan(-0.5);
  });

  it('cannot leave the map at the terrain edge', () => {
    // The boundary is the terrain itself, not a square. Past the edge the
    // heightfield has no data and the ground would silently read as 0, so the
    // player must be stopped before stepping off it.
    const collision = makeWorld([makeChair(0, 0)]);
    const end = walk(collision, new THREE.Vector3(97, 0, 0), new THREE.Vector2(1, 0), 6);
    expect(end.x).toBeLessThan(99.9);
    expect(end.x).toBeGreaterThan(96);
  });
});

/**
 * Three defects reported from play, each pinned by the mechanism that caused it.
 */
describe('Collision regressions: jitter, decks and the waterline', () => {
  it('never reports more than one radius of penetration for an outside point', () => {
    // Invariant guard. A wall's end cap is a triangle with three (nearly)
    // identical x values: in the XZ plane it is a line, not an area, so the
    // "is the centre inside this triangle" test is decided by round-off. When
    // it says yes, the body is pushed away with penetration = radius + distance
    // instead of radius - distance. The invariant: for any point outside a
    // solid footprint the push can never exceed the radius, because only the
    // "inside" branch adds distance.
    //
    // A synthetic box does not reproduce the round-off (its degenerate
    // triangles keep mixed signs), so this test alone would not have caught the
    // amphitheatre ejection. That reproduction is measured against the real
    // scene instead — see docs/COLLISION_OVERHAUL.md.
    const wall = prop('test-wall-end', [box(0.2, 3, 2, 0, 1.5, 0, 'wall-panel')]);
    const collision = makeWorld([wall]);
    const geo = collision.getCollisionGeometry()!;
    const out = {
      nx: 0, nz: 0, penetration: 0, point: new THREE.Vector3(), partName: '',
    };

    let worst = 0;
    let worstAt = '';
    for (let x = -1; x <= 1.0001; x += 0.05) {
      for (let z = -1.5; z <= 1.5001; z += 0.05) {
        // Skip points genuinely inside the box footprint: those may report
        // radius + distance, which is correct.
        if (Math.abs(x) <= 0.1 && Math.abs(z) <= 1) continue;
        const hit = geo.deepestContact(x, z, CAPSULE.radius, 0, CAPSULE.height, CAPSULE.stepHeight, out);
        if (hit && hit.penetration > worst) {
          worst = hit.penetration;
          worstAt = `(${x.toFixed(2)}, ${z.toFixed(2)})`;
        }
      }
    }

    expect(worstAt).not.toBe('');
    expect(worst).toBeLessThanOrEqual(CAPSULE.radius + 1e-6);
  });

  it('stops dead at a rail that sits just under the step height, on a slope', () => {
    // The reported jitter: a horizontal rail 0.34 m above the ground, met while
    // walking down a slope. Measured against the player's own ground the rail
    // is "step over" uphill of the contact point and "wall" downhill of it, so
    // it flips every frame: the body is pushed back up the slope, which
    // re-enables the step-over, which lets it walk down again. Measured against
    // the ground the rail itself stands on, it is always a wall.
    const slope = (x: number, z: number) => -0.25 * z;
    const ground = slopedGround(slope);
    const railTop = slope(0, 0.6) + 0.34;
    const rail = prop('test-rail', [
      box(4, 0.1, 0.2, 0, railTop - 0.05, 1.0, 'rail-top'),
    ]);
    const collision = makeWorld([rail], ground);

    let pos = new THREE.Vector3(0, slope(0, -0.5), -0.5);
    const zs: number[] = [];
    for (let i = 0; i < 60; i++) {
      pos = collision.moveCapsule(pos, new THREE.Vector3(0, 0, 0.06), CAPSULE).position;
      zs.push(pos.z);
    }

    // Stopped at the rail, not past it.
    expect(pos.z).toBeLessThan(1.0);
    expect(pos.z).toBeGreaterThan(0.3);

    // And stopped: the last 15 frames do not move. Before the fix this span
    // contained a full out-and-back cycle of several centimetres.
    const tail = zs.slice(-15);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.002);
  });

  it('keeps the body on a plank deck instead of dropping through the gaps', () => {
    // Deck of two slabs with a 10 cm gap, 0.2 m above the ground. A single point
    // sample lands in the gap and reports no support, so the body sinks to the
    // terrain — and the deck top is then above the feet, so the deck blocks the
    // very body standing in it. A 0.3 m foot cannot fall through a 10 cm gap.
    const deck = prop('test-deck', [
      box(2, 0.1, 0.23, 0, 0.15, 0.615, 'deck-slab-a'), // z 0.50..0.73
      box(2, 0.1, 0.37, 0, 0.15, 1.015, 'deck-slab-b'), // z 0.83..1.20
    ]);
    const collision = makeWorld([deck]);

    let pos = new THREE.Vector3(0, 0, 0);
    let minOnDeck = Infinity;
    let framesOnDeck = 0;
    for (let i = 0; i < 40; i++) {
      pos = collision.moveCapsule(pos, new THREE.Vector3(0, 0, 0.06), CAPSULE).position;
      if (pos.z > 0.5 && pos.z < 1.3) {
        framesOnDeck++;
        minOnDeck = Math.min(minOnDeck, pos.y);
      }
    }

    expect(framesOnDeck).toBeGreaterThan(5);
    // Walked on top of the deck, never down into the gap at z 0.73..0.83.
    expect(minOnDeck).toBeGreaterThan(0.15);
    // And crossed the deck rather than being stopped by it.
    expect(pos.z).toBeGreaterThan(1.3);
  });

  it('walks into the lake instead of being stopped at the shoreline', () => {
    // Water is walkable by design: the lake bed is terrain and the player asked
    // to be able to wade out. The old rule refused every wet sub-step, which
    // turned the whole shoreline into an invisible wall.
    const shore = (x: number, z: number) => Math.min(0, -(z - 1) * 0.8);
    const collision = makeWorld([], slopedGround(shore));

    const start = new THREE.Vector3(0, shore(0, 5), 5);
    const dir = new THREE.Vector2(1, 1).normalize();
    let pos = start.clone();
    for (let i = 0; i < 30; i++) {
      pos = collision
        .moveCapsule(pos, new THREE.Vector3(dir.x * 0.06, 0, dir.y * 0.06), CAPSULE)
        .position;
    }

    // Crossed the old waterline (ground reaches -3.75 m at z = 5.69)...
    expect(pos.z).toBeGreaterThan(6.2);
    // ...and stands on the bed rather than floating above it.
    expect(pos.y).toBeLessThan(-3.75);
    expect(pos.y).toBeCloseTo(shore(pos.x, pos.z), 2);
  });

  it('passes over a low obstacle while the body is above it, and reports it as the landing', () => {
    // The reported "bounding box straight to the sky": the band was measured
    // from the ground under the player, so a 0.4 m bench blocked a body that
    // was already 0.56 m in the air. `bodyFeetY` moves the band with the body.
    const bench = prop('test-bench', [
      box(2, 0.4, 0.6, 0, 0.2, 0, 'bench-seat'),
    ]);
    const collision = makeWorld([bench]);
    const start = new THREE.Vector3(0, 0, 2);
    const move = new THREE.Vector3(0, 0, -0.06);

    // On the ground it blocks, as it should.
    let grounded = start.clone();
    for (let i = 0; i < 40; i++) {
      grounded = collision.moveCapsule(grounded, move, CAPSULE).position;
    }
    expect(grounded.z).toBeGreaterThan(0.3);
    expect(grounded.y).toBeCloseTo(0, 2);

    // At the jump's apex the same bench is below the feet and must not block:
    // the full 2.4 m walk completes, ending well past the bench at z = -0.4.
    let airborne = start.clone();
    for (let i = 0; i < 40; i++) {
      airborne = collision.moveCapsule(airborne, move, CAPSULE, 0.56).position;
    }
    expect(airborne.z).toBeLessThan(-0.3);

    // The reported height is the surface the body would land on — the bench top
    // here — not the terrain 0.4 m below it. The query is anchored on the body,
    // which is what lets it see a roof: anchored on the ground, everything more
    // than one step above the terrain is invisible, and a body dropped onto a
    // roof falls straight through it.
    expect(airborne.y).toBeCloseTo(0.4, 2);
  });

  it('walks up a ramp whose deck stands well above the ground beneath it', () => {
    // The creek footbridge: a tessellated deck rising 8 cm per 0.2 m section,
    // 1 m above the creek bed. Measured against the bed each section stands far
    // above stepHeight, and each one is more than the 5 cm floor tolerance
    // above the feet, so the old rule called the next section a wall and the
    // body stopped at the first plank — the bridge could not be crossed at all.
    const rampGeo = new THREE.PlaneGeometry(2, 4, 1, 20);
    rampGeo.rotateX(-Math.PI / 2);
    const rp = rampGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) {
      rp.setY(i, (rp.getZ(i) + 2) * 0.4); // 22°, still standable
    }
    rp.needsUpdate = true;
    rampGeo.computeBoundingBox();
    rampGeo.computeBoundingSphere();

    const ramp = new THREE.Mesh(rampGeo, mat);
    ramp.name = 'ramp-deck';
    ramp.position.set(0, 0, 2);
    const deck = prop('test-ramp', [ramp]);
    const collision = makeWorld([deck], slopedGround(() => -1));

    const pos = walk(collision, new THREE.Vector3(0, 0.12, 0.3), new THREE.Vector2(0, 1), 3.0, 40);

    // Crossed the ramp rather than being stopped by its first section...
    expect(pos.z).toBeGreaterThan(2.6);
    // ...and climbed it: 0.4 m of rise per metre walked.
    expect(pos.y).toBeGreaterThan(0.9);
  });
});
