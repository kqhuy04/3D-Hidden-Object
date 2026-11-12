import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { stopCullingAnimatedParts } from '../src/game/render/skinnedCulling';

/**
 * The bug this guards against: three caches a skinned mesh's bounding sphere on
 * its first frustum test and never recomputes it, so an animated body is culled
 * by a sphere that describes a pose it is no longer in. Measured on the kits,
 * those spheres come out at 0.60–0.82x the geometry they are supposed to hold.
 */
function skinned(): THREE.SkinnedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.SkinnedMesh(geometry, material);
  // A skinned mesh with no bones is enough for the flag, and keeps the test
  // free of a skeleton it never inspects.
  return mesh;
}

describe('stopCullingAnimatedParts', () => {
  it('turns culling off for a skinned mesh', () => {
    const mesh = skinned();
    expect(mesh.frustumCulled).toBe(true);
    stopCullingAnimatedParts(mesh);
    expect(mesh.frustumCulled).toBe(false);
  });

  it('leaves static meshes alone', () => {
    // A kit prop is a skinned mesh too, but it never animates, so its cached
    // sphere is honest and culling it is worth keeping.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    stopCullingAnimatedParts(mesh);
    expect(mesh.frustumCulled).toBe(true);
  });

  it('reaches every part of a body, not just the root', () => {
    // A kit character is several meshes — body, hair, coat, hands — and it is
    // the coat, a child of the root, that vanished first.
    const root = new THREE.Group();
    const body = skinned();
    const coat = skinned();
    const limb = new THREE.Group();
    const hands = skinned();
    limb.add(hands);
    root.add(body, coat, limb);

    stopCullingAnimatedParts(root);

    expect(body.frustumCulled).toBe(false);
    expect(coat.frustumCulled).toBe(false);
    expect(hands.frustumCulled).toBe(false);
  });
});
