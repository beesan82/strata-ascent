import { describe, expect, it } from 'vitest';
import {
  bestLayerKey,
  crossedMilestone,
  loadBestLayer,
  milestoneCaptionText,
  newRecordCaptionText,
  RECORD_MILESTONE_INTERVAL,
  saveBestLayer,
  type LayerStorage,
} from './records';

/** Map ベースのインメモリ storage */
function memoryStorage(initial: Record<string, string> = {}): LayerStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

/** get/set の両方が例外を投げる storage */
const throwingStorage: LayerStorage = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
};

describe('bestLayerKey', () => {
  it('seed を含むキーを返す', () => {
    expect(bestLayerKey(20260711)).toBe('strata-ascent:best-layer:20260711');
    expect(bestLayerKey(0)).toBe('strata-ascent:best-layer:0');
  });

  it('seed ごとにキーが分かれる', () => {
    expect(bestLayerKey(1)).not.toBe(bestLayerKey(2));
  });
});

describe('loadBestLayer / saveBestLayer', () => {
  it('保存・読込の往復で記録が戻る', () => {
    const storage = memoryStorage();
    saveBestLayer(storage, 42, 7);
    expect(storage.map.get(bestLayerKey(42))).toBe('7');
    expect(loadBestLayer(storage, 42)).toBe(7);
  });

  it('seed ごとに記録が分かれる', () => {
    const storage = memoryStorage();
    saveBestLayer(storage, 1, 3);
    saveBestLayer(storage, 2, 9);
    expect(loadBestLayer(storage, 1)).toBe(3);
    expect(loadBestLayer(storage, 2)).toBe(9);
  });

  it('未保存なら 0', () => {
    expect(loadBestLayer(memoryStorage(), 42)).toBe(0);
  });

  it('例外を投げる storage でも落ちず、読みは 0・書きは無言で失敗する', () => {
    expect(loadBestLayer(throwingStorage, 42)).toBe(0);
    expect(() => saveBestLayer(throwingStorage, 42, 5)).not.toThrow();
  });

  it('storage が null / undefined でも落ちない', () => {
    expect(loadBestLayer(null, 42)).toBe(0);
    expect(loadBestLayer(undefined, 42)).toBe(0);
    expect(() => saveBestLayer(null, 42, 5)).not.toThrow();
    expect(() => saveBestLayer(undefined, 42, 5)).not.toThrow();
  });

  it.each([
    ['数値でない', 'abc'],
    ['負数', '-3'],
    ['空文字', ''],
    ['NaN リテラル', 'NaN'],
    ['Infinity リテラル', 'Infinity'],
  ])('不正な保存値(%s)は 0 扱い', (_label, raw) => {
    const storage = memoryStorage({ [bestLayerKey(42)]: raw });
    expect(loadBestLayer(storage, 42)).toBe(0);
  });

  it('小数の保存値は切り捨てる', () => {
    const storage = memoryStorage({ [bestLayerKey(42)]: '3.9' });
    expect(loadBestLayer(storage, 42)).toBe(3);
  });

  it('保存側も正規化する(負数は 0 として保存)', () => {
    const storage = memoryStorage();
    saveBestLayer(storage, 42, -2);
    expect(storage.map.get(bestLayerKey(42))).toBe('0');
    expect(loadBestLayer(storage, 42)).toBe(0);
  });
});

describe('crossedMilestone', () => {
  it('間隔は 5 階層', () => {
    expect(RECORD_MILESTONE_INTERVAL).toBe(5);
  });

  it('4→5 で 5 を返す', () => {
    expect(crossedMilestone(4, 5)).toBe(5);
  });

  it('5→9 は null(5 はすでに跨いでいる)', () => {
    expect(crossedMilestone(5, 9)).toBeNull();
  });

  it('9→10 で 10 を返す', () => {
    expect(crossedMilestone(9, 10)).toBe(10);
  });

  it('複数跨ぎ(4→12)は最大の倍数 10 を返す', () => {
    expect(crossedMilestone(4, 12)).toBe(10);
    expect(crossedMilestone(3, 16)).toBe(15);
  });

  it('節目に届かなければ null', () => {
    expect(crossedMilestone(0, 4)).toBeNull();
    expect(crossedMilestone(1, 4)).toBeNull();
    expect(crossedMilestone(15, 19)).toBeNull();
  });

  it('増えていなければ null', () => {
    expect(crossedMilestone(5, 5)).toBeNull();
    expect(crossedMilestone(10, 5)).toBeNull();
  });

  it('ちょうど倍数への到達も返す(5→10、14→15)', () => {
    expect(crossedMilestone(5, 10)).toBe(10);
    expect(crossedMilestone(14, 15)).toBe(15);
  });
});

describe('字幕文言', () => {
  it('節目到達', () => {
    expect(milestoneCaptionText(5)).toBe('第 5 階層到達');
    expect(milestoneCaptionText(10)).toBe('第 10 階層到達');
  });

  it('新記録', () => {
    expect(newRecordCaptionText(6)).toBe('新記録 第 6 階層');
  });
});
