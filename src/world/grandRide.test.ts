import { describe, expect, it } from 'vitest';
import { GRAND_RIDE_NOTICE_MIN, GrandRideTracker, grandRideNotice } from './grandRide';

/** 足場を from から to へ step ずつ動かしながら乗り続ける(返った通知文を全部集める) */
function ride(t: GrandRideTracker, shaftId: string, from: number, to: number, step = 0.5): string[] {
  const out: string[] = [];
  const dir = Math.sign(to - from);
  const n = Math.round(Math.abs(to - from) / step);
  for (let i = 0; i <= n; i++) {
    const msg = t.update({ shaftId, top: from + dir * i * step });
    if (msg !== null) out.push(msg);
  }
  return out;
}

describe('大昇降機の乗車ログ(GrandRideTracker)', () => {
  it('100 タイル以上乗ると、降りた瞬間に一度だけ「昇降 n タイル」を返す', () => {
    const t = new GrandRideTracker();
    // 乗っている間は何も返さない
    expect(ride(t, 'g:0,1', 1000, 1120)).toEqual([]);
    expect(t.update(null)).toBe('昇降 120 タイル');
    // 同じ区間で二度は返さない
    expect(t.update(null)).toBeNull();
    expect(t.update(null)).toBeNull();
  });

  it('100 タイル未満では返さない(ちょうど 100 は返す)', () => {
    const t = new GrandRideTracker();
    expect(ride(t, 'g:0,1', 1000, 1099.5)).toEqual([]);
    expect(t.update(null)).toBeNull();
    expect(ride(t, 'g:0,1', 1000, 1000 + GRAND_RIDE_NOTICE_MIN, 1)).toEqual([]);
    expect(t.update(null)).toBe('昇降 100 タイル');
  });

  it('シャフトが変わると区間が切れる(前の区間の分だけを、変わった瞬間に返す)', () => {
    const t = new GrandRideTracker();
    expect(ride(t, 'g:0,1', 500, 650)).toEqual([]);
    // 別のシャフトへ移った瞬間に前の区間を閉じる。足場の Y の差(650 → 3000)は移動量に数えない
    expect(t.update({ shaftId: 'g:1,4', top: 3000 })).toBe('昇降 150 タイル');
    expect(ride(t, 'g:1,4', 3000, 3060)).toEqual([]);
    // 新しい区間は 60 タイルだけなので返さない(前の区間の 150 を持ち越さない)
    expect(t.update(null)).toBeNull();
  });

  it('降りた後に乗り直すと別の区間になる(60 + 60 は合算しない)', () => {
    const t = new GrandRideTracker();
    expect(ride(t, 'g:0,1', 1000, 1060)).toEqual([]);
    expect(t.update(null)).toBeNull();
    // 降りている間に足場が動いていても(呼び戻し)、乗り直した位置から数え直す
    expect(ride(t, 'g:0,1', 1400, 1460)).toEqual([]);
    expect(t.update(null)).toBeNull();
  });

  it('移動量は絶対値の合計(下り 60 + 上り 60 = 120。往復して元の位置でも距離は残る)', () => {
    const t = new GrandRideTracker();
    expect(ride(t, 'g:0,1', 1000, 1060)).toEqual([]);
    expect(ride(t, 'g:0,1', 1060, 1000)).toEqual([]);
    expect(t.update(null)).toBe('昇降 120 タイル');
  });

  it('乗っていないフレームが続いても何も返さない。止まった足場に立っているだけでも返さない', () => {
    const t = new GrandRideTracker();
    for (let i = 0; i < 10; i++) expect(t.update(null)).toBeNull();
    for (let i = 0; i < 10; i++) expect(t.update({ shaftId: 'g:0,1', top: 800 })).toBeNull();
    expect(t.update(null)).toBeNull();
  });

  it('通知文の n は合計の四捨五入', () => {
    expect(grandRideNotice(99.9)).toBeNull();
    expect(grandRideNotice(100)).toBe('昇降 100 タイル');
    expect(grandRideNotice(149.4)).toBe('昇降 149 タイル');
    expect(grandRideNotice(149.5)).toBe('昇降 150 タイル');
    const t = new GrandRideTracker();
    ride(t, 'g:0,1', 0, 130.25, 0.25);
    expect(t.update(null)).toBe('昇降 130 タイル');
  });
});
