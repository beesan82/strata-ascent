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

## URLパラメータ

| パラメータ | 内容 |
|---|---|
| `?seed=123` | ワールドのシード |
| `?x=&y=` | スポーン位置の上書き(タイル座標) |
| `?freeze=1` | シミュレーション停止(描画のみ) |
| `?debug=hierarchy[:タイル数]` | 地域階層の俯瞰表示 |

界面(階層の板)の座標は `src/world/interface.ts` の `passageX` / `interfaceTop` / `interfaceBottom` で求められる。
開始地点は常に cell 0 の前室(孔の左 24 タイル)。

## 開発

```powershell
npm test            # Vitest
npx tsc --noEmit    # 型チェック
npm run build       # 本番ビルド
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/shot.png
```

構成:

- `src/core/` カメラ、入力、ズーム
- `src/entities/` プレイヤー、物理、重力子砲
- `src/world/` ワールド生成、階層、施設、チャンク、破壊
- `src/render/` 描画、光、装飾、ドット絵パイプライン
- `docs/superpowers/` 設計書(`specs/`)と実装計画(`plans/`)
