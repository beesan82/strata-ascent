# 実装計画: アクション化 第1弾

設計書: `docs/superpowers/specs/2026-11-04-action-phase1-design.md`(2026-11-04 ユーザー承認済み)
段ごとにブランチと PR を分け、各段でテスト → 実装 → 検証 → コミットを通す。

## 第1段: 移動の手触り(ブランチ feat/action-feel)

- player.test.ts に先にケースを追加: 加速(1 フレームで最高速にならない/数フレームで到達)、
  ジャンプカット(短押しは低く、長押しの最大高さは従来と同等)、コヨーテ(崖を出て
  0.1 秒以内は跳べる)、バッファ(着地 0.12 秒前の押下で着地と同時に跳ぶ)、落下加速。
- player.ts: 加速/減速、coyoteT / bufferT / prevJump の状態、ジャンプカット、落下重力 1.5 倍。
- 検証: npm test、tsc、build、PC スクリーンショット差分(静止画は不変のはず)。

## 第2段: パルス(ブランチ feat/pulse-weapon)

- pulse.ts: 弾配列と発射管理(連射間隔、射程、壁消滅)を純粋寄りに書き、テストで固定。
- input.ts: マウス押しっぱなしの追跡と pulseHeld(KeyJ / マウス / タッチ 'KeyJ')。
- main.ts: 8 方向の照準決定と発射配線。renderer の fx に pulses を追加して描く。
- touch.ts: 「射」ボタンを追加。発射中は ↑ ↓ 列も表示する(ladder 表示条件と OR)。
- 検証: テスト、tsc、build、エミュレーションで発射の撮影、frametime 3 場面。

## 第3段: 歩行敵(ブランチ feat/walker-enemy)

- enemy.ts: 巡回 AI(壁・床端反転)と HP。テストで固定(平坦床スタブ)。
- spawn.ts: 床ラン検出と hash による出現決定(純粋関数)。テストで固定。
- main.ts: 有効化範囲でのスポーン/デスポーン管理、パルスとの命中判定。
- renderer の fx に enemies を追加。
- 検証: テスト、tsc、build、エミュレーションで敵の表示と撃破を確認、frametime。

## 第4段: HP・被弾・復活(ブランチ feat/hp-and-damage)

- player.ts: hp / invulnT / lockT と damage()。テストで固定。
- main.ts: 接触判定、死亡→復活、休憩点での回復と復活点更新、HUD の HP 表示。
- renderer: 無敵点滅(プレイヤー描画の表示/非表示)。
- 検証: テスト、tsc、build、エミュレーションで被弾→復活の流れを確認、frametime。

## 共通

- 各段の PR に計測と保留を書き、計画の末尾へも追記する。
- gh-pages への反映は各段マージ後に行う(少なくとも第2段と第4段の完了時点で必ず)。
