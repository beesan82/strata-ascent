import { describe, expect, it } from 'vitest';
import { TILE } from '../world/tiles';
import { tileAt } from '../world/worldgen';
import { biomeCellAt, biomeIdForCell } from '../world/biomeCells';
import { grandShaftBounds, grandShaftsNear } from '../world/grandShaft';
import { VISUAL_BIOME } from './biome';
import {
  decorateChunk, processionStartAt, processionsInRect, remnantKindWith, sceneryGuarded,
  sceneryProfileFor, signalLampsInRect, siloCovering, SCENERY_COLORS,
  LAMP_BLACKOUT_RATE, LAMP_PERIOD_SEC, PILLAR_COLORS, PROCESSION_MAX, PROCESSION_MAX_LEN,
  type Procession,
} from './decor';

const SEED = 20260711;
const tileGet = (x: number, y: number): number => tileAt(SEED, x, y);
const PROF = sceneryProfileFor('habitation');

/** 合成世界: 床の行 20(その下も固体)、上は全部空気 */
const flatWorld = (_x: number, y: number): number => (y >= 20 ? TILE.SOLID : TILE.AIR);

function findSyntheticProcession(): { seed: number; p: Procession } | null {
  for (let seed = 1; seed <= 400; seed++) {
    for (let s = -10; s <= 10; s++) {
      const p = processionStartAt(flatWorld, seed, s, 20, PROF);
      if (p) return { seed, p };
    }
  }
  return null;
}

describe('残されたもの: 行列', () => {
  it('合成世界で起点が見つかる', () => {
    expect(findSyntheticProcession()).not.toBeNull();
  });

  it('部材は 3〜6 体で、先頭だけ head、全長は 32 以内、間隔は 4〜6', () => {
    const found = findSyntheticProcession();
    expect(found).not.toBeNull();
    const { p } = found!;
    expect(p.members.length).toBeGreaterThanOrEqual(3);
    expect(p.members.length).toBeLessThanOrEqual(6);
    expect(p.members.filter((m) => m.head)).toHaveLength(1);
    expect(p.members[0].head).toBe(true);
    expect(p.x1 - p.x0).toBeLessThanOrEqual(PROCESSION_MAX_LEN + 4.8);
    for (let k = 1; k < p.members.length; k++) {
      const pitch = Math.abs(p.members[k].x - p.members[k - 1].x);
      expect(pitch).toBeGreaterThanOrEqual(4);
      expect(pitch).toBeLessThanOrEqual(6);
    }
    // 向き: 左向きなら先頭が左端、右向きなら先頭が右端
    if (p.flip) expect(p.members[0].x).toBe(Math.min(...p.members.map((m) => m.x)));
    else expect(p.members[0].x).toBe(Math.max(...p.members.map((m) => m.x)));
  });

  it('決定論: 同じ引数は同じ行列を返す', () => {
    const found = findSyntheticProcession();
    expect(found).not.toBeNull();
    const again = processionStartAt(flatWorld, found!.seed, found!.p.seg, 20, PROF);
    expect(again).toEqual(found!.p);
  });

  it('起点セグメントに既存の残滓がある場合は置かない(実世界で全数確認)', () => {
    let starts = 0;
    for (let wy = 40; wy <= 400; wy += 3) {
      for (let s = -30; s <= 30; s++) {
        const p = processionStartAt(tileGet, SEED, s, wy, PROF);
        if (!p) continue;
        starts++;
        expect(remnantKindWith(tileGet, SEED, s, wy, PROF)).toBe(-1);
        // 後続のセグメントにも残滓が無い(途絶の規則)
        for (const m of p.members.slice(1)) {
          const mSeg = Math.floor((m.x + 2.4) / 16);
          if (mSeg !== s) expect(remnantKindWith(tileGet, SEED, mSeg, wy, PROF)).toBe(-1);
        }
      }
    }
    expect(starts).toBeGreaterThan(0);
  });

  it('実世界での起点の割合は上限以下で、ゼロではない', () => {
    let floors = 0;
    let starts = 0;
    for (let wy = 40; wy <= 760; wy += 2) {
      for (let s = -40; s <= 40; s++) {
        if (remnantKindWith(tileGet, SEED, s, wy, PROF) !== -1) continue;
        // 床セグメントかどうかは processionStartAt の内部判定に任せ、分母は「残滓の無い床」
        // の近似として、起点にならなかったものも含めて数える代わりに、率の上限だけを見る
        floors++;
        if (processionStartAt(tileGet, SEED, s, wy, PROF)) starts++;
      }
    }
    expect(starts).toBeGreaterThan(0);
    expect(starts / Math.max(1, floors)).toBeLessThanOrEqual(PROCESSION_MAX);
  });

  it('processionsInRect は矩形に掛かる行列だけを返し、起点と一致する', () => {
    const list = processionsInRect(tileGet, SEED, -320, 320, 40, 400);
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      expect(p.x1).toBeGreaterThanOrEqual(-320);
      expect(p.x0).toBeLessThanOrEqual(320);
      const prof = sceneryProfileFor('habitation');
      expect(processionStartAt(tileGet, SEED, p.seg, p.wy, prof)).toEqual(p);
    }
  });

  it('標識灯は先頭の上に付き、位相と点かない割合が仕様の範囲', () => {
    const list = processionsInRect(tileGet, SEED, -480, 480, 40, 700);
    expect(list.length).toBeGreaterThan(0);
    const lamps = signalLampsInRect(SEED, -480, 480, 40, 700);
    expect(lamps.length).toBeGreaterThanOrEqual(list.length);
    for (const p of list) {
      const lamp = lamps.find((l) => l.x === p.lampX && l.y === p.lampY);
      expect(lamp).toBeDefined();
      expect(lamp!.phase).toBeGreaterThanOrEqual(0);
      expect(lamp!.phase).toBeLessThan(LAMP_PERIOD_SEC);
    }
    // 点かない割合は広い範囲で数える(狭い範囲では標本が少なく分散が大きい)
    const wide = signalLampsInRect(SEED, -960, 960, 40, 2600);
    expect(wide.length).toBeGreaterThan(20);
    const dead = wide.filter((l) => l.dead).length / wide.length;
    expect(dead).toBeGreaterThan(LAMP_BLACKOUT_RATE * 0.3);
    expect(dead).toBeLessThan(LAMP_BLACKOUT_RATE * 2.2);
    // 決定論
    expect(signalLampsInRect(SEED, -480, 480, 40, 700)).toEqual(lamps);
  });

  it('部材のセグメントはすべて床でそろっている(実世界の不変条件)', () => {
    const list = processionsInRect(tileGet, SEED, -320, 320, 40, 700);
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      for (const m of p.members) {
        const mSeg = Math.floor((m.x + 2.4) / 16);
        for (let i = 0; i < 16; i++) {
          expect(tileGet(mSeg * 16 + i, p.wy)).toBe(TILE.SOLID);
          expect(tileGet(mSeg * 16 + i, p.wy - 1)).not.toBe(TILE.SOLID);
        }
      }
    }
  });

  it('行列のあるチャンクでは残骸の色のポリゴンが焼き込まれる', () => {
    const list = processionsInRect(tileGet, SEED, -320, 320, 40, 700);
    expect(list.length).toBeGreaterThan(0);
    const p = list[0];
    const cx = Math.floor(p.members[0].x / 64);
    const cy = Math.floor(p.wy / 64);
    const ops = decorateChunk(SEED, cx, cy);
    // 先頭の座り込み(wreckOps)は SCENERY_COLORS.wreck の塗りポリゴンを出す
    expect(ops.some((o) => o.kind === 'poly' && o.color === SCENERY_COLORS.wreck)).toBe(true);
  });

  it('標識灯の色は灯のある地区の accent', () => {
    const lamps = signalLampsInRect(SEED, -480, 480, 40, 700);
    expect(lamps.length).toBeGreaterThan(0);
    for (const l of lamps) {
      const biome = biomeIdForCell(SEED, biomeCellAt(SEED, Math.floor(l.y)));
      expect(l.color).toBe(VISUAL_BIOME[biome].accent);
    }
  });
});

describe('残されたもの: サイロ', () => {
  it('実世界にサイロがあり、幾何が仕様の範囲(幅 12〜20、高さ 14〜28、番号 0〜999)', () => {
    const seen = new Map<string, { w: number; h: number; num: number }>();
    for (let by = -60; by <= 60; by++) {
      for (let bx = -60; bx <= 60; bx++) {
        const s = siloCovering(SEED, bx, by);
        if (s) seen.set(`${s.ax},${s.ay}`, s);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const s of seen.values()) {
      expect(s.w).toBeGreaterThanOrEqual(12);
      expect(s.w).toBeLessThanOrEqual(20);
      expect(s.h).toBeGreaterThanOrEqual(14);
      expect(s.h).toBeLessThanOrEqual(28);
      expect(s.num).toBeGreaterThanOrEqual(0);
      expect(s.num).toBeLessThanOrEqual(999);
    }
  });

  it('siloCovering は決定論で、覆うブロックからは同じサイロが見える', () => {
    let found: { bx: number; by: number } | null = null;
    outer: for (let by = -40; by <= 40 && !found; by++) {
      for (let bx = -40; bx <= 40; bx++) {
        if (siloCovering(SEED, bx, by)) { found = { bx, by }; break outer; }
      }
    }
    expect(found).not.toBeNull();
    const s1 = siloCovering(SEED, found!.bx, found!.by);
    expect(siloCovering(SEED, found!.bx, found!.by)).toEqual(s1);
    // サイロの矩形が掛かるブロックは、覆うサイロとして何か(このサイロか、先勝ちの別サイロ)を返す
    const midBx = Math.floor((s1!.x + s1!.w / 2) / 8);
    const midBy = Math.floor((s1!.y + s1!.h / 2) / 7);
    expect(siloCovering(SEED, midBx, midBy)).not.toBeNull();
  });

  it('サイロに覆われるブロックの割合は過半にはならない', () => {
    let covered = 0;
    let total = 0;
    for (let by = -30; by <= 30; by++) {
      for (let bx = -30; bx <= 30; bx++) {
        total++;
        if (siloCovering(SEED, bx, by)) covered++;
      }
    }
    expect(covered).toBeGreaterThan(0);
    expect(covered / total).toBeLessThan(0.35);
  });

  it('閉じた壁面のサイロは decorateChunk に焼き込まれる', () => {
    // 矩形の内側がすべて SOLID のサイロを探す
    let target: { cx: number; cy: number; w: number; h: number } | null = null;
    outer: for (let by = -50; by <= 50 && !target; by++) {
      for (let bx = -50; bx <= 50; bx++) {
        const s = siloCovering(SEED, bx, by);
        if (!s) continue;
        let closed = true;
        for (let wy = s.y; wy < s.y + s.h && closed; wy++) {
          for (let wx = s.x; wx < s.x + s.w && closed; wx++) {
            if (tileGet(wx, wy) !== TILE.SOLID) closed = false;
          }
        }
        if (closed) target = { cx: Math.floor(s.x / 64), cy: Math.floor(s.y / 64), w: s.w, h: s.h };
        if (target) break outer;
      }
    }
    expect(target).not.toBeNull();
    const ops = decorateChunk(SEED, target!.cx, target!.cy);
    expect(ops.some((o) => o.kind === 'rect' && o.color === PILLAR_COLORS.face && o.w === target!.w && o.h === target!.h)).toBe(true);
  });
});

describe('残されたもの: 保護範囲の整理(A-2e)', () => {
  it('大昇降機の外形から 2 以内は保護され、十分に離れれば保護されない', () => {
    const shafts = grandShaftsNear(SEED, 0, 0, 20000, 20000);
    expect(shafts.length).toBeGreaterThan(0);
    let proven = false;
    for (const s of shafts) {
      const b = grandShaftBounds(s);
      const midY = Math.floor((b.y0 + b.y1) / 2);
      // 外形の左 1 列(距離 1): 保護されるはず
      if (!sceneryGuarded(SEED, b.x0 - 1, b.x0 - 1, midY, midY)) continue;
      // 外形の左 10 列(距離 10): 大昇降機の規則では保護されない。他の保護(休憩点・開始地点)
      // にも掛からない場所が見つかれば、距離の規則を証明できる
      if (sceneryGuarded(SEED, b.x0 - 10, b.x0 - 10, midY, midY)) continue;
      proven = true;
      break;
    }
    expect(proven).toBe(true);
  });
});
