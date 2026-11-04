import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.strataascent.app',
  appName: 'STRATA ASCENT',
  webDir: 'dist',
  ios: {
    // ゲーム画面は Safe Area の内側に寄せず、全画面を使う
    contentInset: 'never',
  },
};

export default config;
