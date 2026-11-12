import * as THREE from 'three';

/**
 * Stops the renderer culling body parts off a character that is being animated.
 *
 * three caches `SkinnedMesh.boundingSphere` the first time the frustum asks for
 * it and never recomputes it: `Frustum.intersectsObject` sees that the property
 * exists, calls `computeBoundingSphere()` once, and then uses the result for the
 * rest of the session. The sphere it computes encloses the pose the body
 * happened to be in at that instant, not the one it is in now.
 *
 * Measured on the kits: the cached spheres came out at **0.60–0.82× the radius
 * of the geometry they are supposed to enclose**. A person whose arm swung out
 * was culled while still filling a quarter of the screen — the bug the player
 * reported as "người trong map thì khi bị đổi góc nhìn thì có thể bị mất thân
 * thể", and the reason a character's coat can blink out while it walks.
 *
 * Turning culling off for the handful of bodies the game actually animates costs
 * one draw call each and cannot be wrong. Static props are left alone: a kit
 * ships them as skinned meshes too, but their bind pose *is* their pose, so their
 * spheres are honest and culling them is worth keeping.
 */
export function stopCullingAnimatedParts(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
  });
}
