import { isSolid } from '../world/tiles';

/** ズーム下限(最大ズームアウト)。0.5 = 標準の2倍のタイルが横に入る(≒横88タイル) */
export const MIN_ZOOM = 0.5;
/** ズーム上限(標準表示。横44タイル) */
export const MAX_ZOOM = 1;
/**
 * 眺望専用の段(§6.4)。targetZoomForOpenness は [MIN_ZOOM, MAX_ZOOM] にクランプするので
 * 開放度からは選ばれず、眺望状態(core/view.ts)だけがこの目標を要求する。
 */
export const VIEW_ZOOM = 0.35;

/** 開放度サンプリングの既定半径(タイル) */
export const OPENNESS_RADIUS = 22;
/** サンプリングの既定間引き(2=1タイルおき。tileAt呼び出しを1/4に減らす) */
export const OPENNESS_STEP = 2;

/** この開放度以下は標準ズーム(閉塞・通路) */
export const OPENNESS_LO = 0.55;
/** この開放度以上は最大ズームアウト(大空洞) */
export const OPENNESS_HI = 0.9;

/**
 * (cx,cy)中心の (2r+1)^2 タイル格子を step 間引きで走査し「非SOLIDの割合」(0..1)を返す。
 * AIR/LADDER を開放、SOLID を閉塞とみなす。tileAt は破壊反映済みの経路(store.tileAt)を渡す。
 * 純粋関数: 同じ tileAt・座標なら常に同じ出力。
 */
export function sampleOpenness(
  tileAt: (x: number, y: number) => number,
  cx: number,
  cy: number,
  r: number = OPENNESS_RADIUS,
  step: number = OPENNESS_STEP,
): number {
  let open = 0;
  let total = 0;
  // サンプル格子はプレイヤーではなく「ワールドの固定格子(stepの倍数)」にアンカーする。
  // floor(cx)-r 起点だと1タイル歩くたびにサンプル列の偶奇が丸ごと入れ替わり(step>1)、
  // 別の列集合を測るため開放度が鋸歯状に振動→ズームがぐわんぐわんする。固定格子なら
  // 移動しても同じ世界列を測り続け、端で列が1本出入りするだけの滑らかな変化になる。
  const x0 = Math.floor((Math.floor(cx) - r) / step) * step;
  const y0 = Math.floor((Math.floor(cy) - r) / step) * step;
  const x1 = Math.floor(cx) + r;
  const y1 = Math.floor(cy) + r;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      total++;
      if (!isSolid(tileAt(x, y))) open++;
    }
  }
  return total === 0 ? 0 : open / total;
}

/**
 * 開放度(0..1) → 目標ズーム。開放なほどズームアウト(小さいzoom)。
 * openness<=OPENNESS_LO は MAX_ZOOM、>=OPENNESS_HI は MIN_ZOOM、間は線形補間。
 * 範囲外は [MIN_ZOOM, MAX_ZOOM] にクランプ。
 */
export function targetZoomForOpenness(openness: number): number {
  const t = (openness - OPENNESS_LO) / (OPENNESS_HI - OPENNESS_LO);
  const clamped = Math.max(0, Math.min(1, t));
  return MAX_ZOOM + (MIN_ZOOM - MAX_ZOOM) * clamped;
}

/**
 * 許可ズーム段(離散)。ドット絵でサブピクセルのにじみを避けるため、描画ズームは
 * 原則この段のいずれかに静止する。段の選択はヒステリシス付きの nextZoomStep
 * (段キーパー)、描画値の移動は advanceZoom(遷移中のみ非段の値を取る)が担う。
 * 眺望専用の VIEW_ZOOM(0.35)と、MIN_ZOOM(0.5)〜MAX_ZOOM(1)の3段の計4段。昇順。
 */
export const ZOOM_STEPS: readonly number[] = [VIEW_ZOOM, 0.5, 0.75, 1];

/**
 * 連続ズーム値を最近傍の許可段へスナップ(範囲外はクランプ)。純関数・決定論・ヒステリシスなし
 * (前回段に依存しない)。同距離の中点は厳密不等号(d < bestD)により小さい段が勝つ。
 * 段キーパーの起点を求める用途に使う(段選択そのものは nextZoomStep)。
 */
export function quantizeZoom(z: number): number {
  let best = ZOOM_STEPS[0];
  let bestD = Infinity;
  for (const s of ZOOM_STEPS) {
    const d = Math.abs(z - s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * 段キーパーのヒステリシスマージン(ズーム単位)。隣の段との中点からこれだけ越えた
 * ときにだけ段を移すため、中点の前後 ±ZOOM_STEP_MARGIN の帯がデッドゾーンになり、
 * 連続ズームが段境界で小刻みに往復しても描画段はチャタリングしない。
 * 最も狭い段間隔(0.35↔0.5 = 0.15)の半分(0.075)より小さく、両方向から到達可能に保つ。
 */
export const ZOOM_STEP_MARGIN = 0.03;

/**
 * ヒステリシス付き段選択(段キーパー)。現在の段 current と連続ズーム desired から、
 * 維持すべき段を返す純関数(状態は「現在の段」だけ。呼び出し側が保持する)。
 *
 * - desired が現在の段より上: 隣の段との中点 + MARGIN を厳密に越えたときだけ上の段へ移る。
 *   大きく動けば 1 回の呼び出しで複数段でも追従する。
 * - desired が現在の段より下: 中点 − MARGIN を厳密に下回ったときだけ下の段へ移る。
 * - 境界ちょうどでは移らない(決定論)。current が段でない値なら最近傍段を起点にする。
 */
export function nextZoomStep(current: number, desired: number): number {
  let i = ZOOM_STEPS.indexOf(quantizeZoom(current));
  while (i < ZOOM_STEPS.length - 1) {
    const mid = (ZOOM_STEPS[i] + ZOOM_STEPS[i + 1]) / 2;
    if (desired > mid + ZOOM_STEP_MARGIN) i++;
    else break;
  }
  while (i > 0) {
    const mid = (ZOOM_STEPS[i - 1] + ZOOM_STEPS[i]) / 2;
    if (desired < mid - ZOOM_STEP_MARGIN) i--;
    else break;
  }
  return ZOOM_STEPS[i];
}

/**
 * 描画ズーム遷移の指数平滑係数(1/秒)。カメラ位置の追従(係数 8)と同じ速さで、
 * 0.25 の段差が約 0.4 秒で ZOOM_SNAP_EPSILON 内へ収まる。「段へ即時スナップ」の
 * ジャンプ(25〜33% のスケール変化が 1 フレーム)をこの遷移に置き換えるのが本対応の核。
 */
export const ZOOM_TRANSITION_RATE = 8;
/** 目標段との差がこれ未満になったら段へ正確にスナップして静止する(にじみの恒常化を防ぐ) */
export const ZOOM_SNAP_EPSILON = 0.002;

/**
 * 描画ズームを目標段へ 1 フレームぶん近づける純関数。指数平滑なので単調に近づき
 * 行き過ぎない。差が ZOOM_SNAP_EPSILON 未満になったら目標段そのものを返して静止させる。
 * 眺望段(VIEW_ZOOM)への出入りも、開放度由来の段移動も、この同じ経路を通す。
 */
export function advanceZoom(current: number, target: number, dt: number): number {
  const k = 1 - Math.exp(-ZOOM_TRANSITION_RATE * dt);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < ZOOM_SNAP_EPSILON ? target : next;
}
