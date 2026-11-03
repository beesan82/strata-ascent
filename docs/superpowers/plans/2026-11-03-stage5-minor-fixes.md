# 段階5 保留 Minor の修正(落下粒の配分・タブ非表示時の音)実装計画

> 対象は `docs/superpowers/plans/2026-10-20-interface-ascent-stage5-ambient-audio.md` 末尾
> 「レビュー後の修正と保留(別エージェントのレビュー)」の Minor 2 件。新しい機能ではなく、
> 記録済みの不具合の修正なので、設計書は作らず本計画から始める(2026-11-03、ユーザーの「続けてくれ」で着手)。

## 原因(調査済み)

1. **落下粒の上限が画面外の光柱にも配られる**
   - `beaconsInView`(`src/render/beacon.ts`)は光溜まりの裾(軸 ±`POOL_FRINGE_RADIUS`=48)が視野に
     掛かる光柱を返す。一方、落下粒が実際に落ちるのは柱の軸 ±(`BEACON_HALF_WIDTH`−1)=±11。
   - `fallingDropsInView`(`src/render/ambient.ts`)は返ってきた光柱を順に回し、粒の X が視野の
     外でも `DROPS_MAX`(12)に数える。裾だけ掛かる光柱が最大 6 個を使い、後続の(画面内の)
     光柱の粒が打ち切られる。
2. **タブを隠しても音が鳴り続ける**
   - `main.ts` の `frame` は rAF 駆動で、タブが非表示になると rAF が止まり `updateAudio` が
     来なくなる。AudioContext は独立に進むので、ドローンとハムが最後のゲインのまま鳴り続ける。
   - `AudioEngine` に suspend / resume の口が無い。

## Task 1: 落下粒は柱が視野に掛かる光柱にだけ配る

- Files: `src/render/ambient.ts`、`src/render/ambient.test.ts`
- 失敗するテストを先に書く: 水系の光柱について、視野が裾(±48)だけに掛かり柱(±12)が
  視野の外にあるとき、粒は 0 個(修正前は最大 6 個返る)。
- 実装: `fallingDropsInView` の先頭で視野の X 範囲 `[x0, x1]` を求め、
  `b.x + BEACON_HALF_WIDTH < x0 || b.x - BEACON_HALF_WIDTH > x1` の光柱を落とす
  (段階5 計画末尾の提案「X で |b.x − camX| ≤ spanX/2 + 12 に絞る」と同じ)。
  上限の意味は変えない(1 画面 12 個、柱 1 本 6 個)。
- 検証: `npx vitest run src/render/ambient.test.ts` → PASS。

## Task 2: タブ非表示で AudioContext を suspend、復帰で resume

- Files: `src/audio/engine.ts`、`src/main.ts`(どちらもテスト対象外の層。tsc と headless の
  ページエラー無しで確認する)
- `AudioEngine.suspend()`: ctx があり state が `running` のときだけ `ctx.suspend()`。
- `AudioEngine.resume()`: ctx があり state が `suspended` のときだけ `ctx.resume()` を試みる。
  開始前・未開始ではどちらも no-op(既存の公開メソッドと同じ約束)。
- `main.ts`: `document.addEventListener('visibilitychange', …)` で hidden → suspend、
  visible → resume。ミュート状態とは独立(ミュートは master ゲイン、suspend は context 全体)。

## Task 3: 検証と計測

- `npm test`、`npx tsc --noEmit`、`npm run build`。
- スクリーンショット(変更前は本計画の着手時に取得済み): 開始地点、`--pos=244,66`、
  水系の光柱 `--pos=302,-1066.8`(いずれも `--freeze=true`)。差分画素数と最大チャンネル差を出す。
- 計測(`--stages`、各 2 回): 開始地点、歩行 `--pos=244,66 --press=KeyA`、水系 `--pos=302,-1066.8`。
  変更前の値(2026-11-03、この環境): 開始地点 render p50 8.4 / 8.6 ms、水系 8.3 / 8.1 ms
  (lighting p50 1.0 ms)。歩行は 12.6 / 9.0 ms とばらつきが大きい(他作業の負荷)。
- 計画末尾に「実装時の裁定」「計測」「保留」を追記する。

## 実装時の裁定(2026-11-03、この環境で実装)

- 落下粒の絞りは、計画末尾の 2 案のうち「柱の X で絞る」を採った。柱ごとに `12 / n` で分ける案は、
  視野内の柱が 1 本のときも粒が減って見え方が変わるため採らない。追加したテストは
  「裾だけ掛かる光柱 → 0 個／柱が掛かる光柱 → 1 個以上」で、修正前は 6 個返って失敗することを確認した。
- suspend / resume は `AudioEngine` の公開メソッドとし、状態が目標と違うときだけ呼ぶ
  (running のときだけ suspend、suspended のときだけ resume)。開始前の visibilitychange は no-op。
  自動再生制限で suspended のままの context を、タブ復帰の resume で勝手に起こさないため、
  resume の条件は「state が suspended であること」で、それが自分の suspend によるものか
  自動再生制限によるものかは区別していない(タブを戻す操作自体がユーザー操作に近く、
  resume が蹴られても入力時の start が再試行するので実害は無いと判断)。

## 計測(ヘッドレス=ソフトウェア描画、この VM で各 2 回、変更前は同日着手時)

| 場面(seed 20260711) | 変更前 render p50 | 変更後 render p50 | stage:lighting p50 |
|---|---|---|---|
| 開始地点 静止 | 8.4 / 8.6 ms | 8.8 / 9.4 ms | 0.8 → 0.8 ms |
| 244,66 歩行(`--press=KeyA`) | 12.6 / 9.0 ms | 10.7 / 11.6 ms | 1.1 → 1.1 ms |
| 水系の光柱 302,−1066.8 静止 | 8.3 / 8.1 ms | 10.5 / 8.8 ms | 1.0 → 1.0 ms |

- 対象 stage(lighting)は全場面で不変。render p50 の差は場面ごとの 2 回のばらつき
  (歩行の変更前は 3.6 ms 幅)の範囲内で、計測中は VM の他作業の負荷で rAF p95 が
  16.8〜66 ms と荒れた。性能への影響は無いと判断するが、静かな機械での再計測が望ましい。
- スクリーンショット(開始地点 / 244,66 / 302,−1066.8、いずれも `--freeze=true`)は
  変更前後で差分画素 0・最大チャンネル差 0。この 3 場面には裾だけ掛かる光柱が無く、
  修正の効果は上の単体テストで固定した(眺望 0.35 の広い視野で効く)。
- 検証: テストは 464 件(新規 1 件)。全並列では worldgen の既知の重い 1 件がこの VM で
  20 秒タイムアウトしたが、単独再実行で 36 件全通過(変更前と同じフレーク)。tsc・build 通過。
- タブ切替の実音確認は headless では鳴らないため未実施(コードレビューと tsc まで)。

## 保留(今回触らない)

- 残響バケットのヒステリシス、`traceAt` の早期棄却、灯の抽選 id の衝突、開始前の足音の
  追従(段階5 計画末尾の残りの Minor)。休憩点と塔の重なり、崩落出口の眺望・通過音も従来どおり。
