/**
 * 携行と確保(エクストラクション段階 A、設計書 2026-11-09-extraction-stage-a-design。
 * 弾薬の相乗りは 2026-11-09-ammo-armory-design)。
 * 拾った物を休憩点まで持って帰る行為と、携行枠の出し入れだけを扱う純粋な状態遷移。
 * 所持の構造は「種別ごとの個数」で持ち、携行枠は種別を問わない総個数で数える。
 * 弾薬(砲弾・パルス弾セル)も同じ枠を素材と共有する(弾薬設計 §1)。
 * 消耗品の即時消費と糧食の所持は現行どおり枠外。
 * 携行・確保済み・枠は永続化(段階 3-D、設計書 2026-11-11-persistence-design)で保存され、再開時に戻る。
 * 段階 3-B(設計書 2026-11-10-stage3b-design)で死亡時のロストが入った: 未確保の携行は
 * 全て遺留品として地面へ落ち、携行は 0 になる(確保済みは減らない)。落とし方は main の
 * dropRemainsOnDeath と core/remains の remainsDropKinds。
 * 同じ段階で貴重品(valuable)を足した。用途は持ち帰ることだけで、確保額の記録に使う。
 */

/**
 * 携行できる種別。素材セル、貴重品(持ち帰って確保額にするだけ)、
 * 砲弾(重粒子砲 1 発)、パルス弾セル(パルス 20 発)
 */
export type CarryKind = 'material' | 'valuable' | 'shell' | 'pulsecell';

/**
 * 種別表。個数レコードの初期化と総数の数え方はここから導く。
 * ammo は弾薬か(休憩点の自動確保の対象外。弾薬は携行に残り、箱の操作で保管へ入れる)。
 */
export const CARRY_KIND_INFO: Record<CarryKind, { label: string; ammo: boolean }> = {
  material: { label: '素材', ammo: false },
  valuable: { label: '貴重品', ammo: false },
  shell: { label: '砲弾', ammo: true },
  pulsecell: { label: 'パルス弾セル', ammo: true },
};

/** 種別の並び(アイテムボックスの表示順も兼ねる: 戦利品 → 弾薬) */
export const CARRY_KINDS: readonly CarryKind[] = ['material', 'valuable', 'shell', 'pulsecell'];

/** 貴重品 1 個あたりの確保額(段階 3-B §3)。通貨ではなく記録のための値 */
export const VALUABLE_VALUE = 500;

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

/**
 * 確保額 = 確保済みの貴重品の個数 × VALUABLE_VALUE(段階 3-B §3)。
 * 別カウンタで累積せず、毎回 secured から導く(引き出せば下がる)。
 */
export function securedValue(state: CarryState): number {
  return state.secured.valuable * VALUABLE_VALUE;
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
  /** moved のうち貴重品の個数(字幕に確保額を出すため。段階 3-B §3) */
  valuables: number;
}

/**
 * 確保: 休憩点の箱に入ったとき、携行中の戦利品(弾薬以外 = 素材と貴重品)を確保済みへ移す。
 * 弾薬は携行に残る(休憩点に入るたびに武器が空になるのを避ける。保管へ入れるのは
 * 箱の操作 storeCarry で明示的に行う)。どの休憩点でも成立する(前進・後退どちらでも)。
 * 移す物が無ければ state は変わらない。
 */
export function secureCarry(state: CarryState): SecureResult {
  let moved = 0;
  for (const k of CARRY_KINDS) if (!isAmmoKind(k)) moved += state.carried[k];
  if (moved === 0) return { state, moved: 0, valuables: 0 };
  const valuables = state.carried.valuable;
  const carried = { ...state.carried };
  const secured = { ...state.secured };
  for (const k of CARRY_KINDS) {
    if (isAmmoKind(k)) continue;
    secured[k] += carried[k];
    carried[k] = 0;
  }
  return { state: { ...state, carried, secured }, moved, valuables };
}

/**
 * 確保の字幕文言(最深記録の字幕と同じ流儀で、既存の字幕系に相乗りする)。
 * materials は素材の個数、valuables は貴重品の個数。貴重品が無ければ従来の文言のまま。
 * 貴重品を含むときは、今回ぶんの確保額(個数 × VALUABLE_VALUE)を添える。
 */
export function secureCaptionText(materials: number, valuables = 0): string {
  if (valuables <= 0) return `素材 ${materials} 個を確保`;
  const value = `確保額 +${valuables * VALUABLE_VALUE}`;
  if (materials <= 0) return `貴重品 ${valuables} 個を確保（${value}）`;
  return `素材 ${materials} 個・貴重品 ${valuables} 個を確保（${value}）`;
}

/**
 * ロスト(段階 3-B §1): 死亡時に携行を全て 0 にする。確保済みと枠はそのまま。
 * 落とした物は呼び出し側が遺留品として地面へ置く(core/remains の remainsDropKinds)。
 * 携行が空なら同じ state を返す。
 */
export function loseCarry(state: CarryState): CarryState {
  if (carriedTotal(state) === 0) return state;
  return { ...state, carried: emptyCounts() };
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
