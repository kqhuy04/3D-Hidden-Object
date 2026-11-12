import * as THREE from 'three';
import { Player } from '../game/player/Player';
import { CameraController } from '../game/player/CameraController';
import { RoundManager } from '../game/missions/RoundManager';
import { HiddenItemSystem } from '../game/missions/HiddenItemSystem';

export class DebugOverlay {
  private container: HTMLDivElement | null = null;
  private isEnabled = false;
  private lastTime = performance.now();
  private frames = 0;
  private fps = 60;

  constructor() {
    const urlParams = new URLSearchParams(window.location.search);
    this.isEnabled = urlParams.get('debug') === '1';

    if (this.isEnabled) {
      this.createOverlay();
    }
  }

  private createOverlay(): void {
    this.container = document.createElement('div');
    this.container.id = 'debug-overlay';
    this.container.style.position = 'fixed';
    this.container.style.top = '10px';
    this.container.style.right = '10px';
    this.container.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
    this.container.style.color = '#00ff88';
    this.container.style.fontFamily = 'monospace';
    this.container.style.fontSize = '12px';
    this.container.style.padding = '10px 14px';
    this.container.style.borderRadius = '8px';
    this.container.style.pointerEvents = 'none';
    this.container.style.zIndex = '9999';
    this.container.style.lineHeight = '1.4';
    document.body.appendChild(this.container);
  }

  public update(
    renderer: THREE.WebGLRenderer,
    player: Player,
    cameraController: CameraController,
    roundManager: RoundManager,
    hidden: HiddenItemSystem
  ): void {
    if (!this.isEnabled || !this.container) return;

    this.frames++;
    const now = performance.now();
    if (now - this.lastTime >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastTime));
      this.frames = 0;
      this.lastTime = now;
    }

    const pos = player.getPosition();
    const yaw = cameraController.getYaw();
    const pitch = cameraController.getPitch();
    const info = renderer.info;

    // Distances are a development aid: they make it obvious when an object has
    // been placed under the floor or a hundred metres off the intended spot.
    const itemStatus = hidden
      .getItems()
      .map((item) => {
        const d = Math.hypot(item.centre.x - pos.x, item.centre.z - pos.z);
        const name = item.found ? item.placement.name : '???';
        return `${name} [${item.found ? 'FOUND' : 'MISSING'}]: ${d.toFixed(1)}m`;
      })
      .join('<br>&nbsp;&nbsp;');

    this.container.innerHTML = `
      <strong>ODD OBJECTS [DEV DIAGNOSTICS]</strong><br>
      FPS: ${this.fps} | Draw Calls: ${info.render.calls} | Tris: ${info.render.triangles}<br>
      Player Pos: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})<br>
      Cam Yaw: ${(yaw * (180 / Math.PI)).toFixed(1)}° | Pitch: ${(pitch * (180 / Math.PI)).toFixed(1)}°<br>
      Round Status: ${roundManager.getStatus().toUpperCase()} | Time: ${roundManager.getElapsedLabel()}<br>
      Objects:<br>&nbsp;&nbsp;${itemStatus || 'None'}
    `;
  }

  public getEnabled(): boolean {
    return this.isEnabled;
  }
}
