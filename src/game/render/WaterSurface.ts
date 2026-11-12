import * as THREE from 'three';

/**
 * The underside of the sea, for maps that are under it.
 *
 * A flat plane of the fog colour is what an underwater map looks like when you
 * forget to give it a surface: the reef reads as a room with the ceiling
 * painted over. What sells it is not detail — it is *movement overhead* and a
 * hard brightness difference between the water you are in and the water the sun
 * is hitting.
 *
 * ## Why a shader and not a texture
 *
 * A caustics texture would need an asset, a UV layout that matches every map,
 * and a scroll direction that does not obviously repeat. Two sines multiplied
 * together give a slow interference pattern with no repeat within a few hundred
 * metres and cost one draw call, and the same uniforms can tint it.
 *
 * The plane follows the player in XZ and keeps a fixed Y, so there is no edge
 * to walk out from under, and it is never culled.
 */

const VERTEX = /* glsl */ `
varying vec3 vWorld;
varying float vDistance;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vDistance = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCentre;
uniform float uTime;
uniform float uOpacity;

varying vec3 vWorld;
varying float vDistance;

void main() {
  // Two waves at different speeds and angles. Multiplying rather than adding
  // them is what produces the slow bright patches instead of a striped grid.
  float a = sin(vWorld.x * 0.21 + uTime * 0.6);
  float b = sin(vWorld.z * 0.17 - uTime * 0.45 + 1.7);
  float ripple = a * b;

  // Brightest where the two crests meet, and never fully dark, or the surface
  // reads as a hole rather than as water.
  float light = 0.72 + 0.28 * ripple;

  // Fade the far edge into the fog. Without this the plane ends on a line,
  // which is the one thing a body of water never does.
  float fade = 1.0 - smoothstep(70.0, 190.0, length(vWorld.xz - uCentre.xz));

  gl_FragColor = vec4(uColor * light, uOpacity * light * fade);
}
`;

export class WaterSurface {
  private mesh: THREE.Mesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private elapsed = 0;
  private surfaceY = 0;

  constructor(private scene: THREE.Scene) {}

  /**
   * Puts the surface `height` metres above the point the player is standing on.
   *
   * Height is a constant rather than a measurement of the map: every reef kit
   * is authored at the same scale, and a surface that sits at the depth the
   * designer drew is a surface the fog can actually be seen through.
   */
  public show(feetY: number, height = 15): void {
    this.hide();
    this.surfaceY = feetY + height;

    const geometry = new THREE.PlaneGeometry(420, 420, 1, 1);
    geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColor: { value: new THREE.Color(0x9fe4dc) },
        uCentre: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uOpacity: { value: 0.55 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // See `Weather`: a raw shader gets neither tone mapping nor the output
      // colour conversion, so these colours are picked as they should appear.
      toneMapped: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = this.surfaceY;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water-surface';
    this.scene.add(this.mesh);
  }

  public hide(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material?.dispose();
    this.mesh = null;
    this.material = null;
  }

  public update(deltaSeconds: number, centre: THREE.Vector3): void {
    if (!this.mesh || !this.material) return;
    this.elapsed += deltaSeconds;
    this.material.uniforms.uTime.value = this.elapsed;
    this.material.uniforms.uCentre.value.copy(centre);
    this.mesh.position.x = centre.x;
    this.mesh.position.z = centre.z;
    this.mesh.position.y = this.surfaceY;
  }

  public isShowing(): boolean {
    return this.mesh !== null;
  }

  public dispose(): void {
    this.hide();
  }
}
