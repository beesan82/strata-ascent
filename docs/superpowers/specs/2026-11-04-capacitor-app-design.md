# 設計書: Capacitor アプリ化(推奨ルート 第1歩)

状態: ユーザー承認済み(2026-11-04)。Fable の技術検討(同日)に基づく推奨ルート
「Capacitor → GPU 化検証」の第1歩。ネイティブ作り直しは「Web の天井」が具体的に
判明した場合の分岐として残す。

## 目的

現行 Web 版をそのまま Capacitor の殻に入れ、TestFlight で配れる iOS アプリにする。
ゲームのコードと 504 テストは無傷で残すことが絶対条件。

## 入れるもの

- Capacitor(core / cli / ios)と公式プラグイン: haptics、screen-orientation、status-bar。
  ランタイム依存ゼロという従来の決まりへの例外は、このアプリ用パッケージに限る。
  ゲーム本体は Capacitor を動的 import の裏に隠し、Web では無効化される。
- アプリ ID: `com.strataascent.app`、表示名: STRATA ASCENT。
- 横向き固定(screen-orientation でロックし、Info.plist でも横向きのみに絞る)。
- ステータスバーを隠して完全な全画面にする。
- 振動フィードバック(最小限): 被弾 = 中、重粒子砲の発射 = 強、敵の撃破 = 弱。
  Web では一切鳴らない(no-op)。
- Codemagic 用のワークフロー定義(codemagic.yaml)を置き、既存の TestFlight
  パイプライン(Pocket Agent / MUSICAGE)に乗せる。

## 入れないもの

- Android(まず iOS で検証する。Capacitor なら後付け可能)。
- 描画の GPU 化(第2歩の検証スパイクで別途扱う)。
- ゲーム内容の変更。

## 検証

- Web 側: npm test / tsc / build が従来どおり通ること、開始画面の差分 0。
- 殻側: `npx cap sync` が成功し、ios/ に web 資産とプラグインが入ること。
  iOS の実ビルドは Codemagic で行い、TestFlight での実機確認はユーザーが行う。
