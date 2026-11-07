import { hash2 } from './noise';
import type { BiomeId } from './biomeCells';

/**
 * ドロップの抽選(アクション化 第2弾・§3)。撃破時に 1 回だけ、スポーン ID と
 * 撃破カウンタから決定論で決める純関数。実行時の乱数は使わない。
 * 落ちるのは既存の資源体系(砲の弾数・HP)に接続する 2 種だけ。
 */

export type DropKind = 'charge' | 'heal';

/** 基礎確率(倍率 1.0 の地区での値)。どちらか最大 1 個 */
const BASE_RATE: Record<'w' | 'f', Record<DropKind, number>> = {
  // Walker: 砲弾 25% / 回復 15%
  w: { charge: 0.25, heal: 0.15 },
  // 飛行敵: 空中戦の消耗への見返りとして砲弾寄り(30% / 15%)
  f: { charge: 0.3, heal: 0.15 },
};

export interface DropProfile {
  charge: number;
  heal: number;
}

/**
 * 地区の寄せ(重み倍率)。精錬区は「砲弾の材料」(ゾーン設計 §5 の予約)として
 * 砲弾 ×2.0、居住区画は回復 ×1.5、生体異物区は両方 ×1.2、大空洞水域は砲弾 ×1.3。
 * 電力区は将来の接続用に表だけ用意し ×1.0。
 */
const DROP_PROFILE: Record<BiomeId, DropProfile> = {
  coldSteel: { charge: 1.0, heal: 1.0 },
  habitation: { charge: 1.0, heal: 1.5 },
  disposal: { charge: 1.0, heal: 1.0 },
  waterVoid: { charge: 1.3, heal: 1.0 },
  power: { charge: 1.0, heal: 1.0 },
  foundry: { charge: 2.0, heal: 1.0 },
  biomech: { charge: 1.2, heal: 1.2 },
};

export function dropProfileFor(biomeId: BiomeId): DropProfile {
  return DROP_PROFILE[biomeId];
}

const DROP_SALT = 4201;

/** スポーン ID 文字列の決定論ハッシュ(FNV-1a)。hash2 の座標スロットへ載せるための前処理 */
function spawnIdHash(spawnId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < spawnId.length; i++) {
    h ^= spawnId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * 撃破 1 回ぶんの抽選。敵種はスポーン ID の接頭辞(`w:` Walker / `f:` 飛行敵)で決まる。
 * ボス(`b:`)は対象外(確定ドロップは段階 3 で別経路)として常に null。
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
  const base = BASE_RATE[kind];
  const profile = dropProfileFor(biomeId);
  const chargeP = Math.min(1, base.charge * profile.charge);
  const healP = Math.min(1 - chargeP, base.heal * profile.heal);
  const roll = hash2(seed + DROP_SALT, spawnIdHash(spawnId), killIndex);
  if (roll < chargeP) return 'charge';
  if (roll < chargeP + healP) return 'heal';
  return null;
}
