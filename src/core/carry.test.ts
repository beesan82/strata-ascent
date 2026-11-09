import { describe, expect, it } from 'vitest';
import {
  addCarry,
  CARRY_KINDS,
  carriedTotal,
  INITIAL_CARRY_CAP,
  initialCarry,
  isCarryFull,
  isCarryKind,
  removeCarry,
  secureCaptionText,
  secureCarry,
  securedTotal,
  withdrawCarry,
  type CarryState,
} from './carry';

/** n 個の素材を携行した状態 */
function carrying(n: number): CarryState {
  let s = initialCarry();
  for (let i = 0; i < n; i++) s = addCarry(s, 'material');
  return s;
}

describe('initialCarry(初期状態)', () => {
  it('携行 0、枠 5、確保済み 0 で始まる(設計 §携行枠)', () => {
    const s = initialCarry();
    expect(INITIAL_CARRY_CAP).toBe(5);
    expect(s.cap).toBe(5);
    expect(carriedTotal(s)).toBe(0);
    expect(securedTotal(s)).toBe(0);
    expect(isCarryFull(s)).toBe(false);
  });

  it('段階 A の携行種別は素材 1 種だけで、種別ごとの個数で持つ', () => {
    expect(CARRY_KINDS).toEqual(['material']);
    const s = initialCarry();
    expect(s.carried).toEqual({ material: 0 });
    expect(s.secured).toEqual({ material: 0 });
  });
});

describe('isCarryKind(携行できる種別)', () => {
  it('素材は携行でき、消耗品は携行の対象でない', () => {
    expect(isCarryKind('material')).toBe(true);
    expect(isCarryKind('charge')).toBe(false);
    expect(isCarryKind('heal')).toBe(false);
    expect(isCarryKind('ration')).toBe(false);
  });
});

describe('addCarry(取得)', () => {
  it('1 個ずつ増え、元の state は変えない(純粋な遷移)', () => {
    const s0 = initialCarry();
    const s1 = addCarry(s0, 'material');
    expect(carriedTotal(s1)).toBe(1);
    expect(s1.carried.material).toBe(1);
    expect(carriedTotal(s0)).toBe(0);
    expect(s1.secured).toEqual(s0.secured);
  });

  it('枠 5 で満杯になり、それ以上は増えず同じ state を返す', () => {
    const full = carrying(5);
    expect(carriedTotal(full)).toBe(5);
    expect(isCarryFull(full)).toBe(true);
    const over = addCarry(full, 'material');
    expect(over).toBe(full);
    expect(carriedTotal(over)).toBe(5);
  });

  it('4 個までは満杯でない', () => {
    expect(isCarryFull(carrying(4))).toBe(false);
  });
});

describe('secureCarry(確保)', () => {
  it('携行中の全てが確保済みへ移り、携行は 0 に戻る', () => {
    const r = secureCarry(carrying(3));
    expect(r.moved).toBe(3);
    expect(carriedTotal(r.state)).toBe(0);
    expect(securedTotal(r.state)).toBe(3);
    expect(r.state.secured.material).toBe(3);
    expect(r.state.cap).toBe(5);
  });

  it('確保済みは累積し、2 回目以降も足し込まれる', () => {
    const first = secureCarry(carrying(5)).state;
    let s = first;
    for (let i = 0; i < 2; i++) s = addCarry(s, 'material');
    const second = secureCarry(s);
    expect(second.moved).toBe(2);
    expect(securedTotal(second.state)).toBe(7);
    expect(carriedTotal(second.state)).toBe(0);
  });

  it('携行が 0 なら moved は 0 で state は同じ参照(合図を出さない判定に使う)', () => {
    const s = initialCarry();
    const r = secureCarry(s);
    expect(r.moved).toBe(0);
    expect(r.state).toBe(s);
  });

  it('確保後にまた拾える(枠が空く)', () => {
    const s = secureCarry(carrying(5)).state;
    expect(isCarryFull(s)).toBe(false);
    expect(carriedTotal(addCarry(s, 'material'))).toBe(1);
  });
});

describe('secureCaptionText(確保の字幕)', () => {
  it('移した個数を含む', () => {
    expect(secureCaptionText(3)).toBe('素材 3 個を確保');
  });
});

describe('removeCarry(ボックスで落とす)', () => {
  it('携行から 1 個減り、元の state は変えない', () => {
    const s0 = carrying(3);
    const s1 = removeCarry(s0, 'material');
    expect(carriedTotal(s1)).toBe(2);
    expect(carriedTotal(s0)).toBe(3);
    expect(securedTotal(s1)).toBe(0);
  });

  it('持っていなければ同じ state を返す', () => {
    const s = initialCarry();
    expect(removeCarry(s, 'material')).toBe(s);
  });
});

describe('withdrawCarry(保管から引き出す)', () => {
  it('確保済みが 1 減り携行が 1 増える(未確保に戻る)', () => {
    const s0 = secureCarry(carrying(3)).state;
    const s1 = withdrawCarry(s0, 'material');
    expect(securedTotal(s1)).toBe(2);
    expect(carriedTotal(s1)).toBe(1);
    expect(securedTotal(s0)).toBe(3);
  });

  it('携行枠が満杯なら引き出せず同じ state を返す', () => {
    let s = secureCarry(carrying(2)).state;
    for (let i = 0; i < 5; i++) s = addCarry(s, 'material');
    expect(isCarryFull(s)).toBe(true);
    expect(withdrawCarry(s, 'material')).toBe(s);
  });

  it('保管が空なら引き出せず同じ state を返す', () => {
    const s = initialCarry();
    expect(withdrawCarry(s, 'material')).toBe(s);
  });
});
