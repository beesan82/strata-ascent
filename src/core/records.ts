// 最深到達の記録(v2.0 Task 7)。到達した最深の階層を localStorage に永続化するための
// 純粋関数群。ゲームの数値・生成・物理には一切影響せず、表示(HUD・字幕)と保存だけを担う。
// 保存先は getItem/setItem を持つ抽象(storage)で受け、例外はすべて握りつぶす:
// localStorage が使えない環境(プライベートモード、容量超過、アクセス自体の例外)でも
// ゲームが止まらないことを優先する。

/** 保存に使う最小の storage 抽象(Web Storage の localStorage がそのまま入る) */
export interface LayerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 節目の間隔(階層)。この倍数の階層に初めて到達したときに字幕で知らせる */
export const RECORD_MILESTONE_INTERVAL = 5;

/** seed ごとの保存キー。seed が違えば記録は分かれる */
export function bestLayerKey(seed: number): string {
  return `strata-ascent:best-layer:${seed}`;
}

/** 保存値の正規化: 数値でない・負数・非有限は 0、小数は階層として切り捨てる */
function sanitizeLayer(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * 保存済みの最深記録を読む。storage が無い・例外・不正値のいずれでも 0 にフォールバックする
 * (0 は「記録なし」。HUD では 0 のとき最深記録を出さない)。
 */
export function loadBestLayer(storage: LayerStorage | null | undefined, seed: number): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(bestLayerKey(seed));
    if (raw === null) return 0;
    return sanitizeLayer(raw);
  } catch {
    return 0;
  }
}

/** 最深記録を保存する。storage が無い・例外でも何もせず戻る(呼び出し側は失敗を意識しない) */
export function saveBestLayer(storage: LayerStorage | null | undefined, seed: number, layer: number): void {
  if (!storage) return;
  try {
    storage.setItem(bestLayerKey(seed), String(sanitizeLayer(layer)));
  } catch {
    // 握りつぶす: 記録の保存失敗でゲームを止めない
  }
}

/**
 * 節目判定: prevMax < 階層 <= newMax の範囲に RECORD_MILESTONE_INTERVAL の倍数があれば、
 * そのうち最大のものを返す(複数跨いだ場合は一番深い節目)。無ければ null。
 * prevMax 自身が倍数でも、それは「すでに跨いだ」ので数えない(5→9 は null、9→10 は 10)。
 */
export function crossedMilestone(prevMax: number, newMax: number): number | null {
  if (!Number.isFinite(prevMax) || !Number.isFinite(newMax) || newMax <= prevMax) return null;
  const candidate = Math.floor(newMax / RECORD_MILESTONE_INTERVAL) * RECORD_MILESTONE_INTERVAL;
  if (candidate <= 0 || candidate <= prevMax) return null;
  return candidate;
}

/** 節目到達の字幕文言 */
export function milestoneCaptionText(milestone: number): string {
  return `第 ${milestone} 階層到達`;
}

/** 新記録(セッション開始時点の記録を初めて超えたとき)の字幕文言 */
export function newRecordCaptionText(layer: number): string {
  return `新記録 第 ${layer} 階層`;
}
