import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SunShadows } from '../src/game/render/SunShadows';

/**
 * A renderer that records what the shadow system asks of it.
 *
 * `SunShadows` only touches four things: the shadow map flags, the render
 * target, `render` and `autoClear`. Everything the class decides — when the
 * map is stale, what it takes out of three's own pass — is decided before any
 * of those are called, so this is enough to test the decisions.
 */
function stubRenderer() {
  const renderer = {
    shadowMap: {
      enabled: false,
      type: THREE.PCFShadowMap,
      autoUpdate: false,
      needsUpdate: false,
    },
    autoClear: true,
    setRenderTarget() {},
    getRenderTarget() {
      return null;
    },
    render() {},
    clear() {},
  };
  return renderer as unknown as THREE.WebGLRenderer & { shadowMap: { needsUpdate: boolean } };
}

function build() {
  const renderer = stubRenderer();
  const sun = new SunShadows(renderer, new THREE.Scene());
  return { renderer, sun };
}

describe('SunShadows', () => {
  it('rebuilds when the sun steps, not when the player shuffles', () => {
    const { renderer, sun } = build();
    const body = new THREE.Vector3(0, 0, 0);
    let now = 0;

    // The first frame has no map at all, so it must ask for one.
    sun.update(body, now, true, 16.7);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    renderer.shadowMap.needsUpdate = false;

    const settle = () => {
      for (let i = 0; i < 20; i++) {
        now += 16.7;
        sun.update(body, now, true, 16.7);
      }
    };

    // Standing still: the world has not changed.
    settle();
    expect(renderer.shadowMap.needsUpdate).toBe(false);

    // Half a metre is less than a stride and used to force a full rebuild —
    // 1423 draw calls — every step, which is the stutter this fixed.
    body.x += 0.5;
    settle();
    expect(renderer.shadowMap.needsUpdate).toBe(false);

    // A whole anchor step moves the light, so the map is genuinely stale.
    body.x += 7;
    settle();
    expect(renderer.shadowMap.needsUpdate).toBe(true);
  });

  it('does not rebuild while the game is paused', () => {
    const { renderer, sun } = build();
    const body = new THREE.Vector3(0, 0, 0);
    sun.update(body, 0, true, 16.7);
    renderer.shadowMap.needsUpdate = false;

    body.x += 40;
    for (let i = 0; i < 20; i++) sun.update(body, 1000 + i * 16.7, false, 16.7);
    expect(renderer.shadowMap.needsUpdate).toBe(false);
  });

  it('takes the moving casters out of three’s pass and onto their own layer', () => {
    const { sun } = build();
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const coat = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    body.castShadow = true;
    coat.castShadow = true;
    group.add(body, coat);
    group.add(new THREE.Group()); // a node with no geometry must be ignored

    sun.setDynamic([group]);
    (sun as unknown as { collectMovers(): void }).collectMovers();

    const moverLayer = new THREE.Layers();
    moverLayer.set(1);
    const worldLayer = new THREE.Layers();

    for (const mesh of [body, coat]) {
      // Out of three's own pass, or the world map would keep a frozen
      // silhouette of the character wherever the anchor last stepped.
      expect(mesh.castShadow).toBe(false);
      // On the composite's layer, and still on the world's.
      expect(mesh.layers.test(moverLayer)).toBe(true);
      expect(mesh.layers.test(worldLayer)).toBe(true);
    }
  });

  it('picks the movers up again after the player’s model is swapped', () => {
    const { sun } = build();
    const group = new THREE.Group();
    sun.setDynamic([group]);

    const first = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    first.castShadow = true;
    group.add(first);
    (sun as unknown as { collectMovers(): void }).collectMovers();
    expect(first.castShadow).toBe(false);

    // The roster arrows do exactly this: the child is replaced, and the new
    // model arrives with `castShadow` set by the loader.
    group.remove(first);
    const second = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    second.castShadow = true;
    group.add(second);

    (sun as unknown as { collectMovers(): void }).collectMovers();
    expect(second.castShadow).toBe(false);
    const moverLayer = new THREE.Layers();
    moverLayer.set(1);
    expect(second.layers.test(moverLayer)).toBe(true);
  });
});
