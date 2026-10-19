# BLAME! SIM

無限に生成される巨大構造体を探索する2Dブラウザゲーム。Vite + TypeScript + Canvas 2D。

## 起動

```powershell
npm install
npm run dev   # http://localhost:5173/
```

`play.bat` をダブルクリックしても起動できる(依存がなければ自動で `npm install`)。

## 操作

| 操作 | キー |
|---|---|
| 移動 | `A` / `D` または `←` / `→` |
| 梯子 | `W` / `S` または `↑` / `↓` |
| ジャンプ | `Space` |
| 重力子砲 | `F` 長押しでチャージ、離して発射(照準はマウス) |
| 眺望 | 接地・静止中に `Shift` 長押しで広角、マウス方向へ最大 40 タイル見渡す(移動キーで解除)。孔を登り切って見晴らし台に出ると自動で 2.5 秒の眺望と字幕「第 n 階層」 |
| ミュート | `M`(段階5 の音で有効になる。いまは状態だけ) |

## URLパラメータ

| パラメータ | 内容 |
|---|---|
| `?seed=123` | ワールドのシード |
| `?x=&y=` | スポーン位置の上書き(タイル座標) |
| `?freeze=1` | シミュレーション停止(描画のみ) |
| `?debug=hierarchy[:タイル数]` | 地域階層の俯瞰表示 |

界面(階層の板)の座標は `src/world/interface.ts` の `passageX` / `interfaceTop` / `interfaceBottom` で求められる。
開始地点は常に cell 0 の前室(孔の左 12 タイル)。

## 開発

```powershell
npm test            # Vitest
npx tsc --noEmit    # 型チェック
npm run build       # 本番ビルド
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/shot.png
node scripts/frametime.mjs --seed=20260711 --pos=244,66   # rAF 間隔と描画時間の p50/p95(ヘッドレス=ソフトウェア描画)
node scripts/frametime.mjs --seed=20260711 --stages       # 描画段階ごとの同期ラスタ化時間(どの層が重いか)
node scripts/dumpframe.mjs --out=frames/start.bin         # 量子化前の 1 フレームを保存 → quantbench.ts で量子化を比べる
npx vite-node scripts/quantbench.ts frames/start.bin      # quantizeRgba の ms/フレームと近道の内訳(機械ノイズ無し)
npx vite-node scripts/quantties.ts                        # 整数距離と浮動小数距離の同距離入力の列挙(パレット変更時)
```

frametime の `present` は getImageData が描画コマンドを同期ラスタ化させる時間を含むので、present 単体の重さは
`getImageData`(読み戻しだけ)+`quantize` の行で見る。層ごとの重さは `--stages` で見る。

構成:

- `src/core/` カメラ、入力、ズーム
- `src/entities/` プレイヤー、物理、重力子砲
- `src/world/` ワールド生成、階層、施設、チャンク、破壊
- `src/render/` 描画、光、装飾、ドット絵パイプライン
- `docs/superpowers/` 設計書(`specs/`)と実装計画(`plans/`)
