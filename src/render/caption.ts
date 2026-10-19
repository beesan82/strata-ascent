// 通過演出の字幕(§6.5)。キャンバスに描くと量子化の対象になり色数と時間が増えるので、HUD と同じく DOM に置く。

/** 字幕を不透明で出す時間(秒) */
export const CAPTION_HOLD_SECONDS = 2;
/** その後のフェードアウト時間(秒) */
export const CAPTION_FADE_SECONDS = 0.5;

/** 「第 n 階層」、大界面を越えたときは「第 n 階層 — 大界面」 */
export function captionText(layer: number, great: boolean): string {
  return great ? `第 ${layer} 階層 — 大界面` : `第 ${layer} 階層`;
}

/** 表示開始からの経過秒 → 不透明度。2 秒は 1、続く 0.5 秒で線形に 0 へ */
export function captionAlpha(elapsed: number): number {
  if (elapsed < 0) return 0;
  if (elapsed <= CAPTION_HOLD_SECONDS) return 1;
  const t = (elapsed - CAPTION_HOLD_SECONDS) / CAPTION_FADE_SECONDS;
  return t >= 1 ? 0 : 1 - t;
}

/** DOM の字幕要素。テスト対象外(文言と不透明度は上の純粋関数) */
export class Caption {
  private start = -Infinity;

  constructor(private el: HTMLElement) {}

  show(text: string, now: number): void {
    this.el.textContent = text;
    this.start = now;
  }

  update(now: number): void {
    this.el.style.opacity = String(captionAlpha(now - this.start));
  }
}
