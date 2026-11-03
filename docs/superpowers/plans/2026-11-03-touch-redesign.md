# 実装計画: タッチ操作の根本刷新

設計書: `docs/superpowers/specs/2026-11-03-touch-redesign-design.md`(2026-11-03 ユーザー承認済み)

## Task 1: 土台(テスト先行)

- `src/entities/graviton.ts`: `cancelCharge()` を追加(溜め破棄、続く解放で発射しない)。
  `graviton.test.ts` に満溜め後キャンセル / 溜め途中キャンセルのケースを追加。
- `src/core/input.ts`: 照準ベクトル(setTouchAim 等)を照準点(setTouchPoint 等、CSS px)に
  置き換え、`requestFireCancel()/takeFireCancel()` を追加。テストも置き換える。
- `src/core/touch.ts`: 純粋関数 `cannonPhase(prev, dist)`(charging→aiming は 24px 超え、
  aiming→cancel は 38px 以内、cancel→aiming は 38px 超え)を置き、テストで固定する。
  stickKeys / aimStickState は廃止し、テストも差し替える。

## Task 2: touch.ts と CSS の刷新

- スティック 2 本を撤去。ボタン構成: ← →(74) / ↑ ↓(64、梯子時のみ) / 跳(84) / 砲(76) /
  眺望(48、右上)。
- 砲ボタン: pointer capture でドラッグを追い、cannonPhase に従って照準点の設定/解除と
  破棄色表示を行う。押下中は移動キーを全解放し、移動クラスタを無効化(aiming クラス)。
- `setTouchLadderVisible(visible)` を export し、梯子ボタンの表示を main から切り替える。
- index.html の coarse 用 CSS を作り替える(スティック用は削除)。

## Task 3: main.ts の配線

- 照準合成: マウス未使用時は照準点があればそれを、無ければ向きの水平を使う。
- `input.takeFireCancel()` が立っていたら graviton.update の前に cancelCharge() する。
- 開放度サンプリングと同じ 6 フレーム間引きで梯子近接を判定し、setTouchLadderVisible へ渡す
  (判定範囲: 中心列 ±1、中心行 -1 〜 足元行 +1 に TILE.LADDER があるか)。

## Task 4: 総合検証と記録

- `npm test` 全件、tsc、build。PC 開始地点は差分 0。
- エミュレーションで照準・発射・キャンセル・梯子ボタンを確認。本計画に裁定・計測・保留を追記。

## 実装時の裁定

- setPointerCapture は合成イベント等で例外になり得るため、失敗しても押下を継続する
  ようにした(実タッチでは従来どおり捕捉される)。
- 梯子近接の判定は開放度サンプリング(6 フレーム間引き)に相乗りした。開始直後の
  見える梯子列は「板の上側だけに梯子がある列」で、下に立つ間は表示されない
  (仕様どおりの近接判定。登り始めれば表示される)。

## 計測

- テスト 474 件全通過(差し替え: スティック系 -6、cannonPhase +3、graviton キャンセル +2、
  input 照準点/キャンセル +1)、`npx tsc --noEmit` 通過、`npm run build` 成功。
- 描画パスには触っていないため frametime 計測は省略。PC 開始地点の差分 0。
- タッチエミュレーション(CDP 実タッチ、座標は実ボタン中心を実測して使用):
  - 砲ドラッグで照準コーンが指の点(右上)を向き、溜めグローが出て、移動クラスタが
    フェードする様子を撮影確認。離して発射し、弾数が 3/3 → 2/3 になった。
  - ドラッグ後にボタンへ戻して離すとキャンセルされ、弾数は 2/3 のまま(不発)。
  - 孔の縦坑(x=196)で ↑ ↓ ボタンが表示されることを確認(クラスと撮影の両方)。

## 保留

- 実機での押し心地・ドラッグ照準の感覚はユーザー確認待ち。
- 照準プレビュー線(掘削範囲の線表示)は今回入れていない。レンダラの既存表示
  (コーン+溜めグロー)で足りるかは実機フィードバックで判断する。
