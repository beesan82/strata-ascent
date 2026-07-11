import { BLOB_COUNT } from './autotile';

/** 1タイルのピクセル寸法(焼き込み解像度)。密度のため32pxで焼く */
export const TILE_PX = 32;

/**
 * タイルアトラス。BLOB_COUNT個のブロブ形状を横一列に並べたソース。
 * blobId を渡すと該当タイルの矩形(sx,sy,sw,sh)を返す。
 * source は生成Canvasでも、後から差し替えたHTMLImageElementでもよい。
 */
export interface Atlas {
  source: CanvasImageSource;
  rect(blobId: number): { sx: number; sy: number; sw: number; sh: number };
}

/** 横一列(BLOB_COUNT×1)配置のアトラス索引を作る */
export function rowAtlas(source: CanvasImageSource): Atlas {
  return {
    source,
    rect(id: number) {
      const i = Math.max(0, Math.min(BLOB_COUNT - 1, id));
      return { sx: i * TILE_PX, sy: 0, sw: TILE_PX, sh: TILE_PX };
    },
  };
}
