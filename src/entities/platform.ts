import { bodyOverlapsSolid, tryDisplace, type Body, type TileLookup } from './physics';

/**
 * 運ぶ物理(設計 2026-11-10-infrastructure §共通の芯)。昇降機のプラットフォームとトラムの屋根が共有する。
 *
 * 足場はタイルではない AABB の実体で、上面だけが一方通行の床になる(下から・横からはすり抜ける)。
 * 1 ステップの順序(main):
 *   1. 足場を動かす。前のステップで上面に立っていた乗り手には、足場の変位を carryRider で先に適用する
 *      (地形衝突つき。壁に阻まれた乗り手はその場に残り、足場との接触が切れる)
 *   2. 乗り手の通常の更新(Player.update。歩く・跳ぶ・撃つはそのまま)
 *   3. landOnPlatform で上面への着地を解決し、isRiding で次のステップの乗り手を決める
 * すべて純粋関数(carryRider / landOnPlatform は渡された body だけを書き換える)。Math.random は使わない。
 */

/** 足場の上面。y は上面の Y(タイル座標、下向き正)、[x, x + w) が上面の横の広がり */
export interface Platform {
  id: string;
  x: number;
  y: number;
  w: number;
}

/**
 * 上面に立っているとみなす足元と上面の差(タイル)。地形の床の上では moveBody の 1/16 刻み探索のため
 * 足元が床面から最大 1/16 浮くので、それより少し広く取る(昇降機の下の停止階は床面と上面が同じ高さ)
 */
export const RIDE_EPS = 0.07;

/**
 * 着地を拾う許容(タイル)。更新前の足元が上面からこれ以上下にあったら「下から来た」とみなして拾わない。
 * 1 ステップの足場の移動量(昇降機 5/60、トラムは横だけ)より大きく、体が上面へ食い込む量より小さく取る
 */
export const LAND_TOL = 0.15;

/** 体と上面が横に重なっているか */
export function overlapsX(body: Body, p: Platform): boolean {
  return body.x < p.x + p.w && body.x + body.w > p.x;
}

/** 体が上面に立っているか(接地していて、横に重なり、足元が上面から RIDE_EPS 以内) */
export function isRiding(body: Body, p: Platform): boolean {
  return body.onGround && overlapsX(body, p) && Math.abs(body.y + body.h - p.y) <= RIDE_EPS;
}

/** carryRider の結果。carried = 全部運んだ、left = 壁に阻まれて置いていかれた、stalled = 足場を止めるべき */
export type CarryResult = 'carried' | 'left' | 'stalled';

/**
 * 足場の変位 (dx, dy) を乗り手へ先に適用する(地形衝突つき)。
 * - 全部適用できたら 'carried'
 * - 阻まれたとき、stallWhenBlocked なら体を動かさず 'stalled'(昇降機の上昇で天井へ押しつける挟まり。
 *   呼び出し側は足場をこのステップ動かさない)
 * - それ以外は阻まれる手前まで動かして 'left'(体はその場に残り、足場との接触は自然に切れる)
 */
export function carryRider(
  body: Body, dx: number, dy: number, tiles: TileLookup, stallWhenBlocked: boolean,
): CarryResult {
  const r = tryDisplace(body, dx, dy, tiles);
  if (r.blocked && stallWhenBlocked) return 'stalled';
  body.x = r.x;
  body.y = r.y;
  return r.blocked ? 'left' : 'carried';
}

/**
 * 上面への着地(一方通行の床)。prevBottom は乗り手の更新前(運んだ後)の足元。次をすべて満たすとき
 * 体を上面に置き、vy = 0・接地にして true を返す:
 * - 上昇中でない(跳んで下から抜けるときは拾わない)
 * - 横に重なる
 * - 更新前の足元が上面より LAND_TOL を超えて下にない(上から来た)
 * - 更新後の足元が上面に届いている
 * - 置いた位置が地形と重ならない(足場に体を埋めて閉じ込めない。重なるなら拾わずにすり抜ける)
 */
export function landOnPlatform(body: Body, prevBottom: number, p: Platform, tiles: TileLookup): boolean {
  if (body.vy < 0) return false;
  if (!overlapsX(body, p)) return false;
  if (prevBottom > p.y + LAND_TOL) return false;
  if (body.y + body.h < p.y) return false;
  const y = p.y - body.h;
  if (bodyOverlapsSolid(tiles, body.x, y, body.w, body.h)) return false;
  body.y = y;
  body.vy = 0;
  body.onGround = true;
  return true;
}
