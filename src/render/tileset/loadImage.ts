import { rowAtlas, type Atlas } from './atlas';

/**
 * 47ブロブが横一列(各TILE_PX角)に並んだPNGを読み、Atlasを返す。
 * 失敗時は null(呼び出し側が生成アトラスにフォールバック)。public/tiles/<name>.png 想定。
 */
export async function loadImageAtlas(url: string): Promise<Atlas | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return rowAtlas(img);
  } catch {
    console.warn(`タイルアトラス読込失敗、生成タイルにフォールバック: ${url}`);
    return null;
  }
}
