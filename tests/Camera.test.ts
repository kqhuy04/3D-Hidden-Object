import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../src/game/player/CameraController';
import { WorldCollision } from '../src/game/world/WorldCollision';
import { GAME_CONFIG } from '../src/data/gameConfig';

/**
 * A camera that only knows about one wall, `limit` metres behind the body.
 *
 * The judder this file guards against is not about which geometry the ray hits
 * — it is about what the controller does with the answer, so a stub is the right
 * instrument: it lets a test change the answer in a single frame, which is the
 * worst case a real map can produce when the ray grazes a corner.
 */
function makeCamera(limit: { value: number }) {
  (globalThis as unknown as { window: unknown }).window = { addEventListener() {} };
  const camera = new THREE.PerspectiveCamera();
  const cam = new CameraController(
    camera,
    { addEventListener() {} } as unknown as HTMLElement
  );
  const stub = {
    cameraDistance: () => limit.value,
    terrainHeight: () => null,
    getGroundHeight: () => 0,
  } as unknown as WorldCollision;
  cam.setCollision(stub);
  return { cam, camera };
}

const body = () => new THREE.Vector3(0, 0, 0);

describe('camera boom', () => {
  it('extends to the configured distance when nothing is in the way', () => {
    const limit = { value: 100 };
    const { cam, camera } = makeCamera(limit);
    for (let i = 0; i < 240; i++) cam.update(body(), 1 / 60, 0);

    const boom = camera.position.distanceTo(cam.currentLookAt);
    expect(boom).toBeCloseTo(GAME_CONFIG.camera.defaultDistance, 1);
  });

  it('retracts in front of a wall without teleporting', () => {
    const limit = { value: 100 };
    const { cam, camera } = makeCamera(limit);
    for (let i = 0; i < 240; i++) cam.update(body(), 1 / 60, 0);

    // A wall appears 0.8 m behind the chest — the `cozy-farm` case, where the
    // player backs into a fence.
    limit.value = 0.8;

    let prev = camera.position.clone();
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      cam.update(body(), 1 / 60, 0);
      worst = Math.max(worst, camera.position.distanceTo(prev));
      prev.copy(camera.position);
    }

    // The old controller snapped the lens to the wall and then lerped towards
    // it, which moved the camera 4.5 m in a single frame on `cozy-farm` and
    // 7.2 m once the snap was made unconditional.
    expect(worst).toBeLessThan(0.5);
    // A wall 0.8 m away is closer than the shortest boom, so the boom stops at
    // the floor rather than following the wall into the character's head.
    const boom = camera.position.distanceTo(cam.currentLookAt);
    expect(boom).toBeLessThan(1.2);
    expect(boom).toBeGreaterThan(1.0);
  });

  it('rises instead of zooming into the character when the boom is squeezed', () => {
    const limit = { value: 100 };
    const { cam, camera } = makeCamera(limit);
    for (let i = 0; i < 240; i++) cam.update(body(), 1 / 60, 0);
    const freeAngle = Math.asin(
      (camera.position.y - cam.currentLookAt.y) / camera.position.distanceTo(cam.currentLookAt)
    );

    limit.value = 0.9;
    for (let i = 0; i < 240; i++) cam.update(body(), 1 / 60, 0);
    const boom = camera.position.distanceTo(cam.currentLookAt);
    const squeezedAngle = Math.asin((camera.position.y - cam.currentLookAt.y) / boom);

    // A metre behind the head at the user's pitch is a hat filling the screen.
    // The lift swings the camera up so the view looks down over the character.
    expect(squeezedAngle).toBeGreaterThan(freeAngle + 0.4);
    // And it is still a real third-person distance, not a lens in the hair.
    expect(boom).toBeGreaterThan(1.0);
  });

  it('never moves in and out while the obstruction holds still', () => {
    const limit = { value: 100 };
    const { cam, camera } = makeCamera(limit);
    for (let i = 0; i < 240; i++) cam.update(body(), 1 / 60, 0);

    limit.value = 2.0;
    const booms: number[] = [];
    for (let i = 0; i < 180; i++) {
      cam.update(body(), 1 / 60, 0);
      booms.push(camera.position.distanceTo(cam.currentLookAt));
    }

    let reversals = 0;
    let dir = 0;
    for (let i = 1; i < booms.length; i++) {
      const d = booms[i] - booms[i - 1];
      if (Math.abs(d) < 1e-4) continue;
      const next = Math.sign(d);
      if (dir !== 0 && next !== dir) reversals++;
      dir = next;
    }
    expect(reversals).toBe(0);
  });

  it('extends gradually instead of springing back to full length', () => {
    const limit = { value: 1.2 };
    const { cam, camera } = makeCamera(limit);
    for (let i = 0; i < 240; i++) cam.update(body(), 1 / 60, 0);
    const short = camera.position.distanceTo(cam.currentLookAt);

    limit.value = 100;
    cam.update(body(), 1 / 60, 0);
    const afterOne = camera.position.distanceTo(cam.currentLookAt);

    // One frame of a 3.5/s ease is a few centimetres, not six metres.
    expect(afterOne - short).toBeLessThan(0.4);

    for (let i = 0; i < 300; i++) cam.update(body(), 1 / 60, 0);
    expect(camera.position.distanceTo(cam.currentLookAt)).toBeGreaterThan(
      GAME_CONFIG.camera.defaultDistance - 0.4
    );
  });

  it('snaps immediately when asked, so a map change does not fly the camera', () => {
    const limit = { value: 1.0 };
    const { cam, camera } = makeCamera(limit);
    // Let the boom retract to the obstruction first — that part is deliberately
    // gradual, so it cannot be asserted on the very first frame.
    for (let i = 0; i < 120; i++) cam.update(body(), 1 / 60, 0);
    expect(camera.position.distanceTo(cam.currentLookAt)).toBeLessThan(1.3);

    limit.value = 100;
    cam.snap(new THREE.Vector3(50, 0, 50), 0);
    expect(camera.position.distanceTo(cam.currentLookAt)).toBeCloseTo(
      GAME_CONFIG.camera.defaultDistance,
      1
    );
    expect(cam.currentLookAt.x).toBeCloseTo(50, 1);
  });
});
