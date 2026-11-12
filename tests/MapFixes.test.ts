import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { removeProps } from '../src/game/world/WorldLoader';
import type { PropRemoval } from '../src/data/mapFixes';

/**
 * The removal list exists because kit props are placed at one Y on ground that
 * slopes, and a mesh cannot be addressed by name alone: map 1 has ten meshes
 * called `fence` and exactly one of them hangs over a bank. These tests pin the
 * two halves of that — the position has to disambiguate, and a near miss must
 * not take a good prop with it.
 */
function fence(x: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 2), new THREE.MeshBasicMaterial());
  mesh.name = 'fence';
  mesh.position.set(x, 0.55, z);
  return mesh;
}

function sceneWith(...meshes: THREE.Mesh[]): THREE.Group {
  const root = new THREE.Group();
  for (const m of meshes) root.add(m);
  root.updateMatrixWorld(true);
  return root;
}

describe('removeProps', () => {
  it('removes only the fence at the given position', () => {
    const keeper = fence(-14.39, 4);
    const doomed = fence(-14.39, 9.95);
    const root = sceneWith(keeper, doomed);

    const removals: PropRemoval[] = [
      { name: 'fence', at: [-14.39, 0.55, 9.95], why: 'test' },
    ];

    expect(removeProps(root, removals)).toBe(1);
    expect(keeper.parent).toBe(root);
    expect(doomed.parent).toBe(null);
  });

  it('leaves a same-named prop alone when it is out of range', () => {
    const near = fence(-14.39, 9.95);
    const far = fence(-14.39, 13.0);
    const root = sceneWith(near, far);

    // 0.6 m tolerance by default; 3 m away must not match.
    removeProps(root, [{ name: 'fence', at: [-14.39, 0.55, 9.95], why: 'test' }]);

    expect(near.parent).toBe(null);
    expect(far.parent).toBe(root);
  });

  it('ignores a prop whose name does not match', () => {
    const gate = fence(0, 0);
    gate.name = 'gate';
    const root = sceneWith(gate);

    expect(removeProps(root, [{ name: 'fence', at: [0, 0.55, 0], why: 'test' }])).toBe(0);
    expect(gate.parent).toBe(root);
  });

  it('honours an explicit radius', () => {
    const root = sceneWith(fence(0, 2));
    const wide: PropRemoval[] = [{ name: 'fence', at: [0, 0.55, 0], radius: 2.5, why: 'test' }];

    expect(removeProps(root, wide)).toBe(1);
  });

  it('removes a whole subtree when the match is a parent', () => {
    const parent = fence(0, 0);
    const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    child.name = 'rail';
    parent.add(child);
    const root = sceneWith(parent);

    removeProps(root, [{ name: 'fence', at: [0, 0.55, 0], why: 'test' }]);

    expect(parent.parent).toBe(null);
    expect(child.parent).toBe(parent);
  });
});
