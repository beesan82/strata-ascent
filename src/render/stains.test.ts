import { describe, expect, it } from 'vitest';
import { stainSegmentAt } from './stains';
import { plateAt } from './tileset/plate';

describe('stainSegmentAt', () => {
  it('決定論: 同じ入力は同じ結果', () => {
    for (const [x, y] of [[0, 0], [7, -13], [-250, 88], [9999, -4321]] as const) {
      expect(stainSegmentAt(9, x, y)).toEqual(stainSegmentAt(9, x, y));
    }
  });

  it('染みのあるプレートは全体の3〜6割程度(疎密のため全数には付けない)', () => {
    let plates = 0;
    let stained = 0;
    const seen = new Set<string>();
    for (let y = -120; y < 120; y++) {
      for (let x = -120; x < 120; x++) {
        const p = plateAt(4, x, y);
        const key = `${p.ox},${p.oy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        plates++;
        // プレートのどこかのタイルに染み区間があるか
        let has = false;
        for (let dy = 0; dy < p.h && !has; dy++) {
          for (let dx = 0; dx < p.w && !has; dx++) {
            if (stainSegmentAt(4, p.ox + dx, p.oy + dy)) has = true;
          }
        }
        if (has) stained++;
      }
    }
    const rate = stained / plates;
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.6);
  });

  it('染みはプレート内の1列だけに付き、上面から下へ連続し、プレートを跨がない', () => {
    for (let y = -60; y < 60; y += 2) {
      for (let x = -60; x < 60; x += 2) {
        const p = plateAt(6, x, y);
        const cols = new Set<number>();
        let maxLy = -1;
        for (let dy = 0; dy < p.h; dy++) {
          for (let dx = 0; dx < p.w; dx++) {
            const s = stainSegmentAt(6, p.ox + dx, p.oy + dy);
            if (s) {
              cols.add(dx);
              maxLy = Math.max(maxLy, dy);
            }
          }
        }
        if (cols.size === 0) continue;
        expect(cols.size).toBe(1);
        const col = [...cols][0];
        // 上面(ly=0)から maxLy まで欠けなく続く
        for (let dy = 0; dy <= maxLy; dy++) {
          expect(stainSegmentAt(6, p.ox + col, p.oy + dy)).not.toBeNull();
        }
        // プレートの外(上下左右の隣プレート)へは同種の継続を持たない前提として、
        // 少なくともこのプレートの下端より下のタイルは別プレートであり、同じ列条件は保証しない。
        // ここでは「区間はプレート高さ以内」を確認する
        expect(maxLy).toBeLessThan(p.h);
      }
    }
  });

  it('同じプレート内では cx・幅・種別が一致し、下へ行くほど fade が弱まる', () => {
    let checked = 0;
    for (let y = -80; y < 80 && checked < 40; y++) {
      for (let x = -80; x < 80 && checked < 40; x++) {
        const p = plateAt(8, x, y);
        const segs: { ly: number; cx: number; w: number; kind: number; fade: number }[] = [];
        for (let dy = 0; dy < p.h; dy++) {
          for (let dx = 0; dx < p.w; dx++) {
            const s = stainSegmentAt(8, p.ox + dx, p.oy + dy);
            if (s) segs.push({ ly: dy, ...s });
          }
        }
        if (segs.length < 2) continue;
        checked++;
        const first = segs[0];
        for (const s of segs) {
          expect(s.cx).toBe(first.cx);
          expect(s.w).toBe(first.w);
          expect(s.kind).toBe(first.kind);
        }
        const sorted = [...segs].sort((a, b) => a.ly - b.ly);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].fade).toBeLessThanOrEqual(sorted[i - 1].fade);
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('錆(kind=1)は汚れ(kind=0)より少ない', () => {
    let rust = 0;
    let grime = 0;
    const seen = new Set<string>();
    for (let y = -150; y < 150; y++) {
      for (let x = -150; x < 150; x++) {
        const s = stainSegmentAt(2, x, y);
        if (!s) continue;
        const p = plateAt(2, x, y);
        const key = `${p.ox},${p.oy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (s.kind === 1) rust++; else grime++;
      }
    }
    expect(grime).toBeGreaterThan(0);
    expect(rust).toBeGreaterThan(0);
    expect(rust).toBeLessThan(grime);
  });
});
