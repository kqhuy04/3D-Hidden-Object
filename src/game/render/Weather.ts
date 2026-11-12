import * as THREE from 'three';
import type { WeatherKind } from '../../data/mapMood';

/**
 * Falling weather: rain, snow, and the fog that stands in for both.
 *
 * ## One draw call, no CPU work
 *
 * The obvious implementation — a pool of meshes or sprites moved every frame on
 * the CPU — costs a thousand matrix updates a frame for something the player
 * never looks at directly. Instead every drop is a point whose position is
 * computed in the vertex shader from a fixed seed and a clock: the geometry is
 * uploaded once and never touched again, and the only per-frame work is setting
 * two uniforms.
 *
 * The drops wrap in a box centred on the player, so a 30 m cube of rain follows
 * the body around the map instead of needing to cover it. `mod` in the shader
 * does the wrap; the box is bigger than the fog can see through, so the edge is
 * never visible.
 *
 * ## Why the colours are display-space
 *
 * A raw `ShaderMaterial` does not get three's tone mapping or its output colour
 * conversion — those live in the fragment shader of the built-in materials, not
 * in the renderer. Left alone, a linear colour written by this shader would be
 * drawn about a stop brighter than the same colour on a prop. So the material is
 * marked `toneMapped: false` and the colours below are picked as they should
 * appear on screen. One less moving part, and the rain does not change when the
 * exposure does.
 */

interface KindSettings {
  count: number;
  /** Metres per second, downward. */
  fall: number;
  /** Metres per second, sideways. */
  drift: number;
  /** Point size in pixels at 10 m from the camera. Scaled by distance. */
  size: number;
  /** 1 draws a vertical bar, 0 draws a soft round flake. */
  streak: number;
  color: number;
  opacity: number;
}

const SETTINGS: Record<Exclude<WeatherKind, 'clear' | 'overcast' | 'mist'>, KindSettings> = {
  // 14 px at 10 m: a streak about a hand's width in front of the camera, and a
  // couple of pixels at the far end of the street, which is what rain does.
  rain: { count: 2600, fall: 17, drift: 2.2, size: 14, streak: 1, color: 0xc8d4e2, opacity: 0.5 },
  // Flakes are much smaller than drops read, and much slower.
  snow: { count: 1500, fall: 1.5, drift: 0.5, size: 5, streak: 0, color: 0xffffff, opacity: 0.85 },
  // Marine snow: the silt that drifts down through every cubic metre of sea.
  // Finer and slower than a flake, and it barely moves sideways — the sway in
  // the vertex shader does the rest. This is what tells the eye the camera is
  // under water before it has found the surface, and it is the cheapest part of
  // the effect by far.
  motes: { count: 1100, fall: 0.45, drift: 0.08, size: 2.5, streak: 0, color: 0xdff0ea, opacity: 0.5 },
};

/** Half-extent of the volume the drops live in, in metres. */
const BOX = new THREE.Vector3(30, 22, 30);

const VERTEX = /* glsl */ `
attribute vec3 aSeed;

uniform float uTime;
uniform vec3 uCentre;
uniform vec3 uBox;
uniform float uFall;
uniform float uDrift;
uniform float uSize;
uniform float uStreak;

varying float vFade;

void main() {
  vec3 p = aSeed;
  p.y -= uTime * uFall;
  p.x += uTime * uDrift;

  // Flakes wander; drops do not. The seed drives the phase so no two follow the
  // same path, which is what stops the field looking like a grid in motion.
  if (uStreak < 0.5) {
    p.x += sin(uTime * 0.9 + aSeed.z * 6.2831) * 0.9;
    p.z += cos(uTime * 0.7 + aSeed.x * 6.2831) * 0.9;
  }

  // Wrap into a box centred on the player. The seed can be anywhere; only its
  // position relative to the centre matters.
  vec3 rel = mod(p - uCentre + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCentre + rel;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  // uSize is the on-screen size at 10 m, so the field keeps its scale as the
  // camera moves instead of growing without bound as a drop approaches.
  gl_PointSize = max(1.5, uSize * (10.0 / max(-mv.z, 1.0)));

  // Fade the top and bottom of the column, so a drop never appears or vanishes
  // in mid-air inside the player's field of view.
  vFade = 1.0 - smoothstep(uBox.y * 0.3, uBox.y * 0.5, abs(rel.y));
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uStreak;
uniform float uOpacity;

varying float vFade;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float shape;

  if (uStreak > 0.5) {
    // A narrow vertical bar inside the square point sprite.
    shape = 1.0 - smoothstep(0.05, 0.12, abs(uv.x));
  } else {
    shape = 1.0 - smoothstep(0.18, 0.5, length(uv));
  }

  float alpha = shape * vFade * uOpacity;
  if (alpha <= 0.003) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

export class Weather {
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private kind: WeatherKind = 'clear';
  private elapsed = 0;

  constructor(private scene: THREE.Scene) {}

  public getKind(): WeatherKind {
    return this.kind;
  }

  public setKind(kind: WeatherKind): void {
    if (kind === this.kind && (this.points !== null || kind === 'clear')) return;
    this.kind = kind;
    this.disposePoints();

    const settings = SETTINGS[kind as keyof typeof SETTINGS];
    if (!settings) return;

    const seeds = new Float32Array(settings.count * 3);
    for (let i = 0; i < settings.count; i++) {
      seeds[i * 3] = Math.random() * BOX.x;
      seeds[i * 3 + 1] = Math.random() * BOX.y;
      seeds[i * 3 + 2] = Math.random() * BOX.z;
    }

    const geometry = new THREE.BufferGeometry();
    // `position` is never read — the vertex shader works from `aSeed` — but
    // three needs a position attribute to compute a draw range.
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(settings.count * 3), 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: new THREE.Vector3() },
        uBox: { value: BOX.clone() },
        uFall: { value: settings.fall },
        uDrift: { value: settings.drift },
        uSize: { value: settings.size },
        uStreak: { value: settings.streak },
        uColor: { value: new THREE.Color(settings.color) },
        uOpacity: { value: settings.opacity },
      },
      transparent: true,
      depthWrite: false,
      // See the note at the top of the file: a raw shader gets neither.
      toneMapped: false,
    });

    this.points = new THREE.Points(geometry, this.material);
    // The positions come from a uniform, so three's bounding sphere is a lie
    // and would cull the whole field the moment the camera turned away.
    this.points.frustumCulled = false;
    this.points.name = `weather-${kind}`;
    this.scene.add(this.points);
  }

  public update(deltaSeconds: number, centre: THREE.Vector3): void {
    if (!this.points || !this.material) return;
    this.elapsed += deltaSeconds;
    this.material.uniforms.uTime.value = this.elapsed;
    this.material.uniforms.uCentre.value.copy(centre);
  }

  private disposePoints(): void {
    if (!this.points) return;
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material?.dispose();
    this.points = null;
    this.material = null;
  }

  public dispose(): void {
    this.disposePoints();
    this.kind = 'clear';
  }
}
