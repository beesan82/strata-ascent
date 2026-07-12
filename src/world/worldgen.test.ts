import { describe, expect, it } from 'vitest';
import { Player } from '../entities/player';
import { hash2 } from './noise';
import { stratumAt } from './strata';
import { CHUNK_SIZE, TILE } from './tiles';
import { findSpawn, generateChunk, noiseTileAt, tileAt } from './worldgen';

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

  it('梯子列は質量ノイズ(柱・壁塊)にも巨大空洞にも分断されない(全行LADDER)', () => {
    // 回帰テスト: 梯子判定は巨大空洞・質量ノイズ・床のいずれよりも先に行われるため、
    // 梯子列は空洞の有無に関わらず全行LADDERであることを固定する
    // (将来のパラメータ調整で退行させない)。
    // ladderXは実装(tileAt)の式をそのまま再現している。実装と鏡写しの結合だが、
    // 「梯子は常にどんな地形も貫通する」性質を固定する目的で意図的に許容する。
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

  it('上方向ルートの存在: スポーンから実際にPlayerで梯子を登り、床帯を1つ以上突破できる', () => {
    // 結合テスト(意図的): 単体テストだけではプレイヤーの足元判定とワールド生成の
    // 統合契約(梯子が床帯を貫通し、実際に登り切れること)を検証できない。
    // このテストはそのレビューの見落としを固定するための回帰テスト。
    const seed = 20260711;
    const spawn = findSpawn(seed);
    const floorSpacing = stratumAt(spawn.y).floorSpacing;

    // スポーンが属する32タイル幅の列グループの梯子x座標を求める(tileAtの式を再現)。
    // 実装と鏡写しの結合だが、「スポーン地点の近くに必ず梯子がある」ことを固定する
    // 目的で意図的に許容する。
    const group = Math.floor(spawn.x / 32);
    const band = Math.floor(spawn.y / floorSpacing);
    const ladderX = group * 32 + Math.floor(hash2(seed + 404, group, band) * 32);

    const tiles = (tx: number, ty: number) => tileAt(seed, tx, ty);
    // 梯子列の上、スポーンと同じ高度に配置して登り始める
    const player = new Player(ladderX + 0.1, spawn.y);
    const startFeet = player.body.y + player.body.h;

    const upInput = { left: false, right: false, jump: false, up: true, down: false };
    let maxRise = 0;
    for (let i = 0; i < 1800; i++) {
      // 30秒(dt=1/60)まで登り続ける
      player.update(upInput, 1 / 60, tiles);
      maxRise = Math.max(maxRise, startFeet - (player.body.y + player.body.h));
    }

    // 足元が最低でも1床帯分(floorSpacing)は上昇できているはず。
    // 旧・中心のみのonLadder判定では自bandの床行で頭打ちになり、これが破綻する。
    expect(maxRise).toBeGreaterThanOrEqual(floorSpacing);
  });
});

describe('tileAt 合成(段階2)', () => {
  it('施設が無い座標では tileAt は noiseTileAt と一致する', () => {
    for (const [x, y] of [[0, 0], [63, -8], [200, -520], [-40, 130]] as const) {
      expect(tileAt(42, x, y)).toBe(noiseTileAt(42, x, y));
    }
  });

  it('ノイズが LADDER のタイルは tileAt でも必ず LADDER(上昇路保持の不変条件)', () => {
    let checked = 0;
    for (let y = -200; y < 0 && checked < 50; y++) {
      for (let x = 0; x < 512 && checked < 50; x++) {
        if (noiseTileAt(42, x, y) === TILE.LADDER) {
          expect(tileAt(42, x, y)).toBe(TILE.LADDER);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('施設統合後の到達可能性', () => {
  it('ノイズLADDER保持: 施設領域でもノイズの梯子は残る(既存の上昇保証)', () => {
    let checked = 0;
    for (let y = -400; y < 0 && checked < 80; y++) {
      for (let x = 0; x < 1024 && checked < 80; x++) {
        if (noiseTileAt(42, x, y) === TILE.LADDER) {
          expect(tileAt(42, x, y)).toBe(TILE.LADDER);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('findSpawn はSOLIDの中ではない(施設統合後も安全)', () => {
    for (const seed of [1, 42, 20260711]) {
      const { x, y } = findSpawn(seed);
      expect(tileAt(seed, Math.floor(x), Math.floor(y))).not.toBe(TILE.SOLID);
    }
  });
});
