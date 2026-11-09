/**
 * 携行と確保(エクストラクション段階 A、設計書 2026-11-09-extraction-stage-a-design。
 * 弾薬の相乗りは 2026-11-09-ammo-armory-design)。
 * 拾った物を休憩点まで持って帰る行為と、携行枠の出し入れだけを扱う純粋な状態遷移。
 * 所持の構造は「種別ごとの個数」で持ち、携行枠は種別を問わない総個数で数える。
 * 弾薬(砲弾・パルス弾セル)も同じ枠を素材と共有する(弾薬設計 §1)。
 * 消耗品の即時消費と糧食の所持は現行どおり枠外。
 * 確保済みはセッション内の数で、永続化しない(段階 D で改めて判断)。
 * 段階 A では死亡しても携行はそのまま残る(ロストは段階 B)。
 */

/** 携行できる種別。素材セル、砲弾(重粒子砲 1 発)、パルス弾セル(パルス 20 発) */
export type CarryKind = 'material' | 'shell' | 'pulsecell';

/**
 * 種別表。個数レコードの初期化と総数の数え方はここから導く。
 * ammo は弾薬か(休憩点の自動確保の対象外。弾薬は携行に残り、箱の操作で保管へ入れる)。
 */
export const CARRY_KIND_INFO: Record<CarryKind, { label: string; ammo: boolean }> = {
  material: { label: '素材', ammo: false },
  shell: { label: '砲弾', ammo: true },
  pulsecell: { label: 'パルス弾セル', ammo: true },
};

export const CARRY_KINDS: readonly CarryKind[] = ['material', 'shell', 'pulsecell'];

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
  const counts = {} as Record<CarryKind, number>;
  for (const k of CARRY_KINDS) counts[k] = 0;
  return counts;
}

export function initialCarry(): CarryState {
  return { carried: emptyCounts(), cap: INITIAL_CARRY_CAP, secured: emptyCounts() };
}

/** ドロップ種別などの文字列が携行できる種別か */
export function isCarryKind(kind: string): kind is CarryKind {
  return (CARRY_KINDS as readonly string[]).includes(kind);
}

/** その種別が弾薬か(自動確保の対象外) */
export function isAmmoKind(kind: CarryKind): boolean {
  return CARRY_KIND_INFO[kind].ammo;
}

/** 携行中の総個数(枠の判定と表示用) */
export function carriedTotal(state: CarryState): number {
  let n = 0;
  for (const k of CARRY_KINDS) n += state.carried[k];
  return n;
}

/** 確保済みの総個数(表示用) */
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
 * 確保: 休憩点の箱に入ったとき、携行中の戦利品(弾薬以外)を確保済みへ移す。
 * 弾薬は携行に残る(休憩点に入るたびに武器が空になるのを避ける。保管へ入れるのは
 * 箱の操作 storeCarry で明示的に行う)。どの休憩点でも成立する(前進・後退どちらでも)。
 * 移す物が無ければ state は変わらない。
 */
export function secureCarry(state: CarryState): SecureResult {
  let moved = 0;
  for (const k of CARRY_KINDS) if (!isAmmoKind(k)) moved += state.carried[k];
  if (moved === 0) return { state, moved: 0 };
  const carried = { ...state.carried };
  const secured = { ...state.secured };
  for (const k of CARRY_KINDS) {
    if (isAmmoKind(k)) continue;
    secured[k] += carried[k];
    carried[k] = 0;
  }
  return { state: { ...state, carried, secured }, moved };
}

/** 確保の字幕文言(最深記録の字幕と同じ流儀で、既存の字幕系に相乗りする) */
export function secureCaptionText(moved: number): string {
  return `素材 ${moved} 個を確保`;
}

/**
 * 携行から 1 個を取り出す(アイテムボックスで「落とす」とき、弾薬の消費も同じ遷移)。
 * その種別を持っていなければ何もせず同じ state を返す。
 */
export function removeCarry(state: CarryState, kind: CarryKind): CarryState {
  if (state.carried[kind] <= 0) return state;
  return { ...state, carried: { ...state.carried, [kind]: state.carried[kind] - 1 } };
}

/**
 * 携行から保管(確保済み)へ 1 個を入れる(休憩点でアイテムボックスの携行セルを操作したとき)。
 * 自動確保の対象外の弾薬を保管へ置く唯一の経路。持っていなければ同じ state を返す。
 * 呼べる場所(休憩点のみ)の判定は呼び出し側の責務。
 */
export function storeCarry(state: CarryState, kind: CarryKind): CarryState {
  if (state.carried[kind] <= 0) return state;
  return {
    ...state,
    carried: { ...state.carried, [kind]: state.carried[kind] - 1 },
    secured: { ...state.secured, [kind]: state.secured[kind] + 1 },
  };
}

/**
 * 保管(確保済み)から携行へ 1 個を戻す(アイテムボックスでの引き出し)。
 * 戻した分は未確保に戻る。携行枠が満杯か、保管にその種別が無ければ何もせず同じ state を返す。
 * 呼べる場所(休憩点のみ)の判定は呼び出し側の責務で、ここは在庫と枠だけを見る。
 */
export function withdrawCarry(state: CarryState, kind: CarryKind): CarryState {
  if (isCarryFull(state) || state.secured[kind] <= 0) return state;
  return {
    ...state,
    carried: { ...state.carried, [kind]: state.carried[kind] + 1 },
    secured: { ...state.secured, [kind]: state.secured[kind] - 1 },
  };
}
