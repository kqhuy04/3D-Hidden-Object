import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { PlayerController } from '../src/game/player/PlayerController';
import { CharacterAnimator } from '../src/game/player/CharacterAnimator';
import { WorldCollision } from '../src/game/world/WorldCollision';
import { GAME_CONFIG } from '../src/data/gameConfig';

describe('PlayerController', () => {
  let playerGroup: THREE.Group;
  let characterMesh: THREE.Object3D;
  let animator: CharacterAnimator;
  let collision: WorldCollision;
  let controller: PlayerController;

  beforeEach(() => {
    playerGroup = new THREE.Group();
    characterMesh = new THREE.Object3D();
    playerGroup.add(characterMesh);

    animator = new CharacterAnimator(characterMesh);
    collision = new WorldCollision();

    // Create a flat ground mesh
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial());
    groundMesh.position.set(0, 0, 0);
    groundMesh.updateMatrixWorld(true);
    collision.setTerrainMesh(groundMesh);

    controller = new PlayerController(playerGroup, animator, collision);
    controller.setPosition(0, 0, 0);
  });

  it('moves player forward along camera direction', () => {
    // Camera yaw = 0 places the camera at player + (0, +distance), i.e. on the
    // +Z side looking toward -Z, so "forward" walks toward -Z (into the screen).
    // Input (0, 1) -> W forward
    controller.update(new THREE.Vector2(0, 1), 0, 0.1);

    const pos = controller.getPosition();
    expect(pos.z).toBeLessThan(0);
    expect(pos.x).toBeCloseTo(0, 1);
  });

  it('diagonal movement is normalized and does not exceed straight speed', () => {
    // Straight movement (0, 1) for 1 second
    controller.setPosition(0, 0, 0);
    controller.update(new THREE.Vector2(0, 1), 0, 1.0);
    const straightDist = controller.getPosition().length();

    // Diagonal movement (1, 1) for 1 second
    controller.setPosition(0, 0, 0);
    controller.update(new THREE.Vector2(1, 1), 0, 1.0);
    const diagonalDist = controller.getPosition().length();

    expect(diagonalDist).toBeCloseTo(straightDist, 2);
  });

  it('prevents player from walking through solid obstacles', () => {
    // Add an obstacle box at (0, 0, 2)
    collision.addObstacleBox({
      key: 'solid_cabin',
      minX: -2,
      maxX: 2,
      minZ: 1.0,
      maxZ: 4.0,
      minY: 0,
      maxY: 5,
    });

    controller.setPosition(0, 0, 0);

    // Try moving forward directly into the obstacle
    // Camera on the -Z side (yaw = PI) so "forward" walks toward +Z, into the box
    controller.update(new THREE.Vector2(0, 1), Math.PI, 1.0);

    // Blocked at box.minZ minus the capsule radius, never inside the box.
    const stopZ = 1.0 - GAME_CONFIG.player.capsuleRadius;
    expect(controller.getPosition().z).toBeLessThanOrEqual(stopZ + 0.01);
    expect(controller.getPosition().z).toBeGreaterThan(0.5);
  });

  it('stops at the edge of the terrain instead of walking into empty space', () => {
    // The boundary is the terrain mesh, not a square: past its edge the ground
    // reads as 0 and the body would float out over nothing.
    controller.setPosition(49.2, 0, 0);

    for (let i = 0; i < 60; i++) {
      controller.update(new THREE.Vector2(1, 0), 0, 1 / 60);
    }

    const x = controller.getPosition().x;
    expect(x).toBeGreaterThan(49);
    expect(x).toBeLessThan(50);
  });

  it('falls off a ledge instead of snapping down a whole step in one frame', () => {
    // A 0.35 m drop used to be glued to the ground in a single frame, which is
    // the flicker seen when stepping off the edge of a dock.
    controller.setPosition(5, 0.3, 5);

    controller.update(new THREE.Vector2(0, 0), 0, 1 / 60);
    expect(controller.getPosition().y).toBeGreaterThan(0.25); // still airborne

    for (let i = 0; i < 60; i++) {
      controller.update(new THREE.Vector2(0, 0), 0, 1 / 60);
    }
    expect(controller.getPosition().y).toBeCloseTo(0, 2);
  });

  it('stays glued to a small step down', () => {
    // A slope or a kerb must not make the body airborne on every frame.
    controller.setPosition(5, 0.1, 5);

    controller.update(new THREE.Vector2(0, 0), 0, 1 / 60);
    expect(controller.getPosition().y).toBeCloseTo(0, 2);
  });

  it('falls to the terrain instead of teleporting down to it', () => {
    controller.setPosition(5, 10, 5); // Floating in air

    // A 10 m drop is integrated under gravity, not snapped: the body is still
    // airborne after one frame...
    controller.update(new THREE.Vector2(0, 0), 0, 1 / 60);
    expect(controller.getPosition().y).toBeGreaterThan(1);

    // ...and has landed on the terrain within a couple of seconds.
    for (let i = 0; i < 240; i++) {
      controller.update(new THREE.Vector2(0, 0), 0, 1 / 60);
    }
    expect(controller.getPosition().y).toBeCloseTo(0, 2);
  });
});

/**
 * The stair clips are for stairs.
 *
 * Reported from play: walking down the western map's ravine played the
 * stair-descent cycle. The ravine is a wall of jagged low-poly ground that the
 * body creeps along at 2 cm a frame while the surface under it drops 9-17 cm —
 * stair-shaped, but not a staircase.
 */
describe('stair gait', () => {
  /** A fresh controller per case: `resolveGait` holds its last stair answer. */
  const gaitOf = (travelled: number, rise: number): string => {
    const group = new THREE.Group();
    const animator = new CharacterAnimator(new THREE.Object3D());
    const collider = new WorldCollision();
    const c = new PlayerController(group, animator, collider);
    return (c as unknown as { resolveGait: (t: number, r: number) => string }).resolveGait(
      travelled,
      rise
    );
  };

  it('ignores the small drops of a slope or a ravine', () => {
    expect(gaitOf(0.02, -0.09)).toBe('flat'); // ravine creep
    expect(gaitOf(0.02, -0.166)).toBe('flat');
    expect(gaitOf(0.053, -0.044)).toBe('flat'); // a 40 degree hillside
  });

  it('plays the stair cycle for a real riser', () => {
    expect(gaitOf(0.05, -0.35)).toBe('down');
    expect(gaitOf(0.05, 0.42)).toBe('up');
  });

  it('treats a drop bigger than any step as a fall, not a stair', () => {
    expect(gaitOf(0.05, -0.9)).toBe('flat');
  });
});
