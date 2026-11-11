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

/** 1 件の記録。取得(kind)か、部位破壊などの短い通知(text)のどちらか */
type PickupEntry = { kind: DropKind; t: number } | { text: string; t: number };

export class PickupLog {
  private entries: PickupEntry[] = [];

  /** 取得を 1 件記録する */
  push(kind: DropKind, now: number): void {
    this.add({ kind, t: now });
  }

  /**
   * 取得以外の短い通知(部位破壊など、設計 2026-11-12-action-overhaul §2)を同じ行に 1 件記録する。
   * 文言はそのまま表示し、TTL・最大件数は取得と共通
   */
  pushNotice(text: string, now: number): void {
    this.add({ text, t: now });
  }

  /** 現在表示すべき行(新しい順、期限切れは落とす)。副作用として古い記録を間引く */
  lines(now: number): string[] {
    this.entries = this.entries.filter((e) => now - e.t < PICKUP_LOG_TTL);
    return this.entries
      .slice(-PICKUP_LOG_MAX)
      .reverse()
      .map((e) => ('text' in e ? e.text : `${pickupLabel(e.kind)} +1`));
  }

  private add(e: PickupEntry): void {
    this.entries.push(e);
    if (this.entries.length > PICKUP_LOG_MAX * 2) {
      this.entries = this.entries.slice(-PICKUP_LOG_MAX * 2);
    }
  }
}
