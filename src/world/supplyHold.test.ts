import { describe, expect, it } from 'vitest';
import { holdSpot, SPOT_HOLD_RADIUS, type SupplyCache } from './supply';

const A: SupplyCache = { id: 'a:10,20', x: 12.5, floorY: 20 };
const B: SupplyCache = { id: 'a:40,20', x: 42.5, floorY: 20 };
const C: SupplyCache = { id: 'a:5,30', x: 7.5, floorY: 30 };

describe('holdSpot(武器庫・キャッシュの粘着選定)', () => {
  it('保持半径の目安は 48 タイル', () => {
    expect(SPOT_HOLD_RADIUS).toBe(48);
  });

  it('前回の選択が無ければ候補から最寄りを選ぶ', () => {
    expect(holdSpot(null, [A, B], 40, 20)).toBe(B);
    expect(holdSpot(null, [A, B], 10, 20)).toBe(A);
  });

  it('前回の選択が半径内なら、候補により近いものがあっても維持する', () => {
    expect(holdSpot(A, [B], 42, 20)).toBe(A);
  });

  it('前回の選択が今回の候補に入っていなくても、レコードごと維持する', () => {
    const got = holdSpot(A, [], 30, 25);
    expect(got).toBe(A);
    expect(got).toEqual({ id: 'a:10,20', x: 12.5, floorY: 20 });
  });

  it('前回の選択が半径の外なら手放し、候補から最寄りを選ぶ', () => {
    const far = A.x + SPOT_HOLD_RADIUS + 1;
    expect(holdSpot(A, [B, C], far, 20)).toBe(B);
  });

  it('前回の選択が半径の外で候補も無ければ null', () => {
    expect(holdSpot(A, [], A.x + SPOT_HOLD_RADIUS + 0.5, 20)).toBeNull();
  });

  it('半径ちょうどは維持する(境界は含む)', () => {
    expect(holdSpot(A, [B], A.x, A.floorY + SPOT_HOLD_RADIUS)).toBe(A);
  });

  it('距離はユークリッド(斜めの距離で半径を判定する)', () => {
    // 横 40・縦 30 → 距離 50 > 48 なので手放す
    expect(holdSpot(A, [B], A.x + 40, A.floorY + 30)).toBe(B);
    // 横 30・縦 30 → 距離 約 42.4 なので維持
    expect(holdSpot(A, [B], A.x + 30, A.floorY + 30)).toBe(A);
  });

  it('開封済みの前回選択は手放す(開封で選び直す)', () => {
    const claimed = new Set([A.id]);
    expect(holdSpot(A, [A, B], 12, 20, claimed)).toBe(B);
  });

  it('開封済みの候補は選ばない', () => {
    const claimed = new Set([A.id]);
    expect(holdSpot(null, [A], 12, 20, claimed)).toBeNull();
  });

  it('保持半径を引数で変えられる', () => {
    expect(holdSpot(A, [B], A.x + 10, 20, undefined, 5)).toBe(B);
    expect(holdSpot(A, [B], A.x + 4, 20, undefined, 5)).toBe(A);
  });

  it('距離が同じ候補は並び順で先のもの', () => {
    const L: SupplyCache = { id: 'a:0,0', x: -5, floorY: 0 };
    const R: SupplyCache = { id: 'a:9,0', x: 5, floorY: 0 };
    expect(holdSpot(null, [L, R], 0, 0)).toBe(L);
    expect(holdSpot(null, [R, L], 0, 0)).toBe(R);
  });

  it('プレイヤーが境界を行き来しても、半径内にいる限り選択は変わらない', () => {
    // 窓の境界をまたいで候補が A → B → 空 → A と入れ替わる状況を再現する
    let sel: SupplyCache | null = null;
    const steps: { px: number; cands: SupplyCache[] }[] = [
      { px: 10, cands: [A] },
      { px: 30, cands: [B] },
      { px: 50, cands: [] },
      { px: 20, cands: [A] },
      { px: 45, cands: [B] },
    ];
    for (const s of steps) {
      sel = holdSpot(sel, s.cands, s.px, 20);
      expect(sel).toBe(A);
    }
  });
});
