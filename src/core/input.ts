import type { PlayerInput } from '../entities/player';

const GAME_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'Space',
  'KeyF',
  'ShiftLeft',
  'KeyM',
]);

/** 移動キー(眺望の打ち切りの対象) */
export const MOVE_KEYS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space'];

/** キーボード・マウス状態の集約。updateループから同期的に読む */
export class Input {
  private keys = new Set<string>();
  /** このフレームに新たに押されたキー(keydown のエッジ。自動リピートは除く)。update の先頭で takePressed() が取り出す */
  private pressed = new Set<string>();
  /** ミュート(§6.7)。M の keydown でトグル。blur でキーは消えるがこの状態は保つ */
  muted = false;
  private inputCbs: (() => void)[] = [];
  /** ビューポート座標。キャンバスが(0,0)起点のフルスクリーンである前提 */
  mouseX = 0;
  mouseY = 0;
  /** 読み込み後にマウスが一度でも動いたか。動くまでは眺望のオフセットに使わない(左上へ寄らないため) */
  mouseSeen = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.pressKey(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('pointerdown', () => this.fireInput());
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseSeen = true;
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** キーが押されたときの共通処理(押下エッジ、ミュート切替、入力コールバック) */
  private pressKey(code: string): void {
    this.keys.add(code);
    this.pressed.add(code);
    if (code === 'KeyM') this.muted = !this.muted;
    this.fireInput();
  }

  /** タッチボタンからの押下。keydown と同じ入口に流す(画面ボタンは src/core/touch.ts) */
  touchDown(code: string): void {
    if (this.keys.has(code)) return; // 既に押下中ならエッジを二重に出さない
    this.pressKey(code);
  }

  /** タッチボタンからの解放。keyup と同じく集合から除くだけ */
  touchUp(code: string): void {
    this.keys.delete(code);
  }

  /**
   * キー押下(リピート除く)/ ポインタ押下のたびに呼ぶ(AudioContext の開始と resume。ブラウザの自動再生制限)。
   * 初回だけにすると、最初のキーが Esc などユーザー操作に数えられないものだったとき音が永久に出ない
   */
  onInput(cb: () => void): void {
    this.inputCbs.push(cb);
  }

  private fireInput(): void {
    for (const cb of this.inputCbs) cb();
  }

  /** このフレームに新たに押されたキーの集合を返して空にする(1 フレームに 1 回) */
  takePressed(): Set<string> {
    const out = this.pressed;
    this.pressed = new Set();
    return out;
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

  get fireHeld(): boolean {
    return this.keys.has('KeyF');
  }

  /** 眺望(§6.4): 左 Shift 長押し。右 Shift は Windows の固定キー機能(8 秒長押しでダイアログ)を避けて使わない */
  get shiftHeld(): boolean {
    return this.keys.has('ShiftLeft');
  }
}
