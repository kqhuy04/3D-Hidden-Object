import * as THREE from 'three';

/**
 * The outline the selected object wears.
 *
 * ## Why not the emissive tint this replaces
 *
 * The previous version swapped in a clone of each material with an emissive
 * term and *breathed* it, and the user's verdict was immediate: "tôi ko muốn vật
 * được chọn nhấp nháy mà muốn viền sáng như cũ". A pulsing tint is also the one
 * highlight that changes the thing it is pointing at — a red phone booth at the
 * top of the pulse was an orange slab, which is telling the player where to look
 * by hiding what they are looking for.
 *
 * ## How the outline is drawn
 *
 * An inverted hull: a copy of the same geometry, expanded along its normals and
 * drawn with back faces only. The expansion pushes the copy's silhouette out by
 * a few centimetres, and because only its back faces are drawn, the object's own
 * front faces cover everything except that rim.
 *
 * It is not a post-processing pass, which matters — the `OutlinePass` that used
 * to live here is the reason this project has a "no composer" rule. It is one
 * extra draw call per selected mesh, on a frame that was already drawing that
 * mesh, and it cannot paint the whole screen white.
 *
 * The offset happens in *view* space by a fixed distance, so the rim is the same
 * thickness on a 20 cm lantern and a 2 m wagon, and it does not thicken as the
 * camera closes in. The thickness is scaled by the mesh's own radius, clamped,
 * because a fixed 3 cm is invisible on a wagon and a fat cartoon border on a
 * cup.
 */

/**
 * Warm white, the paper colour of the interface lifted a shade.
 *
 * It was rust. On the sand and timber of most kits a rust rim sat close enough
 * to the prop's own browns to disappear at a glance, which is the one thing a
 * highlight cannot do; white separates from every palette in the game and reads
 * as a drawn line rather than as part of the object. The user asked for it by
 * name: "tôi muốn chuyển thành viền trắng cho dễ nhìn".
 */
const OUTLINE_COLOR = 0xfff6e2;

/** Rim thickness as a fraction of the mesh's own bounding radius. */
const THICKNESS_RATIO = 0.075;
/** Floor and ceiling for that fraction, in metres. */
const MIN_THICKNESS = 0.025;
const MAX_THICKNESS = 0.11;

const VERTEX_SHADER = `
  uniform float thickness;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // View space, so the rim is a constant distance on screen: the same
    // centimetres on a prop at the player's feet and one across the street.
    mv.xyz += normalize(normalMatrix * normal) * thickness;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 color;
  void main() {
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

interface Hull {
  /** The mesh the hull was added to, so it can be removed from exactly there. */
  host: THREE.Mesh;
  hull: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export class TargetOutline {
  private hulls: Hull[] = [];
  private current: THREE.Object3D | null = null;
  private readonly color = new THREE.Color(OUTLINE_COLOR);

  /** The object currently outlined, for tests and the debug overlay. */
  public getTarget(): THREE.Object3D | null {
    return this.current;
  }

  public show(object: THREE.Object3D): void {
    if (this.current === object) return;
    this.hide();
    this.current = object;

    // Collected first, built second. Adding a hull *during* the traversal walks
    // into the hull, which is a mesh, which gets a hull of its own — the first
    // version of this recursed until the stack ran out.
    const meshes: THREE.Mesh[] = [];
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) meshes.push(mesh);
    });

    for (const mesh of meshes) {
      // A skinned mesh has no geometry of its own to copy: the hull would stand
      // in the bind pose while the animal walked out of it. Nothing the player
      // can select is skinned — the people and the horses are quiet or excluded
      // — so skipping is free rather than a compromise.
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) continue;

      const geometry = mesh.geometry as THREE.BufferGeometry;
      // No normals, no direction to push the rim along. A vertex-coloured kit
      // prop with flat shading still has them; this is only for the odd decal.
      if (!geometry.getAttribute('normal')) continue;

      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const radius = geometry.boundingSphere?.radius ?? 0.5;
      const thickness = Math.min(
        MAX_THICKNESS,
        Math.max(MIN_THICKNESS, radius * THICKNESS_RATIO)
      );

      const material = new THREE.ShaderMaterial({
        uniforms: {
          thickness: { value: thickness },
          color: { value: this.color },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        side: THREE.BackSide,
        // The rim is an overlay, not a solid: it is drawn after the rest of the
        // opaque scene and tested against it, so it can never cover something in
        // front of the object — and it writes no depth, so it cannot punch a
        // hole in the shadow or in the prop standing behind it either.
        depthWrite: false,
      });

      const hull = new THREE.Mesh(geometry, material);
      hull.castShadow = false;
      hull.receiveShadow = false;
      hull.frustumCulled = false;
      hull.renderOrder = 1;
      mesh.add(hull);

      this.hulls.push({ host: mesh, hull, material });
    }
  }

  public hide(): void {
    if (!this.current && this.hulls.length === 0) return;

    for (const entry of this.hulls) {
      entry.host.remove(entry.hull);
      // The geometry belongs to the host and is still in use; only the material
      // and the hull object are ours to throw away.
      entry.material.dispose();
    }
    this.hulls.length = 0;
    this.current = null;
  }

  /**
   * Kept so the frame loop has one call shape for "things that follow the
   * selection". The outline is deliberately static: a rim that moves is a rim
   * that reads as a bug on a still object.
   */
  public update(_deltaSeconds: number): void {
    // Nothing to animate.
  }
}
