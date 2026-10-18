import { describe, expect, it } from 'vitest';
import { nextBakeTask, type BakeScheduleInput } from './bakeSchedule';

const key = (cx: number, cy: number) => `${cx},${cy}`;

function input(baked: Set<string>, generated: Set<string>, over: Partial<BakeScheduleInput> = {}): BakeScheduleInput {
  return {
    cx0: 0, cx1: 0, cy0: 0, cy1: 0,
    centerCx: 0, centerCy: 0, keepRadius: 2,
    isBaked: (cx, cy) => baked.has(key(cx, cy)),
    isGenerated: (cx, cy) => generated.has(key(cx, cy)),
    ...over,
  };
}

function all(r: number): Set<string> {
  const s = new Set<string>();
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) s.add(key(x, y));
  return s;
}

describe('nextBakeTask', () => {
  it('可視範囲と周囲1チャンクがすべて焼き込み済みなら何もしない', () => {
    expect(nextBakeTask(input(all(1), all(2)))).toBeNull();
  });

  it('焼き込み前に、そのチャンクと隣接8チャンクのデータ生成を1つずつ要求する', () => {
    const baked = all(1);
    baked.delete(key(1, 0));
    const generated = all(1); // (2,*) が未生成
    const task = nextBakeTask(input(baked, generated));
    expect(task?.kind).toBe('generate');
    expect(task!.cx).toBe(2);
  });

  it('データが揃えば焼き込みを要求する', () => {
    const baked = all(1);
    baked.delete(key(1, 0));
    expect(nextBakeTask(input(baked, all(2)))).toEqual({ kind: 'bake', cx: 1, cy: 0 });
  });

  it('可視チャンク(無効化で再焼き込み待ち)を周囲の先読みより優先する', () => {
    const baked = all(1);
    baked.delete(key(0, 0));  // 可視
    baked.delete(key(-1, 1)); // 先読み
    expect(nextBakeTask(input(baked, all(2)))).toEqual({ kind: 'bake', cx: 0, cy: 0 });
  });

  it('保持半径の外は先読みしない(退避と生成の往復を防ぐ)', () => {
    // 可視範囲が中心から右へ2チャンクずれている → 先読み候補 x=3 は半径2の外
    const over = { cx0: 2, cx1: 2, cy0: 0, cy1: 0 };
    const baked = new Set([key(2, 0), key(1, -1), key(1, 0), key(1, 1), key(2, -1), key(2, 1)]);
    expect(nextBakeTask(input(baked, all(4), over))).toBeNull();
  });

  it('データが揃っても装飾が未準備なら、焼き込みの前に装飾の準備を要求する', () => {
    const baked = all(1);
    baked.delete(key(1, 0));
    const task = nextBakeTask(input(baked, all(2), { isDecorReady: (cx, cy) => !(cx === 1 && cy === 0) }));
    expect(task).toEqual({ kind: 'decor', cx: 1, cy: 0 });
  });

  it('装飾が準備済みなら焼き込みを要求する', () => {
    const baked = all(1);
    baked.delete(key(1, 0));
    expect(nextBakeTask(input(baked, all(2), { isDecorReady: () => true }))).toEqual({ kind: 'bake', cx: 1, cy: 0 });
  });
});
