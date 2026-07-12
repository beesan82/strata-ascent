# 実タイル素材(PNG)への差し替え

生成タイル(`generate.ts`)の代わりに、実PNGアトラスを差し込むための入口が
`src/render/tileset/loadImage.ts` の `loadImageAtlas(url)` です。成功で `Atlas`、
失敗で `null`(呼び出し側は生成アトラスへフォールバック)を返します。

## 手順(CC0素材の例: Kenney など)

1. **1枚の横一列PNG**を用意する。47個のブロブ形状を横に並べ、各セルは
   `TILE_PX`(= 32)四方。全体サイズは `32 × 47 = 1504 px` 幅 × `32 px` 高。
2. `public/tiles/<name>.png` に置く。
3. 呼び出し側で `await loadImageAtlas('/tiles/<name>.png')` を使い、`null` なら
   `generateAtlas(palette)` にフォールバックする。

## 重要: ブロブの並び順は index 順に一致させる

PNG内の左からのセル順は、`autotile.ts` の **CANONICAL index 順**
(到達可能な正規化8bitマスクを昇順ソートした密索引)と一致していなければならない。
`chunkbake.ts` は `blobId(neighbors)` で得た index をそのまま `atlas.rect(id)` に渡し、
アトラスの左から `id` 番目のセルを引く。生成側 `generate.ts` は
`edgesForBlobId(id)` で同じ index 規則に沿って各セルを描いているため整合している。

したがって実PNGを作る際は、`generate.ts` が吐くアトラス(= index 順のベベル/縁の
出方)を基準画像として、同じ順序・同じ辺の開き方でセルを並べること。順序がずれると
タイルの縁・角の向きが近傍と噛み合わず、見た目が崩れる。安全な作り方は、まず
`generateAtlas` の出力を書き出して各セルの「どの辺が空気に面するか」を確認し、
それに合わせて実素材を割り当てる方法。

正直な注意: この入口は差し替え「経路が存在する」ことの実証であり、任意のPNGが
自動で正しく並ぶ保証はない。ブロブ順の一致はPNG作成者の責任。
