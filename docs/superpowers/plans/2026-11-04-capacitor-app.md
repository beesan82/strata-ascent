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

## 実装時の裁定(2026-11-04、TestFlight 配信完了後に追記)

- Codemagic ビルド 1〜9 を経て、ビルド 9 で App Store Connect へのアップロード成功、輸出コンプライアンス申告(「どれでもない」)と Internal Testers グループ追加まで完了し、TestFlight でインストール可能な状態になった。
- 署名は「保存済み identities 方式」が正解だった。ビルド中に `app-store-connect fetch-signing-files` で取得する方式は、証明書の秘密鍵が Codemagic 側に無いため `Cannot save Signing Certificates without certificate private key` で必ず失敗する。Pocket Agent / MUSICAGE と同じく、チーム設定の Code signing identities に証明書(pocketagent-dist)とプロファイル(strata-appstore)を保存し、yaml の `ios_signing` は選ぶだけにする(PR #27)。`environment.ios_signing` の自動照合だけでも、identities 未保存だと "No matching profiles found" で落ちる(PR #24 の連携名修正だけでは不十分)。
- Capacitor 8 は Swift Package Manager 方式で Podfile が生成されない。`pod install` ステップは置かない(PR #26)。
- 横向き専用は `UIRequiresFullScreen=true` が必須。無いと iPad マルチタスク検証(ASC エラー 90474)でアップロードが拒否される(PR #28)。
- 輸出コンプライアンスは `ITSAppUsesNonExemptEncryption=false` を Info.plist に入れて恒常化した(PR #29)。本アプリは完全オフラインで暗号化を使わない。
- publishing は `submit_to_testflight: false` + ASC 側の内部テストグループ(自動配信)という Pocket Agent / MUSICAGE の運用に合わせた。ただし altool アップロードではグループへ自動で入らなかったため、初回は ASC で手動追加した。
- 残る確認: 実機での起動・全画面・横向き・振動の確認と、面白さ判定(第1弾の3点)。その後の第2歩は描画 GPU 化の検証スパイク。
