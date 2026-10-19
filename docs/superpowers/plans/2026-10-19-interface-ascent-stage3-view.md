# 階層界面登攀 段階3「眺望と通過演出」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 見晴らし台に出た瞬間の自動眺望(広角で下を流す)と、Shift 長押しの手動眺望、字幕「第 n 階層」、HUD の階層表示を入れる。

**Architecture:** 眺望は純粋関数 `viewState(prev, input, dt)`(`src/core/view.ts`)の状態機械で、出力は「目標ズーム」と「カメラ中心のオフセット(タイル)」だけ。`Camera` は従来どおり目標へ指数平滑で追従する。見晴らし台の判定と階層番号は `src/world/interface.ts` の純粋関数。字幕と HUD は DOM(`index.html` の `#caption` / `#hud`)で、キャンバスの量子化パイプラインに画素を足さない。

**Tech Stack:** Vite + TypeScript + Canvas 2D、Vitest。計測はヘッドレス Chromium(ソフトウェア描画)の `scripts/frametime.mjs`。

**Spec:** `docs/superpowers/specs/2026-10-18-blame-sim-interface-ascent-design.md` §6.4、§6.5、§9 段階3。段階2 の裁定と性能ルールは `docs/superpowers/plans/2026-10-18-interface-ascent-stage2-beacon.md` 末尾。

## Global Constraints

- `ZOOM_STEPS = [0.35, 0.5, 0.75, 1]`。0.35 は開放度からは選ばれず、眺望状態だけが要求する(§6.4)。
- 手動眺望: 接地・静止中に Shift 押下で目標ズーム 0.35、中心をマウス方向へ最大 40 タイル。移動キーで即解除(§6.4)。
- 自動眺望: 見晴らし台の床に接地した瞬間、2.5 秒間ズーム 0.35・中心を下へ 30 タイル流してから戻す。入力で打ち切り。同じ界面で 2 回目以降は発火しない(§6.4)。
- 字幕「第 n 階層」(大界面は「第 n 階層 — 大界面」)を画面中央下に 2 秒表示、0.5 秒でフェードアウト。HUD と同じ等幅、文字間 0.3em(§6.5)。
- HUD「座標 Y」→「第 n 階層 / 高度 m」。n は到達した最高階層で減らない(§6.5)。`layerNumber(seed, cell)`: 開始層(cell 0)が第 1 階層、上(cell が小さい方向)へ増える。
- 座標: Y は下向き正。cell c の板は cell c の上端(`interfaceTop(seed,c)`)にあり、板の上の層は cell c−1。
- 性能: ヘッドレス(ソフトウェア描画)で rAF p95 ≤ 16.7 ms を、見晴らし台 (210,−12) と Shift 長押しの眺望 0.35 の両方で満たす。新しい描画は足さない(字幕は DOM)。
- コメントは日本語。既存テスト全通過、`tsc`・`build` 成功。

## Review Focus

1. 梯子を登り切って `D` を押したまま見晴らし台に着地する(着地の瞬間に移動キーが押されている)。自動眺望は発火し、押し続けても打ち切られない。打ち切るのは**新たに押された**移動キーだけ(Task 2 のテスト「押しっぱなしの移動キーでは打ち切らない」)。
2. 見晴らし台から大穴へ落ちて前の層へ戻り、再び登る。同じ板では 2 度目は発火しない。さらに上の板で再び発火する(Task 2「発火済みより上の板でだけ発火」)。
3. 眺望中に走り出す。ズームとオフセットの目標は即座に基準へ戻り、カメラは平滑で追従する(Task 2「移動入力で即解除」)。
4. 開放度が最大でもズームは 0.5 に留まる(Task 1「開放度由来の目標は 0.35 にならない」)。
5. 落下で階層が下がっても HUD の n は減らない(Task 5 の `highestLayer` テスト)。

---

### Task 1: ズーム段 0.35

**Files:**
- Modify: `src/core/zoom.ts`
- Test: `src/core/zoom.test.ts`

**Interfaces:**
- Produces: `export const VIEW_ZOOM = 0.35`、`ZOOM_STEPS = [0.35, 0.5, 0.75, 1]`。`MIN_ZOOM`(0.5)と `targetZoomForOpenness` は変えない。

- [ ] **Step 1: テストを書き換える・足す(`zoom.test.ts`)**

「段の両端が MIN_ZOOM/MAX_ZOOM と一致する」を次に差し替え、タイブレークと範囲外のケースを 0.35 対応にする。

```ts
it('段は [VIEW_ZOOM, MIN_ZOOM, ..., MAX_ZOOM]。0.35 は眺望専用', () => {
  expect(ZOOM_STEPS).toEqual([VIEW_ZOOM, 0.5, 0.75, 1]);
  expect(ZOOM_STEPS[1]).toBe(MIN_ZOOM);
  expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(MAX_ZOOM);
});
it('開放度由来の目標ズームは量子化しても 0.35 にならない', () => {
  for (let o = 0; o <= 1; o += 0.01) expect(quantizeZoom(targetZoomForOpenness(o))).toBeGreaterThanOrEqual(MIN_ZOOM);
});
it('段の中点は決定論的に低い段へ寄る(タイブレーク)', () => {
  expect(quantizeZoom(0.875)).toBe(0.75);
  expect(quantizeZoom(0.625)).toBe(0.5);
  expect(quantizeZoom(0.425)).toBe(VIEW_ZOOM);
});
```
`quantizeZoom(0.1)` の既存テストは `Math.min(...ZOOM_STEPS)` のままで通る。

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/core/zoom.test.ts` Expected: 新 2 件 FAIL(`VIEW_ZOOM` 未定義)

- [ ] **Step 3: 実装** — `zoom.ts` に `export const VIEW_ZOOM = 0.35;`(眺望専用の段。開放度の写像 `targetZoomForOpenness` は `[MIN_ZOOM, MAX_ZOOM]` にクランプするので選ばれない、とコメント)。`ZOOM_STEPS = [VIEW_ZOOM, 0.5, 0.75, 1]`。コメントの「3段」を「4段」に直す。

- [ ] **Step 4: 通過確認** — Run: `npx vitest run src/core/zoom.test.ts` Expected: PASS

- [ ] **Step 5: コミット** — `git commit -am "feat: add view-only zoom step 0.35"`

---

### Task 2: 眺望の状態遷移 `viewState`

**Files:**
- Create: `src/core/view.ts`
- Test: `src/core/view.test.ts`

**Interfaces:**
- Consumes: `VIEW_ZOOM`(Task 1)。
- Produces:

```ts
export const MANUAL_OFFSET_TILES = 40;   // 手動眺望の最大オフセット
export const AUTO_SECONDS = 2.5;         // 自動眺望の長さ
export const AUTO_FLOW_TILES = 30;       // 自動眺望で下へ流す距離
export const AUTO_FLOW_SECONDS = 1.5;    // 0→30 タイルに達するまでの時間(残りは保持)
export type ViewMode = 'none' | 'manual' | 'auto';
export interface ViewInput {
  shift: boolean;      // Shift 押下
  moving: boolean;     // 移動キー(左右・上下・ジャンプ)のいずれか押下
  grounded: boolean;   // body.onGround
  still: boolean;      // 接地かつ vx === 0
  aimX: number;        // 画面中心からマウスへの向き(−1..1、画面半幅で正規化)
  aimY: number;
  overlookCell: number | null; // 見晴らし台の床に立っていればその板の cell(Task 3 の overlookCellAt)
  baseZoom: number;    // 開放度由来の目標ズーム(量子化済み)
}
export interface ViewState {
  mode: ViewMode;
  autoElapsed: number;          // 自動眺望の経過秒
  autoFiredMinCell: number | null; // 自動眺望を発火した最も上の板の cell(これ未満でのみ再発火)
  prevMoving: boolean;          // 前フレームの moving(立ち上がり検出)
  zoom: number;                 // 出力: 目標ズーム
  offsetX: number;              // 出力: カメラ中心の目標オフセット(タイル、プレイヤー中心基準)
  offsetY: number;
}
export const INITIAL_VIEW: ViewState;  // mode 'none', zoom 1, offset 0, autoFiredMinCell null
export function viewState(prev: ViewState, input: ViewInput, dt: number): ViewState;
export function autoViewStarted(prev: ViewState, next: ViewState): boolean; // prev.mode !== 'auto' && next.mode === 'auto'
```

遷移規則(この順で判定):
1. **自動の発火**: `input.overlookCell !== null && input.grounded` かつ(`autoFiredMinCell === null` または `overlookCell < autoFiredMinCell`)→ `mode='auto'`, `autoElapsed=0`, `autoFiredMinCell=overlookCell`。手動中でも奪う。
2. **自動の継続/終了**: `mode==='auto'` のとき、`input.moving && !prev.prevMoving`(新たに押された移動キー)で `none` へ。それ以外は `autoElapsed += dt`、`>= AUTO_SECONDS` で `none`。継続中の出力は `zoom=VIEW_ZOOM`, `offsetX=0`, `offsetY = AUTO_FLOW_TILES * min(1, autoElapsed / AUTO_FLOW_SECONDS)`。
3. **手動**: `mode!=='auto'` で `input.shift && input.grounded && input.still && !input.moving` なら `manual`(それ以外は `none`)。`manual` の出力は `zoom=VIEW_ZOOM`、オフセットは `(aimX, aimY) * MANUAL_OFFSET_TILES` を長さ `MANUAL_OFFSET_TILES` にクランプしたもの。
4. **none** の出力: `zoom=input.baseZoom`, `offset=(0,0)`。
5. 常に `prevMoving = input.moving`。

- [ ] **Step 1: 失敗するテスト(`view.test.ts`)**

`const base: ViewInput = { shift:false, moving:false, grounded:true, still:true, aimX:0, aimY:0, overlookCell:null, baseZoom:1 }` と `const step = (s, patch, dt=1/60) => viewState(s, {...base, ...patch}, dt)` を用意。

```ts
describe('手動眺望', () => {
  it('接地・静止で Shift を押すと 0.35、マウス方向へ最大 40 タイル', () => {
    const s = step(INITIAL_VIEW, { shift: true, aimX: 1, aimY: 1 });
    expect(s.mode).toBe('manual'); expect(s.zoom).toBe(VIEW_ZOOM);
    expect(Math.hypot(s.offsetX, s.offsetY)).toBeCloseTo(MANUAL_OFFSET_TILES, 5);
    const t = step(INITIAL_VIEW, { shift: true, aimX: -0.5, aimY: 0 });
    expect(t.offsetX).toBeCloseTo(-20, 5); expect(t.offsetY).toBe(0);
  });
  it('空中・歩行中は入らない', () => {
    expect(step(INITIAL_VIEW, { shift: true, grounded: false, still: false }).mode).toBe('none');
    expect(step(INITIAL_VIEW, { shift: true, still: false }).mode).toBe('none');
  });
  it('移動入力で即解除し、出力は基準へ戻る', () => {
    const s = step(INITIAL_VIEW, { shift: true, aimX: 1 });
    const t = step(s, { shift: true, moving: true, still: false, baseZoom: 0.75 });
    expect(t.mode).toBe('none'); expect(t.zoom).toBe(0.75); expect(t.offsetX).toBe(0);
  });
  it('Shift を離すと解除', () => {
    const s = step(INITIAL_VIEW, { shift: true });
    expect(step(s, {}).mode).toBe('none');
  });
});
describe('自動眺望', () => {
  it('見晴らし台に接地した瞬間に発火し、中心が下へ 30 タイルまで流れ、2.5 秒で戻る', () => {
    let s = step(INITIAL_VIEW, { overlookCell: 0 });
    expect(s.mode).toBe('auto'); expect(s.zoom).toBe(VIEW_ZOOM); expect(s.offsetY).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) s = step(s, { overlookCell: 0 }); // 約 1.7 秒
    expect(s.offsetY).toBeCloseTo(AUTO_FLOW_TILES, 3); expect(s.offsetX).toBe(0);
    for (let i = 0; i < 60; i++) s = step(s, { overlookCell: 0 }); // 計 2.68 秒
    expect(s.mode).toBe('none'); expect(s.zoom).toBe(1); expect(s.offsetY).toBe(0);
  });
  it('同じ板では 2 回目は発火しない。発火済みより上の板でだけ発火', () => {
    let s = step(INITIAL_VIEW, { overlookCell: 0 });
    for (let i = 0; i < 200; i++) s = step(s, { overlookCell: 0 });
    expect(s.mode).toBe('none');
    s = step(s, { overlookCell: null, grounded: false }); s = step(s, { overlookCell: 0 });
    expect(s.mode).toBe('none');
    s = step(s, { overlookCell: -1 }); expect(s.mode).toBe('auto');
    for (let i = 0; i < 200; i++) s = step(s, { overlookCell: -1 });
    s = step(s, { overlookCell: 0 }); expect(s.mode).toBe('none'); // 下へ戻っても再発火しない
  });
  it('新たに押された移動キーで打ち切る', () => {
    let s = step(INITIAL_VIEW, { overlookCell: 0 });
    s = step(s, { overlookCell: 0, moving: true, still: false });
    expect(s.mode).toBe('none');
  });
  it('押しっぱなしの移動キーでは打ち切らない(梯子から D のまま着地)', () => {
    let s = step(INITIAL_VIEW, { moving: true, still: false, grounded: false });
    s = step(s, { moving: true, still: false, overlookCell: 0 });
    expect(s.mode).toBe('auto');
    s = step(s, { moving: true, still: false, overlookCell: 0 });
    expect(s.mode).toBe('auto');
  });
  it('autoViewStarted は発火したフレームだけ true', () => {
    const s = step(INITIAL_VIEW, { overlookCell: 0 });
    expect(autoViewStarted(INITIAL_VIEW, s)).toBe(true);
    expect(autoViewStarted(s, step(s, { overlookCell: 0 }))).toBe(false);
  });
  it('決定論: 同じ列で同じ出力', () => { /* 2 回走らせて toEqual */ });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/core/view.test.ts` Expected: FAIL(モジュール無し)

- [ ] **Step 3: `view.ts` を実装**(上の規則どおり。状態は毎回新しいオブジェクトを返す。日本語コメントで §6.4 の対応と「押しっぱなしでは打ち切らない」理由を書く)

- [ ] **Step 4: 通過確認** — Run: `npx vitest run src/core/view.test.ts && npx tsc --noEmit` Expected: PASS

- [ ] **Step 5: コミット** — `git add src/core/view.ts src/core/view.test.ts && git commit -m "feat: pure view-state machine for manual and automatic overlook"`

---

### Task 3: `overlookCellAt` と `layerNumber`

**Files:**
- Modify: `src/world/interface.ts`
- Test: `src/world/interface.test.ts`

**Interfaces:**
- Produces:
  - `export const START_CELL = 0;`
  - `export function layerNumber(_seed: number, cell: number): number` = `START_CELL - cell + 1`(seed は将来の開始セル依存のために受けるが未使用。`noUnusedParameters` のため `_seed`)。
  - `export function overlookCellAt(seed: number, x: number, footRow: number): number | null` — 足元の行 `footRow`(接地時は `Math.round(body.y + body.h)`)が板 cell の上面 `interfaceTop(seed, cell)` と一致し、`x ∈ [px − OVERLOOK_LEFT, px + HOLE_OFFSET)`(大穴の手前まで。`px = nearestPassage(seed, cell, x).x`)、かつ `x !== px`(梯子列)ならその cell。候補は `biomeCellAt(seed, footRow)` と `+1`(`interfaceTileAt` と同じ理由)。

- [ ] **Step 1: 失敗するテスト(`interface.test.ts` に追記)**

```ts
describe('layerNumber', () => {
  it('開始層 cell 0 は第 1 階層、上(cell が小さい)へ 1 ずつ増え、決定論', () => {
    expect(layerNumber(20260711, 0)).toBe(1);
    expect(layerNumber(20260711, -1)).toBe(2);
    expect(layerNumber(20260711, 1)).toBe(0);
    for (let c = 5; c > -10; c--) expect(layerNumber(42, c - 1)).toBe(layerNumber(42, c) + 1);
    expect(layerNumber(1, -3)).toBe(layerNumber(2, -3));
  });
});
describe('overlookCellAt', () => {
  it('seed 20260711 の cell 0: 板の上面 −9 に立つ X 184〜219(梯子列 196 を除く)で 0、大穴側・下の行は null', () => {
    const seed = 20260711, top = interfaceTop(seed, 0), px = passageX(seed, 0, 0);
    expect(top).toBe(-9); expect(px).toBe(196);
    expect(overlookCellAt(seed, 210, top)).toBe(0);
    expect(overlookCellAt(seed, px - OVERLOOK_LEFT, top)).toBe(0);
    expect(overlookCellAt(seed, px, top)).toBe(null);
    expect(overlookCellAt(seed, px + HOLE_OFFSET, top)).toBe(null);
    expect(overlookCellAt(seed, px - OVERLOOK_LEFT - 1, top)).toBe(null);
    expect(overlookCellAt(seed, 210, top + 1)).toBe(null);
    expect(overlookCellAt(seed, 210, top - 1)).toBe(null);
  });
  it('全 seed・cell・k で見晴らし台の床の上は HARD', () => {
    for (const seed of seeds) for (let cell = -3; cell <= 2; cell++) for (const k of [-2, 0, 3]) {
      const px = passageX(seed, cell, k), top = interfaceTop(seed, cell);
      expect(overlookCellAt(seed, px + 4, top)).toBe(cell);
      expect(interfaceTileAt(seed, px + 4, top)).toBe(TILE.HARD);
      expect(interfaceTileAt(seed, px + 4, top - 1)).not.toBe(TILE.HARD);
    }
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/world/interface.test.ts` Expected: 新 3 件 FAIL

- [ ] **Step 3: 実装**(`interface.ts` 末尾。`biomeCellAt` は既に import 済み)

- [ ] **Step 4: 通過確認** — Run: `npx vitest run src/world/interface.test.ts` Expected: PASS

- [ ] **Step 5: コミット** — `git commit -am "feat: layerNumber and overlook floor detection"`

---

### Task 4: 入力(Shift, M)と字幕モジュール

**Files:**
- Modify: `src/core/input.ts`
- Create: `src/render/caption.ts`
- Test: `src/render/caption.test.ts`
- Modify: `index.html`

**Interfaces:**
- Produces(input): `get shiftHeld(): boolean`(`ShiftLeft`‖`ShiftRight`)、`get muteHeld(): boolean`(`KeyM`、段階5 の音用に状態だけ)。`GAME_KEYS` に `ShiftLeft`, `ShiftRight`, `KeyM` を足す(ブラウザ既定動作の抑止。Shift 単独は無害)。
- Produces(caption):

```ts
export const CAPTION_HOLD_SECONDS = 2;
export const CAPTION_FADE_SECONDS = 0.5;
export function captionText(layer: number, great: boolean): string; // `第 ${layer} 階層` / `第 ${layer} 階層 — 大界面`
export function captionAlpha(elapsed: number): number; // <0→0, [0,2]→1, (2,2.5)→線形に 1→0, ≥2.5→0
export class Caption {               // DOM。テスト対象外
  constructor(private el: HTMLElement) {}
  show(text: string, now: number): void;  // textContent をセットし開始時刻を記録
  update(now: number): void;              // style.opacity = captionAlpha(now − start)
}
```

- [ ] **Step 1: 失敗するテスト(`caption.test.ts`)**

```ts
it('字幕の文言', () => {
  expect(captionText(2, false)).toBe('第 2 階層');
  expect(captionText(3, true)).toBe('第 3 階層 — 大界面');
});
it('2 秒表示して 0.5 秒でフェード', () => {
  expect(captionAlpha(-0.1)).toBe(0);
  expect(captionAlpha(0)).toBe(1);
  expect(captionAlpha(2)).toBe(1);
  expect(captionAlpha(2.25)).toBeCloseTo(0.5, 5);
  expect(captionAlpha(2.5)).toBe(0);
  expect(captionAlpha(10)).toBe(0);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/render/caption.test.ts` Expected: FAIL

- [ ] **Step 3: 実装** — `caption.ts`(上の署名)、`input.ts` のゲッター 2 つ、`index.html` に `<div id="caption"></div>` と CSS:
  `#caption { position: fixed; left: 0; right: 0; bottom: 18%; text-align: center; color: #c8d0d6; font: 16px monospace; letter-spacing: 0.3em; opacity: 0; pointer-events: none; user-select: none; }`

- [ ] **Step 4: 通過確認** — Run: `npx vitest run src/render/caption.test.ts && npx tsc --noEmit` Expected: PASS

- [ ] **Step 5: コミット** — `git add -A && git commit -m "feat: shift/mute input state and layer caption module"`

---

### Task 5: main の統合と HUD

**Files:**
- Modify: `src/main.ts`
- Modify: `src/core/coordinate.ts`、`src/core/coordinate.test.ts`
- Modify: `README.md`(操作表に眺望 `Shift` 長押し、ミュート `M`(段階5 で有効))

**Interfaces:**
- Consumes: `viewState`, `INITIAL_VIEW`, `autoViewStarted`(Task 2)、`overlookCellAt`, `layerNumber`, `isGreatInterface`(Task 3)、`Caption`, `captionText`(Task 4)、`input.shiftHeld`(Task 4)。
- Produces(coordinate.ts): `export function displayAltitude(bodyY: number, bodyHeight: number): number` = `-displayY(bodyY, bodyHeight)`(上向き正の「高度」。設計書の m はこれ)。`export function highestLayer(prev: number, current: number): number` = `Math.max(prev, current)`。

- [ ] **Step 1: 失敗するテスト(`coordinate.test.ts` に追記)**

```ts
it('高度は Y の符号を反転(上へ行くほど増える)', () => {
  expect(displayAltitude(-10.75, 1.75)).toBe(9);
  expect(displayAltitude(69.25, 1.75)).toBe(-71);
});
it('到達した最高階層は落下で下がっても減らない', () => {
  expect(highestLayer(2, 1)).toBe(2);
  expect(highestLayer(1, 2)).toBe(2);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/core/coordinate.test.ts` Expected: FAIL

- [ ] **Step 3: `coordinate.ts` を実装し、`main.ts` をつなぐ**

`update(dt)` の `camera.follow` を次に置き換える:

```ts
const footRow = Math.round(player.body.y + player.body.h);
const halfW = canvas.width / 2, halfH = canvas.height / 2;
const next = viewState(view, {
  shift: input.shiftHeld,
  moving: s.left || s.right || s.up || s.down || s.jump,   // s = input.state(player.update と同じ値)
  grounded: player.body.onGround,
  still: player.body.onGround && player.body.vx === 0,
  aimX: clamp(-1, 1, (input.mouseX * dpr - halfW) / halfW),
  aimY: clamp(-1, 1, (input.mouseY * dpr - halfH) / halfH),
  overlookCell: player.body.onGround ? overlookCellAt(seed, Math.floor(player.centerX), footRow) : null,
  baseZoom: zoomTarget,
}, dt);
if (autoViewStarted(view, next)) {
  const cell = next.autoFiredMinCell!;            // 発火した板
  caption.show(captionText(layerNumber(seed, cell - 1), isGreatInterface(cell)), simTime);
}
view = next;
camera.follow(player.centerX + view.offsetX, player.centerY + view.offsetY, dt);
camera.zoomTo(view.zoom, dt);   // 既存の camera.zoomTo(zoomTarget, dt) を削除
```

HUD: `layerCur = layerNumber(seed, biomeCellAt(seed, Math.floor(player.body.y)))`、`maxLayer = highestLayer(maxLayer, layerCur)`(初期値 `layerNumber(seed, biomeCellAt(seed, spawn.y))`)。表示は `第 ${maxLayer} 階層 / 高度 ${displayAltitude(...)} — ${SYSTEM_LABEL[sys]} [seed:${seed}] — ${cannon}`。`frame()` の `updateHud()` の横で `caption.update(simTime)`。

- [ ] **Step 4: 通過と型** — Run: `npx vitest run && npx tsc --noEmit` Expected: 全 PASS

- [ ] **Step 5: 目視** —

```bash
node scripts/screenshot.mjs --seed=20260711 --pos=210,-12 --wait=1800 --out=screenshots/s3-auto-overlook.png
node scripts/screenshot.mjs --seed=20260711 --press=ShiftLeft --hold=1500 --capture=during --mouse=640,100 --out=screenshots/s3-manual-up.png
node scripts/screenshot.mjs --seed=20260711 --pos=210,-12 --wait=4500 --press=ShiftLeft --hold=1500 --capture=during --mouse=640,700 --out=screenshots/s3-manual-down.png
```
Expected: (a) 自動眺望中: 広角で前の層と光柱を見下ろし、字幕「第 2 階層」が読める。(b) 開始地点で上を向いた手動眺望: 界面の裏面と光柱が入る。(c) 見晴らし台で下を向いた手動眺望。

- [ ] **Step 6: コミット** — `git add -A && git commit -m "feat: wire overlook view, caption and layer HUD into the main loop"`

---

### Task 6: 性能と焼き込み半径の確認

**Files:**
- 計測のみ(必要なら `src/render/beacon.ts`、`src/render/renderer.ts` のコメント)

- [ ] **Step 1: 基準を一時 worktree で測る**(同じ機械状態で比べる習慣)

```bash
git worktree add ../s3-base origin/master
cd ../s3-base && npm ci --silent && node scripts/frametime.mjs --seed=20260711 --pos=210,-12
```

- [ ] **Step 2: 本ブランチを測る**

```bash
node scripts/frametime.mjs --seed=20260711 --pos=210,-12
node scripts/frametime.mjs --seed=20260711 --pos=210,-12 --wait=1500
node scripts/frametime.mjs --seed=20260711 --press=ShiftLeft
node scripts/frametime.mjs --seed=20260711 --pos=210,-12 --wait=4500 --press=ShiftLeft
node scripts/frametime.mjs --seed=20260711 --press=ShiftLeft --stages
```
Expected: 全て rAF p95 ≤ 16.7 ms(±機械ノイズは 2 回測る)。超えたら、`--stages` で重い層を特定し、光柱なら `BeaconLights` の段数(`SOFT_STEPS`/`POOL_ROWS`)を減らす。それでも足りなければ計画末尾に理由を書いて `VIEW_ZOOM` を 0.4 に寄せる(設計書 §11 の ±30%)。

- [ ] **Step 3: `BAKE_KEEP_RADIUS` の確認** — 0.35 の視界 427/34/0.35 ≈ 97 × 55 タイル、手動オフセット 40 で中心から横 88.5、縦 57。チャンク 64 で半径 2 は中心チャンクの端からでも 128 タイル先まで保持するので足りる。`renderer.ts` の `BAKE_KEEP_RADIUS` のコメント(「最大ズームアウト時の視界(約68タイル)」)を 0.35+オフセット前提の数字に更新する。

- [ ] **Step 4: 全テスト・ビルド** — Run: `npx vitest run && npx tsc --noEmit && npm run build` Expected: PASS

- [ ] **Step 5: 計画末尾に「実装時の裁定」と計測表を書き、コミット・PR**

```bash
git worktree remove ../s3-base
git add -A && git commit -m "docs: stage-3 measurements and rulings"
gh pr create --base master --title "feat: overlook view, passage caption and layer HUD (stage 3)" --body-file <(...)
```

## 実装時の裁定(計画段階)

- **打ち切りの条件**: 梯子から移動キーを押したまま見晴らし台へ着地するのが自然な経路なので、「入力があれば打ち切る」は**新たに押された移動キー**(立ち上がり)に限る。押しっぱなしの移動は受け付けつつ演出は続く。
- **1 界面 1 回**: 発火済みの最も上の板(`autoFiredMinCell`)より上の板でだけ発火する。大穴から落ちて戻った板では再発火しない。
- **Shift は即時**: 長押し判定の遅延は置かない(ズームの指数平滑が十分に遅いので、一瞬の押下で画面が跳ねない)。
- **流れの形**: 下方向のオフセットは 0→30 タイルを 1.5 秒で線形に上げ、残り 1 秒は保持。カメラの追従(係数 8)が角を丸める。
- **高度**: `高度 m` は Y の符号反転(タイル単位、上向き正)。開始地点は約 −71。基準点を別に設けない(決定論と単純さ)。
- **字幕は DOM**: キャンバスに描くと量子化の対象になり色数と時間が増える。HUD と同じく DOM に置く。
- **`layerNumber` の seed**: 開始セルは `findSpawn` が常に cell 0 なので未使用。将来開始セルが seed 依存になったときのために引数は残す。
