/**
 * パルス弾・敵弾の「形」を決める純粋関数(段階1 エフェクト設計 §1)。
 * 弾は速度ベクトルの角度に沿って回転した 2 層(外帯+芯)の矩形で描く。
 * 長さ・太さは従来の横/縦 2 分岐と同じ定数(外帯 0.62/0.26、芯 0.44/0.13 タイル)を踏襲し、
 * 内部バッファ座標の整数 px に丸める(低解像度+量子化で斜めは階段状になるが、それがドット調)。
 */

/** 軸合わせの判定の許容誤差(rad)。8 方向入力の弾と砲台の弾の cos/sin の誤差を吸収する */
const AXIS_EPS = 1e-6;

export interface ShotShape {
  /** 進行方向(rad)。速度ゼロは 0(横向きフォールバック) */
  angle: number;
  /** 'h'/'v' は軸に沿った弾(回転なしで整数 px に置ける)。'diag' は回転描画 */
  axis: 'h' | 'v' | 'diag';
  /** 外帯の長さ・太さ(px、内部バッファ座標) */
  outerLen: number;
  outerWid: number;
  /** 芯の長さ・太さ(px) */
  coreLen: number;
  coreWid: number;
}

/** 角度が 0・±π/2・±π のどれかに一致するか(回転なしで描ける向きか) */
function axisOf(angle: number): ShotShape['axis'] {
  const a = Math.abs(angle);
  if (a < AXIS_EPS || Math.abs(a - Math.PI) < AXIS_EPS) return 'h';
  if (Math.abs(a - Math.PI / 2) < AXIS_EPS) return 'v';
  return 'diag';
}

/**
 * 速度(方向)ベクトル (dx, dy) と px/タイル(ppt)から弾の形を返す。
 * ベクトルの長さは問わない(角度だけを使う)。ゼロベクトルは横向き。
 */
export function shotShape(dx: number, dy: number, ppt: number): ShotShape {
  const angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
  return {
    angle,
    axis: axisOf(angle),
    outerLen: Math.max(2, Math.round(0.62 * ppt)),
    outerWid: Math.max(1, Math.round(0.26 * ppt)),
    coreLen: Math.max(2, Math.round(0.44 * ppt)),
    coreWid: Math.max(1, Math.round(0.13 * ppt)),
  };
}
