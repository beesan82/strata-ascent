import type { Input } from './input';

/**
 * タッチ端末向けの操作(設計書 2026-11-03-virtual-stick-design / 2026-11-03-aim-stick-design)。
 * 左半分 = 移動スティック、右半分 = エイムスティック(倒している間は自動発射)、
 * ジャンプと砲はボタンでも残す。すべて Input のタッチ入口へ流すだけで、
 * キャンバスや描画パスには触らない。スタイルは index.html(pointer: coarse のみ表示)。
 */

/** スティック変位の閾値(px)。縦を鈍くして、歩行中の誤った梯子入力を減らす */
export const STICK_THRESHOLD_X = 14;
export const STICK_THRESHOLD_Y = 18;
/** エイムスティックのデッドゾーン(px) */
export const AIM_DEADZONE = 18;

export type StickKeys = { left: boolean; right: boolean; up: boolean; down: boolean };

/** スティックの変位 → 方向キーの状態(純粋関数。Vitest で固定) */
export function stickKeys(dx: number, dy: number): StickKeys {
  return {
    left: dx < -STICK_THRESHOLD_X,
    right: dx > STICK_THRESHOLD_X,
    up: dy < -STICK_THRESHOLD_Y,
    down: dy > STICK_THRESHOLD_Y,
  };
}

export type AimStickState = { active: boolean; x: number; y: number };

/** エイムスティックの変位 → 照準の単位ベクトル(純粋関数。Vitest で固定) */
export function aimStickState(dx: number, dy: number): AimStickState {
  const len = Math.hypot(dx, dy);
  if (len <= AIM_DEADZONE) return { active: false, x: 0, y: 0 };
  return { active: true, x: dx / len, y: dy / len };
}

const STICK_CODES = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS' } as const;

type StickHandlers = {
  onVector: (dx: number, dy: number) => void;
  onEnd: () => void;
};

/** 浮動スティック 1 本分: 指定レイヤー内で受け、触った点に土台円とノブを出す */
function createStick(layerClass: string, handlers: StickHandlers): void {
  const layer = document.createElement('div');
  layer.className = layerClass;
  const base = document.createElement('div');
  base.className = 'stick-base';
  const knob = document.createElement('div');
  knob.className = 'stick-knob';
  base.appendChild(knob);
  layer.appendChild(base);
  document.body.appendChild(layer);

  let activeId: number | null = null;
  let originX = 0;
  let originY = 0;

  const showAt = (dx: number, dy: number): void => {
    base.style.display = 'block';
    base.style.left = `${originX}px`;
    base.style.top = `${originY}px`;
    const len = Math.hypot(dx, dy);
    const max = 42; // ノブの最大移動量(px)
    const scale = len > max ? max / len : 1;
    knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
  };

  layer.addEventListener('pointerdown', (e) => {
    if (activeId !== null) return; // スティックは 1 本の指だけ
    activeId = e.pointerId;
    originX = e.clientX;
    originY = e.clientY;
    layer.setPointerCapture(e.pointerId);
    showAt(0, 0);
    handlers.onVector(0, 0);
  });
  layer.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    const dx = e.clientX - originX;
    const dy = e.clientY - originY;
    handlers.onVector(dx, dy);
    showAt(dx, dy);
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    handlers.onEnd();
    base.style.display = 'none';
  };
  layer.addEventListener('pointerup', end);
  layer.addEventListener('pointercancel', end);
  layer.addEventListener('contextmenu', (e) => e.preventDefault());
}

function makeButton(
  label: string,
  onDown: () => void,
  onUp: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tbtn';
  btn.textContent = label;

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId); // 指がボタン外へ滑っても解放を取りこぼさない
    btn.classList.add('on');
    onDown();
  });
  const up = (): void => {
    btn.classList.remove('on');
    onUp();
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault()); // 長押しメニュー抑止
  return btn;
}

/** タッチ端末(pointer: coarse)でのみスティックとボタンを組み立てる。それ以外では何もしない */
export function installTouchControls(input: Input): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  // 発射は砲ボタンとエイムスティックの OR。片方を離しても他方が押していれば撃ち続ける
  let fireButton = false;
  let fireAim = false;
  let fireApplied = false;
  const applyFire = (): void => {
    const want = fireButton || fireAim;
    if (want === fireApplied) return;
    fireApplied = want;
    if (want) input.touchDown('KeyF');
    else input.touchUp('KeyF');
  };

  // 左半分: 移動スティック
  let current: StickKeys = { left: false, right: false, up: false, down: false };
  const applyKeys = (next: StickKeys): void => {
    (Object.keys(STICK_CODES) as (keyof StickKeys)[]).forEach((dir) => {
      if (next[dir] === current[dir]) return;
      if (next[dir]) input.touchDown(STICK_CODES[dir]);
      else input.touchUp(STICK_CODES[dir]);
    });
    current = next;
  };
  createStick('stick-layer left', {
    onVector: (dx, dy) => applyKeys(stickKeys(dx, dy)),
    onEnd: () => applyKeys({ left: false, right: false, up: false, down: false }),
  });

  // 右半分: エイムスティック(倒している間は照準 + 自動発射)
  createStick('stick-layer right', {
    onVector: (dx, dy) => {
      const s = aimStickState(dx, dy);
      if (s.active) {
        input.setTouchAim(s.x, s.y);
        fireAim = true;
      } else {
        input.clearTouchAim();
        fireAim = false;
      }
      applyFire();
    },
    onEnd: () => {
      input.clearTouchAim();
      fireAim = false;
      applyFire();
    },
  });

  const root = document.createElement('div');
  root.id = 'touch';
  const right = document.createElement('div');
  right.className = 'tcluster right';
  right.appendChild(
    makeButton('跳', () => input.touchDown('Space'), () => input.touchUp('Space')),
  );
  right.appendChild(
    makeButton('砲', () => { fireButton = true; applyFire(); }, () => { fireButton = false; applyFire(); }),
  );
  root.appendChild(right);
  document.body.appendChild(root);
}
