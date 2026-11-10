import { describe, expect, it } from 'vitest';
import {
  addCarry,
  CARRY_KIND_INFO,
  CARRY_KINDS,
  carriedTotal,
  INITIAL_CARRY_CAP,
  initialCarry,
  isAmmoKind,
  isCarryFull,
  isCarryKind,
  loseCarry,
  removeCarry,
  secureCaptionText,
  secureCarry,
  securedTotal,
  securedValue,
  storeCarry,
  VALUABLE_VALUE,
  withdrawCarry,
  type CarryKind,
  type CarryState,
} from './carry';

/** n 個の素材を携行した状態 */
function carrying(n: number, kind: CarryKind = 'material'): CarryState {
  let s = initialCarry();
  for (let i = 0; i < n; i++) s = addCarry(s, kind);
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

  it('携行種別は素材・貴重品・砲弾・パルス弾セルの 4 種で、種別ごとの個数で持つ(弾薬設計 §1、段階 3-B §2)', () => {
    expect(CARRY_KINDS).toEqual(['material', 'valuable', 'shell', 'pulsecell']);
    const s = initialCarry();
    expect(s.carried).toEqual({ material: 0, valuable: 0, shell: 0, pulsecell: 0 });
    expect(s.secured).toEqual({ material: 0, valuable: 0, shell: 0, pulsecell: 0 });
  });

  it('種別表: 弾薬は shell と pulsecell で、素材・貴重品は弾薬でない。表示名が全種別にある', () => {
    expect(isAmmoKind('material')).toBe(false);
    expect(isAmmoKind('valuable')).toBe(false);
    expect(isAmmoKind('shell')).toBe(true);
    expect(isAmmoKind('pulsecell')).toBe(true);
    for (const k of CARRY_KINDS) expect(CARRY_KIND_INFO[k].label.length).toBeGreaterThan(0);
    expect(CARRY_KIND_INFO.valuable.label).toBe('貴重品');
  });
});

describe('isCarryKind(携行できる種別)', () => {
  it('素材・貴重品・砲弾・パルス弾セルは携行でき、消耗品や地面の砲弾セル(drop kind)は対象でない', () => {
    expect(isCarryKind('material')).toBe(true);
    expect(isCarryKind('valuable')).toBe(true);
    expect(isCarryKind('shell')).toBe(true);
    expect(isCarryKind('pulsecell')).toBe(true);
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

  it('枠は種別を問わず共有する(素材 3 + 砲弾 1 + セル 1 で満杯)', () => {
    let s = carrying(3);
    s = addCarry(s, 'shell');
    s = addCarry(s, 'pulsecell');
    expect(carriedTotal(s)).toBe(5);
    expect(isCarryFull(s)).toBe(true);
    expect(addCarry(s, 'shell')).toBe(s);
    expect(addCarry(s, 'material')).toBe(s);
  });
});

describe('secureCarry(確保)', () => {
  it('携行中の素材が全て確保済みへ移り、携行は 0 に戻る', () => {
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

  it('弾薬は自動確保の対象外で携行に残る(休憩点で武器が空にならない)', () => {
    let s = carrying(2);
    s = addCarry(s, 'shell');
    s = addCarry(s, 'pulsecell');
    const r = secureCarry(s);
    expect(r.moved).toBe(2);
    expect(r.state.carried).toEqual({ material: 0, valuable: 0, shell: 1, pulsecell: 1 });
    expect(r.state.secured).toEqual({ material: 2, valuable: 0, shell: 0, pulsecell: 0 });
  });

  it('貴重品は素材と一緒に自動確保され、valuables に個数が入る(段階 3-B §3)', () => {
    let s = carrying(2);
    s = addCarry(s, 'valuable');
    s = addCarry(s, 'shell');
    const r = secureCarry(s);
    expect(r.moved).toBe(3);
    expect(r.valuables).toBe(1);
    expect(r.state.carried).toEqual({ material: 0, valuable: 0, shell: 1, pulsecell: 0 });
    expect(r.state.secured).toEqual({ material: 2, valuable: 1, shell: 0, pulsecell: 0 });
  });

  it('貴重品が無ければ valuables は 0', () => {
    expect(secureCarry(carrying(3)).valuables).toBe(0);
    expect(secureCarry(initialCarry()).valuables).toBe(0);
  });

  it('弾薬だけを携行しているときは何も移らず state は同じ参照', () => {
    const s = carrying(2, 'pulsecell');
    const r = secureCarry(s);
    expect(r.moved).toBe(0);
    expect(r.state).toBe(s);
  });
});

describe('secureCaptionText(確保の字幕)', () => {
  it('移した個数を含む', () => {
    expect(secureCaptionText(3)).toBe('素材 3 個を確保');
  });

  it('貴重品が 0 なら従来の文言のまま', () => {
    expect(secureCaptionText(2, 0)).toBe('素材 2 個を確保');
  });

  it('貴重品を含むときは今回ぶんの確保額を添える(段階 3-B §3)', () => {
    expect(secureCaptionText(2, 1)).toBe('素材 2 個・貴重品 1 個を確保（確保額 +500）');
    expect(secureCaptionText(0, 2)).toBe('貴重品 2 個を確保（確保額 +1000）');
  });
});

describe('securedValue(確保額)', () => {
  it('確保済みの貴重品の個数 × 500 で、素材や弾薬は数えない', () => {
    expect(VALUABLE_VALUE).toBe(500);
    expect(securedValue(initialCarry())).toBe(0);
    let s = carrying(2);
    s = addCarry(s, 'valuable');
    s = addCarry(s, 'valuable');
    s = secureCarry(s).state;
    expect(securedValue(s)).toBe(1000);
  });

  it('携行中(未確保)の貴重品は確保額に入らない', () => {
    expect(securedValue(carrying(3, 'valuable'))).toBe(0);
  });

  it('導出値なので、引き出せば下がり、仕舞えば戻る(別カウンタで累積しない)', () => {
    const s0 = secureCarry(carrying(2, 'valuable')).state;
    expect(securedValue(s0)).toBe(1000);
    const s1 = withdrawCarry(s0, 'valuable');
    expect(securedValue(s1)).toBe(500);
    expect(securedValue(storeCarry(s1, 'valuable'))).toBe(1000);
  });
});

describe('loseCarry(死亡時のロスト、段階 3-B §1)', () => {
  it('携行は全種別 0 になり、確保済みと枠はそのまま', () => {
    let s = secureCarry(carrying(2)).state; // 素材 2 を確保済み
    s = addCarry(s, 'material');
    s = addCarry(s, 'valuable');
    s = addCarry(s, 'shell');
    s = addCarry(s, 'pulsecell');
    const lost = loseCarry(s);
    expect(lost.carried).toEqual({ material: 0, valuable: 0, shell: 0, pulsecell: 0 });
    expect(lost.secured).toEqual(s.secured);
    expect(lost.cap).toBe(s.cap);
    expect(carriedTotal(s)).toBe(4); // 元の state は変えない
  });

  it('携行が空なら同じ参照を返す', () => {
    const s = initialCarry();
    expect(loseCarry(s)).toBe(s);
  });
});

describe('removeCarry(ボックスで落とす・弾薬の消費)', () => {
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
    expect(removeCarry(s, 'shell')).toBe(s);
  });

  it('種別ごとに独立して減る', () => {
    let s = carrying(1, 'shell');
    s = addCarry(s, 'pulsecell');
    const after = removeCarry(s, 'shell');
    expect(after.carried).toEqual({ material: 0, valuable: 0, shell: 0, pulsecell: 1 });
  });
});

describe('storeCarry(休憩点で携行から保管へ入れる)', () => {
  it('携行が 1 減り確保済みが 1 増える(弾薬を保管へ置く経路)', () => {
    const s0 = carrying(2, 'shell');
    const s1 = storeCarry(s0, 'shell');
    expect(s1.carried.shell).toBe(1);
    expect(s1.secured.shell).toBe(1);
    expect(s0.carried.shell).toBe(2);
    expect(s0.secured.shell).toBe(0);
  });

  it('持っていなければ同じ state を返す', () => {
    const s = initialCarry();
    expect(storeCarry(s, 'pulsecell')).toBe(s);
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

  it('保管した弾薬も引き出せる(store → withdraw で元に戻る)', () => {
    const s0 = carrying(1, 'pulsecell');
    const stored = storeCarry(s0, 'pulsecell');
    const back = withdrawCarry(stored, 'pulsecell');
    expect(back.carried).toEqual(s0.carried);
    expect(back.secured).toEqual(s0.secured);
  });
});
