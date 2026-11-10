// 永続化 ― 続きから再開(段階 3-D、設計書 2026-11-11-persistence-design)。
// 1 つのランを seed ごとに localStorage へ残し、起動時に続きから再開するための純粋関数群。
// 直列化(serializeSave)と復元(parseSave)、保存先の読み書き、再開位置の選択だけを持ち、
// いつ保存するか・復元した値をどう世界へ戻すかは main が結ぶ。
// 最深記録は従来の保存(core/records の best-layer キー)を唯一の置き場として使い、ここへは入れない
// (重複させない。「さいしょから」でも最深記録は消えない)。
// 保存が壊れている・版数が違う・seed が違う場合は黙って破棄する(起動を止めない)。
// storage の例外はすべて握りつぶす(records と同じ流儀)。

import { CARRY_KINDS, type CarryState } from './carry';
import type { LayerStorage } from './records';
import { PULSE_SHOTS_PER_CELL } from './ammo';
import { MAX_RATIONS, SATIETY_MAX, type SatietyState } from './satiety';
import { MAX_REMAINS_SITES } from './remains';
import type { DropKind } from '../world/drop';

/** 保存形式の版数。形式を変えたら上げる(旧い版の保存は黙って破棄され、通常の開始になる) */
export const SAVE_VERSION = 1;

/** 保存に使う storage 抽象。最深記録の LayerStorage に削除を足したもの(localStorage がそのまま入る) */
export interface SaveStorage extends LayerStorage {
  removeItem(key: string): void;
}

/** seed ごとの保存キー(最深記録 strata-ascent:best-layer:<seed> と同じ接頭辞) */
export function saveKey(seed: number): string {
  return `strata-ascent:save:${seed}`;
}

/** 位置(ボディ左上、タイル座標) */
export interface SavePoint {
  x: number;
  y: number;
}

/** 遺留品の 1 個(中身の種別と中心位置) */
export interface RemainsItemSave {
  kind: DropKind;
  x: number;
  y: number;
}

/** 保存する状態(設計 §保存するもの)。敵・乗り物・通常ドロップ・シミュレーション時刻は持たない */
export interface SaveData {
  /** 最後の安定接地点(再開位置の第一候補) */
  anchor: SavePoint;
  /** 復活点(再開位置の第二候補で、再開後の死亡時の戻り先) */
  respawn: SavePoint;
  /** 携行・確保済み・枠 */
  carry: CarryState;
  /** パルスの装填中の残発数 */
  pulseLoaded: number;
  /** 満腹度と所持糧食(飢餓の経過秒も含む) */
  satiety: SatietyState;
  /** 開封済みの補給キャッシュ / 武器庫 / 初回補給済みの休憩点 */
  claimedSupplyCaches: string[];
  claimedArmories: string[];
  claimedRestStocks: string[];
  /** 撃破済みスポーン ID(記録の古い順) */
  defeated: string[];
  /** 通算の撃破数(ドロップ抽選の killIndex を続きから使う) */
  killCount: number;
  /** 遺留品の箇所(古い順、最大 MAX_REMAINS_SITES)。回収済みの物は含めない */
  remains: RemainsItemSave[][];
  /** 既読の端末 ID */
  readTerminals: string[];
}

/** 地面の種別の全集合(復元時の検証用。Record にして DropKind の追加漏れを型で拾う) */
const DROP_KIND_SET: Record<DropKind, true> = {
  charge: true,
  heal: true,
  ration: true,
  material: true,
  pulsecell: true,
  valuable: true,
};

function isDropKind(v: unknown): v is DropKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(DROP_KIND_SET, v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 0 以上の整数(個数) */
function isCount(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && Number.isInteger(v);
}

/**
 * 直列化。キーの並びを固定して組み立てる(main は前回の保存文字列との比較で変更を検知するため、
 * 同じ状態からは常に同じ文字列になること)。
 */
export function serializeSave(seed: number, data: SaveData): string {
  const counts = (r: Readonly<CarryState['carried']>) => {
    const out = {} as CarryState['carried'];
    for (const k of CARRY_KINDS) out[k] = r[k];
    return out;
  };
  return JSON.stringify({
    v: SAVE_VERSION,
    seed,
    anchor: { x: data.anchor.x, y: data.anchor.y },
    respawn: { x: data.respawn.x, y: data.respawn.y },
    carry: {
      carried: counts(data.carry.carried),
      cap: data.carry.cap,
      secured: counts(data.carry.secured),
    },
    pulseLoaded: data.pulseLoaded,
    satiety: { value: data.satiety.value, rations: data.satiety.rations, starveT: data.satiety.starveT },
    claimedSupplyCaches: [...data.claimedSupplyCaches],
    claimedArmories: [...data.claimedArmories],
    claimedRestStocks: [...data.claimedRestStocks],
    defeated: [...data.defeated],
    killCount: data.killCount,
    remains: data.remains.map((site) => site.map((it) => ({ kind: it.kind, x: it.x, y: it.y }))),
    readTerminals: [...data.readTerminals],
  });
}

function parsePoint(v: unknown): SavePoint | null {
  if (!isRecord(v) || !isFiniteNumber(v.x) || !isFiniteNumber(v.y)) return null;
  return { x: v.x, y: v.y };
}

function parseCounts(v: unknown): CarryState['carried'] | null {
  if (!isRecord(v)) return null;
  const out = {} as CarryState['carried'];
  for (const k of CARRY_KINDS) {
    const n = v[k];
    if (!isCount(n)) return null;
    out[k] = n;
  }
  return out;
}

function parseCarry(v: unknown): CarryState | null {
  if (!isRecord(v)) return null;
  const carried = parseCounts(v.carried);
  const secured = parseCounts(v.secured);
  if (!carried || !secured || !isCount(v.cap) || v.cap < 1) return null;
  let total = 0;
  for (const k of CARRY_KINDS) total += carried[k];
  if (total > v.cap) return null;
  return { carried, cap: v.cap, secured };
}

function parseSatiety(v: unknown): SatietyState | null {
  if (!isRecord(v)) return null;
  const { value, rations, starveT } = v;
  if (!isFiniteNumber(value) || value < 0 || value > SATIETY_MAX) return null;
  if (!isCount(rations) || rations > MAX_RATIONS) return null;
  if (!isFiniteNumber(starveT) || starveT < 0) return null;
  return { value, rations, starveT };
}

function parseStrings(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  for (const s of v) if (typeof s !== 'string') return null;
  return [...(v as string[])];
}

function parseRemains(v: unknown): RemainsItemSave[][] | null {
  if (!Array.isArray(v) || v.length > MAX_REMAINS_SITES) return null;
  const sites: RemainsItemSave[][] = [];
  for (const site of v) {
    if (!Array.isArray(site)) return null;
    const items: RemainsItemSave[] = [];
    for (const it of site) {
      if (!isRecord(it) || !isDropKind(it.kind) || !isFiniteNumber(it.x) || !isFiniteNumber(it.y)) return null;
      items.push({ kind: it.kind, x: it.x, y: it.y });
    }
    // 中身の無い箇所は持たない(回収済みの箇所と同じ扱い)
    if (items.length > 0) sites.push(items);
  }
  return sites;
}

/**
 * 復元。保存文字列を検証して SaveData に戻す。null(保存なし)・JSON として壊れている・
 * 版数や seed が違う・どれか 1 項目でも形や範囲が不正、のいずれでも null を返す
 * (部分的には使わない: 半端な復元で矛盾した状態から始めるより、通常の開始のほうが安全)。
 */
export function parseSave(raw: string | null, seed: number): SaveData | null {
  if (raw === null) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(obj) || obj.v !== SAVE_VERSION || obj.seed !== seed) return null;
  const anchor = parsePoint(obj.anchor);
  const respawn = parsePoint(obj.respawn);
  const carry = parseCarry(obj.carry);
  const satiety = parseSatiety(obj.satiety);
  const claimedSupplyCaches = parseStrings(obj.claimedSupplyCaches);
  const claimedArmories = parseStrings(obj.claimedArmories);
  const claimedRestStocks = parseStrings(obj.claimedRestStocks);
  const defeated = parseStrings(obj.defeated);
  const remains = parseRemains(obj.remains);
  const readTerminals = parseStrings(obj.readTerminals);
  const { pulseLoaded, killCount } = obj;
  if (
    !anchor || !respawn || !carry || !satiety ||
    !claimedSupplyCaches || !claimedArmories || !claimedRestStocks ||
    !defeated || !remains || !readTerminals ||
    !isCount(pulseLoaded) || pulseLoaded > PULSE_SHOTS_PER_CELL ||
    !isCount(killCount)
  ) {
    return null;
  }
  return {
    anchor,
    respawn,
    carry,
    pulseLoaded,
    satiety,
    claimedSupplyCaches,
    claimedArmories,
    claimedRestStocks,
    defeated,
    killCount,
    remains,
    readTerminals,
  };
}

/**
 * 保存を読む。storage が無い・例外・保存なしは null。保存はあるが使えない(壊れている・版数違い)
 * ときは黙って消してから null を返す(次の保存で上書きされるまで残しておく理由が無い)。
 */
export function loadSave(storage: SaveStorage | null | undefined, seed: number): SaveData | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(saveKey(seed));
    const data = parseSave(raw, seed);
    if (raw !== null && data === null) storage.removeItem(saveKey(seed));
    return data;
  } catch {
    return null;
  }
}

/** 直列化済みの文字列を保存する。成功したら true(容量超過・例外は false で、ゲームは止めない) */
export function writeSave(storage: SaveStorage | null | undefined, seed: number, text: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(saveKey(seed), text);
    return true;
  } catch {
    return false;
  }
}

/** 保存を消す(「さいしょから」)。最深記録のキーには触れない */
export function clearSave(storage: SaveStorage | null | undefined, seed: number): void {
  if (!storage) return;
  try {
    storage.removeItem(saveKey(seed));
  } catch {
    // 握りつぶす
  }
}

/**
 * 再開位置の選択: 候補を先頭から順に試し、使える最初の 1 つを返す(設計 §保存と再開:
 * 安定接地点 → 復活点 → 従来のスポーン)。判定が例外を投げた候補は使えないものとして飛ばす。
 * どれも使えなければ null(呼び出し側は従来のスポーンへ落とす)。
 */
export function chooseResumePoint<T>(candidates: readonly T[], usable: (p: T) => boolean): T | null {
  for (const p of candidates) {
    try {
      if (usable(p)) return p;
    } catch {
      // 使えない候補として扱う
    }
  }
  return null;
}
