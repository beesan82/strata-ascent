import type { System } from '../../world/hierarchy';
import type { DrawOp, StructureSpec } from './spec';
import type { Rng } from './rng';

/** 構造の型。System 系統に加え、段階Eのバイオメカ異物 biomech を union で加える。 */
export type StructureType = System | 'biomech';

/** 損傷オペ(gap/frame)の数を数える。損傷度の検証・デバッグ用ユーティリティ。 */
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
      // 高損傷ほど露出フレーム(骨組み)が優勢、低〜中損傷では抜け穴(パネル欠損)
      ops.push(rng() < damage ? { t: 'frame', x: gx, y: gy, w: gw, h: gh } : { t: 'gap', x: gx, y: gy, w: gw, h: gh });
    }
  }
}

/** 上端リムライト(左上→右上の折れ線) */
function rimTop(ops: DrawOp[], x: number, y: number, w: number): void {
  ops.push({ t: 'rim', pts: [[x, y], [x + w, y]] });
}

/** 低損傷(damage < threshold)のときだけ稼働灯/熱光を点ける */
function addWorkingLights(ops: DrawOp[], damage: number, threshold: number, glows: { x: number; y: number; r: number; kind: 'work' | 'heat' }[]): void {
  if (damage < threshold) for (const g of glows) ops.push({ t: 'glow', x: g.x, y: g.y, r: g.r, kind: g.kind });
}

/** 高損傷(damage > threshold)のとき露出フレームを1つ足す */
function addExposedFrame(ops: DrawOp[], damage: number, threshold: number, x: number, y: number, w: number, h: number): void {
  if (damage > threshold) ops.push({ t: 'frame', x, y, w, h });
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
  // 稼働灯(低損傷のみ) / 高損傷: 露出フレームを追加
  addWorkingLights(ops, damage, 0.35, [{ x: 0.5, y: 0.5, r: 0.02, kind: 'work' }, { x: 0.19, y: 0.6, r: 0.02, kind: 'work' }]);
  addExposedFrame(ops, damage, 0.6, 0.05, 0.35, 0.3, 0.2);
  return { ops };
}

/** 水系: 冷却塔(双曲線近似) + 巨大貯水槽(cyl) + 水管橋(pipe) */
function buildWater(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  // 冷却塔(上細り: 台形mass2段で近似)
  ops.push({ t: 'mass', x: 0.02, y: 0.5, w: 0.22, h: 0.5, tone: 'mid' });
  ops.push({ t: 'mass', x: 0.05, y: 0.15, w: 0.16, h: 0.4, tone: 'far' });
  rimTop(ops, 0.05, 0.15, 0.16);
  // 貯水槽(円筒)
  ops.push({ t: 'cyl', x: 0.32, y: 0.25, w: 0.3, h: 0.75, tone: 'mid' });
  panelBay(ops, 0.34, 0.45, 0.26, 0.5, damage, rng);
  rimTop(ops, 0.32, 0.25, 0.3);
  // 水管橋(奥へ伸びる太パイプ2本)
  ops.push({ t: 'pipe', pts: [[0.66, 0.5], [0.85, 0.46], [1, 0.5]], width: 0.03 });
  ops.push({ t: 'pipe', pts: [[0.66, 0.62], [0.85, 0.6], [1, 0.64]], width: 0.03 });
  addWorkingLights(ops, damage, 0.35, [{ x: 0.47, y: 0.5, r: 0.018, kind: 'work' }]);
  addExposedFrame(ops, damage, 0.6, 0.05, 0.15, 0.16, 0.2);
  return { ops };
}

/** 精錬区: 溶鉱炉(釣鐘mass + 内部熱光) + 取鍋クレーン + 煙突 */
function buildFoundry(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  ops.push({ t: 'mass', x: 0.04, y: 0.35, w: 0.3, h: 0.65, tone: 'mid' });
  panelBay(ops, 0.07, 0.42, 0.24, 0.5, damage, rng);
  rimTop(ops, 0.04, 0.35, 0.3);
  // 取鍋クレーン(横梁 + 吊り鍋)
  ops.push({ t: 'pipe', pts: [[0.36, 0.12], [0.72, 0.12]], width: 0.015 });
  ops.push({ t: 'mass', x: 0.5, y: 0.12, w: 0.1, h: 0.28, tone: 'near' });
  // 煙突2本
  ops.push({ t: 'mass', x: 0.78, y: 0.05, w: 0.07, h: 0.95, tone: 'mid' });
  ops.push({ t: 'mass', x: 0.88, y: 0.2, w: 0.06, h: 0.8, tone: 'far' });
  rimTop(ops, 0.78, 0.05, 0.07);
  // 溶鉱の熱光は低〜中損傷(damage<0.5)でのみ残す(稼働の名残)
  addWorkingLights(ops, damage, 0.5, [{ x: 0.19, y: 0.85, r: 0.05, kind: 'heat' }, { x: 0.55, y: 0.38, r: 0.03, kind: 'heat' }]);
  addExposedFrame(ops, damage, 0.6, 0.07, 0.35, 0.24, 0.2);
  return { ops };
}

/** 廃棄区: 焼却炉(mass) + 巨大排気ダクト(蛇行pipe) + 廃棄ピット(gap) */
function buildDisposal(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  ops.push({ t: 'mass', x: 0.03, y: 0.3, w: 0.34, h: 0.7, tone: 'mid' });
  panelBay(ops, 0.06, 0.36, 0.28, 0.55, damage, rng);
  rimTop(ops, 0.03, 0.3, 0.34);
  // 蛇行する巨大ダクト
  ops.push({ t: 'pipe', pts: [[0.37, 0.4], [0.55, 0.35], [0.62, 0.6], [0.82, 0.5], [1, 0.55]], width: 0.05 });
  // 廃棄ピット(手前の暗い落ち込み)
  ops.push({ t: 'gap', x: 0.4, y: 0.85, w: 0.4, h: 0.15 });
  addWorkingLights(ops, damage, 0.35, [{ x: 0.2, y: 0.75, r: 0.035, kind: 'heat' }]);
  addExposedFrame(ops, damage, 0.6, 0.06, 0.3, 0.28, 0.2);
  return { ops };
}

/** 居住区: 蜂の巣状の居室セル(規則→損傷で崩壊) */
function buildHabitation(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  ops.push({ t: 'mass', x: 0.05, y: 0.2, w: 0.9, h: 0.8, tone: 'mid' });
  // 居室セルをパネルとして敷き、損傷で崩す
  panelBay(ops, 0.08, 0.24, 0.84, 0.72, damage, rng);
  // 二世代の継ぎ目で単一格子感を壊す(注: 同一rng列を共有するため統計的独立ではないが、決定論的で見た目の目的は満たす)
  panelBay(ops, 0.08, 0.24, 0.84, 0.72, damage * 0.7, rng);
  rimTop(ops, 0.05, 0.2, 0.9);
  // 露出鉄筋(損傷側=右へ行くほど)
  addExposedFrame(ops, damage, 0.4, 0.6, 0.5, 0.3, 0.3);
  addWorkingLights(ops, damage, 0.35, [{ x: 0.3, y: 0.4, r: 0.012, kind: 'work' }]);
  return { ops };
}

/** バイオメカ異物: 椎骨状の柱 + 肋のように伸びる管 + 内部の脈光(まだ生きている不気味さ) */
function buildBiomech(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  // 中央の椎骨状コラム(縦円筒 + 節のふくらみを mass で重ねる)
  ops.push({ t: 'cyl', x: 0.4, y: 0.05, w: 0.2, h: 0.92, tone: 'mid' });
  for (let i = 0; i < 6; i++) {
    const y = 0.1 + i * 0.14;
    ops.push({ t: 'mass', x: 0.36, y, w: 0.28, h: 0.06, tone: 'near' });
  }
  // 肋のように左右へ湾曲して伸びる管(高さ違いで数本)
  for (let i = 0; i < 4; i++) {
    const y = 0.18 + i * 0.2;
    const dir = i % 2 === 0 ? -1 : 1;
    const xEnd = dir < 0 ? 0.05 : 0.95;
    const xMid = 0.5 + dir * 0.28;
    ops.push({ t: 'pipe', pts: [[0.5, y], [xMid, y - 0.05], [xEnd, y + 0.02]], width: 0.02 });
  }
  // 脈光(中心の不穏な発光。損傷に関わらず残す=まだ生きている)
  ops.push({ t: 'glow', x: 0.5, y: 0.45, r: 0.05, kind: 'work' });
  ops.push({ t: 'glow', x: 0.5, y: 0.7, r: 0.03, kind: 'work' });
  // 損傷: 節が剥がれ骨組み/裂けが露出
  const rips = Math.floor(damage * 4);
  for (let i = 0; i < rips; i++) {
    const y = 0.15 + rng() * 0.7;
    ops.push({ t: 'frame', x: 0.36, y, w: 0.28, h: 0.06 });
  }
  if (damage > 0.7) ops.push({ t: 'gap', x: 0.42, y: 0.5, w: 0.16, h: 0.12 });
  return { ops };
}

const BUILDERS: Record<StructureType, (damage: number, rng: Rng) => StructureSpec> = {
  power: buildPower,
  water: buildWater,
  foundry: buildFoundry,
  disposal: buildDisposal,
  habitation: buildHabitation,
  biomech: buildBiomech,
};

/** 型・損傷度・乱数列 → 描画オペ列(純粋: rng が決定論なら出力も決定論) */
export function buildStructure(type: StructureType, damage: number, rng: Rng): StructureSpec {
  return BUILDERS[type](Math.max(0, Math.min(1, damage)), rng);
}
