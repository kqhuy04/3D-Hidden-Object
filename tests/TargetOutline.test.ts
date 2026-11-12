import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TargetOutline } from '../src/game/render/TargetOutline';

function prop(): { group: THREE.Group; mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const group = new THREE.Group();
  group.add(mesh);
  return { group, mesh, material };
}

/** The extra mesh the outline hangs off the host. */
function hullOf(mesh: THREE.Mesh): THREE.Mesh | undefined {
  return mesh.children.find((child) => (child as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
}

describe('TargetOutline', () => {
  it('adds a hull to the target and leaves its material alone', () => {
    const { group, mesh, material } = prop();
    const outline = new TargetOutline();

    outline.show(group);

    const hull = hullOf(mesh);
    expect(hull).toBeDefined();
    // Same geometry, so the silhouette is the object's own.
    expect(hull!.geometry).toBe(mesh.geometry);
    // The map's shared material is never touched: the previous version cloned
    // it, and a clone per selection is a program-cache risk this avoids.
    expect(mesh.material).toBe(material);
    expect(material.emissive.getHex()).toBe(0x000000);
  });

  it('draws back faces only, with the rim offset in view space', () => {
    const { group, mesh } = prop();
    const outline = new TargetOutline();

    outline.show(group);

    const material = hullOf(mesh)!.material as THREE.ShaderMaterial;
    expect(material.side).toBe(THREE.BackSide);
    // The rim must not write depth: it is an overlay, and a hull that wrote
    // depth would punch a hole in the prop behind it.
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.thickness.value).toBeGreaterThan(0);
    expect(material.vertexShader).toContain('modelViewMatrix');
  });

  it('removes the hull and disposes its material on hide', () => {
    const { group, mesh } = prop();
    const outline = new TargetOutline();

    outline.show(group);
    const hull = hullOf(mesh)!;
    const material = hull.material as THREE.Material;
    const disposed: THREE.Material[] = [];
    material.addEventListener('dispose', () => disposed.push(material));

    outline.hide();

    expect(mesh.children).not.toContain(hull);
    expect(disposed).toContain(material);
    expect(outline.getTarget()).toBeNull();
  });

  it('does not stack hulls while the same object stays selected', () => {
    const { group, mesh } = prop();
    const outline = new TargetOutline();

    outline.show(group);
    outline.show(group);
    outline.show(group);

    expect(mesh.children.filter((child) => (child as THREE.Mesh).isMesh)).toHaveLength(1);
  });

  it('skips a skinned mesh, whose hull would stand in the bind pose', () => {
    const material = new THREE.MeshStandardMaterial();
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), material);
    skinned.bind(new THREE.Skeleton([new THREE.Bone()]));
    const group = new THREE.Group();
    group.add(skinned);

    const outline = new TargetOutline();
    outline.show(group);

    expect(hullOf(skinned)).toBeUndefined();
    expect(skinned.material).toBe(material);
  });

  it('scales the rim with the mesh, and clamps it at both ends', () => {
    const small = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshStandardMaterial());
    const large = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), new THREE.MeshStandardMaterial());
    const group = new THREE.Group();
    group.add(small, large);

    const outline = new TargetOutline();
    outline.show(group);

    const thin = (hullOf(small)!.material as THREE.ShaderMaterial).uniforms.thickness.value as number;
    const thick = (hullOf(large)!.material as THREE.ShaderMaterial).uniforms.thickness.value as number;
    // A fixed thickness is invisible on a wagon and a cartoon border on a cup.
    expect(thick).toBeGreaterThan(thin);
    expect(thin).toBeGreaterThanOrEqual(0.025);
    expect(thick).toBeLessThanOrEqual(0.11);
  });
});
