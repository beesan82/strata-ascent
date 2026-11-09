import { hash2 } from './noise';
import { spawnIdHash, type DropKind } from './drop';
import type { FloorRun, ProtectedPoint, SpawnRect } from './spawn';
import type { BiomeId } from './biomeCells';

/**
 * 物資漁り(サバイバル設計 §6)と休憩点の備蓄(§7)の決定論。
 * キャッシュは敵スキャンで列挙済みの床ランへ相乗りし、近傍に最大 1 個だけ置く。
 * 開封の差し引きは第2弾 §4 の裁定どおり「選定後の減算」とし、開封した候補の
 * 代わりに別の候補が繰り上がらないようにする。
 */

export interface SupplyCache {
  /** 床ランから決まる識別子 */
  id: string;
  /** 置き場所の中心 X(タイル) */
  x: number;
  /** 床の行 */
  floorY: number;
}

const CACHE_SALT = 4301;
/**
 * 選定は「適格なランの中でハッシュ最小のもの」を 1 件だけ取る(argmin)。
 * 列挙順に依存せず均一で、走査窓の中では常に 0〜1 個になる。
 * この値未満の最小ハッシュのときだけ置く(窓にランが多くても密度が上がらない)。
 */
export const CACHE_THRESHOLD = 0.6;

/**
 * 補給キャッシュの選定。適格条件: 床ラン長 5 以上(findFloorRuns の下限)、
 * 保護範囲外、大広間の中ではない。梯子列・通路については、床ラン自体が
 * 「床が SOLID で頭上 2 タイルが AIR」の場所だけを数えるため、梯子の通る列は
 * 床が LADDER になっておりランに含まれない。
 */
export function chooseSupplyCaches(
  seed: number,
  runs: readonly FloorRun[],
  protectedPoints: readonly ProtectedPoint[],
  halls: readonly SpawnRect[],
  claimed?: ReadonlySet<string>,
): SupplyCache[] {
  let best: SupplyCache | null = null;
  let bestRoll = Infinity;
  for (const run of runs) {
    if (run.len < 5) continue;
    const offset = Math.floor(hash2(seed + CACHE_SALT + 1, run.x, run.floorY) * Math.max(1, run.len - 1));
    const x = run.x + offset + 0.5;
    const inHall = halls.some(
      (h) => x >= h.x0 && x < h.x1 && run.floorY >= h.y0 && run.floorY < h.y1,
    );
    if (inHall) continue;
    const guarded = protectedPoints.some(
      (p) => Math.max(Math.abs(x - p.x), Math.abs(run.floorY - p.y)) <= p.r,
    );
    if (guarded) continue;
    const roll = hash2(seed + CACHE_SALT, run.x, run.floorY);
    if (roll < bestRoll) {
      bestRoll = roll;
      best = { id: `s:${run.x},${run.floorY}`, x, floorY: run.floorY };
    }
  }
  if (!best || bestRoll >= CACHE_THRESHOLD) return [];
  // 開封済みは選定の最後に差し引く(繰り上がり防止)
  if (claimed && claimed.has(best.id)) return [];
  return [best];
}

export interface SupplyTable {
  ration: number;
  heal: number;
  charge: number;
  material: number;
}

/** 消耗品 3 種の内訳(合計 1)。素材を混ぜる前の地区別の比率 */
interface ConsumableTable {
  ration: number;
  heal: number;
  charge: number;
}

/**
 * キャッシュの中身のうち消耗品の地区別比率(サバイバル設計 §6)。
 * 居住は生活物資、電力・精錬は砲弾、廃棄は残骸の薬莢、水域は流着した補給、生体は有機物。
 */
const SUPPLY_CONSUMABLES: Record<BiomeId, ConsumableTable> = {
  coldSteel: { ration: 0.5, heal: 0.25, charge: 0.25 },
  habitation: { ration: 0.55, heal: 0.35, charge: 0.1 },
  disposal: { ration: 0.35, heal: 0.25, charge: 0.4 },
  waterVoid: { ration: 0.45, heal: 0.2, charge: 0.35 },
  power: { ration: 0.35, heal: 0.15, charge: 0.5 },
  foundry: { ration: 0.35, heal: 0.15, charge: 0.5 },
  biomech: { ration: 0.55, heal: 0.3, charge: 0.15 },
};

/**
 * キャッシュから素材セルが出る確率(エクストラクション段階 A)。地区によらず一定で、
 * 残り(1 − この値)を消耗品 3 種が地区別の比率で分け合う(比率そのものは変えない)。
 */
export const SUPPLY_MATERIAL_RATE = 0.2;

/** キャッシュの中身の地区別確率(素材を混ぜた後。合計 1) */
export function supplyTableFor(biomeId: BiomeId): SupplyTable {
  const c = SUPPLY_CONSUMABLES[biomeId];
  const k = 1 - SUPPLY_MATERIAL_RATE;
  return {
    ration: c.ration * k,
    heal: c.heal * k,
    charge: c.charge * k,
    material: SUPPLY_MATERIAL_RATE,
  };
}

const SUPPLY_SALT = 4302;

/**
 * キャッシュ 1 個の中身(消耗品 3 種か素材のいずれか 1 個)。決定論。
 * 区間の並びは 糧食 → 回復 → 砲弾 → 素材(素材は末尾に足した)。
 */
export function supplyFor(seed: number, cacheId: string, biomeId: BiomeId): DropKind {
  const t = supplyTableFor(biomeId);
  const roll = hash2(seed + SUPPLY_SALT, spawnIdHash(cacheId), 0);
  if (roll < t.ration) return 'ration';
  if (roll < t.ration + t.heal) return 'heal';
  if (roll < t.ration + t.heal + t.charge) return 'charge';
  return 'material';
}

const REST_STOCK_SALT = 4303;

/**
 * 休憩点の備蓄の 2 個目(1 個目は常に糧食)。地区で固定し、寒鋼基層だけ
 * 休憩点 ID のハッシュで回復／砲弾を決める(サバイバル設計 §7)。
 */
export function restStockSecondFor(seed: number, restId: string, biomeId: BiomeId): DropKind {
  switch (biomeId) {
    case 'habitation':
    case 'disposal':
      return 'heal';
    case 'power':
    case 'foundry':
    case 'waterVoid':
      return 'charge';
    case 'biomech':
      return 'ration';
    case 'coldSteel':
      return hash2(seed + REST_STOCK_SALT, spawnIdHash(restId), 0) < 0.5 ? 'heal' : 'charge';
  }
}
