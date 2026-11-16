import { describe, expect, it } from 'vitest';
import { baseTileAt, tileAt } from './worldgen';
import { pillarsInRect, type Pillar } from './pillar';
import { checkPillarPreservation, pillarCrossingDistance } from './reach';

/**
 * 巨柱の到達可能性の保存(2.21、設計 §A-3 の検証 2)。
 * 4 シード × 各 50 本以上・合計 200 本以上で、本ゲート(実移動モデル同士)と
 * 柱自身の通行保証(保守モデル)の違反が 0 であること。柱が 200 本に満たなければ失敗。
 * 1 本あたり数秒かかるため、このファイルのテストは長めのタイムアウトを持つ。
 */

const base = (seed: number) => (x: number, y: number): number => baseTileAt(seed, x, y);
const fin = (seed: number) => (x: number, y: number): number => tileAt(seed, x, y);

function collect(seed: number, count: number): Pillar[] {
  return pillarsInRect(seed, -2400, 2400, -3200, 3200, base(seed)).slice(0, count);
}

const SEEDS = [20260711, 1234567, 42, 987654321];

describe('巨柱: 到達関係の保存', () => {
  for (const seed of SEEDS) {
    it(`シード ${seed}: 50 本で違反 0`, () => {
      const list = collect(seed, 50);
      expect(list.length).toBe(50);
      for (const p of list) {
        const r = checkPillarPreservation(base(seed), fin(seed), p);
        expect(r.violations, `${p.id} の保存違反`).toEqual([]);
        expect(r.doorViolations, `${p.id} の通行保証違反`).toEqual([]);
        expect(r.sources).toBeGreaterThan(0);
      }
    }, 1_200_000);
  }

  it('シード 987654321 の p:-2,7 は既知の例外として記録された違反だけを持つ', () => {
    // 既知の例外の記録。広域走査(scripts/reach-survey.ts)で見つかった 1 本で、
    // 4 シード × 50 本の保存ゲート(上のテスト)は全て通っている。
    //
    // 経緯:
    // - 当初は「東の乗り場の梯子列が柱の下へ抜けていない」と見て棄却条件
    //   hitsBrokenLadderAccess を入れたが、直らなかった。梯子列は柱の上下とも続いていた。
    // - 真の原因は、東の乗り場の帯を斜めに横切る岩の斜面。斜面の表面のセル(立つセル)が
    //   帯の埋め立てで消え、柱の下の小さな足場群((-201,2927) 付近)から上方への経路が断たれる。
    // - 帯の全域埋め立ては、別の実例(帯の中の閉じた床バンドが作るポケット)を埋めるための
    //   裁定であり、この違反と表裏一体。埋め立てをやめるとポケットの方が戻る。
    //
    // このテストは違反が「記録どおり」であることを確かめる。将来この斜面の扱いを直したら
    // (違反が減る・消える・別の組に変わる)このテストは落ちるので、記録を更新すること。
    // 柱そのものが無くなった場合も、記録の更新が要るので不合格にする。
    //
    // 注意: checkPillarPreservation は違反が 5 件に達すると打ち切って返すため、
    // ここに並ぶのは「最初の 5 件」であり、打ち切りの時点で柱自身の通行保証
    // (doorViolations)はまだ調べられていない(空で返る)。
    const seed = 987654321;
    const p = pillarsInRect(seed, -2304, 2304, -3000, 3000, base(seed)).find((q) => q.id === 'p:-2,7');
    expect(p, 'p:-2,7 が存在しない(例外の記録を更新すること)').toBeDefined();
    const r = checkPillarPreservation(base(seed), fin(seed), p!);
    const known = [
      '(-201,2927) -> (-147,2707)',
      '(-201,2927) -> (-147,2708)',
      '(-201,2927) -> (-147,2709)',
      '(-201,2927) -> (-147,2710)',
      '(-201,2927) -> (-147,2711)',
    ];
    // 順序は問わず、集合として一致すること
    expect([...r.violations].sort(), 'p:-2,7 の保存違反(既知の例外の記録)').toEqual([...known].sort());
    expect(r.doorViolations, 'p:-2,7 の通行保証違反').toEqual([]);
  }, 1_200_000);

  it('checkPillarPreservation は端点と源を数え、既知の柱で違反が無い', () => {
    const seed = 20260711;
    const list = collect(seed, 1);
    expect(list.length).toBe(1);
    const p = list[0];
    const r = checkPillarPreservation(base(seed), fin(seed), p);
    expect(r.violations).toEqual([]);
    expect(r.doorViolations).toEqual([]);
    expect(r.endpoints).toBeGreaterThan(0);
    expect(r.sources).toBeGreaterThan(0);
  }, 300_000);

  it('横断距離は決定的で、柱ありでも届く', () => {
    const list = collect(20260711, 3);
    expect(list.length).toBe(3);
    for (const p of list) {
      const door = p.doors[Math.floor(p.doors.length / 2)];
      const d1 = pillarCrossingDistance(base(20260711), fin(20260711), p, door);
      const d2 = pillarCrossingDistance(base(20260711), fin(20260711), p, door);
      expect(d1).not.toBeNull();
      expect(d1).toEqual(d2);
      expect(d1!.base).toBeGreaterThan(0);
      expect(d1!.fin).toBeGreaterThan(0);
    }
  }, 300_000);
});
