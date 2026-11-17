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
  return clampToSpan(top, h, y);
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
  boss: '脚部破壊',
} as const;

/** 部位破壊の対象になる敵の種別 */
export type PartKind = keyof typeof PART_BREAK_LABEL;

/**
 * 露出倍率(2.22、設計 2026-11-17-parts-overhaul §1)。歩行敵は脚が壊れた後、飛行ドローンは
 * ローターが壊れて接地した後、本体への被ダメージをこの倍率にする(フレーム露出)。
 */
export const PART_EXPOSED_DAMAGE_MUL = 2;

/**
 * 部位破壊の確定ドロップ(2.22 §3)。部位が壊れた状態で倒した通常敵は、通常の抽選に加えて
 * 素材をこの個数だけ確定で落とす。純粋関数: 壊れていなければ空。
 */
export const PART_BREAK_BONUS_MATERIAL = 1;

export function partBreakBonus(partBroken: boolean): 'material'[] {
  if (!partBroken) return [];
  return Array.from({ length: PART_BREAK_BONUS_MATERIAL }, () => 'material' as const);
}

/** 部位が矩形のどちらの端の帯にあるか(歩行敵とボスの脚は下端、ローターとセンサーは上端) */
export const PART_SIDE: Record<PartKind, 'upper' | 'lower'> = {
  walker: 'lower',
  flyer: 'upper',
  turret: 'upper',
  boss: 'lower',
};

/**
 * 部位に入った被弾の命中音の音程倍率(2.22。強化仕様メモ V2 を採用)。下端の部位(脚)は低く、
 * 上端の部位(ローター・センサー)は高くして、本体ヒット(1.0)と耳で聞き分ける
 */
export const PART_HIT_PITCH: Record<'upper' | 'lower', number> = { upper: 1.25, lower: 0.8 };

/** 命中音の音程倍率(純粋関数)。部位に入った被弾は部位の側で決まり、本体は 1 */
export function hitPitchFor(kind: PartKind, part: boolean): number {
  return part ? PART_HIT_PITCH[PART_SIDE[kind]] : 1;
}

/** 部位の帯の中心の高さ(矩形 [top, top + h])。破壊時の破片バーストの発生点に使う(2.22 §2) */
export function partCenterY(top: number, h: number, side: 'upper' | 'lower'): number {
  return side === 'upper' ? top + (h * PART_BAND) / 2 : top + h * (1 - PART_BAND / 2);
}

/** 被弾位置を矩形 [lo, lo + size] の内側へ寄せる(火花を敵の体の上に出すため。縦横どちらにも使う) */
export function clampToSpan(lo: number, size: number, v: number): number {
  return v < lo ? lo : v > lo + size ? lo + size : v;
}
