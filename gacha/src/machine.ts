import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import machineUrl from '../assets/gacha-machine.glb?url';

export interface Machine {
  root: THREE.Group;
  /** Small mint push button on the control panel — the start control. */
  button: THREE.Object3D;
  /** Round mauve plate with the vertical coin slot cut through it. */
  coinPlate: THREE.Object3D;
  /** Hinge of the hatch covering the hole in the shelf. Rotate +90° about X
   *  to open it; it swings down the rear wall of the shaft. */
  hatch: THREE.Object3D;
  globeCapsules: THREE.Object3D[];
}

/**
 * Delivery anchors, in glTF space.
 *
 * `build_machine.py` works in Blender space, where a point (x, y, z) becomes
 * glTF (x, z, -y). Blender's -Y is the front of the machine, so in glTF the
 * front is +Z and "forward" is +Z. Keep these numbers in step with the model:
 * a capsule falls through the hatch in the shelf, down the shaft, then rolls
 * along the tunnel and out through the arch cut in the front face.
 */
export const CAPSULE_RADIUS = 0.125;
/** Centre of the hatch in the shelf — where the capsule appears. */
export const DROP_HOLE = new THREE.Vector3(-0.28, 1.09, -0.06);
/** Top face of the shelf; the capsule starts just above it, in the pile. */
export const SHELF_TOP = 1.16;
/** Floor of the shaft, which is also the floor of the tunnel. */
export const CAVITY_FLOOR = 0.30;
/** z of the cabinet's front face, where the arch opens. */
export const ARCH_MOUTH_Z = 0.44;
/** Hatch travel: 0 is closed and flush with the shelf, +90° is wide open. */
export const HATCH_OPEN = Math.PI / 2;

function find(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((node) => {
    if (!hit && node.name === name) hit = node;
  });
  return hit;
}

export async function loadMachine(): Promise<Machine> {
  const gltf = await new GLTFLoader().loadAsync(machineUrl);
  const root = gltf.scene;

  const button = find(root, 'Button');
  const coinPlate = find(root, 'CoinPlate');
  const hatch = find(root, 'HatchHinge');
  if (!button || !coinPlate || !hatch) {
    throw new Error('gacha-machine.glb is missing Button, CoinPlate or HatchHinge');
  }

  const globeCapsules: THREE.Object3D[] = [];
  root.traverse((node) => {
    if (/^Cap\d\d$/.test(node.name)) globeCapsules.push(node);
  });

  return { root, button, coinPlate, hatch, globeCapsules };
}

/** A coin disc that flies into the slot and vanishes. */
export function buildCoin(): THREE.Group {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.016, 20),
    new THREE.MeshLambertMaterial({ color: 0xcc6049, flatShading: true }),
  );
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.009, 6, 20),
    new THREE.MeshLambertMaterial({ color: 0x2e1b1d, flatShading: true }),
  );
  rim.rotation.x = Math.PI / 2;
  group.add(disc, rim);
  // Stand the disc on edge so it slides into the vertical slot.
  group.rotation.x = Math.PI / 2;
  return group;
}
