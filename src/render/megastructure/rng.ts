import { hash2 } from '../../world/noise';

/** カタログが使う再現可能な乱数列。呼ぶたびに内部カウンタを進めて hash2 を引く。 */
export type Rng = () => number;

/**
 * (seed, a, b) から決定論的な乱数列を生成する。
 * a,b はスロットのワールド座標や変種seedなどを渡し、系列を分ける。
 */
export function makeRng(seed: number, a: number, b: number): Rng {
  const base = (seed + Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  let n = 0;
  return () => hash2(base, n++, 0);
}
