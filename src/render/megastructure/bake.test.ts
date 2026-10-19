import { describe, expect, it } from 'vitest';
import {
  bakeKey, bakeLayout, GLOW_REACH, LruCache, PIPE_LINE, RIM_LINE, specBounds, TRUSS_LINE, visibleBlit,
} from './bake';
import type { StructureSpec } from './spec';

describe('bakeKey', () => {
  it('同じ材料なら同じキー、spec・見かけ幅・環境色・かすみのどれが違っても別キー', () => {
    const base = { specKey: '0:3:power:0.25', sw: 329.9, ambientColor: '#101b26', hf: 0.6 };
    expect(bakeKey(base)).toBe(bakeKey({ ...base }));
    expect(bakeKey({ ...base, specKey: '0:4:power:0.25' })).not.toBe(bakeKey(base));
    expect(bakeKey({ ...base, sw: 330 })).not.toBe(bakeKey(base));
    expect(bakeKey({ ...base, ambientColor: '#101b27' })).not.toBe(bakeKey(base));
    expect(bakeKey({ ...base, hf: 0.3 })).not.toBe(bakeKey(base));
  });
});

describe('specBounds', () => {
  const sw = 200, sh = 250;

  it('矩形オペは正規化座標×寸法そのまま', () => {
    const spec: StructureSpec = { ops: [{ t: 'mass', x: 0.1, y: 0.2, w: 0.5, h: 0.8, tone: 'mid' }] };
    expect(specBounds(spec, sw, sh)).toEqual({ x0: 20, y0: 50, x1: 120, y1: 250 });
  });

  it('線は線幅ぶん、glow は半径 r*3 ぶん外へ広がる(端の描画がキャンバスで切れない)', () => {
    const truss: StructureSpec = { ops: [{ t: 'truss', x: 0, y: 0, w: 1, h: 1 }] };
    const tb = specBounds(truss, sw, sh);
    expect(tb.x0).toBeCloseTo(-TRUSS_LINE(sw) / 2);
    expect(tb.x1).toBeCloseTo(sw + TRUSS_LINE(sw) / 2);

    const pipe: StructureSpec = { ops: [{ t: 'pipe', pts: [[0.5, 0.5], [1, 0.5]], width: 0.03 }] };
    const pb = specBounds(pipe, sw, sh);
    expect(pb.x1).toBeCloseTo(sw + PIPE_LINE(sw, 0.03));

    const rim: StructureSpec = { ops: [{ t: 'rim', pts: [[0, 0], [1, 0]] }] };
    expect(specBounds(rim, sw, sh).y0).toBeCloseTo(-RIM_LINE(sw));

    const glow: StructureSpec = { ops: [{ t: 'glow', x: 0.1, y: 0.9, r: 0.05, kind: 'heat' }] };
    const gb = specBounds(glow, sw, sh);
    const reach = 0.05 * sw * GLOW_REACH;
    expect(gb.x0).toBeCloseTo(0.1 * sw - reach);
    expect(gb.y1).toBeCloseTo(0.9 * sh + reach);
  });

  it('空の spec は原点の 0 矩形', () => {
    expect(specBounds({ ops: [] }, sw, sh)).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
  });
});

describe('bakeLayout', () => {
  it('境界を整数へ丸めて全周 1 px の余白を足し、塔原点のキャンバス内位置を返す', () => {
    const l = bakeLayout({ x0: -2.3, y0: 0, x1: 100.2, y1: 250 });
    expect(l).toEqual({ width: 106, height: 252, originX: 4, originY: 1 });
    // 原点を置くと x0 が 1 px 余白の内側に収まる
    expect(l.originX + Math.floor(-2.3)).toBe(1);
  });
});

describe('visibleBlit', () => {
  it('画面上端より上に出た塔は見える帯だけを転写する', () => {
    const r = visibleBlit(10, -200, 100, 420, 427, 240);
    expect(r).toEqual({ sx: 0, sy: 200, w: 100, h: 220, dx: 10, dy: 0 });
  });

  it('左右にはみ出た分も切り落とす', () => {
    expect(visibleBlit(-30, 0, 100, 50, 427, 240)).toEqual({ sx: 30, sy: 0, w: 70, h: 50, dx: 0, dy: 0 });
    expect(visibleBlit(400, 0, 100, 50, 427, 240)).toEqual({ sx: 0, sy: 0, w: 27, h: 50, dx: 400, dy: 0 });
  });

  it('完全に画面外なら null', () => {
    expect(visibleBlit(500, 0, 100, 50, 427, 240)).toBeNull();
    expect(visibleBlit(0, -50, 100, 50, 427, 240)).toBeNull();
  });
});

describe('LruCache', () => {
  it('上限を超えると最も触られていない項目から捨てる', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.size).toBe(2);
  });

  it('get で触った項目は新しい扱いになり、可視の塔が歩行中に捨てられない', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1);
    c.set('c', 3);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
  });

  it('同じキーの再 set は上書きで本数が増えない', () => {
    const c = new LruCache<number>(3);
    c.set('a', 1);
    c.set('a', 2);
    expect(c.size).toBe(1);
    expect(c.get('a')).toBe(2);
  });
});
