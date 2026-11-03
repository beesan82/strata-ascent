# AGENTS.md — BLAME! SIM の作業の決まり

AI エージェント(Claude Code、muse.ai など)と人が、このリポジトリで作業するときの決まり。
何を作るかは `docs/superpowers/specs/`(設計書)と `docs/superpowers/plans/`(実装計画)にある。
この文書は「どう作業するか」だけを書く。

## 言語
- 返答・報告・PR 本文・設計書・計画・コード内コメントは日本語で書く。コミットメッセージの件名は英語でよい(本文は日本語でよい)。
- コード識別子・コマンド・ファイル名はそのまま書く。

## 開発環境の前提
- Vite + TypeScript + Canvas 2D。外部ランタイム依存なし(devDependencies のみ)。Node 22 以上、npm 11 で確認している。版は `package-lock.json` に固定してある。
- **GPU のない環境で動くアプリを想定している。** 性能は Playwright の headless 既定(SwiftShader = ソフトウェア描画)で測り、それを基準にする。実 GPU での再確認は不要で、GPU 前提の最適化(シェーダー、WebGL)は提案しない。
- CI は無い。検証はすべてローカルで行い、通していない変更は「未検証」と報告する。
- Windows の PC で開発している。パスに `!` を含む(`blame!sim`)ので、bash で引用符の扱いに注意する。

## 毎回の検証(完了と言う前に全部通す)

```powershell
npm test            # Vitest(約 400 テスト、20 秒)
npx tsc --noEmit    # 型チェック
npm run build       # 本番ビルド
```

描画に触ったら、さらにスクリーンショットと計測:

```powershell
node scripts/screenshot.mjs --seed=20260711 --freeze=true --out=screenshots/start.png
node scripts/screenshot.mjs --seed=20260711 --freeze=true --pos=244,66 --out=screenshots/p244.png
node scripts/frametime.mjs --seed=20260711 --stages
node scripts/frametime.mjs --seed=20260711 --pos=244,66 --press=KeyA --stages
node scripts/frametime.mjs --seed=20260711 --pos=40,60 --stages
```

- 見た目の変更は変更前後のスクリーンショットを同じ機械・同じ引数で撮り、差分画素数と最大チャンネル差を PR に書く。差分 0 が目標でないときは、何が変わるかを計測と並べて明記する。
- 性能の変更は `render` の p50 と `stage:<層>` の p50 を変更前後で 2 回ずつ取り、表にして PR に書く。計測中に他の処理を走らせない(max に 500 ms 級の外れ値が乗る)。
- フレーム予算の内訳と設計上の制約は `docs/superpowers/notes/frame-budget.md`。
- `screenshots/` は `.gitignore` 対象。画像はコミットしない。

## 設計と計画の流れ
1. 新しい機能・見た目の変更は、まず設計書(`docs/superpowers/specs/YYYY-MM-DD-<題>-design.md`)を書き、ユーザーの承認を得る。
2. 設計書から実装計画(`docs/superpowers/plans/YYYY-MM-DD-<題>.md`)を Task 単位で書く。各 Task はテスト → 実装 → 検証 → コミットの順。
3. 実装が終わったら計画の末尾に「実装時の裁定」「計測」「保留」を追記する(計画書のチェックボックスは更新しない。進捗は Git と実コードで判断する)。
4. 純粋関数(ワールド生成、配置、色、パラメータ計算)は Vitest で固定する。Canvas に触る部分はテストせず、スクリーンショットと計測で確かめる。
5. 直す前に原因を突き止める(症状への当て推量の修正をしない)。

## Git と PR
- 既定ブランチは `master`。作業はブランチ(`feat/…`、`perf/…`、`fix/…`、`docs/…`)で行い、pull request で `master` に入れる。`master` へ直接 push しない。
- PR 本文は日本語で、目的・変更点・検証(テスト数、tsc、build)・計測表・見た目の差分・残課題を書く。
- `git add -A` や `git commit -a` は使わない。自分が変えたファイルだけを明示して stage する。自分が作っていない未追跡ファイルには触れない。
- 複数の作業者が同じリポジトリに並行して PR を出す。push の前に `git fetch` し、base が進んでいれば merge か rebase してから push する。
- 作業ツリーは `.claude/worktrees/`、`.worktrees/` に複製されることがある(`.gitignore` 済み、Vitest も除外)。

## 設計上の制約(壊さないこと)
- ワールドはシードから決定論で生成する。`Math.random()` を生成・描画に使わない(画面シェイクだけは例外として既存)。
- 内部バッファは 427×240 で、量子化(32 色 + グレイン)して整数倍で画面へ転写する。描画はすべて内部バッファ座標で行う。
- 描画キャンバスは CPU キャンバス(`getContext('2d', { willReadFrequently: true })`)に揃える。
- 新しい描画は「平坦な色・少ない色数・`lighter` の画素数最小」で設計し、毎フレーム描き直すのでなく焼き込み(チャンク、塔、空のフィル)へ相乗りする。
- 1 フレーム 16.7 ms の予算はほぼ使い切っている。描画を足すときは必ず前後の計測を添える。

## 秘密情報
- このリポジトリに秘密情報は無く、要らない。API キーやトークンを求めない、置かない。
