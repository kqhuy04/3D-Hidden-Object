import * as THREE from 'three';

/**
 * Colour the selected object glows with.
 *
 * A brighter, warmer cousin of the UI's rust accent: an emissive term is added
 * to the material's own shading, so it has to carry on its own against a
 * noon-lit white wall as well as a shadowed barn.
 */
const GLOW_COLOR = 0xff7a45;

/** Pulse rate of the glow, in radians per second. */
const PULSE_RATE = 5.2;
/** Emissive intensity at the bottom and top of the pulse. */
const PULSE_MIN = 0.22;
/**
 * The ceiling is deliberately not near 1. An emissive term is *added* to the
 * material's own shading, so at full strength the object stops being itself:
 * the farm's red phone booth turned into a flat orange slab, and a player who
 * cannot tell what the thing is has been told where to look but not what they
 * found. 0.62 keeps the colour and the facets legible while still reading as
 * lit from inside at a glance.
 */
const PULSE_MAX = 0.62;

interface Swapped {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  glowing: THREE.Material[];
}

/**
 * Makes the object the player is pointing at glow.
 *
 * This replaces a DOM corner-bracket overlay, which was cheap but hard to read:
 * four thin lines in the screen corners do not say *which* of the props in a
 * crowded stall you are on, and at the edges of the screen they fall outside
 * the frame entirely.
 *
 * The glow is done by swapping in a *clone* of each material with an emissive
 * term, rather than by a post-processing outline pass. Three reasons:
 *
 *  - It cannot paint the whole frame white. The outline pass that used to be
 *    here was the only thing in the renderer that could, and it did.
 *  - It costs no extra draw call and no extra render target. The material is
 *    already being drawn; only a uniform changed.
 *  - The clone reuses the compiled program. Three keys its program cache on the
 *    material's parameters, and a clone has identical ones — `emissive` and
 *    `emissiveIntensity` are uniforms, not defines — so selecting an object
 *    does not trigger a shader compile, which would be a visible hitch on the
 *    first target of every round.
 */
export class TargetGlow {
  private swapped: Swapped[] = [];
  private current: THREE.Object3D | null = null;
  private elapsed = 0;
  /** Every cloned material that actually has an emissive term. */
  private emissives: THREE.MeshStandardMaterial[] = [];

  public show(object: THREE.Object3D): void {
    if (this.current === object) return;
    this.hide();
    this.current = object;

    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;

      const original = mesh.material;
      const clone = Array.isArray(original)
        ? original.map((m) => m.clone())
        : original.clone();
      const list = Array.isArray(clone) ? clone : [clone];

      let glowing = 0;
      for (const material of list) {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard.emissive) continue;
        standard.emissive.setHex(GLOW_COLOR);
        standard.emissiveIntensity = PULSE_MIN;
        this.emissives.push(standard);
        glowing++;
      }
      // A material with no emissive term (an unlit sprite, a line) would only
      // cost a clone and change nothing on screen.
      if (glowing === 0) {
        for (const material of list) material.dispose();
        return;
      }

      mesh.material = clone;
      this.swapped.push({ mesh, original, glowing: list });
    });
  }

  public hide(): void {
    if (!this.current && this.swapped.length === 0) return;

    for (const entry of this.swapped) {
      entry.mesh.material = entry.original;
      for (const material of entry.glowing) material.dispose();
    }
    this.swapped.length = 0;
    this.emissives.length = 0;
    this.current = null;
  }

  /** One frame: breathes the glow so it reads as alive rather than painted on. */
  public update(deltaSeconds: number): void {
    if (this.emissives.length === 0) return;
    this.elapsed += deltaSeconds;
    const wave = 0.5 + 0.5 * Math.sin(this.elapsed * PULSE_RATE);
    const intensity = PULSE_MIN + (PULSE_MAX - PULSE_MIN) * wave;
    for (const material of this.emissives) material.emissiveIntensity = intensity;
  }

  /** The object currently glowing, for tests and the debug overlay. */
  public getTarget(): THREE.Object3D | null {
    return this.current;
  }
}
