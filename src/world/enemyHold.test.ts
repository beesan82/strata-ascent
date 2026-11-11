import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from './tiles';
import { canonicalRun } from './infra';
import {
  chooseSpawns,
  chooseTurretSpawns,
  ENEMY_HOLD_RADIUS,
  findFloorRuns,
  newTurretSpawns,
  newWalkerSpawns,
  retainEnemies,
  type HeldEnemy,
} from './spawn';

/**
 * 歩行敵・固定砲台の出現安定化(設計 2026-11-11-enemy-stability)。main.ts の refreshEnemies と同じ手順
 * (窓 ±40 × ±24 の床ラン走査 → canonicalRun で正規化 → 選定 → 保持 → 新規出現)を純粋関数だけで再現して固定する。
 */

/** 16 行ごとに床。床は長さ 50 のランが 4 タイルの穴を挟んで並ぶ(ランの左端は 54 の倍数) */
const RUN_PERIOD = 54;
const RUN_LEN = 50;
const floors = (tx: number, ty: number): Tile => {
  if (ty % 16 !== 0) return TILE.AIR;
  return ((tx % RUN_PERIOD) + RUN_PERIOD) % RUN_PERIOD < RUN_LEN ? TILE.SOLID : TILE.AIR;
};

const SCAN_X = 40;
const SCAN_Y = 24;
/** 出現率が上限に達している層(2.19 で上限 0.7 → 0.35、第 8 層から上限) */
const LAYER = 10;
const SEEDS = [1, 42, 55, 20260711];

const held = (spawnId: string, x: number, y: number): HeldEnemy => ({ spawnId, anchor: { x, y } });

/** プレイヤー位置 (px, py) を中心にした窓の床ラン(正規化前) */
function rawRunsAt(px: number, py: number) {
  return findFloorRuns(floors, px - SCAN_X, py - SCAN_Y, px + SCAN_X, py + SCAN_Y);
}

/** refreshEnemies と同じ正規化済みの床ラン */
function canonRunsAt(px: number, py: number) {
  return rawRunsAt(px, py).map((r) => canonicalRun(floors, r, px - SCAN_X, px + SCAN_X));
}

/** 窓での歩行敵と砲台の選定(砲台は電力区、occupied は歩行敵の選定) */
function desiredAt(seed: number, px: number, py: number) {
  const canon = canonRunsAt(px, py);
  const walkers = chooseSpawns(seed, LAYER, canon, []);
  const turrets = chooseTurretSpawns(seed, LAYER, canon, [], 'power', [], walkers.map((d) => ({ x: d.x, y: d.y })));
  return { walkers, turrets };
}

interface Field {
  walkers: HeldEnemy[];
  turrets: HeldEnemy[];
}

/** refreshEnemies の歩行敵・砲台の部分と同じ 1 回ぶんの更新 */
function refresh(seed: number, field: Field, px: number, py: number): Field {
  const desired = desiredAt(seed, px, py);
  const keptW = retainEnemies(field.walkers, new Set(desired.walkers.map((d) => d.id)), px, py);
  const keptT = retainEnemies(field.turrets, new Set(desired.turrets.map((d) => d.id)), px, py);
  const walkers = [...keptW, ...newWalkerSpawns(desired.walkers, keptW, keptT).map((d) => held(d.id, d.x, d.y))];
  const turrets = [...keptT, ...newTurretSpawns(desired.turrets, keptT, walkers).map((d) => held(d.id, d.x, d.y))];
  return { walkers, turrets };
}

describe('床ランの正規化(敵選定に canonicalRun を適用)', () => {
  it('前提: 正規化しないと、窓端で切れたランは窓の位置で長さ(= ラン内オフセット)が変わる(真因の再現)', () => {
    const lens = new Map<string, Set<number>>();
    for (let px = 100; px <= 160; px++) {
      for (const r of rawRunsAt(px, 100)) {
        const key = `${r.x},${r.floorY}`;
        if (!lens.has(key)) lens.set(key, new Set());
        lens.get(key)!.add(r.len);
      }
    }
    expect([...lens.values()].some((s) => s.size > 1)).toBe(true);
  });

  it('正規化したランは窓の位置によらず本来の左端と長さになる', () => {
    for (let px = 100; px <= 160; px++) {
      for (const py of [99, 100, 101, 108]) {
        const canon = canonRunsAt(px, py);
        expect(canon.length).toBeGreaterThan(0);
        for (const r of canon) {
          expect(((r.x % RUN_PERIOD) + RUN_PERIOD) % RUN_PERIOD).toBe(0);
          expect(r.len).toBe(RUN_LEN);
        }
      }
    }
  });

  it('窓端のランから決まる歩行敵・砲台のスポーン ID と位置が、窓の位置で変わらない', () => {
    for (const seed of SEEDS) {
      const seen = new Map<string, { x: number; y: number }>();
      let fromEdge = 0;
      for (let px = 100; px <= 200; px++) {
        const py = 100 + (px % 3) - 1;
        // 正規化で延びた(= 窓の端で切れていた)ランを数え、検査が窓端のランを含むことを確かめる
        const raw = rawRunsAt(px, py);
        const extended = new Set(
          raw
            .map((r) => canonicalRun(floors, r, px - SCAN_X, px + SCAN_X))
            .filter((c, i) => c !== raw[i])
            .map((c) => `${c.x},${c.floorY}`),
        );
        const { walkers, turrets } = desiredAt(seed, px, py);
        for (const s of [...walkers, ...turrets]) {
          const prev = seen.get(s.id);
          if (prev) expect({ x: s.x, y: s.y }).toEqual(prev);
          else seen.set(s.id, { x: s.x, y: s.y });
          // ID の左端は本来のランの左端(54 の倍数)
          const runX = Number(s.id.slice(2).split(',')[0]);
          expect(((runX % RUN_PERIOD) + RUN_PERIOD) % RUN_PERIOD).toBe(0);
          if (extended.has(s.id.slice(2))) fromEdge++;
        }
      }
      expect(seen.size).toBeGreaterThan(0);
      expect(fromEdge).toBeGreaterThan(0);
    }
  });
});

describe('歩行敵・固定砲台の粘着保持(retainEnemies / newWalkerSpawns / newTurretSpawns)', () => {
  it('窓をずらしても、保持半径内の既存個体は消えない(同じ実体のまま残る)', () => {
    let exercised = false;
    for (const seed of SEEDS) {
      let field = refresh(seed, { walkers: [], turrets: [] }, 100, 100);
      expect(field.walkers.length + field.turrets.length).toBeGreaterThan(0);
      // 右へ 1 タイルずつ、縦にも少し揺らしながら歩く(30 フレームごとの再走査を想定)
      for (let step = 1; step <= 60; step++) {
        const px = 100 + step;
        const py = 100 + (step % 3) - 1;
        const desired = desiredAt(seed, px, py);
        const desiredIds = new Set([...desired.walkers, ...desired.turrets].map((d) => d.id));
        const next = refresh(seed, field, px, py);
        for (const e of [...field.walkers, ...field.turrets]) {
          const inRadius = Math.max(Math.abs(e.anchor.x - px), Math.abs(e.anchor.y - py)) <= ENEMY_HOLD_RADIUS;
          if (!inRadius) continue;
          expect([...next.walkers, ...next.turrets]).toContain(e);
          // 選定から外れたのに保持で残った個体がある(保持が実際に効いた場面を含む)
          if (!desiredIds.has(e.spawnId)) exercised = true;
        }
        field = next;
      }
    }
    expect(exercised).toBe(true);
  });

  it('保持と新規出現を繰り返しても、密度上限(24×12)と砲台・歩行敵の近接除外(3)は破られない', () => {
    for (const seed of SEEDS) {
      let field = refresh(seed, { walkers: [], turrets: [] }, 100, 100);
      for (let step = 1; step <= 60; step++) {
        field = refresh(seed, field, 100 + step * 2, 100 + Math.floor(step / 3));
        for (const list of [field.walkers, field.turrets]) {
          for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
              const a = list[i].anchor;
              const b = list[j].anchor;
              expect(Math.abs(a.x - b.x) < 24 && Math.abs(a.y - b.y) < 12).toBe(false);
            }
          }
          expect(new Set(list.map((e) => e.spawnId)).size).toBe(list.length);
        }
        for (const t of field.turrets) {
          for (const w of field.walkers) {
            expect(Math.max(Math.abs(t.anchor.x - w.anchor.x), Math.abs(t.anchor.y - w.anchor.y)) <= 3).toBe(false);
          }
        }
      }
    }
  });

  it('アンカーが保持半径(チェビシェフ 64)の外に出た個体だけを捨てる', () => {
    const inside = held('w:a', 64, -64);
    const edge = held('w:b', -64, 10);
    const outX = held('w:c', 64.5, 0);
    const outY = held('t:d', 0, -65);
    expect(retainEnemies([inside, edge, outX, outY], new Set(), 0, 0)).toEqual([inside, edge]);
  });

  it('今回の選定に入っている個体は距離によらず残す', () => {
    const far = held('w:far', 500, 500);
    expect(retainEnemies([far], new Set(['w:far']), 0, 0)).toEqual([far]);
  });

  it('地区ゲートが閉じた(砲台の選定が空)ときも保持半径内の砲台は残り、外の砲台だけが消える', () => {
    const near = held('t:near', 10, 5);
    const far = held('t:far', 100, 0);
    expect(retainEnemies([near, far], new Set(), 0, 0)).toEqual([near]);
  });

  it('歩行敵の新規出現: 既存 ID、保持歩行敵の 24×12 の内側、保持砲台の 3 タイル以内は湧かせない', () => {
    // 境界の比較が浮動小数の丸めに左右されないよう、座標は整数で置く
    const keptW = [held('w:0,10', 2, 9), held('w:old', 100, 100)];
    const keptT = [held('t:t', 300, 300)];
    const desired = [
      { id: 'w:0,10', x: 2, y: 9, dir: 1 as const }, // 既に実体がある
      { id: 'w:near', x: 100 + 23, y: 100 - 11, dir: 1 as const }, // 保持歩行敵の 24×12 の内側
      { id: 'w:edge', x: 100 + 24, y: 100, dir: 1 as const }, // 横 24 ちょうどは近接ではない(chooseSpawns と同じ境界)
      { id: 'w:turret', x: 303, y: 300, dir: 1 as const }, // 保持砲台からチェビシェフ 3
      { id: 'w:turret4', x: 304, y: 300, dir: 1 as const }, // 4 離れれば湧く
      { id: 'w:free', x: 500, y: 500, dir: -1 as const },
    ];
    expect(newWalkerSpawns(desired, keptW, keptT).map((d) => d.id)).toEqual(['w:edge', 'w:turret4', 'w:free']);
  });

  it('砲台の新規出現: 既存 ID、保持砲台の 24×12 の内側、場の歩行敵の 3 タイル以内は湧かせない', () => {
    const keptT = [held('t:0,10', 2, 9), held('t:old', 100, 100)];
    const walkers = [held('w:w', 300, 300)];
    const desired = [
      { id: 't:0,10', x: 2, y: 9 }, // 既に実体がある
      { id: 't:near', x: 100 - 23, y: 100 + 11 }, // 保持砲台の 24×12 の内側
      { id: 't:edge', x: 100, y: 100 + 12 }, // 縦 12 ちょうどは近接ではない
      { id: 't:walker', x: 297, y: 303 }, // 歩行敵からチェビシェフ 3
      { id: 't:free', x: 500, y: 500 },
    ];
    expect(newTurretSpawns(desired, keptT, walkers).map((d) => d.id)).toEqual(['t:edge', 't:free']);
  });

  it('保持個体が無ければ選定がそのまま新規出現になる(従来どおり)', () => {
    const { walkers, turrets } = desiredAt(55, 100, 100);
    expect(newWalkerSpawns(walkers, [], [])).toEqual(walkers);
    expect(newTurretSpawns(turrets, [], [])).toEqual(turrets);
  });
});
