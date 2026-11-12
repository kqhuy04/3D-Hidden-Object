import * as THREE from 'three';

/**
 * "You've found …", written in the world under the thing you just picked up.
 *
 * Not a panel. The HUD already says the name in its list, and a card sliding in
 * over the corner is the interface congratulating itself. This is a caption that
 * belongs to the spot on the map where the object was: it appears there, turns
 * slowly so it reads as an object rather than a decal, and goes away on its own.
 *
 * ## Why two planes and not a sprite
 *
 * A sprite always faces the camera, which is the one thing this must not do —
 * the turn is the whole point. So it is a plane with a transparent texture, and
 * a second one behind it facing the other way: one plane seen from behind is
 * mirrored text, which looks like a bug the moment the player walks round it.
 *
 * ## The canvas is the interface's own type
 *
 * Cream on nothing, with the same hard offset shadow the title card uses (no
 * blur, ever). Transparent background, so the map shows through between the
 * letters instead of a black rectangle floating in the world.
 */

/** Seconds the label lives, including its fade. */
const LIFE = 3.4;
/** Seconds of fade at the end. */
const FADE = 0.7;
/**
 * Radians per second around its own axis.
 *
 * A full turn every nine seconds. The first version turned every four, which
 * was two turns over the caption's life — the player got it face-on for a third
 * of a second and then read it at sixty degrees, which is a caption that is
 * technically spinning and practically unreadable. This is slow enough to read
 * the whole way through and still obviously a turning object.
 */
const SPIN = 0.7;
/**
 * Metres the caption is wide, and the height that keeps its aspect.
 *
 * Sized for the camera that will actually see it: the boom stands eight metres
 * behind the body and the object is at arm's length in front, so the caption is
 * read from about nine or ten metres. The first pass at 2.1 m was a sliver on
 * screen — the name came out the size of a footnote — so the plane is wider and
 * the canvas is tighter around the same type.
 */
const WIDTH = 2.9;
const ASPECT = 0.5;

/** Canvas pixels. Twice the on-screen size, so it stays crisp up close. */
const CANVAS_W = 560;
const CANVAS_H = 280;

/** The interface's palette, so a caption in the world matches a caption on it. */
const PAPER = '#fdf8ec';
const INK = 'rgba(25, 21, 16, 0.85)';

function draw(name: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Everything is a fraction of the canvas, so the layout survives a change to
  // CANVAS_W without a second pass at the numbers.
  const cx = CANVAS_W / 2;
  const kickerY = CANVAS_H * 0.29;
  const ruleY = CANVAS_H * 0.42;
  const nameY = CANVAS_H * 0.62;

  // Hard offset shadow, no blur radius — the same rule the stylesheet follows.
  // Two passes rather than `shadowBlur`, which is a blur.
  const pass = (text: string, y: number, font: string, offset: number): void => {
    ctx.font = font;
    ctx.fillStyle = INK;
    ctx.fillText(text, cx + offset, y + offset);
    ctx.fillStyle = PAPER;
    ctx.fillText(text, cx, y);
  };

  pass('YOU\u2019VE FOUND', kickerY, `600 ${Math.round(CANVAS_H * 0.082)}px Consolas, Menlo, monospace`, 3);

  // The name can be long — "A flat-screen television" — so it is measured and
  // stepped down rather than allowed to run off the edge of its own texture.
  let size = Math.round(CANVAS_H * 0.26);
  const font = (px: number): string => `${px}px Georgia, "Times New Roman", serif`;
  ctx.font = font(size);
  while (ctx.measureText(name).width > CANVAS_W - 40 && size > 26) {
    size -= 4;
    ctx.font = font(size);
  }
  pass(name, nameY, font(size), 4);

  // A short rule between the two lines, rust, like every other heading rule in
  // the game. Ink under it, offset by the same three pixels the type is.
  const ruleW = Math.round(CANVAS_W * 0.09);
  const ruleH = Math.max(2, Math.round(CANVAS_H * 0.012));
  ctx.fillStyle = INK;
  ctx.fillRect(cx - ruleW / 2 + 3, ruleY + 3, ruleW, ruleH);
  ctx.fillStyle = '#b0472a';
  ctx.fillRect(cx - ruleW / 2, ruleY, ruleW, ruleH);

  return canvas;
}

export class FoundLabel {
  private group: THREE.Group | null = null;
  private materials: THREE.MeshBasicMaterial[] = [];
  private geometry: THREE.PlaneGeometry | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private elapsed = 0;
  private baseY = 0;

  /**
   * Puts the caption under `at` — the spot the object was taken from.
   *
   * `scene` is where it lives: the object itself is removed from the world the
   * same frame, so parenting to it would take the caption with it.
   *
   * `facing` is where the camera is, and it is not decoration: the caption turns
   * on its own axis, so without a starting angle it can appear edge-on — the
   * first version was a white sliver for a quarter of a second, which is a
   * congratulation the player does not get to read.
   */
  public show(
    name: string,
    at: THREE.Vector3,
    scene: THREE.Object3D,
    facing?: THREE.Vector3
  ): void {
    this.clear();

    this.texture = new THREE.CanvasTexture(draw(name));
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.geometry = new THREE.PlaneGeometry(WIDTH, WIDTH * ASPECT);

    const group = new THREE.Group();
    group.position.copy(at);
    // A plane faces +Z, so pointing +Z at the camera is the whole start angle.
    if (facing) group.rotation.y = Math.atan2(facing.x - at.x, facing.z - at.z);

    // Front and back, so the turn never shows mirrored letters.
    for (const turn of [0, Math.PI]) {
      const material = new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        toneMapped: false,
      });
      const plane = new THREE.Mesh(this.geometry, material);
      plane.rotation.y = turn;
      // Above the props on the floor it was sitting on, and never lit: a
      // caption that goes dark in a shadow is a caption that has stopped
      // telling the player what they found.
      plane.castShadow = false;
      plane.receiveShadow = false;
      group.add(plane);
      this.materials.push(material);
    }

    scene.add(group);
    this.group = group;
    this.baseY = at.y;
    this.elapsed = 0;
  }

  /** One frame: turn, drift a little, and fade out at the end. */
  public update(deltaSeconds: number): void {
    const group = this.group;
    if (!group) return;

    this.elapsed += deltaSeconds;
    group.rotation.y += SPIN * deltaSeconds;
    group.position.y = this.baseY + Math.sin(this.elapsed * 1.8) * 0.04;

    const left = LIFE - this.elapsed;
    if (left <= 0) {
      this.clear();
      return;
    }
    if (left < FADE) {
      const opacity = left / FADE;
      for (const material of this.materials) material.opacity = opacity;
    }
  }

  public clear(): void {
    if (this.group) {
      this.group.removeFromParent();
      this.group = null;
    }
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.geometry?.dispose();
    this.geometry = null;
    this.texture?.dispose();
    this.texture = null;
    this.elapsed = 0;
  }

  /** True while a caption is on screen, for tests and the debug overlay. */
  public get isShowing(): boolean {
    return this.group !== null;
  }
}
