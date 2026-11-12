import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TargetGlow } from '../src/game/render/TargetGlow';

function prop(): { group: THREE.Group; mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const group = new THREE.Group();
  group.add(mesh);
  return { group, mesh, material };
}

describe('TargetGlow', () => {
  it('tints the target through a cloned material, not the original', () => {
    const { group, mesh, material } = prop();
    const glow = new TargetGlow();

    glow.show(group);

    const lit = mesh.material as THREE.MeshStandardMaterial;
    expect(lit).not.toBe(material);
    expect(lit.emissive.getHex()).toBe(0xff7a45);
    // The shared material the rest of the map uses is untouched.
    expect(material.emissive.getHex()).toBe(0x000000);
  });

  it('restores the original material and disposes the clone on hide', () => {
    const { group, mesh, material } = prop();
    const glow = new TargetGlow();

    glow.show(group);
    const clone = mesh.material as THREE.Material;
    const disposed: THREE.Material[] = [];
    clone.addEventListener('dispose', () => disposed.push(clone));

    glow.hide();

    expect(mesh.material).toBe(material);
    expect(disposed).toContain(clone);
    expect(glow.getTarget()).toBeNull();
  });

  it('does not re-clone while the same object stays selected', () => {
    const { group, mesh } = prop();
    const glow = new TargetGlow();

    glow.show(group);
    const first = mesh.material;
    glow.show(group);
    glow.show(group);

    expect(mesh.material).toBe(first);
  });

  it('pulses the emissive intensity without touching the base colour', () => {
    const { group, mesh } = prop();
    const glow = new TargetGlow();
    glow.show(group);

    const lit = mesh.material as THREE.MeshStandardMaterial;
    const readings: number[] = [];
    // Two seconds: the pulse is 5.2 rad/s, so a shorter window can miss a trough.
    for (let i = 0; i < 120; i++) {
      glow.update(1 / 60);
      readings.push(lit.emissiveIntensity);
    }

    expect(Math.max(...readings)).toBeGreaterThan(0.55);
    expect(Math.min(...readings)).toBeLessThan(0.35);
    expect(lit.emissive.getHex()).toBe(0xff7a45);
  });

  it('leaves a material with no emissive term alone', () => {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const glow = new TargetGlow();

    glow.show(mesh);

    expect(mesh.material).toBe(material);
  });
});
