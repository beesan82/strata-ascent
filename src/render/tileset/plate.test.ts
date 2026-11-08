import { describe, expect, it } from 'vitest';
import { plateAt } from './plate';

describe('plateAt', () => {
  it('決定論: 同じ入力は同じ結果', () => {
    for (const [x, y] of [[0, 0], [5, -3], [-100, 240], [12345, -9876]] as const) {
      expect(plateAt(7, x, y)).toEqual(plateAt(7, x, y));
    }
  });

  it('プレート寸法は 2〜4 タイルで、内位置は寸法の範囲内', () => {
    for (let y = -60; y < 60; y++) {
      for (let x = -60; x < 60; x++) {
        const p = plateAt(1, x, y);
        expect(p.w).toBeGreaterThanOrEqual(2);
        expect(p.w).toBeLessThanOrEqual(4);
        expect(p.h).toBeGreaterThanOrEqual(2);
        expect(p.h).toBeLessThanOrEqual(4);
        expect(p.lx).toBeGreaterThanOrEqual(0);
        expect(p.lx).toBeLessThan(p.w);
        expect(p.ly).toBeGreaterThanOrEqual(0);
        expect(p.ly).toBeLessThan(p.h);
      }
    }
  });

  it('同じプレート内のタイルは原点・寸法・明度段を共有する', () => {
    for (let y = -40; y < 40; y += 3) {
      for (let x = -40; x < 40; x += 3) {
        const p = plateAt(3, x, y);
        for (let dy = 0; dy < p.h; dy++) {
          for (let dx = 0; dx < p.w; dx++) {
            const q = plateAt(3, p.ox + dx, p.oy + dy);
            expect(q.ox).toBe(p.ox);
            expect(q.oy).toBe(p.oy);
            expect(q.w).toBe(p.w);
            expect(q.h).toBe(p.h);
            expect(q.tone).toBe(p.tone);
            expect(q.lx).toBe(dx);
            expect(q.ly).toBe(dy);
          }
        }
      }
    }
  });

  it('継ぎ目はプレート境界でのみ立つ(上端=ly0、左端=lx0)', () => {
    for (let y = -30; y < 30; y++) {
      for (let x = -30; x < 30; x++) {
        const p = plateAt(5, x, y);
        expect(p.seamTop).toBe(p.ly === 0);
        expect(p.seamLeft).toBe(p.lx === 0);
        // 境界を跨ぐと原点が切り替わる
        if (p.lx === 0 && x > -30) expect(plateAt(5, x - 1, y).ox).not.toBe(p.ox);
        if (p.ly === 0 && y > -30) expect(plateAt(5, x, y - 1).oy).not.toBe(p.oy);
      }
    }
  });

  it('明度段は 0/1/2 の 3 段すべてが現れ、全面が一様にならない', () => {
    const tones = new Set<number>();
    let tiles = 0;
    for (let y = -100; y < 100; y++) {
      for (let x = -100; x < 100; x++) {
        tones.add(plateAt(11, x, y).tone);
        tiles++;
      }
    }
    expect(tiles).toBe(40000);
    expect(tones).toEqual(new Set([0, 1, 2]));
  });

  it('seed が変われば割り付けが変わる', () => {
    let diff = 0;
    for (let y = -30; y < 30; y++) {
      for (let x = -30; x < 30; x++) {
        const a = plateAt(1, x, y);
        const b = plateAt(2, x, y);
        if (a.ox !== b.ox || a.oy !== b.oy || a.tone !== b.tone) diff++;
      }
    }
    expect(diff).toBeGreaterThan(100);
  });
});
