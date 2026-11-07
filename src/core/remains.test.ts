import { describe, expect, it } from 'vitest';
import {
  addRemainsSite,
  initialGroundAnchor,
  MAX_REMAINS_SITES,
  pruneRemainsSites,
  STABLE_GROUND_SEC,
  stepGroundAnchor,
  type GroundAnchor,
} from './remains';

const DT = 1 / 60;

/** 接地し続ける入力(位置はボディ左上) */
function grounded(anchor: GroundAnchor, x: number, y: number, seconds: number): GroundAnchor {
  let a = anchor;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    a = stepGroundAnchor(a, { grounded: true, knocked: false, x, y, dt: DT });
  }
  return a;
}

describe('stepGroundAnchor(安定接地点)', () => {
  it('初期位置はスポーン地点で、接地時間は 0', () => {
    const a = initialGroundAnchor(10, 20);
    expect(a).toEqual({ x: 10, y: 20, groundedT: 0 });
  });

  it('1 秒未満の接地ではアンカーは更新されない', () => {
    let a = initialGroundAnchor(0, 0);
    a = grounded(a, 50, 60, STABLE_GROUND_SEC - DT);
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
    expect(a.groundedT).toBeCloseTo(STABLE_GROUND_SEC - DT);
  });

  it('1 秒接地し続けるとアンカーが現在位置へ更新される', () => {
    let a = initialGroundAnchor(0, 0);
    a = grounded(a, 50, 60, STABLE_GROUND_SEC);
    expect(a.x).toBe(50);
    expect(a.y).toBe(60);
  });

  it('安定後も接地し続ける間はアンカーが現在位置へ追従する', () => {
    let a = initialGroundAnchor(0, 0);
    a = grounded(a, 50, 60, STABLE_GROUND_SEC);
    a = grounded(a, 55, 60, 0.5);
    expect(a.x).toBe(55);
    expect(a.y).toBe(60);
  });

  it('空中に離れると接地時間はリセットされ、アンカーは最後の安定位置のまま', () => {
    let a = initialGroundAnchor(0, 0);
    a = grounded(a, 50, 60, STABLE_GROUND_SEC);
    a = stepGroundAnchor(a, { grounded: false, knocked: false, x: 70, y: 30, dt: DT });
    expect(a.groundedT).toBe(0);
    expect(a.x).toBe(50);
    expect(a.y).toBe(60);
    // 再接地しても 1 秒たつまでは古いアンカーのまま
    a = grounded(a, 70, 30, STABLE_GROUND_SEC - DT);
    expect(a.x).toBe(50);
    a = stepGroundAnchor(a, { grounded: true, knocked: false, x: 70, y: 30, dt: DT });
    expect(a.x).toBe(70);
    expect(a.y).toBe(30);
  });

  it('ノックバック中は接地していても安定とみなさない', () => {
    let a = initialGroundAnchor(0, 0);
    a = grounded(a, 50, 60, STABLE_GROUND_SEC);
    // ノックバックで吹き飛ばされて別の床へ落ちた直後は、1 秒たってもアンカーは動かない
    for (let i = 0; i < 60; i++) {
      a = stepGroundAnchor(a, { grounded: true, knocked: true, x: 90, y: 60, dt: DT });
    }
    expect(a.x).toBe(50);
    expect(a.groundedT).toBe(0);
    // ノックバックが終わって 1 秒接地すれば更新される
    a = grounded(a, 90, 60, STABLE_GROUND_SEC);
    expect(a.x).toBe(90);
  });

  it('dt の刻み方で結果が変わらない(0.25 秒 ×4 と 1 秒 ×1)', () => {
    const a0 = initialGroundAnchor(0, 0);
    let a = a0;
    for (let i = 0; i < 4; i++) {
      a = stepGroundAnchor(a, { grounded: true, knocked: false, x: 10, y: 10, dt: 0.25 });
    }
    const b = stepGroundAnchor(a0, { grounded: true, knocked: false, x: 10, y: 10, dt: 1 });
    expect(a).toEqual(b);
  });
});

describe('遺留品の箇所管理', () => {
  it('上限まではそのまま残り、上限を超えると最も古い箇所が消える対象になる', () => {
    const s1 = ['a'];
    const s2 = ['b', 'c'];
    const s3 = ['d'];
    let sites: string[][] = [];
    let r = addRemainsSite(sites, s1);
    sites = r.sites;
    expect(r.evicted).toEqual([]);
    r = addRemainsSite(sites, s2);
    sites = r.sites;
    expect(sites).toEqual([s1, s2]);
    expect(r.evicted).toEqual([]);
    r = addRemainsSite(sites, s3);
    expect(r.sites).toEqual([s2, s3]);
    expect(r.evicted).toEqual(['a']);
    expect(r.sites.length).toBe(MAX_REMAINS_SITES);
  });

  it('pruneRemainsSites は実体が残っていない箇所を取り除く', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const c = { id: 'c' };
    const sites = [[a], [b, c]];
    // a は回収済み(present に無い) → 箇所ごと落ちる。b, c が残る箇所は残る
    expect(pruneRemainsSites(sites, [b, c])).toEqual([[b, c]]);
    // 一部だけ残っている箇所は残す(残りはまだ回収できる)
    expect(pruneRemainsSites(sites, [c])).toEqual([[b, c]]);
    // 何も残っていなければ全て落ちる
    expect(pruneRemainsSites(sites, [])).toEqual([]);
  });
});
