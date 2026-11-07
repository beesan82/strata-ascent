import { hash2 } from './noise';
import type { BiomeId } from './biomeCells';

/**
 * ドロップの抽選(アクション化 第2弾・§3、サバイバル段階 1 で糧食を追加)。
 * 撃破時に 1 回だけ、スポーン ID と撃破カウンタから決定論で決める純関数。
 * 落ちるのは既存の資源体系に接続する 3 種だけ(新しい通貨は作らない)。
 */

export type DropKind = 'charge' | 'heal' | 'ration';

/**
 * 基礎確率(倍率 1.0 の地区での重み)。どちらか最大 1 個、合計は約 50%。
 * サバイバル設計 §5: 砲弾・回復を少し下げ、その分を糧食へ回して総量を膨らませない。
 */
const BASE_RATE: Record<'w' | 'f', Record<DropKind, number>> = {
  // Walker: 砲弾 22% / 回復 12% / 糧食 16%
  w: { charge: 0.22, heal: 0.12, ration: 0.16 },
  // 飛行敵: 砲弾 27% / 回復 12% / 糧食 11%
  f: { charge: 0.27, heal: 0.12, ration: 0.11 },
};

/** 重みの合計がこの値を超えたら全体を圧縮する上限(サバイバル設計 §5) */
export const DROP_TOTAL_CAP = 0.62;

export interface DropProfile {
  charge: number;
  heal: number;
  ration: number;
}

/**
 * 地区の寄せ(重み倍率)。砲弾・回復は第2弾 §3 の表(精錬区は砲弾 ×2.0、
 * 居住区画は回復 ×1.5、生体異物区は両方 ×1.2、大空洞水域は砲弾 ×1.3)。
 * 糧食はサバイバル設計 §5 の表(居住は生活物資で ×1.6、生体は有機物で ×1.3、
 * 廃棄・水域・精錬は低め)。
 */
const DROP_PROFILE: Record<BiomeId, DropProfile> = {
  coldSteel: { charge: 1.0, heal: 1.0, ration: 1.0 },
  habitation: { charge: 1.0, heal: 1.5, ration: 1.6 },
  disposal: { charge: 1.0, heal: 1.0, ration: 0.7 },
  waterVoid: { charge: 1.3, heal: 1.0, ration: 0.8 },
  power: { charge: 1.0, heal: 1.0, ration: 0.9 },
  foundry: { charge: 2.0, heal: 1.0, ration: 0.8 },
  biomech: { charge: 1.2, heal: 1.2, ration: 1.3 },
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
 * 重み方式の実効確率: 基礎確率 × 地区倍率を 3 種ぶん合計し、合計が
 * DROP_TOTAL_CAP を超える場合だけ全体を圧縮する(サバイバル設計 §5。
 * 順番依存の累積確率で地区差が歪まないようにするため)。
 */
export function dropRatesFor(
  enemyKind: 'w' | 'f',
  biomeId: BiomeId,
): Record<DropKind, number> {
  const base = BASE_RATE[enemyKind];
  const profile = dropProfileFor(biomeId);
  const weights: Record<DropKind, number> = {
    charge: base.charge * profile.charge,
    heal: base.heal * profile.heal,
    ration: base.ration * profile.ration,
  };
  const total = weights.charge + weights.heal + weights.ration;
  const scale = total > DROP_TOTAL_CAP ? DROP_TOTAL_CAP / total : 1;
  return {
    charge: weights.charge * scale,
    heal: weights.heal * scale,
    ration: weights.ration * scale,
  };
}

/**
 * 撃破 1 回ぶんの抽選。敵種はスポーン ID の接頭辞(`w:` Walker / `f:` 飛行敵)で決まる。
 * ボス(`b:`)は対象外(確定ドロップは別経路)として常に null。
 * killIndex はセッション通算の撃破カウンタ(0 始まり)。
 */
export function dropFor(
  seed: number,
  spawnId: string,
  killIndex: number,
  biomeId: BiomeId,
): DropKind | null {
  const kind = spawnId.startsWith('w:') ? 'w' : spawnId.startsWith('f:') ? 'f' : null;
  if (kind === null) return null;
  const rates = dropRatesFor(kind, biomeId);
  const roll = hash2(seed + DROP_SALT, spawnIdHash(spawnId), killIndex);
  if (roll < rates.charge) return 'charge';
  if (roll < rates.charge + rates.heal) return 'heal';
  if (roll < rates.charge + rates.heal + rates.ration) return 'ration';
  return null;
}
