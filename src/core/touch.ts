import { hapticWeaponSwitch } from './haptics';
import type { Input } from './input';
import { stickKeys, stickVector, type StickVector } from './stick';
import type { WeaponMode } from './weapon';

/**
 * タッチ端末向けの操作(設計書 2026-11-04-twin-stick-controls、2026-11-05-weapon-switch)。
 * 左浮動スティック = 移動/梯子、右浮動スティック = 現在の武器の照準+発射。
 * 武器(パルス / 重粒子砲)は切替ボタンで切り替え、右スティックの意味論がモードで変わる
 * (パルス = 倒して連射、砲 = 倒して溜め・離して発射・中心へ戻して離すとキャンセル)。
 * すべて Input のタッチ入口へ流すだけ。スタイルは index.html(pointer: coarse のみ)。
 */

/** スティックの最大ストローク(px) */
export const STICK_RADIUS = 56;
/** スティック土台の直径(px) */
export const STICK_BASE_SIZE = 112;

type BtnHandlers = {
  onDown: (e: PointerEvent) => void;
  onUp: () => void;
};

function makeButton(label: string, cls: string, handlers: BtnHandlers): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `tbtn ${cls}`;
  btn.textContent = label;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      btn.setPointerCapture(e.pointerId); // 指がボタン外へ滑っても追跡と解放を取りこぼさない
    } catch {
      // 合成イベント等で捕捉できない場合も、押下自体は継続する
    }
    btn.classList.add('on');
    handlers.onDown(e);
  });
  const up = (): void => {
    btn.classList.remove('on');
    handlers.onUp();
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault()); // 長押しメニュー抑止
  return btn;
}

const ZERO_STICK: StickVector = { x: 0, y: 0, mag: 0 };

/**
 * 浮動スティックの汎用部品。ゾーン内の任意の点に触れると土台がその場に出現し、
 * 倒し量を stickVector で変換して onChange に流す。onChange の第 2 引数は未加工の倒し比
 * (最大ストローク比。デッドゾーン処理前で、砲スティックの位相判定が中心への戻し量を見るために使う)。
 * onEnd はセッション終了(指を離した/強制解放)で 1 回呼ばれる。受け付けるのは 1 本の指だけ。
 * release() は外部(砲の溜め開始)から強制的に離した状態にする。
 */
function makeStick(
  zoneCls: string,
  onChange: (vec: StickVector, rawRatio: number) => void,
  onEnd?: () => void,
): { el: HTMLElement; release: () => void } {
  const zone = document.createElement('div');
  zone.className = `tstick-zone ${zoneCls}`;
  const base = document.createElement('div');
  base.className = 'tstick-base';
  const knob = document.createElement('div');
  knob.className = 'tstick-knob';
  base.appendChild(knob);
  zone.appendChild(base);

  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;

  const endStick = (): void => {
    if (pointerId === null) return;
    pointerId = null;
    base.style.display = 'none';
    // onEnd を先に呼ぶ: セッション終了の判定(砲スティックの発射/キャンセルの振り分け)は
    // 「離す直前の位相」で行うため、終了に伴うゼロの onChange で位相を進めてはいけない
    onEnd?.();
    onChange(ZERO_STICK, 0);
  };

  zone.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return; // 既に別の指で操作中
    e.preventDefault();
    pointerId = e.pointerId;
    originX = e.clientX;
    originY = e.clientY;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      // 合成イベント等で捕捉できない場合も、押下自体は継続する
    }
    base.style.display = 'block';
    base.style.left = `${originX - STICK_BASE_SIZE / 2}px`;
    base.style.top = `${originY - STICK_BASE_SIZE / 2}px`;
    knob.style.transform = 'translate(-50%, -50%)';
    onChange(ZERO_STICK, 0);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - originX;
    const dy = e.clientY - originY;
    // ノブは実ストローク(最大 STICK_RADIUS)に丸めて指へ追従させる
    const dist = Math.hypot(dx, dy);
    const cl = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
    knob.style.transform = `translate(calc(-50% + ${dx * cl}px), calc(-50% + ${dy * cl}px))`;
    onChange(stickVector(dx, dy, STICK_RADIUS), dist / STICK_RADIUS);
  });
  const up = (e: PointerEvent): void => {
    if (e.pointerId === pointerId) endStick();
  };
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  zone.addEventListener('contextmenu', (e) => e.preventDefault());
  return { el: zone, release: endStick };
}

/** タッチ端末(pointer: coarse)でのみ操作系を組み立てる。それ以外では何もしない */
export function installTouchControls(input: Input): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  const root = document.createElement('div');
  root.id = 'touch';

  // 左スティック: 実効ベクトルをデジタル変換し、差分だけ touchDown/touchUp に流す
  type MoveKeys = ReturnType<typeof stickKeys>;
  const NO_KEYS: MoveKeys = { left: false, right: false, up: false, down: false };
  let leftKeys: MoveKeys = NO_KEYS;
  const syncKey = (code: string, was: boolean, is: boolean): void => {
    if (is && !was) input.touchDown(code);
    else if (!is && was) input.touchUp(code);
  };
  // 砲の溜め中か(Input の cannonStickHeld と同期する。溜め中は左スティックを受けない)。
  // 砲モードであるだけでは立たない — 拘束は「溜めている間」だけ(設計 §3-5)
  let cannonActive = false;
  const applyLeftStick = (vec: StickVector): void => {
    // 溜め中は倒した入力を受けない(ゼロへの解放はいつでも通す)
    const next = cannonActive && vec.mag > 0 ? NO_KEYS : stickKeys(vec);
    syncKey('KeyA', leftKeys.left, next.left);
    syncKey('KeyD', leftKeys.right, next.right);
    syncKey('KeyW', leftKeys.up, next.up);
    syncKey('KeyS', leftKeys.down, next.down);
    leftKeys = next;
  };
  const leftStick = makeStick('left', applyLeftStick);
  root.appendChild(leftStick.el);

  // 溜めの開始/終了に合わせて左スティックの拘束を同期する(開始時は移動入力を一括解放する)
  const syncCannonActive = (): void => {
    const active = input.cannonStickHeld;
    if (active === cannonActive) return;
    cannonActive = active;
    if (active) {
      leftStick.release(); // 溜め中は止まって狙う
      root.classList.add('aiming');
    } else {
      root.classList.remove('aiming');
    }
  };

  // 右スティック: 方向 = 現在の武器の照準(アナログ、両モード共通)、倒し量の意味論はモードで変わる。
  // 照準は単位ベクトルと大きさに分けて Input の照準チャンネルへ、未加工の倒し比は砲スティックの
  // 位相チャンネルへ流す(位相・発射候補・キャンセルの判定は Input 側)
  const rightStick = makeStick(
    'right',
    (vec, rawRatio) => {
      if (vec.mag > 0) input.setTouchAim(vec.x / vec.mag, vec.y / vec.mag, vec.mag);
      else input.clearTouchAim();
      input.touchStick(rawRatio);
      syncCannonActive();
    },
    () => {
      input.touchStickEnd();
      syncCannonActive();
    },
  );
  root.appendChild(rightStick.el);

  // 切替ボタン(旧「砲」ボタンの位置・サイズをそのまま使う)。ラベルは「切り替えた先」ではなく
  // 現在の武器を表示し、モード明示の主担い手にする(設計 §1.1、§2-1)。切り替えは押下エッジのみ。
  const weaponBtn = makeButton('パルス', 'sz-weapon', {
    onDown: () => {
      input.toggleWeapon(); // 溜め中なら Input 側でキャンセルしてから切り替わる
      hapticWeaponSwitch();
      syncCannonActive(); // キャンセルで溜めが落ちたら左スティックの拘束も解く
    },
    onUp: () => {},
  });
  // モード表示の同期: ボタンのラベルと色、#touch の mode-cannon(右スティックの色味、設計 §2-2)。
  // 切替ボタンの押下だけでなく、発射後の自動復帰(段階1 Task 3)でも同じ経路で同期される
  const syncWeaponUi = (mode: WeaponMode): void => {
    weaponBtn.textContent = mode === 'cannon' ? '砲' : 'パルス';
    weaponBtn.classList.toggle('mode-cannon', mode === 'cannon');
    root.classList.toggle('mode-cannon', mode === 'cannon');
  };
  input.onWeaponChange(syncWeaponUi);
  syncWeaponUi(input.weaponMode);

  // 右クラスタは「武器(切替)」「跳」の 1 段だけ(発射は右スティックが担う)
  const right = document.createElement('div');
  right.className = 'tcluster right';
  const rightRow = document.createElement('div');
  rightRow.className = 'trow';
  rightRow.appendChild(weaponBtn);
  rightRow.appendChild(
    makeButton('跳', 'sz-jump', {
      onDown: () => input.touchDown('Space'),
      onUp: () => input.touchUp('Space'),
    }),
  );
  right.appendChild(rightRow);
  root.appendChild(right);

  // 眺望(右上、長押し = Shift)
  const viewWrap = document.createElement('div');
  viewWrap.className = 'tview';
  viewWrap.appendChild(
    makeButton('望', 'sz-view', {
      onDown: () => input.touchDown('ShiftLeft'),
      onUp: () => input.touchUp('ShiftLeft'),
    }),
  );
  root.appendChild(viewWrap);

  document.body.appendChild(root);
}
