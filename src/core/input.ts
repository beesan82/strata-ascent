import type { PlayerInput } from '../entities/player';
import { aimKeeper, pulseTrigger } from './stick';

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
  'KeyJ',
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
  /** マウスの左ボタンが押されているか(パルスの発射用) */
  private mouseDown = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.pressKey(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('pointerdown', (e) => {
      this.fireInput();
      // パルスの発射はマウスの左ボタンだけ(タッチの pointerdown では立てない)
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseDown = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseDown = false;
    });
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseSeen = true;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
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

  /** タッチ照準の点(CSS px、砲ボタンのドラッグ位置)。マウス未使用時のみ main が読む */
  touchPointX = 0;
  touchPointY = 0;
  touchPointActive = false;

  setTouchPoint(x: number, y: number): void {
    this.touchPointX = x;
    this.touchPointY = y;
    this.touchPointActive = true;
  }

  clearTouchPoint(): void {
    this.touchPointActive = false;
  }

  /**
   * 右スティックの照準(単位ベクトル)。スティックを倒している間だけ有効。
   * 照準の合成・カメラ先行・眺望は main がこちらと保持照準(heldAim)を読む
   */
  touchAimX = 0;
  touchAimY = 0;
  touchAimActive = false;
  /** 右スティックが発射閾値を超えているか(pulseHeld に OR される。タッチ以外では常に false) */
  private touchAimFiring = false;
  /** 保持中の照準(単位ベクトル)。スティックを離しても残り、次の照準でだけ更新される */
  heldAimX = 1;
  heldAimY = 0;
  heldAimActive = false;

  /**
   * 右スティックの現在値を流す。(x, y) は単位ベクトル、mag はストローク比。
   * 照準有効・発射の判定は stick.ts の pulseTrigger に集約する。
   */
  setTouchAim(x: number, y: number, mag: number): void {
    const t = pulseTrigger(mag);
    this.touchAimFiring = t.fire;
    if (t.aim) {
      this.touchAimX = x;
      this.touchAimY = y;
      this.touchAimActive = true;
      const held = aimKeeper(
        this.heldAimActive ? { x: this.heldAimX, y: this.heldAimY } : null,
        { x, y },
      );
      if (held) {
        this.heldAimX = held.x;
        this.heldAimY = held.y;
        this.heldAimActive = true;
      }
    } else {
      this.touchAimActive = false;
    }
  }

  /** 右スティックを離した。現在の照準は無効になるが、保持照準は残る */
  clearTouchAim(): void {
    this.touchAimActive = false;
    this.touchAimFiring = false;
  }

  private fireCancelRequested = false;

  /** タッチ側からの発射キャンセル要求(砲ボタンのキャンセル圏内で離したとき) */
  requestFireCancel(): void {
    this.fireCancelRequested = true;
  }

  /** キャンセル要求を 1 回だけ取り出す(main が graviton.update の前に読む) */
  takeFireCancel(): boolean {
    const v = this.fireCancelRequested;
    this.fireCancelRequested = false;
    return v;
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

  /** パルス発射中か(KeyJ / マウス左 / 右スティックの発射閾値超え) */
  get pulseHeld(): boolean {
    return this.keys.has('KeyJ') || this.mouseDown || this.touchAimFiring;
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
