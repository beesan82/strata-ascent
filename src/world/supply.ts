import { hash2 } from './noise';
import { spawnIdHash, type DropKind } from './drop';
import type { FloorRun, ProtectedPoint, SpawnRect } from './spawn';
import type { BiomeId } from './biomeCells';

/**
 * 物資漁り(サバイバル設計 §6)、休憩点の備蓄(§7)、武器庫(弾薬設計 2026-11-09 §2)の決定論。
 * キャッシュと武器庫は敵スキャンで列挙済みの床ランへ相乗りし、それぞれ近傍に最大 1 個だけ置く。
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

/**
 * 選定の粘着の保持半径(タイル、設計 2026-11-10 armory-stability §1)。敵スキャンの窓
 * (横 ±40・縦 ±24)より広くし、窓の境界をまたいだだけでは手放さないようにする。
 */
export const SPOT_HOLD_RADIUS = 48;

/**
 * キャッシュ・武器庫の粘着選定(設計 2026-11-10 armory-stability §1)。
 * 前回の選択が未開封で、プレイヤーから保持半径以内にあれば、今回の候補に入っていなくても
 * レコードごと維持する。維持できないときだけ候補から最寄り(ユークリッド距離)を選ぶ。
 * 距離が同じなら候補の並び順で先のもの。候補が空なら null。開封済みの候補は選ばない
 * (候補は選定側で開封済みを差し引いているが、念のためここでも除く)。
 */
export function holdSpot(
  prev: SupplyCache | null,
  candidates: readonly SupplyCache[],
  px: number,
  py: number,
  claimed?: ReadonlySet<string>,
  radius: number = SPOT_HOLD_RADIUS,
): SupplyCache | null {
  const dist = (s: SupplyCache) => Math.hypot(s.x - px, s.floorY - py);
  if (prev && !(claimed && claimed.has(prev.id)) && dist(prev) <= radius) return prev;
  let best: SupplyCache | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    if (claimed && claimed.has(c.id)) continue;
    const d = dist(c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export interface SupplyTable {
  ration: number;
  heal: number;
  charge: number;
  material: number;
  valuable: number;
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

/**
 * キャッシュから貴重品が出る確率(段階 3-B §2、目安 5%)。地区によらず一定。
 * 素材と同じく消耗品 3 種の取り分から差し引く(素材の確率は変えない)。
 */
export const SUPPLY_VALUABLE_RATE = 0.05;

/** キャッシュの中身の地区別確率(素材・貴重品を混ぜた後。合計 1) */
export function supplyTableFor(biomeId: BiomeId): SupplyTable {
  const c = SUPPLY_CONSUMABLES[biomeId];
  const k = 1 - SUPPLY_MATERIAL_RATE - SUPPLY_VALUABLE_RATE;
  return {
    ration: c.ration * k,
    heal: c.heal * k,
    charge: c.charge * k,
    material: SUPPLY_MATERIAL_RATE,
    valuable: SUPPLY_VALUABLE_RATE,
  };
}

const SUPPLY_SALT = 4302;

/**
 * キャッシュ 1 個の中身(消耗品 3 種・素材・貴重品のいずれか 1 個)。決定論。
 * 区間の並びは 糧食 → 回復 → 砲弾 → 素材 → 貴重品(素材、貴重品の順に末尾へ足した)。
 * 消耗品の取り分が縮んだぶん、段階 3-B 前とは境界付近のロールの結果が変わる。
 */
export function supplyFor(seed: number, cacheId: string, biomeId: BiomeId): DropKind {
  const t = supplyTableFor(biomeId);
  const roll = hash2(seed + SUPPLY_SALT, spawnIdHash(cacheId), 0);
  if (roll < t.ration) return 'ration';
  if (roll < t.ration + t.heal) return 'heal';
  if (roll < t.ration + t.heal + t.charge) return 'charge';
  if (roll < t.ration + t.heal + t.charge + t.material) return 'material';
  return 'valuable';
}

const REST_STOCK_SALT = 4303;

/**
 * 休憩点の備蓄の 2 個目が砲弾になる確率(残りはパルス弾セル)。地区で寄せる:
 * 電力区・精錬区・水域は砲弾寄り(旧表で砲弾が出ていた地区)、それ以外はパルス弾セル寄り。
 */
export const REST_STOCK_SHELL_RATE: Record<BiomeId, number> = {
  coldSteel: 0.4,
  habitation: 0.3,
  disposal: 0.4,
  waterVoid: 0.6,
  power: 0.6,
  foundry: 0.6,
  biomech: 0.3,
};

/**
 * 休憩点の備蓄の 2 個目(1 個目は常に糧食)。弾薬設計 §3 で「糧食 1 ＋ 弾薬 1」に寄せ、
 * 砲弾かパルス弾セルかを休憩点 ID のハッシュで決める(地区別の砲弾率 REST_STOCK_SHELL_RATE)。
 */
export function restStockSecondFor(seed: number, restId: string, biomeId: BiomeId): DropKind {
  const roll = hash2(seed + REST_STOCK_SALT, spawnIdHash(restId), 0);
  return roll < REST_STOCK_SHELL_RATE[biomeId] ? 'charge' : 'pulsecell';
}

// ---- 武器庫(弾薬設計 §2) ----

const ARMORY_SALT = 4304;

/**
 * 武器庫の基礎密度。キャッシュと同じ argmin 方式で、最小ハッシュがこの値 × 地区倍率未満のとき置く。
 * キャッシュ(0.6)より薄く、弾薬は「探しに行く場所」として希少にする。
 */
export const ARMORY_THRESHOLD = 0.3;

/**
 * 武器庫の地区倍率(弾薬設計 §2: 電力区・精錬区は濃く、水域・生体は薄く)。
 * 電力・精錬 1.6 ≒ 窓の 48%、寒鋼・廃棄 1.0 = 30%、居住 0.8、水域・生体 0.5 = 15%。
 */
export const ARMORY_MUL: Record<BiomeId, number> = {
  coldSteel: 1.0,
  habitation: 0.8,
  disposal: 1.0,
  waterVoid: 0.5,
  power: 1.6,
  foundry: 1.6,
  biomech: 0.5,
};

/** 武器庫を開封したときに出る物資(砲弾 1 ＋ パルス弾セル 2)。並びは出現位置の割り当て順 */
export const ARMORY_CONTENTS: readonly DropKind[] = ['pulsecell', 'charge', 'pulsecell'];

/**
 * 武器庫の選定。補給キャッシュの選定(chooseSupplyCaches)に相乗りする別種のスポットで、
 * 同じ床ラン・保護点・大広間の除外を使い、ハッシュの塩と密度(地区倍率)だけが違う。
 * 開封済みの差し引きも同じく「選定後の減算」(繰り上がり防止)。ID は `a:` 接頭辞。
 * 通常キャッシュと同じ場所に重ならないよう、呼び出し側はキャッシュの位置を保護点に加える。
 */
export function chooseArmories(
  seed: number,
  runs: readonly FloorRun[],
  protectedPoints: readonly ProtectedPoint[],
  halls: readonly SpawnRect[],
  biomeId: BiomeId,
  claimed?: ReadonlySet<string>,
): SupplyCache[] {
  let best: SupplyCache | null = null;
  let bestRoll = Infinity;
  for (const run of runs) {
    if (run.len < 5) continue;
    const offset = Math.floor(hash2(seed + ARMORY_SALT + 1, run.x, run.floorY) * Math.max(1, run.len - 1));
    const x = run.x + offset + 0.5;
    const inHall = halls.some(
      (h) => x >= h.x0 && x < h.x1 && run.floorY >= h.y0 && run.floorY < h.y1,
    );
    if (inHall) continue;
    const guarded = protectedPoints.some(
      (p) => Math.max(Math.abs(x - p.x), Math.abs(run.floorY - p.y)) <= p.r,
    );
    if (guarded) continue;
    const roll = hash2(seed + ARMORY_SALT, run.x, run.floorY);
    if (roll < bestRoll) {
      bestRoll = roll;
      best = { id: `a:${run.x},${run.floorY}`, x, floorY: run.floorY };
    }
  }
  if (!best || bestRoll >= Math.min(1, ARMORY_THRESHOLD * ARMORY_MUL[biomeId])) return [];
  if (claimed && claimed.has(best.id)) return [];
  return [best];
}
