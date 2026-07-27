import type { TilePalette } from './tileset/generate';

/** #rrggbb を線形混合(biome.ts から移設。旧挙動と完全同一) */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/** WCAG相対輝度(0..1)。トーン設計(明度4段)の検証用 */
export function relLum(hex: string): number {
  const p = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((p >> 16) & 255) + 0.7152 * ch((p >> 8) & 255) + 0.0722 * ch(p & 255);
}

/**
 * realismモック(brainstorm/1737-1784242068/content/realism.html)由来の
 * 鋼鉄カラーランプ。暗→明の順に定義(テストが単調性を検証する)。
 * 画面の明度構成はこのランプのみから組む。暖色(錆・灯)は decor.PALETTE 側。
 */
export const STEEL = {
  black: '#020408',    // 純黒(落ち影・後退内面)
  bg: '#03060a',       // 背景フィル基準
  far: '#070c12',      // 遠景躯体・凹ベイ
  shadow: '#0a121a',   // 落ち影・パネル線
  base: '#0d141c',     // 壁ベース
  stringer: '#10171f', // H鋼ストリンガー
  grate: '#141d27',    // グレーチング面
  rib: '#16202b',      // リブ柱・ガセット
  hanger: '#1c3040',   // 吊り金具・サポート
  trayEdge: '#22384a', // トレイ縁
  bayEdge: '#2a4258',  // 凹ベイ上縁の受け光・中桟
  post: '#33506a',     // 手すり支柱・ボルト・配管ハイライト
  flange: '#3d566e',   // 上フランジ受け光・クランプ
  railTop: '#4a6a84',  // 手すり上桟・空気側リム
  rim: '#7d97ad',      // 歩ける上端の明リムライト(可読性の主役)
} as const;

/** 鋼ランプに系統色を微量ティントしたタイルパレット。明度関係はランプのまま保存する */
export function steelPalette(tint: string, k = 0.07): TilePalette {
  return {
    fillDark: mixHex(STEEL.far, tint, k),
    fillMid: mixHex(STEEL.base, tint, k),
    fillLight: mixHex(STEEL.rib, tint, k),
    edge: mixHex(STEEL.railTop, tint, k * 2),
    line: STEEL.shadow,
  };
}
