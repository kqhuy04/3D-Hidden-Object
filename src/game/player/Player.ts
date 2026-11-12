import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CharacterAnimator } from './CharacterAnimator';
import { PlayerController } from './PlayerController';
import { WorldCollision } from '../world/WorldCollision';
import { GAME_CONFIG } from '../../data/gameConfig';

export class Player {
  private characterGroup: THREE.Group = new THREE.Group();
  private animator: CharacterAnimator | null = null;
  private controller: PlayerController | null = null;
  private characterModel: THREE.Object3D | null = null;
  /** Kept so the model can be swapped without a map load. */
  private collision: WorldCollision | null = null;
  /** Where the character load time went, in milliseconds. */
  public timings: Record<string, number> = {};

  constructor() {
    this.characterGroup.name = 'player-root';
  }

  public async load(
    modelUrl: string,
    collision: WorldCollision,
    onProgress?: (percent: number) => void
  ): Promise<THREE.Group> {
    this.collision = collision;
    const loader = new GLTFLoader();

    return new Promise((resolve, reject) => {
      const started = performance.now();
      loader.load(
        modelUrl,
        async (gltf) => {
          this.timings.fetchAndParse = Math.round(performance.now() - started);
          this.characterModel = gltf.scene;
          this.characterModel.name = 'character-mesh';

          // Shadows
          this.characterModel.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });

          normaliseHeight(this.characterModel);
          this.characterGroup.add(this.characterModel);

          // Setup animator
          const tAnimator = performance.now();
          this.animator = new CharacterAnimator(this.characterModel);

          // Check if GLB has built-in clips
          if (gltf.animations && gltf.animations.length > 0) {
            for (const clip of gltf.animations) {
              this.animator.addExistingClip(clip);
            }
          }

          // Load local offline animation keyframes (Idle, Walk, Run)
          await this.animator.loadAnimations('/assets/anims/');
          this.timings.animator = Math.round(performance.now() - tAnimator);

          // Create controller
          this.controller = new PlayerController(
            this.characterGroup,
            this.animator,
            collision
          );
          this.timings.controller = Math.round(performance.now() - tAnimator) - this.timings.animator;

          onProgress?.(100);
          resolve(this.characterGroup);
        },
        (event) => {
          if (event.lengthComputable && onProgress) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        },
        (error) => {
          reject(new Error(`Failed to load player character from ${modelUrl}: ${error}`));
        }
      );
    });
  }

  /**
   * Replaces the character without touching the world.
   *
   * The group the controller moves is the same object throughout — only its
   * child mesh changes — so the body stays exactly where it was standing, and
   * the collision the controller holds is still the live map's. Rebuilding the
   * controller rather than patching its animator is deliberate: the animator is
   * bound to one skeleton for life, and half-swapping it is how you get a
   * character whose legs are driven by the previous one's bones.
   */
  public async swapModel(modelUrl: string, onProgress?: (percent: number) => void): Promise<void> {
    if (!this.collision) return;
    this.disposeModel();
    await this.load(modelUrl, this.collision, onProgress);
  }

  /**
   * Frees the previous character.
   *
   * The skeleton matters more than the geometry: three uploads a bone texture
   * per skinned mesh, and a swap that only drops the reference leaks one every
   * time the player pages through the roster.
   */
  private disposeModel(): void {
    if (!this.characterModel) return;
    this.characterGroup.remove(this.characterModel);
    this.characterModel.traverse((child) => {
      const skinned = child as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.characterModel = null;
    this.animator = null;
    this.controller = null;
  }

  public getController(): PlayerController | null {
    return this.controller;
  }

  public getAnimator(): CharacterAnimator | null {
    return this.animator;
  }

  public getGroup(): THREE.Group {
    return this.characterGroup;
  }

  public getPosition(): THREE.Vector3 {
    return this.characterGroup.position;
  }

  public setPosition(x: number, y: number, z: number): void {
    this.characterGroup.position.set(x, y, z);
    // Keep the controller's notion of the ground in step: it is what the
    // collision probe and the jump lift are measured against, and a respawn
    // that leaves it stale would apply one frame of the old height.
    this.controller?.setPosition(x, y, z);
  }
}

/**
 * Scales a character to the capsule height the game was tuned around.
 *
 * Polyfork characters are 1.5–2.0 m tall, and the capsule is a fixed 1.75 m
 * (`GAME_CONFIG.player.capsuleHeight`): step height, reach, camera stand-off
 * and the crawl clearance are all measured against it. A knight that comes in
 * at 1.92 m would have its head through every low beam it crawls under, and a
 * shorter one would leave the camera looking at the top of a hat. Normalising
 * makes the roster cosmetic, which is the only way twelve of them can all be
 * playable on twenty-two maps.
 */
function normaliseHeight(model: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(model);
  const height = box.max.y - box.min.y;
  if (!Number.isFinite(height) || height <= 0.01) return;

  const scale = GAME_CONFIG.player.capsuleHeight / height;
  // Guard against a rig that exported in centimetres: a 100x correction is not
  // a tall character, it is a different unit, and silently scaling it makes
  // the model vanish inside the ground.
  if (scale < 0.25 || scale > 4) return;
  model.scale.setScalar(scale);

  // Scaling is about the origin, and these models stand on y=0, so the feet
  // stay on the floor without a compensating offset.
}
