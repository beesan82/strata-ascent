import { describe, expect, it } from 'vitest';
import {
  BUILDER_MIN_RUN,
  canonicalRun,
  chooseBuilder,
  chooseTerminal,
  chooseTramTrack,
  distanceToTrack,
  findTramTracks,
  terminalTextFor,
  TERMINAL_TEXTS,
  TRAM_DWELL,
  TRAM_SPEED,
  TRAM_W,
  tramCarX,
  tramPeriod,
  tramTracksInRow,
  type TramTrack,
} from './infra';
import { findFloorRuns, type FloorRun } from './spawn';
import { TILE, type Tile } from './tiles';
import type { TileLookup } from '../entities/physics';

const SEED = 20260711;

/** 文字の格子ではなく、関数で世界を組む(床の行・梯子列・障害物) */
function worldOf(f: (x: number, y: number) => Tile): TileLookup {
  return f;
}

/** 行 10 が x∈[0,128) の床、x=40 が梯子列、x=100 の行 7 に障害物(頭上の空きを切る) */
const TRAM_WORLD = worldOf((x, y) => {
  if (x === 40 && y <= 10) return TILE.LADDER;
  if (x === 100 && y === 7) return TILE.SOLID;
  if (y === 10 && x >= 0 && x < 128) return TILE.SOLID;
  return TILE.AIR;
});

function runs(n: number): FloorRun[] {
  const out: FloorRun[] = [];
  for (let i = 0; i < n; i++) out.push({ x: 100 + i * 37, floorY: 500 - i * 13, len: 10 + (i % 12) });
  return out;
}

describe('トラムの軌道', () => {
  it('床(固体か梯子)が続き頭上 4 行が空いた区間を、ブロックの中で 40 以上のものだけ軌道にする', () => {
    expect(tramTracksInRow(TRAM_WORLD, 0, 10)).toEqual([{ id: 'tr:0,10,0', x0: 0, x1: 100, floorY: 10 }]);
    expect(tramTracksInRow(TRAM_WORLD, 0, 9)).toEqual([]);
    expect(findTramTracks(TRAM_WORLD, [10], -5, 130).map((t) => t.id)).toEqual(['tr:0,10,0']);
  });

  it('両端の梯子の列は削る(車両が穴の上で止まらない)', () => {
    const w = worldOf((x, y) => {
      if ((x === 9 || x === 60) && y <= 10) return TILE.LADDER;
      if (y === 10 && x >= 10 && x < 60) return TILE.SOLID;
      return TILE.AIR;
    });
    expect(tramTracksInRow(w, 0, 10)).toEqual([{ id: 'tr:0,10,10', x0: 10, x1: 60, floorY: 10 }]);
  });

  it('車両の位置は時刻だけで決まり、軌道の中に収まり、端で停車し、なめらかに動く', () => {
    const t: TramTrack = { id: 'tr:0,10,0', x0: 0, x1: 100, floorY: 10 };
    const period = tramPeriod(t);
    expect(period).toBeCloseTo(2 * ((100 - TRAM_W) / TRAM_SPEED + TRAM_DWELL), 9);
    let atLeft = 0;
    let atRight = 0;
    let prev = tramCarX(SEED, t, 0);
    const dt = 1 / 60;
    for (let i = 1; i <= Math.ceil(period / dt) + 60; i++) {
      const x = tramCarX(SEED, t, i * dt);
      expect(x).toBeGreaterThanOrEqual(t.x0);
      expect(x).toBeLessThanOrEqual(t.x1 - TRAM_W);
      // 加減速は smoothstep(最大で巡航の 1.5 倍)
      expect(Math.abs(x - prev)).toBeLessThanOrEqual(1.5 * TRAM_SPEED * dt + 1e-9);
      if (x === t.x0) atLeft++;
      if (x === t.x1 - TRAM_W) atRight++;
      prev = x;
    }
    expect(atLeft).toBeGreaterThan(TRAM_DWELL * 60 * 0.9);
    expect(atRight).toBeGreaterThan(TRAM_DWELL * 60 * 0.9);
    expect(tramCarX(SEED, t, 12.34)).toBe(tramCarX(SEED, t, 12.34));
    expect(tramCarX(SEED, t, 5)).toBeCloseTo(tramCarX(SEED, t, 5 + period), 6);
  });

  it('選定は決定的で、保護点・除外矩形に掛かる軌道は使わない', () => {
    const tracks: TramTrack[] = [];
    for (let i = 0; i < 30; i++) tracks.push({ id: `tr:${i},${10 + i},${i * 200}`, x0: i * 200, x1: i * 200 + 60, floorY: 10 + i });
    const a = chooseTramTrack(SEED, tracks, [], []);
    expect(a).not.toBeNull();
    expect(chooseTramTrack(SEED, tracks, [], [])).toEqual(a);
    const t = a!;
    expect(chooseTramTrack(SEED, [t], [{ x: t.x0 + 30, y: t.floorY, r: 2 }], [])).toBeNull();
    expect(chooseTramTrack(SEED, [t], [], [{ x0: t.x0 + 10, x1: t.x0 + 12, y0: t.floorY - 2, y1: t.floorY }])).toBeNull();
    expect(distanceToTrack(t, t.x0 + 5, t.floorY - 3)).toBe(3);
    expect(distanceToTrack(t, t.x1 + 4, t.floorY)).toBe(4);
  });
});

describe('床ランの正規化', () => {
  it('窓の端で切れたランを本来の端まで延ばし、端に触れていないランはそのまま', () => {
    const w = worldOf((x, y) => (y === 10 && x >= 0 && x < 50 ? TILE.SOLID : TILE.AIR));
    const clipped = findFloorRuns(w, 20, 0, 40, 20);
    expect(clipped).toEqual([{ x: 20, floorY: 10, len: 20 }]);
    expect(canonicalRun(w, clipped[0], 20, 40)).toEqual({ x: 0, floorY: 10, len: 50 });
    const inner = findFloorRuns(w, -10, 0, 60, 20)[0];
    expect(canonicalRun(w, inner, -10, 60)).toBe(inner);
  });
});

describe('建設者の選定', () => {
  it('決定的で最大 1 体、床ランの上に体の下端を揃える', () => {
    const rs = runs(60);
    const a = chooseBuilder(SEED, rs, [], [], 2, 2.5, () => true);
    expect(a).not.toBeNull();
    expect(chooseBuilder(SEED, rs, [], [], 2, 2.5, () => true)).toEqual(a);
    const run = rs.find((r) => a!.id === `b:${r.x},${r.floorY}`)!;
    expect(run).toBeDefined();
    expect(a!.y).toBe(run.floorY - 2.5);
    expect(a!.x).toBeGreaterThanOrEqual(run.x);
    expect(a!.x + 2).toBeLessThanOrEqual(run.x + run.len);
  });

  it('体が置けない・ランが短い・保護点の中では出さない', () => {
    const rs = runs(30);
    expect(chooseBuilder(SEED, rs, [], [], 2, 2.5, () => false)).toBeNull();
    const short = rs.map((r) => ({ ...r, len: BUILDER_MIN_RUN - 1 }));
    expect(chooseBuilder(SEED, short, [], [], 2, 2.5, () => true)).toBeNull();
    expect(chooseBuilder(SEED, rs, [{ x: 0, y: 0, r: 100000 }], [], 2, 2.5, () => true)).toBeNull();
  });
});

describe('端末', () => {
  it('選定は決定的で、ID は m: 接頭辞、保護点の中には置かない', () => {
    const rs = runs(30);
    const a = chooseTerminal(SEED, rs, [], []);
    expect(a).not.toBeNull();
    expect(a!.id.startsWith('m:')).toBe(true);
    expect(chooseTerminal(SEED, rs, [], [])).toEqual(a);
    expect(chooseTerminal(SEED, rs, [{ x: 0, y: 0, r: 100000 }], [])).toBeNull();
  });

  it('断片テキストは十数件で、ID から決定的に選ぶ', () => {
    expect(TERMINAL_TEXTS.length).toBeGreaterThanOrEqual(12);
    expect(TERMINAL_TEXTS.length).toBeLessThanOrEqual(20);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = `m:${i * 7},${i * 3}`;
      const text = terminalTextFor(SEED, id);
      expect(TERMINAL_TEXTS).toContain(text);
      expect(terminalTextFor(SEED, id)).toBe(text);
      seen.add(text);
    }
    expect(seen.size).toBeGreaterThan(TERMINAL_TEXTS.length / 2);
  });

  it('断片テキストは原作の固有名詞を含まない', () => {
    const banned = ['ネットスフィア', '統治局', 'セーフガード', '珪素生物', '建設者', '霧亥', 'シボ', '重力子放射線', '端末遺伝子', '駆除系'];
    for (const t of TERMINAL_TEXTS) for (const w of banned) expect(t).not.toContain(w);
  });
});
