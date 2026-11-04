import type { Input } from './input';
import { stickKeys, stickVector, type StickVector } from './stick';

/**
 * タッチ端末向けの操作(設計書 2026-11-04-twin-stick-controls)。
 * 左浮動スティック = 移動/梯子、右浮動スティック = パルスの照準+発射。
 * 重粒子砲だけは従来の専用経路(押す→溜め、ドラッグ→照準点、離す→発射、
 * 戻して離す→キャンセル)を維持する。溜め中は左スティック入力を受けない。
 * すべて Input のタッチ入口へ流すだけ。スタイルは index.html(pointer: coarse のみ)。
 */

/** 照準ドラッグ開始とみなす、砲ボタン中心からの距離(px) */
export const AIM_START_DIST = 24;
/** この距離まで戻して離すとキャンセルになる(px) */
export const CANCEL_DIST = 38;
/** 照準点を指の位置から上にずらす量(px)。指の腹で目標を隠さないため */
export const AIM_OFFSET_Y = 30;

/** スティックの最大ストローク(px) */
export const STICK_RADIUS = 56;
/** スティック土台の直径(px) */
export const STICK_BASE_SIZE = 112;

export type CannonPhase = 'charging' | 'aiming' | 'cancel';

/** 砲ドラッグの位相遷移(純粋関数。Vitest で固定) */
export function cannonPhase(prev: CannonPhase, dist: number): CannonPhase {
  if (prev === 'charging') return dist > AIM_START_DIST ? 'aiming' : 'charging';
  if (prev === 'aiming') return dist <= CANCEL_DIST ? 'cancel' : 'aiming';
  return dist > CANCEL_DIST ? 'aiming' : 'cancel';
}

type BtnHandlers = {
  onDown: (e: PointerEvent) => void;
  onUp: () => void;
  onMove?: (e: PointerEvent) => void;
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
  if (handlers.onMove) btn.addEventListener('pointermove', handlers.onMove);
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
 * 倒し量を stickVector で変換して onChange に流す。受け付けるのは 1 本の指だけ。
 * release() は外部(砲の溜め開始)から強制的に離した状態にする。
 */
function makeStick(
  zoneCls: string,
  onChange: (vec: StickVector) => void,
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
    onChange(ZERO_STICK);
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
    onChange(ZERO_STICK);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - originX;
    const dy = e.clientY - originY;
    // ノブは実ストローク(最大 STICK_RADIUS)に丸めて指へ追従させる
    const dist = Math.hypot(dx, dy);
    const cl = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
    knob.style.transform = `translate(calc(-50% + ${dx * cl}px), calc(-50% + ${dy * cl}px))`;
    onChange(stickVector(dx, dy, STICK_RADIUS));
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

  let cannonActive = false;

  // 左スティック: 実効ベクトルをデジタル変換し、差分だけ touchDown/touchUp に流す
  type MoveKeys = ReturnType<typeof stickKeys>;
  const NO_KEYS: MoveKeys = { left: false, right: false, up: false, down: false };
  let leftKeys: MoveKeys = NO_KEYS;
  const syncKey = (code: string, was: boolean, is: boolean): void => {
    if (is && !was) input.touchDown(code);
    else if (!is && was) input.touchUp(code);
  };
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

  // 右スティック: 方向 = パルスの照準(アナログ)、倒し量で照準有効/発射を判定する。
  // 単位ベクトルと大きさに分けて Input の照準チャンネルへ流す
  const rightStick = makeStick('right', (vec) => {
    if (vec.mag > 0) input.setTouchAim(vec.x / vec.mag, vec.y / vec.mag, vec.mag);
    else input.clearTouchAim();
  });
  root.appendChild(rightStick.el);

  // 砲ボタン(押す→溜め、ドラッグ→照準点、離す→発射、戻して離す→キャンセル)
  let phase: CannonPhase = 'charging';
  let centerX = 0;
  let centerY = 0;
  const cannonBtn = makeButton('砲', 'sz-cannon', {
    onDown: () => {
      cannonActive = true;
      leftStick.release(); // 溜め中は止まって狙う(移動入力を一括解放)
      root.classList.add('aiming');
      const r = cannonBtn.getBoundingClientRect();
      centerX = r.left + r.width / 2;
      centerY = r.top + r.height / 2;
      phase = 'charging';
      input.touchDown('KeyF');
    },
    onMove: (e) => {
      if (!cannonActive) return;
      const dist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
      phase = cannonPhase(phase, dist);
      cannonBtn.classList.toggle('cancel-armed', phase === 'cancel');
      if (phase === 'aiming') input.setTouchPoint(e.clientX, e.clientY - AIM_OFFSET_Y);
      else input.clearTouchPoint();
    },
    onUp: () => {
      if (!cannonActive) return;
      if (phase === 'cancel') input.requestFireCancel();
      input.touchUp('KeyF');
      input.clearTouchPoint();
      cannonBtn.classList.remove('cancel-armed');
      root.classList.remove('aiming');
      cannonActive = false;
    },
  });

  // 右クラスタは「砲」「跳」の 1 段だけ(パルスは右スティックへ移行した)
  const right = document.createElement('div');
  right.className = 'tcluster right';
  const rightRow = document.createElement('div');
  rightRow.className = 'trow';
  rightRow.appendChild(cannonBtn);
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
