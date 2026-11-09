/**
 * 携行と確保(エクストラクション段階 A、設計書 2026-11-09-extraction-stage-a-design)。
 * 拾った素材を休憩点まで持って帰る行為だけを扱う純粋な状態遷移。
 * 所持の構造は「種別ごとの個数」で持ち(段階 B 以降に貴重品・装備が加わる前提)、
 * 携行枠は種別を問わない総個数で数える。消耗品の即時消費と糧食の所持は現行どおり枠外。
 * 確保済みはセッション内の数で、永続化しない(段階 D で改めて判断)。
 * 段階 A では死亡しても携行はそのまま残る(ロストは段階 B)。
 */

/** 携行できる種別。段階 A は共通素材 1 種(素材セル)だけ */
export type CarryKind = 'material';

export const CARRY_KINDS: readonly CarryKind[] = ['material'];

/** 携行枠の初期値(総個数) */
export const INITIAL_CARRY_CAP = 5;

export interface CarryState {
  /** 携行中(種別ごとの個数) */
  carried: Record<CarryKind, number>;
  /** 携行枠(総個数の上限)。強化は段階 C */
  cap: number;
  /** 確保済み(種別ごとの個数、セッション内) */
  secured: Record<CarryKind, number>;
}

function emptyCounts(): Record<CarryKind, number> {
  return { material: 0 };
}

export function initialCarry(): CarryState {
  return { carried: emptyCounts(), cap: INITIAL_CARRY_CAP, secured: emptyCounts() };
}

/** ドロップ種別などの文字列が携行できる種別か */
export function isCarryKind(kind: string): kind is CarryKind {
  return (CARRY_KINDS as readonly string[]).includes(kind);
}

/** 携行中の総個数(枠の判定と HUD 用) */
export function carriedTotal(state: CarryState): number {
  let n = 0;
  for (const k of CARRY_KINDS) n += state.carried[k];
  return n;
}

/** 確保済みの総個数(HUD 用) */
export function securedTotal(state: CarryState): number {
  let n = 0;
  for (const k of CARRY_KINDS) n += state.secured[k];
  return n;
}

/** 携行枠が満杯か(満杯のときは拾えず地面に残る: canPickup と同じ扱い) */
export function isCarryFull(state: CarryState): boolean {
  return carriedTotal(state) >= state.cap;
}

/**
 * 1 個を携行へ加える。満杯なら何もせず同じ state を返す
 * (呼び出し側は canPickup / isCarryFull で先に判定する前提だが、二重に守る)。
 */
export function addCarry(state: CarryState, kind: CarryKind): CarryState {
  if (isCarryFull(state)) return state;
  return { ...state, carried: { ...state.carried, [kind]: state.carried[kind] + 1 } };
}

export interface SecureResult {
  state: CarryState;
  /** このとき確保済みへ移した総個数(0 なら合図を出さない) */
  moved: number;
}

/**
 * 確保: 休憩点の箱に入ったとき、携行中の全てを確保済みへ移して携行を 0 に戻す。
 * どの休憩点でも成立する(前進・後退どちらでも)。携行が 0 なら state は変わらない。
 */
export function secureCarry(state: CarryState): SecureResult {
  const moved = carriedTotal(state);
  if (moved === 0) return { state, moved: 0 };
  const secured = { ...state.secured };
  for (const k of CARRY_KINDS) secured[k] += state.carried[k];
  return { state: { ...state, carried: emptyCounts(), secured }, moved };
}

/** 確保の字幕文言(最深記録の字幕と同じ流儀で、既存の字幕系に相乗りする) */
export function secureCaptionText(moved: number): string {
  return `素材 ${moved} 個を確保`;
}
