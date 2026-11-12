import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { isHumanoid } from '../src/game/npc/KitClips';

/**
 * A skeleton with the given bone names, and nothing else.
 *
 * `THREE.Skeleton` is happy with a list of bones in a scene graph it does not
 * own, which is all `isHumanoid` looks at.
 */
function skeletonOf(names: string[]): THREE.Skeleton {
  const bones = names.map((name) => {
    const bone = new THREE.Bone();
    bone.name = name;
    return bone;
  });
  return new THREE.Skeleton(bones);
}

const HUMAN = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftForeArm', 'RightUpLeg'];
const ANIMAL = ['Hips', 'Spine', 'Neck', 'Head', 'Jaw', 'Tail'];

describe('isHumanoid', () => {
  it('accepts a Mixamo skeleton', () => {
    expect(isHumanoid(skeletonOf(HUMAN))).toBe(true);
  });

  it('accepts one the merge has renamed', () => {
    // A prepared map is one merged scene with three hundred skeletons, so the
    // merge suffixes every bone to keep the file valid: Hips_31, Spine2_18,
    // LeftForeArm_7. The first version of this matched exact names, found
    // nobody on twenty maps out of twenty-one, and the whole cast stood still.
    const merged = HUMAN.map((name, i) => `${name}_${i + 1}`);
    expect(isHumanoid(skeletonOf(merged))).toBe(true);
  });

  it('rejects an animal, which the clips would fold in half', () => {
    expect(isHumanoid(skeletonOf(ANIMAL))).toBe(false);
  });

  it('rejects a humanoid missing an arm bone', () => {
    expect(isHumanoid(skeletonOf(HUMAN.filter((n) => n !== 'LeftForeArm')))).toBe(false);
  });
});
