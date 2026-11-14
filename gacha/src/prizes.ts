import * as THREE from 'three';

export type Rarity = 'common' | 'rare' | 'legendary';

export type EarShape = 'round' | 'tall' | 'pointy' | 'horn';

export interface PrizeSpec {
  id: string;
  name: string;
  rarity: Rarity;
  ear: EarShape;
  body: string;
  accent: string;
  capTop: string;
  capBottom: string;
  /** A line of flavour copy. The name plate does not show it — it is kept
   *  here for the collection drawer and for whoever wants to bring it back. */
  note: string;
}

export const PRIZES: PrizeSpec[] = [
  {
    id: 'bear',
    name: 'Gumdrop Bear',
    rarity: 'common',
    ear: 'round',
    body: '#a9705c',
    accent: '#e4bca4',
    capTop: '#e6deca',
    capBottom: '#ce6b5a',
    note: 'Rides at the top of the pile. Waves at anyone who looks up.',
  },
  {
    id: 'cat',
    name: 'Kettle Cat',
    rarity: 'common',
    ear: 'pointy',
    body: '#e08a4e',
    accent: '#f6e3cb',
    capTop: '#ce6b5a',
    capBottom: '#e6deca',
    note: 'Sleeps in the coin return. Nobody has seen it move.',
  },
  {
    id: 'rabbit',
    name: 'Paper Rabbit',
    rarity: 'common',
    ear: 'tall',
    body: '#efe3ce',
    accent: '#d8705f',
    capTop: '#bcc983',
    capBottom: '#e6deca',
    note: 'Folded out of the coin wrapper. Refuses to unfold.',
  },
  {
    id: 'fox',
    name: 'Rust Fox',
    rarity: 'rare',
    ear: 'pointy',
    body: '#d0603f',
    accent: '#f6e3cb',
    capTop: '#ce6b5a',
    capBottom: '#bcc983',
    note: 'Turns up in the capsule more often than the odds allow.',
  },
  {
    id: 'deer',
    name: 'Antler Doe',
    rarity: 'rare',
    ear: 'horn',
    body: '#c9a06b',
    accent: '#f6e3cb',
    capTop: '#e6deca',
    capBottom: '#ce6b5a',
    note: 'Found the machine first. Insisted on paying for its own capsule.',
  },
  {
    id: 'spirit',
    name: 'Lavender Spirit',
    rarity: 'legendary',
    ear: 'round',
    body: '#b3a6d6',
    accent: '#f6e3cb',
    capTop: '#b3a6d6',
    capBottom: '#e6deca',
    note: 'One per machine, they say. This one has been here a while.',
  },
];

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#8d8577',
  rare: '#3b7ea1',
  legendary: '#c08a2e',
};

/**
 * The halo around a revealed prize. Brighter than the rarity colour: this one
 * has to read as light against the pale background, not as a label.
 */
export const RARITY_GLOW: Record<Rarity, string> = {
  common: '#d8d1c0',
  rare: '#63b6e0',
  legendary: '#f0bf4a',
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  legendary: 'Legendary',
};

export const RARITY_ODDS: Record<Rarity, number> = {
  common: 0.6,
  rare: 0.3,
  legendary: 0.1,
};

export function rollPrize(random: () => number = Math.random): PrizeSpec {
  const roll = random();
  if (roll < RARITY_ODDS.legendary) {
    const pool = PRIZES.filter((p) => p.rarity === 'legendary');
    return pool[Math.floor(random() * pool.length)];
  }
  if (roll < RARITY_ODDS.legendary + RARITY_ODDS.rare) {
    const pool = PRIZES.filter((p) => p.rarity === 'rare');
    return pool[Math.floor(random() * pool.length)];
  }
  const pool = PRIZES.filter((p) => p.rarity === 'common');
  return pool[Math.floor(random() * pool.length)];
}

function flatShade(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(color), flatShading: true });
}

/** A small hard-edged contact shadow, offset from the light like the rest of the art. */
export function contactShadow(radius: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, 20);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x3a2a2c,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.002;
  mesh.renderOrder = 1;
  return mesh;
}

function buildEar(shape: EarShape, mat: THREE.Material): THREE.Object3D {
  const group = new THREE.Group();
  switch (shape) {
    case 'tall': {
      const geo = new THREE.CapsuleGeometry(0.055, 0.16, 4, 10);
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(geo, mat);
        ear.position.set(side * 0.075, 0.345, -0.01);
        ear.rotation.z = side * 0.16;
        group.add(ear);
      }
      break;
    }
    case 'pointy': {
      const geo = new THREE.ConeGeometry(0.07, 0.14, 4);
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(geo, mat);
        ear.position.set(side * 0.095, 0.245, 0.0);
        ear.rotation.z = side * 0.28;
        group.add(ear);
      }
      break;
    }
    case 'horn': {
      const geo = new THREE.CylinderGeometry(0.016, 0.026, 0.19, 6);
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(geo, mat);
        horn.position.set(side * 0.075, 0.31, 0.0);
        horn.rotation.z = side * 0.38;
        group.add(horn);
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.11, 6), mat);
        branch.position.set(side * 0.115, 0.36, 0.0);
        branch.rotation.z = side * 0.95;
        group.add(branch);
      }
      break;
    }
    default: {
      const geo = new THREE.SphereGeometry(0.062, 10, 8);
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(geo, mat);
        ear.position.set(side * 0.115, 0.155, 0.0);
        group.add(ear);
      }
      break;
    }
  }
  return group;
}

/** Builds the little creature that sits inside a capsule. */
export function buildPrize(spec: PrizeSpec): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = flatShade(spec.body);
  const accentMat = flatShade(spec.accent);
  const inkMat = flatShade('#2e1b1d');

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), bodyMat);
  body.scale.set(1.0, 0.94, 0.96);
  body.position.y = 0.17;
  group.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), accentMat);
  belly.scale.set(1.0, 1.0, 0.5);
  belly.position.set(0, 0.15, 0.125);
  group.add(belly);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), bodyMat);
  head.scale.set(1.0, 0.92, 0.95);
  head.position.y = 0.335;
  group.add(head);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), accentMat);
  muzzle.scale.set(1.0, 0.8, 0.6);
  muzzle.position.set(0, 0.30, 0.105);
  group.add(muzzle);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 6), inkMat);
    eye.position.set(side * 0.052, 0.355, 0.115);
    group.add(eye);
  }

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), inkMat);
  nose.scale.set(1.3, 0.8, 0.8);
  nose.position.set(0, 0.305, 0.142);
  group.add(nose);

  group.add(buildEar(spec.ear, bodyMat));

  group.userData.spec = spec;
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return group;
}

/**
 * A soft aura: a stack of concentric discs, each one fainter than the one
 * inside it. Ten hard-edged steps read as a smooth glow and keep the flat,
 * gradient-free look of the rest of the game — a radial-gradient sprite would
 * be the obvious way to do this and would break the art rules.
 *
 * The steps are deliberately faint. The creature covers the middle of the
 * stack, so the only part a player ever sees is the outer two or three rings;
 * push the per-disc opacity up and those few rings turn into a hard-edged
 * plate instead of light.
 */
export function buildAura(rarity: Rarity): THREE.Group {
  const color = RARITY_COLOR[rarity];
  const group = new THREE.Group();

  const STEPS = 10;
  const OUTER = 0.5;
  const materials: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < STEPS; i += 1) {
    const radius = OUTER * (1 - i / STEPS);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.062,
      depthWrite: false,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), mat);
    // Each step sits a hair behind the last so the blending order is fixed.
    disc.position.z = -0.02 - i * 0.002;
    group.add(disc);
    materials.push(mat);
  }

  for (const mat of materials) mat.userData.baseOpacity = mat.opacity;
  group.userData.materials = materials;
  return group;
}

/** Fades a whole subtree. Materials must already be transparent to fade. */
export function fadeGroup(root: THREE.Object3D, alpha: number): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshLambertMaterial;
    mat.transparent = true;
    mat.opacity = alpha;
    mat.depthWrite = alpha > 0.98;
  });
}

/** Frees the geometry and materials of a subtree that is leaving the scene. */
export function disposeGroup(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
}

/**
 * A gacha capsule: a two-tone ball with a seam band, split into opening halves.
 *
 * Each half hangs off a hinge at the *back* edge of the seam (`userData.topGroup`
 * / `bottomGroup` are those hinges, not the domes). Rotating a hinge about X
 * therefore swings its front rim apart from the other one, and the mouth of the
 * shell opens toward whoever is looking at it. Rotating a dome about its own
 * centre instead sweeps the rim across the middle of the capsule, which reads as
 * a hoop rather than as an opening.
 */
export function buildCapsule(top: string, bottom: string, radius = 0.135): THREE.Group {
  const group = new THREE.Group();
  const topMat = flatShade(top);
  const bottomMat = flatShade(bottom);
  const bandMat = flatShade('#e6deca');
  // A cream lining, seen only from the inside once the shell opens. BackSide so
  // it draws the inner face of a slightly smaller dome: the shell looks hollow
  // instead of showing the back of its own outer skin.
  const liningMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color('#ddd1b6'),
    flatShading: true,
    side: THREE.BackSide,
  });

  const hinge = radius * 0.92;

  const makeHalf = (thetaStart: number, mat: THREE.Material): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.z = -hinge;
    const shell = new THREE.Group();
    shell.position.z = hinge;
    shell.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(radius, 20, 12, 0, Math.PI * 2, thetaStart, Math.PI / 2),
        mat,
      ),
      new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.93, 20, 12, 0, Math.PI * 2, thetaStart, Math.PI / 2),
        liningMat,
      ),
    );
    pivot.add(shell);
    return pivot;
  };

  const topGroup = makeHalf(0, topMat);
  const bottomGroup = makeHalf(Math.PI / 2, bottomMat);

  // The seam band belongs to the lid: it is the rim you see swinging open.
  const band = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.995, radius * 0.085, 8, 24), bandMat);
  band.rotation.x = Math.PI / 2;
  (topGroup.children[0] as THREE.Group).add(band);

  group.add(topGroup, bottomGroup);
  // After the halves are attached — a traverse only reaches what is already in
  // the tree, and the capsule has to cast a shadow when it lands on the floor.
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  group.userData.topGroup = topGroup;
  group.userData.bottomGroup = bottomGroup;
  group.userData.radius = radius;
  return group;
}
