import { hash2 } from './noise';
import type { BiomeId } from './biomeCells';

/**
 * ドロップの抽選(アクション化 第2弾・§3、サバイバル段階 1 で糧食を追加、
 * エクストラクション段階 A で素材セルを追加)。
 * 撃破時に 1 回だけ、スポーン ID と撃破カウンタから決定論で決める純関数。
 * 落ちるのは既存の資源体系に接続する消耗品 3 種と、持ち帰って確保する素材 1 種
 * (新しい通貨は作らない)。
 */

export type DropKind = 'charge' | 'heal' | 'ration' | 'material';

/**
 * 基礎確率(倍率 1.0 の地区での重み)。どれか最大 1 個。
 * サバイバル設計 §5: 砲弾・回復を少し下げ、その分を糧食へ回して総量を膨らませない。
 * 素材(段階 A)は敵種によらず 8% で、消耗品の基礎確率は変えない。合計が上限を超える
 * 地区だけ圧縮で消耗品が数ポイント下がる(裁定は計画書末尾)。
 */
const BASE_RATE: Record<'w' | 'f' | 't', Record<DropKind, number>> = {
  // Walker: 砲弾 22% / 回復 12% / 糧食 16% / 素材 8%
  w: { charge: 0.22, heal: 0.12, ration: 0.16, material: 0.08 },
  // 飛行敵: 砲弾 27% / 回復 12% / 糧食 11% / 素材 8%
  f: { charge: 0.27, heal: 0.12, ration: 0.11, material: 0.08 },
  // 固定砲台(v2.0 Task 6): 砲弾 25% / 回復 10% / 糧食 10% / 素材 8%
  t: { charge: 0.25, heal: 0.1, ration: 0.1, material: 0.08 },
};

/** 重みの合計がこの値を超えたら全体を圧縮する上限(サバイバル設計 §5) */
export const DROP_TOTAL_CAP = 0.62;

export interface DropProfile {
  charge: number;
  heal: number;
  ration: number;
  material: number;
}

/**
 * 地区の寄せ(重み倍率)。砲弾・回復は第2弾 §3 の表(精錬区は砲弾 ×2.0、
 * 居住区画は回復 ×1.5、生体異物区は両方 ×1.2、大空洞水域は砲弾 ×1.3)。
 * 糧食はサバイバル設計 §5 の表(居住は生活物資で ×1.6、生体は有機物で ×1.3、
 * 廃棄・水域・精錬は低め)。
 * 素材は段階 A では共通素材 1 種なので全地区 ×1.0(地区固有は段階 C でここに寄せる)。
 */
const DROP_PROFILE: Record<BiomeId, DropProfile> = {
  coldSteel: { charge: 1.0, heal: 1.0, ration: 1.0, material: 1.0 },
  habitation: { charge: 1.0, heal: 1.5, ration: 1.6, material: 1.0 },
  disposal: { charge: 1.0, heal: 1.0, ration: 0.7, material: 1.0 },
  waterVoid: { charge: 1.3, heal: 1.0, ration: 0.8, material: 1.0 },
  power: { charge: 1.0, heal: 1.0, ration: 0.9, material: 1.0 },
  foundry: { charge: 2.0, heal: 1.0, ration: 0.8, material: 1.0 },
  biomech: { charge: 1.2, heal: 1.2, ration: 1.3, material: 1.0 },
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
): Record<DropKind, number> {
  const base = BASE_RATE[enemyKind];
  const profile = dropProfileFor(biomeId);
  const weights: Record<DropKind, number> = {
    charge: base.charge * profile.charge,
    heal: base.heal * profile.heal,
    ration: base.ration * profile.ration,
    material: base.material * profile.material,
  };
  const total = weights.charge + weights.heal + weights.ration + weights.material;
  const scale = total > DROP_TOTAL_CAP ? DROP_TOTAL_CAP / total : 1;
  return {
    charge: weights.charge * scale,
    heal: weights.heal * scale,
    ration: weights.ration * scale,
    material: weights.material * scale,
  };
}

/**
 * 撃破 1 回ぶんの抽選。敵種はスポーン ID の接頭辞(`w:` Walker / `f:` 飛行敵 / `t:` 固定砲台)で決まる。
 * ボス(`b:`)は対象外(確定ドロップは別経路)として常に null。
 * killIndex はセッション通算の撃破カウンタ(0 始まり)。
 * 区間の並びは 砲弾 → 回復 → 糧食 → 素材 で、素材は既存 3 種の後ろに足した
 * (消耗品の区間はそのままなので、圧縮の無い地区では従来の抽選結果が変わらない)。
 */
export function dropFor(
  seed: number,
  spawnId: string,
  killIndex: number,
  biomeId: BiomeId,
): DropKind | null {
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
  if (roll < rates.charge) return 'charge';
  if (roll < rates.charge + rates.heal) return 'heal';
  if (roll < rates.charge + rates.heal + rates.ration) return 'ration';
  if (roll < rates.charge + rates.heal + rates.ration + rates.material) return 'material';
  return null;
}
