import type { PlayerInput } from '../entities/player';
import { aimKeeper, cannonStickPhase, pulseTrigger, STICK_DEADZONE, type CannonStickPhase } from './stick';
import {
  INITIAL_WEAPON_STATE,
  weaponReducer,
  type WeaponEvent,
  type WeaponMode,
  type WeaponState,
} from './weapon';

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
  'KeyQ',
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
      // マウスの左ボタンだけが PC の発射ボタンになる(タッチの pointerdown では立てない)
      if (e.pointerType === 'mouse' && e.button === 0) this.pressMouseLeft();
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.releaseMouseLeft();
    });
    window.addEventListener('pointermove', (e) => {
      // マウスの移動だけを照準に使う。タッチ由来の移動(スティック操作)と、タップで合成される
      // 互換マウスイベントは pointerType で弾く。これを素通しすると、アイテムボックス等の
      // DOM をタップした座標で mouseSeen が立ち、銃の向きがその点へ固着する(2.8 実機バグ)
      if (e.pointerType !== 'mouse') return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseSeen = true;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      // フォーカスを失ったまま解放の発射が成立しないよう、マウスの溜めはキャンセルして破棄する
      if (this.mouseCannonHeldFlag) {
        this.requestFireCancel();
        this.mouseCannonHeldFlag = false;
        this.cannonReleasePending = false;
      }
      this.mouseDown = false;
    });
  }

  /** キーが押されたときの共通処理(押下エッジ、ミュート切替、武器切替、入力コールバック) */
  private pressKey(code: string): void {
    this.keys.add(code);
    this.pressed.add(code);
    if (code === 'KeyM') this.muted = !this.muted;
    // KeyQ = PC の武器切替(設計 §5)。エッジはこの経路に一本化され、keydown の
    // オートリピートは呼び出し側で除かれるため、長押しで連続切り替えにはならない。
    // 溜め中の Q は toggleWeapon 側で「キャンセルしてから切り替え」になる
    if (code === 'KeyQ') this.toggleWeapon();
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

  // ---- 武器モード(設計 2026-11-05-weapon-switch)。状態遷移は core/weapon.ts の reducer に委ね、
  // ここは「切り替え時点のスティック状態」のような実入力との接合だけを持つ ----
  private weaponState: WeaponState = INITIAL_WEAPON_STATE;
  private weaponCbs: ((mode: WeaponMode) => void)[] = [];
  /** 右スティックの直近の倒し比(デッドゾーン処理済みの mag と未加工 ratio の大きい方)。切り替え時の stickEngaged 判定に使う */
  private touchStickRatioNow = 0;

  get weaponMode(): WeaponMode {
    return this.weaponState.mode;
  }

  get weaponNeedsNeutral(): boolean {
    return this.weaponState.needsNeutral;
  }

  /** モードが変わったときだけ呼ばれる(DOM 表示の同期用) */
  onWeaponChange(cb: (mode: WeaponMode) => void): void {
    this.weaponCbs.push(cb);
  }

  private applyWeapon(event: WeaponEvent): void {
    const prev = this.weaponState;
    this.weaponState = weaponReducer(prev, event);
    if (this.weaponState.mode !== prev.mode) {
      for (const cb of this.weaponCbs) cb(this.weaponState.mode);
    }
  }

  /**
   * 切り替えの押下エッジ(タッチの切替ボタン / PC の KeyQ がここへ合流する)。
   * 入力が倒れたまま切り替わったらニュートラル要求を立てる(PC では「切り替えの瞬間に
   * 左クリックが押されていたら」を engaged に含めて読み替える。設計 §5)。
   * 安全策の消費 = 発射・溜めの抑止は setTouchAim / touchStick / マウス側で行う。
   * 溜め中に切り替えたら、先に溜めをキャンセルしてから切り替える(設計 §3-6)。
   */
  toggleWeapon(): void {
    if (this.cannonStickHeldFlag || this.stickPhase !== 'idle' || this.mouseCannonHeldFlag) {
      this.requestFireCancel();
      this.cannonStickHeldFlag = false;
      this.stickPhase = 'idle';
      this.mouseCannonHeldFlag = false;
      this.cannonReleasePending = false;
    }
    this.applyWeapon({
      type: 'toggle',
      stickEngaged: this.touchStickRatioNow > STICK_DEADZONE || this.mouseDown,
    });
  }

  /** 重粒子砲の発射が成立した(main の fire から呼ぶ)。砲モードなら自動でパルスへ復帰する(設計 §3-3) */
  notifyCannonFired(): void {
    this.applyWeapon({ type: 'fired' });
  }

  // ---- 砲スティック(砲モードの右スティック文法。設計 §1.2、§1.3) ----
  private stickPhase: CannonStickPhase = 'idle';
  private cannonStickHeldFlag = false;
  /** 砲の発射候補(charging のまま離した。スティック・マウス共通)。発射の成否は Graviton 側が決め、fire の中でだけ消費できる */
  private cannonReleasePending = false;
  /** マウスで砲を溜めているか(左クリックを押した時点のモード等でラッチし、解放まで保持する) */
  private mouseCannonHeldFlag = false;

  /** 砲の溜め中か(右スティックを倒して離すまで)。左スティック抑止の判定に使う */
  get cannonStickHeld(): boolean {
    return this.cannonStickHeldFlag;
  }

  /** マウスで砲を溜めているか(左クリックを押して離すまで) */
  get mouseCannonHeld(): boolean {
    return this.mouseCannonHeldFlag;
  }

  /**
   * 右スティックの未加工の倒し比(最大ストローク比、デッドゾーン処理前)を毎イベント流す。
   * 砲モードのときだけ位相を進める。ニュートラル要求中は位相を進めず、
   * デッドゾーン以下へ戻った時点で要求を解除する(このセッションでは開始しない)。
   * 眺望中は溜め開始も位相の進行も受け付けない(設計 §3-7)。
   */
  touchStick(ratio: number): void {
    this.touchStickRatioNow = ratio;
    if (this.weaponState.needsNeutral) {
      if (ratio <= STICK_DEADZONE) this.applyWeapon({ type: 'neutral' });
      return;
    }
    if (this.weaponState.mode !== 'cannon') return;
    if (this.shiftHeld) return;
    this.stickPhase = cannonStickPhase(this.stickPhase, ratio);
    if (this.stickPhase !== 'idle') this.cannonStickHeldFlag = true;
  }

  /**
   * 右スティックのセッション終了(指を離した)。離す直前の位相で発射候補 / キャンセルを振り分ける:
   * charging のまま離したら発射候補(成否は Graviton の溜め量が決める)、
   * cancel-armed か眺望中の解放はキャンセル要求にする。発射可否の判定自体は作らない(二重化しない)。
   */
  touchStickEnd(): void {
    this.touchStickRatioNow = 0;
    if (this.weaponState.needsNeutral) this.applyWeapon({ type: 'neutral' });
    const phase = this.stickPhase;
    this.stickPhase = 'idle';
    this.cannonStickHeldFlag = false;
    if (phase === 'cancel-armed' || (phase === 'charging' && this.shiftHeld)) {
      this.requestFireCancel();
    } else if (phase === 'charging') {
      this.cannonReleasePending = true;
    }
  }

  // ---- 砲マウス(PC の砲モード文法。設計 §5: 左クリック長押しで溜め、離して発射) ----

  /**
   * マウス左ボタンの押下(PC 経路の入口。window の pointerdown から呼ぶ)。
   * 砲モードのときだけ溜めをラッチする。切り替え直後のニュートラル要求中と眺望中は
   * その押下では溜めを開始しない(スティック側の安全策の PC 読み替え。設計 §3-2、§3-7、§5)。
   */
  pressMouseLeft(): void {
    this.mouseDown = true;
    if (this.weaponState.mode !== 'cannon') return;
    if (this.weaponState.needsNeutral) return;
    if (this.shiftHeld) return;
    this.mouseCannonHeldFlag = true;
  }

  /**
   * マウス左ボタンの解放。溜めていたらスティックと同じ枠組みに相乗りする:
   * 発射候補を立てる(成否は Graviton の溜め量が決め、候補は expireCannonRelease で失効する)。
   * 眺望中の解放はキャンセル要求にする(スティックの touchStickEnd と同型)。
   * あわせて、切り替え時に押されていた押下の解放はニュートラル要求の解除条件になる
   * (スティックが倒れたままなら解除しない。設計 §5)。
   */
  releaseMouseLeft(): void {
    const wasDown = this.mouseDown;
    this.mouseDown = false;
    if (this.mouseCannonHeldFlag) {
      this.mouseCannonHeldFlag = false;
      if (this.shiftHeld) this.requestFireCancel();
      else this.cannonReleasePending = true;
    }
    if (wasDown && this.weaponState.needsNeutral && this.touchStickRatioNow <= STICK_DEADZONE) {
      this.applyWeapon({ type: 'neutral' });
    }
  }

  /** 砲の発射候補を 1 回だけ取り出す(main の fire の中でだけ呼ぶ) */
  takeCannonRelease(): boolean {
    const v = this.cannonReleasePending;
    this.cannonReleasePending = false;
    return v;
  }

  /** 発射候補の失効(graviton.update の直後に毎フレーム呼ぶ。発射しなかった候補を残さない) */
  expireCannonRelease(): void {
    this.cannonReleasePending = false;
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
    this.touchStickRatioNow = mag; // 直近値(切り替え時の stickEngaged 判定用。touchStick の未加工 ratio で上書きされる)
    const t = pulseTrigger(mag);
    // 発射の意味論は武器モードで変わる: 砲モードとニュートラル要求中は連射を受け付けない
    // (照準の更新自体は両モード共通で受ける。設計 §1.2、§3-2)
    this.touchAimFiring = t.fire && this.weaponState.mode === 'pulse' && !this.weaponState.needsNeutral;
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
    this.touchStickRatioNow = 0;
    // 中心へ戻す/離す = ニュートラルへ戻った(設計 §3-2 の解除条件)
    if (this.weaponState.needsNeutral) this.applyWeapon({ type: 'neutral' });
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

  /**
   * パルス発射中か(KeyJ / マウス左 / 右スティックの発射閾値超え)。
   * マウス分はパルスモードのときだけ有効にする(砲モードで左クリックを保持しても
   * パルスが連射されないため。設計 §5)。切り替え直後のニュートラル要求中も、
   * 切り替え時に押されていたその押下では連射を開始しない(設計 §3-2 の PC 読み替え)。
   */
  get pulseHeld(): boolean {
    const mousePulse =
      this.mouseDown && this.weaponState.mode === 'pulse' && !this.weaponState.needsNeutral;
    return this.keys.has('KeyJ') || mousePulse || this.touchAimFiring;
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
    // 砲の溜め中か(タッチ = 右スティック、PC = 左クリック長押し)。旧 PC 経路の KeyF は
    // 切り替え式への統一に伴い廃止した(GAME_KEYS からも外してある。設計 §5、§6 段階 2)
    return this.cannonStickHeldFlag || this.mouseCannonHeldFlag;
  }

  /** 眺望(§6.4): 左 Shift 長押し。右 Shift は Windows の固定キー機能(8 秒長押しでダイアログ)を避けて使わない */
  get shiftHeld(): boolean {
    return this.keys.has('ShiftLeft');
  }
}
