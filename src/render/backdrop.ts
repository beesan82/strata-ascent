import { BIOME_IDS, type BiomeId } from '../world/biomeCells';
import { VISUAL_BIOME, type Biome } from './biome';
import { BACKDROP_JPEG_BASE64 } from './backdropData';

/**
 * 地区別遠景(AI 生成、設計 §6.5「AI 遠景は遠景レイヤーに限る」)の読み込みと配置。
 * 素材は base64 テキスト資産(backdropData.ts)。起動時にデコードを始め、完了した地区から
 * 背景の最遠層(farLayer)に相乗りして差し替える。未完了・失敗・素材なし(精錬区)は
 * 従来の手続きシルエットのまま(フォールバック)。新しい描画パスは作らない。
 */

/** 遠景画像の不透明度(空のフィルと手続きシルエットの間に収める) */
export const BACKDROP_ALPHA = 0.45;
/** 最遠層のカメラ追従率(background.ts の FAR_FACTOR と一致させる) */
const FAR_FACTOR = 0.006;
/** 垂直パララックスは水平の 1/4(background.ts の farLayer と一致) */
const FAR_Y_FACTOR = 0.25;

/** 見た目の Biome オブジェクトから地区 ID を引く(ブレンドの from/to は VISUAL_BIOME の参照そのもの) */
export function backdropIdOf(biome: Biome): BiomeId | null {
  for (const id of BIOME_IDS) if (VISUAL_BIOME[id] === biome) return id;
  return null;
}

export interface BackdropSet {
  /** デコード済みの遠景画像。未完了・失敗・素材なしは null */
  imageFor(id: BiomeId): HTMLImageElement | null;
}

export function createBackdropSet(data: Partial<Record<BiomeId, string>> = BACKDROP_JPEG_BASE64): BackdropSet {
  const images = new Map<BiomeId, HTMLImageElement>();
  if (typeof Image !== 'undefined') {
    for (const id of BIOME_IDS) {
      const b64 = data[id];
      if (!b64) continue;
      const img = new Image();
      img.src = `data:image/jpeg;base64,${b64}`;
      images.set(id, img);
    }
  }
  return {
    imageFor(id: BiomeId): HTMLImageElement | null {
      const img = images.get(id);
      return img && img.complete && img.naturalWidth > 0 ? img : null;
    },
  };
}

export interface BackdropRect { x: number; y: number; w: number; h: number }

/**
 * 遠景画像の描画矩形。画面幅いっぱいに広げ(アスペクト比維持)、足元を最遠層の地平
 * (h*0.9)に合わせ、横はカメラ × FAR_FACTOR で巻き戻しながら敷く。決定論。
 */
export function backdropDrawRects(
  w: number, h: number, camX: number, camY: number, ppt: number, imgW: number, imgH: number,
): BackdropRect[] {
  const dw = w;
  const dh = (w * imgH) / imgW;
  const baseY = h * 0.9 - camY * FAR_FACTOR * FAR_Y_FACTOR * ppt;
  const offX = camX * FAR_FACTOR * ppt;
  const startX = -(((offX % dw) + dw) % dw);
  const rects: BackdropRect[] = [];
  for (let x = startX; x < w; x += dw) rects.push({ x, y: baseY - dh, w: dw, h: dh });
  return rects;
}
