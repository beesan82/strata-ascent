import { describe, expect, it } from 'vitest';
import {
  addKillBurst, advanceKillBursts, KILL_FLASH_COLOR, KILL_FX, KILL_GRAVITY, killFlash, killFragments,
  killKey, killRing, killShake, MAX_KILL_BURSTS, type KillBurst, type KillKind,
} from './killFx';
import { PIXEL_PALETTE } from './palette';

const KINDS: KillKind[] = ['walker', 'flyer', 'turret', 'boss'];
const KEY = killKey('w:12,34', 5.5);

describe('killKey', () => {
  it('同じ ID・同じ時刻なら同じキー(決定論)', () => {
    expect(killKey('w:12,34', 5.5)).toBe(killKey('w:12,34', 5.5));
  });

  it('同じフレーム内の時刻は同じキー、ID や時刻が違えば変わる', () => {
    expect(killKey('w:12,34', 1.0)).toBe(killKey('w:12,34', 1.0 + 0.001));
    expect(killKey('w:12,34', 1.0)).not.toBe(killKey('w:12,35', 1.0));
    expect(killKey('w:12,34', 1.0)).not.toBe(killKey('w:12,34', 2.0));
  });

  it('非負の 31 bit 整数', () => {
    for (const id of ['w:0,0', 'f:-5,9', 't:100,-200', 'boss:3']) {
      const k = killKey(id, 12.34);
      expect(Number.isInteger(k)).toBe(true);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(2 ** 31);
    }
  });
});

describe('KILL_FX', () => {
  it('色はすべてパレット実在色', () => {
    for (const kind of KINDS) {
      for (const c of KILL_FX[kind].colors) expect(PIXEL_PALETTE).toContain(c);
      expect(PIXEL_PALETTE).toContain(KILL_FX[kind].ringColor);
    }
    expect(PIXEL_PALETTE).toContain(KILL_FLASH_COLOR);
  });

  it('歩行敵・ドローン・砲台で色の組と量が違う', () => {
    const sig = (k: KillKind) => `${KILL_FX[k].colors.join()}|${KILL_FX[k].count}`;
    expect(new Set([sig('walker'), sig('flyer'), sig('turret')]).size).toBe(3);
  });

  it('ボスは破片・閃光・輪が通常敵より大きく、シェイクを持つ', () => {
    for (const k of ['walker', 'flyer', 'turret'] as const) {
      expect(KILL_FX.boss.count).toBeGreaterThan(KILL_FX[k].count);
      expect(KILL_FX.boss.sizeMax).toBeGreaterThan(KILL_FX[k].sizeMax);
      expect(KILL_FX.boss.flashSize).toBeGreaterThan(KILL_FX[k].flashSize);
      expect(KILL_FX.boss.ringR1).toBeGreaterThan(KILL_FX[k].ringR1);
      expect(KILL_FX[k].shakePx).toBe(0);
    }
    expect(KILL_FX.boss.shakePx).toBeGreaterThan(0);
  });

  it('閃光と輪はバーストの寿命の内に収まる', () => {
    for (const kind of KINDS) {
      const s = KILL_FX[kind];
      expect(s.flashTtl).toBeLessThan(s.ttl);
      expect(s.ringTtl).toBeLessThan(s.ttl);
      expect(s.shakeTtl).toBeLessThanOrEqual(s.ttl);
    }
  });
});

describe('killFragments', () => {
  it('寿命の外は空、内は種別の数だけ出る', () => {
    for (const kind of KINDS) {
      expect(killFragments(kind, KEY, -0.01)).toEqual([]);
      expect(killFragments(kind, KEY, KILL_FX[kind].ttl + 0.01)).toEqual([]);
      expect(killFragments(kind, KEY, 0.1)).toHaveLength(KILL_FX[kind].count);
    }
  });

  it('決定論: 同じ入力で同じ結果', () => {
    expect(killFragments('walker', KEY, 0.2)).toEqual(killFragments('walker', KEY, 0.2));
  });

  it('キーが違えば配置が変わる', () => {
    const a = killFragments('walker', KEY, 0.2).map((f) => f.dx);
    const b = killFragments('walker', KEY + 1, 0.2).map((f) => f.dx);
    expect(a).not.toEqual(b);
  });

  it('発生の瞬間は中心にあり、色は種別のパレット', () => {
    for (const kind of KINDS) {
      for (const f of killFragments(kind, KEY, 0)) {
        // 負の初速 × 0 は -0 になるので絶対値で見る
        expect(Math.abs(f.dx)).toBe(0);
        expect(Math.abs(f.dy)).toBe(0);
        expect(KILL_FX[kind].colors).toContain(f.color);
        expect(f.alpha).toBe(1);
      }
    }
  });

  it('飛び散る: 序盤に中心から離れていく(平均距離が増える)', () => {
    for (const kind of KINDS) {
      const mean = (age: number) => {
        const fr = killFragments(kind, KEY, age);
        return fr.reduce((acc, f) => acc + Math.hypot(f.dx, f.dy), 0) / fr.length;
      };
      expect(mean(0.15)).toBeGreaterThan(mean(0.05));
    }
  });

  it('重力で落ちる: 縦の加速度が KILL_GRAVITY', () => {
    const h = 0.05;
    const t = 0.2;
    const a = killFragments('walker', KEY, t - h);
    const b = killFragments('walker', KEY, t);
    const c = killFragments('walker', KEY, t + h);
    for (let i = 0; i < b.length; i++) {
      const acc = (a[i].dy - 2 * b[i].dy + c[i].dy) / (h * h);
      expect(acc).toBeCloseTo(KILL_GRAVITY, 6);
      // 横は等速(加速度 0)
      expect((a[i].dx - 2 * b[i].dx + c[i].dx) / (h * h)).toBeCloseTo(0, 6);
    }
  });

  it('寿命の終わりには全破片が落ちる向きに動いている(上へ飛んだ破片も折り返す)', () => {
    const h = 0.02;
    for (const kind of KINDS) {
      const ttl = KILL_FX[kind].ttl;
      const a = killFragments(kind, KEY, ttl - h);
      const b = killFragments(kind, KEY, ttl);
      for (let i = 0; i < a.length; i++) expect(b[i].dy).toBeGreaterThan(a[i].dy);
    }
  });

  it('縮む: 一辺は経過とともに単調に小さくなり、終わりに 25% まで', () => {
    const s0 = killFragments('flyer', KEY, 0);
    const s1 = killFragments('flyer', KEY, 0.2);
    const s2 = killFragments('flyer', KEY, KILL_FX.flyer.ttl);
    for (let i = 0; i < s0.length; i++) {
      expect(s1[i].size).toBeLessThan(s0[i].size);
      expect(s2[i].size).toBeCloseTo(s0[i].size * 0.25, 9);
      expect(s0[i].size).toBeGreaterThanOrEqual(KILL_FX.flyer.sizeMin);
      expect(s0[i].size).toBeLessThanOrEqual(KILL_FX.flyer.sizeMax);
    }
  });

  it('寿命の前半 60% は不透明、後半で 0 へ薄れる', () => {
    const ttl = KILL_FX.walker.ttl;
    expect(killFragments('walker', KEY, ttl * 0.5)[0].alpha).toBe(1);
    expect(killFragments('walker', KEY, ttl * 0.8)[0].alpha).toBeCloseTo(0.5, 9);
    expect(killFragments('walker', KEY, ttl)[0].alpha).toBeCloseTo(0, 9);
  });

  it('向きは左右どちらへも散る', () => {
    const fr = killFragments('boss', KEY, 0.1);
    expect(fr.some((f) => f.dx < 0)).toBe(true);
    expect(fr.some((f) => f.dx > 0)).toBe(true);
  });
});

describe('killFlash', () => {
  it('寿命の内だけ出て、縮みながら線形に薄れる', () => {
    for (const kind of KINDS) {
      const s = KILL_FX[kind];
      expect(killFlash(kind, -0.01)).toBeNull();
      expect(killFlash(kind, s.flashTtl + 0.001)).toBeNull();
      expect(killFlash(kind, 0)).toEqual({ size: s.flashSize, alpha: 1 });
      const mid = killFlash(kind, s.flashTtl / 2)!;
      expect(mid.alpha).toBeCloseTo(0.5, 9);
      expect(mid.size).toBeCloseTo(s.flashSize * 0.8, 9);
    }
  });
});

describe('killRing', () => {
  it('寿命の内だけ出て、半径は始点から終点へ単調に広がる', () => {
    for (const kind of KINDS) {
      const s = KILL_FX[kind];
      expect(killRing(kind, KEY, -0.01)).toBeNull();
      expect(killRing(kind, KEY, s.ringTtl + 0.001)).toBeNull();
      expect(killRing(kind, KEY, 0)!.radius).toBeCloseTo(s.ringR0, 9);
      expect(killRing(kind, KEY, s.ringTtl)!.radius).toBeCloseTo(s.ringR1, 9);
      let prev = -Infinity;
      for (let i = 0; i <= 10; i++) {
        const r = killRing(kind, KEY, Math.min(s.ringTtl, (s.ringTtl * i) / 10))!.radius;
        expect(r).toBeGreaterThan(prev);
        prev = r;
      }
    }
  });

  it('輪の矩形は指定の数で、すべて半径上に並ぶ', () => {
    const r = killRing('boss', KEY, 0.1)!;
    expect(r.points).toHaveLength(KILL_FX.boss.ringSegs);
    for (const p of r.points) expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(r.radius, 9);
    expect(r.color).toBe(KILL_FX.boss.ringColor);
    expect(r.thick).toBe(KILL_FX.boss.ringThick);
  });

  it('線形に薄れる', () => {
    expect(killRing('walker', KEY, 0)!.alpha).toBe(1);
    expect(killRing('walker', KEY, KILL_FX.walker.ringTtl / 2)!.alpha).toBeCloseTo(0.5, 9);
  });

  it('決定論', () => {
    expect(killRing('turret', KEY, 0.1)).toEqual(killRing('turret', KEY, 0.1));
  });
});

describe('killShake', () => {
  it('通常敵は揺らさない', () => {
    for (const kind of ['walker', 'flyer', 'turret'] as const) {
      for (const age of [0, 0.05, 0.2]) expect(killShake(kind, KEY, age)).toEqual({ x: 0, y: 0 });
    }
  });

  it('ボスは寿命の内だけ、振幅以内の整数 px で揺らす', () => {
    const s = KILL_FX.boss;
    let moved = false;
    for (let i = 0; i <= 20; i++) {
      const age = Math.min(s.shakeTtl, (s.shakeTtl * i) / 20);
      const v = killShake('boss', KEY, age);
      expect(Number.isInteger(v.x)).toBe(true);
      expect(Number.isInteger(v.y)).toBe(true);
      expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(s.shakePx + 1);
      if (v.x !== 0 || v.y !== 0) moved = true;
    }
    expect(moved).toBe(true);
    expect(killShake('boss', KEY, s.shakeTtl + 0.01)).toEqual({ x: 0, y: 0 });
    expect(killShake('boss', KEY, s.shakeTtl)).toEqual({ x: 0, y: 0 });
  });

  it('決定論', () => {
    expect(killShake('boss', KEY, 0.1)).toEqual(killShake('boss', KEY, 0.1));
  });
});

describe('addKillBurst / advanceKillBursts', () => {
  const burst = (kind: KillKind, age = 0, x = 0): KillBurst => ({ x, y: 0, kind, key: 1, age });

  it('追加は元の配列を変えず、上限を超えたら古い順に捨てる', () => {
    let list: KillBurst[] = [];
    for (let i = 0; i < MAX_KILL_BURSTS + 3; i++) {
      const before = list;
      list = addKillBurst(list, burst('walker', 0, i));
      expect(before).not.toBe(list);
    }
    expect(list).toHaveLength(MAX_KILL_BURSTS);
    expect(list[0].x).toBe(3);
    expect(list[list.length - 1].x).toBe(MAX_KILL_BURSTS + 2);
  });

  it('経過秒を進め、元の配列と要素は変えない', () => {
    const a = burst('walker', 0.1);
    const out = advanceKillBursts([a], 0.05);
    expect(out[0].age).toBeCloseTo(0.15, 9);
    expect(a.age).toBe(0.1);
  });

  it('種別の寿命を過ぎたものだけ捨てる(ボスは長く残る)', () => {
    const list = [burst('walker', 0.58), burst('boss', 0.58)];
    const out = advanceKillBursts(list, 0.05);
    expect(out.map((b) => b.kind)).toEqual(['boss']);
    expect(advanceKillBursts(out, 0.5)).toEqual([]);
  });

  it('寿命ちょうどまでは残す(最後のフレームも描く)', () => {
    expect(advanceKillBursts([burst('flyer', KILL_FX.flyer.ttl)], 0)).toHaveLength(1);
    expect(advanceKillBursts([burst('flyer', KILL_FX.flyer.ttl)], 0.001)).toHaveLength(0);
  });
});
