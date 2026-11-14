# 2.20「大昇降機(グランドシャフト)」 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 複数の層 cell を貫く 300〜600 タイル級の縦シャフトを稀なランドマークとして置き、既存の昇降機の仕組み(運ぶ物理・5 タイル/秒・停止階・呼び戻し)を長大化して乗れるようにする。乗っている間は支柱・ケーブル・灯の列が流れ続け、一定間隔の眺望区間から遠景が見え、地区の境目で壁の質感と灯の色が切り替わる。

**Architecture:** 配置と幾何は純粋関数 `src/world/grandShaft.ts`。抽選は「列バンド(孔スロット 8 個 = 3072 タイル)× cell グループ(連続 3 層)」の組で引き、外形をバンドとグループの内側に収めるので、タイルの判定は `(x のバンド, y の cell のグループ)` の 1 組だけを引けば足りる。地形合成(`worldgen.composeTile`)では大構造と同じ段(板の HARD にだけ勝つ)に入れる。足場は `entities/elevator` を停止階の列(`stops`)・幅・呼び戻しの X 範囲を持つ `LiftShaft` へ一般化して共用する。景色は既存の装飾リスト(`decorateChunk`)と既存の灯の矩形(`LandmarkLights`)へ相乗りし、描画パスは足さない。

**Tech Stack:** Vite + TypeScript、Vitest。コメントは日本語。

**Spec:** `docs/superpowers/specs/2026-11-12-mega-structures-design.md`(範囲は大昇降機のみ。歩行空間の巨大ランドマーク(巨柱・サイロ)は対象外)

**Branch:** `feat/grand-shaft-220` / **Version:** 2.20

## Global Constraints

- 生成・描画に `Math.random()` を使わない。配置・停止階・眺望区間・設備・壁の質感はすべて seed と世界座標の hash で決める(`AGENTS.md`)。
- 通常の昇降機(`elevatorShaftAt`、salt 9401)とは別の抽選(salt 9551)。重なりの棄却は大昇降機の側で行い、通常の昇降機の配置は変えない。
- 既存の地形の優先順位を崩さない: 孔(縦坑・見晴らし台・大穴)・前室の芯・大構造・休憩点・大広間と煙突・メガ施設とは配置の段階で重ならない。梯子列(`groupLadderX`)は壁の外では常に地形に任せる。
- 永続化は現行の昇降機と同じ(足場の位置はセッション内のみ。セーブ対象外)。途中駅の補給・端末の開封/既読は既存の ID 集合にそのまま入る。
- 描画は焼き込み(チャンクの装飾)と既存の灯の矩形への相乗りだけ。新しい描画パスは足さない。
- 頻度の数値はすべて定数に切り出す(`GRAND_RATE`、`GRAND_BAND_SLOTS`、`GRAND_GROUP_CELLS`、`GRAND_TRIES`、`GRAND_AMENITY_RATE`、眺望・灯の間隔)。
- 完了条件: `npm test`、`npx tsc --noEmit`、`npm run build` が通る。乗車中の frametime の render p50 悪化は +0.5 ms 以内。スクリーンショットで前後を確認する。

## Review Focus

1. **列の一致と境界**: 外形がバンドとグループの内側に収まること(タイルの判定が 1 組だけで正しい前提)。チャンク境界・板の行でも壁と内側が途切れないこと(Task 1・2)。
2. **板の貫通**: 内側の AIR は板を貫くが、壁と板の上面の乗り場の床は不壊(HARD)のまま。`isHardAt` が `tileAt` と一致すること(Task 2)。
3. **詰みなし**: どの停止階からも、乗り場が梯子列まで続く。落ちても最下端の床に着き、出入口から歩いて出られる(Task 1・2)。
4. **足場の一般化**: 通常の昇降機の挙動(2 停止階・端で止まる・折り返し・呼び戻し)が変わらないこと(Task 3)。

---

## ファイル構成

- Create `src/world/grandShaft.ts` — 定数、`GrandShaft` / `GrandStation`、`grandShaftAt`、`grandShaftTileAt`、`grandTileAt`、`grandShaftsNear`、`grandShaftBounds`、`grandLampAt`、`grandVistaAt`、`grandAmenitySpots`。
- Create `src/world/grandShaft.test.ts` — 配置・決定論・重なり・地形統合・チャンク境界一致・到達可能性(Player 結合)。
- Modify `src/world/worldgen.ts` — `composeTile` と `isHardAt` に大昇降機を大構造と同じ段で入れる。
- Modify `src/world/worldgen.test.ts` — 「界面タイルを最優先にする」の走査で大昇降機の内側を除外(大構造と同じ扱い)。
- Modify `src/entities/elevator.ts` — `LiftShaft`(`width?`・`stops?`・`landX0?`/`landX1?`)、`liftWidth`、`liftStops`、↑↓ は 1 つ隣の停止階へ。
- Modify `src/entities/elevator.test.ts` — 停止階の列の遷移・押し続け・途中駅の呼び戻し。
- Modify `src/main.ts` — 近傍の大昇降機を足場の列へ、途中駅の補給・端末を既存の候補へ、休憩所で復活点を移す、`liftWidth` で描画と合図。
- Create `src/render/grandShaftColors.ts` — 鋼の色、地区の灯・壁の帯・眺望の色。
- Modify `src/render/decor.ts` — `grandShaftOps`(案内レール・ケーブル・筋交い・灯・壁の帯と質感・眺望の手すり・乗り場の縁・休憩所の灯)。
- Modify `src/render/landmarkLight.ts` — `grandShaftLightsInView`(眺望区間・灯・休憩所)を `LandmarkLights` に相乗り。
- Create `src/render/grandShaftDecor.test.ts` — 装飾の決定論・レールの連続・灯の地区切り替え・眺望の光。
- Modify `ios/App/App.xcodeproj/project.pbxproj` — `MARKETING_VERSION` を 2.20 へ(Debug / Release の 2 か所)。

---

### Task 1: 配置と幾何(`world/grandShaft.ts`)

**Files:** `src/world/grandShaft.ts`、`src/world/grandShaft.test.ts`

- [ ] **Step 1: テストを書く** — 決定論(別シードを挟んでも同じ)、範囲内に 1 本以上・全組には置かない、長さ 300〜600 で 2 層以上、停止階の並び(上端・板ごとに上下 2 段・下端)、停止階が床帯の行/板の上面、外形がバンドとグループの内側、壁と内側に梯子列を含まない、孔(±`GRAND_PASSAGE_CLEAR`)・大構造・休憩点の箱・大広間と煙突・通常の昇降機・メガ施設と重ならない、`grandShaftsNear`、設備は一部の駅だけ。
- [ ] **Step 2: 実装** — 縦の配置(`verticalLayout`)は組ごとに 1 回、横は候補グループを `GRAND_TRIES` 個まで試す(`build` → `fits`)。メモは数値キー(`band × 2^20 + group`)。
- [ ] **Step 3: 検証とコミット**

### Task 2: 地形合成への統合(`worldgen.ts`)

**Files:** `src/world/worldgen.ts`、`src/world/worldgen.test.ts`、`src/world/grandShaft.test.ts`

- [ ] **Step 1: テストを書く** — `tileAt` がシャフトの形を持つ(板に当たる SOLID は HARD)、内側は板の行も含めて空気が通る、板の行の壁は HARD で `isHardAt` が一致、眺望区間の空間と床、`generateChunk` が `tileAt` と一致し境界の上下で内側が空気、どの停止階も乗り場が梯子列まで開いている、落ちても最下端に着き梯子列の側へ歩いて出られる(Player 結合)。
- [ ] **Step 2: 実装** — `composeTile` の大構造の直後に `grandTileAt`。界面が null か HARD のときだけ勝ち、SOLID が HARD に当たる位置は HARD を残す。`isHardAt` も同じ規則。
- [ ] **Step 3: 既存テストの調整** — 「界面タイルを最優先にする」の走査で大昇降機の内側(SOLID 以外)を除外する(崩落の裂け目・塔の縦坑と同じ扱い)。
- [ ] **Step 4: 検証とコミット**

### Task 3: 足場の一般化(`entities/elevator.ts`)

**Files:** `src/entities/elevator.ts`、`src/entities/elevator.test.ts`

- [ ] **Step 1: テストを書く** — 既存の 2 停止階のテストはそのまま通ること。停止階の列で ↑↓ が 1 つ隣、途中の折り返し、押し続けで次々に進む(420 タイルで約 84 秒)、途中駅での呼び戻しと X 範囲、幅 6 の足場。
- [ ] **Step 2: 実装** — `LiftShaft` と `liftWidth` / `liftStops`。`commandElevator` は「上で最も近い停止階 / 下で最も近い停止階」。
- [ ] **Step 3: 検証とコミット**

### Task 4: 結線(`main.ts`)

**Files:** `src/main.ts`

- [ ] **Step 1: 実装** — 敵スキャンで `grandShaftsNear` を引き、足場の列に並べる(状態は ID で引き継ぐ。セーブ対象外)。外形はインフラの除外矩形へ。途中駅の補給は `chooseSupplyCaches` の候補に、端末は `chooseTerminal` の候補に並べる(近傍 48 タイル)。休憩所の灯の下に接地すると復活点を移す。合図の距離判定と描画の幅を `liftWidth` へ。
- [ ] **Step 2: 検証** — `?x=&y=` でシャフトの最下端に置き、乗車・途中駅での降車・呼び戻し・落下を手で確かめる。
- [ ] **Step 3: コミット**

### Task 5: 乗っている間の景色(焼き込みと灯)

**Files:** `src/render/grandShaftColors.ts`、`src/render/decor.ts`、`src/render/landmarkLight.ts`、`src/render/grandShaftDecor.test.ts`

- [ ] **Step 1: テストを書く** — 装飾の決定論、案内レールがチャンク境界をまたいで上端から最下端まで続く、灯の行と色(行の地区。板の上下で違う色)、`decorateChunk` に載る、眺望区間の光が 1 枚で地区の眺望色、決定論。
- [ ] **Step 2: 実装** — `grandShaftOps` を `decorateChunk` の最後に。`grandShaftLightsInView` を `LandmarkLights.render` の矩形列へ追加。
- [ ] **Step 3: 検証** — スクリーンショット(乗車中・眺望区間・地区の境目)と frametime(`--pos` をシャフトの中へ)。
- [ ] **Step 4: コミット**

### Task 6: 版数と記録

- [ ] `MARKETING_VERSION` を 2.20 へ(2 か所)。
- [ ] 計画書の末尾に「実装時の裁定」「計測」「保留」を書く。

---

## 実装時の裁定

- **抽選の単位**: 設計書の「列バンド × 開始 cell」を「列バンド × cell グループ(3 層)」とし、開始 cell はグループの中で hash で選ぶ(先頭か 2 番目)。グループの外へ出ないので、同じバンドで縦に続く 2 本が重ならず、タイルの判定は 1 組を引くだけで済む。設計書の「帯ごとに 1 本出るか出ないか」は `GRAND_RATE = 0.5`(組ごと)で表し、重なりの棄却でさらに減る(見積もりで組の約 3 割)。
- **列バンドの幅**: 孔スロット 8 個(3072 タイル)。候補はスロットの 32 タイルグループ 9〜14 番(スロットの境目付近)。孔の中心はスロット中心 ±64 にあり、大構造は孔 +160 にあるので、空きはスロットの境目付近に出やすい。候補を最大 8 個試す。バンドの最後のスロットは使わない(張り出しがバンドの外へ出ないように)。
- **長さと貫く層**: 長さは 300〜600 を hash で決め、下端は終わりの cell の床帯の行(板の下面から 64 以上下・床の板の上面から 16 以上上)へ丸める。範囲外になる組は置かない(再抽選しない)。平均的な層の高さ(375)では 2 層を貫く(板 1 枚)のが大半で、層が低い組だけ 3 層(板 2 枚)になる。
- **途中駅は板ごとに 2 段**: 板の上面(上の層の底へ出る)と、板の下面の直下の床帯の行(下の層の頭へ出る)。設計書の「各 cell の境界階」を、境界の上下どちらの層へも降りられる形にした。設備(休憩所・端末・補給)は上の段の乗り場(梯子列の反対側)に置き、駅の半分程度(`GRAND_AMENITY_RATE = 0.5`)だけに付ける。
- **詰みなしの保証**: 停止階の乗り場は、梯子列の側では自分のグループの梯子列まで延ばす(反対側は 8 列)。梯子列は層の高さ全体を通る上昇路なので、どの停止階からも層の経路網へ出られる。乗り場の先の躯体には依存しない(通常の昇降機は「床帯の行に揃えれば既存の床へつながる」前提だった)。壁は通常の昇降機と同じく床帯の行ごとに出入口を空ける。落下の被害は無いので、シャフトに落ちても足場か最下端の床に着く。
- **孔からの離れ**: 外形の端から孔まで `ANTECHAMBER_HALF_WIDTH + 4 = 124`。前室の合成が先に返る範囲(梯子の抑止・連続床、孔から ±120)と界面の縦坑・見晴らし台・大穴(孔 −12〜+72)を避ければ足りる。フェード帯(120〜160)は合成が先に返らないので重なってよい。
- **板の貫通**: 大昇降機は大構造と同じ段で合成し、界面が null か HARD のときだけ勝つ。壁と板の上面の乗り場の床(SOLID)が板に当たる位置は HARD を残す(板は不壊のまま、重粒子砲で板に穴は開かない)。`isHardAt` も同じ規則にした。
- **施設・幹線のオーバーレイ**: 大構造と同じく大昇降機が勝つ(通常の昇降機のように施設の梯子を壁の中に残す処理はしない)。施設の縦の上昇路がシャフトで切れても、両側は 32 タイル梯子列で迂回できる。
- **眺望区間**: 上端から 40 行目以降、80 行ごと(5 タイル/秒で 16 秒ごと)に、両側の壁を 10 行抜いて外へ 12 列の張り出し(床と庇)を彫る。板と停止階の ±8 行には置かない。空気の背後には既存の遠景(超構造のシルエット)がそのまま透ける。暗さの中の明るい例外として、区間ごとに眺望色の矩形 1 枚(alpha 0.14、遮蔽なし)を灯の重ね描きに足す。
- **足場の操作**: ↑↓ は 1 つ隣の停止階へ動き、押し続けると到着の次のステップで次の停止階へ進む。通常の昇降機(停止階 2 つ)では従来と同じ挙動になる。足場の幅は内側の幅 6(通常は 4)。
- **地区の切り替え**: 地区は行の cell で決める(板の上面で切り替わる)。灯の色は淡い白熱色を地区の accent へ 55% 寄せた色、壁の内側の面の帯は鋼を accent へ 45% 寄せた色。壁の 4 行ブロックごとに地区バイアスの表(`SCENERY_PROFILE` の `rust` / `stencil` / `pipes`)で錆筋・ステンシル・縦配管の確率を変える。
- **色は専用**: 装飾と光の色は `render/grandShaftColors.ts` に置き、既存の `PALETTE` / `SCENERY_COLORS` / 地区色・休憩点の暖色と同じ値を使わない(既存テストの「色で見分ける」検査に紛れ込まないように)。光は `landmarkLightsInView` に混ぜず別関数 `grandShaftLightsInView` にし、`LandmarkLights.render` で同じ矩形列に並べる。
- **休憩所**: 途中駅の休憩所は「灯の下に接地すると復活点が移る」だけ。休憩点の箱の確保・初回補給・満腹度の安全圏は付けない(保留)。
- **永続化**: 足場の位置はセッション内のみ(通常の昇降機と同じ)。途中駅の補給(`s:g:band,cell`)・端末(`m:g:band,cell`)の開封・既読は既存の集合に入り、既存の保存にそのまま乗る。

## 計測

(未計測。親側で次を取って追記する)

- `npm test` のテスト数、`npx tsc --noEmit`、`npm run build`。
- スクリーンショット: 変更前後の `start.png` / `p244.png`(大昇降機が視野に無い位置では差分 0 が目標)と、シャフトの中(乗車中の位置、眺望区間、板の上下)の画像。シャフトの座標は `grandShaftAt` の走査で求める(seed 20260711)。
- frametime: 既存 3 位置の前後と、シャフトの中の位置での `render` p50(合格線 +0.5 ms 以内)。

## 保留

- **休憩所の機能**: 確保(エクストラクション)・初回補給・満腹度の安全圏は休憩点の箱だけ。途中駅に付けるかは実機の体感で決める。
- **層の通過演出**: 見晴らし台・塔の頂部で出る階層番号・地区名の字幕と通過音は、大昇降機で板を越えたときには出ない。足場が板を越えた瞬間に同じ字幕を出すかは別途。
- **頻度の調整**: `GRAND_RATE = 0.5`、`GRAND_TRIES = 8`、`GRAND_AMENITY_RATE = 0.5` は初期値。実機で「見つけたときに嬉しい」稀少さか確かめて調整する。
- **呼び戻しの待ち**: 最下端から上端まで呼ぶと最長 120 秒待つ。途中駅で呼んだときの待ち時間が長すぎるなら、足場を 2 台にするか呼び戻しだけ速くするかを検討する。
- **景色の小物**: 歩く景色(残滓・桁渡り)は `sceneryGuarded` で大昇降機を避けていないので、乗り場や眺望区間の床に載ることがある。見た目の問題が出たら除外を足す。
- **施設の梯子**: 施設・幹線のオーバーレイの梯子が壁で切れる(大構造と同じ扱い)。到達性の問題が出たら通常の昇降機と同じく壁の中で残す。
- **背景の大構造**: 眺望区間から見える遠景は既存の超構造のシルエットそのもの。眺望区間に合わせた専用の遠景(シャフトの向こうの巨大構造)は足していない。
- **歩行空間の巨大ランドマーク**(巨柱・サイロ): 設計書のとおり今回の対象外。

## 検証結果

(未実施。この作業ではシェルを実行していない。`npm test`・`npx tsc --noEmit`・`npm run build`・スクリーンショット・frametime は親側で実行する)

### 検証結果（親側、2026-11-14）

- 全テスト 1371 件全通過（2.19 時点 1345 → 1371）。型チェック・ビルド通過。
- 標準シードで大昇降機の実在を確認: x=387〜393、y=649〜1080（431 タイル、停止階 4 か所）。シャフト内と板付近のスクリーンショットで壁・灯・途中駅・地区色の切り替わりを目視確認した。乗車の体感と眺望区間の見え方は実機（Web）判定待ち。
