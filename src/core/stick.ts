/**
 * 仮想スティックの純粋関数群(設計書 2026-11-04-twin-stick-controls)。
 * DOM には触れず、スティックの倒し量・照準・カメラ先行の判定だけをここに集約し
 * Vitest で固定する。DOM 側(src/core/touch.ts)はイベントを座標に直して渡すだけ。
 */

/** 照準として有効になるストローク比(これ以下はデッドゾーン) */
export const STICK_DEADZONE = 0.25;
/** パルスの発射が始まるストローク比 */
export const STICK_FIRE_THRESHOLD = 0.55;
/** 左スティックを横キーとみなす実効ベクトル成分の閾値 */
export const STICK_KEY_X = 0.35;
/** 左スティックを縦キーとみなす閾値(横より高くし、歩行中の梯子の誤入力を減らす) */
export const STICK_KEY_Y = 0.5;
/** カメラ先行量(タイル): 照準のみ */
export const LOOKAHEAD_TILES = 2.5;
/** カメラ先行量(タイル): 発射中・砲の溜め中 */
export const LOOKAHEAD_EXTENDED_TILES = 5;

export interface StickVector {
  /** 実効ベクトル = 単位方向 × 大きさ(成分の絶対値がそのまま stickKeys の閾値と比較できる) */
  x: number;
  y: number;
  /** 大きさ(ストローク比を 0..1 に丸めたもの) */
  mag: number;
}

/**
 * 原点からのずれ (dx, dy)[px] と最大ストローク radius[px] からスティックベクトルを作る。
 * デッドゾーン(比が STICK_DEADZONE 以下)ではゼロを返す。
 */
export function stickVector(dx: number, dy: number, radius: number): StickVector {
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || radius <= 0) return { x: 0, y: 0, mag: 0 };
  const ratio = dist / radius;
  if (ratio <= STICK_DEADZONE) return { x: 0, y: 0, mag: 0 };
  const mag = Math.min(ratio, 1);
  return { x: (dx / dist) * mag, y: (dy / dist) * mag, mag };
}

/** 左スティックの実効ベクトルを移動キー相当(デジタル)に変換する */
export function stickKeys(vec: { x: number; y: number }): {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
} {
  return {
    left: vec.x < -STICK_KEY_X,
    right: vec.x > STICK_KEY_X,
    up: vec.y < -STICK_KEY_Y,
    down: vec.y > STICK_KEY_Y,
  };
}

/** 倒し量から「照準として有効か」「発射するか」を判定する(狙うだけの状態を挟む) */
export function pulseTrigger(mag: number): { aim: boolean; fire: boolean } {
  return { aim: mag > STICK_DEADZONE, fire: mag > STICK_FIRE_THRESHOLD };
}

export interface AimVec {
  x: number;
  y: number;
}

/**
 * 照準保持の状態遷移(純粋な reducer)。スティックが有効な間だけ更新し、
 * 離しても・移動してもリセットしない。「向きの水平」への自動復帰をしないのが要点。
 */
export function aimKeeper(prev: AimVec | null, stick: AimVec | null): AimVec | null {
  if (stick) return { x: stick.x, y: stick.y };
  if (prev) return { x: prev.x, y: prev.y };
  return null;
}

/**
 * カメラ先行オフセット(タイル)。照準方向へ、照準のみなら LOOKAHEAD_TILES、
 * 発射中・砲の溜め中なら LOOKAHEAD_EXTENDED_TILES まで寄せる。
 * aim は単位ベクトルでなくてもよい(方向だけを使う)。
 */
export function lookahead(aim: AimVec | null, extended: boolean): { x: number; y: number } {
  if (!aim) return { x: 0, y: 0 };
  const len = Math.hypot(aim.x, aim.y);
  if (len === 0) return { x: 0, y: 0 };
  const d = extended ? LOOKAHEAD_EXTENDED_TILES : LOOKAHEAD_TILES;
  return { x: (aim.x / len) * d, y: (aim.y / len) * d };
}
