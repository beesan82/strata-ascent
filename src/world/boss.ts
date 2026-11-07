import { grandHallAt, type GrandHall } from './grandhall';
import type { DropKind } from './drop';

/**
 * ボス「広間番人」の配置(アクション化 第2弾・§2)。大広間(`grandHallAt`)がある
 * セルに 1 体だけ、広間の床の中央に置く。実体の生成は Walker と同じ有効化の
 * 仕組みに相乗りし、ここは純関数の配置決定だけを担う。
 */

export interface BossSpawn {
  /** スポーン識別子(`b:${cell}`。撃破記録の保持 §4 と同じ名前空間) */
  id: string;
  cell: number;
  /** 出現点の中心 x(広間の床の中央) */
  x: number;
  /** 足が着く床の行(= hall.floorY) */
  floorY: number;
  /** 居場所の大広間(移動クランプと arena 判定に使う) */
  hall: GrandHall;
}

/**
 * ボス撃破時の確定ドロップの構成(サバイバル段階 2、設計 §5・§10)。
 * 総数 3 は維持し、内訳は回復 1 + 砲弾 1 + 糧食 1(段階 1 までは砲弾 2 だった)。
 * 並びは出現位置の割り当て順(中心=回復、左=砲弾、右=糧食)に対応する。
 * 抽選(dropFor)は経由しない確定報酬である。
 */
export function bossRewardFor(): readonly DropKind[] {
  return ['heal', 'charge', 'ration'];
}

/**
 * セル cell のボス出現点。大広間が無いセルでは null。
 * 撃破済み(defeated に `b:${cell}` を含む)なら再出現を抑止して null(再戦不可)。
 */
export function bossSpawnFor(
  seed: number,
  cell: number,
  defeated?: ReadonlySet<string>,
): BossSpawn | null {
  const hall = grandHallAt(seed, cell);
  if (!hall) return null;
  const id = `b:${cell}`;
  if (defeated && defeated.has(id)) return null;
  return {
    id,
    cell,
    x: (hall.x0 + hall.x1) / 2,
    floorY: hall.floorY,
    hall,
  };
}
