# 実装計画: タッチ操作

設計書: `docs/superpowers/specs/2026-11-03-touch-controls-design.md`(2026-11-03 ユーザー承認済み)

## Task 1: Input にタッチ入口(テスト先行)

- `src/core/input.test.ts` を新規作成(window スタブで Input を生成できるようにする)。
  - `touchDown('KeyA')` で `state.left` が真、押下エッジが `takePressed()` に出る、入力コールバックが発火する。
  - `touchUp('KeyA')` で `state.left` が偽に戻る。
  - `touchDown('KeyF')` で `fireHeld` が真。
- `src/core/input.ts` に `touchDown` / `touchUp` を実装(keydown ハンドラの処理を寄せる)。
- 検証: `npm test`、`npx tsc --noEmit`。

## Task 2: 画面ボタン

- `src/core/touch.ts` を新規作成: `installTouchControls(input)`。
  - `@media (pointer: coarse)` に一致しない環境では何もしない。
  - 左下 ← →(KeyA/KeyD)、右下 ↑ ↓(KeyW/KeyS)・ジャンプ(Space)・砲(KeyF)。
  - Pointer Events + `setPointerCapture`、解放漏れ防止に pointercancel も解放扱い。
- `index.html` にボタン用 CSS を追加(半透明、大きめのタップ領域、既定は非表示、coarse のみ表示)。
- 検証: tsc、build。表示確認は Task 4 のエミュレーション撮影。

## Task 3: 配線と照準の既定、README

- `src/main.ts`: `installTouchControls(input)` を呼ぶ。
- `mouseSeen === false` のとき aimX を `player.facing`、aimY を 0 にし、`fire()` の角度も
  `mouseSeen` が無い場合は facing の水平角を使う(コーンとビームの一致を保つ)。
- README の操作表にタッチ操作を追記。
- 検証: テスト、tsc、build。

## Task 4: 総合検証と記録

- `npm test` 全件、`npx tsc --noEmit`、`npm run build`。
- スクリーンショット: PC 開始地点(変更前と差分 0 を確認)。
  タッチエミュレーション(Playwright、hasTouch + モバイル viewport)でボタンの表示を 1 枚。
- 本計画の末尾に裁定・計測・保留を追記する。

## 実装時の裁定

- 照準の既定は、設計書の「render の aim と fire() の角度の両方を倒す」ではなく、**render へ渡す
  マウス座標の合成 1 箇所**に寄せた。マウス未移動時は「画面中央 + facing 方向 1/4 画面」を渡す。
  aimAngle の出所が renderer の単一箇所のままになり、ライトコーンとビームが自動で一致する。
  あわせて viewState の aimX/aimY の既定も facing に倒した(眺望の向き)。
- README の操作表に残っていた改名漏れ(重力子砲 → 重粒子砲)もこの PR で直した。
  ディレクトリ説明側(63 行目)の旧名は改名計画の第 2 弾のまま据え置き。

## 計測

- 描画パス(内部バッファ)には触っていないため frametime 計測は省略。追加は DOM の重ね表示のみ。
- テスト 467 件(新規 3 件)全通過、`npx tsc --noEmit` 通過、`npm run build` 成功。
- PC 開始地点スクリーンショット(`--freeze=true`): 変更前との差分 208,590 画素・最大チャンネル差 132。
  差分の内容は「マウス未移動時の照準が画面左上 → 右水平に変わり、プレイヤーの銃とライトコーンの
  向きと照明が変わった」もので、意図した変更。タッチボタンは PC(coarse でない)では表示されない。
- タッチエミュレーション(iPhone 13 相当、hasTouch): ボタン 6 個の表示を確認。
  → ボタンを 1.5 秒押しっぱなしにしてプレイヤーが右へ歩きカメラが追従することも確認した。

## 実機フィードバック対応(2026-11-03、PR は別途)

- ユーザーの実機確認で「ボタン小さすぎて無理」。原因は viewport メタタグが無く、スマホ側が
  ページ全体を縮小表示していたため、64px のボタンが実寸でさらに小さくなっていたこと。
- 対策: viewport メタタグを追加(width=device-width, initial-scale=1, 拡縮無効)。
  ボタンは 80px に拡大(390px 幅で左右クラスタが重ならない上限)、文字 24px、
  下端は safe-area-inset 分を空ける。エミュレーションで getBoundingClientRect の実寸を測って確認する。
- viewport 追加でスマホ側のキャンバス表示倍率も本来の寸法になる(HUD の文字も大きくなる)。

## 保留

- `index.html` に viewport メタタグが無い。現状の表示は実機で問題なかったため今回は触らない。
  → 上記の実機フィードバック対応で追加した。
- 眺望(Shift)とミュート(M)のタッチ対応、照準のタッチ操作(狙う方向の指定)は非ゴールのまま。
- 実機での押し心地(ボタンの大きさ・位置)はユーザーの実機確認待ち。
