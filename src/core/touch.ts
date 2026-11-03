import type { Input } from './input';

/**
 * タッチ端末向けの操作(設計書 2026-11-03-touch-redesign-design)。
 * モード分離: 移動はホールドボタン、照準+発射は「砲ボタンを押した指をそのまま
 * 地形へドラッグして点を指し、離して発射」。スティック方式は廃止した。
 * パルス(アクション化 第2段)は右下「射」のホールドで連射し、照準は移動入力の
 * 8 方向。発射中だけ ↑ ↓ 列も表示して上・斜めを狙えるようにする。
 * すべて Input のタッチ入口へ流すだけ。スタイルは index.html(pointer: coarse のみ)。
 */

/** 照準ドラッグ開始とみなす、砲ボタン中心からの距離(px) */
export const AIM_START_DIST = 24;
/** この距離まで戻して離すとキャンセルになる(px) */
export const CANCEL_DIST = 38;
/** 照準点を指の位置から上にずらす量(px)。指の腹で目標を隠さないため */
export const AIM_OFFSET_Y = 30;

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

let touchRoot: HTMLElement | null = null;

/** 梯子ボタンの表示切り替え(main が梯子近接を判定して呼ぶ。未設置なら何もしない) */
export function setTouchLadderVisible(visible: boolean): void {
  touchRoot?.classList.toggle('ladder-on', visible);
}

/** タッチ端末(pointer: coarse)でのみボタンを組み立てる。それ以外では何もしない */
export function installTouchControls(input: Input): void {
  if (!window.matchMedia('(pointer: coarse)').matches) return;

  const root = document.createElement('div');
  root.id = 'touch';
  touchRoot = root;

  // 移動ボタン(押下状態を保持し、砲の押下時に一括解放できるようにする)
  type MoveBtn = { code: string; btn: HTMLButtonElement; down: boolean };
  const moveBtns: MoveBtn[] = [];
  let cannonActive = false;
  const makeMoveButton = (label: string, cls: string, code: string): HTMLButtonElement => {
    const rec: MoveBtn = { code, btn: null as unknown as HTMLButtonElement, down: false };
    const btn = makeButton(label, cls, {
      onDown: () => {
        if (cannonActive) return; // 溜め中は移動入力を受けない
        rec.down = true;
        input.touchDown(code);
      },
      onUp: () => {
        if (!rec.down) return;
        rec.down = false;
        input.touchUp(code);
      },
    });
    rec.btn = btn;
    moveBtns.push(rec);
    return btn;
  };
  const releaseAllMovement = (): void => {
    for (const rec of moveBtns) {
      if (!rec.down) continue;
      rec.down = false;
      rec.btn.classList.remove('on');
      input.touchUp(rec.code);
    }
  };

  const left = document.createElement('div');
  left.className = 'tcluster left';
  const ladderRow = document.createElement('div');
  ladderRow.className = 'trow ladder';
  ladderRow.appendChild(makeMoveButton('↑', 'sz-ladder', 'KeyW'));
  ladderRow.appendChild(makeMoveButton('↓', 'sz-ladder', 'KeyS'));
  const moveRow = document.createElement('div');
  moveRow.className = 'trow';
  moveRow.appendChild(makeMoveButton('←', 'sz-move', 'KeyA'));
  moveRow.appendChild(makeMoveButton('→', 'sz-move', 'KeyD'));
  left.appendChild(ladderRow);
  left.appendChild(moveRow);
  root.appendChild(left);

  // 砲ボタン(押す→溜め、ドラッグ→照準点、離す→発射、戻して離す→キャンセル)
  let phase: CannonPhase = 'charging';
  let centerX = 0;
  let centerY = 0;
  const cannonBtn = makeButton('砲', 'sz-cannon', {
    onDown: () => {
      cannonActive = true;
      releaseAllMovement();
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

  // パルスボタン(押している間だけ連射。発射中は root に pulse-on を付けて
  // ↑ ↓ 列も出し、上・斜めを狙えるようにする)
  const pulseBtn = makeButton('射', 'sz-pulse', {
    onDown: () => {
      root.classList.add('pulse-on');
      input.touchDown('KeyJ');
    },
    onUp: () => {
      root.classList.remove('pulse-on');
      input.touchUp('KeyJ');
    },
  });

  // 右クラスタは 2 段: 上段に「射」、下段に「砲」「跳」
  // (3 つ横並びだと縦持ちの幅に収まらず左クラスタと重なるため)
  const right = document.createElement('div');
  right.className = 'tcluster right';
  const rightTop = document.createElement('div');
  rightTop.className = 'trow';
  rightTop.appendChild(pulseBtn);
  const rightBottom = document.createElement('div');
  rightBottom.className = 'trow';
  rightBottom.appendChild(cannonBtn);
  rightBottom.appendChild(
    makeButton('跳', 'sz-jump', {
      onDown: () => input.touchDown('Space'),
      onUp: () => input.touchUp('Space'),
    }),
  );
  right.appendChild(rightTop);
  right.appendChild(rightBottom);
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
