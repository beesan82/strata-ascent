import { hash2 } from '../world/noise';
import { mixHex, type BiomeBlend, type BgLayer } from './biome';
import { BAND_FACTOR, GLOW_FACTOR, GLOW_FALLOFF, GLOW_MIN, beaconGlowAt, interfaceBandsNear } from './beacon';
import { STEEL } from './steel';

/**
 * 滲みの中心アルファ(強度 1 のとき)と、帯の不透明度。滲みは暗幕(最大 0.62)の下にあり、さらに
 * 32 色へ量子化される。0.22 では消え、0.45 では塔の矩形と空で量子化先が割れて紫の斑になった
 * (スクリーンショットで確認)。大穴の近く(約 100 タイル)は空も塔もまとめて accent 側の色に
 * 落ち、遠くでは灰色の明度差だけが残る強さにする。
 */
const GLOW_ALPHA = 0.6;
const BAND_ALPHA = 0.7;

function withAlpha(hex: string, a: number): string {
  const p = parseInt(hex.slice(1), 16);
  return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${a})`;
}

export interface FarSil { kind: 'tower' | 'dome' | 'gantry' | 'ring'; x: number; w: number; h: number; color: string }

const FAR_SLOT = 8000; // 遠景シルエットのスロット間隔(タイル)
const FAR_FACTOR = 0.006; // 最遠層のカメラ追従率(ごくわずかに動く)。8000タイル級構造が画面約1幅に収まる投影スケール

/** camXtiles を中心に spanTiles 幅の範囲に落ちる遠景シルエットを決定論で返す */
export function farSilhouettes(seed: number, camXtiles: number, spanTiles: number): FarSil[] {
  const out: FarSil[] = [];
  const k0 = Math.floor((camXtiles - spanTiles / 2) / FAR_SLOT) - 1;
  const k1 = Math.floor((camXtiles + spanTiles / 2) / FAR_SLOT) + 1;
  for (let k = k0; k <= k1; k++) {
    if (hash2(seed + 90000, k, 0) > 0.7) continue; // 一部スロットは空
    const kindR = hash2(seed + 90001, k, 0);
    const kind = kindR < 0.4 ? 'tower' : kindR < 0.65 ? 'gantry' : kindR < 0.85 ? 'dome' : 'ring';
    const w = (0.3 + hash2(seed + 90002, k, 0) * 1.4) * FAR_SLOT;
    const h = (0.5 + hash2(seed + 90003, k, 0) * 2) * FAR_SLOT;
    const x = k * FAR_SLOT + hash2(seed + 90004, k, 0) * FAR_SLOT;
    out.push({ kind, x, w, h, color: '#0e141b' });
  }
  return out;
}

export interface RareLandmark { kind: 'colossus' | 'ring' | 'spire'; w: number; h: number }

const LANDMARK_SLOT = 4; // これ×FAR_SLOT ごとに稀少判定

/** 粗いスロットごとに低確率で巨大ランドマークを返す */
export function rareLandmarkAt(seed: number, slot: number): RareLandmark | null {
  if (hash2(seed + 91000, slot, 0) > 0.12) return null; // 稀少
  const r = hash2(seed + 91001, slot, 0);
  const kind = r < 0.4 ? 'colossus' : r < 0.7 ? 'spire' : 'ring';
  const w = (2 + hash2(seed + 91002, slot, 0) * 3) * FAR_SLOT;
  const h = (3 + hash2(seed + 91003, slot, 0) * 4) * FAR_SLOT;
  return { kind, w, h };
}

export interface BackgroundLayerContribution {
  layer: BgLayer;
  layerIndex: number;
  opacity: number;
  source: 'from' | 'to';
}

/** Cross-fade complete layer sets so matched roles and unmatched haze never pop at a cell edge. */
export function backgroundLayerContributions(bb: BiomeBlend): BackgroundLayerContribution[] {
  if (bb.from === bb.to || bb.t <= 0) {
    return bb.from.bgLayers.map((layer, layerIndex) => ({
      layer,
      layerIndex,
      opacity: 1,
      source: 'from' as const,
    }));
  }

  return [
    ...bb.from.bgLayers.map((layer, layerIndex) => ({
      layer,
      layerIndex,
      opacity: 1 - bb.t,
      source: 'from' as const,
    })),
    ...bb.to.bgLayers.map((layer, layerIndex) => ({
      layer,
      layerIndex,
      opacity: bb.t,
      source: 'to' as const,
    })),
  ];
}

/**
 * Deterministic multi-layer parallax background. During a visual-cell transition,
 * both complete biome layer sets are cross-faded so unmatched roles disappear smoothly.
 */
export class Background {
  constructor(private seed: number) {}

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    w: number,
    h: number,
    ppt: number,
    bb: BiomeBlend,
  ): void {
    // 最遠層: 遠景の巨大シルエット + 稀少な巨大ランドマーク(近景層より背後)
    this.farLayer(ctx, camX, camY, w, h, ppt, bb);

    for (const { layer: L, layerIndex, opacity } of backgroundLayerContributions(bb)) {
      switch (L.kind) {
        case 'tower': this.towers(ctx, L, layerIndex, camX, w, h, ppt, opacity); break;
        case 'deck': this.decks(ctx, L, layerIndex, camY, w, h, ppt, opacity); break;
        case 'haze': this.haze(ctx, L, layerIndex, camY, w, h, ppt, opacity); break;
      }
    }

    // 光の滲み(§6.2): 最寄りの大穴へ向かう横長グロー。構造群の手前のかすみとして乗せる
    // (背後に置くと塔のシルエットに隠れて明るさの偏りが読めなかった)。
    this.glow(ctx, camX, camY, w, h, ppt);

    // 界面の帯(§6.1): 上下 1 画面以内の板を、最も手前の遠景層(追従率 0.6)として先に見せる。
    this.bands(ctx, camY, w, h, ppt);
    ctx.globalAlpha = 1;
  }

  /**
   * 滲み。最寄りの大穴の X を頂点に、水平距離 0→1、256→0.15(glowStrength と同じ折れ線)の
   * 横グラデを追従率 0.9 で画面全体に lighter で乗せる。この折れ線をそのまま横の形にするので、
   * 最寄りの大穴(最大 256 タイル先)までの範囲なら画面の中に必ず明るさの勾配があり、孔が
   * 画面外でも方角が読める(矢印やマーカーは置かない)。設計書の「幅 300 タイル」の楕円は、
   * 1 画面(34 タイル)の中では勾配が約 1 割しかなく暗幕と量子化の後に偏りが残らなかった。
   * 縦は層の全高にわたり、板の下面で 1、次の板の上面で 0.4 に弱める(カメラ Y で一様)。
   */
  private glow(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number, ppt: number): void {
    const g = beaconGlowAt(this.seed, camX, camY);
    const depth = Math.max(0, Math.min(1, (camY - g.top) / (g.layerBottom - g.top)));
    const a = GLOW_ALPHA * (1 - 0.6 * depth);
    const sx = (g.x - camX) * GLOW_FACTOR * ppt + w / 2;
    const span = GLOW_FALLOFF * GLOW_FACTOR * ppt;
    const grad = ctx.createLinearGradient(sx - span, 0, sx + span, 0);
    grad.addColorStop(0, withAlpha(g.color, a * GLOW_MIN));
    grad.addColorStop(0.5, withAlpha(g.color, a));
    grad.addColorStop(1, withAlpha(g.color, a * GLOW_MIN));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /** 板の帯。追従率 0.6 で板と同じ Y に置き、暗い帯と下端の細い線で天井の存在を先に読ませる */
  private bands(ctx: CanvasRenderingContext2D, camY: number, w: number, h: number, ppt: number): void {
    for (const b of interfaceBandsNear(this.seed, camY, h / ppt)) {
      const y0 = (b.top - camY) * BAND_FACTOR * ppt + h / 2;
      const bh = (b.bottom - b.top) * BAND_FACTOR * ppt;
      ctx.globalAlpha = BAND_ALPHA;
      ctx.fillStyle = STEEL.black;
      ctx.fillRect(0, y0, w, bh);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = STEEL.shadow;
      ctx.fillRect(0, y0 + bh, w, Math.max(1, 0.1 * ppt));
    }
  }

  /** 近い層ほど不透明(0.2〜0.45に収める) */
  private alphaFor(base: number, factor: number): number {
    return Math.min(0.45, base * (0.7 + factor));
  }

  /**
   * 最遠層。8000タイル級の巨大構造シルエットを極小スケール(≒0.006)で投影する。
   * 巨大ゆえ画面上でも大きく、しかし距離ゆえパンにほぼ追従しない(圧倒的スケール)。
   * alphaは0.06〜0.10と非常に淡く、前景の可読性を損なわない。
   */
  private farLayer(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number, ppt: number, bb: BiomeBlend): void {
    const scale = FAR_FACTOR * ppt;            // far-tile → px
    const horizon = h * 0.9;                    // 巨大構造の基部(地平)を画面下寄りに
    const camYoff = camY * FAR_FACTOR * 0.25 * ppt; // 垂直パララックスはさらに鈍い
    const tint = mixHex('#0e141b', bb.ambientColor, 0.35);
    ctx.strokeStyle = tint;
    ctx.fillStyle = tint;

    // --- 稀少な巨大ランドマーク(最背面) ---
    const coarse = LANDMARK_SLOT * FAR_SLOT;
    const halfSpan = (w / 2) / scale;           // 画面に載る far-tile 半幅
    const cs0 = Math.floor((camX - halfSpan) / coarse) - 1;
    const cs1 = Math.floor((camX + halfSpan) / coarse) + 1;
    for (let cs = cs0; cs <= cs1; cs++) {
      const lm = rareLandmarkAt(this.seed, cs);
      if (!lm) continue;
      const wx = cs * coarse + coarse / 2;
      const sx = (wx - camX) * scale + w / 2;
      const lw = lm.w * scale;
      const lh = lm.h * scale;
      ctx.globalAlpha = 0.07;
      const baseY = horizon - camYoff;
      const topY = baseY - lh;
      ctx.globalAlpha = 0.14;
      switch (lm.kind) {
        case 'colossus': {
          // 太い基部から細くなる超巨大な塊(台形風)
          const bw = lw, tw = lw * 0.55;
          ctx.beginPath();
          ctx.moveTo(sx - bw / 2, baseY);
          ctx.lineTo(sx - tw / 2, topY);
          ctx.lineTo(sx + tw / 2, topY);
          ctx.lineTo(sx + bw / 2, baseY);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'spire':
          // 画面高を大きく越える尖塔
          ctx.beginPath();
          ctx.moveTo(sx - lw / 2, baseY);
          ctx.lineTo(sx, topY);
          ctx.lineTo(sx + lw / 2, baseY);
          ctx.closePath();
          ctx.fill();
          break;
        case 'ring': {
          // 空に浮かぶ巨大環(ストローク)
          const r = Math.min(lw, lh) / 2;
          const cy = baseY - lh * 0.45;
          ctx.lineWidth = Math.max(2, r * 0.08);
          ctx.beginPath();
          ctx.arc(sx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }
    }

    // --- 遠景の巨大シルエット群 ---
    const span = w / ppt / FAR_FACTOR + FAR_SLOT * 2;
    for (const s of farSilhouettes(this.seed, camX, span)) {
      const sx = (s.x - camX) * scale + w / 2;
      const sw = s.w * scale;
      const sh = s.h * scale;
      if (sx + sw / 2 < -sw || sx - sw / 2 > w + sw) continue; // 画面外は捨てる
      const baseY = horizon - camYoff;
      const topY = baseY - sh;
      ctx.globalAlpha = 0.12;
      switch (s.kind) {
        case 'tower':
          ctx.fillRect(sx - sw / 2, topY, sw, baseY - topY);
          break;
        case 'gantry': {
          // 縦材2本 + 横梁(骨組み塔)
          const leg = Math.max(2, sw * 0.12);
          ctx.fillRect(sx - sw / 2, topY, leg, baseY - topY);
          ctx.fillRect(sx + sw / 2 - leg, topY, leg, baseY - topY);
          const beams = 6;
          for (let b = 1; b < beams; b++) {
            const by = topY + (baseY - topY) * (b / beams);
            ctx.fillRect(sx - sw / 2, by, sw, leg * 0.6);
          }
          break;
        }
        case 'dome': {
          // 半円ドーム(基部から立ち上がる丸い塊)
          const r = sw / 2;
          const cy = baseY;
          ctx.beginPath();
          ctx.arc(sx, cy, r, Math.PI, Math.PI * 2);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'ring': {
          const r = Math.min(sw, sh) / 2;
          const cy = baseY - sh * 0.4;
          ctx.lineWidth = Math.max(2, r * 0.1);
          ctx.beginPath();
          ctx.arc(sx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 縦の巨大塔: 画面全高のバーをスロット単位で配置し水平パララックス */
  private towers(ctx: CanvasRenderingContext2D, L: BgLayer, li: number, camX: number, w: number, h: number, ppt: number, opacity: number): void {
    ctx.globalAlpha = this.alphaFor(0.34, L.factor) * opacity;
    ctx.fillStyle = L.color;
    const slotTiles = 13 + Math.round(L.factor * 20);
    const slotPx = slotTiles * ppt;
    const offX = camX * L.factor * ppt;
    const k0 = Math.floor((offX - w / 2) / slotPx) - 1;
    const k1 = Math.floor((offX + w / 2) / slotPx) + 1;
    const s = this.seed + 100 + li * 7;
    for (let k = k0; k <= k1; k++) {
      // density = 出現確率。閾値超えは欠落。
      if (hash2(s, k, 0) > L.density) continue;
      const tw = (0.18 + hash2(s, k, 1) * 0.42) * slotPx;
      const jitter = hash2(s, k, 2) * (slotPx - tw);
      const tx = k * slotPx - offX + w / 2 + jitter;
      // 塔頭を少し変えて高さの違う構造群に見せる(下端は常に画面外まで)
      const top = -h * 0.1 + hash2(s, k, 3) * h * 0.35;
      ctx.fillRect(tx, top, tw, h - top + h * 0.1);
    }
  }

  /** 水平デッキ: 行単位のバーを垂直パララックスで配置 */
  private decks(ctx: CanvasRenderingContext2D, L: BgLayer, li: number, camY: number, w: number, h: number, ppt: number, opacity: number): void {
    ctx.globalAlpha = this.alphaFor(0.3, L.factor) * opacity;
    ctx.fillStyle = L.color;
    const rowTiles = 11 + Math.round(L.factor * 18);
    const rowPx = rowTiles * ppt;
    const offY = camY * L.factor * 0.6 * ppt;
    const j0 = Math.floor((offY - h / 2) / rowPx) - 1;
    const j1 = Math.floor((offY + h / 2) / rowPx) + 1;
    const s = this.seed + 300 + li * 7;
    const thick = Math.max(2, 0.7 * ppt);
    for (let j = j0; j <= j1; j++) {
      if (hash2(s, 0, j) > L.density) continue;
      const jy = j * rowPx - offY + h / 2;
      const dw = (0.35 + hash2(s, 1, j) * 0.55) * w;
      const dx = hash2(s, 2, j) * (w - dw);
      ctx.fillRect(dx, jy, dw, thick);
      // デッキ下面のリブ(細い影)で厚みを持たせる
      ctx.globalAlpha = this.alphaFor(0.18, L.factor) * opacity;
      ctx.fillRect(dx, jy + thick, dw, Math.max(1, thick * 0.5));
      ctx.globalAlpha = this.alphaFor(0.3, L.factor) * opacity;
    }
  }

  /** かすみ: 非常に淡い水平の色帯(垂直グラデーション) */
  private haze(ctx: CanvasRenderingContext2D, L: BgLayer, _li: number, camY: number, w: number, h: number, ppt: number, opacity: number): void {
    const offY = camY * L.factor * 0.4 * ppt;
    // 画面中央付近をゆっくり漂う帯
    const bandH = h * 0.7;
    const cy = h / 2 - offY * 0.15;
    const y0 = cy - bandH / 2;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + bandH);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, L.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = this.alphaFor(0.22, L.factor) * opacity;
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, w, bandH);
  }
}
