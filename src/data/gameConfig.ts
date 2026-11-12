export interface GameConfig {
  player: {
    walkSpeed: number;
    /** Multiplier applied to `walkSpeed` while the run toggle is on. */
    runMultiplier: number;
    /** Multiplier applied to `walkSpeed` while crawling — a crawl is slow. */
    crawlMultiplier: number;
    rotationSpeed: number;
    collisionRadius: number;
    capsuleRadius: number;
    capsuleHeight: number;
    stepHeight: number;
    /**
     * Drops up to this height are walked down; anything higher is a fall.
     *
     * Kept well below `stepHeight`: gluing the body to the ground over a whole
     * step made stepping off a dock edge a single-frame 0.35 m snap, which reads
     * as a teleport. Falling that far takes 0.2 s and reads as a drop.
     */
    stepDown: number;
    skinWidth: number;
    /** Downward acceleration when the ground drops away, m/s². */
    gravity: number;
    spawnPoint: { x: number; y: number; z: number };
  };
  camera: {
    fov: number;
    /** Distance the first-person view settles at: the lens sits in the head. */
    firstPersonDistance: number;
    defaultDistance: number;
    minDistance: number;
    maxDistance: number;
    defaultYaw: number;
    defaultPitch: number;
    minPitch: number;
    maxPitch: number;
    /** Field of view range while zooming in first person. */
    minFov: number;
    maxFov: number;
    mouseSensitivity: number;
    scrollSensitivity: number;
    lookOffset: { x: number; y: number; z: number };
    damping: number;
    /**
     * Rate at which the camera's aim follows a change of height, per second.
     *
     * Deliberately slower than the horizontal `damping`: the camera is meant to
     * settle onto the ground the player stands on, not to ride every step. At
     * the horizontal rate a 0.55 m jump arc drags the whole view up and back
     * down, which is most of what made the jump read as weightless.
     */
    verticalDamping: number;
    /**
     * Share of the jump's height the camera follows, 0..1.
     *
     * The rest is left for the character to rise through the frame. Zero makes
     * a jump look like the ground sinking; one puts the camera back on the arc.
     */
    jumpFollow: number;
  };
}

export const GAME_CONFIG: GameConfig = {
  player: {
    // 3.2 m/s is a brisk walk — a shade under 12 km/h. It used to be 4.8, which
    // is a fast jog (17 km/h): faster than a race-walker, and fast enough that
    // the walk cycle had to be played at 1.6x to keep the feet from skating.
    // A hunt is spent looking, not covering ground, and overshooting a corner
    // every time you turn it is the opposite of relaxing.
    walkSpeed: 3.2,
    runMultiplier: 1.75,
    crawlMultiplier: 0.38,
    rotationSpeed: 10.0,
    collisionRadius: 0.45,
    // Capsule derived from the character GLB: 1.755 m tall, torso ~0.50 m wide
    // (the 1.618 m bbox width includes outstretched arms). Radius covers the
    // torso plus a little shoulder, height matches the model exactly.
    capsuleRadius: 0.3,
    capsuleHeight: 1.75,
    stepHeight: 0.35, // curbs, low rocks and table stretchers are stepped over
    stepDown: 0.15, // a higher ledge is dropped off, not snapped down
    skinWidth: 0.02, // contact offset, keeps the player from jittering on surfaces
    // Slightly above real gravity: a 1.5 m drop off a dock lands in ~0.4 s
    // instead of ~0.55 s, which reads as "dropped" rather than "floating".
    gravity: 18.0,
    // Must stay outside every obstacle box: the pop-top camper van occupies
    // x -4.8..-0.4 / z 0.1..2.5, so z=0 spawned the player inside it.
    spawnPoint: { x: 0, y: 0.5, z: -2 },
  },
  camera: {
    fov: 60,
    firstPersonDistance: 0.02,
    defaultDistance: 8.0,
    minDistance: 3.0,
    maxDistance: 14.0,
    defaultYaw: Math.PI,
    defaultPitch: 0.35,
    // Negative pitch looks *up*: the boom swings under the body and the lens
    // aims at the sky. The old floor of +0.05 meant the horizon was the highest
    // thing a player could ever see, which is what made every room feel like a
    // box with the lid on.
    minPitch: -0.95,
    maxPitch: 1.35,
    minFov: 32,
    maxFov: 82,
    mouseSensitivity: 0.0035,
    scrollSensitivity: 0.005,
    lookOffset: { x: 0, y: 1.5, z: 0 },
    damping: 10.0,
    verticalDamping: 3.2,
    jumpFollow: 0.25,
  },
};
