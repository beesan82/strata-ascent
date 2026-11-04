# 実装計画: Capacitor アプリ化

設計書: `docs/superpowers/specs/2026-11-04-capacitor-app-design.md`(2026-11-04 ユーザー承認済み)
ブランチ: feat/capacitor-app

## Task

1. Capacitor 一式をインストールし、`capacitor.config.ts`(appId / appName / webDir=dist)を置く。
2. `npx cap add ios` で iOS プロジェクトを生成し、Info.plist を横向きのみに絞る。
3. `src/core/haptics.ts`(動的 import、Web では no-op)を追加し、main の
   被弾・発射・撃破の 3 点へ配線する。単体テストで Web 環境の no-op を固定する。
4. 起動時に画面の横向きロックとステータスバー非表示を行う初期化を main に足す
   (ネイティブ環境でのみ動く)。
5. codemagic.yaml(iOS: node 準備 → npm ci → build → cap sync → Xcode ビルド)を置く。
6. 検証: npm test、tsc、build、`npx cap sync`、開始画面の差分 0。

## 保留として残す見込み

- iOS 実ビルドの成否は Codemagic の実行結果でしか分からない(この VM に Xcode は無い)。
- 署名まわりの識別子(チーム ID 等)は Codemagic 側の設定に合わせる必要がある。

## 実装時の裁定

- Capacitor は 8.6.0 を採用(2026-11-04 時点の最新)。
- PC 開始画面の差分 321 px は第4段で足した HUD の HP 表示分のみで、
  本変更による描画差分は 0(bbox が HUD の HP 領域と一致)。
- 検証: テスト 505 件、tsc、build、`npx cap sync ios` すべて成功。
