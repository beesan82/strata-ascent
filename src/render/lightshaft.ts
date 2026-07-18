import type { Camera } from '../core/camera';
import { hash2 } from '../world/noise';

/**
 * これ以上明るいバイオームでは光条を出さない上限。現行バイオームの最大ambient(0.72)より上に
 * 置き、開けた空洞ならどの系統でも光条が差すようにする(暗さは intensity の darkF で反映)。
 * 主ゲートは開放度(zoom)側。暗∧開放だけに絞ると実世界では両立が稀で発動しないため。
 */
export const AMBIENT_MAX = 0.8;
/** これ以上ズームインした(閉塞)状態では光条を出さない(開放限定)。zoomは小さいほど開放。 */
export const ZOOM_OPEN = 0.85;
/** 光条候補スロット間隔(タイル) */
export const SHAFT_SLOT = 60;
/** スロットが実際に光条を持つ確率 */
const SHAFT_RATE = 0.4;

export interface Shaft {
  /** 光条中心のワールドX(タイル) */
  worldX: number;
  /** 幅(タイル) */
  width: number;
  /** 傾き(下端の水平ずれ、画面幅比 -0.18..0.18) */
  lean: number;
  /** 強度(0..1) */
  intensity: number;
  /** スロット整数index。埃など二次ハッシュの衝突しないキーに使う。 */
  id: number;
}

/**
 * 可視範囲に立つ光条を決定論で返す。暗く(ambientLevel<AMBIENT_MAX)開けた(zoom<ZOOM_OPEN)場所のみ。
 * それ以外は空配列。純粋関数。
 */
export function shaftsInView(
  seed: number,
  camXtiles: number,
  spanTiles: number,
  ambientLevel: number,
  zoom: number,
): Shaft[] {
  if (ambientLevel >= AMBIENT_MAX) return [];
  if (zoom >= ZOOM_OPEN) return [];
  const out: Shaft[] = [];
  const k0 = Math.floor((camXtiles - spanTiles / 2) / SHAFT_SLOT) - 1;
  const k1 = Math.floor((camXtiles + spanTiles / 2) / SHAFT_SLOT) + 1;
  for (let k = k0; k <= k1; k++) {
    if (hash2(seed + 8700, k, 0) >= SHAFT_RATE) continue;
    const worldX = k * SHAFT_SLOT + (hash2(seed + 8701, k, 0) - 0.5) * SHAFT_SLOT * 0.5;
    const width = 3 + hash2(seed + 8702, k, 0) * 6;
    const lean = (hash2(seed + 8703, k, 0) - 0.5) * 0.36;
    const darkF = 1 - ambientLevel / AMBIENT_MAX;
    const openF = 1 - zoom / ZOOM_OPEN;
    const intensity = Math.max(0, Math.min(1, (0.4 + 0.6 * hash2(seed + 8704, k, 0)) * (0.5 + 0.5 * darkF) * (0.5 + 0.5 * openF)));
    out.push({ worldX, width, lean, intensity, id: k });
  }
  return out;
}

/** 光条の描画(加算合成の光錐＋埃＋床光溜まり)。テスト対象外(Canvas)。 */
export class LightShafts {
  constructor(private seed: number) {}

  render(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    w: number,
    h: number,
    ppt: number,
    ambientLevel: number,
  ): void {
    const spanTiles = w / ppt;
    const shafts = shaftsInView(this.seed, cam.x, spanTiles, ambientLevel, cam.zoom);
    if (shafts.length === 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const floorY = h * 0.9;
    for (const s of shafts) {
      const sx = (s.worldX - cam.x) * ppt + w / 2;
      const topW = s.width * ppt * 0.35;
      const botW = s.width * ppt * 1.25;
      const leanPx = s.lean * w;
      const a = 0.10 * s.intensity;

      const g = ctx.createLinearGradient(sx, 0, sx + leanPx, floorY);
      g.addColorStop(0, `rgba(223,233,242,${a})`);
      g.addColorStop(1, 'rgba(223,233,242,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx - topW / 2, 0);
      ctx.lineTo(sx + topW / 2, 0);
      ctx.lineTo(sx + leanPx + botW / 2, floorY);
      ctx.lineTo(sx + leanPx - botW / 2, floorY);
      ctx.closePath();
      ctx.fill();

      const gc = ctx.createLinearGradient(sx, 0, sx + leanPx, floorY);
      gc.addColorStop(0, `rgba(238,244,251,${a * 0.9})`);
      gc.addColorStop(1, 'rgba(238,244,251,0)');
      ctx.fillStyle = gc;
      ctx.beginPath();
      ctx.moveTo(sx - topW * 0.18, 0);
      ctx.lineTo(sx + topW * 0.18, 0);
      ctx.lineTo(sx + leanPx + botW * 0.15, floorY);
      ctx.lineTo(sx + leanPx - botW * 0.15, floorY);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = `rgba(238,244,251,${Math.min(0.5, a * 4)})`;
      for (let i = 0; i < 7; i++) {
        const u = hash2(this.seed + 8710, s.id, i);
        const dy = u * floorY;
        const dx = sx + leanPx * u + (hash2(this.seed + 8711, s.id, i) - 0.5) * (topW + (botW - topW) * u);
        const r = Math.max(0.6, ppt * 0.03);
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      const poolX = sx + leanPx;
      const gp = ctx.createRadialGradient(poolX, floorY, 0, poolX, floorY, botW);
      gp.addColorStop(0, `rgba(223,233,242,${a * 1.6})`);
      gp.addColorStop(1, 'rgba(223,233,242,0)');
      ctx.fillStyle = gp;
      ctx.beginPath();
      ctx.ellipse(poolX, floorY, botW, botW * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
