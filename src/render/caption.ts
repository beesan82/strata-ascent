// 通過演出の字幕(§6.5)。キャンバスに描くと量子化の対象になり色数と時間が増えるので、HUD と同じく DOM に置く。

/** 字幕を不透明で出す時間(秒) */
export const CAPTION_HOLD_SECONDS = 2;
/** その後のフェードアウト時間(秒) */
export const CAPTION_FADE_SECONDS = 0.5;

/**
 * 「第 n 階層」。大界面を越えたときは「— 大界面」を添える。
 * 地区名が渡された場合（地区が変わったとき、または大界面）は末尾に「— 〈地区名〉」を併記する。
 */
export function captionText(layer: number, great: boolean, districtName?: string): string {
  let text = `第 ${layer} 階層`;
  if (great) text += ' — 大界面';
  if (districtName) text += ` — ${districtName}`;
  return text;
}

/**
 * 端末の断片テキスト(設計 2026-11-10-infrastructure §4)を不透明で出す時間(秒)。
 * 文が通過演出の字幕より長いので、読み切れるよう長めに保つ
 */
export const TERMINAL_CAPTION_HOLD_SECONDS = 5;

/** 表示開始からの経過秒 → 不透明度。hold 秒(既定 2 秒)は 1、続く 0.5 秒で線形に 0 へ */
export function captionAlpha(elapsed: number, hold: number = CAPTION_HOLD_SECONDS): number {
  if (elapsed < 0) return 0;
  if (elapsed <= hold) return 1;
  const t = (elapsed - hold) / CAPTION_FADE_SECONDS;
  return t >= 1 ? 0 : 1 - t;
}

/** DOM の字幕要素。テスト対象外(文言と不透明度は上の純粋関数) */
export class Caption {
  private start = -Infinity;
  private hold = CAPTION_HOLD_SECONDS;

  constructor(private el: HTMLElement) {}

  /** hold は不透明で出す秒数(省略時は通過演出と同じ 2 秒) */
  show(text: string, now: number, hold: number = CAPTION_HOLD_SECONDS): void {
    this.el.textContent = text;
    this.start = now;
    this.hold = hold;
  }

  update(now: number): void {
    this.el.style.opacity = String(captionAlpha(now - this.start, this.hold));
  }
}
