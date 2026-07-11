import { describe, expect, it } from 'vitest';
import { hash2, valueNoise2 } from './noise';
import { stratumAt } from './strata';
import { CHUNK_SIZE, TILE } from './tiles';
import { findSpawn, generateChunk, tileAt } from './worldgen';

describe('generateChunk', () => {
  it('同一シード・同一チャンク座標なら完全に同じ出力(決定論)', () => {
    const a = generateChunk(42, 3, -2);
    const b = generateChunk(42, 3, -2);
    expect(a).toEqual(b);
  });

  it('シードが違えば出力が変わる', () => {
    const a = generateChunk(1, 0, 0);
    const b = generateChunk(2, 0, 0);
    expect(a).not.toEqual(b);
  });

  it('チャンクは64x64タイルで、tileAtと一致する', () => {
    const chunk = generateChunk(42, 1, 1);
    expect(chunk.length).toBe(CHUNK_SIZE * CHUNK_SIZE);
    for (let ty = 0; ty < CHUNK_SIZE; ty += 7) {
      for (let tx = 0; tx < CHUNK_SIZE; tx += 7) {
        expect(chunk[ty * CHUNK_SIZE + tx]).toBe(
          tileAt(42, 1 * CHUNK_SIZE + tx, 1 * CHUNK_SIZE + ty),
        );
      }
    }
  });

  it('階層境界(高度500)をまたぐチャンクでもtileAtと一致する', () => {
    // cy=-8 → y=-512..-449。高度500(y=-500)の階層境界を横断する
    const chunk = generateChunk(42, 2, -8);
    for (let ty = 0; ty < CHUNK_SIZE; ty += 7) {
      for (let tx = 0; tx < CHUNK_SIZE; tx += 7) {
        expect(chunk[ty * CHUNK_SIZE + tx]).toBe(
          tileAt(42, 2 * CHUNK_SIZE + tx, -8 * CHUNK_SIZE + ty),
        );
      }
    }
  });
});

describe('tileAt', () => {
  // 生成パラメータを調整した場合、以下の統計的テストは閾値の見直しが必要になることがある。
  // 失敗したら盲目的にリトライせず、生成結果を目視(またはカウント出力)して原因を確認すること。
  it('広域(256x128タイル)には空気・地形・梯子がすべて存在する', () => {
    for (const seed of [1, 42, 20260711]) {
      const counts = { air: 0, solid: 0, ladder: 0 };
      for (let y = -128; y < 0; y++) {
        for (let x = 0; x < 256; x++) {
          const t = tileAt(seed, x, y);
          if (t === TILE.AIR) counts.air++;
          else if (t === TILE.SOLID) counts.solid++;
          else if (t === TILE.LADDER) counts.ladder++;
        }
      }
      expect(counts.air).toBeGreaterThan(0);
      expect(counts.solid).toBeGreaterThan(0);
      expect(counts.ladder).toBeGreaterThan(0);
    }
  });

  it('梯子列は質量ノイズ(柱・壁塊)に分断されない(空洞内を除き常にLADDER)', () => {
    // 回帰テスト: 梯子判定は質量ノイズより先に行われるため、空洞でない限り
    // 梯子列の全行がLADDERであることを固定する(将来のパラメータ調整で退行させない)。
    // ladderXと空洞条件は実装(tileAt)の式をそのまま再現している。実装と鏡写しの
    // 結合だが、「空洞だけが梯子を除去できる」性質を固定する目的で意図的に許容する。
    const FLOOR_SPACING = 8; // 階層0(最下層)
    for (const seed of [1, 42, 20260711]) {
      for (let group = 0; group < 8; group++) {
        // 階層0内の床帯を地上側(band -40..-1, y=-320..-1)と
        // 地下側(band 1..40, y=8..327)の両方で検証
        for (let band = -40; band <= 40; band++) {
          if (band === 0) continue;
          const ladderX =
            group * 32 + Math.floor(hash2(seed + 404, group, band) * 32);
          for (let y = band * FLOOR_SPACING; y < (band + 1) * FLOOR_SPACING; y++) {
            const s = stratumAt(y);
            expect(s.floorSpacing).toBe(FLOOR_SPACING);
            const cavity =
              valueNoise2(seed + 101, ladderX / 160, y / 160) > s.cavityThreshold;
            if (cavity) continue;
            expect(tileAt(seed, ladderX, y)).toBe(TILE.LADDER);
          }
        }
      }
    }
  });

  it('床行には開口部(欠落セグメント)が存在する', () => {
    // 最下層(高度0〜500)の床間隔は8。床行のうちAIRになっている箇所が広域に必ずある
    let gaps = 0;
    for (let x = 0; x < 512; x++) {
      if (tileAt(42, x, -8) !== TILE.SOLID) gaps++;
    }
    expect(gaps).toBeGreaterThan(0);
  });
});

describe('findSpawn', () => {
  it('スポーン位置はSOLIDの中ではない', () => {
    for (const seed of [1, 42, 20260711]) {
      const { x, y } = findSpawn(seed);
      expect(tileAt(seed, Math.floor(x), Math.floor(y))).not.toBe(TILE.SOLID);
    }
  });
});
