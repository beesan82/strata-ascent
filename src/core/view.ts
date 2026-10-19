import { VIEW_ZOOM } from './zoom';

// 眺望(§6.4)の状態遷移。純粋関数で、出力は「目標ズーム」と「カメラ中心の目標オフセット(タイル)」だけ。
// カメラ(Camera.follow / zoomTo)はこの出力へ指数平滑で追従するだけで、ここでは平滑しない。

/** 手動眺望でカメラ中心をマウス方向へずらす最大距離(タイル) */
export const MANUAL_OFFSET_TILES = 40;
/** 自動眺望(通過演出)の長さ(秒) */
export const AUTO_SECONDS = 2.5;
/** 自動眺望で中心を下へ流す距離(タイル) */
export const AUTO_FLOW_TILES = 30;
/** 0 → AUTO_FLOW_TILES に達するまでの時間(秒)。残りは保持して戻る */
export const AUTO_FLOW_SECONDS = 1.5;

export type ViewMode = 'none' | 'manual' | 'auto';

export interface ViewInput {
  /** Shift 押下 */
  shift: boolean;
  /** 移動キー(左右・上下・ジャンプ)のいずれか押下 */
  moving: boolean;
  /** body.onGround */
  grounded: boolean;
  /** 接地かつ vx === 0 */
  still: boolean;
  /** 画面中心からマウスへの向き(−1..1、画面半幅・半高で正規化) */
  aimX: number;
  aimY: number;
  /** 見晴らし台の床に立っていればその板の cell(overlookCellAt)。そうでなければ null */
  overlookCell: number | null;
  /** 開放度由来の目標ズーム(量子化済み) */
  baseZoom: number;
}

export interface ViewState {
  mode: ViewMode;
  /** 自動眺望の経過秒 */
  autoElapsed: number;
  /** 自動眺望を発火した最も上の板の cell。これより上(小さい cell)でだけ再発火する(1 界面 1 回) */
  autoFiredMinCell: number | null;
  /** 前フレームの moving(新たに押された移動キーの検出用) */
  prevMoving: boolean;
  /** 出力: 目標ズーム */
  zoom: number;
  /** 出力: カメラ中心の目標オフセット(タイル、プレイヤー中心基準) */
  offsetX: number;
  offsetY: number;
}

export const INITIAL_VIEW: ViewState = {
  mode: 'none', autoElapsed: 0, autoFiredMinCell: null, prevMoving: false, zoom: 1, offsetX: 0, offsetY: 0,
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 1 フレームぶんの遷移。判定順: 自動の発火 → 自動の継続/終了 → 手動 → なし。
 * - 自動眺望は見晴らし台に接地した瞬間(overlookCell が発火済みより上の板)に発火し、AUTO_SECONDS で終わる。
 *   打ち切るのは「新たに押された」移動キーだけ。梯子から D を押したまま着地するのが自然な経路なので、
 *   押しっぱなしの移動では打ち切らない(その間の移動自体は受け付ける)。
 * - 手動眺望は接地・静止で Shift を押している間だけ。移動キーで即解除。
 */
export function viewState(prev: ViewState, input: ViewInput, dt: number): ViewState {
  const next: ViewState = { ...prev, prevMoving: input.moving };
  const fires = input.overlookCell !== null && input.grounded
    && (prev.autoFiredMinCell === null || input.overlookCell < prev.autoFiredMinCell);
  if (fires) {
    next.mode = 'auto';
    next.autoElapsed = dt; // 発火したフレームも流れに数える(初フレームからオフセットが動き出す)
    next.autoFiredMinCell = input.overlookCell;
  } else if (prev.mode === 'auto') {
    const newlyMoving = input.moving && !prev.prevMoving;
    next.autoElapsed = prev.autoElapsed + dt;
    next.mode = newlyMoving || next.autoElapsed >= AUTO_SECONDS ? 'none' : 'auto';
  } else {
    next.mode = 'none';
  }
  if (next.mode === 'none') {
    const manual = input.shift && input.grounded && input.still && !input.moving;
    next.mode = manual ? 'manual' : 'none';
  }

  if (next.mode === 'auto') {
    next.zoom = VIEW_ZOOM;
    next.offsetX = 0;
    next.offsetY = AUTO_FLOW_TILES * clamp01(next.autoElapsed / AUTO_FLOW_SECONDS);
  } else if (next.mode === 'manual') {
    const len = Math.hypot(input.aimX, input.aimY);
    const k = len > 1 ? MANUAL_OFFSET_TILES / len : MANUAL_OFFSET_TILES;
    next.zoom = VIEW_ZOOM;
    next.offsetX = input.aimX * k;
    next.offsetY = input.aimY * k;
  } else {
    next.autoElapsed = 0;
    next.zoom = input.baseZoom;
    next.offsetX = 0;
    next.offsetY = 0;
  }
  return next;
}

/** 自動眺望がこのフレームで発火したか(字幕の表示トリガ) */
export function autoViewStarted(prev: ViewState, next: ViewState): boolean {
  return prev.mode !== 'auto' && next.mode === 'auto';
}
