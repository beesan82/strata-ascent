import { hash2 } from './noise';
import type { BiomeId } from './biomeCells';

/**
 * ドロップの抽選(アクション化 第2弾・§3、サバイバル段階 1 で糧食を追加、
 * エクストラクション段階 A で素材セルを追加、弾薬設計 2026-11-09 で砲弾を抽選から外した)。
 * 撃破時に 1 回だけ、スポーン ID と撃破カウンタから決定論で決める純関数。
 * 敵が落とすのは回復・糧食の消耗品と、持ち帰って確保する素材 1 種。
 * 弾薬(砲弾セル・パルス弾セル)は「場所」(武器庫・休憩点・ボス報酬)からしか出ない(弾薬設計 §3)。
 */

/**
 * 地面に置かれる物の種別。charge = 砲弾セル(拾うと携行の shell)、pulsecell = パルス弾セル、
 * valuable = 貴重品(段階 3-B。拾うと携行の valuable)
 */
export type DropKind = 'charge' | 'heal' | 'ration' | 'material' | 'pulsecell' | 'valuable';

/** 敵ドロップの抽選対象(弾薬を含まない) */
export type EnemyDropKind = 'heal' | 'ration' | 'material' | 'valuable';

/**
 * 基礎確率(倍率 1.0 の地区での重み)。どれか最大 1 個。
 * 回復・糧食・素材の重みはサバイバル設計 §5・段階 A の値を維持し、砲弾の区間だけを外した
 * (砲弾ぶんは他へ配分しない: 敵を倒すことの資源価値を下げ、場所を主経路にするため)。
 * 貴重品(段階 3-B §2)は全敵種 2%。区間の末尾に足すので、従来の 3 種の当たり方は変わらない
 * (従来 null だったロールの一部が貴重品になる)。
 */
const BASE_RATE: Record<'w' | 'f' | 't', Record<EnemyDropKind, number>> = {
  // Walker: 回復 12% / 糧食 16% / 素材 8% / 貴重品 2%
  w: { heal: 0.12, ration: 0.16, material: 0.08, valuable: 0.02 },
  // 飛行敵: 回復 12% / 糧食 11% / 素材 8% / 貴重品 2%
  f: { heal: 0.12, ration: 0.11, material: 0.08, valuable: 0.02 },
  // 固定砲台(v2.0 Task 6): 回復 10% / 糧食 10% / 素材 8% / 貴重品 2%
  t: { heal: 0.1, ration: 0.1, material: 0.08, valuable: 0.02 },
};

/** 重みの合計がこの値を超えたら全体を圧縮する上限(サバイバル設計 §5)。砲弾を外した後は届かないが仕組みは残す */
export const DROP_TOTAL_CAP = 0.62;

export interface DropProfile {
  heal: number;
  ration: number;
  material: number;
  valuable: number;
}

/**
 * 地区の寄せ(重み倍率)。回復は第2弾 §3 の表(居住区画は ×1.5、生体異物区は ×1.2)。
 * 糧食はサバイバル設計 §5 の表(居住は生活物資で ×1.6、生体は有機物で ×1.3、
 * 廃棄・水域・精錬は低め)。砲弾の倍率表は抽選から外れたので無い。
 * 素材は段階 A では共通素材 1 種なので全地区 ×1.0(地区固有は段階 C でここに寄せる)。
 * 貴重品(段階 3-B)も同じ仕組みに乗せ、初期値は全地区 ×1.0(調整はこの列で行う)。
 */
const DROP_PROFILE: Record<BiomeId, DropProfile> = {
  coldSteel: { heal: 1.0, ration: 1.0, material: 1.0, valuable: 1.0 },
  habitation: { heal: 1.5, ration: 1.6, material: 1.0, valuable: 1.0 },
  disposal: { heal: 1.0, ration: 0.7, material: 1.0, valuable: 1.0 },
  waterVoid: { heal: 1.0, ration: 0.8, material: 1.0, valuable: 1.0 },
  power: { heal: 1.0, ration: 0.9, material: 1.0, valuable: 1.0 },
  foundry: { heal: 1.0, ration: 0.8, material: 1.0, valuable: 1.0 },
  biomech: { heal: 1.2, ration: 1.3, material: 1.0, valuable: 1.0 },
};

export function dropProfileFor(biomeId: BiomeId): DropProfile {
  return DROP_PROFILE[biomeId];
}

const DROP_SALT = 4201;

/** スポーン ID 文字列の決定論ハッシュ(FNV-1a)。hash2 の座標スロットへ載せるための前処理 */
export function spawnIdHash(spawnId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < spawnId.length; i++) {
    h ^= spawnId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * 重み方式の実効確率: 基礎確率 × 地区倍率を 4 種ぶん合計し、合計が
 * DROP_TOTAL_CAP を超える場合だけ全体を圧縮する(サバイバル設計 §5。
 * 順番依存の累積確率で地区差が歪まないようにするため)。
 */
export function dropRatesFor(
  enemyKind: 'w' | 'f' | 't',
  biomeId: BiomeId,
): Record<EnemyDropKind, number> {
  const base = BASE_RATE[enemyKind];
  const profile = dropProfileFor(biomeId);
  const weights: Record<EnemyDropKind, number> = {
    heal: base.heal * profile.heal,
    ration: base.ration * profile.ration,
    material: base.material * profile.material,
    valuable: base.valuable * profile.valuable,
  };
  const total = weights.heal + weights.ration + weights.material + weights.valuable;
  const scale = total > DROP_TOTAL_CAP ? DROP_TOTAL_CAP / total : 1;
  return {
    heal: weights.heal * scale,
    ration: weights.ration * scale,
    material: weights.material * scale,
    valuable: weights.valuable * scale,
  };
}

/**
 * 撃破 1 回ぶんの抽選。敵種はスポーン ID の接頭辞(`w:` Walker / `f:` 飛行敵 / `t:` 固定砲台)で決まる。
 * ボス(`b:`)は対象外(確定ドロップは別経路)として常に null。
 * killIndex はセッション通算の撃破カウンタ(0 始まり)。
 * 区間の並びは 回復 → 糧食 → 素材 → 貴重品。先頭にあった砲弾の区間を外したので、同じロールでも
 * 従来とは結果が変わる(砲弾が出ていたロールの大半は null になる)。
 * 貴重品は末尾に足したので、圧縮がかからない限り回復・糧食・素材の当たりは段階 3-B 前と同じ。
 */
export function dropFor(
  seed: number,
  spawnId: string,
  killIndex: number,
  biomeId: BiomeId,
): EnemyDropKind | null {
  const kind = spawnId.startsWith('w:')
    ? 'w'
    : spawnId.startsWith('f:')
      ? 'f'
      : spawnId.startsWith('t:')
        ? 't'
        : null;
  if (kind === null) return null;
  const rates = dropRatesFor(kind, biomeId);
  const roll = hash2(seed + DROP_SALT, spawnIdHash(spawnId), killIndex);
  if (roll < rates.heal) return 'heal';
  if (roll < rates.heal + rates.ration) return 'ration';
  if (roll < rates.heal + rates.ration + rates.material) return 'material';
  if (roll < rates.heal + rates.ration + rates.material + rates.valuable) return 'valuable';
  return null;
}
