import { describe, expect, it } from 'vitest';
import {
  ambientDelta, beaconGlowAt, beaconPulse, beaconsInView, glowStrength, glowStrips, interfaceBandsNear, nearestHoleX,
  AMBIENT_IN_POOL, AMBIENT_OUT_POOL, GLOW_ALPHA, GLOW_ALPHA_STEPS, GLOW_MIN, POOL_CORE_RADIUS, POOL_FRINGE_RADIUS,
  PULSE_AMPLITUDE, PULSE_PERIOD, type GlowStrip,
} from './beacon';
import { ANTECHAMBER_DEPTH, interfaceBottom, interfaceTop, passageX } from '../world/interface';
import { biomeForCell } from './biome';

const SEED = 20260711;
const px0 = passageX(SEED, 0, 0); // 196
const top0 = interfaceTop(SEED, 0); // -9
const bottom0 = interfaceBottom(SEED, 0); // 23

describe('beacon geometry', () => {
  it('最寄りの大穴は孔 +48', () => {
    expect(nearestHoleX(SEED, 0, px0)).toBe(px0 + 48);
    expect(nearestHoleX(SEED, 0, px0 - 100)).toBe(px0 + 48);
  });

  it('光柱は板の下面から前室の床まで(大界面でも 48)', () => {
    const [b] = beaconsInView(SEED, px0 + 48, bottom0 + 20, 100, 100);
    expect(b.x).toBe(px0 + 48);
    expect(b.top).toBe(bottom0);
    expect(b.floor).toBe(bottom0 + ANTECHAMBER_DEPTH);
    const px2 = passageX(SEED, 2, 0);
    const [g] = beaconsInView(SEED, px2 + 48, interfaceBottom(SEED, 2) + 20, 100, 100);
    expect(g.floor - g.top).toBe(48);
  });

  it('色は上の層(cell−1)の accent', () => {
    const [b] = beaconsInView(SEED, px0 + 48, bottom0 + 20, 100, 100);
    expect(b.color).toBe(biomeForCell(SEED, -1).accent);
  });

  it('視野に入らない光柱は返さない、広い視野では複数返す', () => {
    // 孔 k=−1 の大穴は x=−203。その右と k=0 の大穴(244)の間、どちらの裾(±48)にも掛からない位置
    expect(beaconsInView(SEED, 20, bottom0 + 20, 100, 100)).toEqual([]);
    expect(beaconsInView(SEED, px0 + 48, bottom0 + 200, 100, 100)).toEqual([]);
    expect(beaconsInView(SEED, px0, bottom0 + 20, 1200, 100).length).toBeGreaterThanOrEqual(2);
  });

  it('決定論', () => {
    expect(beaconsInView(SEED, 300, 40, 200, 80)).toEqual(beaconsInView(SEED, 300, 40, 200, 80));
  });
});

describe('beaconPulse', () => {
  it('周期 7 秒で 1±0.15', () => {
    expect(PULSE_PERIOD).toBe(7);
    expect(beaconPulse(0)).toBeCloseTo(1);
    expect(beaconPulse(PULSE_PERIOD / 4)).toBeCloseTo(1 + PULSE_AMPLITUDE);
    expect(beaconPulse(PULSE_PERIOD * 0.75)).toBeCloseTo(1 - PULSE_AMPLITUDE);
    expect(beaconPulse(PULSE_PERIOD)).toBeCloseTo(1);
  });
});

describe('glow', () => {
  it('強度は距離 0 で 1、256 で 0.15、以遠は 0.15', () => {
    expect(glowStrength(0)).toBe(1);
    expect(glowStrength(128)).toBeCloseTo((1 + GLOW_MIN) / 2);
    expect(glowStrength(256)).toBeCloseTo(GLOW_MIN);
    expect(glowStrength(-900)).toBeCloseTo(GLOW_MIN);
  });

  it('滲みの中心は今いる層の板の最寄りの大穴。縦坑の中でも同じ板', () => {
    const below = beaconGlowAt(SEED, px0, bottom0 + 10);
    const inShaft = beaconGlowAt(SEED, px0, top0 + 10);
    expect(below.x).toBe(px0 + 48);
    expect(inShaft.x).toBe(below.x);
    expect(below.top).toBe(bottom0);
    expect(below.layerBottom).toBe(interfaceTop(SEED, 1));
    expect(below.strength).toBeCloseTo(glowStrength(-48));
    expect(below.color).toBe(biomeForCell(SEED, -1).accent);
  });

  it('見晴らし台(板の上)では 1 つ上の板の大穴を指す', () => {
    const g = beaconGlowAt(SEED, px0, top0 - 3);
    expect(g.top).toBe(interfaceBottom(SEED, -1));
  });
});

describe('glowStrips', () => {
  // 内部バッファ幅 427 px、ppt 12(ズーム 1)。大穴 244 がカメラの右 60 タイルにある
  const w = 427;
  const ppt = 12;

  it('帯は画面幅を隙間なく覆い、アルファは 1/64 刻み', () => {
    const { strips } = glowStrips(SEED, px0 - 12, bottom0 + 46, w, ppt);
    expect(strips.length).toBeGreaterThanOrEqual(2);
    expect(strips[0].x0).toBe(0);
    expect(strips[strips.length - 1].x1).toBe(w);
    for (let i = 1; i < strips.length; i++) expect(strips[i].x0).toBe(strips[i - 1].x1);
    for (const s of strips) expect(Math.round(s.alpha * GLOW_ALPHA_STEPS)).toBeCloseTo(s.alpha * GLOW_ALPHA_STEPS);
  });

  it('大穴が右にあれば右端の帯ほど明るく、左にあれば逆。画面外なら端同士の比は 1+偏り : 1−偏り に近い', () => {
    const right = glowStrips(SEED, px0 - 12, bottom0 + 46, w, ppt).strips;
    const rL = right[0].alpha;
    const rR = right[right.length - 1].alpha;
    expect(rR).toBeGreaterThan(rL);
    // 距離 60 タイルの減衰差(約 1 割)に偏り(1.6 : 0.4)が掛かるので、比は 3 を超える
    expect(rR / rL).toBeGreaterThan(3);
    const left = glowStrips(SEED, px0 + 120, bottom0 + 46, w, ppt).strips;
    expect(left[0].alpha).toBeGreaterThan(left[left.length - 1].alpha);
  });

  it('歩いても帯の配置は 8 px の格子単位でしか変わらない(空のフィルの塗り直しを抑える)', () => {
    // 大穴が画面外(右 60 タイル)の位置から 0.1 タイル刻みで 10 タイル歩く。parallax 0.9×12 px/タイルで
    // 108 px 進むので、8 px 格子なら配置は高々 14+1 通り。毎フレーム変わるなら 100 通り
    const layouts = new Set<string>();
    for (let i = 0; i <= 100; i++) {
      const { strips } = glowStrips(SEED, px0 - 12 + i * 0.1, bottom0 + 46, w, ppt);
      layouts.add(strips.map((s) => `${s.x0}-${s.x1}:${s.alpha}`).join(','));
    }
    expect(layouts.size).toBeLessThanOrEqual(16);
  });

  it('大穴が画面外でも帯は 12 本以下(量子化キャッシュと塗り直しのため)', () => {
    expect(glowStrips(SEED, px0 - 12, bottom0 + 46, w, ppt).strips.length).toBeLessThanOrEqual(12);
    expect(glowStrips(SEED, 40, bottom0 + 40, w, ppt).strips.length).toBeLessThanOrEqual(12);
  });

  it('大穴が画面中央にあれば偏りは無く、左右の端は同じ明るさ', () => {
    const s = glowStrips(SEED, px0 + 48, bottom0 + 46, w, ppt).strips;
    expect(s[0].alpha).toBeCloseTo(s[s.length - 1].alpha, 2);
  });

  it('色は上の層の accent、層の下へ行くほど弱い', () => {
    const near = glowStrips(SEED, px0 + 48, bottom0 + 10, w, ppt);
    const deep = glowStrips(SEED, px0 + 48, bottom0 + 300, w, ppt);
    expect(near.color).toBe(biomeForCell(SEED, -1).accent);
    const peak = (s: GlowStrip[]) => Math.max(...s.map((x) => x.alpha));
    expect(peak(near.strips)).toBeCloseTo(GLOW_ALPHA, 1);
    expect(peak(deep.strips)).toBeLessThan(peak(near.strips));
  });
});

describe('interfaceBandsNear', () => {
  it('上下 1 画面以内の板だけ', () => {
    const near = interfaceBandsNear(SEED, bottom0 + 10, 20);
    expect(near.map((b) => b.cell)).toEqual([0]);
    expect(near[0]).toEqual({ cell: 0, top: top0, bottom: bottom0 });
    expect(interfaceBandsNear(SEED, bottom0 + 100, 20)).toEqual([]);
    expect(interfaceBandsNear(SEED, bottom0 + 100, 400).length).toBeGreaterThanOrEqual(2);
  });
});

describe('ambientDelta', () => {
  const floorY = bottom0 + ANTECHAMBER_DEPTH - 1;

  it('光溜まりの芯で +0.15、裾の外で −0.1、間は補間', () => {
    const hx = px0 + 48;
    expect(ambientDelta(SEED, hx, floorY)).toBeCloseTo(AMBIENT_IN_POOL);
    expect(ambientDelta(SEED, hx + POOL_CORE_RADIUS, floorY)).toBeCloseTo(AMBIENT_IN_POOL);
    expect(ambientDelta(SEED, hx - POOL_FRINGE_RADIUS, floorY)).toBeCloseTo(AMBIENT_OUT_POOL);
    const mid = ambientDelta(SEED, hx + (POOL_CORE_RADIUS + POOL_FRINGE_RADIUS) / 2, floorY);
    expect(mid).toBeCloseTo((AMBIENT_IN_POOL + AMBIENT_OUT_POOL) / 2);
  });

  it('板の下面から下へ 4 タイルで 0 から立ち上がる(孔を抜けた瞬間に暗幕が跳ばない)', () => {
    const hx = px0 + 48;
    expect(ambientDelta(SEED, hx, bottom0 - 1)).toBe(0);
    expect(ambientDelta(SEED, hx, bottom0)).toBe(0);
    expect(ambientDelta(SEED, hx, bottom0 + 2)).toBeCloseTo(AMBIENT_IN_POOL / 2);
    expect(ambientDelta(SEED, hx, bottom0 + 4)).toBeCloseTo(AMBIENT_IN_POOL);
    expect(ambientDelta(SEED, hx, bottom0 + 10)).toBeCloseTo(AMBIENT_IN_POOL);
  });

  it('前室の外縁 40 タイルで 0 へ戻り、前室の上下の外では 0', () => {
    expect(ambientDelta(SEED, px0 + 120, floorY)).not.toBe(0);
    expect(ambientDelta(SEED, px0 + 160, floorY)).toBe(0);
    expect(ambientDelta(SEED, px0 - 160, floorY)).toBe(0);
    expect(ambientDelta(SEED, px0, top0 + 5)).toBe(0);
    expect(ambientDelta(SEED, px0, bottom0 + ANTECHAMBER_DEPTH + 5)).toBe(0);
  });
});
