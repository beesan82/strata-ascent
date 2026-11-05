import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from '../world/biomeCells';
import { backdropDrawRects, backdropIdOf, createBackdropSet } from './backdrop';
import { BACKDROP_JPEG_BASE64 } from './backdropData';
import { VISUAL_BIOME } from './biome';

describe('backdropData', () => {
  it('全 7 地区ぶんの base64 があり、JPEG として復号できる大きさ', () => {
    expect(Object.keys(BACKDROP_JPEG_BASE64).sort()).toEqual([...BIOME_IDS].sort());
    for (const b64 of Object.values(BACKDROP_JPEG_BASE64)) {
      expect(b64!.length).toBeGreaterThan(1000);
      // JPEG の SOI マーカー(0xFFD8)で始まる
      const head = atob(b64!.slice(0, 8));
      expect(head.charCodeAt(0)).toBe(0xff);
      expect(head.charCodeAt(1)).toBe(0xd8);
    }
  });
});

describe('backdropIdOf', () => {
  it('全地区の見た目オブジェクトから地区 ID を引ける', () => {
    for (const id of BIOME_IDS) expect(backdropIdOf(VISUAL_BIOME[id])).toBe(id);
  });
});

describe('createBackdropSet', () => {
  it('素材が無い地区・未デコードの間は null(手続きシルエットへフォールバック)', () => {
    const empty = createBackdropSet({});
    for (const id of BIOME_IDS) expect(empty.imageFor(id)).toBe(null);
    // Node 環境では Image が無いので、データがあっても読み込みは始まらず null のまま
    const withData = createBackdropSet(BACKDROP_JPEG_BASE64);
    for (const id of BIOME_IDS) expect(withData.imageFor(id)).toBe(null);
  });
});

describe('backdropDrawRects', () => {
  it('画面幅を隙間なく覆い、地平に足元が揃う。決定論', () => {
    const w = 427, h = 240;
    const a = backdropDrawRects(w, h, 1234.5, -987.6, 3, 512, 219);
    expect(a).toEqual(backdropDrawRects(w, h, 1234.5, -987.6, 3, 512, 219));
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a.length).toBeLessThanOrEqual(2);
    // 矩形は連続して幅 w 以上を覆う
    const sorted = [...a].sort((p, q) => p.x - q.x);
    expect(sorted[0].x).toBeLessThanOrEqual(0);
    expect(sorted[sorted.length - 1].x + sorted[sorted.length - 1].w).toBeGreaterThanOrEqual(w);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].x).toBeCloseTo(sorted[i - 1].x + sorted[i - 1].w, 6);
    // 高さはアスペクト比どおり、足元は地平(h*0.9)に近い
    for (const r of a) {
      expect(r.h).toBeCloseTo((r.w * 219) / 512, 6);
      expect(r.y + r.h).toBeGreaterThan(h * 0.85);
      expect(r.y + r.h).toBeLessThan(h * 0.95);
    }
  });

  it('カメラが動くと遠景追従率ぶんだけゆっくりずれる', () => {
    const a = backdropDrawRects(427, 240, 0, 0, 3, 512, 219);
    const b = backdropDrawRects(427, 240, 100, 0, 3, 512, 219);
    const shift = Math.abs(b[0].x - a[0].x);
    expect(shift).toBeGreaterThan(0);
    expect(shift).toBeLessThan(2); // 100 タイル移動しても 2px 未満(最遠層)
  });
});
