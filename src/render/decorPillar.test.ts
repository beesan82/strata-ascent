import { describe, expect, it } from 'vitest';
import { baseTileAt } from '../world/worldgen';
import { pillarDoorAt, pillarsInRect, type Pillar } from '../world/pillar';
import { decorateChunk, PILLAR_COLORS, sceneryGuarded, signalLampsInRect, type SignalLamp } from './decor';

/**
 * 巨柱の装飾(2.21、設計 §A-3): 穴の標識灯・焼き込み(面・リブ・受け光・穴の縁)・
 * 景色の保護範囲を、実在の柱 1 本で確かめる。
 */

const SEED = 20260711;
const CHUNK = 64;

/** 標準シードで、穴が 2 本以上ある最初の柱 */
function pickPillar(): Pillar {
  const list = pillarsInRect(SEED, -1200, 1200, -1600, 1600, (x, y) => baseTileAt(SEED, x, y));
  for (const p of list) {
    if (p.doors.length >= 2) return p;
  }
  throw new Error('テストに使える柱(穴 2 本以上)が見つからない');
}

const P = pickPillar();
const MID_X = P.x0 + P.w / 2;

/** 灯が穴 d の上辺中央(x は本体中央 ±1、y は d − 3.5 ±1)にあるか */
function isDoorLamp(l: SignalLamp, d: number): boolean {
  return Math.abs(l.x - MID_X) <= 1 && Math.abs(l.y - (d - 3.5)) <= 1;
}

/** 柱の矩形(乗り場込み)の範囲の標識灯 */
function lampsAroundPillar(): SignalLamp[] {
  return signalLampsInRect(SEED, P.landL, P.landR, P.yTop, P.yBottom);
}

describe('巨柱: 装飾', () => {
  it('標識灯: 柱の穴の上辺中央に灯がある', () => {
    const lamps = lampsAroundPillar();
    for (const d of P.doors) {
      expect(lamps.some((l) => isDoorLamp(l, d)), `穴 ${d} の灯`).toBe(true);
    }
  }, 300_000);

  it('焼き込み: 本体を含むチャンクの ops に柱の面・リブ・受け光が入る', () => {
    const midX = Math.floor(MID_X);
    // 穴の床行でも穴の上 3 行でもない行(柱の帯の行)を中央付近から探す
    let midRow = Math.floor((P.yTop + P.yBottom) / 2);
    const inDoorBand = (y: number): boolean =>
      pillarDoorAt(P, y) || pillarDoorAt(P, y + 1) || pillarDoorAt(P, y + 2) || pillarDoorAt(P, y + 3);
    while (midRow <= P.yBottom && inDoorBand(midRow)) midRow++;
    expect(midRow).toBeLessThanOrEqual(P.yBottom);
    const ops = decorateChunk(SEED, Math.floor(midX / CHUNK), Math.floor(midRow / CHUNK));
    expect(ops.some((op) => op.kind === 'rect' && op.color === PILLAR_COLORS.face)).toBe(true);
    expect(ops.some((op) => (op.kind === 'line' || op.kind === 'rect') && op.color === PILLAR_COLORS.rib)).toBe(true);
    expect(ops.some((op) => op.kind === 'rect' && op.color === PILLAR_COLORS.light)).toBe(true);
  }, 300_000);

  it('焼き込み: 穴を含むチャンクの ops に穴の縁の色が入る', () => {
    const d = P.doors[0];
    const ops = decorateChunk(SEED, Math.floor(Math.floor(MID_X) / CHUNK), Math.floor(d / CHUNK));
    expect(ops.some((op) => op.kind !== 'grad' && op.color === PILLAR_COLORS.edge)).toBe(true);
  }, 300_000);

  it('保護範囲: 穴の帯に重なる矩形は sceneryGuarded が true', () => {
    for (const d of P.doors) {
      expect(sceneryGuarded(SEED, P.x0, P.x0 + P.w, d - 1, d), `穴 ${d}`).toBe(true);
    }
  }, 300_000);

  it('標識灯: 柱の本体の内側には行列の灯のような余分な灯を置かない', () => {
    const lamps = lampsAroundPillar();
    const inside = lamps.filter((l) => l.x >= P.landL && l.x <= P.landR && l.y >= P.yTop && l.y <= P.yBottom);
    for (const l of inside) {
      expect(P.doors.some((d) => isDoorLamp(l, d)), `余分な灯 (${l.x},${l.y})`).toBe(true);
    }
  }, 300_000);
});
