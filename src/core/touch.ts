import type { Input } from './input';

/**
 * タッチ端末向けの画面ボタン(設計書 2026-11-03-touch-controls-design)。
 * ボタンは DOM の重ね表示で、押下/解放を Input のタッチ入口へキーコードとして流すだけ。
 * キャンバスや描画パスには触らない。スタイルは index.html の #touch 配下(pointer: coarse のみ表示)。
 */

type BtnDef = { label: string; code: string };

const LEFT_CLUSTER: BtnDef[] = [
  { label: '←', code: 'KeyA' },
  { label: '→', code: 'KeyD' },
];

const RIGHT_CLUSTER: BtnDef[] = [
  { label: '↑', code: 'KeyW' },
  { label: '↓', code: 'KeyS' },
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

/** タッチ端末(pointer: coarse)でのみボタンを組み立てる。それ以外では何もしない */
export function installTouchControls(input: Input): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  const root = document.createElement('div');
  root.id = 'touch';

  const left = document.createElement('div');
  left.className = 'tcluster left';
  for (const def of LEFT_CLUSTER) left.appendChild(makeButton(def, input));

  const right = document.createElement('div');
  right.className = 'tcluster right';
  for (const def of RIGHT_CLUSTER) right.appendChild(makeButton(def, input));

  root.appendChild(left);
  root.appendChild(right);
  document.body.appendChild(root);
}
