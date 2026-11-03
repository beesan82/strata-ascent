import type { Input } from './input';

/**
 * タッチ端末向けの操作(設計書 2026-11-03-virtual-stick-design)。
 * 移動・梯子は「触った場所が原点になる浮動スティック」、ジャンプと砲だけボタンで残す。
 * どちらも Input のタッチ入口へキーコードとして流すだけ。キャンバスや描画パスには触らない。
 * スタイルは index.html の #touch / #stick 配下(pointer: coarse のみ表示)。
 */

/** スティック変位の閾値(px)。縦を鈍くして、歩行中の誤った梯子入力を減らす */
export const STICK_THRESHOLD_X = 14;
export const STICK_THRESHOLD_Y = 18;

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

const STICK_CODES = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS' } as const;

type BtnDef = { label: string; code: string };

const BUTTONS: BtnDef[] = [
  { label: '跳', code: 'Space' },
  { label: '砲', code: 'KeyF' },
];

function makeButton(def: BtnDef, input: Input): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tbtn';
  btn.textContent = def.label;
  btn.setAttribute('aria-label', def.code);

  const down = (e: PointerEvent): void => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId); // 指がボタン外へ滑っても解放を取りこぼさない
    btn.classList.add('on');
    input.touchDown(def.code);
  };
  const up = (): void => {
    btn.classList.remove('on');
    input.touchUp(def.code);
  };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('lostpointercapture', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault()); // 長押しメニュー抑止
  return btn;
}

/** 浮動スティック: 全画面レイヤーが受け、原点とノブを DOM で出す */
function installStick(input: Input): void {
  const layer = document.createElement('div');
  layer.id = 'stick-layer';
  const base = document.createElement('div');
  base.id = 'stick-base';
  const knob = document.createElement('div');
  knob.id = 'stick-knob';
  base.appendChild(knob);
  layer.appendChild(base);
  document.body.appendChild(layer);

  let activeId: number | null = null;
  let originX = 0;
  let originY = 0;
  let current: StickKeys = { left: false, right: false, up: false, down: false };

  const apply = (next: StickKeys): void => {
    (Object.keys(STICK_CODES) as (keyof StickKeys)[]).forEach((dir) => {
      if (next[dir] === current[dir]) return;
      if (next[dir]) input.touchDown(STICK_CODES[dir]);
      else input.touchUp(STICK_CODES[dir]);
    });
    current = next;
  };

  const showAt = (x: number, y: number, dx: number, dy: number): void => {
    base.style.display = 'block';
    base.style.left = `${x}px`;
    base.style.top = `${y}px`;
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
    showAt(originX, originY, 0, 0);
  });
  layer.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    const dx = e.clientX - originX;
    const dy = e.clientY - originY;
    apply(stickKeys(dx, dy));
    showAt(originX, originY, dx, dy);
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    apply({ left: false, right: false, up: false, down: false });
    base.style.display = 'none';
  };
  layer.addEventListener('pointerup', end);
  layer.addEventListener('pointercancel', end);
  layer.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** タッチ端末(pointer: coarse)でのみスティックとボタンを組み立てる。それ以外では何もしない */
export function installTouchControls(input: Input): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  installStick(input);

  const root = document.createElement('div');
  root.id = 'touch';
  const right = document.createElement('div');
  right.className = 'tcluster right';
  for (const def of BUTTONS) right.appendChild(makeButton(def, input));
  root.appendChild(right);
  document.body.appendChild(root);
}
