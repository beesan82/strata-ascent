import { expect, it } from 'vitest';
import { captionAlpha, captionText } from './caption';

it('字幕の文言', () => {
  expect(captionText(2, false)).toBe('第 2 階層');
  expect(captionText(3, true)).toBe('第 3 階層 — 大界面');
});

it('字幕の地区名: 地区が変わったときだけ併記し、大界面では必ず併記する', () => {
  expect(captionText(3, false, '居住区画')).toBe('第 3 階層 — 居住区画');
  expect(captionText(3, true, '居住区画')).toBe('第 3 階層 — 大界面 — 居住区画');
  expect(captionText(3, false, undefined)).toBe('第 3 階層');
});

it('2 秒表示して 0.5 秒でフェード', () => {
  expect(captionAlpha(-0.1)).toBe(0);
  expect(captionAlpha(0)).toBe(1);
  expect(captionAlpha(2)).toBe(1);
  expect(captionAlpha(2.25)).toBeCloseTo(0.5, 5);
  expect(captionAlpha(2.5)).toBe(0);
  expect(captionAlpha(10)).toBe(0);
});
