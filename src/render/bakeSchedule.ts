/**
 * チャンク焼き込みの先読みスケジューラ(純関数)。
 * 1フレームに1仕事だけ返し、歩行中に「生成+焼き込み」が一度に集中して止まるのを防ぐ。
 * 焼き込みは隣接8チャンクのタイルを参照するため、先にそれらのデータ生成を1つずつ要求する。
 */

export interface BakeTask {
  kind: 'generate' | 'bake';
  cx: number;
  cy: number;
}

export interface BakeScheduleInput {
  /** 可視チャンク範囲(両端含む) */
  cx0: number;
  cx1: number;
  cy0: number;
  cy1: number;
  /** 保持半径の中心(プレイヤーのチャンク) */
  centerCx: number;
  centerCy: number;
  /** 焼き込みキャッシュの保持半径(チェビシェフ)。これより外は先読みしない */
  keepRadius: number;
  /** 最新の焼き込み画像があるか(無効化済みで再焼き込み待ちなら false) */
  isBaked: (cx: number, cy: number) => boolean;
  /** タイルデータが生成済みか */
  isGenerated: (cx: number, cy: number) => boolean;
}

/** 次にやるべき仕事。可視チャンクを優先し、次に可視範囲の周囲1チャンクを中心から近い順に。 */
export function nextBakeTask(s: BakeScheduleInput): BakeTask | null {
  for (let cy = s.cy0; cy <= s.cy1; cy++) {
    for (let cx = s.cx0; cx <= s.cx1; cx++) {
      const task = taskFor(s, cx, cy);
      if (task) return task;
    }
  }
  const ring: Array<[number, number, number]> = [];
  for (let cy = s.cy0 - 1; cy <= s.cy1 + 1; cy++) {
    for (let cx = s.cx0 - 1; cx <= s.cx1 + 1; cx++) {
      if (cx >= s.cx0 && cx <= s.cx1 && cy >= s.cy0 && cy <= s.cy1) continue;
      const dist = Math.max(Math.abs(cx - s.centerCx), Math.abs(cy - s.centerCy));
      if (dist > s.keepRadius) continue;
      ring.push([dist, cx, cy]);
    }
  }
  ring.sort((a, b) => a[0] - b[0]);
  for (const [, cx, cy] of ring) {
    const task = taskFor(s, cx, cy);
    if (task) return task;
  }
  return null;
}

function taskFor(s: BakeScheduleInput, cx: number, cy: number): BakeTask | null {
  if (s.isBaked(cx, cy)) return null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!s.isGenerated(cx + dx, cy + dy)) return { kind: 'generate', cx: cx + dx, cy: cy + dy };
    }
  }
  return { kind: 'bake', cx, cy };
}
