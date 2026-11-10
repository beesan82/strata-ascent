import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import {
  canAddSupply,
  canPickup,
  carryKindFor,
  DropItem,
  dropKindFor,
  DROP_LIFETIME,
  DROP_BLINK_TIME,
  MAX_DROPS,
  MAX_GROUND_MATERIALS,
  MAX_GROUND_RATIONS,
  MAX_SUPPLIES,
  pushDrop,
  pushSupply,
  supplyCount,
} from './drop';
import { CARRY_KINDS } from '../core/carry';

/** y=10 行が床(x は全面) */
const floorTiles = (_tx: number, ty: number): Tile => (ty === 10 ? TILE.SOLID : TILE.AIR);

function step(d: DropItem, seconds: number): void {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) d.update(dt, floorTiles);
}

describe('DropItem(ドロップ実体)', () => {
  it('撃破位置から落下して床に静止する', () => {
    const d = new DropItem('charge', 5, 5);
    step(d, 2);
    expect(d.body.onGround).toBe(true);
    // 床行(y=10)の上に底が接して止まる
    expect(d.body.y + d.body.h).toBeCloseTo(10, 2);
    const restY = d.body.y;
    step(d, 1);
    expect(d.body.y).toBe(restY); // 静止したまま動かない
    expect(d.body.vy).toBe(0);
  });

  it('寿命 60 秒で期限切れになる', () => {
    const d = new DropItem('heal', 5, 9);
    step(d, DROP_LIFETIME - 1);
    expect(d.expired).toBe(false);
    step(d, 1.1);
    expect(d.expired).toBe(true);
  });

  it('残り 5 秒から点滅状態になる', () => {
    const d = new DropItem('charge', 5, 9);
    step(d, DROP_LIFETIME - DROP_BLINK_TIME - 1);
    expect(d.blinking).toBe(false);
    step(d, 1.1);
    expect(d.blinking).toBe(true);
  });

  it('補給品(permanent)は 60 秒を超えても消えず点滅もしない', () => {
    const d = new DropItem('ration', 5, 9, true);
    step(d, DROP_LIFETIME + 120);
    expect(d.expired).toBe(false);
    expect(d.blinking).toBe(false);
  });

  it('種別と中心座標を保持する', () => {
    const d = new DropItem('heal', 7.5, 3.25);
    expect(d.kind).toBe('heal');
    expect(d.centerX).toBeCloseTo(7.5);
    expect(d.centerY).toBeCloseTo(3.25);
  });
});

describe('pushDrop(通常ドロップの上限)', () => {
  it('上限 16 個を超えたら古いものから消す', () => {
    const drops: DropItem[] = [];
    const items: DropItem[] = [];
    for (let i = 0; i < MAX_DROPS + 3; i++) {
      const d = new DropItem('charge', i, 0);
      items.push(d);
      pushDrop(drops, d);
    }
    expect(drops.length).toBe(MAX_DROPS);
    expect(drops[0]).toBe(items[3]); // 最古の 3 個が落ちている
    expect(drops[drops.length - 1]).toBe(items[items.length - 1]);
  });

  it('補給品は通常ドロップの上限に数えず、押し出されもしない', () => {
    const drops: DropItem[] = [];
    const supply = new DropItem('ration', 0, 0, true);
    pushSupply(drops, supply);
    for (let i = 0; i < MAX_DROPS + 2; i++) pushDrop(drops, new DropItem('charge', i, 0));
    expect(drops).toContain(supply);
    expect(drops.filter((d) => !d.permanent).length).toBe(MAX_DROPS);
  });
});

describe('pushSupply(補給品と糧食の溢れ)', () => {
  it('糧食が地面上限 16 を超えたら、最も古い糧食が点滅して消える状態になる', () => {
    const drops: DropItem[] = [];
    const items: DropItem[] = [];
    for (let i = 0; i < MAX_GROUND_RATIONS; i++) {
      const d = new DropItem('ration', i, 0, true);
      items.push(d);
      pushSupply(drops, d);
    }
    for (const d of items) expect(d.blinking).toBe(false);
    pushSupply(drops, new DropItem('ration', 99, 0, true));
    // 最古の 1 個だけが残り DROP_BLINK_TIME 秒の寿命に落ちる
    expect(items[0].blinking).toBe(true);
    expect(items[1].blinking).toBe(false);
    step(items[0], DROP_BLINK_TIME + 0.1);
    expect(items[0].expired).toBe(true);
  });

  it('砲弾・回復の補給品では糧食の溢れ処理は起きない', () => {
    const drops: DropItem[] = [];
    for (let i = 0; i < MAX_GROUND_RATIONS; i++) pushSupply(drops, new DropItem('ration', i, 0, true));
    pushSupply(drops, new DropItem('charge', 50, 0, true));
    expect(drops.every((d) => !d.blinking)).toBe(true);
  });

  it('素材セル(段階 A)は補給品として寿命なしで残り、点滅もしない', () => {
    const d = new DropItem('material', 5, 9, true);
    step(d, DROP_LIFETIME + 120);
    expect(d.expired).toBe(false);
    expect(d.blinking).toBe(false);
  });

  it('素材セルが地面上限 8 を超えたら、最も古い素材だけが点滅して消える状態になる', () => {
    const drops: DropItem[] = [];
    const items: DropItem[] = [];
    for (let i = 0; i < MAX_GROUND_MATERIALS; i++) {
      const d = new DropItem('material', i, 0, true);
      items.push(d);
      pushSupply(drops, d);
    }
    for (const d of items) expect(d.blinking).toBe(false);
    pushSupply(drops, new DropItem('material', 99, 0, true));
    expect(items[0].blinking).toBe(true);
    expect(items[1].blinking).toBe(false);
  });

  it('素材と糧食の上限は種別ごとに独立で、互いの溢れ処理を起こさない', () => {
    const drops: DropItem[] = [];
    for (let i = 0; i < MAX_GROUND_RATIONS; i++) pushSupply(drops, new DropItem('ration', i, 0, true));
    for (let i = 0; i < MAX_GROUND_MATERIALS; i++) pushSupply(drops, new DropItem('material', 50 + i, 0, true));
    expect(drops.every((d) => !d.blinking)).toBe(true);
    // 糧食 16 + 素材 8 = 24 で、補給品全体の上限 32 の内側に収まる
    expect(supplyCount(drops)).toBe(MAX_GROUND_RATIONS + MAX_GROUND_MATERIALS);
    expect(MAX_GROUND_RATIONS + MAX_GROUND_MATERIALS).toBeLessThan(MAX_SUPPLIES);
  });

  it('supplyCount / canAddSupply: 補給品全体の上限 32', () => {
    const drops: DropItem[] = [];
    expect(supplyCount(drops)).toBe(0);
    expect(canAddSupply(drops, MAX_SUPPLIES)).toBe(true);
    expect(canAddSupply(drops, MAX_SUPPLIES + 1)).toBe(false);
    for (let i = 0; i < MAX_SUPPLIES; i++) pushSupply(drops, new DropItem('heal', i, 0, true));
    expect(supplyCount(drops)).toBe(MAX_SUPPLIES);
    expect(canAddSupply(drops, 1)).toBe(false);
    // 通常ドロップは補給品に数えない
    pushDrop(drops, new DropItem('charge', 0, 0));
    expect(supplyCount(drops)).toBe(MAX_SUPPLIES);
  });
});

describe('canPickup(満タン時は拾えない)', () => {
  it('砲弾セル: 携行枠が満杯なら false、空きがあれば true(弾薬設計 §1: 砲弾は携行の弾薬)', () => {
    expect(canPickup('charge', 5, 5, 0, 2, 5, 5)).toBe(false);
    expect(canPickup('charge', 5, 5, 0, 2, 4, 5)).toBe(true);
    expect(canPickup('charge', 1, 5, 2, 2, 0, 5)).toBe(true);
  });

  it('パルス弾セル: 携行枠だけで判定する', () => {
    expect(canPickup('pulsecell', 5, 5, 0, 2, 5, 5)).toBe(false);
    expect(canPickup('pulsecell', 1, 5, 2, 2, 0, 5)).toBe(true);
  });

  it('回復: 全快なら false、減っていれば true', () => {
    expect(canPickup('heal', 5, 5, 0, 2, 0, 5)).toBe(false);
    expect(canPickup('heal', 4, 5, 0, 2, 5, 5)).toBe(true);
  });

  it('糧食: 所持上限 2 なら false、空きがあれば true(満腹度は見ない)', () => {
    expect(canPickup('ration', 5, 5, 2, 2, 0, 5)).toBe(false);
    expect(canPickup('ration', 1, 5, 1, 2, 5, 5)).toBe(true);
    expect(canPickup('ration', 5, 5, 0, 2, 0, 5)).toBe(true);
  });

  it('素材: 携行枠が満杯なら false、空きがあれば true(消耗品の状態は見ない)', () => {
    expect(canPickup('material', 1, 5, 0, 2, 5, 5)).toBe(false);
    expect(canPickup('material', 5, 5, 2, 2, 4, 5)).toBe(true);
    expect(canPickup('material', 5, 5, 2, 2, 0, 5)).toBe(true);
  });

  it('貴重品: 素材と同じく携行枠だけで判定する(段階 3-B §2、枠は共有)', () => {
    expect(canPickup('valuable', 1, 5, 0, 2, 5, 5)).toBe(false);
    expect(canPickup('valuable', 5, 5, 2, 2, 4, 5)).toBe(true);
  });
});

describe('carryKindFor / dropKindFor(地面の種別と携行の種別の対応)', () => {
  it('砲弾セルは shell、パルス弾セルは pulsecell、素材は material、貴重品は valuable、即時消費は null', () => {
    expect(carryKindFor('charge')).toBe('shell');
    expect(carryKindFor('pulsecell')).toBe('pulsecell');
    expect(carryKindFor('material')).toBe('material');
    expect(carryKindFor('valuable')).toBe('valuable');
    expect(carryKindFor('heal')).toBeNull();
    expect(carryKindFor('ration')).toBeNull();
  });

  it('dropKindFor は carryKindFor の逆写像(落として拾うと同じ携行種別に戻る)。全携行種別で成り立つ', () => {
    for (const k of CARRY_KINDS) {
      expect(carryKindFor(dropKindFor(k))).toBe(k);
    }
    expect(dropKindFor('shell')).toBe('charge');
    expect(dropKindFor('valuable')).toBe('valuable');
  });
});
