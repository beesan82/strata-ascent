/** 描画の明度段(遠=暗→近=明)。renderer が実際の色へ写像する */
export type Tone = 'far' | 'mid' | 'near';

/** 正規化座標(構造のバウンディングボックス内 0..1。x=右, y=下, y=1が接地) の描画オペ */
export type DrawOp =
  | { t: 'mass'; x: number; y: number; w: number; h: number; tone: Tone }        // 矩形の躯体
  | { t: 'cyl'; x: number; y: number; w: number; h: number; tone: Tone }          // 縦円筒(ハイライト付き)
  | { t: 'truss'; x: number; y: number; w: number; h: number }                    // 骨組み(脚2本+横梁)
  | { t: 'pipe'; pts: [number, number][]; width: number }                         // 配管(折れ線)
  | { t: 'panels'; x: number; y: number; w: number; h: number }                   // グリーブル(パネル格子)
  | { t: 'gap'; x: number; y: number; w: number; h: number }                      // 損傷: 抜けた区画(闇で塗る)
  | { t: 'frame'; x: number; y: number; w: number; h: number }                    // 損傷: 露出フレーム/鉄筋
  | { t: 'rim'; pts: [number, number][] }                                         // 上端リムライト(明線)
  | { t: 'glow'; x: number; y: number; r: number; kind: 'work' | 'heat' };        // 稼働灯/熱光

export interface StructureSpec {
  ops: DrawOp[];
}
