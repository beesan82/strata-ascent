import { describe, expect, it } from 'vitest';
import {
  chooseResumePoint,
  clearSave,
  loadSave,
  parseSave,
  SAVE_VERSION,
  saveKey,
  serializeSave,
  writeSave,
  type SaveData,
  type SaveStorage,
} from './save';
import { bestLayerKey, saveBestLayer } from './records';
import { initialAmmoCarry } from './ammo';
import { initialSatiety } from './satiety';

/** Map ベースのインメモリ storage */
function memoryStorage(initial: Record<string, string> = {}): SaveStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

/** すべての操作が例外を投げる storage */
const throwingStorage: SaveStorage = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
  removeItem: () => { throw new Error('denied'); },
};

/** 一通りの項目が初期値でない保存データ */
function sampleData(): SaveData {
  return {
    anchor: { x: 123.4375, y: -56.25 },
    respawn: { x: 100.625, y: -40.25 },
    carry: {
      carried: { material: 1, valuable: 1, shell: 1, pulsecell: 2 },
      cap: 5,
      secured: { material: 4, valuable: 2, shell: 0, pulsecell: 1 },
    },
    pulseLoaded: 13,
    satiety: { value: 42.5, rations: 2, starveT: 0 },
    claimedSupplyCaches: ['s:10,20', 's:-4,7'],
    claimedArmories: ['a:3,9'],
    claimedRestStocks: ['r:0,1'],
    defeated: ['w:1,2', 'f:3,4', 't:5,6', 'b:-2'],
    killCount: 7,
    remains: [
      [{ kind: 'ration', x: 99.5, y: -30.25 }],
      [
        { kind: 'material', x: 120, y: -55 },
        { kind: 'charge', x: 120.75, y: -55 },
      ],
    ],
    readTerminals: ['m:7,8'],
  };
}

const SEED = 20260711;

describe('saveKey', () => {
  it('seed ごとにキーが分かれ、最深記録のキーとは別', () => {
    expect(saveKey(SEED)).toBe('strata-ascent:save:20260711');
    expect(saveKey(1)).not.toBe(saveKey(2));
    expect(saveKey(SEED)).not.toBe(bestLayerKey(SEED));
  });
});

describe('serializeSave / parseSave', () => {
  it('保存 → 復元で状態が一致する', () => {
    const data = sampleData();
    expect(parseSave(serializeSave(SEED, data), SEED)).toEqual(data);
  });

  it('開始時の状態(遺留品なし・集合が空)も往復で一致する', () => {
    const data: SaveData = {
      anchor: { x: 0, y: 0 },
      respawn: { x: 0, y: 0 },
      carry: initialAmmoCarry(),
      pulseLoaded: 0,
      satiety: initialSatiety(),
      claimedSupplyCaches: [],
      claimedArmories: [],
      claimedRestStocks: [],
      defeated: [],
      killCount: 0,
      remains: [],
      readTerminals: [],
    };
    expect(parseSave(serializeSave(SEED, data), SEED)).toEqual(data);
  });

  it('同じ状態からは同じ文字列になる(携行の個数のキー順に依らない)', () => {
    const a = sampleData();
    const b = sampleData();
    b.carry = {
      ...b.carry,
      carried: { pulsecell: 2, shell: 1, valuable: 1, material: 1 },
    };
    expect(serializeSave(SEED, a)).toBe(serializeSave(SEED, b));
  });

  it('復元結果は元のデータと配列を共有しない', () => {
    const data = sampleData();
    const restored = parseSave(serializeSave(SEED, data), SEED)!;
    restored.defeated.push('x');
    expect(data.defeated).not.toContain('x');
  });

  it('最深記録は保存に含めない(統合先は best-layer キー)', () => {
    const obj = JSON.parse(serializeSave(SEED, sampleData())) as Record<string, unknown>;
    expect(Object.keys(obj)).not.toContain('bestLayer');
    expect(obj.v).toBe(SAVE_VERSION);
    expect(obj.seed).toBe(SEED);
  });

  it('保存なし(null)は null', () => {
    expect(parseSave(null, SEED)).toBeNull();
  });

  it('JSON として壊れた文字列は黙って null', () => {
    expect(parseSave('{"v":1,', SEED)).toBeNull();
    expect(parseSave('', SEED)).toBeNull();
    expect(parseSave('null', SEED)).toBeNull();
    expect(parseSave('[]', SEED)).toBeNull();
  });

  it('版数違いは null', () => {
    const obj = JSON.parse(serializeSave(SEED, sampleData())) as Record<string, unknown>;
    expect(parseSave(JSON.stringify({ ...obj, v: SAVE_VERSION + 1 }), SEED)).toBeNull();
    expect(parseSave(JSON.stringify({ ...obj, v: undefined }), SEED)).toBeNull();
  });

  it('seed 違いは null', () => {
    expect(parseSave(serializeSave(SEED, sampleData()), SEED + 1)).toBeNull();
  });

  /** 1 項目だけを書き換えた保存文字列 */
  function mutated(edit: (o: Record<string, any>) => void): string {
    const obj = JSON.parse(serializeSave(SEED, sampleData())) as Record<string, any>;
    edit(obj);
    return JSON.stringify(obj);
  }

  it.each<[string, (o: Record<string, any>) => void]>([
    ['位置が欠ける', (o) => { delete o.anchor; }],
    ['位置が数値でない', (o) => { o.respawn.x = 'a'; }],
    ['携行の種別が欠ける', (o) => { delete o.carry.carried.shell; }],
    ['携行の個数が負', (o) => { o.carry.secured.material = -1; }],
    ['携行の個数が小数', (o) => { o.carry.carried.material = 0.5; }],
    ['携行が枠を超える', (o) => { o.carry.cap = 2; }],
    ['枠が 0', (o) => { o.carry.cap = 0; }],
    ['装填残弾がセル 1 個ぶんを超える', (o) => { o.pulseLoaded = 21; }],
    ['満腹度が範囲外', (o) => { o.satiety.value = 101; }],
    ['糧食が上限超え', (o) => { o.satiety.rations = 3; }],
    ['飢餓秒が負', (o) => { o.satiety.starveT = -1; }],
    ['開封済みが配列でない', (o) => { o.claimedArmories = 'a:1,2'; }],
    ['撃破済みに文字列以外', (o) => { o.defeated.push(3); }],
    ['撃破数が負', (o) => { o.killCount = -1; }],
    ['遺留品の種別が不明', (o) => { o.remains[0][0].kind = 'gold'; }],
    ['遺留品の箇所が多すぎる', (o) => { o.remains.push([{ kind: 'heal', x: 0, y: 0 }]); }],
    ['既読端末が欠ける', (o) => { delete o.readTerminals; }],
  ])('%s → null', (_label, edit) => {
    expect(parseSave(mutated(edit), SEED)).toBeNull();
  });

  it('中身の無い遺留品の箇所は捨てる', () => {
    const raw = mutated((o) => { o.remains = [[], [{ kind: 'ration', x: 1, y: 2 }]]; });
    expect(parseSave(raw, SEED)!.remains).toEqual([[{ kind: 'ration', x: 1, y: 2 }]]);
  });
});

describe('loadSave / writeSave / clearSave', () => {
  it('書いて読むと一致する', () => {
    const storage = memoryStorage();
    expect(writeSave(storage, SEED, serializeSave(SEED, sampleData()))).toBe(true);
    expect(loadSave(storage, SEED)).toEqual(sampleData());
  });

  it('seed ごとに分かれる', () => {
    const storage = memoryStorage();
    writeSave(storage, 1, serializeSave(1, sampleData()));
    expect(loadSave(storage, 2)).toBeNull();
    expect(loadSave(storage, 1)).not.toBeNull();
  });

  it('壊れた保存は黙って消して null', () => {
    const storage = memoryStorage({ [saveKey(SEED)]: '{broken' });
    expect(loadSave(storage, SEED)).toBeNull();
    expect(storage.map.has(saveKey(SEED))).toBe(false);
  });

  it('版数違いの保存も消して null', () => {
    const obj = JSON.parse(serializeSave(SEED, sampleData())) as Record<string, unknown>;
    const storage = memoryStorage({ [saveKey(SEED)]: JSON.stringify({ ...obj, v: 0 }) });
    expect(loadSave(storage, SEED)).toBeNull();
    expect(storage.map.has(saveKey(SEED))).toBe(false);
  });

  it('storage が無い・例外でも止まらない', () => {
    expect(loadSave(null, SEED)).toBeNull();
    expect(loadSave(throwingStorage, SEED)).toBeNull();
    expect(writeSave(null, SEED, 'x')).toBe(false);
    expect(writeSave(throwingStorage, SEED, 'x')).toBe(false);
    expect(() => clearSave(throwingStorage, SEED)).not.toThrow();
    expect(() => clearSave(null, SEED)).not.toThrow();
  });

  it('clearSave は保存だけを消し、最深記録は残す', () => {
    const storage = memoryStorage();
    writeSave(storage, SEED, serializeSave(SEED, sampleData()));
    saveBestLayer(storage, SEED, 9);
    clearSave(storage, SEED);
    expect(storage.map.has(saveKey(SEED))).toBe(false);
    expect(storage.map.get(bestLayerKey(SEED))).toBe('9');
  });
});

describe('chooseResumePoint', () => {
  const a = { x: 1, y: 1 };
  const b = { x: 2, y: 2 };
  const c = { x: 3, y: 3 };

  it('先頭から順に、使える最初の候補を返す', () => {
    expect(chooseResumePoint([a, b, c], () => true)).toBe(a);
    expect(chooseResumePoint([a, b, c], (p) => p !== a)).toBe(b);
    expect(chooseResumePoint([a, b, c], (p) => p === c)).toBe(c);
  });

  it('どれも使えなければ null', () => {
    expect(chooseResumePoint([a, b], () => false)).toBeNull();
    expect(chooseResumePoint([], () => true)).toBeNull();
  });

  it('判定が例外を投げた候補は飛ばす', () => {
    const usable = (p: { x: number }) => {
      if (p === a) throw new Error('boom');
      return true;
    };
    expect(chooseResumePoint([a, b], usable)).toBe(b);
  });
});
