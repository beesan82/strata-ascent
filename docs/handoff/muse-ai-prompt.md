# muse.ai 引き継ぎプロンプト(STRATA ASCENT)

以下を muse.ai の最初のメッセージとして貼り付ける。作業の決まりはリポジトリの `AGENTS.md` にあるので、このプロンプトは入口と現在地だけを伝える。

---

あなたは 2D ブラウザゲーム「STRATA ASCENT」の開発を、別の開発環境(Claude Code デスクトップ版)から引き継ぎます。返答と報告は日本語で書いてください。

## リポジトリ
- GitHub: https://github.com/beesan82/strata-ascent(public)。既定ブランチ `master`。
- Vite + TypeScript + Canvas 2D、テストは Vitest、スクリーンショットと計測は Playwright(headless Chromium)。Node 22 以上。
- 作業を始める前に次を全文読むこと。
  1. `AGENTS.md`(作業の決まり: 言語、毎回の検証、設計と計画の流れ、Git と PR、設計上の制約)
  2. `CLAUDE.md`(絶対に守ること、現在地、毎回の報告形式)
  3. `README.md`(起動、操作、URL パラメータ、スクリプト、ディレクトリ構成)
  4. `docs/superpowers/specs/2026-10-18-blame-sim-interface-ascent-design.md`(現在進めている設計書。§9 の段階分け、§10 設計者の判断、§11 実装者に委ねる点)
  5. `docs/superpowers/plans/2026-10-20-interface-ascent-stage5-ambient-audio.md` の末尾(直近の裁定・計測・保留)
  6. `docs/superpowers/notes/frame-budget.md`(フレーム予算の内訳と、描画を足すときの制約)

## 特に守ること(詳細は AGENTS.md)
- GPU のない環境で動く前提。性能は `node scripts/frametime.mjs --seed=20260711 [--pos=x,y] [--press=KeyA] --stages` の headless(ソフトウェア描画)で測り、GPU 前提の最適化を提案しない。
- 描画・性能に触る変更は、変更前後のスクリーンショット(`scripts/screenshot.mjs --freeze=true`、開始地点と `--pos=244,66`)と計測(render p50、stage ごとの p50、各 2 回)を PR に表で書く。
- `npm test`、`npx tsc --noEmit`、`npm run build` を通してから「完了」と報告する。CI は無い。
- `master` へ直接 push しない。ブランチと pull request で入れる。`git add -A` を使わず、自分が変えたファイルだけを stage する。
- 新しい機能は設計書(`docs/superpowers/specs/`)→ ユーザー承認 → 実装計画(`docs/superpowers/plans/`)→ Task ごとにテスト→実装→検証→コミット。
- ワールド生成は決定論(`Math.random()` 禁止)。内部バッファ 427×240 と 32 色量子化、CPU キャンバスの方針を壊さない。

## 現在の状態(2026-11-03 時点)
- `master` の先端は PR #9「feat: ambient audio」のマージ(`943c5b6`)。設計書「階層界面登攀ループ」の段階 1〜5(界面の板と通路、光柱と導光、眺望と通過演出、休憩点と大構造、動く世界と音)がすべて入っている。
- 性能は PR #5(主バッファ alpha:false、量子化キャッシュ 2^18)と PR #6(超構造の塔を焼き込みキャンバス化、約 5 ms → 1〜1.4 ms)で回収済み。開始地点の render p50 は約 7〜8 ms、歩行で約 9〜10 ms(予算 16.7 ms)。
- 保留(Minor)は段階5 の計画書末尾にある: 落下粒の上限が画面外の光柱にも配られる、残響バケットのヒステリシス、タブを隠したときの suspend/resume、灯の抽選 id の衝突など。超構造の焼き込みは環境色が 1 段変わる瞬間とズーム変更時に可視の全塔を同じフレームで焼き直す(約 5 ms のスパイク 1 回)。
- 音色は実機で聴いて調整する前提(headless では鳴らない)。

## 最初にやること
1. 上の文書を読み、`git log --oneline -15` と `gh pr list --state all --limit 10` で現状を確かめる。
2. `npm install` → `npm test`、`npx tsc --noEmit`、`npm run build` が通ることを確かめ、基準のスクリーンショットと計測を取る(headless Chromium が無ければ `npx playwright install chromium`)。
3. 読んだ内容の要約と、文書と実態のずれがあればその一覧を報告し、続きの作業はユーザーの指示を待つ。
