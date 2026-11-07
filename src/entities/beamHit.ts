import { BORE_LENGTH, BORE_RADIUS } from './graviton';

/**
 * 重粒子砲のビームが敵に当たるか(第2弾 §3)。掘削(bore)と同幾何の capsule 近似:
 * 発射点から角度方向へ BORE_LENGTH の線分を引き、敵の中心から線分への距離が
 * BORE_RADIUS + 敵の半対角(体の w/h から)以内なら命中とする。純粋関数。
 * 実際の掘削はタイル単位で止まる地形に左右されるが、敵判定はこの近似で固定する
 * (壁越しの命中がありうるのは近似の範囲として受け入れる)。
 */
export function beamHit(
  ox: number,
  oy: number,
  angle: number,
  cx: number,
  cy: number,
  halfDiag: number,
): boolean {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const px = cx - ox;
  const py = cy - oy;
  // 線分への射影(0..BORE_LENGTH にクランプ)からの最接近点との距離
  const t = Math.max(0, Math.min(BORE_LENGTH, px * dx + py * dy));
  const qx = px - dx * t;
  const qy = py - dy * t;
  const r = BORE_RADIUS + halfDiag;
  return qx * qx + qy * qy <= r * r;
}
