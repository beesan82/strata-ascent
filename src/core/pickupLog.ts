import type { DropKind } from '../world/drop';

/**
 * 取得ログ(画面端に出す「何を取ったか」の短い記録)。DOM には触れず、時刻を引数で受ける
 * 純粋な状態遷移だけを持つ(main が simTime を渡し、表示文字列の差分を見て DOM を同期する)。
 */

/** 1 件の表示が残る秒数 */
export const PICKUP_LOG_TTL = 3.5;
/** 同時に出す最大件数(新しい順) */
export const PICKUP_LOG_MAX = 4;

/** ドロップ種別 → ログの表示名 */
export function pickupLabel(kind: DropKind): string {
  switch (kind) {
    case 'charge':
      return '砲弾';
    case 'pulsecell':
      return 'パルス弾セル';
    case 'material':
      return '素材';
    case 'valuable':
      return '貴重品';
    case 'heal':
      return '回復';
    case 'ration':
      return '糧食';
  }
}

interface PickupEntry {
  kind: DropKind;
  t: number;
}

export class PickupLog {
  private entries: PickupEntry[] = [];

  /** 取得を 1 件記録する */
  push(kind: DropKind, now: number): void {
    this.entries.push({ kind, t: now });
    if (this.entries.length > PICKUP_LOG_MAX * 2) {
      this.entries = this.entries.slice(-PICKUP_LOG_MAX * 2);
    }
  }

  /** 現在表示すべき行(新しい順、期限切れは落とす)。副作用として古い記録を間引く */
  lines(now: number): string[] {
    this.entries = this.entries.filter((e) => now - e.t < PICKUP_LOG_TTL);
    return this.entries
      .slice(-PICKUP_LOG_MAX)
      .reverse()
      .map((e) => `${pickupLabel(e.kind)} +1`);
  }
}
