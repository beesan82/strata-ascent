import { describe, expect, it } from 'vitest';
import {
  ambientDelta, beaconGlowAt, beaconPulse, beaconsInView, glowStrength, interfaceBandsNear, nearestHoleX,
  AMBIENT_IN_POOL, AMBIENT_OUT_POOL, GLOW_MIN, POOL_CORE_RADIUS, POOL_FRINGE_RADIUS, PULSE_AMPLITUDE, PULSE_PERIOD,
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

  it('前室の外縁 40 タイルで 0 へ戻り、前室の上下の外では 0', () => {
    expect(ambientDelta(SEED, px0 + 120, floorY)).not.toBe(0);
    expect(ambientDelta(SEED, px0 + 160, floorY)).toBe(0);
    expect(ambientDelta(SEED, px0 - 160, floorY)).toBe(0);
    expect(ambientDelta(SEED, px0, top0 + 5)).toBe(0);
    expect(ambientDelta(SEED, px0, bottom0 + ANTECHAMBER_DEPTH + 5)).toBe(0);
  });
});
