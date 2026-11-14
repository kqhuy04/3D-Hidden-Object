import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  loadMachine,
  buildCoin,
  CAPSULE_RADIUS,
  DROP_HOLE,
  SHELF_TOP,
  CAVITY_FLOOR,
  ARCH_MOUTH_Z,
  HATCH_OPEN,
  type Machine,
} from './machine';
import { buildCapsule, buildAura, buildPrize, contactShadow, disposeGroup, fadeGroup, rollPrize, type PrizeSpec } from './prizes';
import { Ui } from './ui';
import { play, unlockAudio } from './audio';

const COLLECTION_KEY = 'design-gacha.collection';

/** Where a dispensed capsule comes to rest — just in front of the arch. */
const REST_Z = 0.95;

/**
 * How far in front of the camera the capsule stops for the reveal. The camera
 * itself never moves: the capsule flies to a point on the camera's own axis, so
 * it lands dead centre of the screen whatever angle the player is looking from.
 */
const REVEAL_DISTANCE = 1.5;

/**
 * Height of the middle of a prize above its own origin. The creature is built
 * standing on y = 0, so this is what the turning and the aura pivot around.
 */
const PRIZE_CENTRE = 0.22;

// --- renderer -------------------------------------------------------------

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe7e2d8);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(-1.55, 1.85, 4.35);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.95, 0.35);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 2.1;
controls.maxDistance = 5.6;
controls.maxPolarAngle = Math.PI * 0.52;
controls.minPolarAngle = Math.PI * 0.18;
controls.update();

// --- lighting + stage -----------------------------------------------------

scene.add(new THREE.AmbientLight(0xfff3e4, 0.68));
scene.add(new THREE.HemisphereLight(0xfff6e8, 0xbdb3a2, 0.6));

const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(2.0, 6.2, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -3;
sun.shadow.camera.right = 3;
sun.shadow.camera.top = 3.4;
sun.shadow.camera.bottom = -1;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 12;
sun.shadow.bias = -0.0006;
sun.shadow.radius = 1;
scene.add(sun);
scene.add(sun.target);
sun.target.position.set(0, 1, 0);

// Fill from the camera side so the front of the cabinet reads as bright as the
// model does in Blender; the sun rakes across it rather than hitting it.
const fill = new THREE.DirectionalLight(0xfff0dc, 0.95);
fill.position.set(-2.4, 2.4, 4.8);
scene.add(fill);

// A dim lamp inside the hollow cabinet. Without it the cavity is pure black and
// the arch reads as a flat panel instead of a hole the capsule falls through.
const cavityLamp = new THREE.PointLight(0xffd6ae, 0.28, 1.15, 2);
cavityLamp.position.set(-0.28, 0.6, 0.02);
scene.add(cavityLamp);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(18, 18),
  new THREE.MeshLambertMaterial({ color: 0xd9d2c6, flatShading: true }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const wall = new THREE.Mesh(
  new THREE.PlaneGeometry(18, 9),
  new THREE.MeshLambertMaterial({ color: 0xefe9dd, flatShading: true }),
);
wall.position.set(0, 4.5, -3.2);
wall.receiveShadow = true;
scene.add(wall);

// --- game state -----------------------------------------------------------

type Phase = 'need-coin' | 'need-press' | 'pressing' | 'dispense' | 'await' | 'opening' | 'revealed';

let machine: Machine;
let phase: Phase = 'need-coin';
let coins = 5;
const owned = new Set<string>(JSON.parse(localStorage.getItem(COLLECTION_KEY) ?? '[]') as string[]);

/** Rest position of the dome, in its parent's space, and the way it sinks. */
const buttonRest = new THREE.Vector3();
const buttonPressDir = new THREE.Vector3();
/** 0 = flush with the panel, 1 = pushed all the way in. */
const buttonDepth = { value: 0 };

/** Hatch travel, 0 closed .. HATCH_OPEN wide. */
const hatchAngle = { value: 0 };

interface GlobeBall {
  node: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}
const globeBalls: GlobeBall[] = [];
/** Seconds since the pile was thrown, or -1 when it is sitting still. */
let burstT = -1;
/** Seconds the pile has been below the rest speed, for the settle check. */
let burstRest = 0;

/** How long the capsules fly before they start settling. */
const BURST_FLY = 0.7;
/** Give up waiting for stillness after this long and just stop them. */
const BURST_SETTLE_MAX = 4.0;
/** Slower than this counts as at rest. */
const BURST_REST_SPEED = 0.06;
const BURST_GRAVITY = 7.0;
/** How much speed two capsules keep when they knock into each other. */
const BALL_BOUNCE = 0.18;

/**
 * The chamber's inner box in glTF space, already inset by the capsule radius:
 * shell half-width 0.52, front glass at z 0.432, back wall at z -0.36, shelf
 * top at 1.16 and chamber ceiling at 1.90.
 */
const GLOBE_X = 0.395;
const GLOBE_Z_BACK = -0.235;
const GLOBE_Z_FRONT = 0.307;
const GLOBE_Y_FLOOR = 1.285;
const GLOBE_Y_CEILING = 1.775;

interface Delivery {
  group: THREE.Group;
  spec: PrizeSpec;
  vy: number;
  vz: number;
  bounces: number;
  /** drop through the shelf hole, roll along the cabinet floor, fall, roll. */
  mode: 'drop' | 'roll-in' | 'fall' | 'roll' | 'rest';
  prize: THREE.Group | null;
  aura: THREE.Group | null;
  shadow: THREE.Mesh | null;
  /** Where the capsule was lying, so the prize can go home again later. */
  home: THREE.Vector3;
  /** Where the prize sits while it is being looked at, before any turning. */
  prizeBase: THREE.Vector3;
  /** True once the prize is flying home — the drag loop must let go of it. */
  dismissing: boolean;
}

let delivery: Delivery | null = null;
const shelf: THREE.Object3D[] = [];

/** The camera's look direction, refreshed every frame while revealing. */
const revealForward = new THREE.Vector3();

/** Drag-to-turn state for the prize on screen. */
const revealDrag = {
  active: false,
  lastX: 0,
  lastY: 0,
  yaw: 0,
  pitch: 0,
};

interface Confetto {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  life: number;
}
const confetti: Confetto[] = [];

// --- tween helper ---------------------------------------------------------

interface Tween {
  elapsed: number;
  duration: number;
  update: (k: number) => void;
  onDone?: () => void;
}
const tweens: Tween[] = [];

function tween(duration: number, update: (k: number) => void, onDone?: () => void): void {
  tweens.push({ elapsed: 0, duration, update, onDone });
}

function updateTweens(dt: number): void {
  for (let i = tweens.length - 1; i >= 0; i -= 1) {
    const t = tweens[i];
    t.elapsed += dt;
    const k = Math.min(1, t.elapsed / t.duration);
    t.update(k);
    if (k >= 1) {
      tweens.splice(i, 1);
      t.onDone?.();
    }
  }
}

// --- ui -------------------------------------------------------------------

function backToIdle(): void {
  phase = 'need-coin';
  ui.setHint('Insert a coin into the slot.');
  ui.setCoinEnabled(true);
  ui.setFloorNote('READY');
  controls.enabled = true;
}

const ui = new Ui({
  onCoin: () => {
    // A prize is on screen: the coin button sends it home and starts the next pull.
    if (phase === 'revealed') {
      dismissReveal();
      return;
    }
    insertCoin();
  },
  onCollection: () => {
    play('click');
    ui.openDrawer(owned);
  },
  onCloseDrawer: () => {
    play('click');
    ui.closeDrawer();
  },
});

ui.setCoins(coins);
ui.setCollected(owned);
ui.setFloorNote('READY');
ui.setHint('Insert a coin into the slot.');

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' && event.code !== 'Enter') return;
  event.preventDefault();
  if (phase === 'need-coin') insertCoin();
  else if (phase === 'need-press') pressButton();
  else if (phase === 'await') openCapsule();
  else if (phase === 'revealed') dismissReveal();
});

// --- actions --------------------------------------------------------------

function insertCoin(): void {
  if (phase !== 'need-coin') return;
  if (coins <= 0) {
    ui.setHint('No coins left. Open a capsule to earn more.');
    return;
  }
  unlockAudio();
  coins -= 1;
  ui.setCoins(coins);
  ui.setCoinEnabled(false);
  phase = 'need-press';
  ui.setHint('Now press the button.');
  ui.setFloorNote('PRESS THE BUTTON');

  const slot = machine.coinPlate.getWorldPosition(new THREE.Vector3());
  const coin = buildCoin();
  coin.position.set(slot.x + 0.75, slot.y + 0.55, slot.z + 1.1);
  scene.add(coin);
  play('coin');

  const start = coin.position.clone();
  tween(
    0.42,
    (k) => {
      const e = k * k * (3 - 2 * k);
      coin.position.lerpVectors(start, slot, e);
      coin.position.y += Math.sin(k * Math.PI) * 0.4;
      coin.rotation.z = k * 5;
      coin.scale.setScalar(1 - e * 0.3);
    },
    () => {
      tween(0.2, (k) => coin.scale.setScalar((1 - k) * 0.7), () => {
        scene.remove(coin);
      });
    },
  );
}

const easeInOut = (k: number): number => k * k * (3 - 2 * k);

/** The hatch swings down the rear wall of the shaft, out of the capsule's way. */
function openHatch(): void {
  play('click');
  const from = hatchAngle.value;
  tween(0.24, (k) => {
    hatchAngle.value = from + (HATCH_OPEN - from) * easeInOut(k);
  });
}

function closeHatch(): void {
  const from = hatchAngle.value;
  tween(0.36, (k) => {
    hatchAngle.value = from * (1 - easeInOut(k));
  });
}

/** The button is the start control: it sinks, clicks, and the machine runs. */
function pressButton(): void {
  if (phase !== 'need-press') return;
  phase = 'pressing';
  unlockAudio();
  play('turn');
  ui.setHint('The button clicks down...');
  ui.setFloorNote('DISPENSING');

  // The dome sinks into the panel, then springs back with a small overshoot.
  tween(
    0.09,
    (k) => {
      buttonDepth.value = k;
    },
    () => {
      tween(0.34, (k) => {
        const e = k < 0.55 ? k / 0.55 : 1 - (k - 0.55) / 0.45;
        buttonDepth.value = 1 - e;
      });
    },
  );

  // First the pile is thrown — nothing can fall while the hatch is shut.
  startBurst();

  tween(
    0.95,
    (k) => {
      const shake = Math.sin(k * Math.PI) * 0.014;
      machine.root.position.set(
        (Math.random() - 0.5) * shake * 2,
        0,
        (Math.random() - 0.5) * shake * 2,
      );
    },
    () => {
      machine.root.position.set(0, 0, 0);
    },
  );

  // Then the hatch opens under them, and one capsule drops down the shaft.
  tween(0.66, () => {}, openHatch);
  tween(1.02, () => {}, dispense);
}

function dispense(): void {
  phase = 'dispense';
  ui.setHint('Dispensing...');
  ui.setFloorNote('DISPENSING');

  const spec = rollPrize();
  const capsule = buildCapsule(spec.capTop, spec.capBottom, CAPSULE_RADIUS);
  // Start in the pile, right above the hole in the shelf.
  capsule.position.set(DROP_HOLE.x, SHELF_TOP + CAPSULE_RADIUS, DROP_HOLE.z);
  scene.add(capsule);

  delivery = {
    group: capsule,
    spec,
    vy: 0,
    vz: 0,
    bounces: 0,
    mode: 'drop',
    prize: null,
    aura: null,
    shadow: null,
    home: new THREE.Vector3(),
    prizeBase: new THREE.Vector3(),
    dismissing: false,
  };

  // Once the capsule is well down the shaft, shut the hatch again.
  tween(0.55, () => {}, closeHatch);
}

/** The point in front of the camera that sits exactly in the middle of the screen. */
function revealAnchor(out = new THREE.Vector3()): THREE.Vector3 {
  camera.getWorldDirection(revealForward);
  return out.copy(camera.position).addScaledVector(revealForward, REVEAL_DISTANCE);
}

/**
 * The reveal. The capsule leaves the floor, stops in the middle of the screen,
 * opens, the prize comes out of it, and the empty shell retreats and fades.
 * The prize stays there — the player turns it over with the mouse.
 */
function openCapsule(): void {
  if (phase !== 'await' || !delivery) return;
  phase = 'opening';
  ui.setFloorNote('');
  play('open');

  const group = delivery.group;
  const spec = delivery.spec;
  const anchor = revealAnchor();
  const from = group.position.clone();
  delivery.home.copy(from);

  const prize = buildPrize(spec);
  prize.position.copy(anchor);
  prize.scale.setScalar(0.001);
  prize.visible = false;
  scene.add(prize);
  delivery.prize = prize;

  const aura = buildAura(spec.rarity);
  aura.position.copy(anchor);
  aura.visible = false;
  scene.add(aura);
  delivery.aura = aura;

  // The camera must not move while the capsule flies to the middle of the
  // screen, or the composition falls apart.
  controls.enabled = false;

  // Away from the viewer. `revealForward` is the direction the camera looks, so
  // this is the vector that takes the shell *behind* the prize — using its
  // negative sends the shell straight at the lens, where it grows and covers
  // the creature before the fade can hide it.
  const retreat = revealForward.clone();

  // 1 — the capsule lifts off the floor and stops in front of the camera.
  tween(
    0.62,
    (k) => {
      const e = easeInOut(k);
      group.position.lerpVectors(from, anchor, e);
      group.position.y += Math.sin(k * Math.PI) * 0.22;
      group.scale.setScalar(1 + e * 0.34);
    },
    () => {
      // 2 — the shell cracks at the seam and swings open toward the camera,
      // and the creature comes up out of it, still small.
      const top = group.userData.topGroup as THREE.Group;
      const bottom = group.userData.bottomGroup as THREE.Group;
      // The creature is wider than the shell, so it cannot simply be pulled out
      // at full size: the halves would frame it instead of holding it. It
      // emerges at a size that fits and grows into the frame once the shell has
      // left — see beat 3.
      const shellR = (group.userData.radius as number) * group.scale.x;
      const feetIn = anchor.y - shellR * 0.62;
      const feetMid = anchor.y - PRIZE_CENTRE * 0.85;
      const small = 0.55;
      prize.visible = true;
      play('open');
      tween(
        0.5,
        (k) => {
          const e = 1 - Math.pow(1 - k, 3);
          // Both halves hang off a hinge at the back edge, so a rotation about
          // X swings their front rims apart: the mouth opens toward the viewer.
          top.rotation.x = -e * 0.95;
          bottom.rotation.x = e * 0.45;
          // Drift the shell behind the creature as it opens. The lower rim sits
          // 0.135 in front of the capsule's centre and the creature's belly only
          // 0.07, so without this the bowl is drawn over the prize's body for
          // the whole of beat 2.
          group.position.copy(anchor).addScaledVector(retreat, e * 0.16);
          prize.scale.setScalar(Math.max(0.001, e * small));
          prize.position.y = feetIn + (feetMid - feetIn) * e;
          aura.position.y = prize.position.y;
        },
        () => {
          // 3 — the empty shell keeps drifting away and fades, and the aura
          // blooms while the creature grows to its full size.
          const start = group.position.clone();
          const shellFrom = group.scale.x;
          const feetOut = anchor.y - PRIZE_CENTRE;
          fadeGroup(group, 1);
          aura.visible = true;
          tween(
            0.55,
            (k) => {
              const e = easeInOut(k);
              group.position.copy(start).addScaledVector(retreat, e * 0.8);
              // Shrinking as it goes keeps the open rim from looming over the
              // creature's head on the way out.
              group.scale.setScalar(shellFrom * (1 - e * 0.35));
              fadeGroup(group, Math.pow(1 - e, 0.7));
              prize.scale.setScalar(small + (1 - small) * e);
              prize.position.y = feetMid + (feetOut - feetMid) * e;
              aura.position.y = prize.position.y;
              const mats = aura.userData.materials as (THREE.Material & { opacity: number })[];
              for (const mat of mats) {
                const base = (mat.userData.baseOpacity as number) ?? 1;
                mat.opacity = base * e;
              }
            },
            () => {
              scene.remove(group);
              disposeGroup(group);

              // The prize is the player's now.
              owned.add(spec.id);
              localStorage.setItem(COLLECTION_KEY, JSON.stringify([...owned]));
              ui.setCollected(owned);
              coins += spec.rarity === 'common' ? 1 : 2;
              ui.setCoins(coins);
              burstConfetti(spec);
              play(
                spec.rarity === 'legendary'
                  ? 'legendary'
                  : spec.rarity === 'rare'
                    ? 'rare'
                    : 'reveal',
              );

              phase = 'revealed';
              ui.showReveal(spec);
              ui.setHint('Drag to turn your prize. Insert a coin to keep playing.');
              ui.setFloorNote('TURN IT OVER');
              ui.setCoinEnabled(true);
              revealDrag.yaw = 0;
              revealDrag.pitch = 0;
              revealDrag.active = false;
              delivery!.prizeBase.copy(prize.position);
              delivery!.dismissing = false;
            },
          );
        },
      );
    },
  );
}

/** Sends the prize back down to the floor and puts the game back to idle. */
function dismissReveal(): void {
  if (phase !== 'revealed' || !delivery) return;
  const prize = delivery.prize;
  const aura = delivery.aura;
  const home = delivery.home.clone();
  home.y = 0;

  delivery.dismissing = true;
  const from = prize ? prize.position.clone() : home.clone();
  const spinFrom = prize ? prize.rotation.clone() : null;
  tween(
    0.5,
    (k) => {
      const e = easeInOut(k);
      if (prize) {
        prize.position.lerpVectors(from, home, e);
        prize.position.y = from.y + (home.y - from.y) * e - Math.sin(k * Math.PI) * 0.1;
        // Straighten up on the way down, otherwise it lands on its head.
        if (spinFrom) {
          prize.rotation.set(
            spinFrom.x * (1 - e),
            spinFrom.y * (1 - e),
            spinFrom.z * (1 - e),
            'YXZ',
          );
        }
      }
      if (aura) {
        aura.position.lerpVectors(from, home, e);
        const mats = aura.userData.materials as (THREE.Material & { opacity: number })[];
        for (const mat of mats) mat.opacity = mat.opacity * (1 - e);
      }
    },
    () => {
      if (aura) {
        scene.remove(aura);
        disposeGroup(aura);
        delivery!.aura = null;
      }
      if (prize) {
        prize.rotation.x = 0;
        const shadow = contactShadow(0.17);
        shadow.position.set(home.x, 0.003, home.z);
        scene.add(shadow);
        shelf.push(prize, shadow);
        trimShelf();
      }
      ui.hideReveal();
      backToIdle();
      insertCoin();
    },
  );
}

function trimShelf(): void {
  while (shelf.length > 9) {
    const old = shelf.shift();
    if (!old) break;
    scene.remove(old);
  }
}

function burstConfetti(spec: PrizeSpec): void {
  const palette = [spec.capTop, spec.capBottom, spec.body, '#efe3ce'];
  for (let i = 0; i < 34; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.055, 0.075),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(palette[i % palette.length]),
        side: THREE.DoubleSide,
      }),
    );
    const origin = delivery?.group.position ?? new THREE.Vector3(0, 0.4, 0);
    mesh.position.copy(origin);
    mesh.position.y += 0.2;
    scene.add(mesh);
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.1 + Math.random() * 1.9;
    confetti.push({
      mesh,
      vx: Math.cos(angle) * speed,
      vy: 2.2 + Math.random() * 2.4,
      vz: Math.sin(angle) * speed,
      spin: (Math.random() - 0.5) * 12,
      life: 1.6 + Math.random() * 0.9,
    });
  }
}

// --- pointer: the button is the start control -----------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointer(event: PointerEvent): void {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function buttonScreenCentre(): THREE.Vector2 {
  const world = machine.button.getWorldPosition(new THREE.Vector3()).project(camera);
  return new THREE.Vector2(
    (world.x * 0.5 + 0.5) * window.innerWidth,
    (-world.y * 0.5 + 0.5) * window.innerHeight,
  );
}

canvas.addEventListener('pointerdown', (event) => {
  if (ui.drawerOpen) return;
  unlockAudio();
  updatePointer(event);

  // While a prize is on screen the whole canvas is a handle for turning it.
  if (phase === 'revealed') {
    revealDrag.active = true;
    revealDrag.lastX = event.clientX;
    revealDrag.lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    return;
  }

  if (phase === 'need-press' && raycaster.intersectObject(machine.button, true).length > 0) {
    pressButton();
    return;
  }

  if (phase === 'need-coin' && raycaster.intersectObject(machine.coinPlate, true).length > 0) {
    insertCoin();
    return;
  }

  if (phase === 'await' && delivery && raycaster.intersectObject(delivery.group, true).length > 0) {
    openCapsule();
  }
});

canvas.addEventListener('pointerup', (event) => {
  if (revealDrag.active) {
    revealDrag.active = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
  }
});

canvas.addEventListener('pointercancel', () => {
  revealDrag.active = false;
  canvas.style.cursor = '';
});

// Cursor feedback: the two things you can press get a pointer.
canvas.addEventListener('pointermove', (event) => {
  if (ui.drawerOpen) {
    canvas.style.cursor = '';
    return;
  }

  if (phase === 'revealed') {
    if (revealDrag.active) {
      const dx = event.clientX - revealDrag.lastX;
      const dy = event.clientY - revealDrag.lastY;
      revealDrag.lastX = event.clientX;
      revealDrag.lastY = event.clientY;
      revealDrag.yaw += dx * 0.012;
      revealDrag.pitch += dy * 0.01;
    } else {
      canvas.style.cursor = 'grab';
    }
    return;
  }

  updatePointer(event);
  const hot =
    (phase === 'need-press' && raycaster.intersectObject(machine.button, true).length > 0) ||
    (phase === 'need-coin' && raycaster.intersectObject(machine.coinPlate, true).length > 0) ||
    (phase === 'await' && !!delivery && raycaster.intersectObject(delivery.group, true).length > 0);
  canvas.style.cursor = hot ? 'pointer' : '';
});

// --- loop -----------------------------------------------------------------

const clock = new THREE.Clock();

function updateDelivery(dt: number): void {
  if (!delivery) return;
  const radius = delivery.group.userData.radius as number;
  const group = delivery.group;
  const spin = (speed: number): void => {
    group.rotation.x += (speed / radius) * dt;
  };

  if (delivery.mode === 'drop') {
    // Falls out of the pile, through the hole in the shelf.
    delivery.vy -= 11 * dt;
    group.position.y += delivery.vy * dt;
    spin(Math.abs(delivery.vy));
    const target = CAVITY_FLOOR + radius;
    if (group.position.y <= target) {
      group.position.y = target;
      delivery.vy = 0;
      delivery.vz = 1.15;
      delivery.mode = 'roll-in';
      play('drop');
    }
  } else if (delivery.mode === 'roll-in') {
    // Rolls forward across the hollow floor, towards the arch.
    group.position.z += delivery.vz * dt;
    spin(delivery.vz);
    if (group.position.z >= ARCH_MOUTH_Z) {
      group.position.z = ARCH_MOUTH_Z;
      delivery.mode = 'fall';
      delivery.vy = 0;
    }
  } else if (delivery.mode === 'fall') {
    // Out of the arch and down onto the floor in front of the machine.
    delivery.vy -= 11 * dt;
    group.position.y += delivery.vy * dt;
    group.position.z += delivery.vz * dt;
    spin(delivery.vz);
    if (group.position.y <= radius) {
      group.position.y = radius;
      if (delivery.bounces < 2 && Math.abs(delivery.vy) > 0.9) {
        delivery.vy = -delivery.vy * 0.4;
        delivery.bounces += 1;
        play('drop');
      } else {
        delivery.vy = 0;
        delivery.mode = 'roll';
      }
    }
  } else if (delivery.mode === 'roll') {
    delivery.vz = Math.max(0, delivery.vz - 2.4 * dt);
    group.position.z = Math.min(REST_Z, group.position.z + delivery.vz * dt);
    spin(delivery.vz);
    if (group.position.z >= REST_Z || delivery.vz <= 0.01) {
      group.position.z = Math.min(group.position.z, REST_Z);
      delivery.vz = 0;
      delivery.mode = 'rest';
      group.rotation.x = 0;
      phase = 'await';
      ui.setHint('Click the capsule to open it.');
      ui.setFloorNote('AWAITING YOU');
    }
  }
}

function updateConfetti(dt: number): void {
  for (let i = confetti.length - 1; i >= 0; i -= 1) {
    const c = confetti[i];
    c.vy -= 7.5 * dt;
    c.mesh.position.x += c.vx * dt;
    c.mesh.position.y += c.vy * dt;
    c.mesh.position.z += c.vz * dt;
    c.mesh.rotation.z += c.spin * dt;
    c.mesh.rotation.x += c.spin * 0.6 * dt;
    c.life -= dt;
    const mat = c.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, Math.min(1, c.life));
    if (c.life <= 0) {
      scene.remove(c.mesh);
      mat.dispose();
      confetti.splice(i, 1);
    }
  }
}

function updateButton(): void {
  machine.button.position
    .copy(buttonRest)
    .addScaledVector(buttonPressDir, buttonDepth.value * 0.03);
}

function updateHatch(): void {
  machine.hatch.rotation.x = hatchAngle.value;
}

/** Kick every capsule in the chamber off in its own direction. */
function startBurst(): void {
  burstT = 0;

  // The middle of the heap. Each capsule is also shoved away from it, so the
  // pile spreads across the whole shelf instead of erupting straight up in the
  // spot it was already sitting in — otherwise every pull leaves the same
  // clump in the same corner.
  const centre = new THREE.Vector3();
  for (const ball of globeBalls) centre.add(ball.node.position);
  centre.divideScalar(Math.max(1, globeBalls.length));

  for (const ball of globeBalls) {
    const p = ball.node.position;
    const out = new THREE.Vector3(p.x - centre.x, 0, p.z - centre.z);
    if (out.lengthSq() < 1e-4) {
      const a = Math.random() * Math.PI * 2;
      out.set(Math.cos(a), 0, Math.sin(a));
    }
    out.normalize().multiplyScalar(0.05 + Math.random() * 0.18);

    // Almost straight up. The capsules only have to *look* thrown: anything
    // more sideways carries them across the shelf, where eleven of them fit in
    // one flat layer and the heap is gone. Straight up, they come back down on
    // each other and the pile stays a pile.
    ball.vel.set(
      out.x + (Math.random() - 0.5) * 0.32,
      1.5 + Math.random() * 1.3,
      out.z + (Math.random() - 0.5) * 0.32,
    );
    ball.spin.set(
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 20,
    );
  }
}

/** Bounce one capsule off the glass, the back wall, the shelf and the ceiling. */
function bounceBall(ball: GlobeBall): void {
  const p = ball.node.position;

  if (p.x < -GLOBE_X) {
    p.x = -GLOBE_X;
    if (ball.vel.x < 0) ball.vel.x = -ball.vel.x * 0.45;
  } else if (p.x > GLOBE_X) {
    p.x = GLOBE_X;
    if (ball.vel.x > 0) ball.vel.x = -ball.vel.x * 0.45;
  }

  if (p.z < GLOBE_Z_BACK) {
    p.z = GLOBE_Z_BACK;
    if (ball.vel.z < 0) ball.vel.z = -ball.vel.z * 0.45;
  } else if (p.z > GLOBE_Z_FRONT) {
    p.z = GLOBE_Z_FRONT;
    if (ball.vel.z > 0) ball.vel.z = -ball.vel.z * 0.45;
  }

  // The shelf is dead-ish: a capsule dropped on it gives one small hop and
  // stops. Anything bouncier keeps the heap alive for seconds.
  if (p.y < GLOBE_Y_FLOOR) {
    p.y = GLOBE_Y_FLOOR;
    if (ball.vel.y < 0) ball.vel.y = -ball.vel.y * 0.28;
    ball.vel.x *= 0.78;
    ball.vel.z *= 0.78;
  } else if (p.y > GLOBE_Y_CEILING) {
    p.y = GLOBE_Y_CEILING;
    if (ball.vel.y > 0) ball.vel.y = -ball.vel.y * 0.35;
  }
}

/**
 * One pass of capsule-against-capsule: push the pair apart *and* kill the
 * speed at which they were closing. Without the impulse response a ball that
 * lands on another sinks in, gets shoved back out, sinks in again — the pile
 * never comes to rest, and the only way to stop it is the teleport this used
 * to end with.
 */
function collideBalls(): void {
  const d = CAPSULE_RADIUS * 2;
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < globeBalls.length; i += 1) {
      const a = globeBalls[i];
      for (let j = i + 1; j < globeBalls.length; j += 1) {
        const b = globeBalls[j];
        const pa = a.node.position;
        const pb = b.node.position;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dz = pb.z - pa.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= d * d || d2 < 1e-9) continue;

        const dist = Math.sqrt(d2);
        let nx = dx / dist;
        let ny = dy / dist;
        let nz = dz / dist;

        // A capsule landing on another must stack, not roll off. Resolving the
        // contact along its true normal shoves the upper capsule sideways by
        // half the overlap every frame, and it always slides down to the shelf
        // — eleven capsules then spread into one flat layer and the heap is
        // gone. When the contact is mostly vertical, resolve it vertically.
        if (Math.abs(ny) > 0.5) {
          nx = 0;
          nz = 0;
          ny = ny > 0 ? 1 : -1;
        }

        const push = (d - dist) * 0.5;
        pa.x -= nx * push;
        pa.y -= ny * push;
        pa.z -= nz * push;
        pb.x += nx * push;
        pb.y += ny * push;
        pb.z += nz * push;

        const closing = (a.vel.x - b.vel.x) * nx
          + (a.vel.y - b.vel.y) * ny
          + (a.vel.z - b.vel.z) * nz;
        if (closing > 0) {
          const j2 = ((1 + BALL_BOUNCE) * closing) / 2;
          a.vel.x -= nx * j2;
          a.vel.y -= ny * j2;
          a.vel.z -= nz * j2;
          b.vel.x += nx * j2;
          b.vel.y += ny * j2;
          b.vel.z += nz * j2;
        }
      }
    }
  }
}

/**
 * Nudge anything sitting over the drop hole away from it. A shove rather than a
 * teleport: the machine has to be able to drop a capsule, but the player must
 * never see a ball jump.
 */
function clearHole(dt: number): void {
  const holeClear = CAPSULE_RADIUS + 0.06;
  const k = Math.min(1, dt * 9);
  for (const ball of globeBalls) {
    const p = ball.node.position;
    const dx = p.x - DROP_HOLE.x;
    const dz = p.z - DROP_HOLE.z;
    const away = Math.hypot(dx, dz);
    if (away >= holeClear) continue;
    const nx = away < 1e-4 ? 1 : dx / away;
    const nz = away < 1e-4 ? 0 : dz / away;
    p.x += nx * (holeClear - away) * k;
    p.z += nz * (holeClear - away) * k;
  }
}

function updateGlobeBurst(dt: number): void {
  if (burstT < 0) return;
  burstT += dt;

  const thrown = burstT < BURST_FLY;
  // Thrown: no drag, so they fly. Settling: the sideways drift bleeds off, so
  // the heap stops sliding instead of drifting around the shelf for ever.
  const drag = thrown ? 1 : Math.exp(-dt * 3.5);

  for (const ball of globeBalls) {
    ball.vel.y -= BURST_GRAVITY * dt;
    ball.vel.x *= drag;
    ball.vel.z *= drag;
    ball.node.position.addScaledVector(ball.vel, dt);
  }

  collideBalls();
  for (const ball of globeBalls) bounceBall(ball);

  if (!thrown) {
    // Nothing pulls the heap anywhere. An earlier version had a funnel towards
    // the middle of the shelf; it kept the pile compact but the player could
    // watch the capsules slide inward after every burst, which reads as a
    // magnet, not as a machine. The pile now stops wherever it lands.
    clearHole(dt);
  }

  if (thrown) {
    for (const ball of globeBalls) {
      ball.node.rotation.x += ball.spin.x * dt;
      ball.node.rotation.y += ball.spin.y * dt;
      ball.node.rotation.z += ball.spin.z * dt;
    }
    return;
  }

  // The pile is at rest when nothing is moving any more.
  let fastest = 0;
  for (const ball of globeBalls) fastest = Math.max(fastest, ball.vel.length());
  burstRest = fastest < BURST_REST_SPEED ? burstRest + dt : 0;

  if (burstRest > 0.2 || burstT > BURST_SETTLE_MAX) {
    for (const ball of globeBalls) ball.vel.set(0, 0, 0);
    burstT = -1;
    burstRest = 0;
  }
}

/**
 * The prize on screen: turns under the player's mouse, and drifts slowly on
 * its own once they stop touching it.
 */
/**
 * The prize on screen: it turns with the mouse and nothing else. No auto-spin —
 * a prize that drifts on its own fights the player who is trying to look at one
 * particular side of it.
 */
function updateReveal(): void {
  if (phase !== 'revealed' || !delivery?.prize || delivery.dismissing) return;
  const prize = delivery.prize;

  // YXZ: turn about the vertical first, then tip. With the default XYZ order
  // the tilt axis rotates with the turn and a full flip tumbles sideways.
  prize.rotation.set(revealDrag.pitch, revealDrag.yaw, 0, 'YXZ');

  // Turn it about the middle of the creature, not about its feet — the origin
  // sits at the bottom of the capsule, so a naive rotation swings the whole
  // body out of frame the moment you tip it.
  const offset = new THREE.Vector3(0, PRIZE_CENTRE, 0);
  const turned = offset.clone().applyEuler(prize.rotation);
  prize.position.copy(delivery.prizeBase).add(offset).sub(turned);

  if (delivery.aura) {
    camera.getWorldDirection(revealForward);
    delivery.aura.quaternion.copy(camera.quaternion);
    // The centre is the one point the turning never moves.
    delivery.aura.position
      .copy(delivery.prizeBase)
      .add(offset)
      .addScaledVector(revealForward, 0.06);

    // A slow breath, so the aura reads as light rather than as a painted disc.
    const pulse = 1 + Math.sin(performance.now() * 0.0016) * 0.035;
    delivery.aura.scale.setScalar(pulse);
  }
}

function animate(): void {
  requestAnimationFrame(animate);
  const raw = clock.getDelta();
  // Tweens run on wall-clock time so a slow frame rate delays the drawing but
  // never stretches the choreography; only the physics step is clamped.
  const dt = Math.min(raw, 0.05);
  const animDt = Math.min(raw, 0.25);

  updateTweens(animDt);
  updateDelivery(dt);
  updateConfetti(dt);
  updateButton();
  updateHatch();
  updateGlobeBurst(dt);
  updateReveal();

  controls.update();
  renderer.render(scene, camera);
}

// --- boot -----------------------------------------------------------------

async function boot(): Promise<void> {
  machine = await loadMachine();
  scene.add(machine.root);

  machine.root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) {
      // The glass must not cast a shadow: a transparent material still blocks
      // the sun completely, which leaves the chamber flatly lit and the heap
      // with no contact shadow under it — the capsules read as hovering.
      mesh.castShadow = !node.name.startsWith('Glass');
      mesh.receiveShadow = true;
    }
  });

  // The dome sinks straight back into the panel. Work out that direction in the
  // button's own parent space so it holds whatever transform the exporter baked.
  machine.root.updateWorldMatrix(true, true);
  const parent = machine.button.parent;
  const world = machine.button.getWorldPosition(new THREE.Vector3());
  const toLocal = (v: THREE.Vector3): THREE.Vector3 =>
    parent ? parent.worldToLocal(v.clone()) : v.clone();
  const here = toLocal(world);
  const ahead = toLocal(world.clone().add(new THREE.Vector3(0, 0, 1)));
  buttonRest.copy(here);
  buttonPressDir.copy(ahead).sub(here).normalize().multiplyScalar(-1);

  for (const capsule of machine.globeCapsules) {
    globeBalls.push({
      node: capsule,
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(),
    });
  }

  const box = new THREE.Box3().setFromObject(machine.root);
  const size = box.getSize(new THREE.Vector3());
  console.log(
    `gacha machine loaded, size ${size.toArray().map((v) => v.toFixed(2)).join(' x ')}`,
  );
  console.log('button press dir', buttonPressDir.toArray().map((v) => v.toFixed(2)).join(', '));

  // Test hook: the harness drives the machine through this instead of guessing
  (window as unknown as Record<string, unknown>).__gacha = {
    press: pressButton,
    open: openCapsule,
    capsule: () => delivery?.group.position ?? null,
    phase: () => phase,
    hatch: () => hatchAngle.value,
    buttonScreen: () => buttonScreenCentre(),
    balls: () => globeBalls.map((b) => b.node.position.toArray()),
    anchor: () => {
      const a = revealAnchor();
      return { world: a.toArray(), ndc: a.clone().project(camera).toArray() };
    },
    prize: () => (delivery?.prize ? delivery.prize.position.toArray() : null),
    prizeNdc: () => (delivery?.prize ? delivery.prize.position.clone().project(camera).toArray() : null),
    prizeScreen: () => {
      if (!delivery?.prize) return null;
      const v = delivery.prize.position.clone().project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      };
    },
    prizeRotation: () => (delivery?.prize ? delivery.prize.rotation.toArray() : null),
    /** Everything the reveal choreography touches, in one call. */
    reveal: () => {
      if (!delivery) return null;
      const shell = delivery.group;
      return {
        shell: {
          scale: shell.scale.x,
          position: shell.position.toArray(),
          lid: (shell.userData.topGroup as THREE.Group).rotation.x,
          bowl: (shell.userData.bottomGroup as THREE.Group).rotation.x,
          inScene: shell.parent !== null,
        },
        prize: delivery.prize
          ? {
              scale: delivery.prize.scale.x,
              position: delivery.prize.position.toArray(),
              visible: delivery.prize.visible,
            }
          : null,
      };
    },
    camera,
  };

  animate();
}

void boot();
