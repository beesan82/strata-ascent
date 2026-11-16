import { describe, expect, it } from 'vitest';
import {
  GRAND_TERMINAL_GUARD,
  grandCrossingEnteredCell,
  grandPlateCrossing,
  grandPlateRanges,
  grandShaftAt,
  grandTerminalPoints,
  isTerminalStop,
  type GrandPlateRange,
  type GrandShaft,
} from './grandShaft';

/** 板 2 枚(cell 5 が厚さ 32、cell 6 が大界面相当の厚さ 96) */
const PLATES: GrandPlateRange[] = [
  { cell: 5, y0: 1000, y1: 1032 },
  { cell: 6, y0: 1400, y1: 1496 },
];

let first: { seed: number; s: GrandShaft } | null = null;
/** 最初に見つかる大昇降機(grandShaft.test.ts と同じ走査範囲。見つからなければ失敗) */
function firstGrand(): { seed: number; s: GrandShaft } {
  if (first) return first;
  for (const seed of [1, 42, 20260711, 7, 99]) {
    for (let band = -3; band <= 3; band++) {
      for (let c = -30; c < 30; c++) {
        const s = grandShaftAt(seed, band, c);
        if (s) return (first = { seed, s });
      }
    }
  }
  throw new Error('大昇降機が見つからない');
}

describe('板を横切ったイベント(grandPlateCrossing)', () => {
  it('下り: 板の上面を越えた瞬間に enter', () => {
    expect(grandPlateCrossing(999.9, 1000.1, PLATES)).toEqual([{ type: 'enter', cell: 5 }]);
    // 板の上面の途中駅(上面ちょうど)から下りはじめた瞬間も enter
    expect(grandPlateCrossing(1000, 1000.05, PLATES)).toEqual([{ type: 'enter', cell: 5 }]);
  });

  it('下り: 板の下面に達した瞬間に exit', () => {
    expect(grandPlateCrossing(1031.9, 1032.1, PLATES)).toEqual([{ type: 'exit', cell: 5 }]);
    expect(grandPlateCrossing(1031.95, 1032, PLATES)).toEqual([{ type: 'exit', cell: 5 }]);
  });

  it('上り: 板の下面を越えた瞬間に enter', () => {
    expect(grandPlateCrossing(1032.1, 1031.9, PLATES)).toEqual([{ type: 'enter', cell: 5 }]);
    expect(grandPlateCrossing(1496, 1495.95, PLATES)).toEqual([{ type: 'enter', cell: 6 }]);
  });

  it('上り: 板の上面に達した瞬間に exit(上面の途中駅に着いたとき)', () => {
    expect(grandPlateCrossing(1000.1, 999.9, PLATES)).toEqual([{ type: 'exit', cell: 5 }]);
    expect(grandPlateCrossing(1000.05, 1000, PLATES)).toEqual([{ type: 'exit', cell: 5 }]);
  });

  it('板の内側から内側、外から外(同じ側)、動いていないときは何も返さない', () => {
    expect(grandPlateCrossing(1005, 1020, PLATES)).toEqual([]);
    expect(grandPlateCrossing(1020, 1005, PLATES)).toEqual([]);
    expect(grandPlateCrossing(1410, 1490, PLATES)).toEqual([]);
    // 板の外どうし(板と板の間、板の上、板の下)
    expect(grandPlateCrossing(900, 999, PLATES)).toEqual([]);
    expect(grandPlateCrossing(1040, 1390, PLATES)).toEqual([]);
    expect(grandPlateCrossing(1600, 1500, PLATES)).toEqual([]);
    // 境界ちょうどは外: 上面の途中駅に止まっている・上面ちょうどへ上から着く
    expect(grandPlateCrossing(1000, 1000, PLATES)).toEqual([]);
    expect(grandPlateCrossing(999.5, 1000, PLATES)).toEqual([]);
    expect(grandPlateCrossing(1010, 1010, PLATES)).toEqual([]);
    expect(grandPlateCrossing(950, 960, [])).toEqual([]);
  });

  it('1 ステップで複数の板をまたぐと、移動の順に板ごとの enter・exit を返す', () => {
    // 下り: 上の板(cell 5)が先
    expect(grandPlateCrossing(990, 1600, PLATES)).toEqual([
      { type: 'enter', cell: 5 }, { type: 'exit', cell: 5 },
      { type: 'enter', cell: 6 }, { type: 'exit', cell: 6 },
    ]);
    // 上り: 下の板(cell 6)が先
    expect(grandPlateCrossing(1600, 990, PLATES)).toEqual([
      { type: 'enter', cell: 6 }, { type: 'exit', cell: 6 },
      { type: 'enter', cell: 5 }, { type: 'exit', cell: 5 },
    ]);
    // 板の並び順が入力で逆でも、移動の順に並べ直す
    expect(grandPlateCrossing(990, 1600, [PLATES[1], PLATES[0]]).map((e) => e.cell)).toEqual([5, 5, 6, 6]);
  });

  it('板の内側から出て次の板の内側で止まると、exit の後に次の板の enter', () => {
    expect(grandPlateCrossing(1010, 1450, PLATES)).toEqual([{ type: 'exit', cell: 5 }, { type: 'enter', cell: 6 }]);
    expect(grandPlateCrossing(1450, 1010, PLATES)).toEqual([{ type: 'exit', cell: 6 }, { type: 'enter', cell: 5 }]);
  });

  it('小さな dt で板を通り抜けると、板ごとに enter と exit がちょうど 1 回ずつ(上り下りとも)', () => {
    for (const dir of [1, -1]) {
      const events: string[] = [];
      let top = dir > 0 ? 950 : 1550;
      // 足場の速さ 3 タイル/秒 × 1/60 秒 = 0.05 タイル/ステップ
      for (let i = 0; i < 12000; i++) {
        const next = top + dir * 0.05;
        for (const e of grandPlateCrossing(top, next, PLATES)) events.push(`${e.type}${e.cell}`);
        top = next;
      }
      expect(events).toEqual(dir > 0 ? ['enter5', 'exit5', 'enter6', 'exit6'] : ['enter6', 'exit6', 'enter5', 'exit5']);
    }
  });

  it('字幕に出す「入った先」の層: 板の cell を c として、下りなら c、上りなら c−1', () => {
    expect(grandCrossingEnteredCell(5, true)).toBe(5);
    expect(grandCrossingEnteredCell(5, false)).toBe(4);
    expect(grandCrossingEnteredCell(-2, true)).toBe(-2);
    expect(grandCrossingEnteredCell(-2, false)).toBe(-3);
  });

  it('実在のシャフトの板の行範囲は貫く板と一致し、上から下へ乗り通すと全部の板で enter → exit の順', () => {
    const { s } = firstGrand();
    const ranges = grandPlateRanges(s);
    expect(ranges.length).toBe(s.plates.length);
    expect(ranges.length).toBeGreaterThan(0);
    ranges.forEach((r, i) => {
      expect(r.cell).toBe(s.plates[i].cell);
      expect(r.y0).toBe(s.plates[i].top);
      expect(r.y1).toBe(s.plates[i].bottom);
      expect(r.y0).toBeLessThan(r.y1);
    });
    // 上端から下端まで一気に動いたとき(全部の板が両端の停止階の間にある)
    const want = ranges.flatMap((r) => [{ type: 'enter', cell: r.cell }, { type: 'exit', cell: r.cell }]);
    expect(grandPlateCrossing(s.yTop, s.yBottom, ranges)).toEqual(want);
    // 停止階から停止階へ動く 1 区間では、板の上面の駅 → 板の直下の駅の区間だけが enter・exit を返す
    for (const st of s.stations) {
      expect(grandPlateCrossing(st.upper, st.lower, ranges)).toEqual([{ type: 'enter', cell: st.cell }, { type: 'exit', cell: st.cell }]);
      expect(grandPlateCrossing(st.lower, st.upper, ranges)).toEqual([{ type: 'enter', cell: st.cell }, { type: 'exit', cell: st.cell }]);
    }
  });
});

describe('大昇降機の終端(isTerminalStop・grandTerminalPoints)', () => {
  it('上端・下端の停止階にちょうど止まっていれば true', () => {
    const shaft = { yTop: 300, yBottom: 2750 };
    expect(isTerminalStop(shaft, 300)).toBe(true);
    expect(isTerminalStop(shaft, 2750)).toBe(true);
    const { s } = firstGrand();
    expect(isTerminalStop(s, s.yTop)).toBe(true);
    expect(isTerminalStop(s, s.yBottom)).toBe(true);
    expect(isTerminalStop(s, s.stops[0])).toBe(true);
    expect(isTerminalStop(s, s.stops[s.stops.length - 1])).toBe(true);
  });

  it('途中駅と移動中では false', () => {
    const shaft = { yTop: 300, yBottom: 2750 };
    expect(isTerminalStop(shaft, 300.05)).toBe(false);
    expect(isTerminalStop(shaft, 2749.95)).toBe(false);
    expect(isTerminalStop(shaft, 1500)).toBe(false);
    const { s } = firstGrand();
    expect(s.stations.length).toBeGreaterThan(0);
    for (const st of s.stations) {
      expect(isTerminalStop(s, st.upper)).toBe(false);
      expect(isTerminalStop(s, st.lower)).toBe(false);
    }
    // 途中の停止階(両端を除く)はどれも終端でない
    for (const stop of s.stops.slice(1, -1)) expect(isTerminalStop(s, stop)).toBe(false);
  });

  it('終端の保護点は上端・下端の乗り場の中心で、乗り場の両端が半径の内側に収まる', () => {
    const { s } = firstGrand();
    const pts = grandTerminalPoints(s);
    expect(pts.length).toBe(2);
    expect(pts.map((p) => p.y)).toEqual([s.yTop, s.yBottom]);
    for (const p of pts) {
      // 乗り場 [landL, landR] の中点(シャフトの内側を含む帯の中央)
      expect(p.x).toBe((s.landL + s.landR + 1) / 2);
      expect(p.x).toBeGreaterThan(s.landL);
      expect(p.x).toBeLessThan(s.landR + 1);
      expect(p.x - s.landL).toBeLessThanOrEqual(GRAND_TERMINAL_GUARD);
      expect(s.landR + 1 - p.x).toBeLessThanOrEqual(GRAND_TERMINAL_GUARD);
    }
    expect(GRAND_TERMINAL_GUARD).toBe(24);
  });
});
