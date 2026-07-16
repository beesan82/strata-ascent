import type { System } from '../../world/hierarchy';
import type { DrawOp, StructureSpec } from './spec';
import type { Rng } from './rng';

/** 構造の型。5系統 + 将来の拡張(段階E: biomech)を見越したユニオン */
export type StructureType = System;

/** テスト用: 損傷オペ(gap/frame)の数 */
export function damageOpCount(spec: StructureSpec): number {
  return spec.ops.filter((o) => o.t === 'gap' || o.t === 'frame').length;
}

// ---- 共有プリミティブ(各ビルダーが ops に push する) ----

/** パネル格子を敷き、損傷度に応じて一部を gap/frame へ置換する */
function panelBay(ops: DrawOp[], x: number, y: number, w: number, h: number, damage: number, rng: Rng): void {
  ops.push({ t: 'panels', x, y, w, h });
  const cells = 3 + Math.floor(w * 8);
  for (let i = 0; i < cells; i++) {
    if (rng() < damage * 0.5) {
      const gx = x + rng() * w * 0.8;
      const gy = y + rng() * h * 0.8;
      const gw = w * 0.12;
      const gh = h * 0.12;
      // 高損傷では抜け穴、中損傷では露出フレーム
      ops.push(rng() < damage ? { t: 'frame', x: gx, y: gy, w: gw, h: gh } : { t: 'gap', x: gx, y: gy, w: gw, h: gh });
    }
  }
}

/** 上端リムライト(左上→右上の折れ線) */
function rimTop(ops: DrawOp[], x: number, y: number, w: number): void {
  ops.push({ t: 'rim', pts: [[x, y], [x + w, y]] });
}

// ---- 系統別ビルダー ----

/** 電力系: 球形格納容器(mass) + タービンホール(縦配管束) + 変圧器バンク */
function buildPower(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  // 格納容器(丸みは renderer 側で cyl 扱いにせず mass+rim で表現)
  ops.push({ t: 'mass', x: 0.02, y: 0.35, w: 0.34, h: 0.6, tone: 'mid' });
  panelBay(ops, 0.05, 0.4, 0.28, 0.5, damage, rng);
  rimTop(ops, 0.02, 0.35, 0.34);
  // タービンホール
  ops.push({ t: 'mass', x: 0.4, y: 0.2, w: 0.34, h: 0.8, tone: 'mid' });
  for (let i = 0; i < 5; i++) ops.push({ t: 'pipe', pts: [[0.44 + i * 0.06, 0.22], [0.44 + i * 0.06, 1]], width: 0.02 });
  ops.push({ t: 'truss', x: 0.42, y: 0.2, w: 0.3, h: 0.35 });
  panelBay(ops, 0.42, 0.55, 0.3, 0.4, damage, rng);
  rimTop(ops, 0.4, 0.2, 0.34);
  // 変圧器バンク + 母線
  for (let i = 0; i < 3; i++) ops.push({ t: 'mass', x: 0.78 + i * 0.07, y: 0.5, w: 0.05, h: 0.5, tone: 'near' });
  ops.push({ t: 'pipe', pts: [[0.78, 0.46], [0.99, 0.46]], width: 0.008 });
  // 稼働灯(低損傷のみ)
  if (damage < 0.35) {
    ops.push({ t: 'glow', x: 0.5, y: 0.5, r: 0.02, kind: 'work' });
    ops.push({ t: 'glow', x: 0.19, y: 0.6, r: 0.02, kind: 'work' });
  }
  // 高損傷: 露出フレームを追加
  if (damage > 0.6) ops.push({ t: 'frame', x: 0.05, y: 0.35, w: 0.3, h: 0.2 });
  return { ops };
}

const BUILDERS: Record<StructureType, (damage: number, rng: Rng) => StructureSpec> = {
  power: buildPower,
  // 以降 Task 5 で追加(暫定で power に委譲し型を満たす)
  water: buildPower,
  foundry: buildPower,
  disposal: buildPower,
  habitation: buildPower,
};

/** 型・損傷度・乱数列 → 描画オペ列(純粋: rng が決定論なら出力も決定論) */
export function buildStructure(type: StructureType, damage: number, rng: Rng): StructureSpec {
  return BUILDERS[type](Math.max(0, Math.min(1, damage)), rng);
}
