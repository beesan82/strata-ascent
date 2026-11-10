import { dropKindFor } from '../entities/drop';
import type { DropKind } from '../world/drop';
import { CARRY_KINDS, type CarryKind } from './carry';

/**
 * 遺留品(サバイバル要素 段階 3、設計書 2026-11-07-survival-design §8)。
 * 死亡時に落とす物の構成と場所、遺留品の箇所数の管理を純関数で持つ。
 * 段階 3-B(設計書 2026-11-10-stage3b-design §1)で、所持糧食に加えて未確保の携行品
 * (素材・貴重品・砲弾・パルス弾セル)も全て同じ箇所へ落とすようになった。
 *
 * 落とす場所は死亡座標そのものではなく「最後に安定して接地していた場所」とする。
 * 死亡座標は空中や掘削直後の不安定な場所になり得て、遺留品が回収不能になるためである。
 */

/** 安定した接地とみなす連続接地時間(秒) */
export const STABLE_GROUND_SEC = 1;
/** 遺留品を残す最大の箇所数(3 箇所目ができた時点で最も古い箇所が消える) */
export const MAX_REMAINS_SITES = 2;
/** 遺留品を横に並べる幅の半分(タイル)。段階 3 の糧食 2 個の配置(±0.75)を上限として保つ */
export const REMAINS_SPREAD = 0.75;

/**
 * 死亡時に落とす地面ドロップの種別の並び(段階 3-B §1)。
 * 携行中(未確保)の各種別を個数ぶん地面の種別へ写し(dropKindFor)、その後に所持糧食を続ける。
 * 携行の並びは CARRY_KINDS の順。確保済みは引数に含めない(減らさない)。
 */
export function remainsDropKinds(rations: number, carried: Readonly<Record<CarryKind, number>>): DropKind[] {
  const kinds: DropKind[] = [];
  for (const k of CARRY_KINDS) {
    for (let i = 0; i < carried[k]; i++) kinds.push(dropKindFor(k));
  }
  for (let i = 0; i < rations; i++) kinds.push('ration');
  return kinds;
}

/**
 * n 個の遺留品の横方向のオフセット(安定接地点の中心から)。1 個は中央、2 個以上は
 * ±REMAINS_SPREAD の間に等間隔で並べる(2 個なら段階 3 と同じ ±0.75)。
 * 幅を広げないのは、安定接地点から離れて壁や段差の向こうへ置かれるのを避けるため。
 */
export function remainsOffsets(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const step = (REMAINS_SPREAD * 2) / (n - 1);
  const offsets: number[] = [];
  for (let i = 0; i < n; i++) offsets.push(-REMAINS_SPREAD + step * i);
  return offsets;
}

export interface GroundAnchor {
  /** 最後に安定して接地していた位置(ボディ左上)。初期値はスポーン地点 */
  x: number;
  y: number;
  /** 連続接地時間(秒)。接地が途切れるかノックバックを受けると 0 に戻る */
  groundedT: number;
}

export function initialGroundAnchor(x: number, y: number): GroundAnchor {
  return { x, y, groundedT: 0 };
}

export interface GroundAnchorInput {
  /** 今ステップで接地しているか */
  grounded: boolean;
  /** ノックバック中は接地していても安定とみなさない(設計 §8) */
  knocked: boolean;
  /** 現在位置(ボディ左上) */
  x: number;
  y: number;
  dt: number;
}

/**
 * 安定接地点の更新。接地が 1 秒続いた時点から、その間ずっとアンカーは現在位置へ追従する
 * (歩き続けている場所も「安定して接地していた場所」である)。
 * 空中・ノックバック中は蓄積をリセットし、アンカー自体は最後の安定位置に留める。
 * 消耗と同じく線形の蓄積なので、dt の刻み方で結果は変わらない。
 */
export function stepGroundAnchor(anchor: GroundAnchor, input: GroundAnchorInput): GroundAnchor {
  if (!input.grounded || input.knocked) {
    return { x: anchor.x, y: anchor.y, groundedT: 0 };
  }
  const groundedT = anchor.groundedT + input.dt;
  if (groundedT >= STABLE_GROUND_SEC) {
    return { x: input.x, y: input.y, groundedT };
  }
  return { x: anchor.x, y: anchor.y, groundedT };
}

/**
 * 実体が 1 つも残っていない遺留品の箇所を取り除く(回収済み・消滅済みの掃除)。
 * 一部だけ残っている箇所は残す(残りはまだ回収できる)。
 * present は現在存在する実体の一覧で、同一性(参照)で判定する。
 */
export function pruneRemainsSites<T>(sites: readonly T[][], present: readonly T[]): T[][] {
  const presentSet = new Set(present);
  return sites.filter((site) => site.some((item) => presentSet.has(item))).map((site) => [...site]);
}

/**
 * 遺留品の箇所を追加し、上限を超えた分は最も古い箇所から取り除く。
 * evicted は取り除かれた箇所の実体(呼び出し側が世界から消す)。
 */
export function addRemainsSite<T>(
  sites: readonly T[][],
  items: readonly T[],
): { sites: T[][]; evicted: T[] } {
  const next = [...sites.map((site) => [...site]), [...items]];
  const evicted: T[] = [];
  while (next.length > MAX_REMAINS_SITES) {
    evicted.push(...next.shift()!);
  }
  return { sites: next, evicted };
}
