# 音質の全面改善(ハイブリッド方式)実装計画 — 2026-11-08

ユーザーの実機所見:「音が全体的にチープすぎる。ファミコンかと思った。音の品質は
絶対に上げてほしい(プレイ品質に関わる)」。あわせて「フリー素材(CC0 サンプル)を
使うのはどうなの」という提案があり、**ハイブリッド方式**を採用する:

- **実音系**(打撃・足音・開封・金属など実在の質感が効く音)は **CC0 サンプル主体**
- **SF 系**(パルス・ビーム・チャージ等のエネルギー音、素材に存在しない音)は
  **合成の多層化**で作り込む
- 両者の**混合**(サンプルに合成層を重ねる)も使う
- 環境ドローンは生成(合成)を主に、素材のループ音を薄く重ねることを試す

ゲームの数値・判定・発火タイミング(どの出来事でどのメソッドが呼ばれるか)は
変えない。変えるのは音色・空間処理・素材だけ。

## チープさの原因の特定(現行 `src/audio/engine.ts` / `params.ts` の実読による)

現行エンジンのワンショットは、ほぼ全てが次の基本形でできている:

> **単一オシレータ + 即時アタック + 指数減衰 1 本**(ときどき素のノイズ 1 層)

具体的に効いていた設計は次のとおり:

1. **矩形波・鋸波の素通し**: weaponSwitch・satietyWarn・turretFire・flyerAlert・
   bossWarn・enemyHit は矩形波、hurt は鋸波を、フィルタなしで鳴らしている。
   倍音が全開のまま耳に届くため、最もチップチューン的に響く。
2. **アタックの形がない**: ほとんどの音が「開始値 → 指数減衰」のみで、ADSR の
   アタック/サステインがない。機械的な「ピッ」「ブッ」で終わる。
3. **トランジェント層の欠如**: 発射・命中・着地にノイズの立ち上がりがなく、
   発射=pulseFire は三角波のみ、着地=land はローパスノイズのみ(胴体なし)で、
   「物体の音」に聞こえない。
4. **音符系の純正弦波**: noteRun(取得・補給・復活点・リチャージ・ジングル・復活)は
   正弦波の単音列そのもので、電子ビープに聞こえる。
5. **モノラル中央のみ**: StereoPannerNode を一切使っておらず、左右の広がりが
   ゼロ。音が全部「頭の真ん中」から出る。
6. **マスター段が固定ゲインのみ**: コンプレッサがなく、音ごとのピークが
   揃わない。同時発音でクリップするか、小さい音が埋没する。
7. **残響の付け方がばらばら**: Convolver(生成 IR、開放度 6 段)はあるが、
   送る音/送らない音の基準が音ごとに違い、空間の一体感が薄い。
8. **ドローンが静的**: 倍音オシレータの固定ミックスでフィルタも LFO もなく、
   オルガンの持続音に聞こえる。うなり(界面)だけが動きだった。

なお砲系(cannonFire のサブ+ノイズ掃引、charge のデチューン鋸波+ローパス連動)は
相対的に多層で出来が良く、今回の方向性(多層化+フィルタの動き)の手本になる。

## ハイブリッド対応表(音ごと)

方式: **S** = サンプル主体 / **G** = 合成主体(多層化で再設計) / **M** = 混合
(サンプル + 合成層)。素材はいずれも Kenney の CC0 パックから選定し、
トリミング・レベル調整をしてから使う(そのままは鳴らさない)。

| 音(エンジンのメソッド) | 方式 | 素材 / 合成の内容 |
|---|---|---|
| pulseFire | M | laserSmall を短く切り主体に + 合成の細いスイープ層。発射 index で素材バリエーションと rate を決定論にばらす |
| enemyHit | S | impactMetal_light/medium(短い個体)。薄く FM 金属ティックを重ねる |
| enemyDown | M | impactPunch_heavy + 合成サブの pitch 落下(従来の芯を格上げ) |
| turretFire | G | 矩形波を廃止し、鋸波+バンドパス掃引+ノイズで再設計。laserLarge を薄く重ねる |
| flyerAlert | G | 矩形波を廃止し、三角波+ローパス開閉の小さなチャープに |
| bossWarn | G | 2 音下降 + WaveShaper の軽い歪み + フィルタ掃引(矩形波は廃止) |
| hurt | M | impactPunch_medium(肉感) + 合成鋸波のフィルタ付き落下 |
| starveHurt | G | 三角波+ローパス+微かなノイズ(息)で空虚に |
| death | M | 合成の多層 pitch 落下(サブ+倍音) + impactSoft_heavy を薄く |
| revive | M | powerUp 系素材の短い個体 + 合成パッド(倍音つき 2 音) |
| jump | G | フィルタが開く上昇スイープ + ノイズの風切りを薄く |
| land | S | impactSoft_heavy / footstep_concrete(低 rate)。ゲインは従来どおり landGain |
| ladderRung | S | rpg-audio の metalClick / metalLatch を段の偶奇で交互 |
| footstep(update 内) | S | footstep_concrete の 5 バリエーションを歩行位相で決定論に選択 |
| pickup | S | digital-audio の powerUp 系(短い個体)。種別で素材と rate を変える |
| cacheOpen | M | interface-sounds の open 系 + 従来のバンドパスノイズ掃引 |
| restStock | S | Steel jingles の短い節(トリミング) |
| respawnSet | S | interface-sounds の confirmation / tick 系の短い個体 |
| weaponSwitch | S | rpg-audio の metalLatch(機械的な掛け金) |
| rechargeTick | S | interface-sounds の tick |
| satietyWarn | M | interface-sounds の error 系(低い個体) + 合成の低音 |
| eat | M | rpg-audio の cloth 系 + impactSoft_light の 2 連で「噛む」を近似 |
| milestone | S | Steel jingles から 1 曲(節目用、控えめな個体) |
| newRecord | S | Steel jingles から 1 曲(新記録用、明るい個体) |
| bossAppear | M | 合成サブの膨らみ + lowFrequency_explosion の頭を薄く + 地鳴りノイズ |
| bossCharge | M | thrusterFire の断片(rate 上昇) + バンドパスノイズ掃引 |
| bossCrash | S | sci-fi impactMetal / impactMetal_heavy + 合成サブ |
| bossDown | M | explosionCrunch(長い個体) + 合成サブの落下 |
| cannonFire | M | 既存合成(サブ+ノイズ)を多層化して格上げ + lowFrequency_explosion の断片を層に |
| cannonCrush | M | impactMining を主体層(破壊数で gain/rate) + 従来のノイズ崩落。大破壊時のみ explosionCrunch を薄く |
| charge(update 内) | G | 既存の唸りを強化: サブ追加、フィルタ掃引の幅拡大、WaveShaper のグリット、微ノイズ |
| passage | G | 正弦波単音 → 倍音パッド + フィルタ LFO で「抜けた」感じに |
| drone(update 内) | G(+層) | 倍音 + フィルタ LFO + ゲインの微かなうねり + ステレオ拡散で再設計。spaceEngineLow のループをバイオームにより超低音量で重ねる(継ぎ目が目立つ場合は合成のみに倒す) |
| hum(update 内) | G | 2200 Hz 正弦波を倍音+フィルタで柔らかくし、LFO はうねりに変更 |
| interfaceBeat(update 内) | G | ドローンの再設計に統合(フィルタ連動) |

## 素材の入手とライセンス台帳

- 入手先は Kenney(kenney.nl)の音声パック。全て CC0(Creative Commons Zero)。
  使用パック: Sci-Fi Sounds / Impact Sounds / Interface Sounds / Music Jingles /
  Digital Audio / RPG Audio(いずれも各パック同梱の License.txt で CC0 を確認済み)。
  freesound.org はダウンロードにログインが必要で本環境では取得できず、今回は
  Kenney のみで全音を賄えたため未使用(必要になれば CC0 のみを追加取得する)。
- 使った素材は全て `assets/audio/CREDITS.md` に「ゲーム内ファイル名・元の
  ファイル名・入手元 URL・ライセンス(CC0)・加工内容」を記録する。
  **台帳に無い素材は使わない。**
- 加工は ffmpeg で行う: トリミング、頭/尾の短いフェード、ピーク基準の
  レベル調整、ogg(libvorbis)再エンコード。加工済みファイルは
  `src/assets/audio/` に意味名で置き、Vite のアセットとして import する
  (base パスに自動で追従させるため public/ ではなく import 方式)。
- 容量の目安は全音源で数 MB 以内。選定は約 30 ファイル、1 ファイル数十 KB に
  収める(超える場合は報告に明記)。

## エンジン基盤の変更(Task 2)

- **マスター段**: master → DynamicsCompressor → destination に変更し、
  全体のピークを整える(threshold/ratio 等は params に集約)。
- **サンプル基盤**: `src/audio/samples.ts` に名前→URL の対応表(import)を置き、
  engine は start() で全サンプルを fetch + decodeAudioData して保持する。
  ロード完了前・失敗時は合成フォールバックで鳴らす(無音期間を作らない)。
  再生は `playSample` ヘルパに集約: gain / playbackRate / StereoPanner /
  dry・convolver への送り量を引数で受ける。有限バッファの stop discipline は
  従来どおり全ソースに stop を掛ける。
- **合成の質上げ部品**: レイヤー再生ヘルパ(トランジェントのノイズ + 倍音つき
  胴体 + フィルタ掃引 + ADSR + 任意の WaveShaper / FM / パン)を engine に用意し、
  合成主体の音はこれで組み直す。計算が要る部分(バリエーション選択、rate の
  ばらし、レイヤーのゲイン配分)は params.ts の純粋関数にして Vitest で固定する。

## Task 分割

- [ ] Task 0: 本計画書 + ベースライン計測(テスト件数、frametime 前)
- [ ] Task 1: 素材の選定・加工・配置(`src/assets/audio/`)と台帳
      (`assets/audio/CREDITS.md`)。コードは変更しない
- [ ] Task 2: マスター段(コンプレッサ)+ サンプル基盤(samples.ts / ロード /
      playSample)+ 合成レイヤーヘルパ + params の純粋関数とテスト
- [ ] Task 3: 実音系の置き換え(footstep / land / ladderRung / enemyHit /
      weaponSwitch / rechargeTick / respawnSet / pickup / eat / cacheOpen)
- [ ] Task 4: SF 系の再設計(pulseFire / turretFire / flyerAlert / bossWarn /
      charge / cannonFire / cannonCrush / jump / starveHurt)
- [ ] Task 5: 演出系の置き換え・混合(hurt / death / revive / enemyDown /
      satietyWarn / restStock / milestone / newRecord / bossAppear /
      bossCharge / bossCrash / bossDown / passage)
- [ ] Task 6: 環境系の再設計(drone / hum / interfaceBeat)
- [ ] Task 7: 検証(verify-audio 拡張で代表場面を駆動しノード復帰と例外なしを
      確認、frametime 後、同時発音時のノード数実測)と記録の追記

検証は各 Task で `npm test` / `npx tsc --noEmit` / `npm run build`。
frametime は render p50 の悪化 +0.5ms 以内(前後各 2 回)。

## 実装時の裁定

- **freesound.org は未使用**: ダウンロードにログインが必要で本環境では取得
  できなかった。Kenney の 6 パックで全音を賄えたため、入手先は Kenney のみ。
  台帳(CREDITS.md)にはその旨も含め、出所は全件 Kenney(CC0)で統一した。
- **素材の配置は `assets/audio/`(リポジトリ直下)** とし、台帳 CREDITS.md と
  同じ場所に置いた(計画当初の `src/assets/audio/` から変更。ライセンス監査で
  素材と台帳が一緒に見えることを優先)。import は `../../assets/audio/` で解決。
- **合成レイヤーヘルパ `voice()` は Task 4 で導入**し、Task 2 は基盤
  (コンプレッサ/サンプル基盤/playSample)と rechargeTick の先行移行のみとした。
- **全音に合成フォールバックを残した**: サンプルは非同期ロードのため、開始
  直後とロード失敗時は従来合成(または再設計後の合成)で鳴らす。無音期間は
  作らない。移行で旧合成を消したのは「矩形波・単音が本体だった音」
  (turretFire / flyerAlert / bossWarn / satietyWarn / weaponSwitch の
  フォールバック等は新合成)で、方式は計画の対応表どおり。
- **ドローンのエンジン音層はロード完了後に割り込む形**にした: switchDrone
  時点で未ロードなら update から startEngineLayer を呼び直し、デコード完了
  次第その層のドローンへ敷く(層が変われば新しいドローンに敷き直す)。
- **エンジン音ループの継ぎ目**は、素材側でクロスフェードループ化して対処した
  (4.2 秒、頭と尾を 1 秒重ねる)。スペクトログラムでは継ぎ目のレベル段差は
  見えない。聴感の最終判定は実機に回す。
- **noteRun は残置**: 取得・補給・復活点・リチャージ・ジングルの合成
  フォールバックとして使うため。復活音だけは noteRun をやめ、倍音つき
  パッド(voice)へ移した。
- パラメータのうち TURRET_FREQ_START/END/GAIN は新レシピでは未使用になった
  (砲台の胴体は 320→80 Hz の鋸波+サブで組み直し)。定数は params に
  旧レシピの記録として残置した。

## 計測

- **テスト**: ベースライン 879 件 → 最終 886 件(+7: params の純粋関数 4、
  samples 対応表 3)。音響テスト(params 19 + samples 3 = 22 件)は全 Task で
  全通過。フルスイートは VM 高負荷時に decor / worldgen の重量テストが
  既定の 20 秒制限でタイムアウトする既知の揺れがあり、最終形でも 886 件中
  883 通過・3 件タイムアウトだった。同 2 ファイルを制限 60 秒で単体実行すると
  72/72 全通過することを確認済み(失敗はアサーションではなく全て
  「Test timed out in 20000ms」)。
- **tsc / build**: 全 Task で `npx tsc --noEmit` クリーン、`npm run build` 成功。
  サンプルは Vite のアセットとしてバンドルされる(36 ファイル、261 KB)。
- **frametime(render p50)**: 計測時の VM は極端な高負荷で、通常時(前回実績
  5.6〜6.6 ms)の 15 倍前後の絶対値になったため、起点コミット 3d4a6e0 の
  ワークツリーと交互に測るペア比較で判定した。
  - 開始場面: 変更後 103.0 / 96.1 ms、変更前 103.6 / 105.1 ms(変更後 ≤ 変更前)
  - pos=40,60: 変更後 90.4 / 86.8 ms、変更前 85.3 / 40.4 ms(2 回目の変更前は
    計測中に負荷が抜けており参考値。同負荷の 1 回目は +5 ms 程度)
  - pos=244,66(歩行): 変更後 11.1 ms、変更前 18.6 ms(変更後の方が速い)
  音響は描画パスに入らず、フレームごとの追加仕事はドローンのフィルタ追従
  1 件のみ。悪化の証拠はなく、差は負荷変動の範囲と判断する。
- **リーク確認(verify-audio、AudioContext 計装で実駆動)**: **ALL OK**。
  - 常駐の未停止ノードは 10(ドローン倍音 3 + うなり 1 + LFO 2 + ハム 3 +
    エンジン音層 1)で、歩行・ジャンプ・パルス連射・武器切替・溜め→発射を
    駆動した後も 10 に完全復帰。ページ例外・コンソールエラーなし。
  - パルス連射 3 秒でサンプル再生 17 回を確認。連射ピーク(1.5 秒時点)でも
    未停止ノードは 10 のまま(stop 漏れなし)。生成ノード総数の増加は
    連射 3 秒で +34 件程度に収まる。
  - 駆動した範囲では矩形波オシレータの生成は 0 件(チップチューン的な
    素通し矩形波は全廃されたことの傍証)。

## 保留

- **全ての音の聴感(音量バランス・質感・素材の合う/合わない)はヘッドレスで
  判定できないため、初期値のまま実機判定に回す**。方針は「サンプルは
  ピーク正規化済みなので gain は 0.5 前後を基準、砲とボスを主役に、
  パルスと合図系は控えめ」。調整は params.ts の定数と engine の gain 指定
  だけで完結する。
- **ジングル素材の音色の合否**: Steel jingles はスペクトログラム上は低域に
  寄った金属打撃で、想定より「明るいジングル」ではない可能性がある。
  節目=STEEL09、新記録=STEEL04 を割り当てたが、実機で違和感があれば
  Pizzicato 系や Hit jingles への差し替えが候補(CREDITS.md に元の
  ファイル名があるので再加工は容易)。
- **ドローンのエンジン音層の継ぎ目と音量**(engineLayerGain 最大 0.2)は
  実機で目立つ場合、params の表を 0 に倒せば生成のみに戻せる。
- **サンプルのロード完了前の数発**は合成フォールバックで鳴る(開始直後の
  パルス等)。仕様として許容したが、気になる場合は decode 完了まで
  ゲーム開始を待たせる案がある。
- 敵・砲台・ボスの音の距離減衰は今回も付けていない(位置音響は既存エンジンに
  ない)。サンプル化で音量感が変わったため、実機の所見次第で検討する。
- freesound.org の CC0 素材の追加取得は、ログイン手段が用意できれば可能
  (例: 噛む音、風切り、水音など Kenney に薄い領域)。今回は未実施。
