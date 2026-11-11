/**
 * 部位破壊(設計 2026-11-12-action-overhaul §2)。被弾位置(敵の矩形内の縦位置)で部位を分ける。
 * 部位の帯は矩形の端から PART_BAND(45%)。歩行敵は下端の帯(脚)、飛行ドローンと固定砲台は
 * 上端の帯(ローター・センサー)が部位で、残りは本体。部位が壊れた後の被弾は帯の内外を問わず本体へ入る。
 * 純粋関数のみ(Math.random は使わない)。
 */

/** 部位の帯の厚み(矩形の高さに対する割合)。タッチのアナログ照準でも狙える粒度にする */
export const PART_BAND = 0.45;

/** 被弾位置 hitY が矩形 [top, top + h] の上端の帯(上 45%)に入るか。矩形の外の値は端へ寄せて判定する */
export function inUpperBand(top: number, h: number, hitY: number): boolean {
  return clampY(top, h, hitY) < top + h * PART_BAND;
}

/** 被弾位置 hitY が矩形 [top, top + h] の下端の帯(下 45%)に入るか。矩形の外の値は端へ寄せて判定する */
export function inLowerBand(top: number, h: number, hitY: number): boolean {
  return clampY(top, h, hitY) > top + h * (1 - PART_BAND);
}

function clampY(top: number, h: number, y: number): number {
  return y < top ? top : y > top + h ? top + h : y;
}

/** 部位つきの被弾(hitAt)の結果 */
export interface PartHit {
  /** 本体の HP が尽きて倒れた */
  killed: boolean;
  /** 部位に入った(本体の HP は減っていない) */
  part: boolean;
  /** この被弾で部位が壊れた(壊れた瞬間の 1 回だけ true) */
  broke: boolean;
}

/** 部位が壊れたときの通知の文言(取得ログと同じ左端の行に出す) */
export const PART_BREAK_LABEL = {
  walker: '脚部破壊',
  flyer: 'ローター破壊',
  turret: 'センサー破壊',
} as const;
