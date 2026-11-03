# Claude Code 開発ガイド — STRATA ASCENT

作業の進め方(言語、検証、設計と計画の流れ、Git と PR、設計上の制約)は `AGENTS.md` に従うこと。
起動・操作・URL パラメータ・スクリプトは `README.md`。

## 絶対に守ること
- 返答・報告・PR 本文は日本語。
- GPU のない環境で動く前提。性能は headless(ソフトウェア描画)で測り、GPU 前提の最適化を提案しない。
- 描画・性能の変更は変更前後のスクリーンショットと `scripts/frametime.mjs` の計測を添える(`AGENTS.md` の手順)。
- 未検証の変更を「完了」と報告しない。`npm test`、`npx tsc --noEmit`、`npm run build` を通してから報告する。
- `master` へ直接 push しない。ブランチと pull request で入れる。

## 現在地
- 「階層界面登攀ループ」(`docs/superpowers/specs/2026-10-18-blame-sim-interface-ascent-design.md`)の段階 1〜5 が `master` に入っている(PR #3、#4、#7、#8、#9)。
- 描画性能は PR #5(不透明主バッファ・量子化キャッシュ)と PR #6(超構造の焼き込み)で回収済み。内訳は `docs/superpowers/notes/frame-budget.md`。
- 残っている保留は各計画書末尾の「保留」節(最新は `docs/superpowers/plans/2026-10-20-interface-ascent-stage5-ambient-audio.md`)。

## 毎回の報告形式
- 変更ファイル
- 具体的な実装内容
- 実行した検証(テスト数、tsc、build、スクリーンショット、計測)と結果
- 見た目・性能で変わった点
- 未確認事項・保留
- 次の推奨作業

## 作業の始め方
1. `AGENTS.md`、`README.md`、最新の設計書と計画書の末尾(裁定・計測・保留)を読む。
2. `git log --oneline -15` と `gh pr list --state all --limit 10` で現状を確かめる。
3. `npm install` の後に `npm test` を通し、基準のスクリーンショットと計測を先に取る。
