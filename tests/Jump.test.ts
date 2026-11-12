import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { sampleCurve } from '../src/game/player/CharacterAnimator';
import { PlayerController } from '../src/game/player/PlayerController';
import { CharacterAnimator } from '../src/game/player/CharacterAnimator';
import { CameraController } from '../src/game/player/CameraController';
import { WorldCollision } from '../src/game/world/WorldCollision';
import { GAME_CONFIG } from '../src/data/gameConfig';

const JUMP = JSON.parse(
  fs.readFileSync(path.resolve('public/assets/anims/anim-jump.json'), 'utf8')
) as {
  name: string;
  duration: number;
  times: number[];
  hips: number[];
  rootLift: number[];
  tracks: Record<string, number[]>;
};

const hipsY = (arr: number[]) => arr.filter((_, i) => i % 3 === 1);

describe('jump clip data', () => {
  it('is a full jump: crouch, airborne arc, landing, recovery', () => {
    expect(JUMP.name).toBe('Jump');
    expect(JUMP.duration).toBeGreaterThan(1.5);
    expect(JUMP.times.length).toBe(JUMP.hips.length / 3);

    const lift = JUMP.rootLift;
    expect(lift.length).toBe(JUMP.times.length);

    // Starts and ends on the ground, rises well clear of it in between.
    expect(lift[0]).toBeCloseTo(0, 3);
    expect(lift[lift.length - 1]).toBeCloseTo(0, 3);
    expect(Math.max(...lift)).toBeGreaterThan(0.4);
    expect(Math.max(...lift)).toBeLessThan(1.0);

    // Apex is roughly a third of the way through the clip, not at an edge.
    const apex = lift.indexOf(Math.max(...lift));
    expect(apex).toBeGreaterThan(lift.length * 0.2);
    expect(apex).toBeLessThan(lift.length * 0.7);
  });

  it('keeps every compression frame in the skeleton, never in the root', () => {
    // hips is the airborne part removed: it may only be negative (crouch and
    // landing). If a positive value leaked through, the body would be lifted
    // twice and the feet would leave the ground during the crouch.
    for (const y of hipsY(JUMP.hips)) expect(y).toBeLessThanOrEqual(0.0001);
    for (const l of JUMP.rootLift) expect(l).toBeGreaterThanOrEqual(0);
  });

  it('reconstructs the authored hip curve when root lift is added back', () => {
    // The converter splits one curve into two. hips + rootLift must still equal
    // the source motion, otherwise the pose stops matching the ground contact
    // the animation was authored for.
    const combined = hipsY(JUMP.hips).map((y, i) => y + JUMP.rootLift[i]);
    expect(combined[0]).toBeCloseTo(-0.0685, 3); // slight ready-stance crouch
    expect(Math.min(...combined)).toBeCloseTo(-0.432, 2); // deep crouch
    expect(Math.max(...combined)).toBeCloseTo(0.56, 2); // apex above rest
    expect(combined[combined.length - 1]).toBeCloseTo(-0.0685, 3);
  });
});

describe('sampleCurve', () => {
  const curve = { times: [0, 1, 2], values: [0, 0.5, 0] };

  it('interpolates between keys', () => {
    expect(sampleCurve(curve, 0.5)).toBeCloseTo(0.25, 6);
    expect(sampleCurve(curve, 1.5)).toBeCloseTo(0.25, 6);
  });

  it('clamps outside the key range', () => {
    expect(sampleCurve(curve, -1)).toBe(0);
    expect(sampleCurve(curve, 99)).toBe(0);
  });

  it('handles an empty curve without producing NaN', () => {
    expect(sampleCurve({ times: [], values: [] }, 0.5)).toBe(0);
  });
});

describe('PlayerController vertical placement', () => {
  const makeWorld = () => {
    const group = new THREE.Group();
    const mesh = new THREE.Object3D();
    group.add(mesh);

    const collision = new WorldCollision();
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    groundGeo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial());
    ground.updateMatrixWorld(true);
    collision.setTerrainMesh(ground);
    return { group, mesh, collision };
  };

  it('adds the animation lift on top of the ground, and nothing else', () => {
    const { group, mesh, collision } = makeWorld();
    const animator = new CharacterAnimator(mesh);
    // The controller only needs the animator contract here.
    let lift = 0;
    const stub = animator as unknown as {
      getRootLift: () => number;
      isJumping: () => boolean;
      getMoveScale: () => number;
    };
    stub.getRootLift = () => lift;
    stub.isJumping = () => true;
    stub.getMoveScale = () => 1;
    const controller = new PlayerController(group, animator, collision);
    controller.setPosition(0, 0, 0);

    controller.update(new THREE.Vector2(0, 0), 0, 0.1);
    expect(controller.getPosition().y).toBeCloseTo(0, 3);

    lift = 0.56;
    controller.update(new THREE.Vector2(0, 0), 0, 0.1);
    expect(controller.getPosition().y).toBeCloseTo(0.56, 3);

    // Landing: the lift returns to zero and the body is back on the terrain.
    lift = 0;
    controller.update(new THREE.Vector2(0, 0), 0, 0.1);
    expect(controller.getPosition().y).toBeCloseTo(0, 3);
  });

  it('sends the body height to the resolver but keeps the probe on the ground', () => {
    // The two must not be confused: the collision band has to follow the body
    // so a cleared bench stops blocking, while the ground reference has to stay
    // put so the step-over rules and the returned height do not drift upwards
    // with the jump.
    const { group, mesh, collision } = makeWorld();
    const animator = new CharacterAnimator(mesh);
    const stub = animator as unknown as {
      getRootLift: () => number;
      isJumping: () => boolean;
      getMoveScale: () => number;
    };
    stub.getRootLift = () => 0.56;
    stub.isJumping = () => true;
    stub.getMoveScale = () => 1;

    const probes: number[] = [];
    const bodies: (number | undefined)[] = [];
    const realMove = collision.moveCapsule.bind(collision);
    collision.moveCapsule = ((
      pos: THREE.Vector3,
      move: THREE.Vector3,
      capsule?: unknown,
      bodyFeetY?: number
    ) => {
      probes.push(pos.y);
      bodies.push(bodyFeetY);
      return realMove(pos, move, capsule as never, bodyFeetY);
    }) as typeof collision.moveCapsule;

    const controller = new PlayerController(group, animator, collision);
    controller.setPosition(0, 0, 0);
    // The body height is written at the end of a frame, so the first frame
    // still carries the ground. Warm up one frame, then record the next one —
    // that is the steady state the test is about.
    controller.update(new THREE.Vector2(0, 1), 0, 0.1);
    probes.length = 0;
    bodies.length = 0;
    controller.update(new THREE.Vector2(0, 1), 0, 0.1);

    expect(probes.length).toBe(1);
    expect(probes[0]).toBeCloseTo(0, 6);
    expect(bodies[0]).toBeCloseTo(0.56, 3);
    expect(controller.getPosition().y).toBeCloseTo(0.56, 3);
  });

  it('requests a jump only when asked', () => {
    const { group, mesh, collision } = makeWorld();
    const animator = new CharacterAnimator(mesh);
    let started = 0;
    (animator as unknown as { startJump: () => boolean }).startJump = () => {
      started++;
      return true;
    };
    const controller = new PlayerController(group, animator, collision);
    controller.setPosition(0, 0, 0);

    controller.update(new THREE.Vector2(0, 0), 0, 0.1);
    expect(started).toBe(0);

    controller.update(new THREE.Vector2(0, 0), 0, 0.1, true);
    expect(started).toBe(1);
  });
});

/**
 * Drives the real clip through the real mixer. The rig only needs the Hips bone
 * the clip binds to; the rest of the skeleton would only change the pose, not
 * the timing this is about.
 */
const loadAnimator = async (): Promise<CharacterAnimator> => {
  const group = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'Hips';
  hips.position.set(0, 0.95, 0);
  group.add(hips);

  const animator = new CharacterAnimator(group);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const file = path.resolve('public', String(url).replace(/^\/+/, ''));
    if (!fs.existsSync(file)) return { ok: false } as Response;
    return {
      ok: true,
      json: async () => JSON.parse(fs.readFileSync(file, 'utf8')),
    } as Response;
  }) as typeof fetch;
  try {
    await animator.loadAnimations('/assets/anims/');
  } finally {
    globalThis.fetch = realFetch;
  }
  return animator;
};

describe('jump playback rate', () => {
  it('leaves the ground quickly instead of holding the crouch', async () => {
    const animator = await loadAnimator();
    expect(animator.startJump()).toBe(true);

    let t = 0;
    let takeoffT: number | null = null;
    let landT: number | null = null;
    let crouchLock = 0;
    let landLock = 0;

    for (let i = 0; i < 600 && animator.isJumping(); i++) {
      animator.update(1 / 60);
      t += 1 / 60;
      const lift = animator.getRootLift();
      if (takeoffT === null && lift > 0.02) takeoffT = t;
      if (takeoffT !== null && landT === null && lift <= 0.005) landT = t;
      if (animator.getMoveScale() === 0) {
        if (takeoffT === null) crouchLock += 1 / 60;
        else landLock += 1 / 60;
      }
    }

    expect(takeoffT).not.toBeNull();
    // The authored crouch is 0.533 s; played at 3x it is 0.18 s.
    expect(takeoffT as number).toBeGreaterThan(0.1);
    expect(takeoffT as number).toBeLessThan(0.3);
    expect(crouchLock).toBeLessThan(0.3);

    // The flight keeps its authored rate, so the arc still matches the pose.
    expect((landT as number) - (takeoffT as number)).toBeGreaterThan(0.45);
    expect((landT as number) - (takeoffT as number)).toBeLessThan(0.75);

    // The authored absorb is 0.767 s; played at 2.4x it is 0.32 s.
    expect(landLock).toBeLessThan(0.4);

    // Whole jump: 1.10 s. Played straight it was 1.90 s, of which 1.3 s was
    // standing still.
    expect(t).toBeLessThan(1.4);
    expect(t).toBeGreaterThan(0.9);
  });

  it('holds the airborne frame while the body falls to a lower landing', async () => {
    const animator = await loadAnimator();
    animator.startJump();

    // Run to the end of the flight.
    for (let i = 0; i < 600 && !animator.isJumpArcFinished(); i++) animator.update(1 / 60);
    expect(animator.isJumpArcFinished()).toBe(true);

    animator.holdJumpAtContact();
    expect(animator.isJumpHeld()).toBe(true);
    expect(animator.getRootLift()).toBeCloseTo(0, 3);
    // Falling is not walking: the body may still be steered.
    expect(animator.getMoveScale()).toBe(1);

    // The arc ends already moving down; a drop continues from that speed
    // instead of stalling at the end of the flight.
    expect(animator.getContactFallSpeed()).toBeGreaterThan(1);
    expect(animator.getContactFallSpeed()).toBeLessThan(4);

    // A full second in the air: the clip must not run on into the landing.
    for (let i = 0; i < 60; i++) animator.update(1 / 60);
    expect(animator.isJumping()).toBe(true);
    expect(animator.isJumpHeld()).toBe(true);

    // Touchdown resumes the absorb and lets the clip finish.
    animator.landJump();
    expect(animator.isJumpHeld()).toBe(false);
    for (let i = 0; i < 120; i++) animator.update(1 / 60);
    expect(animator.isJumping()).toBe(false);
  });
});

describe('jumping down to a lower ledge', () => {
  /** A fake animator whose arc is a fixed number of frames long. */
  const fakeAnimator = (arcFrames: number) => {
    let frame = 0;
    const state = {
      held: false,
      jumping: false,
      landCalls: 0,
      holdCalls: 0,
      getRootLift: () =>
        frame < arcFrames ? Math.sin((Math.PI * frame) / arcFrames) * 0.56 : 0,
      isJumping: () => state.jumping,
      isJumpArcFinished: () => frame >= arcFrames,
      isJumpHeld: () => state.held,
      // The authored arc is a sine: it climbs for the first half of the flight.
      isArcRising: () => state.jumping && frame < arcFrames / 2,
      // The clip's authored cushion: the last three frames of the arc.
      isArcCushioning: () => state.jumping && frame >= arcFrames - 3,
      getPeakFallSpeed: () => 3.5,
      holdJumpAtContact: () => {
        state.held = true;
        state.holdCalls++;
      },
      landJump: () => {
        state.held = false;
        state.landCalls++;
      },
      getMoveScale: () => 1,
      getContactFallSpeed: () => 0,
      startJump: () => {
        if (state.jumping) return false;
        state.jumping = true;
        frame = 0;
        return true;
      },
      locomotion: () => {},
      update: () => {
        frame++;
        // The absorb plays out a little after touchdown.
        if (state.landCalls > 0 && frame > arcFrames + 40) state.jumping = false;
      },
    };
    return state;
  };

  it('falls to the landing instead of floating there with the clip done', () => {
    const group = new THREE.Group();
    group.add(new THREE.Object3D());
    const collision = new WorldCollision();
    // A cliff: the ground is 3 m high for x > -1.5 and 0 m below it.
    const groundAt = (x: number) => (x > -1.5 ? 3 : 0);
    collision.moveCapsule = ((pos: THREE.Vector3, move: THREE.Vector3) => {
      const p = pos.clone();
      p.x += move.x;
      p.z += move.z;
      p.y = groundAt(p.x);
      return { position: p, contacts: [], blocked: false };
    }) as typeof collision.moveCapsule;

    const animator = fakeAnimator(30);
    const controller = new PlayerController(
      group,
      animator as unknown as CharacterAnimator,
      collision
    );
    controller.setPosition(0, 3, 0);

    const ys: number[] = [];
    let heldFrom = -1;
    let landedAt = -1;
    for (let i = 0; i < 200; i++) {
      // Walk toward -x, straight off the edge.
      controller.update(new THREE.Vector2(-1, 0), 0, 1 / 60, i === 0);
      ys.push(controller.getPosition().y);
      if (heldFrom < 0 && animator.held) heldFrom = i;
      if (landedAt < 0 && animator.landCalls > 0) landedAt = i;
    }

    expect(heldFrom).toBeGreaterThan(0);
    expect(animator.holdCalls).toBe(1);

    // While falling the body only ever goes down. The old code snapped it to
    // the arc's take-off height and dropped it again, forever.
    const fall = ys.slice(heldFrom);
    for (let i = 1; i < fall.length; i++) {
      expect(fall[i]).toBeLessThanOrEqual(fall[i - 1] + 1e-6);
    }

    // It lands on the lower ground, not on the height it jumped from.
    expect(landedAt).toBeGreaterThan(heldFrom);
    expect(ys[landedAt]).toBeCloseTo(0, 2);
    expect(ys[ys.length - 1]).toBeCloseTo(0, 2);
    expect(animator.held).toBe(false);
  });

  it('lands early when the ground rises to meet the arc', () => {
    const group = new THREE.Group();
    group.add(new THREE.Object3D());
    const collision = new WorldCollision();
    // A step up: the ground rises 2 m as the body jumps into it.
    collision.moveCapsule = ((pos: THREE.Vector3, move: THREE.Vector3) => {
      const p = pos.clone();
      p.x += move.x;
      p.z += move.z;
      p.y = p.x < -1 ? 5 : 0;
      return { position: p, contacts: [], blocked: false };
    }) as typeof collision.moveCapsule;

    const animator = fakeAnimator(30);
    const controller = new PlayerController(
      group,
      animator as unknown as CharacterAnimator,
      collision
    );
    controller.setPosition(0, 0, 0);

    for (let i = 0; i < 120; i++) {
      controller.update(new THREE.Vector2(-1, 0), 0, 1 / 60, i === 0);
    }

    // The body is on the upper ground, not left hanging at the arc's height.
    expect(controller.getPosition().y).toBeCloseTo(5, 2);
    expect(animator.holdCalls).toBe(0);
    expect(animator.landCalls).toBeGreaterThan(0);
  });
});

describe('camera vertical follow', () => {
  it('settles onto the ground instead of riding the jump arc', () => {
    (globalThis as unknown as { window: unknown }).window = { addEventListener() {} };
    try {
      const camera = new THREE.PerspectiveCamera();
      const domElement = { addEventListener() {} };
      const cam = new CameraController(
        camera,
        domElement as unknown as HTMLElement
      );

      const ground = 0;
      for (let i = 0; i < 180; i++) {
        cam.update(new THREE.Vector3(0, ground, 0), 1 / 60, ground);
      }
      const baseY = camera.position.y;

      // The apex of a jump: the body is 0.56 m up, the ground has not moved.
      let peak = baseY;
      for (let i = 0; i < 16; i++) {
        cam.update(new THREE.Vector3(0, ground + 0.56, 0), 1 / 60, ground);
        peak = Math.max(peak, camera.position.y);
      }

      // The arc used to drag the whole view with it; a quarter of it is felt.
      expect(peak - baseY).toBeGreaterThan(0.01);
      expect(peak - baseY).toBeLessThan(0.56 * GAME_CONFIG.camera.jumpFollow + 0.06);

      // Landing on a ledge 2 m lower is followed, just slowly.
      for (let i = 0; i < 120; i++) {
        cam.update(new THREE.Vector3(0, -2, 0), 1 / 60, -2);
      }
      expect(camera.position.y).toBeLessThan(baseY - 1.6);
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });
});
