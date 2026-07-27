import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 段階Fの装飾テストは decorateChunk(64x64バッファ生成+多数のセグメント走査)を
    // 広域スキャンする。メモ化で高速化済みだが、全ファイル並列実行のCPU競合下では
    // 100チャンク級の初回計算がデフォルト5秒を稀に超えるため、余裕を持たせる。
    testTimeout: 20000,
  },
});
