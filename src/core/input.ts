import type { PlayerInput } from '../entities/player';

/** キーボード・マウス状態の集約。updateループから同期的に読む */
export class Input {
  private keys = new Set<string>();
  mouseX = 0;
  mouseY = 0;

  constructor() {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  get state(): PlayerInput {
    return {
      left: this.keys.has('ArrowLeft') || this.keys.has('KeyA'),
      right: this.keys.has('ArrowRight') || this.keys.has('KeyD'),
      jump: this.keys.has('Space'),
      up: this.keys.has('ArrowUp') || this.keys.has('KeyW'),
      down: this.keys.has('ArrowDown') || this.keys.has('KeyS'),
    };
  }
}
